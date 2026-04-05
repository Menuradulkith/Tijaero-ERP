import apiClient from "@/api/client";
import { useReferenceData } from "@/hooks";
import { useBranchFilter } from "@/hooks/useBranchFilter";
import { Add as AddIcon, Delete as DeleteIcon } from "@mui/icons-material";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import {
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  InputAdornment,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { salesApi } from "../api";
// OPTIMIZED: Removed customersApi, productsApi, branchApi imports - using aggregated endpoint
import { handleApiError, showErrorToast, showSuccessToast } from "@/components/tijaero";
import { Invoice, InvoiceCreate } from "../types";

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

  // OPTIMIZED: Single API call for customers, products, branches (was 3 calls)
  const { data: refData, filteredBranches } = useReferenceData(["customers", "products", "branches", "sales_stock"]);
  const customers = refData?.customers || [];
  const products = refData?.products || [];
  const salesStock = refData?.sales_stock || [];
  const branches = filteredBranches || [];

  // Get user's default branch
  const { getDefaultBranchCode } = useBranchFilter();

  const { control, handleSubmit, watch, setValue } = useForm<InvoiceCreate>({
    defaultValues: {
      invoice_no: "",
      branch_code: getDefaultBranchCode || "MAIN",
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
//eee
  const { fields, append, remove } = useFieldArray({
    control,
    name: "items",
  });

  const items = watch("items");
  const paymentMethod = watch("payment_method");

  // Barcode scanning state
  const [barcodeInput, setBarcodeInput] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Barcode validation handler
  const handleValidateBarcode = useCallback(async (barcode: string) => {
    if (!barcode.trim()) {
      setValidationError('Please enter a barcode');
      return;
    }

    // Check if product with this barcode already added
    const existingItem = items.find(item => {
      const stock = salesStock?.find(s => s.id === item.product_id);
      return stock && (stock.product_code === barcode.trim() ||
        (stock as any).barcode === barcode.trim());
    });

    if (existingItem) {
      setValidationError('This product has already been added');
      return;
    }

    setIsValidating(true);
    setValidationError(null);

    try {
      // Call inventory API to get barcode details
      const response = await apiClient.get(`/inventory/sales-stock/barcode/${barcode.trim()}`);
      const stockItem = response.data;

      // Check if item is available
      if (stockItem.status !== 'available') {
        setValidationError('This item is not available for sale');
        return;
      }

      // Add to items
      append({
        product_id: stockItem.product_id,
        quantity: 1,
        selling_price: 0, // User can update
        minimum_selling_price: 0,
        warrenty_month: stockItem.warranty_month || "0",
      });

      setBarcodeInput('');
      barcodeInputRef.current?.focus();

      showSuccessToast(`Added: ${stockItem.product?.product_name || 'Product'}`);
    } catch (error) {
      setValidationError(handleApiError(error, 'Barcode not found in available stock'));
    } finally {
      setIsValidating(false);
    }
  }, [items, salesStock, append]);

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
      showSuccessToast("Sales order created successfully");
      onClose();
    },
    onError: () => {
      showErrorToast("Failed to create sales order");
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
                rules={{ required: "Branch is required" }}
                render={({ field, fieldState }) => (
                  <Autocomplete
                    options={branches}
                    getOptionLabel={(option) => `${option.branch_code} - ${option.branch_name}`}
                    value={branches.find((b) => b.branch_code === field.value) || null}
                    onChange={(_, newValue) => field.onChange(newValue?.branch_code || "")}
                    disabled={isView}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Branch"
                        fullWidth
                        required
                        disabled={isView}
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

          {/* Barcode Scanner Section */}
          {!isView && (
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                mb: 2,
                bgcolor: "warning.50",
                borderColor: "warning.main",
                borderWidth: 2,
              }}
            >
              <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1, display: "flex", alignItems: "center", gap: 1 }}>
                <QrCodeScannerIcon color="warning" />
                Scan Barcode to Add Products
              </Typography>
              <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                <TextField
                  inputRef={barcodeInputRef}
                  size="small"
                  fullWidth
                  placeholder="Scan or type barcode and press Enter..."
                  value={barcodeInput}
                  onChange={(e) => {
                    setBarcodeInput(e.target.value);
                    if (validationError) setValidationError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleValidateBarcode(barcodeInput);
                    }
                  }}
                  disabled={isValidating}
                  error={!!validationError}
                  helperText={validationError || "Press Enter to add item"}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <QrCodeScannerIcon fontSize="small" color="action" />
                      </InputAdornment>
                    ),
                    endAdornment: isValidating ? (
                      <InputAdornment position="end">
                        <CircularProgress size={20} />
                      </InputAdornment>
                    ) : null,
                  }}
                  autoFocus
                />
                <Button
                  variant="contained"
                  color="warning"
                  onClick={() => handleValidateBarcode(barcodeInput)}
                  disabled={isValidating || !barcodeInput.trim()}
                  sx={{ minWidth: 100 }}
                >
                  {isValidating ? <CircularProgress size={20} /> : "Add"}
                </Button>
              </Box>
            </Paper>
          )}

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
                          options={salesStock || []}
                          getOptionLabel={(option) => `${option.product_name} (${option.product_code}) - Available: ${option.available_quantity}`}
                          value={
                            salesStock?.find((s) => s.id === field.value) || null
                          }
                          onChange={(_, newValue) => {
                            field.onChange(newValue?.id || 0);
                            if (newValue) {
                              // Auto-fill price from minimum_selling_price if available
                              setValue(`items.${index}.selling_price`, 0);
                              setValue(`items.${index}.warrenty_month`, "0");
                            }
                          }}
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
              Total: Rs. {calculateTotal().toFixed(2)}
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