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
  TConfirmDialog,
  TStatusChip,
  useMasterDetailState,
  useTConfirmDialog,
} from "@/components/tijaero";
import SalesFilterPanel from "@/modules/sales/components/ui/SalesFilterPanel";
import { useReferenceData } from "@/hooks";
import { customersApi } from "@/modules/customers/api";
import { creditNotesApi } from "@/modules/finance/api";
import {
  Add as AddIcon,
  Cancel as CancelIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  MenuBook as MenuBookIcon,
  Print as PrintIcon,
  Receipt as ReceiptIcon,
  ThumbUp as ApproveIcon,
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
import { useNavigate } from "react-router-dom";
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
  { value: "completed", label: "Completed" },
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
  const navigate = useNavigate();

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

  // Payment details state for different payment methods
  const [paymentDetails, setPaymentDetails] = useState({
    // Cheque payment details
    cheque_number: "",
    cheque_bank: "",
    cheque_date: new Date().toISOString().split('T')[0],
    // Card payment details
    card_ref_number: "",
    card_holder_name: "",
    // Bank transfer details
    bank_transfer_ref: "",
    bank_name: "",
    // Credit note
    credit_note_id: 0,
    credit_note_amount: 0,
  });

  // Filter states
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);

  // Permissions
  const canCreate = usePermission("sales", "create");
  const canDelete = usePermission("sales", "delete");
  const canUpdate = usePermission("sales", "update");
  const canApprove = usePermission("sales", "approve");

  // Confirm dialogs
  const deleteDialog = useTConfirmDialog();
  const discardDialog = useTConfirmDialog();
  const approveDialog = useTConfirmDialog();
  const cancelDialog = useTConfirmDialog();
  const creditWarningDialog = useTConfirmDialog();

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

  // Fetch credit notes for selected customer when using credit_note payment
  const selectedCustomerId = state.formData.customer_id;
  const { data: customerCreditNotes } = useQuery({
    queryKey: ["customer-credit-notes", selectedCustomerId],
    queryFn: () => creditNotesApi.getCustomerCreditNotes(selectedCustomerId as number),
    enabled: !!selectedCustomerId && state.formData.payment_method === "credit_note",
  });

  // Fetch customer credit status for credit sales validation
  const { data: customerCreditStatus } = useQuery({
    queryKey: ["customer-credit-status", selectedCustomerId],
    queryFn: () => customersApi.getCreditSummary(selectedCustomerId as number),
    enabled: !!selectedCustomerId && selectedCustomerId > 0 && (state.isCreating || state.isEditing),
  });

  // Fetch recent sales for selected customer (last 5 from any branch)
  const { data: recentCustomerSales, isLoading: loadingRecentSales } = useQuery({
    queryKey: ["customer-recent-sales", selectedCustomerId],
    queryFn: () => salesApi.getRecentByCustomer(selectedCustomerId as number, 5),
    enabled: !!selectedCustomerId && selectedCustomerId > 0 && (state.isCreating || state.isEditing),
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

    let filtered = invoices.filter((invoice) => {
      const searchLower = state.searchQuery.toLowerCase();
      const customer = customers?.find((c) => c.id === invoice.customer_id);
      const customerName = customer?.customer_name?.toLowerCase() || "";

      return (
        invoice.invoice_no.toLowerCase().includes(searchLower) ||
        invoice.branch_code.toLowerCase().includes(searchLower) ||
        customerName.includes(searchLower)
      );
    });

    // Apply branch filter
    if (filterBranch) {
      filtered = filtered.filter(invoice => invoice.branch_code === filterBranch);
    }

    // Apply status filter
    if (filterStatus) {
      filtered = filtered.filter(invoice => invoice.approval_status === filterStatus);
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

  // Store payment method for navigation after create
  const [pendingPaymentMethod, setPendingPaymentMethod] = useState<string>("");

  const createMutation = useMutation({
    mutationFn: salesApi.create,
    onSuccess: (createdInvoice) => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["sales-approved"] });

      const paymentMethod = pendingPaymentMethod.toLowerCase();
      const isCreditPayment = paymentMethod === "credit";

      if (isCreditPayment) {
        // Credit payment - needs approval, stay on this page
        showSuccessToast("Sales order created. Credit payment requires approval.");
        state.setIsCreating(false);
        setLineItems([]);
        setFormStep(0);
        state.setFormData(emptyInvoiceForm);
        // Select the newly created invoice so it appears at the top
        state.setSelectedItem(createdInvoice as Invoice);
      } else {
        // Cash/Card/Cheque/Bank Transfer - auto-approved, go to payment dashboard
        showSuccessToast("Payment completed! Redirecting to payment dashboard...");
        state.setIsCreating(false);
        setLineItems([]);
        setFormStep(0);
        state.setFormData(emptyInvoiceForm);
        // Navigate to payment dashboard with the invoice number for highlighting
        const invoiceNo = (createdInvoice as any)?.invoice_no;
        navigate(`/sales/payments${invoiceNo ? `?invoice=${invoiceNo}` : ""}`);
      }
      setPendingPaymentMethod("");
    },
    onError: () => {
      showErrorToast("Failed to create sales order");
      setPendingPaymentMethod("");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => salesApi.update(id, data),
    onSuccess: (updatedInvoice) => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["sales-approved"] });

      const paymentMethod = pendingPaymentMethod.toLowerCase();
      const isCreditPayment = paymentMethod === "credit";

      if (isCreditPayment) {
        // Credit payment - needs approval after edit
        showSuccessToast("Sales order updated. Credit payment requires approval.");
      } else {
        // Cash/Card - completed status
        showSuccessToast("Sales order updated successfully.");
      }

      state.setIsCreating(false);
      state.setIsEditing(false);
      setLineItems([]);
      setFormStep(0);
      state.setFormData(emptyInvoiceForm);
      state.setSelectedItem(updatedInvoice as Invoice);
      setPendingPaymentMethod("");
    },
    onError: () => {
      showErrorToast("Failed to update sales order");
      setPendingPaymentMethod("");
    },
  });

  // Workflow mutations - Approve, Complete, Cancel
  const approveMutation = useMutation({
    mutationFn: salesApi.approve,
    onSuccess: (updatedInvoice) => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["sales-approved"] });
      showSuccessToast("Sales order approved successfully");
      state.setSelectedItem(updatedInvoice as Invoice);
    },
    onError: () => {
      showErrorToast("Failed to approve sales order");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: salesApi.cancel,
    onSuccess: (updatedInvoice) => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["sales-approved"] });
      showSuccessToast("Sales order cancelled and stock restored");
      state.setSelectedItem(updatedInvoice as Invoice);
    },
    onError: () => {
      showErrorToast("Failed to cancel sales order");
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
    setPaymentDetails({
      cheque_number: "",
      cheque_bank: "",
      cheque_date: new Date().toISOString().split('T')[0],
      card_ref_number: "",
      card_holder_name: "",
      bank_transfer_ref: "",
      bank_name: "",
      credit_note_id: 0,
      credit_note_amount: 0,
    });
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

  const handleEdit = () => {
    if (!state.selectedItem || !fullInvoice) return;

    // Prevent editing completed or cancelled orders
    if (state.selectedItem.approval_status === "completed" || state.selectedItem.approval_status === "cancelled") {
      return;
    }

    // Load invoice data into form
    state.setIsEditing(true);
    state.setIsCreating(false);
    setFormStep(0);
    setBarcodeInput("");
    setBarcodeError(null);
    setValidatedBarcodes([]);

    // Reset payment details - could be enhanced to load from related tables
    setPaymentDetails({
      cheque_number: "",
      cheque_bank: "",
      cheque_date: new Date().toISOString().split('T')[0],
      card_ref_number: "",
      card_holder_name: "",
      bank_transfer_ref: "",
      bank_name: "",
      credit_note_id: 0,
      credit_note_amount: 0,
    });

    // Set form data from selected invoice
    state.setFormData({
      invoice_no: state.selectedItem.invoice_no,
      branch_code: state.selectedItem.branch_code,
      customer_id: state.selectedItem.customer_id,
      sale_rep_id: state.selectedItem.sale_rep_id,
      payment_method: state.selectedItem.payment_method,
      cash_amount: state.selectedItem.cash_amount,
      card_visa_amount: state.selectedItem.card_visa_amount,
      card_mastercard_amount: state.selectedItem.card_mastercard_amount,
      card_amex_amount: state.selectedItem.card_amex_amount,
      cheque_amount: state.selectedItem.cheque_amount,
      bank_transfer_amount: state.selectedItem.bank_transfer_amount,
      credit_amount: state.selectedItem.credit_amount,
      payment_adjustments: state.selectedItem.payment_adjustments,
      remarks: state.selectedItem.remarks || "",
      special: state.selectedItem.special,
      items: [],
    });

    // Load existing line items
    const existingItems = fullInvoice.items.map((item: any) => ({
      product_id: item.product_id,
      quantity: item.quantity,
      selling_price: item.selling_price,
      minimum_selling_price: item.minimum_selling_price,
      warrenty_month: item.warrenty_month,
      branch_code: state.selectedItem!.branch_code,
      added_date: new Date().toISOString(),
    }));
    setLineItems(existingItems);
  };

  const handleSave = async () => {
    const subtotal = calculateLineItemsTotal();
    const paymentMethod = state.formData.payment_method || "cash";

    // Validate credit limit for credit sales (warning-only)
    if (paymentMethod === "credit" && state.formData.customer_id) {
      try {
        const creditCheck = await customersApi.checkCredit(
          state.formData.customer_id,
          subtotal,
          true
        );
        const requiresWarning =
          creditCheck.will_exceed_limit || creditCheck.overdue_count > 0;

        if (requiresWarning) {
          const customer = customers?.find(
            (c) => c.id === state.formData.customer_id
          );
          const customerName = customer?.customer_name || "Customer";
          const detailLines: { label: string; value: string; color?: string; strong?: boolean }[] = [
            { label: "Customer", value: customerName },
            { label: "Credit Limit", value: `Rs. ${Number(creditCheck.max_credit_limit || 0).toLocaleString()}` },
            { label: "Current Outstanding", value: `Rs. ${Number(creditCheck.current_outstanding || 0).toLocaleString()}` },
            { label: "Available Credit", value: `Rs. ${Number(creditCheck.available_credit || 0).toLocaleString()}` },
            { label: "This Order", value: `Rs. ${Number(creditCheck.new_credit_amount || 0).toLocaleString()}` },
          ];
          if (creditCheck.will_exceed_limit) {
            detailLines.push({
              label: "Exceeds by",
              value: `Rs. ${Number(creditCheck.excess_amount || 0).toLocaleString()}`,
              color: "error.main",
              strong: true,
            });
          }
          if (creditCheck.overdue_count > 0) {
            detailLines.push({
              label: "Overdue Invoices",
              value: String(creditCheck.overdue_count),
            });
          }

          const confirmed = await creditWarningDialog.confirm({
            title: creditCheck.will_exceed_limit
              ? "Credit Limit Warning"
              : "Credit Warning",
            message: "",
            detailsLines: detailLines,
            detailsNote: creditCheck.message ||
              "Customer credit status requires approval to proceed.",
            confirmText: "Continue Anyway",
            cancelText: "Cancel",
            type: "warning",
          });

          if (!confirmed) {
            return;
          }
        }
      } catch (error) {
        console.error("Credit check failed:", error);
        showErrorToast("Failed to check customer credit. Please try again.");
        return;
      }
    }

    // Calculate service charges for card payments
    let serviceCharge = 0;
    let total = subtotal;

    if (paymentMethod === "card_amex") {
      serviceCharge = subtotal * 0.03; // 3% for Amex
      total = subtotal + serviceCharge;
    } else if (paymentMethod === "card_visa" || paymentMethod === "card_mastercard") {
      serviceCharge = subtotal * 0.027; // 2.7% for Visa/Mastercard
      total = subtotal + serviceCharge;
    }

    const invoiceData: InvoiceCreate = {
      ...(state.formData as InvoiceCreate),
      cash_amount: paymentMethod === "cash" ? total : 0,
      card_visa_amount: paymentMethod === "card_visa" ? total : 0,
      card_mastercard_amount: paymentMethod === "card_mastercard" ? total : 0,
      card_amex_amount: paymentMethod === "card_amex" ? total : 0,
      cheque_amount: paymentMethod === "cheque" ? total : 0,
      bank_transfer_amount: paymentMethod === "bank_transfer" ? total : 0,
      credit_amount: paymentMethod === "credit" ? total : 0,
      // Include service charge in payment adjustments (for card payments)
      payment_adjustments: serviceCharge,
      items: lineItems,
      // Include payment details based on payment method
      ...(paymentMethod === "cheque" && {
        cheque_number: paymentDetails.cheque_number,
        cheque_bank: paymentDetails.cheque_bank,
        cheque_date: paymentDetails.cheque_date,
      }),
      ...(["card_visa", "card_mastercard", "card_amex"].includes(paymentMethod) && {
        card_ref_number: paymentDetails.card_ref_number,
        card_holder_name: paymentDetails.card_holder_name,
      }),
      ...(paymentMethod === "bank_transfer" && {
        bank_transfer_ref: paymentDetails.bank_transfer_ref,
        bank_name: paymentDetails.bank_name,
      }),
      ...(paymentMethod === "credit_note" && paymentDetails.credit_note_id && {
        credit_note_id: paymentDetails.credit_note_id,
      }),
    };

    // Store payment method for post-creation/update navigation
    setPendingPaymentMethod(paymentMethod);

    if (state.isEditing && state.selectedItem) {
      // Update existing invoice
      updateMutation.mutate({
        id: state.selectedItem.id,
        data: { items: lineItems }
      });
    } else {
      // Create new invoice
      createMutation.mutate(invoiceData);
    }
  };

  const handleCancel = () => {
    state.setIsCreating(false);
    state.setIsEditing(false);
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

    // Prevent selling price from going below minimum price
    if (field === 'selling_price') {
      const numValue = typeof value === 'number' ? value : parseFloat(value as string) || 0;
      const minPrice = updated[index].minimum_selling_price;
      if (numValue < minPrice) {
        showErrorToast(`Selling price cannot be less than minimum price (Rs. ${minPrice.toFixed(2)})`);
        return;
      }
    }

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

      // Check if item belongs to the selected branch
      const selectedBranch = state.formData.branch_code;
      if (stockItem.branch_code !== selectedBranch) {
        setBarcodeError(`This item belongs to branch ${stockItem.branch_code}, but you selected ${selectedBranch}`);
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
  }, [lineItems, products, state.formData.branch_code]);

  // Handle view invoice details
  const handleViewDetails = () => {
    if (state.selectedItem) {
      setSelectedInvoiceForView(state.selectedItem);
      setInvoiceDetailsOpen(true);
    }
  };

  // Custom actions for toolbar
  const customActions = state.selectedItem && !state.isCreating && !state.isEditing ? (
    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
      {/* Workflow Actions based on approval_status */}
      {canApprove && state.selectedItem.approval_status === "pending_approval" && (
        <Tooltip title="Approve Order">
          <IconButton
            size="small"
            color="success"
            onClick={() => approveDialog.open(
              "Approve Sales Order",
              `Approve invoice ${state.selectedItem?.invoice_no}? Stock will be marked as sold and order will be completed.`,
              () => approveMutation.mutate(state.selectedItem!.id)
            )}
            disabled={approveMutation.isPending}
          >
            <ApproveIcon />
          </IconButton>
        </Tooltip>
      )}
      {canDelete && state.selectedItem.approval_status !== "completed" && state.selectedItem.approval_status !== "cancelled" && (
        <Tooltip title="Cancel Order">
          <IconButton
            size="small"
            color="error"
            onClick={() => cancelDialog.open(
              "Cancel Sales Order",
              `Cancel invoice ${state.selectedItem?.invoice_no}? Stock will be restored to available.`,
              () => cancelMutation.mutate(state.selectedItem!.id)
            )}
            disabled={cancelMutation.isPending}
          >
            <CancelIcon />
          </IconButton>
        </Tooltip>
      )}

      {/* Standard Actions */}
      <Button
        size="small"
        variant="outlined"
        startIcon={<EditIcon />}
        onClick={handleEdit}
        disabled={state.selectedItem.approval_status === "completed" || state.selectedItem.approval_status === "cancelled"}
      >
        Edit
      </Button>
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
                      <strong>Subtotal:</strong>
                    </TableCell>
                    <TableCell align="right">
                      <strong>{(fullInvoice.items.reduce((sum: number, item: any) => sum + (item.quantity * item.selling_price), 0) || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                    </TableCell>
                  </TableRow>
                  {/* Service Charge Row - Only for card payments */}
                  {(fullInvoice.payment_method === "card_amex" ||
                    fullInvoice.payment_method === "card_visa" ||
                    fullInvoice.payment_method === "card_mastercard") &&
                    fullInvoice.service_charge_amount > 0 && (
                      <TableRow sx={{ bgcolor: "warning.lighter" }}>
                        <TableCell colSpan={5} align="right">
                          <Typography fontWeight="medium" color="warning.dark">
                            Service Charge ({fullInvoice.service_charge_rate}%):
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography fontWeight="medium" color="warning.dark">
                            {fullInvoice.service_charge_amount.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  <TableRow sx={{ bgcolor: "success.lighter" }}>
                    <TableCell colSpan={5} align="right">
                      <Typography fontWeight="bold" fontSize="1.1rem" color="success.dark">
                        Grand Total:
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography fontWeight="bold" fontSize="1.1rem" color="success.dark">
                        {((fullInvoice.items.reduce((sum: number, item: any) => sum + (item.quantity * item.selling_price), 0) || 0) + (fullInvoice.service_charge_amount || 0)).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Typography>
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
          </FormSection>

          {/* Customer Credit Information Panel */}
          {customerCreditStatus && (state.formData.customer_id || 0) > 0 && (
            <Box sx={{
              p: 2,
              mb: 2,
              borderRadius: 1,
              bgcolor: customerCreditStatus.available_credit <= 0 ? "error.lighter" :
                customerCreditStatus.available_credit < customerCreditStatus.max_credit_limit * 0.2 ? "warning.lighter" :
                  "success.lighter",
              border: 1,
              borderColor: customerCreditStatus.available_credit <= 0 ? "error.light" :
                customerCreditStatus.available_credit < customerCreditStatus.max_credit_limit * 0.2 ? "warning.light" :
                  "success.light"
            }}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                Customer Credit Information
              </Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 2 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary">Credit Limit</Typography>
                  <Typography variant="body2" fontWeight={500}>
                    Rs. {customerCreditStatus.max_credit_limit?.toLocaleString() || 0}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Outstanding</Typography>
                  <Typography variant="body2" fontWeight={500} color="error.main">
                    Rs. {customerCreditStatus.outstanding_credit?.toLocaleString() || 0}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Available Credit</Typography>
                  <Typography variant="body2" fontWeight={500} color={customerCreditStatus.available_credit > 0 ? "success.main" : "error.main"}>
                    Rs. {customerCreditStatus.available_credit?.toLocaleString() || 0}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Credit Terms</Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {customerCreditStatus.credit_days || 0} days
                  </Typography>
                </Box>
              </Box>
              {customerCreditStatus.overdue_count > 0 && (
                <Box sx={{ mt: 1, p: 1, bgcolor: "error.light", borderRadius: 1 }}>
                  <Typography variant="caption" color="error.contrastText">
                    ⚠️ {customerCreditStatus.overdue_count} overdue invoice(s) - Rs. {customerCreditStatus.total_overdue_amount?.toLocaleString()}
                  </Typography>
                </Box>
              )}
            </Box>
          )}

          {/* Recent Customer Sales Panel */}
          {(state.formData.customer_id || 0) > 0 && (
            <Box sx={{
              p: 2,
              mb: 2,
              borderRadius: 1,
              bgcolor: "background.paper",
              border: 1,
              borderColor: "divider"
            }}>
              <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
                Recent Sales History (Last 5 from All Branches)
              </Typography>
              {loadingRecentSales ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : recentCustomerSales && recentCustomerSales.length > 0 ? (
                <Table size="small" sx={{ ...modernTableStyles }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Invoice #</TableCell>
                      <TableCell>Branch</TableCell>
                      <TableCell>Date</TableCell>
                      <TableCell>Payment</TableCell>
                      <TableCell align="right">Total</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {recentCustomerSales.map((sale) => (
                      <TableRow
                        key={sale.id}
                        hover
                        onClick={() => {
                          setSelectedInvoiceForView(sale);
                          setInvoiceDetailsOpen(true);
                        }}
                        sx={{ cursor: "pointer" }}
                      >
                        <TableCell>
                          <Typography variant="body2" fontWeight={500} color="primary">
                            {sale.invoice_no}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip label={sale.branch_code} size="small" variant="outlined" />
                        </TableCell>
                        <TableCell>
                          {format(new Date(sale.created_date), "dd/MM/yyyy")}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={sale.payment_method?.replace(/_/g, " ").toUpperCase()}
                            size="small"
                            color={sale.payment_method === "cash" ? "success" : "default"}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" fontWeight={500}>
                            Rs. {(sale.grand_total || (
                              sale.cash_amount +
                              sale.card_visa_amount +
                              sale.card_mastercard_amount +
                              sale.card_amex_amount +
                              sale.cheque_amount +
                              sale.bank_transfer_amount +
                              sale.credit_amount
                            ))?.toLocaleString()}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <TStatusChip
                            status={sale.approval_status || "pending_approval"}
                            statusMap="invoice"
                            size="small"
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", py: 2 }}>
                  No previous sales records found for this customer
                </Typography>
              )}
            </Box>
          )}

          <FormSection title="Payment Details" columns={1}>
            <TextField
              label="Payment Method"
              size="small"
              select
              value={state.formData.payment_method}
              onChange={(e) => {
                state.setFormData({ ...state.formData, payment_method: e.target.value });
                // Reset payment details when method changes
                setPaymentDetails({
                  cheque_number: "",
                  cheque_bank: "",
                  cheque_date: new Date().toISOString().split('T')[0],
                  card_ref_number: "",
                  card_holder_name: "",
                  bank_transfer_ref: "",
                  bank_name: "",
                  credit_note_id: 0,
                  credit_note_amount: 0,
                });
              }}
            >
              {CUSTOMER_PAYMENT_METHOD.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </TextField>
          </FormSection>

          {/* Payment Details Section - Based on selected payment method */}
          {state.formData.payment_method === "cheque" && (
            <FormSection title="Cheque Details" columns={3}>
              <TextField
                label="Cheque Number"
                size="small"
                value={paymentDetails.cheque_number}
                onChange={(e) => setPaymentDetails({ ...paymentDetails, cheque_number: e.target.value })}
                required
              />
              <TextField
                label="Bank Name"
                size="small"
                value={paymentDetails.cheque_bank}
                onChange={(e) => setPaymentDetails({ ...paymentDetails, cheque_bank: e.target.value })}
                required
              />
              <TextField
                label="Cheque Date"
                size="small"
                type="date"
                value={paymentDetails.cheque_date}
                onChange={(e) => setPaymentDetails({ ...paymentDetails, cheque_date: e.target.value })}
                InputLabelProps={{ shrink: true }}
                required
              />
            </FormSection>
          )}

          {(state.formData.payment_method === "card_visa" ||
            state.formData.payment_method === "card_mastercard" ||
            state.formData.payment_method === "card_amex") && (
              <FormSection title="Card Payment Details" columns={2}>
                <TextField
                  label="Card Reference Number"
                  size="small"
                  value={paymentDetails.card_ref_number}
                  onChange={(e) => setPaymentDetails({ ...paymentDetails, card_ref_number: e.target.value })}
                  placeholder="Transaction/Approval code"
                />
                <TextField
                  label="Card Holder Name"
                  size="small"
                  value={paymentDetails.card_holder_name}
                  onChange={(e) => setPaymentDetails({ ...paymentDetails, card_holder_name: e.target.value })}
                />
                <Box sx={{ gridColumn: "span 2", p: 1.5, bgcolor: "warning.lighter", borderRadius: 1 }}>
                  <Typography variant="body2" color="warning.dark">
                    <strong>Service Charge:</strong>{" "}
                    {state.formData.payment_method === "card_amex" ? "3.0%" : "2.7%"} will be applied to the total amount
                  </Typography>
                </Box>
              </FormSection>
            )}

          {state.formData.payment_method === "bank_transfer" && (
            <FormSection title="Bank Transfer Details" columns={2}>
              <TextField
                label="Bank Name"
                size="small"
                value={paymentDetails.bank_name}
                onChange={(e) => setPaymentDetails({ ...paymentDetails, bank_name: e.target.value })}
                required
              />
              <TextField
                label="Reference Number"
                size="small"
                value={paymentDetails.bank_transfer_ref}
                onChange={(e) => setPaymentDetails({ ...paymentDetails, bank_transfer_ref: e.target.value })}
                placeholder="Bank transfer reference"
                required
              />
            </FormSection>
          )}

          {state.formData.payment_method === "credit_note" && (
            <FormSection title="Credit Note Details" columns={1}>
              {customerCreditNotes && customerCreditNotes.length > 0 ? (
                <>
                  <TextField
                    select
                    label="Select Credit Note"
                    size="small"
                    value={paymentDetails.credit_note_id || ""}
                    onChange={(e) => {
                      const selectedNote = customerCreditNotes.find(
                        (cn: any) => cn.id === Number(e.target.value)
                      );
                      setPaymentDetails({
                        ...paymentDetails,
                        credit_note_id: Number(e.target.value),
                        credit_note_amount: selectedNote?.amount || 0,
                      });
                    }}
                    required
                  >
                    {customerCreditNotes.map((creditNote: any) => (
                      <MenuItem key={creditNote.id} value={creditNote.id}>
                        {creditNote.credit_note_no} - Rs. {creditNote.amount?.toLocaleString()} (Balance: Rs. {creditNote.balance?.toLocaleString()})
                      </MenuItem>
                    ))}
                  </TextField>
                  {paymentDetails.credit_note_id > 0 && (
                    <Box sx={{ p: 2, bgcolor: "success.lighter", borderRadius: 1, mt: 1 }}>
                      <Typography variant="body2" color="success.dark">
                        Available Credit: Rs. {paymentDetails.credit_note_amount.toLocaleString()}
                      </Typography>
                    </Box>
                  )}
                </>
              ) : (
                <Box sx={{ p: 2, bgcolor: "warning.lighter", borderRadius: 1 }}>
                  <Typography variant="body2" color="warning.dark">
                    No credit notes available for this customer. Please select a different payment method.
                  </Typography>
                </Box>
              )}
            </FormSection>
          )}

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
                            inputProps={{ min: item.minimum_selling_price, step: 0.01 }}
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
                      <Typography fontWeight="bold">Subtotal:</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography fontWeight="bold">
                        {calculateLineItemsTotal().toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Typography>
                    </TableCell>
                    <TableCell />
                  </TableRow>
                  {/* Service Charge Row - Only for card payments */}
                  {(state.formData.payment_method === "card_amex" ||
                    state.formData.payment_method === "card_visa" ||
                    state.formData.payment_method === "card_mastercard") && (
                      <TableRow sx={{ bgcolor: "warning.lighter" }}>
                        <TableCell colSpan={7} align="right">
                          <Typography fontWeight="medium" color="warning.dark">
                            Service Charge ({state.formData.payment_method === "card_amex" ? "3.0%" : "2.7%"}):
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography fontWeight="medium" color="warning.dark">
                            {(calculateLineItemsTotal() * (state.formData.payment_method === "card_amex" ? 0.03 : 0.027)).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </Typography>
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    )}
                  {/* Grand Total Row */}
                  <TableRow sx={{ bgcolor: "primary.lighter" }}>
                    <TableCell colSpan={7} align="right">
                      <Typography fontWeight="bold" color="primary.main">Grand Total:</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography fontWeight="bold" color="primary.main" fontSize="1.1rem">
                        {(() => {
                          const subtotal = calculateLineItemsTotal();
                          let serviceCharge = 0;
                          if (state.formData.payment_method === "card_amex") {
                            serviceCharge = subtotal * 0.03;
                          } else if (state.formData.payment_method === "card_visa" || state.formData.payment_method === "card_mastercard") {
                            serviceCharge = subtotal * 0.027;
                          }
                          return (subtotal + serviceCharge).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                        })()}
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
              disabled={
                createMutation.isPending ||
                updateMutation.isPending ||
                lineItems.length === 0 ||
                lineItems.some(item => item.selling_price < item.minimum_selling_price)
              }
              startIcon={(createMutation.isPending || updateMutation.isPending) ? <CircularProgress size={20} /> : null}
            >
              {(createMutation.isPending || updateMutation.isPending) ? "Saving..." : state.isEditing ? "Update Order" : "Save Order"}
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
            searchPlaceholder="Search by invoice no, customer name..."
            sortOptions={sortOptions}
            currentSort={state.sortField}
            onSortChange={state.setSortField}
            isLoading={isLoading}
            emptyMessage="No sales orders found"
            listHeader={
              <SalesFilterPanel
                statusOptions={INVOICE_STATUS_OPTIONS}
                statusValue={filterStatus}
                onStatusChange={setFilterStatus}
                branches={branches}
                branchValue={filterBranch}
                onBranchChange={setFilterBranch}
              />
            }
          >
            {filteredInvoices.map((invoice) => {
              const isSelected = state.selectedItem?.id === invoice.id;
              const customer = customers?.find((c) => c.id === invoice.customer_id);
              const customerName = customer?.customer_name || "Unknown Customer";
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
                          sx={{ color: "text.primary" }}
                        >
                          Rs. {calculateTotal(invoice).toFixed(2)}
                        </Typography>
                        {isSelected && (
                          <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                            (Total)
                          </Typography>
                        )}
                      </Box>
                      {/* Date & Customer Name - only when selected */}
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
                              {customerName}
                            </Typography>
                            <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                              (Customer)
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
                            <TStatusChip
                              status={invoice.approval_status || "pending_approval"}
                              statusMap="invoice"
                              size="small"
                              sx={{ height: 18, fontSize: "0.65rem" }}
                            />
                          </Box>
                        </>
                      )}
                    </Box>
                  }
                  secondaryText={!isSelected ? `${format(new Date(invoice.created_date), "MMM dd, yyyy")} • ${customerName}` : undefined}
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
              canDelete={canDelete && state.selectedItem?.approval_status !== "completed"}
              canUpdate={canUpdate && state.selectedItem?.approval_status !== "completed"}
              isEditing={state.isEditing}
              isCreating={state.isCreating}
              hasSelection={!!state.selectedItem}
              onAdd={handleCreate}
              onDelete={handleDelete}
              onSave={handleSave}
              onCancel={handleCancel}
              isSaving={createMutation.isPending || updateMutation.isPending}
              saveDisabled={!state.formData.invoice_no || lineItems.length === 0 || formStep !== 1}
              customActions={customActions}
            />

            <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
              {!state.selectedItem && !state.isCreating && !state.isEditing ? (
                <EmptyState message="Select a sales order from the list or create a new one" />
              ) : state.isCreating || state.isEditing ? (
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
      <TConfirmDialog {...approveDialog.dialogProps} confirmText="Approve" confirmColor="success" />
      <TConfirmDialog {...cancelDialog.dialogProps} confirmText="Cancel Order" confirmColor="error" />
      <TConfirmDialog {...creditWarningDialog.dialogProps} />

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
