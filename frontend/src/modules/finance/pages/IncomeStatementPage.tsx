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
 * Opens on THIS MONTH next to last month, so an owner sees "how did we do"
 * at a glance. The full year (vs last year) and a custom date range stay
 * available. Account codes and zero rows are hidden unless asked for.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  FormControlLabel,
  Paper,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  Breadcrumbs,
  Link,
} from "@mui/material";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import DownloadIcon from "@mui/icons-material/Download";
import { exportToCSV } from "@/utils/csvExport";
import PrintIcon from "@mui/icons-material/Print";
import AssessmentIcon from "@mui/icons-material/Assessment";
import { useNavigate } from "react-router-dom";

import {
  FormSection,
  MasterDetailLayout,
  TSearchableSelect,
  fmtLKR,
  modernTableStyles,
  showErrorToast,
  handleApiError,
  TDatePicker,
} from "@/components/tijaero";
import { financialReportsApi } from "../api";
import type { IncomeStatementLineItem, IncomeStatementResponse, IncomeStatementSection } from "../types";
import { useCurrencyStore } from "@/state/currencyStore";
import { escapeHtml } from "@/utils/escapeHtml";
import { displayDate, localDateISO, todayISO } from "@/utils/formatters";

// ─── Helpers ────────────────────────────────────────────────────────────────

const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type ViewMode = "month" | "year" | "custom";

/** Body font with tabular figures, so the digits line up in columns. */
const numRight = { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", pr: 3 } as const;

// Amounts are signed per section: contra lines (Sales Returns, discounts) come back negative and
// are shown as deductions, so the listed lines add up to the section total.
const fmtSigned = (value: number | string | null | undefined) => {
  const n = Number(value ?? 0);
  return n < 0 ? `(${fmtLKR(-n)})` : fmtLKR(n);
};

/** "2026-11" → { from: "2026-11-01", to: "2026-11-30" } (local dates). */
function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return {
    year: y,
    from: localDateISO(new Date(y, m - 1, 1)),
    to: localDateISO(new Date(y, m, 0)),
    label: `${MONTH_NAMES[m - 1]} ${y}`,
  };
}

function prevMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** One line of the statement: this period and (optionally) the comparison period. */
interface Row {
  account_id: number;
  account_code: string;
  account_name: string;
  amount: number;
  compare: number;
}

function mergeRows(current: IncomeStatementSection, compare?: IncomeStatementSection | null): Row[] {
  const rows = new Map<number, Row>();
  const add = (items: IncomeStatementLineItem[], key: "amount" | "compare") =>
    items.forEach((i) => {
      const r = rows.get(i.account_id) ?? {
        account_id: i.account_id,
        account_code: i.account_code,
        account_name: i.account_name,
        amount: 0,
        compare: 0,
      };
      r[key] = Number(i.amount) || 0;
      rows.set(i.account_id, r);
    });
  add(current.items, "amount");
  if (compare) add(compare.items, "compare");
  return [...rows.values()].sort((a, b) => a.account_code.localeCompare(b.account_code));
}

const isZero = (n: number) => Math.abs(n) < 0.005;

// ─── Statement table: sections with accounts, then a subtotal ──────────────

function StatementTable({
  sections,
  subtotalLabel,
  subtotal,
  compareSubtotal,
  currencySymbol,
  compareLabel,
  currentLabel,
  showCodes,
  showZero,
}: {
  sections: { section: IncomeStatementSection; compare?: IncomeStatementSection | null; isExpense?: boolean }[];
  subtotalLabel: string;
  subtotal: number;
  compareSubtotal?: number;
  currencySymbol: string;
  currentLabel: string;
  compareLabel?: string;
  showCodes: boolean;
  showZero: boolean;
}) {
  const hasCompare = compareLabel !== undefined;
  const cols = 2 + (showCodes ? 1 : 0) + (hasCompare ? 1 : 0);
  return (
    <Table size="small" sx={modernTableStyles.container}>
      <TableHead>
        <TableRow sx={modernTableStyles.headerRow}>
          {showCodes && <TableCell sx={{ width: 110 }}>Code</TableCell>}
          <TableCell>Account</TableCell>
          <TableCell align="right" sx={{ pr: 3 }}>{`${currentLabel} (${currencySymbol})`}</TableCell>
          {hasCompare && <TableCell align="right" sx={{ pr: 3, color: "text.secondary" }}>{compareLabel}</TableCell>}
        </TableRow>
      </TableHead>
      <TableBody>
        {sections.map(({ section, compare, isExpense }) => {
          const rows = mergeRows(section, compare).filter(
            (r) => showZero || !isZero(r.amount) || !isZero(r.compare),
          );
          return (
            <Fragment key={section.section_name}>
              <TableRow>
                <TableCell colSpan={cols} sx={{ bgcolor: "action.hover", py: 0.75 }}>
                  <Typography variant="subtitle2" fontWeight={700}>
                    {section.section_name}
                  </Typography>
                </TableCell>
              </TableRow>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={cols} sx={{ pl: 4, color: "text.secondary" }}>
                    Nothing in this period
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {rows.map((item) => (
                    <TableRow key={item.account_id} sx={modernTableStyles.bodyRow}>
                      {showCodes && (
                        <TableCell sx={{ pl: 4, color: "text.secondary", fontSize: "0.8rem", fontVariantNumeric: "tabular-nums" }}>
                          {item.account_code}
                        </TableCell>
                      )}
                      <TableCell sx={{ pl: showCodes ? undefined : 4 }}>{item.account_name}</TableCell>
                      <TableCell align="right" sx={numRight}>
                        {fmtSigned(item.amount)}
                      </TableCell>
                      {hasCompare && (
                        <TableCell align="right" sx={{ ...numRight, color: "text.secondary" }}>
                          {fmtSigned(item.compare)}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  <TableRow sx={{ "& td": { fontWeight: 700 } }}>
                    {showCodes && <TableCell />}
                    <TableCell>Total {section.section_name}</TableCell>
                    <TableCell align="right" sx={{ ...numRight, color: isExpense ? "error.main" : "success.main" }}>
                      {fmtSigned(section.total)}
                    </TableCell>
                    {hasCompare && (
                      <TableCell align="right" sx={{ ...numRight, color: "text.secondary" }}>
                        {fmtSigned(compare?.total ?? 0)}
                      </TableCell>
                    )}
                  </TableRow>
                </>
              )}
            </Fragment>
          );
        })}
        <TableRow sx={modernTableStyles.footerRow}>
          {showCodes && <TableCell />}
          <TableCell>{subtotalLabel}</TableCell>
          <TableCell align="right" sx={{ ...numRight, color: subtotal >= 0 ? "success.main" : "error.main" }}>
            {currencySymbol} {fmtSigned(subtotal)}
          </TableCell>
          {hasCompare && (
            <TableCell align="right" sx={{ ...numRight, color: "text.secondary" }}>
              {fmtSigned(compareSubtotal ?? 0)}
            </TableCell>
          )}
        </TableRow>
      </TableBody>
    </Table>
  );
}

function Figure({ label, value, color, bold, hint }: { label: string; value: string; color: string; bold?: boolean; hint?: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="subtitle1" fontWeight={bold ? 800 : 700} color={color} sx={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary" display="block">
          {hint}
        </Typography>
      )}
    </Box>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function IncomeStatementPage() {
  const navigate = useNavigate();
  const currencySymbol = useCurrencyStore((s) => s.symbol);

  const thisMonth = todayISO().slice(0, 7);
  const [mode, setMode] = useState<ViewMode>("month");
  const [month, setMonth] = useState(thisMonth);
  const [fiscalYear, setFiscalYear] = useState(currentYear);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [compareOn, setCompareOn] = useState(true);
  const [showCodes, setShowCodes] = useState(false);
  const [showZero, setShowZero] = useState(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<IncomeStatementResponse | null>(null);
  const [compareReport, setCompareReport] = useState<IncomeStatementResponse | null>(null);
  const [labels, setLabels] = useState<{ current: string; compare?: string; periodWord: string }>({
    current: "This month",
    periodWord: "this month",
  });

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      type Params = Parameters<typeof financialReportsApi.getIncomeStatement>[0];
      let main: Params;
      let cmp: Params | null = null;
      let lbl: { current: string; compare?: string; periodWord: string };
      if (mode === "month") {
        const cur = monthRange(month);
        main = { fiscal_year: cur.year, date_from: cur.from, date_to: cur.to };
        const isThis = month === thisMonth;
        const prevYm = prevMonth(month);
        const prev = monthRange(prevYm);
        if (compareOn) cmp = { fiscal_year: prev.year, date_from: prev.from, date_to: prev.to };
        lbl = {
          current: isThis ? "This month" : cur.label,
          compare: compareOn ? (isThis ? "Last month" : prev.label) : undefined,
          periodWord: isThis ? "this month" : `in ${cur.label}`,
        };
      } else if (mode === "year") {
        main = { fiscal_year: fiscalYear };
        if (compareOn) cmp = { fiscal_year: fiscalYear - 1 };
        lbl = {
          current: `FY ${fiscalYear}`,
          compare: compareOn ? `FY ${fiscalYear - 1}` : undefined,
          periodWord: fiscalYear === currentYear ? "this year" : `in FY ${fiscalYear}`,
        };
      } else {
        const from = dateFrom || `${currentYear}-01-01`;
        const to = dateTo || todayISO();
        main = { fiscal_year: Number(from.slice(0, 4)), date_from: from, date_to: to };
        lbl = { current: "Amount", periodWord: `from ${displayDate(from)} to ${displayDate(to)}` };
      }
      const [data, cmpData] = await Promise.all([
        financialReportsApi.getIncomeStatement(main),
        cmp ? financialReportsApi.getIncomeStatement(cmp) : Promise.resolve(null),
      ]);
      setReport(data);
      setCompareReport(cmpData);
      setLabels(lbl);
    } catch (err) {
      showErrorToast(handleApiError(err, "Failed to load income statement"));
      setReport(null);
      setCompareReport(null);
    } finally {
      setLoading(false);
    }
  }, [mode, month, fiscalYear, dateFrom, dateTo, compareOn, thisMonth]);

  // Month and year views refresh as soon as the choice changes; a custom range waits for Generate.
  useEffect(() => {
    if (mode !== "custom") fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, month, fiscalYear, compareOn]);

  const netIncome = Number(report?.net_income ?? 0);
  const netIncomeColor = netIncome >= 0 ? "success.main" : "error.main";
  const compareLabel = compareReport ? labels.compare : undefined;

  const periodText = useMemo(() => {
    if (!report?.period_start || !report?.period_end) return "";
    return `${displayDate(report.period_start)} – ${displayDate(report.period_end)}`;
  }, [report]);

  // ── CSV Export (keeps account codes: this is the copy for the accountant) ──
  const handleExportCSV = () => {
    if (!report) return;
    const header = ["Account Code", "Account Name", `${labels.current} (${currencySymbol})`];
    if (compareLabel) header.push(compareLabel);
    const lines: string[][] = [];
    const addSection = (s: IncomeStatementSection, c?: IncomeStatementSection | null) => {
      lines.push([`--- ${s.section_name} ---`, "", "", ...(compareLabel ? [""] : [])]);
      mergeRows(s, c)
        .filter((r) => showZero || !isZero(r.amount) || !isZero(r.compare))
        .forEach((r) => lines.push([r.account_code, r.account_name, r.amount.toFixed(2), ...(compareLabel ? [r.compare.toFixed(2)] : [])]));
      lines.push(["", `Total ${s.section_name}`, Number(s.total).toFixed(2), ...(compareLabel ? [Number(c?.total ?? 0).toFixed(2)] : [])]);
    };
    const total = (label: string, v: number, cv?: number) =>
      lines.push(["", label, v.toFixed(2), ...(compareLabel ? [Number(cv ?? 0).toFixed(2)] : [])]);
    const c = compareReport;
    addSection(report.revenue, c?.revenue);
    addSection(report.cost_of_sales, c?.cost_of_sales);
    total("Gross Profit", Number(report.gross_profit), Number(c?.gross_profit ?? 0));
    addSection(report.operating_expenses, c?.operating_expenses);
    total("Operating Income", Number(report.operating_income), Number(c?.operating_income ?? 0));
    if (report.other_income.items.length || c?.other_income.items.length) addSection(report.other_income, c?.other_income);
    if (report.other_expenses.items.length || c?.other_expenses.items.length) addSection(report.other_expenses, c?.other_expenses);
    total("Net Income", netIncome, Number(c?.net_income ?? 0));

    exportToCSV({
      filename: `income_statement_${report.period_start ?? report.fiscal_year}`,
      headers: header,
      rows: lines,
    });
  };

  // ── Print (same view as the screen) ─────────────────────────────────────
  const handlePrint = () => {
    if (!report) return;
    const win = window.open("", "_blank");
    if (!win) return;
    const c = compareReport;
    const cmpCell = (v: number | string | undefined | null) =>
      compareLabel ? `<td style="text-align:right;color:#888">${fmtSigned(v ?? 0)}</td>` : "";
    const codeCell = (code: string) => (showCodes ? `<td style="padding-left:24px;color:#888">${escapeHtml(code)}</td>` : "");
    const emptyCode = showCodes ? "<td></td>" : "";
    const cols = 2 + (showCodes ? 1 : 0) + (compareLabel ? 1 : 0);

    const sectionHtml = (s: IncomeStatementSection, cs?: IncomeStatementSection | null, isExp = false) => {
      const rows = mergeRows(s, cs).filter((r) => showZero || !isZero(r.amount) || !isZero(r.compare));
      if (!rows.length) return "";
      return (
        `<tr><td colspan="${cols}" style="font-weight:700;padding-top:12px;color:#1976d2">${escapeHtml(s.section_name)}</td></tr>` +
        rows.map((r) => `<tr>${codeCell(r.account_code)}<td${showCodes ? "" : ' style="padding-left:24px"'}>${escapeHtml(r.account_name)}</td><td style="text-align:right">${fmtSigned(r.amount)}</td>${cmpCell(r.compare)}</tr>`).join("") +
        `<tr style="border-top:1px solid #ccc">${emptyCode}<td style="font-weight:600">Total ${escapeHtml(s.section_name)}</td><td style="text-align:right;font-weight:700;color:${isExp ? "#c62828" : "#2e7d32"}">${fmtSigned(s.total)}</td>${cmpCell(cs?.total)}</tr>`
      );
    };

    const subtotalRow = (label: string, val: number, cv?: number, bold = false) =>
      `<tr style="background:#f5f5f5">${emptyCode}<td style="font-weight:${bold ? 800 : 600};font-size:${bold ? "14px" : "13px"}">${escapeHtml(label)}</td><td style="text-align:right;font-weight:${bold ? 800 : 700};font-size:${bold ? "14px" : "13px"};color:${val >= 0 ? "#2e7d32" : "#c62828"}">${currencySymbol} ${fmtSigned(val)}</td>${cmpCell(cv)}</tr>`;

    const head = `<tr style="border-bottom:2px solid #ccc">${showCodes ? "<th style=\"text-align:left\">Code</th>" : ""}<th style="text-align:left">Account</th><th style="text-align:right">${escapeHtml(labels.current)}</th>${compareLabel ? `<th style="text-align:right;color:#888">${escapeHtml(compareLabel)}</th>` : ""}</tr>`;

    win.document.write(`<!DOCTYPE html><html><head><title>Income Statement</title>
<style>body{font-family:Segoe UI,sans-serif;padding:20px;max-width:800px;margin:0 auto}h1{color:#1976d2;text-align:center;border-bottom:2px solid #1976d2;padding-bottom:10px}
.meta{text-align:center;color:#666;margin-bottom:20px;font-size:13px}table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}td,th{padding:4px 8px;border-bottom:1px solid #eee}
@media print{body{padding:10px}}</style></head>
<body><h1>Income Statement (Profit &amp; Loss)</h1>
<div class="meta">${escapeHtml(labels.current)}${periodText ? ` • ${periodText}` : ""} • Printed ${displayDate(new Date())}</div>
<table>
${head}
${sectionHtml(report.revenue, c?.revenue)}
${sectionHtml(report.cost_of_sales, c?.cost_of_sales, true)}
${subtotalRow("Gross Profit", Number(report.gross_profit), Number(c?.gross_profit ?? 0))}
${sectionHtml(report.operating_expenses, c?.operating_expenses, true)}
${subtotalRow("Operating Income", Number(report.operating_income), Number(c?.operating_income ?? 0))}
${sectionHtml(report.other_income, c?.other_income)}
${sectionHtml(report.other_expenses, c?.other_expenses, true)}
${subtotalRow(netIncome >= 0 ? "Net Profit" : "Net Loss", netIncome, Number(c?.net_income ?? 0), true)}
</table>
<script>window.onload=function(){window.print()}</script></body></html>`);
    win.document.close();
  };

  const tableProps = {
    currencySymbol,
    currentLabel: labels.current,
    compareLabel,
    showCodes,
    showZero,
  };

  const cmpNet = compareReport ? Number(compareReport.net_income) : null;

  return (
    <MasterDetailLayout
      title="Income Statement"
      titleSlot={
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
          {/* Plain MUI breadcrumbs: TBreadcrumbs nests a <div> in a <p> (validateDOMNesting warning). */}
          <Breadcrumbs separator={<NavigateNextIcon fontSize="small" />} sx={{ flexShrink: 0 }}>
            <Link
              component="button"
              type="button"
              color="inherit"
              underline="hover"
              onClick={() => navigate("/finance")}
            >
              Finance
            </Link>
            <Typography component="span" color="text.primary" fontWeight={500}>
              Income Statement
            </Typography>
          </Breadcrumbs>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={mode}
            onChange={(_, v: ViewMode | null) => v && setMode(v)}
            sx={{ flexShrink: 0, "& .MuiToggleButton-root": { textTransform: "none", py: 0.25 } }}
          >
            <ToggleButton value="month">Month</ToggleButton>
            <ToggleButton value="year">Year</ToggleButton>
            <ToggleButton value="custom">Dates</ToggleButton>
          </ToggleButtonGroup>
          {mode === "month" && (
            <TextField
              type="month"
              size="small"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              inputProps={{ "aria-label": "Month", max: thisMonth }}
              sx={{ width: 170, flexShrink: 0 }}
            />
          )}
          {mode === "year" && (
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
          )}
          {mode === "custom" && (
            <>
              <TDatePicker
                size="small"
                value={dateFrom}
                onChange={(v) => setDateFrom(v ?? "")}
                inputProps={{ "aria-label": "Date from" }}
                sx={{ width: 150, flexShrink: 0 }}
              />
              <Typography variant="body2" color="text.secondary">
                to
              </Typography>
              <TDatePicker
                size="small"
                value={dateTo}
                onChange={(v) => setDateTo(v ?? "")}
                inputProps={{ "aria-label": "Date to" }}
                sx={{ width: 150, flexShrink: 0 }}
              />
            </>
          )}
          {mode !== "custom" && (
            <FormControlLabel
              control={<Switch size="small" checked={compareOn} onChange={(e) => setCompareOn(e.target.checked)} />}
              label={<Typography variant="body2">{mode === "month" ? "Compare with last month" : "Compare with last year"}</Typography>}
              sx={{ mr: 0 }}
            />
          )}
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
          {mode === "custom" && (
            <Button variant="contained" size="small" onClick={fetchReport} disabled={loading} sx={{ mr: 1 }}>
              {loading ? <CircularProgress size={18} /> : "Generate"}
            </Button>
          )}
        </>
      }
      onRefresh={fetchReport}
      isLoading={loading}
    >
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!report && !loading && (
          <Paper variant="outlined" sx={{ p: 5, textAlign: "center" }}>
            <AssessmentIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
            <Typography variant="h6" color="text.secondary">Choose the dates and click Generate</Typography>
            <Typography variant="body2" color="text.disabled">Shows what the business earned, what it spent, and the profit for the period.</Typography>
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
            {/* One plain sentence first: did we make money? */}
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                mb: 1.5,
                borderRadius: 2,
                borderColor: netIncome >= 0 ? "success.light" : "error.light",
                bgcolor: netIncome >= 0 ? "success.50" : "error.50",
              }}
            >
              <Typography variant="h6" fontWeight={700} sx={{ fontVariantNumeric: "tabular-nums" }}>
                {netIncome >= 0 ? "Profit" : "Loss"} {labels.periodWord}:{" "}
                <Box component="span" sx={{ color: netIncomeColor }}>
                  {currencySymbol} {fmtLKR(Math.abs(netIncome))}
                </Box>
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {periodText && `${periodText} · `}
                Sales {currencySymbol} {fmtLKR(Number(report.revenue.total) + Number(report.other_income.total))}, costs{" "}
                {currencySymbol}{" "}
                {fmtLKR(Number(report.cost_of_sales.total) + Number(report.operating_expenses.total) + Number(report.other_expenses.total))}
                {cmpNet !== null && compareLabel &&
                  ` · ${compareLabel}: ${cmpNet >= 0 ? "profit" : "loss"} ${currencySymbol} ${fmtLKR(Math.abs(cmpNet))}`}
              </Typography>
            </Paper>

            <FormSection
              title={`${labels.current}${periodText ? ` · ${periodText}` : ""}`}
              columns={4}
              titleAction={
                <Box sx={{ display: "flex", gap: 1 }}>
                  <FormControlLabel
                    control={<Switch size="small" checked={showCodes} onChange={(e) => setShowCodes(e.target.checked)} />}
                    label={<Typography variant="caption">Show account codes</Typography>}
                  />
                  <FormControlLabel
                    control={<Switch size="small" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} />}
                    label={<Typography variant="caption">Show zero lines</Typography>}
                  />
                </Box>
              }
            >
              {[
                { label: "Sales (revenue)", value: report.revenue.total, cmp: compareReport?.revenue.total, color: "success.main" },
                { label: "Cost of goods sold", value: report.cost_of_sales.total, cmp: compareReport?.cost_of_sales.total, color: "warning.main" },
                { label: "Gross profit", value: report.gross_profit, cmp: compareReport?.gross_profit, color: "info.main" },
                { label: netIncome >= 0 ? "Net profit" : "Net loss", value: report.net_income, cmp: compareReport?.net_income, color: netIncomeColor, bold: true },
              ].map((c) => (
                <Figure
                  key={c.label}
                  label={c.label}
                  value={`${currencySymbol} ${fmtSigned(c.value)}`}
                  color={c.color}
                  bold={c.bold}
                  hint={compareLabel && c.cmp !== undefined ? `${compareLabel}: ${fmtSigned(c.cmp)}` : undefined}
                />
              ))}
            </FormSection>

            <FormSection title="Gross Profit" columns={1}>
              <StatementTable
                sections={[
                  { section: report.revenue, compare: compareReport?.revenue },
                  { section: report.cost_of_sales, compare: compareReport?.cost_of_sales, isExpense: true },
                ]}
                subtotalLabel="Gross Profit"
                subtotal={Number(report.gross_profit)}
                compareSubtotal={Number(compareReport?.gross_profit ?? 0)}
                {...tableProps}
              />
            </FormSection>

            <FormSection title="Operating Income" columns={1}>
              <StatementTable
                sections={[{ section: report.operating_expenses, compare: compareReport?.operating_expenses, isExpense: true }]}
                subtotalLabel="Operating Income"
                subtotal={Number(report.operating_income)}
                compareSubtotal={Number(compareReport?.operating_income ?? 0)}
                {...tableProps}
              />
            </FormSection>

            {(report.other_income.items.length > 0 ||
              report.other_expenses.items.length > 0 ||
              (compareReport && (compareReport.other_income.items.length > 0 || compareReport.other_expenses.items.length > 0))) && (
              <FormSection title="Other Income & Expenses" columns={1}>
                <StatementTable
                  sections={[
                    { section: report.other_income, compare: compareReport?.other_income },
                    { section: report.other_expenses, compare: compareReport?.other_expenses, isExpense: true },
                  ]}
                  subtotalLabel={netIncome >= 0 ? "Net Profit" : "Net Loss"}
                  subtotal={netIncome}
                  compareSubtotal={Number(compareReport?.net_income ?? 0)}
                  {...tableProps}
                />
              </FormSection>
            )}

            <FormSection title={netIncome >= 0 ? "Net Profit" : "Net Loss"} columns={1} isLast>
              <Box
                sx={{
                  px: 1.5,
                  py: 1,
                  borderRadius: 1,
                  bgcolor: netIncome >= 0 ? "success.50" : "error.50",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  Operating income plus other income, minus other expenses
                </Typography>
                <Typography variant="h6" fontWeight={800} color={netIncomeColor} sx={{ fontVariantNumeric: "tabular-nums" }}>
                  {currencySymbol} {fmtSigned(netIncome)}
                </Typography>
              </Box>
            </FormSection>

            {report.generated_at && (
              <Typography variant="caption" color="text.disabled" sx={{ mt: 1, display: "block", textAlign: "right" }}>
                Generated: {displayDate(report.generated_at)}{" "}
                {new Date(report.generated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </Typography>
            )}
          </>
        )}
      </Box>
    </MasterDetailLayout>
  );
}
