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
import { BrandCreate } from "../types";
import { showSuccessToast, showErrorToast } from "@/components/tijaero";

interface BrandDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function BrandDialog({ open, onClose }: BrandDialogProps) {
  const queryClient = useQueryClient();

  const { control, handleSubmit, reset } = useForm<BrandCreate>({
    defaultValues: {
      brand_name: "",
      brand_code: "",
      description: "",
    },
  });

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
                rules={{ required: "Name is required" }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Brand Name"
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
                name="brand_code"
                control={control}
                rules={{
                  required: "Code is required",
                  maxLength: { value: 4, message: "Max 4 characters" },
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
                    rows={3}
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
