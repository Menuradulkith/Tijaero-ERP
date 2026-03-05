import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Box, Paper } from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Visibility as ViewIcon,
} from "@mui/icons-material";
import { useForm } from "react-hook-form";
import {
  TPageHeader,
  TButton,
  TIconButton,
  TFormDialog,
  TFormField,
  TConfirmDialog,
  useTConfirmDialog,
  showSuccessToast,
  showErrorToast,
} from "@/components/tijaero";
import { formatDateTime } from "@/utils/formatters";
import { supportTicketsApi } from "@/modules/support/api";
import { CustomerSupportCreate } from "@/modules/support/types";

export default function SupportTicketsPage() {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const { dialogProps, confirm } = useTConfirmDialog();

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
      showSuccessToast("Support ticket created successfully");
      setOpenDialog(false);
      reset();
    },
    onError: () => {
      showErrorToast("Failed to create support ticket");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: CustomerSupportCreate }) =>
      supportTicketsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      showSuccessToast("Support ticket updated successfully");
      setOpenDialog(false);
      setEditingId(null);
      reset();
    },
    onError: () => {
      showErrorToast("Failed to update support ticket");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: supportTicketsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      showSuccessToast("Support ticket deleted successfully");
    },
    onError: () => {
      showErrorToast("Failed to delete support ticket");
    },
  });

  const handleDelete = async (id: number) => {
    const confirmed = await confirm({
      title: "Delete Ticket",
      message: "Are you sure you want to delete this ticket?",
      confirmText: "Delete",
      danger: true,
    });
    if (confirmed) {
      deleteMutation.mutate(id);
    }
  };

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
      width: 150,
      sortable: false,
      renderCell: (params) => (
        <Box sx={{ display: "flex", gap: 0.5 }}>
          <TIconButton size="small" color="primary" tooltip="View">
            <ViewIcon />
          </TIconButton>
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

  const onSubmit = (data: CustomerSupportCreate) => {
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
      job_number: "",
      job_type: "",
      date: new Date().toISOString().split("T")[0],
      contact_person: "",
      branch_code: "",
      assigned_user_id: 0,
    });
    setOpenDialog(true);
  };

  return (
    <Box>
      <TPageHeader
        title="Support Tickets"
        actions={
          <TButton startIcon={<AddIcon />} onClick={handleAdd}>
            New Ticket
          </TButton>
        }
      />

      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={tickets || []}
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
        title={editingId ? "Edit Support Ticket" : "New Support Ticket"}
        onSubmit={handleSubmit(onSubmit)}
        submitText={editingId ? "Update" : "Create"}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        maxWidth="md"
      >
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 2 }}>
          <TFormField
            name="job_number"
            control={control}
            label="Job Number"
            required
            rules={{ required: "Job number is required" }}
          />
          <TFormField
            name="job_type"
            control={control}
            label="Job Type"
            required
            rules={{ required: "Job type is required" }}
          />
          <TFormField
            name="contact_person"
            control={control}
            label="Contact Person"
            required
            rules={{ required: "Contact person is required" }}
          />
          <TFormField
            name="branch_code"
            control={control}
            label="Branch Code"
            required
            rules={{ required: "Branch code is required" }}
          />
          <TFormField
            name="assigned_user_id"
            control={control}
            label="Assigned User ID"
            fieldType="number"
            required
            rules={{ required: "Assigned user is required", min: { value: 1, message: "Must be at least 1" } }}
          />
          <TFormField
            name="date"
            control={control}
            label="Date"
            fieldType="date"
            required
            rules={{ required: "Date is required" }}
          />
          <Box sx={{ gridColumn: "span 2" }}>
            <TFormField
              name="job_description"
              control={control}
              label="Job Description"
              fieldType="textarea"
              rows={3}
            />
          </Box>
          <TFormField
            name="customer_id"
            control={control}
            label="Customer ID (Optional)"
            fieldType="number"
          />
          <TFormField
            name="invoice_id"
            control={control}
            label="Invoice ID (Optional)"
            fieldType="number"
          />
        </Box>
      </TFormDialog>

      <TConfirmDialog {...dialogProps} />
    </Box>
  );
}
