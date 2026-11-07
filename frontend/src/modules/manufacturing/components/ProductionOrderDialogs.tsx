/**
 * Shop-floor side panels for a production order: material issue / return, output
 * receipt (scrap reason, by-products, quality hold), job-card time, outside work,
 * quality decisions, completion options and cancellation. Each panel only collects
 * input; the page runs the mutation (guarded against double submits) and closes the
 * panel on success.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Checkbox,
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

import { fmtLKR, modernTableStyles, TChip, TSidePanel } from "@/components/tijaero";
import { shopFloorApi } from "@/modules/manufacturing/api";
import {
  SCRAP_REASONS,
  type MaterialMoveInput,
  type Operator,
  type OutputInput,
  type OrderMaterial,
  type OutsideReceiptInput,
  type ProductionOrder,
  type ProductionOutput,
  type QcDecisionInput,
  type ScrapReason,
  type TimeLogInput,
} from "@/modules/manufacturing/types";
import { formatDate, formatDateTimeReadable } from "@/utils/formatters";

const toInt = (v: string) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const grid = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 } as const;
const full = { gridColumn: "1 / -1" } as const;

/** Good + scrap units the order can still take (planned + over-production tolerance). */
const unitsLeft = (order: ProductionOrder | null) =>
  order ? Math.max((order.max_quantity || order.planned_quantity) - order.produced_quantity - order.scrapped_quantity, 0) : 0;

/** Most units of a component the order may hold: what its largest allowed output needs (same rule as the API). */
const issueCap = (order: ProductionOrder | null, m: OrderMaterial) => {
  const units = order ? order.max_quantity || order.planned_quantity : 0;
  const need = Math.ceil(Number(m.quantity_per_unit) * (1 + Number(m.scrap_pct || 0) / 100) * units - 1e-6);
  return Math.max(m.required_quantity, need);
};

// ─────────────────────────── material issue / return ───────────────────────────
interface MaterialMovePanelProps {
  open: boolean;
  mode: "issue" | "return";
  order: ProductionOrder | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (data: MaterialMoveInput) => void;
}

export function MaterialMovePanel({ open, mode, order, saving, onClose, onSubmit }: MaterialMovePanelProps) {
  const isIssue = mode === "issue";
  const rows = useMemo(
    () => (order?.materials || []).filter((m) => (isIssue ? m.remaining_quantity > 0 : m.issued_quantity > 0)),
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

  const lines = rows.map((m) => ({ material_id: m.id, quantity: toInt(qty[m.id] || "") })).filter((l) => l.quantity > 0);
  const lineLimit = (m: OrderMaterial) =>
    isIssue ? Math.min(m.available_quantity, issueCap(order, m) - m.issued_quantity) : m.issued_quantity;
  const overLimit = rows.some((m) => toInt(qty[m.id] || "") > lineLimit(m));
  const overCap = isIssue && rows.some((m) => toInt(qty[m.id] || "") > issueCap(order, m) - m.issued_quantity);

  return (
    <TSidePanel
      open={open}
      onClose={saving ? () => undefined : onClose}
      title={`${isIssue ? "Issue Materials" : "Return Materials"} — ${order?.order_no || ""}`}
      width={760}
      onSubmit={() => onSubmit({ lines, remark: remark.trim() || null })}
      isSubmitting={saving}
      submitDisabled={saving || lines.length === 0 || overLimit}
      submitText={isIssue ? "Issue" : "Return"}
    >
      <Typography variant="body2" color="text.secondary">
        {isIssue
          ? `Components are taken from free stock in branch ${order?.branch_code} (first-expiry-first-out) and moved into work in progress.`
          : "Unused components go back to available stock and leave work in progress."}
      </Typography>
      {rows.length === 0 ? (
        <Alert severity="info">{isIssue ? "Every component has been issued." : "No components have been issued to this order."}</Alert>
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
              const limit = lineLimit(m);
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
                  <TableCell align="right">
                    {m.required_quantity}
                    {isIssue && issueCap(order, m) > m.required_quantity && (
                      <Typography variant="caption" color="text.secondary" display="block">max {issueCap(order, m)}</Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">{m.issued_quantity}</TableCell>
                  {isIssue && (
                    <TableCell align="right" sx={{ color: m.available_quantity < m.remaining_quantity ? "error.main" : undefined }}>
                      {m.available_quantity}
                    </TableCell>
                  )}
                  <TableCell align="right">
                    <TextField size="small" type="number" value={qty[m.id] ?? ""}
                      onChange={(e) => setQty((p) => ({ ...p, [m.id]: e.target.value }))}
                      inputProps={{ min: 0, max: limit, step: 1 }} error={q > limit} sx={{ width: 110 }} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {overLimit && (
        <Alert severity="warning">
          {!isIssue
            ? "A quantity is more than was issued."
            : overCap
            ? "A quantity is more than this order may hold (the requirement for its largest allowed output; set by the BOM's over-production tolerance)."
            : "A quantity is more than the free stock in the branch."}
        </Alert>
      )}
      <TextField label="Remark" size="small" fullWidth value={remark}
        onChange={(e) => setRemark(e.target.value)} inputProps={{ maxLength: 255 }} />
    </TSidePanel>
  );
}

// ─────────────────────────── output receipt ───────────────────────────
interface OutputPanelProps {
  open: boolean;
  order: ProductionOrder | null;
  locations: { id: number; name: string; branch_code: string }[];
  /** The product is held for a quality check when output is recorded */
  requiresQc: boolean;
  saving: boolean;
  onClose: () => void;
  onSubmit: (data: OutputInput) => void;
}

export function OutputPanel({ open, order, locations, requiresQc, saving, onClose, onSubmit }: OutputPanelProps) {
  const left = unitsLeft(order);
  const remaining = order ? Math.min(Math.max(order.planned_quantity - order.produced_quantity, 0), left) : 0;
  const [good, setGood] = useState("");
  const [scrap, setScrap] = useState("0");
  const [scrapReason, setScrapReason] = useState<ScrapReason | "">("");
  const [batchNo, setBatchNo] = useState("");
  const [expiry, setExpiry] = useState("");
  const [serials, setSerials] = useState("");
  const [locationId, setLocationId] = useState<number | "">("");
  const [remark, setRemark] = useState("");
  const [byQty, setByQty] = useState<Record<number, string>>({});
  const [byTouched, setByTouched] = useState(false);

  useEffect(() => {
    if (!open || !order) return;
    setGood(String(remaining));
    setScrap("0");
    setScrapReason("");
    setBatchNo("");
    setExpiry("");
    setSerials("");
    setLocationId(order.location_id ?? "");
    setRemark("");
    setByTouched(false);
  }, [open, order, remaining]);

  const tracking = order?.tracking_type || "serial";
  const goodQty = Math.max(Math.floor(Number(good) || 0), 0);
  const scrapQty = Math.max(Math.floor(Number(scrap) || 0), 0);
  const byProducts = useMemo(() => order?.by_products || [], [order]);

  // By-product quantities follow the good units until the user edits one of them
  useEffect(() => {
    if (!open || byTouched) return;
    const init: Record<number, string> = {};
    byProducts.forEach((b) => {
      init[b.id] = String(Math.floor(Number(b.quantity_per_unit) * goodQty));
    });
    setByQty(init);
  }, [open, byProducts, goodQty, byTouched]);

  const serialList = serials.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const branchLocations = locations.filter((l) => l.branch_code === order?.branch_code);
  const backflush = (order?.materials || []).filter((m) => m.issue_method === "backflush");
  const tolerance = Number(order?.overproduction_pct || 0);

  let error: string | null = null;
  if (goodQty === 0 && scrapQty === 0) error = "Enter a good or a scrap quantity";
  else if (goodQty + scrapQty > left)
    error = `Only ${left} more unit(s), good and scrap together, can be recorded (planned ${order?.planned_quantity ?? 0}${
      tolerance ? `, up to ${order?.max_quantity} with ${tolerance}% over-production` : ""
    })`;
  else if (scrapQty > 0 && !scrapReason) error = "Choose why the units were scrapped";
  else if (tracking === "serial" && serialList.length > 0 && serialList.length !== goodQty)
    error = `Enter one serial number per good unit (${goodQty} needed, ${serialList.length} given)`;
  else if (tracking === "serial" && new Set(serialList).size !== serialList.length) error = "Serial numbers must be unique";
  else if (tracking === "serial" && serialList.some((x) => x.length > 100)) error = "A serial number can be at most 100 characters";

  const submit = () =>
    onSubmit({
      quantity: goodQty,
      scrap_quantity: scrapQty,
      scrap_reason: scrapQty > 0 && scrapReason ? scrapReason : null,
      batch_no: tracking === "batch" ? batchNo.trim() || null : null,
      expiry_date: tracking === "batch" && expiry ? expiry : null,
      serial_numbers: tracking === "serial" && serialList.length > 0 ? serialList : null,
      location_id: locationId === "" ? null : locationId,
      remark: remark.trim() || null,
      by_products: byProducts.map((b) => ({ byproduct_id: b.id, quantity: toInt(byQty[b.id] || "") })).filter((b) => b.quantity > 0),
    });

  return (
    <TSidePanel
      open={open}
      onClose={saving ? () => undefined : onClose}
      title={`Record Output — ${order?.order_no || ""}`}
      width={560}
      onSubmit={submit}
      isSubmitting={saving}
      submitDisabled={saving || !!error}
      submitText="Record Output"
    >
      <Typography variant="body2" color="text.secondary">
        Good units are received into stock at the standard unit cost. {order?.produced_quantity ?? 0} good and{" "}
        {order?.scrapped_quantity ?? 0} scrap of {order?.planned_quantity ?? 0} planned
        {tolerance ? ` (up to ${order?.max_quantity} allowed)` : ""} recorded so far.
      </Typography>
      {requiresQc && (
        <Alert severity="info">
          This product needs a quality check: good units are held (not available for sale) until an approver passes them.
        </Alert>
      )}
      <Box sx={grid}>
        <TextField label="Good Quantity" size="small" type="number" value={good}
          onChange={(e) => setGood(e.target.value)} inputProps={{ min: 0, max: left, step: 1 }} required />
        <TextField label="Scrap Quantity" size="small" type="number" value={scrap}
          onChange={(e) => setScrap(e.target.value)} inputProps={{ min: 0, step: 1 }} />
        {scrapQty > 0 && (
          <TextField select label="Scrap Reason" size="small" required value={scrapReason} sx={full}
            onChange={(e) => setScrapReason(e.target.value as ScrapReason)} error={!scrapReason}
            helperText={!scrapReason ? "Required when units are scrapped" : undefined}>
            {SCRAP_REASONS.map((r) => (
              <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>
            ))}
          </TextField>
        )}
        {tracking === "batch" && (
          <>
            <TextField label="Batch No" size="small" value={batchNo} onChange={(e) => setBatchNo(e.target.value)}
              placeholder={order?.order_no} helperText="Defaults to the order number" inputProps={{ maxLength: 100 }} />
            <TextField label="Expiry Date" size="small" type="date" value={expiry} helperText="Defaults from the shelf life"
              onChange={(e) => setExpiry(e.target.value)} InputLabelProps={{ shrink: true }} />
          </>
        )}
        <TextField select label="Receive To Location" size="small" value={locationId} sx={full}
          onChange={(e) => setLocationId(e.target.value === "" ? "" : Number(e.target.value))}>
          {branchLocations.map((l) => (
            <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>
          ))}
        </TextField>
        {tracking === "serial" && (
          <TextField label="Serial Numbers (one per line)" size="small" multiline minRows={3} value={serials}
            onChange={(e) => setSerials(e.target.value)} sx={full}
            helperText={`Optional — generated from ${order?.order_no} when left empty`} />
        )}
        <TextField label="Remark" size="small" value={remark} onChange={(e) => setRemark(e.target.value)}
          sx={full} inputProps={{ maxLength: 255 }} />
      </Box>
      {byProducts.length > 0 && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>By-products received</Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            Prefilled with the expected amount for the good units being recorded. Change them to what actually came out.
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow sx={modernTableStyles.headerRow}>
                <TableCell>By-product</TableCell>
                <TableCell align="right">Per Unit</TableCell>
                <TableCell align="right" sx={{ width: 120 }}>Quantity</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {byProducts.map((b) => (
                <TableRow key={b.id} sx={modernTableStyles.bodyRow}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{b.product_name}</Typography>
                    <Typography variant="caption" color="text.secondary">{b.product_code}</Typography>
                  </TableCell>
                  <TableCell align="right">{Number(b.quantity_per_unit)} {b.unit_of_measure || ""}</TableCell>
                  <TableCell align="right">
                    <TextField size="small" type="number" value={byQty[b.id] ?? ""} sx={{ width: 100 }}
                      inputProps={{ min: 0, step: 1 }}
                      onChange={(e) => {
                        setByTouched(true);
                        setByQty((p) => ({ ...p, [b.id]: e.target.value }));
                      }} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
      {backflush.length > 0 && (
        <Alert severity="info">
          Backflushed components are consumed automatically for the units recorded: {backflush.map((m) => m.product_name).join(", ")}.
        </Alert>
      )}
      {error && (goodQty > 0 || scrapQty > 0 || good !== "") && <Alert severity="warning">{error}</Alert>}
    </TSidePanel>
  );
}

// ─────────────────────────── job-card time ───────────────────────────
interface TimeLogPanelProps {
  open: boolean;
  order: ProductionOrder | null;
  saving: boolean;
  initialOperationId?: number | null;
  onClose: () => void;
  onSubmit: (data: TimeLogInput) => void;
}

export function TimeLogPanel({ open, order, saving, initialOperationId, onClose, onSubmit }: TimeLogPanelProps) {
  // Outside operations are done by a subcontractor: no time is logged on them
  const operations = useMemo(
    () => (order?.operations || []).filter((o) => o.status !== "completed" && !o.is_outside),
    [order]
  );
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
    else if (end <= start) error = "End time must be after the start time";
  } else if (!(mins > 0)) error = "Enter the minutes worked";
  const qtyLimit = order ? Math.max(order.max_quantity || order.planned_quantity, order.produced_quantity + order.scrapped_quantity) : 0;
  if (!error && op && order && (op.completed_quantity ?? 0) + Math.max(Math.floor(Number(qty) || 0), 0) > qtyLimit)
    error = `Only ${Math.max(qtyLimit - (op.completed_quantity ?? 0), 0)} more unit(s) can be completed on this operation`;

  return (
    <TSidePanel
      open={open}
      onClose={saving ? () => undefined : onClose}
      title={`Log Time — ${order?.order_no || ""}`}
      width={520}
      onSubmit={() =>
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
      isSubmitting={saving}
      submitDisabled={saving || !!error || operations.length === 0}
      submitText="Log Time"
    >
      {operations.length === 0 ? (
        <Alert severity="info">Every in-house operation on this order is completed.</Alert>
      ) : (
        <Box sx={grid}>
          <TextField select label="Operation" size="small" required value={operationId}
            onChange={(e) => setOperationId(Number(e.target.value))} sx={full}>
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
            sx={full}
          />
          <FormControlLabel
            sx={full}
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
            sx={full}
            control={<Checkbox size="small" checked={complete} onChange={(e) => setComplete(e.target.checked)} />}
            label="Mark operation complete"
          />
          <TextField label="Remark" size="small" value={remark} onChange={(e) => setRemark(e.target.value)}
            sx={full} inputProps={{ maxLength: 255 }} />
        </Box>
      )}
      {error && operations.length > 0 && (minutes !== "" || useTimes) && <Alert severity="warning">{error}</Alert>}
    </TSidePanel>
  );
}

// ─────────────────────────── outside work ───────────────────────────
interface OutsideWorkPanelProps {
  open: boolean;
  order: ProductionOrder | null;
  saving: boolean;
  initialOperationId?: number | null;
  currencySymbol: string;
  onClose: () => void;
  onSubmit: (data: OutsideReceiptInput) => void;
}

export function OutsideWorkPanel({ open, order, saving, initialOperationId, currencySymbol, onClose, onSubmit }: OutsideWorkPanelProps) {
  const cap = order ? order.max_quantity || order.planned_quantity : 0;
  const operations = useMemo(
    () => (order?.operations || []).filter((o) => o.is_outside && o.outside_quantity < cap),
    [order, cap]
  );
  const [operationId, setOperationId] = useState<number | "">("");
  const [qty, setQty] = useState("");
  const [amount, setAmount] = useState("");
  const [billRef, setBillRef] = useState("");
  const [remark, setRemark] = useState("");
  const [createExpense, setCreateExpense] = useState(true);

  const op = operations.find((o) => o.id === operationId);

  useEffect(() => {
    if (!open || !order) return;
    const first = operations.find((o) => o.id === initialOperationId) || operations[0];
    setOperationId(first ? first.id : "");
    setQty(first ? String(Math.max(Math.min(order.planned_quantity, cap) - first.outside_quantity, 0)) : "");
    setAmount("");
    setBillRef("");
    setRemark("");
    setCreateExpense(true);
  }, [open, order, operations, initialOperationId, cap]);

  const q = toInt(qty);
  const left = op ? Math.max(cap - op.outside_quantity, 0) : 0;
  const defaultAmount = op ? Number(op.outside_unit_cost) * q : 0;
  const amt = amount.trim() === "" ? null : Number(amount);

  let error: string | null = null;
  if (!op) error = "Select an outside operation";
  else if (q < 1) error = "Enter the units that came back";
  else if (q > left) error = `Only ${left} more unit(s) can come back from '${op.name}'`;
  else if (amt !== null && !(amt >= 0)) error = "The amount cannot be negative";

  return (
    <TSidePanel
      open={open}
      onClose={saving ? () => undefined : onClose}
      title={`Receive Outside Work — ${order?.order_no || ""}`}
      width={520}
      onSubmit={() =>
        op &&
        onSubmit({
          operation_id: op.id,
          quantity: q,
          amount: amt,
          bill_reference: billRef.trim() || null,
          remark: remark.trim() || null,
          create_expense: createExpense,
        })
      }
      isSubmitting={saving}
      submitDisabled={saving || !!error}
      submitText="Receive"
    >
      <Typography variant="body2" color="text.secondary">
        Units came back from the subcontractor. The agreed price is added to the order's work in progress as outside cost.
      </Typography>
      {operations.length === 0 ? (
        <Alert severity="info">Every outside operation on this order has been received in full.</Alert>
      ) : (
        <Box sx={grid}>
          <TextField select label="Outside Operation" size="small" required value={operationId} sx={full}
            onChange={(e) => {
              const next = operations.find((o) => o.id === Number(e.target.value));
              setOperationId(Number(e.target.value));
              if (next && order) setQty(String(Math.max(Math.min(order.planned_quantity, cap) - next.outside_quantity, 0)));
            }}>
            {operations.map((o) => (
              <MenuItem key={o.id} value={o.id}>
                {o.sequence} · {o.name}{o.supplier_name ? ` — ${o.supplier_name}` : ""} ({o.outside_quantity} received)
              </MenuItem>
            ))}
          </TextField>
          {op && (
            <Typography variant="caption" color="text.secondary" sx={full}>
              Supplier: {op.supplier_name || "-"} · Price {currencySymbol} {fmtLKR(Number(op.outside_unit_cost))} per unit ·{" "}
              {op.outside_quantity} of {cap} received
            </Typography>
          )}
          <TextField label="Quantity Received" size="small" type="number" required value={qty}
            onChange={(e) => setQty(e.target.value)} inputProps={{ min: 1, max: left, step: 1 }} />
          <TextField label={`Amount (${currencySymbol})`} size="small" type="number" value={amount}
            onChange={(e) => setAmount(e.target.value)} inputProps={{ min: 0, step: "0.01" }}
            placeholder={fmtLKR(defaultAmount)}
            helperText={`Leave empty for ${q} x ${fmtLKR(Number(op?.outside_unit_cost || 0))} = ${fmtLKR(defaultAmount)}`} />
          <TextField label="Supplier Bill Reference" size="small" value={billRef} sx={full}
            onChange={(e) => setBillRef(e.target.value)} inputProps={{ maxLength: 100 }} />
          <TextField label="Remark" size="small" value={remark} sx={full}
            onChange={(e) => setRemark(e.target.value)} inputProps={{ maxLength: 255 }} />
          <FormControlLabel
            sx={full}
            control={<Checkbox size="small" checked={createExpense} onChange={(e) => setCreateExpense(e.target.checked)} />}
            label="Raise a pending expense for the subcontractor's bill"
          />
          <Typography variant="caption" color="text.secondary" sx={{ ...full, mt: -1 }}>
            Creates a pending expense (outside work, account 5040) for this amount so finance can approve and pay the
            subcontractor. Untick it when the bill is entered separately.
          </Typography>
        </Box>
      )}
      {error && operations.length > 0 && qty !== "" && <Alert severity="warning">{error}</Alert>}
    </TSidePanel>
  );
}

// ─────────────────────────── quality check ───────────────────────────
interface QualityCheckPanelProps {
  open: boolean;
  order: ProductionOrder | null;
  /** Activity outputs; those on hold / partly passed are listed */
  outputs: ProductionOutput[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (data: QcDecisionInput) => void;
}

const isOnHold = (o: ProductionOutput) => o.qc_status === "on_hold" || o.qc_status === "partly_passed";
const waitingQty = (o: ProductionOutput) => Math.max(o.quantity - o.qc_passed_quantity - o.qc_failed_quantity, 0);

export function QualityCheckPanel({ open, order, outputs, saving, onClose, onSubmit }: QualityCheckPanelProps) {
  const held = useMemo(() => outputs.filter((o) => isOnHold(o) && waitingQty(o) > 0), [outputs]);
  const [outputId, setOutputId] = useState<number | "">("");
  const [passed, setPassed] = useState("");
  const [failed, setFailed] = useState("0");
  const [remark, setRemark] = useState("");

  const pick = (o: ProductionOutput | undefined) => {
    setOutputId(o ? o.id : "");
    setPassed(o ? String(waitingQty(o)) : "");
    setFailed("0");
    setRemark("");
  };

  useEffect(() => {
    if (!open) return;
    const first = held[0];
    setOutputId(first ? first.id : "");
    setPassed(first ? String(waitingQty(first)) : "");
    setFailed("0");
    setRemark("");
  }, [open, held]);

  const out = held.find((o) => o.id === outputId);
  const p = toInt(passed);
  const f = toInt(failed);
  const waiting = out ? waitingQty(out) : 0;
  let error: string | null = null;
  if (!out) error = "Select an output on hold";
  else if (p + f === 0) error = "Enter the units that passed or failed";
  else if (p + f > waiting) error = `Only ${waiting} unit(s) of this output are still on hold`;
  else if (f > 0 && !remark.trim()) error = "Give a remark for the failed units";

  return (
    <TSidePanel
      open={open}
      onClose={saving ? () => undefined : onClose}
      title={`Quality Check — ${order?.order_no || ""}`}
      width={620}
      onSubmit={() => out && onSubmit({ output_id: out.id, passed_quantity: p, failed_quantity: f, remark: remark.trim() || null })}
      isSubmitting={saving}
      submitDisabled={saving || !!error}
      submitText="Save Decision"
    >
      <Typography variant="body2" color="text.secondary">
        Passed units become available stock (or are reserved for the quotation line). Failed units are written off at
        their standard cost.
      </Typography>
      {held.length === 0 ? (
        <Alert severity="info">No output of this order is waiting for a quality check.</Alert>
      ) : (
        <>
          <Table size="small">
            <TableHead>
              <TableRow sx={modernTableStyles.headerRow}>
                <TableCell padding="checkbox" />
                <TableCell>Recorded</TableCell>
                <TableCell>Batch</TableCell>
                <TableCell align="right">Good</TableCell>
                <TableCell align="right">Passed</TableCell>
                <TableCell align="right">Failed</TableCell>
                <TableCell align="right">On Hold</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {held.map((o) => (
                <TableRow key={o.id} hover selected={o.id === outputId} onClick={() => pick(o)} sx={{ cursor: "pointer" }}>
                  <TableCell padding="checkbox">
                    <Checkbox size="small" checked={o.id === outputId} />
                  </TableCell>
                  <TableCell>{formatDateTimeReadable(o.receipt_date)}</TableCell>
                  <TableCell>
                    {o.batch_no || (o.serial_numbers.length ? `${o.serial_numbers.length} serial(s)` : "-")}
                    {o.expiry_date ? ` · exp ${formatDate(o.expiry_date)}` : ""}
                  </TableCell>
                  <TableCell align="right">{o.quantity}</TableCell>
                  <TableCell align="right">{o.qc_passed_quantity}</TableCell>
                  <TableCell align="right">{o.qc_failed_quantity}</TableCell>
                  <TableCell align="right"><strong>{waitingQty(o)}</strong></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {out && (
            <Box sx={grid}>
              <TextField label="Passed Quantity" size="small" type="number" value={passed}
                onChange={(e) => setPassed(e.target.value)} inputProps={{ min: 0, max: waiting, step: 1 }} />
              <TextField label="Failed Quantity" size="small" type="number" value={failed}
                onChange={(e) => setFailed(e.target.value)} inputProps={{ min: 0, max: waiting, step: 1 }} />
              <TextField label="Remark" size="small" value={remark} sx={full} required={f > 0} multiline minRows={2}
                onChange={(e) => setRemark(e.target.value)} inputProps={{ maxLength: 500 }}
                error={f > 0 && !remark.trim()}
                helperText={f > 0 ? "Required: why the units failed" : "Optional"} />
            </Box>
          )}
          {error && out && <Alert severity="warning">{error}</Alert>}
        </>
      )}
    </TSidePanel>
  );
}

// ─────────────────────────── complete ───────────────────────────
interface CompleteOrderPanelProps {
  open: boolean;
  order: ProductionOrder | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (bookPlannedTime: boolean) => void;
}

export function CompleteOrderPanel({ open, order, saving, onClose, onSubmit }: CompleteOrderPanelProps) {
  const [book, setBook] = useState(true);
  useEffect(() => {
    if (open) setBook(true);
  }, [open]);
  const noTime = (order?.operations || []).filter((o) => !o.is_outside && Number(o.actual_minutes) === 0);
  const outsideOpen = (order?.operations || []).filter((o) => o.is_outside && o.outside_quantity < (order?.planned_quantity ?? 0));
  return (
    <TSidePanel
      open={open}
      onClose={saving ? () => undefined : onClose}
      title={`Complete ${order?.order_no || ""}`}
      width={480}
      onSubmit={() => onSubmit(book)}
      isSubmitting={saving}
      submitDisabled={saving}
      submitText="Complete Order"
    >
      <Typography variant="body2">
        Every operation is marked completed. {order?.produced_quantity ?? 0} good and {order?.scrapped_quantity ?? 0} scrap of{" "}
        {order?.planned_quantity ?? 0} planned have been recorded.
      </Typography>
      <FormControlLabel
        control={<Checkbox size="small" checked={book} onChange={(e) => setBook(e.target.checked)} />}
        label="Book planned time for in-house operations with no time logged"
      />
      <Typography variant="caption" color="text.secondary" sx={{ mt: -1.5 }}>
        Their planned time (pro rata to the units done) is costed into work in progress. Untick it when nobody worked on those
        steps or their cost should not be absorbed.
      </Typography>
      {noTime.length > 0 && (
        <Alert severity="info">
          No time logged on: {noTime.map((o) => o.name).join(", ")}.
        </Alert>
      )}
      {outsideOpen.length > 0 && (
        <Alert severity="warning">
          Outside work not fully received: {outsideOpen.map((o) => `${o.name} (${o.outside_quantity}/${order?.planned_quantity})`).join(", ")}.
        </Alert>
      )}
    </TSidePanel>
  );
}

// ─────────────────────────── cancel ───────────────────────────
interface CancelOrderPanelProps {
  open: boolean;
  orderNo?: string;
  saving: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}

export function CancelOrderPanel({ open, orderNo, saving, onClose, onSubmit }: CancelOrderPanelProps) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  return (
    <TSidePanel
      open={open}
      onClose={saving ? () => undefined : onClose}
      title={`Cancel Production Order ${orderNo || ""}`}
      width={480}
      onSubmit={() => onSubmit(reason.trim())}
      isSubmitting={saving}
      submitDisabled={saving || !reason.trim()}
      submitText="Cancel Order"
      cancelText="Keep Order"
    >
      <Typography variant="body2" color="text.secondary">
        A cancelled order cannot be reopened. Issued materials must be returned first.
      </Typography>
      <TextField label="Reason" size="small" fullWidth required multiline minRows={2} value={reason}
        onChange={(e) => setReason(e.target.value)} inputProps={{ maxLength: 500 }} autoFocus />
    </TSidePanel>
  );
}
