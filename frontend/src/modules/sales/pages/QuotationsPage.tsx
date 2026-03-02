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
import { ERP_CURRENCY_SYMBOL } from "@/utils/formatters";
import {
  Add as AddIcon,
  ArrowBack as ArrowBackIcon,
  ArrowForward as ArrowForwardIcon,
  Delete as DeleteIcon,
  Description as QuoteIcon
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

  // No tabs, show all types

  // Line items state
  const [lineItems, setLineItems] = useState<ItemFormData[]>([]);

  // Form step state for stepper workflow
  const [formStep, setFormStep] = useState(0);

  // Filter states
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  // Print Dialog State
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [selectedQuoteForPrint, setSelectedQuoteForPrint] = useState<SalesQuote | null>(null);

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
    initialFormData: getEmptyQuoteForm("quotation"),
    resetFormFromItem: (quote) => quote,
    favoritesKey: "quotations_favorites",
    defaultSortField: "created_date",
    confirmUnsavedChanges: async () => {
      return await confirmDialog.confirm({
        title: "Unsaved Changes",
        message: "You have unsaved changes. Are you sure you want to Continue them?",
        confirmText: "Confirm",
        confirmColor: "error",
      });
    },
    extraDirty: lineItems.length > 0,
    onDiscard: () => { setLineItems([]); setFormStep(0); },
  });

  // Data fetching
  const { data: quotesData, isLoading } = useQuery({
    queryKey: ["sales-quotes"],
    queryFn: () => quotationApi.getAll({}),
  });

  // OPTIMIZED: Use aggregated reference data endpoint instead of separate API calls
  const { data: refData, filteredBranches } = useReferenceData(["products", "branches", "customers", "employees"]);
  const products = refData?.products || [];
  const branches = filteredBranches || [];
  const customers = refData?.customers || [];
  const employees = refData?.employees || [];

  // Fetch selected quote with items
  const { data: selectedQuoteDetails } = useQuery({
    queryKey: ["sales-quote-details", selectedQuote?.id],
    queryFn: () => quotationApi.getById(selectedQuote!.id),
    enabled: !!selectedQuote?.id && !isCreating && !isEditing,
  });

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


  // Handlers
  const handleCreateNew = useCallback(() => {
    setFormData(getEmptyQuoteForm("quotation"));
    setLineItems([]);
    setFormStep(0);
    handleNewQuote();
  }, [handleNewQuote, setFormData]);

  const handleDiscardChanges = useCallback(async () => {
    if ((isEditing || isCreating) && hasChanges) {
      const confirmed = await confirmDialog.confirm({
        title: "Unsaved Changes",
        message: "You have unsaved changes. Are you sure you want to Continue them?",
        confirmText: "Confirm",
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
      console.log("Selected product:", product);
      if (product) {
        // First update with product selected
        setLineItems(prev => {
          const updated = [...prev];
          updated[index] = { ...updated[index], product_id: value as number } as ItemFormData;
          return updated;
        });

        try {
          // Fetch the current minimum price from the MinimumPrice table
          console.log("Fetching minimum price for product ID:", product.id);
          const minPriceData = await minimumPriceApi.getCurrent(product.id);
          console.log("Minimum price data received:", minPriceData);
          const minSellingPrice = minPriceData?.minimum_price || 0;
          console.log("Using minimum selling price:", minSellingPrice);

          // Update with the fetched minimum price
          setLineItems(prev => {
            const updated = [...prev];
            updated[index].min_price = minSellingPrice;
            updated[index].minimum_selling_price = minSellingPrice;
            updated[index].selling_price = minSellingPrice;
            return updated;
          });
        } catch (error) {
          console.error("Error fetching minimum price:", error);
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
          <Typography variant="body2" fontWeight="medium">
            <TCurrency value={quote.total_amount} />
          </Typography>
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
          endActions={
            selectedQuote && !isCreating && !isEditing ? (
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
        </FormSection>

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
                      <TableCell align="right"><TCurrency value={lineTotal} /></TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={5} sx={modernTableStyles.emptyCell}>
                    No items in this quote
                  </TableCell>
                </TableRow>
              )}
              {/* Total Row */}
              <TableRow sx={modernTableStyles.footerRow}>
                <TableCell colSpan={5} align="right">
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
                              startAdornment: <InputAdornment position="start">{ERP_CURRENCY_SYMBOL}</InputAdornment>,
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
                                  startAdornment: <InputAdornment position="start">{ERP_CURRENCY_SYMBOL}</InputAdornment>,
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
      {/* No tabs, unified section for both Quotation and Proforma Invoice */}

      <MasterDetailLayout
        title=""
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ["sales-quotes"] });
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
    </>
  );
}
