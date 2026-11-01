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
 * Same layout as the other report pages: parameters in the header row,
 * Export / Print / Generate next to refresh, one form section per group.
 */

import { Fragment, useCallback, useEffect, useState } from "react";
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
} from "@/components/tijaero";
import { financialReportsApi } from "../api";
import type { BalanceSheetResponse, BalanceSheetSection } from "../types";
import { useCurrencyStore } from "@/state/currencyStore";
import { escapeHtml } from "@/utils/escapeHtml";

// ─── Helpers ────────────────────────────────────────────────────────────────

const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

const monoRight = { fontFamily: "monospace", pr: 3 } as const;

/** One balance-sheet group (e.g. Assets): its sections, their accounts and a group total. */
function GroupTable({
  sections,
  totalLabel,
  total,
  color,
  currencySymbol,
}: {
  sections: BalanceSheetSection[];
  totalLabel: string;
  total: number;
  color: string;
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
        {sections.map((section) => (
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
              section.items.map((item) => (
                <TableRow key={item.account_id} sx={modernTableStyles.bodyRow}>
                  <TableCell sx={{ pl: 4, fontFamily: "monospace", color: "text.secondary", fontSize: "0.8rem" }}>
                    {item.account_code}
                  </TableCell>
                  <TableCell>{item.account_name}</TableCell>
                  <TableCell align="right" sx={monoRight}>
                    {fmtLKR(Math.abs(Number(item.amount)))}
                  </TableCell>
                </TableRow>
              ))
            )}
            {section.items.length > 0 && (
              <TableRow sx={{ "& td": { fontWeight: 700 } }}>
                <TableCell />
                <TableCell>Total {section.section_name}</TableCell>
                <TableCell align="right" sx={{ ...monoRight, color }}>
                  {fmtLKR(Math.abs(Number(section.total)))}
                </TableCell>
              </TableRow>
            )}
          </Fragment>
        ))}
        <TableRow sx={modernTableStyles.footerRow}>
          <TableCell />
          <TableCell>{totalLabel}</TableCell>
          <TableCell align="right" sx={{ ...monoRight, color }}>
            {currencySymbol} {fmtLKR(Math.abs(total))}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

function Figure({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="subtitle1" fontWeight={700} color={color} sx={{ fontFamily: "monospace" }}>
        {value}
      </Typography>
    </Box>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function BalanceSheetPage() {
  const navigate = useNavigate();
  const currencySymbol = useCurrencyStore((s) => s.symbol);

  const [fiscalYear, setFiscalYear] = useState(currentYear);
  const [asOfDate, setAsOfDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<BalanceSheetResponse | null>(null);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { fiscal_year: fiscalYear };
      if (asOfDate) params.as_of_date = asOfDate;
      const data = await financialReportsApi.getBalanceSheet(params as any);
      setReport(data);
    } catch (err) {
      showErrorToast(handleApiError(err, "Failed to load balance sheet"));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [fiscalYear, asOfDate]);

  // Auto-generate on first open so the page is never empty
  useEffect(() => {
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isBalanced = report ? Math.abs(Number(report.total_assets) - Number(report.total_liabilities) - Number(report.total_equity)) < 0.01 : true;

  const handleExportCSV = () => {
    if (!report) return;
    const lines: string[][] = [["Account Code", "Account Name", `Amount (${currencySymbol})`]];
    const addSection = (s: BalanceSheetSection) => {
      lines.push([`--- ${s.section_name} ---`, "", ""]);
      s.items.forEach((i) => lines.push([i.account_code, i.account_name, Math.abs(Number(i.amount)).toFixed(2)]));
      lines.push(["", `Total ${s.section_name}`, Math.abs(Number(s.total)).toFixed(2)]);
    };
    lines.push(["=== ASSETS ===", "", ""]);
    addSection(report.current_assets);
    addSection(report.non_current_assets);
    lines.push(["", "Total Assets", Number(report.total_assets).toFixed(2)]);
    lines.push(["=== LIABILITIES ===", "", ""]);
    addSection(report.current_liabilities);
    addSection(report.non_current_liabilities);
    lines.push(["", "Total Liabilities", Number(report.total_liabilities).toFixed(2)]);
    lines.push(["=== EQUITY ===", "", ""]);
    addSection(report.equity);
    lines.push(["", "Total Equity", Number(report.total_equity).toFixed(2)]);
    lines.push(["", "Total Liabilities & Equity", (Number(report.total_liabilities) + Number(report.total_equity)).toFixed(2)]);

    exportToCSV({
      filename: `balance_sheet_${fiscalYear}`,
      headers: lines[0],
      rows: lines.slice(1),
    });
  };

  const handlePrint = () => {
    if (!report) return;
    const win = window.open("", "_blank");
    if (!win) return;

    const sectionHtml = (s: BalanceSheetSection) =>
      s.items.length
        ? `<tr><td colspan="3" style="font-weight:700;padding-top:10px;color:#555">${escapeHtml(s.section_name)}</td></tr>` +
          s.items.map((i) => `<tr><td style="padding-left:24px;font-family:monospace;color:#888">${escapeHtml(i.account_code)}</td><td>${escapeHtml(i.account_name)}</td><td style="text-align:right">${fmtLKR(Math.abs(Number(i.amount)))}</td></tr>`).join("") +
          `<tr style="border-top:1px solid #ccc"><td></td><td style="font-weight:600">Total ${escapeHtml(s.section_name)}</td><td style="text-align:right;font-weight:700">${fmtLKR(Math.abs(Number(s.total)))}</td></tr>`
        : "";
    const subtotalRow = (label: string, val: number, bg = "#f5f5f5") =>
      `<tr style="background:${bg};border-top:2px solid #ccc;border-bottom:2px solid #ccc"><td></td><td style="font-weight:800;font-size:14px">${escapeHtml(label)}</td><td style="text-align:right;font-weight:800;font-size:14px">${currencySymbol} ${fmtLKR(Math.abs(val))}</td></tr>`;
    const groupHdr = (label: string) => `<tr style="background:#1976d2;color:white"><td colspan="3" style="font-weight:700;text-transform:uppercase;letter-spacing:0.5px;padding:6px 8px">${escapeHtml(label)}</td></tr>`;

    win.document.write(`<!DOCTYPE html><html><head><title>Balance Sheet</title>
<style>body{font-family:Segoe UI,sans-serif;padding:20px;max-width:800px;margin:0 auto}h1{color:#1976d2;text-align:center;border-bottom:2px solid #1976d2;padding-bottom:10px}
.meta{text-align:center;color:#666;margin-bottom:20px;font-size:13px}table{width:100%;border-collapse:collapse;font-size:12px}td{padding:4px 8px;border-bottom:1px solid #eee}
.balanced{color:#2e7d32;text-align:center;font-weight:700;margin-top:12px}.unbalanced{color:#c62828;text-align:center;font-weight:700;margin-top:12px}
@media print{body{padding:10px}}</style></head>
<body><h1>Balance Sheet — Statement of Financial Position</h1>
<div class="meta">Fiscal Year ${report.fiscal_year}${report.as_of_date ? ` • As of ${new Date(report.as_of_date).toLocaleDateString()}` : ""} • Generated ${new Date().toLocaleString()}</div>
<table>
${groupHdr("ASSETS")}
${sectionHtml(report.current_assets)}
${sectionHtml(report.non_current_assets)}
${subtotalRow("Total Assets", Number(report.total_assets))}
${groupHdr("LIABILITIES")}
${sectionHtml(report.current_liabilities)}
${sectionHtml(report.non_current_liabilities)}
${subtotalRow("Total Liabilities", Number(report.total_liabilities))}
${groupHdr("EQUITY")}
${sectionHtml(report.equity)}
${subtotalRow("Total Equity", Number(report.total_equity))}
${subtotalRow("Total Liabilities & Equity", Number(report.total_liabilities) + Number(report.total_equity), "#e3f2fd")}
</table>
<div class="${isBalanced ? "balanced" : "unbalanced"}">${isBalanced ? "✓ Balance Sheet is balanced" : "⚠ Balance Sheet is NOT balanced — check entries"}</div>
<script>window.onload=function(){window.print()}</script></body></html>`);
    win.document.close();
  };


  return (
    <MasterDetailLayout
      title="Balance Sheet"
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
          <TextField
            type="date"
            size="small"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            inputProps={{ "aria-label": "As of date" }}
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
            <BalanceIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
            <Typography variant="h6" color="text.secondary">Select parameters and click Generate</Typography>
            <Typography variant="body2" color="text.disabled">The Balance Sheet shows assets, liabilities and equity as of a specific date.</Typography>
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
              title={`Statement of Financial Position — FY ${report.fiscal_year}${
                report.as_of_date ? ` · As of ${new Date(report.as_of_date).toLocaleDateString()}` : ""
              }`}
              columns={3}
              titleAction={
                <TChip
                  icon={isBalanced ? <CheckCircleIcon /> : <ErrorIcon />}
                  label={isBalanced ? "Balance Sheet is balanced (A = L + E)" : "⚠ Balance Sheet is NOT balanced — review journal entries"}
                  color={isBalanced ? "success" : "error"}
                  size="small"
                />
              }
            >
              <Figure label="Total Assets" value={`${currencySymbol} ${fmtLKR(Math.abs(Number(report.total_assets)))}`} color="primary.main" />
              <Figure label="Total Liabilities" value={`${currencySymbol} ${fmtLKR(Math.abs(Number(report.total_liabilities)))}`} color="warning.main" />
              <Figure label="Total Equity" value={`${currencySymbol} ${fmtLKR(Math.abs(Number(report.total_equity)))}`} color="success.main" />
            </FormSection>

            <FormSection title="Assets" columns={1}>
              <GroupTable
                sections={[report.current_assets, report.non_current_assets]}
                totalLabel="Total Assets"
                total={Number(report.total_assets)}
                color="primary.main"
                currencySymbol={currencySymbol}
              />
            </FormSection>

            <FormSection title="Liabilities" columns={1}>
              <GroupTable
                sections={[report.current_liabilities, report.non_current_liabilities]}
                totalLabel="Total Liabilities"
                total={Number(report.total_liabilities)}
                color="warning.main"
                currencySymbol={currencySymbol}
              />
            </FormSection>

            <FormSection title="Equity" columns={1}>
              <GroupTable
                sections={[report.equity]}
                totalLabel="Total Equity"
                total={Number(report.total_equity)}
                color="success.main"
                currencySymbol={currencySymbol}
              />
            </FormSection>

            <FormSection title="Total Liabilities & Equity" columns={1} isLast>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Typography variant="body2" color="text.secondary">
                  Liabilities + Equity (should equal Total Assets)
                </Typography>
                <Typography variant="h6" fontWeight={800} color="primary.main" sx={{ fontFamily: "monospace" }}>
                  {currencySymbol} {fmtLKR(Math.abs(Number(report.total_liabilities) + Number(report.total_equity)))}
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
