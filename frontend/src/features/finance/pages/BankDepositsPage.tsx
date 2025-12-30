import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Button,
  Paper,
  Typography,
  TextField,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  MenuItem,
} from "@mui/material";
import {
  Add as AddIcon,
  Visibility as ViewIcon,
  CheckCircle as VerifyIcon,
  FilterList as FilterIcon,
} from "@mui/icons-material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { useForm, Controller } from "react-hook-form";
import { toast } from "react-hot-toast";
import { bankDepositsApi } from "@/modules/finance/api";
import { BankDepositCreate } from "@/modules/finance/types";

export default function BankDepositsPage() {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [filterBranch, setFilterBranch] = useState("");
  const [filterVerified, setFilterVerified] = useState<boolean | undefined>();

  const { data: deposits, isLoading } = useQuery({
    queryKey: ["bank-deposits", filterBranch, filterVerified],
    queryFn: () =>
      bankDepositsApi.getAll({
        branch_code: filterBranch || undefined,
        verified: filterVerified,
      }),
  });

  const { control, handleSubmit, reset } = useForm<BankDepositCreate>({
    defaultValues: {
      deposits_amount: 0,
      branch_code: "",
      bank_name: "",
      remarks: "",
      payment_for: "",
      invoice_no: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: bankDepositsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-deposits"] });
      toast.success("Bank deposit created successfully");
      setOpenDialog(false);
      reset();
    },
    onError: () => {
      toast.error("Failed to create bank deposit");
    },
  });

  const verifyMutation = useMutation({
    mutationFn: bankDepositsApi.verify,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-deposits"] });
      toast.success("Deposit verified successfully");
    },
    onError: () => {
      toast.error("Failed to verify deposit");
    },
  });

  const columns: GridColDef[] = [
    { field: "id", headerName: "ID", width: 70 },
    {
      field: "deposits_amount",
      headerName: "Amount",
      width: 130,
      valueFormatter: (value) => `$${Number(value).toFixed(2)}`,
    },
    { field: "branch_code", headerName: "Branch", width: 120 },
    { field: "bank_name", headerName: "Bank", width: 150 },
    { field: "payment_for", headerName: "Payment For", width: 150 },
    { field: "invoice_no", headerName: "Invoice No", width: 130 },
    {
      field: "verified",
      headerName: "Status",
      width: 120,
      renderCell: (params) => (
        <Chip
          label={params.value ? "Verified" : "Pending"}
          color={params.value ? "success" : "warning"}
          size="small"
        />
      ),
    },
    {
      field: "created_date",
      headerName: "Date",
      width: 180,
      valueFormatter: (value) => new Date(value).toLocaleString(),
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 150,
      sortable: false,
      renderCell: (params) => (
        <Box>
          <IconButton size="small" color="primary">
            <ViewIcon />
          </IconButton>
          {!params.row.verified && (
            <IconButton
              size="small"
              color="success"
              onClick={() => verifyMutation.mutate(params.row.id)}
            >
              <VerifyIcon />
            </IconButton>
          )}
        </Box>
      ),
    },
  ];

  const onSubmit = (data: BankDepositCreate) => {
    createMutation.mutate(data);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 3 }}>
        <Typography variant="h4" fontWeight="bold">
          Bank Deposits
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setOpenDialog(true)}
        >
          New Deposit
        </Button>
      </Box>

      <Paper sx={{ mb: 2, p: 2 }}>
        <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
          <FilterIcon />
          <TextField
            label="Branch Code"
            size="small"
            value={filterBranch}
            onChange={(e) => setFilterBranch(e.target.value)}
            sx={{ width: 200 }}
          />
          <TextField
            label="Status"
            size="small"
            select
            value={filterVerified === undefined ? "all" : filterVerified}
            onChange={(e) => {
              const val = e.target.value;
              setFilterVerified(val === "all" ? undefined : val === "true");
            }}
            sx={{ width: 150 }}
          >
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="true">Verified</MenuItem>
            <MenuItem value="false">Pending</MenuItem>
          </TextField>
        </Box>
      </Paper>

      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={deposits || []}
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
          <DialogTitle>New Bank Deposit</DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12}>
                <Controller
                  name="deposits_amount"
                  control={control}
                  rules={{ required: "Amount is required", min: 0.01 }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Deposit Amount"
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
              <Grid item xs={12} sm={6}>
                <Controller
                  name="bank_name"
                  control={control}
                  render={({ field }) => (
                    <TextField {...field} label="Bank Name" fullWidth />
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
              Create
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
}
