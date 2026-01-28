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
  Autocomplete,
} from "@mui/material";
import { Add as AddIcon } from "@mui/icons-material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { useForm, Controller } from "react-hook-form";
import { toast } from "react-hot-toast";
import { advancePaymentsApi } from "@/modules/finance/api";
import { customersApi } from "@/modules/customers/api";
import { CustomerAdvancePaymentCreate } from "@/modules/finance/types";
import { GENERIC_PAYMENT_METHOD, TBranchFilter, TFilterPanel } from "@/components/tijaero";
import { useReferenceData } from "@/hooks";

export default function AdvancePaymentsPage() {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<number | null>(null);
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  const { data: refData } = useReferenceData(["branches"]);
  const branches = refData?.branches || [];

  const { data: customers } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.getAll(),
  });

  const { data: advances, isLoading } = useQuery({
    queryKey: ["advance-payments", filterBranch, selectedCustomer],
    queryFn: () =>
      advancePaymentsApi.getAll({
        branch_code: filterBranch ?? undefined,
        customer_id: selectedCustomer ?? undefined,
      }),
  });

  const { control, handleSubmit, reset } =
    useForm<CustomerAdvancePaymentCreate>({
      defaultValues: {
        advance_payments_no: "",
        payment_method: "cash",
        branch_code: "",
        payment_amount: 0,
        remarks: "",
        customer_id: 0,
        cheque_date: new Date().toISOString().split("T")[0],
        active: true,
      },
    });

  const createMutation = useMutation({
    mutationFn: advancePaymentsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["advance-payments"] });
      toast.success("Advance payment recorded successfully");
      setOpenDialog(false);
      reset();
    },
    onError: () => {
      toast.error("Failed to record advance payment");
    },
  });

  const columns: GridColDef[] = [
    { field: "id", headerName: "ID", width: 70 },
    { field: "advance_payments_no", headerName: "Payment No", width: 150 },
    { field: "payment_method", headerName: "Method", width: 120 },
    {
      field: "payment_amount",
      headerName: "Amount (Rs.)",
      width: 130,
      valueFormatter: (value) => Number(value).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    },
    { field: "branch_code", headerName: "Branch", width: 120 },
    {
      field: "cheque_date",
      headerName: "Date",
      width: 130,
      valueFormatter: (value) => new Date(value).toLocaleDateString(),
    },
    {
      field: "active",
      headerName: "Status",
      width: 100,
      renderCell: (params) => (
        <Chip
          label={params.value ? "Active" : "Inactive"}
          color={params.value ? "success" : "default"}
          size="small"
        />
      ),
    },
    { field: "remarks", headerName: "Remarks", width: 200 },
  ];

  const onSubmit = (data: CustomerAdvancePaymentCreate) => {
    createMutation.mutate(data);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 3 }}>
        <Typography variant="h4" fontWeight="bold">
          Customer Advance Payments
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setOpenDialog(true)}
        >
          Record Advance
        </Button>
      </Box>

      <TFilterPanel>
        <TBranchFilter
          branches={branches}
          value={filterBranch}
          onChange={setFilterBranch}
        />
        <Autocomplete
          size="small"
          options={customers || []}
          getOptionLabel={(option) => option.customer_name}
          value={customers?.find((c) => c.id === selectedCustomer) || null}
          onChange={(_, newValue) => setSelectedCustomer(newValue?.id || null)}
          renderInput={(params) => (
            <TextField {...params} label="Filter by Customer" placeholder="All Customers" />
          )}
          sx={{ minWidth: 250 }}
        />
      </TFilterPanel>

      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={advances || []}
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
          <DialogTitle>Record Advance Payment</DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12}>
                <Controller
                  name="customer_id"
                  control={control}
                  rules={{ required: "Customer is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Customer"
                      select
                      fullWidth
                      required
                      error={!!fieldState.error}
                      helperText={fieldState.error?.message}
                    >
                      {customers?.map((customer) => (
                        <MenuItem key={customer.id} value={customer.id}>
                          {customer.customer_name}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="advance_payments_no"
                  control={control}
                  rules={{ required: "Payment number is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Payment Number"
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
                  name="payment_method"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Payment Method"
                      select
                      fullWidth
                    >
                      {GENERIC_PAYMENT_METHOD.map((option) => (
                        <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                      ))}
                    </TextField>
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="payment_amount"
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
                  name="branch_code"
                  control={control}
                  rules={{ required: "Branch code is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Branch Code"
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
                  name="cheque_date"
                  control={control}
                  rules={{ required: "Date is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Payment Date"
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
              <Grid item xs={12}>
                <Controller
                  name="remarks"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Remarks"
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
