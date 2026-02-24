import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Box,
  Paper,
  Card,
  CardContent,
  Typography,
  TextField,
  MenuItem,
  Chip,
  Button,
  ButtonGroup,
  Tooltip,
  Collapse,
  IconButton,
} from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import PrintIcon from "@mui/icons-material/Print";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ReceiptIcon from "@mui/icons-material/Receipt";
import PaymentsIcon from "@mui/icons-material/Payments";
import CreditCardIcon from "@mui/icons-material/CreditCard";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import MoneyOffIcon from "@mui/icons-material/MoneyOff";
import SavingsIcon from "@mui/icons-material/Savings";
import { TPageHeader, TCurrency, TBranchFilter, showErrorToast, showSuccessToast } from "@/components/tijaero";
import { cashbookApi } from "@/modules/finance/api";
import { CashbookEntryType, CashbookReport } from "@/modules/finance/types";
import { useReferenceData } from "@/hooks";

// Date range quick filter options
type DateRangePreset = "today" | "thisWeek" | "thisMonth" | "lastMonth" | "last30Days" | "custom";

const getDateRangeFromPreset = (preset: DateRangePreset): { from: string; to: string } => {
  const today = new Date();
  const toStr = today.toISOString().split("T")[0];
  
  switch (preset) {
    case "today":
      return { from: toStr, to: toStr };
    case "thisWeek": {
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - today.getDay());
      return { from: startOfWeek.toISOString().split("T")[0], to: toStr };
    }
    case "thisMonth": {
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: startOfMonth.toISOString().split("T")[0], to: toStr };
    }
    case "lastMonth": {
      const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: startOfLastMonth.toISOString().split("T")[0], to: endOfLastMonth.toISOString().split("T")[0] };
    }
    case "last30Days": {
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(today.getDate() - 30);
      return { from: thirtyDaysAgo.toISOString().split("T")[0], to: toStr };
    }
    default:
      return { from: new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split("T")[0], to: toStr };
  }
};

const ENTRY_TYPES: { value: CashbookEntryType | ""; label: string }[] = [
  { value: "", label: "All Transactions" },
  { value: "invoice_receipt", label: "Invoice Receipts" },
  { value: "customer_advance", label: "Customer Advances" },
  { value: "customer_credit_settle", label: "Credit Settlements" },
  { value: "voucher_sale", label: "Voucher Sales" },
  { value: "supplier_payment", label: "Supplier Payments" },
  { value: "expense", label: "Expenses" },
  { value: "bank_deposit", label: "Bank Deposits" },
];

const PAYMENT_METHODS = [
  { value: "", label: "All Methods" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank", label: "Bank Transfer" },
  { value: "cheque", label: "Cheque" },
];

const getEntryTypeColor = (type: CashbookEntryType) => {
  switch (type) {
    case "invoice_receipt":
      return "success";
    case "customer_advance":
      return "info";
    case "customer_credit_settle":
      return "primary";
    case "voucher_sale":
      return "success";  // Green - Money IN
    case "supplier_payment":
      return "warning";
    case "expense":
      return "error";
    case "bank_deposit":
      return "secondary";
    default:
      return "default";
  }
};

const getEntryTypeLabel = (type: CashbookEntryType) => {
  const found = ENTRY_TYPES.find((t) => t.value === type);
  return found?.label || type;
};

export default function CashbookPage() {
  const today = new Date().toISOString().split("T")[0];
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    .toISOString()
    .split("T")[0];

  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(today);
  const [datePreset, setDatePreset] = useState<DateRangePreset>("thisMonth");
  const [branchCode, setBranchCode] = useState<string | null>(null);
  const [entryType, setEntryType] = useState<CashbookEntryType | "">("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [showBreakdown, setShowBreakdown] = useState(true);

  const { filteredBranches } = useReferenceData(["branches"]);
  const branches = filteredBranches || [];

  const { data: report, isLoading } = useQuery({
    queryKey: ["cashbook", dateFrom, dateTo, branchCode, entryType, paymentMethod],
    queryFn: () =>
      cashbookApi.getReport({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        branch_code: branchCode ?? undefined,
        entry_type: entryType || undefined,
        payment_method: paymentMethod || undefined,
      }),
  });

  // Handle date preset changes
  const handleDatePresetChange = (preset: DateRangePreset) => {
    setDatePreset(preset);
    if (preset !== "custom") {
      const { from, to } = getDateRangeFromPreset(preset);
      setDateFrom(from);
      setDateTo(to);
    }
  };

  // Handle custom date changes
  const handleCustomDateChange = (field: "from" | "to", value: string) => {
    setDatePreset("custom");
    if (field === "from") setDateFrom(value);
    else setDateTo(value);
  };

  // Print cashbook report
  const handlePrint = () => {
    if (!report) {
      showErrorToast("No data to print");
      return;
    }
    
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      showErrorToast("Please allow popups to print");
      return;
    }

    const branchName = branchCode 
      ? branches.find(b => b.branch_code === branchCode)?.branch_name || branchCode 
      : "All Branches";

    const html = generatePrintHTML(report, branchName, dateFrom, dateTo);
    printWindow.document.write(html);
    printWindow.document.close();
  };

  // Export to CSV
  const handleExport = () => {
    if (!report?.entries?.length) {
      showErrorToast("No data to export");
      return;
    }

    const headers = ["Date", "Type", "Reference", "Description", "Party", "Payment Method", "Money In", "Money Out", "Running Balance", "Branch"];
    const rows = report.entries.map(e => [
      new Date(e.transaction_date).toLocaleDateString(),
      getEntryTypeLabel(e.entry_type),
      e.reference_no,
      e.description,
      e.party_name || "",
      e.payment_method || "",
      e.money_in.toString(),
      e.money_out.toString(),
      e.running_balance.toString(),
      e.branch_code || "",
    ]);

    const csv = [headers.join(","), ...rows.map(r => r.map(c => `"${c}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cashbook_${dateFrom}_to_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showSuccessToast("Cashbook exported successfully");
  };

  const columns: GridColDef[] = [
    {
      field: "transaction_date",
      headerName: "Date",
      width: 150,
      valueFormatter: (value) => new Date(value).toLocaleString(),
    },
    {
      field: "entry_type",
      headerName: "Type",
      width: 150,
      renderCell: (params) => (
        <Chip
          label={getEntryTypeLabel(params.value)}
          color={getEntryTypeColor(params.value)}
          size="small"
        />
      ),
    },
    { field: "reference_no", headerName: "Reference", width: 140 },
    { field: "description", headerName: "Description", width: 180, flex: 1 },
    { field: "party_name", headerName: "Party", width: 140 },
    { field: "payment_method", headerName: "Payment", width: 110 },
    {
      field: "money_in",
      headerName: "Money In",
      width: 120,
      align: "right",
      headerAlign: "right",
      renderCell: (params) =>
        params.value > 0 ? (
          <Typography color="success.main" fontWeight="medium">
            <TCurrency value={params.value} showSymbol={false} />
          </Typography>
        ) : (
          "-"
        ),
    },
    {
      field: "money_out",
      headerName: "Money Out",
      width: 120,
      align: "right",
      headerAlign: "right",
      renderCell: (params) =>
        params.value > 0 ? (
          <Typography color="error.main" fontWeight="medium">
            <TCurrency value={params.value} showSymbol={false} />
          </Typography>
        ) : (
          "-"
        ),
    },
    {
      field: "running_balance",
      headerName: "Balance",
      width: 130,
      align: "right",
      headerAlign: "right",
      renderCell: (params) => (
        <Typography 
          fontWeight="medium"
          color={params.value >= 0 ? "text.primary" : "error.main"}
        >
          <TCurrency value={params.value} showSymbol={false} />
        </Typography>
      ),
    },
    { field: "branch_code", headerName: "Branch", width: 90 },
  ];

  return (
    <Box sx={{ overflow: "auto" }}>
      <TPageHeader 
        title="Cashbook" 
        actions={
          <Box sx={{ display: "flex", gap: 1 }}>
            <Tooltip title="Export to CSV">
              <Button
                variant="outlined"
                size="small"
                startIcon={<FileDownloadIcon />}
                onClick={handleExport}
                disabled={!report?.entries?.length}
              >
                Export
              </Button>
            </Tooltip>
            <Tooltip title="Print Report">
              <Button
                variant="outlined"
                size="small"
                startIcon={<PrintIcon />}
                onClick={handlePrint}
                disabled={!report?.entries?.length}
              >
                Print
              </Button>
            </Tooltip>
          </Box>
        }
      />

      {/* Summary Cards - Main */}
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 2, mb: 2 }}>
        <Card>
          <CardContent>
            <Typography color="text.secondary" variant="body2">
              Opening Balance
            </Typography>
            <Typography variant="h5">
              <TCurrency value={report?.summary?.opening_balance || 0} />
            </Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography color="text.secondary" variant="body2">
              Total Money In
            </Typography>
            <Typography variant="h5" color="success.main">
              <TCurrency value={report?.summary?.total_money_in || 0} />
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {report?.entry_count || 0} transactions
            </Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography color="text.secondary" variant="body2">
              Total Money Out
            </Typography>
            <Typography variant="h5" color="error.main">
              <TCurrency value={report?.summary?.total_money_out || 0} />
            </Typography>
          </CardContent>
        </Card>
        <Card sx={{ bgcolor: "primary.50", borderColor: "primary.200", borderWidth: 1, borderStyle: "solid" }}>
          <CardContent>
            <Typography color="text.secondary" variant="body2">
              Closing Balance
            </Typography>
            <Typography variant="h5" color="primary.main" fontWeight="bold">
              <TCurrency value={report?.summary?.closing_balance || 0} />
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Net: <TCurrency value={report?.summary?.net_movement || 0} />
            </Typography>
          </CardContent>
        </Card>
      </Box>

      {/* Breakdown Section - Collapsible */}
      <Paper sx={{ mb: 2, p: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: showBreakdown ? 2 : 0 }}>
          <Typography variant="subtitle2" fontWeight="medium">
            Transaction Breakdown
          </Typography>
          <IconButton size="small" onClick={() => setShowBreakdown(!showBreakdown)}>
            {showBreakdown ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        </Box>
        <Collapse in={showBreakdown}>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 2 }}>
            {/* Money IN breakdown */}
            <BreakdownCard
              icon={<ReceiptIcon color="success" />}
              label="Invoice Receipts"
              amount={report?.summary?.invoice_receipts || 0}
              count={report?.summary?.invoice_receipts_count || 0}
              color="success"
            />
            <BreakdownCard
              icon={<PaymentsIcon color="info" />}
              label="Customer Advances"
              amount={report?.summary?.customer_advances || 0}
              count={report?.summary?.customer_advances_count || 0}
              color="info"
            />
            <BreakdownCard
              icon={<CreditCardIcon color="primary" />}
              label="Credit Settlements"
              amount={report?.summary?.customer_credit_settlements || 0}
              count={report?.summary?.customer_credit_settlements_count || 0}
              color="primary"
            />
            {/* Money OUT breakdown */}
            <BreakdownCard
              icon={<MoneyOffIcon color="warning" />}
              label="Supplier Payments"
              amount={report?.summary?.supplier_payments || 0}
              count={report?.summary?.supplier_payments_count || 0}
              color="warning"
              isOut
            />
            <BreakdownCard
              icon={<SavingsIcon color="error" />}
              label="Expenses"
              amount={report?.summary?.expenses || 0}
              count={report?.summary?.expenses_count || 0}
              color="error"
              isOut
            />
            <BreakdownCard
              icon={<AccountBalanceIcon color="secondary" />}
              label="Bank Deposits"
              amount={report?.summary?.bank_deposits || 0}
              count={report?.summary?.bank_deposits_count || 0}
              color="secondary"
              isOut
            />
          </Box>
        </Collapse>
      </Paper>

      {/* Date Range Quick Filters */}
      <Box sx={{ mb: 2 }}>
        <ButtonGroup size="small" variant="outlined">
          <Button 
            variant={datePreset === "today" ? "contained" : "outlined"}
            onClick={() => handleDatePresetChange("today")}
          >
            Today
          </Button>
          <Button 
            variant={datePreset === "thisWeek" ? "contained" : "outlined"}
            onClick={() => handleDatePresetChange("thisWeek")}
          >
            This Week
          </Button>
          <Button 
            variant={datePreset === "thisMonth" ? "contained" : "outlined"}
            onClick={() => handleDatePresetChange("thisMonth")}
          >
            This Month
          </Button>
          <Button 
            variant={datePreset === "lastMonth" ? "contained" : "outlined"}
            onClick={() => handleDatePresetChange("lastMonth")}
          >
            Last Month
          </Button>
          <Button 
            variant={datePreset === "last30Days" ? "contained" : "outlined"}
            onClick={() => handleDatePresetChange("last30Days")}
          >
            Last 30 Days
          </Button>
          <Button 
            variant={datePreset === "custom" ? "contained" : "outlined"}
            onClick={() => setDatePreset("custom")}
          >
            Custom
          </Button>
        </ButtonGroup>
      </Box>

      {/* Filters - Single Row */}
      <Box sx={{ mb: 2, display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center" }}>
        <TextField
          label="From Date"
          type="date"
          size="small"
          value={dateFrom}
          onChange={(e) => handleCustomDateChange("from", e.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ width: 160 }}
        />
        <TextField
          label="To Date"
          type="date"
          size="small"
          value={dateTo}
          onChange={(e) => handleCustomDateChange("to", e.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ width: 160 }}
        />
        <TextField
          select
          label="Entry Type"
          size="small"
          value={entryType}
          onChange={(e) => setEntryType(e.target.value as CashbookEntryType | "")}
          sx={{ width: 180 }}
        >
          {ENTRY_TYPES.map((t) => (
            <MenuItem key={t.value} value={t.value}>
              {t.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Payment Method"
          size="small"
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
          sx={{ width: 150 }}
        >
          {PAYMENT_METHODS.map((m) => (
            <MenuItem key={m.value} value={m.value}>
              {m.label}
            </MenuItem>
          ))}
        </TextField>
        <Box sx={{ minWidth: 280 }}>
          <TBranchFilter
            branches={branches}
            value={branchCode}
            onChange={setBranchCode}
          />
        </Box>
      </Box>

      {/* Data Grid */}
      <Paper sx={{ height: 500 }}>
        <DataGrid
          rows={report?.entries || []}
          columns={columns}
          loading={isLoading}
          getRowId={(row) => `${row.source_table}-${row.source_id}`}
          initialState={{
            sorting: {
              sortModel: [{ field: "transaction_date", sort: "desc" }],
            },
          }}
          sx={{
            "& .MuiDataGrid-row:hover": {
              bgcolor: "action.hover",
            },
          }}
        />
      </Paper>
    </Box>
  );
}

// Breakdown card sub-component
interface BreakdownCardProps {
  icon: React.ReactNode;
  label: string;
  amount: number;
  count: number;
  color: "success" | "info" | "primary" | "warning" | "error" | "secondary";
  isOut?: boolean;
}

function BreakdownCard({ icon, label, amount, count, color, isOut }: BreakdownCardProps) {
  return (
    <Box sx={{ 
      p: 1.5, 
      borderRadius: 1, 
      bgcolor: `${color}.50`,
      border: 1,
      borderColor: `${color}.100`,
    }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
        {icon}
        <Typography variant="caption" color="text.secondary" noWrap>
          {label}
        </Typography>
      </Box>
      <Typography variant="body1" fontWeight="medium" color={isOut ? "error.main" : "success.main"}>
        {isOut ? "-" : "+"}<TCurrency value={amount} showSymbol={false} />
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {count} {count === 1 ? "entry" : "entries"}
      </Typography>
    </Box>
  );
}

// Generate print HTML
function generatePrintHTML(report: CashbookReport, branchName: string, dateFrom: string, dateTo: string): string {
  const entriesHTML = report.entries.map(e => `
    <tr>
      <td>${new Date(e.transaction_date).toLocaleDateString()}</td>
      <td>${getEntryTypeLabel(e.entry_type)}</td>
      <td>${e.reference_no}</td>
      <td>${e.description}</td>
      <td>${e.party_name || "-"}</td>
      <td>${e.payment_method || "-"}</td>
      <td style="text-align: right; color: green;">${e.money_in > 0 ? e.money_in.toFixed(2) : "-"}</td>
      <td style="text-align: right; color: red;">${e.money_out > 0 ? e.money_out.toFixed(2) : "-"}</td>
      <td style="text-align: right; font-weight: bold;">${e.running_balance.toFixed(2)}</td>
    </tr>
  `).join("");

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Cashbook Report</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; font-size: 12px; }
        h1 { text-align: center; margin-bottom: 5px; }
        .header-info { text-align: center; margin-bottom: 20px; color: #666; }
        .summary { display: flex; justify-content: space-around; margin-bottom: 20px; padding: 15px; background: #f5f5f5; border-radius: 8px; }
        .summary-item { text-align: center; }
        .summary-label { font-size: 11px; color: #666; }
        .summary-value { font-size: 16px; font-weight: bold; }
        .money-in { color: green; }
        .money-out { color: red; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ddd; padding: 6px; text-align: left; }
        th { background-color: #f5f5f5; font-weight: bold; }
        tr:nth-child(even) { background-color: #fafafa; }
        .footer { margin-top: 20px; text-align: center; font-size: 10px; color: #999; }
        @media print {
          body { margin: 0; }
          .no-print { display: none; }
        }
      </style>
    </head>
    <body>
      <h1>Cashbook Report</h1>
      <div class="header-info">
        <p>Branch: ${branchName} | Period: ${dateFrom} to ${dateTo}</p>
        <p>Generated: ${new Date().toLocaleString()}</p>
      </div>
      
      <div class="summary">
        <div class="summary-item">
          <div class="summary-label">Opening Balance</div>
          <div class="summary-value">${report.summary.opening_balance.toFixed(2)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Total Money In</div>
          <div class="summary-value money-in">+${report.summary.total_money_in.toFixed(2)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Total Money Out</div>
          <div class="summary-value money-out">-${report.summary.total_money_out.toFixed(2)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Closing Balance</div>
          <div class="summary-value">${report.summary.closing_balance.toFixed(2)}</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Reference</th>
            <th>Description</th>
            <th>Party</th>
            <th>Payment</th>
            <th style="text-align: right;">Money In</th>
            <th style="text-align: right;">Money Out</th>
            <th style="text-align: right;">Balance</th>
          </tr>
        </thead>
        <tbody>
          ${entriesHTML}
        </tbody>
      </table>
      
      <div class="footer">
        Total Entries: ${report.entry_count} | Net Movement: ${report.summary.net_movement.toFixed(2)}
      </div>
      
      <script>window.onload = function() { window.print(); }</script>
    </body>
    </html>
  `;
}
