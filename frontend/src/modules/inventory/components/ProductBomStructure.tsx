/**
 * ProductBomStructure - the "BOM Structure" tab of a product: the steps the product goes through in
 * the company until it is packed (e.g. Cutting → Sewing → Finishing → Packing), each with the Item
 * Catalog materials used in that step (quantity per product, scrap %). Kept on the product page,
 * separate from Manufacturing BOMs.
 *
 * - Steps are cards in order (move up / down); each step lists its materials.
 * - Each step is also a routing operation (Op 10, 20...): Manufacturing work center, setup time per
 *   batch, run time per unit, workers, move/wait time and, for an outside center, its cost per unit.
 * - Materials can only be items of the confirmed Design Detail (tags, stickers, bags...): add them one
 *   by one or all at once, with their Quantity (M) as the starting quantity. The API enforces this too.
 * - Multi-level: a material that is another product with its own BOM Structure shows it nested.
 * - Lifecycle (enforced by the API): Draft → Confirm (locked for good) | Reject (reason).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import AddIcon from "@mui/icons-material/Add";
import ApproveIcon from "@mui/icons-material/CheckCircleOutline";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DesignServicesOutlinedIcon from "@mui/icons-material/DesignServicesOutlined";
import RejectIcon from "@mui/icons-material/ThumbDown";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import {
  handleApiError,
  showErrorToast,
  showInfoToast,
  showSuccessToast,
  TConfirmDialog,
  useConfirmDialog,
} from "@/components/tijaero";
import { bomStructureApi, designBriefApi, designDetailApi } from "../api";
import type { BomStructure, BomSubStructure, BomWorkCenter, DesignBriefItemOption, DesignBriefStatus } from "../types";
import { ProcessFlow, StepCard, SubAssembly } from "./BomParts";
import { AuditCaption, CategoryItemFields, DocStatusAlerts, EmptyLines, RejectReasonDialog } from "./DesignDocParts";
import { buildCategories, itemOptionsFor, type ItemLine, MAX_TEXT, UNCATEGORISED } from "./designDocUtils";

interface DraftMaterial extends ItemLine {
  unit_of_measure: string;
  quantity: string;
  scrap_pct: string;
  notes: string;
  sub_structure?: BomSubStructure | null;
}

interface DraftStep {
  key: string;
  name: string;
  /** Free text from before routing; kept and shown under the work center. */
  work_area: string;
  /** Run time per unit. */
  minutes: string;
  instructions: string;
  work_center_id: number | null;
  /** The saved center (it may since have gone inactive, so it is not in the option list). */
  work_center: BomWorkCenter | null;
  setup: string;
  move: string;
  workers: string;
  outside_cost: string;
  materials: DraftMaterial[];
}

const qtyError = (v: string) => {
  const n = Number(v);
  if (v.trim() === "" || !Number.isFinite(n)) return "Required";
  if (n <= 0) return "Must be more than 0";
  if (Math.abs(n * 10000 - Math.round(n * 10000)) > 1e-6) return "Max 4 decimals";
  return null;
};
const scrapError = (v: string) => {
  if (!v.trim()) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n >= 100) return "0 to 99.99";
  return null;
};
const minutesError = (v: string) => {
  if (!v.trim()) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return "0 or more";
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return "Max 2 decimals";
  return null;
};
const stepNameError = (v: string) => (!v.trim() ? "Step name is required" : null);
const workersError = (v: string) => {
  if (!v.trim()) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? null : "1 to 1000";
};
const materialHasError = (m: DraftMaterial) =>
  m.category_id == null || m.material_id == null || !!qtyError(m.quantity) || !!scrapError(m.scrap_pct);
const stepHasError = (s: DraftStep) =>
  !!stepNameError(s.name) ||
  [s.minutes, s.setup, s.move, s.outside_cost].some((v) => !!minutesError(v)) ||
  !!workersError(s.workers) ||
  s.materials.some(materialHasError);
const numOrNull = (v: string) => (v.trim() ? Number(v) : null);
const strOf = (v?: number | null) => (v == null ? "" : String(v));

// Item snapshots can lack a category; give them one fixed id so the Category dropdown can still show them.
const NO_CATEGORY = 0;

const STATUS_CHIP: Record<DesignBriefStatus, { label: string; color: "warning" | "success" | "error" }> = {
  draft: { label: "BOM: Draft", color: "warning" },
  confirmed: { label: "BOM: Confirmed", color: "success" },
  rejected: { label: "BOM: Rejected", color: "error" },
};

const toDraft = (s: BomStructure | null | undefined): DraftStep[] =>
  (s?.steps ?? []).map((st) => ({
    key: `saved-${st.id}`,
    name: st.name,
    work_area: st.work_area ?? "",
    minutes: strOf(st.minutes_per_unit),
    instructions: st.instructions ?? "",
    work_center_id: st.work_center_id ?? null,
    work_center: st.work_center ?? null,
    setup: strOf(st.setup_minutes),
    move: strOf(st.move_minutes),
    workers: strOf(st.workers),
    outside_cost: strOf(st.outside_unit_cost),
    materials: st.materials.map((m) => ({
      key: `saved-m-${m.id}`,
      category_id: m.category_id ?? NO_CATEGORY,
      category_name: m.category_name || UNCATEGORISED,
      material_id: m.material_id,
      item_code: m.item_code,
      item_name: m.item_name,
      unit_of_measure: m.unit_of_measure ?? "",
      quantity: String(m.quantity),
      scrap_pct: m.scrap_pct ? String(m.scrap_pct) : "",
      notes: m.notes ?? "",
      sub_structure: m.sub_structure ?? null,
    })),
  }));

const comparable = (steps: DraftStep[]) =>
  JSON.stringify(
    steps.map((s) => [
      s.name.trim(),
      s.work_area.trim(),
      s.minutes,
      s.instructions.trim(),
      s.work_center_id,
      s.setup,
      s.move,
      s.workers,
      s.outside_cost,
      s.materials.map((m) => [m.material_id, m.quantity, m.scrap_pct, m.notes.trim()]),
    ]),
  );

/**
 * BOM Structure state + UI for one product. The Products page wires the returned callbacks into its
 * own ActionToolbar (same Edit / Save / Cancel as the other tabs) and renders `panel` in the tab.
 */
export function useProductBomStructure(productId: number | null, canEdit: boolean) {
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();
  const qKey = ["product-bom-structure", productId];

  const [editing, setEditing] = useState(false);
  const [steps, setSteps] = useState<DraftStep[]>([]);
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

  useEffect(() => {
    setEditing(false);
    setShowErrors(false);
  }, [productId]);

  const {
    data: structure,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: qKey,
    queryFn: () => bomStructureApi.get(productId as number),
    enabled: productId != null,
  });

  const { data: options = [], isLoading: optionsLoading } = useQuery({
    queryKey: ["design-brief-item-options"],
    queryFn: designBriefApi.itemOptions,
    enabled: editing,
    staleTime: 60_000,
  });

  const { data: workCenters = [] } = useQuery({
    queryKey: ["bom-work-centers"],
    queryFn: bomStructureApi.workCenters,
    enabled: editing,
    staleTime: 60_000,
  });
  // Active centers, plus the step's own center if it has gone inactive since.
  const centerOptions = (s: DraftStep) =>
    s.work_center && !workCenters.some((w) => w.id === s.work_center?.id)
      ? [...workCenters, s.work_center]
      : workCenters;
  const centerLabel = (w: BomWorkCenter) =>
    `${w.code} — ${w.name}${w.is_outside ? " (outside)" : ""}${w.active ? "" : " (inactive)"}`;

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["product-design-detail", productId],
    queryFn: () => designDetailApi.get(productId as number),
    enabled: editing && productId != null,
  });
  const detailConfirmed = detail?.status === "confirmed";
  const detailLines = useMemo(() => (detailConfirmed ? (detail?.lines ?? []) : []), [detail, detailConfirmed]);
  const detailIds = useMemo(() => new Set(detailLines.map((l) => l.material_id)), [detailLines]);
  // The only items a material can be: the confirmed Design Detail's (unit of measure from the catalog).
  const detailOptions = useMemo<DesignBriefItemOption[]>(
    () =>
      detailLines.map((l) => ({
        id: l.material_id,
        item_code: l.item_code,
        name: l.item_name,
        category_id: l.category_id ?? NO_CATEGORY,
        category_name: l.category_name || UNCATEGORISED,
        unit_of_measure: options.find((o) => o.id === l.material_id)?.unit_of_measure ?? undefined,
        design_required: false,
      })),
    [detailLines, options],
  );
  const notInDetail = (m: DraftMaterial) => !detailLoading && m.material_id != null && !detailIds.has(m.material_id);

  const allMaterials = useMemo(() => steps.flatMap((s) => s.materials), [steps]);
  const categories = useMemo(() => buildCategories(detailOptions, allMaterials), [detailOptions, allMaterials]);
  const status: DesignBriefStatus | null = structure?.status ?? null;
  const isLocked = status === "confirmed";
  const rows = editing ? steps : toDraft(structure);

  const afterWrite = (data: BomStructure, message: string) => {
    queryClient.setQueryData(qKey, data);
    queryClient.invalidateQueries({ queryKey: ["product-bom-structures"] });
    showSuccessToast(message);
  };
  const onWriteError = (e: unknown, fallback: string) => {
    showErrorToast(handleApiError(e, fallback));
    if (axios.isAxiosError(e) && e.response?.status === 409) {
      setEditing(false);
      refetch();
    }
  };

  const saveMut = useMutation({
    mutationFn: () =>
      bomStructureApi.save(productId as number, {
        expected_version: structure?.version ?? null,
        notes: notes.trim() || null,
        steps: steps.map((s) => ({
          name: s.name.trim(),
          work_area: s.work_area.trim() || null,
          minutes_per_unit: numOrNull(s.minutes),
          instructions: s.instructions.trim() || null,
          work_center_id: s.work_center_id,
          setup_minutes: numOrNull(s.setup),
          move_minutes: numOrNull(s.move),
          workers: numOrNull(s.workers),
          outside_unit_cost: numOrNull(s.outside_cost),
          materials: s.materials.map((m) => ({
            material_id: m.material_id as number,
            quantity: Number(m.quantity),
            scrap_pct: m.scrap_pct.trim() ? Number(m.scrap_pct) : 0,
            notes: m.notes.trim() || null,
          })),
        })),
      }),
    onSuccess: (data) => {
      afterWrite(data, "BOM structure saved");
      setEditing(false);
    },
    onError: (e) => onWriteError(e, "Failed to save the BOM structure."),
    onSettled: release,
  });

  const confirmMut = useMutation({
    mutationFn: () => bomStructureApi.confirm(productId as number, structure?.version ?? null),
    onSuccess: (data) => afterWrite(data, "BOM structure confirmed and locked"),
    onError: (e) => onWriteError(e, "Failed to confirm the BOM structure."),
    onSettled: release,
  });

  const rejectMut = useMutation({
    mutationFn: () => bomStructureApi.reject(productId as number, structure?.version ?? null, rejectReason.trim()),
    onSuccess: (data) => {
      afterWrite(data, "BOM structure rejected");
      setRejectOpen(false);
    },
    onError: (e) => onWriteError(e, "Failed to reject the BOM structure."),
    onSettled: release,
  });

  const busy = saveMut.isPending || confirmMut.isPending || rejectMut.isPending;

  const blankStep = (): DraftStep => ({
    key: `new-${newKey.current++}`,
    name: "",
    work_area: "",
    minutes: "",
    instructions: "",
    work_center_id: null,
    work_center: null,
    setup: "",
    move: "",
    workers: "",
    outside_cost: "",
    materials: [],
  });
  const blankMaterial = (categoryId: number | null, categoryName: string): DraftMaterial => ({
    key: `new-m-${newKey.current++}`,
    category_id: categoryId,
    category_name: categoryName,
    material_id: null,
    item_code: "",
    item_name: "",
    unit_of_measure: "",
    quantity: "1",
    scrap_pct: "",
    notes: "",
  });

  const startEdit = () => {
    const draft = toDraft(structure);
    setSteps(draft.length ? draft : [blankStep()]);
    setNotes(structure?.notes ?? "");
    setShowErrors(false);
    setEditing(true);
  };

  const cancelEdit = async () => {
    const meaningful = steps.filter((s) => s.name.trim() || s.materials.length);
    const dirty = comparable(meaningful) !== comparable(toDraft(structure)) || notes !== (structure?.notes ?? "");
    if (
      dirty &&
      !(await confirmDialog.confirm({
        title: "Discard Changes",
        message: "Discard your changes to the BOM structure?",
        confirmText: "Discard",
        type: "warning",
      }))
    )
      return;
    setEditing(false);
  };

  const save = () => {
    if (steps.some(stepHasError) || notes.length > MAX_TEXT) {
      setShowErrors(true);
      showErrorToast("Fill in the highlighted fields first.");
      return;
    }
    if (allMaterials.some(notInDetail)) {
      setShowErrors(true);
      showErrorToast("Remove the materials that are not in the confirmed Design Detail.");
      return;
    }
    runOnce(() => saveMut.mutate());
  };

  const updateStep = (key: string, patch: Partial<DraftStep>) =>
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const moveStep = (index: number, dir: -1 | 1) =>
    setSteps((prev) => {
      const next = [...prev];
      [next[index], next[index + dir]] = [next[index + dir], next[index]];
      return next;
    });
  const removeStep = async (step: DraftStep, index: number) => {
    if (step.name.trim() || step.materials.length) {
      const ok = await confirmDialog.confirm({
        title: "Remove Step",
        message: `Remove step ${index + 1}${step.name.trim() ? ` "${step.name.trim()}"` : ""} and its ${step.materials.length} material(s)?`,
        confirmText: "Remove",
        type: "danger",
      });
      if (!ok) return;
    }
    setSteps((prev) => prev.filter((s) => s.key !== step.key));
  };
  const updateMaterial = (stepKey: string, key: string, patch: Partial<DraftMaterial>) =>
    setSteps((prev) =>
      prev.map((s) =>
        s.key === stepKey ? { ...s, materials: s.materials.map((m) => (m.key === key ? { ...m, ...patch } : m)) } : s,
      ),
    );
  // A new material starts in the step's last category, so several tags can be added one after another.
  const addMaterial = (step: DraftStep) => {
    const last = step.materials[step.materials.length - 1];
    updateStep(step.key, {
      materials: [...step.materials, blankMaterial(last?.category_id ?? null, last?.category_name ?? "")],
    });
  };
  const removeMaterial = (step: DraftStep, key: string) =>
    updateStep(step.key, { materials: step.materials.filter((m) => m.key !== key) });

  // Design Detail items not yet in this step.
  const remainingFor = (step: DraftStep) => {
    const have = new Set(step.materials.map((m) => m.material_id));
    return detailLines.filter((l) => !have.has(l.material_id));
  };
  // Picking a Design Detail item starts it with that item's Quantity (M), colour and size.
  const fromDetail = (materialId: number | null) => {
    const l = detailLines.find((x) => x.material_id === materialId);
    return l ? { quantity: String(l.quantity), notes: [l.colour, l.size].filter(Boolean).join(", ") } : {};
  };

  const importFromDesignDetail = (step: DraftStep) => {
    const added: DraftMaterial[] = remainingFor(step).map((l) => ({
      key: `new-m-${newKey.current++}`,
      category_id: l.category_id ?? NO_CATEGORY,
      category_name: l.category_name || UNCATEGORISED,
      material_id: l.material_id,
      item_code: l.item_code,
      item_name: l.item_name,
      unit_of_measure: options.find((o) => o.id === l.material_id)?.unit_of_measure ?? "",
      scrap_pct: "",
      quantity: String(l.quantity),
      notes: [l.colour, l.size].filter(Boolean).join(", "),
    }));
    if (!added.length) {
      showInfoToast("All Design Detail items are already in this step.");
      return;
    }
    // Drop untouched blank rows, then append the design items.
    const kept = step.materials.filter((m) => m.material_id != null);
    updateStep(step.key, { materials: [...kept, ...added] });
    showSuccessToast(
      `${added.length} item${added.length === 1 ? "" : "s"} added from the Design Detail. Check the quantity per product.`,
    );
  };

  const addTip = (step: DraftStep) =>
    detailLoading
      ? "Loading the Design Detail..."
      : !detailConfirmed
        ? "Confirm the Design Detail first. Materials come from its items."
        : !detailLines.length
          ? "The confirmed Design Detail has no items."
          : !remainingFor(step).length
            ? "All Design Detail items are already in this step."
            : "";

  const handleConfirm = async () => {
    const n = structure?.steps.length ?? 0;
    const ok = await confirmDialog.confirm({
      title: "Confirm BOM Structure",
      message: `Confirm this BOM structure with ${n} step${n === 1 ? "" : "s"}?`,
      details: "Once confirmed, the BOM structure is locked permanently and can never be edited or rejected.",
      confirmText: "Confirm",
      confirmColor: "success",
      type: "warning",
    });
    if (ok) runOnce(() => confirmMut.mutate());
  };

  const canChange = canEdit && !isLocked;
  const canDecide = canChange && !editing && status === "draft";
  const hasSteps = (structure?.steps.length ?? 0) > 0;

  const decisionActions = canDecide ? (
    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
      <Tooltip title={hasSteps ? "Confirm and lock this BOM structure" : "Add at least one step first"}>
        <span>
          <Button
            size="small"
            variant="contained"
            color="success"
            startIcon={<ApproveIcon />}
            onClick={handleConfirm}
            disabled={busy || !hasSteps}
          >
            Confirm
          </Button>
        </span>
      </Tooltip>
      <Tooltip title="Reject BOM Structure">
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

  const renderMaterial = (step: DraftStep, m: DraftMaterial, mi: number, si: number) => {
    const readOnly = !editing;
    const qErr = !readOnly && showErrors ? qtyError(m.quantity) : null;
    const sErr = readOnly ? null : scrapError(m.scrap_pct);
    const label = `step ${si + 1} material ${mi + 1}`;
    return (
      <Box
        key={m.key}
        sx={{ p: 1.5, border: 1, borderColor: "divider", borderRadius: 1.5, bgcolor: "background.paper" }}
      >
        <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
          <Box sx={{ flex: 1, display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1.5fr" } }}>
            <CategoryItemFields
              line={m}
              categories={categories}
              itemOptions={readOnly ? [] : itemOptionsFor(detailOptions, step.materials, m)}
              optionsLoading={optionsLoading || detailLoading}
              fixed={readOnly}
              showErrors={showErrors}
              onCategory={(id) =>
                id !== m.category_id &&
                updateMaterial(step.key, m.key, {
                  category_id: id,
                  category_name: categories.find((c) => c.id === id)?.name ?? "",
                  material_id: null,
                  item_code: "",
                  item_name: "",
                  unit_of_measure: "",
                  sub_structure: null,
                })
              }
              onItem={(o: DesignBriefItemOption | null) =>
                updateMaterial(step.key, m.key, {
                  material_id: o?.id ?? null,
                  item_code: o?.item_code ?? "",
                  item_name: o?.name ?? "",
                  unit_of_measure: o?.unit_of_measure ?? "",
                  sub_structure: null,
                  ...fromDetail(o?.id ?? null),
                })
              }
            />
            {editing && showErrors && notInDetail(m) && (
              <Typography variant="caption" color="error" sx={{ gridColumn: "1 / -1", mt: -1 }}>
                This item is not in the confirmed Design Detail. Remove it.
              </Typography>
            )}
          </Box>
          {editing && (
            <Tooltip title="Remove material">
              <IconButton
                size="small"
                color="error"
                onClick={() => removeMaterial(step, m.key)}
                aria-label={`Remove ${label}`}
                sx={{ mt: 0.5 }}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
        <Box
          sx={{
            display: "grid",
            gap: 2,
            mt: 1,
            gridTemplateColumns: { xs: "1fr 1fr", md: "180px 130px 1fr" },
            pr: editing ? { md: 5 } : 0,
          }}
        >
          <TextField
            label="Qty per product"
            required={!readOnly}
            disabled={readOnly}
            size="small"
            type="number"
            value={m.quantity}
            onChange={(e) => updateMaterial(step.key, m.key, { quantity: e.target.value })}
            inputProps={{ min: 0, step: "any", "aria-label": `Quantity for ${label}` }}
            InputProps={{
              endAdornment: m.unit_of_measure ? (
                <InputAdornment position="end">{m.unit_of_measure}</InputAdornment>
              ) : undefined,
            }}
            error={!!qErr}
            helperText={qErr || " "}
          />
          <TextField
            label="Scrap %"
            disabled={readOnly}
            size="small"
            type="number"
            value={m.scrap_pct}
            onChange={(e) => updateMaterial(step.key, m.key, { scrap_pct: e.target.value })}
            placeholder="0"
            inputProps={{ min: 0, max: 99.99, step: "any", "aria-label": `Scrap % for ${label}` }}
            error={!!sErr}
            helperText={sErr || " "}
          />
          <TextField
            label="Notes"
            disabled={readOnly}
            size="small"
            value={m.notes}
            onChange={(e) => updateMaterial(step.key, m.key, { notes: e.target.value })}
            placeholder={readOnly ? "-" : "e.g. colour, placement, cutting direction"}
            inputProps={{ maxLength: MAX_TEXT, "aria-label": `Notes for ${label}` }}
            sx={{ gridColumn: { xs: "1 / -1", md: "auto" } }}
            helperText=" "
          />
        </Box>
        {m.sub_structure && <SubAssembly sub={m.sub_structure} />}
      </Box>
    );
  };

  const renderStep = (s: DraftStep, si: number) => {
    const readOnly = !editing;
    const nErr = !readOnly && showErrors ? stepNameError(s.name) : null;
    const err = (v: string) => (readOnly ? null : minutesError(v));
    const wErr = readOnly ? null : workersError(s.workers);
    const center = centerOptions(s).find((w) => w.id === s.work_center_id) ?? s.work_center;
    const outside = !!center?.is_outside;
    const num = (
      label: string,
      value: string,
      key: "minutes" | "setup" | "move" | "workers" | "outside_cost",
      aria: string,
      unit: string | null,
      error: string | null,
      helper = " ",
    ) => (
      <TextField
        label={label}
        disabled={readOnly}
        size="small"
        type="number"
        value={value}
        onChange={(e) => updateStep(s.key, { [key]: e.target.value } as Partial<DraftStep>)}
        placeholder={readOnly ? "-" : ""}
        inputProps={{ min: key === "workers" ? 1 : 0, step: key === "workers" ? 1 : "any", "aria-label": aria }}
        InputProps={unit ? { endAdornment: <InputAdornment position="end">{unit}</InputAdornment> } : undefined}
        error={!!error}
        helperText={error || helper}
      />
    );
    return (
      <StepCard
        key={s.key}
        index={si}
        count={rows.length}
        name={s.name}
        editing={editing}
        onMoveUp={() => moveStep(si, -1)}
        onMoveDown={() => moveStep(si, 1)}
        onRemove={() => removeStep(s, si)}
      >
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
          <TextField
            label="Step Name"
            required={!readOnly}
            disabled={readOnly}
            size="small"
            value={s.name}
            onChange={(e) => updateStep(s.key, { name: e.target.value })}
            placeholder={readOnly ? "-" : "e.g. Cutting, Sewing, Finishing, Packing"}
            inputProps={{ maxLength: 150, "aria-label": `Name of step ${si + 1}` }}
            error={!!nErr}
            helperText={nErr || " "}
          />
          {readOnly ? (
            <TextField
              label="Work Center"
              disabled
              size="small"
              value={center ? centerLabel(center) : ""}
              placeholder="-"
              inputProps={{ "aria-label": `Work center of step ${si + 1}` }}
              helperText={s.work_area ? `Work area: ${s.work_area}` : " "}
            />
          ) : (
            <TextField
              select
              label="Work Center"
              size="small"
              value={s.work_center_id ?? ""}
              onChange={(e) => {
                const id = e.target.value === "" ? null : Number(e.target.value);
                updateStep(s.key, {
                  work_center_id: id,
                  work_center: centerOptions(s).find((w) => w.id === id) ?? null,
                });
              }}
              inputProps={{ "aria-label": `Work center of step ${si + 1}` }}
              helperText={
                s.work_area
                  ? `Work area: ${s.work_area}`
                  : workCenters.length
                    ? "From Manufacturing › Work Centers"
                    : "No work centers yet (Manufacturing › Work Centers)"
              }
            >
              <MenuItem value="">
                <em>None</em>
              </MenuItem>
              {centerOptions(s).map((w) => (
                <MenuItem key={w.id} value={w.id}>
                  {centerLabel(w)}
                </MenuItem>
              ))}
            </TextField>
          )}
        </Box>
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr 1fr", md: outside ? "repeat(5, 1fr)" : "repeat(4, 1fr)" },
          }}
        >
          {num("Setup time", s.setup, "setup", `Setup minutes of step ${si + 1}`, "min", err(s.setup), "Per batch")}
          {num("Run time / unit", s.minutes, "minutes", `Minutes per unit of step ${si + 1}`, "min", err(s.minutes))}
          {num("Workers", s.workers, "workers", `Workers of step ${si + 1}`, null, wErr)}
          {num(
            "Move / wait time",
            s.move,
            "move",
            `Move minutes of step ${si + 1}`,
            "min",
            err(s.move),
            "Before the next step",
          )}
          {outside &&
            num(
              "Outside cost / unit",
              s.outside_cost,
              "outside_cost",
              `Outside cost of step ${si + 1}`,
              null,
              err(s.outside_cost),
              "Charged by the supplier",
            )}
        </Box>
        <TextField
          label="Instructions"
          disabled={readOnly}
          size="small"
          fullWidth
          multiline
          minRows={2}
          maxRows={8}
          value={s.instructions}
          onChange={(e) => updateStep(s.key, { instructions: e.target.value })}
          placeholder={readOnly ? "-" : "How this step is done, checks, machine settings..."}
          inputProps={{ maxLength: MAX_TEXT, "aria-label": `Instructions of step ${si + 1}` }}
          sx={{ mb: 2 }}
        />

        {/* Materials used in this step */}
        <Box sx={{ bgcolor: "action.hover", borderRadius: 1.5, p: 1.5 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              mb: s.materials.length || editing ? 1.5 : 0,
              flexWrap: "wrap",
            }}
          >
            <Typography variant="subtitle2" fontWeight={600}>
              Materials
            </Typography>
            <Chip size="small" label={s.materials.length} />
            {editing && (
              <Box sx={{ ml: "auto", display: "flex", gap: 1, flexWrap: "wrap" }}>
                <Tooltip title={addTip(s)}>
                  <span>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<DesignServicesOutlinedIcon fontSize="small" />}
                      onClick={() => importFromDesignDetail(s)}
                      disabled={busy || !remainingFor(s).length}
                    >
                      Add All from Design Detail
                    </Button>
                  </span>
                </Tooltip>
                <Tooltip title={addTip(s)}>
                  <span>
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<AddIcon />}
                      onClick={() => addMaterial(s)}
                      disabled={busy || !remainingFor(s).length}
                    >
                      Add Material
                    </Button>
                  </span>
                </Tooltip>
              </Box>
            )}
          </Box>
          {s.materials.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {editing
                ? "No materials in this step (fine for steps like Inspection). Materials are picked from the Design Detail items."
                : "No materials used in this step."}
            </Typography>
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              {s.materials.map((m, mi) => renderMaterial(s, m, mi, si))}
            </Box>
          )}
        </Box>
      </StepCard>
    );
  };

  const view = isLoading ? (
    <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
      <CircularProgress size={28} />
    </Box>
  ) : isError ? (
    <Alert severity="error" action={<Button onClick={() => refetch()}>Retry</Button>}>
      Could not load the BOM structure.
    </Alert>
  ) : (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
      <DocStatusAlerts doc={structure} noun="BOM structure" canEdit={canEdit} editing={editing} />

      {rows.length === 0 && !editing ? (
        <Paper variant="outlined">
          <EmptyLines
            icon={<AccountTreeOutlinedIcon />}
            title="No BOM structure yet"
            text={
              canChange
                ? 'Click "Edit" to list the steps this product goes through until it is packed (e.g. Cutting, Sewing, Packing) and the materials used in each.'
                : "No steps have been added for this product."
            }
          />
        </Paper>
      ) : (
        <>
          <ProcessFlow
            steps={rows.map((s) => ({
              name: s.name.trim(),
              minutes: s.minutes.trim() && Number.isFinite(Number(s.minutes)) ? Number(s.minutes) : null,
              materialCount: s.materials.length,
            }))}
          />
          {rows.map(renderStep)}
          {editing && (
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => setSteps((prev) => [...prev, blankStep()])}
              disabled={busy}
              sx={{ alignSelf: "flex-start" }}
            >
              Add Step
            </Button>
          )}
        </>
      )}

      {(editing || structure?.notes) && (
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
            value={editing ? notes : (structure?.notes ?? "")}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything that applies to the whole process (quality standards, special handling...)"
            inputProps={{ maxLength: MAX_TEXT, "aria-label": "General Notes" }}
          />
        </Paper>
      )}

      {structure && !editing && <AuditCaption doc={structure} />}

      <RejectReasonDialog
        open={rejectOpen}
        title="Reject BOM Structure"
        reason={rejectReason}
        onReasonChange={setRejectReason}
        onClose={() => setRejectOpen(false)}
        onSubmit={() => runOnce(() => rejectMut.mutate())}
        pending={rejectMut.isPending}
        placeholder="e.g., Washing step missing, wrong fabric quantity..."
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
