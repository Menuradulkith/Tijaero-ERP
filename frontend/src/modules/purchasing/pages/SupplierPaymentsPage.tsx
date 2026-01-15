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
 * 1. Select supplier → View all outstanding documents
 * 2. Filter by payment type (optional)
 * 3. Select document(s) to pay
 * 4. Enter payment details
 * 5. Review and post payment
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
import WarningIcon from "@mui/icons-material/Warning";
import AssessmentIcon from "@mui/icons-material/Assessment";
import toast from "react-hot-toast";
import { ConfirmDialog, useConfirmDialog } from "@/components/ConfirmDialog";

import {
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  DetailPanelHeader,
  EmptyState,
  SortOption,
} from "@/components/tijaero";

import {
  suppliersApi,
  supplierCreditsSettleApi,
  supplierCreditApi,
  supplierPaymentsApi,
  SupplierPaymentStatusData,
} from "@/modules/purchasing/api";
import { branchApi } from "@/modules/branches/api";
import {
  Supplier,
  SupplierCreditsSettleCreate,
  SupplierCreditsSettleTransactionCreate,
  SupplierPaymentCreate,
  SupplierPayment,
  SupplierCreditsSettle,
} from "@/modules/purchasing/types";

// Configuration
const SORT_OPTIONS: SortOption[] = [
  { value: "full_name", label: "Name" },
  { value: "outstanding", label: "Outstanding" },
  { value: "max_credit_limit", label: "Credit Limit" },
];

const PAYMENT_METHODS = [
  { value: "Cash", label: "Cash" },
  { value: "Bank Transfer", label: "Bank Transfer" },
  { value: "Cheque", label: "Cheque" },
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
  remaining_amount: number;
  days_overdue: number;
  is_overdue: boolean;
  has_grn: boolean;
  grn_id: number | null;
  grn_no: string | null;
  branch_code: string;
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
type ViewMode = "overview" | "documents" | "payment" | "review" | "history";

export default function SupplierPaymentsPage() {
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

  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [activeStep, setActiveStep] = useState(0);

  // Payment type filter
  const [paymentTypeTab, setPaymentTypeTab] = useState<PaymentTypeTab>("all");

  // Branch filter
  const [branches, setBranches] = useState<{ branch_code: string; branch_name: string }[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("all");

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

  // FIFO mode
  const [useFIFO, setUseFIFO] = useState(false);
  const [fifoAmount, setFifoAmount] = useState(0);

  // Payment history state
  const [paymentHistory, setPaymentHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const confirmDialog = useConfirmDialog();

  // Load suppliers and branches
  useEffect(() => {
    loadSuppliers();
    loadBranches();
  }, []);

  const loadBranches = async () => {
    try {
      const data = await branchApi.getAll(1, 100);
      setBranches(data.items || []);
    } catch (err) {
      console.error("Failed to load branches:", err);
    }
  };

  const loadSuppliers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await suppliersApi.getAll({ active: true });
      setSuppliers(data);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setError(error.response?.data?.detail || "Failed to load suppliers");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load payment status for selected supplier
  const loadPaymentStatus = useCallback(async (supplierId: number) => {
    try {
      setLoadingStatus(true);
      const status = await supplierCreditApi.getPaymentStatus(supplierId);
      setPaymentStatus(status);
    } catch (err) {
      console.error("Failed to load payment status:", err);
      setPaymentStatus(null);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  // Load payment history for selected supplier
  const loadPaymentHistory = useCallback(async (supplierId: number) => {
    try {
      setLoadingHistory(true);
      
      // Load both credit settlements and non-credit payments
      const [creditSettlements, nonCreditPayments] = await Promise.all([
        supplierCreditsSettleApi.getBySupplier(supplierId).catch(() => []),
        supplierPaymentsApi.getAll({ supplier_id: supplierId }).catch(() => []),
      ]);

      // Combine and sort by date
      const combined: any[] = [
        ...(creditSettlements || []).map((s: SupplierCreditsSettle) => ({
          type: "credit_settlement",
          id: s.id,
          settle_no: s.supplier_credits_settle_no,
          date: s.created_date,
          total_amount: 0, // We don't have transaction details from getBySupplier
          transactions: [],
          branch_code: s.branch_code,
        })),
        ...(nonCreditPayments || []).map((p: SupplierPayment) => ({
          type: "payment",
          id: p.id,
          payment_no: p.payment_no,
          date: p.payment_date,
          amount: p.payment_amount,
          payment_method: p.payment_method,
          reference_number: p.reference_number,
          bank_name: p.bank_name,
          invoice_reference: p.invoice_reference,
          remarks: p.remarks,
          status: p.status,
          po_no: p.po_no,
          branch_code: p.branch_code,
        })),
      ];

      combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setPaymentHistory(combined);
    } catch (err) {
      console.error("Failed to load payment history:", err);
      setPaymentHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  // Transform API data to unified documents
  const outstandingDocuments = useMemo((): OutstandingDocument[] => {
    if (!paymentStatus) return [];

    const docs: OutstandingDocument[] = [];

    // Add credit purchase orders
    paymentStatus.credit_purchase_orders?.forEach((po) => {
      if (po.has_grn && !po.is_settled && po.remaining_amount > 0) {
        docs.push({
          id: po.po_id,
          po_id: po.po_id,
          po_no: po.po_no,
          invoice_no: po.invoice_no,
          date: po.po_date,
          due_date: po.due_date,
          status: po.status,
          payment_type: "credit",
          total_amount: po.total_amount,
          paid_amount: po.settled_amount,
          remaining_amount: po.remaining_amount,
          days_overdue: po.days_overdue,
          is_overdue: po.is_overdue,
          has_grn: po.has_grn,
          grn_id: po.grn_id,
          grn_no: po.grn_no,
          branch_code: po.branch_code,
        });
      }
    });

    // Add non-credit purchase orders
    paymentStatus.non_credit_purchase_orders?.forEach((po) => {
      if (po.has_grn && !po.is_paid && po.remaining_amount > 0) {
        docs.push({
          id: po.po_id,
          po_id: po.po_id,
          po_no: po.po_no,
          invoice_no: po.invoice_no,
          date: po.po_date,
          due_date: po.due_date,
          status: po.status,
          payment_type: "non_credit",
          payment_method: po.payment_method,
          total_amount: po.total_amount,
          paid_amount: po.paid_amount,
          remaining_amount: po.remaining_amount,
          days_overdue: po.days_overdue,
          is_overdue: po.is_overdue,
          has_grn: po.has_grn,
          grn_id: po.grn_id,
          grn_no: po.grn_no,
          branch_code: po.branch_code,
        });
      }
    });

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

    // Sort by due date (oldest first)
    filtered.sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());

    return filtered;
  }, [paymentStatus, paymentTypeTab, selectedBranch]);

  // Calculate totals
  const totalOutstanding = useMemo(() => {
    return outstandingDocuments.reduce((sum, doc) => sum + doc.remaining_amount, 0);
  }, [outstandingDocuments]);

  const overdueDocuments = useMemo(() => {
    return outstandingDocuments.filter((doc) => doc.is_overdue);
  }, [outstandingDocuments]);

  const totalPaymentAmount = useMemo(() => {
    return paymentLines.reduce((sum, line) => sum + line.allocated_amount, 0);
  }, [paymentLines]);

  // Filtered suppliers
  const filteredSuppliers = useMemo(() => {
    let filtered = suppliers;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          s.full_name.toLowerCase().includes(query) ||
          s.company_name?.toLowerCase().includes(query)
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
    loadPaymentStatus(supplier.id);
  }, [loadPaymentStatus]);

  // Auto-select first supplier
  useEffect(() => {
    if (filteredSuppliers.length > 0 && !selectedSupplier && !loading) {
      const firstSupplier = filteredSuppliers[0];
      handleSelectSupplier(firstSupplier);
    }
  }, [filteredSuppliers.length, loading]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setSelectedDocumentIds((prev) => {
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
    if (selectedDocumentIds.size === outstandingDocuments.length) {
      setSelectedDocumentIds(new Set());
    } else {
      setSelectedDocumentIds(new Set(outstandingDocuments.map((d) => d.id)));
    }
  }, [outstandingDocuments, selectedDocumentIds.size]);

  const allocateFIFO = useCallback((amount: number): PaymentLine[] => {
    const lines: PaymentLine[] = [];
    let remaining = amount;

    for (const doc of outstandingDocuments) {
      if (remaining <= 0) break;

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
  }, [outstandingDocuments]);

  const handleProceedToPayment = useCallback(() => {
    if (useFIFO) {
      // FIFO allocation
      if (fifoAmount <= 0) {
        toast.error("Please enter a payment amount for FIFO allocation");
        return;
      }
      const lines = allocateFIFO(fifoAmount);
      if (lines.length === 0) {
        toast.error("No documents available for allocation");
        return;
      }
      setPaymentLines(lines);
    } else {
      // Manual selection
      if (selectedDocumentIds.size === 0) {
        toast.error("Please select at least one document");
        return;
      }
      const selectedDocs = outstandingDocuments.filter((d) => selectedDocumentIds.has(d.id));
      const lines: PaymentLine[] = selectedDocs.map((doc, idx) => ({
        id: `line-${idx}`,
        document: doc,
        allocated_amount: doc.remaining_amount, // Default to full amount
      }));
      setPaymentLines(lines);
    }

    setViewMode("payment");
    setActiveStep(1);
  }, [useFIFO, fifoAmount, selectedDocumentIds, outstandingDocuments, allocateFIFO]);

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
    if (totalPaymentAmount <= 0) {
      toast.error("Payment amount must be greater than 0");
      return;
    }

    // Validate payment method specific fields
    if (paymentMethod === "Bank Transfer" && !referenceNumber) {
      toast.error("Please enter bank transfer reference number");
      return;
    }
    if (paymentMethod === "Cheque" && (!referenceNumber || !bankName)) {
      toast.error("Please enter cheque number and bank name");
      return;
    }

    setViewMode("review");
    setActiveStep(2);
  }, [totalPaymentAmount, paymentMethod, referenceNumber, bankName]);

  const handlePostPayment = useCallback(async () => {
    if (!selectedSupplier || paymentLines.length === 0) return;

    // Check if we have mixed payment types
    const paymentTypes = new Set(paymentLines.map((l) => l.document.payment_type));
    const hasCreditPayments = paymentTypes.has("credit");
    const hasNonCreditPayments = paymentTypes.has("non_credit");

    const confirmed = await confirmDialog.confirm({
      title: "Post Payment",
      message: `Post payment of Rs. ${totalPaymentAmount.toLocaleString()} for ${selectedSupplier.full_name}? This action cannot be undone.`,
      confirmText: "Post Payment",
    });

    if (!confirmed) return;

    try {
      setSaving(true);
      setError(null);

      // Process credit payments (use credit settlement API)
      if (hasCreditPayments) {
        const creditLines = paymentLines.filter((l) => l.document.payment_type === "credit");
        
        for (const line of creditLines) {
          if (line.document.grn_id) {
            const transactionData: SupplierCreditsSettleTransactionCreate = {
              payment_method: paymentMethod,
              cheque_date: chequeDate,
              payment_amount: line.allocated_amount,
              payment_method_number: referenceNumber || undefined,
              remarks: remarks || undefined,
              good_received_id: line.document.grn_id,
            };

            const settlementData: SupplierCreditsSettleCreate = {
              supplier_credits_settle_no: `CS-${Date.now()}-${line.document.po_id}`,
              branch_code: line.document.branch_code,
              suppliers_id: selectedSupplier.id,
              transactions: [transactionData],
            };

            await supplierCreditsSettleApi.create(settlementData);
          }
        }
      }

      // Process non-credit payments (use supplier payment API)
      if (hasNonCreditPayments) {
        const nonCreditLines = paymentLines.filter((l) => l.document.payment_type === "non_credit");
        
        for (const line of nonCreditLines) {
          const payload: SupplierPaymentCreate = {
            supplier_id: selectedSupplier.id,
            purchasing_order_id: line.document.po_id,
            payment_date: paymentDate,
            payment_method: paymentMethod,
            payment_amount: line.allocated_amount,
            reference_number: referenceNumber || undefined,
            bank_name: bankName || undefined,
            branch_code: line.document.branch_code,
            payment_for: "Purchase",
            invoice_reference: line.document.invoice_no || line.document.po_no,
            remarks: remarks || undefined,
          };

          await supplierPaymentsApi.create(payload);
        }
      }

      toast.success("Payment posted successfully!");

      // Refresh status and reset
      await loadPaymentStatus(selectedSupplier.id);
      setViewMode("overview");
      setActiveStep(0);
      setSelectedDocumentIds(new Set());
      setPaymentLines([]);
      resetPaymentForm();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      const msg = error.response?.data?.detail || "Failed to post payment";
      setError(msg);
      toast.error(msg);
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
                            Credit: {(supplier.left_credit_amount ?? supplier.max_credit_limit).toLocaleString()} / {supplier.max_credit_limit.toLocaleString()}
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
                          label={`${supplier.credit_days} days`}
                          size="small"
                          color="info"
                          sx={{ height: 18, fontSize: "0.65rem", mt: 0.5 }}
                        />
                      </>
                    )}
                    {outstanding > 0 && (
                      <Typography variant="caption" color="warning.main">
                        Outstanding: Rs. {outstanding.toLocaleString()}
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

  // Render payment history
  const renderHistory = () => (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography variant="h6" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <AssessmentIcon />
          Payment History
        </Typography>
        <Button
          variant="outlined"
          startIcon={<ArrowBackIcon />}
          onClick={() => setViewMode("overview")}
        >
          Back to Overview
        </Button>
      </Box>

      {loadingHistory ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      ) : paymentHistory.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">
            No payment history found for this supplier
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Document No.</TableCell>
                <TableCell>PO/Invoice</TableCell>
                <TableCell>Payment Method</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Branch</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paymentHistory.map((item, index) => (
                <TableRow key={`${item.type}-${item.id}-${index}`} hover>
                  <TableCell>{new Date(item.date).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Chip
                      label={item.type === "credit_settlement" ? "Credit Settlement" : "Payment"}
                      size="small"
                      color={item.type === "credit_settlement" ? "info" : "success"}
                    />
                  </TableCell>
                  <TableCell>
                    {item.type === "credit_settlement" ? item.settle_no : item.payment_no}
                  </TableCell>
                  <TableCell>
                    {item.type === "credit_settlement" 
                      ? "-" // Transactions not loaded in summary
                      : item.po_no || item.invoice_reference || "-"}
                  </TableCell>
                  <TableCell>
                    {item.type === "credit_settlement"
                      ? "-" // Transactions not loaded in summary
                      : item.payment_method || "-"}
                  </TableCell>
                  <TableCell align="right">
                    {item.type === "credit_settlement" 
                      ? "-" // Amount not available without transactions
                      : `Rs. ${item.amount.toLocaleString()}`}
                  </TableCell>
                  <TableCell>
                    {item.type === "payment" && (
                      <Chip
                        label={item.status || "pending"}
                        size="small"
                        color={
                          item.status === "verified"
                            ? "success"
                            : item.status === "cancelled"
                            ? "error"
                            : "default"
                        }
                      />
                    )}
                  </TableCell>
                  <TableCell>{item.branch_code}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
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
                      Rs. {(selectedSupplier?.max_credit_limit || 0).toLocaleString()}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Card variant="outlined">
                  <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">Available</Typography>
                    <Typography variant="h6" color="success.main">
                      Rs. {(paymentStatus?.left_credit_amount || 0).toLocaleString()}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Card variant="outlined" sx={{ bgcolor: "warning.light" }}>
                  <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                    <Typography variant="caption">Credit Outstanding</Typography>
                    <Typography variant="h6" color="warning.dark">
                      Rs. {(paymentStatus?.credit_outstanding || 0).toLocaleString()}
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
              <Card variant="outlined" sx={{ bgcolor: "warning.light" }}>
                <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                  <Typography variant="caption">Total Outstanding</Typography>
                  <Typography variant="h6" color="warning.dark">
                    Rs. {totalOutstanding.toLocaleString()}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Card variant="outlined" sx={{ bgcolor: overdueDocuments.length > 0 ? "error.light" : "success.light" }}>
                <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                  <Typography variant="caption">Overdue Documents</Typography>
                  <Typography variant="h5" color={overdueDocuments.length > 0 ? "error.dark" : "success.dark"}>
                    {overdueDocuments.length}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Card variant="outlined" sx={{ bgcolor: overdueDocuments.length > 0 ? "error.light" : "transparent" }}>
                <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                  <Typography variant="caption">Overdue Amount</Typography>
                  <Typography variant="h6" color={overdueDocuments.length > 0 ? "error.dark" : "text.secondary"}>
                    Rs. {overdueDocuments.reduce((sum, d) => sum + d.remaining_amount, 0).toLocaleString()}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}
      </Paper>

      {/* Outstanding Documents Preview */}
      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
          <Typography variant="subtitle1" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <DescriptionIcon fontSize="small" />
            Outstanding Documents
          </Typography>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button
              variant="outlined"
              color="info"
              startIcon={<AssessmentIcon />}
              onClick={() => {
                setViewMode("history");
                loadPaymentHistory(selectedSupplier!.id);
              }}
            >
              View History
            </Button>
            <Button
              variant="contained"
              color="primary"
              startIcon={<PaymentIcon />}
              onClick={handleStartPayment}
              disabled={outstandingDocuments.length === 0}
            >
              Make Payment
            </Button>
          </Box>
        </Box>

        {/* Filters Section */}
        <Box sx={{ mb: 2 }}>
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
            sx={{ minWidth: 200, mb: 2 }}
            disableClearable
          />
        </Box>

        {/* Payment Type Tabs */}
        <Tabs
          value={paymentTypeTab}
          onChange={(_, v) => setPaymentTypeTab(v)}
          sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
        >
          <Tab
            label={`All (${paymentStatus ? (paymentStatus.credit_purchase_orders?.filter(p => !p.is_settled && p.has_grn && p.remaining_amount > 0).length || 0) + (paymentStatus.non_credit_purchase_orders?.filter(p => !p.is_paid && p.has_grn && p.remaining_amount > 0).length || 0) : 0})`}
            value="all"
          />
          <Tab
            label={`Credit (${paymentStatus?.credit_purchase_orders?.filter(p => !p.is_settled && p.has_grn && p.remaining_amount > 0).length || 0})`}
            value="credit"
            icon={<CreditCardIcon sx={{ fontSize: 16 }} />}
            iconPosition="start"
          />
          <Tab
            label={`Non-Credit (${paymentStatus?.non_credit_purchase_orders?.filter(p => !p.is_paid && p.has_grn && p.remaining_amount > 0).length || 0})`}
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
                  <TableCell>Document</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell>Due Date</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell align="right">Outstanding</TableCell>
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
                        <Typography variant="body2">{doc.po_no}</Typography>
                        {doc.invoice_no && (
                          <Typography variant="caption" color="text.secondary">
                            Inv: {doc.invoice_no}
                          </Typography>
                        )}
                        {doc.grn_no && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            GRN: {doc.grn_no}
                          </Typography>
                        )}
                      </Box>
                    </TableCell>
                    <TableCell>{new Date(doc.date).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Typography color={doc.is_overdue ? "error" : "text.primary"}>
                        {new Date(doc.due_date).toLocaleDateString()}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      Rs. {doc.total_amount.toLocaleString()}
                    </TableCell>
                    <TableCell align="right">
                      <Typography color="warning.main" fontWeight="bold">
                        Rs. {doc.remaining_amount.toLocaleString()}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {doc.is_overdue ? (
                        <Chip
                          label={`${doc.days_overdue}d overdue`}
                          size="small"
                          color="error"
                          icon={<WarningIcon />}
                        />
                      ) : (
                        <Chip label="Due" size="small" color="warning" />
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
              value={fifoAmount}
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
                  checked={selectedDocumentIds.size === outstandingDocuments.length && outstandingDocuments.length > 0}
                  indeterminate={selectedDocumentIds.size > 0 && selectedDocumentIds.size < outstandingDocuments.length}
                  onChange={handleSelectAll}
                />
              }
              label="Select All"
            />
            <Typography variant="body2" color="text.secondary">
              {selectedDocumentIds.size} of {outstandingDocuments.length} selected
            </Typography>
          </Box>
        )}

        <TableContainer sx={{ maxHeight: 400 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {!useFIFO && <TableCell padding="checkbox" />}
                <TableCell>Type</TableCell>
                <TableCell>Document</TableCell>
                <TableCell>Due Date</TableCell>
                <TableCell align="right">Outstanding</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {outstandingDocuments.map((doc) => (
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
                      {doc.grn_no && (
                        <Typography variant="caption" color="text.secondary">
                          GRN: {doc.grn_no}
                        </Typography>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography color={doc.is_overdue ? "error" : "text.primary"}>
                      {new Date(doc.due_date).toLocaleDateString()}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography fontWeight="bold">
                      Rs. {doc.remaining_amount.toLocaleString()}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {doc.is_overdue && (
                      <Chip label={`${doc.days_overdue}d overdue`} size="small" color="error" />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Summary */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography variant="subtitle1">
            {useFIFO
              ? `FIFO Amount: Rs. ${fifoAmount.toLocaleString()}`
              : `Selected: ${selectedDocumentIds.size} documents`}
          </Typography>
          <Typography variant="h6" color="primary.main">
            {useFIFO
              ? `Will allocate to ${allocateFIFO(fifoAmount).length} document(s)`
              : `Total: Rs. ${outstandingDocuments
                  .filter((d) => selectedDocumentIds.has(d.id))
                  .reduce((sum, d) => sum + d.remaining_amount, 0)
                  .toLocaleString()}`}
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
          disabled={!useFIFO && selectedDocumentIds.size === 0}
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
                <TableCell align="right" sx={{ width: 180 }}>Payment Amount</TableCell>
                <TableCell sx={{ width: 50 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {paymentLines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <Box>
                      <Typography variant="body2">{line.document.po_no}</Typography>
                      {line.document.grn_no && (
                        <Typography variant="caption" color="text.secondary">
                          GRN: {line.document.grn_no}
                        </Typography>
                      )}
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
                    Rs. {line.document.remaining_amount.toLocaleString()}
                  </TableCell>
                  <TableCell align="right">
                    <TextField
                      type="number"
                      size="small"
                      value={line.allocated_amount}
                      onChange={(e) => handleLineAmountChange(line.id, Number(e.target.value))}
                      InputProps={{
                        startAdornment: <InputAdornment position="start">Rs.</InputAdornment>,
                      }}
                      inputProps={{
                        min: 0,
                        max: line.document.remaining_amount,
                        step: 0.01,
                      }}
                      sx={{ width: 150 }}
                    />
                  </TableCell>
                  <TableCell>
                    <IconButton size="small" color="error" onClick={() => handleRemoveLine(line.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={3} align="right">
                  <Typography variant="subtitle1" fontWeight="bold">Total Payment:</Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography variant="h6" color="primary.main">
                    Rs. {totalPaymentAmount.toLocaleString()}
                  </Typography>
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Payment Method */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Payment Method
        </Typography>
        <Divider sx={{ mb: 2 }} />

        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField
              select
              fullWidth
              label="Payment Method"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              {PAYMENT_METHODS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Payment Date"
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label={paymentMethod === "Cheque" ? "Cheque Number" : "Reference Number"}
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              required={paymentMethod !== "Cash"}
            />
          </Grid>
          {paymentMethod === "Cheque" && (
            <>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Bank Name"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  required
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Cheque Date"
                  type="date"
                  value={chequeDate}
                  onChange={(e) => setChequeDate(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
            </>
          )}
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Remarks"
              multiline
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </Grid>
        </Grid>
      </Paper>

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
                <TableCell align="right">Outstanding</TableCell>
                <TableCell align="right">Payment</TableCell>
                <TableCell align="right">Remaining After</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paymentLines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <Box>
                      <Typography variant="body2">{line.document.po_no}</Typography>
                      {line.document.grn_no && (
                        <Typography variant="caption" color="text.secondary">
                          GRN: {line.document.grn_no}
                        </Typography>
                      )}
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
                    Rs. {line.document.remaining_amount.toLocaleString()}
                  </TableCell>
                  <TableCell align="right">
                    <Typography color="primary.main" fontWeight="bold">
                      Rs. {line.allocated_amount.toLocaleString()}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography color={line.document.remaining_amount - line.allocated_amount > 0 ? "warning.main" : "success.main"}>
                      Rs. {(line.document.remaining_amount - line.allocated_amount).toLocaleString()}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={3} align="right">
                  <Typography variant="subtitle1" fontWeight="bold">Total Payment:</Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography variant="h5" color="primary.main">
                    Rs. {totalPaymentAmount.toLocaleString()}
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
          ...(viewMode === "history" ? [{ label: "Payment History" }] : viewMode !== "overview" ? [{ label: STEPS[activeStep] }] : []),
        ]}
        title={
          viewMode === "history"
            ? "Payment History"
            : viewMode === "review"
            ? "Review & Post"
            : viewMode === "payment"
            ? "Payment Details"
            : viewMode === "documents"
            ? "Select Documents"
            : selectedSupplier?.full_name || ""
        }
        titleIcon={
          viewMode === "history" ? (
            <AssessmentIcon color="info" />
          ) : viewMode === "review" ? (
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
          viewMode === "history"
            ? [
                { label: `${paymentHistory.length} Payment${paymentHistory.length !== 1 ? "s" : ""}`, color: "info" as const },
              ]
            : selectedSupplier && viewMode === "overview"
            ? [
                { label: `${outstandingDocuments.length} Open Docs`, variant: "outlined" as const },
                ...(totalOutstanding > 0
                  ? [{ label: `Rs. ${totalOutstanding.toLocaleString()} Outstanding`, color: "warning" as const }]
                  : []),
              ]
            : viewMode !== "overview"
            ? [
                { label: `Rs. ${totalPaymentAmount.toLocaleString()}`, color: "primary" as const },
              ]
            : []
        }
      />

      {/* Stepper for payment workflow */}
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
        {!selectedSupplier ? (
          <Box sx={{ p: 2 }}>
            <EmptyState message="Select a supplier from the list to view outstanding documents and make payments" />
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

      <ConfirmDialog {...confirmDialog.dialogProps} />
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
