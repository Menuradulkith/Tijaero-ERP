import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  TextField,
  MenuItem,
  FormControlLabel,
  Switch,
  InputAdornment,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
} from "@mui/material";
import {
  Inventory as InventoryIcon,
  Category as CategoryIcon,
  Sell as BrandIcon,
} from "@mui/icons-material";
import {
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  DetailPanelHeader,
  ActionToolbar,
  FormSection,
  EmptyState,
  useMasterDetailState,
  SortOption,
  TabConfig,
  TConfirmDialog,
  useTConfirmDialog,
  showSuccessToast,
  showErrorToast,
} from "@/components/tijaero";
import { productsApi, categoriesApi, brandsApi, minimumPriceApi } from "../api";
import { Product, ProductCreate, Category, CategoryCreate, CategoryUpdate, Brand, BrandCreate, BrandUpdate } from "../types";
import { usePermission } from "@/auth/permissions";

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
  item_type: "PRODUCT",
  description: "",
  website_active: false,
  website_price: 0,
  active: true,
  cost_price: 0,
  category_id: 0,
  items_brand_id: 0,
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

export default function ProductsPage({ view = "products", hideTabs = false }: ProductsPageProps) {
  const queryClient = useQueryClient();
  const viewToTab = (v: InventoryView) => (v === "products" ? 0 : v === "categories" ? 1 : 2);
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

  // Confirm dialogs
  const deleteProductDialog = useTConfirmDialog();
  const discardProductDialog = useTConfirmDialog();
  const deleteCategoryDialog = useTConfirmDialog();
  const discardCategoryDialog = useTConfirmDialog();
  const deleteBrandDialog = useTConfirmDialog();
  const discardBrandDialog = useTConfirmDialog();

  // Pending item for selection after discard confirm
  const [_pendingProduct, setPendingProduct] = useState<Product | null>(null);
  const [_pendingCategory, setPendingCategory] = useState<Category | null>(null);
  const [_pendingBrand, setPendingBrand] = useState<Brand | null>(null);

  // Minimum price dialog state
  const [minPriceDialogOpen, setMinPriceDialogOpen] = useState(false);
  const [newMinPrice, setNewMinPrice] = useState<number>(0);
  const [createMinPrice, setCreateMinPrice] = useState<number | "">("");

  // Products state
  const productState = useMasterDetailState<Product, ProductCreate>({
    initialFormData: emptyProductForm,
    initialSortField: "item_code",
  });

  // Categories state
  const categoryState = useMasterDetailState<Category, CategoryCreate>({
    initialFormData: emptyCategoryForm,
    initialSortField: "name",
  });

  // Brands state
  const brandState = useMasterDetailState<Brand, BrandCreate>({
    initialFormData: emptyBrandForm,
    initialSortField: "brand_name",
  });

  // Queries
  const { data: products, isLoading: productsLoading, refetch: refetchProducts } = useQuery({
    queryKey: ["products"],
    queryFn: () => productsApi.getAll(),
    enabled: activeTab === 0,
  });

  const { data: categories, isLoading: categoriesLoading, refetch: refetchCategories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => categoriesApi.getAll(),
  });

  const { data: brands, isLoading: brandsLoading, refetch: refetchBrands } = useQuery({
    queryKey: ["brands"],
    queryFn: () => brandsApi.getAll(),
  });

  // Fetch current minimum price for selected product
  const { data: currentMinPrice } = useQuery({
    queryKey: ["minimum-price", productState.selectedItem?.id],
    queryFn: () => minimumPriceApi.getCurrent(productState.selectedItem!.id),
    enabled: !!productState.selectedItem?.id,
    retry: false,
  });

  // Filtered and sorted data
  const filteredProducts = useMemo(() => {
    if (!products) return [];
    let filtered = products.filter(
      (p) =>
        p.item_code.toLowerCase().includes(productState.searchQuery.toLowerCase()) ||
        p.name.toLowerCase().includes(productState.searchQuery.toLowerCase()) ||
        p.model?.toLowerCase().includes(productState.searchQuery.toLowerCase())
    );
    filtered.sort((a, b) => {
      if (productState.sortField === "item_code") return a.item_code.localeCompare(b.item_code);
      if (productState.sortField === "name") return a.name.localeCompare(b.name);
      if (productState.sortField === "cost_price") return b.cost_price - a.cost_price;
      return 0;
    });
    return filtered;
  }, [products, productState.searchQuery, productState.sortField]);

  const filteredCategories = useMemo(() => {
    if (!categories) return [];
    let filtered = categories.filter(
      (c) =>
        c.name.toLowerCase().includes(categoryState.searchQuery.toLowerCase()) ||
        c.category_code.toLowerCase().includes(categoryState.searchQuery.toLowerCase())
    );
    filtered.sort((a, b) => {
      if (categoryState.sortField === "name") return a.name.localeCompare(b.name);
      if (categoryState.sortField === "category_code") return a.category_code.localeCompare(b.category_code);
      return 0;
    });
    return filtered;
  }, [categories, categoryState.searchQuery, categoryState.sortField]);

  const filteredBrands = useMemo(() => {
    if (!brands) return [];
    let filtered = brands.filter(
      (b) =>
        b.brand_name.toLowerCase().includes(brandState.searchQuery.toLowerCase()) ||
        b.brand_code.toLowerCase().includes(brandState.searchQuery.toLowerCase())
    );
    filtered.sort((a, b) => {
      if (brandState.sortField === "brand_name") return a.brand_name.localeCompare(b.brand_name);
      if (brandState.sortField === "brand_code") return a.brand_code.localeCompare(b.brand_code);
      return 0;
    });
    return filtered;
  }, [brands, brandState.searchQuery, brandState.sortField]);

  // Mutations
  const createProductMutation = useMutation({
    mutationFn: productsApi.create,
    onSuccess: (newProduct) => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      showSuccessToast("Product created successfully");
      productState.setIsCreating(false);
      productState.setIsEditing(false);
      productState.setSelectedItem(newProduct);

      const priceToSet = typeof createMinPrice === "number" ? createMinPrice : 0;
      if (priceToSet > 0 && canUpdate) {
        setMinimumPriceForProductMutation.mutate({ productId: newProduct.id, price: priceToSet });
      }
      setCreateMinPrice("");
    },
    onError: () => showErrorToast("Failed to create product"),
  });

  const updateProductMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ProductCreate> }) => productsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      showSuccessToast("Product updated successfully");
      productState.setIsEditing(false);
    },
    onError: () => showErrorToast("Failed to update product"),
  });

  const deleteProductMutation = useMutation({
    mutationFn: productsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      showSuccessToast("Product deleted successfully");
      productState.setSelectedItem(null);
    },
    onError: () => showErrorToast("Failed to delete product"),
  });

  const createCategoryMutation = useMutation({
    mutationFn: categoriesApi.create,
    onSuccess: (newCategory) => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      showSuccessToast("Category created successfully");
      categoryState.setIsCreating(false);
      categoryState.setIsEditing(false);
      categoryState.setSelectedItem(newCategory);
    },
    onError: () => showErrorToast("Failed to create category"),
  });

  const updateCategoryMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: CategoryUpdate }) => categoriesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      showSuccessToast("Category updated successfully");
      categoryState.setIsEditing(false);
    },
    onError: () => showErrorToast("Failed to update category"),
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: categoriesApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      showSuccessToast("Category deleted successfully");
      categoryState.setSelectedItem(null);
    },
    onError: () => showErrorToast("Failed to delete category"),
  });

  const createBrandMutation = useMutation({
    mutationFn: brandsApi.create,
    onSuccess: (newBrand) => {
      queryClient.invalidateQueries({ queryKey: ["brands"] });
      showSuccessToast("Brand created successfully");
      brandState.setIsCreating(false);
      brandState.setIsEditing(false);
      brandState.setSelectedItem(newBrand);
    },
    onError: () => showErrorToast("Failed to create brand"),
  });

  const updateBrandMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: BrandUpdate }) => brandsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brands"] });
      showSuccessToast("Brand updated successfully");
      brandState.setIsEditing(false);
    },
    onError: () => showErrorToast("Failed to update brand"),
  });

  const deleteBrandMutation = useMutation({
    mutationFn: brandsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brands"] });
      showSuccessToast("Brand deleted successfully");
      brandState.setSelectedItem(null);
    },
    onError: () => showErrorToast("Failed to delete brand"),
  });

  // Minimum price mutation
  const setMinimumPriceForProductMutation = useMutation({
    mutationFn: ({ productId, price }: { productId: number; price: number }) =>
      minimumPriceApi.set(productId, { minimum_price: price }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["minimum-price", variables.productId] });
      showSuccessToast("Minimum price set successfully");
    },
    onError: () => showErrorToast("Failed to set minimum price"),
  });

  const setMinimumPriceMutation = useMutation({
    mutationFn: (price: number) => minimumPriceApi.set(productState.selectedItem!.id, { minimum_price: price }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["minimum-price", productState.selectedItem?.id] });
      showSuccessToast("Minimum price set successfully");
      setMinPriceDialogOpen(false);
      setNewMinPrice(0);
    },
    onError: () => showErrorToast("Failed to set minimum price"),
  });

  // Product handlers
  const handleSelectProduct = (product: Product) => {
    if (productState.isEditing || productState.isCreating) {
      setPendingProduct(product);
      discardProductDialog.open(
        "Discard Changes",
        "You have unsaved changes. Discard them?",
        () => {
          selectProductInternal(product);
          setPendingProduct(null);
        }
      );
      return;
    }
    selectProductInternal(product);
  };

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
      active: product.active,
      cost_price: product.cost_price,
      category_id: product.category_id,
      items_brand_id: product.items_brand_id,
    });
    productState.setIsEditing(false);
    productState.setIsCreating(false);
  };

  const handleNewProduct = () => {
    productState.setSelectedItem(null);
    productState.setFormData({
      ...emptyProductForm,
      category_id: categories?.[0]?.id || 0,
      items_brand_id: brands?.[0]?.id || 0,
    });
    setCreateMinPrice("");
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
    if (productState.isCreating) {
      createProductMutation.mutate(productState.formData);
    } else if (productState.selectedItem) {
      updateProductMutation.mutate({ id: productState.selectedItem.id, data: productState.formData });
    }
  };

  const handleCancelProduct = () => {
    if (productState.isCreating) {
      productState.setIsCreating(false);
      productState.setIsEditing(false);
      setCreateMinPrice("");
      if (filteredProducts.length > 0) handleSelectProduct(filteredProducts[0]);
    } else if (productState.selectedItem) {
      handleSelectProduct(productState.selectedItem);
      productState.setIsEditing(false);
    }
  };

  const handleDeleteProduct = () => {
    if (productState.selectedItem) {
      deleteProductDialog.open(
        "Delete Product",
        "Are you sure you want to delete this product?",
        () => deleteProductMutation.mutate(productState.selectedItem!.id)
      );
    }
  };

  // Category handlers
  const handleSelectCategory = (category: Category) => {
    if (categoryState.isEditing || categoryState.isCreating) {
      setPendingCategory(category);
      discardCategoryDialog.open(
        "Discard Changes",
        "You have unsaved changes. Discard them?",
        () => {
          selectCategoryInternal(category);
          setPendingCategory(null);
        }
      );
      return;
    }
    selectCategoryInternal(category);
  };

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
    categoryState.setIsCreating(true);
    categoryState.setIsEditing(true);
  };

  const handleSaveCategory = () => {
    if (categoryState.isCreating) {
      createCategoryMutation.mutate(categoryState.formData);
    } else if (categoryState.selectedItem) {
      updateCategoryMutation.mutate({ id: categoryState.selectedItem.id, data: categoryState.formData });
    }
  };

  const handleDeleteCategory = () => {
    if (categoryState.selectedItem) {
      deleteCategoryDialog.open(
        "Delete Category",
        "Are you sure you want to delete this category?",
        () => deleteCategoryMutation.mutate(categoryState.selectedItem!.id)
      );
    }
  };

  const handleCancelCategory = () => {
    if (categoryState.isCreating) {
      categoryState.setIsCreating(false);
      categoryState.setIsEditing(false);
      if (filteredCategories.length > 0) handleSelectCategory(filteredCategories[0]);
    } else if (categoryState.selectedItem) {
      handleSelectCategory(categoryState.selectedItem);
      categoryState.setIsEditing(false);
    }
  };

  // Brand handlers
  const handleSelectBrand = (brand: Brand) => {
    if (brandState.isEditing || brandState.isCreating) {
      setPendingBrand(brand);
      discardBrandDialog.open(
        "Discard Changes",
        "You have unsaved changes. Discard them?",
        () => {
          selectBrandInternal(brand);
          setPendingBrand(null);
        }
      );
      return;
    }
    selectBrandInternal(brand);
  };

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

  const handleNewBrand = () => {
    brandState.setSelectedItem(null);
    brandState.setFormData(emptyBrandForm);
    brandState.setIsCreating(true);
    brandState.setIsEditing(true);
  };

  const handleSaveBrand = () => {
    if (brandState.isCreating) {
      createBrandMutation.mutate(brandState.formData);
    } else if (brandState.selectedItem) {
      updateBrandMutation.mutate({ id: brandState.selectedItem.id, data: brandState.formData });
    }
  };

  const handleDeleteBrand = () => {
    if (brandState.selectedItem) {
      deleteBrandDialog.open(
        "Delete Brand",
        "Are you sure you want to delete this brand?",
        () => deleteBrandMutation.mutate(brandState.selectedItem!.id)
      );
    }
  };

  const handleCancelBrand = () => {
    if (brandState.isCreating) {
      brandState.setIsCreating(false);
      brandState.setIsEditing(false);
      if (filteredBrands.length > 0) handleSelectBrand(filteredBrands[0]);
    } else if (brandState.selectedItem) {
      handleSelectBrand(brandState.selectedItem);
      brandState.setIsEditing(false);
    }
  };

  const handleRefresh = () => {
    if (activeTab === 0) refetchProducts();
    else if (activeTab === 1) refetchCategories();
    else refetchBrands();
  };

  // Tab configuration
  const tabs: TabConfig[] = [
    { label: "Products" },
    { label: "Categories" },
    { label: "Brands" },
  ];

  const pageTitle = activeTab === 0 ? "Products" : activeTab === 1 ? "Categories" : "Brands";

  // Render Products Tab
  const renderProductsTab = () => (
    <Box sx={{ flex: 1, display: "flex", flexDirection: { xs: "column", md: "row" }, overflow: "hidden" }}>
      <SearchableList
        searchValue={productState.searchQuery}
        onSearchChange={productState.setSearchQuery}
        searchPlaceholder="Search products..."
        sortOptions={productSortOptions}
        currentSort={productState.sortField}
        onSortChange={productState.setSortField}
        isLoading={productsLoading}
        emptyMessage="No products found"
      >
        {filteredProducts.map((product) => (
          <SelectableListItem
            key={product.id}
            isSelected={productState.selectedItem?.id === product.id}
            onClick={() => handleSelectProduct(product)}
            primaryText={product.item_code}
            secondaryText={product.name}
            isFavorite={productState.favorites.includes(product.id)}
            onToggleFavorite={() => productState.toggleFavorite(product.id)}
            chips={[
              ...(product.active ? [{ label: "Active", color: "success" as const }] : []),
              ...(product.website_active ? [{ label: "Web", color: "info" as const }] : []),
            ]}
          />
        ))}
      </SearchableList>

      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <DetailPanelHeader
          icon={<InventoryIcon color="primary" />}
          breadcrumbs={[{ label: "Inventory", href: "/inventory" }, { label: "Products" }]}
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
                  { label: productState.selectedItem.active ? "Active" : "Inactive", color: productState.selectedItem.active ? "success" : "default" },
                  ...(productState.selectedItem.website_active ? [{ label: "Website Active", color: "info" as const }] : []),
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
          isSaving={createProductMutation.isPending || updateProductMutation.isPending}
          saveDisabled={!productState.formData.name || !productState.formData.item_code}
        />

        <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
          {!productState.selectedItem && !productState.isCreating ? (
            <EmptyState message="Select a product from the list or create a new one" />
          ) : (
            <>
              <FormSection title="Basic Information">
                <TextField
                  label="Item Code"
                  size="small"
                  value={productState.formData.item_code}
                  onChange={(e) => productState.setFormData({ ...productState.formData, item_code: e.target.value.toUpperCase() })}
                  disabled={!productState.isCreating}
                  required
                  inputProps={{ style: { textTransform: "uppercase" } }}
                />
                <TextField
                  label="Product Name"
                  size="small"
                  value={productState.formData.name}
                  onChange={(e) => productState.setFormData({ ...productState.formData, name: e.target.value })}
                  disabled={!productState.isEditing && !productState.isCreating}
                  required
                />
                <TextField
                  label="Model"
                  size="small"
                  value={productState.formData.model}
                  onChange={(e) => productState.setFormData({ ...productState.formData, model: e.target.value })}
                  disabled={!productState.isEditing && !productState.isCreating}
                />
                <TextField
                  label="Item Type"
                  size="small"
                  select
                  value={productState.formData.item_type}
                  onChange={(e) => productState.setFormData({ ...productState.formData, item_type: e.target.value })}
                  disabled={!productState.isEditing && !productState.isCreating}
                >
                  <MenuItem value="PRODUCT">Product</MenuItem>
                  <MenuItem value="SERVICE">Service</MenuItem>
                  <MenuItem value="PART">Part</MenuItem>
                </TextField>
                <TextField
                  label="Description"
                  size="small"
                  value={productState.formData.description}
                  onChange={(e) => productState.setFormData({ ...productState.formData, description: e.target.value })}
                  disabled={!productState.isEditing && !productState.isCreating}
                  multiline
                  rows={2}
                  sx={{ gridColumn: { sm: "1 / -1" } }}
                />
              </FormSection>

              <FormSection title="Classification">
                <TextField
                  label="Category"
                  size="small"
                  select
                  value={productState.formData.category_id}
                  onChange={(e) => productState.setFormData({ ...productState.formData, category_id: Number(e.target.value) })}
                  disabled={!productState.isEditing && !productState.isCreating}
                >
                  {categories?.map((cat) => (
                    <MenuItem key={cat.id} value={cat.id}>{cat.name}</MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Brand"
                  size="small"
                  select
                  value={productState.formData.items_brand_id}
                  onChange={(e) => productState.setFormData({ ...productState.formData, items_brand_id: Number(e.target.value) })}
                  disabled={!productState.isEditing && !productState.isCreating}
                >
                  {brands?.map((brand) => (
                    <MenuItem key={brand.id} value={brand.id}>{brand.brand_name}</MenuItem>
                  ))}
                </TextField>
              </FormSection>

              <FormSection title="Pricing">
                <TextField
                  label="Cost Price"
                  size="small"
                  type="number"
                  value={productState.formData.cost_price}
                  onChange={(e) => productState.setFormData({ ...productState.formData, cost_price: parseFloat(e.target.value) || 0 })}
                  disabled={!productState.isEditing && !productState.isCreating}
                  InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                />
                <TextField
                  label="Website Price"
                  size="small"
                  type="number"
                  value={productState.formData.website_price}
                  onChange={(e) => productState.setFormData({ ...productState.formData, website_price: parseFloat(e.target.value) || 0 })}
                  disabled={!productState.isEditing && !productState.isCreating}
                  InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                />
                {/* Minimum Price */}
                {productState.isCreating ? (
                  <TextField
                    label="Minimum Price"
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
                      setCreateMinPrice(Number.isFinite(parsed) ? Math.max(0, parsed) : "");
                    }}
                    InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                  />
                ) : (
                  productState.selectedItem && (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 2, gridColumn: { sm: "1 / -1" } }}>
                    <Typography variant="body2" color="text.secondary">
                      Minimum Price:
                    </Typography>
                    {currentMinPrice ? (
                      <Chip
                        label={`$${currentMinPrice.minimum_price.toFixed(2)}`}
                        color="primary"
                        size="small"
                      />
                    ) : (
                      <Typography variant="body2" color="text.secondary">Not set</Typography>
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

              <FormSection title="Status" isLast>
                <Box sx={{ display: "flex", gap: 3, gridColumn: { sm: "1 / -1" } }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={productState.formData.active}
                        onChange={(e) => productState.setFormData({ ...productState.formData, active: e.target.checked })}
                        disabled={!productState.isEditing && !productState.isCreating}
                      />
                    }
                    label="Active"
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={productState.formData.website_active}
                        onChange={(e) => productState.setFormData({ ...productState.formData, website_active: e.target.checked })}
                        disabled={!productState.isEditing && !productState.isCreating}
                      />
                    }
                    label="Website Active"
                  />
                </Box>
              </FormSection>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );

  // Render Categories Tab
  const renderCategoriesTab = () => (
    <Box sx={{ flex: 1, display: "flex", flexDirection: { xs: "column", md: "row" }, overflow: "hidden" }}>
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
        {filteredCategories.map((category) => (
          <SelectableListItem
            key={category.id}
            isSelected={categoryState.selectedItem?.id === category.id}
            onClick={() => handleSelectCategory(category)}
            primaryText={category.name}
            secondaryText={category.category_code}
            isFavorite={categoryState.favorites.includes(category.id)}
            onToggleFavorite={() => categoryState.toggleFavorite(category.id)}
            chips={[{ label: category.active ? "Active" : "Inactive", color: category.active ? "success" : "default" }]}
          />
        ))}
      </SearchableList>

      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <DetailPanelHeader
          icon={<CategoryIcon color="primary" />}
          breadcrumbs={[{ label: "Inventory", href: "/inventory" }, { label: "Categories" }]}
          title={
            categoryState.isCreating
              ? "New Category"
              : categoryState.selectedItem
              ? categoryState.selectedItem.name
              : "Select a Category"
          }
          chips={
            categoryState.selectedItem && !categoryState.isCreating
              ? [{ label: categoryState.selectedItem.active ? "Active" : "Inactive", color: categoryState.selectedItem.active ? "success" : "default" }]
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
          isSaving={createCategoryMutation.isPending || updateCategoryMutation.isPending}
          saveDisabled={!categoryState.formData.name || !categoryState.formData.category_code}
        />

        <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
          {!categoryState.selectedItem && !categoryState.isCreating ? (
            <EmptyState message="Select a category from the list or create a new one" />
          ) : (
            <FormSection title="Category Information" isLast>
              <TextField
                label="Category Name"
                size="small"
                value={categoryState.formData.name}
                onChange={(e) => categoryState.setFormData({ ...categoryState.formData, name: e.target.value })}
                disabled={!categoryState.isEditing && !categoryState.isCreating}
                required
              />
              <TextField
                label="Category Code"
                size="small"
                value={categoryState.formData.category_code}
                onChange={(e) => categoryState.setFormData({ ...categoryState.formData, category_code: e.target.value.toUpperCase() })}
                disabled={!categoryState.isCreating}
                required
                inputProps={{ style: { textTransform: "uppercase" } }}
              />
              <TextField
                label="Memo"
                size="small"
                value={categoryState.formData.memo}
                onChange={(e) => categoryState.setFormData({ ...categoryState.formData, memo: e.target.value })}
                disabled={!categoryState.isEditing && !categoryState.isCreating}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={categoryState.formData.active}
                    onChange={(e) => categoryState.setFormData({ ...categoryState.formData, active: e.target.checked })}
                    disabled={!categoryState.isEditing && !categoryState.isCreating}
                  />
                }
                label="Active"
              />
              <TextField
                label="Description"
                size="small"
                value={categoryState.formData.description}
                onChange={(e) => categoryState.setFormData({ ...categoryState.formData, description: e.target.value })}
                disabled={!categoryState.isEditing && !categoryState.isCreating}
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

  // Render Brands Tab
  const renderBrandsTab = () => (
    <Box sx={{ flex: 1, display: "flex", flexDirection: { xs: "column", md: "row" }, overflow: "hidden" }}>
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
        {filteredBrands.map((brand) => (
          <SelectableListItem
            key={brand.id}
            isSelected={brandState.selectedItem?.id === brand.id}
            onClick={() => handleSelectBrand(brand)}
            primaryText={brand.brand_name}
            secondaryText={brand.brand_code}
            isFavorite={brandState.favorites.includes(brand.id)}
            onToggleFavorite={() => brandState.toggleFavorite(brand.id)}
          />
        ))}
      </SearchableList>

      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <DetailPanelHeader
          icon={<BrandIcon color="primary" />}
          breadcrumbs={[{ label: "Inventory", href: "/inventory" }, { label: "Brands" }]}
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
          isSaving={createBrandMutation.isPending || updateBrandMutation.isPending}
          saveDisabled={!brandState.formData.brand_name || !brandState.formData.brand_code}
        />

        <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
          {!brandState.selectedItem && !brandState.isCreating ? (
            <EmptyState message="Select a brand from the list or create a new one" />
          ) : (
            <FormSection title="Brand Information" isLast>
              <TextField
                label="Brand Name"
                size="small"
                value={brandState.formData.brand_name}
                onChange={(e) => brandState.setFormData({ ...brandState.formData, brand_name: e.target.value })}
                disabled={!brandState.isEditing && !brandState.isCreating}
                required
              />
              <TextField
                label="Brand Code"
                size="small"
                value={brandState.formData.brand_code}
                onChange={(e) => brandState.setFormData({ ...brandState.formData, brand_code: e.target.value.toUpperCase() })}
                disabled={!brandState.isCreating}
                required
                inputProps={{ style: { textTransform: "uppercase" } }}
              />
              <TextField
                label="Description"
                size="small"
                value={brandState.formData.description}
                onChange={(e) => brandState.setFormData({ ...brandState.formData, description: e.target.value })}
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
        {...(!hideTabs
          ? {
              tabs,
              activeTab,
              onTabChange: (tab: number | string) => setActiveTab(tab as number),
            }
          : {})}
      >
        {activeTab === 0 && renderProductsTab()}
        {activeTab === 1 && renderCategoriesTab()}
        {activeTab === 2 && renderBrandsTab()}
      </MasterDetailLayout>
      <TConfirmDialog {...deleteProductDialog.dialogProps} />
      <TConfirmDialog {...discardProductDialog.dialogProps} confirmText="Discard" />
      <TConfirmDialog {...deleteCategoryDialog.dialogProps} />
      <TConfirmDialog {...discardCategoryDialog.dialogProps} confirmText="Discard" />
      <TConfirmDialog {...deleteBrandDialog.dialogProps} />
      <TConfirmDialog {...discardBrandDialog.dialogProps} confirmText="Discard" />
      
      {/* Minimum Price Dialog */}
      <Dialog open={minPriceDialogOpen} onClose={() => setMinPriceDialogOpen(false)}>
        <DialogTitle>Set Minimum Price</DialogTitle>
        <DialogContent>
          <TextField
            label="Minimum Price"
            type="number"
            fullWidth
            value={newMinPrice}
            onChange={(e) => setNewMinPrice(parseFloat(e.target.value) || 0)}
            InputProps={{
              startAdornment: <InputAdornment position="start">$</InputAdornment>,
            }}
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMinPriceDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => setMinimumPriceMutation.mutate(newMinPrice)}
            disabled={setMinimumPriceMutation.isPending}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
