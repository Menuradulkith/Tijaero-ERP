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
} from "@mui/material";
import { Add as AddIcon, Delete as DeleteIcon } from "@mui/icons-material";
import { salesApi } from "../api";
import { customersApi } from "@/modules/customers/api";
import { productsApi } from "@/modules/inventory/api";
import { Invoice, InvoiceCreate } from "../types";
import { toast } from "react-hot-toast";

interface SalesOrderDialogProps {
  open: boolean;
  invoice: Invoice | null;
  onClose: () => void;
}

export default function SalesOrderDialog({
  open,
  invoice,
  onClose,
}: SalesOrderDialogProps) {
  const queryClient = useQueryClient();
  const isView = !!invoice;

  const { data: customers } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.getAll(),
  });

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => productsApi.getAll(),
  });

  const { control, handleSubmit, watch } = useForm<InvoiceCreate>({
    defaultValues: {
      invoice_no: "",
      branch_code: "MAIN",
      customer_id: 0,
      sale_rep_id: 1,
      payment_method: "cash",
      cash_amount: 0,
      card_visa_amount: 0,
      card_mastercard_amount: 0,
      card_amex_amount: 0,
      cheque_amount: 0,
      bank_transfer_amount: 0,
      credit_amount: 0,
      payment_adjustments: 0,
      remarks: "",
      special: false,
      items: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items",
  });

  const items = watch("items");
  const paymentMethod = watch("payment_method");

  const calculateTotal = () => {
    return items.reduce(
      (sum, item) => sum + item.quantity * item.selling_price,
      0
    );
  };

  const createMutation = useMutation({
    mutationFn: salesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      toast.success("Sales order created successfully");
      onClose();
    },
    onError: () => {
      toast.error("Failed to create sales order");
    },
  });

  const onSubmit = (data: InvoiceCreate) => {
    const total = calculateTotal();

    // Set payment amount based on method
    const paymentData = {
      ...data,
      cash_amount: paymentMethod === "cash" ? total : 0,
      card_visa_amount: paymentMethod === "card_visa" ? total : 0,
      card_mastercard_amount: paymentMethod === "card_mastercard" ? total : 0,
      card_amex_amount: paymentMethod === "card_amex" ? total : 0,
      cheque_amount: paymentMethod === "cheque" ? total : 0,
      bank_transfer_amount: paymentMethod === "bank_transfer" ? total : 0,
      credit_amount: paymentMethod === "credit" ? total : 0,
    };

    createMutation.mutate(paymentData);
  };

  const addItem = () => {
    append({
      product_id: products?.[0]?.id || 0,
      quantity: 1,
      selling_price: 0,
      minimum_selling_price: 0,
      warrenty_month: "0",
    });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogTitle>
          {isView
            ? `View Sales Order - ${invoice.invoice_no}`
            : "Create Sales Order"}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <Controller
                name="invoice_no"
                control={control}
                rules={{ required: "Invoice number is required" }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Invoice Number"
                    fullWidth
                    required
                    disabled={isView}
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
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Branch Code"
                    fullWidth
                    disabled={isView}
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="customer_id"
                control={control}
                rules={{ required: "Customer is required" }}
                render={({ field, fieldState }) => (
                  <Autocomplete
                    options={customers || []}
                    getOptionLabel={(option) => option.customer_name}
                    value={customers?.find((c) => c.id === field.value) || null}
                    onChange={(_, newValue) =>
                      field.onChange(newValue?.id || 0)
                    }
                    disabled={isView}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Customer"
                        required
                        error={!!fieldState.error}
                        helperText={fieldState.error?.message}
                        placeholder="Search customers..."
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
                render={({ field }) => {
                  const paymentOptions = [
                    { value: "cash", label: "Cash" },
                    { value: "card_visa", label: "Visa Card" },
                    { value: "card_mastercard", label: "Mastercard" },
                    { value: "card_amex", label: "Amex Card" },
                    { value: "cheque", label: "Cheque" },
                    { value: "bank_transfer", label: "Bank Transfer" },
                    { value: "credit", label: "Credit" },
                  ];
                  return (
                    <Autocomplete
                      options={paymentOptions}
                      getOptionLabel={(option) => option.label}
                      value={
                        paymentOptions.find((p) => p.value === field.value) ||
                        null
                      }
                      onChange={(_, newValue) =>
                        field.onChange(newValue?.value || "cash")
                      }
                      disabled={isView}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Payment Method"
                          placeholder="Search payment method..."
                        />
                      )}
                      fullWidth
                    />
                  );
                }}
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
                    rows={2}
                    disabled={isView}
                  />
                )}
              />
            </Grid>
          </Grid>

          <Divider sx={{ my: 3 }} />

          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2 }}>
            <Typography variant="h6">Items</Typography>
            {!isView && (
              <Button
                startIcon={<AddIcon />}
                onClick={addItem}
                size="small"
                variant="outlined"
              >
                Add Item
              </Button>
            )}
          </Box>

          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Product</TableCell>
                <TableCell>Quantity</TableCell>
                <TableCell>Price</TableCell>
                <TableCell>Warranty (months)</TableCell>
                <TableCell>Total</TableCell>
                {!isView && <TableCell>Action</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {fields.map((field, index) => (
                <TableRow key={field.id}>
                  <TableCell sx={{ minWidth: 200 }}>
                    <Controller
                      name={`items.${index}.product_id`}
                      control={control}
                      render={({ field }) => (
                        <Autocomplete
                          options={products || []}
                          getOptionLabel={(option) => option.name}
                          value={
                            products?.find((p) => p.id === field.value) || null
                          }
                          onChange={(_, newValue) =>
                            field.onChange(newValue?.id || 0)
                          }
                          disabled={isView}
                          size="small"
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              placeholder="Search products..."
                            />
                          )}
                          fullWidth
                        />
                      )}
                    />
                  </TableCell>
                  <TableCell>
                    <Controller
                      name={`items.${index}.quantity`}
                      control={control}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          type="number"
                          size="small"
                          sx={{ width: 80 }}
                          disabled={isView}
                        />
                      )}
                    />
                  </TableCell>
                  <TableCell>
                    <Controller
                      name={`items.${index}.selling_price`}
                      control={control}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          type="number"
                          size="small"
                          sx={{ width: 100 }}
                          disabled={isView}
                        />
                      )}
                    />
                  </TableCell>
                  <TableCell>
                    <Controller
                      name={`items.${index}.warrenty_month`}
                      control={control}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          size="small"
                          sx={{ width: 80 }}
                          disabled={isView}
                        />
                      )}
                    />
                  </TableCell>
                  <TableCell>
                    $
                    {(
                      items[index]?.quantity * items[index]?.selling_price || 0
                    ).toFixed(2)}
                  </TableCell>
                  {!isView && (
                    <TableCell>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => remove(index)}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Box sx={{ mt: 2, textAlign: "right" }}>
            <Typography variant="h6">
              Total: ${calculateTotal().toFixed(2)}
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Close</Button>
          {!isView && (
            <Button
              type="submit"
              variant="contained"
              disabled={createMutation.isPending || fields.length === 0}
            >
              Create Order
            </Button>
          )}
        </DialogActions>
      </form>
    </Dialog>
  );
}
