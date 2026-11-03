/**
 * AllowancesEditor — allowance lines of a salary (name, amount, EPF-liable, taxable).
 * EPF / ETF are worked out on basic + EPF-liable allowances; APIT on taxable pay.
 */
import { Box, Button, Checkbox, FormControlLabel, IconButton, TextField, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";

import { fmtLKR } from "@/components/tijaero";
import type { AllowanceLine } from "@/modules/hr/types";

interface Props {
  value: AllowanceLine[];
  onChange: (rows: AllowanceLine[]) => void;
  disabled?: boolean;
}

const NEW_LINE: AllowanceLine = { name: "", amount: 0, epf_liable: false, taxable: true };

export default function AllowancesEditor({ value, onChange, disabled }: Props) {
  const rows = value || [];
  const set = (i: number, patch: Partial<AllowanceLine>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  if (disabled && rows.length === 0) {
    return <Typography variant="body2" color="text.secondary">No allowances</Typography>;
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {rows.map((r, i) => (
        <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <TextField label="Allowance" size="small" value={r.name} disabled={disabled} sx={{ flex: "1 1 180px" }}
            onChange={(e) => set(i, { name: e.target.value })} placeholder="e.g. Budgetary Relief Allowance" />
          <TextField label="Amount" size="small" type="number" value={Number(r.amount) || ""} disabled={disabled} sx={{ width: 140 }}
            onChange={(e) => set(i, { amount: parseFloat(e.target.value) || 0 })} inputProps={{ step: "0.01", min: 0 }} />
          <Tooltip title="Included in EPF / ETF earnings (e.g. BRA, cost-of-living)">
            <FormControlLabel label="EPF" disabled={disabled}
              control={<Checkbox size="small" checked={r.epf_liable} onChange={(e) => set(i, { epf_liable: e.target.checked })} />} />
          </Tooltip>
          <Tooltip title="Counted for APIT (untick for exempt reimbursements such as travelling)">
            <FormControlLabel label="Taxable" disabled={disabled}
              control={<Checkbox size="small" checked={r.taxable} onChange={(e) => set(i, { taxable: e.target.checked })} />} />
          </Tooltip>
          {!disabled && (
            <IconButton size="small" aria-label="Remove allowance" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          )}
          {disabled && <Typography variant="body2" sx={{ ml: "auto" }}>{fmtLKR(r.amount)}</Typography>}
        </Box>
      ))}
      {!disabled && (
        <Box>
          <Button size="small" startIcon={<AddIcon />} onClick={() => onChange([...rows, { ...NEW_LINE }])}>Add allowance</Button>
        </Box>
      )}
    </Box>
  );
}
