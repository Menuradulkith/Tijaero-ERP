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

  const { control, handleSubmit, reset } = useForm<CategoryCreate>({
    defaultValues: {
      name: "",
      category_code: "",
      memo: "",
      description: "",
      active: true,
    },
  });

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
                rules={{ required: "Name is required" }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Category Name"
                    fullWidth
                    required
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                  />
                )}
              />
            </Grid>
            <Grid item xs={12}>
              <Controller
                name="category_code"
                control={control}
                rules={{ required: "Code is required" }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Category Code"
                    fullWidth
                    required
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                  />
                )}
              />
            </Grid>
            <Grid item xs={12}>
              <Controller
                name="memo"
                control={control}
                render={({ field }) => (
                  <TextField {...field} label="Memo" fullWidth />
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
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            disabled={createMutation.isPending}
          >
            Create
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
