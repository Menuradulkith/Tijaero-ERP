/**
 * SalesOrderApprovalsPage - Sales Order Approvals
 * Shows sales orders (invoices) pending approval
 * Adapted from POApprovalsPage
 */

import CancelIcon from "@mui/icons-material/Cancel";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import {
    Box,
    Button,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
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
import { useCallback, useEffect, useMemo, useState } from "react";

// Import tijaero components
import { ConfirmDialog, useConfirmDialog } from "@/components/ConfirmDialog";
import {
    DetailPanelHeader,
    EmptyState,
    FormSection,
    MasterDetailLayout,
    SearchableList,
    SelectableListItem,
    SortOption,
    TBranchFilter,
    TFilterPanel,
    modernTableStyles,
    showErrorToast,
    showSuccessToast,
} from "@/components/tijaero";

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

export default function SalesOrderApprovalsPage() {
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = useState("");
    const [sortField, setSortField] = useState("created_date");
    const [selectedOrder, setSelectedOrder] = useState<InvoiceWithItems | null>(null);

    // Confirm dialog
    const confirmDialog = useConfirmDialog();

    // Filter states
    const [filterBranch, setFilterBranch] = useState<string | null>(null);

    // Dialogs
    const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
    const [rejectReason, setRejectReason] = useState("");
    // const [remarksDialogOpen, setRemarksDialogOpen] = useState(false); // Unused for now

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

    const handleApprove = async () => {
        if (!selectedOrder) return;

        // Check if it's after 6pm (18:00) - Copied logic from PO Approvals
        const currentHour = new Date().getHours();
        const isAfterHours = currentHour >= 18;

        if (isAfterHours) {
            const confirmed = await confirmDialog.confirm({
                title: "After-Hours Approval Warning",
                message: `It is currently after 6:00 PM (now: ${new Date().toLocaleTimeString()}). Approving orders after business hours is not recommended. Do you want to approve anyway?`,
                confirmText: "Approve Anyway",
                cancelText: "Cancel",
                confirmColor: "warning",
            });

            if (!confirmed) return;
        }

        approveMutation.mutate(selectedOrder.id);
    };

    const handleReject = () => {
        if (selectedOrder) {
            rejectMutation.mutate({ id: selectedOrder.id });
        }
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
                <TFilterPanel>
                    <TBranchFilter
                        branches={branches}
                        value={filterBranch}
                        onChange={setFilterBranch}
                    />
                </TFilterPanel>
            }
            renderItem={(order, isSelected) => {
                const orderCustomer = customerMap.get(order.customer_id);
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
                                                {/* Note: Invoice type might not have total_amount explicitly on list item, 
                            checking Invoice type definition might be needed. 
                            Usually list items allow some total. 
                            If not, we can sum items if available or just show '-' 
                        */}
                                            </Typography>
                                            <Chip
                                                label="Pending"
                                                size="small"
                                                color="warning"
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
                            <TextField
                                label="Date"
                                size="small"
                                value={new Date(selectedOrder.created_date).toLocaleDateString()}
                                disabled
                            />
                            <TextField label="Branch" size="small" value={selectedOrder.branch_code} disabled />
                            <TextField label="Payment Method" size="small" value={selectedOrder.payment_method} disabled />
                            {/* Add more fields as needed */}
                        </FormSection>

                        {/* Customer Information */}
                        <FormSection title="Customer Information" columns={2}>
                            <TextField label="Customer Name" size="small" value={customer?.customer_name || ""} disabled />
                            <TextField label="Company" size="small" value={customer?.company_name || ""} disabled />
                            <TextField label="Contact" size="small" value={customer?.mobile_contact_number || ""} disabled />
                            <TextField label="Email" size="small" value={customer?.email || ""} disabled />
                        </FormSection>

                        {/* Order Items */}
                        <FormSection title="Order Items" columns={1}>
                            <Paper variant="outlined" sx={{ overflow: "hidden", width: "100%", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow sx={modernTableStyles.headerRow}>
                                            <TableCell>Product</TableCell>
                                            <TableCell align="right">Quantity</TableCell>
                                            <TableCell align="right">Unit Price</TableCell>
                                            <TableCell align="right">Total</TableCell>
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
                                                    <TableCell align="right">Rs. {item.selling_price.toLocaleString()}</TableCell>
                                                    <TableCell align="right">Rs. {(item.quantity * item.selling_price).toLocaleString()}</TableCell>
                                                </TableRow>
                                            );
                                        })}
                                        <TableRow sx={modernTableStyles.footerRow}>
                                            <TableCell colSpan={3} align="right">
                                                <strong>Total Amount:</strong>
                                            </TableCell>
                                            <TableCell align="right">
                                                <strong>Rs. {selectedOrder.items?.reduce((sum, item) => sum + (item.quantity * item.selling_price), 0).toLocaleString() || "0"}</strong>
                                            </TableCell>
                                        </TableRow>
                                    </TableBody>
                                </Table>
                            </Paper>
                        </FormSection>

                        {/* Remarks */}
                        <FormSection title="Remarks" columns={1}>
                            <TextField
                                multiline
                                rows={2}
                                fullWidth
                                value={selectedOrder.remarks || "No remarks"}
                                disabled
                                size="small"
                            />
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

            <ConfirmDialog {...confirmDialog.dialogProps} />
        </>
    );
}
