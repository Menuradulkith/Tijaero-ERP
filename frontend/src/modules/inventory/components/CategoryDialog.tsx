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
  FormControlLabel,
  Checkbox,
} from "@mui/material";
import { categoriesApi } from "../api";
import { CategoryCreate } from "../types";
import { showSuccessToast, showErrorToast } from "@/components/tijaero";

interface CategoryDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function CategoryDialog({ open, onClose }: CategoryDialogProps) {
  const queryClient = useQueryClient();

  const { 
    control, 
    handleSubmit, 
    reset, 
    formState: { isSubmitting } 
  } = useForm<CategoryCreate>({
    defaultValues: {
      name: "",
      category_code: "",
      memo: "",
      description: "",
      active: true,
    },
  });

  // Style for required field labels (red asterisk)
  const requiredFieldSx = {
    '& .MuiInputLabel-asterisk': {
      color: 'error.main',
    },
  };

  const createMutation = useMutation({
    mutationFn: categoriesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      showSuccessToast("Category created successfully");
      reset();
      onClose();
    },
    onError: () => {
      showErrorToast("Failed to create category");
    },
  });

  const onSubmit = (data: CategoryCreate) => {
    createMutation.mutate(data);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogTitle>Add Category</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <Controller
                name="name"
                control={control}
                rules={{ 
                  required: "Category name is required",
                  minLength: { value: 2, message: "Name must be at least 2 characters" },
                  maxLength: { value: 50, message: "Name cannot exceed 50 characters" }
                }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Category Name"
                    fullWidth
                    required
                    sx={requiredFieldSx}
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message || "Enter a descriptive category name"}
                  />
                )}
              />
            </Grid>
            <Grid item xs={12}>
              <Controller
                name="category_code"
                control={control}
                rules={{ 
                  required: "Category code is required",
                  pattern: {
                    value: /^[A-Z0-9-_]+$/,
                    message: "Use only uppercase letters, numbers, hyphens and underscores"
                  },
                  maxLength: { value: 10, message: "Code cannot exceed 10 characters" }
                }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Category Code"
                    fullWidth
                    required
                    sx={requiredFieldSx}
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message || "Unique identifier for the category"}
                  />
                )}
              />
            </Grid>
            <Grid item xs={12}>
              <Controller
                name="memo"
                control={control}
                render={({ field }) => (
                  <TextField 
                    {...field} 
                    label="Memo" 
                    fullWidth 
                    helperText="Short memo or note (optional)"
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
                    helperText="Optional detailed description of the category"
                  />
                )}
              />
            </Grid>
            <Grid item xs={12}>
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
            {isSubmitting || createMutation.isPending ? "Creating..." : "Create Category"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
