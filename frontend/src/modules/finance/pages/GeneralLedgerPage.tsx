/**
 * GeneralLedgerPage - General Ledger & Trial Balance
 *
 * View GL entries with filters and trial balance report.
 * Uses DataGrid pattern similar to CashbookPage.
 */

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
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Alert,
} from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";

import {
  TPageHeader,
  TCurrency,
  fmtLKR,
} from "@/components/tijaero";
import { generalLedgerApi, chartOfAccountsApi } from "@/modules/finance/api";


// ─── Component ───────────────────────────────────────────────────────────────

export default function GeneralLedgerPage() {
  const [activeTab, setActiveTab] = useState(0);

  // GL Filters
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [accountId, setAccountId] = useState<number | "">("");
  const [transactionType, setTransactionType] = useState("");

  // Trial Balance
  const [tbDate, setTbDate] = useState(() => new Date().toISOString().split("T")[0]);

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const { data: accounts = [] } = useQuery({
    queryKey: ["chart-of-accounts-all"],
    queryFn: () => chartOfAccountsApi.getAll({ is_active: true, limit: 1000 }),
  });

  const { data: glData, isLoading: glLoading } = useQuery({
    queryKey: ["general-ledger", dateFrom, dateTo, accountId, transactionType],
    queryFn: () =>
      generalLedgerApi.getAll({
        date_from: dateFrom,
        date_to: dateTo,
        account_id: accountId || undefined,
        transaction_type: transactionType || undefined,
        limit: 1000,
      }),
    enabled: activeTab === 0,
  });
  const glEntries = glData?.items ?? [];

  const { data: trialBalance, isLoading: tbLoading } = useQuery({
    queryKey: ["trial-balance", tbDate],
    queryFn: () => generalLedgerApi.getTrialBalance({ as_of_date: tbDate }),
    enabled: activeTab === 1,
  });

  // ─── GL Columns ────────────────────────────────────────────────────────────

  const glColumns: GridColDef[] = [
    {
      field: "transaction_date",
      headerName: "Date",
      width: 110,
      valueFormatter: (value: string) =>
        value ? new Date(value).toLocaleDateString() : "-",
    },
    {
      field: "account_code",
      headerName: "Account Code",
      width: 120,
    },
    {
      field: "account_name",
      headerName: "Account Name",
      width: 200,
    },
    {
      field: "description",
      headerName: "Description",
      width: 200,
    },
    {
      field: "reference_no",
      headerName: "Reference",
      width: 130,
    },
    {
      field: "transaction_type",
      headerName: "Type",
      width: 100,
      renderCell: (params) => (
        <Chip label={params.value} size="small" variant="outlined" />
      ),
    },
    {
      field: "debit",
      headerName: "Debit",
      width: 120,
      type: "number",
      valueFormatter: (value: number) => (value > 0 ? fmtLKR(value) : "-"),
    },
    {
      field: "credit",
      headerName: "Credit",
      width: 120,
      type: "number",
      valueFormatter: (value: number) => (value > 0 ? fmtLKR(value) : "-"),
    },
    {
      field: "balance",
      headerName: "Balance",
      width: 130,
      type: "number",
      valueFormatter: (value: number) => fmtLKR(value),
    },
  ];

  // ─── Compute Summary ──────────────────────────────────────────────────────

  const totalDebit = glEntries.reduce((s, e) => s + Number(e.debit || 0), 0);
  const totalCredit = glEntries.reduce((s, e) => s + Number(e.credit || 0), 0);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <Box sx={{ p: 3 }}>
      <TPageHeader
        title="General Ledger"
        subtitle="View ledger entries and trial balance"
      />

      <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ mb: 2 }}>
        <Tab label="Ledger Entries" />
        <Tab label="Trial Balance" />
      </Tabs>

      {/* ── Tab 0: GL Entries ── */}
      {activeTab === 0 && (
        <>
          {/* Summary Cards */}
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 2, mb: 2 }}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" variant="body2">Total Entries</Typography>
                <Typography variant="h5">{glEntries.length}</Typography>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <Typography color="text.secondary" variant="body2">Total Debit</Typography>
                <Typography variant="h5" color="success.main">
                  <TCurrency value={totalDebit} />
                </Typography>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <Typography color="text.secondary" variant="body2">Total Credit</Typography>
                <Typography variant="h5" color="error.main">
                  <TCurrency value={totalCredit} />
                </Typography>
              </CardContent>
            </Card>
          </Box>

          {/* Filters */}
          <Box sx={{ mb: 2, display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center" }}>
            <TextField
              label="From Date"
              type="date"
              size="small"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ width: 160 }}
            />
            <TextField
              label="To Date"
              type="date"
              size="small"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ width: 160 }}
            />
            <TextField
              select
              label="Account"
              size="small"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : "")}
              sx={{ width: 250 }}
            >
              <MenuItem value="">All Accounts</MenuItem>
              {accounts.map((a) => (
                <MenuItem key={a.id} value={a.id}>
                  {a.account_code} - {a.account_name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Transaction Type"
              size="small"
              value={transactionType}
              onChange={(e) => setTransactionType(e.target.value)}
              sx={{ width: 180 }}
            >
              <MenuItem value="">All Types</MenuItem>
              <MenuItem value="journal_entry">Journal Entry</MenuItem>
              <MenuItem value="invoice">Invoice</MenuItem>
              <MenuItem value="payment">Payment</MenuItem>
              <MenuItem value="expense">Expense</MenuItem>
              <MenuItem value="adjustment">Adjustment</MenuItem>
            </TextField>
          </Box>

          {/* Data Grid */}
          <Paper sx={{ height: 500 }}>
            <DataGrid
              rows={glEntries}
              columns={glColumns}
              loading={glLoading}
              initialState={{
                sorting: { sortModel: [{ field: "transaction_date", sort: "desc" }] },
              }}
              sx={{
                "& .MuiDataGrid-row:hover": { bgcolor: "action.hover" },
              }}
            />
          </Paper>
        </>
      )}

      {/* ── Tab 1: Trial Balance ── */}
      {activeTab === 1 && (
        <>
          <Box sx={{ mb: 2, display: "flex", gap: 2, alignItems: "center" }}>
            <TextField
              label="As of Date"
              type="date"
              size="small"
              value={tbDate}
              onChange={(e) => setTbDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ width: 180 }}
            />
            {trialBalance && (
              <Alert
                severity={trialBalance.is_balanced ? "success" : "error"}
                sx={{ py: 0 }}
              >
                {trialBalance.is_balanced
                  ? "Trial Balance is balanced"
                  : "Trial Balance is NOT balanced!"}
              </Alert>
            )}
          </Box>

          <Paper variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: "action.hover" }}>
                  <TableCell sx={{ fontWeight: 700 }}>Account Code</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Account Name</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="right">Debit</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="right">Credit</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="right">Balance</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {tbLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center">Loading...</TableCell>
                  </TableRow>
                ) : trialBalance?.accounts?.length ? (
                  <>
                    {trialBalance.accounts.map((acc) => (
                      <TableRow key={acc.account_id} hover>
                        <TableCell>{acc.account_code}</TableCell>
                        <TableCell>{acc.account_name}</TableCell>
                        <TableCell>
                          <Chip label={acc.account_type} size="small" variant="outlined" />
                        </TableCell>
                        <TableCell align="right">
                          {Number(acc.total_debit) > 0 ? fmtLKR(acc.total_debit) : "-"}
                        </TableCell>
                        <TableCell align="right">
                          {Number(acc.total_credit) > 0 ? fmtLKR(acc.total_credit) : "-"}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>
                          {fmtLKR(acc.balance)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {/* Totals row */}
                    <TableRow sx={{ bgcolor: "action.hover" }}>
                      <TableCell colSpan={3} sx={{ fontWeight: 700 }}>
                        TOTALS
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>
                        {fmtLKR(trialBalance.total_debit)}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>
                        {fmtLKR(trialBalance.total_credit)}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>
                        {fmtLKR(trialBalance.total_debit - trialBalance.total_credit)}
                      </TableCell>
                    </TableRow>
                  </>
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      <Typography variant="body2" color="text.secondary" sx={{ py: 4 }}>
                        No data available for the selected period
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>
        </>
      )}
    </Box>
  );
}
