/**
 * CommissionPaymentApprovalsPage - Commission Payment Verification/Approvals
 *
 * Dedicated approvals page for commission payments.
 * Shows pending payments and allows verify/cancel actions.
 * Follows the same UI pattern as SalesOrderApprovalsPage.
 * 
 * Note: This page is titled "Commission Approvals" in the sidebar (for payments)
 * Note: Moved from sales module to finance module for better organization.
 */

import CancelIcon from "@mui/icons-material/Cancel";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import PersonIcon from "@mui/icons-material/Person";
import VerifiedIcon from "@mui/icons-material/Verified";
import {
  Box,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";

import {
  DetailPanelHeader,
  EmptyState,
  fmtLKR,
  FormSection,
  getStatusProps,
  handleApiError,
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  SortOption,
  TConfirmDialog,
  TDetailSkeleton,
  TFilterPanel,
  TSearchableSelect,
  TStatusChip,
  modernTableStyles,
  showErrorToast,
  showSuccessToast,
  useCrudMutation,
  useTConfirmDialog,
} from "@/components/tijaero";

import { usePermission } from "@/auth/permissions";
import { customersApi } from "@/modules/customers/api";
import { commissionPaymentsApi } from "@/modules/sales/commission-api";
import {
  CustomerAgentCommissionPayment,
  CustomerAgentCommissionPaymentWithItems,
} from "@/modules/sales/commission-types";

// ─── Configuration ───────────────────────────────────────────────────────────

type PaymentWithAgent = CustomerAgentCommissionPayment & { agent_name?: string };

const STATUS_FILTER_OPTIONS = [
  { value: "pending", label: "Pending", color: "warning" as const },
  { value: "verified", label: "Verified", color: "success" as const },
  { value: "cancelled", label: "Cancelled", color: "error" as const },
];

const SORT_OPTIONS: SortOption[] = [
  { value: "created_at", label: "Date Created" },
  { value: "payment_amount", label: "Payment Amount" },
  { value: "payment_date", label: "Payment Date" },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function CommissionPaymentApprovalsPage() {
  const canApprove = usePermission("commission_payment_approvals", "approve");
  const canUpdate = usePermission("commission_payments", "update");
  const canViewCustomers = usePermission("customers", "view");

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("created_at");
  const [filterStatus, setFilterStatus] = useState<string | null>("pending");
  const [filterAgentId, setFilterAgentId] = useState<number | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<PaymentWithAgent | null>(null);

  // Confirm dialogs
  const verifyDialog = useTConfirmDialog();
  const cancelDialog = useTConfirmDialog();

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const { data: paymentsData, isLoading, refetch } = useQuery({
    queryKey: ["commission-payment-approvals", filterStatus, filterAgentId],
    queryFn: () =>
      commissionPaymentsApi.getAll({
        status: filterStatus || undefined,
        agent_id: filterAgentId || undefined,
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

  const agentMap = useMemo(() => {
    const map = new Map<number, string>();
    (allCustomers || []).forEach((c) => map.set(c.id, c.customer_name));
    return map;
  }, [allCustomers]);

  // Fetch payment details when selected
  const { data: paymentDetails, isLoading: isDetailLoading } = useQuery({
    queryKey: ["commission-payment-detail", selectedPayment?.id],
    queryFn: () =>
      selectedPayment
        ? commissionPaymentsApi.getById(selectedPayment.id)
        : Promise.resolve(null),
    enabled: !!selectedPayment,
  });

  // ─── Filter & Sort ─────────────────────────────────────────────────────────

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
      if (sortField === "payment_amount") {
        return Number(b.payment_amount) - Number(a.payment_amount);
      } else if (sortField === "payment_date") {
        const diff = new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime();
        return diff !== 0 ? diff : (b.id || 0) - (a.id || 0);
      }
      const timeDiff = new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
      return timeDiff !== 0 ? timeDiff : (b.id || 0) - (a.id || 0);
    });

    return filtered;
  }, [payments, searchQuery, sortField]);

  // Auto-select first
  useEffect(() => {
    if (filteredPayments.length > 0 && !selectedPayment) {
      setSelectedPayment(filteredPayments[0]);
    }
  }, [filteredPayments, selectedPayment]);

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const verifyMutation = useCrudMutation({
    mutationFn: (id: number) => commissionPaymentsApi.verify(id),
    invalidateQueryKeys: [
      ["commission-payment-approvals"],
      ["commission-payments"],
      ["agent-commissions"],
      ["agent-commission-summaries"],
    ],
    successMessage: "Payment verified successfully",
    errorMessage: "Failed to verify payment",
    onSuccess: () => {
      setSelectedPayment(null);
    },
  });

  const cancelMutation = useCrudMutation({
    mutationFn: (id: number) => commissionPaymentsApi.cancel(id),
    invalidateQueryKeys: [
      ["commission-payment-approvals"],
      ["commission-payments"],
      ["agent-commissions"],
      ["agent-commission-summaries"],
    ],
    successMessage: "Payment cancelled successfully",
    errorMessage: "Failed to cancel payment",
    onSuccess: () => {
      setSelectedPayment(null);
    },
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleVerify = useCallback(() => {
    if (!selectedPayment) return;

    const currentHour = new Date().getHours();
    const isAfterHours = currentHour >= 18;

    if (isAfterHours) {
      verifyDialog.open(
        "After-Hours Verification Warning",
        `It is currently after 6:00 PM (now: ${new Date().toLocaleTimeString()}). Verifying payments after business hours is not recommended. Do you want to verify anyway?`,
        () => verifyMutation.mutate(selectedPayment.id)
      );
    } else {
      verifyDialog.open(
        "Verify Payment",
        `Verify payment ${selectedPayment.payment_no} of ${fmtLKR(selectedPayment.payment_amount)} for agent "${selectedPayment.agent_name || agentMap.get(selectedPayment.customer_agent_id) || "Unknown"}"?`,
        () => verifyMutation.mutate(selectedPayment.id)
      );
    }
  }, [selectedPayment, verifyMutation, verifyDialog, agentMap]);

  const handleCancel = useCallback(() => {
    if (!selectedPayment) return;

    cancelDialog.open(
      "Cancel Payment",
      `Are you sure you want to cancel payment ${selectedPayment.payment_no}? This will revert associated commission statuses and cannot be undone.`,
      () => cancelMutation.mutate(selectedPayment.id)
    );
  }, [selectedPayment, cancelMutation, cancelDialog]);

  // Helpers
  const getAgentName = (agentId: number) =>
    agentMap.get(agentId) || `Agent #${agentId}`;

  // ─── Master Panel ──────────────────────────────────────────────────────────

  const masterPanel = (
    <SearchableList
      items={filteredPayments}
      isLoading={isLoading}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search by payment no, agent..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedPayment}
      emptyMessage="No payments found"
      listHeader={
        <TFilterPanel>
          <TSearchableSelect
            label="Status"
            value={filterStatus}
            onChange={(val) => setFilterStatus(val as string | null)}
            options={STATUS_FILTER_OPTIONS.map((opt) => ({
              value: opt.value,
              label: opt.label,
              color: opt.color,
            }))}
            showAllOption
            allOptionLabel="All Statuses"
            placeholder="Search status..."
          />
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
        </TFilterPanel>
      }
      renderItem={(payment, isSelected) => {
        const statusChip = getStatusProps(payment.status, "commissionPaymentStatus");
        return (
          <SelectableListItem
            key={payment.id}
            isSelected={isSelected}
            onClick={() => setSelectedPayment(payment)}
            primaryText={
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  width: "100%",
                  gap: 0.5,
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span>{payment.payment_no}</span>
                  {isSelected && (
                    <Typography
                      component="span"
                      variant="caption"
                      sx={{ color: "inherit", opacity: 0.7 }}
                    >
                      (Payment No)
                    </Typography>
                  )}
                </Box>
                {isSelected && (
                  <>
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <Typography component="span" variant="caption">
                        {payment.agent_name || getAgentName(payment.customer_agent_id)}
                      </Typography>
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{ color: "inherit", opacity: 0.7 }}
                      >
                        (Agent)
                      </Typography>
                    </Box>
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <Typography component="span" variant="caption">
                        {format(new Date(payment.payment_date), "dd/MM/yyyy")}
                      </Typography>
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{ color: "inherit", opacity: 0.7 }}
                      >
                        (Date)
                      </Typography>
                    </Box>
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <Typography component="span" variant="caption">
                        Rs. {fmtLKR(Number(payment.payment_amount))}
                      </Typography>
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{ color: "inherit", opacity: 0.7 }}
                      >
                        (Amount)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, mt: 0.5 }}>
                      <TStatusChip
                        status={payment.status}
                        statusMap="commissionPaymentStatus"
                        size="small"
                      />
                    </Box>
                  </>
                )}
              </Box>
            }
            secondaryText={
              !isSelected
                ? `${payment.agent_name || getAgentName(payment.customer_agent_id)} - ${format(new Date(payment.payment_date), "dd/MM/yyyy")}`
                : undefined
            }
            statusChip={!isSelected ? statusChip : undefined}
          />
        );
      }}
    />
  );

  // ─── Detail Panel ──────────────────────────────────────────────────────────

  const detailPanel = (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Finance" },
          { label: "Commission Payment Approvals", href: "/finance/commission-payment-approvals" },
          ...(selectedPayment ? [{ label: selectedPayment.payment_no }] : []),
        ]}
        title={selectedPayment ? selectedPayment.payment_no : ""}
        titleIcon={<FactCheckIcon color="primary" />}
        noSelectionTitle="Select a Payment to Review"
        chips={
          selectedPayment
            ? [
                {
                  label:
                    selectedPayment.status.charAt(0).toUpperCase() +
                    selectedPayment.status.slice(1),
                  color: getStatusProps(selectedPayment.status, "commissionPaymentStatus").color,
                },
              ]
            : [{ label: "Pending Verification", color: "warning" }]
        }
      />

      {/* Approval Actions - Same style as SO Approvals */}
      {selectedPayment && selectedPayment.status === "pending" && (
        <Box
          sx={{
            display: "flex",
            gap: 1,
            p: 1,
            borderBottom: 1,
            borderColor: "divider",
            bgcolor: "background.paper",
          }}
        >
          {canApprove && (
            <Button
              variant="contained"
              color="primary"
              startIcon={<VerifiedIcon />}
              onClick={handleVerify}
              disabled={verifyMutation.isPending}
            >
              Verify
            </Button>
          )}
          {canUpdate && (
            <Button
              variant="outlined"
              color="error"
              startIcon={<CancelIcon />}
              onClick={handleCancel}
              disabled={cancelMutation.isPending}
            >
              Cancel Payment
            </Button>
          )}
        </Box>
      )}

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedPayment ? (
          <EmptyState message="Select a payment from the list to review" />
        ) : isDetailLoading ? (
          <TDetailSkeleton sections={2} fieldsPerSection={6} showHeader={false} showToolbar={false} showTable />
        ) : (
          <>
            {/* Payment Information */}
            <FormSection title="Payment Information" columns={3}>
              <TextField
                label="Payment No"
                size="small"
                value={selectedPayment.payment_no}
                disabled
              />
              <TextField
                label="Agent"
                size="small"
                value={
                  selectedPayment.agent_name ||
                  getAgentName(selectedPayment.customer_agent_id)
                }
                disabled
                InputProps={{
                  startAdornment: (
                    <PersonIcon fontSize="small" color="primary" sx={{ mr: 1 }} />
                  ),
                }}
              />
              <TextField
                label="Branch"
                size="small"
                value={selectedPayment.branch_code}
                disabled
              />
            </FormSection>

            {/* Payment Details */}
            <FormSection title="Payment Details" columns={3}>
              <TextField
                label="Payment Date"
                size="small"
                value={format(new Date(selectedPayment.payment_date), "dd MMM yyyy")}
                disabled
              />
              <TextField
                label="Payment Method"
                size="small"
                value={selectedPayment.payment_method}
                disabled
              />
              <TextField
                label="Payment Amount"
                size="small"
                value={`Rs. ${fmtLKR(selectedPayment.payment_amount)}`}
                disabled
                sx={{
                  "& .MuiInputBase-input": {
                    fontWeight: 700,
                    color: "primary.main",
                  },
                }}
              />
            </FormSection>

            {/* Bank/Reference Details */}
            {(selectedPayment.reference_number || selectedPayment.bank_name) && (
              <FormSection title="Reference Details" columns={2}>
                {selectedPayment.reference_number && (
                  <TextField
                    label="Reference Number"
                    size="small"
                    value={selectedPayment.reference_number}
                    disabled
                  />
                )}
                {selectedPayment.bank_name && (
                  <TextField
                    label="Bank Name"
                    size="small"
                    value={selectedPayment.bank_name}
                    disabled
                  />
                )}
              </FormSection>
            )}

            {/* Status & Dates */}
            <FormSection title="Status & Dates" columns={2}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  Status:
                </Typography>
                <TStatusChip
                  status={selectedPayment.status}
                  statusMap="commissionPaymentStatus"
                />
              </Box>
              <TextField
                label="Created At"
                size="small"
                value={
                  selectedPayment.created_at
                    ? format(new Date(selectedPayment.created_at), "dd MMM yyyy HH:mm")
                    : "N/A"
                }
                disabled
              />
              {selectedPayment.verified_date && (
                <TextField
                  label="Verified At"
                  size="small"
                  value={format(
                    new Date(selectedPayment.verified_date),
                    "dd MMM yyyy HH:mm"
                  )}
                  disabled
                />
              )}
            </FormSection>

            {/* Payment Items */}
            {paymentDetails &&
              (paymentDetails as CustomerAgentCommissionPaymentWithItems)?.items
                ?.length > 0 && (
                <FormSection title="Commission Items" columns={1}>
                  <Paper
                    variant="outlined"
                    sx={{
                      overflow: "hidden",
                      width: "100%",
                      borderRadius: 2,
                      border: "1px solid",
                      borderColor: "divider",
                    }}
                  >
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={modernTableStyles.headerRow}>
                          <TableCell>Invoice</TableCell>
                          <TableCell align="right">Invoice Amount</TableCell>
                          <TableCell align="right">Commission</TableCell>
                          <TableCell align="right">Paid Amount</TableCell>
                          <TableCell>Status</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(
                          paymentDetails as CustomerAgentCommissionPaymentWithItems
                        ).items.map((item, index) => (
                          <TableRow
                            key={item.id || index}
                            sx={{
                              ...modernTableStyles.bodyRow,
                              ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                            }}
                          >
                            <TableCell>
                              {item.invoice_no ||
                                `Commission #${item.commission_id}`}
                            </TableCell>
                            <TableCell align="right">
                              Rs. {fmtLKR(item.invoice_amount || 0)}
                            </TableCell>
                            <TableCell align="right">
                              Rs. {fmtLKR(item.commission_amount || 0)}
                            </TableCell>
                            <TableCell align="right">
                              <strong>Rs. {fmtLKR(item.paid_amount || 0)}</strong>
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
                        <TableRow sx={modernTableStyles.footerRow}>
                          <TableCell colSpan={3} align="right">
                            <strong>Total:</strong>
                          </TableCell>
                          <TableCell align="right">
                            <strong>
                              Rs. {fmtLKR(selectedPayment.payment_amount)}
                            </strong>
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      </TableBody>
                    </Table>
                  </Paper>
                </FormSection>
              )}

            {/* Remarks */}
            {selectedPayment.remarks && (
              <FormSection title="Remarks" columns={1}>
                <TextField
                  multiline
                  rows={2}
                  fullWidth
                  value={selectedPayment.remarks}
                  disabled
                  size="small"
                />
              </FormSection>
            )}
          </>
        )}
      </Box>
    </Box>
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <MasterDetailLayout
        title="Commission Payment Approvals"
        icon={<FactCheckIcon color="primary" />}
        onRefresh={refetch}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />
      <TConfirmDialog {...verifyDialog.dialogProps} />
      <TConfirmDialog {...cancelDialog.dialogProps} />
    </>
  );
}
