/**
 * BOMsPage - Bills of Materials with routing
 *
 * A BOM lists the components (with scrap % and issue method) and the routing
 * operations (work center, setup and run time) that make `output_quantity`
 * units of a product. Draft BOMs are editable; activating one makes it usable
 * on production orders, and a change to an active BOM is made as a new version.
 * The cost roll-up can be pushed to the product's cost price (standard cost).
 */

import { useCurrencyStore } from "@/state/currencyStore";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import AddIcon from "@mui/icons-material/Add";
import ArchiveIcon from "@mui/icons-material/Archive";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import HistoryIcon from "@mui/icons-material/History";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PriceChangeIcon from "@mui/icons-material/PriceChange";
import SearchIcon from "@mui/icons-material/Search";
import StarIcon from "@mui/icons-material/Star";
import {
  Alert,
  Autocomplete,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { formatDateTimeReadable } from "@/utils/formatters";

import {
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  fmtLKR,
  FormSection,
  handleApiError,
  MasterDetailLayout,
  modernTableStyles,
  showErrorToast,
  TActivityHistoryPanel,
  TChip,
  TConfirmDialog,
  TDataGrid,
  type TDataGridColumn,
  TRemarkField,
  TStatusChip,
  TStatusFilter,
  useCrudMutation,
  useMasterDetailState,
  useTConfirmDialog,
} from "@/components/tijaero";

import { useReferenceData, type ProductRef } from "@/hooks";
import { usePermission } from "@/auth/permissions";
import { bomsApi, workCentersApi } from "@/modules/manufacturing/api";
import {
  BOM,
  BOM_STATUS_OPTIONS,
  BOMInput,
  BOMUpdateInput,
  IssueMethod,
  WorkCenter,
} from "@/modules/manufacturing/types";

interface BOMFormData {
  product_id: number;
  version: string;
  output_quantity: number;
  description: string;
}

const INITIAL_FORM_DATA: BOMFormData = {
  product_id: 0,
  version: "1",
  output_quantity: 1,
  description: "",
};

const resetFormFromBOM = (bom: BOM): BOMFormData => ({
  product_id: bom.product_id,
  version: bom.version,
  output_quantity: Number(bom.output_quantity),
  description: bom.description || "",
});

interface ItemLine {
  _id: string;
  product_id: number;
  quantity: number;
  scrap_pct: number;
  issue_method: IssueMethod;
  remark: string;
  // Display only, from the saved BOM (component name / cost as the server sees them)
  product_name?: string | null;
  product_code?: string | null;
  unit_of_measure?: string | null;
  saved_unit_cost?: number;
  is_manufactured?: boolean;
}

interface OperationLine {
  _id: string;
  name: string;
  work_center_id: number;
  setup_minutes: number;
  run_minutes: number;
  description: string;
  work_center_code?: string | null;
  work_center_name?: string | null;
}

const linesFromBOM = (bom: BOM): { items: ItemLine[]; operations: OperationLine[] } => ({
  items: bom.items.map((i) => ({
    _id: `item-${i.id}`,
    product_id: i.product_id,
    quantity: Number(i.quantity),
    scrap_pct: Number(i.scrap_pct),
    issue_method: i.issue_method,
    remark: i.remark || "",
    product_name: i.product_name,
    product_code: i.product_code,
    unit_of_measure: i.unit_of_measure,
    saved_unit_cost: Number(i.unit_cost),
    is_manufactured: i.is_manufactured,
  })),
  operations: bom.operations.map((o) => ({
    _id: `op-${o.id}`,
    name: o.name,
    work_center_id: o.work_center_id,
    setup_minutes: Number(o.setup_minutes),
    run_minutes: Number(o.run_minutes),
    description: o.description || "",
    work_center_code: o.work_center_code,
    work_center_name: o.work_center_name,
  })),
});

const numberOrZero = (value: string) => {
  const n = parseFloat(value);
  return isNaN(n) ? 0 : n;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// Planned minutes of an operation for `units` of output (setup + run, divided by efficiency).
const operationMinutes = (op: OperationLine, units: number, wc?: WorkCenter) =>
  round2((op.setup_minutes + op.run_minutes * units) / ((Number(wc?.efficiency_pct) || 100) / 100));

type BOMRow = BOM & {
  product_display: string;
  output_num: number;
  unit_cost_num: number;
};

export default function BOMsPage() {
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const queryClient = useQueryClient();
  const confirmDialog = useTConfirmDialog();

  const [itemLines, setItemLines] = useState<ItemLine[]>([]);
  const [operationLines, setOperationLines] = useState<OperationLine[]>([]);
  const [linesDirty, setLinesDirty] = useState(false);
  const [bomDetail, setBomDetail] = useState<BOM | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const handleBlur = (field: string) => setTouched((prev) => ({ ...prev, [field]: true }));

  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);
  const [versionDialogOpen, setVersionDialogOpen] = useState(false);
  const [newVersion, setNewVersion] = useState("");

  const {
    searchQuery,
    setSearchQuery,
    selectedItem: selectedBOM,
    setSelectedItem: setSelectedBOM,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    formData,
    setFormData,
    handleSelectItem,
    handleNew: handleNewBase,
    handleCancel: handleCancelBase,
    handleStartEdit: handleStartEditBase,
  } = useMasterDetailState<BOM, BOMFormData>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromBOM,
    defaultSortField: "bom_no",
    confirmUnsavedChanges: () => confirmDialog.confirm({
      title: "Discard Changes",
      message: "You have unsaved changes. Discard them?",
      confirmText: "Discard",
      cancelText: "Keep Editing",
      confirmColor: "warning",
    }),
    extraDirty: linesDirty,
    onDiscard: () => { setItemLines([]); setOperationLines([]); setLinesDirty(false); setBomDetail(null); },
  });

  const { data: referenceData } = useReferenceData(["products"], { productsLimit: 2000 });
  const products: ProductRef[] = useMemo(() => referenceData?.products || [], [referenceData]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const { data: workCenters = [] } = useQuery({
    queryKey: ["mfg-work-centers"],
    queryFn: () => workCentersApi.getAll(),
  });
  const workCenterById = useMemo(() => new Map(workCenters.map((w) => [w.id, w])), [workCenters]);

  const { data: boms, isLoading } = useQuery({
    queryKey: ["mfg-boms"],
    queryFn: () => bomsApi.getAll(),
  });

  const canCreate = usePermission("boms", "create");
  const canUpdate = usePermission("boms", "update");
  const canDeleteBOM = usePermission("boms", "delete");

  const isDraft = !selectedBOM || selectedBOM.status === "draft";
  const editable = isEditing || isCreating;

  // ─── loading a BOM's lines ─────────────────────────────────────────────
  // Tracks the most recently requested BOM so a slower, stale response can't
  // overwrite the lines of a BOM selected in the meantime.
  const latestRequestRef = useRef<number | null>(null);

  const applyDetail = useCallback((bom: BOM) => {
    const lines = linesFromBOM(bom);
    setBomDetail(bom);
    setItemLines(lines.items);
    setOperationLines(lines.operations);
    setLinesDirty(false);
  }, []);

  const handleSelectBOM = useCallback(async (bom: BOM) => {
    const selected = await handleSelectItem(bom);
    if (!selected) return;
    latestRequestRef.current = bom.id;
    setTouched({});
    setBomDetail(null);
    setItemLines([]);
    setOperationLines([]);
    setLinesDirty(false);
    try {
      const detail = await bomsApi.getById(bom.id);
      if (latestRequestRef.current !== bom.id) return;
      setSelectedBOM(detail);
      applyDetail(detail);
    } catch (error) {
      if (latestRequestRef.current !== bom.id) return;
      showErrorToast(handleApiError(error, "Failed to load BOM"));
    }
  }, [handleSelectItem, setSelectedBOM, applyDetail]);

  // A BOM returned by an action (save / activate / ...) becomes the open one.
  const showSaved = useCallback((bom: BOM) => {
    latestRequestRef.current = bom.id;
    setIsCreating(false);
    setIsEditing(false);
    setTouched({});
    setTimeout(async () => {
      await handleSelectItem(bom);
      setSelectedBOM(bom);
      applyDetail(bom);
    }, 0);
  }, [handleSelectItem, setSelectedBOM, setIsCreating, setIsEditing, applyDetail]);

  // ─── browse table ──────────────────────────────────────────────────────
  const rows: BOMRow[] = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = (boms || [])
      .filter((b) =>
        !q ||
        b.bom_no.toLowerCase().includes(q) ||
        (b.product_name || "").toLowerCase().includes(q) ||
        (b.product_code || "").toLowerCase().includes(q)
      )
      .filter((b) => !filterStatus || b.status === filterStatus);
    return filtered.map((b) => ({
      ...b,
      product_display: `${b.product_name || `Product ${b.product_id}`}${b.product_code ? ` (${b.product_code})` : ""}`,
      output_num: Number(b.output_quantity),
      unit_cost_num: Number(b.unit_cost),
    }));
  }, [boms, searchQuery, filterStatus]);

  const columns: TDataGridColumn<BOMRow>[] = useMemo(
    () => [
      {
        field: "bom_no",
        header: "BOM No",
        width: 130,
        renderCell: (params: GridRenderCellParams<BOMRow>) => (
          <Typography variant="body2" fontWeight={600}>{params.row.bom_no}</Typography>
        ),
      },
      { field: "product_display", header: "Product", flex: 1, minWidth: 220 },
      { field: "version", header: "Version", width: 90 },
      { field: "output_num", header: "Output Qty", width: 105, type: "number" },
      { field: "item_count", header: "Components", width: 115, type: "number" },
      { field: "operation_count", header: "Operations", width: 110, type: "number" },
      { field: "unit_cost_num", header: `Unit Cost (${currencySymbol})`, width: 140, type: "currency" },
      {
        field: "is_default",
        header: "Default",
        width: 85,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<BOMRow>) =>
          params.row.is_default ? (
            <Tooltip title="Default BOM for this product">
              <StarIcon fontSize="small" color="warning" />
            </Tooltip>
          ) : null,
      },
      {
        field: "status",
        header: "Status",
        width: 110,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<BOMRow>) => (
          <TStatusChip status={params.row.status} statusMap="bomStatus" size="small" />
        ),
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<BOMRow>) => (
          <Tooltip title="Open">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleSelectBOM(params.row); }}>
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [currencySymbol, handleSelectBOM]
  );

  // ─── line editing ──────────────────────────────────────────────────────
  const updateItem = (id: string, patch: Partial<ItemLine>) => {
    setItemLines((prev) => prev.map((l) => (l._id === id ? { ...l, ...patch } : l)));
    setLinesDirty(true);
  };
  const addItem = () => {
    setItemLines((prev) => [
      ...prev,
      { _id: `new-${Date.now()}`, product_id: 0, quantity: 1, scrap_pct: 0, issue_method: "manual", remark: "" },
    ]);
    setLinesDirty(true);
  };
  const removeItem = (id: string) => {
    setItemLines((prev) => prev.filter((l) => l._id !== id));
    setLinesDirty(true);
  };
  const updateOperation = (id: string, patch: Partial<OperationLine>) => {
    setOperationLines((prev) => prev.map((l) => (l._id === id ? { ...l, ...patch } : l)));
    setLinesDirty(true);
  };
  const addOperation = () => {
    setOperationLines((prev) => [
      ...prev,
      { _id: `new-${Date.now()}`, name: "", work_center_id: 0, setup_minutes: 0, run_minutes: 0, description: "" },
    ]);
    setLinesDirty(true);
  };
  const removeOperation = (id: string) => {
    setOperationLines((prev) => prev.filter((l) => l._id !== id));
    setLinesDirty(true);
  };

  // Unit cost of a component line: the saved BOM's figure until the product is
  // changed, otherwise the product's current cost price.
  const itemUnitCost = useCallback((line: ItemLine) => {
    const saved = bomDetail?.items.find((i) => `item-${i.id}` === line._id);
    if (saved && saved.product_id === line.product_id) return Number(saved.unit_cost);
    return Number(productById.get(line.product_id)?.cost_price) || 0;
  }, [bomDetail, productById]);

  const itemLineCost = (line: ItemLine) =>
    round2(line.quantity * (1 + line.scrap_pct / 100) * itemUnitCost(line));

  const operationCosts = useCallback((line: OperationLine, units: number) => {
    const wc = workCenterById.get(line.work_center_id);
    const minutes = operationMinutes(line, units, wc);
    return {
      minutes,
      labor: round2((minutes / 60) * (Number(wc?.labor_rate_per_hour) || 0)),
      overhead: round2((minutes / 60) * (Number(wc?.overhead_rate_per_hour) || 0)),
    };
  }, [workCenterById]);

  // Live roll-up while editing; the server's figures when viewing.
  const rollup = useMemo(() => {
    if (!editable && bomDetail) {
      return {
        material: Number(bomDetail.material_cost),
        labor: Number(bomDetail.labor_cost),
        overhead: Number(bomDetail.overhead_cost),
        total: Number(bomDetail.total_cost),
        unit: Number(bomDetail.unit_cost),
      };
    }
    const units = formData.output_quantity || 1;
    const material = round2(itemLines.reduce((sum, l) => sum + itemLineCost(l), 0));
    let labor = 0;
    let overhead = 0;
    operationLines.forEach((op) => {
      const c = operationCosts(op, units);
      labor += c.labor;
      overhead += c.overhead;
    });
    const total = round2(material + labor + overhead);
    return { material, labor: round2(labor), overhead: round2(overhead), total, unit: round2(total / units) };
  }, [editable, bomDetail, itemLines, operationLines, formData.output_quantity, operationCosts]); // eslint-disable-line react-hooks/exhaustive-deps

  const productCostPrice = bomDetail
    ? Number(bomDetail.product_cost_price)
    : Number(productById.get(formData.product_id)?.cost_price) || 0;
  const costDifference = round2(rollup.unit - productCostPrice);

  // ─── validation ────────────────────────────────────────────────────────
  const duplicateComponent = useMemo(() => {
    const ids = itemLines.map((l) => l.product_id).filter(Boolean);
    return ids.length !== new Set(ids).size;
  }, [itemLines]);

  const itemsValid =
    itemLines.length > 0 &&
    !duplicateComponent &&
    itemLines.every((l) =>
      l.product_id > 0 && l.product_id !== formData.product_id && l.quantity > 0 && l.scrap_pct >= 0 && l.scrap_pct < 100
    );
  const operationsValid = operationLines.every(
    (o) => !!o.name.trim() && o.work_center_id > 0 && o.setup_minutes >= 0 && o.run_minutes >= 0
  );
  const isFormValid =
    formData.product_id > 0 &&
    !!formData.version.trim() &&
    formData.output_quantity > 0 &&
    itemsValid &&
    operationsValid;

  // ─── mutations ─────────────────────────────────────────────────────────
  const invalidate = [["mfg-boms"]];

  const createMutation = useCrudMutation({
    mutationFn: bomsApi.create,
    invalidateQueryKeys: invalidate,
    successMessage: "BOM created as draft",
    errorMessage: "Failed to create BOM",
    onSuccess: showSaved,
  });
  const updateMutation = useCrudMutation({
    mutationFn: bomsApi.update,
    invalidateQueryKeys: invalidate,
    successMessage: "BOM updated",
    errorMessage: "Failed to update BOM",
    onSuccess: showSaved,
  });
  const deleteMutation = useCrudMutation({
    mutationFn: bomsApi.delete,
    invalidateQueryKeys: invalidate,
    successMessage: "BOM deleted",
    errorMessage: "Failed to delete BOM",
    onSuccess: () => { setSelectedBOM(null); setBomDetail(null); },
  });
  const activateMutation = useCrudMutation({
    mutationFn: bomsApi.activate,
    invalidateQueryKeys: invalidate,
    successMessage: "BOM activated",
    errorMessage: "Failed to activate BOM",
    onSuccess: showSaved,
  });
  const setDefaultMutation = useCrudMutation({
    mutationFn: bomsApi.setDefault,
    invalidateQueryKeys: invalidate,
    successMessage: "BOM set as the product's default",
    errorMessage: "Failed to set default BOM",
    onSuccess: showSaved,
  });
  const archiveMutation = useCrudMutation({
    mutationFn: bomsApi.archive,
    invalidateQueryKeys: invalidate,
    successMessage: "BOM archived",
    errorMessage: "Failed to archive BOM",
    onSuccess: showSaved,
  });
  const copyMutation = useCrudMutation({
    mutationFn: bomsApi.copy,
    invalidateQueryKeys: invalidate,
    successMessage: "New draft version created",
    errorMessage: "Failed to create new version",
    onSuccess: (bom) => { setVersionDialogOpen(false); showSaved(bom); },
  });
  const updateCostMutation = useCrudMutation({
    mutationFn: bomsApi.updateProductCost,
    invalidateQueryKeys: [...invalidate, ["referenceData"], ["products"]],
    successMessage: "Product cost price updated from the BOM roll-up",
    errorMessage: "Failed to update product cost",
    onSuccess: showSaved,
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isActing =
    activateMutation.isPending || setDefaultMutation.isPending || archiveMutation.isPending ||
    copyMutation.isPending || updateCostMutation.isPending;

  // Blocks a second Save click before the first one has settled.
  const savingRef = useRef(false);

  const handleSave = useCallback(() => {
    if (savingRef.current) return;
    const items = itemLines.map((l, idx) => ({
      sequence: (idx + 1) * 10,
      product_id: l.product_id,
      quantity: l.quantity,
      scrap_pct: l.scrap_pct,
      issue_method: l.issue_method,
      remark: l.remark.trim() || null,
    }));
    const operations = operationLines.map((o, idx) => ({
      sequence: (idx + 1) * 10,
      name: o.name.trim(),
      work_center_id: o.work_center_id,
      setup_minutes: o.setup_minutes,
      run_minutes: o.run_minutes,
      description: o.description.trim() || null,
    }));
    savingRef.current = true;
    const settle = { onSettled: () => { savingRef.current = false; } };
    if (isCreating) {
      const payload: BOMInput = {
        product_id: formData.product_id,
        version: formData.version.trim(),
        output_quantity: formData.output_quantity,
        description: formData.description.trim() || null,
        items,
        operations,
      };
      createMutation.mutate(payload, settle);
    } else if (selectedBOM) {
      const payload: BOMUpdateInput = {
        version: formData.version.trim(),
        output_quantity: formData.output_quantity,
        description: formData.description.trim() || null,
        items,
        operations,
      };
      updateMutation.mutate({ id: selectedBOM.id, data: payload }, settle);
    } else {
      savingRef.current = false;
    }
  }, [itemLines, operationLines, isCreating, selectedBOM, formData, createMutation, updateMutation]);

  const handleNew = useCallback(() => {
    handleNewBase();
    setBomDetail(null);
    setItemLines([]);
    setOperationLines([]);
    setLinesDirty(false);
    setTouched({});
  }, [handleNewBase]);

  const handleStartEdit = useCallback(() => {
    handleStartEditBase();
    setTouched({});
  }, [handleStartEditBase]);

  // Cancelling out of "New" returns to the browse table; cancelling an edit
  // restores the saved lines.
  const handleCancel = useCallback(() => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedBOM(null);
      setItemLines([]);
      setOperationLines([]);
    } else {
      handleCancelBase(rows);
      if (bomDetail) applyDetail(bomDetail);
    }
    setLinesDirty(false);
    setTouched({});
  }, [isCreating, handleCancelBase, rows, bomDetail, applyDetail, setIsCreating, setIsEditing, setSelectedBOM]);

  const handleBack = useCallback(() => {
    setSelectedBOM(null);
    setBomDetail(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [isCreating, setSelectedBOM, setIsCreating, setIsEditing]);

  const handleDelete = useCallback(async () => {
    if (!selectedBOM) return;
    const confirmed = await confirmDialog.confirm({
      title: "Delete BOM",
      message: `Delete draft BOM "${selectedBOM.bom_no}" (version ${selectedBOM.version})?`,
      confirmText: "Delete",
      confirmColor: "error",
    });
    if (confirmed) deleteMutation.mutate(selectedBOM.id);
  }, [selectedBOM, confirmDialog, deleteMutation]);

  const handleActivate = useCallback(async () => {
    if (!selectedBOM) return;
    const confirmed = await confirmDialog.confirm({
      title: "Activate BOM",
      message: `Activate ${selectedBOM.bom_no}? An active BOM can be used on production orders and can no longer be edited — changes are made as a new version.`,
      confirmText: "Activate",
      confirmColor: "primary",
    });
    if (confirmed) activateMutation.mutate(selectedBOM.id);
  }, [selectedBOM, confirmDialog, activateMutation]);

  const handleArchive = useCallback(async () => {
    if (!selectedBOM) return;
    const confirmed = await confirmDialog.confirm({
      title: "Archive BOM",
      message: `Archive ${selectedBOM.bom_no}? New production orders can no longer use it; existing orders keep their lines.`,
      confirmText: "Archive",
      confirmColor: "warning",
    });
    if (confirmed) archiveMutation.mutate(selectedBOM.id);
  }, [selectedBOM, confirmDialog, archiveMutation]);

  const handleUpdateCost = useCallback(async () => {
    if (!selectedBOM || !bomDetail) return;
    const confirmed = await confirmDialog.confirm({
      title: "Update Product Cost",
      message:
        `Set the cost price of "${bomDetail.product_name}" to the rolled-up unit cost ` +
        `${currencySymbol} ${fmtLKR(Number(bomDetail.unit_cost))} (currently ${currencySymbol} ${fmtLKR(Number(bomDetail.product_cost_price))})?\n\n` +
        `This overwrites the product's cost price, which values finished-goods receipts from production ` +
        `and the cost of goods sold on future sales.`,
      confirmText: "Update Cost",
      confirmColor: "warning",
    });
    if (confirmed) updateCostMutation.mutate(selectedBOM.id);
  }, [selectedBOM, bomDetail, confirmDialog, updateCostMutation, currencySymbol]);

  const openVersionDialog = () => {
    const current = selectedBOM?.version || "";
    const asNumber = parseInt(current, 10);
    setNewVersion(!isNaN(asNumber) && String(asNumber) === current ? String(asNumber + 1) : "");
    setVersionDialogOpen(true);
  };

  const isDetailMode = !!selectedBOM || isCreating;
  const showError = (field: string) => touched[field] || isCreating;

  // Products a component line may use: never the BOM's own product.
  const componentOptions = useMemo(
    () => products.filter((p) => p.id !== formData.product_id),
    [products, formData.product_id]
  );
  const activeWorkCenters = useMemo(() => workCenters.filter((w) => w.active), [workCenters]);

  const productLabel = (p?: ProductRef | null) => (p ? `${p.name} (${p.item_code})` : "");

  const tablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<BOMRow>
          rows={rows}
          columns={columns}
          loading={isLoading}
          onRowClick={(row) => handleSelectBOM(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No bills of materials found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  const viewActions = selectedBOM && !isCreating && !isEditing ? (
    <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
      {canUpdate && selectedBOM.status === "draft" && (
        <Button size="small" variant="contained" startIcon={<CheckCircleIcon />} onClick={handleActivate} disabled={isActing || !bomDetail}>
          Activate
        </Button>
      )}
      {canUpdate && selectedBOM.status === "active" && !selectedBOM.is_default && (
        <Button size="small" variant="outlined" startIcon={<StarIcon />} onClick={() => setDefaultMutation.mutate(selectedBOM.id)} disabled={isActing}>
          Set as Default
        </Button>
      )}
      {canUpdate && selectedBOM.status === "active" && (
        <Button size="small" variant="outlined" startIcon={<PriceChangeIcon />} onClick={handleUpdateCost} disabled={isActing || !bomDetail}>
          Update Product Cost
        </Button>
      )}
      {canCreate && (
        <Button size="small" variant="outlined" startIcon={<ContentCopyIcon />} onClick={openVersionDialog} disabled={isActing}>
          New Version
        </Button>
      )}
      {canUpdate && selectedBOM.status === "active" && (
        <Button size="small" variant="outlined" color="warning" startIcon={<ArchiveIcon />} onClick={handleArchive} disabled={isActing}>
          Archive
        </Button>
      )}
    </Box>
  ) : undefined;

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Manufacturing", href: "/manufacturing" },
          { label: "Bills of Materials", href: "/manufacturing/boms" },
          ...(isDetailMode ? [{ label: isCreating ? "New BOM" : selectedBOM?.bom_no || "" }] : []),
        ]}
        title={selectedBOM ? `${selectedBOM.bom_no} · ${selectedBOM.product_name || ""} (v${selectedBOM.version})` : ""}
        titleIcon={<AccountTreeIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Bill of Materials"
        noSelectionTitle="Select a BOM"
      />

      <ActionToolbar
        hasSelectedItem={!!selectedBOM}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={isFormValid}
        canCreate={canCreate}
        canUpdate={canUpdate && isDraft && !!bomDetail}
        canDelete={canDeleteBOM && isDraft}
        canDuplicate={false}
        onNew={handleNew}
        onEdit={handleStartEdit}
        onSave={handleSave}
        onCancel={handleCancel}
        onDelete={handleDelete}
        endActions={viewActions}
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!isDetailMode ? (
          <EmptyState message="Select a BOM from the list or create a new one" />
        ) : (
          <>
            {selectedBOM && !editable && selectedBOM.status !== "draft" && (
              <Alert severity="info" sx={{ mb: 1.5 }}>
                {selectedBOM.status === "active"
                  ? "This BOM is active and read-only. Use New Version to change it."
                  : "This BOM is archived. Use New Version to bring it back as a draft."}
              </Alert>
            )}

            <FormSection title="BOM Information" columns={3}>
              <TextField label="BOM No" size="small" value={isCreating ? "Auto-generated" : selectedBOM?.bom_no || ""} disabled />
              <Autocomplete
                size="small"
                options={products}
                getOptionLabel={productLabel}
                value={productById.get(formData.product_id) || null}
                onChange={(_, p) => {
                  setFormData({ ...formData, product_id: p?.id || 0 });
                  handleBlur("product_id");
                }}
                disabled={!isCreating}
                isOptionEqualToValue={(o, v) => o.id === v.id}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Product"
                    required
                    placeholder={!isCreating && bomDetail ? `${bomDetail.product_name} (${bomDetail.product_code})` : undefined}
                    error={showError("product_id") && !formData.product_id}
                    helperText={showError("product_id") && !formData.product_id ? "Product is required" : "The product this BOM makes"}
                  />
                )}
              />
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                {selectedBOM && <TStatusChip status={selectedBOM.status} statusMap="bomStatus" />}
                {selectedBOM?.is_default && <TChip label="Default" size="small" color="warning" icon={<StarIcon fontSize="small" />} />}
              </Box>
              <TextField
                label="Version"
                size="small"
                required
                value={formData.version}
                onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                onBlur={() => handleBlur("version")}
                disabled={!editable}
                inputProps={{ maxLength: 20 }}
                error={showError("version") && !formData.version.trim()}
                helperText={showError("version") && !formData.version.trim() ? "Version is required" : undefined}
              />
              <TextField
                label="Output Quantity"
                size="small"
                type="number"
                required
                value={formData.output_quantity}
                onChange={(e) => setFormData({ ...formData, output_quantity: numberOrZero(e.target.value) })}
                disabled={!editable}
                inputProps={{ min: 0.0001, step: 1 }}
                error={formData.output_quantity <= 0}
                helperText={`Units made by the quantities below${productById.get(formData.product_id)?.unit_of_measure ? ` (${productById.get(formData.product_id)?.unit_of_measure})` : ""}`}
              />
              <TRemarkField
                label="Description"
                size="small"
                value={formData.description}
                onChange={(value) => setFormData({ ...formData, description: value })}
                disabled={!editable}
              />
            </FormSection>

            {/* ─── Components ─── */}
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
              <Typography variant="subtitle1" fontWeight="bold">Components</Typography>
              {editable && (
                <Button size="small" startIcon={<AddIcon />} onClick={addItem}>Add Component</Button>
              )}
            </Box>
            {editable && itemLines.length === 0 && (
              <Alert severity="warning" sx={{ mb: 1 }}>A BOM needs at least one component.</Alert>
            )}
            {editable && duplicateComponent && (
              <Alert severity="error" sx={{ mb: 1 }}>Each component can appear only once; combine the quantities.</Alert>
            )}
            <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3, mb: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={modernTableStyles.headerRow}>
                    <TableCell sx={{ width: 40 }}>#</TableCell>
                    <TableCell>Component</TableCell>
                    <TableCell align="right" sx={{ width: 110 }}>Quantity</TableCell>
                    <TableCell align="right" sx={{ width: 95 }}>Scrap %</TableCell>
                    <TableCell sx={{ width: 130 }}>Issue Method</TableCell>
                    <TableCell>Remark</TableCell>
                    <TableCell align="right" sx={{ width: 120 }}>{`Unit Cost (${currencySymbol})`}</TableCell>
                    <TableCell align="right" sx={{ width: 120 }}>{`Line Cost (${currencySymbol})`}</TableCell>
                    {editable && <TableCell sx={{ width: 44 }} />}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {itemLines.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={editable ? 9 : 8} sx={modernTableStyles.emptyCell}>
                        {editable ? "Add the components this product is made from" : selectedBOM && !bomDetail ? "Loading..." : "No components"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    itemLines.map((line, index) => {
                      const product = productById.get(line.product_id);
                      return (
                        <TableRow key={line._id} sx={{ ...modernTableStyles.bodyRow, ...(index % 2 === 1 && { bgcolor: "grey.25" }) }}>
                          <TableCell>{(index + 1) * 10}</TableCell>
                          <TableCell>
                            {editable ? (
                              <Autocomplete
                                size="small"
                                options={componentOptions}
                                getOptionLabel={productLabel}
                                value={product || null}
                                onChange={(_, p) => updateItem(line._id, { product_id: p?.id || 0, product_name: p?.name, product_code: p?.item_code, is_manufactured: false })}
                                isOptionEqualToValue={(o, v) => o.id === v.id}
                                renderInput={(params) => (
                                  <TextField {...params} placeholder="Select component" error={!line.product_id} />
                                )}
                                sx={{ minWidth: 240 }}
                              />
                            ) : (
                              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                <Box>
                                  <Typography variant="body2">{line.product_name || product?.name || `#${line.product_id}`}</Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {line.product_code || product?.item_code}
                                    {line.unit_of_measure ? ` · ${line.unit_of_measure}` : ""}
                                  </Typography>
                                </Box>
                                {line.is_manufactured && <TChip label="Sub-assembly" size="small" color="info" variant="outlined" />}
                              </Box>
                            )}
                          </TableCell>
                          <TableCell align="right">
                            {editable ? (
                              <TextField size="small" type="number" value={line.quantity}
                                onChange={(e) => updateItem(line._id, { quantity: numberOrZero(e.target.value) })}
                                inputProps={{ min: 0.0001, step: 1 }} error={line.quantity <= 0} sx={{ width: 95 }} />
                            ) : Number(line.quantity).toLocaleString()}
                          </TableCell>
                          <TableCell align="right">
                            {editable ? (
                              <TextField size="small" type="number" value={line.scrap_pct}
                                onChange={(e) => updateItem(line._id, { scrap_pct: numberOrZero(e.target.value) })}
                                inputProps={{ min: 0, max: 99.99, step: 0.5 }} error={line.scrap_pct < 0 || line.scrap_pct >= 100} sx={{ width: 80 }} />
                            ) : `${line.scrap_pct}%`}
                          </TableCell>
                          <TableCell>
                            {editable ? (
                              <TextField select size="small" value={line.issue_method}
                                onChange={(e) => updateItem(line._id, { issue_method: e.target.value as IssueMethod })} sx={{ width: 120 }}>
                                <MenuItem value="manual">Manual</MenuItem>
                                <MenuItem value="backflush">Backflush</MenuItem>
                              </TextField>
                            ) : (
                              <TChip label={line.issue_method === "backflush" ? "Backflush" : "Manual"} size="small"
                                color={line.issue_method === "backflush" ? "secondary" : "default"} variant="outlined" />
                            )}
                          </TableCell>
                          <TableCell>
                            {editable ? (
                              <TextField size="small" fullWidth value={line.remark}
                                onChange={(e) => updateItem(line._id, { remark: e.target.value })} inputProps={{ maxLength: 255 }} />
                            ) : line.remark || "-"}
                          </TableCell>
                          <TableCell align="right">{fmtLKR(itemUnitCost(line))}</TableCell>
                          <TableCell align="right">{fmtLKR(itemLineCost(line))}</TableCell>
                          {editable && (
                            <TableCell>
                              <IconButton size="small" color="error" onClick={() => removeItem(line._id)}>
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </Paper>

            {/* ─── Operations / routing ─── */}
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
              <Typography variant="subtitle1" fontWeight="bold">Operations / Routing</Typography>
              {editable && (
                <Button size="small" startIcon={<AddIcon />} onClick={addOperation}>Add Operation</Button>
              )}
            </Box>
            <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3, mb: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={modernTableStyles.headerRow}>
                    <TableCell sx={{ width: 40 }}>Seq</TableCell>
                    <TableCell>Operation</TableCell>
                    <TableCell>Work Center</TableCell>
                    <TableCell align="right" sx={{ width: 110 }}>Setup (min)</TableCell>
                    <TableCell align="right" sx={{ width: 120 }}>Run (min/unit)</TableCell>
                    <TableCell align="right" sx={{ width: 110 }}>Planned (min)</TableCell>
                    <TableCell align="right" sx={{ width: 120 }}>{`Labour (${currencySymbol})`}</TableCell>
                    <TableCell align="right" sx={{ width: 120 }}>{`Overhead (${currencySymbol})`}</TableCell>
                    {editable && <TableCell sx={{ width: 44 }} />}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {operationLines.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={editable ? 9 : 8} sx={modernTableStyles.emptyCell}>
                        {editable ? "Optional: add the routing steps and the work centers that perform them" : "No operations"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    operationLines.map((op, index) => {
                      const wc = workCenterById.get(op.work_center_id);
                      const savedOp = !editable ? bomDetail?.operations.find((o) => `op-${o.id}` === op._id) : undefined;
                      const costs = operationCosts(op, formData.output_quantity || 1);
                      const wcOptions = wc && !wc.active ? [wc, ...activeWorkCenters] : activeWorkCenters;
                      return (
                        <TableRow key={op._id} sx={{ ...modernTableStyles.bodyRow, ...(index % 2 === 1 && { bgcolor: "grey.25" }) }}>
                          <TableCell>{(index + 1) * 10}</TableCell>
                          <TableCell>
                            {editable ? (
                              <TextField size="small" fullWidth value={op.name} placeholder="e.g. Assemble"
                                onChange={(e) => updateOperation(op._id, { name: e.target.value })}
                                inputProps={{ maxLength: 150 }} error={!op.name.trim()} />
                            ) : op.name}
                          </TableCell>
                          <TableCell>
                            {editable ? (
                              <Autocomplete
                                size="small"
                                options={wcOptions}
                                getOptionLabel={(w) => `${w.code} - ${w.name}`}
                                value={wc || null}
                                onChange={(_, w) => updateOperation(op._id, { work_center_id: w?.id || 0 })}
                                isOptionEqualToValue={(o, v) => o.id === v.id}
                                renderInput={(params) => <TextField {...params} placeholder="Work center" error={!op.work_center_id} />}
                                sx={{ minWidth: 200 }}
                              />
                            ) : (
                              `${op.work_center_code || wc?.code || ""} - ${op.work_center_name || wc?.name || ""}`
                            )}
                          </TableCell>
                          <TableCell align="right">
                            {editable ? (
                              <TextField size="small" type="number" value={op.setup_minutes}
                                onChange={(e) => updateOperation(op._id, { setup_minutes: numberOrZero(e.target.value) })}
                                inputProps={{ min: 0, step: 1 }} sx={{ width: 90 }} />
                            ) : Number(op.setup_minutes).toLocaleString()}
                          </TableCell>
                          <TableCell align="right">
                            {editable ? (
                              <TextField size="small" type="number" value={op.run_minutes}
                                onChange={(e) => updateOperation(op._id, { run_minutes: numberOrZero(e.target.value) })}
                                inputProps={{ min: 0, step: 0.5 }} sx={{ width: 95 }} />
                            ) : Number(op.run_minutes).toLocaleString()}
                          </TableCell>
                          <TableCell align="right">{costs.minutes.toLocaleString()}</TableCell>
                          <TableCell align="right">{fmtLKR(savedOp ? Number(savedOp.labor_cost) : costs.labor)}</TableCell>
                          <TableCell align="right">{fmtLKR(savedOp ? Number(savedOp.overhead_cost) : costs.overhead)}</TableCell>
                          {editable && (
                            <TableCell>
                              <IconButton size="small" color="error" onClick={() => removeOperation(op._id)}>
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </Paper>

            {/* ─── Cost roll-up ─── */}
            <FormSection title={`Cost Roll-up (for ${formData.output_quantity || 1} unit${formData.output_quantity === 1 ? "" : "s"})`} columns={3}>
              <Box>
                <Typography variant="caption" color="text.secondary">Material</Typography>
                <Typography variant="body2" fontWeight={600}>{currencySymbol} {fmtLKR(rollup.material)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Labour</Typography>
                <Typography variant="body2" fontWeight={600}>{currencySymbol} {fmtLKR(rollup.labor)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Overhead</Typography>
                <Typography variant="body2" fontWeight={600}>{currencySymbol} {fmtLKR(rollup.overhead)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Total Cost</Typography>
                <Typography variant="body1" fontWeight={700}>{currencySymbol} {fmtLKR(rollup.total)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Unit Cost</Typography>
                <Typography variant="body1" fontWeight={700} color="primary.main">{currencySymbol} {fmtLKR(rollup.unit)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Product Cost Price (standard)</Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography variant="body2" fontWeight={600}>{currencySymbol} {fmtLKR(productCostPrice)}</Typography>
                  {formData.product_id > 0 && Math.abs(costDifference) >= 0.01 && (
                    <Tooltip title={costDifference > 0 ? "Roll-up is above the product's cost price" : "Roll-up is below the product's cost price"}>
                      <span>
                        <TChip
                          size="small"
                          color={costDifference > 0 ? "error" : "success"}
                          label={`${costDifference > 0 ? "+" : "-"}${currencySymbol} ${fmtLKR(Math.abs(costDifference))}${productCostPrice > 0 ? ` (${((costDifference / productCostPrice) * 100).toFixed(1)}%)` : ""}`}
                        />
                      </span>
                    </Tooltip>
                  )}
                </Box>
              </Box>
            </FormSection>

            {selectedBOM && !editable && (
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
                  <Typography variant="caption" color="text.secondary">Created</Typography>
                  <Typography variant="body2">{formatDateTimeReadable(selectedBOM.created_at) || "-"}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Last Updated</Typography>
                  <Typography variant="body2">{formatDateTimeReadable(selectedBOM.updated_at) || "-"}</Typography>
                </Box>
              </FormSection>
            )}
          </>
        )}
      </Box>
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title="Bills of Materials"
        titleSlot={
          isDetailMode ? (
            <Button size="small" startIcon={<ArrowBackIcon fontSize="small" />} onClick={handleBack} sx={{ textTransform: "none" }}>
              Back to Bills of Materials
            </Button>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search BOMs or products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                }}
                sx={{ width: 230, flexShrink: 0 }}
              />
              <Box sx={{ width: 160, flexShrink: 0 }}>
                <TStatusFilter options={BOM_STATUS_OPTIONS} value={filterStatus} onChange={setFilterStatus} label="" placeholder="All Statuses" size="small" />
              </Box>
              {(searchQuery || filterStatus) && (
                <Button size="small" onClick={() => { setSearchQuery(""); setFilterStatus(null); }} sx={{ textTransform: "none" }}>
                  Clear
                </Button>
              )}
            </Box>
          )
        }
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ["mfg-boms"] });
          queryClient.invalidateQueries({ queryKey: ["mfg-work-centers"] });
          if (selectedBOM && !editable) handleSelectBOM(selectedBOM);
        }}
        isLoading={isLoading}
        {...(isDetailMode ? { children: detailPanel } : { children: tablePanel })}
        headerActions={
          isDetailMode || !canCreate ? undefined : (
            <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={handleNew} sx={{ mr: 1 }}>
              Add BOM
            </Button>
          )
        }
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />

      {/* New version prompt */}
      <Dialog open={versionDialogOpen} onClose={() => setVersionDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>New BOM Version</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Copies {selectedBOM?.bom_no} (v{selectedBOM?.version}) with all its components and operations into a new draft.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Version"
            value={newVersion}
            onChange={(e) => setNewVersion(e.target.value)}
            inputProps={{ maxLength: 20 }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newVersion.trim() && selectedBOM) {
                copyMutation.mutate({ id: selectedBOM.id, version: newVersion.trim() });
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVersionDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!newVersion.trim() || copyMutation.isPending}
            onClick={() => selectedBOM && copyMutation.mutate({ id: selectedBOM.id, version: newVersion.trim() })}
          >
            Create Version
          </Button>
        </DialogActions>
      </Dialog>

      <TActivityHistoryPanel
        open={activityHistoryOpen}
        onClose={() => setActivityHistoryOpen(false)}
        entityType="bom"
        entityId={selectedBOM?.id}
        actionLabels={{
          create: "BOM created",
          update: "BOM updated",
          activate: "BOM activated",
          set_default: "Set as default",
          archive: "BOM archived",
          copy: "Created as new version",
          delete: "BOM deleted",
        }}
      />
    </>
  );
}
