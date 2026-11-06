import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Box, Paper } from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
} from "@mui/icons-material";
import { useForm } from "react-hook-form";
import {
  TPageHeader,
  TButton,
  TExportButton,
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
import { useBranchFilter } from "@/hooks/useBranchFilter";
import { useReferenceData } from "@/hooks/useReferenceData";
import { usePermission } from "@/auth/permissions";
import { handleApiError } from "@/utils/errorHandling";

const NO_USER = "" as unknown as number;

export default function SupportTicketsPage() {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const { dialogProps, confirm } = useTConfirmDialog();
  const { getDefaultBranchCode } = useBranchFilter();
  const canCreate = usePermission("support_tickets", "create");
  const canUpdate = usePermission("support_tickets", "update");
  const canDelete = usePermission("support_tickets", "delete");

  const { data: tickets, isLoading } = useQuery({
    queryKey: ["support-tickets"],
    queryFn: () => supportTicketsApi.getAll({ limit: 1000 }),
  });

  const { data: refData, filteredBranches } = useReferenceData(["branches", "customers", "employees"]);
  const branchOptions = filteredBranches.map((b) => ({
    value: b.branch_code,
    label: `${b.branch_code} - ${b.branch_name}`,
  }));
  const userOptions = useMemo(
    () =>
      (refData?.employees || [])
        .filter((e) => e.user_id)
        .map((e) => ({ value: e.user_id as number, label: `${e.full_name} (${e.employee_id})` })),
    [refData?.employees]
  );
  const userName = useMemo(() => new Map(userOptions.map((o) => [o.value, o.label])), [userOptions]);
  const customerName = useMemo(
    () => new Map((refData?.customers || []).map((c) => [c.id, c.customer_name])),
    [refData?.customers]
  );
  const customerIds = useMemo(() => (refData?.customers || []).map((c) => c.id), [refData?.customers]);

  const { control, handleSubmit, reset } = useForm<CustomerSupportCreate>({
    defaultValues: {
      job_number: "",
      job_type: "",
      date: new Date().toISOString().split("T")[0],
      job_description: "",
      contact_person: "",
      branch_code: "",
      assigned_user_id: NO_USER,
      customer_id: null,
      invoice_id: null,
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
    onError: (error) => {
      showErrorToast(handleApiError(error, "Failed to create support ticket"));
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
    onError: (error) => {
      showErrorToast(handleApiError(error, "Failed to update support ticket"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: supportTicketsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      showSuccessToast("Support ticket deleted successfully");
    },
    onError: (error) => {
      showErrorToast(handleApiError(error, "Failed to delete support ticket"));
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
    {
      field: "assigned_user_id",
      headerName: "Assigned To",
      width: 160,
      valueFormatter: (value: number) => userName.get(value) || value,
    },
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
      display: "flex",
      renderCell: (params) => (
        <Box sx={{ display: "flex", gap: 0.5 }}>
          {canUpdate && <TIconButton
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
          </TIconButton>}
          {canDelete && <TIconButton
            size="small"
            color="danger"
            tooltip="Delete"
            onClick={() => handleDelete(params.row.id)}
          >
            <DeleteIcon />
          </TIconButton>}
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
      branch_code: getDefaultBranchCode || "",
      assigned_user_id: NO_USER,
      customer_id: null,
      invoice_id: null,
    });
    setOpenDialog(true);
  };

  return (
    <Box>
      <TPageHeader
        title="Support Tickets"
        actions={
          <Box sx={{ display: "flex", gap: 1 }}>
            <TExportButton
              filename="support_tickets"
              headers={[
                "ID",
                "Job #",
                "Type",
                "Contact",
                "Branch",
                "Assigned To",
                "Date",
                "Description",
              ]}
              rows={() =>
                (tickets || []).map((t: any) => [
                  t.id ?? "",
                  t.job_number || "",
                  t.job_type || "",
                  t.contact_person || "",
                  t.branch_code || "",
                  t.assigned_user_id ?? "",
                  t.date || "",
                  t.job_description || "",
                ])
              }
              disabled={(tickets || []).length === 0}
            />
            {canCreate && <TButton startIcon={<AddIcon />} onClick={handleAdd}>
              New Ticket
            </TButton>}
          </Box>
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
        noValidate
      >
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 2 }}>
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
            label="Branch"
            fieldType="select"
            options={branchOptions}
            required
            rules={{ required: "Branch is required" }}
          />
          {userOptions.length > 0 ? (
            <TFormField
              name="assigned_user_id"
              control={control}
              label="Assigned To"
              fieldType="select"
              options={userOptions}
              required
              rules={{ required: "Assigned user is required" }}
            />
          ) : (
            <TFormField
              name="assigned_user_id"
              control={control}
              label="Assigned User ID"
              fieldType="number"
              required
              rules={{ required: "Assigned user is required", min: { value: 1, message: "Must be at least 1" } }}
            />
          )}
          <TFormField
            name="date"
            control={control}
            label="Date"
            fieldType="date"
            required
            rules={{
              required: "Date is required",
              validate: (v) =>
                String(v) <= new Date().toISOString().split("T")[0] || "The ticket date cannot be in the future",
            }}
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
          {customerIds.length > 0 ? (
            <TFormField
              name="customer_id"
              control={control}
              label="Customer (Optional)"
              fieldType="autocomplete"
              autocompleteOptions={customerIds}
              getOptionLabel={(id) => customerName.get(id as number) || `Customer ${id}`}
            />
          ) : (
            <TFormField
              name="customer_id"
              control={control}
              label="Customer ID (Optional)"
              fieldType="number"
              rules={{ min: { value: 1, message: "Must be at least 1" } }}
            />
          )}
          <TFormField
            name="invoice_id"
            control={control}
            label="Invoice ID (Optional)"
            fieldType="number"
            rules={{ min: { value: 1, message: "Must be at least 1" } }}
          />
        </Box>
      </TFormDialog>

      <TConfirmDialog {...dialogProps} />
    </Box>
  );
}
