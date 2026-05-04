/**
 * SupplierPaymentReportPage
 *
 * Tab 0 — Payment History: all direct payments, credit settlements, advance payments/applications.
 *          Primary document reference = Invoice No. (for direct payments), document_no for others.
 * Tab 1 — Outstanding Invoices: all unpaid/partially-paid INVOICES across all suppliers.
 *          Shows invoice_no, payment_type (Credit/Non-Credit), advance applied, balance due, overdue.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Tabs,
  Tab,
  TextField,
  Typography,
} from "@mui/material";
import AssessmentIcon from "@mui/icons-material/Assessment";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CreditCardIcon from "@mui/icons-material/CreditCard";
import DownloadIcon from "@mui/icons-material/Download";
import MoneyOffIcon from "@mui/icons-material/MoneyOff";
import PrintIcon from "@mui/icons-material/Print";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

import {
  DetailPanelHeader,
  fmtLKR,
  handleApiError,
  modernTableStyles,
  showErrorToast,
} from "@/components/tijaero";
import {
  supplierPaymentsApi,
  PaymentReportItem,
  PaymentReportSummary,
} from "@/modules/purchasing/api";
import {
  purchaseInvoicesApi,
  PurchaseInvoiceListItem,
} from "@/modules/purchasing/purchaseInvoiceApi";
import { suppliersApi } from "@/modules/purchasing/api";
import { useReferenceData } from "@/hooks";
import type { Supplier } from "@/modules/purchasing/types";

type SortDir = "asc" | "desc";
type HistSortField = "date" | "supplier_name" | "type" | "amount" | "invoice_no";
type OutSortField = "supplier_invoice_date" | "supplier_name" | "balance_due" | "days_overdue" | "branch_code" | "payment_type";

export default function SupplierPaymentReportPage() {
  const navigate = useNavigate();

  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().split("T")[0];
  }, []);
  const defaultTo = useMemo(() => new Date().toISOString().split("T")[0], []);

  const [activeTab, setActiveTab] = useState(0);

  // Shared filters
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [selectedBranch, setSelectedBranch] = useState("all");

  // History-only filters
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);
  const [selectedStatus, setSelectedStatus] = useState("all");

  // Outstanding-only filters
  const [paymentTypeFilter, setPaymentTypeFilter] = useState("all");
  const [outOverdueOnly, setOutOverdueOnly] = useState(false);

  // History data
  const [histItems, setHistItems] = useState<PaymentReportItem[]>([]);
  const [histSummary, setHistSummary] = useState<PaymentReportSummary | null>(null);
  const [histLoading, setHistLoading] = useState(false);
  const [histSortField, setHistSortField] = useState<HistSortField>("date");
  const [histSortDir, setHistSortDir] = useState<SortDir>("desc");

  // Outstanding data
  const [outItems, setOutItems] = useState<PurchaseInvoiceListItem[]>([]);
  const [outLoading, setOutLoading] = useState(false);
  const [outSortField, setOutSortField] = useState<OutSortField>("days_overdue");
  const [outSortDir, setOutSortDir] = useState<SortDir>("desc");

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const { filteredBranches: branches = [] } = useReferenceData(["branches"]);

  useEffect(() => {
    suppliersApi.getAll({ active: true }).then(setSuppliers).catch(() => {});
  }, []);

  // ── Fetch Payment History ────────────────────────────────────────────────
  const fetchHistory = useCallback(async () => {
    setHistLoading(true);
    try {
      const params: Record<string, string | number> = {};
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      if (selectedSupplier) params.supplier_id = selectedSupplier.id;
      if (selectedBranch !== "all") params.branch_code = selectedBranch;
      const data = await supplierPaymentsApi.getPaymentReport(params as any);
      setHistItems(data.items);
      setHistSummary(data.summary);
    } catch (err) {
      showErrorToast(handleApiError(err, "Failed to load payment history"));
      setHistItems([]);
      setHistSummary(null);
    } finally {
      setHistLoading(false);
    }
  }, [dateFrom, dateTo, selectedSupplier, selectedBranch]);

  useEffect(() => {
    if (activeTab === 0) fetchHistory();
  }, [activeTab, fetchHistory]);

  // ── Fetch Outstanding Invoices ───────────────────────────────────────────
  const fetchOutstanding = useCallback(async () => {
    setOutLoading(true);
    try {
      const params: Record<string, string | number> = {};
      if (selectedSupplier) params.supplier_id = selectedSupplier.id;
      if (selectedBranch !== "all") params.branch_code = selectedBranch;
      if (paymentTypeFilter !== "all") params.payment_type = paymentTypeFilter;
      const data = await purchaseInvoicesApi.getOutstandingInvoices(params as any);
      setOutItems(data);
    } catch (err) {
      showErrorToast(handleApiError(err, "Failed to load outstanding invoices"));
      setOutItems([]);
    } finally {
      setOutLoading(false);
    }
  }, [selectedSupplier, selectedBranch, paymentTypeFilter]);

  useEffect(() => {
    if (activeTab === 1) fetchOutstanding();
  }, [activeTab, fetchOutstanding]);

  // ── History filtering + sorting ──────────────────────────────────────────
  const filteredHist = useMemo(() => {
    let rows = selectedStatus === "all" ? histItems : histItems.filter((i) => i.status === selectedStatus);
    return [...rows].sort((a, b) => {
      let cmp = 0;
      if (histSortField === "date") cmp = a.date.localeCompare(b.date);
      else if (histSortField === "supplier_name") cmp = a.supplier_name.localeCompare(b.supplier_name);
      else if (histSortField === "type") cmp = a.type.localeCompare(b.type);
      else if (histSortField === "amount") cmp = a.amount - b.amount;
      else if (histSortField === "invoice_no") cmp = (a.invoice_no || "").localeCompare(b.invoice_no || "");
      return histSortDir === "asc" ? cmp : -cmp;
    });
  }, [histItems, selectedStatus, histSortField, histSortDir]);

  const handleHistSort = (field: HistSortField) => {
    if (histSortField === field) setHistSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setHistSortField(field); setHistSortDir(field === "amount" ? "desc" : "asc"); }
  };

  // ── Outstanding filtering + sorting ─────────────────────────────────────
  const filteredOut = useMemo(() => {
    let rows = outOverdueOnly ? outItems.filter((i) => i.is_overdue) : [...outItems];
    return rows.sort((a, b) => {
      let cmp = 0;
      if (outSortField === "supplier_invoice_date") cmp = (a.supplier_invoice_date || "").localeCompare(b.supplier_invoice_date || "");
      else if (outSortField === "supplier_name") cmp = (a.supplier_name || "").localeCompare(b.supplier_name || "");
      else if (outSortField === "balance_due") cmp = a.balance_due - b.balance_due;
      else if (outSortField === "days_overdue") cmp = a.days_overdue - b.days_overdue;
      else if (outSortField === "branch_code") cmp = (a.branch_code || "").localeCompare(b.branch_code || "");
      else if (outSortField === "payment_type") cmp = (a.payment_type || "").localeCompare(b.payment_type || "");
      return outSortDir === "asc" ? cmp : -cmp;
    });
  }, [outItems, outOverdueOnly, outSortField, outSortDir]);

  const handleOutSort = (field: OutSortField) => {
    if (outSortField === field) setOutSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setOutSortField(field); setOutSortDir(field === "balance_due" || field === "days_overdue" ? "desc" : "asc"); }
  };

  // ── Outstanding summary computed values ──────────────────────────────────
  const outSummary = useMemo(() => {
    const total_outstanding = filteredOut.reduce((s, i) => s + Number(i.balance_due), 0);
    const overdue = filteredOut.filter((i) => i.is_overdue);
    const total_overdue = overdue.reduce((s, i) => s + Number(i.balance_due), 0);
    const credit_outstanding = filteredOut.filter((i) => i.payment_type === "credit").reduce((s, i) => s + Number(i.balance_due), 0);
    const non_credit_outstanding = filteredOut.filter((i) => i.payment_type !== "credit").reduce((s, i) => s + Number(i.balance_due), 0);
    return { total_outstanding, total_overdue, overdue_count: overdue.length, credit_outstanding, non_credit_outstanding };
  }, [filteredOut]);

  // ── Reset ────────────────────────────────────────────────────────────────
  const handleReset = () => {
    setDateFrom(defaultFrom);
    setDateTo(defaultTo);
    setSelectedSupplier(null);
    setSelectedBranch("all");
    setSelectedStatus("all");
    setPaymentTypeFilter("all");
    setOutOverdueOnly(false);
  };

  // ── CSV Export ───────────────────────────────────────────────────────────
  const handleExportCSV = () => {
    if (activeTab === 1) {
      const headers = ["Invoice No.", "Supplier", "Supplier Invoice No.", "Invoice Date", "Payment Type", "Total (Rs.)", "Paid (Rs.)", "Balance Due (Rs.)", "Due Date", "Days Overdue", "Overdue", "Status", "Branch"];
      const rows = filteredOut.map((i) => [
        i.invoice_no, i.supplier_name || "", i.supplier_invoice_no || "",
        i.supplier_invoice_date || "", i.payment_type === "credit" ? "Credit" : "Non-Credit",
        i.total_amount.toFixed(2), i.paid_amount.toFixed(2), i.balance_due.toFixed(2),
        i.due_date || "", i.days_overdue.toString(), i.is_overdue ? "Yes" : "No",
        i.payment_status, i.branch_code,
      ]);
      const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "outstanding_invoices.csv"; a.click();
      URL.revokeObjectURL(url);
      return;
    }
    const headers = ["Date", "Supplier", "Type", "Payment No.", "Invoice No.", "Method", "Amount (Rs.)", "Status", "Branch", "Remarks"];
    const rows = filteredHist.map((i) => [
      i.date, i.supplier_name, i.type, i.document_no, i.invoice_no || "",
      i.payment_method || "", i.amount.toFixed(2), i.status, i.branch_code || "", i.remarks || "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `payment_history_${dateFrom}_to_${dateTo}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Print ────────────────────────────────────────────────────────────────
  const handlePrint = () => {
    const win = window.open("", "_blank");
    if (!win) { showErrorToast("Allow popups to print"); return; }
    const supplierLabel = selectedSupplier ? selectedSupplier.full_name : "All Suppliers";

    if (activeTab === 1) {
      const rowsHtml = filteredOut.map((i) => `
        <tr>
          <td style="font-family:monospace">${i.invoice_no}</td>
          <td>${i.supplier_name || ""}</td>
          <td>${i.supplier_invoice_no || "-"}</td>
          <td>${i.supplier_invoice_date ? new Date(i.supplier_invoice_date).toLocaleDateString() : "-"}</td>
          <td><span style="padding:2px 8px;border-radius:10px;font-size:10px;background:${i.payment_type === "credit" ? "#e3f2fd" : "#e8f5e9"};color:${i.payment_type === "credit" ? "#1565c0" : "#2e7d32"}">${i.payment_type === "credit" ? "Credit" : "Non-Credit"}</span></td>
          <td style="text-align:right">${fmtLKR(i.total_amount)}</td>
          <td style="text-align:right">${fmtLKR(i.paid_amount)}</td>
          <td style="text-align:right;font-weight:bold;color:${i.is_overdue ? "#c62828" : "#1565c0"}">${fmtLKR(i.balance_due)}</td>
          <td>${i.due_date ? new Date(i.due_date).toLocaleDateString() : "-"}</td>
          <td style="text-align:center;color:${i.is_overdue ? "#c62828" : "#2e7d32"}">${i.is_overdue ? `${i.days_overdue}d overdue` : "Current"}</td>
          <td>${i.branch_code}</td>
        </tr>`).join("");
      win.document.write(`<!DOCTYPE html><html><head><title>Outstanding Invoices</title>
<style>body{font-family:Segoe UI,sans-serif;padding:20px;max-width:1100px;margin:0 auto}h1{color:#1976d2;border-bottom:2px solid #1976d2;padding-bottom:10px}
.meta{color:#666;font-size:13px;margin-bottom:20px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
.sc{padding:12px;border:1px solid #ddd;border-radius:6px;text-align:center}.sc .lbl{font-size:10px;text-transform:uppercase;color:#888}
.sc .val{font-size:18px;font-weight:bold;margin-top:4px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #ddd;padding:6px 8px}
th{background:#1976d2;color:#fff;font-size:10px;text-transform:uppercase}tr:nth-child(even){background:#f9f9f9}@media print{body{padding:10px}}</style></head>
<body><h1>Outstanding Supplier Invoices</h1>
<div class="meta">${supplierLabel} | Generated ${new Date().toLocaleString()}</div>
<div class="summary">
  <div class="sc"><div class="lbl">Total Outstanding</div><div class="val" style="color:#1976d2">Rs. ${fmtLKR(outSummary.total_outstanding)}</div></div>
  <div class="sc"><div class="lbl">Overdue</div><div class="val" style="color:#c62828">Rs. ${fmtLKR(outSummary.total_overdue)}</div></div>
  <div class="sc"><div class="lbl">Credit Outstanding</div><div class="val" style="color:#1565c0">Rs. ${fmtLKR(outSummary.credit_outstanding)}</div></div>
  <div class="sc"><div class="lbl">Non-Credit Outstanding</div><div class="val" style="color:#2e7d32">Rs. ${fmtLKR(outSummary.non_credit_outstanding)}</div></div>
</div>
<table><thead><tr><th>Invoice No.</th><th>Supplier</th><th>Supplier Invoice</th><th>Date</th><th>Type</th>
<th>Total</th><th>Paid</th><th>Balance Due</th><th>Due Date</th><th>Overdue</th><th>Branch</th></tr></thead>
<tbody>${rowsHtml}</tbody></table>
<script>window.onload=function(){window.print()}</script></body></html>`);
      win.document.close();
      return;
    }

    const rowsHtml = filteredHist.map((i) => `
      <tr>
        <td>${new Date(i.date).toLocaleDateString()}</td>
        <td>${i.supplier_name}</td>
        <td>${i.type}</td>
        <td style="font-family:monospace">${i.document_no}</td>
        <td style="font-family:monospace">${i.invoice_no || "-"}</td>
        <td>${i.payment_method || "-"}</td>
        <td style="text-align:right;font-weight:bold">Rs. ${fmtLKR(i.amount)}</td>
        <td>${i.status}</td>
        <td>${i.branch_code || "-"}</td>
        <td>${i.remarks || "-"}</td>
      </tr>`).join("");
    win.document.write(`<!DOCTYPE html><html><head><title>Payment History Report</title>
<style>body{font-family:Segoe UI,sans-serif;padding:20px;max-width:1100px;margin:0 auto}h1{color:#1976d2;border-bottom:2px solid #1976d2;padding-bottom:10px}
.meta{color:#666;font-size:13px;margin-bottom:20px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #ddd;padding:6px 8px}
th{background:#1976d2;color:#fff;font-size:10px;text-transform:uppercase}tr:nth-child(even){background:#f9f9f9}
.total-row{background:#f5f5f5;font-weight:bold}@media print{body{padding:10px}}</style></head>
<body><h1>Supplier Payment History</h1>
<div class="meta">${supplierLabel} | ${new Date(dateFrom).toLocaleDateString()} to ${new Date(dateTo).toLocaleDateString()} | Generated ${new Date().toLocaleString()}</div>
<table><thead><tr><th>Date</th><th>Supplier</th><th>Type</th><th>Payment No.</th><th>Invoice No.</th><th>Method</th><th>Amount (Rs.)</th><th>Status</th><th>Branch</th><th>Remarks</th></tr></thead>
<tbody>${rowsHtml}
<tr class="total-row"><td colspan="6" style="text-align:right">TOTAL:</td><td style="text-align:right">Rs. ${fmtLKR(histSummary?.total_amount || 0)}</td><td colspan="3"></td></tr>
</tbody></table>
<script>window.onload=function(){window.print()}</script></body></html>`);
    win.document.close();
  };

  const typeChipColor = (type: string) => {
    if (type === "Direct Payment") return "success";
    if (type === "Credit Settlement") return "info";
    if (type === "Advance Payment") return "warning";
    return "secondary";
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Finance", href: "/finance" },
          { label: "Supplier Payments", href: "/finance/supplier-payments" },
          { label: "Payment Report" },
        ]}
        title="Payment Report"
        titleIcon={<AssessmentIcon color="primary" />}
        isCreating={false}
      />

      {/* Top bar */}
      <Box sx={{ px: 2, pt: 1, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Button size="small" variant="text" startIcon={<ArrowBackIcon />} onClick={() => navigate("/finance/supplier-payments")}>Back</Button>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button variant="outlined" size="small" startIcon={<DownloadIcon />} onClick={handleExportCSV}
            disabled={activeTab === 0 ? filteredHist.length === 0 : filteredOut.length === 0}>Export CSV</Button>
          <Button variant="contained" size="small" startIcon={<PrintIcon />} onClick={handlePrint}
            disabled={activeTab === 0 ? filteredHist.length === 0 : filteredOut.length === 0}>Print</Button>
        </Box>
      </Box>

      {/* Tabs */}
      <Box sx={{ px: 2, mt: 1 }}>
        <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)}
          sx={{ minHeight: 36, "& .MuiTab-root": { minHeight: 36, py: 0.5, textTransform: "none" } }}>
          <Tab label="Payment History" />
          <Tab label={
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              Outstanding Invoices
              {outSummary.overdue_count > 0 && (
                <Chip size="small" label={outSummary.overdue_count} color="error" sx={{ height: 18, fontSize: "0.7rem" }} />
              )}
            </Box>
          } />
        </Tabs>
      </Box>

      {/* Filters */}
      <Paper variant="outlined" sx={{ mx: 2, mt: 1.5, p: 1.5, borderRadius: 2 }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
          <Typography variant="subtitle2" fontWeight={700}>Filters</Typography>
          <Button size="small" variant="text" onClick={handleReset}>Reset</Button>
        </Box>
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
          {activeTab === 0 && (
            <>
              <TextField size="small" label="Date From" type="date" value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ width: 155 }} />
              <TextField size="small" label="Date To" type="date" value={dateTo}
                onChange={(e) => setDateTo(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ width: 155 }} />
            </>
          )}
          <Autocomplete options={suppliers} getOptionLabel={(o) => o.full_name} value={selectedSupplier}
            onChange={(_, v) => setSelectedSupplier(v)}
            renderInput={(params) => <TextField {...params} label="Supplier" size="small" />} sx={{ width: 220 }} />
          <TextField select size="small" label="Branch" value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)} sx={{ width: 170 }}>
            <MenuItem value="all">All Branches</MenuItem>
            {branches.map((b) => <MenuItem key={b.branch_code} value={b.branch_code}>{b.branch_name}</MenuItem>)}
          </TextField>
          {activeTab === 0 && (
            <TextField select size="small" label="Status" value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)} sx={{ width: 150 }}>
              <MenuItem value="all">All Status</MenuItem>
              <MenuItem value="verified">Verified</MenuItem>
              <MenuItem value="pending">Pending</MenuItem>
              <MenuItem value="cancelled">Cancelled</MenuItem>
            </TextField>
          )}
          {activeTab === 1 && (
            <>
              <TextField select size="small" label="Payment Type" value={paymentTypeFilter}
                onChange={(e) => setPaymentTypeFilter(e.target.value)} sx={{ width: 160 }}>
                <MenuItem value="all">All Types</MenuItem>
                <MenuItem value="credit">Credit Only</MenuItem>
                <MenuItem value="non_credit">Non-Credit Only</MenuItem>
              </TextField>
              <Button size="small" variant={outOverdueOnly ? "contained" : "outlined"} color="error"
                startIcon={<WarningAmberIcon />} onClick={() => setOutOverdueOnly((p) => !p)}
                sx={{ textTransform: "none" }}>
                {outOverdueOnly ? "Overdue Only ✓" : "Overdue Only"}
              </Button>
            </>
          )}
        </Box>
      </Paper>

      {/* ═══ TAB 0: PAYMENT HISTORY ════════════════════════════════════════ */}
      {activeTab === 0 && (
        <>
          {histSummary && (
            <Box sx={{ px: 2, mt: 1.5, display: "flex", gap: 1.5, overflowX: "auto", flexShrink: 0, pb: 0.5 }}>
              {[
                { label: "Total Payments", value: histSummary.total_amount, count: `${histSummary.total_count} transactions`, color: "primary.main" },
                { label: "Direct Payments", value: histSummary.direct_payments, count: `${histSummary.direct_payments_count} payments`, color: "success.main" },
                { label: "Credit Settlements", value: histSummary.credit_settlements, count: `${histSummary.credit_settlements_count} settlements`, color: "info.main" },
                { label: "Advance Payments", value: histSummary.advance_payments, count: `${histSummary.advance_payments_count} payments`, color: "warning.main" },
                { label: "Pending Approval", value: histSummary.pending_amount, count: `${histSummary.pending_count} awaiting`, color: "error.main" },
              ].map((c) => (
                <Card key={c.label} variant="outlined" sx={{ borderRadius: 2, minWidth: 160, flex: "1 1 160px" }}>
                  <CardContent sx={{ py: 1.5, px: 2 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.4 }}>{c.label}</Typography>
                    <Typography variant="h6" fontWeight={700} color={c.color} sx={{ mt: 0.5, whiteSpace: "nowrap" }}>Rs. {fmtLKR(c.value)}</Typography>
                    <Typography variant="caption" color="text.secondary">{c.count}</Typography>
                  </CardContent>
                </Card>
              ))}
            </Box>
          )}

          <Box sx={{ flex: 1, overflow: "auto", px: 2, mt: 1.5, mb: 2 }}>
            {histLoading ? (
              <Paper variant="outlined" sx={{ p: 4, borderRadius: 2, textAlign: "center" }}>
                <CircularProgress size={28} />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>Loading...</Typography>
              </Paper>
            ) : filteredHist.length === 0 ? (
              <Paper variant="outlined" sx={{ p: 5, borderRadius: 2, textAlign: "center" }}>
                <Typography variant="body1" fontWeight={600}>No payment records found</Typography>
                <Typography variant="body2" color="text.secondary">Adjust the filters or date range.</Typography>
              </Paper>
            ) : (
              <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
                <TableContainer sx={{ maxHeight: "calc(100vh - 420px)" }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow sx={modernTableStyles.headerRow}>
                        <TableCell><TableSortLabel active={histSortField === "date"} direction={histSortField === "date" ? histSortDir : "asc"} onClick={() => handleHistSort("date")}>Date</TableSortLabel></TableCell>
                        <TableCell><TableSortLabel active={histSortField === "supplier_name"} direction={histSortField === "supplier_name" ? histSortDir : "asc"} onClick={() => handleHistSort("supplier_name")}>Supplier</TableSortLabel></TableCell>
                        <TableCell><TableSortLabel active={histSortField === "type"} direction={histSortField === "type" ? histSortDir : "asc"} onClick={() => handleHistSort("type")}>Type</TableSortLabel></TableCell>
                        <TableCell>Payment No.</TableCell>
                        <TableCell><TableSortLabel active={histSortField === "invoice_no"} direction={histSortField === "invoice_no" ? histSortDir : "asc"} onClick={() => handleHistSort("invoice_no")}>Invoice No.</TableSortLabel></TableCell>
                        <TableCell>Method</TableCell>
                        <TableCell align="right"><TableSortLabel active={histSortField === "amount"} direction={histSortField === "amount" ? histSortDir : "asc"} onClick={() => handleHistSort("amount")}>Amount (Rs.)</TableSortLabel></TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Branch</TableCell>
                        <TableCell>Remarks</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredHist.map((item, idx) => (
                        <TableRow key={`${item.type}-${item.id}-${idx}`} hover sx={modernTableStyles.bodyRow}>
                          <TableCell sx={{ whiteSpace: "nowrap" }}>{new Date(item.date).toLocaleDateString()}</TableCell>
                          <TableCell>{item.supplier_name}</TableCell>
                          <TableCell><Chip label={item.type} size="small" color={typeChipColor(item.type) as any} variant="outlined" /></TableCell>
                          <TableCell sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{item.document_no}</TableCell>
                          <TableCell sx={{ fontFamily: "monospace", fontSize: "0.8rem", color: "primary.main" }}>{item.invoice_no || "-"}</TableCell>
                          <TableCell>{item.payment_method || "-"}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>{fmtLKR(item.amount)}</TableCell>
                          <TableCell>
                            <Chip label={item.status} size="small"
                              color={item.status === "verified" ? "success" : item.status === "pending" ? "warning" : "default"}
                              variant="outlined" />
                          </TableCell>
                          <TableCell>{item.branch_code || "-"}</TableCell>
                          <TableCell sx={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.remarks || ""}>{item.remarks || "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <Box sx={{ px: 2, py: 1.25, borderTop: "1px solid", borderColor: "divider", display: "flex", justifyContent: "space-between", bgcolor: "grey.50" }}>
                  <Typography variant="body2" color="text.secondary">{filteredHist.length} records</Typography>
                  <Typography variant="subtitle1" fontWeight={700} color="primary.main">Total: Rs. {fmtLKR(histSummary?.total_amount || 0)}</Typography>
                </Box>
              </Paper>
            )}
          </Box>
        </>
      )}

      {/* ═══ TAB 1: OUTSTANDING INVOICES ═══════════════════════════════════ */}
      {activeTab === 1 && (
        <>
          <Box sx={{ px: 2, mt: 1.5, display: "flex", gap: 1.5, overflowX: "auto", flexShrink: 0, pb: 0.5 }}>
            {[
              { label: "Total Outstanding", value: outSummary.total_outstanding, count: `${filteredOut.length} invoices`, color: "primary.main", border: false },
              { label: "Credit Outstanding", value: outSummary.credit_outstanding, count: `${filteredOut.filter((i) => i.payment_type === "credit").length} invoices`, color: "info.main", border: false },
              { label: "Non-Credit Outstanding", value: outSummary.non_credit_outstanding, count: `${filteredOut.filter((i) => i.payment_type !== "credit").length} invoices`, color: "success.main", border: false },
              { label: "Overdue", value: outSummary.total_overdue, count: `${outSummary.overdue_count} invoices`, color: "error.main", border: outSummary.overdue_count > 0 },
            ].map((c) => (
              <Card key={c.label} variant="outlined" sx={{ borderRadius: 2, minWidth: 175, flex: "1 1 175px", ...(c.border && { borderColor: "error.main" }) }}>
                <CardContent sx={{ py: 1.5, px: 2 }}>
                  <Typography variant="caption" color={c.color} sx={{ textTransform: "uppercase", letterSpacing: 0.4 }}>{c.label}</Typography>
                  <Typography variant="h6" fontWeight={700} color={c.color} sx={{ mt: 0.5, whiteSpace: "nowrap" }}>Rs. {fmtLKR(c.value)}</Typography>
                  <Typography variant="caption" color="text.secondary">{c.count}</Typography>
                </CardContent>
              </Card>
            ))}
          </Box>

          <Box sx={{ flex: 1, overflow: "auto", px: 2, mt: 1.5, mb: 2 }}>
            {outLoading ? (
              <Paper variant="outlined" sx={{ p: 4, borderRadius: 2, textAlign: "center" }}>
                <CircularProgress size={28} />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>Loading outstanding invoices...</Typography>
              </Paper>
            ) : filteredOut.length === 0 ? (
              <Paper variant="outlined" sx={{ p: 5, borderRadius: 2, textAlign: "center" }}>
                <Typography variant="body1" fontWeight={600}>No outstanding invoices</Typography>
                <Typography variant="body2" color="text.secondary">All invoices are fully settled.</Typography>
              </Paper>
            ) : (
              <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
                <TableContainer sx={{ maxHeight: "calc(100vh - 420px)" }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow sx={modernTableStyles.headerRow}>
                        <TableCell>Invoice No.</TableCell>
                        <TableCell><TableSortLabel active={outSortField === "supplier_name"} direction={outSortField === "supplier_name" ? outSortDir : "asc"} onClick={() => handleOutSort("supplier_name")}>Supplier</TableSortLabel></TableCell>
                        <TableCell>Supplier Invoice</TableCell>
                        <TableCell><TableSortLabel active={outSortField === "supplier_invoice_date"} direction={outSortField === "supplier_invoice_date" ? outSortDir : "asc"} onClick={() => handleOutSort("supplier_invoice_date")}>Date</TableSortLabel></TableCell>
                        <TableCell><TableSortLabel active={outSortField === "payment_type"} direction={outSortField === "payment_type" ? outSortDir : "asc"} onClick={() => handleOutSort("payment_type")}>Type</TableSortLabel></TableCell>
                        <TableCell align="right">Total (Rs.)</TableCell>
                        <TableCell align="right">Paid (Rs.)</TableCell>
                        <TableCell align="right"><TableSortLabel active={outSortField === "balance_due"} direction={outSortField === "balance_due" ? outSortDir : "asc"} onClick={() => handleOutSort("balance_due")}>Balance Due</TableSortLabel></TableCell>
                        <TableCell>Due Date</TableCell>
                        <TableCell align="center"><TableSortLabel active={outSortField === "days_overdue"} direction={outSortField === "days_overdue" ? outSortDir : "asc"} onClick={() => handleOutSort("days_overdue")}>Overdue</TableSortLabel></TableCell>
                        <TableCell><TableSortLabel active={outSortField === "branch_code"} direction={outSortField === "branch_code" ? outSortDir : "asc"} onClick={() => handleOutSort("branch_code")}>Branch</TableSortLabel></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredOut.map((item) => (
                        <TableRow key={`inv-${item.id}`} hover
                          sx={{ ...modernTableStyles.bodyRow, ...(item.is_overdue && { bgcolor: "error.50" }) }}>
                          <TableCell sx={{ fontFamily: "monospace", fontSize: "0.8rem", color: "primary.main", fontWeight: 600 }}>{item.invoice_no}</TableCell>
                          <TableCell>{item.supplier_name || "-"}</TableCell>
                          <TableCell sx={{ fontSize: "0.8rem", color: "text.secondary" }}>{item.supplier_invoice_no || "-"}</TableCell>
                          <TableCell sx={{ whiteSpace: "nowrap" }}>
                            {item.supplier_invoice_date ? new Date(item.supplier_invoice_date).toLocaleDateString() : "-"}
                          </TableCell>
                          <TableCell>
                            {item.payment_type === "credit"
                              ? <Chip size="small" label="Credit" color="info" icon={<CreditCardIcon />} variant="outlined" />
                              : <Chip size="small" label="Non-Credit" color="success" icon={<MoneyOffIcon />} variant="outlined" />}
                          </TableCell>
                          <TableCell align="right">{fmtLKR(item.total_amount)}</TableCell>
                          <TableCell align="right">{fmtLKR(item.paid_amount)}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700, color: item.is_overdue ? "error.main" : "primary.main" }}>{fmtLKR(item.balance_due)}</TableCell>
                          <TableCell sx={{ whiteSpace: "nowrap", color: item.is_overdue ? "error.main" : "text.primary" }}>
                            {item.due_date ? new Date(item.due_date).toLocaleDateString() : "-"}
                          </TableCell>
                          <TableCell align="center">
                            {item.is_overdue
                              ? <Chip label={`${item.days_overdue}d`} size="small" color="error" />
                              : <Chip label="Current" size="small" color="success" variant="outlined" />}
                          </TableCell>
                          <TableCell>{item.branch_code}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <Box sx={{ px: 2, py: 1.25, borderTop: "1px solid", borderColor: "divider", display: "flex", justifyContent: "space-between", bgcolor: "grey.50" }}>
                  <Typography variant="body2" color="text.secondary">{filteredOut.length} invoice{filteredOut.length !== 1 ? "s" : ""}</Typography>
                  <Typography variant="subtitle1" fontWeight={700} color="error.main">Outstanding: Rs. {fmtLKR(outSummary.total_outstanding)}</Typography>
                </Box>
              </Paper>
            )}
          </Box>
        </>
      )}
    </Box>
  );
}
