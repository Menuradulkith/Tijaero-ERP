/**
 * Warehouse > Stock Counts > count sheet. While the count is "counting" the user
 * enters counted quantities (serial lines: Found / Missing), adds found items and
 * saves; posting writes the differences to stock (count adjustments) and posts a
 * journal entry. Posted / cancelled counts are read-only.
 */
import { PERMISSIONS, usePermission } from "@/auth/permissions";
import {
  TChip,
  TConfirmDialog,
  TDataGrid,
  fmtLKR,
  handleApiError,
  showErrorToast,
  showSuccessToast,
  useTConfirmDialog,
  type TDataGridColumn,
} from "@/components/tijaero";
import { KpiSparkCard } from "@/components/dashboard";
import { useReferenceData } from "@/hooks";
import { useCurrencyStore } from "@/state/currencyStore";
import { useFormGuardStore } from "@/state/formGuardStore";
import {
  Add as AddIcon,
  ArrowBack as ArrowBackIcon,
  Block as CancelIcon,
  CheckCircle as CountedIcon,
  DeleteOutline as DeleteIcon,
  Difference as DifferenceIcon,
  Download as DownloadIcon,
  FormatListNumbered as LinesIcon,
  Payments as NetIcon,
  PlaylistAddCheck as FillIcon,
  Publish as PostIcon,
  Save as SaveIcon,
  Search as SearchIcon,
  TrendingDown as LossIcon,
  TrendingUp as GainIcon,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  Link as MuiLink,
  Paper,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import { errorAlreadyToasted } from "../api";
import AddFoundItemDialog from "../components/AddFoundItemDialog";
import {
  fmtDate,
  fmtDateTime,
  fmtQty,
  stockCountApi,
  stockCountStatusOption,
  type StockCount,
  type StockCountLine,
  type StockCountLineUpdate,
} from "../stockCountApi";

/** Unsaved input for one line: raw text as typed. */
interface LineEdit {
  counted?: string;
  remark?: string;
}

/** A line as shown in the grid: the saved line plus the effect of unsaved input. */
interface SheetRow extends StockCountLine {
  countedText: string;
  remarkText: string;
  effCounted: number | null;
  effDifference: number | null;
  effDifferenceValue: number | null;
  invalid: boolean;
}

type P = GridRenderCellParams<SheetRow>;

const isSerialLine = (l: StockCountLine) => l.tracking_type === "serial";

/** Parse a typed counted quantity: "" = not counted, NaN = invalid. */
const parseCounted = (text: string): number | null => (text.trim() === "" ? null : Number(text));

const round = (v: number) => Math.round(v * 1e6) / 1e6;

const stopGridKeys = (e: React.KeyboardEvent) => e.stopPropagation();

function InfoItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ wordBreak: "break-word" }}>
        {children || "-"}
      </Typography>
    </Box>
  );
}

export default function StockCountDetailPage() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const canViewCost = usePermission(PERMISSIONS.COST_PRICE_VIEW.resource, PERMISSIONS.COST_PRICE_VIEW.action);
  const canCount = usePermission(PERMISSIONS.STOCK_COUNT_CREATE.resource, PERMISSIONS.STOCK_COUNT_CREATE.action);
  const canPost = usePermission(PERMISSIONS.STOCK_COUNT_POST.resource, PERMISSIONS.STOCK_COUNT_POST.action);
  const confirmDialog = useTConfirmDialog();

  const detailKey = useMemo(() => ["stockCounts", "detail", id], [id]);
  const { data: count, isLoading, isError } = useQuery({
    queryKey: detailKey,
    queryFn: () => stockCountApi.get(id),
    enabled: Number.isFinite(id) && id > 0,
    staleTime: 0,
  });

  const { filteredLocations } = useReferenceData(["locations"]);
  const branchLocations = useMemo(
    () => (filteredLocations || []).filter((l) => !count || l.branch_code === count.branch_code),
    [filteredLocations, count],
  );

  const isCounting = count?.status === "counting";
  const editable = isCounting && canCount;
  const lines = useMemo(() => count?.lines || [], [count]);

  // ── Unsaved input ──────────────────────────────────────────────────────
  const [edits, setEdits] = useState<Record<number, LineEdit>>({});
  const setLineEdit = useCallback((lineId: number, patch: LineEdit) => {
    setEdits((cur) => ({ ...cur, [lineId]: { ...cur[lineId], ...patch } }));
  }, []);

  // Another count opened in the same page instance: drop the old input.
  useEffect(() => {
    setEdits({});
  }, [id]);

  const rows: SheetRow[] = useMemo(
    () =>
      lines.map((l) => {
        const e = edits[l.id];
        const countedText = e?.counted ?? (l.counted_quantity === null ? "" : String(l.counted_quantity));
        const remarkText = e?.remark ?? (l.remark || "");
        const effCounted = e?.counted !== undefined ? parseCounted(e.counted) : l.counted_quantity;
        const invalid =
          effCounted !== null &&
          (!Number.isFinite(effCounted) || effCounted < 0 || (isSerialLine(l) && effCounted !== 0 && effCounted !== 1));
        const effDifference =
          effCounted === null || invalid
            ? null
            : e?.counted !== undefined
              ? round(effCounted - l.system_quantity)
              : l.difference ?? round(effCounted - l.system_quantity);
        const effDifferenceValue =
          effDifference === null
            ? null
            : e?.counted !== undefined
              ? round(effDifference * l.unit_cost)
              : l.difference_value ?? round(effDifference * l.unit_cost);
        return { ...l, countedText, remarkText, effCounted: invalid ? null : effCounted, effDifference, effDifferenceValue, invalid };
      }),
    [lines, edits],
  );

  /** Lines whose input differs from what is saved, as the PUT payload. */
  const changedLines: StockCountLineUpdate[] = useMemo(() => {
    const out: StockCountLineUpdate[] = [];
    rows.forEach((r) => {
      const e = edits[r.id];
      if (!e || r.invalid) return;
      const countedChanged = e.counted !== undefined && r.effCounted !== r.counted_quantity;
      const newRemark = r.remarkText.trim() || null;
      const remarkChanged = e.remark !== undefined && newRemark !== (r.remark || null);
      if (countedChanged || remarkChanged) out.push({ id: r.id, counted_quantity: r.effCounted, remark: newRemark });
    });
    return out;
  }, [rows, edits]);

  const invalidCount = rows.filter((r) => r.invalid).length;
  const dirty = changedLines.length > 0 || invalidCount > 0;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Global unsaved-changes guard (sidebar, header, browser reload).
  const setGuardDirty = useFormGuardStore((s) => s.setDirty);
  const setDiscardFn = useFormGuardStore((s) => s.setDiscardFn);
  useEffect(() => {
    setGuardDirty(dirty);
    setDiscardFn(dirty ? () => setEdits({}) : null);
  }, [dirty, setGuardDirty, setDiscardFn]);
  useEffect(
    () => () => {
      setGuardDirty(false);
      setDiscardFn(null);
    },
    [setGuardDirty, setDiscardFn],
  );

  const confirmLeave = useCallback(async () => {
    if (!dirtyRef.current) return true;
    const ok = await confirmDialog.confirm({
      title: "Discard Changes",
      message: "You have unsaved counts. Discard them?",
      confirmText: "Discard",
      cancelText: "Keep Editing",
      confirmColor: "warning",
    });
    if (ok) {
      setEdits({});
      setGuardDirty(false);
    }
    return ok;
  }, [confirmDialog, setGuardDirty]);

  const guardedNavigate = useCallback(
    async (to: string) => {
      if (await confirmLeave()) navigate(to);
    },
    [confirmLeave, navigate],
  );

  // ── Totals (live while counting) ───────────────────────────────────────
  const totals = useMemo(() => {
    if (!count) return null;
    if (!lines.length || !dirty) {
      return {
        lines: count.line_count,
        counted: count.counted_count,
        differences: count.difference_count,
        gain: Math.abs(count.gain_value),
        loss: Math.abs(count.loss_value),
        net: count.net_value,
      };
    }
    let counted = 0;
    let differences = 0;
    let gain = 0;
    let loss = 0;
    rows.forEach((r) => {
      if (r.effCounted === null) return;
      counted += 1;
      if (r.effDifference) differences += 1;
      const v = r.effDifferenceValue || 0;
      if (v > 0) gain += v;
      else loss += -v;
    });
    return { lines: rows.length, counted, differences, gain: round(gain), loss: round(loss), net: round(gain - loss) };
  }, [count, lines.length, dirty, rows]);

  const uncounted = totals ? totals.lines - totals.counted : 0;

  // ── Filters ────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const [onlyUncounted, setOnlyUncounted] = useState(false);
  // The toggles look at saved values, so a row does not vanish while it is being typed in.
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyDifferences && !(r.difference && r.counted_quantity !== null)) return false;
      if (onlyUncounted && r.counted_quantity !== null) return false;
      if (!q) return true;
      return [r.material_item_code, r.material_name, r.location_name, r.batch_no, r.barcode, r.remark]
        .some((v) => (v || "").toLowerCase().includes(q));
    });
  }, [rows, search, onlyDifferences, onlyUncounted]);

  // ── Mutations ──────────────────────────────────────────────────────────
  const applyCount = useCallback(
    (updated: StockCount) => {
      queryClient.setQueryData(detailKey, updated);
      void queryClient.invalidateQueries({ queryKey: ["stockCounts", "list"] });
    },
    [queryClient, detailKey],
  );
  const toastError = (fallback: string) => (error: unknown) => {
    if (!errorAlreadyToasted(error)) showErrorToast(handleApiError(error, fallback));
  };

  const sentEditsRef = useRef<Record<number, LineEdit>>({});
  const saveMutation = useMutation({
    mutationFn: (payload: StockCountLineUpdate[]) => stockCountApi.updateLines(id, payload),
    onSuccess: (updated) => {
      applyCount(updated);
      const sent = sentEditsRef.current;
      // Keep input typed while the save was in flight.
      setEdits((cur) => {
        const next = { ...cur };
        Object.keys(sent).forEach((k) => {
          const key = Number(k);
          if (next[key] === sent[key]) delete next[key];
        });
        return next;
      });
      showSuccessToast("Counts saved");
    },
    onError: toastError("Could not save the counts"),
  });

  const save = () => {
    if (!changedLines.length || invalidCount || saveMutation.isPending) return;
    sentEditsRef.current = edits;
    saveMutation.mutate(changedLines);
  };

  const fillUncounted = () => {
    setEdits((cur) => {
      const next = { ...cur };
      rows.forEach((r) => {
        if (r.effCounted === null && !r.invalid) next[r.id] = { ...next[r.id], counted: String(r.system_quantity) };
      });
      return next;
    });
  };

  const deleteMutation = useMutation({
    mutationFn: (lineId: number) => stockCountApi.deleteLine(id, lineId),
    onSuccess: (updated, lineId) => {
      applyCount(updated);
      setEdits((cur) => {
        const next = { ...cur };
        delete next[lineId];
        return next;
      });
      showSuccessToast("Found item removed");
    },
    onError: toastError("Could not remove the line"),
  });

  const deleteLine = useCallback(
    async (line: StockCountLine) => {
      const ok = await confirmDialog.confirm({
        title: "Remove Found Item",
        message: `Remove ${[line.material_item_code, line.material_name].filter(Boolean).join(" — ")} from this count?`,
        confirmText: "Remove",
        cancelText: "Keep",
        confirmColor: "error",
      });
      if (ok) deleteMutation.mutate(line.id);
    },
    [confirmDialog, deleteMutation],
  );

  const postMutation = useMutation({
    mutationFn: () => stockCountApi.post(id),
    onSuccess: (updated) => {
      applyCount(updated);
      void queryClient.invalidateQueries({ queryKey: ["warehouseStock"] });
      showSuccessToast(`${updated.count_no} posted`);
    },
    onError: toastError("Could not post the stock count"),
  });

  const post = async () => {
    if (!count) return;
    const fmt = (v: number) => `${currencySymbol} ${fmtLKR(v)}`;
    const ok = await confirmDialog.confirm({
      title: `Post ${count.count_no}`,
      message: "This updates stock and posts a journal entry. It cannot be undone.",
      detailsLines: canViewCost
        ? [
            { label: "Differences", value: count.difference_count.toLocaleString() },
            { label: "Gain value", value: fmt(Math.abs(count.gain_value)), color: "success.main" },
            { label: "Loss value", value: fmt(Math.abs(count.loss_value)), color: "error.main" },
            { label: "Net value", value: fmt(count.net_value), color: count.net_value < 0 ? "error.main" : undefined, strong: true },
          ]
        : [{ label: "Differences", value: count.difference_count.toLocaleString() }],
      confirmText: "Post",
      cancelText: "Not yet",
      confirmColor: "primary",
      type: "warning",
    });
    if (ok) postMutation.mutate();
  };

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState("");
  const cancelMutation = useMutation({
    mutationFn: () => stockCountApi.cancel(id, cancelReason.trim()),
    onSuccess: (updated) => {
      applyCount(updated);
      setEdits({});
      setCancelOpen(false);
      showSuccessToast(`${updated.count_no} cancelled`);
    },
    onError: (e) => setCancelError(handleApiError(e, "Could not cancel the stock count")),
  });

  const [addOpen, setAddOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    if (!count) return;
    setExporting(true);
    try {
      await stockCountApi.exportCsv(count.id, `${count.count_no}.csv`);
    } catch (error) {
      toastError("Could not export the count sheet")(error);
    } finally {
      setExporting(false);
    }
  };

  // ── Grid ───────────────────────────────────────────────────────────────
  // Cell handlers go through a ref so the columns (and the inputs in them) stay stable.
  const cellActionsRef = useRef({ guardedNavigate, deleteLine });
  cellActionsRef.current = { guardedNavigate, deleteLine };

  const columns = useMemo(() => {
    const diffCell = (v: number | null, money = false) => {
      if (v === null) return <Typography variant="body2" color="text.secondary">-</Typography>;
      if (!v) return <Typography variant="body2" color="text.secondary">0</Typography>;
      const text = money ? fmtLKR(Math.abs(v)) : fmtQty(Math.abs(v));
      return (
        <Typography variant="body2" fontWeight={600} color={v > 0 ? "success.main" : "error.main"}>
          {v > 0 ? `+${text}` : `−${text}`}
        </Typography>
      );
    };

    const cols: TDataGridColumn<SheetRow>[] = [
      {
        field: "material_item_code",
        header: "Item Code",
        width: 120,
        sortable: true,
        renderCell: (p: P) => p.row.material_item_code || "-",
      },
      {
        field: "material_name",
        header: "Item",
        flex: 1,
        minWidth: 180,
        sortable: true,
        renderCell: (p: P) => {
          const to = `/materials/item-catalog?focus=${p.row.material_id}`;
          return (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
              <MuiLink
                component={RouterLink}
                to={to}
                underline="hover"
                noWrap
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  if (dirtyRef.current) {
                    e.preventDefault();
                    void cellActionsRef.current.guardedNavigate(to);
                  }
                }}
              >
                {p.row.material_name || `Item #${p.row.material_id}`}
              </MuiLink>
              {p.row.is_found && <TChip size="small" label="Found" color="info" variant="outlined" />}
            </Box>
          );
        },
      },
      { field: "location_name", header: "Location", width: 130, sortable: true, renderCell: (p: P) => p.row.location_name || "-" },
      {
        field: "batch_serial",
        header: "Batch / Serial",
        width: 150,
        sortable: false,
        renderCell: (p: P) => (
          <span style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>
            {p.row.barcode || (p.row.batch_no ? `Batch ${p.row.batch_no}` : "-")}
          </span>
        ),
      },
      { field: "expiry_date", header: "Expiry", width: 110, sortable: true, renderCell: (p: P) => fmtDate(p.row.expiry_date) },
      { field: "unit_of_measure", header: "UOM", width: 70, sortable: false, renderCell: (p: P) => p.row.unit_of_measure || "-" },
      {
        field: "system_quantity",
        header: "System Qty",
        width: 100,
        align: "right",
        sortable: true,
        renderCell: (p: P) => fmtQty(p.row.system_quantity),
      },
      {
        field: "counted_quantity",
        header: "Counted Qty",
        width: editable ? 170 : 110,
        align: editable ? "center" : "right",
        sortable: false,
        hideOnMobile: false,
        renderCell: (p: P) => {
          const r = p.row;
          if (!editable) {
            if (r.counted_quantity === null) return <Typography variant="body2" color="text.secondary">Not counted</Typography>;
            if (isSerialLine(r)) return r.counted_quantity === 1 ? "Found" : "Missing";
            return fmtQty(r.counted_quantity);
          }
          if (isSerialLine(r)) {
            const value = r.effCounted === 1 ? "1" : r.effCounted === 0 ? "0" : null;
            return (
              <ToggleButtonGroup
                size="small"
                exclusive
                value={value}
                onChange={(_, v: string | null) => setLineEdit(r.id, { counted: v ?? "" })}
                onKeyDown={stopGridKeys}
                sx={{ "& .MuiToggleButton-root": { py: 0.25, px: 1, textTransform: "none", fontSize: "0.75rem" } }}
              >
                <ToggleButton value="1" color="success">
                  Found
                </ToggleButton>
                <ToggleButton value="0" color="error">
                  Missing
                </ToggleButton>
              </ToggleButtonGroup>
            );
          }
          return (
            <TextField
              size="small"
              type="number"
              value={r.countedText}
              placeholder="—"
              onChange={(e) => setLineEdit(r.id, { counted: e.target.value })}
              onKeyDown={stopGridKeys}
              error={r.invalid}
              inputProps={{ min: 0, step: "any", style: { textAlign: "right", padding: "4px 8px" }, "aria-label": "Counted quantity" }}
              sx={{ width: "100%" }}
            />
          );
        },
      },
      {
        field: "difference",
        header: "Difference",
        width: 100,
        align: "right",
        sortable: false,
        renderCell: (p: P) => diffCell(p.row.effDifference),
      },
    ];
    if (canViewCost) {
      cols.push(
        {
          field: "unit_cost",
          header: `Unit Cost (${currencySymbol})`,
          width: 120,
          align: "right",
          sortable: false,
          renderCell: (p: P) => fmtLKR(p.row.unit_cost),
        },
        {
          field: "difference_value",
          header: `Difference Value (${currencySymbol})`,
          width: 150,
          align: "right",
          sortable: false,
          renderCell: (p: P) => diffCell(p.row.effDifferenceValue, true),
        },
      );
    }
    cols.push({
      field: "remark",
      header: "Remark",
      width: 200,
      sortable: false,
      renderCell: (p: P) =>
        editable ? (
          <TextField
            size="small"
            value={p.row.remarkText}
            onChange={(e) => setLineEdit(p.row.id, { remark: e.target.value })}
            onKeyDown={stopGridKeys}
            inputProps={{ maxLength: 500, style: { padding: "4px 8px" }, "aria-label": "Remark" }}
            sx={{ width: "100%" }}
          />
        ) : (
          p.row.remark || "-"
        ),
    });
    if (editable) {
      cols.push({
        field: "actions",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        renderCell: (p: P) =>
          p.row.is_found ? (
            <Tooltip title="Remove found item">
              <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); void cellActionsRef.current.deleteLine(p.row); }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null,
      });
    }
    return cols;
  }, [editable, canViewCost, currencySymbol, setLineEdit]);

  // ── Render ─────────────────────────────────────────────────────────────
  const pageSx = {
    display: "flex",
    flexDirection: "column" as const,
    height: "100%",
    gap: 2,
    p: { xs: 1.5, md: 2 },
    overflow: "auto",
  };

  if (!Number.isFinite(id) || id <= 0 || isError) {
    return (
      <Box sx={pageSx}>
        <Alert severity="error">Could not load this stock count. It may not exist, or try again in a moment.</Alert>
        <Box>
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate("/warehouse/stock-counts")}>
            Back to Stock Counts
          </Button>
        </Box>
      </Box>
    );
  }

  if (isLoading || !count || !totals) {
    return (
      <Box sx={{ ...pageSx, alignItems: "center", justifyContent: "center" }}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  const status = stockCountStatusOption(count.status);
  const money = (v: number) => (canViewCost ? `${currencySymbol} ${fmtLKR(v)}` : "—");
  const savedUncounted = count.line_count - count.counted_count;
  const postBlockedReason = dirty
    ? "Save your counts before posting"
    : savedUncounted > 0
      ? `Count every line before posting (${savedUncounted.toLocaleString()} left)`
      : "";

  const tiles: { title: string; value: string; icon: ReactNode; color: "primary" | "success" | "warning" | "info" | "error" | "secondary" }[] = [
    { title: "Lines", value: totals.lines.toLocaleString(), icon: <LinesIcon />, color: "primary" },
    {
      title: "Counted",
      value: `${totals.counted.toLocaleString()}/${totals.lines.toLocaleString()}`,
      icon: <CountedIcon />,
      color: uncounted > 0 ? "warning" : "success",
    },
    { title: "Differences", value: totals.differences.toLocaleString(), icon: <DifferenceIcon />, color: totals.differences ? "warning" : "info" },
  ];
  if (canViewCost) {
    tiles.push(
      { title: "Gain Value", value: money(totals.gain), icon: <GainIcon />, color: "success" },
      { title: "Loss Value", value: money(totals.loss), icon: <LossIcon />, color: "error" },
      { title: "Net Value", value: money(totals.net), icon: <NetIcon />, color: totals.net < 0 ? "error" : "secondary" },
    );
  }

  return (
    <Box
      sx={(theme) => ({
        ...pageSx,
        background:
          theme.palette.mode === "dark"
            ? `linear-gradient(180deg, ${theme.palette.background.default} 0%, ${theme.palette.background.paper} 280px)`
            : "linear-gradient(180deg, #f6f8fc 0%, #ffffff 280px)",
      })}
    >
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
          <Tooltip title="Back to Stock Counts">
            <IconButton size="small" onClick={() => void guardedNavigate("/warehouse/stock-counts")}>
              <ArrowBackIcon />
            </IconButton>
          </Tooltip>
          <Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography variant="h6" fontWeight={600}>
                Stock count {count.count_no}
              </Typography>
              <TChip size="small" label={status.label} color={status.color} sx={{ fontWeight: 500 }} />
            </Box>
            <Typography variant="body2" color="text.secondary">
              {[count.branch_name || count.branch_code, count.location_name || "All locations", count.category_name || "All categories"].join(" · ")}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={exportCsv} disabled={exporting}>
            {exporting ? "Exporting..." : "Export count sheet"}
          </Button>
          {editable && (
            <>
              <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>
                Add found item
              </Button>
              <Button size="small" variant="outlined" startIcon={<FillIcon />} onClick={fillUncounted} disabled={uncounted === 0}>
                Fill uncounted with system qty
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<CancelIcon />}
                onClick={() => {
                  setCancelReason("");
                  setCancelError("");
                  setCancelOpen(true);
                }}
              >
                Cancel count
              </Button>
              <Button
                size="small"
                variant="contained"
                startIcon={<SaveIcon />}
                onClick={save}
                disabled={!changedLines.length || invalidCount > 0 || saveMutation.isPending}
              >
                {saveMutation.isPending ? "Saving..." : `Save counts${changedLines.length ? ` (${changedLines.length})` : ""}`}
              </Button>
            </>
          )}
          {isCounting && canPost && (
            <Tooltip title={postBlockedReason}>
              <span>
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  startIcon={<PostIcon />}
                  onClick={post}
                  disabled={!!postBlockedReason || postMutation.isPending}
                >
                  {postMutation.isPending ? "Posting..." : "Post"}
                </Button>
              </span>
            </Tooltip>
          )}
        </Box>
      </Box>

      {count.status === "cancelled" && (
        <Alert severity="warning">This stock count was cancelled{count.cancel_reason ? `: ${count.cancel_reason}` : "."}</Alert>
      )}
      {invalidCount > 0 && (
        <Alert severity="error">
          {invalidCount === 1 ? "One line has" : `${invalidCount} lines have`} an invalid counted quantity (must be 0 or more).
        </Alert>
      )}

      {/* Info */}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Grid container spacing={2}>
          <Grid item xs={6} sm={4} md={2}>
            <InfoItem label="Branch">{count.branch_name || count.branch_code}</InfoItem>
          </Grid>
          <Grid item xs={6} sm={4} md={2}>
            <InfoItem label="Location">{count.location_name || "All locations"}</InfoItem>
          </Grid>
          <Grid item xs={6} sm={4} md={2}>
            <InfoItem label="Item category">{count.category_name || "All categories"}</InfoItem>
          </Grid>
          <Grid item xs={6} sm={4} md={2}>
            <InfoItem label="Created">
              {count.created_by_name || "-"}
              <Typography variant="caption" color="text.secondary" display="block">
                {fmtDateTime(count.created_at)}
              </Typography>
            </InfoItem>
          </Grid>
          {count.status === "posted" && (
            <>
              <Grid item xs={6} sm={4} md={2}>
                <InfoItem label="Posted">
                  {count.posted_by_name || "-"}
                  <Typography variant="caption" color="text.secondary" display="block">
                    {fmtDateTime(count.posted_at)}
                  </Typography>
                </InfoItem>
              </Grid>
              <Grid item xs={6} sm={4} md={2}>
                <InfoItem label="Journal entry">{count.journal_entry_no || "-"}</InfoItem>
              </Grid>
            </>
          )}
          {count.remark && (
            <Grid item xs={12}>
              <InfoItem label="Remark">{count.remark}</InfoItem>
            </Grid>
          )}
        </Grid>
      </Paper>

      {/* Totals */}
      <Grid container spacing={2}>
        {tiles.map((t) => (
          <Grid item xs={6} sm={4} lg={2} key={t.title}>
            <KpiSparkCard compact title={t.title} value={t.value} icon={t.icon} color={t.color} />
          </Grid>
        ))}
      </Grid>

      {/* Sheet filters */}
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
        <TextField
          size="small"
          placeholder="Search item, location, batch, serial..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
          sx={{ width: { xs: "100%", sm: 320 }, "& .MuiOutlinedInput-root": { borderRadius: "24px" } }}
        />
        <FormControlLabel
          control={<Switch size="small" checked={onlyDifferences} onChange={(e) => setOnlyDifferences(e.target.checked)} />}
          label="Only differences"
        />
        <FormControlLabel
          control={<Switch size="small" checked={onlyUncounted} onChange={(e) => setOnlyUncounted(e.target.checked)} />}
          label="Only uncounted"
        />
        {(onlyDifferences || onlyUncounted) && dirty && (
          <Typography variant="caption" color="text.secondary">
            Filters use saved counts.
          </Typography>
        )}
      </Paper>

      <Box sx={{ flex: 1, minHeight: 480, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <TDataGrid
          rows={visibleRows}
          columns={columns}
          getRowId={(r) => r.id}
          emptyMessage={search || onlyDifferences || onlyUncounted ? "No lines match your filters" : "No lines on this count"}
          autoHeight={false}
          height="100%"
          exportFileName={`stock_count_${count.count_no}`}
          pageSizeOptions={[25, 50, 100]}
          storageKey={editable ? "stock-count-sheet-edit" : "stock-count-sheet"}
        />
      </Box>

      {editable && (
        <AddFoundItemDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          count={count}
          locations={branchLocations}
          canViewCost={canViewCost}
          currencySymbol={currencySymbol}
          onAdded={(updated) => {
            applyCount(updated);
            setAddOpen(false);
            showSuccessToast("Found item added");
          }}
        />
      )}

      <Dialog open={cancelOpen} onClose={cancelMutation.isPending ? undefined : () => setCancelOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Cancel {count.count_no}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            A cancelled count does not change stock and cannot be reopened.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Reason"
            required
            multiline
            minRows={2}
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            inputProps={{ maxLength: 500 }}
          />
          {cancelError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {cancelError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelOpen(false)} disabled={cancelMutation.isPending}>
            Keep counting
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              setCancelError("");
              cancelMutation.mutate();
            }}
            disabled={!cancelReason.trim() || cancelMutation.isPending}
          >
            {cancelMutation.isPending ? "Cancelling..." : "Cancel count"}
          </Button>
        </DialogActions>
      </Dialog>

      <TConfirmDialog {...confirmDialog.dialogProps} />
    </Box>
  );
}
