import apiClient from "@/api/client";
import { usePermission } from "@/auth/permissions";
import {
    ActionToolbar,
    canPrintDocument,
    CUSTOMER_PAYMENT_METHOD,
    DetailPanelHeader,
    EmptyState,
    fmtLKR,
    FormSection,
    handleApiError,
    MasterDetailLayout,
    modernTableStyles,
    SearchableList,
    SelectableListItem,
    showErrorToast,
    showSuccessToast,
    SortOption,
    TConfirmDialog,
    TEmailDialog,
    TPrintButton,
    TPrintPreviewDialog,
    TStatusChip,
    TSteps,
    useCrudMutation,
    useMasterDetailState,
    useTConfirmDialog,
} from "@/components/tijaero";
import { useReferenceData } from "@/hooks";
import { couponsApi, customersApi, vouchersApi } from "@/modules/customers/api";
import {
    CouponValidationResponse,
    VoucherValidationResponse,
} from "@/modules/customers/types";
import { creditNotesApi } from "@/modules/finance/api";
import { settingsApi } from "@/modules/settings/api";
import { salesStockApi } from "@/modules/inventory/api";
import { Brand, SalesStock } from "@/modules/inventory/types";
import SalesFilterPanel from "@/modules/sales/components/ui/SalesFilterPanel";
import {
    Add as AddIcon,
    ThumbUp as ApproveIcon,
    Cancel as CancelIcon,
    LocalOffer as CouponIcon,
    Delete as DeleteIcon,
    FileDownload as DownloadIcon,
    Edit as EditIcon,
    Email as EmailIcon,
    MenuBook as MenuBookIcon,
    AttachMoney as MoneyIcon,
    Percent as PercentIcon,
    Receipt as ReceiptIcon,
    AccountBalance as TaxIcon,
} from "@mui/icons-material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import {
    Alert,
    Autocomplete,
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    Grid,
    IconButton,
    InputAdornment,
    MenuItem,
    Paper,
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
    Switch,
    FormControlLabel,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { paymentCardsApi, salesApi } from "../api";
import { commissionsApi, commissionPaymentsApi } from "../commission-api";
import { quotationApi } from "../quotation-api";
import InvoiceDetailsDialog from "../components/InvoiceDetailsDialog";
import { Invoice, InvoiceCreate, PaymentCard } from "../types";

const getNextNumber = (prefix: string, existing: { no: string }[], branchCode?: string): string => {
  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const actualBranch = branchCode || "MAIN";
  const fullPrefix = `${prefix}-${actualBranch}-${yy}`;
  let maxSeq = 0;
  for (const item of existing) {
    if (item.no?.startsWith(fullPrefix)) {
      const lastPart = item.no.split("-").pop() || "";
      if (lastPart.length > 2) {
        const seq = parseInt(lastPart.slice(2), 10);
        if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
      }
    }
  }
  return `${fullPrefix}${String(maxSeq + 1).padStart(6, "0")}`;
};

export const getPaymentMethodsDisplay = (invoice: any) => {
  if (!invoice) return "";
  const methods: string[] = [];
  if ((invoice.cash_amount || 0) > 0) methods.push("Cash");
  if (
    (invoice.card_visa_amount || 0) > 0 ||
    (invoice.card_mastercard_amount || 0) > 0 ||
    (invoice.card_amex_amount || 0) > 0
  ) {
    methods.push("Card");
  }
  if ((invoice.cheque_amount || 0) > 0) methods.push("Cheque");
  if ((invoice.bank_transfer_amount || 0) > 0) methods.push("Bank Transfer");
  if ((invoice.credit_amount || 0) > 0) methods.push("Credit");
  
  if (methods.length > 1) {
    return `Split (${methods.join(", ")})`;
  }
  if (methods.length === 1) {
    return methods[0];
  }
  
  // Fallback to stored payment method if all amounts are 0 or not populated
  return invoice.payment_method
    ? invoice.payment_method.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
    : "N/A";
};

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
const FORM_STEPS = ["Order Information", "Line Items & Payment"];

// Split payment row
interface SplitPaymentRow {
  id: string;
  method: string;
  amount: number;
  cheque_number: string;
  cheque_bank: string;
  cheque_date: string;
  card_ref_number: string;
  card_holder_name: string;
  card_id: number | null;
  bank_name: string;
  bank_transfer_ref: string;
  credit_terms: string;
}
const makeSplitRow = (method = "cash", amount = 0): SplitPaymentRow => ({
  id: Date.now().toString() + Math.random().toString(36).slice(2),
  method, amount,
  cheque_number: "", cheque_bank: "", cheque_date: new Date().toISOString().split("T")[0],
  card_ref_number: "", card_holder_name: "", card_id: null,
  bank_name: "", bank_transfer_ref: "",
  credit_terms: "30 days",
});

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
  price_tier_id?: number; // Price tier id from stock item
}

// Initial form data
const emptyInvoiceForm: Partial<InvoiceCreate> = {
  invoice_no: "",
  branch_code: "MAIN",
  customer_id: 0,
  customer_agent_id: undefined,
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
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // Line items state (separate from main form for complex management)
  const [lineItems, setLineItems] = useState<ItemFormData[]>([]);

  // Form step state for stepper workflow
  const [formStep, setFormStep] = useState(0);

  const handleExportCSV = async () => {
    try {
      const branchParam = filterBranch ? `&branch_codes=${filterBranch}` : "";
      const statusParam = filterStatus ? `&status=${filterStatus}` : "";

      const response = await apiClient.get<Blob>(
        `/sales/export-csv?limit=100000${branchParam}${statusParam}`,
        {
          responseType: "blob",
        },
      );

      const blob = response.data;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const dateStr = new Date().toISOString().split("T")[0];
      const branchStr = filterBranch || "all_branches";
      link.download = `sales_orders_${branchStr}_${dateStr}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
    }
  };

  // Dialog states
  const [invoiceDetailsOpen, setInvoiceDetailsOpen] = useState(false);
  const [selectedInvoiceForView, setSelectedInvoiceForView] =
    useState<Invoice | null>(null);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [selectedItemForPrint, setSelectedItemForPrint] =
    useState<Invoice | null>(null);
  const [remarksDialogOpen, setRemarksDialogOpen] = useState(false);
  const [itemRemarkModalOpen, setItemRemarkModalOpen] = useState(false);
  const [currentItemRemark, setCurrentItemRemark] = useState("");

  // Barcode scanning state
  const [barcodeInput, setBarcodeInput] = useState("");
  const [isValidatingBarcode, setIsValidatingBarcode] = useState(false);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Manual product picker state
  const [manualBrandId, setManualBrandId] = useState<number | null>(null);
  const [manualProductId, setManualProductId] = useState<number | null>(null);
  const [manualBranchCode, setManualBranchCode] = useState<string | null>(null);
  const [manualStockItems, setManualStockItems] = useState<SalesStock[]>([]);
  const [isLoadingManualStock, setIsLoadingManualStock] = useState(false);

  // Validated items tracking (for visual feedback on scanned items)
  const [validatedBarcodes, setValidatedBarcodes] = useState<string[]>([]);

  // Coupon/Discount code state
  const [couponCode, setCouponCode] = useState("");
  const [isValidatingCoupon, setIsValidatingCoupon] = useState(false);
  const [couponValidation, setCouponValidation] =
    useState<CouponValidationResponse | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  // Gift Voucher payment state - Support multiple vouchers
  const [voucherCode, setVoucherCode] = useState("");
  const [isValidatingVoucher, setIsValidatingVoucher] = useState(false);
  const [appliedVouchers, setAppliedVouchers] = useState<
    Array<{
      validation: VoucherValidationResponse;
      amountToRedeem: number;
    }>
  >([]);
  const [voucherError, setVoucherError] = useState<string | null>(null);

  // Credit Note state
  const [creditNoteAmount, setCreditNoteAmount] = useState(0);
  const [availableCreditBalance, setAvailableCreditBalance] = useState(0);
  const [isLoadingCreditBalance, setIsLoadingCreditBalance] = useState(false);

  // Payment card state - for card payment method
  const [selectedPaymentCardId, setSelectedPaymentCardId] = useState<
    number | null
  >(null);

  // Cross-module view permissions for optional reference data
  const canViewSalesSettings = usePermission("sales_settings", "view");
  const canViewCustomers = usePermission("customers", "view");
  const canViewCreditNotes = usePermission("credit_notes", "view");

  // Fetch active payment cards from settings
  const { data: paymentCards = [] } = useQuery({
    queryKey: ["payment-cards-active"],
    queryFn: () => paymentCardsApi.getAll(true), // Only active cards
    enabled: canViewSalesSettings,
  });

  // Fetch company settings for tax normalization and surcharge config
  const { data: companySettings } = useQuery({
    queryKey: ["company-settings"],
    queryFn: () => settingsApi.getCompanySettings(),
  });

  // Tax normalization flags from company settings
  const hideServiceCharge = companySettings?.hide_service_charge ?? false;

  // Get selected payment card details
  const selectedPaymentCard = useMemo(() => {
    if (!selectedPaymentCardId) return null;
    return (
      paymentCards.find(
        (card: PaymentCard) => card.id === selectedPaymentCardId,
      ) || null
    );
  }, [selectedPaymentCardId, paymentCards]);

  // Payment details state for different payment methods
  const [paymentDetails, setPaymentDetails] = useState({
    // Cheque payment details
    cheque_number: "",
    cheque_bank: "",
    cheque_date: new Date().toISOString().split("T")[0],
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
  const [discountType, setDiscountType] = useState<"percent" | "amount">(
    "percent",
  );
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [taxRate, setTaxRate] = useState<number>(0);
  const [taxMode, setTaxMode] = useState<"inclusive" | "exclusive" | "none">("none");

  // Effective tax rate — 0 when no tax mode selected
  const effectiveTaxRate = taxMode !== "none" ? taxRate : 0;

  // Agent commission manual override state
  const [manualCommissionRate, setManualCommissionRate] = useState<number | null>(null);
  const [manualCommissionAmount, setManualCommissionAmount] = useState<number | null>(null);

  // Split payments state
  const [splitPayments, setSplitPayments] = useState<SplitPaymentRow[]>([makeSplitRow("cash", 0)]);

  const updateSplitRow = (id: string, update: Partial<SplitPaymentRow>) =>
    setSplitPayments((prev) => prev.map((r) => r.id === id ? { ...r, ...update } : r));

  const removeSplitRow = (id: string) => {
    setSplitPayments((prev) => {
      const idx = prev.findIndex((r) => r.id === id);
      if (idx === -1) return prev;
      const removedAmount = prev[idx].amount || 0;
      const next = prev.filter((r) => r.id !== id);
      if (next.length > 0) {
        next[0] = { ...next[0], amount: (next[0].amount || 0) + removedAmount };
      }
      return next;
    });
  };

  const addSplitRow = () =>
    setSplitPayments((prev) => [...prev, makeSplitRow("cash", 0)]);

  const handlePaymentAmountChange = (changedId: string, newAmount: number) => {
    setSplitPayments((prev) => {
      const idx = prev.findIndex((r) => r.id === changedId);
      if (idx === -1) return prev;

      const oldAmount = prev[idx].amount || 0;
      const diff = newAmount - oldAmount;
      const next = [...prev];
      next[idx] = { ...next[idx], amount: newAmount };

      // Auto-adjust the first row if we are not editing the first row
      if (idx !== 0 && next[0]) {
        next[0] = { ...next[0], amount: Math.max(0, (next[0].amount || 0) - diff) };
      }
      return next;
    });
  };

  // Filter states
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);

  // Permissions
  const canCreate = usePermission("sales_orders", "create");
  const canDelete = usePermission("sales_orders", "delete");
  const canUpdate = usePermission("sales_orders", "update");
  const canApprove = usePermission("so_approvals", "approve");
  const canCreateReturn = usePermission("sales_returns", "create");

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
    extraDirty: lineItems.length > 0,
    onDiscard: () => {
      setLineItems([]);
      setFormStep(0);
    },
  });

  // OPTIMIZED: Single API call for products, brands and branches (was 2 calls)
  const { data: refData, filteredBranches, defaultBranchCode } = useReferenceData(["products", "brands", "branches"]);
  const products = refData?.products || [];
  const brands = (refData?.brands || []) as Brand[];
  const branches = filteredBranches || [];

  // Auto-default branch filter for non-superuser users
  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // branchResolved: true once we've either confirmed no default branch exists, or the filter has been set
  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  // Queries
  const { data: invoices, isLoading } = useQuery({
    queryKey: ["sales"],
    queryFn: () => salesApi.getAll(),
    enabled: branchResolved,
  });

  const nextInvoiceNumber = useMemo(
    () =>
      getNextNumber(
        "INV",
        (invoices || []).map((inv: any) => ({ no: inv.invoice_no })),
        state.formData.branch_code
      ),
    [invoices, state.formData.branch_code],
  );

  // Fetch customers separately (has complex operations like credit check)
  const { data: customers } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.getAll(0, 500, true), // activeOnly=true - only fetch active customers
    enabled: canViewCustomers,
    staleTime: 0, // Always consider data stale to refetch on mount
    refetchOnWindowFocus: true, // Refetch when window regains focus
  });

  // Fetch credit notes for selected customer when using credit_note payment
  const selectedCustomerId = state.formData.customer_id;
  const { data: customerCreditNotes } = useQuery({
    queryKey: ["customer-credit-notes", selectedCustomerId],
    queryFn: () =>
      creditNotesApi.getCustomerCreditNotes(selectedCustomerId as number),
    enabled:
      canViewCreditNotes &&
      !!selectedCustomerId &&
      state.formData.payment_method === "credit_note",
  });

  // Fetch customer credit status for credit sales validation
  const { data: customerCreditStatus } = useQuery({
    queryKey: ["customer-credit-status", selectedCustomerId],
    queryFn: () => customersApi.getCreditSummary(selectedCustomerId as number),
    enabled:
      canViewCustomers &&
      !!selectedCustomerId &&
      selectedCustomerId > 0 &&
      (state.isCreating || state.isEditing),
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
        const response = await apiClient.get<{
          available_credit_balance: number;
        }>(`/finance/customers/${selectedCustomerId}/credit-balance`);
        const data = response.data;
        setAvailableCreditBalance(data.available_credit_balance || 0);
      } catch (error) {
        setAvailableCreditBalance(0);
      } finally {
        setIsLoadingCreditBalance(false);
      }
    };

    fetchCreditBalance();
  }, [selectedCustomerId]);

  // Fetch recent sales for selected customer (last 5 from any branch)
  const { data: recentCustomerSales, isLoading: loadingRecentSales } = useQuery(
    {
      queryKey: ["customer-recent-sales", selectedCustomerId],
      queryFn: () =>
        salesApi.getRecentByCustomer(selectedCustomerId as number, 5),
      enabled:
        !!selectedCustomerId &&
        selectedCustomerId > 0 &&
        (state.isCreating || state.isEditing),
    },
  );

  // Load full invoice with items when viewing
  const { data: fullInvoice } = useQuery({
    queryKey: ["sales", state.selectedItem?.id],
    queryFn: () => salesApi.getById(state.selectedItem!.id),
    enabled: !!state.selectedItem && !state.isCreating,
  });

  // Load agent commission for this invoice if applicable
  const { data: invoiceCommissions } = useQuery({
    queryKey: ["invoice-commissions", fullInvoice?.invoice_no],
    queryFn: () => commissionsApi.getAll({ search: fullInvoice?.invoice_no }),
    enabled: !!fullInvoice?.invoice_no && !!fullInvoice?.customer_agent_id,
  });

  const invoiceCommission = invoiceCommissions?.items?.find(
    (c: any) => c.invoice_id === fullInvoice?.id
  );

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
    return lineItems.reduce(
      (sum, item) => sum + item.quantity * item.selling_price,
      0,
    );
  };

  /**
   * Centralized order totals calculation.
   * Order: Normalize → Item Discount → Coupon → Invoice Discount → Tax → Payments
   */
  const calcOrderTotals = () => {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const grossSubtotal = r2(calculateLineItemsTotal());
    // Step 2: Normalize - convert gross to net for inclusive pricing
    const subtotal = r2((taxMode === "inclusive" && effectiveTaxRate > 0)
      ? grossSubtotal / (1 + effectiveTaxRate / 100)
      : grossSubtotal);
    // Step 4: Coupon Discount (on subtotal)
    const couponDiscount = r2(couponValidation?.calculated_discount || 0);
    const afterCoupon = r2(subtotal - couponDiscount);
    // Step 5: Invoice Discount (after coupon)
    const invoiceDiscount = r2(discountType === "percent"
      ? afterCoupon * (discountValue / 100)
      : discountValue);
    const finalNet = r2(afterCoupon - invoiceDiscount);
    // Step 7: Tax - recalculate on final net (same for inclusive & exclusive)
    const taxAmount = r2(effectiveTaxRate > 0
      ? finalNet * (effectiveTaxRate / 100)
      : 0);
    // Step 8: Grand total = Net + Tax
    const afterTax = r2(finalNet + taxAmount);
    // Step 9: Payments
    const totalVoucherPayment = r2(appliedVouchers.reduce((sum, v) => sum + Number(v.amountToRedeem), 0));
    const afterVoucher = r2(afterTax - totalVoucherPayment);
    const appliedCreditNote = r2(Math.min(creditNoteAmount, availableCreditBalance, Math.max(0, afterVoucher)));
    const afterCreditNote = r2(afterVoucher - appliedCreditNote);
    let serviceCharge = 0;
    if (selectedPaymentCard && (selectedPaymentCard.service_charge_percent || 0) > 0) {
      const chargePercent = selectedPaymentCard.service_charge_percent || 0;
      const isSingleCard = state.formData.payment_method === "card" && splitPayments.length <= 1;
      const hasCardInSplit = splitPayments.length > 1 && splitPayments.some(p => p.method === "card");
      if (isSingleCard) {
        // Full remaining amount goes to card
        serviceCharge = r2(afterCreditNote * (chargePercent / 100));
      } else if (hasCardInSplit) {
        // Only charge on the card portion (remaining after non-card amounts)
        const nonCardTotal = r2(splitPayments
          .filter(p => p.method !== "card")
          .reduce((s, p) => s + (p.amount || 0), 0));
        const cardBase = r2(Math.max(0, afterCreditNote - nonCardTotal));
        serviceCharge = r2(cardBase * (chargePercent / 100));
      }
    }
    const grandTotal = r2(Math.max(0, afterCreditNote + serviceCharge));
    return {
      grossSubtotal, subtotal,
      couponDiscount, afterCoupon,
      invoiceDiscount, finalNet,
      taxAmount, afterTax,
      totalVoucherPayment, afterVoucher,
    appliedCreditNote, afterCreditNote,
      serviceCharge, grandTotal,
    };
  };

  const prevGrandTotalRef = useRef<number | null>(null);

  useEffect(() => {
    const currentTotal = calcOrderTotals().grandTotal;
    if (prevGrandTotalRef.current !== null && currentTotal !== prevGrandTotalRef.current) {
      const diff = currentTotal - prevGrandTotalRef.current;
      setSplitPayments((prev) => {
        if (prev.length === 0) return prev;
        const next = [...prev];
        next[0] = { ...next[0], amount: Math.max(0, (next[0].amount || 0) + diff) };
        return next;
      });
    }
    prevGrandTotalRef.current = currentTotal;
  }, [lineItems, discountType, discountValue, taxRate, taxMode, appliedVouchers, creditNoteAmount, selectedPaymentCard, splitPayments]);
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
      filtered = filtered.filter(
        (invoice) => invoice.branch_code === filterBranch,
      );
    }

    // Apply status filter
    if (filterStatus) {
      filtered = filtered.filter(
        (invoice) => invoice.approval_status === filterStatus,
      );
    }

    filtered.sort((a, b) => {
      if (state.sortField === "invoice_no") {
        return a.invoice_no.localeCompare(b.invoice_no);
      } else if (state.sortField === "created_date") {
        const timeA = a.created_date_time ? new Date(a.created_date_time).getTime() : new Date(a.created_date).getTime();
        const timeB = b.created_date_time ? new Date(b.created_date_time).getTime() : new Date(b.created_date).getTime();
        if (timeB !== timeA) {
          return timeB - timeA;
        }
        return b.id - a.id;
      } else if (state.sortField === "total") {
        return calculateTotal(b) - calculateTotal(a);
      }
      return 0;
    });

    return filtered;
  }, [
    invoices,
    state.searchQuery,
    state.sortField,
    filterBranch,
    filterStatus,
  ]);

  // Auto-select first item when data loads, or the ?focus=<id> deep-link
  // target (used by the AI assistant to open a specific sales order).
  const focusHandled = useRef(false);
  useEffect(() => {
    if (state.isCreating || filteredInvoices.length === 0) return;
    const focusId = Number(searchParams.get("focus"));
    if (focusId && !focusHandled.current) {
      const target = filteredInvoices.find((inv) => inv.id === focusId);
      if (target) {
        focusHandled.current = true;
        state.setSelectedItem(target);
        const next = new URLSearchParams(searchParams);
        next.delete("focus");
        setSearchParams(next, { replace: true });
        return;
      }
    }
    if (!state.selectedItem && !searchParams.get("focus")) {
      state.setSelectedItem(filteredInvoices[0]);
    }
  }, [filteredInvoices, state.selectedItem, state.isCreating, searchParams, setSearchParams]);

  // Handle navigation state from Proforma page (auto-select Sales Order created from proforma)
  const navStateHandled = useRef(false);
  useEffect(() => {
    const navState = location.state as {
      fromProforma?: boolean;
      invoiceId?: number;
      invoiceNo?: string;
    } | null;
    if (
      navState?.fromProforma &&
      navState.invoiceId &&
      !navStateHandled.current
    ) {
      navStateHandled.current = true;
      // Invalidate and refetch to ensure the newly created invoice appears
      queryClient.invalidateQueries({ queryKey: ["sales"] });
    }
  }, [location.state, queryClient]);

  // After invoices are (re)loaded, select the invoice from navigation state
  const navSelectHandled = useRef(false);
  useEffect(() => {
    const navState = location.state as {
      fromProforma?: boolean;
      invoiceId?: number;
      invoiceNo?: string;
    } | null;
    if (
      navState?.fromProforma &&
      navState.invoiceId &&
      invoices &&
      !navSelectHandled.current
    ) {
      const createdInvoice = invoices.find(
        (inv: Invoice) => inv.id === navState.invoiceId,
      );
      if (createdInvoice) {
        navSelectHandled.current = true;
        state.setSelectedItem(createdInvoice);
        showSuccessToast(
          `Navigated to Sales Order ${navState.invoiceNo || createdInvoice.invoice_no} created from proforma invoice`,
        );
        // Clear navigation state to prevent re-triggering
        window.history.replaceState({}, document.title);
      }
    }
  }, [invoices, location.state, state]);

  // Handle navigation from Proforma page: auto-create new SO with pre-filled items
  interface ProformaNavState {
    fromProforma?: boolean;
    createNew?: boolean;
    proformaId?: number;
    proformaNo?: string;
    customerId?: number;
    customer_agent_id?: number;
    branchCode?: string;
    remarks?: string;
    taxMode?: "none" | "inclusive" | "exclusive";
    taxRate?: number;
    source_quote_type?: string;
    advance_payment_id?: number;
    advance_amount?: number;
    items?: Array<{
      product_id: number;
      quantity: number;
      selling_price: number;
      minimum_selling_price: number;
      warrenty_month: string;
      product_name?: string;
      discount_percent?: number;
    }>;
  }
  const proformaCreateHandled = useRef(false);
  // Capture source_quote_id + product_ids before createMutation clears lineItems/formData
  const pendingQuoteRef = useRef<{ quoteId: number; productIds: number[] } | null>(null);
  useEffect(() => {
    const navState = location.state as ProformaNavState | null;
    if (
      navState?.fromProforma &&
      navState.createNew &&
      navState.proformaId &&
      !proformaCreateHandled.current
    ) {
      proformaCreateHandled.current = true;

      // Enter create mode
      state.setSelectedItem(null);
      state.setIsCreating(true);
      setFormStep(0);
      setLineItems([]);
      setBarcodeInput("");
      setBarcodeError(null);
      setValidatedBarcodes([]);
      setCouponCode("");
      setCouponValidation(null);
      setCouponError(null);
      setVoucherCode("");
      setAppliedVouchers([]);
      setVoucherError(null);
      setCreditNoteAmount(0);
      setDiscountType("percent");
      setDiscountValue(0);
      setTaxMode(navState.taxMode && navState.taxMode !== "none" ? navState.taxMode : "none");
      setTaxRate(navState.taxRate ?? companySettings?.default_tax_rate ?? 0);
      state.setFormData({
        invoice_no: "",
        branch_code: navState.branchCode || defaultBranchCode || "MAIN",
        customer_id: navState.customerId || 0,
        customer_agent_id: navState.customer_agent_id || undefined,
        sale_rep_id: 1,
        payment_method: "cash",
        cash_amount: 0,
        card_visa_amount: 0,
        card_mastercard_amount: 0,
        card_amex_amount: 0,
        cheque_amount: 0,
        bank_transfer_amount: 0,
        credit_amount: navState.advance_amount && navState.advance_amount > 0 ? navState.advance_amount : 0,
        payment_adjustments: 0,
        remarks: navState.remarks || "",
        special: false,
        items: [],
        source_quote_id: navState.proformaId,
        source_quote_type: navState.source_quote_type || "proforma",
        customer_advance_payments_id: navState.advance_payment_id,
      });

      // Pre-fill line items from proforma (without barcodes — user scans barcodes to assign)
      if (navState.items && navState.items.length > 0) {
        const prefilledItems: ItemFormData[] = navState.items.map((item) => ({
          product_id: item.product_id,
          quantity: item.quantity,
          selling_price: item.selling_price,
          minimum_selling_price: item.minimum_selling_price,
          warrenty_month: item.warrenty_month || "0",
          barcode: undefined,
          product_name: item.product_name || "",
          discount_percent: item.discount_percent || 0,
        }));
        setLineItems(prefilledItems);
      }

      showSuccessToast(
        `Creating Sales Order from ${navState.source_quote_type === 'quotation' ? 'Quotation' : 'Proforma'} ${navState.proformaNo}. Scan barcodes to assign stock items.`,
      );
      // Clear navigation state to prevent re-triggering
      window.history.replaceState({}, document.title);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  // Mutations
  const deleteMutation = useCrudMutation({
    mutationFn: salesApi.delete,
    invalidateQueryKeys: [["sales"]],
    successMessage: "Sales order deleted successfully",
    errorMessage: "Failed to delete sales order",
    onSuccess: () => {
      state.setSelectedItem(null);
    },
  });

  // Store payment method for navigation after create
  const [pendingPaymentMethod, setPendingPaymentMethod] = useState<string>("");

  const createMutation = useCrudMutation({
    mutationFn: salesApi.create,
    getInvalidateQueryKeys: (createdInvoice) => {
      const keys: Array<(string | number)[]> = [["sales"], ["sales-approved"], ["salesStock"]];
      if (createdInvoice?.id) {
        keys.push(["sales", createdInvoice.id]);
      }
      return keys;
    },
    errorMessage: "Failed to create sales order",
    onSuccess: async (createdInvoice) => {
      const paymentMethod = pendingPaymentMethod.toLowerCase();
      const isCreditPayment = paymentMethod === "credit";

      if (isCreditPayment) {
        showSuccessToast("Sales order created. Credit payment requires approval.");
      } else {
        showSuccessToast("Sales order created and payment completed successfully.");
      }

      // Commission created with 'pending' status - must go through approval workflow
      if (createdInvoice?.id && state.formData.customer_agent_id) {
        showSuccessToast("Agent commission created and pending approval.", { duration: 3000 });
      }

      window.dispatchEvent(new CustomEvent("sales-order-updated"));
      state.setIsCreating(false);
      setLineItems([]);
      setFormStep(0);
      state.setFormData(emptyInvoiceForm);
      setDiscountType("percent");
      setDiscountValue(0);
      setTaxRate(companySettings?.default_tax_rate ?? 0);
      setCouponCode("");
      setCouponValidation(null);
      setAppliedVouchers([]);
      state.setSelectedItem(createdInvoice as Invoice);
      setPendingPaymentMethod("");

      // If this SO was created from a quotation, mark those quote items as so_created
      const pendingQuote = pendingQuoteRef.current;
      pendingQuoteRef.current = null;
      if (pendingQuote && pendingQuote.productIds.length > 0) {
        try {
          await quotationApi.markItemsSoCreated(pendingQuote.quoteId, pendingQuote.productIds);
        } catch (err) {
          console.warn("Could not update quotation item statuses after SO creation:", err);
        }
      }
    },
    onError: () => {
      setPendingPaymentMethod("");
    },
  });

  const updateMutation = useCrudMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      salesApi.update(id, data),
    getInvalidateQueryKeys: () => {
      const keys: Array<(string | number)[]> = [["sales"], ["sales-approved"], ["salesStock"]];
      if (state.selectedItem?.id) {
        keys.push(["sales", state.selectedItem.id]);
      }
      return keys;
    },
    errorMessage: "Failed to update sales order",
    onSuccess: (updatedInvoice) => {
      const paymentMethod = pendingPaymentMethod.toLowerCase();
      const isCreditPayment = paymentMethod === "credit";

      if (isCreditPayment) {
        // Credit payment - needs approval after edit
        showSuccessToast(
          "Sales order updated. Credit payment requires approval.",
        );
      } else {
        // Cash/Card - completed status
        showSuccessToast("Sales order updated successfully.");
      }

      // Notify customer payments page to refresh
      window.dispatchEvent(new CustomEvent("sales-order-updated"));

      state.setIsCreating(false);
      state.setIsEditing(false);
      setLineItems([]);
      setFormStep(0);
      state.setFormData(emptyInvoiceForm);
      state.setSelectedItem(updatedInvoice as Invoice);
      setPendingPaymentMethod("");
    },
    onError: () => {
      setPendingPaymentMethod("");
    },
  });

  // Workflow mutations - Approve, Complete, Cancel
  const approveMutation = useCrudMutation({
    mutationFn: salesApi.approve,
    invalidateQueryKeys: [["sales"], ["sales-approved"]],
    successMessage: "Sales order approved successfully",
    errorMessage: "Failed to approve sales order",
    onSuccess: (updatedInvoice) => {
      state.setSelectedItem(updatedInvoice as Invoice);
    },
  });

  const cancelMutation = useCrudMutation({
    mutationFn: salesApi.cancel,
    invalidateQueryKeys: [["sales"], ["sales-approved"], ["salesStock"]],
    successMessage: "Sales order cancelled and stock restored",
    errorMessage: "Failed to cancel sales order",
    onSuccess: (updatedInvoice) => {
      state.setSelectedItem(updatedInvoice as Invoice);
    },
  });

  // Return-entire-invoice ("Return Invoice") state + mutation
  const [returnInvoiceDialogOpen, setReturnInvoiceDialogOpen] = useState(false);
  const [returnPaymentMethod, setReturnPaymentMethod] = useState("credit_note");
  const [returnReason, setReturnReason] = useState("customer_changed_mind");

  const returnFullMutation = useCrudMutation({
    mutationFn: (vars: {
      id: number;
      data: { payment_method: string; return_reason?: string };
    }) => salesApi.returnFull(vars.id, vars.data),
    invalidateQueryKeys: [["sales"], ["sales-approved"], ["sale-returns"]],
    successMessage:
      "Return invoice created. It now needs approval and processing to post the reversing financial records.",
    errorMessage: "Failed to create return invoice",
    onSuccess: () => {
      setReturnInvoiceDialogOpen(false);
    },
  });

  const handleReturnInvoice = () => {
    if (!state.selectedItem) return;
    returnFullMutation.mutate({
      id: state.selectedItem.id,
      data: {
        payment_method: returnPaymentMethod,
        return_reason: returnReason,
      },
    });
  };

  // Pending invoice for selection after discard confirm
  const [_pendingInvoice, setPendingInvoice] = useState<Invoice | null>(null);

  // Handlers
  const handleSelectInvoice = (invoice: Invoice) => {
    if (state.isCreating) {
      setPendingInvoice(invoice);
      discardDialog.open("Discard Changes", "Discard unsaved changes?", () => {
        state.setSelectedItem(invoice);
        state.setIsCreating(false);
        setPendingInvoice(null);
      });
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
    setManualBrandId(null);
    setManualProductId(null);
    setManualStockItems([]);
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
    setTaxRate(companySettings?.default_tax_rate ?? 0);
    // Reset commission override state
    setManualCommissionRate(null);
    setManualCommissionAmount(null);
    // Reset split payments
    setSplitPayments([makeSplitRow("cash", 0)]);
    setPaymentDetails({
      cheque_number: "",
      cheque_bank: "",
      cheque_date: new Date().toISOString().split("T")[0],
      card_ref_number: "",
      card_holder_name: "",
      bank_transfer_ref: "",
      bank_name: "",
      credit_note_id: 0,
      credit_note_amount: 0,
    });
    state.setFormData({
      invoice_no: "",
      branch_code: defaultBranchCode || "MAIN",
      customer_id: customers?.[0]?.id || 0,
      customer_agent_id: undefined,
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
    if (
      state.selectedItem.approval_status === "completed" ||
      state.selectedItem.approval_status === "cancelled"
    ) {
      return;
    }

    // Load invoice data into form
    state.setIsEditing(true);
    state.setIsCreating(false);
    setFormStep(0);
    setBarcodeInput("");
    setBarcodeError(null);
    setValidatedBarcodes([]);
    setManualBrandId(null);
    setManualProductId(null);
    setManualStockItems([]);
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
      cheque_date: new Date().toISOString().split("T")[0],
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
      customer_agent_id: state.selectedItem.customer_agent_id || undefined,
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

  const saveInProgressRef = useRef(false);

  const handleSave = async () => {
    // Prevent double-submit during async credit-check / confirm-dialog window
    if (saveInProgressRef.current || createMutation.isPending || updateMutation.isPending) return;
    saveInProgressRef.current = true;
    try {
    // Validate that all selling prices are not below minimum prices
    const invalidItems = lineItems.filter(
      (item) => item.selling_price < item.minimum_selling_price,
    );
    if (invalidItems.length > 0) {
      showErrorToast(
        "Cannot save: Some items have selling price below minimum price",
      );
      return;
    }

    // Validate that total split payment amounts match the grand total
    const totals = calcOrderTotals();
    const checkGrandTotal = totals.grandTotal;
    const entered = splitPayments.reduce((s, p) => s + (p.amount || 0), 0);
    const remaining = checkGrandTotal - entered;
    const isBalanced = Math.abs(remaining) < 0.01;

    if (!isBalanced) {
      showErrorToast(
        `Cannot save: Total payments entered (Rs. ${fmtLKR(entered)}) must equal the grand total (Rs. ${fmtLKR(checkGrandTotal)}). Remaining: Rs. ${fmtLKR(remaining)}`
      );
      return;
    }

    // Calculate effective price per item after all discounts (item + coupon + invoice discount)
    // and validate that no item goes below minimum price
    // Flow: Normalize → Item Discount → Coupon → Invoice Discount → Tax
    const subtotalAfterItemDiscounts = calculateLineItemsTotal();

    // For inclusive, normalize to net for discount calculations
    const netSubtotalForValidation = (taxMode === "inclusive" && effectiveTaxRate > 0)
      ? subtotalAfterItemDiscounts / (1 + effectiveTaxRate / 100)
      : subtotalAfterItemDiscounts;

    // Calculate coupon discount percentage (applied first on net subtotal)
    const validationCouponDiscount = couponValidation?.calculated_discount || 0;
    const couponDiscountPercent =
      netSubtotalForValidation > 0
        ? (validationCouponDiscount / netSubtotalForValidation) * 100
        : 0;

    // Calculate amount after coupon for invoice discount percentage
    const afterCouponValidation =
      netSubtotalForValidation * (1 - couponDiscountPercent / 100);
    const invoiceDiscountPercent =
      discountType === "percent"
        ? discountValue
        : afterCouponValidation > 0
          ? (discountValue / afterCouponValidation) * 100
          : 0;

    // Check each item's effective price after all discounts
    const invalidDiscountItems = lineItems.filter((item) => {
      const itemDiscountPercent = item.discount_percent || 0;

      // Step 1: Apply item discount
      let priceAfterItemDiscount =
        item.selling_price * (1 - itemDiscountPercent / 100);

      // For inclusive, normalize item price to net
      if (taxMode === "inclusive" && effectiveTaxRate > 0) {
        priceAfterItemDiscount = priceAfterItemDiscount / (1 + effectiveTaxRate / 100);
      }

      // Step 2: Apply coupon discount (proportionally)
      const priceAfterCoupon =
        priceAfterItemDiscount * (1 - couponDiscountPercent / 100);

      // Step 3: Apply invoice discount (proportionally)
      const effectivePrice =
        priceAfterCoupon * (1 - invoiceDiscountPercent / 100);

      return effectivePrice < item.minimum_selling_price;
    });

    if (invalidDiscountItems.length > 0) {
      const itemNames = invalidDiscountItems
        .map((item) => item.product_name || `Product #${item.product_id}`)
        .join(", ");
      showErrorToast(
        `Cannot save: Total discounts bring ${invalidDiscountItems.length} item(s) below minimum price: ${itemNames}`,
      );
      return;
    }

    const subtotal = calculateLineItemsTotal();
    const paymentMethod = state.formData.payment_method || "cash";
    
    let splitCreditPay = splitPayments.filter((p) => p.method === "credit").reduce((s, p) => s + (p.amount || 0), 0);
    const hasCreditPayment = splitPayments.some((p) => p.method === "credit") || paymentMethod === "credit";
    const creditCheckAmount = splitCreditPay > 0 ? splitCreditPay : calcOrderTotals().grandTotal;

    // Track if user has overridden credit validation
    let creditValidationOverridden = false;

    // Comprehensive credit sale validation (blocking)
    if (hasCreditPayment && state.formData.customer_id) {
      try {
        // Use comprehensive validation with blocking by default
        const validation = await customersApi.validateCreditSale(
          state.formData.customer_id,
          creditCheckAmount,
          { skipTimeCheck: false, allowOverLimit: false },
        );

        // If validation failed, show errors and block
        if (!validation.allowed) {
          const errorMessages = validation.errors || [];

          // Build detailed error display
          const detailLines: {
            label: string;
            value: string;
            color?: string;
            strong?: boolean;
          }[] = [];

          // Time check info
          if (validation.time_check && !validation.time_check.allowed) {
            detailLines.push({
              label: "Current Time",
              value: validation.time_check.current_time,
              color: "error.main",
            });
            detailLines.push({
              label: "Allowed Hours",
              value: `${validation.time_check.allowed_start} - ${validation.time_check.allowed_end}`,
            });
          }

          // Customer check errors
          if (validation.customer_check && !validation.customer_check.valid) {
            validation.customer_check.errors.forEach((err: string) => {
              detailLines.push({
                label: "❌",
                value: err,
                color: "error.main",
              });
            });
          }

          // Credit limit info
          if (validation.credit_check) {
            detailLines.push({
              label: "Credit Limit",
              value: `Rs. ${fmtLKR(Number(validation.credit_check.max_credit_limit || 0))}`,
            });
            detailLines.push({
              label: "Current Outstanding",
              value: `Rs. ${fmtLKR(Number(validation.credit_check.current_outstanding || 0))}`,
            });
            detailLines.push({
              label: "This Order",
              value: `Rs. ${fmtLKR(Number(validation.credit_check.new_credit_amount || 0))}`,
            });
            if (validation.credit_check.will_exceed_limit) {
              detailLines.push({
                label: "Exceeds by",
                value: `Rs. ${fmtLKR(Number(validation.credit_check.excess_amount || 0))}`,
                color: "error.main",
                strong: true,
              });
            }
          }

          const confirmed = await creditWarningDialog.confirm({
            title: "Credit Sale Not Allowed",
            message: errorMessages.join("\n"),
            detailsLines: detailLines.length > 0 ? detailLines : undefined,
            detailsNote:
              "Please resolve the above issues before proceeding with a credit sale.",
            confirmText: "Proceed Anyway",
            cancelText: "Cancel",
            type: "danger",
          });

          if (!confirmed) {
            return; // Block the sale only if user cancels
          }
          // If user clicked "Proceed Anyway", set override flag
          creditValidationOverridden = true;
        }

        // Show warnings if any (but allow to proceed)
        if (validation.warnings && validation.warnings.length > 0) {
          const customer = customers?.find(
            (c) => c.id === state.formData.customer_id,
          );
          const customerName = customer?.customer_name || "Customer";

          const detailLines: {
            label: string;
            value: string;
            color?: string;
            strong?: boolean;
          }[] = [{ label: "Customer", value: customerName }];

          if (validation.credit_check) {
            detailLines.push({
              label: "Credit Limit",
              value: `Rs. ${fmtLKR(Number(validation.credit_check.max_credit_limit || 0))}`,
            });
            detailLines.push({
              label: "Available Credit",
              value: `Rs. ${fmtLKR(Number(validation.credit_check.available_credit || 0))}`,
            });
            if (validation.credit_check.overdue_count > 0) {
              detailLines.push({
                label: "Overdue Invoices",
                value: String(validation.credit_check.overdue_count),
                color: "warning.main",
              });
            }
          }

          const confirmed = await creditWarningDialog.confirm({
            title: "Credit Sale Warning",
            message: "",
            detailsLines: detailLines,
            detailsNote:
              validation.warnings.join(". ") +
              " Credit sale requires finance approval.",
            confirmText: "Continue",
            cancelText: "Cancel",
            type: "warning",
          });

          if (!confirmed) {
            return;
          }
        }
      } catch (error: unknown) {
        showErrorToast(
          handleApiError(
            error,
            "Failed to validate credit sale. Please try again.",
          ),
        );
        return;
      }
    }

    // Use centralized calculation following the flow:
    // Normalize → Item Discount → Coupon → Invoice Discount → Tax → Payments
    const t = calcOrderTotals();
    const invoiceDiscount = t.invoiceDiscount;
    const couponDiscount = t.couponDiscount;
    const taxAmount = t.taxAmount;
    const afterTax = t.afterTax;
    const totalVoucherPayment = t.totalVoucherPayment;
    const afterVoucher = t.afterVoucher;
    const appliedCreditNote = t.appliedCreditNote;
    const afterCreditNote = t.afterCreditNote;
    let serviceCharge = 0;
    if (selectedPaymentCard && (selectedPaymentCard.service_charge_percent || 0) > 0) {
      const chargePercent = selectedPaymentCard.service_charge_percent || 0;
      const isSingleCard = paymentMethod === "card" && splitPayments.length <= 1;
      const hasCardInSplit = splitPayments.length > 1 && splitPayments.some(p => p.method === "card");
      if (isSingleCard) {
        serviceCharge = afterCreditNote * (chargePercent / 100);
      } else if (hasCardInSplit) {
        const nonCardTotal = splitPayments
          .filter(p => p.method !== "card")
          .reduce((s, p) => s + (p.amount || 0), 0);
        const cardBase = Math.max(0, afterCreditNote - nonCardTotal);
        serviceCharge = cardBase * (chargePercent / 100);
      }
    }
    const grandTotal = Math.max(0, afterCreditNote + serviceCharge);

    // Aggregate split payment amounts
    const splitCash = splitPayments.filter((p) => p.method === "cash").reduce((s, p) => s + (p.amount || 0), 0);
    const splitCard = splitPayments.filter((p) => p.method === "card").reduce((s, p) => s + (p.amount || 0), 0);
    const splitCheque = splitPayments.filter((p) => p.method === "cheque").reduce((s, p) => s + (p.amount || 0), 0);
    const splitBank = splitPayments.filter((p) => p.method === "bank_transfer").reduce((s, p) => s + (p.amount || 0), 0);
    splitCreditPay = splitPayments.filter((p) => p.method === "credit").reduce((s, p) => s + (p.amount || 0), 0);
    const firstChequeRow = splitPayments.find((p) => p.method === "cheque");
    const firstCardRow = splitPayments.find((p) => p.method === "card");
    const firstBankRow = splitPayments.find((p) => p.method === "bank_transfer");
    const firstCreditRow = splitPayments.find((p) => p.method === "credit");
    const primaryMethod = splitPayments.length === 1 ? splitPayments[0].method : (splitPayments.length > 0 ? splitPayments[0].method : paymentMethod);

    const invoiceData: InvoiceCreate = {
      ...(state.formData as InvoiceCreate),
      payment_method: primaryMethod,
      cash_amount: splitCash,
      card_visa_amount: splitCard,
      card_mastercard_amount: 0,
      card_amex_amount: 0,
      cheque_amount: splitCheque,
      bank_transfer_amount: splitBank,
      credit_amount: splitCreditPay,
      // Include service charge in payment adjustments (for card payments)
      payment_adjustments: serviceCharge,
      items: lineItems,
      // Tax and Discount fields
      is_tax_invoice: taxMode === "inclusive",
      tax_rate: effectiveTaxRate,
      discount_percent: discountType === "percent" ? discountValue : 0,
      discount_amount:
        discountType === "amount" ? discountValue : invoiceDiscount, // Store calculated amount
      // Coupon/Discount code fields
      ...(couponValidation?.coupon_id && {
        cupon_id: couponValidation.coupon_id,
        cupon_amount: couponDiscount,
      }),
      // Pass agent commission rate and amount overrides
      agent_commission_rate: manualCommissionRate !== null ? manualCommissionRate : undefined,
      agent_commission_amount: manualCommissionAmount !== null ? manualCommissionAmount : undefined,
      // Credit note redemption
      credit_note_amount: appliedCreditNote,
      // Credit validation override flag
      override_credit_validation: creditValidationOverridden,
      // Gift voucher payment fields - send as array for multiple vouchers
      ...(appliedVouchers.length > 0 &&
        totalVoucherPayment > 0 && {
          gift_voucher_id: appliedVouchers[0].validation.voucher_id, // Legacy field
          gift_voucher_amount: totalVoucherPayment, // Total from all vouchers
          voucher_redemptions: appliedVouchers
            .filter((v) => v.validation.voucher_id) // Ensure voucher_id exists
            .map((v) => ({
              voucher_id: v.validation.voucher_id!,
              amount_to_redeem: Number(v.amountToRedeem),
            })),
        }),
      // Include payment details from split rows
      ...(firstChequeRow && {
        cheque_number: firstChequeRow.cheque_number,
        cheque_bank: firstChequeRow.cheque_bank,
        cheque_date: firstChequeRow.cheque_date,
      }),
      ...(firstCardRow && selectedPaymentCard && {
        card_ref_number: firstCardRow.card_ref_number,
        card_holder_name: firstCardRow.card_holder_name,
        payment_card_id: selectedPaymentCard.id,
      }),
      ...(firstBankRow && {
        bank_transfer_ref: firstBankRow.bank_transfer_ref,
        bank_name: firstBankRow.bank_name,
      }),
      ...(firstCreditRow && {
        credit_terms: firstCreditRow.credit_terms,
      }),
      ...(paymentMethod === "credit_note" &&
        paymentDetails.credit_note_id && {
          credit_note_id: paymentDetails.credit_note_id,
        }),
    };

    // Store payment method for post-creation/update navigation
    setPendingPaymentMethod(paymentMethod);

    if (state.isEditing && state.selectedItem) {
      // Update existing invoice
      updateMutation.mutate({
        id: state.selectedItem.id,
        data: { items: lineItems },
      });
    } else {
      // Create new invoice
      // Capture source_quote_id before formData is cleared in onSuccess
      const sourceQuoteId = (state.formData as any).source_quote_id as number | undefined;
      if (sourceQuoteId) {
        pendingQuoteRef.current = {
          quoteId: sourceQuoteId,
          productIds: lineItems.map(li => li.product_id).filter((id): id is number => !!id),
        };
      } else {
        pendingQuoteRef.current = null;
      }
      createMutation.mutate(invoiceData);
    }
    } finally {
      saveInProgressRef.current = false;
    }
  };

  const handleCancel = () => {
    state.setIsCreating(false);
    state.setIsEditing(false);
    setLineItems([]);
    setFormStep(0);
    setValidatedBarcodes([]);
    setManualBrandId(null);
    setManualProductId(null);
    setManualStockItems([]);
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
        () => deleteMutation.mutate(state.selectedItem!.id),
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

  // Manual picker: sync default branch to order's branch when it changes or when navigating steps
  useEffect(() => {
    if (state.formData.branch_code) {
      setManualBranchCode(state.formData.branch_code);
    }
  }, [state.formData.branch_code, formStep]);

  // Manual picker: load available stock when product or branch changes
  useEffect(() => {
    const branch = manualBranchCode || state.formData.branch_code;
    if (!manualProductId || !branch) {
      setManualStockItems([]);
      return;
    }
    let cancelled = false;
    setIsLoadingManualStock(true);
    salesStockApi
      .getAll({
        branch_code: branch,
        product_id: manualProductId,
        status: "available",
      })
      .then((items) => {
        if (!cancelled) setManualStockItems(items);
      })
      .catch(() => {
        if (!cancelled) setManualStockItems([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingManualStock(false);
      });
    return () => {
      cancelled = true;
    };
  }, [manualProductId, manualBranchCode, state.formData.branch_code]);

  // Manual picker: reset product list when brand changes
  useEffect(() => {
    setManualProductId(null);
    setManualStockItems([]);
  }, [manualBrandId]);

  // Manual picker: add a specific stock item to the line
  const handleAddManualStockItem = useCallback(
    (stockItem: SalesStock) => {
      const alreadyAdded = lineItems.some(
        (item) => item.barcode === stockItem.barcode,
      );
      if (alreadyAdded) {
        showErrorToast("This barcode is already in the order");
        return;
      }
      const productObj = products.find(
        (p: any) => p.id === stockItem.product_id,
      );
      const sellingPrice =
        stockItem.selling_price ?? productObj?.selling_price ?? 0;
      const minimumPrice =
        stockItem.minimum_selling_price ??
        (productObj as any)?.minimum_price ??
        sellingPrice;
      const newItem: ItemFormData = {
        product_id: stockItem.product_id,
        quantity: 1,
        selling_price: sellingPrice,
        minimum_selling_price: minimumPrice,
        warrenty_month: stockItem.warranty_month ?? "0",
        barcode: stockItem.barcode,
        product_name: stockItem.product_name ?? productObj?.name ?? "",
        branch_code: stockItem.branch_code,
        price_tier_id: (stockItem as any).price_tier_id,
      };
      setLineItems((prev) => [...prev, newItem]);
      setValidatedBarcodes((prev) => [...prev, stockItem.barcode]);
      // Remove from manual list so it can't be added twice
      setManualStockItems((prev) =>
        prev.filter((s) => s.barcode !== stockItem.barcode),
      );
      showSuccessToast(`Added: ${newItem.product_name || "Item"}`);
    },
    [lineItems, products],
  );

  // Step navigation functions
  const handleNextStep = () => {
    if (formStep < FORM_STEPS.length - 1) {
      if (formStep === 0) {
        // Initialize split payments with full grand total in chosen method
        const totals = calcOrderTotals();
        const initMethod = state.formData.payment_method || "cash";
        setSplitPayments([makeSplitRow(initMethod, totals.grandTotal)]);
      }
      setFormStep((prev) => prev + 1);
    }
  };

  const handlePreviousStep = () => {
    if (formStep > 0) setFormStep((prev) => prev - 1);
  };

  // Step 1 validation - require customer and invoice number
  // When creating, invoice_no is auto-generated (nextInvoiceNumber) and not stored in formData until submit
  const effectiveInvoiceNo = state.isCreating
    ? nextInvoiceNumber
    : state.formData.invoice_no;
  const isStep1Valid =
    effectiveInvoiceNo &&
    state.formData.customer_id &&
    state.formData.customer_id > 0;

  const updateLineItem = (
    index: number,
    field: keyof ItemFormData,
    value: number | string,
  ) => {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };
    setLineItems(updated);
  };

  // Barcode validation handler
  const handleValidateBarcode = useCallback(
    async (barcode: string) => {
      if (!barcode.trim()) {
        setBarcodeError("Please enter a barcode");
        return;
      }

      // Check if this exact barcode has already been scanned
      const existingItem = lineItems.find(
        (item) => item.barcode === barcode.trim(),
      );

      if (existingItem) {
        setBarcodeError("This barcode has already been scanned");
        return;
      }

      setIsValidatingBarcode(true);
      setBarcodeError(null);

      try {
        const response = await apiClient.get(
          `/inventory/sales-stock/barcode/${barcode.trim()}`,
        );
        const stockItem = response.data;

        if (stockItem.status !== "available") {
          setBarcodeError("This item is not available for sale");
          return;
        }

        // Check if item belongs to the selected branch
        const selectedBranch = state.formData.branch_code;
        if (stockItem.branch_code !== selectedBranch) {
          setBarcodeError(
            `This item belongs to branch ${stockItem.branch_code}, but you selected ${selectedBranch}`,
          );
          return;
        }

        // Get prices from product relationship or top-level fields
        const sellingPrice =
          stockItem.selling_price || stockItem.product?.selling_price || 0;
        const minimumPrice =
          stockItem.minimum_price ||
          stockItem.product?.minimum_price ||
          sellingPrice;
        const warrantyMonths =
          stockItem.warranty_month || stockItem.product?.warrenty_month || "0";
        const productName =
          stockItem.product_name ||
          stockItem.product?.product_name ||
          stockItem.product?.name ||
          "";

        // === Proforma mode: assign barcode to existing pre-filled item ===
        const isFromProforma = !!(state.formData as any).source_quote_id;
        if (isFromProforma) {
          // Find a pre-filled item matching this product that doesn't yet have a barcode
          const unassignedIdx = lineItems.findIndex(
            (item) => item.product_id === stockItem.product_id && !item.barcode,
          );
          if (unassignedIdx >= 0) {
            // Assign barcode to the existing item
            setLineItems((prev) =>
              prev.map((item, idx) =>
                idx === unassignedIdx
                  ? {
                      ...item,
                      barcode: barcode.trim(),
                      product_name: productName || item.product_name,
                      branch_code: stockItem.branch_code,
                      price_tier_id: stockItem.price_tier_id,
                    }
                  : item,
              ),
            );
            setValidatedBarcodes((prev) => [...prev, barcode.trim()]);
            setBarcodeInput("");
            barcodeInputRef.current?.focus();
            showSuccessToast(
              `Assigned barcode to: ${productName || "Product"}`,
            );
            return;
          } else {
            // No unassigned item for this product — check if ALL items for this product are assigned
            const hasProductAtAll = lineItems.some(
              (item) => item.product_id === stockItem.product_id,
            );
            if (hasProductAtAll) {
              setBarcodeError(
                `All items for ${productName || "this product"} already have barcodes assigned`,
              );
              return;
            }
            // Product not in proforma list — add as extra item (fall through to normal flow)
          }
        }

        // === Normal mode: add new line item ===
        const newItem: ItemFormData = {
          product_id: stockItem.product_id,
          quantity: 1,
          selling_price: sellingPrice,
          minimum_selling_price: minimumPrice,
          warrenty_month: warrantyMonths?.toString() || "0",
          barcode: barcode.trim(),
          product_name: productName,
          branch_code:
            stockItem.branch_code || state.formData.branch_code || "",
          price_tier_id: stockItem.price_tier_id,
        };
        setLineItems((prev) => [...prev, newItem]);
        setValidatedBarcodes((prev) => [...prev, barcode.trim()]);

        setBarcodeInput("");
        barcodeInputRef.current?.focus();
        showSuccessToast(`Added: ${productName || "Product"}`);
      } catch (error) {
        setBarcodeError(
          handleApiError(error, "Barcode not found in available stock"),
        );
      } finally {
        setIsValidatingBarcode(false);
      }
    },
    [lineItems, products, state.formData.branch_code, state.formData],
  );

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
      // Send normalized net subtotal (after tax normalization for inclusive)
      const gross = calculateLineItemsTotal();
      const netSubtotal = (taxMode === "inclusive" && effectiveTaxRate > 0)
        ? Math.round((gross / (1 + effectiveTaxRate / 100)) * 100) / 100
        : gross;
      const productIds = lineItems.map((item) => item.product_id);

      const response = await couponsApi.validate({
        coupon_code: couponCode.trim(),
        customer_id: state.formData.customer_id,
        invoice_subtotal: netSubtotal,
        invoice_discount_type: discountType,
        invoice_discount_value: discountValue,
        product_ids: productIds,
        line_items: lineItems.map((item) => ({
          product_id: item.product_id,
          quantity: item.quantity,
          selling_price: item.selling_price,
        })),
      });

      if (response.valid) {
        setCouponValidation(response);
        showSuccessToast(
          `Coupon applied! Discount: Rs. ${fmtLKR(response.calculated_discount || 0)}`,
        );
      } else {
        setCouponError(response.message);
        setCouponValidation(null);
      }
    } catch (error) {
      setCouponError(handleApiError(error, "Failed to validate coupon"));
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
      // Calculate amount due using centralized calculation (correct order)
      const t = calcOrderTotals();
      const amountDue = t.afterTax - t.totalVoucherPayment;

      const response = await vouchersApi.validate({
        barcode_no: voucherCode.trim(),
        invoice_amount_due: amountDue,
      });

      if (response.valid) {
        // Check if this voucher is already applied
        const alreadyApplied = appliedVouchers.some(
          (v) => v.validation.voucher_id === response.voucher_id,
        );
        if (alreadyApplied) {
          setVoucherError("This voucher has already been applied");
          showErrorToast("This voucher has already been applied");
        } else {
          // Add voucher to the list
          setAppliedVouchers((prev) => [
            ...prev,
            {
              validation: response,
              amountToRedeem: Number(response.redeemable_amount) || 0,
            },
          ]);
          setVoucherCode(""); // Clear input for next voucher
          showSuccessToast(
            `Voucher added! Balance: Rs. ${fmtLKR(response.balance || 0)}`,
          );
        }
      } else {
        setVoucherError(response.message);
      }
    } catch (error) {
      setVoucherError(handleApiError(error, "Failed to validate voucher"));
    } finally {
      setIsValidatingVoucher(false);
    }
  }, [voucherCode, lineItems, couponValidation, appliedVouchers]);

  // Remove a specific voucher
  const handleRemoveVoucher = (voucherId: number) => {
    setAppliedVouchers((prev) =>
      prev.filter((v) => v.validation.voucher_id !== voucherId),
    );
  };

  // Clear all vouchers
  const handleClearAllVouchers = () => {
    setVoucherCode("");
    setAppliedVouchers([]);
    setVoucherError(null);
  };

  // Auto-focus barcode field when entering Step 2
  useEffect(() => {
    if (formStep === 1) {
      setTimeout(() => barcodeInputRef.current?.focus(), 150);
    }
  }, [formStep]);

  // Stable fingerprint of line items data for dependency tracking
  // Changes when any item's price, quantity, or discount changes
  const lineItemsFingerprint = useMemo(
    () => lineItems.map(i => `${i.product_id}:${i.quantity}:${i.selling_price}:${i.discount_percent || 0}`).join('|'),
    [lineItems],
  );

  // Auto-revalidate coupon when line items change (with debouncing)
  useEffect(() => {
    if (
      !couponValidation ||
      !couponCode ||
      lineItems.length === 0 ||
      !state.formData.customer_id
    ) {
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
        // Send normalized net subtotal (after tax normalization for inclusive)
        const gross = calculateLineItemsTotal();
        const netSubtotal = (taxMode === "inclusive" && effectiveTaxRate > 0)
          ? Math.round((gross / (1 + effectiveTaxRate / 100)) * 100) / 100
          : gross;
        const productIds = lineItems.map((item) => item.product_id);

        const response = await couponsApi.validate({
          coupon_code: couponCode.trim(),
          customer_id: state.formData.customer_id!,
          invoice_subtotal: netSubtotal,
          invoice_discount_type: discountType,
          invoice_discount_value: discountValue,
          product_ids: productIds,
          line_items: lineItems.map((item) => ({
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
      } catch (error: unknown) {
        setCouponValidation(null);
        setCouponError("Coupon validation failed");
      }
    }, 500); // Wait 500ms after last change before revalidating

    return () => clearTimeout(timeoutId);
  }, [
    lineItemsFingerprint,
    couponCode,
    state.formData.customer_id,
    taxMode,
    effectiveTaxRate,
  ]); // Revalidate when items, prices, discounts, or tax mode changes

  // Custom actions for toolbar
  const customActions =
    state.selectedItem && !state.isCreating && !state.isEditing ? (
      <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
        {/* Standard Actions */}
        <Button
          size="small"
          variant="outlined"
          startIcon={<EditIcon />}
          onClick={handleEdit}
          disabled={
            state.selectedItem.approval_status === "completed" ||
            state.selectedItem.approval_status === "cancelled"
          }
        >
          Edit
        </Button>
        <Tooltip title={!canPrintDocument(state.selectedItem.approval_status, ["cancelled"]) ? `Cannot email: invoice is ${(state.selectedItem.approval_status || "").replace(/_/g, " ")}` : "Send via Email"}>
          <span>
            <Button size="small" variant="outlined" color="primary" startIcon={<EmailIcon />}
              disabled={!canPrintDocument(state.selectedItem.approval_status, ["cancelled"])}
              onClick={() => setEmailDialogOpen(true)}>
              Email
            </Button>
          </span>
        </Tooltip>
        <TPrintButton
          documentType="invoice"
          documentId={state.selectedItem.id}
          disabled={
            !canPrintDocument(state.selectedItem.approval_status, ["cancelled"])
          }
          disabledReason={`Cannot print: invoice is ${(state.selectedItem.approval_status || "").replace(/_/g, " ")}`}
          tooltip="Print Invoice"
          onClick={() => {
            setSelectedItemForPrint(state.selectedItem);
            setPrintDialogOpen(true);
          }}
        />
        {canCreateReturn &&
          (state.selectedItem.approval_status === "completed" ||
            state.selectedItem.approval_status === "approved") && (
            <Tooltip title="Return the entire invoice (creates a full sale return for approval)">
              <Button
                size="small"
                variant="outlined"
                color="warning"
                startIcon={<AssignmentReturnIcon />}
                onClick={() => {
                  setReturnPaymentMethod("credit_note");
                  setReturnReason("customer_changed_mind");
                  setReturnInvoiceDialogOpen(true);
                }}
              >
                Return Invoice
              </Button>
            </Tooltip>
          )}
      </Box>
    ) : undefined;

  // Render view invoice details
  const renderViewInvoice = () => {
    const customer = customers?.find(
      (c) => c.id === state.selectedItem?.customer_id,
    );
    const productMap = new Map(products.map((p: any) => [p.id, p]));

    return (
      <>
        {/* Order Information */}
        <FormSection title="Order Information" columns={2}>
          <TextField
            label="Invoice Number"
            size="small"
            value={state.selectedItem?.invoice_no}
            disabled
          />
          <TextField
            label="Branch"
            size="small"
            value={state.selectedItem?.branch_code}
            disabled
          />
        </FormSection>

        {/* Customer Information */}
        <FormSection title="Customer Information" columns={2}>
          <TextField
            label="Customer Name"
            size="small"
            value={customer?.customer_name || ""}
            disabled
          />
          <TextField
            label="Company"
            size="small"
            value={customer?.company_name || "N/A"}
            disabled
          />
          <TextField
            label="Contact"
            size="small"
            value={customer?.mobile_contact_number || ""}
            disabled
          />
          <TextField
            label="Email"
            size="small"
            value={customer?.email || "N/A"}
            disabled
          />
        </FormSection>

        {/* Dates & Payment */}
        <FormSection title="Dates & Payment" columns={2}>
          <TextField
            label="Order Date"
            size="small"
            value={
              state.selectedItem
                ? new Date(state.selectedItem.created_date).toLocaleDateString()
                : ""
            }
            disabled
          />
          <TextField
            label="Credit Amount"
            size="small"
            value={`Rs. ${fmtLKR(state.selectedItem?.credit_amount || 0)}`}
            disabled
          />
        </FormSection>

        {/* Order Status */}
        <FormSection title="Order Status" columns={1}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Status:
            </Typography>
            <TStatusChip
              status={
                state.selectedItem?.approval ? "approved" : "pending_approval"
              }
              statusMap="salesOrder"
            />
          </Box>
        </FormSection>

        {/* Tracking */}
        <FormSection title="Tracking" columns={2}>
          <TextField
            label="Created Date"
            size="small"
            value={
              state.selectedItem?.created_at
                ? new Date(state.selectedItem.created_at).toLocaleString()
                : ""
            }
            disabled
            InputProps={{ readOnly: true }}
          />
          <TextField
            label="Order Date"
            size="small"
            value={
              state.selectedItem?.created_date
                ? new Date(state.selectedItem.created_date).toLocaleDateString()
                : ""
            }
            disabled
            InputProps={{ readOnly: true }}
          />
          <TextField
            label="Created By"
            size="small"
            value={fullInvoice?.created_by_name || state.selectedItem?.created_by_name || "—"}
            disabled
            InputProps={{ readOnly: true }}
          />
          {((fullInvoice?.credit_amount ?? 0) > 0 || 
            fullInvoice?.payment_method?.toLowerCase() === "credit" ||
            fullInvoice?.payment_method?.toLowerCase() === "bank_transfer") && (
            <>
              <TextField
                label="Approved By"
                size="small"
                value={fullInvoice?.approved_by_name || "—"}
                disabled
                InputProps={{ readOnly: true }}
              />
              <TextField
                label="Approved Date"
                size="small"
                value={
                  fullInvoice?.approved_date
                    ? new Date(fullInvoice.approved_date).toLocaleString()
                    : "—"
                }
                disabled
                InputProps={{ readOnly: true }}
              />
            </>
          )}
        </FormSection>

        {/* Order Items */}
        {fullInvoice?.items && (
          <FormSection title="Order Items" columns={1}>
            <Paper
              variant="outlined"
              sx={{
                overflow: "hidden",
                width: "100%",
                borderRadius: 2,
                border: "1px solid",
                borderColor: "divider",
              }}
            >
              <Table size="small" sx={{ tableLayout: "fixed", width: "100%" }}>
                <TableHead>
                  <TableRow sx={modernTableStyles.headerRow}>
                    <TableCell sx={{ width: 110 }}>Barcode</TableCell>
                    <TableCell sx={{ width: 200 }}>Product</TableCell>
                    <TableCell align="right" sx={{ width: 120 }}>Unit Price (Rs.)</TableCell>
                    <TableCell align="right" sx={{ width: 70 }}>Disc %</TableCell>
                    <TableCell align="center" sx={{ width: 80 }}>Warranty</TableCell>
                    <TableCell sx={{ width: 120 }}>Remark</TableCell>
                    <TableCell align="right" sx={{ width: 140 }}>Net Amount (Rs.)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {fullInvoice.items.map((item: any, index: number) => {
                    const product = productMap.get(item.product_id);
                    const isTaxInclusive = fullInvoice.is_tax_invoice;
                    const taxRate = fullInvoice.tax_rate || 0;

                    const displaySellingPrice = isTaxInclusive && taxRate > 0
                      ? item.selling_price / (1 + taxRate / 100)
                      : item.selling_price;

                    const lineGross = item.quantity * displaySellingPrice;
                    const discAmt = item.discount_amount > 0
                      ? (isTaxInclusive && taxRate > 0 ? item.discount_amount / (1 + taxRate / 100) : item.discount_amount)
                      : lineGross * ((item.discount_percent || 0) / 100);
                    const netAmount = item.line_total > 0
                      ? (isTaxInclusive && taxRate > 0 ? item.line_total / (1 + taxRate / 100) : item.line_total)
                      : lineGross - discAmt;
                    return (
                      <TableRow
                        key={index}
                        sx={{
                          ...modernTableStyles.bodyRow,
                          ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                        }}
                      >
                        <TableCell>
                          <Typography
                            variant="body2"
                            sx={{ fontFamily: "monospace", color: item.barcode ? "success.main" : "text.disabled", fontWeight: item.barcode ? 500 : 400 }}
                          >
                            {item.barcode || "-"}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {product?.name || `Product #${item.product_id}`}
                        </TableCell>
                        <TableCell align="right">
                          {fmtLKR(displaySellingPrice)}
                        </TableCell>
                        <TableCell align="right">
                          {(item.discount_percent || 0) > 0 ? (
                            <Typography variant="body2" color="warning.main" fontWeight="medium">
                              {Number(item.discount_percent).toFixed(1)}%
                            </Typography>
                          ) : (
                            <Typography variant="body2" color="text.disabled">—</Typography>
                          )}
                        </TableCell>
                        <TableCell align="center">
                          {item.warrenty_month || "0"} mo
                        </TableCell>
                        <TableCell>
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 0.5,
                            }}
                          >
                            <Typography
                              variant="body2"
                              sx={{
                                maxWidth: 80,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {item.remark || "-"}
                            </Typography>
                            <Tooltip title="View Remark">
                              <IconButton
                                size="small"
                                onClick={() => {
                                  setCurrentItemRemark(item.remark || "");
                                  setItemRemarkModalOpen(true);
                                }}
                              >
                                <MenuBookIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        </TableCell>
                        <TableCell align="right">
                          <Box sx={{ textAlign: "right" }}>
                            <Typography variant="body2" fontWeight="medium">
                              {fmtLKR(netAmount)}
                            </Typography>
                            {(item.discount_percent || 0) > 0 && (
                              <Typography variant="caption" color="text.disabled" sx={{ textDecoration: "line-through" }}>
                                {fmtLKR(lineGross)}
                              </Typography>
                            )}
                          </Box>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Paper>
          </FormSection>
        )}

        {/* Payment Breakdown */}
        {fullInvoice && (
          <FormSection title="Payment Breakdown" columns={1}>
            <Grid container spacing={3}>
              {/* Settlement Breakdown */}
              <Grid item xs={12} md={6}>
                <Paper variant="outlined" sx={{ p: 2.5, height: "100%", borderRadius: 2 }}>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom fontWeight="bold" sx={{ mb: 2 }}>
                    Settlement Breakdown
                  </Typography>
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                    {fullInvoice.cash_amount > 0 && (
                      <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                        <Typography variant="body2" color="text.secondary">Cash Payment</Typography>
                        <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(fullInvoice.cash_amount)}</Typography>
                      </Box>
                    )}
                    {fullInvoice.card_visa_amount > 0 && (
                      <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                        <Typography variant="body2" color="text.secondary">Card Payment (Visa)</Typography>
                        <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(fullInvoice.card_visa_amount)}</Typography>
                      </Box>
                    )}
                    {fullInvoice.card_mastercard_amount > 0 && (
                      <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                        <Typography variant="body2" color="text.secondary">Card Payment (Mastercard)</Typography>
                        <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(fullInvoice.card_mastercard_amount)}</Typography>
                      </Box>
                    )}
                    {fullInvoice.card_amex_amount > 0 && (
                      <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                        <Typography variant="body2" color="text.secondary">Card Payment (Amex)</Typography>
                        <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(fullInvoice.card_amex_amount)}</Typography>
                      </Box>
                    )}
                    {fullInvoice.cheque_amount > 0 && (
                      <Box>
                        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                          <Typography variant="body2" color="text.secondary">Cheque Payment</Typography>
                          <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(fullInvoice.cheque_amount)}</Typography>
                        </Box>
                        {(fullInvoice.cheque_number || fullInvoice.cheque_bank || fullInvoice.cheque_date) && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, fontStyle: "italic" }}>
                            {fullInvoice.cheque_bank ? `${fullInvoice.cheque_bank} ` : ""}
                            {fullInvoice.cheque_number ? `#${fullInvoice.cheque_number} ` : ""}
                            {fullInvoice.cheque_date ? `(Due: ${new Date(fullInvoice.cheque_date).toLocaleDateString()})` : ""}
                          </Typography>
                        )}
                      </Box>
                    )}
                    {fullInvoice.bank_transfer_amount > 0 && (
                      <Box>
                        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                          <Typography variant="body2" color="text.secondary">Bank Transfer</Typography>
                          <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(fullInvoice.bank_transfer_amount)}</Typography>
                        </Box>
                        {(fullInvoice.bank_name || fullInvoice.bank_transfer_ref) && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, fontStyle: "italic" }}>
                            {fullInvoice.bank_name ? `${fullInvoice.bank_name} ` : ""}
                            {fullInvoice.bank_transfer_ref ? `Ref: ${fullInvoice.bank_transfer_ref}` : ""}
                          </Typography>
                        )}
                      </Box>
                    )}
                    {fullInvoice.credit_amount > 0 && (
                      <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                        <Typography variant="body2" color="warning.main" fontWeight="medium">Credit (Owed)</Typography>
                        <Typography variant="body2" fontWeight="bold" color="warning.main">Rs. {fmtLKR(fullInvoice.credit_amount)}</Typography>
                      </Box>
                    )}
                    {fullInvoice.gift_voucher_amount > 0 && (
                      <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                        <Typography variant="body2" color="secondary.main">Gift Voucher</Typography>
                        <Typography variant="body2" fontWeight="medium" color="secondary.main">Rs. {fmtLKR(fullInvoice.gift_voucher_amount)}</Typography>
                      </Box>
                    )}
                    {fullInvoice.credit_note_amount > 0 && (
                      <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                        <Typography variant="body2" color="success.main">Credit Note Redeemed</Typography>
                        <Typography variant="body2" fontWeight="medium" color="success.main">Rs. {fmtLKR(fullInvoice.credit_note_amount)}</Typography>
                      </Box>
                    )}
                  </Box>
                </Paper>
              </Grid>

              {/* Order Financials */}
              <Grid item xs={12} md={6}>
                <Paper variant="outlined" sx={{ p: 2.5, height: "100%", borderRadius: 2, bgcolor: "grey.50" }}>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom fontWeight="bold" sx={{ mb: 2 }}>
                    Order Financials
                  </Typography>
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                    {(() => {
                      const isTaxInclusive = fullInvoice.is_tax_invoice;
                      const taxRate = fullInvoice.tax_rate || 0;
                      const grossTotal = fullInvoice.items?.reduce((sum: number, item: any) => sum + (item.quantity * item.selling_price), 0) || 0;
                      const itemDiscounts = fullInvoice.items?.reduce((sum: number, item: any) => sum + (item.discount_amount || (item.selling_price * item.quantity * (item.discount_percent || 0) / 100)), 0) || 0;

                      const displayGrossTotal = isTaxInclusive && taxRate > 0 ? grossTotal / (1 + taxRate / 100) : grossTotal;
                      const displayItemDiscounts = isTaxInclusive && taxRate > 0 ? itemDiscounts / (1 + taxRate / 100) : itemDiscounts;
                      const displaySubtotal = displayGrossTotal - displayItemDiscounts;

                      return (
                        <>
                          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                            <Typography variant="body2" color="text.secondary">Gross Total</Typography>
                            <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(displayGrossTotal)}</Typography>
                          </Box>
                          {displayItemDiscounts > 0 && (
                            <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                              <Typography variant="body2" color="error.main">Item Discounts</Typography>
                              <Typography variant="body2" color="error.main" fontWeight="medium">-Rs. {fmtLKR(displayItemDiscounts)}</Typography>
                            </Box>
                          )}
                          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                            <Typography variant="body2" color="text.secondary">Subtotal</Typography>
                            <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(displaySubtotal)}</Typography>
                          </Box>
                          {fullInvoice.cupon_amount > 0 && (
                            <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                              <Typography variant="body2" color="error.main">Coupon Discount</Typography>
                              <Typography variant="body2" color="error.main" fontWeight="medium">-Rs. {fmtLKR(fullInvoice.cupon_amount)}</Typography>
                            </Box>
                          )}
                          {fullInvoice.discount_amount > 0 && (
                            <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                              <Typography variant="body2" color="error.main">
                                Invoice Discount {fullInvoice.discount_percent > 0 ? `(${fullInvoice.discount_percent}%)` : ""}
                              </Typography>
                              <Typography variant="body2" color="error.main" fontWeight="medium">-Rs. {fmtLKR(fullInvoice.discount_amount)}</Typography>
                            </Box>
                          )}
                          {fullInvoice.tax_amount > 0 && (
                            <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                              <Typography variant="body2" color="text.secondary">
                                Tax ({fullInvoice.tax_rate}%) {isTaxInclusive ? "(Included)" : ""}
                              </Typography>
                              <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(fullInvoice.tax_amount)}</Typography>
                            </Box>
                          )}
                          {fullInvoice.service_charge_amount > 0 && (
                            <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                              <Typography variant="body2" color="text.secondary">Service Charge ({(fullInvoice.service_charge_rate * 100).toFixed(1)}%)</Typography>
                              <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(fullInvoice.service_charge_amount)}</Typography>
                            </Box>
                          )}
                          <Divider sx={{ my: 0.5 }} />
                          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                            <Typography variant="subtitle2" fontWeight="bold">Grand Total</Typography>
                            <Typography variant="subtitle2" fontWeight="bold">Rs. {fmtLKR(fullInvoice.grand_total)}</Typography>
                          </Box>
                          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                            <Typography variant="body2" fontWeight="medium" color="success.main">Amount Paid</Typography>
                            <Typography variant="body2" fontWeight="medium" color="success.main">Rs. {fmtLKR(fullInvoice.paid_amount)}</Typography>
                          </Box>
                          {fullInvoice.balance_due > 0 && (
                            <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                              <Typography variant="body2" fontWeight="medium" color="error.main">Balance Due</Typography>
                              <Typography variant="body2" fontWeight="medium" color="error.main">Rs. {fmtLKR(fullInvoice.balance_due)}</Typography>
                            </Box>
                          )}
                        </>
                      );
                    })()}
                  </Box>
                </Paper>
              </Grid>
            </Grid>
          </FormSection>
        )}

        {/* Agent Commission Section */}
        {fullInvoice?.customer_agent_id && (
          <FormSection title="Agent Commission" columns={1}>
            <Paper variant="outlined" sx={{ p: 2.5, borderColor: "primary.main", borderWidth: 1, borderRadius: 2 }}>
              {(() => {
                const agent = customers?.find((c) => c.id === fullInvoice.customer_agent_id);
                return (
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={4}>
                      <Typography variant="body2" color="text.secondary">Agent Name</Typography>
                      <Typography variant="body1" fontWeight={500}>{agent?.customer_name || `Agent #${fullInvoice.customer_agent_id}`}</Typography>
                    </Grid>
                    <Grid item xs={6} sm={2}>
                      <Typography variant="body2" color="text.secondary">Commission Rate</Typography>
                      <Typography variant="body1" fontWeight={500}>
                        {invoiceCommission ? `${Number(invoiceCommission.commission_rate).toFixed(1)}%` : `${Number(agent?.commission_rate || 0).toFixed(1)}%`}
                      </Typography>
                    </Grid>
                    <Grid item xs={6} sm={2}>
                      <Typography variant="body2" color="text.secondary">Status</Typography>
                      <Box sx={{ mt: 0.5 }}>
                        <Chip
                          size="small"
                          label={invoiceCommission?.status ? invoiceCommission.status.toUpperCase() : "PENDING"}
                          color={
                            invoiceCommission?.status === "paid"
                              ? "success"
                              : invoiceCommission?.status === "approved"
                              ? "info"
                              : invoiceCommission?.status === "cancelled"
                              ? "error"
                              : "warning"
                          }
                        />
                      </Box>
                    </Grid>
                    <Grid item xs={12} sm={4} sx={{ textAlign: { sm: "right" } }}>
                      <Typography variant="body2" color="text.secondary">Commission Amount</Typography>
                      <Typography variant="h6" fontWeight="bold" color="primary.main">
                        Rs. {fmtLKR(invoiceCommission ? Number(invoiceCommission.commission_amount) : (fullInvoice.grand_total * ((agent?.commission_rate || 0) / 100)))}
                      </Typography>
                    </Grid>
                  </Grid>
                );
              })()}
            </Paper>
          </FormSection>
        )}

        {/* Remarks */}
        {state.selectedItem?.remarks && (
          <FormSection title="Remarks" columns={1}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                width: "100%",
              }}
            >
              <TextField
                multiline
                rows={2}
                fullWidth
                value={state.selectedItem.remarks}
                disabled
                size="small"
              />
              <Tooltip title="View / Add Remarks">
                <IconButton
                  size="small"
                  onClick={() => setRemarksDialogOpen(true)}
                >
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
      <TSteps
        steps={FORM_STEPS.map((label, i) => ({ id: `step-${i}`, label }))}
        activeStep={formStep}
        sx={{ mb: 3 }}
      />

      {/* Step 1: Order Information */}
      {formStep === 0 && (
        <>
          <FormSection title="Order Details" columns={3}>
            <TextField
              label="Invoice No"
              size="small"
              value={
                state.isCreating ? nextInvoiceNumber : state.formData.invoice_no
              }
              disabled
            />
            <Autocomplete
              size="small"
              options={branches}
              getOptionLabel={(option) =>
                `${option.branch_code} - ${option.branch_name}`
              }
              value={
                branches.find(
                  (b) => b.branch_code === state.formData.branch_code,
                ) || null
              }
              onChange={(_, newValue) =>
                state.setFormData({
                  ...state.formData,
                  branch_code: newValue?.branch_code || "",
                })
              }
              renderInput={(params) => (
                <TextField {...params} label="Branch" required />
              )}
            />
            <Autocomplete
              size="small"
              options={customers || []}
              getOptionLabel={(option) => option.customer_name || ""}
              value={
                customers?.find((c) => c.id === state.formData.customer_id) ||
                null
              }
              onChange={(_, newValue) =>
                state.setFormData({
                  ...state.formData,
                  customer_id: newValue?.id || 0,
                })
              }
              renderInput={(params) => (
                <TextField {...params} label="Customer" required />
              )}
            />
            <Autocomplete
              size="small"
              options={(customers || []).filter(
                (c) => c.is_customer_agent && c.active,
              )}
              getOptionLabel={(option) =>
                `${option.customer_name}${option.commission_rate ? ` (${option.commission_rate}%)` : ""}`
              }
              value={
                customers?.find(
                  (c) => c.id === state.formData.customer_agent_id,
                ) || null
              }
              onChange={(_, newValue) => {
                state.setFormData({
                  ...state.formData,
                  customer_agent_id: newValue?.id || undefined,
                });
                // Assign the commission from the order: pre-fill with the
                // agent's default rate (editable below), clear when removed.
                setManualCommissionRate(
                  newValue?.commission_rate != null
                    ? Number(newValue.commission_rate)
                    : null,
                );
                setManualCommissionAmount(null);
              }}
              renderInput={(params) => (
                <TextField {...params} label="Customer Agent (Optional)" />
              )}
            />
            {state.formData.customer_agent_id && (
              <TextField
                size="small"
                type="number"
                label="Commission Rate"
                value={manualCommissionRate ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setManualCommissionRate(v === "" ? null : Math.max(0, Math.min(100, parseFloat(v) || 0)));
                  setManualCommissionAmount(null);
                }}
                inputProps={{ min: 0, max: 100, step: 0.1 }}
                InputProps={{
                  endAdornment: <InputAdornment position="end">%</InputAdornment>,
                }}
                helperText={
                  manualCommissionRate != null && manualCommissionRate > 0
                    ? `Commission: Rs. ${fmtLKR(calcOrderTotals().grandTotal * (manualCommissionRate / 100))} — created as pending for approval`
                    : "Assign the agent commission rate for this order"
                }
              />
            )}
          </FormSection>

          {/* Customer Credit Information Panel */}
          {customerCreditStatus && (state.formData.customer_id || 0) > 0 && (
            <Box
              sx={{
                p: 2,
                mb: 2,
                borderRadius: 1,
                bgcolor:
                  customerCreditStatus.available_credit <= 0
                    ? "error.lighter"
                    : customerCreditStatus.available_credit <
                        customerCreditStatus.max_credit_limit * 0.2
                      ? "warning.lighter"
                      : "success.lighter",
                border: 1,
                borderColor:
                  customerCreditStatus.available_credit <= 0
                    ? "error.light"
                    : customerCreditStatus.available_credit <
                        customerCreditStatus.max_credit_limit * 0.2
                      ? "warning.light"
                      : "success.light",
              }}
            >
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                Customer Credit Information
              </Typography>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: 2,
                }}
              >
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Credit Limit
                  </Typography>
                  <Typography variant="body2" fontWeight={500}>
                    Rs. {fmtLKR(customerCreditStatus.max_credit_limit || 0)}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Outstanding
                  </Typography>
                  <Typography
                    variant="body2"
                    fontWeight={500}
                    color="error.main"
                  >
                    Rs. {fmtLKR(customerCreditStatus.outstanding_credit || 0)}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Available Credit
                  </Typography>
                  <Typography
                    variant="body2"
                    fontWeight={500}
                    color={
                      customerCreditStatus.available_credit > 0
                        ? "success.main"
                        : "error.main"
                    }
                  >
                    Rs. {fmtLKR(customerCreditStatus.available_credit || 0)}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Credit Terms
                  </Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {customerCreditStatus.credit_days || 0} days
                  </Typography>
                </Box>
              </Box>
              {customerCreditStatus.overdue_count > 0 && (
                <Box
                  sx={{ mt: 1, p: 1, bgcolor: "error.light", borderRadius: 1 }}
                >
                  <Typography variant="caption" color="error.contrastText">
                    ⚠️ {customerCreditStatus.overdue_count} overdue invoice(s) -
                    Rs. {fmtLKR(customerCreditStatus.total_overdue_amount || 0)}
                  </Typography>
                </Box>
              )}
            </Box>
          )}

          {/* Recent Customer Sales Panel */}
          {(state.formData.customer_id || 0) > 0 && (
            <Box
              sx={{
                p: 2,
                mb: 2,
                borderRadius: 1,
                bgcolor: "background.paper",
                border: 1,
                borderColor: "divider",
              }}
            >
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
                      <TableCell>Products</TableCell>
                      <TableCell align="right">Total</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {recentCustomerSales.map((sale) => {
                      const saleProductMap = new Map(products.map((p: any) => [p.id, p]));
                      return (
                      <TableRow
                        key={sale.id}
                        hover
                        onClick={() => {
                          setSelectedInvoiceForView(sale);
                          setInvoiceDetailsOpen(true);
                        }}
                        sx={{ cursor: "pointer", verticalAlign: "top" }}
                      >
                        <TableCell>
                          <Typography
                            variant="body2"
                            fontWeight={500}
                            color="primary"
                          >
                            {sale.invoice_no}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={sale.branch_code}
                            size="small"
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell>
                          {format(new Date(sale.created_date), "dd/MM/yyyy")}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={getPaymentMethodsDisplay(sale).toUpperCase()}
                            size="small"
                            color={
                              sale.payment_method === "cash" || getPaymentMethodsDisplay(sale) === "Cash"
                                ? "success"
                                : getPaymentMethodsDisplay(sale).startsWith("Split")
                                ? "info"
                                : "default"
                            }
                          />
                        </TableCell>
                        <TableCell sx={{ minWidth: 220 }}>
                          {sale.items && sale.items.length > 0 ? (
                            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                              {sale.items.map((item) => {
                                const prod = saleProductMap.get(item.product_id);
                                const productName = prod?.name || `Product #${item.product_id}`;
                                const lineTotal = item.quantity * item.selling_price;
                                return (
                                  <Box
                                    key={item.id}
                                    sx={{
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      gap: 1,
                                      px: 1,
                                      py: 0.25,
                                      borderRadius: 1,
                                      bgcolor: "action.hover",
                                    }}
                                  >
                                    <Typography variant="caption" fontWeight={500} sx={{ flex: 1 }}>
                                      {productName}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                                      {item.quantity} × Rs. {fmtLKR(item.selling_price)}
                                    </Typography>
                                    <Typography variant="caption" fontWeight={600} color="primary.main" sx={{ whiteSpace: "nowrap" }}>
                                      = Rs. {fmtLKR(lineTotal)}
                                    </Typography>
                                  </Box>
                                );
                              })}
                            </Box>
                          ) : (
                            <Typography variant="caption" color="text.secondary">—</Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" fontWeight={500}>
                            Rs.{" "}
                            {fmtLKR(
                              sale.grand_total ||
                                sale.cash_amount +
                                  sale.card_visa_amount +
                                  sale.card_mastercard_amount +
                                  sale.card_amex_amount +
                                  sale.cheque_amount +
                                  sale.bank_transfer_amount +
                                  sale.credit_amount ||
                                0,
                            )}
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
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ textAlign: "center", py: 2 }}
                >
                  No previous sales records found for this customer
                </Typography>
              )}
            </Box>
          )}

          <FormSection title="Additional Information" columns={1}>
            <TextField
              label="Remarks"
              size="small"
              value={state.formData.remarks}
              onChange={(e) =>
                state.setFormData({
                  ...state.formData,
                  remarks: e.target.value,
                })
              }
              multiline
              rows={2}
            />
          </FormSection>


        </>
      )}

      {/* Step 2: Line Items */}
      {formStep === 1 && (
        <>
          {/* Two-column item picker: Barcode (left) | Manual Picker (right) */}
          <Grid container spacing={2} sx={{ mb: 2 }}>
            {/* LEFT: Barcode Scanner */}
            <Grid item xs={12} md={5}>
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  height: "100%",
                  bgcolor: "warning.50",
                  borderColor: "warning.main",
                  borderWidth: 2,
                }}
              >
                <Typography
                  variant="subtitle2"
                  fontWeight="bold"
                  sx={{
                    mb: 1.5,
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                  }}
                >
                  <QrCodeScannerIcon color="warning" />
                  Scan / Type Barcode
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
                    sx={{ minWidth: 80 }}
                  >
                    {isValidatingBarcode ? (
                      <CircularProgress size={20} />
                    ) : (
                      "Add"
                    )}
                  </Button>
                </Box>
              </Paper>
            </Grid>

            {/* RIGHT: Manual Brand → Product → Stock Picker */}
            <Grid item xs={12} md={7}>
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  height: "100%",
                  borderColor: "primary.main",
                  borderWidth: 2,
                }}
              >
                <Typography
                  variant="subtitle2"
                  fontWeight="bold"
                  sx={{
                    mb: 1.5,
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                  }}
                >
                  <MenuBookIcon color="primary" />
                  Browse & Select Items
                </Typography>

                {/* Brand + Product + Branch dropdowns in one row */}
                <Box sx={{ display: "flex", gap: 1, mb: 1.5 }}>
                  <Autocomplete
                    size="small"
                    sx={{ flex: 1 }}
                    options={brands}
                    getOptionLabel={(b: Brand) => b.brand_name}
                    value={
                      brands.find((b: Brand) => b.id === manualBrandId) || null
                    }
                    onChange={(_, v) => setManualBrandId(v?.id ?? null)}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Brand"
                        placeholder="Filter by brand..."
                      />
                    )}
                    noOptionsText="No brands"
                  />
                  <Autocomplete
                    size="small"
                    sx={{ flex: 1 }}
                    options={(products as any[]).filter(
                      (p: any) =>
                        !manualBrandId || p.items_brand_id === manualBrandId,
                    )}
                    getOptionLabel={(p: any) => p.name}
                    value={
                      (products as any[]).find(
                        (p: any) => p.id === manualProductId,
                      ) || null
                    }
                    onChange={(_, v) => setManualProductId(v?.id ?? null)}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Product"
                        placeholder="Select product..."
                      />
                    )}
                    noOptionsText="No products"
                  />
                  <Autocomplete
                    size="small"
                    sx={{ flex: 1 }}
                    options={branches}
                    getOptionLabel={(b: any) => `${b.branch_code} — ${b.branch_name}`}
                    value={branches.find((b: any) => b.branch_code === (manualBranchCode || state.formData.branch_code)) || null}
                    onChange={(_, v) => setManualBranchCode(v?.branch_code ?? null)}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Branch"
                        placeholder="Select branch..."
                      />
                    )}
                    noOptionsText="No branches"
                  />
                </Box>

                {/* Available stock list for selected product */}
                <Box
                  sx={{
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: 1,
                    maxHeight: 220,
                    overflow: "auto",
                    bgcolor: "background.paper",
                  }}
                >
                  {!manualProductId ? (
                    <Box sx={{ p: 2, textAlign: "center" }}>
                      <Typography variant="body2" color="text.secondary">
                        Select a product to see available stock
                      </Typography>
                    </Box>
                  ) : isLoadingManualStock ? (
                    <Box
                      sx={{ p: 2, display: "flex", justifyContent: "center" }}
                    >
                      <CircularProgress size={24} />
                    </Box>
                  ) : manualStockItems.length === 0 ? (
                    <Box sx={{ p: 2, textAlign: "center" }}>
                      <Typography variant="body2" color="text.secondary">
                        No available stock for this product in{" "}
                        {state.formData.branch_code || "selected branch"}
                      </Typography>
                    </Box>
                  ) : (
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ bgcolor: "grey.50" }}>
                          <TableCell
                            sx={{
                              py: 0.5,
                              fontWeight: 600,
                              fontSize: "0.75rem",
                            }}
                          >
                            Barcode
                          </TableCell>
                          <TableCell
                            sx={{
                              py: 0.5,
                              fontWeight: 600,
                              fontSize: "0.75rem",
                            }}
                          >
                            Branch
                          </TableCell>
                          <TableCell sx={{ py: 0.5, width: 64 }} />
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {manualStockItems.map((s) => {
                          const alreadyInOrder = lineItems.some(
                            (li) => li.barcode === s.barcode,
                          );
                          return (
                            <TableRow
                              key={s.id}
                              sx={{
                                opacity: alreadyInOrder ? 0.4 : 1,
                                "&:hover": {
                                  bgcolor: alreadyInOrder
                                    ? undefined
                                    : "primary.50",
                                },
                              }}
                            >
                              <TableCell
                                sx={{
                                  py: 0.5,
                                  fontFamily: "monospace",
                                  fontSize: "0.8rem",
                                }}
                              >
                                {s.barcode}
                              </TableCell>
                              <TableCell sx={{ py: 0.5, fontSize: "0.75rem", color: "text.secondary" }}>
                                {s.branch_code}
                              </TableCell>
                              <TableCell sx={{ py: 0.5 }}>
                                <Button
                                  size="small"
                                  variant="contained"
                                  color="primary"
                                  disabled={alreadyInOrder}
                                  onClick={() => handleAddManualStockItem(s)}
                                  sx={{
                                    minWidth: 0,
                                    px: 1,
                                    py: 0.25,
                                    fontSize: "0.7rem",
                                  }}
                                >
                                  {alreadyInOrder ? "✓" : "Add"}
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </Box>
              </Paper>
            </Grid>
          </Grid>

          {/* Proforma Mode: Show assignment progress */}
          {!!(state.formData as any).source_quote_id &&
            lineItems.length > 0 && (
              <Alert
                severity={
                  lineItems.every((item) => !!item.barcode) ? "success" : "info"
                }
                sx={{ mb: 2 }}
              >
                <strong>Proforma Items:</strong>{" "}
                {lineItems.filter((item) => !!item.barcode).length} /{" "}
                {lineItems.length} items have barcodes assigned.
                {!lineItems.every((item) => !!item.barcode)
                  ? " Scan barcodes to assign stock to the remaining items."
                  : " All items assigned! You can proceed to payment."}
              </Alert>
            )}

          {/* Line Items Section */}
          <Box sx={{ mb: 3 }}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                mb: 1,
              }}
            >
              <Typography variant="subtitle1" fontWeight="bold">
                Line Items
              </Typography>
              <IconButton
                size="small"
                onClick={addLineItem}
                color="primary"
                title="Add manual item"
              >
                <AddIcon />
              </IconButton>
            </Box>

            <Paper
              variant="outlined"
              sx={{
                overflow: "hidden",
                borderRadius: 2,
                border: "1px solid",
                borderColor: "divider",
              }}
            >
              <Table size="small" sx={{ tableLayout: "fixed", width: "100%" }}>
                <TableHead>
                  <TableRow sx={modernTableStyles.headerRow}>
                    <TableCell sx={{ width: 110 }}>Barcode</TableCell>
                    <TableCell sx={{ width: "auto" }}>Product</TableCell>
                    <TableCell sx={{ width: 100 }}>Branch Code</TableCell>
                    <TableCell align="right" sx={{ width: 80 }}>
                      Warranty
                    </TableCell>
                    <TableCell align="right" sx={{ width: 110 }}>
                      Min Price
                    </TableCell>
                    <TableCell align="right" sx={{ width: 110 }}>
                      Unit Price
                    </TableCell>
                    <TableCell align="right" sx={{ width: 90 }}>
                      Disc %
                    </TableCell>
                    <TableCell align="right" sx={{ width: 130 }}>
                      {effectiveTaxRate > 0 ? "Net Amount" : "Amount"}
                    </TableCell>
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
                      <TableRow
                        key={index}
                        sx={{
                          ...modernTableStyles.bodyRow,
                          ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                        }}
                      >
                        {/* Barcode Column - with validation indicator */}
                        <TableCell>
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 0.5,
                            }}
                          >
                            {item.barcode &&
                              validatedBarcodes.includes(item.barcode) && (
                                <CheckCircleIcon
                                  fontSize="small"
                                  color="success"
                                />
                              )}
                            <Typography
                              variant="body2"
                              color={
                                item.barcode ? "success.main" : "text.secondary"
                              }
                              fontWeight={item.barcode ? 500 : 400}
                            >
                              {item.barcode || "-"}
                            </Typography>
                          </Box>
                        </TableCell>

                        {/* Product Column */}
                        <TableCell>
                          <Typography variant="body2">
                            {item.product_name || `Product #${item.product_id}`}
                          </Typography>
                        </TableCell>

                        {/* Branch Code Column */}
                        <TableCell>
                          {item.branch_code ||
                            state.formData.branch_code ||
                            "-"}
                        </TableCell>

                        {/* Warranty Column */}
                        <TableCell align="right">
                          <TextField
                            size="small"
                            type="number"
                            value={item.warrenty_month}
                            onChange={(e) =>
                              updateLineItem(
                                index,
                                "warrenty_month",
                                e.target.value,
                              )
                            }
                            sx={{ width: 80 }}
                            inputProps={{ min: 0 }}
                          />
                        </TableCell>

                        {/* Min Price Column */}
                        <TableCell align="right">
                          <Typography variant="body2" color="text.secondary">
                            {fmtLKR(item.minimum_selling_price || 0)}
                          </Typography>
                        </TableCell>

                        {/* Selling Price Column */}
                        <TableCell align="right">
                          <TextField
                            size="small"
                            type="number"
                            value={Number(item.selling_price)}
                            onChange={(e) =>
                              updateLineItem(
                                index,
                                "selling_price",
                                e.target.value === ""
                                  ? 0
                                  : parseFloat(e.target.value),
                              )
                            }
                            sx={{ width: 100 }}
                            inputProps={{ step: 0.01 }}
                            error={
                              item.selling_price < item.minimum_selling_price
                            }
                            helperText={
                              item.selling_price < item.minimum_selling_price
                                ? `Min: ${fmtLKR(item.minimum_selling_price)}`
                                : undefined
                            }
                            FormHelperTextProps={{
                              sx: {
                                fontSize: "0.6rem",
                                mx: 0,
                                color: "error.main",
                              },
                            }}
                          />
                        </TableCell>

                        {/* Discount Percent Column */}
                        <TableCell align="right">
                          <TextField
                            size="small"
                            type="number"
                            value={item.discount_percent || 0}
                            onChange={(e) => {
                              const discPct = Math.min(
                                100,
                                Math.max(0, parseFloat(e.target.value) || 0),
                              );

                              // Calculate price after discount
                              const priceAfterDiscount =
                                item.selling_price * (1 - discPct / 100);

                              // Check if price after discount is below minimum
                              if (
                                priceAfterDiscount < item.minimum_selling_price
                              ) {
                                // Calculate maximum allowed discount to maintain minimum price
                                const maxDiscountPct =
                                  ((item.selling_price -
                                    item.minimum_selling_price) /
                                    item.selling_price) *
                                  100;
                                updateLineItem(
                                  index,
                                  "discount_percent",
                                  Math.max(0, maxDiscountPct),
                                );
                              } else {
                                updateLineItem(
                                  index,
                                  "discount_percent",
                                  discPct,
                                );
                              }
                            }}
                            sx={{ width: 70 }}
                            inputProps={{ min: 0, max: 100, step: 0.5 }}
                            error={(() => {
                              const priceAfterDiscount =
                                item.selling_price *
                                (1 - (item.discount_percent || 0) / 100);
                              return (
                                priceAfterDiscount < item.minimum_selling_price
                              );
                            })()}
                            InputProps={{
                              endAdornment: (
                                <InputAdornment position="end" sx={{ ml: 0 }}>
                                  %
                                </InputAdornment>
                              ),
                            }}
                          />
                        </TableCell>

                        {/* Amount + Delete Column */}
                        <TableCell align="right">
                          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 0.5 }}>
                            <Box sx={{ textAlign: "right" }}>
                              <Typography
                                variant="body2"
                                fontWeight="medium"
                                color={(() => {
                                  const lineTotal =
                                    item.quantity * item.selling_price;
                                  const discountAmt =
                                    lineTotal *
                                    ((item.discount_percent || 0) / 100);
                                  const finalAmount = lineTotal - discountAmt;
                                  const minRequired =
                                    item.quantity * item.minimum_selling_price;
                                  return finalAmount < minRequired
                                    ? "error.main"
                                    : "text.primary";
                                })()}
                              >
                                {(() => {
                                  const lineTotal =
                                    item.quantity * item.selling_price;
                                  const discountAmt =
                                    lineTotal *
                                    ((item.discount_percent || 0) / 100);
                                  const gross = lineTotal - discountAmt;
                                  return fmtLKR(taxMode === "inclusive" && effectiveTaxRate > 0 ? gross / (1 + effectiveTaxRate / 100) : gross);
                                })()}
                              </Typography>
                              {(item.discount_percent || 0) > 0 &&
                                (() => {
                                  const priceAfterDiscount =
                                    item.selling_price *
                                    (1 - (item.discount_percent || 0) / 100);
                                  return priceAfterDiscount < item.minimum_selling_price ? (
                                    <Typography
                                      variant="caption"
                                      color="error.main"
                                      sx={{ display: "block" }}
                                    >
                                      Below min!
                                    </Typography>
                                  ) : null;
                                })()}
                            </Box>
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => removeLineItem(index)}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Box>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                  {/* Gross Total Row */}
                  <TableRow sx={{ bgcolor: "action.hover" }}>
                    <TableCell colSpan={7} align="right">
                      <Typography fontWeight="bold">Gross Total:</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography fontWeight="bold">
                        {fmtLKR(taxMode === "inclusive" && effectiveTaxRate > 0 ? calculateGrossTotal() / (1 + effectiveTaxRate / 100) : calculateGrossTotal())}
                      </Typography>
                    </TableCell>
                  </TableRow>
                  {/* Item Discounts Row - Only if any item has discount */}
                  {calculateTotalItemDiscounts() > 0 && (
                    <TableRow sx={{ bgcolor: "error.lighter" }}>
                      <TableCell colSpan={7} align="right">
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            gap: 1,
                          }}
                        >
                          <PercentIcon fontSize="small" color="error" />
                          <Typography fontWeight="medium" color="error.dark">
                            Item Discounts:
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell align="right">
                        <Typography fontWeight="medium" color="error.dark">
                          -{fmtLKR(taxMode === "inclusive" && effectiveTaxRate > 0 ? calculateTotalItemDiscounts() / (1 + effectiveTaxRate / 100) : calculateTotalItemDiscounts())}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                  {/* Subtotal Row (after item discounts) */}
                  <TableRow sx={{ bgcolor: "grey.100" }}>
                    <TableCell colSpan={7} align="right">
                      <Typography fontWeight="bold">Subtotal:</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography fontWeight="bold">
                        {fmtLKR(taxMode === "inclusive" && effectiveTaxRate > 0 ? calculateLineItemsTotal() / (1 + effectiveTaxRate / 100) : calculateLineItemsTotal())}
                      </Typography>
                    </TableCell>
                  </TableRow>
                  {/* Coupon Discount Row - applied on subtotal (step 4) */}
                  {couponValidation &&
                    couponValidation.calculated_discount &&
                    couponValidation.calculated_discount > 0 && (
                      <TableRow sx={{ bgcolor: "success.lighter" }}>
                        <TableCell colSpan={7} align="right">
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "flex-end",
                              gap: 1,
                            }}
                          >
                            <CouponIcon fontSize="small" color="success" />
                            <Typography
                              fontWeight="medium"
                              color="success.dark"
                            >
                              Coupon Discount ({couponCode}):
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell align="right">
                          <Typography fontWeight="medium" color="success.dark">
                            -{fmtLKR(couponValidation.calculated_discount)}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  {/* Invoice Discount Row - applied after coupon (step 5) */}
                  {discountValue > 0 && (
                    <TableRow sx={{ bgcolor: "warning.lighter" }}>
                      <TableCell colSpan={7} align="right">
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            gap: 1,
                          }}
                        >
                          <PercentIcon fontSize="small" color="warning" />
                          <Typography fontWeight="medium" color="warning.dark">
                            Invoice Discount (
                            {discountType === "percent"
                              ? `${discountValue}%`
                              : "Fixed"}
                            ):
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell align="right">
                        <Typography fontWeight="medium" color="warning.dark">
                          -{fmtLKR(calcOrderTotals().invoiceDiscount)}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                  {/* Tax Row - shown whenever tax is applied (back-calculated inclusive) */}
                  {effectiveTaxRate > 0 && (
                    <TableRow sx={{ bgcolor: "info.lighter" }}>
                      <TableCell colSpan={7} align="right">
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            gap: 1,
                          }}
                        >
                          <TaxIcon fontSize="small" color="info" />
                          <Typography fontWeight="medium" color="info.dark">
                            {taxMode === "inclusive" ? `Tax (${effectiveTaxRate}%):` : `Tax (${effectiveTaxRate}%):`}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell align="right">
                        <Typography fontWeight="medium" color="info.dark">
                          +{fmtLKR(calcOrderTotals().taxAmount)}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                  {/* Gift Voucher Payment Row - Only if vouchers are applied */}
                  {appliedVouchers.length > 0 &&
                    appliedVouchers.reduce(
                      (sum, v) => sum + Number(v.amountToRedeem),
                      0,
                    ) > 0 && (
                      <TableRow sx={{ bgcolor: "secondary.lighter" }}>
                        <TableCell colSpan={7} align="right">
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "flex-end",
                              gap: 1,
                            }}
                          >
                            <ReceiptIcon fontSize="small" color="secondary" />
                            <Typography
                              fontWeight="medium"
                              color="secondary.dark"
                            >
                              Gift Voucher Payment ({appliedVouchers.length}{" "}
                              voucher{appliedVouchers.length > 1 ? "s" : ""}):
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell align="right">
                          <Typography
                            fontWeight="medium"
                            color="secondary.dark"
                          >
                            -
                            {fmtLKR(
                              appliedVouchers.reduce(
                                (sum, v) => sum + Number(v.amountToRedeem),
                                0,
                              ),
                            )}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  {/* Credit Note Payment Row - Only if applied */}
                  {creditNoteAmount > 0 && (
                    <TableRow sx={{ bgcolor: "success.lighter" }}>
                      <TableCell colSpan={7} align="right">
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            gap: 1,
                          }}
                        >
                          <ReceiptIcon fontSize="small" color="success" />
                          <Typography fontWeight="medium" color="success.dark">
                            Credit Note Applied:
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell align="right">
                        <Typography fontWeight="medium" color="success.dark">
                          -
                          {fmtLKR(calcOrderTotals().appliedCreditNote)}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                  {/* Service Charge Row - show whenever a card with charge is in any split row */}
                  {selectedPaymentCard &&
                    calcOrderTotals().serviceCharge > 0 && (
                      <TableRow sx={{ bgcolor: "grey.100" }}>
                        <TableCell colSpan={7} align="right">
                          <Typography
                            fontWeight="medium"
                            color="text.secondary"
                          >
                            Service Charge (
                            {selectedPaymentCard.service_charge_percent}%):
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography
                            fontWeight="medium"
                            color="text.secondary"
                          >
                            +
                            {fmtLKR(calcOrderTotals().serviceCharge)}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  {/* Grand Total Row */}
                  <TableRow sx={{ bgcolor: "primary.lighter" }}>
                    <TableCell colSpan={7} align="right">
                      <Typography fontWeight="bold" color="primary.main">
                        Grand Total{taxMode === "inclusive" && effectiveTaxRate > 0 ? " (incl. taxes)" : ""}:
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography
                        fontWeight="bold"
                        color="primary.main"
                        fontSize="1.1rem"
                      >
                        {(() => {
                          const t = calcOrderTotals();
                          return fmtLKR(t.grandTotal);
                        })()}
                      </Typography>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Paper>
          </Box>

          {/* When editing an existing order, financial fields are locked: the
              backend update only accepts line-item changes, so showing editable
              payment/discount/tax/coupon/voucher controls would silently discard
              those changes. Surface that clearly and hide the controls. */}
          {state.isEditing && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Editing an order updates its line items only. Payment method,
              discounts, tax, coupons and gift vouchers can’t be changed after an
              order is created — those sections are hidden while editing.
            </Alert>
          )}

          {/* Coupon/Discount Code Section - After adding items */}
          {lineItems.length > 0 && !state.isEditing && (
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                mb: 2,
                bgcolor: couponValidation ? "success.50" : "grey.50",
                borderColor: couponValidation ? "success.main" : "divider",
              }}
            >
              <Box
                sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}
              >
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
                    disabled={
                      isValidatingCoupon ||
                      !state.formData.customer_id ||
                      lineItems.length === 0
                    }
                    error={!!couponError}
                    helperText={
                      couponError ||
                      (lineItems.length === 0
                        ? "Add items first"
                        : "Scan barcode or type code and press Enter/Apply")
                    }
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
                    disabled={
                      isValidatingCoupon ||
                      !couponCode.trim() ||
                      !state.formData.customer_id ||
                      lineItems.length === 0
                    }
                    sx={{ minWidth: 100 }}
                  >
                    {isValidatingCoupon ? (
                      <CircularProgress size={20} />
                    ) : (
                      "Apply"
                    )}
                  </Button>
                </Box>
              ) : (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <Box>
                    <Chip
                      icon={<CouponIcon />}
                      label={couponCode}
                      color="success"
                      variant="filled"
                      sx={{ mr: 1 }}
                    />
                    <Typography
                      variant="body2"
                      component="span"
                      color="success.dark"
                      fontWeight="medium"
                    >
                      {couponValidation.discount_type === "PERCENT"
                        ? `${couponValidation.discount_value}% off`
                        : `Rs. ${fmtLKR(couponValidation.discount_value || 0)} off`}
                      {" - Discount: Rs. "}
                      {fmtLKR(couponValidation.calculated_discount || 0)}
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
          {lineItems.length > 0 && !state.isEditing && (
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                mb: 2,
                bgcolor:
                  discountValue > 0 || effectiveTaxRate > 0 ? "warning.50" : "grey.50",
                borderColor:
                  discountValue > 0 || effectiveTaxRate > 0 ? "warning.main" : "divider",
              }}
            >
              <Box
                sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}
              >
                <PercentIcon
                  color={
                    discountValue > 0 || effectiveTaxRate > 0 ? "warning" : "action"
                  }
                />
                <Typography variant="subtitle2" fontWeight="bold">
                  Discount & Tax
                </Typography>
              </Box>

              <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                {/* Discount Section */}
                <Box sx={{ flex: 1, minWidth: 280 }}>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 1 }}
                  >
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
                        if (
                          discountType === "amount" &&
                          val > calcOrderTotals().afterCoupon
                        )
                          return;
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
                        max:
                          discountType === "percent"
                            ? 100
                            : calcOrderTotals().afterCoupon,
                        step: discountType === "percent" ? 0.5 : 100,
                      }}
                    />
                    {discountValue > 0 && (
                      <Box
                        sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
                      >
                        <Typography
                          variant="body2"
                          color="warning.dark"
                          fontWeight="medium"
                        >
                          = Rs.{" "}
                          {fmtLKR(calcOrderTotals().invoiceDiscount)}
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
                    Tax Invoice (VAT/GST)
                  </Typography>
                  <ToggleButtonGroup
                    value={taxMode}
                    exclusive
                    onChange={(_, v) => {
                      if (v) { setTaxMode(v); if (v === "none") setTaxRate(0); }
                    }}
                    size="small"
                    sx={{ mb: 1 }}
                  >
                    <ToggleButton value="none">No Tax</ToggleButton>
                    <ToggleButton value="inclusive">Inclusive</ToggleButton>
                    <ToggleButton value="exclusive">Exclusive</ToggleButton>
                  </ToggleButtonGroup>
                  {taxMode !== "none" && (
                    <>
                      <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                        <TextField
                          size="small"
                          type="number"
                          value={taxRate || ""}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            if (val > 100) return;
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
                        {effectiveTaxRate > 0 && (
                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                            <Typography variant="body2" color="info.dark" fontWeight="medium">
                              = Rs. {fmtLKR(calcOrderTotals().taxAmount)}
                            </Typography>
                            <IconButton size="small" color="error" onClick={() => setTaxRate(0)} sx={{ p: 0.5 }}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Box>
                        )}
                      </Box>
                      {/* Quick select */}
                      <Box sx={{ display: "flex", gap: 0.5, mt: 1 }}>
                        {[1, 5, 8, 12, 18].map((rate) => (
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
                    </>
                  )}
                </Box>
              </Box>
            </Paper>
          )}

          {/* Gift Voucher Payment Section - After adding items */}
          {lineItems.length > 0 && !state.isEditing && (
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                mb: 2,
                bgcolor: appliedVouchers.length > 0 ? "info.50" : "grey.50",
                borderColor:
                  appliedVouchers.length > 0 ? "info.main" : "divider",
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  mb: 1,
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <ReceiptIcon
                    color={appliedVouchers.length > 0 ? "info" : "action"}
                  />
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
              <Box
                sx={{
                  display: "flex",
                  gap: 1,
                  alignItems: "flex-start",
                  mb: appliedVouchers.length > 0 ? 2 : 0,
                }}
              >
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
                  helperText={
                    voucherError ||
                    (lineItems.length === 0
                      ? "Add items first"
                      : "Scan voucher barcode or type code and press Enter/Apply")
                  }
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
                  disabled={
                    isValidatingVoucher ||
                    !voucherCode.trim() ||
                    lineItems.length === 0
                  }
                  sx={{ minWidth: 100 }}
                >
                  {isValidatingVoucher ? (
                    <CircularProgress size={20} />
                  ) : (
                    "Apply"
                  )}
                </Button>
              </Box>

              {/* List of applied vouchers */}
              {appliedVouchers.length > 0 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  {appliedVouchers.map((voucher) => (
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
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          mb: 1,
                        }}
                      >
                        <Box
                          sx={{ display: "flex", alignItems: "center", gap: 1 }}
                        >
                          <Chip
                            icon={<ReceiptIcon />}
                            label={voucher.validation.barcode_no}
                            color="info"
                            size="small"
                          />
                          <Typography variant="caption" color="text.secondary">
                            Full Value: Rs.{" "}
                            {fmtLKR(voucher.validation.balance || 0)}
                            {voucher.validation.expiry_date &&
                              ` • Expires: ${new Date(voucher.validation.expiry_date).toLocaleDateString()}`}
                          </Typography>
                        </Box>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() =>
                            voucher.validation.voucher_id &&
                            handleRemoveVoucher(voucher.validation.voucher_id)
                          }
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Box>
                      <Box
                        sx={{ display: "flex", gap: 2, alignItems: "center" }}
                      >
                        <Typography
                          variant="body2"
                          color="info.dark"
                          fontWeight="bold"
                        >
                          Applying: Rs. {fmtLKR(voucher.amountToRedeem)}
                        </Typography>
                        {(voucher.validation.balance || 0) >
                          voucher.amountToRedeem && (
                          <Typography variant="caption" color="warning.main">
                            (One-time use - Rs.{" "}
                            {fmtLKR(
                              (voucher.validation.balance || 0) -
                                voucher.amountToRedeem,
                            )}{" "}
                            will be forfeited)
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  ))}
                  {/* Total voucher payment */}
                  <Box
                    sx={{
                      p: 1,
                      bgcolor: "success.lighter",
                      borderRadius: 1,
                      textAlign: "right",
                    }}
                  >
                    <Typography
                      variant="body2"
                      color="success.dark"
                      fontWeight="bold"
                    >
                      Total Voucher Payment: Rs.{" "}
                      {fmtLKR(
                        appliedVouchers.reduce(
                          (sum, v) => sum + Number(v.amountToRedeem),
                          0,
                        ),
                      )}
                    </Typography>
                  </Box>
                </Box>
              )}
            </Paper>
          )}

          {/* Credit Note Payment Section */}
          {lineItems.length > 0 &&
            !state.isEditing &&
            selectedCustomerId &&
            selectedCustomerId > 0 && (
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  mb: 2,
                  bgcolor: creditNoteAmount > 0 ? "success.50" : "grey.50",
                  borderColor:
                    creditNoteAmount > 0 ? "success.main" : "divider",
                }}
              >
                <Box
                  sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}
                >
                  <ReceiptIcon
                    color={creditNoteAmount > 0 ? "success" : "action"}
                  />
                  <Typography variant="subtitle2" fontWeight="bold">
                    Apply Credit Note Balance
                  </Typography>
                  {isLoadingCreditBalance && <CircularProgress size={16} />}
                </Box>

                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", mb: 2 }}
                >
                  Available Balance: Rs. {fmtLKR(availableCreditBalance)}
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
                        // Calculate remaining invoice amount using canonical order
                        const totals = calcOrderTotals();

                        // Max is minimum of: available balance or remaining invoice amount
                        const maxAllowed = Math.min(
                          availableCreditBalance,
                          Math.max(0, totals.afterVoucher),
                        );
                        const value = Math.min(inputValue, maxAllowed);

                        setCreditNoteAmount(Math.max(0, value));
                      }}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">Rs.</InputAdornment>
                        ),
                        inputProps: {
                          min: 0,
                          max: availableCreditBalance,
                          step: 0.01,
                        },
                      }}
                      helperText={`Max: Rs. ${fmtLKR(
                        Math.min(
                          availableCreditBalance,
                          Math.max(0, calcOrderTotals().afterVoucher),
                        ),
                      )}`}
                    />
                    {creditNoteAmount > 0 && (
                      <Box
                        sx={{
                          mt: 2,
                          p: 1,
                          bgcolor: "success.lighter",
                          borderRadius: 1,
                          textAlign: "right",
                        }}
                      >
                        <Typography
                          variant="body2"
                          color="success.dark"
                          fontWeight="bold"
                        >
                          Credit Note Applied: Rs. {fmtLKR(creditNoteAmount)}
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

          {/* ── Live Total Bar removed ── */}

        </>
      )}

      {/* Step 3: Payment Details */}
      {formStep === 1 && (
        <>
          {state.isEditing && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Payment details can’t be changed when editing an existing order —
              only line items are updated.
            </Alert>
          )}
          {/* Split Payment UI — inert while editing so payment changes can't be
              made (the update only persists line items). */}
          <Paper
            variant="outlined"
            sx={{
              p: 2,
              mb: 2,
              ...(state.isEditing
                ? { pointerEvents: "none", opacity: 0.6 }
                : {}),
            }}
          >
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
              <Typography variant="h6" fontWeight="bold">Payment Details</Typography>
              <Button
                size="small"
                startIcon={<AddIcon />}
                variant="outlined"
                onClick={addSplitRow}
              >
                Add Payment Method
              </Button>
            </Box>

            {splitPayments.map((row, idx) => (
              <Box key={row.id} sx={{ mb: 2, p: 1.5, bgcolor: "grey.50", borderRadius: 1, border: "1px solid", borderColor: "divider" }}>
                {/* Row header */}
                <Box sx={{ display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 20 }}>#{idx + 1}</Typography>
                  <TextField
                    select size="small" label="Method"
                    value={row.method}
                    onChange={(e) => {
                      updateSplitRow(row.id, { method: e.target.value });
                      if (idx === 0) state.setFormData({ ...state.formData, payment_method: e.target.value });
                    }}
                    sx={{ minWidth: 160 }}
                  >
                    {CUSTOMER_PAYMENT_METHOD.map((opt) => (
                      <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    size="small" type="number" label="Amount (Rs.)"
                    value={row.amount}
                    onChange={(e) => handlePaymentAmountChange(row.id, parseFloat(e.target.value) || 0)}
                    sx={{ width: 160 }}
                    inputProps={{ min: 0, step: 0.01 }}
                  />
                  {splitPayments.length > 1 && (
                    <Tooltip title="Remove this payment">
                      <IconButton size="small" color="error" onClick={() => removeSplitRow(row.id)}>
                        <RemoveCircleOutlineIcon />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>

                {/* Cheque details */}
                {row.method === "cheque" && (
                  <Box sx={{ display: "flex", gap: 1.5, mt: 1.5, flexWrap: "wrap" }}>
                    <TextField
                      size="small" label="Cheque No."
                      value={row.cheque_number}
                      onChange={(e) => updateSplitRow(row.id, { cheque_number: e.target.value.replace(/\D/g, "") })}
                      inputProps={{ inputMode: "numeric" }}
                      sx={{ width: 150 }}
                      required
                    />
                    <TextField
                      size="small" label="Bank"
                      value={row.cheque_bank}
                      onChange={(e) => updateSplitRow(row.id, { cheque_bank: e.target.value })}
                      sx={{ width: 180 }}
                      required
                    />
                    <TextField
                      size="small" label="Cheque Date" type="date"
                      value={row.cheque_date}
                      onChange={(e) => updateSplitRow(row.id, { cheque_date: e.target.value })}
                      InputLabelProps={{ shrink: true }}
                      sx={{ width: 160 }}
                    />
                  </Box>
                )}

                {/* Card details */}
                {row.method === "card" && (
                  <Box sx={{ display: "flex", gap: 1.5, mt: 1.5, flexWrap: "wrap" }}>
                    <TextField
                      select size="small" label="Card Type"
                      value={selectedPaymentCardId || ""}
                      onChange={(e) => setSelectedPaymentCardId(Number(e.target.value))}
                      sx={{ minWidth: 200 }}
                      required
                    >
                      <MenuItem value="" disabled>Select card</MenuItem>
                      {paymentCards.map((card: PaymentCard) => (
                        <MenuItem key={card.id} value={card.id}>
                          {card.card_name} ({card.card_type}){!hideServiceCharge && ` — ${card.service_charge_percent}% fee`}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      size="small" label="Card Ref / Approval Code"
                      value={row.card_ref_number}
                      onChange={(e) => updateSplitRow(row.id, { card_ref_number: e.target.value })}
                      sx={{ width: 200 }}
                    />
                    <TextField
                      size="small" label="Card Holder"
                      value={row.card_holder_name}
                      onChange={(e) => updateSplitRow(row.id, { card_holder_name: e.target.value })}
                      sx={{ width: 180 }}
                    />
                    {selectedPaymentCard && (selectedPaymentCard.service_charge_percent || 0) > 0 && (
                      <Box sx={{ p: 1, bgcolor: "warning.lighter", borderRadius: 1, alignSelf: "center" }}>
                        <Typography variant="caption" color="warning.dark">
                          {selectedPaymentCard.service_charge_percent}% service charge applies
                        </Typography>
                      </Box>
                    )}
                  </Box>
                )}

                {/* Bank Transfer details */}
                {row.method === "bank_transfer" && (
                  <Box sx={{ display: "flex", gap: 1.5, mt: 1.5, flexWrap: "wrap" }}>
                    <TextField
                      size="small" label="Bank Name"
                      value={row.bank_name}
                      onChange={(e) => updateSplitRow(row.id, { bank_name: e.target.value })}
                      sx={{ width: 200 }}
                      required
                    />
                    <TextField
                      size="small" label="Reference No."
                      value={row.bank_transfer_ref}
                      onChange={(e) => updateSplitRow(row.id, { bank_transfer_ref: e.target.value })}
                      sx={{ width: 200 }}
                      required
                    />
                  </Box>
                )}

                {/* Credit details & terms */}
                {row.method === "credit" && (
                  <Box sx={{ mt: 1.5, display: "flex", flexDirection: "column", gap: 1.5 }}>
                    {/* Customer Credit Status Info */}
                    <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", p: 1.5, bgcolor: "info.lighter", borderRadius: 1 }}>
                      <Typography variant="body2" color="info.dark" fontWeight="medium">
                        Available Credit Days: <strong>{customerCreditStatus?.credit_days ?? 0} days</strong>
                      </Typography>
                      <Typography variant="body2" color="info.dark" fontWeight="medium">
                        Available Credit: <strong>Rs. {customerCreditStatus ? fmtLKR(customerCreditStatus.available_credit) : "0.00"}</strong>
                      </Typography>
                    </Box>

                    {/* Credit Terms Dropdown */}
                    <Box sx={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}>
                      <TextField
                        select size="small" label="Credit Terms"
                        value={row.credit_terms || "30 days"}
                        onChange={(e) => updateSplitRow(row.id, { credit_terms: e.target.value })}
                        sx={{ minWidth: 200 }}
                      >
                        <MenuItem value="30 days">30 Days</MenuItem>
                        <MenuItem value="60 days">60 Days</MenuItem>
                        <MenuItem value="90 days">90 Days</MenuItem>
                        <MenuItem value="3 months">3 Months (Installments)</MenuItem>
                        <MenuItem value="6 months">6 Months (Installments)</MenuItem>
                        <MenuItem value="12 months">12 Months (Installments)</MenuItem>
                      </TextField>

                      {/* Monthly Amount Label */}
                      {(() => {
                        const terms = row.credit_terms || "30 days";
                        let months = 1;
                        if (terms.includes("3 months") || terms.includes("90 days")) months = 3;
                        else if (terms.includes("6 months")) months = 6;
                        else if (terms.includes("12 months")) months = 12;
                        else if (terms.includes("60 days")) months = 2;
                        
                        const monthlyAmt = row.amount / months;
                        return (
                          <Chip
                            color="primary"
                            variant="outlined"
                            label={`Monthly Amount: Rs. ${fmtLKR(monthlyAmt)} / mo`}
                            sx={{ fontWeight: "bold" }}
                          />
                        );
                      })()}
                    </Box>
                  </Box>
                )}
              </Box>
            ))}

            {/* Payment totals balance */}
            {(() => {
              const totals = calcOrderTotals();
              const grandTotal = totals.grandTotal;
              const entered = splitPayments.reduce((s, p) => s + (p.amount || 0), 0);
              const remaining = grandTotal - entered;
              const isBalanced = Math.abs(remaining) < 0.01;
              return (
                <Box sx={{ mt: 1 }}>
                  <Divider sx={{ mb: 1 }} />
                  <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                    <Typography variant="body2" color="text.secondary">Total Entered:</Typography>
                    <Typography variant="body2" fontWeight="bold" color={isBalanced ? "success.main" : "warning.main"}>
                      Rs. {fmtLKR(entered)}
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="body2" color="text.secondary">Remaining:</Typography>
                    <Typography variant="body2" fontWeight="bold" color={isBalanced ? "success.main" : "error.main"}>
                      {remaining > 0.01 ? `Rs. ${fmtLKR(remaining)}` : remaining < -0.01 ? `- Rs. ${fmtLKR(Math.abs(remaining))} (overpaid)` : "✔ Fully paid"}
                    </Typography>
                  </Box>
                </Box>
              );
            })()}
          </Paper>

          {/* Order Summary - Show final calculation */}
          <Paper
            variant="outlined"
            sx={{
              p: 3,
              mt: 3,
              mb: 2,
              bgcolor: "primary.50",
              borderColor: "primary.main",
              borderWidth: 2,
            }}
          >
            <Typography
              variant="h6"
              fontWeight="bold"
              color="primary.main"
              sx={{ mb: 2 }}
            >
              Order Summary
            </Typography>

            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              {/* Gross Total */}
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Typography variant="body1" color="text.secondary">
                  Gross Total:
                </Typography>
                <Typography variant="body1" fontWeight="medium">
                  Rs. {fmtLKR(taxMode === "inclusive" && effectiveTaxRate > 0 ? calculateGrossTotal() / (1 + effectiveTaxRate / 100) : calculateGrossTotal())}
                </Typography>
              </Box>

              {/* Item Discounts */}
              {calculateTotalItemDiscounts() > 0 && (
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Typography variant="body1" color="text.secondary">
                    Item Discounts:
                  </Typography>
                  <Typography variant="body1" fontWeight="medium" color="error.main">
                    - Rs. {fmtLKR(taxMode === "inclusive" && effectiveTaxRate > 0 ? calculateTotalItemDiscounts() / (1 + effectiveTaxRate / 100) : calculateTotalItemDiscounts())}
                  </Typography>
                </Box>
              )}

              {/* Subtotal (after item discounts) */}
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Typography variant="body1" color="text.secondary">
                  Subtotal:
                </Typography>
                <Typography variant="body1" fontWeight="medium">
                  Rs. {fmtLKR(taxMode === "inclusive" && effectiveTaxRate > 0 ? calculateLineItemsTotal() / (1 + effectiveTaxRate / 100) : calculateLineItemsTotal())}
                </Typography>
              </Box>

              {/* Coupon Discount - applied on subtotal (step 4) */}
              {couponValidation &&
                (couponValidation.calculated_discount ?? 0) > 0 && (
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Typography variant="body1" color="text.secondary">
                      Coupon (ID: {couponValidation.coupon_id}):
                    </Typography>
                    <Typography
                      variant="body1"
                      fontWeight="medium"
                      color="error.main"
                    >
                      - Rs. {fmtLKR(couponValidation.calculated_discount ?? 0)}
                    </Typography>
                  </Box>
                )}

              {/* Invoice Discount - applied after coupon (step 5) */}
              {discountValue > 0 && (
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Typography variant="body1" color="text.secondary">
                    Discount{" "}
                    {discountType === "percent"
                      ? `(${discountValue}%)`
                      : "(Fixed)"}
                    :
                  </Typography>
                  <Typography
                    variant="body1"
                    fontWeight="medium"
                    color="error.main"
                  >
                    - Rs. {fmtLKR(calcOrderTotals().invoiceDiscount)}
                  </Typography>
                </Box>
              )}

              {/* Tax */}
              {effectiveTaxRate > 0 && (
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Typography variant="body1" color="text.secondary">
                    {taxMode === "inclusive" ? `Tax (${effectiveTaxRate}%):` : `Tax (${effectiveTaxRate}%):`}
                  </Typography>
                  <Typography
                    variant="body1"
                    fontWeight="medium"
                    color="info.main"
                  >
                    Rs. {fmtLKR(calcOrderTotals().taxAmount)}
                  </Typography>
                </Box>
              )}

              {/* Gift Voucher */}
              {appliedVouchers.length > 0 &&
                appliedVouchers.reduce(
                  (sum, v) => sum + Number(v.amountToRedeem),
                  0,
                ) > 0 && (
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Typography variant="body1" color="text.secondary">
                      Gift Voucher ({appliedVouchers.length}):
                    </Typography>
                    <Typography
                      variant="body1"
                      fontWeight="medium"
                      color="secondary.main"
                    >
                      - Rs.{" "}
                      {fmtLKR(
                        appliedVouchers.reduce(
                          (sum, v) => sum + Number(v.amountToRedeem),
                          0,
                        ),
                      )}
                    </Typography>
                  </Box>
                )}

              {/* Credit Note */}
              {creditNoteAmount > 0 && (
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Typography variant="body1" color="text.secondary">
                    Credit Note Applied:
                  </Typography>
                  <Typography
                    variant="body1"
                    fontWeight="medium"
                    color="success.main"
                  >
                    - Rs. {fmtLKR(calcOrderTotals().appliedCreditNote)}
                  </Typography>
                </Box>
              )}

              {/* Service Charge - show whenever a card with charge is in any split row */}
              {selectedPaymentCard &&
                calcOrderTotals().serviceCharge > 0 && (
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Typography variant="body1" color="text.secondary">
                      Service Charge (
                      {selectedPaymentCard.service_charge_percent}%):
                    </Typography>
                    <Typography
                      variant="body1"
                      fontWeight="medium"
                      color="warning.main"
                    >
                      + Rs. {fmtLKR(calcOrderTotals().serviceCharge)}
                    </Typography>
                  </Box>
                )}

              {/* Divider */}
              <Box sx={{ borderTop: 2, borderColor: "primary.main", my: 1 }} />

              {/* Grand Total */}
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Typography variant="h5" fontWeight="bold" color="primary.main">
                  Total Amount to Pay{taxMode === "inclusive" && effectiveTaxRate > 0 ? " (incl. taxes)" : ""}:
                </Typography>
                <Typography variant="h4" fontWeight="bold" color="primary.main">
                  Rs. {fmtLKR(calcOrderTotals().grandTotal)}
                </Typography>
              </Box>
            </Box>
          </Paper>

          {/* Agent Commission Section */}
          {state.formData.customer_agent_id && (() => {
            const agent = (customers || []).find((c: any) => c.id === state.formData.customer_agent_id);
            const baseRate = agent?.commission_rate ?? 0;
            const totals = calcOrderTotals();
            // Effective rate: manual override > agent rate > 0
            const effectiveRate = manualCommissionRate !== null ? manualCommissionRate : baseRate;
            const calculatedAmt = totals.grandTotal * (effectiveRate / 100);
            // Effective amount: manual amount override > calculated
            const effectiveAmt = manualCommissionAmount !== null ? manualCommissionAmount : calculatedAmt;
            return (
              <Paper variant="outlined" sx={{ p: 2, mb: 2, borderColor: "primary.main", borderWidth: 2 }}>
                {/* Header row */}
                <Box sx={{ mb: 1.5 }}>
                  <Typography variant="subtitle2" fontWeight="bold" color="primary">
                    Agent Commission — {agent?.customer_name ?? `Agent #${state.formData.customer_agent_id}`}
                  </Typography>
                  {baseRate > 0 && manualCommissionRate === null && manualCommissionAmount === null && (
                    <Typography variant="caption" color="text.secondary">
                      Default: {baseRate}% × Rs. {fmtLKR(totals.grandTotal)} = Rs. {fmtLKR(calculatedAmt)}
                    </Typography>
                  )}
                </Box>

                {/* Manual override row */}
                <Box sx={{ display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap", mb: 1 }}>
                  <TextField
                    size="small"
                    label="Rate % (override)"
                    type="number"
                    value={manualCommissionRate ?? ""}
                    placeholder={baseRate > 0 ? `Default: ${baseRate}%` : "Enter rate"}
                    onChange={(e) => {
                      const v = e.target.value === "" ? null : parseFloat(e.target.value);
                      setManualCommissionRate(v);
                      // If rate changes, clear manual amount so it recalculates
                      setManualCommissionAmount(null);
                    }}
                    inputProps={{ min: 0, max: 100, step: 0.01 }}
                    sx={{ width: 160 }}
                    InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
                  />
                  <TextField
                    size="small"
                    label="Commission Amount (Rs.)"
                    type="number"
                    value={manualCommissionAmount !== null ? manualCommissionAmount : effectiveAmt.toFixed(2)}
                    onChange={(e) => {
                      setManualCommissionAmount(parseFloat(e.target.value) || 0);
                    }}
                    inputProps={{ min: 0, step: 0.01 }}
                    sx={{ width: 200 }}
                    InputProps={{ startAdornment: <InputAdornment position="start">Rs.</InputAdornment> }}
                  />
                  {(manualCommissionRate !== null || manualCommissionAmount !== null) && (
                    <Button
                      size="small" variant="text" color="secondary"
                      onClick={() => { setManualCommissionRate(null); setManualCommissionAmount(null); }}
                    >
                      Reset to default
                    </Button>
                  )}
                  <Chip
                    label={`Commission: Rs. ${fmtLKR(effectiveAmt)}`}
                    color="primary"
                    size="small"
                    variant="outlined"
                  />
                </Box>

                <Alert severity="info" sx={{ mt: 1 }}>
                  Commission will be created as <strong>pending</strong> and requires approval before payment.
                </Alert>
              </Paper>
            );
          })()}

          {/* Step 3 Navigation */}
        </>
      )}
    </>
  );

  return (
    <>
      <MasterDetailLayout
        title="Sales Orders"
        headerActions={
          <Button
            variant="outlined"
            size="small"
            startIcon={<DownloadIcon />}
            onClick={handleExportCSV}
            disabled={filteredInvoices.length === 0}
            sx={{ mr: 1 }}
          >
            Export CSV
          </Button>
        }
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ["sales"] });
          queryClient.invalidateQueries({ queryKey: ["customers"] });
          queryClient.invalidateQueries({ queryKey: ["payment-cards-active"] });
        }}
      >
        <Box
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: { xs: "column", md: "row" },
            overflow: "hidden",
          }}
        >
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
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 1,
                  padding: 1.5,
                  paddingBottom: 0,
                }}
              >
                <SalesFilterPanel
                  statusOptions={INVOICE_STATUS_OPTIONS}
                  statusValue={filterStatus}
                  onStatusChange={setFilterStatus}
                  branches={branches}
                  branchValue={filterBranch}
                  onBranchChange={setFilterBranch}
                />
              </Box>
            }
          >
            {filteredInvoices.map((invoice) => {
              const isSelected = state.selectedItem?.id === invoice.id;
              const customer = customers?.find(
                (c) => c.id === invoice.customer_id,
              );
              const customerName =
                customer?.customer_name || "Unknown Customer";
              return (
                <SelectableListItem
                  key={invoice.id}
                  isSelected={isSelected}
                  onClick={() => handleSelectInvoice(invoice)}
                  primaryText={
                    <Box
                      sx={{
                        display: "flex",
                        flexDirection: "column",
                        width: "100%",
                        gap: 0.5,
                      }}
                    >
                      {/* Invoice No */}
                      <Box
                        sx={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <span>{invoice.invoice_no}</span>
                        {isSelected && (
                          <Typography
                            component="span"
                            variant="caption"
                            sx={{ color: "inherit", opacity: 0.7 }}
                          >
                            (Invoice No)
                          </Typography>
                        )}
                      </Box>
                      {/* Total */}
                      <Box
                        sx={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <Typography
                          component="span"
                          variant="caption"
                          fontWeight={600}
                          sx={{
                            color: isSelected ? "common.white" : "text.primary",
                          }}
                        >
                          Rs. {fmtLKR(calculateTotal(invoice))}
                        </Typography>
                        {isSelected && (
                          <Typography
                            component="span"
                            variant="caption"
                            sx={{ color: "inherit", opacity: 0.7 }}
                          >
                            (Total)
                          </Typography>
                        )}
                      </Box>
                      {/* Date & Customer Name - only when selected */}
                      {isSelected && (
                        <>
                          <Box
                            sx={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                            }}
                          >
                            <Typography component="span" variant="caption">
                              {format(
                                new Date(invoice.created_date),
                                "MMM dd, yyyy",
                              )}
                            </Typography>
                            <Typography
                              component="span"
                              variant="caption"
                              sx={{ color: "inherit", opacity: 0.7 }}
                            >
                              (Date)
                            </Typography>
                          </Box>
                          <Box
                            sx={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                            }}
                          >
                            <Typography component="span" variant="caption">
                              {customerName}
                            </Typography>
                            <Typography
                              component="span"
                              variant="caption"
                              sx={{ color: "inherit", opacity: 0.7 }}
                            >
                              (Customer)
                            </Typography>
                          </Box>
                          <Box
                            sx={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                            }}
                          >
                            <Typography
                              component="span"
                              variant="caption"
                              sx={{ textTransform: "capitalize" }}
                            >
                              {getPaymentMethodsDisplay(invoice)}
                            </Typography>
                            <Typography
                              component="span"
                              variant="caption"
                              sx={{ color: "inherit", opacity: 0.7 }}
                            >
                              (Payment)
                            </Typography>
                          </Box>
                          {/* Status Chips - shown below all fields when selected */}
                          <Box
                            sx={{
                              display: "flex",
                              gap: 0.5,
                              mt: 0.5,
                              flexWrap: "wrap",
                            }}
                          >
                            <Chip
                              label={invoice.status ? "Active" : "Inactive"}
                              size="small"
                              color={invoice.status ? "success" : "default"}
                              sx={{ height: 18, fontSize: "0.65rem" }}
                            />
                            <TStatusChip
                              status={
                                invoice.approval_status || "pending_approval"
                              }
                              statusMap="invoice"
                              size="small"
                              sx={{ height: 18, fontSize: "0.65rem" }}
                            />
                          </Box>
                        </>
                      )}
                    </Box>
                  }
                  secondaryText={
                    !isSelected
                      ? `${format(new Date(invoice.created_date), "MMM dd, yyyy")} • ${customerName}`
                      : undefined
                  }
                  isFavorite={state.favorites.includes(invoice.id)}
                  onToggleFavorite={() => state.toggleFavorite(invoice.id)}
                />
              );
            })}
          </SearchableList>

          {/* Detail Panel */}
          <Box
            sx={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <DetailPanelHeader
              icon={<ReceiptIcon color="primary" />}
              breadcrumbs={[
                { label: "Sales", href: "/sales" },
                { label: "Sales Orders" },
              ]}
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
                      {
                        label: state.selectedItem.status
                          ? "Active"
                          : "Inactive",
                        color: state.selectedItem.status
                          ? "success"
                          : "default",
                      },
                    ]
                  : undefined
              }
            />

            <ActionToolbar
              canCreate={canCreate}
              canDelete={
                canDelete && state.selectedItem?.approval_status !== "completed"
              }
              canUpdate={
                canUpdate && state.selectedItem?.approval_status !== "completed"
              }
              isEditing={state.isEditing}
              isCreating={state.isCreating}
              hasSelection={!!state.selectedItem}
              onAdd={handleCreate}
              onDelete={handleDelete}
              onSave={handleSave}
              onCancel={handleCancel}
              isSaving={createMutation.isPending || updateMutation.isPending}
              saveDisabled={lineItems.length === 0 || formStep !== 1}
              customActions={
                state.isCreating && formStep === 0 ? (
                  <Button
                    size="small"
                    variant="contained"
                    color="primary"
                    onClick={handleNextStep}
                    disabled={!isStep1Valid}
                    endIcon={<ArrowForwardIcon />}
                  >
                    Next: Line Items
                  </Button>
                ) : state.isCreating && formStep === 1 ? (
                  customActions
                ) : customActions
              }
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
      <TConfirmDialog
        {...approveDialog.dialogProps}
        confirmText="Approve"
        confirmColor="success"
      />
      <TConfirmDialog
        {...cancelDialog.dialogProps}
        confirmText="Cancel Order"
        confirmColor="error"
      />
      <TConfirmDialog {...creditWarningDialog.dialogProps} />

      {/* Return Entire Invoice Dialog */}
      <Dialog
        open={returnInvoiceDialogOpen}
        onClose={() => setReturnInvoiceDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Return Entire Invoice</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            This creates a full sale return for{" "}
            <strong>{state.selectedItem?.invoice_no}</strong> covering every
            not-yet-returned item. It must be approved and processed before the
            reversing financial records are posted.
          </Alert>
          <TextField
            select
            fullWidth
            size="small"
            label="Refund Method"
            value={returnPaymentMethod}
            onChange={(e) => setReturnPaymentMethod(e.target.value)}
            sx={{ mb: 2 }}
          >
            <MenuItem value="credit_note">Store Credit (Credit Note)</MenuItem>
            <MenuItem value="cash">Cash Refund</MenuItem>
            <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
            <MenuItem value="cheque">Cheque</MenuItem>
          </TextField>
          <TextField
            select
            fullWidth
            size="small"
            label="Return Reason"
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
          >
            <MenuItem value="customer_changed_mind">
              Customer Changed Mind
            </MenuItem>
            <MenuItem value="defective">Defective Product</MenuItem>
            <MenuItem value="wrong_item">Wrong Item Delivered</MenuItem>
            <MenuItem value="damaged">Damaged in Transit</MenuItem>
            <MenuItem value="other">Other</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReturnInvoiceDialogOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="warning"
            onClick={handleReturnInvoice}
            disabled={returnFullMutation.isPending}
            startIcon={<AssignmentReturnIcon />}
          >
            Create Return
          </Button>
        </DialogActions>
      </Dialog>

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
      <Dialog
        open={remarksDialogOpen}
        onClose={() => setRemarksDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
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
          <Button
            onClick={() => setRemarksDialogOpen(false)}
            variant="outlined"
          >
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
          <Button
            onClick={() => setItemRemarkModalOpen(false)}
            variant="outlined"
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Print Preview Dialog */}
      {selectedItemForPrint && (
        <TPrintPreviewDialog
          open={printDialogOpen}
          onClose={() => {
            setPrintDialogOpen(false);
            setSelectedItemForPrint(null);
          }}
          documentType="invoice"
          documentId={selectedItemForPrint.id}
          title={`Print Invoice: ${selectedItemForPrint.invoice_no}`}
        />
      )}

      {/* Email Dialog */}
      {state.selectedItem && (
        <TEmailDialog
          open={emailDialogOpen}
          onClose={() => setEmailDialogOpen(false)}
          documentType="invoice"
          documentId={state.selectedItem.id}
        />
      )}
    </>
  );
}
