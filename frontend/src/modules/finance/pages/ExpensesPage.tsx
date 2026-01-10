import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Box, Paper, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, MenuItem } from "@mui/material";
import { Add as AddIcon, FilterList as FilterIcon } from "@mui/icons-material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { useForm, Controller } from "react-hook-form";
import {
  TPageHeader,
  TButton,
  TCurrency,
  showSuccessToast,
  showErrorToast,
} from "@/components/tijaero";
import { expensesApi } from "@/modules/finance/api";
import { ExpenseCreate } from "@/modules/finance/types";

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "cheque", label: "Cheque" },
  { value: "bank_transfer", label: "Bank Transfer" },
];

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
      showSuccessToast("Expense recorded successfully");
      setOpenDialog(false);
      reset();
    },
    onError: () => {
      showErrorToast("Failed to record expense");
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
      renderCell: (params) => <TCurrency value={params.value} />,
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

  const handleAdd = () => {
    reset({
      expenses_no: "",
      expenses_method: "cash",
      expense_amount: 0,
      remarks: "",
      branch_code: "",
      bill_reference: "",
    });
    setOpenDialog(true);
  };

  return (
    <Box>
      <TPageHeader
        title="Expenses"
        actions={
          <TButton startIcon={<AddIcon />} onClick={handleAdd}>
            Record Expense
          </TButton>
        }
      />

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
        />
      </Paper>

      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogTitle>Record Expense</DialogTitle>
          <DialogContent>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 2, mt: 1 }}>
              <Controller
                name="expenses_no"
                control={control}
                rules={{ required: "Expense number is required" }}
                render={({ field, fieldState }) => (
                  <TextField {...field} label="Expense Number" required error={!!fieldState.error} helperText={fieldState.error?.message} fullWidth />
                )}
              />
              <Controller
                name="expenses_method"
                control={control}
                rules={{ required: "Payment method is required" }}
                render={({ field, fieldState }) => (
                  <TextField {...field} select label="Payment Method" required error={!!fieldState.error} helperText={fieldState.error?.message} fullWidth>
                    {PAYMENT_METHODS.map((m) => (
                      <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
                    ))}
                  </TextField>
                )}
              />
              <Controller
                name="expense_amount"
                control={control}
                rules={{ required: "Amount is required", min: { value: 0.01, message: "Must be at least 0.01" } }}
                render={({ field, fieldState }) => (
                  <TextField {...field} type="number" label="Amount" required error={!!fieldState.error} helperText={fieldState.error?.message} fullWidth />
                )}
              />
              <Controller
                name="branch_code"
                control={control}
                rules={{ required: "Branch code is required" }}
                render={({ field, fieldState }) => (
                  <TextField {...field} label="Branch Code" required error={!!fieldState.error} helperText={fieldState.error?.message} fullWidth />
                )}
              />
              <Box sx={{ gridColumn: "span 2" }}>
                <Controller
                  name="bill_reference"
                  control={control}
                  render={({ field }) => (
                    <TextField {...field} label="Bill Reference" fullWidth />
                  )}
                />
              </Box>
              <Box sx={{ gridColumn: "span 2" }}>
                <Controller
                  name="remarks"
                  control={control}
                  render={({ field }) => (
                    <TextField {...field} label="Remarks" multiline rows={3} fullWidth />
                  )}
                />
              </Box>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpenDialog(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving..." : "Record"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
}
