/**
 * CashbookPage — every cash/bank movement for a period with running balance.
 *
 * Same layout as the other report pages: quick-date buttons and filters in the
 * header row, Export / Print next to refresh, totals in a form section and the
 * entries in a full-height grid.
 */

import { useMemo, useState } from "react";
import { exportToCSV } from "@/utils/csvExport";
import { useQuery } from "@tanstack/react-query";
import { Box, Typography, TextField, Button, ButtonGroup, Tooltip } from "@mui/material";
import PrintIcon from "@mui/icons-material/Print";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import {
  FormSection,
  MasterDetailLayout,
  TChip,
  TCurrency,
  TBranchFilter,
  TDataGrid,
  type TDataGridColumn,
  TSearchableSelect,
  showErrorToast,
  showSuccessToast,
  fmtLKR,
} from "@/components/tijaero";
import { cashbookApi } from "@/modules/finance/api";
import { CashbookEntryType, CashbookReport } from "@/modules/finance/types";
import { useReferenceData } from "@/hooks";
import { escapeHtml } from "@/utils/escapeHtml";


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
  { value: "sale_return_refund", label: "Sale Return Refunds" },
  { value: "voucher_refund", label: "Voucher Refunds" },
  { value: "grn_payment", label: "GRN Payments" },
  { value: "purchase_return", label: "Purchase Return Refunds" },
  { value: "supplier_advance_return", label: "Supplier Advance Returns" },
  { value: "landed_cost", label: "Landed Costs" },
  { value: "payroll", label: "Payroll" },
  { value: "statutory_payment", label: "Statutory Payments" },
  { value: "reimbursement", label: "Reimbursements" },
  { value: "commission_payment", label: "Commission Payments" },
  { value: "petty_cash", label: "Petty Cash" },
  { value: "journal_entry", label: "Journal Entries" },
  { value: "fixed_asset", label: "Fixed Assets" },
  { value: "cheque_bounce", label: "Bounced Cheques" },
  { value: "bank_statement", label: "Bank Statement Items" },
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
  if (found) return found.label;
  // Unknown source: "gl_some_thing" -> "Some thing"
  const words = String(type || "").replace(/^gl_/, "").replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "-";
};

type CashbookEntry = CashbookReport["entries"][number];

const PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "thisWeek", label: "This Week" },
  { value: "thisMonth", label: "This Month" },
  { value: "lastMonth", label: "Last Month" },
  { value: "last30Days", label: "Last 30 Days" },
  { value: "custom", label: "Custom" },
];

const amountCell = (value: number, color: string) => (
  <Box sx={{ width: "100%", display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
    {value > 0 ? (
      <TCurrency value={value} showSymbol={false} variant="body2" fontWeight={600} sx={{ color, lineHeight: 1.2 }} />
    ) : (
      <Typography variant="body2" sx={{ lineHeight: 1.2 }}>-</Typography>
    )}
  </Box>
);

function Figure({ label, value, color, hint }: { label: string; value: number; color?: string; hint?: React.ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <TCurrency value={value} variant="subtitle1" fontWeight={700} sx={{ color }} />
      {hint && (
        <Typography variant="caption" color="text.secondary" component="div">
          {hint}
        </Typography>
      )}
    </Box>
  );
}

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

  const { filteredBranches } = useReferenceData(["branches"]);
  const branches = filteredBranches || [];

  const { data: report, isLoading, isFetching, refetch } = useQuery({
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

  // Newest first by default (the grid's column menu can re-sort).
  const entries = useMemo(
    () =>
      [...(report?.entries ?? [])].sort(
        (a, b) => new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime(),
      ),
    [report],
  );

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

    exportToCSV({ filename: `cashbook_${dateFrom}_to_${dateTo}`, headers, rows });
    showSuccessToast("Cashbook exported successfully");
  };

  const columns: TDataGridColumn<CashbookEntry>[] = [
    {
      field: "transaction_date",
      header: "Date",
      width: 170,
      renderCell: (p) => new Date(p.row.transaction_date).toLocaleString(),
    },
    {
      field: "entry_type",
      header: "Type",
      width: 160,
      renderCell: (p) => (
        <TChip label={getEntryTypeLabel(p.row.entry_type)} color={getEntryTypeColor(p.row.entry_type)} size="small" />
      ),
    },
    { field: "reference_no", header: "Reference", width: 140 },
    { field: "description", header: "Description", minWidth: 180, flex: 1 },
    { field: "party_name", header: "Party", width: 140 },
    { field: "payment_method", header: "Payment", width: 110, renderCell: (p) => p.row.payment_method || "-" },
    {
      field: "money_in",
      header: "Money In",
      width: 130,
      align: "right",
      headerAlign: "right",
      renderCell: (p) => amountCell(p.row.money_in, "success.main"),
    },
    {
      field: "money_out",
      header: "Money Out",
      width: 130,
      align: "right",
      headerAlign: "right",
      renderCell: (p) => amountCell(p.row.money_out, "error.main"),
    },
    {
      field: "running_balance",
      header: "Balance",
      width: 140,
      align: "right",
      headerAlign: "right",
      renderCell: (p) => (
        <TCurrency
          value={p.row.running_balance}
          showSymbol={false}
          variant="body2"
          fontWeight={600}
          sx={{ width: "100%", textAlign: "right", color: p.row.running_balance >= 0 ? "text.primary" : "error.main" }}
        />
      ),
    },
    { field: "branch_code", header: "Branch", width: 90, renderCell: (p) => p.row.branch_code || "-" },
  ];

  const hasEntries = !!report?.entries?.length;

  return (
    <MasterDetailLayout
      title="Cashbook"
      titleSlot={
        // On a phone the preset buttons scroll sideways instead of being clipped
        // (the layout moves Export/Print to their own row there).
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
          <ButtonGroup
            size="small"
            variant="outlined"
            sx={{ flexShrink: 0, maxWidth: "100%", overflowX: "auto", "& .MuiButton-root": { flexShrink: 0 } }}
          >
            {PRESETS.map((p) => (
              <Button
                key={p.value}
                variant={datePreset === p.value ? "contained" : "outlined"}
                onClick={() => (p.value === "custom" ? setDatePreset("custom") : handleDatePresetChange(p.value))}
                sx={{ textTransform: "none" }}
              >
                {p.label}
              </Button>
            ))}
          </ButtonGroup>
          <TextField
            type="date"
            size="small"
            value={dateFrom}
            onChange={(e) => handleCustomDateChange("from", e.target.value)}
            inputProps={{ "aria-label": "From date" }}
            sx={{ width: 150, flexShrink: 0 }}
          />
          <TextField
            type="date"
            size="small"
            value={dateTo}
            onChange={(e) => handleCustomDateChange("to", e.target.value)}
            inputProps={{ "aria-label": "To date" }}
            sx={{ width: 150, flexShrink: 0 }}
          />
          <Box sx={{ width: 170, flexShrink: 0 }}>
            <TSearchableSelect
              label=""
              value={entryType || null}
              onChange={(v) => setEntryType(((v as CashbookEntryType | null) ?? "") as CashbookEntryType | "")}
              options={ENTRY_TYPES.filter((t) => t.value).map((t) => ({ value: t.value, label: t.label }))}
              showAllOption
              allOptionLabel="All Transactions"
              placeholder="Search type..."
              size="small"
            />
          </Box>
          <Box sx={{ width: 150, flexShrink: 0 }}>
            <TSearchableSelect
              label=""
              value={paymentMethod || null}
              onChange={(v) => setPaymentMethod((v as string | null) ?? "")}
              options={PAYMENT_METHODS.filter((m) => m.value)}
              showAllOption
              allOptionLabel="All Methods"
              placeholder="Search method..."
              size="small"
            />
          </Box>
          <Box sx={{ width: 150, flexShrink: 0 }}>
            <TBranchFilter branches={branches} value={branchCode} onChange={setBranchCode} label="" size="small" />
          </Box>
        </Box>
      }
      headerActions={
        <>
          <Tooltip title="Export to CSV">
            <span>
              <Button variant="outlined" size="small" startIcon={<FileDownloadIcon />} onClick={handleExport} disabled={!hasEntries}>
                Export CSV
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="Print report">
            <span>
              <Button
                variant="contained"
                size="small"
                startIcon={<PrintIcon />}
                onClick={handlePrint}
                disabled={!hasEntries}
                sx={{ mr: 1 }}
              >
                Print
              </Button>
            </span>
          </Tooltip>
        </>
      }
      onRefresh={() => refetch()}
      isLoading={isFetching}
    >
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5, display: "flex", flexDirection: "column" }}>
        <FormSection title="Summary" columns={4}>
          <Figure label="Opening Balance" value={report?.summary?.opening_balance || 0} />
          <Figure
            label="Total Money In"
            value={report?.summary?.total_money_in || 0}
            color="success.main"
            hint={`${report?.entry_count || 0} transactions`}
          />
          <Figure label="Total Money Out" value={report?.summary?.total_money_out || 0} color="error.main" />
          <Figure
            label="Closing Balance"
            value={report?.summary?.closing_balance || 0}
            color="primary.main"
            hint={
              <Box component="span" sx={{ display: "inline-flex", gap: 0.5 }}>
                Net movement: <TCurrency value={report?.summary?.net_movement || 0} component="span" variant="caption" />
              </Box>
            }
          />
        </FormSection>
        <Box sx={{ flex: 1, minHeight: 400, display: "flex" }}>
          <TDataGrid<CashbookEntry>
            rows={entries}
            columns={columns}
            loading={isLoading}
            getRowId={(row) => row.id}
            pageSizeOptions={[25, 50, 100]}
            pageSize={50}
            emptyMessage="No cashbook entries for these filters"
            autoHeight={false}
            height="100%"
          />
        </Box>
      </Box>
    </MasterDetailLayout>
  );
}

// Generate print HTML
function generatePrintHTML(report: CashbookReport, branchName: string, dateFrom: string, dateTo: string): string {
  const entriesHTML = report.entries.map(e => `
    <tr>
      <td>${new Date(e.transaction_date).toLocaleDateString()}</td>
      <td>${escapeHtml(getEntryTypeLabel(e.entry_type))}</td>
      <td>${escapeHtml(e.reference_no)}</td>
      <td>${escapeHtml(e.description)}</td>
      <td>${escapeHtml(e.party_name || "-")}</td>
      <td>${escapeHtml(e.payment_method || "-")}</td>
      <td style="text-align: right; color: green;">${e.money_in > 0 ? fmtLKR(e.money_in) : "-"}</td>
      <td style="text-align: right; color: red;">${e.money_out > 0 ? fmtLKR(e.money_out) : "-"}</td>
      <td style="text-align: right; font-weight: bold;">${fmtLKR(e.running_balance)}</td>
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
        <p>Branch: ${escapeHtml(branchName)} | Period: ${escapeHtml(dateFrom)} to ${escapeHtml(dateTo)}</p>
        <p>Generated: ${new Date().toLocaleString()}</p>
      </div>
      
      <div class="summary">
        <div class="summary-item">
          <div class="summary-label">Opening Balance</div>
          <div class="summary-value">${fmtLKR(report.summary.opening_balance)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Total Money In</div>
          <div class="summary-value money-in">+${fmtLKR(report.summary.total_money_in)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Total Money Out</div>
          <div class="summary-value money-out">-${fmtLKR(report.summary.total_money_out)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Closing Balance</div>
          <div class="summary-value">${fmtLKR(report.summary.closing_balance)}</div>
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
        Total Entries: ${report.entry_count} | Net Movement: ${fmtLKR(report.summary.net_movement)}
      </div>
      
      <script>window.onload = function() { window.print(); }</script>
    </body>
    </html>
  `;
}
