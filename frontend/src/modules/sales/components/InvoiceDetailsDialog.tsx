import { useReferenceData } from "@/hooks";
import { formatAmount, formatCurrency } from "@/utils/formatters";
import {
  Close as CloseIcon,
  Print as PrintIcon,
  Receipt as ReceiptIcon,
} from "@mui/icons-material";
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
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { salesApi } from "../api";
import { Invoice } from "../types";
// OPTIMIZED: Removed customersApi, productsApi imports - using aggregated endpoint
import { modernTableStyles, TPrintPreviewDialog } from "@/components/tijaero";
import { format } from "date-fns";
import { useRef, useState } from "react";

interface InvoiceDetailsDialogProps {
  open: boolean;
  invoice: Invoice | null;
  onClose: () => void;
}

export default function InvoiceDetailsDialog({
  open,
  invoice,
  onClose,
}: InvoiceDetailsDialogProps) {
  const printRef = useRef<HTMLDivElement>(null);

  // Fetch full invoice with items
  const { data: invoiceDetails, isLoading } = useQuery({
    queryKey: ["sales", invoice?.id],
    queryFn: () => salesApi.getById(invoice!.id),
    enabled: !!invoice?.id && open,
  });

  // OPTIMIZED: Single API call for customers and products (was 2 calls)
  const { data: refData } = useReferenceData(["customers", "products"], { enabled: open });
  const customers = refData?.customers || [];
  const products = refData?.products || [];

  const customer = customers?.find((c) => c.id === invoiceDetails?.customer_id);
  const getProductName = (productId: number) => {
    const product = products?.find((p) => p.id === productId);
    return product ? `${product.item_code} - ${product.name}` : `Product #${productId}`;
  };

  // Calculate totals
  const calculateSubtotal = () => {
    return invoiceDetails?.items?.reduce(
      (sum, item) => sum + item.quantity * item.selling_price,
      0
    ) || 0;
  };

  const calculateTotal = () => {
    if (!invoiceDetails) return 0;
    return (
      invoiceDetails.cash_amount +
      invoiceDetails.card_visa_amount +
      invoiceDetails.card_mastercard_amount +
      invoiceDetails.card_amex_amount +
      invoiceDetails.cheque_amount +
      invoiceDetails.bank_transfer_amount +
      invoiceDetails.credit_amount
    );
  };

  /* Print Dialog State */
  const [printDialogOpen, setPrintDialogOpen] = useState(false);

  const handlePrint = () => {
    setPrintDialogOpen(true);
  };

  if (!invoice) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <ReceiptIcon color="primary" />
          <Typography variant="h6">Invoice Details</Typography>
        </Box>
        <Box>
          <IconButton onClick={handlePrint} disabled={isLoading}>
            <PrintIcon />
          </IconButton>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent dividers ref={printRef}>
        {isLoading ? (
          <Box>
            <Skeleton variant="text" height={40} />
            <Skeleton variant="rectangular" height={200} sx={{ my: 2 }} />
            <Skeleton variant="text" height={40} />
          </Box>
        ) : invoiceDetails ? (
          <>
            {/* Header */}
            <Paper variant="outlined" sx={{ p: 2, mb: 3, bgcolor: "grey.50" }}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="h5" fontWeight={700} color="primary">
                    {invoiceDetails.invoice_no}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {format(new Date(invoiceDetails.created_date), "MMMM dd, yyyy")}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6} sx={{ textAlign: { sm: "right" } }}>
                  <Chip
                    label={invoiceDetails.status ? "Active" : "Inactive"}
                    color={invoiceDetails.status ? "success" : "default"}
                    sx={{ mr: 1 }}
                  />
                  <Chip
                    label={invoiceDetails.approval ? "Approved" : "Pending Approval"}
                    color={invoiceDetails.approval ? "success" : "warning"}
                    variant="outlined"
                  />
                </Grid>
              </Grid>
            </Paper>

            {/* Customer & Payment Info */}
            <Grid container spacing={3} sx={{ mb: 3 }}>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Customer Information
                </Typography>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="body1" fontWeight={500}>
                    {customer?.customer_name || "N/A"}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {customer?.mobile_contact_number}
                  </Typography>
                  {customer?.email && (
                    <Typography variant="body2" color="text.secondary">
                      {customer.email}
                    </Typography>
                  )}
                </Paper>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Payment Details
                </Typography>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="body1" fontWeight={500} sx={{ textTransform: "capitalize" }}>
                    {invoiceDetails.payment_method.replace(/_/g, " ")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Branch: {invoiceDetails.branch_code}
                  </Typography>
                </Paper>
              </Grid>
            </Grid>

            {/* Items Table */}
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Order Items
            </Typography>
            <Paper variant="outlined" sx={{ mb: 3, borderRadius: 2, border: "1px solid", borderColor: "divider", overflow: "hidden" }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={modernTableStyles.headerRow}>
                    <TableCell>Product</TableCell>
                    <TableCell align="center">Qty</TableCell>
                    <TableCell align="right">Unit Price (Rs.)</TableCell>
                    <TableCell align="center">Warranty</TableCell>
                    <TableCell align="right">Total (Rs.)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {invoiceDetails.items?.length > 0 ? (
                    invoiceDetails.items.map((item, index) => (
                      <TableRow key={item.id} sx={{
                        ...modernTableStyles.bodyRow,
                        ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                      }}>
                        <TableCell>{getProductName(item.product_id)}</TableCell>
                        <TableCell align="center">{item.quantity}</TableCell>
                        <TableCell align="right">{formatAmount(item.selling_price)}</TableCell>
                        <TableCell align="center">{item.warrenty_month} mo</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 500 }}>
                          {formatAmount(item.quantity * item.selling_price)}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} sx={modernTableStyles.emptyCell}>
                        No items found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Paper>

            {/* Payment Breakdown & Total */}
            <Grid container spacing={3}>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Payment Breakdown
                </Typography>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  {invoiceDetails.cash_amount > 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="body2">Cash</Typography>
                      <Typography variant="body2">{formatCurrency(invoiceDetails.cash_amount)}</Typography>
                    </Box>
                  )}
                  {invoiceDetails.card_visa_amount > 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="body2">Visa Card</Typography>
                      <Typography variant="body2">{formatCurrency(invoiceDetails.card_visa_amount)}</Typography>
                    </Box>
                  )}
                  {invoiceDetails.card_mastercard_amount > 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="body2">Mastercard</Typography>
                      <Typography variant="body2">{formatCurrency(invoiceDetails.card_mastercard_amount)}</Typography>
                    </Box>
                  )}
                  {invoiceDetails.card_amex_amount > 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="body2">Amex</Typography>
                      <Typography variant="body2">{formatCurrency(invoiceDetails.card_amex_amount)}</Typography>
                    </Box>
                  )}
                  {invoiceDetails.cheque_amount > 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="body2">Cheque</Typography>
                      <Typography variant="body2">{formatCurrency(invoiceDetails.cheque_amount)}</Typography>
                    </Box>
                  )}
                  {invoiceDetails.bank_transfer_amount > 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="body2">Bank Transfer</Typography>
                      <Typography variant="body2">{formatCurrency(invoiceDetails.bank_transfer_amount)}</Typography>
                    </Box>
                  )}
                  {invoiceDetails.credit_amount > 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="body2">Credit</Typography>
                      <Typography variant="body2">{formatCurrency(invoiceDetails.credit_amount)}</Typography>
                    </Box>
                  )}
                </Paper>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Paper
                  sx={{
                    p: 2,
                    bgcolor: "success.lighter",
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                  }}
                >
                  <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                    <Typography variant="body2">Subtotal</Typography>
                    <Typography variant="body2">{formatCurrency(calculateSubtotal())}</Typography>
                  </Box>
                  {invoiceDetails.payment_adjustments !== 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="body2">Adjustments</Typography>
                      <Typography variant="body2">{formatCurrency(invoiceDetails.payment_adjustments)}</Typography>
                    </Box>
                  )}
                  {invoiceDetails.cupon_amount !== 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="body2">Coupon</Typography>
                      <Typography variant="body2" color="error">-{formatCurrency(invoiceDetails.cupon_amount)}</Typography>
                    </Box>
                  )}
                  {invoiceDetails.credit_note_amount !== 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="body2">Credit Note</Typography>
                      <Typography variant="body2" color="error">-{formatCurrency(invoiceDetails.credit_note_amount)}</Typography>
                    </Box>
                  )}
                  <Divider sx={{ my: 1 }} />
                  <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="h6" fontWeight={700}>Total</Typography>
                    <Typography variant="h5" fontWeight={700} color="success.main">
                      {formatCurrency(calculateTotal())}
                    </Typography>
                  </Box>
                </Paper>
              </Grid>
            </Grid>

            {/* Remarks */}
            {invoiceDetails.remarks && (
              <Box sx={{ mt: 3 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Remarks
                </Typography>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="body2">{invoiceDetails.remarks}</Typography>
                </Paper>
              </Box>
            )}
          </>
        ) : (
          <Typography align="center" color="text.secondary">
            Invoice not found
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" startIcon={<PrintIcon />} onClick={handlePrint} disabled={isLoading}>
          Print Invoice
        </Button>
      </DialogActions>

      {/* Print Preview Dialog */}
      <TPrintPreviewDialog
        open={printDialogOpen}
        onClose={() => setPrintDialogOpen(false)}
        documentType="invoice"
        documentId={invoice?.id || 0}
      />
    </Dialog>
  );
}
