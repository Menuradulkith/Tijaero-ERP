/**
 * POApprovalsPage - Purchase Order Approvals
 * Shows purchase orders for approval/rejection with filters
 * Refactored to use common purchasing components for better code reuse
 */

import { useMemo, useCallback, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { formatDateTimeReadable } from "@/utils/formatters";
import { useCurrencyStore } from "@/state/currencyStore";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  InputAdornment,
  Tooltip,
} from "@mui/material";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import HistoryIcon from "@mui/icons-material/History";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import type { GridRenderCellParams } from "@mui/x-data-grid";

// Import tijaero components
import {
  MasterDetailLayout,
  ActionToolbar,
  DetailPanelHeader,
  FormSection,
  EmptyState,
  fmtLKR,
  getPaymentTermsLabel,
  TBranchFilter,
  TStatusFilter,
  PO_STATUS_FILTER_OPTIONS,
  getStatusProps,
  showErrorToast,
  showSuccessToast,
  modernTableStyles,
  TConfirmDialog,
  useCrudMutation,
  useTConfirmDialog,
  useRowSelection,
  TActivityHistoryPanel,
  TDataGrid,
  type TDataGridColumn,
} from "@/components/tijaero";
// ConfirmDialog now uses TConfirmDialog from tijaero

import { purchaseOrdersApi, suppliersApi } from "@/modules/purchasing/api";
import { approvalsApi } from "@/modules/common/api";
import ApproverAuthDialog from "../components/ApproverAuthDialog";
import { useReferenceData } from "@/hooks";
// OPTIMIZED: Removed individual imports for productsApi, branchApi - using aggregated endpoint
import { PurchasingOrder, PurchasingOrderWithItems, Supplier } from "@/modules/purchasing/types";
import { Product } from "@/modules/inventory/types";

// A PO row as shown in the browse table, with the supplier name looked up
// and attached directly so the table's own column-header sort orders by
// the displayed name rather than the raw supplier id.
type POApprovalRow = PurchasingOrder & { supplier_display_name: string };

export default function POApprovalsPage() {
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<PurchasingOrderWithItems | null>(null);
  const rowSelection = useRowSelection();

  // Activity History is opened on demand from a detail icon next to the
  // Activity History section title, rather than shown inline.
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);

  // Confirm dialog for after-hours warning
  const confirmDialog = useTConfirmDialog();
  const creditWarningDialog = useTConfirmDialog();

  // Filter states (applied - drives the actual list filtering)
  const [filterStatus, setFilterStatus] = useState<string | null>("pending_approval");
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  // Dialogs
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [remarksDialogOpen, setRemarksDialogOpen] = useState(false);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  // Whether the Approve/Reject flow currently in progress (auth dialog,
  // reject-reason dialog) targets the single selected order's detail view,
  // or every row ticked in the browse table.
  const [bulkActionActive, setBulkActionActive] = useState(false);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  const handleOpenPurchaseOrder = useCallback(() => {
    if (!selectedOrder) return;
    navigate("/purchasing/orders", {
      state: {
        fromPOApproval: true,
        purchaseOrderId: selectedOrder.id,
        purchaseOrderNo: selectedOrder.purchasing_order_no,
      },
    });
  }, [navigate, selectedOrder]);

  // OPTIMIZED: Single API call for products and branches (was 2 calls)
  const { data: refData, filteredBranches, defaultBranchCode } = useReferenceData(["products", "branches"]);
  const products = (refData?.products || []) as Product[];
  const branches = filteredBranches || [];

  // Auto-default branch filter for non-superuser users
  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterStatus(null);
    setFilterBranch(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // branchResolved: true once we've either confirmed no default branch exists, or the filter has been set
  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  // Fetch orders
  const { data: orders = [], isLoading, refetch } = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: () => purchaseOrdersApi.getAll(),
    enabled: branchResolved,
  });

  // Fetch suppliers (needs separate call due to complex filters)
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => suppliersApi.getAll(),
  });

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
        supplier?.company_name?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    });

    // Default order before the user sorts a column in the table itself
    // (the table's own column-header sort takes over from there).
    filtered.sort((a, b) => {
      const timeDiff = new Date(b.added_date).getTime() - new Date(a.added_date).getTime();
      return timeDiff !== 0 ? timeDiff : (b.id || 0) - (a.id || 0);
    });

    return filtered;
  }, [orders, searchQuery, supplierMap, filterStatus, filterBranch]);

  // Handle selection
  const handleSelectOrder = useCallback(async (order: PurchasingOrder) => {
    try {
      const fullOrder = await purchaseOrdersApi.getById(order.id);
      setSelectedOrder(fullOrder);
    } catch {
      showErrorToast("Failed to load order details");
    }
  }, []);

  // Returns to the browse table from the detail view.
  const handleBackToApprovals = useCallback(() => {
    setSelectedOrder(null);
  }, []);

  // Approve mutation. `silent` skips the per-item success toast for bulk
  // approvals, which show one summary toast instead once the batch finishes.
  const approveMutation = useCrudMutation({
    mutationFn: ({ approvalId, credentials }: { approvalId: number; poId: number; credentials?: any; silent?: boolean }) =>
      approvalsApi.approve(approvalId, undefined, credentials),
    invalidateQueryKeys: [["purchase-orders"], ["purchaseOrders"]],
    getSuccessMessage: (_data, { silent }) => (silent ? undefined : "Purchase order approved successfully"),
    errorMessage: "Failed to approve order",
    onSuccess: (_data, { poId }) => {
      queryClient.setQueryData<PurchasingOrder[]>(["purchase-orders"], (prev) =>
        (prev || []).map((o) => (o.id === poId ? { ...o, status: "approved" } : o))
      );
      setSelectedOrder((prev) => (prev && prev.id === poId ? { ...prev, status: "approved" } : prev));
    },
  });

  // Reject mutation (see `silent` note above).
  const rejectMutation = useCrudMutation({
    mutationFn: ({ approvalId, remarks }: { approvalId: number; poId: number; remarks: string; silent?: boolean }) =>
      approvalsApi.reject(approvalId, remarks),
    invalidateQueryKeys: [["purchase-orders"], ["purchaseOrders"]],
    getSuccessMessage: (_data, { silent }) => (silent ? undefined : "Purchase order rejected"),
    errorMessage: "Failed to reject order",
    onSuccess: (_data, { poId, remarks }) => {
      queryClient.setQueryData<PurchasingOrder[]>(["purchase-orders"], (prev) =>
        (prev || []).map((o) => (o.id === poId ? { ...o, status: "rejected" } : o))
      );
      setSelectedOrder((prev) =>
        prev && prev.id === poId ? { ...prev, status: "rejected", remarks: remarks } : prev
      );
      setRejectDialogOpen(false);
      setRejectReason("");
    },
  });

  // Runs the shared credit-limit and after-hours checks for one order ahead
  // of approval, given just the fields both a full detail order and a plain
  // browse-table row have in common. Returns false if the user backs out.
  const runPreApproveChecks = useCallback(
    async (order: { id: number; payment_method?: string; first_suppliers_id: number }, totalAmount: number) => {
      const isCreditPayment = order.payment_method?.toLowerCase() === "credit";
      if (isCreditPayment && order.first_suppliers_id) {
        try {
          const creditCheck = await purchaseOrdersApi.checkCredit(order.first_suppliers_id, totalAmount, order.id);
          if (creditCheck.requires_approval) {
            const supplierName = supplierMap.get(order.first_suppliers_id)?.company_name || "Unknown";
            const confirmed = await creditWarningDialog.confirm({
              title: "⚠️ Credit Limit Warning",
              message: `Supplier: ${supplierName}\nCredit Limit: ${currencySymbol} ${fmtLKR(creditCheck.credit_check.max_credit_limit)}\nCurrent Outstanding: ${currencySymbol} ${fmtLKR(creditCheck.credit_check.current_outstanding)}\nAvailable Credit: ${currencySymbol} ${fmtLKR(creditCheck.credit_check.available_credit)}\nThis Order: ${currencySymbol} ${fmtLKR(creditCheck.credit_check.po_value)}\nExceeds by: ${currencySymbol} ${fmtLKR(creditCheck.credit_check.excess_amount)}\n\n${creditCheck.message}`,
              confirmText: "Approve Anyway",
              cancelText: "Cancel",
              confirmColor: "warning",
            });
            if (!confirmed) return false;
          }
        } catch {
          showErrorToast("Failed to check credit limit. Please try again.");
          return false;
        }
      }
      return true;
    },
    [supplierMap, creditWarningDialog, currencySymbol]
  );

  const handleApprove = async () => {
    if (!selectedOrder) return;

    const totalAmount = (selectedOrder.items || []).reduce((sum: number, item: any) => sum + (item.quantity * item.unit_price), 0);
    if (!(await runPreApproveChecks(selectedOrder, totalAmount))) return;

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

    // Instead of immediately mutating, open the step-up auth dialog
    setBulkActionActive(false);
    setAuthDialogOpen(true);
  };

  // Bulk approve: same checks as the single-order flow, run for every
  // ticked pending row, then one shared step-up auth dialog covers the
  // whole batch.
  const handleBulkApproveClick = async () => {
    if (selectedPendingRows.length === 0) return;

    const currentHour = new Date().getHours();
    if (currentHour >= 18) {
      const confirmed = await confirmDialog.confirm({
        title: "After-Hours Approval Warning",
        message: `It is currently after 6:00 PM (now: ${new Date().toLocaleTimeString()}). Approving purchase orders after business hours is not recommended. Do you want to approve anyway?`,
        confirmText: "Approve Anyway",
        cancelText: "Cancel",
        confirmColor: "warning",
      });
      if (!confirmed) return;
    }

    for (const row of selectedPendingRows) {
      if (!(await runPreApproveChecks(row, row.total_amount))) return;
    }

    if (selectedPendingRows.some((row) => !row.approval_id)) {
      showErrorToast("One or more selected orders have no approval record. Please contact support.");
      return;
    }

    setBulkActionActive(true);
    setAuthDialogOpen(true);
  };

  const handleAuthSubmit = async (username: string, password: string) => {
    const credentials = { approver_username: username, approver_password: password };

    if (bulkActionActive) {
      setIsBulkProcessing(true);
      try {
        for (const row of selectedPendingRows) {
          if (!row.approval_id) continue;
          await approveMutation.mutateAsync({
            approvalId: row.approval_id,
            poId: row.id,
            credentials,
            silent: true,
          });
        }
        showSuccessToast(`${selectedPendingRows.length} purchase order(s) approved successfully`);
        rowSelection.clearSelection();
        setAuthDialogOpen(false);
      } catch {
        showErrorToast("Failed to approve one or more orders. Please check their status and try again.");
      } finally {
        setIsBulkProcessing(false);
      }
      return;
    }

    if (!selectedOrder || !selectedOrder.approval_id) return;
    approveMutation.mutate(
      {
        approvalId: selectedOrder.approval_id,
        poId: selectedOrder.id,
        credentials,
      },
      {
        onSuccess: () => setAuthDialogOpen(false),
      }
    );
  };

  const handleReject = () => {
    if (!rejectReason.trim()) return;

    if (bulkActionActive) {
      if (selectedPendingRows.length === 0) return;
      setIsBulkProcessing(true);
      (async () => {
        try {
          for (const row of selectedPendingRows) {
            if (!row.approval_id) continue;
            await rejectMutation.mutateAsync({
              approvalId: row.approval_id,
              poId: row.id,
              remarks: rejectReason,
              silent: true,
            });
          }
          showSuccessToast(`${selectedPendingRows.length} purchase order(s) rejected`);
          rowSelection.clearSelection();
          setRejectDialogOpen(false);
          setRejectReason("");
        } catch {
          showErrorToast("Failed to reject one or more orders. Please check their status and try again.");
        } finally {
          setIsBulkProcessing(false);
        }
      })();
      return;
    }

    if (selectedOrder) {
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

  const handleBulkRejectClick = () => {
    if (selectedPendingRows.length === 0) return;
    if (selectedPendingRows.some((row) => !row.approval_id)) {
      showErrorToast("One or more selected orders have no approval record. Please contact support.");
      return;
    }
    setBulkActionActive(true);
    setRejectDialogOpen(true);
  };

  const supplier = selectedOrder ? supplierMap.get(selectedOrder.first_suppliers_id) : null;
  const selectedIsPending = (selectedOrder?.status || "").toLowerCase() === "pending_approval";

  const getSupplierName = (supplierId: number) => {
    const s = supplierMap.get(supplierId);
    return s ? s.company_name || "Unknown" : "Unknown";
  };

  // The table sorts by whichever column the user clicks; the Supplier
  // column displays a looked-up name rather than the raw supplier id, so it
  // needs that name as its own field for the grid to sort on correctly.
  const orderRows = useMemo(
    () =>
      filteredOrders.map((order) => ({
        ...order,
        supplier_display_name: getSupplierName(order.first_suppliers_id),
      })),
    [filteredOrders, supplierMap] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Rows currently ticked in the browse table, restricted to ones actually
  // pending approval (approve/reject only make sense for those). The
  // "select all" header checkbox produces an "exclude" model (every row
  // except whatever's in `ids`), not "include" (just the ticked ones), so
  // both have to be handled here.
  const selectedPendingRows = useMemo(() => {
    const { type, ids } = rowSelection.selectedRows;
    const isSelected = type === "include" ? (id: number) => ids.has(id) : (id: number) => !ids.has(id);
    if (type === "include" && ids.size === 0) return [];
    return orderRows.filter(
      (row) => isSelected(row.id) && (row.status || "").toLowerCase() === "pending_approval",
    );
  }, [rowSelection.selectedRows, orderRows]);

  const orderColumns: TDataGridColumn<POApprovalRow>[] = useMemo(
    () => [
      {
        field: "purchasing_order_no",
        header: "PO Number",
        flex: 1,
        minWidth: 170,
        renderCell: (params: GridRenderCellParams<POApprovalRow>) => (
          <Typography variant="body2" fontWeight={600}>
            {params.row.purchasing_order_no || `PO-${params.row.id}`}
          </Typography>
        ),
      },
      {
        field: "supplier_display_name",
        header: "Supplier",
        flex: 1,
        minWidth: 180,
      },
      {
        field: "branch_code",
        header: "Branch",
        width: 110,
      },
      {
        field: "purchasing_order_date",
        header: "Order Date",
        type: "date",
        width: 130,
      },
      {
        field: "required_date",
        header: "GRN Date",
        type: "date",
        width: 130,
      },
      {
        field: "status",
        header: "Status",
        type: "status",
        statusMap: "purchaseOrder",
        width: 150,
      },
      {
        field: "total_quantity",
        header: "Quantity",
        type: "number",
        width: 100,
      },
      {
        field: "total_amount",
        header: "Total",
        type: "currency",
        width: 140,
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<POApprovalRow>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectOrder(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [handleSelectOrder]
  );

  // Browse mode: a full-width table of every order matching the current
  // filters (default view when nothing is selected).
  const orderTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<POApprovalRow>
          rows={orderRows}
          columns={orderColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectOrder(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No orders found"
          autoHeight={false}
          height="100%"
          selectionMode="multiple"
          selectedRows={rowSelection.selectedRows}
          onSelectionChange={rowSelection.setSelectedRows}
        />
      </Box>
    </Box>
  );

  // Whether we're showing a single order's detail view instead of the
  // browse table.
  const isPOApprovalDetailMode = !!selectedOrder;

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

      {/* Open PO + Approve/Reject, grouped together on the right like the
          Cancel New / Next pairing on the PO creation wizard's toolbar. */}
      {selectedOrder && (
        <ActionToolbar
          hasSelectedItem
          isCreating={false}
          isEditing={false}
          canCreate={false}
          canDuplicate={false}
          canDelete={false}
          endActions={
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ShoppingCartIcon />}
                onClick={handleOpenPurchaseOrder}
              >
                Open PO
              </Button>
              {selectedIsPending && (
                <>
                  <Button
                    size="small"
                    variant="contained"
                    color="primary"
                    startIcon={<CheckCircleIcon />}
                    onClick={handleApprove}
                    disabled={approveMutation.isPending}
                  >
                    Approve
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    startIcon={<CancelIcon />}
                    onClick={() => setRejectDialogOpen(true)}
                    disabled={rejectMutation.isPending}
                  >
                    Reject
                  </Button>
                </>
              )}
            </Box>
          }
        />
      )}

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedOrder ? (
          <EmptyState message="Select a purchase order from the list to review" />
        ) : (
          <>
            {/* Order Information */}
            <FormSection title="Order Information" columns={3}>
              <TextField label="PO Number" size="small" value={selectedOrder.purchasing_order_no} disabled />
              <TextField
                label="Order Date"
                size="small"
                value={new Date(selectedOrder.purchasing_order_date).toLocaleDateString()}
                disabled
              />
              <TextField
                label="GRN Date"
                size="small"
                value={
                  selectedOrder.good_received_note_date
                    ? new Date(selectedOrder.good_received_note_date).toLocaleDateString()
                    : ""
                }
                disabled
              />
              <TextField label="Branch" size="small" value={selectedOrder.branch_code} disabled />
              <TextField label="Payment Method" size="small" value={selectedOrder.payment_method} disabled />
              {selectedOrder.payment_method?.toLowerCase() === "credit" && (
                <TextField
                  label="Payment Term"
                  size="small"
                  value={getPaymentTermsLabel(supplier?.credit_days)}
                  disabled
                />
              )}
              <TextField label="Status" size="small" value={selectedOrder.status} disabled />
            </FormSection>

            {/* Supplier Information */}
            <FormSection title="Supplier Information" columns={2}>
              <TextField label="Company" size="small" value={supplier?.company_name || "N/A"} disabled />
              <TextField label="Contact" size="small" value={supplier?.mobile_contact_number || ""} disabled />
              <TextField label="Email" size="small" value={supplier?.email || "N/A"} disabled />
            </FormSection>

            {/* Order Items */}
            <FormSection title="Order Items" columns={1}>
              <Paper variant="outlined" sx={{ overflow: "hidden", width: "100%", borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={modernTableStyles.headerRow}>
                      <TableCell>Product</TableCell>
                      <TableCell align="right">Quantity</TableCell>
                      <TableCell align="right">{`Unit Price (${currencySymbol})`}</TableCell>
                      <TableCell align="right">{`Total (${currencySymbol})`}</TableCell>
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
                          <TableCell align="right">{fmtLKR(item.quantity * item.unit_price)}</TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow sx={modernTableStyles.footerRow}>
                      <TableCell colSpan={3} align="right">
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

            {/* Activity History */}
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
                <Typography variant="caption" color="text.secondary">Created</Typography>
                <Typography variant="body2">{formatDateTimeReadable(selectedOrder.created_date || selectedOrder.added_date) || "-"}</Typography>
              </Box>
            </FormSection>
          </>
        )}
      </Box>

      {/* Reject Dialog */}
      <Dialog
        open={rejectDialogOpen}
        onClose={() => {
          setRejectDialogOpen(false);
          setBulkActionActive(false);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {bulkActionActive ? `Reject ${selectedPendingRows.length} Purchase Orders` : "Reject Purchase Order"}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {bulkActionActive
              ? `Please provide a reason for rejecting these ${selectedPendingRows.length} purchase orders.`
              : "Please provide a reason for rejecting this purchase order."}
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
          <Button
            onClick={() => {
              setRejectDialogOpen(false);
              setBulkActionActive(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleReject}
            disabled={!rejectReason.trim() || rejectMutation.isPending || isBulkProcessing}
          >
            {rejectMutation.isPending || isBulkProcessing ? "Rejecting..." : "Reject Order"}
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
        titleSlot={
          isPOApprovalDetailMode ? (
            <Button
              size="small"
              startIcon={<ArrowBackIcon fontSize="small" />}
              onClick={handleBackToApprovals}
              sx={{ textTransform: "none" }}
            >
              Back to PO Approvals
            </Button>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search orders..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                }}
                sx={{ width: 220, flexShrink: 0 }}
              />
              <Box sx={{ width: 170, flexShrink: 0 }}>
                <TStatusFilter options={PO_STATUS_FILTER_OPTIONS} value={filterStatus} onChange={setFilterStatus} label="" placeholder="All Statuses" size="small" />
              </Box>
              <Box sx={{ width: 160, flexShrink: 0 }}>
                <TBranchFilter branches={branches} value={filterBranch} onChange={setFilterBranch} label="" placeholder="All Branches" size="small" />
              </Box>
              {(searchQuery || filterStatus || filterBranch) && (
                <Tooltip title="Clear filters">
                  <IconButton size="small" onClick={handleClearFilters}>
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          )
        }
        headerActions={
          !isPOApprovalDetailMode && selectedPendingRows.length > 0 ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Button
                size="small"
                variant="contained"
                color="primary"
                startIcon={<CheckCircleIcon />}
                onClick={handleBulkApproveClick}
                disabled={isBulkProcessing}
              >
                Approve ({selectedPendingRows.length})
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<CancelIcon />}
                onClick={handleBulkRejectClick}
                disabled={isBulkProcessing}
              >
                Reject ({selectedPendingRows.length})
              </Button>
            </Box>
          ) : undefined
        }
        onRefresh={() => refetch()}
        isLoading={isLoading}
        {...(isPOApprovalDetailMode
          ? { children: detailPanel }
          : { children: orderTablePanel })}
      />

      {/* Confirm Dialogs */}
      <TConfirmDialog {...confirmDialog.dialogProps} />
      <TConfirmDialog {...creditWarningDialog.dialogProps} confirmColor="warning" />

      <ApproverAuthDialog
        open={authDialogOpen}
        title={bulkActionActive ? `Approver Login required (${selectedPendingRows.length} orders)` : undefined}
        onClose={() => {
          setAuthDialogOpen(false);
          setBulkActionActive(false);
        }}
        onSubmit={handleAuthSubmit}
        loading={approveMutation.isPending || isBulkProcessing}
      />

      <TActivityHistoryPanel
        open={activityHistoryOpen}
        onClose={() => setActivityHistoryOpen(false)}
        entityType="purchase_order"
        entityId={selectedOrder?.id}
        actionLabels={{
          create: "Order created",
          approve: "Order approved",
          reject: "Order rejected",
        }}
      />
    </>
  );
}
