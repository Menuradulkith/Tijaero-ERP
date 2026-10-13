/** HR Reports — headcount, birthdays and anniversaries, expiries, leave summary, attrition. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Box, Chip, LinearProgress, MenuItem, Paper, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, Typography } from "@mui/material";
import { MasterDetailLayout } from "@/components/tijaero";
import { hrReportsApi, type CountRow, type ExpiryRow, type UpcomingRow } from "@/modules/hr/core-api";

const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
const thisYear = new Date().getFullYear();

function Bars({ title, rows, total }: { title: string; rows: CountRow[]; total: number }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>{title}</Typography>
      {rows.length === 0 && <Typography variant="body2" color="text.secondary">No data</Typography>}
      {rows.map((r) => (
        <Box key={String(r.key)} sx={{ mb: 0.75 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
            <Typography variant="body2">{r.label}</Typography><Typography variant="body2" fontWeight={600}>{r.count}</Typography>
          </Box>
          <LinearProgress variant="determinate" value={total ? (r.count / total) * 100 : 0} sx={{ height: 6, borderRadius: 3 }} />
        </Box>
      ))}
    </Paper>
  );
}

function SimpleTable({ head, rows, empty }: { head: string[]; rows: (string | number | JSX.Element | null)[][]; empty: string }) {
  return (
    <Paper variant="outlined" sx={{ overflow: "auto" }}>
      <Table size="small">
        <TableHead><TableRow>{head.map((h) => <TableCell key={h} sx={{ fontWeight: 600 }}>{h}</TableCell>)}</TableRow></TableHead>
        <TableBody>
          {rows.length === 0 && <TableRow><TableCell colSpan={head.length}><Typography variant="body2" color="text.secondary">{empty}</Typography></TableCell></TableRow>}
          {rows.map((r, i) => <TableRow key={i} hover>{r.map((c, j) => <TableCell key={j}>{c}</TableCell>)}</TableRow>)}
        </TableBody>
      </Table>
    </Paper>
  );
}

const upcoming = (rows: UpcomingRow[], noun: string) => (
  <SimpleTable head={["Employee", "ID", "Date", "In", noun === "Birthday" ? "Turning" : "Years"]} empty={`No ${noun.toLowerCase()}s in this period`}
    rows={rows.map((r) => [r.name ?? "—", r.employee_id, fmt(r.date), r.days_to_go === 0 ? <Chip size="small" color="primary" label="Today" /> : `${r.days_to_go} day(s)`, r.years])} />
);
const expiry = (title: string, rows: ExpiryRow[], withDoc = false) => (
  <Box sx={{ mb: 2 }} key={title}>
    <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>{title} <Chip size="small" label={rows.length} sx={{ ml: 0.5 }} /></Typography>
    <SimpleTable head={withDoc ? ["Employee", "ID", "Document", "Expires", "Left"] : ["Employee", "ID", "Date", "Left"]} empty="Nothing due in this window"
      rows={rows.map((r) => {
        const left = <Chip size="small" color={r.days_left < 0 ? "error" : r.days_left <= 14 ? "warning" : "default"} label={r.days_left < 0 ? `${-r.days_left} d overdue` : `${r.days_left} d`} />;
        return withDoc ? [r.name ?? "—", r.employee_id, r.title ?? r.doc_type ?? "", fmt(r.date), left] : [r.name ?? "—", r.employee_id, fmt(r.date), left];
      })} />
  </Box>
);

const TABS = ["Headcount", "Birthdays & Anniversaries", "Expiries", "Leave", "Attrition"] as const;

export default function HRReportsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Headcount");
  const [days, setDays] = useState(30);
  const [year, setYear] = useState(thisYear);
  const head = useQuery({ queryKey: ["hr", "report", "headcount"], queryFn: hrReportsApi.headcount, enabled: tab === "Headcount" });
  const bdays = useQuery({ queryKey: ["hr", "report", "birthdays", days], queryFn: () => hrReportsApi.birthdays(days), enabled: tab === "Birthdays & Anniversaries" });
  const annis = useQuery({ queryKey: ["hr", "report", "anniversaries", days], queryFn: () => hrReportsApi.anniversaries(days), enabled: tab === "Birthdays & Anniversaries" });
  const exp = useQuery({ queryKey: ["hr", "report", "expiring", days], queryFn: () => hrReportsApi.expiring(days), enabled: tab === "Expiries" });
  const leave = useQuery({ queryKey: ["hr", "report", "leave", year], queryFn: () => hrReportsApi.leaveSummary(year), enabled: tab === "Leave" });
  const attr = useQuery({ queryKey: ["hr", "report", "attrition", year], queryFn: () => hrReportsApi.attrition(year), enabled: tab === "Attrition" });
  const loading = head.isFetching || bdays.isFetching || exp.isFetching || leave.isFetching || attr.isFetching;
  const usesDays = tab === "Birthdays & Anniversaries" || tab === "Expiries";
  const usesYear = tab === "Leave" || tab === "Attrition";

  return (
    <MasterDetailLayout title="HR Reports" isLoading={loading}
      titleSlot={(
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flex: 1 }}>
          <Typography variant="h6" sx={{ mr: 1 }}>HR Reports</Typography>
          {usesDays && <TextField select size="small" label="Look ahead" value={days} onChange={(e) => setDays(Number(e.target.value))} sx={{ width: 140 }}>
            {[7, 14, 30, 60, 90, 180, 365].map((d) => <MenuItem key={d} value={d}>{d} days</MenuItem>)}</TextField>}
          {usesYear && <TextField size="small" type="number" label="Year" value={year} onChange={(e) => setYear(Number(e.target.value) || thisYear)} sx={{ width: 100 }} inputProps={{ min: 2000, max: 2100 }} />}
        </Box>
      )}>
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 1.5, borderBottom: 1, borderColor: "divider" }}>
          {TABS.map((t) => <Tab key={t} value={t} label={t} sx={{ textTransform: "none" }} />)}
        </Tabs>

        {tab === "Headcount" && head.data && (
          <>
            <Box sx={{ display: "flex", gap: 1.5, mb: 1.5, flexWrap: "wrap" }}>
              <Paper variant="outlined" sx={{ p: 1.5, minWidth: 180 }}><Typography variant="caption" color="text.secondary">Employees in service</Typography><Typography variant="h4">{head.data.total}</Typography></Paper>
              {head.data.by_status.map((s) => <Paper key={String(s.key)} variant="outlined" sx={{ p: 1.5, minWidth: 130 }}><Typography variant="caption" color="text.secondary">{s.label}</Typography><Typography variant="h5">{s.count}</Typography></Paper>)}
            </Box>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" }, gap: 1.5 }}>
              <Bars title="By department" rows={head.data.by_department} total={head.data.total} />
              <Bars title="By designation" rows={head.data.by_designation} total={head.data.total} />
              <Bars title="By employment type" rows={head.data.by_employment_type} total={head.data.total} />
              <Bars title="By branch" rows={head.data.by_branch} total={head.data.total} />
              <Bars title="By gender" rows={head.data.by_gender} total={head.data.total} />
            </Box>
          </>
        )}

        {tab === "Birthdays & Anniversaries" && (
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1.5 }}>
            <Box><Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>Birthdays</Typography>{upcoming(bdays.data ?? [], "Birthday")}</Box>
            <Box><Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>Work anniversaries</Typography>{upcoming(annis.data ?? [], "Anniversary")}</Box>
          </Box>
        )}

        {tab === "Expiries" && exp.data && (
          <>
            {expiry("Contracts ending", exp.data.contracts)}
            {expiry("Probation ending", exp.data.probation)}
            {expiry("Retirements (next 6× the window)", exp.data.retirements)}
            {expiry("Documents expiring", exp.data.documents, true)}
          </>
        )}

        {tab === "Leave" && leave.data && (
          <>
            <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>Leave taken in {leave.data.year}</Typography>
            <SimpleTable head={["Leave type", "Applications", "Approved days", "Pending days", "Rejected days"]} empty="No leave applications this year"
              rows={leave.data.by_type.map((t) => [t.name, t.applications, t.approved_days, t.pending_days, t.rejected_days])} />
            <Typography variant="subtitle1" fontWeight={600} sx={{ mt: 2, mb: 0.5 }}>On leave today <Chip size="small" label={leave.data.on_leave_today.length} /></Typography>
            <SimpleTable head={["Employee", "ID", "Type", "From", "To"]} empty="Nobody is on leave today"
              rows={leave.data.on_leave_today.map((r) => [r.name ?? "—", r.employee_id, r.leave_type, fmt(r.from_date), fmt(r.to_date)])} />
          </>
        )}

        {tab === "Attrition" && attr.data && (
          <>
            <Box sx={{ display: "flex", gap: 1.5, mb: 1.5, flexWrap: "wrap" }}>
              {[["Joiners", attr.data.joiners], ["Leavers", attr.data.leavers], ["Opening headcount", attr.data.opening_headcount], ["Closing headcount", attr.data.closing_headcount], ["Attrition rate", `${attr.data.attrition_rate_percent}%`]].map(([l, v]) => (
                <Paper key={String(l)} variant="outlined" sx={{ p: 1.5, minWidth: 150 }}><Typography variant="caption" color="text.secondary">{l}</Typography><Typography variant="h5">{v}</Typography></Paper>
              ))}
            </Box>
            <SimpleTable head={["Employee", "ID", "Type", "Last working day", "Reason"]} empty="Nobody left in this year"
              rows={attr.data.leaver_list.map((r) => [r.name ?? "—", r.employee_id, (r.exit_type ?? "").replace("_", " "), fmt(r.last_working_date), r.reason ?? "—"])} />
          </>
        )}
      </Box>
    </MasterDetailLayout>
  );
}
