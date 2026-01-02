import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Button,
  Paper,
  Typography,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  IconButton,
  FormControlLabel,
  Checkbox,
} from "@mui/material";
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
} from "@mui/icons-material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { useForm, Controller } from "react-hook-form";
import { toast } from "react-hot-toast";
import { ConfirmDialog, useConfirmDialog } from "@/components/ConfirmDialog";
import { warrantyClaimsApi } from "@/modules/support/api";
import { WarrantyClaimCreate } from "@/modules/support/types";

export default function WarrantyClaimsPage() {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const deleteDialog = useConfirmDialog();

  const { data: claims, isLoading } = useQuery({
    queryKey: ["warranty-claims"],
    queryFn: () => warrantyClaimsApi.getAll(),
  });

  const { control, handleSubmit, reset } = useForm<WarrantyClaimCreate>({
    defaultValues: {
      warranty_type: "",
      warranty_status: "",
      product_barcode_old_code: "",
      product_barcode_new_code: "",
      comment: "",
      order_id: 0,
      supplier_warrenty_claims: false,
    },
  });

  const createMutation = useMutation({
    mutationFn: warrantyClaimsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warranty-claims"] });
      toast.success("Warranty claim created successfully");
      setOpenDialog(false);
      reset();
    },
    onError: () => {
      toast.error("Failed to create warranty claim");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: WarrantyClaimCreate }) =>
      warrantyClaimsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warranty-claims"] });
      toast.success("Warranty claim updated successfully");
      setOpenDialog(false);
      setEditingId(null);
      reset();
    },
    onError: () => {
      toast.error("Failed to update warranty claim");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: warrantyClaimsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warranty-claims"] });
      toast.success("Warranty claim deleted successfully");
    },
    onError: () => {
      toast.error("Failed to delete warranty claim");
    },
  });

  const columns: GridColDef[] = [
    { field: "id", headerName: "ID", width: 70 },
    { field: "warranty_type", headerName: "Type", width: 120 },
    { field: "warranty_status", headerName: "Status", width: 120 },
    {
      field: "product_barcode_old_code",
      headerName: "Old Barcode",
      width: 150,
    },
    {
      field: "product_barcode_new_code",
      headerName: "New Barcode",
      width: 150,
    },
    { field: "order_id", headerName: "Order ID", width: 100 },
    {
      field: "created_date",
      headerName: "Created",
      width: 180,
      valueFormatter: (value) => new Date(value).toLocaleString(),
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 120,
      sortable: false,
      renderCell: (params) => (
        <Box>
          <IconButton
            size="small"
            color="primary"
            onClick={() => {
              setEditingId(params.row.id);
              reset(params.row);
              setOpenDialog(true);
            }}
          >
            <EditIcon />
          </IconButton>
          <IconButton
            size="small"
            color="error"
            onClick={() => {
              deleteDialog.open(
                "Delete Claim",
                "Are you sure you want to delete this claim?",
                () => deleteMutation.mutate(params.row.id)
              );
            }}
          >
            <DeleteIcon />
          </IconButton>
        </Box>
      ),
    },
  ];

  const onSubmit = (data: WarrantyClaimCreate) => {
    if (editingId) {
      updateMutation.mutate({ id: editingId, data });
    } else {
      createMutation.mutate(data);
    }
  };

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 3 }}>
        <Typography variant="h4" fontWeight="bold">
          Warranty Claims
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditingId(null);
            reset({
              warranty_type: "",
              warranty_status: "",
              product_barcode_old_code: "",
              order_id: 0,
              supplier_warrenty_claims: false,
            });
            setOpenDialog(true);
          }}
        >
          New Claim
        </Button>
      </Box>

      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={claims || []}
          columns={columns}
          loading={isLoading}
          pageSizeOptions={[10, 25, 50, 100]}
          initialState={{
            pagination: { paginationModel: { pageSize: 25 } },
          }}
        />
      </Paper>

      <Dialog
        open={openDialog}
        onClose={() => {
          setOpenDialog(false);
          setEditingId(null);
        }}
        maxWidth="sm"
        fullWidth
      >
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogTitle>
            {editingId ? "Edit Warranty Claim" : "New Warranty Claim"}
          </DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="warranty_type"
                  control={control}
                  rules={{ required: "Warranty type is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Warranty Type"
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
                  name="warranty_status"
                  control={control}
                  rules={{ required: "Status is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Status"
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
                  name="product_barcode_old_code"
                  control={control}
                  rules={{ required: "Old barcode is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Old Product Barcode"
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
                  name="product_barcode_new_code"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="New Product Barcode (Optional)"
                      fullWidth
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12}>
                <Controller
                  name="order_id"
                  control={control}
                  rules={{ required: "Order ID is required", min: 1 }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Order ID"
                      type="number"
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
                  name="comment"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Comment"
                      fullWidth
                      multiline
                      rows={3}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12}>
                <Controller
                  name="supplier_warrenty_claims"
                  control={control}
                  render={({ field }) => (
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={field.value}
                          onChange={field.onChange}
                        />
                      }
                      label="Supplier Warranty Claim"
                    />
                  )}
                />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                setOpenDialog(false);
                setEditingId(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editingId ? "Update" : "Create"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
      <ConfirmDialog {...deleteDialog.dialogProps} />
    </Box>
  );
}
