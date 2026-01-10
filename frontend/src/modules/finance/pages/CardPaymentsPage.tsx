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
  MenuItem,
  Chip,
} from "@mui/material";
import { Add as AddIcon } from "@mui/icons-material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { useForm, Controller } from "react-hook-form";
import { toast } from "react-hot-toast";
import { cardPaymentsApi } from "@/modules/finance/api";
import { CardPaymentCreate } from "@/modules/finance/types";

export default function CardPaymentsPage() {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);

  const { data: payments, isLoading } = useQuery({
    queryKey: ["card-payments"],
    queryFn: () => cardPaymentsApi.getAll(),
  });

  const { control, handleSubmit, reset } = useForm<CardPaymentCreate>({
    defaultValues: {
      card_type: "VISA",
      amount: 0,
      remark: "",
      ref_number: "",
      invoice_no: "",
      deposited: true,
    },
  });

  const createMutation = useMutation({
    mutationFn: cardPaymentsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["card-payments"] });
      toast.success("Card payment recorded successfully");
      setOpenDialog(false);
      reset();
    },
    onError: () => {
      toast.error("Failed to record card payment");
    },
  });

  const columns: GridColDef[] = [
    { field: "id", headerName: "ID", width: 70 },
    {
      field: "card_type",
      headerName: "Card Type",
      width: 120,
      renderCell: (params) => (
        <Chip
          label={params.value}
          color={
            params.value === "VISA"
              ? "primary"
              : params.value === "MASTERCARD"
              ? "secondary"
              : "default"
          }
          size="small"
        />
      ),
    },
    {
      field: "amount",
      headerName: "Amount",
      width: 130,
      valueFormatter: (value) => `Rs. ${Number(value).toFixed(2)}`,
    },
    { field: "ref_number", headerName: "Reference", width: 150 },
    { field: "invoice_no", headerName: "Invoice No", width: 130 },
    {
      field: "deposited",
      headerName: "Deposited",
      width: 120,
      renderCell: (params) => (
        <Chip
          label={params.value ? "Yes" : "No"}
          color={params.value ? "success" : "warning"}
          size="small"
        />
      ),
    },
    {
      field: "date_time",
      headerName: "Date & Time",
      width: 180,
      valueFormatter: (value) => new Date(value).toLocaleString(),
    },
    { field: "remark", headerName: "Remark", width: 200 },
  ];

  const onSubmit = (data: CardPaymentCreate) => {
    createMutation.mutate(data);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 3 }}>
        <Typography variant="h4" fontWeight="bold">
          Card Payments
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setOpenDialog(true)}
        >
          Record Payment
        </Button>
      </Box>

      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={payments || []}
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
        onClose={() => setOpenDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogTitle>Record Card Payment</DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="card_type"
                  control={control}
                  rules={{ required: "Card type is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Card Type"
                      select
                      fullWidth
                      required
                      error={!!fieldState.error}
                      helperText={fieldState.error?.message}
                    >
                      <MenuItem value="VISA">Visa</MenuItem>
                      <MenuItem value="MASTERCARD">Mastercard</MenuItem>
                      <MenuItem value="AMEX">American Express</MenuItem>
                      <MenuItem value="OTHER">Other</MenuItem>
                    </TextField>
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="amount"
                  control={control}
                  rules={{ required: "Amount is required", min: 0.01 }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Amount"
                      type="number"
                      fullWidth
                      required
                      error={!!fieldState.error}
                      helperText={fieldState.error?.message}
                      inputProps={{ step: "0.01" }}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="ref_number"
                  control={control}
                  render={({ field }) => (
                    <TextField {...field} label="Reference Number" fullWidth />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="invoice_no"
                  control={control}
                  render={({ field }) => (
                    <TextField {...field} label="Invoice Number" fullWidth />
                  )}
                />
              </Grid>
              <Grid item xs={12}>
                <Controller
                  name="deposited"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Deposited"
                      select
                      fullWidth
                      value={field.value ? "true" : "false"}
                      onChange={(e) =>
                        field.onChange(e.target.value === "true")
                      }
                    >
                      <MenuItem value="true">Yes</MenuItem>
                      <MenuItem value="false">No</MenuItem>
                    </TextField>
                  )}
                />
              </Grid>
              <Grid item xs={12}>
                <Controller
                  name="remark"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Remark"
                      fullWidth
                      multiline
                      rows={3}
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
              Record
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
}
