/**
 * AgentCommissionsPage - Customer Agent Commission Management
 * 
 * Features:
 * - View all agent commissions with details
 * - Create new commission records
 * - Approve pending commissions
 * - Filter by agent, status, date range
 * - Agent summary with TStatCard components
 * - Proper tijaero component usage (TStatCard, TCurrency, TStatusChip)
 */

import MonetizationOnIcon from "@mui/icons-material/MonetizationOn";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ReceiptIcon from "@mui/icons-material/Receipt";
import PendingActionsIcon from "@mui/icons-material/PendingActions";
import PaidIcon from "@mui/icons-material/Paid";
import PersonIcon from "@mui/icons-material/Person";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Grid,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";

import {
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  fmtLKR,
  FormSection,
  getStatusProps,
  handleApiError,
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  showErrorToast,
  showSuccessToast,
  SortOption,
  TDetailSkeleton,
  TConfirmDialog,
  TCurrency,
  TSearchableSelect,
  TStatCard,
  TStatusChip,
  TStatusFilter,
  useCrudMutation,
  useMasterDetailState,
  useTConfirmDialog,
} from "@/components/tijaero";

import { usePermission } from "@/auth/permissions";
import { customersApi } from "@/modules/customers/api";
import { salesApi } from "@/modules/sales/api";
import { commissionsApi } from "@/modules/sales/commission-api";
import {
  CustomerAgentCommissionWithDetails,
  CustomerAgentCommissionCreate,
  COMMISSION_STATUS_OPTIONS,
  COMMISSION_TYPE_OPTIONS,
} from "@/modules/sales/commission-types";

// ── Date preset helpers ────────────────────────────────────────────────────
const toDateStr = (d: Date) => d.toISOString().split("T")[0];

const DATE_PRESETS = [
  {
    label: "Today",
    getRange: () => {
      const d = toDateStr(new Date());
      return { from: d, to: d };
    },
  },
  {
    label: "This Month",
    getRange: () => {
      const now = new Date();
      return {
        from: toDateStr(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: toDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      };
    },
  },
  {
    label: "Last Month",
    getRange: () => {
      const now = new Date();
      return {
        from: toDateStr(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: toDateStr(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    },
  },
  {
    label: "This Quarter",
    getRange: () => {
      const now = new Date();
      const quarter = Math.floor(now.getMonth() / 3);
      return {
        from: toDateStr(new Date(now.getFullYear(), quarter * 3, 1)),
        to: toDateStr(new Date(now.getFullYear(), quarter * 3 + 3, 0)),
      };
    },
  },
];

// Configuration
const SORT_OPTIONS: SortOption[] = [
  { value: "created_at", label: "Date Created" },
  { value: "commission_amount", label: "Commission Amount" },
  { value: "invoice_amount", label: "Invoice Amount" },
];

const INITIAL_FORM_DATA: CustomerAgentCommissionCreate = {
  invoice_id: 0,
  customer_agent_id: 0,
  represented_customer_id: 0,
  invoice_amount: 0,
  commission_type: "PERCENT",
  commission_rate: 0,
  commission_amount: 0,
  remarks: "",
};

const resetFormFromCommission = (
  commission: CustomerAgentCommissionWithDetails
): CustomerAgentCommissionCreate => ({
  invoice_id: commission.invoice_id,
  customer_agent_id: commission.customer_agent_id,
  represented_customer_id: commission.represented_customer_id,
  invoice_amount: commission.invoice_amount,
  commission_type: commission.commission_type,
  commission_rate: commission.commission_rate || 0,
  commission_amount: commission.commission_amount,
  remarks: commission.remarks || "",
});

export default function AgentCommissionsPage() {
  // Permissions
  const canCreate = usePermission("agent_commissions", "create");
  const canUpdate = usePermission("agent_commissions", "update");
  const canDelete = usePermission("agent_commissions", "delete");
  const canApprove = usePermission("commission_approvals", "approve");

  // Filter states
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterAgentId, setFilterAgentId] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // State hook
  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem: selectedCommission,
    setSelectedItem: setSelectedCommission,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    favorites,
    toggleFavorite,
    formData,
    setFormData,
    handleSelectItem: handleSelectCommission,
    handleNew: handleNewCommission,
    handleCancel: baseHandleCancel,
    handleStartEdit,
  } = useMasterDetailState<CustomerAgentCommissionWithDetails, CustomerAgentCommissionCreate>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromCommission,
    favoritesKey: "agent_commissions_favorites",
    defaultSortField: "created_at",
  });

  // Data fetching
  const { data: commissionsData, isLoading, refetch } = useQuery({
    queryKey: ["agent-commissions", filterAgentId, filterStatus, dateFrom, dateTo],
    queryFn: () =>
      commissionsApi.getAll({
        agent_id: filterAgentId || undefined,
        status: filterStatus || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: 500,
      }),
  });

  const commissions = commissionsData?.items || [];

  // Fetch agents for filter dropdown
  const canViewCustomers = usePermission("customers", "view");
  const { data: allCustomers } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.getAll(0, 1000),
    enabled: canViewCustomers,
  });

  const agents = useMemo(
    () => (allCustomers || []).filter((c) => c.is_customer_agent && c.active),
    [allCustomers]
  );

  const customers = useMemo(
    () => (allCustomers || []).filter((c) => !c.is_customer_agent && c.active),
    [allCustomers]
  );

  // Fetch agent summaries
  const { data: agentSummaries } = useQuery({
    queryKey: ["agent-commission-summaries"],
    queryFn: () => commissionsApi.getAllAgentsSummary(),
  });

  // Fetch invoices for the create form
  const { data: invoices } = useQuery({
    queryKey: ["sales-invoices"],
    queryFn: () => salesApi.getAll(0, 1000),
    enabled: isCreating || isEditing,
  });

  // Compute overall summary stats
  const summaryStats = useMemo(() => {
    if (!agentSummaries || agentSummaries.length === 0) {
      return { totalCommissions: 0, totalPending: 0, totalApproved: 0, totalPaid: 0, totalAgents: 0, totalInvoices: 0 };
    }
    return {
      totalCommissions: agentSummaries.reduce((sum, s) => sum + s.total_commissions, 0),
      totalPending: agentSummaries.reduce((sum, s) => sum + s.pending_amount, 0),
      totalApproved: agentSummaries.reduce((sum, s) => sum + s.approved_amount, 0),
      totalPaid: agentSummaries.reduce((sum, s) => sum + s.paid_amount, 0),
      totalAgents: agentSummaries.length,
      totalInvoices: agentSummaries.reduce((sum, s) => sum + s.total_invoices, 0),
    };
  }, [agentSummaries]);

  // Filter and sort
  const filteredCommissions = useMemo(() => {
    let filtered = [...commissions];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.invoice_no?.toLowerCase().includes(q) ||
          c.agent_name?.toLowerCase().includes(q) ||
          c.customer_name?.toLowerCase().includes(q)
      );
    }

    filtered.sort((a, b) => {
      if (sortField === "created_at") {
        return new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
      } else if (sortField === "commission_amount") {
        return b.commission_amount - a.commission_amount;
      } else if (sortField === "invoice_amount") {
        return b.invoice_amount - a.invoice_amount;
      }
      return 0;
    });

    return filtered;
  }, [commissions, searchQuery, sortField]);

  // Auto-select first item
  useEffect(() => {
    if (filteredCommissions.length > 0 && !selectedCommission && !isCreating) {
      handleSelectCommission(filteredCommissions[0]);
    }
  }, [filteredCommissions, selectedCommission, isCreating]);

  // Auto-calculate commission amount when type/rate/invoice_amount changes
  useEffect(() => {
    if ((isCreating || isEditing) && formData.commission_type === "PERCENT" && formData.commission_rate && formData.invoice_amount) {
      const amount = (formData.invoice_amount * formData.commission_rate) / 100;
      setFormData((prev) => ({ ...prev, commission_amount: parseFloat(amount.toFixed(2)) }));
    }
  }, [formData.commission_type, formData.commission_rate, formData.invoice_amount, isCreating, isEditing]);

  // Mutations
  const createMutation = useCrudMutation({
    mutationFn: commissionsApi.create,
    invalidateQueryKeys: [["agent-commissions"], ["agent-commission-summaries"]],
    successMessage: "Commission created successfully",
    errorMessage: "Failed to create commission",
    onSuccess: () => {
      setIsCreating(false);
      setIsEditing(false);
    },
  });

  const updateMutation = useCrudMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      commissionsApi.update(id, data),
    invalidateQueryKeys: [["agent-commissions"], ["agent-commission-summaries"]],
    successMessage: "Commission updated successfully",
    errorMessage: "Failed to update commission",
    onSuccess: () => {
      setIsEditing(false);
    },
  });

  const approveMutation = useCrudMutation({
    mutationFn: commissionsApi.approve,
    invalidateQueryKeys: [["agent-commissions"], ["agent-commission-summaries"]],
    successMessage: "Commission approved successfully",
    errorMessage: "Failed to approve commission",
  });

  const deleteMutation = useCrudMutation({
    mutationFn: commissionsApi.delete,
    invalidateQueryKeys: [["agent-commissions"], ["agent-commission-summaries"]],
    successMessage: "Commission deleted successfully",
    errorMessage: "Failed to delete commission",
    onSuccess: () => {
      setSelectedCommission(null);
    },
  });

  const confirmDialog = useTConfirmDialog();

  // Handlers
  const handleSave = useCallback(() => {
    if (!formData.customer_agent_id || !formData.invoice_id || !formData.represented_customer_id) {
      showErrorToast("Agent, Customer and Invoice are required");
      return;
    }
    if (formData.commission_amount <= 0) {
      showErrorToast("Commission amount must be greater than 0");
      return;
    }

    if (isCreating) {
      createMutation.mutate(formData);
    } else if (selectedCommission) {
      updateMutation.mutate({
        id: selectedCommission.id,
        data: {
          commission_type: formData.commission_type,
          commission_rate: formData.commission_rate,
          commission_amount: formData.commission_amount,
          remarks: formData.remarks,
        },
      });
    }
  }, [isCreating, selectedCommission, formData]);

  const handleDelete = useCallback(async () => {
    if (selectedCommission) {
      const confirmed = await confirmDialog.confirm({
        title: "Delete Commission",
        message: "Are you sure you want to delete this commission record?",
        confirmText: "Delete",
        confirmColor: "error",
      });
      if (confirmed) {
        deleteMutation.mutate(selectedCommission.id);
      }
    }
  }, [selectedCommission, deleteMutation, confirmDialog]);

  const handleApprove = useCallback(async () => {
    if (selectedCommission) {
      const confirmed = await confirmDialog.confirm({
        title: "Approve Commission",
        message: `Approve commission for agent "${selectedCommission.agent_name}"?`,
        confirmText: "Approve",
        confirmColor: "success",
      });
      if (confirmed) {
        approveMutation.mutate(selectedCommission.id);
      }
    }
  }, [selectedCommission, approveMutation, confirmDialog]);

  // When invoice is selected, auto-fill invoice_amount and customer
  const handleInvoiceChange = (invoiceId: number) => {
    const invoice = invoices?.find((inv) => inv.id === invoiceId);
    if (invoice) {
      setFormData((prev) => ({
        ...prev,
        invoice_id: invoiceId,
        invoice_amount: invoice.grand_total || invoice.subtotal || 0,
        represented_customer_id: invoice.customer_id,
      }));
    } else {
      setFormData((prev) => ({ ...prev, invoice_id: invoiceId }));
    }
  };

  // When agent is selected, auto-fill commission_rate from agent default
  const handleAgentChange = (agentId: number) => {
    const agent = agents.find((a) => a.id === agentId);
    setFormData((prev) => ({
      ...prev,
      customer_agent_id: agentId,
      commission_rate: agent?.commission_rate || prev.commission_rate,
    }));
  };

  const isFormValid = Boolean(
    formData.customer_agent_id > 0 &&
    formData.invoice_id > 0 &&
    formData.represented_customer_id > 0 &&
    formData.commission_amount > 0
  );
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDisabled = !isEditing && !isCreating;

  // Master Panel
  const masterPanel = (
    <SearchableList<CustomerAgentCommissionWithDetails>
      items={filteredCommissions}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search commissions..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedCommission}
      onSelectItem={handleSelectCommission}
      emptyMessage="No commissions found"
      listHeader={
        <Box sx={{ p: 1, borderBottom: "1px solid", borderColor: "divider", display: "flex", flexDirection: "column", gap: 1 }}>
          <TSearchableSelect
            label="Filter by Agent"
            value={filterAgentId}
            onChange={(val) => setFilterAgentId(val ? Number(val) : null)}
            options={agents.map((agent) => ({
              value: agent.id,
              label: agent.customer_name,
            }))}
            showAllOption
            allOptionLabel="All Agents"
            placeholder="Search agents..."
          />
          <TStatusFilter
            options={COMMISSION_STATUS_OPTIONS}
            value={filterStatus}
            onChange={setFilterStatus}
            label="Status"
          />
          <TextField
            size="small"
            fullWidth
            label="From Date"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            size="small"
            fullWidth
            label="To Date"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          {/* Date Range Presets */}
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {DATE_PRESETS.map((preset) => (
              <Button
                key={preset.label}
                size="small"
                variant="outlined"
                onClick={() => {
                  const { from, to } = preset.getRange();
                  setDateFrom(from);
                  setDateTo(to);
                }}
                sx={{ fontSize: "0.65rem", py: 0.25, px: 0.75, minWidth: 0 }}
              >
                {preset.label}
              </Button>
            ))}
            {(dateFrom || dateTo) && (
              <Button
                size="small"
                variant="text"
                color="error"
                onClick={() => { setDateFrom(""); setDateTo(""); }}
                sx={{ fontSize: "0.65rem", py: 0.25, px: 0.75, minWidth: 0 }}
              >
                Clear
              </Button>
            )}
          </Box>
        </Box>
      }
      renderItem={(commission, isSelected) => (
        <SelectableListItem
          key={commission.id}
          id={commission.id}
          isSelected={isSelected}
          onClick={() => handleSelectCommission(commission)}
          primaryText={
            <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{commission.invoice_no || `Invoice #${commission.invoice_id}`}</span>
              </Box>
              {isSelected && (
                <>
                  <Typography component="span" variant="caption">
                    Agent: {commission.agent_name}
                  </Typography>
                  <Typography component="span" variant="caption">
                    Customer: {commission.customer_name}
                  </Typography>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.5 }}>
                    <TCurrency value={commission.commission_amount} variant="caption" fontWeight={600} />
                    <TStatusChip
                      status={commission.status}
                      statusMap="commissionStatus"
                      size="small"
                    />
                  </Box>
                </>
              )}
            </Box>
          }
          secondaryText={
            !isSelected
              ? `${commission.agent_name}`
              : undefined
          }
          statusChip={
            !isSelected
              ? {
                  label: commission.status.charAt(0).toUpperCase() + commission.status.slice(1),
                  color: getStatusProps(commission.status, "commissionStatus").color,
                }
              : undefined
          }
          isFavorite={favorites.includes(commission.id)}
          onToggleFavorite={(e) => toggleFavorite(commission.id, e)}
        />
      )}
    />
  );

  // Detail Panel
  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Sales", href: "/sales" },
          { label: "Agent Commissions", href: "/sales/agent-commissions" },
          ...(selectedCommission || isCreating
            ? [{ label: isCreating ? "New Commission" : selectedCommission?.invoice_no || "" }]
            : []),
        ]}
        title={
          selectedCommission
            ? `${selectedCommission.invoice_no || `Commission #${selectedCommission.id}`}`
            : ""
        }
        titleIcon={<MonetizationOnIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Commission"
        noSelectionTitle="Select a Commission"
        chips={
          selectedCommission
            ? [
                {
                  label: selectedCommission.status.charAt(0).toUpperCase() + selectedCommission.status.slice(1),
                  color: getStatusProps(selectedCommission.status, "commissionStatus").color,
                },
              ]
            : []
        }
        isFavorite={selectedCommission ? favorites.includes(selectedCommission.id) : false}
        onToggleFavorite={selectedCommission ? (e) => toggleFavorite(selectedCommission.id, e) : undefined}
      />

      <ActionToolbar
        canCreate={canCreate}
        canUpdate={canUpdate}
        canDelete={canDelete}
        hasSelectedItem={!!selectedCommission}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={isFormValid}
        onNew={handleNewCommission}
        onDelete={handleDelete}
        onSave={handleSave}
        onCancel={() => baseHandleCancel(filteredCommissions)}
        onEdit={handleStartEdit}
        endActions={
          selectedCommission?.status === "pending" && canApprove && !isEditing && !isCreating
            ? (
                <Button
                  variant="contained"
                  color="success"
                  startIcon={<CheckCircleIcon />}
                  onClick={handleApprove}
                  size="small"
                >
                  Approve
                </Button>
              )
            : undefined
        }
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedCommission && !isCreating ? (
          <>
            {/* Overall Summary Stats */}
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} sm={6} md={3}>
                <TStatCard
                  title="Total Commissions"
                  value={summaryStats.totalCommissions}
                  icon={<MonetizationOnIcon />}
                  color="primary"
                  isCurrency
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TStatCard
                  title="Pending Amount"
                  value={summaryStats.totalPending}
                  icon={<PendingActionsIcon />}
                  color="warning"
                  isCurrency
                  badge={commissions.filter((c) => c.status === "pending").length}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TStatCard
                  title="Approved Amount"
                  value={summaryStats.totalApproved}
                  icon={<CheckCircleIcon />}
                  color="info"
                  isCurrency
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TStatCard
                  title="Paid Amount"
                  value={summaryStats.totalPaid}
                  icon={<PaidIcon />}
                  color="success"
                  isCurrency
                />
              </Grid>
            </Grid>

            {/* Per-Agent Summary Cards */}
            {agentSummaries && agentSummaries.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>
                  Agent Commission Overview
                </Typography>
                <Grid container spacing={2}>
                  {agentSummaries.map((summary) => (
                    <Grid item xs={12} sm={6} md={4} key={summary.agent_id}>
                      <TStatCard
                        title={summary.agent_name}
                        value={summary.total_commissions}
                        icon={<PersonIcon />}
                        color="primary"
                        isCurrency
                        subtitle={`${summary.total_invoices} invoices`}
                        onClick={() => setFilterAgentId(summary.agent_id)}
                        tooltip={`Pending: Rs. ${fmtLKR(summary.pending_amount)} | Approved: Rs. ${fmtLKR(summary.approved_amount)} | Paid: Rs. ${fmtLKR(summary.paid_amount)}`}
                        badge={summary.pending_amount > 0 ? 1 : undefined}
                      />
                    </Grid>
                  ))}
                </Grid>
              </Box>
            )}
            <EmptyState message="Select a commission from the list or create a new one" />
          </>
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} showTable />
        ) : (
          <>
            {/* Agent & Customer Selection */}
            <FormSection title="Commission Details" columns={2}>
              <Autocomplete
                size="small"
                options={agents}
                getOptionLabel={(option) => `${option.customer_name}${option.commission_rate ? ` (${option.commission_rate}%)` : ""}`}
                value={agents.find((a) => a.id === formData.customer_agent_id) || null}
                onChange={(_, newValue) => {
                  if (newValue) {
                    handleAgentChange(newValue.id);
                  } else {
                    setFormData((prev) => ({ ...prev, customer_agent_id: 0 }));
                  }
                }}
                disabled={isDisabled}
                renderInput={(params) => (
                  <TextField {...params} label="Customer Agent *" placeholder="Select agent..." />
                )}
              />
              <Autocomplete
                size="small"
                options={invoices || []}
                getOptionLabel={(option) => `${option.invoice_no} (Rs. ${fmtLKR(option.grand_total)})`}
                value={invoices?.find((inv) => inv.id === formData.invoice_id) || null}
                onChange={(_, newValue) => {
                  if (newValue) {
                    handleInvoiceChange(newValue.id);
                  } else {
                    setFormData((prev) => ({ ...prev, invoice_id: 0, invoice_amount: 0 }));
                  }
                }}
                disabled={isDisabled}
                renderInput={(params) => (
                  <TextField {...params} label="Invoice *" placeholder="Search invoice..." />
                )}
              />
              <Autocomplete
                size="small"
                options={customers}
                getOptionLabel={(option) => option.customer_name}
                value={customers.find((c) => c.id === formData.represented_customer_id) || null}
                onChange={(_, newValue) =>
                  setFormData((prev) => ({
                    ...prev,
                    represented_customer_id: newValue?.id || 0,
                  }))
                }
                disabled={isDisabled}
                renderInput={(params) => (
                  <TextField {...params} label="Represented Customer *" placeholder="Select customer..." />
                )}
              />
              <TextField
                label="Invoice Amount"
                size="small"
                type="number"
                value={formData.invoice_amount}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    invoice_amount: parseFloat(e.target.value) || 0,
                  }))
                }
                disabled={isDisabled}
                inputProps={{ min: 0, step: 0.01 }}
              />
            </FormSection>

            {/* Commission Calculation */}
            <FormSection title="Commission Calculation" columns={3}>
              <TextField
                select
                size="small"
                label="Commission Type"
                value={formData.commission_type}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    commission_type: e.target.value as "PERCENT" | "AMOUNT",
                  }))
                }
                disabled={isDisabled}
              >
                {COMMISSION_TYPE_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </TextField>
              {formData.commission_type === "PERCENT" && (
                <TextField
                  label="Commission Rate (%)"
                  size="small"
                  type="number"
                  value={formData.commission_rate}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      commission_rate: parseFloat(e.target.value) || 0,
                    }))
                  }
                  disabled={isDisabled}
                  inputProps={{ min: 0, max: 100, step: 0.01 }}
                />
              )}
              <TextField
                label="Commission Amount (Rs.)"
                size="small"
                type="number"
                value={formData.commission_amount}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    commission_amount: parseFloat(e.target.value) || 0,
                  }))
                }
                disabled={isDisabled || formData.commission_type === "PERCENT"}
                inputProps={{ min: 0, step: 0.01 }}
                helperText={
                  formData.commission_type === "PERCENT"
                    ? "Auto-calculated from rate"
                    : "Enter fixed commission amount"
                }
              />
            </FormSection>

            {/* Remarks */}
            <FormSection title="Additional Info" columns={1}>
              <TextField
                label="Remarks"
                size="small"
                value={formData.remarks}
                onChange={(e) => setFormData((prev) => ({ ...prev, remarks: e.target.value }))}
                disabled={isDisabled}
                multiline
                rows={2}
                fullWidth
              />
            </FormSection>

            {/* Permission warning */}
            {selectedCommission && selectedCommission.status === "pending" && !canApprove && !isCreating && !isEditing && (
              <Alert severity="info" sx={{ mt: 1.5 }}>
                You don't have permission to approve commissions. Contact your administrator to grant you the "Sales Approve" permission.
              </Alert>
            )}

            {/* View-only summary for existing commission */}
            {selectedCommission && !isCreating && !isEditing && (
              <Box sx={{ mt: 1.5 }}>
                <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                  Commission Summary
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6} md={3}>
                    <TStatCard
                      title="Invoice Amount"
                      value={selectedCommission.invoice_amount}
                      icon={<ReceiptIcon />}
                      color="primary"
                      isCurrency
                    />
                  </Grid>
                  <Grid item xs={12} sm={6} md={3}>
                    <TStatCard
                      title="Type / Rate"
                      value={
                        selectedCommission.commission_type === "PERCENT"
                          ? `${selectedCommission.commission_rate}%`
                          : "Fixed"
                      }
                      icon={<MonetizationOnIcon />}
                      color="warning"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6} md={3}>
                    <TStatCard
                      title="Commission"
                      value={selectedCommission.commission_amount}
                      icon={<PaidIcon />}
                      color="success"
                      isCurrency
                    />
                  </Grid>
                  <Grid item xs={12} sm={6} md={3}>
                    <TStatCard
                      title="Total Paid"
                      value={selectedCommission.total_paid || 0}
                      icon={<CheckCircleIcon />}
                      color="info"
                      isCurrency
                    />
                  </Grid>
                </Grid>

                {/* Status and dates */}
                <Box sx={{ mt: 1.5, display: "flex", gap: 2, alignItems: "center" }}>
                  <TStatusChip status={selectedCommission.status} statusMap="commissionStatus" />
                  {selectedCommission.approved_date && (
                    <Typography variant="caption" color="text.secondary">
                      Approved: {format(new Date(selectedCommission.approved_date), "dd MMM yyyy HH:mm")}
                    </Typography>
                  )}
                  {selectedCommission.created_at && (
                    <Typography variant="caption" color="text.secondary">
                      Created: {format(new Date(selectedCommission.created_at), "dd MMM yyyy HH:mm")}
                    </Typography>
                  )}
                </Box>
              </Box>
            )}
          </>
        )}
      </Box>
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title="Agent Commissions"
        onRefresh={refetch}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
