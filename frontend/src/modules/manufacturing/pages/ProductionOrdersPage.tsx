/**
 * ProductionOrdersPage - manufacturing (work) orders.
 *
 * Browse table of every order; the detail view shows the order header, its
 * components (with branch availability), routing operations, planned vs actual
 * cost and the shop-floor transactions. Lifecycle actions follow the backend:
 * draft -> released -> in progress -> completed -> closed (cancel from draft /
 * released / in progress while nothing has been booked).
 *
 * Shop-floor actions open right-side TSidePanels (ProductionOrderDialogs.tsx): materials,
 * output (scrap reason, by-products, quality hold), time, outside work, quality check,
 * completion options and cancel. Every submit is guarded against double clicks.
 */

import { useCurrencyStore } from "@/state/currencyStore";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AssignmentIcon from "@mui/icons-material/Assignment";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import RequestQuoteIcon from "@mui/icons-material/RequestQuote";
import PrintIcon from "@mui/icons-material/Print";
import AssignmentIndIcon from "@mui/icons-material/AssignmentInd";
import BlockIcon from "@mui/icons-material/Block";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DoneAllIcon from "@mui/icons-material/DoneAll";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import HistoryIcon from "@mui/icons-material/History";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import InventoryIcon from "@mui/icons-material/Inventory";
import LockIcon from "@mui/icons-material/Lock";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import OutputIcon from "@mui/icons-material/Output";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import SearchIcon from "@mui/icons-material/Search";
import TimerIcon from "@mui/icons-material/Timer";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { formatDate, formatDateTimeReadable } from "@/utils/formatters";

import {
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  fmtLKR,
  FormSection,
  getStatusProps,
  MasterDetailLayout,
  modernTableStyles,
  TActivityHistoryPanel,
  TBranchFilter,
  TChip,
  TConfirmDialog,
  TDataGrid,
  type TDataGridColumn,
  type TFilterStatusOption,
  TPrintPreviewDialog,
  TRemarkField,
  TStatusChip,
  TStatusFilter,
  useCrudMutation,
  useMasterDetailState,
  useTConfirmDialog,
} from "@/components/tijaero";

import { useReferenceData } from "@/hooks";
import { usePermission } from "@/auth/permissions";
import { bomsApi, productionOrdersApi } from "@/modules/manufacturing/api";
import FromQuotationDialog from "@/modules/manufacturing/components/FromQuotationDialog";
import {
  CancelOrderPanel,
  CompleteOrderPanel,
  MaterialMovePanel,
  OutputPanel,
  OutsideWorkPanel,
  QualityCheckPanel,
  TimeLogPanel,
} from "@/modules/manufacturing/components/ProductionOrderDialogs";
import {
  PRIORITY_OPTIONS,
  PRODUCTION_ORDER_STATUS_OPTIONS,
  SCRAP_REASONS,
  type ProductionOrder,
  type ProductionOrderInput,
  type QcStatus,
} from "@/modules/manufacturing/types";

const STATUS_FILTER_OPTIONS: TFilterStatusOption[] = [
  { value: null, label: "All Statuses" },
  ...PRODUCTION_ORDER_STATUS_OPTIONS,
];

const todayISO = () => format(new Date(), "yyyy-MM-dd");

const scrapReasonLabel = (r?: string | null) => SCRAP_REASONS.find((x) => x.value === r)?.label || r || "";

const QC_CHIP: Record<QcStatus, { label: string; color: "default" | "warning" | "success" | "error" | "info" }> = {
  none: { label: "-", color: "default" },
  on_hold: { label: "On hold", color: "warning" },
  partly_passed: { label: "Partly passed", color: "info" },
  passed: { label: "Passed", color: "success" },
  failed: { label: "Failed", color: "error" },
};

const INITIAL_FORM_DATA: ProductionOrderInput = {
  product_id: 0,
  bom_id: null,
  branch_code: "",
  location_id: null,
  planned_quantity: 1,
  planned_start_date: todayISO(),
  planned_end_date: todayISO(),
  priority: "normal",
  source_reference: "",
  remark: "",
};

const resetFormFromOrder = (o: ProductionOrder): ProductionOrderInput => ({
  product_id: o.product_id,
  bom_id: o.bom_id,
  branch_code: o.branch_code,
  location_id: o.location_id ?? null,
  planned_quantity: o.planned_quantity,
  planned_start_date: o.planned_start_date,
  planned_end_date: o.planned_end_date,
  priority: o.priority,
  source_reference: o.source_reference || "",
  remark: o.remark || "",
});

const MUTATION_KEYS = (id?: number) => [
  ["production-orders"],
  ["production-order-activity", id],
  ["manufacturing-dashboard"],
  ["mrp"],
  ["job-cards"],
  ["quote-demand"],
  ["salesStock"],
  ["salesStockSummary"],
  ["journal-entries"],
  ["general-ledger"],
  ["trial-balance"],
];

const num = (v: unknown) => Number(v ?? 0);

type OrderRow = ProductionOrder & { product_display: string; branch_display: string };

type DialogKind = "issue" | "return" | "output" | "time" | "outside" | "quality" | "complete" | "cancel" | null;

interface OrderAction {
  fn: () => Promise<ProductionOrder>;
  success: string;
}

export default function ProductionOrdersPage() {
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const queryClient = useQueryClient();
  const confirmDialog = useTConfirmDialog();
  const [searchParams, setSearchParams] = useSearchParams();

  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [fromQuoteOpen, setFromQuoteOpen] = useState(false);
  const [printDoc, setPrintDoc] = useState<"production-order" | "job-card" | null>(null);
  const canViewShopFloor = usePermission("shop_floor", "view");
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [lateOnly, setLateOnly] = useState(false);
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  // Operation preselected when a panel is opened from a row of the operations table
  const [panelOpId, setPanelOpId] = useState<number | null>(null);
  const [activityTab, setActivityTab] = useState(0);
  // In-flight guards: a double click must never submit twice
  const actionRef = useRef(false);
  const saveRef = useRef(false);
  const deleteRef = useRef(false);
  const openPanel = (kind: DialogKind, opId: number | null = null) => {
    setPanelOpId(opId);
    setDialog(kind);
  };
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const {
    searchQuery,
    setSearchQuery,
    selectedItem: selectedOrder,
    setSelectedItem: setSelectedOrder,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    formData,
    setFormData,
    handleSelectItem,
    handleNew: handleNewBase,
    handleCancel: handleCancelBase,
    handleStartEdit,
  } = useMasterDetailState<ProductionOrder, ProductionOrderInput>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromOrder,
    defaultSortField: "created_at",
    confirmUnsavedChanges: () =>
      confirmDialog.confirm({
        title: "Discard Changes",
        message: "You have unsaved changes. Discard them?",
        confirmText: "Discard",
        cancelText: "Keep Editing",
        confirmColor: "warning",
      }),
  });

  const { filteredBranches, filteredLocations, defaultBranchCode, data: refData } = useReferenceData(
    ["branches", "locations", "products"],
    { productsLimit: 2000 }
  );
  const branches = useMemo(() => filteredBranches || [], [filteredBranches]);
  const products = useMemo(() => (refData?.products || []).filter((p) => p.active !== false), [refData]);

  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) setFilterBranch(defaultBranchCode);
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  const canCreate = usePermission("production_orders", "create");
  const canUpdate = usePermission("production_orders", "update");
  const canDeletePerm = usePermission("production_orders", "delete");
  const canApprove = usePermission("production_orders", "approve");
  const canShopFloor = usePermission("shop_floor", "update");

  // ── list ──
  const { data: page, isLoading, isError: loadFailed } = useQuery({
    queryKey: ["production-orders", "list", filterBranch, filterStatus, lateOnly],
    queryFn: () =>
      productionOrdersApi.getAll({
        size: 500,
        branch_code: filterBranch || undefined,
        status: filterStatus ? [filterStatus] : undefined,
        late_only: lateOnly || undefined,
      }),
    enabled: branchResolved,
  });
  const orders = useMemo(() => page?.items || [], [page]);

  // ── detail (the list rows carry no lines) ──
  const selectedId = selectedOrder?.id;
  const { data: detail } = useQuery({
    queryKey: ["production-orders", "detail", selectedId],
    queryFn: () => productionOrdersApi.getById(selectedId as number),
    enabled: !!selectedId && !isCreating,
  });
  const order = selectedOrder && detail && detail.id === selectedOrder.id ? detail : selectedOrder;

  const { data: activity } = useQuery({
    queryKey: ["production-order-activity", selectedId],
    queryFn: () => productionOrdersApi.getActivity(selectedId as number),
    enabled: !!selectedId && !isCreating,
  });

  // Deep link: /manufacturing/orders?order=<id>
  useEffect(() => {
    const id = Number(searchParams.get("order"));
    if (!id) return;
    productionOrdersApi
      .getById(id)
      .then((o) => {
        setSelectedOrder(o);
        setFormData(resetFormFromOrder(o));
        queryClient.setQueryData(["production-orders", "detail", o.id], o);
      })
      .catch(() => undefined)
      .finally(() => {
        searchParams.delete("order");
        setSearchParams(searchParams, { replace: true });
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const getBranchDisplay = useCallback(
    (code: string) => {
      const b = branches.find((x) => x.branch_code === code);
      return b ? `${b.branch_code} - ${b.branch_name}` : code;
    },
    [branches]
  );

  const rows: OrderRow[] = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orders
      .filter(
        (o) =>
          !q ||
          o.order_no.toLowerCase().includes(q) ||
          (o.product_name || "").toLowerCase().includes(q) ||
          (o.product_code || "").toLowerCase().includes(q) ||
          (o.source_reference || "").toLowerCase().includes(q)
      )
      .map((o) => ({
        ...o,
        product_display: `${o.product_name || ""} ${o.product_code ? `(${o.product_code})` : ""}`.trim(),
        branch_display: getBranchDisplay(o.branch_code),
      }));
  }, [orders, searchQuery, getBranchDisplay]);

  // ── selection / navigation ──
  const handleSelectOrder = useCallback(
    async (o: ProductionOrder) => {
      const ok = await handleSelectItem(o);
      if (ok) {
        setTouched({});
        setActivityTab(0);
      }
    },
    [handleSelectItem]
  );

  const handleNew = useCallback(async () => {
    const ok = await handleNewBase();
    if (!ok) return;
    setFormData({ ...INITIAL_FORM_DATA, branch_code: defaultBranchCode || "", planned_start_date: todayISO(), planned_end_date: todayISO() });
    setTouched({});
  }, [handleNewBase, setFormData, defaultBranchCode]);

  const handleCancel = useCallback(() => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedOrder(null);
    } else {
      handleCancelBase(orders);
    }
    setTouched({});
  }, [isCreating, handleCancelBase, orders, setIsCreating, setIsEditing, setSelectedOrder]);

  const handleBack = useCallback(() => {
    setSelectedOrder(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [isCreating, setSelectedOrder, setIsCreating, setIsEditing]);

  const applyOrder = useCallback(
    (o: ProductionOrder) => {
      setSelectedOrder(o);
      setFormData(resetFormFromOrder(o));
      queryClient.setQueryData(["production-orders", "detail", o.id], o);
    },
    [setSelectedOrder, setFormData, queryClient]
  );

  // ── form ──
  const { data: productBoms = [] } = useQuery({
    queryKey: ["boms", "active-for-product", formData.product_id],
    queryFn: () => bomsApi.getAll({ product_id: formData.product_id, status: "active" }),
    enabled: (isCreating || isEditing) && formData.product_id > 0,
  });

  useEffect(() => {
    if (!(isCreating || isEditing) || !formData.product_id) return;
    if (formData.bom_id && productBoms.some((b) => b.id === formData.bom_id)) return;
    const def = productBoms.find((b) => b.is_default) || productBoms[0];
    if (def && def.id !== formData.bom_id) setFormData((p) => ({ ...p, bom_id: def.id }));
  }, [productBoms]); // eslint-disable-line react-hooks/exhaustive-deps

  const branchLocations = filteredLocations.filter((l) => l.branch_code === formData.branch_code);
  const editable = isCreating || (isEditing && order?.status === "draft");
  const blur = (f: string) => setTouched((p) => ({ ...p, [f]: true }));
  const fieldError = (f: string): string | undefined => {
    if (!touched[f]) return undefined;
    switch (f) {
      case "product_id":
        return formData.product_id ? undefined : "Product is required";
      case "bom_id":
        return formData.bom_id ? undefined : "This product has no active BOM";
      case "branch_code":
        return formData.branch_code ? undefined : "Branch is required";
      case "planned_quantity":
        return formData.planned_quantity >= 1 ? undefined : "Enter at least 1";
      case "planned_end_date":
        return formData.planned_end_date >= formData.planned_start_date ? undefined : "End date is before the start date";
    }
    return undefined;
  };
  const isFormValid =
    formData.product_id > 0 &&
    !!formData.bom_id &&
    !!formData.branch_code &&
    formData.planned_quantity >= 1 &&
    !!formData.planned_start_date &&
    !!formData.planned_end_date &&
    formData.planned_end_date >= formData.planned_start_date;

  const createMutation = useCrudMutation({
    mutationFn: productionOrdersApi.create,
    invalidateQueryKeys: MUTATION_KEYS(),
    successMessage: "Production order created",
    errorMessage: "Failed to create production order",
    onSuccess: (o) => {
      setIsCreating(false);
      setIsEditing(false);
      applyOrder(o);
    },
  });

  const updateMutation = useCrudMutation({
    mutationFn: productionOrdersApi.update,
    invalidateQueryKeys: MUTATION_KEYS(selectedId),
    successMessage: "Production order updated",
    errorMessage: "Failed to update production order",
    onSuccess: (o) => {
      setIsEditing(false);
      applyOrder(o);
    },
  });

  const deleteMutation = useCrudMutation({
    mutationFn: productionOrdersApi.delete,
    invalidateQueryKeys: MUTATION_KEYS(),
    successMessage: "Production order deleted",
    errorMessage: "Failed to delete production order",
    onSuccess: () => setSelectedOrder(null),
  });

  // One mutation for every lifecycle / shop-floor action on the open order.
  const actionMutation = useCrudMutation<ProductionOrder, OrderAction>({
    mutationFn: (a: OrderAction) => a.fn(),
    getInvalidateQueryKeys: (o) => MUTATION_KEYS(o.id),
    getSuccessMessage: (_o, a) => a.success,
    errorMessage: "Action failed",
    onSuccess: (o) => {
      setDialog(null);
      applyOrder(o);
    },
  });
  const fireAction = (fn: () => Promise<ProductionOrder>, success: string) =>
    actionMutation.mutate({ fn, success }, { onSettled: () => { actionRef.current = false; } });
  const runAction = (fn: () => Promise<ProductionOrder>, success: string) => {
    if (actionMutation.isPending || actionRef.current) return;
    actionRef.current = true;
    fireAction(fn, success);
  };

  const handleSave = useCallback(() => {
    if (createMutation.isPending || updateMutation.isPending || saveRef.current) return;
    const payload = {
      ...formData,
      source_reference: formData.source_reference?.trim() || null,
      remark: formData.remark?.trim() || null,
    };
    const settled = { onSettled: () => { saveRef.current = false; } };
    if (isCreating) {
      saveRef.current = true;
      createMutation.mutate(payload, settled);
    } else if (order) {
      saveRef.current = true;
      const { product_id: _p, branch_code: _b, ...data } = payload; // eslint-disable-line @typescript-eslint/no-unused-vars
      updateMutation.mutate({ id: order.id, data }, settled);
    }
  }, [formData, isCreating, order, createMutation, updateMutation]);

  const handleDelete = useCallback(async () => {
    if (!order || deleteMutation.isPending || deleteRef.current) return;
    deleteRef.current = true;
    let ok = false;
    try {
      ok = await confirmDialog.confirm({
        title: "Delete Production Order",
        message: `Delete draft order "${order.order_no}"?`,
        confirmText: "Delete",
        confirmColor: "error",
      });
    } finally {
      if (!ok) deleteRef.current = false;
    }
    if (ok) deleteMutation.mutate(order.id, { onSettled: () => { deleteRef.current = false; } });
  }, [order, confirmDialog, deleteMutation]);

  const confirmAndRun = async (title: string, message: string, confirmText: string, fn: () => Promise<ProductionOrder>, success: string) => {
    if (actionMutation.isPending || actionRef.current) return;
    actionRef.current = true;
    let ok = false;
    try {
      ok = await confirmDialog.confirm({ title, message, confirmText, confirmColor: "primary" });
    } finally {
      if (!ok) actionRef.current = false;
    }
    if (ok) fireAction(fn, success);
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const busy = actionMutation.isPending;
  // Output of a requires_qc product is held for a quality check (flag from the product master;
  // an earlier held output of this order says the same)
  const requiresQc = useMemo(() => {
    if (!order) return false;
    const p = (refData?.products || []).find((x) => x.id === order.product_id) as { requires_qc?: boolean } | undefined;
    return !!p?.requires_qc || (activity?.outputs || []).some((o) => o.qc_status && o.qc_status !== "none") || order.qc_on_hold_quantity > 0;
  }, [order, refData, activity]);
  const heldOutputs = (activity?.outputs || []).filter((o) => o.qc_status === "on_hold" || o.qc_status === "partly_passed").length;
  const isDetailMode = !!selectedOrder || isCreating;

  // ── grid ──
  const columns: TDataGridColumn<OrderRow>[] = useMemo(
    () => [
      {
        field: "order_no",
        header: "Order No",
        width: 170,
        renderCell: (p: GridRenderCellParams<OrderRow>) => (
          <Typography variant="body2" fontWeight={600}>{p.row.order_no}</Typography>
        ),
      },
      { field: "product_display", header: "Product", flex: 1, minWidth: 200 },
      { field: "branch_display", header: "Branch", width: 160 },
      { field: "planned_quantity", header: "Planned", width: 90, type: "number" },
      {
        field: "produced_quantity",
        header: "Produced",
        width: 140,
        renderCell: (p: GridRenderCellParams<OrderRow>) => (
          <Box sx={{ width: "100%", pt: 1.25 }}>
            <Typography variant="caption">
              {p.row.produced_quantity} / {p.row.planned_quantity}
            </Typography>
            <LinearProgress variant="determinate" value={Math.min(num(p.row.progress_pct), 100)}
              sx={{ height: 5, borderRadius: 3 }} />
          </Box>
        ),
      },
      {
        field: "planned_start_date",
        header: "Start",
        width: 110,
        renderCell: (p: GridRenderCellParams<OrderRow>) => formatDate(p.row.planned_start_date),
      },
      {
        field: "planned_end_date",
        header: "Due",
        width: 150,
        renderCell: (p: GridRenderCellParams<OrderRow>) => (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, color: p.row.is_late ? "error.main" : undefined }}>
            {formatDate(p.row.planned_end_date)}
            {p.row.is_late && <TChip size="small" label="Late" color="error" />}
          </Box>
        ),
      },
      {
        field: "priority",
        header: "Priority",
        width: 100,
        align: "center",
        headerAlign: "center",
        renderCell: (p: GridRenderCellParams<OrderRow>) => <TStatusChip status={p.row.priority} statusMap="priority" size="small" />,
      },
      {
        field: "status",
        header: "Status",
        width: 130,
        align: "center",
        headerAlign: "center",
        renderCell: (p: GridRenderCellParams<OrderRow>) => <TStatusChip status={p.row.status} statusMap="productionOrder" size="small" />,
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (p: GridRenderCellParams<OrderRow>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectOrder(p.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [handleSelectOrder]
  );

  const tablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<OrderRow>
          rows={rows}
          columns={columns}
          loading={isLoading}
          onRowClick={(row) => handleSelectOrder(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage={loadFailed ? "Could not load production orders. Use refresh to try again." : "No production orders found"}
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // ── toolbar actions by status ──
  const statusActions: ReactNode = (() => {
    if (!order || isCreating || isEditing) return undefined;
    const id = order.id;
    const btn = (label: string, icon: ReactNode, onClick: () => void, color: "primary" | "success" | "error" | "warning" = "primary", variant: "contained" | "outlined" = "outlined") => (
      <Button key={label} size="small" variant={variant} color={color} startIcon={icon} onClick={onClick} disabled={busy}>
        {label}
      </Button>
    );
    const out: ReactNode[] = [];
    const s = order.status;
    if (s === "draft" && canApprove) {
      out.push(btn("Release", <RocketLaunchIcon />, () =>
        confirmAndRun("Release Production Order",
          `Release ${order.order_no}? Component costs and work-center rates are fixed at release, and materials can then be issued.`,
          "Release", () => productionOrdersApi.release(id), "Order released"), "primary", "contained"));
    }
    if (s === "released" && canShopFloor) {
      out.push(btn("Start", <PlayArrowIcon />, () => runAction(() => productionOrdersApi.start(id), "Order started"), "primary", "contained"));
    }
    const ops = order.operations || [];
    const running = s === "released" || s === "in_progress";
    if (running && canShopFloor) {
      out.push(btn("Issue Materials", <InventoryIcon />, () => openPanel("issue")));
    }
    if ((s === "in_progress" || s === "completed") && canShopFloor) {
      out.push(btn("Return Materials", <AssignmentReturnIcon />, () => openPanel("return")));
    }
    if (running && canShopFloor) {
      if (ops.some((o) => !o.is_outside && o.status !== "completed")) {
        out.push(btn("Log Time", <TimerIcon />, () => openPanel("time")));
      }
      if (ops.some((o) => o.is_outside && o.outside_quantity < (order.max_quantity || order.planned_quantity))) {
        out.push(btn("Receive Outside Work", <LocalShippingIcon />, () => openPanel("outside")));
      }
      out.push(btn("Record Output", <OutputIcon />, () => openPanel("output"), "success"));
    }
    if (order.qc_on_hold_quantity > 0 && canApprove && s !== "cancelled") {
      out.push(btn(`Quality Check (${order.qc_on_hold_quantity})`, <FactCheckIcon />, () => openPanel("quality"), "warning"));
    }
    if (s === "in_progress" && canApprove) {
      out.push(btn("Complete", <DoneAllIcon />, () => openPanel("complete"), "success", "contained"));
    }
    if (s === "completed" && canApprove) {
      out.push(btn("Close", <LockIcon />, () =>
        confirmAndRun("Close Production Order",
          `Close ${order.order_no}? The remaining WIP balance of ${currencySymbol} ${fmtLKR(num(order.wip_balance))} will be posted to the Production Variance account. A closed order cannot be changed.`,
          "Close Order", () => productionOrdersApi.close(id), "Order closed"), "primary", "contained"));
    }
    // The server refuses to cancel once materials are issued, output is recorded or time is booked
    const untouched =
      !order.produced_quantity &&
      !order.scrapped_quantity &&
      !(order.materials || []).some((m) => m.issued_quantity > 0) &&
      !ops.some((op) => num(op.actual_minutes) > 0 || op.outside_quantity > 0);
    if ((s === "draft" || s === "released" || s === "in_progress") && canApprove && untouched) {
      out.push(btn("Cancel Order", <BlockIcon />, () => openPanel("cancel"), "error"));
    }
    // Printable once released (the order goes to the shop floor); drafts and cancelled orders are not
    if (["released", "in_progress", "completed", "closed"].includes(s)) {
      out.push(btn("Print Order", <PrintIcon />, () => setPrintDoc("production-order")));
      if (canViewShopFloor && s !== "closed") {
        out.push(btn("Job Card", <AssignmentIndIcon />, () => setPrintDoc("job-card")));
      }
    }
    return out.length ? <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>{out}</Box> : undefined;
  })();

  // ── detail sections ──
  const info = (label: string, value: ReactNode) => (
    <Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" component="div">{value ?? "-"}</Typography>
    </Box>
  );

  const headerForm = (
    <FormSection title="Order Information" columns={3}>
      <TextField label="Order Number" size="small" value={isCreating ? "Generated on save" : order?.order_no || ""} disabled />
      <Autocomplete
        size="small"
        options={products}
        getOptionLabel={(p) => `${p.name} (${p.item_code})`}
        value={products.find((p) => p.id === formData.product_id) || null}
        onChange={(_, p) => {
          setFormData((prev) => ({ ...prev, product_id: p ? p.id : 0, bom_id: null }));
          blur("product_id");
        }}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        disabled={!isCreating}
        renderInput={(params) => (
          <TextField {...params} label="Product" required error={!!fieldError("product_id")} helperText={fieldError("product_id")} />
        )}
      />
      <TextField
        select
        label="Bill of Materials"
        size="small"
        required
        value={formData.bom_id ?? ""}
        onChange={(e) => setFormData((p) => ({ ...p, bom_id: Number(e.target.value) }))}
        onBlur={() => blur("bom_id")}
        disabled={!editable || !formData.product_id}
        error={!!fieldError("bom_id") || (editable && !!formData.product_id && productBoms.length === 0)}
        helperText={
          fieldError("bom_id") ||
          (editable && formData.product_id && productBoms.length === 0 ? "This product has no active BOM" : undefined)
        }
      >
        {!editable && order && (
          <MenuItem value={order.bom_id}>{order.bom_no} (v{order.bom_version})</MenuItem>
        )}
        {editable &&
          productBoms.map((b) => (
            <MenuItem key={b.id} value={b.id}>
              {b.bom_no} — v{b.version}{b.is_default ? " (default)" : ""}
            </MenuItem>
          ))}
      </TextField>
      <TextField
        select
        label="Branch"
        size="small"
        required
        value={formData.branch_code}
        onChange={(e) => setFormData((p) => ({ ...p, branch_code: e.target.value, location_id: null }))}
        onBlur={() => blur("branch_code")}
        disabled={!isCreating}
        error={!!fieldError("branch_code")}
        helperText={fieldError("branch_code")}
      >
        {branches.map((b) => (
          <MenuItem key={b.branch_code} value={b.branch_code}>{b.branch_code} - {b.branch_name}</MenuItem>
        ))}
        {!isCreating && formData.branch_code && !branches.some((b) => b.branch_code === formData.branch_code) && (
          <MenuItem value={formData.branch_code}>{formData.branch_code}</MenuItem>
        )}
      </TextField>
      <TextField
        select
        label="Output Location"
        size="small"
        value={formData.location_id ?? ""}
        onChange={(e) => setFormData((p) => ({ ...p, location_id: e.target.value === "" ? null : Number(e.target.value) }))}
        disabled={!editable}
        helperText={editable ? "Defaults to the branch's location" : undefined}
      >
        <MenuItem value="">Branch default</MenuItem>
        {(editable ? branchLocations : filteredLocations.filter((l) => l.id === formData.location_id)).map((l) => (
          <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>
        ))}
        {!editable && order?.location_id && !filteredLocations.some((l) => l.id === order.location_id) && (
          <MenuItem value={order.location_id}>{order.location_name}</MenuItem>
        )}
      </TextField>
      <TextField
        label="Planned Quantity"
        size="small"
        type="number"
        required
        value={formData.planned_quantity}
        onChange={(e) => setFormData((p) => ({ ...p, planned_quantity: Math.max(Math.floor(Number(e.target.value) || 0), 0) }))}
        onBlur={() => blur("planned_quantity")}
        disabled={!editable}
        inputProps={{ min: 1, step: 1 }}
        error={!!fieldError("planned_quantity")}
        helperText={fieldError("planned_quantity") || (order?.unit_of_measure ? `Unit: ${order.unit_of_measure}` : undefined)}
      />
      <TextField
        label="Planned Start"
        size="small"
        type="date"
        required
        value={formData.planned_start_date}
        onChange={(e) => setFormData((p) => ({ ...p, planned_start_date: e.target.value }))}
        disabled={!editable}
        InputLabelProps={{ shrink: true }}
      />
      <TextField
        label="Planned End"
        size="small"
        type="date"
        required
        value={formData.planned_end_date}
        onChange={(e) => setFormData((p) => ({ ...p, planned_end_date: e.target.value }))}
        onBlur={() => blur("planned_end_date")}
        disabled={!editable}
        InputLabelProps={{ shrink: true }}
        error={!!fieldError("planned_end_date")}
        helperText={fieldError("planned_end_date")}
      />
      <TextField
        select
        label="Priority"
        size="small"
        value={formData.priority}
        onChange={(e) => setFormData((p) => ({ ...p, priority: e.target.value as ProductionOrderInput["priority"] }))}
        disabled={!editable}
      >
        {PRIORITY_OPTIONS.map((o) => (
          <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
        ))}
      </TextField>
      <TextField
        label="Source Reference"
        size="small"
        value={formData.source_reference || ""}
        onChange={(e) => setFormData((p) => ({ ...p, source_reference: e.target.value }))}
        disabled={!editable}
        placeholder="Sales order / quotation no."
        inputProps={{ maxLength: 100 }}
      />
      {selectedOrder?.quote_no && !isCreating && (
        <TextField
          label="Make-to-Order For"
          size="small"
          value={`${selectedOrder.quote_no}${selectedOrder.customer_name ? ` · ${selectedOrder.customer_name}` : ""}`}
          disabled
          helperText="Output is reserved for this quotation line"
        />
      )}
      <Box sx={{ gridColumn: { md: "span 2" } }}>
        <TRemarkField
          label="Remark"
          size="small"
          value={formData.remark || ""}
          onChange={(v) => setFormData((p) => ({ ...p, remark: v }))}
          disabled={!editable}
          multiline
          rows={1}
        />
      </Box>
    </FormSection>
  );

  const tolerancePct = num(order?.overproduction_pct);
  const yieldPct = order?.yield_pct === null || order?.yield_pct === undefined ? null : num(order.yield_pct);
  const progressStrip = order && !isCreating && (
    <Paper variant="outlined" sx={{ p: 1.5, mb: 2, borderRadius: 3, display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(5, 1fr)" }, alignItems: "center" }}>
      {info("Status", <TStatusChip status={order.status} statusMap="productionOrder" size="small" />)}
      {info(
        "Produced",
        <Box>
          <Typography variant="body2" fontWeight={700}>
            {order.produced_quantity} / {order.planned_quantity} {order.unit_of_measure || ""}
          </Typography>
          <LinearProgress variant="determinate" value={Math.min(num(order.progress_pct), 100)} sx={{ height: 6, borderRadius: 3, mt: 0.5 }} />
        </Box>
      )}
      {info(
        "Planned / Max",
        <Tooltip title={tolerancePct ? `Up to ${tolerancePct}% over-production allowed (good + scrap)` : "No over-production allowed"}>
          <span>
            {order.planned_quantity} / {order.max_quantity || order.planned_quantity}
            {tolerancePct ? ` (+${tolerancePct}%)` : ""}
          </span>
        </Tooltip>
      )}
      {info("Scrapped", `${order.scrapped_quantity}${num(order.scrap_value) ? ` · ${currencySymbol} ${fmtLKR(num(order.scrap_value))}` : ""}`)}
      {info(
        "Yield",
        yieldPct === null ? "-" : (
          <Typography variant="body2" fontWeight={700} sx={{ color: yieldPct < 95 ? "warning.dark" : "success.main" }}>
            {yieldPct.toFixed(1)}%
          </Typography>
        )
      )}
      {info(
        "QC Hold",
        order.qc_on_hold_quantity > 0 ? <TChip size="small" color="warning" label={`${order.qc_on_hold_quantity} on hold`} /> : "-"
      )}
      {info(
        "Materials",
        order.material_status ? <TStatusChip status={order.material_status} statusMap="materialAvailability" size="small" /> : "-"
      )}
      {info("Standard Unit Cost", `${currencySymbol} ${fmtLKR(num(order.standard_unit_cost))}`)}
      {info(
        "Due",
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, color: order.is_late ? "error.main" : undefined }}>
          {formatDate(order.planned_end_date)}
          {order.is_late && <TChip size="small" label="Late" color="error" />}
        </Box>
      )}
    </Paper>
  );

  const materialsTable = order && !isCreating && (
    <FormSection title="Components" columns={1}>
      <Paper variant="outlined" sx={{ overflow: "auto", borderRadius: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={modernTableStyles.headerRow}>
              <TableCell>Component</TableCell>
              <TableCell>Method</TableCell>
              <TableCell align="right">Per Unit</TableCell>
              <TableCell align="right">Scrap %</TableCell>
              <TableCell align="right">Required</TableCell>
              <TableCell align="right">Issued</TableCell>
              <TableCell align="right">Remaining</TableCell>
              <TableCell align="right">Available</TableCell>
              <TableCell align="right">Shortage</TableCell>
              <TableCell align="right">{`Unit Cost (${currencySymbol})`}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(order.materials || []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} sx={modernTableStyles.emptyCell}>Loading...</TableCell>
              </TableRow>
            ) : (
              order.materials.map((m) => (
                <TableRow key={m.id} sx={modernTableStyles.bodyRow}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{m.product_name}</Typography>
                    <Typography variant="caption" color="text.secondary">{m.product_code}</Typography>
                  </TableCell>
                  <TableCell>
                    <TChip size="small" variant="outlined" label={m.issue_method === "backflush" ? "Backflush" : "Manual"}
                      color={m.issue_method === "backflush" ? "info" : "default"} />
                  </TableCell>
                  <TableCell align="right">{num(m.quantity_per_unit)} {m.unit_of_measure || ""}</TableCell>
                  <TableCell align="right">{num(m.scrap_pct)}</TableCell>
                  <TableCell align="right">{m.required_quantity}</TableCell>
                  <TableCell align="right">{m.issued_quantity}</TableCell>
                  <TableCell align="right">{m.remaining_quantity}</TableCell>
                  <TableCell align="right">{m.available_quantity}</TableCell>
                  <TableCell align="right" sx={{ color: m.shortage_quantity > 0 ? "error.main" : undefined, fontWeight: m.shortage_quantity > 0 ? 700 : undefined }}>
                    {m.shortage_quantity || "-"}
                  </TableCell>
                  <TableCell align="right">{fmtLKR(num(m.unit_cost))}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>
    </FormSection>
  );

  const money = (v: unknown) => `${currencySymbol} ${fmtLKR(num(v))}`;
  const opActions = !!order && canShopFloor && (order.status === "released" || order.status === "in_progress");
  const operationsTable = order && !isCreating && (
    <FormSection title="Operations" columns={1}>
      <Paper variant="outlined" sx={{ overflow: "auto", borderRadius: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={modernTableStyles.headerRow}>
              <TableCell sx={{ width: 60 }}>Seq</TableCell>
              <TableCell>Operation</TableCell>
              <TableCell>Work Center</TableCell>
              <TableCell align="right">Planned (min)</TableCell>
              <TableCell align="right">Actual (min)</TableCell>
              <TableCell align="right">Completed Qty</TableCell>
              <TableCell align="center">Status</TableCell>
              {opActions && <TableCell align="center" sx={{ width: 170 }}>Action</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {(order.operations || []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={opActions ? 8 : 7} sx={modernTableStyles.emptyCell}>This BOM has no routing operations</TableCell>
              </TableRow>
            ) : (
              order.operations.map((op) => {
                const cap = order.max_quantity || order.planned_quantity;
                return (
                  <TableRow key={op.id} sx={modernTableStyles.bodyRow}>
                    <TableCell>{op.sequence}</TableCell>
                    <TableCell>
                      {op.name}
                      {op.is_outside && <TChip size="small" variant="outlined" color="secondary" label="Outside" sx={{ ml: 1 }} />}
                    </TableCell>
                    <TableCell>
                      {op.work_center_code} {op.work_center_name ? `- ${op.work_center_name}` : ""}
                      {op.is_outside && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {op.supplier_name || "No supplier"} · {money(op.outside_unit_cost)} / unit
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">{op.is_outside ? "-" : num(op.planned_minutes)}</TableCell>
                    <TableCell align="right" sx={{ color: num(op.actual_minutes) > num(op.planned_minutes) ? "warning.dark" : undefined }}>
                      {op.is_outside ? "-" : num(op.actual_minutes)}
                    </TableCell>
                    <TableCell align="right">
                      {op.is_outside ? (
                        <Tooltip title="Units received back from the subcontractor">
                          <span>{op.outside_quantity} / {order.planned_quantity} received</span>
                        </Tooltip>
                      ) : (
                        op.completed_quantity
                      )}
                    </TableCell>
                    <TableCell align="center"><TStatusChip status={op.status} statusMap="operationStatus" size="small" /></TableCell>
                    {opActions && (
                      <TableCell align="center">
                        {op.is_outside ? (
                          op.outside_quantity < cap && (
                            <Button size="small" startIcon={<LocalShippingIcon fontSize="small" />} disabled={busy}
                              onClick={() => openPanel("outside", op.id)} sx={{ textTransform: "none" }}>
                              Receive outside work
                            </Button>
                          )
                        ) : (
                          op.status !== "completed" && (
                            <Button size="small" startIcon={<TimerIcon fontSize="small" />} disabled={busy}
                              onClick={() => openPanel("time", op.id)} sx={{ textTransform: "none" }}>
                              Log time
                            </Button>
                          )
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Paper>
    </FormSection>
  );

  const byProductsSection = order && !isCreating && (order.by_products || []).length > 0 && (
    <FormSection title="By-products" columns={1}>
      <Paper variant="outlined" sx={{ overflow: "auto", borderRadius: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={modernTableStyles.headerRow}>
              <TableCell>By-product</TableCell>
              <TableCell align="right">Per Unit</TableCell>
              <TableCell align="right">Expected</TableCell>
              <TableCell align="right">Received</TableCell>
              <TableCell align="right">{`Unit Cost (${currencySymbol})`}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {order.by_products.map((b) => (
              <TableRow key={b.id} sx={modernTableStyles.bodyRow}>
                <TableCell>
                  <Typography variant="body2" fontWeight={600}>{b.product_name}</Typography>
                  <Typography variant="caption" color="text.secondary">{b.product_code}</Typography>
                </TableCell>
                <TableCell align="right">{num(b.quantity_per_unit)} {b.unit_of_measure || ""}</TableCell>
                <TableCell align="right">
                  <Tooltip title="At the good units recorded so far"><span>{b.expected_quantity}</span></Tooltip>
                </TableCell>
                <TableCell align="right" sx={{ color: b.received_quantity < b.expected_quantity ? "warning.dark" : undefined, fontWeight: 600 }}>
                  {b.received_quantity}
                </TableCell>
                <TableCell align="right">{fmtLKR(num(b.unit_cost))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </FormSection>
  );

  const variance = order?.variance_amount !== null && order?.variance_amount !== undefined ? num(order.variance_amount) : null;
  const costingSection = order && !isCreating && (
    <FormSection title="Costing" columns={2}>
      <Paper variant="outlined" sx={{ overflow: "auto", borderRadius: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={modernTableStyles.headerRow}>
              <TableCell>Cost Element</TableCell>
              <TableCell align="right">Planned</TableCell>
              <TableCell align="right">Actual</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {([
              ["Material", order.planned_material_cost, order.actual_material_cost],
              ["Labour", order.planned_labor_cost, order.actual_labor_cost],
              ["Overhead", order.planned_overhead_cost, order.actual_overhead_cost],
              ...((order.operations || []).some((o) => o.is_outside) || num(order.actual_outside_cost)
                ? [["Outside Work", null, order.actual_outside_cost]]
                : []),
            ] as [string, unknown, unknown][]).map(([label, p, a]) => (
              <TableRow key={label} sx={modernTableStyles.bodyRow}>
                <TableCell>{label}</TableCell>
                <TableCell align="right">{p === null ? "-" : money(p)}</TableCell>
                <TableCell align="right">{money(a)}</TableCell>
              </TableRow>
            ))}
            <TableRow sx={{ bgcolor: "action.hover" }}>
              <TableCell><Typography fontWeight={700} variant="body2">Total</Typography></TableCell>
              <TableCell align="right"><Typography fontWeight={700} variant="body2">{money(order.planned_total_cost)}</Typography></TableCell>
              <TableCell align="right"><Typography fontWeight={700} variant="body2">{money(order.actual_total_cost)}</Typography></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Paper>
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5, alignContent: "start" }}>
        {info("Output Value (at standard)", money(order.output_value))}
        {info("WIP Balance", money(order.wip_balance))}
        {info(
          "Production Variance",
          variance === null ? (
            <Typography variant="body2" color="text.secondary">Posted on close</Typography>
          ) : (
            <Typography variant="body2" fontWeight={700} sx={{ color: variance > 0 ? "error.main" : variance < 0 ? "success.main" : undefined }}>
              {money(variance)} {variance > 0 ? "(unfavourable)" : variance < 0 ? "(favourable)" : ""}
            </Typography>
          )
        )}
        {info(
          "Planned Unit Cost",
          order.planned_quantity ? money(num(order.planned_total_cost) / order.planned_quantity) : "-"
        )}
        {info("Outside Work Cost", money(order.actual_outside_cost))}
        {info("Scrap Value", money(order.scrap_value))}
        {info("Yield", yieldPct === null ? "-" : `${yieldPct.toFixed(1)}%`)}
      </Box>
    </FormSection>
  );

  const typeColor = (t: string) => (t === "return" ? "warning" : t === "backflush" ? "info" : "primary");
  const transactionsSection = order && !isCreating && (
    <FormSection title="Transactions" columns={1}>
      <Box>
        <Tabs value={activityTab} onChange={(_, v) => setActivityTab(v)} sx={{ mb: 1, minHeight: 36, "& .MuiTab-root": { minHeight: 36, textTransform: "none" } }}>
          <Tab label={`Material Movements (${activity?.materials.length ?? 0})`} />
          <Tab label={`Output Receipts (${activity?.outputs.length ?? 0})`} />
          <Tab label={`Time Logs (${activity?.time_logs.length ?? 0})`} />
          <Tab label={`Outside Work (${activity?.outside_receipts?.length ?? 0})`} />
          <Tab label={`Quality Results (${activity?.qc_results?.length ?? 0})`} />
        </Tabs>
        <Paper variant="outlined" sx={{ overflow: "auto", borderRadius: 3 }}>
          {activityTab === 0 && (
            <Table size="small">
              <TableHead>
                <TableRow sx={modernTableStyles.headerRow}>
                  <TableCell>Date</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Component</TableCell>
                  <TableCell align="right">Qty</TableCell>
                  <TableCell align="right">{`Value (${currencySymbol})`}</TableCell>
                  <TableCell>By</TableCell>
                  <TableCell>Remark</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(activity?.materials || []).length === 0 ? (
                  <TableRow><TableCell colSpan={7} sx={modernTableStyles.emptyCell}>No material movements yet</TableCell></TableRow>
                ) : (
                  activity!.materials.map((t) => (
                    <TableRow key={t.id} sx={modernTableStyles.bodyRow}>
                      <TableCell>{formatDateTimeReadable(t.transaction_date)}</TableCell>
                      <TableCell>
                        <TChip size="small" variant="outlined" color={typeColor(t.transaction_type)}
                          label={t.transaction_type.charAt(0).toUpperCase() + t.transaction_type.slice(1)} />
                      </TableCell>
                      <TableCell>{t.product_name} <Typography component="span" variant="caption" color="text.secondary">{t.product_code}</Typography></TableCell>
                      <TableCell align="right">{t.transaction_type === "return" ? -t.quantity : t.quantity}</TableCell>
                      <TableCell align="right">{fmtLKR(num(t.total_cost))}</TableCell>
                      <TableCell>{t.created_by_name || "-"}</TableCell>
                      <TableCell>{t.remark || "-"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
          {activityTab === 1 && (
            <Table size="small">
              <TableHead>
                <TableRow sx={modernTableStyles.headerRow}>
                  <TableCell>Date</TableCell>
                  <TableCell align="right">Good</TableCell>
                  <TableCell align="right">Scrap</TableCell>
                  <TableCell>Scrap Reason</TableCell>
                  <TableCell>QC</TableCell>
                  <TableCell>Batch / Serials</TableCell>
                  <TableCell>Location</TableCell>
                  <TableCell>By-products</TableCell>
                  <TableCell align="right">{`Value (${currencySymbol})`}</TableCell>
                  <TableCell>By</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(activity?.outputs || []).length === 0 ? (
                  <TableRow><TableCell colSpan={10} sx={modernTableStyles.emptyCell}>No output recorded yet</TableCell></TableRow>
                ) : (
                  activity!.outputs.map((o) => (
                    <TableRow key={o.id} sx={modernTableStyles.bodyRow}>
                      <TableCell>{formatDateTimeReadable(o.receipt_date)}</TableCell>
                      <TableCell align="right">{o.quantity}</TableCell>
                      <TableCell align="right">{o.scrap_quantity}</TableCell>
                      <TableCell>{o.scrap_quantity > 0 ? scrapReasonLabel(o.scrap_reason) || "-" : "-"}</TableCell>
                      <TableCell>
                        {o.qc_status && o.qc_status !== "none" ? (
                          <Tooltip title={`Passed ${o.qc_passed_quantity}, failed ${o.qc_failed_quantity} of ${o.quantity}`}>
                            <span>
                              <TChip size="small" variant="outlined" color={QC_CHIP[o.qc_status]?.color || "default"}
                                label={QC_CHIP[o.qc_status]?.label || o.qc_status} />
                            </span>
                          </Tooltip>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell>
                        {o.serial_numbers.length > 0 ? (
                          <Tooltip title={o.serial_numbers.join(", ")}>
                            <span>{o.serial_numbers.length} serial(s)</span>
                          </Tooltip>
                        ) : (
                          o.batch_no || "-"
                        )}
                        {o.expiry_date ? ` · exp ${formatDate(o.expiry_date)}` : ""}
                      </TableCell>
                      <TableCell>{o.location_name || "-"}</TableCell>
                      <TableCell>
                        {(o.by_products || []).length > 0
                          ? (o.by_products || []).map((b) => `${b.quantity} ${b.product_name || ""}`.trim()).join(", ")
                          : "-"}
                      </TableCell>
                      <TableCell align="right">{fmtLKR(num(o.total_value))}</TableCell>
                      <TableCell>{o.created_by_name || "-"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
          {activityTab === 2 && (
            <Table size="small">
              <TableHead>
                <TableRow sx={modernTableStyles.headerRow}>
                  <TableCell>Logged</TableCell>
                  <TableCell>Operation</TableCell>
                  <TableCell>Operator</TableCell>
                  <TableCell align="right">Minutes</TableCell>
                  <TableCell align="right">Qty</TableCell>
                  <TableCell align="right">{`Labour + Overhead (${currencySymbol})`}</TableCell>
                  <TableCell>Remark</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(activity?.time_logs || []).length === 0 ? (
                  <TableRow><TableCell colSpan={7} sx={modernTableStyles.emptyCell}>No time booked yet</TableCell></TableRow>
                ) : (
                  activity!.time_logs.map((l) => (
                    <TableRow key={l.id} sx={modernTableStyles.bodyRow}>
                      <TableCell>{formatDateTimeReadable(l.created_at)}</TableCell>
                      <TableCell>
                        {l.operation_name}
                        <Typography variant="caption" color="text.secondary" display="block">{l.work_center_name}</Typography>
                      </TableCell>
                      <TableCell>{l.employee_name || l.created_by_name || "-"}</TableCell>
                      <TableCell align="right">{num(l.minutes)}</TableCell>
                      <TableCell align="right">{l.completed_quantity}</TableCell>
                      <TableCell align="right">{fmtLKR(num(l.labor_cost) + num(l.overhead_cost))}</TableCell>
                      <TableCell>
                        {l.is_auto && <TChip size="small" label="Auto" color="info" variant="outlined" sx={{ mr: 0.5 }} />}
                        {l.remark || (l.is_auto ? "" : "-")}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
          {activityTab === 3 && (
            <Table size="small">
              <TableHead>
                <TableRow sx={modernTableStyles.headerRow}>
                  <TableCell>Received</TableCell>
                  <TableCell>Operation</TableCell>
                  <TableCell>Supplier</TableCell>
                  <TableCell align="right">Qty</TableCell>
                  <TableCell align="right">{`Amount (${currencySymbol})`}</TableCell>
                  <TableCell>Bill Ref</TableCell>
                  <TableCell>Expense</TableCell>
                  <TableCell>By</TableCell>
                  <TableCell>Remark</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(activity?.outside_receipts || []).length === 0 ? (
                  <TableRow><TableCell colSpan={9} sx={modernTableStyles.emptyCell}>No outside work received yet</TableCell></TableRow>
                ) : (
                  (activity?.outside_receipts || []).map((r) => (
                    <TableRow key={r.id} sx={modernTableStyles.bodyRow}>
                      <TableCell>{formatDateTimeReadable(r.receipt_date)}</TableCell>
                      <TableCell>{r.operation_name || "-"}</TableCell>
                      <TableCell>{r.supplier_name || "-"}</TableCell>
                      <TableCell align="right">{r.quantity}</TableCell>
                      <TableCell align="right">{fmtLKR(num(r.amount))}</TableCell>
                      <TableCell>{r.bill_reference || "-"}</TableCell>
                      <TableCell>
                        {r.expense_no ? <TChip size="small" variant="outlined" color="info" label={r.expense_no} /> : "-"}
                      </TableCell>
                      <TableCell>{r.created_by_name || "-"}</TableCell>
                      <TableCell>{r.remark || "-"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
          {activityTab === 4 && (
            <Table size="small">
              <TableHead>
                <TableRow sx={modernTableStyles.headerRow}>
                  <TableCell>Decided</TableCell>
                  <TableCell>Batch</TableCell>
                  <TableCell align="right">Passed</TableCell>
                  <TableCell align="right">Failed</TableCell>
                  <TableCell align="right">{`Written Off (${currencySymbol})`}</TableCell>
                  <TableCell>By</TableCell>
                  <TableCell>Remark</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(activity?.qc_results || []).length === 0 ? (
                  <TableRow><TableCell colSpan={7} sx={modernTableStyles.emptyCell}>No quality decisions yet</TableCell></TableRow>
                ) : (
                  (activity?.qc_results || []).map((r) => (
                    <TableRow key={r.id} sx={modernTableStyles.bodyRow}>
                      <TableCell>{formatDateTimeReadable(r.decided_at)}</TableCell>
                      <TableCell>{r.batch_no || "-"}</TableCell>
                      <TableCell align="right">{r.passed_quantity}</TableCell>
                      <TableCell align="right" sx={{ color: r.failed_quantity > 0 ? "error.main" : undefined }}>{r.failed_quantity}</TableCell>
                      <TableCell align="right">{fmtLKR(num(r.failed_value))}</TableCell>
                      <TableCell>{r.created_by_name || "-"}</TableCell>
                      <TableCell>{r.remark || "-"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </Paper>
      </Box>
    </FormSection>
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Manufacturing", href: "/manufacturing" },
          { label: "Production Orders", href: "/manufacturing/orders" },
          ...(order || isCreating ? [{ label: isCreating ? "New Order" : order?.order_no || "" }] : []),
        ]}
        title={order ? `${order.order_no} — ${order.product_name || ""}` : ""}
        titleIcon={<AssignmentIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Production Order"
        noSelectionTitle="Select a Production Order"
        chips={
          order && !isCreating
            ? [
                (() => {
                  const st = getStatusProps(order.status, "productionOrder");
                  return { label: st.label, color: st.color };
                })(),
                ...(order.is_late ? [{ label: "Late", color: "error" as const }] : []),
                ...(order.qc_on_hold_quantity > 0 ? [{ label: `QC hold ${order.qc_on_hold_quantity}`, color: "warning" as const }] : []),
              ]
            : []
        }
      />

      <ActionToolbar
        hasSelectedItem={!!order}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={isFormValid}
        canCreate={canCreate}
        canDuplicate={false}
        canUpdate={canUpdate && order?.status === "draft"}
        canDelete={canDeletePerm && order?.status === "draft"}
        onNew={handleNew}
        onDelete={handleDelete}
        onSave={handleSave}
        onCancel={handleCancel}
        onEdit={() => {
          handleStartEdit();
          setTouched({});
        }}
        endActions={statusActions}
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!order && !isCreating ? (
          <EmptyState message="Select a production order from the list or create a new one" />
        ) : (
          <>
            {order?.status === "cancelled" && order.cancel_reason && (
              <Alert severity="error" sx={{ mb: 2 }}>Cancelled: {order.cancel_reason}</Alert>
            )}
            {order?.status === "draft" && !isEditing && (
              <Alert severity="info" icon={<CheckCircleIcon />} sx={{ mb: 2 }}>
                Draft order — components and operations are built from the BOM. Release it to issue materials and start production.
              </Alert>
            )}
            {order && !isCreating && order.qc_on_hold_quantity > 0 && (
              <Alert severity="warning" icon={<FactCheckIcon />} sx={{ mb: 2 }}>
                {order.qc_on_hold_quantity} good unit(s){heldOutputs ? ` from ${heldOutputs} output receipt(s)` : ""} are on quality
                hold and cannot be sold until an approver passes them{canApprove ? " — use Quality Check" : ""}.
              </Alert>
            )}
            {isCreating && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Components and routing operations are copied from the selected BOM when the order is saved.
              </Alert>
            )}
            {progressStrip}
            {headerForm}
            {!isEditing && materialsTable}
            {!isEditing && operationsTable}
            {!isEditing && byProductsSection}
            {!isEditing && costingSection}
            {!isEditing && transactionsSection}

            {order && !isCreating && !isEditing && (
              <FormSection
                title="Activity History"
                columns={3}
                titleAction={
                  <Tooltip title="View activity history">
                    <IconButton size="small" onClick={() => setActivityHistoryOpen(true)}>
                      <HistoryIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
              >
                {info("Created", `${formatDateTimeReadable(order.created_at) || "-"}${order.created_by_name ? ` by ${order.created_by_name}` : ""}`)}
                {info("Released", order.released_at ? `${formatDateTimeReadable(order.released_at)}${order.released_by_name ? ` by ${order.released_by_name}` : ""}` : "-")}
                {info("Closed", order.closed_at ? formatDateTimeReadable(order.closed_at) : "-")}
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
        title="Production Orders"
        titleSlot={
          isDetailMode ? (
            <Button size="small" startIcon={<ArrowBackIcon fontSize="small" />} onClick={handleBack} disabled={busy || isSaving} sx={{ textTransform: "none" }}>
              Back to Production Orders
            </Button>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search orders..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                }}
                sx={{ width: 190, flexShrink: 0, "& .MuiOutlinedInput-root": { borderRadius: "24px" } }}
              />
              <Box sx={{ width: 160, flexShrink: 0, "& .MuiOutlinedInput-root": { borderRadius: "24px" } }}>
                <TBranchFilter branches={branches} value={filterBranch} onChange={setFilterBranch} label="" placeholder="All Branches" size="small" />
              </Box>
              <Box sx={{ width: 170, flexShrink: 0 }}>
                <TStatusFilter options={STATUS_FILTER_OPTIONS} value={filterStatus} onChange={setFilterStatus} label="" placeholder="All Statuses" size="small" />
              </Box>
              <TChip
                label="Late only"
                size="small"
                color={lateOnly ? "error" : "default"}
                variant={lateOnly ? "filled" : "outlined"}
                onClick={() => setLateOnly((v) => !v)}
              />
              {(searchQuery || filterBranch || filterStatus || lateOnly) && (
                <Button
                  size="small"
                  onClick={() => {
                    setSearchQuery("");
                    setFilterBranch(null);
                    setFilterStatus(null);
                    setLateOnly(false);
                  }}
                  sx={{ textTransform: "none" }}
                >
                  Clear
                </Button>
              )}
            </Box>
          )
        }
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ["production-orders"] });
          queryClient.invalidateQueries({ queryKey: ["production-order-activity"] });
        }}
        isLoading={isLoading}
        {...(isDetailMode ? { children: detailPanel } : { children: tablePanel })}
        headerActions={
          isDetailMode || !canCreate ? undefined : (
            <Stack direction="row" spacing={1} sx={{ mr: 1 }}>
              <Button variant="outlined" size="small" startIcon={<RequestQuoteIcon />} onClick={() => setFromQuoteOpen(true)}>
                From Quotation
              </Button>
              <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={handleNew}>
                New production order
              </Button>
            </Stack>
          )
        }
      />
      {order && printDoc && (
        <TPrintPreviewDialog
          open={!!printDoc}
          onClose={() => setPrintDoc(null)}
          documentType={printDoc}
          documentId={order.id}
          title={`${printDoc === "job-card" ? "Job Card" : "Production Order"}: ${order.order_no}`}
        />
      )}
      <FromQuotationDialog
        open={fromQuoteOpen}
        branchCode={filterBranch}
        onClose={() => setFromQuoteOpen(false)}
        onCreated={(o) => {
          setFromQuoteOpen(false);
          setSelectedOrder(o);
          setFormData(resetFormFromOrder(o));
          queryClient.setQueryData(["production-orders", "detail", o.id], o);
          for (const key of [["production-orders"], ["quote-demand"], ["mrp"], ["manufacturing-dashboard"], ["sales-quote-details"]]) {
            queryClient.invalidateQueries({ queryKey: key });
          }
        }}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />

      <MaterialMovePanel
        open={dialog === "issue" || dialog === "return"}
        mode={dialog === "return" ? "return" : "issue"}
        order={order}
        saving={busy}
        onClose={() => setDialog(null)}
        onSubmit={(data) =>
          order &&
          runAction(
            () =>
              dialog === "return"
                ? productionOrdersApi.returnMaterials({ id: order.id, data })
                : productionOrdersApi.issueMaterials({ id: order.id, data }),
            dialog === "return" ? "Materials returned to stock" : "Materials issued"
          )
        }
      />
      <OutputPanel
        open={dialog === "output"}
        order={order}
        locations={filteredLocations}
        requiresQc={requiresQc}
        saving={busy}
        onClose={() => setDialog(null)}
        onSubmit={(data) =>
          order &&
          runAction(
            () => productionOrdersApi.recordOutput({ id: order.id, data }),
            requiresQc && data.quantity > 0 ? "Output recorded and held for a quality check" : "Output recorded"
          )
        }
      />
      <TimeLogPanel
        open={dialog === "time"}
        order={order}
        saving={busy}
        initialOperationId={panelOpId}
        onClose={() => setDialog(null)}
        onSubmit={(data) => order && runAction(() => productionOrdersApi.logTime({ id: order.id, data }), "Time logged")}
      />
      <OutsideWorkPanel
        open={dialog === "outside"}
        order={order}
        saving={busy}
        initialOperationId={panelOpId}
        currencySymbol={currencySymbol}
        onClose={() => setDialog(null)}
        onSubmit={(data) =>
          order &&
          runAction(
            () => productionOrdersApi.receiveOutsideWork({ id: order.id, data }),
            data.create_expense ? "Outside work received; pending expense raised" : "Outside work received"
          )
        }
      />
      <QualityCheckPanel
        open={dialog === "quality"}
        order={order}
        outputs={activity?.outputs || []}
        saving={busy}
        onClose={() => setDialog(null)}
        onSubmit={(data) => order && runAction(() => productionOrdersApi.qualityDecision({ id: order.id, data }), "Quality decision saved")}
      />
      <CompleteOrderPanel
        open={dialog === "complete"}
        order={order}
        saving={busy}
        onClose={() => setDialog(null)}
        onSubmit={(bookPlannedTime) =>
          order && runAction(() => productionOrdersApi.complete({ id: order.id, bookPlannedTime }), "Order completed")
        }
      />
      <CancelOrderPanel
        open={dialog === "cancel"}
        orderNo={order?.order_no}
        saving={busy}
        onClose={() => setDialog(null)}
        onSubmit={(reason) => order && runAction(() => productionOrdersApi.cancel({ id: order.id, reason }), "Order cancelled")}
      />

      <TActivityHistoryPanel
        open={activityHistoryOpen}
        onClose={() => setActivityHistoryOpen(false)}
        entityType="production_order"
        entityId={order?.id}
        actionLabels={{
          create: "Order created",
          update: "Order updated",
          release: "Order released",
          start: "Production started",
          issue_materials: "Materials issued",
          return_materials: "Materials returned",
          record_output: "Output recorded",
          log_time: "Time logged",
          outside_work: "Outside work received",
          qc_decision: "Quality decision",
          complete: "Order completed",
          close: "Order closed",
          cancel: "Order cancelled",
        }}
      />
    </>
  );
}
