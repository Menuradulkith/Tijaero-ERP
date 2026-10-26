import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { usePermission } from "@/auth/permissions";
import { fmtLKR, handleApiError, showSuccessToast, TChip } from "@/components/tijaero";
import ReclassifyDialog from "@/modules/inventory/components/ReclassifyDialog";
import { useCurrencyStore } from "@/state/currencyStore";
import { goodReceivedNotesApi } from "@/modules/purchasing/api";
import type { LandedCostCreate } from "@/modules/purchasing/types";

const CHARGE_TYPES = [
  { value: "freight", label: "Freight" },
  { value: "duty", label: "Import duty" },
  { value: "insurance", label: "Insurance" },
  { value: "handling", label: "Handling" },
  { value: "other", label: "Other" },
] as const;

const EMPTY: LandedCostCreate = {
  charge_type: "freight",
  amount: 0,
  allocation_basis: "value",
  payment_method: "credit",
  description: "",
  reference_no: "",
};

interface Props {
  grnId: number;
  grnStatus?: string;
}

/** Landed costs of a GRN: vouchers (freight, duty...) allocated across its lines, giving each line a landed unit cost. */
export default function LandedCostPanel({ grnId, grnStatus }: Props) {
  const queryClient = useQueryClient();
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const canEdit = usePermission("grn", "update") && grnStatus !== "cancelled";
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<LandedCostCreate>(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["grn-landed-costs", grnId],
    queryFn: () => goodReceivedNotesApi.getLandedCosts(grnId),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["grn-landed-costs", grnId] });

  const addMutation = useMutation({
    mutationFn: (payload: LandedCostCreate) => goodReceivedNotesApi.addLandedCost(grnId, payload),
    onSuccess: () => {
      showSuccessToast("Landed cost added");
      setAddOpen(false);
      setForm(EMPTY);
      refresh();
    },
    onError: (error: unknown) => setFormError(handleApiError(error, "Could not add the landed cost")),
  });
  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => goodReceivedNotesApi.cancelLandedCost(id, reason),
    onSuccess: () => {
      showSuccessToast("Landed cost cancelled");
      setCancelId(null);
      refresh();
    },
    onError: (error: unknown) => setCancelError(handleApiError(error, "Could not cancel the landed cost")),
  });

  const vouchers = data?.vouchers ?? [];
  const lines = data?.lines ?? [];
  if (isLoading) return <CircularProgress size={18} sx={{ mt: 2 }} />;
  if (!canEdit && vouchers.length === 0) return null;

  return (
    <Paper variant="outlined" sx={{ mt: 2, p: 1.5 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
        <Typography variant="subtitle2">Landed costs (freight, duty, insurance...)</Typography>
        {canEdit && (
          <Button
            size="small"
            variant="outlined"
            onClick={() => {
              setForm(EMPTY);
              setFormError(null);
              setAddOpen(true);
            }}
          >
            Add landed cost
          </Button>
        )}
      </Box>

      {vouchers.length > 0 && (
        <Table size="small" sx={{ mb: 1.5 }}>
          <TableHead>
            <TableRow>
              <TableCell>Voucher</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Basis</TableCell>
              <TableCell>Paid via</TableCell>
              <TableCell>Reference</TableCell>
              <TableCell align="right">{`Amount (${currencySymbol})`}</TableCell>
              <TableCell align="center">Status</TableCell>
              {canEdit && <TableCell />}
            </TableRow>
          </TableHead>
          <TableBody>
            {vouchers.map((v) => (
              <TableRow key={v.id} sx={v.status === "cancelled" ? { opacity: 0.5 } : undefined}>
                <TableCell>{v.voucher_no}</TableCell>
                <TableCell>{CHARGE_TYPES.find((c) => c.value === v.charge_type)?.label ?? v.charge_type}</TableCell>
                <TableCell>{v.allocation_basis === "value" ? "By value" : "By quantity"}</TableCell>
                <TableCell>{v.payment_method === "credit" ? "On credit" : v.payment_method === "cash" ? "Cash" : "Bank"}</TableCell>
                <TableCell>{v.reference_no || v.description || "-"}</TableCell>
                <TableCell align="right">{fmtLKR(Number(v.amount))}</TableCell>
                <TableCell align="center">
                  <TChip
                    size="small"
                    label={v.status === "cancelled" ? "Cancelled" : "Posted"}
                    color={v.status === "cancelled" ? "default" : "success"}
                  />
                </TableCell>
                {canEdit && (
                  <TableCell align="right">
                    {v.status === "posted" && (
                      <Button
                        size="small"
                        color="error"
                        onClick={() => {
                          setCancelError(null);
                          setCancelId(v.id);
                        }}
                      >
                        Cancel
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {lines.length > 0 && Number(data?.total_landed) > 0 && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Product</TableCell>
              <TableCell align="right">Qty</TableCell>
              <TableCell align="right">{`Unit price (${currencySymbol})`}</TableCell>
              <TableCell align="right">{`Landed / unit (${currencySymbol})`}</TableCell>
              <TableCell align="right">{`Landed unit cost (${currencySymbol})`}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map((l) => (
              <TableRow key={l.purchasing_order_items_id}>
                <TableCell>{l.product_name}</TableCell>
                <TableCell align="right">{l.quantity}</TableCell>
                <TableCell align="right">{fmtLKR(Number(l.unit_price))}</TableCell>
                <TableCell align="right">{fmtLKR(Number(l.landed_per_unit))}</TableCell>
                <TableCell align="right">
                  <strong>{fmtLKR(Number(l.landed_unit_cost))}</strong>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={addOpen} onClose={() => !addMutation.isPending && setAddOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Add landed cost</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
          <Typography variant="body2" color="text.secondary">
            The amount is spread across this GRN's lines and capitalised into inventory (Dr Inventory).
          </Typography>
          <TextField select label="Charge type" value={form.charge_type} onChange={(e) => setForm({ ...form, charge_type: e.target.value as LandedCostCreate["charge_type"] })}>
            {CHARGE_TYPES.map((c) => (
              <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            label={`Amount (${currencySymbol})`}
            type="number"
            required
            value={form.amount || ""}
            onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
            inputProps={{ min: 0, step: 0.01 }}
          />
          <TextField select label="Allocate" value={form.allocation_basis} onChange={(e) => setForm({ ...form, allocation_basis: e.target.value as LandedCostCreate["allocation_basis"] })}>
            <MenuItem value="value">By line value (qty x unit price)</MenuItem>
            <MenuItem value="quantity">By quantity</MenuItem>
          </TextField>
          <TextField select label="Settled" value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value as LandedCostCreate["payment_method"] })}
            helperText="Credit = owed to the forwarder (Trade Creditors); cash / bank = paid now">
            <MenuItem value="credit">On credit</MenuItem>
            <MenuItem value="cash">Paid in cash</MenuItem>
            <MenuItem value="bank">Paid from bank</MenuItem>
          </TextField>
          <TextField label="Reference (invoice / bill no)" value={form.reference_no || ""} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} inputProps={{ maxLength: 200 }} />
          <TextField label="Description" value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} inputProps={{ maxLength: 200 }} />
          {formError && <Alert severity="error">{formError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)} disabled={addMutation.isPending}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!(form.amount > 0) || addMutation.isPending}
            onClick={() => {
              setFormError(null);
              addMutation.mutate({
                ...form,
                reference_no: form.reference_no?.trim() || undefined,
                description: form.description?.trim() || undefined,
              });
            }}
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>

      <ReclassifyDialog
        open={cancelId !== null}
        title="Cancel landed cost"
        description="The allocation is removed from the GRN lines and the journal entry is reversed."
        confirmLabel="Cancel voucher"
        isSubmitting={cancelMutation.isPending}
        error={cancelError}
        onClose={() => setCancelId(null)}
        onSubmit={(reason) => cancelId !== null && cancelMutation.mutate({ id: cancelId, reason })}
      />
    </Paper>
  );
}
