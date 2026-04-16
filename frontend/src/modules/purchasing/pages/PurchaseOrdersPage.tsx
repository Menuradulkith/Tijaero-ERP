/**
 * PurchaseOrdersPage - Using Tijaero-style reusable components
 * Refactored to use common tijaero components for better code reuse
 */

// Confirm dialog now uses TConfirmDialog from tijaero
import apiClient from "@/api/client";
import { FileDownload as DownloadIcon } from "@mui/icons-material";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import DeleteIcon from "@mui/icons-material/Delete";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
// Import tijaero components
import {
    ActionToolbar,
    canPrintDocument,
    DetailPanelHeader,
    EmptyState,
    fmtLKR,
    FormSection,
    getStatusProps,
    handleApiError,
    MasterDetailLayout,
    modernTableStyles,
    PURCHASING_PAYMENT_METHOD,
    SearchableList,
    SelectableListItem,
    showErrorToast,
    showSuccessToast,
    showWarningToast,
    SortOption,
    TBranchFilter,
    TConfirmDialog,
    TFilterPanel,
    TPrintButton,
    TPrintPreviewDialog,
    TStatusChip,
    TSupplierFilter,
    useMasterDetailState,
    useTConfirmDialog,
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
} from "@/modules/purchasing/types";

import { useAuthStore } from "@/state/authStore";
import { hasPermission, PERMISSIONS } from "@/auth/permissions";

const SORT_OPTIONS: SortOption[] = [
  { value: "added_date", label: "Date" },
  { value: "purchasing_order_no", label: "Order Number" },
];

// Status options are now imported from common components (PO_STATUS_OPTIONS)

const FORM_STEPS = ["Order Information", "Order Items"];

/** Preview the next sequential number using the same format as the backend */
const getNextNumber = (prefix: string, existing: { no: string }[]): string => {
  const year = new Date().getFullYear();
  const fullPrefix = `${prefix}-${year}-`;
  let maxSeq = 0;
  for (const item of existing) {
    if (item.no?.startsWith(fullPrefix)) {
      const seq = parseInt(item.no.slice(fullPrefix.length), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }
  return `${prefix}-${year}-${String(maxSeq + 1).padStart(5, "0")}`;
};

// Extended form type to include editable status fields
interface PurchaseOrderFormData extends PurchasingOrderCreate {
  status?: string;
}

const INITIAL_FORM_DATA: PurchaseOrderFormData = {
  purchasing_order_no: "",
  branch_code: "",
  payment_method: "Cash",
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

const resetFormFromOrder = (
  order: PurchasingOrder | PurchasingOrderWithItems,
): PurchaseOrderFormData => ({
  purchasing_order_no: order.purchasing_order_no,
  branch_code: order.branch_code,
  payment_method: order.payment_method,
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
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const canApprovePO = hasPermission(
    user,
    PERMISSIONS.PO_APPROVALS_APPROVE.resource,
    PERMISSIONS.PO_APPROVALS_APPROVE.action
  );

  const [lineItems, setLineItems] = useState<OrderLineItem[]>([]);
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

  // Filter states
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterSupplier, setFilterSupplier] = useState<number | null>(null);

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
    sortField,
    setSortField,
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

  const handleCancel = useCallback(
    (items: PurchasingOrder[]) => {
      handleCancelBase(items);
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
    [handleCancelBase],
  );

  // Handler that wraps hook's handler (which already handles unsaved changes confirm)
  const handleSelectOrderWithItems = useCallback(
    async (order: PurchasingOrder) => {
      const selected = await handleSelectOrder(order);
      if (!selected) return; // User cancelled

      // Load detailed items after selection
      setTouched({});
      try {
        const detailedOrder = await purchaseOrdersApi.getById(order.id);
        if (detailedOrder.items) {
          setLineItems(
            detailedOrder.items.map((item, idx) => ({
              _id: `existing-${idx}`,
              product_id: item.product_id,
              quantity: item.quantity,
              unit_price: item.unit_price,
              warrenty_month: item.warrenty_month || "0",
              remark: item.remark || "",
            })),
          );
        } else {
          setLineItems([]);
        }
      } catch {
        setLineItems([]);
      }
    },
    [handleSelectOrder],
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

  // Auto-default branch filter for non-superuser users
  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // branchResolved: true once we've either confirmed no default branch exists, or the filter has been set
  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  const { data: orders, isLoading } = useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: () => purchaseOrdersApi.getAll(),
    enabled: branchResolved,
  });

  const nextPONumber = useMemo(() => getNextNumber('PO', (orders || []).map((o: PurchasingOrder) => ({ no: o.purchasing_order_no }))), [orders]);

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

    filtered.sort((a, b) => {
      if (sortField === "added_date") {
        return (
          new Date(b.added_date || "").getTime() -
          new Date(a.added_date || "").getTime()
        );
      }
      const fieldA = a[sortField as keyof PurchasingOrder] || "";
      const fieldB = b[sortField as keyof PurchasingOrder] || "";
      return String(fieldA).localeCompare(String(fieldB));
    });

    return filtered;
  }, [orders, searchQuery, sortField, filterBranch, filterSupplier]);

  // Auto-select first item when data loads
  useEffect(() => {
    if (filteredOrders.length > 0 && !selectedOrder && !isCreating) {
      handleSelectOrderWithItems(filteredOrders[0]);
    }
  }, [filteredOrders, selectedOrder, isCreating]);

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
    } | null;
    
    if (navState?.createPOFromSupplier && navState.supplierId && !supplierNavHandled.current) {
      supplierNavHandled.current = true;
      startNewOrderInternal();
      setFormData(prev => ({
        ...prev,
        first_suppliers_id: navState.supplierId as number,
      }));
      window.history.replaceState({}, document.title);
    }
  }, [location.state, startNewOrderInternal, setFormData]);

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

  const createMutation = useMutation({
    mutationFn: purchaseOrdersApi.create,
    onSuccess: (newOrder) => {
      queryClient.invalidateQueries({ queryKey: ["purchaseOrders"] });

      // All orders are created with pending_approval status
      showSuccessToast(
        "Purchase order created successfully. Status set to 'Pending Approval' - requires manager approval.",
      );

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
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to create purchase order"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      purchaseOrdersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchaseOrders"] });
      showSuccessToast("Purchase order updated successfully");
      setIsEditing(false);
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to update purchase order"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => purchaseOrdersApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchaseOrders"] });
      showSuccessToast("Purchase order deleted successfully");
      setSelectedOrder(null);
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to delete purchase order"));
    },
  });

  const handleDelete = useCallback(async () => {
    if (
      selectedOrder &&
      selectedOrder.status?.toLowerCase() !== "approved" &&
      selectedOrder.status?.toLowerCase() !== "completed"
    ) {
      const confirmed = await confirmDialog.confirm({
        title: "Delete Purchase Order",
        message: `Are you sure you want to delete purchase order "${selectedOrder.purchasing_order_no}"?`,
        confirmText: "Delete",
        confirmColor: "error",
      });
      if (confirmed) {
        deleteMutation.mutate(selectedOrder.id);
      }
    } else {
      showErrorToast("Cannot delete an approved or completed purchase order");
    }
  }, [selectedOrder, deleteMutation, confirmDialog]);

  // Check if order can be deleted (not approved or completed)
  const canDelete = !!(
    selectedOrder &&
    selectedOrder.status?.toLowerCase() !== "approved" &&
    selectedOrder.status?.toLowerCase() !== "completed"
  );

  // Check if order can be edited (any status except completed)
  const canEdit = !!(
    selectedOrder && selectedOrder.status?.toLowerCase() !== "completed"
  );

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

  const handleSave = useCallback(async () => {
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
          const supplierName =
            supplier?.company_name || supplier?.full_name || "Unknown";

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

  const getSupplierName = (supplierId: number) => {
    const supplier = suppliers?.find((s: Supplier) => s.id === supplierId);
    return supplier ? supplier.full_name : "Unknown";
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
        if (!formData.second_suppliers_id || formData.second_suppliers_id === 0)
          return "Secondary supplier is required";
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

  // Step 1 validation: Order Information, Dates & Payments, Remarks
  // When creating, purchasing_order_no is auto-generated (nextPONumber) and not stored in formData until submit
  const effectivePONumber = isCreating
    ? nextPONumber
    : formData.purchasing_order_no;
  const isStep1Valid =
    formData.first_suppliers_id > 0 &&
    formData.second_suppliers_id > 0 &&
    effectivePONumber &&
    formData.branch_code;

  // Full form validation (both steps)
  const isFormValid = isStep1Valid && lineItems.length > 0;

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

  const masterPanel = (
    <SearchableList<PurchasingOrder>
      items={filteredOrders}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search orders..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedOrder}
      onSelectItem={handleSelectOrderWithItems}
      emptyMessage="No purchase orders found"
      listHeader={
        <TFilterPanel>
          <TBranchFilter
            branches={branches}
            value={filterBranch}
            onChange={setFilterBranch}
          />
          <TSupplierFilter
            suppliers={suppliers || []}
            value={filterSupplier}
            onChange={setFilterSupplier}
          />
        </TFilterPanel>
      }
      renderItem={(order, isSelected) => (
        <SelectableListItem
          key={order.id}
          id={order.id}
          isSelected={isSelected}
          onClick={() => handleSelectOrderWithItems(order)}
          primaryText={
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                width: "100%",
                gap: 0.5,
              }}
            >
              {/* PO Number */}
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>{order.purchasing_order_no || `PO-${order.id}`}</span>
                {isSelected && (
                  <Typography
                    component="span"
                    variant="caption"
                    sx={{ color: "inherit", opacity: 0.7 }}
                  >
                    (PO No)
                  </Typography>
                )}
              </Box>
              {/* Additional fields when selected */}
              {isSelected && (
                <>
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Typography component="span" variant="caption">
                      {getSupplierName(order.first_suppliers_id)}
                    </Typography>
                    <Typography
                      component="span"
                      variant="caption"
                      sx={{ color: "inherit", opacity: 0.7 }}
                    >
                      (Supplier)
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Typography component="span" variant="caption">
                      {new Date(
                        order.purchasing_order_date || "",
                      ).toLocaleDateString()}
                    </Typography>
                    <Typography
                      component="span"
                      variant="caption"
                      sx={{ color: "inherit", opacity: 0.7 }}
                    >
                      (Date)
                    </Typography>
                  </Box>
                  {/* Status Chips - shown below all fields when selected */}
                  <Box
                    sx={{
                      display: "flex",
                      gap: 0.5,
                      mt: 0.5,
                      flexWrap: "wrap",
                    }}
                  >
                    <TStatusChip
                      status={order.status || "draft"}
                      statusMap="purchaseOrder"
                      size="small"
                    />
                  </Box>
                </>
              )}
            </Box>
          }
          secondaryText={
            !isSelected
              ? `${getSupplierName(order.first_suppliers_id)} - ${new Date(order.purchasing_order_date || "").toLocaleDateString()}`
              : undefined
          }
          isFavorite={favorites.includes(order.id)}
          onToggleFavorite={(e) => toggleFavorite(order.id, e)}
          statusChip={
            !isSelected
              ? {
                  label: getStatusProps(
                    order.status || "draft",
                    "purchaseOrder",
                  ).label,
                  color: getStatusProps(
                    order.status || "draft",
                    "purchaseOrder",
                  ).color,
                }
              : undefined
          }
        />
      )}
    />
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
              disabled={!isStep1Valid || isDailyLimitExceeded}
              endIcon={<ArrowForwardIcon />}
            >
              Next
            </Button>
          ) :
          selectedOrder && !isCreating && !isEditing ? (
            <Box sx={{ display: "flex", gap: 1 }}>
              {canApprovePO && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<FactCheckIcon />}
                  onClick={() => navigate("/purchasing/approvals/po-approvals")}
                >
                  PO Approvals
                </Button>
              )}
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

            {/* Step 1: Order Information, Dates & Payments, Remarks (always show in view/edit mode) */}
            {(formStep === 0 || !isCreating) && (
              <>
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
                      const name = option.company_name
                        ? `${option.full_name} (${option.company_name})`
                        : option.full_name;
                      return option.active ? name : `${name} (Inactive)`;
                    }}
                    getOptionDisabled={(option: Supplier) => !option.active}
                    value={
                      suppliers?.find(
                        (s: Supplier) => s.id === formData.first_suppliers_id,
                      ) || null
                    }
                    onChange={(_, newValue: Supplier | null) => {
                      setFormData({
                        ...formData,
                        first_suppliers_id: newValue?.id || 0,
                        credit_date:
                          newValue?.credit_days ?? formData.credit_date,
                      });
                      handleBlur("first_suppliers_id");
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
                      const name = option.company_name
                        ? `${option.full_name} (${option.company_name})`
                        : option.full_name;
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
                        required
                        error={hasError("second_suppliers_id")}
                        helperText={getFieldError("second_suppliers_id")}
                      />
                    )}
                  />
                  <TextField
                    select
                    label="Payment Method"
                    size="small"
                    value={formData.payment_method}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        payment_method: e.target.value,
                      })
                    }
                    disabled={!isEditing && !isCreating}
                  >
                    {PURCHASING_PAYMENT_METHOD.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </TextField>
                </FormSection>

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
                    helperText={getFieldError("good_received_note_date")}
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
                    <FormSection title="Tracking" columns={2}>
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

            {/* Step 2: Order Items (always show in view/edit mode, step 2 in create mode) */}
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
                    Back to Order Information
                  </Button>
                )}

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
                      borderRadius: 2,
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
                                  <Autocomplete
                                    size="small"
                                    options={products || []}
                                    getOptionLabel={(option: any) =>
                                      option.name || ""
                                    }
                                    value={
                                      products?.find(
                                        (p: any) => p.id === item.product_id,
                                      ) || null
                                    }
                                    onChange={(_, newValue: any) => {
                                      // Set product_id and automatically populate unit_price from cost_price
                                      const updatedItems = lineItems.map(
                                        (lineItem) =>
                                          lineItem._id === item._id
                                            ? {
                                                ...lineItem,
                                                product_id: newValue?.id || 0,
                                                unit_price:
                                                  newValue?.cost_price || 0,
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
                                    sx={{ minWidth: 180 }}
                                  />
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
                                    value={item.unit_price}
                                    disabled
                                    sx={{
                                      width: 100,
                                      "& .MuiInputBase-input.Mui-disabled": {
                                        WebkitTextFillColor:
                                          "rgba(0, 0, 0, 0.87)",
                                        color: "rgba(0, 0, 0, 0.87)",
                                      },
                                    }}
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
                            colSpan={isEditing || isCreating ? 5 : 5}
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
        headerActions={
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
        }
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ["purchaseOrders"] });
          queryClient.invalidateQueries({ queryKey: ["suppliers"] });
        }}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
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
    </>
  );
}
