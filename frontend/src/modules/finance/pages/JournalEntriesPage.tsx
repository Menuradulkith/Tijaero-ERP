/**
 * JournalEntriesPage - Journal Entry Management
 *
 * Create, view, post, and reverse journal entries with line items.
 * Uses MasterDetailLayout with Tijaero components.
 */

import AddIcon from "@mui/icons-material/Add";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteIcon from "@mui/icons-material/Delete";
import UndoIcon from "@mui/icons-material/Undo";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
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
import { Controller, useFieldArray, useForm } from "react-hook-form";

import {
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
  TConfirmDialog,
  useTConfirmDialog,
  type SortOption,
} from "@/components/tijaero";

import { journalEntriesApi, chartOfAccountsApi } from "@/modules/finance/api";
import type {
  JournalEntry,
  JournalEntryCreate,
  JournalEntryStatus,
  JournalEntryType,
} from "@/modules/finance/types";

// ─── Configuration ───────────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: JournalEntryStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "posted", label: "Posted" },
  { value: "reversed", label: "Reversed" },
];

const ENTRY_TYPES: { value: JournalEntryType; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "adjusting", label: "Adjusting" },
  { value: "closing", label: "Closing" },
  { value: "reversing", label: "Reversing" },
  { value: "opening", label: "Opening" },
  { value: "recurring", label: "Recurring" },
];

const SORT_OPTIONS: SortOption[] = [
  { value: "entry_date", label: "Entry Date" },
  { value: "journal_entry_no", label: "Entry No" },
  { value: "total_debit", label: "Amount" },
];

const getStatusColor = (status: JournalEntryStatus) => {
  switch (status) {
    case "draft": return "default" as const;
    case "posted": return "success" as const;
    case "reversed": return "error" as const;
    default: return "default" as const;
  }
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function JournalEntriesPage() {
  const queryClient = useQueryClient();

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("entry_date");
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [selectedJE, setSelectedJE] = useState<JournalEntry | null>(null);

  // Dialogs
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [reverseDialogOpen, setReverseDialogOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState("");

  const deleteDialog = useTConfirmDialog();
  const postDialog = useTConfirmDialog();

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
    if (filteredEntries.length > 0 && !selectedJE) {
      setSelectedJE(filteredEntries[0]);
    }
  }, [filteredEntries, selectedJE]);

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
      setCreateDialogOpen(false);
      setSelectedJE(data);
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

  const handlePost = useCallback(() => {
    if (!selectedJE) return;
    postDialog.open(
      "Post Journal Entry",
      `Post "${selectedJE.journal_entry_no}" to the General Ledger? This action cannot be undone.`,
      () => postMutation.mutate(selectedJE.id)
    );
  }, [selectedJE, postDialog, postMutation]);

  const handleDelete = useCallback(() => {
    if (!selectedJE) return;
    deleteDialog.open(
      "Delete Journal Entry",
      `Delete draft entry "${selectedJE.journal_entry_no}"?`,
      () => deleteMutation.mutate(selectedJE.id)
    );
  }, [selectedJE, deleteDialog, deleteMutation]);

  // ─── Create Form ───────────────────────────────────────────────────────────

  const createForm = useForm<JournalEntryCreate>({
    defaultValues: {
      entry_date: new Date().toISOString().split("T")[0],
      description: "",
      entry_type: "standard",
      lines: [
        { line_number: 1, account_id: 0, debit_amount: 0, credit_amount: 0, description: "" },
        { line_number: 2, account_id: 0, debit_amount: 0, credit_amount: 0, description: "" },
      ],
    },
  });

  const { fields: lineFields, append: appendLine, remove: removeLine } = useFieldArray({
    control: createForm.control,
    name: "lines",
  });

  const watchedLines = createForm.watch("lines");
  const totalDebit = watchedLines?.reduce((sum, l) => sum + (Number(l.debit_amount) || 0), 0) || 0;
  const totalCredit = watchedLines?.reduce((sum, l) => sum + (Number(l.credit_amount) || 0), 0) || 0;
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  // ─── Master Panel ──────────────────────────────────────────────────────────

  const masterPanel = (
    <SearchableList
      items={filteredEntries}
      isLoading={isLoading}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search journal entries..."
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
              onClick={() => {
                createForm.reset();
                setCreateDialogOpen(true);
              }}
            >
              New Entry
            </Button>
          </Box>
          <TextField
            select
            size="small"
            label="Status"
            value={filterStatus || ""}
            onChange={(e) => setFilterStatus(e.target.value || null)}
            fullWidth
          >
            <MenuItem value="">All Statuses</MenuItem>
            {STATUS_OPTIONS.map((s) => (
              <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Entry Type"
            value={filterType || ""}
            onChange={(e) => setFilterType(e.target.value || null)}
            fullWidth
          >
            <MenuItem value="">All Types</MenuItem>
            {ENTRY_TYPES.map((t) => (
              <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
            ))}
          </TextField>
        </Box>
      }
      renderItem={(je: JournalEntry, isSelected: boolean) => (
        <SelectableListItem
          key={je.id}
          id={je.id}
          isSelected={isSelected}
          onClick={() => setSelectedJE(je)}
          primaryText={
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
              <span>{je.journal_entry_no}</span>
              <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                <Typography variant="caption" fontWeight={600}>
                  Rs. {fmtLKR(je.total_debit)}
                </Typography>
                <Chip
                  label={je.status}
                  size="small"
                  color={getStatusColor(je.status)}
                  variant="outlined"
                />
              </Box>
            </Box>
          }
          secondaryText={
            !isSelected
              ? `${je.description?.substring(0, 40) || "No description"} - ${format(new Date(je.entry_date), "dd/MM/yyyy")}`
              : undefined
          }
        />
      )}
    />
  );

  // ─── Detail Panel ──────────────────────────────────────────────────────────

  const detail = jeDetail || selectedJE;

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Finance" },
          { label: "Journal Entries", href: "/finance/journal-entries" },
          ...(detail ? [{ label: detail.journal_entry_no }] : []),
        ]}
        title={detail ? detail.journal_entry_no : ""}
        titleIcon={<ReceiptLongIcon color="primary" />}
        noSelectionTitle="Select a Journal Entry"
        chips={
          detail
            ? [
                { label: detail.status.charAt(0).toUpperCase() + detail.status.slice(1), color: getStatusColor(detail.status) },
                { label: detail.entry_type, color: "info" as const },
                ...(detail.is_reversed ? [{ label: "Reversed", color: "error" as const }] : []),
              ]
            : []
        }
      />

      {detail && (
        <>
          {/* Action Buttons */}
          <Box sx={{ display: "flex", gap: 1, p: 1, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper", flexWrap: "wrap" }}>
            {detail.status === "draft" && (
              <>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<CheckCircleIcon />}
                  color="success"
                  onClick={handlePost}
                >
                  Post to GL
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
          </Box>

          {/* Entry Details */}
          <Box sx={{ p: 2, overflow: "auto" }}>
            <FormSection title="Entry Information">
              <Table size="small">
                <TableBody>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600, width: 180 }}>Entry No</TableCell>
                    <TableCell>{detail.journal_entry_no}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Entry Date</TableCell>
                    <TableCell>{format(new Date(detail.entry_date), "dd/MM/yyyy")}</TableCell>
                  </TableRow>
                  {detail.posting_date && (
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Posting Date</TableCell>
                      <TableCell>{format(new Date(detail.posting_date), "dd/MM/yyyy")}</TableCell>
                    </TableRow>
                  )}
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                    <TableCell>
                      <Chip label={detail.entry_type} size="small" variant="outlined" />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
                    <TableCell>{detail.description}</TableCell>
                  </TableRow>
                  {detail.fiscal_year && (
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Fiscal Period</TableCell>
                      <TableCell>FY {detail.fiscal_year} - Period {detail.fiscal_period}</TableCell>
                    </TableRow>
                  )}
                  {detail.reversed_je_no && (
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Reversed By</TableCell>
                      <TableCell>
                        <Chip label={detail.reversed_je_no} size="small" color="error" />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </FormSection>

            {/* Line Items */}
            <FormSection title="Line Items">
              <Paper variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>#</TableCell>
                      <TableCell>Account</TableCell>
                      <TableCell>Description</TableCell>
                      <TableCell align="right">Debit</TableCell>
                      <TableCell align="right">Credit</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {detail.lines?.map((line) => (
                      <TableRow key={line.id || line.line_number}>
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
                    <TableRow sx={{ bgcolor: "action.hover" }}>
                      <TableCell colSpan={3} sx={{ fontWeight: 700 }}>
                        Total
                      </TableCell>
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
          </Box>
        </>
      )}

      {!detail && (
        <EmptyState message="Select a journal entry from the list to view details" />
      )}
    </Box>
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <MasterDetailLayout
        title="Journal Entries"
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
        <DialogTitle>Create Journal Entry</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
            <Box sx={{ display: "flex", gap: 2 }}>
              <Controller
                name="entry_date"
                control={createForm.control}
                rules={{ required: "Date is required" }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    type="date"
                    label="Entry Date"
                    size="small"
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                  />
                )}
              />
              <Controller
                name="entry_type"
                control={createForm.control}
                render={({ field }) => (
                  <TextField {...field} select label="Entry Type" size="small" fullWidth>
                    {ENTRY_TYPES.map((t) => (
                      <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
                    ))}
                  </TextField>
                )}
              />
            </Box>

            <Controller
              name="description"
              control={createForm.control}
              rules={{ required: "Description is required" }}
              render={({ field, fieldState }) => (
                <TextField
                  {...field}
                  label="Description"
                  fullWidth
                  size="small"
                  error={!!fieldState.error}
                  helperText={fieldState.error?.message}
                />
              )}
            />

            {/* Line Items */}
            <Typography variant="subtitle2" sx={{ mt: 1 }}>Line Items</Typography>
            <Paper variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 40 }}>#</TableCell>
                    <TableCell>Account</TableCell>
                    <TableCell>Description</TableCell>
                    <TableCell sx={{ width: 130 }}>Debit</TableCell>
                    <TableCell sx={{ width: 130 }}>Credit</TableCell>
                    <TableCell sx={{ width: 40 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lineFields.map((field, index) => (
                    <TableRow key={field.id}>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell>
                        <Controller
                          name={`lines.${index}.account_id`}
                          control={createForm.control}
                          rules={{ required: true, min: 1 }}
                          render={({ field: f }) => (
                            <TextField
                              {...f}
                              select
                              size="small"
                              fullWidth
                              placeholder="Select account"
                              onChange={(e) => f.onChange(Number(e.target.value))}
                            >
                              {accounts.map((a) => (
                                <MenuItem key={a.id} value={a.id}>
                                  {a.account_code} - {a.account_name}
                                </MenuItem>
                              ))}
                            </TextField>
                          )}
                        />
                      </TableCell>
                      <TableCell>
                        <Controller
                          name={`lines.${index}.description`}
                          control={createForm.control}
                          render={({ field: f }) => (
                            <TextField {...f} size="small" fullWidth placeholder="Line description" />
                          )}
                        />
                      </TableCell>
                      <TableCell>
                        <Controller
                          name={`lines.${index}.debit_amount`}
                          control={createForm.control}
                          render={({ field: f }) => (
                            <TextField
                              {...f}
                              type="number"
                              size="small"
                              fullWidth
                              inputProps={{ min: 0, step: "0.01" }}
                              onChange={(e) => f.onChange(Number(e.target.value))}
                            />
                          )}
                        />
                      </TableCell>
                      <TableCell>
                        <Controller
                          name={`lines.${index}.credit_amount`}
                          control={createForm.control}
                          render={({ field: f }) => (
                            <TextField
                              {...f}
                              type="number"
                              size="small"
                              fullWidth
                              inputProps={{ min: 0, step: "0.01" }}
                              onChange={(e) => f.onChange(Number(e.target.value))}
                            />
                          )}
                        />
                      </TableCell>
                      <TableCell>
                        {lineFields.length > 2 && (
                          <IconButton size="small" color="error" onClick={() => removeLine(index)}>
                            <RemoveCircleOutlineIcon fontSize="small" />
                          </IconButton>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow sx={{ bgcolor: "action.hover" }}>
                    <TableCell colSpan={3} sx={{ fontWeight: 700 }}>Total</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>{fmtLKR(totalDebit)}</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>{fmtLKR(totalCredit)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </Paper>

            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Button
                size="small"
                startIcon={<AddCircleOutlineIcon />}
                onClick={() =>
                  appendLine({
                    line_number: lineFields.length + 1,
                    account_id: 0,
                    debit_amount: 0,
                    credit_amount: 0,
                    description: "",
                  })
                }
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
                  Entry is balanced
                </Alert>
              )}
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={createForm.handleSubmit((data) => {
              // Renumber lines
              const lines = data.lines.map((l, i) => ({ ...l, line_number: i + 1 }));
              createMutation.mutate({ ...data, lines });
            })}
            disabled={createMutation.isPending || !isBalanced}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

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

      <TConfirmDialog {...deleteDialog.dialogProps} />
      <TConfirmDialog {...postDialog.dialogProps} />
    </Box>
  );
}
