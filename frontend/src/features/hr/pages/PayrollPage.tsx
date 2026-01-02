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
import { ConfirmDialog, useConfirmDialog } from "@/components/ConfirmDialog";
import { payrollApi } from "@/modules/hr/api";
import { EmployeePayrollCreate } from "@/modules/hr/types";

export default function PayrollPage() {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const deleteDialog = useConfirmDialog();

  const { data: payrolls, isLoading } = useQuery({
    queryKey: ["payroll"],
    queryFn: () => payrollApi.getAll(),
  });

  const { control, handleSubmit, reset } = useForm<EmployeePayrollCreate>({
    defaultValues: {
      employee_id: "",
      basic_salary: 0,
      add_1_name: "",
      add_1_value: 0,
      add_2_name: "",
      add_2_value: 0,
      add_sales_commision: 0,
      less_epf_employee: 0,
      less_etf_employee: 0,
      less_stamp_duty: 0,
      epf_employer: 0,
      etf_employer: 0,
    },
  });

  const createMutation = useMutation({
    mutationFn: payrollApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
      toast.success("Payroll record created successfully");
      setOpenDialog(false);
      reset();
    },
    onError: () => {
      toast.error("Failed to create payroll record");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: EmployeePayrollCreate }) =>
      payrollApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
      toast.success("Payroll record updated successfully");
      setOpenDialog(false);
      setEditingId(null);
      reset();
    },
    onError: () => {
      toast.error("Failed to update payroll record");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: payrollApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
      toast.success("Payroll record deleted successfully");
    },
    onError: () => {
      toast.error("Failed to delete payroll record");
    },
  });

  const columns: GridColDef[] = [
    { field: "id", headerName: "ID", width: 70 },
    { field: "employee_id", headerName: "Employee ID", width: 130 },
    {
      field: "basic_salary",
      headerName: "Basic Salary",
      width: 130,
      valueFormatter: (value) => `$${Number(value).toFixed(2)}`,
    },
    {
      field: "add_sales_commision",
      headerName: "Commission",
      width: 120,
      valueFormatter: (value) => (value ? `$${Number(value).toFixed(2)}` : "-"),
    },
    {
      field: "less_epf_employee",
      headerName: "EPF (Employee)",
      width: 130,
      valueFormatter: (value) => (value ? `$${Number(value).toFixed(2)}` : "-"),
    },
    {
      field: "epf_employer",
      headerName: "EPF (Employer)",
      width: 130,
      valueFormatter: (value) => (value ? `$${Number(value).toFixed(2)}` : "-"),
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
                "Delete Record",
                "Are you sure you want to delete this record?",
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

  const onSubmit = (data: EmployeePayrollCreate) => {
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
          Employee Payroll
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditingId(null);
            reset({
              employee_id: "",
              basic_salary: 0,
            });
            setOpenDialog(true);
          }}
        >
          New Payroll
        </Button>
      </Box>

      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={payrolls || []}
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
            {editingId ? "Edit Payroll Record" : "New Payroll Record"}
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
                  name="basic_salary"
                  control={control}
                  rules={{ required: "Basic salary is required", min: 0 }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Basic Salary"
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
                  name="add_sales_commision"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Sales Commission"
                      type="number"
                      fullWidth
                      inputProps={{ step: "0.01" }}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="add_1_name"
                  control={control}
                  render={({ field }) => (
                    <TextField {...field} label="Addition 1 Name" fullWidth />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="add_1_value"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Addition 1 Value"
                      type="number"
                      fullWidth
                      inputProps={{ step: "0.01" }}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="less_epf_employee"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="EPF (Employee)"
                      type="number"
                      fullWidth
                      inputProps={{ step: "0.01" }}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="epf_employer"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="EPF (Employer)"
                      type="number"
                      fullWidth
                      inputProps={{ step: "0.01" }}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="less_etf_employee"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="ETF (Employee)"
                      type="number"
                      fullWidth
                      inputProps={{ step: "0.01" }}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="less_stamp_duty"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Stamp Duty"
                      type="number"
                      fullWidth
                      inputProps={{ step: "0.01" }}
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
