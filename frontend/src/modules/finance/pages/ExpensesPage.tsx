
    
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import PaymentIcon from "@mui/icons-material/Payment";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import SendIcon from "@mui/icons-material/Send";
import ThumbDownIcon from "@mui/icons-material/ThumbDown";
import ReceiptIcon from "@mui/icons-material/Receipt";
import { exportToCSV } from "@/utils/csvExport";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import {
  ActionToolbar,
  canPrintDocument,
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
  TPrintButton,
  TPrintPreviewDialog,
  TSearchableSelect,
  TStatusChip,
  useConfirmDialog,
  useTConfirmDialog,
  useMasterDetailState,
  useCrudMutation,
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

const FORM_STEPS = ["Expense Information", "Payment Details"];

// Initial form data
const INITIAL_FORM_DATA: Partial<ExpenseCreate> = {
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
};

const resetFormFromExpense = (expense: Expense): Partial<ExpenseCreate> => ({
  expense_type: expense.expense_type,
  expense_category: expense.expense_category,
  expenses_method: expense.expenses_method,
  expense_amount: expense.expense_amount,
  branch_code: expense.branch_code,
  vendor_name: expense.vendor_name,
  description: expense.description,
  receipt_number: expense.receipt_number,
  bill_reference: expense.bill_reference,
  remarks: expense.remarks,
});

// ─── Component ───────────────────────────────────────────────────────────────

export default function ExpensesPage() {
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();

  // State
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [formStep, setFormStep] = useState(0);

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
    sortField,
    setSortField,
    selectedItem: selectedExpense,
    setSelectedItem: setSelectedExpense,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    favorites,
    toggleFavorite,
    formData,
    setFormData,
    handleSelectItem: handleSelectExpense,
    handleNew: handleNewExpenseBase,
    handleCancel: handleCancelBase,
    handleStartEdit: handleStartEditBase,
  } = useMasterDetailState<Expense, Partial<ExpenseCreate>>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromExpense,
    favoritesKey: "expenses_favorites",
    defaultSortField: "created_date",
    confirmUnsavedChanges: () =>
      confirmDialog.confirm({
        title: "Discard Changes",
        message: "You have unsaved changes. Discard them?",
        confirmText: "Discard",
        cancelText: "Keep Editing",
        confirmColor: "warning",
      }),
    onDiscard: () => { setFormStep(0); },
  });

  const handleStartEdit = useCallback(() => {
    handleStartEditBase();
    setFormStep(0);
  }, [handleStartEditBase]);

  const handleCancel = useCallback(
    (items: Expense[]) => {
      handleCancelBase(items);
      setFormStep(0);
    },
    [handleCancelBase]
  );

  const handleNewExpense = useCallback(() => {
    handleNewExpenseBase();
    if (defaultBranchCode) {
      setFormData(prev => ({ ...prev, branch_code: defaultBranchCode }));
    }
    setFormStep(0);
  }, [handleNewExpenseBase, defaultBranchCode, setFormData]);

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

  // ─── CSV Export ─────────────────────────────────────────────────────────
  const handleExportCSV = () => {
    if (!filteredExpenses.length) return;
    const headers = ["Expense No", "Category", "Amount", "Method", "Status", "Date", "Vendor", "Remarks", "Branch"];
    const rows = filteredExpenses.map(e => [
      e.expenses_no, e.expense_category || "", e.expense_amount, e.expenses_method, e.status, e.expense_date || e.created_date, e.vendor_name || "", e.remarks || "", e.branch_code || "",
    ]);
    exportToCSV({
      filename: `expenses_${new Date().toISOString().split("T")[0]}`,
      headers,
      rows,
    });
  };

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

  const createMutation = useCrudMutation({
    mutationFn: expensesApi.create,
    invalidateQueryKeys: [["expenses"], ["expense-detail"]],
    successMessage: "Expense recorded successfully",
    errorMessage: "Failed to create expense",
    onSuccess: (data) => {
      setIsCreating(false);
      setSelectedExpense(data);
      setFormStep(0);
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
    mutationFn: ({ id, data }: { id: number; data: ExpensePaymentData }) =>
      expensesApi.processPayment(id, data),
    invalidateQueryKeys: [["expenses"], ["expense-detail"]],
    successMessage: "Payment processed",
    errorMessage: "Failed to process payment",
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
    invalidateQueryKeys: [["expenses"], ["expense-detail"]],
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
      formData.expenses_method &&
      formData.expense_amount &&
      formData.expense_amount > 0 &&
      formData.branch_code &&
      formData.vendor_name
    );
  }, [isCreating, isEditing, formData]);

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const handleSave = useCallback(async () => {
    if (!isFormValid) return;
    
    if (isCreating) {
      createMutation.mutate(formData as ExpenseCreate);
    } else if (isEditing && selectedExpense) {
      updateMutation.mutate({ id: selectedExpense.id, data: formData });
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

  const getCategoryLabel = (val: string) =>
    EXPENSE_CATEGORIES.find((c) => c.value === val)?.label || val;

  // ─── Forms for workflow dialogs ────────────────────────────────────────────

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
          <TFilterPanel>
            <TBranchFilter
              branches={branches}
              value={filterBranch}
              onChange={setFilterBranch}
            />
          </TFilterPanel>
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
          <TSearchableSelect
            label="Category"
            value={filterCategory}
            onChange={(val) => setFilterCategory(val as string | null)}
            options={EXPENSE_CATEGORIES.map((c) => ({
              value: c.value,
              label: c.label,
            }))}
            showAllOption
            allOptionLabel="All Categories"
            placeholder="Search category..."
          />
        </Box>
      }
      renderItem={(expense: Expense, isSelected: boolean) => {
        return (
          <SelectableListItem
            key={expense.id}
            id={expense.id}
            isSelected={isSelected}
            onClick={() => handleSelectExpense(expense)}
            primaryText={
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 0.5,
                  width: "100%",
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Typography variant="body2" fontWeight={600}>
                    {expense.expenses_no}
                  </Typography>
                  <Typography variant="body2" fontWeight={600} color="primary">
                    {fmtLKR(expense.expense_amount)}
                  </Typography>
                </Box>
                {isSelected && (
                  <>
                    <Typography variant="caption" color="text.secondary">
                      {getCategoryLabel(expense.expense_category)} • {expense.vendor_name || "No vendor"}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {format(new Date(expense.created_date), "dd/MM/yyyy")}
                    </Typography>
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
                ? `${getCategoryLabel(expense.expense_category)} - ${expense.vendor_name || "No vendor"} - ${format(new Date(expense.created_date), "dd/MM/yyyy")}`
                : undefined
            }
            isFavorite={favorites.includes(expense.id)}
            onToggleFavorite={(e) => toggleFavorite(expense.id, e)}
            statusChip={
              !isSelected
                ? {
                    label: expense.status.charAt(0).toUpperCase() + expense.status.slice(1),
                    color: getStatusProps(expense.status, "expenseStatus").color,
                  }
                : undefined
            }
          />
        );
      }}
    />
  );

  // ─── Detail Panel ──────────────────────────────────────────────────────────

  const detail = expenseDetail || selectedExpense;

  // Workflow action buttons based on status
  const getWorkflowActions = () => {
    if (!selectedExpense || isCreating || isEditing) return null;

    const actions: React.ReactNode[] = [];

    if (selectedExpense.status === "pending") {
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
    } else if (selectedExpense.status === "submitted") {
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
    } else if (selectedExpense.status === "approved") {
      actions.push(
        <Button
          key="payment"
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
      );
    } else if (selectedExpense.status === "paid") {
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
    } else if (selectedExpense.status === "rejected") {
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

  const canEdit = selectedExpense && (selectedExpense.status === "pending" || selectedExpense.status === "rejected");
  const canDelete = selectedExpense && selectedExpense.status === "pending" ? true : false;

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
        isFavorite={selectedExpense ? favorites.includes(selectedExpense.id) : false}
        onToggleFavorite={selectedExpense ? (e) => toggleFavorite(selectedExpense.id, e) : undefined}
      />

      <ActionToolbar
        hasSelectedItem={!!selectedExpense}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={isFormValid}
        onNew={handleNewExpense}
        onSave={handleSave}
        onCancel={() => handleCancel(filteredExpenses)}
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
            <Button
              variant="outlined"
              size="small"
              onClick={handleExportCSV}
              disabled={!filteredExpenses.length}
            >
              Export CSV
            </Button>
          </>
        }
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedExpense && !isCreating ? (
          <EmptyState message="Select an expense from the list or create a new one" />
        ) : (
          <>
            {/* Stepper for create mode */}
            {isCreating && (
              <Stepper activeStep={formStep} sx={{ mb: 3 }}>
                {FORM_STEPS.map((label) => (
                  <Step key={label}>
                    <StepLabel>{label}</StepLabel>
                  </Step>
                ))}
              </Stepper>
            )}

            {/* Rejection Warning */}
            {detail && detail.status === "rejected" && detail.rejection_reason && (
              <Alert severity="error" sx={{ mb: 2 }}>
                <strong>Rejected:</strong> {detail.rejection_reason}
              </Alert>
            )}

            {/* Step 1: Expense Information (always show in view/edit mode) */}
            {(formStep === 0 || !isCreating) && (
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

                  <TextField
                    label="Expense Method"
                    size="small"
                    select
                    value={formData.expenses_method || "other_expenses"}
                    onChange={(e) => setFormData({ ...formData, expenses_method: e.target.value })}
                    disabled={!isEditing && !isCreating}
                    required
                  >
                    {EXPENSES_METHOD.map((method) => (
                      <MenuItem key={method.value} value={method.value}>
                        {method.label}
                      </MenuItem>
                    ))}
                  </TextField>

                  <TextField
                    label="Amount (Rs.)"
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
                    <FormSection title="Status & Dates" columns={3}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 1 }}>
                        <Typography variant="body2" color="text.secondary">
                          Status:
                        </Typography>
                        <TStatusChip status={detail.status} statusMap="expenseStatus" />
                      </Box>
                      <TextField
                        label="Created Date"
                        size="small"
                        value={
                          detail.created_date
                            ? format(new Date(detail.created_date), "dd MMM yyyy")
                            : "N/A"
                        }
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
                              ? format(new Date(detail.approved_date), "dd MMM yyyy HH:mm")
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
                  </>
                )}

                <FormSection title="Remarks" columns={1}>
                  <TextField
                    label="Remarks"
                    size="small"
                    value={formData.remarks || ""}
                    onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
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

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <MasterDetailLayout
        title="Expenses"
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ["expenses"] });
          queryClient.invalidateQueries({ queryKey: ["expense-detail"] });
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
    </>
  );
}
