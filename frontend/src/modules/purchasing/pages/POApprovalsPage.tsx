/**
 * POApprovalsPage - Purchase Order Approvals
 * Shows purchase orders for approval/rejection with filters
 * Refactored to use common purchasing components for better code reuse
 */

import { useMemo, useCallback, useState, useEffect } from "react";
import { formatDateTimeReadable } from "@/utils/formatters";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  TextField,
  Typography,
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
  IconButton,
  Tooltip,
  Chip,
} from "@mui/material";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import MenuBookIcon from "@mui/icons-material/MenuBook";

// Import tijaero components
import {
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  DetailPanelHeader,
  FormSection,
  EmptyState,
  fmtLKR,
  TFilterPanel,
  TBranchFilter,
  TStatusFilter,
  PO_STATUS_FILTER_OPTIONS,
  getStatusProps,
  SortOption,
  showSuccessToast,
  showErrorToast,
  modernTableStyles,
  TConfirmDialog,
  useTConfirmDialog,
} from "@/components/tijaero";
// ConfirmDialog now uses TConfirmDialog from tijaero

import { purchaseOrdersApi, suppliersApi } from "@/modules/purchasing/api";
import { approvalsApi } from "@/modules/common/api";
import { useReferenceData } from "@/hooks";
// OPTIMIZED: Removed individual imports for productsApi, branchApi - using aggregated endpoint
import { PurchasingOrder, PurchasingOrderWithItems, Supplier } from "@/modules/purchasing/types";
import { Product } from "@/modules/inventory/types";

const SORT_OPTIONS: SortOption[] = [
  { value: "added_date", label: "Date" },
  { value: "purchasing_order_no", label: "Order Number" },
];

// Status options are now imported from common components (PO_STATUS_OPTIONS)
// getStatusChipProps is now imported from common components

export default function POApprovalsPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("added_date");
  const [selectedOrder, setSelectedOrder] = useState<PurchasingOrderWithItems | null>(null);

  // Confirm dialog for after-hours warning
  const confirmDialog = useTConfirmDialog();
  const creditWarningDialog = useTConfirmDialog();

  // Filter states
  const [filterStatus, setFilterStatus] = useState<string | null>("pending_approval");
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

  // Fetch suppliers (needs separate call due to complex filters)
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => suppliersApi.getAll(),
  });

  // OPTIMIZED: Single API call for products and branches (was 2 calls)
  const { data: refData, filteredBranches } = useReferenceData(["products", "branches"]);
  const products = (refData?.products || []) as Product[];
  const branches = filteredBranches || [];

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
    mutationFn: ({ approvalId }: { approvalId: number; poId: number }) =>
      approvalsApi.approve(approvalId),
    onSuccess: (_data, { poId }) => {
      queryClient.setQueryData<PurchasingOrder[]>(["purchase-orders"], (prev) =>
        (prev || []).map((o) => (o.id === poId ? { ...o, status: "approved" } : o))
      );
      setSelectedOrder((prev) => (prev && prev.id === poId ? { ...prev, status: "approved" } : prev));
      queryClient.invalidateQueries({ queryKey: ["purchaseOrders"] });
      showSuccessToast("Purchase order approved successfully");
    },
    onError: () => showErrorToast("Failed to approve order"),
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: ({ approvalId, remarks }: { approvalId: number; poId: number; remarks: string }) =>
      approvalsApi.reject(approvalId, remarks),
    onSuccess: (_data, { poId, remarks }) => {
      queryClient.setQueryData<PurchasingOrder[]>(["purchase-orders"], (prev) =>
        (prev || []).map((o) => (o.id === poId ? { ...o, status: "rejected" } : o))
      );
      setSelectedOrder((prev) =>
        prev && prev.id === poId ? { ...prev, status: "rejected", remarks: remarks } : prev
      );
      queryClient.invalidateQueries({ queryKey: ["purchaseOrders"] });
      showSuccessToast("Purchase order rejected");
      setRejectDialogOpen(false);
      setRejectReason("");
    },
    onError: () => showErrorToast("Failed to reject order"),
  });

  const handleApprove = async () => {
    if (!selectedOrder) return;

    // Check if it's a credit order and validate credit limit
    const isCreditPayment = selectedOrder.payment_method?.toLowerCase() === "credit";
    if (isCreditPayment && selectedOrder.first_suppliers_id) {
      const totalAmount = (selectedOrder.items || []).reduce((sum: number, item: any) => sum + (item.quantity * item.unit_price), 0);

      try {
        const creditCheck = await purchaseOrdersApi.checkCredit(selectedOrder.first_suppliers_id, totalAmount);

        // Show warning modal if requires approval
        if (creditCheck.requires_approval) {
          const supplier = supplierMap.get(selectedOrder.first_suppliers_id);
          const supplierName = supplier?.company_name || supplier?.full_name || 'Unknown';

          const confirmed = await creditWarningDialog.confirm({
            title: "⚠️ Credit Limit Warning",
            message: `Supplier: ${supplierName}\nCredit Limit: Rs. ${fmtLKR(creditCheck.credit_check.max_credit_limit)}\nCurrent Outstanding: Rs. ${fmtLKR(creditCheck.credit_check.current_outstanding)}\nAvailable Credit: Rs. ${fmtLKR(creditCheck.credit_check.available_credit)}\nThis Order: Rs. ${fmtLKR(creditCheck.credit_check.po_value)}\nExceeds by: Rs. ${fmtLKR(creditCheck.credit_check.excess_amount)}\n\n${creditCheck.message}`,
            confirmText: "Approve Anyway",
            cancelText: "Cancel",
            confirmColor: "warning",
          });

          if (!confirmed) {
            return; // User cancelled
          }
        }
      } catch {
        showErrorToast("Failed to check credit limit. Please try again.");
        return;
      }
    }

    // Check if it's after 6pm (18:00)
    const currentHour = new Date().getHours();
    const isAfterHours = currentHour >= 18;

    if (isAfterHours) {
      const confirmed = await confirmDialog.confirm({
        title: "After-Hours Approval Warning",
        message: `It is currently after 6:00 PM (now: ${new Date().toLocaleTimeString()}). Approving purchase orders after business hours is not recommended. Do you want to approve anyway?`,
        confirmText: "Approve Anyway",
        cancelText: "Cancel",
        confirmColor: "warning",
      });

      if (!confirmed) return;
    }

    if (!selectedOrder.approval_id) {
      showErrorToast("This order has no approval record. Please contact support.");
      return;
    }

    approveMutation.mutate({ approvalId: selectedOrder.approval_id, poId: selectedOrder.id });
  };

  const handleReject = () => {
    if (selectedOrder && rejectReason.trim()) {
      if (!selectedOrder.approval_id) {
        showErrorToast("This order has no approval record.");
        return;
      }
      rejectMutation.mutate({
        approvalId: selectedOrder.approval_id,
        poId: selectedOrder.id,
        remarks: rejectReason
      });
    }
  };

  const supplier = selectedOrder ? supplierMap.get(selectedOrder.first_suppliers_id) : null;
  const selectedIsPending = (selectedOrder?.status || "").toLowerCase() === "pending_approval";

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
        <TFilterPanel>
          <TStatusFilter
            options={PO_STATUS_FILTER_OPTIONS}
            value={filterStatus}
            onChange={setFilterStatus}
          />
          <TBranchFilter
            branches={branches}
            value={filterBranch}
            onChange={setFilterBranch}
          />
        </TFilterPanel>
      }
      renderItem={(order, isSelected) => {
        const orderSupplier = supplierMap.get(order.first_suppliers_id);
        const statusChip = getStatusProps(order.status || "draft", "purchaseOrder");
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
                          ? fmtLKR(selectedOrder.items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0))
                          : fmtLKR(order.total_amount || 0)}
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
              const s = getStatusProps(selectedOrder.status || "draft", "purchaseOrder");
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
              <TextField label="Invoice Number" size="small" value={selectedOrder.purchasing_invoice_no || "-"} disabled />
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
              <Paper variant="outlined" sx={{ overflow: "hidden", width: "100%", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={modernTableStyles.headerRow}>
                      <TableCell>Product</TableCell>
                      <TableCell align="right">Quantity</TableCell>
                      <TableCell align="right">Unit Price (Rs.)</TableCell>
                      <TableCell>Remark</TableCell>
                      <TableCell align="right">Total (Rs.)</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selectedOrder.items?.map((item, index) => {
                      const product = productMap.get(item.product_id);
                      return (
                        <TableRow key={index} sx={{
                          ...modernTableStyles.bodyRow,
                          ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                        }}>
                          <TableCell>{product?.name || `Product #${item.product_id}`}</TableCell>
                          <TableCell align="right">{item.quantity}</TableCell>
                          <TableCell align="right">{fmtLKR(item.unit_price)}</TableCell>
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
                          <TableCell align="right">{fmtLKR(item.quantity * item.unit_price)}</TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow sx={modernTableStyles.footerRow}>
                      <TableCell colSpan={4} align="right">
                        <strong>Total Amount:</strong>
                      </TableCell>
                      <TableCell align="right">
                        <strong>{fmtLKR(selectedOrder.items?.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0) || 0)}</strong>
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

            {/* Record Information */}
            <FormSection title="Record Information" columns={2}>
              <Box>
                <Typography variant="caption" color="text.secondary">Created</Typography>
                <Typography variant="body2">{formatDateTimeReadable(selectedOrder.created_date || selectedOrder.added_date) || "-"}</Typography>
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

      {/* Confirm Dialogs */}
      <TConfirmDialog {...confirmDialog.dialogProps} />
      <TConfirmDialog {...creditWarningDialog.dialogProps} confirmColor="warning" />
    </>
  );
}
