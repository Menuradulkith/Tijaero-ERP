import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Box, Paper, Chip } from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import {
  Add as AddIcon,
  Edit as EditIcon,
  Visibility as ViewIcon,
} from "@mui/icons-material";
import { useForm } from "react-hook-form";
import {
  TPageHeader,
  TButton,
  TIconButton,
  TFormDialog,
  TFormField,
  showSuccessToast,
  showErrorToast,
} from "@/components/tijaero";
import { receiveNotesApi } from "@/modules/warehouse/api";
import { ItemReceiveNoteCreate } from "@/modules/warehouse/types";

export default function ReceiveNotesPage() {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: receiveNotes, isLoading } = useQuery({
    queryKey: ["receive-notes"],
    queryFn: () => receiveNotesApi.getAll(),
  });

  const { control, handleSubmit, reset } = useForm<ItemReceiveNoteCreate>({
    defaultValues: {
      item_transfer_note_id: 0,
      received_approval_status: 0,
      received_note: "",
      recieved_user: undefined,
    },
  });

  const createMutation = useMutation({
    mutationFn: receiveNotesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receive-notes"] });
      showSuccessToast("Receive note created successfully");
      setOpenDialog(false);
      reset();
    },
    onError: () => {
      showErrorToast("Failed to create receive note");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: ItemReceiveNoteCreate }) =>
      receiveNotesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receive-notes"] });
      showSuccessToast("Receive note updated successfully");
      setOpenDialog(false);
      setEditingId(null);
      reset();
    },
    onError: () => {
      showErrorToast("Failed to update receive note");
    },
  });

  const getStatusConfig = (status: number): { label: string; status: "pending" | "success" | "error" | "default" } => {
    switch (status) {
      case 0:
        return { label: "Pending", status: "pending" };
      case 1:
        return { label: "Approved", status: "success" };
      case 2:
        return { label: "Rejected", status: "error" };
      default:
        return { label: "Unknown", status: "default" };
    }
  };

  const columns: GridColDef[] = [
    { field: "id", headerName: "ID", width: 70 },
    {
      field: "item_transfer_note_id",
      headerName: "Transfer Note ID",
      width: 150,
    },
    {
      field: "received_approval_status",
      headerName: "Status",
      width: 120,
      renderCell: (params) => {
        const config = getStatusConfig(params.value);
        return <Chip label={config.label} color={config.status === "success" ? "success" : config.status === "error" ? "error" : "default"} size="small" />;
      },
    },
    { field: "received_note", headerName: "Note", width: 250 },
    { field: "recieved_user", headerName: "Received By", width: 120 },
    {
      field: "recieved_date",
      headerName: "Received Date",
      width: 180,
      valueFormatter: (value) =>
        value ? new Date(value).toLocaleString() : "-",
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 120,
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
        </Box>
      ),
    },
  ];

  const onSubmit = (data: ItemReceiveNoteCreate) => {
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
      item_transfer_note_id: 0,
      received_approval_status: 0,
      received_note: "",
    });
    setOpenDialog(true);
  };

  return (
    <Box>
      <TPageHeader
        title="Item Receive Notes"
        actions={
          <TButton startIcon={<AddIcon />} onClick={handleAdd}>
            New Receive Note
          </TButton>
        }
      />

      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={receiveNotes || []}
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
        title={editingId ? "Edit Receive Note" : "New Receive Note"}
        onSubmit={handleSubmit(onSubmit)}
        submitText={editingId ? "Update" : "Create"}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        maxWidth="sm"
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <TFormField
            name="item_transfer_note_id"
            control={control}
            label="Transfer Note ID"
            fieldType="number"
            required
            rules={{ required: "Transfer note ID is required", min: { value: 1, message: "Must be at least 1" } }}
          />
          <TFormField
            name="received_approval_status"
            control={control}
            label="Approval Status"
            fieldType="number"
            required
            helperText="0=Pending, 1=Approved, 2=Rejected"
            rules={{ required: "Status is required" }}
          />
          <TFormField
            name="received_note"
            control={control}
            label="Receive Note"
            fieldType="textarea"
            rows={3}
          />
          <TFormField
            name="recieved_user"
            control={control}
            label="Received By (User ID)"
            fieldType="number"
          />
        </Box>
      </TFormDialog>
    </Box>
  );
}
