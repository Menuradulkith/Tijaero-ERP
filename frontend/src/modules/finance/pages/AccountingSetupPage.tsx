/**
 * AccountingSetupPage — which accounts automatic postings use, VAT tax codes,
 * cost centers, write-off limits and the names of the journal-entry sources
 * (voucher types).
 *
 * Posting rules: every automatic posting (a sale, a supplier payment, payroll…)
 * is made of "posting types" such as Cash, Bank, Inventory or Expenses. Each one
 * has a built-in default account; here Finance can point it at another account,
 * optionally a different one per branch or per expense category. Changes apply
 * to postings made from now on — posted entries are never rewritten.
 *
 * Same layout as the purchasing / sales pages: each tab is a full-height list
 * with search; a row opens a full-page detail (breadcrumb, Edit → Save/Cancel,
 * form sections), and "Add …" opens the same form for a new record. Each tab
 * renders the shared MasterDetailLayout itself (so it owns its own search box,
 * Add button and Back button); this page only picks the tab.
 */

import AccountTreeIcon from "@mui/icons-material/AccountTree";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import BlockIcon from "@mui/icons-material/Block";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import PercentIcon from "@mui/icons-material/Percent";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import SearchIcon from "@mui/icons-material/Search";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
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
  TConfirmDialog,
  TDataGrid,
  type TabConfig,
  type TDataGridColumn,
  TSearchableSelect,
  TStatusChip,
  useConfirmDialog,
  useRecordParam,
  useTabParam,
} from "@/components/tijaero";
import { chartOfAccountsApi, postingRulesApi, taxCodesApi, voucherTypesApi } from "@/modules/finance/api";
import { WriteOffLimitsTab } from "./ReceivablesSetupTabs";
import CostCentersTab from "./CostCentersTab";
import type {
  AccountRef,
  ChartOfAccount,
  PostingControlType,
  PostingRuleSetup,
  PostingTypeRule,
  TaxCode,
  TaxCodeInput,
  VoucherType,
} from "@/modules/finance/types";
import { submitOnce } from "@/modules/finance/submitOnce";

/** What every Accounting Setup tab needs to render the shared page layout. */
export interface SetupTabLayout {
  tabs: TabConfig[];
  activeTab: string;
  onTabChange: (tab: string | number) => void;
}

const SETUP_BREADCRUMBS = [
  { label: "Finance", href: "/finance" },
  { label: "Accounting Setup", href: "/finance/accounting-setup" },
];

const accountLabel = (a?: AccountRef | ChartOfAccount | null) =>
  a ? `${a.account_code} · ${a.account_name}` : "—";

// ─── Small layout helpers ────────────────────────────────────────────────────
function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
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
      sx={{ width: 220, flexShrink: 0 }}
    />
  );
}

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button size="small" startIcon={<ArrowBackIcon fontSize="small" />} onClick={onClick} sx={{ textTransform: "none" }}>
      Back to {label}
    </Button>
  );
}

const FilterBar = ({ children }: { children: ReactNode }) => (
  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>{children}</Box>
);

/** Full-height list area with an optional one-line explanation above the grid. */
const ListArea = ({ hint, children }: { hint?: ReactNode; children: ReactNode }) => (
  <Box sx={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
    {hint && (
      <Typography variant="caption" color="text.secondary" sx={{ px: 1.5, pb: 1, display: "block" }}>
        {hint}
      </Typography>
    )}
    <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>{children}</Box>
  </Box>
);

const DetailArea = ({ header, toolbar, children }: { header: ReactNode; toolbar: ReactNode; children: ReactNode }) => (
  <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
    {header}
    {toolbar}
    <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>{children}</Box>
  </Box>
);

const FULL = { gridColumn: "1 / -1" };

// ─── Account picker: only active, postable accounts of the allowed types ──────
function AccountPicker({
  accounts,
  allowedTypes,
  value,
  onChange,
  label,
  placeholder,
  disabled,
  fallback,
  required,
}: {
  accounts: ChartOfAccount[];
  allowedTypes: string[];
  value: number | null;
  onChange: (id: number | null) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Shown read-only when the account list is not loaded (e.g. no edit right). */
  fallback?: AccountRef | null;
  required?: boolean;
}) {
  const options = useMemo(() => {
    const parents = new Set(accounts.filter((a) => a.is_active).map((a) => a.parent_account_id));
    return accounts.filter(
      (a) => a.is_active && !parents.has(a.id) && allowedTypes.includes(a.account_type)
    );
  }, [accounts, allowedTypes]);
  if (disabled && fallback !== undefined && !options.some((o) => o.id === value)) {
    return <TextField size="small" label={label} value={fallback ? accountLabel(fallback) : ""} placeholder={placeholder} disabled fullWidth />;
  }
  return (
    <Autocomplete
      size="small"
      options={options}
      value={options.find((o) => o.id === value) ?? null}
      onChange={(_, v) => onChange(v ? v.id : null)}
      getOptionLabel={accountLabel}
      isOptionEqualToValue={(o, v) => o.id === v.id}
      renderInput={(params) => <TextField {...params} label={label} placeholder={placeholder} required={required} />}
      disabled={disabled}
      fullWidth
    />
  );
}

// ─── Posting rule detail (view / edit) ───────────────────────────────────────
interface DetailRow {
  key: number;
  control_value: string;
  account_id: number | null;
  account?: AccountRef | null;
}

function ruleSummaryText(rule: PostingTypeRule, setup: PostingRuleSetup) {
  if (!rule.is_customized) return accountLabel(rule.default_account);
  const main = rule.account ? accountLabel(rule.account) : `${accountLabel(rule.default_account)} (default)`;
  if (rule.control_type === "none" || rule.details.length === 0) return main;
  const options = rule.control_type === "branch" ? setup.branches : setup.expense_categories;
  const names = rule.details.map(
    (d) => `${options.find((o) => o.value === d.control_value)?.label ?? d.control_value} → ${d.account?.account_code}`
  );
  return `${main} · ${names.join(" · ")}`;
}

function PostingRuleDetail({
  rule,
  setup,
  accounts,
  canEdit,
  editing,
  onEdit,
  onDone,
  onReset,
  resetting,
}: {
  rule: PostingTypeRule;
  setup: PostingRuleSetup;
  accounts: ChartOfAccount[];
  canEdit: boolean;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  onReset: () => void;
  resetting: boolean;
}) {
  const queryClient = useQueryClient();
  const [controlType, setControlType] = useState<PostingControlType>(rule.control_type);
  const [accountId, setAccountId] = useState<number | null>(rule.account?.id ?? null);
  const [rows, setRows] = useState<DetailRow[]>(
    rule.details.map((d, i) => ({ key: i, control_value: d.control_value, account_id: d.account?.id ?? null, account: d.account }))
  );
  const [notes, setNotes] = useState(rule.notes ?? "");

  const valueOptions =
    controlType === "branch"
      ? setup.branches
      : controlType === "expense_category"
        ? setup.expense_categories
        : [];
  const valueLabel = controlType === "branch" ? "Branch" : "Expense category";

  const save = useMutation({
    mutationFn: () =>
      postingRulesApi.save(rule.code, {
        control_type: controlType,
        account_id: accountId,
        details:
          controlType === "none"
            ? []
            : rows
                .filter((r) => r.control_value && r.account_id)
                .map((r) => ({ control_value: r.control_value, account_id: r.account_id as number })),
        notes: notes.trim() || null,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["posting-rules"], data);
      showSuccessToast(`${rule.name}: new postings will use the updated account.`);
      onDone();
    },
    onError: (err) => handleApiError(err, "Could not save the posting rule"),
  });

  const usedValues = new Set(rows.map((r) => r.control_value));
  const incompleteRow = rows.some((r) => !r.control_value || !r.account_id);
  const canSave = !incompleteRow && (accountId !== null || (controlType !== "none" && rows.length > 0));
  const ro = !editing;

  return (
    <DetailArea
      header={
        <DetailPanelHeader
          breadcrumbs={[...SETUP_BREADCRUMBS, { label: "Posting Rules" }, { label: rule.name }]}
          title={rule.name}
          titleIcon={<AccountTreeIcon color="primary" />}
          chips={[rule.is_customized ? { label: "Custom", color: "primary" } : { label: "Default", variant: "outlined" }]}
        />
      }
      toolbar={
        <ActionToolbar
          hasSelectedItem
          isCreating={false}
          isEditing={editing}
          isSaving={save.isPending}
          isFormValid={canSave}
          canUpdate={canEdit}
          onEdit={canEdit ? onEdit : undefined}
          onSave={() => submitOnce("AccountingSetupPage-save-1", save)}
          onCancel={onDone}
          endActions={
            canEdit && !editing && rule.is_customized ? (
              <Button size="small" variant="outlined" startIcon={<RestartAltIcon />} onClick={onReset} disabled={resetting}>
                Back to Default
              </Button>
            ) : undefined
          }
        />
      }
    >
      <FormSection title="Business Event" columns={2}>
        <TextField label="Business event" size="small" value={rule.name} disabled />
        <TextField label="Group" size="small" value={rule.group} disabled />
        <TextField label="What it covers" size="small" value={rule.description} disabled multiline sx={FULL} />
        <TextField label="Built-in default account" size="small" value={accountLabel(rule.default_account)} disabled sx={FULL} />
      </FormSection>

      {rule.control_types.length > 1 && (
        <FormSection title="How should the account be chosen?" columns={1}>
          <RadioGroup
            value={controlType}
            onChange={(e) => {
              setControlType(e.target.value as PostingControlType);
              setRows([]);
            }}
          >
            {setup.control_types
              .filter((c) => rule.control_types.includes(c.code))
              .map((c) => (
                <FormControlLabel
                  key={c.code}
                  value={c.code}
                  disabled={ro}
                  control={<Radio size="small" />}
                  label={
                    <Box>
                      <Typography variant="body2">{c.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {c.description}
                      </Typography>
                    </Box>
                  }
                />
              ))}
          </RadioGroup>
        </FormSection>
      )}

      <FormSection title={controlType === "none" ? "Account" : "Account for anything not listed below"} columns={1}>
        <Box>
          <AccountPicker
            accounts={accounts}
            allowedTypes={rule.account_types}
            value={accountId}
            onChange={setAccountId}
            disabled={ro}
            fallback={rule.account}
            label="Account"
            required={controlType === "none"}
            placeholder={
              controlType === "expense_category"
                ? "Optional: used for categories without their own default"
                : controlType === "branch"
                  ? `Leave empty to use the default (${rule.default_account.account_code})`
                  : "Choose an account"
            }
          />
          <Typography variant="caption" color="text.secondary">
            Only active {rule.account_types.join(" / ").toLowerCase()} accounts that can be posted to are listed.
          </Typography>
        </Box>
      </FormSection>

      {controlType !== "none" && (
        <FormSection
          title={`Per ${valueLabel.toLowerCase()}`}
          columns={1}
          titleAction={
            editing ? (
              <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={() => setRows((r) => [...r, { key: Date.now(), control_value: "", account_id: null }])}
              >
                Add {valueLabel.toLowerCase()}
              </Button>
            ) : undefined
          }
        >
          {rows.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No {valueLabel.toLowerCase()} has its own account yet.
            </Typography>
          ) : (
            <Stack spacing={1.5}>
              {rows.map((row) => (
                <Stack key={row.key} direction={{ xs: "column", sm: "row" }} spacing={1} alignItems="center">
                  <TextField
                    select
                    size="small"
                    label={valueLabel}
                    value={row.control_value}
                    disabled={ro}
                    required
                    onChange={(e) =>
                      setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, control_value: e.target.value } : r)))
                    }
                    sx={{ minWidth: 220 }}
                  >
                    {valueOptions.map((o) => (
                      <MenuItem key={o.value} value={o.value} disabled={o.value !== row.control_value && usedValues.has(o.value)}>
                        {o.label}
                        {o.default_account ? ` (default ${o.default_account.account_code})` : ""}
                      </MenuItem>
                    ))}
                  </TextField>
                  <AccountPicker
                    accounts={accounts}
                    allowedTypes={rule.account_types}
                    value={row.account_id}
                    disabled={ro}
                    fallback={row.account ?? null}
                    onChange={(id) => setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, account_id: id } : r)))}
                    label="Account"
                    required
                  />
                  {editing && (
                    <IconButton aria-label="Remove" onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}>
                      <DeleteOutlineIcon />
                    </IconButton>
                  )}
                </Stack>
              ))}
            </Stack>
          )}
        </FormSection>
      )}

      <FormSection title="Remarks" columns={1}>
        <TextField
          label="Note (optional)"
          size="small"
          value={notes}
          disabled={ro}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Why this account? e.g. separate bank account for the Kandy branch"
          multiline
          minRows={1}
        />
      </FormSection>

      <Alert severity="info" variant="outlined">
        Changes apply to new postings only; entries already posted stay where they are.
      </Alert>
    </DetailArea>
  );
}

// ─── Posting rules tab ────────────────────────────────────────────────────────
function PostingRulesTab({ canEdit, layout }: { canEdit: boolean; layout: SetupTabLayout }) {
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const { data: setup, isLoading, refetch } = useQuery({ queryKey: ["posting-rules"], queryFn: postingRulesApi.getAll });
  const { data: accounts = [] } = useQuery({
    queryKey: ["chart-of-accounts-all"],
    queryFn: () => chartOfAccountsApi.getAll({ is_active: true, limit: 1000 }),
    enabled: canEdit,
  });

  const reset = useMutation({
    mutationFn: (code: string) => postingRulesApi.reset(code),
    onSuccess: (data) => {
      queryClient.setQueryData(["posting-rules"], data);
      showSuccessToast("Back to the default account.");
    },
    onError: (err) => handleApiError(err, "Could not reset the posting rule"),
  });

  const handleReset = async (rule: PostingTypeRule) => {
    const ok = await confirmDialog.confirm({
      title: "Use the default account?",
      message: `${rule.name} will post to ${accountLabel(rule.default_account)} again for new postings.`,
      confirmText: "Reset",
    });
    if (ok) reset.mutate(rule.code);
  };

  const types = useMemo(() => setup?.posting_types ?? [], [setup]);
  const groups = Array.from(new Set(types.map((t) => t.group)));
  const customized = types.filter((t) => t.is_customized).length;
  const rule = types.find((t) => t.code === selectedCode) ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return types.filter(
      (t) =>
        (!group || t.group === group) &&
        (!q || [t.name, t.description, t.group, t.default_account.account_code, t.account?.account_code].some((v) => v?.toLowerCase().includes(q)))
    );
  }, [types, search, group]);

  const columns: TDataGridColumn<PostingTypeRule>[] = [
    { field: "group", header: "Group", width: 150 },
    { field: "name", header: "Business event", minWidth: 200, flex: 1.1 },
    { field: "description", header: "What it covers", minWidth: 220, flex: 1.4 },
    {
      field: "account",
      header: "Account used",
      minWidth: 240,
      flex: 1.5,
      sortable: false,
      renderCell: (p) => (setup ? ruleSummaryText(p.row, setup) : ""),
    },
    {
      field: "is_customized",
      header: "Source",
      width: 110,
      renderCell: (p) =>
        p.row.is_customized ? <TChip size="small" color="primary" label="Custom" /> : <TChip size="small" variant="outlined" label="Default" />,
    },
  ];

  const back = () => {
    setSelectedCode(null);
    setEditing(false);
  };

  // Open record lives in the URL (?id= / ?new=1): browser Back returns to the list.
  useRecordParam({
    current: selectedCode,
    items: types,
    loading: isLoading,
    getId: (t) => t.code,
    onOpen: (t) => {
      setEditing(false);
      setSelectedCode(t.code);
    },
    onClose: back,
  });

  return (
    <>
      <MasterDetailLayout
        title="Accounting Setup"
        {...layout}
        titleSlot={
          rule ? (
            <BackButton label="Posting Rules" onClick={back} />
          ) : (
            <FilterBar>
              <SearchField value={search} onChange={setSearch} placeholder="Search business events..." />
              <Box sx={{ width: 180, flexShrink: 0 }}>
                <TSearchableSelect
                  label=""
                  value={group}
                  onChange={(v) => setGroup(v as string | null)}
                  options={groups.map((g) => ({ value: g, label: g }))}
                  showAllOption
                  allOptionLabel="All Groups"
                  placeholder="Search group..."
                  size="small"
                />
              </Box>
            </FilterBar>
          )
        }
        onRefresh={() => refetch()}
        isLoading={isLoading}
      >
        {rule && setup ? (
          <PostingRuleDetail
            key={`${rule.code}-${editing}-${rule.updated_at ?? ""}`}
            rule={rule}
            setup={setup}
            accounts={accounts}
            canEdit={canEdit}
            editing={editing}
            onEdit={() => setEditing(true)}
            onDone={() => setEditing(false)}
            onReset={() => handleReset(rule)}
            resetting={reset.isPending}
          />
        ) : (
          <ListArea
            hint={
              <>
                Every automatic entry (sales, purchases, payroll, expenses…) is built from these business events; each posts
                to the account shown. {customized === 0 ? "All events use their built-in defaults." : `${customized} changed from the default.`}
              </>
            }
          >
            <TDataGrid<PostingTypeRule>
              rows={filtered}
              columns={columns}
              getRowId={(r) => r.code}
              loading={isLoading}
              onRowClick={(r) => setSelectedCode(r.code)}
              pageSizeOptions={[25, 50, 100]}
              pageSize={50}
              emptyMessage="No posting types"
              autoHeight={false}
              height="100%"
            />
          </ListArea>
        )}
      </MasterDetailLayout>
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}

// ─── Tax codes tab ────────────────────────────────────────────────────────────
const TAX_TYPE_LABEL: Record<string, string> = {
  standard: "Standard rate",
  zero_rated: "Zero-rated (0%)",
  exempt: "Exempt",
};
const APPLIES_LABEL: Record<string, string> = { both: "Sales & purchases", sales: "Sales only", purchases: "Purchases only" };
const EMPTY_TAX_CODE: TaxCodeInput = { code: "", name: "", rate: 0, tax_type: "standard", applies_to: "both" };
const ACTIVE_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const taxForm = (c: TaxCode): TaxCodeInput => ({
  name: c.name,
  rate: Number(c.rate),
  tax_type: c.tax_type,
  applies_to: c.applies_to,
  description: c.description ?? "",
  is_default_sales: c.is_default_sales,
  is_default_purchases: c.is_default_purchases,
  is_active: c.is_active,
});

function TaxCodesTab({ canEdit, layout }: { canEdit: boolean; layout: SetupTabLayout }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [selected, setSelected] = useState<TaxCode | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<TaxCodeInput>(EMPTY_TAX_CODE);
  const { data: codes, isLoading, refetch } = useQuery({ queryKey: ["tax-codes"], queryFn: () => taxCodesApi.getAll() });

  const afterSave = (saved: TaxCode) => {
    queryClient.invalidateQueries({ queryKey: ["tax-codes"] });
    queryClient.invalidateQueries({ queryKey: ["posting-rules"] });
    setCreating(false);
    setEditing(false);
    setSelected(saved);
    setForm(taxForm(saved));
  };

  const save = useMutation({
    mutationFn: () => (creating ? taxCodesApi.create(form) : taxCodesApi.update((selected as TaxCode).id, form)),
    onSuccess: (saved) => {
      showSuccessToast("Tax code saved.");
      afterSave(saved);
    },
    onError: (err) => handleApiError(err, "Could not save the tax code"),
  });

  const toggleActive = useMutation({
    mutationFn: (c: TaxCode) => taxCodesApi.update(c.id, { is_active: !c.is_active }),
    onSuccess: (saved) => {
      showSuccessToast(saved.is_active ? "Tax code activated." : "Tax code deactivated.");
      afterSave(saved);
    },
    onError: (err) => handleApiError(err, "Could not save the tax code"),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (codes ?? []).filter(
      (c) =>
        (!status || (status === "active") === c.is_active) &&
        (!q || [c.code, c.name, c.description].some((v) => v?.toLowerCase().includes(q)))
    );
  }, [codes, search, status]);

  const columns: TDataGridColumn<TaxCode>[] = [
    { field: "code", header: "Code", width: 120 },
    { field: "name", header: "Name", minWidth: 180, flex: 1.3 },
    { field: "rate", header: "Rate", width: 90, align: "right", headerAlign: "right", renderCell: (p) => `${Number(p.row.rate)}%` },
    { field: "tax_type", header: "Type", minWidth: 140, flex: 0.8, renderCell: (p) => TAX_TYPE_LABEL[p.row.tax_type] },
    { field: "applies_to", header: "Used for", minWidth: 150, flex: 0.8, renderCell: (p) => APPLIES_LABEL[p.row.applies_to] },
    {
      field: "is_default_sales",
      header: "Default for",
      width: 180,
      sortable: false,
      renderCell: (p) => (
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ height: "100%" }}>
          {p.row.is_default_sales && <TChip size="small" color="primary" label="Sales" />}
          {p.row.is_default_purchases && <TChip size="small" color="primary" label="Purchases" />}
        </Stack>
      ),
    },
    {
      field: "is_active",
      header: "Status",
      width: 110,
      renderCell: (p) => <TStatusChip status={p.row.is_active ? "active" : "inactive"} statusMap="financeDocument" />,
    },
  ];

  const back = () => {
    setSelected(null);
    setCreating(false);
    setEditing(false);
  };
  const detailMode = creating || !!selected;

  // Open record lives in the URL (?id= / ?new=1): browser Back returns to the list.
  useRecordParam({
    current: selected?.id,
    creating,
    items: codes,
    loading: isLoading,
    onOpen: (c) => {
      setCreating(false);
      setEditing(false);
      setSelected(c);
      setForm(taxForm(c));
    },
    onClose: back,
    onNew: canEdit ? () => {
      setForm(EMPTY_TAX_CODE);
      setCreating(true);
    } : undefined,
  });
  const ro = !creating && !editing;
  const isStandard = form.tax_type === "standard";
  const rateOk = Number(form.rate ?? 0) >= 0 && Number(form.rate ?? 0) <= 100;
  const valid = !!form.name?.trim() && (!creating || !!form.code?.trim()) && rateOk;

  const detail = (
    <DetailArea
      header={
        <DetailPanelHeader
          breadcrumbs={[...SETUP_BREADCRUMBS, { label: "Tax Codes" }, { label: creating ? "New Tax Code" : selected?.code ?? "" }]}
          title={selected ? `${selected.code} · ${selected.name}` : ""}
          titleIcon={<PercentIcon color="primary" />}
          isCreating={creating}
          createTitle="New Tax Code"
          chips={selected && !creating ? [getStatusProps(selected.is_active ? "active" : "inactive", "financeDocument")] : []}
        />
      }
      toolbar={
        <ActionToolbar
          hasSelectedItem={!!selected}
          isCreating={creating}
          isEditing={editing}
          isSaving={save.isPending || toggleActive.isPending}
          isFormValid={valid}
          canUpdate={canEdit}
          onEdit={canEdit ? () => setEditing(true) : undefined}
          onSave={() => submitOnce("AccountingSetupPage-save-2", save)}
          onCancel={() => {
            if (creating) back();
            else {
              setEditing(false);
              if (selected) setForm(taxForm(selected));
            }
          }}
          endActions={
            canEdit && selected && ro ? (
              <Button
                size="small"
                variant="outlined"
                startIcon={selected.is_active ? <BlockIcon /> : <CheckCircleOutlineIcon />}
                disabled={toggleActive.isPending}
                onClick={() => submitOnce("AccountingSetupPage-tax-active", toggleActive, selected)}
              >
                {selected.is_active ? "Deactivate" : "Activate"}
              </Button>
            ) : undefined
          }
        />
      }
    >
      <FormSection title="Tax Code" columns={2}>
        <TextField
          label="Code"
          size="small"
          required={creating}
          disabled={!creating}
          value={creating ? form.code ?? "" : selected?.code ?? ""}
          onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
          helperText={creating ? "Short, e.g. VAT, VAT-15, ZERO" : undefined}
          inputProps={{ maxLength: 20 }}
        />
        <TextField label="Name" size="small" required disabled={ro} value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} inputProps={{ maxLength: 100 }} />
        <TextField
          select
          label="Type"
          size="small"
          disabled={ro}
          value={form.tax_type}
          onChange={(e) => {
            const t = e.target.value as TaxCodeInput["tax_type"];
            setForm({ ...form, tax_type: t, rate: t === "standard" ? form.rate : 0 });
          }}
        >
          {Object.entries(TAX_TYPE_LABEL).map(([v, l]) => (
            <MenuItem key={v} value={v}>
              {l}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Rate %"
          size="small"
          type="number"
          value={form.rate ?? 0}
          disabled={ro || !isStandard}
          onChange={(e) => setForm({ ...form, rate: e.target.value === "" ? 0 : Number(e.target.value) })}
          inputProps={{ min: 0, max: 100, step: 0.01 }}
          error={!ro && isStandard && (Number(form.rate) < 0 || Number(form.rate) > 100)}
          helperText={!ro && isStandard && (Number(form.rate) < 0 || Number(form.rate) > 100) ? "Rate must be between 0 and 100" : undefined}
        />
      </FormSection>
      <FormSection title="Usage" columns={2}>
        <TextField
          select
          label="Used for"
          size="small"
          disabled={ro}
          value={form.applies_to}
          onChange={(e) => setForm({ ...form, applies_to: e.target.value as TaxCodeInput["applies_to"] })}
          sx={FULL}
        >
          {Object.entries(APPLIES_LABEL).map(([v, l]) => (
            <MenuItem key={v} value={v}>
              {l}
            </MenuItem>
          ))}
        </TextField>
        <FormControlLabel
          control={
            <Checkbox
              checked={!!form.is_default_sales}
              disabled={ro || form.applies_to === "purchases"}
              onChange={(e) => setForm({ ...form, is_default_sales: e.target.checked })}
            />
          }
          label="Default for sales"
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={!!form.is_default_purchases}
              disabled={ro || form.applies_to === "sales"}
              onChange={(e) => setForm({ ...form, is_default_purchases: e.target.checked })}
            />
          }
          label="Default for purchases"
        />
      </FormSection>
      <FormSection title="Description" columns={1}>
        <TextField
          label="Description"
          size="small"
          multiline
          minRows={2}
          disabled={ro}
          value={form.description ?? ""}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </FormSection>
      <Alert severity="info" variant="outlined">
        A tax code says how VAT is charged. Sales use the code matching the invoice&apos;s tax rate (or the sales default);
        supplier invoices use the code chosen on the invoice (or the purchases default). The VAT return groups everything by
        these codes. When a rate changes by law, create a new code (e.g. VAT-2027) and make it the default. A code already used
        on posted entries keeps its rate, so old VAT returns don&apos;t change. An inactive code can&apos;t be chosen on new
        documents.
      </Alert>
    </DetailArea>
  );

  return (
    <MasterDetailLayout
      title="Accounting Setup"
      {...layout}
      titleSlot={
        detailMode ? (
          <BackButton label="Tax Codes" onClick={back} />
        ) : (
          <FilterBar>
            <SearchField value={search} onChange={setSearch} placeholder="Search tax codes..." />
            <Box sx={{ width: 150, flexShrink: 0 }}>
              <TSearchableSelect
                label=""
                value={status}
                onChange={(v) => setStatus(v as string | null)}
                options={ACTIVE_OPTIONS}
                showAllOption
                allOptionLabel="All Statuses"
                placeholder="Search status..."
                size="small"
              />
            </Box>
          </FilterBar>
        )
      }
      headerActions={
        !detailMode && canEdit ? (
          <Button
            variant="contained"
            size="small"
            startIcon={<AddIcon />}
            onClick={() => {
              setForm(EMPTY_TAX_CODE);
              setCreating(true);
            }}
            sx={{ mr: 1 }}
          >
            Add Tax Code
          </Button>
        ) : undefined
      }
      onRefresh={() => refetch()}
      isLoading={isLoading}
    >
      {detailMode ? (
        detail
      ) : (
        <ListArea>
          <TDataGrid<TaxCode>
            rows={filtered}
            columns={columns}
            loading={isLoading}
            onRowClick={(c) => {
              setSelected(c);
              setForm(taxForm(c));
            }}
            pageSizeOptions={[10, 25, 50, 100]}
            pageSize={25}
            emptyMessage="No tax codes yet"
            autoHeight={false}
            height="100%"
          />
        </ListArea>
      )}
    </MasterDetailLayout>
  );
}

// ─── Voucher types tab ────────────────────────────────────────────────────────
// A fixed list: journal entry numbers carry the code, so it is shown, not edited.
function VoucherTypesTab({ layout }: { layout: SetupTabLayout }) {
  const [search, setSearch] = useState("");
  const { data: types, isLoading, refetch } = useQuery({ queryKey: ["voucher-types"], queryFn: voucherTypesApi.getAll });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (types ?? []).filter((t) => !q || [t.code, t.name, t.description].some((v) => v?.toLowerCase().includes(q)));
  }, [types, search]);

  const columns: TDataGridColumn<VoucherType>[] = [
    { field: "code", header: "Code", width: 110 },
    { field: "name", header: "Name", minWidth: 180, flex: 1 },
    {
      field: "is_manual",
      header: "Approval",
      width: 200,
      renderCell: (p) => (p.row.is_manual ? "Needs approval before posting" : ""),
    },
    { field: "description", header: "Used for", minWidth: 260, flex: 2 },
    { field: "entry_count", header: "Entries", width: 110, align: "right", headerAlign: "right", renderCell: (p) => p.row.entry_count.toLocaleString() },
  ];

  return (
    <MasterDetailLayout
      title="Accounting Setup"
      {...layout}
      titleSlot={
        <FilterBar>
          <SearchField value={search} onChange={setSearch} placeholder="Search voucher types..." />
        </FilterBar>
      }
      onRefresh={() => refetch()}
      isLoading={isLoading}
    >
      <ListArea
        hint={
          <>
            Every journal entry records where it came from. The code is part of the entry number, e.g. <b>JE-SALE-202610-0001</b>{" "}
            is a sales entry and <b>JE-202610-0001</b> a manual journal (MJ).
          </>
        }
      >
        <TDataGrid<VoucherType>
          rows={filtered}
          columns={columns}
          getRowId={(t) => t.code}
          loading={isLoading}
          pageSizeOptions={[25, 50, 100]}
          pageSize={50}
          emptyMessage="No voucher types"
          autoHeight={false}
          height="100%"
        />
      </ListArea>
    </MasterDetailLayout>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
const TABS: TabConfig[] = [
  { id: "posting-rules", label: "Posting Rules" },
  { id: "tax-codes", label: "Tax Codes" },
  { id: "cost-centers", label: "Cost Centers" },
  { id: "write-off-limits", label: "Write-off Limits" },
  { id: "voucher-types", label: "Voucher Types" },
];

export default function AccountingSetupPage() {
  // ?tab= keeps the active tab on reload / shared links.
  const [tab, setTab] = useTabParam("posting-rules", TABS.map((t) => String(t.id)));
  const canEdit = usePermission("chart_of_accounts", "update");
  const layout: SetupTabLayout = { tabs: TABS, activeTab: tab, onTabChange: (t) => setTab(String(t)) };

  switch (tab) {
    case "tax-codes":
      return <TaxCodesTab canEdit={canEdit} layout={layout} />;
    case "cost-centers":
      return <CostCentersTab canEdit={canEdit} layout={layout} />;
    case "write-off-limits":
      return <WriteOffLimitsTab canEdit={canEdit} layout={layout} />;
    case "voucher-types":
      return <VoucherTypesTab layout={layout} />;
    default:
      return <PostingRulesTab canEdit={canEdit} layout={layout} />;
  }
}
