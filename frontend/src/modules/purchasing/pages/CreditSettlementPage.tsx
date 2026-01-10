/**
 * CreditSettlementPage - Settle supplier credits
 * 
 * Flow:
 * 1. Left panel: Suppliers list
 * 2. Click supplier → Right panel shows supplier details + credit info + PO list
 * 3. Click PO → Right panel shows PO details + payment form
 */

import { ConfirmDialog, useConfirmDialog } from "@/components/ConfirmDialog";
import { formatErrorMessage } from "@/utils/errorHandling";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import BusinessIcon from "@mui/icons-material/Business";
import PaymentIcon from "@mui/icons-material/Payment";
import ReceiptIcon from "@mui/icons-material/Receipt";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  LinearProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import {
  DetailPanelHeader,
  EmptyState,
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  SortOption,
} from "@/components/tijaero";

import { branchApi } from "@/modules/branches/api";
import {
  supplierCreditApi,
  supplierCreditsSettleApi,
  SupplierCreditStatus,
  suppliersApi,
} from "@/modules/purchasing/api";
import {
  Supplier,
  SupplierCreditsSettleCreate,
  SupplierCreditsSettleTransactionCreate,
} from "@/modules/purchasing/types";

// Configuration
const SORT_OPTIONS: SortOption[] = [
  { value: "full_name", label: "Name" },
  { value: "max_credit_limit", label: "Credit Limit" },
  { value: "credit_days", label: "Credit Days" },
];

const PAYMENT_METHODS = [
  "Cash",
  "Bank Transfer",
  "Cheque",
  "Credit Card",
  "Online Payment",
];

// Credit PO from API
interface CreditPurchaseOrder {
  po_id: number;
  po_no: string;
  invoice_no: string;
  po_date: string;
  status: string;
  total_amount: number;
  settled_amount: number;
  remaining_amount: number;
  is_settled: boolean;
  has_grn: boolean;
  grn_id: number | null;
  grn_no: string | null;
  due_date: string;
  days_overdue: number;
  is_overdue: boolean;
  branch_code: string;
}

interface PaymentFormData {
  settlement_no: string;
  payment_method: string;
  payment_method_number: string;
  cheque_date: string;
  payment_amount: number;
  remarks: string;
}

const INITIAL_PAYMENT_FORM: PaymentFormData = {
  settlement_no: "",
  payment_method: "Bank Transfer",
  payment_method_number: "",
  cheque_date: new Date().toISOString().split("T")[0],
  payment_amount: 0,
  remarks: "",
};

// View mode enum
type ViewMode = "supplier" | "po";

export default function CreditSettlementPage() {
  // Data state
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selection state
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("full_name");
  const [showOnlyWithCredit, setShowOnlyWithCredit] = useState(true);
  
  // View state
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [supplierCreditStatus, setSupplierCreditStatus] = useState<SupplierCreditStatus | null>(null);
  const [loadingCredit, setLoadingCredit] = useState(false);
  
  const [selectedPO, setSelectedPO] = useState<CreditPurchaseOrder | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("supplier");
  
  const [paymentForm, setPaymentForm] = useState<PaymentFormData>(INITIAL_PAYMENT_FORM);

  const confirmDialog = useConfirmDialog();

  // Load branches
  const [branches, setBranches] = useState<{ branch_code: string; branch_name: string }[]>([]);
  
  // Filter state
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
      setError(formatErrorMessage(error) || "Failed to load suppliers");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load credit status for selected supplier
  const loadSupplierCredit = useCallback(async (supplierId: number) => {
    try {
      setLoadingCredit(true);
      const status = await supplierCreditApi.getCreditStatus(supplierId);
      setSupplierCreditStatus(status);
    } catch (err) {
      console.error("Failed to load credit status:", err);
      setSupplierCreditStatus(null);
    } finally {
      setLoadingCredit(false);
    }
  }, []);

  // Filtered suppliers
  const filteredSuppliers = useMemo(() => {
    let filtered = suppliers;

    if (showOnlyWithCredit) {
      filtered = filtered.filter((s) => s.max_credit_limit > 0);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          s.full_name.toLowerCase().includes(query) ||
          s.company_name?.toLowerCase().includes(query) ||
          // Search by branch name
          branches.some(b => 
            b.branch_name.toLowerCase().includes(query) || 
            b.branch_code.toLowerCase().includes(query)
          )
      );
    }

    filtered.sort((a, b) => {
      switch (sortField) {
        case "full_name":
          return a.full_name.localeCompare(b.full_name);
        case "max_credit_limit":
          return b.max_credit_limit - a.max_credit_limit;
        case "credit_days":
          return b.credit_days - a.credit_days;
        default:
          return 0;
      }
    });

    return filtered;
  }, [suppliers, showOnlyWithCredit, searchQuery, sortField, branches]);

  // Get payable POs (approved with GRN, not fully settled)
  const payablePOs = useMemo(() => {
    if (!supplierCreditStatus?.credit_purchase_orders) return [];
    let pos = supplierCreditStatus.credit_purchase_orders.filter(
      (po) => po.status === "approved" && po.has_grn && !po.is_settled
    );
    
    // Apply branch filter if set
    if (filterBranch) {
      pos = pos.filter((po) => po.branch_code === filterBranch);
    }
    
    return pos;
  }, [supplierCreditStatus, filterBranch]);

  // Handlers
  const handleSelectSupplier = useCallback((supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setSelectedPO(null);
    setViewMode("supplier");
    setPaymentForm(INITIAL_PAYMENT_FORM);
    loadSupplierCredit(supplier.id);
  }, [loadSupplierCredit]);

  // Auto-select first supplier when data loads
  useEffect(() => {
    if (filteredSuppliers.length > 0 && !selectedSupplier && !loading) {
      const firstSupplier = filteredSuppliers[0];
      setSelectedSupplier(firstSupplier);
      setSelectedPO(null);
      setViewMode("supplier");
      setPaymentForm(INITIAL_PAYMENT_FORM);
      loadSupplierCredit(firstSupplier.id);
    }
  }, [filteredSuppliers.length, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectPO = useCallback((po: CreditPurchaseOrder) => {
    setSelectedPO(po);
    setViewMode("po");
    setPaymentForm({
      ...INITIAL_PAYMENT_FORM,
      settlement_no: `CS-${Date.now()}`,
      payment_amount: po.remaining_amount,
      cheque_date: new Date().toISOString().split("T")[0],
    });
  }, []);

  const handleBackToSupplier = useCallback(() => {
    setSelectedPO(null);
    setViewMode("supplier");
    setPaymentForm(INITIAL_PAYMENT_FORM);
  }, []);

  const handleSubmitPayment = useCallback(async () => {
    if (!selectedPO || !selectedPO.grn_id || !selectedSupplier) {
      toast.error("Invalid selection");
      return;
    }

    if (paymentForm.payment_amount <= 0) {
      toast.error("Payment amount must be greater than 0");
      return;
    }

    if (paymentForm.payment_amount > selectedPO.remaining_amount) {
      toast.error(`Payment cannot exceed remaining amount`);
      return;
    }

    const confirmed = await confirmDialog.confirm({
      title: "Confirm Payment",
      message: `Record payment of ${paymentForm.payment_amount.toLocaleString()} for PO ${selectedPO.po_no}?`,
      confirmText: "Submit Payment",
    });

    if (!confirmed) return;

    try {
      setSaving(true);
      setError(null);

      const transactionData: SupplierCreditsSettleTransactionCreate = {
        payment_method: paymentForm.payment_method,
        cheque_date: paymentForm.cheque_date,
        payment_amount: paymentForm.payment_amount,
        payment_method_number: paymentForm.payment_method_number || undefined,
        remarks: paymentForm.remarks || undefined,
        good_received_id: selectedPO.grn_id,
      };

      const settlementData: SupplierCreditsSettleCreate = {
        supplier_credits_settle_no: paymentForm.settlement_no,
        branch_code: selectedPO.branch_code,
        suppliers_id: selectedSupplier.id,
        transactions: [transactionData],
      };

      await supplierCreditsSettleApi.create(settlementData);
      toast.success("Payment recorded successfully!");
      
      // Refresh credit info
      await loadSupplierCredit(selectedSupplier.id);
      
      // Go back to supplier view
      handleBackToSupplier();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      const msg = formatErrorMessage(error) || "Failed to submit payment";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }, [selectedPO, selectedSupplier, paymentForm, confirmDialog, loadSupplierCredit, handleBackToSupplier]);

  const handleCancelPayment = useCallback(() => {
    handleBackToSupplier();
  }, [handleBackToSupplier]);

  const handleFormChange = useCallback(
    (field: keyof PaymentFormData) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const value = field === "payment_amount" ? Number(e.target.value) : e.target.value;
        setPaymentForm((prev) => ({ ...prev, [field]: value }));
      },
    []
  );

  // Form validation
  const isFormValid = useMemo(() => {
    if (!selectedPO) return false;
    return (
      paymentForm.payment_method.trim() !== "" &&
      paymentForm.payment_amount > 0 &&
      paymentForm.payment_amount <= selectedPO.remaining_amount
    );
  }, [paymentForm, selectedPO]);

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
      placeholder="Search suppliers or branch..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedSupplier}
      onSelectItem={handleSelectSupplier}
      emptyMessage="No suppliers found"
      width={300}
      listHeader={
        <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: "divider" }}>
          <Autocomplete
            size="small"
            options={branches}
            getOptionLabel={(option) => `${option.branch_code} - ${option.branch_name}`}
            value={branches.find(b => b.branch_code === filterBranch) || null}
            onChange={(_, newValue) => setFilterBranch(newValue?.branch_code || null)}
            renderInput={(params) => (
              <TextField {...params} label="Filter by Branch" placeholder="All Branches" />
            )}
            sx={{ mb: 1 }}
          />
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Chip
              label="Credit Only"
              size="small"
              variant={showOnlyWithCredit ? "filled" : "outlined"}
              color={showOnlyWithCredit ? "primary" : "default"}
              onClick={() => setShowOnlyWithCredit(!showOnlyWithCredit)}
            />
            <Typography variant="caption" color="text.secondary">
              {filteredSuppliers.length} suppliers
            </Typography>
          </Box>
        </Box>
      }
      renderItem={(supplier, isSelected) => {
        const usage = getCreditUsage(supplier);
        return (
          <SelectableListItem
            key={supplier.id}
            id={supplier.id}
            isSelected={isSelected}
            onClick={() => handleSelectSupplier(supplier)}
            primaryText={
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
                {/* Supplier Name */}
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{supplier.full_name}</span>
                  {isSelected && (
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Name)
                    </Typography>
                  )}
                </Box>
                {/* Additional fields when selected */}
                {isSelected && (
                  <>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {supplier.company_name || "Individual"}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Company)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {(supplier.left_credit_amount ?? supplier.max_credit_limit).toLocaleString()} / {supplier.max_credit_limit.toLocaleString()}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Credit)
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
                    {/* Status Chips - shown below all fields when selected */}
                    {supplier.max_credit_limit > 0 && (
                      <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                        <Chip
                          label={`${supplier.credit_days} days`}
                          size="small"
                          color="info"
                          sx={{ height: 18, fontSize: "0.65rem" }}
                        />
                      </Box>
                    )}
                  </>
                )}
              </Box>
            }
            secondaryText={!isSelected ? (
              <Box component="span">
                <Typography variant="caption" display="block">
                  {supplier.company_name || "Individual"}
                </Typography>
                <Typography variant="caption" display="block">
                  Credit: {(supplier.left_credit_amount ?? supplier.max_credit_limit).toLocaleString()} / {supplier.max_credit_limit.toLocaleString()}
                </Typography>
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
              </Box>
            ) : undefined}
            statusChip={!isSelected && supplier.max_credit_limit > 0
              ? { label: `${supplier.credit_days}d`, color: "info" }
              : undefined
            }
          />
        );
      }}
    />
  );

  // Supplier Details View
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
        
        {/* Credit Information */}
        <Typography variant="subtitle1" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <AccountBalanceIcon fontSize="small" />
          Credit Information
        </Typography>
        
        <Grid container spacing={2} sx={{ mt: 1 }}>
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
                <Typography variant="caption" color="text.secondary">Max Credit Limit</Typography>
                <Typography variant="h6">
                  {(selectedSupplier?.max_credit_limit || 0).toLocaleString()}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Card variant="outlined">
              <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                <Typography variant="caption" color="text.secondary">Initial Credit</Typography>
                <Typography variant="h6">
                  {(selectedSupplier?.initial_credit_amount || selectedSupplier?.max_credit_limit || 0).toLocaleString()}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Card variant="outlined">
              <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                <Typography variant="caption" color="text.secondary">Available Credit</Typography>
                <Typography variant="h6" color="success.main">
                  {(supplierCreditStatus?.left_credit_amount || selectedSupplier?.left_credit_amount || selectedSupplier?.max_credit_limit || 0).toLocaleString()}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Outstanding & Overdue */}
        {supplierCreditStatus && (
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={6}>
              <Card variant="outlined" sx={{ bgcolor: "warning.light" }}>
                <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                  <Typography variant="caption">Outstanding Payable</Typography>
                  <Typography variant="h6" color="warning.dark">
                    {(supplierCreditStatus.outstanding_payable || 0).toLocaleString()}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6}>
              <Card variant="outlined" sx={{ bgcolor: supplierCreditStatus.total_overdue_amount > 0 ? "error.light" : "success.light" }}>
                <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                  <Typography variant="caption">Overdue Amount</Typography>
                  <Typography variant="h6" color={supplierCreditStatus.total_overdue_amount > 0 ? "error.dark" : "success.dark"}>
                    {(supplierCreditStatus.total_overdue_amount || 0).toLocaleString()}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}
      </Paper>

      {/* Credit Purchase Orders List */}
      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle1" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <ReceiptIcon fontSize="small" />
          Credit Purchase Orders ({payablePOs.length} pending)
        </Typography>
        
        <Divider sx={{ my: 1 }} />

        {loadingCredit ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        ) : payablePOs.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
            No pending credit purchase orders
          </Typography>
        ) : (
          <List disablePadding>
            {payablePOs.map((po) => (
              <ListItemButton
                key={po.po_id}
                onClick={() => handleSelectPO(po)}
                sx={{
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 1,
                  mb: 1,
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <ListItemIcon>
                  <ReceiptIcon color={po.is_overdue ? "error" : "primary"} />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography variant="subtitle2">{po.po_no}</Typography>
                      <Chip
                        size="small"
                        label={po.is_overdue ? `${po.days_overdue}d overdue` : "Due"}
                        color={po.is_overdue ? "error" : "warning"}
                      />
                    </Box>
                  }
                  secondary={
                    <Box component="span">
                      <Typography variant="caption" display="block">
                        Invoice: {po.invoice_no} • GRN: {po.grn_no}
                      </Typography>
                      <Typography variant="caption" display="block">
                        Total: {po.total_amount.toLocaleString()} • Remaining: <strong>{po.remaining_amount.toLocaleString()}</strong>
                      </Typography>
                      <Typography variant="caption" display="block" color="text.secondary">
                        Due Date: {po.due_date}
                      </Typography>
                    </Box>
                  }
                />
                <Button variant="contained" size="small" color="primary">
                  Pay
                </Button>
              </ListItemButton>
            ))}
          </List>
        )}
      </Paper>
    </Box>
  );

  // PO Payment View
  const renderPOView = () => (
    <Box sx={{ p: 2 }}>
      {/* Back Button */}
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={handleBackToSupplier}
        sx={{ mb: 2 }}
      >
        Back to {selectedSupplier?.full_name}
      </Button>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* PO Details */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Purchase Order Details
        </Typography>
        <Divider sx={{ mb: 2 }} />
        
        <Grid container spacing={2}>
          <Grid item xs={6} sm={4}>
            <Typography variant="caption" color="text.secondary">PO Number</Typography>
            <Typography variant="body1" fontWeight="medium">{selectedPO?.po_no}</Typography>
          </Grid>
          <Grid item xs={6} sm={4}>
            <Typography variant="caption" color="text.secondary">Invoice Number</Typography>
            <Typography variant="body1">{selectedPO?.invoice_no}</Typography>
          </Grid>
          <Grid item xs={6} sm={4}>
            <Typography variant="caption" color="text.secondary">Branch</Typography>
            <Typography variant="body1">{selectedPO ? getBranchDisplay(selectedPO.branch_code) : ""}</Typography>
          </Grid>
          <Grid item xs={6} sm={4}>
            <Typography variant="caption" color="text.secondary">GRN Number</Typography>
            <Typography variant="body1">{selectedPO?.grn_no}</Typography>
          </Grid>
          <Grid item xs={6} sm={4}>
            <Typography variant="caption" color="text.secondary">PO Date</Typography>
            <Typography variant="body1">{selectedPO?.po_date}</Typography>
          </Grid>
          <Grid item xs={6} sm={4}>
            <Typography variant="caption" color="text.secondary">Due Date</Typography>
            <Typography variant="body1" color={selectedPO?.is_overdue ? "error" : "inherit"}>
              {selectedPO?.due_date}
              {selectedPO?.is_overdue && ` (${selectedPO.days_overdue}d overdue)`}
            </Typography>
          </Grid>
          <Grid item xs={6} sm={4}>
            <Typography variant="caption" color="text.secondary">Status</Typography>
            <Box>
              <Chip
                size="small"
                label={selectedPO?.is_overdue ? "Overdue" : "Pending"}
                color={selectedPO?.is_overdue ? "error" : "warning"}
              />
            </Box>
          </Grid>
        </Grid>

        {/* Amount Summary */}
        <Divider sx={{ my: 2 }} />
        <Grid container spacing={2}>
          <Grid item xs={4}>
            <Card variant="outlined">
              <CardContent sx={{ textAlign: "center", py: 1 }}>
                <Typography variant="caption">Total Amount</Typography>
                <Typography variant="h6">{(selectedPO?.total_amount || 0).toLocaleString()}</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={4}>
            <Card variant="outlined" sx={{ bgcolor: "success.light" }}>
              <CardContent sx={{ textAlign: "center", py: 1 }}>
                <Typography variant="caption">Already Paid</Typography>
                <Typography variant="h6" color="success.dark">{(selectedPO?.settled_amount || 0).toLocaleString()}</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={4}>
            <Card variant="outlined" sx={{ bgcolor: "error.light" }}>
              <CardContent sx={{ textAlign: "center", py: 1 }}>
                <Typography variant="caption">Remaining</Typography>
                <Typography variant="h6" color="error.dark">{(selectedPO?.remaining_amount || 0).toLocaleString()}</Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Progress */}
        {selectedPO && selectedPO.total_amount > 0 && (
          <Box sx={{ mt: 2 }}>
            <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
              <Typography variant="caption">Settlement Progress</Typography>
              <Typography variant="caption">
                {((selectedPO.settled_amount / selectedPO.total_amount) * 100).toFixed(1)}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={(selectedPO.settled_amount / selectedPO.total_amount) * 100}
              sx={{ height: 8, borderRadius: 1 }}
            />
          </Box>
        )}
      </Paper>

      {/* Payment Form */}
      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <PaymentIcon />
          Make Payment
        </Typography>
        <Divider sx={{ mb: 2 }} />

        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Settlement Number"
              value={paymentForm.settlement_no}
              size="small"
              fullWidth
              disabled
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Branch"
              value={selectedPO?.branch_code || ""}
              size="small"
              fullWidth
              disabled
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Payment Method"
              value={paymentForm.payment_method}
              onChange={handleFormChange("payment_method")}
              size="small"
              fullWidth
              select
              required
            >
              {PAYMENT_METHODS.map((method) => (
                <MenuItem key={method} value={method}>
                  {method}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Reference / Cheque Number"
              value={paymentForm.payment_method_number}
              onChange={handleFormChange("payment_method_number")}
              size="small"
              fullWidth
              placeholder="Enter reference number"
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Payment Date"
              type="date"
              value={paymentForm.cheque_date}
              onChange={handleFormChange("cheque_date")}
              size="small"
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Payment Amount"
              type="number"
              value={paymentForm.payment_amount}
              onChange={handleFormChange("payment_amount")}
              size="small"
              fullWidth
              required
              error={paymentForm.payment_amount > (selectedPO?.remaining_amount || 0)}
              helperText={
                paymentForm.payment_amount > (selectedPO?.remaining_amount || 0)
                  ? `Cannot exceed ${(selectedPO?.remaining_amount || 0).toLocaleString()}`
                  : `Maximum: ${(selectedPO?.remaining_amount || 0).toLocaleString()}`
              }
              InputProps={{
                inputProps: { min: 0, max: selectedPO?.remaining_amount || 0, step: 0.01 },
              }}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              label="Remarks"
              value={paymentForm.remarks}
              onChange={handleFormChange("remarks")}
              size="small"
              fullWidth
              multiline
              rows={2}
              placeholder="Optional notes"
            />
          </Grid>
        </Grid>

        {/* Quick Amount Buttons */}
        <Box sx={{ mt: 2, display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Typography variant="caption" color="text.secondary" sx={{ mr: 1, alignSelf: "center" }}>
            Quick:
          </Typography>
          <Chip
            label="Full Amount"
            onClick={() => setPaymentForm(prev => ({ ...prev, payment_amount: selectedPO?.remaining_amount || 0 }))}
            color={paymentForm.payment_amount === selectedPO?.remaining_amount ? "primary" : "default"}
            variant={paymentForm.payment_amount === selectedPO?.remaining_amount ? "filled" : "outlined"}
            size="small"
          />
          <Chip
            label="50%"
            onClick={() => setPaymentForm(prev => ({ ...prev, payment_amount: Math.round((selectedPO?.remaining_amount || 0) * 0.5 * 100) / 100 }))}
            variant="outlined"
            size="small"
          />
          <Chip
            label="25%"
            onClick={() => setPaymentForm(prev => ({ ...prev, payment_amount: Math.round((selectedPO?.remaining_amount || 0) * 0.25 * 100) / 100 }))}
            variant="outlined"
            size="small"
          />
        </Box>

        {/* Action Buttons */}
        <Box sx={{ mt: 3, display: "flex", gap: 2, justifyContent: "flex-end" }}>
          <Button variant="outlined" onClick={handleCancelPayment} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={handleSubmitPayment}
            disabled={!isFormValid || saving}
            startIcon={saving ? <CircularProgress size={16} /> : <PaymentIcon />}
          >
            {saving ? "Processing..." : "Submit Payment"}
          </Button>
        </Box>
      </Paper>
    </Box>
  );

  // Detail Panel
  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Purchasing", href: "/purchasing" },
          { label: "Credit Settlements", href: "/purchasing/settlements" },
          ...(selectedSupplier ? [{ label: selectedSupplier.full_name }] : []),
          ...(selectedPO ? [{ label: selectedPO.po_no }] : []),
        ]}
        title={
          viewMode === "po" && selectedPO
            ? `Payment: ${selectedPO.po_no}`
            : selectedSupplier?.full_name || ""
        }
        titleIcon={viewMode === "po" ? <PaymentIcon color="primary" /> : <BusinessIcon color="primary" />}
        isCreating={false}
        noSelectionTitle="Select a Supplier"
        chips={
          selectedSupplier && viewMode === "supplier"
            ? [
                { label: `${selectedSupplier.credit_days} Credit Days`, variant: "outlined" as const },
                { label: `Limit: ${selectedSupplier.max_credit_limit.toLocaleString()}`, variant: "outlined" as const },
              ]
            : selectedPO
            ? [
                selectedPO.is_overdue
                  ? { label: `${selectedPO.days_overdue}d Overdue`, color: "error" as const }
                  : { label: "Pending", color: "warning" as const },
              ]
            : []
        }
      />

      <Box sx={{ flex: 1, overflow: "auto" }}>
        {!selectedSupplier ? (
          <Box sx={{ p: 2 }}>
            <EmptyState message="Select a supplier from the list to view credit details and make payments" />
          </Box>
        ) : viewMode === "supplier" ? (
          renderSupplierView()
        ) : (
          renderPOView()
        )}
      </Box>

      <ConfirmDialog {...confirmDialog.dialogProps} />
    </Box>
  );

  return (
    <MasterDetailLayout
      title="Credit Settlements"
      icon={<PaymentIcon />}
      onRefresh={loadSuppliers}
      masterPanel={masterPanel}
      detailPanel={detailPanel}
    />
  );
}
