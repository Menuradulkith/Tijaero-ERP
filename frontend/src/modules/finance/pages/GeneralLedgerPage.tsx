/**
 * GeneralLedgerPage - General Ledger & Trial Balance
 *
 * View GL entries per account with Master-Detail pattern.
 * Left panel: list of accounts with search/filter.
 * Right panel: GL entries for the selected account + Trial Balance tab.
 * Follows Purchasing/Sales UI pattern with TFilterPanel, TSearchableSelect,
 * expanded list items, ActionToolbar, and onRefresh.
 */

import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Paper,
  Skeleton,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  DetailPanelHeader,
  EmptyState,
  fmtLKR,
  FormSection,
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  TCurrency,
  TFilterPanel,
  TSearchableSelect,
  type SortOption,
  TDetailSkeleton,
  modernTableStyles,
} from "@/components/tijaero";

import { generalLedgerApi, chartOfAccountsApi } from "@/modules/finance/api";


// ─── Configuration ───────────────────────────────────────────────────────────

const ACCOUNT_TYPE_OPTIONS = [
  { value: "Asset", label: "Asset", color: "info" as const },
  { value: "Liability", label: "Liability", color: "warning" as const },
  { value: "Equity", label: "Equity", color: "success" as const },
  { value: "Revenue", label: "Revenue", color: "primary" as const },
  { value: "Expense", label: "Expense", color: "error" as const },
];

const SORT_OPTIONS: SortOption[] = [
  { value: "account_code", label: "Account Code" },
  { value: "account_name", label: "Account Name" },
  { value: "account_type", label: "Account Type" },
];

const TRANSACTION_TYPE_OPTIONS = [
  { value: "journal_entry", label: "Journal Entry", color: "info" as const },
  { value: "invoice", label: "Invoice", color: "primary" as const },
  { value: "payment", label: "Payment", color: "success" as const },
  { value: "expense", label: "Expense", color: "warning" as const },
  { value: "adjustment", label: "Adjustment", color: "default" as const },
];

interface AccountListItem {
  id: number;
  account_code: string;
  account_name: string;
  account_type: string;
  is_active: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function GeneralLedgerPage() {
  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("account_code");
  const [filterAccountType, setFilterAccountType] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<AccountListItem | null>(null);

  // Detail tab (0 = Ledger, 1 = Trial Balance)
  const [detailTab, setDetailTab] = useState(0);

  // Ledger date filters
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [filterTxnType, setFilterTxnType] = useState<string | null>(null);

  // Trial Balance
  const [tbDate, setTbDate] = useState(() => new Date().toISOString().split("T")[0]);

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const { data: accounts = [], isLoading: accountsLoading, refetch: refetchAccounts } = useQuery({
    queryKey: ["chart-of-accounts-all"],
    queryFn: () => chartOfAccountsApi.getAll({ is_active: true, limit: 1000 }),
  });

  const { data: glData, isLoading: glLoading, refetch: refetchGL } = useQuery({
    queryKey: ["general-ledger", selectedAccount?.id, dateFrom, dateTo, filterTxnType],
    queryFn: () =>
      generalLedgerApi.getAll({
        account_id: selectedAccount?.id,
        date_from: dateFrom,
        date_to: dateTo,
        transaction_type: filterTxnType ?? undefined,
        limit: 1000,
      }),
    enabled: !!selectedAccount && detailTab === 0,
  });
  const glEntries = glData?.items ?? [];

  const { data: trialBalance, isLoading: tbLoading, refetch: refetchTB } = useQuery({
    queryKey: ["trial-balance", tbDate],
    queryFn: () => generalLedgerApi.getTrialBalance({ as_of_date: tbDate }),
    enabled: detailTab === 1,
  });

  // ─── Filter & Sort Accounts ────────────────────────────────────────────────

  const filteredAccounts = useMemo(() => {
    let filtered = [...accounts];
    if (filterAccountType) {
      filtered = filtered.filter((a) => a.account_type === filterAccountType);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (a) =>
          a.account_code?.toLowerCase().includes(q) ||
          a.account_name?.toLowerCase().includes(q)
      );
    }
    filtered.sort((a, b) => {
      if (sortField === "account_name")
        return (a.account_name || "").localeCompare(b.account_name || "");
      if (sortField === "account_type")
        return (a.account_type || "").localeCompare(b.account_type || "");
      return (a.account_code || "").localeCompare(b.account_code || "");
    });
    return filtered;
  }, [accounts, filterAccountType, searchQuery, sortField]);

  useEffect(() => {
    if (filteredAccounts.length > 0 && !selectedAccount) {
      setSelectedAccount(filteredAccounts[0]);
    }
  }, [filteredAccounts, selectedAccount]);

  const handleRefresh = useCallback(() => {
    refetchAccounts();
    refetchGL();
    refetchTB();
  }, [refetchAccounts, refetchGL, refetchTB]);

  // Compute totals for ledger entries
  const totalDebit = glEntries.reduce((s, e) => s + Number(e.debit || 0), 0);
  const totalCredit = glEntries.reduce((s, e) => s + Number(e.credit || 0), 0);

  // ─── Master Panel ──────────────────────────────────────────────────────────

  const masterPanel = (
    <SearchableList<AccountListItem>
      items={filteredAccounts}
      isLoading={accountsLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search accounts..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedAccount}
      onSelectItem={(acc) => setSelectedAccount(acc)}
      emptyMessage="No accounts found"
      listHeader={
        <TFilterPanel>
          <TSearchableSelect
            label="Account Type"
            value={filterAccountType}
            onChange={(val) => setFilterAccountType(val as string | null)}
            options={ACCOUNT_TYPE_OPTIONS.map((t) => ({
              value: t.value,
              label: t.label,
              color: t.color,
            }))}
            showAllOption
            allOptionLabel="All Types"
            placeholder="Search types..."
          />
        </TFilterPanel>
      }
      renderItem={(acc: AccountListItem, isSelected: boolean) => (
        <SelectableListItem
          key={acc.id}
          id={acc.id}
          isSelected={isSelected}
          onClick={() => setSelectedAccount(acc)}
          primaryText={
            <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{acc.account_code}</span>
                {isSelected && (
                  <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                    (Code)
                  </Typography>
                )}
              </Box>
              {isSelected && (
                <>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      {acc.account_name}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Name)
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", gap: 0.5, mt: 0.5 }}>
                    <Chip
                      label={acc.account_type}
                      size="small"
                      color={
                        ACCOUNT_TYPE_OPTIONS.find((t) => t.value === acc.account_type)?.color || "default"
                      }
                      sx={{ height: 18, fontSize: "0.65rem" }}
                    />
                  </Box>
                </>
              )}
            </Box>
          }
          secondaryText={!isSelected ? acc.account_name : undefined}
          statusChip={
            !isSelected
              ? {
                  label: acc.account_type,
                  color:
                    ACCOUNT_TYPE_OPTIONS.find((t) => t.value === acc.account_type)?.color || ("default" as const),
                }
              : undefined
          }
        />
      )}
    />
  );

  // ─── Detail Panel ──────────────────────────────────────────────────────────

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Finance", href: "/finance" },
          { label: "General Ledger", href: "/finance/general-ledger" },
          ...(selectedAccount ? [{ label: `${selectedAccount.account_code} - ${selectedAccount.account_name}` }] : []),
        ]}
        title={selectedAccount ? `${selectedAccount.account_code} - ${selectedAccount.account_name}` : ""}
        titleIcon={<AccountBalanceIcon color="primary" />}
        noSelectionTitle="Select an Account"
        chips={
          selectedAccount
            ? [
                {
                  label: selectedAccount.account_type,
                  color:
                    ACCOUNT_TYPE_OPTIONS.find((t) => t.value === selectedAccount.account_type)?.color || ("default" as const),
                },
              ]
            : []
        }
      />

      {/* Tabs for Ledger / Trial Balance */}
      <Box sx={{ borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
        <Tabs value={detailTab} onChange={(_, v) => setDetailTab(v)} variant="fullWidth">
          <Tab label="Ledger Entries" />
          <Tab label="Trial Balance" />
        </Tabs>
      </Box>

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedAccount && detailTab === 0 ? (
          <EmptyState message="Select an account from the list to view ledger entries" />
        ) : accountsLoading && detailTab === 0 ? (
          <TDetailSkeleton sections={2} fieldsPerSection={3} showHeader={false} showToolbar={false} showTable />
        ) : detailTab === 0 ? (
          <>
            {/* Ledger Filters */}
            <FormSection title="Filters" columns={3}>
              <TextField
                label="From Date"
                type="date"
                size="small"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="To Date"
                type="date"
                size="small"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
              <TSearchableSelect
                label="Transaction Type"
                value={filterTxnType}
                onChange={(val) => setFilterTxnType(val as string | null)}
                options={TRANSACTION_TYPE_OPTIONS}
                showAllOption
                allOptionLabel="All Types"
                placeholder="Search types..."
              />
            </FormSection>

            {/* Summary Cards */}
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 2, mb: 2 }}>
              <Card variant="outlined">
                <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                  <Typography color="text.secondary" variant="caption">Total Entries</Typography>
                  <Typography variant="h6">{glEntries.length}</Typography>
                </CardContent>
              </Card>
              <Card variant="outlined">
                <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                  <Typography color="text.secondary" variant="caption">Total Debit</Typography>
                  <Typography variant="h6" color="success.main">
                    <TCurrency value={totalDebit} />
                  </Typography>
                </CardContent>
              </Card>
              <Card variant="outlined">
                <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                  <Typography color="text.secondary" variant="caption">Total Credit</Typography>
                  <Typography variant="h6" color="error.main">
                    <TCurrency value={totalCredit} />
                  </Typography>
                </CardContent>
              </Card>
            </Box>

            {/* GL Entries Table */}
            <FormSection title="Ledger Entries" columns={1}>
              <Paper variant="outlined" sx={{ width: "100%", overflow: "hidden", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={modernTableStyles.headerRow}>
                      <TableCell>Date</TableCell>
                      <TableCell>Description</TableCell>
                      <TableCell>Reference</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell align="right">Debit</TableCell>
                      <TableCell align="right">Credit</TableCell>
                      <TableCell align="right">Balance</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {glLoading ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 7 }).map((_, j) => (
                            <TableCell key={j}><Skeleton animation="wave" /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : glEntries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} align="center">
                          <Typography variant="body2" color="text.secondary" sx={{ py: 4 }}>
                            No ledger entries found for this account and period
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      <>
                        {glEntries.map((entry) => (
                          <TableRow key={entry.id} sx={modernTableStyles.bodyRow}>
                            <TableCell>
                              {entry.transaction_date
                                ? format(new Date(entry.transaction_date), "dd/MM/yyyy")
                                : "-"}
                            </TableCell>
                            <TableCell>{entry.description || "-"}</TableCell>
                            <TableCell>{entry.reference_no || "-"}</TableCell>
                            <TableCell>
                              <Chip label={entry.transaction_type} size="small" variant="outlined" sx={{ height: 20, fontSize: "0.65rem" }} />
                            </TableCell>
                            <TableCell align="right">
                              {Number(entry.debit) > 0 ? fmtLKR(entry.debit) : "-"}
                            </TableCell>
                            <TableCell align="right">
                              {Number(entry.credit) > 0 ? fmtLKR(entry.credit) : "-"}
                            </TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>
                              {fmtLKR(entry.balance)}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow sx={modernTableStyles.footerRow}>
                          <TableCell colSpan={4} sx={{ fontWeight: 700 }}>Totals</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>
                            {fmtLKR(totalDebit)}
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>
                            {fmtLKR(totalCredit)}
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>
                            {fmtLKR(totalDebit - totalCredit)}
                          </TableCell>
                        </TableRow>
                      </>
                    )}
                  </TableBody>
                </Table>
              </Paper>
            </FormSection>
          </>
        ) : (
          /* Trial Balance Tab */
          <>
            <FormSection title="Trial Balance Period" columns={2}>
              <TextField
                label="As of Date"
                type="date"
                size="small"
                value={tbDate}
                onChange={(e) => setTbDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
              {trialBalance && (
                <Box sx={{ display: "flex", alignItems: "center" }}>
                  <Alert
                    severity={trialBalance.is_balanced ? "success" : "error"}
                    sx={{ py: 0, width: "100%" }}
                  >
                    {trialBalance.is_balanced
                      ? "Trial Balance is balanced ✓"
                      : "Trial Balance is NOT balanced!"}
                  </Alert>
                </Box>
              )}
            </FormSection>

            {/* TB Summary */}
            {trialBalance && (
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 2, mb: 2 }}>
                <Card variant="outlined">
                  <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                    <Typography color="text.secondary" variant="caption">Total Debit</Typography>
                    <Typography variant="h6" color="success.main">
                      <TCurrency value={trialBalance.total_debit} />
                    </Typography>
                  </CardContent>
                </Card>
                <Card variant="outlined">
                  <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                    <Typography color="text.secondary" variant="caption">Total Credit</Typography>
                    <Typography variant="h6" color="error.main">
                      <TCurrency value={trialBalance.total_credit} />
                    </Typography>
                  </CardContent>
                </Card>
                <Card variant="outlined">
                  <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                    <Typography color="text.secondary" variant="caption">Accounts</Typography>
                    <Typography variant="h6">{trialBalance.accounts?.length || 0}</Typography>
                  </CardContent>
                </Card>
              </Box>
            )}

            {/* Trial Balance Table */}
            <FormSection title="Account Balances" columns={1}>
              <Paper variant="outlined" sx={{ width: "100%", overflow: "hidden", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={modernTableStyles.headerRow}>
                      <TableCell>Account Code</TableCell>
                      <TableCell>Account Name</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell align="right">Debit</TableCell>
                      <TableCell align="right">Credit</TableCell>
                      <TableCell align="right">Balance</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {tbLoading ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 6 }).map((_, j) => (
                            <TableCell key={j}><Skeleton animation="wave" /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : trialBalance?.accounts?.length ? (
                      <>
                        {trialBalance.accounts.map((acc) => (
                          <TableRow key={acc.account_id} sx={modernTableStyles.bodyRow}>
                            <TableCell>{acc.account_code}</TableCell>
                            <TableCell>{acc.account_name}</TableCell>
                            <TableCell>
                              <Chip label={acc.account_type} size="small" variant="outlined" sx={{ height: 20, fontSize: "0.65rem" }} />
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
                        <TableRow sx={modernTableStyles.footerRow}>
                          <TableCell colSpan={3} sx={{ fontWeight: 700 }}>TOTALS</TableCell>
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
            </FormSection>
          </>
        )}
      </Box>
    </Box>
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <MasterDetailLayout
      title="General Ledger"
      icon={<AccountBalanceIcon color="primary" />}
      onRefresh={handleRefresh}
      isLoading={accountsLoading || glLoading}
      masterPanel={masterPanel}
      detailPanel={detailPanel}
    />
  );
}
