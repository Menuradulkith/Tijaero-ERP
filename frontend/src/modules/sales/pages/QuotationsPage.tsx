/**
 * QuotationsPage - Refactored to use Tijaero-style reusable components
 */

import { usePermission } from "@/auth/permissions";
import {
  ActionToolbar,
  canPrintDocument,
  DetailPanelHeader,
  EmptyState,
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
  TCurrency,
  TDate,
  TPrintButton,
  TPrintPreviewDialog,
  TStatusChip,
  TSteps,
  useMasterDetailState,
  useTConfirmDialog
} from "@/components/tijaero";
import { useReferenceData } from "@/hooks";
import { minimumPriceApi } from "@/modules/inventory/api";
import SalesFilterPanel from "@/modules/sales/components/ui/SalesFilterPanel";
import {
  Add as AddIcon,
  ArrowBack as ArrowBackIcon,
  ArrowForward as ArrowForwardIcon,
  CheckCircle as ApproveIcon,
  Cancel as CancelIcon,
  Delete as DeleteIcon,
  Description as QuoteIcon,
  Inventory as StockIcon,
  LocalShipping as POIcon,
  Receipt as InvoiceIcon,
  Send as SendIcon,
  SwapHoriz as ProformaIcon,
  ThumbDown as RejectIcon,
  Visibility as ReviewIcon
} from "@mui/icons-material";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Paper,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { quotationApi } from "../quotation-api";
import {
  QUOTE_TYPE_LABELS,
  QuoteType,
  SalesQuote,
  SalesQuoteCreate,
  SalesQuoteItemCreate,
  StockAvailabilityItem
} from "../quotation-types";

// Configuration
const SORT_OPTIONS: SortOption[] = [
  { value: "created_date", label: "Date (Newest)" },
  { value: "quote_no", label: "Quote No" },
  { value: "total_amount", label: "Total Amount" },
  { value: "valid_until", label: "Validity" },
];

// Form steps for stepper workflow
const FORM_STEPS = ["Quote Information", "Quote Items"];

// Line item type
interface ItemFormData {
  product_id: number;
  quantity: number;
  selling_price: number;
  minimum_selling_price: number;
  warrenty_month: string;
  min_price?: number;
  max_price?: number;
  is_price_estimate: boolean;
  description?: string;
  discount_percent: number;
  tax_rate: number;
}

// Initial form data
const getEmptyQuoteForm = (quoteType: QuoteType): Partial<SalesQuoteCreate> => ({
  quote_type: quoteType,
  branch_code: "MAIN",
  customer_id: 0,
  sale_rep_id: 0,
  valid_until: format(addDays(new Date(), 30), "yyyy-MM-dd"),
  is_estimate: quoteType === "quotation",
  remarks: "",
  customer_notes: "",
  special: false,
  items: [],
});

export default function QuotationsPage() {
  const queryClient = useQueryClient();
  const location = useLocation();

  // Determine which type this page shows based on URL
  const pageQuoteType: QuoteType = location.pathname.includes('proforma') ? 'proforma' : 'quotation';
  const pageTitle = pageQuoteType === 'proforma' ? 'Proforma Invoices' : 'Quotations';

  // Line items state
  const [lineItems, setLineItems] = useState<ItemFormData[]>([]);

  // Form step state for stepper workflow
  const [formStep, setFormStep] = useState(0);

  // Filter states
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  // Print Dialog State
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [selectedQuoteForPrint, setSelectedQuoteForPrint] = useState<SalesQuote | null>(null);

  // Workflow Dialog States
  const [stockCheckDialogOpen, setStockCheckDialogOpen] = useState(false);
  const [stockAvailability, setStockAvailability] = useState<StockAvailabilityItem[]>([]);
  const [stockCheckLoading, setStockCheckLoading] = useState(false);
  const [stockAllSufficient, setStockAllSufficient] = useState(false);
  const [createPODialogOpen, setCreatePODialogOpen] = useState(false);
  const [convertInvoiceDialogOpen, setConvertInvoiceDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [cancelLinkedPO, setCancelLinkedPO] = useState(false);
  const [customerApproveDialogOpen, setCustomerApproveDialogOpen] = useState(false);
  const [customerApprovalName, setCustomerApprovalName] = useState("");
  const [customerApprovalRemarks, setCustomerApprovalRemarks] = useState("");
  const [poFormData, setPOFormData] = useState({
    first_suppliers_id: 0,
    second_suppliers_id: 0,
    payment_method: "credit",
    purchasing_invoice_no: "",
    good_received_note_date: format(new Date(), "yyyy-MM-dd"),
    remarks: "",
  });
  const [invoiceFormData, setInvoiceFormData] = useState({
    payment_method: "cash",
    cash_amount: 0,
    card_visa_amount: 0,
    card_mastercard_amount: 0,
    card_amex_amount: 0,
    cheque_amount: 0,
    bank_transfer_amount: 0,
    credit_amount: 0,
    remarks: "",
  });

  // Permissions
  const canCreate = usePermission("sales", "create");
  const canDelete = usePermission("sales", "delete");
  const canUpdate = usePermission("sales", "update");

  // Confirm dialogs
  const confirmDialog = useTConfirmDialog();



  // Use reusable state hook
  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem: selectedQuote,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    hasChanges,
    favorites,
    toggleFavorite,
    formData,
    setFormData,
    handleSelectItem: handleSelectQuote,
    handleNew: handleNewQuote,
    handleCancel: baseHandleCancel,
    handleStartEdit,
  } = useMasterDetailState<SalesQuote, Partial<SalesQuoteCreate>>({
    initialFormData: getEmptyQuoteForm(pageQuoteType),
    resetFormFromItem: (quote) => quote,
    favoritesKey: `${pageQuoteType}_favorites`,
    defaultSortField: "created_date",
    confirmUnsavedChanges: async () => {
      return await confirmDialog.confirm({
        title: "Unsaved Changes",
        message: "You have unsaved changes. Are you sure you want to discard them?",
        confirmText: "Discard",
        confirmColor: "error",
      });
    },
    extraDirty: lineItems.length > 0,
    onDiscard: () => { setLineItems([]); setFormStep(0); },
  });

  // Data fetching — filtered by page type
  const { data: quotesData, isLoading } = useQuery({
    queryKey: ["sales-quotes", pageQuoteType],
    queryFn: () => quotationApi.getAll({ quote_type: pageQuoteType, per_page: 200 }),
  });

  // OPTIMIZED: Use aggregated reference data endpoint instead of separate API calls
  const { data: refData, filteredBranches } = useReferenceData(["products", "branches", "customers", "employees", "suppliers"]);
  const products = refData?.products || [];
  const branches = filteredBranches || [];
  const customers = refData?.customers || [];
  const employees = refData?.employees || [];
  interface Supplier { id: number; supplier_name?: string; name?: string; [key: string]: unknown; }
  const suppliers = ((refData as Record<string, unknown[]>)?.suppliers || []) as Supplier[];

  // Fetch selected quote with items
  const { data: selectedQuoteDetails } = useQuery({
    queryKey: ["sales-quote-details", selectedQuote?.id],
    queryFn: () => quotationApi.getById(selectedQuote!.id),
    enabled: !!selectedQuote?.id && !isCreating && !isEditing,
  });

  // Reset selection and form when navigating between quotations and proforma routes
  useEffect(() => {
    handleSelectQuote(null as unknown as SalesQuote);
    setLineItems([]);
    setFormStep(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageQuoteType]);

  // Populate line items when quote details are loaded
  useEffect(() => {
    if (selectedQuoteDetails?.items && !isCreating && !isEditing) {
      setLineItems(selectedQuoteDetails.items.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        selling_price: Number(item.selling_price),
        minimum_selling_price: Number(item.minimum_selling_price),
        warrenty_month: item.warrenty_month,
        min_price: 0,
        max_price: 0,
        is_price_estimate: item.is_price_estimate,
        description: item.description || "",
        discount_percent: item.discount_percentage || 0,
        tax_rate: 0,
      })));
    }
  }, [selectedQuoteDetails, isCreating, isEditing]);

  // Filter and sort
  const filteredQuotes = useMemo(() => {
    const quotes = (quotesData?.items || []).filter(Boolean);
    let filtered = quotes.filter(
      (quote) =>
        quote.quote_no?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        quote.branch_code?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Apply branch filter
    if (filterBranch) {
      filtered = filtered.filter(quote => quote.branch_code === filterBranch);
    }

    filtered.sort((a, b) => {
      if (sortField === "quote_no") {
        return a.quote_no.localeCompare(b.quote_no);
      } else if (sortField === "created_date") {
        return new Date(b.created_date).getTime() - new Date(a.created_date).getTime();
      } else if (sortField === "total_amount") {
        return b.total_amount - a.total_amount;
      } else if (sortField === "valid_until") {
        return new Date(b.valid_until).getTime() - new Date(a.valid_until).getTime();
      }
      return 0;
    });

    return filtered;
  }, [quotesData?.items, searchQuery, sortField, filterBranch]);

  // Auto-select first item when data loads
  useEffect(() => {
    if (filteredQuotes.length > 0 && !selectedQuote && !isCreating) {
      handleSelectQuote(filteredQuotes[0]);
    }
  }, [filteredQuotes, selectedQuote, isCreating]);

  // No tab changes, form reset handled elsewhere

  // Helper functions
  const getBranchName = (branchCode: string) => {
    return branches.find((b) => b.branch_code === branchCode)?.branch_name || branchCode;
  };

  const getCustomerName = (customerId: number) => {
    return customers?.find((c) => c.id === customerId)?.customer_name || `Customer #${customerId}`;
  };

  // Calculate line items total
  const calculateLineItemsTotal = () => {
    return lineItems.reduce((sum, item) => {
      const baseTotal = item.quantity * item.selling_price;
      const discount = baseTotal * (item.discount_percent / 100);
      return sum + (baseTotal - discount);
    }, 0);
  };

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: SalesQuoteCreate) => quotationApi.create(data),
    onSuccess: (newQuote) => {
      queryClient.invalidateQueries({ queryKey: ["sales-quotes", pageQuoteType] });
      handleSelectQuote(newQuote);
      setIsCreating(false);
      setLineItems([]);
      showSuccessToast(`${QUOTE_TYPE_LABELS[newQuote.quote_type]} created successfully`);
    },
    onError: (error: Error) => {
      showErrorToast(handleApiError(error, "Failed to create quote"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<SalesQuoteCreate> }) =>
      quotationApi.update(id, data),
    onSuccess: (updatedQuote) => {
      queryClient.invalidateQueries({ queryKey: ["sales-quotes", pageQuoteType] });
      handleSelectQuote(updatedQuote);
      setIsEditing(false);
      setLineItems([]);
      showSuccessToast("Quote updated successfully");
    },
    onError: (error: Error) => {
      showErrorToast(handleApiError(error, "Failed to update quote"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => quotationApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-quotes", pageQuoteType] });
      showSuccessToast("Quote deleted successfully");
      baseHandleCancel(filteredQuotes);
    },
    onError: (error: Error) => {
      showErrorToast(handleApiError(error, "Failed to delete quote"));
    },
  });

  // ==================== Workflow Mutations ====================

  const submitToCustomerMutation = useMutation({
    mutationFn: (id: number) => quotationApi.submitToCustomer(id),
    onSuccess: (updatedQuote) => {
      queryClient.invalidateQueries({ queryKey: ["sales-quotes", pageQuoteType] });
      queryClient.invalidateQueries({ queryKey: ["sales-quote-details"] });
      handleSelectQuote(updatedQuote);
      showSuccessToast("Quotation submitted to customer");
    },
    onError: (error: Error) => showErrorToast(handleApiError(error, "Failed to submit")),
  });

  const toggleProformaMutation = useMutation({
    mutationFn: ({ id, is_proforma }: { id: number; is_proforma: boolean }) =>
      quotationApi.toggleProforma(id, { is_proforma }),
    onSuccess: () => {
      // Invalidate both lists since toggling moves the item between lists
      queryClient.invalidateQueries({ queryKey: ["sales-quotes"] });
      queryClient.invalidateQueries({ queryKey: ["sales-quote-details"] });
      showSuccessToast("Quote type updated");
    },
    onError: (error: Error) => showErrorToast(handleApiError(error, "Failed to update type")),
  });

  const markUnderReviewMutation = useMutation({
    mutationFn: (id: number) => quotationApi.markUnderReview(id),
    onSuccess: (updatedQuote) => {
      queryClient.invalidateQueries({ queryKey: ["sales-quotes", pageQuoteType] });
      queryClient.invalidateQueries({ queryKey: ["sales-quote-details"] });
      handleSelectQuote(updatedQuote);
      showSuccessToast("Quote marked as under review");
    },
    onError: (error: Error) => showErrorToast(handleApiError(error, "Failed to update status")),
  });

  const customerApproveMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { approved_by_customer?: string; remarks?: string } }) =>
      quotationApi.customerApprove(id, data),
    onSuccess: (updatedQuote) => {
      queryClient.invalidateQueries({ queryKey: ["sales-quotes", pageQuoteType] });
      queryClient.invalidateQueries({ queryKey: ["sales-quote-details"] });
      handleSelectQuote(updatedQuote);
      setCustomerApproveDialogOpen(false);
      setCustomerApprovalName("");
      setCustomerApprovalRemarks("");
      showSuccessToast("Customer approval recorded");
    },
    onError: (error: Error) => showErrorToast(handleApiError(error, "Failed to record approval")),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { reason?: string; cancel_linked_po?: boolean } }) =>
      quotationApi.rejectWithOptions(id, data),
    onSuccess: (updatedQuote) => {
      queryClient.invalidateQueries({ queryKey: ["sales-quotes", pageQuoteType] });
      queryClient.invalidateQueries({ queryKey: ["sales-quote-details"] });
      handleSelectQuote(updatedQuote);
      setRejectDialogOpen(false);
      setRejectReason("");
      setCancelLinkedPO(false);
      showSuccessToast("Quote rejected");
    },
    onError: (error: Error) => showErrorToast(handleApiError(error, "Failed to reject")),
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      quotationApi.cancel(id, reason),
    onSuccess: (updatedQuote) => {
      queryClient.invalidateQueries({ queryKey: ["sales-quotes", pageQuoteType] });
      queryClient.invalidateQueries({ queryKey: ["sales-quote-details"] });
      handleSelectQuote(updatedQuote);
      showSuccessToast("Quote cancelled");
    },
    onError: (error: Error) => showErrorToast(handleApiError(error, "Failed to cancel")),
  });

  const createPOMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: typeof poFormData & { purchasing_invoice_no: string; first_suppliers_id: number; second_suppliers_id: number; good_received_note_date: string } }) =>
      quotationApi.createPOFromQuote(id, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["sales-quotes", pageQuoteType] });
      queryClient.invalidateQueries({ queryKey: ["sales-quote-details"] });
      setCreatePODialogOpen(false);
      showSuccessToast(result.message);
    },
    onError: (error: Error) => showErrorToast(handleApiError(error, "Failed to create PO")),
  });

  const convertToInvoiceMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: typeof invoiceFormData & { payment_method: string } }) =>
      quotationApi.convertToInvoice(id, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["sales-quotes", pageQuoteType] });
      queryClient.invalidateQueries({ queryKey: ["sales-quote-details"] });
      setConvertInvoiceDialogOpen(false);
      showSuccessToast(result.message);
    },
    onError: (error: Error) => showErrorToast(handleApiError(error, "Failed to convert to invoice")),
  });

  // ==================== Workflow Handlers ====================

  const handleCheckStock = useCallback(async () => {
    if (!selectedQuote) return;
    setStockCheckLoading(true);
    setStockCheckDialogOpen(true);
    try {
      const result = await quotationApi.checkStockAvailability(selectedQuote.id);
      setStockAvailability(result.items);
      setStockAllSufficient(result.all_sufficient);
      queryClient.invalidateQueries({ queryKey: ["sales-quote-details", selectedQuote.id] });
    } catch (error) {
      showErrorToast(handleApiError(error as Error, "Failed to check stock"));
    } finally {
      setStockCheckLoading(false);
    }
  }, [selectedQuote, queryClient]);

  const handleSubmitToCustomer = useCallback(async () => {
    if (!selectedQuote) return;
    const confirmed = await confirmDialog.confirm({
      title: "Submit to Customer",
      message: `Submit ${selectedQuote.quote_no} to the customer? A quotation document will be generated for customer review.`,
      confirmText: "Submit",
      confirmColor: "primary",
    });
    if (confirmed) {
      submitToCustomerMutation.mutate(selectedQuote.id);
    }
  }, [selectedQuote, confirmDialog, submitToCustomerMutation]);

  const handleToggleProforma = useCallback(async () => {
    if (!selectedQuote) return;
    const newIsProforma = selectedQuote.quote_type !== "proforma";
    const label = newIsProforma ? "Proforma Invoice" : "Quotation";
    const confirmed = await confirmDialog.confirm({
      title: `Mark as ${label}`,
      message: `Change ${selectedQuote.quote_no} to display as a ${label}?`,
      confirmText: `Mark as ${label}`,
      confirmColor: "primary",
    });
    if (confirmed) {
      toggleProformaMutation.mutate({ id: selectedQuote.id, is_proforma: newIsProforma });
    }
  }, [selectedQuote, confirmDialog, toggleProformaMutation]);

  const handleMarkUnderReview = useCallback(async () => {
    if (!selectedQuote) return;
    markUnderReviewMutation.mutate(selectedQuote.id);
  }, [selectedQuote, markUnderReviewMutation]);

  const handleCancel = useCallback(async () => {
    if (!selectedQuote) return;
    const confirmed = await confirmDialog.confirm({
      title: "Cancel Quotation",
      message: `Are you sure you want to cancel ${selectedQuote.quote_no}? This action cannot be undone.`,
      confirmText: "Cancel Quote",
      confirmColor: "error",
    });
    if (confirmed) {
      cancelMutation.mutate({ id: selectedQuote.id });
    }
  }, [selectedQuote, confirmDialog, cancelMutation]);

  const handleCreatePOSubmit = useCallback(() => {
    if (!selectedQuote) return;
    createPOMutation.mutate({
      id: selectedQuote.id,
      data: {
        ...poFormData,
        purchasing_invoice_no: poFormData.purchasing_invoice_no || `PI-${selectedQuote.quote_no}`,
      },
    });
  }, [selectedQuote, poFormData, createPOMutation]);

  const handleConvertToInvoiceSubmit = useCallback(() => {
    if (!selectedQuote) return;
    convertToInvoiceMutation.mutate({
      id: selectedQuote.id,
      data: invoiceFormData,
    });
  }, [selectedQuote, invoiceFormData, convertToInvoiceMutation]);

  const handleRejectSubmit = useCallback(() => {
    if (!selectedQuote) return;
    rejectMutation.mutate({
      id: selectedQuote.id,
      data: { reason: rejectReason || undefined, cancel_linked_po: cancelLinkedPO },
    });
  }, [selectedQuote, rejectReason, cancelLinkedPO, rejectMutation]);

  const handleCustomerApproveSubmit = useCallback(() => {
    if (!selectedQuote) return;
    customerApproveMutation.mutate({
      id: selectedQuote.id,
      data: {
        approved_by_customer: customerApprovalName || undefined,
        remarks: customerApprovalRemarks || undefined,
      },
    });
  }, [selectedQuote, customerApprovalName, customerApprovalRemarks, customerApproveMutation]);

  // Determine which workflow actions are available based on current status
  const getAvailableActions = useCallback(() => {
    if (!selectedQuote || isCreating || isEditing) return [];
    const s = selectedQuote.status;
    const actions: string[] = [];

    // Submit to customer
    if (['draft', 'pending_approval', 'approved'].includes(s)) actions.push('submit_to_customer');
    // Mark as proforma (toggle)
    if (!['converted', 'converted_to_invoice', 'cancelled'].includes(s)) actions.push('toggle_proforma');
    // Check stock
    if (!['cancelled', 'converted', 'converted_to_invoice'].includes(s)) actions.push('check_stock');
    // Mark under review
    if (s === 'submitted') actions.push('under_review');
    // Customer approve
    if (['submitted', 'under_review', 'sent', 'po_created'].includes(s)) actions.push('customer_approve');
    // Create PO
    if (['approved', 'accepted', 'submitted', 'under_review'].includes(s)) actions.push('create_po');
    // Convert to invoice
    if (['approved', 'accepted', 'po_created'].includes(s)) actions.push('convert_to_invoice');
    // Reject
    if (!['converted', 'converted_to_invoice', 'cancelled', 'revised', 'rejected'].includes(s)) actions.push('reject');
    // Cancel
    if (!['converted', 'converted_to_invoice', 'cancelled', 'revised'].includes(s)) actions.push('cancel');

    return actions;
  }, [selectedQuote, isCreating, isEditing]);


  // Handlers
  const handleCreateNew = useCallback(() => {
    setFormData(getEmptyQuoteForm(pageQuoteType));
    setLineItems([]);
    setFormStep(0);
    handleNewQuote();
  }, [handleNewQuote, setFormData, pageQuoteType]);

  const handleDiscardChanges = useCallback(async () => {
    if ((isEditing || isCreating) && hasChanges) {
      const confirmed = await confirmDialog.confirm({
        title: "Unsaved Changes",
        message: "You have unsaved changes. Are you sure you want to discard them?",
        confirmText: "Discard",
        confirmColor: "error",
      });
      if (!confirmed) return;
    }

    baseHandleCancel(filteredQuotes);
    setLineItems([]);
    setFormStep(0);
  }, [baseHandleCancel, filteredQuotes, isEditing, isCreating, hasChanges, confirmDialog]);

  // Step navigation handlers
  const handleNextStep = useCallback(() => {
    if (formStep < FORM_STEPS.length - 1) {
      setFormStep(prev => prev + 1);
    }
  }, [formStep]);

  const handlePreviousStep = useCallback(() => {
    if (formStep > 0) {
      setFormStep(prev => prev - 1);
    }
  }, [formStep]);

  const handleEdit = useCallback(() => {
    if (selectedQuote) {
      setFormData({
        quote_type: selectedQuote.quote_type,
        branch_code: selectedQuote.branch_code,
        customer_id: selectedQuote.customer_id,
        sale_rep_id: selectedQuote.sale_rep_id,
        valid_until: selectedQuote.valid_until,
        is_estimate: selectedQuote.is_estimate,
        remarks: selectedQuote.remarks || "",
        customer_notes: selectedQuote.customer_notes || "",
        special: selectedQuote.special,
      });
      handleStartEdit();
    }
  }, [selectedQuote, setFormData, handleStartEdit]);

  const handleSave = useCallback(() => {
    if (!formData.customer_id || formData.customer_id === 0) {
      showErrorToast("Please select a customer");
      return;
    }

    if (!formData.sale_rep_id || formData.sale_rep_id === 0) {
      showErrorToast("Please select a sales representative");
      return;
    }

    if (lineItems.length === 0) {
      showErrorToast("Please add at least one item");
      return;
    }

    // Validate minimum prices
    const invalidItems = lineItems.filter(item =>
      item.minimum_selling_price > 0 && item.selling_price < item.minimum_selling_price
    );

    if (invalidItems.length > 0) {
      const product = products?.find(p => p.id === invalidItems[0].product_id);
      showErrorToast(`Price for ${product?.name || 'item'} cannot be less than minimum price (${invalidItems[0].minimum_selling_price})`);
      return;
    }

    const items: SalesQuoteItemCreate[] = lineItems.map((item) => ({
      product_id: item.product_id,
      quantity: item.quantity,
      selling_price: item.selling_price,
      minimum_selling_price: item.minimum_selling_price,
      warrenty_month: item.warrenty_month,
      is_price_estimate: item.is_price_estimate,
      description: item.description,
      discount_percent: item.discount_percent || 0,
    }));

    if (isCreating) {
      createMutation.mutate({
        ...formData,
        items,
      } as SalesQuoteCreate);
    } else if (isEditing && selectedQuote) {
      updateMutation.mutate({
        id: selectedQuote.id,
        data: { ...formData, items },
      });
    }
  }, [formData, lineItems, isCreating, isEditing, selectedQuote, createMutation, updateMutation]);

  const handleDelete = useCallback(async () => {
    if (selectedQuote) {
      const confirmed = await confirmDialog.confirm({
        title: "Delete Quote",
        message: `Are you sure you want to delete ${selectedQuote.quote_no}?`,
        confirmText: "Delete",
        confirmColor: "error",
      });
      if (confirmed) {
        deleteMutation.mutate(selectedQuote.id);
      }
    }
  }, [selectedQuote, deleteMutation, confirmDialog]);


  // Add line item
  const handleAddLineItem = () => {
    setLineItems([
      ...lineItems,
      {
        product_id: 0,
        quantity: 1,
        selling_price: 0,
        minimum_selling_price: 0,
        warrenty_month: "12",
        is_price_estimate: formData.quote_type === "quotation",
        discount_percent: 0,
        tax_rate: 0,
      },
    ]);
  };

  // Update line item
  const handleUpdateLineItem = async (index: number, field: keyof ItemFormData, value: unknown) => {
    // For non-product fields, update immediately
    if (field !== "product_id") {
      setLineItems(prev => {
        const updated = [...prev];
        updated[index] = { ...updated[index], [field]: value } as ItemFormData;

        return updated;
      });
      return;
    }

    // For product selection, fetch minimum price from MinimumPrice table
    if (field === "product_id" && value) {
      const product = products?.find((p) => p.id === value);
      if (product) {
        // First update with product selected
        setLineItems(prev => {
          const updated = [...prev];
          updated[index] = { ...updated[index], product_id: value as number } as ItemFormData;
          return updated;
        });

        try {
          // Fetch the current minimum price from the MinimumPrice table
          const minPriceData = await minimumPriceApi.getCurrent(product.id);
          const minSellingPrice = minPriceData?.minimum_price || 0;

          // Update with the fetched minimum price
          setLineItems(prev => {
            const updated = [...prev];
            updated[index].min_price = minSellingPrice;
            updated[index].minimum_selling_price = minSellingPrice;
            updated[index].selling_price = minSellingPrice;
            return updated;
          });
        } catch (error) {
          // If no minimum price set in the MinimumPrice table, set to 0
          setLineItems(prev => {
            const updated = [...prev];
            updated[index].min_price = 0;
            updated[index].minimum_selling_price = 0;
            updated[index].selling_price = 0;
            return updated;
          });
          showErrorToast("No minimum price set for this product. Please set a minimum price first.");
        }
      }
    }
  };

  // Remove line item
  const handleRemoveLineItem = (index: number) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  // Check if actions are allowed based on status
  const canEditQuote = !["converted", "cancelled"].includes(selectedQuote?.status || "");
  const canDeleteQuoteStatus = !["converted", "cancelled"].includes(selectedQuote?.status || "");

  // Render list item
  const renderQuoteItem = (quote: SalesQuote, isSelected: boolean) => (
    <SelectableListItem
      key={quote.id}
      id={quote.id}
      isSelected={isSelected}
      onClick={() => handleSelectQuote(quote)}
      primaryText={
        <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
          {/* Quote Number */}
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{quote.quote_no}</span>
            {isSelected && (
              <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                ({QUOTE_TYPE_LABELS[quote.quote_type]})
              </Typography>
            )}
          </Box>
          {/* Additional fields when selected */}
          {isSelected && (
            <>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Typography component="span" variant="caption">
                  {getCustomerName(quote.customer_id)}
                </Typography>
                <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                  (Customer)
                </Typography>
              </Box>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Typography component="span" variant="caption">
                  <TDate value={quote.valid_until} format="short" />
                </Typography>
                <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                  (Valid Until)
                </Typography>
              </Box>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Typography component="span" variant="caption" fontWeight="medium">
                  <TCurrency value={quote.total_amount} />
                </Typography>
                <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                  (Total)
                </Typography>
              </Box>
              {/* Status Chips - shown below all fields when selected */}
              <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                <TStatusChip
                  status={quote.status}
                  statusMap="quoteStatus"
                  size="small"
                />
              </Box>
            </>
          )}
        </Box>
      }
      secondaryText={!isSelected ? `${getCustomerName(quote.customer_id)} - ${new Date(quote.valid_until || "").toLocaleDateString()}` : undefined}
      statusChip={!isSelected ? { label: quote.status, color: "default" } : undefined}
      isFavorite={favorites.includes(quote.id)}
      onToggleFavorite={(e) => toggleFavorite(quote.id, e)}
      endAction={
        !isSelected ? (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 0.5 }}>
            <Typography variant="body2" fontWeight="medium">
              <TCurrency value={quote.total_amount} />
            </Typography>
            {quote.valid_until && (() => {
              const daysLeft = Math.ceil((new Date(quote.valid_until).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
              return daysLeft <= 7 && daysLeft >= 0 ? (
                <Chip label={daysLeft === 0 ? "Expires Today" : `${daysLeft}d left`} size="small" color="warning" sx={{ height: 16, fontSize: "0.6rem" }} />
              ) : null;
            })()}
          </Box>
        ) : undefined
      }
    />
  );

  // Render detail panel
  const renderDetailPanel = () => {
    return (
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <DetailPanelHeader
          icon={<QuoteIcon color="primary" />}
          breadcrumbs={[
            { label: 'Sales', href: '/sales' },
            { label: pageTitle }
          ]}
          title={
            isCreating
              ? "Create New Quote"
              : isEditing && selectedQuote
                ? `Edit ${selectedQuote.quote_no}`
                : selectedQuote
                  ? selectedQuote.quote_no
                  : "Select a Quote"
          }
          chips={
            selectedQuote && !isCreating && !isEditing
              ? [
                {
                  label: selectedQuote.status.toUpperCase(),
                  color: selectedQuote.status === 'draft' ? 'default' : selectedQuote.status === 'approved' ? 'success' : 'info'
                }
              ]
              : undefined
          }
        />

        <ActionToolbar
          canCreate={canCreate}
          canDelete={canDelete && canDeleteQuoteStatus}
          canUpdate={canUpdate && canEditQuote}
          isEditing={isEditing}
          isCreating={isCreating}
          hasSelection={!!selectedQuote}
          onAdd={handleCreateNew}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onSave={handleSave}
          onCancel={handleDiscardChanges}
          isSaving={createMutation.isPending || updateMutation.isPending}
          saveDisabled={!formData.customer_id || lineItems.length === 0}
          endActions={
            selectedQuote && !isCreating && !isEditing ? (
              <Box sx={{ display: "flex", gap: 0.5, alignItems: "center", flexWrap: "wrap" }}>
                {/* Workflow Action Buttons */}
                {getAvailableActions().includes('submit_to_customer') && (
                  <Tooltip title="Submit to Customer">
                    <Button size="small" variant="outlined" color="primary" startIcon={<SendIcon />}
                      onClick={handleSubmitToCustomer} disabled={submitToCustomerMutation.isPending}>
                      Submit
                    </Button>
                  </Tooltip>
                )}
                {getAvailableActions().includes('toggle_proforma') && (
                  <Tooltip title={selectedQuote.quote_type === 'proforma' ? 'Mark as Quotation' : 'Mark as Proforma Invoice'}>
                    <Button size="small" variant="outlined" color="secondary" startIcon={<ProformaIcon />}
                      onClick={handleToggleProforma} disabled={toggleProformaMutation.isPending}>
                      {selectedQuote.quote_type === 'proforma' ? 'To Quote' : 'To Proforma'}
                    </Button>
                  </Tooltip>
                )}
                {getAvailableActions().includes('check_stock') && (
                  <Tooltip title="Check Stock Availability">
                    <Button size="small" variant="outlined" color="info" startIcon={<StockIcon />}
                      onClick={handleCheckStock}>
                      Stock
                    </Button>
                  </Tooltip>
                )}
                {getAvailableActions().includes('under_review') && (
                  <Tooltip title="Mark as Under Review">
                    <Button size="small" variant="outlined" startIcon={<ReviewIcon />}
                      onClick={handleMarkUnderReview} disabled={markUnderReviewMutation.isPending}>
                      Under Review
                    </Button>
                  </Tooltip>
                )}
                {getAvailableActions().includes('customer_approve') && (
                  <Tooltip title="Record Customer Approval">
                    <Button size="small" variant="contained" color="success" startIcon={<ApproveIcon />}
                      onClick={() => setCustomerApproveDialogOpen(true)}>
                      Approve
                    </Button>
                  </Tooltip>
                )}
                {getAvailableActions().includes('create_po') && (
                  <Tooltip title="Create Purchase Order">
                    <Button size="small" variant="outlined" color="warning" startIcon={<POIcon />}
                      onClick={() => { setPOFormData({ ...poFormData, remarks: `PO for ${selectedQuote.quote_no}` }); setCreatePODialogOpen(true); }}>
                      Create PO
                    </Button>
                  </Tooltip>
                )}
                {getAvailableActions().includes('convert_to_invoice') && (
                  <Tooltip title="Convert to Invoice">
                    <Button size="small" variant="contained" color="primary" startIcon={<InvoiceIcon />}
                      onClick={() => setConvertInvoiceDialogOpen(true)}>
                      To Invoice
                    </Button>
                  </Tooltip>
                )}
                {getAvailableActions().includes('reject') && (
                  <Tooltip title="Reject Quotation">
                    <Button size="small" variant="outlined" color="error" startIcon={<RejectIcon />}
                      onClick={() => setRejectDialogOpen(true)}>
                      Reject
                    </Button>
                  </Tooltip>
                )}
                {getAvailableActions().includes('cancel') && (
                  <Tooltip title="Cancel Quotation">
                    <Button size="small" variant="outlined" color="error" startIcon={<CancelIcon />}
                      onClick={handleCancel}>
                      Cancel
                    </Button>
                  </Tooltip>
                )}
                <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                <TPrintButton
                  documentType="quotation"
                  documentId={selectedQuote.id}
                  disabled={!canPrintDocument(selectedQuote.status, [])}
                  disabledReason="Cannot print this quote"
                  onClick={() => {
                    setSelectedQuoteForPrint(selectedQuote);
                    setPrintDialogOpen(true);
                  }}
                />
              </Box>
            ) : undefined
          }
        />

        <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
          {!selectedQuote && !isCreating ? (
            <EmptyState
              icon={<QuoteIcon sx={{ fontSize: 48 }} />}
              message="Select a quote from the list or create a new one"
            />
          ) : isCreating || isEditing ? (
            renderFormContent()
          ) : (
            renderViewContent()
          )}
        </Box>
      </Box>
    );
  };

  // Render view content (without header/toolbar)
  const renderViewContent = () => {
    if (!selectedQuote) return null;
    const quote = selectedQuote;

    // Calculate totals from items
    const calculateTotal = () => {
      if (!selectedQuoteDetails?.items) return quote.total_amount;
      return selectedQuoteDetails.items.reduce((sum, item) => {
        const baseTotal = item.quantity * Number(item.selling_price);
        const discount = baseTotal * ((item.discount_percentage || 0) / 100);
        return sum + (baseTotal - discount);
      }, 0);
    };

    return (
      <>
        {/* Quote Information */}
        <FormSection title="Quote Information" columns={3}>
          <TextField
            label="Quote Number"
            size="small"
            value={quote.quote_no}
            disabled
            InputProps={{ readOnly: true }}
          />
          <TextField
            label="Quote Type"
            size="small"
            value={QUOTE_TYPE_LABELS[quote.quote_type]}
            disabled
            InputProps={{ readOnly: true }}
          />
          <TextField
            label="Branch"
            size="small"
            value={getBranchName(quote.branch_code)}
            disabled
            InputProps={{ readOnly: true }}
          />
          <TextField
            label="Customer"
            size="small"
            value={getCustomerName(quote.customer_id)}
            disabled
            InputProps={{ readOnly: true }}
          />
          <TextField
            label="Created Date"
            size="small"
            value={new Date(quote.created_date).toLocaleDateString()}
            disabled
            InputProps={{ readOnly: true }}
          />
          <TextField
            label="Valid Until"
            size="small"
            value={new Date(quote.valid_until).toLocaleDateString()}
            disabled
            InputProps={{ readOnly: true }}
          />
        </FormSection>

        {/* Quote Status */}
        <FormSection title="Quote Status" columns={4}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="body2" color="text.secondary">Status:</Typography>
            <TStatusChip status={quote.status} statusMap="quoteStatus" />
          </Box>
          {quote.quote_type === 'proforma' && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Chip label="Proforma Invoice" color="secondary" size="small" variant="outlined" />
            </Box>
          )}
        </FormSection>

        {/* Workflow Timeline */}
        {(quote.submitted_date || quote.approved_date || quote.po_created_date || quote.conversion_date || quote.rejection_date) && (
          <FormSection title="Workflow Timeline" columns={3}>
            {quote.submitted_date && (
              <TextField label="Submitted" size="small" value={new Date(quote.submitted_date).toLocaleString()} disabled InputProps={{ readOnly: true }} />
            )}
            {quote.approved_date && (
              <TextField label="Approved" size="small" value={new Date(quote.approved_date).toLocaleString()} disabled InputProps={{ readOnly: true }} />
            )}
            {quote.approved_by_customer && (
              <TextField label="Approved By" size="small" value={quote.approved_by_customer} disabled InputProps={{ readOnly: true }} />
            )}
            {quote.po_created_date && (
              <TextField label="PO Created" size="small" value={new Date(quote.po_created_date).toLocaleString()} disabled InputProps={{ readOnly: true }} />
            )}
            {quote.linked_po_id && (
              <TextField label="Linked PO" size="small" value={`PO #${quote.linked_po_id}`} disabled InputProps={{ readOnly: true }} />
            )}
            {quote.conversion_date && (
              <TextField label="Converted" size="small" value={new Date(quote.conversion_date).toLocaleString()} disabled InputProps={{ readOnly: true }} />
            )}
            {quote.rejection_date && (
              <TextField label="Rejected" size="small" value={new Date(quote.rejection_date).toLocaleString()} disabled InputProps={{ readOnly: true }} />
            )}
            {quote.rejection_reason && (
              <TextField label="Rejection Reason" size="small" value={quote.rejection_reason} disabled InputProps={{ readOnly: true }} />
            )}
          </FormSection>
        )}

        {/* Line Items */}
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1, mt: 2 }}>
          <Typography variant="subtitle1" fontWeight="bold">Quote Items</Typography>
        </Box>

        <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={modernTableStyles.headerRow}>
                <TableCell sx={{ minWidth: 200 }}>Product</TableCell>
                <TableCell align="right" sx={{ width: 100 }}>Quantity</TableCell>
                <TableCell align="right" sx={{ width: 120 }}>Unit Price (Rs.)</TableCell>
                <TableCell align="right" sx={{ width: 100 }}>Discount (%)</TableCell>
                <TableCell sx={{ width: 100 }}>Warranty</TableCell>
                <TableCell align="center" sx={{ width: 120 }}>Stock</TableCell>
                <TableCell align="right" sx={{ width: 120 }}>Amount (Rs.)</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {selectedQuoteDetails?.items && selectedQuoteDetails.items.length > 0 ? (
                selectedQuoteDetails.items.map((item, index) => {
                  const product = products?.find(p => p.id === item.product_id);
                  const baseTotal = item.quantity * Number(item.selling_price);
                  const discount = baseTotal * ((item.discount_percentage || 0) / 100);
                  const lineTotal = baseTotal - discount;
                  return (
                    <TableRow key={index} sx={{
                      ...modernTableStyles.bodyRow,
                      ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                    }}>
                      <TableCell>{product?.name || `Product #${item.product_id}`}</TableCell>
                      <TableCell align="right">{item.quantity}</TableCell>
                      <TableCell align="right"><TCurrency value={Number(item.selling_price)} /></TableCell>
                      <TableCell align="right">{item.discount_percentage ? `${item.discount_percentage}%` : "-"}</TableCell>
                      <TableCell>{item.warrenty_month || "-"}</TableCell>
                      <TableCell align="center">
                        {item.stock_status === 'in_stock' ? (
                          <Chip label="In Stock" color="success" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                        ) : item.stock_status === 'needs_procurement' ? (
                          <Chip label="Needs PO" color="warning" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                        ) : (
                          <Typography variant="caption" color="text.secondary">-</Typography>
                        )}
                      </TableCell>
                      <TableCell align="right"><TCurrency value={lineTotal} /></TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={7} sx={modernTableStyles.emptyCell}>
                    No items in this quote
                  </TableCell>
                </TableRow>
              )}
              {/* Total Row */}
              <TableRow sx={modernTableStyles.footerRow}>
                <TableCell colSpan={6} align="right">
                  <Typography fontWeight="bold">Total:</Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography fontWeight="bold"><TCurrency value={calculateTotal()} /></Typography>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Paper>

        {/* Print Preview Dialog */}
        {selectedQuoteForPrint && (
          <TPrintPreviewDialog
            open={printDialogOpen}
            onClose={() => {
              setPrintDialogOpen(false);
              setSelectedQuoteForPrint(null);
            }}
            documentType="quotation"
            documentId={selectedQuoteForPrint.id}
            title={`Print Quote: ${selectedQuoteForPrint.quote_no}`}
          />
        )}


        {
          quote.remarks && (
            <>
              <Divider sx={{ my: 2 }} />
              <FormSection title="Remarks">
                <Typography>{quote.remarks}</Typography>
              </FormSection>
            </>
          )
        }

        {
          quote.converted_to_invoice_id && (
            <>
              <Divider sx={{ my: 2 }} />
              <FormSection title="Conversion">
                <Chip
                  label={`Converted to Invoice #${quote.converted_to_invoice_id}`}
                  color="success"
                  variant="outlined"
                />
              </FormSection>
            </>
          )
        }
      </>
    );
  };

  // Render form content (without header/toolbar)
  const renderFormContent = () => {
    // Step 1 validation: Basic info is filled
    const isStep1Valid = formData.customer_id && formData.customer_id > 0 && formData.branch_code && formData.sale_rep_id && formData.sale_rep_id > 0;

    return (
      <>
        {/* Stepper - shown in create/edit mode */}
        <TSteps
          steps={FORM_STEPS.map((label, i) => ({ id: `step-${i}`, label }))}
          activeStep={formStep}
          sx={{ mb: 3 }}
        />

        {/* Step 1: Quote Information */}
        {formStep === 0 && (
          <>
            {/* Basic Info */}
            <FormSection title="Basic Information" columns={3}>
              <Autocomplete
                size="small"
                options={branches}
                getOptionLabel={(option) => `${option.branch_code} - ${option.branch_name}`}
                value={branches.find((b) => b.branch_code === formData.branch_code) || undefined}
                onChange={(_, newValue) => setFormData({ ...formData, branch_code: newValue?.branch_code || "" })}
                renderInput={(params) => (
                  <TextField {...params} label="Branch" required />
                )}
                disableClearable
              />

              <Autocomplete
                size="small"
                options={customers || []}
                getOptionLabel={(option) => option.customer_name}
                value={customers?.find((c) => c.id === formData.customer_id) || null}
                onChange={(_, newValue) => setFormData({ ...formData, customer_id: newValue?.id || 0 })}
                renderInput={(params) => (
                  <TextField {...params} label="Customer" required />
                )}
              />

              <TextField
                select
                label="Type"
                value={formData.quote_type || pageQuoteType}
                onChange={(e) => setFormData({ ...formData, quote_type: e.target.value as QuoteType })}
                size="small"
                required
                disabled
                InputProps={{ readOnly: true }}
              >
                <MenuItem value="quotation">Quotation</MenuItem>
                <MenuItem value="proforma">Proforma Invoice</MenuItem>
              </TextField>

              <TextField
                label="Valid Until"
                type="date"
                value={formData.valid_until || ""}
                onChange={(e) => setFormData({ ...formData, valid_until: e.target.value })}
                size="small"
                InputLabelProps={{ shrink: true }}
                required
              />

              <Autocomplete
                size="small"
                options={employees || []}
                getOptionLabel={(option) => option.full_name || option.employee_id}
                value={employees?.find((e) => e.id === formData.sale_rep_id) || null}
                onChange={(_, newValue) => setFormData({ ...formData, sale_rep_id: newValue?.id || 0 })}
                renderInput={(params) => (
                  <TextField {...params} label="Sales Representative" required />
                )}
              />
            </FormSection>

            {/* Notes */}
            <FormSection title="Notes" columns={2}>
              <TextField
                label="Internal Remarks"
                value={formData.remarks || ""}
                onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                multiline
                rows={2}
                size="small"
              />
              <TextField
                label="Customer Notes (shown on printed document)"
                value={formData.customer_notes || ""}
                onChange={(e) => setFormData({ ...formData, customer_notes: e.target.value })}
                multiline
                rows={2}
                size="small"
              />
            </FormSection>
          </>
        )}

        {/* Step 2: Quote Items */}
        {formStep === 1 && (
          <>
            {/* Line Items */}
            <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
                <Typography variant="subtitle2" fontWeight={600}>Line Items</Typography>
                <Button size="small" startIcon={<AddIcon />} onClick={handleAddLineItem}>
                  Add Item
                </Button>
              </Box>
              {lineItems.length === 0 ? (
                <Typography color="text.secondary" align="center" sx={{ py: 2 }}>
                  No items added. Click "Add Item" to add products.
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Product</TableCell>
                      <TableCell align="right">Qty</TableCell>
                      <TableCell align="right">Price (Rs.)</TableCell>
                      <TableCell align="right">Discount (%)</TableCell>
                      {formData.quote_type === "quotation" && (
                        <>
                          <TableCell align="right">Min Price (Rs.)</TableCell>
                        </>
                      )}
                      <TableCell align="right">Total (Rs.)</TableCell>
                      <TableCell align="center">Action</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {lineItems.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <Autocomplete
                            options={products || []}
                            getOptionLabel={(option) => option.name}
                            value={products?.find((p) => p.id === item.product_id) || null}
                            onChange={(_, newValue) =>
                              handleUpdateLineItem(index, "product_id", newValue?.id || 0)
                            }
                            renderInput={(params) => (
                              <TextField {...params} size="small" placeholder="Select product" />
                            )}
                            sx={{ minWidth: 200 }}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <TextField
                            type="number"
                            value={item.quantity}
                            onChange={(e) =>
                              handleUpdateLineItem(index, "quantity", parseInt(e.target.value) || 1)
                            }
                            size="small"
                            sx={{ width: 80 }}
                            inputProps={{ min: 1 }}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <TextField
                            type="number"
                            value={item.selling_price}
                            onChange={(e) =>
                              handleUpdateLineItem(index, "selling_price", parseFloat(e.target.value) || 0)
                            }
                            size="small"
                            sx={{ width: 100 }}
                            InputProps={{
                              startAdornment: <InputAdornment position="start">Rs.</InputAdornment>,
                            }}
                            inputProps={{ min: item.min_price || 0 }}
                            error={item.selling_price < (item.min_price || 0)}
                            helperText={item.selling_price < (item.min_price || 0) ? "Cannot be less than min price" : ""}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <TextField
                            type="number"
                            value={item.discount_percent}
                            onChange={(e) =>
                              handleUpdateLineItem(index, "discount_percent", parseFloat(e.target.value) || 0)
                            }
                            size="small"
                            sx={{ width: 80 }}
                            inputProps={{ min: 0, max: 100 }}
                          />
                        </TableCell>
                        {formData.quote_type === "quotation" && (
                          <>
                            <TableCell align="right">
                              <TextField
                                type="number"
                                value={item.min_price || ""}
                                size="small"
                                sx={{ width: 100 }}
                                placeholder="Min"
                                disabled
                                InputProps={{
                                  readOnly: true,
                                  startAdornment: <InputAdornment position="start">Rs.</InputAdornment>,
                                }}
                              />
                            </TableCell>
                          </>
                        )}
                        <TableCell align="right">
                          <Typography fontWeight="medium">
                            <TCurrency
                              value={
                                item.quantity * item.selling_price * (1 - item.discount_percent / 100)
                              }
                              showSymbol={false}
                            />
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          <IconButton size="small" color="error" onClick={() => handleRemoveLineItem(index)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <Divider sx={{ my: 2 }} />
              <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                <Typography variant="h6" fontWeight={700} color="success.main">
                  Total: <TCurrency value={calculateLineItemsTotal()} />
                </Typography>
              </Box>
            </Paper >
          </>
        )}

        {/* Step Navigation Buttons */}
        <Box sx={{ display: "flex", justifyContent: "space-between", mt: 3, pt: 2, borderTop: 1, borderColor: "divider" }}>
          <Button
            variant="outlined"
            startIcon={<ArrowBackIcon />}
            onClick={handlePreviousStep}
            disabled={formStep === 0}
          >
            Previous
          </Button>
          {formStep < FORM_STEPS.length - 1 ? (
            <Button
              variant="contained"
              endIcon={<ArrowForwardIcon />}
              onClick={handleNextStep}
              disabled={!isStep1Valid}
            >
              Next
            </Button>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ alignSelf: "center" }}>
              Click "Save" in the toolbar to create the quote
            </Typography>
          )}
        </Box>
      </>
    );
  };

  return (
    <>
      {/* Section for Quotation or Proforma Invoice based on route */}

      <MasterDetailLayout
        title=""
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ["sales-quotes", pageQuoteType] });
          queryClient.invalidateQueries({ queryKey: ["sales-quote-details"] });
        }}
        masterPanel={
          <SearchableList
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search quotes..."
            sortOptions={SORT_OPTIONS}
            currentSort={sortField}
            onSortChange={(value) => setSortField(value as string)}
            isLoading={isLoading}
            listHeader={
              <Box>
                <SalesFilterPanel
                  branches={branches}
                  branchValue={filterBranch}
                  onBranchChange={setFilterBranch}
                />
              </Box>
            }
          >
            {filteredQuotes.length === 0 ? (
              <Box sx={{ p: 2, textAlign: 'center' }}>
                <QuoteIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
                <Typography variant="body2" color="text.secondary">
                  {searchQuery
                    ? "No results found. Try adjusting your search."
                    : "No quotes yet. Create your first one!"}
                </Typography>
              </Box>
            ) : (
              filteredQuotes.map((quote) => renderQuoteItem(quote, selectedQuote?.id === quote.id))
            )}
          </SearchableList>
        }
        detailPanel={renderDetailPanel()}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />

      {/* ==================== Stock Availability Dialog ==================== */}
      <Dialog open={stockCheckDialogOpen} onClose={() => setStockCheckDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <StockIcon color="info" />
            Stock Availability Check
          </Box>
        </DialogTitle>
        <DialogContent>
          {stockCheckLoading ? (
            <Box sx={{ py: 4 }}>
              <LinearProgress />
              <Typography align="center" sx={{ mt: 2 }}>Checking stock availability...</Typography>
            </Box>
          ) : (
            <>
              <Alert severity={stockAllSufficient ? "success" : "warning"} sx={{ mb: 2 }}>
                {stockAllSufficient
                  ? "All items are available in stock. Ready to proceed."
                  : "Some items are not available in stock and need procurement."}
              </Alert>
              <Table size="small">
                <TableHead>
                  <TableRow sx={modernTableStyles.headerRow}>
                    <TableCell>Product</TableCell>
                    <TableCell align="right">Required</TableCell>
                    <TableCell align="right">Available</TableCell>
                    <TableCell align="center">Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {stockAvailability.map((item, index) => (
                    <TableRow key={index} sx={modernTableStyles.bodyRow}>
                      <TableCell>{item.product_name || `Product #${item.product_id}`}</TableCell>
                      <TableCell align="right">{item.requested_quantity}</TableCell>
                      <TableCell align="right">{item.available_quantity}</TableCell>
                      <TableCell align="center">
                        {item.is_sufficient ? (
                          <Chip label="In Stock" color="success" size="small" />
                        ) : (
                          <Chip label="Needs Procurement" color="warning" size="small" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </DialogContent>
        <DialogActions>
          {!stockAllSufficient && !stockCheckLoading && selectedQuote && getAvailableActions().includes('create_po') && (
            <Button variant="contained" color="warning" startIcon={<POIcon />}
              onClick={() => { setStockCheckDialogOpen(false); setCreatePODialogOpen(true); }}>
              Create Purchase Order
            </Button>
          )}
          <Button onClick={() => setStockCheckDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* ==================== Create PO Dialog ==================== */}
      <Dialog open={createPODialogOpen} onClose={() => setCreatePODialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <POIcon color="warning" />
            Create Purchase Order from Quotation
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Create a PO to procure items needed to fulfill {selectedQuote?.quote_no}. Items will be copied from the quotation.
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
            <Autocomplete
              size="small"
              options={suppliers}
              getOptionLabel={(option: Supplier) => option.supplier_name || option.name || `Supplier #${option.id}`}
              value={suppliers.find((s: Supplier) => s.id === poFormData.first_suppliers_id) || null}
              onChange={(_, newValue) => setPOFormData({ ...poFormData, first_suppliers_id: (newValue as Supplier)?.id || 0 })}
              renderInput={(params) => <TextField {...params} label="Primary Supplier" required />}
            />
            <Autocomplete
              size="small"
              options={suppliers}
              getOptionLabel={(option: Supplier) => option.supplier_name || option.name || `Supplier #${option.id}`}
              value={suppliers.find((s: Supplier) => s.id === poFormData.second_suppliers_id) || null}
              onChange={(_, newValue) => setPOFormData({ ...poFormData, second_suppliers_id: (newValue as Supplier)?.id || 0 })}
              renderInput={(params) => <TextField {...params} label="Secondary Supplier" required />}
            />
            <TextField
              select label="Payment Method" size="small" required
              value={poFormData.payment_method}
              onChange={(e) => setPOFormData({ ...poFormData, payment_method: e.target.value })}
            >
              <MenuItem value="cash">Cash</MenuItem>
              <MenuItem value="credit">Credit</MenuItem>
              <MenuItem value="advance">Advance</MenuItem>
              <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
            </TextField>
            <TextField
              label="GRN Date" type="date" size="small"
              value={poFormData.good_received_note_date}
              onChange={(e) => setPOFormData({ ...poFormData, good_received_note_date: e.target.value })}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="Remarks" size="small" multiline rows={2}
              value={poFormData.remarks}
              onChange={(e) => setPOFormData({ ...poFormData, remarks: e.target.value })}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreatePODialogOpen(false)}>Cancel</Button>
          <Button variant="contained" color="warning" onClick={handleCreatePOSubmit}
            disabled={!poFormData.first_suppliers_id || !poFormData.second_suppliers_id || createPOMutation.isPending}>
            {createPOMutation.isPending ? "Creating..." : "Create PO"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ==================== Convert to Invoice Dialog ==================== */}
      <Dialog open={convertInvoiceDialogOpen} onClose={() => setConvertInvoiceDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <InvoiceIcon color="primary" />
            Convert Quotation to Invoice
          </Box>
        </DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            This will create a new invoice from {selectedQuote?.quote_no}. Stock will be reserved and the quotation will be marked as converted.
          </Alert>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
            <TextField
              select label="Payment Method" size="small" required
              value={invoiceFormData.payment_method}
              onChange={(e) => setInvoiceFormData({ ...invoiceFormData, payment_method: e.target.value })}
            >
              <MenuItem value="cash">Cash</MenuItem>
              <MenuItem value="card">Card</MenuItem>
              <MenuItem value="credit">Credit</MenuItem>
              <MenuItem value="cheque">Cheque</MenuItem>
              <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
            </TextField>
            {invoiceFormData.payment_method === 'cash' && (
              <TextField label="Cash Amount" type="number" size="small"
                value={invoiceFormData.cash_amount}
                onChange={(e) => setInvoiceFormData({ ...invoiceFormData, cash_amount: parseFloat(e.target.value) || 0 })}
                InputProps={{ startAdornment: <InputAdornment position="start">Rs.</InputAdornment> }}
              />
            )}
            {invoiceFormData.payment_method === 'card' && (
              <>
                <TextField label="Visa Amount" type="number" size="small"
                  value={invoiceFormData.card_visa_amount}
                  onChange={(e) => setInvoiceFormData({ ...invoiceFormData, card_visa_amount: parseFloat(e.target.value) || 0 })}
                  InputProps={{ startAdornment: <InputAdornment position="start">Rs.</InputAdornment> }}
                />
                <TextField label="Mastercard Amount" type="number" size="small"
                  value={invoiceFormData.card_mastercard_amount}
                  onChange={(e) => setInvoiceFormData({ ...invoiceFormData, card_mastercard_amount: parseFloat(e.target.value) || 0 })}
                  InputProps={{ startAdornment: <InputAdornment position="start">Rs.</InputAdornment> }}
                />
              </>
            )}
            {invoiceFormData.payment_method === 'credit' && (
              <TextField label="Credit Amount" type="number" size="small"
                value={invoiceFormData.credit_amount}
                onChange={(e) => setInvoiceFormData({ ...invoiceFormData, credit_amount: parseFloat(e.target.value) || 0 })}
                InputProps={{ startAdornment: <InputAdornment position="start">Rs.</InputAdornment> }}
              />
            )}
            {invoiceFormData.payment_method === 'bank_transfer' && (
              <TextField label="Bank Transfer Amount" type="number" size="small"
                value={invoiceFormData.bank_transfer_amount}
                onChange={(e) => setInvoiceFormData({ ...invoiceFormData, bank_transfer_amount: parseFloat(e.target.value) || 0 })}
                InputProps={{ startAdornment: <InputAdornment position="start">Rs.</InputAdornment> }}
              />
            )}
            <TextField label="Remarks" size="small" multiline rows={2}
              value={invoiceFormData.remarks}
              onChange={(e) => setInvoiceFormData({ ...invoiceFormData, remarks: e.target.value })}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConvertInvoiceDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" color="primary" onClick={handleConvertToInvoiceSubmit}
            disabled={convertToInvoiceMutation.isPending}>
            {convertToInvoiceMutation.isPending ? "Converting..." : "Convert to Invoice"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ==================== Reject Dialog ==================== */}
      <Dialog open={rejectDialogOpen} onClose={() => setRejectDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <RejectIcon color="error" />
            Reject Quotation
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Reject {selectedQuote?.quote_no}. Optionally provide a reason.
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
            <TextField
              label="Rejection Reason" size="small" multiline rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g., Customer declined, pricing not competitive..."
            />
            {selectedQuote?.linked_po_id && (
              <FormControlLabel
                control={<Switch checked={cancelLinkedPO} onChange={(e) => setCancelLinkedPO(e.target.checked)} />}
                label="Also cancel the linked Purchase Order"
              />
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleRejectSubmit}
            disabled={rejectMutation.isPending}>
            {rejectMutation.isPending ? "Rejecting..." : "Reject"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ==================== Customer Approve Dialog ==================== */}
      <Dialog open={customerApproveDialogOpen} onClose={() => setCustomerApproveDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <ApproveIcon color="success" />
            Record Customer Approval
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Record customer approval for {selectedQuote?.quote_no}. The customer agrees to proceed with the purchase.
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
            <TextField
              label="Customer Contact Name" size="small"
              value={customerApprovalName}
              onChange={(e) => setCustomerApprovalName(e.target.value)}
              placeholder="Name of the customer who approved"
            />
            <TextField
              label="Approval Remarks" size="small" multiline rows={2}
              value={customerApprovalRemarks}
              onChange={(e) => setCustomerApprovalRemarks(e.target.value)}
              placeholder="Any notes about the approval..."
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCustomerApproveDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" color="success" onClick={handleCustomerApproveSubmit}
            disabled={customerApproveMutation.isPending}>
            {customerApproveMutation.isPending ? "Recording..." : "Record Approval"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
