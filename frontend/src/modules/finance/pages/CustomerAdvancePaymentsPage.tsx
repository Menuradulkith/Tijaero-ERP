/**
 * Customer Advance Payments Page
 * 
 * Page for managing customer advance payments.
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
} from "@mui/material";
import {
  Add as AddIcon,
  AccountBalanceWallet as WalletIcon,
  Person as PersonIcon,
  Refresh as RefreshIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
} from "@mui/icons-material";
import { advancePaymentsApi } from "@/modules/finance/api";
import { customersApi } from "@/modules/customers/api";
import { CustomerAdvancePaymentCreate } from "@/modules/finance/types";
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

export default function CustomerAdvancePaymentsPage() {
  // Filter states
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);

  // Dialog states
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form data
  const [formData, setFormData] = useState<Partial<CustomerAdvancePaymentCreate>>({
    advance_payments_no: "",
    payment_method: "cash",
    branch_code: "",
    payment_amount: 0,
    remarks: "",
    customer_id: 0,
    cheque_date: new Date().toISOString().split("T")[0],
    active: true,
  });

  // Reference data
  const { data: refData } = useReferenceData(["branches"]);
  const branches: Branch[] = refData?.branches || [];

  // Fetch customers
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.getAll(),
  });

  // Fetch customer advance payments
  const { data: advances = [], isLoading, refetch } = useQuery({
    queryKey: ["customer-advance-payments", filterBranch, selectedCustomerId],
    queryFn: () =>
      advancePaymentsApi.getAll({
        branch_code: filterBranch ?? undefined,
        customer_id: selectedCustomerId ?? undefined,
      }),
  });

  // Calculate stats
  const stats = useMemo(() => {
    const total = advances.reduce((sum, a) => sum + Number(a.payment_amount || 0), 0);
    const active = advances.filter(a => a.active).length;
    return { total, count: advances.length, active };
  }, [advances]);

  // Create advance mutation
  const createAdvance = useCallback(async () => {
    if (!formData.customer_id || !formData.payment_amount || formData.payment_amount <= 0) {
      showErrorToast("Please select a customer and enter a valid amount");
      return;
    }

    if (!formData.branch_code) {
      showErrorToast("Please select a branch");
      return;
    }

    try {
      setSaving(true);
      await advancePaymentsApi.create(formData as CustomerAdvancePaymentCreate);
      showSuccessToast("Customer advance payment recorded successfully");
      setShowForm(false);
      setFormData({
        advance_payments_no: "",
        payment_method: "cash",
        branch_code: "",
        payment_amount: 0,
        remarks: "",
        customer_id: 0,
        cheque_date: new Date().toISOString().split("T")[0],
        active: true,
      });
      refetch();
    } catch (err: unknown) {
      console.error("Failed to create customer advance:", err);
      showErrorToast(handleApiError(err, "Failed to record advance payment"));
    } finally {
      setSaving(false);
    }
  }, [formData, refetch]);

  return (
    <Box>
      {/* Page Header */}
      <TPageHeader
        title="Customer Advance Payments"
        subtitle="Manage advance payments from customers"
        icon={<PersonIcon />}
        actions={
          <TButton
            variant="primary"
            startIcon={<AddIcon />}
            onClick={() => setShowForm(true)}
          >
            Record Advance
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
            title="Total Count"
            value={stats.count.toString()}
            icon={<PersonIcon />}
            color="info"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Active"
            value={stats.active.toString()}
            icon={<CheckCircleIcon />}
            color="success"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Inactive"
            value={(stats.count - stats.active).toString()}
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
          onClick={() => refetch()}
        >
          Refresh
        </TButton>
      </TFilterPanel>

      {/* Data Table */}
      {isLoading ? (
        <TLoading message="Loading customer advances..." />
      ) : advances.length === 0 ? (
        <TEmptyState
          icon={<WalletIcon sx={{ fontSize: 64 }} />}
          title="No Customer Advances Found"
          message="No advance payments match your current filters"
          action={{
            label: "Record Advance",
            onClick: () => setShowForm(true),
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
        title="Record Customer Advance Payment"
        icon={<PersonIcon />}
        maxWidth="sm"
        onSubmit={(e) => {
          e.preventDefault();
          createAdvance();
        }}
        isSubmitting={saving}
        submitDisabled={!formData.customer_id || !formData.payment_amount || !formData.branch_code}
        submitText={saving ? "Recording..." : "Record Advance"}
      >
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <Autocomplete
              size="small"
              options={customers}
              getOptionLabel={(option: Customer) => option.customer_name || ""}
              value={customers.find((c: Customer) => c.id === formData.customer_id) || null}
              onChange={(_, newValue) => setFormData({ ...formData, customer_id: newValue?.id || 0 })}
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
              value={formData.advance_payments_no || ""}
              onChange={(e) => setFormData({ ...formData, advance_payments_no: e.target.value })}
              required
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TSelect
              fullWidth
              label="Payment Method"
              value={formData.payment_method || "cash"}
              onChange={(value) => setFormData({ ...formData, payment_method: String(value) })}
              options={[...GENERIC_PAYMENT_METHOD]}
              required
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TTextField
              fullWidth
              label="Amount"
              type="number"
              value={formData.payment_amount || ""}
              onChange={(e) => setFormData({ ...formData, payment_amount: parseFloat(e.target.value) || 0 })}
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
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Payment Date"
              type="date"
              value={formData.cheque_date || ""}
              onChange={(e) => setFormData({ ...formData, cheque_date: e.target.value })}
              InputLabelProps={{ shrink: true }}
              required
            />
          </Grid>
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
    </Box>
  );
}
