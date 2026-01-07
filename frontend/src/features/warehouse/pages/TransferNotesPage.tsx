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
import { transferNotesApi } from "@/modules/warehouse/api";
import { ItemTransferNoteCreate } from "@/modules/warehouse/types";

export default function TransferNotesPage() {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const { dialogProps, confirm } = useTConfirmDialog();

  const { data: transferNotes, isLoading } = useQuery({
    queryKey: ["transfer-notes"],
    queryFn: () => transferNotesApi.getAll(),
  });

  const { control, handleSubmit, reset } = useForm<ItemTransferNoteCreate>({
    defaultValues: {
      item_transfer_note: "",
      remark: "",
      created_date: new Date().toISOString().split("T")[0],
      from_location_id: 0,
      to_location_id: 0,
      branch_code: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: transferNotesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transfer-notes"] });
      showSuccessToast("Transfer note created successfully");
      setOpenDialog(false);
      reset();
    },
    onError: () => {
      showErrorToast("Failed to create transfer note");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: ItemTransferNoteCreate }) =>
      transferNotesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transfer-notes"] });
      showSuccessToast("Transfer note updated successfully");
      setOpenDialog(false);
      setEditingId(null);
      reset();
    },
    onError: () => {
      showErrorToast("Failed to update transfer note");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: transferNotesApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transfer-notes"] });
      showSuccessToast("Transfer note deleted successfully");
    },
    onError: () => {
      showErrorToast("Failed to delete transfer note");
    },
  });

  const handleDelete = async (id: number) => {
    const confirmed = await confirm({
      title: "Delete Transfer Note",
      message: "Are you sure you want to delete this transfer note?",
      confirmText: "Delete",
      danger: true,
    });
    if (confirmed) {
      deleteMutation.mutate(id);
    }
  };

  const columns: GridColDef[] = [
    { field: "id", headerName: "ID", width: 70 },
    { field: "item_transfer_note", headerName: "Transfer Note #", width: 150 },
    { field: "branch_code", headerName: "Branch", width: 120 },
    { field: "from_location_id", headerName: "From Location", width: 130 },
    { field: "to_location_id", headerName: "To Location", width: 130 },
    {
      field: "created_date",
      headerName: "Date",
      width: 130,
      valueFormatter: (value) => new Date(value).toLocaleDateString(),
    },
    { field: "remark", headerName: "Remark", width: 200 },
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

  const onSubmit = (data: ItemTransferNoteCreate) => {
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
      item_transfer_note: "",
      remark: "",
      created_date: new Date().toISOString().split("T")[0],
      from_location_id: 0,
      to_location_id: 0,
      branch_code: "",
    });
    setOpenDialog(true);
  };

  return (
    <Box>
      <TPageHeader
        title="Item Transfer Notes"
        actions={
          <TButton startIcon={<AddIcon />} onClick={handleAdd}>
            New Transfer Note
          </TButton>
        }
      />

      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={transferNotes || []}
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
        title={editingId ? "Edit Transfer Note" : "New Transfer Note"}
        onSubmit={handleSubmit(onSubmit)}
        submitText={editingId ? "Update" : "Create"}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        maxWidth="md"
      >
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 2 }}>
          <TFormField
            name="item_transfer_note"
            control={control}
            label="Transfer Note #"
            required
            rules={{ required: "Transfer note number is required" }}
          />
          <TFormField
            name="branch_code"
            control={control}
            label="Branch Code"
            required
            rules={{ required: "Branch code is required" }}
          />
          <TFormField
            name="from_location_id"
            control={control}
            label="From Location ID"
            fieldType="number"
            required
            rules={{ required: "From location is required", min: { value: 1, message: "Must be at least 1" } }}
          />
          <TFormField
            name="to_location_id"
            control={control}
            label="To Location ID"
            fieldType="number"
            required
            rules={{ required: "To location is required", min: { value: 1, message: "Must be at least 1" } }}
          />
          <Box sx={{ gridColumn: "span 2" }}>
            <TFormField
              name="created_date"
              control={control}
              label="Date"
              fieldType="date"
              required
              rules={{ required: "Date is required" }}
            />
          </Box>
          <Box sx={{ gridColumn: "span 2" }}>
            <TFormField
              name="remark"
              control={control}
              label="Remark"
              fieldType="textarea"
              rows={3}
            />
          </Box>
        </Box>
      </TFormDialog>

      <TConfirmDialog {...dialogProps} />
    </Box>
  );
}
