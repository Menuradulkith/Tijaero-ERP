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
import { Add as AddIcon } from "@mui/icons-material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { useForm, Controller } from "react-hook-form";
import { toast } from "react-hot-toast";
import { creditNotesApi } from "@/modules/finance/api";
import { customersApi } from "@/modules/customers/api";
import { CustomerCreditNoteCreate } from "@/modules/finance/types";

export default function CreditNotesPage() {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<number | null>(null);

  const { data: customers } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.getAll(),
  });

  const { data: creditNotes, isLoading } = useQuery({
    queryKey: ["credit-notes", selectedCustomer],
    queryFn: () =>
      selectedCustomer
        ? creditNotesApi.getCustomerCreditNotes(selectedCustomer)
        : Promise.resolve([]),
    enabled: !!selectedCustomer,
  });

  const { control, handleSubmit, reset } = useForm<CustomerCreditNoteCreate>({
    defaultValues: {
      customer_id: 0,
      amount: 0,
      remark: "",
      invoice_no: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: creditNotesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["credit-notes"] });
      toast.success("Credit note created successfully");
      setOpenDialog(false);
      reset();
    },
    onError: () => {
      toast.error("Failed to create credit note");
    },
  });

  const columns: GridColDef[] = [
    { field: "id", headerName: "ID", width: 70 },
    {
      field: "amount",
      headerName: "Amount",
      width: 130,
      valueFormatter: (value) => `$${Number(value).toFixed(2)}`,
    },
    { field: "invoice_no", headerName: "Invoice No", width: 130 },
    {
      field: "date",
      headerName: "Date",
      width: 180,
      valueFormatter: (value) => new Date(value).toLocaleString(),
    },
    { field: "remark", headerName: "Remark", width: 300 },
  ];

  const onSubmit = (data: CustomerCreditNoteCreate) => {
    createMutation.mutate(data);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 3 }}>
        <Typography variant="h4" fontWeight="bold">
          Customer Credit Notes
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setOpenDialog(true)}
        >
          Issue Credit Note
        </Button>
      </Box>

      <Paper sx={{ mb: 2, p: 2 }}>
        <TextField
          label="Select Customer"
          select
          value={selectedCustomer || ""}
          onChange={(e) => setSelectedCustomer(Number(e.target.value))}
          sx={{ width: 300 }}
        >
          <MenuItem value="">All Customers</MenuItem>
          {customers?.map((customer) => (
            <MenuItem key={customer.id} value={customer.id}>
              {customer.customer_name}
            </MenuItem>
          ))}
        </TextField>
      </Paper>

      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={creditNotes || []}
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
          <DialogTitle>Issue Credit Note</DialogTitle>
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
                  rules={{ required: "Remark is required" }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label="Remark"
                      fullWidth
                      required
                      multiline
                      rows={4}
                      error={!!fieldState.error}
                      helperText={fieldState.error?.message}
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
              Issue
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
}
