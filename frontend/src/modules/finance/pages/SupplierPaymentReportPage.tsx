/**
 * SupplierPaymentReportPage - Consolidated Supplier Payment Report
 *
 * Shows all payment types (Direct Payments, Credit Settlements, Advance Applications)
 * across ALL suppliers in one flat, filterable, sortable table.
 * Supports CSV export and individual row print.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
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
} from "@mui/material";
import AssessmentIcon from "@mui/icons-material/Assessment";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DownloadIcon from "@mui/icons-material/Download";
import PrintIcon from "@mui/icons-material/Print";
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
  supplierPaymentsApi,
  PaymentReportItem,
  PaymentReportSummary,
} from "@/modules/purchasing/api";
import { suppliersApi } from "@/modules/purchasing/api";
import { useReferenceData } from "@/hooks";
import type { Supplier } from "@/modules/purchasing/types";

type SortField = "date" | "supplier_name" | "type" | "amount" | "branch_code";
type SortDir = "asc" | "desc";

export default function SupplierPaymentReportPage() {
  const navigate = useNavigate();
  // Date defaults: last 3 months
  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().split("T")[0];
  }, []);
  const defaultTo = useMemo(() => new Date().toISOString().split("T")[0], []);

  // Filters
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");

  // Data
  const [items, setItems] = useState<PaymentReportItem[]>([]);
  const [summary, setSummary] = useState<PaymentReportSummary | null>(null);
  const [loading, setLoading] = useState(false);

  // Suppliers list for autocomplete
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  // Sort
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Reference data
  const { filteredBranches: branches = [] } = useReferenceData(["branches"]);

  // Load suppliers for autocomplete
  useEffect(() => {
    suppliersApi.getAll({ active: true }).then(setSuppliers).catch(() => {});
  }, []);

  // Fetch report
  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string | number> = {};
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      if (selectedSupplier) params.supplier_id = selectedSupplier.id;
      if (selectedBranch !== "all") params.branch_code = selectedBranch;

      const data = await supplierPaymentsApi.getPaymentReport(params as any);
      setItems(data.items);
      setSummary(data.summary);
    } catch (err) {
      showErrorToast(handleApiError(err, "Failed to load payment report"));
      setItems([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, selectedSupplier, selectedBranch]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // Client-side status filter applied on top of API results
  const filteredItems = useMemo(() => {
    if (selectedStatus === "all") return items;
    return items.filter((i) => i.status === selectedStatus);
  }, [items, selectedStatus]);

  // Sorting
  const sortedItems = useMemo(() => {
    const sorted = [...filteredItems];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "date":
          cmp = a.date.localeCompare(b.date);
          break;
        case "supplier_name":
          cmp = a.supplier_name.localeCompare(b.supplier_name);
          break;
        case "type":
          cmp = a.type.localeCompare(b.type);
          break;
        case "amount":
          cmp = a.amount - b.amount;
          break;
        case "branch_code":
          cmp = (a.branch_code || "").localeCompare(b.branch_code || "");
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

  // CSV export
  const handleExportCSV = () => {
    const headers = ["Date", "Supplier", "Type", "Document No.", "GRN Reference", "Payment Method", "Amount", "Status", "Branch", "Remarks"];
    const rows = sortedItems.map((item) => [
      item.date,
      item.supplier_name,
      item.type,
      item.document_no,
      item.grn_reference || "",
      item.payment_method || "",
      item.amount.toFixed(2),
      item.status,
      item.branch_code || "",
      item.remarks || "",
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `supplier_payment_report_${dateFrom}_to_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Per-row print
  const handlePrintRow = (item: PaymentReportItem) => {
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
    <h1>Payment Receipt</h1>
    <h2>${item.type}</h2>
  </div>
  <div class="amount-highlight">
    <div class="label">Amount Paid</div>
    <div class="value">Rs. ${fmtLKR(item.amount)}</div>
  </div>
  <div class="detail-grid">
    <div class="detail-item"><div class="label">Document No.</div><div class="value">${item.document_no}</div></div>
    <div class="detail-item"><div class="label">Date</div><div class="value">${new Date(item.date).toLocaleDateString()}</div></div>
    <div class="detail-item"><div class="label">Supplier</div><div class="value">${item.supplier_name}</div></div>
    <div class="detail-item"><div class="label">Payment Method</div><div class="value">${item.payment_method || "-"}</div></div>
    <div class="detail-item"><div class="label">GRN Reference</div><div class="value">${item.grn_reference || "-"}</div></div>
    <div class="detail-item"><div class="label">Branch</div><div class="value">${item.branch_code || "-"}</div></div>
    <div class="detail-item"><div class="label">Status</div><div class="value">${(item.status || "").toUpperCase()}</div></div>
    <div class="detail-item"><div class="label">Remarks</div><div class="value">${item.remarks || "-"}</div></div>
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
    const supplierText = selectedSupplier ? selectedSupplier.full_name : "All Suppliers";

    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Supplier Payment Report</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; color: #333; max-width: 1100px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 30px; border-bottom: 3px solid #1976d2; padding-bottom: 20px; }
    .header h1 { margin: 0 0 5px 0; color: #1976d2; font-size: 24px; }
    .header .meta { font-size: 14px; color: #888; margin-top: 8px; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 25px; }
    .summary-card { padding: 15px; border-radius: 8px; text-align: center; border: 1px solid #ddd; }
    .summary-card.primary { background: linear-gradient(135deg, #1976d2, #1565c0); color: white; }
    .summary-card.success { background: linear-gradient(135deg, #2e7d32, #1b5e20); color: white; }
    .summary-card.info { background: linear-gradient(135deg, #0288d1, #01579b); color: white; }
    .summary-card.warning { background: linear-gradient(135deg, #ed6c02, #e65100); color: white; }
    .summary-card .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.9; }
    .summary-card .value { font-size: 20px; font-weight: bold; margin-top: 5px; }
    .summary-card .count { font-size: 12px; opacity: 0.8; margin-top: 3px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { border: 1px solid #ddd; padding: 8px 10px; text-align: left; }
    th { background: #1976d2; color: white; font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; }
    tr:nth-child(even) { background: #f9f9f9; }
    .text-right { text-align: right; }
    .totals-row { background: #f5f5f5 !important; font-weight: bold; }
    .type-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 500; }
    .type-direct { background: #e8f5e9; color: #2e7d32; }
    .type-credit { background: #e3f2fd; color: #1565c0; }
    .type-advance { background: #f3e5f5; color: #8e24aa; }
    .footer { margin-top: 30px; padding-top: 15px; border-top: 1px solid #ddd; font-size: 11px; color: #888; text-align: center; }
    @media print { body { padding: 10px; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>Supplier Payment Report</h1>
    <div class="meta">${supplierText} | ${dateRangeText}</div>
  </div>
  <div class="summary-grid">
    <div class="summary-card primary">
      <div class="label">Total Payments</div>
      <div class="value">Rs. ${fmtLKR(summary?.total_amount || 0)}</div>
      <div class="count">${summary?.total_count || 0} transactions</div>
    </div>
    <div class="summary-card success">
      <div class="label">Direct Payments</div>
      <div class="value">Rs. ${fmtLKR(summary?.direct_payments || 0)}</div>
      <div class="count">${summary?.direct_payments_count || 0}</div>
    </div>
    <div class="summary-card info">
      <div class="label">Credit Settlements</div>
      <div class="value">Rs. ${fmtLKR(summary?.credit_settlements || 0)}</div>
      <div class="count">${summary?.credit_settlements_count || 0}</div>
    </div>
    <div class="summary-card warning">
      <div class="label">Advance Payments</div>
      <div class="value">Rs. ${fmtLKR(summary?.advance_payments || 0)}</div>
      <div class="count">${summary?.advance_payments_count || 0}</div>
    </div>
    <div class="summary-card warning">
      <div class="label">Advance Applications</div>
      <div class="value">Rs. ${fmtLKR(summary?.advance_applications || 0)}</div>
      <div class="count">${summary?.advance_applications_count || 0}</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Supplier</th>
        <th>Type</th>
        <th>Document No.</th>
        <th>GRN Ref</th>
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
          <td>${item.supplier_name}</td>
          <td><span class="type-badge ${item.type === "Direct Payment" ? "type-direct" : item.type === "Credit Settlement" ? "type-credit" : "type-advance"}">${item.type}</span></td>
          <td>${item.document_no}</td>
          <td>${item.grn_reference || "-"}</td>
          <td>${item.payment_method || "-"}</td>
          <td class="text-right"><strong>${fmtLKR(item.amount)}</strong></td>
          <td>${item.branch_code || "-"}</td>
          <td>${item.remarks || "-"}</td>
        </tr>
      `).join("")}
      <tr class="totals-row">
        <td colspan="6" style="text-align: right;">TOTAL:</td>
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

  const typeColor = (type: string) => {
    switch (type) {
      case "Direct Payment":
        return "success";
      case "Credit Settlement":
        return "info";
      case "Advance Payment":
        return "warning";
      case "Advance Application":
        return "secondary";
      default:
        return "default";
    }
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
        chips={
          summary
            ? [
                { label: `${summary.total_count} Records`, color: "info" as const },
                { label: `Rs. ${fmtLKR(summary.total_amount)}`, color: "primary" as const },
              ]
            : []
        }
      />

      {/* Back to Supplier Payments + Action Buttons */}
      <Box sx={{ px: 2, pt: 1.5, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Button
          size="small"
          variant="text"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate("/finance/supplier-payments")}
        >
          Back to Supplier Payments
        </Button>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<DownloadIcon />}
            onClick={handleExportCSV}
            disabled={filteredItems.length === 0}
          >
            Export CSV
          </Button>
          <Button
            variant="contained"
            size="small"
            startIcon={<PrintIcon />}
            onClick={handlePrintReport}
            disabled={filteredItems.length === 0}
          >
            Print Report
          </Button>
        </Box>
      </Box>

      {/* Filters */}
      <Paper variant="outlined" sx={{ mx: 2, mt: 2, p: 2, borderRadius: 2, overflow: "visible" }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Filters</Typography>
          <Button
            size="small"
            variant="text"
            disabled={
              dateFrom === defaultFrom &&
              dateTo === defaultTo &&
              !selectedSupplier &&
              selectedBranch === "all" &&
              selectedStatus === "all"
            }
            onClick={() => {
              setDateFrom(defaultFrom);
              setDateTo(defaultTo);
              setSelectedSupplier(null);
              setSelectedBranch("all");
              setSelectedStatus("all");
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
          <Autocomplete
            options={suppliers}
            getOptionLabel={(o) => o.full_name}
            value={selectedSupplier}
            onChange={(_, v) => setSelectedSupplier(v)}
            renderInput={(params) => <TextField {...params} label="Supplier" size="small" />}
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
          <TextField
            select
            size="small"
            label="Status"
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            sx={{ minWidth: 140, flex: "0 0 140px" }}
          >
            <MenuItem value="all">All Status</MenuItem>
            <MenuItem value="verified">Verified</MenuItem>
            <MenuItem value="pending">Pending</MenuItem>
            <MenuItem value="cancelled">Cancelled</MenuItem>
          </TextField>
        </Box>
      </Paper>

      {/* Summary Cards - single scrollable row */}
      {summary && (
        <Box
          sx={{
            px: 2,
            mt: 1.5,
            display: "flex",
            gap: 1.5,
            overflowX: "auto",
            pb: 0.5,
            flexShrink: 0,
          }}
        >
          {/* Total */}
          <Card variant="outlined" sx={{ borderRadius: 2, minWidth: 180, flex: "1 1 180px" }}>
            <CardContent sx={{ py: 1.5, px: 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>
                Total Payments
              </Typography>
              <Typography variant="h6" fontWeight={700} color="primary.main" sx={{ mt: 0.5, whiteSpace: "nowrap" }}>
                Rs. {fmtLKR(summary.total_amount)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {summary.total_count} transaction{summary.total_count !== 1 ? "s" : ""}
              </Typography>
            </CardContent>
          </Card>
          {/* Direct Payments */}
          <Card variant="outlined" sx={{ borderRadius: 2, minWidth: 170, flex: "1 1 170px" }}>
            <CardContent sx={{ py: 1.5, px: 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>
                Direct Payments
              </Typography>
              <Typography variant="h6" fontWeight={700} color="success.main" sx={{ mt: 0.5, whiteSpace: "nowrap" }}>
                Rs. {fmtLKR(summary.direct_payments)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {summary.direct_payments_count} payment{summary.direct_payments_count !== 1 ? "s" : ""}
              </Typography>
            </CardContent>
          </Card>
          {/* Credit Settlements */}
          <Card variant="outlined" sx={{ borderRadius: 2, minWidth: 180, flex: "1 1 180px" }}>
            <CardContent sx={{ py: 1.5, px: 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>
                Credit Settlements
              </Typography>
              <Typography variant="h6" fontWeight={700} color="info.main" sx={{ mt: 0.5, whiteSpace: "nowrap" }}>
                Rs. {fmtLKR(summary.credit_settlements)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {summary.credit_settlements_count} settlement{summary.credit_settlements_count !== 1 ? "s" : ""}
              </Typography>
            </CardContent>
          </Card>
          {/* Advance Payments */}
          <Card variant="outlined" sx={{ borderRadius: 2, minWidth: 180, flex: "1 1 180px" }}>
            <CardContent sx={{ py: 1.5, px: 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>
                Advance Payments
              </Typography>
              <Typography variant="h6" fontWeight={700} color="warning.main" sx={{ mt: 0.5, whiteSpace: "nowrap" }}>
                Rs. {fmtLKR(summary.advance_payments)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {summary.advance_payments_count} payment{summary.advance_payments_count !== 1 ? "s" : ""}
              </Typography>
            </CardContent>
          </Card>
          {/* Advance Applications */}
          <Card variant="outlined" sx={{ borderRadius: 2, minWidth: 190, flex: "1 1 190px" }}>
            <CardContent sx={{ py: 1.5, px: 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>
                Advance Applications
              </Typography>
              <Typography variant="h6" fontWeight={700} color="secondary.main" sx={{ mt: 0.5, whiteSpace: "nowrap" }}>
                Rs. {fmtLKR(summary.advance_applications)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {summary.advance_applications_count} application{summary.advance_applications_count !== 1 ? "s" : ""}
              </Typography>
            </CardContent>
          </Card>
          {/* Pending */}
          <Card variant="outlined" sx={{ borderRadius: 2, minWidth: 170, flex: "1 1 170px", borderColor: "warning.main" }}>
            <CardContent sx={{ py: 1.5, px: 2 }}>
              <Typography variant="caption" color="warning.dark" sx={{ textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>
                Pending
              </Typography>
              <Typography variant="h6" fontWeight={700} color="warning.main" sx={{ mt: 0.5, whiteSpace: "nowrap" }}>
                Rs. {fmtLKR(summary.pending_amount)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {summary.pending_count} record{summary.pending_count !== 1 ? "s" : ""} awaiting
              </Typography>
            </CardContent>
          </Card>
        </Box>
      )}

      {/* Table */}
      <Box sx={{ flex: 1, overflow: "auto", px: 2, mt: 2, mb: 2 }}>
        {loading ? (
          <Paper variant="outlined" sx={{ p: 4, borderRadius: 2, textAlign: "center" }}>
            <CircularProgress size={28} />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
              Loading payment report...
            </Typography>
          </Paper>
        ) : items.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 5, borderRadius: 2, textAlign: "center" }}>
            <Typography variant="body1" sx={{ mb: 0.5, fontWeight: 600 }}>
              No payment records found
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Try changing filters or date range to view more records.
            </Typography>
          </Paper>
        ) : (
          <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
            <TableContainer sx={{ maxHeight: "calc(100vh - 400px)" }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow sx={modernTableStyles.headerRow}>
                    <TableCell>
                      <TableSortLabel
                        active={sortField === "date"}
                        direction={sortField === "date" ? sortDir : "asc"}
                        onClick={() => handleSort("date")}
                      >
                        Date
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>
                      <TableSortLabel
                        active={sortField === "supplier_name"}
                        direction={sortField === "supplier_name" ? sortDir : "asc"}
                        onClick={() => handleSort("supplier_name")}
                      >
                        Supplier
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>
                      <TableSortLabel
                        active={sortField === "type"}
                        direction={sortField === "type" ? sortDir : "asc"}
                        onClick={() => handleSort("type")}
                      >
                        Type
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>Document No.</TableCell>
                    <TableCell>GRN Reference</TableCell>
                    <TableCell>Method</TableCell>
                    <TableCell align="right">
                      <TableSortLabel
                        active={sortField === "amount"}
                        direction={sortField === "amount" ? sortDir : "asc"}
                        onClick={() => handleSort("amount")}
                      >
                        Amount (Rs.)
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>
                      <TableSortLabel
                        active={sortField === "branch_code"}
                        direction={sortField === "branch_code" ? sortDir : "asc"}
                        onClick={() => handleSort("branch_code")}
                      >
                        Branch
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>Remarks</TableCell>
                    <TableCell align="center">Print</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedItems.map((item, index) => (
                    <TableRow
                      key={`${item.type}-${item.id}-${index}`}
                      hover
                      sx={{
                        "&:nth-of-type(odd)": { bgcolor: "grey.50" },
                        "& td": { borderColor: "divider" },
                      }}
                    >
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {new Date(item.date).toLocaleDateString()}
                      </TableCell>
                      <TableCell>{item.supplier_name}</TableCell>
                      <TableCell>
                        <Chip
                          label={item.type}
                          size="small"
                          color={typeColor(item.type) as any}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
                        {item.document_no}
                      </TableCell>
                      <TableCell>{item.grn_reference || "-"}</TableCell>
                      <TableCell>{item.payment_method || "-"}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>
                        {fmtLKR(item.amount)}
                      </TableCell>
                      <TableCell>{item.branch_code || "-"}</TableCell>
                      <TableCell
                        sx={{
                          maxWidth: 180,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={item.remarks || ""}
                      >
                        {item.remarks || "-"}
                      </TableCell>
                      <TableCell align="center">
                        <Button
                          size="small"
                          variant="text"
                          sx={{ minWidth: 32 }}
                          onClick={() => handlePrintRow(item)}
                        >
                          <PrintIcon fontSize="small" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Box
              sx={{
                px: 2,
                py: 1.25,
                borderTop: "1px solid",
                borderColor: "divider",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                bgcolor: "grey.50",
              }}
            >
              <Typography variant="body2" color="text.secondary">
                {filteredItems.length} record{filteredItems.length !== 1 ? "s" : ""}
              </Typography>
              <Typography variant="subtitle1" color="primary.main" sx={{ fontWeight: 700 }}>
                Total: Rs. {fmtLKR(summary?.total_amount || 0)}
              </Typography>
            </Box>
          </Paper>
        )}
      </Box>
    </Box>
  );
}
