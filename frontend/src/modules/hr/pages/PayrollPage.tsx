import {
  showErrorToast,
  showSuccessToast,
  TButton,
  TConfirmDialog,
  TCurrency,
  TFormDialog,
  TFormField,
  TIconButton,
  TPageHeader,
  TPrintButton,
  TPrintPreviewDialog,
  useTConfirmDialog
} from "@/components/tijaero";
import { formatDateTime } from "@/utils/formatters";
import { payrollApi } from "@/modules/hr/api";
import { EmployeePayrollCreate } from "@/modules/hr/types";
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
} from "@mui/icons-material";
import { Box, Paper } from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";

export default function PayrollPage() {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const { dialogProps, confirm } = useTConfirmDialog();

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
      showSuccessToast("Payroll record created successfully");
      setOpenDialog(false);
      reset();
    },
    onError: () => {
      showErrorToast("Failed to create payroll record");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: EmployeePayrollCreate }) =>
      payrollApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
      showSuccessToast("Payroll record updated successfully");
      setOpenDialog(false);
      setEditingId(null);
      reset();
    },
    onError: () => {
      showErrorToast("Failed to update payroll record");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: payrollApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
      showSuccessToast("Payroll record deleted successfully");
    },
    onError: () => {
      showErrorToast("Failed to delete payroll record");
    },
  });

  const handleDelete = async (id: number) => {
    const confirmed = await confirm({
      title: "Delete Record",
      message: "Are you sure you want to delete this record?",
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
      headerName: "Basic Salary",
      width: 130,
      renderCell: (params) => <TCurrency value={params.value} />,
    },
    {
      field: "add_sales_commision",
      headerName: "Commission",
      width: 120,
      renderCell: (params) => params.value ? <TCurrency value={params.value} /> : "-",
    },
    {
      field: "less_epf_employee",
      headerName: "EPF (Employee)",
      width: 130,
      renderCell: (params) => params.value ? <TCurrency value={params.value} /> : "-",
    },
    {
      field: "epf_employer",
      headerName: "EPF (Employer)",
      width: 130,
      renderCell: (params) => params.value ? <TCurrency value={params.value} /> : "-",
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

  const onSubmit = (data: EmployeePayrollCreate) => {
    if (editingId) {
      updateMutation.mutate({ id: editingId, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleClose = () => {
    setOpenDialog(false);
    setEditingId(null);
  };

  const handleAdd = () => {
    setEditingId(null);
    reset({
      employee_id: "",
      basic_salary: 0,
    });
    setOpenDialog(true);
  };

  return (
    <Box>
      <TPageHeader
        title="Employee Payroll"
        actions={
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <TPrintButton
              documentType="payroll"
              documentId={0}
              tooltip="Print Payroll Report"
              onClick={() => setPrintDialogOpen(true)}
            />
            <TButton startIcon={<AddIcon />} onClick={handleAdd}>
              New Payroll
            </TButton>
          </Box>
        }
      />

      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={payrolls || []}
          columns={columns}
          loading={isLoading}
          pageSizeOptions={[10, 25, 50, 100]}
          initialState={{
            pagination: { paginationModel: { pageSize: 10 } },
          }}
        />
      </Paper>

      <TFormDialog
        open={openDialog}
        onClose={handleClose}
        title={editingId ? "Edit Payroll Record" : "New Payroll Record"}
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
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 2 }}>
            <TFormField
              name="basic_salary"
              control={control}
              label="Basic Salary"
              fieldType="number"
              required
              rules={{ required: "Basic salary is required", min: { value: 0, message: "Must be at least 0" } }}
            />
            <TFormField
              name="add_sales_commision"
              control={control}
              label="Sales Commission"
              fieldType="number"
            />
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
            />
            <TFormField
              name="less_epf_employee"
              control={control}
              label="EPF (Employee)"
              fieldType="number"
            />
            <TFormField
              name="epf_employer"
              control={control}
              label="EPF (Employer)"
              fieldType="number"
            />
            <TFormField
              name="less_etf_employee"
              control={control}
              label="ETF (Employee)"
              fieldType="number"
            />
            <TFormField
              name="less_stamp_duty"
              control={control}
              label="Stamp Duty"
              fieldType="number"
            />
          </Box>
        </Box>
      </TFormDialog>

      <TConfirmDialog {...dialogProps} />

      <TPrintPreviewDialog
        open={printDialogOpen}
        onClose={() => setPrintDialogOpen(false)}
        documentType="payroll"
        documentId={0}
        title="Payroll Report"
      />
    </Box>
  );
}
