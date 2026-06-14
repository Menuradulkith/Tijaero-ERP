/**
 * CustomerPaymentReportPage - Consolidated Customer Payment Report
 *
 * Shows all credit settlements across ALL customers in one flat,
 * filterable, sortable table. Supports CSV export and individual row print.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { exportToCSV } from "@/utils/csvExport";
import { useNavigate } from "react-router-dom";
import {
  Box,
  TextField,
  MenuItem,
  CircularProgress,
  Chip,
  Typography,
  Paper,
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Autocomplete,
  Tabs,
  Tab,
} from "@mui/material";
import AssessmentIcon from "@mui/icons-material/Assessment";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DownloadIcon from "@mui/icons-material/Download";
import PrintIcon from "@mui/icons-material/Print";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import {
  handleApiError,
  showErrorToast,
  fmtLKR,
} from "@/components/tijaero";
import {
  DetailPanelHeader,
  modernTableStyles,
} from "@/components/tijaero";
import {
  customersApi,
  CustomerPaymentReportItem,
  CustomerPaymentReportSummary,
  OutstandingDocumentItem,
  OutstandingDocumentSummary,
} from "@/modules/customers/api";
import { Customer } from "@/modules/customers/types";
import { useReferenceData } from "@/hooks";

type SortField = "date" | "customer_name" | "amount" | "branch_code" | "payment_method";
type SortDir = "asc" | "desc";
type OutSortField = "invoice_date" | "customer_name" | "balance_due" | "days_overdue" | "branch_code";

export default function CustomerPaymentReportPage() {
  const navigate = useNavigate();

  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().split("T")[0];
  }, []);
  const defaultTo = useMemo(() => new Date().toISOString().split("T")[0], []);

  // Tab
  const [activeTab, setActiveTab] = useState(0);

  // Filters
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string>("all");

  // Data
  const [items, setItems] = useState<CustomerPaymentReportItem[]>([]);
  const [summary, setSummary] = useState<CustomerPaymentReportSummary | null>(null);
  const [loading, setLoading] = useState(false);

  // Outstanding data
  const [outItems, setOutItems] = useState<OutstandingDocumentItem[]>([]);
  const [outSummary, setOutSummary] = useState<OutstandingDocumentSummary | null>(null);
  const [outLoading, setOutLoading] = useState(false);
  const [outSortField, setOutSortField] = useState<OutSortField>("days_overdue");
  const [outSortDir, setOutSortDir] = useState<SortDir>("desc");
  const [outOverdueOnly, setOutOverdueOnly] = useState(false);

  // Customers list for autocomplete
  const [customers, setCustomers] = useState<Customer[]>([]);

  // Sort
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Reference data
  const { filteredBranches: branches = [] } = useReferenceData(["branches"]);

  // Load customers for autocomplete
  useEffect(() => {
    customersApi.getAll().then((data) => {
      setCustomers(data.filter((c: Customer) => c.active));
    }).catch(() => {});
  }, []);

  // Fetch report via single backend endpoint
  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string | number> = {};
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      if (selectedCustomer) params.customer_id = selectedCustomer.id;
      if (selectedBranch !== "all") params.branch_code = selectedBranch;

      const data = await customersApi.getPaymentReport(params as any);
      setItems(data.items);
      setSummary(data.summary);
    } catch (err) {
      showErrorToast(handleApiError(err, "Failed to load payment report"));
      setItems([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, selectedCustomer, selectedBranch]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // Fetch outstanding documents
  const fetchOutstanding = useCallback(async () => {
    try {
      setOutLoading(true);
      const params: Record<string, string | number> = {};
      if (selectedCustomer) params.customer_id = selectedCustomer.id;
      if (selectedBranch !== "all") params.branch_code = selectedBranch;
      const data = await customersApi.getOutstandingDocuments(params as any);
      setOutItems(data.items);
      setOutSummary(data.summary);
    } catch (err) {
      showErrorToast(handleApiError(err, "Failed to load outstanding documents"));
      setOutItems([]);
      setOutSummary(null);
    } finally {
      setOutLoading(false);
    }
  }, [selectedCustomer, selectedBranch]);

  useEffect(() => {
    if (activeTab === 1) fetchOutstanding();
  }, [activeTab, fetchOutstanding]);

  // Sorting
  const sortedItems = useMemo(() => {
    const sorted = [...items];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "date":
          cmp = a.date.localeCompare(b.date);
          break;
        case "customer_name":
          cmp = a.customer_name.localeCompare(b.customer_name);
          break;
        case "amount":
          cmp = a.amount - b.amount;
          break;
        case "branch_code":
          cmp = (a.branch_code || "").localeCompare(b.branch_code || "");
          break;
        case "payment_method":
          cmp = (a.payment_method || "").localeCompare(b.payment_method || "");
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [items, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "amount" ? "desc" : "asc");
    }
  };

  // Outstanding sorting
  const filteredOutItems = useMemo(() => {
    return outOverdueOnly ? outItems.filter((i) => i.is_overdue) : outItems;
  }, [outItems, outOverdueOnly]);

  const sortedOutItems = useMemo(() => {
    const sorted = [...filteredOutItems];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (outSortField) {
        case "invoice_date": cmp = a.invoice_date.localeCompare(b.invoice_date); break;
        case "customer_name": cmp = a.customer_name.localeCompare(b.customer_name); break;
        case "balance_due": cmp = a.balance_due - b.balance_due; break;
        case "days_overdue": cmp = a.days_overdue - b.days_overdue; break;
        case "branch_code": cmp = (a.branch_code || "").localeCompare(b.branch_code || ""); break;
      }
      return outSortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [filteredOutItems, outSortField, outSortDir]);

  const handleOutSort = (field: OutSortField) => {
    if (outSortField === field) {
      setOutSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setOutSortField(field);
      setOutSortDir(field === "balance_due" || field === "days_overdue" ? "desc" : "asc");
    }
  };

  // CSV export
  const handleExportCSV = () => {
    if (activeTab === 1) {
      // Outstanding documents CSV
      const headers = ["Invoice No.", "Date", "Customer", "Credit Amount", "Paid", "Balance Due", "Due Date", "Days Overdue", "Overdue", "Branch"];
      const rows = sortedOutItems.map((item) => [
        item.invoice_no, item.invoice_date, item.customer_name,
        item.credit_amount.toFixed(2), item.paid_amount.toFixed(2), item.balance_due.toFixed(2),
        item.due_date, item.days_overdue.toString(), item.is_overdue ? "Yes" : "No", item.branch_code,
      ]);
      exportToCSV({ filename: "customer_outstanding_documents", headers, rows });
      return;
    }
    const headers = ["Date", "Customer", "Document No.", "Invoice(s)", "Payment Method", "Amount", "Branch", "Remarks"];
    const rows = sortedItems.map((item) => [
      item.date,
      item.customer_name,
      item.document_no,
      item.invoice_refs,
      item.payment_method,
      item.amount.toFixed(2),
      item.branch_code,
      item.remarks,
    ]);
    exportToCSV({
      filename: `customer_payment_report_${dateFrom}_to_${dateTo}`,
      headers,
      rows,
    });
  };

  // Per-row print
  const handlePrintRow = (item: CustomerPaymentReportItem) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      showErrorToast("Please allow popups to print");
      return;
    }

    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Payment Receipt - ${item.document_no}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 30px; color: #333; max-width: 700px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 30px; border-bottom: 3px solid #1976d2; padding-bottom: 20px; }
    .header h1 { margin: 0 0 5px 0; color: #1976d2; font-size: 22px; }
    .header h2 { margin: 0; font-weight: normal; color: #666; font-size: 16px; }
    .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 25px; }
    .detail-item { padding: 10px; background: #f9f9f9; border-radius: 6px; border: 1px solid #e0e0e0; }
    .detail-item .label { font-size: 11px; text-transform: uppercase; color: #888; letter-spacing: 0.5px; }
    .detail-item .value { font-size: 16px; font-weight: 600; margin-top: 4px; }
    .amount-highlight { background: linear-gradient(135deg, #1976d2, #1565c0); color: white; text-align: center; padding: 20px; border-radius: 8px; margin-bottom: 25px; }
    .amount-highlight .label { font-size: 12px; opacity: 0.9; text-transform: uppercase; }
    .amount-highlight .value { font-size: 28px; font-weight: bold; margin-top: 5px; }
    .footer { margin-top: 30px; padding-top: 15px; border-top: 1px solid #ddd; font-size: 11px; color: #888; text-align: center; }
    @media print { body { padding: 15px; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>Customer Payment Receipt</h1>
    <h2>Credit Settlement</h2>
  </div>
  <div class="amount-highlight">
    <div class="label">Amount Received</div>
    <div class="value">Rs. ${fmtLKR(item.amount)}</div>
  </div>
  <div class="detail-grid">
    <div class="detail-item"><div class="label">Document No.</div><div class="value">${item.document_no}</div></div>
    <div class="detail-item"><div class="label">Date</div><div class="value">${new Date(item.date).toLocaleDateString()}</div></div>
    <div class="detail-item"><div class="label">Customer</div><div class="value">${item.customer_name}</div></div>
    <div class="detail-item"><div class="label">Payment Method</div><div class="value">${item.payment_method || "-"}</div></div>
    <div class="detail-item"><div class="label">Invoice(s)</div><div class="value">${item.invoice_refs || "-"}</div></div>
    <div class="detail-item"><div class="label">Branch</div><div class="value">${item.branch_code || "-"}</div></div>
    ${item.remarks ? `<div class="detail-item" style="grid-column: span 2;"><div class="label">Remarks</div><div class="value">${item.remarks}</div></div>` : ""}
  </div>
  <div class="footer">
    <p>Generated on ${new Date().toLocaleString()} | Tijaero ERP System</p>
    <p>This is a computer-generated receipt.</p>
  </div>
  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`;

    printWindow.document.write(html);
    printWindow.document.close();
  };

  // Full report print
  const handlePrintReport = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      showErrorToast("Please allow popups to print");
      return;
    }
    const dateRangeText = `${new Date(dateFrom).toLocaleDateString()} to ${new Date(dateTo).toLocaleDateString()}`;
    const customerText = selectedCustomer ? selectedCustomer.customer_name : "All Customers";

    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Customer Payment Report</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; color: #333; max-width: 1100px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 30px; border-bottom: 3px solid #1976d2; padding-bottom: 20px; }
    .header h1 { margin: 0 0 5px 0; color: #1976d2; font-size: 24px; }
    .header .meta { font-size: 14px; color: #888; margin-top: 8px; }
    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 25px; }
    .summary-card { padding: 15px; border-radius: 8px; text-align: center; border: 1px solid #ddd; }
    .summary-card.primary { background: linear-gradient(135deg, #1976d2, #1565c0); color: white; }
    .summary-card.success { background: linear-gradient(135deg, #2e7d32, #1b5e20); color: white; }
    .summary-card.info { background: linear-gradient(135deg, #0288d1, #01579b); color: white; }
    .summary-card .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.9; }
    .summary-card .value { font-size: 20px; font-weight: bold; margin-top: 5px; }
    .summary-card .count { font-size: 12px; opacity: 0.8; margin-top: 3px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { border: 1px solid #ddd; padding: 8px 10px; text-align: left; }
    th { background: #1976d2; color: white; font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; }
    tr:nth-child(even) { background: #f9f9f9; }
    .text-right { text-align: right; }
    .totals-row { background: #f5f5f5 !important; font-weight: bold; }
    .footer { margin-top: 30px; padding-top: 15px; border-top: 1px solid #ddd; font-size: 11px; color: #888; text-align: center; }
    @media print { body { padding: 10px; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>Customer Payment Report</h1>
    <div class="meta">${customerText} | ${dateRangeText}</div>
  </div>
  <div class="summary-grid">
    <div class="summary-card primary">
      <div class="label">Total Received</div>
      <div class="value">Rs. ${fmtLKR(summary?.total_amount || 0)}</div>
      <div class="count">${summary?.total_count || 0} transactions</div>
    </div>
    <div class="summary-card success">
      <div class="label">Credit Settlements</div>
      <div class="value">Rs. ${fmtLKR(summary?.credit_settlements || 0)}</div>
      <div class="count">${summary?.credit_settlements_count || 0} settlements</div>
    </div>
    <div class="summary-card info">
      <div class="label">Customers</div>
      <div class="value">${new Set(sortedItems.map(i => i.customer_id)).size}</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Customer</th>
        <th>Document No.</th>
        <th>Invoice(s)</th>
        <th>Method</th>
        <th class="text-right">Amount (Rs.)</th>
        <th>Branch</th>
        <th>Remarks</th>
      </tr>
    </thead>
    <tbody>
      ${sortedItems.map((item) => `
        <tr>
          <td>${new Date(item.date).toLocaleDateString()}</td>
          <td>${item.customer_name}</td>
          <td>${item.document_no}</td>
          <td>${item.invoice_refs}</td>
          <td>${item.payment_method}</td>
          <td class="text-right"><strong>${fmtLKR(item.amount)}</strong></td>
          <td>${item.branch_code}</td>
          <td>${item.remarks || "-"}</td>
        </tr>
      `).join("")}
      <tr class="totals-row">
        <td colspan="5" style="text-align: right;">TOTAL:</td>
        <td class="text-right">Rs. ${fmtLKR(summary?.total_amount || 0)}</td>
        <td colspan="2"></td>
      </tr>
    </tbody>
  </table>
  <div class="footer">
    <p>Generated on ${new Date().toLocaleString()} | Tijaero ERP System</p>
    <p>This is a computer-generated report.</p>
  </div>
  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`;

    printWindow.document.write(html);
    printWindow.document.close();
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Finance", href: "/finance" },
          { label: "Customer Payments", href: "/finance/customer-payments" },
          { label: "Payment Report" },
        ]}
        title="Customer Payment Report"
        titleIcon={<AssessmentIcon color="primary" />}
        isCreating={false}
        chips={
          summary
            ? [
                { label: `${summary.total_count} Records`, color: "info" as const },
                { label: `Rs. ${fmtLKR(summary.total_amount)}`, color: "primary" as const },
              ]
            : []
        }
      />

      {/* Back + Action Buttons */}
      <Box sx={{ px: 2, pt: 1.5, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Button
          size="small"
          variant="text"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate("/finance/customer-payments")}
        >
          Back to Customer Payments
        </Button>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<DownloadIcon />}
            onClick={handleExportCSV}
            disabled={activeTab === 0 ? items.length === 0 : outItems.length === 0}
          >
            Export CSV
          </Button>
          <Button
            variant="contained"
            size="small"
            startIcon={<PrintIcon />}
            onClick={handlePrintReport}
            disabled={activeTab === 0 ? items.length === 0 : outItems.length === 0}
          >
            Print Report
          </Button>
        </Box>
      </Box>

      {/* Tabs */}
      <Box sx={{ px: 2, mt: 1 }}>
        <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ minHeight: 36, "& .MuiTab-root": { minHeight: 36, py: 0.5, textTransform: "none" } }}>
          <Tab label="Payment History" />
          <Tab
            label={
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                Outstanding Documents
                {outSummary && outSummary.overdue_count > 0 && (
                  <Chip size="small" label={outSummary.overdue_count} color="error" sx={{ height: 18, fontSize: "0.7rem" }} />
                )}
              </Box>
            }
          />
        </Tabs>
      </Box>

      {/* Filters — shared between tabs (customer & branch apply to both; date only for payments) */}
      <Paper variant="outlined" sx={{ mx: 2, mt: 2, p: 2, borderRadius: 2, overflow: "visible" }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Filters</Typography>
          <Button
            size="small"
            variant="text"
            disabled={
              dateFrom === defaultFrom &&
              dateTo === defaultTo &&
              !selectedCustomer &&
              selectedBranch === "all" &&
              !outOverdueOnly
            }
            onClick={() => {
              setDateFrom(defaultFrom);
              setDateTo(defaultTo);
              setSelectedCustomer(null);
              setSelectedBranch("all");
              setOutOverdueOnly(false);
            }}
          >
            Reset Filters
          </Button>
        </Box>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            flexWrap: "nowrap",
            overflowX: "auto",
            overflowY: "visible",
            pt: 0.5,
            pb: 0.25,
          }}
        >
          {activeTab === 0 && (
            <>
              <TextField
                size="small"
                label="Date From"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ minWidth: 155, flex: "0 0 155px" }}
              />
              <TextField
                size="small"
                label="Date To"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ minWidth: 155, flex: "0 0 155px" }}
              />
            </>
          )}
          <Autocomplete
            options={customers}
            getOptionLabel={(o) => o.customer_name}
            value={selectedCustomer}
            onChange={(_, v) => setSelectedCustomer(v)}
            renderInput={(params) => <TextField {...params} label="Customer" size="small" />}
            sx={{ minWidth: 200, flex: "1 1 200px" }}
          />
          <TextField
            select
            size="small"
            label="Branch"
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            sx={{ minWidth: 160, flex: "0 0 160px" }}
          >
            <MenuItem value="all">All Branches</MenuItem>
            {branches.map((b) => (
              <MenuItem key={b.branch_code} value={b.branch_code}>
                {b.branch_name}
              </MenuItem>
            ))}
          </TextField>
          {activeTab === 1 && (
            <Button
              size="small"
              variant={outOverdueOnly ? "contained" : "outlined"}
              color="error"
              startIcon={<WarningAmberIcon />}
              onClick={() => setOutOverdueOnly((p) => !p)}
              sx={{ minWidth: 140, flex: "0 0 140px", textTransform: "none" }}
            >
              {outOverdueOnly ? "Overdue Only" : "Show Overdue"}
            </Button>
          )}
        </Box>
      </Paper>

      {/* ==================== TAB 0: Payment History ==================== */}
      {activeTab === 0 && (
        <>
          {/* Summary Cards */}
          {summary && (
            <Box sx={{ px: 2, mt: 1.5, display: "flex", gap: 1.5, overflowX: "auto", pb: 0.5, flexShrink: 0 }}>
              <Card variant="outlined" sx={{ borderRadius: 2, minWidth: 180, flex: "1 1 180px" }}>
                <CardContent sx={{ py: 1.5, px: 2 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>Total Received</Typography>
                  <Typography variant="h6" fontWeight={700} color="primary.main" sx={{ mt: 0.5, whiteSpace: "nowrap" }}>Rs. {fmtLKR(summary.total_amount)}</Typography>
                  <Typography variant="caption" color="text.secondary">{summary.total_count} transaction{summary.total_count !== 1 ? "s" : ""}</Typography>
                </CardContent>
              </Card>
              <Card variant="outlined" sx={{ borderRadius: 2, minWidth: 180, flex: "1 1 180px" }}>
                <CardContent sx={{ py: 1.5, px: 2 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>Credit Settlements</Typography>
                  <Typography variant="h6" fontWeight={700} color="info.main" sx={{ mt: 0.5, whiteSpace: "nowrap" }}>Rs. {fmtLKR(summary.credit_settlements)}</Typography>
                  <Typography variant="caption" color="text.secondary">{summary.credit_settlements_count} settlement{summary.credit_settlements_count !== 1 ? "s" : ""}</Typography>
                </CardContent>
              </Card>
              <Card variant="outlined" sx={{ borderRadius: 2, minWidth: 170, flex: "1 1 170px" }}>
                <CardContent sx={{ py: 1.5, px: 2 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>Customers</Typography>
                  <Typography variant="h6" fontWeight={700} color="success.main" sx={{ mt: 0.5, whiteSpace: "nowrap" }}>{new Set(items.map(i => i.customer_id)).size}</Typography>
                  <Typography variant="caption" color="text.secondary">unique customers</Typography>
                </CardContent>
              </Card>
            </Box>
          )}

          {/* Payment Table */}
          <Box sx={{ flex: 1, overflow: "auto", px: 2, mt: 2, mb: 2 }}>
            {loading ? (
              <Paper variant="outlined" sx={{ p: 4, borderRadius: 2, textAlign: "center" }}>
                <CircularProgress size={28} />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>Loading payment report...</Typography>
              </Paper>
            ) : items.length === 0 ? (
              <Paper variant="outlined" sx={{ p: 5, borderRadius: 2, textAlign: "center" }}>
                <Typography variant="body1" sx={{ mb: 0.5, fontWeight: 600 }}>No payment records found</Typography>
                <Typography variant="body2" color="text.secondary">Try changing filters or date range to view more records.</Typography>
              </Paper>
            ) : (
              <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
                <TableContainer sx={{ maxHeight: "calc(100vh - 440px)" }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow sx={modernTableStyles.headerRow}>
                        <TableCell><TableSortLabel active={sortField === "date"} direction={sortField === "date" ? sortDir : "asc"} onClick={() => handleSort("date")}>Date</TableSortLabel></TableCell>
                        <TableCell><TableSortLabel active={sortField === "customer_name"} direction={sortField === "customer_name" ? sortDir : "asc"} onClick={() => handleSort("customer_name")}>Customer</TableSortLabel></TableCell>
                        <TableCell>Document No.</TableCell>
                        <TableCell>Invoice(s)</TableCell>
                        <TableCell><TableSortLabel active={sortField === "payment_method"} direction={sortField === "payment_method" ? sortDir : "asc"} onClick={() => handleSort("payment_method")}>Method</TableSortLabel></TableCell>
                        <TableCell align="right"><TableSortLabel active={sortField === "amount"} direction={sortField === "amount" ? sortDir : "asc"} onClick={() => handleSort("amount")}>Amount (Rs.)</TableSortLabel></TableCell>
                        <TableCell><TableSortLabel active={sortField === "branch_code"} direction={sortField === "branch_code" ? sortDir : "asc"} onClick={() => handleSort("branch_code")}>Branch</TableSortLabel></TableCell>
                        <TableCell>Remarks</TableCell>
                        <TableCell align="center">Print</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sortedItems.map((item, index) => (
                        <TableRow key={`${item.id}-${index}`} hover sx={{ "&:nth-of-type(odd)": { bgcolor: "grey.50" }, "& td": { borderColor: "divider" } }}>
                          <TableCell sx={{ whiteSpace: "nowrap" }}>{new Date(item.date).toLocaleDateString()}</TableCell>
                          <TableCell>{item.customer_name}</TableCell>
                          <TableCell sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{item.document_no}</TableCell>
                          <TableCell>{item.invoice_refs}</TableCell>
                          <TableCell><Chip label={item.payment_method} size="small" color="info" variant="outlined" /></TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>{fmtLKR(item.amount)}</TableCell>
                          <TableCell>{item.branch_code}</TableCell>
                          <TableCell sx={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.remarks || ""}>{item.remarks || "-"}</TableCell>
                          <TableCell align="center"><Button size="small" variant="text" sx={{ minWidth: 32 }} onClick={() => handlePrintRow(item)}><PrintIcon fontSize="small" /></Button></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <Box sx={{ px: 2, py: 1.25, borderTop: "1px solid", borderColor: "divider", display: "flex", justifyContent: "space-between", alignItems: "center", bgcolor: "grey.50" }}>
                  <Typography variant="body2" color="text.secondary">{items.length} record{items.length !== 1 ? "s" : ""}</Typography>
                  <Typography variant="subtitle1" color="primary.main" sx={{ fontWeight: 700 }}>Total: Rs. {fmtLKR(summary?.total_amount || 0)}</Typography>
                </Box>
              </Paper>
            )}
          </Box>
        </>
      )}

      {/* ==================== TAB 1: Outstanding Documents ==================== */}
      {activeTab === 1 && (
        <>
          {/* Outstanding Summary Cards */}
          {outSummary && (
            <Box sx={{ px: 2, mt: 1.5, display: "flex", gap: 1.5, overflowX: "auto", pb: 0.5, flexShrink: 0 }}>
              <Card variant="outlined" sx={{ borderRadius: 2, minWidth: 180, flex: "1 1 180px" }}>
                <CardContent sx={{ py: 1.5, px: 2 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>Total Outstanding</Typography>
                  <Typography variant="h6" fontWeight={700} color="primary.main" sx={{ mt: 0.5, whiteSpace: "nowrap" }}>Rs. {fmtLKR(outSummary.total_outstanding)}</Typography>
                  <Typography variant="caption" color="text.secondary">{outSummary.total_documents} invoice{outSummary.total_documents !== 1 ? "s" : ""}</Typography>
                </CardContent>
              </Card>
              <Card variant="outlined" sx={{ borderRadius: 2, minWidth: 180, flex: "1 1 180px", borderColor: outSummary.overdue_count > 0 ? "error.main" : undefined }}>
                <CardContent sx={{ py: 1.5, px: 2 }}>
                  <Typography variant="caption" color="error.main" sx={{ textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>Overdue</Typography>
                  <Typography variant="h6" fontWeight={700} color="error.main" sx={{ mt: 0.5, whiteSpace: "nowrap" }}>Rs. {fmtLKR(outSummary.total_overdue)}</Typography>
                  <Typography variant="caption" color="text.secondary">{outSummary.overdue_count} invoice{outSummary.overdue_count !== 1 ? "s" : ""}</Typography>
                </CardContent>
              </Card>
              <Card variant="outlined" sx={{ borderRadius: 2, minWidth: 170, flex: "1 1 170px" }}>
                <CardContent sx={{ py: 1.5, px: 2 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>Customers</Typography>
                  <Typography variant="h6" fontWeight={700} color="success.main" sx={{ mt: 0.5, whiteSpace: "nowrap" }}>{new Set(outItems.map(i => i.customer_id)).size}</Typography>
                  <Typography variant="caption" color="text.secondary">with outstanding</Typography>
                </CardContent>
              </Card>
            </Box>
          )}

          {/* Outstanding Table */}
          <Box sx={{ flex: 1, overflow: "auto", px: 2, mt: 2, mb: 2 }}>
            {outLoading ? (
              <Paper variant="outlined" sx={{ p: 4, borderRadius: 2, textAlign: "center" }}>
                <CircularProgress size={28} />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>Loading outstanding documents...</Typography>
              </Paper>
            ) : sortedOutItems.length === 0 ? (
              <Paper variant="outlined" sx={{ p: 5, borderRadius: 2, textAlign: "center" }}>
                <Typography variant="body1" sx={{ mb: 0.5, fontWeight: 600 }}>No outstanding documents</Typography>
                <Typography variant="body2" color="text.secondary">All credit invoices are fully settled.</Typography>
              </Paper>
            ) : (
              <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
                <TableContainer sx={{ maxHeight: "calc(100vh - 440px)" }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow sx={modernTableStyles.headerRow}>
                        <TableCell><TableSortLabel active={outSortField === "invoice_date"} direction={outSortField === "invoice_date" ? outSortDir : "asc"} onClick={() => handleOutSort("invoice_date")}>Invoice Date</TableSortLabel></TableCell>
                        <TableCell><TableSortLabel active={outSortField === "customer_name"} direction={outSortField === "customer_name" ? outSortDir : "asc"} onClick={() => handleOutSort("customer_name")}>Customer</TableSortLabel></TableCell>
                        <TableCell>Invoice No.</TableCell>
                        <TableCell align="right">Credit Amount</TableCell>
                        <TableCell align="right">Paid</TableCell>
                        <TableCell align="right"><TableSortLabel active={outSortField === "balance_due"} direction={outSortField === "balance_due" ? outSortDir : "asc"} onClick={() => handleOutSort("balance_due")}>Balance Due</TableSortLabel></TableCell>
                        <TableCell>Due Date</TableCell>
                        <TableCell align="center"><TableSortLabel active={outSortField === "days_overdue"} direction={outSortField === "days_overdue" ? outSortDir : "asc"} onClick={() => handleOutSort("days_overdue")}>Overdue</TableSortLabel></TableCell>
                        <TableCell><TableSortLabel active={outSortField === "branch_code"} direction={outSortField === "branch_code" ? outSortDir : "asc"} onClick={() => handleOutSort("branch_code")}>Branch</TableSortLabel></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sortedOutItems.map((item) => (
                        <TableRow key={item.invoice_id} hover sx={{ "&:nth-of-type(odd)": { bgcolor: "grey.50" }, "& td": { borderColor: "divider" }, ...(item.is_overdue && { bgcolor: "error.50" }) }}>
                          <TableCell sx={{ whiteSpace: "nowrap" }}>{new Date(item.invoice_date).toLocaleDateString()}</TableCell>
                          <TableCell>{item.customer_name}</TableCell>
                          <TableCell sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{item.invoice_no}</TableCell>
                          <TableCell align="right">{fmtLKR(item.credit_amount)}</TableCell>
                          <TableCell align="right">{fmtLKR(item.paid_amount)}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700, color: item.is_overdue ? "error.main" : "primary.main" }}>{fmtLKR(item.balance_due)}</TableCell>
                          <TableCell sx={{ whiteSpace: "nowrap" }}>{new Date(item.due_date).toLocaleDateString()}</TableCell>
                          <TableCell align="center">
                            {item.is_overdue ? (
                              <Chip label={`${item.days_overdue}d`} size="small" color="error" variant="filled" />
                            ) : (
                              <Chip label="Current" size="small" color="success" variant="outlined" />
                            )}
                          </TableCell>
                          <TableCell>{item.branch_code}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <Box sx={{ px: 2, py: 1.25, borderTop: "1px solid", borderColor: "divider", display: "flex", justifyContent: "space-between", alignItems: "center", bgcolor: "grey.50" }}>
                  <Typography variant="body2" color="text.secondary">{sortedOutItems.length} document{sortedOutItems.length !== 1 ? "s" : ""}</Typography>
                  <Typography variant="subtitle1" color="error.main" sx={{ fontWeight: 700 }}>Outstanding: Rs. {fmtLKR(outSummary?.total_outstanding || 0)}</Typography>
                </Box>
              </Paper>
            )}
          </Box>
        </>
      )}
    </Box>
  );
}
