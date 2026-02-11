/**
 * ExpenseApprovalsPage - Expense Approval Workflow
 *
 * Shows submitted expenses pending approval.
 * Follows MasterDetail pattern with approve/reject actions.
 */

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  DetailPanelHeader,
  EmptyState,
  EXPENSE_CATEGORIES,
  EXPENSE_TYPES,
  EXPENSES_METHOD,
  fmtLKR,
  FormSection,
  getStatusProps,
  handleApiError,
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  showErrorToast,
  showSuccessToast,
  type SortOption,
  TBranchFilter,
  TConfirmDialog,
  TFilterPanel,
  TStatusChip,
  useTConfirmDialog,
} from "@/components/tijaero";

import { useReferenceData } from "@/hooks";
import { expensesApi } from "@/modules/finance/api";
import type { Expense } from "@/modules/finance/types";

// ─── Configuration ───────────────────────────────────────────────────────────

const STATUS_FILTER_OPTIONS = [
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const SORT_OPTIONS: SortOption[] = [
  { value: "created_date", label: "Date Created" },
  { value: "expense_amount", label: "Amount" },
  { value: "expenses_no", label: "Expense No" },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function ExpenseApprovalsPage() {
  const queryClient = useQueryClient();

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("created_date");
  const [filterStatus, setFilterStatus] = useState<string>("submitted");
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);

  // Dialogs
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const approveDialog = useTConfirmDialog();

  // Ref data
  const { data: refData } = useReferenceData(["branches"]);
  const branches = refData?.branches || [];

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const { data: expensesData, isLoading } = useQuery({
    queryKey: ["expense-approvals", filterStatus, filterBranch],
    queryFn: () =>
      expensesApi.getAll({
        status: filterStatus || undefined,
        branch_code: filterBranch ?? undefined,
        limit: 500,
      }),
  });

  const expenses = expensesData?.items || [];

  // Fetch selected expense detail
  const { data: expenseDetail } = useQuery({
    queryKey: ["expense-approval-detail", selectedExpense?.id],
    queryFn: () =>
      selectedExpense
        ? expensesApi.getById(selectedExpense.id)
        : Promise.resolve(null),
    enabled: !!selectedExpense,
  });

  // ─── Filter & Sort ─────────────────────────────────────────────────────────

  const filteredExpenses = useMemo(() => {
    let filtered = [...expenses];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.expenses_no?.toLowerCase().includes(q) ||
          e.vendor_name?.toLowerCase().includes(q) ||
          e.description?.toLowerCase().includes(q)
      );
    }
    filtered.sort((a, b) => {
      if (sortField === "expense_amount")
        return Number(b.expense_amount) - Number(a.expense_amount);
      if (sortField === "expenses_no")
        return (b.expenses_no || "").localeCompare(a.expenses_no || "");
      return (
        new Date(b.created_date || "").getTime() -
        new Date(a.created_date || "").getTime()
      );
    });
    return filtered;
  }, [expenses, searchQuery, sortField]);

  useEffect(() => {
    if (filteredExpenses.length > 0 && !selectedExpense) {
      setSelectedExpense(filteredExpenses[0]);
    }
  }, [filteredExpenses, selectedExpense]);

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["expense-approvals"] });
    queryClient.invalidateQueries({ queryKey: ["expense-approval-detail"] });
    queryClient.invalidateQueries({ queryKey: ["expenses"] });
  };

  const approveMutation = useMutation({
    mutationFn: (id: number) => expensesApi.approve(id),
    onSuccess: (data) => {
      invalidate();
      showSuccessToast(`Expense ${data.expenses_no} approved`);
      setSelectedExpense(data);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to approve expense")),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      expensesApi.reject(id, reason),
    onSuccess: (data) => {
      invalidate();
      showSuccessToast(`Expense ${data.expenses_no} rejected`);
      setRejectDialogOpen(false);
      setRejectReason("");
      setSelectedExpense(data);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to reject expense")),
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleApprove = useCallback(() => {
    if (!selectedExpense) return;
    approveDialog.open(
      "Approve Expense",
      `Approve expense ${selectedExpense.expenses_no} for Rs. ${fmtLKR(selectedExpense.expense_amount)}?`,
      () => approveMutation.mutate(selectedExpense.id)
    );
  }, [selectedExpense, approveDialog, approveMutation]);

  const getCategoryLabel = (val: string) =>
    EXPENSE_CATEGORIES.find((c) => c.value === val)?.label || val;
  const getMethodLabel = (val: string) =>
    EXPENSES_METHOD.find((m) => m.value === val)?.label || val;

  // ─── Master Panel ──────────────────────────────────────────────────────────

  const masterPanel = (
    <SearchableList
      items={filteredExpenses}
      isLoading={isLoading}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search expenses..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      listHeader={
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, p: 1 }}>
          <TFilterPanel>
            <TBranchFilter
              branches={branches}
              value={filterBranch}
              onChange={setFilterBranch}
            />
          </TFilterPanel>
          <TextField
            select
            size="small"
            label="Status"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            fullWidth
          >
            {STATUS_FILTER_OPTIONS.map((s) => (
              <MenuItem key={s.value} value={s.value}>
                {s.label}
              </MenuItem>
            ))}
          </TextField>
        </Box>
      }
      renderItem={(expense: Expense, isSelected: boolean) => {
        const { color } = getStatusProps(expense.status, "expenseStatus");
        return (
          <SelectableListItem
            key={expense.id}
            id={expense.id}
            isSelected={isSelected}
            onClick={() => setSelectedExpense(expense)}
            primaryText={
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                <span>{expense.expenses_no}</span>
                <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                  <Typography variant="caption" fontWeight={600}>
                    Rs. {fmtLKR(expense.expense_amount)}
                  </Typography>
                  <Chip
                    label={expense.status}
                    size="small"
                    color={color}
                    variant="outlined"
                  />
                </Box>
              </Box>
            }
            secondaryText={
              !isSelected
                ? `${getCategoryLabel(expense.expense_category)} - ${expense.vendor_name || "No vendor"}`
                : undefined
            }
          />
        );
      }}
    />
  );

  // ─── Detail Panel ──────────────────────────────────────────────────────────

  const detail = expenseDetail || selectedExpense;

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
          { label: "Expense Approvals", href: "/finance/approvals/expense-approvals" },
          ...(detail ? [{ label: detail.expenses_no }] : []),
        ]}
        title={detail ? detail.expenses_no : ""}
        titleIcon={<ReceiptLongIcon color="primary" />}
        noSelectionTitle="Select an Expense"
        chips={
          detail
            ? [
                {
                  label:
                    detail.status.charAt(0).toUpperCase() +
                    detail.status.slice(1),
                  color: getStatusProps(detail.status, "expenseStatus").color,
                },
              ]
            : []
        }
      />

      {/* Action Bar */}
      {detail && detail.status === "submitted" && (
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
          <Button
            variant="contained"
            size="small"
            color="success"
            startIcon={<CheckCircleIcon />}
            onClick={handleApprove}
            disabled={approveMutation.isPending}
          >
            Approve
          </Button>
          <Button
            variant="outlined"
            size="small"
            color="error"
            startIcon={<CancelIcon />}
            onClick={() => setRejectDialogOpen(true)}
          >
            Reject
          </Button>
        </Box>
      )}

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!detail ? (
          <EmptyState message="Select an expense from the list to review" />
        ) : (
          <>
            {/* Rejection Warning */}
            {detail.status === "rejected" && detail.rejection_reason && (
              <Alert severity="error" sx={{ mb: 2 }}>
                <strong>Rejected:</strong> {detail.rejection_reason}
              </Alert>
            )}

            {/* Approved Info */}
            {detail.status === "approved" && (
              <Alert severity="success" sx={{ mb: 2 }}>
                Approved
                {detail.approved_by && ` by ${detail.approved_by}`}
                {detail.approved_date &&
                  ` on ${format(new Date(detail.approved_date), "dd MMM yyyy HH:mm")}`}
              </Alert>
            )}

            {/* Expense Details */}
            <FormSection title="Expense Details" columns={3}>
              <TextField
                label="Expense No"
                size="small"
                value={detail.expenses_no}
                disabled
              />
              <TextField
                label="Category"
                size="small"
                value={getCategoryLabel(detail.expense_category)}
                disabled
              />
              <TextField
                label="Type"
                size="small"
                value={
                  EXPENSE_TYPES.find((t) => t.value === detail.expense_type)
                    ?.label || detail.expense_type
                }
                disabled
              />
              <TextField
                label="Method"
                size="small"
                value={getMethodLabel(detail.expenses_method)}
                disabled
              />
              <TextField
                label="Amount (Rs.)"
                size="small"
                value={fmtLKR(detail.expense_amount)}
                disabled
              />
              <TextField
                label="Expense Date"
                size="small"
                value={
                  detail.expense_date
                    ? format(new Date(detail.expense_date), "dd MMM yyyy")
                    : "N/A"
                }
                disabled
              />
            </FormSection>

            {/* Vendor & Receipt */}
            <FormSection title="Vendor & Receipt" columns={3}>
              <TextField
                label="Vendor"
                size="small"
                value={detail.vendor_name || "N/A"}
                disabled
              />
              <TextField
                label="Receipt No"
                size="small"
                value={detail.receipt_number || "N/A"}
                disabled
              />
              <TextField
                label="Bill Reference"
                size="small"
                value={detail.bill_reference || "N/A"}
                disabled
              />
            </FormSection>

            {/* Description */}
            {detail.description && (
              <FormSection title="Description" columns={1}>
                <TextField
                  label="Description"
                  size="small"
                  value={detail.description}
                  disabled
                  multiline
                  rows={2}
                />
              </FormSection>
            )}

            {/* Branch & Submission Info */}
            <FormSection title="Submission Info" columns={3}>
              <TextField
                label="Branch"
                size="small"
                value={detail.branch_code}
                disabled
              />
              <TextField
                label="Submitted By"
                size="small"
                value={detail.submitted_by || "N/A"}
                disabled
              />
              <TextField
                label="Created"
                size="small"
                value={
                  detail.created_date
                    ? format(new Date(detail.created_date), "dd MMM yyyy")
                    : "N/A"
                }
                disabled
              />
            </FormSection>

            {/* Status */}
            <FormSection title="Status" columns={2}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  py: 1,
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  Status:
                </Typography>
                <TStatusChip
                  status={detail.status}
                  statusMap="expenseStatus"
                />
              </Box>
              {detail.approved_by && (
                <TextField
                  label="Approved By"
                  size="small"
                  value={detail.approved_by}
                  disabled
                />
              )}
            </FormSection>

            {/* Remarks */}
            {detail.remarks && (
              <FormSection title="Remarks" columns={1}>
                <TextField
                  label="Remarks"
                  size="small"
                  value={detail.remarks}
                  disabled
                  multiline
                  rows={3}
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
        title="Expense Approvals"
        icon={<ReceiptLongIcon color="primary" />}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />

      {/* Reject Dialog */}
      <Dialog
        open={rejectDialogOpen}
        onClose={() => setRejectDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Reject Expense</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {detail &&
              `Rejecting expense ${detail.expenses_no} for Rs. ${fmtLKR(detail.expense_amount)}`}
          </Typography>
          <TextField
            label="Rejection Reason"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            multiline
            rows={3}
            fullWidth
            required
            placeholder="Please provide a reason for rejection"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            disabled={!rejectReason.trim() || rejectMutation.isPending}
            onClick={() =>
              selectedExpense &&
              rejectMutation.mutate({
                id: selectedExpense.id,
                reason: rejectReason,
              })
            }
          >
            {rejectMutation.isPending ? "Rejecting..." : "Reject"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Approve Confirm */}
      <TConfirmDialog {...approveDialog.dialogProps} />
    </>
  );
}
