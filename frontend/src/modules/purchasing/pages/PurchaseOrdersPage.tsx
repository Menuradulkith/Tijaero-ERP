/**
 * PurchaseOrdersPage - Using Tijaero-style reusable components
 */

import { useMemo, useCallback, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  TextField,
  MenuItem,
  Typography,
  IconButton,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Paper,
  Chip,
  Autocomplete,
  Button,
  Stepper,
  Step,
  StepLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tooltip,
} from "@mui/material";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import PrintIcon from "@mui/icons-material/Print";
import toast from "react-hot-toast";

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
} from "@/components/tijaero";

import { purchaseOrdersApi, suppliersApi } from "@/modules/purchasing/api";
import { productsApi } from "@/modules/inventory/api";
import { branchApi } from "@/modules/branches/api";
import { 
  PurchasingOrder, 
  PurchasingOrderCreate, 
  PurchasingOrderItemCreate,
  PurchasingOrderWithItems,
  Supplier 
} from "@/modules/purchasing/types";

const SORT_OPTIONS: SortOption[] = [
  { value: "added_date", label: "Date" },
  { value: "purchasing_order_no", label: "Order Number" },
];

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft", color: "default" },
  { value: "pending", label: "Pending", color: "warning" },
  { value: "approved", label: "Approved", color: "info" },
  { value: "completed", label: "Completed", color: "success" },
  { value: "cancelled", label: "Cancelled", color: "error" },
];

const PAYMENT_METHODS = ["Cash", "Credit", "Cheque", "Bank Transfer"];

const FORM_STEPS = ["Order Information", "Order Items"];

const generateOrderNo = () => `PO-${Date.now().toString(36).toUpperCase()}`;

// Extended form type to include editable status fields
interface PurchaseOrderFormData extends PurchasingOrderCreate {
  status?: string;
}

const INITIAL_FORM_DATA: PurchaseOrderFormData = {
  purchasing_order_no: "",
  purchasing_invoice_no: "",
  branch_code: "",
  payment_method: "Cash",
  purchasing_order_date: new Date().toISOString().split("T")[0],
  good_received_note_date: new Date().toISOString().split("T")[0],
  remarks: "",
  credit_date: 0,
  first_suppliers_id: 0,
  second_suppliers_id: 0,
  items: [],
  status: "draft",
};

interface OrderLineItem extends PurchasingOrderItemCreate {
  _id: string;
}

const resetFormFromOrder = (order: PurchasingOrder | PurchasingOrderWithItems): PurchaseOrderFormData => ({
  purchasing_order_no: order.purchasing_order_no,
  purchasing_invoice_no: order.purchasing_invoice_no,
  branch_code: order.branch_code,
  payment_method: order.payment_method,
  purchasing_order_date: order.purchasing_order_date?.split("T")[0] || "",
  good_received_note_date: order.good_received_note_date?.split("T")[0] || "",
  remarks: order.remarks || "",
  credit_date: order.credit_date || 0,
  first_suppliers_id: order.first_suppliers_id,
  second_suppliers_id: order.second_suppliers_id,
  status: order.status || "draft",
  items: "items" in order && order.items ? order.items.map(item => ({
    product_id: item.product_id,
    quantity: item.quantity,
    unit_price: item.unit_price,
    warrenty_month: item.warrenty_month || "0",
    remark: item.remark || "",
  })) : [],
});

export default function PurchaseOrdersPage() {
  const queryClient = useQueryClient();
  const [lineItems, setLineItems] = useState<OrderLineItem[]>([]);
  const [formStep, setFormStep] = useState(0);
  
  // Filter states
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterSupplier, setFilterSupplier] = useState<number | null>(null);

  // Item remarks modal state
  const [itemRemarkModalOpen, setItemRemarkModalOpen] = useState(false);
  const [selectedItemForRemark, setSelectedItemForRemark] = useState<OrderLineItem | null>(null);
  const [tempItemRemark, setTempItemRemark] = useState("");

  const handleOpenItemRemarkModal = (item: OrderLineItem) => {
    setSelectedItemForRemark(item);
    setTempItemRemark(item.remark || "");
    setItemRemarkModalOpen(true);
  };

  const handleSaveItemRemark = () => {
    if (selectedItemForRemark) {
      handleUpdateLineItem(selectedItemForRemark._id, "remark", tempItemRemark);
    }
    setItemRemarkModalOpen(false);
    setSelectedItemForRemark(null);
  };

  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem: selectedOrder,
    setSelectedItem: setSelectedOrder,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    favorites,
    toggleFavorite,
    formData,
    setFormData,
    handleSelectItem: handleSelectOrder,
    handleNew: handleNewOrderBase,
    handleCancel: handleCancelBase,
    handleStartEdit: handleStartEditBase,
  } = useMasterDetailState<PurchasingOrder, PurchaseOrderFormData>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromOrder,
    favoritesKey: "purchase_orders_favorites",
    defaultSortField: "added_date",
  });

  const handleNewOrder = useCallback(() => {
    handleNewOrderBase();
    setFormData(prev => ({
      ...prev,
      purchasing_order_no: generateOrderNo(),
    }));
    setLineItems([]);
    setFormStep(0);
  }, [handleNewOrderBase, setFormData]);

  const handleStartEdit = useCallback(() => {
    handleStartEditBase();
    setFormStep(0);
    // @ts-ignore - selectedOrder might have items from detailed fetch
    if (selectedOrder?.items) {
      // @ts-ignore
      setLineItems(selectedOrder.items.map((item: any, idx: number) => ({
        _id: `existing-${idx}`,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        warrenty_month: item.warrenty_month || "0",
        remark: item.remark || "",
      })));
    }
  }, [handleStartEditBase, selectedOrder]);

  const handleCancel = useCallback((items: PurchasingOrder[]) => {
    handleCancelBase(items);
    setLineItems([]);
    setFormStep(0);
  }, [handleCancelBase]);

  const handleSelectOrderWithItems = useCallback((order: PurchasingOrder) => {
    handleSelectOrder(order);
    // Fetch detailed order with items
    purchaseOrdersApi.getById(order.id).then((detailedOrder) => {
      if (detailedOrder.items) {
        setLineItems(detailedOrder.items.map((item, idx) => ({
          _id: `existing-${idx}`,
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          warrenty_month: item.warrenty_month || "0",
          remark: item.remark || "",
        })));
      } else {
        setLineItems([]);
      }
    }).catch(() => {
      setLineItems([]);
    });
  }, [handleSelectOrder]);

  const { data: orders, isLoading, refetch } = useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: () => purchaseOrdersApi.getAll(),
  });

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => suppliersApi.getAll(),
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

  const getProductName = (productId: number) => {
    const product = products?.find((p: any) => p.id === productId);
    return product ? product.name : `Product #${productId}`;
  };

  const filteredOrders = useMemo(() => {
    if (!orders) return [];

    let filtered = orders.filter(
      (order) =>
        order.purchasing_order_no?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(order.id).includes(searchQuery)
    );

    // Apply branch filter
    if (filterBranch) {
      filtered = filtered.filter(order => order.branch_code === filterBranch);
    }

    // Apply supplier filter (matches either primary or secondary supplier)
    if (filterSupplier) {
      filtered = filtered.filter(order => 
        order.first_suppliers_id === filterSupplier || 
        order.second_suppliers_id === filterSupplier
      );
    }

    filtered.sort((a, b) => {
      if (sortField === "added_date") {
        return new Date(b.added_date || "").getTime() - new Date(a.added_date || "").getTime();
      }
      const fieldA = a[sortField as keyof PurchasingOrder] || "";
      const fieldB = b[sortField as keyof PurchasingOrder] || "";
      return String(fieldA).localeCompare(String(fieldB));
    });

    return filtered;
  }, [orders, searchQuery, sortField, filterBranch, filterSupplier]);

  // Auto-select first item when data loads
  useEffect(() => {
    if (filteredOrders.length > 0 && !selectedOrder && !isCreating) {
      handleSelectOrderWithItems(filteredOrders[0]);
    }
  }, [filteredOrders, selectedOrder, isCreating]);

  const createMutation = useMutation({
    mutationFn: purchaseOrdersApi.create,
    onSuccess: (newOrder) => {
      queryClient.invalidateQueries({ queryKey: ["purchaseOrders"] });
      toast.success("Purchase order created successfully");
      setIsCreating(false);
      setIsEditing(false);
      setTimeout(() => handleSelectOrderWithItems(newOrder), 0);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || "Failed to create purchase order");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      purchaseOrdersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchaseOrders"] });
      toast.success("Purchase order updated successfully");
      setIsEditing(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || "Failed to update purchase order");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => purchaseOrdersApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchaseOrders"] });
      toast.success("Purchase order deleted successfully");
      setSelectedOrder(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || "Failed to delete purchase order");
    },
  });

  const handleDelete = useCallback(() => {
    if (selectedOrder && selectedOrder.status?.toLowerCase() !== "approved") {
      if (window.confirm("Are you sure you want to delete this purchase order?")) {
        deleteMutation.mutate(selectedOrder.id);
      }
    } else {
      toast.error("Cannot delete an approved purchase order");
    }
  }, [selectedOrder, deleteMutation]);

  // Check if order can be deleted (not approved)
  const canDelete = !!(selectedOrder && selectedOrder.status?.toLowerCase() !== "approved");

  // Check if order can be edited (any status, but approved orders will need re-approval)
  const canEdit = !!selectedOrder;

  const handleAddLineItem = () => {
    const newItem: OrderLineItem = {
      _id: `new-${Date.now()}`,
      product_id: 0,
      quantity: 1,
      unit_price: 0,
      warrenty_month: "0",
      remark: "",
    };
    setLineItems([...lineItems, newItem]);
  };

  const handleRemoveLineItem = (id: string) => {
    setLineItems(lineItems.filter(item => item._id !== id));
  };

  const handleUpdateLineItem = (id: string, field: keyof OrderLineItem, value: any) => {
    setLineItems(lineItems.map(item => 
      item._id === id ? { ...item, [field]: value } : item
    ));
  };

  const handleSave = useCallback(() => {
    const dataToSave: PurchasingOrderCreate = {
      ...formData,
      items: lineItems.map(({ _id, ...item }) => item),
    };

    if (isCreating) {
      createMutation.mutate(dataToSave);
    } else if (selectedOrder) {
      // If order was approved, reset status to pending for re-approval
      const wasApproved = selectedOrder.status?.toLowerCase() === "approved";
      
      // Send full update data
      const updateData: any = {
        purchasing_invoice_no: formData.purchasing_invoice_no,
        branch_code: formData.branch_code,
        payment_method: formData.payment_method,
        purchasing_order_date: formData.purchasing_order_date || null,
        good_received_note_date: formData.good_received_note_date || null,
        remarks: formData.remarks,
        credit_date: formData.credit_date,
        first_suppliers_id: formData.first_suppliers_id,
        second_suppliers_id: formData.second_suppliers_id,
      };
      
      // Reset to pending if was approved
      if (wasApproved) {
        updateData.status = "pending";
        toast("Order was previously approved. It will need re-approval after this edit.", { icon: "⚠️" });
      }
      
      updateMutation.mutate({ 
        id: selectedOrder.id, 
        data: updateData 
      });
    }
  }, [isCreating, selectedOrder, formData, lineItems, createMutation, updateMutation]);

  const handleDuplicate = useCallback(() => {
    if (selectedOrder) {
      const newFormData = {
        ...resetFormFromOrder(selectedOrder),
        purchasing_order_no: generateOrderNo(),
        purchasing_order_date: new Date().toISOString().split("T")[0],
      };
      setFormData(newFormData);
      // Keep line items from current selection
      handleNewOrderBase();
    }
  }, [selectedOrder, setFormData, handleNewOrderBase]);

  const getSupplierName = (supplierId: number) => {
    const supplier = suppliers?.find((s: Supplier) => s.id === supplierId);
    return supplier ? supplier.full_name : "Unknown";
  };

  const getStatusColor = (status: string) => {
    const statusOption = STATUS_OPTIONS.find(s => s.value === status);
    return (statusOption?.color || "default") as "default" | "success" | "warning" | "error" | "info";
  };

  const calculateTotal = () => {
    return lineItems.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
  };

  // Step 1 validation: Order Information, Dates & Payments, Remarks
  const isStep1Valid = formData.first_suppliers_id > 0 && 
    formData.second_suppliers_id > 0 && 
    formData.purchasing_order_no && 
    formData.purchasing_invoice_no && 
    formData.branch_code;

  // Full form validation (both steps)
  const isFormValid = isStep1Valid && lineItems.length > 0;

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

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const masterPanel = (
    <SearchableList<PurchasingOrder>
      items={filteredOrders}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search orders..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedOrder}
      onSelectItem={handleSelectOrderWithItems}
      emptyMessage="No purchase orders found"
      listHeader={
        <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: "divider" }}>
          <Autocomplete
            size="small"
            options={branches}
            getOptionLabel={(option) => `${option.branch_code} - ${option.branch_name}`}
            value={branches.find(b => b.branch_code === filterBranch) || null}
            onChange={(_, newValue) => setFilterBranch(newValue?.branch_code || null)}
            renderInput={(params) => (
              <TextField {...params} placeholder="Filter by Branch" size="small" />
            )}
            sx={{ mb: 1 }}
          />
          <Autocomplete
            size="small"
            options={suppliers || []}
            getOptionLabel={(option: Supplier) => 
              option.company_name 
                ? `${option.full_name} (${option.company_name})` 
                : option.full_name
            }
            value={suppliers?.find((s: Supplier) => s.id === filterSupplier) || null}
            onChange={(_, newValue: Supplier | null) => setFilterSupplier(newValue?.id || null)}
            renderInput={(params) => (
              <TextField {...params} placeholder="Filter by Supplier" size="small" />
            )}
          />
        </Box>
      }
      renderItem={(order, isSelected) => (
        <SelectableListItem
          key={order.id}
          id={order.id}
          isSelected={isSelected}
          onClick={() => handleSelectOrderWithItems(order)}
          primaryText={
            <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
              {/* PO Number */}
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{order.purchasing_order_no || `PO-${order.id}`}</span>
                {isSelected && (
                  <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                    (PO No)
                  </Typography>
                )}
              </Box>
              {/* Additional fields when selected */}
              {isSelected && (
                <>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      {getSupplierName(order.first_suppliers_id)}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Supplier)
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      {new Date(order.purchasing_order_date || "").toLocaleDateString()}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Date)
                    </Typography>
                  </Box>
                  {/* Status Chips - shown below all fields when selected */}
                  <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                    <Chip
                      label={order.status}
                      size="small"
                      color={getStatusColor(order.status)}
                      sx={{ height: 18, fontSize: "0.65rem" }}
                    />
                  </Box>
                </>
              )}
            </Box>
          }
          secondaryText={!isSelected ? `${getSupplierName(order.first_suppliers_id)} - ${new Date(order.purchasing_order_date || "").toLocaleDateString()}` : undefined}
          isFavorite={favorites.includes(order.id)}
          onToggleFavorite={(e) => toggleFavorite(order.id, e)}
          statusChip={!isSelected ? { label: order.status, color: getStatusColor(order.status) } : undefined}
        />
      )}
    />
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Purchasing", href: "/purchasing" },
          { label: "Purchase Orders", href: "/purchasing/orders" },
          ...(selectedOrder || isCreating
            ? [{ label: isCreating ? "New Order" : selectedOrder?.purchasing_order_no || `PO-${selectedOrder?.id}` }]
            : []),
        ]}
        title={selectedOrder ? (selectedOrder.purchasing_order_no || `PO-${selectedOrder.id}`) : ""}
        titleIcon={<ShoppingCartIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Purchase Order"
        noSelectionTitle="Select an Order"
        isFavorite={selectedOrder ? favorites.includes(selectedOrder.id) : false}
        onToggleFavorite={selectedOrder ? (e) => toggleFavorite(selectedOrder.id, e) : undefined}
      />

      <ActionToolbar
        hasSelectedItem={!!selectedOrder}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={!!isFormValid}
        onNew={handleNewOrder}
        onDuplicate={handleDuplicate}
        onSave={handleSave}
        onCancel={() => handleCancel(filteredOrders)}
        onEdit={canEdit ? handleStartEdit : undefined}
        onDelete={canDelete ? handleDelete : undefined}
        canDelete={canDelete}
        endActions={
          selectedOrder && !isCreating && !isEditing ? (
            <Tooltip title={selectedOrder.status === 'draft' || selectedOrder.status === 'pending' ? 'Cannot print draft/pending orders' : 'Print / Preview Report'}>
              <span>
                <IconButton
                  size="small"
                  disabled={selectedOrder.status === 'draft' || selectedOrder.status === 'pending'}
                  onClick={() => {
                    const baseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1').replace(/\/api\/v1$/, '');
                    const reportUrl = `${baseUrl}/api/v1/reporting/documents/purchase-order/${selectedOrder.id}`;
                    window.open(reportUrl, '_blank');
                  }}
                >
                  <PrintIcon />
                </IconButton>
              </span>
            </Tooltip>
          ) : undefined
        }
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedOrder && !isCreating ? (
          <EmptyState message="Select a purchase order from the list or create a new one" />
        ) : (
          <>
            {/* Stepper for create mode only */}
            {isCreating && (
              <Stepper activeStep={formStep} sx={{ mb: 3 }}>
                {FORM_STEPS.map((label) => (
                  <Step key={label}>
                    <StepLabel>{label}</StepLabel>
                  </Step>
                ))}
              </Stepper>
            )}

            {/* Step 1: Order Information, Dates & Payments, Remarks (always show in view/edit mode) */}
            {(formStep === 0 || !isCreating) && (
              <>
                <FormSection title="Order Information" columns={3}>
                  <TextField
                    label="Order Number"
                    size="small"
                    value={formData.purchasing_order_no}
                    onChange={(e) => setFormData({ ...formData, purchasing_order_no: e.target.value })}
                    disabled={!isEditing && !isCreating}
                    required
                  />
                  <TextField
                    label="Invoice Number"
                    size="small"
                    value={formData.purchasing_invoice_no}
                    onChange={(e) => setFormData({ ...formData, purchasing_invoice_no: e.target.value })}
                    disabled={!isEditing && !isCreating}
                    required
                  />
                  {/* Searchable Branch Dropdown */}
                  <Autocomplete
                    size="small"
                    options={branches}
                    getOptionLabel={(option) => `${option.branch_code} - ${option.branch_name}`}
                    value={branches.find(b => b.branch_code === formData.branch_code) || null}
                    onChange={(_, newValue) => setFormData({ ...formData, branch_code: newValue?.branch_code || "" })}
                    disabled={!isEditing && !isCreating}
                    renderInput={(params) => (
                      <TextField {...params} label="Branch" required />
                    )}
                  />
                  {/* Searchable Primary Supplier Dropdown */}
                  <Autocomplete
                    size="small"
                    options={suppliers || []}
                    getOptionLabel={(option: Supplier) => 
                      option.company_name 
                        ? `${option.full_name} (${option.company_name})` 
                        : option.full_name
                    }
                    value={suppliers?.find((s: Supplier) => s.id === formData.first_suppliers_id) || null}
                    onChange={(_, newValue: Supplier | null) => {
                      setFormData({ 
                        ...formData, 
                        first_suppliers_id: newValue?.id || 0,
                        credit_date: newValue?.credit_days ?? formData.credit_date
                      });
                    }}
                    disabled={!isEditing && !isCreating}
                    renderInput={(params) => (
                      <TextField {...params} label="Primary Supplier" required />
                    )}
                  />
                  {/* Searchable Secondary Supplier Dropdown */}
                  <Autocomplete
                    size="small"
                    options={suppliers || []}
                    getOptionLabel={(option: Supplier) => 
                      option.company_name 
                        ? `${option.full_name} (${option.company_name})` 
                        : option.full_name
                    }
                    value={suppliers?.find((s: Supplier) => s.id === formData.second_suppliers_id) || null}
                    onChange={(_, newValue: Supplier | null) => {
                      setFormData({ ...formData, second_suppliers_id: newValue?.id || 0 });
                    }}
                    disabled={!isEditing && !isCreating}
                    renderInput={(params) => (
                      <TextField {...params} label="Secondary Supplier" required />
                    )}
                  />
                  <TextField
                    select
                    label="Payment Method"
                    size="small"
                    value={formData.payment_method}
                    onChange={(e) => setFormData({ ...formData, payment_method: e.target.value })}
                    disabled={!isEditing && !isCreating}
                  >
                    {PAYMENT_METHODS.map((method) => (
                      <MenuItem key={method} value={method}>
                        {method}
                      </MenuItem>
                    ))}
                  </TextField>
                </FormSection>

                <FormSection title="Dates & Payment" columns={3}>
                  <TextField
                    label="Order Date"
                    size="small"
                    type="date"
                    value={formData.purchasing_order_date}
                    onChange={(e) => setFormData({ ...formData, purchasing_order_date: e.target.value })}
                    disabled={!isEditing && !isCreating}
                    InputLabelProps={{ shrink: true }}
                  />
                  <TextField
                    label="GRN Date"
                    size="small"
                    type="date"
                    value={formData.good_received_note_date}
                    onChange={(e) => setFormData({ ...formData, good_received_note_date: e.target.value })}
                    disabled={!isEditing && !isCreating}
                    InputLabelProps={{ shrink: true }}
                  />
                  <TextField
                    label="Credit Days"
                    size="small"
                    type="number"
                    value={formData.credit_date}
                    onChange={(e) => setFormData({ ...formData, credit_date: parseInt(e.target.value) || 0 })}
                    disabled={!isEditing && !isCreating}
                    inputProps={{ min: 0 }}
                    helperText={isCreating || isEditing ? "Auto-filled from supplier, can be changed" : ""}
                  />
                </FormSection>

                {selectedOrder && !isCreating && (
                  <>
                    <FormSection title="Order Status" columns={4}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Typography variant="body2" color="text.secondary">Status:</Typography>
                        <Chip
                          label={selectedOrder.status}
                          color={getStatusColor(selectedOrder.status)}
                          size="small"
                        />
                      </Box>
                    </FormSection>
                    <FormSection title="Tracking" columns={2}>
                      <TextField
                        label="Created Date"
                        size="small"
                        value={selectedOrder.added_date ? new Date(selectedOrder.added_date).toLocaleString() : ""}
                        disabled
                        InputProps={{ readOnly: true }}
                      />
                      <TextField
                        label="Order Date"
                        size="small"
                        value={selectedOrder.created_date ? new Date(selectedOrder.created_date).toLocaleDateString() : ""}
                        disabled
                        InputProps={{ readOnly: true }}
                      />
                    </FormSection>
                  </>
                )}

                <FormSection title="Remarks" columns={1}>
                  <TextField
                    label="Remarks"
                    size="small"
                    value={formData.remarks}
                    onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                    disabled={!isEditing && !isCreating}
                    multiline
                    rows={2}
                  />
                </FormSection>

                {/* Next/Cancel buttons for step 1 in create mode */}
                {isCreating && (
                  <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 2, mt: 3 }}>
                    <Button 
                      variant="outlined" 
                      onClick={() => handleCancel(filteredOrders)}
                    >
                      Cancel
                    </Button>
                    <Button 
                      variant="contained" 
                      onClick={handleNextStep}
                      disabled={!isStep1Valid}
                      endIcon={<ArrowForwardIcon />}
                    >
                      Next
                    </Button>
                  </Box>
                )}
              </>
            )}

            {/* Step 2: Order Items (always show in view/edit mode, step 2 in create mode) */}
            {(formStep === 1 || !isCreating) && (
              <>
                {/* Back button in create mode only */}
                {isCreating && (
                  <Button 
                    variant="text" 
                    onClick={handlePreviousStep}
                    startIcon={<ArrowBackIcon />}
                    sx={{ mb: 2 }}
                  >
                    Back to Order Information
                  </Button>
                )}

                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1, mt: isCreating ? 0 : 2 }}>
                  <Typography variant="subtitle1" fontWeight="bold">Order Items</Typography>
                  {(isEditing || isCreating) && (
                    <IconButton size="small" onClick={handleAddLineItem} color="primary">
                      <AddIcon />
                    </IconButton>
                  )}
                </Box>
                <Box>
              <Paper variant="outlined" sx={{ overflow: "hidden" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: "action.hover" }}>
                      <TableCell sx={{ minWidth: 200 }}>Product</TableCell>
                      <TableCell align="right" sx={{ width: 100 }}>Quantity</TableCell>
                      <TableCell align="right" sx={{ width: 120 }}>Unit Price</TableCell>
                      <TableCell sx={{ width: 100 }}>Warranty</TableCell>
                      <TableCell sx={{ width: 150 }}>Remark</TableCell>
                      <TableCell align="right" sx={{ width: 120 }}>Amount</TableCell>
                      {(isEditing || isCreating) && <TableCell sx={{ width: 50 }} />}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {lineItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={isEditing || isCreating ? 7 : 6} align="center">
                          <Typography variant="body2" color="text.secondary" py={2}>
                            No items added yet
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      lineItems.map((item) => (
                        <TableRow key={item._id}>
                          <TableCell>
                            {(isEditing || isCreating) ? (
                              <Autocomplete
                                size="small"
                                options={products || []}
                                getOptionLabel={(option: any) => option.name || ""}
                                value={products?.find((p: any) => p.id === item.product_id) || null}
                                onChange={(_, newValue: any) => handleUpdateLineItem(item._id, "product_id", newValue?.id || 0)}
                                renderInput={(params) => (
                                  <TextField {...params} placeholder="Select Product" size="small" />
                                )}
                                sx={{ minWidth: 180 }}
                              />
                            ) : (
                              getProductName(item.product_id)
                            )}
                          </TableCell>
                          <TableCell align="right">
                            {(isEditing || isCreating) ? (
                              <TextField
                                size="small"
                                type="number"
                                value={item.quantity}
                                onChange={(e) => handleUpdateLineItem(item._id, "quantity", parseInt(e.target.value) || 0)}
                                sx={{ width: 80 }}
                                inputProps={{ min: 0 }}
                              />
                            ) : (
                              item.quantity
                            )}
                          </TableCell>
                          <TableCell align="right">
                            {(isEditing || isCreating) ? (
                              <TextField
                                size="small"
                                type="number"
                                value={item.unit_price}
                                onChange={(e) => handleUpdateLineItem(item._id, "unit_price", parseFloat(e.target.value) || 0)}
                                sx={{ width: 100 }}
                                inputProps={{ min: 0, step: 0.01 }}
                              />
                            ) : (
                              `Rs. ${Number(item.unit_price).toFixed(2)}`
                            )}
                          </TableCell>
                          <TableCell>
                            {(isEditing || isCreating) ? (
                              <TextField
                                size="small"
                                value={item.warrenty_month}
                                onChange={(e) => handleUpdateLineItem(item._id, "warrenty_month", e.target.value)}
                                sx={{ width: 80 }}
                                placeholder="Months"
                              />
                            ) : (
                              `${item.warrenty_month} mo`
                            )}
                          </TableCell>
                          <TableCell>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                              {(isEditing || isCreating) ? (
                                <TextField
                                  size="small"
                                  value={item.remark || ""}
                                  onChange={(e) => handleUpdateLineItem(item._id, "remark", e.target.value)}
                                  sx={{ width: 100 }}
                                  placeholder="Remark"
                                />
                              ) : (
                                <Typography variant="body2" sx={{ maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {item.remark || "-"}
                                </Typography>
                              )}
                              <Tooltip title="View/Edit Remark">
                                <IconButton
                                  size="small"
                                  onClick={() => handleOpenItemRemarkModal(item)}
                                  sx={{ ml: 0.5 }}
                                >
                                  <MenuBookIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          </TableCell>
                          <TableCell align="right">
                            Rs. {(item.quantity * item.unit_price).toFixed(2)}
                          </TableCell>
                          {(isEditing || isCreating) && (
                            <TableCell>
                              <IconButton size="small" onClick={() => handleRemoveLineItem(item._id)} color="error">
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </TableCell>
                          )}
                        </TableRow>
                      ))
                    )}
                    <TableRow sx={{ bgcolor: "action.hover" }}>
                      <TableCell colSpan={isEditing || isCreating ? 5 : 5} align="right">
                        <Typography fontWeight="bold">Total:</Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography fontWeight="bold">Rs. {calculateTotal().toFixed(2)}</Typography>
                      </TableCell>
                      {(isEditing || isCreating) && <TableCell />}
                    </TableRow>
                  </TableBody>
                </Table>
              </Paper>
            </Box>
              </>
            )}
          </>
        )}
      </Box>
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title="Purchase Orders"
        onRefresh={refetch}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />

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
            label="Remark"
            value={tempItemRemark}
            onChange={(e) => setTempItemRemark(e.target.value)}
            disabled={!isEditing && !isCreating}
            sx={{ mt: 1 }}
            placeholder="Enter remark for this item..."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setItemRemarkModalOpen(false)}>
            {isEditing || isCreating ? "Cancel" : "Close"}
          </Button>
          {(isEditing || isCreating) && (
            <Button variant="contained" onClick={handleSaveItemRemark}>
              Save
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}
