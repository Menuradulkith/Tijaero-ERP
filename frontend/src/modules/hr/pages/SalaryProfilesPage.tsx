import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { salaryProfilesApi } from "@/modules/hr/api";
import { EmployeeSalaryProfileCreate } from "@/modules/hr/types";

export default function SalaryProfilesPage() {
  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [profiles, setProfiles] = useState<any[]>([]);
  const deleteDialog = useConfirmDialog();

  const { control, handleSubmit, reset } = useForm<EmployeeSalaryProfileCreate>(
    {
      defaultValues: {
        employee_id: "",
        basic_salary: 0,
        add_1_name: "",
        add_1_value: 0,
        add_2_name: "",
        add_2_value: 0,
      },
    }
  );

  const createMutation = useMutation({
    mutationFn: salaryProfilesApi.create,
    onSuccess: (data) => {
      setProfiles([...profiles, data]);
      toast.success("Salary profile created successfully");
      setOpenDialog(false);
      reset();
    },
    onError: () => {
      toast.error("Failed to create salary profile");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number;
      data: EmployeeSalaryProfileCreate;
    }) => salaryProfilesApi.update(id, data),
    onSuccess: (data) => {
      setProfiles(profiles.map((p) => (p.id === data.id ? data : p)));
      toast.success("Salary profile updated successfully");
      setOpenDialog(false);
      setEditingId(null);
      reset();
    },
    onError: () => {
      toast.error("Failed to update salary profile");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: salaryProfilesApi.delete,
    onSuccess: (_, id) => {
      setProfiles(profiles.filter((p) => p.id !== id));
      toast.success("Salary profile deleted successfully");
    },
    onError: () => {
      toast.error("Failed to delete salary profile");
    },
  });

  const columns: GridColDef[] = [
    { field: "id", headerName: "ID", width: 70 },
    { field: "employee_id", headerName: "Employee ID", width: 130 },
    {
      field: "basic_salary",
      headerName: "Basic Salary (Rs.)",
      width: 140,
      valueFormatter: (value) => Number(value).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    },
    { field: "add_1_name", headerName: "Addition 1", width: 130 },
    {
      field: "add_1_value",
      headerName: "Add 1 Value (Rs.)",
      width: 130,
      valueFormatter: (value) => (value ? Number(value).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-"),
    },
    { field: "add_2_name", headerName: "Addition 2", width: 130 },
    {
      field: "add_2_value",
      headerName: "Add 2 Value (Rs.)",
      width: 130,
      valueFormatter: (value) => (value ? Number(value).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-"),
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
                "Delete Profile",
                "Are you sure you want to delete this profile?",
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

  const onSubmit = (data: EmployeeSalaryProfileCreate) => {
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
          Employee Salary Profiles
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
          New Profile
        </Button>
      </Box>

      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={profiles}
          columns={columns}
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
            {editingId ? "Edit Salary Profile" : "New Salary Profile"}
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
              <Grid item xs={12}>
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
                  name="add_2_name"
                  control={control}
                  render={({ field }) => (
                    <TextField {...field} label="Addition 2 Name" fullWidth />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="add_2_value"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Addition 2 Value"
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
