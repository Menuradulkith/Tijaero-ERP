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
import StarIcon from "@mui/icons-material/Star";
import StarOutlineIcon from "@mui/icons-material/StarBorder";
import UndoIcon from "@mui/icons-material/Undo";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
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
import ClearIcon from "@mui/icons-material/Clear";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDateTimeReadable } from "@/utils/formatters";

import {
  ActionToolbar,
  canPrintDocument,
  DetailPanelHeader,
  EmptyState,
  fmtLKR,
  FormSection,
  handleApiError,
  MasterDetailLayout,
  SelectableListItem,
  showErrorToast,
  showSuccessToast,
  TPrintButton,
  TPrintPreviewDialog,
  TSearchableSelect,
  TExportButton,
  useMasterDetailState,
  modernTableStyles,
  TConfirmDialog,
  useConfirmDialog,
  useCrudMutation,
  TActivityHistoryPanel,
  TDataGrid,
  type TDataGridColumn,
} from "@/components/tijaero";

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

  // Filter states (applied - drives the actual list filtering)
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterStatus(null);
    setFilterType(null);
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
    favorites,
    toggleFavorite,
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
    extraDirty: lineItems.length > 0,
    onDiscard: () => { setLineItems([]); },
  });

  // Activity History is opened on demand from a detail icon next to the
  // Activity History section title, rather than shown inline.
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);

  const handleNew = useCallback(() => {
    handleNewBase();
    setFormStep(0);
    setLineItems([
      { _id: `new-1`, line_number: 1, account_id: 0, debit_amount: 0, credit_amount: 0, description: "" },
      { _id: `new-2`, line_number: 2, account_id: 0, debit_amount: 0, credit_amount: 0, description: "" },
    ]);
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

  // ─── Browse Table ──────────────────────────────────────────────────────────

  // The table sorts by whichever column the user clicks via the grid's own
  // column header menu, not a separate "Sort by" control.
  const jeColumns: TDataGridColumn<JournalEntry>[] = useMemo(
    () => [
      {
        field: "favorite",
        header: "",
        width: 48,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<JournalEntry>) => (
          <IconButton size="small" onClick={(e) => toggleFavorite(params.row.id, e)}>
            {favorites.includes(params.row.id) ? (
              <StarIcon fontSize="small" color="warning" />
            ) : (
              <StarOutlineIcon fontSize="small" color="action" />
            )}
          </IconButton>
        ),
      },
      { field: "journal_entry_no", header: "JE No", flex: 1, minWidth: 140 },
      {
        field: "entry_date",
        header: "Date",
        width: 120,
        renderCell: (params: GridRenderCellParams<JournalEntry>) =>
          params.row.entry_date ? format(new Date(params.row.entry_date), "dd/MM/yyyy") : "-",
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
          <Chip
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
    [favorites, toggleFavorite, handleSelectJE]
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

  // Detail mode: a narrow left panel showing only the current journal entry
  // (or the "New Entry" placeholder while creating). A "Back to Journal
  // Entries" link returns to the table.
  const singleJEPanel = (
    <Paper
      elevation={0}
      sx={{
        width: 280,
        minWidth: 240,
        maxWidth: 300,
        borderRight: 1,
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <Box sx={{ p: 1, borderBottom: 1, borderColor: "divider" }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon fontSize="small" />}
          onClick={handleBackToJournalEntries}
          sx={{ textTransform: "none" }}
        >
          Back to Journal Entries
        </Button>
      </Box>
      {isCreating ? (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ bgcolor: "action.disabledBackground", color: "text.secondary" }}>
              <ReceiptLongIcon />
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              New Entry
            </Typography>
          </Box>
        </Box>
      ) : selectedJE && (
        <SelectableListItem
          id={selectedJE.id}
          isSelected
          onClick={() => {}}
          primaryText={
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
              <Avatar sx={{ bgcolor: "action.disabledBackground", color: "text.secondary" }}>
                <ReceiptLongIcon />
              </Avatar>
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0 }}>
                <span>{selectedJE.journal_entry_no}</span>
              </Box>
            </Box>
          }
          isFavorite={favorites.includes(selectedJE.id)}
          onToggleFavorite={(e) => toggleFavorite(selectedJE.id, e)}
        />
      )}
    </Paper>
  );

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
                <Paper variant="outlined" sx={{ width: "100%", overflow: "hidden", borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
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
          isJEDetailMode ? undefined : (
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
            {(searchQuery || filterStatus || filterType) && (
              <Tooltip title="Clear filters">
                <IconButton size="small" onClick={handleClearFilters}>
                  <ClearIcon fontSize="small" />
                </IconButton>
              </Tooltip>
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
              <TExportButton
                filename={`journal_entries_${new Date().toISOString().split("T")[0]}`}
                headers={["JE No", "Date", "Description", "Total Debit", "Total Credit", "Status", "Reversed", "Branch"]}
                rows={() =>
                  filteredEntries.map((e) => [
                    e.journal_entry_no || "",
                    e.entry_date || "",
                    e.description || "",
                    Number(e.total_debit || 0),
                    Number(e.total_credit || 0),
                    e.status || "",
                    e.is_reversed ? "Yes" : "No",
                    e.branch_code || "",
                  ])
                }
                disabled={filteredEntries.length === 0}
              />
            </>
          )
        }
        {...(isJEDetailMode
          ? { masterPanel: singleJEPanel, detailPanel }
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
