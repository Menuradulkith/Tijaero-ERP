/**
 * QuotationsPage - Refactored to use Tijaero-style reusable components
 */

import { usePermission } from "@/auth/permissions";
import { useCurrencyStore } from "@/state/currencyStore";
import { formatDateTimeReadable } from "@/utils/formatters";
import {
  TChip,
  ActionToolbar,
  canPrintDocument,
  DetailPanelHeader,
  EmptyState,
  FormSection,
  getStatusProps,
  handleApiError,
  MasterDetailLayout,
  modernTableStyles,
  QUOTATION_STATUS_FILTER_OPTIONS,
  showErrorToast,
  showSuccessToast,
  TBranchFilter,
  TConfirmDialog,
  TCurrency,
  TDate,
  TPrintButton,
  TPrintPreviewDialog,
  TStatusChip,
  TStatusFilter,
  TRemarkField,
  useCrudMutation,
  useMasterDetailState,
  useTConfirmDialog,
  TEmailDialog,
  TActivityHistoryPanel,
  TDataGrid,
  type TDataGridColumn,
} from "@/components/tijaero";
import { useReferenceData } from "@/hooks";
import { minimumPriceApi } from "@/modules/inventory/api";
import { customersApi } from "@/modules/customers/api";
import { customerDisplayName } from "@/modules/customers/types";
import { procurementQueueApi } from "@/modules/purchasing/api";
import {
  Add as AddIcon,
  ArrowBack as ArrowBackIcon,
  Delete as DeleteIcon,
  Save as SaveIcon,
  Description as QuoteIcon,
  Inventory as StockIcon,
  LocalShipping as POIcon,
  Receipt as InvoiceIcon,
  Receipt as TaxIcon,
  Send as SendIcon,
  ThumbDown as RejectIcon,
  Warehouse as WarehouseIcon,
  Email as EmailIcon,
  History as HistoryIcon,
  Search as SearchIcon,
  OpenInNew as OpenInNewIcon,
  Restore as RevisionIcon,
} from "@mui/icons-material";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
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
  Typography,
} from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { quotationApi } from "../quotation-api";
import SupplierSelectionDialog, {
  type ProcurementCandidate,
  type SupplierSelection,
} from "../components/SupplierSelectionDialog";
import {
  QUOTE_TYPE_LABELS,
  QuoteType,
  SalesQuote,
  SalesQuoteCreate,
  SalesQuoteItemCreate,
  StockAvailabilityItem,
  CreateRevisionResponse,
} from "../quotation-types";

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
  price_tier_id?: number;
}

// Initial form data
const getEmptyQuoteForm = (quoteType: QuoteType): Partial<SalesQuoteCreate> => ({
  quote_type: quoteType,
  branch_code: "MAIN",
  customer_id: 0,
  sale_rep_id: undefined,
  customer_agent_id: undefined,
  valid_until: "",
  is_estimate: quoteType === "quotation",
  remarks: "",
  customer_notes: "",
  special: false,
  items: [],
});

export default function QuotationsPage() {
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();

  const pageQuoteType: QuoteType = 'quotation';
  const pageTitle = 'Quotations';

  // Line items state
  const [lineItems, setLineItems] = useState<ItemFormData[]>([]);
  // True only when user has actively modified line items (not just loaded them for editing)
  const [lineItemsDirty, setLineItemsDirty] = useState(false);

  // Tax state (same as SalesPage)
  const [taxMode, setTaxMode] = useState<"inclusive" | "exclusive" | "none">("none");
  const [taxRate, setTaxRate] = useState<number>(0);
  const effectiveTaxRate = taxMode !== "none" ? taxRate : 0;

  // Filter states - all filters apply live as the user types/selects, no
  // separate "Search" step needed.
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterCustomerId, setFilterCustomerId] = useState<number | null>(null);
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  // Print Dialog State
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [selectedQuoteForPrint, setSelectedQuoteForPrint] = useState<SalesQuote | null>(null);

  // Workflow Dialog States
  const [stockCheckDialogOpen, setStockCheckDialogOpen] = useState(false);
  const [stockAvailability, setStockAvailability] = useState<StockAvailabilityItem[]>([]);
  const [stockCheckedQuoteId, setStockCheckedQuoteId] = useState<number | null>(null);
  const [stockCheckLoading, setStockCheckLoading] = useState(false);
  const [stockAllSufficient, setStockAllSufficient] = useState(false);
  // Per-item qty overrides for partial SO dialog (item_id → qty to convert)
  const [partialQtyMap, setPartialQtyMap] = useState<Record<number, number>>({});
  const [partialSOSubmitting, setPartialSOSubmitting] = useState(false);
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
  // Cost/margin is sensitive — only shown to users with cost_price:view
  // (same permission gate used on the Sales Stock dashboard).
  const canViewCost = usePermission("cost_price", "view");

  // Confirm dialogs
  const confirmDialog = useTConfirmDialog();



  // Use reusable state hook
  const {
    searchQuery,
    setSearchQuery,
    selectedItem: selectedQuote,
    setSelectedItem: setSelectedQuote,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    hasChanges,
    formData,
    setFormData,
    handleSelectItem: handleSelectQuote,
    handleNew: handleNewQuoteBase,
    handleCancel: baseHandleCancel,
    handleStartEdit,
    markAsSaved,
  } = useMasterDetailState<SalesQuote, Partial<SalesQuoteCreate>>({
    initialFormData: getEmptyQuoteForm(pageQuoteType),
    resetFormFromItem: (quote) => quote,
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
    onDiscard: () => { setLineItems([]); setLineItemsDirty(false); },
  });

  // Activity History is opened on demand from a detail icon next to the
  // Workflow Timeline section title, rather than shown inline.
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);

  // OPTIMIZED: Use aggregated reference data endpoint instead of separate API calls
  const { data: refData, filteredBranches, defaultBranchCode } = useReferenceData(["products", "branches", "customers"], { productsLimit: 2000 });
  const products = refData?.products || [];
  const branches = filteredBranches || [];
  const customers = refData?.customers || [];

  const handleNewQuote = useCallback(() => {
    handleNewQuoteBase();
    if (defaultBranchCode) {
      setFormData((prev) => ({
        ...prev,
        branch_code: defaultBranchCode,
      }));
    }
  }, [handleNewQuoteBase, setFormData, defaultBranchCode]);

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

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterStatus(null);
    setFilterBranch(null);
    setFilterCustomerId(null);
    setFilterDateFrom("");
    setFilterDateTo("");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Required/ordered/received/reserved/available/outstanding per item —
  // the procurement + stock-reservation traceability panel.
  const { data: procurementSummary } = useQuery({
    queryKey: ["sales-quote-procurement-summary", selectedQuote?.id],
    queryFn: () => quotationApi.getProcurementSummary(selectedQuote!.id),
    enabled: !!selectedQuote?.id && !isCreating && !isEditing,
  });

  // Reset selection and form on mount
  useEffect(() => {
    handleSelectQuote(null as unknown as SalesQuote);
    setLineItems([]);
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
    const terminalStatuses = ['cancelled', 'completed', 'revised'];
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
    let filtered = quotes.filter(
      (quote) =>
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

    // Apply customer filter
    if (filterCustomerId) {
      filtered = filtered.filter(quote => quote.customer_id === filterCustomerId);
    }

    // Apply created date range filter (date-only comparison, same as the
    // From/To pattern used on POApprovalsPage).
    if (filterDateFrom) {
      filtered = filtered.filter(quote => {
        const created = (quote.created_date_time || quote.created_date || "").slice(0, 10);
        return created >= filterDateFrom;
      });
    }
    if (filterDateTo) {
      filtered = filtered.filter(quote => {
        const created = (quote.created_date_time || quote.created_date || "").slice(0, 10);
        return created <= filterDateTo;
      });
    }

    // Default order before the user sorts a column in the table itself
    // (the table's own column-header sort takes over from there) — newest
    // created first, matching the old default "Date (Newest)" sort option.
    filtered.sort((a, b) => {
      const timeA = a.created_date_time ? new Date(a.created_date_time).getTime() : new Date(a.created_date).getTime();
      const timeB = b.created_date_time ? new Date(b.created_date_time).getTime() : new Date(b.created_date).getTime();
      if (timeB !== timeA) {
        return timeB - timeA;
      }
      return b.id - a.id;
    });

    return filtered;
  }, [quotesData?.items, searchQuery, filterBranch, filterStatus, filterCustomerId, filterDateFrom, filterDateTo]);

  // Handle navigation state: auto-select a specific quote (e.g. from another page)
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
    return customerDisplayName(customers?.find((c) => c.id === customerId)) || `Customer #${customerId}`;
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

  // Calculate total cost (buying price) of all line items, for margin display.
  // Only meaningful for users permitted to see cost_price at all.
  const calculateLineItemsCostTotal = () =>
    lineItems.reduce((sum, item) => {
      const cost = products?.find((p) => p.id === item.product_id)?.cost_price ?? 0;
      return sum + item.quantity * cost;
    }, 0);

  const marginPercent = (sellingTotal: number, costTotal: number) =>
    sellingTotal > 0 ? ((sellingTotal - costTotal) / sellingTotal) * 100 : 0;

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

  const createRevisionMutation = useCrudMutation({
    mutationFn: (id: number) => quotationApi.createRevision(id),
    getInvalidateQueryKeys: () => [["sales-quotes", pageQuoteType]],
    getSuccessMessage: (data: CreateRevisionResponse) => data.message,
    errorMessage: "Failed to create revision",
    onSuccess: async (data: CreateRevisionResponse) => {
      const newQuote = await quotationApi.getById(data.new_quote_id);
      handleSelectQuote(newQuote);
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

  const [releasingReservation, setReleasingReservation] = useState(false);

  // Explicit release of stock reserved for this quotation's procurement —
  // never automatic. Available to any active quotation (most relevant once
  // cancelled or when an authorized user decides to free up committed stock).
  const handleReleaseReservation = useCallback(async () => {
    if (!selectedQuote) return;
    const confirmed = await confirmDialog.confirm({
      title: "Release Reserved Stock",
      message: `This returns any stock received for ${selectedQuote.quote_no}'s procurement back to the general available pool, so other customers can purchase it. Continue?`,
      confirmText: "Release Reservation",
      confirmColor: "warning",
    });
    if (!confirmed) return;
    setReleasingReservation(true);
    try {
      const result = await quotationApi.releaseReservation(selectedQuote.id);
      showSuccessToast(result.message);
      queryClient.invalidateQueries({ queryKey: ["sales-quote-procurement-summary", selectedQuote.id] });
      queryClient.invalidateQueries({ queryKey: ["sales-quote-details", selectedQuote.id] });
    } catch (err: unknown) {
      showErrorToast(handleApiError(err as Error, "Failed to release reservation"));
    } finally {
      setReleasingReservation(false);
    }
  }, [selectedQuote, confirmDialog, queryClient]);

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

  // Items already queued (supplier chosen, no PO yet) for this quote — kept
  // out of the candidate list so the same line can't be queued twice.
  const { data: procurementQueue = [] } = useQuery({
    queryKey: ["procurementQueue"],
    queryFn: procurementQueueApi.list,
  });
  const queuedQuoteItemIds = useMemo(
    () => new Set(procurementQueue.map(q => q.quote_item_id)),
    [procurementQueue],
  );

  // Items on the quotation that still need procurement — the candidate set
  // for the Create Purchase Orders (multi-supplier) workflow. Only items
  // actually short of stock (not already in_stock / covered by a transfer)
  // belong here — everything else doesn't need a PO at all.
  const procurementCandidates = useMemo((): ProcurementCandidate[] => {
    if (!selectedQuoteDetails?.items) return [];
    return selectedQuoteDetails.items
      .filter(item => !['completed', 'cancelled', 'so_created', 'po_created', 'itn_created'].includes(item.item_status))
      .filter(item => !queuedQuoteItemIds.has(item.id))
      .filter(item => {
        // Prefer a live stock check result; fall back to the stored value.
        const liveStock = stockAvailability.find(sa => sa.product_id === item.product_id);
        const stockStatus = liveStock
          ? (liveStock.is_sufficient ? 'in_stock'
              : (liveStock.other_branches && liveStock.other_branches.length > 0) ? 'needs_transfer'
              : 'needs_procurement')
          : item.stock_status;
        return stockStatus === 'needs_procurement';
      })
      .map(item => {
        const product = products.find(p => p.id === item.product_id);
        const remaining = item.quantity - (item.converted_qty || 0);
        // Partial availability: only the shortfall needs to be purchased —
        // e.g. customer wants 100, 40 already in stock, so only 60 to buy.
        const liveStock = stockAvailability.find(sa => sa.product_id === item.product_id);
        const toPurchase = liveStock
          ? liveStock.to_purchase_quantity
          : Math.max(remaining, 0);
        return {
          quote_item_id: item.id,
          product_id: item.product_id,
          product_name: product?.name || `Product #${item.product_id}`,
          quantity: toPurchase > 0 ? toPurchase : (remaining > 0 ? remaining : item.quantity),
          unit_price: product?.cost_price ?? Number(item.selling_price),
          warrenty_month: item.warrenty_month || "0",
        };
      })
      .filter(item => item.quantity > 0);
  }, [selectedQuoteDetails, products, queuedQuoteItemIds, stockAvailability]);

  const [supplierSelectionOpen, setSupplierSelectionOpen] = useState(false);

  const handleOpenCreatePurchaseOrders = useCallback(() => {
    if (!selectedQuote) return;
    setSupplierSelectionOpen(true);
  }, [selectedQuote]);

  const handleSupplierSelectionContinue = useCallback(
    async (selections: SupplierSelection[]) => {
      if (!selectedQuote || selections.length === 0) return;
      try {
        await procurementQueueApi.add(
          selections.map(s => ({
            quote_item_id: s.quote_item_id,
            supplier_id: s.supplier_id,
            quantity: s.quantity,
            unit_price: s.unit_price,
          })),
        );
        queryClient.invalidateQueries({ queryKey: ["procurementQueue"] });
        setSupplierSelectionOpen(false);
        showSuccessToast("Added to the Procurement Queue — select suppliers there to create purchase orders.");
      } catch (err: unknown) {
        showErrorToast(handleApiError(err, "Failed to queue items for procurement"));
      }
    },
    [selectedQuote, queryClient],
  );

  // Create a Sales Order for whichever items the live stock check just
  // confirmed have real physical stock at this branch right now —
  // current_branch_available comes straight from the sales_stock table, so
  // this can't be fooled by an item merely having a PO/ITN in progress with
  // nothing actually received yet.
  const handleCreatePartialSO = useCallback(async () => {
    if (!selectedQuote || !selectedQuoteDetails?.items) return;

    const itemsToConvert = stockAvailability
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

    if (itemsToConvert.length === 0) {
      showErrorToast("No items with available stock to convert to a Sales Order.");
      return;
    }

    setPartialSOSubmitting(true);
    try {
      await quotationApi.createPartialSO(selectedQuote.id, { items: itemsToConvert });
      queryClient.invalidateQueries({ queryKey: ["sales-quotes"] });
      queryClient.invalidateQueries({ queryKey: ["sales-quote-details", selectedQuote.id] });
      showSuccessToast(`Sales Order created from ${selectedQuote.quote_no}.`);
      setStockCheckDialogOpen(false);
      setPartialQtyMap({});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create Sales Order";
      showErrorToast(msg);
    } finally {
      setPartialSOSubmitting(false);
    }
  }, [selectedQuote, selectedQuoteDetails, stockAvailability, partialQtyMap, queryClient]);

  const handleCancelItemSubmit = useCallback(async () => {
    if (!cancelItemTarget) return;
    setCancelItemLoading(true);
    try {
      await quotationApi.cancelItem(cancelItemTarget.quoteId, cancelItemTarget.itemId, cancelItemReason || undefined);
      queryClient.invalidateQueries({ queryKey: ["sales-quotes"] });
      queryClient.invalidateQueries({ queryKey: ["sales-quote-details", cancelItemTarget.quoteId] });
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

    navigate("/sales/orders", {
      state: {
        fromQuotation: true,
        createNew: true,
        quoteId: selectedQuote.id,
        quoteNo: selectedQuote.quote_no,
        customerId: selectedQuote.customer_id,
        customer_agent_id: selectedQuote.customer_agent_id,
        branchCode: selectedQuote.branch_code,
        remarks: `SO from Quotation ${selectedQuote.quote_no}`,
        items: itemsForSO,
        taxMode: selectedQuote.tax_mode ?? taxMode,
        taxRate: selectedQuote.tax_rate ?? effectiveTaxRate,
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

    // Mark as sent — only once the quote has cleared internal approval
    // (same `approval` gate as create_po/create_so below). "Sent" is not a
    // status value at all (see submitted_date), so this doesn't need to
    // special-case an already-"sent" status the way it used to.
    if (selectedQuote.approval && !['rejected', 'cancelled', 'revised'].includes(s)) actions.push('send');
    // Check stock — allowed for any non-terminal status
    if (!['completed', 'cancelled'].includes(s)) actions.push('check_stock');
    // Create PO / SO — only once the quotation has been approved. `approval`
    // (not `status`) is the gate: once some items are converted the header
    // status moves on to partially_processed, but `approval` stays true from
    // the original sign-off.
    const isApprovedAndActive =
      selectedQuote.approval && !['rejected', 'cancelled', 'revised'].includes(s);
    if (isApprovedAndActive) actions.push('create_po');
    if (isApprovedAndActive) actions.push('create_so');
    // Cancel — allowed from any non-final status
    if (!['completed', 'cancelled'].includes(s)) actions.push('cancel');
    // Revise — creates a new draft copy and marks this one "revised", so
    // exclude statuses where that would make no sense (already revised/
    // converted/cancelled/completed).
    if (!['revised', 'so_created', 'cancelled', 'completed'].includes(s)) actions.push('revise');

    return actions;
  }, [selectedQuote, isCreating, isEditing]);

  const handleCreateRevision = useCallback(async () => {
    if (!selectedQuote) return;
    const confirmed = await confirmDialog.confirm({
      title: "Create Revision",
      message: `This creates a new draft copy of ${selectedQuote.quote_no} for you to edit, and marks this quotation as "Revised". Continue?`,
      confirmText: "Create Revision",
    });
    if (confirmed) {
      createRevisionMutation.mutate(selectedQuote.id);
    }
  }, [selectedQuote, confirmDialog, createRevisionMutation]);


  // Handlers
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

    // Cancelling out of "New Quote" should return to the browse table, not
    // auto-open the first quote the way useMasterDetailState's generic
    // handleCancel does (that made sense for the old always-visible detail
    // panel, but not here). Cancelling out of editing an existing quote
    // still just reverts its form, which the generic handler already does
    // correctly.
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedQuote(null);
    } else {
      baseHandleCancel(filteredQuotes);
    }
    setLineItems([]);
    setTaxMode("none");
    setTaxRate(0);
  }, [baseHandleCancel, filteredQuotes, isEditing, isCreating, hasChanges, confirmDialog, setIsCreating, setIsEditing, setSelectedQuote]);

  // Returns to the browse table from the detail view.
  const handleBackToQuotes = useCallback(() => {
    setSelectedQuote(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
    setLineItems([]);
    setTaxMode("none");
    setTaxRate(0);
  }, [isCreating, setSelectedQuote, setIsCreating, setIsEditing]);

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
      price_tier_id: item.price_tier_id,
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
    setLineItems(
      [
        ...lineItems,
        {
          product_id: 0,
          quantity: 1,
          selling_price: 0,
          minimum_selling_price: 0,
          warrenty_month: "",
          is_price_estimate: formData.quote_type === "quotation",
          discount_percent: 0,
          tax_rate: 0,
          price_tier_id: undefined,
        },
      ]
    );
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
        setLineItems(prev => {
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            product_id: value as number,
            price_tier_id: undefined,
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
  const canEditQuote = !["completed", "cancelled"].includes(selectedQuote?.status || "");
  const canDeleteQuoteStatus = !["completed", "cancelled"].includes(selectedQuote?.status || "");

  // Whether we're showing a single quote's detail view (selected or being
  // created) instead of the browse table.
  const isQuoteDetailMode = !!selectedQuote || isCreating;

  // The table sorts by whichever column the user clicks; the Customer
  // column displays a looked-up name rather than the raw customer_id, so it
  // needs that name as its own field for the grid to sort on correctly.
  const quoteRows = useMemo(
    () =>
      filteredQuotes.map((quote) => ({
        ...quote,
        customer_display_name: getCustomerName(quote.customer_id),
        agent_display_name: quote.customer_agent_id ? getCustomerName(quote.customer_agent_id) : "",
        branch_display_name: getBranchName(quote.branch_code),
      })),
    [filteredQuotes, customers] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Browse mode: a full-width table of every quote. Sorting is done
  // per-column via the grid's own column header menu, not a separate
  // "Sort by" control.
  const quoteColumns: TDataGridColumn<(typeof quoteRows)[number]>[] = useMemo(
    () => [
      { field: "quote_no", header: "Quote No", width: 150 },
      { field: "customer_display_name", header: "Customer", flex: 1, minWidth: 180 },
      { field: "branch_display_name", header: "Branch", width: 130 },
      { field: "agent_display_name", header: "Sales Agent", width: 160 },
      {
        field: "created_date",
        header: "Date",
        width: 130,
        renderCell: (params: GridRenderCellParams<(typeof quoteRows)[number]>) => (
          <TDate value={params.row.created_date_time || params.row.created_date} format="short" />
        ),
      },
      {
        field: "valid_until",
        header: "Valid Until",
        width: 130,
        renderCell: (params: GridRenderCellParams<(typeof quoteRows)[number]>) => (
          <TDate value={params.row.valid_until} format="short" />
        ),
      },
      {
        field: "status",
        header: "Status",
        width: 150,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<(typeof quoteRows)[number]>) => (
          <TStatusChip status={params.row.status} statusMap="quoteStatus" size="small" />
        ),
      },
      {
        field: "total_amount",
        header: "Total",
        width: 140,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<(typeof quoteRows)[number]>) => (
          <TCurrency value={params.row.total_amount} />
        ),
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<(typeof quoteRows)[number]>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectQuote(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [handleSelectQuote]
  );

  const quoteTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid
          rows={quoteRows}
          columns={quoteColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectQuote(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No quotes found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Render detail panel
  const renderDetailPanel = () => {
    return (
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <DetailPanelHeader
          breadcrumbs={[
            { label: "Sales" },
            { label: "Quotations", href: "/sales/quotations" },
            ...(selectedQuote || isCreating
              ? [{ label: isCreating ? "New Quotation" : selectedQuote?.quote_no || "" }]
              : []),
          ]}
          title={selectedQuote ? selectedQuote.quote_no : ""}
          titleIcon={<QuoteIcon color="primary" />}
          isCreating={isCreating}
          createTitle="New Quotation"
          noSelectionTitle="Select a Quotation"
          chips={
            selectedQuote
              ? (() => {
                const s = getStatusProps(selectedQuote.status || "draft", "quoteStatus");
                return [{ label: s.label, color: s.color }];
              })()
              : []
          }
        />

        <ActionToolbar
          canCreate={canCreate}
          canDelete={canDelete && canDeleteQuoteStatus}
          canUpdate={canUpdate && canEditQuote}
          isEditing={isEditing}
          isCreating={isCreating}
          hasSelection={!!selectedQuote}
          onAdd={handleNewQuote}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onSave={undefined}
          onCancel={undefined}
          isSaving={createMutation.isPending || updateMutation.isPending}
          endActions={
            isCreating || isEditing ? (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Button
                  size="small"
                  variant="contained"
                  color="error"
                  onClick={handleDiscardChanges}
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  startIcon={<SaveIcon />}
                  onClick={handleSave}
                  disabled={
                    createMutation.isPending ||
                    updateMutation.isPending ||
                    !formData.customer_id ||
                    !formData.branch_code ||
                    !formData.valid_until ||
                    lineItems.length === 0
                  }
                >
                  {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </Box>
            ) : selectedQuote && !isCreating && !isEditing ? (
              <Box sx={{ display: "flex", gap: 0.5, alignItems: "center", flexWrap: "wrap" }}>
                {/* Workflow Action Buttons */}
                {getAvailableActions().includes('send') && (
                  <Tooltip title="Mark as Sent to Customer">
                    <Button size="small" variant="contained" color="primary" startIcon={<SendIcon />}
                      onClick={() => markSentMutation.mutate(selectedQuote.id)}
                      disabled={markSentMutation.isPending}>
                      {selectedQuote.submitted_date ? '✓ Sent' : 'Mark Sent'}
                    </Button>
                  </Tooltip>
                )}
                {getAvailableActions().includes('check_stock') && (
                  <Tooltip title="Check Stock Availability">
                    <Button size="small" variant="contained" color="primary" startIcon={<StockIcon />}
                      onClick={handleCheckStock}>
                      Stock
                    </Button>
                  </Tooltip>
                )}
                {getAvailableActions().includes('create_po') &&
                  stockCheckedQuoteId === selectedQuote.id &&
                  hasItemsNeedingPO && (
                  <Tooltip title="Select suppliers and create purchase orders for unavailable items">
                    <Button size="small" variant="contained" color="primary" startIcon={<POIcon />}
                      onClick={handleOpenCreatePurchaseOrders}>
                      Create PO
                    </Button>
                  </Tooltip>
                )}
                {stockCheckedQuoteId === selectedQuote.id && hasItemsInOtherBranches && (
                  <Tooltip title="Create ITN for items available in other branches">
                    <Button size="small" variant="contained" color="primary" startIcon={<WarehouseIcon />}
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
                      Create SO
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
                {getAvailableActions().includes('revise') && (
                  <Tooltip title="Create an editable draft revision of this quotation">
                    <Button size="small" variant="outlined" color="primary" startIcon={<RevisionIcon />}
                      onClick={handleCreateRevision}
                      disabled={createRevisionMutation.isPending}>
                      Create Revision
                    </Button>
                  </Tooltip>
                )}
                {/* Customer advance — only once the quotation is approved */}
                <Tooltip title={selectedQuote.status !== "draft" && !canPrintDocument(selectedQuote.status, ["cancelled"]) ? `Cannot email: quotation is ${(selectedQuote.status || "").replace(/_/g, " ")}` : "Send via Email"}>
                  <span>
                    <Button size="small" variant="outlined" color="primary" startIcon={<EmailIcon />}
                      disabled={selectedQuote.status !== "draft" && !canPrintDocument(selectedQuote.status, ["cancelled"])}
                      onClick={() => setEmailDialogOpen(true)}>
                      Email
                    </Button>
                  </span>
                </Tooltip>
                <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                <TPrintButton
                  documentType="quotation"
                  documentId={selectedQuote.id}
                  disabled={selectedQuote.status !== "draft" && !canPrintDocument(selectedQuote.status, ["cancelled"])}
                  disabledReason={selectedQuote.status === "cancelled" ? "Cannot print: quotation is cancelled" : `Cannot print: quotation is ${(selectedQuote.status || "").replace(/_/g, " ")}`}
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

        {/* Related Purchase Orders (from the Sales Quotation -> PO workflow) */}
        {(selectedQuoteDetails?.related_purchase_orders?.length ?? 0) > 0 && (
          <FormSection title="Related Purchase Orders" columns={1}>
            <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={modernTableStyles.headerRow}>
                    <TableCell>PO Number</TableCell>
                    <TableCell>Supplier</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Ordered Qty</TableCell>
                    <TableCell align="right">Received Qty</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {selectedQuoteDetails!.related_purchase_orders.map((po) => (
                    <TableRow
                      key={po.id}
                      hover
                      sx={{ ...modernTableStyles.bodyRow, cursor: "pointer" }}
                      onClick={() =>
                        navigate("/purchasing/orders", {
                          state: { fromQuotation: true, purchaseOrderId: po.id, purchaseOrderNo: po.purchasing_order_no },
                        })
                      }
                    >
                      <TableCell>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                          <POIcon fontSize="small" color="primary" />
                          {po.purchasing_order_no}
                        </Box>
                      </TableCell>
                      <TableCell>{po.supplier_name || "Unknown supplier"}</TableCell>
                      <TableCell>
                        <TStatusChip status={po.status} statusMap="purchaseOrder" />
                      </TableCell>
                      <TableCell align="right">{po.ordered_quantity}</TableCell>
                      <TableCell align="right">{po.received_quantity}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>
          </FormSection>
        )}

        {/* Line Items */}
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1, mt: 2 }}>
          <Typography variant="subtitle1" fontWeight="bold">Quote Items</Typography>
        </Box>

        <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={modernTableStyles.headerRow}>
                <TableCell sx={{ minWidth: 200 }}>Product</TableCell>
                <TableCell align="right" sx={{ width: 100 }}>Quantity</TableCell>
                <TableCell align="right" sx={{ width: 120 }}>Unit Price ({currencySymbol})</TableCell>
                <TableCell align="right" sx={{ width: 90 }}>Discount</TableCell>
                <TableCell sx={{ width: 100 }}>Warranty</TableCell>
                <TableCell align="center" sx={{ width: 140 }}>Item Status</TableCell>
                <TableCell align="right" sx={{ width: 120 }}>Amount ({currencySymbol})</TableCell>
                {canViewCost && (
                  <TableCell align="right" sx={{ width: 90 }}>Margin</TableCell>
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {selectedQuoteDetails?.items && selectedQuoteDetails.items.length > 0 ? (
                selectedQuoteDetails.items.map((item, index) => {
                  const product = products?.find(p => p.id === item.product_id);
                  // Prefer live stock check result; fall back to stored stock_status from DB
                  const liveStock = stockAvailability.find(sa => sa.product_id === item.product_id);
                  // Derive stock status: live check overrides stored value
                  const stockStatus = liveStock
                    ? (liveStock.is_sufficient ? 'in_stock'
                        : (liveStock.other_branches && liveStock.other_branches.length > 0) ? 'needs_transfer'
                        : 'needs_procurement')
                    : item.stock_status;
                  const itemStatus = item.item_status ?? 'pending';
                  return (
                    <TableRow key={index} sx={{
                      ...modernTableStyles.bodyRow,
                      ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                      ...(itemStatus === 'cancelled' && { opacity: 0.5 }),
                    }}>
                      <TableCell>{product?.name || `Product #${item.product_id}`}</TableCell>
                      <TableCell align="right">{item.quantity}</TableCell>
                      <TableCell align="right"><TCurrency value={Number(item.selling_price)} showSymbol={false} /></TableCell>
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
                            <TChip label="SO Created" color="success" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          ) : itemStatus === 'po_created' ? (
                            <TChip label="PO Created" color="info" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          ) : itemStatus === 'itn_created' ? (
                            <TChip label="ITN Created" color="info" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          ) : itemStatus === 'procurement' ? (
                            // PO/ITN in progress — show what was initiated
                            stockStatus === 'needs_transfer'
                              ? <TChip label="Transfer Available" color="secondary" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                              : <TChip label="Need PO" color="warning" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          ) : itemStatus === 'cancelled' ? (
                            <TChip label="Cancelled" color="default" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          ) : (
                            // Pending — show based on stock availability
                            stockStatus === 'needs_transfer'
                              ? <TChip label="Transfer Available" color="secondary" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                              : stockStatus === 'needs_procurement'
                                ? <TChip label="Need PO" color="warning" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                                : stockStatus === 'in_stock'
                                  ? <TChip label="Need SO" color="info" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                                  : <TChip label="Need SO" color="info" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          )}
                        </Box>
                      </TableCell>
                      <TableCell align="right">
                        <TCurrency value={item.quantity * Number(item.selling_price) * (1 - (item.discount_percentage || 0) / 100)} showSymbol={false} />
                      </TableCell>
                      {canViewCost && (() => {
                        const cost = product?.cost_price ?? 0;
                        const lineSelling = item.quantity * Number(item.selling_price) * (1 - (item.discount_percentage || 0) / 100);
                        const lineCost = item.quantity * cost;
                        const pct = marginPercent(lineSelling, lineCost);
                        return (
                          <TableCell align="right">
                            <Typography variant="body2" color={pct >= 0 ? "success.main" : "error.main"}>
                              {pct.toFixed(0)}%
                            </Typography>
                          </TableCell>
                        );
                      })()}
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={canViewCost ? 8 : 7} sx={modernTableStyles.emptyCell}>
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
                  <Typography fontWeight="bold"><TCurrency value={calculateTotal()} showSymbol={false} /></Typography>
                </TableCell>
                {canViewCost && (() => {
                  const totalCost = (selectedQuoteDetails?.items || []).reduce((sum, item) => {
                    const cost = products?.find(p => p.id === item.product_id)?.cost_price ?? 0;
                    return sum + item.quantity * cost;
                  }, 0);
                  const pct = marginPercent(calculateTotal(), totalCost);
                  return (
                    <TableCell align="right">
                      <Typography fontWeight="bold" color={pct >= 0 ? "success.main" : "error.main"}>
                        {pct.toFixed(1)}%
                      </Typography>
                    </TableCell>
                  );
                })()}
              </TableRow>
            </TableBody>
          </Table>
        </Paper>

        {/* Procurement / Inventory traceability — required vs. ordered vs.
            received vs. reserved vs. available vs. outstanding per item */}
        {(procurementSummary?.items?.length ?? 0) > 0 && (
          <FormSection
            title="Procurement & Stock Reservation"
            columns={1}
            sx={{ mt: 2 }}
            titleAction={
              <Button
                size="small"
                color="warning"
                variant="outlined"
                disabled={releasingReservation || !procurementSummary!.items.some(i => i.reserved_quantity > 0)}
                onClick={handleReleaseReservation}
              >
                {releasingReservation ? "Releasing..." : "Release Reservation"}
              </Button>
            }
          >
            <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={modernTableStyles.headerRow}>
                    <TableCell sx={{ minWidth: 180 }}>Product</TableCell>
                    <TableCell align="right">Required</TableCell>
                    <TableCell align="right">Ordered</TableCell>
                    <TableCell align="right">Received</TableCell>
                    <TableCell align="right">Reserved</TableCell>
                    <TableCell align="right">Available</TableCell>
                    <TableCell align="right">Outstanding</TableCell>
                    <TableCell align="right">To Purchase</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {procurementSummary!.items.map((row) => (
                    <TableRow key={row.item_id} sx={modernTableStyles.bodyRow}>
                      <TableCell>{row.product_name || `Product #${row.product_id}`}</TableCell>
                      <TableCell align="right">{row.required_quantity}</TableCell>
                      <TableCell align="right">{row.ordered_quantity}</TableCell>
                      <TableCell align="right">{row.received_quantity}</TableCell>
                      <TableCell align="right">
                        {row.reserved_quantity > 0
                          ? <TChip label={row.reserved_quantity} color="warning" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          : row.reserved_quantity}
                      </TableCell>
                      <TableCell align="right">{row.available_quantity}</TableCell>
                      <TableCell align="right">
                        {row.outstanding_quantity > 0
                          ? <TChip label={row.outstanding_quantity} color="info" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          : 0}
                      </TableCell>
                      <TableCell align="right">
                        {row.to_purchase_quantity > 0
                          ? <TChip label={row.to_purchase_quantity} color="warning" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          : 0}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>
          </FormSection>
        )}

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


        <Divider sx={{ my: 2 }} />
        <FormSection title="Notes" columns={2}>
          <TRemarkField
            label="Internal Remarks"
            value={quote.remarks || ""}
            onChange={() => {}}
            disabled
            multiline
            rows={2}
            size="small"
          />
          <TRemarkField
            label="Customer Notes (shown on printed document)"
            value={quote.customer_notes || ""}
            onChange={() => {}}
            disabled
            multiline
            rows={2}
            size="small"
          />
        </FormSection>

        {/* Advance Payment */}
        {quote.advance_payment_id && (
          <>
            <Divider sx={{ my: 2 }} />
            <FormSection title="Advance Payment">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <TChip
                  label="Advance Paid"
                  color="success"
                  size="small"
                />
                <Typography variant="body2" color="text.secondary">
                  Advance #{quote.advance_payment_id}
                </Typography>
                {quote.advance_amount && (
                  <TChip
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
                <TChip
                  label={`Converted to Invoice #${quote.converted_to_invoice_id}`}
                  color="success"
                  variant="outlined"
                />
              </FormSection>
            </>
          )
        }

        <Divider sx={{ my: 2 }} />
        <FormSection
          title="Activity History"
          columns={2}
          titleAction={
            <Tooltip title="View activity history">
              <IconButton size="small" onClick={() => setActivityHistoryOpen(true)}>
                <HistoryIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          }
        >
          <Box>
            <Typography variant="caption" color="text.secondary">Created By</Typography>
            <Typography variant="body2">
              {/* created_by_name/updated_by_name are only stamped on the
                  single-quote GET (see SalesQuoteService._attach_user_names)
                  — the list response `quote` never carries them. */}
              {selectedQuoteDetails?.created_by_name || "-"}
              {(quote.created_date_time || quote.created_date)
                ? ` on ${formatDateTimeReadable(quote.created_date_time || quote.created_date)}`
                : ""}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Last Modified By</Typography>
            <Typography variant="body2">
              {selectedQuoteDetails?.updated_by_name || "-"}
              {selectedQuoteDetails?.updated_at ? ` on ${formatDateTimeReadable(selectedQuoteDetails.updated_at)}` : ""}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Approved By</Typography>
            <Typography variant="body2">
              {selectedQuoteDetails?.approved_by_name || quote.approved_by_name || "-"}
            </Typography>
          </Box>
        </FormSection>
      </>
    );
  };

  // Render form content (without header/toolbar)
  const renderFormContent = () => {
    return (
      <>

        {/* Quote Information */}
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
                getOptionLabel={(option) => customerDisplayName(option)}
                value={customers?.find((c) => c.id === formData.customer_id) || null}
                onChange={(_, newValue) => setFormData({ ...formData, customer_id: newValue?.id || 0 })}
                renderInput={(params) => (
                  <TextField {...params} label="Customer" required />
                )}
              />

              <TextField
                label="Valid Until"
                type="date"
                value={formData.valid_until || ""}
                onChange={(e) => setFormData({ ...formData, valid_until: e.target.value })}
                size="small"
                InputLabelProps={{ shrink: true }}
                inputProps={{ min: format(new Date(), "yyyy-MM-dd") }}
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
              <TRemarkField
                label="Internal Remarks"
                value={formData.remarks || ""}
                onChange={(value) => setFormData({ ...formData, remarks: value })}
                multiline
                rows={2}
                size="small"
              />
              <TRemarkField
                label="Customer Notes (shown on printed document)"
                value={formData.customer_notes || ""}
                onChange={(value) => setFormData({ ...formData, customer_notes: value })}
                multiline
                rows={2}
                size="small"
              />
            </FormSection>
        </>

        {/* Quote Items */}
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
                      <TableCell align="right" sx={{ width: 130 }}>Price ({currencySymbol})</TableCell>
                      <TableCell align="right" sx={{ width: 110 }}>Disc %</TableCell>
                      <TableCell align="right" sx={{ width: 110 }}>Warranty (Months)</TableCell>
                      {formData.quote_type === "quotation" && (
                        <TableCell align="right" sx={{ width: 130 }}>Min Price ({currencySymbol})</TableCell>
                      )}
                      <TableCell align="right" sx={{ width: 120 }}>Total ({currencySymbol})</TableCell>
                      {canViewCost && (
                        <TableCell align="right" sx={{ width: 90 }}>Margin</TableCell>
                      )}
                      <TableCell align="center" sx={{ width: 60 }}>Del</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {lineItems.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
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
                          </Box>
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
                        {canViewCost && (() => {
                          const cost = products?.find((p) => p.id === item.product_id)?.cost_price ?? 0;
                          const lineSelling = item.quantity * item.selling_price * (1 - (item.discount_percent || 0) / 100);
                          const lineCost = item.quantity * cost;
                          const pct = marginPercent(lineSelling, lineCost);
                          return (
                            <TableCell align="right">
                              <Typography variant="body2" color={pct >= 0 ? "success.main" : "error.main"} noWrap>
                                {pct.toFixed(0)}%
                              </Typography>
                            </TableCell>
                          );
                        })()}
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
                        <TChip
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
                {canViewCost && (
                  <Typography variant="body2" color="text.secondary">
                    Margin: {marginPercent(calculateLineItemsTotal(), calculateLineItemsCostTotal()).toFixed(1)}%
                  </Typography>
                )}
              </Box>
            </Paper >
        </>
      </>
    );
  };

  return (
    <>
      <MasterDetailLayout
        title={pageTitle}
        titleSlot={
          isQuoteDetailMode ? (
            <Button
              size="small"
              startIcon={<ArrowBackIcon fontSize="small" />}
              onClick={handleBackToQuotes}
              sx={{ textTransform: "none" }}
            >
              Back to Quotations
            </Button>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search quotes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                }}
                sx={{ width: 190, flexShrink: 0 }}
              />
              <Box sx={{ width: 150, flexShrink: 0 }}>
                <TStatusFilter
                  options={QUOTATION_STATUS_FILTER_OPTIONS}
                  value={filterStatus}
                  onChange={setFilterStatus}
                  label=""
                  placeholder="All Status"
                  size="small"
                />
              </Box>
              <Box sx={{ width: 150, flexShrink: 0 }}>
                <TBranchFilter branches={branches} value={filterBranch} onChange={setFilterBranch} label="" placeholder="All Branches" size="small" />
              </Box>
              <Autocomplete
                size="small"
                options={customers || []}
                getOptionLabel={(option) => customerDisplayName(option)}
                value={customers?.find((c) => c.id === filterCustomerId) || null}
                onChange={(_, newValue) => setFilterCustomerId(newValue?.id || null)}
                renderInput={(params) => <TextField {...params} placeholder="All Customers" />}
                sx={{ width: 170, flexShrink: 0 }}
              />
              <TextField
                size="small"
                type="date"
                label="From"
                InputLabelProps={{ shrink: true }}
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                sx={{ width: 130, flexShrink: 0 }}
              />
              <TextField
                size="small"
                type="date"
                label="To"
                InputLabelProps={{ shrink: true }}
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                sx={{ width: 130, flexShrink: 0 }}
              />
              {(searchQuery || filterStatus || filterBranch || filterCustomerId || filterDateFrom || filterDateTo) && (
                <Button size="small" onClick={handleClearFilters} sx={{ textTransform: "none" }}>
                  Clear
                </Button>
              )}
            </Box>
          )
        }
        headerActions={
          isQuoteDetailMode ? undefined : (
            <>
              {canCreate && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={handleNewQuote}
                  sx={{ mr: 1 }}
                >
                  New Quotation
                </Button>
              )}
            </>
          )
        }
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ["sales-quotes", pageQuoteType] });
          queryClient.invalidateQueries({ queryKey: ["sales-quote-details"] });
        }}
        isLoading={isLoading}
        {...(isQuoteDetailMode
          ? { children: renderDetailPanel() }
          : { children: quoteTablePanel })}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />

      {/* Email Dialog */}
      {selectedQuote && (
        <TEmailDialog
          open={emailDialogOpen}
          onClose={() => setEmailDialogOpen(false)}
          documentType="quotation"
          documentId={selectedQuote.id}
        />
      )}

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
                                <TChip key={`${item.product_id}-${b.branch_code}`} label={`${b.branch_code}: ${b.available_quantity}`} size="small" />
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
                            <TChip label="In Stock" color="success" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          ) : stockStatus === 'in_stock' ? (
                            <TChip label="In Stock" color="success" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          ) : (
                            <TChip label="Out of Stock" color="error" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          )}
                        </TableCell>
                        {/* Item Status */}
                        <TableCell align="center">
                          {itemStatus === 'so_created' || itemStatus === 'completed' ? (
                            <TChip label="SO Created" color="success" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          ) : itemStatus === 'po_created' ? (
                            <TChip label="PO Created" color="info" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          ) : itemStatus === 'itn_created' ? (
                            <TChip label="ITN Created" color="info" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          ) : itemStatus === 'procurement' ? (
                            stockStatus === 'needs_transfer'
                              ? <TChip label="Transfer Available" color="secondary" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                              : <TChip label="Need PO" color="warning" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          ) : itemStatus === 'cancelled' ? (
                            <TChip label="Cancelled" color="default" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          ) : (
                            stockStatus === 'needs_transfer'
                              ? <TChip label="Transfer Available" color="secondary" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                              : stockStatus === 'needs_procurement'
                                ? <TChip label="Need PO" color="warning" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                                : <TChip label="Need SO" color="info" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
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
        <DialogActions>
          <Button onClick={() => setStockCheckDialogOpen(false)}>Close</Button>
          <Button
            variant="contained"
            onClick={handleCreatePartialSO}
            disabled={stockCheckLoading || partialSOSubmitting || !stockAvailability.some(sa => (sa.current_branch_available || 0) > 0)}
          >
            {partialSOSubmitting ? "Creating..." : "Create Sales Order"}
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

      <TActivityHistoryPanel
        open={activityHistoryOpen}
        onClose={() => setActivityHistoryOpen(false)}
        entityType="sales_quote"
        entityId={selectedQuote?.id}
        actionLabels={{
          create: "Quote created",
          update: "Quote updated",
          status_change: "Status changed",
          approve: "Quote approved",
          reject: "Quote rejected",
          convert: "Converted to invoice",
          release_reservation: "Stock reservation released",
          delete: "Quote deleted",
        }}
      />

      <SupplierSelectionDialog
        open={supplierSelectionOpen}
        candidates={procurementCandidates}
        onClose={() => setSupplierSelectionOpen(false)}
        onContinue={handleSupplierSelectionContinue}
      />
    </>
  );
}
