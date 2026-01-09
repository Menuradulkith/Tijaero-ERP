import { useForm, Controller, useFieldArray } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Grid,
  Box,
  Typography,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Divider,
  Autocomplete,
  Alert,
} from "@mui/material";
import { Add as AddIcon, Delete as DeleteIcon } from "@mui/icons-material";
import { saleReturnsApi, salesApi } from "../api";
import { Invoice, SaleReturnCreate } from "../types";
import { branchApi } from "@/modules/branches/api";
import { showSuccessToast, showErrorToast } from "@/components/tijaero";
import { format } from "date-fns";

interface SaleReturnDialogProps {
  open: boolean;
  onClose: () => void;
  preselectedInvoice?: Invoice | null;
}

const paymentOptions = [
  { value: "cash", label: "Cash Refund" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "credit", label: "Store Credit" },
  { value: "cheque", label: "Cheque" },
];

export default function SaleReturnDialog({
  open,
  onClose,
  preselectedInvoice,
}: SaleReturnDialogProps) {
  const queryClient = useQueryClient();

  const { data: invoices } = useQuery({
    queryKey: ["sales"],
    queryFn: () => salesApi.getAll(),
  });

  const { data: branchesData } = useQuery({
    queryKey: ["branches"],
    queryFn: () => branchApi.getAll(1, 100),
  });

  const branches = branchesData?.items || [];

  const { control, handleSubmit, watch, setValue, reset } = useForm<SaleReturnCreate>({
    defaultValues: {
      sale_return_no: `SR-${Date.now()}`,
      branch_code: "MAIN",
      invoice_id: preselectedInvoice?.id || 0,
      good_received_locations_id: 1,
      payment_method: "cash",
      remark: "",
      items: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items",
  });

  const selectedInvoiceId = watch("invoice_id");
  const items = watch("items");

  // Get selected invoice details
  const { data: selectedInvoice } = useQuery({
    queryKey: ["sales", selectedInvoiceId],
    queryFn: () => salesApi.getById(selectedInvoiceId),
    enabled: selectedInvoiceId > 0,
  });

  const calculateTotal = () => {
    return items.reduce((sum, item) => sum + (item.return_price || 0), 0);
  };

  const createMutation = useMutation({
    mutationFn: saleReturnsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sale-returns"] });
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      showSuccessToast("Sale return created successfully");
      reset();
      onClose();
    },
    onError: () => {
      showErrorToast("Failed to create sale return");
    },
  });

  const onSubmit = (data: SaleReturnCreate) => {
    if (data.items.length === 0) {
      showErrorToast("Please add at least one return item");
      return;
    }
    createMutation.mutate(data);
  };

  const addItem = () => {
    append({
      barcode: "",
      return_price: 0,
      sold_price: 0,
      branch_code: "MAIN",
      invoice_item_id: undefined,
    });
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="lg" fullWidth>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogTitle>Create Sale Return</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <Controller
                name="sale_return_no"
                control={control}
                rules={{ required: "Return number is required" }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Return Number"
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
                rules={{ required: "Branch is required" }}
                render={({ field, fieldState }) => (
                  <Autocomplete
                    options={branches}
                    getOptionLabel={(option) => `${option.branch_code} - ${option.branch_name}`}
                    value={branches.find((b) => b.branch_code === field.value) || null}
                    onChange={(_, newValue) => field.onChange(newValue?.branch_code || "")}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Branch"
                        fullWidth
                        required
                        error={!!fieldState.error}
                        helperText={fieldState.error?.message}
                      />
                    )}
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="invoice_id"
                control={control}
                rules={{ required: "Invoice is required", min: { value: 1, message: "Select an invoice" } }}
                render={({ field, fieldState }) => (
                  <Autocomplete
                    options={invoices || []}
                    getOptionLabel={(option) => `${option.invoice_no} - ${format(new Date(option.created_date), "MMM dd, yyyy")}`}
                    value={invoices?.find((i) => i.id === field.value) || null}
                    onChange={(_, newValue) => field.onChange(newValue?.id || 0)}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Original Invoice"
                        required
                        error={!!fieldState.error}
                        helperText={fieldState.error?.message}
                        placeholder="Search invoice..."
                      />
                    )}
                    fullWidth
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="payment_method"
                control={control}
                render={({ field }) => (
                  <Autocomplete
                    options={paymentOptions}
                    getOptionLabel={(option) => option.label}
                    value={paymentOptions.find((p) => p.value === field.value) || null}
                    onChange={(_, newValue) => field.onChange(newValue?.value || "cash")}
                    renderInput={(params) => (
                      <TextField {...params} label="Refund Method" />
                    )}
                    fullWidth
                  />
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
                    label="Reason for Return"
                    fullWidth
                    multiline
                    rows={2}
                    placeholder="Enter reason for return..."
                  />
                )}
              />
            </Grid>
          </Grid>

          {selectedInvoice && (
            <Alert severity="info" sx={{ mt: 2 }}>
              <Typography variant="body2">
                <strong>Invoice:</strong> {selectedInvoice.invoice_no} | 
                <strong> Date:</strong> {format(new Date(selectedInvoice.created_date), "MMM dd, yyyy")} |
                <strong> Items:</strong> {selectedInvoice.items?.length || 0}
              </Typography>
            </Alert>
          )}

          <Divider sx={{ my: 3 }} />

          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2 }}>
            <Typography variant="h6">Return Items</Typography>
            <Button
              startIcon={<AddIcon />}
              onClick={addItem}
              size="small"
              variant="outlined"
            >
              Add Item
            </Button>
          </Box>

          {fields.length === 0 ? (
            <Alert severity="warning">
              No return items added. Click "Add Item" to add products to return.
            </Alert>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Barcode/Serial</TableCell>
                  <TableCell>Sold Price</TableCell>
                  <TableCell>Return Price</TableCell>
                  <TableCell>Invoice Item</TableCell>
                  <TableCell>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {fields.map((field, index) => (
                  <TableRow key={field.id}>
                    <TableCell sx={{ minWidth: 150 }}>
                      <Controller
                        name={`items.${index}.barcode`}
                        control={control}
                        rules={{ required: "Barcode is required" }}
                        render={({ field, fieldState }) => (
                          <TextField
                            {...field}
                            size="small"
                            placeholder="Enter barcode"
                            error={!!fieldState.error}
                            fullWidth
                          />
                        )}
                      />
                    </TableCell>
                    <TableCell>
                      <Controller
                        name={`items.${index}.sold_price`}
                        control={control}
                        render={({ field }) => (
                          <TextField
                            {...field}
                            type="number"
                            size="small"
                            sx={{ width: 100 }}
                            inputProps={{ min: 0, step: 0.01 }}
                          />
                        )}
                      />
                    </TableCell>
                    <TableCell>
                      <Controller
                        name={`items.${index}.return_price`}
                        control={control}
                        render={({ field }) => (
                          <TextField
                            {...field}
                            type="number"
                            size="small"
                            sx={{ width: 100 }}
                            inputProps={{ min: 0, step: 0.01 }}
                          />
                        )}
                      />
                    </TableCell>
                    <TableCell>
                      <Controller
                        name={`items.${index}.invoice_item_id`}
                        control={control}
                        render={({ field }) => (
                          <Autocomplete
                            options={selectedInvoice?.items || []}
                            getOptionLabel={(option) => `Item #${option.id}`}
                            value={selectedInvoice?.items?.find((i) => i.id === field.value) || null}
                            onChange={(_, newValue) => {
                              field.onChange(newValue?.id);
                              if (newValue) {
                                setValue(`items.${index}.sold_price`, newValue.selling_price);
                                setValue(`items.${index}.return_price`, newValue.selling_price);
                              }
                            }}
                            size="small"
                            sx={{ minWidth: 120 }}
                            renderInput={(params) => (
                              <TextField {...params} placeholder="Link item" />
                            )}
                          />
                        )}
                      />
                    </TableCell>
                    <TableCell>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => remove(index)}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <Box sx={{ mt: 2, textAlign: "right" }}>
            <Typography variant="h6" color="error.main">
              Total Refund: Rs. {calculateTotal().toFixed(2)}
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            color="warning"
            disabled={createMutation.isPending || fields.length === 0}
          >
            Process Return
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
