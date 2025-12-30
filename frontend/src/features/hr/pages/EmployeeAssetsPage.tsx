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
  FormControlLabel,
  Checkbox,
} from "@mui/material";
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
} from "@mui/icons-material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { useForm, Controller } from "react-hook-form";
import { toast } from "react-hot-toast";
import { employeeAssetsApi } from "@/modules/hr/api";
import { EmployeeAssetCreate } from "@/modules/hr/types";

export default function EmployeeAssetsPage() {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: assets, isLoading } = useQuery({
    queryKey: ["employee-assets"],
    queryFn: () => employeeAssetsApi.getAll(),
  });

  const { control, handleSubmit, reset } = useForm<EmployeeAssetCreate>({
    defaultValues: {
      employee_id: "",
      asset_id: 0,
      assign_reason: "",
      revoke_assignment: false,
    },
  });

  const createMutation = useMutation({
    mutationFn: employeeAssetsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-assets"] });
      toast.success("Asset assignment created successfully");
      setOpenDialog(false);
      reset();
    },
    onError: () => {
      toast.error("Failed to create asset assignment");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: EmployeeAssetCreate }) =>
      employeeAssetsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-assets"] });
      toast.success("Asset assignment updated successfully");
      setOpenDialog(false);
      setEditingId(null);
      reset();
    },
    onError: () => {
      toast.error("Failed to update asset assignment");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: employeeAssetsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-assets"] });
      toast.success("Asset assignment deleted successfully");
    },
    onError: () => {
      toast.error("Failed to delete asset assignment");
    },
  });

  const columns: GridColDef[] = [
    { field: "id", headerName: "ID", width: 70 },
    { field: "employee_id", headerName: "Employee ID", width: 130 },
    { field: "asset_id", headerName: "Asset ID", width: 110 },
    { field: "assign_reason", headerName: "Reason", width: 250 },
    {
      field: "revoke_assignment",
      headerName: "Status",
      width: 120,
      renderCell: (params) => (
        <Chip
          label={params.value ? "Revoked" : "Active"}
          color={params.value ? "error" : "success"}
          size="small"
        />
      ),
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 120,
      sortable: false,
      renderCell: (params) => (
        <Box>
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
          <IconButton
            size="small"
            color="error"
            onClick={() => {
              if (confirm("Are you sure you want to delete this assignment?")) {
                deleteMutation.mutate(params.row.id);
              }
            }}
          >
            <DeleteIcon />
          </IconButton>
        </Box>
      ),
    },
  ];

  const onSubmit = (data: EmployeeAssetCreate) => {
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
          Employee Asset Assignments
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditingId(null);
            reset({
              employee_id: "",
              asset_id: 0,
              assign_reason: "",
              revoke_assignment: false,
            });
            setOpenDialog(true);
          }}
        >
          New Assignment
        </Button>
      </Box>

      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={assets || []}
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
            {editingId ? "Edit Asset Assignment" : "New Asset Assignment"}
          </DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12}>
                <Controller
                  name="employee_id"
                  control={control}
                  rules={{ required: "Employee ID is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Employee ID"
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
                  name="asset_id"
                  control={control}
                  rules={{ required: "Asset ID is required", min: 1 }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Asset ID"
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
                  name="assign_reason"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Assignment Reason"
                      fullWidth
                      multiline
                      rows={3}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12}>
                <Controller
                  name="revoke_assignment"
                  control={control}
                  render={({ field }) => (
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={field.value}
                          onChange={field.onChange}
                        />
                      }
                      label="Revoke Assignment"
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
