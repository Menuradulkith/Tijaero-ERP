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
import {
  Autocomplete,
  Box,
  Checkbox,
  Grid,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  SearchableList,
  SelectableListItem,
  showErrorToast,
  showSuccessToast,
  SortOption,
  TCurrency,
  TDetailSkeleton,
  TSearchableSelect,
  TStatCard,
  TStatusChip,
  TStatusFilter,
  modernTableStyles,
  useMasterDetailState,
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

// Configuration
const SORT_OPTIONS: SortOption[] = [
  { value: "created_at", label: "Date Created" },
  { value: "payment_amount", label: "Payment Amount" },
  { value: "payment_date", label: "Payment Date" },
];

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
  const queryClient = useQueryClient();

  // Permissions
  const canCreate = usePermission("customers", "create");
  const canUpdate = usePermission("customers", "update");

  // Filter states
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
    sortField,
    setSortField,
    selectedItem: selectedPayment,
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

    filtered.sort((a, b) => {
      if (sortField === "created_at") {
        return new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
      } else if (sortField === "payment_amount") {
        return b.payment_amount - a.payment_amount;
      } else if (sortField === "payment_date") {
        return new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime();
      }
      return 0;
    });

    return filtered;
  }, [payments, searchQuery, sortField]);

  // Auto-select first item
  useEffect(() => {
    if (filteredPayments.length > 0 && !selectedPayment && !isCreating) {
      handleSelectPayment(filteredPayments[0]);
    }
  }, [filteredPayments, selectedPayment, isCreating]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: commissionPaymentsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commission-payments"] });
      queryClient.invalidateQueries({ queryKey: ["agent-commissions"] });
      queryClient.invalidateQueries({ queryKey: ["agent-commission-summaries"] });
      showSuccessToast("Payment created successfully");
      setIsCreating(false);
      setIsEditing(false);
      setSelectedCommissionIds(new Set());
      setPaymentItemAmounts({});
    },
    onError: (error: unknown) => showErrorToast(handleApiError(error, "Failed to create payment")),
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

  // Master Panel
  const masterPanel = (
    <SearchableList<PaymentWithAgent>
      items={filteredPayments}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search payments..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedPayment}
      onSelectItem={handleSelectPayment}
      emptyMessage="No payments found"
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
            options={PAYMENT_STATUS_OPTIONS}
            value={filterStatus}
            onChange={setFilterStatus}
            label="Status"
          />
        </Box>
      }
      renderItem={(payment, isSelected) => (
        <SelectableListItem
          key={payment.id}
          id={payment.id}
          isSelected={isSelected}
          onClick={() => handleSelectPayment(payment)}
          primaryText={
            <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{payment.payment_no}</span>
              </Box>
              {isSelected && (
                <>
                  <Typography component="span" variant="caption">
                    Agent: {payment.agent_name}
                  </Typography>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <TCurrency value={payment.payment_amount} variant="caption" fontWeight={600} />
                  </Box>
                  <Typography component="span" variant="caption">
                    {format(new Date(payment.payment_date), "dd/MM/yyyy")}
                  </Typography>
                  <Box sx={{ display: "flex", gap: 0.5, mt: 0.5 }}>
                    <TStatusChip
                      status={payment.status}
                      statusMap="commissionPaymentStatus"
                      size="small"
                    />
                    <TStatusChip
                      status={payment.payment_method}
                      statusMap="paymentMethod"
                      fallbackLabel={payment.payment_method}
                      size="small"
                      variant="outlined"
                    />
                  </Box>
                </>
              )}
            </Box>
          }
          secondaryText={
            !isSelected
              ? `${payment.agent_name}`
              : undefined
          }
          statusChip={
            !isSelected
              ? {
                  label: payment.status.charAt(0).toUpperCase() + payment.status.slice(1),
                  color: getStatusProps(payment.status, "commissionPaymentStatus").color,
                }
              : undefined
          }
          isFavorite={favorites.includes(payment.id)}
          onToggleFavorite={(e) => toggleFavorite(payment.id, e)}
        />
      )}
    />
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
        onCancel={() => baseHandleCancel(filteredPayments)}
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
                    <TCurrency value={formData.payment_amount} variant="subtitle2" fontWeight={700} />
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
        onRefresh={refetch}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />
    </>
  );
}
