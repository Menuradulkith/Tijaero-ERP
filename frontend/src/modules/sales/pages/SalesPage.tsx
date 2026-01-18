import apiClient from "@/api/client";
import { usePermission } from "@/auth/permissions";
import {
  ActionToolbar,
  CUSTOMER_PAYMENT_METHOD,
  DetailPanelHeader,
  EmptyState,
  FormSection,
  MasterDetailLayout,
  modernTableStyles,
  SearchableList,
  SelectableListItem,
  showErrorToast,
  showSuccessToast,
  SortOption,
  TBranchFilter,
  TConfirmDialog,
  TFilterPanel,
  TStatusChip,
  TStatusFilter,
  useMasterDetailState,
  useTConfirmDialog,
} from "@/components/tijaero";
import { useReferenceData } from "@/hooks";
import { customersApi } from "@/modules/customers/api";
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  MenuBook as MenuBookIcon,
  Print as PrintIcon,
  Receipt as ReceiptIcon,
} from "@mui/icons-material";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Step,
  StepLabel,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { salesApi } from "../api";
import InvoiceDetailsDialog from "../components/InvoiceDetailsDialog";
import { Invoice, InvoiceCreate } from "../types";

// Sort options
const sortOptions: SortOption[] = [
  { value: "created_date", label: "Date (Newest)" },
  { value: "invoice_no", label: "Invoice No" },
  { value: "total", label: "Total Amount" },
];

// Status filter options
const INVOICE_STATUS_OPTIONS = [
  { value: "pending_approval", label: "Pending Approval" },
  { value: "approved", label: "Approved" },
];

// Form steps for stepper workflow
const FORM_STEPS = ["Order Information", "Line Items"];

// Line item type
interface ItemFormData {
  product_id: number;
  quantity: number;
  selling_price: number;
  minimum_selling_price: number;
  warrenty_month: string;
  barcode?: string; // Track which items were added via barcode
  product_name?: string; // Store product name for display
  branch_code?: string; // Store branch code
  added_date?: string; // Store when item was added
}

// Initial form data
const emptyInvoiceForm: Partial<InvoiceCreate> = {
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
};

export default function SalesPage() {
  const queryClient = useQueryClient();

  // Line items state (separate from main form for complex management)
  const [lineItems, setLineItems] = useState<ItemFormData[]>([]);

  // Form step state for stepper workflow
  const [formStep, setFormStep] = useState(0);

  // Dialog states
  const [invoiceDetailsOpen, setInvoiceDetailsOpen] = useState(false);
  const [selectedInvoiceForView, setSelectedInvoiceForView] = useState<Invoice | null>(null);
  const [remarksDialogOpen, setRemarksDialogOpen] = useState(false);
  const [itemRemarkModalOpen, setItemRemarkModalOpen] = useState(false);
  const [currentItemRemark, setCurrentItemRemark] = useState("");

  // Barcode scanning state
  const [barcodeInput, setBarcodeInput] = useState("");
  const [isValidatingBarcode, setIsValidatingBarcode] = useState(false);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Validated items tracking (for visual feedback on scanned items)
  const [validatedBarcodes, setValidatedBarcodes] = useState<string[]>([]);

  // Filter states
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);

  // Permissions
  const canCreate = usePermission("sales", "create");
  const canDelete = usePermission("sales", "delete");

  // Confirm dialogs
  const deleteDialog = useTConfirmDialog();
  const discardDialog = useTConfirmDialog();

  // Main state using Tijaero hook
  const state = useMasterDetailState<Invoice, Partial<InvoiceCreate>>({
    initialFormData: emptyInvoiceForm,
    initialSortField: "created_date",
  });

  // Queries
  const { data: invoices, isLoading, refetch } = useQuery({
    queryKey: ["sales"],
    queryFn: () => salesApi.getAll(),
  });

  // Fetch customers separately (has complex operations like credit check)
  const { data: customers } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.getAll(),
  });

  // OPTIMIZED: Single API call for products and branches (was 2 calls)
  const { data: refData } = useReferenceData(["products", "branches"]);
  const products = refData?.products || [];
  const branches = refData?.branches || [];

  // Load full invoice with items when viewing
  const { data: fullInvoice } = useQuery({
    queryKey: ["sales", state.selectedItem?.id],
    queryFn: () => salesApi.getById(state.selectedItem!.id),
    enabled: !!state.selectedItem && !state.isCreating,
  });

  // Calculate total for an invoice
  const calculateTotal = (invoice: Invoice) => {
    return (
      invoice.cash_amount +
      invoice.card_visa_amount +
      invoice.card_mastercard_amount +
      invoice.card_amex_amount +
      invoice.cheque_amount +
      invoice.bank_transfer_amount +
      invoice.credit_amount
    );
  };

  // Calculate line items total
  const calculateLineItemsTotal = () => {
    return lineItems.reduce((sum, item) => sum + item.quantity * item.selling_price, 0);
  };

  // Filter and sort invoices
  const filteredInvoices = useMemo(() => {
    if (!invoices) return [];

    let filtered = invoices.filter(
      (invoice) =>
        invoice.invoice_no.toLowerCase().includes(state.searchQuery.toLowerCase()) ||
        invoice.branch_code.toLowerCase().includes(state.searchQuery.toLowerCase())
    );

    // Apply branch filter
    if (filterBranch) {
      filtered = filtered.filter(invoice => invoice.branch_code === filterBranch);
    }

    // Apply status filter
    if (filterStatus) {
      const isApproved = filterStatus === "approved";
      filtered = filtered.filter(invoice => invoice.approval === isApproved);
    }

    filtered.sort((a, b) => {
      if (state.sortField === "invoice_no") {
        return a.invoice_no.localeCompare(b.invoice_no);
      } else if (state.sortField === "created_date") {
        return new Date(b.created_date).getTime() - new Date(a.created_date).getTime();
      } else if (state.sortField === "total") {
        return calculateTotal(b) - calculateTotal(a);
      }
      return 0;
    });

    return filtered;
  }, [invoices, state.searchQuery, state.sortField, filterBranch, filterStatus]);

  // Auto-select first item when data loads
  useEffect(() => {
    if (filteredInvoices.length > 0 && !state.selectedItem && !state.isCreating) {
      state.setSelectedItem(filteredInvoices[0]);
    }
  }, [filteredInvoices, state.selectedItem, state.isCreating]);

  // Mutations
  const deleteMutation = useMutation({
    mutationFn: salesApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      showSuccessToast("Sales order deleted successfully");
      state.setSelectedItem(null);
    },
    onError: () => {
      showErrorToast("Failed to delete sales order");
    },
  });

  const createMutation = useMutation({
    mutationFn: salesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      showSuccessToast("Sales order created successfully");
      state.setIsCreating(false);
      setLineItems([]);
      state.setFormData(emptyInvoiceForm);
    },
    onError: () => {
      showErrorToast("Failed to create sales order");
    },
  });

  // Pending invoice for selection after discard confirm
  const [_pendingInvoice, setPendingInvoice] = useState<Invoice | null>(null);

  // Handlers
  const handleSelectInvoice = (invoice: Invoice) => {
    if (state.isCreating) {
      setPendingInvoice(invoice);
      discardDialog.open(
        "Discard Changes",
        "Discard unsaved changes?",
        () => {
          state.setSelectedItem(invoice);
          state.setIsCreating(false);
          setPendingInvoice(null);
        }
      );
      return;
    }
    state.setSelectedItem(invoice);
    state.setIsCreating(false);
  };

  const handleCreate = () => {
    state.setSelectedItem(null);
    state.setIsCreating(true);
    setLineItems([]);
    setFormStep(0);
    setBarcodeInput("");
    setBarcodeError(null);
    setValidatedBarcodes([]);
    state.setFormData({
      invoice_no: `INV-${Date.now()}`,
      branch_code: "MAIN",
      customer_id: customers?.[0]?.id || 0,
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
    });
  };

  const handleSave = () => {
    const total = calculateLineItemsTotal();
    const paymentMethod = state.formData.payment_method;

    const invoiceData: InvoiceCreate = {
      ...(state.formData as InvoiceCreate),
      cash_amount: paymentMethod === "cash" ? total : 0,
      card_visa_amount: paymentMethod === "card_visa" ? total : 0,
      card_mastercard_amount: paymentMethod === "card_mastercard" ? total : 0,
      card_amex_amount: paymentMethod === "card_amex" ? total : 0,
      cheque_amount: paymentMethod === "cheque" ? total : 0,
      bank_transfer_amount: paymentMethod === "bank_transfer" ? total : 0,
      credit_amount: paymentMethod === "credit" ? total : 0,
      items: lineItems,
    };

    createMutation.mutate(invoiceData);
  };

  const handleCancel = () => {
    state.setIsCreating(false);
    setLineItems([]);
    setFormStep(0);
    setValidatedBarcodes([]);
  };

  const handleDelete = () => {
    if (state.selectedItem) {
      deleteDialog.open(
        "Delete Sales Order",
        "Are you sure you want to delete this sales order?",
        () => deleteMutation.mutate(state.selectedItem!.id)
      );
    }
  };

  const addLineItem = () => {
    setLineItems([
      ...lineItems,
      {
        product_id: products?.[0]?.id || 0,
        quantity: 1,
        selling_price: 0,
        minimum_selling_price: 0,
        warrenty_month: "0",
        branch_code: state.formData.branch_code || "",
        added_date: new Date().toISOString(),
      },
    ]);
  };

  const removeLineItem = (index: number) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  // Step navigation functions
  const handleNextStep = () => {
    if (formStep < FORM_STEPS.length - 1) setFormStep(prev => prev + 1);
  };

  const handlePreviousStep = () => {
    if (formStep > 0) setFormStep(prev => prev - 1);
  };

  // Step 1 validation - require customer and invoice number
  const isStep1Valid = state.formData.invoice_no && state.formData.customer_id && state.formData.customer_id > 0;

  const updateLineItem = (index: number, field: keyof ItemFormData, value: number | string) => {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };
    setLineItems(updated);
  };

  // Barcode validation handler
  const handleValidateBarcode = useCallback(async (barcode: string) => {
    if (!barcode.trim()) {
      setBarcodeError("Please enter a barcode");
      return;
    }

    // Check if this exact barcode has already been scanned
    const existingItem = lineItems.find(item => item.barcode === barcode.trim());

    if (existingItem) {
      setBarcodeError("This barcode has already been scanned");
      return;
    }

    setIsValidatingBarcode(true);
    setBarcodeError(null);

    try {
      const response = await apiClient.get(`/inventory/sales-stock/barcode/${barcode.trim()}`);
      const stockItem = response.data;

      console.log("Stock Item Response:", stockItem); // Debug log

      if (stockItem.status !== "available") {
        setBarcodeError("This item is not available for sale");
        return;
      }

      // Get prices from product relationship or top-level fields
      const sellingPrice = stockItem.selling_price || stockItem.product?.selling_price || 0;
      const warrantyMonths = stockItem.warranty_month || stockItem.product?.warrenty_month || "0";
      const productName = stockItem.product_name || stockItem.product?.product_name || stockItem.product?.name || "";

      // Add to line items
      const newItem: ItemFormData = {
        product_id: stockItem.product_id,
        quantity: 1,
        selling_price: sellingPrice,
        minimum_selling_price: sellingPrice,
        warrenty_month: warrantyMonths?.toString() || "0",
        barcode: barcode.trim(),
        product_name: productName,
        branch_code: stockItem.branch_code || state.formData.branch_code || "",
      };
      setLineItems(prev => [...prev, newItem]);
      setValidatedBarcodes(prev => [...prev, barcode.trim()]);

      setBarcodeInput("");
      barcodeInputRef.current?.focus();
      showSuccessToast(`Added: ${productName || "Product"}`);
    } catch (error: any) {
      console.error("Barcode validation error:", error);
      setBarcodeError(error.response?.data?.detail || "Barcode not found in available stock");
    } finally {
      setIsValidatingBarcode(false);
    }
  }, [lineItems, products]);

  // Handle view invoice details
  const handleViewDetails = () => {
    if (state.selectedItem) {
      setSelectedInvoiceForView(state.selectedItem);
      setInvoiceDetailsOpen(true);
    }
  };

  // Custom actions for toolbar
  const customActions = state.selectedItem && !state.isCreating ? (
    <Box sx={{ display: "flex", gap: 0.5 }}>
      <Tooltip title="Print Invoice">
        <IconButton size="small" onClick={handleViewDetails}>
          <PrintIcon />
        </IconButton>
      </Tooltip>
    </Box>
  ) : undefined;

  // Render view invoice details
  const renderViewInvoice = () => {
    const customer = customers?.find((c) => c.id === state.selectedItem?.customer_id);
    const productMap = new Map(products.map((p: any) => [p.id, p]));

    return (
      <>
        {/* Order Information */}
        <FormSection title="Order Information" columns={3}>
          <TextField label="Invoice Number" size="small" value={state.selectedItem?.invoice_no} disabled />
          <TextField label="Branch" size="small" value={state.selectedItem?.branch_code} disabled />
          <TextField label="Payment Method" size="small" value={state.selectedItem?.payment_method?.replace(/_/g, " ")} disabled />
        </FormSection>

        {/* Customer Information */}
        <FormSection title="Customer Information" columns={2}>
          <TextField label="Customer Name" size="small" value={customer?.customer_name || ""} disabled />
          <TextField label="Company" size="small" value={customer?.company_name || "N/A"} disabled />
          <TextField label="Contact" size="small" value={customer?.mobile_contact_number || ""} disabled />
          <TextField label="Email" size="small" value={customer?.email || "N/A"} disabled />
        </FormSection>

        {/* Dates & Payment */}
        <FormSection title="Dates & Payment" columns={3}>
          <TextField
            label="Order Date"
            size="small"
            value={state.selectedItem ? new Date(state.selectedItem.created_date).toLocaleDateString() : ""}
            disabled
          />
          <TextField
            label="Credit Amount"
            size="small"
            value={`Rs. ${(state.selectedItem?.credit_amount || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            disabled
          />
          <TextField
            label="Cash Amount"
            size="small"
            value={`Rs. ${(state.selectedItem?.cash_amount || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            disabled
          />
        </FormSection>

        {/* Order Status */}
        <FormSection title="Order Status" columns={1}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="body2" color="text.secondary">Status:</Typography>
            <TStatusChip status={state.selectedItem?.approval ? "approved" : "pending_approval"} statusMap="salesOrder" />
          </Box>
        </FormSection>

        {/* Tracking */}
        <FormSection title="Tracking" columns={2}>
          <TextField
            label="Created Date"
            size="small"
            value={state.selectedItem?.created_at ? new Date(state.selectedItem.created_at).toLocaleString() : ""}
            disabled
            InputProps={{ readOnly: true }}
          />
          <TextField
            label="Order Date"
            size="small"
            value={state.selectedItem?.created_date ? new Date(state.selectedItem.created_date).toLocaleDateString() : ""}
            disabled
            InputProps={{ readOnly: true }}
          />
        </FormSection>

        {/* Order Items */}
        {fullInvoice?.items && (
          <FormSection title="Order Items" columns={1}>
            <Paper variant="outlined" sx={{ overflow: "hidden", width: "100%", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={modernTableStyles.headerRow}>
                    <TableCell>Product</TableCell>
                    <TableCell align="right">Quantity</TableCell>
                    <TableCell align="right">Unit Price (Rs.)</TableCell>
                    <TableCell align="center">Warranty</TableCell>
                    <TableCell>Remark</TableCell>
                    <TableCell align="right">Amount (Rs.)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {fullInvoice.items.map((item: any, index: number) => {
                    const product = productMap.get(item.product_id);
                    return (
                      <TableRow key={index} sx={{
                        ...modernTableStyles.bodyRow,
                        ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                      }}>
                        <TableCell>{product?.name || `Product #${item.product_id}`}</TableCell>
                        <TableCell align="right">{item.quantity}</TableCell>
                        <TableCell align="right">{item.selling_price.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                        <TableCell align="center">{item.warrenty_month || "0"} mo</TableCell>
                        <TableCell>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                            <Typography variant="body2" sx={{ maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {item.remark || "-"}
                            </Typography>
                            <Tooltip title="View Remark">
                              <IconButton size="small" onClick={() => { setCurrentItemRemark(item.remark || ""); setItemRemarkModalOpen(true); }}>
                                <MenuBookIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        </TableCell>
                        <TableCell align="right">{(item.quantity * item.selling_price).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow sx={modernTableStyles.footerRow}>
                    <TableCell colSpan={5} align="right">
                      <strong>Total:</strong>
                    </TableCell>
                    <TableCell align="right">
                      <strong>{(fullInvoice.items.reduce((sum: number, item: any) => sum + (item.quantity * item.selling_price), 0) || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Paper>
          </FormSection>
        )}

        {/* Remarks */}
        {state.selectedItem?.remarks && (
          <FormSection title="Remarks" columns={1}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
              <TextField
                multiline
                rows={2}
                fullWidth
                value={state.selectedItem.remarks}
                disabled
                size="small"
              />
              <Tooltip title="View / Add Remarks">
                <IconButton size="small" onClick={() => setRemarksDialogOpen(true)}>
                  <MenuBookIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          </FormSection>
        )}

        {/* Adjustments */}
        {state.selectedItem && (state.selectedItem.payment_adjustments !== 0 ||
          state.selectedItem.cupon_amount !== 0 ||
          state.selectedItem.credit_note_amount !== 0) && (
            <FormSection title="Adjustments">
              {state.selectedItem.payment_adjustments !== 0 && (
                <Box>
                  <Typography variant="caption" color="text.secondary">Payment Adjustments</Typography>
                  <Typography variant="body2" fontWeight={500}>Rs. {state.selectedItem.payment_adjustments.toFixed(2)}</Typography>
                </Box>
              )}
              {state.selectedItem.cupon_amount !== 0 && (
                <Box>
                  <Typography variant="caption" color="text.secondary">Coupon Amount</Typography>
                  <Typography variant="body2" fontWeight={500}>Rs. {state.selectedItem.cupon_amount.toFixed(2)}</Typography>
                </Box>
              )}
              {state.selectedItem.credit_note_amount !== 0 && (
                <Box>
                  <Typography variant="caption" color="text.secondary">Credit Note</Typography>
                  <Typography variant="body2" fontWeight={500}>Rs. {state.selectedItem.credit_note_amount.toFixed(2)}</Typography>
                </Box>
              )}
            </FormSection>
          )}
      </>
    );
  };

  // Render create invoice form
  const renderCreateForm = () => (
    <>
      {/* Stepper */}
      <Stepper activeStep={formStep} sx={{ mb: 3 }}>
        {FORM_STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {/* Step 1: Order Information */}
      {formStep === 0 && (
        <>
          <FormSection title="Order Details" columns={3}>
            <TextField
              label="Invoice No"
              size="small"
              value={state.formData.invoice_no}
              onChange={(e) => state.setFormData({ ...state.formData, invoice_no: e.target.value })}
              required
            />
            <Autocomplete
              size="small"
              options={branches}
              getOptionLabel={(option) => `${option.branch_code} - ${option.branch_name}`}
              value={branches.find((b) => b.branch_code === state.formData.branch_code) || null}
              onChange={(_, newValue) => state.setFormData({ ...state.formData, branch_code: newValue?.branch_code || "" })}
              renderInput={(params) => <TextField {...params} label="Branch" required />}
            />
            <Autocomplete
              size="small"
              options={customers || []}
              getOptionLabel={(option) => option.customer_name || ""}
              value={customers?.find((c) => c.id === state.formData.customer_id) || null}
              onChange={(_, newValue) => state.setFormData({ ...state.formData, customer_id: newValue?.id || 0 })}
              renderInput={(params) => <TextField {...params} label="Customer" required />}
            />
            <TextField
              label="Payment Method"
              size="small"
              select
              value={state.formData.payment_method}
              onChange={(e) => state.setFormData({ ...state.formData, payment_method: e.target.value })}
            >
              {CUSTOMER_PAYMENT_METHOD.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </TextField>
          </FormSection>

          <FormSection title="Additional Information" columns={1}>
            <TextField
              label="Remarks"
              size="small"
              value={state.formData.remarks}
              onChange={(e) => state.setFormData({ ...state.formData, remarks: e.target.value })}
              multiline
              rows={2}
            />
          </FormSection>

          {/* Step 1 Navigation */}
          <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 2 }}>
            <Button
              variant="contained"
              color="primary"
              onClick={handleNextStep}
              disabled={!isStep1Valid}
              endIcon={<ArrowForwardIcon />}
            >
              Next: Line Items
            </Button>
          </Box>
        </>
      )}

      {/* Step 2: Line Items */}
      {formStep === 1 && (
        <>
          {/* Barcode Scanner Section */}
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
                  if (barcodeError) setBarcodeError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleValidateBarcode(barcodeInput);
                  }
                }}
                disabled={isValidatingBarcode}
                error={!!barcodeError}
                helperText={barcodeError || "Press Enter to add item"}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <QrCodeScannerIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                  endAdornment: isValidatingBarcode ? (
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
            disabled={isValidatingBarcode || !barcodeInput.trim()}
            sx={{ minWidth: 100 }}
          >
            {isValidatingBarcode ? <CircularProgress size={20} /> : "Add"}
          </Button>
        </Box>
      </Paper>

      {/* Line Items Section */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
          <Typography variant="subtitle1" fontWeight="bold">Line Items</Typography>
          <IconButton size="small" onClick={addLineItem} color="primary" title="Add manual item">
            <AddIcon />
          </IconButton>
        </Box>

        <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={modernTableStyles.headerRow}>
                <TableCell>Barcode</TableCell>
                <TableCell>Product</TableCell>
                <TableCell>Branch Code</TableCell>
                <TableCell align="right" sx={{ width: 100 }}>Quantity</TableCell>
                <TableCell align="right" sx={{ width: 100 }}>Warranty (Months)</TableCell>
                <TableCell align="right" sx={{ width: 120 }}>Min Price (Rs.)</TableCell>
                <TableCell align="right" sx={{ width: 120 }}>Selling Price (Rs.)</TableCell>
                <TableCell sx={{ width: 50 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {lineItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} sx={modernTableStyles.emptyCell}>
                    Scan barcodes above to add items
                  </TableCell>
                </TableRow>
              ) : (
                lineItems.map((item, index) => (
                  <TableRow key={index} sx={{
                    ...modernTableStyles.bodyRow,
                    ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                  }}>
                    {/* Barcode Column - with validation indicator */}
                    <TableCell>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        {item.barcode && validatedBarcodes.includes(item.barcode) && (
                          <CheckCircleIcon fontSize="small" color="success" />
                        )}
                        <Typography variant="body2" color={item.barcode ? "success.main" : "text.secondary"} fontWeight={item.barcode ? 500 : 400}>
                          {item.barcode || "-"}
                        </Typography>
                      </Box>
                    </TableCell>
                    
                    {/* Product Column */}
                    <TableCell>
                      <Typography variant="body2">{item.product_name || `Product #${item.product_id}`}</Typography>
                    </TableCell>

                    {/* Branch Code Column */}
                    <TableCell>
                      {item.branch_code || state.formData.branch_code || "-"}
                    </TableCell>

                    {/* Quantity Column */}
                    <TableCell align="right">
                      <Typography variant="body2">{item.quantity}</Typography>
                    </TableCell>

                    {/* Warranty Column */}
                    <TableCell align="right">
                      <TextField
                        size="small"
                        type="number"
                        value={item.warrenty_month}
                        onChange={(e) => updateLineItem(index, "warrenty_month", e.target.value)}
                        sx={{ width: 80 }}
                        inputProps={{ min: 0 }}
                      />
                    </TableCell>

                    {/* Min Price Column */}
                    <TableCell align="right">
                      <Typography variant="body2" color="text.secondary">
                        {(item.minimum_selling_price || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Typography>
                    </TableCell>

                    {/* Selling Price Column */}
                    <TableCell align="right">
                      <TextField
                        size="small"
                        type="number"
                        value={item.selling_price}
                        onChange={(e) => updateLineItem(index, "selling_price", parseFloat(e.target.value) || 0)}
                        sx={{ width: 100 }}
                        inputProps={{ min: 0, step: 0.01 }}
                        error={item.selling_price < item.minimum_selling_price}
                        helperText={item.selling_price < item.minimum_selling_price ? `Min: ${item.minimum_selling_price}` : ""}
                      />
                    </TableCell>

                    {/* Delete Button Column */}
                    <TableCell align="center">
                      <IconButton size="small" color="error" onClick={() => removeLineItem(index)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
              {/* Total Row */}
              <TableRow sx={{ bgcolor: "action.hover" }}>
                <TableCell colSpan={7} align="right">
                  <Typography fontWeight="bold">Total:</Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography fontWeight="bold">
                    {calculateLineItemsTotal().toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </Typography>
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </Paper>
      </Box>

          {/* Step 2 Navigation */}
          <Box sx={{ display: "flex", justifyContent: "space-between", mt: 2 }}>
            <Button
              variant="outlined"
              onClick={handlePreviousStep}
              startIcon={<ArrowBackIcon />}
            >
              Back
            </Button>
            <Button
              variant="contained"
              color="primary"
              onClick={handleSave}
              disabled={createMutation.isPending || lineItems.length === 0}
              startIcon={createMutation.isPending ? <CircularProgress size={20} /> : null}
            >
              {createMutation.isPending ? "Saving..." : "Save Order"}
            </Button>
          </Box>
        </>
      )}
    </>
  );

  return (
    <>
      <MasterDetailLayout title="Sales Orders" onRefresh={refetch}>
        <Box sx={{ flex: 1, display: "flex", flexDirection: { xs: "column", md: "row" }, overflow: "hidden" }}>
          {/* Master List */}
          <SearchableList
            searchValue={state.searchQuery}
            onSearchChange={state.setSearchQuery}
            searchPlaceholder="Search by invoice no..."
            sortOptions={sortOptions}
            currentSort={state.sortField}
            onSortChange={state.setSortField}
            isLoading={isLoading}
            emptyMessage="No sales orders found"
            listHeader={
              <TFilterPanel>
                <TStatusFilter
                  options={INVOICE_STATUS_OPTIONS}
                  value={filterStatus}
                  onChange={setFilterStatus}
                />
                <TBranchFilter
                  branches={branches}
                  value={filterBranch}
                  onChange={setFilterBranch}
                />
              </TFilterPanel>
            }
          >
            {filteredInvoices.map((invoice) => {
              const isSelected = state.selectedItem?.id === invoice.id;
              return (
                <SelectableListItem
                  key={invoice.id}
                  isSelected={isSelected}
                  onClick={() => handleSelectInvoice(invoice)}
                  primaryText={
                    <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
                      {/* Invoice No */}
                      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span>{invoice.invoice_no}</span>
                        {isSelected && (
                          <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                            (Invoice No)
                          </Typography>
                        )}
                      </Box>
                      {/* Total */}
                      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <Typography
                          component="span"
                          variant="caption"
                          fontWeight={600}
                          sx={{ color: isSelected ? "inherit" : "success.main" }}
                        >
                          Rs. {calculateTotal(invoice).toFixed(2)}
                        </Typography>
                        {isSelected && (
                          <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                            (Total)
                          </Typography>
                        )}
                      </Box>
                      {/* Date & Branch - only when selected */}
                      {isSelected && (
                        <>
                          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <Typography component="span" variant="caption">
                              {format(new Date(invoice.created_date), "MMM dd, yyyy")}
                            </Typography>
                            <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                              (Date)
                            </Typography>
                          </Box>
                          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <Typography component="span" variant="caption">
                              {invoice.branch_code}
                            </Typography>
                            <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                              (Branch)
                            </Typography>
                          </Box>
                          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <Typography component="span" variant="caption" sx={{ textTransform: "capitalize" }}>
                              {invoice.payment_method?.replace(/_/g, " ")}
                            </Typography>
                            <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                              (Payment)
                            </Typography>
                          </Box>
                          {/* Status Chips - shown below all fields when selected */}
                          <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                            <Chip
                              label={invoice.status ? "Active" : "Inactive"}
                              size="small"
                              color={invoice.status ? "success" : "default"}
                              sx={{ height: 18, fontSize: "0.65rem" }}
                            />
                            <Chip
                              label={invoice.approval ? "Approved" : "Pending Approval"}
                              size="small"
                              color={invoice.approval ? "info" : "warning"}
                              variant="outlined"
                              sx={{ height: 18, fontSize: "0.65rem" }}
                            />
                          </Box>
                        </>
                      )}
                    </Box>
                  }
                  secondaryText={!isSelected ? `${format(new Date(invoice.created_date), "MMM dd, yyyy")} • ${invoice.branch_code}` : undefined}
                  isFavorite={state.favorites.includes(invoice.id)}
                  onToggleFavorite={() => state.toggleFavorite(invoice.id)}
                />
              );
            })}
          </SearchableList>

          {/* Detail Panel */}
          <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <DetailPanelHeader
              icon={<ReceiptIcon color="primary" />}
              breadcrumbs={[{ label: "Sales", href: "/sales" }, { label: "Sales Orders" }]}
              title={
                state.isCreating
                  ? "Create New Sales Order"
                  : state.selectedItem
                    ? state.selectedItem.invoice_no
                    : "Select a Sales Order"
              }
              chips={
                state.selectedItem && !state.isCreating
                  ? [
                    { label: state.selectedItem.status ? "Active" : "Inactive", color: state.selectedItem.status ? "success" : "default" },
                    { label: state.selectedItem.payment_method, color: "default", variant: "outlined" },
                  ]
                  : undefined
              }
            />

            <ActionToolbar
              canCreate={canCreate}
              canDelete={canDelete}
              canUpdate={false}
              isEditing={false}
              isCreating={state.isCreating}
              hasSelection={!!state.selectedItem}
              onAdd={handleCreate}
              onDelete={handleDelete}
              onSave={handleSave}
              onCancel={handleCancel}
              isSaving={createMutation.isPending}
              saveDisabled={!state.formData.invoice_no || lineItems.length === 0 || formStep !== 1}
              customActions={customActions}
            />

            <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
              {!state.selectedItem && !state.isCreating ? (
                <EmptyState message="Select a sales order from the list or create a new one" />
              ) : state.isCreating ? (
                renderCreateForm()
              ) : (
                renderViewInvoice()
              )}
            </Box>
          </Box>
        </Box>
      </MasterDetailLayout>
      <TConfirmDialog {...deleteDialog.dialogProps} />
      <TConfirmDialog {...discardDialog.dialogProps} confirmText="Discard" />

      {/* Invoice Details Dialog */}
      <InvoiceDetailsDialog
        open={invoiceDetailsOpen}
        invoice={selectedInvoiceForView}
        onClose={() => {
          setInvoiceDetailsOpen(false);
          setSelectedInvoiceForView(null);
        }}
      />

      {/* Remarks Modal */}
      <Dialog open={remarksDialogOpen} onClose={() => setRemarksDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Remarks</DialogTitle>
        <DialogContent>
          <TextField
            multiline
            rows={8}
            fullWidth
            placeholder="No remarks..."
            value={state.selectedItem?.remarks || ""}
            InputProps={{ readOnly: true }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemarksDialogOpen(false)}>OK</Button>
          <Button onClick={() => setRemarksDialogOpen(false)} variant="outlined">
            Cancel
          </Button>
        </DialogActions>
      </Dialog>

      {/* Item Remark Modal */}
      <Dialog
        open={itemRemarkModalOpen}
        onClose={() => setItemRemarkModalOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <MenuBookIcon />
          Item Remark
        </DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            rows={4}
            value={currentItemRemark || "No remark"}
            InputProps={{ readOnly: true }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setItemRemarkModalOpen(false)} variant="outlined">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}