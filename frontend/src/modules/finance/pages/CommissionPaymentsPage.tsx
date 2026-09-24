/**
 * CommissionPaymentsPage - Commission Payment Management
 * 
 * Features:
 * - View all commission payments
 * - Create new payments against pending/approved commissions
 * - Verify/cancel payments
 * - Filter by agent, status
 * - Summary cards using TStatCard
 * - Proper tijaero component usage (TStatCard, TCurrency, TStatusChip)
 * 
 * Note: Moved from sales module to finance module for better organization.
 */

import PaymentIcon from "@mui/icons-material/Payment";

import MonetizationOnIcon from "@mui/icons-material/MonetizationOn";
import PendingActionsIcon from "@mui/icons-material/PendingActions";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ReceiptIcon from "@mui/icons-material/Receipt";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import StarIcon from "@mui/icons-material/Star";
import StarOutlineIcon from "@mui/icons-material/StarBorder";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import {
  Autocomplete,
  Avatar,
  Box,
  Button,
  Checkbox,
  Grid,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";

import {
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  FormSection,
  getStatusProps,
  handleApiError,
  MasterDetailLayout,
  SelectableListItem,
  showErrorToast,
  showSuccessToast,
  TCurrency,
  TDetailSkeleton,
  TExportButton,
  TSearchableSelect,
  TStatCard,
  TStatusChip,
  TStatusFilter,
  modernTableStyles,
  useCrudMutation,
  useMasterDetailState,
  TDataGrid,
  type TDataGridColumn,
} from "@/components/tijaero";

import { usePermission } from "@/auth/permissions";
import { customersApi } from "@/modules/customers/api";
import { useReferenceData } from "@/hooks";
import { commissionsApi, commissionPaymentsApi } from "@/modules/sales/commission-api";
import {
  CustomerAgentCommissionPayment,
  CustomerAgentCommissionPaymentCreate,
  CommissionPaymentItemCreate,
  CustomerAgentCommission,
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_STATUS_OPTIONS,
} from "@/modules/sales/commission-types";

type PaymentWithAgent = CustomerAgentCommissionPayment & { agent_name?: string };

const INITIAL_FORM_DATA: CustomerAgentCommissionPaymentCreate = {
  customer_agent_id: 0,
  payment_date: new Date().toISOString().split("T")[0],
  payment_method: "Cash",
  payment_amount: 0,
  reference_number: "",
  bank_name: "",
  branch_code: "",
  remarks: "",
  items: [],
};

const resetFormFromPayment = (
  payment: PaymentWithAgent
): CustomerAgentCommissionPaymentCreate => ({
  customer_agent_id: payment.customer_agent_id,
  payment_date: payment.payment_date,
  payment_method: payment.payment_method,
  payment_amount: payment.payment_amount,
  reference_number: payment.reference_number || "",
  bank_name: payment.bank_name || "",
  branch_code: payment.branch_code,
  remarks: payment.remarks || "",
  items: [],
});

export default function CommissionPaymentsPage() {
  // Permissions
  const canCreate = usePermission("commission_payments", "create");
  const canUpdate = usePermission("commission_payments", "update");
  const canViewCustomers = usePermission("customers", "view");

  // Filter state - all filters apply live as the user types/selects, no
  // separate "Search" step needed.
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterAgentId, setFilterAgentId] = useState<number | null>(null);

  // Pending commissions for payment creation
  const [pendingCommissions, setPendingCommissions] = useState<CustomerAgentCommission[]>([]);
  const [selectedCommissionIds, setSelectedCommissionIds] = useState<Set<number>>(new Set());
  const [paymentItemAmounts, setPaymentItemAmounts] = useState<Record<number, number>>({});

  // State hook
  const {
    searchQuery,
    setSearchQuery,
    selectedItem: selectedPayment,
    setSelectedItem: setSelectedPayment,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    favorites,
    toggleFavorite,
    formData,
    setFormData,
    handleSelectItem: handleSelectPayment,
    handleNew: handleNewPayment,
    handleCancel: baseHandleCancel,
  } = useMasterDetailState<PaymentWithAgent, CustomerAgentCommissionPaymentCreate>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromPayment,
    favoritesKey: "commission_payments_favorites",
    defaultSortField: "created_at",
  });

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterAgentId(null);
    setFilterStatus(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Data fetching
  const { data: paymentsData, isLoading, refetch } = useQuery({
    queryKey: ["commission-payments", filterAgentId, filterStatus],
    queryFn: () =>
      commissionPaymentsApi.getAll({
        agent_id: filterAgentId || undefined,
        status: filterStatus || undefined,
        limit: 500,
      }),
  });

  const payments = (paymentsData?.items || []) as PaymentWithAgent[];

  // Fetch agents
  const { data: allCustomers } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.getAll(0, 1000),
    enabled: canViewCustomers,
  });

  const agents = useMemo(
    () => (allCustomers || []).filter((c) => c.is_customer_agent && c.active),
    [allCustomers]
  );

  // Fetch branches
  const { filteredBranches: branches = [], defaultBranchCode } = useReferenceData(["branches"]);

  // Set default branch when creating new payment
  useEffect(() => {
    if (isCreating && defaultBranchCode && !formData.branch_code) {
      setFormData(prev => ({ ...prev, branch_code: defaultBranchCode }));
    }
  }, [isCreating, defaultBranchCode, formData.branch_code, setFormData]);

  // Fetch payment details when a payment is selected
  const { data: paymentDetails, isLoading: isDetailLoading } = useQuery({
    queryKey: ["commission-payment-detail", selectedPayment?.id],
    queryFn: () => selectedPayment ? commissionPaymentsApi.getById(selectedPayment.id) : Promise.resolve(null),
    enabled: !!selectedPayment && !isCreating && !isEditing,
  });

  // Compute summary stats
  const summaryStats = useMemo(() => {
    const total = payments.reduce((sum, p) => sum + p.payment_amount, 0);
    const pendingCount = payments.filter((p) => p.status === "pending").length;
    const pendingAmount = payments.filter((p) => p.status === "pending").reduce((sum, p) => sum + p.payment_amount, 0);
    const verifiedAmount = payments.filter((p) => p.status === "verified").reduce((sum, p) => sum + p.payment_amount, 0);
    return { total, pendingCount, pendingAmount, verifiedAmount, totalCount: payments.length };
  }, [payments]);

  // Load pending commissions when agent is selected for new payment
  useEffect(() => {
    if (isCreating && formData.customer_agent_id > 0) {
      commissionsApi
        .getPendingForAgent(formData.customer_agent_id)
        .then((data) => {
          setPendingCommissions(data);
          setSelectedCommissionIds(new Set());
          setPaymentItemAmounts({});
        })
        .catch(() => setPendingCommissions([]));
    } else {
      setPendingCommissions([]);
    }
  }, [isCreating, formData.customer_agent_id]);

  // Auto-calculate total payment amount from selected items
  useEffect(() => {
    if (isCreating) {
      const total = Array.from(selectedCommissionIds).reduce(
        (sum, id) => sum + (parseFloat(String(paymentItemAmounts[id])) || 0),
        0
      );
      setFormData((prev) => ({ ...prev, payment_amount: parseFloat(total.toFixed(2)) }));
    }
  }, [selectedCommissionIds, paymentItemAmounts, isCreating, setFormData]);

  // Filter and sort
  const filteredPayments = useMemo(() => {
    let filtered = [...payments];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.payment_no?.toLowerCase().includes(q) ||
          p.agent_name?.toLowerCase().includes(q) ||
          p.reference_number?.toLowerCase().includes(q)
      );
    }

    // Default order before the user sorts a column in the table itself (the
    // table's own column-header sort takes over from there) — newest first.
    filtered.sort((a, b) => {
      const diff = new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
      return diff !== 0 ? diff : (b.id || 0) - (a.id || 0);
    });

    return filtered;
  }, [payments, searchQuery]);

  // Mutations
  const createMutation = useCrudMutation({
    mutationFn: commissionPaymentsApi.create,
    invalidateQueryKeys: [
      ["commission-payments"],
      ["agent-commissions"],
      ["agent-commission-summaries"],
    ],
    successMessage: "Payment created successfully",
    errorMessage: "Failed to create payment",
    onSuccess: () => {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedCommissionIds(new Set());
      setPaymentItemAmounts({});
    },
  });

  // Handlers
  const handleToggleCommission = (commissionId: number, commission: CustomerAgentCommission) => {
    const newSet = new Set(selectedCommissionIds);
    if (newSet.has(commissionId)) {
      newSet.delete(commissionId);
      const newAmounts = { ...paymentItemAmounts };
      delete newAmounts[commissionId];
      setPaymentItemAmounts(newAmounts);
    } else {
      newSet.add(commissionId);
      setPaymentItemAmounts((prev) => ({
        ...prev,
        [commissionId]: parseFloat(String(commission.commission_amount)) || 0,
      }));
    }
    setSelectedCommissionIds(newSet);
  };

  const handleSave = useCallback(() => {
    if (!formData.customer_agent_id || !formData.branch_code) {
      showErrorToast("Agent and Branch are required");
      return;
    }
    if (selectedCommissionIds.size === 0) {
      showErrorToast("Select at least one commission to pay");
      return;
    }

    const items: CommissionPaymentItemCreate[] = Array.from(selectedCommissionIds).map((id) => ({
      commission_id: id,
      paid_amount: parseFloat(String(paymentItemAmounts[id])) || 0,
    }));

    const totalItems = items.reduce((sum, item) => sum + item.paid_amount, 0);

    const payload: CustomerAgentCommissionPaymentCreate = {
      ...formData,
      payment_amount: parseFloat(totalItems.toFixed(2)),
      items,
    };

    createMutation.mutate(payload);
  }, [formData, selectedCommissionIds, paymentItemAmounts]);

  const isFormValid = Boolean(
    formData.customer_agent_id > 0 &&
    formData.branch_code &&
    formData.payment_amount > 0 &&
    selectedCommissionIds.size > 0
  );
  const isSaving = createMutation.isPending;

  // Cancelling out of "New Payment" should return to the browse table, not
  // auto-open the first payment the way useMasterDetailState's generic
  // handleCancel does (that behavior made sense for the old always-visible
  // detail panel, but not here).
  const handleCancelPayment = useCallback(() => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedPayment(null);
      setSelectedCommissionIds(new Set());
      setPaymentItemAmounts({});
    } else {
      baseHandleCancel(filteredPayments);
    }
  }, [isCreating, filteredPayments, baseHandleCancel, setIsCreating, setIsEditing, setSelectedPayment]);

  // Returns to the browse table from the detail view.
  const handleBackToPayments = useCallback(() => {
    setSelectedPayment(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedCommissionIds(new Set());
      setPaymentItemAmounts({});
    }
  }, [isCreating, setSelectedPayment, setIsCreating, setIsEditing]);

  // The table sorts by whichever column the user clicks via the grid's own
  // column header menu, not a separate "Sort by" control.
  const paymentColumns: TDataGridColumn<PaymentWithAgent>[] = useMemo(
    () => [
      {
        field: "favorite",
        header: "",
        width: 48,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<PaymentWithAgent>) => (
          <IconButton size="small" onClick={(e) => toggleFavorite(params.row.id, e)}>
            {favorites.includes(params.row.id) ? (
              <StarIcon fontSize="small" color="warning" />
            ) : (
              <StarOutlineIcon fontSize="small" color="action" />
            )}
          </IconButton>
        ),
      },
      { field: "payment_no", header: "Payment No", flex: 1, minWidth: 150 },
      { field: "agent_name", header: "Agent", flex: 1, minWidth: 160 },
      {
        field: "payment_date",
        header: "Date",
        width: 120,
        renderCell: (params: GridRenderCellParams<PaymentWithAgent>) =>
          params.row.payment_date ? format(new Date(params.row.payment_date), "dd/MM/yyyy") : "-",
      },
      {
        field: "payment_amount",
        header: "Amount",
        width: 140,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<PaymentWithAgent>) => (
          <TCurrency value={params.row.payment_amount} variant="body2" fontWeight={600} />
        ),
      },
      {
        field: "status",
        header: "Status",
        width: 130,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<PaymentWithAgent>) => (
          <TStatusChip status={params.row.status} statusMap="commissionPaymentStatus" size="small" />
        ),
      },
      { field: "reference_number", header: "Reference", width: 150 },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<PaymentWithAgent>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectPayment(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [favorites, toggleFavorite, handleSelectPayment]
  );

  // Whether we're showing a single payment's detail view (selected or being
  // created) instead of the browse table.
  const isPaymentDetailMode = !!selectedPayment || isCreating;

  // Browse mode: summary stat cards plus a full-width table of every payment.
  const paymentsTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ p: 1.5, pb: 0 }}>
        <Grid container spacing={2} sx={{ mb: 1.5 }}>
          <Grid item xs={12} sm={6} md={3}>
            <TStatCard
              title="Total Payments"
              value={summaryStats.total}
              icon={<MonetizationOnIcon />}
              color="primary"
              isCurrency
              subtitle={`${summaryStats.totalCount} payments`}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <TStatCard
              title="Pending Verification"
              value={summaryStats.pendingAmount}
              icon={<PendingActionsIcon />}
              color="warning"
              isCurrency
              badge={summaryStats.pendingCount}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <TStatCard
              title="Verified Payments"
              value={summaryStats.verifiedAmount}
              icon={<CheckCircleIcon />}
              color="success"
              isCurrency
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <TStatCard
              title="Active Agents"
              value={agents.length}
              icon={<ReceiptIcon />}
              color="info"
            />
          </Grid>
        </Grid>
      </Box>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<PaymentWithAgent>
          rows={filteredPayments}
          columns={paymentColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectPayment(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No payments found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Detail mode: a narrow left panel showing only the current payment (or the
  // "New Payment" placeholder while creating) plus a "Back to Commission
  // Payments" link that returns to the table.
  const singlePaymentPanel = (
    <Paper
      elevation={0}
      sx={{
        width: 280,
        minWidth: 240,
        maxWidth: 300,
        borderRight: 1,
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <Box sx={{ p: 1, borderBottom: 1, borderColor: "divider" }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon fontSize="small" />}
          onClick={handleBackToPayments}
          sx={{ textTransform: "none" }}
        >
          Back to Commission Payments
        </Button>
      </Box>
      {isCreating ? (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ width: 40, height: 40 }}>
              <PaymentIcon fontSize="small" />
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              New Commission Payment
            </Typography>
          </Box>
        </Box>
      ) : selectedPayment && (
        <SelectableListItem
          id={selectedPayment.id}
          isSelected
          onClick={() => {}}
          primaryText={
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
              <Avatar sx={{ width: 36, height: 36 }}>
                <PaymentIcon fontSize="small" />
              </Avatar>
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5, minWidth: 0 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{selectedPayment.payment_no}</span>
                </Box>
              </Box>
            </Box>
          }
          isFavorite={favorites.includes(selectedPayment.id)}
          onToggleFavorite={(e) => toggleFavorite(selectedPayment.id, e)}
        />
      )}
    </Paper>
  );

  // Detail Panel
  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Finance", href: "/finance" },
          { label: "Commission Payments", href: "/finance/commission-payments" },
          ...(selectedPayment || isCreating
            ? [{ label: isCreating ? "New Payment" : selectedPayment?.payment_no || "" }]
            : []),
        ]}
        title={selectedPayment ? selectedPayment.payment_no : ""}
        titleIcon={<PaymentIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Commission Payment"
        noSelectionTitle="Select a Payment"
        chips={
          selectedPayment
            ? [
                {
                  label: selectedPayment.status.charAt(0).toUpperCase() + selectedPayment.status.slice(1),
                  color: getStatusProps(selectedPayment.status, "commissionPaymentStatus").color,
                },
              ]
            : []
        }
        isFavorite={selectedPayment ? favorites.includes(selectedPayment.id) : false}
        onToggleFavorite={selectedPayment ? (e) => toggleFavorite(selectedPayment.id, e) : undefined}
      />

      <ActionToolbar
        canCreate={canCreate}
        canUpdate={canUpdate}
        canDelete={false}
        hasSelectedItem={!!selectedPayment}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={isFormValid}
        onNew={handleNewPayment}
        onSave={handleSave}
        onCancel={handleCancelPayment}
        onEdit={() => {}} // Payments are not editable
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedPayment && !isCreating ? (
          <>
            {/* Summary Stats */}
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} sm={6} md={3}>
                <TStatCard
                  title="Total Payments"
                  value={summaryStats.total}
                  icon={<MonetizationOnIcon />}
                  color="primary"
                  isCurrency
                  subtitle={`${summaryStats.totalCount} payments`}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TStatCard
                  title="Pending Verification"
                  value={summaryStats.pendingAmount}
                  icon={<PendingActionsIcon />}
                  color="warning"
                  isCurrency
                  badge={summaryStats.pendingCount}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TStatCard
                  title="Verified Payments"
                  value={summaryStats.verifiedAmount}
                  icon={<CheckCircleIcon />}
                  color="success"
                  isCurrency
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TStatCard
                  title="Active Agents"
                  value={agents.length}
                  icon={<ReceiptIcon />}
                  color="info"
                />
              </Grid>
            </Grid>
            <EmptyState message="Select a payment from the list or create a new one" />
          </>
        ) : isDetailLoading && !isCreating ? (
          <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} showTable />
        ) : isCreating ? (
          <>
            {/* Payment Details */}
            <FormSection title="Payment Details" columns={2}>
              <Autocomplete
                size="small"
                options={agents}
                getOptionLabel={(option) => `${option.customer_name}${option.commission_rate ? ` (${option.commission_rate}%)` : ""}`}
                value={agents.find((a) => a.id === formData.customer_agent_id) || null}
                onChange={(_, newValue) =>
                  setFormData((prev) => ({
                    ...prev,
                    customer_agent_id: newValue?.id || 0,
                  }))
                }
                renderInput={(params) => (
                  <TextField {...params} label="Customer Agent *" placeholder="Select agent..." />
                )}
              />
              <TextField
                label="Payment Date"
                size="small"
                type="date"
                value={formData.payment_date}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, payment_date: e.target.value }))
                }
                InputLabelProps={{ shrink: true }}
                required
              />
              <TextField
                select
                size="small"
                label="Payment Method"
                value={formData.payment_method}
                onChange={(e) => {
                  setFormData((prev) => ({ 
                    ...prev, 
                    payment_method: e.target.value,
                    // Reset payment-specific fields when method changes
                    reference_number: "",
                    bank_name: "",
                  }));
                }}
                required
              >
                {PAYMENT_METHOD_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                size="small"
                label="Branch *"
                value={formData.branch_code}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, branch_code: e.target.value }))
                }
                required
              >
                {branches.map((branch: any) => (
                  <MenuItem key={branch.id} value={branch.branch_code || branch.id.toString()}>
                    {branch.branch_name || branch.branch_code}
                  </MenuItem>
                ))}
              </TextField>
            </FormSection>

            {/* Payment Method Specific Fields */}
            {formData.payment_method === "Bank Transfer" && (
              <FormSection title="Bank Transfer Details" columns={2}>
                <TextField
                  label="Bank Name *"
                  size="small"
                  value={formData.bank_name}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, bank_name: e.target.value }))
                  }
                  required
                />
                <TextField
                  label="Reference Number *"
                  size="small"
                  value={formData.reference_number}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, reference_number: e.target.value }))
                  }
                  placeholder="Bank transfer reference"
                  required
                />
              </FormSection>
            )}

            {formData.payment_method === "Cheque" && (
              <FormSection title="Cheque Details" columns={2}>
                <TextField
                  label="Cheque Number *"
                  size="small"
                  value={formData.reference_number}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, reference_number: e.target.value }))
                  }
                  placeholder="Cheque number"
                  required
                />
                <TextField
                  label="Bank Name *"
                  size="small"
                  value={formData.bank_name}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, bank_name: e.target.value }))
                  }
                  required
                />
              </FormSection>
            )}

            {formData.payment_method === "Cash" && (
              <FormSection title="Cash Payment" columns={1}>
                <Typography variant="body2" color="info.dark">
                  No additional details required. Payment will be recorded as cash transaction.
                </Typography>
              </FormSection>
            )}

            {/* Select Commissions to Pay */}
            {formData.customer_agent_id > 0 && (
              <FormSection title={`Select Commissions to Pay (${pendingCommissions.length} available)`} columns={1}>
                {pendingCommissions.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No pending/approved commissions for this agent
                  </Typography>
                ) : (
                  <Table size="small" sx={modernTableStyles}>
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox"></TableCell>
                        <TableCell>Invoice</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell align="right">Commission</TableCell>
                        <TableCell align="right">Pay Amount</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {pendingCommissions.map((commission) => (
                        <TableRow key={commission.id} hover>
                          <TableCell padding="checkbox">
                            <Checkbox
                              checked={selectedCommissionIds.has(commission.id)}
                              onChange={() => handleToggleCommission(commission.id, commission)}
                              size="small"
                            />
                          </TableCell>
                          <TableCell>Invoice #{commission.invoice_id}</TableCell>
                          <TableCell>
                            <TStatusChip
                              status={commission.status}
                              statusMap="commissionStatus"
                              size="small"
                            />
                          </TableCell>
                          <TableCell align="right">
                            <TCurrency value={parseFloat(String(commission.commission_amount)) || 0} variant="body2" />
                          </TableCell>
                          <TableCell align="right" sx={{ width: 150 }}>
                            {selectedCommissionIds.has(commission.id) && (
                              <TextField
                                size="small"
                                type="number"
                                value={parseFloat(String(paymentItemAmounts[commission.id])) || 0}
                                onChange={(e) =>
                                  setPaymentItemAmounts((prev) => ({
                                    ...prev,
                                    [commission.id]: parseFloat(e.target.value) || 0,
                                  }))
                                }
                                inputProps={{ min: 0, max: parseFloat(String(commission.commission_amount)) || 0, step: 0.01 }}
                                sx={{ width: 130 }}
                              />
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1, p: 1, bgcolor: "action.hover", borderRadius: 1 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography variant="subtitle2" fontWeight={600}>Total Payment:</Typography>
                    <TCurrency value={Number(formData.payment_amount)} variant="subtitle2" fontWeight={700} />
                  </Box>
                </Box>
              </FormSection>
            )}

            {/* Remarks */}
            <FormSection title="Remarks" columns={1}>
              <TextField
                label="Remarks"
                size="small"
                value={formData.remarks}
                onChange={(e) => setFormData((prev) => ({ ...prev, remarks: e.target.value }))}
                multiline
                rows={2}
                fullWidth
              />
            </FormSection>
          </>
        ) : (
          /* View Payment Details */
          selectedPayment && (
            <>
              <FormSection title="Payment Details" columns={3}>
                <TextField label="Payment No" size="small" value={selectedPayment.payment_no} disabled />
                <TextField label="Branch" size="small" value={selectedPayment.branch_code} disabled />
                <TextField label="Reference Number" size="small" value={selectedPayment.reference_number || "-"} disabled />
                <TextField label="Bank Name" size="small" value={selectedPayment.bank_name || "-"} disabled />
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography variant="body2" color="text.secondary">Status:</Typography>
                  <TStatusChip status={selectedPayment.status} statusMap="commissionPaymentStatus" />
                </Box>
              </FormSection>

              {selectedPayment.remarks && (
                <FormSection title="Remarks" columns={1}>
                  <TextField label="Remarks" size="small" value={selectedPayment.remarks} disabled multiline rows={2} fullWidth />
                </FormSection>
              )}

              {/* Payment Items */}
              {paymentDetails && (
                <FormSection title="Payment Items" columns={1}>
                  <Table size="small" sx={modernTableStyles}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Invoice</TableCell>
                        <TableCell align="right">Invoice Amount</TableCell>
                        <TableCell align="right">Commission</TableCell>
                        <TableCell align="right">Paid Amount</TableCell>
                        <TableCell>Status</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(paymentDetails as any)?.items?.map((item: any) => (
                        <TableRow key={item.item?.id || item.id}>
                          <TableCell>{item.invoice_no || `Invoice #${item.item?.commission_id || item.commission_id}`}</TableCell>
                          <TableCell align="right">
                            <TCurrency value={item.invoice_amount || 0} variant="body2" />
                          </TableCell>
                          <TableCell align="right">
                            <TCurrency value={item.commission_amount || 0} variant="body2" />
                          </TableCell>
                          <TableCell align="right">
                            <TCurrency value={item.item?.paid_amount || item.paid_amount || 0} variant="body2" fontWeight={600} />
                          </TableCell>
                          <TableCell>
                            <TStatusChip
                              status={item.commission_status || "N/A"}
                              statusMap="commissionStatus"
                              fallbackLabel={item.commission_status || "N/A"}
                              size="small"
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </FormSection>
              )}

              {selectedPayment.verified_date && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
                  Verified on: {format(new Date(selectedPayment.verified_date), "dd MMM yyyy HH:mm")}
                </Typography>
              )}
            </>
          )
        )}
      </Box>
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title="Commission Payments"
        titleSlot={
          isPaymentDetailMode ? undefined : (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <TextField
              size="small"
              placeholder="Search payments..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              }}
              sx={{ width: 220, flexShrink: 0 }}
            />
            <Box sx={{ width: 180, flexShrink: 0 }}>
              <TSearchableSelect
                label=""
                value={filterAgentId}
                onChange={(val) => setFilterAgentId(val ? Number(val) : null)}
                options={agents.map((agent) => ({
                  value: agent.id,
                  label: agent.customer_name,
                }))}
                showAllOption
                allOptionLabel="All Agents"
                placeholder="All Agents"
                size="small"
              />
            </Box>
            <Box sx={{ width: 150, flexShrink: 0 }}>
              <TStatusFilter
                options={PAYMENT_STATUS_OPTIONS}
                value={filterStatus}
                onChange={setFilterStatus}
                label=""
                placeholder="All Status"
                size="small"
              />
            </Box>
            {(searchQuery || filterAgentId || filterStatus) && (
              <Tooltip title="Clear filters">
                <IconButton size="small" onClick={handleClearFilters}>
                  <ClearIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
          )
        }
        onRefresh={refetch}
        isLoading={isLoading}
        headerActions={
          isPaymentDetailMode ? undefined : (
            <>
              {canCreate && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={handleNewPayment}
                  sx={{ mr: 1 }}
                >
                  Add Commission Payment
                </Button>
              )}
              <TExportButton
                filename="commission_payments"
                headers={[
                  "Payment No",
                  "Agent",
                  "Amount",
                  "Payment Date",
                  "Method",
                  "Reference",
                  "Bank",
                  "Status",
                  "Created",
                ]}
                rows={() =>
                  filteredPayments.map((p) => [
                    p.payment_no || "",
                    p.agent_name || "",
                    p.payment_amount ?? 0,
                    p.payment_date || "",
                    p.payment_method || "",
                    p.reference_number || "",
                    p.bank_name || "",
                    p.status || "",
                    p.created_at || "",
                  ])
                }
                disabled={filteredPayments.length === 0}
              />
            </>
          )
        }
        {...(isPaymentDetailMode
          ? { masterPanel: singlePaymentPanel, detailPanel }
          : { children: paymentsTablePanel })}
      />
    </>
  );
}
