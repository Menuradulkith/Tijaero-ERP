/**
 * Dialogs that firm MRP suggestions into real documents:
 * - PurchaseFirmDialog: purchase orders, one per supplier (and branch), sent for PO approval
 * - ProduceFirmDialog: draft production orders
 * Quantities, suppliers, prices and dates can be adjusted before creating.
 */

import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
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
import { addDays as addDaysFns, format, parseISO } from "date-fns";
import { useEffect, useMemo, useState } from "react";

import { modernTableStyles } from "@/components/tijaero";
import { suppliersApi } from "@/modules/purchasing/api";
import type { MrpLine, Priority } from "@/modules/manufacturing/types";
import { PRIORITY_OPTIONS } from "@/modules/manufacturing/types";

// Local calendar dates (toISOString would shift them to UTC)
const today = () => format(new Date(), "yyyy-MM-dd");
const addDays = (iso: string, days: number) => format(addDaysFns(parseISO(iso), days), "yyyy-MM-dd");


interface PurchaseRow {
  key: string;
  line: MrpLine;
  quantity: string;
  supplier_id: number | null;
  unit_price: string;
}

export interface PurchaseFirmDialogProps {
  open: boolean;
  lines: MrpLine[];
  saving: boolean;
  onClose: () => void;
  /** One call per branch: lines are grouped by the parent */
  onSubmit: (data: {
    expected_date: string | null;
    rows: { line: MrpLine; quantity: number; supplier_id: number; unit_price: number | null }[];
  }) => void;
}

export function PurchaseFirmDialog({ open, lines, saving, onClose, onSubmit }: PurchaseFirmDialogProps) {
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [expectedDate, setExpectedDate] = useState("");

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers", "active"],
    queryFn: () => suppliersApi.getAll({ active: true }),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    setRows(
      lines.map((l) => ({
        key: `${l.product_id}:${l.branch_code}`,
        line: l,
        quantity: String(l.suggested_quantity),
        supplier_id: l.preferred_supplier_id ?? null,
        unit_price: Number(l.unit_cost) > 0 ? String(Number(l.unit_cost)) : "",
      }))
    );
    const latest = Math.max(0, ...lines.map((l) => l.lead_time_days || 0));
    setExpectedDate(addDays(today(), latest));
  }, [open, lines]);

  const update = (key: string, patch: Partial<PurchaseRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const error = useMemo(() => {
    if (rows.some((r) => !(Number(r.quantity) >= 1))) return "Every line needs a quantity of at least 1";
    if (rows.some((r) => !r.supplier_id)) return "Choose a supplier for every line";
    return null;
  }, [rows]);

  const supplierCount = new Set(rows.map((r) => `${r.supplier_id}:${r.line.branch_code}`)).size;

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>Create Purchase Orders</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          One purchase order is raised per supplier and branch ({supplierCount} in total). They go through the usual purchase order approval.
        </Typography>
        <Stack direction="row" spacing={1.5} sx={{ mb: 2 }}>
          <TextField size="small" type="date" label="Expected Delivery" InputLabelProps={{ shrink: true }}
            value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} inputProps={{ min: today() }} />
        </Stack>
        <Table size="small">
          <TableHead>
            <TableRow sx={modernTableStyles.headerRow}>
              <TableCell>Component</TableCell>
              <TableCell>Branch</TableCell>
              <TableCell sx={{ width: 110 }}>Quantity</TableCell>
              <TableCell sx={{ width: 240 }}>Supplier</TableCell>
              <TableCell sx={{ width: 130 }}>Unit Price</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key} sx={modernTableStyles.bodyRow}>
                <TableCell>
                  <Typography variant="body2" fontWeight={600}>{r.line.product_name}</Typography>
                  <Typography variant="caption" color="text.secondary">{r.line.product_code}</Typography>
                </TableCell>
                <TableCell>{r.line.branch_code}</TableCell>
                <TableCell>
                  <TextField size="small" type="number" value={r.quantity} inputProps={{ min: 1 }}
                    onChange={(e) => update(r.key, { quantity: e.target.value })} />
                </TableCell>
                <TableCell>
                  <Autocomplete
                    size="small"
                    options={suppliers}
                    getOptionLabel={(o) => o.company_name || ""}
                    value={suppliers.find((sp) => sp.id === r.supplier_id) || null}
                    onChange={(_, v) => update(r.key, { supplier_id: v?.id ?? null })}
                    isOptionEqualToValue={(o, v) => o.id === v.id}
                    renderInput={(params) => <TextField {...params} placeholder="Supplier" />}
                  />
                </TableCell>
                <TableCell>
                  <TextField size="small" type="number" value={r.unit_price} placeholder="Auto"
                    inputProps={{ min: 0, step: 0.01 }} onChange={(e) => update(r.key, { unit_price: e.target.value })} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {error && <Alert severity="warning" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button
          variant="contained"
          disabled={saving || !!error}
          onClick={() =>
            onSubmit({
              expected_date: expectedDate || null,
              rows: rows.map((r) => ({
                line: r.line,
                quantity: Math.floor(Number(r.quantity)),
                supplier_id: r.supplier_id as number,
                unit_price: r.unit_price ? Number(r.unit_price) : null,
              })),
            })
          }
        >
          Create Purchase Orders
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface ProduceRow {
  key: string;
  line: MrpLine;
  quantity: string;
  start: string;
  end: string;
}

export interface ProduceFirmDialogProps {
  open: boolean;
  lines: MrpLine[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (data: {
    priority: Priority;
    rows: { line: MrpLine; quantity: number; planned_start_date: string; planned_end_date: string }[];
  }) => void;
}

export function ProduceFirmDialog({ open, lines, saving, onClose, onSubmit }: ProduceFirmDialogProps) {
  const [rows, setRows] = useState<ProduceRow[]>([]);
  const [priority, setPriority] = useState<Priority>("normal");

  useEffect(() => {
    if (!open) return;
    setRows(
      lines.map((l) => {
        const start = l.order_by_date && l.order_by_date > today() ? l.order_by_date : today();
        const end = l.need_by_date && l.need_by_date > start ? l.need_by_date : addDays(start, Math.max(l.lead_time_days, 1));
        return { key: `${l.product_id}:${l.branch_code}`, line: l, quantity: String(l.suggested_quantity), start, end };
      })
    );
  }, [open, lines]);

  const update = (key: string, patch: Partial<ProduceRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const error = rows.some((r) => !(Number(r.quantity) >= 1))
    ? "Every line needs a quantity of at least 1"
    : rows.some((r) => !r.start || !r.end || r.end < r.start)
      ? "Planned end cannot be before the planned start"
      : null;

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>Create Production Orders</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Draft production orders are created from each item's default BOM. Release them from the Production Orders page.
        </Typography>
        <TextField select size="small" label="Priority" value={priority} sx={{ width: 180, mb: 2 }}
          onChange={(e) => setPriority(e.target.value as Priority)}>
          {PRIORITY_OPTIONS.map((p) => <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>)}
        </TextField>
        <Table size="small">
          <TableHead>
            <TableRow sx={modernTableStyles.headerRow}>
              <TableCell>Product</TableCell>
              <TableCell>Branch</TableCell>
              <TableCell sx={{ width: 110 }}>Quantity</TableCell>
              <TableCell sx={{ width: 170 }}>Planned Start</TableCell>
              <TableCell sx={{ width: 170 }}>Planned End</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key} sx={modernTableStyles.bodyRow}>
                <TableCell>
                  <Typography variant="body2" fontWeight={600}>{r.line.product_name}</Typography>
                  <Typography variant="caption" color="text.secondary">{r.line.product_code}</Typography>
                </TableCell>
                <TableCell>{r.line.branch_code}</TableCell>
                <TableCell>
                  <TextField size="small" type="number" value={r.quantity} inputProps={{ min: 1 }}
                    onChange={(e) => update(r.key, { quantity: e.target.value })} />
                </TableCell>
                <TableCell>
                  <TextField size="small" type="date" value={r.start} onChange={(e) => update(r.key, { start: e.target.value })} />
                </TableCell>
                <TableCell>
                  <TextField size="small" type="date" value={r.end} onChange={(e) => update(r.key, { end: e.target.value })} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {error && <Alert severity="warning" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button
          variant="contained"
          disabled={saving || !!error}
          onClick={() =>
            onSubmit({
              priority,
              rows: rows.map((r) => ({
                line: r.line,
                quantity: Math.floor(Number(r.quantity)),
                planned_start_date: r.start,
                planned_end_date: r.end,
              })),
            })
          }
        >
          Create Production Orders
        </Button>
      </DialogActions>
    </Dialog>
  );
}
