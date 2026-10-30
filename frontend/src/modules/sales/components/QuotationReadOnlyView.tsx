/**
 * QuotationReadOnlyView - the Quotations page's view panel (Quote Information, Related Purchase
 * Orders, Quote Items, Procurement & Stock Reservation, tax summary, Notes...), same layout,
 * view only. Used by the quotation "peek" popup so a user who may not open the Quotations page
 * can still see what it shows.
 *
 * Prices, discounts, tax and totals are only sent to users who hold quotations:view
 * (`show_pricing`); margins are never shown here. Keep in step with QuotationsPage's renderViewContent.
 */
import {
  Box,
  Divider,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import PurchaseOrderIcon from "@mui/icons-material/ShoppingCart";
import { useCurrencyStore } from "@/state/currencyStore";
import {
  FormSection,
  TChip,
  TCurrency,
  TRemarkField,
  TStatusChip,
  modernTableStyles,
} from "@/components/tijaero";

interface QuoteItem {
  id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  selling_price?: number;
  discount_percentage?: number;
  warrenty_month?: string | null;
  item_status?: string | null;
  stock_status?: string | null;
}

interface RelatedPO {
  id: number;
  purchasing_order_no: string;
  status: string;
  supplier_name?: string | null;
  ordered_quantity: number;
  received_quantity: number;
}

interface ProcurementRow {
  item_id: number;
  product_id: number;
  product_name?: string | null;
  required_quantity: number;
  ordered_quantity: number;
  received_quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  outstanding_quantity: number;
  to_purchase_quantity: number;
}

export interface QuotationPeekData {
  quote: {
    quote_no: string;
    created_date: string;
    valid_until: string;
    remarks?: string | null;
    customer_notes?: string | null;
    total_amount?: number;
    tax_mode?: string;
    tax_rate?: number;
    advance_payment_id?: number | null;
    advance_amount?: number | null;
    converted_to_invoice_id?: number | null;
    items: QuoteItem[];
  };
  show_pricing: boolean;
  branch_name: string;
  customer_name?: string | null;
  related_purchase_orders: RelatedPO[];
  procurement: ProcurementRow[];
}

function Field({ label, value }: { label: string; value: unknown }) {
  return (
    <TextField
      label={label}
      size="small"
      value={value === null || value === undefined ? "" : String(value)}
      disabled
      InputProps={{ readOnly: true }}
    />
  );
}

const chipStyle = { height: 20, fontSize: "0.7rem" } as const;

function ItemStatusChip({ itemStatus, stockStatus }: { itemStatus: string; stockStatus?: string | null }) {
  if (itemStatus === "so_created" || itemStatus === "completed")
    return <TChip label="SO Created" color="success" size="small" sx={chipStyle} />;
  if (itemStatus === "po_created") return <TChip label="PO Created" color="info" size="small" sx={chipStyle} />;
  if (itemStatus === "mo_created") return <TChip label="MO Created" color="secondary" size="small" sx={chipStyle} />;
  if (itemStatus === "itn_created") return <TChip label="ITN Created" color="info" size="small" sx={chipStyle} />;
  if (itemStatus === "cancelled") return <TChip label="Cancelled" color="default" size="small" sx={chipStyle} />;
  if (itemStatus === "procurement" || stockStatus === "needs_procurement")
    return <TChip label="Need PO" color="warning" size="small" sx={chipStyle} />;
  return <TChip label="Need SO" color="info" size="small" sx={chipStyle} />;
}

const fmtDate = (value: string) => new Date(value).toLocaleDateString();

export default function QuotationReadOnlyView({
  quote,
  show_pricing,
  branch_name,
  customer_name,
  related_purchase_orders,
  procurement,
}: QuotationPeekData) {
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const lineAmount = (i: QuoteItem) =>
    i.quantity * Number(i.selling_price ?? 0) * (1 - (i.discount_percentage || 0) / 100);
  const subtotal = quote.items.reduce((sum, i) => sum + lineAmount(i), 0);

  const taxRate = quote.tax_rate || 0;
  const showTax = show_pricing && quote.tax_mode && quote.tax_mode !== "none" && taxRate > 0;
  const taxAmount =
    quote.tax_mode === "exclusive" ? subtotal * (taxRate / 100) : (subtotal * taxRate) / (100 + taxRate);
  const grandTotal = quote.tax_mode === "exclusive" ? subtotal + taxAmount : subtotal;

  return (
    <Box>
      <FormSection title="Quote Information" columns={3}>
        <Field label="Quote Number" value={quote.quote_no} />
        <Field label="Branch" value={branch_name} />
        <Field label="Customer" value={customer_name} />
        <Field label="Created Date" value={fmtDate(quote.created_date)} />
        <Field label="Valid Until" value={fmtDate(quote.valid_until)} />
      </FormSection>

      {related_purchase_orders.length > 0 && (
        <FormSection title="Related Purchase Orders" columns={1}>
          <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={modernTableStyles.headerRow}>
                  <TableCell>PO Number</TableCell>
                  <TableCell>Supplier</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Ordered Qty</TableCell>
                  <TableCell align="right">Received Qty</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {related_purchase_orders.map((po) => (
                  <TableRow key={po.id} sx={modernTableStyles.bodyRow}>
                    <TableCell>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        <PurchaseOrderIcon fontSize="small" color="primary" />
                        {po.purchasing_order_no}
                      </Box>
                    </TableCell>
                    <TableCell>{po.supplier_name || "Unknown supplier"}</TableCell>
                    <TableCell>
                      <TStatusChip status={po.status} statusMap="purchaseOrder" />
                    </TableCell>
                    <TableCell align="right">{po.ordered_quantity}</TableCell>
                    <TableCell align="right">{po.received_quantity}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </FormSection>
      )}

      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1, mt: 2 }}>
        <Typography variant="subtitle1" fontWeight="bold">
          Quote Items
        </Typography>
      </Box>
      <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={modernTableStyles.headerRow}>
              <TableCell sx={{ minWidth: 200 }}>Product</TableCell>
              <TableCell align="right" sx={{ width: 100 }}>Quantity</TableCell>
              {show_pricing && <TableCell align="right" sx={{ width: 120 }}>Unit Price ({currencySymbol})</TableCell>}
              {show_pricing && <TableCell align="right" sx={{ width: 90 }}>Discount</TableCell>}
              <TableCell sx={{ width: 100 }}>Warranty</TableCell>
              <TableCell align="center" sx={{ width: 140 }}>Item Status</TableCell>
              {show_pricing && <TableCell align="right" sx={{ width: 120 }}>Amount ({currencySymbol})</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {quote.items.length > 0 ? (
              quote.items.map((item, index) => {
                const itemStatus = item.item_status ?? "pending";
                return (
                  <TableRow
                    key={item.id}
                    sx={{
                      ...modernTableStyles.bodyRow,
                      ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                      ...(itemStatus === "cancelled" && { opacity: 0.5 }),
                    }}
                  >
                    <TableCell>{item.product_name}</TableCell>
                    <TableCell align="right">{item.quantity}</TableCell>
                    {show_pricing && (
                      <TableCell align="right">
                        <TCurrency value={Number(item.selling_price ?? 0)} showSymbol={false} />
                      </TableCell>
                    )}
                    {show_pricing && (
                      <TableCell align="right">
                        {(item.discount_percentage || 0) > 0 ? (
                          <Typography variant="body2" color="error.main">
                            {item.discount_percentage}%
                          </Typography>
                        ) : (
                          <Typography variant="body2" color="text.disabled">-</Typography>
                        )}
                      </TableCell>
                    )}
                    <TableCell>{item.warrenty_month || "-"}</TableCell>
                    <TableCell align="center">
                      <ItemStatusChip itemStatus={itemStatus} stockStatus={item.stock_status} />
                    </TableCell>
                    {show_pricing && (
                      <TableCell align="right">
                        <TCurrency value={lineAmount(item)} showSymbol={false} />
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={show_pricing ? 7 : 4} sx={modernTableStyles.emptyCell}>
                  No items in this quote
                </TableCell>
              </TableRow>
            )}
            {show_pricing && (
              <TableRow sx={modernTableStyles.footerRow}>
                <TableCell colSpan={6} align="right">
                  <Typography fontWeight="bold">Total:</Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography fontWeight="bold">
                    <TCurrency value={subtotal} showSymbol={false} />
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      {procurement.length > 0 && (
        <FormSection title="Procurement & Stock Reservation" columns={1} sx={{ mt: 2 }}>
          <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={modernTableStyles.headerRow}>
                  <TableCell sx={{ minWidth: 180 }}>Product</TableCell>
                  <TableCell align="right">Required</TableCell>
                  <TableCell align="right">Ordered</TableCell>
                  <TableCell align="right">Received</TableCell>
                  <TableCell align="right">Reserved</TableCell>
                  <TableCell align="right">Available</TableCell>
                  <TableCell align="right">Outstanding</TableCell>
                  <TableCell align="right">To Purchase</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {procurement.map((row) => (
                  <TableRow key={row.item_id} sx={modernTableStyles.bodyRow}>
                    <TableCell>{row.product_name || `Product #${row.product_id}`}</TableCell>
                    <TableCell align="right">{row.required_quantity}</TableCell>
                    <TableCell align="right">{row.ordered_quantity}</TableCell>
                    <TableCell align="right">{row.received_quantity}</TableCell>
                    <TableCell align="right">
                      {row.reserved_quantity > 0 ? (
                        <TChip label={row.reserved_quantity} color="warning" size="small" sx={chipStyle} />
                      ) : (
                        row.reserved_quantity
                      )}
                    </TableCell>
                    <TableCell align="right">{row.available_quantity}</TableCell>
                    <TableCell align="right">
                      {row.outstanding_quantity > 0 ? (
                        <TChip label={row.outstanding_quantity} color="info" size="small" sx={chipStyle} />
                      ) : (
                        0
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {row.to_purchase_quantity > 0 ? (
                        <TChip label={row.to_purchase_quantity} color="warning" size="small" sx={chipStyle} />
                      ) : (
                        0
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </FormSection>
      )}

      {showTax && (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 0.5, mt: 1, pr: 1 }}>
          <Box sx={{ display: "flex", gap: 4 }}>
            <Typography variant="body2" color="text.secondary">Subtotal (excl. tax):</Typography>
            <Typography variant="body2">
              <TCurrency value={quote.tax_mode === "inclusive" ? subtotal - taxAmount : subtotal} />
            </Typography>
          </Box>
          <Box sx={{ display: "flex", gap: 4 }}>
            <Typography variant="body2" color="info.main">
              Tax ({taxRate}%{quote.tax_mode === "exclusive" ? " excl." : " incl."}):
            </Typography>
            <Typography variant="body2" color="info.main">
              {quote.tax_mode === "exclusive" ? "+ " : ""}
              <TCurrency value={taxAmount} />
            </Typography>
          </Box>
          <Divider sx={{ width: "100%" }} />
          <Box sx={{ display: "flex", gap: 4 }}>
            <Typography variant="body2" fontWeight="bold">Grand Total:</Typography>
            <Typography variant="body2" fontWeight="bold"><TCurrency value={grandTotal} /></Typography>
          </Box>
        </Box>
      )}

      <Divider sx={{ my: 2 }} />
      <FormSection title="Notes" columns={2}>
        <TRemarkField label="Internal Remarks" value={quote.remarks || ""} onChange={() => {}} disabled multiline rows={2} size="small" />
        <TRemarkField
          label="Customer Notes (shown on printed document)"
          value={quote.customer_notes || ""}
          onChange={() => {}}
          disabled
          multiline
          rows={2}
          size="small"
        />
      </FormSection>

      {show_pricing && quote.advance_payment_id && (
        <>
          <Divider sx={{ my: 2 }} />
          <FormSection title="Advance Payment">
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
              <TChip label="Advance Paid" color="success" size="small" />
              <Typography variant="body2" color="text.secondary">Advance #{quote.advance_payment_id}</Typography>
              {quote.advance_amount && (
                <TChip label={<TCurrency value={quote.advance_amount} />} color="success" variant="outlined" size="small" />
              )}
            </Box>
          </FormSection>
        </>
      )}

      {quote.converted_to_invoice_id && (
        <>
          <Divider sx={{ my: 2 }} />
          <FormSection title="Conversion">
            <TChip label={`Converted to Invoice #${quote.converted_to_invoice_id}`} color="success" variant="outlined" />
          </FormSection>
        </>
      )}
    </Box>
  );
}
