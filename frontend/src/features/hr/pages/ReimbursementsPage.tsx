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
} from "@mui/icons-material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { useForm, Controller } from "react-hook-form";
import { toast } from "react-hot-toast";
import { reimbursementsApi } from "@/modules/hr/api";
import { ReimbursementCreate } from "@/modules/hr/types";

export default function ReimbursementsPage() {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: reimbursements, isLoading } = useQuery({
    queryKey: ["reimbursements"],
    queryFn: () => reimbursementsApi.getAll(),
  });

  const { control, handleSubmit, reset } = useForm<ReimbursementCreate>({
    defaultValues: {
      employee_id: "",
      reimbursement_amount: 0,
      bill_date: new Date().toISOString().split("T")[0],
      remark: "",
      bill_image_path: "",
      approval_id: 1,
    },
  });

  const createMutation = useMutation({
    mutationFn: reimbursementsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reimbursements"] });
      toast.success("Reimbursement created successfully");
      setOpenDialog(false);
      reset();
    },
    onError: () => {
      toast.error("Failed to create reimbursement");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: ReimbursementCreate }) =>
      reimbursementsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reimbursements"] });
      toast.success("Reimbursement updated successfully");
      setOpenDialog(false);
      setEditingId(null);
      reset();
    },
    onError: () => {
      toast.error("Failed to update reimbursement");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: reimbursementsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reimbursements"] });
      toast.success("Reimbursement deleted successfully");
    },
    onError: () => {
      toast.error("Failed to delete reimbursement");
    },
  });

  const columns: GridColDef[] = [
    { field: "id", headerName: "ID", width: 70 },
    { field: "employee_id", headerName: "Employee ID", width: 130 },
    {
      field: "reimbursement_amount",
      headerName: "Amount",
      width: 130,
      valueFormatter: (value) => `$${Number(value).toFixed(2)}`,
    },
    {
      field: "bill_date",
      headerName: "Bill Date",
      width: 130,
      valueFormatter: (value) => new Date(value).toLocaleDateString(),
    },
    { field: "remark", headerName: "Remark", width: 250 },
    { field: "approval_id", headerName: "Approval ID", width: 110 },
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
              if (
                confirm("Are you sure you want to delete this reimbursement?")
              ) {
                deleteMutation.mutate(params.row.id);
              }
            }}
          >
            <DeleteIcon />
          </IconButton>
        </Box>
      ),
    },
  ];

  const onSubmit = (data: ReimbursementCreate) => {
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
          Employee Reimbursements
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditingId(null);
            reset({
              employee_id: "",
              reimbursement_amount: 0,
              bill_date: new Date().toISOString().split("T")[0],
              remark: "",
              approval_id: 1,
            });
            setOpenDialog(true);
          }}
        >
          New Reimbursement
        </Button>
      </Box>

      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={reimbursements || []}
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
            {editingId ? "Edit Reimbursement" : "New Reimbursement"}
          </DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12}>
                <Controller
                  name="employee_id"
                  control={control}
                  rules={{ required: "Employee ID is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Employee ID"
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
                  name="reimbursement_amount"
                  control={control}
                  rules={{ required: "Amount is required", min: 0.01 }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Amount"
                      type="number"
                      fullWidth
                      required
                      error={!!fieldState.error}
                      helperText={fieldState.error?.message}
                      inputProps={{ step: "0.01" }}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="bill_date"
                  control={control}
                  rules={{ required: "Bill date is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Bill Date"
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
                  rules={{ required: "Remark is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Remark"
                      fullWidth
                      required
                      multiline
                      rows={3}
                      error={!!fieldState.error}
                      helperText={fieldState.error?.message}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12}>
                <Controller
                  name="bill_image_path"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Bill Image Path (Optional)"
                      fullWidth
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12}>
                <Controller
                  name="approval_id"
                  control={control}
                  rules={{ required: "Approval ID is required", min: 1 }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Approval ID"
                      type="number"
                      fullWidth
                      required
                      error={!!fieldState.error}
                      helperText={fieldState.error?.message}
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
    </Box>
  );
}
