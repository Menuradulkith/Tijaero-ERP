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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  TDetailSkeleton,
  TFilterPanel,
  TSearchableSelect,
  TStatusChip,
  useCrudMutation,
  useTConfirmDialog,
} from "@/components/tijaero";

import { useReferenceData } from "@/hooks";
import { expensesApi } from "@/modules/finance/api";
import type { Expense } from "@/modules/finance/types";

// ─── Configuration ───────────────────────────────────────────────────────────

const STATUS_FILTER_OPTIONS = [
  { value: "submitted", label: "Submitted", color: "info" as const },
  { value: "approved", label: "Approved", color: "success" as const },
  { value: "rejected", label: "Rejected", color: "error" as const },
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
  const [filterStatus, setFilterStatus] = useState<string | null>("submitted");
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);

  // Dialogs
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const approveDialog = useTConfirmDialog();

  // Ref data
  const { filteredBranches, defaultBranchCode } = useReferenceData(["branches"]);
  const branches = filteredBranches || [];

  // Auto-default branch filter for non-superuser users
  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  // ─── Data Fetching ─────────────────────────────────────────────────────────────────

  const { data: expensesData, isLoading } = useQuery({
    queryKey: ["expense-approvals", filterStatus, filterBranch],
    queryFn: () =>
      expensesApi.getAll({
        status: filterStatus || undefined,
        branch_code: filterBranch ?? undefined,
        limit: 500,
      }),
    enabled: branchResolved,
    placeholderData: (prev) => prev,
  });

  const expenses = expensesData?.items || [];

  // Fetch selected expense detail
  const { data: expenseDetail, isLoading: isDetailLoading } = useQuery({
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
      const timeA = a.created_at ? new Date(a.created_at).getTime() : (a.created_date ? new Date(a.created_date).getTime() : 0);
      const timeB = b.created_at ? new Date(b.created_at).getTime() : (b.created_date ? new Date(b.created_date).getTime() : 0);
      if (timeB !== timeA) return timeB - timeA;
      return b.id - a.id;
    });
    return filtered;
  }, [expenses, searchQuery, sortField]);

  useEffect(() => {
    if (filteredExpenses.length > 0 && !selectedExpense) {
      setSelectedExpense(filteredExpenses[0]);
    }
  }, [filteredExpenses, selectedExpense]);

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const approveMutation = useCrudMutation({
    mutationFn: (id: number) => expensesApi.approve(id),
    invalidateQueryKeys: [["expense-approvals"], ["expense-approval-detail"], ["expenses"]],
    getSuccessMessage: (data) => `Expense ${data.expenses_no} approved`,
    errorMessage: "Failed to approve expense",
    onSuccess: (data) => {
      setSelectedExpense(data);
    },
  });

  const rejectMutation = useCrudMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      expensesApi.reject(id, reason),
    invalidateQueryKeys: [["expense-approvals"], ["expense-approval-detail"], ["expenses"]],
    getSuccessMessage: (data) => `Expense ${data.expenses_no} rejected`,
    errorMessage: "Failed to reject expense",
    onSuccess: (data) => {
      setRejectDialogOpen(false);
      setRejectReason("");
      setSelectedExpense(data);
    },
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
      selectedItem={selectedExpense}
      emptyMessage="No expenses found"
      listHeader={
        <TFilterPanel>
          <TBranchFilter
            branches={branches}
            value={filterBranch}
            onChange={setFilterBranch}
          />
          <TSearchableSelect
            label="Status"
            value={filterStatus}
            onChange={(val) => setFilterStatus(val as string | null)}
            options={STATUS_FILTER_OPTIONS.map((s) => ({
              value: s.value,
              label: s.label,
              color: s.color,
            }))}
            showAllOption
            allOptionLabel="All Statuses"
            placeholder="Search status..."
          />
        </TFilterPanel>
      }
      renderItem={(expense: Expense, isSelected: boolean) => {
        const statusChip = getStatusProps(expense.status, "expenseStatus");
        return (
          <SelectableListItem
            key={expense.id}
            id={expense.id}
            isSelected={isSelected}
            onClick={() => setSelectedExpense(expense)}
            primaryText={
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{expense.expenses_no}</span>
                  {isSelected && (
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Expense No)
                    </Typography>
                  )}
                </Box>
                {isSelected && (
                  <>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {getCategoryLabel(expense.expense_category)}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Category)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {expense.vendor_name || "No vendor"}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Vendor)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        Rs. {fmtLKR(expense.expense_amount)}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Amount)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, mt: 0.5 }}>
                      <TStatusChip
                        status={expense.status}
                        statusMap="expenseStatus"
                        size="small"
                      />
                    </Box>
                  </>
                )}
              </Box>
            }
            secondaryText={
              !isSelected
                ? `${getCategoryLabel(expense.expense_category)} - ${expense.vendor_name || "No vendor"} - Rs. ${fmtLKR(expense.expense_amount)}`
                : undefined
            }
            statusChip={!isSelected ? statusChip : undefined}
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
        ) : isDetailLoading ? (
          <TDetailSkeleton sections={3} fieldsPerSection={4} showHeader={false} showToolbar={false} />
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
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ["expense-approvals"] });
          queryClient.invalidateQueries({ queryKey: ["expense-approval-detail"] });
        }}
        isLoading={isLoading}
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
