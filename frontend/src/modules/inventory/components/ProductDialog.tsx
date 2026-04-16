import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Grid,
  FormControlLabel,
  Checkbox,
  Autocomplete,
} from "@mui/material";
import { productsApi, categoriesApi, brandsApi } from "../api";
import { Product, ProductCreate } from "../types";
import { showSuccessToast, showErrorToast } from "@/components/tijaero";

interface ProductDialogProps {
  open: boolean;
  product: Product | null;
  onClose: () => void;
}

export default function ProductDialog({
  open,
  product,
  onClose,
}: ProductDialogProps) {
  const queryClient = useQueryClient();
  const isEdit = !!product;

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => categoriesApi.getAll(),
  });

  const { data: brands } = useQuery({
    queryKey: ["brands"],
    queryFn: () => brandsApi.getAll(),
  });

  const { 
    control, 
    handleSubmit, 
    reset, 
    formState: { isSubmitting } 
  } = useForm<ProductCreate>({
    defaultValues: {
      name: "",
      item_code: "",
      model: "",
      item_type: "product",
      description: "",
      cost_price: 0,
      website_price: 0,
      website_active: false,
      active: true,
      category_id: 0,
      items_brand_id: 0,
    },
  });

  // Style for required field labels (red asterisk)
  const requiredFieldSx = {
    '& .MuiInputLabel-asterisk': {
      color: 'error.main',
    },
  };

  useEffect(() => {
    if (product) {
      reset({
        name: product.name,
        item_code: product.item_code,
        model: product.model || "",
        item_type: product.item_type,
        description: product.description || "",
        cost_price: product.cost_price,
        website_price: product.website_price || 0,
        website_active: product.website_active,
        active: product.active,
        category_id: product.category_id,
        items_brand_id: product.items_brand_id,
      });
    } else {
      reset({
        name: "",
        item_code: "",
        model: "",
        item_type: "product",
        description: "",
        cost_price: 0,
        website_price: 0,
        website_active: false,
        active: true,
        category_id: categories?.[0]?.id || 0,
        items_brand_id: brands?.[0]?.id || 0,
      });
    }
  }, [product, categories, brands, reset]);

  const createMutation = useMutation({
    mutationFn: productsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      showSuccessToast("Product created successfully");
      onClose();
    },
    onError: () => {
      showErrorToast("Failed to create product");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: ProductCreate }) =>
      productsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      showSuccessToast("Product updated successfully");
      onClose();
    },
    onError: () => {
      showErrorToast("Failed to update product");
    },
  });

  const onSubmit = (data: ProductCreate) => {
    if (isEdit && product) {
      updateMutation.mutate({ id: product.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogTitle>{isEdit ? "Edit Product" : "Add Product"}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <Controller
                name="name"
                control={control}
                rules={{ 
                  required: "Product name is required",
                  minLength: { value: 2, message: "Name must be at least 2 characters" },
                  maxLength: { value: 100, message: "Name cannot exceed 100 characters" }
                }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Product Name"
                    fullWidth
                    required
                    sx={requiredFieldSx}
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message || "Enter a descriptive product name"}
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="item_code"
                control={control}
                rules={{ 
                  required: "Item code is required",
                  pattern: {
                    value: /^[A-Z0-9-_]+$/,
                    message: "Use only uppercase letters, numbers, hyphens and underscores"
                  },
                  maxLength: { value: 20, message: "Code cannot exceed 20 characters" },
                  validate: (value) => {
                    const products = queryClient.getQueryData<Product[]>(["products"]) || [];
                    const exists = products.some(p => p.item_code.toLowerCase() === value.toLowerCase() && (!isEdit || p.id !== product?.id));
                    return !exists || "Item code already exists";
                  },
                }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Item Code"
                    fullWidth
                    required
                    sx={requiredFieldSx}
                    disabled={isEdit}
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message || (isEdit ? "Cannot edit item code" : "Unique identifier for the product")}
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="model"
                control={control}
                render={({ field }) => (
                  <TextField 
                    {...field} 
                    label="Model" 
                    fullWidth 
                    helperText="Product model or variant (optional)"
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="item_type"
                control={control}
                render={({ field }) => (
                  <TextField {...field} label="Type" fullWidth />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="category_id"
                control={control}
                rules={{ required: "Category is required" }}
                render={({ field, fieldState }) => (
                  <Autocomplete
                    options={categories || []}
                    getOptionLabel={(option) => option.name}
                    value={
                      categories?.find((c) => c.id === field.value) || null
                    }
                    onChange={(_, newValue) =>
                      field.onChange(newValue?.id || 0)
                    }
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Category"
                        required
                        sx={requiredFieldSx}
                        error={!!fieldState.error}
                        helperText={fieldState.error?.message || "Select the product category"}
                        placeholder="Search categories..."
                      />
                    )}
                    fullWidth
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="items_brand_id"
                control={control}
                rules={{ required: "Brand is required" }}
                render={({ field, fieldState }) => (
                  <Autocomplete
                    options={brands || []}
                    getOptionLabel={(option) => option.brand_name}
                    value={brands?.find((b) => b.id === field.value) || null}
                    onChange={(_, newValue) =>
                      field.onChange(newValue?.id || 0)
                    }
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Brand"
                        required
                        sx={requiredFieldSx}
                        error={!!fieldState.error}
                        helperText={fieldState.error?.message || "Select the product brand"}
                        placeholder="Search brands..."
                      />
                    )}
                    fullWidth
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="cost_price"
                control={control}
                rules={{ 
                  required: "Cost price is required",
                  min: { value: 0, message: "Cost price cannot be negative" },
                  validate: (value) => {
                    if (value === undefined || value === null) return "Cost price is required";
                    if (value <= 0) return "Cost price must be greater than 0";
                    if (value > 999999.99) return "Cost price is too high";
                    return true;
                  }
                }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Cost Price"
                    type="number"
                    fullWidth
                    required
                    sx={requiredFieldSx}
                    inputProps={{ min: 0, step: 0.01 }}
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message || "Purchase cost of the product"}
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="selling_price"
                control={control}
                rules={{
                  min: { value: 0, message: "Selling price cannot be negative" },
                  validate: (value, formValues) => {
                    if (value && value > 0 && formValues?.cost_price && value < formValues.cost_price) {
                      return "Selling price should not be less than cost price";
                    }
                    return true;
                  }
                }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Selling Price"
                    type="number"
                    fullWidth
                    inputProps={{ min: 0, step: 0.01 }}
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message || "Default selling price"}
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="website_price"
                control={control}
                rules={{
                  min: { value: 0, message: "Website price cannot be negative" },
                  validate: (value, formValues) => {
                    if (value && value > 0 && formValues?.cost_price && value < formValues.cost_price) {
                      return "Website price should not be less than cost price";
                    }
                    return true;
                  }
                }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Website Price"
                    type="number"
                    fullWidth
                    inputProps={{ min: 0, step: 0.01 }}
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message || "Selling price on website (optional)"}
                  />
                )}
              />
            </Grid>
            <Grid item xs={12}>
              <Controller
                name="description"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Description"
                    fullWidth
                    multiline
                    rows={3}
                    helperText="Optional detailed description of the product"
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="active"
                control={control}
                render={({ field }) => (
                  <FormControlLabel
                    control={<Checkbox {...field} checked={field.value} />}
                    label="Active"
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="website_active"
                control={control}
                render={({ field }) => (
                  <FormControlLabel
                    control={<Checkbox {...field} checked={field.value} />}
                    label="Show on Website"
                  />
                )}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} color="inherit">
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={isSubmitting || createMutation.isPending || updateMutation.isPending}
          >
            {isSubmitting || createMutation.isPending || updateMutation.isPending
              ? (isEdit ? "Updating..." : "Creating...")
              : (isEdit ? "Update Product" : "Create Product")
            }
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
