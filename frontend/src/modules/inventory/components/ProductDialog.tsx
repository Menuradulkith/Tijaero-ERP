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

  const { control, handleSubmit, reset } = useForm<ProductCreate>({
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
                rules={{ required: "Name is required" }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Product Name"
                    fullWidth
                    required
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="item_code"
                control={control}
                rules={{ required: "Item code is required" }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Item Code"
                    fullWidth
                    required
                    disabled={isEdit}
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="model"
                control={control}
                render={({ field }) => (
                  <TextField {...field} label="Model" fullWidth />
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
                        error={!!fieldState.error}
                        helperText={fieldState.error?.message}
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
                        error={!!fieldState.error}
                        helperText={fieldState.error?.message}
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
                rules={{ required: "Cost price is required", min: 0 }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Cost Price"
                    type="number"
                    fullWidth
                    required
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="website_price"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Website Price"
                    type="number"
                    fullWidth
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
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            disabled={createMutation.isPending || updateMutation.isPending}
          >
            {isEdit ? "Update" : "Create"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
