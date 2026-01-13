import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Grid,
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Divider,
  Chip,
  Paper,
  IconButton,
  Skeleton,
} from "@mui/material";
import {
  Print as PrintIcon,
  Close as CloseIcon,
  Receipt as ReceiptIcon,
} from "@mui/icons-material";
import { salesApi } from "../api";
import { Invoice } from "../types";
import { useReferenceData } from "@/hooks";
// OPTIMIZED: Removed customersApi, productsApi imports - using aggregated endpoint
import { format } from "date-fns";
import { useRef } from "react";
import { modernTableStyles } from "@/components/tijaero";

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

  const handlePrint = () => {
    const printContent = printRef.current;
    if (!printContent) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>Invoice ${invoiceDetails?.invoice_no}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f5f5f5; }
            .header { text-align: center; margin-bottom: 20px; }
            .info-row { display: flex; justify-content: space-between; margin: 5px 0; }
            .total { text-align: right; font-size: 18px; font-weight: bold; }
            @media print { button { display: none; } }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>INVOICE</h1>
            <p>${invoiceDetails?.invoice_no}</p>
          </div>
          <div class="info-row">
            <div>
              <strong>Customer:</strong> ${customer?.customer_name || "N/A"}<br/>
              <strong>Contact:</strong> ${customer?.mobile_contact_number || "N/A"}<br/>
              <strong>Email:</strong> ${customer?.email || "N/A"}
            </div>
            <div style="text-align: right;">
              <strong>Date:</strong> ${invoiceDetails ? format(new Date(invoiceDetails.created_date), "MMMM dd, yyyy") : ""}<br/>
              <strong>Branch:</strong> ${invoiceDetails?.branch_code}<br/>
              <strong>Payment:</strong> ${invoiceDetails?.payment_method}
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Qty</th>
                <th>Unit Price</th>
                <th>Warranty</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${invoiceDetails?.items?.map(item => `
                <tr>
                  <td>${getProductName(item.product_id)}</td>
                  <td>${item.quantity}</td>
                  <td>Rs. ${item.selling_price.toFixed(2)}</td>
                  <td>${item.warrenty_month} months</td>
                  <td>Rs. ${(item.quantity * item.selling_price).toFixed(2)}</td>
                </tr>
              `).join("") || ""}
            </tbody>
          </table>
          <div class="total">
            <p>Subtotal: Rs. ${calculateSubtotal().toFixed(2)}</p>
            <p style="font-size: 24px;">Total: Rs. ${calculateTotal().toFixed(2)}</p>
          </div>
          ${invoiceDetails?.remarks ? `<p><strong>Remarks:</strong> ${invoiceDetails.remarks}</p>` : ""}
          <script>window.print();</script>
        </body>
      </html>
    `);
    printWindow.document.close();
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
                    <TableCell align="right">Unit Price</TableCell>
                    <TableCell align="center">Warranty</TableCell>
                    <TableCell align="right">Total</TableCell>
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
                        <TableCell align="right">Rs. {item.selling_price.toFixed(2)}</TableCell>
                        <TableCell align="center">{item.warrenty_month} mo</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 500 }}>
                          Rs. {(item.quantity * item.selling_price).toFixed(2)}
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
                      <Typography variant="body2">Rs. {invoiceDetails.cash_amount.toFixed(2)}</Typography>
                    </Box>
                  )}
                  {invoiceDetails.card_visa_amount > 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="body2">Visa Card</Typography>
                      <Typography variant="body2">Rs. {invoiceDetails.card_visa_amount.toFixed(2)}</Typography>
                    </Box>
                  )}
                  {invoiceDetails.card_mastercard_amount > 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="body2">Mastercard</Typography>
                      <Typography variant="body2">Rs. {invoiceDetails.card_mastercard_amount.toFixed(2)}</Typography>
                    </Box>
                  )}
                  {invoiceDetails.card_amex_amount > 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="body2">Amex</Typography>
                      <Typography variant="body2">Rs. {invoiceDetails.card_amex_amount.toFixed(2)}</Typography>
                    </Box>
                  )}
                  {invoiceDetails.cheque_amount > 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="body2">Cheque</Typography>
                      <Typography variant="body2">Rs. {invoiceDetails.cheque_amount.toFixed(2)}</Typography>
                    </Box>
                  )}
                  {invoiceDetails.bank_transfer_amount > 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="body2">Bank Transfer</Typography>
                      <Typography variant="body2">Rs. {invoiceDetails.bank_transfer_amount.toFixed(2)}</Typography>
                    </Box>
                  )}
                  {invoiceDetails.credit_amount > 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="body2">Credit</Typography>
                      <Typography variant="body2">Rs. {invoiceDetails.credit_amount.toFixed(2)}</Typography>
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
                    <Typography variant="body2">Rs. {calculateSubtotal().toFixed(2)}</Typography>
                  </Box>
                  {invoiceDetails.payment_adjustments !== 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="body2">Adjustments</Typography>
                      <Typography variant="body2">Rs. {invoiceDetails.payment_adjustments.toFixed(2)}</Typography>
                    </Box>
                  )}
                  {invoiceDetails.cupon_amount !== 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="body2">Coupon</Typography>
                      <Typography variant="body2" color="error">-Rs. {invoiceDetails.cupon_amount.toFixed(2)}</Typography>
                    </Box>
                  )}
                  {invoiceDetails.credit_note_amount !== 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="body2">Credit Note</Typography>
                      <Typography variant="body2" color="error">-Rs. {invoiceDetails.credit_note_amount.toFixed(2)}</Typography>
                    </Box>
                  )}
                  <Divider sx={{ my: 1 }} />
                  <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="h6" fontWeight={700}>Total</Typography>
                    <Typography variant="h5" fontWeight={700} color="success.main">
                      Rs. {calculateTotal().toFixed(2)}
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
    </Dialog>
  );
}
