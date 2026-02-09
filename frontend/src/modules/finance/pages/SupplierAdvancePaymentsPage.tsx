/**
 * Supplier Advance Payments Page
 * 
 * Page for managing supplier advance payments.
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
  Store as SupplierIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  CheckCircle as CheckCircleIcon,
} from "@mui/icons-material";
import { suppliersApi, supplierAdvancePaymentsApi } from "@/modules/purchasing/api";
import { SupplierAdvancePaymentCreate } from "@/modules/purchasing/types";
import { useReferenceData } from "@/hooks";

// Tijaero Components
import {
  TPageHeader,
  TStatCard,
  TTable,
  TButton,
  TTextField,
  TSelect,
  TFormDialog,
  TLoading,
  TEmptyState,
  handleApiError,
  showErrorToast,
  showSuccessToast,
  TBranchFilter,
  TFilterPanel,
  TConfirmDialog,
  useConfirmDialog,
} from "@/components/tijaero";

// Types
interface Branch {
  branch_code: string;
  branch_name: string;
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

export default function SupplierAdvancePaymentsPage() {
  const confirmDialog = useConfirmDialog();

  // Filter states
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null);

  // Dialog states
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form data
  const [formData, setFormData] = useState<Partial<SupplierAdvancePaymentCreate>>({
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

  // Fetch suppliers
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => suppliersApi.getAll(),
  });

  // Fetch supplier advance payments
  const { data: advances = [], isLoading, refetch } = useQuery({
    queryKey: ["supplier-advance-payments", filterBranch, selectedSupplierId],
    queryFn: () =>
      supplierAdvancePaymentsApi.getAll({
        branch_code: filterBranch ?? undefined,
        supplier_id: selectedSupplierId ?? undefined,
      }),
  });

  // Calculate stats
  const stats = useMemo(() => {
    const total = advances.reduce((sum, a) => sum + Number(a.original_amount || 0), 0);
    const applied = advances.reduce((sum, a) => sum + Number(a.applied_amount || 0), 0);
    const remaining = advances.reduce((sum, a) => sum + Number(a.remaining_amount || 0), 0);
    const fullyApplied = advances.filter(a => a.is_fully_applied).length;
    return { total, applied, remaining, count: advances.length, fullyApplied };
  }, [advances]);

  // Create advance mutation
  const createAdvance = useCallback(async () => {
    if (!formData.supplier_id || !formData.original_amount || formData.original_amount <= 0) {
      showErrorToast("Please select a supplier and enter a valid amount");
      return;
    }

    if (!formData.branch_code) {
      showErrorToast("Please select a branch");
      return;
    }

    try {
      setSaving(true);
      await supplierAdvancePaymentsApi.create(formData as SupplierAdvancePaymentCreate);
      showSuccessToast("Supplier advance payment created successfully");
      setShowForm(false);
      setFormData({
        supplier_id: 0,
        payment_date: new Date().toISOString().split("T")[0],
        payment_method: "Bank Transfer",
        original_amount: 0,
        reference_number: "",
        bank_name: "",
        branch_code: "",
        remarks: "",
      });
      refetch();
    } catch (err: unknown) {
      console.error("Failed to create supplier advance:", err);
      showErrorToast(handleApiError(err, "Failed to create advance payment"));
    } finally {
      setSaving(false);
    }
  }, [formData, refetch]);

  // Delete advance
  const handleDelete = useCallback(async (advanceId: number) => {
    const confirmed = await confirmDialog.confirm({
      title: "Delete Advance Payment",
      message: "Are you sure you want to delete this advance payment? This action cannot be undone.",
      confirmText: "Delete",
      cancelText: "Cancel",
    });

    if (!confirmed) return;

    try {
      await supplierAdvancePaymentsApi.delete(advanceId);
      showSuccessToast("Advance payment deleted");
      refetch();
    } catch (err: unknown) {
      console.error("Failed to delete advance:", err);
      showErrorToast(handleApiError(err, "Failed to delete advance payment"));
    }
  }, [confirmDialog, refetch]);

  return (
    <Box>
      {/* Page Header */}
      <TPageHeader
        title="Supplier Advance Payments"
        subtitle="Manage advance payments to suppliers"
        icon={<SupplierIcon />}
        actions={
          <TButton
            variant="primary"
            startIcon={<AddIcon />}
            onClick={() => setShowForm(true)}
          >
            Create Advance
          </TButton>
        }
      />

      {/* Stats Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Total Advances"
            value={formatCurrency(stats.total)}
            icon={<WalletIcon />}
            color="primary"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Applied"
            value={formatCurrency(stats.applied)}
            icon={<CheckCircleIcon />}
            color="warning"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Available Balance"
            value={formatCurrency(stats.remaining)}
            icon={<WalletIcon />}
            color="success"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Fully Applied"
            value={`${stats.fullyApplied} / ${stats.count}`}
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
          onClick={() => refetch()}
        >
          Refresh
        </TButton>
      </TFilterPanel>

      {/* Data Table */}
      {isLoading ? (
        <TLoading message="Loading supplier advances..." />
      ) : advances.length === 0 ? (
        <TEmptyState
          icon={<WalletIcon sx={{ fontSize: 64 }} />}
          title="No Supplier Advances Found"
          message="No advance payments match your current filters"
          action={{
            label: "Create Advance",
            onClick: () => setShowForm(true),
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
                          onClick={() => handleDelete(row.id)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                ),
              },
            ]}
            data={advances}
            getRowKey={(row: any) => row.id}
            stickyHeader
            maxHeight={500}
          />
        </Paper>
      )}

      {/* Form Dialog */}
      <TFormDialog
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Create Supplier Advance Payment"
        icon={<SupplierIcon />}
        maxWidth="sm"
        onSubmit={(e) => {
          e.preventDefault();
          createAdvance();
        }}
        isSubmitting={saving}
        submitDisabled={!formData.supplier_id || !formData.original_amount || !formData.branch_code}
        submitText={saving ? "Creating..." : "Create Advance"}
      >
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <Autocomplete
              size="small"
              options={suppliers}
              getOptionLabel={(option: Supplier) => option.full_name || option.company_name || ""}
              value={suppliers.find((s: Supplier) => s.id === formData.supplier_id) || null}
              onChange={(_, newValue) => setFormData({ ...formData, supplier_id: newValue?.id || 0 })}
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
              value={formData.payment_method || "Bank Transfer"}
              onChange={(value) => setFormData({ ...formData, payment_method: String(value) })}
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
              value={formData.original_amount || ""}
              onChange={(e) => setFormData({ ...formData, original_amount: parseFloat(e.target.value) || 0 })}
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
              value={formData.branch_code || ""}
              onChange={(value) => setFormData({ ...formData, branch_code: String(value) })}
              options={branches.map((b) => ({ value: b.branch_code, label: b.branch_name }))}
              required
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Payment Date"
              type="date"
              value={formData.payment_date || ""}
              onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
              InputLabelProps={{ shrink: true }}
              required
            />
          </Grid>
          {(formData.payment_method === "Bank Transfer" || formData.payment_method === "Cheque") && (
            <>
              <Grid item xs={12} sm={6}>
                <TTextField
                  fullWidth
                  label={formData.payment_method === "Cheque" ? "Cheque Number" : "Reference Number"}
                  value={formData.reference_number || ""}
                  onChange={(e) => setFormData({ ...formData, reference_number: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TTextField
                  fullWidth
                  label="Bank Name"
                  value={formData.bank_name || ""}
                  onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                />
              </Grid>
            </>
          )}
          <Grid item xs={12}>
            <TTextField
              fullWidth
              label="Remarks"
              value={formData.remarks || ""}
              onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
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
