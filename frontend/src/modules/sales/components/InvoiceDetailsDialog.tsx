import { useReferenceData } from "@/hooks";
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
import { commissionsApi } from "../commission-api";
import { Invoice } from "../types";
import { getPaymentMethodsDisplay } from "../pages/SalesPage";
// OPTIMIZED: Removed customersApi, productsApi imports - using aggregated endpoint
import { modernTableStyles, TPrintPreviewDialog, fmtLKR, canPrintDocument } from "@/components/tijaero";
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

  // Load agent commission for this invoice if applicable
  const { data: invoiceCommissions } = useQuery({
    queryKey: ["invoice-commissions", invoiceDetails?.invoice_no],
    queryFn: () => commissionsApi.getAll({ search: invoiceDetails?.invoice_no }),
    enabled: !!invoiceDetails?.invoice_no && !!invoiceDetails?.customer_agent_id && open,
  });

  const invoiceCommission = invoiceCommissions?.items?.find(
    (c: any) => c.invoice_id === invoiceDetails?.id
  );

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
          <IconButton onClick={handlePrint} disabled={isLoading || !canPrintDocument(invoiceDetails?.approval_status ?? invoice?.approval_status, ["cancelled"])}>
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
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Created By: {invoiceDetails.created_by_name || "—"}
                  </Typography>
                  {((invoiceDetails.credit_amount ?? 0) > 0 || invoiceDetails.payment_method?.toLowerCase() === "credit") && (
                    <Typography variant="body2" color="text.secondary">
                      Approved By: {invoiceDetails.approved_by_name || "—"}
                      {invoiceDetails.approved_date && ` (on ${format(new Date(invoiceDetails.approved_date), "MMMM dd, yyyy HH:mm")})`}
                    </Typography>
                  )}
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
                    {getPaymentMethodsDisplay(invoiceDetails)}
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
                    <TableCell align="right">Disc %</TableCell>
                    <TableCell align="center">Warranty</TableCell>
                    <TableCell align="right">Net Amount (Rs.)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {invoiceDetails.items?.length > 0 ? (
                    invoiceDetails.items.map((item, index) => {
                      const isTaxInclusive = invoiceDetails.is_tax_invoice;
                      const taxRate = invoiceDetails.tax_rate || 0;

                      const displaySellingPrice = isTaxInclusive && taxRate > 0
                        ? item.selling_price / (1 + taxRate / 100)
                        : item.selling_price;

                      const lineGross = item.quantity * displaySellingPrice;
                      const discAmt = (item.discount_amount ?? 0) > 0
                        ? (isTaxInclusive && taxRate > 0 ? (item.discount_amount ?? 0) / (1 + taxRate / 100) : (item.discount_amount ?? 0))
                        : lineGross * ((item.discount_percent || 0) / 100);
                      const netAmount = (item.line_total ?? 0) > 0
                        ? (isTaxInclusive && taxRate > 0 ? (item.line_total ?? 0) / (1 + taxRate / 100) : (item.line_total ?? 0))
                        : lineGross - discAmt;
                      return (
                        <TableRow key={item.id} sx={{
                          ...modernTableStyles.bodyRow,
                          ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                        }}>
                          <TableCell>{getProductName(item.product_id)}</TableCell>
                          <TableCell align="center">{item.quantity}</TableCell>
                          <TableCell align="right">{fmtLKR(displaySellingPrice)}</TableCell>
                          <TableCell align="right">
                            {(item.discount_percent || 0) > 0 ? (
                              <Typography variant="body2" color="warning.main" fontWeight="medium">
                                {Number(item.discount_percent).toFixed(1)}%
                              </Typography>
                            ) : (
                              <Typography variant="body2" color="text.disabled">—</Typography>
                            )}
                          </TableCell>
                          <TableCell align="center">{item.warrenty_month || "0"} mo</TableCell>
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
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} sx={modernTableStyles.emptyCell}>
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
                      <Typography variant="body2">{`Rs. ${fmtLKR(invoiceDetails.cash_amount)}`}</Typography>
                    </Box>
                  )}
                  {invoiceDetails.card_visa_amount > 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="body2">Visa Card</Typography>
                      <Typography variant="body2">{`Rs. ${fmtLKR(invoiceDetails.card_visa_amount)}`}</Typography>
                    </Box>
                  )}
                  {invoiceDetails.card_mastercard_amount > 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="body2">Mastercard</Typography>
                      <Typography variant="body2">{`Rs. ${fmtLKR(invoiceDetails.card_mastercard_amount)}`}</Typography>
                    </Box>
                  )}
                  {invoiceDetails.card_amex_amount > 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="body2">Amex</Typography>
                      <Typography variant="body2">{`Rs. ${fmtLKR(invoiceDetails.card_amex_amount)}`}</Typography>
                    </Box>
                  )}
                  {invoiceDetails.cheque_amount > 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="body2">Cheque</Typography>
                      <Typography variant="body2">{`Rs. ${fmtLKR(invoiceDetails.cheque_amount)}`}</Typography>
                    </Box>
                  )}
                  {invoiceDetails.bank_transfer_amount > 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="body2">Bank Transfer</Typography>
                      <Typography variant="body2">{`Rs. ${fmtLKR(invoiceDetails.bank_transfer_amount)}`}</Typography>
                    </Box>
                  )}
                  {invoiceDetails.credit_amount > 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="body2">Credit</Typography>
                      <Typography variant="body2">{`Rs. ${fmtLKR(invoiceDetails.credit_amount)}`}</Typography>
                    </Box>
                  )}
                </Paper>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Paper
                  sx={{
                    p: 2.5,
                    bgcolor: "success.lighter",
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    borderRadius: 2,
                  }}
                >
                  {(() => {
                    const isTaxInclusive = invoiceDetails.is_tax_invoice;
                    const taxRate = invoiceDetails.tax_rate || 0;
                    const grossTotal = invoiceDetails.items?.reduce((sum, item) => sum + (item.quantity * item.selling_price), 0) || 0;
                    const itemDiscounts = invoiceDetails.items?.reduce((sum, item) => sum + (item.discount_amount || (item.selling_price * item.quantity * (item.discount_percent || 0) / 100)), 0) || 0;

                    const displayGrossTotal = isTaxInclusive && taxRate > 0 ? grossTotal / (1 + taxRate / 100) : grossTotal;
                    const displayItemDiscounts = isTaxInclusive && taxRate > 0 ? itemDiscounts / (1 + taxRate / 100) : itemDiscounts;
                    const displaySubtotal = displayGrossTotal - displayItemDiscounts;

                    return (
                      <>
                        <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                          <Typography variant="body2" color="text.secondary">Gross Total</Typography>
                          <Typography variant="body2" fontWeight="medium">{`Rs. ${fmtLKR(displayGrossTotal)}`}</Typography>
                        </Box>
                        {displayItemDiscounts > 0 && (
                          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                            <Typography variant="body2" color="error.main">Item Discounts</Typography>
                            <Typography variant="body2" color="error.main" fontWeight="medium">{`-Rs. ${fmtLKR(displayItemDiscounts)}`}</Typography>
                          </Box>
                        )}
                        <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                          <Typography variant="body2">Subtotal</Typography>
                          <Typography variant="body2" fontWeight="medium">{`Rs. ${fmtLKR(displaySubtotal)}`}</Typography>
                        </Box>
                        {invoiceDetails.cupon_amount > 0 && (
                          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                            <Typography variant="body2" color="error.main">Coupon Discount</Typography>
                            <Typography variant="body2" color="error.main" fontWeight="medium">{`-Rs. ${fmtLKR(invoiceDetails.cupon_amount)}`}</Typography>
                          </Box>
                        )}
                        {invoiceDetails.discount_amount > 0 && (
                          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                            <Typography variant="body2" color="error.main">
                              Discount {invoiceDetails.discount_percent > 0 ? `(${invoiceDetails.discount_percent}%)` : ""}
                            </Typography>
                            <Typography variant="body2" color="error.main" fontWeight="medium">{`-Rs. ${fmtLKR(invoiceDetails.discount_amount)}`}</Typography>
                          </Box>
                        )}
                        {invoiceDetails.tax_amount > 0 && (
                          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                            <Typography variant="body2">
                              Tax ({invoiceDetails.tax_rate}%) {isTaxInclusive ? "(Included)" : ""}
                            </Typography>
                            <Typography variant="body2" fontWeight="medium">{`Rs. ${fmtLKR(invoiceDetails.tax_amount)}`}</Typography>
                          </Box>
                        )}
                        {invoiceDetails.service_charge_amount > 0 && (
                          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                            <Typography variant="body2">Service Charge ({(invoiceDetails.service_charge_rate * 100).toFixed(1)}%)</Typography>
                            <Typography variant="body2" fontWeight="medium">{`Rs. ${fmtLKR(invoiceDetails.service_charge_amount)}`}</Typography>
                          </Box>
                        )}
                        <Divider sx={{ my: 1 }} />
                        <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                          <Typography variant="subtitle1" fontWeight={600}>Grand Total</Typography>
                          <Typography variant="subtitle1" fontWeight={600}>
                            {`Rs. ${fmtLKR(invoiceDetails.grand_total)}`}
                          </Typography>
                        </Box>
                        {invoiceDetails.gift_voucher_amount > 0 && (
                          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                            <Typography variant="body2" color="info.main">Gift Voucher Payment</Typography>
                            <Typography variant="body2" color="info.main" fontWeight="medium">{`-Rs. ${fmtLKR(invoiceDetails.gift_voucher_amount)}`}</Typography>
                          </Box>
                        )}
                        {invoiceDetails.credit_note_amount > 0 && (
                          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                            <Typography variant="body2" color="error.main">Credit Note</Typography>
                            <Typography variant="body2" color="error.main" fontWeight="medium">{`-Rs. ${fmtLKR(invoiceDetails.credit_note_amount)}`}</Typography>
                          </Box>
                        )}
                        <Divider sx={{ my: 1 }} />
                        <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                          <Typography variant="h6" fontWeight={700}>Amount Paid</Typography>
                          <Typography variant="h5" fontWeight={700} color="success.main">
                            {`Rs. ${fmtLKR(invoiceDetails.paid_amount)}`}
                          </Typography>
                        </Box>
                        {invoiceDetails.balance_due > 0 && (
                          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                            <Typography variant="subtitle1" fontWeight={600} color="error.main">Balance Due</Typography>
                            <Typography variant="subtitle1" fontWeight={600} color="error.main">
                              {`Rs. ${fmtLKR(invoiceDetails.balance_due)}`}
                            </Typography>
                          </Box>
                        )}
                      </>
                    );
                  })()}
                </Paper>
              </Grid>
            </Grid>

            {/* Agent Commission */}
            {invoiceDetails.customer_agent_id && (
              <Box sx={{ mt: 3 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Agent Commission
                </Typography>
                <Paper variant="outlined" sx={{ p: 2, borderColor: "primary.main", borderWidth: 1, borderRadius: 2 }}>
                  {(() => {
                    const agent = customers?.find((c) => c.id === invoiceDetails.customer_agent_id);
                    return (
                      <Grid container spacing={2}>
                        <Grid item xs={12} sm={6}>
                          <Typography variant="body2" color="text.secondary">Agent Name</Typography>
                          <Typography variant="body1" fontWeight={500}>{agent?.customer_name || `Agent #${invoiceDetails.customer_agent_id}`}</Typography>
                        </Grid>
                        <Grid item xs={6} sm={3}>
                          <Typography variant="body2" color="text.secondary">Commission Rate</Typography>
                          <Typography variant="body1" fontWeight={500}>
                            {invoiceCommission ? `${Number(invoiceCommission.commission_rate).toFixed(1)}%` : `${Number(agent?.commission_rate || 0).toFixed(1)}%`}
                          </Typography>
                        </Grid>
                        <Grid item xs={6} sm={3}>
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
                        <Grid item xs={12}>
                          <Divider sx={{ my: 1 }} />
                          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <Typography variant="subtitle2" fontWeight="bold">Commission Amount</Typography>
                            <Typography variant="subtitle1" fontWeight="bold" color="primary.main">
                              Rs. {fmtLKR(invoiceCommission ? Number(invoiceCommission.commission_amount) : (invoiceDetails.grand_total * ((agent?.commission_rate || 0) / 100)))}
                            </Typography>
                          </Box>
                        </Grid>
                      </Grid>
                    );
                  })()}
                </Paper>
              </Box>
            )}

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
        <Button variant="contained" startIcon={<PrintIcon />} onClick={handlePrint} disabled={isLoading || !canPrintDocument(invoiceDetails?.approval_status ?? invoice?.approval_status, ["cancelled"])}>
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
