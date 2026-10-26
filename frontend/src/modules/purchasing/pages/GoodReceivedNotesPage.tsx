/**
 * GoodReceivedNotesPage - Using Tijaero-style reusable components
 * Refactored to use common purchasing components for better code reuse
 * 
 * OPTIMIZED: Uses aggregated reference data endpoint
 * BEFORE: 4 separate API calls (locations, branches, purchaseOrders, grns)
 * AFTER: 3 API calls (reference-data with locations/branches, purchaseOrders, grns)
 */

import { usePermission } from "@/auth/permissions";
import { useCurrencyStore } from "@/state/currencyStore";
// ConfirmDialog now uses TConfirmDialog from tijaero
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import BusinessIcon from "@mui/icons-material/Business";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteIcon from "@mui/icons-material/Delete";
import ErrorIcon from "@mui/icons-material/Error";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import InventoryIcon from "@mui/icons-material/Inventory";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import PaymentIcon from "@mui/icons-material/Payment";
import HistoryIcon from "@mui/icons-material/History";
import SaveIcon from "@mui/icons-material/Save";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import SearchIcon from "@mui/icons-material/Search";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  FormGroup,
  IconButton,
  InputAdornment,
  LinearProgress,
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";


// Import tijaero components
import {
  TChip,
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  fmtLKR,
  FormSection,
  handleApiError,
  MasterDetailLayout,
  modernTableStyles,
  showErrorToast,
  showSuccessToast,
  TBranchFilter,
  TConfirmDialog,
  TPrintButton,
  TPrintPreviewDialog,
  TRemarkField,
  useCrudMutation,
  useMasterDetailState,
  useTConfirmDialog,
  TActivityHistoryPanel,
  TDataGrid,
  type TDataGridColumn,
  continueOrReveal,
  canPrintDocument,
} from "@/components/tijaero";

import { useReferenceData } from "@/hooks";
import { locationsApi } from "@/modules/common/api";
import { companyAssetsApi, productsApi, salesStockApi } from "@/modules/inventory/api";
import ReclassifyDialog from "@/modules/inventory/components/ReclassifyDialog";
import LandedCostPanel from "@/modules/purchasing/components/LandedCostPanel";
import { EntityLink, EntityPeekButton } from "@/components/tijaero/peek";
import { Product } from "@/modules/inventory/types";
import { goodReceivedItemsApi, goodReceivedNotesApi, purchaseOrdersApi, suppliersApi } from "@/modules/purchasing/api";
import {
  GoodReceivedItem, GoodReceivedItemCreate, GoodReceivedNote, GRNReceiveLine,
  GoodReceivedNoteCreate, PurchasingOrder,
  PurchasingOrderItem,
  PurchasingOrderWithItems, Supplier
} from "@/modules/purchasing/types";
// Currency formatting uses fmtLKR from tijaero
import { formatDateTimeReadable } from "@/utils/formatters";

import CancelIcon from "@mui/icons-material/Cancel";
const FORM_STEPS = ["GRN Information", "Received Items"];

// Location type for reference data
interface Location {
  id: number;
  name: string;
  branch_code: string;
}

/** Preview next sequential number using same format as backend */
const getNextNumber = (prefix: string, existing: { no: string }[], branchCode?: string): string => {
  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const actualBranch = branchCode || "HQ";
  const fullPrefix = `${prefix}-${actualBranch}-${yy}`;
  let maxSeq = 0;
  for (const item of existing) {
    if (item.no?.startsWith(fullPrefix)) {
      const lastPart = item.no.split("-").pop() || "";
      if (lastPart.length > 2) {
        const seq = parseInt(lastPart.slice(2), 10);
        if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
      }
    }
  }
  return `${fullPrefix}${String(maxSeq + 1).padStart(6, '0')}`;
};

// The GRN date is always today (local date), filled in automatically
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const INITIAL_FORM_DATA: GoodReceivedNoteCreate = {
  good_received_no: "",
  good_received_date: todayLocal(),
  supplier_invoice_no: "",
  delivery_note_no: "",
  vehicle_no: "",
  received_by: "",
  remark: "",
  branch_code: "HQ",
  good_received_locations_id: 1,
  purchasingorders_id: 0,
};

type TrackingType = "serial" | "batch" | "none";

interface GRNLineItem extends Omit<GoodReceivedItemCreate, "barcode"> {
  _id: string;
  id?: number; // For existing items
  barcode: string; // "" for batch/none lots (no per-unit barcode)
  tracking_type: TrackingType;
  max_quantity?: number; // Remaining receivable qty for a batch/none lot
  product_name?: string;
  product_id?: number;
  quantity?: number;
  unit_price?: number;
  po_item_id?: number;
  warranty_month?: string;  // Warranty from PO or entered in GRN
  scanned?: boolean;
  saveToSalesStock: boolean;
  saveToCompanyAssets: boolean;
  barcodeError?: string;  // Error message if barcode already exists
}

// Batch/none-tracked products are received as one lot line carrying a
// quantity (no per-unit barcode); serial products stay one line per unit.
const isLotItem = (i: { tracking_type?: TrackingType }) => (i.tracking_type ?? "serial") !== "serial";
// Today's date as YYYY-MM-DD in the user's own time zone (an expiry before it means already expired).
const todayLocalISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const isLotReady = (i: GRNLineItem) =>
  (i.quantity ?? 0) >= 1 &&
  (i.max_quantity === undefined || (i.quantity ?? 0) <= i.max_quantity) &&
  (i.tracking_type !== "batch" || (!!i.batch_no?.trim() && !(i.expiry_date && i.expiry_date < todayLocalISO())));
const lineUnits = (i: GRNLineItem) => (isLotItem(i) ? (i.quantity ?? 0) : 1);

// Grouped items by product for nice display
interface ProductGroup {
  product_id: number;
  product_name: string;
  unit_price: number;
  total_quantity: number;
  items: GRNLineItem[];
  expanded: boolean;
}

interface POFilterOption {
  id: number;
  purchasing_order_no: string;
}

// A GRN row as shown in the browse table, with the PO/supplier/branch
// display strings looked up and attached directly so the table's own
// column-header sort orders by the displayed text rather than raw ids.
type GRNRow = GoodReceivedNote & {
  po_display: string;
  supplier_display: string;
  branch_display: string;
};

const resetFormFromGRN = (grn: GoodReceivedNote): GoodReceivedNoteCreate => ({
  good_received_no: grn.good_received_no,
  good_received_date: grn.good_received_date?.split("T")[0] || "",
  supplier_invoice_no: grn.supplier_invoice_no || "",
  delivery_note_no: grn.delivery_note_no || "",
  vehicle_no: grn.vehicle_no || "",
  received_by: grn.received_by || "",
  remark: grn.remark || "",
  branch_code: grn.branch_code,
  good_received_locations_id: grn.good_received_locations_id,
  purchasingorders_id: grn.purchasingorders_id,
});

export default function GoodReceivedNotesPage() {
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Set by the "Create GRN" shortcut on PurchaseOrdersPage (?poId=123);
  // consumed once purchaseOrders has loaded (see effect near handlePOChange).
  const pendingPoIdFromUrl = useRef<number | null>(null);

  const [lineItems, setLineItems] = useState<GRNLineItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [formStep, setFormStep] = useState(0);
  // Everything received goes to Sales Stock; asset capitalisation is a separate step.
  const defaultSaveToSalesStock = true;
  const defaultSaveToCompanyAssets = false;
  const [productGroups, setProductGroups] = useState<ProductGroup[]>([]);
  const [_products, setProducts] = useState<Product[]>([]);
  const [loadingPOItems, setLoadingPOItems] = useState(false);
  const [activeScanItem, setActiveScanItem] = useState<string | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Most units still receivable per PO line (ordered + the product's over-receipt tolerance - already received).
  const [receiptCaps, setReceiptCaps] = useState<Record<number, number>>({});

  // Display info per PO line for the receiving grid (ordered / already received / item master data).
  const [lineMeta, setLineMeta] = useState<Record<number, {
    ordered: number;
    received: number;
    item_code: string;
    description: string;
    uom: string;
  }>>({});

  // Goods delivered but NOT accepted, per PO line: they never enter stock and the PO stays open.
  const [rejections, setRejections] = useState<Record<number, { qty: string; reason: string }>>({});

  // Cancel (reverse) a posted GRN
  const canCancelGRN = usePermission("grn", "delete");
  const canCreateGRN = usePermission("grn", "create");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Print Dialog State
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [selectedGrnIdForPrint, setSelectedGrnIdForPrint] = useState<number | null>(null);

  const handlePrint = (grnId: number) => {
    setSelectedGrnIdForPrint(grnId);
    setPrintDialogOpen(true);
  };

  // Track barcode validation state for debouncing
  const barcodeValidationTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Credit limit override state
  const [creditLimitDialog, setCreditLimitDialog] = useState<{
    open: boolean;
    errorMessage: string;
    pendingData: GoodReceivedNoteCreate | null;
  }>({ open: false, errorMessage: "", pendingData: null });

  // Check if user can override credit limit
  const canOverrideCredit = usePermission("purchasing", "credit_override");

  // Confirm dialog for unsaved changes and delete actions
  const confirmDialog = useTConfirmDialog();

  // Validation state - track which fields have been touched/blurred
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Mark field as touched when user leaves it
  const handleBlur = (fieldName: string) => {
    setTouched(prev => ({ ...prev, [fieldName]: true }));
  };

  // Filter states (applied - drives the actual list filtering)
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterSupplier, setFilterSupplier] = useState<number | null>(null);
  const [filterPOId, setFilterPOId] = useState<number | null>(null);
  const [filterCreatedByUser, setFilterCreatedByUser] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const {
    searchQuery,
    setSearchQuery,
    selectedItem: selectedGRN,
    setSelectedItem: setSelectedGRN,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    formData,
    setFormData,
    handleSelectItem: handleSelectGRN,
    handleNew: handleNewGRNBase,
    handleCancel: handleCancelBase,
    // handleStartEdit removed - GRNs are not editable after creation
  } = useMasterDetailState<GoodReceivedNote, GoodReceivedNoteCreate>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromGRN,
    defaultSortField: "good_received_date",
    confirmUnsavedChanges: () => confirmDialog.confirm({
      title: "Discard Changes",
      message: "You have unsaved changes. Discard them?",
      confirmText: "Discard",
      cancelText: "Keep Editing",
      confirmColor: "warning",
    }),
    extraDirty: lineItems.length > 0,
    onDiscard: () => { setLineItems([]); setFormStep(0); },
  });

  // Activity History is opened on demand from a detail icon next to the
  // Activity History section title, rather than shown inline.
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);

  // OPTIMIZED: Fetch locations and branches in a single call
  const { data: refData, filteredBranches, defaultBranchCode } = useReferenceData(["locations", "branches"]);

  // Auto-default branch filter for non-superuser users
  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterBranch(null);
    setFilterSupplier(null);
    setFilterPOId(null);
    setFilterCreatedByUser(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-focus the barcode input whenever the active scan item changes.
  // Using useEffect is more reliable than a one-shot setTimeout inside
  // startScanning because React is guaranteed to have committed the new
  // inputRef assignment before the effect fires.
  useEffect(() => {
    if (!activeScanItem) return;
    const frame = requestAnimationFrame(() => {
      barcodeInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [activeScanItem]);

  // branchResolved: true once we've either confirmed no default branch exists, or the filter has been set
  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  // Load suppliers for filter and form
  useEffect(() => {
    const loadSuppliers = async () => {
      try {
        const data = await suppliersApi.getAll();
        setSuppliers(data || []);
      } catch {
        // silently fail supplier load
      }
    };
    loadSuppliers();
  }, []);

  // Filter locations for the selected branch from the aggregated data
  const locations = useMemo(() => {
    if (!refData?.locations || !formData.branch_code) return [];
    return (refData.locations as Location[]).filter(
      (loc) => loc.branch_code === formData.branch_code
    );
  }, [refData?.locations, formData.branch_code]);

  // Get all branches from reference data
  const branchesData = useMemo(() => {
    return { items: filteredBranches || [] };
  }, [filteredBranches]);

  const handleNewGRN = useCallback(() => {
    handleNewGRNBase();
    setFormData(prev => ({
      ...prev,
      good_received_no: "",
      good_received_date: todayLocal(),
      branch_code: defaultBranchCode || prev.branch_code,
    }));
    setLineItems([]);
    setFormStep(0);
    setTouched({}); // Reset validation state
  }, [handleNewGRNBase, setFormData, defaultBranchCode]);

  // "Create GRN" shortcut from PurchaseOrdersPage's detail view lands here
  // as /purchasing/grn?poId=123 — jump straight into creation mode with
  // that PO queued up; handlePOChange (below) picks it up once the
  // purchaseOrders list has loaded.
  useEffect(() => {
    const poIdParam = searchParams.get("poId");
    if (!poIdParam) return;
    const poId = Number(poIdParam);
    if (Number.isFinite(poId) && poId > 0) {
      pendingPoIdFromUrl.current = poId;
      handleNewGRN();
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("poId");
        return next;
      },
      { replace: true }
    );
    // Only ever consume ?poId= once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load GRN items when selecting a GRN
  const loadGRNItems = useCallback(async (grnId: number) => {
    setLoadingItems(true);
    try {
      const items = await goodReceivedItemsApi.getByGRN(grnId);
      setLineItems(items.map((item: GoodReceivedItem) => ({
        ...item,
        _id: `existing-${item.id}`,
        barcode: item.barcode ?? "",
        batch_no: item.batch_no ?? undefined,
        expiry_date: item.expiry_date ?? undefined,
        tracking_type: (item.batch_no ? "batch" : item.barcode ? "serial" : "none") as TrackingType,
        // Map API response to local state
        saveToSalesStock: item.saved_to_sales_stock || false,
        saveToCompanyAssets: item.saved_to_company_assets || false,
      })));
    } catch {
      setLineItems([]);
    } finally {
      setLoadingItems(false);
    }
  }, []);

  // View mode: PO lines, products and every receipt on the PO, so each GRN line
  // can show ordered / to-receive / remaining quantities and its cost.
  const viewPoId = selectedGRN && !isCreating ? selectedGRN.purchasingorders_id : 0;
  const { data: viewPO } = useQuery({
    queryKey: ["grn-view-po", viewPoId],
    queryFn: () => purchaseOrdersApi.getById(viewPoId),
    enabled: viewPoId > 0,
  });
  const { data: viewPOReceipts = [] } = useQuery({
    queryKey: ["grn-view-po-receipts", viewPoId, selectedGRN?.status],
    queryFn: () => goodReceivedItemsApi.getByPO(viewPoId),
    enabled: viewPoId > 0,
  });
  const { data: viewProducts = [] } = useQuery({
    queryKey: ["grn-view-products"],
    queryFn: () => productsApi.getAll(0, 1000, true),
    enabled: viewPoId > 0,
    staleTime: 5 * 60 * 1000,
  });

  // View mode: one row per PO line received on this GRN.
  const viewLines = useMemo(() => {
    if (!lineItems.length || isCreating) return [];

    const poItems = new Map<number, PurchasingOrderItem>(
      ((viewPO as PurchasingOrderWithItems | undefined)?.items ?? []).map((i: PurchasingOrderItem) => [i.id, i])
    );
    const receivedByLine = new Map<number, number>();
    viewPOReceipts.forEach((r: GoodReceivedItem) => {
      if (r.active) {
        receivedByLine.set(
          r.purchasing_order_items_id,
          (receivedByLine.get(r.purchasing_order_items_id) ?? 0) + (r.quantity ?? 1)
        );
      }
    });

    const rows = new Map<number, {
      key: number;
      product_id?: number;
      item_code: string;
      item_name: string;
      description: string;
      unit_price: number;
      ordered: number | null;
      toReceive: number;
      remaining: number | null;
      uom: string;
      expiry: string[];
      refs: string[];
    }>();

    lineItems.forEach((item) => {
      const lineId = item.purchasing_order_items_id;
      const poItem = poItems.get(lineId);
      const product = (viewProducts as Product[]).find((p) => p.id === (item.product_id ?? poItem?.product_id));
      let row = rows.get(lineId);
      if (!row) {
        const ordered = poItem ? poItem.quantity : null;
        row = {
          key: lineId,
          product_id: item.product_id ?? poItem?.product_id,
          item_code: product?.item_code ?? "",
          item_name: item.product_name || product?.name || `PO Item #${lineId}`,
          description: product?.description ?? "",
          unit_price: poItem?.unit_price ?? 0,
          ordered,
          toReceive: 0,
          remaining: ordered === null ? null : Math.max(ordered - (receivedByLine.get(lineId) ?? 0), 0),
          uom: product?.unit_of_measure ?? "",
          expiry: [],
          refs: [],
        };
        rows.set(lineId, row);
      }
      row.toReceive += item.quantity ?? 1;
      if (item.expiry_date && !row.expiry.includes(item.expiry_date)) row.expiry.push(item.expiry_date);
      const ref = item.barcode || (item.batch_no ? `Batch ${item.batch_no}` : "");
      if (ref) row.refs.push(ref);
    });

    return Array.from(rows.values()).sort((a, b) => a.item_name.localeCompare(b.item_name));
  }, [lineItems, isCreating, viewPO, viewPOReceipts, viewProducts]);

  // Full cost of this GRN = sum of (received qty x PO unit price)
  const viewTotalCost = useMemo(
    () => viewLines.reduce((sum, r) => sum + r.toReceive * r.unit_price, 0),
    [viewLines]
  );

  // handleStartEdit removed - GRNs are not editable after creation

  // Cancelling out of "New GRN" should return to the browse table, not
  // auto-open the first GRN the way useMasterDetailState's generic
  // handleCancel does (that behavior made sense for the old always-visible
  // detail panel, but not here). Cancelling out of editing an existing GRN
  // still just reverts its form via the generic handler.
  const handleCancel = useCallback((items: GoodReceivedNote[]) => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedGRN(null);
    } else {
      handleCancelBase(items);
    }
    setLineItems([]);
    setFormStep(0);
    setTouched({}); // Reset validation state
  }, [isCreating, handleCancelBase, setIsCreating, setIsEditing, setSelectedGRN]);

  // Returns to the browse table from the detail view (the "Back to Good
  // Received Notes" link above the detail panel header).
  const handleBackToGRNs = useCallback(() => {
    setSelectedGRN(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
    setLineItems([]);
    setFormStep(0);
    setTouched({});
  }, [isCreating, setSelectedGRN, setIsCreating, setIsEditing]);

  // Handler that wraps hook's handler (which already handles unsaved changes confirm)
  const handleSelectGRNWithItems = useCallback(async (grn: GoodReceivedNote) => {
    const selected = await handleSelectGRN(grn);
    if (!selected) return; // User cancelled

    // Load detailed items after selection
    setTouched({});
    loadGRNItems(grn.id);
  }, [handleSelectGRN, loadGRNItems]);

  const { data: grns, isLoading, refetch } = useQuery({
    queryKey: ["goodReceivedNotes"],
    queryFn: () => goodReceivedNotesApi.getAll(),
    enabled: branchResolved,
  });

  const nextGRNNumber = useMemo(() => 
    getNextNumber('GRN', (grns || []).map((g: GoodReceivedNote) => ({ no: g.good_received_no })), formData.branch_code), 
  [grns, formData.branch_code]);

  const { data: purchaseOrders } = useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: () => purchaseOrdersApi.getAll(),
    enabled: isCreating || !!filterPOId || !!filterCreatedByUser || !!selectedGRN,
  });

  // Separate query for PO dropdown in GRN creation — only approved/partially_completed (not fully received)
  const { data: grnEligiblePOs } = useQuery({
    queryKey: ["purchaseOrders", "for_grn"],
    queryFn: () => purchaseOrdersApi.getAll({ for_grn: true, limit: 1000 }),
  });

  const purchaseOrderMap = useMemo(() => {
    const map = new Map<number, PurchasingOrder>();
    (purchaseOrders || []).forEach((po: PurchasingOrder) => map.set(po.id, po));
    return map;
  }, [purchaseOrders]);

  const poFilterOptions = useMemo(() => {
    if (!grns) return [];
    // Derive PO options from GRN enriched fields
    const poMap = new Map<number, POFilterOption>();
    grns.forEach((grn) => {
      if (grn.po_no && grn.purchasingorders_id) {
        poMap.set(grn.purchasingorders_id, { id: grn.purchasingorders_id, purchasing_order_no: grn.po_no });
      }
    });
    return Array.from(poMap.values()).sort((a, b) =>
      a.purchasing_order_no.localeCompare(b.purchasing_order_no)
    );
  }, [grns]);

  const createdByUserOptions = useMemo(() => {
    if (!grns) return [];

    const users = new Set<string>();
    grns.forEach((grn) => {
      const po = purchaseOrderMap.get(grn.purchasingorders_id);
      const creatorName = po?.created_by_name?.trim();
      if (creatorName) {
        users.add(creatorName);
      }
    });

    return Array.from(users).sort((a, b) => a.localeCompare(b));
  }, [grns, purchaseOrderMap]);

  const filteredGRNs = useMemo(() => {
    if (!grns) return [];

    let filtered = grns.filter(
      (grn) => {
        const grnMatch = grn.good_received_no?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          String(grn.id).includes(searchQuery);

        // Also search by PO number (from enriched field or map fallback)
        const poNumber = grn.po_no || purchaseOrderMap.get(grn.purchasingorders_id)?.purchasing_order_no || "";
        const poMatch = poNumber.toLowerCase().includes(searchQuery.toLowerCase());

        return grnMatch || poMatch;
      }
    );

    // Apply branch filter
    if (filterBranch) {
      filtered = filtered.filter(grn => grn.branch_code === filterBranch);
    }

    // Apply supplier filter
    if (filterSupplier) {
      const supplierName = suppliers.find(s => s.id === filterSupplier)?.company_name;
      if (supplierName) {
        filtered = filtered.filter(grn => grn.supplier_name === supplierName);
      }
    }

    // Apply PO filter
    if (filterPOId) {
      filtered = filtered.filter((grn) => grn.purchasingorders_id === filterPOId);
    }

    // Apply creator filter (based on PO created_by_name)
    if (filterCreatedByUser) {
      filtered = filtered.filter((grn) => {
        const po = purchaseOrderMap.get(grn.purchasingorders_id);
        return (po?.created_by_name || "").trim() === filterCreatedByUser;
      });
    }

    // Default order before the user sorts a column in the table itself (the
    // table's own column-header sort takes over from there) — newest
    // received date first, same field the old sort-by menu defaulted to.
    filtered.sort((a, b) => {
      const diff = new Date(b.good_received_date || "").getTime() - new Date(a.good_received_date || "").getTime();
      return diff !== 0 ? diff : (b.id || 0) - (a.id || 0);
    });

    return filtered;
  }, [
    grns,
    searchQuery,
    filterBranch,
    filterSupplier,
    filterPOId,
    filterCreatedByUser,
    purchaseOrders,
    purchaseOrderMap,
  ]);

  const createMutation = useCrudMutation({
    mutationFn: async ({ data, allowCreditOverride = false }: { data: GoodReceivedNoteCreate; allowCreditOverride?: boolean }) => {
      // Check for any items still being validated (Checking... state)
      const itemsStillChecking = lineItems.filter(item => item.barcodeError === "Checking...");
      if (itemsStillChecking.length > 0) {
        throw new Error("Please wait - some barcodes are still being validated");
      }

      // Check for any barcode errors before saving (excluding "Checking..." which we already handled)
      const itemsWithErrors = lineItems.filter(item => item.barcodeError && item.barcodeError !== "Checking...");
      if (itemsWithErrors.length > 0) {
        const errorDetails = itemsWithErrors.map(i => `${i.barcode}: ${i.barcodeError}`).join("; ");
        throw new Error(`Cannot save: ${itemsWithErrors.length} item(s) have barcode errors - ${errorDetails}`);
      }

      // Serial units need a barcode; batch/none lots need a qty (+ batch no).
      const itemsToSave = lineItems.filter(item => (isLotItem(item) ? isLotReady(item) : !!item.barcode));
      const rejectedEntries = Object.entries(rejections).filter(([, r]) => Math.floor(Number(r.qty)) > 0);

      if (itemsToSave.length === 0 && rejectedEntries.length === 0) {
        throw new Error("Nothing to save. Scan barcodes for serial items, enter quantity / batch details for lots, or record a rejected quantity.");
      }
      const incompleteLots = lineItems.filter(item => isLotItem(item) && !isLotReady(item) && item.tracking_type === "batch" && (item.quantity ?? 0) >= 1);
      if (incompleteLots.length > 0) {
        throw new Error(`Enter a batch number for: ${incompleteLots.map(i => i.product_name).join(", ")}`);
      }
      if (rejectedEntries.some(([, r]) => r.reason.trim().length < 3)) {
        throw new Error("Enter a reason for every rejected quantity.");
      }

      // One receipt, one transaction: the server validates every line (barcodes, batch, quantities,
      // over-receipt) and saves header + items + stock + rejections together, or nothing at all.
      const byPoItem = new Map<number, GRNReceiveLine>();
      const lineFor = (poItemId: number) => {
        let line = byPoItem.get(poItemId);
        if (!line) {
          line = { purchasing_order_items_id: poItemId };
          byPoItem.set(poItemId, line);
        }
        return line;
      };
      for (const item of itemsToSave) {
        const line = lineFor(item.purchasing_order_items_id);
        if (isLotItem(item)) {
          line.quantity = (line.quantity ?? 0) + (item.quantity ?? 0);
          if (item.tracking_type === "batch") {
            line.batch_no = item.batch_no?.trim();
            line.expiry_date = item.expiry_date || undefined;
          }
          line.warranty_month = item.warranty_month || undefined;
        } else {
          line.units = [...(line.units ?? []), { barcode: item.barcode, warranty_month: item.warranty_month || undefined }];
        }
      }
      for (const [poItemId, rej] of rejectedEntries) {
        const line = lineFor(Number(poItemId));
        line.rejected_quantity = Math.floor(Number(rej.qty));
        line.rejection_reason = rej.reason.trim();
      }

      const result = await goodReceivedNotesApi.receive({ ...data, lines: [...byPoItem.values()] }, allowCreditOverride);
      return { grn: result.grn, grnItemCount: result.units_received, rejectedCount: result.units_rejected };
    },
    invalidateQueryKeys: [["goodReceivedNotes"], ["purchaseOrders"], ["purchase-orders"]],
    errorMessage: "Failed to create GRN",
    showSuccess: false,
    showError: false,
    onSuccess: async ({ grn: newGRN, grnItemCount, rejectedCount }) => {
      const messages = [`${grnItemCount} units received into Sales Stock`];
      if (rejectedCount > 0) messages.push(`${rejectedCount} rejected`);
      showSuccessToast(`GRN created successfully! ${messages.join(", ")}`);
      setRejections({});
      setIsCreating(false);
      setIsEditing(false);
      setLineItems([]);
      setProductGroups([]);
      setCreditLimitDialog({ open: false, errorMessage: "", pendingData: null });

      // Wait for refetch to complete
      await refetch();

      // Select the newly created GRN to show it
      setTimeout(async () => {
        try {
          const refreshedGRNs = await goodReceivedNotesApi.getById(newGRN.id);
          handleSelectGRNWithItems(refreshedGRNs);
        } catch {
          // silently fail loading new GRN details
        }
      }, 100);
    },
    onError: (error: unknown, variables) => {
      const errorDetail = handleApiError(error, "Failed to create GRN");

      // Check if this is a credit limit error
      if (errorDetail.includes("Cannot post GRN:") && errorDetail.includes("Credit limit")) {
        // Show credit limit dialog for authorized users to override
        setCreditLimitDialog({
          open: true,
          errorMessage: errorDetail,
          pendingData: variables.data,
        });
      } else {
        showErrorToast(errorDetail);
      }
    },
  });

  // updateMutation removed - GRNs are not editable after creation
  // const updateMutation = useMutation({
  //   mutationFn: ({ id, data }: { id: number; data: Partial<GoodReceivedNoteCreate> }) =>
  //     goodReceivedNotesApi.update(id, data),
  //   onSuccess: () => {
  //     queryClient.invalidateQueries({ queryKey: ["goodReceivedNotes"] });
  //     toast.success("GRN updated successfully");
  //     setIsEditing(false);
  //   },
  //   onError: (error: any) => {
  //     toast.error(error.response?.data?.detail || "Failed to update GRN");
  //   },
  // });

  const handleAddLineItem = () => {
    const newItem: GRNLineItem = {
      _id: `new-${Date.now()}`,
      good_received_note: formData.good_received_no,
      barcode: "",
      tracking_type: "serial",
      branch_code: formData.branch_code,
      active: true,
      purchasing_order_items_id: 0,
      saveToSalesStock: defaultSaveToSalesStock,
      saveToCompanyAssets: defaultSaveToCompanyAssets,
      scanned: false,
    };
    setLineItems([...lineItems, newItem]);
  };

  const handleRemoveLineItem = (id: string) => {
    setLineItems(lineItems.filter(item => item._id !== id));
  };

  const handleUpdateLineItem = (id: string, field: keyof GRNLineItem, value: any) => {
    setLineItems(lineItems.map(item =>
      item._id === id ? { ...item, [field]: value } : item
    ));
  };

  // Blocks a second Save (or override) click before the first create has settled.
  const savingRef = useRef(false);

  const handleSave = useCallback((allowCreditOverride = false) => {
    if (savingRef.current) return;
    if (isCreating) {
      savingRef.current = true;
      createMutation.mutate({ data: formData, allowCreditOverride }, { onSettled: () => { savingRef.current = false; } });
    }
    // Update removed - GRNs are not editable after creation
  }, [isCreating, formData, createMutation]);

  // Button click handler that calls handleSave with default parameters
  const handleSaveClick = useCallback(() => {
    handleSave(false);
  }, [handleSave]);

  // Handle credit limit override confirmation
  const handleCreditOverrideConfirm = useCallback(() => {
    if (creditLimitDialog.pendingData && !savingRef.current) {
      savingRef.current = true;
      createMutation.mutate(
        { data: creditLimitDialog.pendingData, allowCreditOverride: true },
        { onSettled: () => { savingRef.current = false; } }
      );
    }
  }, [creditLimitDialog.pendingData, createMutation]);

  const handleCreditDialogClose = useCallback(() => {
    setCreditLimitDialog({ open: false, errorMessage: "", pendingData: null });
  }, []);

  const getOrderNumber = (grn: GoodReceivedNote) => {
    if (grn.po_no) return grn.po_no;
    const order = purchaseOrders?.find((o: PurchasingOrder) => o.id === grn.purchasingorders_id);
    return order ? order.purchasing_order_no : "Unknown";
  };

  const getLocationName = (locationId: number) => {
    const location = locations?.find((l: Location) => l.id === locationId);
    return location ? location.name : `Location ${locationId}`;
  };

  const getSupplierName = useCallback((poId: number) => {
    const po = purchaseOrders?.find((o: PurchasingOrder) => o.id === poId);
    if (!po) return "N/A";
    const supplier = suppliers.find(s => s.id === po.first_suppliers_id);
    return supplier ? supplier.company_name : "Unknown Supplier";
  }, [purchaseOrders, suppliers]);

  const getBranchDisplay = (branchCode: string) => {
    const branch = branchesData?.items?.find((b) => b.branch_code === branchCode);
    return branch ? `${branch.branch_code} - ${branch.branch_name}` : branchCode;
  };

  // Serial products: add one more unit line while the over-receipt tolerance allows it.
  const handleAddExtraUnit = (productId: number) => {
    const first = lineItems.find((i) => i.product_id === productId && !isLotItem(i));
    if (!first) return;
    const extra: GRNLineItem = {
      ...first,
      _id: `po-${first.purchasing_order_items_id}-x${Date.now()}`,
      barcode: "",
      scanned: false,
      barcodeError: undefined,
    };
    setLineItems((prev) => [...prev, extra]);
    setProductGroups((groups) =>
      groups.map((g) => (g.product_id === productId ? { ...g, items: [...g.items, extra], total_quantity: g.total_quantity + 1 } : g))
    );
  };

  const handleCancelGRN = async (reason: string) => {
    if (!selectedGRN) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      const cancelled = await goodReceivedNotesApi.cancel(selectedGRN.id, reason);
      showSuccessToast(`${cancelled.good_received_no} cancelled`);
      setCancelOpen(false);
      queryClient.invalidateQueries({ queryKey: ["goodReceivedNotes"] });
      queryClient.invalidateQueries({ queryKey: ["purchaseOrders"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["salesStock"] });
      await refetch();
      handleSelectGRNWithItems(cancelled);
    } catch (error) {
      setCancelError(handleApiError(error, "Could not cancel this GRN"));
    } finally {
      setCancelBusy(false);
    }
  };

  const { data: grnRejections = [] } = useQuery({
    queryKey: ["grn-rejections", selectedGRN?.id],
    queryFn: () => goodReceivedNotesApi.getRejections(selectedGRN!.id),
    enabled: !!selectedGRN && !isCreating,
  });

  const createTotalCost = useMemo(
    () => productGroups.reduce((sum, g) => sum + g.total_quantity * g.unit_price, 0),
    [productGroups]
  );
  const handlePOChange = async (poId: number) => {
    const selectedPO = purchaseOrders?.find((o: PurchasingOrder) => o.id === poId);
    if (selectedPO) {
      // Fetch locations for the PO's branch to auto-select the first one
      let selectedLocationId = formData.good_received_locations_id;
      try {
        const branchLocations = await locationsApi.getAll(selectedPO.branch_code);
        if (branchLocations && branchLocations.length > 0) {
          selectedLocationId = branchLocations[0].id;
        }
      } catch {
        // silently fail branch locations fetch
      }

      setFormData({
        ...formData,
        purchasingorders_id: poId,
        branch_code: selectedPO.branch_code,
        good_received_date: todayLocal(),
        good_received_locations_id: selectedLocationId,
      });

      // Load PO items when PO is selected
      setRejections({});
      if (poId > 0 && isCreating) {
        setLoadingPOItems(true);
        try {
          // Fetch PO with items
          const poWithItems: PurchasingOrderWithItems = await purchaseOrdersApi.getById(poId);

          // Fetch all products to get names
          const allProducts = await productsApi.getAll(0, 1000, true);
          setProducts(allProducts);

          // For partially completed POs, fetch already received items to exclude them
          const receivedCountMap = new Map<number, number>(); // po_item_id -> count of received items

          if (selectedPO.status === "partially_completed") {
            try {
              // Get all GRN items for this PO
              const receivedItems = await goodReceivedItemsApi.getByPO(poId);

              // Count how many items have been received for each PO item
              receivedItems.forEach((grnItem) => {
                if (grnItem.purchasing_order_items_id && grnItem.active) {
                  const count = receivedCountMap.get(grnItem.purchasing_order_items_id) || 0;
                  receivedCountMap.set(grnItem.purchasing_order_items_id, count + (grnItem.quantity ?? 1));
                }
              });
            } catch {
              // Continue with all items if we can't fetch received items
            }
          }

          // Create line items from PO items - one for each quantity (excluding received items)
          const newLineItems: GRNLineItem[] = [];
          const caps: Record<number, number> = {};
          const meta: Record<number, { ordered: number; received: number; item_code: string; description: string; uom: string }> = {};
          poWithItems.items?.forEach((poItem: PurchasingOrderItem) => {
            const product = allProducts.find((p: Product) => p.id === poItem.product_id);
            const receivedCount = receivedCountMap.get(poItem.id) || 0;
            const remainingQty = poItem.quantity - receivedCount;
            const overPct = Number((product as Product | undefined)?.over_receipt_tolerance_pct ?? 0);
            const receivableCap = Math.max(Math.floor(poItem.quantity * (1 + overPct / 100)) - receivedCount, 0);
            caps[poItem.id] = receivableCap;
            meta[poItem.id] = {
              ordered: poItem.quantity,
              received: receivedCount,
              item_code: product?.item_code ?? "",
              description: product?.description ?? "",
              uom: product?.unit_of_measure ?? "",
            };

            const trackingType = ((product as Product | undefined)?.tracking_type ?? "serial") as TrackingType;

            // Batch/none products: ONE lot line for the whole remaining qty.
            if (trackingType !== "serial") {
              if (remainingQty > 0) {
                newLineItems.push({
                  _id: `po-${poItem.id}-lot`,
                  good_received_note: formData.good_received_no,
                  barcode: "",
                  tracking_type: trackingType,
                  quantity: remainingQty,
                  max_quantity: receivableCap,
                  batch_no: "",
                  branch_code: selectedPO.branch_code,
                  active: true,
                  purchasing_order_items_id: poItem.id,
                  product_id: poItem.product_id,
                  product_name: product?.name || `Product ${poItem.product_id}`,
                  unit_price: poItem.unit_price,
                  po_item_id: poItem.id,
                  warranty_month: poItem.warrenty_month || "",
                  // "none" lots need nothing more; batch lots need a batch no.
                  scanned: trackingType === "none",
                  saveToSalesStock: defaultSaveToSalesStock,
                  saveToCompanyAssets: false, // company assets are serial-only
                });
              }
              return;
            }

            // Only create line items for unreceived quantities
            for (let i = 0; i < remainingQty; i++) {
              newLineItems.push({
                _id: `po-${poItem.id}-${i}`,
                good_received_note: formData.good_received_no,
                barcode: "",
                tracking_type: "serial",
                branch_code: selectedPO.branch_code,
                active: true,
                purchasing_order_items_id: poItem.id,
                product_id: poItem.product_id,
                product_name: product?.name || `Product ${poItem.product_id}`,
                unit_price: poItem.unit_price,
                po_item_id: poItem.id,
                warranty_month: poItem.warrenty_month || "",  // Get warranty from PO item
                scanned: false,
                saveToSalesStock: defaultSaveToSalesStock,
                saveToCompanyAssets: defaultSaveToCompanyAssets,
              });
            }
          });

          setReceiptCaps(caps);
          setLineMeta(meta);
          setLineItems(newLineItems);

          // Group items by product for display
          updateProductGroups(newLineItems, allProducts);
        } catch {
          showErrorToast("Failed to load purchase order items");
        } finally {
          setLoadingPOItems(false);
        }
      }
    } else {
      setFormData({ ...formData, purchasingorders_id: poId });
    }
  };

  // Consumes the pending ?poId= from the "Create GRN" shortcut once the
  // purchaseOrders list (enabled by handleNewGRN switching isCreating on)
  // has actually loaded, so handlePOChange can find the PO by id.
  useEffect(() => {
    if (pendingPoIdFromUrl.current && purchaseOrders && purchaseOrders.length > 0) {
      const poId = pendingPoIdFromUrl.current;
      pendingPoIdFromUrl.current = null;
      handlePOChange(poId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseOrders]);

  // Function to update product groups from line items
  const updateProductGroups = useCallback((items: GRNLineItem[], productList: Product[]) => {
    const groupMap = new Map<number, ProductGroup>();

    items.forEach((item) => {
      const productId = item.product_id || 0;
      if (groupMap.has(productId)) {
        const group = groupMap.get(productId)!;
        group.items.push(item);
        group.total_quantity += lineUnits(item);
      } else {
        const product = productList.find((p: Product) => p.id === productId);
        groupMap.set(productId, {
          product_id: productId,
          product_name: item.product_name || product?.name || `Product ${productId}`,
          unit_price: item.unit_price || 0,
          total_quantity: lineUnits(item),
          items: [item],
          // Quantity-only items need nothing but a qty, which the grid row carries.
          expanded: (item.tracking_type ?? "serial") !== "none",
        });
      }
    });

    setProductGroups(Array.from(groupMap.values()));
  }, []);

  // Toggle product group expansion
  const toggleProductGroup = (productId: number) => {
    setProductGroups(groups =>
      groups.map(g =>
        g.product_id === productId ? { ...g, expanded: !g.expanded } : g
      )
    );
  };

  // Edit a batch/none lot line (qty / batch no / expiry). `scanned` doubles as
  // "ready to save" so the existing progress + save gating keep working.
  const handleLotChange = (itemId: string, patch: Partial<GRNLineItem>) => {
    const apply = (item: GRNLineItem): GRNLineItem => {
      if (item._id !== itemId) return item;
      const next = { ...item, ...patch };
      return { ...next, scanned: isLotReady(next) };
    };
    setLineItems(items => items.map(apply));
    setProductGroups(groups =>
      groups.map(g => {
        const items = g.items.map(apply);
        return { ...g, items, total_quantity: items.reduce((n, i) => n + lineUnits(i), 0) };
      })
    );
  };

  // Validate barcode against database - extracted for reuse
  const validateBarcodeInDatabase = async (itemId: string, barcode: string) => {
    try {
      // Check good_received_items first (GRN items table)
      const grnItemsResult = await goodReceivedItemsApi.checkBarcodeExists(barcode);
      if (grnItemsResult.exists) {
        setLineItems(items =>
          items.map(item =>
            item._id === itemId
              ? { ...item, barcodeError: "Barcode already exists in GRN Items" }
              : item
          )
        );
        setProductGroups(groups =>
          groups.map(g => ({
            ...g,
            items: g.items.map(item =>
              item._id === itemId
                ? { ...item, barcodeError: "Barcode already exists in GRN Items" }
                : item
            ),
          }))
        );
        return;
      }

      // Check sales_stock
      const salesResult = await salesStockApi.checkBarcodeExists(barcode);
      if (salesResult.exists) {
        setLineItems(items =>
          items.map(item =>
            item._id === itemId
              ? { ...item, barcodeError: "Barcode already exists in Sales Stock" }
              : item
          )
        );
        setProductGroups(groups =>
          groups.map(g => ({
            ...g,
            items: g.items.map(item =>
              item._id === itemId
                ? { ...item, barcodeError: "Barcode already exists in Sales Stock" }
                : item
            ),
          }))
        );
        return;
      }

      // Check company_assets
      const assetsResult = await companyAssetsApi.checkBarcodeExists(barcode);
      if (assetsResult.exists) {
        setLineItems(items =>
          items.map(item =>
            item._id === itemId
              ? { ...item, barcodeError: "Barcode already exists in Company Assets" }
              : item
          )
        );
        setProductGroups(groups =>
          groups.map(g => ({
            ...g,
            items: g.items.map(item =>
              item._id === itemId
                ? { ...item, barcodeError: "Barcode already exists in Company Assets" }
                : item
            ),
          }))
        );
        return;
      }

      // If no duplicates found, clear the error
      setLineItems(items =>
        items.map(item =>
          item._id === itemId
            ? { ...item, barcodeError: undefined }
            : item
        )
      );
      setProductGroups(groups =>
        groups.map(g => ({
          ...g,
          items: g.items.map(item =>
            item._id === itemId
              ? { ...item, barcodeError: undefined }
              : item
          ),
        }))
      );
    } catch {
      // On error, mark the barcode with an error
      setLineItems(items =>
        items.map(item =>
          item._id === itemId
            ? { ...item, barcodeError: "Failed to verify barcode - please try again" }
            : item
        )
      );
      setProductGroups(groups =>
        groups.map(g => ({
          ...g,
          items: g.items.map(item =>
            item._id === itemId
              ? { ...item, barcodeError: "Failed to verify barcode - please try again" }
              : item
          ),
        }))
      );
    }
  };

  // Handle barcode scan for an item - with debounced validation
  const handleBarcodeChange = (itemId: string, barcode: string) => {
    // Cancel any pending validation for this item
    const existingTimer = barcodeValidationTimers.current.get(itemId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // If barcode is empty, just clear it
    if (!barcode) {
      setLineItems(items =>
        items.map(item =>
          item._id === itemId
            ? { ...item, barcode: "", scanned: false, barcodeError: undefined }
            : item
        )
      );
      setProductGroups(groups =>
        groups.map(g => ({
          ...g,
          items: g.items.map(item =>
            item._id === itemId
              ? { ...item, barcode: "", scanned: false, barcodeError: undefined }
              : item
          ),
        }))
      );
      return;
    }

    // Update barcode value immediately
    setLineItems(items =>
      items.map(item =>
        item._id === itemId
          ? { ...item, barcode, scanned: true, barcodeError: undefined }
          : item
      )
    );
    setProductGroups(groups =>
      groups.map(g => ({
        ...g,
        items: g.items.map(item =>
          item._id === itemId
            ? { ...item, barcode, scanned: true, barcodeError: undefined }
            : item
        ),
      }))
    );

    // Check for duplicates in current line items FIRST (instant check)
    const duplicateInList = lineItems.find(item => item._id !== itemId && item.barcode === barcode);
    if (duplicateInList) {
      setLineItems(items =>
        items.map(item =>
          item._id === itemId
            ? { ...item, barcodeError: "Duplicate barcode in current list" }
            : item
        )
      );
      setProductGroups(groups =>
        groups.map(g => ({
          ...g,
          items: g.items.map(item =>
            item._id === itemId
              ? { ...item, barcodeError: "Duplicate barcode in current list" }
              : item
          ),
        }))
      );
      return;
    }

    // Set checking state
    setLineItems(items =>
      items.map(item =>
        item._id === itemId
          ? { ...item, barcodeError: "Checking..." }
          : item
      )
    );
    setProductGroups(groups =>
      groups.map(g => ({
        ...g,
        items: g.items.map(item =>
          item._id === itemId
            ? { ...item, barcodeError: "Checking..." }
            : item
        ),
      }))
    );

    // Debounce the database validation (500ms delay)
    const timer = setTimeout(() => {
      validateBarcodeInDatabase(itemId, barcode);
      barcodeValidationTimers.current.delete(itemId);
    }, 500);

    barcodeValidationTimers.current.set(itemId, timer);
  };

  // Handle immediate validation on blur or enter
  const handleBarcodeBlur = (itemId: string, barcode: string) => {
    if (!barcode) return;

    // Cancel debounced validation
    const existingTimer = barcodeValidationTimers.current.get(itemId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      barcodeValidationTimers.current.delete(itemId);
    }

    // Validate immediately
    validateBarcodeInDatabase(itemId, barcode);
  };

  // Handle warranty change for an item
  const handleWarrantyChange = (itemId: string, warranty: string) => {
    setLineItems(items =>
      items.map(item =>
        item._id === itemId ? { ...item, warranty_month: warranty } : item
      )
    );
    setProductGroups(groups =>
      groups.map(g => ({
        ...g,
        items: g.items.map(item =>
          item._id === itemId ? { ...item, warranty_month: warranty } : item
        ),
      }))
    );
  };

  // Start scanning for a specific item
  const startScanning = (itemId: string) => {
    setActiveScanItem(itemId);
    // Focus is handled by the useEffect above that watches activeScanItem
  };

  // Complete scanning and move to next
  const completeScan = (itemId: string) => {
    const currentIndex = lineItems.findIndex(item => item._id === itemId);
    const nextUnscanned = lineItems.find((item, idx) => idx > currentIndex && !item.scanned);
    if (nextUnscanned) {
      startScanning(nextUnscanned._id);
    } else {
      setActiveScanItem(null);
    }
  };

  // Check if all items are scanned
  // Check if any items have barcode errors (excluding "Checking..." state)
  const hasBarcodeErrors = useMemo(() => {
    return lineItems.some(item => item.barcodeError && item.barcodeError !== "Checking...");
  }, [lineItems]);

  // Check if any items are still being validated
  const isValidatingBarcodes = useMemo(() => {
    return lineItems.some(item => item.barcodeError === "Checking...");
  }, [lineItems]);

  // Check if all scanned barcodes have been validated (no errors and not checking)
  const allBarcodesValidated = useMemo(() => {
    return lineItems.length > 0 &&
      lineItems.every(item => item.scanned) &&
      !lineItems.some(item => item.barcodeError);
  }, [lineItems]);

  // Count scanned items
  const totalUnits = useMemo(() => {
    return lineItems.reduce((n, item) => n + lineUnits(item), 0);
  }, [lineItems]);

  const poIdsWithGrn = useMemo(() => {
    const ids = new Set<number>();
    (grns || []).forEach((g) => {
      if (g.purchasingorders_id) ids.add(g.purchasingorders_id);
    });
    return ids;
  }, [grns]);

  const branches = branchesData?.items || [];

  // Validation error messages
  const getFieldError = (fieldName: string): string | undefined => {
    if (!touched[fieldName] && !isCreating) return undefined;

    switch (fieldName) {
      case 'good_received_no':
        break;
      case 'purchasingorders_id':
        if (!formData.purchasingorders_id || formData.purchasingorders_id === 0) return 'Purchase order is required';
        break;
      case 'good_received_date':
        if (!formData.good_received_date) return 'GRN date is required';
        break;
      case 'good_received_locations_id':
        if (!formData.good_received_locations_id || formData.good_received_locations_id === 0) return 'Location is required';
        break;
      case 'branch_code':
        if (!formData.branch_code) return 'Branch is required';
        break;
    }
    return undefined;
  };

  // Check if a field has an error (for styling)
  const hasError = (fieldName: string): boolean => {
    return !!getFieldError(fieldName);
  };

  // Step 1 validation: GRN Information, Supplier Invoice, Remarks
  // When creating, the GRN number is auto-generated (nextGRNNumber) and never written
  // into formData.good_received_no, so treat the preview number as valid instead.
  const effectiveGRNNumber = isCreating ? nextGRNNumber : formData.good_received_no;
  const isStep1Valid = effectiveGRNNumber &&
    formData.purchasingorders_id > 0;

  // Full form validation
  const isFormValid = isStep1Valid;

  const handleNextStep = useCallback(() => {
    if (formStep < FORM_STEPS.length - 1) {
      setFormStep(prev => prev + 1);
    }
  }, [formStep]);

  const handlePreviousStep = useCallback(() => {
    if (formStep > 0) {
      setFormStep(prev => prev - 1);
    }
  }, [formStep]);

  const isSaving = createMutation.isPending; // updateMutation removed - GRNs not editable

  // The table sorts by whichever column the user clicks; the PO/Supplier/
  // Branch columns display looked-up text rather than raw ids, so they need
  // that text as their own fields for the grid to sort on correctly.
  const grnRows: GRNRow[] = useMemo(
    () =>
      filteredGRNs.map((grn) => ({
        ...grn,
        po_display: grn.po_no || getOrderNumber(grn),
        supplier_display: grn.supplier_name || getSupplierName(grn.purchasingorders_id),
        branch_display: getBranchDisplay(grn.branch_code),
      })),
    [filteredGRNs, purchaseOrders, suppliers, branchesData] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const grnColumns: TDataGridColumn<GRNRow>[] = useMemo(
    () => [
      {
        field: "good_received_no",
        header: "GRN No",
        flex: 1,
        minWidth: 160,
        renderCell: (params: GridRenderCellParams<GRNRow>) => (
          <Typography variant="body2" fontWeight={600}>
            {params.row.good_received_no || `GRN-${params.row.id}`}
          </Typography>
        ),
      },
      { field: "po_display", header: "PO No", width: 150 },
      { field: "supplier_display", header: "Supplier", flex: 1, minWidth: 170 },
      { field: "branch_display", header: "Branch", width: 170 },
      { field: "delivery_note_no", header: "Delivery Note", width: 140, valueGetter: (_v: unknown, row: GRNRow) => row.delivery_note_no || "-" },
      { field: "units_received", header: "Units", width: 90, type: "number" },
      {
        field: "units_rejected",
        header: "Rejected",
        width: 100,
        type: "number",
        renderCell: (params: GridRenderCellParams<GRNRow>) =>
          (params.row.units_rejected ?? 0) > 0 ? (
            <span style={{ color: "#d32f2f", fontWeight: 600 }}>{params.row.units_rejected}</span>
          ) : (
            "-"
          ),
      },
      { field: "total_value", header: `Value (${currencySymbol})`, width: 130, type: "currency" },
      { field: "received_by", header: "Received By", width: 150, valueGetter: (_v: unknown, row: GRNRow) => row.received_by || row.created_by_name || "-" },
      {
        field: "good_received_date",
        header: "Received Date",
        width: 130,
        renderCell: (params: GridRenderCellParams<GRNRow>) =>
          params.row.good_received_date ? new Date(params.row.good_received_date).toLocaleDateString() : "-",
      },
      {
        field: "status",
        header: "Status",
        width: 110,
        align: "center",
        headerAlign: "center",
        sortable: false,
        renderCell: (params: GridRenderCellParams<GRNRow>) =>
          params.row.status === "cancelled" ? (
            <TChip label="Cancelled" size="small" color="error" sx={{ height: 20, fontSize: "0.65rem" }} />
          ) : (
            <TChip label="Received" size="small" color="success" sx={{ height: 20, fontSize: "0.65rem" }} />
          ),
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<GRNRow>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectGRNWithItems(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [handleSelectGRNWithItems, currencySymbol]
  );

  // Whether we're showing a single GRN's detail view (selected or being
  // created) instead of the browse table.
  const isGRNDetailMode = !!selectedGRN || isCreating;

  // Browse mode: a full-width table of every GRN (shown when nothing is
  // selected and nothing is being created). Sorting is done per-column via
  // the grid's own column header menu, not a separate "Sort by" control.
  const grnTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<GRNRow>
          rows={grnRows}
          columns={grnColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectGRNWithItems(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No GRNs found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Purchasing", href: "/purchasing" },
          { label: "Good Received Notes", href: "/purchasing/grn" },
          ...(selectedGRN || isCreating
            ? [{ label: isCreating ? "New GRN" : selectedGRN?.good_received_no || `GRN-${selectedGRN?.id}` }]
            : []),
        ]}
        title={selectedGRN ? (selectedGRN.good_received_no || `GRN-${selectedGRN.id}`) : ""}
        titleIcon={<ReceiptLongIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Good Received Note"
        noSelectionTitle="Select a GRN"
      />

      <ActionToolbar
        hasSelectedItem={!!selectedGRN}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={!!isFormValid}
        canCreate={canCreateGRN}
        onNew={handleNewGRN}
        onSave={isCreating && formStep < FORM_STEPS.length - 1 ? undefined : handleSaveClick}
        onCancel={() => handleCancel(filteredGRNs)}
        startActions={
          isCreating && formStep === 1 ? (
            <Button
              size="small"
              variant="outlined"
              onClick={handlePreviousStep}
              startIcon={<ArrowBackIcon />}
            >
              Back
            </Button>
          ) : undefined
        }
        // onEdit disabled - GRNs are not editable after creation
        // onEdit={handleStartEdit}
        endActions={
          isCreating && formStep === 0 ? (
            <Button
              size="small"
              variant="contained"
              onClick={() => continueOrReveal(!!isStep1Valid, handleNextStep)}
              endIcon={<ArrowForwardIcon />}
            >
              Next
            </Button>
          ) : selectedGRN && !isCreating && !isEditing ? (
            <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
              {canCancelGRN && selectedGRN.status !== "cancelled" && (
                <>
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    onClick={() => {
                      setCancelError(null);
                      setCancelOpen(true);
                    }}
                  >
                    Cancel GRN
                  </Button>
                  <Divider orientation="vertical" flexItem sx={{ mx: 2 }} />
                </>
              )}
              <Button
                size="small"
                variant="outlined"
                disabled={selectedGRN.status === "cancelled"}
                startIcon={<PaymentIcon />}
                onClick={() => {
                  const po = purchaseOrderMap.get(selectedGRN.purchasingorders_id);
                  navigate("/purchasing/invoices", {
                    state: {
                      supplier_id: po?.first_suppliers_id || 0,
                      branch_code: selectedGRN.branch_code,
                      grn_id: selectedGRN.id,
                    },
                  });
                }}
              >
                Make Payment
              </Button>
              <TPrintButton
                documentType="grn"
                documentId={selectedGRN.id}
                disabled={!canPrintDocument(selectedGRN.status, ["cancelled"])}
                disabledReason="Cannot print: only posted goods received notes can be printed"
                tooltip="Print GRN"
                onClick={() => handlePrint(selectedGRN.id)}
              />
            </Box>
          ) : undefined
        }
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedGRN && !isCreating ? (
          <EmptyState message="Select a GRN from the list or create a new one" />
        ) : (
          <>
            {/* Stepper for create mode only */}
            {isCreating && (
              <Stepper activeStep={formStep} sx={{ mb: 3 }}>
                {FORM_STEPS.map((label) => (
                  <Step key={label}>
                    <StepLabel>{label}</StepLabel>
                  </Step>
                ))}
              </Stepper>
            )}

            {/* Step 1: GRN Information, Supplier Invoice, Remarks (always show in view/edit mode) */}
            {(formStep === 0 || !isCreating) && (
              <>
                <FormSection title="GRN Information" columns={3}>
                  <TextField
                    label="GRN Number"
                    size="small"
                    value={isCreating ? nextGRNNumber : formData.good_received_no}
                    disabled
                  />
                  <Autocomplete
                    size="small"
                    options={(() => {
                      const eligible = grnEligiblePOs || [];
                      // Also include the currently selected PO (may already be completed if editing)
                      const currentPO = purchaseOrders?.find((o: PurchasingOrder) => o.id === formData.purchasingorders_id);
                      if (currentPO && !eligible.some((o: PurchasingOrder) => o.id === currentPO.id)) {
                        return [currentPO, ...eligible];
                      }
                      return eligible;
                    })()}
                    getOptionLabel={(option: PurchasingOrder) => option.purchasing_order_no || ""}
                    value={purchaseOrders?.find((o: PurchasingOrder) => o.id === formData.purchasingorders_id) || null}
                    onChange={(_, newValue) => {
                      handlePOChange(newValue?.id || 0);
                      handleBlur('purchasingorders_id');
                    }}
                    disabled={!isEditing && !isCreating}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Purchase Order (Approved / Partially Completed)"
                        required
                        error={hasError('purchasingorders_id')}
                        helperText={getFieldError('purchasingorders_id')}
                        InputProps={{
                          ...params.InputProps,
                          endAdornment: (
                            <>
                              <EntityPeekButton entity="purchase-order" id={formData.purchasingorders_id} />
                              {params.InputProps.endAdornment}
                            </>
                          ),
                        }}
                      />
                    )}
                    isOptionEqualToValue={(option, value) => option.id === value?.id}
                  />
                  <TextField
                    label="GRN Date"
                    size="small"
                    type="date"
                    value={formData.good_received_date}
                    disabled
                    InputLabelProps={{ shrink: true }}
                    helperText={isCreating ? "Today's date, set automatically" : undefined}
                  />
                  <TextField
                    label="Branch"
                    size="small"
                    value={getBranchDisplay(formData.branch_code)}
                    disabled
                    helperText="Auto-filled from Purchase Order"
                  />
                  <TextField
                    select
                    label="Location"
                    size="small"
                    value={formData.good_received_locations_id}
                    onChange={(e) => {
                      setFormData({ ...formData, good_received_locations_id: parseInt(e.target.value) || 1 });
                      handleBlur('good_received_locations_id');
                    }}
                    disabled={!isEditing && !isCreating}
                    required
                    error={hasError('good_received_locations_id')}
                    helperText={getFieldError('good_received_locations_id')}
                  >
                    {locations?.map((location: Location) => (
                      <MenuItem key={location.id} value={location.id}>
                        {location.name}
                      </MenuItem>
                    ))}
                    {(!locations || locations.length === 0) && (
                      <MenuItem value={1}>Default Location</MenuItem>
                    )}
                  </TextField>
                  <TextField
                    label="Supplier Name"
                    size="small"
                    value={getSupplierName(formData.purchasingorders_id)}
                    disabled
                    helperText="Auto-filled from Purchase Order"
                    InputProps={{
                      endAdornment: (
                        <EntityPeekButton
                          entity="supplier"
                          hideTabs={["payment"]}
                          id={purchaseOrders?.find((o: PurchasingOrder) => o.id === formData.purchasingorders_id)?.first_suppliers_id}
                        />
                      ),
                    }}
                  />
                  <TextField
                    label="Supplier Invoice No"
                    size="small"
                    value={formData.supplier_invoice_no || ""}
                    onChange={(e) => setFormData({ ...formData, supplier_invoice_no: e.target.value })}
                    disabled={!isEditing && !isCreating}
                    inputProps={{ maxLength: 200 }}
                    helperText={isCreating ? "Invoice number printed on the supplier's invoice (optional)" : undefined}
                  />
                  <TextField
                    label="Delivery Note No"
                    size="small"
                    value={formData.delivery_note_no || ""}
                    onChange={(e) => setFormData({ ...formData, delivery_note_no: e.target.value })}
                    disabled={!isEditing && !isCreating}
                    inputProps={{ maxLength: 200 }}
                    helperText={isCreating ? "Supplier's delivery note reference (optional)" : undefined}
                  />
                  <TextField
                    label="Vehicle No"
                    size="small"
                    value={formData.vehicle_no || ""}
                    onChange={(e) => setFormData({ ...formData, vehicle_no: e.target.value })}
                    disabled={!isEditing && !isCreating}
                    inputProps={{ maxLength: 50 }}
                  />
                  {/* Filled automatically with the user who saved the GRN, so it only shows once saved */}
                  {!isCreating && (
                    <TextField
                      label="Received By"
                      size="small"
                      value={formData.received_by || ""}
                      disabled
                    />
                  )}
                </FormSection>


              </>
            )}

            {/* Step 2: Received Items (always show in view/edit mode, step 2 in create mode) */}
            {(formStep === 1 || !isCreating) && (
              <>

                {/* Loading PO items indicator */}
                {loadingPOItems && (
                  <Box sx={{ mb: 2 }}>
                    <Alert severity="info" sx={{ mb: 1 }}>
                      Loading purchase order items...
                    </Alert>
                    <LinearProgress />
                  </Box>
                )}


                {!isCreating && selectedGRN?.status === "cancelled" && (
                  <Alert severity="error" sx={{ mt: 2 }}>
                    This GRN was cancelled{selectedGRN.cancelled_at ? ` on ${new Date(selectedGRN.cancelled_at).toLocaleDateString()}` : ""}:{" "}
                    {selectedGRN.cancel_reason || "no reason recorded"}. Its stock was withdrawn and the purchase order line reopened.
                  </Alert>
                )}
                {!isCreating && grnRejections.length > 0 && (
                  <Paper variant="outlined" sx={{ mt: 2, p: 1.5 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Rejected at receipt (not stocked)
                    </Typography>
                    {grnRejections.map((r) => (
                      <Typography key={r.id} variant="body2">
                        {r.product_name || `PO line ${r.purchasing_order_items_id}`}: {r.quantity} rejected, {r.reason}
                      </Typography>
                    ))}
                  </Paper>
                )}

                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1, mt: isCreating ? 0 : 2 }}>
                  <Typography variant="subtitle1" fontWeight="bold">
                    Received Items
                    {loadingItems && <CircularProgress size={16} sx={{ ml: 1 }} />}
                  </Typography>
                  {!isCreating && (isEditing || isCreating) && (
                    <IconButton size="small" onClick={handleAddLineItem} color="primary">
                      <AddIcon />
                    </IconButton>
                  )}
                </Box>

                {/* Products grouped by product ID - Nice card-based layout */}
                {isCreating && productGroups.length > 0 ? (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <Paper variant="outlined" sx={{ overflow: "auto", borderRadius: 3 }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow sx={modernTableStyles.headerRow}>
                            <TableCell sx={{ width: 36 }} />
                            <TableCell>Item Code</TableCell>
                            <TableCell>Item Name</TableCell>
                            <TableCell>Tracking</TableCell>
                            <TableCell>UOM</TableCell>
                            <TableCell>Currency</TableCell>
                            <TableCell align="right">{`Unit Price (${currencySymbol})`}</TableCell>
                            <TableCell align="right">Ordered</TableCell>
                            <TableCell align="right">Prev. Received</TableCell>
                            <TableCell align="right">Open</TableCell>
                            <TableCell align="right">To Receive</TableCell>
                            <TableCell align="right">Remaining</TableCell>
                            <TableCell>Expiry</TableCell>
                            <TableCell align="right">{`Line Cost (${currencySymbol})`}</TableCell>
                            <TableCell>Status</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                    {productGroups.map((group) => {
                      const first = group.items[0];
                      const meta = lineMeta[first?.purchasing_order_items_id];
                      const lot = isLotItem(first);
                      const open = meta ? Math.max(meta.ordered - meta.received, 0) : null;
                      const toReceive = group.total_quantity;
                      const readyUnits = group.items.filter((i) => i.scanned).reduce((n, i) => n + lineUnits(i), 0);
                      const isReady = group.items.every((i) => i.scanned);
                      const hasError = group.items.some((i) => i.barcodeError && i.barcodeError !== "Checking...");
                      const expiries = Array.from(new Set(group.items.map((i) => i.expiry_date).filter(Boolean)));
                      const trackingLabel = first?.tracking_type === "serial" ? "Serial" : first?.tracking_type === "batch" ? "Batch" : "Quantity";
                      return (
                      <Fragment key={group.product_id}>
                        <TableRow hover sx={{ "& > td": { borderBottom: group.expanded ? 0 : undefined } }}>
                          <TableCell sx={{ px: 0.5 }}>
                            <IconButton size="small" aria-label="Toggle details" onClick={() => toggleProductGroup(group.product_id)}>
                              {group.expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                            </IconButton>
                          </TableCell>
                          <TableCell>{meta?.item_code || "—"}</TableCell>
                          <TableCell>
                            <EntityLink entity="product" id={group.product_id}>
                              {group.product_name}
                            </EntityLink>
                            {meta?.description && (
                              <Typography variant="caption" color="text.secondary" display="block" noWrap sx={{ maxWidth: 240 }}>
                                {meta.description}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>
                            <TChip size="small" label={trackingLabel} color={first?.tracking_type === "serial" ? "primary" : first?.tracking_type === "batch" ? "secondary" : "default"} />
                          </TableCell>
                          <TableCell>{meta?.uom || "—"}</TableCell>
                          <TableCell>{currencySymbol}</TableCell>
                          <TableCell align="right">{fmtLKR(group.unit_price)}</TableCell>
                          <TableCell align="right">{meta?.ordered ?? "—"}</TableCell>
                          <TableCell align="right">{meta?.received ?? "—"}</TableCell>
                          <TableCell align="right">{open ?? "—"}</TableCell>
                          <TableCell align="right">
                            {lot && group.items.length === 1 ? (
                              <TextField
                                size="small"
                                type="number"
                                value={first.quantity ?? ""}
                                onChange={(e) =>
                                  handleLotChange(first._id, { quantity: e.target.value === "" ? undefined : Math.floor(Number(e.target.value)) })
                                }
                                inputProps={{ min: 1, max: first.max_quantity, style: { textAlign: "right", padding: "4px 6px" } }}
                                error={(first.quantity ?? 0) < 1 || (first.max_quantity !== undefined && (first.quantity ?? 0) > first.max_quantity)}
                                sx={{ width: 80 }}
                              />
                            ) : (
                              toReceive
                            )}
                          </TableCell>
                          <TableCell align="right">{open === null ? "—" : Math.max(open - toReceive, 0)}</TableCell>
                          <TableCell>{expiries.length ? expiries.join(", ") : "—"}</TableCell>
                          <TableCell align="right">{fmtLKR(toReceive * group.unit_price)}</TableCell>
                          <TableCell>
                            <TChip
                              size="small"
                              label={hasError ? "Barcode error" : isReady ? "Ready" : `${readyUnits}/${toReceive} ${first?.tracking_type === "serial" ? "serials" : "ready"}`}
                              color={hasError ? "error" : isReady ? "success" : "warning"}
                            />
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell colSpan={15} sx={{ p: 0, borderBottom: group.expanded ? undefined : 0 }}>
                        {/* Detail row: serial scanning, lot entry and rejections */}
                        <Collapse in={group.expanded} unmountOnExit>
                          <Divider />
                          <Box sx={{ p: 1, bgcolor: "action.hover" }}>
                            {!isLotItem(group.items[0]) && (receiptCaps[group.items[0].purchasing_order_items_id] ?? 0) > group.items.length && (
                              <Button
                                size="small"
                                variant="text"
                                onClick={() => handleAddExtraUnit(group.product_id)}
                                sx={{ mb: 1, mr: 1 }}
                              >
                                + Add unit (over-receipt tolerance allows {(receiptCaps[group.items[0].purchasing_order_items_id] ?? 0) - group.items.length} more)
                              </Button>
                            )}
                            {group.items.map((item, index) => (
                              <Box
                                key={item._id}
                                sx={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 1,
                                  p: 1.5,
                                  mb: index < group.items.length - 1 ? 1 : 0,
                                  borderRadius: 1,
                                  bgcolor: item.scanned ? "success.lighter" : "background.paper",
                                  border: 1,
                                  borderColor: item.scanned ? "success.light" : "divider",
                                }}
                              >
                                {/* Item Info Row */}
                                <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
                                  {/* Item number */}
                                  <TChip
                                    label={isLotItem(item) ? (item.tracking_type === "batch" ? "Batch lot" : "Qty") : `#${index + 1}`}
                                    size="small"
                                    sx={{ minWidth: 40 }}
                                    color={item.scanned ? "success" : "default"}
                                  />
                                </Box>

                                {isLotItem(item) ? (
                                  /* Batch / none lot: quantity (+ batch no / expiry), no barcode */
                                  <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, flexWrap: "wrap" }}>
                                    <TextField
                                      size="small"
                                      type="number"
                                      label="Received Qty"
                                      value={item.quantity ?? ""}
                                      onChange={(e) =>
                                        handleLotChange(item._id, {
                                          // never negative, never above what is still open on the PO line
                                          quantity: e.target.value === ""
                                            ? undefined
                                            : Math.max(0, Math.min(Math.floor(Number(e.target.value)) || 0, item.max_quantity ?? Number.MAX_SAFE_INTEGER)),
                                        })
                                      }
                                      inputProps={{ min: 1, max: item.max_quantity }}
                                      error={(item.quantity ?? 0) < 1 || (item.max_quantity !== undefined && (item.quantity ?? 0) > item.max_quantity)}
                                      helperText={item.max_quantity !== undefined ? `of ${item.max_quantity} remaining` : undefined}
                                      sx={{ width: 150 }}
                                    />
                                    {item.tracking_type === "batch" && (
                                      <>
                                        <TextField
                                          size="small"
                                          label="Batch No"
                                          value={item.batch_no || ""}
                                          onChange={(e) => handleLotChange(item._id, { batch_no: e.target.value })}
                                          error={!item.batch_no?.trim()}
                                          helperText={!item.batch_no?.trim() ? "Required" : undefined}
                                          inputProps={{ maxLength: 100 }}
                                          sx={{ width: 170 }}
                                        />
                                        <TextField
                                          size="small"
                                          type="date"
                                          label="Expiry (optional)"
                                          value={item.expiry_date || ""}
                                          onChange={(e) => handleLotChange(item._id, { expiry_date: e.target.value || undefined })}
                                          InputLabelProps={{ shrink: true }}
                                          inputProps={{ min: todayLocalISO() }}
                                          error={!!item.expiry_date && item.expiry_date < todayLocalISO()}
                                          helperText={item.expiry_date && item.expiry_date < todayLocalISO() ? "Already expired" : undefined}
                                          sx={{ width: 170 }}
                                        />
                                      </>
                                    )}
                                    <TextField
                                      size="small"
                                      label="Warranty (months)"
                                      value={item.warranty_month || ""}
                                      onChange={(e) => handleWarrantyChange(item._id, e.target.value)}
                                      sx={{ width: 150 }}
                                    />
                                  </Box>
                                ) : (
                                /* Barcode and Actions Row */
                                <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                                  {/* Barcode Input */}
                                  <TextField
                                    inputRef={activeScanItem === item._id ? barcodeInputRef : undefined}
                                    size="small"
                                    placeholder="Scan or enter barcode"
                                    value={item.barcode}
                                    onChange={(e) => handleBarcodeChange(item._id, e.target.value)}
                                    onBlur={(e) => handleBarcodeBlur(item._id, e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" && item.barcode) {
                                        handleBarcodeBlur(item._id, item.barcode);
                                        completeScan(item._id);
                                      }
                                    }}
                                    error={!!item.barcodeError && item.barcodeError !== "Checking..."}
                                    helperText={item.barcodeError}
                                    sx={{ flex: 1, minWidth: 200 }}
                                    InputProps={{
                                      startAdornment: (
                                        <InputAdornment position="start">
                                          <QrCodeScannerIcon color={item.barcodeError && item.barcodeError !== "Checking..." ? "error" : item.scanned ? "success" : "action"} />
                                        </InputAdornment>
                                      ),
                                      endAdornment: item.barcodeError && item.barcodeError !== "Checking..." ? (
                                        <InputAdornment position="end">
                                          <ErrorIcon color="error" />
                                        </InputAdornment>
                                      ) : item.barcodeError === "Checking..." ? (
                                        <InputAdornment position="end">
                                          <CircularProgress size={16} />
                                        </InputAdornment>
                                      ) : item.scanned ? (
                                        <InputAdornment position="end">
                                          <CheckCircleIcon color="success" />
                                        </InputAdornment>
                                      ) : undefined,
                                    }}
                                  />

                                  {/* Warranty Input - show if empty or allow edit */}
                                  <TextField
                                    size="small"
                                    placeholder="Warranty (months)"
                                    value={item.warranty_month || ""}
                                    onChange={(e) => handleWarrantyChange(item._id, e.target.value)}
                                    sx={{ width: 130 }}
                                    InputProps={{
                                      startAdornment: (
                                        <InputAdornment position="start">
                                          <Typography variant="caption" color="text.secondary">W:</Typography>
                                        </InputAdornment>
                                      ),
                                    }}
                                  />


                                  {/* Scan button */}
                                  {!item.scanned && (
                                    <Button
                                      variant="outlined"
                                      size="small"
                                      startIcon={<QrCodeScannerIcon />}
                                      onClick={() => startScanning(item._id)}
                                      sx={{ minWidth: 80 }}
                                    >
                                      Scan
                                    </Button>
                                  )}
                                </Box>
                                )}
                              </Box>
                            ))}
                          </Box>
                        </Collapse>
                          </TableCell>
                        </TableRow>
                      </Fragment>
                      );
                    })}
                        </TableBody>
                      </Table>
                    </Paper>

                    <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 4, px: 1 }}>
                      <Typography variant="body2" color="text.secondary">
                        Units to receive: <b>{totalUnits}</b>
                      </Typography>
                      <Typography variant="subtitle2">
                        Total GRN Cost ({currencySymbol}): {fmtLKR(createTotalCost)}
                      </Typography>
                    </Box>

                    {/* Barcode Validation Status */}
                    {isValidatingBarcodes && (
                      <Alert severity="info" sx={{ mb: 2 }}>
                        <CircularProgress size={16} sx={{ mr: 1 }} />
                        Validating barcodes against database... Please wait.
                      </Alert>
                    )}

                    {/* Barcode Error Alert */}
                    {hasBarcodeErrors && !isValidatingBarcodes && (
                      <Alert severity="error" sx={{ mb: 2 }}>
                        Some barcodes have errors: {lineItems.filter(i => i.barcodeError && i.barcodeError !== "Checking...").map(i => `${i.barcode} (${i.barcodeError})`).join(", ")}
                      </Alert>
                    )}

                    {/* All Valid Alert */}
                    {allBarcodesValidated && !hasBarcodeErrors && !isValidatingBarcodes && (
                      <Alert severity="success" sx={{ mb: 2 }}>
                        All {lineItems.length} barcodes validated successfully! Ready to save.
                      </Alert>
                    )}


                  </Box>
                ) : !isEditing ? (
                  /* View mode - one row per received PO line, with full cost */
                  <Box>
                    <Paper variant="outlined" sx={{ overflow: "auto", borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow sx={modernTableStyles.headerRow}>
                            <TableCell>Item Code</TableCell>
                            <TableCell>Item Name</TableCell>
                            <TableCell>Description</TableCell>
                            <TableCell>Currency</TableCell>
                            <TableCell align="right">{`Unit Price (${currencySymbol})`}</TableCell>
                            <TableCell align="right">Quantity</TableCell>
                            <TableCell align="right">To Receive</TableCell>
                            <TableCell align="right">Remaining Qty</TableCell>
                            <TableCell>UOM</TableCell>
                            <TableCell>Expiry Date</TableCell>
                            <TableCell align="right">{`Line Cost (${currencySymbol})`}</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {loadingItems ? (
                            <TableRow>
                              <TableCell colSpan={11} align="center">
                                <CircularProgress size={24} sx={{ my: 2 }} />
                              </TableCell>
                            </TableRow>
                          ) : viewLines.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={11} sx={modernTableStyles.emptyCell}>
                                No items received yet
                              </TableCell>
                            </TableRow>
                          ) : (
                            <>
                              {viewLines.map((row) => (
                                <TableRow key={row.key}>
                                  <TableCell>{row.item_code || "—"}</TableCell>
                                  <TableCell>
                                    <EntityLink entity="product" id={row.product_id}>
                                      {row.item_name}
                                    </EntityLink>
                                    {row.refs.length > 0 && (
                                      <Typography variant="caption" color="text.secondary" display="block">
                                        {row.refs.slice(0, 3).join(", ")}
                                        {row.refs.length > 3 ? ` +${row.refs.length - 3} more` : ""}
                                      </Typography>
                                    )}
                                  </TableCell>
                                  <TableCell sx={{ maxWidth: 220 }}>{row.description || "—"}</TableCell>
                                  <TableCell>{currencySymbol}</TableCell>
                                  <TableCell align="right">{fmtLKR(row.unit_price)}</TableCell>
                                  <TableCell align="right">{row.ordered ?? "—"}</TableCell>
                                  <TableCell align="right">{row.toReceive}</TableCell>
                                  <TableCell align="right">{row.remaining ?? "—"}</TableCell>
                                  <TableCell>{row.uom || "—"}</TableCell>
                                  <TableCell>
                                    {row.expiry.length ? row.expiry.map((d) => d.split("T")[0]).join(", ") : "—"}
                                  </TableCell>
                                  <TableCell align="right">{fmtLKR(row.toReceive * row.unit_price)}</TableCell>
                                </TableRow>
                              ))}
                              <TableRow sx={{ bgcolor: "action.hover" }}>
                                <TableCell colSpan={10} align="right" sx={{ fontWeight: "bold" }}>
                                  Total GRN Cost ({currencySymbol})
                                </TableCell>
                                <TableCell align="right" sx={{ fontWeight: "bold" }}>
                                  {fmtLKR(viewTotalCost)}
                                </TableCell>
                              </TableRow>
                            </>
                          )}
                        </TableBody>
                      </Table>
                    </Paper>
                  </Box>
                ) : (
                  /* Edit mode - Table layout */
                  <Box>
                    <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow sx={modernTableStyles.headerRow}>
                            <TableCell>Barcode</TableCell>
                            <TableCell>Product</TableCell>
                            <TableCell>Warranty</TableCell>
                            <TableCell>Saved To</TableCell>
                            <TableCell>Branch</TableCell>
                            <TableCell align="center">Active</TableCell>
                            {(isEditing || isCreating) && <TableCell sx={{ width: 50 }} />}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {loadingItems ? (
                            <TableRow>
                              <TableCell colSpan={isEditing || isCreating ? 7 : 6} align="center">
                                <CircularProgress size={24} sx={{ my: 2 }} />
                              </TableCell>
                            </TableRow>
                          ) : lineItems.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={isEditing || isCreating ? 7 : 6} sx={modernTableStyles.emptyCell}>
                                {isCreating
                                  ? "Select a Purchase Order to load items"
                                  : "No items received yet"}
                              </TableCell>
                            </TableRow>
                          ) : isEditing ? (
                            // Edit mode - flat list
                            lineItems.map((item, index) => (
                              <TableRow key={item._id} sx={{
                                ...modernTableStyles.bodyRow,
                                ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                              }}>
                                <TableCell>
                                  <TextField
                                    size="small"
                                    fullWidth
                                    value={item.barcode}
                                    onChange={(e) => handleUpdateLineItem(item._id, "barcode", e.target.value)}
                                    placeholder="Barcode"
                                  />
                                </TableCell>
                                <TableCell>
                                  {item.product_name || `PO Item #${item.purchasing_order_items_id}`}
                                </TableCell>
                                <TableCell>
                                  <Box sx={{ display: "flex", gap: 0.5 }}>
                                    {item.saveToSalesStock && (
                                      <TChip size="small" label="Sales Stock" color="success" icon={<InventoryIcon />} />
                                    )}
                                    {item.saveToCompanyAssets && (
                                      <TChip size="small" label="Company Asset" color="info" icon={<BusinessIcon />} />
                                    )}
                                  </Box>
                                </TableCell>
                                <TableCell>{item.branch_code}</TableCell>
                                <TableCell align="center">
                                  <TChip size="small" label={item.active ? "Yes" : "No"} color={item.active ? "success" : "default"} />
                                </TableCell>
                                <TableCell>
                                  <IconButton size="small" onClick={() => handleRemoveLineItem(item._id)} color="error">
                                    <DeleteIcon fontSize="small" />
                                  </IconButton>
                                </TableCell>
                              </TableRow>
                            ))
                          ) : null}
                        </TableBody>
                      </Table>
                    </Paper>
                  </Box>
                )}

                {!isCreating && selectedGRN && (
                  <LandedCostPanel grnId={selectedGRN.id} grnStatus={selectedGRN.status} />
                )}

                <FormSection title="Remarks" columns={1}>
                  <TRemarkField
                    label="Remarks"
                    size="small"
                    value={formData.remark}
                    onChange={(value) => setFormData({ ...formData, remark: value })}
                    disabled={!isEditing && !isCreating}
                    multiline
                    rows={2}
                  />
                </FormSection>
              </>
            )}
          </>
        )}

        {/* Activity History (view mode only) */}
        {selectedGRN && !isCreating && !isEditing && (
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
              <Typography variant="body2">{formatDateTimeReadable(selectedGRN.created_date || selectedGRN.added_date) || "-"}</Typography>
            </Box>
          </FormSection>
        )}
      </Box>
    </Box>
  );

  return (
    <>
      <ReclassifyDialog
        open={cancelOpen}
        title="Cancel GRN"
        description="Cancelling withdraws the received stock and reopens the purchase order line. It is refused if any unit has been sold, moved or returned."
        confirmLabel="Cancel GRN"
        isSubmitting={cancelBusy}
        error={cancelError}
        onClose={() => setCancelOpen(false)}
        onSubmit={(reason) => handleCancelGRN(reason)}
      />
      <MasterDetailLayout
        title="Good Received Notes"
        titleSlot={
          isGRNDetailMode ? (
          <Button
            size="small"
            startIcon={<ArrowBackIcon fontSize="small" />}
            onClick={handleBackToGRNs}
            sx={{ textTransform: "none" }}
          >
            Back to Good Received Notes
          </Button>
          ) : (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <TextField
              size="small"
              placeholder="Search GRN or PO No"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              }}
              sx={{ width: 190, flexShrink: 0 }}
            />
            <Box sx={{ width: 150, flexShrink: 0 }}>
              <TBranchFilter branches={branches} value={filterBranch} onChange={setFilterBranch} label="" placeholder="All Branches" size="small" />
            </Box>
            <Box sx={{ width: 170, flexShrink: 0 }}>
              <Autocomplete
                size="small"
                options={suppliers}
                getOptionLabel={(option) => option.company_name || ""}
                value={suppliers.find((s) => s.id === filterSupplier) || null}
                onChange={(_, newValue) => setFilterSupplier(newValue?.id || null)}
                renderInput={(params) => <TextField {...params} placeholder="All Suppliers" />}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                fullWidth
              />
            </Box>
            <Box sx={{ width: 160, flexShrink: 0 }}>
              <Autocomplete
                size="small"
                options={poFilterOptions}
                getOptionLabel={(option: POFilterOption) => option.purchasing_order_no || `PO-${option.id}`}
                value={poFilterOptions.find((po: POFilterOption) => po.id === filterPOId) || null}
                onChange={(_, newValue) => setFilterPOId(newValue?.id || null)}
                renderInput={(params) => <TextField {...params} placeholder="All POs" />}
                isOptionEqualToValue={(option: any, value: any) => option.id === value.id}
                fullWidth
              />
            </Box>
            <Box sx={{ width: 160, flexShrink: 0 }}>
              <Autocomplete
                size="small"
                options={createdByUserOptions}
                value={filterCreatedByUser}
                onChange={(_, newValue) => setFilterCreatedByUser(newValue || null)}
                renderInput={(params) => <TextField {...params} placeholder="All Users" />}
                isOptionEqualToValue={(option, value) => option === value}
                fullWidth
              />
            </Box>
            {(searchQuery || filterBranch || filterSupplier || filterPOId || filterCreatedByUser) && (
              <Button size="small" onClick={handleClearFilters} sx={{ textTransform: "none" }}>
                Clear
              </Button>
            )}
          </Box>
          )
        }
        headerActions={
          isGRNDetailMode || !canCreateGRN ? undefined : (
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={handleNewGRN}
              sx={{ mr: 1 }}
            >
              Add GRN
            </Button>
          )
        }
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ["goodReceivedNotes"] });
          queryClient.invalidateQueries({ queryKey: ["purchaseOrders"] });
        }}
        isLoading={isLoading}
        {...(isGRNDetailMode
          ? { children: detailPanel }
          : { children: grnTablePanel })}
      />

      {/* Confirm Dialog */}
      <TConfirmDialog {...confirmDialog.dialogProps} />

      {/* Print Preview Dialog */}
      {selectedGrnIdForPrint && (
        <TPrintPreviewDialog
          open={printDialogOpen}
          onClose={() => {
            setPrintDialogOpen(false);
            setSelectedGrnIdForPrint(null);
          }}
          documentType="grn"
          documentId={selectedGrnIdForPrint}
          title={`Print GRN: ${selectedGRN?.good_received_no || ''}`}
        />
      )}

      {/* Credit Limit Override Dialog */}
      <Dialog
        open={creditLimitDialog.open}
        onClose={handleCreditDialogClose}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <WarningAmberIcon color="warning" />
          <Typography variant="h6">Credit Limit Exceeded</Typography>
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {creditLimitDialog.errorMessage}
          </Alert>
          {canOverrideCredit ? (
            <Typography>
              As an authorized user, you can override this limit and proceed with the GRN.
              This will be logged for audit purposes.
            </Typography>
          ) : (
            <Typography color="error">
              You do not have permission to override credit limits.
              Please contact a manager or administrator to proceed with this GRN.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="contained" color="error" startIcon={<CancelIcon />} onClick={handleCreditDialogClose}>
            Cancel
          </Button>
          {canOverrideCredit && (
            <Button
              onClick={handleCreditOverrideConfirm}
              variant="contained"
              color="warning"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Processing..." : "Override & Create GRN"}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <TActivityHistoryPanel
        open={activityHistoryOpen}
        onClose={() => setActivityHistoryOpen(false)}
        entityType="good_received_note"
        entityId={selectedGRN?.id}
        actionLabels={{ create: "GRN created" }}
      />
    </>
  );
}
