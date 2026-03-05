/**
 * ReimbursementApprovalsPage - Reimbursement Approval Workflow (Gap F1)
 *
 * Shows submitted reimbursements pending approval/verification/payment.
 * Follows MasterDetail pattern with approve/reject/verify/pay actions.
 */

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import VerifiedIcon from "@mui/icons-material/Verified";
import PaymentIcon from "@mui/icons-material/Payment";
import ReceiptIcon from "@mui/icons-material/Receipt";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
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
  SearchableList,
  SelectableListItem,
  type SortOption,
  TBranchFilter,
  TFilterPanel,
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

// ─── Configuration ───────────────────────────────────────────────────────────

const SORT_OPTIONS: SortOption[] = [
  { value: "claim_date", label: "Claim Date" },
  { value: "total_amount", label: "Amount" },
  { value: "reimbursement_no", label: "Reimbursement No" },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function ReimbursementApprovalsPage() {
  const queryClient = useQueryClient();

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("claim_date");
  const [filterStatus, setFilterStatus] = useState<string>("pending");
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [selectedReimbursement, setSelectedReimbursement] = useState<Reimbursement | null>(null);

  // Dialogs
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [paymentReference, setPaymentReference] = useState("");
  const approveDialog = useConfirmDialog();
  const verifyDialog = useConfirmDialog();

  // Ref data
  const { filteredBranches } = useReferenceData(["branches"]);
  const branches = filteredBranches || [];

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const { data: reimbursements = [], isLoading } = useQuery({
    queryKey: ["reimbursement-approvals", filterStatus, filterBranch],
    queryFn: () =>
      reimbursementsApi.getAll({
        status: filterStatus || undefined,
        branch_code: filterBranch ?? undefined,
        limit: 500,
      }),
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
    filtered.sort((a, b) => {
      if (sortField === "total_amount")
        return Number(b.total_amount) - Number(a.total_amount);
      if (sortField === "reimbursement_no")
        return (b.reimbursement_no || "").localeCompare(a.reimbursement_no || "");
      return (
        new Date(b.claim_date || "").getTime() -
        new Date(a.claim_date || "").getTime()
      );
    });
    return filtered;
  }, [reimbursements, searchQuery, sortField]);

  useEffect(() => {
    if (filteredReimbursements.length > 0 && !selectedReimbursement) {
      setSelectedReimbursement(filteredReimbursements[0]);
    }
  }, [filteredReimbursements, selectedReimbursement]);

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

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleApprove = useCallback(() => {
    if (!selectedReimbursement) return;
    approveDialog.open(
      "Approve Reimbursement",
      `Approve reimbursement ${selectedReimbursement.reimbursement_no} for Rs. ${fmtLKR(selectedReimbursement.total_amount)}?`,
      () => approveMutation.mutate(selectedReimbursement.id)
    );
  }, [selectedReimbursement, approveDialog, approveMutation]);

  const handleVerify = useCallback(() => {
    if (!selectedReimbursement) return;
    verifyDialog.open(
      "Verify Reimbursement",
      `Verify reimbursement ${selectedReimbursement.reimbursement_no}? This confirms the claim is valid for payment.`,
      () => verifyMutation.mutate(selectedReimbursement.id)
    );
  }, [selectedReimbursement, verifyDialog, verifyMutation]);

  const handleProcessPayment = useCallback(() => {
    if (!selectedReimbursement) return;
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

  // ─── Master Panel ──────────────────────────────────────────────────────────

  const masterPanel = (
    <Box>
      <TFilterPanel>
        <TBranchFilter
          branches={branches}
          value={filterBranch}
          onChange={setFilterBranch}
        />
        <TextField
          select
          size="small"
          label="Status"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          sx={{ minWidth: 150 }}
        >
          {REIMBURSEMENT_STATUS_FILTER_OPTIONS.map((opt) => (
            <MenuItem key={opt.value} value={opt.value || ""}>
              {opt.label}
            </MenuItem>
          ))}
        </TextField>
      </TFilterPanel>

      <SearchableList
        items={filteredReimbursements}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        placeholder="Search reimbursements..."
        sortOptions={SORT_OPTIONS}
        sortField={sortField}
        onSortChange={setSortField}
        isLoading={isLoading}
        renderItem={(r: Reimbursement, isSelected: boolean) => (
          <SelectableListItem
            key={r.id}
            id={r.id}
            isSelected={isSelected}
            onClick={() => setSelectedReimbursement(r)}
            primaryText={r.reimbursement_no}
            secondaryText={
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Typography variant="caption" color="text.secondary">
                  {r.employee_name || r.employee_id}
                </Typography>
                <Typography variant="caption" fontWeight={600}>
                  Rs. {fmtLKR(r.total_amount)}
                </Typography>
              </Box>
            }
            statusChip={{
              ...getStatusProps(r.status, "reimbursementStatus"),
              size: "small" as const,
            }}
          />
        )}
      >
        {!isLoading && filteredReimbursements.length === 0 && (
          <EmptyState message="No reimbursements match your filters" />
        )}
      </SearchableList>
    </Box>
  );

  // ─── Detail Panel ──────────────────────────────────────────────────────────

  const detail = reimbursementDetail || selectedReimbursement;

  const detailPanel = isDetailLoading && selectedReimbursement ? (
    <TDetailSkeleton sections={3} fieldsPerSection={4} showTable />
  ) : detail ? (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight="bold">{detail.reimbursement_no}</Typography>
          <Typography variant="body2" color="text.secondary">
            {detail.employee_name || detail.employee_id} • {detail.branch_code}
          </Typography>
        </Box>
        <TStatusChip status={detail.status} statusMap="reimbursementStatus" />
      </Box>

      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 3 }}>
        {detail.status === "pending" && (
          <>
            <Button
              variant="contained"
              color="success"
              startIcon={<CheckCircleIcon />}
              onClick={handleApprove}
              disabled={approveMutation.isPending}
            >
              Approve
            </Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={<CancelIcon />}
              onClick={() => setRejectDialogOpen(true)}
              disabled={rejectMutation.isPending}
            >
              Reject
            </Button>
          </>
        )}
        {detail.status === "approved" && (
          <Button
            variant="contained"
            color="info"
            startIcon={<VerifiedIcon />}
            onClick={handleVerify}
            disabled={verifyMutation.isPending}
          >
            Verify
          </Button>
        )}
        {detail.status === "verified" && (
          <Button
            variant="contained"
            color="primary"
            startIcon={<PaymentIcon />}
            onClick={() => setPaymentDialogOpen(true)}
            disabled={paymentMutation.isPending}
          >
            Process Payment
          </Button>
        )}
      </Box>

      <FormSection title="Claim Details">
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
          <Box>
            <Typography variant="caption" color="text.secondary">Claim Date</Typography>
            <Typography>{detail.claim_date ? format(new Date(detail.claim_date), "dd MMM yyyy") : "-"}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Type</Typography>
            <Typography>{getTypeLabel(detail.reimbursement_type)}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Total Amount</Typography>
            <Typography fontWeight="bold">Rs. {fmtLKR(detail.total_amount)}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Approved Amount</Typography>
            <Typography fontWeight="bold">{detail.approved_amount ? `Rs. ${fmtLKR(detail.approved_amount)}` : "-"}</Typography>
          </Box>
          <Box sx={{ gridColumn: "1 / -1" }}>
            <Typography variant="caption" color="text.secondary">Description</Typography>
            <Typography>{detail.description || "-"}</Typography>
          </Box>
        </Box>
      </FormSection>

      {detail.items && detail.items.length > 0 && (
        <FormSection title="Expense Items">
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
              {detail.items.map((item, idx) => (
                <TableRow key={idx} sx={modernTableStyles.bodyRow}>
                  <TableCell>{item.expense_type}</TableCell>
                  <TableCell>{item.item_description || "-"}</TableCell>
                  <TableCell>{item.receipt_number || "-"}</TableCell>
                  <TableCell align="right">Rs. {fmtLKR(item.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </FormSection>
      )}

      {detail.status === "completed" && (
        <FormSection title="Payment Details">
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">Payment Method</Typography>
              <Typography>{detail.payment_method || "-"}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Payment Reference</Typography>
              <Typography>{detail.payment_reference || "-"}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Paid Amount</Typography>
              <Typography fontWeight="bold">{detail.paid_amount ? `Rs. ${fmtLKR(detail.paid_amount)}` : "-"}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Payment Date</Typography>
              <Typography>{detail.payment_date ? format(new Date(detail.payment_date), "dd MMM yyyy") : "-"}</Typography>
            </Box>
          </Box>
        </FormSection>
      )}

      {detail.rejection_reason && (
        <Alert severity="error" sx={{ mt: 2 }}>
          <Typography variant="subtitle2">Rejection Reason</Typography>
          <Typography variant="body2">{detail.rejection_reason}</Typography>
        </Alert>
      )}
    </Box>
  ) : (
    <EmptyState message="Select a reimbursement from the list to view details" />
  );

  return (
    <>
      <MasterDetailLayout
        title="Reimbursement Approvals"
        icon={<ReceiptIcon />}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onClose={() => setRejectDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Reject Reimbursement</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Rejection Reason"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            multiline
            rows={3}
            sx={{ mt: 2 }}
            required
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => selectedReimbursement && rejectMutation.mutate({ id: selectedReimbursement.id, reason: rejectReason })}
            disabled={!rejectReason.trim() || rejectMutation.isPending}
          >
            Reject
          </Button>
        </DialogActions>
      </Dialog>

      {/* Payment Dialog */}
      <Dialog open={paymentDialogOpen} onClose={() => setPaymentDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Process Payment</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Processing payment for {selectedReimbursement?.reimbursement_no}
            </Typography>
            <Typography variant="h6">
              Amount: Rs. {selectedReimbursement && fmtLKR(selectedReimbursement.approved_amount || selectedReimbursement.total_amount)}
            </Typography>
            <TextField
              select
              fullWidth
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
              label="Payment Reference"
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              placeholder="e.g., Bank transfer reference number"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPaymentDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="primary"
            onClick={handleProcessPayment}
            disabled={paymentMutation.isPending}
          >
            Process Payment
          </Button>
        </DialogActions>
      </Dialog>

      <TConfirmDialog {...approveDialog.dialogProps} />
      <TConfirmDialog {...verifyDialog.dialogProps} />
    </>
  );
}
