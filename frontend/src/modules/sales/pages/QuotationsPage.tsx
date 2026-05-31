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
  PROFORMA_STATUS_FILTER_OPTIONS,
  QUOTATION_STATUS_FILTER_OPTIONS,
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
  useCrudMutation,
  useMasterDetailState,
  useTConfirmDialog
} from "@/components/tijaero";
import { useReferenceData } from "@/hooks";
import { minimumPriceApi } from "@/modules/inventory/api";
import { customersApi } from "@/modules/customers/api";
import SalesFilterPanel from "@/modules/sales/components/ui/SalesFilterPanel";
import {
  Add as AddIcon,
  ArrowBack as ArrowBackIcon,
  ArrowForward as ArrowForwardIcon,
  Cancel as CancelIcon,
  Delete as DeleteIcon,
  Description as QuoteIcon,
  Inventory as StockIcon,
  LocalShipping as POIcon,
  Percent as PercentIcon,
  Receipt as InvoiceIcon,
  Receipt as TaxIcon,
  SwapHoriz as ProformaIcon,
  Send as SendIcon,
  ThumbDown as RejectIcon,
  Warehouse as WarehouseIcon,
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
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { quotationApi } from "../quotation-api";
import {
  QUOTE_TYPE_LABELS,
  QuoteType,
  SalesQuote,
  SalesQuoteCreate,
  SalesQuoteItemCreate,
  StockAvailabilityItem,
  ToggleProformaResponse
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
  sale_rep_id: undefined,
  customer_agent_id: undefined,
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
  const navigate = useNavigate();

  // Determine which type this page shows based on URL
  const pageQuoteType: QuoteType = location.pathname.includes('proforma') ? 'proforma' : 'quotation';
  const pageTitle = pageQuoteType === 'proforma' ? 'Proforma Invoices' : 'Quotations';

  // Line items state
  const [lineItems, setLineItems] = useState<ItemFormData[]>([]);
  // True only when user has actively modified line items (not just loaded them for editing)
  const [lineItemsDirty, setLineItemsDirty] = useState(false);

  // Tax state (same as SalesPage)
  const [taxMode, setTaxMode] = useState<"inclusive" | "exclusive" | "none">("none");
  const [taxRate, setTaxRate] = useState<number>(0);
  const effectiveTaxRate = taxMode !== "none" ? taxRate : 0;

  // Form step state for stepper workflow
  const [formStep, setFormStep] = useState(0);

  // Filter states
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);

  // Print Dialog State
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [selectedQuoteForPrint, setSelectedQuoteForPrint] = useState<SalesQuote | null>(null);

  // Workflow Dialog States
  const [stockCheckDialogOpen, setStockCheckDialogOpen] = useState(false);
  const [stockAvailability, setStockAvailability] = useState<StockAvailabilityItem[]>([]);
  const [stockCheckedQuoteId, setStockCheckedQuoteId] = useState<number | null>(null);
  const [stockCheckLoading, setStockCheckLoading] = useState(false);
  const [stockAllSufficient, setStockAllSufficient] = useState(false);
  // Per-item qty overrides for partial SO dialog (item_id → qty to convert)
  const [partialQtyMap, setPartialQtyMap] = useState<Record<number, number>>({});
  const [transferFromBranch, setTransferFromBranch] = useState<string | null>(null);
  // Cancel item state
  const [cancelItemDialogOpen, setCancelItemDialogOpen] = useState(false);
  const [cancelItemTarget, setCancelItemTarget] = useState<{ quoteId: number; itemId: number; productName: string } | null>(null);
  const [cancelItemReason, setCancelItemReason] = useState("");
  const [cancelItemLoading, setCancelItemLoading] = useState(false);

  // Derived: whether any items need a PO, and whether any items are in stock (can go to SO)
  const hasItemsNeedingPO = stockAvailability.some(sa => !sa.is_sufficient);
  const hasItemsInStock = stockAvailability.some(sa => (sa.current_branch_available || 0) > 0);
  const hasItemsInOtherBranches = stockAvailability.some(sa => (sa.other_branches?.length || 0) > 0);

  const transferBranchOptions = useMemo(() => {
    const branchesSet = new Set<string>();
    stockAvailability.forEach(sa => {
      sa.other_branches?.forEach(b => branchesSet.add(b.branch_code));
    });
    return Array.from(branchesSet);
  }, [stockAvailability]);

  useEffect(() => {
    if (!transferFromBranch && transferBranchOptions.length > 0) {
      setTransferFromBranch(transferBranchOptions[0]);
    }
  }, [transferBranchOptions, transferFromBranch]);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [cancelLinkedPO, setCancelLinkedPO] = useState(false);

  // Permissions
  const canCreate = usePermission("quotations", "create");
  const canDelete = usePermission("quotations", "delete");
  const canUpdate = usePermission("quotations", "update");

  // Confirm dialogs
  const confirmDialog = useTConfirmDialog();



  // Use reusable state hook
  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem: selectedQuote,
    setSelectedItem: setSelectedQuote,
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
    markAsSaved,
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
    extraDirty: lineItemsDirty,
    onDiscard: () => { setLineItems([]); setLineItemsDirty(false); setFormStep(0); },
  });

  // OPTIMIZED: Use aggregated reference data endpoint instead of separate API calls
  const { data: refData, filteredBranches, defaultBranchCode } = useReferenceData(["products", "branches", "customers"], { productsLimit: 2000 });
  const products = refData?.products || [];
  const branches = filteredBranches || [];
  const customers = refData?.customers || [];

  // Fetch all customers to filter customer agents (is_customer_agent=true)
  const { data: allCustomers } = useQuery({
    queryKey: ["customers-all"],
    queryFn: () => customersApi.getAll(0, 500),
  });
  const customerAgents = useMemo(
    () => (allCustomers || []).filter((c) => c.is_customer_agent && c.active),
    [allCustomers]
  );

  // Auto-default branch filter for non-superuser users
  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // branchResolved: true once we've either confirmed no default branch exists, or the filter has been set
  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  // Data fetching — filtered by page type
  const { data: quotesData, isLoading } = useQuery({
    queryKey: ["sales-quotes", pageQuoteType],
    queryFn: () => quotationApi.getAll({ quote_type: pageQuoteType, per_page: 200 }),
    enabled: branchResolved,
  });

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

  // Auto-fetch stock availability silently whenever a quote is selected (no dialog)
  useEffect(() => {
    // Reset previous results immediately
    setStockAvailability([]);
    setStockAllSufficient(false);
    setStockCheckedQuoteId(null);

    if (!selectedQuote?.id || isCreating || isEditing) return;
    // Only auto-check for non-terminal statuses
    const terminalStatuses = ['cancelled', 'converted', 'converted_to_invoice', 'revised'];
    if (terminalStatuses.includes(selectedQuote.status)) return;

    let cancelled = false;
    quotationApi.checkStockAvailability(selectedQuote.id)
      .then(result => {
        if (cancelled) return;
        setStockAvailability(result.items);
        setStockAllSufficient(result.all_sufficient);
        setStockCheckedQuoteId(selectedQuote.id);
      })
      .catch(() => { /* silent — user can still manually click Stock for details */ });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedQuote?.id, isCreating, isEditing]);

  // Populate line items when quote details are loaded
  useEffect(() => {
    if (selectedQuoteDetails?.items && !isCreating && !isEditing) {
      setLineItems(selectedQuoteDetails.items.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        selling_price: Number(item.selling_price),
        minimum_selling_price: Number(item.minimum_selling_price),
        warrenty_month: item.warrenty_month,
        min_price: Number(item.minimum_selling_price),
        max_price: 0,
        is_price_estimate: item.is_price_estimate,
        description: item.description || "",
        discount_percent: item.discount_percentage || 0,
        tax_rate: 0,
      })));
      // Loading existing items is NOT a user change — keep lineItemsDirty false
      setLineItemsDirty(false);
    }
  }, [selectedQuoteDetails, isCreating, isEditing]);

  // Filter and sort
  const filteredQuotes = useMemo(() => {
    const quotes = (quotesData?.items || []).filter(Boolean);
    // Enforce: proforma page shows only proforma, quotations page shows only quotations
    let filtered = quotes.filter(
      (quote) =>
        quote.quote_type === pageQuoteType &&
        (
          quote.quote_no?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          quote.branch_code?.toLowerCase().includes(searchQuery.toLowerCase())
        )
    );

    // Apply branch filter
    if (filterBranch) {
      filtered = filtered.filter(quote => quote.branch_code === filterBranch);
    }

    // Apply status filter
    if (filterStatus) {
      filtered = filtered.filter(quote => quote.status === filterStatus);
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
  }, [quotesData?.items, searchQuery, sortField, filterBranch, filterStatus]);

  // Auto-select first item when data loads
  useEffect(() => {
    if (filteredQuotes.length > 0 && !selectedQuote && !isCreating) {
      handleSelectQuote(filteredQuotes[0]);
    }
  }, [filteredQuotes, selectedQuote, isCreating]);

  // Handle navigation state: auto-select a specific quote (e.g. after converting to proforma)
  const navStateHandled = useRef(false);
  useEffect(() => {
    const navState = location.state as { selectedQuoteId?: number } | null;
    if (navState?.selectedQuoteId && filteredQuotes.length > 0 && !navStateHandled.current) {
      const targetQuote = filteredQuotes.find(q => q.id === navState.selectedQuoteId);
      if (targetQuote) {
        navStateHandled.current = true;
        handleSelectQuote(targetQuote);
        // Clear navigation state to prevent re-triggering
        window.history.replaceState({}, document.title);
      }
    }
  }, [filteredQuotes, location.state, handleSelectQuote]);

  // No tab changes, form reset handled elsewhere

  // Helper functions
  const getBranchName = (branchCode: string) => {
    return branches.find((b) => b.branch_code === branchCode)?.branch_name || branchCode;
  };

  const getCustomerName = (customerId: number) => {
    return customers?.find((c) => c.id === customerId)?.customer_name || `Customer #${customerId}`;
  };

  // Calculate gross total (before item discounts)
  const calculateGrossTotal = () =>
    lineItems.reduce((sum, item) => sum + item.quantity * item.selling_price, 0);

  // Calculate total item discounts
  const calculateTotalItemDiscounts = () =>
    lineItems.reduce((sum, item) => {
      const gross = item.quantity * item.selling_price;
      return sum + gross * ((item.discount_percent || 0) / 100);
    }, 0);

  // Calculate line items total (after item discounts)
  const calculateLineItemsTotal = () =>
    lineItems.reduce((sum, item) => {
      const gross = item.quantity * item.selling_price;
      return sum + gross * (1 - (item.discount_percent || 0) / 100);
    }, 0);

  // Mutations
  const createMutation = useCrudMutation({
    mutationFn: (data: SalesQuoteCreate) => quotationApi.create(data),
    getInvalidateQueryKeys: () => [["sales-quotes", pageQuoteType]],
    getSuccessMessage: (newQuote: SalesQuote) => `${QUOTE_TYPE_LABELS[newQuote.quote_type]} created successfully`,
    errorMessage: "Failed to create quote",
    onSuccess: (newQuote: SalesQuote) => {
      handleSelectQuote(newQuote);
      setIsCreating(false);
      setLineItems([]);
    },
  });

  const updateMutation = useCrudMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<SalesQuoteCreate> }) =>
      quotationApi.update(id, data),
    getInvalidateQueryKeys: () => [["sales-quotes", pageQuoteType]],
    successMessage: "Quote updated successfully",
    errorMessage: "Failed to update quote",
    onSuccess: (updatedQuote: SalesQuote) => {
      setSelectedQuote(updatedQuote);
      setFormData(updatedQuote);
      markAsSaved();
      setIsEditing(false);
      setLineItemsDirty(false);
      setLineItems([]);
      queryClient.invalidateQueries({ queryKey: ["sales-quote-details", updatedQuote.id] });
    },
  });

  const deleteMutation = useCrudMutation({
    mutationFn: (id: number) => quotationApi.delete(id),
    getInvalidateQueryKeys: () => [["sales-quotes", pageQuoteType]],
    successMessage: "Quote deleted successfully",
    errorMessage: "Failed to delete quote",
    onSuccess: () => {
      setSelectedQuote(null);
    },
  });

  // ==================== Workflow Mutations ====================

  const toggleProformaMutation = useCrudMutation<
    ToggleProformaResponse,
    { id: number; is_proforma: boolean }
  >({
    mutationFn: ({ id, is_proforma }: { id: number; is_proforma: boolean }) =>
      quotationApi.toggleProforma(id, { is_proforma }),
    invalidateQueryKeys: [["sales-quotes"], ["sales-quote-details"]],
    successMessage: "Converted to Proforma Invoice",
    errorMessage: "Failed to update type",
    onSuccess: (_data: ToggleProformaResponse, variables: { id: number; is_proforma: boolean }) => {
      // Navigate to the Proforma Invoice page and auto-select the converted quote
      navigate("/sales/proforma", { state: { selectedQuoteId: variables.id } });
    },
  });

  const rejectMutation = useCrudMutation({
    mutationFn: ({ id, data }: { id: number; data: { reason?: string; cancel_linked_po?: boolean } }) =>
      quotationApi.rejectWithOptions(id, data),
    getInvalidateQueryKeys: () => [["sales-quotes", pageQuoteType], ["sales-quote-details"]],
    successMessage: "Quote rejected",
    errorMessage: "Failed to reject",
    onSuccess: (updatedQuote: SalesQuote) => {
      handleSelectQuote(updatedQuote);
      setRejectDialogOpen(false);
      setRejectReason("");
      setCancelLinkedPO(false);
    },
  });

  const cancelMutation = useCrudMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      quotationApi.cancel(id, reason),
    getInvalidateQueryKeys: () => [["sales-quotes", pageQuoteType], ["sales-quote-details"]],
    successMessage: "Quote cancelled",
    errorMessage: "Failed to cancel",
    onSuccess: (updatedQuote: SalesQuote) => {
      handleSelectQuote(updatedQuote);
    },
  });

  const markSentMutation = useCrudMutation({
    mutationFn: (id: number) => quotationApi.markAsSent(id),
    getInvalidateQueryKeys: () => [["sales-quotes", pageQuoteType], ["sales-quote-details"]],
    successMessage: "Quotation marked as sent",
    errorMessage: "Failed to mark as sent",
    onSuccess: (updatedQuote: SalesQuote) => {
      handleSelectQuote(updatedQuote);
    },
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
      setStockCheckedQuoteId(selectedQuote.id);
      queryClient.invalidateQueries({ queryKey: ["sales-quote-details", selectedQuote.id] });
    } catch (error) {
      showErrorToast(handleApiError(error as Error, "Failed to check stock"));
    } finally {
      setStockCheckLoading(false);
    }
  }, [selectedQuote, queryClient]);

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

  const handleCreateITNNavigate = useCallback(async () => {
    if (!selectedQuote || !selectedQuoteDetails?.items || !transferFromBranch) return;

    const itemsForITN = stockAvailability
      .filter(sa => {
        if ((sa.other_branches?.length || 0) === 0) return false;
        // Skip fulfilled items
        const quoteItem = selectedQuoteDetails.items.find(qi => qi.product_id === sa.product_id);
        if (!quoteItem) return false;
        if (['completed', 'cancelled', 'so_created', 'po_created', 'itn_created'].includes(quoteItem.item_status)) return false;
        return true;
      })
      .map(sa => {
        const branchEntry = sa.other_branches?.find(b => b.branch_code === transferFromBranch);
        if (!branchEntry) return null;
        const quoteItem = selectedQuoteDetails.items.find(qi => qi.product_id === sa.product_id);
        const remaining = quoteItem ? quoteItem.quantity - (quoteItem.converted_qty || 0) : sa.requested_quantity;
        const qty = Math.min(remaining, branchEntry.available_quantity);
        return qty > 0
          ? {
              product_id: sa.product_id,
              product_name: sa.product_name || `Product #${sa.product_id}`,
              quantity: qty,
            }
          : null;
      })
      .filter(Boolean) as Array<{ product_id: number; product_name: string; quantity: number }>;

    if (itemsForITN.length === 0) {
      showErrorToast("No items available in the selected branch for transfer.");
      return;
    }

    const itemIds = selectedQuoteDetails.items
      .filter(item => itemsForITN.some(itnItem => itnItem.product_id === item.product_id))
      .map(item => item.id);

    try {
      if (itemIds.length > 0) {
        await quotationApi.markItemsProcurement(selectedQuote.id, itemIds);
      }
      navigate("/warehouse/item-transfer-notes", {
        state: {
          prefillTransfer: {
            fromBranch: transferFromBranch,
            toBranch: selectedQuote.branch_code,
            items: itemsForITN,
            quoteId: selectedQuote.id,
            quoteNo: selectedQuote.quote_no,
          },
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to mark items for transfer";
      showErrorToast(msg);
    }
  }, [selectedQuote, selectedQuoteDetails, stockAvailability, transferFromBranch, navigate]);

  // Navigate to PO page with pre-filled data from proforma
  const handleCreatePONavigate = useCallback(async () => {
    if (!selectedQuote || !selectedQuoteDetails?.items) return;

    // Determine which items need procurement: use stock check data if available, otherwise all items
    // Filter out completed/cancelled items and use remaining quantities
    const itemsForPO = stockAvailability.length > 0
      ? stockAvailability
          .filter(sa => {
            if (sa.is_sufficient) return false;
            const quoteItem = selectedQuoteDetails.items.find(qi => qi.product_id === sa.product_id);
            if (!quoteItem) return false;
            // Skip items already fulfilled
            if (['completed', 'cancelled', 'so_created', 'po_created', 'itn_created'].includes(quoteItem.item_status)) return false;
            const remaining = quoteItem.quantity - (quoteItem.converted_qty || 0);
            return remaining > 0;
          })
          .map(sa => {
            const quoteItem = selectedQuoteDetails.items.find(qi => qi.product_id === sa.product_id);
            const product = products.find(p => p.id === sa.product_id);
            const remaining = quoteItem ? quoteItem.quantity - (quoteItem.converted_qty || 0) : sa.requested_quantity;
            const shortfall = remaining - (sa.current_branch_available || 0);
            return {
              product_id: sa.product_id,
              quantity: shortfall > 0 ? shortfall : remaining,
              unit_price: product?.cost_price ?? (quoteItem ? Number(quoteItem.selling_price) : 0),
              warrenty_month: quoteItem?.warrenty_month || "0",
              remark: `From Proforma ${selectedQuote.quote_no}`,
            };
          })
      : selectedQuoteDetails.items
          .filter(item => !['completed', 'cancelled', 'so_created', 'po_created', 'itn_created'].includes(item.item_status))
          .map(item => {
            const product = products.find(p => p.id === item.product_id);
            const remaining = item.quantity - (item.converted_qty || 0);
            return {
              product_id: item.product_id,
              quantity: remaining > 0 ? remaining : item.quantity,
              unit_price: product?.cost_price ?? Number(item.selling_price),
              warrenty_month: item.warrenty_month || "0",
              remark: `From ${selectedQuote.quote_type === 'proforma' ? 'Proforma' : 'Quotation'} ${selectedQuote.quote_no}`,
            };
          });

    const itemIds = selectedQuoteDetails.items
      .filter(item => itemsForPO.some(poItem => poItem.product_id === item.product_id))
      .map(item => item.id);

    try {
      if (itemIds.length > 0) {
        await quotationApi.markItemsProcurement(selectedQuote.id, itemIds);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to mark items for procurement";
      showErrorToast(msg);
    }

    navigate("/purchasing/orders", {
      state: {
        fromProforma: true,
        proformaId: selectedQuote.id,
        proformaNo: selectedQuote.quote_no,
        branchCode: selectedQuote.branch_code,
        remarks: `PO for ${selectedQuote.quote_type === 'proforma' ? 'Proforma' : 'Quotation'} ${selectedQuote.quote_no}`,
        items: itemsForPO,
      },
    });
  }, [selectedQuote, selectedQuoteDetails, stockAvailability, products, navigate, transferFromBranch]);

  // Navigate to Sales Order page with pre-filled data — only in-stock items
  const handleCreatePartialSO = useCallback(async () => {
    if (!selectedQuote || !selectedQuoteDetails?.items) return;

    // 1) Items with current-branch stock from the stock check
    const stockItems = stockAvailability
      .filter(sa => (sa.current_branch_available || 0) > 0)
      .map(sa => {
        const quoteItem = selectedQuoteDetails.items.find(i => i.product_id === sa.product_id);
        if (!quoteItem) return null;
        if (['completed', 'cancelled', 'so_created'].includes(quoteItem.item_status)) return null;
        const remaining = quoteItem.quantity - (quoteItem.converted_qty || 0);
        const maxQty = Math.min(remaining, sa.current_branch_available || 0);
        const qty = partialQtyMap[quoteItem.id] ?? maxQty;
        if (qty <= 0) return null;
        return { item_id: quoteItem.id, quantity: qty };
      })
      .filter(Boolean) as { item_id: number; quantity: number }[];

    // 2) po_created / itn_created items are always eligible (stock was procured/transferred)
    const procuredItems = selectedQuoteDetails.items
      .filter(item => ['po_created', 'itn_created'].includes(item.item_status))
      .filter(item => !stockItems.some(si => si.item_id === item.id)) // avoid duplicates
      .map(item => {
        const remaining = item.quantity - (item.converted_qty || 0);
        const qty = partialQtyMap[item.id] ?? remaining;
        if (qty <= 0) return null;
        return { item_id: item.id, quantity: qty };
      })
      .filter(Boolean) as { item_id: number; quantity: number }[];

    const itemsToConvert = [...stockItems, ...procuredItems];

    if (itemsToConvert.length === 0) {
      showErrorToast("No items selected for Sales Order.");
      return;
    }

    try {
      await quotationApi.createPartialSO(selectedQuote.id, { items: itemsToConvert });
      queryClient.invalidateQueries({ queryKey: ["quotations"] });
      queryClient.invalidateQueries({ queryKey: ["quotation", selectedQuote.id] });
      showSuccessToast(`Partial Sales Order created from ${selectedQuote.quote_no}.`);
      setStockCheckDialogOpen(false);
      setPartialQtyMap({});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create partial SO";
      showErrorToast(msg);
    }
  }, [selectedQuote, selectedQuoteDetails, stockAvailability, partialQtyMap, queryClient]);

  const handleCancelItemSubmit = useCallback(async () => {
    if (!cancelItemTarget) return;
    setCancelItemLoading(true);
    try {
      await quotationApi.cancelItem(cancelItemTarget.quoteId, cancelItemTarget.itemId, cancelItemReason || undefined);
      queryClient.invalidateQueries({ queryKey: ["quotations"] });
      queryClient.invalidateQueries({ queryKey: ["quotation", cancelItemTarget.quoteId] });
      showSuccessToast(`Item "${cancelItemTarget.productName}" cancelled.`);
      setCancelItemDialogOpen(false);
      setCancelItemTarget(null);
      setCancelItemReason("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to cancel item";
      showErrorToast(msg);
    } finally {
      setCancelItemLoading(false);
    }
  }, [cancelItemTarget, cancelItemReason, queryClient]);

  const handleCreateSONavigate = useCallback(() => {
    if (!selectedQuote || !selectedQuoteDetails?.items) return;

    // Only include items that have sufficient stock (skip items needing procurement)
    const sufficientProductIds = stockAvailability.length > 0
      ? new Set(stockAvailability.filter(sa => sa.is_sufficient).map(sa => sa.product_id))
      : null; // null = no stock check done yet, include all

    const itemsForSO = selectedQuoteDetails.items
      .filter(item => {
        // Skip items already fulfilled or cancelled
        if (['completed', 'cancelled', 'so_created'].includes(item.item_status)) return false;
        // po_created / itn_created items always qualify for SO (stock was procured/transferred)
        if (['po_created', 'itn_created'].includes(item.item_status)) {
          return (item.quantity - (item.converted_qty || 0)) > 0;
        }
        // For pending/procurement items, only include if stock check shows sufficient
        if (sufficientProductIds !== null && !sufficientProductIds.has(item.product_id)) return false;
        // Must have remaining qty
        const remaining = item.quantity - (item.converted_qty || 0);
        return remaining > 0;
      })
      .map(item => {
        const remaining = item.quantity - (item.converted_qty || 0);
        return {
          product_id: item.product_id,
          product_name: products.find(p => p.id === item.product_id)?.name || "",
          quantity: remaining,
          selling_price: Number(item.selling_price),
          minimum_selling_price: Number(item.minimum_selling_price),
          warrenty_month: item.warrenty_month || "0",
          discount_percent: item.discount_percentage || 0,
        };
      });

    if (itemsForSO.length === 0) {
      showErrorToast("No in-stock items available to create a Sales Order.");
      return;
    }

    const quoteLabel = selectedQuote.quote_type === 'proforma' ? 'Proforma' : 'Quotation';
    navigate("/sales/orders", {
      state: {
        fromProforma: true,
        createNew: true,
        proformaId: selectedQuote.id,
        proformaNo: selectedQuote.quote_no,
        customerId: selectedQuote.customer_id,
        customer_agent_id: selectedQuote.customer_agent_id,
        branchCode: selectedQuote.branch_code,
        remarks: `SO from ${quoteLabel} ${selectedQuote.quote_no}`,
        items: itemsForSO,
        taxMode: selectedQuote.tax_mode ?? taxMode,
        taxRate: selectedQuote.tax_rate ?? effectiveTaxRate,
        source_quote_type: selectedQuote.quote_type,
        advance_payment_id: selectedQuote.advance_payment_id,
        advance_amount: selectedQuote.advance_amount,
      },
    });
  }, [selectedQuote, selectedQuoteDetails, stockAvailability, navigate, taxMode, effectiveTaxRate]);

  const handleRejectSubmit = useCallback(() => {
    if (!selectedQuote) return;
    rejectMutation.mutate({
      id: selectedQuote.id,
      data: { reason: rejectReason || undefined, cancel_linked_po: cancelLinkedPO },
    });
  }, [selectedQuote, rejectReason, cancelLinkedPO, rejectMutation]);

  // Determine which workflow actions are available based on current status
  const getAvailableActions = useCallback(() => {
    if (!selectedQuote || isCreating || isEditing) return [];
    const s = selectedQuote.status;
    const actions: string[] = [];

    // Mark as sent — allowed from draft or sent (idempotent re-send)
    if (['draft', 'sent'].includes(s)) actions.push('send');
    // Mark as proforma (toggle) — only for quotation type, not terminal
    if (!['completed', 'cancelled'].includes(s)) actions.push('toggle_proforma');
    // Check stock — allowed for any non-terminal status
    if (!['completed', 'cancelled'].includes(s)) actions.push('check_stock');
    // Create PO / SO / ITN — allowed while not completed or cancelled
    if (!['completed', 'cancelled'].includes(s)) actions.push('create_po');
    if (!['completed', 'cancelled'].includes(s)) actions.push('create_so');
    // Cancel — allowed from any non-final status
    if (!['completed', 'cancelled'].includes(s)) actions.push('cancel');

    return actions;
  }, [selectedQuote, isCreating, isEditing]);


  // Handlers
  const handleCreateNew = useCallback(() => {
    const emptyForm = getEmptyQuoteForm(pageQuoteType);
    setFormData({ ...emptyForm, branch_code: defaultBranchCode || emptyForm.branch_code });
    setLineItems([]);
    setLineItemsDirty(false);
    setFormStep(0);
    setTaxMode("none");
    setTaxRate(0);
    handleNewQuote();
  }, [handleNewQuote, setFormData, pageQuoteType, defaultBranchCode]);

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
    setTaxMode("none");
    setTaxRate(0);
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
        customer_agent_id: selectedQuote.customer_agent_id,
        valid_until: selectedQuote.valid_until,
        is_estimate: selectedQuote.is_estimate,
        remarks: selectedQuote.remarks || "",
        customer_notes: selectedQuote.customer_notes || "",
        special: selectedQuote.special,
      });
      setTaxMode((selectedQuote.tax_mode as "none" | "inclusive" | "exclusive") || "none");
      setTaxRate(selectedQuote.tax_rate || 0);
      setLineItemsDirty(false);
      handleStartEdit();
    }
  }, [selectedQuote, setFormData, handleStartEdit]);

  const handleSave = useCallback(() => {
    if (!formData.customer_id || formData.customer_id === 0) {
      showErrorToast("Please select a customer");
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
        tax_mode: taxMode,
        tax_rate: effectiveTaxRate,
      } as SalesQuoteCreate);
    } else if (isEditing && selectedQuote) {
      updateMutation.mutate({
        id: selectedQuote.id,
        data: { ...formData, items, tax_mode: taxMode, tax_rate: effectiveTaxRate },
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
    setLineItemsDirty(true);
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
      setLineItemsDirty(true);
      setLineItems(prev => {
        const updated = [...prev];
        updated[index] = { ...updated[index], [field]: value } as ItemFormData;

        return updated;
      });
      return;
    }

    // For product selection, fetch minimum price from MinimumPrice table
    if (field === "product_id" && value) {
      setLineItemsDirty(true);
      const product = products?.find((p) => p.id === value);
      if (product) {
        // First update with product selected and selling_price from the product catalogue
        setLineItems(prev => {
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            product_id: value as number,
            selling_price: product.selling_price || 0,
          } as ItemFormData;
          return updated;
        });

        try {
          // Fetch the current minimum price from the MinimumPrice table
          const minPriceData = await minimumPriceApi.getCurrent(product.id);
          const minSellingPrice = minPriceData?.minimum_price || 0;

          // Update minimum price fields only — keep selling_price as product catalogue price
          setLineItems(prev => {
            const updated = [...prev];
            updated[index].min_price = minSellingPrice;
            updated[index].minimum_selling_price = minSellingPrice;
            return updated;
          });
        } catch (error) {
          // If no minimum price set in the MinimumPrice table, set to 0
          setLineItems(prev => {
            const updated = [...prev];
            updated[index].min_price = 0;
            updated[index].minimum_selling_price = 0;
            return updated;
          });
          showErrorToast("No minimum price set for this product. Please set a minimum price first.");
        }
      }
    }
  };

  // Remove line item
  const handleRemoveLineItem = (index: number) => {
    setLineItemsDirty(true);
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
                  label: selectedQuote.status === 'sent' ? '✓ Sent' : selectedQuote.status.replace(/_/g, ' ').toUpperCase(),
                  color: selectedQuote.status === 'draft' ? 'default'
                    : selectedQuote.status === 'sent' ? 'success'
                    : selectedQuote.status === 'approved' ? 'success'
                    : selectedQuote.status === 'partially_processed' ? 'warning'
                    : selectedQuote.status === 'completed' ? 'success'
                    : selectedQuote.status === 'cancelled' || selectedQuote.status === 'rejected' ? 'error'
                    : 'info'
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
          saveDisabled={!formData.customer_id || !formData.branch_code || !formData.valid_until || lineItems.length === 0}
          endActions={
            selectedQuote && !isCreating && !isEditing ? (
              <Box sx={{ display: "flex", gap: 0.5, alignItems: "center", flexWrap: "wrap" }}>
                {/* Workflow Action Buttons */}
                {getAvailableActions().includes('send') && (
                  <Tooltip title="Mark as Sent to Customer">
                    <Button size="small" variant="outlined" color="success" startIcon={<SendIcon />}
                      onClick={() => markSentMutation.mutate(selectedQuote.id)}
                      disabled={markSentMutation.isPending}>
                      {selectedQuote.status === 'sent' ? '✓ Sent' : 'Mark Sent'}
                    </Button>
                  </Tooltip>
                )}
                {/* Only quotations can be promoted to proforma — not the reverse */}
                {getAvailableActions().includes('toggle_proforma') && selectedQuote.quote_type === 'quotation' && (
                  <Tooltip title="Convert to Proforma Invoice">
                    <Button size="small" variant="outlined" color="secondary" startIcon={<ProformaIcon />}
                      onClick={handleToggleProforma} disabled={toggleProformaMutation.isPending}>
                      To Proforma
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
                {getAvailableActions().includes('create_po') &&
                  stockCheckedQuoteId === selectedQuote.id &&
                  hasItemsNeedingPO && (
                  <Tooltip title="Create Purchase Order for unavailable items">
                    <Button size="small" variant="outlined" color="warning" startIcon={<POIcon />}
                      onClick={handleCreatePONavigate}>
                      Create PO
                    </Button>
                  </Tooltip>
                )}
                {stockCheckedQuoteId === selectedQuote.id && hasItemsInOtherBranches && (
                  <Tooltip title="Create ITN for items available in other branches">
                    <Button size="small" variant="outlined" color="info" startIcon={<WarehouseIcon />}
                      onClick={handleCreateITNNavigate}>
                      Create ITN
                    </Button>
                  </Tooltip>
                )}
                {getAvailableActions().includes('create_so') &&
                  stockCheckedQuoteId === selectedQuote.id &&
                  hasItemsInStock && (
                  <Tooltip title={hasItemsNeedingPO ? "Create Sales Order for in-stock items" : "Create Sales Order from this quote"}>
                    <Button size="small" variant="contained" color="primary" startIcon={<InvoiceIcon />}
                      onClick={handleCreateSONavigate}>
                      To Sales Order
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
                <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                <TPrintButton
                  documentType="quotation"
                  documentId={selectedQuote.id}
                  disabled={!canPrintDocument(selectedQuote.status, ["cancelled"])}
                  disabledReason={`Cannot print: quotation is ${(selectedQuote.status || "").replace(/_/g, " ")}`}
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

    // Calculate totals from items (after item discounts, before tax)
    const calculateTotal = () => {
      if (!selectedQuoteDetails?.items) return quote.total_amount;
      return selectedQuoteDetails.items.reduce((sum, item) => {
        const lineGross = item.quantity * Number(item.selling_price);
        return sum + lineGross * (1 - (item.discount_percentage || 0) / 100);
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
                <TableCell align="right" sx={{ width: 90 }}>Discount</TableCell>
                <TableCell sx={{ width: 100 }}>Warranty</TableCell>
                <TableCell align="center" sx={{ width: 140 }}>Item Status</TableCell>
                <TableCell align="right" sx={{ width: 120 }}>Amount (Rs.)</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {selectedQuoteDetails?.items && selectedQuoteDetails.items.length > 0 ? (
                selectedQuoteDetails.items.map((item, index) => {
                  const product = products?.find(p => p.id === item.product_id);
                  const lineTotal = item.quantity * Number(item.selling_price);
                  // Prefer live stock check result; fall back to stored stock_status from DB
                  const liveStock = stockAvailability.find(sa => sa.product_id === item.product_id);
                  // Derive stock status: live check overrides stored value
                  const stockStatus = liveStock
                    ? (liveStock.is_sufficient ? 'in_stock'
                        : (liveStock.other_branches && liveStock.other_branches.length > 0) ? 'needs_transfer'
                        : 'needs_procurement')
                    : item.stock_status;
                  const itemStatus = item.item_status ?? 'pending';
                  // Item can be cancelled if it hasn't been fulfilled or already cancelled
                  const canCancelItem = selectedQuote &&
                    !['so_created', 'cancelled', 'completed'].includes(itemStatus);
                  return (
                    <TableRow key={index} sx={{
                      ...modernTableStyles.bodyRow,
                      ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                      ...(itemStatus === 'cancelled' && { opacity: 0.5 }),
                    }}>
                      <TableCell>{product?.name || `Product #${item.product_id}`}</TableCell>
                      <TableCell align="right">{item.quantity}</TableCell>
                      <TableCell align="right"><TCurrency value={Number(item.selling_price)} /></TableCell>
                      <TableCell align="right">
                        {(item.discount_percentage || 0) > 0
                          ? <Typography variant="body2" color="error.main">{item.discount_percentage}%</Typography>
                          : <Typography variant="body2" color="text.disabled">-</Typography>}
                      </TableCell>
                      <TableCell>{item.warrenty_month || "-"}</TableCell>
                      {/* ── Item Status Column ── */}
                      <TableCell align="center">
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                          {itemStatus === 'so_created' || itemStatus === 'completed' ? (
                            <Chip label="SO Created" color="success" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          ) : itemStatus === 'po_created' ? (
                            <Chip label="PO Created" color="info" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          ) : itemStatus === 'itn_created' ? (
                            <Chip label="ITN Created" color="info" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          ) : itemStatus === 'procurement' ? (
                            // PO/ITN in progress — show what was initiated
                            stockStatus === 'needs_transfer'
                              ? <Chip label="Transfer Available" color="secondary" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                              : <Chip label="Need PO" color="warning" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          ) : itemStatus === 'cancelled' ? (
                            <Chip label="Cancelled" color="default" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          ) : (
                            // Pending — show based on stock availability
                            stockStatus === 'needs_transfer'
                              ? <Chip label="Transfer Available" color="secondary" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                              : stockStatus === 'needs_procurement'
                                ? <Chip label="Need PO" color="warning" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                                : stockStatus === 'in_stock'
                                  ? <Chip label="Need SO" color="info" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                                  : <Chip label="Need SO" color="info" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          )}
                          {canCancelItem && (
                            <Button size="small" color="error" sx={{ fontSize: '0.65rem', p: '1px 4px', minWidth: 0 }}
                              onClick={() => {
                                setCancelItemTarget({ quoteId: selectedQuote!.id, itemId: item.id, productName: product?.name || `Product #${item.product_id}` });
                                setCancelItemDialogOpen(true);
                              }}>
                              Cancel
                            </Button>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell align="right">
                        <TCurrency value={item.quantity * Number(item.selling_price) * (1 - (item.discount_percentage || 0) / 100)} />
                      </TableCell>
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

        {/* Discount & Tax Summary (view mode) */}
        {(quote.tax_mode && quote.tax_mode !== 'none' && (quote.tax_rate || 0) > 0) && (() => {
          const rate = quote.tax_rate || 0;
          const subtotalAfterDiscounts = calculateTotal();
          let taxAmount: number;
          let grandTotal: number;
          if (quote.tax_mode === 'exclusive') {
            // Tax is added on top
            taxAmount = subtotalAfterDiscounts * (rate / 100);
            grandTotal = subtotalAfterDiscounts + taxAmount;
          } else {
            // Inclusive: tax is already inside the price
            taxAmount = subtotalAfterDiscounts * rate / (100 + rate);
            grandTotal = subtotalAfterDiscounts;
          }
          return (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5, mt: 1, pr: 1 }}>
              <Box sx={{ display: 'flex', gap: 4 }}>
                <Typography variant="body2" color="text.secondary">Subtotal (excl. tax):</Typography>
                <Typography variant="body2">
                  <TCurrency value={quote.tax_mode === 'inclusive' ? subtotalAfterDiscounts - taxAmount : subtotalAfterDiscounts} />
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 4 }}>
                <Typography variant="body2" color="info.main">
                  Tax ({rate}%{quote.tax_mode === 'exclusive' ? ' excl.' : ' incl.'}):
                </Typography>
                <Typography variant="body2" color="info.main">
                  {quote.tax_mode === 'exclusive' ? '+ ' : ''}<TCurrency value={taxAmount} />
                </Typography>
              </Box>
              <Divider sx={{ width: '100%' }} />
              <Box sx={{ display: 'flex', gap: 4 }}>
                <Typography variant="body2" fontWeight="bold">Grand Total:</Typography>
                <Typography variant="body2" fontWeight="bold"><TCurrency value={grandTotal} /></Typography>
              </Box>
            </Box>
          );
        })()}

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

        {/* Advance Payment (for proforma invoices) */}
        {quote.advance_payment_id && (
          <>
            <Divider sx={{ my: 2 }} />
            <FormSection title="Advance Payment">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Chip
                  label="Advance Paid"
                  color="success"
                  size="small"
                />
                <Typography variant="body2" color="text.secondary">
                  Advance #{quote.advance_payment_id}
                </Typography>
                {quote.advance_amount && (
                  <Chip
                    label={<TCurrency value={quote.advance_amount} />}
                    color="success"
                    variant="outlined"
                    size="small"
                  />
                )}
              </Box>
            </FormSection>
          </>
        )}

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
    // Step 1 validation: Basic info is filled (sale_rep_id is optional)
    const isStep1Valid = formData.customer_id && formData.customer_id > 0 && formData.branch_code && formData.valid_until;

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
                options={customerAgents}
                getOptionLabel={(option) =>
                  `${option.customer_name}${option.commission_rate ? ` (${option.commission_rate}%)` : ""}`
                }
                value={customerAgents.find((c) => c.id === formData.customer_agent_id) || null}
                onChange={(_, newValue) =>
                  setFormData({ ...formData, customer_agent_id: newValue?.id || undefined })
                }
                renderInput={(params) => (
                  <TextField {...params} label="Sales Representative / Agent (Optional)" />
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
                <Table size="small" sx={{ tableLayout: "fixed", width: "100%" }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: "30%" }}>Product</TableCell>
                      <TableCell align="right" sx={{ width: 90 }}>Qty</TableCell>
                      <TableCell align="right" sx={{ width: 130 }}>Price (Rs.)</TableCell>
                      <TableCell align="right" sx={{ width: 110 }}>Disc %</TableCell>
                      <TableCell align="right" sx={{ width: 110 }}>Warranty (Months)</TableCell>
                      {formData.quote_type === "quotation" && (
                        <TableCell align="right" sx={{ width: 130 }}>Min Price (Rs.)</TableCell>
                      )}
                      <TableCell align="right" sx={{ width: 120 }}>Total (Rs.)</TableCell>
                      <TableCell align="center" sx={{ width: 60 }}>Del</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {lineItems.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <Autocomplete
                            options={[...(products || [])].sort((a, b) => a.name.localeCompare(b.name))}
                            getOptionLabel={(option) => `${option.item_code} - ${option.name}`}
                            filterOptions={(options, { inputValue }) => {
                              const q = inputValue.toLowerCase();
                              return options.filter(
                                (o) =>
                                  o.name.toLowerCase().includes(q) ||
                                  o.item_code.toLowerCase().includes(q)
                              );
                            }}
                            value={products?.find((p) => p.id === item.product_id) || null}
                            onChange={(_, newValue) =>
                              handleUpdateLineItem(index, "product_id", newValue?.id || 0)
                            }
                            renderInput={(params) => (
                              <TextField {...params} size="small" placeholder="Search by name or code" />
                            )}
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
                            sx={{ width: "100%" }}
                            inputProps={{ min: 1, style: { textAlign: "right" } }}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <TextField
                            type="number"
                            value={Number(item.selling_price)}
                            onChange={(e) =>
                              handleUpdateLineItem(index, "selling_price", parseFloat(e.target.value) || 0)
                            }
                            size="small"
                            sx={{ width: "100%" }}
                            InputProps={{}}
                            inputProps={{ min: item.min_price || 0 }}
                            error={item.selling_price < (item.min_price || 0)}
                            helperText={item.selling_price < (item.min_price || 0) ? "Below min" : ""}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <TextField
                            type="number"
                            value={item.discount_percent || ""}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              if (val > 100) return;
                              handleUpdateLineItem(index, "discount_percent", val);
                            }}
                            size="small"
                            sx={{ width: "100%" }}
                            placeholder="0"
                            InputProps={{
                              endAdornment: <InputAdornment position="end">%</InputAdornment>,
                            }}
                            inputProps={{ min: 0, max: 100, step: 0.5 }}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <TextField
                            type="number"
                            value={item.warrenty_month || ""}
                            onChange={(e) =>
                              handleUpdateLineItem(index, "warrenty_month", e.target.value)
                            }
                            size="small"
                            sx={{ width: "100%" }}
                            placeholder="0"
                            inputProps={{ min: 0, step: 1 }}
                          />
                        </TableCell>
                        {formData.quote_type === "quotation" && (
                          <TableCell align="right">
                            <TextField
                              type="number"
                              value={item.min_price || ""}
                              size="small"
                              sx={{ width: "100%" }}
                              placeholder="Min"
                              disabled
                              InputProps={{
                                readOnly: true,
                              }}
                            />
                          </TableCell>
                        )}
                        <TableCell align="right">
                          <Typography fontWeight="medium" noWrap>
                            <TCurrency
                              value={item.quantity * item.selling_price * (1 - (item.discount_percent || 0) / 100)}
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

              {/* Discount & Tax section */}
              <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap", mb: 2 }}>
                {/* Tax toggle */}
                <Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Tax (VAT/GST)</Typography>
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
                    <Box sx={{ display: "flex", gap: 1, alignItems: "center", mt: 1 }}>
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
                          startAdornment: <InputAdornment position="start"><TaxIcon fontSize="small" color="action" /></InputAdornment>,
                          endAdornment: <InputAdornment position="end">%</InputAdornment>,
                        }}
                        inputProps={{ min: 0, max: 100, step: 0.5 }}
                      />
                      {effectiveTaxRate > 0 && (
                        <IconButton size="small" color="error" onClick={() => setTaxRate(0)} sx={{ p: 0.5 }}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Box>
                  )}
                  {/* Quick select chips */}
                  {taxMode !== "none" && (
                    <Box sx={{ display: "flex", gap: 0.5, mt: 1 }}>
                      {[1, 5, 8, 12, 18].map((rate) => (
                        <Chip
                          key={rate}
                          label={`${rate}%`}
                          size="small"
                          variant={taxRate === rate ? "filled" : "outlined"}
                          color={taxRate === rate ? "primary" : "default"}
                          onClick={() => setTaxRate(rate)}
                          sx={{ cursor: "pointer", minWidth: 40 }}
                        />
                      ))}
                    </Box>
                  )}
                </Box>
              </Box>

              {/* Summary rows */}
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, alignItems: "flex-end" }}>
                {calculateTotalItemDiscounts() > 0 && (
                  <>
                    <Box sx={{ display: "flex", gap: 4 }}>
                      <Typography variant="body2" color="text.secondary">Gross Total:</Typography>
                      <Typography variant="body2" fontWeight="medium">
                        <TCurrency value={taxMode === "inclusive" && effectiveTaxRate > 0 ? calculateGrossTotal() / (1 + effectiveTaxRate / 100) : calculateGrossTotal()} />
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", gap: 4 }}>
                      <Typography variant="body2" color="error.main">Item Discounts:</Typography>
                      <Typography variant="body2" color="error.main">
                        - <TCurrency value={taxMode === "inclusive" && effectiveTaxRate > 0 ? calculateTotalItemDiscounts() / (1 + effectiveTaxRate / 100) : calculateTotalItemDiscounts()} />
                      </Typography>
                    </Box>
                  </>
                )}
                {effectiveTaxRate > 0 && (
                  <Box sx={{ display: "flex", gap: 4 }}>
                    <Typography variant="body2" color="info.main">
                      {taxMode === "exclusive" ? `Tax (${effectiveTaxRate}%):` : `Tax included (${effectiveTaxRate}%):`}
                    </Typography>
                    <Typography variant="body2" color="info.main">
                      {taxMode === "exclusive" ? "+ " : ""}
                      <TCurrency value={(() => {
                        const subtotal = calculateLineItemsTotal();
                        return taxMode === "exclusive"
                          ? subtotal * (effectiveTaxRate / 100)
                          : subtotal * (effectiveTaxRate / 100) / (1 + effectiveTaxRate / 100);
                      })()} />
                    </Typography>
                  </Box>
                )}
                <Divider sx={{ width: "100%", my: 0.5 }} />
                <Typography variant="h6" fontWeight={700} color="success.main">
                  Grand Total: <TCurrency value={(() => {
                    const subtotal = calculateLineItemsTotal();
                    return taxMode === "exclusive" ? subtotal * (1 + effectiveTaxRate / 100) : subtotal;
                  })()} />
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
                  statusOptions={pageQuoteType === 'proforma' ? PROFORMA_STATUS_FILTER_OPTIONS : QUOTATION_STATUS_FILTER_OPTIONS}
                  statusValue={filterStatus}
                  onStatusChange={setFilterStatus}
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
      <Dialog open={stockCheckDialogOpen} onClose={() => setStockCheckDialogOpen(false)} maxWidth="lg" fullWidth>
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
                  : hasItemsInOtherBranches
                    ? "Some items are not in this branch. You can transfer from another branch or procure if needed."
                    : "Some items are not available in stock and need procurement."}
              </Alert>
              <Table size="small">
                <TableHead>
                  <TableRow sx={modernTableStyles.headerRow}>
                    <TableCell>Product</TableCell>
                    <TableCell align="right">Required</TableCell>
                    <TableCell align="right">Available</TableCell>
                    <TableCell align="center">Other Branches</TableCell>
                    <TableCell align="center">Stock</TableCell>
                    <TableCell align="center">Item Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {stockAvailability.map((item, index) => {
                    const quoteItem = selectedQuoteDetails?.items?.find(i => i.product_id === item.product_id);
                    const itemStatus = quoteItem?.item_status ?? 'pending';
                    const currentAvailable = item.current_branch_available ?? item.available_quantity;
                    // Derive stockStatus from live check
                    const stockStatus = item.is_sufficient ? 'in_stock'
                      : (item.other_branches && item.other_branches.length > 0) ? 'needs_transfer'
                      : 'needs_procurement';
                    return (
                      <TableRow key={index} sx={modernTableStyles.bodyRow}>
                        <TableCell>{item.product_name || `Product #${item.product_id}`}</TableCell>
                        <TableCell align="right">{item.requested_quantity}</TableCell>
                        <TableCell align="right">{currentAvailable}</TableCell>
                        <TableCell align="center">
                          {item.other_branches && item.other_branches.length > 0 ? (
                            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, justifyContent: "center" }}>
                              {item.other_branches.map((b) => (
                                <Chip key={`${item.product_id}-${b.branch_code}`} label={`${b.branch_code}: ${b.available_quantity}`} size="small" />
                              ))}
                            </Box>
                          ) : (
                            <Typography variant="caption" color="text.disabled">–</Typography>
                          )}
                        </TableCell>
                        {/* Stock: In Stock / Out of Stock */}
                        <TableCell align="center">
                          {itemStatus === 'cancelled' ? (
                            <Typography variant="caption" color="text.disabled">—</Typography>
                          ) : ['so_created', 'completed', 'po_created', 'itn_created'].includes(itemStatus) ? (
                            <Chip label="In Stock" color="success" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          ) : stockStatus === 'in_stock' ? (
                            <Chip label="In Stock" color="success" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          ) : (
                            <Chip label="Out of Stock" color="error" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          )}
                        </TableCell>
                        {/* Item Status */}
                        <TableCell align="center">
                          {itemStatus === 'so_created' || itemStatus === 'completed' ? (
                            <Chip label="SO Created" color="success" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          ) : itemStatus === 'po_created' ? (
                            <Chip label="PO Created" color="info" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          ) : itemStatus === 'itn_created' ? (
                            <Chip label="ITN Created" color="info" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          ) : itemStatus === 'procurement' ? (
                            stockStatus === 'needs_transfer'
                              ? <Chip label="Transfer Available" color="secondary" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                              : <Chip label="Need PO" color="warning" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          ) : itemStatus === 'cancelled' ? (
                            <Chip label="Cancelled" color="default" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          ) : (
                            stockStatus === 'needs_transfer'
                              ? <Chip label="Transfer Available" color="secondary" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                              : stockStatus === 'needs_procurement'
                                ? <Chip label="Need PO" color="warning" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                                : <Chip label="Need SO" color="info" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </DialogContent>
        <DialogActions />
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

      {/* ==================== Cancel Item Dialog ==================== */}
      <Dialog open={cancelItemDialogOpen} onClose={() => { setCancelItemDialogOpen(false); setCancelItemTarget(null); setCancelItemReason(""); }} maxWidth="sm" fullWidth>
        <DialogTitle>Cancel Item</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Cancel <strong>{cancelItemTarget?.productName}</strong> from this quotation? This item will no longer be converted to a Sales Order.
          </Typography>
          <TextField
            label="Reason (optional)" size="small" fullWidth multiline rows={2}
            value={cancelItemReason}
            onChange={(e) => setCancelItemReason(e.target.value)}
            placeholder="e.g., Customer no longer needs this item"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCancelItemDialogOpen(false); setCancelItemTarget(null); setCancelItemReason(""); }}>Back</Button>
          <Button variant="contained" color="error" onClick={handleCancelItemSubmit} disabled={cancelItemLoading}>
            {cancelItemLoading ? "Cancelling..." : "Cancel Item"}
          </Button>
        </DialogActions>
      </Dialog>

    </>
  );
}
