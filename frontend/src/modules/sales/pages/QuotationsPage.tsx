/**
 * QuotationsPage - Refactored to use Tijaero-style reusable components
 */

import { usePermission } from "@/auth/permissions";
import {
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  FormSection,
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  showErrorToast,
  showSuccessToast,
  SortOption,
  TBranchFilter,
  TCurrency,
  TDate,
  TFilterPanel,
  TStatusChip,
  useMasterDetailState,
  useTConfirmDialog
} from "@/components/tijaero";
import { ERP_CURRENCY_SYMBOL } from "@/utils/formatters";
import { branchApi } from "@/modules/branches/api";
import { customersApi } from "@/modules/customers/api";
import { productsApi } from "@/modules/inventory/api";
import {
  Add as AddIcon,
  CheckCircle as ApproveIcon,
  Cancel as CancelIcon,
  Transform as ConvertIcon,
  Delete as DeleteIcon,
  Print as PrintIcon,
  Description as QuoteIcon,
  Refresh as ReviseIcon,
  Send as SendIcon
} from "@mui/icons-material";
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Divider,
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
  Typography
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { quotationApi } from "../quotation-api";
import {
  QUOTE_TYPE_LABELS,
  QuoteType,
  SalesQuote,
  SalesQuoteCreate,
  SalesQuoteItemCreate
} from "../quotation-types";

// Configuration
const SORT_OPTIONS: SortOption[] = [
  { value: "created_date", label: "Date (Newest)" },
  { value: "quote_no", label: "Quote No" },
  { value: "total_amount", label: "Total Amount" },
  { value: "valid_until", label: "Validity" },
];

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
  sale_rep_id: 1,
  valid_until: format(addDays(new Date(), 30), "yyyy-MM-dd"),
  is_estimate: quoteType === "quotation",
  payment_terms: "",
  delivery_terms: "",
  remarks: "",
  customer_notes: "",
  discount_type: "none",
  discount_value: 0,
  special: false,
  items: [],
});

export default function QuotationsPage() {
  const queryClient = useQueryClient();

  // No tabs, show all types

  // Line items state
  const [lineItems, setLineItems] = useState<ItemFormData[]>([]);

  // Filter states
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  // Permissions
  const canCreate = usePermission("sales", "create");
  const canDelete = usePermission("sales", "delete");
  const canUpdate = usePermission("sales", "update");
  const canApprove = usePermission("sales", "approve");

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
    formData,
    setFormData,
    handleSelectItem: handleSelectQuote,
    handleNew: handleNewQuote,
    handleCancel: baseHandleCancel,
    handleStartEdit,
  } = useMasterDetailState<SalesQuote, Partial<SalesQuoteCreate>>({
    initialFormData: getEmptyQuoteForm("quotation"),
    resetFormFromItem: (quote) => quote,
    favoritesKey: "quotations_favorites",
    defaultSortField: "created_date",
  });

  // Confirm dialogs
  const confirmDialog = useTConfirmDialog();

  // Data fetching
  const { data: quotesData, isLoading } = useQuery({
    queryKey: ["sales-quotes"],
    queryFn: () => quotationApi.getAll({}),
  });

  const { data: customers } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.getAll(),
  });

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => productsApi.getAll(),
  });

  const { data: branchesData } = useQuery({
    queryKey: ["branches"],
    queryFn: () => branchApi.getAll(1, 100),
  });

  const branches = branchesData?.items || [];

  // Filter and sort
  const filteredQuotes = useMemo(() => {
    const quotes = quotesData?.items || [];
    let filtered = quotes.filter(
      (quote) =>
        quote.quote_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
        quote.branch_code.toLowerCase().includes(searchQuery.toLowerCase())
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
      queryClient.invalidateQueries({ queryKey: ["sales-quotes"] });
      handleSelectQuote(newQuote);
      setIsCreating(false);
      setLineItems([]);
      showSuccessToast(`${QUOTE_TYPE_LABELS[newQuote.quote_type]} created successfully`);
    },
    onError: (error: Error) => {
      showErrorToast(`Failed to create: ${error.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<SalesQuoteCreate> }) =>
      quotationApi.update(id, data),
    onSuccess: (updatedQuote) => {
      queryClient.invalidateQueries({ queryKey: ["sales-quotes"] });
      handleSelectQuote(updatedQuote);
      setIsEditing(false);
      setLineItems([]);
      showSuccessToast("Quote updated successfully");
    },
    onError: (error: Error) => {
      showErrorToast(`Failed to update: ${error.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => quotationApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-quotes"] });
      showSuccessToast("Quote deleted successfully");
      baseHandleCancel(filteredQuotes);
    },
    onError: (error: Error) => {
      showErrorToast(`Failed to delete: ${error.message}`);
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => quotationApi.approve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-quotes"] });
      showSuccessToast("Quote approved successfully");
    },
    onError: (error: Error) => {
      showErrorToast(`Failed to approve: ${error.message}`);
    },
  });

  const sendMutation = useMutation({
    mutationFn: (id: number) => quotationApi.markAsSent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-quotes"] });
      showSuccessToast("Quote marked as sent");
    },
    onError: (error: Error) => {
      showErrorToast(`Failed to update: ${error.message}`);
    },
  });

  const acceptMutation = useMutation({
    mutationFn: (id: number) => quotationApi.markAsAccepted(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-quotes"] });
      showSuccessToast("Quote marked as accepted");
    },
    onError: (error: Error) => {
      showErrorToast(`Failed to update: ${error.message}`);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => quotationApi.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-quotes"] });
      showSuccessToast("Quote cancelled");
    },
    onError: (error: Error) => {
      showErrorToast(`Failed to cancel: ${error.message}`);
    },
  });

  const convertMutation = useMutation({
    mutationFn: (id: number) =>
      quotationApi.convertToInvoice(id, {
        payment_method: "cash",
        cash_amount: selectedQuote?.total_amount || 0,
      }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["sales-quotes"] });
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      showSuccessToast(`Converted to Invoice: ${response.invoice_no}`);
    },
    onError: (error: Error) => {
      showErrorToast(`Failed to convert: ${error.message}`);
    },
  });

  const reviseMutation = useMutation({
    mutationFn: (id: number) => quotationApi.createRevision(id),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["sales-quotes"] });
      showSuccessToast(`Created revision: ${response.new_quote_no}`);
    },
    onError: (error: Error) => {
      showErrorToast(`Failed to create revision: ${error.message}`);
    },
  });

  // Handlers
  const handleCreateNew = useCallback(() => {
    setFormData(getEmptyQuoteForm("quotation"));
    setLineItems([]);
    handleNewQuote();
  }, [handleNewQuote, setFormData]);

  const handleDiscardChanges = useCallback(() => {
    baseHandleCancel(filteredQuotes);
    setLineItems([]);
  }, [baseHandleCancel, filteredQuotes]);

  const handleEdit = useCallback(() => {
    if (selectedQuote) {
      setFormData({
        quote_type: selectedQuote.quote_type,
        branch_code: selectedQuote.branch_code,
        customer_id: selectedQuote.customer_id,
        sale_rep_id: selectedQuote.sale_rep_id,
        valid_until: selectedQuote.valid_until,
        is_estimate: selectedQuote.is_estimate,
        payment_terms: selectedQuote.payment_terms || "",
        delivery_terms: selectedQuote.delivery_terms || "",
        remarks: selectedQuote.remarks || "",
        customer_notes: selectedQuote.customer_notes || "",
        discount_type: selectedQuote.discount_type,
        discount_value: selectedQuote.discount_value,
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

    if (lineItems.length === 0) {
      showErrorToast("Please add at least one item");
      return;
    }

    const items: SalesQuoteItemCreate[] = lineItems.map((item) => ({
      product_id: item.product_id,
      quantity: item.quantity,
      selling_price: item.selling_price,
      minimum_selling_price: item.minimum_selling_price,
      warrenty_month: item.warrenty_month,
      min_price: item.min_price,
      max_price: item.max_price,
      is_price_estimate: item.is_price_estimate,
      description: item.description,
      discount_percent: item.discount_percent,
      tax_rate: item.tax_rate,
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

  const handleApprove = useCallback(async () => {
    if (selectedQuote) {
      const confirmed = await confirmDialog.confirm({
        title: "Approve Quote",
        message: `Approve ${selectedQuote.quote_no}?`,
        confirmText: "Approve",
        confirmColor: "success",
      });
      if (confirmed) {
        approveMutation.mutate(selectedQuote.id);
      }
    }
  }, [selectedQuote, approveMutation, confirmDialog]);

  const handleConvert = useCallback(async () => {
    if (selectedQuote) {
      const confirmed = await confirmDialog.confirm({
        title: "Convert to Invoice",
        message: `Convert ${selectedQuote.quote_no} to an invoice?`,
        confirmText: "Convert",
        confirmColor: "primary",
      });
      if (confirmed) {
        convertMutation.mutate(selectedQuote.id);
      }
    }
  }, [selectedQuote, convertMutation, confirmDialog]);

  const handleRevise = useCallback(async () => {
    if (selectedQuote) {
      const confirmed = await confirmDialog.confirm({
        title: "Create Revision",
        message: `Create a new revision of ${selectedQuote.quote_no}?`,
        confirmText: "Create Revision",
        confirmColor: "primary",
      });
      if (confirmed) {
        reviseMutation.mutate(selectedQuote.id);
      }
    }
  }, [selectedQuote, reviseMutation, confirmDialog]);

  const handleCancelQuote = useCallback(async () => {
    if (selectedQuote) {
      const confirmed = await confirmDialog.confirm({
        title: "Cancel Quote",
        message: `Cancel ${selectedQuote.quote_no}?`,
        confirmText: "Cancel Quote",
        confirmColor: "error",
      });
      if (confirmed) {
        cancelMutation.mutate(selectedQuote.id);
      }
    }
  }, [selectedQuote, cancelMutation, confirmDialog]);

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
  const handleUpdateLineItem = (index: number, field: keyof ItemFormData, value: unknown) => {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value } as ItemFormData;

    // Auto-fill price when product is selected
    if (field === "product_id" && value) {
      const product = products?.find((p) => p.id === value);
      if (product) {
        updated[index].selling_price = product.cost_price || 0;
        updated[index].minimum_selling_price = product.cost_price || 0;
      }
    }

    setLineItems(updated);
  };

  // Remove line item
  const handleRemoveLineItem = (index: number) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  // Check if actions are allowed based on status
  const canEditQuote = selectedQuote?.status === "draft" || selectedQuote?.status === "rejected";
  const canApproveQuote = selectedQuote?.status === "draft" || selectedQuote?.status === "pending_approval";
  const canSendQuote = selectedQuote?.status === "approved";
  const canAcceptQuote = selectedQuote?.status === "sent";
  const canConvertQuote = ["accepted", "approved", "sent"].includes(selectedQuote?.status || "");
  const canReviseQuote = selectedQuote?.quote_type === "quotation" && ["sent", "rejected", "expired"].includes(selectedQuote?.status || "");
  const canCancelQuoteStatus = !["converted", "cancelled"].includes(selectedQuote?.status || "");
  const canDeleteQuoteStatus = selectedQuote?.status === "draft";

  // Render list item
  const renderQuoteItem = (quote: SalesQuote) => (
    <SelectableListItem
      key={quote.id}
      isSelected={selectedQuote?.id === quote.id}
      onClick={() => handleSelectQuote(quote)}
      primaryText={quote.quote_no}
      secondaryText={
        <Box>
          <Typography variant="body2" color="text.secondary">
            {getCustomerName(quote.customer_id)}
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
            <TStatusChip status={quote.status} statusMap="quoteStatus" size="small" />
            <Typography variant="caption" color="text.secondary">
              Valid: <TDate value={quote.valid_until} format="short" />
            </Typography>
          </Box>
        </Box>
      }
      endAction={
        <Typography variant="body2" fontWeight="medium">
          <TCurrency value={quote.total_amount} />
        </Typography>
      }
    />
  );

  // Render detail panel
  const renderDetailPanel = () => {
    // Determine custom actions based on mode and state
    const customActions = !isCreating && !isEditing && selectedQuote ? (
      <Box sx={{ display: "flex", gap: 0.5 }}>
        <Button
          size="small"
          color="success"
          startIcon={<ApproveIcon />}
          onClick={handleApprove}
          disabled={!canApprove || !canApproveQuote}
        >
          Approve
        </Button>
        <Button
          size="small"
          color="primary"
          startIcon={<SendIcon />}
          onClick={() => sendMutation.mutate(selectedQuote.id)}
          disabled={!canSendQuote}
        >
          Send
        </Button>
        <Button
          size="small"
          color="success"
          startIcon={<ApproveIcon />}
          onClick={() => acceptMutation.mutate(selectedQuote.id)}
          disabled={!canAcceptQuote}
        >
          Accept
        </Button>
        <Button
          size="small"
          color="primary"
          startIcon={<ConvertIcon />}
          onClick={handleConvert}
          disabled={!canConvertQuote}
        >
          Convert
        </Button>
        {selectedQuote?.quote_type === "quotation" && (
          <Button
            size="small"
            startIcon={<ReviseIcon />}
            onClick={handleRevise}
            disabled={!canReviseQuote}
          >
            Revise
          </Button>
        )}
        <Button
          size="small"
          color="error"
          startIcon={<CancelIcon />}
          onClick={handleCancelQuote}
          disabled={!canCancelQuoteStatus}
        >
          Cancel
        </Button>
        <Button
          size="small"
          startIcon={<PrintIcon />}
          onClick={() => { }}
        >
          Print
        </Button>
      </Box>
    ) : undefined;

    return (
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <DetailPanelHeader
          icon={<QuoteIcon color="primary" />}
          breadcrumbs={[
            { label: 'Sales', href: '/sales' },
            { label: 'Quotes' }
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
          customActions={customActions}
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

    return (
      <>
        {/* Quote Details */}
        <FormSection title="Quote Information">
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 2 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">Branch</Typography>
              <Typography>{getBranchName(quote.branch_code)}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Created Date</Typography>
              <Typography><TDate value={quote.created_date} /></Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Valid Until</Typography>
              <Typography><TDate value={quote.valid_until} /></Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Customer</Typography>
              <Typography>{getCustomerName(quote.customer_id)}</Typography>
            </Box>
            {quote.payment_terms && (
              <Box>
                <Typography variant="caption" color="text.secondary">Payment Terms</Typography>
                <Typography>{quote.payment_terms}</Typography>
              </Box>
            )}
            {quote.delivery_terms && (
              <Box>
                <Typography variant="caption" color="text.secondary">Delivery Terms</Typography>
                <Typography>{quote.delivery_terms}</Typography>
              </Box>
            )}
          </Box>
        </FormSection>

        <Divider sx={{ my: 2 }} />

        {/* Totals */}
        <FormSection title="Totals">
          <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
            <Box sx={{ minWidth: 200 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                <Typography color="text.secondary">Subtotal:</Typography>
                <Typography><TCurrency value={quote.subtotal} /></Typography>
              </Box>
              {quote.discount_value > 0 && (
                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                  <Typography color="text.secondary">Discount:</Typography>
                  <Typography color="error">
                    -<TCurrency value={quote.discount_value} />
                  </Typography>
                </Box>
              )}
              {quote.tax_amount > 0 && (
                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                  <Typography color="text.secondary">Tax:</Typography>
                  <Typography><TCurrency value={quote.tax_amount} /></Typography>
                </Box>
              )}
              <Divider sx={{ my: 1 }} />
              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                <Typography fontWeight="bold">Total:</Typography>
                <Typography fontWeight="bold" color="primary">
                  <TCurrency value={quote.total_amount} />
                </Typography>
              </Box>
            </Box>
          </Box>
        </FormSection>

        {quote.remarks && (
          <>
            <Divider sx={{ my: 2 }} />
            <FormSection title="Remarks">
              <Typography>{quote.remarks}</Typography>
            </FormSection>
          </>
        )}

        {quote.converted_to_invoice_id && (
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
        )}
      </>
    );
  };

  // Render form content (without header/toolbar)
  const renderFormContent = () => {
    return (
      <>
        {/* Basic Info */}
        <FormSection title="Basic Information" columns={3}>
          <TextField
            select
            label="Branch"
            value={formData.branch_code || ""}
            onChange={(e) => setFormData({ ...formData, branch_code: e.target.value })}
            size="small"
            required
          >
            {branches.map((branch) => (
              <MenuItem key={branch.id} value={branch.branch_code}>
                {branch.branch_name}
              </MenuItem>
            ))}
          </TextField>

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
            value={formData.quote_type || "quotation"}
            onChange={(e) => setFormData({ ...formData, quote_type: e.target.value as QuoteType })}
            size="small"
            required
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
          />

          {formData.quote_type === "proforma" && (
            <TextField
              label="Expected Delivery Date"
              type="date"
              value={formData.expected_delivery_date || ""}
              onChange={(e) => setFormData({ ...formData, expected_delivery_date: e.target.value })}
              size="small"
              InputLabelProps={{ shrink: true }}
            />
          )}
        </FormSection>

        {/* Terms (for Proforma) */}
        {formData.quote_type === "proforma" && (
          <FormSection title="Terms" columns={2}>
            <TextField
              label="Payment Terms"
              value={formData.payment_terms || ""}
              onChange={(e) => setFormData({ ...formData, payment_terms: e.target.value })}
              size="small"
              placeholder="e.g., 50% advance, 50% on delivery"
            />
            <TextField
              label="Delivery Terms"
              value={formData.delivery_terms || ""}
              onChange={(e) => setFormData({ ...formData, delivery_terms: e.target.value })}
              size="small"
              placeholder="e.g., FOB Colombo"
            />
          </FormSection>
        )}

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
                  {formData.quote_type === "quotation" && (
                    <>
                      <TableCell align="right">Min Price (Rs.)</TableCell>
                      <TableCell align="right">Max Price (Rs.)</TableCell>
                    </>
                  )}
                  <TableCell align="right">Discount %</TableCell>
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
                          startAdornment: <InputAdornment position="start">{ERP_CURRENCY_SYMBOL}</InputAdornment>,
                        }}
                      />
                    </TableCell>
                    {formData.quote_type === "quotation" && (
                      <>
                        <TableCell align="right">
                          <TextField
                            type="number"
                            value={item.min_price || ""}
                            onChange={(e) =>
                              handleUpdateLineItem(index, "min_price", parseFloat(e.target.value) || undefined)
                            }
                            size="small"
                            sx={{ width: 100 }}
                            placeholder="Min"
                          />
                        </TableCell>
                        <TableCell align="right">
                          <TextField
                            type="number"
                            value={item.max_price || ""}
                            onChange={(e) =>
                              handleUpdateLineItem(index, "max_price", parseFloat(e.target.value) || undefined)
                            }
                            size="small"
                            sx={{ width: 100 }}
                            placeholder="Max"
                          />
                        </TableCell>
                      </>
                    )}
                    <TableCell align="right">
                      <TextField
                        type="number"
                        value={item.discount_percent}
                        onChange={(e) =>
                          handleUpdateLineItem(index, "discount_percent", parseFloat(e.target.value) || 0)
                        }
                        size="small"
                        sx={{ width: 80 }}
                        InputProps={{
                          endAdornment: <InputAdornment position="end">%</InputAdornment>,
                        }}
                      />
                    </TableCell>
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
        </Paper>

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
    );
  };

  return (
    <>
      {/* No tabs, unified section for both Quotation and Proforma Invoice */}

      <MasterDetailLayout
        title=""
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
                <TFilterPanel>
                  <TBranchFilter
                    branches={branches}
                    value={filterBranch}
                    onChange={setFilterBranch}
                  />
                </TFilterPanel>
                {canCreate && (
                  <Box sx={{ p: 1, borderTop: 1, borderColor: 'divider' }}>
                    <Button
                      fullWidth
                      variant="outlined"
                      startIcon={<AddIcon />}
                      onClick={handleCreateNew}
                    >
                      New Quote
                    </Button>
                  </Box>
                )}
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
              filteredQuotes.map(renderQuoteItem)
            )}
          </SearchableList>
        }
        detailPanel={renderDetailPanel()}
      />
    </>
  );
}
