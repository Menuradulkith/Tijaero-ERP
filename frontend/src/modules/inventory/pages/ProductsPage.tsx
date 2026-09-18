import { usePermission } from "@/auth/permissions";
import {
    ActionToolbar,
    DetailPanelHeader,
    EmptyState,
    fmtLKR,
    FormSection,
    MasterDetailLayout,
    PRODUCT_ITEM_TYPE,
    SearchableList,
    SelectableListItem,
    showErrorToast,
    SortOption,
    TabConfig,
    TAutocomplete,
    TConfirmDialog,
    TExportButton,
    TSectionNav,
    TStatusFilter,
    TTabFilterBar,
    useConfirmDialog,
  useCrudMutation,
    useMasterDetailState,
    TActivityHistoryPanel,
    type TSectionNavItem,
} from "@/components/tijaero";
import { formatDateTimeReadable } from "@/utils/formatters";
import {
    AttachMoney as PricingIcon,
    Sell as BrandIcon,
    Category as CategoryIcon,
    History as HistoryIcon,
    Inventory as InventoryIcon,
    LocalShipping as SuppliersIcon,
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
    Switch,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material";
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

// Sort options for each tab
const productSortOptions: SortOption[] = [
  { value: "item_code", label: "Item Code" },
  { value: "name", label: "Name" },
  { value: "cost_price", label: "Cost Price" },
  { value: "created_at", label: "Creation Date" },
];

const categorySortOptions: SortOption[] = [
  { value: "name", label: "Name" },
  { value: "category_code", label: "Code" },
  { value: "created_at", label: "Creation Date" },
];

const brandSortOptions: SortOption[] = [
  { value: "brand_name", label: "Name" },
  { value: "brand_code", label: "Code" },
  { value: "created_at", label: "Creation Date" },
];

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

  // Product filter states
  const [productActiveFilter, setProductActiveFilter] = useState<string | null>(null);
  const [productSupplierFilter, setProductSupplierFilter] = useState<Supplier | null>(null);
  const [categoryActiveFilter, setCategoryActiveFilter] = useState<string | null>(null);
  const [brandActiveFilter, setBrandActiveFilter] = useState<string | null>(null);

  // Filter states (draft - edited via the header filter bar, only applied on Search click)
  const [draftProductSearchQuery, setDraftProductSearchQuery] = useState("");
  const [draftProductActiveFilter, setDraftProductActiveFilter] = useState<string | null>(null);
  const [draftProductSupplier, setDraftProductSupplier] = useState<Supplier | null>(null);
  const [draftCategorySearchQuery, setDraftCategorySearchQuery] = useState("");
  const [draftCategoryActiveFilter, setDraftCategoryActiveFilter] = useState<string | null>(null);
  const [draftBrandSearchQuery, setDraftBrandSearchQuery] = useState("");
  const [draftBrandActiveFilter, setDraftBrandActiveFilter] = useState<string | null>(null);

  // Minimum selling price dialog state
  const [minPriceDialogOpen, setMinPriceDialogOpen] = useState(false);
  const [newMinPrice, setNewMinPrice] = useState<number>(0);
  const [createMinPrice, setCreateMinPrice] = useState<number | "">("");

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
  // tab's Record Information title, rather than shown inline. One shared
  // panel serves all three tabs — entityType/entityId switch per tab.
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);

  const handleApplyProductFilters = useCallback(() => {
    productState.setSearchQuery(draftProductSearchQuery);
    setProductActiveFilter(draftProductActiveFilter);
    setProductSupplierFilter(draftProductSupplier);
  }, [draftProductSearchQuery, draftProductActiveFilter, draftProductSupplier, productState.setSearchQuery]);

  const handleClearProductFilters = useCallback(() => {
    setDraftProductSearchQuery("");
    setDraftProductActiveFilter(null);
    setDraftProductSupplier(null);
    productState.setSearchQuery("");
    setProductActiveFilter(null);
    setProductSupplierFilter(null);
  }, [productState.setSearchQuery]);

  const handleApplyCategoryFilters = useCallback(() => {
    categoryState.setSearchQuery(draftCategorySearchQuery);
    setCategoryActiveFilter(draftCategoryActiveFilter);
  }, [draftCategorySearchQuery, draftCategoryActiveFilter, categoryState.setSearchQuery]);

  const handleClearCategoryFilters = useCallback(() => {
    setDraftCategorySearchQuery("");
    setDraftCategoryActiveFilter(null);
    categoryState.setSearchQuery("");
    setCategoryActiveFilter(null);
  }, [categoryState.setSearchQuery]);

  const handleApplyBrandFilters = useCallback(() => {
    brandState.setSearchQuery(draftBrandSearchQuery);
    setBrandActiveFilter(draftBrandActiveFilter);
  }, [draftBrandSearchQuery, draftBrandActiveFilter, brandState.setSearchQuery]);

  const handleClearBrandFilters = useCallback(() => {
    setDraftBrandSearchQuery("");
    setDraftBrandActiveFilter(null);
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

    filtered.sort((a, b) => {
      if (productState.sortField === "item_code")
        return a.item_code.localeCompare(b.item_code);
      if (productState.sortField === "name")
        return a.name.localeCompare(b.name);
      if (productState.sortField === "cost_price")
        return b.cost_price - a.cost_price;
      if (productState.sortField === "created_at")
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return 0;
    });
    return filtered;
  }, [
    products,
    productState.searchQuery,
    productState.sortField,
    productActiveFilter,
    productSupplierFilter,
    supplierFilterMappings,
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
    filtered.sort((a, b) => {
      if (categoryState.sortField === "name")
        return a.name.localeCompare(b.name);
      if (categoryState.sortField === "category_code")
        return a.category_code.localeCompare(b.category_code);
      if (categoryState.sortField === "created_at")
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return 0;
    });
    return filtered;
  }, [categories, categoryState.searchQuery, categoryState.sortField, categoryActiveFilter]);

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
    filtered.sort((a, b) => {
      if (brandState.sortField === "brand_name")
        return a.brand_name.localeCompare(b.brand_name);
      if (brandState.sortField === "brand_code")
        return a.brand_code.localeCompare(b.brand_code);
      if (brandState.sortField === "created_at")
        return (b.created_at ? new Date(b.created_at).getTime() : 0) -
          (a.created_at ? new Date(a.created_at).getTime() : 0);
      return 0;
    });
    return filtered;
  }, [brands, brandState.searchQuery, brandState.sortField, brandActiveFilter]);

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
        typeof createMinPrice === "number" ? createMinPrice : 0;
      if (priceToSet > 0 && canUpdate) {
        setMinimumPriceForProductMutation.mutate({
          productId: newProduct.id,
          price: priceToSet,
        });
      }
      setCreateMinPrice("");

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
              lead_time_days: m.lead_time_days,
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

  const setMinimumPriceMutation = useCrudMutation({
    mutationFn: (price: number) =>
      minimumPriceApi.set(productState.selectedItem!.id, {
        minimum_price: price,
      }),
    invalidateQueryKeys: [["minimum-price", productState.selectedItem?.id]],
    successMessage: "Minimum selling price set successfully",
    errorMessage: "Failed to set minimum selling price",
    onSuccess: () => {
      setMinPriceDialogOpen(false);
      setNewMinPrice(0);
    },
  });

  // Product handlers
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

  const selectProductInternal = (product: Product) => {
    productState.setSelectedItem(product);
    productState.setFormData({
      name: product.name,
      item_code: product.item_code,
      model: product.model || "",
      item_type: product.item_type,
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
    // Only allow selecting active categories and brands
    const defaultCategory = activeCategories?.[0]?.id || 0;
    const defaultBrand = activeBrands?.[0]?.id || 0;

    productState.setSelectedItem(null);
    productState.setFormData({
      ...emptyProductForm,
      category_id: defaultCategory,
      items_brand_id: defaultBrand,
    });
    setCreateMinPrice("");
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
      setCreateMinPrice("");
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
      productState.formData.selling_price === null
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
    if (productState.isCreating && typeof createMinPrice === "number" && createMinPrice < productState.formData.cost_price) {
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

  const handleCancelProduct = () => {
    if (productState.isCreating) {
      productState.setIsCreating(false);
      productState.setIsEditing(false);
      setCreateMinPrice("");
      setProductTouched({});
      setPendingSupplierMappings([]);
      setDraftImageFile(null);
      if (filteredProducts.length > 0)
        selectProductInternal(filteredProducts[0]);
    } else if (productState.selectedItem) {
      selectProductInternal(productState.selectedItem);
      productState.setIsEditing(false);
      setProductTouched({});
    }
  };

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

  const handleCancelCategory = () => {
    if (categoryState.isCreating) {
      categoryState.setIsCreating(false);
      categoryState.setIsEditing(false);
      setCategoryTouched({});
      if (filteredCategories.length > 0)
        selectCategoryInternal(filteredCategories[0]);
    } else if (categoryState.selectedItem) {
      selectCategoryInternal(categoryState.selectedItem);
      categoryState.setIsEditing(false);
      setCategoryTouched({});
    }
  };

  // Brand handlers
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

  // Auto-select first item when data loads for each tab
  useEffect(() => {
    if (
      activeTab === 0 &&
      filteredProducts.length > 0 &&
      !productState.selectedItem &&
      !productState.isCreating
    ) {
      selectProductInternal(filteredProducts[0]);
    }
  }, [
    filteredProducts,
    productState.selectedItem,
    productState.isCreating,
    activeTab,
  ]);

  useEffect(() => {
    if (
      activeTab === 1 &&
      filteredCategories.length > 0 &&
      !categoryState.selectedItem &&
      !categoryState.isCreating
    ) {
      selectCategoryInternal(filteredCategories[0]);
    }
  }, [
    filteredCategories,
    categoryState.selectedItem,
    categoryState.isCreating,
    activeTab,
  ]);

  useEffect(() => {
    if (
      activeTab === 2 &&
      filteredBrands.length > 0 &&
      !brandState.selectedItem &&
      !brandState.isCreating
    ) {
      selectBrandInternal(filteredBrands[0]);
    }
  }, [
    filteredBrands,
    brandState.selectedItem,
    brandState.isCreating,
    activeTab,
  ]);

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

  const handleCancelBrand = () => {
    if (brandState.isCreating) {
      brandState.setIsCreating(false);
      brandState.setIsEditing(false);
      setBrandTouched({});
      if (filteredBrands.length > 0) selectBrandInternal(filteredBrands[0]);
    } else if (brandState.selectedItem) {
      selectBrandInternal(brandState.selectedItem);
      brandState.setIsEditing(false);
      setBrandTouched({});
    }
  };

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

  // Render Products Tab
  const renderProductsTab = () => (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: { xs: "column", md: "row" },
        overflow: "hidden",
      }}
    >
      <SearchableList
        searchValue={productState.searchQuery}
        onSearchChange={productState.setSearchQuery}
        hideSearch
        sortOptions={productSortOptions}
        currentSort={productState.sortField}
        onSortChange={productState.setSortField}
        isLoading={productsLoading}
        emptyMessage="No products found"
        virtualize
        estimatedItemHeight={90}
        overscanCount={8}
        listHeader={
          productState.isCreating ? (
            <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
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
          ) : undefined
        }
      >
        {filteredProducts.map((product) => {
          const isSelected = productState.selectedItem?.id === product.id;
          return (
            <Box key={product.id}>
            <SelectableListItem
              isSelected={isSelected}
              onClick={() => {
                // Re-clicking the already-selected product doesn't change its
                // id, so the effect that resets the detail panel to "Main" on
                // selection change won't fire on its own — reset it here too
                // so the section nav always returns to Main.
                if (isSelected) {
                  setActiveProductSection(null);
                } else {
                  handleSelectProduct(product);
                }
              }}
              primaryText={
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
                  <ProductAvatarCircle productName={product.name} imageUrl={product.image_url} />
                  <Box
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      width: "100%",
                      gap: 0.5,
                      minWidth: 0,
                    }}
                  >
                  {/* Item Code */}
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span>{product.item_code}</span>
                    {isSelected && (
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{ color: "inherit", opacity: 0.7 }}
                      >
                        (Item Code)
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
                          {product.name}
                        </Typography>
                        <Typography
                          component="span"
                          variant="caption"
                          sx={{ color: "inherit", opacity: 0.7 }}
                        >
                          (Name)
                        </Typography>
                      </Box>
                      {product.selling_price && (
                        <Box
                          sx={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <Typography
                            component="span"
                            variant="caption"
                            fontWeight={600}
                            sx={{ color: "inherit" }}
                          >
                            Rs. {fmtLKR(product.selling_price)}
                          </Typography>
                          <Typography
                            component="span"
                            variant="caption"
                            sx={{ color: "inherit", opacity: 0.7 }}
                          >
                            (Selling Price)
                          </Typography>
                        </Box>
                      )}
                      {/* Status Chips - shown below all fields when selected */}
                      <Box
                        sx={{
                          display: "flex",
                          gap: 0.5,
                          mt: 0.5,
                          flexWrap: "wrap",
                        }}
                      >
                        <Chip
                          label={product.active ? "Active" : "Inactive"}
                          size="small"
                          color={product.active ? "success" : "default"}
                          sx={{ height: 18, fontSize: "0.65rem" }}
                        />
                        {product.website_active && (
                          <Chip
                            label="Web"
                            size="small"
                            color="info"
                            sx={{ height: 18, fontSize: "0.65rem" }}
                          />
                        )}
                      </Box>
                    </>
                  )}
                  </Box>
                </Box>
              }
              secondaryText={!isSelected ? product.name : undefined}
              isFavorite={productState.favorites.includes(product.id)}
              onToggleFavorite={() => productState.toggleFavorite(product.id)}
              chips={
                !isSelected
                  ? [
                      ...(product.active
                        ? [{ label: "Active", color: "success" as const }]
                        : []),
                      ...(product.website_active
                        ? [{ label: "Web", color: "info" as const }]
                        : []),
                    ]
                  : undefined
              }
            />
            {isSelected && (
              <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
                <TSectionNav
                  items={PRODUCT_SECTION_NAV_ITEMS}
                  activeKey={activeProductSection}
                  onChange={handleProductSectionNavChange}
                  variant="inline"
                />
              </Box>
            )}
            </Box>
          );
        })}
      </SearchableList>

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
          onEdit={() => productState.setIsEditing(true)}
          isSaving={
            createProductMutation.isPending || updateProductMutation.isPending
          }
          saveDisabled={
            !productState.formData.name ||
            !productState.formData.item_code ||
            productState.formData.cost_price === undefined ||
            productState.formData.cost_price === null ||
            productState.formData.selling_price === undefined ||
            productState.formData.selling_price === null
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

                  {/* Record Information (view mode only) */}
                  {productState.selectedItem &&
                    !productState.isCreating &&
                    !productState.isEditing && (
                      <FormSection
                        title="Record Information"
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
                  {/* Minimum Selling Price */}
                  {productState.isCreating ? (
                    <TextField
                      label="Minimum Selling Price"
                      size="small"
                      type="number"
                      value={createMinPrice}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw.trim() === "") {
                          setCreateMinPrice("");
                          return;
                        }
                        const parsed = Number(raw);
                        setCreateMinPrice(
                          Number.isFinite(parsed) ? Math.max(0, parsed) : "",
                        );
                      }}
                      error={typeof createMinPrice === "number" && createMinPrice < (productState.formData.cost_price || 0)}
                      helperText={typeof createMinPrice === "number" && createMinPrice < (productState.formData.cost_price || 0) ? `Cannot be less than cost price (Rs. ${productState.formData.cost_price || 0})` : ""}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">Rs.</InputAdornment>
                        ),
                      }}
                    />
                  ) : (
                    productState.selectedItem && (
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 2,
                          gridColumn: { sm: "1 / -1" },
                        }}
                      >
                        <Typography variant="body2" color="text.secondary">
                          Minimum Selling Price:
                        </Typography>
                        {currentMinPrice ? (
                          <Chip
                            label={`Rs. ${fmtLKR(currentMinPrice.minimum_price)}`}
                            color="primary"
                            size="small"
                          />
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            Not set
                          </Typography>
                        )}
                        {canUpdate && (
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => {
                              setNewMinPrice(currentMinPrice?.minimum_price || 0);
                              setMinPriceDialogOpen(true);
                            }}
                          >
                            {currentMinPrice ? "Update" : "Set"} Min Price
                          </Button>
                        )}
                      </Box>
                    )
                  )}
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
    </Box>
  );

  // Render Categories Tab
  const renderCategoriesTab = () => (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: { xs: "column", md: "row" },
        overflow: "hidden",
      }}
    >
      <SearchableList
        searchValue={categoryState.searchQuery}
        onSearchChange={categoryState.setSearchQuery}
        hideSearch
        sortOptions={categorySortOptions}
        currentSort={categoryState.sortField}
        onSortChange={categoryState.setSortField}
        isLoading={categoriesLoading}
        emptyMessage="No categories found"
      >
        {filteredCategories.map((category) => {
          const isSelected = categoryState.selectedItem?.id === category.id;
          return (
            <SelectableListItem
              key={category.id}
              isSelected={isSelected}
              onClick={() => handleSelectCategory(category)}
              primaryText={
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    width: "100%",
                    gap: 0.5,
                  }}
                >
                  {/* Category Name */}
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span>{category.name}</span>
                    {isSelected && (
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{ color: "inherit", opacity: 0.7 }}
                      >
                        (Name)
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
                          {category.category_code}
                        </Typography>
                        <Typography
                          component="span"
                          variant="caption"
                          sx={{ color: "inherit", opacity: 0.7 }}
                        >
                          (Code)
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
                        <Chip
                          label={category.active ? "Active" : "Inactive"}
                          size="small"
                          color={category.active ? "success" : "default"}
                          sx={{ height: 18, fontSize: "0.65rem" }}
                        />
                      </Box>
                    </>
                  )}
                </Box>
              }
              secondaryText={!isSelected ? category.category_code : undefined}
              isFavorite={categoryState.favorites.includes(category.id)}
              onToggleFavorite={() => categoryState.toggleFavorite(category.id)}
              chips={
                !isSelected
                  ? [
                      {
                        label: category.active ? "Active" : "Inactive",
                        color: category.active ? "success" : "default",
                      },
                    ]
                  : undefined
              }
            />
          );
        })}
      </SearchableList>

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

              {/* Record Information (view mode only) */}
              {categoryState.selectedItem &&
                !categoryState.isCreating &&
                !categoryState.isEditing && (
                  <FormSection
                    title="Record Information"
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
    </Box>
  );

  // Render Brands Tab
  const renderBrandsTab = () => (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: { xs: "column", md: "row" },
        overflow: "hidden",
      }}
    >
      <SearchableList
        searchValue={brandState.searchQuery}
        onSearchChange={brandState.setSearchQuery}
        hideSearch
        sortOptions={brandSortOptions}
        currentSort={brandState.sortField}
        onSortChange={brandState.setSortField}
        isLoading={brandsLoading}
        emptyMessage="No brands found"
      >
        {filteredBrands.map((brand) => {
          const isSelected = brandState.selectedItem?.id === brand.id;
          return (
            <SelectableListItem
              key={brand.id}
              isSelected={isSelected}
              onClick={() => handleSelectBrand(brand)}
              primaryText={
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    width: "100%",
                    gap: 0.5,
                  }}
                >
                  {/* Brand Name */}
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span>{brand.brand_name}</span>
                    {isSelected && (
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{ color: "inherit", opacity: 0.7 }}
                      >
                        (Name)
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
                          {brand.brand_code}
                        </Typography>
                        <Typography
                          component="span"
                          variant="caption"
                          sx={{ color: "inherit", opacity: 0.7 }}
                        >
                          (Code)
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
                        <Chip
                          label={brand.active ? "Active" : "Inactive"}
                          size="small"
                          color={brand.active ? "success" : "default"}
                          sx={{ height: 18, fontSize: "0.65rem" }}
                        />
                      </Box>
                    </>
                  )}
                </Box>
              }
              secondaryText={!isSelected ? brand.brand_code : undefined}
              isFavorite={brandState.favorites.includes(brand.id)}
              onToggleFavorite={() => brandState.toggleFavorite(brand.id)}
              chips={
                !isSelected
                  ? [
                      {
                        label: brand.active ? "Active" : "Inactive",
                        color: brand.active ? "success" : "default",
                      },
                    ]
                  : undefined
              }
            />
          );
        })}
      </SearchableList>

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

              {/* Record Information (view mode only) */}
              {brandState.selectedItem &&
                !brandState.isCreating &&
                !brandState.isEditing && (
                  <FormSection
                    title="Record Information"
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
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title={pageTitle}
        titleSlot={
          activeTab === 0 ? (
            <TTabFilterBar
              tabs={[
                {
                  key: "search",
                  label: "Product",
                  hasValue: !!draftProductSearchQuery,
                  render: ({ close }) => (
                    <TextField
                      size="small"
                      autoFocus
                      placeholder="Search product..."
                      value={draftProductSearchQuery}
                      onChange={(e) => setDraftProductSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleApplyProductFilters();
                          close();
                        }
                      }}
                      fullWidth
                    />
                  ),
                },
                {
                  key: "status",
                  label: "Status",
                  hasValue: !!draftProductActiveFilter,
                  render: () => (
                    <TStatusFilter
                      options={PRODUCT_ACTIVE_FILTER_OPTIONS}
                      value={draftProductActiveFilter}
                      onChange={setDraftProductActiveFilter}
                      label=""
                      size="small"
                    />
                  ),
                },
                {
                  key: "supplier",
                  label: "Supplier",
                  hasValue: !!draftProductSupplier,
                  render: () => (
                    <TAutocomplete<Supplier>
                      label="Supplier"
                      options={suppliersForFilter}
                      value={draftProductSupplier}
                      onChange={(value) => setDraftProductSupplier(value as Supplier | null)}
                      getOptionLabel={(s) => s.company_name}
                      size="small"
                    />
                  ),
                },
              ]}
              onSearch={handleApplyProductFilters}
              onClear={handleClearProductFilters}
              clearDisabled={
                !draftProductSearchQuery && !draftProductActiveFilter && !draftProductSupplier &&
                !productState.searchQuery && !productActiveFilter && !productSupplierFilter
              }
            />
          ) : activeTab === 1 ? (
            <TTabFilterBar
              tabs={[
                {
                  key: "search",
                  label: "Category",
                  hasValue: !!draftCategorySearchQuery,
                  render: ({ close }) => (
                    <TextField
                      size="small"
                      autoFocus
                      placeholder="Search category..."
                      value={draftCategorySearchQuery}
                      onChange={(e) => setDraftCategorySearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleApplyCategoryFilters();
                          close();
                        }
                      }}
                      fullWidth
                    />
                  ),
                },
                {
                  key: "status",
                  label: "Status",
                  hasValue: !!draftCategoryActiveFilter,
                  render: () => (
                    <TStatusFilter
                      options={PRODUCT_ACTIVE_FILTER_OPTIONS}
                      value={draftCategoryActiveFilter}
                      onChange={setDraftCategoryActiveFilter}
                      label=""
                      size="small"
                    />
                  ),
                },
              ]}
              onSearch={handleApplyCategoryFilters}
              onClear={handleClearCategoryFilters}
              clearDisabled={
                !draftCategorySearchQuery && !draftCategoryActiveFilter &&
                !categoryState.searchQuery && !categoryActiveFilter
              }
            />
          ) : (
            <TTabFilterBar
              tabs={[
                {
                  key: "search",
                  label: "Brand",
                  hasValue: !!draftBrandSearchQuery,
                  render: ({ close }) => (
                    <TextField
                      size="small"
                      autoFocus
                      placeholder="Search brand..."
                      value={draftBrandSearchQuery}
                      onChange={(e) => setDraftBrandSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleApplyBrandFilters();
                          close();
                        }
                      }}
                      fullWidth
                    />
                  ),
                },
                {
                  key: "status",
                  label: "Status",
                  hasValue: !!draftBrandActiveFilter,
                  render: () => (
                    <TStatusFilter
                      options={PRODUCT_ACTIVE_FILTER_OPTIONS}
                      value={draftBrandActiveFilter}
                      onChange={setDraftBrandActiveFilter}
                      label=""
                      size="small"
                    />
                  ),
                },
              ]}
              onSearch={handleApplyBrandFilters}
              onClear={handleClearBrandFilters}
              clearDisabled={
                !draftBrandSearchQuery && !draftBrandActiveFilter &&
                !brandState.searchQuery && !brandActiveFilter
              }
            />
          )
        }
        onRefresh={handleRefresh}
        headerActions={
          activeTab === 0 ? (
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
          ) : activeTab === 1 ? (
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
          ) : activeTab === 2 ? (
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
      >
        {activeTab === 0 && renderProductsTab()}
        {activeTab === 1 && renderCategoriesTab()}
        {activeTab === 2 && renderBrandsTab()}
      </MasterDetailLayout>

      {/* Single unified confirm dialog */}
      <TConfirmDialog {...confirmDialog.dialogProps} />

      {/* Minimum Selling Price Dialog */}
      <Dialog
        open={minPriceDialogOpen}
        onClose={() => setMinPriceDialogOpen(false)}
      >
        <DialogTitle>Set Minimum Selling Price</DialogTitle>
        <DialogContent>
          <TextField
            label="Minimum Selling Price"
            type="number"
            fullWidth
            value={newMinPrice}
            onChange={(e) => setNewMinPrice(parseFloat(e.target.value) || 0)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">Rs.</InputAdornment>
              ),
            }}
            sx={{ mt: 2 }}
            error={productState.selectedItem ? newMinPrice < productState.selectedItem.cost_price : false}
            helperText={
              productState.selectedItem && newMinPrice < productState.selectedItem.cost_price
                ? `Minimum price cannot be less than cost price (Rs. ${productState.selectedItem.cost_price})`
                : ""
            }
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMinPriceDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => setMinimumPriceMutation.mutate(newMinPrice)}
            disabled={
              setMinimumPriceMutation.isPending || 
              (productState.selectedItem ? newMinPrice < productState.selectedItem.cost_price : false)
            }
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

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
