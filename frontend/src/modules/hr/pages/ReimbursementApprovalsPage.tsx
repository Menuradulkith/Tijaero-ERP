/**
 * ReimbursementApprovalsPage - Reimbursement Approval Workflow (Gap F1)
 *
 * Shows submitted reimbursements pending approval/verification/payment.
 * Browse table + full-page detail (DetailPanelHeader + ActionToolbar) with
 * approve/reject/verify/pay actions.
 */

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import VerifiedIcon from "@mui/icons-material/Verified";
import PaymentIcon from "@mui/icons-material/Payment";
import ReceiptIcon from "@mui/icons-material/Receipt";
import SearchIcon from "@mui/icons-material/Search";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import {
  Alert,
  Box,
  Button,
  IconButton,
  InputAdornment,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDateTimeReadable } from "@/utils/formatters";

import {
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  fmtLKR,
  FormSection,
  getStatusProps,
  handleApiError,
  MasterDetailLayout,
  modernTableStyles,
  REIMBURSEMENT_PAYMENT_METHODS,
  REIMBURSEMENT_TYPES,
  REIMBURSEMENT_STATUS_FILTER_OPTIONS,
  TDataGrid,
  type TDataGridColumn,
  TStatusFilter,
  TBranchFilter,
  TSidePanel,
  TStatusChip,
  showErrorToast,
  showSuccessToast,
  TConfirmDialog,
  TDetailSkeleton,
  useConfirmDialog,
} from "@/components/tijaero";

import { useReferenceData } from "@/hooks";
import { reimbursementsApi } from "@/modules/hr/api";
import type { Reimbursement } from "@/modules/hr/types";
import { useCurrencyStore } from "@/state/currencyStore";

// ─── Component ───────────────────────────────────────────────────────────────

export default function ReimbursementApprovalsPage() {
  const queryClient = useQueryClient();
  const currencySymbol = useCurrencyStore((s) => s.symbol);

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("pending");
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [selectedReimbursement, setSelectedReimbursement] = useState<Reimbursement | null>(null);

  // Side panels / confirmations
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [paymentReference, setPaymentReference] = useState("");
  const approveDialog = useConfirmDialog();
  const verifyDialog = useConfirmDialog();

  // Ref data
  const { filteredBranches, defaultBranchCode } = useReferenceData(["branches"]);
  const branches = filteredBranches || [];

  // Auto-default branch filter for non-superuser users
  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterStatus("");
    setFilterBranch(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const { data: reimbursements = [], isLoading, refetch } = useQuery({
    queryKey: ["reimbursement-approvals", filterStatus, filterBranch],
    queryFn: () =>
      reimbursementsApi.getAll({
        status: filterStatus || undefined,
        branch_code: filterBranch ?? undefined,
        limit: 500,
      }),
    enabled: branchResolved,
    placeholderData: (prev) => prev,
  });

  // Fetch selected detail
  const { data: reimbursementDetail, isLoading: isDetailLoading } = useQuery({
    queryKey: ["reimbursement-approval-detail", selectedReimbursement?.id],
    queryFn: () =>
      selectedReimbursement
        ? reimbursementsApi.getById(selectedReimbursement.id)
        : Promise.resolve(null),
    enabled: !!selectedReimbursement,
  });

  // ─── Filter & Sort ─────────────────────────────────────────────────────────

  const filteredReimbursements = useMemo(() => {
    let filtered = [...reimbursements];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.reimbursement_no?.toLowerCase().includes(q) ||
          r.employee_name?.toLowerCase().includes(q) ||
          r.description?.toLowerCase().includes(q)
      );
    }
    filtered.sort((a, b) => new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime() || (b.id || 0) - (a.id || 0));
    return filtered;
  }, [reimbursements, searchQuery]);

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["reimbursement-approvals"] });
    queryClient.invalidateQueries({ queryKey: ["reimbursement-approval-detail"] });
    queryClient.invalidateQueries({ queryKey: ["reimbursements"] });
  };

  const approveMutation = useMutation({
    mutationFn: (id: number) =>
      reimbursementsApi.approve(id, { approved_amount: selectedReimbursement?.total_amount }),
    onSuccess: (data) => {
      invalidate();
      showSuccessToast(`Reimbursement ${data.reimbursement_no} approved`);
      setSelectedReimbursement(data);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to approve reimbursement")),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      reimbursementsApi.reject(id, { rejection_reason: reason }),
    onSuccess: (data) => {
      invalidate();
      showSuccessToast(`Reimbursement ${data.reimbursement_no} rejected`);
      setRejectDialogOpen(false);
      setRejectReason("");
      setSelectedReimbursement(data);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to reject reimbursement")),
  });

  const verifyMutation = useMutation({
    mutationFn: (id: number) => reimbursementsApi.verify(id, {}),
    onSuccess: (data) => {
      invalidate();
      showSuccessToast(`Reimbursement ${data.reimbursement_no} verified`);
      setSelectedReimbursement(data);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to verify reimbursement")),
  });

  const paymentMutation = useMutation({
    mutationFn: ({ id, payment }: { id: number; payment: { payment_method: string; payment_reference: string; paid_amount: number } }) =>
      reimbursementsApi.processPayment(id, payment),
    onSuccess: (data) => {
      invalidate();
      showSuccessToast(`Reimbursement ${data.reimbursement_no} payment processed`);
      setPaymentDialogOpen(false);
      setPaymentMethod("bank_transfer");
      setPaymentReference("");
      setSelectedReimbursement(data);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to process payment")),
  });

  const anyMutationPending =
    approveMutation.isPending ||
    rejectMutation.isPending ||
    verifyMutation.isPending ||
    paymentMutation.isPending;

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleApprove = useCallback(() => {
    if (!selectedReimbursement || approveMutation.isPending) return;
    approveDialog.open(
      "Approve Reimbursement",
      `Approve reimbursement ${selectedReimbursement.reimbursement_no} for ${currencySymbol} ${fmtLKR(selectedReimbursement.total_amount)}?`,
      () => approveMutation.mutate(selectedReimbursement.id)
    );
  }, [selectedReimbursement, approveDialog, approveMutation, currencySymbol]);

  const handleVerify = useCallback(() => {
    if (!selectedReimbursement || verifyMutation.isPending) return;
    verifyDialog.open(
      "Verify Reimbursement",
      `Verify reimbursement ${selectedReimbursement.reimbursement_no}? This confirms the claim is valid for payment.`,
      () => verifyMutation.mutate(selectedReimbursement.id)
    );
  }, [selectedReimbursement, verifyDialog, verifyMutation]);

  const handleReject = useCallback(() => {
    if (!selectedReimbursement || rejectMutation.isPending || !rejectReason.trim()) return;
    rejectMutation.mutate({ id: selectedReimbursement.id, reason: rejectReason });
  }, [selectedReimbursement, rejectReason, rejectMutation]);

  const handleProcessPayment = useCallback(() => {
    if (!selectedReimbursement || paymentMutation.isPending) return;
    const paidAmount = selectedReimbursement.approved_amount || selectedReimbursement.total_amount;
    paymentMutation.mutate({
      id: selectedReimbursement.id,
      payment: {
        payment_method: paymentMethod,
        payment_reference: paymentReference,
        paid_amount: paidAmount,
      },
    });
  }, [selectedReimbursement, paymentMethod, paymentReference, paymentMutation]);

  const getTypeLabel = (val: string) =>
    REIMBURSEMENT_TYPES.find((t) => t.value === val)?.label || val;

  // ─── Browse Table ──────────────────────────────────────────────────────────

  const columns: TDataGridColumn<Reimbursement>[] = useMemo(
    () => [
      { field: "reimbursement_no", header: "Reimbursement No", width: 180 },
      { field: "employee_name", header: "Employee", flex: 1, minWidth: 180, renderCell: (p: GridRenderCellParams<Reimbursement>) => p.row.employee_name || p.row.employee_id },
      { field: "claim_date", header: "Claim Date", width: 130, renderCell: (p: GridRenderCellParams<Reimbursement>) => (p.row.claim_date ? format(new Date(p.row.claim_date), "MMM dd, yyyy") : "—") },
      { field: "total_amount", header: "Amount", width: 150, align: "right", headerAlign: "right", renderCell: (p: GridRenderCellParams<Reimbursement>) => `${currencySymbol} ${fmtLKR(p.row.total_amount)}` },
      { field: "status", header: "Status", width: 160, renderCell: (p: GridRenderCellParams<Reimbursement>) => <TStatusChip status={p.row.status} statusMap="reimbursementStatus" size="small" /> },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (p: GridRenderCellParams<Reimbursement>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedReimbursement(p.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [currencySymbol]
  );

  const tablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<Reimbursement>
          rows={filteredReimbursements}
          columns={columns}
          loading={isLoading}
          onRowClick={(row) => setSelectedReimbursement(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No reimbursements match your filters"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // ─── Detail Page ───────────────────────────────────────────────────────────

  const detail = reimbursementDetail || selectedReimbursement;

  const renderDetailBody = (d: Reimbursement) => (
    <>
      <FormSection title="Claim Details">
        <Box>
          <Typography variant="caption" color="text.secondary">Employee</Typography>
          <Typography>{d.employee_name || d.employee_id}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Branch</Typography>
          <Typography>{d.branch_code}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Claim Date</Typography>
          <Typography>{d.claim_date ? format(new Date(d.claim_date), "dd MMM yyyy") : "-"}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Type</Typography>
          <Typography>{getTypeLabel(d.reimbursement_type)}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Total Amount</Typography>
          <Typography fontWeight="bold">{currencySymbol} {fmtLKR(d.total_amount)}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Approved Amount</Typography>
          <Typography fontWeight="bold">{d.approved_amount ? `${currencySymbol} ${fmtLKR(d.approved_amount)}` : "-"}</Typography>
        </Box>
        <Box sx={{ gridColumn: "1 / -1" }}>
          <Typography variant="caption" color="text.secondary">Description</Typography>
          <Typography>{d.description || "-"}</Typography>
        </Box>
      </FormSection>

      {d.items && d.items.length > 0 && (
        <FormSection title="Expense Items" columns={1}>
          <Table size="small" sx={modernTableStyles.container}>
            <TableHead>
              <TableRow sx={modernTableStyles.headerRow}>
                <TableCell>Type</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Receipt #</TableCell>
                <TableCell align="right">Amount</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {d.items.map((item, idx) => (
                <TableRow key={idx} sx={modernTableStyles.bodyRow}>
                  <TableCell>{item.expense_type}</TableCell>
                  <TableCell>{item.item_description || "-"}</TableCell>
                  <TableCell>{item.receipt_number || "-"}</TableCell>
                  <TableCell align="right">{currencySymbol} {fmtLKR(item.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </FormSection>
      )}

      {d.status === "completed" && (
        <FormSection title="Payment Details">
          <Box>
            <Typography variant="caption" color="text.secondary">Payment Method</Typography>
            <Typography>{d.payment_method || "-"}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Payment Reference</Typography>
            <Typography>{d.payment_reference || "-"}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Paid Amount</Typography>
            <Typography fontWeight="bold">{d.paid_amount ? `${currencySymbol} ${fmtLKR(d.paid_amount)}` : "-"}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Payment Date</Typography>
            <Typography>{d.payment_date ? format(new Date(d.payment_date), "dd MMM yyyy") : "-"}</Typography>
          </Box>
        </FormSection>
      )}

      {d.rejection_reason && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          <Typography variant="subtitle2">Rejection Reason</Typography>
          <Typography variant="body2">{d.rejection_reason}</Typography>
        </Alert>
      )}

      {/* Activity History */}
      <FormSection title="Activity History" columns={2} isLast>
        <Box>
          <Typography variant="caption" color="text.secondary">Created</Typography>
          <Typography variant="body2">{formatDateTimeReadable(d.created_at) || "-"}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Last Modified</Typography>
          <Typography variant="body2">{formatDateTimeReadable(d.updated_at) || "-"}</Typography>
        </Box>
      </FormSection>
    </>
  );

  const renderDetailPanel = () => {
    if (!detail) {
      return <EmptyState message="Select a reimbursement from the list to view details" />;
    }
    const statusProps = getStatusProps(detail.status, "reimbursementStatus");
    const showActions = ["pending", "approved", "verified"].includes(detail.status);

    return (
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <DetailPanelHeader
          breadcrumbs={[
            { label: "HR" },
            { label: "Reimbursement Approvals", href: "/hr/approvals/reimbursement-approvals" },
            { label: detail.reimbursement_no },
          ]}
          title={detail.reimbursement_no}
          titleIcon={<ReceiptIcon color="primary" />}
          subtitle={`${detail.employee_name || detail.employee_id} • ${detail.branch_code}`}
          chips={[{ label: statusProps.label, color: statusProps.color }]}
        />

        <ActionToolbar
          hasSelectedItem
          isCreating={false}
          isEditing={false}
          isSaving={anyMutationPending}
          canCreate={false}
          canUpdate={false}
          canDelete={false}
          canDuplicate={false}
          endActions={
            showActions ? (
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                {detail.status === "pending" && (
                  <>
                    <Button
                      size="small"
                      variant="contained"
                      color="success"
                      startIcon={<CheckCircleIcon />}
                      onClick={handleApprove}
                      disabled={anyMutationPending}
                    >
                      Approve
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      startIcon={<CancelIcon />}
                      onClick={() => setRejectDialogOpen(true)}
                      disabled={anyMutationPending}
                    >
                      Reject
                    </Button>
                  </>
                )}
                {detail.status === "approved" && (
                  <Button
                    size="small"
                    variant="contained"
                    color="info"
                    startIcon={<VerifiedIcon />}
                    onClick={handleVerify}
                    disabled={anyMutationPending}
                  >
                    Verify
                  </Button>
                )}
                {detail.status === "verified" && (
                  <Button
                    size="small"
                    variant="contained"
                    color="primary"
                    startIcon={<PaymentIcon />}
                    onClick={() => setPaymentDialogOpen(true)}
                    disabled={anyMutationPending}
                  >
                    Process Payment
                  </Button>
                )}
              </Box>
            ) : undefined
          }
        />

        <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
          {isDetailLoading && selectedReimbursement ? (
            <TDetailSkeleton sections={3} fieldsPerSection={4} showTable />
          ) : (
            renderDetailBody(detail)
          )}
        </Box>
      </Box>
    );
  };

  return (
    <>
      <MasterDetailLayout
        title="Reimbursement Approvals"
        icon={<ReceiptIcon />}
        titleSlot={
          selectedReimbursement ? (
            <Button size="small" startIcon={<ArrowBackIcon fontSize="small" />} onClick={() => setSelectedReimbursement(null)} sx={{ textTransform: "none" }}>
              Back to Reimbursement Approvals
            </Button>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search by no, employee..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                }}
                sx={{ width: 190, flexShrink: 0, "& .MuiOutlinedInput-root": { borderRadius: "24px" } }}
              />
              <Box sx={{ width: 170, flexShrink: 0 }}>
                <TBranchFilter
                  branches={branches}
                  value={filterBranch}
                  onChange={setFilterBranch}
                  label=""
                  placeholder="All Branches"
                  size="small"
                />
              </Box>
              <Box sx={{ width: 180, flexShrink: 0 }}>
                <TStatusFilter
                  options={REIMBURSEMENT_STATUS_FILTER_OPTIONS}
                  value={filterStatus || null}
                  onChange={(v) => setFilterStatus(v ?? "")}
                  label=""
                  placeholder="All Statuses"
                  size="small"
                />
              </Box>
              {(searchQuery || filterStatus || filterBranch) && (
                <Button size="small" onClick={handleClearFilters} sx={{ textTransform: "none" }}>
                  Clear
                </Button>
              )}
            </Box>
          )
        }
        isLoading={isLoading}
        onRefresh={() => refetch?.()}
      >
        {selectedReimbursement ? renderDetailPanel() : tablePanel}
      </MasterDetailLayout>

      {/* Reject Panel */}
      <TSidePanel
        open={rejectDialogOpen}
        onClose={() => setRejectDialogOpen(false)}
        title="Reject Reimbursement"
        submitText="Reject"
        onSubmit={handleReject}
        isSubmitting={rejectMutation.isPending}
        submitDisabled={!rejectReason.trim() || rejectMutation.isPending}
      >
        <FormSection title="Rejection" columns={1} isLast>
          <TextField
            fullWidth
            size="small"
            label="Rejection Reason"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            multiline
            rows={3}
            required
          />
        </FormSection>
      </TSidePanel>

      {/* Payment Panel */}
      <TSidePanel
        open={paymentDialogOpen}
        onClose={() => setPaymentDialogOpen(false)}
        title="Process Payment"
        submitText="Process Payment"
        onSubmit={handleProcessPayment}
        isSubmitting={paymentMutation.isPending}
        submitDisabled={paymentMutation.isPending}
      >
        <FormSection title="Payment Details" columns={1} isLast>
          <Typography variant="body2" color="text.secondary">
            Processing payment for {selectedReimbursement?.reimbursement_no}
          </Typography>
          <Typography variant="h6">
            Amount: {currencySymbol} {selectedReimbursement && fmtLKR(selectedReimbursement.approved_amount || selectedReimbursement.total_amount)}
          </Typography>
          <TextField
            select
            fullWidth
            size="small"
            label="Payment Method"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
          >
            {REIMBURSEMENT_PAYMENT_METHODS.map((m) => (
              <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            fullWidth
            size="small"
            label="Payment Reference"
            value={paymentReference}
            onChange={(e) => setPaymentReference(e.target.value)}
            placeholder="e.g., Bank transfer reference number"
          />
        </FormSection>
      </TSidePanel>

      <TConfirmDialog {...approveDialog.dialogProps} />
      <TConfirmDialog {...verifyDialog.dialogProps} />
    </>
  );
}
