/**
 * CustomerPaymentsPage - Unified Customer Payments (ERP Best Practice)
 *
 * Following standard ERP patterns (SAP, Oracle, Odoo, ERPNext), this unified page handles:
 * - Credit settlements (receive payment against credit invoices)
 *
 * Features:
 * - Single/Multiple invoice selection
 * - Partial payments
 * - FIFO auto-allocation
 * - Multiple payment methods (Cash, Bank Transfer, Cheque, Card)
 * - Previous payment suggestions (auto-populate)
 *
 * Workflow:
 * 1. Select customer → View all outstanding credit invoices
 * 2. Select invoice(s) to receive payment for
 * 3. Enter payment details
 * 4. Review and post payment
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Box,
  TextField,
  MenuItem,
  Alert,
  CircularProgress,
  Chip,
  Typography,
  Paper,
  Divider,
  Button,
  Card,
  CardContent,
  Grid,
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  InputAdornment,
  Stepper,
  Step,
  StepLabel,
  IconButton,
  FormControlLabel,
  Switch,
  Autocomplete,
  Tooltip,
} from "@mui/material";
import PaymentIcon from "@mui/icons-material/Payment";
import PersonIcon from "@mui/icons-material/Person";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import DescriptionIcon from "@mui/icons-material/Description";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteIcon from "@mui/icons-material/Delete";
import CreditCardIcon from "@mui/icons-material/CreditCard";
import SearchIcon from "@mui/icons-material/Search";
import WarningIcon from "@mui/icons-material/Warning";
import AssessmentIcon from "@mui/icons-material/Assessment";
import ReceiptIcon from "@mui/icons-material/Receipt";
import AddIcon from "@mui/icons-material/Add";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import {
  handleApiError,
  showErrorToast,
  showSuccessToast,
  TStatCard,
  TFilterPanel,
  TConfirmDialog,
  useConfirmDialog,
  fmtLKR,
} from "@/components/tijaero";

import {
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  DetailPanelHeader,
  ActionToolbar,
  FormSection,
  EmptyState,
} from "@/components/tijaero";

import { customersApi, CustomerCreditSummary } from "@/modules/customers/api";
import { Customer } from "@/modules/customers/types";
import { salesApi, paymentCardsApi } from "@/modules/sales/api";
import { Invoice, PaymentCard } from "@/modules/sales/types";

import { useReferenceData } from "@/hooks";
import apiClient from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { settingsApi } from "@/modules/settings/api";
import { usePermission } from "@/auth/permissions";

// Configuration
interface SortOption {
  value: string;
  label: string;
}

const SORT_OPTIONS: SortOption[] = [
  { value: "customer_name", label: "Name" },
  { value: "outstanding", label: "Outstanding" },
  { value: "max_credit_limit", label: "Credit Limit" },
];

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "card", label: "Card" },
];

// Split payment row interface
interface SplitPaymentRow {
  id: string;
  method: string;
  amount: number;
  cheque_number: string;
  cheque_bank: string;
  cheque_date: string;
  card_ref_number: string;
  card_holder_name: string;
  card_id: number | null;
  bank_name: string;
  bank_transfer_ref: string;
}

// Helper function to create a new split payment row
const makeSplitRow = (method = "cash", amount = 0): SplitPaymentRow => ({
  id: Date.now().toString() + Math.random().toString(36).slice(2),
  method,
  amount,
  cheque_number: "",
  cheque_bank: "",
  cheque_date: new Date().toISOString().split("T")[0],
  card_ref_number: "",
  card_holder_name: "",
  card_id: null,
  bank_name: "",
  bank_transfer_ref: "",
});

// Outstanding invoice for customer credit payment
interface OutstandingInvoice {
  id: number;
  invoice_no: string;
  date: string;
  due_date: string;
  payment_method: string;
  total_amount: number;
  credit_amount: number;
  paid_amount: number;
  balance_due: number;
  payment_status: string;
  days_overdue: number;
  is_overdue: boolean;
  branch_code: string;
  approval_status: string;
}

// Payment allocation line
interface PaymentLine {
  id: string;
  invoice: OutstandingInvoice;
  allocated_amount: number;
}

// Steps in the workflow
const STEPS = ["Select Invoices", "Payment Details", "Review & Post"];

// View mode
type ViewMode = "overview" | "documents" | "payment" | "review";

export default function CustomerPaymentsPage() {
  const location = useLocation();
  const navigate = useNavigate();

  // Data state
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selection state
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("customer_name");

  // View state
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [creditStatus, setCreditStatus] = useState<CustomerCreditSummary | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [customerInvoices, setCustomerInvoices] = useState<Invoice[]>([]);
  const [allCustomerInvoices, setAllCustomerInvoices] = useState<Map<number, Invoice[]>>(new Map());

  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [activeStep, setActiveStep] = useState(0);

  // Branch filter
  const { filteredBranches: branches = [] } = useReferenceData(["branches"]);
  const [selectedBranch, setSelectedBranch] = useState<string>("all");

  // Document search filter
  const [documentSearchQuery, setDocumentSearchQuery] = useState<string>("");

  // Invoice selection
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<number>>(new Set());
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);

  // Split payments state
  const [splitPayments, setSplitPayments] = useState<SplitPaymentRow[]>([makeSplitRow("cash", 0)]);

  const updateSplitRow = (id: string, update: Partial<SplitPaymentRow>) =>
    setSplitPayments((prev) => prev.map((r) => (r.id === id ? { ...r, ...update } : r)));

  const removeSplitRow = (id: string) =>
    setSplitPayments((prev) => prev.filter((r) => r.id !== id));

  const addSplitRow = () =>
    setSplitPayments((prev) => [...prev, makeSplitRow("cash", 0)]);

  // Payment form (legacy - kept for backward compatibility)
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [chequeDate, setChequeDate] = useState(new Date().toISOString().split("T")[0]);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [remarks, setRemarks] = useState("");
  const [cardRefNumber, setCardRefNumber] = useState("");
  const [cardHolderName, setCardHolderName] = useState("");
  const [selectedPaymentCardId, setSelectedPaymentCardId] = useState<number | null>(null);

  // Previous payment suggestions
  const [previousBankNames, setPreviousBankNames] = useState<string[]>([]);
  const [lastPaymentSuggestion, setLastPaymentSuggestion] = useState<{ payment_method: string; bank_name: string } | null>(null);

  // FIFO mode
  const [useFIFO, setUseFIFO] = useState(false);
  const [fifoAmount, setFifoAmount] = useState(0);

  const confirmDialog = useConfirmDialog();

  // Permissions
  const canViewSalesSettings = usePermission("sales_settings", "view");

  // Fetch active payment cards from settings
  const { data: paymentCards = [] } = useQuery({
    queryKey: ["payment-cards-active"],
    queryFn: () => paymentCardsApi.getAll(true), // Only active cards
    enabled: canViewSalesSettings,
  });

  // Fetch company settings for service charge display
  const { data: companySettings } = useQuery({
    queryKey: ["company-settings"],
    queryFn: () => settingsApi.getCompanySettings(),
  });

  const hideServiceCharge = companySettings?.hide_service_charge ?? false;

  // Get selected payment card details
  const selectedPaymentCard = useMemo(() => {
    if (!selectedPaymentCardId) return null;
    return (
      paymentCards.find(
        (card: PaymentCard) => card.id === selectedPaymentCardId,
      ) || null
    );
  }, [selectedPaymentCardId, paymentCards]);

  // Load customers
  const loadCustomers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await customersApi.getAll();
      const activeCustomers = data.filter((c: Customer) => c.active);
      setCustomers(activeCustomers);
    } catch (err: unknown) {
      setError(handleApiError(err, "Failed to load customers"));
    } finally {
      setLoading(false);
    }
  }, []);

  // Load/refresh customers whenever this route is entered.
  useEffect(() => {
    loadCustomers();
  }, [location.key, loadCustomers]);

  // Load credit status for selected customer
  const loadCreditStatus = useCallback(async (customerId: number) => {
    try {
      setLoadingStatus(true);
      const status = await customersApi.getCreditSummary(customerId);
      setCreditStatus(status);
    } catch {
      setCreditStatus(null);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  // Load outstanding invoices for customer
  const loadCustomerInvoices = useCallback(async (customerId: number) => {
    try {
      const invoices = await salesApi.getByCustomer(customerId);
      setCustomerInvoices(invoices || []);
    } catch {
      setCustomerInvoices([]);
    }
  }, []);

  const refreshSelectedCustomerData = useCallback(() => {
    if (!selectedCustomer?.id) return;
    loadCreditStatus(selectedCustomer.id);
    loadCustomerInvoices(selectedCustomer.id);
  }, [selectedCustomer?.id, loadCreditStatus, loadCustomerInvoices]);

  // Refresh selected customer data whenever user re-enters this page.
  useEffect(() => {
    refreshSelectedCustomerData();
  }, [location.key, refreshSelectedCustomerData]);

  // Refresh immediately when payment approval actions or sales orders happen.
  useEffect(() => {
    const handler = () => {
      loadCustomers();
      refreshSelectedCustomerData();
    };

    window.addEventListener("customer-payment-approval-updated", handler as EventListener);
    window.addEventListener("sales-order-updated", handler as EventListener);
    return () => {
      window.removeEventListener("customer-payment-approval-updated", handler as EventListener);
      window.removeEventListener("sales-order-updated", handler as EventListener);
    };
  }, [loadCustomers, refreshSelectedCustomerData]);

  // Transform invoices to outstanding documents
  const outstandingInvoices = useMemo((): OutstandingInvoice[] => {
    const docs: OutstandingInvoice[] = [];

    customerInvoices.forEach((inv) => {
      if (inv.credit_amount > 0 && inv.balance_due > 0 && inv.approval_status === "completed") {
        const creditDays = selectedCustomer?.credit_days || 30;
        const invoiceDate = new Date(inv.created_date);
        const dueDate = new Date(invoiceDate);
        dueDate.setDate(dueDate.getDate() + creditDays);
        const now = new Date();
        const daysOverdue = Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)));

        docs.push({
          id: inv.id,
          invoice_no: inv.invoice_no,
          date: inv.created_date,
          due_date: dueDate.toISOString().split("T")[0],
          payment_method: inv.payment_method,
          total_amount: inv.grand_total,
          credit_amount: inv.credit_amount,
          paid_amount: inv.paid_amount,
          balance_due: inv.balance_due,
          payment_status: inv.payment_status,
          days_overdue: daysOverdue,
          is_overdue: daysOverdue > 0,
          branch_code: inv.branch_code,
          approval_status: inv.approval_status,
        });
      }
    });

    // Apply filters
    let filtered = docs;

    if (selectedBranch !== "all") {
      filtered = filtered.filter((d) => d.branch_code === selectedBranch);
    }

    if (documentSearchQuery.trim()) {
      const query = documentSearchQuery.toLowerCase().trim();
      filtered = filtered.filter((d) =>
        d.invoice_no?.toLowerCase().includes(query)
      );
    }

    // Sort by due date (oldest first — FIFO)
    filtered.sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());

    return filtered;
  }, [customerInvoices, selectedCustomer, selectedBranch, documentSearchQuery]);

  // Calculate totals
  const totalOutstanding = useMemo(() => {
    return outstandingInvoices.reduce((sum, doc) => sum + doc.balance_due, 0);
  }, [outstandingInvoices]);

  const overdueInvoices = useMemo(() => {
    return outstandingInvoices.filter((doc) => doc.is_overdue);
  }, [outstandingInvoices]);

  const serviceChargeAmount = useMemo(() => {
    if (paymentMethod !== "Card" || !selectedPaymentCard) return 0;
    const base = paymentLines.reduce((sum, line) => sum + line.allocated_amount, 0);
    return Math.round(base * (selectedPaymentCard.service_charge_percent || 0)) / 100;
  }, [paymentLines, paymentMethod, selectedPaymentCard]);

  const totalPaymentAmount = useMemo(() => {
    const base = paymentLines.reduce((sum, line) => sum + line.allocated_amount, 0);
    return base + serviceChargeAmount;
  }, [paymentLines, serviceChargeAmount]);

  // Base (without service charge) — used for invoice balance reduction display
  const basePaymentAmount = useMemo(() => {
    return paymentLines.reduce((sum, line) => sum + line.allocated_amount, 0);
  }, [paymentLines]);

  // Filtered customers
  const filteredCustomers = useMemo(() => {
    let filtered = customers;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((c) =>
        c.customer_name.toLowerCase().includes(query) ||
        c.company_name?.toLowerCase().includes(query) ||
        c.mobile_contact_number?.includes(query) ||
        c.email?.toLowerCase().includes(query)
      );
    }

    filtered.sort((a, b) => {
      switch (sortField) {
        case "customer_name":
          return a.customer_name.localeCompare(b.customer_name);
        case "outstanding":
          return (b.max_credit_limit - (b.left_credit_amount ?? b.max_credit_limit)) -
            (a.max_credit_limit - (a.left_credit_amount ?? a.max_credit_limit));
        case "max_credit_limit":
          return b.max_credit_limit - a.max_credit_limit;
        default:
          return 0;
      }
    });

    return filtered;
  }, [customers, searchQuery, sortField]);

  // Handlers
  const handleSelectCustomer = useCallback((customer: Customer) => {
    setSelectedCustomer(customer);
    setViewMode("overview");
    setActiveStep(0);
    setSelectedInvoiceIds(new Set());
    setPaymentLines([]);
    setUseFIFO(false);
    setFifoAmount(0);
    resetPaymentForm();
    // Load data
    loadCreditStatus(customer.id);
    loadCustomerInvoices(customer.id);
    // Fetch previous payment data to auto-populate payment form
    customersApi
      .getCreditSettlements(customer.id)
      .then(async (settlements) => {
        if (!settlements || settlements.length === 0) {
          setPreviousBankNames([]);
          setLastPaymentSuggestion(null);
          return;
        }
        // Load details of recent settlements to get payment methods and bank names
        const recentSettlements = settlements.slice(0, 5);
        const details = await Promise.all(
          recentSettlements.map(async (s) => {
            try {
              return await customersApi.getCreditSettlement(customer.id, s.id);
            } catch {
              return null;
            }
          })
        );
        const validDetails = details.filter(Boolean);
        // Collect unique bank names from transactions
        const banks: string[] = [];
        let lastMethod = "";
        let lastBank = "";
        validDetails.forEach((detail) => {
          detail?.transactions?.forEach((t: any) => {
            if (t.bank_name && t.bank_name.trim()) {
              if (!banks.includes(t.bank_name)) banks.push(t.bank_name);
            }
            if (!lastMethod && t.payment_method) {
              lastMethod = t.payment_method;
              lastBank = t.bank_name || "";
            }
          });
        });
        setPreviousBankNames(banks);
        if (lastMethod) {
          setLastPaymentSuggestion({ payment_method: lastMethod, bank_name: lastBank });
        } else {
          setLastPaymentSuggestion(null);
        }
      })
      .catch(() => {
        setPreviousBankNames([]);
        setLastPaymentSuggestion(null);
      });
  }, [loadCreditStatus, loadCustomerInvoices]);

  // Auto-select first customer
  useEffect(() => {
    if (filteredCustomers.length > 0 && !selectedCustomer && !loading) {
      handleSelectCustomer(filteredCustomers[0]);
    }
  }, [filteredCustomers.length, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload on customer change
  useEffect(() => {
    if (selectedCustomer) {
      loadCreditStatus(selectedCustomer.id);
      loadCustomerInvoices(selectedCustomer.id);
    }
  }, [selectedCustomer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetPaymentForm = () => {
    setPaymentMethod("Cash");
    setReferenceNumber("");
    setBankName("");
    setChequeDate(new Date().toISOString().split("T")[0]);
    setPaymentDate(new Date().toISOString().split("T")[0]);
    setRemarks("");
    setCardRefNumber("");
    setCardHolderName("");
    setSelectedPaymentCardId(null);
  };

  const handleStartPayment = useCallback(() => {
    setViewMode("documents");
    setActiveStep(0);
  }, []);

  const handleSelectInvoice = useCallback((doc: OutstandingInvoice) => {
    setSelectedInvoiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(doc.id)) {
        next.delete(doc.id);
      } else {
        next.add(doc.id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedInvoiceIds.size === outstandingInvoices.length) {
      setSelectedInvoiceIds(new Set());
    } else {
      setSelectedInvoiceIds(new Set(outstandingInvoices.map((d) => d.id)));
    }
  }, [outstandingInvoices, selectedInvoiceIds.size]);

  const allocateFIFO = useCallback((amount: number): PaymentLine[] => {
    const lines: PaymentLine[] = [];
    let remaining = amount;

    for (const inv of outstandingInvoices) {
      if (remaining <= 0) break;
      const allocate = Math.min(remaining, inv.balance_due);
      if (allocate > 0) {
        lines.push({
          id: `line-${lines.length}`,
          invoice: inv,
          allocated_amount: allocate,
        });
        remaining -= allocate;
      }
    }

    return lines;
  }, [outstandingInvoices]);

  const handleProceedToPayment = useCallback(async () => {
    if (!selectedCustomer) {
      showErrorToast("Please select a customer first");
      return;
    }

    if (useFIFO) {
      if (fifoAmount <= 0) {
        showErrorToast("Please enter a payment amount for FIFO allocation");
        return;
      }
      const lines = allocateFIFO(fifoAmount);
      if (lines.length === 0) {
        showErrorToast("No invoices available for allocation");
        return;
      }
      setPaymentLines(lines);
    } else {
      if (selectedInvoiceIds.size === 0) {
        showErrorToast("Please select at least one invoice");
        return;
      }
      const selectedDocs = outstandingInvoices.filter((d) => selectedInvoiceIds.has(d.id));
      const lines: PaymentLine[] = selectedDocs.map((inv, idx) => ({
        id: `line-${idx}`,
        invoice: inv,
        allocated_amount: inv.balance_due,
      }));
      setPaymentLines(lines);
    }

    // Auto-populate payment form from last payment suggestion
    if (lastPaymentSuggestion) {
      setPaymentMethod(lastPaymentSuggestion.payment_method);
      if (lastPaymentSuggestion.bank_name) {
        setBankName(lastPaymentSuggestion.bank_name);
      }
    }

    setViewMode("payment");
    setActiveStep(1);
  }, [useFIFO, fifoAmount, selectedInvoiceIds, outstandingInvoices, allocateFIFO, selectedCustomer, lastPaymentSuggestion]);

  const handleLineAmountChange = useCallback((lineId: string, amount: number) => {
    setPaymentLines((prev) =>
      prev.map((line) => {
        if (line.id === lineId) {
          const clampedAmount = Math.min(Math.max(0, amount), line.invoice.balance_due);
          return { ...line, allocated_amount: clampedAmount };
        }
        return line;
      })
    );
  }, []);

  const handleRemoveLine = useCallback((lineId: string) => {
    setPaymentLines((prev) => prev.filter((line) => line.id !== lineId));
  }, []);

  const handleProceedToReview = useCallback(() => {
    if (totalPaymentAmount <= 0) {
      showErrorToast("Total payment amount must be greater than 0");
      return;
    }

    if (paymentMethod === "Bank Transfer" && !referenceNumber) {
      showErrorToast("Please enter bank transfer reference number");
      return;
    }
    if (paymentMethod === "Cheque" && (!referenceNumber || !bankName)) {
      showErrorToast("Please enter cheque number and bank name");
      return;
    }
    if (paymentMethod === "Card" && !cardRefNumber) {
      showErrorToast("Please enter card reference number");
      return;
    }
    if (paymentMethod === "Card" && !selectedPaymentCardId) {
      showErrorToast("Please select a card type");
      return;
    }

    setViewMode("review");
    setActiveStep(2);
  }, [totalPaymentAmount, paymentMethod, referenceNumber, bankName, cardRefNumber]);

  const handlePostPayment = useCallback(async () => {
    if (!selectedCustomer || paymentLines.length === 0) return;

    // Calculate total from split payments
    const totalFromSplit = splitPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
    
    const confirmMessage = `Receive payment of Rs. ${fmtLKR(totalFromSplit)} from ${selectedCustomer.customer_name}?`;

    const confirmed = await confirmDialog.confirm({
      title: "Receive Payment",
      message: confirmMessage + " This action cannot be undone.",
      confirmText: "Confirm",
    });

    if (!confirmed) return;

    try {
      setSaving(true);
      setError(null);

      // Process each payment line (invoice)
      for (const line of paymentLines) {
        if (line.allocated_amount <= 0) continue;

        // Calculate proportional split for this invoice
        const totalAllocated = paymentLines.reduce((sum, l) => sum + l.allocated_amount, 0);
        const proportion = line.allocated_amount / totalAllocated;

        // Process each payment method proportionally
        for (const splitRow of splitPayments) {
          if (splitRow.amount <= 0) continue;

          const proportionalAmount = splitRow.amount * proportion;

          // Calculate service charge if applicable
          const cardDetails = splitRow.method === "card" && splitRow.card_id
            ? paymentCards.find((c: PaymentCard) => c.id === splitRow.card_id)
            : null;
          
          let paymentAmt = proportionalAmount;
          let serviceCharge = 0;

          if (cardDetails && (cardDetails.service_charge_percent || 0) > 0) {
            const pct = cardDetails.service_charge_percent;
            paymentAmt = Math.round((proportionalAmount / (1 + pct / 100)) * 100) / 100;
            serviceCharge = Math.round((proportionalAmount - paymentAmt) * 100) / 100;
          }

          // Determine the correct payment method string for backend
          let apiPaymentMethod = splitRow.method;
          if (splitRow.method === "card" && cardDetails) {
            const nameLower = cardDetails.card_name.toLowerCase();
            if (nameLower.includes("visa")) {
              apiPaymentMethod = "card_visa";
            } else if (nameLower.includes("master")) {
              apiPaymentMethod = "card_mastercard";
            } else if (nameLower.includes("amex") || nameLower.includes("american")) {
              apiPaymentMethod = "card_amex";
            } else {
              apiPaymentMethod = "card_visa"; // Fallback
            }
          }

          const payload = {
            invoice_id: line.invoice.id,
            payment_method: apiPaymentMethod,
            payment_amount: paymentAmt,
            payment_date: paymentDate,
            ...(splitRow.method === "cheque" && {
              cheque_number: splitRow.cheque_number,
              cheque_bank: splitRow.cheque_bank,
              cheque_date: splitRow.cheque_date,
            }),
            ...(splitRow.method === "card" && {
              card_ref_number: splitRow.card_ref_number,
              card_holder_name: splitRow.card_holder_name,
              payment_card_id: splitRow.card_id,
              service_charge_amount: serviceCharge,
            }),
            ...(splitRow.method === "bank_transfer" && {
              bank_transfer_ref: splitRow.bank_transfer_ref,
              bank_name: splitRow.bank_name,
            }),
            remarks: remarks || undefined,
          };

          await apiClient.post(`/sales/${line.invoice.id}/settle-payment`, payload);
        }
      }

      showSuccessToast(`Payment of Rs. ${fmtLKR(totalFromSplit)} received successfully!`);

      // Refresh data and reset
      await loadCreditStatus(selectedCustomer.id);
      await loadCustomerInvoices(selectedCustomer.id);
      setViewMode("overview");
      setActiveStep(0);
      setSelectedInvoiceIds(new Set());
      setPaymentLines([]);
      setSplitPayments([makeSplitRow("cash", 0)]);
      resetPaymentForm();
    } catch (err: unknown) {
      const msg = handleApiError(err, "Failed to post payment");
      setError(msg);
      showErrorToast(msg);
    } finally {
      setSaving(false);
    }
  }, [
    selectedCustomer,
    paymentLines,
    splitPayments,
    paymentDate,
    remarks,
    paymentCards,
    confirmDialog,
    loadCreditStatus,
    loadCustomerInvoices,
  ]);

  const handleBack = useCallback(() => {
    switch (viewMode) {
      case "documents":
        setViewMode("overview");
        setActiveStep(0);
        break;
      case "payment":
        setViewMode("documents");
        setActiveStep(0);
        break;
      case "review":
        setViewMode("payment");
        setActiveStep(1);
        break;
    }
  }, [viewMode]);

  const handleCancelPayment = useCallback(() => {
    setViewMode("overview");
    setActiveStep(0);
    setSelectedInvoiceIds(new Set());
    setPaymentLines([]);
    resetPaymentForm();
  }, []);

  // Credit usage percentage
  const getCreditUsage = (customer: Customer) => {
    const available = customer.left_credit_amount ?? customer.max_credit_limit;
    const used = customer.max_credit_limit - available;
    return customer.max_credit_limit > 0 ? (used / customer.max_credit_limit) * 100 : 0;
  };

  // ==================== MASTER PANEL ====================
  const masterPanel = (
    <SearchableList<Customer>
      items={filteredCustomers}
      isLoading={loading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search customers or invoices..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedCustomer}
      onSelectItem={handleSelectCustomer}
      emptyMessage="No customers found"
      width={300}
      listHeader={
        <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: "divider" }}>
          <Typography variant="caption" color="text.secondary">
            {filteredCustomers.length} customer{filteredCustomers.length !== 1 ? "s" : ""}
          </Typography>
        </Box>
      }
      renderItem={(customer, isSelected) => {
        const usage = getCreditUsage(customer);
        const outstanding = customer.max_credit_limit - (customer.left_credit_amount ?? customer.max_credit_limit);
        return (
          <SelectableListItem
            key={customer.id}
            id={customer.id}
            isSelected={isSelected}
            onClick={() => handleSelectCustomer(customer)}
            primaryText={
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{customer.customer_name}</span>
                </Box>
                {isSelected && (
                  <>
                    <Typography variant="caption" component="span">
                      {customer.company_name || customer.mobile_contact_number || "Individual"}
                    </Typography>
                    {customer.max_credit_limit > 0 && (
                      <>
                        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                          <Typography variant="caption">
                            Credit: {fmtLKR(customer.left_credit_amount ?? customer.max_credit_limit)} / {fmtLKR(customer.max_credit_limit)}
                          </Typography>
                        </Box>
                        <Box sx={{ mt: 0.5, width: "100%", height: 4, bgcolor: "grey.200", borderRadius: 1 }}>
                          <Box
                            sx={{
                              width: `${Math.min(usage, 100)}%`,
                              height: "100%",
                              bgcolor: usage > 80 ? "error.main" : usage > 50 ? "warning.main" : "success.main",
                              borderRadius: 1,
                            }}
                          />
                        </Box>
                        <Chip
                          label={`${customer.credit_days} days`}
                          size="small"
                          color="info"
                          sx={{ height: 18, fontSize: "0.65rem", mt: 0.5 }}
                        />
                      </>
                    )}
                    {outstanding > 0 && (
                      <Typography variant="caption" color="warning.main">
                        Outstanding: Rs. {fmtLKR(outstanding)}
                      </Typography>
                    )}
                  </>
                )}
              </Box>
            }
            secondaryText={
              !isSelected ? (
                <Box component="span">
                  <Typography variant="caption" display="block">
                    {customer.company_name || customer.mobile_contact_number || "Individual"}
                  </Typography>
                  {customer.max_credit_limit > 0 && (
                    <Box sx={{ mt: 0.5, width: "100%", height: 4, bgcolor: "grey.200", borderRadius: 1 }}>
                      <Box
                        sx={{
                          width: `${Math.min(usage, 100)}%`,
                          height: "100%",
                          bgcolor: usage > 80 ? "error.main" : usage > 50 ? "warning.main" : "success.main",
                          borderRadius: 1,
                        }}
                      />
                    </Box>
                  )}
                </Box>
              ) : undefined
            }
            statusChip={
              !isSelected && customer.max_credit_limit > 0
                ? { label: `${customer.credit_days}d`, color: "info" }
                : undefined
            }
          />
        );
      }}
    />
  );

  // ==================== RENDER: OVERVIEW ====================
  const renderOverview = () => (
    <Box sx={{ p: 2 }}>
      {/* Customer Info Card */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
          <PersonIcon sx={{ fontSize: 40, color: "primary.main" }} />
          <Box>
            <Typography variant="h5">{selectedCustomer?.customer_name}</Typography>
            {selectedCustomer?.company_name && (
              <Typography variant="body2" color="text.secondary">
                {selectedCustomer.company_name}
              </Typography>
            )}
            {selectedCustomer?.mobile_contact_number && (
              <Typography variant="caption" color="text.secondary">
                📱 {selectedCustomer.mobile_contact_number}
              </Typography>
            )}
          </Box>
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Credit Information */}
        {selectedCustomer && selectedCustomer.max_credit_limit > 0 && (
          <>
            <Typography variant="subtitle1" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <CreditCardIcon fontSize="small" />
              Credit Information
            </Typography>

            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={6} sm={3}>
                <Card variant="outlined">
                  <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">Credit Days</Typography>
                    <Typography variant="h5" color="primary.main">
                      {selectedCustomer?.credit_days || 0}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Card variant="outlined">
                  <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">Credit Limit</Typography>
                    <Typography variant="h6">
                      Rs. {fmtLKR(selectedCustomer?.max_credit_limit || 0)}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Card variant="outlined">
                  <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">Available</Typography>
                    <Typography variant="h6" color="success.main">
                      Rs. {fmtLKR(creditStatus?.available_credit || 0)}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Card variant="outlined" sx={{ bgcolor: "warning.light" }}>
                  <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                    <Typography variant="caption">Outstanding</Typography>
                    <Typography variant="h6" color="warning.dark">
                      Rs. {fmtLKR(creditStatus?.outstanding_credit || 0)}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>

            <Divider sx={{ my: 2 }} />
          </>
        )}

        {/* Outstanding Summary */}
        <Typography variant="subtitle1" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <AccountBalanceIcon fontSize="small" />
          Outstanding Summary
        </Typography>

        {loadingStatus ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Grid container spacing={2}>
            <Grid item xs={6} sm={3}>
              <Card variant="outlined">
                <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">Open Invoices</Typography>
                  <Typography variant="h5" color="primary.main">
                    {outstandingInvoices.length}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Card variant="outlined" sx={{ bgcolor: "warning.light" }}>
                <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                  <Typography variant="caption">Total Outstanding</Typography>
                  <Typography variant="h6" color="warning.dark">
                    Rs. {fmtLKR(totalOutstanding)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Card variant="outlined" sx={{ bgcolor: overdueInvoices.length > 0 ? "error.light" : "success.light" }}>
                <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                  <Typography variant="caption">Overdue Invoices</Typography>
                  <Typography variant="h5" color={overdueInvoices.length > 0 ? "error.dark" : "success.dark"}>
                    {overdueInvoices.length}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Card variant="outlined" sx={{ bgcolor: overdueInvoices.length > 0 ? "error.light" : "transparent" }}>
                <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                  <Typography variant="caption">Overdue Amount</Typography>
                  <Typography variant="h6" color={overdueInvoices.length > 0 ? "error.dark" : "text.secondary"}>
                    Rs. {fmtLKR(overdueInvoices.reduce((sum, d) => sum + d.balance_due, 0))}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}
      </Paper>

      {/* Outstanding Invoices Preview */}
      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle1" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <ReceiptIcon fontSize="small" />
          Outstanding Credit Invoices
        </Typography>

        {/* Filters Section */}
        <TFilterPanel>
          <TextField
            placeholder="Search invoice..."
            size="small"
            value={documentSearchQuery}
            onChange={(e) => setDocumentSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" color="action" />
                </InputAdornment>
              ),
            }}
            sx={{ minWidth: 250 }}
          />
          <Autocomplete
            options={[{ branch_code: "all", branch_name: "All Branches" }, ...branches]}
            getOptionLabel={(option) =>
              option.branch_code === "all"
                ? option.branch_name
                : `${option.branch_name} (${option.branch_code})`
            }
            value={branches.find(b => b.branch_code === selectedBranch) || { branch_code: "all", branch_name: "All Branches" }}
            onChange={(_, newValue) => setSelectedBranch(newValue?.branch_code || "all")}
            renderInput={(params) => (
              <TextField {...params} label="Filter by Branch" size="small" />
            )}
            sx={{ minWidth: 200 }}
            disableClearable
          />
        </TFilterPanel>

        <Divider sx={{ mb: 1 }} />

        {outstandingInvoices.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
            No outstanding credit invoices for this customer
          </Typography>
        ) : (
          <TableContainer sx={{ maxHeight: 350 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Invoice No.</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell>Due Date</TableCell>
                  <TableCell align="right">Total (Rs.)</TableCell>
                  <TableCell align="right">Paid (Rs.)</TableCell>
                  <TableCell align="right">Balance Due (Rs.)</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Branch</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {outstandingInvoices.map((inv) => (
                  <TableRow key={inv.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight="medium">{inv.invoice_no}</Typography>
                    </TableCell>
                    <TableCell>{new Date(inv.date).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Typography color={inv.is_overdue ? "error" : "text.primary"}>
                        {new Date(inv.due_date).toLocaleDateString()}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{fmtLKR(inv.total_amount)}</TableCell>
                    <TableCell align="right">{fmtLKR(inv.paid_amount)}</TableCell>
                    <TableCell align="right">
                      <Typography color="warning.main" fontWeight="bold">
                        {fmtLKR(inv.balance_due)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {inv.is_overdue ? (
                        <Chip
                          label={`${inv.days_overdue}d overdue`}
                          size="small"
                          color="error"
                          icon={<WarningIcon />}
                        />
                      ) : (
                        <Chip
                          label={inv.payment_status === "partial" ? "Partial" : "Unpaid"}
                          size="small"
                          color={inv.payment_status === "partial" ? "warning" : "error"}
                          variant="outlined"
                        />
                      )}
                    </TableCell>
                    <TableCell>{inv.branch_code}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Box>
  );

  // ==================== RENDER: DOCUMENT SELECTION (Step 1) ====================
  const renderDocumentsView = () => (
    <Box sx={{ p: 2 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={handleBack} sx={{ mb: 2 }}>
        Back to Overview
      </Button>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Select Invoices to Settle
        </Typography>

        {/* Branch Filter */}
        <Autocomplete
          options={[{ branch_code: "all", branch_name: "All Branches" }, ...branches]}
          getOptionLabel={(option) =>
            option.branch_code === "all"
              ? option.branch_name
              : `${option.branch_name} (${option.branch_code})`
          }
          value={branches.find(b => b.branch_code === selectedBranch) || { branch_code: "all", branch_name: "All Branches" }}
          onChange={(_, newValue) => {
            setSelectedBranch(newValue?.branch_code || "all");
            setSelectedInvoiceIds(new Set());
          }}
          renderInput={(params) => (
            <TextField {...params} label="Filter by Branch" size="small" />
          )}
          sx={{ minWidth: 200, mb: 2 }}
          disableClearable
        />

        {/* FIFO Toggle */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
          <FormControlLabel
            control={
              <Switch
                checked={useFIFO}
                onChange={(e) => {
                  setUseFIFO(e.target.checked);
                  setSelectedInvoiceIds(new Set());
                }}
              />
            }
            label="Use FIFO Allocation"
          />
          {useFIFO && (
            <TextField
              label="Payment Amount"
              type="number"
              size="small"
              value={Number(fifoAmount)}
              onChange={(e) => setFifoAmount(Number(e.target.value))}
              InputProps={{
                startAdornment: <InputAdornment position="start">Rs.</InputAdornment>,
              }}
              sx={{ width: 200 }}
            />
          )}
        </Box>

        <Divider sx={{ mb: 2 }} />

        {!useFIFO && (
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={selectedInvoiceIds.size === outstandingInvoices.length && outstandingInvoices.length > 0}
                  indeterminate={selectedInvoiceIds.size > 0 && selectedInvoiceIds.size < outstandingInvoices.length}
                  onChange={handleSelectAll}
                  disabled={outstandingInvoices.length === 0}
                />
              }
              label="Select All"
            />
            <Typography variant="body2" color="text.secondary">
              {selectedInvoiceIds.size} of {outstandingInvoices.length} selected
            </Typography>
          </Box>
        )}

        {outstandingInvoices.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            No outstanding invoices available for payment.
          </Typography>
        ) : (
          <TableContainer sx={{ maxHeight: 400 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {!useFIFO && <TableCell padding="checkbox" />}
                  <TableCell>Invoice No.</TableCell>
                  <TableCell>Due Date</TableCell>
                  <TableCell align="right">Credit Amount</TableCell>
                  <TableCell align="right">Balance Due</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {outstandingInvoices.map((inv) => (
                  <TableRow
                    key={inv.id}
                    hover
                    selected={selectedInvoiceIds.has(inv.id)}
                    onClick={() => !useFIFO && handleSelectInvoice(inv)}
                    sx={{ cursor: useFIFO ? "default" : "pointer" }}
                  >
                    {!useFIFO && (
                      <TableCell padding="checkbox">
                        <Checkbox checked={selectedInvoiceIds.has(inv.id)} />
                      </TableCell>
                    )}
                    <TableCell>
                      <Typography variant="body2" fontWeight="medium">{inv.invoice_no}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography color={inv.is_overdue ? "error" : "text.primary"}>
                        {new Date(inv.due_date).toLocaleDateString()}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" color="text.secondary">
                        Rs. {fmtLKR(inv.credit_amount)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography fontWeight="bold">
                        Rs. {fmtLKR(inv.balance_due)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {inv.is_overdue ? (
                        <Chip label={`${inv.days_overdue}d overdue`} size="small" color="error" />
                      ) : (
                        <Chip
                          label={inv.payment_status === "partial" ? "Partial" : "Unpaid"}
                          size="small"
                          color={inv.payment_status === "partial" ? "warning" : "error"}
                          variant="outlined"
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {/* Summary */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography variant="subtitle1">
            {useFIFO
              ? `FIFO Amount: Rs. ${fmtLKR(fifoAmount)}`
              : `Selected: ${selectedInvoiceIds.size} invoices`}
          </Typography>
          <Typography variant="h6" color="primary.main">
            {useFIFO
              ? `Will allocate to ${allocateFIFO(fifoAmount).length} invoice(s)`
              : `Total: Rs. ${fmtLKR(outstandingInvoices
                .filter((d) => selectedInvoiceIds.has(d.id))
                .reduce((sum, d) => sum + d.balance_due, 0))}`}
          </Typography>
        </Box>
      </Paper>

      {/* Actions */}
      <Box sx={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
        <Button variant="outlined" onClick={handleCancelPayment}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleProceedToPayment}
          disabled={!useFIFO && selectedInvoiceIds.size === 0}
        >
          Continue to Payment
        </Button>
      </Box>
    </Box>
  );

  // ==================== RENDER: PAYMENT DETAILS (Step 2) ====================
  const renderPaymentView = () => (
    <Box sx={{ p: 2 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={handleBack} sx={{ mb: 2 }}>
        Back to Invoice Selection
      </Button>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Payment Allocations */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Payment Allocations
        </Typography>

        <Divider sx={{ mb: 2 }} />

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Invoice No.</TableCell>
                <TableCell>Due Date</TableCell>
                <TableCell align="right">Balance Due</TableCell>
                <TableCell align="right" sx={{ width: 150 }}>Payment Amount</TableCell>
                <TableCell sx={{ width: 50 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {paymentLines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <Typography variant="body2" fontWeight="medium">{line.invoice.invoice_no}</Typography>
                  </TableCell>
                  <TableCell>
                    {new Date(line.invoice.due_date).toLocaleDateString()}
                    {line.invoice.is_overdue && (
                      <Chip label="Overdue" size="small" color="error" sx={{ ml: 1, height: 18, fontSize: "0.6rem" }} />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {fmtLKR(line.invoice.balance_due)}
                  </TableCell>
                  <TableCell align="right">
                    <TextField
                      type="number"
                      size="small"
                      value={Number(line.allocated_amount)}
                      onChange={(e) => handleLineAmountChange(line.id, Number(e.target.value))}
                      InputProps={{
                        startAdornment: <InputAdornment position="start">Rs.</InputAdornment>,
                      }}
                      inputProps={{
                        min: 0,
                        max: line.invoice.balance_due,
                        step: 0.01,
                      }}
                      sx={{ width: 130 }}
                    />
                  </TableCell>
                  <TableCell>
                    <IconButton size="small" color="error" onClick={() => handleRemoveLine(line.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {/* Totals Row */}
              <TableRow sx={{ bgcolor: "action.hover" }}>
                <TableCell colSpan={2} />
                <TableCell align="right">
                  <Typography variant="subtitle2" fontWeight="bold">Total:</Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography variant="h6" fontWeight="bold" color="primary.main">
                    Rs. {fmtLKR(totalPaymentAmount)}
                  </Typography>
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Split Payment Section */}
      <FormSection title="Payment Details" columns={1}>
        <Box>
          {/* Global Payment Date Field */}
          <Box sx={{ mb: 3, maxWidth: 250 }}>
            <TextField
              label="Payment Date *"
              size="small"
              fullWidth
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              required
            />
          </Box>

          {splitPayments.map((row, idx) => (
            <Box
              key={row.id}
              sx={{
                mb: 2,
                p: 1.5,
                bgcolor: "grey.50",
                borderRadius: 1,
                border: "1px solid",
                borderColor: "divider",
              }}
            >
              {/* Row header */}
              <Box sx={{ display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 20 }}>
                  #{idx + 1}
                </Typography>
                <TextField
                  select
                  size="small"
                  label="Method"
                  value={row.method}
                  onChange={(e) => updateSplitRow(row.id, { method: e.target.value })}
                  sx={{ minWidth: 160 }}
                >
                  {PAYMENT_METHODS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  size="small"
                  type="number"
                  label="Amount (Rs.) *"
                  value={row.amount}
                  onChange={(e) => updateSplitRow(row.id, { amount: Number(e.target.value) || 0 })}
                  sx={{ width: 160 }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">Rs.</InputAdornment>
                    ),
                  }}
                  inputProps={{ min: 0, step: 0.01 }}
                />
                {splitPayments.length > 1 && (
                  <Tooltip title="Remove this payment">
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => removeSplitRow(row.id)}
                    >
                      <RemoveCircleOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>

              {/* Cheque fields */}
              {row.method === "cheque" && (
                <Box sx={{ display: "flex", gap: 1.5, mt: 1.5, flexWrap: "wrap" }}>
                  <TextField
                    label="Cheque Number *"
                    size="small"
                    value={row.cheque_number}
                    onChange={(e) => updateSplitRow(row.id, { cheque_number: e.target.value.replace(/\D/g, "") })}
                    inputProps={{ inputMode: "numeric" }}
                    sx={{ width: 150 }}
                    required
                  />
                  <Autocomplete
                    freeSolo
                    options={previousBankNames}
                    value={row.cheque_bank}
                    onInputChange={(_, newValue) => updateSplitRow(row.id, { cheque_bank: newValue })}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Bank Name *"
                        size="small"
                        required
                        helperText={
                          previousBankNames.length > 0
                            ? "Previously used banks shown"
                            : undefined
                        }
                      />
                    )}
                    sx={{ width: 220 }}
                  />
                  <TextField
                    label="Cheque Date"
                    size="small"
                    type="date"
                    value={row.cheque_date}
                    onChange={(e) => updateSplitRow(row.id, { cheque_date: e.target.value })}
                    InputLabelProps={{ shrink: true }}
                    sx={{ width: 160 }}
                  />
                </Box>
              )}

              {/* Bank Transfer fields */}
              {row.method === "bank_transfer" && (
                <Box sx={{ display: "flex", gap: 1.5, mt: 1.5, flexWrap: "wrap" }}>
                  <TextField
                    label="Reference Number *"
                    size="small"
                    value={row.bank_transfer_ref}
                    onChange={(e) => updateSplitRow(row.id, { bank_transfer_ref: e.target.value })}
                    sx={{ width: 200 }}
                    required
                  />
                  <Autocomplete
                    freeSolo
                    options={previousBankNames}
                    value={row.bank_name}
                    onInputChange={(_, newValue) => updateSplitRow(row.id, { bank_name: newValue })}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Bank Name"
                        size="small"
                        helperText={
                          previousBankNames.length > 0
                            ? "Previously used banks shown"
                            : undefined
                        }
                      />
                    )}
                    sx={{ width: 220 }}
                  />
                </Box>
              )}

              {/* Card fields */}
              {row.method === "card" && (
                <Box sx={{ display: "flex", gap: 1.5, mt: 1.5, flexWrap: "wrap", alignItems: "center" }}>
                  <TextField
                    select
                    size="small"
                    label="Card Type *"
                    value={row.card_id || ""}
                    onChange={(e) => updateSplitRow(row.id, { card_id: Number(e.target.value) })}
                    sx={{ minWidth: 200 }}
                    required
                  >
                    <MenuItem value="" disabled>
                      Select card
                    </MenuItem>
                    {paymentCards.map((card: PaymentCard) => (
                      <MenuItem key={card.id} value={card.id}>
                        {card.card_name} ({card.card_type})
                        {(card.service_charge_percent || 0) > 0 &&
                          ` — ${card.service_charge_percent}% fee`}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label="Card Reference Number *"
                    size="small"
                    value={row.card_ref_number}
                    onChange={(e) => updateSplitRow(row.id, { card_ref_number: e.target.value })}
                    sx={{ width: 200 }}
                    required
                  />
                  <TextField
                    label="Card Holder Name"
                    size="small"
                    value={row.card_holder_name}
                    onChange={(e) => updateSplitRow(row.id, { card_holder_name: e.target.value })}
                    sx={{ width: 180 }}
                  />
                  {row.card_id && (() => {
                    const card = paymentCards.find((c: PaymentCard) => c.id === row.card_id);
                    return card && (card.service_charge_percent || 0) > 0 ? (
                      <Box sx={{ p: 1, bgcolor: "warning.lighter", borderRadius: 1, alignSelf: "center" }}>
                        <Typography variant="caption" color="warning.dark">
                          {card.service_charge_percent}% service charge applies
                        </Typography>
                      </Box>
                    ) : null;
                  })()}
                </Box>
              )}
            </Box>
          ))}

          {/* Add Payment Button */}
          <Button
            variant="outlined"
            size="small"
            startIcon={<PaymentIcon />}
            onClick={addSplitRow}
            sx={{ mt: 1 }}
          >
            Add Payment Method
          </Button>

          {/* Payment Balance Indicator */}
          {(() => {
            const totalAllocated = paymentLines.reduce(
              (sum, line) => sum + line.allocated_amount,
              0
            );
            const entered = splitPayments.reduce((s, p) => s + (p.amount || 0), 0);
            
            // If card with service charge is present, apply service charge rate on the remaining card portion
            const selectedCard = splitPayments
              .filter((p) => p.method === "card" && p.card_id)
              .map((p) => paymentCards.find((c: PaymentCard) => c.id === p.card_id))
              .find((c) => c !== undefined) || null;
            
            const cardServiceChargePercent = selectedCard?.service_charge_percent || 0;
            
            // Calculate service charge based on card method
            const nonCardTotal = splitPayments
              .filter((p) => p.method !== "card")
              .reduce((s, p) => s + (p.amount || 0), 0);
            
            const cardBase = Math.max(0, totalAllocated - nonCardTotal);
            const totalServiceCharge =
              cardServiceChargePercent > 0
                ? Math.round(cardBase * cardServiceChargePercent) / 100
                : 0;

            const grandTotal = totalAllocated + totalServiceCharge;
            const remaining = grandTotal - entered;
            const isBalanced = Math.abs(remaining) < 0.01;

            return (
              <Box sx={{ mt: 2 }}>
                <Divider sx={{ mb: 1.5 }} />
                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                  <Typography variant="body2" color="text.secondary">Total Entered:</Typography>
                  <Typography variant="body2" fontWeight="bold" color={isBalanced ? "success.main" : "warning.main"}>
                    Rs. {fmtLKR(entered)}
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="body2" color="text.secondary">Remaining:</Typography>
                  <Typography variant="body2" fontWeight="bold" color={isBalanced ? "success.main" : "error.main"}>
                    {remaining > 0.01 ? `Rs. ${fmtLKR(remaining)}` : remaining < -0.01 ? `- Rs. ${fmtLKR(Math.abs(remaining))} (overpaid)` : "✓ Fully paid"}
                  </Typography>
                </Box>
                {!isBalanced && (
                  <Button
                    size="small"
                    variant="text"
                    color="primary"
                    sx={{ mt: 0.5, p: 0 }}
                    onClick={() => {
                      if (splitPayments.length === 1) {
                        updateSplitRow(splitPayments[0].id, { amount: grandTotal });
                      } else {
                        const lastRow = splitPayments[splitPayments.length - 1];
                        const otherTotal = splitPayments
                          .slice(0, -1)
                          .reduce((s, p) => s + (p.amount || 0), 0);
                        updateSplitRow(lastRow.id, {
                          amount: Math.max(0, grandTotal - otherTotal),
                        });
                      }
                    }}
                  >
                    Auto-fill remaining to last row
                  </Button>
                )}

                {/* Service Charge Display - separate box like in sales */}
                {totalServiceCharge > 0 && (
                  <Box
                    sx={{
                      mt: 1.5,
                      p: 1.5,
                      bgcolor: "info.50",
                      borderRadius: 1,
                      border: "1px solid",
                      borderColor: "info.main",
                    }}
                  >
                    <Typography variant="body2" fontWeight="bold" color="info.dark">
                      Service Charge ({cardServiceChargePercent}%): + Rs.{" "}
                      {fmtLKR(totalServiceCharge)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Applied to card payment amount of Rs. {fmtLKR(cardBase)}
                    </Typography>
                  </Box>
                )}
              </Box>
            );
          })()}
        </Box>
      </FormSection>

      <FormSection title="Remarks" columns={1}>
        <TextField
          label="Remarks"
          size="small"
          multiline
          rows={2}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
        />
      </FormSection>

      {/* Actions */}
      <Box sx={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
        <Button variant="outlined" onClick={handleCancelPayment}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleProceedToReview}>
          Review Payment
        </Button>
      </Box>
    </Box>
  );

  // ==================== RENDER: REVIEW & POST (Step 3) ====================
  const renderReviewView = () => {
    const totalPaymentFromSplit = splitPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
    
    return (
      <Box sx={{ p: 2 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={handleBack} sx={{ mb: 2 }}>
          Back to Payment Details
        </Button>

        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {/* Payment Info */}
        <Paper sx={{ p: 2, mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Payment Summary
          </Typography>
          <Divider sx={{ mb: 2 }} />

          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Typography variant="caption" color="text.secondary">Customer</Typography>
              <Typography variant="body1">{selectedCustomer?.customer_name}</Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="caption" color="text.secondary">Payment Date</Typography>
              <Typography variant="body1">{new Date(paymentDate).toLocaleDateString()}</Typography>
            </Grid>
            <Grid item xs={12}>
              <Typography variant="caption" color="text.secondary">
                Payment Methods
              </Typography>
              {splitPayments.map((row, idx) => (
                <Box key={row.id} sx={{ mt: 1, p: 1, bgcolor: "grey.50", borderRadius: 1 }}>
                  <Typography variant="body2">
                    <strong>
                      {PAYMENT_METHODS.find((m) => m.value === row.method)?.label ||
                        row.method}
                      :
                    </strong>{" "}
                    Rs. {fmtLKR(row.amount)}
                  </Typography>
                  {row.method === "cheque" && row.cheque_number && (
                    <Typography variant="caption" color="text.secondary">
                      Cheque #{row.cheque_number}, Bank: {row.cheque_bank}, Date:{" "}
                      {new Date(row.cheque_date).toLocaleDateString()}
                    </Typography>
                  )}
                  {row.method === "card" && (
                    (() => {
                      const card = paymentCards.find((c: PaymentCard) => c.id === row.card_id);
                      const pct = card?.service_charge_percent || 0;
                      if (pct > 0) {
                        const baseAmt = Math.round((row.amount / (1 + pct / 100)) * 100) / 100;
                        const scAmt = Math.round((row.amount - baseAmt) * 100) / 100;
                        return (
                          <Typography variant="caption" color="text.secondary" display="block">
                            Card Ref: {row.card_ref_number}
                            {row.card_holder_name && `, Holder: ${row.card_holder_name}`}
                            {` | Base: Rs. ${fmtLKR(baseAmt)} | Fee (${pct}%): Rs. ${fmtLKR(scAmt)}`}
                          </Typography>
                        );
                      }
                      return (
                        <Typography variant="caption" color="text.secondary" display="block">
                          Card Ref: {row.card_ref_number}
                          {row.card_holder_name && `, Holder: ${row.card_holder_name}`}
                        </Typography>
                      );
                    })()
                  )}
                  {row.method === "bank_transfer" && row.bank_transfer_ref && (
                    <Typography variant="caption" color="text.secondary">
                      Ref: {row.bank_transfer_ref}
                      {row.bank_name && `, Bank: ${row.bank_name}`}
                    </Typography>
                  )}
                </Box>
              ))}

              {/* Service Charge Display - like in sales orders */}
              {(() => {
                let totalCardAmountInclusive = 0;
                let totalCardAmountBase = 0;
                let cardServiceChargePercent = 0;
                
                splitPayments
                  .filter((p) => p.method === "card")
                  .forEach((p) => {
                    const card = paymentCards.find((c: PaymentCard) => c.id === p.card_id);
                    const pct = card?.service_charge_percent || 0;
                    totalCardAmountInclusive += p.amount || 0;
                    totalCardAmountBase += Math.round(((p.amount || 0) / (1 + pct / 100)) * 100) / 100;
                    if (pct > cardServiceChargePercent) {
                      cardServiceChargePercent = pct;
                    }
                  });

                const totalServiceCharge = Math.round((totalCardAmountInclusive - totalCardAmountBase) * 100) / 100;

                if (totalServiceCharge > 0) {
                  return (
                    <Box
                      sx={{
                        mt: 1.5,
                        p: 1.5,
                        bgcolor: "info.50",
                        borderRadius: 1,
                        border: "1px solid",
                        borderColor: "info.main",
                      }}
                    >
                      <Typography variant="body2" fontWeight="bold" color="info.dark">
                        Service Charge ({cardServiceChargePercent}%): + Rs.{" "}
                        {fmtLKR(totalServiceCharge)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Applied to card payment base of Rs. {fmtLKR(totalCardAmountBase)} (Total swiped: Rs. {fmtLKR(totalCardAmountInclusive)})
                      </Typography>
                    </Box>
                  );
                }
                return null;
              })()}
            </Grid>
            {remarks && (
              <Grid item xs={12}>
                <Typography variant="caption" color="text.secondary">Remarks</Typography>
                <Typography variant="body1">{remarks}</Typography>
              </Grid>
            )}
          </Grid>
        </Paper>

        {/* Payment Lines */}
        <Paper sx={{ p: 2, mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Invoices Being Settled
          </Typography>
          <Divider sx={{ mb: 2 }} />

          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Invoice No.</TableCell>
                  <TableCell>Due Date</TableCell>
                  <TableCell align="right">Balance Due (Rs.)</TableCell>
                  <TableCell align="right">Payment (Rs.)</TableCell>
                  <TableCell align="right">Remaining After (Rs.)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {paymentLines.map((line) => {
                  const remainingAfter = line.invoice.balance_due - line.allocated_amount;
                  return (
                    <TableRow key={line.id}>
                      <TableCell>
                        <Typography variant="body2" fontWeight="medium">{line.invoice.invoice_no}</Typography>
                      </TableCell>
                      <TableCell>
                        {new Date(line.invoice.due_date).toLocaleDateString()}
                      </TableCell>
                      <TableCell align="right">
                        {fmtLKR(line.invoice.balance_due)}
                      </TableCell>
                      <TableCell align="right">
                        <Typography color="primary.main" fontWeight="bold">
                          {line.allocated_amount > 0 ? fmtLKR(line.allocated_amount) : "-"}
                        </Typography>
                      </TableCell>
                    <TableCell align="right">
                      <Typography color={remainingAfter > 0 ? "warning.main" : "success.main"}>
                        {fmtLKR(remainingAfter)}
                      </Typography>
                    </TableCell>
                  </TableRow>
                );
              })}
              {/* Totals Row */}
              <TableRow sx={{ bgcolor: "action.hover" }}>
                <TableCell colSpan={2} />
                <TableCell align="right">
                  <Typography variant="subtitle2" fontWeight="bold">Sub-Total:</Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography variant="h6" fontWeight="bold" color="text.primary">
                    Rs. {fmtLKR(basePaymentAmount)}
                  </Typography>
                </TableCell>
                <TableCell />
              </TableRow>
              {/* Service Charge Row */}
              {serviceChargeAmount > 0 && (
                <TableRow sx={{ bgcolor: "warning.lighter" }}>
                  <TableCell colSpan={2} />
                  <TableCell align="right">
                    <Typography variant="subtitle2" color="warning.dark">
                      Service Charge ({selectedPaymentCard?.service_charge_percent}%):
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="subtitle2" fontWeight="bold" color="warning.dark">
                      + Rs. {fmtLKR(serviceChargeAmount)}
                    </Typography>
                  </TableCell>
                  <TableCell />
                </TableRow>
              )}
              {/* Grand Total Row */}
              <TableRow sx={{ bgcolor: "action.hover" }}>
                <TableCell colSpan={2} />
                <TableCell align="right">
                  <Typography variant="subtitle2" fontWeight="bold">Total to Pay:</Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography variant="h5" fontWeight="bold" color="primary.main">
                    Rs. {fmtLKR(totalPaymentFromSplit)}
                  </Typography>
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Warning */}
      <Alert severity="warning" sx={{ mb: 3 }}>
        <Typography variant="body2">
          <strong>Important:</strong> Once posted, this payment cannot be edited or deleted.
          Please review all details carefully before proceeding.
        </Typography>
      </Alert>

      {/* Actions */}
      <Box sx={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
        <Button variant="outlined" onClick={handleCancelPayment}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="success"
          onClick={handlePostPayment}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} /> : <CheckCircleIcon />}
          size="large"
        >
          {saving ? "Posting..." : "POST PAYMENT"}
        </Button>
      </Box>
    </Box>
    );
  };

  // ==================== DETAIL PANEL ====================
  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Finance", href: "/finance" },
          { label: "Customer Payments", href: "/finance/customer-payments" },
          ...(selectedCustomer ? [{ label: selectedCustomer.customer_name }] : []),
          ...(viewMode !== "overview" ? [{ label: STEPS[activeStep] }] : []),
        ]}
        title={
          viewMode === "review"
            ? "Review & Post"
            : viewMode === "payment"
              ? "Payment Details"
              : viewMode === "documents"
                ? "Select Invoices"
                : selectedCustomer?.customer_name || ""
        }
        titleIcon={
          viewMode === "review" ? (
            <CheckCircleIcon color="success" />
          ) : viewMode === "payment" || viewMode === "documents" ? (
            <PaymentIcon color="primary" />
          ) : (
            <PersonIcon color="primary" />
          )
        }
        isCreating={false}
        noSelectionTitle="Select a Customer"
        chips={
          selectedCustomer && viewMode === "overview"
            ? [
              { label: `${outstandingInvoices.length} Open Invoices`, variant: "outlined" as const },
              ...(totalOutstanding > 0
                ? [{ label: `Rs. ${fmtLKR(totalOutstanding)} Outstanding`, color: "warning" as const }]
                : []),
            ]
            : viewMode !== "overview"
              ? [{ label: `Rs. ${fmtLKR(totalPaymentAmount)}`, color: "primary" as const }]
              : []
        }
      />

      {/* Action Toolbar - contextual actions based on view mode */}
      {selectedCustomer && viewMode === "overview" && (
        <ActionToolbar
          hasSelectedItem={!!selectedCustomer}
          isCreating={false}
          isEditing={false}
          isSaving={saving}
          isFormValid={false}
          onNew={handleStartPayment}
          endActions={
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button
                size="small"
                variant="outlined"
                color="secondary"
                startIcon={<AssessmentIcon />}
                onClick={() => navigate("/finance/customer-payments/report")}
              >
                Payment Report
              </Button>
            </Box>
          }
        />
      )}

      {/* Stepper for payment workflow */}
      {viewMode !== "overview" && (
        <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider" }}>
          <Stepper activeStep={activeStep} alternativeLabel>
            {STEPS.map((label, index) => (
              <Step key={label} completed={index < activeStep}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>
        </Box>
      )}

      <Box sx={{ flex: 1, overflow: "auto" }}>
        {!selectedCustomer ? (
          <Box sx={{ p: 2 }}>
            <EmptyState message="Select a customer from the list to view outstanding invoices and receive payments" />
          </Box>
        ) : viewMode === "overview" ? (
          renderOverview()
        ) : viewMode === "documents" ? (
          renderDocumentsView()
        ) : viewMode === "payment" ? (
          renderPaymentView()
        ) : (
          renderReviewView()
        )}
      </Box>

      <TConfirmDialog {...confirmDialog.dialogProps} />
    </Box>
  );

  return (
    <MasterDetailLayout
      title="Customer Payments"
      icon={<PaymentIcon />}
      onRefresh={loadCustomers}
      masterPanel={masterPanel}
      detailPanel={detailPanel}
    />
  );
}
