import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Button,
  Paper,
  Typography,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  IconButton,
  Chip,
} from "@mui/material";
import {
  Add as AddIcon,
  Edit as EditIcon,
  Visibility as ViewIcon,
} from "@mui/icons-material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { useForm, Controller } from "react-hook-form";
import { toast } from "react-hot-toast";
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
      toast.success("Receive note created successfully");
      setOpenDialog(false);
      reset();
    },
    onError: () => {
      toast.error("Failed to create receive note");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: ItemReceiveNoteCreate }) =>
      receiveNotesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receive-notes"] });
      toast.success("Receive note updated successfully");
      setOpenDialog(false);
      setEditingId(null);
      reset();
    },
    onError: () => {
      toast.error("Failed to update receive note");
    },
  });

  const getStatusLabel = (status: number) => {
    switch (status) {
      case 0:
        return "Pending";
      case 1:
        return "Approved";
      case 2:
        return "Rejected";
      default:
        return "Unknown";
    }
  };

  const getStatusColor = (
    status: number
  ): "warning" | "success" | "error" | "default" => {
    switch (status) {
      case 0:
        return "warning";
      case 1:
        return "success";
      case 2:
        return "error";
      default:
        return "default";
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
      renderCell: (params) => (
        <Chip
          label={getStatusLabel(params.value)}
          color={getStatusColor(params.value)}
          size="small"
        />
      ),
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
        <Box>
          <IconButton size="small" color="primary">
            <ViewIcon />
          </IconButton>
          <IconButton
            size="small"
            color="primary"
            onClick={() => {
              setEditingId(params.row.id);
              reset(params.row);
              setOpenDialog(true);
            }}
          >
            <EditIcon />
          </IconButton>
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

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 3 }}>
        <Typography variant="h4" fontWeight="bold">
          Item Receive Notes
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditingId(null);
            reset({
              item_transfer_note_id: 0,
              received_approval_status: 0,
              received_note: "",
            });
            setOpenDialog(true);
          }}
        >
          New Receive Note
        </Button>
      </Box>

      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={receiveNotes || []}
          columns={columns}
          loading={isLoading}
          pageSizeOptions={[10, 25, 50, 100]}
          initialState={{
            pagination: { paginationModel: { pageSize: 25 } },
          }}
        />
      </Paper>

      <Dialog
        open={openDialog}
        onClose={() => {
          setOpenDialog(false);
          setEditingId(null);
        }}
        maxWidth="sm"
        fullWidth
      >
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogTitle>
            {editingId ? "Edit Receive Note" : "New Receive Note"}
          </DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12}>
                <Controller
                  name="item_transfer_note_id"
                  control={control}
                  rules={{ required: "Transfer note ID is required", min: 1 }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Transfer Note ID"
                      type="number"
                      fullWidth
                      required
                      error={!!fieldState.error}
                      helperText={fieldState.error?.message}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12}>
                <Controller
                  name="received_approval_status"
                  control={control}
                  rules={{ required: "Status is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Approval Status"
                      type="number"
                      fullWidth
                      required
                      error={!!fieldState.error}
                      helperText={
                        fieldState.error?.message ||
                        "0=Pending, 1=Approved, 2=Rejected"
                      }
                      inputProps={{ min: 0, max: 2 }}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12}>
                <Controller
                  name="received_note"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Receive Note"
                      fullWidth
                      multiline
                      rows={3}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12}>
                <Controller
                  name="recieved_user"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Received By (User ID)"
                      type="number"
                      fullWidth
                    />
                  )}
                />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                setOpenDialog(false);
                setEditingId(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editingId ? "Update" : "Create"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
}
