/**
 * BalanceSheetPage — Statement of Financial Position
 *
 * Standard ERP Balance Sheet (IAS 1):
 *   ASSETS
 *     Current Assets
 *     Non-Current Assets
 *   ─────────────────────
 *   Total Assets
 *
 *   LIABILITIES
 *     Current Liabilities
 *     Non-Current Liabilities
 *   ─────────────────────
 *   Total Liabilities
 *
 *   EQUITY
 *   ─────────────────────
 *   Total Liabilities & Equity
 *
 *   Assets = Liabilities + Equity ✓
 *
 * Opens on TODAY next to the end of last month. The year-end view (vs the
 * previous year end) and any date stay available. Account codes and zero rows
 * are hidden unless asked for; contra lines (accumulated depreciation) show
 * as negatives "(85.33)" so each section adds up on screen.
 */

import { Fragment, useCallback, useEffect, useState } from "react";
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
import BalanceIcon from "@mui/icons-material/Balance";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
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
  TDatePicker,
} from "@/components/tijaero";
import { financialReportsApi } from "../api";
import type { BalanceSheetResponse, BalanceSheetSection, IncomeStatementLineItem } from "../types";
import { useCurrencyStore } from "@/state/currencyStore";
import { escapeHtml } from "@/utils/escapeHtml";
import { displayDate, localDateISO, todayISO } from "@/utils/formatters";

// ─── Helpers ────────────────────────────────────────────────────────────────

const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

type ViewMode = "today" | "year" | "date";

/** Body font with tabular figures, so the digits line up in columns. */
const numRight = { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", pr: 3 } as const;

/** Signed amount: a contra line (e.g. accumulated depreciation) shows as "(85.33)". */
const fmtSigned = (value: number | string | null | undefined) => {
  const n = Number(value ?? 0);
  return n < 0 ? `(${fmtLKR(-n)})` : fmtLKR(n);
};

const isZero = (n: number) => Math.abs(n) < 0.005;

/** Last day of the month before the given YYYY-MM-DD (local). */
function endOfPrevMonth(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  return localDateISO(new Date(y, m - 1, 0));
}

interface Row {
  account_id: number;
  account_code: string;
  account_name: string;
  amount: number;
  compare: number;
}

function mergeRows(current: BalanceSheetSection, compare?: BalanceSheetSection | null): Row[] {
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

/** One balance-sheet group (e.g. Assets): its sections, their accounts and a group total. */
function GroupTable({
  sections,
  totalLabel,
  total,
  compareTotal,
  color,
  currencySymbol,
  currentLabel,
  compareLabel,
  showCodes,
  showZero,
}: {
  sections: { section: BalanceSheetSection; compare?: BalanceSheetSection | null }[];
  totalLabel: string;
  total: number;
  compareTotal?: number;
  color: string;
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
        {sections.map(({ section, compare }) => {
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
                    Nothing here
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((item) => (
                  <TableRow key={item.account_id} sx={modernTableStyles.bodyRow}>
                    {showCodes && (
                      <TableCell sx={{ pl: 4, color: "text.secondary", fontSize: "0.8rem", fontVariantNumeric: "tabular-nums" }}>
                        {item.account_code}
                      </TableCell>
                    )}
                    <TableCell sx={{ pl: showCodes ? undefined : 4 }}>{item.account_name}</TableCell>
                    <TableCell align="right" sx={{ ...numRight, color: item.amount < 0 ? "text.secondary" : undefined }}>
                      {fmtSigned(item.amount)}
                    </TableCell>
                    {hasCompare && (
                      <TableCell align="right" sx={{ ...numRight, color: "text.secondary" }}>
                        {fmtSigned(item.compare)}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
              {rows.length > 0 && (
                <TableRow sx={{ "& td": { fontWeight: 700 } }}>
                  {showCodes && <TableCell />}
                  <TableCell>Total {section.section_name}</TableCell>
                  <TableCell align="right" sx={{ ...numRight, color }}>
                    {fmtSigned(section.total)}
                  </TableCell>
                  {hasCompare && (
                    <TableCell align="right" sx={{ ...numRight, color: "text.secondary" }}>
                      {fmtSigned(compare?.total ?? 0)}
                    </TableCell>
                  )}
                </TableRow>
              )}
            </Fragment>
          );
        })}
        <TableRow sx={modernTableStyles.footerRow}>
          {showCodes && <TableCell />}
          <TableCell>{totalLabel}</TableCell>
          <TableCell align="right" sx={{ ...numRight, color }}>
            {currencySymbol} {fmtSigned(total)}
          </TableCell>
          {hasCompare && (
            <TableCell align="right" sx={{ ...numRight, color: "text.secondary" }}>
              {fmtSigned(compareTotal ?? 0)}
            </TableCell>
          )}
        </TableRow>
      </TableBody>
    </Table>
  );
}

function Figure({ label, value, color, hint }: { label: string; value: string; color: string; hint?: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="subtitle1" fontWeight={700} color={color} sx={{ fontVariantNumeric: "tabular-nums" }}>
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

export default function BalanceSheetPage() {
  const navigate = useNavigate();
  const currencySymbol = useCurrencyStore((s) => s.symbol);

  const [mode, setMode] = useState<ViewMode>("today");
  const [fiscalYear, setFiscalYear] = useState(currentYear);
  const [asOfDate, setAsOfDate] = useState(todayISO());
  const [compareOn, setCompareOn] = useState(true);
  const [showCodes, setShowCodes] = useState(false);
  const [showZero, setShowZero] = useState(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<BalanceSheetResponse | null>(null);
  const [compareReport, setCompareReport] = useState<BalanceSheetResponse | null>(null);
  const [labels, setLabels] = useState<{ current: string; compare?: string }>({ current: "Today" });

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const today = todayISO();
      let mainDate: string;
      let cmpDate: string | null = null;
      let lbl: { current: string; compare?: string };
      if (mode === "year") {
        // Year end, or today for the year still running.
        const yearEnd = `${fiscalYear}-12-31`;
        mainDate = yearEnd > today ? today : yearEnd;
        cmpDate = compareOn ? `${fiscalYear - 1}-12-31` : null;
        lbl = {
          current: mainDate === today ? "Today" : displayDate(mainDate),
          compare: cmpDate ? displayDate(cmpDate) : undefined,
        };
      } else {
        mainDate = mode === "today" ? today : asOfDate || today;
        cmpDate = compareOn ? endOfPrevMonth(mainDate) : null;
        lbl = {
          current: mainDate === today ? "Today" : displayDate(mainDate),
          compare: cmpDate ? `${displayDate(cmpDate)}` : undefined,
        };
      }
      const [data, cmpData] = await Promise.all([
        financialReportsApi.getBalanceSheet({ fiscal_year: Number(mainDate.slice(0, 4)), as_of_date: mainDate }),
        cmpDate
          ? financialReportsApi.getBalanceSheet({ fiscal_year: Number(cmpDate.slice(0, 4)), as_of_date: cmpDate })
          : Promise.resolve(null),
      ]);
      setReport(data);
      setCompareReport(cmpData);
      setLabels(lbl);
    } catch (err) {
      showErrorToast(handleApiError(err, "Failed to load balance sheet"));
      setReport(null);
      setCompareReport(null);
    } finally {
      setLoading(false);
    }
  }, [mode, fiscalYear, asOfDate, compareOn]);

  // Refresh whenever the choice changes; a picked date waits for Generate.
  useEffect(() => {
    if (mode !== "date") fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, fiscalYear, compareOn]);

  const totalAssets = Number(report?.total_assets ?? 0);
  const totalLiabilities = Number(report?.total_liabilities ?? 0);
  const totalEquity = Number(report?.total_equity ?? 0);
  const isBalanced = report ? Math.abs(totalAssets - totalLiabilities - totalEquity) < 0.01 : true;
  const compareLabel = compareReport ? labels.compare : undefined;
  const c = compareReport;

  const handleExportCSV = () => {
    if (!report) return;
    const header = ["Account Code", "Account Name", `${labels.current} (${currencySymbol})`];
    if (compareLabel) header.push(compareLabel);
    const lines: string[][] = [];
    const extra = (v?: number | string | null) => (compareLabel ? [Number(v ?? 0).toFixed(2)] : []);
    const addSection = (s: BalanceSheetSection, cs?: BalanceSheetSection | null) => {
      lines.push([`--- ${s.section_name} ---`, "", "", ...(compareLabel ? [""] : [])]);
      mergeRows(s, cs)
        .filter((r) => showZero || !isZero(r.amount) || !isZero(r.compare))
        .forEach((r) => lines.push([r.account_code, r.account_name, r.amount.toFixed(2), ...extra(r.compare)]));
      lines.push(["", `Total ${s.section_name}`, Number(s.total).toFixed(2), ...extra(cs?.total)]);
    };
    lines.push(["=== ASSETS ===", "", "", ...(compareLabel ? [""] : [])]);
    addSection(report.current_assets, c?.current_assets);
    addSection(report.non_current_assets, c?.non_current_assets);
    lines.push(["", "Total Assets", totalAssets.toFixed(2), ...extra(c?.total_assets)]);
    lines.push(["=== LIABILITIES ===", "", "", ...(compareLabel ? [""] : [])]);
    addSection(report.current_liabilities, c?.current_liabilities);
    addSection(report.non_current_liabilities, c?.non_current_liabilities);
    lines.push(["", "Total Liabilities", totalLiabilities.toFixed(2), ...extra(c?.total_liabilities)]);
    lines.push(["=== EQUITY ===", "", "", ...(compareLabel ? [""] : [])]);
    addSection(report.equity, c?.equity);
    lines.push(["", "Total Equity", totalEquity.toFixed(2), ...extra(c?.total_equity)]);
    lines.push([
      "",
      "Total Liabilities & Equity",
      (totalLiabilities + totalEquity).toFixed(2),
      ...extra(c ? Number(c.total_liabilities) + Number(c.total_equity) : 0),
    ]);

    exportToCSV({
      filename: `balance_sheet_${report.as_of_date ?? report.fiscal_year}`,
      headers: header,
      rows: lines,
    });
  };

  const handlePrint = () => {
    if (!report) return;
    const win = window.open("", "_blank");
    if (!win) return;
    const cols = 2 + (showCodes ? 1 : 0) + (compareLabel ? 1 : 0);
    const cmpCell = (v?: number | string | null) =>
      compareLabel ? `<td style="text-align:right;color:#888">${fmtSigned(v ?? 0)}</td>` : "";
    const emptyCode = showCodes ? "<td></td>" : "";

    const sectionHtml = (s: BalanceSheetSection, cs?: BalanceSheetSection | null) => {
      const rows = mergeRows(s, cs).filter((r) => showZero || !isZero(r.amount) || !isZero(r.compare));
      if (!rows.length) return "";
      return (
        `<tr><td colspan="${cols}" style="font-weight:700;padding-top:10px;color:#555">${escapeHtml(s.section_name)}</td></tr>` +
        rows.map((r) => `<tr>${showCodes ? `<td style="padding-left:24px;color:#888">${escapeHtml(r.account_code)}</td>` : ""}<td${showCodes ? "" : ' style="padding-left:24px"'}>${escapeHtml(r.account_name)}</td><td style="text-align:right">${fmtSigned(r.amount)}</td>${cmpCell(r.compare)}</tr>`).join("") +
        `<tr style="border-top:1px solid #ccc">${emptyCode}<td style="font-weight:600">Total ${escapeHtml(s.section_name)}</td><td style="text-align:right;font-weight:700">${fmtSigned(s.total)}</td>${cmpCell(cs?.total)}</tr>`
      );
    };
    const subtotalRow = (label: string, val: number, cv?: number, bg = "#f5f5f5") =>
      `<tr style="background:${bg};border-top:2px solid #ccc;border-bottom:2px solid #ccc">${emptyCode}<td style="font-weight:800;font-size:14px">${escapeHtml(label)}</td><td style="text-align:right;font-weight:800;font-size:14px">${currencySymbol} ${fmtSigned(val)}</td>${cmpCell(cv)}</tr>`;
    const groupHdr = (label: string) => `<tr style="background:#1976d2;color:white"><td colspan="${cols}" style="font-weight:700;text-transform:uppercase;letter-spacing:0.5px;padding:6px 8px">${escapeHtml(label)}</td></tr>`;
    const head = `<tr>${showCodes ? '<th style="text-align:left">Code</th>' : ""}<th style="text-align:left">Account</th><th style="text-align:right">${escapeHtml(labels.current)}</th>${compareLabel ? `<th style="text-align:right;color:#888">${escapeHtml(compareLabel)}</th>` : ""}</tr>`;

    win.document.write(`<!DOCTYPE html><html><head><title>Balance Sheet</title>
<style>body{font-family:Segoe UI,sans-serif;padding:20px;max-width:800px;margin:0 auto}h1{color:#1976d2;text-align:center;border-bottom:2px solid #1976d2;padding-bottom:10px}
.meta{text-align:center;color:#666;margin-bottom:20px;font-size:13px}table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}td,th{padding:4px 8px;border-bottom:1px solid #eee}
.balanced{color:#2e7d32;text-align:center;font-weight:700;margin-top:12px}.unbalanced{color:#c62828;text-align:center;font-weight:700;margin-top:12px}
@media print{body{padding:10px}}</style></head>
<body><h1>Balance Sheet — Statement of Financial Position</h1>
<div class="meta">As of ${displayDate(report.as_of_date)} • Printed ${displayDate(new Date())}</div>
<table>
${head}
${groupHdr("ASSETS")}
${sectionHtml(report.current_assets, c?.current_assets)}
${sectionHtml(report.non_current_assets, c?.non_current_assets)}
${subtotalRow("Total Assets", totalAssets, Number(c?.total_assets ?? 0))}
${groupHdr("LIABILITIES")}
${sectionHtml(report.current_liabilities, c?.current_liabilities)}
${sectionHtml(report.non_current_liabilities, c?.non_current_liabilities)}
${subtotalRow("Total Liabilities", totalLiabilities, Number(c?.total_liabilities ?? 0))}
${groupHdr("EQUITY")}
${sectionHtml(report.equity, c?.equity)}
${subtotalRow("Total Equity", totalEquity, Number(c?.total_equity ?? 0))}
${subtotalRow("Total Liabilities & Equity", totalLiabilities + totalEquity, c ? Number(c.total_liabilities) + Number(c.total_equity) : 0, "#e3f2fd")}
</table>
<div class="${isBalanced ? "balanced" : "unbalanced"}">${isBalanced ? "✓ Balance Sheet is balanced" : "⚠ Balance Sheet is NOT balanced — check entries"}</div>
<script>window.onload=function(){window.print()}</script></body></html>`);
    win.document.close();
  };

  const tableProps = { currencySymbol, currentLabel: labels.current, compareLabel, showCodes, showZero };

  return (
    <MasterDetailLayout
      title="Balance Sheet"
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
              Balance Sheet
            </Typography>
          </Breadcrumbs>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={mode}
            onChange={(_, v: ViewMode | null) => v && setMode(v)}
            sx={{ flexShrink: 0, "& .MuiToggleButton-root": { textTransform: "none", py: 0.25 } }}
          >
            <ToggleButton value="today">Today</ToggleButton>
            <ToggleButton value="year">Year end</ToggleButton>
            <ToggleButton value="date">Pick date</ToggleButton>
          </ToggleButtonGroup>
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
          {mode === "date" && (
            <TDatePicker
              size="small"
              value={asOfDate}
              onChange={(v) => setAsOfDate(v ?? "")}
              inputProps={{ "aria-label": "As of date" }}
              sx={{ width: 150, flexShrink: 0 }}
            />
          )}
          <FormControlLabel
            control={<Switch size="small" checked={compareOn} onChange={(e) => setCompareOn(e.target.checked)} />}
            label={<Typography variant="body2">{mode === "year" ? "Compare with last year end" : "Compare with end of last month"}</Typography>}
            sx={{ mr: 0 }}
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
          {mode === "date" && (
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
            <BalanceIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
            <Typography variant="h6" color="text.secondary">Choose a date and click Generate</Typography>
            <Typography variant="body2" color="text.disabled">Shows what the business owns, what it owes, and the owner's share on a date.</Typography>
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
            {/* The whole sheet in one plain sentence */}
            <Paper variant="outlined" sx={{ p: 2, mb: 1.5, borderRadius: 2 }}>
              <Typography variant="h6" fontWeight={700} sx={{ fontVariantNumeric: "tabular-nums" }}>
                What we own {currencySymbol} {fmtSigned(totalAssets)} = what we owe {currencySymbol} {fmtSigned(totalLiabilities)} + owner's share{" "}
                {currencySymbol} {fmtSigned(totalEquity)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                As of {displayDate(report.as_of_date)}
                {c &&
                  ` · ${compareLabel}: own ${currencySymbol} ${fmtSigned(c.total_assets)}, owe ${currencySymbol} ${fmtSigned(c.total_liabilities)}, owner's share ${currencySymbol} ${fmtSigned(c.total_equity)}`}
              </Typography>
            </Paper>

            <FormSection
              title={`As of ${displayDate(report.as_of_date)}`}
              columns={3}
              titleAction={
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                  <FormControlLabel
                    control={<Switch size="small" checked={showCodes} onChange={(e) => setShowCodes(e.target.checked)} />}
                    label={<Typography variant="caption">Show account codes</Typography>}
                  />
                  <FormControlLabel
                    control={<Switch size="small" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} />}
                    label={<Typography variant="caption">Show zero lines</Typography>}
                  />
                  <TChip
                    icon={isBalanced ? <CheckCircleIcon /> : <ErrorIcon />}
                    label={isBalanced ? "Balanced" : "Not balanced — review journal entries"}
                    color={isBalanced ? "success" : "error"}
                    size="small"
                  />
                </Box>
              }
            >
              <Figure
                label="What we own (assets)"
                value={`${currencySymbol} ${fmtSigned(totalAssets)}`}
                color="primary.main"
                hint={c ? `${compareLabel}: ${fmtSigned(c.total_assets)}` : undefined}
              />
              <Figure
                label="What we owe (liabilities)"
                value={`${currencySymbol} ${fmtSigned(totalLiabilities)}`}
                color="warning.main"
                hint={c ? `${compareLabel}: ${fmtSigned(c.total_liabilities)}` : undefined}
              />
              <Figure
                label="Owner's share (equity)"
                value={`${currencySymbol} ${fmtSigned(totalEquity)}`}
                color="success.main"
                hint={c ? `${compareLabel}: ${fmtSigned(c.total_equity)}` : undefined}
              />
            </FormSection>

            <FormSection title="Assets — what we own" columns={1}>
              <GroupTable
                sections={[
                  { section: report.current_assets, compare: c?.current_assets },
                  { section: report.non_current_assets, compare: c?.non_current_assets },
                ]}
                totalLabel="Total Assets"
                total={totalAssets}
                compareTotal={Number(c?.total_assets ?? 0)}
                color="primary.main"
                {...tableProps}
              />
            </FormSection>

            <FormSection title="Liabilities — what we owe" columns={1}>
              <GroupTable
                sections={[
                  { section: report.current_liabilities, compare: c?.current_liabilities },
                  { section: report.non_current_liabilities, compare: c?.non_current_liabilities },
                ]}
                totalLabel="Total Liabilities"
                total={totalLiabilities}
                compareTotal={Number(c?.total_liabilities ?? 0)}
                color="warning.main"
                {...tableProps}
              />
            </FormSection>

            <FormSection title="Equity — owner's share" columns={1}>
              <GroupTable
                sections={[{ section: report.equity, compare: c?.equity }]}
                totalLabel="Total Equity"
                total={totalEquity}
                compareTotal={Number(c?.total_equity ?? 0)}
                color="success.main"
                {...tableProps}
              />
            </FormSection>

            <FormSection title="Total Liabilities & Equity" columns={1} isLast>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Typography variant="body2" color="text.secondary">
                  What we owe + owner's share (should equal what we own)
                </Typography>
                <Typography variant="h6" fontWeight={800} color="primary.main" sx={{ fontVariantNumeric: "tabular-nums" }}>
                  {currencySymbol} {fmtSigned(totalLiabilities + totalEquity)}
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
