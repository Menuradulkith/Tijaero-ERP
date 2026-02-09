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
import { handleApiError, showErrorToast, showSuccessToast } from "@/components/tijaero";
import { ConfirmDialog, useConfirmDialog } from "@/components/ConfirmDialog";
import { salaryDeductionsApi } from "@/modules/hr/api";
import { SalaryDeductionCreate } from "@/modules/hr/types";

export default function DeductionsPage() {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const deleteDialog = useConfirmDialog();

  const { data: deductions, isLoading } = useQuery({
    queryKey: ["salary-deductions"],
    queryFn: () => salaryDeductionsApi.getAll(),
  });

  const { control, handleSubmit, reset } = useForm<SalaryDeductionCreate>({
    defaultValues: {
      employee_id: 0,
      reason: "",
      amount: 0,
      approval_id: undefined,
    },
  });

  const createMutation = useMutation({
    mutationFn: salaryDeductionsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salary-deductions"] });
      showSuccessToast("Salary deduction created successfully");
      setOpenDialog(false);
      reset();
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to create salary deduction"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: SalaryDeductionCreate }) =>
      salaryDeductionsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salary-deductions"] });
      showSuccessToast("Salary deduction updated successfully");
      setOpenDialog(false);
      setEditingId(null);
      reset();
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to update salary deduction"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: salaryDeductionsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salary-deductions"] });
      showSuccessToast("Salary deduction deleted successfully");
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to delete salary deduction"));
    },
  });

  const columns: GridColDef[] = [
    { field: "id", headerName: "ID", width: 70 },
    { field: "employee_id", headerName: "Employee ID", width: 130 },
    { field: "reason", headerName: "Reason", width: 300 },
    {
      field: "amount",
      headerName: "Amount (Rs.)",
      width: 130,
      valueFormatter: (value) => Number(value).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    },
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
              deleteDialog.open(
                "Delete Deduction",
                "Are you sure you want to delete this deduction?",
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

  const onSubmit = (data: SalaryDeductionCreate) => {
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
          Salary Deductions
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditingId(null);
            reset({
              employee_id: 0,
              reason: "",
              amount: 0,
            });
            setOpenDialog(true);
          }}
        >
          New Deduction
        </Button>
      </Box>

      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={deductions || []}
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
            {editingId ? "Edit Salary Deduction" : "New Salary Deduction"}
          </DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12}>
                <Controller
                  name="employee_id"
                  control={control}
                  rules={{ required: "Employee ID is required", min: 1 }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Employee ID"
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
                  name="reason"
                  control={control}
                  rules={{ required: "Reason is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Reason"
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
                  name="amount"
                  control={control}
                  rules={{ required: "Amount is required", min: 0.01 }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Deduction Amount"
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
              <Grid item xs={12}>
                <Controller
                  name="approval_id"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Approval ID (Optional)"
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
