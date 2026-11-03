/**
 * FinalSettlementDialog — what is due when an employee leaves: gratuity (half a month's salary per completed
 * year after 5 years), loans still owed and company assets not returned. The last month's pro-rated
 * salary itself is paid by the normal payroll run.
 */
import { useQuery } from "@tanstack/react-query";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Typography } from "@mui/material";

import { fmtLKR } from "@/components/tijaero";
import { finalSettlementApi } from "@/modules/hr/api";

interface Props {
  open: boolean;
  employeePk?: number;
  onClose: () => void;
}

const Row = ({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) => (
  <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.5 }}>
    <Typography variant="body2" color={strong ? undefined : "text.secondary"} fontWeight={strong ? 700 : undefined}>{label}</Typography>
    <Typography variant="body2" fontWeight={strong ? 700 : 500}>{value}</Typography>
  </Box>
);

export default function FinalSettlementDialog({ open, employeePk, onClose }: Props) {
  const { data: fs, isLoading, error } = useQuery({
    queryKey: ["hr", "final-settlement", employeePk],
    queryFn: () => finalSettlementApi.get(employeePk as number),
    enabled: open && !!employeePk,
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Final settlement{fs ? ` • ${fs.name}` : ""}</DialogTitle>
      <DialogContent>
        {isLoading && <Typography variant="body2" color="text.secondary">Working it out…</Typography>}
        {error && <Alert severity="error">You may not have payroll access to see this.</Alert>}
        {fs && (
          <>
            <Row label="Joined" value={fs.date_of_joining || "—"} />
            <Row label="Last working day" value={fs.last_working_date || "Not set (today used)"} />
            <Row label="Completed years of service" value={fs.completed_years} />
            <Row label="Monthly salary for gratuity (basic + EPF allowances)" value={fmtLKR(fs.monthly_salary)} />
            <Divider sx={{ my: 1 }} />
            <Row label={fs.gratuity_eligible ? `Gratuity (½ month × ${fs.completed_years} years)` : "Gratuity"} value={fmtLKR(fs.gratuity)} />
            {fs.loans.map((l) => <Row key={l.loan_no} label={`Less: ${l.loan_type === "advance" ? "salary advance" : "loan"} ${l.loan_no}`} value={`− ${fmtLKR(l.balance)}`} />)}
            <Divider sx={{ my: 1 }} />
            <Row label="Net settlement (besides the last salary)" value={fmtLKR(fs.net_settlement)} strong />
            {fs.last_month && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                Last salary: {fs.last_month.days} of {fs.last_month.days_in_month} days in {fs.last_month.period}
                {fs.last_month.processed ? " — already in a payroll run." : " — paid by that month's payroll run."}
              </Typography>
            )}
            {fs.unreturned_assets.length > 0 && (
              <Alert severity="warning" sx={{ mt: 1.5 }}>
                Assets still assigned: {fs.unreturned_assets.map((a) => a.asset).join(", ")}
              </Alert>
            )}
            {fs.notes.length > 0 && (
              <Box component="ul" sx={{ pl: 2.5, mt: 1.5, mb: 0 }}>
                {fs.notes.map((n) => <Typography key={n} component="li" variant="caption" color="text.secondary">{n}</Typography>)}
              </Box>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
