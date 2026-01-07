import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Box, Paper, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, MenuItem } from "@mui/material";
import { Add as AddIcon } from "@mui/icons-material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { useForm, Controller } from "react-hook-form";
import {
  TPageHeader,
  TButton,
  TCurrency,
  showSuccessToast,
  showErrorToast,
} from "@/components/tijaero";
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
      showSuccessToast("Credit note created successfully");
      setOpenDialog(false);
      reset();
    },
    onError: () => {
      showErrorToast("Failed to create credit note");
    },
  });

  const columns: GridColDef[] = [
    { field: "id", headerName: "ID", width: 70 },
    {
      field: "amount",
      headerName: "Amount",
      width: 130,
      renderCell: (params) => <TCurrency value={params.value} />,
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

  const handleAdd = () => {
    reset({
      customer_id: 0,
      amount: 0,
      remark: "",
      invoice_no: "",
    });
    setOpenDialog(true);
  };

  return (
    <Box>
      <TPageHeader
        title="Customer Credit Notes"
        actions={
          <TButton startIcon={<AddIcon />} onClick={handleAdd}>
            Issue Credit Note
          </TButton>
        }
      />

      <Paper sx={{ mb: 2, p: 2 }}>
        <TextField
          select
          label="Select Customer"
          value={selectedCustomer ?? ""}
          onChange={(e) => setSelectedCustomer(e.target.value ? Number(e.target.value) : null)}
          sx={{ width: 300 }}
        >
          <MenuItem value="">All Customers</MenuItem>
          {customers?.map((c) => (
            <MenuItem key={c.id} value={c.id}>{c.customer_name}</MenuItem>
          ))}
        </TextField>
      </Paper>

      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={creditNotes || []}
          columns={columns}
          loading={isLoading}
        />
      </Paper>

      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogTitle>Issue Credit Note</DialogTitle>
          <DialogContent>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
              <Controller
                name="customer_id"
                control={control}
                rules={{ required: "Customer is required" }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    select
                    label="Customer"
                    required
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                    fullWidth
                  >
                    {customers?.map((c) => (
                      <MenuItem key={c.id} value={c.id}>{c.customer_name}</MenuItem>
                    ))}
                  </TextField>
                )}
              />
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 2 }}>
                <Controller
                  name="amount"
                  control={control}
                  rules={{ required: "Amount is required", min: { value: 0.01, message: "Must be at least 0.01" } }}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      type="number"
                      label="Amount"
                      required
                      error={!!fieldState.error}
                      helperText={fieldState.error?.message}
                      fullWidth
                    />
                  )}
                />
                <Controller
                  name="invoice_no"
                  control={control}
                  render={({ field }) => (
                    <TextField {...field} label="Invoice Number" fullWidth />
                  )}
                />
              </Box>
              <Controller
                name="remark"
                control={control}
                rules={{ required: "Remark is required" }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Remark"
                    required
                    multiline
                    rows={4}
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                    fullWidth
                  />
                )}
              />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpenDialog(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving..." : "Issue"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
}
