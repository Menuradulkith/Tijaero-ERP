import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Box, Paper } from "@mui/material";
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
} from "@mui/icons-material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { useForm } from "react-hook-form";
import {
  fmtLKR,
  handleApiError,
  showErrorToast,
  showSuccessToast,
  TButton,
  TConfirmDialog,
  TFormDialog,
  TFormField,
  TIconButton,
  TPageHeader,
  useTConfirmDialog,
} from "@/components/tijaero";
import { formatDateTime } from "@/utils/formatters";
import { salaryProfilesApi } from "@/modules/hr/api";
import { EmployeeSalaryProfileCreate } from "@/modules/hr/types";

export default function SalaryProfilesPage() {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const { dialogProps, confirm } = useTConfirmDialog();

  const { data: profiles, isLoading } = useQuery({
    queryKey: ["salary-profiles"],
    queryFn: () => salaryProfilesApi.getAll(),
  });

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salary-profiles"] });
      showSuccessToast("Salary profile created successfully");
      handleClose();
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to create salary profile"));
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salary-profiles"] });
      showSuccessToast("Salary profile updated successfully");
      handleClose();
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to update salary profile"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: salaryProfilesApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salary-profiles"] });
      showSuccessToast("Salary profile deleted successfully");
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to delete salary profile"));
    },
  });

  const handleDelete = async (id: number) => {
    const confirmed = await confirm({
      title: "Delete Profile",
      message: "Are you sure you want to delete this profile?",
      confirmText: "Delete",
      danger: true,
    });
    if (confirmed) {
      deleteMutation.mutate(id);
    }
  };

  const columns: GridColDef[] = [
    { field: "id", headerName: "ID", width: 70 },
    { field: "employee_id", headerName: "Employee ID", width: 130 },
    {
      field: "basic_salary",
      headerName: "Basic Salary (Rs.)",
      width: 140,
      valueFormatter: (value) => fmtLKR(Number(value)),
    },
    { field: "add_1_name", headerName: "Addition 1", width: 130 },
    {
      field: "add_1_value",
      headerName: "Add 1 Value (Rs.)",
      width: 130,
      valueFormatter: (value) => (value ? fmtLKR(Number(value)) : "-"),
    },
    { field: "add_2_name", headerName: "Addition 2", width: 130 },
    {
      field: "add_2_value",
      headerName: "Add 2 Value (Rs.)",
      width: 130,
      valueFormatter: (value) => (value ? fmtLKR(Number(value)) : "-"),
    },
    {
      field: "created_at",
      headerName: "Created",
      width: 160,
      valueFormatter: (value) => formatDateTime(value) || "-",
    },
    {
      field: "updated_at",
      headerName: "Modified",
      width: 160,
      valueFormatter: (value) => formatDateTime(value) || "-",
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 120,
      sortable: false,
      renderCell: (params) => (
        <Box sx={{ display: "flex", gap: 0.5 }}>
          <TIconButton
            size="small"
            color="primary"
            tooltip="Edit"
            onClick={() => {
              setEditingId(params.row.id);
              reset(params.row);
              setOpenDialog(true);
            }}
          >
            <EditIcon />
          </TIconButton>
          <TIconButton
            size="small"
            color="danger"
            tooltip="Delete"
            onClick={() => handleDelete(params.row.id)}
          >
            <DeleteIcon />
          </TIconButton>
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

  const handleClose = () => {
    setOpenDialog(false);
    setEditingId(null);
    reset();
  };

  const handleAdd = () => {
    setEditingId(null);
    reset({ employee_id: "", basic_salary: 0 });
    setOpenDialog(true);
  };

  return (
    <Box>
      <TPageHeader
        title="Employee Salary Profiles"
        actions={
          <TButton startIcon={<AddIcon />} onClick={handleAdd}>
            New Profile
          </TButton>
        }
      />

      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={profiles || []}
          columns={columns}
          loading={isLoading}
          pageSizeOptions={[10, 25, 50, 100]}
          initialState={{
            pagination: { paginationModel: { pageSize: 25 } },
          }}
        />
      </Paper>

      <TFormDialog
        open={openDialog}
        onClose={handleClose}
        title={editingId ? "Edit Salary Profile" : "New Salary Profile"}
        onSubmit={handleSubmit(onSubmit)}
        submitText={editingId ? "Update" : "Create"}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        maxWidth="md"
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <TFormField
            name="employee_id"
            control={control}
            label="Employee ID"
            required
            rules={{ required: "Employee ID is required" }}
          />
          <TFormField
            name="basic_salary"
            control={control}
            label="Basic Salary"
            fieldType="number"
            required
            step={0.01}
            rules={{ required: "Basic salary is required", min: { value: 0, message: "Must be at least 0" } }}
          />
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 2 }}>
            <TFormField
              name="add_1_name"
              control={control}
              label="Addition 1 Name"
            />
            <TFormField
              name="add_1_value"
              control={control}
              label="Addition 1 Value"
              fieldType="number"
              step={0.01}
            />
            <TFormField
              name="add_2_name"
              control={control}
              label="Addition 2 Name"
            />
            <TFormField
              name="add_2_value"
              control={control}
              label="Addition 2 Value"
              fieldType="number"
              step={0.01}
            />
          </Box>
        </Box>
      </TFormDialog>

      <TConfirmDialog {...dialogProps} />
    </Box>
  );
}
