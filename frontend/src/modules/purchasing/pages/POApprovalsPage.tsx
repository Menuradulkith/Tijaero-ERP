/**
 * POApprovalsPage - Purchase Order Approvals
 * Shows purchase orders for approval/rejection with filters
 */

import { useMemo, useCallback, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  TextField,
  Typography,
  Chip,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Paper,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Autocomplete,
  IconButton,
  Tooltip,
} from "@mui/material";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import MenuBookIcon from "@mui/icons-material/MenuBook";

import {
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  DetailPanelHeader,
  FormSection,
  EmptyState,
  SortOption,
  showSuccessToast,
  showErrorToast,
} from "@/components/tijaero";

import { purchaseOrdersApi, suppliersApi } from "@/modules/purchasing/api";
import { productsApi } from "@/modules/inventory/api";
import { branchApi } from "@/modules/branches/api";
import { PurchasingOrder, PurchasingOrderWithItems, Supplier } from "@/modules/purchasing/types";
import { Product } from "@/modules/inventory/types";

const SORT_OPTIONS: SortOption[] = [
  { value: "added_date", label: "Date" },
  { value: "purchasing_order_no", label: "Order Number" },
];

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending", color: "warning" as const },
  { value: "approved", label: "Approved", color: "info" as const },
  { value: "completed", label: "Completed", color: "success" as const },
  { value: "cancelled", label: "Cancelled", color: "error" as const },
  { value: "draft", label: "Draft", color: "default" as const },
];

const getStatusChip = (
  status?: string
): { label: string; color: "default" | "success" | "warning" | "error" | "info" } => {
  const opt = STATUS_OPTIONS.find((s) => s.value === (status || "").toLowerCase());
  return opt ? { label: opt.label, color: opt.color } : { label: status || "Unknown", color: "default" };
};

export default function POApprovalsPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("added_date");
  const [selectedOrder, setSelectedOrder] = useState<PurchasingOrderWithItems | null>(null);

  // Filter states
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  // Dialogs
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [remarksDialogOpen, setRemarksDialogOpen] = useState(false);

  // Item remark modal
  const [itemRemarkModalOpen, setItemRemarkModalOpen] = useState(false);
  const [selectedItemRemark, setSelectedItemRemark] = useState("");

  const handleOpenItemRemarkModal = (remark: string) => {
    setSelectedItemRemark(remark || "");
    setItemRemarkModalOpen(true);
  };

  // Fetch orders
  const { data: orders = [], isLoading, refetch } = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: () => purchaseOrdersApi.getAll(),
  });

  // Fetch suppliers
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => suppliersApi.getAll(),
  });

  // Fetch products
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => productsApi.getAll(),
  });

  // Fetch branches
  const { data: branchesData } = useQuery({
    queryKey: ["branches"],
    queryFn: () => branchApi.getAll(),
  });
  const branches = branchesData?.items || [];

  // Create lookup maps
  const supplierMap = useMemo(() => {
    const map = new Map<number, Supplier>();
    suppliers.forEach((s) => map.set(s.id, s));
    return map;
  }, [suppliers]);

  const productMap = useMemo(() => {
    const map = new Map<number, Product>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  // Filter and sort orders
  const filteredOrders = useMemo(() => {
    let filtered = orders.filter((order) => {
      // Status filter
      if (filterStatus && order.status?.toLowerCase() !== filterStatus.toLowerCase()) {
        return false;
      }
      // Branch filter
      if (filterBranch && order.branch_code !== filterBranch) {
        return false;
      }
      // Search filter
      const supplier = supplierMap.get(order.first_suppliers_id);
      return (
        order.purchasing_order_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
        supplier?.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        supplier?.company_name?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    });

    filtered.sort((a, b) => {
      if (sortField === "purchasing_order_no") {
        return a.purchasing_order_no.localeCompare(b.purchasing_order_no);
      }
      return new Date(b.added_date).getTime() - new Date(a.added_date).getTime();
    });

    return filtered;
  }, [orders, searchQuery, sortField, supplierMap, filterStatus, filterBranch]);

  // Handle selection
  const handleSelectOrder = useCallback(async (order: PurchasingOrder) => {
    try {
      const fullOrder = await purchaseOrdersApi.getById(order.id);
      setSelectedOrder(fullOrder);
    } catch {
      showErrorToast("Failed to load order details");
    }
  }, []);

  // Auto-select first order
  useEffect(() => {
    if (filteredOrders.length > 0 && !selectedOrder) {
      handleSelectOrder(filteredOrders[0]);
    }
  }, [filteredOrders, selectedOrder, handleSelectOrder]);

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: (id: number) => purchaseOrdersApi.update(id, { status: "approved" }),
    onSuccess: (_data, id) => {
      queryClient.setQueryData<PurchasingOrder[]>(["purchase-orders"], (prev) =>
        (prev || []).map((o) => (o.id === id ? { ...o, status: "approved" } : o))
      );
      setSelectedOrder((prev) => (prev && prev.id === id ? { ...prev, status: "approved" } : prev));
      queryClient.invalidateQueries({ queryKey: ["purchaseOrders"] });
      showSuccessToast("Purchase order approved successfully");
    },
    onError: () => showErrorToast("Failed to approve order"),
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: ({ id, remarks }: { id: number; remarks: string }) =>
      purchaseOrdersApi.update(id, { status: "cancelled", remarks }),
    onSuccess: (_data, variables) => {
      queryClient.setQueryData<PurchasingOrder[]>(["purchase-orders"], (prev) =>
        (prev || []).map((o) => (o.id === variables.id ? { ...o, status: "cancelled" } : o))
      );
      setSelectedOrder((prev) =>
        prev && prev.id === variables.id ? { ...prev, status: "cancelled", remarks: variables.remarks } : prev
      );
      queryClient.invalidateQueries({ queryKey: ["purchaseOrders"] });
      showSuccessToast("Purchase order rejected");
      setRejectDialogOpen(false);
      setRejectReason("");
    },
    onError: () => showErrorToast("Failed to reject order"),
  });

  const handleApprove = () => {
    if (selectedOrder) {
      approveMutation.mutate(selectedOrder.id);
    }
  };

  const handleReject = () => {
    if (selectedOrder && rejectReason.trim()) {
      rejectMutation.mutate({ id: selectedOrder.id, remarks: rejectReason });
    }
  };

  const supplier = selectedOrder ? supplierMap.get(selectedOrder.first_suppliers_id) : null;
  const selectedIsPending = (selectedOrder?.status || "").toLowerCase() === "pending";

  const getSupplierName = (supplierId: number) => {
    const s = supplierMap.get(supplierId);
    return s ? s.full_name || s.company_name || "Unknown" : "Unknown";
  };

  // Master Panel
  const masterPanel = (
    <SearchableList
      items={filteredOrders}
      isLoading={isLoading}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search orders..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedOrder}
      emptyMessage="No orders found"
      listHeader={
        <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: "divider" }}>
          <Autocomplete
            size="small"
            options={STATUS_OPTIONS}
            getOptionLabel={(option) => option.label}
            value={STATUS_OPTIONS.find((s) => s.value === filterStatus) || null}
            onChange={(_, newValue) => setFilterStatus(newValue?.value || null)}
            renderInput={(params) => (
              <TextField {...params} placeholder="Filter by Status" size="small" />
            )}
            sx={{ mb: 1 }}
          />
          <Autocomplete
            size="small"
            options={branches}
            getOptionLabel={(option) => `${option.branch_code} - ${option.branch_name}`}
            value={branches.find((b) => b.branch_code === filterBranch) || null}
            onChange={(_, newValue) => setFilterBranch(newValue?.branch_code || null)}
            renderInput={(params) => (
              <TextField {...params} placeholder="Filter by Branch" size="small" />
            )}
          />
        </Box>
      }
      renderItem={(order, isSelected) => {
        const orderSupplier = supplierMap.get(order.first_suppliers_id);
        const statusChip = getStatusChip(order.status);
        return (
          <SelectableListItem
            key={order.id}
            id={order.id}
            isSelected={isSelected}
            onClick={() => handleSelectOrder(order)}
            primaryText={
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{order.purchasing_order_no}</span>
                  {isSelected && (
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (PO No)
                    </Typography>
                  )}
                </Box>
                {isSelected && (
                  <>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {orderSupplier?.full_name || orderSupplier?.company_name || "Unknown Supplier"}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Supplier)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {new Date(order.purchasing_order_date).toLocaleDateString()}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Date)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        Rs. {isSelected && selectedOrder?.items 
                          ? selectedOrder.items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0).toLocaleString()
                          : (order.total_amount?.toLocaleString() || "0")}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Amount)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, mt: 0.5 }}>
                      <Chip
                        label={statusChip.label}
                        size="small"
                        color={statusChip.color}
                        sx={{ height: 18, fontSize: "0.65rem" }}
                      />
                    </Box>
                  </>
                )}
              </Box>
            }
            secondaryText={
              !isSelected
                ? `${getSupplierName(order.first_suppliers_id)} - ${new Date(order.purchasing_order_date || "").toLocaleDateString()}`
                : undefined
            }
            statusChip={!isSelected ? statusChip : undefined}
          />
        );
      }}
    />
  );

  // Detail Panel
  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Purchasing" },
          { label: "PO Approvals", href: "/purchasing/approvals" },
          ...(selectedOrder ? [{ label: selectedOrder.purchasing_order_no }] : []),
        ]}
        title={selectedOrder?.purchasing_order_no || ""}
        titleIcon={<FactCheckIcon color="primary" />}
        noSelectionTitle="Select an Order to Review"
        chips={
          selectedOrder
            ? (() => {
                const s = getStatusChip(selectedOrder.status);
                return [{ label: s.label, color: s.color }];
              })()
            : []
        }
      />

      {/* Approval Actions */}
      {selectedOrder && selectedIsPending && (
        <Box
          sx={{
            display: "flex",
            gap: 1,
            p: 1,
            borderBottom: 1,
            borderColor: "divider",
            bgcolor: "background.paper",
          }}
        >
          <Button
            variant="contained"
            color="primary"
            startIcon={<CheckCircleIcon />}
            onClick={handleApprove}
            disabled={approveMutation.isPending}
          >
            Approve
          </Button>
          <Button
            variant="outlined"
            color="error"
            startIcon={<CancelIcon />}
            onClick={() => setRejectDialogOpen(true)}
            disabled={rejectMutation.isPending}
          >
            Reject
          </Button>
        </Box>
      )}

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedOrder ? (
          <EmptyState message="Select a purchase order from the list to review" />
        ) : (
          <>
            {/* Order Information */}
            <FormSection title="Order Information" columns={3}>
              <TextField label="PO Number" size="small" value={selectedOrder.purchasing_order_no} disabled />
              <TextField label="Invoice Number" size="small" value={selectedOrder.purchasing_invoice_no} disabled />
              <TextField
                label="Order Date"
                size="small"
                value={new Date(selectedOrder.purchasing_order_date).toLocaleDateString()}
                disabled
              />
              <TextField label="Branch" size="small" value={selectedOrder.branch_code} disabled />
              <TextField label="Payment Method" size="small" value={selectedOrder.payment_method} disabled />
              <TextField label="Status" size="small" value={selectedOrder.status} disabled />
            </FormSection>

            {/* Supplier Information */}
            <FormSection title="Supplier Information" columns={2}>
              <TextField label="Supplier Name" size="small" value={supplier?.full_name || ""} disabled />
              <TextField label="Company" size="small" value={supplier?.company_name || "N/A"} disabled />
              <TextField label="Contact" size="small" value={supplier?.mobile_contact_number || ""} disabled />
              <TextField label="Email" size="small" value={supplier?.email || "N/A"} disabled />
            </FormSection>

            {/* Order Items */}
            <FormSection title="Order Items" columns={1}>
              <Paper variant="outlined" sx={{ overflow: "hidden", width: "100%" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: "grey.100" }}>
                      <TableCell>Product</TableCell>
                      <TableCell align="right">Quantity</TableCell>
                      <TableCell align="right">Unit Price</TableCell>
                      <TableCell>Remark</TableCell>
                      <TableCell align="right">Total</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selectedOrder.items?.map((item, index) => {
                      const product = productMap.get(item.product_id);
                      return (
                        <TableRow key={index}>
                          <TableCell>{product?.name || `Product #${item.product_id}`}</TableCell>
                          <TableCell align="right">{item.quantity}</TableCell>
                          <TableCell align="right">Rs. {item.unit_price.toLocaleString()}</TableCell>
                          <TableCell>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                              <Typography variant="body2" sx={{ maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {item.remark || "-"}
                              </Typography>
                              <Tooltip title="View Remark">
                                <IconButton size="small" onClick={() => handleOpenItemRemarkModal(item.remark || "")}>
                                  <MenuBookIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          </TableCell>
                          <TableCell align="right">Rs. {(item.quantity * item.unit_price).toLocaleString()}</TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow sx={{ bgcolor: "grey.50" }}>
                      <TableCell colSpan={4} align="right">
                        <strong>Total Amount:</strong>
                      </TableCell>
                      <TableCell align="right">
                        <strong>Rs. {selectedOrder.items?.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0).toLocaleString() || "0"}</strong>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </Paper>
            </FormSection>

            {/* Remarks Section with Book Icon */}
            <FormSection title="Remarks" columns={1}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
                <TextField
                  multiline
                  rows={2}
                  fullWidth
                  value={selectedOrder.remarks || "No remarks"}
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
          </>
        )}
      </Box>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onClose={() => setRejectDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Reject Purchase Order</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Please provide a reason for rejecting this purchase order.
          </Typography>
          <TextField
            autoFocus
            label="Rejection Reason"
            multiline
            rows={4}
            fullWidth
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleReject}
            disabled={!rejectReason.trim() || rejectMutation.isPending}
          >
            Reject Order
          </Button>
        </DialogActions>
      </Dialog>

      {/* Remarks Modal */}
      <Dialog open={remarksDialogOpen} onClose={() => setRemarksDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Remarks</DialogTitle>
        <DialogContent>
          <TextField
            multiline
            rows={8}
            fullWidth
            placeholder="No remarks..."
            value={selectedOrder?.remarks || ""}
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
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title="PO Approvals"
        icon={<FactCheckIcon color="primary" />}
        onRefresh={() => refetch()}
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
            value={selectedItemRemark}
            disabled
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setItemRemarkModalOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
