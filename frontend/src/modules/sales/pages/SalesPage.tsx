import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  TextField,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
  Button,
  IconButton,
  Divider,
  InputAdornment,
  Autocomplete,
  Paper,
  Chip,
  Tooltip,
} from "@mui/material";
import {
  Receipt as ReceiptIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  Print as PrintIcon,
  Visibility as ViewIcon,
  AssignmentReturn as ReturnIcon,
  CheckCircle as ApproveIcon,
} from "@mui/icons-material";
import {
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  DetailPanelHeader,
  ActionToolbar,
  FormSection,
  EmptyState,
  useMasterDetailState,
  SortOption,
  TConfirmDialog,
  useTConfirmDialog,
  showSuccessToast,
  showErrorToast,
} from "@/components/tijaero";
import { salesApi } from "../api";
import { customersApi } from "@/modules/customers/api";
import { productsApi } from "@/modules/inventory/api";
import { employeesApi } from "@/modules/employees/api";
import { branchApi } from "@/modules/branches/api";
import { Invoice, InvoiceCreate } from "../types";
import { usePermission } from "@/auth/permissions";
import { format } from "date-fns";
import InvoiceDetailsDialog from "../components/InvoiceDetailsDialog";
import SaleReturnDialog from "../components/SaleReturnDialog";

// Sort options
const sortOptions: SortOption[] = [
  { value: "created_date", label: "Date (Newest)" },
  { value: "invoice_no", label: "Invoice No" },
  { value: "total", label: "Total Amount" },
];

// Line item type
interface ItemFormData {
  product_id: number;
  quantity: number;
  selling_price: number;
  minimum_selling_price: number;
  warrenty_month: string;
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
  
  // Dialog states
  const [invoiceDetailsOpen, setInvoiceDetailsOpen] = useState(false);
  const [saleReturnOpen, setSaleReturnOpen] = useState(false);
  const [selectedInvoiceForView, setSelectedInvoiceForView] = useState<Invoice | null>(null);

  // Permissions
  const canCreate = usePermission("sales", "create");
  const canDelete = usePermission("sales", "delete");
  const canUpdate = usePermission("sales", "update");

  // Confirm dialogs
  const deleteDialog = useTConfirmDialog();
  const discardDialog = useTConfirmDialog();
  const approveDialog = useTConfirmDialog();

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

  const { data: customers } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.getAll(),
  });

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => productsApi.getAll(),
  });

  const { data: _employees } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeesApi.getAll(),
  });

  const { data: branchesData } = useQuery({
    queryKey: ["branches"],
    queryFn: () => branchApi.getAll(1, 100),
  });

  const branches = branchesData?.items || [];

  // Get branch name by code
  const getBranchName = (branchCode: string) => {
    return branches.find((b) => b.branch_code === branchCode)?.branch_name || branchCode;
  };

  // Get customer name by id
  const getCustomerName = (customerId: number) => {
    return customers?.find((c) => c.id === customerId)?.customer_name || `Customer #${customerId}`;
  };

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
  }, [invoices, state.searchQuery, state.sortField]);

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

  const approveMutation = useMutation({
    mutationFn: (id: number) => salesApi.approve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      showSuccessToast("Invoice approved successfully");
    },
    onError: () => {
      showErrorToast("Failed to approve invoice");
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
      },
    ]);
  };

  const removeLineItem = (index: number) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  const updateLineItem = (index: number, field: keyof ItemFormData, value: number | string) => {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };
    setLineItems(updated);
  };

  // Handle view invoice details
  const handleViewDetails = () => {
    if (state.selectedItem) {
      setSelectedInvoiceForView(state.selectedItem);
      setInvoiceDetailsOpen(true);
    }
  };

  // Handle process return
  const handleProcessReturn = () => {
    if (state.selectedItem) {
      setSelectedInvoiceForView(state.selectedItem);
      setSaleReturnOpen(true);
    }
  };

  // Handle approve
  const handleApprove = () => {
    if (state.selectedItem && !state.selectedItem.approval) {
      approveDialog.open(
        "Approve Invoice",
        `Are you sure you want to approve invoice ${state.selectedItem.invoice_no}?`,
        () => approveMutation.mutate(state.selectedItem!.id)
      );
    }
  };

  // Custom actions for toolbar
  const customActions = state.selectedItem && !state.isCreating ? (
    <Box sx={{ display: "flex", gap: 0.5 }}>
      <Tooltip title="View Details">
        <IconButton size="small" onClick={handleViewDetails}>
          <ViewIcon />
        </IconButton>
      </Tooltip>
      <Tooltip title="Print Invoice">
        <IconButton size="small" onClick={handleViewDetails}>
          <PrintIcon />
        </IconButton>
      </Tooltip>
      {canCreate && (
        <Tooltip title="Process Return">
          <IconButton size="small" color="warning" onClick={handleProcessReturn}>
            <ReturnIcon />
          </IconButton>
        </Tooltip>
      )}
      {canUpdate && !state.selectedItem.approval && (
        <Tooltip title="Approve Invoice">
          <IconButton size="small" color="success" onClick={handleApprove}>
            <ApproveIcon />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  ) : undefined;

  // Render view invoice details
  const renderViewInvoice = () => (
    <>
      <FormSection title="Invoice Details">
        <Box>
          <Typography variant="caption" color="text.secondary">Invoice No</Typography>
          <Typography variant="body2" fontWeight={500}>{state.selectedItem?.invoice_no}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Branch</Typography>
          <Typography variant="body2" fontWeight={500}>
            {state.selectedItem && getBranchName(state.selectedItem.branch_code)}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Date</Typography>
          <Typography variant="body2" fontWeight={500}>
            {state.selectedItem && format(new Date(state.selectedItem.created_date), "MMMM dd, yyyy")}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Customer</Typography>
          <Typography variant="body2" fontWeight={500}>
            {state.selectedItem && getCustomerName(state.selectedItem.customer_id)}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Payment Method</Typography>
          <Typography variant="body2" fontWeight={500} sx={{ textTransform: "capitalize" }}>
            {state.selectedItem?.payment_method?.replace(/_/g, " ")}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Status</Typography>
          <Chip 
            label={state.selectedItem?.status ? "Active" : "Inactive"} 
            size="small"
            color={state.selectedItem?.status ? "success" : "default"}
          />
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Approval</Typography>
          <Chip 
            label={state.selectedItem?.approval ? "Approved" : "Pending"} 
            size="small"
            color={state.selectedItem?.approval ? "success" : "warning"}
            variant="outlined"
          />
        </Box>
      </FormSection>

      <FormSection title="Payment Breakdown">
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", sm: "1fr 1fr 1fr 1fr" }, gap: 2, gridColumn: "1 / -1" }}>
          {state.selectedItem && state.selectedItem.cash_amount > 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary">Cash</Typography>
              <Typography variant="body2" fontWeight={500}>${state.selectedItem.cash_amount.toFixed(2)}</Typography>
            </Box>
          )}
          {state.selectedItem && state.selectedItem.card_visa_amount > 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary">Visa</Typography>
              <Typography variant="body2" fontWeight={500}>${state.selectedItem.card_visa_amount.toFixed(2)}</Typography>
            </Box>
          )}
          {state.selectedItem && state.selectedItem.card_mastercard_amount > 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary">Mastercard</Typography>
              <Typography variant="body2" fontWeight={500}>${state.selectedItem.card_mastercard_amount.toFixed(2)}</Typography>
            </Box>
          )}
          {state.selectedItem && state.selectedItem.card_amex_amount > 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary">Amex</Typography>
              <Typography variant="body2" fontWeight={500}>${state.selectedItem.card_amex_amount.toFixed(2)}</Typography>
            </Box>
          )}
          {state.selectedItem && state.selectedItem.cheque_amount > 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary">Cheque</Typography>
              <Typography variant="body2" fontWeight={500}>${state.selectedItem.cheque_amount.toFixed(2)}</Typography>
            </Box>
          )}
          {state.selectedItem && state.selectedItem.bank_transfer_amount > 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary">Bank Transfer</Typography>
              <Typography variant="body2" fontWeight={500}>${state.selectedItem.bank_transfer_amount.toFixed(2)}</Typography>
            </Box>
          )}
          {state.selectedItem && state.selectedItem.credit_amount > 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary">Credit</Typography>
              <Typography variant="body2" fontWeight={500}>${state.selectedItem.credit_amount.toFixed(2)}</Typography>
            </Box>
          )}
        </Box>
        <Box sx={{ gridColumn: "1 / -1" }}>
          <Divider sx={{ my: 2 }} />
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Typography variant="subtitle2" fontWeight={600}>Total Amount</Typography>
            <Typography variant="h6" fontWeight={700} color="success.main">
              ${state.selectedItem && calculateTotal(state.selectedItem).toFixed(2)}
            </Typography>
          </Box>
        </Box>
      </FormSection>

      {state.selectedItem && (state.selectedItem.payment_adjustments !== 0 ||
        state.selectedItem.cupon_amount !== 0 ||
        state.selectedItem.credit_note_amount !== 0) && (
        <FormSection title="Adjustments">
          {state.selectedItem.payment_adjustments !== 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary">Payment Adjustments</Typography>
              <Typography variant="body2" fontWeight={500}>${state.selectedItem.payment_adjustments.toFixed(2)}</Typography>
            </Box>
          )}
          {state.selectedItem.cupon_amount !== 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary">Coupon Amount</Typography>
              <Typography variant="body2" fontWeight={500}>${state.selectedItem.cupon_amount.toFixed(2)}</Typography>
            </Box>
          )}
          {state.selectedItem.credit_note_amount !== 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary">Credit Note</Typography>
              <Typography variant="body2" fontWeight={500}>${state.selectedItem.credit_note_amount.toFixed(2)}</Typography>
            </Box>
          )}
        </FormSection>
      )}

      {state.selectedItem?.remarks && (
        <FormSection title="Remarks" isLast>
          <Typography variant="body2" color="text.secondary" sx={{ gridColumn: "1 / -1" }}>
            {state.selectedItem.remarks}
          </Typography>
        </FormSection>
      )}
    </>
  );

  // Render create invoice form
  const renderCreateForm = () => (
    <>
      <FormSection title="Order Details">
        <TextField
          label="Invoice No"
          size="small"
          value={state.formData.invoice_no}
          onChange={(e) => state.setFormData({ ...state.formData, invoice_no: e.target.value })}
          required
        />
        <Autocomplete
          options={branches}
          getOptionLabel={(option) => `${option.branch_code} - ${option.branch_name}`}
          value={branches.find((b) => b.branch_code === state.formData.branch_code) || null}
          onChange={(_, newValue) => state.setFormData({ ...state.formData, branch_code: newValue?.branch_code || "" })}
          renderInput={(params) => <TextField {...params} label="Branch" size="small" required />}
        />
        <Autocomplete
          options={customers || []}
          getOptionLabel={(option) => option.customer_name || ""}
          value={customers?.find((c) => c.id === state.formData.customer_id) || null}
          onChange={(_, newValue) => state.setFormData({ ...state.formData, customer_id: newValue?.id || 0 })}
          renderInput={(params) => <TextField {...params} label="Customer" size="small" required />}
        />
        <TextField
          label="Payment Method"
          size="small"
          select
          value={state.formData.payment_method}
          onChange={(e) => state.setFormData({ ...state.formData, payment_method: e.target.value })}
        >
          <MenuItem value="cash">Cash</MenuItem>
          <MenuItem value="card_visa">Visa</MenuItem>
          <MenuItem value="card_mastercard">Mastercard</MenuItem>
          <MenuItem value="card_amex">Amex</MenuItem>
          <MenuItem value="cheque">Cheque</MenuItem>
          <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
          <MenuItem value="credit">Credit</MenuItem>
        </TextField>
        <TextField
          label="Remarks"
          size="small"
          value={state.formData.remarks}
          onChange={(e) => state.setFormData({ ...state.formData, remarks: e.target.value })}
          sx={{ gridColumn: { sm: "1 / -1" } }}
        />
      </FormSection>

      {/* Line Items Section */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
          <Typography variant="subtitle2" fontWeight={600}>Line Items</Typography>
          <Button size="small" startIcon={<AddIcon />} onClick={addLineItem}>Add Item</Button>
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
                <TableCell align="right">Price</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell align="center">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {lineItems.map((item, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <Autocomplete
                      size="small"
                      options={products || []}
                      getOptionLabel={(option) => `${option.item_code} - ${option.name}`}
                      value={products?.find((p) => p.id === item.product_id) || null}
                      onChange={(_, newValue) => {
                        updateLineItem(index, "product_id", newValue?.id || 0);
                        if (newValue) {
                          updateLineItem(index, "selling_price", newValue.cost_price);
                        }
                      }}
                      renderInput={(params) => <TextField {...params} placeholder="Select product" />}
                      sx={{ minWidth: 200 }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <TextField
                      size="small"
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateLineItem(index, "quantity", parseInt(e.target.value) || 1)}
                      sx={{ width: 80 }}
                      inputProps={{ min: 1 }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <TextField
                      size="small"
                      type="number"
                      value={item.selling_price}
                      onChange={(e) => updateLineItem(index, "selling_price", parseFloat(e.target.value) || 0)}
                      sx={{ width: 100 }}
                      InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Typography fontWeight={500}>${(item.quantity * item.selling_price).toFixed(2)}</Typography>
                  </TableCell>
                  <TableCell align="center">
                    <IconButton size="small" color="error" onClick={() => removeLineItem(index)}>
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
            Total: ${calculateLineItemsTotal().toFixed(2)}
          </Typography>
        </Box>
      </Paper>
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
                        ${calculateTotal(invoice).toFixed(2)}
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
                            label={invoice.approval ? "Approved" : "Pending"}
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
            saveDisabled={!state.formData.invoice_no || lineItems.length === 0}
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
    <TConfirmDialog {...approveDialog.dialogProps} confirmText="Approve" confirmColor="success" />
    
    {/* Invoice Details Dialog */}
    <InvoiceDetailsDialog
      open={invoiceDetailsOpen}
      invoice={selectedInvoiceForView}
      onClose={() => {
        setInvoiceDetailsOpen(false);
        setSelectedInvoiceForView(null);
      }}
    />

    {/* Sale Return Dialog */}
    <SaleReturnDialog
      open={saleReturnOpen}
      onClose={() => {
        setSaleReturnOpen(false);
        setSelectedInvoiceForView(null);
      }}
      preselectedInvoice={selectedInvoiceForView}
    />
    </>
  );
}
