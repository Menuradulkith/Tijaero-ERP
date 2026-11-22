/**
 * ProductDesignDetail - the "Design Detail" tab of a product: the production spec that follows a
 * confirmed Design Brief. It starts from the brief's items (items can be added / removed) and per item
 * takes Quantity (M), Colour, Size and the Design URL. Special Instructions and Packing / Loading
 * Instructions sit at the bottom.
 *
 * Edited inline: each line is its own card (item, the brief it came from, then the spec fields) so
 * the fields have room.
 *
 * Lifecycle (enforced by the API, same as the brief): only once the brief is confirmed;
 * Draft → Confirm (locked for good) | Reject (reason; editing and saving puts it back to Draft).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Box, Button, CircularProgress, Paper, TextField, Tooltip, Typography } from "@mui/material";
import ApproveIcon from "@mui/icons-material/CheckCircleOutline";
import StraightenIcon from "@mui/icons-material/Straighten";
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
import { designBriefApi, designDetailApi } from "../api";
import type { DesignBrief, DesignBriefItemOption, DesignBriefStatus, DesignDetail } from "../types";
import {
  AuditCaption,
  BriefBox,
  CategoryItemFields,
  DocStatusAlerts,
  EmptyLines,
  LineCard,
  LinesCard,
  OpenLinkAdornment,
  RejectReasonDialog,
} from "./DesignDocParts";
import { buildCategories, itemOptionsFor, type ItemLine, MAX_TEXT, UNCATEGORISED, urlError } from "./designDocUtils";

interface DraftLine extends ItemLine {
  /** Came from the confirmed brief: its category / item and brief are the template and stay fixed. */
  fromBrief: boolean;
  /** The brief's text (read-only) for brief items; the line's own optional brief for items added here. */
  brief: string;
  quantity: string;
  colour: string;
  size: string;
  design_url: string;
}

const MAX_SHORT = 120;
const SPEC_COLUMNS = { xs: "1fr 1fr", md: "150px 1fr 1fr 2fr" };

const qtyError = (v: string) => {
  const n = Number(v);
  if (v.trim() === "" || !Number.isFinite(n)) return "Required";
  if (n <= 0) return "Must be more than 0";
  if (Math.abs(n * 1000 - Math.round(n * 1000)) > 1e-6) return "Max 3 decimals";
  return null;
};
// Only Quantity (M) is required; Brief, Colour, Size and Design URL are optional.
const lineHasError = (l: DraftLine) =>
  l.category_id == null ||
  l.material_id == null ||
  !!qtyError(l.quantity) ||
  !!urlError(l.design_url, false) ||
  l.brief.length > MAX_TEXT;

const STATUS_CHIP: Record<DesignBriefStatus, { label: string; color: "warning" | "success" | "error" }> = {
  draft: { label: "Detail: Draft", color: "warning" },
  confirmed: { label: "Detail: Confirmed", color: "success" },
  rejected: { label: "Detail: Rejected", color: "error" },
};

const fromDetail = (detail: DesignDetail, brief: DesignBrief | null | undefined): DraftLine[] => {
  const briefItems = new Set((brief?.lines ?? []).map((l) => l.material_id));
  return detail.lines.map((l) => ({
    key: `saved-${l.id}`,
    fromBrief: briefItems.has(l.material_id),
    category_id: l.category_id ?? null,
    category_name: l.category_name || UNCATEGORISED,
    material_id: l.material_id,
    item_code: l.item_code,
    item_name: l.item_name,
    brief: l.brief ?? "",
    quantity: String(l.quantity),
    colour: l.colour ?? "",
    size: l.size ?? "",
    design_url: l.design_url ?? "",
  }));
};

const fromBriefLines = (brief: DesignBrief): DraftLine[] =>
  brief.lines.map((l) => ({
    key: `brief-${l.id}`,
    fromBrief: true,
    category_id: l.category_id ?? null,
    category_name: l.category_name || UNCATEGORISED,
    material_id: l.material_id,
    item_code: l.item_code,
    item_name: l.item_name,
    brief: l.brief ?? "",
    quantity: "",
    colour: "",
    size: "",
    design_url: "",
  }));

const comparable = (ls: DraftLine[]) =>
  JSON.stringify(ls.map((l) => [l.material_id, l.brief.trim(), l.quantity, l.colour, l.size, l.design_url]));

/**
 * Design Detail state + UI for one product. The Products page wires the returned callbacks into its
 * own ActionToolbar (same Edit / Save / Cancel as the other tabs) and renders `panel` in the tab.
 */
export function useProductDesignDetail(productId: number | null, canEdit: boolean) {
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();
  const qKey = ["product-design-detail", productId];

  const [editing, setEditing] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [special, setSpecial] = useState("");
  const [packing, setPacking] = useState("");
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

  useEffect(() => {
    setEditing(false);
    setShowErrors(false);
  }, [productId]);

  // Shares the Design Brief tab's cache entry.
  const briefQuery = useQuery({
    queryKey: ["product-design-brief", productId],
    queryFn: () => designBriefApi.get(productId as number),
    enabled: productId != null,
  });
  const detailQuery = useQuery({
    queryKey: qKey,
    queryFn: () => designDetailApi.get(productId as number),
    enabled: productId != null,
  });
  const { data: options = [], isLoading: optionsLoading } = useQuery({
    queryKey: ["design-brief-item-options"],
    queryFn: designBriefApi.itemOptions,
    enabled: editing,
    staleTime: 60_000,
  });

  const brief = briefQuery.data;
  const detail = detailQuery.data;
  const isLoading = briefQuery.isLoading || detailQuery.isLoading;
  const isError = briefQuery.isError || detailQuery.isError;
  const briefConfirmed = brief?.status === "confirmed";

  const categories = useMemo(() => buildCategories(options, lines), [options, lines]);
  const status: DesignBriefStatus | null = detail?.status ?? null;
  const isLocked = status === "confirmed";
  const rows = editing ? lines : detail ? fromDetail(detail, brief) : [];

  const afterWrite = (data: DesignDetail, message: string) => {
    queryClient.setQueryData(qKey, data);
    showSuccessToast(message);
  };
  const onWriteError = (e: unknown, fallback: string) => {
    showErrorToast(handleApiError(e, fallback));
    if (axios.isAxiosError(e) && e.response?.status === 409) {
      setEditing(false);
      detailQuery.refetch();
    }
  };

  const saveMut = useMutation({
    mutationFn: () =>
      designDetailApi.save(productId as number, {
        expected_version: detail?.version ?? null,
        special_instructions: special.trim() || null,
        packing_instructions: packing.trim() || null,
        lines: lines.map((l) => ({
          material_id: l.material_id as number,
          quantity: Number(l.quantity),
          brief: l.fromBrief ? undefined : l.brief.trim() || null,
          colour: l.colour.trim() || null,
          size: l.size.trim() || null,
          design_url: l.design_url.trim() || null,
        })),
      }),
    onSuccess: (data) => {
      afterWrite(data, "Design detail saved");
      setEditing(false);
    },
    onError: (e) => onWriteError(e, "Failed to save the design detail."),
    onSettled: release,
  });

  const confirmMut = useMutation({
    mutationFn: () => designDetailApi.confirm(productId as number, detail?.version ?? null),
    onSuccess: (data) => afterWrite(data, "Design detail confirmed and locked"),
    onError: (e) => onWriteError(e, "Failed to confirm the design detail."),
    onSettled: release,
  });

  const rejectMut = useMutation({
    mutationFn: () => designDetailApi.reject(productId as number, detail?.version ?? null, rejectReason.trim()),
    onSuccess: (data) => {
      afterWrite(data, "Design detail rejected");
      setRejectOpen(false);
    },
    onError: (e) => onWriteError(e, "Failed to reject the design detail."),
    onSettled: release,
  });

  const busy = saveMut.isPending || confirmMut.isPending || rejectMut.isPending;

  const startEdit = () => {
    setLines(detail ? fromDetail(detail, brief) : brief ? fromBriefLines(brief) : []);
    setSpecial(detail?.special_instructions ?? "");
    setPacking(detail?.packing_instructions ?? "");
    setShowErrors(false);
    setEditing(true);
  };

  const cancelEdit = async () => {
    const original = detail ? fromDetail(detail, brief) : brief ? fromBriefLines(brief) : [];
    const dirty =
      comparable(lines) !== comparable(original) ||
      special !== (detail?.special_instructions ?? "") ||
      packing !== (detail?.packing_instructions ?? "");
    if (
      dirty &&
      !(await confirmDialog.confirm({
        title: "Discard Changes",
        message: "Discard your changes to the design detail?",
        confirmText: "Discard",
        type: "warning",
      }))
    )
      return;
    setEditing(false);
  };

  const save = () => {
    if (lines.some(lineHasError) || special.length > MAX_TEXT || packing.length > MAX_TEXT) {
      setShowErrors(true);
      showErrorToast("Fill in the highlighted fields first.");
      return;
    }
    runOnce(() => saveMut.mutate());
  };

  const addLine = () => {
    const last = lines[lines.length - 1];
    setLines((prev) => [
      ...prev,
      {
        key: `new-${newKey.current++}`,
        fromBrief: false,
        category_id: last?.category_id ?? null,
        category_name: last?.category_name ?? "",
        material_id: null,
        item_code: "",
        item_name: "",
        brief: "",
        quantity: "",
        colour: "",
        size: "",
        design_url: "",
      },
    ]);
  };
  const updateLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  const handleConfirm = async () => {
    const n = detail?.lines.length ?? 0;
    const ok = await confirmDialog.confirm({
      title: "Confirm Design Detail",
      message: `Confirm this design detail with ${n} item${n === 1 ? "" : "s"}?`,
      details: "Once confirmed, the design detail is locked permanently and can never be edited or rejected.",
      confirmText: "Confirm",
      confirmColor: "success",
      type: "warning",
    });
    if (ok) runOnce(() => confirmMut.mutate());
  };

  const canChange = canEdit && briefConfirmed && !isLocked;
  const canDecide = canChange && !editing && status === "draft";
  const hasLines = (detail?.lines.length ?? 0) > 0;

  const decisionActions = canDecide ? (
    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
      <Tooltip title={hasLines ? "Confirm and lock this design detail" : "Add at least one item first"}>
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
      <Tooltip title="Reject Design Detail">
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
    const qErr = !readOnly && showErrors ? qtyError(l.quantity) : null;
    const uErr = readOnly ? null : urlError(l.design_url, false);
    const dash = (v: string) => (readOnly && !v ? "-" : undefined);
    return (
      <LineCard key={l.key} index={i} line={l} editing={editing} onRemove={() => removeLine(l.key)}>
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1.5fr" } }}>
          <CategoryItemFields
            line={l}
            categories={categories}
            itemOptions={readOnly ? [] : itemOptionsFor(options, lines, l)}
            optionsLoading={optionsLoading}
            fixed={readOnly || l.fromBrief}
            fixedNote={editing && l.fromBrief ? "from the confirmed Design Brief" : undefined}
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
          {l.fromBrief ? (
            l.brief && <BriefBox text={l.brief} />
          ) : (
            // An item added here (not from the Design Brief) has its own brief.
            <TextField
              label="Brief"
              disabled={readOnly}
              size="small"
              fullWidth
              multiline
              minRows={2}
              maxRows={8}
              value={l.brief}
              onChange={(e) => updateLine(l.key, { brief: e.target.value })}
              placeholder={dash(l.brief) ?? "Size, colours, text / logo, material, placement..."}
              inputProps={{ maxLength: MAX_TEXT, "aria-label": `Brief for line ${i + 1}` }}
              sx={{ mb: 2 }}
            />
          )}
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: SPEC_COLUMNS }}>
            <TextField
              label="Quantity (M)"
              required={!readOnly}
              disabled={readOnly}
              size="small"
              type="number"
              value={l.quantity}
              onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
              inputProps={{ min: 0, step: "any", "aria-label": `Quantity (M) for line ${i + 1}` }}
              error={!!qErr}
              helperText={qErr || " "}
            />
            <TextField
              label="Colour"
              disabled={readOnly}
              size="small"
              value={l.colour}
              onChange={(e) => updateLine(l.key, { colour: e.target.value })}
              placeholder={dash(l.colour) ?? "e.g. Black on white"}
              inputProps={{ maxLength: MAX_SHORT, "aria-label": `Colour for line ${i + 1}` }}
              helperText=" "
            />
            <TextField
              label="Size"
              disabled={readOnly}
              size="small"
              value={l.size}
              onChange={(e) => updateLine(l.key, { size: e.target.value })}
              placeholder={dash(l.size) ?? "e.g. 50 x 30 mm"}
              inputProps={{ maxLength: MAX_SHORT, "aria-label": `Size for line ${i + 1}` }}
              helperText=" "
            />
            <TextField
              label="Design URL"
              disabled={readOnly}
              size="small"
              value={l.design_url}
              onChange={(e) => updateLine(l.key, { design_url: e.target.value })}
              placeholder={dash(l.design_url) ?? "https://..."}
              inputProps={{ maxLength: 500, "aria-label": `Design URL for line ${i + 1}` }}
              InputProps={{
                endAdornment: readOnly ? <OpenLinkAdornment url={l.design_url} title="Open design" /> : undefined,
              }}
              error={!!uErr}
              helperText={uErr || " "}
            />
          </Box>
        </Box>
      </LineCard>
    );
  };

  const instructions = (
    <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
      {(
        [
          [
            "Special Instructions",
            special,
            setSpecial,
            detail?.special_instructions,
            "e.g. matte lamination, Pantone colours...",
          ],
          [
            "Packing / Loading Instructions",
            packing,
            setPacking,
            detail?.packing_instructions,
            "e.g. 100 pcs per bundle, 20 bundles per carton...",
          ],
        ] as const
      ).map(([label, value, setValue, saved, placeholder]) => (
        <Paper key={label} variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            {label}
          </Typography>
          <TextField
            size="small"
            fullWidth
            multiline
            minRows={4}
            disabled={!editing}
            value={editing ? value : saved || ""}
            onChange={(e) => setValue(e.target.value)}
            placeholder={editing ? placeholder : "None"}
            inputProps={{ maxLength: MAX_TEXT, "aria-label": label }}
          />
        </Paper>
      ))}
    </Box>
  );

  const view = isLoading ? (
    <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
      <CircularProgress size={28} />
    </Box>
  ) : isError ? (
    <Alert
      severity="error"
      action={
        <Button
          onClick={() => {
            briefQuery.refetch();
            detailQuery.refetch();
          }}
        >
          Retry
        </Button>
      }
    >
      Could not load the design detail.
    </Alert>
  ) : !briefConfirmed && !detail ? (
    <Paper variant="outlined" sx={{ mt: 1 }}>
      <EmptyLines
        icon={<StraightenIcon />}
        title="Waiting for the Design Brief"
        text="The Design Detail can be filled in once the Design Brief is confirmed."
      />
    </Paper>
  ) : (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
      <DocStatusAlerts doc={detail} noun="design detail" canEdit={canEdit} editing={editing} />

      <LinesCard
        title="Items"
        icon={<StraightenIcon color="primary" fontSize="small" />}
        count={rows.length}
        editing={editing}
        onAdd={addLine}
        disabled={busy}
      >
        {rows.length === 0 ? (
          <EmptyLines
            icon={<StraightenIcon />}
            title={editing ? "No items" : "No design detail yet"}
            text={
              editing
                ? 'Click "Add Item" to add one.'
                : canChange
                  ? 'Click "Edit" — the confirmed brief\'s items are filled in for you.'
                  : "Nothing has been added to this design detail."
            }
          />
        ) : (
          <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2, bgcolor: "action.hover" }}>
            {rows.map(renderLine)}
          </Box>
        )}
      </LinesCard>

      {instructions}

      {detail && !editing && (
        <AuditCaption
          doc={detail}
          history={productId ? { entityType: "product_design_detail", entityId: productId } : undefined}
        />
      )}

      <RejectReasonDialog
        open={rejectOpen}
        title="Reject Design Detail"
        reason={rejectReason}
        onReasonChange={setRejectReason}
        onClose={() => setRejectOpen(false)}
        onSubmit={() => runOnce(() => rejectMut.mutate())}
        pending={rejectMut.isPending}
        placeholder="e.g., Wrong size, colour does not match the brief..."
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </Box>
  );

  return {
    panel: view,
    decisionActions,
    statusChip: status ? STATUS_CHIP[status] : null,
    editing,
    canEdit: canChange && !isLoading && !isError,
    isSaving: busy,
    startEdit,
    save,
    cancelEdit,
  };
}
