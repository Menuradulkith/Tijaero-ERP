import { useForm, Controller } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Grid,
} from "@mui/material";
import { brandsApi } from "../api";
import { BrandCreate, Brand } from "../types";
import { showSuccessToast, showErrorToast } from "@/components/tijaero";

interface BrandDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function BrandDialog({ open, onClose }: BrandDialogProps) {
  const queryClient = useQueryClient();

  const { 
    control, 
    handleSubmit, 
    reset, 
    formState: { isSubmitting } 
  } = useForm<BrandCreate>({
    defaultValues: {
      brand_name: "",
      brand_code: "",
      description: "",
    },
  });

  // Style for required field labels (red asterisk)
  const requiredFieldSx = {
    '& .MuiInputLabel-asterisk': {
      color: 'error.main',
    },
  };

  const createMutation = useMutation({
    mutationFn: brandsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brands"] });
      showSuccessToast("Brand created successfully");
      reset();
      onClose();
    },
    onError: () => {
      showErrorToast("Failed to create brand");
    },
  });

  const onSubmit = (data: BrandCreate) => {
    createMutation.mutate(data);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogTitle>Add Brand</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <Controller
                name="brand_name"
                control={control}
                rules={{ 
                  required: "Brand name is required",
                  minLength: { value: 2, message: "Name must be at least 2 characters" },
                  maxLength: { value: 50, message: "Name cannot exceed 50 characters" }
                }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Brand Name"
                    fullWidth
                    required
                    sx={requiredFieldSx}
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message || "Enter the brand name"}
                  />
                )}
              />
            </Grid>
            <Grid item xs={12}>
              <Controller
                name="brand_code"
                control={control}
                rules={{
                  required: "Code is required",
                  maxLength: { value: 4, message: "Max 4 characters" },
                  validate: (value) => {
                    const brands = queryClient.getQueryData<Brand[]>(["brands"]) || [];
                    const exists = brands.some(b => b.brand_code.toLowerCase() === value.toLowerCase());
                    return !exists || "Brand code already exists";
                  },
                }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Brand Code"
                    fullWidth
                    required
                    inputProps={{ maxLength: 4 }}
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
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
                    rows={2}
                    helperText="Optional brand description"
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
            disabled={isSubmitting || createMutation.isPending}
          >
            {isSubmitting || createMutation.isPending ? "Creating..." : "Create Brand"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
