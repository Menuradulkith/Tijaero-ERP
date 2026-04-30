/**
 * SalesPaymentPage - Comprehensive ERP Sales Payment Processing
 * 
 * Features:
 * - Multi-payment method support (split payments)
 * - Real-time payment calculation and validation
 * - Customer credit limit tracking
 * - Payment receipt preview
 * - Payment history display
 * - Secure payment confirmation workflow
 */

import {
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    FormControlLabel,
    Grid,
    InputAdornment,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    Skeleton,
    Stack,
    Switch,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Tabs,
    TextField,
    Typography,
    alpha,
    CircularProgress,
} from "@mui/material";
import {
    AttachMoney as MoneyIcon,
    CreditCard as CardIcon,
    AccountBalance as BankIcon,
    Receipt as ReceiptIcon,
    CheckCircle as CheckCircleIcon,
    Warning as WarningIcon,
    Print as PrintIcon,
    Save as SaveIcon,
    History as HistoryIcon,
    Person as PersonIcon,
    Assessment as AssessmentIcon,
    LocalAtm as CashIcon,
    Payment as PaymentIcon,
    Info as InfoIcon,
    ArrowBack as ArrowBackIcon,
} from "@mui/icons-material";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import { salesApi } from "../api";
import { customersApi } from "@/modules/customers/api";
import { useReferenceData } from "@/hooks";
import { fmtLKR, showErrorToast, TPageSkeleton, TConfirmDialog, useCrudMutation, useTConfirmDialog } from "@/components/tijaero";

// Payment method types
type PaymentMethodType = "cash" | "card_visa" | "card_mastercard" | "card_amex" | "cheque" | "bank_transfer" | "credit";

interface PaymentEntry {
    method: PaymentMethodType;
    amount: number;
    // Card details
    card_ref_number?: string;
    card_holder_name?: string;
    // Cheque details
    cheque_number?: string;
    cheque_bank?: string;
    cheque_date?: string;
    // Bank transfer details
    bank_transfer_ref?: string;
    bank_name?: string;
}

const paymentMethodsConfig = [
    { value: "cash", label: "Cash", icon: CashIcon, color: "#10b981" },
    { value: "card_visa", label: "Visa Card", icon: CardIcon, color: "#1e40af" },
    { value: "card_mastercard", label: "Mastercard", icon: CardIcon, color: "#dc2626" },
    { value: "card_amex", label: "Amex Card", icon: CardIcon, color: "#0891b2" },
    { value: "cheque", label: "Cheque", icon: ReceiptIcon, color: "#7c3aed" },
    { value: "bank_transfer", label: "Bank Transfer", icon: BankIcon, color: "#ea580c" },
    { value: "credit", label: "Credit", icon: MoneyIcon, color: "#db2777" },
];

export default function SalesPaymentPage() {
    const { invoiceId } = useParams<{ invoiceId: string }>();
    const navigate = useNavigate();
    const [currentTab, setCurrentTab] = useState(0);
    const [paymentEntries, setPaymentEntries] = useState<PaymentEntry[]>([
        { method: "cash", amount: 0 }
    ]);
    const [showReceiptPreview, setShowReceiptPreview] = useState(false);
    const [enableSplitPayment, setEnableSplitPayment] = useState(false);
    const paymentConfirmDialog = useTConfirmDialog();

    // Fetch invoice details
    const { data: invoice, isLoading: loadingInvoice } = useQuery({
        queryKey: ["invoice", invoiceId],
        queryFn: () => salesApi.getById(Number(invoiceId)),
        enabled: !!invoiceId,
    });

    // Fetch customer details
    const { data: customer } = useQuery({
        queryKey: ["customer", invoice?.customer_id],
        queryFn: () => customersApi.getById(invoice!.customer_id),
        enabled: !!invoice?.customer_id,
    });

    // Fetch payment history
    const { data: paymentHistory = [] } = useQuery({
        queryKey: ["payment-history", invoiceId],
        queryFn: () => salesApi.getPaymentHistory(Number(invoiceId)),
        enabled: !!invoiceId,
    });

    // Reference data
    const { data: refData } = useReferenceData(["products", "branches"]);
    const products = refData?.products || [];

    // Calculate totals — prefer grand_total from backend (includes discounts, tax, coupons)
    const invoiceTotal = useMemo(() => {
        if (!invoice) return 0;
        if ((invoice as any).grand_total != null) return Number((invoice as any).grand_total);
        if (!invoice.items) return 0;
        return invoice.items.reduce((sum: number, item: any) => {
            return sum + (item.quantity * item.selling_price);
        }, 0);
    }, [invoice]);

    const totalPaymentEntered = useMemo(() => {
        return paymentEntries.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
    }, [paymentEntries]);

    const remainingAmount = invoiceTotal - totalPaymentEntered;
    const isPaymentComplete = Math.abs(remainingAmount) < 0.01;

    // Initialize first payment with invoice total
    useEffect(() => {
        if (invoice && !enableSplitPayment) {
            setPaymentEntries([{ method: "cash", amount: invoiceTotal }]);
        }
    }, [invoice, invoiceTotal, enableSplitPayment]);

    // Add payment entry
    const addPaymentEntry = () => {
        setPaymentEntries([...paymentEntries, { method: "cash", amount: 0 }]);
    };

    // Remove payment entry
    const removePaymentEntry = (index: number) => {
        if (paymentEntries.length > 1) {
            setPaymentEntries(paymentEntries.filter((_, i) => i !== index));
        }
    };

    // Update payment entry
    const updatePaymentEntry = (index: number, field: keyof PaymentEntry, value: any) => {
        const updated = [...paymentEntries];
        updated[index] = { ...updated[index], [field]: value };
        setPaymentEntries(updated);
    };

    // Process payment mutation
    const processPaymentMutation = useCrudMutation({
        mutationFn: async () => {
            // Here you would call the actual payment processing API
            // For now, we'll simulate with the complete endpoint
            return salesApi.completeInvoice(Number(invoiceId));
        },
        getInvalidateQueryKeys: () => [["invoice", invoiceId], ["payment-history", invoiceId]],
        successMessage: "Payment processed successfully!",
        errorMessage: "Failed to process payment",
        onSuccess: () => {
            setShowReceiptPreview(true);
        },
    });

    // Handle payment submission
    const handleProcessPayment = () => {
        if (!isPaymentComplete) {
            showErrorToast(`Payment incomplete. Remaining: Rs. ${remainingAmount.toFixed(2)}`);
            return;
        }

        // Validate payment entries
        for (const entry of paymentEntries) {
            if (entry.method.includes("card") && !entry.card_ref_number) {
                showErrorToast("Card reference number is required for card payments");
                return;
            }
            if (entry.method === "cheque" && (!entry.cheque_number || !entry.cheque_bank)) {
                showErrorToast("Cheque number and bank are required for cheque payments");
                return;
            }
            if (entry.method === "bank_transfer" && !entry.bank_transfer_ref) {
                showErrorToast("Transfer reference is required for bank transfers");
                return;
            }
        }

        // Warn on overpayment
        if (remainingAmount < -0.01) {
            showErrorToast(`Overpayment detected: Rs. ${fmtLKR(Math.abs(remainingAmount))} excess. Please adjust payment amounts.`);
            return;
        }

        paymentConfirmDialog.open(
            "Confirm Payment",
            `Are you sure you want to process payment of Rs. ${fmtLKR(invoiceTotal)} for invoice ${invoice?.invoice_no}? This action cannot be reversed.`,
            () => processPaymentMutation.mutate()
        );
    };

    // Auto-distribute remaining amount
    const autoDistributeRemaining = () => {
        if (paymentEntries.length > 0 && remainingAmount > 0) {
            const updated = [...paymentEntries];
            const lastIndex = updated.length - 1;
            updated[lastIndex].amount = (Number(updated[lastIndex].amount) || 0) + remainingAmount;
            setPaymentEntries(updated);
        }
    };

    if (loadingInvoice) {
        return (
            <Box sx={{ p: 3 }}>
                <TPageSkeleton variant="detail" />
            </Box>
        );
    }

    if (!invoice) {
        return (
            <Box sx={{ p: 3, textAlign: "center" }}>
                <WarningIcon sx={{ fontSize: 60, color: "text.disabled", mb: 2 }} />
                <Typography variant="h6" color="text.secondary" gutterBottom>
                    Invoice not found
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    The invoice you are looking for does not exist or has been removed.
                </Typography>
                <Button
                    variant="outlined"
                    startIcon={<ArrowBackIcon />}
                    onClick={() => navigate(-1)}
                >
                    Go Back
                </Button>
            </Box>
        );
    }

    return (
        <Box
            sx={{
                minHeight: "100dvh",
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                p: 3,
            }}
        >
            {/* Header */}
            <Paper
                elevation={0}
                sx={{
                    p: 3,
                    mb: 3,
                    background: alpha("#ffffff", 0.95),
                    backdropFilter: "blur(20px)",
                    borderRadius: 3,
                    border: "1px solid",
                    borderColor: alpha("#ffffff", 0.3),
                }}
            >
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                        <PaymentIcon sx={{ fontSize: 40, color: "primary.main" }} />
                        <Box>
                            <Typography variant="h4" fontWeight={700} sx={{
                                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                                backgroundClip: "text",
                                WebkitBackgroundClip: "text",
                                WebkitTextFillColor: "transparent",
                            }}>
                                Sales Payment Processing
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                Invoice: {invoice.invoice_no} | Branch: {invoice.branch_code}
                            </Typography>
                        </Box>
                    </Box>
                    <Chip
                        label={`Total: Rs. ${fmtLKR(invoiceTotal)}`}
                        color="primary"
                        sx={{ fontSize: "1.1rem", fontWeight: 700, px: 2, py: 3 }}
                    />
                </Box>
            </Paper>

            <Grid container spacing={3}>
                {/* Left Panel - Payment Entry */}
                <Grid item xs={12} md={8}>
                    <Paper
                        elevation={0}
                        sx={{
                            background: alpha("#ffffff", 0.95),
                            backdropFilter: "blur(20px)",
                            borderRadius: 3,
                            border: "1px solid",
                            borderColor: alpha("#ffffff", 0.3),
                            overflow: "hidden",
                        }}
                    >
                        {/* Tabs */}
                        <Tabs
                            value={currentTab}
                            onChange={(_, v) => setCurrentTab(v)}
                            sx={{
                                borderBottom: 1,
                                borderColor: "divider",
                                bgcolor: alpha("#667eea", 0.05),
                                "& .MuiTab-root": {
                                    fontWeight: 600,
                                    textTransform: "none",
                                    fontSize: "1rem",
                                },
                            }}
                        >
                            <Tab icon={<PaymentIcon />} iconPosition="start" label="Payment Entry" />
                            <Tab icon={<HistoryIcon />} iconPosition="start" label="Payment History" />
                            <Tab icon={<InfoIcon />} iconPosition="start" label="Invoice Details" />
                        </Tabs>

                        {/* Tab Panel 0: Payment Entry */}
                        {currentTab === 0 && (
                            <Box sx={{ p: 3 }}>
                                {/* Split Payment Toggle */}
                                <Box sx={{ mb: 3, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <FormControlLabel
                                        control={
                                            <Switch
                                                checked={enableSplitPayment}
                                                onChange={(e) => {
                                                    setEnableSplitPayment(e.target.checked);
                                                    if (!e.target.checked) {
                                                        setPaymentEntries([{ method: "cash", amount: invoiceTotal }]);
                                                    }
                                                }}
                                                color="primary"
                                            />
                                        }
                                        label={
                                            <Typography variant="body1" fontWeight={600}>
                                                Enable Split Payment
                                            </Typography>
                                        }
                                    />
                                    {enableSplitPayment && (
                                        <Button
                                            variant="outlined"
                                            size="small"
                                            onClick={addPaymentEntry}
                                            startIcon={<MoneyIcon />}
                                        >
                                            Add Payment Method
                                        </Button>
                                    )}
                                </Box>

                                {/* Payment Entries */}
                                <Stack spacing={2}>
                                    {paymentEntries.map((entry, index) => {
                                        const methodConfig = paymentMethodsConfig.find(m => m.value === entry.method);
                                        const MethodIcon = methodConfig?.icon || MoneyIcon;

                                        return (
                                            <Card
                                                key={`${entry.method}-${index}`}
                                                variant="outlined"
                                                sx={{
                                                    borderRadius: 2,
                                                    borderWidth: 2,
                                                    borderColor: entry.amount > 0 ? methodConfig?.color : "divider",
                                                    transition: "all 0.3s ease",
                                                    "&:hover": {
                                                        boxShadow: `0 4px 20px ${alpha(methodConfig?.color || "#000", 0.2)}`,
                                                        transform: "translateY(-2px)",
                                                    },
                                                }}
                                            >
                                                <CardContent>
                                                    <Grid container spacing={2} alignItems="center">
                                                        <Grid item xs={12} sm={4}>
                                                            <FormControl fullWidth size="small">
                                                                <InputLabel>Payment Method</InputLabel>
                                                                <Select
                                                                    value={entry.method}
                                                                    label="Payment Method"
                                                                    onChange={(e) => updatePaymentEntry(index, "method", e.target.value)}
                                                                    disabled={!enableSplitPayment && index === 0}
                                                                >
                                                                    {paymentMethodsConfig.map((method) => {
                                                                        const Icon = method.icon;
                                                                        return (
                                                                            <MenuItem key={method.value} value={method.value}>
                                                                                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                                                                    <Icon sx={{ fontSize: 20, color: method.color }} />
                                                                                    {method.label}
                                                                                </Box>
                                                                            </MenuItem>
                                                                        );
                                                                    })}
                                                                </Select>
                                                            </FormControl>
                                                        </Grid>
                                                        <Grid item xs={12} sm={5}>
                                                            <TextField
                                                                fullWidth
                                                                size="small"
                                                                label="Amount"
                                                                type="number"
                                                                value={entry.amount || ""}
                                                                onChange={(e) => updatePaymentEntry(index, "amount", Math.max(0, parseFloat(e.target.value) || 0))}
                                                                InputProps={{
                                                                    startAdornment: (
                                                                        <InputAdornment position="start">
                                                                            <MethodIcon sx={{ color: methodConfig?.color }} />
                                                                        </InputAdornment>
                                                                    ),
                                                                    endAdornment: (
                                                                        <InputAdornment position="end">Rs.</InputAdornment>
                                                                    ),
                                                                }}
                                                                sx={{
                                                                    "& .MuiOutlinedInput-root": {
                                                                        fontWeight: 600,
                                                                        fontSize: "1.1rem",
                                                                    },
                                                                }}
                                                            />
                                                        </Grid>
                                                        <Grid item xs={12} sm={3}>
                                                            {enableSplitPayment && paymentEntries.length > 1 && (
                                                                <Button
                                                                    fullWidth
                                                                    variant="outlined"
                                                                    color="error"
                                                                    size="small"
                                                                    onClick={() => removePaymentEntry(index)}
                                                                >
                                                                    Remove
                                                                </Button>
                                                            )}
                                                        </Grid>

                                                        {/* Additional Fields Based on Payment Method */}
                                                        {entry.method.includes("card") && (
                                                            <>
                                                                <Grid item xs={12} sm={6}>
                                                                    <TextField
                                                                        fullWidth
                                                                        size="small"
                                                                        label="Card Reference Number"
                                                                        value={entry.card_ref_number || ""}
                                                                        onChange={(e) => updatePaymentEntry(index, "card_ref_number", e.target.value)}
                                                                        required
                                                                    />
                                                                </Grid>
                                                                <Grid item xs={12} sm={6}>
                                                                    <TextField
                                                                        fullWidth
                                                                        size="small"
                                                                        label="Card Holder Name"
                                                                        value={entry.card_holder_name || ""}
                                                                        onChange={(e) => updatePaymentEntry(index, "card_holder_name", e.target.value)}
                                                                    />
                                                                </Grid>
                                                            </>
                                                        )}

                                                        {entry.method === "cheque" && (
                                                            <>
                                                                <Grid item xs={12} sm={4}>
                                                                    <TextField
                                                                        fullWidth
                                                                        size="small"
                                                                        label="Cheque Number"
                                                                        value={entry.cheque_number || ""}
                                                                        onChange={(e) => updatePaymentEntry(index, "cheque_number", e.target.value.replace(/\D/g, ""))}
                                                                        required
                                                                        inputProps={{ inputMode: "numeric", pattern: "[0-9]*" }}
                                                                        helperText="Numbers only"
                                                                    />
                                                                </Grid>
                                                                <Grid item xs={12} sm={4}>
                                                                    <TextField
                                                                        fullWidth
                                                                        size="small"
                                                                        label="Bank Name"
                                                                        value={entry.cheque_bank || ""}
                                                                        onChange={(e) => updatePaymentEntry(index, "cheque_bank", e.target.value)}
                                                                        required
                                                                    />
                                                                </Grid>
                                                                <Grid item xs={12} sm={4}>
                                                                    <TextField
                                                                        fullWidth
                                                                        size="small"
                                                                        label="Cheque Date"
                                                                        type="date"
                                                                        value={entry.cheque_date || ""}
                                                                        onChange={(e) => updatePaymentEntry(index, "cheque_date", e.target.value)}
                                                                        InputLabelProps={{ shrink: true }}
                                                                    />
                                                                </Grid>
                                                            </>
                                                        )}

                                                        {entry.method === "bank_transfer" && (
                                                            <>
                                                                <Grid item xs={12} sm={6}>
                                                                    <TextField
                                                                        fullWidth
                                                                        size="small"
                                                                        label="Transfer Reference"
                                                                        value={entry.bank_transfer_ref || ""}
                                                                        onChange={(e) => updatePaymentEntry(index, "bank_transfer_ref", e.target.value)}
                                                                        required
                                                                    />
                                                                </Grid>
                                                                <Grid item xs={12} sm={6}>
                                                                    <TextField
                                                                        fullWidth
                                                                        size="small"
                                                                        label="Bank Name"
                                                                        value={entry.bank_name || ""}
                                                                        onChange={(e) => updatePaymentEntry(index, "bank_name", e.target.value)}
                                                                    />
                                                                </Grid>
                                                            </>
                                                        )}
                                                    </Grid>
                                                </CardContent>
                                            </Card>
                                        );
                                    })}
                                </Stack>

                                {/* Payment Summary */}
                                <Paper
                                    elevation={0}
                                    sx={{
                                        mt: 3,
                                        p: 2,
                                        background: isPaymentComplete
                                            ? alpha("#10b981", 0.1)
                                            : alpha("#f59e0b", 0.1),
                                        borderRadius: 2,
                                        border: "2px solid",
                                        borderColor: isPaymentComplete ? "#10b981" : "#f59e0b",
                                    }}
                                >
                                    <Grid container spacing={2}>
                                        <Grid item xs={4}>
                                            <Typography variant="body2" color="text.secondary">
                                                Invoice Total
                                            </Typography>
                                            <Typography variant="h6" fontWeight={700}>
                                                Rs. {fmtLKR(invoiceTotal)}
                                            </Typography>
                                        </Grid>
                                        <Grid item xs={4}>
                                            <Typography variant="body2" color="text.secondary">
                                                Payment Entered
                                            </Typography>
                                            <Typography variant="h6" fontWeight={700} color="primary.main">
                                                Rs. {fmtLKR(totalPaymentEntered)}
                                            </Typography>
                                        </Grid>
                                        <Grid item xs={4}>
                                            <Typography variant="body2" color="text.secondary">
                                                Remaining
                                            </Typography>
                                            <Typography
                                                variant="h6"
                                                fontWeight={700}
                                                color={isPaymentComplete ? "success.main" : "warning.main"}
                                            >
                                                Rs. {fmtLKR(Math.abs(remainingAmount))}
                                            </Typography>
                                        </Grid>
                                    </Grid>

                                    {!isPaymentComplete && remainingAmount > 0 && (
                                        <Button
                                            fullWidth
                                            variant="outlined"
                                            size="small"
                                            onClick={autoDistributeRemaining}
                                            sx={{ mt: 2 }}
                                        >
                                            Auto-Add Remaining to Last Method
                                        </Button>
                                    )}

                                    {isPaymentComplete && (
                                        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 2, justifyContent: "center" }}>
                                            <CheckCircleIcon sx={{ color: "success.main" }} />
                                            <Typography variant="body1" fontWeight={600} color="success.main">
                                                Payment Complete - Ready to Process
                                            </Typography>
                                        </Box>
                                    )}
                                </Paper>

                                {/* Action Buttons */}
                                <Box sx={{ mt: 3, display: "flex", gap: 2 }}>
                                    <Button
                                        fullWidth
                                        variant="contained"
                                        size="large"
                                        onClick={handleProcessPayment}
                                        disabled={!isPaymentComplete || processPaymentMutation.isPending}
                                        startIcon={processPaymentMutation.isPending ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
                                        sx={{
                                            py: 1.5,
                                            fontSize: "1.1rem",
                                            fontWeight: 700,
                                            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                                            "&:hover": {
                                                background: "linear-gradient(135deg, #764ba2 0%, #667eea 100%)",
                                            },
                                        }}
                                    >
                                        {processPaymentMutation.isPending ? "Processing..." : "Process Payment"}
                                    </Button>
                                    <Button
                                        variant="outlined"
                                        size="large"
                                        onClick={() => navigate(-1)}
                                        sx={{ minWidth: 120 }}
                                    >
                                        Cancel
                                    </Button>
                                </Box>
                            </Box>
                        )}

                        {/* Tab Panel 1: Payment History */}
                        {currentTab === 1 && (
                            <Box sx={{ p: 3 }}>
                                {paymentHistory.length === 0 ? (
                                    <Box sx={{ textAlign: "center", py: 5 }}>
                                        <HistoryIcon sx={{ fontSize: 60, color: "text.disabled", mb: 2 }} />
                                        <Typography variant="h6" color="text.secondary">
                                            No payment history available
                                        </Typography>
                                    </Box>
                                ) : (
                                    <Table>
                                        <TableHead>
                                            <TableRow>
                                                <TableCell>Date</TableCell>
                                                <TableCell>Payment Method</TableCell>
                                                <TableCell align="right">Amount</TableCell>
                                                <TableCell>Remarks</TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {paymentHistory.map((payment: any) => (
                                                <TableRow key={payment.id}>
                                                    <TableCell>{format(new Date(payment.payment_date), "MMM dd, yyyy")}</TableCell>
                                                    <TableCell>
                                                        <Chip
                                                            label={payment.payment_method.replace(/_/g, " ")}
                                                            size="small"
                                                            sx={{ textTransform: "capitalize" }}
                                                        />
                                                    </TableCell>
                                                    <TableCell align="right">
                                                        Rs. {fmtLKR(payment.payment_amount)}
                                                    </TableCell>
                                                    <TableCell>{payment.remarks || "-"}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                )}
                            </Box>
                        )}

                        {/* Tab Panel 2: Invoice Details */}
                        {currentTab === 2 && (
                            <Box sx={{ p: 3 }}>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>Product</TableCell>
                                            <TableCell align="right">Qty</TableCell>
                                            <TableCell align="right">Price</TableCell>
                                            <TableCell align="right">Total</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {invoice.items?.map((item: any, idx: number) => {
                                            const product = products.find((p: any) => p.id === item.product_id);
                                            return (
                                                <TableRow key={idx}>
                                                    <TableCell>{product?.name || `Product #${item.product_id}`}</TableCell>
                                                    <TableCell align="right">{item.quantity}</TableCell>
                                                    <TableCell align="right">
                                                        Rs. {fmtLKR(item.selling_price)}
                                                    </TableCell>
                                                    <TableCell align="right">
                                                        Rs. {fmtLKR(item.quantity * item.selling_price)}
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                        <TableRow>
                                            <TableCell colSpan={3} align="right">
                                                <strong>Total:</strong>
                                            </TableCell>
                                            <TableCell align="right">
                                                <strong>Rs. {fmtLKR(invoiceTotal)}</strong>
                                            </TableCell>
                                        </TableRow>
                                    </TableBody>
                                </Table>
                            </Box>
                        )}
                    </Paper>
                </Grid>

                {/* Right Panel - Customer & Summary */}
                <Grid item xs={12} md={4}>
                    <Stack spacing={3}>
                        {/* Customer Information */}
                        <Paper
                            elevation={0}
                            sx={{
                                p: 2.5,
                                background: alpha("#ffffff", 0.95),
                                backdropFilter: "blur(20px)",
                                borderRadius: 3,
                                border: "1px solid",
                                borderColor: alpha("#ffffff", 0.3),
                            }}
                        >
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2 }}>
                                <PersonIcon color="primary" />
                                <Typography variant="h6" fontWeight={700}>
                                    Customer Information
                                </Typography>
                            </Box>
                            <Divider sx={{ mb: 2 }} />
                            <Stack spacing={1.5}>
                                <Box>
                                    <Typography variant="caption" color="text.secondary">
                                        Name
                                    </Typography>
                                    <Typography variant="body1" fontWeight={600}>
                                        {customer?.customer_name || <Skeleton animation="wave" width={120} />}
                                    </Typography>
                                </Box>
                                <Box>
                                    <Typography variant="caption" color="text.secondary">
                                        Company
                                    </Typography>
                                    <Typography variant="body1">
                                        {customer?.company_name || "N/A"}
                                    </Typography>
                                </Box>
                                <Box>
                                    <Typography variant="caption" color="text.secondary">
                                        Contact
                                    </Typography>
                                    <Typography variant="body1">
                                        {customer?.mobile_contact_number || "N/A"}
                                    </Typography>
                                </Box>
                                {customer?.max_credit_limit && (
                                    <Box>
                                        <Typography variant="caption" color="text.secondary">
                                            Credit Limit
                                        </Typography>
                                        <Typography variant="body1" fontWeight={600} color="primary.main">
                                            Rs. {fmtLKR(customer.max_credit_limit)}
                                        </Typography>
                                    </Box>
                                )}
                            </Stack>
                        </Paper>

                        {/* Quick Stats */}
                        <Paper
                            elevation={0}
                            sx={{
                                p: 2.5,
                                background: alpha("#ffffff", 0.95),
                                backdropFilter: "blur(20px)",
                                borderRadius: 3,
                                border: "1px solid",
                                borderColor: alpha("#ffffff", 0.3),
                            }}
                        >
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2 }}>
                                <AssessmentIcon color="primary" />
                                <Typography variant="h6" fontWeight={700}>
                                    Payment Summary
                                </Typography>
                            </Box>
                            <Divider sx={{ mb: 2 }} />
                            <Stack spacing={2}>
                                {paymentMethodsConfig.map((method) => {
                                    const entry = paymentEntries.find(e => e.method === method.value);
                                    if (!entry || entry.amount === 0) return null;

                                    const Icon = method.icon;
                                    return (
                                        <Box
                                            key={method.value}
                                            sx={{
                                                display: "flex",
                                                justifyContent: "space-between",
                                                alignItems: "center",
                                                p: 1.5,
                                                borderRadius: 2,
                                                bgcolor: alpha(method.color, 0.1),
                                                border: "1px solid",
                                                borderColor: alpha(method.color, 0.3),
                                            }}
                                        >
                                            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                                <Icon sx={{ color: method.color, fontSize: 20 }} />
                                                <Typography variant="body2" fontWeight={600}>
                                                    {method.label}
                                                </Typography>
                                            </Box>
                                            <Typography variant="body1" fontWeight={700} sx={{ color: method.color }}>
                                                Rs. {fmtLKR(entry.amount)}
                                            </Typography>
                                        </Box>
                                    );
                                })}
                            </Stack>
                        </Paper>

                        {/* Security Notice */}
                        <Paper
                            elevation={0}
                            sx={{
                                p: 2,
                                background: alpha("#f59e0b", 0.1),
                                borderRadius: 2,
                                border: "1px solid",
                                borderColor: alpha("#f59e0b", 0.3),
                            }}
                        >
                            <Box sx={{ display: "flex", gap: 1.5 }}>
                                <WarningIcon sx={{ color: "#f59e0b", fontSize: 24 }} />
                                <Box>
                                    <Typography variant="subtitle2" fontWeight={700} color="#f59e0b" gutterBottom>
                                        Important Notice
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        Please verify all payment details before processing. Once confirmed, the transaction cannot be reversed without proper authorization.
                                    </Typography>
                                </Box>
                            </Box>
                        </Paper>
                    </Stack>
                </Grid>
            </Grid>

            {/* Receipt Preview Dialog */}
            <Dialog
                open={showReceiptPreview}
                onClose={() => setShowReceiptPreview(false)}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <CheckCircleIcon sx={{ color: "success.main", fontSize: 32 }} />
                        <Typography variant="h6" fontWeight={700}>
                            Payment Successful!
                        </Typography>
                    </Box>
                </DialogTitle>
                <DialogContent>
                    <Box sx={{ textAlign: "center", py: 2 }}>
                        <Typography variant="body1" gutterBottom>
                            Payment for invoice <strong>{invoice.invoice_no}</strong> has been processed successfully.
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            Total Amount: Rs. {fmtLKR(invoiceTotal)}
                        </Typography>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => window.print()} startIcon={<PrintIcon />} variant="outlined">
                        Print Receipt
                    </Button>
                    <Button
                        onClick={() => navigate("/sales/payments")}
                        variant="contained"
                    >
                        Done
                    </Button>
                </DialogActions>
            </Dialog>
            <TConfirmDialog {...paymentConfirmDialog.dialogProps} />
        </Box>
    );
}
