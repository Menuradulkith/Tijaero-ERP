/**
 * BankReconciliationPage — check that the books match the bank statement.
 *
 * Each bank account is tied to one ledger account. A statement (typed in or
 * read from the bank's CSV) is matched line by line against the entries posted
 * to that ledger account. Lines only on the statement (bank fees, interest) can
 * be booked from here; entries only in the books stay listed as "not yet on the
 * bank statement". When nothing is left over and the difference is zero, the
 * statement is finished (reconciled).
 *
 * Same layout as the purchasing / sales pages: two tabs (Statements, Bank
 * Accounts), each a full-width list with filters, a full-page detail with
 * breadcrumb and actions, and a full-page create form.
 */

import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ListAltIcon from "@mui/icons-material/ListAlt";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import SearchIcon from "@mui/icons-material/Search";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, type ReactNode, useMemo, useRef, useState } from "react";

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
  TConfirmDialog,
  TDataGrid,
  type TDataGridColumn,
  TRemarkField,
  TSearchableSelect,
  TStatusChip,
  useConfirmDialog,
} from "@/components/tijaero";
import { bankReconciliationApi, chartOfAccountsApi } from "@/modules/finance/api";
import type {
  BankAccount,
  BankAccountCreate,
  BankAmount,
  BankGLItem,
  BankStatementDetail,
  BankStatementLine,
  BankStatementLineStatus,
  BankStatementListItem,
  ChartOfAccount,
} from "@/modules/finance/types";
import { submitOnce } from "@/modules/finance/submitOnce";
import { invalidateLedgerQueries } from "@/modules/finance/ledgerQueries";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (v: BankAmount | null | undefined) =>
  Number(v ?? 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Amount in cents, so sums compare exactly. */
const cents = (v: BankAmount | null | undefined) => Math.round(Number(v ?? 0) * 100);

const iso = (d: Date) => {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
const today = new Date();
const MONTH_START = iso(new Date(today.getFullYear(), today.getMonth(), 1));
const MONTH_END = iso(new Date(today.getFullYear(), today.getMonth() + 1, 0));

const daysBetween = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;

const accountLabel = (a?: ChartOfAccount | null) => (a ? `${a.account_code} · ${a.account_name}` : "");

const STATUS_CHIP: Record<BankStatementLineStatus, { label: string; color: "success" | "primary" | "info" | "warning" }> =
  {
    auto: { label: "Matched automatically", color: "success" },
    manual: { label: "Matched", color: "primary" },
    created: { label: "Entry created", color: "info" },
    unmatched: { label: "Not matched", color: "warning" },
  };

const bankKeys = {
  accounts: ["bank-accounts"] as const,
  statements: (bankAccountId: number) => ["bank-statements", bankAccountId] as const,
  statement: (id: number) => ["bank-statement", id] as const,
};

/** Active accounts that can be posted to: not a heading (some active account's parent). */
function postableAccounts(accounts: ChartOfAccount[]) {
  const parents = new Set(accounts.filter((a) => a.is_active).map((a) => a.parent_account_id));
  return accounts.filter((a) => a.is_active && !parents.has(a.id));
}

// ─── CSV parsing (in the browser) ─────────────────────────────────────────────
interface DraftLine {
  key: number;
  line_date: string;
  description: string;
  reference: string;
  amount: string;
}

let draftKey = 1;
const newDraftLine = (partial?: Partial<DraftLine>): DraftLine => ({
  key: draftKey++,
  line_date: "",
  description: "",
  reference: "",
  amount: "",
  ...partial,
});

/** YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY (also DD.MM.YYYY) → YYYY-MM-DD, or null. */
function parseDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s.*)?$/);
    if (!match) return null;
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "1,234.50", "(1,234.50)", "-1234.5", "LKR 1,234.50" → number; "" → null. */
function parseAmount(raw: string | undefined): number | null {
  if (raw == null) return null;
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[^0-9.-]/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!s || s === ".") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function splitCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const counts = [",", ";", "\t"].map((c) => [c, firstLine.split(c).length] as const);
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

interface CsvResult {
  lines: DraftLine[];
  skipped: number;
  columns: string;
  error?: string;
}

function parseStatementCsv(text: string): CsvResult {
  const rows = splitCsv(text);
  if (rows.length === 0) return { lines: [], skipped: 0, columns: "", error: "The file is empty." };

  const find = (header: string[], re: RegExp, exclude?: RegExp) =>
    header.findIndex((h) => re.test(h) && !(exclude && exclude.test(h)));

  // Header row: the first of the top rows with a date column and some amount column(s).
  for (let h = 0; h < Math.min(rows.length, 15); h++) {
    const header = rows[h].map((c) => c.trim().toLowerCase());
    const dateCol = find(header, /date/, /value date/) >= 0 ? find(header, /date/, /value date/) : find(header, /date/);
    const debitCol = find(header, /debit|withdraw|paid out|money out|^dr$/);
    const creditCol = find(header, /credit|deposit|paid in|money in|^cr$/);
    const amountCol = find(header, /amount/, /balance/);
    if (dateCol < 0 || (amountCol < 0 && (debitCol < 0 || creditCol < 0))) continue;
    const descCol = find(header, /desc|narration|detail|particular|remark|memo|transaction/, /date|ref|type/);
    const refCol = find(header, /ref|cheque|chq|check|instrument/);
    const useSplit = debitCol >= 0 && creditCol >= 0;

    const lines: DraftLine[] = [];
    let skipped = 0;
    for (const r of rows.slice(h + 1)) {
      const date = parseDate(r[dateCol] ?? "");
      let amount: number | null;
      if (useSplit) {
        const out = parseAmount(r[debitCol]);
        const inn = parseAmount(r[creditCol]);
        amount = out == null && inn == null ? null : (inn ?? 0) - Math.abs(out ?? 0);
      } else amount = parseAmount(r[amountCol]);
      if (!date || amount == null || cents(amount) === 0) {
        skipped++;
        continue;
      }
      lines.push(
        newDraftLine({
          line_date: date,
          description: descCol >= 0 ? (r[descCol] ?? "").trim() : "",
          reference: refCol >= 0 ? (r[refCol] ?? "").trim() : "",
          amount: String(amount),
        })
      );
    }
    const original = rows[h].map((c) => c.trim());
    const columns = [
      `date "${original[dateCol]}"`,
      descCol >= 0 ? `description "${original[descCol]}"` : null,
      refCol >= 0 ? `reference "${original[refCol]}"` : null,
      useSplit
        ? `money out "${original[debitCol]}", money in "${original[creditCol]}"`
        : `amount "${original[amountCol]}"`,
    ]
      .filter(Boolean)
      .join(", ");
    if (lines.length === 0)
      return { lines, skipped, columns, error: "Found the header row but no lines with a valid date and amount." };
    return { lines, skipped, columns };
  }
  return {
    lines: [],
    skipped: 0,
    columns: "",
    error:
      "Could not find a header row. The CSV needs a Date column and either an Amount column or separate " +
      "Debit/Withdrawal and Credit/Deposit columns.",
  };
}


// ─── Small pieces ─────────────────────────────────────────────────────────────
function MoneyCells({ amount }: { amount: BankAmount }) {
  const n = Number(amount);
  return (
    <>
      <TableCell align="right">{n > 0 ? fmt(n) : ""}</TableCell>
      <TableCell align="right">{n < 0 ? fmt(-n) : ""}</TableCell>
    </>
  );
}

const glRef = (g: BankGLItem) => g.reference_no || g.journal_entry_no || g.reference_type || "";

// ─── Match a statement line with book entries ─────────────────────────────────
function MatchDialog({
  line,
  candidates,
  onClose,
  onMatch,
  pending,
}: {
  line: BankStatementLine;
  candidates: BankGLItem[];
  onClose: () => void;
  onMatch: (glIds: number[]) => void;
  pending: boolean;
}) {
  const target = cents(line.amount);
  const sorted = useMemo(
    () =>
      [...candidates].sort(
        (a, b) =>
          Number(cents(b.amount) === target) - Number(cents(a.amount) === target) ||
          Number(Math.sign(cents(b.amount)) === Math.sign(target)) -
            Number(Math.sign(cents(a.amount)) === Math.sign(target)) ||
          daysBetween(a.transaction_date, line.line_date) - daysBetween(b.transaction_date, line.line_date)
      ),
    [candidates, target, line.line_date]
  );
  const [selected, setSelected] = useState<Set<number>>(() => {
    const best = sorted.find((c) => cents(c.amount) === target);
    return new Set(best ? [best.gl_id] : []);
  });
  const [search, setSearch] = useState("");

  const q = search.trim().toLowerCase();
  const visible = q
    ? sorted.filter((c) =>
        [c.description, c.reference_no, c.journal_entry_no, c.transaction_date, fmt(c.amount)]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      )
    : sorted;
  const total = candidates.filter((c) => selected.has(c.gl_id)).reduce((s, c) => s + cents(c.amount), 0);
  const gap = (target - total) / 100;

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Match with entries in your books
        <Typography variant="body2" color="text.secondary">
          {line.line_date} · {line.description || line.reference || "Statement line"} ·{" "}
          <b>
            {Number(line.amount) >= 0 ? "Money in" : "Money out"} {fmt(Math.abs(Number(line.amount)))}
          </b>
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            Tick the book entries this bank line is for. Several entries can make up one line (e.g. a deposit of
            several receipts); they must add up exactly to the line amount.
          </Typography>
          <TextField
            size="small"
            placeholder="Search description, reference, amount or date"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {candidates.length === 0 ? (
            <Alert severity="info">There are no unmatched entries in the books for this bank account.</Alert>
          ) : (
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 380 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" />
                    <TableCell>Date</TableCell>
                    <TableCell>Description</TableCell>
                    <TableCell>Reference</TableCell>
                    <TableCell align="right">Money in</TableCell>
                    <TableCell align="right">Money out</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {visible.map((c) => (
                    <TableRow
                      key={c.gl_id}
                      hover
                      selected={selected.has(c.gl_id)}
                      onClick={() => toggle(c.gl_id)}
                      sx={{ cursor: "pointer" }}
                    >
                      <TableCell padding="checkbox">
                        <Checkbox size="small" checked={selected.has(c.gl_id)} />
                      </TableCell>
                      <TableCell>{c.transaction_date}</TableCell>
                      <TableCell>
                        {c.description}
                        {cents(c.amount) === target && (
                          <TChip size="small" color="success" variant="outlined" label="Same amount" sx={{ ml: 1 }} />
                        )}
                      </TableCell>
                      <TableCell>
                        {glRef(c)}
                        {c.journal_entry_no && c.journal_entry_no !== glRef(c) && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {c.journal_entry_no}
                          </Typography>
                        )}
                      </TableCell>
                      <MoneyCells amount={c.amount} />
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="body2">
            Selected {selected.size}: <b>{fmt(total / 100)}</b> of {fmt(line.amount)}
          </Typography>
          <Typography variant="caption" color={gap === 0 ? "success.main" : "error.main"}>
            {selected.size === 0 ? "Tick at least one entry" : gap === 0 ? "Adds up exactly" : `Still ${fmt(gap)} apart`}
          </Typography>
        </Box>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={selected.size === 0 || gap !== 0 || pending}
          onClick={() => onMatch(Array.from(selected))}
          startIcon={pending ? <CircularProgress size={16} /> : undefined}
        >
          Match
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Book a bank-only line (fee, interest…) ──────────────────────────────────
function BookEntryDialog({
  line,
  bankGlAccountId,
  onClose,
  onBook,
  pending,
}: {
  line: BankStatementLine;
  bankGlAccountId?: number;
  onClose: () => void;
  onBook: (data: { account_id: number; description?: string | null }) => void;
  pending: boolean;
}) {
  const moneyIn = Number(line.amount) > 0;
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["chart-of-accounts-all"],
    queryFn: () => chartOfAccountsApi.getAll({ is_active: true, limit: 1000 }),
  });
  const options = useMemo(
    () => postableAccounts(accounts).filter((a) => a.id !== bankGlAccountId),
    [accounts, bankGlAccountId]
  );
  const [picked, setPicked] = useState<number | null>(null);
  const [description, setDescription] = useState(line.description || "");
  const suggested = options.find((o) => o.account_code === (moneyIn ? "4120" : "5184"));
  const accountId = picked ?? suggested?.id ?? null;

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Book it in your books
        <Typography variant="body2" color="text.secondary">
          {line.line_date} · {line.description || line.reference || "Statement line"} ·{" "}
          <b>
            {moneyIn ? "Money in" : "Money out"} {fmt(Math.abs(Number(line.amount)))}
          </b>
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            For things only the bank knew about, such as bank charges or interest. A journal entry is posted between
            this bank account and the account you choose, and matched to the line.
          </Typography>
          <Autocomplete
            size="small"
            loading={isLoading}
            options={options}
            value={options.find((o) => o.id === accountId) ?? null}
            onChange={(_, v) => setPicked(v ? v.id : null)}
            getOptionLabel={accountLabel}
            isOptionEqualToValue={(o, v) => o.id === v.id}
            renderInput={(params) => (
              <TextField
                {...params}
                label={moneyIn ? "What is this money for?" : "What was this money spent on?"}
                helperText={moneyIn ? "Usually 4120 Interest Received" : "Usually 5184 Bank Charges"}
              />
            )}
          />
          <TextField
            label="Description"
            size="small"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            inputProps={{ maxLength: 500 }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={accountId === null || pending}
          onClick={() => onBook({ account_id: accountId as number, description: description.trim() || null })}
          startIcon={pending ? <CircularProgress size={16} /> : undefined}
        >
          Post entry
        </Button>
      </DialogActions>
    </Dialog>
  );
}


const BREADCRUMBS = [
  { label: "Finance", href: "/finance" },
  { label: "Bank Reconciliation", href: "/finance/bank-reconciliation" },
];

const STATEMENT_STATUS_OPTIONS = [
  { value: "open", label: "Open", color: "warning" as const },
  { value: "reconciled", label: "Reconciled", color: "success" as const },
];

const statementLabel = (s: { id: number; statement_no?: string | null }) => s.statement_no || `#${s.id}`;

/** Full-page shell shared by every detail / create view on this page. */
function DetailShell({ header, toolbar, children }: { header: ReactNode; toolbar: ReactNode; children: ReactNode }) {
  return (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {header}
      {toolbar}
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>{children}</Box>
    </Box>
  );
}

// ─── Add bank account (full-page form) ────────────────────────────────────────
function AddBankAccountPanel({
  existing,
  onCancel,
  onCreated,
}: {
  existing: BankAccount[];
  onCancel: () => void;
  onCreated: (a: BankAccount) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<BankAccountCreate>({
    name: "",
    bank_name: "",
    account_number: "",
    branch_code: "",
    reconcile_from: "",
    notes: "",
  });
  const [createLedger, setCreateLedger] = useState(true);
  const [accountId, setAccountId] = useState<number | null>(null);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["chart-of-accounts-all"],
    queryFn: () => chartOfAccountsApi.getAll({ is_active: true, limit: 1000 }),
    enabled: !createLedger,
  });
  const options = useMemo(() => {
    const linked = new Set(existing.map((b) => b.account_id));
    return postableAccounts(accounts).filter((a) => a.account_type === "Asset" && !linked.has(a.id));
  }, [accounts, existing]);

  const save = useMutation({
    mutationFn: () =>
      bankReconciliationApi.createAccount({
        name: form.name.trim(),
        bank_name: form.bank_name?.trim() || null,
        account_number: form.account_number?.trim() || null,
        branch_code: form.branch_code?.trim() || null,
        reconcile_from: form.reconcile_from || null,
        notes: form.notes?.trim() || null,
        ...(createLedger ? {} : { account_id: accountId }),
      }),
    onSuccess: (a) => {
      queryClient.invalidateQueries({ queryKey: bankKeys.accounts });
      queryClient.invalidateQueries({ queryKey: ["chart-of-accounts-all"] });
      showSuccessToast(`Bank account "${a.name}" added (ledger account ${a.account_code}).`);
      onCreated(a);
    },
    onError: (err) => handleApiError(err, "Could not add the bank account"),
  });

  const canSave = !!form.name.trim() && (createLedger || accountId !== null);
  const set = (k: keyof BankAccountCreate) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <DetailShell
      header={
        <DetailPanelHeader
          breadcrumbs={[...BREADCRUMBS, { label: "New Bank Account" }]}
          title=""
          titleIcon={<AccountBalanceIcon color="primary" />}
          isCreating
          createTitle="New Bank Account"
        />
      }
      toolbar={
        <ActionToolbar
          isCreating
          isEditing={false}
          isSaving={save.isPending}
          isFormValid={canSave}
          onSave={() => submitOnce("BankReconciliationPage-save-1", save)}
          onCancel={onCancel}
        />
      }
    >
      <FormSection title="Bank Account" columns={2}>
        <TextField
          label="Name"
          size="small"
          required
          value={form.name}
          onChange={set("name")}
          placeholder="e.g. BOC Current Account"
          inputProps={{ maxLength: 100 }}
        />
        <TextField label="Account number" size="small" value={form.account_number} onChange={set("account_number")} inputProps={{ maxLength: 50 }} />
        <TextField label="Bank" size="small" value={form.bank_name} onChange={set("bank_name")} inputProps={{ maxLength: 100 }} />
        <TextField label="Bank branch" size="small" value={form.branch_code} onChange={set("branch_code")} />
        <TextField
          label="Check from"
          type="date"
          size="small"
          value={form.reconcile_from}
          onChange={set("reconcile_from")}
          InputLabelProps={{ shrink: true }}
          helperText="Entries in the books before this date count as already checked. Leave empty to check everything."
        />
      </FormSection>
      <FormSection title="Ledger Account" columns={1}>
        <Box>
          <FormControlLabel
            control={<Checkbox checked={createLedger} onChange={(e) => setCreateLedger(e.target.checked)} />}
            label="Create a new ledger account for it"
          />
          {createLedger && (
            <Typography variant="caption" color="text.secondary" display="block">
              A new account is added under 1000 Cash &amp; Bank in the chart of accounts.
            </Typography>
          )}
        </Box>
        {!createLedger && (
          <Autocomplete
            size="small"
            loading={isLoading}
            options={options}
            value={options.find((o) => o.id === accountId) ?? null}
            onChange={(_, v) => setAccountId(v ? v.id : null)}
            getOptionLabel={accountLabel}
            isOptionEqualToValue={(o, v) => o.id === v.id}
            renderInput={(params) => (
              <TextField
                {...params}
                required
                label="Ledger account this bank's money is posted to"
                helperText="Asset accounts that can be posted to and aren't linked to another bank account."
              />
            )}
          />
        )}
      </FormSection>
      <FormSection title="Remarks" columns={1}>
        <TRemarkField
          label="Note (optional)"
          size="small"
          value={form.notes ?? ""}
          onChange={(v) => setForm({ ...form, notes: v })}
          multiline
          rows={2}
        />
      </FormSection>
    </DetailShell>
  );
}

// ─── Bank account detail (read-only) ──────────────────────────────────────────
function BankAccountDetailPanel({
  account,
  canReconcile,
  onViewStatements,
  onNewStatement,
}: {
  account: BankAccount;
  canReconcile: boolean;
  onViewStatements: () => void;
  onNewStatement: () => void;
}) {
  return (
    <DetailShell
      header={
        <DetailPanelHeader
          breadcrumbs={[...BREADCRUMBS, { label: account.name }]}
          title={account.name}
          titleIcon={<AccountBalanceIcon color="primary" />}
          chips={[getStatusProps(account.is_active ? "active" : "inactive", "financeDocument")]}
        />
      }
      toolbar={
        <ActionToolbar
          hasSelectedItem
          isCreating={false}
          isEditing={false}
          endActions={
            <>
              <Button size="small" variant="outlined" startIcon={<ListAltIcon />} onClick={onViewStatements}>
                View Statements
              </Button>
              {canReconcile && account.is_active && (
                <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={onNewStatement}>
                  New Statement
                </Button>
              )}
            </>
          }
        />
      }
    >
      <FormSection title="Bank Account" columns={3}>
        <TextField label="Name" size="small" value={account.name} disabled />
        <TextField label="Bank" size="small" value={account.bank_name ?? ""} disabled />
        <TextField label="Bank branch" size="small" value={account.branch_code ?? ""} disabled />
        <TextField label="Account number" size="small" value={account.account_number ?? ""} disabled />
        <TextField label="Currency" size="small" value={account.currency} disabled />
        <TextField label="Check from" size="small" value={account.reconcile_from ?? ""} disabled />
      </FormSection>
      <FormSection title="Books" columns={3}>
        <TextField
          label="Ledger account"
          size="small"
          value={`${account.account_code} · ${account.account_name}`}
          disabled
        />
        <TextField
          label="Balance in the books"
          size="small"
          value={`${fmt(account.book_balance)} ${account.currency}`}
          disabled
        />
        <TextField
          label="Checked up to"
          size="small"
          value={account.last_reconciled_to ?? "Not checked yet"}
          disabled
          helperText={account.open_statements > 0 ? `${account.open_statements} open statement(s)` : " "}
        />
      </FormSection>
      <FormSection title="Remarks" columns={1}>
        <TRemarkField label="Note" size="small" value={account.notes ?? ""} onChange={() => undefined} disabled multiline rows={2} />
      </FormSection>
    </DetailShell>
  );
}

// ─── New statement (full-page form) ───────────────────────────────────────────
function NewStatementPanel({
  accounts,
  initialAccountId,
  onCancel,
  onCreated,
}: {
  accounts: BankAccount[];
  initialAccountId: number | null;
  onCancel: () => void;
  onCreated: (d: BankStatementDetail) => void;
}) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const activeAccounts = accounts.filter((a) => a.is_active);
  const [bankAccountId, setBankAccountId] = useState<number | null>(
    activeAccounts.some((a) => a.id === initialAccountId) ? initialAccountId : (activeAccounts[0]?.id ?? null)
  );
  const bankAccount = activeAccounts.find((a) => a.id === bankAccountId) ?? null;
  const [statementNo, setStatementNo] = useState("");
  const [dateFrom, setDateFrom] = useState(MONTH_START);
  const [dateTo, setDateTo] = useState(MONTH_END);
  const [opening, setOpening] = useState("");
  const [closing, setClosing] = useState("");
  const [notes, setNotes] = useState("");
  const [mode, setMode] = useState(0);
  const [csvText, setCsvText] = useState("");
  const [csvInfo, setCsvInfo] = useState<{ error?: string; message?: string } | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);

  const readCsv = (text: string) => {
    const r = parseStatementCsv(text);
    if (r.error) {
      setCsvInfo({ error: r.error });
      return;
    }
    setLines(r.lines);
    setCsvInfo({
      message:
        `Read ${r.lines.length} line${r.lines.length === 1 ? "" : "s"} using ${r.columns}.` +
        (r.skipped ? ` Skipped ${r.skipped} row${r.skipped === 1 ? "" : "s"} without a date or amount (totals, balances…).` : ""),
    });
    // Suggest the period from the lines when the dates were left at their defaults.
    const dates = r.lines.map((l) => l.line_date).sort();
    if (dates.length && dateFrom === MONTH_START && dateTo === MONTH_END) {
      setDateFrom(dates[0]);
      setDateTo(dates[dates.length - 1]);
    }
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setCsvText(text);
      readCsv(text);
    };
    reader.readAsText(file);
  };

  const parsed = lines.map((l) => ({ ...l, n: parseAmount(l.amount), ok: !!parseDate(l.line_date) }));
  const linesTotal = parsed.reduce((s, l) => s + cents(l.n ?? 0), 0) / 100;
  const openingN = parseAmount(opening);
  const closingN = parseAmount(closing);
  const computedClosing = (openingN ?? 0) + linesTotal;
  const balanceGap = closingN == null ? null : (cents(closingN) - cents(computedClosing)) / 100;
  const datesValid = !!dateFrom && !!dateTo && dateFrom <= dateTo;
  const outside = (d: string) => datesValid && !!d && (d < dateFrom || d > dateTo);
  const outsideCount = parsed.filter((l) => l.ok && outside(l.line_date)).length;
  const invalidCount = parsed.filter((l) => !l.ok || l.n == null || cents(l.n) === 0).length;

  const updateLine = (key: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = useMutation({
    mutationFn: () =>
      bankReconciliationApi.createStatement({
        bank_account_id: bankAccount!.id,
        statement_no: statementNo.trim() || null,
        date_from: dateFrom,
        date_to: dateTo,
        opening_balance: openingN ?? 0,
        closing_balance: closingN ?? 0,
        notes: notes.trim() || null,
        lines: parsed.map((l) => ({
          line_date: l.line_date,
          description: l.description.trim() || null,
          reference: l.reference.trim() || null,
          amount: l.n as number,
        })),
        auto_match: true,
      }),
    onSuccess: (d) => {
      queryClient.setQueryData(bankKeys.statement(d.id), d);
      queryClient.invalidateQueries({ queryKey: bankKeys.statements(d.bank_account_id) });
      invalidateLedgerQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: bankKeys.accounts });
      const matched = d.lines.filter((l) => l.status !== "unmatched").length;
      showSuccessToast(`Statement saved. ${matched} of ${d.lines.length} lines matched automatically.`);
      onCreated(d);
    },
    onError: (err) => handleApiError(err, "Could not save the statement"),
  });

  const canSave = !!bankAccount && datesValid && openingN != null && closingN != null && invalidCount === 0;

  return (
    <DetailShell
      header={
        <DetailPanelHeader
          breadcrumbs={[...BREADCRUMBS, { label: "New Statement" }]}
          title=""
          titleIcon={<ReceiptLongIcon color="primary" />}
          isCreating
          createTitle={bankAccount ? `New Statement · ${bankAccount.name}` : "New Statement"}
        />
      }
      toolbar={
        <ActionToolbar
          isCreating
          isEditing={false}
          isSaving={save.isPending}
          isFormValid={canSave}
          onSave={() => submitOnce("BankReconciliationPage-save-2", save)}
          onCancel={onCancel}
        />
      }
    >
      <Alert severity="info" variant="outlined" sx={{ mb: 1.5 }}>
        Copy the figures from the bank statement. Lines are matched with your books automatically when you save.
      </Alert>
      <FormSection title="Statement" columns={3}>
        <TSearchableSelect
          label="Bank account"
          required
          value={bankAccountId}
          onChange={(v) => setBankAccountId(v == null ? null : Number(v))}
          options={activeAccounts.map((a) => ({ value: a.id, label: a.name, secondary: a.bank_name ?? undefined }))}
          size="small"
          clearable={false}
        />
        <TextField label="Statement no." size="small" value={statementNo} onChange={(e) => setStatementNo(e.target.value)} />
        <Box />
        <TextField
          label="From"
          type="date"
          size="small"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          InputLabelProps={{ shrink: true }}
          required
          error={!datesValid}
        />
        <TextField
          label="To"
          type="date"
          size="small"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          InputLabelProps={{ shrink: true }}
          required
          error={!datesValid}
          helperText={!datesValid ? 'The "From" date must be on or before the "To" date.' : undefined}
        />
        <Box />
        <TextField
          label="Opening balance"
          size="small"
          value={opening}
          onChange={(e) => setOpening(e.target.value)}
          inputProps={{ inputMode: "decimal" }}
          required
          helperText="Balance at the start, as printed"
        />
        <TextField
          label="Closing balance"
          size="small"
          value={closing}
          onChange={(e) => setClosing(e.target.value)}
          inputProps={{ inputMode: "decimal" }}
          required
          helperText="Balance at the end, as printed"
        />
      </FormSection>

      <FormSection
        title="Statement Lines"
        columns={1}
        titleAction={
          mode === 1 ? (
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setLines((ls) => [...ls, newDraftLine({ line_date: ls[ls.length - 1]?.line_date ?? dateFrom })])}
            >
              Add line
            </Button>
          ) : undefined
        }
      >
        <Tabs value={mode} onChange={(_, v) => setMode(v)} sx={{ borderBottom: 1, borderColor: "divider" }}>
          <Tab label="Upload or paste a CSV" sx={{ textTransform: "none" }} />
          <Tab label="Type the lines" sx={{ textTransform: "none" }} />
        </Tabs>

        {mode === 0 && (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              Download the statement from online banking as CSV. It needs a date column and either one amount column
              (withdrawals negative) or separate withdrawal and deposit columns. Dates may be 2026-10-31, 31/10/2026 or
              31-10-2026.
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button size="small" variant="outlined" startIcon={<UploadFileIcon />} onClick={() => fileRef.current?.click()}>
                Choose CSV file
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt,text/csv"
                hidden
                onChange={(e) => {
                  handleFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <Button size="small" variant="outlined" disabled={!csvText.trim()} onClick={() => readCsv(csvText)}>
                Read pasted text
              </Button>
            </Stack>
            <TextField
              label="…or paste the CSV here"
              size="small"
              multiline
              minRows={3}
              maxRows={8}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              InputProps={{ sx: { fontFamily: "monospace", fontSize: 12 } }}
            />
            {csvInfo?.error && <Alert severity="error">{csvInfo.error}</Alert>}
            {csvInfo?.message && <Alert severity="info">{csvInfo.message}</Alert>}
          </Stack>
        )}

        {lines.length > 0 && (
          <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 380 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 160 }}>Date</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell sx={{ width: 150 }}>Reference</TableCell>
                  <TableCell align="right" sx={{ width: 150 }}>
                    {mode === 1 ? "Amount (− for money out)" : "Money in"}
                  </TableCell>
                  {mode === 0 && (
                    <TableCell align="right" sx={{ width: 130 }}>
                      Money out
                    </TableCell>
                  )}
                  <TableCell sx={{ width: 48 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {parsed.map((l) => {
                  const flag = l.ok && outside(l.line_date);
                  return (
                    <TableRow key={l.key} sx={flag ? { bgcolor: "warning.light" } : undefined}>
                      {mode === 0 ? (
                        <>
                          <TableCell>
                            {l.line_date}
                            {flag && (
                              <Typography variant="caption" color="warning.dark" display="block">
                                Outside the statement dates
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>{l.description}</TableCell>
                          <TableCell>{l.reference}</TableCell>
                          <MoneyCells amount={l.n ?? 0} />
                        </>
                      ) : (
                        <>
                          <TableCell>
                            <TextField
                              type="date"
                              size="small"
                              value={l.line_date}
                              onChange={(e) => updateLine(l.key, { line_date: e.target.value })}
                              error={!l.ok || flag}
                              helperText={flag ? "Outside the statement dates" : undefined}
                              fullWidth
                            />
                          </TableCell>
                          <TableCell>
                            <TextField
                              size="small"
                              value={l.description}
                              onChange={(e) => updateLine(l.key, { description: e.target.value })}
                              fullWidth
                            />
                          </TableCell>
                          <TableCell>
                            <TextField
                              size="small"
                              value={l.reference}
                              onChange={(e) => updateLine(l.key, { reference: e.target.value })}
                              fullWidth
                            />
                          </TableCell>
                          <TableCell>
                            <TextField
                              size="small"
                              value={l.amount}
                              onChange={(e) => updateLine(l.key, { amount: e.target.value })}
                              error={l.amount !== "" && (l.n == null || cents(l.n) === 0)}
                              inputProps={{ inputMode: "decimal", style: { textAlign: "right" } }}
                              fullWidth
                            />
                          </TableCell>
                        </>
                      )}
                      <TableCell>
                        <IconButton
                          size="small"
                          aria-label="Remove line"
                          onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {lines.length === 0 && mode === 1 && (
          <Typography variant="body2" color="text.secondary">
            No lines yet. Use "Add line" for each line on the statement.
          </Typography>
        )}

        {outsideCount > 0 && (
          <Alert severity="warning">
            {outsideCount} line{outsideCount === 1 ? " is" : "s are"} dated outside {dateFrom} – {dateTo}. Check the
            statement dates or remove those lines.
          </Alert>
        )}
        {invalidCount > 0 && (
          <Alert severity="error">
            {invalidCount} line{invalidCount === 1 ? " needs" : "s need"} a valid date and a non-zero amount.
          </Alert>
        )}
      </FormSection>

      <FormSection title="Check" columns={3}>
        <TextField
          label={`Opening balance + ${lines.length} line${lines.length === 1 ? "" : "s"}`}
          size="small"
          value={`${fmt(openingN ?? 0)} ${linesTotal < 0 ? "−" : "+"} ${fmt(Math.abs(linesTotal))} = ${fmt(computedClosing)}`}
          disabled
        />
        <TextField
          label="Closing balance on the statement"
          size="small"
          value={closingN == null ? "—" : fmt(closingN)}
          disabled
        />
        <TextField
          label="Check"
          size="small"
          value={
            balanceGap == null
              ? "Enter the closing balance"
              : balanceGap === 0
                ? "Adds up"
                : `Off by ${fmt(balanceGap)}: a line may be missing or mistyped`
          }
          disabled
          error={balanceGap != null && balanceGap !== 0}
        />
      </FormSection>

      <FormSection title="Remarks" columns={1}>
        <TRemarkField label="Note (optional)" size="small" value={notes} onChange={(v) => setNotes(v)} multiline rows={2} />
      </FormSection>
    </DetailShell>
  );
}

// ─── Statement detail ─────────────────────────────────────────────────────────
function StatementDetailPanel({
  statementId,
  accounts,
  canEdit,
  onDeleted,
}: {
  statementId: number;
  accounts: BankAccount[];
  canEdit: boolean;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();
  const [matching, setMatching] = useState<BankStatementLine | null>(null);
  const [booking, setBooking] = useState<BankStatementLine | null>(null);

  const { data: st, isLoading, error } = useQuery({
    queryKey: bankKeys.statement(statementId),
    queryFn: () => bankReconciliationApi.getStatement(statementId),
  });
  const bankAccount = accounts.find((a) => a.id === st?.bank_account_id);

  const refreshLists = () => {
    queryClient.invalidateQueries({ queryKey: bankKeys.accounts });
    invalidateLedgerQueries(queryClient);
    if (st) queryClient.invalidateQueries({ queryKey: bankKeys.statements(st.bank_account_id) });
  };
  const onFresh = (d: BankStatementDetail) => {
    queryClient.setQueryData(bankKeys.statement(d.id), d);
    refreshLists();
  };

  const autoMatch = useMutation({
    mutationFn: () => bankReconciliationApi.autoMatch(statementId),
    onSuccess: (d) => {
      const before = st?.lines.filter((l) => l.status === "unmatched").length ?? 0;
      const after = d.lines.filter((l) => l.status === "unmatched").length;
      onFresh(d);
      showSuccessToast(before > after ? `Matched ${before - after} more line(s).` : "No new matches found.");
    },
    onError: (err) => handleApiError(err, "Could not match automatically"),
  });
  const match = useMutation({
    mutationFn: ({ lineId, glIds }: { lineId: number; glIds: number[] }) =>
      bankReconciliationApi.matchLine(lineId, glIds),
    onSuccess: (d) => {
      onFresh(d);
      setMatching(null);
      showSuccessToast("Line matched.");
    },
    onError: (err) => handleApiError(err, "Could not match the line"),
  });
  const unmatch = useMutation({
    mutationFn: (lineId: number) => bankReconciliationApi.unmatchLine(lineId),
    onSuccess: (d) => {
      onFresh(d);
      showSuccessToast("Match undone.");
    },
    onError: (err) => handleApiError(err, "Could not undo the match"),
  });
  const book = useMutation({
    mutationFn: ({ lineId, data }: { lineId: number; data: { account_id: number; description?: string | null } }) =>
      bankReconciliationApi.createEntryForLine(lineId, data),
    onSuccess: (d) => {
      onFresh(d);
      setBooking(null);
      showSuccessToast("Entry posted and matched.");
    },
    onError: (err) => handleApiError(err, "Could not post the entry"),
  });
  const finish = useMutation({
    mutationFn: () => bankReconciliationApi.finish(statementId),
    onSuccess: (d) => {
      onFresh(d);
      showSuccessToast("Reconciliation finished. Books and bank statement agree.");
    },
    onError: (err) => handleApiError(err, "Could not finish the reconciliation"),
  });
  const reopen = useMutation({
    mutationFn: () => bankReconciliationApi.reopen(statementId),
    onSuccess: (d) => {
      onFresh(d);
      showSuccessToast("Statement reopened.");
    },
    onError: (err) => handleApiError(err, "Could not reopen the statement"),
  });
  const remove = useMutation({
    mutationFn: () => bankReconciliationApi.deleteStatement(statementId),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: bankKeys.statement(statementId) });
      refreshLists();
      showSuccessToast("Statement deleted.");
      onDeleted();
    },
    onError: (err) => handleApiError(err, "Could not delete the statement"),
  });

  const reconciled = st?.status === "reconciled";
  const editable = !!st && canEdit && !reconciled;
  const busy = autoMatch.isPending || match.isPending || unmatch.isPending || book.isPending;

  const handleDelete = async () => {
    const ok = await confirmDialog.confirm({
      title: "Delete this statement?",
      message:
        "The statement and its lines are removed and their matches undone. Journal entries already posted from " +
        "\"Book it\" stay in the books (and will show up for matching on the next statement).",
      confirmText: "Delete statement",
      confirmColor: "danger",
    });
    if (ok) remove.mutate();
  };
  const handleReopen = async () => {
    const ok = await confirmDialog.confirm({
      title: "Reopen this statement?",
      message: "You can change matches again, then finish it once more.",
      confirmText: "Reopen",
    });
    if (ok) reopen.mutate();
  };

  const s = st?.summary;
  const differenceZero = !!s && cents(s.difference) === 0;
  const canFinish = !!s && differenceZero && s.unmatched_lines_count === 0;

  const endActions = st ? (
    <>
      {editable && (
        <>
          <Button
            size="small"
            variant="outlined"
            startIcon={autoMatch.isPending ? <CircularProgress size={16} /> : <AutoFixHighIcon />}
            disabled={busy || s!.unmatched_lines_count === 0}
            onClick={() => submitOnce("BankReconciliationPage-autoMatch-3", autoMatch)}
          >
            Match automatically
          </Button>
          <Tooltip
            title={
              canFinish
                ? ""
                : s!.unmatched_lines_count > 0
                  ? "Match or book every statement line first"
                  : "The difference must be 0 first"
            }
          >
            <span>
              <Button
                size="small"
                variant="contained"
                color="success"
                startIcon={finish.isPending ? <CircularProgress size={16} /> : <CheckCircleIcon />}
                disabled={!canFinish || finish.isPending || busy}
                onClick={() => submitOnce("BankReconciliationPage-finish-4", finish)}
              >
                Finish reconciliation
              </Button>
            </span>
          </Tooltip>
          <Button
            size="small"
            color="error"
            startIcon={remove.isPending ? <CircularProgress size={16} /> : <DeleteOutlineIcon />}
            disabled={remove.isPending}
            onClick={handleDelete}
          >
            Delete statement
          </Button>
        </>
      )}
      {canEdit && reconciled && (
        <Button
          size="small"
          variant="outlined"
          startIcon={reopen.isPending ? <CircularProgress size={16} /> : <LockOpenIcon />}
          disabled={reopen.isPending}
          onClick={handleReopen}
        >
          Reopen
        </Button>
      )}
    </>
  ) : undefined;

  const outstanding = st ? st.candidates.filter((c) => c.transaction_date <= st.date_to) : [];
  const outstandingTotal = outstanding.reduce((t, c) => t + cents(c.amount), 0) / 100;

  let body: ReactNode;
  if (isLoading) {
    body = (
      <Box textAlign="center" py={6}>
        <CircularProgress size={28} />
      </Box>
    );
  } else if (error || !st || !s) {
    body = <Alert severity="error">Could not load the statement.</Alert>;
  } else {
    body = (
      <>
        {reconciled && (
          <Alert severity="success" variant="outlined" sx={{ mb: 1.5 }}>
            Reconciled. Your books and this bank statement agree up to {st.date_to}.
          </Alert>
        )}
        {st.warnings.map((w) => (
          <Alert key={w} severity="warning" variant="outlined" sx={{ mb: 1.5 }}>
            {w}
          </Alert>
        ))}

        <FormSection title="Statement Information" columns={4}>
          <TextField label="Bank account" size="small" value={st.bank_account_name} disabled />
          <TextField label="Statement no." size="small" value={statementLabel(st)} disabled />
          <TextField label="From" size="small" value={st.date_from} disabled />
          <TextField label="To" size="small" value={st.date_to} disabled />
          <TextField label="Opening balance" size="small" value={fmt(st.opening_balance)} disabled />
          <TextField label="Closing balance" size="small" value={fmt(st.closing_balance)} disabled />
          <TextField label="Lines" size="small" value={String(st.lines.length)} disabled />
          <TextField label="Note" size="small" value={st.notes ?? ""} disabled />
        </FormSection>

        <FormSection title="Summary" columns={3}>
          <TextField
            label="Balance in your books"
            size="small"
            value={fmt(s.book_balance)}
            helperText={`On ${st.date_to}`}
            disabled
          />
          <TextField
            label="Not yet on the statement"
            size="small"
            value={fmt(s.outstanding_total)}
            helperText={`${s.outstanding_count} entr${s.outstanding_count === 1 ? "y" : "ies"} in the books only`}
            disabled
          />
          <TextField
            label="Only on the statement"
            size="small"
            value={fmt(s.unmatched_lines_total)}
            helperText={`${s.unmatched_lines_count} line${s.unmatched_lines_count === 1 ? "" : "s"} not matched yet`}
            disabled
          />
          <TextField label="Statement closing balance" size="small" value={fmt(s.statement_closing_balance)} disabled />
          <TextField
            label="Difference"
            size="small"
            value={differenceZero ? "Matches" : fmt(s.difference)}
            helperText={differenceZero ? "Books and bank agree" : "Books (adjusted) vs. statement"}
            error={!differenceZero}
            disabled
          />
        </FormSection>

        <FormSection title="Bank Statement Lines" columns={1}>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 110 }}>Date</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell>Reference</TableCell>
                  <TableCell align="right">Money in</TableCell>
                  <TableCell align="right">Money out</TableCell>
                  <TableCell>Status</TableCell>
                  {editable && <TableCell align="right" sx={{ width: 190 }} />}
                </TableRow>
              </TableHead>
              <TableBody>
                {st.lines.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={editable ? 7 : 6}>
                      <Typography variant="body2" color="text.secondary">
                        This statement has no lines.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {st.lines.map((l) => {
                  const chip = STATUS_CHIP[l.status] ?? STATUS_CHIP.unmatched;
                  return (
                    <TableRow key={l.id} hover>
                      <TableCell>{l.line_date}</TableCell>
                      <TableCell>
                        {l.description}
                        {l.matched.length > 0 && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            In the books:{" "}
                            {l.matched
                              .map((g) => `${g.transaction_date} ${glRef(g)}${l.matched.length > 1 ? ` (${fmt(g.amount)})` : ""}`)
                              .join(" · ")}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>{l.reference}</TableCell>
                      <MoneyCells amount={l.amount} />
                      <TableCell>
                        <TChip
                          size="small"
                          color={chip.color}
                          variant={l.status === "unmatched" ? "outlined" : "filled"}
                          label={chip.label}
                        />
                      </TableCell>
                      {editable && (
                        <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                          {l.status === "unmatched" ? (
                            <>
                              <Button size="small" disabled={busy} onClick={() => setMatching(l)}>
                                Match…
                              </Button>
                              <Button size="small" disabled={busy} onClick={() => setBooking(l)}>
                                Book it…
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="small"
                              color="inherit"
                              disabled={busy}
                              onClick={() => submitOnce("BankReconciliationPage-unmatch-5", unmatch, l.id)}
                            >
                              Undo
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </FormSection>

        <FormSection title="In the Books, Not Yet on the Bank Statement" columns={1} isLast>
          <Typography variant="body2" color="text.secondary">
            Entries dated up to {st.date_to} that the bank hasn&apos;t shown yet, e.g. cheques not yet cashed or deposits
            still clearing. They usually appear on the next statement.
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 110 }}>Date</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell>Reference</TableCell>
                  <TableCell align="right">Money in</TableCell>
                  <TableCell align="right">Money out</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {outstanding.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Typography variant="body2" color="text.secondary">
                        Nothing: every entry in the books up to {st.date_to} is on a bank statement.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {outstanding.map((c) => (
                      <TableRow key={c.gl_id}>
                        <TableCell>{c.transaction_date}</TableCell>
                        <TableCell>{c.description}</TableCell>
                        <TableCell>
                          {glRef(c)}
                          {c.journal_entry_no && c.journal_entry_no !== glRef(c) && (
                            <Typography variant="caption" color="text.secondary" display="block">
                              {c.journal_entry_no}
                            </Typography>
                          )}
                        </TableCell>
                        <MoneyCells amount={c.amount} />
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell colSpan={3} align="right">
                        <Typography variant="body2" fontWeight={700}>
                          Total ({outstanding.length})
                        </Typography>
                      </TableCell>
                      <TableCell colSpan={2} align="right">
                        <Typography variant="body2" fontWeight={700}>
                          {outstandingTotal >= 0 ? `${fmt(outstandingTotal)} in` : `${fmt(-outstandingTotal)} out`}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </FormSection>
      </>
    );
  }

  return (
    <DetailShell
      header={
        <DetailPanelHeader
          breadcrumbs={[...BREADCRUMBS, { label: st ? statementLabel(st) : "Statement" }]}
          title={st ? `Statement ${statementLabel(st)}` : ""}
          titleIcon={<ReceiptLongIcon color="primary" />}
          subtitle={st ? `${st.bank_account_name} · ${st.date_from} to ${st.date_to}` : undefined}
          noSelectionTitle="Loading statement…"
          chips={st ? [getStatusProps(st.status, "financeDocument")] : []}
        />
      }
      toolbar={<ActionToolbar hasSelectedItem={!!st} isCreating={false} isEditing={false} endActions={endActions} />}
    >
      {body}
      {matching && st && (
        <MatchDialog
          line={matching}
          candidates={st.candidates}
          onClose={() => setMatching(null)}
          pending={match.isPending}
          onMatch={(glIds) => submitOnce("BankReconciliationPage-match-6", match, { lineId: matching.id, glIds })}
        />
      )}
      {booking && (
        <BookEntryDialog
          line={booking}
          bankGlAccountId={bankAccount?.account_id}
          onClose={() => setBooking(null)}
          pending={book.isPending}
          onBook={(data) => submitOnce("BankReconciliationPage-book-7", book, { lineId: booking.id, data })}
        />
      )}
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </DetailShell>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
type PageTab = "statements" | "accounts";
const PAGE_TABS = [
  { id: "statements", label: "Statements" },
  { id: "accounts", label: "Bank Accounts" },
];

export default function BankReconciliationPage() {
  const queryClient = useQueryClient();
  const canAddAccount = usePermission("chart_of_accounts", "update");
  const canReconcile = usePermission("journal_entries", "create");

  const [tab, setTab] = useState<PageTab>("statements");
  // Statements tab
  const [pickedAccountId, setPickedAccountId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [statementId, setStatementId] = useState<number | null>(null);
  const [addingStatement, setAddingStatement] = useState(false);
  // Bank Accounts tab
  const [accountSearch, setAccountSearch] = useState("");
  const [viewAccountId, setViewAccountId] = useState<number | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);

  const { data: accounts, isLoading, error, refetch: refetchAccounts } = useQuery({
    queryKey: bankKeys.accounts,
    queryFn: bankReconciliationApi.listAccounts,
  });
  const selectedAccount =
    accounts?.find((a) => a.id === pickedAccountId) ?? accounts?.find((a) => a.is_active) ?? accounts?.[0] ?? null;

  const {
    data: statements,
    isLoading: loadingStatements,
    refetch: refetchStatements,
  } = useQuery({
    queryKey: bankKeys.statements(selectedAccount?.id ?? 0),
    queryFn: () => bankReconciliationApi.listStatements(selectedAccount!.id),
    enabled: !!selectedAccount,
  });

  const filteredStatements = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (statements ?? []).filter(
      (s) =>
        (!status || s.status === status) &&
        (!q || [s.statement_no, s.date_from, s.date_to, `#${s.id}`].some((v) => v?.toLowerCase().includes(q)))
    );
  }, [statements, search, status]);

  const filteredAccounts = useMemo(() => {
    const q = accountSearch.trim().toLowerCase();
    return (accounts ?? []).filter(
      (a) =>
        !q ||
        [a.name, a.bank_name, a.account_number, a.account_code, a.account_name].some((v) => v?.toLowerCase().includes(q))
    );
  }, [accounts, accountSearch]);

  const viewedAccount = accounts?.find((a) => a.id === viewAccountId) ?? null;
  const activeAccounts = (accounts ?? []).filter((a) => a.is_active);

  const statementColumns: TDataGridColumn<BankStatementListItem>[] = [
    {
      field: "statement_no",
      header: "Statement No",
      minWidth: 150,
      flex: 1,
      renderCell: (p) => statementLabel(p.row),
    },
    {
      field: "bank_account_id",
      header: "Bank Account",
      minWidth: 180,
      flex: 1.2,
      renderCell: (p) => accounts?.find((a) => a.id === p.row.bank_account_id)?.name ?? "",
    },
    { field: "date_from", header: "From", width: 120, type: "date" },
    { field: "date_to", header: "To", width: 120, type: "date" },
    { field: "opening_balance", header: "Opening Balance", width: 150, type: "currency", align: "right", headerAlign: "right" },
    { field: "closing_balance", header: "Closing Balance", width: 150, type: "currency", align: "right", headerAlign: "right" },
    { field: "reconciled_at", header: "Reconciled On", width: 130, type: "date" },
    {
      field: "status",
      header: "Status",
      width: 130,
      renderCell: (p) => <TStatusChip status={p.row.status} statusMap="financeDocument" />,
    },
  ];

  const accountColumns: TDataGridColumn<BankAccount>[] = [
    { field: "name", header: "Name", minWidth: 180, flex: 1.2 },
    {
      field: "bank_name",
      header: "Bank",
      minWidth: 180,
      flex: 1,
      renderCell: (p) => [p.row.bank_name, p.row.account_number].filter(Boolean).join(" · ") || "—",
    },
    {
      field: "account_code",
      header: "Ledger Account",
      minWidth: 200,
      flex: 1.2,
      renderCell: (p) => `${p.row.account_code} · ${p.row.account_name}`,
    },
    { field: "book_balance", header: "Book Balance", width: 150, type: "currency", align: "right", headerAlign: "right" },
    { field: "last_reconciled_to", header: "Checked Up To", width: 130, type: "date" },
    { field: "open_statements", header: "Open Statements", width: 140, type: "number", align: "right", headerAlign: "right" },
    {
      field: "is_active",
      header: "Status",
      width: 120,
      renderCell: (p) => <TStatusChip status={p.row.is_active ? "active" : "inactive"} statusMap="financeDocument" />,
    },
  ];

  const statementsDetail = addingStatement || statementId !== null;
  const accountsDetail = addingAccount || viewedAccount !== null;
  const detailMode = tab === "statements" ? statementsDetail : accountsDetail;

  const back = () => {
    if (tab === "statements") {
      setStatementId(null);
      setAddingStatement(false);
    } else {
      setViewAccountId(null);
      setAddingAccount(false);
    }
  };

  const openStatementsFor = (accountId: number) => {
    setPickedAccountId(accountId);
    setStatementId(null);
    setAddingStatement(false);
    setTab("statements");
  };

  let content: ReactNode;
  if (tab === "statements") {
    if (addingStatement && accounts) {
      content = (
        <NewStatementPanel
          accounts={accounts}
          initialAccountId={selectedAccount?.id ?? null}
          onCancel={() => setAddingStatement(false)}
          onCreated={(d) => {
            setAddingStatement(false);
            setPickedAccountId(d.bank_account_id);
            setStatementId(d.id);
          }}
        />
      );
    } else if (statementId !== null) {
      content = (
        <StatementDetailPanel
          key={statementId}
          statementId={statementId}
          accounts={accounts ?? []}
          canEdit={canReconcile}
          onDeleted={() => setStatementId(null)}
        />
      );
    } else {
      content = (
        <Box sx={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {error && (
            <Alert severity="error" sx={{ mx: 1.5, mb: 1 }}>
              Could not load the bank accounts.
            </Alert>
          )}
          <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
            <TDataGrid<BankStatementListItem>
              rows={selectedAccount ? filteredStatements : []}
              columns={statementColumns}
              loading={isLoading || (!!selectedAccount && loadingStatements)}
              onRowClick={(row) => setStatementId(row.id)}
              pageSizeOptions={[10, 25, 50, 100]}
              pageSize={25}
              emptyMessage={
                accounts && accounts.length === 0
                  ? canAddAccount
                    ? "No bank accounts yet. Add one on the Bank Accounts tab."
                    : "No bank accounts yet. Ask someone with chart-of-accounts access to add one."
                  : `No statements yet. Add the first one from the bank's statement${
                      selectedAccount?.reconcile_from ? ` (starting ${selectedAccount.reconcile_from})` : ""
                    }.`
              }
              autoHeight={false}
              height="100%"
            />
          </Box>
        </Box>
      );
    }
  } else if (addingAccount && accounts) {
    content = (
      <AddBankAccountPanel
        existing={accounts}
        onCancel={() => setAddingAccount(false)}
        onCreated={(a) => {
          setAddingAccount(false);
          setPickedAccountId(a.id);
          setViewAccountId(a.id);
        }}
      />
    );
  } else if (viewedAccount) {
    content = (
      <BankAccountDetailPanel
        account={viewedAccount}
        canReconcile={canReconcile}
        onViewStatements={() => openStatementsFor(viewedAccount.id)}
        onNewStatement={() => {
          openStatementsFor(viewedAccount.id);
          setAddingStatement(true);
        }}
      />
    );
  } else {
    content = (
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {error && (
          <Alert severity="error" sx={{ mx: 1.5, mb: 1 }}>
            Could not load the bank accounts.
          </Alert>
        )}
        <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
          <TDataGrid<BankAccount>
            rows={filteredAccounts}
            columns={accountColumns}
            loading={isLoading}
            onRowClick={(row) => setViewAccountId(row.id)}
            pageSizeOptions={[10, 25, 50, 100]}
            pageSize={25}
            emptyMessage={
              canAddAccount
                ? 'No bank accounts yet. Use "Add Bank Account" to set up the first one.'
                : "No bank accounts yet. Ask someone with chart-of-accounts access to add one."
            }
            autoHeight={false}
            height="100%"
          />
        </Box>
      </Box>
    );
  }

  const searchBox = (value: string, onChange: (v: string) => void, placeholder: string) => (
    <TextField
      size="small"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchIcon fontSize="small" color="action" />
          </InputAdornment>
        ),
      }}
      sx={{ width: 190, flexShrink: 0 }}
    />
  );

  const titleSlot = detailMode ? (
    <Button size="small" startIcon={<ArrowBackIcon fontSize="small" />} onClick={back} sx={{ textTransform: "none" }}>
      {tab === "statements" ? "Back to Statements" : "Back to Bank Accounts"}
    </Button>
  ) : tab === "statements" ? (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
      {searchBox(search, setSearch, "Search statements...")}
      <Box sx={{ width: 220, flexShrink: 0 }}>
        <TSearchableSelect
          label=""
          value={selectedAccount?.id ?? null}
          onChange={(v) => setPickedAccountId(v == null ? null : Number(v))}
          options={(accounts ?? []).map((a) => ({
            value: a.id,
            label: a.is_active ? a.name : `${a.name} (inactive)`,
            secondary: a.bank_name ?? undefined,
          }))}
          placeholder="Bank account..."
          size="small"
          clearable={false}
        />
      </Box>
      <Box sx={{ width: 150, flexShrink: 0 }}>
        <TSearchableSelect
          label=""
          value={status}
          onChange={(v) => setStatus(v as string | null)}
          options={STATEMENT_STATUS_OPTIONS}
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
  ) : (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
      {searchBox(accountSearch, setAccountSearch, "Search bank accounts...")}
      {accountSearch && (
        <Button size="small" onClick={() => setAccountSearch("")} sx={{ textTransform: "none" }}>
          Clear
        </Button>
      )}
    </Box>
  );

  const headerActions = detailMode ? undefined : tab === "statements" ? (
    canReconcile && activeAccounts.length > 0 ? (
      <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setAddingStatement(true)} sx={{ mr: 1 }}>
        New Statement
      </Button>
    ) : undefined
  ) : canAddAccount && accounts ? (
    <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setAddingAccount(true)} sx={{ mr: 1 }}>
      Add Bank Account
    </Button>
  ) : undefined;

  return (
    <MasterDetailLayout
      title="Bank Reconciliation"
      tabs={PAGE_TABS}
      activeTab={tab}
      onTabChange={(t) => setTab(t as PageTab)}
      titleSlot={titleSlot}
      headerActions={headerActions}
      onRefresh={() =>
        Promise.all([
          refetchAccounts(),
          selectedAccount ? refetchStatements() : undefined,
          statementId !== null ? queryClient.invalidateQueries({ queryKey: bankKeys.statement(statementId) }) : undefined,
        ])
      }
      isLoading={isLoading}
    >
      {content}
    </MasterDetailLayout>
  );
}
