/**
 * ProductDesignBrief - the "Design Brief" tab of a product: the Item Catalog items (tags, stickers,
 * bags, ...) the product needs, each with an optional brief (what to design / print).
 *
 * Edited inline: "Add Item" adds a line; each line is its own card (Category → Item, then Brief) so
 * the fields have room. View mode shows the same fields read-only.
 *
 * Lifecycle (enforced by the API): Draft → Confirm (locked for good) | Reject (reason; editing and
 * saving puts it back to Draft). Every write echoes the brief's version so nobody confirms or
 * overwrites a brief that changed since it was loaded.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Box, Button, CircularProgress, Paper, TextField, Tooltip, Typography } from "@mui/material";
import ApproveIcon from "@mui/icons-material/CheckCircleOutline";
import DesignServicesOutlinedIcon from "@mui/icons-material/DesignServicesOutlined";
import RejectIcon from "@mui/icons-material/ThumbDown";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import {
  handleApiError,
  showErrorToast,
  showSuccessToast,
  TConfirmDialog,
  useConfirmDialog,
} from "@/components/tijaero";
import { designBriefApi } from "../api";
import type { DesignBrief, DesignBriefItemOption, DesignBriefStatus } from "../types";
import {
  AuditCaption,
  CategoryItemFields,
  DocStatusAlerts,
  EmptyLines,
  LineCard,
  LinesCard,
  RejectReasonDialog,
} from "./DesignDocParts";
import { buildCategories, itemOptionsFor, type ItemLine, MAX_TEXT, UNCATEGORISED } from "./designDocUtils";

interface DraftLine extends ItemLine {
  brief: string;
}

const lineHasError = (l: DraftLine) => l.category_id == null || l.material_id == null || l.brief.length > MAX_TEXT;

const toDraft = (brief: DesignBrief | null | undefined): DraftLine[] =>
  (brief?.lines ?? []).map((l) => ({
    key: `saved-${l.id}`,
    category_id: l.category_id ?? null,
    category_name: l.category_name || UNCATEGORISED,
    material_id: l.material_id,
    item_code: l.item_code,
    item_name: l.item_name,
    brief: l.brief ?? "",
  }));

const comparable = (ls: DraftLine[]) => JSON.stringify(ls.map((l) => [l.material_id, l.brief.trim()]));

const STATUS_CHIP: Record<DesignBriefStatus, { label: string; color: "warning" | "success" | "error" }> = {
  draft: { label: "Brief: Draft", color: "warning" },
  confirmed: { label: "Brief: Confirmed", color: "success" },
  rejected: { label: "Brief: Rejected", color: "error" },
};

/**
 * Design Brief state + UI for one product. The Products page wires the returned callbacks into its
 * own ActionToolbar (same Edit / Save / Cancel as General and Pricing) and renders `panel` in the tab.
 */
export function useProductDesignBrief(productId: number | null, canEdit: boolean) {
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();
  const qKey = ["product-design-brief", productId];

  const [editing, setEditing] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [notes, setNotes] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const newKey = useRef(0);
  // One write at a time: a double click fires twice before `busy` re-renders the buttons disabled.
  const inFlight = useRef(false);
  const runOnce = (mutate: () => void) => {
    if (inFlight.current) return;
    inFlight.current = true;
    mutate();
  };
  const release = () => {
    inFlight.current = false;
  };

  // Another product was opened: drop any unsaved brief edits of the previous one.
  useEffect(() => {
    setEditing(false);
    setShowErrors(false);
  }, [productId]);

  const {
    data: brief,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: qKey,
    queryFn: () => designBriefApi.get(productId as number),
    enabled: productId != null,
  });

  const { data: options = [], isLoading: optionsLoading } = useQuery({
    queryKey: ["design-brief-item-options"],
    queryFn: designBriefApi.itemOptions,
    enabled: editing,
    staleTime: 60_000,
  });

  const categories = useMemo(() => buildCategories(options, lines), [options, lines]);
  const status: DesignBriefStatus | null = brief?.status ?? null;
  const isLocked = status === "confirmed";
  const rows = editing ? lines : toDraft(brief);

  const afterWrite = (data: DesignBrief, message: string) => {
    queryClient.setQueryData(qKey, data);
    showSuccessToast(message);
  };
  const onWriteError = (e: unknown, fallback: string) => {
    showErrorToast(handleApiError(e, fallback));
    // Someone else changed it (or it got locked): show the current brief.
    if (axios.isAxiosError(e) && e.response?.status === 409) {
      setEditing(false);
      refetch();
    }
  };

  const saveMut = useMutation({
    mutationFn: () =>
      designBriefApi.save(productId as number, {
        expected_version: brief?.version ?? null,
        notes: notes.trim() || null,
        lines: lines.map((l) => ({
          material_id: l.material_id as number,
          brief: l.brief.trim() || null,
        })),
      }),
    onSuccess: (data) => {
      afterWrite(data, "Design brief saved");
      setEditing(false);
    },
    onError: (e) => onWriteError(e, "Failed to save the design brief."),
    onSettled: release,
  });

  const confirmMut = useMutation({
    mutationFn: () => designBriefApi.confirm(productId as number, brief?.version ?? null),
    onSuccess: (data) => afterWrite(data, "Design brief confirmed and locked"),
    onError: (e) => onWriteError(e, "Failed to confirm the design brief."),
    onSettled: release,
  });

  const rejectMut = useMutation({
    mutationFn: () => designBriefApi.reject(productId as number, brief?.version ?? null, rejectReason.trim()),
    onSuccess: (data) => {
      afterWrite(data, "Design brief rejected");
      setRejectOpen(false);
    },
    onError: (e) => onWriteError(e, "Failed to reject the design brief."),
    onSettled: release,
  });

  const busy = saveMut.isPending || confirmMut.isPending || rejectMut.isPending;

  const blankLine = (categoryId: number | null, categoryName: string): DraftLine => ({
    key: `new-${newKey.current++}`,
    category_id: categoryId,
    category_name: categoryName,
    material_id: null,
    item_code: "",
    item_name: "",
    brief: "",
  });

  const startEdit = () => {
    const draft = toDraft(brief);
    setLines(draft.length ? draft : [blankLine(null, "")]);
    setNotes(brief?.notes ?? "");
    setShowErrors(false);
    setEditing(true);
  };

  const cancelEdit = async () => {
    const meaningful = lines.filter((l) => l.material_id != null || l.brief.trim());
    const dirty = comparable(meaningful) !== comparable(toDraft(brief)) || notes !== (brief?.notes ?? "");
    if (
      dirty &&
      !(await confirmDialog.confirm({
        title: "Discard Changes",
        message: "Discard your changes to the design brief?",
        confirmText: "Discard",
        type: "warning",
      }))
    )
      return;
    setEditing(false);
  };

  const save = () => {
    if (lines.some(lineHasError) || notes.length > MAX_TEXT) {
      setShowErrors(true);
      showErrorToast("Fill in the highlighted fields first.");
      return;
    }
    runOnce(() => saveMut.mutate());
  };

  // A new line starts in the last line's category, so several tags can be added one after another.
  const addLine = () => {
    const last = lines[lines.length - 1];
    setLines((prev) => [...prev, blankLine(last?.category_id ?? null, last?.category_name ?? "")]);
  };
  const updateLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  const handleConfirm = async () => {
    const n = brief?.lines.length ?? 0;
    const ok = await confirmDialog.confirm({
      title: "Confirm Design Brief",
      message: `Confirm this design brief with ${n} item${n === 1 ? "" : "s"}?`,
      details: "Once confirmed, the design brief is locked permanently and can never be edited or rejected.",
      confirmText: "Confirm",
      confirmColor: "success",
      type: "warning",
    });
    if (ok) runOnce(() => confirmMut.mutate());
  };

  const canChange = canEdit && !isLocked;
  const canDecide = canChange && !editing && status === "draft";
  const hasLines = (brief?.lines.length ?? 0) > 0;

  // Same buttons as the Quotations workflow actions.
  const decisionActions = canDecide ? (
    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
      <Tooltip title={hasLines ? "Confirm and lock this design brief" : "Add at least one item first"}>
        <span>
          <Button
            size="small"
            variant="contained"
            color="success"
            startIcon={<ApproveIcon />}
            onClick={handleConfirm}
            disabled={busy || !hasLines}
          >
            Confirm
          </Button>
        </span>
      </Tooltip>
      <Tooltip title="Reject Design Brief">
        <span>
          <Button
            size="small"
            variant="outlined"
            color="error"
            startIcon={<RejectIcon />}
            onClick={() => {
              setRejectReason("");
              setRejectOpen(true);
            }}
            disabled={busy}
          >
            Reject
          </Button>
        </span>
      </Tooltip>
    </Box>
  ) : null;

  // Same fields in view and edit mode (read-only when viewing), like the General tab.
  const renderLine = (l: DraftLine, i: number) => {
    const readOnly = !editing;
    return (
      <LineCard key={l.key} index={i} line={l} editing={editing} onRemove={() => removeLine(l.key)}>
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1.5fr" } }}>
          <CategoryItemFields
            line={l}
            categories={categories}
            itemOptions={readOnly ? [] : itemOptionsFor(options, lines, l)}
            optionsLoading={optionsLoading}
            fixed={readOnly}
            showErrors={showErrors}
            onCategory={(id) =>
              id !== l.category_id &&
              updateLine(l.key, {
                category_id: id,
                category_name: categories.find((c) => c.id === id)?.name ?? "",
                material_id: null,
                item_code: "",
                item_name: "",
              })
            }
            onItem={(o: DesignBriefItemOption | null) =>
              updateLine(l.key, { material_id: o?.id ?? null, item_code: o?.item_code ?? "", item_name: o?.name ?? "" })
            }
          />
        </Box>
        <Box sx={{ mt: 1 }}>
          <TextField
            label="Brief"
            disabled={readOnly}
            size="small"
            fullWidth
            multiline
            minRows={3}
            maxRows={10}
            value={l.brief}
            onChange={(e) => updateLine(l.key, { brief: e.target.value })}
            placeholder={readOnly ? "-" : "Size, colours, text / logo, material, placement..."}
            inputProps={{ maxLength: MAX_TEXT, "aria-label": `Brief for line ${i + 1}` }}
          />
        </Box>
      </LineCard>
    );
  };

  const view = isLoading ? (
    <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
      <CircularProgress size={28} />
    </Box>
  ) : isError ? (
    <Alert severity="error" action={<Button onClick={() => refetch()}>Retry</Button>}>
      Could not load the design brief.
    </Alert>
  ) : (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
      <DocStatusAlerts doc={brief} noun="design brief" canEdit={canEdit} editing={editing} />

      <LinesCard
        title="Items"
        icon={<DesignServicesOutlinedIcon color="primary" fontSize="small" />}
        count={rows.length}
        editing={editing}
        onAdd={addLine}
        disabled={busy}
      >
        {rows.length === 0 ? (
          <EmptyLines
            icon={<DesignServicesOutlinedIcon />}
            title={editing ? "No items yet" : "No design brief yet"}
            text={
              editing
                ? 'Click "Add Item" to add the tags, stickers, bags, ... this product needs.'
                : canChange
                  ? 'Click "Edit" to list the tags, stickers, bags and other items this product needs.'
                  : "Nothing has been added to this design brief."
            }
          />
        ) : (
          <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2, bgcolor: "action.hover" }}>
            {rows.map(renderLine)}
          </Box>
        )}
      </LinesCard>

      {(editing || brief?.notes) && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            General Notes
          </Typography>
          <TextField
            size="small"
            fullWidth
            multiline
            minRows={3}
            disabled={!editing}
            value={editing ? notes : (brief?.notes ?? "")}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything that applies to the whole brief (brand guidelines, deadlines, ...)"
            inputProps={{ maxLength: MAX_TEXT, "aria-label": "General Notes" }}
          />
        </Paper>
      )}

      {brief && !editing && <AuditCaption doc={brief} />}

      <RejectReasonDialog
        open={rejectOpen}
        title="Reject Design Brief"
        reason={rejectReason}
        onReasonChange={setRejectReason}
        onClose={() => setRejectOpen(false)}
        onSubmit={() => runOnce(() => rejectMut.mutate())}
        pending={rejectMut.isPending}
        placeholder="e.g., Tag colour must be black, logo too small..."
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </Box>
  );

  return {
    panel: view,
    /** Workflow buttons for the toolbar's end slot (view mode, draft only). */
    decisionActions,
    /** Status chip for the detail header (null until the brief is first saved). */
    statusChip: status ? STATUS_CHIP[status] : null,
    editing,
    /** Edit is offered until the brief is confirmed (creates it the first time). */
    canEdit: canChange && !isLoading && !isError,
    isSaving: busy,
    startEdit,
    save,
    cancelEdit,
  };
}
