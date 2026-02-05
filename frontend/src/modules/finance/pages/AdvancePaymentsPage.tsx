/**
 * Advance Payments Page
 * 
 * Unified page for managing both Customer and Supplier advance payments.
 * Uses Tijaero components for consistent UI.
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Box,
  Grid,
  Paper,
  Typography,
  TextField,
  Chip,
  Autocomplete,
  InputAdornment,
  IconButton,
  Tooltip,
} from "@mui/material";
import {
  Add as AddIcon,
  AccountBalanceWallet as WalletIcon,
  Person as PersonIcon,
  Store as SupplierIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
} from "@mui/icons-material";
import { toast } from "react-hot-toast";
import { advancePaymentsApi } from "@/modules/finance/api";
import { customersApi } from "@/modules/customers/api";
import { suppliersApi, supplierAdvancePaymentsApi } from "@/modules/purchasing/api";
import { CustomerAdvancePaymentCreate } from "@/modules/finance/types";
import { SupplierAdvancePaymentCreate } from "@/modules/purchasing/types";
import { useReferenceData } from "@/hooks";

// Tijaero Components
import {
  TPageHeader,
  TTabs,
  TStatCard,
  TTable,
  TButton,
  TTextField,
  TSelect,
  TFormDialog,
  TLoading,
  TEmptyState,
  TBranchFilter,
  TFilterPanel,
  TConfirmDialog,
  useConfirmDialog,
  GENERIC_PAYMENT_METHOD,
} from "@/components/tijaero";

// Types
interface Branch {
  branch_code: string;
  branch_name: string;
}

interface Customer {
  id: number;
  customer_name: string;
  company_name?: string;
}

interface Supplier {
  id: number;
  full_name: string;
  company_name?: string;
}

// Format currency helper
const formatCurrency = (value: number | string | undefined) => {
  const num = Number(value) || 0;
  return `Rs. ${num.toLocaleString("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

// Format date helper
const formatDate = (dateString: string | undefined) => {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleDateString("en-LK");
};

export default function AdvancePaymentsPage() {
  const confirmDialog = useConfirmDialog();

  // Active tab state
  const [activeTab, setActiveTab] = useState<"customer" | "supplier">("customer");

  // Filter states
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null);

  // Dialog states
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [savingSupplier, setSavingSupplier] = useState(false);

  // Form data
  const [customerFormData, setCustomerFormData] = useState<Partial<CustomerAdvancePaymentCreate>>({
    advance_payments_no: "",
    payment_method: "cash",
    branch_code: "",
    payment_amount: 0,
    remarks: "",
    customer_id: 0,
    cheque_date: new Date().toISOString().split("T")[0],
    active: true,
  });

  const [supplierFormData, setSupplierFormData] = useState<Partial<SupplierAdvancePaymentCreate>>({
    supplier_id: 0,
    payment_date: new Date().toISOString().split("T")[0],
    payment_method: "Bank Transfer",
    original_amount: 0,
    reference_number: "",
    bank_name: "",
    branch_code: "",
    remarks: "",
  });

  // Reference data
  const { data: refData } = useReferenceData(["branches"]);
  const branches: Branch[] = refData?.branches || [];

  // Fetch customers
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.getAll(),
  });

  // Fetch suppliers
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => suppliersApi.getAll(),
  });

  // Fetch customer advance payments
  const { data: customerAdvances = [], isLoading: loadingCustomerAdvances, refetch: refetchCustomerAdvances } = useQuery({
    queryKey: ["customer-advance-payments", filterBranch, selectedCustomerId],
    queryFn: () =>
      advancePaymentsApi.getAll({
        branch_code: filterBranch ?? undefined,
        customer_id: selectedCustomerId ?? undefined,
      }),
    enabled: activeTab === "customer",
  });

  // Fetch supplier advance payments
  const { data: supplierAdvances = [], isLoading: loadingSupplierAdvances, refetch: refetchSupplierAdvances } = useQuery({
    queryKey: ["supplier-advance-payments", filterBranch, selectedSupplierId],
    queryFn: () =>
      supplierAdvancePaymentsApi.getAll({
        branch_code: filterBranch ?? undefined,
        supplier_id: selectedSupplierId ?? undefined,
      }),
    enabled: activeTab === "supplier",
  });

  // Calculate stats
  const customerStats = useMemo(() => {
    const total = customerAdvances.reduce((sum, a) => sum + Number(a.payment_amount || 0), 0);
    const active = customerAdvances.filter(a => a.active).length;
    return { total, count: customerAdvances.length, active };
  }, [customerAdvances]);

  const supplierStats = useMemo(() => {
    const total = supplierAdvances.reduce((sum, a) => sum + Number(a.original_amount || 0), 0);
    const applied = supplierAdvances.reduce((sum, a) => sum + Number(a.applied_amount || 0), 0);
    const remaining = supplierAdvances.reduce((sum, a) => sum + Number(a.remaining_amount || 0), 0);
    const fullyApplied = supplierAdvances.filter(a => a.is_fully_applied).length;
    return { total, applied, remaining, count: supplierAdvances.length, fullyApplied };
  }, [supplierAdvances]);

  // Create customer advance mutation
  const createCustomerAdvance = useCallback(async () => {
    if (!customerFormData.customer_id || !customerFormData.payment_amount || customerFormData.payment_amount <= 0) {
      toast.error("Please select a customer and enter a valid amount");
      return;
    }

    if (!customerFormData.branch_code) {
      toast.error("Please select a branch");
      return;
    }

    try {
      setSavingCustomer(true);
      await advancePaymentsApi.create(customerFormData as CustomerAdvancePaymentCreate);
      toast.success("Customer advance payment recorded successfully");
      setShowCustomerForm(false);
      setCustomerFormData({
        advance_payments_no: "",
        payment_method: "cash",
        branch_code: "",
        payment_amount: 0,
        remarks: "",
        customer_id: 0,
        cheque_date: new Date().toISOString().split("T")[0],
        active: true,
      });
      refetchCustomerAdvances();
    } catch (err: any) {
      console.error("Failed to create customer advance:", err);
      toast.error(err?.response?.data?.detail || "Failed to record advance payment");
    } finally {
      setSavingCustomer(false);
    }
  }, [customerFormData, refetchCustomerAdvances]);

  // Create supplier advance mutation
  const createSupplierAdvance = useCallback(async () => {
    if (!supplierFormData.supplier_id || !supplierFormData.original_amount || supplierFormData.original_amount <= 0) {
      toast.error("Please select a supplier and enter a valid amount");
      return;
    }

    if (!supplierFormData.branch_code) {
      toast.error("Please select a branch");
      return;
    }

    try {
      setSavingSupplier(true);
      await supplierAdvancePaymentsApi.create(supplierFormData as SupplierAdvancePaymentCreate);
      toast.success("Supplier advance payment created successfully");
      setShowSupplierForm(false);
      setSupplierFormData({
        supplier_id: 0,
        payment_date: new Date().toISOString().split("T")[0],
        payment_method: "Bank Transfer",
        original_amount: 0,
        reference_number: "",
        bank_name: "",
        branch_code: "",
        remarks: "",
      });
      refetchSupplierAdvances();
    } catch (err: any) {
      console.error("Failed to create supplier advance:", err);
      toast.error(err?.response?.data?.detail || "Failed to create advance payment");
    } finally {
      setSavingSupplier(false);
    }
  }, [supplierFormData, refetchSupplierAdvances]);

  // Delete supplier advance
  const handleDeleteSupplierAdvance = useCallback(async (advanceId: number) => {
    const confirmed = await confirmDialog.confirm({
      title: "Delete Advance Payment",
      message: "Are you sure you want to delete this advance payment? This action cannot be undone.",
      confirmText: "Delete",
      cancelText: "Cancel",
    });

    if (!confirmed) return;

    try {
      await supplierAdvancePaymentsApi.delete(advanceId);
      toast.success("Advance payment deleted");
      refetchSupplierAdvances();
    } catch (err: any) {
      console.error("Failed to delete advance:", err);
      toast.error(err?.response?.data?.detail || "Failed to delete advance payment");
    }
  }, [confirmDialog, refetchSupplierAdvances]);

  // Tab configuration
  const tabs = [
    {
      id: "customer",
      label: "Customer Advances",
      icon: <PersonIcon />,
      badge: customerAdvances.length,
    },
    {
      id: "supplier",
      label: "Supplier Advances",
      icon: <SupplierIcon />,
      badge: supplierAdvances.length,
    },
  ];

  // Render customer advances content
  const renderCustomerAdvances = () => (
    <Box>
      {/* Stats Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Total Advances"
            value={formatCurrency(customerStats.total)}
            icon={<WalletIcon />}
            color="primary"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Total Count"
            value={customerStats.count.toString()}
            icon={<PersonIcon />}
            color="info"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Active"
            value={customerStats.active.toString()}
            icon={<CheckCircleIcon />}
            color="success"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Inactive"
            value={(customerStats.count - customerStats.active).toString()}
            icon={<CancelIcon />}
            color="warning"
          />
        </Grid>
      </Grid>

      {/* Filters */}
      <TFilterPanel>
        <TBranchFilter
          branches={branches}
          value={filterBranch}
          onChange={setFilterBranch}
        />
        <Autocomplete
          size="small"
          options={customers}
          getOptionLabel={(option: Customer) => option.customer_name || ""}
          value={customers.find((c: Customer) => c.id === selectedCustomerId) || null}
          onChange={(_, newValue) => setSelectedCustomerId(newValue?.id || null)}
          renderInput={(params) => (
            <TextField {...params} label="Filter by Customer" placeholder="All Customers" />
          )}
          sx={{ minWidth: 250 }}
        />
        <TButton
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={() => refetchCustomerAdvances()}
        >
          Refresh
        </TButton>
      </TFilterPanel>

      {/* Data Table */}
      {loadingCustomerAdvances ? (
        <TLoading message="Loading customer advances..." />
      ) : customerAdvances.length === 0 ? (
        <TEmptyState
          icon={<WalletIcon sx={{ fontSize: 64 }} />}
          title="No Customer Advances Found"
          message="No advance payments match your current filters"
          action={{
            label: "Record Advance",
            onClick: () => setShowCustomerForm(true),
            icon: <AddIcon />,
          }}
        />
      ) : (
        <Paper sx={{ borderRadius: 2, overflow: "hidden" }}>
          <TTable
            columns={[
              { field: "advance_payments_no", header: "Payment No", width: 120 },
              {
                field: "customer_name",
                header: "Customer",
                width: 180,
                render: (_value, row: any) => {
                  const customer = customers.find((c: Customer) => c.id === row.customer_id);
                  return customer?.customer_name || `ID: ${row.customer_id}`;
                },
              },
              { field: "payment_method", header: "Method", width: 100 },
              {
                field: "payment_amount",
                header: "Amount",
                width: 120,
                align: "right",
                render: (_value, row: any) => (
                  <Typography fontWeight="bold" color="primary.main">
                    {formatCurrency(row.payment_amount)}
                  </Typography>
                ),
              },
              { field: "branch_code", header: "Branch", width: 100 },
              {
                field: "cheque_date",
                header: "Date",
                width: 100,
                render: (_value, row: any) => formatDate(row.cheque_date),
              },
              {
                field: "active",
                header: "Status",
                width: 100,
                render: (_value, row: any) => (
                  <Chip
                    label={row.active ? "Active" : "Inactive"}
                    color={row.active ? "success" : "default"}
                    size="small"
                  />
                ),
              },
              { field: "remarks", header: "Remarks", width: 150 },
            ]}
            data={customerAdvances}
            getRowKey={(row: any) => row.id}
            stickyHeader
            maxHeight={500}
          />
        </Paper>
      )}
    </Box>
  );

  // Render supplier advances content
  const renderSupplierAdvances = () => (
    <Box>
      {/* Stats Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Total Advances"
            value={formatCurrency(supplierStats.total)}
            icon={<WalletIcon />}
            color="primary"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Applied"
            value={formatCurrency(supplierStats.applied)}
            icon={<CheckCircleIcon />}
            color="warning"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Available Balance"
            value={formatCurrency(supplierStats.remaining)}
            icon={<WalletIcon />}
            color="success"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Fully Applied"
            value={`${supplierStats.fullyApplied} / ${supplierStats.count}`}
            icon={<SupplierIcon />}
            color="info"
          />
        </Grid>
      </Grid>

      {/* Filters */}
      <TFilterPanel>
        <TBranchFilter
          branches={branches}
          value={filterBranch}
          onChange={setFilterBranch}
        />
        <Autocomplete
          size="small"
          options={suppliers}
          getOptionLabel={(option: Supplier) => option.full_name || option.company_name || ""}
          value={suppliers.find((s: Supplier) => s.id === selectedSupplierId) || null}
          onChange={(_, newValue) => setSelectedSupplierId(newValue?.id || null)}
          renderInput={(params) => (
            <TextField {...params} label="Filter by Supplier" placeholder="All Suppliers" />
          )}
          sx={{ minWidth: 250 }}
        />
        <TButton
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={() => refetchSupplierAdvances()}
        >
          Refresh
        </TButton>
      </TFilterPanel>

      {/* Data Table */}
      {loadingSupplierAdvances ? (
        <TLoading message="Loading supplier advances..." />
      ) : supplierAdvances.length === 0 ? (
        <TEmptyState
          icon={<WalletIcon sx={{ fontSize: 64 }} />}
          title="No Supplier Advances Found"
          message="No advance payments match your current filters"
          action={{
            label: "Create Advance",
            onClick: () => setShowSupplierForm(true),
            icon: <AddIcon />,
          }}
        />
      ) : (
        <Paper sx={{ borderRadius: 2, overflow: "hidden" }}>
          <TTable
            columns={[
              { field: "advance_no", header: "Advance No", width: 130 },
              {
                field: "supplier_name",
                header: "Supplier",
                width: 180,
                render: (_value, row: any) => {
                  const supplier = suppliers.find((s: Supplier) => s.id === row.supplier_id);
                  return row.supplier_name || supplier?.full_name || `ID: ${row.supplier_id}`;
                },
              },
              { field: "payment_method", header: "Method", width: 120 },
              {
                field: "original_amount",
                header: "Original",
                width: 120,
                align: "right",
                render: (_value, row: any) => (
                  <Typography fontWeight="bold">
                    {formatCurrency(row.original_amount)}
                  </Typography>
                ),
              },
              {
                field: "applied_amount",
                header: "Applied",
                width: 120,
                align: "right",
                render: (_value, row: any) => (
                  <Typography color="warning.main">
                    {formatCurrency(row.applied_amount)}
                  </Typography>
                ),
              },
              {
                field: "remaining_amount",
                header: "Remaining",
                width: 120,
                align: "right",
                render: (_value, row: any) => (
                  <Typography fontWeight="bold" color="success.main">
                    {formatCurrency(row.remaining_amount)}
                  </Typography>
                ),
              },
              { field: "branch_code", header: "Branch", width: 100 },
              {
                field: "payment_date",
                header: "Date",
                width: 100,
                render: (_value, row: any) => formatDate(row.payment_date),
              },
              {
                field: "status",
                header: "Status",
                width: 120,
                render: (_value, row: any) => (
                  <Chip
                    label={row.is_fully_applied ? "Fully Applied" : "Active"}
                    color={row.is_fully_applied ? "default" : "success"}
                    size="small"
                  />
                ),
              },
              {
                field: "actions",
                header: "Actions",
                width: 80,
                align: "center",
                render: (_value, row: any) => (
                  <Box sx={{ display: "flex", gap: 0.5, justifyContent: "center" }}>
                    {!row.is_fully_applied && Number(row.applied_amount) === 0 && (
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDeleteSupplierAdvance(row.id)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                ),
              },
            ]}
            data={supplierAdvances}
            getRowKey={(row: any) => row.id}
            stickyHeader
            maxHeight={500}
          />
        </Paper>
      )}
    </Box>
  );

  return (
    <Box>
      {/* Page Header */}
      <TPageHeader
        title="Advance Payments"
        subtitle="Manage customer and supplier advance payments"
        icon={<WalletIcon />}
        actions={
          <TButton
            variant="primary"
            startIcon={<AddIcon />}
            onClick={() => {
              if (activeTab === "customer") {
                setShowCustomerForm(true);
              } else {
                setShowSupplierForm(true);
              }
            }}
          >
            {activeTab === "customer" ? "Record Customer Advance" : "Create Supplier Advance"}
          </TButton>
        }
      />

      {/* Tabs */}
      <TTabs
        tabs={tabs}
        activeTab={activeTab}
        onChange={(tabId) => {
          setActiveTab(tabId as "customer" | "supplier");
          // Reset filters when switching tabs
          setFilterBranch(null);
          setSelectedCustomerId(null);
          setSelectedSupplierId(null);
        }}
        paper
        sx={{ mb: 3, borderRadius: 2 }}
      />

      {/* Tab Content */}
      {activeTab === "customer" ? renderCustomerAdvances() : renderSupplierAdvances()}

      {/* Customer Advance Form Dialog */}
      <TFormDialog
        open={showCustomerForm}
        onClose={() => setShowCustomerForm(false)}
        title="Record Customer Advance Payment"
        icon={<PersonIcon />}
        maxWidth="sm"
        onSubmit={(e) => {
          e.preventDefault();
          createCustomerAdvance();
        }}
        isSubmitting={savingCustomer}
        submitDisabled={!customerFormData.customer_id || !customerFormData.payment_amount || !customerFormData.branch_code}
        submitText={savingCustomer ? "Recording..." : "Record Advance"}
      >
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <Autocomplete
              size="small"
              options={customers}
              getOptionLabel={(option: Customer) => option.customer_name || ""}
              value={customers.find((c: Customer) => c.id === customerFormData.customer_id) || null}
              onChange={(_, newValue) => setCustomerFormData({ ...customerFormData, customer_id: newValue?.id || 0 })}
              renderInput={(params) => (
                <TextField {...params} label="Customer" required />
              )}
              fullWidth
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TTextField
              fullWidth
              label="Payment Number"
              value={customerFormData.advance_payments_no || ""}
              onChange={(e) => setCustomerFormData({ ...customerFormData, advance_payments_no: e.target.value })}
              required
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TSelect
              fullWidth
              label="Payment Method"
              value={customerFormData.payment_method || "cash"}
              onChange={(value) => setCustomerFormData({ ...customerFormData, payment_method: String(value) })}
              options={[...GENERIC_PAYMENT_METHOD]}
              required
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TTextField
              fullWidth
              label="Amount"
              type="number"
              value={customerFormData.payment_amount || ""}
              onChange={(e) => setCustomerFormData({ ...customerFormData, payment_amount: parseFloat(e.target.value) || 0 })}
              InputProps={{
                startAdornment: <InputAdornment position="start">Rs.</InputAdornment>,
              }}
              required
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TSelect
              fullWidth
              label="Branch"
              value={customerFormData.branch_code || ""}
              onChange={(value) => setCustomerFormData({ ...customerFormData, branch_code: String(value) })}
              options={branches.map((b) => ({ value: b.branch_code, label: b.branch_name }))}
              required
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Payment Date"
              type="date"
              value={customerFormData.cheque_date || ""}
              onChange={(e) => setCustomerFormData({ ...customerFormData, cheque_date: e.target.value })}
              InputLabelProps={{ shrink: true }}
              required
            />
          </Grid>
          <Grid item xs={12}>
            <TTextField
              fullWidth
              label="Remarks"
              value={customerFormData.remarks || ""}
              onChange={(e) => setCustomerFormData({ ...customerFormData, remarks: e.target.value })}
              multiline
              rows={2}
            />
          </Grid>
        </Grid>
      </TFormDialog>

      {/* Supplier Advance Form Dialog */}
      <TFormDialog
        open={showSupplierForm}
        onClose={() => setShowSupplierForm(false)}
        title="Create Supplier Advance Payment"
        icon={<SupplierIcon />}
        maxWidth="sm"
        onSubmit={(e) => {
          e.preventDefault();
          createSupplierAdvance();
        }}
        isSubmitting={savingSupplier}
        submitDisabled={!supplierFormData.supplier_id || !supplierFormData.original_amount || !supplierFormData.branch_code}
        submitText={savingSupplier ? "Creating..." : "Create Advance"}
      >
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <Autocomplete
              size="small"
              options={suppliers}
              getOptionLabel={(option: Supplier) => option.full_name || option.company_name || ""}
              value={suppliers.find((s: Supplier) => s.id === supplierFormData.supplier_id) || null}
              onChange={(_, newValue) => setSupplierFormData({ ...supplierFormData, supplier_id: newValue?.id || 0 })}
              renderInput={(params) => (
                <TextField {...params} label="Supplier" required />
              )}
              fullWidth
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TSelect
              fullWidth
              label="Payment Method"
              value={supplierFormData.payment_method || "Bank Transfer"}
              onChange={(value) => setSupplierFormData({ ...supplierFormData, payment_method: String(value) })}
              options={[
                { value: "Cash", label: "💵 Cash" },
                { value: "Bank Transfer", label: "🏦 Bank Transfer" },
                { value: "Cheque", label: "📝 Cheque" },
              ]}
              required
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TTextField
              fullWidth
              label="Amount"
              type="number"
              value={supplierFormData.original_amount || ""}
              onChange={(e) => setSupplierFormData({ ...supplierFormData, original_amount: parseFloat(e.target.value) || 0 })}
              InputProps={{
                startAdornment: <InputAdornment position="start">Rs.</InputAdornment>,
              }}
              required
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TSelect
              fullWidth
              label="Branch"
              value={supplierFormData.branch_code || ""}
              onChange={(value) => setSupplierFormData({ ...supplierFormData, branch_code: String(value) })}
              options={branches.map((b) => ({ value: b.branch_code, label: b.branch_name }))}
              required
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Payment Date"
              type="date"
              value={supplierFormData.payment_date || ""}
              onChange={(e) => setSupplierFormData({ ...supplierFormData, payment_date: e.target.value })}
              InputLabelProps={{ shrink: true }}
              required
            />
          </Grid>
          {(supplierFormData.payment_method === "Bank Transfer" || supplierFormData.payment_method === "Cheque") && (
            <>
              <Grid item xs={12} sm={6}>
                <TTextField
                  fullWidth
                  label={supplierFormData.payment_method === "Cheque" ? "Cheque Number" : "Reference Number"}
                  value={supplierFormData.reference_number || ""}
                  onChange={(e) => setSupplierFormData({ ...supplierFormData, reference_number: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TTextField
                  fullWidth
                  label="Bank Name"
                  value={supplierFormData.bank_name || ""}
                  onChange={(e) => setSupplierFormData({ ...supplierFormData, bank_name: e.target.value })}
                />
              </Grid>
            </>
          )}
          <Grid item xs={12}>
            <TTextField
              fullWidth
              label="Remarks"
              value={supplierFormData.remarks || ""}
              onChange={(e) => setSupplierFormData({ ...supplierFormData, remarks: e.target.value })}
              multiline
              rows={2}
            />
          </Grid>
        </Grid>
      </TFormDialog>

      {/* Confirm Dialog */}
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </Box>
  );
}
