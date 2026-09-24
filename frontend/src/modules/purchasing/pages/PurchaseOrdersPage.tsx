/**
 * PurchaseOrdersPage - Using Tijaero-style reusable components
 * Refactored to use common tijaero components for better code reuse
 */

// Confirm dialog now uses TConfirmDialog from tijaero
import apiClient from "@/api/client";
import { 
  FileDownload as DownloadIcon,
  Check as CheckIcon,
  Email as EmailIcon,
} from "@mui/icons-material";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
import DeleteIcon from "@mui/icons-material/Delete";
import HistoryIcon from "@mui/icons-material/History";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import StarIcon from "@mui/icons-material/Star";
import StarOutlineIcon from "@mui/icons-material/StarBorder";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import {
    Alert,
    Autocomplete,
    Avatar,
    Box,
    Button,
    CircularProgress,
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
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
// Import tijaero components
import {
    ActionToolbar,
    canPrintDocument,
    DetailPanelHeader,
    EmptyState,
    fmtLKR,
    FormSection,
    getStatusProps,
    MasterDetailLayout,
    modernTableStyles,
    PURCHASE_ORDER_PAYMENT_METHOD,
    SelectableListItem,
    showErrorToast,
    showSuccessToast,
    showWarningToast,
    TBranchFilter,
    TConfirmDialog,
    TDataGrid,
    type TDataGridColumn,
    TPrintButton,
    TPrintPreviewDialog,
    TStatusChip,
    TSupplierFilter,
    TStatusFilter,
    PO_STATUS_FILTER_OPTIONS,
    useCrudMutation,
    useMasterDetailState,
    useTConfirmDialog,
    TActivityHistoryPanel,
} from "@/components/tijaero";

import { useReferenceData } from "@/hooks";
import { purchaseOrdersApi, suppliersApi } from "@/modules/purchasing/api";
// OPTIMIZED: Removed individual imports for productsApi, branchApi - using aggregated endpoint
import {
    DailyPOLimitCheck,
    PurchasingOrder,
    PurchasingOrderCreate,
    PurchasingOrderItemCreate,
    PurchasingOrderWithItems,
    Supplier,
    SupplierProduct,
} from "@/modules/purchasing/types";
import { productsApi } from "@/modules/inventory/api";

import { useAuthStore } from "@/state/authStore";
import { hasPermission } from "@/auth/permissions";

// Status options are now imported from common components (PO_STATUS_OPTIONS)

const FORM_STEPS = ["Select Products", "Order Information"];

/** Preview the next sequential number using the same format as the backend */
const getNextNumber = (prefix: string, existing: { no: string }[], branchCode?: string): string => {
  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const actualBranch = branchCode || "MAIN";
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
  return `${fullPrefix}${String(maxSeq + 1).padStart(6, "0")}`;
};

// Extended form type to include editable status fields
interface PurchaseOrderFormData extends PurchasingOrderCreate {
  status?: string;
}

const normalizePurchaseOrderPaymentMethod = (method?: string | null): string => {
  return method?.toLowerCase() === "credit" ? "Credit" : "Non-credit";
};

const INITIAL_FORM_DATA: PurchaseOrderFormData = {
  purchasing_order_no: "",
  branch_code: "",
  payment_method: "Non-credit",
  purchasing_order_date: new Date().toISOString().split("T")[0],
  good_received_note_date: new Date().toISOString().split("T")[0],
  remarks: "",
  credit_date: 0,
  first_suppliers_id: 0,
  second_suppliers_id: 0,
  items: [],
  status: "draft",
};

interface OrderLineItem extends PurchasingOrderItemCreate {
  _id: string;
}

// A purchase order row as shown in the browse table, with the supplier name
// looked up and attached directly so the table's own column-header sort
// orders by the displayed name rather than the raw supplier id.
type PurchaseOrderRow = PurchasingOrder & { supplier_display_name: string };

const resetFormFromOrder = (
  order: PurchasingOrder | PurchasingOrderWithItems,
): PurchaseOrderFormData => ({
  purchasing_order_no: order.purchasing_order_no,
  branch_code: order.branch_code,
  payment_method: normalizePurchaseOrderPaymentMethod(order.payment_method),
  purchasing_order_date: order.purchasing_order_date?.split("T")[0] || "",
  good_received_note_date: order.good_received_note_date?.split("T")[0] || "",
  remarks: order.remarks || "",
  credit_date: order.credit_date || 0,
  first_suppliers_id: order.first_suppliers_id,
  second_suppliers_id: order.second_suppliers_id,
  status: order.status || "draft",
  items:
    "items" in order && order.items
      ? order.items.map((item) => ({
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          warrenty_month: item.warrenty_month || "0",
          remark: item.remark || "",
        }))
      : [],
});

export default function PurchaseOrdersPage() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);

  const [lineItems, setLineItems] = useState<OrderLineItem[]>([]);
  // Which line item's "Compare Suppliers" dialog is open (null = closed).
  // Tracks the line item id, not just the product, since the price it picks
  // must be quick-filled back onto that specific row.
  const [compareSuppliersFor, setCompareSuppliersFor] = useState<{ itemId: string; productId: number } | null>(null);
  const [formStep, setFormStep] = useState(0);

  // Confirm dialog for unsaved changes and delete actions
  const confirmDialog = useTConfirmDialog();
  const creditWarningDialog = useTConfirmDialog();

  // Validation state - track which fields have been touched/blurred
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Daily PO limit warning dialog state
  const [dailyLimitWarningOpen, setDailyLimitWarningOpen] = useState(false);
  const [dailyLimitInfo, setDailyLimitInfo] =
    useState<DailyPOLimitCheck | null>(null);
  const [isDailyLimitExceeded, setIsDailyLimitExceeded] = useState(false);

  // Credit warning state
  const [creditWarning, setCreditWarning] = useState<{
    show: boolean;
    message: string;
    breakdown: string;
    requiresApproval: boolean;
  }>({ show: false, message: "", breakdown: "", requiresApproval: false });

  // Mark field as touched when user leaves it
  const handleBlur = (fieldName: string) => {
    setTouched((prev) => ({ ...prev, [fieldName]: true }));
  };

  // Filter states (applied - drives the actual list filtering)
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterSupplier, setFilterSupplier] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);

  // Item remarks modal state
  const [itemRemarkModalOpen, setItemRemarkModalOpen] = useState(false);
  const [selectedItemForRemark, setSelectedItemForRemark] =
    useState<OrderLineItem | null>(null);
  const [tempItemRemark, setTempItemRemark] = useState("");

  const handleOpenItemRemarkModal = (item: OrderLineItem) => {
    setSelectedItemForRemark(item);
    setTempItemRemark(item.remark || "");
    setItemRemarkModalOpen(true);
  };

  // Print Dialog State
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [selectedPoIdForPrint, setSelectedPoIdForPrint] = useState<
    number | null
  >(null);

  const handlePrint = (poId: number) => {
    setSelectedPoIdForPrint(poId);
    setPrintDialogOpen(true);
  };

  const handleSaveItemRemark = () => {
    if (selectedItemForRemark) {
      handleUpdateLineItem(selectedItemForRemark._id, "remark", tempItemRemark);
    }
    setItemRemarkModalOpen(false);
    setSelectedItemForRemark(null);
  };

  const {
    searchQuery,
    setSearchQuery,
    selectedItem: selectedOrder,
    setSelectedItem: setSelectedOrder,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    favorites,
    toggleFavorite,
    formData,
    setFormData,
    handleSelectItem: handleSelectOrder,
    handleNew: handleNewOrderBase,
    handleCancel: handleCancelBase,
    handleStartEdit: handleStartEditBase,
  } = useMasterDetailState<PurchasingOrder, PurchaseOrderFormData>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromOrder,
    favoritesKey: "purchase_orders_favorites",
    defaultSortField: "added_date",
    confirmUnsavedChanges: () =>
      confirmDialog.confirm({
        title: "Discard Changes",
        message: "You have unsaved changes. Discard them?",
        confirmText: "Discard",
        cancelText: "Keep Editing",
        confirmColor: "warning",
      }),
    extraDirty: lineItems.length > 0,
    onDiscard: () => {
      setLineItems([]);
      setFormStep(0);
    },
  });

  // Activity History is opened on demand from a detail icon next to the
  // Tracking section title, rather than shown inline.
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);

  const handleStartEdit = useCallback(() => {
    handleStartEditBase();
    setFormStep(0);
    setTouched({}); // Reset validation state
    // @ts-ignore - selectedOrder might have items from detailed fetch
    if (selectedOrder?.items) {
      // @ts-ignore
      setLineItems(
        (selectedOrder as any).items.map((item: any, idx: number) => ({
          _id: `existing-${idx}`,
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          warrenty_month: item.warrenty_month || "0",
          remark: item.remark || "",
        })),
      );
    }
  }, [handleStartEditBase, selectedOrder]);

  // Cancelling out of "New Order" should return to the browse table, not
  // auto-open the first order the way useMasterDetailState's generic
  // handleCancel does (that behavior made sense for the old always-visible
  // detail panel, but not here). Cancelling out of editing an existing
  // order still just reverts its form, which the generic handler already
  // does correctly.
  const handleCancel = useCallback(
    (items: PurchasingOrder[]) => {
      if (isCreating) {
        setIsCreating(false);
        setIsEditing(false);
        setSelectedOrder(null);
      } else {
        handleCancelBase(items);
      }
      setLineItems([]);
      setFormStep(0);
      setTouched({}); // Reset validation state
      setCreditWarning({
        show: false,
        message: "",
        breakdown: "",
        requiresApproval: false,
      }); // Clear credit warning
    },
    [isCreating, handleCancelBase, setIsCreating, setIsEditing, setSelectedOrder],
  );

  const selectingOrderIdRef = useRef<number | null>(null);
  const loadedOrderItemsIdRef = useRef<number | null>(null);
  const orderItemsCacheRef = useRef<Map<number, OrderLineItem[]>>(new Map());

  // Handler that wraps hook's handler (which already handles unsaved changes confirm)
  const handleSelectOrderWithItems = useCallback(
    async (order: PurchasingOrder) => {
      if (selectingOrderIdRef.current === order.id) return;

      const cachedItems = orderItemsCacheRef.current.get(order.id);
      if (cachedItems) {
        const selected = await handleSelectOrder(order);
        if (!selected) return;

        setTouched({});
        setLineItems(cachedItems.map((item) => ({ ...item })));
        loadedOrderItemsIdRef.current = order.id;
        return;
      }

      const isSameOrderSelected = selectedOrder?.id === order.id;
      if (isSameOrderSelected && loadedOrderItemsIdRef.current === order.id) {
        return;
      }

      selectingOrderIdRef.current = order.id;

      const selected = await handleSelectOrder(order);
      if (!selected) {
        if (selectingOrderIdRef.current === order.id) {
          selectingOrderIdRef.current = null;
        }
        return;
      }

      // Load detailed items after selection
      setTouched({});
      try {
        const detailedOrder = await purchaseOrdersApi.getById(order.id);
        let mappedItems: OrderLineItem[] = [];
        if (detailedOrder.items) {
          mappedItems = detailedOrder.items.map((item, idx) => ({
            _id: `existing-${idx}`,
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            warrenty_month: item.warrenty_month || "0",
            remark: item.remark || "",
          }));
          setLineItems(mappedItems);
        } else {
          setLineItems([]);
        }
        orderItemsCacheRef.current.set(order.id, mappedItems);
        loadedOrderItemsIdRef.current = order.id;
      } catch {
        setLineItems([]);
      } finally {
        if (selectingOrderIdRef.current === order.id) {
          selectingOrderIdRef.current = null;
        }
      }
    },
    [handleSelectOrder, selectedOrder?.id],
  );

  // OPTIMIZED: Fetch suppliers separately (has complex filters) but use aggregated endpoint for products/branches
  const canViewSuppliers = hasPermission(user, "suppliers", "view");
  const { data: suppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => suppliersApi.getAll(),
    enabled: canViewSuppliers,
  });

  // OPTIMIZED: Single API call for products and branches (was 2 calls)
  const {
    data: refData,
    filteredBranches,
    defaultBranchCode,
  } = useReferenceData(["products", "branches"]);
  const products = refData?.products || [];
  const branches = filteredBranches || [];

  // Which products the PO's primary supplier has an approved-vendor mapping
  // for (Suppliers -> Products), so the line-item picker can flag them and
  // default to that supplier's own cost price instead of the product's
  // generic cost_price or an unrelated price tier.
  const { data: supplierProductList } = useQuery({
    queryKey: ["supplier-products", formData.first_suppliers_id],
    queryFn: () => suppliersApi.getProducts(formData.first_suppliers_id),
    enabled: !!formData.first_suppliers_id && (isEditing || isCreating),
  });
  const supplierProductMap = useMemo(() => {
    const map = new Map<number, SupplierProduct>();
    (supplierProductList || []).forEach((sp) => map.set(sp.product_id, sp));
    return map;
  }, [supplierProductList]);

  // Mapped-to-this-supplier products first, so they're easy to find, without
  // hiding the rest — a supplier can still occasionally send something new.
  const productOptions = useMemo(() => {
    if (supplierProductMap.size === 0) return products;
    return [...products].sort((a: any, b: any) => {
      const aMapped = supplierProductMap.has(a.id) ? 1 : 0;
      const bMapped = supplierProductMap.has(b.id) ? 1 : 0;
      return bMapped - aMapped;
    });
  }, [products, supplierProductMap]);

  // The reverse lookup: every supplier who can supply the product currently
  // open in the "Compare Suppliers" dialog, with their cost/lead time/MOQ —
  // reuses the same reciprocal endpoint that backs the Products page.
  const { data: compareSuppliers, isLoading: compareSuppliersLoading } = useQuery({
    queryKey: ["product-suppliers-compare", compareSuppliersFor?.productId],
    queryFn: () => productsApi.getSuppliers(compareSuppliersFor!.productId),
    enabled: !!compareSuppliersFor,
  });

  const handleQuickFillSupplierPrice = useCallback((supplier: SupplierProduct) => {
    if (!compareSuppliersFor) return;
    setLineItems((prev) =>
      prev.map((lineItem) =>
        lineItem._id === compareSuppliersFor.itemId
          ? { ...lineItem, unit_price: supplier.cost_price }
          : lineItem
      )
    );
    showSuccessToast(
      `Unit price set to Rs. ${supplier.cost_price} from ${supplier.supplier_company_name || "this supplier"}`
    );
    setCompareSuppliersFor(null);
  }, [compareSuppliersFor]);

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
    setFilterStatus(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // branchResolved: true once we've either confirmed no default branch exists, or the filter has been set
  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  const { data: orders, isLoading } = useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: () => purchaseOrdersApi.getAll(),
    enabled: branchResolved,
  });

  const nextPONumber = useMemo(() => getNextNumber('PO', (orders || []).map((o: PurchasingOrder) => ({ no: o.purchasing_order_no })), formData.branch_code), [orders, formData.branch_code]);

  // Check daily PO limit for a branch
  const checkDailyLimit = useCallback(
    async (branchCode: string): Promise<DailyPOLimitCheck | null> => {
      try {
        const limitInfo = await purchaseOrdersApi.getDailyLimit(branchCode);
        return limitInfo;
      } catch {
        return null;
      }
    },
    [],
  );

  // Start new order (internal, after limit check)
  const startNewOrderInternal = useCallback(() => {
    handleNewOrderBase();
    setFormData((prev) => ({
      ...prev,
      purchasing_order_no: "",
      branch_code: defaultBranchCode || prev.branch_code,
    }));
    setLineItems([]);
    setFormStep(0);
    setTouched({}); // Reset validation state
    setCreditWarning({
      show: false,
      message: "",
      breakdown: "",
      requiresApproval: false,
    }); // Clear credit warning
  }, [handleNewOrderBase, setFormData, defaultBranchCode]);

  // Handle new order - don't check daily limit here, check when branch is selected
  const handleNewOrder = useCallback(async () => {
    startNewOrderInternal();
  }, [startNewOrderInternal]);

  const getProductName = (productId: number) => {
    const product = products?.find((p: any) => p.id === productId);
    return product ? product.name : `Product #${productId}`;
  };

  const filteredOrders = useMemo(() => {
    if (!orders) return [];

    let filtered = orders.filter(
      (order) =>
        order.purchasing_order_no
          ?.toLowerCase()
          .includes(searchQuery.toLowerCase()) ||
        String(order.id).includes(searchQuery),
    );

    // Apply branch filter
    if (filterBranch) {
      filtered = filtered.filter((order) => order.branch_code === filterBranch);
    }

    // Apply supplier filter (matches either primary or secondary supplier)
    if (filterSupplier) {
      filtered = filtered.filter(
        (order) =>
          order.first_suppliers_id === filterSupplier ||
          order.second_suppliers_id === filterSupplier,
      );
    }

    // Apply status filter
    if (filterStatus) {
      filtered = filtered.filter((order) => order.status === filterStatus);
    }

    // Default order before the user sorts a column in the table itself
    // (the table's own column-header sort takes over from there).
    filtered.sort((a, b) => {
      const diff = new Date(b.added_date || "").getTime() - new Date(a.added_date || "").getTime();
      return diff !== 0 ? diff : (b.id || 0) - (a.id || 0);
    });

    return filtered;
  }, [orders, searchQuery, filterBranch, filterSupplier, filterStatus]);

  const approvalNavTargetId = useMemo(() => {
    const navState = location.state as {
      fromPOApproval?: boolean;
      purchaseOrderId?: number | string;
    } | null;
    if (!navState?.fromPOApproval || navState.purchaseOrderId == null) {
      return null;
    }
    const parsedId = Number(navState.purchaseOrderId);
    return Number.isFinite(parsedId) ? parsedId : null;
  }, [location.state]);

  // Open the ?focus=<id> deep-link target (used by the AI assistant to open
  // a specific PO). Nothing is auto-selected otherwise — the default view is
  // the browse table.
  const focusHandled = useRef(false);
  useEffect(() => {
    if (isCreating || filteredOrders.length === 0) return;
    const focusId = Number(searchParams.get("focus"));
    if (focusId && !focusHandled.current) {
      const target = filteredOrders.find((o) => o.id === focusId);
      if (target) {
        focusHandled.current = true;
        handleSelectOrderWithItems(target);
        const next = new URLSearchParams(searchParams);
        next.delete("focus");
        setSearchParams(next, { replace: true });
      }
    }
  }, [
    filteredOrders,
    isCreating,
    handleSelectOrderWithItems,
    searchParams,
    setSearchParams,
  ]);

  // Handle navigation state from Quotation page (auto-select PO created from quotation)
  const navStateHandled = useRef(false);
  useEffect(() => {
    const navState = location.state as {
      fromQuotation?: boolean;
      purchaseOrderId?: number;
      purchaseOrderNo?: string;
    } | null;
    if (
      navState?.fromQuotation &&
      navState.purchaseOrderId &&
      !navStateHandled.current
    ) {
      navStateHandled.current = true;
      // Invalidate and refetch to ensure the newly created PO appears
      queryClient.invalidateQueries({ queryKey: ["purchaseOrders"] });
    }
  }, [location.state, queryClient]);

  // After orders are (re)loaded, select the PO from navigation state
  const navSelectHandled = useRef(false);
  useEffect(() => {
    const navState = location.state as {
      fromQuotation?: boolean;
      purchaseOrderId?: number;
      purchaseOrderNo?: string;
    } | null;
    if (
      navState?.fromQuotation &&
      navState.purchaseOrderId &&
      orders &&
      !navSelectHandled.current
    ) {
      const createdPO = orders.find(
        (o: PurchasingOrder) => o.id === navState.purchaseOrderId,
      );
      if (createdPO) {
        navSelectHandled.current = true;
        handleSelectOrderWithItems(createdPO);
        showSuccessToast(
          `Navigated to PO ${navState.purchaseOrderNo || createdPO.purchasing_order_no} created from quotation`,
        );
        // Clear navigation state to prevent re-triggering
        window.history.replaceState({}, document.title);
      }
    }
  }, [orders, location.state, handleSelectOrderWithItems]);

  // Handle navigation from PO Approvals page — auto-select target PO
  const approvalNavHandled = useRef(false);
  useEffect(() => {
    const navState = location.state as {
      fromPOApproval?: boolean;
      purchaseOrderId?: number | string;
      purchaseOrderNo?: string;
    } | null;

    if (approvalNavTargetId == null || !navState?.fromPOApproval || approvalNavHandled.current) {
      return;
    }

    approvalNavHandled.current = true;

    let cancelled = false;

    const openTargetPO = async () => {
      const targetPOFromList = (orders || []).find(
        (o: PurchasingOrder) => Number(o.id) === approvalNavTargetId,
      );

      if (targetPOFromList) {
        await handleSelectOrderWithItems(targetPOFromList);
        if (!cancelled) {
          showSuccessToast(
            `Opened ${navState.purchaseOrderNo || targetPOFromList.purchasing_order_no} from PO approvals`,
          );
          window.history.replaceState({}, document.title);
        }
        return;
      }

      try {
        const targetPO = await purchaseOrdersApi.getById(approvalNavTargetId);
        if (cancelled || !targetPO) return;

        await handleSelectOrderWithItems(targetPO as PurchasingOrder);
        showSuccessToast(
          `Opened ${navState.purchaseOrderNo || targetPO.purchasing_order_no} from PO approvals`,
        );
        window.history.replaceState({}, document.title);
      } catch {
        if (!cancelled) {
          approvalNavHandled.current = false;
          window.history.replaceState({}, document.title);
          showErrorToast("Unable to open the selected PO from approvals");
        }
      }
    };

    void openTargetPO();

    return () => {
      cancelled = true;
    };
  }, [orders, location.state, approvalNavTargetId, handleSelectOrderWithItems]);

  // Handle navigation from Proforma page — auto-create PO with pre-filled items
  const proformaNavHandled = useRef(false);
  useEffect(() => {
    interface ProformaNavState {
      fromProforma?: boolean;
      proformaId?: number;
      proformaNo?: string;
      branchCode?: string;
      remarks?: string;
      items?: Array<{
        product_id: number;
        quantity: number;
        unit_price: number;
        warrenty_month: string;
        remark: string;
      }>;
    }
    const navState = location.state as ProformaNavState | null;
    if (
      navState?.fromProforma &&
      navState.items &&
      !proformaNavHandled.current
    ) {
      proformaNavHandled.current = true;

      // Enter create mode
      startNewOrderInternal();

      // Pre-fill form data
      setFormData((prev) => ({
        ...prev,
        branch_code: navState.branchCode || prev.branch_code,
        remarks: navState.remarks || "",
        sales_quote_id: navState.proformaId,
      }));

      // Pre-fill line items from proforma
      const prefilledItems: OrderLineItem[] = navState.items.map(
        (item, idx) => ({
          _id: `proforma-${idx}-${Date.now()}`,
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          warrenty_month: item.warrenty_month || "0",
          remark: item.remark || "",
        }),
      );
      setLineItems(prefilledItems);

      showSuccessToast(
        `Creating PO from Proforma ${navState.proformaNo || ""}. Fill in supplier details and save.`,
      );

      // Clear navigation state to prevent re-triggering
      window.history.replaceState({}, document.title);
    }
  }, [location.state, startNewOrderInternal, setFormData]);

  // Handle navigation from Suppliers page — auto-create PO for supplier
  const supplierNavHandled = useRef(false);
  useEffect(() => {
    const navState = location.state as {
      createPOFromSupplier?: boolean;
      supplierId?: number;
      creditDays?: number;
    } | null;
    
    if (navState?.createPOFromSupplier && navState.supplierId && !supplierNavHandled.current) {
      supplierNavHandled.current = true;
      startNewOrderInternal();
      
      const matchedSupplier = suppliers?.find((s: Supplier) => s.id === navState.supplierId);
      const creditDays = matchedSupplier ? matchedSupplier.credit_days : (navState.creditDays ?? 0);

      setFormData(prev => ({
        ...prev,
        first_suppliers_id: navState.supplierId as number,
        credit_date: creditDays,
      }));
      window.history.replaceState({}, document.title);
    }
  }, [location.state, startNewOrderInternal, setFormData, suppliers]);

  // Check credit limit when supplier or amount changes
  const checkCreditLimit = useCallback(
    async (supplierId: number, amount: number, paymentMethod: string) => {
      if (
        paymentMethod?.toLowerCase() === "credit" &&
        supplierId > 0 &&
        amount > 0
      ) {
        try {
          const creditCheck = await purchaseOrdersApi.checkCredit(
            supplierId,
            amount,
          );

          if (creditCheck.requires_approval) {
            setCreditWarning({
              show: true,
              message: creditCheck.credit_check.message,
              breakdown: creditCheck.credit_check?.breakdown || "",
              requiresApproval: true,
            });
          } else {
            setCreditWarning({
              show: false,
              message: "",
              breakdown: "",
              requiresApproval: false,
            });
          }
        } catch {
          setCreditWarning({
            show: false,
            message: "",
            breakdown: "",
            requiresApproval: false,
          });
        }
      } else {
        setCreditWarning({
          show: false,
          message: "",
          breakdown: "",
          requiresApproval: false,
        });
      }
    },
    [],
  );

  // Calculate total amount from line items
  const totalAmount = useMemo(() => {
    return lineItems.reduce(
      (sum, item) => sum + item.quantity * item.unit_price,
      0,
    );
  }, [lineItems]);

  // Check credit limit when supplier, payment method, or total amount changes
  useEffect(() => {
    if (isCreating && formData.first_suppliers_id && formData.payment_method) {
      checkCreditLimit(
        formData.first_suppliers_id,
        totalAmount,
        formData.payment_method,
      );
    }
  }, [
    isCreating,
    formData.first_suppliers_id,
    formData.payment_method,
    totalAmount,
    checkCreditLimit,
  ]);

  const createMutation = useCrudMutation({
    mutationFn: purchaseOrdersApi.create,
    invalidateQueryKeys: [["purchaseOrders"]],
    successMessage:
      "Purchase order created successfully. Status set to 'Pending Approval' - requires manager approval.",
    errorMessage: "Failed to create purchase order",
    onSuccess: (newOrder) => {
      setIsCreating(false);
      setIsEditing(false);
      setCreditWarning({
        show: false,
        message: "",
        breakdown: "",
        requiresApproval: false,
      });
      setTimeout(() => handleSelectOrderWithItems(newOrder), 0);
    },
  });

  const updateMutation = useCrudMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      purchaseOrdersApi.update(id, data),
    invalidateQueryKeys: [["purchaseOrders"]],
    successMessage: "Purchase order updated successfully",
    errorMessage: "Failed to update purchase order",
    onSuccess: (updatedOrder) => {
      setIsEditing(false);
      setSelectedOrder(updatedOrder);
    },
  });

  const deleteMutation = useCrudMutation({
    mutationFn: (id: number) => purchaseOrdersApi.delete(id),
    invalidateQueryKeys: [["purchaseOrders"]],
    successMessage: "Purchase order deleted successfully",
    errorMessage: "Failed to delete purchase order",
    onSuccess: () => {
      setSelectedOrder(null);
    },
  });

  // Check if order can be deleted (no GRN created)
  const canDelete = !!(
    selectedOrder &&
    !["completed", "partially_completed"].includes(selectedOrder.status?.toLowerCase() || "")
  );

  // Check if order can be edited (no GRN created)
  const canEdit = !!(
    selectedOrder && 
    !["completed", "partially_completed"].includes(selectedOrder.status?.toLowerCase() || "")
  );

  const handleDelete = useCallback(async () => {
    if (canDelete) {
      const confirmed = await confirmDialog.confirm({
        title: "Delete Purchase Order",
        message: `Are you sure you want to delete purchase order "${selectedOrder?.purchasing_order_no}"?`,
        confirmText: "Delete",
        confirmColor: "error",
      });
      if (confirmed && selectedOrder) {
        deleteMutation.mutate(selectedOrder.id);
      }
    } else {
      showErrorToast("Cannot delete a purchase order that has been partially or fully received.");
    }
  }, [selectedOrder, deleteMutation, confirmDialog, canDelete]);

  const handleAddLineItem = () => {
    const newItem: OrderLineItem = {
      _id: `new-${Date.now()}`,
      product_id: 0,
      quantity: 1,
      unit_price: 0,
      warrenty_month: "0",
      remark: "",
    };
    setLineItems([...lineItems, newItem]);
  };

  const handleRemoveLineItem = (id: string) => {
    setLineItems(lineItems.filter((item) => item._id !== id));
  };

  const handleUpdateLineItem = (
    id: string,
    field: keyof OrderLineItem,
    value: any,
  ) => {
    setLineItems(
      lineItems.map((item) =>
        item._id === id ? { ...item, [field]: value } : item,
      ),
    );
  };

  const poSaveInProgressRef = useRef(false);

  const handleSave = useCallback(async () => {
    // Prevent double-submit during async credit-check / confirm-dialog window
    if (poSaveInProgressRef.current || createMutation.isPending || updateMutation.isPending) return;
    poSaveInProgressRef.current = true;
    try {
    const dataToSave: PurchasingOrderCreate = {
      ...formData,
      items: lineItems.map(({ _id, ...item }) => item),
    };

    // Check credit limit if payment method is Credit
    const isCreditPayment = formData.payment_method?.toLowerCase() === "credit";

    if (isCreditPayment && formData.first_suppliers_id) {
      const totalAmount = lineItems.reduce(
        (sum, item) => sum + item.quantity * item.unit_price,
        0,
      );

      try {
        const creditCheck = await purchaseOrdersApi.checkCredit(
          formData.first_suppliers_id,
          totalAmount,
        );

        // Show warning modal if requires approval
        if (creditCheck.requires_approval) {
          const supplier = suppliers?.find(
            (s) => s.id === formData.first_suppliers_id,
          );
          const supplierName = supplier?.company_name || "Unknown";

          const confirmed = await creditWarningDialog.confirm({
            title: "⚠️ Credit Limit Warning",
            message: `Supplier: ${supplierName}\nCredit Limit: Rs. ${fmtLKR(creditCheck.credit_check.max_credit_limit)}\nCurrent Outstanding: Rs. ${fmtLKR(creditCheck.credit_check.current_outstanding)}\nAvailable Credit: Rs. ${fmtLKR(creditCheck.credit_check.available_credit)}\nThis Order: Rs. ${fmtLKR(creditCheck.credit_check.po_value)}\nExceeds by: Rs. ${fmtLKR(creditCheck.credit_check.excess_amount)}\n\n${creditCheck.message}`,
            confirmText: "Continue Anyway",
            cancelText: "Cancel",
            confirmColor: "warning",
          });

          if (!confirmed) {
            return; // User cancelled
          }
        }
      } catch {
        showErrorToast("Failed to check credit limit. Please try again.");
        return; // Stop save if credit check fails
      }
    }

    if (isCreating) {
      createMutation.mutate(dataToSave);
    } else if (selectedOrder) {
      // If order was approved, reset status to pending for re-approval
      const wasApproved = selectedOrder.status?.toLowerCase() === "approved";

      // Send full update data
      const updateData: any = {
        branch_code: formData.branch_code,
        payment_method: formData.payment_method,
        purchasing_order_date: formData.purchasing_order_date || null,
        good_received_note_date: formData.good_received_note_date || null,
        remarks: formData.remarks,
        credit_date: formData.credit_date,
        first_suppliers_id: formData.first_suppliers_id,
        second_suppliers_id: formData.second_suppliers_id,
        items: lineItems.map((item) => ({
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          warrenty_month: item.warrenty_month,
          remark: item.remark,
        })),
      };

      // Reset to pending_approval if was approved
      if (wasApproved) {
        updateData.status = "pending_approval";
        showWarningToast(
          "Order was previously approved. It will need re-approval after this edit.",
        );
      }

      updateMutation.mutate({
        id: selectedOrder.id,
        data: updateData,
      });
    }
    } finally {
      poSaveInProgressRef.current = false;
    }
  }, [
    isCreating,
    selectedOrder,
    formData,
    lineItems,
    createMutation,
    updateMutation,
    suppliers,
  ]);

  const handleDuplicate = useCallback(() => {
    if (selectedOrder) {
      const newFormData = {
        ...resetFormFromOrder(selectedOrder),
        purchasing_order_no: "",
        purchasing_order_date: new Date().toISOString().split("T")[0],
      };
      setFormData(newFormData);
      // Keep line items from current selection
      handleNewOrderBase();
    }
  }, [selectedOrder, setFormData, handleNewOrderBase]);

  // Returns to the browse table from the detail view (the "Back to Purchase
  // Orders" link above the detail header).
  const handleBackToOrders = useCallback(() => {
    setSelectedOrder(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [isCreating, setSelectedOrder, setIsCreating, setIsEditing]);

  const getSupplierName = (order: PurchasingOrder) => {
    if (order.supplier_name) return order.supplier_name;
    const supplier = suppliers?.find((s: Supplier) => s.id === order.first_suppliers_id);
    return supplier ? supplier.company_name : "Unknown";
  };

  // getStatusColor is now imported from common components

  const calculateTotal = () => {
    return lineItems.reduce(
      (sum, item) => sum + item.quantity * item.unit_price,
      0,
    );
  };

  // Validation error messages
  const getFieldError = (fieldName: string): string | undefined => {
    if (!touched[fieldName] && !isCreating) return undefined;

    switch (fieldName) {
      case "purchasing_order_no":
        break;
      case "branch_code":
        if (!formData.branch_code) return "Branch is required";
        break;
      case "first_suppliers_id":
        if (!formData.first_suppliers_id || formData.first_suppliers_id === 0)
          return "Primary supplier is required";
        break;
      case "second_suppliers_id":
        // Secondary supplier is optional
        break;
      case "purchasing_order_date":
        if (!formData.purchasing_order_date) return "Order date is required";
        break;
      case "good_received_note_date":
        if (!formData.good_received_note_date) return "GRN date is required";
        break;
      case "credit_date":
        if ((formData.credit_date ?? 0) < 0)
          return "Credit days cannot be negative";
        break;
      case "lineItems":
        if (lineItems.length === 0) return "At least one item is required";
        break;
    }
    return undefined;
  };

  // Check if a field has an error (for styling)
  const hasError = (fieldName: string): boolean => {
    return !!getFieldError(fieldName);
  };

  // Order Information step validation: Order Information, Dates & Payments, Remarks
  // When creating, purchasing_order_no is auto-generated (nextPONumber) and not stored in formData until submit
  const effectivePONumber = isCreating
    ? nextPONumber
    : formData.purchasing_order_no;
  const isOrderInfoStepValid =
    formData.first_suppliers_id > 0 &&
    effectivePONumber &&
    formData.branch_code;

  // Select Products step validation: at least one line item with a product and quantity chosen
  const isProductsStepValid =
    lineItems.length > 0 &&
    lineItems.every((item) => item.product_id > 0 && item.quantity > 0);

  // Full form validation (both steps)
  const isFormValid =
    isProductsStepValid && isOrderInfoStepValid && !isDailyLimitExceeded;

  const handleNextStep = useCallback(() => {
    if (formStep < FORM_STEPS.length - 1) {
      setFormStep((prev) => prev + 1);
    }
  }, [formStep]);

  const handlePreviousStep = useCallback(() => {
    if (formStep > 0) {
      setFormStep((prev) => prev - 1);
    }
  }, [formStep]);

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const handleExportCSV = async () => {
    try {
      const branchParam = filterBranch ? `&branch_codes=${filterBranch}` : "";

      const response = await apiClient.get<Blob>(
        `/purchasing/export-csv?limit=100000${branchParam}`,
        {
          responseType: "blob",
        },
      );

      const blob = response.data;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const dateStr = new Date().toISOString().split("T")[0];
      const branchStr = filterBranch || "all_branches";
      link.download = `purchase_orders_${branchStr}_${dateStr}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
    }
  };

  // The table sorts by whichever column the user clicks; the Supplier column
  // displays a looked-up name rather than the raw supplier id, so it needs
  // that name as its own field for the grid to sort on correctly.
  const purchaseOrderRows = useMemo(
    () =>
      filteredOrders.map((order) => ({
        ...order,
        supplier_display_name: getSupplierName(order),
      })),
    [filteredOrders, suppliers] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const purchaseOrderColumns: TDataGridColumn<PurchaseOrderRow>[] = useMemo(
    () => [
      {
        field: "favorite",
        header: "",
        width: 48,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<PurchaseOrderRow>) => (
          <IconButton
            size="small"
            onClick={(e) => toggleFavorite(params.row.id, e)}
          >
            {favorites.includes(params.row.id) ? (
              <StarIcon fontSize="small" color="warning" />
            ) : (
              <StarOutlineIcon fontSize="small" color="action" />
            )}
          </IconButton>
        ),
      },
      {
        field: "purchasing_order_no",
        header: "PO Number",
        flex: 1,
        minWidth: 170,
        renderCell: (params: GridRenderCellParams<PurchaseOrderRow>) => (
          <Typography variant="body2" fontWeight={600}>
            {params.row.purchasing_order_no || `PO-${params.row.id}`}
          </Typography>
        ),
      },
      {
        field: "supplier_display_name",
        header: "Supplier",
        flex: 1,
        minWidth: 180,
      },
      {
        field: "branch_code",
        header: "Branch",
        width: 110,
      },
      {
        field: "purchasing_order_date",
        header: "Order Date",
        type: "date",
        width: 130,
      },
      {
        field: "status",
        header: "Status",
        type: "status",
        statusMap: "purchaseOrder",
        width: 150,
      },
      {
        field: "total_amount",
        header: "Total",
        type: "currency",
        width: 140,
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<PurchaseOrderRow>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectOrderWithItems(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [favorites, toggleFavorite, handleSelectOrderWithItems]
  );

  // Whether we're showing a single order's detail view (selected or being
  // created) instead of the browse table.
  const isPurchaseOrderDetailMode = !!selectedOrder || isCreating;

  // Browse mode: a full-width table of every purchase order (shown when
  // nothing is selected and nothing is being created). Sorting is done
  // per-column via the grid's own column header menu, not a separate
  // "Sort by" control.
  const purchaseOrderTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<PurchaseOrderRow>
          rows={purchaseOrderRows}
          columns={purchaseOrderColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectOrderWithItems(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No purchase orders found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Detail mode: a narrow left panel showing only the current order (or the
  // "New Order" placeholder while creating). A "Back to Purchase Orders"
  // link returns to the table.
  const singlePurchaseOrderPanel = (
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
          onClick={handleBackToOrders}
          sx={{ textTransform: "none" }}
        >
          Back to Purchase Orders
        </Button>
      </Box>
      {isCreating ? (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ bgcolor: "primary.main", width: 40, height: 40 }}>
              <ShoppingCartIcon fontSize="small" />
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              New Order
            </Typography>
          </Box>
        </Box>
      ) : selectedOrder && (
        <SelectableListItem
          id={selectedOrder.id}
          isSelected
          onClick={() => {}}
          primaryText={
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
              <Avatar sx={{ bgcolor: "primary.main", width: 40, height: 40 }}>
                <ShoppingCartIcon fontSize="small" />
              </Avatar>
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0 }}>
                <span>{selectedOrder.purchasing_order_no || `PO-${selectedOrder.id}`}</span>
              </Box>
            </Box>
          }
          isFavorite={favorites.includes(selectedOrder.id)}
          onToggleFavorite={(e) => toggleFavorite(selectedOrder.id, e)}
        />
      )}
    </Paper>
  );

  const detailPanel = (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Purchasing", href: "/purchasing" },
          { label: "Purchase Orders", href: "/purchasing/orders" },
          ...(selectedOrder || isCreating
            ? [
                {
                  label: isCreating
                    ? "New Order"
                    : selectedOrder?.purchasing_order_no ||
                      `PO-${selectedOrder?.id}`,
                },
              ]
            : []),
        ]}
        title={
          selectedOrder
            ? selectedOrder.purchasing_order_no || `PO-${selectedOrder.id}`
            : ""
        }
        titleIcon={<ShoppingCartIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Purchase Order"
        noSelectionTitle="Select an Order"
        isFavorite={
          selectedOrder ? favorites.includes(selectedOrder.id) : false
        }
        onToggleFavorite={
          selectedOrder ? (e) => toggleFavorite(selectedOrder.id, e) : undefined
        }
      />

      <ActionToolbar
        hasSelectedItem={!!selectedOrder}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={!!isFormValid}
        onNew={handleNewOrder}
        onDuplicate={handleDuplicate}
        onSave={handleSave}
        onCancel={() => handleCancel(filteredOrders)}
        onEdit={canEdit ? handleStartEdit : undefined}
        onDelete={canDelete ? handleDelete : undefined}
        canDelete={canDelete}
        endActions={
          isCreating && formStep === 0 ? (
            <Button
              size="small"
              variant="contained"
              onClick={handleNextStep}
              disabled={!isProductsStepValid}
              endIcon={<ArrowForwardIcon />}
            >
              Next
            </Button>
          ) :
          selectedOrder && !isCreating && !isEditing ? (
            <Box sx={{ display: "flex", gap: 1 }}>
              <Tooltip title={!canPrintDocument(selectedOrder.status, ["cancelled"]) ? `Cannot email: order is ${(selectedOrder.status || "").replace(/_/g, " ")}` : "Send via Email"}>
                <span>
                  <Button size="small" variant="outlined" color="primary" startIcon={<EmailIcon />}
                    disabled={!canPrintDocument(selectedOrder.status, ["cancelled"])}
                    onClick={() => setEmailDialogOpen(true)}>
                    Email
                  </Button>
                </span>
              </Tooltip>
              <TPrintButton
                documentType="purchase-order"
                documentId={selectedOrder.id}
                disabled={!canPrintDocument(selectedOrder.status, ["cancelled"])}
                disabledReason={`Cannot print: order is ${(selectedOrder.status || "").replace(/_/g, " ")}`}
                onClick={() => handlePrint(selectedOrder.id)}
              />
            </Box>
          ) : undefined
        }
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedOrder && !isCreating ? (
          <EmptyState message="Select a purchase order from the list or create a new one" />
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

            {/* Order Information, Dates & Payments, Remarks (step 2 in create mode; always show in view/edit mode) */}
            {(formStep === 1 || !isCreating) && (
              <>
                {/* Back button in create mode only */}
                {isCreating && (
                  <Button
                    variant="text"
                    onClick={handlePreviousStep}
                    startIcon={<ArrowBackIcon />}
                    sx={{ mb: 2 }}
                  >
                    Back to Select Products
                  </Button>
                )}

                <FormSection title="Order Information" columns={3}>
                  <TextField
                    label="Order Number"
                    size="small"
                    value={
                      isCreating ? nextPONumber : formData.purchasing_order_no
                    }
                    disabled
                  />
                  {/* Searchable Branch Dropdown */}
                  <Autocomplete
                    size="small"
                    options={branches}
                    getOptionLabel={(option) =>
                      `${option.branch_code} - ${option.branch_name}`
                    }
                    value={
                      branches.find(
                        (b) => b.branch_code === formData.branch_code,
                      ) || null
                    }
                    onChange={async (_, newValue) => {
                      const newBranchCode = newValue?.branch_code || "";
                      setFormData({ ...formData, branch_code: newBranchCode });
                      handleBlur("branch_code");

                      // Check daily limit for the selected branch when creating a new order
                      if (isCreating && newBranchCode) {
                        const limitInfo = await checkDailyLimit(newBranchCode);
                        if (limitInfo && !limitInfo.can_create) {
                          setDailyLimitInfo(limitInfo);
                          setDailyLimitWarningOpen(true);
                          setIsDailyLimitExceeded(true);
                        } else {
                          setIsDailyLimitExceeded(false);
                          if (
                            limitInfo &&
                            limitInfo.can_create &&
                            limitInfo.remaining <= 2
                          ) {
                            // Warn if only 1-2 POs remaining
                            showWarningToast(
                              `Only ${limitInfo.remaining} PO(s) remaining for today in this branch`,
                            );
                          }
                        }
                      }
                    }}
                    disabled={!isEditing && !isCreating}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Branch"
                        required
                        error={hasError("branch_code")}
                        helperText={getFieldError("branch_code")}
                      />
                    )}
                  />
                  {/* Searchable Primary Supplier Dropdown */}
                  <Autocomplete
                    size="small"
                    options={suppliers || []}
                    getOptionLabel={(option: Supplier) => {
                      const name = option.company_name;
                      return option.active ? name : `${name} (Inactive)`;
                    }}
                    getOptionDisabled={(option: Supplier) => !option.active}
                    value={
                      suppliers?.find(
                        (s: Supplier) => s.id === formData.first_suppliers_id,
                      ) || null
                    }
                    onChange={async (_, newValue: Supplier | null) => {
                      let computedGrnDate = formData.good_received_note_date;
                      if (newValue?.average_lead_time_days != null) {
                        const base = new Date(
                          `${formData.purchasing_order_date}T00:00:00`,
                        );
                        base.setDate(
                          base.getDate() +
                            Math.round(newValue.average_lead_time_days),
                        );
                        computedGrnDate = base.toISOString().split("T")[0];
                      }
                      setFormData({
                        ...formData,
                        first_suppliers_id: newValue?.id || 0,
                        credit_date:
                          newValue?.credit_days ?? formData.credit_date,
                        good_received_note_date: computedGrnDate,
                      });
                      handleBlur("first_suppliers_id");

                      // Re-price every cart line for the newly chosen supplier:
                      // their listed cost if they carry the product, otherwise
                      // fall back to the product's own default cost price.
                      if (newValue && lineItems.length > 0) {
                        const supplierProducts = await queryClient.fetchQuery({
                          queryKey: ["supplier-products", newValue.id],
                          queryFn: () => suppliersApi.getProducts(newValue.id),
                        });
                        const costByProduct = new Map(
                          supplierProducts.map((sp) => [sp.product_id, sp.cost_price]),
                        );
                        setLineItems((prev) =>
                          prev.map((item) => {
                            if (!item.product_id) return item;
                            const baseCost =
                              products.find((p: any) => p.id === item.product_id)
                                ?.cost_price ?? 0;
                            return {
                              ...item,
                              unit_price: costByProduct.get(item.product_id) ?? baseCost,
                            };
                          }),
                        );
                      }
                    }}
                    disabled={!isEditing && !isCreating}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Primary Supplier"
                        required
                        error={hasError("first_suppliers_id")}
                        helperText={getFieldError("first_suppliers_id")}
                      />
                    )}
                  />
                  {/* Searchable Secondary Supplier Dropdown */}
                  <Autocomplete
                    size="small"
                    options={suppliers || []}
                    getOptionLabel={(option: Supplier) => {
                      const name = option.company_name;
                      return option.active ? name : `${name} (Inactive)`;
                    }}
                    getOptionDisabled={(option: Supplier) => !option.active}
                    value={
                      suppliers?.find(
                        (s: Supplier) => s.id === formData.second_suppliers_id,
                      ) || null
                    }
                    onChange={(_, newValue: Supplier | null) => {
                      setFormData({
                        ...formData,
                        second_suppliers_id: newValue?.id || 0,
                      });
                      handleBlur("second_suppliers_id");
                    }}
                    disabled={!isEditing && !isCreating}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Secondary Supplier"
                        error={hasError("second_suppliers_id")}
                        helperText={getFieldError("second_suppliers_id")}
                      />
                    )}
                  />
                </FormSection>

                {(isCreating || isEditing) &&
                  formData.first_suppliers_id > 0 &&
                  lineItems.some((item) => item.product_id) && (
                    <FormSection title="Price Comparison" columns={1}>
                      <Paper
                        variant="outlined"
                        sx={{
                          overflow: "hidden",
                          borderRadius: 3,
                          border: "1px solid",
                          borderColor: "divider",
                        }}
                      >
                        <Table size="small">
                          <TableHead>
                            <TableRow sx={modernTableStyles.headerRow}>
                              <TableCell>Product</TableCell>
                              <TableCell align="right">Base Cost (Rs.)</TableCell>
                              <TableCell align="right">
                                {(suppliers?.find(
                                  (s: Supplier) => s.id === formData.first_suppliers_id,
                                )?.company_name || "Supplier") + "'s Cost (Rs.)"}
                              </TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {lineItems
                              .filter((item) => item.product_id)
                              .map((item) => {
                                const product = products.find(
                                  (p: any) => p.id === item.product_id,
                                );
                                const mapping = supplierProductMap.get(item.product_id);
                                const baseCost = product?.cost_price ?? 0;
                                return (
                                  <TableRow key={item._id}>
                                    <TableCell>{product?.name || "-"}</TableCell>
                                    <TableCell align="right">{fmtLKR(baseCost)}</TableCell>
                                    <TableCell align="right">
                                      {mapping ? (
                                        fmtLKR(mapping.cost_price)
                                      ) : (
                                        <Typography variant="body2" color="text.secondary">
                                          {fmtLKR(baseCost)} (base)
                                        </Typography>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                          </TableBody>
                        </Table>
                      </Paper>
                    </FormSection>
                  )}

                <FormSection title="Dates & Payment" columns={3}>
                  <TextField
                    label="Order Date"
                    size="small"
                    type="date"
                    value={formData.purchasing_order_date}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        purchasing_order_date: e.target.value,
                      })
                    }
                    onBlur={() => handleBlur("purchasing_order_date")}
                    disabled={!isEditing && !isCreating}
                    InputLabelProps={{ shrink: true }}
                    required
                    error={hasError("purchasing_order_date")}
                    helperText={getFieldError("purchasing_order_date")}
                  />
                  <TextField
                    label="GRN Date"
                    size="small"
                    type="date"
                    value={formData.good_received_note_date}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        good_received_note_date: e.target.value,
                      })
                    }
                    onBlur={() => handleBlur("good_received_note_date")}
                    disabled={!isEditing && !isCreating}
                    InputLabelProps={{ shrink: true }}
                    required
                    error={hasError("good_received_note_date")}
                    helperText={
                      getFieldError("good_received_note_date") ||
                      (isCreating || isEditing
                        ? "Auto-filled from supplier's average lead time"
                        : "")
                    }
                  />
                  <TextField
                    label="Credit Days"
                    size="small"
                    type="number"
                    value={formData.credit_date}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        credit_date: parseInt(e.target.value) || 0,
                      })
                    }
                    onBlur={() => handleBlur("credit_date")}
                    disabled={!isEditing && !isCreating}
                    inputProps={{ min: 0 }}
                    error={hasError("credit_date")}
                    helperText={
                      getFieldError("credit_date") ||
                      (isCreating || isEditing
                        ? "Auto-filled from supplier"
                        : "")
                    }
                  />
                </FormSection>

                {/* Credit Limit Warning */}
                {isCreating && creditWarning.show && (
                  <Alert
                    severity="error"
                    sx={{ mb: 2 }}
                    icon={<WarningAmberIcon />}
                  >
                    <Typography variant="subtitle2" gutterBottom>
                      ⚠️ Credit Limit Exceeded
                    </Typography>
                    <Typography variant="body2">
                      {creditWarning.message}
                    </Typography>
                    {creditWarning.breakdown && (
                      <Typography
                        variant="body2"
                        sx={{
                          mt: 1,
                          fontStyle: "italic",
                          color: "text.secondary",
                        }}
                      >
                        {creditWarning.breakdown}
                      </Typography>
                    )}
                    {creditWarning.requiresApproval && (
                      <Typography
                        variant="body2"
                        sx={{ mt: 1, fontWeight: 500 }}
                      >
                        This purchase order will be set to "Pending Approval"
                        status and require manager approval.
                      </Typography>
                    )}
                  </Alert>
                )}

                {selectedOrder && !isCreating && (
                  <>
                    <FormSection title="Order Status" columns={4}>
                      <Box
                        sx={{ display: "flex", alignItems: "center", gap: 1 }}
                      >
                        <Typography variant="body2" color="text.secondary">
                          Status:
                        </Typography>
                        <TStatusChip
                          status={selectedOrder.status || "draft"}
                          statusMap="purchaseOrder"
                        />
                      </Box>
                    </FormSection>
                    <FormSection
                      title="Tracking"
                      columns={2}
                      titleAction={
                        <Tooltip title="View activity history">
                          <IconButton size="small" onClick={() => setActivityHistoryOpen(true)}>
                            <HistoryIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      }
                    >
                      <TextField
                        label="Created Date"
                        size="small"
                        value={
                          selectedOrder.added_date
                            ? new Date(
                                selectedOrder.added_date,
                              ).toLocaleString()
                            : ""
                        }
                        disabled
                        InputProps={{ readOnly: true }}
                      />
                      <TextField
                        label="Order Date"
                        size="small"
                        value={
                          selectedOrder.created_date
                            ? new Date(
                                selectedOrder.created_date,
                              ).toLocaleDateString()
                            : ""
                        }
                        disabled
                        InputProps={{ readOnly: true }}
                      />
                      <TextField
                        label="Created By"
                        size="small"
                        value={selectedOrder.created_by_name || "-"}
                        disabled
                        InputProps={{ readOnly: true }}
                      />
                      <TextField
                        label="Approved By"
                        size="small"
                        value={selectedOrder.approved_by_name || "-"}
                        disabled
                        InputProps={{ readOnly: true }}
                      />
                    </FormSection>
                  </>
                )}

                <FormSection title="Remarks" columns={1}>
                  <TextField
                    label="Remarks"
                    size="small"
                    value={formData.remarks}
                    onChange={(e) =>
                      setFormData({ ...formData, remarks: e.target.value })
                    }
                    disabled={!isEditing && !isCreating}
                    multiline
                    rows={2}
                  />
                </FormSection>


              </>
            )}

            {/* Order Items (step 1 in create mode; always show in view/edit mode) */}
            {(formStep === 0 || !isCreating) && (
              <>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    mb: 1,
                    mt: isCreating ? 0 : 2,
                  }}
                >
                  <Typography variant="subtitle1" fontWeight="bold">
                    Order Items
                  </Typography>
                  {(isEditing || isCreating) && (
                    <IconButton
                      size="small"
                      onClick={handleAddLineItem}
                      color="primary"
                    >
                      <AddIcon />
                    </IconButton>
                  )}
                </Box>

                {/* Warning for empty items */}
                {(isEditing || isCreating) && lineItems.length === 0 && (
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    At least one item is required to save the order
                  </Alert>
                )}

                <Box>
                  <Paper
                    variant="outlined"
                    sx={{
                      overflow: "hidden",
                      borderRadius: 3,
                      border: "1px solid",
                      borderColor: "divider",
                    }}
                  >
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={modernTableStyles.headerRow}>
                          <TableCell sx={{ minWidth: 200 }}>Product</TableCell>
                          <TableCell align="right" sx={{ width: 100 }}>Quantity</TableCell>
                          <TableCell align="right" sx={{ width: 120 }}>Unit Price (Rs.)</TableCell>
                          <TableCell sx={{ width: 150 }}>Remark</TableCell>
                          <TableCell align="right" sx={{ width: 120 }}>
                            Amount (Rs.)
                          </TableCell>
                          {(isEditing || isCreating) && (
                            <TableCell sx={{ width: 50 }} />
                          )}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {lineItems.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={isEditing || isCreating ? 6 : 5} sx={modernTableStyles.emptyCell}>
                              No items added yet
                            </TableCell>
                          </TableRow>
                        ) : (
                          lineItems.map((item, index) => (
                            <TableRow
                              key={item._id}
                              sx={{
                                ...modernTableStyles.bodyRow,
                                ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                              }}
                            >
                              <TableCell>
                                {isEditing || isCreating ? (
                                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                                    <Box sx={{ display: "flex", gap: 1 }}>
                                      <Autocomplete
                                        size="small"
                                        options={productOptions}
                                        getOptionLabel={(option: any) =>
                                          option.name || ""
                                        }
                                        renderOption={(props, option: any) => {
                                          const mapping = supplierProductMap.get(option.id);
                                          return (
                                            <li {...props} key={option.id}>
                                              <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
                                                <Typography variant="body2" sx={{ flex: 1 }}>{option.name}</Typography>
                                                {mapping && (
                                                  <Tooltip title={`This supplier's cost: Rs. ${mapping.cost_price}${mapping.is_preferred ? " (preferred)" : ""}`}>
                                                    <CheckIcon fontSize="small" color={mapping.is_preferred ? "primary" : "success"} />
                                                  </Tooltip>
                                                )}
                                              </Box>
                                            </li>
                                          );
                                        }}
                                        value={
                                          products?.find(
                                            (p: any) => p.id === item.product_id,
                                          ) || null
                                        }
                                        onChange={(_, newValue: any) => {
                                          const supplierMapping = newValue ? supplierProductMap.get(newValue.id) : undefined;

                                          const updatedItems = lineItems.map(
                                            (lineItem) =>
                                              lineItem._id === item._id
                                                ? {
                                                    ...lineItem,
                                                    product_id: newValue?.id || 0,
                                                    unit_price:
                                                      supplierMapping?.cost_price ?? newValue?.cost_price ?? 0,
                                                  }
                                                : lineItem,
                                          );
                                          setLineItems(updatedItems);
                                        }}
                                        renderInput={(params) => (
                                          <TextField
                                            {...params}
                                            placeholder="Select Product"
                                            size="small"
                                          />
                                        )}
                                        sx={{ minWidth: 180, flexGrow: 1 }}
                                      />
                                      {item.product_id ? (
                                        <Tooltip title="Compare Suppliers">
                                          <IconButton
                                            size="small"
                                            color="primary"
                                            onClick={() => setCompareSuppliersFor({ itemId: item._id, productId: item.product_id })}
                                          >
                                            <CompareArrowsIcon />
                                          </IconButton>
                                        </Tooltip>
                                      ) : null}
                                    </Box>
                                  </Box>
                                ) : (
                                  getProductName(item.product_id)
                                )}
                              </TableCell>
                              <TableCell align="right">
                                {isEditing || isCreating ? (
                                  <TextField
                                    size="small"
                                    type="number"
                                    value={item.quantity}
                                    onChange={(e) =>
                                      handleUpdateLineItem(
                                        item._id,
                                        "quantity",
                                        parseInt(e.target.value) || 0,
                                      )
                                    }
                                    sx={{ width: 80 }}
                                    inputProps={{ min: 0 }}
                                  />
                                ) : (
                                  item.quantity
                                )}
                              </TableCell>
                              <TableCell align="right">
                                {isEditing || isCreating ? (
                                  <TextField
                                    size="small"
                                    type="number"
                                    value={Number(item.unit_price)}
                                    onChange={(e) =>
                                      handleUpdateLineItem(
                                        item._id,
                                        "unit_price",
                                        parseFloat(e.target.value) || 0,
                                      )
                                    }
                                    sx={{ width: 100 }}
                                    inputProps={{ min: 0, step: 0.01 }}
                                  />
                                ) : (
                                  fmtLKR(Number(item.unit_price))
                                )}
                              </TableCell>
                              <TableCell>
                                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                                  {(isEditing || isCreating) ? (
                                    <TextField
                                      size="small"
                                      value={item.remark || ""}
                                      onChange={(e) =>
                                        handleUpdateLineItem(
                                          item._id,
                                          "remark",
                                          e.target.value,
                                        )
                                      }
                                      sx={{ width: 100 }}
                                      placeholder="Remark"
                                    />
                                  ) : (
                                    <Typography
                                      variant="body2"
                                      sx={{
                                        maxWidth: 100,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      {item.remark || "-"}
                                    </Typography>
                                  )}
                                  <Tooltip title="View/Edit Remark">
                                    <IconButton
                                      size="small"
                                      onClick={() =>
                                        handleOpenItemRemarkModal(item)
                                      }
                                      sx={{ ml: 0.5 }}
                                    >
                                      <MenuBookIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                </Box>
                              </TableCell>
                              <TableCell align="right">
                                {fmtLKR(item.quantity * item.unit_price)}
                              </TableCell>
                              {(isEditing || isCreating) && (
                                <TableCell>
                                  <IconButton
                                    size="small"
                                    onClick={() =>
                                      handleRemoveLineItem(item._id)
                                    }
                                    color="error"
                                  >
                                    <DeleteIcon fontSize="small" />
                                  </IconButton>
                                </TableCell>
                              )}
                            </TableRow>
                          ))
                        )}
                        <TableRow sx={modernTableStyles.footerRow}>
                          <TableCell
                            colSpan={4}
                            align="right"
                          >
                            <Typography fontWeight="bold">Total:</Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography fontWeight="bold">
                              {fmtLKR(calculateTotal())}
                            </Typography>
                          </TableCell>
                          {(isEditing || isCreating) && <TableCell />}
                        </TableRow>
                      </TableBody>
                    </Table>
                  </Paper>
                </Box>
              </>
            )}
          </>
        )}
      </Box>
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title="Purchase Orders"
        titleSlot={
          isPurchaseOrderDetailMode ? undefined : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search PO No"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                }}
                sx={{ width: 220, flexShrink: 0 }}
              />
              <Box sx={{ width: 160, flexShrink: 0 }}>
                <TBranchFilter branches={branches} value={filterBranch} onChange={setFilterBranch} label="" placeholder="All Branches" size="small" />
              </Box>
              <Box sx={{ width: 180, flexShrink: 0 }}>
                <TSupplierFilter suppliers={suppliers || []} value={filterSupplier} onChange={setFilterSupplier} label="" placeholder="All Suppliers" size="small" />
              </Box>
              <Box sx={{ width: 170, flexShrink: 0 }}>
                <TStatusFilter options={PO_STATUS_FILTER_OPTIONS} value={filterStatus} onChange={setFilterStatus} label="" placeholder="All Statuses" size="small" />
              </Box>
              {(searchQuery || filterBranch || filterSupplier || filterStatus) && (
                <Tooltip title="Clear filters">
                  <IconButton size="small" onClick={handleClearFilters}>
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          )
        }
        headerActions={
          isPurchaseOrderDetailMode ? undefined : (
            <>
              <Button
                variant="contained"
                size="small"
                startIcon={<AddIcon />}
                onClick={handleNewOrder}
                sx={{ mr: 1 }}
              >
                Add Purchase Order
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<DownloadIcon />}
                onClick={handleExportCSV}
                disabled={filteredOrders.length === 0}
                sx={{ mr: 1 }}
              >
                Export CSV
              </Button>
            </>
          )
        }
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ["purchaseOrders"] });
          queryClient.invalidateQueries({ queryKey: ["suppliers"] });
        }}
        isLoading={isLoading}
        {...(isPurchaseOrderDetailMode
          ? { masterPanel: singlePurchaseOrderPanel, detailPanel }
          : { children: purchaseOrderTablePanel })}
      />

      {/* Item Remark Modal */}
      <Dialog
        open={itemRemarkModalOpen}
        onClose={() => setItemRemarkModalOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <MenuBookIcon />
          Item Remark
        </DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            rows={4}
            label="Remark"
            value={tempItemRemark}
            onChange={(e) => setTempItemRemark(e.target.value)}
            disabled={!isEditing && !isCreating}
            sx={{ mt: 1 }}
            placeholder="Enter remark for this item..."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setItemRemarkModalOpen(false)}>
            {isEditing || isCreating ? "Cancel" : "Close"}
          </Button>
          {(isEditing || isCreating) && (
            <Button variant="contained" onClick={handleSaveItemRemark}>
              Save
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Daily PO Limit Warning Dialog */}
      <Dialog
        open={dailyLimitWarningOpen}
        onClose={() => setDailyLimitWarningOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            color: "error.main",
          }}
        >
          <WarningAmberIcon color="error" />
          Daily PO Limit Reached
        </DialogTitle>
        <DialogContent>
          <Alert severity="error" sx={{ mb: 2 }}>
            {dailyLimitInfo?.message ||
              "You have reached the daily limit for purchase orders in this branch."}
          </Alert>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 2 }}>
            <Typography variant="body2">
              <strong>Branch:</strong> {dailyLimitInfo?.branch_code}
            </Typography>
            <Typography variant="body2">
              <strong>Date:</strong>{" "}
              {dailyLimitInfo?.date
                ? new Date(dailyLimitInfo.date).toLocaleDateString()
                : "Today"}
            </Typography>
            <Typography variant="body2">
              <strong>POs Created Today:</strong> {dailyLimitInfo?.count} /{" "}
              {dailyLimitInfo?.limit}
            </Typography>
            <Typography variant="body2">
              <strong>Remaining:</strong> {dailyLimitInfo?.remaining}
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Please try again tomorrow or contact your manager if you need to
            create additional purchase orders.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            variant="contained"
            onClick={() => setDailyLimitWarningOpen(false)}
          >
            OK
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={compareSuppliersFor !== null}
        onClose={() => setCompareSuppliersFor(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Compare Suppliers</DialogTitle>
        <DialogContent dividers>
          {compareSuppliersLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", p: 3 }}>
              <CircularProgress size={24} />
            </Box>
          ) : !compareSuppliers || compareSuppliers.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No suppliers are mapped to this product yet. Add one from the supplier's own
              Products section.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Supplier</TableCell>
                  <TableCell align="right">Cost Price</TableCell>
                  <TableCell align="right">MOQ</TableCell>
                  <TableCell align="right"> </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {compareSuppliers.map((supplier) => (
                  <TableRow key={supplier.id} hover sx={{ cursor: "pointer" }} onClick={() => handleQuickFillSupplierPrice(supplier)}>
                    <TableCell>
                      {supplier.supplier_company_name || `#${supplier.supplier_id}`}
                      {supplier.is_preferred && (
                        <Typography component="span" variant="caption" color="primary" sx={{ ml: 1 }}>
                          (preferred)
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">Rs. {supplier.cost_price}</TableCell>
                    <TableCell align="right">{supplier.minimum_order_qty ?? "-"}</TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={(e) => { e.stopPropagation(); handleQuickFillSupplierPrice(supplier); }}>
                        Use Price
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCompareSuppliersFor(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Confirm Dialogs */}
      <TConfirmDialog {...confirmDialog.dialogProps} />
      <TConfirmDialog
        {...creditWarningDialog.dialogProps}
        confirmColor="warning"
      />

      {/* Print Preview Dialog */}
      {selectedPoIdForPrint && (
        <TPrintPreviewDialog
          open={printDialogOpen}
          onClose={() => {
            setPrintDialogOpen(false);
            setSelectedPoIdForPrint(null);
          }}
          documentType="purchase-order"
          documentId={selectedPoIdForPrint}
          title={`Print Purchase Order: ${selectedOrder?.purchasing_order_no || ""}`}
        />
      )}

      <TActivityHistoryPanel
        open={activityHistoryOpen}
        onClose={() => setActivityHistoryOpen(false)}
        entityType="purchase_order"
        entityId={selectedOrder?.id}
        actionLabels={{
          create: "Order created",
          approve: "Order approved",
          reject: "Order rejected",
        }}
      />
    </>
  );
}
