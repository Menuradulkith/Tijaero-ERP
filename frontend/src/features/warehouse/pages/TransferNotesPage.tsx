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
} from "@mui/material";
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Visibility as ViewIcon,
} from "@mui/icons-material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { useForm, Controller } from "react-hook-form";
import { toast } from "react-hot-toast";
import { ConfirmDialog, useConfirmDialog } from "@/components/ConfirmDialog";
import { transferNotesApi } from "@/modules/warehouse/api";
import { ItemTransferNoteCreate } from "@/modules/warehouse/types";

export default function TransferNotesPage() {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const deleteDialog = useConfirmDialog();
  const [_pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  const { data: transferNotes, isLoading } = useQuery({
    queryKey: ["transfer-notes"],
    queryFn: () => transferNotesApi.getAll(),
  });

  const { control, handleSubmit, reset } = useForm<ItemTransferNoteCreate>({
    defaultValues: {
      item_transfer_note: "",
      remark: "",
      created_date: new Date().toISOString().split("T")[0],
      from_location_id: 0,
      to_location_id: 0,
      branch_code: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: transferNotesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transfer-notes"] });
      toast.success("Transfer note created successfully");
      setOpenDialog(false);
      reset();
    },
    onError: () => {
      toast.error("Failed to create transfer note");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: ItemTransferNoteCreate }) =>
      transferNotesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transfer-notes"] });
      toast.success("Transfer note updated successfully");
      setOpenDialog(false);
      setEditingId(null);
      reset();
    },
    onError: () => {
      toast.error("Failed to update transfer note");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: transferNotesApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transfer-notes"] });
      toast.success("Transfer note deleted successfully");
    },
    onError: () => {
      toast.error("Failed to delete transfer note");
    },
  });

  const columns: GridColDef[] = [
    { field: "id", headerName: "ID", width: 70 },
    { field: "item_transfer_note", headerName: "Transfer Note #", width: 150 },
    { field: "branch_code", headerName: "Branch", width: 120 },
    { field: "from_location_id", headerName: "From Location", width: 130 },
    { field: "to_location_id", headerName: "To Location", width: 130 },
    {
      field: "created_date",
      headerName: "Date",
      width: 130,
      valueFormatter: (value) => new Date(value).toLocaleDateString(),
    },
    { field: "remark", headerName: "Remark", width: 200 },
    {
      field: "actions",
      headerName: "Actions",
      width: 150,
      sortable: false,
      renderCell: (params) => (
        <Box>
          <IconButton size="small" color="primary">
            <ViewIcon />
          </IconButton>
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
              setPendingDeleteId(params.row.id);
              deleteDialog.open(
                "Delete Transfer Note",
                "Are you sure you want to delete this transfer note?",
                () => {
                  deleteMutation.mutate(params.row.id);
                  setPendingDeleteId(null);
                }
              );
            }}
          >
            <DeleteIcon />
          </IconButton>
        </Box>
      ),
    },
  ];

  const onSubmit = (data: ItemTransferNoteCreate) => {
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
          Item Transfer Notes
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditingId(null);
            reset({
              item_transfer_note: "",
              remark: "",
              created_date: new Date().toISOString().split("T")[0],
              from_location_id: 0,
              to_location_id: 0,
              branch_code: "",
            });
            setOpenDialog(true);
          }}
        >
          New Transfer Note
        </Button>
      </Box>

      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={transferNotes || []}
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
        maxWidth="md"
        fullWidth
      >
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogTitle>
            {editingId ? "Edit Transfer Note" : "New Transfer Note"}
          </DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="item_transfer_note"
                  control={control}
                  rules={{ required: "Transfer note number is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Transfer Note #"
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
                  name="branch_code"
                  control={control}
                  rules={{ required: "Branch code is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Branch Code"
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
                  name="from_location_id"
                  control={control}
                  rules={{ required: "From location is required", min: 1 }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="From Location ID"
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
                  name="to_location_id"
                  control={control}
                  rules={{ required: "To location is required", min: 1 }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="To Location ID"
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
                  name="created_date"
                  control={control}
                  rules={{ required: "Date is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Date"
                      type="date"
                      fullWidth
                      required
                      error={!!fieldState.error}
                      helperText={fieldState.error?.message}
                      InputLabelProps={{ shrink: true }}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12}>
                <Controller
                  name="remark"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Remark"
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
