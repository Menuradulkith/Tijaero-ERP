/**
 * GoodReceivedNotesPage - Using Tijaero-style reusable components
 * Refactored to use common purchasing components for better code reuse
 * 
 * OPTIMIZED: Uses aggregated reference data endpoint
 * BEFORE: 4 separate API calls (locations, branches, purchaseOrders, grns)
 * AFTER: 3 API calls (reference-data with locations/branches, purchaseOrders, grns)
 */

import { usePermission } from "@/auth/permissions";
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
import SaveIcon from "@mui/icons-material/Save";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
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
  Typography
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";


// Import tijaero components
import {
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  fmtLKR,
  FormSection,
  handleApiError,
  MasterDetailLayout,
  modernTableStyles,
  SearchableList,
  SelectableListItem,
  showErrorToast,
  showSuccessToast,
  SortOption,
  TBranchFilter,
  TConfirmDialog,
  TFilterPanel,
  TPrintButton,
  TPrintPreviewDialog,
  useCrudMutation,
  useMasterDetailState,
  useTConfirmDialog,
} from "@/components/tijaero";

import { useReferenceData } from "@/hooks";
import { locationsApi } from "@/modules/common/api";
import { companyAssetsApi, productsApi, salesStockApi } from "@/modules/inventory/api";
import { Product } from "@/modules/inventory/types";
import { goodReceivedItemsApi, goodReceivedNotesApi, purchaseOrdersApi, suppliersApi } from "@/modules/purchasing/api";
import {
  GoodReceivedItem, GoodReceivedItemCreate, GoodReceivedNote,
  GoodReceivedNoteCreate, PurchasingOrder,
  PurchasingOrderItem,
  PurchasingOrderWithItems, Supplier
} from "@/modules/purchasing/types";
// Currency formatting uses fmtLKR from tijaero
import { formatDateTimeReadable } from "@/utils/formatters";

const SORT_OPTIONS: SortOption[] = [
  { value: "good_received_date", label: "Date" },
  { value: "good_received_no", label: "GRN Number" },
];

const FORM_STEPS = ["GRN Information", "Received Items"];

// Location type for reference data
interface Location {
  id: number;
  name: string;
  branch_code: string;
}

/** Preview next sequential number using same format as backend */
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
  return `${prefix}-${year}-${String(maxSeq + 1).padStart(5, '0')}`;
};

const INITIAL_FORM_DATA: GoodReceivedNoteCreate = {
  good_received_no: "",
  good_received_date: new Date().toISOString().split("T")[0],
  supplier_invoice_no: "",
  supplier_invoice_date: new Date().toISOString().split("T")[0],
  // supplier_invoice fields kept in form data for API compatibility but hidden from UI
  remark: "",
  branch_code: "HQ",
  good_received_locations_id: 1,
  purchasingorders_id: 0,
};

interface GRNLineItem extends GoodReceivedItemCreate {
  _id: string;
  id?: number; // For existing items
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

// Grouped items by product for nice display
interface ProductGroup {
  product_id: number;
  product_name: string;
  unit_price: number;
  total_quantity: number;
  items: GRNLineItem[];
  expanded: boolean;
}

const resetFormFromGRN = (grn: GoodReceivedNote): GoodReceivedNoteCreate => ({
  good_received_no: grn.good_received_no,
  good_received_date: grn.good_received_date?.split("T")[0] || "",
  supplier_invoice_no: grn.supplier_invoice_no,
  supplier_invoice_date: grn.supplier_invoice_date?.split("T")[0] || "",
  remark: grn.remark || "",
  branch_code: grn.branch_code,
  good_received_locations_id: grn.good_received_locations_id,
  purchasingorders_id: grn.purchasingorders_id,
});

export default function GoodReceivedNotesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [lineItems, setLineItems] = useState<GRNLineItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [formStep, setFormStep] = useState(0);
  const [defaultSaveToSalesStock, setDefaultSaveToSalesStock] = useState(true);
  const [defaultSaveToCompanyAssets, setDefaultSaveToCompanyAssets] = useState(false);
  const [productGroups, setProductGroups] = useState<ProductGroup[]>([]);
  const [_products, setProducts] = useState<Product[]>([]);
  const [loadingPOItems, setLoadingPOItems] = useState(false);
  const [activeScanItem, setActiveScanItem] = useState<string | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);

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

  // Filter states
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterSupplier, setFilterSupplier] = useState<number | null>(null);
  const [filterPOId, setFilterPOId] = useState<number | null>(null);
  const [filterCreatedByUser, setFilterCreatedByUser] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem: selectedGRN,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    favorites,
    toggleFavorite,
    formData,
    setFormData,
    handleSelectItem: handleSelectGRN,
    handleNew: handleNewGRNBase,
    handleCancel: handleCancelBase,
    // handleStartEdit removed - GRNs are not editable after creation
  } = useMasterDetailState<GoodReceivedNote, GoodReceivedNoteCreate>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromGRN,
    favoritesKey: "grn_favorites",
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

  // OPTIMIZED: Fetch locations and branches in a single call
  const { data: refData, filteredBranches, defaultBranchCode } = useReferenceData(["locations", "branches"]);

  // Auto-default branch filter for non-superuser users
  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

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
      branch_code: defaultBranchCode || prev.branch_code,
    }));
    setLineItems([]);
    setFormStep(0);
    setTouched({}); // Reset validation state
  }, [handleNewGRNBase, setFormData, defaultBranchCode]);

  // Load GRN items when selecting a GRN
  const loadGRNItems = useCallback(async (grnId: number) => {
    setLoadingItems(true);
    try {
      const items = await goodReceivedItemsApi.getByGRN(grnId);
      setLineItems(items.map((item: GoodReceivedItem) => ({
        ...item,
        _id: `existing-${item.id}`,
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

  // Group items by product for view mode display
  const groupedViewItems = useMemo(() => {
    if (!lineItems.length || isCreating) return [];

    const groups: { [key: string]: { product_name: string; product_id?: number; items: typeof lineItems } } = {};

    lineItems.forEach(item => {
      const key = item.product_name || `PO Item #${item.purchasing_order_items_id}`;
      if (!groups[key]) {
        groups[key] = {
          product_name: key,
          product_id: item.product_id,
          items: [],
        };
      }
      groups[key].items.push(item);
    });

    // Sort by product name
    return Object.values(groups).sort((a, b) => a.product_name.localeCompare(b.product_name));
  }, [lineItems, isCreating]);

  // handleStartEdit removed - GRNs are not editable after creation

  const handleCancel = useCallback((items: GoodReceivedNote[]) => {
    handleCancelBase(items);
    setLineItems([]);
    setFormStep(0);
    setTouched({}); // Reset validation state
  }, [handleCancelBase]);

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
    getNextNumber('GRN', (grns || []).map((g: GoodReceivedNote) => ({ no: g.good_received_no }))),
  [grns]);

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
    const poMap = new Map<number, { id: number; purchasing_order_no: string }>();
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
      const supplierName = suppliers.find(s => s.id === filterSupplier)?.full_name;
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

    filtered.sort((a, b) => {
      if (sortField === "good_received_date") {
        return new Date(b.good_received_date || "").getTime() - new Date(a.good_received_date || "").getTime();
      }
      const fieldA = a[sortField as keyof GoodReceivedNote] || "";
      const fieldB = b[sortField as keyof GoodReceivedNote] || "";
      return String(fieldA).localeCompare(String(fieldB));
    });

    return filtered;
  }, [
    grns,
    searchQuery,
    sortField,
    filterBranch,
    filterSupplier,
    filterPOId,
    filterCreatedByUser,
    purchaseOrders,
    purchaseOrderMap,
  ]);

  // Auto-select first item when data loads
  useEffect(() => {
    if (filteredGRNs.length > 0 && !selectedGRN && !isCreating) {
      handleSelectGRNWithItems(filteredGRNs[0]);
    }
  }, [filteredGRNs, selectedGRN, isCreating]);

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

      // Get items with barcodes to save
      const itemsToSave = lineItems.filter(item => item.barcode);

      if (itemsToSave.length === 0) {
        throw new Error("No items with barcodes to save. Please scan barcodes for items.");
      }

      // Final validation: Check ALL barcodes one more time before saving (critical safety check)
      // Check against ALL three tables: good_received_items, sales_stock, company_assets
      const barcodeValidationPromises = itemsToSave.map(async (item) => {
        try {
          // Check good_received_items first
          const grnResult = await goodReceivedItemsApi.checkBarcodeExists(item.barcode);
          if (grnResult.exists) {
            return { barcode: item.barcode, error: "already exists in GRN Items" };
          }
          // Check sales_stock
          const salesResult = await salesStockApi.checkBarcodeExists(item.barcode);
          if (salesResult.exists) {
            return { barcode: item.barcode, error: "already exists in Sales Stock" };
          }
          // Check company_assets
          const assetsResult = await companyAssetsApi.checkBarcodeExists(item.barcode);
          if (assetsResult.exists) {
            return { barcode: item.barcode, error: "already exists in Company Assets" };
          }
          return null;
        } catch {
          // On API error, treat as potential duplicate (fail-safe)
          return { barcode: item.barcode, error: "validation failed - cannot verify" };
        }
      });

      const validationResults = await Promise.all(barcodeValidationPromises);
      const duplicates = validationResults.filter(r => r !== null);

      if (duplicates.length > 0) {
        const errorMsg = duplicates.map(d => `${d!.barcode} ${d!.error}`).join(", ");
        throw new Error(`Cannot save GRN: Duplicate barcodes found - ${errorMsg}`);
      }

      // First create the GRN (with credit override if authorized)
      const newGRN = await goodReceivedNotesApi.create(data, allowCreditOverride);

      let grnItemCount = 0;
      let salesStockCount = 0;
      let companyAssetCount = 0;

      for (const item of itemsToSave) {
        // Step 1: Always save to good_received_items table first
        await goodReceivedItemsApi.create({
          good_received_note: newGRN.good_received_no,
          barcode: item.barcode,
          branch_code: item.branch_code,
          active: true,
          purchasing_order_items_id: item.purchasing_order_items_id,
        });
        grnItemCount++;

        // Step 2: Then distribute to sales_stock and/or company_assets based on selection

        // Save to sales_stock if selected
        if (item.saveToSalesStock && item.product_id) {
          await salesStockApi.create({
            product_id: item.product_id,
            barcode: item.barcode,
            branch_code: item.branch_code,
            location_id: formData.good_received_locations_id,  // Link to GRN receiving location
            good_received_note_id: newGRN.id,
            purchasing_order_items_id: item.purchasing_order_items_id,
            warranty_month: item.warranty_month || undefined,  // Include warranty from PO or GRN
            status: "available",
          });
          salesStockCount++;
        }

        // Save to company_assets if selected
        if (item.saveToCompanyAssets && item.product_id) {
          await companyAssetsApi.create({
            product_id: item.product_id,
            inventory_no: `INV-${newGRN.good_received_no}-${item.barcode}`,
            item: item.product_name || `Product ${item.product_id}`,
            description: `Received from GRN ${newGRN.good_received_no}`,
            branch_code: item.branch_code,
            barcode: item.barcode,
            warranty_month: item.warranty_month || undefined,  // Include warranty from PO or GRN
            good_received_note_id: newGRN.id,
            purchasing_order_items_id: item.purchasing_order_items_id,
            status: "available",
          });
          companyAssetCount++;
        }
      }

      return { grn: newGRN, grnItemCount, salesStockCount, companyAssetCount };
    },
    invalidateQueryKeys: [["goodReceivedNotes"], ["purchaseOrders"], ["purchase-orders"]],
    errorMessage: "Failed to create GRN",
    showSuccess: false,
    showError: false,
    onSuccess: async ({ grn: newGRN, grnItemCount, salesStockCount, companyAssetCount }) => {
      const messages = [`${grnItemCount} items received`];
      if (salesStockCount > 0) messages.push(`${salesStockCount} to Sales Stock`);
      if (companyAssetCount > 0) messages.push(`${companyAssetCount} to Company Assets`);
      showSuccessToast(`GRN created successfully! ${messages.join(", ")}`);
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

  const handleSave = useCallback((allowCreditOverride = false) => {
    if (isCreating) {
      createMutation.mutate({ data: formData, allowCreditOverride });
    }
    // Update removed - GRNs are not editable after creation
  }, [isCreating, formData, createMutation]);

  // Button click handler that calls handleSave with default parameters
  const handleSaveClick = useCallback(() => {
    handleSave(false);
  }, [handleSave]);

  // Handle credit limit override confirmation
  const handleCreditOverrideConfirm = useCallback(() => {
    if (creditLimitDialog.pendingData) {
      createMutation.mutate({ data: creditLimitDialog.pendingData, allowCreditOverride: true });
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
    return supplier ? supplier.full_name : "Unknown Supplier";
  }, [purchaseOrders, suppliers]);

  const getBranchDisplay = (branchCode: string) => {
    const branch = branchesData?.items?.find((b) => b.branch_code === branchCode);
    return branch ? `${branch.branch_code} - ${branch.branch_name}` : branchCode;
  };

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
        good_received_date: selectedPO.good_received_note_date?.split("T")[0] || new Date().toISOString().split("T")[0],
        good_received_locations_id: selectedLocationId,
      });

      // Load PO items when PO is selected
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
                  receivedCountMap.set(grnItem.purchasing_order_items_id, count + 1);
                }
              });
            } catch {
              // Continue with all items if we can't fetch received items
            }
          }

          // Create line items from PO items - one for each quantity (excluding received items)
          const newLineItems: GRNLineItem[] = [];
          poWithItems.items?.forEach((poItem: PurchasingOrderItem) => {
            const product = allProducts.find((p: Product) => p.id === poItem.product_id);
            const receivedCount = receivedCountMap.get(poItem.id) || 0;
            const remainingQty = poItem.quantity - receivedCount;

            // Only create line items for unreceived quantities
            for (let i = 0; i < remainingQty; i++) {
              newLineItems.push({
                _id: `po-${poItem.id}-${i}`,
                good_received_note: formData.good_received_no,
                barcode: "",
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

  // Function to update product groups from line items
  const updateProductGroups = useCallback((items: GRNLineItem[], productList: Product[]) => {
    const groupMap = new Map<number, ProductGroup>();

    items.forEach((item) => {
      const productId = item.product_id || 0;
      if (groupMap.has(productId)) {
        const group = groupMap.get(productId)!;
        group.items.push(item);
        group.total_quantity++;
      } else {
        const product = productList.find((p: Product) => p.id === productId);
        groupMap.set(productId, {
          product_id: productId,
          product_name: item.product_name || product?.name || `Product ${productId}`,
          unit_price: item.unit_price || 0,
          total_quantity: 1,
          items: [item],
          expanded: true,
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

  // Handle save destination change for individual item
  const handleSaveDestinationChange = (itemId: string, field: "saveToSalesStock" | "saveToCompanyAssets", value: boolean) => {
    setLineItems(items =>
      items.map(item =>
        item._id === itemId ? { ...item, [field]: value } : item
      )
    );
    setProductGroups(groups =>
      groups.map(g => ({
        ...g,
        items: g.items.map(item =>
          item._id === itemId ? { ...item, [field]: value } : item
        ),
      }))
    );
  };

  // Handle default save destination change - updates all items
  const handleDefaultSaveDestinationChange = (field: "saveToSalesStock" | "saveToCompanyAssets", value: boolean) => {
    if (field === "saveToSalesStock") {
      setDefaultSaveToSalesStock(value);
    } else {
      setDefaultSaveToCompanyAssets(value);
    }
    setLineItems(items =>
      items.map(item => ({ ...item, [field]: value }))
    );
    setProductGroups(groups =>
      groups.map(g => ({
        ...g,
        items: g.items.map(item => ({ ...item, [field]: value })),
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
  const allItemsScanned = useMemo(() => {
    return lineItems.length > 0 && lineItems.every(item => item.scanned);
  }, [lineItems]);

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
  const scannedCount = useMemo(() => {
    return lineItems.filter(item => item.scanned).length;
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

  const masterPanel = (
    <SearchableList<GoodReceivedNote>
      items={filteredGRNs}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search GRNs..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedGRN}
      onSelectItem={handleSelectGRNWithItems}
      emptyMessage="No GRNs found"
      listHeader={
        <TFilterPanel>
          <TBranchFilter
            branches={branches}
            value={filterBranch}
            onChange={setFilterBranch}
          />
          <Autocomplete
            size="small"
            options={suppliers}
            getOptionLabel={(option) => option.full_name || ''}
            value={suppliers.find(s => s.id === filterSupplier) || null}
            onChange={(_, newValue) => setFilterSupplier(newValue?.id || null)}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Filter by Supplier"
                placeholder="All Suppliers"
                sx={{ minWidth: 200 }}
              />
            )}
            isOptionEqualToValue={(option, value) => option.id === value.id}
          />
          <Autocomplete
            size="small"
            options={poFilterOptions}
            getOptionLabel={(option: PurchasingOrder) => option.purchasing_order_no || `PO-${option.id}`}
            value={poFilterOptions.find((po: PurchasingOrder) => po.id === filterPOId) || null}
            onChange={(_, newValue) => setFilterPOId(newValue?.id || null)}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Filter by PO"
                placeholder="All POs"
                sx={{ minWidth: 200 }}
              />
            )}
            isOptionEqualToValue={(option, value) => option.id === value.id}
          />
          <Autocomplete
            size="small"
            options={createdByUserOptions}
            value={filterCreatedByUser}
            onChange={(_, newValue) => setFilterCreatedByUser(newValue || null)}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Created by user"
                placeholder="All Users"
                sx={{ minWidth: 200 }}
              />
            )}
            isOptionEqualToValue={(option, value) => option === value}
          />
        </TFilterPanel>
      }
      renderItem={(grn, isSelected) => (
        <SelectableListItem
          key={grn.id}
          id={grn.id}
          isSelected={isSelected}
          onClick={() => handleSelectGRNWithItems(grn)}
          primaryText={
            <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
              {/* GRN Number */}
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{grn.good_received_no || `GRN-${grn.id}`}</span>
                {isSelected && (
                  <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                    (GRN No)
                  </Typography>
                )}
              </Box>
              {/* Additional fields when selected */}
              {isSelected && (
                <>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      {getOrderNumber(grn)}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (PO)
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      {getLocationName(grn.good_received_locations_id)}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Location)
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      {new Date(grn.supplier_invoice_date || grn.good_received_date || "").toLocaleDateString()}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Invoice Date)
                    </Typography>
                  </Box>
                  {/* Status Chips - shown below all fields when selected */}
                  <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                    <Chip
                      label="Received"
                      size="small"
                      color="success"
                      sx={{ height: 18, fontSize: "0.65rem" }}
                    />
                  </Box>
                </>
              )}
            </Box>
          }
          secondaryText={!isSelected ? `PO: ${getOrderNumber(grn)} • ${getLocationName(grn.good_received_locations_id)} • ${new Date(grn.supplier_invoice_date || grn.good_received_date || "").toLocaleDateString()}` : undefined}
          isFavorite={favorites.includes(grn.id)}
          onToggleFavorite={(e) => toggleFavorite(grn.id, e)}
          statusChip={!isSelected ? { label: "Received", color: "success" } : undefined}
        />
      )}
    />
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
        isFavorite={selectedGRN ? favorites.includes(selectedGRN.id) : false}
        onToggleFavorite={selectedGRN ? (e) => toggleFavorite(selectedGRN.id, e) : undefined}
      />

      <ActionToolbar
        hasSelectedItem={!!selectedGRN}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={!!isFormValid}
        onNew={handleNewGRN}
        onSave={handleSaveClick}
        onCancel={() => handleCancel(filteredGRNs)}
        // onEdit disabled - GRNs are not editable after creation
        // onEdit={handleStartEdit}
        endActions={
          isCreating && formStep === 0 ? (
            <Button
              size="small"
              variant="contained"
              onClick={handleNextStep}
              disabled={!isStep1Valid}
              endIcon={<ArrowForwardIcon />}
            >
              Next
            </Button>
          ) : selectedGRN && !isCreating && !isEditing ? (
            <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
              <Button
                size="small"
                variant="outlined"
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
                      />
                    )}
                    isOptionEqualToValue={(option, value) => option.id === value?.id}
                  />
                  <TextField
                    label="GRN Date"
                    size="small"
                    type="date"
                    value={formData.good_received_date}
                    onChange={(e) => setFormData({ ...formData, good_received_date: e.target.value })}
                    onBlur={() => handleBlur('good_received_date')}
                    disabled={!isEditing && !isCreating}
                    InputLabelProps={{ shrink: true }}
                    required
                    error={hasError('good_received_date')}
                    helperText={getFieldError('good_received_date')}
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
                  />
                </FormSection>

                <FormSection title="Remarks" columns={1}>
                  <TextField
                    label="Remarks"
                    size="small"
                    value={formData.remark}
                    onChange={(e) => setFormData({ ...formData, remark: e.target.value })}
                    disabled={!isEditing && !isCreating}
                    multiline
                    rows={2}
                  />
                </FormSection>

              </>
            )}

            {/* Step 2: Received Items (always show in view/edit mode, step 2 in create mode) */}
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
                    Back to GRN Information
                  </Button>
                )}

                {/* Loading PO items indicator */}
                {loadingPOItems && (
                  <Box sx={{ mb: 2 }}>
                    <Alert severity="info" sx={{ mb: 1 }}>
                      Loading purchase order items...
                    </Alert>
                    <LinearProgress />
                  </Box>
                )}

                {/* Save Destination Checkboxes - Sales Stock / Company Assets */}
                {isCreating && lineItems.length > 0 && (
                  <Box sx={{ mb: 3 }}>
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                      Save Items To (applies to all items - you can select both)
                    </Typography>
                    <Paper variant="outlined" sx={{ p: 2 }}>
                      <FormGroup row>
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={defaultSaveToSalesStock}
                              onChange={(e) => handleDefaultSaveDestinationChange("saveToSalesStock", e.target.checked)}
                              color="success"
                            />
                          }
                          label={
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                              <InventoryIcon color="success" />
                              <Typography>Sales Stock</Typography>
                            </Box>
                          }
                        />
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={defaultSaveToCompanyAssets}
                              onChange={(e) => handleDefaultSaveDestinationChange("saveToCompanyAssets", e.target.checked)}
                              color="info"
                            />
                          }
                          label={
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                              <BusinessIcon color="info" />
                              <Typography>Company Assets</Typography>
                            </Box>
                          }
                        />
                      </FormGroup>
                      {!defaultSaveToSalesStock && !defaultSaveToCompanyAssets && (
                        <Alert severity="warning" sx={{ mt: 1 }}>
                          Please select at least one destination for the items
                        </Alert>
                      )}
                    </Paper>
                  </Box>
                )}

                {/* Progress indicator */}
                {isCreating && lineItems.length > 0 && (
                  <Box sx={{ mb: 2 }}>
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                      <Typography variant="body2" color="text.secondary">
                        Scanning Progress
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {scannedCount} / {lineItems.length} items scanned
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={(scannedCount / lineItems.length) * 100}
                      sx={{
                        height: 8,
                        borderRadius: 4,
                        bgcolor: 'grey.200',
                        '& .MuiLinearProgress-bar': {
                          bgcolor: allItemsScanned ? 'success.main' : 'primary.main',
                        }
                      }}
                    />
                    {allItemsScanned && (
                      <Alert severity="success" sx={{ mt: 1 }} icon={<CheckCircleIcon />}>
                        All items scanned! Ready to save.
                      </Alert>
                    )}
                  </Box>
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
                    {productGroups.map((group) => (
                      <Card
                        key={group.product_id}
                        variant="outlined"
                        sx={{
                          borderLeft: 4,
                          borderLeftColor: group.items.every(i => i.scanned) ? 'success.main' : 'primary.main'
                        }}
                      >
                        {/* Product Header */}
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            p: 1.5,
                            bgcolor: "action.hover",
                            cursor: "pointer",
                          }}
                          onClick={() => toggleProductGroup(group.product_id)}
                        >
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <InventoryIcon color="primary" />
                            <Box>
                              <Typography variant="subtitle1" fontWeight="bold">
                                {group.product_name}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                Rs. {fmtLKR(group.unit_price)} per unit • Qty: {group.total_quantity} • Branch: {group.items[0]?.branch_code} • PO Item ID: {group.items[0]?.purchasing_order_items_id}
                              </Typography>
                            </Box>
                          </Box>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <Chip
                              label={`${group.items.filter(i => i.scanned).length}/${group.total_quantity} scanned`}
                              size="small"
                              color={group.items.every(i => i.scanned) ? "success" : "default"}
                            />
                            <IconButton size="small">
                              {group.expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                            </IconButton>
                          </Box>
                        </Box>

                        {/* Individual Items for barcode scanning */}
                        <Collapse in={group.expanded}>
                          <Divider />
                          <CardContent sx={{ p: 1 }}>
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
                                  <Chip
                                    label={`#${index + 1}`}
                                    size="small"
                                    sx={{ minWidth: 40 }}
                                    color={item.scanned ? "success" : "default"}
                                  />
                                </Box>

                                {/* Barcode and Actions Row */}
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

                                  {/* Save Destination Checkboxes */}
                                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                                    <Checkbox
                                      checked={item.saveToSalesStock}
                                      onChange={(e) => handleSaveDestinationChange(item._id, "saveToSalesStock", e.target.checked)}
                                      size="small"
                                      color="success"
                                      title="Sales Stock"
                                      icon={<InventoryIcon fontSize="small" />}
                                      checkedIcon={<InventoryIcon fontSize="small" />}
                                      sx={{
                                        p: 0.5,
                                        '&.Mui-checked': { color: 'success.main' }
                                      }}
                                    />
                                    <Checkbox
                                      checked={item.saveToCompanyAssets}
                                      onChange={(e) => handleSaveDestinationChange(item._id, "saveToCompanyAssets", e.target.checked)}
                                      size="small"
                                      color="info"
                                      title="Company Assets"
                                      icon={<BusinessIcon fontSize="small" />}
                                      checkedIcon={<BusinessIcon fontSize="small" />}
                                      sx={{
                                        p: 0.5,
                                        '&.Mui-checked': { color: 'info.main' }
                                      }}
                                    />
                                  </Box>

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
                              </Box>
                            ))}
                          </CardContent>
                        </Collapse>
                      </Card>
                    ))}

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
                ) : (
                  /* View/Edit mode - Table layout */
                  <Box>
                    <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
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
                                      <Chip size="small" label="Sales Stock" color="success" icon={<InventoryIcon />} />
                                    )}
                                    {item.saveToCompanyAssets && (
                                      <Chip size="small" label="Company Asset" color="info" icon={<BusinessIcon />} />
                                    )}
                                  </Box>
                                </TableCell>
                                <TableCell>{item.branch_code}</TableCell>
                                <TableCell align="center">
                                  <Chip size="small" label={item.active ? "Yes" : "No"} color={item.active ? "success" : "default"} />
                                </TableCell>
                                <TableCell>
                                  <IconButton size="small" onClick={() => handleRemoveLineItem(item._id)} color="error">
                                    <DeleteIcon fontSize="small" />
                                  </IconButton>
                                </TableCell>
                              </TableRow>
                            ))
                          ) : (
                            // View mode - grouped by product
                            groupedViewItems.map((group) => (
                              <>
                                {/* Product group header */}
                                <TableRow key={`group-${group.product_name}`} sx={{ bgcolor: "action.hover" }}>
                                  <TableCell colSpan={6}>
                                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                      <InventoryIcon fontSize="small" color="primary" />
                                      <Typography variant="subtitle2" fontWeight="bold">
                                        {group.product_name}
                                      </Typography>
                                      <Chip size="small" label={`${group.items.length} items`} />
                                    </Box>
                                  </TableCell>
                                </TableRow>
                                {/* Items in this group */}
                                {group.items.map((item) => (
                                  <TableRow key={item._id} sx={{ "&:last-child td": { borderBottom: 0 } }}>
                                    <TableCell sx={{ pl: 4 }}>{item.barcode}</TableCell>
                                    <TableCell>
                                      <Typography variant="body2" color="text.secondary">
                                        {item.product_name}
                                      </Typography>
                                    </TableCell>
                                    <TableCell>{item.warranty_month ? `${item.warranty_month} mo` : "—"}</TableCell>
                                    <TableCell>
                                      <Box sx={{ display: "flex", gap: 0.5 }}>
                                        {item.saveToSalesStock && (
                                          <Chip size="small" label="Sales Stock" color="success" icon={<InventoryIcon />} />
                                        )}
                                        {item.saveToCompanyAssets && (
                                          <Chip size="small" label="Company Asset" color="info" icon={<BusinessIcon />} />
                                        )}
                                        {!item.saveToSalesStock && !item.saveToCompanyAssets && (
                                          <Typography variant="body2" color="text.secondary">—</Typography>
                                        )}
                                      </Box>
                                    </TableCell>
                                    <TableCell>{item.branch_code}</TableCell>
                                    <TableCell align="center">
                                      <Chip size="small" label={item.active ? "Yes" : "No"} color={item.active ? "success" : "default"} />
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </Paper>
                  </Box>
                )}
              </>
            )}
          </>
        )}

        {/* Record Information (view mode only) */}
        {selectedGRN && !isCreating && !isEditing && (
          <FormSection title="Record Information" columns={2}>
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
      <MasterDetailLayout
        title="Good Received Notes"
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ["goodReceivedNotes"] });
          queryClient.invalidateQueries({ queryKey: ["purchaseOrders"] });
        }}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
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
          <Button onClick={handleCreditDialogClose} color="inherit">
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
    </>
  );
}
