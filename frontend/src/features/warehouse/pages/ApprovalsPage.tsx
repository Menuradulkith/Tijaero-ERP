import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
  Chip,
} from "@mui/material";
import { Add as AddIcon } from "@mui/icons-material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { useForm, Controller } from "react-hook-form";
import { toast } from "react-hot-toast";
import { transferNoteApprovalsApi } from "@/modules/warehouse/api";
import { ItemTransferNoteApprovedCreate } from "@/modules/warehouse/types";

export default function ApprovalsPage() {
  const [openDialog, setOpenDialog] = useState(false);
  const [approvals, setApprovals] = useState<any[]>([]);

  const { control, handleSubmit, reset } =
    useForm<ItemTransferNoteApprovedCreate>({
      defaultValues: {
        item_transfer_note_id: 0,
        approved_status: 0,
        approval_note: "",
        approved_user_id: undefined,
      },
    });

  const createMutation = useMutation({
    mutationFn: transferNoteApprovalsApi.create,
    onSuccess: (data) => {
      setApprovals([...approvals, data]);
      toast.success("Approval created successfully");
      setOpenDialog(false);
      reset();
    },
    onError: () => {
      toast.error("Failed to create approval");
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
      field: "approved_status",
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
    { field: "approval_note", headerName: "Note", width: 250 },
    { field: "approved_user_id", headerName: "Approved By", width: 120 },
    {
      field: "approved_date",
      headerName: "Approved Date",
      width: 180,
      valueFormatter: (value) =>
        value ? new Date(value).toLocaleString() : "-",
    },
  ];

  const onSubmit = (data: ItemTransferNoteApprovedCreate) => {
    createMutation.mutate(data);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 3 }}>
        <Typography variant="h4" fontWeight="bold">
          Transfer Note Approvals
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            reset({
              item_transfer_note_id: 0,
              approved_status: 0,
              approval_note: "",
            });
            setOpenDialog(true);
          }}
        >
          New Approval
        </Button>
      </Box>

      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={approvals}
          columns={columns}
          pageSizeOptions={[10, 25, 50, 100]}
          initialState={{
            pagination: { paginationModel: { pageSize: 25 } },
          }}
        />
      </Paper>

      <Dialog
        open={openDialog}
        onClose={() => setOpenDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogTitle>New Approval</DialogTitle>
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
                  name="approved_status"
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
                  name="approval_note"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Approval Note"
                      fullWidth
                      multiline
                      rows={3}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12}>
                <Controller
                  name="approved_user_id"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Approved By (User ID)"
                      type="number"
                      fullWidth
                    />
                  )}
                />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpenDialog(false)}>Cancel</Button>
            <Button
              type="submit"
              variant="contained"
              disabled={createMutation.isPending}
            >
              Create
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
}
