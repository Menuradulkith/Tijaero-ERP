/**
 * Shop-floor dialogs for a production order: material issue / return, output
 * receipt, job-card time and cancellation. Each dialog only collects input; the
 * page runs the mutation and closes the dialog on success.
 */
import { useEffect, useMemo, useState } from "react";
import CancelIcon from "@mui/icons-material/Cancel";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";

import { modernTableStyles, TChip } from "@/components/tijaero";
import { shopFloorApi } from "@/modules/manufacturing/api";
import type {
  MaterialMoveInput,
  Operator,
  OutputInput,
  ProductionOrder,
  TimeLogInput,
} from "@/modules/manufacturing/types";

const toInt = (v: string) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// ─────────────────────────── material issue / return ───────────────────────────
interface MaterialMoveDialogProps {
  open: boolean;
  mode: "issue" | "return";
  order: ProductionOrder | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (data: MaterialMoveInput) => void;
}

export function MaterialMoveDialog({ open, mode, order, saving, onClose, onSubmit }: MaterialMoveDialogProps) {
  const isIssue = mode === "issue";
  const rows = useMemo(
    () =>
      (order?.materials || []).filter((m) =>
        isIssue ? m.remaining_quantity > 0 : m.issued_quantity > 0
      ),
    [order, isIssue]
  );
  const [qty, setQty] = useState<Record<number, string>>({});
  const [remark, setRemark] = useState("");

  useEffect(() => {
    if (!open) return;
    const init: Record<number, string> = {};
    rows.forEach((m) => {
      init[m.id] = isIssue ? String(Math.min(m.remaining_quantity, m.available_quantity)) : "0";
    });
    setQty(init);
    setRemark("");
  }, [open, rows, isIssue]);

  const lines = rows
    .map((m) => ({ material_id: m.id, quantity: toInt(qty[m.id] || "") }))
    .filter((l) => l.quantity > 0);
  const overLimit = rows.some((m) => {
    const q = toInt(qty[m.id] || "");
    return isIssue ? q > m.available_quantity : q > m.issued_quantity;
  });

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>{isIssue ? "Issue Materials" : "Return Materials"} — {order?.order_no}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {isIssue
            ? `Components are taken from free stock in branch ${order?.branch_code} (first-expiry-first-out) and moved into work in progress.`
            : "Unused components go back to available stock and leave work in progress."}
        </Typography>
        {rows.length === 0 ? (
          <Alert severity="info">
            {isIssue ? "Every component has been issued." : "No components have been issued to this order."}
          </Alert>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow sx={modernTableStyles.headerRow}>
                <TableCell>Component</TableCell>
                <TableCell>Method</TableCell>
                <TableCell align="right">Required</TableCell>
                <TableCell align="right">Issued</TableCell>
                {isIssue && <TableCell align="right">Available</TableCell>}
                <TableCell align="right" sx={{ width: 130 }}>{isIssue ? "Issue Qty" : "Return Qty"}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((m) => {
                const q = toInt(qty[m.id] || "");
                const limit = isIssue ? m.available_quantity : m.issued_quantity;
                return (
                  <TableRow key={m.id} sx={modernTableStyles.bodyRow}>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{m.product_name}</Typography>
                      <Typography variant="caption" color="text.secondary">{m.product_code}</Typography>
                    </TableCell>
                    <TableCell>
                      <TChip size="small" label={m.issue_method === "backflush" ? "Backflush" : "Manual"}
                        color={m.issue_method === "backflush" ? "info" : "default"} variant="outlined" />
                    </TableCell>
                    <TableCell align="right">{m.required_quantity}</TableCell>
                    <TableCell align="right">{m.issued_quantity}</TableCell>
                    {isIssue && (
                      <TableCell align="right" sx={{ color: m.available_quantity < m.remaining_quantity ? "error.main" : undefined }}>
                        {m.available_quantity}
                      </TableCell>
                    )}
                    <TableCell align="right">
                      <TextField
                        size="small"
                        type="number"
                        value={qty[m.id] ?? ""}
                        onChange={(e) => setQty((p) => ({ ...p, [m.id]: e.target.value }))}
                        inputProps={{ min: 0, max: limit, step: 1 }}
                        error={q > limit}
                        sx={{ width: 110 }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {overLimit && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {isIssue ? "A quantity is more than the free stock in the branch." : "A quantity is more than was issued."}
          </Alert>
        )}
        <TextField label="Remark" size="small" fullWidth sx={{ mt: 2 }} value={remark}
          onChange={(e) => setRemark(e.target.value)} inputProps={{ maxLength: 255 }} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button variant="contained" color="error" startIcon={<CancelIcon />} onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={saving || lines.length === 0 || overLimit}
          onClick={() => onSubmit({ lines, remark: remark.trim() || null })}
        >
          {saving ? "Saving..." : isIssue ? "Issue" : "Return"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─────────────────────────── output receipt ───────────────────────────
interface OutputDialogProps {
  open: boolean;
  order: ProductionOrder | null;
  locations: { id: number; name: string; branch_code: string }[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (data: OutputInput) => void;
}

export function OutputDialog({ open, order, locations, saving, onClose, onSubmit }: OutputDialogProps) {
  const remaining = order ? Math.max(order.planned_quantity - order.produced_quantity, 0) : 0;
  const [good, setGood] = useState("");
  const [scrap, setScrap] = useState("0");
  const [batchNo, setBatchNo] = useState("");
  const [expiry, setExpiry] = useState("");
  const [serials, setSerials] = useState("");
  const [locationId, setLocationId] = useState<number | "">("");
  const [remark, setRemark] = useState("");

  useEffect(() => {
    if (!open || !order) return;
    setGood(String(remaining));
    setScrap("0");
    setBatchNo("");
    setExpiry("");
    setSerials("");
    setLocationId(order.location_id ?? "");
    setRemark("");
  }, [open, order, remaining]);

  const tracking = order?.tracking_type || "serial";
  const goodQty = Math.max(Math.floor(Number(good) || 0), 0);
  const scrapQty = Math.max(Math.floor(Number(scrap) || 0), 0);
  const serialList = serials.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const branchLocations = locations.filter((l) => l.branch_code === order?.branch_code);
  const backflush = (order?.materials || []).filter((m) => m.issue_method === "backflush");

  let error: string | null = null;
  if (goodQty === 0 && scrapQty === 0) error = "Enter a good or a scrap quantity";
  else if (goodQty > remaining) error = `Only ${remaining} more good unit(s) can be recorded`;
  else if (tracking === "serial" && serialList.length > 0 && serialList.length !== goodQty)
    error = `Enter one serial number per good unit (${goodQty} needed, ${serialList.length} given)`;

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Record Output — {order?.order_no}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Good units are received into stock at the standard unit cost. {order?.produced_quantity ?? 0} of{" "}
          {order?.planned_quantity ?? 0} produced so far.
        </Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
          <TextField label="Good Quantity" size="small" type="number" value={good}
            onChange={(e) => setGood(e.target.value)} inputProps={{ min: 0, max: remaining, step: 1 }} required />
          <TextField label="Scrap Quantity" size="small" type="number" value={scrap}
            onChange={(e) => setScrap(e.target.value)} inputProps={{ min: 0, step: 1 }} />
          {tracking === "batch" && (
            <>
              <TextField label="Batch No" size="small" value={batchNo} onChange={(e) => setBatchNo(e.target.value)}
                placeholder={order?.order_no} helperText="Defaults to the order number" inputProps={{ maxLength: 100 }} />
              <TextField label="Expiry Date" size="small" type="date" value={expiry}
                onChange={(e) => setExpiry(e.target.value)} InputLabelProps={{ shrink: true }} />
            </>
          )}
          <TextField select label="Receive To Location" size="small" value={locationId}
            onChange={(e) => setLocationId(e.target.value === "" ? "" : Number(e.target.value))}
            sx={{ gridColumn: "1 / -1" }}>
            {branchLocations.map((l) => (
              <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>
            ))}
          </TextField>
          {tracking === "serial" && (
            <TextField label="Serial Numbers (one per line)" size="small" multiline minRows={3} value={serials}
              onChange={(e) => setSerials(e.target.value)} sx={{ gridColumn: "1 / -1" }}
              helperText={`Optional — generated from ${order?.order_no} when left empty`} />
          )}
          <TextField label="Remark" size="small" value={remark} onChange={(e) => setRemark(e.target.value)}
            sx={{ gridColumn: "1 / -1" }} inputProps={{ maxLength: 255 }} />
        </Box>
        {backflush.length > 0 && (
          <Alert severity="info" sx={{ mt: 2 }}>
            Backflushed components are consumed automatically for the units recorded:{" "}
            {backflush.map((m) => m.product_name).join(", ")}.
          </Alert>
        )}
        {error && (goodQty > 0 || scrapQty > 0 || good !== "") && (
          <Alert severity="warning" sx={{ mt: 2 }}>{error}</Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button variant="contained" color="error" startIcon={<CancelIcon />} onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={saving || !!error}
          onClick={() =>
            onSubmit({
              quantity: goodQty,
              scrap_quantity: scrapQty,
              batch_no: tracking === "batch" ? batchNo.trim() || null : null,
              expiry_date: tracking === "batch" && expiry ? expiry : null,
              serial_numbers: tracking === "serial" && serialList.length > 0 ? serialList : null,
              location_id: locationId === "" ? null : locationId,
              remark: remark.trim() || null,
            })
          }
        >
          {saving ? "Saving..." : "Record Output"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─────────────────────────── job-card time ───────────────────────────
interface TimeLogDialogProps {
  open: boolean;
  order: ProductionOrder | null;
  saving: boolean;
  initialOperationId?: number | null;
  onClose: () => void;
  onSubmit: (data: TimeLogInput) => void;
}

export function TimeLogDialog({ open, order, saving, initialOperationId, onClose, onSubmit }: TimeLogDialogProps) {
  const operations = useMemo(() => (order?.operations || []).filter((o) => o.status !== "completed"), [order]);
  const { data: operators = [] } = useQuery({
    queryKey: ["manufacturing-operators"],
    queryFn: shopFloorApi.getOperators,
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });
  const [operationId, setOperationId] = useState<number | "">("");
  const [operator, setOperator] = useState<Operator | null>(null);
  const [useTimes, setUseTimes] = useState(false);
  const [minutes, setMinutes] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [qty, setQty] = useState("0");
  const [complete, setComplete] = useState(false);
  const [remark, setRemark] = useState("");

  useEffect(() => {
    if (!open) return;
    const first = operations.find((o) => o.id === initialOperationId) || operations[0];
    setOperationId(first ? first.id : "");
    setOperator(null);
    setUseTimes(false);
    setMinutes("");
    setStart("");
    setEnd("");
    setQty("0");
    setComplete(false);
    setRemark("");
  }, [open, operations, initialOperationId]);

  const op = operations.find((o) => o.id === operationId);
  const mins = Number(minutes);
  let error: string | null = null;
  if (!operationId) error = "Select an operation";
  else if (useTimes) {
    if (!start || !end) error = "Enter a start and an end time";
    else if (new Date(end) <= new Date(start)) error = "End time must be after the start time";
  } else if (!(mins > 0)) error = "Enter the minutes worked";

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Log Time — {order?.order_no}</DialogTitle>
      <DialogContent>
        {operations.length === 0 ? (
          <Alert severity="info" sx={{ mt: 1 }}>Every operation on this order is completed.</Alert>
        ) : (
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5, mt: 1 }}>
            <TextField select label="Operation" size="small" required value={operationId}
              onChange={(e) => setOperationId(Number(e.target.value))} sx={{ gridColumn: "1 / -1" }}>
              {operations.map((o) => (
                <MenuItem key={o.id} value={o.id}>
                  {o.sequence} · {o.name} ({o.work_center_code || o.work_center_name}) — {Number(o.actual_minutes)}/
                  {Number(o.planned_minutes)} min
                </MenuItem>
              ))}
            </TextField>
            <Autocomplete
              size="small"
              options={operators}
              value={operator}
              onChange={(_, v) => setOperator(v)}
              getOptionLabel={(o) => `${o.name} (${o.employee_id})`}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              renderInput={(p) => <TextField {...p} label="Operator" />}
              sx={{ gridColumn: "1 / -1" }}
            />
            <FormControlLabel
              sx={{ gridColumn: "1 / -1" }}
              control={<Checkbox size="small" checked={useTimes} onChange={(e) => setUseTimes(e.target.checked)} />}
              label="Enter start and end time"
            />
            {useTimes ? (
              <>
                <TextField label="Start" size="small" type="datetime-local" value={start}
                  onChange={(e) => setStart(e.target.value)} InputLabelProps={{ shrink: true }} />
                <TextField label="End" size="small" type="datetime-local" value={end}
                  onChange={(e) => setEnd(e.target.value)} InputLabelProps={{ shrink: true }} />
              </>
            ) : (
              <TextField label="Minutes" size="small" type="number" required value={minutes}
                onChange={(e) => setMinutes(e.target.value)} inputProps={{ min: 0, step: 1 }}
                helperText={op ? `Planned ${Number(op.planned_minutes)} min, booked ${Number(op.actual_minutes)}` : undefined} />
            )}
            <TextField label="Completed Quantity" size="small" type="number" value={qty}
              onChange={(e) => setQty(e.target.value)} inputProps={{ min: 0, step: 1 }} />
            <FormControlLabel
              sx={{ gridColumn: "1 / -1" }}
              control={<Checkbox size="small" checked={complete} onChange={(e) => setComplete(e.target.checked)} />}
              label="Mark operation complete"
            />
            <TextField label="Remark" size="small" value={remark} onChange={(e) => setRemark(e.target.value)}
              sx={{ gridColumn: "1 / -1" }} inputProps={{ maxLength: 255 }} />
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button variant="contained" color="error" startIcon={<CancelIcon />} onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={saving || !!error || operations.length === 0}
          onClick={() =>
            onSubmit({
              operation_id: Number(operationId),
              employee_id: operator?.id ?? null,
              start_time: useTimes ? start : null,
              end_time: useTimes ? end : null,
              minutes: useTimes ? null : mins,
              completed_quantity: Math.max(Math.floor(Number(qty) || 0), 0),
              complete_operation: complete,
              remark: remark.trim() || null,
            })
          }
        >
          {saving ? "Saving..." : "Log Time"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─────────────────────────── cancel ───────────────────────────
interface CancelOrderDialogProps {
  open: boolean;
  orderNo?: string;
  saving: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}

export function CancelOrderDialog({ open, orderNo, saving, onClose, onSubmit }: CancelOrderDialogProps) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Cancel Production Order {orderNo}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 1 }}>
          A cancelled order cannot be reopened. Issued materials must be returned first.
        </Typography>
        <TextField label="Reason" size="small" fullWidth required multiline minRows={2} value={reason}
          onChange={(e) => setReason(e.target.value)} inputProps={{ maxLength: 500 }} autoFocus />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button variant="outlined" onClick={onClose} disabled={saving}>Keep Order</Button>
        <Button variant="contained" color="error" disabled={saving || !reason.trim()} onClick={() => onSubmit(reason.trim())}>
          {saving ? "Cancelling..." : "Cancel Order"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
