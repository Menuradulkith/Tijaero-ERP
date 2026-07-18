import sys

content = """import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  FormControlLabel,
  Grid,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import AssessmentIcon from "@mui/icons-material/Assessment";
import DownloadIcon from "@mui/icons-material/Download";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import PrintIcon from "@mui/icons-material/Print";
import ReceiptIcon from "@mui/icons-material/Receipt";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import StorefrontIcon from "@mui/icons-material/Storefront";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import { reportingApi } from "@/modules/reporting/api";
import type { BranchDailySummary, BranchOption } from "@/modules/reporting/types";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    minimumFractionDigits: 2,
  }).format(n);

const today = () => new Date().toISOString().slice(0, 10);

// ─── Export to CSV Helper ──────────────────────────────────────────────────
function exportToCsv(data: BranchDailySummary[], startDate: string, endDate: string) {
  let csv = "Branch Account Summary\\n";
  csv += `Date Range: ${startDate} to ${endDate}\\n\\n`;

  data.forEach((branch) => {
    csv += `BRANCH: ${branch.branch_name} (${branch.branch_code})\\n`;
    csv += `\\n--- SALES ---\\n`;
    csv += `Invoice No,Total,Cash,Card,Bank,Credit,Cheque\\n`;
    branch.sales.details.forEach(d => {
      csv += `${d.invoice_no},${d.total},${d.cash},${d.card},${d.bank},${d.credit},${d.cheque}\\n`;
    });
    csv += `Total Sales,${branch.sales.total_gross}\\n`;

    csv += `\\n--- RETURNS ---\\n`;
    csv += `Return No,Refund Amount\\n`;
    branch.returns.details.forEach(d => {
      csv += `${d.return_no},${d.total_refund}\\n`;
    });
    csv += `Total Returns,${branch.returns.total_refunds}\\n`;
    
    csv += `\\nNet Sales,${branch.net_sales}\\n`;

    csv += `\\n--- PURCHASE ORDERS ---\\n`;
    csv += `PO No,Status,Value\\n`;
    branch.purchasing.details.forEach(d => {
      csv += `${d.po_no},${d.status},${d.value}\\n`;
    });
    csv += `Total PO Value,${branch.purchasing.total_value}\\n`;

    csv += `\\n--- CASH INFLOWS ---\\n`;
    csv += `Time,Type,Source Table,Source ID,Amount\\n`;
    branch.cash_banking.inflow_details.forEach(d => {
      csv += `${d.time},${d.type},${d.source_table},${d.source_id},${d.amount}\\n`;
    });
    csv += `Total Inflows,${branch.cash_banking.money_in}\\n`;

    csv += `\\n--- CASH OUTFLOWS ---\\n`;
    csv += `Time,Type,Source Table,Source ID,Amount\\n`;
    branch.cash_banking.outflow_details.forEach(d => {
      csv += `${d.time},${d.type},${d.source_table},${d.source_id},${d.amount}\\n`;
    });
    csv += `Total Outflows,${branch.cash_banking.money_out}\\n`;

    csv += `\\n--- BANKING ---\\n`;
    csv += `Time,Amount\\n`;
    branch.cash_banking.banking_details.forEach(d => {
      csv += `${d.time},${d.amount}\\n`;
    });
    csv += `Total Banked,${branch.cash_banking.total_banked}\\n`;

    csv += `\\n--- EXPENSES ---\\n`;
    csv += `Expense No,Type,Vendor,Amount\\n`;
    branch.expenses.details.forEach(d => {
      csv += `${d.expense_no},${d.type},${d.vendor},${d.amount}\\n`;
    });
    csv += `Total Expenses,${branch.expenses.total}\\n`;

    csv += `\\n--- VOUCHERS ---\\n`;
    csv += `Voucher No,Type,Amount\\n`;
    branch.vouchers.details.forEach(d => {
      csv += `${d.voucher_no},${d.type},${d.amount}\\n`;
    });
    csv += `Total Vouchers,${branch.vouchers.total}\\n`;

    csv += `\\nCash In Hand (EOD),${branch.cash_banking.cash_in_hand_eod}\\n`;
    csv += `Petty Cash Balance,${branch.cash_banking.petty_cash_balance}\\n`;
    csv += `\\n=========================================\\n\\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `Branch_Summary_${startDate}_to_${endDate}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ─── Expandable Row Component ──────────────────────────────────────────────
interface ExpandableRowProps {
  label: string;
  value: string;
  bold?: boolean;
  children: React.ReactNode;
  expandable?: boolean;
}

function ExpandableRow({ label, value, bold, children, expandable = true }: ExpandableRowProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{
          py: 0.5,
          cursor: expandable ? "pointer" : "default",
          "&:hover": expandable ? { bgcolor: "action.hover", borderRadius: 1 } : {},
        }}
        onClick={() => expandable && setOpen(!open)}
      >
        <Stack direction="row" alignItems="center" spacing={0.5}>
          {expandable && (
            <IconButton size="small" sx={{ p: 0.25 }} className="no-print">
              {open ? <KeyboardArrowUpIcon fontSize="small" /> : <KeyboardArrowDownIcon fontSize="small" />}
            </IconButton>
          )}
          {!expandable && <Box sx={{ width: 24 }} className="no-print" />}
          <Typography variant="body2" color="text.secondary" sx={{ userSelect: "none", fontWeight: bold ? 700 : 400 }}>
            {label}
          </Typography>
        </Stack>
        <Typography variant="body2" fontWeight={bold ? 700 : 500}>
          {value}
        </Typography>
      </Stack>
      <Collapse in={open} timeout="auto" unmountOnExit sx={{
        "@media print": {
          height: "auto !important",
          visibility: "visible !important",
          display: "block !important",
        }
      }}>
        <Box sx={{ pl: 4, pr: 1, pb: 1, "@media print": { pl: 1 } }}>
          {children}
        </Box>
      </Collapse>
    </>
  );
}

// ─── Data Tables for Expandable Rows ─────────────────────────────────────────

function SalesTable({ data }: { data: BranchDailySummary["sales"]["details"] }) {
  if (data.length === 0) return <Typography variant="caption" color="text.secondary">No invoices</Typography>;
  return (
    <Table size="small" sx={{ "& td, & th": { fontSize: "0.75rem", p: 0.5 } }}>
      <TableHead>
        <TableRow>
          <TableCell>Invoice</TableCell>
          <TableCell align="right">Cash</TableCell>
          <TableCell align="right">Card</TableCell>
          <TableCell align="right">Bank</TableCell>
          <TableCell align="right">Total</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {data.map(r => (
          <TableRow key={r.invoice_no}>
            <TableCell>{r.invoice_no}</TableCell>
            <TableCell align="right">{fmt(r.cash)}</TableCell>
            <TableCell align="right">{fmt(r.card)}</TableCell>
            <TableCell align="right">{fmt(r.bank)}</TableCell>
            <TableCell align="right"><b>{fmt(r.total)}</b></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ReturnsTable({ data }: { data: BranchDailySummary["returns"]["details"] }) {
  if (data.length === 0) return <Typography variant="caption" color="text.secondary">No returns</Typography>;
  return (
    <Table size="small" sx={{ "& td, & th": { fontSize: "0.75rem", p: 0.5 } }}>
      <TableHead>
        <TableRow>
          <TableCell>Return No</TableCell>
          <TableCell align="right">Refund</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {data.map(r => (
          <TableRow key={r.return_no}>
            <TableCell>{r.return_no}</TableCell>
            <TableCell align="right">{fmt(r.total_refund)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function POTable({ data }: { data: BranchDailySummary["purchasing"]["details"] }) {
  if (data.length === 0) return <Typography variant="caption" color="text.secondary">No POs</Typography>;
  return (
    <Table size="small" sx={{ "& td, & th": { fontSize: "0.75rem", p: 0.5 } }}>
      <TableHead>
        <TableRow>
          <TableCell>PO No</TableCell>
          <TableCell>Status</TableCell>
          <TableCell align="right">Value</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {data.map(r => (
          <TableRow key={r.po_no}>
            <TableCell>{r.po_no}</TableCell>
            <TableCell>{r.status}</TableCell>
            <TableCell align="right">{fmt(r.value)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function CashFlowTable({ data }: { data: any[] }) {
  if (data.length === 0) return <Typography variant="caption" color="text.secondary">No transactions</Typography>;
  return (
    <Table size="small" sx={{ "& td, & th": { fontSize: "0.75rem", p: 0.5 } }}>
      <TableHead>
        <TableRow>
          <TableCell>Type</TableCell>
          <TableCell>Ref (Table/ID)</TableCell>
          <TableCell align="right">Amount</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {data.map((r, i) => (
          <TableRow key={i}>
            <TableCell>{r.type}</TableCell>
            <TableCell>{r.source_table} #{r.source_id}</TableCell>
            <TableCell align="right">{fmt(r.amount)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function BankingTable({ data }: { data: BranchDailySummary["cash_banking"]["banking_details"] }) {
  if (data.length === 0) return <Typography variant="caption" color="text.secondary">No deposits</Typography>;
  return (
    <Table size="small" sx={{ "& td, & th": { fontSize: "0.75rem", p: 0.5 } }}>
      <TableHead>
        <TableRow>
          <TableCell>Time</TableCell>
          <TableCell align="right">Amount</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {data.map((r, i) => (
          <TableRow key={i}>
            <TableCell>{new Date(r.time).toLocaleTimeString()}</TableCell>
            <TableCell align="right">{fmt(r.amount)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ExpensesTable({ data }: { data: BranchDailySummary["expenses"]["details"] }) {
  if (data.length === 0) return <Typography variant="caption" color="text.secondary">No expenses</Typography>;
  return (
    <Table size="small" sx={{ "& td, & th": { fontSize: "0.75rem", p: 0.5 } }}>
      <TableHead>
        <TableRow>
          <TableCell>Expense No</TableCell>
          <TableCell>Type / Vendor</TableCell>
          <TableCell align="right">Amount</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {data.map((r, i) => (
          <TableRow key={i}>
            <TableCell>{r.expense_no}</TableCell>
            <TableCell>{r.type} {r.vendor && `(${r.vendor})`}</TableCell>
            <TableCell align="right">{fmt(r.amount)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function VouchersTable({ data }: { data: BranchDailySummary["vouchers"]["details"] }) {
  if (data.length === 0) return <Typography variant="caption" color="text.secondary">No vouchers</Typography>;
  return (
    <Table size="small" sx={{ "& td, & th": { fontSize: "0.75rem", p: 0.5 } }}>
      <TableHead>
        <TableRow>
          <TableCell>Voucher No</TableCell>
          <TableCell>Type</TableCell>
          <TableCell align="right">Amount</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {data.map((r, i) => (
          <TableRow key={i}>
            <TableCell>{r.voucher_no}</TableCell>
            <TableCell>{r.type}</TableCell>
            <TableCell align="right">{fmt(r.amount)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ─── Per-branch summary card ─────────────────────────────────────────────────
function BranchCard({ data }: { data: BranchDailySummary }) {
  return (
    <Card
      variant="outlined"
      sx={{
        mb: 3,
        borderRadius: 2,
        boxShadow: "0 2px 8px rgba(0,0,0,.08)",
        "@media print": { breakInside: "avoid", mb: 2, boxShadow: "none" },
      }}
    >
      <Box sx={{ bgcolor: "primary.main", px: 3, py: 1.5, borderRadius: "8px 8px 0 0" }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <StorefrontIcon sx={{ color: "white", fontSize: 20 }} />
          <Typography variant="h6" fontWeight={700} color="white">
            {data.branch_name}
          </Typography>
          <Chip
            label={data.branch_code}
            size="small"
            sx={{ bgcolor: "rgba(255,255,255,0.2)", color: "white", fontWeight: 600 }}
          />
        </Stack>
      </Box>

      <CardContent sx={{ pt: 2 }}>
        <Grid container spacing={2}>
          {/* Sales */}
          <Grid item xs={12} md={4}>
            <Stack direction="row" spacing={1} alignItems="center" mb={1}>
              <TrendingUpIcon color="success" fontSize="small" />
              <Typography variant="subtitle2" fontWeight={700} color="success.main">
                Sales & Returns
              </Typography>
            </Stack>
            
            <ExpandableRow label={`Total Sales (${data.sales.invoice_count} invoices)`} value={fmt(data.sales.total_gross)} bold>
              <SalesTable data={data.sales.details} />
            </ExpandableRow>
            
            <ExpandableRow label="Total Returns" value={`- ${fmt(data.returns.total_refunds)}`} expandable={data.returns.total_refunds > 0}>
              <ReturnsTable data={data.returns.details} />
            </ExpandableRow>
            
            <Divider sx={{ my: 1 }} />
            <ExpandableRow label="Net Sales" value={fmt(data.net_sales)} bold expandable={false}>
              <></>
            </ExpandableRow>
          </Grid>

          {/* POs & Expenses */}
          <Grid item xs={12} md={4}>
            <Stack direction="row" spacing={1} alignItems="center" mb={1}>
              <ShoppingCartIcon color="warning" fontSize="small" />
              <Typography variant="subtitle2" fontWeight={700} color="warning.main">
                Purchasing & Expenses
              </Typography>
            </Stack>
            
            <ExpandableRow label={`Purchase Orders (${data.purchasing.po_count} POs)`} value={fmt(data.purchasing.total_value)} bold expandable={data.purchasing.po_count > 0}>
              <POTable data={data.purchasing.details} />
            </ExpandableRow>

            <ExpandableRow label="Total Expenses" value={fmt(data.expenses.total)} bold expandable={data.expenses.total > 0}>
              <ExpensesTable data={data.expenses.details} />
            </ExpandableRow>

            <ExpandableRow label="Payment Vouchers" value={fmt(data.vouchers.total)} bold expandable={data.vouchers.total > 0}>
              <VouchersTable data={data.vouchers.details} />
            </ExpandableRow>
          </Grid>

          {/* Cash & Banking */}
          <Grid item xs={12} md={4}>
            <Stack direction="row" spacing={1} alignItems="center" mb={1}>
              <AccountBalanceIcon color="primary" fontSize="small" />
              <Typography variant="subtitle2" fontWeight={700} color="primary.main">
                Cash & Banking
              </Typography>
            </Stack>
            
            <ExpandableRow label="Inflows" value={fmt(data.cash_banking.money_in)} expandable={data.cash_banking.money_in > 0}>
              <CashFlowTable data={data.cash_banking.inflow_details} />
            </ExpandableRow>

            <ExpandableRow label="Outflows" value={`- ${fmt(data.cash_banking.money_out)}`} expandable={data.cash_banking.money_out > 0}>
              <CashFlowTable data={data.cash_banking.outflow_details} />
            </ExpandableRow>

            <ExpandableRow label="Banked Today" value={fmt(data.cash_banking.total_banked)} expandable={data.cash_banking.total_banked > 0}>
              <BankingTable data={data.cash_banking.banking_details} />
            </ExpandableRow>

            <Divider sx={{ my: 1 }} />
            
            <ExpandableRow label="Cash In Hand (EOD)" value={fmt(data.cash_banking.cash_in_hand_eod)} bold expandable={false}>
              <></>
            </ExpandableRow>
            <ExpandableRow label="Petty Cash Balance" value={fmt(data.cash_banking.petty_cash_balance)} expandable={false}>
              <></>
            </ExpandableRow>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function BranchSummaryPage() {
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(today());
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [allBranches, setAllBranches] = useState(true);
  const [triggered, setTriggered] = useState(false);

  const { data: branches = [], isLoading: loadingBranches } = useQuery<BranchOption[]>({
    queryKey: ["branch-list"],
    queryFn: () => reportingApi.getBranchList(),
  });

  const {
    data: results,
    isFetching,
    refetch,
  } = useQuery<BranchDailySummary[]>({
    queryKey: ["branch-summary", startDate, endDate, allBranches ? [] : selectedCodes],
    queryFn: () => reportingApi.getBranchDailySummary(startDate, endDate, allBranches ? undefined : selectedCodes),
    enabled: false,
  });

  const handleToggleBranch = (code: string) => {
    setSelectedCodes(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  };

  const handleGenerate = () => {
    setTriggered(true);
    refetch();
  };

  const handlePrint = () => window.print();
  const handleExport = () => results && exportToCsv(results, startDate, endDate);

  return (
    <Box sx={{ "@media print": { "& .no-print": { display: "none" } } }}>
      <Stack direction={{ xs: "column", sm: "row" }} alignItems={{ xs: "stretch", sm: "center" }} spacing={2} mb={3} className="no-print">
        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <AssessmentIcon color="primary" />
            <Typography variant="h5" fontWeight={700}>Branch Summary Report</Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">View daily sales, purchases, banking and cash position per branch.</Typography>
        </Box>
        <Box flexGrow={1} />
        {results && (
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleExport} className="no-print">
              Export Excel
            </Button>
            <Button variant="outlined" startIcon={<PrintIcon />} onClick={handlePrint} className="no-print">
              Print / PDF
            </Button>
          </Stack>
        )}
      </Stack>

      <Paper sx={{ p: 3, mb: 3 }} className="no-print">
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>Report Filters</Typography>
        <Grid container spacing={3} alignItems="flex-start">
          <Grid item xs={12} sm={4} md={3}>
            <Typography variant="body2" color="text.secondary" mb={0.5}>Start Date</Typography>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 }}
            />
            <Typography variant="body2" color="text.secondary" mb={0.5} mt={2}>End Date</Typography>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 }}
            />
          </Grid>
          <Grid item xs={12} sm={8} md={7}>
            <Typography variant="body2" color="text.secondary" mb={0.5}>Branches</Typography>
            <FormControlLabel
              control={<Checkbox checked={allBranches} onChange={(e) => { setAllBranches(e.target.checked); if (e.target.checked) setSelectedCodes([]); }} size="small" />}
              label={<Typography variant="body2">All Branches</Typography>}
            />
            {!allBranches && (
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 1 }}>
                {loadingBranches ? (
                  <CircularProgress size={20} />
                ) : (
                  branches.map((b) => (
                    <FormControlLabel
                      key={b.branch_code}
                      control={<Checkbox checked={selectedCodes.includes(b.branch_code)} onChange={() => handleToggleBranch(b.branch_code)} size="small" />}
                      label={<Typography variant="body2">{b.branch_name} ({b.branch_code})</Typography>}
                    />
                  ))
                )}
              </Box>
            )}
          </Grid>
          <Grid item xs={12} sm={12} md={2}>
            <Box sx={{ mt: { md: 3 } }}>
              <Button variant="contained" fullWidth onClick={handleGenerate} disabled={isFetching || (!allBranches && selectedCodes.length === 0)} startIcon={isFetching ? <CircularProgress size={16} color="inherit" /> : <ReceiptIcon />} sx={{ py: 1.2 }}>
                Generate
              </Button>
            </Box>
          </Grid>
        </Grid>
      </Paper>

      {isFetching && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {!isFetching && triggered && results && results.length === 0 && (
        <Alert severity="info">No data found for the selected date range and branches.</Alert>
      )}

      {!isFetching && results && results.length > 0 && (
        <>
          <Box sx={{ display: "none", "@media print": { display: "block" }, mb: 2 }}>
            <Typography variant="h5" fontWeight={700}>Branch Summary Report — {startDate} to {endDate}</Typography>
            <Typography variant="body2" color="text.secondary">
              {allBranches ? "All Branches" : selectedCodes.join(", ")} · Generated {new Date().toLocaleString("en-LK")}
            </Typography>
            <Divider sx={{ my: 1 }} />
          </Box>

          <Paper sx={{ p: 2, mb: 3, bgcolor: "primary.50" }} className="no-print">
            <Grid container spacing={2}>
              {[
                { label: "Total Net Sales", value: fmt(results.reduce((s, r) => s + r.net_sales, 0)) },
                { label: "Total Banked", value: fmt(results.reduce((s, r) => s + r.cash_banking.total_banked, 0)) },
                { label: "Total Cash In Hand (EOD)", value: fmt(results.reduce((s, r) => s + r.cash_banking.cash_in_hand_eod, 0)) },
                { label: "Total PO Value", value: fmt(results.reduce((s, r) => s + r.purchasing.total_value, 0)) },
              ].map((item) => (
                <Grid item xs={6} sm={3} key={item.label}>
                  <Typography variant="caption" color="text.secondary" display="block">{item.label}</Typography>
                  <Typography variant="h6" fontWeight={700} color="primary.main">{item.value}</Typography>
                </Grid>
              ))}
            </Grid>
          </Paper>

          {results.map((branch) => (
            <BranchCard key={branch.branch_code} data={branch} />
          ))}
        </>
      )}
    </Box>
  );
}
"""

with open(r"d:\Dev\TijaeroERP\frontend\src\modules\reporting\pages\BranchSummaryPage.tsx", "w", encoding="utf-8") as f:
    f.write(content)

print("Done")
