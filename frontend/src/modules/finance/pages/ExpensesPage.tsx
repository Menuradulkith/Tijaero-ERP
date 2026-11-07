
    
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import HistoryIcon from "@mui/icons-material/History";
import PaymentIcon from "@mui/icons-material/Payment";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import SendIcon from "@mui/icons-material/Send";
import ThumbDownIcon from "@mui/icons-material/ThumbDown";
import ReceiptIcon from "@mui/icons-material/Receipt";
import SearchIcon from "@mui/icons-material/Search";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import {
  ActionToolbar,
  canPrintDocument,
  DetailPanelHeader,
  EmptyState,
  EXPENSE_CATEGORIES,
  EXPENSE_PAYMENT_METHODS,
  EXPENSE_TYPES,
  fmtLKR,
  FormSection,
  handleApiError,
  MasterDetailLayout,
  SelectableListItem,
  showErrorToast,
  showSuccessToast,
  TBranchFilter,
  TConfirmDialog,
  TDataGrid,
  type TDataGridColumn,
  TPrintButton,
  TPrintPreviewDialog,
  TRemarkField,
  TSearchableSelect,
  TStatusChip,
  useConfirmDialog,
  useTConfirmDialog,
  useMasterDetailState,
  useRecordParam,
  useCrudMutation,
  TActivityHistoryPanel,
  TDatePicker,
} from "@/components/tijaero";


import { useReferenceData } from "@/hooks";
import { usePermission } from "@/auth/permissions";
import { bankReconciliationApi, expensesApi } from "@/modules/finance/api";
import { bankOverdraftWarning } from "@/modules/finance/bankBalance";
import { LEDGER_QUERY_KEYS } from "@/modules/finance/ledgerQueries";
import type { Expense as ExpenseBase, ExpenseCreate, ExpensePaymentData } from "@/modules/finance/types";
import { useCurrencyStore } from "@/state/currencyStore";
import { displayDate, todayISO } from "@/utils/formatters";

// The API adds the people's names next to their user ids.
type Expense = ExpenseBase & {
  submitted_by_name?: string | null;
  approved_by_name?: string | null;
};

/** "07 Nov 2026 14:05": the ERP's date format plus the time. */
const displayDateTime = (v?: string | null) => {
  const d = v ? new Date(v) : null;
  if (!d || isNaN(d.getTime())) return "";
  return `${displayDate(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// Process Payment dialog: where the money comes from, then the details.
type PaymentForm = {
  pay_from: "cash" | "bank";
  bank_method: "bank_transfer" | "cheque";
  bank_account_id: number | "";
  payment_reference: string;
  payment_date: string;
  remarks: string;
};
const newPaymentForm = (): PaymentForm => ({
  pay_from: "cash",
  bank_method: "bank_transfer",
  bank_account_id: "",
  payment_reference: "",
  payment_date: todayISO(),
  remarks: "",
});

import CancelIcon from "@mui/icons-material/Cancel";
// An expense row as shown in the browse table, with display-only lookup
// fields precomputed so the grid's own column-header sort orders by the
// displayed label rather than a raw code.
type ExpenseRow = Expense & { branch_name: string; category_label: string };

// ─── Configuration ───────────────────────────────────────────────────────────

const STATUS_FILTER_OPTIONS = [
  { value: "pending", label: "Pending", color: "default" as const },
  { value: "submitted", label: "Submitted", color: "info" as const },
  { value: "approved", label: "Approved", color: "success" as const },
  { value: "rejected", label: "Rejected", color: "error" as const },
  { value: "paid", label: "Paid", color: "primary" as const },
  { value: "recorded", label: "Recorded", color: "secondary" as const },
];


// Initial form data
const INITIAL_FORM_DATA: Partial<ExpenseCreate> = {
  expense_type: "operational",
  expense_category: "miscellaneous",
  expense_amount: 0,
  branch_code: "",
  vendor_name: "",
  description: "",
  receipt_number: "",
  bill_reference: "",
  remarks: "",
};

const resetFormFromExpense = (expense: Expense): Partial<ExpenseCreate> => ({
  expense_type: expense.expense_type,
  expense_category: expense.expense_category,
  expense_amount: expense.expense_amount,
  expense_date: expense.expense_date,
  branch_code: expense.branch_code,
  vendor_name: expense.vendor_name,
  description: expense.description,
  receipt_number: expense.receipt_number,
  bill_reference: expense.bill_reference,
  remarks: expense.remarks,
});

// ─── Component ───────────────────────────────────────────────────────────────

export default function ExpensesPage() {
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();

  // State
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);

  // Workflow dialogs (kept for submit, approve, reject, payment, record actions)
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [recordDialogOpen, setRecordDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [selectedExpenseForPrint, setSelectedExpenseForPrint] = useState<Expense | null>(null);

  const deleteDialog = useTConfirmDialog();
  const submitDialog = useTConfirmDialog();
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

  // Master detail state
  const {
    searchQuery,
    setSearchQuery,
    selectedItem: selectedExpense,
    setSelectedItem: setSelectedExpense,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    formData,
    setFormData,
    handleSelectItem: handleSelectExpense,
    handleNew: handleNewExpenseBase,
    handleCancel: handleCancelBase,
    handleStartEdit: handleStartEditBase,
    openItem: openExpense,
  } = useMasterDetailState<Expense, Partial<ExpenseCreate>>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromExpense,
    defaultSortField: "created_date",
    confirmUnsavedChanges: () =>
      confirmDialog.confirm({
        title: "Discard Changes",
        message: "You have unsaved changes. Discard them?",
        confirmText: "Discard",
        cancelText: "Keep Editing",
        confirmColor: "warning",
      }),
  });

  // Activity History is opened on demand from a detail icon next to the
  // Status & Dates section title, rather than shown inline.
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);

  const handleStartEdit = useCallback(() => {
    handleStartEditBase();
  }, [handleStartEditBase]);

  const handleCancel = useCallback(
    (items: Expense[]) => {
      handleCancelBase(items);
    },
    [handleCancelBase]
  );

  const handleNewExpense = useCallback(() => {
    handleNewExpenseBase();
    // Bill date defaults to today (local, not UTC); the server sets the old
    // "expense method" from the category.
    setFormData(prev => ({
      ...prev,
      expense_date: todayISO(),
      ...(defaultBranchCode ? { branch_code: defaultBranchCode } : {}),
    }));
  }, [handleNewExpenseBase, defaultBranchCode, setFormData]);

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterStatus(null);
    setFilterBranch(null);
    setFilterCategory(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    enabled: branchResolved,
    placeholderData: (prev) => prev,
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
    // Default order before the user sorts a column in the table itself (the
    // table's own column-header sort takes over from there) — most recently
    // created first, same as the removed "Date Created" sort option's default.
    filtered.sort((a, b) => {
      const timeA = a.created_at ? new Date(a.created_at).getTime() : (a.created_date ? new Date(a.created_date).getTime() : 0);
      const timeB = b.created_at ? new Date(b.created_at).getTime() : (b.created_date ? new Date(b.created_date).getTime() : 0);
      if (timeB !== timeA) return timeB - timeA;
      return b.id - a.id;
    });
    return filtered;
  }, [expenses, searchQuery]);

  // ─── Mutations ─────────────────────────────────────────────────────────────

  // Same permissions the backend checks on each endpoint.
  const canCreateExpense = usePermission("expenses", "create");
  const canUpdateExpense = usePermission("expenses", "update");
  const canDeleteExpense = usePermission("expenses", "delete");
  const canApproveExpense = usePermission("expense_approvals", "approve");

  const createMutation = useCrudMutation({
    mutationFn: expensesApi.create,
    invalidateQueryKeys: [["expenses"], ["expense-detail"]],
    successMessage: "Expense recorded successfully",
    errorMessage: "Failed to create expense",
    onSuccess: (data) => {
      // Show the saved expense (view mode) with its Submit action.
      setIsCreating(false);
      setIsEditing(false);
      setSelectedExpense(data);
    },
  });

  const updateMutation = useCrudMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ExpenseCreate> }) =>
      expensesApi.update(id, data),
    invalidateQueryKeys: [["expenses"], ["expense-detail"]],
    successMessage: "Expense updated",
    errorMessage: "Failed to update expense",
    onSuccess: (data) => {
      setIsEditing(false);
      setSelectedExpense(data);
    },
  });

  const submitMutation = useCrudMutation({
    mutationFn: (id: number) => expensesApi.submit(id),
    invalidateQueryKeys: [["expenses"], ["expense-detail"]],
    successMessage: "Expense submitted for approval",
    errorMessage: "Failed to submit expense",
    onSuccess: (data) => {
      setSelectedExpense(data);
    },
  });

  const approveMutation = useCrudMutation({
    mutationFn: (id: number) => expensesApi.approve(id),
    invalidateQueryKeys: [["expenses"], ["expense-detail"]],
    successMessage: "Expense approved",
    errorMessage: "Failed to approve expense",
    onSuccess: (data) => {
      setSelectedExpense(data);
    },
  });

  const rejectMutation = useCrudMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      expensesApi.reject(id, reason),
    invalidateQueryKeys: [["expenses"], ["expense-detail"]],
    successMessage: "Expense rejected",
    errorMessage: "Failed to reject expense",
    onSuccess: (data) => {
      setRejectDialogOpen(false);
      setRejectReason("");
      setSelectedExpense(data);
    },
  });

  const paymentMutation = useCrudMutation({
    mutationFn: ({ id, data }: { id: number; data: ExpensePaymentData & { bank_account_id?: number }; message: string }) =>
      expensesApi.processPayment(id, data),
    invalidateQueryKeys: [["expenses"], ["expense-detail"], ...LEDGER_QUERY_KEYS],
    getSuccessMessage: (_data, vars) => vars.message,
    errorMessage: "Payment not made",
    onSuccess: (data) => {
      setPaymentDialogOpen(false);
      setSelectedExpense(data);
    },
  });

  const recordMutation = useCrudMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number;
      data: { account_code: string; cost_center?: string };
    }) => expensesApi.record(id, data),
    invalidateQueryKeys: [["expenses"], ["expense-detail"], ...LEDGER_QUERY_KEYS],
    successMessage: "Expense recorded in accounting",
    errorMessage: "Failed to record expense",
    onSuccess: (data) => {
      setRecordDialogOpen(false);
      setSelectedExpense(data);
    },
  });

  const deleteMutation = useCrudMutation({
    mutationFn: (id: number) => expensesApi.delete(id),
    invalidateQueryKeys: [["expenses"], ["expense-detail"]],
    successMessage: "Expense deleted",
    errorMessage: "Failed to delete expense",
    onSuccess: () => {
      setSelectedExpense(null);
    },
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────

  // Validation
  const isFormValid = useMemo(() => {
    if (!isCreating && !isEditing) return true;
    return !!(
      formData.expense_type &&
      formData.expense_category &&
      formData.expense_amount &&
      (!formData.expense_date || formData.expense_date <= todayISO()) &&
      formData.expense_amount > 0 &&
      formData.branch_code &&
      formData.vendor_name
    );
  }, [isCreating, isEditing, formData]);

  const isSaving = createMutation.isPending || updateMutation.isPending;

  // Blocks a second Save click before the first save has settled.
  const savingRef = useRef(false);

  const handleSave = useCallback(async () => {
    if (!isFormValid || savingRef.current) return;
    const done = { onSettled: () => { savingRef.current = false; } };

    if (isCreating) {
      savingRef.current = true;
      createMutation.mutate(formData as ExpenseCreate, done);
    } else if (isEditing && selectedExpense) {
      savingRef.current = true;
      updateMutation.mutate({ id: selectedExpense.id, data: formData }, done);
    }
  }, [isCreating, isEditing, isFormValid, formData, selectedExpense, createMutation, updateMutation]);

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

  // Cancelling out of "New Expense" should return to the browse table, not
  // auto-open the first expense the way useMasterDetailState's generic
  // handleCancel does (that behavior made sense for the old always-visible
  // detail panel, but not here). Cancelling out of editing an existing
  // expense still just reverts its form, which the generic handler already
  // does correctly.
  const handleCancelExpense = useCallback(() => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedExpense(null);
    } else {
      handleCancel(filteredExpenses);
    }
  }, [isCreating, filteredExpenses, handleCancel, setIsCreating, setIsEditing, setSelectedExpense]);

  // Returns to the browse table from the detail view (the "Back to Expenses"
  // link above the detail header).
  const handleBackToExpenses = useCallback(() => {
    setSelectedExpense(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [isCreating, setSelectedExpense, setIsCreating, setIsEditing]);

  // Open expense lives in the URL (?id= / ?new=1) so browser Back returns to
  // the list and an expense can be shared as a link.
  useRecordParam<Expense>({
    current: selectedExpense?.id,
    creating: isCreating,
    items: expenses,
    loading: isLoading,
    fetchById: (id) => expensesApi.getById(Number(id)),
    onOpen: openExpense,
    onClose: handleBackToExpenses,
    onNew: canCreateExpense ? handleNewExpense : undefined,
  });

  // Whether we're showing a single expense's detail view (selected or being
  // created) instead of the browse table.
  const isExpenseDetailMode = !!selectedExpense || isCreating;

  const getCategoryLabel = (val: string) =>
    EXPENSE_CATEGORIES.find((c) => c.value === val)?.label || val;

  // ─── Forms for workflow dialogs ────────────────────────────────────────────

  const paymentForm = useForm<PaymentForm>({ defaultValues: newPaymentForm() });
  const payFrom = paymentForm.watch("pay_from");
  const bankMethod = paymentForm.watch("bank_method");

  // Registered bank accounts to pay from (Accounting > Bank Accounts).
  const { data: bankAccountsData } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: bankReconciliationApi.listAccounts,
    enabled: paymentDialogOpen,
    retry: false,
  });
  const bankAccounts = useMemo(
    () =>
      (bankAccountsData || []).filter(
        (b) => b.is_active && (!b.branch_code || !selectedExpense || b.branch_code === selectedExpense.branch_code)
      ),
    [bankAccountsData, selectedExpense]
  );
  // Paying more than the account holds is allowed (overdraft), but say so.
  const payBankId = paymentForm.watch("bank_account_id");
  const overdraftWarning =
    payFrom === "bank" && selectedExpense
      ? bankOverdraftWarning(
          bankAccounts.find((b) => b.id === payBankId),
          Number(selectedExpense.expense_amount),
          currencySymbol
        )
      : null;
  const bankLabel = (b: { name: string; bank_name?: string | null; account_number?: string | null }) =>
    [b.bank_name && b.bank_name !== b.name ? `${b.bank_name} ${b.name}` : b.name, b.account_number]
      .filter(Boolean)
      .join(" · ");

  const submitPayment = (form: PaymentForm) => {
    if (!selectedExpense || savingRef.current) return;
    const amountText = `${currencySymbol} ${fmtLKR(selectedExpense.expense_amount)}`;
    const bank = bankAccounts.find((b) => b.id === form.bank_account_id);
    const common = {
      payment_date: form.payment_date,
      payment_reference: form.payment_reference.trim() || undefined,
      remarks: form.remarks || undefined,
    };
    const data: ExpensePaymentData & { bank_account_id?: number } =
      form.pay_from === "cash"
        ? { ...common, payment_method: "cash" }
        : { ...common, payment_method: form.bank_method, bank_account_id: bank?.id };
    const message =
      form.pay_from === "cash"
        ? `Paid ${amountText} in cash from ${selectedExpense.branch_code}`
        : `Paid ${amountText} by ${form.bank_method === "cheque" ? "cheque" : "bank transfer"}${bank ? ` from ${bankLabel(bank)}` : ""}`;
    savingRef.current = true;
    paymentMutation.mutate(
      { id: selectedExpense.id, data, message },
      { onSettled: () => { savingRef.current = false; } }
    );
  };

  const recordForm = useForm<{ account_code: string; cost_center: string }>({
    defaultValues: { account_code: "", cost_center: "" },
  });

  // ─── Browse Table ──────────────────────────────────────────────────────────

  // The table sorts by whichever column the user clicks; the Branch and
  // Category columns display a looked-up label rather than the raw code, so
  // they need that label as their own field for the grid to sort on correctly.
  const expenseRows: ExpenseRow[] = useMemo(
    () =>
      filteredExpenses.map((expense) => ({
        ...expense,
        branch_name: branches.find((b) => b.branch_code === expense.branch_code)?.branch_name || expense.branch_code || "-",
        category_label: getCategoryLabel(expense.expense_category),
      })),
    [filteredExpenses, branches] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const expenseColumns: TDataGridColumn<ExpenseRow>[] = useMemo(
    () => [
      { field: "expenses_no", header: "Expense No", width: 150 },
      { field: "category_label", header: "Category", flex: 1, minWidth: 150 },
      { field: "branch_name", header: "Branch", width: 150 },
      {
        field: "expense_date",
        header: "Bill Date",
        width: 130,
        renderCell: (params: GridRenderCellParams<ExpenseRow>) => {
          return displayDate(params.row.expense_date || params.row.created_date) || "-";
        },
      },
      {
        field: "expense_amount",
        header: "Amount",
        width: 140,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<ExpenseRow>) => fmtLKR(params.row.expense_amount),
      },
      {
        field: "status",
        header: "Status",
        width: 130,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<ExpenseRow>) => (
          <TStatusChip status={params.row.status} statusMap="expenseStatus" size="small" />
        ),
      },
      { field: "vendor_name", header: "Vendor", flex: 1, minWidth: 150 },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<ExpenseRow>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectExpense(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [handleSelectExpense]
  );

  // ─── Detail Panel ──────────────────────────────────────────────────────────

  const detail = (expenseDetail || selectedExpense) as Expense | null;

  // Workflow action buttons based on status
  const getWorkflowActions = () => {
    if (!selectedExpense || isCreating || isEditing) return null;

    const actions: React.ReactNode[] = [];

    if (selectedExpense.status === "pending" && canUpdateExpense) {
      actions.push(
        <Button
          key="submit"
          variant="contained"
          size="small"
          startIcon={<SendIcon />}
          onClick={handleSubmitExpense}
        >
          Submit
        </Button>
      );
    } else if (selectedExpense.status === "submitted" && canApproveExpense) {
      actions.push(
        <Button
          key="approve"
          variant="contained"
          size="small"
          color="success"
          startIcon={<CheckCircleIcon />}
          onClick={handleApprove}
        >
          Approve
        </Button>,
        <Button
          key="reject"
          variant="outlined"
          size="small"
          color="error"
          startIcon={<ThumbDownIcon />}
          onClick={() => setRejectDialogOpen(true)}
        >
          Reject
        </Button>
      );
    } else if (selectedExpense.status === "approved" && canUpdateExpense) {
      actions.push(
        <Button
          key="payment"
          variant="contained"
          size="small"
          color="primary"
          startIcon={<PaymentIcon />}
          onClick={() => {
            paymentForm.reset(newPaymentForm());
            setPaymentDialogOpen(true);
          }}
        >
          Process Payment
        </Button>
      );
    } else if (
      selectedExpense.status === "paid" &&
      canUpdateExpense &&
      // Paying an expense posts it to the accounts. Only offer this for an
      // older paid expense whose journal is missing.
      expenseDetail?.id === selectedExpense.id &&
      expenseDetail.posted_to_accounts === false
    ) {
      actions.push(
        <Button
          key="record"
          variant="contained"
          size="small"
          color="secondary"
          startIcon={<ReceiptIcon />}
          onClick={() => {
            recordForm.reset({ account_code: "", cost_center: "" });
            setRecordDialogOpen(true);
          }}
        >
          Record in Accounting
        </Button>
      );
    } else if (selectedExpense.status === "rejected" && canUpdateExpense) {
      actions.push(
        <Button
          key="resubmit"
          variant="contained"
          size="small"
          startIcon={<SendIcon />}
          onClick={handleSubmitExpense}
        >
          Resubmit
        </Button>
      );
    }

    return actions.length > 0 ? <>{actions}</> : null;
  };

  const canEdit = canUpdateExpense && selectedExpense && (selectedExpense.status === "pending" || selectedExpense.status === "rejected");
  const canDelete = canDeleteExpense && selectedExpense && selectedExpense.status === "pending" ? true : false;

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Finance", href: "/finance" },
          { label: "Expenses", href: "/finance/expenses" },
          ...(selectedExpense || isCreating
            ? [{ label: isCreating ? "New Expense" : selectedExpense?.expenses_no || `EXP-${selectedExpense?.id}` }]
            : []),
        ]}
        title={selectedExpense ? selectedExpense.expenses_no || `EXP-${selectedExpense.id}` : ""}
        titleIcon={<ReceiptLongIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Expense"
        noSelectionTitle="Select an Expense"
      />

      <ActionToolbar
        hasSelectedItem={!!selectedExpense}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={isFormValid}
        onNew={canCreateExpense ? handleNewExpense : undefined}
        onSave={handleSave}
        onCancel={handleCancelExpense}
        onEdit={canEdit ? handleStartEdit : undefined}
        onDelete={canDelete ? handleDelete : undefined}
        canDelete={canDelete}
        endActions={
          <>
            {getWorkflowActions()}
            {selectedExpense && !isCreating && !isEditing && (
              <TPrintButton
                documentType="expense"
                documentId={selectedExpense.id}
                disabled={!canPrintDocument(selectedExpense.status, ["cancelled", "rejected"])}
                disabledReason={`Cannot print: expense is ${(selectedExpense.status || "").replace(/_/g, " ")}`}
                onClick={() => {
                  setSelectedExpenseForPrint(selectedExpense);
                  setPrintDialogOpen(true);
                }}
              />
            )}
          </>
        }
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedExpense && !isCreating ? (
          <EmptyState message="Select an expense from the list or create a new one" />
        ) : (
          <>

            {/* Rejection Warning */}
            {detail && detail.status === "rejected" && detail.rejection_reason && (
              <Alert severity="error" sx={{ mb: 2 }}>
                <strong>Rejected:</strong> {detail.rejection_reason}
              </Alert>
            )}

            {/* Step 1: Expense Information (always show in view/edit mode) */}
            {(

              <>
                <FormSection title="Expense Information" columns={3}>
                  <TextField
                    label="Expense Type"
                    size="small"
                    select
                    value={formData.expense_type || "operational"}
                    onChange={(e) => setFormData({ ...formData, expense_type: e.target.value as any })}
                    disabled={!isEditing && !isCreating}
                    required
                  >
                    {EXPENSE_TYPES.map((type) => (
                      <MenuItem key={type.value} value={type.value}>
                        {type.label}
                      </MenuItem>
                    ))}
                  </TextField>

                  <TextField
                    label="Category"
                    size="small"
                    select
                    value={formData.expense_category || "miscellaneous"}
                    onChange={(e) => setFormData({ ...formData, expense_category: e.target.value })}
                    disabled={!isEditing && !isCreating}
                    required
                  >
                    {EXPENSE_CATEGORIES.map((cat) => (
                      <MenuItem key={cat.value} value={cat.value}>
                        {cat.label}
                      </MenuItem>
                    ))}
                  </TextField>

                  <TDatePicker
                    label="Bill Date"
                    size="small"
                    value={formData.expense_date || ""}
                    onChange={(v) => setFormData({ ...formData, expense_date: v ?? "" })}
                    disabled={!isEditing && !isCreating}
                    inputProps={{ max: todayISO() }}
                    error={!!formData.expense_date && formData.expense_date > todayISO()}
                    helperText={!!formData.expense_date && formData.expense_date > todayISO() ? "Can't be a future date" : undefined}
                    required
                  />

                  <TextField
                    label={`Amount (${currencySymbol})`}
                    size="small"
                    type="number"
                    value={formData.expense_amount || 0}
                    onChange={(e) =>
                      setFormData({ ...formData, expense_amount: parseFloat(e.target.value) || 0 })
                    }
                    disabled={!isEditing && !isCreating}
                    required
                    inputProps={{ step: 0.01, min: 0 }}
                  />

                  <Autocomplete
                    size="small"
                    options={branches}
                    getOptionLabel={(option) => `${option.branch_code} - ${option.branch_name}`}
                    value={branches.find((b) => b.branch_code === formData.branch_code) || null}
                    onChange={(_, newValue) =>
                      setFormData({ ...formData, branch_code: newValue?.branch_code || "" })
                    }
                    disabled={!isEditing && !isCreating}
                    renderInput={(params) => <TextField {...params} label="Branch" required />}
                  />

                  <TextField
                    label="Vendor Name"
                    size="small"
                    value={formData.vendor_name || ""}
                    onChange={(e) => setFormData({ ...formData, vendor_name: e.target.value })}
                    disabled={!isEditing && !isCreating}
                    required
                  />

                  <TextField
                    label="Receipt Number"
                    size="small"
                    value={formData.receipt_number || ""}
                    onChange={(e) => setFormData({ ...formData, receipt_number: e.target.value })}
                    disabled={!isEditing && !isCreating}
                  />

                  <TextField
                    label="Bill Reference"
                    size="small"
                    value={formData.bill_reference || ""}
                    onChange={(e) => setFormData({ ...formData, bill_reference: e.target.value })}
                    disabled={!isEditing && !isCreating}
                  />

                  <TextField
                    label="Description"
                    size="small"
                    value={formData.description || ""}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    disabled={!isEditing && !isCreating}
                    multiline
                    rows={2}
                    sx={{ gridColumn: "span 3" }}
                  />
                </FormSection>

                {/* View mode: show additional fields */}
                {!isCreating && !isEditing && detail && (
                  <>
                    <FormSection
                      title="Status & Dates"
                      columns={3}
                      titleAction={
                        <Tooltip title="View activity history">
                          <IconButton size="small" onClick={() => setActivityHistoryOpen(true)}>
                            <HistoryIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      }
                    >
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 1 }}>
                        <Typography variant="body2" color="text.secondary">
                          Status:
                        </Typography>
                        <TStatusChip status={detail.status} statusMap="expenseStatus" />
                      </Box>
                      <TextField
                        label="Created Date"
                        size="small"
                        value={displayDate(detail.created_date) || "N/A"}
                        disabled
                      />
                      <TextField
                        label="Submitted By"
                        size="small"
                        value={detail.submitted_by_name || (detail.submitted_by ? `User #${detail.submitted_by}` : "N/A")}
                        disabled
                      />
                    </FormSection>

                    {/* Approval Info */}
                    {(detail.approved_by || detail.approved_date) && (
                      <FormSection title="Approval Information" columns={2}>
                        <TextField
                          label={detail.status === "rejected" ? "Rejected By" : "Approved By"}
                          size="small"
                          value={detail.approved_by_name || (detail.approved_by ? `User #${detail.approved_by}` : "N/A")}
                          disabled
                        />
                        <TextField
                          label="Approved Date"
                          size="small"
                          value={displayDateTime(detail.approved_date) || "N/A"}
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
                            EXPENSE_PAYMENT_METHODS.find((m) => m.value === detail.payment_method)
                              ?.label ||
                            detail.payment_method ||
                            "N/A"
                          }
                          disabled
                        />
                        <TextField
                          label="Payment Date"
                          size="small"
                          value={displayDate(detail.payment_date) || "N/A"}
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
                  </>
                )}

                <FormSection title="Remarks" columns={1}>
                  <TRemarkField
                    label="Remarks"
                    size="small"
                    value={formData.remarks || ""}
                    onChange={(value) => setFormData({ ...formData, remarks: value })}
                    disabled={!isEditing && !isCreating}
                    multiline
                    rows={3}
                  />
                </FormSection>
              </>
            )}
          </>
        )}
      </Box>
    </Box>
  );

  // Browse mode: a full-width table of every expense (shown when nothing is
  // selected and nothing is being created). Sorting is done per-column via
  // the grid's own column header menu, not a separate "Sort by" control.
  const expenseTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<ExpenseRow>
          rows={expenseRows}
          columns={expenseColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectExpense(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No expenses found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <MasterDetailLayout
        title="Expenses"
        titleSlot={
          isExpenseDetailMode ? (
          <Button
            size="small"
            startIcon={<ArrowBackIcon fontSize="small" />}
            onClick={handleBackToExpenses}
            sx={{ textTransform: "none" }}
          >
            Back to Expenses
          </Button>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search expenses..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                }}
                sx={{ width: 190, flexShrink: 0 }}
              />
              <Box sx={{ width: 150, flexShrink: 0 }}>
                <TBranchFilter
                  branches={branches}
                  value={filterBranch}
                  onChange={setFilterBranch}
                  label=""
                  size="small"
                />
              </Box>
              <Box sx={{ width: 150, flexShrink: 0 }}>
                <TSearchableSelect
                  label=""
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
                  size="small"
                />
              </Box>
              <Box sx={{ width: 170, flexShrink: 0 }}>
                <TSearchableSelect
                  label=""
                  value={filterCategory}
                  onChange={(val) => setFilterCategory(val as string | null)}
                  options={EXPENSE_CATEGORIES.map((c) => ({
                    value: c.value,
                    label: c.label,
                  }))}
                  showAllOption
                  allOptionLabel="All Categories"
                  placeholder="Search category..."
                  size="small"
                />
              </Box>
              {(searchQuery || filterStatus || filterBranch || filterCategory) && (
                <Button size="small" onClick={handleClearFilters} sx={{ textTransform: "none" }}>
                  Clear
                </Button>
              )}
            </Box>
          )
        }
        headerActions={
          isExpenseDetailMode || !canCreateExpense ? undefined : (
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={handleNewExpense}
              sx={{ mr: 1 }}
            >
              Add Expense
            </Button>
          )
        }
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ["expenses"] });
          queryClient.invalidateQueries({ queryKey: ["expense-detail"] });
        }}
        isLoading={isLoading}
        {...(isExpenseDetailMode
          ? { children: detailPanel }
          : { children: expenseTablePanel })}
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
          <Button variant="contained" color="error" startIcon={<CancelIcon />} onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
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
        <form onSubmit={paymentForm.handleSubmit(submitPayment)}>
          <DialogTitle>Pay Expense</DialogTitle>
          <DialogContent>
            {selectedExpense && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  {selectedExpense.expenses_no} · {selectedExpense.vendor_name || "-"}
                </Typography>
                <Typography variant="h5">
                  {currencySymbol} {fmtLKR(selectedExpense.expense_amount)}
                </Typography>
              </Box>
            )}
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 2 }}>
              <Controller
                name="pay_from"
                control={paymentForm.control}
                render={({ field }) => (
                  <TextField {...field} select label="Pay from" required fullWidth>
                    <MenuItem value="cash">Cash in till ({selectedExpense?.branch_code})</MenuItem>
                    <MenuItem value="bank">Bank account</MenuItem>
                  </TextField>
                )}
              />
              <Controller
                name="payment_date"
                control={paymentForm.control}
                rules={{
                  required: "Required",
                  validate: (v) => v <= todayISO() || "Can't be a future date",
                }}
                render={({ field, fieldState }) => (
                  <TDatePicker
                    name={field.name}
                    value={field.value || ""}
                    onChange={(v) => field.onChange(v ?? "")}
                    onBlur={field.onBlur}
                    inputRef={field.ref}
                    label="Payment date"
                    required
                    fullWidth
                    inputProps={{ max: todayISO() }}
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                  />
                )}
              />
              {payFrom === "bank" && (
                <>
                  <Controller
                    name="bank_account_id"
                    control={paymentForm.control}
                    rules={{ validate: (v) => bankAccounts.length === 0 || v !== "" || "Choose the bank account" }}
                    render={({ field, fieldState }) => (
                      <TextField
                        {...field}
                        select
                        label="Bank account"
                        required={bankAccounts.length > 0}
                        fullWidth
                        disabled={bankAccounts.length === 0}
                        error={!!fieldState.error}
                        helperText={
                          fieldState.error?.message ||
                          (bankAccounts.length === 0 ? "No bank accounts set up: name the bank in the reference" : undefined)
                        }
                      >
                        {bankAccounts.map((b) => (
                          <MenuItem key={b.id} value={b.id}>
                            {bankLabel(b)}
                          </MenuItem>
                        ))}
                      </TextField>
                    )}
                  />
                  {overdraftWarning && <Alert severity="warning">{overdraftWarning}</Alert>}
                  <Controller
                    name="bank_method"
                    control={paymentForm.control}
                    render={({ field }) => (
                      <TextField {...field} select label="How" required fullWidth>
                        {EXPENSE_PAYMENT_METHODS.filter((m) => m.value === "bank_transfer" || m.value === "cheque").map((m) => (
                          <MenuItem key={m.value} value={m.value}>
                            {m.label}
                          </MenuItem>
                        ))}
                      </TextField>
                    )}
                  />
                </>
              )}
              <Controller
                name="payment_reference"
                control={paymentForm.control}
                rules={{
                  validate: (v) =>
                    payFrom === "cash" || !!v.trim() || (bankMethod === "cheque" ? "Enter the cheque number" : "Enter the transfer reference"),
                }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label={payFrom === "cash" ? "Receipt / voucher no. (optional)" : bankMethod === "cheque" ? "Cheque number" : "Transfer reference"}
                    required={payFrom === "bank"}
                    fullWidth
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                    sx={{ gridColumn: payFrom === "bank" ? "span 2" : undefined }}
                  />
                )}
              />
              <Box sx={{ gridColumn: "span 2" }}>
                <Controller
                  name="remarks"
                  control={paymentForm.control}
                  render={({ field }) => (
                    <TRemarkField
                      label="Remarks"
                      multiline
                      rows={2}
                      fullWidth
                      value={field.value}
                      onChange={(value) => field.onChange(value)}
                    />
                  )}
                />
              </Box>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button variant="contained" color="error" startIcon={<CancelIcon />} onClick={() => setPaymentDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={paymentMutation.isPending}>
              Pay {selectedExpense ? `${currencySymbol} ${fmtLKR(selectedExpense.expense_amount)}` : ""}
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
            {
              if (!selectedExpense || savingRef.current) return;
              savingRef.current = true;
              recordMutation.mutate({ id: selectedExpense.id, data }, { onSettled: () => { savingRef.current = false; } });
            }
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
            <Button variant="contained" color="error" startIcon={<CancelIcon />} onClick={() => setRecordDialogOpen(false)}>Cancel</Button>
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
      <TConfirmDialog {...confirmDialog.dialogProps} />
      <TConfirmDialog {...submitDialog.dialogProps} />
      <TConfirmDialog {...approveDialog.dialogProps} />
      <TConfirmDialog {...deleteDialog.dialogProps} />

      {/* Print Preview Dialog */}
      {selectedExpenseForPrint && (
        <TPrintPreviewDialog
          open={printDialogOpen}
          onClose={() => {
            setPrintDialogOpen(false);
            setSelectedExpenseForPrint(null);
          }}
          documentType="expense"
          documentId={selectedExpenseForPrint.id}
          title={`Print Expense: ${selectedExpenseForPrint.expenses_no}`}
        />
      )}

      <TActivityHistoryPanel
        open={activityHistoryOpen}
        onClose={() => setActivityHistoryOpen(false)}
        entityType="expense"
        entityId={selectedExpense?.id}
        actionLabels={{
          create: "Expense created",
          submit: "Expense submitted",
          approve: "Expense approved",
          reject: "Expense rejected",
          pay: "Expense paid",
          record: "Recorded in accounts",
        }}
      />
    </>
  );
}
