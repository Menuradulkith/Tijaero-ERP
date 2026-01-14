/**
 * SupplierPaymentsPage - Manage direct supplier payments (non-credit)
 * 
 * Multi-step workflow:
 * 1. Select supplier from left panel → View open documents (GRNs/Invoices)
 * 2. Choose payment style (single/partial/multiple documents or lump sum with FIFO)
 * 3. Create payment voucher header (auto payment_no, DRAFT status)
 * 4. Add payment lines allocating amounts to specific documents
 * 5. Enter payment method details (Cash/Bank Transfer/Cheque)
 * 6. POST payment - lock voucher, update ledger, mark documents as PAID/PARTIALLY_PAID
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Box,
  TextField,
  MenuItem,
  Alert,
  CircularProgress,
  Chip,
  List,
  ListItemButton,
  ListItemText,
  Typography,
  Paper,
  Divider,
  Button,
  Card,
  CardContent,
  Grid,
  Autocomplete,
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
  Tooltip,
} from "@mui/material";
import PaymentIcon from "@mui/icons-material/Payment";
import BusinessIcon from "@mui/icons-material/Business";
import ReceiptIcon from "@mui/icons-material/Receipt";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import DescriptionIcon from "@mui/icons-material/Description";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteIcon from "@mui/icons-material/Delete";
import PostAddIcon from "@mui/icons-material/PostAdd";
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
  supplierCreditApi,
  supplierPaymentsApi,
  SupplierCreditStatus,
} from "@/modules/purchasing/api";
import { branchApi } from "@/modules/branches/api";
import { Supplier, SupplierPaymentCreate } from "@/modules/purchasing/types";

// Configuration
const SORT_OPTIONS: SortOption[] = [
  { value: "full_name", label: "Name" },
  { value: "outstanding", label: "Outstanding" },
];

const PAYMENT_METHODS = [
  { value: "Cash", label: "Cash" },
  { value: "Bank Transfer", label: "Bank Transfer" },
  { value: "Cheque", label: "Cheque" },
];

const PAYMENT_STYLES = [
  { value: "single", label: "Pay Single Document", description: "Pay one document in full" },
  { value: "partial", label: "Partial Payment", description: "Pay part of one document" },
  { value: "multiple", label: "Pay Multiple Documents", description: "Select multiple documents to pay" },
  { value: "fifo", label: "Lump Sum (FIFO)", description: "Enter amount and auto-allocate by oldest first" },
];

// Open document from API
interface OpenDocument {
  id: number;
  type: "grn" | "invoice";
  document_no: string;
  invoice_no: string | null;
  date: string;
  due_date: string;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  days_overdue: number;
  is_overdue: boolean;
  branch_code: string;
  po_id: number | null;
}

// Payment line for allocation
interface PaymentLine {
  id: string;
  document_id: number;
  document_type: "grn" | "invoice";
  document_no: string;
  total_amount: number;
  remaining_amount: number;
  allocated_amount: number;
}

// Payment voucher header
interface PaymentVoucher {
  payment_no: string;
  supplier_id: number;
  branch_code: string;
  payment_date: string;
  status: "draft" | "posted";
  lines: PaymentLine[];
  payment_method: string;
  reference_number: string;
  bank_name: string;
  cheque_date: string;
  total_amount: number;
  remarks: string;
}

// Steps in the workflow
const STEPS = ["Select Supplier", "Choose Documents", "Payment Details", "Review & Post"];

// View mode enum
type ViewMode = "supplier" | "documents" | "payment" | "review";

export default function SupplierPaymentsPage() {
  // Data state
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selection state
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("full_name");
  const [showOnlyWithOutstanding, setShowOnlyWithOutstanding] = useState(true);

  // View state
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [supplierCreditStatus, setSupplierCreditStatus] = useState<SupplierCreditStatus | null>(null);
  const [loadingCredit, setLoadingCredit] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>("supplier");
  const [activeStep, setActiveStep] = useState(0);

  // Payment style state
  const [paymentStyle, setPaymentStyle] = useState<string>("single");
  const [selectedDocuments, setSelectedDocuments] = useState<Set<number>>(new Set());

  // Payment voucher state
  const [paymentVoucher, setPaymentVoucher] = useState<PaymentVoucher | null>(null);

  const confirmDialog = useConfirmDialog();

  // Load branches
  const [branches, setBranches] = useState<{ branch_code: string; branch_name: string }[]>([]);
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  // Load suppliers
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

  const getBranchDisplay = (branchCode: string) => {
    const branch = branches.find((b) => b.branch_code === branchCode);
    return branch ? `${branch.branch_code} - ${branch.branch_name}` : branchCode;
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

  // Load non-credit status for selected supplier (for supplier payments)
  const loadSupplierCredit = useCallback(async (supplierId: number) => {
    try {
      setLoadingCredit(true);
      const status = await supplierCreditApi.getNonCreditStatus(supplierId);
      setSupplierCreditStatus(status);
    } catch (err) {
      console.error("Failed to load non-credit status:", err);
      setSupplierCreditStatus(null);
    } finally {
      setLoadingCredit(false);
    }
  }, []);

  // Transform non-credit data to open documents
  const openDocuments = useMemo((): OpenDocument[] => {
    if (!supplierCreditStatus) return [];

    // Combine unpaid GRNs and non-credit POs with remaining amounts
    const docs: OpenDocument[] = [];

    // Add unpaid GRNs
    supplierCreditStatus.unpaid_grns?.forEach((grn) => {
      if (grn.remaining_amount > 0) {
        docs.push({
          id: grn.grn_id,
          type: "grn",
          document_no: grn.grn_no,
          invoice_no: grn.supplier_invoice_no,
          date: grn.grn_date,
          due_date: grn.due_date,
          total_amount: grn.remaining_amount + (grn.remaining_amount - grn.remaining_amount), // placeholder
          paid_amount: 0,
          remaining_amount: grn.remaining_amount,
          days_overdue: grn.days_overdue,
          is_overdue: grn.is_overdue,
          branch_code: "", // Not available in GRN data
          po_id: null,
        });
      }
    });

    // Add non-credit POs with GRN and remaining amounts (completed or partially_completed)
    supplierCreditStatus.non_credit_purchase_orders?.forEach((po) => {
      if (
        (po.status === "completed" || po.status === "partially_completed") &&
        po.has_grn &&
        po.remaining_amount > 0 &&
        !po.is_paid
      ) {
        // Check if we already added this as a GRN
        const existingGRN = docs.find((d) => d.type === "grn" && d.id === po.grn_id);
        if (!existingGRN) {
          docs.push({
            id: po.po_id,
            type: "invoice",
            document_no: po.po_no,
            invoice_no: po.invoice_no,
            date: po.po_date,
            due_date: po.due_date,
            total_amount: po.total_amount,
            paid_amount: po.paid_amount,
            remaining_amount: po.remaining_amount,
            days_overdue: po.days_overdue,
            is_overdue: po.is_overdue,
            branch_code: po.branch_code,
            po_id: po.po_id,
          });
        }
      }
    });

    // Apply branch filter
    let filtered = docs;
    if (filterBranch) {
      filtered = filtered.filter((d) => d.branch_code === filterBranch);
    }

    // Sort by due date (oldest first)
    filtered.sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());

    return filtered;
  }, [supplierCreditStatus, filterBranch]);

  // Calculate totals
  const totalOutstanding = useMemo(() => {
    return openDocuments.reduce((sum, doc) => sum + doc.remaining_amount, 0);
  }, [openDocuments]);

  const overdueDocuments = useMemo(() => {
    return openDocuments.filter((doc) => doc.is_overdue);
  }, [openDocuments]);

  // Filtered suppliers
  const filteredSuppliers = useMemo(() => {
    let filtered = suppliers;

    if (showOnlyWithOutstanding) {
      // For now show all, outstanding will be calculated when selected
      filtered = filtered.filter((s) => s.max_credit_limit > 0 || true); // Show all for now
    }

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
        default:
          return 0;
      }
    });

    return filtered;
  }, [suppliers, showOnlyWithOutstanding, searchQuery, sortField]);

  // Handlers
  const handleSelectSupplier = useCallback((supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setViewMode("supplier");
    setActiveStep(0);
    setSelectedDocuments(new Set());
    setPaymentVoucher(null);
    setPaymentStyle("single");
    loadSupplierCredit(supplier.id);
  }, [loadSupplierCredit]);

  // Auto-select first supplier when data loads
  useEffect(() => {
    if (filteredSuppliers.length > 0 && !selectedSupplier && !loading) {
      const firstSupplier = filteredSuppliers[0];
      setSelectedSupplier(firstSupplier);
      loadSupplierCredit(firstSupplier.id);
    }
  }, [filteredSuppliers.length, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleProceedToDocuments = useCallback(() => {
    setViewMode("documents");
    setActiveStep(1);
  }, []);

  const handleSelectDocument = useCallback((docId: number) => {
    setSelectedDocuments((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        // For single payment, clear others first
        if (paymentStyle === "single" || paymentStyle === "partial") {
          next.clear();
        }
        next.add(docId);
      }
      return next;
    });
  }, [paymentStyle]);

  const handleProceedToPayment = useCallback(() => {
    if (selectedDocuments.size === 0 && paymentStyle !== "fifo") {
      toast.error("Please select at least one document");
      return;
    }

    if (!selectedSupplier) return;

    // Create payment voucher
    const selectedDocs = openDocuments.filter((d) => selectedDocuments.has(d.id));
    const lines: PaymentLine[] = selectedDocs.map((doc, idx) => ({
      id: `line-${idx}`,
      document_id: doc.id,
      document_type: doc.type,
      document_no: doc.document_no,
      total_amount: doc.total_amount,
      remaining_amount: doc.remaining_amount,
      allocated_amount: doc.remaining_amount, // Default to full amount
    }));

    const totalAllocated = lines.reduce((sum, l) => sum + l.allocated_amount, 0);
    const defaultBranch = branches.length > 0 ? branches[0].branch_code : "";

    setPaymentVoucher({
      payment_no: `SP-${Date.now()}`,
      supplier_id: selectedSupplier.id,
      branch_code: selectedDocs[0]?.branch_code || defaultBranch,
      payment_date: new Date().toISOString().split("T")[0],
      status: "draft",
      lines,
      payment_method: "Bank Transfer",
      reference_number: "",
      bank_name: "",
      cheque_date: new Date().toISOString().split("T")[0],
      total_amount: totalAllocated,
      remarks: "",
    });

    setViewMode("payment");
    setActiveStep(2);
  }, [selectedDocuments, openDocuments, selectedSupplier, branches, paymentStyle]);

  const handleLineAmountChange = useCallback((lineId: string, amount: number) => {
    setPaymentVoucher((prev) => {
      if (!prev) return null;
      const updatedLines = prev.lines.map((line) => {
        if (line.id === lineId) {
          const clampedAmount = Math.min(Math.max(0, amount), line.remaining_amount);
          return { ...line, allocated_amount: clampedAmount };
        }
        return line;
      });
      const newTotal = updatedLines.reduce((sum, l) => sum + l.allocated_amount, 0);
      return { ...prev, lines: updatedLines, total_amount: newTotal };
    });
  }, []);

  const handleRemoveLine = useCallback((lineId: string) => {
    setPaymentVoucher((prev) => {
      if (!prev) return null;
      const updatedLines = prev.lines.filter((line) => line.id !== lineId);
      const newTotal = updatedLines.reduce((sum, l) => sum + l.allocated_amount, 0);
      return { ...prev, lines: updatedLines, total_amount: newTotal };
    });
  }, []);

  const handleVoucherChange = useCallback(
    (field: keyof PaymentVoucher) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setPaymentVoucher((prev) => {
        if (!prev) return null;
        return { ...prev, [field]: e.target.value };
      });
    },
    []
  );

  const handleFIFOAllocation = useCallback((totalAmount: number) => {
    if (!selectedSupplier) return;

    // Allocate amount to documents in FIFO order (oldest first)
    let remaining = totalAmount;
    const lines: PaymentLine[] = [];

    for (const doc of openDocuments) {
      if (remaining <= 0) break;

      const allocate = Math.min(remaining, doc.remaining_amount);
      if (allocate > 0) {
        lines.push({
          id: `line-${lines.length}`,
          document_id: doc.id,
          document_type: doc.type,
          document_no: doc.document_no,
          total_amount: doc.total_amount,
          remaining_amount: doc.remaining_amount,
          allocated_amount: allocate,
        });
        remaining -= allocate;
      }
    }

    const defaultBranch = branches.length > 0 ? branches[0].branch_code : "";

    setPaymentVoucher((prev) => ({
      payment_no: prev?.payment_no || `SP-${Date.now()}`,
      supplier_id: selectedSupplier.id,
      branch_code: lines[0]?.document_no ? openDocuments.find((d) => d.document_no === lines[0].document_no)?.branch_code || defaultBranch : defaultBranch,
      payment_date: prev?.payment_date || new Date().toISOString().split("T")[0],
      status: "draft",
      lines,
      payment_method: prev?.payment_method || "Bank Transfer",
      reference_number: prev?.reference_number || "",
      bank_name: prev?.bank_name || "",
      cheque_date: prev?.cheque_date || new Date().toISOString().split("T")[0],
      total_amount: totalAmount - remaining,
      remarks: prev?.remarks || "",
    }));
  }, [selectedSupplier, openDocuments, branches]);

  const handleProceedToReview = useCallback(() => {
    if (!paymentVoucher || paymentVoucher.total_amount <= 0) {
      toast.error("Payment amount must be greater than 0");
      return;
    }

    // Validate payment method specific fields
    if (paymentVoucher.payment_method === "Bank Transfer" && !paymentVoucher.reference_number) {
      toast.error("Please enter bank transfer reference number");
      return;
    }
    if (paymentVoucher.payment_method === "Cheque" && (!paymentVoucher.reference_number || !paymentVoucher.bank_name)) {
      toast.error("Please enter cheque number and bank name");
      return;
    }

    setViewMode("review");
    setActiveStep(3);
  }, [paymentVoucher]);

  const handlePostPayment = useCallback(async () => {
    if (!paymentVoucher || !selectedSupplier) return;

    const confirmed = await confirmDialog.confirm({
      title: "Post Payment",
      message: `Post payment of Rs. ${paymentVoucher.total_amount.toLocaleString()} for ${selectedSupplier.full_name}? This action cannot be undone.`,
      confirmText: "Post Payment",
    });

    if (!confirmed) return;

    try {
      setSaving(true);
      setError(null);

      // Create supplier payment
      const payload: SupplierPaymentCreate = {
        supplier_id: paymentVoucher.supplier_id,
        purchasing_order_id: paymentVoucher.lines[0]?.document_type === "invoice" ? paymentVoucher.lines[0].document_id : undefined,
        payment_date: paymentVoucher.payment_date,
        payment_method: paymentVoucher.payment_method,
        payment_amount: paymentVoucher.total_amount,
        reference_number: paymentVoucher.reference_number || undefined,
        bank_name: paymentVoucher.bank_name || undefined,
        branch_code: paymentVoucher.branch_code,
        payment_for: "Purchase",
        invoice_reference: paymentVoucher.lines.map((l) => l.document_no).join(", "),
        remarks: paymentVoucher.remarks || undefined,
      };

      await supplierPaymentsApi.create(payload);
      toast.success("Payment posted successfully!");

      // Refresh supplier credit info
      await loadSupplierCredit(selectedSupplier.id);

      // Reset to supplier view
      setViewMode("supplier");
      setActiveStep(0);
      setSelectedDocuments(new Set());
      setPaymentVoucher(null);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      const msg = error.response?.data?.detail || "Failed to post payment";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }, [paymentVoucher, selectedSupplier, confirmDialog, loadSupplierCredit]);

  const handleBack = useCallback(() => {
    switch (viewMode) {
      case "documents":
        setViewMode("supplier");
        setActiveStep(0);
        break;
      case "payment":
        setViewMode("documents");
        setActiveStep(1);
        break;
      case "review":
        setViewMode("payment");
        setActiveStep(2);
        break;
    }
  }, [viewMode]);

  const handleCancelPayment = useCallback(() => {
    setViewMode("supplier");
    setActiveStep(0);
    setSelectedDocuments(new Set());
    setPaymentVoucher(null);
  }, []);

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
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Chip
              label="With Outstanding"
              size="small"
              variant={showOnlyWithOutstanding ? "filled" : "outlined"}
              color={showOnlyWithOutstanding ? "primary" : "default"}
              onClick={() => setShowOnlyWithOutstanding(!showOnlyWithOutstanding)}
            />
            <Typography variant="caption" color="text.secondary">
              {filteredSuppliers.length} suppliers
            </Typography>
          </Box>
        </Box>
      }
      renderItem={(supplier, isSelected) => {
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
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {supplier.company_name || "Individual"}
                      </Typography>
                    </Box>
                    {supplier.max_credit_limit > 0 && (
                      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <Typography component="span" variant="caption" color="warning.main">
                          Outstanding: Rs. {outstanding.toLocaleString()}
                        </Typography>
                      </Box>
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
                    <Typography variant="caption" display="block" color="warning.main">
                      Outstanding: Rs. {outstanding.toLocaleString()}
                    </Typography>
                  )}
                </Box>
              ) : undefined
            }
          />
        );
      }}
    />
  );

  // Render supplier info view (Step 1)
  const renderSupplierView = () => (
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

        {/* Outstanding Summary */}
        <Typography variant="subtitle1" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <AccountBalanceIcon fontSize="small" />
          Outstanding Summary
        </Typography>

        {loadingCredit ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={6} sm={3}>
              <Card variant="outlined">
                <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">Open Documents</Typography>
                  <Typography variant="h5" color="primary.main">
                    {openDocuments.length}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Card variant="outlined">
                <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">Total Outstanding</Typography>
                  <Typography variant="h6" color="warning.main">
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

      {/* Open Documents Preview */}
      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle1" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <DescriptionIcon fontSize="small" />
          Open Documents ({openDocuments.length})
        </Typography>

        <Divider sx={{ my: 1 }} />

        {openDocuments.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
            No open documents for this supplier
          </Typography>
        ) : (
          <>
            <TableContainer sx={{ maxHeight: 300 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Document</TableCell>
                    <TableCell>Date</TableCell>
                    <TableCell>Due Date</TableCell>
                    <TableCell align="right">Outstanding</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {openDocuments.slice(0, 5).map((doc) => (
                    <TableRow key={`${doc.type}-${doc.id}`}>
                      <TableCell>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                          {doc.type === "grn" ? (
                            <ReceiptIcon fontSize="small" color="primary" />
                          ) : (
                            <DescriptionIcon fontSize="small" color="secondary" />
                          )}
                          <Box>
                            <Typography variant="body2">{doc.document_no}</Typography>
                            {doc.invoice_no && (
                              <Typography variant="caption" color="text.secondary">
                                Inv: {doc.invoice_no}
                              </Typography>
                            )}
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell>{new Date(doc.date).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <Typography color={doc.is_overdue ? "error" : "text.primary"}>
                          {new Date(doc.due_date).toLocaleDateString()}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography fontWeight="medium">
                          Rs. {doc.remaining_amount.toLocaleString()}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={doc.is_overdue ? `${doc.days_overdue}d overdue` : "Due"}
                          color={doc.is_overdue ? "error" : "warning"}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {openDocuments.length > 5 && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
                +{openDocuments.length - 5} more documents
              </Typography>
            )}
          </>
        )}

        {/* Action Buttons */}
        {openDocuments.length > 0 && (
          <Box sx={{ mt: 3, display: "flex", justifyContent: "flex-end" }}>
            <Button
              variant="contained"
              color="primary"
              startIcon={<PaymentIcon />}
              onClick={handleProceedToDocuments}
            >
              Make Payment
            </Button>
          </Box>
        )}
      </Paper>
    </Box>
  );

  // Render document selection view (Step 2)
  const renderDocumentsView = () => (
    <Box sx={{ p: 2 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={handleBack} sx={{ mb: 2 }}>
        Back to Supplier
      </Button>

      {/* Payment Style Selection */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle1" gutterBottom>
          Payment Style
        </Typography>
        <Grid container spacing={2}>
          {PAYMENT_STYLES.map((style) => (
            <Grid item xs={6} sm={3} key={style.value}>
              <Card
                variant="outlined"
                sx={{
                  cursor: "pointer",
                  bgcolor: paymentStyle === style.value ? "primary.light" : "transparent",
                  borderColor: paymentStyle === style.value ? "primary.main" : "divider",
                  "&:hover": { borderColor: "primary.main" },
                }}
                onClick={() => {
                  setPaymentStyle(style.value);
                  setSelectedDocuments(new Set());
                }}
              >
                <CardContent sx={{ textAlign: "center", py: 2 }}>
                  <Typography variant="subtitle2">{style.label}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {style.description}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Paper>

      {/* FIFO Lump Sum Input */}
      {paymentStyle === "fifo" && (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Typography variant="subtitle1" gutterBottom>
            Enter Payment Amount
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Amount will be automatically allocated to documents starting from the oldest.
          </Typography>
          <Box sx={{ display: "flex", gap: 2, alignItems: "center", mt: 2 }}>
            <TextField
              label="Payment Amount"
              type="number"
              size="small"
              sx={{ width: 200 }}
              InputProps={{
                startAdornment: <InputAdornment position="start">Rs.</InputAdornment>,
              }}
              value={paymentVoucher?.total_amount || ""}
              onChange={(e) => handleFIFOAllocation(Number(e.target.value))}
            />
            <Typography variant="body2">
              Max: Rs. {totalOutstanding.toLocaleString()}
            </Typography>
          </Box>

          {/* FIFO Allocation Preview */}
          {paymentVoucher && paymentVoucher.lines.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                Allocation Preview:
              </Typography>
              <List dense>
                {paymentVoucher.lines.map((line) => (
                  <ListItemButton key={line.id} dense>
                    <ListItemText
                      primary={line.document_no}
                      secondary={`Rs. ${line.allocated_amount.toLocaleString()} of ${line.remaining_amount.toLocaleString()}`}
                    />
                    <Chip
                      size="small"
                      label={line.allocated_amount >= line.remaining_amount ? "Full" : "Partial"}
                      color={line.allocated_amount >= line.remaining_amount ? "success" : "warning"}
                    />
                  </ListItemButton>
                ))}
              </List>
            </Box>
          )}
        </Paper>
      )}

      {/* Document Selection */}
      {paymentStyle !== "fifo" && (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Typography variant="subtitle1" gutterBottom>
            Select Documents to Pay
          </Typography>

          {/* Branch Filter */}
          <Autocomplete
            size="small"
            options={branches}
            getOptionLabel={(option) => `${option.branch_code} - ${option.branch_name}`}
            value={branches.find((b) => b.branch_code === filterBranch) || null}
            onChange={(_, newValue) => setFilterBranch(newValue?.branch_code || null)}
            renderInput={(params) => (
              <TextField {...params} label="Filter by Branch" placeholder="All Branches" />
            )}
            sx={{ mb: 2, width: 300 }}
          />

          <TableContainer sx={{ maxHeight: 400 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    {paymentStyle === "multiple" && (
                      <Checkbox
                        indeterminate={selectedDocuments.size > 0 && selectedDocuments.size < openDocuments.length}
                        checked={selectedDocuments.size === openDocuments.length && openDocuments.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedDocuments(new Set(openDocuments.map((d) => d.id)));
                          } else {
                            setSelectedDocuments(new Set());
                          }
                        }}
                      />
                    )}
                  </TableCell>
                  <TableCell>Document</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell>Due Date</TableCell>
                  <TableCell>Days Overdue</TableCell>
                  <TableCell align="right">Outstanding</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {openDocuments.map((doc) => (
                  <TableRow
                    key={`${doc.type}-${doc.id}`}
                    hover
                    selected={selectedDocuments.has(doc.id)}
                    onClick={() => handleSelectDocument(doc.id)}
                    sx={{ cursor: "pointer" }}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox checked={selectedDocuments.has(doc.id)} />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        {doc.type === "grn" ? (
                          <ReceiptIcon fontSize="small" color="primary" />
                        ) : (
                          <DescriptionIcon fontSize="small" color="secondary" />
                        )}
                        <Box>
                          <Typography variant="body2">{doc.document_no}</Typography>
                          {doc.invoice_no && (
                            <Typography variant="caption" color="text.secondary">
                              Inv: {doc.invoice_no}
                            </Typography>
                          )}
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell>{new Date(doc.date).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Typography color={doc.is_overdue ? "error" : "text.primary"}>
                        {new Date(doc.due_date).toLocaleDateString()}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {doc.is_overdue ? (
                        <Chip size="small" label={`${doc.days_overdue}d`} color="error" />
                      ) : (
                        <Typography color="text.secondary">-</Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Typography fontWeight="medium">
                        Rs. {doc.remaining_amount.toLocaleString()}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Selection Summary */}
          {selectedDocuments.size > 0 && (
            <Box sx={{ mt: 2, p: 2, bgcolor: "primary.light", borderRadius: 1 }}>
              <Typography variant="body2">
                Selected: {selectedDocuments.size} document(s) • Total: Rs.{" "}
                {openDocuments
                  .filter((d) => selectedDocuments.has(d.id))
                  .reduce((sum, d) => sum + d.remaining_amount, 0)
                  .toLocaleString()}
              </Typography>
            </Box>
          )}
        </Paper>
      )}

      {/* Action Buttons */}
      <Box sx={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
        <Button variant="outlined" onClick={handleCancelPayment}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="primary"
          onClick={handleProceedToPayment}
          disabled={paymentStyle !== "fifo" && selectedDocuments.size === 0}
        >
          Continue to Payment Details
        </Button>
      </Box>
    </Box>
  );

  // Render payment details view (Step 3)
  const renderPaymentView = () => (
    <Box sx={{ p: 2 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={handleBack} sx={{ mb: 2 }}>
        Back to Documents
      </Button>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Payment Voucher Header */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <PostAddIcon />
          Payment Voucher
          <Chip label="DRAFT" size="small" color="warning" sx={{ ml: 1 }} />
        </Typography>
        <Divider sx={{ mb: 2 }} />

        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Payment Number"
              value={paymentVoucher?.payment_no || ""}
              size="small"
              fullWidth
              disabled
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Payment Date"
              type="date"
              value={paymentVoucher?.payment_date || ""}
              onChange={handleVoucherChange("payment_date")}
              size="small"
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Branch"
              value={paymentVoucher?.branch_code || ""}
              size="small"
              fullWidth
              select
              onChange={handleVoucherChange("branch_code")}
            >
              {branches.map((branch) => (
                <MenuItem key={branch.branch_code} value={branch.branch_code}>
                  {branch.branch_code} - {branch.branch_name}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Supplier"
              value={selectedSupplier?.full_name || ""}
              size="small"
              fullWidth
              disabled
            />
          </Grid>
        </Grid>
      </Paper>

      {/* Payment Lines */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle1" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <DescriptionIcon fontSize="small" />
          Allocation Details
        </Typography>
        <Divider sx={{ mb: 2 }} />

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Document</TableCell>
                <TableCell align="right">Outstanding</TableCell>
                <TableCell align="right">Allocate Amount</TableCell>
                <TableCell align="center">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paymentVoucher?.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      {line.document_type === "grn" ? (
                        <ReceiptIcon fontSize="small" color="primary" />
                      ) : (
                        <DescriptionIcon fontSize="small" color="secondary" />
                      )}
                      {line.document_no}
                    </Box>
                  </TableCell>
                  <TableCell align="right">
                    Rs. {line.remaining_amount.toLocaleString()}
                  </TableCell>
                  <TableCell align="right">
                    <TextField
                      type="number"
                      size="small"
                      value={line.allocated_amount}
                      onChange={(e) => handleLineAmountChange(line.id, Number(e.target.value))}
                      sx={{ width: 150 }}
                      InputProps={{
                        startAdornment: <InputAdornment position="start">Rs.</InputAdornment>,
                        inputProps: { min: 0, max: line.remaining_amount, step: 0.01 },
                      }}
                      error={line.allocated_amount > line.remaining_amount}
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Tooltip title="Remove">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleRemoveLine(line.id)}
                        disabled={paymentVoucher.lines.length === 1}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={2}>
                  <Typography variant="subtitle2">Total Payment Amount</Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography variant="h6" color="primary">
                    Rs. {(paymentVoucher?.total_amount || 0).toLocaleString()}
                  </Typography>
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Payment Method Details */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle1" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <PaymentIcon fontSize="small" />
          Payment Method
        </Typography>
        <Divider sx={{ mb: 2 }} />

        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Payment Method"
              value={paymentVoucher?.payment_method || ""}
              onChange={handleVoucherChange("payment_method")}
              size="small"
              fullWidth
              select
              required
            >
              {PAYMENT_METHODS.map((method) => (
                <MenuItem key={method.value} value={method.value}>
                  {method.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>

          {/* Bank Transfer specific fields */}
          {paymentVoucher?.payment_method === "Bank Transfer" && (
            <>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Transfer Reference Number"
                  value={paymentVoucher.reference_number}
                  onChange={handleVoucherChange("reference_number")}
                  size="small"
                  fullWidth
                  required
                  placeholder="Enter bank transfer reference"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Bank Name"
                  value={paymentVoucher.bank_name}
                  onChange={handleVoucherChange("bank_name")}
                  size="small"
                  fullWidth
                  placeholder="Enter bank name"
                />
              </Grid>
            </>
          )}

          {/* Cheque specific fields */}
          {paymentVoucher?.payment_method === "Cheque" && (
            <>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Cheque Number"
                  value={paymentVoucher.reference_number}
                  onChange={handleVoucherChange("reference_number")}
                  size="small"
                  fullWidth
                  required
                  placeholder="Enter cheque number"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Bank Name"
                  value={paymentVoucher.bank_name}
                  onChange={handleVoucherChange("bank_name")}
                  size="small"
                  fullWidth
                  required
                  placeholder="Enter bank name"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Cheque Date"
                  type="date"
                  value={paymentVoucher.cheque_date}
                  onChange={handleVoucherChange("cheque_date")}
                  size="small"
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
            </>
          )}

          {/* Cash - no additional fields needed */}
          {paymentVoucher?.payment_method === "Cash" && (
            <Grid item xs={12} sm={6}>
              <TextField
                label="Receipt Number (Optional)"
                value={paymentVoucher.reference_number}
                onChange={handleVoucherChange("reference_number")}
                size="small"
                fullWidth
                placeholder="Enter receipt number if available"
              />
            </Grid>
          )}

          <Grid item xs={12}>
            <TextField
              label="Remarks"
              value={paymentVoucher?.remarks || ""}
              onChange={handleVoucherChange("remarks")}
              size="small"
              fullWidth
              multiline
              rows={2}
              placeholder="Optional notes"
            />
          </Grid>
        </Grid>
      </Paper>

      {/* Action Buttons */}
      <Box sx={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
        <Button variant="outlined" onClick={handleCancelPayment}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="primary"
          onClick={handleProceedToReview}
          disabled={!paymentVoucher || paymentVoucher.total_amount <= 0}
        >
          Continue to Review
        </Button>
      </Box>
    </Box>
  );

  // Render review view (Step 4)
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

      {/* Review Summary */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <CheckCircleIcon color="success" />
          Review Payment
        </Typography>
        <Divider sx={{ mb: 2 }} />

        <Grid container spacing={3}>
          <Grid item xs={12} sm={6}>
            <Typography variant="caption" color="text.secondary">Payment Number</Typography>
            <Typography variant="body1" fontWeight="medium">{paymentVoucher?.payment_no}</Typography>
          </Grid>
          <Grid item xs={12} sm={6}>
            <Typography variant="caption" color="text.secondary">Payment Date</Typography>
            <Typography variant="body1">{paymentVoucher?.payment_date}</Typography>
          </Grid>
          <Grid item xs={12} sm={6}>
            <Typography variant="caption" color="text.secondary">Supplier</Typography>
            <Typography variant="body1">{selectedSupplier?.full_name}</Typography>
          </Grid>
          <Grid item xs={12} sm={6}>
            <Typography variant="caption" color="text.secondary">Branch</Typography>
            <Typography variant="body1">{getBranchDisplay(paymentVoucher?.branch_code || "")}</Typography>
          </Grid>
          <Grid item xs={12} sm={6}>
            <Typography variant="caption" color="text.secondary">Payment Method</Typography>
            <Typography variant="body1">{paymentVoucher?.payment_method}</Typography>
          </Grid>
          {paymentVoucher?.reference_number && (
            <Grid item xs={12} sm={6}>
              <Typography variant="caption" color="text.secondary">Reference Number</Typography>
              <Typography variant="body1">{paymentVoucher.reference_number}</Typography>
            </Grid>
          )}
          {paymentVoucher?.bank_name && (
            <Grid item xs={12} sm={6}>
              <Typography variant="caption" color="text.secondary">Bank Name</Typography>
              <Typography variant="body1">{paymentVoucher.bank_name}</Typography>
            </Grid>
          )}
        </Grid>

        <Divider sx={{ my: 2 }} />

        {/* Documents to be paid */}
        <Typography variant="subtitle2" gutterBottom>Documents Allocated:</Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Document</TableCell>
                <TableCell align="right">Allocated Amount</TableCell>
                <TableCell>Result</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paymentVoucher?.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>{line.document_no}</TableCell>
                  <TableCell align="right">Rs. {line.allocated_amount.toLocaleString()}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={line.allocated_amount >= line.remaining_amount ? "PAID" : "PARTIAL"}
                      color={line.allocated_amount >= line.remaining_amount ? "success" : "warning"}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Total Amount */}
        <Box sx={{ mt: 3, p: 2, bgcolor: "primary.light", borderRadius: 1 }}>
          <Grid container alignItems="center">
            <Grid item xs>
              <Typography variant="h6">Total Payment Amount</Typography>
            </Grid>
            <Grid item>
              <Typography variant="h4" color="primary.main">
                Rs. {(paymentVoucher?.total_amount || 0).toLocaleString()}
              </Typography>
            </Grid>
          </Grid>
        </Box>

        {paymentVoucher?.remarks && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary">Remarks</Typography>
            <Typography variant="body2">{paymentVoucher.remarks}</Typography>
          </Box>
        )}
      </Paper>

      {/* Warning */}
      <Alert severity="warning" sx={{ mb: 3 }}>
        <Typography variant="body2">
          <strong>Important:</strong> Once posted, this payment cannot be edited or deleted.
          Please review all details carefully before proceeding.
        </Typography>
      </Alert>

      {/* Action Buttons */}
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
          ...(viewMode !== "supplier" ? [{ label: STEPS[activeStep] }] : []),
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
          selectedSupplier && viewMode === "supplier"
            ? [
                { label: `${openDocuments.length} Open Docs`, variant: "outlined" as const },
                {
                  label: `Rs. ${totalOutstanding.toLocaleString()} Outstanding`,
                  color: "warning" as const,
                },
              ]
            : paymentVoucher
            ? [
                { label: paymentVoucher.status.toUpperCase(), color: "warning" as const },
                { label: `Rs. ${paymentVoucher.total_amount.toLocaleString()}`, variant: "outlined" as const },
              ]
            : []
        }
      />

      {/* Stepper */}
      {viewMode !== "supplier" && (
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
        ) : viewMode === "supplier" ? (
          renderSupplierView()
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
