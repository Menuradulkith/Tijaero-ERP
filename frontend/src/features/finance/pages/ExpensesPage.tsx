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
} from "@mui/material";
import { Add as AddIcon, FilterList as FilterIcon } from "@mui/icons-material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { useForm, Controller } from "react-hook-form";
import { toast } from "react-hot-toast";
import { expensesApi } from "@/modules/finance/api";
import { ExpenseCreate } from "@/modules/finance/types";

export default function ExpensesPage() {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [filterBranch, setFilterBranch] = useState("");

  const { data: expenses, isLoading } = useQuery({
    queryKey: ["expenses", filterBranch],
    queryFn: () =>
      expensesApi.getAll({
        branch_code: filterBranch || undefined,
      }),
  });

  const { control, handleSubmit, reset } = useForm<ExpenseCreate>({
    defaultValues: {
      expenses_no: "",
      expenses_method: "cash",
      expense_amount: 0,
      remarks: "",
      branch_code: "",
      bill_reference: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: expensesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      toast.success("Expense recorded successfully");
      setOpenDialog(false);
      reset();
    },
    onError: () => {
      toast.error("Failed to record expense");
    },
  });

  const columns: GridColDef[] = [
    { field: "id", headerName: "ID", width: 70 },
    { field: "expenses_no", headerName: "Expense No", width: 130 },
    { field: "expenses_method", headerName: "Method", width: 120 },
    {
      field: "expense_amount",
      headerName: "Amount",
      width: 130,
      valueFormatter: (value) => `$${Number(value).toFixed(2)}`,
    },
    { field: "branch_code", headerName: "Branch", width: 120 },
    { field: "bill_reference", headerName: "Bill Ref", width: 150 },
    {
      field: "created_date",
      headerName: "Date",
      width: 130,
      valueFormatter: (value) => new Date(value).toLocaleDateString(),
    },
    { field: "remarks", headerName: "Remarks", width: 250 },
  ];

  const onSubmit = (data: ExpenseCreate) => {
    createMutation.mutate(data);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 3 }}>
        <Typography variant="h4" fontWeight="bold">
          Expenses
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setOpenDialog(true)}
        >
          Record Expense
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
        </Box>
      </Paper>

      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={expenses || []}
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
          <DialogTitle>Record Expense</DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="expenses_no"
                  control={control}
                  rules={{ required: "Expense number is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Expense Number"
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
                  name="expenses_method"
                  control={control}
                  rules={{ required: "Payment method is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Payment Method"
                      select
                      fullWidth
                      required
                      error={!!fieldState.error}
                      helperText={fieldState.error?.message}
                    >
                      <MenuItem value="cash">Cash</MenuItem>
                      <MenuItem value="card">Card</MenuItem>
                      <MenuItem value="cheque">Cheque</MenuItem>
                      <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
                    </TextField>
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="expense_amount"
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
                  name="bill_reference"
                  control={control}
                  render={({ field }) => (
                    <TextField {...field} label="Bill Reference" fullWidth />
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
