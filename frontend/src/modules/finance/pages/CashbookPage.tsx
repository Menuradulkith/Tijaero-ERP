/**
 * CashbookPage — every cash AND bank movement for a period with running balance.
 *
 * The cashier's first question is "how much cash do I have?", so the summary
 * splits the closing balance into cash in hand and bank. Descriptions are shown
 * in plain words ("Expense EXP-001 – Utilities") instead of the stored
 * "Auto GL - … | … ID: 2966" posting text (which the ledger still uses).
 *
 * Same layout as the other report pages: quick-date buttons and filters in the
 * header row, Print next to refresh (Export is in the table footer), totals in
 * a form section and the entries in a full-height grid.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Box, Typography, Button, ButtonGroup, Tooltip } from "@mui/material";
import PrintIcon from "@mui/icons-material/Print";
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
  fmtLKR,
  EXPENSE_CATEGORIES,
  TDatePicker,
} from "@/components/tijaero";
import { cashbookApi } from "@/modules/finance/api";
import { CashbookEntryType, CashbookReport } from "@/modules/finance/types";
import { useReferenceData } from "@/hooks";
import { escapeHtml } from "@/utils/escapeHtml";
import {
  daysAgoISO,
  displayDate,
  localDateISO,
  startOfMonthISO,
  startOfWeekISO,
  todayISO,
} from "@/utils/formatters";

// Date range quick filter options
type DateRangePreset = "today" | "thisWeek" | "thisMonth" | "lastMonth" | "last30Days" | "custom";

// Local calendar dates (not UTC): "today" is today in Sri Lanka even before 05:30.
const getDateRangeFromPreset = (preset: DateRangePreset): { from: string; to: string } => {
  const today = new Date();
  const toStr = todayISO();
  switch (preset) {
    case "today":
      return { from: toStr, to: toStr };
    case "thisWeek":
      return { from: startOfWeekISO(today), to: toStr };
    case "lastMonth":
      return {
        from: localDateISO(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        to: localDateISO(new Date(today.getFullYear(), today.getMonth(), 0)),
      };
    case "last30Days":
      return { from: daysAgoISO(30, today), to: toStr };
    case "thisMonth":
    default:
      return { from: startOfMonthISO(today), to: toStr };
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
      return "success"; // Green - Money IN
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

// ─── Plain descriptions ──────────────────────────────────────────────────────
// Automatic postings store "Auto GL - Expense | Expense: EXP-1 | Category: utilities |
// Amount: 500 | Expense ID: 2966". The ledger keeps that text; here we show
// "Expense EXP-1 – Utilities".
const POSTING_KIND_LABELS: Record<string, string> = {
  "sale revenue": "Sale",
  "sale return": "Sale return refund",
  "gift voucher sale": "Gift voucher sold",
  "gift voucher refund": "Gift voucher refund",
  "gift voucher forfeited balance": "Gift voucher balance kept",
  "gift voucher expiry": "Gift voucher expired",
  "expense": "Expense",
  "expense reclassification": "Expense corrected",
  "supplier payment": "Paid supplier",
  "supplier advance": "Advance to supplier",
  "supplier advance return": "Supplier returned advance",
  "supplier invoice": "Supplier bill",
  "credit settlement": "Paid supplier balance",
  "credit settlement cancelled": "Supplier payment cancelled",
  "customer credit settlement": "Customer paid balance",
  "customer advance received": "Advance from customer",
  "customer advance application": "Advance used on invoice",
  "customer advance application reversal": "Advance use undone",
  "customer credit note issued": "Credit note to customer",
  "bank deposit verified": "Cash taken to bank",
  "commission payment": "Commission paid",
  "payroll": "Salaries paid",
  "statutory payment": "EPF / ETF paid",
  "reimbursement paid": "Staff reimbursement",
  "purchase return": "Purchase return refund",
  "grn received": "Goods received",
  "landed cost": "Landed cost",
};

// Posting kinds whose text only repeats the kind ("Petty cash replenishment"), so
// the row reads "<label> <document no.>".
const POSTING_KIND_EXTRA: Record<string, string> = {
  "petty cash": "Petty cash fund opened",
  "petty cash replenishment": "Petty cash top-up",
  "petty cash closure": "Petty cash fund closed",
  "landed cost cancelled": "Landed cost cancelled",
  "grn cancelled": "Goods received cancelled",
  "bank deposit": "Cash taken to bank",
};

// Parts that only matter to the system (ids, amounts already in the columns, split details).
const TECHNICAL_PART =
  /(\bID:|^(Amount|Refund|Cost|Discount|Total|Applied|Restored|Gross|Net|Employees|VAT|EPF|ETF|Customer ID|Method|Type|Return|Qty)\s*:|^[A-Za-z]+ (Cancel )?ID\b|^[a-z_]+:\d+$)/i;
// Case-sensitive: "TxnID: 54", "BatchID: 797", "EmployeeLoan 247 cancel", "FA Acquire 64", "EmployeeLoan 16 repay-13".
const ID_PART = /(ID\s*:|^[A-Za-z][A-Za-z ]*\s\d+(\s+[a-z][a-z0-9-]*)?$)/;
const EMPTY_VALUE = /^(none|null|undefined|-)?$/i;
// Looks like a document number: "PCF-202611-0004", "QAEF621".
const DOC_NO = /\b(?=[A-Z0-9-]*\d)[A-Z]{2,}[A-Z0-9-]{3,}\b/;

const categoryLabel = (raw: string) => {
  const key = raw.trim().toLowerCase();
  const found = EXPENSE_CATEGORIES.find((c) => c.value === key);
  if (found) return found.label;
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// "PettyCashReplenishment" -> "petty cash replenishment"
const kindWords = (kind: string) =>
  kind.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

const sentence = (text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

// Older wording kept in stored descriptions.
const WORDING: [RegExp, string][] = [
  [/^Employee salary advance/i, "Salary advance"],
  [/^Employee loan/i, "Staff loan"],
];

/**
 * Plain words for a cashbook row: "<what happened> <document no.> – <detail>".
 * Never shows internal ids, "None" or the "|" separators; falls back to
 * "<type> <reference>" when nothing readable is left.
 */
function plainDescription(raw: string | null | undefined, ref: string | null | undefined, typeLabel: string): string {
  const reference = (ref || "").trim();
  let text = (raw || "").trim();
  let label = "";
  const auto = text.match(/^Auto GL\s*-\s*(.*)$/i);
  if (auto) text = auto[1];
  const parts = text.split("|").map((p) => p.trim()).filter(Boolean);
  if (auto) {
    const kind = parts.shift() || "";
    const words = kindWords(kind);
    label = POSTING_KIND_LABELS[words] ?? POSTING_KIND_EXTRA[words] ?? sentence(words);
    // Drop text that only repeats the kind ("Petty cash fund opened - PCF-1" -> "PCF-1").
    for (let i = 0; i < parts.length; i += 1) {
      const lower = parts[i].toLowerCase();
      const prefix = [label.toLowerCase(), words].find((x) => x && lower.startsWith(x));
      if (prefix) parts[i] = parts[i].slice(prefix.length).replace(/^[\s\-–:]+/, "");
    }
  } else {
    label = parts.shift() || "";
  }
  const details = parts
    .filter((p) => !TECHNICAL_PART.test(p) && !ID_PART.test(p))
    .map((p) => {
      const kv = p.match(/^([A-Za-z ]+):\s*(.*)$/);
      if (!kv) return p;
      const [, key, value] = kv;
      return key.trim().toLowerCase() === "category" ? categoryLabel(value) : value.trim();
    })
    .map((p) => p.replace(/\bNone\b/g, "").trim())
    .filter((p) => !EMPTY_VALUE.test(p));
  label = label.replace(/\bNone\b/g, "").replace(/\s+/g, " ").trim();
  for (const [re, to] of WORDING) label = label.replace(re, to);
  if (!label && typeLabel !== "-") label = typeLabel;
  // Always name the document: add the reference when nothing else is a document number.
  if (reference && !DOC_NO.test(label) && !details.some((d) => d.includes(reference) || DOC_NO.test(d))) {
    details.unshift(reference);
  }
  if (!details.length) return label || reference || "-";
  const [first, ...rest] = details;
  const head = label ? `${label}${first === reference || DOC_NO.test(first) ? " " : " – "}${first}` : first;
  return rest.length ? `${head} – ${rest.join(" – ")}` : head;
}

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
  const [dateFrom, setDateFrom] = useState(() => startOfMonthISO());
  const [dateTo, setDateTo] = useState(() => todayISO());
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

  // Newest first by default (the grid's column menu can re-sort). Descriptions are
  // made plain here so the table and its Export show the same words.
  const entries = useMemo(
    () =>
      [...(report?.entries ?? [])]
        .sort((a, b) => new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime())
        .map((e) => ({
          ...e,
          description: plainDescription(e.description, e.reference_no, getEntryTypeLabel(e.entry_type)),
        })),
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

  const branchName = branchCode
    ? branches.find((b) => b.branch_code === branchCode)?.branch_name || branchCode
    : "All Branches";

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

    const html = generatePrintHTML(report, entries, branchName, dateFrom, dateTo);
    printWindow.document.write(html);
    printWindow.document.close();
  };

  // Widths fit a 1440 px screen with the sidebar open; Description and Party take the rest.
  const columns: TDataGridColumn<CashbookEntry>[] = [
    { field: "transaction_date", header: "Date", width: 105, type: "date" },
    {
      field: "entry_type",
      header: "Type",
      width: 125,
      renderCell: (p) => (
        <TChip label={getEntryTypeLabel(p.row.entry_type)} color={getEntryTypeColor(p.row.entry_type)} size="small" />
      ),
    },
    { field: "reference_no", header: "Reference", width: 120 },
    { field: "description", header: "Description", minWidth: 140, flex: 1.4 },
    { field: "party_name", header: "Party", minWidth: 90, flex: 0.7 },
    { field: "payment_method", header: "Cash / Bank", width: 95, renderCell: (p) => p.row.payment_method || "-" },
    {
      field: "money_in",
      header: "Money In",
      width: 105,
      align: "right",
      headerAlign: "right",
      renderCell: (p) => amountCell(p.row.money_in, "success.main"),
    },
    {
      field: "money_out",
      header: "Money Out",
      width: 105,
      align: "right",
      headerAlign: "right",
      renderCell: (p) => amountCell(p.row.money_out, "error.main"),
    },
    {
      field: "running_balance",
      header: "Balance",
      width: 125,
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
    // One branch picked: every row is that branch, so the column only takes space.
    ...(branchCode
      ? []
      : [{ field: "branch_code", header: "Branch", width: 75, renderCell: (p: { row: CashbookEntry }) => p.row.branch_code || "-" }]),
  ];

  const hasEntries = !!report?.entries?.length;
  const summary = report?.summary;
  // The cash / bank split only adds up when every kind of row is shown.
  const showSplit = !entryType && !paymentMethod && summary?.cash_closing_balance !== undefined;

  return (
    <MasterDetailLayout
      title="Cashbook"
      titleSlot={
        // On a phone the preset buttons scroll sideways instead of being clipped
        // (the layout moves Print to its own row there).
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
          <Box sx={{ flexShrink: 0 }}>
            <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.2 }}>
              Cashbook
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Cash and bank, money in and out
            </Typography>
          </Box>
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
          <TDatePicker
            size="small"
            value={dateFrom}
            onChange={(v) => handleCustomDateChange("from", v ?? "")}
            inputProps={{ "aria-label": "From date" }}
            sx={{ width: 150, flexShrink: 0 }}
          />
          <TDatePicker
            size="small"
            value={dateTo}
            onChange={(v) => handleCustomDateChange("to", v ?? "")}
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
      }
      onRefresh={() => refetch()}
      isLoading={isFetching}
    >
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5, display: "flex", flexDirection: "column" }}>
        {showSplit && (
          <FormSection title={`On ${displayDate(dateTo)} — ${branchName}`} columns={3}>
            <Figure
              label="Cash in hand"
              value={Number(summary?.cash_closing_balance || 0)}
              color="primary.main"
              hint="Notes, coins and cheques not yet banked"
            />
            <Figure label="Bank" value={Number(summary?.bank_closing_balance || 0)} hint="Bank accounts and card payments" />
            <Figure label="Cash + Bank" value={Number(summary?.closing_balance || 0)} />
          </FormSection>
        )}
        <FormSection title={`${displayDate(dateFrom)} – ${displayDate(dateTo)}`} columns={4}>
          <Figure label="Opening Balance" value={Number(summary?.opening_balance || 0)} />
          <Figure
            label="Money In"
            value={Number(summary?.total_money_in || 0)}
            color="success.main"
            hint={`${report?.entry_count || 0} transactions`}
          />
          <Figure
            label="Money Out"
            value={Number(summary?.total_money_out || 0)}
            color="error.main"
            hint={
              Number(summary?.bank_deposits || 0) > 0 ? (
                <Box component="span" sx={{ display: "inline-flex", gap: 0.5 }}>
                  incl. taken to bank: <TCurrency value={Number(summary?.bank_deposits || 0)} component="span" variant="caption" />
                </Box>
              ) : undefined
            }
          />
          <Figure
            label="Closing Balance"
            value={Number(summary?.closing_balance || 0)}
            color="primary.main"
            hint={
              <Box component="span" sx={{ display: "inline-flex", gap: 0.5 }}>
                Change: <TCurrency value={Number(summary?.net_movement || 0)} component="span" variant="caption" />
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
            exportFileName={`cashbook_${dateFrom}_to_${dateTo}`}
            autoHeight={false}
            height="100%"
          />
        </Box>
      </Box>
    </MasterDetailLayout>
  );
}

// Generate print HTML
function generatePrintHTML(
  report: CashbookReport,
  entries: CashbookEntry[],
  branchName: string,
  dateFrom: string,
  dateTo: string,
): string {
  const entriesHTML = entries.map(e => `
    <tr>
      <td>${escapeHtml(displayDate(e.transaction_date))}</td>
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

  const s = report.summary;
  const split =
    s.cash_closing_balance !== undefined
      ? `
        <div class="summary-item">
          <div class="summary-label">Cash in hand</div>
          <div class="summary-value">${fmtLKR(s.cash_closing_balance)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Bank</div>
          <div class="summary-value">${fmtLKR(s.bank_closing_balance ?? 0)}</div>
        </div>`
      : "";

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Cashbook</title>
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
      <h1>Cashbook</h1>
      <div class="header-info">
        <p>Branch: ${escapeHtml(branchName)} | Period: ${escapeHtml(displayDate(dateFrom))} to ${escapeHtml(displayDate(dateTo))}</p>
        <p>Printed: ${escapeHtml(displayDate(new Date()))} ${escapeHtml(new Date().toLocaleTimeString())}</p>
      </div>

      <div class="summary">
        <div class="summary-item">
          <div class="summary-label">Opening Balance</div>
          <div class="summary-value">${fmtLKR(s.opening_balance)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Money In</div>
          <div class="summary-value money-in">+${fmtLKR(s.total_money_in)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Money Out</div>
          <div class="summary-value money-out">-${fmtLKR(s.total_money_out)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Closing Balance</div>
          <div class="summary-value">${fmtLKR(s.closing_balance)}</div>
        </div>${split}
      </div>

      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Reference</th>
            <th>Description</th>
            <th>Party</th>
            <th>Cash / Bank</th>
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
        Total Entries: ${report.entry_count} | Change: ${fmtLKR(s.net_movement)}
      </div>

      <script>window.onload = function() { window.print(); }</script>
    </body>
    </html>
  `;
}
