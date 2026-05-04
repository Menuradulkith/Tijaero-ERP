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
 */

import { useCallback, useState } from "react";
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
import PrintIcon from "@mui/icons-material/Print";
import BalanceIcon from "@mui/icons-material/Balance";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import { useNavigate } from "react-router-dom";

import {
  DetailPanelHeader,
  fmtLKR,
  showErrorToast,
  handleApiError,
} from "@/components/tijaero";
import { financialReportsApi } from "../api";
import type { BalanceSheetResponse, BalanceSheetSection } from "../types";

// ─── Helpers ────────────────────────────────────────────────────────────────

const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

function SectionTable({ section, color = "text.primary" }: { section: BalanceSheetSection; color?: string }) {
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
          <TableCell align="right" sx={{ fontFamily: "monospace", pr: 3, color }}>{fmtLKR(Math.abs(Number(section.total)))}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

function GroupHeader({ label }: { label: string }) {
  return (
    <Box sx={{ px: 2, py: 0.75, bgcolor: "primary.main", color: "white" }}>
      <Typography variant="subtitle2" fontWeight={700} sx={{ textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Typography>
    </Box>
  );
}

function SubtotalBar({ label, value, color = "text.primary" }: { label: string; value: number; color?: string }) {
  return (
    <Box sx={{ px: 2, py: 1, bgcolor: "grey.100", display: "flex", justifyContent: "space-between", borderTop: "2px solid", borderBottom: "2px solid", borderColor: "divider" }}>
      <Typography variant="subtitle2" fontWeight={700}>{label}</Typography>
      <Typography variant="subtitle2" fontWeight={700} color={color} sx={{ fontFamily: "monospace" }}>Rs. {fmtLKR(Math.abs(value))}</Typography>
    </Box>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function BalanceSheetPage() {
  const navigate = useNavigate();

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

  const isBalanced = report ? Math.abs(Number(report.total_assets) - Number(report.total_liabilities) - Number(report.total_equity)) < 0.01 : true;

  const handleExportCSV = () => {
    if (!report) return;
    const lines: string[][] = [["Account Code", "Account Name", "Amount (Rs.)"]];
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

    const csv = lines.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `balance_sheet_${fiscalYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    if (!report) return;
    const win = window.open("", "_blank");
    if (!win) return;

    const sectionHtml = (s: BalanceSheetSection) =>
      s.items.length
        ? `<tr><td colspan="3" style="font-weight:700;padding-top:10px;color:#555">${s.section_name}</td></tr>` +
          s.items.map((i) => `<tr><td style="padding-left:24px;font-family:monospace;color:#888">${i.account_code}</td><td>${i.account_name}</td><td style="text-align:right">${fmtLKR(Math.abs(Number(i.amount)))}</td></tr>`).join("") +
          `<tr style="border-top:1px solid #ccc"><td></td><td style="font-weight:600">Total ${s.section_name}</td><td style="text-align:right;font-weight:700">${fmtLKR(Math.abs(Number(s.total)))}</td></tr>`
        : "";
    const subtotalRow = (label: string, val: number, bg = "#f5f5f5") =>
      `<tr style="background:${bg};border-top:2px solid #ccc;border-bottom:2px solid #ccc"><td></td><td style="font-weight:800;font-size:14px">${label}</td><td style="text-align:right;font-weight:800;font-size:14px">Rs. ${fmtLKR(Math.abs(val))}</td></tr>`;
    const groupHdr = (label: string) => `<tr style="background:#1976d2;color:white"><td colspan="3" style="font-weight:700;text-transform:uppercase;letter-spacing:0.5px;padding:6px 8px">${label}</td></tr>`;

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
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Finance", href: "/finance" },
          { label: "Accounting", href: "/finance/chart-of-accounts" },
          { label: "Balance Sheet" },
        ]}
        title="Balance Sheet"
        titleIcon={<BalanceIcon color="primary" />}
        isCreating={false}
      />

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
        <Box sx={{ display: "flex", gap: 1.5, alignItems: "center" }}>
          <TextField select size="small" label="Fiscal Year" value={fiscalYear} onChange={(e) => setFiscalYear(Number(e.target.value))} sx={{ width: 130 }}>
            {yearOptions.map((y) => <MenuItem key={y} value={y}>{y}</MenuItem>)}
          </TextField>
          <TextField size="small" label="As of Date" type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ width: 170 }} />
          <Button variant="contained" size="small" onClick={fetchReport} disabled={loading}>
            {loading ? <CircularProgress size={18} /> : "Generate"}
          </Button>
        </Box>
      </Paper>

      {/* Report */}
      <Box sx={{ flex: 1, overflow: "auto", px: 2, mt: 1.5, mb: 2 }}>
        {!report && !loading && (
          <Paper variant="outlined" sx={{ p: 5, borderRadius: 2, textAlign: "center" }}>
            <BalanceIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
            <Typography variant="h6" color="text.secondary">Select parameters and click Generate</Typography>
            <Typography variant="body2" color="text.disabled">The Balance Sheet shows assets, liabilities and equity as of a specific date.</Typography>
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
                { label: "Total Assets", value: report.total_assets, color: "primary.main" },
                { label: "Total Liabilities", value: report.total_liabilities, color: "warning.main" },
                { label: "Total Equity", value: report.total_equity, color: "success.main" },
              ].map((c) => (
                <Grid item xs={12} sm={4} key={c.label}>
                  <Card variant="outlined" sx={{ borderRadius: 2 }}>
                    <CardContent sx={{ py: 1.5, textAlign: "center" }}>
                      <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.4 }}>{c.label}</Typography>
                      <Typography variant="h6" fontWeight={700} color={c.color} sx={{ mt: 0.5, fontFamily: "monospace" }}>
                        Rs. {fmtLKR(Math.abs(Number(c.value)))}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>

            {/* Balance indicator */}
            <Box sx={{ mb: 1.5, display: "flex", justifyContent: "center" }}>
              <Chip
                icon={isBalanced ? <CheckCircleIcon /> : <ErrorIcon />}
                label={isBalanced ? "Balance Sheet is balanced (A = L + E)" : "⚠ Balance Sheet is NOT balanced — review journal entries"}
                color={isBalanced ? "success" : "error"}
                size="small"
              />
            </Box>

            {/* Statement */}
            <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
              <Box sx={{ px: 2, py: 1.5, bgcolor: "primary.main", color: "white" }}>
                <Typography variant="subtitle1" fontWeight={700}>
                  Statement of Financial Position — FY {report.fiscal_year}
                </Typography>
                {report.as_of_date && (
                  <Typography variant="caption" sx={{ opacity: 0.8 }}>As of {new Date(report.as_of_date).toLocaleDateString()}</Typography>
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

                {/* ASSETS */}
                <GroupHeader label="ASSETS" />
                <SectionTable section={report.current_assets} color="primary.main" />
                <SectionTable section={report.non_current_assets} color="primary.main" />
                <SubtotalBar label="Total Assets" value={Number(report.total_assets)} color="primary.main" />

                <Divider />

                {/* LIABILITIES */}
                <GroupHeader label="LIABILITIES" />
                <SectionTable section={report.current_liabilities} color="warning.main" />
                <SectionTable section={report.non_current_liabilities} color="warning.main" />
                <SubtotalBar label="Total Liabilities" value={Number(report.total_liabilities)} color="warning.main" />

                <Divider />

                {/* EQUITY */}
                <GroupHeader label="EQUITY" />
                <SectionTable section={report.equity} color="success.main" />
                <SubtotalBar label="Total Equity" value={Number(report.total_equity)} color="success.main" />

                <Divider />

                {/* Total L+E */}
                <Box sx={{ px: 2, py: 1.5, bgcolor: "grey.100", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "3px double", borderColor: "divider" }}>
                  <Typography variant="subtitle1" fontWeight={800}>Total Liabilities & Equity</Typography>
                  <Typography variant="h6" fontWeight={800} color="primary.main" sx={{ fontFamily: "monospace" }}>
                    Rs. {fmtLKR(Math.abs(Number(report.total_liabilities) + Number(report.total_equity)))}
                  </Typography>
                </Box>
              </TableContainer>
            </Paper>

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
