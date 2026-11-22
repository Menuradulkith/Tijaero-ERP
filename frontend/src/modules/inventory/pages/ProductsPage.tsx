import { usePermission } from "@/auth/permissions";
import {
  TChip,
    ActionToolbar,
    continueOrReveal,
    DetailPanelHeader,
    EmptyState,
    fmtLKR,
    FormSection,
    MasterDetailLayout,
    PRODUCT_TRACKING_TYPE,
    PRODUCT_UOM,
    showErrorToast,
    TabConfig,
    TAutocomplete,
    TConfirmDialog,
    TDataGrid,
    type TDataGridColumn,
    TTabs,
    TTabPanel,
    type TTabConfig,
    TStatusFilter,
    useConfirmDialog,
  useCrudMutation,
    useMasterDetailState,
    TActivityHistoryPanel,
} from "@/components/tijaero";
import { formatDateTimeReadable } from "@/utils/formatters";
import { useCurrencyStore } from "@/state/currencyStore";
import {
    Add as AddIcon,
    ArrowBack as ArrowBackIcon,
    AttachMoney as PricingIcon,
    Sell as BrandIcon,
    Category as CategoryIcon,
    DesignServicesOutlined as DesignBriefIcon,
    Straighten as DesignDetailIcon,
    AccountTreeOutlined as BomStructureIcon,
    History as HistoryIcon,
    Inventory as InventoryIcon,
    Search as SearchIcon,
    OpenInNew as OpenInNewIcon,
} from "@mui/icons-material";
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
  import type { GridRenderCellParams } from "@mui/x-data-grid";
  import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
  import type { GridPaginationModel } from "@mui/x-data-grid";
  import { useDebounce } from "@/hooks";
import { fetchAllPages } from "@/utils/fetchAllPages";
import axios from "axios";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import { materialsApi } from "@/modules/materials/api";
import { brandsApi, categoriesApi, minimumPriceApi, productImageUrl, productsApi } from "../api";
import ProductImageUploader from "../components/ProductImageUploader";
import { useProductDesignBrief } from "../components/ProductDesignBrief";
import { useProductDesignDetail } from "../components/ProductDesignDetail";
import { useProductBomStructure } from "../components/ProductBomStructure";
import QuickCreateLookupDialog, { type LookupKind } from "../components/QuickCreateLookupDialog";
import { hsCodesApi, productTypesApi } from "../api";
import {
    Brand,
    BrandCreate,
    BrandUpdate,
    Category,
    CategoryCreate,
    CategoryUpdate,
    Product,
    ProductCreate,
    ProductUpdate,
} from "../types";

// A 409 from an update is either "someone else saved this record since you
// loaded it" (expected_updated_at mismatch) or a duplicate name/code. Only
// the first should reload the record — for a duplicate, the user's edits are
// still wanted. Telling them apart: the server's version token moved on.
const isStaleConflict = (sentVersion: string | undefined, freshVersion: string | undefined) =>
  !!sentVersion && !!freshVersion && sentVersion !== freshVersion;

const isConflict = (error: unknown) =>
  axios.isAxiosError(error) && error.response?.status === 409;

// 404 on save = someone deleted the record while it was open here.
const isNotFound = (error: unknown) =>
  axios.isAxiosError(error) && error.response?.status === 404;

const PRODUCT_DETAIL_TABS: TTabConfig[] = [
  { id: "general", label: "General", icon: <InventoryIcon fontSize="small" /> },
  { id: "pricing", label: "Pricing", icon: <PricingIcon fontSize="small" /> },
  { id: "designBrief", label: "Design Brief", icon: <DesignBriefIcon fontSize="small" /> },
  { id: "designDetail", label: "Design Detail", icon: <DesignDetailIcon fontSize="small" /> },
  { id: "bomStructure", label: "BOM Structure", icon: <BomStructureIcon fontSize="small" /> },
];

const PRODUCT_ACTIVE_FILTER_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

// Same bounds as the API's _Price
const MAX_PRICE = 999_999_999_999.99;
const priceError = (v: unknown): string | null => {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v < 0) return "Cannot be negative";
  if (v > MAX_PRICE) return "Too large";
  if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) return "Use at most 2 decimals";
  return null;
};

const toleranceError = (v: unknown): string | null =>
  typeof v === "number" && (v < 0 || v > 100) ? "Enter 0 to 100" : null;

// Shelf life is optional; when set it must be a whole number of days, 1 to 3650.
const shelfLifeError = (v: number | null | undefined): string | null =>
  v == null ? null : !Number.isInteger(v) || v < 1 || v > 3650 ? "Enter a whole number from 1 to 3650" : null;

// Initial form data
const emptyProductForm: ProductCreate = {
  name: "",
  model: "",
  item_type: "inventory",
  unit_of_measure: "pcs",
  // Not pre-selected: the user must choose how the product is tracked.
  tracking_type: "" as ProductCreate["tracking_type"],
  over_receipt_tolerance_pct: 0,
  under_receipt_tolerance_pct: 0,
  shelf_life_days: null,
  requires_qc: false,
  description: "",
  website_active: false,
  website_price: undefined,
  selling_price: undefined,
  active: true,
  cost_price: undefined,
  tax_rate: 0,
  category_id: 0,
  items_brand_id: 0,
  // General section: chosen by the user (product type / HS code / family are mandatory).
  product_type_id: 0,
  hs_code_id: 0,
  product_family: "",
  target_market: "",
  required_certificate: "",
  // No image_url: the image is written only by the upload/remove endpoints
  // (ProductImageUploader), never by the form save.
};

const emptyCategoryForm: CategoryCreate = {
  name: "",
  memo: "",
  description: "",
  active: true,
};

const emptyBrandForm: BrandCreate = {
  brand_name: "",
  description: "",
};

type GridSort = { field: string; sort: "asc" | "desc" };
type InventoryView = "products" | "categories" | "brands";

interface ProductsPageProps {
  view?: InventoryView;
  hideTabs?: boolean;
}

/** Product avatar: shows the uploaded image if present, else the product
 * name's initials, else a generic placeholder icon (e.g. a brand-new,
 * not-yet-named product being created). Mirrors SuppliersPage's
 * SupplierAvatarCircle so both master lists look the same. */
function ProductAvatarCircle({
  productName,
  imageUrl,
  size = 36,
}: {
  productName?: string;
  imageUrl?: string | null;
  size?: number;
}) {
  const url = productImageUrl(imageUrl);
  const initials = productName?.trim() ? productName.trim().slice(0, 2).toUpperCase() : null;
  return (
    <Avatar
      src={url || undefined}
      variant="circular"
      sx={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        bgcolor: url ? undefined : "action.disabledBackground",
        color: "text.secondary",
      }}
    >
      {!url && (initials || <InventoryIcon sx={{ fontSize: size * 0.55 }} />)}
    </Avatar>
  );
}

// Browse-table row shapes, with display-only lookup fields attached so the
// table's own column-header sort orders by the displayed name rather than
// the raw category_id/items_brand_id (mirrors SuppliersPage's SupplierRow).
type ProductRow = Product & { category_name: string; brand_name: string };
type CategoryRow = Category;
type BrandRow = Brand;

export default function ProductsPage({
  view = "products",
  hideTabs = false,
}: ProductsPageProps) {
  const viewToTab = (v: InventoryView) =>
    v === "products" ? 0 : v === "categories" ? 1 : 2;
  const [activeTab, setActiveTab] = useState<number>(viewToTab(view));
  const currencySymbol = useCurrencyStore((s) => s.symbol);

  useEffect(() => {
    if (hideTabs) {
      const nextTab = viewToTab(view);
      if (activeTab !== nextTab) setActiveTab(nextTab);
    }
  }, [view, hideTabs, activeTab]);

  // Permissions
  const canCreate = usePermission("products", "create");
  const canUpdate = usePermission("products", "update");
  const canCreateCategory = usePermission("categories", "create");
  const canUpdateCategory = usePermission("categories", "update");
  const canCreateBrand = usePermission("brands", "create");
  const canUpdateBrand = usePermission("brands", "update");

  const queryClient = useQueryClient();
  // "+" next to Category / Brand: create one in a dialog without leaving the form.
  const [quickCreate, setQuickCreate] = useState<LookupKind | null>(null);

  // Confirm dialog - unified for all tabs
  const confirmDialog = useConfirmDialog();

  // Validation state - track which fields have been touched/blurred
  const [productTouched, setProductTouched] = useState<Record<string, boolean>>(
    {},
  );
  const [categoryTouched, setCategoryTouched] = useState<
    Record<string, boolean>
  >({});
  const [brandTouched, setBrandTouched] = useState<Record<string, boolean>>({});

  // Mark field as touched when user leaves it
  const handleProductBlur = (fieldName: string) => {
    setProductTouched((prev) => ({ ...prev, [fieldName]: true }));
  };
  const handleCategoryBlur = (fieldName: string) => {
    setCategoryTouched((prev) => ({ ...prev, [fieldName]: true }));
  };
  const handleBrandBlur = (fieldName: string) => {
    setBrandTouched((prev) => ({ ...prev, [fieldName]: true }));
  };

  // Product filter states - all filters apply live as the user types/selects,
  // no separate "Search" step needed.
  const [productActiveFilter, setProductActiveFilter] = useState<string | null>(null);
  const [productCategoryFilter, setProductCategoryFilter] = useState<Category | null>(null);
  const [productBrandFilter, setProductBrandFilter] = useState<Brand | null>(null);
  const [categoryActiveFilter, setCategoryActiveFilter] = useState<string | null>(null);
  const [brandActiveFilter, setBrandActiveFilter] = useState<string | null>(null);

  // Minimum selling price — edited inline alongside Cost/Selling/Website
  // Price (Pricing section) and saved together with the rest of the product
  // form on the single Save click, same as those fields. It's still backed
  // by its own history-tracked endpoint on the backend (minimumPriceApi),
  // so saving fires a second request under the hood when this value changed
  // — see handleSaveProduct / createProductMutation.onSuccess /
  // updateProductMutation.onSuccess.
  const [minPriceInput, setMinPriceInput] = useState<number | "">("");

  // Which of the General / Pricing tabs is active, shown in the
  // detail header below the breadcrumb+title.
  // The product just created in this session: it is walked through the remaining tabs with Next.
  const [justCreatedId, setJustCreatedId] = useState<number | null>(null);
  const [activeProductSection, setActiveProductSection] = useState<
    "general" | "pricing" | "designBrief" | "designDetail" | "bomStructure"
  >("general");

  // Image file staged while creating a new product — no product id yet to
  // upload against, so it's held here and pushed right after the product is
  // created (see createProductMutation).
  const [draftImageFile, setDraftImageFile] = useState<File | null>(null);

  // Products state
  const productState = useMasterDetailState<Product, ProductCreate>({
    initialFormData: emptyProductForm,
    initialSortField: "item_code",
    confirmUnsavedChanges: () =>
      confirmDialog.confirm({
        title: "Discard Changes",
        message: "You have unsaved changes. Discard them?",
        confirmText: "Discard",
        cancelText: "Keep Editing",
        confirmColor: "warning",
      }),
  });

  // Categories state
  const categoryState = useMasterDetailState<Category, CategoryCreate>({
    initialFormData: emptyCategoryForm,
    initialSortField: "name",
    confirmUnsavedChanges: () =>
      confirmDialog.confirm({
        title: "Discard Changes",
        message: "You have unsaved changes. Discard them?",
        confirmText: "Discard",
        cancelText: "Keep Editing",
        confirmColor: "warning",
      }),
  });

  // Brands state
  const brandState = useMasterDetailState<Brand, BrandCreate>({
    initialFormData: emptyBrandForm,
    initialSortField: "brand_name",
    confirmUnsavedChanges: () =>
      confirmDialog.confirm({
        title: "Discard Changes",
        message: "You have unsaved changes. Discard them?",
        confirmText: "Discard",
        cancelText: "Keep Editing",
        confirmColor: "warning",
      }),
  });

  // Activity History is opened on demand from a detail icon next to each
  // tab's Activity History title, rather than shown inline. One shared
  // panel serves all three tabs — entityType/entityId switch per tab.
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);

  const handleClearProductFilters = useCallback(() => {
    productState.setSearchQuery("");
    setProductActiveFilter(null);
    setProductCategoryFilter(null);
    setProductBrandFilter(null);
  }, [productState.setSearchQuery]);

  const handleClearCategoryFilters = useCallback(() => {
    categoryState.setSearchQuery("");
    setCategoryActiveFilter(null);
  }, [categoryState.setSearchQuery]);

  const handleClearBrandFilters = useCallback(() => {
    brandState.setSearchQuery("");
    setBrandActiveFilter(null);
  }, [brandState.setSearchQuery]);

  // Server-side paging: each grid asks the API for just the page on screen
  // (search / filters / sort run in the database), and the API returns the
  // total so the footer can say "1-25 of N". Sorting is a toggle (asc/desc)
  // on one column at a time, as the grid's header sort icons do.
  const [productPaging, setProductPaging] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [categoryPaging, setCategoryPaging] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [brandPaging, setBrandPaging] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [productSort, setProductSort] = useState<GridSort | null>(null);
  const [categorySort, setCategorySort] = useState<GridSort | null>(null);
  const [brandSort, setBrandSort] = useState<GridSort | null>(null);
  const productSearch = useDebounce(productState.searchQuery, 300);
  const categorySearch = useDebounce(categoryState.searchQuery, 300);
  const brandSearch = useDebounce(brandState.searchQuery, 300);
  const activeParam = (v: string | null) => (v ? v === "active" : undefined);

  // Any change to a filter or search starts again from the first page.
  useEffect(() => {
    setProductPaging((m) => (m.page === 0 ? m : { ...m, page: 0 }));
  }, [productSearch, productActiveFilter, productCategoryFilter?.id, productBrandFilter?.id, productSort]);
  useEffect(() => {
    setCategoryPaging((m) => (m.page === 0 ? m : { ...m, page: 0 }));
  }, [categorySearch, categoryActiveFilter, categorySort]);
  useEffect(() => {
    setBrandPaging((m) => (m.page === 0 ? m : { ...m, page: 0 }));
  }, [brandSearch, brandActiveFilter, brandSort]);

  const {
    data: productsPage,
    isLoading: productsLoading,
  } = useQuery({
    queryKey: [
      "products", "paged", productPaging.page, productPaging.pageSize, productSearch.trim(), productActiveFilter,
      productCategoryFilter?.id, productBrandFilter?.id, productSort?.field, productSort?.sort,
    ],
    queryFn: () =>
      productsApi.getPage({
        page: productPaging.page,
        size: productPaging.pageSize,
        q: productSearch.trim(),
        active: activeParam(productActiveFilter),
        category_id: productCategoryFilter?.id,
        brand_id: productBrandFilter?.id,
        sort_by: productSort?.field,
        order: productSort?.sort,
      }),
    enabled: activeTab === 0,
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  const {
    data: categoriesPage,
    isLoading: categoriesLoading,
  } = useQuery({
    queryKey: [
      "categories", "paged", categoryPaging.page, categoryPaging.pageSize, categorySearch.trim(), categoryActiveFilter,
      categorySort?.field, categorySort?.sort,
    ],
    queryFn: () =>
      categoriesApi.getPage({
        page: categoryPaging.page,
        size: categoryPaging.pageSize,
        q: categorySearch.trim(),
        active: activeParam(categoryActiveFilter),
        sort_by: categorySort?.field,
        order: categorySort?.sort,
      }),
    enabled: activeTab === 1,
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  const {
    data: brandsPage,
    isLoading: brandsLoading,
  } = useQuery({
    queryKey: [
      "brands", "paged", brandPaging.page, brandPaging.pageSize, brandSearch.trim(), brandActiveFilter,
      brandSort?.field, brandSort?.sort,
    ],
    queryFn: () =>
      brandsApi.getPage({
        page: brandPaging.page,
        size: brandPaging.pageSize,
        q: brandSearch.trim(),
        active: activeParam(brandActiveFilter),
        sort_by: brandSort?.field,
        order: brandSort?.sort,
      }),
    enabled: activeTab === 2,
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  // Full category / brand lists for the form pickers and filter drop-downs
  // (small reference lists, not the browse grids).
  const { data: categories } = useQuery({
    queryKey: ["categories", "all"],
    queryFn: () => categoriesApi.getAll(0, 100000, false),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: brands } = useQuery({
    queryKey: ["brands", "all"],
    queryFn: () => brandsApi.getAll(0, 100000, false),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  //consctive categories and brands for dropdowns (only active items can be selected for new products)
  const activeCategories = useMemo(
    () => categories?.filter((c) => c.active) || [],
    [categories],
  );
  const activeBrands = useMemo(
    () => brands?.filter((b) => b.active) || [],
    [brands],
  );

  // Product types and HS codes (lists users can add to from the form).
  const { data: activeProductTypes = [] } = useQuery({
    queryKey: ["product-types"],
    queryFn: () => productTypesApi.getAll(true),
    staleTime: 5 * 60 * 1000,
  });
  const { data: activeHsCodes = [] } = useQuery({
    queryKey: ["hs-codes"],
    queryFn: () => hsCodesApi.getAll(true),
    staleTime: 5 * 60 * 1000,
  });
  // Active Item Catalog items for the Stock Item picker (the stocked part this product sells).
  const { data: activeStockItems = [] } = useQuery({
    queryKey: ["materials", "picker", "active"],
    queryFn: () => materialsApi.getAll(0, 100000, true),
    staleTime: 5 * 60 * 1000,
    enabled: activeTab === 0,
  });

  const stockItemOptions = useMemo(() => {
    const opts: { id: number; item_code: string; name: string }[] = activeStockItems.map((m) => ({
      id: m.id,
      item_code: m.item_code,
      name: m.name,
    }));
    const linked = productState.selectedItem;
    if (linked?.material_id && !opts.some((o) => o.id === linked.material_id)) {
      opts.push({ id: linked.material_id, item_code: linked.material_item_code ?? "", name: linked.material_name ?? "" });
    }
    return opts;
  }, [activeStockItems, productState.selectedItem]);

  // Fetch current minimum selling price for selected product
  const { data: currentMinPrice } = useQuery({
    queryKey: ["minimum-price", productState.selectedItem?.id],
    queryFn: () => minimumPriceApi.getCurrentOrNull(productState.selectedItem!.id),
    enabled: !!productState.selectedItem?.id,
    retry: false,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Keep the inline Minimum Selling Price field in sync with whichever
  // product is selected — mirrors how the rest of the Pricing section's
  // fields follow productState.formData on selection. Skipped while
  // creating, since handleNewProduct resets it independently (there's no
  // selectedItem/currentMinPrice yet for a not-yet-saved product).
  useEffect(() => {
    if (!productState.isCreating) {
      setMinPriceInput(currentMinPrice?.minimum_price ?? "");
    }
  }, [productState.selectedItem?.id, currentMinPrice, productState.isCreating]);

  // Pricing is read-only once saved (Edit button), like General.
  const isPricingEditable = productState.isEditing || productState.isCreating;

  const designProductId = productState.selectedItem && !productState.isCreating ? productState.selectedItem.id : null;
  // Design Brief / Design Detail / BOM Structure tabs: their own edit state, driven from the same toolbar
  // as General / Pricing.
  const designBrief = useProductDesignBrief(designProductId, canUpdate);
  const designDetail = useProductDesignDetail(designProductId, canUpdate);
  const bomStructure = useProductBomStructure(designProductId, canUpdate);
  const designDoc = productState.isCreating
    ? null
    : activeProductSection === "designBrief"
      ? designBrief
      : activeProductSection === "designDetail"
        ? designDetail
        : activeProductSection === "bomStructure"
          ? bomStructure
          : null;

  // The main toolbar's Save/Cancel cover General and Pricing (once in Edit mode).
  const showToolbarSaveForSection =
    activeProductSection === "pricing"
      ? isPricingEditable
      : productState.isEditing || productState.isCreating;



  // Browse-table rows/columns. Rows add display-only lookup fields (category
  // name, brand name) so the grid sorts on the displayed text rather than the
  // raw id; columns have no `sortable: false` on the real-data fields, so
  // sorting is done per-column via the grid's own column header menu.
  const productRows = useMemo(
    () =>
      (productsPage?.items ?? []).map((product) => ({
        ...product,
        category_name: product.category_name || "-",
        brand_name: product.brand_name || "-",
      })),
    [productsPage]
  );

  // Handler used by the browse table's row click and its "view" column icon.
  // Declared here (rather than further down with the other product
  // handlers) because productColumns below needs it in its dependency
  // array, and a `const` referenced before its declaration line runs throws
  // "Cannot access before initialization" at runtime.
  const handleSelectProduct = useCallback(
    async (product: Product) => {
      if (productState.isEditing || productState.isCreating) {
        const confirmed = await confirmDialog.confirm({
          title: "Discard Changes",
          message: "You have unsaved changes. Discard them?",
          confirmText: "Discard",
          cancelText: "Keep Editing",
          confirmColor: "warning",
        });
        if (!confirmed) return;
      }
      selectProductInternal(product);
    },
    [productState.isEditing, productState.isCreating, confirmDialog],
  );

  const productColumns: TDataGridColumn<ProductRow>[] = useMemo(
    () => [
      { field: "item_code", header: "Item Code", width: 140 },
      {
        field: "name",
        header: "Name",
        flex: 1,
        minWidth: 200,
        renderCell: (params: GridRenderCellParams<ProductRow>) => (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, height: "100%" }}>
            <ProductAvatarCircle productName={params.row.name} imageUrl={params.row.image_url} size={30} />
            <Typography variant="body2" fontWeight={600}>
              {params.row.name}
            </Typography>
          </Box>
        ),
      },
      {
        field: "product_type_name",
        header: "Product Type",
        width: 130,
        sortable: false,
        renderCell: (params: GridRenderCellParams<ProductRow>) => params.row.product_type_name || "-",
      },
      { field: "category_name", header: "Category", width: 150 },
      { field: "brand_name", header: "Brand", width: 130 },
      {
        field: "product_family",
        header: "Product Family",
        width: 150,
        sortable: false,
        renderCell: (params: GridRenderCellParams<ProductRow>) => params.row.product_family || "-",
      },
      {
        field: "hs_code",
        header: "HS Code",
        width: 120,
        sortable: false,
        renderCell: (params: GridRenderCellParams<ProductRow>) => params.row.hs_code || "-",
      },
      {
        field: "cost_price",
        header: "Cost Price",
        width: 130,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<ProductRow>) => `${currencySymbol} ${fmtLKR(params.row.cost_price || 0)}`,
      },
      {
        field: "selling_price",
        header: "Sell Price",
        width: 130,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<ProductRow>) => `${currencySymbol} ${fmtLKR(params.row.selling_price || 0)}`,
      },
      {
        field: "active",
        header: "Status",
        width: 110,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<ProductRow>) => (
          <TChip
            label={params.row.active ? "Active" : "Inactive"}
            size="small"
            color={params.row.active ? "success" : "default"}
          />
        ),
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<ProductRow>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectProduct(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [handleSelectProduct]
  );

  const categoryRows: CategoryRow[] = categoriesPage?.items ?? [];

  // Handler used by the browse table's row click and its "view" column icon.
  // Declared here (rather than further down with the other category
  // handlers) because categoryColumns below needs it in its dependency
  // array, and a `const` referenced before its declaration line runs throws
  // "Cannot access before initialization" at runtime.
  const handleSelectCategory = useCallback(
    async (category: Category) => {
      if (categoryState.isEditing || categoryState.isCreating) {
        const confirmed = await confirmDialog.confirm({
          title: "Discard Changes",
          message: "You have unsaved changes. Discard them?",
          confirmText: "Discard",
          cancelText: "Keep Editing",
          confirmColor: "warning",
        });
        if (!confirmed) return;
      }
      selectCategoryInternal(category);
    },
    [categoryState.isEditing, categoryState.isCreating, confirmDialog],
  );

  const categoryColumns: TDataGridColumn<CategoryRow>[] = useMemo(
    () => [
      { field: "category_code", header: "Code", width: 120 },
      { field: "name", header: "Name", flex: 1, minWidth: 200 },
      { field: "description", header: "Description", flex: 1, minWidth: 200 },
      {
        field: "active",
        header: "Status",
        width: 110,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<CategoryRow>) => (
          <TChip
            label={params.row.active ? "Active" : "Inactive"}
            size="small"
            color={params.row.active ? "success" : "default"}
          />
        ),
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<CategoryRow>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectCategory(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [handleSelectCategory]
  );

  const brandRows: BrandRow[] = brandsPage?.items ?? [];

  // Handler used by the browse table's row click and its "view" column icon.
  // Declared here (rather than further down with the other brand handlers)
  // because brandColumns below needs it in its dependency array, and a
  // `const` referenced before its declaration line runs throws "Cannot
  // access before initialization" at runtime.
  const handleSelectBrand = useCallback(
    async (brand: Brand) => {
      if (brandState.isEditing || brandState.isCreating) {
        const confirmed = await confirmDialog.confirm({
          title: "Discard Changes",
          message: "You have unsaved changes. Discard them?",
          confirmText: "Discard",
          cancelText: "Keep Editing",
          confirmColor: "warning",
        });
        if (!confirmed) return;
      }
      selectBrandInternal(brand);
    },
    [brandState.isEditing, brandState.isCreating, confirmDialog],
  );

  const brandColumns: TDataGridColumn<BrandRow>[] = useMemo(
    () => [
      { field: "brand_code", header: "Code", width: 120 },
      { field: "brand_name", header: "Name", flex: 1, minWidth: 200 },
      { field: "description", header: "Description", flex: 1, minWidth: 200 },
      {
        field: "active",
        header: "Status",
        width: 110,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<BrandRow>) => (
          <TChip
            label={params.row.active ? "Active" : "Inactive"}
            size="small"
            color={params.row.active ? "success" : "default"}
          />
        ),
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<BrandRow>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectBrand(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [handleSelectBrand]
  );

  // Which record each tab currently shows, readable from inside mutation
  // callbacks that resolve later. A save's response must only be applied if
  // the user is still on that same record — they may have moved on while the
  // request was in flight.
  const selectedProductIdRef = useRef<number | null>(null);
  selectedProductIdRef.current = productState.selectedItem?.id ?? null;
  const selectedCategoryIdRef = useRef<number | null>(null);
  selectedCategoryIdRef.current = categoryState.selectedItem?.id ?? null;
  const selectedBrandIdRef = useRef<number | null>(null);
  selectedBrandIdRef.current = brandState.selectedItem?.id ?? null;

  // Mutations
  const createProductMutation = useCrudMutation({
    // The minimum selling price travels in the same request and is saved in
    // the same transaction as the product (no second follow-up request).
    mutationFn: (data: ProductCreate) => productsApi.create(data),
    // Also invalidate the referenceData cache so product selectors in purchasing,
    // sales, warehouse etc. immediately reflect the new product without a hard refresh.
    invalidateQueryKeys: [["products"], ["referenceData"], ["materials"]],
    successMessage: "Product created successfully",
    errorMessage: "Failed to create product",
    onSuccess: (newProduct) => {
      productState.setIsCreating(false);
      productState.setIsEditing(false);
      setJustCreatedId(newProduct.id);
      productState.setSelectedItem(newProduct);
      setMinPriceInput("");

      if (draftImageFile) {
        const fileToUpload = draftImageFile;
        setDraftImageFile(null);
        productsApi
          .uploadImage(newProduct.id, fileToUpload)
          .then((updated) =>
            // Guard against the user having since selected a different
            // product while this upload was in flight — don't clobber
            // their current selection with this now-stale response.
            productState.setSelectedItem((current) =>
              current?.id === updated.id ? updated : current,
            ),
          )
          .catch(() =>
            showErrorToast("Product created, but the image failed to upload"),
          );
      }

    },
  });

  const updateProductMutation = useCrudMutation({
    mutationFn: ({ id, data }: { id: number; data: ProductUpdate }) =>
      productsApi.update(id, data),
    invalidateQueryKeys: [["products"], ["referenceData"], ["materials"]],
    getInvalidateQueryKeys: (_data, variables) => [["minimum-price", variables.id]],
    successMessage: "Product updated successfully",
    errorMessage: "Failed to update product",
    onSuccess: (updatedProduct) => {
      // Reload the form from the saved record (so it reflects exactly what
      // the server stored), but only if the user is still on this product.
      if (selectedProductIdRef.current === updatedProduct.id) {
        selectProductInternal(updatedProduct);
      }
    },
    onError: async (error, variables) => {
      if (isNotFound(error)) {
        queryClient.invalidateQueries({ queryKey: ["products"] });
        if (selectedProductIdRef.current === variables.id) {
          productState.setIsEditing(false);
          productState.setSelectedItem(null);
          setProductTouched({});
        }
        return;
      }
      if (!isConflict(error)) return;
      try {
        const fresh = await productsApi.getById(variables.id);
        if (!isStaleConflict(variables.data.expected_version, fresh.version)) return;
        queryClient.invalidateQueries({ queryKey: ["products"] });
        queryClient.invalidateQueries({ queryKey: ["minimum-price", fresh.id] });
        if (selectedProductIdRef.current === fresh.id) {
          // Don't silently throw the user's edits away: let them choose to keep
          // editing (and copy their values) or load the other user's version.
          const reload = await confirmDialog.confirm({
            title: "Product changed by someone else",
            message:
              "Another user saved this product while you were editing, so your changes were not saved. " +
              "Load their version now? (Choose Keep Editing to note your changes first.)",
            confirmText: "Load latest",
            cancelText: "Keep Editing",
            confirmColor: "warning",
          });
          if (reload && selectedProductIdRef.current === fresh.id) {
            selectProductInternal(fresh);
            setProductTouched({});
          } else if (selectedProductIdRef.current === fresh.id) {
            // Keep the user's values; a new Save is now based on the latest version.
            productState.setSelectedItem(fresh);
          }
        }
      } catch {
        // The 409's toast already told the user; nothing more to do.
      }
    },
  });

  const createCategoryMutation = useCrudMutation({
    mutationFn: categoriesApi.create,
    invalidateQueryKeys: [["categories"], ["referenceData"]],
    successMessage: "Category created successfully",
    errorMessage: "Failed to create category",
    onSuccess: (newCategory) => {
      categoryState.setIsCreating(false);
      categoryState.setIsEditing(false);
      categoryState.setSelectedItem(newCategory);
    },
  });

  const updateCategoryMutation = useCrudMutation({
    mutationFn: ({ id, data }: { id: number; data: CategoryUpdate }) =>
      categoriesApi.update(id, data),
    invalidateQueryKeys: [["categories"], ["referenceData"]],
    successMessage: "Category updated successfully",
    errorMessage: "Failed to update category",
    onSuccess: (updatedCategory) => {
      if (selectedCategoryIdRef.current === updatedCategory.id) {
        selectCategoryInternal(updatedCategory);
      }
    },
    onError: async (error, variables) => {
      if (isNotFound(error)) {
        queryClient.invalidateQueries({ queryKey: ["categories"] });
        if (selectedCategoryIdRef.current === variables.id) {
          categoryState.setIsEditing(false);
          categoryState.setSelectedItem(null);
          setCategoryTouched({});
        }
        return;
      }
      if (!isConflict(error)) return;
      try {
        const fresh = await categoriesApi.getById(variables.id);
        if (!isStaleConflict(variables.data.expected_version, fresh.version)) return;
        queryClient.invalidateQueries({ queryKey: ["categories"] });
        if (selectedCategoryIdRef.current === fresh.id) {
          selectCategoryInternal(fresh);
          setCategoryTouched({});
        }
      } catch {
        // The 409's toast already told the user; nothing more to do.
      }
    },
  });

  const createBrandMutation = useCrudMutation({
    mutationFn: brandsApi.create,
    invalidateQueryKeys: [["brands"], ["referenceData"]],
    successMessage: "Brand created successfully",
    errorMessage: "Failed to create brand",
    onSuccess: (newBrand) => {
      brandState.setIsCreating(false);
      brandState.setIsEditing(false);
      brandState.setSelectedItem(newBrand);
    },
  });

  const updateBrandMutation = useCrudMutation({
    mutationFn: ({ id, data }: { id: number; data: BrandUpdate }) =>
      brandsApi.update(id, data),
    invalidateQueryKeys: [["brands"], ["referenceData"]],
    successMessage: "Brand updated successfully",
    errorMessage: "Failed to update brand",
    onSuccess: (updatedBrand) => {
      if (selectedBrandIdRef.current === updatedBrand.id) {
        selectBrandInternal(updatedBrand);
      }
    },
    onError: async (error, variables) => {
      if (isNotFound(error)) {
        queryClient.invalidateQueries({ queryKey: ["brands"] });
        if (selectedBrandIdRef.current === variables.id) {
          brandState.setIsEditing(false);
          brandState.setSelectedItem(null);
          setBrandTouched({});
        }
        return;
      }
      if (!isConflict(error)) return;
      try {
        const fresh = await brandsApi.getById(variables.id);
        if (!isStaleConflict(variables.data.expected_version, fresh.version)) return;
        queryClient.invalidateQueries({ queryKey: ["brands"] });
        if (selectedBrandIdRef.current === fresh.id) {
          selectBrandInternal(fresh);
          setBrandTouched({});
        }
      } catch {
        // The 409's toast already told the user; nothing more to do.
      }
    },
  });


  // Product handlers
  const selectProductInternal = (product: Product) => {
    productState.setSelectedItem(product);
    productState.setFormData({
      name: product.name,
      model: product.model || "",
      item_type: product.item_type,
      unit_of_measure: product.unit_of_measure || "pcs",
      // no silent "serial": a product without a tracking type must get an explicit choice on save
      tracking_type: (product.tracking_type || "") as ProductCreate["tracking_type"],
      over_receipt_tolerance_pct: Number(product.over_receipt_tolerance_pct ?? 0),
      under_receipt_tolerance_pct: Number(product.under_receipt_tolerance_pct ?? 0),
      shelf_life_days: product.shelf_life_days ?? null,
      requires_qc: !!product.requires_qc,
      description: product.description || "",
      website_active: product.website_active,
      website_price: product.website_price ?? undefined,
      selling_price: product.selling_price || 0,
      active: product.active,
      cost_price: product.cost_price,
      tax_rate: product.tax_rate ?? 0,
      category_id: product.category_id,
      items_brand_id: product.items_brand_id,
      product_type_id: product.product_type_id ?? 0,
      hs_code_id: product.hs_code_id ?? 0,
      product_family: product.product_family || "",
      target_market: product.target_market || "",
      required_certificate: product.required_certificate || "",
      material_id: product.material_id ?? undefined,
    });
    productState.setIsEditing(false);
    productState.setIsCreating(false);
  };

  // Open the ?focus=<id> deep-link target (e.g. from an item's Linked Products
  // in the Item Catalog), on the ?section=<tab id> tab when given. Nothing is auto-selected otherwise.
  const [searchParams, setSearchParams] = useSearchParams();
  const focusHandled = useRef(false);
  // The deep link's tab; used once by the "back to General on a new selection" reset below.
  const focusSection = useRef<string | null>(null);
  useEffect(() => {
    if (activeTab !== 0) return;
    const focusId = Number(searchParams.get("focus"));
    if (focusId && !focusHandled.current) {
      focusHandled.current = true;
      const section = PRODUCT_DETAIL_TABS.find((t) => t.id === searchParams.get("section"))?.id ?? "general";
      productsApi
        .getById(focusId)
        .then((target) => {
          focusSection.current = String(section);
          setActiveProductSection(section as typeof activeProductSection);
          selectProductInternal(target);
        })
        .catch(() => showErrorToast("Could not open that product"));
      const next = new URLSearchParams(searchParams);
      next.delete("focus");
      next.delete("section");
      setSearchParams(next, { replace: true });
    }
    // selectProductInternal is recreated each render; the ref guard runs this once per link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, searchParams, setSearchParams]);

  const handleNewProduct = () => {
    // Category/Brand start unselected — the user must explicitly choose,
    // not have the first active one picked for them.
    productState.setSelectedItem(null);
    productState.setFormData(emptyProductForm);
    setMinPriceInput("");
    setProductTouched({});
    setDraftImageFile(null);
    productState.setIsCreating(true);
    productState.setIsEditing(true);
  };

  const handleDuplicateProduct = () => {
    if (productState.selectedItem) {
      productState.setFormData({
        ...productState.formData,
        name: `${productState.selectedItem.name} (Copy)`,
      });
      setMinPriceInput("");
      setDraftImageFile(null);
      productState.setIsCreating(true);
      productState.setIsEditing(true);
    }
  };

  // One save at a time. The handlers below await the mutation, so this covers the
  // whole save: a double-click (or Enter + click) used to start a second save before the
  // first had finished, producing "created" followed by an "already exists" error.
  const saveInFlightRef = useRef(false);
  const withSaveGuard = (fn: () => Promise<void>) => async () => {
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    try {
      await fn();
    } finally {
      saveInFlightRef.current = false;
    }
  };

  const saveProductInner = async () => {
    // Validate required fields (whitespace-only counts as empty)
    if (
      !(productState.formData.name ?? "").trim() ||
      !productState.formData.tracking_type ||
      !productState.formData.category_id ||
      !productState.formData.items_brand_id ||
      !productState.formData.product_type_id ||
      !productState.formData.hs_code_id ||
      !(productState.formData.product_family ?? "").trim()
    ) {
      showErrorToast("Please fill in all required fields");
      setActiveProductSection("general");
      setProductTouched({
        name: true,
        tracking_type: true,
        category_id: true,
        items_brand_id: true,
        product_type_id: true,
        hs_code_id: true,
        product_family: true,
      });
      return;
    }
    if (
      toleranceError(productState.formData.over_receipt_tolerance_pct) ||
      toleranceError(productState.formData.under_receipt_tolerance_pct)
    ) {
      setActiveProductSection("general");
      showErrorToast("Receipt tolerances must be between 0 and 100%");
      return;
    }
    if (shelfLifeError(productState.formData.shelf_life_days)) {
      setActiveProductSection("general");
      showErrorToast("Shelf life must be a whole number of days from 1 to 3650");
      return;
    }
    // Prices live on the Pricing tab: take the user there instead of failing silently.
    if (
      productState.formData.cost_price == null ||
      productState.formData.selling_price == null
    ) {
      setActiveProductSection("pricing");
      setProductTouched({ cost_price: true, selling_price: true });
      showErrorToast("Enter the cost price and selling price on the Pricing tab");
      return;
    }
    
    // Validate prices
    const badPrice = (
      [
        ["Cost price", productState.formData.cost_price],
        ["Website price", productState.formData.website_price],
        ["Selling price", productState.formData.selling_price],
        ["Minimum selling price", minPriceInput],
      ] as const
    ).find(([, v]) => priceError(v));
    if (badPrice) {
      setActiveProductSection("pricing");
      showErrorToast(`${badPrice[0]}: ${priceError(badPrice[1])}`);
      return;
    }
    if (productState.formData.selling_price < productState.formData.cost_price) {
      showErrorToast("Selling price cannot be less than cost price");
      return;
    }
    if (typeof productState.formData.website_price === "number" && productState.formData.website_price > 0 && productState.formData.website_price < productState.formData.cost_price) {
      showErrorToast("Website price cannot be less than cost price");
      return;
    }
    if (typeof minPriceInput === "number" && minPriceInput < productState.formData.cost_price) {
      showErrorToast("Minimum selling price cannot be less than cost price");
      return;
    }
    if (typeof minPriceInput === "number" && minPriceInput > productState.formData.selling_price) {
      showErrorToast("Minimum selling price cannot be greater than the selling price");
      return;
    }
    // The minimum price is a price history: it can be changed but not removed.
    if (
      minPriceInput === "" &&
      !productState.isCreating &&
      currentMinPrice?.minimum_price !== undefined &&
      currentMinPrice?.minimum_price !== null
    ) {
      setActiveProductSection("pricing");
      showErrorToast(
        "The minimum selling price can't be removed, only changed. Enter the cost price for no extra floor.",
      );
      return;
    }

    // Ensure website_active is false if product is inactive
    const dataToSave = { ...productState.formData };
    dataToSave.name = (dataToSave.name ?? "").trim();
    if (!dataToSave.active) {
      dataToSave.website_active = false;
    }

    // Captured now, at submit time, as part of the request itself — not read
    // later from component state in onSuccess, where it may have changed.
    const minimumSellingPrice =
      typeof minPriceInput === "number" ? minPriceInput : undefined;

    // No Stock Item chosen: omit it, so the backend creates and links an item.
    if (!dataToSave.material_id) delete dataToSave.material_id;

    if (productState.isCreating) {
      await createProductMutation
        .mutateAsync({
          ...dataToSave,
          minimum_selling_price: minimumSellingPrice,
        })
        .catch(() => undefined);
    } else if (productState.selectedItem) {
      // The backend only writes a new price-history row when the minimum
      // actually changed, so sending the current value is a no-op.
      // image_url is owned by the image upload/remove endpoints — it
      // doesn't belong in a form-save update.
      const { material_id: chosenItemId, ...updateFields }: Partial<ProductCreate> = { ...dataToSave };
      delete updateFields.image_url;
      // Send the Stock Item only when it changed (null clears the link); the
      // backend refuses a change while the product has stock.
      const prevItemId = productState.selectedItem.material_id ?? null;
      const nextItemId = chosenItemId ?? null;
      await updateProductMutation
        .mutateAsync({
          id: productState.selectedItem.id,
          data: {
            ...updateFields,
            ...(nextItemId !== prevItemId ? { material_id: nextItemId } : {}),
            minimum_selling_price: minimumSellingPrice,
            expected_updated_at: productState.selectedItem.updated_at,
            expected_version: productState.selectedItem.version,
          },
        })
        .catch(() => undefined);
    }
  };
  const handleSaveProduct = withSaveGuard(saveProductInner);

  // Cancelling out of "New Product" returns to the browse table, not the old
  // always-visible detail panel's auto-selected first item (mirrors
  // SuppliersPage's handleCancelSupplier). Cancelling an edit of an existing
  // product still just reverts its form and keeps it selected.
  const handleCancelProduct = () => {
    if (productState.isCreating) {
      productState.setIsCreating(false);
      productState.setIsEditing(false);
      productState.setSelectedItem(null);
      setMinPriceInput("");
      setProductTouched({});
      setDraftImageFile(null);
    } else if (productState.selectedItem) {
      selectProductInternal(productState.selectedItem);
      productState.setIsEditing(false);
      setMinPriceInput(currentMinPrice?.minimum_price ?? "");
      setProductTouched({});
    }
  };

  // Returns to the browse table from the detail view (the "Back to
  // Products" link in the mini left panel).
  const handleBackToProducts = useCallback(() => {
    productState.setSelectedItem(null);
    if (productState.isCreating) {
      productState.setIsCreating(false);
      productState.setIsEditing(false);
    }
  }, [productState]);



  // Category handlers
  const selectCategoryInternal = (category: Category) => {
    categoryState.setSelectedItem(category);
    categoryState.setFormData({
      name: category.name,
      memo: category.memo || "",
      description: category.description || "",
      active: category.active,
    });
    categoryState.setIsEditing(false);
    categoryState.setIsCreating(false);
  };

  const handleNewCategory = () => {
    categoryState.setSelectedItem(null);
    categoryState.setFormData(emptyCategoryForm);
    setCategoryTouched({});
    categoryState.setIsCreating(true);
    categoryState.setIsEditing(true);
  };

  const saveCategoryInner = async () => {
    // Validate required fields (whitespace-only counts as empty)
    if (!(categoryState.formData.name ?? "").trim()) {
      showErrorToast("Please fill in all required fields");
      setCategoryTouched({ name: true });
      return;
    }

    const categoryPayload = {
      ...categoryState.formData,
      name: (categoryState.formData.name ?? "").trim(),
    };
    if (categoryState.isCreating) {
      await createCategoryMutation.mutateAsync(categoryPayload).catch(() => undefined);
    } else if (categoryState.selectedItem) {
      await updateCategoryMutation
        .mutateAsync({
          id: categoryState.selectedItem.id,
          data: {
            ...categoryPayload,
            expected_updated_at: categoryState.selectedItem.updated_at,
            expected_version: categoryState.selectedItem.version,
          },
        })
        .catch(() => undefined);
    }
  };
  const handleSaveCategory = withSaveGuard(saveCategoryInner);

  // Cancelling out of "New Category" returns to the browse table rather than
  // auto-selecting the first item (mirrors handleCancelProduct above).
  const handleCancelCategory = () => {
    if (categoryState.isCreating) {
      categoryState.setIsCreating(false);
      categoryState.setIsEditing(false);
      categoryState.setSelectedItem(null);
      setCategoryTouched({});
    } else if (categoryState.selectedItem) {
      selectCategoryInternal(categoryState.selectedItem);
      categoryState.setIsEditing(false);
      setCategoryTouched({});
    }
  };

  // Returns to the browse table from the detail view.
  const handleBackToCategories = useCallback(() => {
    categoryState.setSelectedItem(null);
    if (categoryState.isCreating) {
      categoryState.setIsCreating(false);
      categoryState.setIsEditing(false);
    }
  }, [categoryState]);

  // Brand handlers
  const selectBrandInternal = (brand: Brand) => {
    brandState.setSelectedItem(brand);
    brandState.setFormData({
      brand_name: brand.brand_name,
      description: brand.description || "",
      active: brand.active,
    });
    brandState.setIsEditing(false);
    brandState.setIsCreating(false);
  };

  // Reset the detail panel's active tab back to "General" whenever a
  // different product is selected or a new one is started — but not when
  // just toggling Edit/Cancel on the same record, so the user isn't yanked
  // away from what they're reviewing.
  useEffect(() => {
    setActiveProductSection((focusSection.current ?? "general") as typeof activeProductSection);
    focusSection.current = null;
  }, [productState.selectedItem?.id, productState.isCreating]);

  const handleNewBrand = () => {
    brandState.setSelectedItem(null);
    brandState.setFormData(emptyBrandForm);
    setBrandTouched({});
    brandState.setIsCreating(true);
    brandState.setIsEditing(true);
  };

  const saveBrandInner = async () => {
    // Validate required fields (whitespace-only counts as empty)
    if (!(brandState.formData.brand_name ?? "").trim()) {
      showErrorToast("Please fill in all required fields");
      setBrandTouched({ brand_name: true });
      return;
    }

    const brandPayload = {
      ...brandState.formData,
      brand_name: (brandState.formData.brand_name ?? "").trim(),
    };
    if (brandState.isCreating) {
      await createBrandMutation.mutateAsync(brandPayload).catch(() => undefined);
    } else if (brandState.selectedItem) {
      await updateBrandMutation
        .mutateAsync({
          id: brandState.selectedItem.id,
          data: {
            ...brandPayload,
            expected_updated_at: brandState.selectedItem.updated_at,
            expected_version: brandState.selectedItem.version,
          },
        })
        .catch(() => undefined);
    }
  };
  const handleSaveBrand = withSaveGuard(saveBrandInner);

  // Cancelling out of "New Brand" returns to the browse table rather than
  // auto-selecting the first item (mirrors handleCancelProduct above).
  const handleCancelBrand = () => {
    if (brandState.isCreating) {
      brandState.setIsCreating(false);
      brandState.setIsEditing(false);
      brandState.setSelectedItem(null);
      setBrandTouched({});
    } else if (brandState.selectedItem) {
      selectBrandInternal(brandState.selectedItem);
      brandState.setIsEditing(false);
      setBrandTouched({});
    }
  };

  // Returns to the browse table from the detail view.
  const handleBackToBrands = useCallback(() => {
    brandState.setSelectedItem(null);
    if (brandState.isCreating) {
      brandState.setIsCreating(false);
      brandState.setIsEditing(false);
    }
  }, [brandState]);

  const handleRefresh = async () => {
    // MasterDetailLayout awaits this to drive its refresh spinner — without
    // returning the underlying promises, the spinner would stop before the
    // data has actually come back.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["products"] }),
      queryClient.invalidateQueries({ queryKey: ["categories"] }),
      queryClient.invalidateQueries({ queryKey: ["brands"] }),
    ]);
  };

  // Tab configuration
  const tabs: TabConfig[] = [
    { label: "Products" },
    { label: "Categories" },
    { label: "Brands" },
  ];

  const pageTitle =
    activeTab === 0 ? "Products" : activeTab === 1 ? "Categories" : "Brands";

  // While creating, the other tabs unlock only once General's mandatory fields are filled.
  const isProductGeneralIncomplete =
    !(productState.formData.name ?? "").trim() ||
    !productState.formData.tracking_type ||
    !productState.formData.category_id ||
    !productState.formData.items_brand_id ||
    !productState.formData.product_type_id ||
    !productState.formData.hs_code_id ||
    !(productState.formData.product_family ?? "").trim();

  // Whether we're showing a single product's / category's / brand's detail
  // view (selected or being created) instead of that tab's browse table.
  // "Next" (only after the first save) validates the tab being left (highlighting what is missing) before moving on.
  const nextProductTab = PRODUCT_DETAIL_TABS[PRODUCT_DETAIL_TABS.findIndex((t) => t.id === activeProductSection) + 1];
  const prevProductTab = PRODUCT_DETAIL_TABS[PRODUCT_DETAIL_TABS.findIndex((t) => t.id === activeProductSection) - 1];
  const currentProductSectionValid =
    activeProductSection === "general"
      ? !isProductGeneralIncomplete
      : activeProductSection === "pricing"
        ? productState.formData.cost_price != null && productState.formData.selling_price != null
        : true;

  const isProductDetailMode = !!productState.selectedItem || productState.isCreating;
  const isCategoryDetailMode = !!categoryState.selectedItem || categoryState.isCreating;
  const isBrandDetailMode = !!brandState.selectedItem || brandState.isCreating;

  // Browse mode: a full-width table of every product (shown when nothing is
  // selected and nothing is being created). Sorting is done per-column via
  // the grid's own column header menu, not a separate "Sort by" control
  // (mirrors SuppliersPage's supplierTablePanel).
  const productTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<ProductRow>
          rows={productRows}
          serverPagination={{ rowCount: productsPage?.total ?? 0, paginationModel: productPaging, onPaginationModelChange: setProductPaging }}
          exportAllRows={() =>
            fetchAllPages((page) =>
              productsApi.getPage({
                page,
                size: 200,
                q: productSearch.trim(),
                active: activeParam(productActiveFilter),
                category_id: productCategoryFilter?.id,
                brand_id: productBrandFilter?.id,
                sort_by: productSort?.field,
                order: productSort?.sort,
              })
            ).then((rows) => rows.map((p) => ({ ...p, category_name: p.category_name || "-", brand_name: p.brand_name || "-" })))
          }
          onServerSortChange={setProductSort}
          columns={productColumns}
          loading={productsLoading}
          onRowClick={(row) => handleSelectProduct(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No products found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Detail mode: a narrow left panel showing only the current product (or
  // the "New Product" placeholder while creating) plus the Pricing/Suppliers
  // section nav — the same card+nav the old list panel showed for whichever
  // row was selected, just without the rest of the list beside it. A "Back
  // to Products" link returns to the table.
  // Detail panel content is unchanged from before the redesign — same
  // header, ActionToolbar, FormSections, mutations, validation.
  const productDetailPanel = (
      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <DetailPanelHeader
          icon={<InventoryIcon color="primary" />}
          breadcrumbs={[
            { label: "Product Catalogs", href: "/product-catalogs" },
            { label: "Products" },
          ]}
          title={
            productState.isCreating
              ? "New Product"
              : productState.selectedItem
                ? `${productState.selectedItem.item_code} - ${productState.selectedItem.name}`
                : "Select a Product"
          }
          chips={
            productState.selectedItem && !productState.isCreating
              ? [
                  {
                    label: productState.selectedItem.active
                      ? "Active"
                      : "Inactive",
                    color: productState.selectedItem.active
                      ? "success"
                      : "default",
                  },
                  ...(designDoc?.statusChip ? [designDoc.statusChip] : []),
                ]
              : undefined
          }
          tabsSlot={
            (productState.selectedItem || productState.isCreating) && (
              <TTabs
                tabs={PRODUCT_DETAIL_TABS.map((t) =>
                  // Until the product is saved only General (and Pricing, where the
                  // required cost price lives, once General is filled) can be opened.
                  productState.isCreating && t.id !== "general"
                    ? { ...t, disabled: t.id !== "pricing" || isProductGeneralIncomplete }
                    : t,
                )}
                activeTab={activeProductSection}
                onChange={(id) => setActiveProductSection(id as typeof activeProductSection)}
                appearance="segmented"
                showDivider={false}
                sx={{ mx: 2, my: 1 }}
              />
            )
          }
        />

        <ActionToolbar
          canCreate={canCreate}
          canUpdate={designDoc ? designDoc.canEdit : canUpdate}
          isEditing={designDoc ? designDoc.editing : showToolbarSaveForSection}
          isCreating={productState.isCreating}
          hasSelection={!!productState.selectedItem}
          onAdd={handleNewProduct}
          onDuplicate={handleDuplicateProduct}
          onSave={designDoc ? designDoc.save : handleSaveProduct}
          endActions={designDoc ? designDoc.decisionActions : undefined}
          onBack={
            prevProductTab && !productState.isCreating && productState.selectedItem?.id === justCreatedId
              ? () => setActiveProductSection(prevProductTab.id as typeof activeProductSection)
              : undefined
          }
          onNext={
            nextProductTab && !productState.isCreating && productState.selectedItem?.id === justCreatedId
              ? () =>
                  continueOrReveal(currentProductSectionValid, () =>
                    setActiveProductSection(nextProductTab.id as typeof activeProductSection),
                  )
              : undefined
          }
          onCancel={designDoc ? designDoc.cancelEdit : handleCancelProduct}
          onEdit={
            designDoc
              ? designDoc.startEdit
              : () => {
                  setMinPriceInput(currentMinPrice?.minimum_price ?? "");
                  productState.setIsEditing(true);
                }
          }
          isSaving={
            designDoc
              ? designDoc.isSaving
              : createProductMutation.isPending || updateProductMutation.isPending
          }
          saveDisabled={designDoc ? false : isProductGeneralIncomplete}
          onInvalidSave={() => setProductTouched((t) => ({ ...t, name: true, tracking_type: true, category_id: true, items_brand_id: true, product_type_id: true, hs_code_id: true, product_family: true }))}
        />

        <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
          {!productState.selectedItem && !productState.isCreating ? (
            <EmptyState message="Select a product from the list or create a new one" />
          ) : (
            <>
              <TTabPanel value={activeProductSection} index="general" padding={0}>
                <>
                  {/* Show inactive warning */}
                  {productState.selectedItem &&
                    !productState.selectedItem.active &&
                    !productState.isCreating && (
                      <Alert severity="warning" sx={{ mb: 2 }}>
                        This product is inactive and cannot be used in transactions.
                        Edit to reactivate.
                      </Alert>
                    )}

                  <FormSection title="General">
                    <Box sx={{ position: "relative" }}>
                    {(productState.isEditing || productState.isCreating) && canCreateBrand && (
                      <Box sx={{ position: "absolute", top: -10, right: 34, zIndex: 1, bgcolor: "background.paper", px: 0.25, lineHeight: 1 }}>
                        <Button
                          size="small"
                          variant="text"
                          startIcon={<AddIcon fontSize="small" />}
                          onClick={() => setQuickCreate("brand")}
                          sx={{ textTransform: "none", py: 0, px: 0.5, minHeight: 0, lineHeight: 1.3, fontSize: "0.75rem" }}
                        >
                          Add Brand
                        </Button>
                      </Box>
                    )}
                    <Autocomplete
                      size="small"
                      sx={{ flex: 1 }}
                      options={activeBrands}
                      getOptionLabel={(option) => option.brand_name}
                      value={
                        activeBrands.find(
                          (b) => b.id === productState.formData.items_brand_id,
                        ) ||
                        brands?.find(
                          (b) => b.id === productState.formData.items_brand_id,
                        ) ||
                        null
                      }
                      onChange={(_, newValue) =>
                        productState.setFormData({
                          ...productState.formData,
                          items_brand_id: newValue?.id || 0,
                        })
                      }
                      disabled={!productState.isEditing && !productState.isCreating}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Brand"
                          required
                          error={productTouched.items_brand_id && !productState.formData.items_brand_id}
                          helperText={
                            productTouched.items_brand_id && !productState.formData.items_brand_id
                              ? "Brand is required"
                              : productState.isEditing || productState.isCreating
                              ? "Only active brands can be selected"
                              : ""
                          }
                        />
                      )}
                      isOptionEqualToValue={(option, value) =>
                        option.id === value.id
                      }
                    />
                    </Box>
                    <TextField
                      label="Product Name"
                      inputProps={{ maxLength: 255 }}
                      size="small"
                      value={productState.formData.name}
                      onChange={(e) =>
                        productState.setFormData({
                          ...productState.formData,
                          name: e.target.value,
                        })
                      }
                      onBlur={() => handleProductBlur("name")}
                      disabled={!productState.isEditing && !productState.isCreating}
                      required
                      error={productTouched.name && !(productState.formData.name ?? "").trim()}
                      helperText={
                        productTouched.name && !(productState.formData.name ?? "").trim()
                          ? "Product name is required"
                          : ""
                      }
                    />
                    <TextField
                      label="Description"
                      inputProps={{ maxLength: 5000 }}
                      size="small"
                      value={productState.formData.description}
                      onChange={(e) =>
                        productState.setFormData({
                          ...productState.formData,
                          description: e.target.value,
                        })
                      }
                      disabled={!productState.isEditing && !productState.isCreating}
                      multiline
                      rows={2}
                      sx={{ gridColumn: { sm: "1 / -1" } }}
                    />
                    <Box sx={{ position: "relative" }}>
                    {(productState.isEditing || productState.isCreating) && canCreateCategory && (
                      <Box sx={{ position: "absolute", top: -10, right: 34, zIndex: 1, bgcolor: "background.paper", px: 0.25, lineHeight: 1 }}>
                        <Button
                          size="small"
                          variant="text"
                          startIcon={<AddIcon fontSize="small" />}
                          onClick={() => setQuickCreate("category")}
                          sx={{ textTransform: "none", py: 0, px: 0.5, minHeight: 0, lineHeight: 1.3, fontSize: "0.75rem" }}
                        >
                          Add Category
                        </Button>
                      </Box>
                    )}
                    <Autocomplete
                      size="small"
                      sx={{ flex: 1 }}
                      options={activeCategories}
                      getOptionLabel={(option) => option.name}
                      value={
                        activeCategories.find(
                          (c) => c.id === productState.formData.category_id,
                        ) ||
                        categories?.find(
                          (c) => c.id === productState.formData.category_id,
                        ) ||
                        null
                      }
                      onChange={(_, newValue) =>
                        productState.setFormData({
                          ...productState.formData,
                          category_id: newValue?.id || 0,
                        })
                      }
                      disabled={!productState.isEditing && !productState.isCreating}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Category"
                          required
                          error={productTouched.category_id && !productState.formData.category_id}
                          helperText={
                            productTouched.category_id && !productState.formData.category_id
                              ? "Category is required"
                              : productState.isEditing || productState.isCreating
                              ? "Only active categories can be selected"
                              : ""
                          }
                        />
                      )}
                      isOptionEqualToValue={(option, value) =>
                        option.id === value.id
                      }
                    />
                    </Box>
                    <Box sx={{ position: "relative" }}>
                    {(productState.isEditing || productState.isCreating) && canCreate && (
                      <Box sx={{ position: "absolute", top: -10, right: 34, zIndex: 1, bgcolor: "background.paper", px: 0.25, lineHeight: 1 }}>
                        <Button
                          size="small"
                          variant="text"
                          startIcon={<AddIcon fontSize="small" />}
                          onClick={() => setQuickCreate("product_type")}
                          sx={{ textTransform: "none", py: 0, px: 0.5, minHeight: 0, lineHeight: 1.3, fontSize: "0.75rem" }}
                        >
                          Add Product Type
                        </Button>
                      </Box>
                    )}
                    <Autocomplete
                      size="small"
                      sx={{ flex: 1 }}
                      options={activeProductTypes}
                      getOptionLabel={(option) => option.name}
                      value={activeProductTypes.find((o) => o.id === productState.formData.product_type_id) || null}
                      onChange={(_, newValue) =>
                        productState.setFormData({ ...productState.formData, product_type_id: newValue?.id || 0 })
                      }
                      disabled={!productState.isEditing && !productState.isCreating}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Product Type"
                          required
                          error={productTouched.product_type_id && !productState.formData.product_type_id}
                          helperText={productTouched.product_type_id && !productState.formData.product_type_id ? "Product type is required" : ""}
                        />
                      )}
                      isOptionEqualToValue={(option, value) => option.id === value.id}
                    />
                    </Box>
                    <TextField
                      label="Product Family"
                      size="small"
                      inputProps={{ maxLength: 120 }}
                      value={productState.formData.product_family ?? ""}
                      onChange={(e) => productState.setFormData({ ...productState.formData, product_family: e.target.value })}
                      disabled={!productState.isEditing && !productState.isCreating}
                      required
                      error={productTouched.product_family && !(productState.formData.product_family ?? "").trim()}
                      helperText={
                        productTouched.product_family && !(productState.formData.product_family ?? "").trim()
                          ? "Product family is required"
                          : ""
                      }
                    />
                    <Box sx={{ position: "relative" }}>
                    {(productState.isEditing || productState.isCreating) && canCreate && (
                      <Box sx={{ position: "absolute", top: -10, right: 34, zIndex: 1, bgcolor: "background.paper", px: 0.25, lineHeight: 1 }}>
                        <Button
                          size="small"
                          variant="text"
                          startIcon={<AddIcon fontSize="small" />}
                          onClick={() => setQuickCreate("hs_code")}
                          sx={{ textTransform: "none", py: 0, px: 0.5, minHeight: 0, lineHeight: 1.3, fontSize: "0.75rem" }}
                        >
                          Add HS Code
                        </Button>
                      </Box>
                    )}
                    <Autocomplete
                      size="small"
                      sx={{ flex: 1 }}
                      options={activeHsCodes}
                      getOptionLabel={(option) => option.description ? `${option.code} — ${option.description}` : option.code}
                      value={activeHsCodes.find((o) => o.id === productState.formData.hs_code_id) || null}
                      onChange={(_, newValue) =>
                        productState.setFormData({ ...productState.formData, hs_code_id: newValue?.id || 0 })
                      }
                      disabled={!productState.isEditing && !productState.isCreating}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="HS Code"
                          required
                          error={productTouched.hs_code_id && !productState.formData.hs_code_id}
                          helperText={productTouched.hs_code_id && !productState.formData.hs_code_id ? "HS code is required" : ""}
                        />
                      )}
                      isOptionEqualToValue={(option, value) => option.id === value.id}
                    />
                    </Box>
                    <TextField
                      label="Target Market"
                      size="small"
                      inputProps={{ maxLength: 120 }}
                      value={productState.formData.target_market ?? ""}
                      onChange={(e) => productState.setFormData({ ...productState.formData, target_market: e.target.value })}
                      disabled={!productState.isEditing && !productState.isCreating}
                      placeholder="e.g. Sri Lanka, EU"
                    />
                    <TextField
                      label="Required Certificate"
                      size="small"
                      inputProps={{ maxLength: 255 }}
                      value={productState.formData.required_certificate ?? ""}
                      onChange={(e) => productState.setFormData({ ...productState.formData, required_certificate: e.target.value })}
                      disabled={!productState.isEditing && !productState.isCreating}
                      placeholder="e.g. CE, ISO 9001"
                    />
                  </FormSection>

                  <FormSection title="Stock & Receiving">
                    {!productState.isCreating && (
                      <TextField
                        label="Product Code"
                        size="small"
                        value={productState.selectedItem?.item_code ?? ""}
                        disabled
                        helperText="Generated automatically"
                      />
                    )}
                    {productState.isEditing || productState.isCreating ? (
                      <Autocomplete
                        size="small"
                        options={stockItemOptions}
                        getOptionLabel={(option) => [option.item_code, option.name].filter(Boolean).join(" — ")}
                        value={stockItemOptions.find((m) => m.id === productState.formData.material_id) || null}
                        onChange={(_, newValue) =>
                          productState.setFormData({ ...productState.formData, material_id: newValue?.id })
                        }
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label="Stock Item"
                            placeholder="Search Item Catalog"
                            helperText={
                              productState.isCreating
                                ? "Leave empty to create an item automatically when saving"
                                : "The Item Catalog item this product sells"
                            }
                          />
                        )}
                        isOptionEqualToValue={(option, value) => option.id === value.id}
                      />
                    ) : (
                      <TextField
                        label="Stock Item"
                        size="small"
                        value={
                          productState.selectedItem?.material_id
                            ? [productState.selectedItem.material_item_code, productState.selectedItem.material_name]
                                .filter(Boolean)
                                .join(" — ") || `Item #${productState.selectedItem.material_id}`
                            : ""
                        }
                        placeholder="No stock item (service / non-stock)"
                        InputLabelProps={{ shrink: true }}
                        disabled
                        helperText={productState.selectedItem?.material_id ? "Stocked and bought as this item" : "Not stocked"}
                        InputProps={{
                          endAdornment: productState.selectedItem?.material_id ? (
                            <InputAdornment position="end">
                              <Tooltip title="Open in Item Catalog">
                                <IconButton
                                  size="small"
                                  component={RouterLink}
                                  to={`/materials/item-catalog?focus=${productState.selectedItem.material_id}`}
                                  aria-label="Open in Item Catalog"
                                  sx={{ pointerEvents: "auto" }}
                                >
                                  <OpenInNewIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </InputAdornment>
                          ) : undefined,
                        }}
                      />
                    )}
                    <TextField
                      label="Unit of Measure"
                      size="small"
                      select
                      value={productState.formData.unit_of_measure || "pcs"}
                      onChange={(e) =>
                        productState.setFormData({
                          ...productState.formData,
                          unit_of_measure: e.target.value,
                        })
                      }
                      disabled={!productState.isEditing && !productState.isCreating}
                    >
                      {PRODUCT_UOM.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      label="Tracking Type"
                      size="small"
                      select
                      required
                      value={productState.formData.tracking_type || ""}
                      onChange={(e) =>
                        productState.setFormData({
                          ...productState.formData,
                          tracking_type: e.target.value,
                        })
                      }
                      onBlur={() => handleProductBlur("tracking_type")}
                      disabled={!productState.isEditing && !productState.isCreating}
                      error={productTouched.tracking_type && !productState.formData.tracking_type}
                      helperText={
                        productTouched.tracking_type && !productState.formData.tracking_type
                          ? "Tracking type is required"
                          : "Cannot be changed once the product has stock."
                      }
                      InputLabelProps={{ shrink: true }}
                      SelectProps={{ displayEmpty: true }}
                    >
                      <MenuItem value="" disabled>
                        <em>Select tracking type</em>
                      </MenuItem>
                      {PRODUCT_TRACKING_TYPE.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  </FormSection>


                  <FormSection title="Product Image" columns={1}>
                    <ProductImageUploader
                      product={
                        productState.selectedItem && !productState.isCreating
                          ? productState.selectedItem
                          : undefined
                      }
                      draftFile={draftImageFile}
                      onDraftFileChange={setDraftImageFile}
                      onUpdated={(updated) =>
                        // Guard against the user having since switched to a
                        // different product while this upload/remove was in
                        // flight — don't clobber their current selection.
                        productState.setSelectedItem((current) =>
                          current?.id === updated.id ? updated : current,
                        )
                      }
                      disabled={!productState.isEditing && !productState.isCreating}
                    />
                  </FormSection>

                  <FormSection title="Status">
                    <Box
                      sx={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                        gridColumn: { sm: "1 / -1" },
                      }}
                    >
                      <Box sx={{ display: "flex", gap: 3 }}>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={productState.formData.active}
                              onChange={(e) => {
                                const isActive = e.target.checked;
                                productState.setFormData({
                                  ...productState.formData,
                                  active: isActive,
                                  // Automatically disable website_active if product becomes inactive
                                  website_active: isActive
                                    ? productState.formData.website_active
                                    : false,
                                });
                              }}
                              disabled={
                                !productState.isEditing && !productState.isCreating
                              }
                            />
                          }
                          label="Active"
                        />
                      </Box>
                      {!productState.formData.active &&
                        (productState.isEditing || productState.isCreating) && (
                          <Typography variant="caption" color="warning.main">
                            Note: Inactive products cannot be used in sales,
                            purchases, or displayed on the website.
                          </Typography>
                        )}
                    </Box>
                  </FormSection>

                  {/* Activity History (view mode only) */}
                  {productState.selectedItem &&
                    !productState.isCreating &&
                    !productState.isEditing && (
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
                          <Typography variant="caption" color="text.secondary">
                            Created By
                          </Typography>
                          <Typography variant="body2">
                            {productState.selectedItem.created_by_name || "-"}
                            {productState.selectedItem.created_at
                              ? ` on ${formatDateTimeReadable(productState.selectedItem.created_at)}`
                              : ""}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Last Modified By
                          </Typography>
                          <Typography variant="body2">
                            {productState.selectedItem.updated_by_name || "-"}
                            {productState.selectedItem.updated_at
                              ? ` on ${formatDateTimeReadable(productState.selectedItem.updated_at)}`
                              : ""}
                          </Typography>
                        </Box>
                      </FormSection>
                    )}
                </>
              </TTabPanel>

              <TTabPanel value={activeProductSection} index="pricing" padding={0} sx={{ pt: 2 }}>
                <FormSection title="Pricing" isLast>
                  <TextField
                    label="Cost Price"
                    inputProps={{ min: 0, step: "0.01" }}
                    size="small"
                    type="number"
                    value={productState.formData.cost_price ?? ""}
                    onChange={(e) =>
                      productState.setFormData({
                        ...productState.formData,
                        cost_price: e.target.value
                          ? parseFloat(e.target.value)
                          : undefined,
                      })
                    }
                    onBlur={() => handleProductBlur("cost_price")}
                    disabled={!isPricingEditable}
                    required
                    error={
                      (productTouched.cost_price &&
                      (productState.formData.cost_price === undefined ||
                        productState.formData.cost_price === null)) ||
                      Boolean(priceError(productState.formData.cost_price))
                    }
                    helperText={
                      productTouched.cost_price &&
                      (productState.formData.cost_price === undefined ||
                        productState.formData.cost_price === null)
                        ? "Cost price is required"
                        : priceError(productState.formData.cost_price) ?? ""
                    }
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">{currencySymbol}</InputAdornment>
                      ),
                    }}
                  />
                  <TextField
                    label="Tax Rate (%)"
                    inputProps={{ min: 0, max: 100, step: "0.01" }}
                    size="small"
                    type="number"
                    value={productState.formData.tax_rate ?? ""}
                    onChange={(e) =>
                      productState.setFormData({
                        ...productState.formData,
                        tax_rate: e.target.value ? parseFloat(e.target.value) : 0,
                      })
                    }
                    disabled={!isPricingEditable}
                    helperText="VAT/tax added to this product on purchase orders"
                  />
                  <TextField
                    label="Website Price"
                    inputProps={{ min: 0, step: "0.01" }}
                    size="small"
                    type="number"
                    value={productState.formData.website_price ?? ""}
                    onChange={(e) =>
                      productState.setFormData({
                        ...productState.formData,
                        website_price: e.target.value
                          ? parseFloat(e.target.value)
                          : undefined,
                      })
                    }
                    error={
                      Boolean(priceError(productState.formData.website_price)) ||
                      (typeof productState.formData.website_price === "number" &&
                      productState.formData.website_price > 0 &&
                      typeof productState.formData.cost_price === "number" &&
                      productState.formData.website_price < productState.formData.cost_price)
                    }
                    helperText={
                      priceError(productState.formData.website_price) ??
                      (typeof productState.formData.website_price === "number" &&
                      productState.formData.website_price > 0 &&
                      typeof productState.formData.cost_price === "number" &&
                      productState.formData.website_price < productState.formData.cost_price
                        ? `Cannot be less than cost price`
                        : "")
                    }
                    disabled={!isPricingEditable}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">{currencySymbol}</InputAdornment>
                      ),
                    }}
                  />
                  <TextField
                    label="Selling Price"
                    inputProps={{ min: 0, step: "0.01" }}
                    size="small"
                    type="number"
                    value={productState.formData.selling_price ?? ""}
                    onChange={(e) =>
                      productState.setFormData({
                        ...productState.formData,
                        selling_price: e.target.value
                          ? parseFloat(e.target.value)
                          : undefined,
                      })
                    }
                    onBlur={() => handleProductBlur("selling_price")}
                    disabled={!isPricingEditable}
                    required
                    error={
                      (productTouched.selling_price &&
                      (productState.formData.selling_price === undefined ||
                        productState.formData.selling_price === null)) ||
                      Boolean(priceError(productState.formData.selling_price)) ||
                      (typeof productState.formData.selling_price === "number" &&
                      typeof productState.formData.cost_price === "number" &&
                      productState.formData.selling_price < productState.formData.cost_price)
                    }
                    helperText={
                      productTouched.selling_price &&
                      (productState.formData.selling_price === undefined ||
                        productState.formData.selling_price === null)
                        ? "Selling price is required"
                        : priceError(productState.formData.selling_price)
                        ? priceError(productState.formData.selling_price)
                        : typeof productState.formData.selling_price === "number" &&
                          typeof productState.formData.cost_price === "number" &&
                          productState.formData.selling_price < productState.formData.cost_price
                          ? "Cannot be less than cost price"
                          : ""
                    }
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">{currencySymbol}</InputAdornment>
                      ),
                    }}
                  />
                  <TextField
                    label="Minimum Selling Price"
                    inputProps={{ min: 0, step: "0.01" }}
                    size="small"
                    type="number"
                    value={minPriceInput}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw.trim() === "") {
                        setMinPriceInput("");
                        return;
                      }
                      const parsed = Number(raw);
                      setMinPriceInput(Number.isFinite(parsed) ? parsed : "");
                    }}
                    disabled={!isPricingEditable}
                    error={
                      Boolean(priceError(minPriceInput)) ||
                      typeof minPriceInput === "number" &&
                      (minPriceInput < (productState.formData.cost_price || 0) ||
                        (typeof productState.formData.selling_price === "number" &&
                          minPriceInput > productState.formData.selling_price))
                    }
                    helperText={
                      priceError(minPriceInput) ??
                      (typeof minPriceInput === "number" && minPriceInput < (productState.formData.cost_price || 0)
                        ? `Cannot be less than cost price (${currencySymbol} ${productState.formData.cost_price || 0})`
                        : typeof minPriceInput === "number" &&
                            typeof productState.formData.selling_price === "number" &&
                            minPriceInput > productState.formData.selling_price
                          ? `Cannot be more than selling price (${currencySymbol} ${productState.formData.selling_price})`
                          : "")
                    }
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">{currencySymbol}</InputAdornment>
                      ),
                    }}
                  />
                </FormSection>
              </TTabPanel>

              {productState.selectedItem && !productState.isCreating && (
                <TTabPanel value={activeProductSection} index="designBrief" padding={0}>
                  {designBrief.panel}
                </TTabPanel>
              )}
              {productState.selectedItem && !productState.isCreating && (
                <TTabPanel value={activeProductSection} index="designDetail" padding={0}>
                  {designDetail.panel}
                </TTabPanel>
              )}
              {productState.selectedItem && !productState.isCreating && (
                <TTabPanel value={activeProductSection} index="bomStructure" padding={0}>
                  {bomStructure.panel}
                </TTabPanel>
              )}

            </>
          )}
        </Box>
      </Box>
  );

  // Browse mode: a full-width table of every category.
  const categoryTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<CategoryRow>
          rows={categoryRows}
          serverPagination={{ rowCount: categoriesPage?.total ?? 0, paginationModel: categoryPaging, onPaginationModelChange: setCategoryPaging }}
          exportAllRows={() =>
            fetchAllPages((page) =>
              categoriesApi.getPage({
                page,
                size: 200,
                q: categorySearch.trim(),
                active: activeParam(categoryActiveFilter),
                sort_by: categorySort?.field,
                order: categorySort?.sort,
              })
            )
          }
          onServerSortChange={setCategorySort}
          columns={categoryColumns}
          loading={categoriesLoading}
          onRowClick={(row) => handleSelectCategory(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No categories found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  const categoryDetailPanel = (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
        <DetailPanelHeader
          icon={<CategoryIcon color="primary" />}
          breadcrumbs={[
            { label: "Product Catalogs", href: "/product-catalogs" },
            { label: "Categories" },
          ]}
          title={
            categoryState.isCreating
              ? "New Category"
              : categoryState.selectedItem
                ? categoryState.selectedItem.name
                : "Select a Category"
          }
          chips={
            categoryState.selectedItem && !categoryState.isCreating
              ? [
                  {
                    label: categoryState.selectedItem.active
                      ? "Active"
                      : "Inactive",
                    color: categoryState.selectedItem.active
                      ? "success"
                      : "default",
                  },
                ]
              : undefined
          }
        />

        <ActionToolbar
          canCreate={canCreateCategory}
          canUpdate={canUpdateCategory}
          isEditing={categoryState.isEditing}
          isCreating={categoryState.isCreating}
          hasSelection={!!categoryState.selectedItem}
          onAdd={handleNewCategory}
          onEdit={() => categoryState.setIsEditing(true)}
          onSave={handleSaveCategory}
          onCancel={handleCancelCategory}
          isSaving={
            createCategoryMutation.isPending || updateCategoryMutation.isPending
          }
          saveDisabled={!(categoryState.formData.name ?? "").trim()}
          onInvalidSave={() => setCategoryTouched({ name: true })}
        />

        <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
          {!categoryState.selectedItem && !categoryState.isCreating ? (
            <EmptyState message="Select a category from the list or create a new one" />
          ) : (
            <>
              {/* Show inactive warning */}
              {categoryState.selectedItem &&
                !categoryState.selectedItem.active &&
                !categoryState.isCreating && (
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    This category is inactive and cannot be assigned to new
                    products. Edit to reactivate.
                  </Alert>
                )}

              <FormSection title="Category Information">
                <TextField
                  label="Category Name"
                  inputProps={{ maxLength: 255 }}
                  size="small"
                  value={categoryState.formData.name}
                  onChange={(e) =>
                    categoryState.setFormData({
                      ...categoryState.formData,
                      name: e.target.value,
                    })
                  }
                  onBlur={() => handleCategoryBlur("name")}
                  disabled={
                    !categoryState.isEditing && !categoryState.isCreating
                  }
                  required
                  error={categoryTouched.name && !(categoryState.formData.name ?? "").trim()}
                  helperText={
                    categoryTouched.name && !(categoryState.formData.name ?? "").trim()
                      ? "Category name is required"
                      : ""
                  }
                />
                <TextField
                  label="Category Code"
                  size="small"
                  value={
                    categoryState.isCreating
                      ? ""
                      : (categoryState.selectedItem?.category_code ?? "")
                  }
                  placeholder={
                    categoryState.isCreating ? "Auto-generated on save" : ""
                  }
                  disabled
                  helperText="Generated automatically"
                />
                <TextField
                  label="Memo"
                  inputProps={{ maxLength: 255 }}
                  size="small"
                  value={categoryState.formData.memo}
                  onChange={(e) =>
                    categoryState.setFormData({
                      ...categoryState.formData,
                      memo: e.target.value,
                    })
                  }
                  disabled={
                    !categoryState.isEditing && !categoryState.isCreating
                  }
                />
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={categoryState.formData.active}
                        onChange={(e) =>
                          categoryState.setFormData({
                            ...categoryState.formData,
                            active: e.target.checked,
                          })
                        }
                        disabled={
                          !categoryState.isEditing && !categoryState.isCreating
                        }
                      />
                    }
                    label="Active"
                  />
                  {!categoryState.formData.active &&
                    (categoryState.isEditing || categoryState.isCreating) && (
                      <Typography variant="caption" color="warning.main">
                        Note: Inactive categories cannot be assigned to new
                        products.
                      </Typography>
                    )}
                </Box>
                <TextField
                  label="Description"
                  inputProps={{ maxLength: 5000 }}
                  size="small"
                  value={categoryState.formData.description}
                  onChange={(e) =>
                    categoryState.setFormData({
                      ...categoryState.formData,
                      description: e.target.value,
                    })
                  }
                  disabled={
                    !categoryState.isEditing && !categoryState.isCreating
                  }
                  multiline
                  rows={3}
                  sx={{ gridColumn: { sm: "1 / -1" } }}
                />
              </FormSection>

              {/* Activity History (view mode only) */}
              {categoryState.selectedItem &&
                !categoryState.isCreating &&
                !categoryState.isEditing && (
                  <FormSection
                    title="Activity History"
                    columns={2}
                    isLast
                    titleAction={
                      <Tooltip title="View activity history">
                        <IconButton size="small" onClick={() => setActivityHistoryOpen(true)}>
                          <HistoryIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    }
                  >
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Created By
                      </Typography>
                      <Typography variant="body2">
                        {categoryState.selectedItem.created_by_name || "-"}
                        {categoryState.selectedItem.created_at
                          ? ` on ${formatDateTimeReadable(categoryState.selectedItem.created_at)}`
                          : ""}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Last Modified By
                      </Typography>
                      <Typography variant="body2">
                        {categoryState.selectedItem.updated_by_name || "-"}
                        {categoryState.selectedItem.updated_at
                          ? ` on ${formatDateTimeReadable(categoryState.selectedItem.updated_at)}`
                          : ""}
                      </Typography>
                    </Box>
                  </FormSection>
                )}
            </>
          )}
        </Box>
      </Box>
  );

  // Browse mode: a full-width table of every brand.
  const brandTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<BrandRow>
          rows={brandRows}
          serverPagination={{ rowCount: brandsPage?.total ?? 0, paginationModel: brandPaging, onPaginationModelChange: setBrandPaging }}
          exportAllRows={() =>
            fetchAllPages((page) =>
              brandsApi.getPage({
                page,
                size: 200,
                q: brandSearch.trim(),
                active: activeParam(brandActiveFilter),
                sort_by: brandSort?.field,
                order: brandSort?.sort,
              })
            )
          }
          onServerSortChange={setBrandSort}
          columns={brandColumns}
          loading={brandsLoading}
          onRowClick={(row) => handleSelectBrand(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No brands found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  const brandDetailPanel = (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
        <DetailPanelHeader
          icon={<BrandIcon color="primary" />}
          breadcrumbs={[
            { label: "Product Catalogs", href: "/product-catalogs" },
            { label: "Brands" },
          ]}
          title={
            brandState.isCreating
              ? "New Brand"
              : brandState.selectedItem
                ? brandState.selectedItem.brand_name
                : "Select a Brand"
          }
          chips={
            brandState.selectedItem && !brandState.isCreating
              ? [
                  {
                    label: brandState.selectedItem.active
                      ? "Active"
                      : "Inactive",
                    color: brandState.selectedItem.active
                      ? "success"
                      : "default",
                  },
                ]
              : undefined
          }
        />

        <ActionToolbar
          canCreate={canCreateBrand}
          canUpdate={canUpdateBrand}
          isEditing={brandState.isEditing}
          isCreating={brandState.isCreating}
          hasSelection={!!brandState.selectedItem}
          onAdd={handleNewBrand}
          onEdit={() => brandState.setIsEditing(true)}
          onSave={handleSaveBrand}
          onCancel={handleCancelBrand}
          isSaving={
            createBrandMutation.isPending || updateBrandMutation.isPending
          }
          saveDisabled={!(brandState.formData.brand_name ?? "").trim()}
          onInvalidSave={() => setBrandTouched({ brand_name: true })}
        />

        <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
          {!brandState.selectedItem && !brandState.isCreating ? (
            <EmptyState message="Select a brand from the list or create a new one" />
          ) : (
            <>
              {/* Show inactive warning */}
              {brandState.selectedItem &&
                !brandState.selectedItem.active &&
                !brandState.isCreating && (
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    This brand is inactive and cannot be assigned to new
                    products. Edit to reactivate.
                  </Alert>
                )}

              <FormSection title="Brand Information">
              <TextField
                label="Brand Name"
                inputProps={{ maxLength: 255 }}
                size="small"
                value={brandState.formData.brand_name}
                onChange={(e) =>
                  brandState.setFormData({
                    ...brandState.formData,
                    brand_name: e.target.value,
                  })
                }
                onBlur={() => handleBrandBlur("brand_name")}
                disabled={!brandState.isEditing && !brandState.isCreating}
                required
                error={
                  brandTouched.brand_name && !(brandState.formData.brand_name ?? "").trim()
                }
                helperText={
                  brandTouched.brand_name && !(brandState.formData.brand_name ?? "").trim()
                    ? "Brand name is required"
                    : ""
                }
              />
              <TextField
                label="Brand Code"
                size="small"
                value={
                  brandState.isCreating
                    ? ""
                    : (brandState.selectedItem?.brand_code ?? "")
                }
                placeholder={
                  brandState.isCreating ? "Auto-generated on save" : ""
                }
                disabled
                helperText="Generated automatically"
              />
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={brandState.formData.active ?? true}
                      onChange={(e) =>
                        brandState.setFormData({
                          ...brandState.formData,
                          active: e.target.checked,
                        })
                      }
                      disabled={
                        !brandState.isEditing && !brandState.isCreating
                      }
                    />
                  }
                  label="Active"
                />
                {!(brandState.formData.active ?? true) &&
                  (brandState.isEditing || brandState.isCreating) && (
                    <Typography variant="caption" color="warning.main">
                      Note: Inactive brands cannot be assigned to new
                      products.
                    </Typography>
                  )}
              </Box>
              <TextField
                label="Description"
                inputProps={{ maxLength: 5000 }}
                size="small"
                value={brandState.formData.description}
                onChange={(e) =>
                  brandState.setFormData({
                    ...brandState.formData,
                    description: e.target.value,
                  })
                }
                disabled={!brandState.isEditing && !brandState.isCreating}
                multiline
                rows={3}
                sx={{ gridColumn: { sm: "1 / -1" } }}
              />
            </FormSection>

              {/* Activity History (view mode only) */}
              {brandState.selectedItem &&
                !brandState.isCreating &&
                !brandState.isEditing && (
                  <FormSection
                    title="Activity History"
                    columns={2}
                    isLast
                    titleAction={
                      <Tooltip title="View activity history">
                        <IconButton size="small" onClick={() => setActivityHistoryOpen(true)}>
                          <HistoryIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    }
                  >
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Created By
                      </Typography>
                      <Typography variant="body2">
                        {brandState.selectedItem.created_by_name || "-"}
                        {brandState.selectedItem.created_at
                          ? ` on ${formatDateTimeReadable(brandState.selectedItem.created_at)}`
                          : ""}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Last Modified By
                      </Typography>
                      <Typography variant="body2">
                        {brandState.selectedItem.updated_by_name || "-"}
                        {brandState.selectedItem.updated_at
                          ? ` on ${formatDateTimeReadable(brandState.selectedItem.updated_at)}`
                          : ""}
                      </Typography>
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
        title={pageTitle}
        titleSlot={
          activeTab === 0 ? (
            isProductDetailMode ? (
              <Button
                size="small"
                startIcon={<ArrowBackIcon fontSize="small" />}
                onClick={handleBackToProducts}
                sx={{ textTransform: "none" }}
              >
                Back to Products
              </Button>
            ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search product..."
                value={productState.searchQuery}
                onChange={(e) => productState.setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                }}
                sx={{ width: 160, flexShrink: 0 }}
              />
              <Box sx={{ width: 110, flexShrink: 0 }}>
                <TStatusFilter
                  options={PRODUCT_ACTIVE_FILTER_OPTIONS}
                  value={productActiveFilter}
                  onChange={setProductActiveFilter}
                  label=""
                  placeholder="All Status"
                  size="small"
                />
              </Box>
              <Box sx={{ width: 130, flexShrink: 0 }}>
                <TAutocomplete<Category>
                  label=""
                  placeholder="All Categories"
                  options={categories || []}
                  value={productCategoryFilter}
                  onChange={(value) => setProductCategoryFilter(value as Category | null)}
                  getOptionLabel={(c) => c.name}
                  size="small"
                />
              </Box>
              <Box sx={{ width: 130, flexShrink: 0 }}>
                <TAutocomplete<Brand>
                  label=""
                  placeholder="All Brands"
                  options={brands || []}
                  value={productBrandFilter}
                  onChange={(value) => setProductBrandFilter(value as Brand | null)}
                  getOptionLabel={(b) => b.brand_name}
                  size="small"
                />
              </Box>
              {(productState.searchQuery || productActiveFilter || productCategoryFilter || productBrandFilter) && (
                <Button size="small" onClick={handleClearProductFilters} sx={{ textTransform: "none" }}>
                  Clear
                </Button>
              )}
            </Box>
            )
          ) : activeTab === 1 ? (
            isCategoryDetailMode ? (
              <Button
                size="small"
                startIcon={<ArrowBackIcon fontSize="small" />}
                onClick={handleBackToCategories}
                sx={{ textTransform: "none" }}
              >
                Back to Categories
              </Button>
            ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search category..."
                value={categoryState.searchQuery}
                onChange={(e) => categoryState.setSearchQuery(e.target.value)}
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
                <TStatusFilter
                  options={PRODUCT_ACTIVE_FILTER_OPTIONS}
                  value={categoryActiveFilter}
                  onChange={setCategoryActiveFilter}
                  label=""
                  placeholder="All Status"
                  size="small"
                />
              </Box>
              {(categoryState.searchQuery || categoryActiveFilter) && (
                <Button size="small" onClick={handleClearCategoryFilters} sx={{ textTransform: "none" }}>
                  Clear
                </Button>
              )}
            </Box>
            )
          ) : (
            isBrandDetailMode ? (
              <Button
                size="small"
                startIcon={<ArrowBackIcon fontSize="small" />}
                onClick={handleBackToBrands}
                sx={{ textTransform: "none" }}
              >
                Back to Brands
              </Button>
            ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search brand..."
                value={brandState.searchQuery}
                onChange={(e) => brandState.setSearchQuery(e.target.value)}
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
                <TStatusFilter
                  options={PRODUCT_ACTIVE_FILTER_OPTIONS}
                  value={brandActiveFilter}
                  onChange={setBrandActiveFilter}
                  label=""
                  placeholder="All Status"
                  size="small"
                />
              </Box>
              {(brandState.searchQuery || brandActiveFilter) && (
                <Button size="small" onClick={handleClearBrandFilters} sx={{ textTransform: "none" }}>
                  Clear
                </Button>
              )}
            </Box>
            )
          )
        }
        onRefresh={handleRefresh}
        headerActions={
          activeTab === 0 ? (
            isProductDetailMode ? undefined : (
              canCreate && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={handleNewProduct}
                  sx={{ mr: 1 }}
                >
                  Add Product
                </Button>
              )
            )
          ) : activeTab === 1 ? (
            isCategoryDetailMode ? undefined : (
              canCreateCategory && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={handleNewCategory}
                  sx={{ mr: 1 }}
                >
                  Add Category
                </Button>
              )
            )
          ) : activeTab === 2 ? (
            isBrandDetailMode ? undefined : (
              canCreateBrand && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={handleNewBrand}
                  sx={{ mr: 1 }}
                >
                  Add Brand
                </Button>
              )
            )
          ) : undefined
        }
        {...(!hideTabs
          ? {
              tabs,
              activeTab,
              onTabChange: (tab: number | string) =>
                setActiveTab(tab as number),
            }
          : {})}
        {...(activeTab === 0
          ? isProductDetailMode
            ? { children: productDetailPanel }
            : { children: productTablePanel }
          : activeTab === 1
            ? isCategoryDetailMode
              ? { children: categoryDetailPanel }
              : { children: categoryTablePanel }
            : isBrandDetailMode
              ? { children: brandDetailPanel }
              : { children: brandTablePanel })}
      />

      <QuickCreateLookupDialog<{ id: number }>
        open={quickCreate !== null}
        kind={quickCreate ?? "category"}
        onClose={() => setQuickCreate(null)}
        create={(d) =>
          quickCreate === "brand"
            ? brandsApi.create({ brand_name: d.name, description: d.description })
            : quickCreate === "product_type"
              ? productTypesApi.create({ name: d.name })
              : quickCreate === "hs_code"
                ? hsCodesApi.create({ code: d.name, description: d.description })
                : categoriesApi.create({ name: d.name, description: d.description })
        }
        onCreated={(record) => {
          if (quickCreate === "product_type") {
            queryClient.invalidateQueries({ queryKey: ["product-types"] });
            productState.setFormData({ ...productState.formData, product_type_id: record.id });
          } else if (quickCreate === "hs_code") {
            queryClient.invalidateQueries({ queryKey: ["hs-codes"] });
            productState.setFormData({ ...productState.formData, hs_code_id: record.id });
          } else if (quickCreate === "brand") {
            queryClient.invalidateQueries({ queryKey: ["brands"] });
            productState.setFormData({ ...productState.formData, items_brand_id: record.id });
          } else {
            queryClient.invalidateQueries({ queryKey: ["categories"] });
            productState.setFormData({ ...productState.formData, category_id: record.id });
          }
        }}
      />

      {/* Single unified confirm dialog */}
      <TConfirmDialog {...confirmDialog.dialogProps} />

      <TActivityHistoryPanel
        open={activityHistoryOpen}
        onClose={() => setActivityHistoryOpen(false)}
        entityType={activeTab === 1 ? "category" : activeTab === 2 ? "brand" : "product"}
        entityId={
          activeTab === 1
            ? categoryState.selectedItem?.id
            : activeTab === 2
              ? brandState.selectedItem?.id
              : productState.selectedItem?.id
        }
        actionLabels={{
          create: "Created",
          update: "Updated",
          delete: "Deleted",
        }}
      />
    </>
  );
}
