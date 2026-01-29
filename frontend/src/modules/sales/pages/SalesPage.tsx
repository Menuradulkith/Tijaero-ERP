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
import { customersApi, couponsApi, vouchersApi } from "@/modules/customers/api";
import { CouponValidationResponse, VoucherValidationResponse } from "@/modules/customers/types";
import { creditNotesApi } from "@/modules/finance/api";
import { paymentCardsApi } from "../api";
import { PaymentCard } from "../types";
import {
  Add as AddIcon,
  Cancel as CancelIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  MenuBook as MenuBookIcon,
  Print as PrintIcon,
  Receipt as ReceiptIcon,
  ThumbUp as ApproveIcon,
  LocalOffer as CouponIcon,
  Percent as PercentIcon,
  AttachMoney as MoneyIcon,
  AccountBalance as TaxIcon,
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
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// import { useNavigate } from "react-router-dom";
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
  discount_percent?: number; // Individual item discount percentage
  discount_amount?: number; // Calculated discount amount
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
  // const navigate = useNavigate();

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

  // Coupon/Discount code state
  const [couponCode, setCouponCode] = useState("");
  const [isValidatingCoupon, setIsValidatingCoupon] = useState(false);
  const [couponValidation, setCouponValidation] = useState<CouponValidationResponse | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  // Gift Voucher payment state - Support multiple vouchers
  const [voucherCode, setVoucherCode] = useState("");
  const [isValidatingVoucher, setIsValidatingVoucher] = useState(false);
  const [appliedVouchers, setAppliedVouchers] = useState<Array<{
    validation: VoucherValidationResponse;
    amountToRedeem: number;
  }>>([]);
  const [voucherError, setVoucherError] = useState<string | null>(null);

  // Credit Note state
  const [creditNoteAmount, setCreditNoteAmount] = useState(0);
  const [availableCreditBalance, setAvailableCreditBalance] = useState(0);
  const [isLoadingCreditBalance, setIsLoadingCreditBalance] = useState(false);

  // Payment card state - for card payment method
  const [selectedPaymentCardId, setSelectedPaymentCardId] = useState<number | null>(null);

  // Fetch active payment cards from settings
  const { data: paymentCards = [] } = useQuery({
    queryKey: ["payment-cards-active"],
    queryFn: () => paymentCardsApi.getAll(true), // Only active cards
  });

  // Get selected payment card details
  const selectedPaymentCard = useMemo(() => {
    if (!selectedPaymentCardId) return null;
    return paymentCards.find((card: PaymentCard) => card.id === selectedPaymentCardId) || null;
  }, [selectedPaymentCardId, paymentCards]);

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

  // Invoice-level discount and tax state
  const [discountType, setDiscountType] = useState<"percent" | "amount">("percent");
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [taxRate, setTaxRate] = useState<number>(0); // Tax rate percentage (e.g., 8 for 8% VAT)

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

  // Fetch customer credit balance
  useEffect(() => {
    const fetchCreditBalance = async () => {
      if (!selectedCustomerId || selectedCustomerId <= 0) {
        setAvailableCreditBalance(0);
        return;
      }
      
      setIsLoadingCreditBalance(true);
      try {
        const response = await fetch(`/api/v1/finance/customers/${selectedCustomerId}/credit-balance`);
        const data = await response.json();
        setAvailableCreditBalance(data.available_credit_balance || 0);
      } catch (error) {
        console.error("Error fetching credit balance:", error);
        setAvailableCreditBalance(0);
      } finally {
        setIsLoadingCreditBalance(false);
      }
    };

    fetchCreditBalance();
  }, [selectedCustomerId]);

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

  // Calculate line items total (after individual item discounts)
  const calculateLineItemsTotal = () => {
    return lineItems.reduce((sum, item) => {
      const lineTotal = item.quantity * item.selling_price;
      const itemDiscount = lineTotal * ((item.discount_percent || 0) / 100);
      return sum + (lineTotal - itemDiscount);
    }, 0);
  };

  // Calculate total item discounts
  const calculateTotalItemDiscounts = () => {
    return lineItems.reduce((sum, item) => {
      const lineTotal = item.quantity * item.selling_price;
      const itemDiscount = lineTotal * ((item.discount_percent || 0) / 100);
      return sum + itemDiscount;
    }, 0);
  };

  // Calculate gross total (before any discounts)
  const calculateGrossTotal = () => {
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
      // Invalidate the specific invoice detail query
      if (createdInvoice?.id) {
        queryClient.invalidateQueries({ queryKey: ["sales", createdInvoice.id] });
      }

      const paymentMethod = pendingPaymentMethod.toLowerCase();
      const isCreditPayment = paymentMethod === "credit";

      if (isCreditPayment) {
        // Credit payment - needs approval, stay on this page
        showSuccessToast("Sales order created. Credit payment requires approval.");
      } else {
        // Cash/Card/Cheque/Bank Transfer - auto-approved
        showSuccessToast("Sales order created and payment completed successfully.");
      }

      state.setIsCreating(false);
      setLineItems([]);
      setFormStep(0);
      state.setFormData(emptyInvoiceForm);
      // Reset discount and tax state
      setDiscountType("percent");
      setDiscountValue(0);
      setTaxRate(0);
      // Reset coupon and voucher state
      setCouponCode("");
      setCouponValidation(null);
      setAppliedVouchers([]);
      // Select the newly created invoice so it appears at the top
      state.setSelectedItem(createdInvoice as Invoice);
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
      // Invalidate the specific invoice detail query
      if (state.selectedItem?.id) {
        queryClient.invalidateQueries({ queryKey: ["sales", state.selectedItem.id] });
      }

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
    // Reset coupon state
    setCouponCode("");
    setCouponValidation(null);
    setCouponError(null);
    // Reset voucher state
    setVoucherCode("");
    setAppliedVouchers([]);
    setVoucherError(null);
    // Reset credit note state
    setCreditNoteAmount(0);
    // Reset discount and tax state
    setDiscountType("percent");
    setDiscountValue(0);
    setTaxRate(0);
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
    // Reset coupon state when editing
    setCouponCode("");
    setCouponValidation(null);
    setCouponError(null);
    // Reset voucher state when editing
    setVoucherCode("");
    setAppliedVouchers([]);
    setVoucherError(null);

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
    // Validate that all selling prices are not below minimum prices
    const invalidItems = lineItems.filter(item => item.selling_price < item.minimum_selling_price);
    if (invalidItems.length > 0) {
      showErrorToast("Cannot save: Some items have selling price below minimum price");
      return;
    }

    // Calculate effective price per item after all discounts (item discount + invoice discount + coupon)
    // and validate that no item goes below minimum price
    // New Flow: Item Discount → Invoice Discount → Coupon → Tax → Voucher → Service Charge
    const subtotalAfterItemDiscounts = calculateLineItemsTotal();
    
    // Calculate invoice discount percentage on subtotal after item discounts
    const invoiceDiscountPercent = discountType === "percent" ? discountValue : 
      (subtotalAfterItemDiscounts > 0 ? (discountValue / subtotalAfterItemDiscounts) * 100 : 0);
    
    // Calculate amount after invoice discount for coupon percentage calculation
    const afterInvoiceDiscount = subtotalAfterItemDiscounts * (1 - invoiceDiscountPercent / 100);
    const validationCouponDiscount = couponValidation?.calculated_discount || 0;
    const couponDiscountPercent = afterInvoiceDiscount > 0 ? (validationCouponDiscount / afterInvoiceDiscount) * 100 : 0;
    
    // Check each item's effective price after all discounts
    const invalidDiscountItems = lineItems.filter(item => {
      const itemDiscountPercent = item.discount_percent || 0;
      
      // Step 1: Apply item discount
      const priceAfterItemDiscount = item.selling_price * (1 - itemDiscountPercent / 100);
      
      // Step 2: Apply invoice discount (proportionally)
      const priceAfterInvoiceDiscount = priceAfterItemDiscount * (1 - invoiceDiscountPercent / 100);
      
      // Step 3: Apply coupon discount (proportionally)
      const effectivePrice = priceAfterInvoiceDiscount * (1 - couponDiscountPercent / 100);
      
      return effectivePrice < item.minimum_selling_price;
    });
    
    if (invalidDiscountItems.length > 0) {
      const itemNames = invalidDiscountItems.map(item => item.product_name || `Product #${item.product_id}`).join(", ");
      showErrorToast(`Cannot save: Total discounts bring ${invalidDiscountItems.length} item(s) below minimum price: ${itemNames}`);
      return;
    }

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

    // Calculate all adjustments following the flow:
    // 1. Subtotal (after item discounts)
    // 2. Invoice Discount (-)
    // 3. Coupon Discount (-)
    // 4. Tax (+)
    // 5. Voucher Payment (-)
    // 6. Service Charge (+)
    // 7. Grand Total
    
    // Invoice discount (percentage or fixed amount) - applied first on subtotal
    const invoiceDiscount = discountType === "percent" 
      ? subtotal * (discountValue / 100)
      : discountValue;
    const afterInvoiceDiscountCalc = subtotal - invoiceDiscount;
    
    // Coupon discount - applied after invoice discount
    const couponDiscount = couponValidation?.calculated_discount || 0;
    const afterDiscount = afterInvoiceDiscountCalc - couponDiscount;
    
    // Tax calculation
    const taxAmount = afterDiscount * (taxRate / 100);
    const afterTax = afterDiscount + taxAmount;
    
    // Total voucher payment from all applied vouchers
    const totalVoucherPayment = appliedVouchers.reduce((sum, v) => sum + Number(v.amountToRedeem), 0);
    const afterVoucher = afterTax - totalVoucherPayment;
    
    // Credit note redemption (limited to available balance and remaining amount)
    const appliedCreditNote = Math.min(creditNoteAmount, availableCreditBalance, Math.max(0, afterVoucher));
    const afterCreditNote = afterVoucher - appliedCreditNote;
    
    // Service charge for card payments (on remaining amount after credit note)
    // Uses the service charge percentage from the selected payment card
    let serviceCharge = 0;
    if (paymentMethod === "card" && selectedPaymentCard) {
      const chargePercent = selectedPaymentCard.service_charge_percent || 0;
      serviceCharge = afterCreditNote * (chargePercent / 100);
    }

    // Final amount to pay (remaining balance)
    const grandTotal = Math.max(0, afterCreditNote + serviceCharge);

    const invoiceData: InvoiceCreate = {
      ...(state.formData as InvoiceCreate),
      cash_amount: paymentMethod === "cash" ? grandTotal : 0,
      card_visa_amount: paymentMethod === "card" ? grandTotal : 0, // Use card_visa_amount for generic card payment
      card_mastercard_amount: 0,
      card_amex_amount: 0,
      cheque_amount: paymentMethod === "cheque" ? grandTotal : 0,
      bank_transfer_amount: paymentMethod === "bank_transfer" ? grandTotal : 0,
      credit_amount: paymentMethod === "credit" ? grandTotal : 0,
      // Include service charge in payment adjustments (for card payments)
      payment_adjustments: serviceCharge,
      items: lineItems,
      // Tax and Discount fields
      tax_rate: taxRate,
      discount_percent: discountType === "percent" ? discountValue : 0,
      discount_amount: discountType === "amount" ? discountValue : invoiceDiscount, // Store calculated amount
      // Coupon/Discount code fields
      ...(couponValidation?.coupon_id && {
        cupon_id: couponValidation.coupon_id,
        cupon_amount: couponDiscount,
      }),
      // Credit note redemption
      credit_note_amount: appliedCreditNote,
      // Gift voucher payment fields - send as array for multiple vouchers
      ...(appliedVouchers.length > 0 && totalVoucherPayment > 0 && {
        gift_voucher_id: appliedVouchers[0].validation.voucher_id, // Legacy field
        gift_voucher_amount: totalVoucherPayment, // Total from all vouchers
        voucher_redemptions: appliedVouchers
          .filter(v => v.validation.voucher_id) // Ensure voucher_id exists
          .map(v => ({
            voucher_id: v.validation.voucher_id!,
            amount_to_redeem: Number(v.amountToRedeem)
          }))
      }),
      // Include payment details based on payment method
      ...(paymentMethod === "cheque" && {
        cheque_number: paymentDetails.cheque_number,
        cheque_bank: paymentDetails.cheque_bank,
        cheque_date: paymentDetails.cheque_date,
      }),
      ...(paymentMethod === "card" && selectedPaymentCard && {
        card_ref_number: paymentDetails.card_ref_number,
        card_holder_name: paymentDetails.card_holder_name,
        payment_card_id: selectedPaymentCard.id, // Include selected card ID
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
    // Reset coupon state
    setCouponCode("");
    setCouponValidation(null);
    setCouponError(null);
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

      // Check if item belongs to the selected branch
      const selectedBranch = state.formData.branch_code;
      if (stockItem.branch_code !== selectedBranch) {
        setBarcodeError(`This item belongs to branch ${stockItem.branch_code}, but you selected ${selectedBranch}`);
        return;
      }

      // Get prices from product relationship or top-level fields
      const sellingPrice = stockItem.selling_price || stockItem.product?.selling_price || 0;
      const minimumPrice = stockItem.minimum_price || stockItem.product?.minimum_price || sellingPrice;
      const warrantyMonths = stockItem.warranty_month || stockItem.product?.warrenty_month || "0";
      const productName = stockItem.product_name || stockItem.product?.product_name || stockItem.product?.name || "";

      // Add to line items
      const newItem: ItemFormData = {
        product_id: stockItem.product_id,
        quantity: 1,
        selling_price: sellingPrice,
        minimum_selling_price: minimumPrice,
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

  // Coupon validation handler
  const handleValidateCoupon = useCallback(async () => {
    if (!couponCode.trim()) {
      setCouponError("Please enter a coupon code");
      return;
    }

    if (!state.formData.customer_id) {
      setCouponError("Please select a customer first");
      return;
    }

    setIsValidatingCoupon(true);
    setCouponError(null);

    try {
      const subtotal = calculateLineItemsTotal();
      const productIds = lineItems.map(item => item.product_id);

      const response = await couponsApi.validate({
        coupon_code: couponCode.trim(),
        customer_id: state.formData.customer_id,
        invoice_subtotal: subtotal,
        invoice_discount_type: discountType,
        invoice_discount_value: discountValue,
        product_ids: productIds,
        line_items: lineItems.map(item => ({
          product_id: item.product_id,
          quantity: item.quantity,
          selling_price: item.selling_price,
        })),
      });

      if (response.valid) {
        setCouponValidation(response);
        showSuccessToast(`Coupon applied! Discount: Rs. ${(response.calculated_discount || 0).toLocaleString()}`);
      } else {
        setCouponError(response.message);
        setCouponValidation(null);
      }
    } catch (error: any) {
      console.error("Coupon validation error:", error);
      setCouponError(error.response?.data?.detail || "Failed to validate coupon");
      setCouponValidation(null);
    } finally {
      setIsValidatingCoupon(false);
    }
  }, [couponCode, state.formData.customer_id, lineItems]);

  // Clear coupon
  const handleClearCoupon = () => {
    setCouponCode("");
    setCouponValidation(null);
    setCouponError(null);
  };

  // Gift Voucher validation handler
  const handleValidateVoucher = useCallback(async () => {
    if (!voucherCode.trim()) {
      setVoucherError("Please enter a voucher code");
      return;
    }

    setIsValidatingVoucher(true);
    setVoucherError(null);

    try {
      // Calculate amount due after coupon discount AND previously applied vouchers
      const subtotal = calculateLineItemsTotal();
      const couponDiscount = couponValidation?.calculated_discount || 0;
      const previousVouchersTotal = appliedVouchers.reduce((sum, v) => sum + Number(v.amountToRedeem), 0);
      const amountDue = subtotal - couponDiscount - previousVouchersTotal;

      const response = await vouchersApi.validate({
        barcode_no: voucherCode.trim(),
        invoice_amount_due: amountDue,
      });

      if (response.valid) {
        // Check if this voucher is already applied
        const alreadyApplied = appliedVouchers.some(v => v.validation.voucher_id === response.voucher_id);
        if (alreadyApplied) {
          setVoucherError("This voucher has already been applied");
          showErrorToast("This voucher has already been applied");
        } else {
          // Add voucher to the list
          setAppliedVouchers(prev => [...prev, {
            validation: response,
            amountToRedeem: Number(response.redeemable_amount) || 0
          }]);
          setVoucherCode(""); // Clear input for next voucher
          showSuccessToast(`Voucher added! Balance: Rs. ${(response.balance || 0).toLocaleString()}`);
        }
      } else {
        setVoucherError(response.message);
      }
    } catch (error: any) {
      console.error("Voucher validation error:", error);
      setVoucherError(error.response?.data?.detail || "Failed to validate voucher");
    } finally {
      setIsValidatingVoucher(false);
    }
  }, [voucherCode, lineItems, couponValidation, appliedVouchers]);

  // Remove a specific voucher
  const handleRemoveVoucher = (voucherId: number) => {
    setAppliedVouchers(prev => prev.filter(v => v.validation.voucher_id !== voucherId));
  };

  // Clear all vouchers
  const handleClearAllVouchers = () => {
    setVoucherCode("");
    setAppliedVouchers([]);
    setVoucherError(null);
  };

  // Auto-revalidate coupon when line items change (with debouncing)
  useEffect(() => {
    if (!couponValidation || !couponCode || lineItems.length === 0 || !state.formData.customer_id) {
      if (couponValidation && lineItems.length === 0) {
        // Clear coupon if all items removed
        setCouponValidation(null);
        setCouponError("No items in invoice");
      }
      return;
    }

    // Debounce the revalidation to avoid excessive API calls
    const timeoutId = setTimeout(async () => {
      try {
        const subtotal = calculateLineItemsTotal();
        const productIds = lineItems.map(item => item.product_id);

        const response = await couponsApi.validate({
          coupon_code: couponCode.trim(),
          customer_id: state.formData.customer_id!,
          invoice_subtotal: subtotal,
          invoice_discount_type: discountType,
          invoice_discount_value: discountValue,
          product_ids: productIds,
          line_items: lineItems.map(item => ({
            product_id: item.product_id,
            quantity: item.quantity,
            selling_price: item.selling_price,
          })),
        });

        if (response.valid) {
          setCouponValidation(response);
          setCouponError(null);
        } else {
          // Coupon is no longer valid, clear it
          setCouponValidation(null);
          setCouponError(response.message);
          showErrorToast(`Coupon no longer valid: ${response.message}`);
        }
      } catch (error: any) {
        console.error("Coupon revalidation error:", error);
        setCouponValidation(null);
        setCouponError("Coupon validation failed");
      }
    }, 500); // Wait 500ms after last change before revalidating

    return () => clearTimeout(timeoutId);
  }, [lineItems.length, couponCode, state.formData.customer_id, discountType, discountValue]); // Revalidate when discount changes

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
        <FormSection title="Dates & Payment" columns={2}>
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
                  {/* Coupon Discount Row */}
                  {fullInvoice.cupon_amount > 0 && (
                    <TableRow sx={{ bgcolor: "success.lighter" }}>
                      <TableCell colSpan={5} align="right">
                        <Typography fontWeight="medium" color="success.dark">
                          Coupon Discount:
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography fontWeight="medium" color="success.dark">
                          -{fullInvoice.cupon_amount.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                  {/* Invoice Discount Row */}
                  {fullInvoice.discount_amount > 0 && (
                    <TableRow sx={{ bgcolor: "warning.lighter" }}>
                      <TableCell colSpan={5} align="right">
                        <Typography fontWeight="medium" color="warning.dark">
                          Invoice Discount{fullInvoice.discount_percent > 0 ? ` (${fullInvoice.discount_percent}%)` : ""}:
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography fontWeight="medium" color="warning.dark">
                          -{fullInvoice.discount_amount.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                  {/* Tax Row */}
                  {fullInvoice.tax_amount > 0 && (
                    <TableRow sx={{ bgcolor: "info.lighter" }}>
                      <TableCell colSpan={5} align="right">
                        <Typography fontWeight="medium" color="info.dark">
                          Tax ({fullInvoice.tax_rate}%):
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography fontWeight="medium" color="info.dark">
                          +{fullInvoice.tax_amount.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                  {/* Gift Voucher Payment Row */}
                  {fullInvoice.gift_voucher_amount > 0 && (
                    <TableRow sx={{ bgcolor: "secondary.lighter" }}>
                      <TableCell colSpan={5} align="right">
                        <Typography fontWeight="medium" color="secondary.dark">
                          Voucher Payment:
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography fontWeight="medium" color="secondary.dark">
                          -{fullInvoice.gift_voucher_amount.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                  {/* Service Charge Row - Only for card payments */}
                  {fullInvoice.payment_method === "card" &&
                    fullInvoice.service_charge_amount > 0 && (
                      <TableRow sx={{ bgcolor: "grey.100" }}>
                        <TableCell colSpan={5} align="right">
                          <Typography fontWeight="medium" color="text.secondary">
                            Service Charge ({(fullInvoice.service_charge_rate * 100).toFixed(1)}%):
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography fontWeight="medium" color="text.secondary">
                            +{fullInvoice.service_charge_amount.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  <TableRow sx={{ bgcolor: "success.lighter" }}>
                    <TableCell colSpan={5} align="right">
                      <Typography fontWeight="bold" fontSize="1.1rem" color="success.dark">
                        Grand Total (Amount Paid):
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography fontWeight="bold" fontSize="1.1rem" color="success.dark">
                        {(fullInvoice.grand_total || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Typography>
                    </TableCell>
                  </TableRow>
                  {/* Balance Due Row */}
                  {fullInvoice.balance_due > 0 && (
                    <TableRow sx={{ bgcolor: "error.lighter" }}>
                      <TableCell colSpan={5} align="right">
                        <Typography fontWeight="bold" color="error.main">
                          Balance Due:
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography fontWeight="bold" color="error.main">
                          {fullInvoice.balance_due.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
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
                // Reset selected payment card when method changes
                setSelectedPaymentCardId(null);
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

          {state.formData.payment_method === "card" && (
              <FormSection title="Card Payment Details" columns={2}>
                <TextField
                  select
                  label="Select Card"
                  size="small"
                  value={selectedPaymentCardId || ""}
                  onChange={(e) => setSelectedPaymentCardId(Number(e.target.value))}
                  required
                >
                  <MenuItem value="" disabled>
                    Select a card type
                  </MenuItem>
                  {paymentCards.map((card: PaymentCard) => (
                    <MenuItem key={card.id} value={card.id}>
                      {card.card_name} ({card.card_type}) - {card.service_charge_percent}% fee
                    </MenuItem>
                  ))}
                </TextField>
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
                {selectedPaymentCard && (
                  <Box sx={{ gridColumn: "span 2", p: 1.5, bgcolor: "warning.lighter", borderRadius: 1 }}>
                    <Typography variant="body2" color="warning.dark">
                      <strong>Service Charge:</strong>{" "}
                      {selectedPaymentCard.service_charge_percent}% will be applied to the total amount
                      {selectedPaymentCard.description && (
                        <span> - {selectedPaymentCard.description}</span>
                      )}
                    </Typography>
                  </Box>
                )}
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
                    <TableCell align="right" sx={{ width: 80 }}>Qty</TableCell>
                    <TableCell align="right" sx={{ width: 80 }}>Warranty</TableCell>
                    <TableCell align="right" sx={{ width: 100 }}>Min Price</TableCell>
                    <TableCell align="right" sx={{ width: 100 }}>Unit Price</TableCell>
                    <TableCell align="right" sx={{ width: 80 }}>Disc %</TableCell>
                    <TableCell align="right" sx={{ width: 100 }}>Amount</TableCell>
                    <TableCell sx={{ width: 50 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lineItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} sx={modernTableStyles.emptyCell}>
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
                            onChange={(e) => updateLineItem(index, "selling_price", e.target.value === '' ? 0 : parseFloat(e.target.value))}
                            sx={{ width: 90 }}
                            inputProps={{ step: 0.01 }}
                            error={item.selling_price < item.minimum_selling_price}
                          />
                        </TableCell>

                        {/* Discount Percent Column */}
                        <TableCell align="right">
                          <TextField
                            size="small"
                            type="number"
                            value={item.discount_percent || 0}
                            onChange={(e) => {
                              const discPct = Math.min(100, Math.max(0, parseFloat(e.target.value) || 0));
                              
                              // Calculate price after discount
                              const priceAfterDiscount = item.selling_price * (1 - discPct / 100);
                              
                              // Check if price after discount is below minimum
                              if (priceAfterDiscount < item.minimum_selling_price) {
                                // Calculate maximum allowed discount to maintain minimum price
                                const maxDiscountPct = ((item.selling_price - item.minimum_selling_price) / item.selling_price) * 100;
                                updateLineItem(index, "discount_percent", Math.max(0, maxDiscountPct));
                              } else {
                                updateLineItem(index, "discount_percent", discPct);
                              }
                            }}
                            sx={{ width: 70 }}
                            inputProps={{ min: 0, max: 100, step: 0.5 }}
                            error={(() => {
                              const priceAfterDiscount = item.selling_price * (1 - (item.discount_percent || 0) / 100);
                              return priceAfterDiscount < item.minimum_selling_price;
                            })()}
                            InputProps={{
                              endAdornment: <InputAdornment position="end" sx={{ ml: 0 }}>%</InputAdornment>,
                            }}
                          />
                        </TableCell>

                        {/* Amount Column (after discount) */}
                        <TableCell align="right">
                          <Typography variant="body2" fontWeight="medium" color={(() => {
                            const lineTotal = item.quantity * item.selling_price;
                            const discountAmt = lineTotal * ((item.discount_percent || 0) / 100);
                            const finalAmount = lineTotal - discountAmt;
                            const minRequired = item.quantity * item.minimum_selling_price;
                            return finalAmount < minRequired ? "error.main" : "text.primary";
                          })()}>
                            {(() => {
                              const lineTotal = item.quantity * item.selling_price;
                              const discountAmt = lineTotal * ((item.discount_percent || 0) / 100);
                              return (lineTotal - discountAmt).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                            })()}
                          </Typography>
                          {(item.discount_percent || 0) > 0 && (
                            <Typography variant="caption" color={(() => {
                              const lineTotal = item.quantity * item.selling_price;
                              const discountAmt = lineTotal * ((item.discount_percent || 0) / 100);
                              const finalAmount = lineTotal - discountAmt;
                              const minRequired = item.quantity * item.minimum_selling_price;
                              return finalAmount < minRequired ? "error.main" : "success.main";
                            })()} sx={{ display: "block" }}>
                              -{(item.quantity * item.selling_price * ((item.discount_percent || 0) / 100)).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              {(() => {
                                const priceAfterDiscount = item.selling_price * (1 - (item.discount_percent || 0) / 100);
                                if (priceAfterDiscount < item.minimum_selling_price) {
                                  return ` (Below min!)`;
                                }
                                return '';
                              })()}
                            </Typography>
                          )}
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
                  {/* Gross Total Row */}
                  <TableRow sx={{ bgcolor: "action.hover" }}>
                    <TableCell colSpan={8} align="right">
                      <Typography fontWeight="bold">Gross Total:</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography fontWeight="bold">
                        {calculateGrossTotal().toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Typography>
                    </TableCell>
                    <TableCell />
                  </TableRow>
                  {/* Item Discounts Row - Only if any item has discount */}
                  {calculateTotalItemDiscounts() > 0 && (
                    <TableRow sx={{ bgcolor: "error.lighter" }}>
                      <TableCell colSpan={8} align="right">
                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1 }}>
                          <PercentIcon fontSize="small" color="error" />
                          <Typography fontWeight="medium" color="error.dark">
                            Item Discounts:
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell align="right">
                        <Typography fontWeight="medium" color="error.dark">
                          -{calculateTotalItemDiscounts().toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </Typography>
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  )}
                  {/* Subtotal Row (after item discounts) */}
                  <TableRow sx={{ bgcolor: "grey.100" }}>
                    <TableCell colSpan={8} align="right">
                      <Typography fontWeight="bold">Subtotal:</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography fontWeight="bold">
                        {calculateLineItemsTotal().toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Typography>
                    </TableCell>
                    <TableCell />
                  </TableRow>
                  {/* Coupon Discount Row - Only if coupon is applied */}
                  {couponValidation && couponValidation.calculated_discount && couponValidation.calculated_discount > 0 && (
                    <TableRow sx={{ bgcolor: "success.lighter" }}>
                      <TableCell colSpan={8} align="right">
                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1 }}>
                          <CouponIcon fontSize="small" color="success" />
                          <Typography fontWeight="medium" color="success.dark">
                            Coupon Discount ({couponCode}):
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell align="right">
                        <Typography fontWeight="medium" color="success.dark">
                          -{couponValidation.calculated_discount.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </Typography>
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  )}
                  {/* Invoice Discount Row - Only if discount is applied */}
                  {discountValue > 0 && (
                    <TableRow sx={{ bgcolor: "warning.lighter" }}>
                      <TableCell colSpan={8} align="right">
                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1 }}>
                          <PercentIcon fontSize="small" color="warning" />
                          <Typography fontWeight="medium" color="warning.dark">
                            Invoice Discount ({discountType === "percent" ? `${discountValue}%` : "Fixed"}):
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell align="right">
                        <Typography fontWeight="medium" color="warning.dark">
                          -{(() => {
                            const subtotal = calculateLineItemsTotal();
                            const discount = discountType === "percent" 
                              ? subtotal * (discountValue / 100)
                              : discountValue;
                            return discount.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                          })()}
                        </Typography>
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  )}
                  {/* Tax Row - Only if tax is applied */}
                  {taxRate > 0 && (
                    <TableRow sx={{ bgcolor: "info.lighter" }}>
                      <TableCell colSpan={8} align="right">
                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1 }}>
                          <TaxIcon fontSize="small" color="info" />
                          <Typography fontWeight="medium" color="info.dark">
                            Tax ({taxRate}%):
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell align="right">
                        <Typography fontWeight="medium" color="info.dark">
                          +{(() => {
                            const subtotal = calculateLineItemsTotal();
                            const invoiceDiscount = discountType === "percent" 
                              ? subtotal * (discountValue / 100)
                              : discountValue;
                            const afterInvoiceDiscount = subtotal - invoiceDiscount;
                            const couponDiscount = couponValidation?.calculated_discount || 0;
                            const afterDiscount = afterInvoiceDiscount - couponDiscount;
                            const taxAmount = afterDiscount * (taxRate / 100);
                            return taxAmount.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                          })()}
                        </Typography>
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  )}
                  {/* Gift Voucher Payment Row - Only if vouchers are applied */}
                  {appliedVouchers.length > 0 && appliedVouchers.reduce((sum, v) => sum + Number(v.amountToRedeem), 0) > 0 && (
                    <TableRow sx={{ bgcolor: "secondary.lighter" }}>
                      <TableCell colSpan={8} align="right">
                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1 }}>
                          <ReceiptIcon fontSize="small" color="secondary" />
                          <Typography fontWeight="medium" color="secondary.dark">
                            Gift Voucher Payment ({appliedVouchers.length} voucher{appliedVouchers.length > 1 ? 's' : ''}):
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell align="right">
                        <Typography fontWeight="medium" color="secondary.dark">
                          -{appliedVouchers.reduce((sum, v) => sum + Number(v.amountToRedeem), 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </Typography>
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  )}
                  {/* Credit Note Payment Row - Only if applied */}
                  {creditNoteAmount > 0 && (
                    <TableRow sx={{ bgcolor: "success.lighter" }}>
                      <TableCell colSpan={8} align="right">
                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1 }}>
                          <ReceiptIcon fontSize="small" color="success" />
                          <Typography fontWeight="medium" color="success.dark">
                            Credit Note Applied:
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell align="right">
                        <Typography fontWeight="medium" color="success.dark">
                          -{Math.min(creditNoteAmount, availableCreditBalance, Math.max(0, (() => {
                            const subtotal = calculateLineItemsTotal();
                            const invoiceDiscount = discountType === "percent" ? subtotal * (discountValue / 100) : discountValue;
                            const afterInvoiceDiscount = subtotal - invoiceDiscount;
                            const couponDiscount = couponValidation?.calculated_discount || 0;
                            const afterDiscount = afterInvoiceDiscount - couponDiscount;
                            const taxRate = parseFloat(state.formData.tax_rate?.toString() || "0");
                            const taxAmount = afterDiscount * (taxRate / 100);
                            const afterTax = afterDiscount + taxAmount;
                            const totalVoucherPayment = appliedVouchers.reduce((sum, v) => sum + Number(v.amountToRedeem), 0);
                            return afterTax - totalVoucherPayment;
                          })())).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </Typography>
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  )}
                  {/* Service Charge Row - Only for card payments */}
                  {state.formData.payment_method === "card" && selectedPaymentCard && (
                      <TableRow sx={{ bgcolor: "grey.100" }}>
                        <TableCell colSpan={8} align="right">
                          <Typography fontWeight="medium" color="text.secondary">
                            Service Charge ({selectedPaymentCard.service_charge_percent}%):
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography fontWeight="medium" color="text.secondary">
                            +{(() => {
                              const subtotal = calculateLineItemsTotal();
                              // Invoice discount first
                              const invoiceDiscount = discountType === "percent" 
                                ? subtotal * (discountValue / 100)
                                : discountValue;
                              const afterInvoiceDiscount = subtotal - invoiceDiscount;
                              // Then coupon
                              const couponDiscount = couponValidation?.calculated_discount || 0;
                              const afterDiscount = afterInvoiceDiscount - couponDiscount;
                              // Tax
                              const taxAmount = afterDiscount * (taxRate / 100);
                              const afterTax = afterDiscount + taxAmount;
                              // Voucher
                              const totalVoucherPayment = appliedVouchers.reduce((sum, v) => sum + Number(v.amountToRedeem), 0);
                              const afterVoucher = afterTax - totalVoucherPayment;
                              // Credit note
                              const appliedCreditNote = Math.min(creditNoteAmount, availableCreditBalance, Math.max(0, afterVoucher));
                              const afterCreditNote = afterVoucher - appliedCreditNote;
                              // Service charge on remaining amount after credit note
                              const rate = (selectedPaymentCard.service_charge_percent || 0) / 100;
                              return (afterCreditNote * rate).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                            })()}
                          </Typography>
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    )}
                  {/* Grand Total Row */}
                  <TableRow sx={{ bgcolor: "primary.lighter" }}>
                    <TableCell colSpan={8} align="right">
                      <Typography fontWeight="bold" color="primary.main">Grand Total (Amount to Pay):</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography fontWeight="bold" color="primary.main" fontSize="1.1rem">
                        {(() => {
                          const subtotal = calculateLineItemsTotal();
                          // Invoice discount first
                          const invoiceDiscount = discountType === "percent" 
                            ? subtotal * (discountValue / 100)
                            : discountValue;
                          const afterInvoiceDiscount = subtotal - invoiceDiscount;
                          // Then coupon
                          const couponDiscount = couponValidation?.calculated_discount || 0;
                          const afterDiscount = afterInvoiceDiscount - couponDiscount;
                          // Tax
                          const taxAmount = afterDiscount * (taxRate / 100);
                          const afterTax = afterDiscount + taxAmount;
                          // Voucher
                          const totalVoucherPayment = appliedVouchers.reduce((sum, v) => sum + Number(v.amountToRedeem), 0);
                          const afterVoucher = afterTax - totalVoucherPayment;
                          // Credit Note
                          const appliedCreditNote = Math.min(creditNoteAmount, availableCreditBalance, Math.max(0, afterVoucher));
                          const afterCreditNote = afterVoucher - appliedCreditNote;
                          // Service charge for card payments
                          let serviceCharge = 0;
                          if (state.formData.payment_method === "card" && selectedPaymentCard) {
                            const chargePercent = selectedPaymentCard.service_charge_percent || 0;
                            serviceCharge = afterCreditNote * (chargePercent / 100);
                          }
                          return (afterCreditNote + serviceCharge).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                        })()}
                      </Typography>
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </Paper>
          </Box>

          {/* Coupon/Discount Code Section - After adding items */}
          {lineItems.length > 0 && (
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                mb: 2,
                bgcolor: couponValidation ? "success.50" : "grey.50",
                borderColor: couponValidation ? "success.main" : "divider",
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                <CouponIcon color={couponValidation ? "success" : "action"} />
                <Typography variant="subtitle2" fontWeight="bold">
                  Apply Coupon / Discount Code
                </Typography>
              </Box>
              
              {!couponValidation ? (
                <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                  <TextField
                    size="small"
                    fullWidth
                    placeholder="Scan barcode or enter coupon code..."
                    value={couponCode}
                    onChange={(e) => {
                      setCouponCode(e.target.value.toUpperCase());
                      if (couponError) setCouponError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleValidateCoupon();
                      }
                    }}
                    disabled={isValidatingCoupon || !state.formData.customer_id || lineItems.length === 0}
                    error={!!couponError}
                    helperText={couponError || (lineItems.length === 0 ? "Add items first" : "Scan barcode or type code and press Enter/Apply")}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <QrCodeScannerIcon fontSize="small" color="action" />
                        </InputAdornment>
                      ),
                      endAdornment: isValidatingCoupon ? (
                        <InputAdornment position="end">
                          <CircularProgress size={20} />
                        </InputAdornment>
                      ) : null,
                    }}
                  />
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={handleValidateCoupon}
                    disabled={isValidatingCoupon || !couponCode.trim() || !state.formData.customer_id || lineItems.length === 0}
                    sx={{ minWidth: 100 }}
                  >
                    {isValidatingCoupon ? <CircularProgress size={20} /> : "Apply"}
                  </Button>
                </Box>
              ) : (
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <Box>
                    <Chip
                      icon={<CouponIcon />}
                      label={couponCode}
                      color="success"
                      variant="filled"
                      sx={{ mr: 1 }}
                    />
                    <Typography variant="body2" component="span" color="success.dark" fontWeight="medium">
                      {couponValidation.discount_type === "PERCENT" 
                        ? `${couponValidation.discount_value}% off` 
                        : `Rs. ${couponValidation.discount_value?.toLocaleString()} off`}
                      {" - Discount: Rs. "}
                      {(couponValidation.calculated_discount || 0).toLocaleString("en-LK", { minimumFractionDigits: 2 })}
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    color="error"
                    onClick={handleClearCoupon}
                    startIcon={<DeleteIcon />}
                  >
                    Remove
                  </Button>
                </Box>
              )}
            </Paper>
          )}

          {/* Invoice Discount & Tax Section */}
          {lineItems.length > 0 && (
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                mb: 2,
                bgcolor: (discountValue > 0 || taxRate > 0) ? "warning.50" : "grey.50",
                borderColor: (discountValue > 0 || taxRate > 0) ? "warning.main" : "divider",
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
                <PercentIcon color={(discountValue > 0 || taxRate > 0) ? "warning" : "action"} />
                <Typography variant="subtitle2" fontWeight="bold">
                  Discount & Tax
                </Typography>
              </Box>
              
              <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                {/* Discount Section */}
                <Box sx={{ flex: 1, minWidth: 280 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Invoice Discount
                  </Typography>
                  <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                    <ToggleButtonGroup
                      value={discountType}
                      exclusive
                      onChange={(_, value) => value && setDiscountType(value)}
                      size="small"
                    >
                      <ToggleButton value="percent" sx={{ px: 1.5 }}>
                        <PercentIcon fontSize="small" />
                      </ToggleButton>
                      <ToggleButton value="amount" sx={{ px: 1.5 }}>
                        <MoneyIcon fontSize="small" />
                      </ToggleButton>
                    </ToggleButtonGroup>
                    <TextField
                      size="small"
                      type="number"
                      value={discountValue || ""}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        // Validate: percentage can't exceed 100, amount can't exceed subtotal
                        if (discountType === "percent" && val > 100) return;
                        if (discountType === "amount" && val > calculateLineItemsTotal()) return;
                        setDiscountValue(val);
                      }}
                      placeholder={discountType === "percent" ? "0%" : "0.00"}
                      sx={{ width: 120 }}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            {discountType === "percent" ? "%" : "Rs."}
                          </InputAdornment>
                        ),
                      }}
                      inputProps={{ 
                        min: 0, 
                        max: discountType === "percent" ? 100 : calculateLineItemsTotal(),
                        step: discountType === "percent" ? 0.5 : 100
                      }}
                    />
                    {discountValue > 0 && (
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        <Typography variant="body2" color="warning.dark" fontWeight="medium">
                          = Rs. {(() => {
                            const subtotal = calculateLineItemsTotal();
                            const discount = discountType === "percent" 
                              ? subtotal * (discountValue / 100)
                              : discountValue;
                            return discount.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                          })()}
                        </Typography>
                        <IconButton 
                          size="small" 
                          color="error" 
                          onClick={() => setDiscountValue(0)}
                          sx={{ p: 0.5 }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    )}
                  </Box>
                </Box>

                {/* Tax Section */}
                <Box sx={{ flex: 1, minWidth: 200 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Tax Rate (VAT/GST)
                  </Typography>
                  <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                    <TextField
                      size="small"
                      type="number"
                      value={taxRate || ""}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        if (val > 100) return; // Max 100%
                        setTaxRate(val);
                      }}
                      placeholder="0%"
                      sx={{ width: 100 }}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <TaxIcon fontSize="small" color="action" />
                          </InputAdornment>
                        ),
                        endAdornment: (
                          <InputAdornment position="end">%</InputAdornment>
                        ),
                      }}
                      inputProps={{ min: 0, max: 100, step: 0.5 }}
                    />
                    {taxRate > 0 && (
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        <Typography variant="body2" color="info.dark" fontWeight="medium">
                          = Rs. {(() => {
                            const subtotal = calculateLineItemsTotal();
                            const invoiceDiscount = discountType === "percent" 
                              ? subtotal * (discountValue / 100)
                              : discountValue;
                            const afterInvoiceDiscount = subtotal - invoiceDiscount;
                            const couponDiscount = couponValidation?.calculated_discount || 0;
                            const afterDiscount = afterInvoiceDiscount - couponDiscount;
                            const taxAmount = afterDiscount * (taxRate / 100);
                            return taxAmount.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                          })()}
                        </Typography>
                        <IconButton 
                          size="small" 
                          color="error" 
                          onClick={() => setTaxRate(0)}
                          sx={{ p: 0.5 }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    )}
                  </Box>
                  {/* Common tax rate quick select */}
                  <Box sx={{ display: "flex", gap: 0.5, mt: 1 }}>
                    {[0, 5, 8, 12, 18].map((rate) => (
                      <Chip
                        key={rate}
                        label={`${rate}%`}
                        size="small"
                        variant={taxRate === rate ? "filled" : "outlined"}
                        color={taxRate === rate ? "primary" : "default"}
                        onClick={() => setTaxRate(rate)}
                        sx={{ cursor: "pointer", minWidth: 45 }}
                      />
                    ))}
                  </Box>
                </Box>
              </Box>
            </Paper>
          )}

          {/* Gift Voucher Payment Section - After adding items */}
          {lineItems.length > 0 && (
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                mb: 2,
                bgcolor: appliedVouchers.length > 0 ? "info.50" : "grey.50",
                borderColor: appliedVouchers.length > 0 ? "info.main" : "divider",
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <ReceiptIcon color={appliedVouchers.length > 0 ? "info" : "action"} />
                  <Typography variant="subtitle2" fontWeight="bold">
                    Apply Gift Vouchers
                  </Typography>
                  {appliedVouchers.length > 0 && (
                    <Chip 
                      label={`${appliedVouchers.length} applied`} 
                      size="small" 
                      color="info"
                      sx={{ height: 20 }}
                    />
                  )}
                </Box>
                {appliedVouchers.length > 0 && (
                  <Button
                    size="small"
                    color="error"
                    onClick={handleClearAllVouchers}
                    startIcon={<DeleteIcon />}
                  >
                    Remove All
                  </Button>
                )}
              </Box>
              
              {/* Voucher input - always visible */}
              <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start", mb: appliedVouchers.length > 0 ? 2 : 0 }}>
                <TextField
                  size="small"
                  fullWidth
                  placeholder="Scan barcode or enter voucher code..."
                  value={voucherCode}
                  onChange={(e) => {
                    setVoucherCode(e.target.value.toUpperCase());
                    if (voucherError) setVoucherError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleValidateVoucher();
                    }
                  }}
                  disabled={isValidatingVoucher || lineItems.length === 0}
                  error={!!voucherError}
                  helperText={voucherError || (lineItems.length === 0 ? "Add items first" : "Scan voucher barcode or type code and press Enter/Apply")}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <QrCodeScannerIcon fontSize="small" color="action" />
                      </InputAdornment>
                    ),
                    endAdornment: isValidatingVoucher ? (
                      <InputAdornment position="end">
                        <CircularProgress size={20} />
                      </InputAdornment>
                    ) : null,
                  }}
                />
                <Button
                  variant="contained"
                  color="info"
                  onClick={handleValidateVoucher}
                  disabled={isValidatingVoucher || !voucherCode.trim() || lineItems.length === 0}
                  sx={{ minWidth: 100 }}
                >
                  {isValidatingVoucher ? <CircularProgress size={20} /> : "Apply"}
                </Button>
              </Box>

              {/* List of applied vouchers */}
              {appliedVouchers.length > 0 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  {appliedVouchers.map((voucher, index) => (
                    <Box
                      key={voucher.validation.voucher_id}
                      sx={{
                        p: 1.5,
                        bgcolor: "white",
                        borderRadius: 1,
                        border: "1px solid",
                        borderColor: "info.light",
                      }}
                    >
                      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                          <Chip
                            icon={<ReceiptIcon />}
                            label={voucher.validation.barcode_no}
                            color="info"
                            size="small"
                          />
                          <Typography variant="caption" color="text.secondary">
                            Balance: Rs. {(voucher.validation.balance || 0).toLocaleString("en-LK", { minimumFractionDigits: 2 })}
                            {voucher.validation.expiry_date && (
                              ` • Expires: ${new Date(voucher.validation.expiry_date).toLocaleDateString()}`
                            )}
                          </Typography>
                        </Box>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => voucher.validation.voucher_id && handleRemoveVoucher(voucher.validation.voucher_id)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Box>
                      <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
                        <TextField
                          size="small"
                          label="Amount to Redeem"
                          type="number"
                          value={voucher.amountToRedeem}
                          onChange={(e) => {
                            const inputValue = parseFloat(e.target.value) || 0;
                            
                            // Calculate remaining amount after other vouchers
                            const subtotal = calculateLineItemsTotal();
                            const couponDiscount = couponValidation?.calculated_discount || 0;
                            const otherVouchersTotal = appliedVouchers
                              .filter((_, i) => i !== index)
                              .reduce((sum, v) => sum + Number(v.amountToRedeem), 0);
                            const remainingAmount = subtotal - couponDiscount - otherVouchersTotal;
                            
                            // Max is the minimum of: voucher's redeemable amount, or remaining invoice amount
                            const maxAllowed = Math.min(
                              voucher.validation.redeemable_amount || 0,
                              remainingAmount
                            );
                            
                            const value = Math.min(inputValue, maxAllowed);
                            
                            setAppliedVouchers(prev => prev.map((v, i) => 
                              i === index ? { ...v, amountToRedeem: Math.max(0, value) } : v
                            ));
                          }}
                          InputProps={{
                            startAdornment: <InputAdornment position="start">Rs.</InputAdornment>,
                            inputProps: { 
                              min: 0, 
                              max: voucher.validation.redeemable_amount || 0,
                              step: 0.01 
                            },
                          }}
                          helperText={`Max: Rs. ${(voucher.validation.redeemable_amount || 0).toLocaleString("en-LK", { minimumFractionDigits: 2 })}`}
                          sx={{ width: 200 }}
                        />
                        <Typography variant="body2" color="info.dark" fontWeight="bold">
                          Redeeming: Rs. {voucher.amountToRedeem.toLocaleString("en-LK", { minimumFractionDigits: 2 })}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                  {/* Total voucher payment */}
                  <Box sx={{ p: 1, bgcolor: "success.lighter", borderRadius: 1, textAlign: "right" }}>
                    <Typography variant="body2" color="success.dark" fontWeight="bold">
                      Total Voucher Payment: Rs. {appliedVouchers.reduce((sum, v) => sum + Number(v.amountToRedeem), 0).toLocaleString("en-LK", { minimumFractionDigits: 2 })}
                    </Typography>
                  </Box>
                </Box>
              )}
            </Paper>
          )}

          {/* Credit Note Payment Section */}
          {lineItems.length > 0 && selectedCustomerId && selectedCustomerId > 0 && (
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                mb: 2,
                bgcolor: creditNoteAmount > 0 ? "success.50" : "grey.50",
                borderColor: creditNoteAmount > 0 ? "success.main" : "divider",
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                <ReceiptIcon color={creditNoteAmount > 0 ? "success" : "action"} />
                <Typography variant="subtitle2" fontWeight="bold">
                  Apply Credit Note Balance
                </Typography>
                {isLoadingCreditBalance && <CircularProgress size={16} />}
              </Box>

              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
                Available Balance: Rs. {availableCreditBalance.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </Typography>

              {availableCreditBalance > 0 ? (
                <Box>
                  <TextField
                    size="small"
                    label="Credit Note Amount to Apply"
                    type="number"
                    fullWidth
                    value={creditNoteAmount}
                    onChange={(e) => {
                      const inputValue = parseFloat(e.target.value) || 0;
                      // Calculate remaining invoice amount
                      const subtotal = calculateLineItemsTotal();
                      const couponDiscount = couponValidation?.calculated_discount || 0;
                      const invoiceDiscount = discountType === "percent" ? subtotal * (discountValue / 100) : discountValue;
                      const afterDiscount = subtotal - invoiceDiscount - couponDiscount;
                      const taxRate = parseFloat(state.formData.tax_rate?.toString() || "0");
                      const taxAmount = afterDiscount * (taxRate / 100);
                      const afterTax = afterDiscount + taxAmount;
                      const totalVoucherPayment = appliedVouchers.reduce((sum, v) => sum + Number(v.amountToRedeem), 0);
                      const afterVoucher = afterTax - totalVoucherPayment;
                      
                      // Max is minimum of: available balance or remaining invoice amount
                      const maxAllowed = Math.min(availableCreditBalance, Math.max(0, afterVoucher));
                      const value = Math.min(inputValue, maxAllowed);
                      
                      setCreditNoteAmount(Math.max(0, value));
                    }}
                    InputProps={{
                      startAdornment: <InputAdornment position="start">Rs.</InputAdornment>,
                      inputProps: { 
                        min: 0, 
                        max: availableCreditBalance,
                        step: 0.01 
                      },
                    }}
                    helperText={`Max: Rs. ${Math.min(
                      availableCreditBalance,
                      Math.max(0, (() => {
                        const subtotal = calculateLineItemsTotal();
                        const couponDiscount = couponValidation?.calculated_discount || 0;
                        const invoiceDiscount = discountType === "percent" ? subtotal * (discountValue / 100) : discountValue;
                        const afterDiscount = subtotal - invoiceDiscount - couponDiscount;
                        const taxRate = parseFloat(state.formData.tax_rate?.toString() || "0");
                        const taxAmount = afterDiscount * (taxRate / 100);
                        const afterTax = afterDiscount + taxAmount;
                        const totalVoucherPayment = appliedVouchers.reduce((sum, v) => sum + Number(v.amountToRedeem), 0);
                        return afterTax - totalVoucherPayment;
                      })())
                    ).toLocaleString("en-LK", { minimumFractionDigits: 2 })}`}
                  />
                  {creditNoteAmount > 0 && (
                    <Box sx={{ mt: 2, p: 1, bgcolor: "success.lighter", borderRadius: 1, textAlign: "right" }}>
                      <Typography variant="body2" color="success.dark" fontWeight="bold">
                        Credit Note Applied: Rs. {creditNoteAmount.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Typography>
                    </Box>
                  )}
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No credit balance available for this customer
                </Typography>
              )}
            </Paper>
          )}

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
                          sx={{ color: isSelected ? "common.white" : "text.primary" }}
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
