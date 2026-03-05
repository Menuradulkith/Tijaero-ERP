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
  useTConfirmDialog,
} from "@/components/tijaero";
import { formatDateTime } from "@/utils/formatters";
import { promotionsApi } from "@/modules/hr/api";
import { EmployeePromotionCreate } from "@/modules/hr/types";

export default function PromotionsPage() {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const { dialogProps, confirm } = useTConfirmDialog();

  const { data: promotions, isLoading } = useQuery({
    queryKey: ["promotions"],
    queryFn: () => promotionsApi.getAll(),
  });

  const { control, handleSubmit, reset } = useForm<EmployeePromotionCreate>({
    defaultValues: {
      employee_id: "",
      designation: "",
      appointed_date: new Date().toISOString().split("T")[0],
      remark: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: promotionsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["promotions"] });
      showSuccessToast("Promotion created successfully");
      handleClose();
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to create promotion"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: EmployeePromotionCreate }) =>
      promotionsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["promotions"] });
      showSuccessToast("Promotion updated successfully");
      handleClose();
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to update promotion"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: promotionsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["promotions"] });
      showSuccessToast("Promotion deleted successfully");
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to delete promotion"));
    },
  });

  const handleDelete = async (id: number) => {
    const confirmed = await confirm({
      title: "Delete Promotion",
      message: "Are you sure you want to delete this promotion?",
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
    { field: "designation", headerName: "Designation", width: 200 },
    {
      field: "appointed_date",
      headerName: "Appointed Date",
      width: 150,
      valueFormatter: (value) => new Date(value).toLocaleDateString(),
    },
    { field: "remark", headerName: "Remark", width: 250 },
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

  const onSubmit = (data: EmployeePromotionCreate) => {
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
      designation: "",
      appointed_date: new Date().toISOString().split("T")[0],
      remark: "",
    });
    setOpenDialog(true);
  };

  return (
    <Box>
      <TPageHeader
        title="Employee Promotions"
        actions={
          <TButton startIcon={<AddIcon />} onClick={handleAdd}>
            New Promotion
          </TButton>
        }
      />

      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={promotions || []}
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
        title={editingId ? "Edit Promotion" : "New Promotion"}
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
            name="designation"
            control={control}
            label="Designation"
            required
            rules={{ required: "Designation is required" }}
          />
          <TFormField
            name="appointed_date"
            control={control}
            label="Appointed Date"
            fieldType="date"
            required
            rules={{ required: "Appointed date is required" }}
          />
          <TFormField
            name="remark"
            control={control}
            label="Remark"
            fieldType="textarea"
            rows={3}
          />
        </Box>
      </TFormDialog>

      <TConfirmDialog {...dialogProps} />
    </Box>
  );
}
