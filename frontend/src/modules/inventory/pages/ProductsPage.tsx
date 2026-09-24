import { usePermission } from "@/auth/permissions";
import {
    ActionToolbar,
    DetailPanelHeader,
    EmptyState,
    fmtLKR,
    FormSection,
    getChoiceLabel,
    MasterDetailLayout,
    PRODUCT_ITEM_TYPE,
    PRODUCT_UOM,
    SelectableListItem,
    showErrorToast,
    TabConfig,
    TAutocomplete,
    TConfirmDialog,
    TDataGrid,
    type TDataGridColumn,
    TExportButton,
    TSectionNav,
    TStatusFilter,
    useConfirmDialog,
  useCrudMutation,
    useMasterDetailState,
    TActivityHistoryPanel,
    type TSectionNavItem,
} from "@/components/tijaero";
import { formatDateTimeReadable } from "@/utils/formatters";
import {
    Add as AddIcon,
    ArrowBack as ArrowBackIcon,
    AttachMoney as PricingIcon,
    Sell as BrandIcon,
    Category as CategoryIcon,
    History as HistoryIcon,
    Inventory as InventoryIcon,
    LocalShipping as SuppliersIcon,
    Search as SearchIcon,
    Clear as ClearIcon,
    Star as StarIcon,
    StarBorder as StarOutlineIcon,
    OpenInNew as OpenInNewIcon,
} from "@mui/icons-material";
import {
    Alert,
    Autocomplete,
    Avatar,
    Box,
    Button,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    IconButton,
    InputAdornment,
    MenuItem,
    Paper,
    Switch,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material";
  import type { GridRenderCellParams } from "@mui/x-data-grid";
  import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { brandsApi, categoriesApi, minimumPriceApi, productImageUrl, productsApi } from "../api";
import ProductImageUploader from "../components/ProductImageUploader";
import ProductSuppliersList, {
    PendingSupplierMapping,
} from "../components/ProductSuppliersList";
import { suppliersApi } from "@/modules/purchasing/api";
import type { Supplier } from "@/modules/purchasing/types";
import {
    Brand,
    BrandCreate,
    BrandUpdate,
    Category,
    CategoryCreate,
    CategoryUpdate,
    Product,
    ProductCreate,
} from "../types";

const PRODUCT_SECTION_NAV_ITEMS: TSectionNavItem[] = [
  { key: "pricing", label: "Pricing", icon: <PricingIcon fontSize="small" /> },
  { key: "suppliers", label: "Suppliers", icon: <SuppliersIcon fontSize="small" /> },
];

const PRODUCT_ACTIVE_FILTER_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

// Initial form data
const emptyProductForm: ProductCreate = {
  name: "",
  item_code: "",
  model: "",
  item_type: "inventory",
  unit_of_measure: "pcs",
  description: "",
  website_active: false,
  website_price: undefined,
  selling_price: undefined,
  active: true,
  cost_price: undefined,
  category_id: 0,
  items_brand_id: 0,
  image_url: "",
};

const emptyCategoryForm: CategoryCreate = {
  name: "",
  category_code: "",
  memo: "",
  description: "",
  active: true,
};

const emptyBrandForm: BrandCreate = {
  brand_name: "",
  brand_code: "",
  description: "",
};

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

  useEffect(() => {
    if (hideTabs) {
      const nextTab = viewToTab(view);
      if (activeTab !== nextTab) setActiveTab(nextTab);
    }
  }, [view, hideTabs, activeTab]);

  // Permissions
  const canCreate = usePermission("products", "create");
  const canUpdate = usePermission("products", "update");
  const canDelete = usePermission("products", "delete");

  const queryClient = useQueryClient();

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
  const [productSupplierFilter, setProductSupplierFilter] = useState<Supplier | null>(null);
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

  // Detail panel section navigation (Pricing / Suppliers), shown below the
  // selected product in the master list — null shows the default "Main"
  // content (Basic Info + Classification + Status + Record Info).
  const [activeProductSection, setActiveProductSection] = useState<
    "pricing" | "suppliers" | null
  >(null);
  const handleProductSectionNavChange = useCallback((key: string) => {
    setActiveProductSection((prev) =>
      prev === key ? null : (key as "pricing" | "suppliers"),
    );
  }, []);

  // Supplier mappings staged while creating a new product — there's no
  // product id yet to attach them to, so they're held here and pushed to
  // the backend once the product is created (see createProductMutation).
  const [pendingSupplierMappings, setPendingSupplierMappings] = useState<
    PendingSupplierMapping[]
  >([]);

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
    setProductSupplierFilter(null);
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

  // Queries - get all items including inactive so they can be viewed and reactivated
  const {
    data: products,
    isLoading: productsLoading,
    refetch: refetchProducts,
  } = useQuery({
    queryKey: ["products"],
    queryFn: () => productsApi.getAll(0, 1000, false), // Get all including inactive
    enabled: activeTab === 0,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const {
    data: categories,
    isLoading: categoriesLoading,
    refetch: refetchCategories,
  } = useQuery({
    queryKey: ["categories"],
    queryFn: () => categoriesApi.getAll(0, 1000, false), // Get all including inactive
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const {
    data: brands,
    isLoading: brandsLoading,
    refetch: refetchBrands,
  } = useQuery({
    queryKey: ["brands"],
    queryFn: () => brandsApi.getAll(0, 1000, false), // Get all including inactive
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

  // Fetch current minimum selling price for selected product
  const { data: currentMinPrice } = useQuery({
    queryKey: ["minimum-price", productState.selectedItem?.id],
    queryFn: () => minimumPriceApi.getCurrent(productState.selectedItem!.id),
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

  // Suppliers list for the product filter bar's "Supplier" picker
  const { data: suppliersForFilter = [] } = useQuery({
    queryKey: ["suppliers-for-product-filter"],
    queryFn: () => suppliersApi.getAll({ active: true }),
    enabled: activeTab === 0,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Which products the currently-filtered-by supplier can supply — fetched
  // only once a supplier filter is actually applied.
  const { data: supplierFilterMappings = [] } = useQuery({
    queryKey: ["supplier-product-filter", productSupplierFilter?.id],
    queryFn: () => suppliersApi.getProducts(productSupplierFilter!.id),
    enabled: !!productSupplierFilter,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  //consiltered and sorted data
  const filteredProducts = useMemo(() => {
    if (!products) return [];
    let filtered = products.filter(
      (p) =>
        p.item_code
          .toLowerCase()
          .includes(productState.searchQuery.toLowerCase()) ||
        p.name.toLowerCase().includes(productState.searchQuery.toLowerCase()) ||
        p.model?.toLowerCase().includes(productState.searchQuery.toLowerCase()),
    );

    // Apply active filter
    if (productActiveFilter) {
      const isActive = productActiveFilter === "active";
      filtered = filtered.filter((p) => p.active === isActive);
    }

    // Apply supplier filter — restrict to products that supplier can supply
    if (productSupplierFilter) {
      const supplierProductIds = new Set(supplierFilterMappings.map((m) => m.product_id));
      filtered = filtered.filter((p) => supplierProductIds.has(p.id));
    }

    // Apply category / brand filters
    if (productCategoryFilter) {
      filtered = filtered.filter((p) => p.category_id === productCategoryFilter.id);
    }
    if (productBrandFilter) {
      filtered = filtered.filter((p) => p.items_brand_id === productBrandFilter.id);
    }

    // Default order before the user sorts a column in the table itself
    // (the table's own column-header sort takes over from there).
    filtered.sort((a, b) => a.item_code.localeCompare(b.item_code));
    return filtered;
  }, [
    products,
    productState.searchQuery,
    productActiveFilter,
    productSupplierFilter,
    supplierFilterMappings,
    productCategoryFilter,
    productBrandFilter,
  ]);

  const filteredCategories = useMemo(() => {
    if (!categories) return [];
    let filtered = categories.filter(
      (c) =>
        c.name
          .toLowerCase()
          .includes(categoryState.searchQuery.toLowerCase()) ||
        c.category_code
          .toLowerCase()
          .includes(categoryState.searchQuery.toLowerCase()),
    );
    if (categoryActiveFilter) {
      const isActive = categoryActiveFilter === "active";
      filtered = filtered.filter((c) => c.active === isActive);
    }
    // Default order before the user sorts a column in the table itself.
    filtered.sort((a, b) => a.name.localeCompare(b.name));
    return filtered;
  }, [categories, categoryState.searchQuery, categoryActiveFilter]);

  const filteredBrands = useMemo(() => {
    if (!brands) return [];
    let filtered = brands.filter(
      (b) =>
        b.brand_name
          .toLowerCase()
          .includes(brandState.searchQuery.toLowerCase()) ||
        b.brand_code
          .toLowerCase()
          .includes(brandState.searchQuery.toLowerCase()),
    );
    if (brandActiveFilter) {
      const isActive = brandActiveFilter === "active";
      filtered = filtered.filter((b) => b.active === isActive);
    }
    // Default order before the user sorts a column in the table itself.
    filtered.sort((a, b) => a.brand_name.localeCompare(b.brand_name));
    return filtered;
  }, [brands, brandState.searchQuery, brandActiveFilter]);

  // Browse-table rows/columns. Rows add display-only lookup fields (category
  // name, brand name) so the grid sorts on the displayed text rather than the
  // raw id; columns have no `sortable: false` on the real-data fields, so
  // sorting is done per-column via the grid's own column header menu.
  const productRows = useMemo(
    () =>
      filteredProducts.map((product) => ({
        ...product,
        category_name: categories?.find((c) => c.id === product.category_id)?.name || "-",
        brand_name: brands?.find((b) => b.id === product.items_brand_id)?.brand_name || "-",
      })),
    [filteredProducts, categories, brands]
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
      {
        field: "favorite",
        header: "",
        width: 48,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<ProductRow>) => (
          <IconButton
            size="small"
            onClick={(e) => productState.toggleFavorite(params.row.id, e)}
          >
            {productState.favorites.includes(params.row.id) ? (
              <StarIcon fontSize="small" color="warning" />
            ) : (
              <StarOutlineIcon fontSize="small" color="action" />
            )}
          </IconButton>
        ),
      },
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
      { field: "category_name", header: "Category", width: 160 },
      { field: "brand_name", header: "Brand", width: 140 },
      {
        field: "unit_of_measure",
        header: "UOM",
        width: 90,
        renderCell: (params: GridRenderCellParams<ProductRow>) =>
          getChoiceLabel(PRODUCT_UOM, params.row.unit_of_measure),
      },
      {
        field: "preferred_supplier_name",
        header: "Preferred Supplier",
        flex: 1,
        minWidth: 160,
        renderCell: (params: GridRenderCellParams<ProductRow>) =>
          params.row.preferred_supplier_name || "-",
      },
      {
        field: "cost_price",
        header: "Cost Price",
        width: 130,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<ProductRow>) => `Rs. ${fmtLKR(params.row.cost_price || 0)}`,
      },
      {
        field: "selling_price",
        header: "Sell Price",
        width: 130,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<ProductRow>) => `Rs. ${fmtLKR(params.row.selling_price || 0)}`,
      },
      {
        field: "minimum_selling_price",
        header: "Min. Sell Price",
        width: 130,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<ProductRow>) =>
          params.row.minimum_selling_price != null ? `Rs. ${fmtLKR(params.row.minimum_selling_price)}` : "-",
      },
      {
        field: "active",
        header: "Status",
        width: 110,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<ProductRow>) => (
          <Chip
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
    [productState.favorites, productState.toggleFavorite, handleSelectProduct]
  );

  const categoryRows: CategoryRow[] = filteredCategories;

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
          <Chip
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

  const brandRows: BrandRow[] = filteredBrands;

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
          <Chip
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

  // Mutations
  const createProductMutation = useCrudMutation({
    mutationFn: productsApi.create,
    // Also invalidate the referenceData cache so product selectors in purchasing,
    // sales, warehouse etc. immediately reflect the new product without a hard refresh.
    invalidateQueryKeys: [["products"], ["referenceData"]],
    successMessage: "Product created successfully",
    errorMessage: "Failed to create product",
    onSuccess: (newProduct) => {
      productState.setIsCreating(false);
      productState.setIsEditing(false);
      productState.setSelectedItem(newProduct);

      const priceToSet =
        typeof minPriceInput === "number" ? minPriceInput : 0;
      if (priceToSet > 0 && canUpdate) {
        setMinimumPriceForProductMutation.mutate({
          productId: newProduct.id,
          price: priceToSet,
        });
      }
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

      if (pendingSupplierMappings.length > 0) {
        const mappingsToCreate = pendingSupplierMappings;
        setPendingSupplierMappings([]);
        Promise.all(
          mappingsToCreate.map((m) =>
            suppliersApi.createProduct(m.supplier_id, {
              product_id: newProduct.id,
              supplier_sku: m.supplier_sku || undefined,
              cost_price: m.cost_price,
              minimum_order_qty: m.minimum_order_qty,
              is_preferred: m.is_preferred,
              active: m.active,
            }),
          ),
        )
          .then(() =>
            queryClient.invalidateQueries({
              queryKey: ["product-suppliers", newProduct.id],
            }),
          )
          .catch(() =>
            showErrorToast(
              "Product created, but some supplier mappings failed to save",
            ),
          );
      }
    },
  });

  const updateProductMutation = useCrudMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ProductCreate> }) =>
      productsApi.update(id, data),
    invalidateQueryKeys: [["products"], ["referenceData"]],
    successMessage: "Product updated successfully",
    errorMessage: "Failed to update product",
    onSuccess: (updatedProduct) => {
      productState.setIsEditing(false);
      productState.setSelectedItem(updatedProduct);

      // Minimum price lives in its own history-tracked table, so it's only
      // saved (a new history row created) when the user actually changed it
      // — re-submitting the same value on every edit would pollute the
      // price history with no-op entries.
      if (
        typeof minPriceInput === "number" &&
        minPriceInput !== (currentMinPrice?.minimum_price ?? -1) &&
        canUpdate
      ) {
        setMinimumPriceForProductMutation.mutate({
          productId: updatedProduct.id,
          price: minPriceInput,
        });
      }
    },
  });

  const deleteProductMutation = useCrudMutation({
    mutationFn: productsApi.delete,
    invalidateQueryKeys: [["products"], ["referenceData"]],
    getSuccessMessage: (data) =>
      data?.message || "Product deleted successfully",
    errorMessage: "Failed to delete product",
    onSuccess: (data) => {
      productState.setSelectedItem(null);
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
      categoryState.setIsEditing(false);
      categoryState.setSelectedItem(updatedCategory);
    },
  });

  const deleteCategoryMutation = useCrudMutation({
    mutationFn: categoriesApi.delete,
    invalidateQueryKeys: [["categories"], ["referenceData"]],
    getSuccessMessage: (data) =>
      data?.message || "Category deleted successfully",
    errorMessage: "Failed to delete category",
    onSuccess: (data) => {
      categoryState.setSelectedItem(null);
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
      brandState.setIsEditing(false);
      brandState.setSelectedItem(updatedBrand);
    },
  });

  const deleteBrandMutation = useCrudMutation({
    mutationFn: brandsApi.delete,
    invalidateQueryKeys: [["brands"], ["referenceData"]],
    getSuccessMessage: (data) => data?.message || "Brand deleted successfully",
    errorMessage: "Failed to delete brand",
    onSuccess: (data) => {
      brandState.setSelectedItem(null);
    },
  });

  // Minimum selling price mutation
  const setMinimumPriceForProductMutation = useCrudMutation({
    mutationFn: ({ productId, price }: { productId: number; price: number }) =>
      minimumPriceApi.set(productId, { minimum_price: price }),
    getInvalidateQueryKeys: (_data, variables) => [
      ["minimum-price", variables.productId],
    ],
    successMessage: "Minimum selling price set successfully",
    errorMessage: "Failed to set minimum selling price",
  });


  // Product handlers
  const selectProductInternal = (product: Product) => {
    productState.setSelectedItem(product);
    productState.setFormData({
      name: product.name,
      item_code: product.item_code,
      model: product.model || "",
      item_type: product.item_type,
      unit_of_measure: product.unit_of_measure || "pcs",
      description: product.description || "",
      website_active: product.website_active,
      website_price: product.website_price || 0,
      selling_price: product.selling_price || 0,
      active: product.active,
      cost_price: product.cost_price,
      category_id: product.category_id,
      items_brand_id: product.items_brand_id,
      image_url: product.image_url || "",
    });
    productState.setIsEditing(false);
    productState.setIsCreating(false);
  };

  const handleNewProduct = () => {
    // Category/Brand start unselected — the user must explicitly choose,
    // not have the first active one picked for them.
    productState.setSelectedItem(null);
    productState.setFormData(emptyProductForm);
    setMinPriceInput("");
    setProductTouched({});
    setPendingSupplierMappings([]);
    setDraftImageFile(null);
    productState.setIsCreating(true);
    productState.setIsEditing(true);
  };

  const handleDuplicateProduct = () => {
    if (productState.selectedItem) {
      productState.setFormData({
        ...productState.formData,
        item_code: `${productState.selectedItem.item_code}-COPY`,
        name: `${productState.selectedItem.name} (Copy)`,
      });
      setMinPriceInput("");
      setPendingSupplierMappings([]);
      setDraftImageFile(null);
      productState.setIsCreating(true);
      productState.setIsEditing(true);
    }
  };

  const handleSaveProduct = () => {
    // Validate required fields
    if (
      !productState.formData.item_code ||
      !productState.formData.name ||
      productState.formData.cost_price === undefined ||
      productState.formData.cost_price === null ||
      productState.formData.selling_price === undefined ||
      productState.formData.selling_price === null ||
      !productState.formData.category_id ||
      !productState.formData.items_brand_id
    ) {
      showErrorToast("Please fill in all required fields");
      setProductTouched({
        item_code: true,
        name: true,
        cost_price: true,
        selling_price: true,
      });
      return;
    }
    // Check for duplicate name
    if (products) {
      const isDuplicateName = products.some(
        (p) =>
          p.name.trim().toLowerCase() === productState.formData.name?.trim().toLowerCase() &&
          (!productState.selectedItem || p.id !== productState.selectedItem.id)
      );
      if (isDuplicateName) {
        showErrorToast("Product name already exists");
        return;
      }
    }
    
    // Validate prices
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

    // Ensure website_active is false if product is inactive
    const dataToSave = { ...productState.formData };
    if (!dataToSave.active) {
      dataToSave.website_active = false;
    }

    if (productState.isCreating) {
      createProductMutation.mutate(dataToSave);
    } else if (productState.selectedItem) {
      updateProductMutation.mutate({
        id: productState.selectedItem.id,
        data: dataToSave,
      });
    }
  };

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
      setPendingSupplierMappings([]);
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

  const handleDeleteProduct = async () => {
    if (productState.selectedItem) {
      const confirmed = await confirmDialog.confirm({
        title: "Delete Product",
        message:
          "Are you sure you want to permanently delete this product? This action cannot be undone.",
        confirmText: "Delete",
        confirmColor: "danger",
        type: "danger",
      });
      if (confirmed) {
        deleteProductMutation.mutate(productState.selectedItem.id);
      }
    }
  };

  // Category handlers
  const selectCategoryInternal = (category: Category) => {
    categoryState.setSelectedItem(category);
    categoryState.setFormData({
      name: category.name,
      category_code: category.category_code,
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

  const handleSaveCategory = () => {
    // Validate required fields
    if (!categoryState.formData.name || !categoryState.formData.category_code) {
      showErrorToast("Please fill in all required fields");
      setCategoryTouched({ name: true, category_code: true });
      return;
    }

    // Check for duplicate name
    if (categories) {
      const isDuplicateName = categories.some(
        (c) =>
          c.name.trim().toLowerCase() === categoryState.formData.name?.trim().toLowerCase() &&
          (!categoryState.selectedItem || c.id !== categoryState.selectedItem.id)
      );
      if (isDuplicateName) {
        showErrorToast("Category name already exists");
        return;
      }
    }

    if (categoryState.isCreating) {
      createCategoryMutation.mutate(categoryState.formData);
    } else if (categoryState.selectedItem) {
      updateCategoryMutation.mutate({
        id: categoryState.selectedItem.id,
        data: categoryState.formData,
      });
    }
  };

  const handleDeleteCategory = async () => {
    if (categoryState.selectedItem) {
      const confirmed = await confirmDialog.confirm({
        title: "Delete Category",
        message:
          "Are you sure you want to permanently delete this category? This action cannot be undone and may affect existing products.",
        confirmText: "Delete",
        confirmColor: "danger",
        type: "danger",
      });
      if (confirmed) {
        deleteCategoryMutation.mutate(categoryState.selectedItem.id);
      }
    }
  };

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
      brand_code: brand.brand_code,
      description: brand.description || "",
      active: brand.active,
    });
    brandState.setIsEditing(false);
    brandState.setIsCreating(false);
  };

  // Reset the detail panel back to "Main" (no section selected) whenever a
  // different product is selected or a new one is started — but not when
  // just toggling Edit/Cancel on the same record, so the user isn't yanked
  // away from what they're reviewing.
  useEffect(() => {
    setActiveProductSection(null);
  }, [productState.selectedItem?.id, productState.isCreating]);

  const handleNewBrand = () => {
    brandState.setSelectedItem(null);
    brandState.setFormData(emptyBrandForm);
    setBrandTouched({});
    brandState.setIsCreating(true);
    brandState.setIsEditing(true);
  };

  const handleSaveBrand = () => {
    // Validate required fields
    if (!brandState.formData.brand_name || !brandState.formData.brand_code) {
      showErrorToast("Please fill in all required fields");
      setBrandTouched({ brand_name: true, brand_code: true });
      return;
    }

    if (brandState.formData.brand_code.length > 4) {
      showErrorToast("Brand code cannot exceed 4 characters");
      setBrandTouched({ ...brandTouched, brand_code: true });
      return;
    }

    // Check for duplicate name
    if (brands) {
      const isDuplicateName = brands.some(
        (b) =>
          b.brand_name.trim().toLowerCase() === brandState.formData.brand_name?.trim().toLowerCase() &&
          (!brandState.selectedItem || b.id !== brandState.selectedItem.id)
      );
      if (isDuplicateName) {
        showErrorToast("Brand name already exists");
        return;
      }
    }

    if (brandState.isCreating) {
      createBrandMutation.mutate(brandState.formData);
    } else if (brandState.selectedItem) {
      updateBrandMutation.mutate({
        id: brandState.selectedItem.id,
        data: brandState.formData,
      });
    }
  };

  const handleDeleteBrand = async () => {
    if (brandState.selectedItem) {
      const confirmed = await confirmDialog.confirm({
        title: "Delete Brand",
        message: "Are you sure you want to delete this brand?",
        confirmText: "Delete",
        confirmColor: "danger",
        type: "danger",
      });
      if (confirmed) {
        deleteBrandMutation.mutate(brandState.selectedItem.id);
      }
    }
  };

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
    await Promise.all([refetchProducts(), refetchCategories(), refetchBrands()]);
  };

  // Tab configuration
  const tabs: TabConfig[] = [
    { label: "Products" },
    { label: "Categories" },
    { label: "Brands" },
  ];

  const pageTitle =
    activeTab === 0 ? "Products" : activeTab === 1 ? "Categories" : "Brands";

  // Whether we're showing a single product's / category's / brand's detail
  // view (selected or being created) instead of that tab's browse table.
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
  const singleProductPanel = (
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
          onClick={handleBackToProducts}
          sx={{ textTransform: "none" }}
        >
          Back to Products
        </Button>
      </Box>
      {productState.isCreating ? (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Box
            onClick={() => setActiveProductSection(null)}
            sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1, cursor: "pointer" }}
          >
            <ProductAvatarCircle productName={productState.formData.name} size={40} />
            <Typography variant="caption" color="text.secondary">
              New Product
            </Typography>
          </Box>
          <TSectionNav
            items={PRODUCT_SECTION_NAV_ITEMS}
            activeKey={activeProductSection}
            onChange={handleProductSectionNavChange}
            variant="inline"
          />
        </Box>
      ) : (
        productState.selectedItem && (
          <Box>
            <SelectableListItem
              id={productState.selectedItem.id}
              isSelected
              onClick={() => setActiveProductSection(null)}
              primaryText={
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
                  <ProductAvatarCircle
                    productName={productState.selectedItem.name}
                    imageUrl={productState.selectedItem.image_url}
                  />
                  <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5, minWidth: 0 }}>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>{productState.selectedItem.item_code}</span>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Item Code)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {productState.selectedItem.name}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Name)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                      <Chip
                        label={productState.selectedItem.active ? "Active" : "Inactive"}
                        size="small"
                        color={productState.selectedItem.active ? "success" : "default"}
                        sx={{ height: 18, fontSize: "0.65rem" }}
                      />
                      {productState.selectedItem.website_active && (
                        <Chip label="Web" size="small" color="info" sx={{ height: 18, fontSize: "0.65rem" }} />
                      )}
                    </Box>
                  </Box>
                </Box>
              }
              isFavorite={productState.favorites.includes(productState.selectedItem.id)}
              onToggleFavorite={(e) => productState.toggleFavorite(productState.selectedItem!.id, e)}
            />
            <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
              <TSectionNav
                items={PRODUCT_SECTION_NAV_ITEMS}
                activeKey={activeProductSection}
                onChange={handleProductSectionNavChange}
                variant="inline"
              />
            </Box>
          </Box>
        )
      )}
    </Paper>
  );

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
                  ...(productState.selectedItem.website_active
                    ? [{ label: "Website Active", color: "info" as const }]
                    : []),
                ]
              : undefined
          }
        />

        <ActionToolbar
          canCreate={canCreate}
          canDelete={canDelete}
          canUpdate={canUpdate}
          isEditing={productState.isEditing}
          isCreating={productState.isCreating}
          hasSelection={!!productState.selectedItem}
          onAdd={handleNewProduct}
          onDuplicate={handleDuplicateProduct}
          onDelete={handleDeleteProduct}
          onSave={handleSaveProduct}
          onCancel={handleCancelProduct}
          onEdit={() => {
            setMinPriceInput(currentMinPrice?.minimum_price ?? "");
            productState.setIsEditing(true);
          }}
          isSaving={
            createProductMutation.isPending || updateProductMutation.isPending
          }
          saveDisabled={
            !productState.formData.name ||
            !productState.formData.item_code ||
            productState.formData.cost_price === undefined ||
            productState.formData.cost_price === null ||
            productState.formData.selling_price === undefined ||
            productState.formData.selling_price === null ||
            !productState.formData.category_id ||
            !productState.formData.items_brand_id
          }
        />

        <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
          {!productState.selectedItem && !productState.isCreating ? (
            <EmptyState message="Select a product from the list or create a new one" />
          ) : (
            <>
              {activeProductSection === null && (
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

                  <FormSection title="Basic Information">
                    <TextField
                      label="Item Code"
                      size="small"
                      value={productState.formData.item_code}
                      onChange={(e) =>
                        productState.setFormData({
                          ...productState.formData,
                          item_code: e.target.value.toUpperCase(),
                        })
                      }
                      onBlur={() => handleProductBlur("item_code")}
                      disabled={!productState.isCreating}
                      required
                      error={
                        productTouched.item_code && !productState.formData.item_code
                      }
                      helperText={
                        productTouched.item_code && !productState.formData.item_code
                          ? "Item code is required"
                          : ""
                      }
                      inputProps={{ style: { textTransform: "uppercase" } }}
                    />
                    <TextField
                      label="Product Name"
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
                      error={productTouched.name && !productState.formData.name}
                      helperText={
                        productTouched.name && !productState.formData.name
                          ? "Product name is required"
                          : ""
                      }
                    />
                    <TextField
                      label="Model"
                      size="small"
                      value={productState.formData.model}
                      onChange={(e) =>
                        productState.setFormData({
                          ...productState.formData,
                          model: e.target.value,
                        })
                      }
                      disabled={!productState.isEditing && !productState.isCreating}
                    />
                    <TextField
                      label="Item Type"
                      size="small"
                      select
                      value={productState.formData.item_type}
                      onChange={(e) =>
                        productState.setFormData({
                          ...productState.formData,
                          item_type: e.target.value,
                        })
                      }
                      disabled={!productState.isEditing && !productState.isCreating}
                    >
                      {PRODUCT_ITEM_TYPE.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </TextField>
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
                      label="Description"
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
                  </FormSection>

                  <FormSection title="Classification">
                    <Autocomplete
                      size="small"
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
                          helperText={
                            productState.isEditing || productState.isCreating
                              ? "Only active categories can be selected"
                              : ""
                          }
                        />
                      )}
                      isOptionEqualToValue={(option, value) =>
                        option.id === value.id
                      }
                    />
                    <Autocomplete
                      size="small"
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
                          helperText={
                            productState.isEditing || productState.isCreating
                              ? "Only active brands can be selected"
                              : ""
                          }
                        />
                      )}
                      isOptionEqualToValue={(option, value) =>
                        option.id === value.id
                      }
                    />
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
                        <FormControlLabel
                          control={
                            <Switch
                              checked={productState.formData.website_active}
                              onChange={(e) =>
                                productState.setFormData({
                                  ...productState.formData,
                                  website_active: e.target.checked,
                                })
                              }
                              // Website active can only be enabled if product is active
                              disabled={
                                (!productState.isEditing &&
                                  !productState.isCreating) ||
                                !productState.formData.active
                              }
                            />
                          }
                          label="Website Active"
                        />
                      </Box>
                      {!productState.formData.active &&
                        (productState.isEditing || productState.isCreating) && (
                          <Typography variant="caption" color="warning.main">
                            Note: Inactive products cannot be used in sales,
                            purchases, or displayed on the website.
                          </Typography>
                        )}
                      {productState.formData.active &&
                        !productState.formData.website_active &&
                        (productState.isEditing || productState.isCreating) && (
                          <Typography variant="caption" color="text.secondary">
                            Enable "Website Active" to display this product on the
                            website.
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
              )}

              {activeProductSection === "pricing" && (
                <FormSection title="Pricing" isLast>
                  <TextField
                    label="Cost Price"
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
                    disabled={!productState.isEditing && !productState.isCreating}
                    required
                    error={
                      productTouched.cost_price &&
                      (productState.formData.cost_price === undefined ||
                        productState.formData.cost_price === null)
                    }
                    helperText={
                      productTouched.cost_price &&
                      (productState.formData.cost_price === undefined ||
                        productState.formData.cost_price === null)
                        ? "Cost price is required"
                        : ""
                    }
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">Rs.</InputAdornment>
                      ),
                    }}
                  />
                  <TextField
                    label="Website Price"
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
                      typeof productState.formData.website_price === "number" &&
                      productState.formData.website_price > 0 &&
                      typeof productState.formData.cost_price === "number" &&
                      productState.formData.website_price < productState.formData.cost_price
                    }
                    helperText={
                      typeof productState.formData.website_price === "number" &&
                      productState.formData.website_price > 0 &&
                      typeof productState.formData.cost_price === "number" &&
                      productState.formData.website_price < productState.formData.cost_price
                        ? `Cannot be less than cost price`
                        : ""
                    }
                    disabled={!productState.isEditing && !productState.isCreating}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">Rs.</InputAdornment>
                      ),
                    }}
                  />
                  <TextField
                    label="Selling Price"
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
                    disabled={!productState.isEditing && !productState.isCreating}
                    required
                    error={
                      (productTouched.selling_price &&
                      (productState.formData.selling_price === undefined ||
                        productState.formData.selling_price === null)) ||
                      (typeof productState.formData.selling_price === "number" &&
                      typeof productState.formData.cost_price === "number" &&
                      productState.formData.selling_price < productState.formData.cost_price)
                    }
                    helperText={
                      productTouched.selling_price &&
                      (productState.formData.selling_price === undefined ||
                        productState.formData.selling_price === null)
                        ? "Selling price is required"
                        : typeof productState.formData.selling_price === "number" &&
                          typeof productState.formData.cost_price === "number" &&
                          productState.formData.selling_price < productState.formData.cost_price
                          ? "Cannot be less than cost price"
                          : ""
                    }
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">Rs.</InputAdornment>
                      ),
                    }}
                  />
                  <TextField
                    label="Minimum Selling Price"
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
                      setMinPriceInput(
                        Number.isFinite(parsed) ? Math.max(0, parsed) : "",
                      );
                    }}
                    disabled={!productState.isEditing && !productState.isCreating}
                    error={typeof minPriceInput === "number" && minPriceInput < (productState.formData.cost_price || 0)}
                    helperText={typeof minPriceInput === "number" && minPriceInput < (productState.formData.cost_price || 0) ? `Cannot be less than cost price (Rs. ${productState.formData.cost_price || 0})` : ""}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">Rs.</InputAdornment>
                      ),
                    }}
                  />
                </FormSection>
              )}

              {/* ── Suppliers (vendor pricelist) ─────────────────────────── */}
              {activeProductSection === "suppliers" && (
                <FormSection title="Suppliers" isLast>
                  <Box sx={{ gridColumn: "1 / -1" }}>
                    {productState.isCreating ? (
                      <ProductSuppliersList
                        canEdit={canCreate}
                        pendingMappings={pendingSupplierMappings}
                        onPendingMappingsChange={setPendingSupplierMappings}
                      />
                    ) : (
                      productState.selectedItem && (
                        <ProductSuppliersList
                          productId={productState.selectedItem.id}
                          canEdit={canUpdate}
                        />
                      )
                    )}
                  </Box>
                </FormSection>
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

  // Detail mode: a narrow left panel showing only the current category (or
  // the "New Category" placeholder while creating). No section-nav for now
  // (sub sections may be added later). A "Back to Categories" link returns
  // to the table.
  const singleCategoryPanel = (
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
          onClick={handleBackToCategories}
          sx={{ textTransform: "none" }}
        >
          Back to Categories
        </Button>
      </Box>
      {categoryState.isCreating ? (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ bgcolor: "primary.main" }}>
              <CategoryIcon fontSize="small" />
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              New Category
            </Typography>
          </Box>
        </Box>
      ) : categoryState.selectedItem && (
        <Box>
          <SelectableListItem
            id={categoryState.selectedItem.id}
            isSelected
            onClick={() => {}}
            primaryText={
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
                <Avatar sx={{ bgcolor: "primary.main" }}>
                  <CategoryIcon fontSize="small" />
                </Avatar>
                <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5, minWidth: 0 }}>
                  <span>{categoryState.selectedItem.name}</span>
                  <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                    {categoryState.selectedItem.category_code}
                  </Typography>
                </Box>
              </Box>
            }
          />
        </Box>
      )}
    </Paper>
  );

  // Detail mode: Categories have no section-nav, so there's nothing beyond
  // the mini panel above — just the unchanged detail content full-width.
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
          canCreate={canCreate}
          canDelete={canDelete}
          canUpdate={canUpdate}
          isEditing={categoryState.isEditing}
          isCreating={categoryState.isCreating}
          hasSelection={!!categoryState.selectedItem}
          onAdd={handleNewCategory}
          onEdit={() => categoryState.setIsEditing(true)}
          onDelete={handleDeleteCategory}
          onSave={handleSaveCategory}
          onCancel={handleCancelCategory}
          isSaving={
            createCategoryMutation.isPending || updateCategoryMutation.isPending
          }
          saveDisabled={
            !categoryState.formData.name ||
            !categoryState.formData.category_code
          }
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
                  error={categoryTouched.name && !categoryState.formData.name}
                  helperText={
                    categoryTouched.name && !categoryState.formData.name
                      ? "Category name is required"
                      : ""
                  }
                />
                <TextField
                  label="Category Code"
                  size="small"
                  value={categoryState.formData.category_code}
                  onChange={(e) =>
                    categoryState.setFormData({
                      ...categoryState.formData,
                      category_code: e.target.value.toUpperCase(),
                    })
                  }
                  onBlur={() => handleCategoryBlur("category_code")}
                  disabled={!categoryState.isCreating}
                  required
                  error={
                    categoryTouched.category_code &&
                    !categoryState.formData.category_code
                  }
                  helperText={
                    categoryTouched.category_code &&
                    !categoryState.formData.category_code
                      ? "Category code is required"
                      : ""
                  }
                  inputProps={{ style: { textTransform: "uppercase" } }}
                />
                <TextField
                  label="Memo"
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

  // Detail mode: a narrow left panel showing only the current brand (or the
  // "New Brand" placeholder while creating). No section-nav for now (sub
  // sections may be added later). A "Back to Brands" link returns to the
  // table.
  const singleBrandPanel = (
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
          onClick={handleBackToBrands}
          sx={{ textTransform: "none" }}
        >
          Back to Brands
        </Button>
      </Box>
      {brandState.isCreating ? (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ bgcolor: "primary.main" }}>
              <BrandIcon fontSize="small" />
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              New Brand
            </Typography>
          </Box>
        </Box>
      ) : brandState.selectedItem && (
        <Box>
          <SelectableListItem
            id={brandState.selectedItem.id}
            isSelected
            onClick={() => {}}
            primaryText={
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
                <Avatar sx={{ bgcolor: "primary.main" }}>
                  <BrandIcon fontSize="small" />
                </Avatar>
                <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5, minWidth: 0 }}>
                  <span>{brandState.selectedItem.brand_name}</span>
                  <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                    {brandState.selectedItem.brand_code}
                  </Typography>
                </Box>
              </Box>
            }
          />
        </Box>
      )}
    </Paper>
  );

  // Detail mode: Brands have no section-nav, so there's nothing beyond the
  // mini panel above — just the unchanged detail content full-width.
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
          canCreate={canCreate}
          canDelete={canDelete}
          canUpdate={canUpdate}
          isEditing={brandState.isEditing}
          isCreating={brandState.isCreating}
          hasSelection={!!brandState.selectedItem}
          onAdd={handleNewBrand}
          onEdit={() => brandState.setIsEditing(true)}
          onDelete={handleDeleteBrand}
          onSave={handleSaveBrand}
          onCancel={handleCancelBrand}
          isSaving={
            createBrandMutation.isPending || updateBrandMutation.isPending
          }
          saveDisabled={
            !brandState.formData.brand_name || !brandState.formData.brand_code
          }
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
                  brandTouched.brand_name && !brandState.formData.brand_name
                }
                helperText={
                  brandTouched.brand_name && !brandState.formData.brand_name
                    ? "Brand name is required"
                    : ""
                }
              />
              <TextField
                label="Brand Code"
                size="small"
                value={brandState.formData.brand_code}
                onChange={(e) =>
                  brandState.setFormData({
                    ...brandState.formData,
                    brand_code: e.target.value.toUpperCase(),
                  })
                }
                onBlur={() => handleBrandBlur("brand_code")}
                disabled={!brandState.isCreating}
                required
                error={
                  (brandTouched.brand_code && !brandState.formData.brand_code) ||
                  (brandState.formData.brand_code?.length > 4)
                }
                helperText={
                  brandTouched.brand_code && !brandState.formData.brand_code
                    ? "Brand code is required"
                    : brandState.formData.brand_code?.length > 4
                      ? "Brand code cannot exceed 4 characters"
                      : ""
                }
                inputProps={{ maxLength: 4, style: { textTransform: "uppercase" } }}
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
            isProductDetailMode ? undefined : (
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
                <TAutocomplete<Supplier>
                  label=""
                  placeholder="All Suppliers"
                  options={suppliersForFilter}
                  value={productSupplierFilter}
                  onChange={(value) => setProductSupplierFilter(value as Supplier | null)}
                  getOptionLabel={(s) => s.company_name}
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
              {(productState.searchQuery || productActiveFilter || productSupplierFilter || productCategoryFilter || productBrandFilter) && (
                <Tooltip title="Clear filters">
                  <IconButton size="small" onClick={handleClearProductFilters}>
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
            )
          ) : activeTab === 1 ? (
            isCategoryDetailMode ? undefined : (
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
                sx={{ width: 220, flexShrink: 0 }}
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
                <Tooltip title="Clear filters">
                  <IconButton size="small" onClick={handleClearCategoryFilters}>
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
            )
          ) : (
            isBrandDetailMode ? undefined : (
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
                sx={{ width: 220, flexShrink: 0 }}
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
                <Tooltip title="Clear filters">
                  <IconButton size="small" onClick={handleClearBrandFilters}>
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
            )
          )
        }
        onRefresh={handleRefresh}
        headerActions={
          activeTab === 0 ? (
            isProductDetailMode ? undefined : (
            <>
              {canCreate && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={handleNewProduct}
                  sx={{ mr: 1 }}
                >
                  Add Product
                </Button>
              )}
            <TExportButton
              filename="products"
              headers={[
                "Item Code",
                "Name",
                "Model",
                "Item Type",
                "Description",
                "Cost Price",
                "Selling Price",
                "Website Price",
                "Active",
                "Website Active",
                "Added Date",
                "Created At",
                "Updated At",
              ]}
              rows={() =>
                filteredProducts.map((p) => [
                  p.item_code || "",
                  p.name || "",
                  p.model || "",
                  p.item_type || "",
                  p.description || "",
                  p.cost_price || 0,
                  p.selling_price || 0,
                  p.website_price || 0,
                  p.active ? "Yes" : "No",
                  p.website_active ? "Yes" : "No",
                  p.added_date || "",
                  p.created_at || "",
                  p.updated_at || "",
                ])
              }
              disabled={filteredProducts.length === 0}
            />
            </>
            )
          ) : activeTab === 1 ? (
            isCategoryDetailMode ? undefined : (
            <>
              {canCreate && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={handleNewCategory}
                  sx={{ mr: 1 }}
                >
                  Add Category
                </Button>
              )}
            <TExportButton
              filename="categories"
              headers={["Category Code", "Name", "Description", "Active"]}
              rows={() =>
                filteredCategories.map((c) => [
                  c.category_code || "",
                  c.name || "",
                  c.description || "",
                  c.active ? "Yes" : "No",
                ])
              }
              disabled={filteredCategories.length === 0}
            />
            </>
            )
          ) : activeTab === 2 ? (
            isBrandDetailMode ? undefined : (
            <>
              {canCreate && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={handleNewBrand}
                  sx={{ mr: 1 }}
                >
                  Add Brand
                </Button>
              )}
            <TExportButton
              filename="brands"
              headers={["Brand Code", "Brand Name", "Description"]}
              rows={() =>
                filteredBrands.map((b) => [
                  b.brand_code || "",
                  b.brand_name || "",
                  b.description || "",
                ])
              }
              disabled={filteredBrands.length === 0}
            />
            </>
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
            ? { masterPanel: singleProductPanel, detailPanel: productDetailPanel }
            : { children: productTablePanel }
          : activeTab === 1
            ? isCategoryDetailMode
              ? { masterPanel: singleCategoryPanel, detailPanel: categoryDetailPanel }
              : { children: categoryTablePanel }
            : isBrandDetailMode
              ? { masterPanel: singleBrandPanel, detailPanel: brandDetailPanel }
              : { children: brandTablePanel })}
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
