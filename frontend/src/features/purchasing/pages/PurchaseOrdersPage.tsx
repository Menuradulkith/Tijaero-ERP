/**
 * PurchaseOrdersPage - Using Tijaero-style reusable components
 */

import { useMemo, useCallback, useState } from "react";
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
} from "@mui/material";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import toast from "react-hot-toast";
import { ConfirmDialog, useConfirmDialog } from "@/components/ConfirmDialog";

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
  { value: "total_amount", label: "Amount" },
];

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft", color: "default" },
  { value: "pending", label: "Pending", color: "warning" },
  { value: "approved", label: "Approved", color: "info" },
  { value: "completed", label: "Completed", color: "success" },
  { value: "cancelled", label: "Cancelled", color: "error" },
];

const PAYMENT_METHODS = ["Cash", "Credit", "Cheque", "Bank Transfer"];

const generateOrderNo = () => `PO-${Date.now().toString(36).toUpperCase()}`;

// Extended form type to include editable status fields
interface PurchaseOrderFormData extends PurchasingOrderCreate {
  status?: string;
  actual_delivery_date?: string;
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
  expected_delivery_date: "",
  items: [],
  status: "draft",
  actual_delivery_date: "",
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
  expected_delivery_date: order.expected_delivery_date?.split("T")[0] || "",
  status: order.status || "draft",
  actual_delivery_date: order.actual_delivery_date?.split("T")[0] || "",
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

  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem: selectedOrder,
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
  }, [handleNewOrderBase, setFormData]);

  const handleStartEdit = useCallback(() => {
    handleStartEditBase();
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

    filtered.sort((a, b) => {
      if (sortField === "added_date") {
        return new Date(b.added_date || "").getTime() - new Date(a.added_date || "").getTime();
      }
      const fieldA = a[sortField as keyof PurchasingOrder] || "";
      const fieldB = b[sortField as keyof PurchasingOrder] || "";
      return String(fieldA).localeCompare(String(fieldB));
    });

    return filtered;
  }, [orders, searchQuery, sortField]);

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
      handleCancel(filteredOrders);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || "Failed to delete purchase order");
    },
  });

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
        expected_delivery_date: formData.expected_delivery_date || null,
        status: formData.status || selectedOrder.status,
        actual_delivery_date: formData.actual_delivery_date || null,
      };
      updateMutation.mutate({ 
        id: selectedOrder.id, 
        data: updateData 
      });
    }
  }, [isCreating, selectedOrder, formData, lineItems, createMutation, updateMutation]);

  const confirmDialog = useConfirmDialog();

  const handleDelete = useCallback(async () => {
    if (selectedOrder) {
      const confirmed = await confirmDialog.confirm({
        title: "Delete Purchase Order",
        message: `Are you sure you want to delete order "${selectedOrder.purchasing_order_no || selectedOrder.id}"?`,
        confirmText: "Delete",
        confirmColor: "error",
      });
      if (confirmed) {
        deleteMutation.mutate(selectedOrder.id);
      }
    }
  }, [selectedOrder, confirmDialog, deleteMutation]);

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

  const isFormValid = formData.first_suppliers_id > 0 && lineItems.length > 0 && formData.purchasing_order_no && formData.branch_code;
  const isSaving = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

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
      renderItem={(order, isSelected) => (
        <SelectableListItem
          key={order.id}
          id={order.id}
          isSelected={isSelected}
          onClick={() => handleSelectOrderWithItems(order)}
          primaryText={order.purchasing_order_no || `PO-${order.id}`}
          secondaryText={`${getSupplierName(order.first_suppliers_id)} - ${new Date(order.purchasing_order_date || "").toLocaleDateString()}`}
          isFavorite={favorites.includes(order.id)}
          onToggleFavorite={(e) => toggleFavorite(order.id, e)}
          statusChip={{ label: order.status, color: getStatusColor(order.status) }}
        />
      )}
    />
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Purchase Orders", href: "#" },
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
        onDelete={handleDelete}
        onSave={handleSave}
        onCancel={() => handleCancel(filteredOrders)}
        onEdit={handleStartEdit}
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
        {!selectedOrder && !isCreating ? (
          <EmptyState message="Select a purchase order from the list or create a new one" />
        ) : (
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
              />
              <TextField
                select
                label="Branch"
                size="small"
                value={formData.branch_code}
                onChange={(e) => setFormData({ ...formData, branch_code: e.target.value })}
                disabled={!isEditing && !isCreating}
                required
              >
                <MenuItem value="">Select Branch</MenuItem>
                {branches.map((branch) => (
                  <MenuItem key={branch.id} value={branch.branch_code}>
                    {branch.branch_code} - {branch.branch_name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Primary Supplier"
                size="small"
                value={formData.first_suppliers_id}
                onChange={(e) => setFormData({ ...formData, first_suppliers_id: parseInt(e.target.value) })}
                disabled={!isEditing && !isCreating}
                required
              >
                <MenuItem value={0}>Select Supplier</MenuItem>
                {suppliers?.map((supplier: Supplier) => (
                  <MenuItem key={supplier.id} value={supplier.id}>
                    {supplier.full_name} {supplier.company_name ? `(${supplier.company_name})` : ""}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Secondary Supplier"
                size="small"
                value={formData.second_suppliers_id}
                onChange={(e) => setFormData({ ...formData, second_suppliers_id: parseInt(e.target.value) })}
                disabled={!isEditing && !isCreating}
              >
                <MenuItem value={0}>None</MenuItem>
                {suppliers?.map((supplier: Supplier) => (
                  <MenuItem key={supplier.id} value={supplier.id}>
                    {supplier.full_name}
                  </MenuItem>
                ))}
              </TextField>
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

            <FormSection title="Dates & Payment" columns={4}>
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
                label="Expected Delivery"
                size="small"
                type="date"
                value={formData.expected_delivery_date}
                onChange={(e) => setFormData({ ...formData, expected_delivery_date: e.target.value })}
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
              />
            </FormSection>

            {selectedOrder && !isCreating && (
              <>
                <FormSection title="Order Status" columns={4}>
                  {isEditing ? (
                    <TextField
                      select
                      label="Status"
                      size="small"
                      value={formData.status || selectedOrder.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  ) : (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography variant="body2" color="text.secondary">Status:</Typography>
                      <Chip 
                        label={selectedOrder.status} 
                        color={getStatusColor(selectedOrder.status)} 
                        size="small" 
                      />
                    </Box>
                  )}
                  <TextField
                    label="Total Amount"
                    size="small"
                    value={Number(selectedOrder.total_amount || 0).toFixed(2)}
                    disabled
                    InputProps={{ readOnly: true }}
                  />
                  <TextField
                    label="Paid Amount"
                    size="small"
                    value={Number(selectedOrder.paid_amount || 0).toFixed(2)}
                    disabled
                    InputProps={{ readOnly: true }}
                  />
                  <TextField
                    label="Balance"
                    size="small"
                    value={Number((selectedOrder.total_amount || 0) - (selectedOrder.paid_amount || 0)).toFixed(2)}
                    disabled
                    InputProps={{ readOnly: true }}
                  />
                </FormSection>
                <FormSection title="Delivery Status" columns={2}>
                  <TextField
                    label="Actual Delivery Date"
                    size="small"
                    type="date"
                    value={isEditing ? (formData.actual_delivery_date || "") : (selectedOrder.actual_delivery_date?.split("T")[0] || "")}
                    onChange={(e) => setFormData({ ...formData, actual_delivery_date: e.target.value })}
                    disabled={!isEditing}
                    InputLabelProps={{ shrink: true }}
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

            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1, mt: 2 }}>
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
                              Number(item.unit_price).toFixed(2)
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
                            {(isEditing || isCreating) ? (
                              <TextField
                                size="small"
                                value={item.remark || ""}
                                onChange={(e) => handleUpdateLineItem(item._id, "remark", e.target.value)}
                                sx={{ width: 130 }}
                                placeholder="Remark"
                              />
                            ) : (
                              item.remark || "-"
                            )}
                          </TableCell>
                          <TableCell align="right">
                            {(item.quantity * item.unit_price).toFixed(2)}
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
                        <Typography fontWeight="bold">{calculateTotal().toFixed(2)}</Typography>
                      </TableCell>
                      {(isEditing || isCreating) && <TableCell />}
                    </TableRow>
                  </TableBody>
                </Table>
              </Paper>
            </Box>
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
      <ConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
