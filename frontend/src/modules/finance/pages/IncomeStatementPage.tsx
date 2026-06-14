/**
 * IncomeStatementPage — Profit & Loss Report
 *
 * Standard ERP Income Statement (IAS 1):
 *   Revenue
 *   – Cost of Sales
 *   ─────────────────
 *   Gross Profit
 *   – Operating Expenses
 *   ─────────────────
 *   Operating Income
 *   + Other Income
 *   – Other Expenses
 *   ─────────────────
 *   Net Income (Loss)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DownloadIcon from "@mui/icons-material/Download";
import { exportToCSV } from "@/utils/csvExport";
import PrintIcon from "@mui/icons-material/Print";
import AssessmentIcon from "@mui/icons-material/Assessment";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import { useNavigate } from "react-router-dom";

import {
  DetailPanelHeader,
  fmtLKR,
  showErrorToast,
  handleApiError,
} from "@/components/tijaero";
import { financialReportsApi } from "../api";
import type {
  IncomeStatementResponse,
  IncomeStatementSection,
  IncomeStatementLineItem,
} from "../types";

// ─── Helpers ────────────────────────────────────────────────────────────────

const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
const periodOptions = [
  { value: 0, label: "Full Year" },
  ...Array.from({ length: 12 }, (_, i) => ({
    value: i + 1,
    label: new Date(2000, i).toLocaleString("default", { month: "long" }),
  })),
];

// ─── Section Table Component ────────────────────────────────────────────────

function SectionTable({
  section,
  isExpense = false,
}: {
  section: IncomeStatementSection;
  isExpense?: boolean;
}) {
  if (!section.items.length) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 1, pl: 2 }}>
        No items
      </Typography>
    );
  }
  return (
    <Table size="small">
      <TableBody>
        {section.items.map((item) => (
          <TableRow key={item.account_id} hover>
            <TableCell sx={{ pl: 4, width: 100, fontFamily: "monospace", color: "text.secondary", fontSize: "0.8rem" }}>
              {item.account_code}
            </TableCell>
            <TableCell>{item.account_name}</TableCell>
            <TableCell align="right" sx={{ fontFamily: "monospace", pr: 3 }}>
              {fmtLKR(Math.abs(Number(item.amount)))}
            </TableCell>
          </TableRow>
        ))}
        <TableRow sx={{ "& td": { fontWeight: 700, borderTop: "2px solid", borderColor: "divider" } }}>
          <TableCell />
          <TableCell>Total {section.section_name}</TableCell>
          <TableCell align="right" sx={{ fontFamily: "monospace", pr: 3, color: isExpense ? "error.main" : "success.main" }}>
            {fmtLKR(Math.abs(Number(section.total)))}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function IncomeStatementPage() {
  const navigate = useNavigate();

  const [fiscalYear, setFiscalYear] = useState(currentYear);
  const [fiscalPeriod, setFiscalPeriod] = useState(0);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<IncomeStatementResponse | null>(null);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { fiscal_year: fiscalYear };
      if (fiscalPeriod > 0) params.fiscal_period = fiscalPeriod;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const data = await financialReportsApi.getIncomeStatement(params as any);
      setReport(data);
    } catch (err) {
      showErrorToast(handleApiError(err, "Failed to load income statement"));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [fiscalYear, fiscalPeriod, dateFrom, dateTo]);

  // Auto-generate on first open so the page is never empty
  useEffect(() => {
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const netIncomeColor = useMemo(() => {
    if (!report) return "text.primary";
    return Number(report.net_income) >= 0 ? "success.main" : "error.main";
  }, [report]);

  // ── CSV Export ───────────────────────────────────────────────────────────
  const handleExportCSV = () => {
    if (!report) return;
    const lines: string[][] = [["Account Code", "Account Name", "Amount (Rs.)"]];
    const addSection = (s: IncomeStatementSection) => {
      lines.push([`--- ${s.section_name} ---`, "", ""]);
      s.items.forEach((i) => lines.push([i.account_code, i.account_name, Math.abs(Number(i.amount)).toFixed(2)]));
      lines.push(["", `Total ${s.section_name}`, Math.abs(Number(s.total)).toFixed(2)]);
    };
    addSection(report.revenue);
    addSection(report.cost_of_sales);
    lines.push(["", "Gross Profit", Number(report.gross_profit).toFixed(2)]);
    addSection(report.operating_expenses);
    lines.push(["", "Operating Income", Number(report.operating_income).toFixed(2)]);
    if (report.other_income.items.length) addSection(report.other_income);
    if (report.other_expenses.items.length) addSection(report.other_expenses);
    lines.push(["", "Net Income", Number(report.net_income).toFixed(2)]);

    exportToCSV({
      filename: `income_statement_${fiscalYear}`,
      headers: lines[0],
      rows: lines.slice(1),
    });
  };

  // ── Print ───────────────────────────────────────────────────────────────
  const handlePrint = () => {
    if (!report) return;
    const win = window.open("", "_blank");
    if (!win) return;

    const sectionHtml = (s: IncomeStatementSection, isExp = false) =>
      s.items.length
        ? `<tr><td colspan="3" style="font-weight:700;padding-top:12px;color:#1976d2">${s.section_name}</td></tr>` +
          s.items.map((i) => `<tr><td style="padding-left:24px;font-family:monospace;color:#888">${i.account_code}</td><td>${i.account_name}</td><td style="text-align:right">${fmtLKR(Math.abs(Number(i.amount)))}</td></tr>`).join("") +
          `<tr style="border-top:1px solid #ccc"><td></td><td style="font-weight:600">Total ${s.section_name}</td><td style="text-align:right;font-weight:700;color:${isExp ? "#c62828" : "#2e7d32"}">${fmtLKR(Math.abs(Number(s.total)))}</td></tr>`
        : "";

    const subtotalRow = (label: string, val: number, bold = false) =>
      `<tr style="background:#f5f5f5"><td></td><td style="font-weight:${bold ? 800 : 600};font-size:${bold ? "14px" : "13px"}">${label}</td><td style="text-align:right;font-weight:${bold ? 800 : 700};font-size:${bold ? "14px" : "13px"};color:${val >= 0 ? "#2e7d32" : "#c62828"}">${val < 0 ? "(" : ""}Rs. ${fmtLKR(Math.abs(val))}${val < 0 ? ")" : ""}</td></tr>`;

    win.document.write(`<!DOCTYPE html><html><head><title>Income Statement</title>
<style>body{font-family:Segoe UI,sans-serif;padding:20px;max-width:800px;margin:0 auto}h1{color:#1976d2;text-align:center;border-bottom:2px solid #1976d2;padding-bottom:10px}
.meta{text-align:center;color:#666;margin-bottom:20px;font-size:13px}table{width:100%;border-collapse:collapse;font-size:12px}td{padding:4px 8px;border-bottom:1px solid #eee}
@media print{body{padding:10px}}</style></head>
<body><h1>Income Statement (Profit & Loss)</h1>
<div class="meta">Fiscal Year ${report.fiscal_year}${report.fiscal_period ? ` • Period ${report.fiscal_period}` : ""}${report.period_start ? ` • ${new Date(report.period_start).toLocaleDateString()} – ${new Date(report.period_end!).toLocaleDateString()}` : ""} • Generated ${new Date().toLocaleString()}</div>
<table>
${sectionHtml(report.revenue)}
${sectionHtml(report.cost_of_sales, true)}
${subtotalRow("Gross Profit", Number(report.gross_profit))}
${sectionHtml(report.operating_expenses, true)}
${subtotalRow("Operating Income", Number(report.operating_income))}
${sectionHtml(report.other_income)}
${sectionHtml(report.other_expenses, true)}
${subtotalRow("Net Income", Number(report.net_income), true)}
</table>
<script>window.onload=function(){window.print()}</script></body></html>`);
    win.document.close();
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Finance", href: "/finance" },
          { label: "Accounting", href: "/finance/chart-of-accounts" },
          { label: "Income Statement" },
        ]}
        title="Income Statement"
        titleIcon={<AssessmentIcon color="primary" />}
        isCreating={false}
      />

      {/* Top bar */}
      <Box sx={{ px: 2, pt: 1, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Button size="small" variant="text" startIcon={<ArrowBackIcon />} onClick={() => navigate("/finance/general-ledger")}>
          Back to GL
        </Button>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button variant="outlined" size="small" startIcon={<DownloadIcon />} onClick={handleExportCSV} disabled={!report}>Export CSV</Button>
          <Button variant="contained" size="small" startIcon={<PrintIcon />} onClick={handlePrint} disabled={!report}>Print</Button>
        </Box>
      </Box>

      {/* Filters */}
      <Paper variant="outlined" sx={{ mx: 2, mt: 1.5, p: 1.5, borderRadius: 2 }}>
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", alignItems: "center" }}>
          <TextField select size="small" label="Fiscal Year" value={fiscalYear} onChange={(e) => setFiscalYear(Number(e.target.value))} sx={{ width: 130 }}>
            {yearOptions.map((y) => <MenuItem key={y} value={y}>{y}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Period" value={fiscalPeriod} onChange={(e) => setFiscalPeriod(Number(e.target.value))} sx={{ width: 160 }}>
            {periodOptions.map((p) => <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>)}
          </TextField>
          <TextField size="small" label="Date From" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ width: 155 }} />
          <TextField size="small" label="Date To" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ width: 155 }} />
          <Button variant="contained" size="small" onClick={fetchReport} disabled={loading}>
            {loading ? <CircularProgress size={18} /> : "Generate"}
          </Button>
        </Box>
      </Paper>

      {/* Report Content */}
      <Box sx={{ flex: 1, overflow: "auto", px: 2, mt: 1.5, mb: 2 }}>
        {!report && !loading && (
          <Paper variant="outlined" sx={{ p: 5, borderRadius: 2, textAlign: "center" }}>
            <AssessmentIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
            <Typography variant="h6" color="text.secondary">Select parameters and click Generate</Typography>
            <Typography variant="body2" color="text.disabled">Income Statement shows revenue, expenses, and net income for the selected period.</Typography>
          </Paper>
        )}

        {loading && (
          <Paper variant="outlined" sx={{ p: 4, textAlign: "center", borderRadius: 2 }}>
            <CircularProgress size={32} />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>Generating report...</Typography>
          </Paper>
        )}

        {report && !loading && (
          <>
            {/* Summary Cards */}
            <Grid container spacing={1.5} sx={{ mb: 2 }}>
              {[
                { label: "Total Revenue", value: report.revenue.total, color: "success.main", icon: <TrendingUpIcon /> },
                { label: "Cost of Sales", value: report.cost_of_sales.total, color: "warning.main", icon: <TrendingDownIcon /> },
                { label: "Gross Profit", value: report.gross_profit, color: "info.main" },
                { label: "Net Income", value: report.net_income, color: netIncomeColor, bold: true },
              ].map((c) => (
                <Grid item xs={6} sm={3} key={c.label}>
                  <Card variant="outlined" sx={{ borderRadius: 2 }}>
                    <CardContent sx={{ py: 1.5, textAlign: "center" }}>
                      <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.4 }}>{c.label}</Typography>
                      <Typography variant="h6" fontWeight={c.bold ? 800 : 700} color={c.color} sx={{ mt: 0.5, fontFamily: "monospace" }}>
                        Rs. {fmtLKR(Math.abs(Number(c.value)))}
                      </Typography>
                      {Number(c.value) < 0 && <Chip label="Loss" size="small" color="error" sx={{ mt: 0.5, height: 18, fontSize: "0.65rem" }} />}
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>

            {/* Statement */}
            <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
              <Box sx={{ px: 2, py: 1.5, bgcolor: "primary.main", color: "white" }}>
                <Typography variant="subtitle1" fontWeight={700}>
                  Income Statement — FY {report.fiscal_year}
                  {report.fiscal_period ? ` / P${report.fiscal_period}` : ""}
                </Typography>
                {report.period_start && (
                  <Typography variant="caption" sx={{ opacity: 0.8 }}>
                    {new Date(report.period_start).toLocaleDateString()} – {new Date(report.period_end!).toLocaleDateString()}
                  </Typography>
                )}
              </Box>

              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ "& th": { fontWeight: 700, textTransform: "uppercase", fontSize: "0.7rem", color: "text.secondary" } }}>
                      <TableCell sx={{ width: 100 }}>Code</TableCell>
                      <TableCell>Account</TableCell>
                      <TableCell align="right" sx={{ pr: 3 }}>Amount (Rs.)</TableCell>
                    </TableRow>
                  </TableHead>
                </Table>

                {/* Revenue */}
                <SectionTable section={report.revenue} />

                {/* Cost of Sales */}
                <SectionTable section={report.cost_of_sales} isExpense />

                {/* Gross Profit */}
                <Box sx={{ px: 2, py: 1, bgcolor: "grey.100", display: "flex", justifyContent: "space-between", borderTop: "2px solid", borderBottom: "2px solid", borderColor: "divider" }}>
                  <Typography variant="subtitle2" fontWeight={700}>Gross Profit</Typography>
                  <Typography variant="subtitle2" fontWeight={700} color={Number(report.gross_profit) >= 0 ? "success.main" : "error.main"} sx={{ fontFamily: "monospace" }}>
                    Rs. {fmtLKR(Math.abs(Number(report.gross_profit)))}
                  </Typography>
                </Box>

                {/* Operating Expenses */}
                <SectionTable section={report.operating_expenses} isExpense />

                {/* Operating Income */}
                <Box sx={{ px: 2, py: 1, bgcolor: "grey.100", display: "flex", justifyContent: "space-between", borderTop: "2px solid", borderBottom: "2px solid", borderColor: "divider" }}>
                  <Typography variant="subtitle2" fontWeight={700}>Operating Income</Typography>
                  <Typography variant="subtitle2" fontWeight={700} color={Number(report.operating_income) >= 0 ? "success.main" : "error.main"} sx={{ fontFamily: "monospace" }}>
                    Rs. {fmtLKR(Math.abs(Number(report.operating_income)))}
                  </Typography>
                </Box>

                {/* Other Income */}
                {report.other_income.items.length > 0 && <SectionTable section={report.other_income} />}

                {/* Other Expenses */}
                {report.other_expenses.items.length > 0 && <SectionTable section={report.other_expenses} isExpense />}

                <Divider />

                {/* Net Income */}
                <Box sx={{ px: 2, py: 1.5, bgcolor: Number(report.net_income) >= 0 ? "success.50" : "error.50", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Typography variant="subtitle1" fontWeight={800}>
                    {Number(report.net_income) >= 0 ? "Net Income" : "Net Loss"}
                  </Typography>
                  <Typography variant="h6" fontWeight={800} color={netIncomeColor} sx={{ fontFamily: "monospace" }}>
                    {Number(report.net_income) < 0 && "("}Rs. {fmtLKR(Math.abs(Number(report.net_income)))}{Number(report.net_income) < 0 && ")"}
                  </Typography>
                </Box>
              </TableContainer>
            </Paper>

            {/* Generated timestamp */}
            {report.generated_at && (
              <Typography variant="caption" color="text.disabled" sx={{ mt: 1, display: "block", textAlign: "right" }}>
                Generated: {new Date(report.generated_at).toLocaleString()}
              </Typography>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}
