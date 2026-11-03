/**
 * JournalEntriesPage - Journal Entry Management
 *
 * Create, view, post, and reverse journal entries with line items.
 * Follows the same UI pattern as PurchaseOrdersPage / SalesPage.
 * Uses ActionToolbar with inline editing, TFilterPanel, expanded list items.
 */

import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import HistoryIcon from "@mui/icons-material/History";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import UndoIcon from "@mui/icons-material/Undo";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import {
  Alert,
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
  Step,
  StepLabel,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDateTimeReadable } from "@/utils/formatters";

import {
  TChip,
  ActionToolbar,
  canPrintDocument,
  DetailPanelHeader,
  EmptyState,
  fmtLKR,
  FormSection,
  handleApiError,
  MasterDetailLayout,
  showErrorToast,
  showSuccessToast,
  showWarningToast,
  TPrintButton,
  TPrintPreviewDialog,
  TSearchableSelect,
  useMasterDetailState,
  modernTableStyles,
  TConfirmDialog,
  useConfirmDialog,
  useCrudMutation,
  TActivityHistoryPanel,
  TDataGrid,
  type TDataGridColumn,
} from "@/components/tijaero";

import { journalEntriesApi, chartOfAccountsApi, voucherTypesApi } from "@/modules/finance/api";
import { costCentersApi } from "@/modules/finance/api/costCenters";
import { submitOnce } from "@/modules/finance/submitOnce";
import type {
  JournalEntry,
  JournalEntryStatus,
  JournalEntryType,
} from "@/modules/finance/types";

import CancelIcon from "@mui/icons-material/Cancel";
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
  auto_reverse_date?: string;
}

interface LineItem {
  _id: string;
  line_number: number;
  account_id: number;
  /** Kept as typed text (at most 2 decimals, never negative). */
  debit_amount: string;
  credit_amount: string;
  description: string;
  cost_center_id?: number | null;
}

/** Amount in cents, so totals and the balance check never drift on floats. */
const toCents = (v: string) => Math.round((Number(v) || 0) * 100);
/** What an amount field may hold while typing: digits, one dot, 2 decimals. */
const AMOUNT_PATTERN = /^\d{0,12}(\.\d{0,2})?$/;

const newLine = (id: string, n: number): LineItem => ({
  _id: id,
  line_number: n,
  account_id: 0,
  debit_amount: "",
  credit_amount: "",
  description: "",
});

/** Per-line problem that blocks saving, or null. */
const lineProblem = (l: LineItem): string | null => {
  const dr = toCents(l.debit_amount);
  const cr = toCents(l.credit_amount);
  if (!l.account_id) return "Select an account";
  if (dr === 0 && cr === 0) return "Enter a debit or a credit amount";
  if (dr > 0 && cr > 0) return "Enter either a debit or a credit, not both";
  return null;
};

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
  // Field errors show only after the user tried Next/Save.
  const [showErrors, setShowErrors] = useState(false);

  // Filter states (applied - drives the actual list filtering)
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [filterVoucher, setFilterVoucher] = useState<string | null>(null);

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterStatus(null);
    setFilterType(null);
    setFilterVoucher(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    defaultSortField: "entry_date",
    confirmUnsavedChanges: () =>
      confirmDialog.confirm({
        title: "Discard Changes",
        message: "You have unsaved changes. Discard them?",
        confirmText: "Discard",
        cancelText: "Keep Editing",
        confirmColor: "warning",
      }),
    extraDirty: lineItems.length > 0,
    onDiscard: () => { setLineItems([]); },
  });

  // Activity History is opened on demand from a detail icon next to the
  // Activity History section title, rather than shown inline.
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);

  const handleNew = useCallback(() => {
    handleNewBase();
    setFormStep(0);
    setShowErrors(false);
    setLineItems([newLine("new-1", 1), newLine("new-2", 2)]);
  }, [handleNewBase]);

  // Cancelling out of "New Entry" should return to the browse table, not
  // auto-open the first entry the way useMasterDetailState's generic
  // handleCancel does (that behavior made sense for the old always-visible
  // detail panel, but not here). Cancelling out of an existing entry never
  // reaches here since JEs can't be edited after creation (canEdit is false).
  const handleCancel = useCallback(
    (items: JournalEntry[]) => {
      if (isCreating) {
        setIsCreating(false);
        setIsEditing(false);
        setSelectedJE(null);
      } else {
        handleCancelBase(items);
      }
      setLineItems([]);
      setFormStep(0);
    },
    [isCreating, handleCancelBase, setIsCreating, setIsEditing, setSelectedJE]
  );

  // Returns to the browse table from the detail view.
  const handleBackToJournalEntries = useCallback(() => {
    setSelectedJE(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
    setLineItems([]);
    setFormStep(0);
  }, [isCreating, setSelectedJE, setIsCreating, setIsEditing]);

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const { data: entriesData, isLoading } = useQuery({
    queryKey: ["journal-entries", filterStatus, filterType, filterVoucher],
    queryFn: () =>
      journalEntriesApi.getAll({
        status: filterStatus ?? undefined,
        entry_type: filterType ?? undefined,
        voucher_type: filterVoucher ?? undefined,
        limit: 500,
      }),
  });
  const entries = entriesData?.items ?? [];

  const { data: voucherTypes = [] } = useQuery({
    queryKey: ["voucher-types"],
    queryFn: voucherTypesApi.getAll,
    staleTime: 5 * 60 * 1000,
  });
  const voucherName = useCallback(
    (code?: string | null) => voucherTypes.find((v) => v.code === code)?.name ?? code ?? "-",
    [voucherTypes]
  );

  const { data: costCenters = [] } = useQuery({
    queryKey: ["cost-centers", "active"],
    queryFn: () => costCentersApi.getAll({ active_only: true }),
    staleTime: 5 * 60 * 1000,
  });

  // All accounts (inactive too) so a header account is recognised even when
  // its only sub-accounts are inactive: the backend rejects any account that
  // has children.
  const { data: accounts = [] } = useQuery({
    queryKey: ["chart-of-accounts-all", "with-inactive"],
    queryFn: () => chartOfAccountsApi.getAll({ limit: 1000 }),
  });
  // Only postable accounts: active and not a header (an account with children).
  const postableAccounts = useMemo(() => {
    const parents = new Set(accounts.map((a) => a.parent_account_id).filter(Boolean));
    return accounts.filter((a) => a.is_active && !parents.has(a.id));
  }, [accounts]);

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
    // Default order before the user sorts a column in the table itself (the
    // table's own column-header sort takes over from there) — newest first.
    filtered.sort((a, b) => {
      const timeDiff = new Date(b.entry_date || "").getTime() - new Date(a.entry_date || "").getTime();
      return timeDiff !== 0 ? timeDiff : (b.id || 0) - (a.id || 0);
    });
    return filtered;
  }, [entries, searchQuery]);

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useCrudMutation({
    mutationFn: journalEntriesApi.create,
    invalidateQueryKeys: [["journal-entries"], ["journal-entry-detail"]],
    successMessage: "Journal entry created",
    errorMessage: "Failed to create journal entry",
    onSuccess: (data) => {
      setIsCreating(false);
      setIsEditing(false);
      setLineItems([]);
      setFormStep(0);
      setTimeout(() => handleSelectJE(data), 0);
    },
  });

  const postMutation = useCrudMutation({
    mutationFn: (id: number) => journalEntriesApi.post(id),
    invalidateQueryKeys: [["journal-entries"], ["journal-entry-detail"]],
    successMessage: "Journal entry posted to General Ledger",
    errorMessage: "Failed to post journal entry",
    onSuccess: (data) => {
      setSelectedJE(data);
    },
  });

  const reverseMutation = useCrudMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      journalEntriesApi.reverse(id, reason),
    invalidateQueryKeys: [["journal-entries"], ["journal-entry-detail"]],
    successMessage: "Journal entry reversed",
    errorMessage: "Failed to reverse journal entry",
    onSuccess: (data) => {
      setReverseDialogOpen(false);
      setReverseReason("");
      setSelectedJE(data);
    },
  });

  const deleteMutation = useCrudMutation({
    mutationFn: journalEntriesApi.delete,
    invalidateQueryKeys: [["journal-entries"], ["journal-entry-detail"]],
    successMessage: "Journal entry deleted",
    errorMessage: "Failed to delete journal entry",
    onSuccess: () => {
      setSelectedJE(null);
    },
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
    // Say exactly what is wrong (and where) instead of a generic message.
    const headerError = !formData.entry_date
      ? "Entry date is required"
      : !formData.description.trim()
        ? "Description is required"
        : null;
    if (headerError) {
      setShowErrors(true);
      setFormStep(0);
      showWarningToast(headerError);
      return;
    }
    const badLine = lineItems.findIndex((l) => lineProblem(l));
    if (badLine >= 0) {
      setShowErrors(true);
      setFormStep(1);
      showWarningToast(`Line ${badLine + 1}: ${lineProblem(lineItems[badLine])}`);
      return;
    }
    const dr = lineItems.reduce((s, l) => s + toCents(l.debit_amount), 0);
    const cr = lineItems.reduce((s, l) => s + toCents(l.credit_amount), 0);
    if (dr !== cr) {
      setFormStep(1);
      showWarningToast(`Debits and credits must be equal (difference ${fmtLKR(Math.abs(dr - cr) / 100)})`);
      return;
    }
    const lines = lineItems.map((l, i) => ({
      line_number: i + 1,
      account_id: l.account_id,
      debit_amount: toCents(l.debit_amount) / 100,
      credit_amount: toCents(l.credit_amount) / 100,
      description: l.description,
      cost_center_id: l.cost_center_id || null,
    }));
    // A double-click on Save must not create the journal twice.
    submitOnce("journal-entry-create", createMutation, {
      entry_date: formData.entry_date,
      description: formData.description.trim(),
      entry_type: formData.entry_type,
      auto_reverse_date: formData.auto_reverse_date || undefined,
      lines,
    });
  }, [isCreating, lineItems, formData, createMutation]);

  // Line item helpers
  const handleAddLine = () => {
    setLineItems([...lineItems, newLine(`new-${Date.now()}`, lineItems.length + 1)]);
  };

  const handleRemoveLine = (id: string) => {
    if (lineItems.length <= 2) return;
    setLineItems(lineItems.filter((l) => l._id !== id));
  };

  const handleUpdateLine = (id: string, field: keyof LineItem, value: any) => {
    setLineItems(lineItems.map((l) => (l._id === id ? { ...l, [field]: value } : l)));
  };

  // Totals are summed in cents from each line's 2-decimal amount.
  const debitCents = lineItems.reduce((sum, l) => sum + toCents(l.debit_amount), 0);
  const creditCents = lineItems.reduce((sum, l) => sum + toCents(l.credit_amount), 0);
  const totalDebit = debitCents / 100;
  const totalCredit = creditCents / 100;
  const isBalanced = debitCents === creditCents && debitCents > 0;
  const headerStepValid = !!formData.entry_date && !!formData.description.trim();
  const handleAmountChange = (id: string, field: "debit_amount" | "credit_amount", raw: string) => {
    const v = raw.replace(/,/g, "").trim();
    if (!AMOUNT_PATTERN.test(v)) return; // ignore negatives, letters, a 3rd decimal
    handleUpdateLine(id, field, v);
  };

  const canEdit = false; // JE cannot be edited after creation
  const canDelete = !!(selectedJE && selectedJE.status === "draft");
  // Save always runs handleSave, which names the actual problem field.
  const isFormValid = true;
  const isSaving = createMutation.isPending;

  const detail = jeDetail || selectedJE;

  // ─── Browse Table ──────────────────────────────────────────────────────────

  // The table sorts by whichever column the user clicks via the grid's own
  // column header menu, not a separate "Sort by" control.
  const jeColumns: TDataGridColumn<JournalEntry>[] = useMemo(
    () => [
      { field: "journal_entry_no", header: "JE No", flex: 1, minWidth: 140 },
      {
        field: "entry_date",
        header: "Date",
        width: 120,
        renderCell: (params: GridRenderCellParams<JournalEntry>) =>
          params.row.entry_date ? format(new Date(params.row.entry_date), "dd/MM/yyyy") : "-",
      },
      {
        field: "voucher_type",
        header: "Source",
        width: 150,
        renderCell: (params: GridRenderCellParams<JournalEntry>) =>
          params.row.voucher_type ? (
            <Tooltip title={params.row.voucher_type}>
              <span>{voucherName(params.row.voucher_type)}</span>
            </Tooltip>
          ) : (
            "-"
          ),
      },
      { field: "description", header: "Description", flex: 1.5, minWidth: 220 },
      {
        field: "total_debit",
        header: "Debit",
        width: 130,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<JournalEntry>) => fmtLKR(params.row.total_debit),
      },
      {
        field: "total_credit",
        header: "Credit",
        width: 130,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<JournalEntry>) => fmtLKR(params.row.total_credit),
      },
      {
        field: "status",
        header: "Status",
        width: 120,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<JournalEntry>) => (
          <TChip
            label={params.row.status.charAt(0).toUpperCase() + params.row.status.slice(1)}
            size="small"
            color={getStatusColor(params.row.status)}
          />
        ),
      },
      {
        field: "posted_by_name",
        header: "Posted By",
        width: 150,
        renderCell: (params: GridRenderCellParams<JournalEntry>) => params.row.posted_by_name || "-",
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<JournalEntry>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectJE(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [handleSelectJE, voucherName]
  );

  // Whether we're showing a single journal entry's detail view (selected or
  // being created) instead of the browse table.
  const isJEDetailMode = !!selectedJE || isCreating;

  // Browse mode: a full-width table of every journal entry.
  const jeTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<JournalEntry>
          rows={filteredEntries}
          columns={jeColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectJE(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No journal entries found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
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
        onSave={isCreating && formStep < FORM_STEPS.length - 1 ? undefined : handleSave}
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
                  disabled={postMutation.isPending}
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
                disabled={!canPrintDocument(detail.status, ["cancelled", "rejected", "voided"])}
                disabledReason={`Cannot print: journal entry is ${(detail.status || "").replace(/_/g, " ")}`}
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
                  error={showErrors && !formData.entry_date}
                  helperText={showErrors && !formData.entry_date ? "Entry date is required" : undefined}
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
                  label="Reverse on (optional)"
                  type="date"
                  size="small"
                  value={formData.auto_reverse_date || ""}
                  onChange={(e) => setFormData({ ...formData, auto_reverse_date: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                  helperText="For accruals: a reversal is posted on this date together with the entry"
                />
                <TextField
                  label="Description"
                  size="small"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  required
                  error={showErrors && !formData.description.trim()}
                  helperText={showErrors && !formData.description.trim() ? "Description is required" : undefined}
                  multiline
                  rows={2}
                />
              </FormSection>
            )}

            {formStep === 1 && (
              <FormSection title="Line Items" columns={1}>
                {/* Scrolls sideways on narrow screens so Debit/Credit stay reachable. */}
                <Paper variant="outlined" sx={{ width: "100%", overflowX: "auto", borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
                  <Table size="small" sx={{ minWidth: costCenters.length > 0 ? 860 : 680 }}>
                    <TableHead>
                      <TableRow sx={modernTableStyles.headerRow}>
                        <TableCell sx={{ width: 40 }}>#</TableCell>
                        <TableCell sx={{ minWidth: 220 }}>Account</TableCell>
                        {costCenters.length > 0 && <TableCell sx={{ width: 170 }}>Cost center</TableCell>}
                        <TableCell>Description</TableCell>
                        <TableCell sx={{ width: 130 }}>Debit</TableCell>
                        <TableCell sx={{ width: 130 }}>Credit</TableCell>
                        <TableCell sx={{ width: 40 }} />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {lineItems.map((line, index) => {
                        const problem = showErrors ? lineProblem(line) : null;
                        const accountMissing = !!problem && !line.account_id;
                        const amountProblem = !!problem && !accountMissing;
                        return (
                        <TableRow key={line._id} sx={modernTableStyles.bodyRow}>
                          <TableCell>{index + 1}</TableCell>
                          <TableCell>
                            <TextField
                              select
                              size="small"
                              fullWidth
                              value={line.account_id || ""}
                              onChange={(e) => handleUpdateLine(line._id, "account_id", Number(e.target.value))}
                              error={accountMissing}
                              helperText={accountMissing ? problem : undefined}
                            >
                              <MenuItem value="">Select account</MenuItem>
                              {postableAccounts.map((a) => (
                                <MenuItem key={a.id} value={a.id}>
                                  {a.account_code} - {a.account_name}
                                </MenuItem>
                              ))}
                            </TextField>
                          </TableCell>
                          {costCenters.length > 0 && (() => {
                            const acc = accounts.find((a) => a.id === line.account_id);
                            const isPL = acc?.account_type === "Revenue" || acc?.account_type === "Expense";
                            return (
                              <TableCell>
                                <TextField
                                  select
                                  size="small"
                                  fullWidth
                                  disabled={!isPL}

                                  value={isPL ? line.cost_center_id || "" : ""}
                                  onChange={(e) => handleUpdateLine(line._id, "cost_center_id", e.target.value ? Number(e.target.value) : null)}
                                  title={isPL ? "" : "Only income and expense lines take a cost center"}
                                >
                                  <MenuItem value="">{isPL ? "Branch default" : "—"}</MenuItem>
                                  {costCenters.map((c) => (
                                    <MenuItem key={c.id} value={c.id}>
                                      {c.code} - {c.name}
                                    </MenuItem>
                                  ))}
                                </TextField>
                              </TableCell>
                            );
                          })()}
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
                              size="small"
                              fullWidth
                              value={line.debit_amount}
                              onChange={(e) => handleAmountChange(line._id, "debit_amount", e.target.value)}
                              inputProps={{ inputMode: "decimal", "aria-label": "Debit" }}
                              placeholder="0.00"
                              error={amountProblem}
                              helperText={amountProblem ? problem : undefined}
                            />
                          </TableCell>
                          <TableCell>
                            <TextField
                              size="small"
                              fullWidth
                              value={line.credit_amount}
                              onChange={(e) => handleAmountChange(line._id, "credit_amount", e.target.value)}
                              inputProps={{ inputMode: "decimal", "aria-label": "Credit" }}
                              placeholder="0.00"
                              error={amountProblem}
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
                        );
                      })}
                      <TableRow sx={modernTableStyles.footerRow}>
                        <TableCell colSpan={costCenters.length > 0 ? 4 : 3} sx={{ fontWeight: 700 }}>Total</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>{fmtLKR(totalDebit)}</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>{fmtLKR(totalCredit)}</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                </Paper>

                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1, mt: 1 }}>
                  <Button
                    size="small"
                    startIcon={<AddCircleOutlineIcon />}
                    onClick={handleAddLine}
                  >
                    Add Line
                  </Button>
                  {!isBalanced && (debitCents > 0 || creditCents > 0) && (
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
                onClick={() => {
                  if (formStep >= FORM_STEPS.length - 1) return;
                  if (!headerStepValid) {
                    // Stay on the step and point at the field that is missing.
                    setShowErrors(true);
                    showWarningToast(!formData.entry_date ? "Entry date is required" : "Description is required");
                    return;
                  }
                  setFormStep((s) => s + 1);
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
              <TextField label="Source" size="small" value={voucherName(detail.voucher_type)} disabled />
              {detail.auto_reverse_date && (
                <TextField label="Reverses on" size="small" value={detail.auto_reverse_date} disabled />
              )}
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
              <Paper variant="outlined" sx={{ width: "100%", overflow: "hidden", borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
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

            {/* Activity History */}
            <FormSection
              title="Activity History"
              columns={2}
              titleAction={
                <Tooltip title="View activity history">
                  <IconButton size="small" onClick={() => setActivityHistoryOpen(true)}>
                    <HistoryIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              }
            >
              <Box>
                <Typography variant="caption" color="text.secondary">Created By</Typography>
                <Typography variant="body2">
                  {detail.created_by_name || "-"}
                  {detail.created_at ? ` on ${formatDateTimeReadable(detail.created_at)}` : ""}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Last Modified</Typography>
                <Typography variant="body2">{formatDateTimeReadable(detail.updated_at) || "-"}</Typography>
              </Box>
              {detail.submitted_by_name && (
                <Box>
                  <Typography variant="caption" color="text.secondary">Submitted By</Typography>
                  <Typography variant="body2">{detail.submitted_by_name}</Typography>
                </Box>
              )}
              {detail.approved_by_name && (
                <Box>
                  <Typography variant="caption" color="text.secondary">Approved By</Typography>
                  <Typography variant="body2">{detail.approved_by_name}</Typography>
                </Box>
              )}
              {detail.posted_by_name && (
                <Box>
                  <Typography variant="caption" color="text.secondary">Posted By</Typography>
                  <Typography variant="body2">{detail.posted_by_name}</Typography>
                </Box>
              )}
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
        titleSlot={
          isJEDetailMode ? (
          <Button
            size="small"
            startIcon={<ArrowBackIcon fontSize="small" />}
            onClick={handleBackToJournalEntries}
            sx={{ textTransform: "none" }}
          >
            Back to Journal Entries
          </Button>
          ) : (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <TextField
              size="small"
              placeholder="Search entry no or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              }}
              sx={{ width: 240, flexShrink: 0 }}
            />
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
                fullWidth
              />
            </Box>
            <Box sx={{ width: 170, flexShrink: 0 }}>
              <TSearchableSelect
                label=""
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
                size="small"
                fullWidth
              />
            </Box>
            <Box sx={{ width: 190, flexShrink: 0 }}>
              <TSearchableSelect
                label=""
                value={filterVoucher}
                onChange={(val) => setFilterVoucher(val as string | null)}
                options={voucherTypes.map((v) => ({ value: v.code, label: v.name }))}
                showAllOption
                allOptionLabel="All Sources"
                placeholder="Search sources..."
                size="small"
                fullWidth
              />
            </Box>
            {(searchQuery || filterStatus || filterType || filterVoucher) && (
              <Button size="small" onClick={handleClearFilters} sx={{ textTransform: "none" }}>
                Clear
              </Button>
            )}
          </Box>
          )
        }
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ["journal-entries"] });
          queryClient.invalidateQueries({ queryKey: ["chart-of-accounts-all"] });
          queryClient.invalidateQueries({ queryKey: ["journal-entry-detail"] });
        }}
        isLoading={isLoading}
        headerActions={
          isJEDetailMode ? undefined : (
            <>
              <Button
                variant="contained"
                size="small"
                startIcon={<AddIcon />}
                onClick={handleNew}
                sx={{ mr: 1 }}
              >
                Add Journal Entry
              </Button>
            </>
          )
        }
        {...(isJEDetailMode
          ? { children: detailPanel }
          : { children: jeTablePanel })}
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
          <Button variant="contained" color="error" startIcon={<CancelIcon />} onClick={() => setReverseDialogOpen(false)}>Cancel</Button>
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

      <TConfirmDialog {...confirmDialog.dialogProps} />

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

      <TActivityHistoryPanel
        open={activityHistoryOpen}
        onClose={() => setActivityHistoryOpen(false)}
        entityType="journal_entry"
        entityId={selectedJE?.id}
        actionLabels={{
          create: "Journal entry created",
          update: "Journal entry updated",
          submit: "Journal entry submitted",
          approve: "Journal entry approved",
          reject: "Journal entry rejected",
          post: "Journal entry posted",
          reverse: "Journal entry reversed",
          delete: "Journal entry deleted",
        }}
      />
    </>
  );
}
