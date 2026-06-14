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
import { WarrantyClaimCreate } from "@/modules/support/types";

export default function WarrantyClaimsPage() {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const { dialogProps, confirm } = useTConfirmDialog();

  const { data: claims, isLoading } = useQuery({
    queryKey: ["warranty-claims"],
    queryFn: () => warrantyClaimsApi.getAll(),
  });

  const { control, handleSubmit, reset } = useForm<WarrantyClaimCreate>({
    defaultValues: {
      warranty_type: "",
      warranty_status: "",
      product_barcode_old_code: "",
      product_barcode_new_code: "",
      comment: "",
      order_id: 0,
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
    onError: () => {
      showErrorToast("Failed to create warranty claim");
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
    onError: () => {
      showErrorToast("Failed to update warranty claim");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: warrantyClaimsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warranty-claims"] });
      showSuccessToast("Warranty claim deleted successfully");
    },
    onError: () => {
      showErrorToast("Failed to delete warranty claim");
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
      warranty_status: "",
      product_barcode_old_code: "",
      order_id: 0,
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
            <TButton startIcon={<AddIcon />} onClick={handleAdd}>
              New Claim
            </TButton>
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
      >
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 2 }}>
          <TFormField
            name="warranty_type"
            control={control}
            label="Warranty Type"
            required
            rules={{ required: "Warranty type is required" }}
          />
          <TFormField
            name="warranty_status"
            control={control}
            label="Status"
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
              label="Order ID"
              fieldType="number"
              required
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
