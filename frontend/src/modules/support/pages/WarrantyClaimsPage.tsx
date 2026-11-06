import { useState } from "react";
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
import { warrantyClaimsApi } from "@/modules/support/api";
import { usePermission } from "@/auth/permissions";
import { handleApiError } from "@/utils/errorHandling";
import { WarrantyClaimCreate } from "@/modules/support/types";

const TYPE_OPTIONS = [
  { value: "repair", label: "Repair" },
  { value: "replace", label: "Replace" },
  { value: "refund", label: "Refund" },
];

const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "sent_to_supplier", label: "Sent to supplier" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const NO_ORDER = "" as unknown as number;

export default function WarrantyClaimsPage() {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const { dialogProps, confirm } = useTConfirmDialog();

  const canCreate = usePermission("warranty_claims", "create");
  const canUpdate = usePermission("warranty_claims", "update");
  const canDelete = usePermission("warranty_claims", "delete");

  const { data: claims, isLoading } = useQuery({
    queryKey: ["warranty-claims"],
    queryFn: () => warrantyClaimsApi.getAll({ limit: 1000 }),
  });

  const { control, handleSubmit, reset } = useForm<WarrantyClaimCreate>({
    defaultValues: {
      warranty_type: "",
      warranty_status: "open",
      product_barcode_old_code: "",
      product_barcode_new_code: "",
      comment: "",
      order_id: NO_ORDER,
      supplier_warrenty_claims: false,
    },
  });

  const createMutation = useMutation({
    mutationFn: warrantyClaimsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warranty-claims"] });
      showSuccessToast("Warranty claim created successfully");
      setOpenDialog(false);
      reset();
    },
    onError: (error) => {
      showErrorToast(handleApiError(error, "Failed to create warranty claim"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: WarrantyClaimCreate }) =>
      warrantyClaimsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warranty-claims"] });
      showSuccessToast("Warranty claim updated successfully");
      setOpenDialog(false);
      setEditingId(null);
      reset();
    },
    onError: (error) => {
      showErrorToast(handleApiError(error, "Failed to update warranty claim"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: warrantyClaimsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warranty-claims"] });
      showSuccessToast("Warranty claim deleted successfully");
    },
    onError: (error) => {
      showErrorToast(handleApiError(error, "Failed to delete warranty claim"));
    },
  });

  const handleDelete = async (id: number) => {
    const confirmed = await confirm({
      title: "Delete Claim",
      message: "Are you sure you want to delete this claim?",
      confirmText: "Delete",
      danger: true,
    });
    if (confirmed) {
      deleteMutation.mutate(id);
    }
  };

  const columns: GridColDef[] = [
    { field: "id", headerName: "ID", width: 70 },
    { field: "warranty_type", headerName: "Type", width: 120 },
    { field: "warranty_status", headerName: "Status", width: 120 },
    {
      field: "product_barcode_old_code",
      headerName: "Old Barcode",
      width: 150,
    },
    {
      field: "product_barcode_new_code",
      headerName: "New Barcode",
      width: 150,
    },
    { field: "order_id", headerName: "Order ID", width: 100 },
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

  const onSubmit = (data: WarrantyClaimCreate) => {
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
      warranty_type: "",
      warranty_status: "open",
      product_barcode_old_code: "",
      product_barcode_new_code: "",
      comment: "",
      order_id: NO_ORDER,
      supplier_warrenty_claims: false,
    });
    setOpenDialog(true);
  };

  return (
    <Box>
      <TPageHeader
        title="Warranty Claims"
        actions={
          <Box sx={{ display: "flex", gap: 1 }}>
            <TExportButton
              filename="warranty_claims"
              headers={[
                "ID",
                "Type",
                "Status",
                "Old Barcode",
                "New Barcode",
                "Order ID",
              ]}
              rows={() =>
                (claims || []).map((c: any) => [
                  c.id ?? "",
                  c.warranty_type || "",
                  c.warranty_status || "",
                  c.product_barcode_old_code || "",
                  c.product_barcode_new_code || "",
                  c.order_id ?? "",
                ])
              }
              disabled={(claims || []).length === 0}
            />
            {canCreate && <TButton startIcon={<AddIcon />} onClick={handleAdd}>
              New Claim
            </TButton>}
          </Box>
        }
      />

      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={claims || []}
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
        title={editingId ? "Edit Warranty Claim" : "New Warranty Claim"}
        onSubmit={handleSubmit(onSubmit)}
        submitText={editingId ? "Update" : "Create"}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        maxWidth="sm"
        noValidate
      >
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 2 }}>
          <TFormField
            name="warranty_type"
            control={control}
            label="Warranty Type"
            fieldType="select"
            options={TYPE_OPTIONS}
            required
            rules={{ required: "Warranty type is required" }}
          />
          <TFormField
            name="warranty_status"
            control={control}
            label="Status"
            fieldType="select"
            options={STATUS_OPTIONS}
            required
            rules={{ required: "Status is required" }}
          />
          <Box sx={{ gridColumn: "span 2" }}>
            <TFormField
              name="product_barcode_old_code"
              control={control}
              label="Old Product Barcode"
              required
              rules={{ required: "Old barcode is required" }}
            />
          </Box>
          <Box sx={{ gridColumn: "span 2" }}>
            <TFormField
              name="product_barcode_new_code"
              control={control}
              label="New Product Barcode (Optional)"
            />
          </Box>
          <Box sx={{ gridColumn: "span 2" }}>
            <TFormField
              name="order_id"
              control={control}
              label="Sales Order ID"
              fieldType="number"
              required
              helperText="The order the claimed unit was sold on; the old barcode must be on it"
              rules={{ required: "Order ID is required", min: { value: 1, message: "Must be at least 1" } }}
            />
          </Box>
          <Box sx={{ gridColumn: "span 2" }}>
            <TFormField
              name="comment"
              control={control}
              label="Comment"
              fieldType="textarea"
              rows={3}
            />
          </Box>
          <Box sx={{ gridColumn: "span 2" }}>
            <TFormField
              name="supplier_warrenty_claims"
              control={control}
              label="Supplier Warranty Claim"
              fieldType="checkbox"
            />
          </Box>
        </Box>
      </TFormDialog>

      <TConfirmDialog {...dialogProps} />
    </Box>
  );
}
