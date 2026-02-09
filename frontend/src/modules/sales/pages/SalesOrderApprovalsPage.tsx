/**
 * SalesOrderApprovalsPage - Sales Order Approvals
 * Shows sales orders (invoices) pending approval
 * Adapted from POApprovalsPage
 */

import CancelIcon from "@mui/icons-material/Cancel";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import {
    Box,
    Button,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Tooltip,
    Typography
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

// Import tijaero components
import {
    DetailPanelHeader,
    EmptyState,
    fmtLKR,
    FormSection,
    MasterDetailLayout,
    SearchableList,
    SelectableListItem,
    SortOption,
    TConfirmDialog,
    TStatusChip,
    getStatusProps,
    modernTableStyles,
    showErrorToast,
    showSuccessToast,
    useTConfirmDialog,
} from "@/components/tijaero";
import SalesFilterPanel from "@/modules/sales/components/ui/SalesFilterPanel";

import { branchApi } from "@/modules/branches/api";
import { customersApi } from "@/modules/customers/api";
import { Customer } from "@/modules/customers/types";
import { productsApi } from "@/modules/inventory/api";
import { Product } from "@/modules/inventory/types";
import { salesApi } from "@/modules/sales/api";
import { Invoice, InvoiceWithItems } from "@/modules/sales/types";

const SORT_OPTIONS: SortOption[] = [
    { value: "created_date", label: "Date" },
    { value: "invoice_no", label: "Invoice Number" },
];

// Status options for filtering
const SO_STATUS_FILTER_OPTIONS = [
    { value: "pending_approval", label: "Pending Approval", color: "warning" as const },
    { value: "approved", label: "Approved", color: "success" as const },
    { value: "completed", label: "Completed", color: "info" as const },
    { value: "cancelled", label: "Cancelled", color: "error" as const },
];

export default function SalesOrderApprovalsPage() {
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = useState("");
    const [sortField, setSortField] = useState("created_date");
    const [selectedOrder, setSelectedOrder] = useState<InvoiceWithItems | null>(null);

    // Confirm dialog
    const approveDialog = useTConfirmDialog();
    const rejectDialog = useTConfirmDialog();

    // Filter states
    const [filterBranch, setFilterBranch] = useState<string | null>(null);
    const [filterStatus, setFilterStatus] = useState<string | null>("pending_approval");

    // Dialogs
    const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
    const [rejectReason, setRejectReason] = useState("");
    const [remarksDialogOpen, setRemarksDialogOpen] = useState(false);
    const [itemRemarkModalOpen, setItemRemarkModalOpen] = useState(false);
    const [currentItemRemark, setCurrentItemRemark] = useState("");

    // Fetch pending invoices
    const { data: orders = [], isLoading, refetch } = useQuery({
        queryKey: ["sales-orders-pending"],
        queryFn: () => salesApi.getPendingApproval(),
    });

    // Fetch customers (needed for names)
    const { data: customers = [] } = useQuery({
        queryKey: ["customers"],
        queryFn: () => customersApi.getAll(),
    });

    // Fetch products
    const { data: productsResult } = useQuery({
        queryKey: ["products"],
        queryFn: () => productsApi.getAll(1, 1000),
    });
    // Handle both array and paginated response just in case, but strictly type it if possible
    const products = (productsResult as any)?.items || (Array.isArray(productsResult) ? productsResult : []) || [];

    // Fetch branches
    const { data: branchesData } = useQuery({
        queryKey: ["branches"],
        queryFn: () => branchApi.getAll(1, 100),
    });
    const branches = branchesData?.items || [];

    // Create lookup maps
    const customerMap = useMemo(() => {
        const map = new Map<number, Customer>();
        customers.forEach((c) => map.set(c.id, c));
        return map;
    }, [customers]);

    const productMap = useMemo(() => {
        const map = new Map<number, Product>();
        products.forEach((p: Product) => map.set(p.id, p));
        return map;
    }, [products]);

    // Filter and sort orders
    const filteredOrders = useMemo(() => {
        let filtered = orders.filter((order) => {
            // Status filter
            if (filterStatus) {
                if (order.approval_status !== filterStatus) return false;
            }
            // Branch filter
            if (filterBranch && order.branch_code !== filterBranch) {
                return false;
            }
            // Search filter
            const customer = customerMap.get(order.customer_id);
            return (
                order.invoice_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
                customer?.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                customer?.company_name?.toLowerCase().includes(searchQuery.toLowerCase())
            );
        });

        filtered.sort((a, b) => {
            if (sortField === "invoice_no") {
                return a.invoice_no.localeCompare(b.invoice_no);
            }
            // Default: Date Descending
            return new Date(b.created_date).getTime() - new Date(a.created_date).getTime();
        });

        return filtered;
    }, [orders, searchQuery, sortField, customerMap, filterBranch]);

    // Handle selection
    const handleSelectOrder = useCallback(async (order: Invoice) => {
        try {
            const fullOrder = await salesApi.getById(order.id);
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
        mutationFn: (id: number) => salesApi.approve(id),
        onSuccess: (_data, id) => {
            // Update list by removing approved item
            queryClient.setQueryData<Invoice[]>(["sales-orders-pending"], (prev) =>
                (prev || []).filter((o) => o.id !== id)
            );
            // Clear selection if it was the approved one
            if (selectedOrder?.id === id) {
                setSelectedOrder(null);
            }
            queryClient.invalidateQueries({ queryKey: ["sales-orders"] }); // Invalidate main list too
            showSuccessToast("Sales order approved successfully");
        },
        onError: () => showErrorToast("Failed to approve order"),
    });

    // Reject mutation (Delete/Cancel)
    const rejectMutation = useMutation({
        mutationFn: ({ id }: { id: number }) =>
            // Using delete for rejection as per discussion/assumption
            salesApi.delete(id),
        onSuccess: (_data, variables) => {
            queryClient.setQueryData<Invoice[]>(["sales-orders-pending"], (prev) =>
                (prev || []).filter((o) => o.id !== variables.id)
            );
            if (selectedOrder?.id === variables.id) {
                setSelectedOrder(null);
            }
            queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
            showSuccessToast("Sales order rejected (deleted)");
            setRejectDialogOpen(false);
            setRejectReason("");
        },
        onError: () => showErrorToast("Failed to reject order"),
    });

    const handleApprove = () => {
        if (!selectedOrder) return;

        // Check if it's after 6pm (18:00) - Copied logic from PO Approvals
        const currentHour = new Date().getHours();
        const isAfterHours = currentHour >= 18;

        if (isAfterHours) {
            approveDialog.open(
                "After-Hours Approval Warning",
                `It is currently after 6:00 PM (now: ${new Date().toLocaleTimeString()}). Approving orders after business hours is not recommended. Do you want to approve anyway?`,
                () => approveMutation.mutate(selectedOrder.id)
            );
        } else {
            approveDialog.open(
                "Approve Sales Order",
                `Are you sure you want to approve sales order ${selectedOrder.invoice_no}?`,
                () => approveMutation.mutate(selectedOrder.id)
            );
        }
    };

    const handleReject = () => {
        if (!selectedOrder) return;
        rejectDialog.open(
            "Reject Sales Order",
            `Are you sure you want to reject sales order ${selectedOrder.invoice_no}? This action cannot be undone.`,
            () => rejectMutation.mutate({ id: selectedOrder.id })
        );
    };

    const customer = selectedOrder ? customerMap.get(selectedOrder.customer_id) : null;

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
            emptyMessage="No pending orders found"
            listHeader={
                <SalesFilterPanel
                    statusOptions={SO_STATUS_FILTER_OPTIONS}
                    statusValue={filterStatus}
                    onStatusChange={setFilterStatus}
                    branches={branches}
                    branchValue={filterBranch}
                    onBranchChange={setFilterBranch}
                />
            }
            renderItem={(order, isSelected) => {
                const orderCustomer = customerMap.get(order.customer_id);
                const statusChip = getStatusProps(order.approval ? "approved" : "pending_approval", "invoice");
                return (
                    <SelectableListItem
                        key={order.id}
                        id={order.id}
                        isSelected={isSelected}
                        onClick={() => handleSelectOrder(order)}
                        primaryText={
                            <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
                                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span>{order.invoice_no}</span>
                                    {isSelected && (
                                        <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                                            (Invoice No)
                                        </Typography>
                                    )}
                                </Box>
                                {isSelected && (
                                    <>
                                        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                            <Typography component="span" variant="caption">
                                                {orderCustomer?.customer_name || "Unknown Customer"}
                                            </Typography>
                                            <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                                                (Customer)
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                            <Typography component="span" variant="caption">
                                                {new Date(order.created_date).toLocaleDateString()}
                                            </Typography>
                                            <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                                                (Date)
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                            <Typography component="span" variant="caption">
                                                Rs. {((order as any).total_amount || 0).toLocaleString()}
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
                                ? `${orderCustomer?.customer_name || "Unknown"} - ${new Date(order.created_date).toLocaleDateString()}`
                                : undefined
                        }
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
                    { label: "Sales" },
                    { label: "Approvals", href: "/sales/approvals" },
                    ...(selectedOrder ? [{ label: selectedOrder.invoice_no }] : []),
                ]}
                title={selectedOrder?.invoice_no || ""}
                titleIcon={<FactCheckIcon color="primary" />}
                noSelectionTitle="Select an Order to Review"
                chips={[{ label: "Pending Approval", color: "warning" }]}
            />

            {/* Approval Actions */}
            {selectedOrder && (
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
                        Reject / Delete
                    </Button>
                </Box>
            )}

            <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
                {!selectedOrder ? (
                    <EmptyState message="Select a sales order from the list to review" />
                ) : (
                    <>
                        {/* Order Information */}
                        <FormSection title="Order Information" columns={3}>
                            <TextField label="Invoice Number" size="small" value={selectedOrder.invoice_no} disabled />
                            <TextField label="Branch" size="small" value={selectedOrder.branch_code} disabled />
                            <TextField label="Payment Method" size="small" value={selectedOrder.payment_method} disabled />
                        </FormSection>

                        {/* Customer Information */}
                        <FormSection title="Customer Information" columns={2}>
                            <TextField label="Customer Name" size="small" value={customer?.customer_name || ""} disabled />
                            <TextField label="Company" size="small" value={customer?.company_name || "N/A"} disabled />
                            <TextField label="Contact" size="small" value={customer?.mobile_contact_number || ""} disabled />
                            <TextField label="Email" size="small" value={customer?.email || "N/A"} disabled />
                        </FormSection>

                        {/* Dates & Payment */}
                        <FormSection title="Dates & Payment" columns={3}>
                            <TextField
                                label="Order Date"
                                size="small"
                                value={new Date(selectedOrder.created_date).toLocaleDateString()}
                                disabled
                            />
                            <TextField
                                label="Credit Amount"
                                size="small"
                                value={`Rs. ${fmtLKR(selectedOrder.credit_amount || 0)}`}
                                disabled
                            />
                            <TextField
                                label="Cash Amount"
                                size="small"
                                value={`Rs. ${fmtLKR(selectedOrder.cash_amount || 0)}`}
                                disabled
                            />
                        </FormSection>

                        {/* Order Status */}
                        <FormSection title="Order Status" columns={1}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                <Typography variant="body2" color="text.secondary">Status:</Typography>
                                <TStatusChip status={selectedOrder.approval ? "approved" : "pending_approval"} statusMap="salesOrder" />
                            </Box>
                        </FormSection>

                        {/* Tracking */}
                        <FormSection title="Tracking" columns={2}>
                            <TextField
                                label="Created Date"
                                size="small"
                                value={selectedOrder.created_at ? new Date(selectedOrder.created_at).toLocaleString() : ""}
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

                        {/* Order Items */}
                        <FormSection title="Order Items" columns={1}>
                            <Paper variant="outlined" sx={{ overflow: "hidden", width: "100%", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow sx={modernTableStyles.headerRow}>
                                            <TableCell>Product</TableCell>
                                            <TableCell align="right">Quantity</TableCell>
                                            <TableCell align="right">Unit Price (Rs.)</TableCell>
                                            <TableCell align="center">Warranty</TableCell>
                                            <TableCell>Remark</TableCell>
                                            <TableCell align="right">Amount (Rs.)</TableCell>
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
                                                    <TableCell align="right">{fmtLKR(item.selling_price)}</TableCell>
                                                    <TableCell align="center">{item.warrenty_month || "0"} mo</TableCell>
                                                    <TableCell>
                                                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                                                            <Typography variant="body2" sx={{ maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                                {(item as any).remark || "-"}
                                                            </Typography>
                                                            <Tooltip title="View Remark">
                                                                <IconButton size="small" onClick={() => { setCurrentItemRemark((item as any).remark || ""); setItemRemarkModalOpen(true); }}>
                                                                    <MenuBookIcon fontSize="small" />
                                                                </IconButton>
                                                            </Tooltip>
                                                        </Box>
                                                    </TableCell>
                                                    <TableCell align="right">{fmtLKR(item.quantity * item.selling_price)}</TableCell>
                                                </TableRow>
                                            );
                                        })}
                                        <TableRow sx={modernTableStyles.footerRow}>
                                            <TableCell colSpan={5} align="right">
                                                <strong>Total:</strong>
                                            </TableCell>
                                            <TableCell align="right">
                                                <strong>{fmtLKR(selectedOrder.items?.reduce((sum, item) => sum + (item.quantity * item.selling_price), 0) || 0)}</strong>
                                            </TableCell>
                                        </TableRow>
                                    </TableBody>
                                </Table>
                            </Paper>
                        </FormSection>

                        {/* Remarks */}
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
                <DialogTitle>Reject/Delete Sales Order</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        This will permanently delete the pending sales order. Use this action to reject the order.
                    </Typography>
                    <TextField
                        autoFocus
                        label="Rejection Reason (Optional - currently strictly deletes)"
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
                        disabled={rejectMutation.isPending}
                    >
                        Reject (Delete)
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
                        value={currentItemRemark || "No remark"}
                        InputProps={{ readOnly: true }}
                        sx={{ mt: 1 }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setItemRemarkModalOpen(false)} variant="outlined">
                        Close
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );

    return (
        <>
            <MasterDetailLayout
                title="Sales Order Approvals"
                icon={<FactCheckIcon color="primary" />}
                onRefresh={() => refetch()}
                isLoading={isLoading}
                masterPanel={masterPanel}
                detailPanel={detailPanel}
            />

            <TConfirmDialog {...approveDialog.dialogProps} />
            <TConfirmDialog {...rejectDialog.dialogProps} />
        </>
    );
}
