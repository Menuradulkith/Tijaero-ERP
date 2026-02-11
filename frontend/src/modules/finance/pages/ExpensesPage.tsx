/**
 * ExpensesPage - Business Expense Recording & Management
 *
 * Full workflow: Create → Submit → Approve → Process Payment → Record
 * Uses MasterDetailLayout with Tijaero components.
 */

import AddIcon from "@mui/icons-material/Add";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import PaymentIcon from "@mui/icons-material/Payment";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import SendIcon from "@mui/icons-material/Send";
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
import { Controller, useForm } from "react-hook-form";

import {
  DetailPanelHeader,
  EmptyState,
  EXPENSE_CATEGORIES,
  EXPENSE_PAYMENT_METHODS,
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
import type { Expense, ExpenseCreate, ExpensePaymentData } from "@/modules/finance/types";

// ─── Configuration ───────────────────────────────────────────────────────────

const STATUS_FILTER_OPTIONS = [
  { value: "pending", label: "Pending", color: "default" as const },
  { value: "submitted", label: "Submitted", color: "info" as const },
  { value: "approved", label: "Approved", color: "success" as const },
  { value: "rejected", label: "Rejected", color: "error" as const },
  { value: "paid", label: "Paid", color: "primary" as const },
  { value: "recorded", label: "Recorded", color: "secondary" as const },
];

const SORT_OPTIONS: SortOption[] = [
  { value: "created_date", label: "Date Created" },
  { value: "expense_amount", label: "Amount" },
  { value: "expenses_no", label: "Expense No" },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function ExpensesPage() {
  const queryClient = useQueryClient();

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("created_date");
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);

  // Dialogs
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [recordDialogOpen, setRecordDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const deleteDialog = useTConfirmDialog();
  const submitDialog = useTConfirmDialog();
  const approveDialog = useTConfirmDialog();

  // Ref data
  const { data: refData } = useReferenceData(["branches"]);
  const branches = refData?.branches || [];

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const { data: expensesData, isLoading } = useQuery({
    queryKey: ["expenses", filterStatus, filterBranch, filterCategory],
    queryFn: () =>
      expensesApi.getAll({
        status: filterStatus ?? undefined,
        branch_code: filterBranch ?? undefined,
        expense_category: filterCategory ?? undefined,
        limit: 500,
      }),
  });

  const expenses = expensesData?.items || [];

  // Fetch selected expense detail
  const { data: expenseDetail } = useQuery({
    queryKey: ["expense-detail", selectedExpense?.id],
    queryFn: () =>
      selectedExpense ? expensesApi.getById(selectedExpense.id) : Promise.resolve(null),
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
          e.description?.toLowerCase().includes(q) ||
          e.receipt_number?.toLowerCase().includes(q)
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
    queryClient.invalidateQueries({ queryKey: ["expenses"] });
    queryClient.invalidateQueries({ queryKey: ["expense-detail"] });
  };

  const createMutation = useMutation({
    mutationFn: expensesApi.create,
    onSuccess: (data) => {
      invalidate();
      showSuccessToast("Expense recorded successfully");
      setCreateDialogOpen(false);
      setSelectedExpense(data);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to create expense")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ExpenseCreate> }) =>
      expensesApi.update(id, data),
    onSuccess: (data) => {
      invalidate();
      showSuccessToast("Expense updated");
      setEditDialogOpen(false);
      setSelectedExpense(data);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to update expense")),
  });

  const submitMutation = useMutation({
    mutationFn: (id: number) => expensesApi.submit(id),
    onSuccess: (data) => {
      invalidate();
      showSuccessToast("Expense submitted for approval");
      setSelectedExpense(data);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to submit expense")),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => expensesApi.approve(id),
    onSuccess: (data) => {
      invalidate();
      showSuccessToast("Expense approved");
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
      showSuccessToast("Expense rejected");
      setRejectDialogOpen(false);
      setRejectReason("");
      setSelectedExpense(data);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to reject expense")),
  });

  const paymentMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: ExpensePaymentData }) =>
      expensesApi.processPayment(id, data),
    onSuccess: (data) => {
      invalidate();
      showSuccessToast("Payment processed");
      setPaymentDialogOpen(false);
      setSelectedExpense(data);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to process payment")),
  });

  const recordMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number;
      data: { account_code: string; cost_center?: string };
    }) => expensesApi.record(id, data),
    onSuccess: (data) => {
      invalidate();
      showSuccessToast("Expense recorded in accounting");
      setRecordDialogOpen(false);
      setSelectedExpense(data);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to record expense")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => expensesApi.delete(id),
    onSuccess: () => {
      invalidate();
      showSuccessToast("Expense deleted");
      setSelectedExpense(null);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to delete expense")),
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleSubmitExpense = useCallback(() => {
    if (!selectedExpense) return;
    submitDialog.open(
      "Submit for Approval",
      `Submit expense ${selectedExpense.expenses_no} (${fmtLKR(selectedExpense.expense_amount)}) for approval?`,
      () => submitMutation.mutate(selectedExpense.id)
    );
  }, [selectedExpense, submitDialog, submitMutation]);

  const handleApprove = useCallback(() => {
    if (!selectedExpense) return;
    approveDialog.open(
      "Approve Expense",
      `Approve expense ${selectedExpense.expenses_no} (${fmtLKR(selectedExpense.expense_amount)})?`,
      () => approveMutation.mutate(selectedExpense.id)
    );
  }, [selectedExpense, approveDialog, approveMutation]);

  const handleDelete = useCallback(() => {
    if (!selectedExpense) return;
    deleteDialog.open(
      "Delete Expense",
      `Delete expense ${selectedExpense.expenses_no}? This cannot be undone.`,
      () => deleteMutation.mutate(selectedExpense.id)
    );
  }, [selectedExpense, deleteDialog, deleteMutation]);

  const getCategoryLabel = (val: string) =>
    EXPENSE_CATEGORIES.find((c) => c.value === val)?.label || val;
  const getMethodLabel = (val: string) =>
    EXPENSES_METHOD.find((m) => m.value === val)?.label || val;

  // ─── Forms ─────────────────────────────────────────────────────────────────

  const createForm = useForm<ExpenseCreate>({
    defaultValues: {
      expense_type: "operational",
      expense_category: "miscellaneous",
      expenses_method: "other_expenses",
      expense_amount: 0,
      branch_code: "",
      vendor_name: "",
      description: "",
      receipt_number: "",
      bill_reference: "",
      remarks: "",
    },
  });

  const editForm = useForm<Partial<ExpenseCreate>>();

  const paymentForm = useForm<ExpensePaymentData>({
    defaultValues: {
      payment_method: "cash",
      payment_reference: "",
      remarks: "",
    },
  });

  const recordForm = useForm<{ account_code: string; cost_center: string }>({
    defaultValues: { account_code: "", cost_center: "" },
  });

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
          <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setCreateDialogOpen(true)}
            >
              New
            </Button>
          </Box>
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
            value={filterStatus || ""}
            onChange={(e) => setFilterStatus(e.target.value || null)}
            fullWidth
          >
            <MenuItem value="">All Statuses</MenuItem>
            {STATUS_FILTER_OPTIONS.map((s) => (
              <MenuItem key={s.value} value={s.value}>
                {s.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Category"
            value={filterCategory || ""}
            onChange={(e) => setFilterCategory(e.target.value || null)}
            fullWidth
          >
            <MenuItem value="">All Categories</MenuItem>
            {EXPENSE_CATEGORIES.map((c) => (
              <MenuItem key={c.value} value={c.value}>
                {c.label}
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
                ? `${getCategoryLabel(expense.expense_category)} - ${expense.vendor_name || "No vendor"} - ${format(new Date(expense.created_date), "dd/MM/yyyy")}`
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
          { label: "Expenses", href: "/finance/expenses" },
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

      {/* Action Buttons */}
      {detail && (
        <Box
          sx={{
            display: "flex",
            gap: 1,
            p: 1,
            borderBottom: 1,
            borderColor: "divider",
            bgcolor: "background.paper",
            flexWrap: "wrap",
          }}
        >
          {detail.status === "pending" && (
            <>
              <Button
                variant="contained"
                size="small"
                startIcon={<SendIcon />}
                onClick={handleSubmitExpense}
              >
                Submit for Approval
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<EditIcon />}
                onClick={() => {
                  editForm.reset({
                    expense_type: detail.expense_type,
                    expense_category: detail.expense_category,
                    expenses_method: detail.expenses_method,
                    expense_amount: detail.expense_amount,
                    vendor_name: detail.vendor_name || "",
                    description: detail.description || "",
                    receipt_number: detail.receipt_number || "",
                    bill_reference: detail.bill_reference || "",
                    remarks: detail.remarks || "",
                  });
                  setEditDialogOpen(true);
                }}
              >
                Edit
              </Button>
              <Button
                variant="outlined"
                size="small"
                color="error"
                startIcon={<DeleteIcon />}
                onClick={handleDelete}
              >
                Delete
              </Button>
            </>
          )}
          {detail.status === "submitted" && (
            <>
              <Button
                variant="contained"
                size="small"
                color="success"
                startIcon={<CheckCircleIcon />}
                onClick={handleApprove}
              >
                Approve
              </Button>
              <Button
                variant="outlined"
                size="small"
                color="error"
                onClick={() => setRejectDialogOpen(true)}
              >
                Reject
              </Button>
            </>
          )}
          {detail.status === "approved" && (
            <Button
              variant="contained"
              size="small"
              color="primary"
              startIcon={<PaymentIcon />}
              onClick={() => {
                paymentForm.reset({
                  payment_method: "cash",
                  payment_reference: "",
                  remarks: "",
                });
                setPaymentDialogOpen(true);
              }}
            >
              Process Payment
            </Button>
          )}
          {detail.status === "paid" && (
            <Button
              variant="contained"
              size="small"
              color="secondary"
              onClick={() => {
                recordForm.reset({ account_code: "", cost_center: "" });
                setRecordDialogOpen(true);
              }}
            >
              Record in Accounting
            </Button>
          )}
          {detail.status === "rejected" && (
            <>
              <Button
                variant="contained"
                size="small"
                startIcon={<SendIcon />}
                onClick={handleSubmitExpense}
              >
                Resubmit
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<EditIcon />}
                onClick={() => {
                  editForm.reset({
                    expense_type: detail.expense_type,
                    expense_category: detail.expense_category,
                    expenses_method: detail.expenses_method,
                    expense_amount: detail.expense_amount,
                    vendor_name: detail.vendor_name || "",
                    description: detail.description || "",
                    receipt_number: detail.receipt_number || "",
                    bill_reference: detail.bill_reference || "",
                    remarks: detail.remarks || "",
                  });
                  setEditDialogOpen(true);
                }}
              >
                Edit & Resubmit
              </Button>
            </>
          )}
        </Box>
      )}

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!detail ? (
          <EmptyState message="Select an expense from the list to view details" />
        ) : (
          <>
            {/* Rejection Warning */}
            {detail.status === "rejected" && detail.rejection_reason && (
              <Alert severity="error" sx={{ mb: 2 }}>
                <strong>Rejected:</strong> {detail.rejection_reason}
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

            {/* Branch & Status */}
            <FormSection title="Status & Branch" columns={3}>
              <TextField
                label="Branch"
                size="small"
                value={detail.branch_code}
                disabled
              />
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

            {/* Approval Info */}
            {(detail.approved_by || detail.approved_date) && (
              <FormSection title="Approval Information" columns={2}>
                <TextField
                  label="Approved By"
                  size="small"
                  value={detail.approved_by || "N/A"}
                  disabled
                />
                <TextField
                  label="Approved Date"
                  size="small"
                  value={
                    detail.approved_date
                      ? format(
                          new Date(detail.approved_date),
                          "dd MMM yyyy HH:mm"
                        )
                      : "N/A"
                  }
                  disabled
                />
              </FormSection>
            )}

            {/* Payment Info */}
            {detail.payment_status === "paid" && (
              <FormSection title="Payment Information" columns={3}>
                <TextField
                  label="Payment Method"
                  size="small"
                  value={
                    EXPENSE_PAYMENT_METHODS.find(
                      (m) => m.value === detail.payment_method
                    )?.label ||
                    detail.payment_method ||
                    "N/A"
                  }
                  disabled
                />
                <TextField
                  label="Payment Date"
                  size="small"
                  value={
                    detail.payment_date
                      ? format(new Date(detail.payment_date), "dd MMM yyyy")
                      : "N/A"
                  }
                  disabled
                />
                <TextField
                  label="Payment Reference"
                  size="small"
                  value={detail.payment_reference || "N/A"}
                  disabled
                />
              </FormSection>
            )}

            {/* Accounting Info */}
            {(detail.account_code || detail.cost_center) && (
              <FormSection title="Accounting" columns={2}>
                <TextField
                  label="Account Code"
                  size="small"
                  value={detail.account_code || "N/A"}
                  disabled
                />
                <TextField
                  label="Cost Center"
                  size="small"
                  value={detail.cost_center || "N/A"}
                  disabled
                />
              </FormSection>
            )}

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
        title="Expenses"
        icon={<ReceiptLongIcon color="primary" />}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />

      {/* Create Dialog */}
      <Dialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <form
          onSubmit={createForm.handleSubmit((data) =>
            createMutation.mutate(data)
          )}
        >
          <DialogTitle>Record New Expense</DialogTitle>
          <DialogContent>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 2,
                mt: 1,
              }}
            >
              <Controller
                name="expense_category"
                control={createForm.control}
                rules={{ required: "Category is required" }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    select
                    label="Category"
                    required
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                    fullWidth
                  >
                    {EXPENSE_CATEGORIES.map((c) => (
                      <MenuItem key={c.value} value={c.value}>
                        {c.label}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
              <Controller
                name="expense_type"
                control={createForm.control}
                render={({ field }) => (
                  <TextField {...field} select label="Expense Type" fullWidth>
                    {EXPENSE_TYPES.map((t) => (
                      <MenuItem key={t.value} value={t.value}>
                        {t.label}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
              <Controller
                name="expenses_method"
                control={createForm.control}
                rules={{ required: "Method is required" }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    select
                    label="Expense Method"
                    required
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                    fullWidth
                  >
                    {EXPENSES_METHOD.map((m) => (
                      <MenuItem key={m.value} value={m.value}>
                        {m.label}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
              <Controller
                name="expense_amount"
                control={createForm.control}
                rules={{
                  required: "Amount required",
                  min: { value: 0.01, message: "Min 0.01" },
                }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    type="number"
                    label="Amount (Rs.)"
                    required
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                    fullWidth
                  />
                )}
              />
              <Controller
                name="vendor_name"
                control={createForm.control}
                render={({ field }) => (
                  <TextField {...field} label="Vendor Name" fullWidth />
                )}
              />
              <Controller
                name="branch_code"
                control={createForm.control}
                rules={{ required: "Branch is required" }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    select
                    label="Branch"
                    required
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                    fullWidth
                  >
                    {branches.map(
                      (b: { branch_code: string; branch_name: string }) => (
                        <MenuItem key={b.branch_code} value={b.branch_code}>
                          {b.branch_name}
                        </MenuItem>
                      )
                    )}
                  </TextField>
                )}
              />
              <Controller
                name="receipt_number"
                control={createForm.control}
                render={({ field }) => (
                  <TextField {...field} label="Receipt Number" fullWidth />
                )}
              />
              <Controller
                name="bill_reference"
                control={createForm.control}
                render={({ field }) => (
                  <TextField {...field} label="Bill Reference" fullWidth />
                )}
              />
              <Controller
                name="expense_date"
                control={createForm.control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    type="date"
                    label="Expense Date"
                    InputLabelProps={{ shrink: true }}
                    fullWidth
                  />
                )}
              />
              <Box sx={{ gridColumn: "span 3" }}>
                <Controller
                  name="description"
                  control={createForm.control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Description"
                      multiline
                      rows={2}
                      fullWidth
                    />
                  )}
                />
              </Box>
              <Box sx={{ gridColumn: "span 3" }}>
                <Controller
                  name="remarks"
                  control={createForm.control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Remarks"
                      multiline
                      rows={2}
                      fullWidth
                    />
                  )}
                />
              </Box>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
            <Button
              type="submit"
              variant="contained"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Saving..." : "Record Expense"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={editDialogOpen}
        onClose={() => setEditDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <form
          onSubmit={editForm.handleSubmit((data) =>
            selectedExpense &&
            updateMutation.mutate({ id: selectedExpense.id, data })
          )}
        >
          <DialogTitle>Edit Expense</DialogTitle>
          <DialogContent>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 2,
                mt: 1,
              }}
            >
              <Controller
                name="expense_category"
                control={editForm.control}
                render={({ field }) => (
                  <TextField {...field} select label="Category" fullWidth>
                    {EXPENSE_CATEGORIES.map((c) => (
                      <MenuItem key={c.value} value={c.value}>
                        {c.label}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
              <Controller
                name="expense_type"
                control={editForm.control}
                render={({ field }) => (
                  <TextField {...field} select label="Expense Type" fullWidth>
                    {EXPENSE_TYPES.map((t) => (
                      <MenuItem key={t.value} value={t.value}>
                        {t.label}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
              <Controller
                name="expenses_method"
                control={editForm.control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    select
                    label="Expense Method"
                    fullWidth
                  >
                    {EXPENSES_METHOD.map((m) => (
                      <MenuItem key={m.value} value={m.value}>
                        {m.label}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
              <Controller
                name="expense_amount"
                control={editForm.control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    type="number"
                    label="Amount (Rs.)"
                    fullWidth
                  />
                )}
              />
              <Controller
                name="vendor_name"
                control={editForm.control}
                render={({ field }) => (
                  <TextField {...field} label="Vendor Name" fullWidth />
                )}
              />
              <Controller
                name="receipt_number"
                control={editForm.control}
                render={({ field }) => (
                  <TextField {...field} label="Receipt Number" fullWidth />
                )}
              />
              <Box sx={{ gridColumn: "span 3" }}>
                <Controller
                  name="description"
                  control={editForm.control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Description"
                      multiline
                      rows={2}
                      fullWidth
                    />
                  )}
                />
              </Box>
              <Box sx={{ gridColumn: "span 3" }}>
                <Controller
                  name="remarks"
                  control={editForm.control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Remarks"
                      multiline
                      rows={2}
                      fullWidth
                    />
                  )}
                />
              </Box>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button
              type="submit"
              variant="contained"
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog
        open={rejectDialogOpen}
        onClose={() => setRejectDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Reject Expense</DialogTitle>
        <DialogContent>
          <TextField
            label="Rejection Reason"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            multiline
            rows={3}
            fullWidth
            required
            sx={{ mt: 1 }}
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
            Reject
          </Button>
        </DialogActions>
      </Dialog>

      {/* Payment Dialog */}
      <Dialog
        open={paymentDialogOpen}
        onClose={() => setPaymentDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <form
          onSubmit={paymentForm.handleSubmit((data) =>
            selectedExpense &&
            paymentMutation.mutate({ id: selectedExpense.id, data })
          )}
        >
          <DialogTitle>Process Payment</DialogTitle>
          <DialogContent>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: 2,
                mt: 1,
              }}
            >
              <Controller
                name="payment_method"
                control={paymentForm.control}
                rules={{ required: "Required" }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    select
                    label="Payment Method"
                    required
                    error={!!fieldState.error}
                    fullWidth
                  >
                    {EXPENSE_PAYMENT_METHODS.map((m) => (
                      <MenuItem key={m.value} value={m.value}>
                        {m.label}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
              <Controller
                name="payment_reference"
                control={paymentForm.control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Payment Reference"
                    fullWidth
                  />
                )}
              />
              <Box sx={{ gridColumn: "span 2" }}>
                <Controller
                  name="remarks"
                  control={paymentForm.control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Remarks"
                      multiline
                      rows={2}
                      fullWidth
                    />
                  )}
                />
              </Box>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPaymentDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={paymentMutation.isPending}
            >
              Process Payment
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Record Dialog */}
      <Dialog
        open={recordDialogOpen}
        onClose={() => setRecordDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <form
          onSubmit={recordForm.handleSubmit((data) =>
            selectedExpense &&
            recordMutation.mutate({ id: selectedExpense.id, data })
          )}
        >
          <DialogTitle>Record in Accounting</DialogTitle>
          <DialogContent>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: 2,
                mt: 1,
              }}
            >
              <Controller
                name="account_code"
                control={recordForm.control}
                rules={{ required: "Account code required" }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Account Code"
                    required
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                    fullWidth
                  />
                )}
              />
              <Controller
                name="cost_center"
                control={recordForm.control}
                render={({ field }) => (
                  <TextField {...field} label="Cost Center" fullWidth />
                )}
              />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRecordDialogOpen(false)}>Cancel</Button>
            <Button
              type="submit"
              variant="contained"
              disabled={recordMutation.isPending}
            >
              Record
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Confirm Dialogs */}
      <TConfirmDialog {...submitDialog.dialogProps} />
      <TConfirmDialog {...approveDialog.dialogProps} />
      <TConfirmDialog {...deleteDialog.dialogProps} />
    </>
  );
}
