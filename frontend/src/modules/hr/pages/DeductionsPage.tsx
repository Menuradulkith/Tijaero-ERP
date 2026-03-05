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
import { salaryDeductionsApi } from "@/modules/hr/api";
import { SalaryDeductionCreate } from "@/modules/hr/types";

export default function DeductionsPage() {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const { dialogProps, confirm } = useTConfirmDialog();

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
      handleClose();
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
      handleClose();
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

  const handleDelete = async (id: number) => {
    const confirmed = await confirm({
      title: "Delete Deduction",
      message: "Are you sure you want to delete this deduction?",
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
    { field: "reason", headerName: "Reason", width: 300 },
    {
      field: "amount",
      headerName: "Amount (Rs.)",
      width: 130,
      valueFormatter: (value) => fmtLKR(Number(value)),
    },
    { field: "approval_id", headerName: "Approval ID", width: 110 },
    {
      field: "created_date",
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

  const onSubmit = (data: SalaryDeductionCreate) => {
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
    reset({ employee_id: 0, reason: "", amount: 0 });
    setOpenDialog(true);
  };

  return (
    <Box>
      <TPageHeader
        title="Salary Deductions"
        actions={
          <TButton startIcon={<AddIcon />} onClick={handleAdd}>
            New Deduction
          </TButton>
        }
      />

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

      <TFormDialog
        open={openDialog}
        onClose={handleClose}
        title={editingId ? "Edit Salary Deduction" : "New Salary Deduction"}
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
            fieldType="number"
            required
            rules={{ required: "Employee ID is required", min: { value: 1, message: "Must be at least 1" } }}
          />
          <TFormField
            name="reason"
            control={control}
            label="Reason"
            fieldType="textarea"
            rows={3}
            required
            rules={{ required: "Reason is required" }}
          />
          <TFormField
            name="amount"
            control={control}
            label="Deduction Amount"
            fieldType="number"
            required
            step={0.01}
            rules={{ required: "Amount is required", min: { value: 0.01, message: "Must be greater than 0" } }}
          />
          <TFormField
            name="approval_id"
            control={control}
            label="Approval ID (Optional)"
            fieldType="number"
          />
        </Box>
      </TFormDialog>

      <TConfirmDialog {...dialogProps} />
    </Box>
  );
}
