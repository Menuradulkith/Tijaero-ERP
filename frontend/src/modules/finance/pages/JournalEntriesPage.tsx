/**
 * JournalEntriesPage - Journal Entry Management
 *
 * Create, view, post, and reverse journal entries with line items.
 * Follows the same UI pattern as PurchaseOrdersPage / SalesPage.
 * Uses ActionToolbar with inline editing, TFilterPanel, expanded list items.
 */

import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import UndoIcon from "@mui/icons-material/Undo";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Paper,
  Step,
  StepLabel,
  Stepper,
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
  ActionToolbar,
  canPrintDocument,
  DetailPanelHeader,
  EmptyState,
  fmtLKR,
  FormSection,
  handleApiError,
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  showErrorToast,
  showSuccessToast,
  TFilterPanel,
  TPrintButton,
  TPrintPreviewDialog,
  TSearchableSelect,
  type SortOption,
  useMasterDetailState,
  modernTableStyles,
} from "@/components/tijaero";
import { ConfirmDialog, useConfirmDialog } from "@/components/ConfirmDialog";

import { journalEntriesApi, chartOfAccountsApi } from "@/modules/finance/api";
import type {
  JournalEntry,
  JournalEntryStatus,
  JournalEntryType,
} from "@/modules/finance/types";

// ─── Configuration ───────────────────────────────────────────────────────────

const STATUS_FILTER_OPTIONS = [
  { value: "draft", label: "Draft", color: "default" as const },
  { value: "posted", label: "Posted", color: "success" as const },
  { value: "reversed", label: "Reversed", color: "error" as const },
];

const ENTRY_TYPES: { value: JournalEntryType; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "adjusting", label: "Adjusting" },
  { value: "closing", label: "Closing" },
  { value: "reversing", label: "Reversing" },
  { value: "opening", label: "Opening" },
  { value: "recurring", label: "Recurring" },
];

const TYPE_FILTER_OPTIONS = ENTRY_TYPES.map((t) => ({
  value: t.value,
  label: t.label,
  color: "info" as const,
}));

const SORT_OPTIONS: SortOption[] = [
  { value: "entry_date", label: "Entry Date" },
  { value: "journal_entry_no", label: "Entry No" },
  { value: "total_debit", label: "Amount" },
];

const FORM_STEPS = ["Entry Information", "Line Items"];

const getStatusColor = (status: JournalEntryStatus) => {
  switch (status) {
    case "draft": return "default" as const;
    case "posted": return "success" as const;
    case "reversed": return "error" as const;
    default: return "default" as const;
  }
};

// ─── Form Data ───────────────────────────────────────────────────────────────

interface JEFormData {
  entry_date: string;
  description: string;
  entry_type: JournalEntryType;
}

interface LineItem {
  _id: string;
  line_number: number;
  account_id: number;
  debit_amount: number;
  credit_amount: number;
  description: string;
}

const INITIAL_FORM_DATA: JEFormData = {
  entry_date: new Date().toISOString().split("T")[0],
  description: "",
  entry_type: "standard",
};

const resetFormFromJE = (je: JournalEntry): JEFormData => ({
  entry_date: je.entry_date?.split("T")[0] || "",
  description: je.description || "",
  entry_type: je.entry_type || "standard",
});

// ─── Component ───────────────────────────────────────────────────────────────

export default function JournalEntriesPage() {
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();
  const [formStep, setFormStep] = useState(0);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);

  // Filter states
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);

  // Reverse dialog
  const [reverseDialogOpen, setReverseDialogOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState("");

  // Print dialog
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [selectedJEForPrint, setSelectedJEForPrint] = useState<JournalEntry | null>(null);

  // ─── Master-Detail State ───────────────────────────────────────────────────

  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem: selectedJE,
    setSelectedItem: setSelectedJE,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    formData,
    setFormData,
    handleSelectItem: handleSelectJE,
    handleNew: handleNewBase,
    handleCancel: handleCancelBase,
    handleStartEdit,
  } = useMasterDetailState<JournalEntry, JEFormData>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromJE,
    favoritesKey: "journal_entries_favorites",
    defaultSortField: "entry_date",
    confirmUnsavedChanges: () =>
      confirmDialog.confirm({
        title: "Discard Changes",
        message: "You have unsaved changes. Discard them?",
        confirmText: "Discard",
        cancelText: "Keep Editing",
        confirmColor: "warning",
      }),
  });

  const handleNew = useCallback(() => {
    handleNewBase();
    setFormStep(0);
    setLineItems([
      { _id: `new-1`, line_number: 1, account_id: 0, debit_amount: 0, credit_amount: 0, description: "" },
      { _id: `new-2`, line_number: 2, account_id: 0, debit_amount: 0, credit_amount: 0, description: "" },
    ]);
  }, [handleNewBase]);

  const handleCancel = useCallback(
    (items: JournalEntry[]) => {
      handleCancelBase(items);
      setLineItems([]);
      setFormStep(0);
    },
    [handleCancelBase]
  );

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const { data: entriesData, isLoading, refetch } = useQuery({
    queryKey: ["journal-entries", filterStatus, filterType],
    queryFn: () =>
      journalEntriesApi.getAll({
        status: filterStatus ?? undefined,
        entry_type: filterType ?? undefined,
        limit: 500,
      }),
  });
  const entries = entriesData?.items ?? [];

  const { data: accounts = [] } = useQuery({
    queryKey: ["chart-of-accounts-all"],
    queryFn: () => chartOfAccountsApi.getAll({ is_active: true, limit: 1000 }),
  });

  // Fetch detail when selected
  const { data: jeDetail } = useQuery({
    queryKey: ["journal-entry-detail", selectedJE?.id],
    queryFn: () =>
      selectedJE ? journalEntriesApi.getById(selectedJE.id) : Promise.resolve(null),
    enabled: !!selectedJE,
  });

  // ─── Filter & Sort ─────────────────────────────────────────────────────────

  const filteredEntries = useMemo(() => {
    let filtered = [...entries];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.journal_entry_no?.toLowerCase().includes(q) ||
          e.description?.toLowerCase().includes(q)
      );
    }
    filtered.sort((a, b) => {
      if (sortField === "total_debit")
        return Number(b.total_debit) - Number(a.total_debit);
      if (sortField === "journal_entry_no")
        return (b.journal_entry_no || "").localeCompare(a.journal_entry_no || "");
      return (
        new Date(b.entry_date || "").getTime() -
        new Date(a.entry_date || "").getTime()
      );
    });
    return filtered;
  }, [entries, searchQuery, sortField]);

  useEffect(() => {
    if (filteredEntries.length > 0 && !selectedJE && !isCreating) {
      handleSelectJE(filteredEntries[0]);
    }
  }, [filteredEntries, selectedJE, isCreating]);

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["journal-entries"] });
    queryClient.invalidateQueries({ queryKey: ["journal-entry-detail"] });
  };

  const createMutation = useMutation({
    mutationFn: journalEntriesApi.create,
    onSuccess: (data) => {
      invalidate();
      showSuccessToast("Journal entry created");
      setIsCreating(false);
      setIsEditing(false);
      setLineItems([]);
      setFormStep(0);
      setTimeout(() => handleSelectJE(data), 0);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to create journal entry")),
  });

  const postMutation = useMutation({
    mutationFn: (id: number) => journalEntriesApi.post(id),
    onSuccess: (data) => {
      invalidate();
      showSuccessToast("Journal entry posted to General Ledger");
      setSelectedJE(data);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to post journal entry")),
  });

  const reverseMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      journalEntriesApi.reverse(id, reason),
    onSuccess: (data) => {
      invalidate();
      showSuccessToast("Journal entry reversed");
      setReverseDialogOpen(false);
      setReverseReason("");
      setSelectedJE(data);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to reverse journal entry")),
  });

  const deleteMutation = useMutation({
    mutationFn: journalEntriesApi.delete,
    onSuccess: () => {
      invalidate();
      showSuccessToast("Journal entry deleted");
      setSelectedJE(null);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to delete journal entry")),
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handlePost = useCallback(async () => {
    if (!selectedJE) return;
    const confirmed = await confirmDialog.confirm({
      title: "Post Journal Entry",
      message: `Post "${selectedJE.journal_entry_no}" to the General Ledger? This action cannot be undone.`,
      confirmText: "Post to GL",
      confirmColor: "success",
    });
    if (confirmed) {
      postMutation.mutate(selectedJE.id);
    }
  }, [selectedJE, confirmDialog, postMutation]);

  const handleDelete = useCallback(async () => {
    if (!selectedJE || selectedJE.status !== "draft") return;
    const confirmed = await confirmDialog.confirm({
      title: "Delete Journal Entry",
      message: `Delete draft entry "${selectedJE.journal_entry_no}"?`,
      confirmText: "Delete",
      confirmColor: "error",
    });
    if (confirmed) {
      deleteMutation.mutate(selectedJE.id);
    }
  }, [selectedJE, confirmDialog, deleteMutation]);

  const handleSave = useCallback(async () => {
    if (!isCreating) return;
    const lines = lineItems.map((l, i) => ({
      line_number: i + 1,
      account_id: l.account_id,
      debit_amount: l.debit_amount,
      credit_amount: l.credit_amount,
      description: l.description,
    }));
    createMutation.mutate({
      entry_date: formData.entry_date,
      description: formData.description,
      entry_type: formData.entry_type,
      lines,
    });
  }, [isCreating, lineItems, formData, createMutation]);

  // Line item helpers
  const handleAddLine = () => {
    setLineItems([
      ...lineItems,
      {
        _id: `new-${Date.now()}`,
        line_number: lineItems.length + 1,
        account_id: 0,
        debit_amount: 0,
        credit_amount: 0,
        description: "",
      },
    ]);
  };

  const handleRemoveLine = (id: string) => {
    if (lineItems.length <= 2) return;
    setLineItems(lineItems.filter((l) => l._id !== id));
  };

  const handleUpdateLine = (id: string, field: keyof LineItem, value: any) => {
    setLineItems(lineItems.map((l) => (l._id === id ? { ...l, [field]: value } : l)));
  };

  const totalDebit = lineItems.reduce((sum, l) => sum + (Number(l.debit_amount) || 0), 0);
  const totalCredit = lineItems.reduce((sum, l) => sum + (Number(l.credit_amount) || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  const canEdit = false; // JE cannot be edited after creation
  const canDelete = !!(selectedJE && selectedJE.status === "draft");
  const isFormValid = !!(formData.entry_date && formData.description && isBalanced);
  const isSaving = createMutation.isPending;

  const detail = jeDetail || selectedJE;

  // ─── Master Panel ──────────────────────────────────────────────────────────

  const masterPanel = (
    <SearchableList<JournalEntry>
      items={filteredEntries}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search journal entries..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedJE}
      onSelectItem={handleSelectJE}
      emptyMessage="No journal entries found"
      listHeader={
        <TFilterPanel>
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
            label="Entry Type"
            value={filterType}
            onChange={(val) => setFilterType(val as string | null)}
            options={TYPE_FILTER_OPTIONS.map((t) => ({
              value: t.value,
              label: t.label,
              color: t.color,
            }))}
            showAllOption
            allOptionLabel="All Types"
            placeholder="Search types..."
          />
        </TFilterPanel>
      }
      renderItem={(je: JournalEntry, isSelected: boolean) => {
        const statusColor = getStatusColor(je.status);
        return (
          <SelectableListItem
            key={je.id}
            id={je.id}
            isSelected={isSelected}
            onClick={() => handleSelectJE(je)}
            primaryText={
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{je.journal_entry_no}</span>
                  {isSelected && (
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Entry No)
                    </Typography>
                  )}
                </Box>
                {isSelected && (
                  <>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {je.description?.substring(0, 50) || "No description"}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Description)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {format(new Date(je.entry_date), "dd/MM/yyyy")}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Date)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption" fontWeight={600}>
                        Rs. {fmtLKR(je.total_debit)}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Amount)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                      <Chip
                        label={je.status.charAt(0).toUpperCase() + je.status.slice(1)}
                        size="small"
                        color={statusColor}
                        sx={{ height: 18, fontSize: "0.65rem" }}
                      />
                      <Chip
                        label={je.entry_type}
                        size="small"
                        variant="outlined"
                        sx={{ height: 18, fontSize: "0.65rem" }}
                      />
                    </Box>
                  </>
                )}
              </Box>
            }
            secondaryText={
              !isSelected
                ? `${je.description?.substring(0, 40) || "No description"} - ${format(new Date(je.entry_date), "dd/MM/yyyy")}`
                : undefined
            }
            statusChip={!isSelected ? { label: je.status.charAt(0).toUpperCase() + je.status.slice(1), color: statusColor } : undefined}
          />
        );
      }}
    />
  );

  // ─── Detail Panel ──────────────────────────────────────────────────────────

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Finance", href: "/finance" },
          { label: "Journal Entries", href: "/finance/journal-entries" },
          ...(selectedJE || isCreating
            ? [{ label: isCreating ? "New Entry" : selectedJE?.journal_entry_no || "" }]
            : []),
        ]}
        title={selectedJE ? selectedJE.journal_entry_no : ""}
        titleIcon={<ReceiptLongIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Journal Entry"
        noSelectionTitle="Select a Journal Entry"
        chips={
          detail && !isCreating
            ? [
                { label: detail.status.charAt(0).toUpperCase() + detail.status.slice(1), color: getStatusColor(detail.status) },
                { label: detail.entry_type, color: "info" as const },
                ...(detail.is_reversed ? [{ label: "Reversed", color: "error" as const }] : []),
              ]
            : []
        }
      />

      <ActionToolbar
        hasSelectedItem={!!selectedJE}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={isFormValid}
        onNew={handleNew}
        onSave={handleSave}
        onCancel={() => handleCancel(filteredEntries)}
        onEdit={canEdit ? handleStartEdit : undefined}
        onDelete={canDelete ? handleDelete : undefined}
        canDelete={canDelete || false}
        endActions={
          detail && !isCreating && !isEditing ? (
            <Box sx={{ display: "flex", gap: 1 }}>
              {detail.status === "draft" && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<CheckCircleIcon />}
                  color="success"
                  onClick={handlePost}
                >
                  Post to GL
                </Button>
              )}
              {detail.status === "posted" && !detail.is_reversed && (
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<UndoIcon />}
                  color="warning"
                  onClick={() => setReverseDialogOpen(true)}
                >
                  Reverse
                </Button>
              )}
              <TPrintButton
                documentType="journal-entry"
                documentId={detail.id}
                disabled={!canPrintDocument(detail.status, [])}
                disabledReason="Cannot print this journal entry"
                tooltip="Print Journal Entry"
                onClick={() => {
                  setSelectedJEForPrint(selectedJE);
                  setPrintDialogOpen(true);
                }}
              />
            </Box>
          ) : undefined
        }
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedJE && !isCreating ? (
          <EmptyState message="Select a journal entry from the list or create a new one" />
        ) : isCreating ? (
          <>
            {/* Stepper for create mode */}
            <Stepper activeStep={formStep} sx={{ mb: 3 }}>
              {FORM_STEPS.map((label) => (
                <Step key={label}>
                  <StepLabel>{label}</StepLabel>
                </Step>
              ))}
            </Stepper>

            {formStep === 0 && (
              <FormSection title="Entry Information" columns={3}>
                <TextField
                  label="Entry Date"
                  type="date"
                  size="small"
                  value={formData.entry_date}
                  onChange={(e) => setFormData({ ...formData, entry_date: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                  required
                />
                <TextField
                  select
                  label="Entry Type"
                  size="small"
                  value={formData.entry_type}
                  onChange={(e) => setFormData({ ...formData, entry_type: e.target.value as JournalEntryType })}
                >
                  {ENTRY_TYPES.map((t) => (
                    <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Description"
                  size="small"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  required
                  multiline
                  rows={2}
                />
              </FormSection>
            )}

            {formStep === 1 && (
              <FormSection title="Line Items" columns={1}>
                <Paper variant="outlined" sx={{ width: "100%", overflow: "hidden", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={modernTableStyles.headerRow}>
                        <TableCell sx={{ width: 40 }}>#</TableCell>
                        <TableCell>Account</TableCell>
                        <TableCell>Description</TableCell>
                        <TableCell sx={{ width: 130 }}>Debit</TableCell>
                        <TableCell sx={{ width: 130 }}>Credit</TableCell>
                        <TableCell sx={{ width: 40 }} />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {lineItems.map((line, index) => (
                        <TableRow key={line._id} sx={modernTableStyles.bodyRow}>
                          <TableCell>{index + 1}</TableCell>
                          <TableCell>
                            <TextField
                              select
                              size="small"
                              fullWidth
                              value={line.account_id || ""}
                              onChange={(e) => handleUpdateLine(line._id, "account_id", Number(e.target.value))}
                            >
                              <MenuItem value="">Select account</MenuItem>
                              {accounts.map((a) => (
                                <MenuItem key={a.id} value={a.id}>
                                  {a.account_code} - {a.account_name}
                                </MenuItem>
                              ))}
                            </TextField>
                          </TableCell>
                          <TableCell>
                            <TextField
                              size="small"
                              fullWidth
                              value={line.description}
                              onChange={(e) => handleUpdateLine(line._id, "description", e.target.value)}
                              placeholder="Line description"
                            />
                          </TableCell>
                          <TableCell>
                            <TextField
                              type="number"
                              size="small"
                              fullWidth
                              value={line.debit_amount || ""}
                              onChange={(e) => handleUpdateLine(line._id, "debit_amount", Number(e.target.value))}
                              inputProps={{ min: 0, step: "0.01" }}
                            />
                          </TableCell>
                          <TableCell>
                            <TextField
                              type="number"
                              size="small"
                              fullWidth
                              value={line.credit_amount || ""}
                              onChange={(e) => handleUpdateLine(line._id, "credit_amount", Number(e.target.value))}
                              inputProps={{ min: 0, step: "0.01" }}
                            />
                          </TableCell>
                          <TableCell>
                            {lineItems.length > 2 && (
                              <IconButton size="small" color="error" onClick={() => handleRemoveLine(line._id)}>
                                <RemoveCircleOutlineIcon fontSize="small" />
                              </IconButton>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow sx={modernTableStyles.footerRow}>
                        <TableCell colSpan={3} sx={{ fontWeight: 700 }}>Total</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>{fmtLKR(totalDebit)}</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>{fmtLKR(totalCredit)}</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                </Paper>

                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mt: 1 }}>
                  <Button
                    size="small"
                    startIcon={<AddCircleOutlineIcon />}
                    onClick={handleAddLine}
                  >
                    Add Line
                  </Button>
                  {!isBalanced && totalDebit > 0 && (
                    <Alert severity="warning" sx={{ py: 0 }}>
                      Entry is not balanced. Difference: {fmtLKR(Math.abs(totalDebit - totalCredit))}
                    </Alert>
                  )}
                  {isBalanced && (
                    <Alert severity="success" sx={{ py: 0 }}>
                      Entry is balanced ✓
                    </Alert>
                  )}
                </Box>
              </FormSection>
            )}

            {/* Step Navigation */}
            <Box sx={{ display: "flex", justifyContent: "space-between", mt: 2, px: 1 }}>
              <Button
                disabled={formStep === 0}
                onClick={() => setFormStep((s) => s - 1)}
              >
                Back
              </Button>
              <Button
                variant="contained"
                disabled={formStep === FORM_STEPS.length - 1 ? false : !formData.description}
                onClick={() => {
                  if (formStep < FORM_STEPS.length - 1) {
                    setFormStep((s) => s + 1);
                  }
                }}
                sx={{ display: formStep === FORM_STEPS.length - 1 ? "none" : undefined }}
              >
                Next
              </Button>
            </Box>
          </>
        ) : detail ? (
          <>
            {/* View Mode - Entry Information */}
            <FormSection title="Entry Information" columns={3}>
              <TextField label="Entry No" size="small" value={detail.journal_entry_no} disabled />
              <TextField
                label="Entry Date"
                size="small"
                value={format(new Date(detail.entry_date), "dd/MM/yyyy")}
                disabled
              />
              <TextField label="Entry Type" size="small" value={detail.entry_type} disabled />
            </FormSection>

            <FormSection title="Details" columns={2}>
              <TextField
                label="Description"
                size="small"
                value={detail.description || "N/A"}
                disabled
                multiline
                rows={2}
              />
              {detail.fiscal_year && (
                <TextField
                  label="Fiscal Period"
                  size="small"
                  value={`FY ${detail.fiscal_year} - Period ${detail.fiscal_period}`}
                  disabled
                />
              )}
            </FormSection>

            {detail.posting_date && (
              <FormSection title="Posting Information" columns={2}>
                <TextField
                  label="Posting Date"
                  size="small"
                  value={format(new Date(detail.posting_date), "dd/MM/yyyy")}
                  disabled
                />
                {detail.reversed_je_no && (
                  <TextField
                    label="Reversed By"
                    size="small"
                    value={detail.reversed_je_no}
                    disabled
                  />
                )}
              </FormSection>
            )}

            {/* Line Items Table */}
            <FormSection title="Line Items" columns={1}>
              <Paper variant="outlined" sx={{ width: "100%", overflow: "hidden", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={modernTableStyles.headerRow}>
                      <TableCell>#</TableCell>
                      <TableCell>Account</TableCell>
                      <TableCell>Description</TableCell>
                      <TableCell align="right">Debit</TableCell>
                      <TableCell align="right">Credit</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {detail.lines?.map((line, index) => (
                      <TableRow key={line.id || line.line_number} sx={{ ...modernTableStyles.bodyRow, ...(index % 2 === 1 && { bgcolor: "grey.25" }) }}>
                        <TableCell>{line.line_number}</TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            {line.account_code} - {line.account_name}
                          </Typography>
                        </TableCell>
                        <TableCell>{line.description || "-"}</TableCell>
                        <TableCell align="right">
                          {Number(line.debit_amount) > 0 ? fmtLKR(line.debit_amount) : "-"}
                        </TableCell>
                        <TableCell align="right">
                          {Number(line.credit_amount) > 0 ? fmtLKR(line.credit_amount) : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow sx={modernTableStyles.footerRow}>
                      <TableCell colSpan={3} sx={{ fontWeight: 700 }}>Total</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>
                        {fmtLKR(detail.total_debit)}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>
                        {fmtLKR(detail.total_credit)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </Paper>
            </FormSection>
          </>
        ) : null}
      </Box>
    </Box>
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <MasterDetailLayout
        title="Journal Entries"
        icon={<ReceiptLongIcon color="primary" />}
        onRefresh={refetch}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />

      {/* Reverse Dialog */}
      <Dialog
        open={reverseDialogOpen}
        onClose={() => setReverseDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Reverse Journal Entry</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            This will create a new journal entry with reversed debits and credits.
          </Typography>
          <TextField
            label="Reason for Reversal"
            fullWidth
            size="small"
            multiline
            rows={3}
            value={reverseReason}
            onChange={(e) => setReverseReason(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReverseDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="warning"
            onClick={() => {
              if (selectedJE && reverseReason) {
                reverseMutation.mutate({ id: selectedJE.id, reason: reverseReason });
              }
            }}
            disabled={!reverseReason || reverseMutation.isPending}
          >
            Reverse
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog {...confirmDialog.dialogProps} />

      {/* Print Preview Dialog */}
      {selectedJEForPrint && (
        <TPrintPreviewDialog
          open={printDialogOpen}
          onClose={() => {
            setPrintDialogOpen(false);
            setSelectedJEForPrint(null);
          }}
          documentType="journal-entry"
          documentId={selectedJEForPrint.id}
          title={`Print Journal Entry: ${selectedJEForPrint.journal_entry_no}`}
        />
      )}
    </>
  );
}
