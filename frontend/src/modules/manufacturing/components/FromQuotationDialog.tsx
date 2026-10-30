/**
 * FromQuotationDialog - make-to-order: raise a production order for an open line of an
 * approved quotation. The order's output is reserved for that customer's line, and the
 * line shows "MO Created" on the quotation.
 */

import SearchIcon from "@mui/icons-material/Search";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  MenuItem,
  Radio,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useEffect, useMemo, useState } from "react";

import { handleApiError, modernTableStyles, showErrorToast, showSuccessToast } from "@/components/tijaero";
import { productionOrdersApi } from "@/modules/manufacturing/api";
import { PRIORITY_OPTIONS, type Priority, type ProductionOrder, type QuoteDemandLine } from "@/modules/manufacturing/types";
import { formatDate } from "@/utils/formatters";

const todayISO = () => format(new Date(), "yyyy-MM-dd");

export interface FromQuotationDialogProps {
  open: boolean;
  branchCode?: string | null;
  onClose: () => void;
  onCreated: (order: ProductionOrder) => void;
}

export default function FromQuotationDialog({ open, branchCode, onClose, onCreated }: FromQuotationDialogProps) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState("");
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(todayISO());
  const [priority, setPriority] = useState<Priority>("normal");
  const [saving, setSaving] = useState(false);

  const { data: lines = [], isLoading } = useQuery({
    queryKey: ["quote-demand", branchCode],
    queryFn: () => productionOrdersApi.getQuoteDemand({ branch_code: branchCode || undefined }),
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setSelectedId(null);
      setSearch("");
    }
  }, [open]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lines.filter(
      (l) =>
        l.remaining_quantity > 0 &&
        (!q ||
          l.quote_no.toLowerCase().includes(q) ||
          (l.product_name || "").toLowerCase().includes(q) ||
          (l.customer_name || "").toLowerCase().includes(q))
    );
  }, [lines, search]);

  const selected = rows.find((l) => l.quote_item_id === selectedId) || null;

  const pick = (line: QuoteDemandLine) => {
    setSelectedId(line.quote_item_id);
    setQuantity(String(line.remaining_quantity));
    setStart(todayISO());
    const due = line.expected_delivery_date && line.expected_delivery_date > todayISO() ? line.expected_delivery_date : todayISO();
    setEnd(due);
  };

  const qty = Math.floor(Number(quantity));
  const error = !selected
    ? null
    : !(qty >= 1)
      ? "Enter a quantity of at least 1"
      : qty > selected.remaining_quantity
        ? `Only ${selected.remaining_quantity} unit(s) are left to produce for this line`
        : end < start
          ? "Planned end cannot be before the planned start"
          : null;

  const handleCreate = async () => {
    if (!selected || error) return;
    setSaving(true);
    try {
      const order = await productionOrdersApi.createFromQuote({
        quote_item_id: selected.quote_item_id,
        quantity: qty,
        planned_start_date: start,
        planned_end_date: end,
        priority,
      });
      showSuccessToast(`Production order ${order.order_no} created for ${selected.quote_no}`);
      onCreated(order);
    } catch (err) {
      showErrorToast(handleApiError(err, "Failed to create the production order"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>Production Order from Quotation</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Open lines of approved quotations for items with an active BOM. The output is reserved for the customer's line.
        </Typography>
        <TextField
          size="small"
          placeholder="Search quotation, product or customer..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          fullWidth
          sx={{ mb: 1.5 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" color="action" />
              </InputAdornment>
            ),
          }}
        />
        <Box sx={{ maxHeight: 300, overflow: "auto", border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow sx={modernTableStyles.headerRow}>
                <TableCell padding="checkbox" />
                <TableCell>Quotation</TableCell>
                <TableCell>Customer</TableCell>
                <TableCell>Product</TableCell>
                <TableCell align="right">Qty</TableCell>
                <TableCell align="right">In Production</TableCell>
                <TableCell align="right">To Produce</TableCell>
                <TableCell>Delivery</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} sx={modernTableStyles.emptyCell}>
                    {isLoading ? "Loading..." : "No open quotation lines for manufactured items"}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((l) => (
                  <TableRow key={l.quote_item_id} hover selected={l.quote_item_id === selectedId}
                    onClick={() => pick(l)} sx={{ cursor: "pointer" }}>
                    <TableCell padding="checkbox"><Radio size="small" checked={l.quote_item_id === selectedId} /></TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{l.quote_no}</Typography>
                      <Typography variant="caption" color="text.secondary">{l.branch_code}</Typography>
                    </TableCell>
                    <TableCell>{l.customer_name || "-"}</TableCell>
                    <TableCell>
                      <Typography variant="body2">{l.product_name}</Typography>
                      <Typography variant="caption" color="text.secondary">{l.product_code}</Typography>
                    </TableCell>
                    <TableCell align="right">{l.quantity}</TableCell>
                    <TableCell align="right">{l.in_production_quantity}</TableCell>
                    <TableCell align="right"><Typography variant="body2" fontWeight={700}>{l.remaining_quantity}</Typography></TableCell>
                    <TableCell>{l.expected_delivery_date ? formatDate(l.expected_delivery_date) : "-"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Box>
        {selected && (
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mt: 2 }}>
            <TextField size="small" type="number" label="Quantity" value={quantity}
              onChange={(e) => setQuantity(e.target.value)} inputProps={{ min: 1, max: selected.remaining_quantity }} />
            <TextField size="small" type="date" label="Planned Start" InputLabelProps={{ shrink: true }}
              value={start} onChange={(e) => setStart(e.target.value)} />
            <TextField size="small" type="date" label="Planned End" InputLabelProps={{ shrink: true }}
              value={end} onChange={(e) => setEnd(e.target.value)} />
            <TextField select size="small" label="Priority" value={priority} sx={{ minWidth: 130 }}
              onChange={(e) => setPriority(e.target.value as Priority)}>
              {PRIORITY_OPTIONS.map((p) => <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>)}
            </TextField>
          </Stack>
        )}
        {error && <Alert severity="warning" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={handleCreate} disabled={saving || !selected || !!error}>
          Create Production Order
        </Button>
      </DialogActions>
    </Dialog>
  );
}
