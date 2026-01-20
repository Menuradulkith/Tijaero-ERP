/**
 * CustomerPaymentDashboard - Customer Payment Dashboard
 * Shows completed cash sales orders for payment processing and receipt printing
 * This page is shown after creating a cash/card/cheque/bank transfer order
 */

import {
    Box,
    Button,
    Chip,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Typography,
} from "@mui/material";
import {
    CheckCircle as CheckCircleIcon,
    Print as PrintIcon,
    Receipt as ReceiptIcon,
    ArrowBack as ArrowBackIcon,
} from "@mui/icons-material";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
    DetailPanelHeader,
    EmptyState,
    FormSection,
    MasterDetailLayout,
    modernTableStyles,
    SearchableList,
    SelectableListItem,
    SortOption,
} from "@/components/tijaero";
import SalesFilterPanel from "@/modules/sales/components/ui/SalesFilterPanel";
import { useReferenceData } from "@/hooks";
import { customersApi } from "@/modules/customers/api";
import { salesApi } from "../api";
import { Invoice, InvoiceWithItems } from "../types";
import { format } from "date-fns";

// Sort options
const sortOptions: SortOption[] = [
    { value: "created_date", label: "Date (Newest)" },
    { value: "invoice_no", label: "Invoice No" },
];

export default function CustomerPaymentDashboard() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const highlightInvoiceNo = searchParams.get("invoice");

    const [searchQuery, setSearchQuery] = useState("");
    const [sortField, setSortField] = useState("created_date");
    const [filterBranch, setFilterBranch] = useState<string | null>(null);
    const [selectedOrder, setSelectedOrder] = useState<InvoiceWithItems | null>(null);

    // Fetch approved invoices (cash/card/cheque/bank transfer orders)
    const { data: invoices = [], isLoading, refetch } = useQuery({
        queryKey: ["sales-approved"],
        queryFn: () => salesApi.getAll(),
        select: (data) => data.filter((inv: Invoice) => inv.approval_status === "completed"),
    });

    // Fetch customers
    const { data: customers = [] } = useQuery({
        queryKey: ["customers"],
        queryFn: () => customersApi.getAll(),
    });

    // Reference data for branches and products
    const { data: refData } = useReferenceData(["products", "branches"]);
    const products = refData?.products || [];
    const branches = refData?.branches || [];

    // Customer lookup
    const customerMap = useMemo(() => {
        const map = new Map();
        customers.forEach((c: any) => map.set(c.id, c));
        return map;
    }, [customers]);

    // Product lookup
    const productMap = useMemo(() => {
        const map = new Map();
        products.forEach((p: any) => map.set(p.id, p));
        return map;
    }, [products]);

    // Filter and sort
    const filteredInvoices = useMemo(() => {
        let filtered = invoices.filter((invoice: Invoice) => {
            // Search filter
            const customer = customerMap.get(invoice.customer_id);
            const matchesSearch =
                invoice.invoice_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
                customer?.customer_name?.toLowerCase().includes(searchQuery.toLowerCase());

            // Branch filter
            const matchesBranch = !filterBranch || invoice.branch_code === filterBranch;

            return matchesSearch && matchesBranch;
        });

        // Sort
        filtered.sort((a: Invoice, b: Invoice) => {
            if (sortField === "invoice_no") {
                return a.invoice_no.localeCompare(b.invoice_no);
            }
            return new Date(b.created_date).getTime() - new Date(a.created_date).getTime();
        });

        return filtered;
    }, [invoices, searchQuery, filterBranch, sortField, customerMap]);

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

    // Handle selection
    const handleSelectInvoice = async (invoice: Invoice) => {
        try {
            const fullOrder = await salesApi.getById(invoice.id);
            setSelectedOrder(fullOrder);
        } catch {
            console.error("Failed to load order details");
        }
    };

    // Auto-select highlighted invoice from URL
    useEffect(() => {
        if (highlightInvoiceNo && filteredInvoices.length > 0) {
            const invoice = filteredInvoices.find((inv: Invoice) => inv.invoice_no === highlightInvoiceNo);
            if (invoice) {
                handleSelectInvoice(invoice);
            }
        } else if (filteredInvoices.length > 0 && !selectedOrder) {
            handleSelectInvoice(filteredInvoices[0]);
        }
    }, [filteredInvoices, highlightInvoiceNo, selectedOrder]);

    // Print receipt
    const handlePrint = () => {
        if (selectedOrder) {
            window.print();
        }
    };

    // Master Panel
    const masterPanel = (
        <SearchableList
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search by invoice no or customer..."
            sortOptions={sortOptions}
            currentSort={sortField}
            onSortChange={setSortField}
            isLoading={isLoading}
            emptyMessage="No completed orders found"
            listHeader={
                <SalesFilterPanel
                    branches={branches}
                    branchValue={filterBranch}
                    onBranchChange={setFilterBranch}
                />
            }
        >
            {filteredInvoices.map((invoice: Invoice) => {
                const isSelected = selectedOrder?.id === invoice.id;
                const isHighlighted = invoice.invoice_no === highlightInvoiceNo;
                const customer = customerMap.get(invoice.customer_id);

                return (
                    <SelectableListItem
                        key={invoice.id}
                        isSelected={isSelected}
                        onClick={() => handleSelectInvoice(invoice)}
                        primaryText={
                            <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
                                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                        <span>{invoice.invoice_no}</span>
                                        {isHighlighted && (
                                            <Chip
                                                label="NEW"
                                                size="small"
                                                color="success"
                                                sx={{ height: 18, fontSize: "0.65rem" }}
                                            />
                                        )}
                                    </Box>
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
                                                {customer?.customer_name || "Unknown Customer"}
                                            </Typography>
                                            <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                                                (Customer)
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                            <Typography component="span" variant="caption" fontWeight={600} color="success.main">
                                                Rs. {calculateTotal(invoice).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </Typography>
                                            <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                                                (Total)
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                            <Typography component="span" variant="caption">
                                                {format(new Date(invoice.created_date), "MMM dd, yyyy")}
                                            </Typography>
                                            <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                                                (Date)
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: "flex", gap: 0.5, mt: 0.5 }}>
                                            <Chip
                                                label={invoice.payment_method?.replace(/_/g, " ")}
                                                size="small"
                                                color="primary"
                                                variant="outlined"
                                                sx={{ height: 18, fontSize: "0.65rem", textTransform: "capitalize" }}
                                            />
                                            <Chip
                                                label="Completed"
                                                size="small"
                                                color="success"
                                                sx={{ height: 18, fontSize: "0.65rem" }}
                                            />
                                        </Box>
                                    </>
                                )}
                            </Box>
                        }
                        secondaryText={
                            !isSelected
                                ? `${customer?.customer_name || "Unknown"} - Rs. ${calculateTotal(invoice).toLocaleString("en-LK", { minimumFractionDigits: 2 })}`
                                : undefined
                        }
                    />
                );
            })}
        </SearchableList>
    );

    // Detail Panel
    const detailPanel = (
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <DetailPanelHeader
                breadcrumbs={[
                    { label: "Sales" },
                    { label: "Customer Payments", href: "/sales/payments" },
                    ...(selectedOrder ? [{ label: selectedOrder.invoice_no }] : []),
                ]}
                title={selectedOrder?.invoice_no || ""}
                titleIcon={<ReceiptIcon color="primary" />}
                noSelectionTitle="Select an Order"
                chips={selectedOrder ? [
                    { label: "Payment Complete", color: "success" },
                    { label: selectedOrder.payment_method?.replace(/_/g, " ") || "", color: "default", variant: "outlined" },
                ] : []}
            />

            {/* Action Buttons */}
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
                        startIcon={<PrintIcon />}
                        onClick={handlePrint}
                    >
                        Print Receipt
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={<ArrowBackIcon />}
                        onClick={() => navigate("/sales/orders")}
                    >
                        Back to Orders
                    </Button>
                </Box>
            )}

            <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
                {!selectedOrder ? (
                    <EmptyState message="Select an order from the list to view details" />
                ) : (
                    <>
                        {/* Payment Confirmation */}
                        <Paper
                            variant="outlined"
                            sx={{
                                p: 2,
                                mb: 2,
                                bgcolor: "success.light",
                                borderColor: "success.main",
                                display: "flex",
                                alignItems: "center",
                                gap: 2,
                            }}
                        >
                            <CheckCircleIcon color="success" sx={{ fontSize: 40 }} />
                            <Box>
                                <Typography variant="h6" color="success.dark">
                                    Payment Completed Successfully
                                </Typography>
                                <Typography variant="body2" color="success.dark">
                                    Invoice {selectedOrder.invoice_no} has been processed. You can print the receipt below.
                                </Typography>
                            </Box>
                        </Paper>

                        {/* Order Information */}
                        <FormSection title="Order Information" columns={3}>
                            <TextField label="Invoice Number" size="small" value={selectedOrder.invoice_no} disabled />
                            <TextField label="Branch" size="small" value={selectedOrder.branch_code} disabled />
                            <TextField label="Payment Method" size="small" value={selectedOrder.payment_method?.replace(/_/g, " ")} disabled />
                        </FormSection>

                        {/* Customer Information */}
                        <FormSection title="Customer Information" columns={2}>
                            {(() => {
                                const customer = customerMap.get(selectedOrder.customer_id);
                                return (
                                    <>
                                        <TextField label="Customer Name" size="small" value={customer?.customer_name || ""} disabled />
                                        <TextField label="Company" size="small" value={customer?.company_name || "N/A"} disabled />
                                        <TextField label="Contact" size="small" value={customer?.mobile_contact_number || ""} disabled />
                                        <TextField label="Email" size="small" value={customer?.email || "N/A"} disabled />
                                    </>
                                );
                            })()}
                        </FormSection>

                        {/* Payment Summary */}
                        <FormSection title="Payment Summary" columns={2}>
                            <TextField
                                label="Payment Date"
                                size="small"
                                value={new Date(selectedOrder.created_date).toLocaleDateString()}
                                disabled
                            />
                            <TextField
                                label="Total Amount"
                                size="small"
                                value={`Rs. ${calculateTotal(selectedOrder).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                disabled
                                InputProps={{
                                    sx: { fontWeight: 700, color: "success.main" }
                                }}
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
                                            <TableCell align="right">Amount (Rs.)</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {selectedOrder.items?.map((item: any, index: number) => {
                                            const product = productMap.get(item.product_id);
                                            return (
                                                <TableRow key={index} sx={{
                                                    ...modernTableStyles.bodyRow,
                                                    ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                                                }}>
                                                    <TableCell>{product?.name || product?.product_name || `Product #${item.product_id}`}</TableCell>
                                                    <TableCell align="right">{item.quantity}</TableCell>
                                                    <TableCell align="right">{item.selling_price.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                                    <TableCell align="center">{item.warrenty_month || "0"} mo</TableCell>
                                                    <TableCell align="right">{(item.quantity * item.selling_price).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                                </TableRow>
                                            );
                                        })}
                                        <TableRow sx={modernTableStyles.footerRow}>
                                            <TableCell colSpan={4} align="right">
                                                <strong>Total:</strong>
                                            </TableCell>
                                            <TableCell align="right">
                                                <strong>{(selectedOrder.items?.reduce((sum: number, item: any) => sum + (item.quantity * item.selling_price), 0) || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                                            </TableCell>
                                        </TableRow>
                                    </TableBody>
                                </Table>
                            </Paper>
                        </FormSection>

                        {/* Remarks */}
                        {selectedOrder.remarks && (
                            <FormSection title="Remarks" columns={1}>
                                <TextField
                                    multiline
                                    rows={2}
                                    fullWidth
                                    value={selectedOrder.remarks}
                                    disabled
                                    size="small"
                                />
                            </FormSection>
                        )}
                    </>
                )}
            </Box>
        </Box>
    );

    return (
        <MasterDetailLayout
            title="Customer Payment Dashboard"
            icon={<ReceiptIcon color="primary" />}
            onRefresh={() => refetch()}
            isLoading={isLoading}
            masterPanel={masterPanel}
            detailPanel={detailPanel}
        />
    );
}
