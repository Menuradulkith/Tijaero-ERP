/**
 * RecurringJournalsPage — journals that repeat (rent, insurance, accruals) and
 * the one-time opening balances when the books start.
 *
 * Recurring: "Create due journals" makes a draft journal for each due date up
 * to today; they are approved and posted on the Journal Entries page like any
 * manual journal. "Reverse next month" turns each into an accrual.
 * Opening balances: paste "account code, debit, credit" lines; the difference
 * goes to Opening Balance Equity (3900); the result is a draft journal to approve.
 *
 * Same layout as the purchasing / sales pages: a full-width list with filters,
 * a full-page detail with breadcrumb and actions, and a full-page create form.
 */

import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EventRepeatIcon from "@mui/icons-material/EventRepeat";
import PauseCircleOutlineIcon from "@mui/icons-material/PauseCircleOutline";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import PlaylistAddCheckIcon from "@mui/icons-material/PlaylistAddCheck";
import SearchIcon from "@mui/icons-material/Search";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";

import { usePermission } from "@/auth/permissions";
import {
  ActionToolbar,
  DetailPanelHeader,
  FormSection,
  getStatusProps,
  handleApiError,
  MasterDetailLayout,
  showSuccessToast,
  TChip,
  TDataGrid,
  type TDataGridColumn,
  TSearchableSelect,
  TStatusChip,
} from "@/components/tijaero";
import { chartOfAccountsApi } from "@/modules/finance/api";
import {
  openingBalancesApi,
  recurringJournalsApi,
  type OpeningBalanceLine,
  type RecurringJournal,
  type RecurringLine,
} from "@/modules/finance/api/periodEnd";
import { submitOnce } from "@/modules/finance/submitOnce";

const fmt = (v: number | string | null | undefined) =>
  Number(v ?? 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const FREQ_LABEL = { monthly: "Every month", quarterly: "Every 3 months", yearly: "Every year" } as const;

const TABS = [{ label: "Recurring Journals" }, { label: "Opening Balances" }];
type TabNav = { activeTab: number; onTabChange: (tab: string | number) => void };

const BASE_CRUMBS = [
  { label: "Finance", href: "/finance" },
  { label: "Recurring Journals", href: "/finance/recurring-journals" },
];

const STATUS_OPTIONS = [
  { value: "due", label: "Due now" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const isDue = (r: RecurringJournal) => r.is_active && r.next_date <= today();
const journalTotal = (r: RecurringJournal) => r.lines.reduce((s, l) => s + Number(l.debit_amount || 0), 0);

function useAccounts() {
  const { data: accounts = [] } = useQuery({
    queryKey: ["chart-of-accounts-all"],
    queryFn: () => chartOfAccountsApi.getAll({ is_active: true, limit: 1000 }),
  });
  const leaves = useMemo(() => {
    const parents = new Set(accounts.map((a) => a.parent_account_id));
    return accounts.filter((a) => !parents.has(a.id));
  }, [accounts]);
  return { accounts, leaves };
}

function DetailShell({ header, toolbar, children }: { header: ReactNode; toolbar: ReactNode; children: ReactNode }) {
  return (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {header}
      {toolbar}
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>{children}</Box>
    </Box>
  );
}

const ro = (label: string, value: ReactNode) => <TextField label={label} size="small" value={value ?? ""} disabled />;

// ─── Recurring: create ────────────────────────────────────────────────────────
function RecurringCreatePanel({ onCancel, onSaved }: { onCancel: () => void; onSaved: (r: RecurringJournal) => void }) {
  const queryClient = useQueryClient();
  const { leaves: accounts } = useAccounts();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [frequency, setFrequency] = useState<RecurringJournal["frequency"]>("monthly");
  const [nextDate, setNextDate] = useState(today());
  const [endDate, setEndDate] = useState("");
  const [autoReverse, setAutoReverse] = useState(false);
  const [lines, setLines] = useState<RecurringLine[]>([
    { account_id: 0, debit_amount: "", credit_amount: "" },
    { account_id: 0, debit_amount: "", credit_amount: "" },
  ]);
  const dr = lines.reduce((s, l) => s + Number(l.debit_amount || 0), 0);
  const cr = lines.reduce((s, l) => s + Number(l.credit_amount || 0), 0);
  const balanced = dr > 0 && Math.abs(dr - cr) < 0.005;
  const valid = !!(name.trim() && description.trim() && nextDate && balanced && lines.every((l) => l.account_id));

  const save = useMutation({
    mutationFn: () =>
      recurringJournalsApi.create({
        name, description, frequency, next_date: nextDate, end_date: endDate || null, auto_reverse: autoReverse,
        lines: lines.map((l) => ({ ...l, debit_amount: Number(l.debit_amount || 0), credit_amount: Number(l.credit_amount || 0) })),
      }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["recurring-journals"] });
      showSuccessToast("Recurring journal saved.");
      onSaved(r);
    },
    onError: (err) => handleApiError(err, "Could not save the recurring journal"),
  });
  const setLine = (i: number, patch: Partial<RecurringLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <DetailShell
      header={
        <DetailPanelHeader
          breadcrumbs={[...BASE_CRUMBS, { label: "New Recurring Journal" }]}
          title=""
          titleIcon={<EventRepeatIcon color="primary" />}
          isCreating
          createTitle="New Recurring Journal"
        />
      }
      toolbar={
        <ActionToolbar
          isCreating
          isEditing={false}
          isSaving={save.isPending}
          isFormValid={valid}
          onSave={() => submitOnce("RecurringJournalsPage-save-1", save)}
          onCancel={onCancel}
        />
      }
    >
      <FormSection title="Recurring Journal" columns={2}>
        <TextField label="Name" size="small" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Shop rent" />
        <TextField label="Description on each journal" size="small" required value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Rent for the main shop" />
      </FormSection>
      <FormSection title="Schedule" columns={3}>
        <TextField select label="How often" size="small" value={frequency} onChange={(e) => setFrequency(e.target.value as RecurringJournal["frequency"])}>
          {Object.entries(FREQ_LABEL).map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
        </TextField>
        <TextField label="First date" type="date" size="small" required value={nextDate} onChange={(e) => setNextDate(e.target.value)} InputLabelProps={{ shrink: true }} />
        <TextField label="Last date (optional)" type="date" size="small" value={endDate} onChange={(e) => setEndDate(e.target.value)} InputLabelProps={{ shrink: true }} />
        <FormControlLabel
          sx={{ gridColumn: "1 / -1" }}
          control={<Checkbox checked={autoReverse} onChange={(e) => setAutoReverse(e.target.checked)} />}
          label="Reverse it on the 1st of the next month (an accrual, e.g. a bill that arrives later)"
        />
      </FormSection>
      <FormSection title="Lines" columns={1}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Account</TableCell>
              <TableCell sx={{ width: 160 }}>Debit</TableCell>
              <TableCell sx={{ width: 160 }}>Credit</TableCell>
              <TableCell sx={{ width: 40 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map((l, i) => (
              <TableRow key={i}>
                <TableCell>
                  <TextField select size="small" fullWidth required value={l.account_id || ""} onChange={(e) => setLine(i, { account_id: Number(e.target.value) })}>
                    <MenuItem value="">Select account</MenuItem>
                    {accounts.map((a) => <MenuItem key={a.id} value={a.id}>{a.account_code} - {a.account_name}</MenuItem>)}
                  </TextField>
                </TableCell>
                <TableCell>
                  <TextField size="small" type="number" value={l.debit_amount} onChange={(e) => setLine(i, { debit_amount: e.target.value, credit_amount: e.target.value ? "" : l.credit_amount })} />
                </TableCell>
                <TableCell>
                  <TextField size="small" type="number" value={l.credit_amount} onChange={(e) => setLine(i, { credit_amount: e.target.value, debit_amount: e.target.value ? "" : l.debit_amount })} />
                </TableCell>
                <TableCell>
                  {lines.length > 2 && (
                    <IconButton size="small" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell>
                <Button size="small" startIcon={<AddIcon />} onClick={() => setLines((ls) => [...ls, { account_id: 0, debit_amount: "", credit_amount: "" }])}>
                  Add line
                </Button>
              </TableCell>
              <TableCell sx={{ fontWeight: 700 }}>{fmt(dr)}</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>{fmt(cr)}</TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
        {!balanced && dr + cr > 0 && <Alert severity="warning">Debits and credits must be equal.</Alert>}
      </FormSection>
    </DetailShell>
  );
}

// ─── Recurring: view ──────────────────────────────────────────────────────────
function RecurringViewPanel({
  journal,
  canWrite,
  onChanged,
}: {
  journal: RecurringJournal;
  canWrite: boolean;
  onChanged: (r: RecurringJournal) => void;
}) {
  const queryClient = useQueryClient();
  const { accounts } = useAccounts();
  const toggle = useMutation({
    mutationFn: () => recurringJournalsApi.update(journal.id, { is_active: !journal.is_active }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["recurring-journals"] });
      onChanged(r);
    },
    onError: (err) => handleApiError(err, "Could not update"),
  });

  const lineRows = journal.lines.map((l, i) => {
    const a = accounts.find((x) => x.id === l.account_id);
    return {
      id: i,
      account: a ? `${a.account_code} - ${a.account_name}` : `#${l.account_id}`,
      debit_amount: Number(l.debit_amount || 0),
      credit_amount: Number(l.credit_amount || 0),
    };
  });
  const lineColumns: TDataGridColumn<(typeof lineRows)[number]>[] = [
    { field: "account", header: "Account", minWidth: 240, flex: 1 },
    { field: "debit_amount", header: "Debit", width: 150, type: "currency", align: "right", headerAlign: "right" },
    { field: "credit_amount", header: "Credit", width: 150, type: "currency", align: "right", headerAlign: "right" },
  ];

  return (
    <DetailShell
      header={
        <DetailPanelHeader
          breadcrumbs={[...BASE_CRUMBS, { label: journal.name }]}
          title={journal.name}
          titleIcon={<EventRepeatIcon color="primary" />}
          chips={[
            getStatusProps(journal.is_active ? "active" : "inactive", "financeDocument"),
            ...(isDue(journal) ? [{ label: "Due", color: "warning" as const }] : []),
          ]}
        />
      }
      toolbar={
        <ActionToolbar
          hasSelectedItem
          isCreating={false}
          isEditing={false}
          endActions={
            canWrite ? (
              <Button
                size="small"
                variant="outlined"
                startIcon={journal.is_active ? <PauseCircleOutlineIcon /> : <PlayCircleOutlineIcon />}
                disabled={toggle.isPending}
                onClick={() => submitOnce("RecurringJournalsPage-toggle", toggle)}
              >
                {journal.is_active ? "Deactivate" : "Activate"}
              </Button>
            ) : undefined
          }
        />
      }
    >
      <FormSection title="Recurring Journal" columns={2}>
        {ro("Name", journal.name)}
        {ro("Description on each journal", journal.description)}
      </FormSection>
      <FormSection title="Schedule" columns={4}>
        {ro("How often", FREQ_LABEL[journal.frequency])}
        {ro("Next date", journal.next_date)}
        {ro("Last date", journal.end_date ?? "")}
        {ro("Reverses next month", journal.auto_reverse ? "Yes (accrual)" : "No")}
      </FormSection>
      <FormSection title={`Lines · total ${fmt(journalTotal(journal))}`} columns={1}>
        <TDataGrid rows={lineRows} columns={lineColumns} autoHeight pageSize={25} pageSizeOptions={[25, 50, 100]} emptyMessage="No lines" />
      </FormSection>
      <Alert severity="info" variant="outlined">
        When it is due, "Create Due Journals" on the list makes a draft on the Journal Entries page for approval.
      </Alert>
    </DetailShell>
  );
}

// ─── Recurring tab ────────────────────────────────────────────────────────────
function RecurringTab({ nav, canWrite }: { nav: TabNav; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const { data: rows, isLoading, refetch } = useQuery({ queryKey: ["recurring-journals"], queryFn: recurringJournalsApi.getAll });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [selected, setSelected] = useState<RecurringJournal | null>(null);
  const [creating, setCreating] = useState(false);
  const due = (rows ?? []).filter(isDue).length;

  const createDue = useMutation({
    mutationFn: recurringJournalsApi.createDue,
    onSuccess: (nos) => {
      queryClient.invalidateQueries({ queryKey: ["recurring-journals"] });
      queryClient.invalidateQueries({ queryKey: ["journal-entries"] });
      showSuccessToast(nos.length ? `Created ${nos.length} draft journal(s): ${nos.join(", ")}. Approve and post them on Journal Entries.` : "Nothing is due.");
    },
    onError: (err) => handleApiError(err, "Could not create the journals"),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        (!status || (status === "due" ? isDue(r) : (status === "active") === r.is_active)) &&
        (!q || [r.name, r.description].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [rows, search, status]);

  const columns: TDataGridColumn<RecurringJournal>[] = [
    { field: "name", header: "Name", minWidth: 160, flex: 1 },
    { field: "description", header: "Description", minWidth: 200, flex: 1.4 },
    { field: "frequency", header: "How Often", width: 140, renderCell: (p) => FREQ_LABEL[p.row.frequency] },
    {
      field: "next_date",
      header: "Next Date",
      width: 160,
      renderCell: (p) => (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {p.row.next_date}
          {isDue(p.row) && <TChip size="small" color="warning" label="Due" />}
        </Box>
      ),
    },
    {
      field: "auto_reverse",
      header: "Reverses",
      width: 120,
      renderCell: (p) => (p.row.auto_reverse ? "Next month" : "—"),
    },
    {
      field: "amount",
      header: "Amount",
      width: 140,
      align: "right",
      headerAlign: "right",
      renderCell: (p) => fmt(journalTotal(p.row)),
    },
    {
      field: "is_active",
      header: "Status",
      width: 120,
      renderCell: (p) => <TStatusChip status={p.row.is_active ? "active" : "inactive"} statusMap="financeDocument" />,
    },
  ];

  const back = () => {
    setSelected(null);
    setCreating(false);
  };
  const detailMode = creating || !!selected;

  let body: ReactNode;
  if (creating) {
    body = (
      <RecurringCreatePanel
        onCancel={back}
        onSaved={(r) => {
          setCreating(false);
          setSelected(r);
        }}
      />
    );
  } else if (selected) {
    body = <RecurringViewPanel journal={selected} canWrite={canWrite} onChanged={setSelected} />;
  } else {
    body = (
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<RecurringJournal>
          rows={filtered}
          columns={columns}
          loading={isLoading}
          onRowClick={(row) => setSelected(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No recurring journals yet."
          autoHeight={false}
          height="100%"
        />
      </Box>
    );
  }

  return (
    <MasterDetailLayout
      title="Recurring & Opening Journals"
      tabs={detailMode ? undefined : TABS}
      activeTab={nav.activeTab}
      onTabChange={nav.onTabChange}
      titleSlot={
        detailMode ? (
          <Button size="small" startIcon={<ArrowBackIcon fontSize="small" />} onClick={back} sx={{ textTransform: "none" }}>
            Back to Recurring Journals
          </Button>
        ) : (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <TextField
              size="small"
              placeholder="Search recurring..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              }}
              sx={{ width: 190, flexShrink: 0 }}
            />
            <Box sx={{ width: 150, flexShrink: 0 }}>
              <TSearchableSelect
                label=""
                value={status}
                onChange={(v) => setStatus(v as string | null)}
                options={STATUS_OPTIONS}
                showAllOption
                allOptionLabel="All Statuses"
                placeholder="Search status..."
                size="small"
              />
            </Box>
            {(search || status) && (
              <Button
                size="small"
                onClick={() => {
                  setSearch("");
                  setStatus(null);
                }}
                sx={{ textTransform: "none" }}
              >
                Clear
              </Button>
            )}
          </Box>
        )
      }
      headerActions={
        !detailMode && canWrite ? (
          <>
            <Button
              variant="outlined"
              size="small"
              startIcon={createDue.isPending ? <CircularProgress size={16} /> : <PlaylistAddCheckIcon />}
              disabled={!due || createDue.isPending}
              onClick={() => submitOnce("RecurringJournalsPage-createDue-2", createDue)}
              sx={{ whiteSpace: "nowrap" }}
            >
              Create Due Journals{due ? ` (${due})` : ""}
            </Button>
            <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setCreating(true)} sx={{ mr: 1 }}>
              New Recurring Journal
            </Button>
          </>
        ) : undefined
      }
      onRefresh={() => refetch()}
      isLoading={isLoading}
    >
      {body}
    </MasterDetailLayout>
  );
}

// ─── Opening balances ─────────────────────────────────────────────────────────
function parseLines(textValue: string): { lines: OpeningBalanceLine[]; skipped: number } {
  const lines: OpeningBalanceLine[] = [];
  let skipped = 0;
  for (const raw of textValue.split(/\r?\n/)) {
    const cells = raw.split(/[,\t;]/).map((c) => c.trim());
    if (!cells[0] || !/\d/.test(cells[0])) {
      if (raw.trim()) skipped++;
      continue;
    }
    const num = (v?: string) => Number((v || "").replace(/,/g, "")) || 0;
    const debit = num(cells[1]);
    const credit = num(cells[2]);
    if (!debit && !credit) {
      skipped++;
      continue;
    }
    lines.push({ account_code: cells[0], debit, credit, description: cells[3] || undefined });
  }
  return { lines, skipped };
}

function OpeningTab({ nav, canWrite }: { nav: TabNav; canWrite: boolean }) {
  const [entryDate, setEntryDate] = useState(today());
  const [raw, setRaw] = useState("");
  const { lines, skipped } = useMemo(() => parseLines(raw), [raw]);
  const dr = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const cr = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const save = useMutation({
    mutationFn: () => openingBalancesApi.create({ entry_date: entryDate, lines }),
    onSuccess: (je) => {
      showSuccessToast(`Draft ${je.journal_entry_no} created. Approve and post it on the Journal Entries page.`);
      setRaw("");
    },
    onError: (err) => handleApiError(err, "Could not create the opening balances"),
  });

  return (
    <MasterDetailLayout title="Recurring & Opening Journals" tabs={TABS} activeTab={nav.activeTab} onTabChange={nav.onTabChange}>
      <DetailShell
        header={
          <DetailPanelHeader
            breadcrumbs={[{ label: "Finance", href: "/finance" }, { label: "Opening Balances" }]}
            title="Opening Balances"
            titleIcon={<AccountBalanceIcon color="primary" />}
            isCreating={canWrite}
            createTitle="Opening Balances"
          />
        }
        toolbar={
          <ActionToolbar
            isCreating={canWrite}
            isEditing={false}
            isSaving={save.isPending}
            isFormValid={lines.length > 0 && !!entryDate}
            onSave={canWrite ? () => submitOnce("RecurringJournalsPage-save-3", save) : undefined}
            onCancel={canWrite && raw ? () => setRaw("") : undefined}
          />
        }
      >
        <Alert severity="info" variant="outlined" sx={{ mb: 1.5 }}>
          Use this once, when you start keeping the books in Tijaero: enter what each account held on that day. Paste
          one line per account as <b>account code, debit, credit</b> (for example from Excel). Assets are usually
          debits; loans, suppliers and capital are credits. Any difference goes to Opening Balance Equity (3900).
          Saving creates a draft journal to approve and post on the Journal Entries page.
        </Alert>
        <FormSection title="Opening Journal" columns={4}>
          <TextField label="Balances as at" type="date" size="small" required value={entryDate} onChange={(e) => setEntryDate(e.target.value)} InputLabelProps={{ shrink: true }} disabled={!canWrite} />
          {ro("Accounts read", lines.length)}
          {ro("Total debits", fmt(dr))}
          {ro("Total credits", fmt(cr))}
        </FormSection>
        <FormSection title="Balances" columns={1}>
          <TextField
            multiline
            minRows={6}
            required
            placeholder={"1010, 25000, 0\n1020, 480000, 0\n2010, 0, 120000"}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            disabled={!canWrite}
          />
          {lines.length > 0 && (
            <Alert severity={Math.abs(dr - cr) < 0.005 ? "success" : "info"} variant="outlined">
              {lines.length} account(s) read{skipped ? `, ${skipped} line(s) skipped` : ""}. Debits {fmt(dr)}, credits {fmt(cr)}
              {Math.abs(dr - cr) >= 0.005 ? `: ${fmt(Math.abs(dr - cr))} will go to Opening Balance Equity.` : ": balanced."}
            </Alert>
          )}
        </FormSection>
      </DetailShell>
    </MasterDetailLayout>
  );
}

export default function RecurringJournalsPage() {
  const [tab, setTab] = useState(0);
  const canWrite = usePermission("journal_entries", "create");
  const nav: TabNav = { activeTab: tab, onTabChange: (t) => setTab(Number(t)) };
  return tab === 0 ? <RecurringTab nav={nav} canWrite={canWrite} /> : <OpeningTab nav={nav} canWrite={canWrite} />;
}
