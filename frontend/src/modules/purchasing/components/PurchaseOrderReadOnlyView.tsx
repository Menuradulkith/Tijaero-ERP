/**
 * PurchaseOrderReadOnlyView - the Purchase Orders page's view panel (Order Information, Dates &
 * Payment, Order Status, Order Items, Remarks), same layout, view only. Used by the purchase
 * order "peek" popup so a user who may not open the Purchase Orders page (a storekeeper
 * receiving goods, for example) can still see what it shows.
 *
 * Unit prices, amounts and totals only reach users who hold purchase_orders:view (`show_pricing`).
 * Keep in step with PurchaseOrdersPage.tsx.
 */
import { Alert, Box, Paper, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { useCurrencyStore } from "@/state/currencyStore";
import {
  FormSection,
  TRemarkField,
  TStatusChip,
  fmtLKR,
  getPaymentTermsLabel,
  modernTableStyles,
} from "@/components/tijaero";

interface OrderItem {
  id: number;
  product_id: number;
  product_name: string;
  uom?: string | null;
  quantity: number;
  unit_price?: number | string;
  remark?: string | null;
}

export interface PurchaseOrderPeekData {
  order: {
    purchasing_order_no: string;
    supplier_name?: string | null;
    payment_method: string;
    purchasing_order_date: string;
    required_date?: string | null;
    good_received_note_date: string;
    credit_date?: number | null;
    status: string;
    remarks?: string | null;
    sales_quote_no?: string | null;
    rejection_reason?: string | null;
    cancellation_reason?: string | null;
    cancelled_date?: string | null;
    short_close_reason?: string | null;
    total_amount?: number | string;
    items: OrderItem[];
  };
  show_pricing: boolean;
  branch_name: string;
}

function Field({ label, value, helperText }: { label: string; value: unknown; helperText?: string }) {
  return (
    <TextField
      label={label}
      size="small"
      value={value === null || value === undefined ? "" : String(value)}
      disabled
      InputProps={{ readOnly: true }}
      helperText={helperText}
    />
  );
}

const fmtDate = (value?: string | null) => (value ? new Date(value).toLocaleDateString() : "");

export default function PurchaseOrderReadOnlyView({ order, show_pricing, branch_name }: PurchaseOrderPeekData) {
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const isCredit = (order.payment_method || "").toLowerCase() === "credit";
  const total = order.items.reduce((sum, i) => sum + i.quantity * Number(i.unit_price ?? 0), 0);
  const status = (order.status || "").toLowerCase();

  return (
    <Box>
      <FormSection title="Order Information" columns={3}>
        <Field label="PO Number" value={order.purchasing_order_no} />
        <Field label="Branch" value={branch_name} />
        <Field label="Supplier" value={order.supplier_name} />
      </FormSection>

      <FormSection title="Dates & Payment" columns={3}>
        <Field label="Payment Method" value={isCredit ? "Credit" : "Non-credit"} />
        <Field label="Order Date" value={fmtDate(order.purchasing_order_date)} />
        {isCredit && (
          <Field label="Payment Term" value={getPaymentTermsLabel(order.credit_date ?? 0)} helperText="From supplier's payment terms" />
        )}
      </FormSection>

      <FormSection title="Order Status" columns={4}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Status:
          </Typography>
          <TStatusChip status={order.status || "draft"} statusMap="purchaseOrder" />
        </Box>
      </FormSection>

      {order.sales_quote_no && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2">
            Created from Sales Quotation{" "}
            <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
              {order.sales_quote_no}
            </Typography>
            .
          </Typography>
        </Alert>
      )}
      {status === "rejected" && (
        <Alert severity="error" sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>Rejected</Typography>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            Reason: {order.rejection_reason || "No reason recorded."}
          </Typography>
        </Alert>
      )}
      {status === "cancelled" && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Cancelled{order.cancelled_date ? ` on ${new Date(order.cancelled_date).toLocaleDateString()}` : ""}
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            Reason: {order.cancellation_reason || "No reason recorded."}
          </Typography>
        </Alert>
      )}
      {status === "short_closed" && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>Short-closed</Typography>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            Reason: {order.short_close_reason || "No reason recorded."}
          </Typography>
        </Alert>
      )}

      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1, mt: 2 }}>
        <Typography variant="subtitle1" fontWeight="bold">
          Order Items
        </Typography>
      </Box>
      <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={modernTableStyles.headerRow}>
              <TableCell sx={{ minWidth: 200 }}>Product</TableCell>
              <TableCell sx={{ width: 80 }}>UOM</TableCell>
              <TableCell align="right" sx={{ width: 100 }}>Quantity</TableCell>
              {show_pricing && <TableCell align="right" sx={{ width: 120 }}>{`Unit Price (${currencySymbol})`}</TableCell>}
              <TableCell sx={{ width: 150 }}>Remark</TableCell>
              {show_pricing && <TableCell align="right" sx={{ width: 120 }}>{`Amount (${currencySymbol})`}</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {order.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={show_pricing ? 6 : 4} sx={modernTableStyles.emptyCell}>
                  No items
                </TableCell>
              </TableRow>
            ) : (
              order.items.map((item, index) => (
                <TableRow key={item.id} sx={{ ...modernTableStyles.bodyRow, ...(index % 2 === 1 && { bgcolor: "grey.25" }) }}>
                  <TableCell>{item.product_name}</TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {item.uom || "-"}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">{item.quantity}</TableCell>
                  {show_pricing && <TableCell align="right">{fmtLKR(Number(item.unit_price ?? 0))}</TableCell>}
                  <TableCell>
                    <Typography variant="body2" sx={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.remark || "-"}
                    </Typography>
                  </TableCell>
                  {show_pricing && <TableCell align="right">{fmtLKR(item.quantity * Number(item.unit_price ?? 0))}</TableCell>}
                </TableRow>
              ))
            )}
            {show_pricing && (
              <TableRow sx={modernTableStyles.footerRow}>
                <TableCell colSpan={5} align="right">
                  <Typography fontWeight="bold">Total:</Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography fontWeight="bold">{fmtLKR(total)}</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <FormSection title="Remarks" columns={1} sx={{ mt: 2 }}>
        <TRemarkField label="Remarks" size="small" value={order.remarks || ""} onChange={() => {}} disabled multiline rows={2} />
      </FormSection>
    </Box>
  );
}
