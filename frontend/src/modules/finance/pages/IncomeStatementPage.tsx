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
 *
 * Same layout as the other report pages: parameters in the header row,
 * Export / Print / Generate next to refresh, one form section per step.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
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
import { useNavigate } from "react-router-dom";

import {
  FormSection,
  MasterDetailLayout,
  TChip,
  TSearchableSelect,
  fmtLKR,
  modernTableStyles,
  showErrorToast,
  handleApiError,
} from "@/components/tijaero";
import { financialReportsApi } from "../api";
import type { IncomeStatementResponse, IncomeStatementSection } from "../types";
import { useCurrencyStore } from "@/state/currencyStore";
import { escapeHtml } from "@/utils/escapeHtml";

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

const monoRight = { fontFamily: "monospace", pr: 3 } as const;

// Amounts are signed per section: contra lines (Sales Returns, discounts) come back negative and
// are shown as deductions, so the listed lines add up to the section total.
const fmtSigned = (value: number | string) => {
  const n = Number(value);
  return n < 0 ? `(${fmtLKR(-n)})` : fmtLKR(n);
};

// ─── Statement table: sections with accounts, then a subtotal ──────────────

function StatementTable({
  sections,
  subtotalLabel,
  subtotal,
  currencySymbol,
}: {
  sections: { section: IncomeStatementSection; isExpense?: boolean }[];
  subtotalLabel: string;
  subtotal: number;
  currencySymbol: string;
}) {
  return (
    <Table size="small" sx={modernTableStyles.container}>
      <TableHead>
        <TableRow sx={modernTableStyles.headerRow}>
          <TableCell sx={{ width: 110 }}>Code</TableCell>
          <TableCell>Account</TableCell>
          <TableCell align="right" sx={{ pr: 3 }}>{`Amount (${currencySymbol})`}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {sections.map(({ section, isExpense }) => (
          <Fragment key={section.section_name}>
            <TableRow>
              <TableCell colSpan={3} sx={{ bgcolor: "action.hover", py: 0.75 }}>
                <Typography variant="subtitle2" fontWeight={700}>
                  {section.section_name}
                </Typography>
              </TableCell>
            </TableRow>
            {section.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} sx={{ pl: 4, color: "text.secondary" }}>
                  No items
                </TableCell>
              </TableRow>
            ) : (
              <>
                {section.items.map((item) => (
                  <TableRow key={item.account_id} sx={modernTableStyles.bodyRow}>
                    <TableCell sx={{ pl: 4, fontFamily: "monospace", color: "text.secondary", fontSize: "0.8rem" }}>
                      {item.account_code}
                    </TableCell>
                    <TableCell>{item.account_name}</TableCell>
                    <TableCell align="right" sx={monoRight}>
                      {fmtSigned(item.amount)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow sx={{ "& td": { fontWeight: 700 } }}>
                  <TableCell />
                  <TableCell>Total {section.section_name}</TableCell>
                  <TableCell align="right" sx={{ ...monoRight, color: isExpense ? "error.main" : "success.main" }}>
                    {fmtSigned(section.total)}
                  </TableCell>
                </TableRow>
              </>
            )}
          </Fragment>
        ))}
        <TableRow sx={modernTableStyles.footerRow}>
          <TableCell />
          <TableCell>{subtotalLabel}</TableCell>
          <TableCell align="right" sx={{ ...monoRight, color: subtotal >= 0 ? "success.main" : "error.main" }}>
            {currencySymbol} {fmtLKR(Math.abs(subtotal))}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

function Figure({ label, value, color, bold, loss }: { label: string; value: string; color: string; bold?: boolean; loss?: boolean }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Typography variant="subtitle1" fontWeight={bold ? 800 : 700} color={color} sx={{ fontFamily: "monospace" }}>
          {value}
        </Typography>
        {loss && <TChip label="Loss" size="small" color="error" sx={{ height: 18, fontSize: "0.65rem" }} />}
      </Box>
    </Box>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function IncomeStatementPage() {
  const navigate = useNavigate();
  const currencySymbol = useCurrencyStore((s) => s.symbol);

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
    const lines: string[][] = [["Account Code", "Account Name", `Amount (${currencySymbol})`]];
    const addSection = (s: IncomeStatementSection) => {
      lines.push([`--- ${s.section_name} ---`, "", ""]);
      s.items.forEach((i) => lines.push([i.account_code, i.account_name, Number(i.amount).toFixed(2)]));
      lines.push(["", `Total ${s.section_name}`, Number(s.total).toFixed(2)]);
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
        ? `<tr><td colspan="3" style="font-weight:700;padding-top:12px;color:#1976d2">${escapeHtml(s.section_name)}</td></tr>` +
          s.items.map((i) => `<tr><td style="padding-left:24px;font-family:monospace;color:#888">${escapeHtml(i.account_code)}</td><td>${escapeHtml(i.account_name)}</td><td style="text-align:right">${fmtSigned(i.amount)}</td></tr>`).join("") +
          `<tr style="border-top:1px solid #ccc"><td></td><td style="font-weight:600">Total ${escapeHtml(s.section_name)}</td><td style="text-align:right;font-weight:700;color:${isExp ? "#c62828" : "#2e7d32"}">${fmtSigned(s.total)}</td></tr>`
        : "";

    const subtotalRow = (label: string, val: number, bold = false) =>
      `<tr style="background:#f5f5f5"><td></td><td style="font-weight:${bold ? 800 : 600};font-size:${bold ? "14px" : "13px"}">${escapeHtml(label)}</td><td style="text-align:right;font-weight:${bold ? 800 : 700};font-size:${bold ? "14px" : "13px"};color:${val >= 0 ? "#2e7d32" : "#c62828"}">${val < 0 ? "(" : ""}${currencySymbol} ${fmtLKR(Math.abs(val))}${val < 0 ? ")" : ""}</td></tr>`;

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
  return (
    <MasterDetailLayout
      title="Income Statement"
      titleSlot={
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
          <Button
            size="small"
            startIcon={<ArrowBackIcon fontSize="small" />}
            onClick={() => navigate("/finance/general-ledger")}
            sx={{ textTransform: "none", flexShrink: 0 }}
          >
            Back to GL
          </Button>
          <Box sx={{ width: 150, flexShrink: 0 }}>
            <TSearchableSelect
              label=""
              value={fiscalYear}
              onChange={(v) => v != null && setFiscalYear(Number(v))}
              options={yearOptions.map((y) => ({ value: y, label: `FY ${y}` }))}
              placeholder="Fiscal year..."
              clearable={false}
              size="small"
            />
          </Box>
          <Box sx={{ width: 160, flexShrink: 0 }}>
            <TSearchableSelect
              label=""
              value={fiscalPeriod}
              onChange={(v) => setFiscalPeriod(Number(v ?? 0))}
              options={periodOptions}
              placeholder="Period..."
              clearable={false}
              size="small"
            />
          </Box>
          <TextField
            type="date"
            size="small"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            inputProps={{ "aria-label": "Date from" }}
            sx={{ width: 150, flexShrink: 0 }}
          />
          <Typography variant="body2" color="text.secondary">
            to
          </Typography>
          <TextField
            type="date"
            size="small"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            inputProps={{ "aria-label": "Date to" }}
            sx={{ width: 150, flexShrink: 0 }}
          />
        </Box>
      }
      headerActions={
        <>
          <Button variant="outlined" size="small" startIcon={<DownloadIcon />} onClick={handleExportCSV} disabled={!report}>
            Export CSV
          </Button>
          <Button variant="outlined" size="small" startIcon={<PrintIcon />} onClick={handlePrint} disabled={!report}>
            Print
          </Button>
          <Button variant="contained" size="small" onClick={fetchReport} disabled={loading} sx={{ mr: 1 }}>
            {loading ? <CircularProgress size={18} /> : "Generate"}
          </Button>
        </>
      }
      onRefresh={fetchReport}
      isLoading={loading}
    >
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!report && !loading && (
          <Paper variant="outlined" sx={{ p: 5, textAlign: "center" }}>
            <AssessmentIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
            <Typography variant="h6" color="text.secondary">Select parameters and click Generate</Typography>
            <Typography variant="body2" color="text.disabled">Income Statement shows revenue, expenses, and net income for the selected period.</Typography>
          </Paper>
        )}

        {loading && (
          <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
            <CircularProgress size={32} />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>Generating report...</Typography>
          </Paper>
        )}

        {report && !loading && (
          <>
            <FormSection
              title={`Income Statement — FY ${report.fiscal_year}${report.fiscal_period ? ` / P${report.fiscal_period}` : ""}${
                report.period_start
                  ? ` · ${new Date(report.period_start).toLocaleDateString()} – ${new Date(report.period_end!).toLocaleDateString()}`
                  : ""
              }`}
              columns={4}
            >
              {[
                { label: "Total Revenue", value: report.revenue.total, color: "success.main" },
                { label: "Cost of Sales", value: report.cost_of_sales.total, color: "warning.main" },
                { label: "Gross Profit", value: report.gross_profit, color: "info.main" },
                { label: "Net Income", value: report.net_income, color: netIncomeColor, bold: true },
              ].map((c) => (
                <Figure
                  key={c.label}
                  label={c.label}
                  value={`${currencySymbol} ${fmtLKR(Math.abs(Number(c.value)))}`}
                  color={c.color}
                  bold={c.bold}
                  loss={Number(c.value) < 0}
                />
              ))}
            </FormSection>

            <FormSection title="Gross Profit" columns={1}>
              <StatementTable
                sections={[{ section: report.revenue }, { section: report.cost_of_sales, isExpense: true }]}
                subtotalLabel="Gross Profit"
                subtotal={Number(report.gross_profit)}
                currencySymbol={currencySymbol}
              />
            </FormSection>

            <FormSection title="Operating Income" columns={1}>
              <StatementTable
                sections={[{ section: report.operating_expenses, isExpense: true }]}
                subtotalLabel="Operating Income"
                subtotal={Number(report.operating_income)}
                currencySymbol={currencySymbol}
              />
            </FormSection>

            {(report.other_income.items.length > 0 || report.other_expenses.items.length > 0) && (
              <FormSection title="Other Income & Expenses" columns={1}>
                <StatementTable
                  sections={[
                    ...(report.other_income.items.length > 0 ? [{ section: report.other_income }] : []),
                    ...(report.other_expenses.items.length > 0 ? [{ section: report.other_expenses, isExpense: true }] : []),
                  ]}
                  subtotalLabel={Number(report.net_income) >= 0 ? "Net Income" : "Net Loss"}
                  subtotal={Number(report.net_income)}
                  currencySymbol={currencySymbol}
                />
              </FormSection>
            )}

            <FormSection title={Number(report.net_income) >= 0 ? "Net Income" : "Net Loss"} columns={1} isLast>
              <Box
                sx={{
                  px: 1.5,
                  py: 1,
                  borderRadius: 1,
                  bgcolor: Number(report.net_income) >= 0 ? "success.50" : "error.50",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  Operating income plus other income, minus other expenses
                </Typography>
                <Typography variant="h6" fontWeight={800} color={netIncomeColor} sx={{ fontFamily: "monospace" }}>
                  {Number(report.net_income) < 0 && "("}{currencySymbol} {fmtLKR(Math.abs(Number(report.net_income)))}{Number(report.net_income) < 0 && ")"}
                </Typography>
              </Box>
            </FormSection>

            {report.generated_at && (
              <Typography variant="caption" color="text.disabled" sx={{ mt: 1, display: "block", textAlign: "right" }}>
                Generated: {new Date(report.generated_at).toLocaleString()}
              </Typography>
            )}
          </>
        )}
      </Box>
    </MasterDetailLayout>
  );
}
