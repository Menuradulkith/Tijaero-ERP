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
  handleApiError,
  showErrorToast,
  showSuccessToast,
  TButton,
  TConfirmDialog,
  TFormDialog,
  TFormField,
  TIconButton,
  TPageHeader,
  TStatusChip,
  useTConfirmDialog,
} from "@/components/tijaero";
import { formatDateTime } from "@/utils/formatters";
import { employeeAssetsApi } from "@/modules/hr/api";
import { EmployeeAssetCreate } from "@/modules/hr/types";

export default function EmployeeAssetsPage() {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const { dialogProps, confirm } = useTConfirmDialog();

  const { data: assets, isLoading } = useQuery({
    queryKey: ["employee-assets"],
    queryFn: () => employeeAssetsApi.getAll(),
  });

  const { control, handleSubmit, reset } = useForm<EmployeeAssetCreate>({
    defaultValues: {
      employee_id: "",
      asset_id: 0,
      assign_reason: "",
      revoke_assignment: false,
    },
  });

  const createMutation = useMutation({
    mutationFn: employeeAssetsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-assets"] });
      showSuccessToast("Asset assignment created successfully");
      handleClose();
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to create asset assignment"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: EmployeeAssetCreate }) =>
      employeeAssetsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-assets"] });
      showSuccessToast("Asset assignment updated successfully");
      handleClose();
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to update asset assignment"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: employeeAssetsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-assets"] });
      showSuccessToast("Asset assignment deleted successfully");
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to delete asset assignment"));
    },
  });

  const handleDelete = async (id: number) => {
    const confirmed = await confirm({
      title: "Delete Assignment",
      message: "Are you sure you want to delete this assignment?",
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
    { field: "asset_id", headerName: "Asset ID", width: 110 },
    { field: "assign_reason", headerName: "Reason", width: 250 },
    {
      field: "revoke_assignment",
      headerName: "Status",
      width: 120,
      renderCell: (params) => (
        <TStatusChip
          status={params.value ? "revoked" : "active"}
          customMap={{
            active: { label: "Active", color: "success" },
            revoked: { label: "Revoked", color: "error" },
          }}
          size="small"
        />
      ),
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

  const onSubmit = (data: EmployeeAssetCreate) => {
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
    reset({
      employee_id: "",
      asset_id: 0,
      assign_reason: "",
      revoke_assignment: false,
    });
    setOpenDialog(true);
  };

  return (
    <Box>
      <TPageHeader
        title="Employee Asset Assignments"
        actions={
          <TButton startIcon={<AddIcon />} onClick={handleAdd}>
            New Assignment
          </TButton>
        }
      />

      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={assets || []}
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
        title={editingId ? "Edit Asset Assignment" : "New Asset Assignment"}
        onSubmit={handleSubmit(onSubmit)}
        submitText={editingId ? "Update" : "Create"}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        maxWidth="sm"
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
            name="asset_id"
            control={control}
            label="Asset ID"
            fieldType="number"
            required
            rules={{ required: "Asset ID is required", min: { value: 1, message: "Must be at least 1" } }}
          />
          <TFormField
            name="assign_reason"
            control={control}
            label="Assignment Reason"
            fieldType="textarea"
            rows={3}
          />
          <TFormField
            name="revoke_assignment"
            control={control}
            label="Revoke Assignment"
            fieldType="checkbox"
          />
        </Box>
      </TFormDialog>

      <TConfirmDialog {...dialogProps} />
    </Box>
  );
}
