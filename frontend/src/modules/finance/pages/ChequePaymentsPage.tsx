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
} from "@mui/material";
import { Add as AddIcon } from "@mui/icons-material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { useForm, Controller } from "react-hook-form";
import { chequePaymentsApi } from "@/modules/finance/api";
import { ChequePaymentCreate } from "@/modules/finance/types";
import { TBranchFilter, TFilterPanel, handleApiError, showErrorToast, showSuccessToast } from "@/components/tijaero";
import { useReferenceData } from "@/hooks";

export default function ChequePaymentsPage() {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  const { data: refData } = useReferenceData(["branches"]);
  const branches = refData?.branches || [];

  const { data: payments, isLoading } = useQuery({
    queryKey: ["cheque-payments", filterBranch],
    queryFn: () => chequePaymentsApi.getAll({
      branch_code: filterBranch ?? undefined,
    }),
  });

  const { control, handleSubmit, reset } = useForm<ChequePaymentCreate>({
    defaultValues: {
      cheque_number: 0,
      branch_code: 0,
      from_party: "",
      bank: "",
      amount: 0,
      cheque_date: new Date().toISOString().split("T")[0],
      deposit_date: new Date().toISOString().split("T")[0],
      remark: "",
      payment_for: "",
      invoice_no: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: chequePaymentsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cheque-payments"] });
      showSuccessToast("Cheque payment recorded successfully");
      setOpenDialog(false);
      reset();
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to record cheque payment"));
    },
  });

  const columns: GridColDef[] = [
    { field: "id", headerName: "ID", width: 70 },
    { field: "cheque_number", headerName: "Cheque No", width: 130 },
    { field: "from_party", headerName: "From", width: 150 },
    { field: "bank", headerName: "Bank", width: 150 },
    {
      field: "amount",
      headerName: "Amount (Rs.)",
      width: 130,
      valueFormatter: (value) => Number(value).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    },
    {
      field: "cheque_date",
      headerName: "Cheque Date",
      width: 130,
      valueFormatter: (value) => new Date(value).toLocaleDateString(),
    },
    {
      field: "deposit_date",
      headerName: "Deposit Date",
      width: 130,
      valueFormatter: (value) => new Date(value).toLocaleDateString(),
    },
    { field: "payment_for", headerName: "Payment For", width: 150 },
    { field: "invoice_no", headerName: "Invoice No", width: 130 },
  ];

  const onSubmit = (data: ChequePaymentCreate) => {
    createMutation.mutate(data);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 3 }}>
        <Typography variant="h4" fontWeight="bold">
          Cheque Payments
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setOpenDialog(true)}
        >
          Record Cheque
        </Button>
      </Box>

      <TFilterPanel>
        <TBranchFilter
          branches={branches}
          value={filterBranch}
          onChange={setFilterBranch}
        />
      </TFilterPanel>

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
        maxWidth="md"
        fullWidth
      >
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogTitle>Record Cheque Payment</DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="cheque_number"
                  control={control}
                  rules={{ required: "Cheque number is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Cheque Number"
                      type="number"
                      fullWidth
                      required
                      error={!!fieldState.error}
                      helperText={fieldState.error?.message}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="branch_code"
                  control={control}
                  rules={{ required: "Branch code is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Branch Code"
                      type="number"
                      fullWidth
                      required
                      error={!!fieldState.error}
                      helperText={fieldState.error?.message}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="from_party"
                  control={control}
                  rules={{ required: "From party is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="From Party"
                      fullWidth
                      required
                      error={!!fieldState.error}
                      helperText={fieldState.error?.message}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="bank"
                  control={control}
                  rules={{ required: "Bank is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Bank"
                      fullWidth
                      required
                      error={!!fieldState.error}
                      helperText={fieldState.error?.message}
                    />
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
                  name="cheque_date"
                  control={control}
                  rules={{ required: "Cheque date is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Cheque Date"
                      type="date"
                      fullWidth
                      required
                      error={!!fieldState.error}
                      helperText={fieldState.error?.message}
                      InputLabelProps={{ shrink: true }}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="deposit_date"
                  control={control}
                  rules={{ required: "Deposit date is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Deposit Date"
                      type="date"
                      fullWidth
                      required
                      error={!!fieldState.error}
                      helperText={fieldState.error?.message}
                      InputLabelProps={{ shrink: true }}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="payment_for"
                  control={control}
                  render={({ field }) => (
                    <TextField {...field} label="Payment For" fullWidth />
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
