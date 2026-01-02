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
import { supportTicketsApi } from "@/modules/support/api";
import { CustomerSupportCreate } from "@/modules/support/types";

export default function SupportTicketsPage() {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const deleteDialog = useConfirmDialog();

  const { data: tickets, isLoading } = useQuery({
    queryKey: ["support-tickets"],
    queryFn: () => supportTicketsApi.getAll(),
  });

  const { control, handleSubmit, reset } = useForm<CustomerSupportCreate>({
    defaultValues: {
      job_number: "",
      job_type: "",
      date: new Date().toISOString().split("T")[0],
      job_description: "",
      contact_person: "",
      branch_code: "",
      assigned_user_id: 0,
      customer_id: undefined,
      invoice_id: undefined,
    },
  });

  const createMutation = useMutation({
    mutationFn: supportTicketsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      toast.success("Support ticket created successfully");
      setOpenDialog(false);
      reset();
    },
    onError: () => {
      toast.error("Failed to create support ticket");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: CustomerSupportCreate }) =>
      supportTicketsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      toast.success("Support ticket updated successfully");
      setOpenDialog(false);
      setEditingId(null);
      reset();
    },
    onError: () => {
      toast.error("Failed to update support ticket");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: supportTicketsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      toast.success("Support ticket deleted successfully");
    },
    onError: () => {
      toast.error("Failed to delete support ticket");
    },
  });

  const columns: GridColDef[] = [
    { field: "id", headerName: "ID", width: 70 },
    { field: "job_number", headerName: "Job #", width: 130 },
    { field: "job_type", headerName: "Type", width: 120 },
    { field: "contact_person", headerName: "Contact", width: 150 },
    { field: "branch_code", headerName: "Branch", width: 100 },
    { field: "assigned_user_id", headerName: "Assigned To", width: 120 },
    {
      field: "date",
      headerName: "Date",
      width: 130,
      valueFormatter: (value) => new Date(value).toLocaleDateString(),
    },
    { field: "job_description", headerName: "Description", width: 200 },
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
              deleteDialog.open(
                "Delete Ticket",
                "Are you sure you want to delete this ticket?",
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

  const onSubmit = (data: CustomerSupportCreate) => {
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
          Support Tickets
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditingId(null);
            reset({
              job_number: "",
              job_type: "",
              date: new Date().toISOString().split("T")[0],
              contact_person: "",
              branch_code: "",
              assigned_user_id: 0,
            });
            setOpenDialog(true);
          }}
        >
          New Ticket
        </Button>
      </Box>

      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={tickets || []}
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
            {editingId ? "Edit Support Ticket" : "New Support Ticket"}
          </DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="job_number"
                  control={control}
                  rules={{ required: "Job number is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Job Number"
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
                  name="job_type"
                  control={control}
                  rules={{ required: "Job type is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Job Type"
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
                  name="contact_person"
                  control={control}
                  rules={{ required: "Contact person is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Contact Person"
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
                  name="assigned_user_id"
                  control={control}
                  rules={{ required: "Assigned user is required", min: 1 }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Assigned User ID"
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
                  name="date"
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
                  name="job_description"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Job Description"
                      fullWidth
                      multiline
                      rows={3}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="customer_id"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Customer ID (Optional)"
                      type="number"
                      fullWidth
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="invoice_id"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Invoice ID (Optional)"
                      type="number"
                      fullWidth
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
