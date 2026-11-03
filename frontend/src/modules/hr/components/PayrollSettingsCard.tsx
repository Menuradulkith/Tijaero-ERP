/**
 * PayrollSettingsCard — company payroll rules (Sri Lankan defaults): EPF / ETF rates, overtime,
 * late cuts, stamp duty, gratuity and the employer numbers printed on the statutory returns.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, Button, FormControlLabel, Paper, Switch, TextField, Typography } from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";

import { handleApiError, showErrorToast, showSuccessToast } from "@/components/tijaero";
import { payrollSettingsApi } from "@/modules/hr/api";
import type { PayrollSettings } from "@/modules/hr/types";

const SL_DEFAULTS: Partial<PayrollSettings> = {
  epf_employee_rate: 8, epf_employer_rate: 12, etf_rate: 3, ot_multiplier: 1.5, ot_divisor: 240, stamp_duty_amount: 25, stamp_duty_threshold: 25000,
};

export default function PayrollSettingsCard({ canUpdate }: { canUpdate: boolean }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["hr", "payroll-settings"], queryFn: () => payrollSettingsApi.get() });
  const [form, setForm] = useState<PayrollSettings | null>(null);
  useEffect(() => {
    if (data) setForm(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, typeof v === "string" && k !== "employer_epf_no" && k !== "employer_tin" ? Number(v) : v])) as unknown as PayrollSettings);
  }, [data]);
  const save = useMutation({
    mutationFn: (d: PayrollSettings) => payrollSettingsApi.update(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hr", "payroll-settings"] }); showSuccessToast("Payroll settings saved"); },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to save payroll settings")),
  });
  if (!form) return <Typography variant="body2" color="text.secondary">Loading…</Typography>;

  const num = (k: keyof PayrollSettings, label: string, props: Record<string, unknown> = {}, helper?: string) => (
    <TextField size="small" type="number" label={label} value={form[k] as number} disabled={!canUpdate} helperText={helper}
      inputProps={{ step: "0.01", ...props }} onChange={(e) => setForm({ ...form, [k]: parseFloat(e.target.value) || 0 })} />
  );
  const sw = (k: keyof PayrollSettings, label: string) => (
    <FormControlLabel label={label} disabled={!canUpdate}
      control={<Switch checked={Boolean(form[k])} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} />} />
  );
  const grid = { display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" }, gap: 2 };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 980 }}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" fontWeight={600}>Employer</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Printed on EPF Form C, ETF R4 and the APIT schedule.</Typography>
        <Box sx={grid}>
          <TextField size="small" label="Employer EPF registration no." value={form.employer_epf_no || ""} disabled={!canUpdate}
            inputProps={{ maxLength: 30 }} onChange={(e) => setForm({ ...form, employer_epf_no: e.target.value })} />
          <TextField size="small" label="Employer TIN" value={form.employer_tin || ""} disabled={!canUpdate}
            inputProps={{ maxLength: 30 }} onChange={(e) => setForm({ ...form, employer_tin: e.target.value })} />
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" fontWeight={600}>EPF / ETF</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Worked out on basic salary plus allowances marked "EPF" on the salary profile, less no-pay. Overtime is not included.
        </Typography>
        <Box sx={grid}>
          {num("epf_employee_rate", "EPF employee %", { min: 0, max: 100 })}
          {num("epf_employer_rate", "EPF employer %", { min: 0, max: 100 })}
          {num("etf_rate", "ETF employer %", { min: 0, max: 100 })}
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" fontWeight={600}>Overtime &amp; late attendance</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Hourly rate = (basic + EPF allowances) ÷ divisor. Shop &amp; Office Act: 1.5 × the hourly rate, divisor 240. Overtime minutes
          come from attendance; switch overtime off per employee on the employee record.
        </Typography>
        <Box sx={grid}>
          {sw("pay_overtime", "Pay overtime")}
          {num("ot_multiplier", "Overtime rate (×)", { min: 1, max: 5, step: "0.25" })}
          {num("ot_divisor", "Monthly hours divisor", { min: 100, max: 400, step: "1" })}
          {sw("deduct_late", "Cut pay for late minutes (plain hourly rate)")}
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" fontWeight={600}>Stamp duty &amp; gratuity</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Stamp duty is taken when monthly pay is above the threshold. Gratuity (Payment of Gratuity Act, employers with 15+ workers): half a month's
          salary per completed year after 5 years, shown in the employee's final settlement.
        </Typography>
        <Box sx={grid}>
          {num("stamp_duty_amount", "Stamp duty (LKR)", { min: 0 })}
          {num("stamp_duty_threshold", "When pay is above (LKR)", { min: 0 })}
          {sw("gratuity_enabled", "Gratuity applies")}
        </Box>
      </Paper>

      {canUpdate && (
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button variant="contained" color="success" startIcon={<SaveIcon />} disabled={save.isPending} onClick={() => save.mutate(form)}>Save</Button>
          <Button onClick={() => setForm({ ...form, ...SL_DEFAULTS } as PayrollSettings)}>Reset to Sri Lankan defaults</Button>
        </Box>
      )}
    </Box>
  );
}
