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
    Divider,
    Grid,
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
    TDetailSkeleton,
    TConfirmDialog,
    TStatusChip,
    getStatusProps,
    modernTableStyles,
    showErrorToast,
    useCrudMutation,
    useTConfirmDialog,
} from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";
import SalesFilterPanel from "@/modules/sales/components/ui/SalesFilterPanel";

import { customersApi } from "@/modules/customers/api";
import { Customer } from "@/modules/customers/types";
import { salesApi } from "@/modules/sales/api";
import { commissionsApi } from "@/modules/sales/commission-api";
import ApproverAuthDialog from "../../purchasing/components/ApproverAuthDialog";
import { useReferenceData, ProductRef } from "@/hooks";
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
    const canViewCustomers = usePermission("customers", "view");
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
    const [authDialogOpen, setAuthDialogOpen] = useState(false);
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
        enabled: canViewCustomers,
    });

    // Load agent commission for this invoice if applicable
    const { data: invoiceCommissions } = useQuery({
        queryKey: ["invoice-commissions", selectedOrder?.invoice_no],
        queryFn: () => commissionsApi.getAll({ search: selectedOrder?.invoice_no }),
        enabled: !!selectedOrder?.invoice_no && !!selectedOrder?.customer_agent_id,
    });

    const invoiceCommission = invoiceCommissions?.items?.find(
        (c: any) => c.invoice_id === selectedOrder?.id
    );

    // OPTIMIZED: Single API call for products and branches
    const { data: refData, filteredBranches, defaultBranchCode } = useReferenceData(["products", "branches"]);
    const products = refData?.products || [];
    const branches = filteredBranches || [];

    // Auto-default branch filter for non-superuser users
    useEffect(() => {
      if (defaultBranchCode && filterBranch === null) {
        setFilterBranch(defaultBranchCode);
      }
    }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

    // Create lookup maps
    const customerMap = useMemo(() => {
        const map = new Map<number, Customer>();
        customers.forEach((c) => map.set(c.id, c));
        return map;
    }, [customers]);

    const productMap = useMemo(() => {
        const map = new Map<number, ProductRef>();
        products.forEach((p: ProductRef) => map.set(p.id, p));
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
            // Default: Date Descending (using created_date_time and id as fallback)
            const timeA = a.created_date_time ? new Date(a.created_date_time).getTime() : new Date(a.created_date).getTime();
            const timeB = b.created_date_time ? new Date(b.created_date_time).getTime() : new Date(b.created_date).getTime();
            if (timeB !== timeA) {
                return timeB - timeA;
            }
            return b.id - a.id;
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
    const approveMutation = useCrudMutation({
        mutationFn: ({ id, credentials }: { id: number; credentials?: any }) => salesApi.approve(id, credentials),
        invalidateQueryKeys: [["sales-orders-pending"], ["sales"], ["sales-track-list"]],
        successMessage: "Sales order approved successfully",
        errorMessage: "Failed to approve order",
        onSuccess: (_data, { id }) => {
            // Update list by removing approved item
            queryClient.setQueryData<Invoice[]>(["sales-orders-pending"], (prev) =>
                (prev || []).filter((o) => o.id !== id)
            );
            // Clear selection if it was the approved one
            if (selectedOrder?.id === id) {
                setSelectedOrder(null);
            }
            setAuthDialogOpen(false);
        },
    });

    // Reject mutation (Delete/Cancel)
    const rejectMutation = useCrudMutation({
        mutationFn: ({ id }: { id: number }) =>
            // Using delete for rejection as per discussion/assumption
            salesApi.delete(id),
        invalidateQueryKeys: [["sales-orders-pending"], ["sales"], ["sales-track-list"]],
        successMessage: "Sales order rejected (deleted)",
        errorMessage: "Failed to reject order",
        onSuccess: (_data, variables) => {
            queryClient.setQueryData<Invoice[]>(["sales-orders-pending"], (prev) =>
                (prev || []).filter((o) => o.id !== variables.id)
            );
            if (selectedOrder?.id === variables.id) {
                setSelectedOrder(null);
            }
            setRejectDialogOpen(false);
            setRejectReason("");
        },
    });

    const handleApprove = async () => {
        if (!selectedOrder) return;

        // Check if it's after 6pm (18:00) - Copied logic from PO Approvals
        const currentHour = new Date().getHours();
        const isAfterHours = currentHour >= 18;

        if (isAfterHours) {
            const confirmed = await approveDialog.confirm({
                title: "After-Hours Approval Warning",
                message: `It is currently after 6:00 PM (now: ${new Date().toLocaleTimeString()}). Approving orders after business hours is not recommended. Do you want to approve anyway?`,
                confirmText: "Approve Anyway",
                confirmColor: "warning",
            });
            if (!confirmed) return;
        }

        setAuthDialogOpen(true);
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

    // Fetch recent sales history for the selected customer
    const { data: recentSales = [] } = useQuery({
        queryKey: ["customer-recent-sales", selectedOrder?.customer_id],
        queryFn: () => salesApi.getRecentByCustomer(selectedOrder!.customer_id, 5),
        enabled: !!selectedOrder?.customer_id,
    });

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
                                                Rs. {fmtLKR((order as any).total_amount || 0)}
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
                ) : isLoading ? (
                    <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} showTable />
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
                            {customer?.payment_address && (
                                <TextField label="Payment Address" size="small" value={customer.payment_address} disabled />
                            )}
                            {customer?.delivery_address && (
                                <TextField label="Delivery Address" size="small" value={customer.delivery_address} disabled />
                            )}
                        </FormSection>

                        {/* Credit Information */}
                        <FormSection title="Credit Information" columns={3}>
                            <TextField
                                label="Credit Limit"
                                size="small"
                                value={`Rs. ${fmtLKR(customer?.max_credit_limit || 0)}`}
                                disabled
                                InputProps={{
                                    sx: { color: "text.primary" },
                                }}
                            />
                            <TextField
                                label="Remaining Credit"
                                size="small"
                                value={`Rs. ${fmtLKR(customer?.left_credit_amount ?? customer?.max_credit_limit ?? 0)}`}
                                disabled
                                InputProps={{
                                    sx: {
                                        color: (customer?.left_credit_amount ?? 0) < (selectedOrder?.credit_amount || 0)
                                            ? "error.main"
                                            : "success.main",
                                    },
                                }}
                            />
                            <TextField
                                label="Credit Days"
                                size="small"
                                value={customer?.credit_days ? `${customer.credit_days} days` : "N/A"}
                                disabled
                            />
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
                                <Table size="small" sx={{ tableLayout: "fixed", width: "100%" }}>
                                    <TableHead>
                                        <TableRow sx={modernTableStyles.headerRow}>
                                            <TableCell sx={{ width: 110 }}>Barcode</TableCell>
                                            <TableCell sx={{ width: 200 }}>Product</TableCell>
                                            <TableCell align="right" sx={{ width: 60 }}>Qty</TableCell>
                                            <TableCell align="right" sx={{ width: 120 }}>Unit Price (Rs.)</TableCell>
                                            <TableCell align="right" sx={{ width: 70 }}>Disc %</TableCell>
                                            <TableCell align="center" sx={{ width: 80 }}>Warranty</TableCell>
                                            <TableCell sx={{ width: 120 }}>Remark</TableCell>
                                            <TableCell align="right" sx={{ width: 140 }}>Net Amount (Rs.)</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {selectedOrder.items?.map((item: any, index) => {
                                            const product = productMap.get(item.product_id);
                                            const isTaxInclusive = selectedOrder.is_tax_invoice;
                                            const taxRate = selectedOrder.tax_rate || 0;

                                            const displaySellingPrice = isTaxInclusive && taxRate > 0
                                                ? item.selling_price / (1 + taxRate / 100)
                                                : item.selling_price;

                                            const lineGross = item.quantity * displaySellingPrice;
                                            const discAmt = item.discount_amount > 0
                                                ? (isTaxInclusive && taxRate > 0 ? item.discount_amount / (1 + taxRate / 100) : item.discount_amount)
                                                : lineGross * ((item.discount_percent || 0) / 100);
                                            const netAmount = item.line_total > 0
                                                ? (isTaxInclusive && taxRate > 0 ? item.line_total / (1 + taxRate / 100) : item.line_total)
                                                : lineGross - discAmt;

                                            return (
                                                <TableRow key={index} sx={{
                                                    ...modernTableStyles.bodyRow,
                                                    ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                                                }}>
                                                    <TableCell>
                                                        <Typography
                                                            variant="body2"
                                                            sx={{
                                                                fontFamily: "monospace",
                                                                color: item.barcode ? "success.main" : "text.disabled",
                                                                fontWeight: item.barcode ? 500 : 400
                                                            }}
                                                        >
                                                            {item.barcode || "-"}
                                                        </Typography>
                                                    </TableCell>
                                                    <TableCell>
                                                        {product?.name || `Product #${item.product_id}`}
                                                    </TableCell>
                                                    <TableCell align="right">
                                                        {item.quantity}
                                                    </TableCell>
                                                    <TableCell align="right">
                                                        {fmtLKR(displaySellingPrice)}
                                                    </TableCell>
                                                    <TableCell align="right">
                                                        {(item.discount_percent || 0) > 0 ? (
                                                            <Typography variant="body2" color="warning.main" fontWeight="medium">
                                                                {Number(item.discount_percent).toFixed(1)}%
                                                            </Typography>
                                                        ) : (
                                                            <Typography variant="body2" color="text.disabled">—</Typography>
                                                        )}
                                                    </TableCell>
                                                    <TableCell align="center">
                                                        {item.warrenty_month || "0"} mo
                                                    </TableCell>
                                                    <TableCell>
                                                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                                                            <Typography variant="body2" sx={{ maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                                {item.remark || "-"}
                                                            </Typography>
                                                            <Tooltip title="View Remark">
                                                                <IconButton size="small" onClick={() => { setCurrentItemRemark(item.remark || ""); setItemRemarkModalOpen(true); }}>
                                                                    <MenuBookIcon fontSize="small" />
                                                                </IconButton>
                                                            </Tooltip>
                                                        </Box>
                                                    </TableCell>
                                                    <TableCell align="right">
                                                        <Box sx={{ textAlign: "right" }}>
                                                            <Typography variant="body2" fontWeight="medium">
                                                                {fmtLKR(netAmount)}
                                                            </Typography>
                                                            {(item.discount_percent || 0) > 0 && (
                                                                <Typography variant="caption" color="text.disabled" sx={{ textDecoration: "line-through" }}>
                                                                    {fmtLKR(lineGross)}
                                                                </Typography>
                                                            )}
                                                        </Box>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                        <TableRow sx={modernTableStyles.footerRow}>
                                            <TableCell colSpan={7} align="right">
                                                <strong>Total:</strong>
                                            </TableCell>
                                            <TableCell align="right">
                                                <strong>
                                                    {fmtLKR(selectedOrder.items?.reduce((sum, item: any) => {
                                                        const isTaxInclusive = selectedOrder.is_tax_invoice;
                                                        const taxRate = selectedOrder.tax_rate || 0;
                                                        const displaySellingPrice = isTaxInclusive && taxRate > 0 ? item.selling_price / (1 + taxRate / 100) : item.selling_price;
                                                        const lineGross = item.quantity * displaySellingPrice;
                                                        const discAmt = item.discount_amount > 0 ? (isTaxInclusive && taxRate > 0 ? item.discount_amount / (1 + taxRate / 100) : item.discount_amount) : lineGross * ((item.discount_percent || 0) / 100);
                                                        const netAmount = item.line_total > 0 ? (isTaxInclusive && taxRate > 0 ? item.line_total / (1 + taxRate / 100) : item.line_total) : lineGross - discAmt;
                                                        return sum + netAmount;
                                                    }, 0) || 0)}
                                                </strong>
                                            </TableCell>
                                        </TableRow>
                                    </TableBody>
                                </Table>
                            </Paper>
                        </FormSection>

                        {/* Payment Breakdown (Show for credit & bank transfer payment methods) */}
                        {(selectedOrder.payment_method === "credit" || 
                          selectedOrder.payment_method === "bank_transfer" ||
                          selectedOrder.credit_amount > 0 ||
                          selectedOrder.bank_transfer_amount > 0) && (
                            <FormSection title="Payment Breakdown" columns={1}>
                                <Grid container spacing={3}>
                                    {/* Settlement Breakdown */}
                                    <Grid item xs={12} md={6}>
                                        <Paper variant="outlined" sx={{ p: 2.5, height: "100%", borderRadius: 2 }}>
                                            <Typography variant="subtitle2" color="text.secondary" gutterBottom fontWeight="bold" sx={{ mb: 2 }}>
                                                Settlement Breakdown
                                            </Typography>
                                            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                                                {selectedOrder.cash_amount > 0 && (
                                                    <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                                        <Typography variant="body2" color="text.secondary">Cash Payment</Typography>
                                                        <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(selectedOrder.cash_amount)}</Typography>
                                                    </Box>
                                                )}
                                                {selectedOrder.card_visa_amount > 0 && (
                                                    <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                                        <Typography variant="body2" color="text.secondary">Card Payment (Visa)</Typography>
                                                        <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(selectedOrder.card_visa_amount)}</Typography>
                                                    </Box>
                                                )}
                                                {selectedOrder.card_mastercard_amount > 0 && (
                                                    <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                                        <Typography variant="body2" color="text.secondary">Card Payment (Mastercard)</Typography>
                                                        <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(selectedOrder.card_mastercard_amount)}</Typography>
                                                    </Box>
                                                )}
                                                {selectedOrder.card_amex_amount > 0 && (
                                                    <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                                        <Typography variant="body2" color="text.secondary">Card Payment (Amex)</Typography>
                                                        <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(selectedOrder.card_amex_amount)}</Typography>
                                                    </Box>
                                                )}
                                                {selectedOrder.cheque_amount > 0 && (
                                                    <Box>
                                                        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                                            <Typography variant="body2" color="text.secondary">Cheque Payment</Typography>
                                                            <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(selectedOrder.cheque_amount)}</Typography>
                                                        </Box>
                                                        {(selectedOrder.cheque_number || selectedOrder.cheque_bank || selectedOrder.cheque_date) && (
                                                            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, fontStyle: "italic" }}>
                                                                {selectedOrder.cheque_bank ? `${selectedOrder.cheque_bank} ` : ""}
                                                                {selectedOrder.cheque_number ? `#${selectedOrder.cheque_number} ` : ""}
                                                                {selectedOrder.cheque_date ? `(Due: ${new Date(selectedOrder.cheque_date).toLocaleDateString()})` : ""}
                                                            </Typography>
                                                        )}
                                                    </Box>
                                                )}
                                                {selectedOrder.bank_transfer_amount > 0 && (
                                                    <Box>
                                                        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                                            <Typography variant="body2" color="text.secondary">Bank Transfer</Typography>
                                                            <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(selectedOrder.bank_transfer_amount)}</Typography>
                                                        </Box>
                                                        {(selectedOrder.bank_name || selectedOrder.bank_transfer_ref) && (
                                                            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, fontStyle: "italic" }}>
                                                                {selectedOrder.bank_name ? `${selectedOrder.bank_name} ` : ""}
                                                                {selectedOrder.bank_transfer_ref ? `Ref: ${selectedOrder.bank_transfer_ref}` : ""}
                                                            </Typography>
                                                        )}
                                                    </Box>
                                                )}
                                                {selectedOrder.credit_amount > 0 && (
                                                    <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                                        <Typography variant="body2" color="warning.main" fontWeight="medium">Credit (Owed)</Typography>
                                                        <Typography variant="body2" fontWeight="bold" color="warning.main">Rs. {fmtLKR(selectedOrder.credit_amount)}</Typography>
                                                    </Box>
                                                )}
                                                {selectedOrder.gift_voucher_amount > 0 && (
                                                    <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                                        <Typography variant="body2" color="secondary.main">Gift Voucher</Typography>
                                                        <Typography variant="body2" fontWeight="medium" color="secondary.main">Rs. {fmtLKR(selectedOrder.gift_voucher_amount)}</Typography>
                                                    </Box>
                                                )}
                                                {selectedOrder.credit_note_amount > 0 && (
                                                    <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                                        <Typography variant="body2" color="success.main">Credit Note Redeemed</Typography>
                                                        <Typography variant="body2" fontWeight="medium" color="success.main">Rs. {fmtLKR(selectedOrder.credit_note_amount)}</Typography>
                                                    </Box>
                                                )}
                                            </Box>
                                        </Paper>
                                    </Grid>

                                    {/* Order Financials */}
                                    <Grid item xs={12} md={6}>
                                        <Paper variant="outlined" sx={{ p: 2.5, height: "100%", borderRadius: 2, bgcolor: "grey.50" }}>
                                            <Typography variant="subtitle2" color="text.secondary" gutterBottom fontWeight="bold" sx={{ mb: 2 }}>
                                                Order Financials
                                            </Typography>
                                            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                                                {(() => {
                                                    const isTaxInclusive = selectedOrder.is_tax_invoice;
                                                    const taxRate = selectedOrder.tax_rate || 0;
                                                    const grossTotal = selectedOrder.items?.reduce((sum: number, item: any) => sum + (item.quantity * item.selling_price), 0) || 0;
                                                    const itemDiscounts = selectedOrder.items?.reduce((sum: number, item: any) => sum + (item.discount_amount || (item.selling_price * item.quantity * (item.discount_percent || 0) / 100)), 0) || 0;

                                                    const displayGrossTotal = isTaxInclusive && taxRate > 0 ? grossTotal / (1 + taxRate / 100) : grossTotal;
                                                    const displayItemDiscounts = isTaxInclusive && taxRate > 0 ? itemDiscounts / (1 + taxRate / 100) : itemDiscounts;
                                                    const displaySubtotal = displayGrossTotal - displayItemDiscounts;

                                                    return (
                                                        <>
                                                            <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                                                <Typography variant="body2" color="text.secondary">Gross Total</Typography>
                                                                <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(displayGrossTotal)}</Typography>
                                                            </Box>
                                                            {displayItemDiscounts > 0 && (
                                                                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                                                    <Typography variant="body2" color="error.main">Item Discounts</Typography>
                                                                    <Typography variant="body2" color="error.main" fontWeight="medium">-Rs. {fmtLKR(displayItemDiscounts)}</Typography>
                                                                </Box>
                                                            )}
                                                            <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                                                <Typography variant="body2" color="text.secondary">Subtotal</Typography>
                                                                <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(displaySubtotal)}</Typography>
                                                            </Box>
                                                            {selectedOrder.cupon_amount > 0 && (
                                                                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                                                    <Typography variant="body2" color="error.main">Coupon Discount</Typography>
                                                                    <Typography variant="body2" color="error.main" fontWeight="medium">-Rs. {fmtLKR(selectedOrder.cupon_amount)}</Typography>
                                                                </Box>
                                                            )}
                                                            {selectedOrder.discount_amount > 0 && (
                                                                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                                                    <Typography variant="body2" color="error.main">
                                                                        Invoice Discount {selectedOrder.discount_percent > 0 ? `(${selectedOrder.discount_percent}%)` : ""}
                                                                    </Typography>
                                                                    <Typography variant="body2" color="error.main" fontWeight="medium">-Rs. {fmtLKR(selectedOrder.discount_amount)}</Typography>
                                                                </Box>
                                                            )}
                                                            {selectedOrder.tax_amount > 0 && (
                                                                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                                                    <Typography variant="body2" color="text.secondary">
                                                                        Tax ({selectedOrder.tax_rate}%) {isTaxInclusive ? "(Included)" : ""}
                                                                    </Typography>
                                                                    <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(selectedOrder.tax_amount)}</Typography>
                                                                </Box>
                                                            )}
                                                            {selectedOrder.service_charge_amount > 0 && (
                                                                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                                                    <Typography variant="body2" color="text.secondary">Service Charge ({(selectedOrder.service_charge_rate * 100).toFixed(1)}%)</Typography>
                                                                    <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(selectedOrder.service_charge_amount)}</Typography>
                                                                </Box>
                                                            )}
                                                            <Divider sx={{ my: 0.5 }} />
                                                            <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                                                <Typography variant="subtitle2" fontWeight="bold">Grand Total</Typography>
                                                                <Typography variant="subtitle2" fontWeight="bold">Rs. {fmtLKR(selectedOrder.grand_total)}</Typography>
                                                            </Box>
                                                            <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                                                <Typography variant="body2" fontWeight="medium" color="success.main">Amount Paid</Typography>
                                                                <Typography variant="body2" fontWeight="medium" color="success.main">Rs. {fmtLKR(selectedOrder.paid_amount)}</Typography>
                                                            </Box>
                                                            {selectedOrder.balance_due > 0 && (
                                                                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                                                    <Typography variant="body2" fontWeight="medium" color="error.main">Balance Due</Typography>
                                                                    <Typography variant="body2" fontWeight="medium" color="error.main">Rs. {fmtLKR(selectedOrder.balance_due)}</Typography>
                                                                </Box>
                                                            )}
                                                        </>
                                                    );
                                                })()}
                                            </Box>
                                        </Paper>
                                    </Grid>
                                </Grid>
                            </FormSection>
                        )}

                        {/* Agent Commission Section (Show for credit & bank transfer payment methods) */}
                        {selectedOrder.customer_agent_id && 
                         (selectedOrder.payment_method === "credit" || 
                          selectedOrder.payment_method === "bank_transfer" ||
                          selectedOrder.credit_amount > 0 ||
                          selectedOrder.bank_transfer_amount > 0) && (
                            <FormSection title="Agent Commission" columns={1}>
                                <Paper variant="outlined" sx={{ p: 2.5, borderColor: "primary.main", borderWidth: 1, borderRadius: 2 }}>
                                    {(() => {
                                        const agent = customers?.find((c) => c.id === selectedOrder.customer_agent_id);
                                        return (
                                            <Grid container spacing={2}>
                                                <Grid item xs={12} sm={4}>
                                                    <Typography variant="body2" color="text.secondary">Agent Name</Typography>
                                                    <Typography variant="body1" fontWeight={500}>{agent?.customer_name || `Agent #${selectedOrder.customer_agent_id}`}</Typography>
                                                </Grid>
                                                <Grid item xs={6} sm={2}>
                                                    <Typography variant="body2" color="text.secondary">Commission Rate</Typography>
                                                    <Typography variant="body1" fontWeight={500}>
                                                        {invoiceCommission ? `${Number(invoiceCommission.commission_rate).toFixed(1)}%` : `${Number(agent?.commission_rate || 0).toFixed(1)}%`}
                                                    </Typography>
                                                </Grid>
                                                <Grid item xs={6} sm={2}>
                                                    <Typography variant="body2" color="text.secondary">Status</Typography>
                                                    <Box sx={{ mt: 0.5 }}>
                                                        <Chip
                                                            size="small"
                                                            label={invoiceCommission?.status ? invoiceCommission.status.toUpperCase() : "PENDING"}
                                                            color={
                                                                invoiceCommission?.status === "paid"
                                                                    ? "success"
                                                                    : invoiceCommission?.status === "approved"
                                                                    ? "info"
                                                                    : invoiceCommission?.status === "cancelled"
                                                                    ? "error"
                                                                    : "warning"
                                                            }
                                                        />
                                                    </Box>
                                                </Grid>
                                                <Grid item xs={12} sm={4} sx={{ textAlign: { sm: "right" } }}>
                                                    <Typography variant="body2" color="text.secondary">Commission Amount</Typography>
                                                    <Typography variant="h6" fontWeight="bold" color="primary.main">
                                                        Rs. {fmtLKR(invoiceCommission ? Number(invoiceCommission.commission_amount) : (selectedOrder.grand_total * ((agent?.commission_rate || 0) / 100)))}
                                                    </Typography>
                                                </Grid>
                                            </Grid>
                                        );
                                    })()}
                                </Paper>
                            </FormSection>
                        )}

                        {/* Recent Sales History */}
                        <FormSection title="Recent Sales History (Last 5)" columns={1}>
                            {recentSales.length === 0 ? (
                                <Typography variant="body2" color="text.secondary">No recent sales found for this customer.</Typography>
                            ) : (
                                <Paper variant="outlined" sx={{ overflow: "hidden", width: "100%", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
                                    <Table size="small">
                                        <TableHead>
                                            <TableRow sx={modernTableStyles.headerRow}>
                                                <TableCell>Invoice No</TableCell>
                                                <TableCell>Date</TableCell>
                                                <TableCell>Items</TableCell>
                                                <TableCell align="right">Total (Rs.)</TableCell>
                                                <TableCell align="center">Status</TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {recentSales.map((inv, idx) => (
                                                <TableRow key={inv.id} sx={{
                                                    ...modernTableStyles.bodyRow,
                                                    ...(idx % 2 === 1 && { bgcolor: "grey.25" }),
                                                }}>
                                                    <TableCell>
                                                        <Typography variant="body2" fontWeight={500}>{inv.invoice_no}</Typography>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Typography variant="body2">{new Date(inv.created_date).toLocaleDateString()}</Typography>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.3 }}>
                                                            {inv.items?.map((item, i) => {
                                                                const prod = productMap.get(item.product_id);
                                                                const lineTotal = item.quantity * item.selling_price;
                                                                return (
                                                                    <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
                                                                        <Typography variant="caption" sx={{ fontWeight: 500 }}>
                                                                            {prod?.name || `#${item.product_id}`}
                                                                        </Typography>
                                                                        <Chip
                                                                            label={`${item.quantity} × ${fmtLKR(item.selling_price)}`}
                                                                            size="small"
                                                                            variant="outlined"
                                                                            sx={{ height: 16, fontSize: "0.6rem", borderRadius: 1 }}
                                                                        />
                                                                        <Chip
                                                                            label={`= ${fmtLKR(lineTotal)}`}
                                                                            size="small"
                                                                            color="primary"
                                                                            variant="outlined"
                                                                            sx={{ height: 16, fontSize: "0.6rem", borderRadius: 1 }}
                                                                        />
                                                                    </Box>
                                                                );
                                                            })}
                                                        </Box>
                                                    </TableCell>
                                                    <TableCell align="right">
                                                        <Typography variant="body2" fontWeight={600}>
                                                            {fmtLKR(inv.items?.reduce((s, it) => s + it.quantity * it.selling_price, 0) || 0)}
                                                        </Typography>
                                                    </TableCell>
                                                    <TableCell align="center">
                                                        <TStatusChip status={inv.approval ? "approved" : "pending_approval"} statusMap="salesOrder" />
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </Paper>
                            )}
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

            <ApproverAuthDialog
                open={authDialogOpen}
                onClose={() => setAuthDialogOpen(false)}
                onSubmit={(username, password) => {
                    const credentials = { approver_username: username, approver_password: password };
                    approveMutation.mutate({
                        id: selectedOrder!.id,
                        credentials,
                    });
                }}
                loading={approveMutation.isPending}
                title="Authenticate to Approve"
            />
        </>
    );
}
