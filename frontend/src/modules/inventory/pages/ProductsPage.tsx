import apiClient from "@/api/client";
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
    TConfirmDialog,
    useConfirmDialog,
  useCrudMutation,
    useMasterDetailState,
} from "@/components/tijaero";
import { formatDateTimeReadable } from "@/utils/formatters";
import {
    Sell as BrandIcon,
    Category as CategoryIcon,
    FileDownload as DownloadIcon,
    Inventory as InventoryIcon,
} from "@mui/icons-material";
import {
    Alert,
    Autocomplete,
    Box,
    Button,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    InputAdornment,
    MenuItem,
    Switch,
    TextField,
    Typography,
} from "@mui/material";
  import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { brandsApi, categoriesApi, minimumPriceApi, productsApi } from "../api";
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
];

const categorySortOptions: SortOption[] = [
  { value: "name", label: "Name" },
  { value: "category_code", label: "Code" },
];

const brandSortOptions: SortOption[] = [
  { value: "brand_name", label: "Name" },
  { value: "brand_code", label: "Code" },
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

const productAddedDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

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
  const canCreate = usePermission("inventory", "create");
  const canUpdate = usePermission("inventory", "update");
  const canDelete = usePermission("inventory", "delete");

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

  // Minimum selling price dialog state
  const [minPriceDialogOpen, setMinPriceDialogOpen] = useState(false);
  const [newMinPrice, setNewMinPrice] = useState<number>(0);
  const [createMinPrice, setCreateMinPrice] = useState<number | "">("");

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
    queryFn: () => categoriesApi.getAll(0, 1000), // Get all including inactive
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const {
    data: brands,
    isLoading: brandsLoading,
    refetch: refetchBrands,
  } = useQuery({
    queryKey: ["brands"],
    queryFn: () => brandsApi.getAll(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  //consctive categories and brands for dropdowns (only active items can be selected for new products)
  const activeCategories = useMemo(
    () => categories?.filter((c) => c.active) || [],
    [categories],
  );
  const activeBrands = useMemo(() => brands || [], [brands]);

  // Fetch current minimum selling price for selected product
  const { data: currentMinPrice } = useQuery({
    queryKey: ["minimum-price", productState.selectedItem?.id],
    queryFn: () => minimumPriceApi.getCurrent(productState.selectedItem!.id),
    enabled: !!productState.selectedItem?.id,
    retry: false,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  //consiltered and sorted data
  const filteredProducts = useMemo(() => {
    if (!products) return [];
    const filtered = products.filter(
      (p) =>
        p.item_code
          .toLowerCase()
          .includes(productState.searchQuery.toLowerCase()) ||
        p.name.toLowerCase().includes(productState.searchQuery.toLowerCase()) ||
        p.model?.toLowerCase().includes(productState.searchQuery.toLowerCase()),
    );
    filtered.sort((a, b) => {
      if (productState.sortField === "item_code")
        return a.item_code.localeCompare(b.item_code);
      if (productState.sortField === "name")
        return a.name.localeCompare(b.name);
      if (productState.sortField === "cost_price")
        return b.cost_price - a.cost_price;
      return 0;
    });
    return filtered;
  }, [products, productState.searchQuery, productState.sortField]);

  const preparedProducts = useMemo(
    () =>
      filteredProducts.map((product) => ({
        product,
        addedDateLabel: productAddedDateFormatter.format(new Date(product.added_date)),
      })),
    [filteredProducts],
  );

  const filteredCategories = useMemo(() => {
    if (!categories) return [];
    const filtered = categories.filter(
      (c) =>
        c.name
          .toLowerCase()
          .includes(categoryState.searchQuery.toLowerCase()) ||
        c.category_code
          .toLowerCase()
          .includes(categoryState.searchQuery.toLowerCase()),
    );
    filtered.sort((a, b) => {
      if (categoryState.sortField === "name")
        return a.name.localeCompare(b.name);
      if (categoryState.sortField === "category_code")
        return a.category_code.localeCompare(b.category_code);
      return 0;
    });
    return filtered;
  }, [categories, categoryState.searchQuery, categoryState.sortField]);

  const filteredBrands = useMemo(() => {
    if (!brands) return [];
    const filtered = brands.filter(
      (b) =>
        b.brand_name
          .toLowerCase()
          .includes(brandState.searchQuery.toLowerCase()) ||
        b.brand_code
          .toLowerCase()
          .includes(brandState.searchQuery.toLowerCase()),
    );
    filtered.sort((a, b) => {
      if (brandState.sortField === "brand_name")
        return a.brand_name.localeCompare(b.brand_name);
      if (brandState.sortField === "brand_code")
        return a.brand_code.localeCompare(b.brand_code);
      return 0;
    });
    return filtered;
  }, [brands, brandState.searchQuery, brandState.sortField]);

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
    },
  });

  const updateProductMutation = useCrudMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ProductCreate> }) =>
      productsApi.update(id, data),
    invalidateQueryKeys: [["products"], ["referenceData"]],
    successMessage: "Product updated successfully",
    errorMessage: "Failed to update product",
    onSuccess: () => {
      productState.setIsEditing(false);
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
    onSuccess: () => {
      categoryState.setIsEditing(false);
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
    onSuccess: () => {
      brandState.setIsEditing(false);
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
    });
    brandState.setIsEditing(false);
    brandState.setIsCreating(false);
  };

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

  const handleRefresh = () => {
    refetchProducts();
    refetchCategories();
    refetchBrands();
  };

  const handleExportProductsCSV = async () => {
    try {
      const response = await apiClient.get<Blob>(
        `/inventory/products/export-csv?limit=100000`,
        { responseType: "blob" },
      );

      const blob = response.data;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `products_${new Date().toISOString().split("T")[0]}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
    }
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
        searchPlaceholder="Search products..."
        sortOptions={productSortOptions}
        currentSort={productState.sortField}
        onSortChange={productState.setSortField}
        isLoading={productsLoading}
        emptyMessage="No products found"
        virtualize
        estimatedItemHeight={90}
        overscanCount={8}
      >
        {preparedProducts.map(({ product, addedDateLabel }) => {
          const isSelected = productState.selectedItem?.id === product.id;
          return (
            <SelectableListItem
              key={product.id}
              isSelected={isSelected}
              onClick={() => handleSelectProduct(product)}
              primaryText={
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    width: "100%",
                    gap: 0.5,
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
                  {/* Creation date — always visible */}
                  <Typography
                    component="span"
                    variant="caption"
                    sx={{ opacity: 0.55, fontSize: "0.68rem" }}
                  >
                    Added: {addedDateLabel}
                  </Typography>
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
                {productState.selectedItem && !productState.isCreating && (
                  <TextField
                    label="Created On"
                    size="small"
                    value={new Date(
                      productState.selectedItem.added_date,
                    ).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                    disabled
                    InputProps={{ readOnly: true }}
                  />
                )}
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

              <FormSection title="Product Image">
                <Box sx={{ gridColumn: { sm: "1 / -1" } }}>
                  <TextField
                    label="Image URL"
                    size="small"
                    fullWidth
                    value={productState.formData.image_url ?? ""}
                    onChange={(e) =>
                      productState.setFormData({
                        ...productState.formData,
                        image_url: e.target.value,
                      })
                    }
                    disabled={
                      !productState.isEditing && !productState.isCreating
                    }
                    placeholder="https://example.com/product-image.jpg"
                    helperText="Paste a direct link to the product image (optional)"
                  />
                </Box>
              </FormSection>

              <FormSection title="Classification">
                <Autocomplete
                  size="small"
                  options={activeCategories}
                  getOptionLabel={(option) => option.name}
                  value={
                    activeCategories.find(
                      (c) => c.id === productState.formData.category_id,
                    ) || null
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
                  options={brands || []}
                  getOptionLabel={(option) => option.brand_name}
                  value={
                    brands?.find(
                      (b) => b.id === productState.formData.items_brand_id,
                    ) || null
                  }
                  onChange={(_, newValue) =>
                    productState.setFormData({
                      ...productState.formData,
                      items_brand_id: newValue?.id || 0,
                    })
                  }
                  disabled={!productState.isEditing && !productState.isCreating}
                  renderInput={(params) => (
                    <TextField {...params} label="Brand" />
                  )}
                  isOptionEqualToValue={(option, value) =>
                    option.id === value.id
                  }
                />
              </FormSection>

              <FormSection title="Pricing">
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
                  <FormSection title="Record Information" columns={2}>
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Created
                      </Typography>
                      <Typography variant="body2">
                        {formatDateTimeReadable(
                          productState.selectedItem.created_at,
                        ) || "-"}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Last Modified
                      </Typography>
                      <Typography variant="body2">
                        {formatDateTimeReadable(
                          productState.selectedItem.updated_at,
                        ) || "-"}
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
        searchPlaceholder="Search categories..."
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

              <FormSection title="Category Information" isLast>
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
        searchPlaceholder="Search brands..."
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
                    </>
                  )}
                </Box>
              }
              secondaryText={!isSelected ? brand.brand_code : undefined}
              isFavorite={brandState.favorites.includes(brand.id)}
              onToggleFavorite={() => brandState.toggleFavorite(brand.id)}
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
            <FormSection title="Brand Information" isLast>
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
                  brandTouched.brand_code && !brandState.formData.brand_code
                }
                helperText={
                  brandTouched.brand_code && !brandState.formData.brand_code
                    ? "Brand code is required"
                    : ""
                }
                inputProps={{ style: { textTransform: "uppercase" } }}
              />
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
          )}
        </Box>
      </Box>
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title={pageTitle}
        onRefresh={handleRefresh}
        headerActions={
          activeTab === 0 ? (
            <Button
              variant="outlined"
              size="small"
              startIcon={<DownloadIcon />}
              onClick={handleExportProductsCSV}
              disabled={filteredProducts.length === 0}
              sx={{ mr: 1 }}
            >
              Export CSV
            </Button>
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
    </>
  );
}
