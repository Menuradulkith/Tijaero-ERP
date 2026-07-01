/**
 * SupplierPaymentsPage - Unified Supplier Payments (ERP Best Practice)
 * 
 * Following standard ERP patterns (SAP, Oracle, Odoo, ERPNext), this unified page handles:
 * - Credit settlements (pay against credit terms)
 * - Non-credit payments (Cash, Bank Transfer, Cheque)
 * 
 * Features:
 * - Tab-based filtering by payment type (All, Credit, Non-Credit)
 * - Single/Multiple document selection
 * - Partial payments
 * - FIFO auto-allocation
 * - Multiple payment methods
 * - Payment history tracking
 * 
 * Workflow:
 * 1. Select supplier ΓåÆ View all outstanding documents
 * 2. Filter by payment type (optional)
 * 3. Select document(s) to pay
 * 4. Enter payment details
 * 5. Review and post payment
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
  Tabs,
  Tab,
  FormControlLabel,
  Switch,
  Autocomplete,
} from "@mui/material";
import PaymentIcon from "@mui/icons-material/Payment";
import BusinessIcon from "@mui/icons-material/Business";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import DescriptionIcon from "@mui/icons-material/Description";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteIcon from "@mui/icons-material/Delete";
import CreditCardIcon from "@mui/icons-material/CreditCard";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import SearchIcon from "@mui/icons-material/Search";
import WarningIcon from "@mui/icons-material/Warning";
import AssessmentIcon from "@mui/icons-material/Assessment";
import { 
  handleApiError,
  showErrorToast,
  showSuccessToast,
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
  TFilterPanel,
} from "@/components/tijaero";

import {
  suppliersApi,
  supplierCreditsSettleApi,
  supplierCreditApi,
  supplierPaymentsApi,
  SupplierPaymentStatusData,
} from "@/modules/purchasing/api";
import {
  purchaseInvoicesApi,
  PurchaseInvoiceListItem,
} from "@/modules/purchasing/purchaseInvoiceApi";
import { useReferenceData } from "@/hooks";
import {
  Supplier,
} from "@/modules/purchasing/types";

// ─── Monthly Instalment Outstanding ─────────────────────────────────────────
// Computes how much of the credit invoice is overdue relative to an even monthly
// instalment schedule. Returns null for non-credit invoices.
// Formula:
//   duration_months = max(1, round((due_date - invoice_date) / 30))
//   monthly_instalment = total_amount / duration_months
//   months_elapsed = min(floor((today - invoice_date) / 30), duration_months)
//   expected_cumulative = monthly_instalment * months_elapsed
//   result = expected_cumulative - paid_amount   (negative = paid ahead)
function calcMonthlyInstalmentOutstanding(doc: {
  payment_type: string;
  date: string;
  due_date: string;
  total_amount: number;
  paid_amount: number;
}): number | null {
  if (doc.payment_type !== "credit") return null;
  const invoiceDate = new Date(doc.date);
  const dueDate = new Date(doc.due_date);
  const today = new Date();
  const durationDays = Math.round(
    (dueDate.getTime() - invoiceDate.getTime()) / 86_400_000
  );
  const durationMonths = Math.max(1, Math.round(durationDays / 30));
  const monthlyInstalment = doc.total_amount / durationMonths;
  const elapsedDays = Math.floor(
    (today.getTime() - invoiceDate.getTime()) / 86_400_000
  );
  const monthsElapsed = Math.min(
    Math.floor(elapsedDays / 30),
    durationMonths
  );
  const expectedCumulative = monthlyInstalment * monthsElapsed;
  return expectedCumulative - doc.paid_amount;
}

// Configuration
interface SortOption {
  value: string;
  label: string;
}

const SORT_OPTIONS: SortOption[] = [
  { value: "full_name", label: "Name" },
  { value: "outstanding", label: "Outstanding" },
  { value: "max_credit_limit", label: "Credit Limit" },
];

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cheque", label: "Cheque" },
];

// Payment type tab
type PaymentTypeTab = "all" | "credit" | "non_credit";

// Outstanding document interface (unified view)
interface OutstandingDocument {
  id: number;
  po_id: number;
  po_no: string;
  invoice_no: string | null;
  date: string;
  due_date: string;
  status: string;
  payment_type: "credit" | "non_credit";
  payment_method?: string;
  total_amount: number;
  paid_amount: number;
  pending_payment_amount?: number;
  has_pending_payment?: boolean;
  supplier_advance_amount: number;
  return_amount: number;
  remaining_amount: number;
  days_overdue: number;
  is_overdue: boolean;
  branch_code: string;
  has_grn?: boolean;
  grn_id?: number | null;
}

// Payment allocation line
interface PaymentLine {
  id: string;
  document: OutstandingDocument;
  allocated_amount: number;
}

// Steps in the workflow
const STEPS = ["Select Documents", "Payment Details", "Review & Post"];

// View mode enum
type ViewMode = "overview" | "documents" | "payment" | "review";

export default function SupplierPaymentsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  // Data state
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selection state
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("full_name");

  // View state
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<SupplierPaymentStatusData | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [allPaymentStatuses, setAllPaymentStatuses] = useState<SupplierPaymentStatusData[]>([]);
  const [payableInvoices, setPayableInvoices] = useState<PurchaseInvoiceListItem[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [activeStep, setActiveStep] = useState(0);

  // Payment type filter
  const [paymentTypeTab, setPaymentTypeTab] = useState<PaymentTypeTab>("all");

  // Branch filter
  const { filteredBranches: branches = [] } = useReferenceData(["branches"]);
  const [selectedBranch, setSelectedBranch] = useState<string>("all");

  // Document search filter
  const [documentSearchQuery, setDocumentSearchQuery] = useState<string>("");

  // Document selection
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<number>>(new Set());
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);

  // Payment form
  const [paymentMethod, setPaymentMethod] = useState("Bank Transfer");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [chequeDate, setChequeDate] = useState(new Date().toISOString().split("T")[0]);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [remarks, setRemarks] = useState("");

  // Previous payment suggestions (populated when a supplier is selected)
  const [previousBankNames, setPreviousBankNames] = useState<string[]>([]);
  const [lastPaymentSuggestion, setLastPaymentSuggestion] = useState<{ payment_method: string; bank_name: string } | null>(null);

  // FIFO mode
  const [useFIFO, setUseFIFO] = useState(false);
  const [fifoAmount, setFifoAmount] = useState(0);



  const confirmDialog = useConfirmDialog();

  const loadSuppliers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await suppliersApi.getAll({ active: true });
      setSuppliers(data);
    } catch (err: unknown) {
      setError(handleApiError(err, "Failed to load suppliers"));
    } finally {
      setLoading(false);
    }
  }, []);

  // Load/refresh suppliers whenever this route is entered.
  useEffect(() => {
    loadSuppliers();
  }, [location.key, loadSuppliers]);

  // Load payment status for selected supplier
  const loadPaymentStatus = useCallback(async (supplierId: number) => {
    try {
      setLoadingStatus(true);
      const status = await supplierCreditApi.getPaymentStatus(supplierId);
      setPaymentStatus(status);
    } catch (err) {
      setPaymentStatus(null);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  // Load payable invoices for selected supplier
  const loadPayableInvoices = useCallback(async (supplierId: number) => {
    try {
      setLoadingInvoices(true);
      const invoices = await purchaseInvoicesApi.getPayableInvoices(supplierId);
      setPayableInvoices(invoices);
    } catch {
      setPayableInvoices([]);
    } finally {
      setLoadingInvoices(false);
    }
  }, []);

  const refreshSelectedSupplierData = useCallback(() => {
    if (!selectedSupplier?.id) return;
    loadPaymentStatus(selectedSupplier.id);
    loadPayableInvoices(selectedSupplier.id);
  }, [selectedSupplier?.id, loadPaymentStatus, loadPayableInvoices]);

  // Refresh selected supplier data whenever user re-enters this page.
  useEffect(() => {
    refreshSelectedSupplierData();
  }, [location.key, refreshSelectedSupplierData]);

  // Refresh immediately when approval actions happen in Payment Approvals page.
  useEffect(() => {
    const handler = () => {
      loadSuppliers();
      refreshSelectedSupplierData();
    };

    window.addEventListener("supplier-payment-approval-updated", handler as EventListener);
    return () => {
      window.removeEventListener("supplier-payment-approval-updated", handler as EventListener);
    };
  }, [loadSuppliers, refreshSelectedSupplierData]);









  // Build purchase documents from payable invoices (invoice-based flow)
  const purchaseDocuments = useMemo((): OutstandingDocument[] => {
    return payableInvoices
      .filter((inv) => inv.balance_due - (inv.advance_amount || 0) > 0.001)
      .map((inv) => ({
      id: inv.id,
      po_id: 0,
      po_no: inv.po_nos || inv.invoice_no,  // Show PO numbers if available, fallback to invoice no
      invoice_no: inv.invoice_no,
      date: inv.supplier_invoice_date,
      due_date: inv.due_date,
      status: inv.status,
      payment_type: (inv.payment_type === "credit" ? "credit" : "non_credit") as "credit" | "non_credit",
      total_amount: inv.total_amount,
      paid_amount: inv.paid_amount,
      supplier_advance_amount: inv.advance_amount || 0,
      return_amount: 0,
      remaining_amount: Math.max(0, inv.balance_due - (inv.advance_amount || 0)),
      days_overdue: inv.days_overdue,
      is_overdue: inv.is_overdue,
      branch_code: inv.branch_code,
    }));
  }, [payableInvoices]);

  // Transform to current tab's document list
  const outstandingDocuments = useMemo((): OutstandingDocument[] => {
    const docs = [...purchaseDocuments];

    // Apply filters
    let filtered = docs;

    // Filter by payment type tab
    if (paymentTypeTab !== "all") {
      filtered = filtered.filter((d) => d.payment_type === paymentTypeTab);
    }

    // Filter by branch
    if (selectedBranch !== "all") {
      filtered = filtered.filter((d) => d.branch_code === selectedBranch);
    }

    // Filter by document search (PO number, invoice number)
    if (documentSearchQuery.trim()) {
      const query = documentSearchQuery.toLowerCase().trim();
      filtered = filtered.filter((d) => 
        d.po_no?.toLowerCase().includes(query) ||
        d.invoice_no?.toLowerCase().includes(query)
      );
    }

    // Sort by due date (oldest first)
    filtered.sort((a, b) => {
      const diff = new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      return diff !== 0 ? diff : (a.id || 0) - (b.id || 0);
    });

    return filtered;
  }, [purchaseDocuments, paymentTypeTab, selectedBranch, documentSearchQuery]);

  const creditPurchaseCount = useMemo(
    () => purchaseDocuments.filter((d) => d.payment_type === "credit").length,
    [purchaseDocuments]
  );

  const nonCreditPurchaseCount = useMemo(
    () => purchaseDocuments.filter((d) => d.payment_type === "non_credit").length,
    [purchaseDocuments]
  );

  // Calculate totals
  const totalOutstanding = useMemo(() => {
    return outstandingDocuments.reduce((sum, doc) => sum + doc.remaining_amount, 0);
  }, [outstandingDocuments]);

  const overdueDocuments = useMemo(() => {
    return outstandingDocuments.filter((doc) => doc.payment_type === "credit" && doc.is_overdue);
  }, [outstandingDocuments]);

  const showDueDateColumn = useMemo(
    () => outstandingDocuments.some((doc) => doc.payment_type === "credit"),
    [outstandingDocuments]
  );

  const isPendingVerificationDocument = useCallback((doc: OutstandingDocument): boolean => {
    if (doc.payment_type !== "non_credit") return false;
    return !!doc.has_pending_payment || (doc.pending_payment_amount || 0) > 0;
  }, []);

  const payableDocuments = useMemo(
    () => outstandingDocuments.filter((doc) => !isPendingVerificationDocument(doc)),
    [outstandingDocuments, isPendingVerificationDocument]
  );

  const selectedPayableCount = useMemo(
    () => payableDocuments.filter((d) => selectedDocumentIds.has(d.id)).length,
    [payableDocuments, selectedDocumentIds]
  );

  useEffect(() => {
    setSelectedDocumentIds((prev) => {
      const allowedIds = new Set(payableDocuments.map((d) => d.id));
      const pruned = new Set(Array.from(prev).filter((id) => allowedIds.has(id)));
      if (pruned.size === prev.size) return prev;
      return pruned;
    });
  }, [payableDocuments]);

  // Total amount to pay
  const totalPaymentAmount = useMemo(() => {
    return paymentLines.reduce((sum, line) => sum + line.allocated_amount, 0);
  }, [paymentLines]);

  // Filtered suppliers
  const filteredSuppliers = useMemo(() => {
    let filtered = suppliers;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((s) =>
        s.full_name.toLowerCase().includes(query) ||
        s.company_name?.toLowerCase().includes(query) ||
        s.email?.toLowerCase().includes(query)
      );
    }

    filtered.sort((a, b) => {
      switch (sortField) {
        case "full_name":
          return a.full_name.localeCompare(b.full_name);
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
  }, [suppliers, searchQuery, sortField]);

  // Handlers
  const handleSelectSupplier = useCallback((supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setViewMode("overview");
    setActiveStep(0);
    setSelectedDocumentIds(new Set());
    setPaymentLines([]);
    setPaymentTypeTab("all");
    setUseFIFO(false);
    setFifoAmount(0);
    resetPaymentForm();
    // Load data for this supplier
    loadPaymentStatus(supplier.id);
    loadPayableInvoices(supplier.id);
    // Fetch previous payment data to auto-populate payment form
    supplierPaymentsApi
      .getAll({ supplier_id: supplier.id, status: "verified", limit: 10 })
      .then((payments) => {
        if (!payments || payments.length === 0) return;
        // Collect unique bank names (most recent first)
        const banks = [
          ...new Set(
            payments
              .map((p) => p.bank_name)
              .filter((b): b is string => !!b && b.trim() !== "")
          ),
        ];
        setPreviousBankNames(banks);
        // Use most recent payment as the suggestion
        const last = payments[0];
        setLastPaymentSuggestion({
          payment_method: last.payment_method || "bank_transfer",
          bank_name: last.bank_name || "",
        });
      })
      .catch(() => {
        setPreviousBankNames([]);
        setLastPaymentSuggestion(null);
      });
  }, [loadPaymentStatus]);

  // Auto-select first supplier
  useEffect(() => {
    if (filteredSuppliers.length > 0 && !selectedSupplier && !loading) {
      const firstSupplier = filteredSuppliers[0];
      handleSelectSupplier(firstSupplier);
    }
  }, [filteredSuppliers.length, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload payment status when a supplier is selected (to get fresh data after navigation)
  useEffect(() => {
    if (selectedSupplier) {
      loadPaymentStatus(selectedSupplier.id);
    }
  }, [selectedSupplier?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetPaymentForm = () => {
    setPaymentMethod("Bank Transfer");
    setReferenceNumber("");
    setBankName("");
    setChequeDate(new Date().toISOString().split("T")[0]);
    setPaymentDate(new Date().toISOString().split("T")[0]);
    setRemarks("");
  };

  const handleStartPayment = useCallback(() => {
    setViewMode("documents");
    setActiveStep(0);
  }, []);

  const handleSelectDocument = useCallback((doc: OutstandingDocument) => {
    if (isPendingVerificationDocument(doc)) {
      return;
    }
    setSelectedDocumentIds((prev) => {
      const next = new Set(prev);
      if (next.has(doc.id)) {
        next.delete(doc.id);
      } else {
        next.add(doc.id);
      }
      return next;
    });
  }, [isPendingVerificationDocument]);

  const handleSelectAll = useCallback(() => {
    if (selectedPayableCount === payableDocuments.length) {
      setSelectedDocumentIds(new Set());
    } else {
      setSelectedDocumentIds(new Set(payableDocuments.map((d) => d.id)));
    }
  }, [payableDocuments, selectedPayableCount]);

  const allocateFIFO = useCallback((amount: number): PaymentLine[] => {
    const lines: PaymentLine[] = [];
    let remaining = amount;

    for (const doc of outstandingDocuments) {
      if (remaining <= 0) break;
      if (isPendingVerificationDocument(doc)) continue;

      const allocate = Math.min(remaining, doc.remaining_amount);
      if (allocate > 0) {
        lines.push({
          id: `line-${lines.length}`,
          document: doc,
          allocated_amount: allocate,
        });
        remaining -= allocate;
      }
    }

    return lines;
  }, [outstandingDocuments, isPendingVerificationDocument]);

  const handleProceedToPayment = useCallback(async () => {
    if (!selectedSupplier) {
      showErrorToast("Please select a supplier first");
      return;
    }

    if (useFIFO) {
      // FIFO allocation
      if (fifoAmount <= 0) {
        showErrorToast("Please enter a payment amount for FIFO allocation");
        return;
      }
      const lines = allocateFIFO(fifoAmount);
      if (lines.length === 0) {
        showErrorToast("No documents available for allocation");
        return;
      }
      setPaymentLines(lines);
    } else {
      // Manual selection
      if (selectedPayableCount === 0) {
        showErrorToast("Please select at least one document");
        return;
      }
      const selectedDocs = outstandingDocuments.filter(
        (d) => selectedDocumentIds.has(d.id) && !isPendingVerificationDocument(d)
      );
      if (selectedDocs.length === 0) {
        showErrorToast("Pending verification documents cannot be paid");
        return;
      }
      const lines: PaymentLine[] = selectedDocs.map((doc, idx) => ({
        id: `line-${idx}`,
        document: doc,
        allocated_amount: doc.remaining_amount, // Default to full amount
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
  }, [
    useFIFO,
    fifoAmount,
    selectedDocumentIds,
    outstandingDocuments,
    allocateFIFO,
    selectedSupplier,
    selectedPayableCount,
    lastPaymentSuggestion,
    isPendingVerificationDocument,
  ]);

  const handleLineAmountChange = useCallback((lineId: string, amount: number) => {
    setPaymentLines((prev) =>
      prev.map((line) => {
        if (line.id === lineId) {
          const clampedAmount = Math.min(Math.max(0, amount), line.document.remaining_amount);
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
    const hasPendingVerificationDoc = paymentLines.some((line) =>
      isPendingVerificationDocument(line.document)
    );
    if (hasPendingVerificationDoc) {
      showErrorToast("Pending verification documents cannot be paid");
      return;
    }

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

    setViewMode("review");
    setActiveStep(2);
  }, [
    totalPaymentAmount,
    paymentMethod,
    referenceNumber,
    bankName,
    paymentLines,
    isPendingVerificationDocument,
  ]);

  const handlePostPayment = useCallback(async () => {
    if (!selectedSupplier || paymentLines.length === 0) return;

    const hasPendingVerificationDoc = paymentLines.some((line) =>
      isPendingVerificationDocument(line.document)
    );
    if (hasPendingVerificationDoc) {
      showErrorToast("Pending verification documents cannot be paid");
      return;
    }

    const confirmMessage = `Post payment of Rs. ${fmtLKR(totalPaymentAmount)} for ${selectedSupplier.full_name}?`;

    const confirmed = await confirmDialog.confirm({
      title: "Post Payment",
      message: confirmMessage + " This action cannot be undone.",
      confirmText: "Confirm",
    });

    if (!confirmed) return;

    try {
      setSaving(true);
      setError(null);

      // Use invoice-based payment API with allocations
      const allocations = paymentLines
        .filter((l) => l.allocated_amount > 0)
        .map((l) => ({
          purchase_invoice_id: l.document.id,
          allocated_amount: l.allocated_amount,
        }));

      const firstLine = paymentLines[0];

      await purchaseInvoicesApi.payInvoices({
        supplier_id: selectedSupplier.id,
        payment_date: paymentDate,
        payment_method: paymentMethod,
        payment_amount: totalPaymentAmount,
        reference_number: referenceNumber || undefined,
        bank_name: bankName || undefined,
        branch_code: firstLine?.document.branch_code || "",
        remarks: remarks || undefined,
        allocations,
      });

      showSuccessToast("Payment posted successfully!");

      // Refresh status and reset
      await loadPaymentStatus(selectedSupplier.id);
      await loadPayableInvoices(selectedSupplier.id);
      setViewMode("overview");
      setActiveStep(0);
      setSelectedDocumentIds(new Set());
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
    selectedSupplier,
    paymentLines,
    totalPaymentAmount,
    paymentMethod,
    referenceNumber,
    bankName,
    chequeDate,
    paymentDate,
    remarks,
    confirmDialog,
    loadPaymentStatus,
    isPendingVerificationDocument,
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
    setSelectedDocumentIds(new Set());
    setPaymentLines([]);
    resetPaymentForm();
  }, []);

  // Credit usage percentage
  const getCreditUsage = (supplier: Supplier) => {
    const available = supplier.left_credit_amount ?? supplier.max_credit_limit;
    const used = supplier.max_credit_limit - available;
    return supplier.max_credit_limit > 0 ? (used / supplier.max_credit_limit) * 100 : 0;
  };

  // Master Panel - Supplier list
  const masterPanel = (
    <SearchableList<Supplier>
      items={filteredSuppliers}
      isLoading={loading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search suppliers..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedSupplier}
      onSelectItem={handleSelectSupplier}
      emptyMessage="No suppliers found"
      width={300}
      listHeader={
        <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: "divider" }}>
          <Typography variant="caption" color="text.secondary">
            {filteredSuppliers.length} suppliers
          </Typography>
        </Box>
      }
      renderItem={(supplier, isSelected) => {
        const usage = getCreditUsage(supplier);
        const outstanding = supplier.max_credit_limit - (supplier.left_credit_amount ?? supplier.max_credit_limit);
        return (
          <SelectableListItem
            key={supplier.id}
            id={supplier.id}
            isSelected={isSelected}
            onClick={() => handleSelectSupplier(supplier)}
            primaryText={
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{supplier.full_name}</span>
                </Box>
                {isSelected && (
                  <>
                    <Typography variant="caption" component="span">
                      {supplier.company_name || "Individual"}
                    </Typography>
                    {supplier.max_credit_limit > 0 && (
                      <>
                        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                          <Typography variant="caption">
                            Credit: {fmtLKR(paymentStatus?.left_credit_amount ?? supplier.left_credit_amount ?? supplier.max_credit_limit)} / {fmtLKR(supplier.max_credit_limit)}
                          </Typography>
                        </Box>
                        {(() => {
                          const liveLeft = paymentStatus?.left_credit_amount ?? supplier.left_credit_amount ?? supplier.max_credit_limit;
                          const liveUsed = supplier.max_credit_limit - liveLeft;
                          const liveUsage = supplier.max_credit_limit > 0 ? (liveUsed / supplier.max_credit_limit) * 100 : 0;
                          return (
                            <>
                              <Box sx={{ mt: 0.5, width: "100%", height: 4, bgcolor: "grey.200", borderRadius: 1 }}>
                                <Box
                                  sx={{
                                    width: `${Math.min(liveUsage, 100)}%`,
                                    height: "100%",
                                    bgcolor: liveUsage > 80 ? "error.main" : liveUsage > 50 ? "warning.main" : "success.main",
                                    borderRadius: 1,
                                  }}
                                />
                              </Box>
                              <Chip
                                label={`${supplier.credit_days} days`}
                                size="small"
                                color="info"
                                sx={{ height: 18, fontSize: "0.65rem", mt: 0.5 }}
                              />
                            </>
                          );
                        })()}
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
                    {supplier.company_name || "Individual"}
                  </Typography>
                  {supplier.max_credit_limit > 0 && (
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
              !isSelected && supplier.max_credit_limit > 0
                ? { label: `${supplier.credit_days}d`, color: "info" }
                : undefined
            }
          />
        );
      }}
    />
  );

  // Render overview (supplier info + outstanding summary)
  const renderOverview = () => (
    <Box sx={{ p: 2 }}>
      {/* Supplier Info Card */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
          <BusinessIcon sx={{ fontSize: 40, color: "primary.main" }} />
          <Box>
            <Typography variant="h5">{selectedSupplier?.full_name}</Typography>
            {selectedSupplier?.company_name && (
              <Typography variant="body2" color="text.secondary">
                {selectedSupplier.company_name}
              </Typography>
            )}
          </Box>
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Credit Information */}
        {selectedSupplier && selectedSupplier.max_credit_limit > 0 && (
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
                      {selectedSupplier?.credit_days || 0}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Card variant="outlined">
                  <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">Credit Limit</Typography>
                    <Typography variant="h6">
                      Rs. {fmtLKR(selectedSupplier?.max_credit_limit || 0)}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Card variant="outlined">
                  <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">Available</Typography>
                    <Typography variant="h6" color="success.main">
                      Rs. {fmtLKR(paymentStatus?.left_credit_amount || 0)}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Card variant="outlined">
                  <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                    <Typography variant="caption">Credit Outstanding</Typography>
                    <Typography variant="h6" color="warning.dark">
                      Rs. {fmtLKR(paymentStatus?.credit_outstanding || 0)}
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
                  <Typography variant="caption" color="text.secondary">Open Documents</Typography>
                  <Typography variant="h5" color="primary.main">
                    {outstandingDocuments.length}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Card variant="outlined">
                <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                  <Typography variant="caption">Total Outstanding</Typography>
                  <Typography variant="h6" color="warning.dark">
                    Rs. {fmtLKR(totalOutstanding)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Card variant="outlined">
                <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                  <Typography variant="caption">Overdue Documents</Typography>
                  <Typography variant="h5" color={overdueDocuments.length > 0 ? "error.dark" : "success.dark"}>
                    {overdueDocuments.length}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Card variant="outlined">
                <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                  <Typography variant="caption">Overdue Amount</Typography>
                  <Typography variant="h6" color={overdueDocuments.length > 0 ? "error.dark" : "text.secondary"}>
                    Rs. {fmtLKR(overdueDocuments.reduce((sum, d) => sum + d.remaining_amount, 0))}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}
      </Paper>

      {/* Outstanding Documents Preview */}
      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle1" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <DescriptionIcon fontSize="small" />
          Outstanding Documents
        </Typography>

        {/* Filters Section */}
        <TFilterPanel>
          {/* PO/Document Search */}
          <TextField
            placeholder="Search PO, Invoice..."
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
          
          {/* Branch Filter */}
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
              <TextField
                {...params}
                label="Filter by Branch"
                size="small"
              />
            )}
            sx={{ minWidth: 200 }}
            disableClearable
          />
        </TFilterPanel>

        {/* Payment Type Tabs */}
        <Tabs
          value={paymentTypeTab}
          onChange={(_, v) => setPaymentTypeTab(v)}
          sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
        >
          <Tab label={`All (${purchaseDocuments.length})`} value="all" />
          <Tab
            label={`Credit (${creditPurchaseCount})`}
            value="credit"
            icon={<CreditCardIcon sx={{ fontSize: 16 }} />}
            iconPosition="start"
          />
          <Tab
            label={`Non-Credit (${nonCreditPurchaseCount})`}
            value="non_credit"
            icon={<AccountBalanceWalletIcon sx={{ fontSize: 16 }} />}
            iconPosition="start"
          />
        </Tabs>

        <Divider />

        {outstandingDocuments.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
            No outstanding documents for this supplier
          </Typography>
        ) : (
          <TableContainer sx={{ maxHeight: 350 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Type</TableCell>
                  <TableCell>Invoice / PO</TableCell>
                  <TableCell>Date</TableCell>
                  {showDueDateColumn && <TableCell>Due Date</TableCell>}
                  <TableCell align="right">Amount (Rs.)</TableCell>
                  <TableCell align="right">Paid (Rs.)</TableCell>
                  <TableCell align="right">Supplier Advance (Rs.)</TableCell>
                  <TableCell align="right">Returns (Rs.)</TableCell>
                  <TableCell align="right">Outstanding (Rs.)</TableCell>
                  <TableCell align="right">Monthly Instalment Outstanding (Rs.)</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {outstandingDocuments.map((doc) => (
                  <TableRow key={`${doc.payment_type}-${doc.id}`} hover>
                    <TableCell>
                      <Chip
                        label={doc.payment_type === "credit" ? "Credit" : doc.payment_method || "Cash"}
                        size="small"
                        color={doc.payment_type === "credit" ? "info" : "default"}
                        sx={{ minWidth: 70 }}
                      />
                    </TableCell>
                    <TableCell>
                      <Box>
                        <Typography variant="body2">{doc.invoice_no}</Typography>
                        {doc.po_no && doc.po_no !== doc.invoice_no && (
                          <Typography variant="caption" color="text.secondary">
                            {doc.po_no}
                          </Typography>
                        )}
                      </Box>
                    </TableCell>
                    <TableCell>{new Date(doc.date).toLocaleDateString()}</TableCell>
                    {showDueDateColumn && (
                      <TableCell>
                        {doc.payment_type === "credit" ? (
                          <Typography color={doc.is_overdue ? "error" : "text.primary"}>
                            {new Date(doc.due_date).toLocaleDateString()}
                          </Typography>
                        ) : (
                          <Typography color="text.secondary">-</Typography>
                        )}
                      </TableCell>
                    )}
                    <TableCell align="right">
                      {fmtLKR(doc.total_amount)}
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2">
                        {fmtLKR(doc.paid_amount)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2">
                        {fmtLKR(doc.supplier_advance_amount || 0)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" color={doc.return_amount > 0 ? "info.main" : "text.secondary"}>
                        {doc.return_amount > 0 ? fmtLKR(doc.return_amount) : "-"}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography color="warning.main" fontWeight="bold">
                        {fmtLKR(doc.remaining_amount)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      {(() => {
                        const mio = calcMonthlyInstalmentOutstanding(doc);
                        if (mio === null) return <Typography color="text.disabled">—</Typography>;
                        return (
                          <Typography
                            fontWeight="bold"
                            color={mio < 0 ? "success.main" : mio === 0 ? "text.secondary" : "error.main"}
                          >
                            {mio < 0 ? `-Rs. ${fmtLKR(Math.abs(mio))}` : `Rs. ${fmtLKR(mio)}`}
                          </Typography>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      {doc.payment_type === "credit" ? (
                        doc.is_overdue ? (
                          <Chip
                            label={`${doc.days_overdue}d overdue`}
                            size="small"
                            color="error"
                            icon={<WarningIcon />}
                          />
                        ) : (
                          <Chip label="Due" size="small" color="warning" />
                        )
                      ) : (doc.has_pending_payment || (doc.pending_payment_amount || 0) > 0) ? (
                        <Chip
                          label="Pending Verification"
                          size="small"
                          color="info"
                        />
                      ) : (
                        <Chip
                          label={doc.remaining_amount <= 0 ? "Paid" : "Unpaid"}
                          size="small"
                          color={doc.remaining_amount <= 0 ? "success" : "warning"}
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
    </Box>
  );

  // Render document selection view (Step 1)
  const renderDocumentsView = () => (
    <Box sx={{ p: 2 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={handleBack} sx={{ mb: 2 }}>
        Back to Overview
      </Button>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Select Documents to Pay
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
            setSelectedDocumentIds(new Set());
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Filter by Branch"
              size="small"
            />
          )}
          sx={{ minWidth: 200, mb: 2 }}
          disableClearable
        />

        {/* Payment Type Tabs */}
        <Tabs
          value={paymentTypeTab}
          onChange={(_, v) => {
            setPaymentTypeTab(v);
            setSelectedDocumentIds(new Set());
          }}
          sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
        >
          <Tab label="All" value="all" />
          <Tab label="Credit" value="credit" icon={<CreditCardIcon sx={{ fontSize: 16 }} />} iconPosition="start" />
          <Tab label="Non-Credit" value="non_credit" icon={<AccountBalanceWalletIcon sx={{ fontSize: 16 }} />} iconPosition="start" />
        </Tabs>

        {/* FIFO Toggle */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
          <FormControlLabel
            control={
              <Switch
                checked={useFIFO}
                onChange={(e) => {
                  setUseFIFO(e.target.checked);
                  setSelectedDocumentIds(new Set());
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
                  checked={selectedPayableCount === payableDocuments.length && payableDocuments.length > 0}
                  indeterminate={selectedPayableCount > 0 && selectedPayableCount < payableDocuments.length}
                  onChange={handleSelectAll}
                  disabled={payableDocuments.length === 0}
                />
              }
              label="Select All"
            />
            <Typography variant="body2" color="text.secondary">
              {selectedPayableCount} of {payableDocuments.length} selectable
            </Typography>
          </Box>
        )}

        {payableDocuments.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            No payable documents available. Pending verification documents are hidden from payment creation.
          </Typography>
        ) : (
          <TableContainer sx={{ maxHeight: 400 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {!useFIFO && <TableCell padding="checkbox" />}
                  <TableCell>Type</TableCell>
                  <TableCell>Document</TableCell>
                  {showDueDateColumn && <TableCell>Due Date</TableCell>}
                  <TableCell align="right">Total</TableCell>
                  <TableCell align="right">Outstanding</TableCell>
                  <TableCell align="right">Monthly Instalment Outstanding</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {payableDocuments.map((doc) => (
                  <TableRow
                    key={`${doc.payment_type}-${doc.id}`}
                    hover
                    selected={selectedDocumentIds.has(doc.id)}
                    onClick={() => !useFIFO && handleSelectDocument(doc)}
                    sx={{ cursor: useFIFO ? "default" : "pointer" }}
                  >
                    {!useFIFO && (
                      <TableCell padding="checkbox">
                        <Checkbox checked={selectedDocumentIds.has(doc.id)} />
                      </TableCell>
                    )}
                  <TableCell>
                    <Chip
                      label={doc.payment_type === "credit" ? "Credit" : doc.payment_method || "Cash"}
                      size="small"
                      color={doc.payment_type === "credit" ? "info" : "default"}
                    />
                  </TableCell>
                  <TableCell>
                    <Box>
                      <Typography variant="body2">{doc.po_no}</Typography>
                    </Box>
                  </TableCell>
                  {showDueDateColumn && (
                    <TableCell>
                      {doc.payment_type === "credit" ? (
                        <Typography color={doc.is_overdue ? "error" : "text.primary"}>
                          {new Date(doc.due_date).toLocaleDateString()}
                        </Typography>
                      ) : (
                        <Typography color="text.secondary">-</Typography>
                      )}
                    </TableCell>
                  )}
                  <TableCell align="right">
                    <Typography variant="body2" color="text.secondary">
                      Rs. {fmtLKR(doc.total_amount)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography fontWeight="bold" color="warning.main">
                      Rs. {fmtLKR(doc.remaining_amount)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    {(() => {
                      const mio = calcMonthlyInstalmentOutstanding(doc);
                      if (mio === null) return <Typography color="text.disabled">—</Typography>;
                      return (
                        <Typography
                          fontWeight="bold"
                          color={mio < 0 ? "success.main" : mio === 0 ? "text.secondary" : "error.main"}
                        >
                          {mio < 0 ? `-Rs. ${fmtLKR(Math.abs(mio))}` : `Rs. ${fmtLKR(mio)}`}
                        </Typography>
                      );
                    })()}
                  </TableCell>
                    <TableCell>
                      {doc.payment_type === "credit" ? (
                        doc.is_overdue ? (
                          <Chip label={`${doc.days_overdue}d overdue`} size="small" color="error" />
                        ) : (
                          <Chip label="Due" size="small" color="warning" />
                        )
                      ) : (
                        <Chip
                          label={doc.remaining_amount <= 0 ? "Paid" : "Unpaid"}
                          size="small"
                          color={doc.remaining_amount <= 0 ? "success" : "warning"}
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
              : `Selected: ${selectedPayableCount} documents`}
          </Typography>
          <Typography variant="h6" color="primary.main">
            {useFIFO
              ? `Will allocate to ${allocateFIFO(fifoAmount).length} document(s)`
              : `Total: Rs. ${fmtLKR(payableDocuments
                .filter((d) => selectedDocumentIds.has(d.id))
                .reduce((sum, d) => sum + d.remaining_amount, 0))}`}
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
          disabled={!useFIFO && selectedPayableCount === 0}
        >
          Continue to Payment
        </Button>
      </Box>
    </Box>
  );

  // Render payment details view (Step 2)
  const renderPaymentView = () => (
    <Box sx={{ p: 2 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={handleBack} sx={{ mb: 2 }}>
        Back to Document Selection
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
                <TableCell>Document</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">Outstanding</TableCell>
                <TableCell align="right" sx={{ width: 150 }}>Payment Amount</TableCell>
                <TableCell sx={{ width: 50 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {paymentLines.map((line) => {
                return (
                  <TableRow key={line.id}>
                    <TableCell>
                      <Typography variant="body2">{line.document.po_no}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={line.document.payment_type === "credit" ? "Credit" : line.document.payment_method || "Cash"}
                        size="small"
                        color={line.document.payment_type === "credit" ? "info" : "default"}
                      />
                    </TableCell>
                    <TableCell align="right">
                      {fmtLKR(line.document.remaining_amount)}
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
                          max: line.document.remaining_amount,
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
                );
              })}
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

      {/* Payment Method */}
      <FormSection title="Payment Method" columns={2}>
        <TextField
          select
          label="Payment Method"
          size="small"
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
        >
          {PAYMENT_METHODS.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Payment Date"
          size="small"
          type="date"
          value={paymentDate}
          onChange={(e) => setPaymentDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          label={paymentMethod === "Cheque" ? "Cheque Number" : "Reference Number"}
          size="small"
          value={referenceNumber}
          onChange={(e) => setReferenceNumber(e.target.value)}
          required={paymentMethod !== "Cash"}
        />
        {paymentMethod === "Cheque" && (
          <>
            <Autocomplete
              freeSolo
              options={previousBankNames}
              value={bankName}
              onInputChange={(_, newValue) => setBankName(newValue)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Bank Name"
                  size="small"
                  required
                  helperText={previousBankNames.length > 0 ? "Previously used banks shown" : undefined}
                />
              )}
            />
            <TextField
              label="Cheque Date"
              size="small"
              type="date"
              value={chequeDate}
              onChange={(e) => setChequeDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </>
        )}
        {paymentMethod === "Bank Transfer" && previousBankNames.length > 0 && (
          <Autocomplete
            freeSolo
            options={previousBankNames}
            value={bankName}
            onInputChange={(_, newValue) => setBankName(newValue)}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Bank Name"
                size="small"
                helperText="Previously used banks shown"
              />
            )}
          />
        )}
        {paymentMethod === "Bank Transfer" && previousBankNames.length === 0 && (
          <TextField
            label="Bank Name"
            size="small"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
          />
        )}
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

  // Render review view (Step 3)
  const renderReviewView = () => (
    <Box sx={{ p: 2 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={handleBack} sx={{ mb: 2 }}>
        Back to Payment Details
      </Button>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Supplier Info */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Payment Summary
        </Typography>
        <Divider sx={{ mb: 2 }} />

        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <Typography variant="caption" color="text.secondary">Supplier</Typography>
            <Typography variant="body1">{selectedSupplier?.full_name}</Typography>
          </Grid>
          <Grid item xs={12} sm={6}>
            <Typography variant="caption" color="text.secondary">Payment Date</Typography>
            <Typography variant="body1">{new Date(paymentDate).toLocaleDateString()}</Typography>
          </Grid>
          <Grid item xs={12} sm={6}>
            <Typography variant="caption" color="text.secondary">Payment Method</Typography>
            <Typography variant="body1">{paymentMethod}</Typography>
          </Grid>
          {referenceNumber && (
            <Grid item xs={12} sm={6}>
              <Typography variant="caption" color="text.secondary">Reference</Typography>
              <Typography variant="body1">{referenceNumber}</Typography>
            </Grid>
          )}
        </Grid>
      </Paper>

      {/* Payment Lines */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Documents Being Paid
        </Typography>
        <Divider sx={{ mb: 2 }} />

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Document</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">Outstanding (Rs.)</TableCell>
                <TableCell align="right">Payment (Rs.)</TableCell>
                <TableCell align="right">Remaining After (Rs.)</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paymentLines.map((line) => {
                const remainingAfter = line.document.remaining_amount - line.allocated_amount;
                
                return (
                  <TableRow key={line.id}>
                    <TableCell>
                      <Box>
                        <Typography variant="body2">{line.document.po_no}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={line.document.payment_type === "credit" ? "Credit" : line.document.payment_method || "Cash"}
                        size="small"
                        color={line.document.payment_type === "credit" ? "info" : "default"}
                      />
                    </TableCell>
                    <TableCell align="right">
                      {fmtLKR(line.document.remaining_amount)}
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
                  <Typography variant="subtitle2" fontWeight="bold">Total:</Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography variant="h5" fontWeight="bold" color="primary.main">
                    Rs. {fmtLKR(totalPaymentAmount)}
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

  // Detail Panel
  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Purchasing", href: "/purchasing" },
          { label: "Supplier Payments", href: "/purchasing/payments" },
          ...(selectedSupplier ? [{ label: selectedSupplier.full_name }] : []),
          ...(viewMode !== "overview" ? [{ label: STEPS[activeStep] }] : []),
        ]}
        title={
          viewMode === "review"
            ? "Review & Post"
            : viewMode === "payment"
              ? "Payment Details"
              : viewMode === "documents"
                ? "Select Documents"
                : selectedSupplier?.full_name || ""
        }
        titleIcon={
          viewMode === "review" ? (
            <CheckCircleIcon color="success" />
          ) : viewMode === "payment" || viewMode === "documents" ? (
            <PaymentIcon color="primary" />
          ) : (
            <BusinessIcon color="primary" />
          )
        }
        isCreating={false}
        noSelectionTitle="Select a Supplier"
        chips={
          selectedSupplier && viewMode === "overview"
            ? [
              { label: `${outstandingDocuments.length} Open Docs`, variant: "outlined" as const },
              ...(totalOutstanding > 0
                ? [{ label: `Rs. ${fmtLKR(totalOutstanding)} Outstanding`, color: "warning" as const }]
                : []),
            ]
            : viewMode !== "overview"
              ? [
                { label: `Rs. ${fmtLKR(totalPaymentAmount)}`, color: "primary" as const },
              ]
              : []
        }
      />

      {/* Action Toolbar - contextual actions based on view mode */}
      {selectedSupplier && viewMode === "overview" && (
        <ActionToolbar
          hasSelectedItem={!!selectedSupplier}
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
                onClick={() => navigate("/finance/supplier-payments/report")}
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
        {!selectedSupplier ? (
          <Box sx={{ p: 2 }}>
            <EmptyState message="Select a supplier from the list to view outstanding documents and make payments" />
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
      title="Supplier Payments"
      icon={<PaymentIcon />}
      onRefresh={loadSuppliers}
      masterPanel={masterPanel}
      detailPanel={detailPanel}
    />
  );
}
