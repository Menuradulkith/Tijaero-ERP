/**
 * CustomerPaymentsPage - Unified Customer Payments (ERP Best Practice)
 *
 * Following standard ERP patterns, this unified page handles:
 * - Credit settlements (receive payment against credit invoices)
 * - Payment history tracking
 *
 * Workflow:
 * 1. Select customer → View all outstanding credit invoices
 * 2. Select invoice(s) to receive payment for
 * 3. Enter payment details (Cash, Bank Transfer, Cheque, Card)
 * 4. Review and post payment
 */

import { useState, useEffect, useMemo, useCallback } from "react";
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
import AssessmentIcon from "@mui/icons-material/Assessment";
import PrintIcon from "@mui/icons-material/Print";
import FilterListIcon from "@mui/icons-material/FilterList";
import ReceiptIcon from "@mui/icons-material/Receipt";
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
  EmptyState,
} from "@/components/tijaero";

import { customersApi, CustomerCreditSummary } from "@/modules/customers/api";
import { Customer } from "@/modules/customers/types";
import { salesApi } from "@/modules/sales/api";
import { Invoice } from "@/modules/sales/types";

import { useReferenceData } from "@/hooks";
import apiClient from "@/api/client";

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
  { value: "Cash", label: "Cash" },
  { value: "Bank Transfer", label: "Bank Transfer" },
  { value: "Cheque", label: "Cheque" },
  { value: "card_visa", label: "Card (Visa)" },
  { value: "card_mastercard", label: "Card (Mastercard)" },
];

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
type ViewMode = "overview" | "documents" | "payment" | "review" | "history";

export default function CustomerPaymentsPage() {
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

  // Payment form
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [chequeDate, setChequeDate] = useState(new Date().toISOString().split("T")[0]);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [remarks, setRemarks] = useState("");
  const [cardRefNumber, setCardRefNumber] = useState("");
  const [cardHolderName, setCardHolderName] = useState("");

  // FIFO mode
  const [useFIFO, setUseFIFO] = useState(false);
  const [fifoAmount, setFifoAmount] = useState(0);

  // Payment history state
  const [paymentHistory, setPaymentHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);



  const confirmDialog = useConfirmDialog();

  // Load customers
  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await customersApi.getAll();
      // Only show active customers with credit limits
      setCustomers(data.filter((c: Customer) => c.active));
    } catch (err: unknown) {
      setError(handleApiError(err, "Failed to load customers"));
    } finally {
      setLoading(false);
    }
  }, []);

  // Load credit status for selected customer
  const loadCreditStatus = useCallback(async (customerId: number) => {
    try {
      setLoadingStatus(true);
      const status = await customersApi.getCreditSummary(customerId);
      setCreditStatus(status);
    } catch (err) {
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
    } catch (err) {
      setCustomerInvoices([]);
    }
  }, []);

  // Load payment history (credit settlements)
  const loadPaymentHistory = useCallback(async (customerId: number) => {
    try {
      setLoadingHistory(true);
      const settlements = await customersApi.getCreditSettlements(customerId);

      // Fetch full details for each settlement
      const settlementsWithDetails = await Promise.all(
        (settlements || []).map(async (s) => {
          try {
            const full = await customersApi.getCreditSettlement(customerId, s.id);
            const totalAmount = full.transactions?.reduce((sum, t) => sum + (t.payment_amount || 0), 0) || 0;
            const invoiceNos = [...new Set(full.transactions?.map(t => `INV-${t.invoice_id}`).filter(Boolean))].join(", ");
            const methods = [...new Set(full.transactions?.map(t => t.payment_method).filter(Boolean))].join(", ");

            return {
              type: "credit_settlement",
              id: s.id,
              settle_no: s.customer_credits_settle_no,
              date: s.created_date,
              total_amount: totalAmount,
              invoice_ref: invoiceNos || undefined,
              payment_method: methods || undefined,
              transactions: full.transactions || [],
              branch_code: s.branch_code,
            };
          } catch (err) {
            return {
              type: "credit_settlement",
              id: s.id,
              settle_no: s.customer_credits_settle_no,
              date: s.created_date,
              total_amount: 0,
              transactions: [],
              branch_code: s.branch_code,
            };
          }
        })
      );

      // Sort by date descending
      settlementsWithDetails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setPaymentHistory(settlementsWithDetails);
    } catch (err) {
      setPaymentHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }, []);



  // Transform invoices to outstanding documents
  const outstandingInvoices = useMemo((): OutstandingInvoice[] => {
    const docs: OutstandingInvoice[] = [];

    customerInvoices.forEach((inv) => {
      // Only show credit invoices with outstanding balance
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

    // Filter by branch
    if (selectedBranch !== "all") {
      filtered = filtered.filter((d) => d.branch_code === selectedBranch);
    }

    // Filter by document search
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

  const totalPaymentAmount = useMemo(() => {
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
        c.mobile_contact_number?.includes(query)
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
    setPaymentHistory([]);
    // Load data
    loadCreditStatus(customer.id);
    loadCustomerInvoices(customer.id);
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

    setViewMode("payment");
    setActiveStep(1);
  }, [useFIFO, fifoAmount, selectedInvoiceIds, outstandingInvoices, allocateFIFO, selectedCustomer]);

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
    if ((paymentMethod === "card_visa" || paymentMethod === "card_mastercard") && !cardRefNumber) {
      showErrorToast("Please enter card reference number");
      return;
    }

    setViewMode("review");
    setActiveStep(2);
  }, [totalPaymentAmount, paymentMethod, referenceNumber, bankName, cardRefNumber]);

  const handlePostPayment = useCallback(async () => {
    if (!selectedCustomer || paymentLines.length === 0) return;

    const confirmed = await confirmDialog.confirm({
      title: "Receive Payment",
      message: `Receive payment of Rs. ${fmtLKR(totalPaymentAmount)} from ${selectedCustomer.customer_name}? This action cannot be undone.`,
      confirmText: "Confirm",
    });

    if (!confirmed) return;

    try {
      setSaving(true);
      setError(null);

      // Use the sales settle-payment endpoint for each invoice
      for (const line of paymentLines) {
        if (line.allocated_amount <= 0) continue;

        const payload = {
          invoice_id: line.invoice.id,
          payment_method: paymentMethod,
          payment_amount: line.allocated_amount,
          payment_date: paymentDate,
          // Cheque details
          ...(paymentMethod === "Cheque" && {
            cheque_number: referenceNumber,
            cheque_bank: bankName,
            cheque_date: chequeDate,
          }),
          // Card details
          ...((paymentMethod === "card_visa" || paymentMethod === "card_mastercard") && {
            card_ref_number: cardRefNumber,
            card_holder_name: cardHolderName,
          }),
          // Bank transfer details
          ...(paymentMethod === "Bank Transfer" && {
            bank_transfer_ref: referenceNumber,
            bank_name: bankName,
          }),
          remarks: remarks || undefined,
        };

        await apiClient.post(`/sales/${line.invoice.id}/settle-payment`, payload);
      }

      showSuccessToast(`Payment of Rs. ${fmtLKR(totalPaymentAmount)} received from ${selectedCustomer.customer_name}`);

      // Refresh data and reset
      await loadCreditStatus(selectedCustomer.id);
      await loadCustomerInvoices(selectedCustomer.id);
      setViewMode("overview");
      setActiveStep(0);
      setSelectedInvoiceIds(new Set());
      setPaymentLines([]);
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
    totalPaymentAmount,
    paymentMethod,
    referenceNumber,
    bankName,
    chequeDate,
    paymentDate,
    remarks,
    cardRefNumber,
    cardHolderName,
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
      case "history":
        setViewMode("overview");
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
      placeholder="Search customers..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedCustomer}
      onSelectItem={handleSelectCustomer}
      emptyMessage="No customers found"
      width={300}
      listHeader={
        <TFilterPanel>
          <Typography variant="caption" color="text.secondary">
            {filteredCustomers.length} customer{filteredCustomers.length !== 1 ? "s" : ""}
          </Typography>
        </TFilterPanel>
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
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography variant="caption" component="span">
                        {customer.company_name || customer.mobile_contact_number || "Individual"}
                      </Typography>
                      <Typography variant="caption" color="text.disabled">(Customer)</Typography>
                    </Box>
                    {customer.max_credit_limit > 0 && (
                      <>
                        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <Typography variant="caption">
                            Credit: {fmtLKR(customer.left_credit_amount ?? customer.max_credit_limit)} / {fmtLKR(customer.max_credit_limit)}
                          </Typography>
                          <Typography variant="caption" color="text.disabled">(Credit)</Typography>
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
                      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <Typography variant="caption" color="warning.main">
                          Outstanding: Rs. {fmtLKR(outstanding)}
                        </Typography>
                        <Typography variant="caption" color="text.disabled">(Outstanding)</Typography>
                      </Box>
                    )}
                  </>
                )}
              </Box>
            }
            secondaryText={
              !isSelected
                ? customer.company_name || customer.mobile_contact_number || "Individual"
                : undefined
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

  // ==================== PAYMENT HISTORY ====================
  // History filter state
  const [historyDateFrom, setHistoryDateFrom] = useState<string>(() => {
    const date = new Date();
    date.setMonth(date.getMonth() - 3);
    return date.toISOString().split("T")[0];
  });
  const [historyDateTo, setHistoryDateTo] = useState<string>(new Date().toISOString().split("T")[0]);
  const [historyBranchFilter, setHistoryBranchFilter] = useState<string>("all");

  // Filtered history
  const filteredPaymentHistory = useMemo(() => {
    return paymentHistory.filter((item) => {
      const itemDate = new Date(item.date);
      const fromDate = historyDateFrom ? new Date(historyDateFrom) : null;
      const toDate = historyDateTo ? new Date(historyDateTo) : null;

      if (fromDate && itemDate < fromDate) return false;
      if (toDate) {
        const endOfDay = new Date(toDate);
        endOfDay.setHours(23, 59, 59, 999);
        if (itemDate > endOfDay) return false;
      }
      if (historyBranchFilter !== "all" && item.branch_code !== historyBranchFilter) return false;

      return true;
    });
  }, [paymentHistory, historyDateFrom, historyDateTo, historyBranchFilter]);

  // History summary
  const historySummary = useMemo(() => {
    const summary = {
      totalCount: filteredPaymentHistory.length,
      totalAmount: 0,
      byMethod: {} as Record<string, { count: number; amount: number }>,
      byBranch: {} as Record<string, { count: number; amount: number }>,
    };

    filteredPaymentHistory.forEach((item) => {
      const amount = Number(item.total_amount) || 0;
      summary.totalAmount += amount;

      // By payment method
      const method = item.payment_method || "Unknown";
      if (!summary.byMethod[method]) summary.byMethod[method] = { count: 0, amount: 0 };
      summary.byMethod[method].count++;
      summary.byMethod[method].amount += amount;

      // By branch
      const branch = item.branch_code || "Unknown";
      if (!summary.byBranch[branch]) summary.byBranch[branch] = { count: 0, amount: 0 };
      summary.byBranch[branch].count++;
      summary.byBranch[branch].amount += amount;
    });

    return summary;
  }, [filteredPaymentHistory]);

  // Print report
  const handlePrintPaymentHistory = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      showErrorToast("Please allow popups to print the report");
      return;
    }

    const dateRangeText = historyDateFrom && historyDateTo
      ? `${new Date(historyDateFrom).toLocaleDateString()} to ${new Date(historyDateTo).toLocaleDateString()}`
      : "All Time";

    const html = `<!DOCTYPE html><html><head><title>Customer Payment History Report</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; color: #333; max-width: 1100px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 30px; border-bottom: 3px solid #1976d2; padding-bottom: 20px; }
        .header h1 { margin: 0 0 5px 0; color: #1976d2; font-size: 24px; }
        .header h2 { margin: 0; font-weight: normal; color: #666; font-size: 18px; }
        .header .date-range { margin-top: 10px; font-size: 14px; color: #888; }
        .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 25px; }
        .summary-card { padding: 15px; border-radius: 8px; text-align: center; border: 1px solid #ddd; }
        .summary-card.primary { background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%); color: white; }
        .summary-card.success { background: linear-gradient(135deg, #2e7d32 0%, #1b5e20 100%); color: white; }
        .summary-card.info { background: linear-gradient(135deg, #0288d1 0%, #01579b 100%); color: white; }
        .summary-card .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.9; }
        .summary-card .value { font-size: 20px; font-weight: bold; margin-top: 5px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th, td { border: 1px solid #ddd; padding: 8px 10px; text-align: left; }
        th { background: #1976d2; color: white; font-weight: 600; text-transform: uppercase; font-size: 10px; }
        tr:nth-child(even) { background: #f9f9f9; }
        .text-right { text-align: right; }
        .totals-row { background: #f5f5f5 !important; font-weight: bold; }
        .footer { margin-top: 30px; padding-top: 15px; border-top: 1px solid #ddd; font-size: 11px; color: #888; text-align: center; }
      </style></head><body>
        <div class="header">
          <h1>Customer Payment History Report</h1>
          <h2>${selectedCustomer?.customer_name || "Unknown"}</h2>
          ${selectedCustomer?.company_name ? `<div style="color: #888; font-size: 14px;">${selectedCustomer.company_name}</div>` : ""}
          <div class="date-range">Report Period: ${dateRangeText}</div>
        </div>
        <div class="summary-grid">
          <div class="summary-card primary">
            <div class="label">Total Payments</div>
            <div class="value">Rs. ${fmtLKR(historySummary.totalAmount)}</div>
          </div>
          <div class="summary-card success">
            <div class="label">Transactions</div>
            <div class="value">${historySummary.totalCount}</div>
          </div>
          <div class="summary-card info">
            <div class="label">Outstanding</div>
            <div class="value">Rs. ${fmtLKR(creditStatus?.outstanding_credit || 0)}</div>
          </div>
        </div>
        <table>
          <thead><tr><th>Date</th><th>Settlement No.</th><th>Invoice(s)</th><th>Payment Method</th><th class="text-right">Amount (Rs.)</th><th>Branch</th></tr></thead>
          <tbody>
            ${filteredPaymentHistory.map((item) => `<tr>
              <td>${new Date(item.date).toLocaleDateString()}</td>
              <td>${item.settle_no || "-"}</td>
              <td>${item.invoice_ref || "-"}</td>
              <td>${item.payment_method || "-"}</td>
              <td class="text-right"><strong>${fmtLKR(item.total_amount)}</strong></td>
              <td>${item.branch_code || "-"}</td>
            </tr>`).join("")}
            <tr class="totals-row"><td colspan="4" style="text-align:right;">TOTAL:</td><td class="text-right">Rs. ${fmtLKR(historySummary.totalAmount)}</td><td></td></tr>
          </tbody>
        </table>
        <div class="footer"><p>Generated on ${new Date().toLocaleString()} | Tijaero ERP System</p></div>
        <script>window.onload = function() { window.print(); }</script>
      </body></html>`;

    printWindow.document.write(html);
    printWindow.document.close();
  };

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
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
          <Typography variant="subtitle1" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <ReceiptIcon fontSize="small" />
            Outstanding Credit Invoices
          </Typography>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button
              variant="outlined"
              color="info"
              startIcon={<AssessmentIcon />}
              onClick={() => {
                setViewMode("history");
                loadPaymentHistory(selectedCustomer!.id);
              }}
            >
              Payment History
            </Button>
            <Button
              variant="contained"
              color="primary"
              startIcon={<PaymentIcon />}
              onClick={handleStartPayment}
              disabled={outstandingInvoices.length === 0}
            >
              Receive Payment
            </Button>
          </Box>
        </Box>

        {/* Filters */}
        <Box sx={{ mb: 2, display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center" }}>
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
          <TextField
            select
            size="small"
            label="Branch"
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="all">All Branches</MenuItem>
            {branches.map((b) => (
              <MenuItem key={b.branch_code} value={b.branch_code}>{b.branch_name}</MenuItem>
            ))}
          </TextField>
        </Box>

        {/* Invoices Table */}
        {outstandingInvoices.length === 0 ? (
          <Box sx={{ textAlign: "center", py: 4 }}>
            <Typography variant="body1" color="text.secondary">
              No outstanding credit invoices
            </Typography>
          </Box>
        ) : (
          <TableContainer sx={{ maxHeight: 420 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Invoice No.</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell>Due Date</TableCell>
                  <TableCell align="right">Total</TableCell>
                  <TableCell align="right">Paid</TableCell>
                  <TableCell align="right">Balance Due</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Branch</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {outstandingInvoices.slice(0, 10).map((inv) => (
                  <TableRow key={inv.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight="medium">{inv.invoice_no}</Typography>
                    </TableCell>
                    <TableCell>{new Date(inv.date).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        {new Date(inv.due_date).toLocaleDateString()}
                        {inv.is_overdue && (
                          <Chip
                            label={`${inv.days_overdue}d overdue`}
                            size="small"
                            color="error"
                            sx={{ height: 18, fontSize: "0.65rem" }}
                          />
                        )}
                      </Box>
                    </TableCell>
                    <TableCell align="right">{fmtLKR(inv.total_amount)}</TableCell>
                    <TableCell align="right">{fmtLKR(inv.paid_amount)}</TableCell>
                    <TableCell align="right">
                      <Typography fontWeight="bold" color="warning.main">
                        {fmtLKR(inv.balance_due)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={inv.payment_status === "partial" ? "Partial" : "Unpaid"}
                        size="small"
                        color={inv.payment_status === "partial" ? "warning" : "error"}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>{inv.branch_code}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {outstandingInvoices.length > 10 && (
          <Box sx={{ textAlign: "center", py: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Showing 10 of {outstandingInvoices.length} invoices. Click "Receive Payment" to see all.
            </Typography>
          </Box>
        )}
      </Paper>
    </Box>
  );

  // ==================== RENDER: DOCUMENT SELECTION ====================
  const renderDocumentsView = () => (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography variant="h6" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <DescriptionIcon />
          Select Invoices to Settle
        </Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button variant="outlined" startIcon={<ArrowBackIcon />} onClick={handleCancelPayment}>
            Cancel
          </Button>
        </Box>
      </Box>

      {/* FIFO Toggle */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <FormControlLabel
          control={<Switch checked={useFIFO} onChange={(e) => setUseFIFO(e.target.checked)} />}
          label="FIFO Auto-Allocation"
        />
        {useFIFO && (
          <Box sx={{ mt: 1, display: "flex", gap: 2, alignItems: "center" }}>
            <TextField
              size="small"
              label="Payment Amount"
              type="number"
              value={Number(fifoAmount) || ""}
              onChange={(e) => setFifoAmount(Number(e.target.value))}
              InputProps={{
                startAdornment: <InputAdornment position="start">Rs.</InputAdornment>,
              }}
              sx={{ width: 250 }}
            />
            <Typography variant="body2" color="text.secondary">
              Will allocate to oldest invoices first
            </Typography>
          </Box>
        )}
      </Paper>

      {/* Invoice Selection Table */}
      <Paper>
        <TableContainer sx={{ maxHeight: 500 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {!useFIFO && (
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={selectedInvoiceIds.size === outstandingInvoices.length && outstandingInvoices.length > 0}
                      indeterminate={selectedInvoiceIds.size > 0 && selectedInvoiceIds.size < outstandingInvoices.length}
                      onChange={handleSelectAll}
                    />
                  </TableCell>
                )}
                <TableCell>Invoice No.</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Due Date</TableCell>
                <TableCell align="right">Credit Amount</TableCell>
                <TableCell align="right">Paid</TableCell>
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
                  <TableCell>{new Date(inv.date).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                      {new Date(inv.due_date).toLocaleDateString()}
                      {inv.is_overdue && (
                        <Chip label={`${inv.days_overdue}d`} size="small" color="error" sx={{ height: 18, fontSize: "0.6rem" }} />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell align="right">{fmtLKR(inv.credit_amount)}</TableCell>
                  <TableCell align="right">{fmtLKR(inv.paid_amount)}</TableCell>
                  <TableCell align="right">
                    <Typography fontWeight="bold" color="warning.main">{fmtLKR(inv.balance_due)}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={inv.payment_status === "partial" ? "Partial" : "Unpaid"}
                      size="small"
                      color={inv.payment_status === "partial" ? "warning" : "error"}
                      variant="outlined"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Footer */}
        <Box sx={{ p: 2, borderTop: 1, borderColor: "divider", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography variant="body2" color="text.secondary">
            {useFIFO ? "FIFO mode" : `${selectedInvoiceIds.size} of ${outstandingInvoices.length} selected`}
          </Typography>
          <Button
            variant="contained"
            onClick={handleProceedToPayment}
            disabled={!useFIFO && selectedInvoiceIds.size === 0}
          >
            Proceed to Payment
          </Button>
        </Box>
      </Paper>
    </Box>
  );

  // ==================== RENDER: PAYMENT DETAILS ====================
  const renderPaymentView = () => (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography variant="h6" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <PaymentIcon />
          Payment Details
        </Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button variant="outlined" startIcon={<ArrowBackIcon />} onClick={handleBack}>
            Back
          </Button>
          <Button variant="outlined" color="error" onClick={handleCancelPayment}>
            Cancel
          </Button>
        </Box>
      </Box>

      {/* Allocation Table */}
      <Paper sx={{ mb: 3 }}>
        <Typography variant="subtitle2" sx={{ p: 2, pb: 1 }}>
          Payment Allocation
        </Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Invoice No.</TableCell>
                <TableCell>Due Date</TableCell>
                <TableCell align="right">Balance Due</TableCell>
                <TableCell align="right" sx={{ minWidth: 180 }}>Payment Amount</TableCell>
                <TableCell width={60}>Remove</TableCell>
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
                  <TableCell align="right">{fmtLKR(line.invoice.balance_due)}</TableCell>
                  <TableCell align="right">
                    <TextField
                      size="small"
                      type="number"
                      value={Number(line.allocated_amount) || ""}
                      onChange={(e) => handleLineAmountChange(line.id, Number(e.target.value))}
                      InputProps={{
                        startAdornment: <InputAdornment position="start">Rs.</InputAdornment>,
                      }}
                      sx={{ width: 160 }}
                    />
                  </TableCell>
                  <TableCell>
                    <IconButton size="small" onClick={() => handleRemoveLine(line.id)}>
                      <DeleteIcon fontSize="small" color="error" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {/* Total row */}
              <TableRow sx={{ bgcolor: "grey.50" }}>
                <TableCell colSpan={3} align="right">
                  <Typography variant="subtitle2">Total Payment:</Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography variant="h6" color="primary.main" fontWeight="bold">
                    Rs. {fmtLKR(totalPaymentAmount)}
                  </Typography>
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Payment Method */}
      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Payment Method
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth
              select
              size="small"
              label="Payment Method"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              {PAYMENT_METHODS.map((m) => (
                <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth
              size="small"
              label="Payment Date"
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>

          {/* Cheque fields */}
          {paymentMethod === "Cheque" && (
            <>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  size="small"
                  label="Cheque Number *"
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  size="small"
                  label="Bank Name *"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  size="small"
                  label="Cheque Date"
                  type="date"
                  value={chequeDate}
                  onChange={(e) => setChequeDate(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
            </>
          )}

          {/* Bank Transfer fields */}
          {paymentMethod === "Bank Transfer" && (
            <>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  size="small"
                  label="Reference Number *"
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  size="small"
                  label="Bank Name"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                />
              </Grid>
            </>
          )}

          {/* Card fields */}
          {(paymentMethod === "card_visa" || paymentMethod === "card_mastercard") && (
            <>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  size="small"
                  label="Card Reference Number *"
                  value={cardRefNumber}
                  onChange={(e) => setCardRefNumber(e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  size="small"
                  label="Card Holder Name"
                  value={cardHolderName}
                  onChange={(e) => setCardHolderName(e.target.value)}
                />
              </Grid>
            </>
          )}

          <Grid item xs={12}>
            <TextField
              fullWidth
              size="small"
              label="Remarks"
              multiline
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </Grid>
        </Grid>

        <Box sx={{ mt: 2, display: "flex", justifyContent: "flex-end" }}>
          <Button variant="contained" onClick={handleProceedToReview} disabled={totalPaymentAmount <= 0}>
            Review Payment
          </Button>
        </Box>
      </Paper>
    </Box>
  );

  // ==================== RENDER: REVIEW ====================
  const renderReviewView = () => (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography variant="h6" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <CheckCircleIcon color="success" />
          Review & Post Payment
        </Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button variant="outlined" startIcon={<ArrowBackIcon />} onClick={handleBack}>
            Back
          </Button>
          <Button variant="outlined" color="error" onClick={handleCancelPayment}>
            Cancel
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Summary */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={4}>
          <TStatCard
            title="Customer"
            value={selectedCustomer?.customer_name || ""}
            subtitle={selectedCustomer?.company_name}
            icon={<PersonIcon />}
            color="primary"
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <TStatCard
            title="Payment Method"
            value={PAYMENT_METHODS.find((m) => m.value === paymentMethod)?.label || paymentMethod}
            subtitle={paymentDate}
            icon={<PaymentIcon />}
            color="info"
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <TStatCard
            title="Total Payment"
            value={`Rs. ${fmtLKR(totalPaymentAmount)}`}
            subtitle={`${paymentLines.length} invoice(s)`}
            icon={<AccountBalanceIcon />}
            color="success"
          />
        </Grid>
      </Grid>

      {/* Payment Lines */}
      <Paper sx={{ mb: 3 }}>
        <Typography variant="subtitle2" sx={{ p: 2, pb: 1 }}>
          Settlement Details
        </Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Invoice No.</TableCell>
                <TableCell>Due Date</TableCell>
                <TableCell align="right">Balance Due</TableCell>
                <TableCell align="right">Payment Amount</TableCell>
                <TableCell align="right">Remaining</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paymentLines.map((line) => {
                const remaining = line.invoice.balance_due - line.allocated_amount;
                return (
                  <TableRow key={line.id}>
                    <TableCell>
                      <Typography variant="body2" fontWeight="medium">{line.invoice.invoice_no}</Typography>
                    </TableCell>
                    <TableCell>{new Date(line.invoice.due_date).toLocaleDateString()}</TableCell>
                    <TableCell align="right">{fmtLKR(line.invoice.balance_due)}</TableCell>
                    <TableCell align="right">
                      <Typography fontWeight="bold" color="primary.main">
                        {fmtLKR(line.allocated_amount)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography color={remaining > 0 ? "warning.main" : "success.main"}>
                        {fmtLKR(remaining)}
                      </Typography>
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow sx={{ bgcolor: "grey.50" }}>
                <TableCell colSpan={3} align="right">
                  <Typography variant="subtitle2">Total:</Typography>
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

      {/* Payment Details Summary */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle2" gutterBottom>Payment Details</Typography>
        <Grid container spacing={2}>
          <Grid item xs={6} sm={3}>
            <Typography variant="caption" color="text.secondary">Payment Method</Typography>
            <Typography variant="body2" fontWeight="medium">
              {PAYMENT_METHODS.find((m) => m.value === paymentMethod)?.label || paymentMethod}
            </Typography>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Typography variant="caption" color="text.secondary">Payment Date</Typography>
            <Typography variant="body2" fontWeight="medium">
              {new Date(paymentDate).toLocaleDateString()}
            </Typography>
          </Grid>
          {referenceNumber && (
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">Reference</Typography>
              <Typography variant="body2" fontWeight="medium">{referenceNumber}</Typography>
            </Grid>
          )}
          {bankName && (
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">Bank</Typography>
              <Typography variant="body2" fontWeight="medium">{bankName}</Typography>
            </Grid>
          )}
          {cardRefNumber && (
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">Card Ref</Typography>
              <Typography variant="body2" fontWeight="medium">{cardRefNumber}</Typography>
            </Grid>
          )}
          {remarks && (
            <Grid item xs={12}>
              <Typography variant="caption" color="text.secondary">Remarks</Typography>
              <Typography variant="body2">{remarks}</Typography>
            </Grid>
          )}
        </Grid>
      </Paper>

      {/* Post Button */}
      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 2 }}>
        <Button variant="outlined" onClick={handleBack}>
          Back to Edit
        </Button>
        <Button
          variant="contained"
          color="success"
          size="large"
          startIcon={saving ? <CircularProgress size={20} color="inherit" /> : <CheckCircleIcon />}
          onClick={handlePostPayment}
          disabled={saving}
        >
          {saving ? "Posting..." : `Post Payment - Rs. ${fmtLKR(totalPaymentAmount)}`}
        </Button>
      </Box>
    </Box>
  );

  // ==================== RENDER: HISTORY ====================
  const renderHistory = () => (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h6" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <AssessmentIcon />
          Payment History
        </Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button variant="contained" startIcon={<PrintIcon />} onClick={handlePrintPaymentHistory} disabled={filteredPaymentHistory.length === 0}>
            Print Report
          </Button>
          <Button variant="outlined" startIcon={<ArrowBackIcon />} onClick={() => setViewMode("overview")}>
            Back
          </Button>
        </Box>
      </Box>

      {/* Summary Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={4}>
          <Card sx={{ background: "linear-gradient(135deg, #1976d2 0%, #1565c0 100%)", color: "white" }}>
            <CardContent sx={{ textAlign: "center", py: 2 }}>
              <Typography variant="caption" sx={{ opacity: 0.9, textTransform: "uppercase" }}>Total Payments</Typography>
              <Typography variant="h5" sx={{ fontWeight: "bold", mt: 0.5 }}>Rs. {fmtLKR(historySummary.totalAmount)}</Typography>
              <Typography variant="caption" sx={{ opacity: 0.8 }}>{historySummary.totalCount} Transaction{historySummary.totalCount !== 1 ? "s" : ""}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card sx={{ background: "linear-gradient(135deg, #2e7d32 0%, #1b5e20 100%)", color: "white" }}>
            <CardContent sx={{ textAlign: "center", py: 2 }}>
              <Typography variant="caption" sx={{ opacity: 0.9, textTransform: "uppercase" }}>Current Outstanding</Typography>
              <Typography variant="h5" sx={{ fontWeight: "bold", mt: 0.5 }}>Rs. {fmtLKR(creditStatus?.outstanding_credit || 0)}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card sx={{ background: "linear-gradient(135deg, #ed6c02 0%, #e65100 100%)", color: "white" }}>
            <CardContent sx={{ textAlign: "center", py: 2 }}>
              <Typography variant="caption" sx={{ opacity: 0.9, textTransform: "uppercase" }}>Overdue</Typography>
              <Typography variant="h5" sx={{ fontWeight: "bold", mt: 0.5 }}>Rs. {fmtLKR(creditStatus?.total_overdue_amount || 0)}</Typography>
              <Typography variant="caption" sx={{ opacity: 0.8 }}>{creditStatus?.overdue_count || 0} Invoice{(creditStatus?.overdue_count || 0) !== 1 ? "s" : ""}</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Breakdown */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <PaymentIcon fontSize="small" /> By Payment Method
            </Typography>
            <Divider sx={{ my: 1 }} />
            {Object.entries(historySummary.byMethod).length > 0 ? (
              Object.entries(historySummary.byMethod).map(([method, data]) => (
                <Box key={method} sx={{ display: "flex", justifyContent: "space-between", py: 0.5, borderBottom: "1px dotted #eee" }}>
                  <Typography variant="body2">{method}</Typography>
                  <Box sx={{ textAlign: "right" }}>
                    <Typography variant="body2" fontWeight="bold">Rs. {fmtLKR(data.amount)}</Typography>
                    <Typography variant="caption" color="text.secondary">{data.count} txn{data.count !== 1 ? "s" : ""}</Typography>
                  </Box>
                </Box>
              ))
            ) : (
              <Typography variant="body2" color="text.secondary">No data</Typography>
            )}
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <PersonIcon fontSize="small" /> By Branch
            </Typography>
            <Divider sx={{ my: 1 }} />
            {Object.entries(historySummary.byBranch).length > 0 ? (
              Object.entries(historySummary.byBranch).map(([branch, data]) => (
                <Box key={branch} sx={{ display: "flex", justifyContent: "space-between", py: 0.5, borderBottom: "1px dotted #eee" }}>
                  <Typography variant="body2">{branch}</Typography>
                  <Box sx={{ textAlign: "right" }}>
                    <Typography variant="body2" fontWeight="bold">Rs. {fmtLKR(data.amount)}</Typography>
                    <Typography variant="caption" color="text.secondary">{data.count} txn{data.count !== 1 ? "s" : ""}</Typography>
                  </Box>
                </Box>
              ))
            ) : (
              <Typography variant="body2" color="text.secondary">No data</Typography>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Filters */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <FilterListIcon fontSize="small" /> Filters
        </Typography>
        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid item xs={12} sm={4}>
            <TextField fullWidth size="small" label="Date From" type="date" value={historyDateFrom} onChange={(e) => setHistoryDateFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField fullWidth size="small" label="Date To" type="date" value={historyDateTo} onChange={(e) => setHistoryDateTo(e.target.value)} InputLabelProps={{ shrink: true }} />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField fullWidth select size="small" label="Branch" value={historyBranchFilter} onChange={(e) => setHistoryBranchFilter(e.target.value)}>
              <MenuItem value="all">All Branches</MenuItem>
              {branches.map((b) => (
                <MenuItem key={b.branch_code} value={b.branch_code}>{b.branch_name}</MenuItem>
              ))}
            </TextField>
          </Grid>
        </Grid>
      </Paper>

      {/* History Table */}
      {loadingHistory ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}><CircularProgress /></Box>
      ) : filteredPaymentHistory.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: "center" }}>
          <Typography variant="body1" color="text.secondary">No payment history found</Typography>
        </Paper>
      ) : (
        <Paper>
          <TableContainer sx={{ maxHeight: 500 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Settlement No.</TableCell>
                  <TableCell>Invoice(s)</TableCell>
                  <TableCell>Payment Method</TableCell>
                  <TableCell align="right">Amount (Rs.)</TableCell>
                  <TableCell>Branch</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredPaymentHistory.map((item, index) => (
                  <TableRow key={`${item.id}-${index}`} hover>
                    <TableCell>{new Date(item.date).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight="medium">{item.settle_no}</Typography>
                    </TableCell>
                    <TableCell>{item.invoice_ref || "-"}</TableCell>
                    <TableCell>{item.payment_method || "-"}</TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight="bold" color="primary.main">
                        {fmtLKR(item.total_amount)}
                      </Typography>
                    </TableCell>
                    <TableCell>{item.branch_code}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Box sx={{ p: 2, borderTop: "1px solid", borderColor: "divider", display: "flex", justifyContent: "space-between", alignItems: "center", bgcolor: "grey.50" }}>
            <Typography variant="body2" color="text.secondary">
              {filteredPaymentHistory.length} record{filteredPaymentHistory.length !== 1 ? "s" : ""}
            </Typography>
            <Typography variant="h6" color="primary.main" fontWeight="bold">
              Total: Rs. {fmtLKR(historySummary.totalAmount)}
            </Typography>
          </Box>
        </Paper>
      )}
    </Box>
  );

  // ==================== DETAIL PANEL ====================
  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Finance", href: "/finance" },
          { label: "Customer Payments", href: "/finance/customer-payments" },
          ...(selectedCustomer ? [{ label: selectedCustomer.customer_name }] : []),
          ...(viewMode === "history" ? [{ label: "Payment History" }]
            : viewMode !== "overview" ? [{ label: STEPS[activeStep] }] : []),
        ]}
        title={
          viewMode === "history"
            ? "Payment History"
            : viewMode === "review"
              ? "Review Payment"
              : viewMode === "payment" || viewMode === "documents"
                ? "Receive Payment"
                : selectedCustomer?.customer_name || "Select a Customer"
        }
        titleIcon={
          viewMode === "history" ? (
            <AssessmentIcon color="info" />
          ) : viewMode === "review" ? (
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
          viewMode === "history"
            ? [{ label: `${paymentHistory.length} Payment${paymentHistory.length !== 1 ? "s" : ""}`, color: "info" as const }]
            : selectedCustomer && viewMode === "overview"
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

      {/* Stepper */}
      {viewMode !== "overview" && viewMode !== "history" && (
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
        ) : viewMode === "history" ? (
          renderHistory()
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
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title="Customer Payments"
        icon={<PaymentIcon />}
        onRefresh={loadCustomers}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
