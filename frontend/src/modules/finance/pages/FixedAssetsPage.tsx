/**
 * FixedAssetsPage — things the business owns and uses for years.
 *
 * Register: every asset with its cost, the depreciation taken so far and the
 * resulting book value; add new assets and sell / scrap old ones.
 * Depreciation: preview and post the monthly depreciation run (usually once a
 * month, before the month is closed); the latest run can be reversed.
 * Asset classes: defaults (GL account, life, method) for each kind of asset.
 *
 * Same layout as the purchasing / sales pages: each tab is a full-width list
 * with filters, a full-page detail with breadcrumb and actions, and a
 * full-page create / edit form.
 */

import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CategoryIcon from "@mui/icons-material/Category";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import PrecisionManufacturingIcon from "@mui/icons-material/PrecisionManufacturing";
import SearchIcon from "@mui/icons-material/Search";
import SellIcon from "@mui/icons-material/Sell";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import UndoIcon from "@mui/icons-material/Undo";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
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
  TBranchFilter,
  TConfirmDialog,
  TDataGrid,
  type TDataGridColumn,
  TRemarkField,
  TSearchableSelect,
  TStatusChip,
  useConfirmDialog,
} from "@/components/tijaero";
import { useReferenceData } from "@/hooks";
import { chartOfAccountsApi } from "@/modules/finance/api";
import {
  FUNDING_LABEL,
  METHOD_LABEL,
  STATUS_LABEL,
  assetClassesApi,
  assetCostCentersApi,
  depreciationRunsApi,
  estimateMonthly,
  fixedAssetsApi,
  type AssetClass,
  type AssetFunding,
  type DepreciationMethod,
  type DepreciationRun,
  type DisposalKind,
  type FixedAsset,
  type FixedAssetStatus,
} from "@/modules/finance/api/fixedAssets";
import { submitOnce } from "@/modules/finance/submitOnce";
import { invalidateLedgerQueries } from "@/modules/finance/ledgerQueries";

const fmt = (v: number | string | null | undefined) =>
  Number(v ?? 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const iso = (d: Date) => {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
const today = new Date();
const TODAY = iso(today);
const THIS_YEAR = today.getFullYear();
const THIS_MONTH = today.getMonth() + 1;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const monthLabel = (year: number, month: number) => `${MONTHS[month - 1]} ${year}`;

const IN_USE: FixedAssetStatus[] = ["active", "fully_depreciated"];

const lifeText = (months: number) => {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [];
  if (y) parts.push(`${y} yr${y === 1 ? "" : "s"}`);
  if (m) parts.push(`${m} mo`);
  return parts.join(" ") || "0 mo";
};

// The register calls "active" assets "In use"; colors come from the shared map.
const assetChip = (s: FixedAssetStatus) => ({ label: STATUS_LABEL[s], color: getStatusProps(s, "financeDocument").color });

const BASE_CRUMBS = [
  { label: "Finance", href: "/finance" },
  { label: "Fixed Assets", href: "/finance/fixed-assets" },
];

const TABS = [{ label: "Register" }, { label: "Depreciation" }, { label: "Asset Classes" }];

type TabNav = { activeTab: number; onTabChange: (tab: string | number) => void };

const REGISTER_STATUS_OPTIONS = [
  { value: "in_use", label: "In use" },
  { value: "active", label: "Still depreciating" },
  { value: "fully_depreciated", label: "Fully depreciated" },
  { value: "sold", label: "Sold" },
  { value: "scrapped", label: "Scrapped" },
];

const RUN_STATUS_OPTIONS = [
  { value: "posted", label: "Posted" },
  { value: "reversed", label: "Reversed" },
];

const CLASS_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

// ─── Shared layout bits ─────────────────────────────────────────────────────

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button size="small" startIcon={<ArrowBackIcon fontSize="small" />} onClick={onClick} sx={{ textTransform: "none" }}>
      {label}
    </Button>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
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
      sx={{ width: 190, flexShrink: 0 }}
    />
  );
}

function FilterRow({ children, showClear, onClear }: { children: ReactNode; showClear: boolean; onClear: () => void }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
      {children}
      {showClear && (
        <Button size="small" onClick={onClear} sx={{ textTransform: "none" }}>
          Clear
        </Button>
      )}
    </Box>
  );
}

function StatusSelect({
  value,
  onChange,
  options,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Box sx={{ width: 150, flexShrink: 0 }}>
      <TSearchableSelect
        label=""
        value={value}
        onChange={(v) => onChange(v as string | null)}
        options={options}
        showAllOption
        allOptionLabel="All Statuses"
        placeholder="Search status..."
        size="small"
      />
    </Box>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={onClick} sx={{ mr: 1 }}>
      {label}
    </Button>
  );
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

function ListBody({ children }: { children: ReactNode }) {
  return <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>{children}</Box>;
}

const ro = (label: string, value: ReactNode) => <TextField label={label} size="small" value={value ?? ""} disabled />;

// ─── Add asset ──────────────────────────────────────────────────────────────

function AssetCreatePanel({
  classes,
  onCancel,
  onSaved,
}: {
  classes: AssetClass[];
  onCancel: () => void;
  onSaved: (a: FixedAsset) => void;
}) {
  const queryClient = useQueryClient();
  const { filteredBranches } = useReferenceData(["branches"]);
  const { data: costCenters } = useQuery({
    queryKey: ["cost-centers", "active-options"],
    queryFn: assetCostCentersApi.getActive,
  });

  const [name, setName] = useState("");
  const [classId, setClassId] = useState<number | "">("");
  const [branchCode, setBranchCode] = useState("");
  const [costCenterId, setCostCenterId] = useState<number | "">("");
  const [serialNo, setSerialNo] = useState("");
  const [location, setLocation] = useState("");
  const [acquisitionDate, setAcquisitionDate] = useState(TODAY);
  const [cost, setCost] = useState("");
  const [salvage, setSalvage] = useState("");
  const [life, setLife] = useState("");
  const [method, setMethod] = useState<DepreciationMethod>("straight_line");
  const [rate, setRate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [funding, setFunding] = useState<AssetFunding>("bank");
  const [accumulated, setAccumulated] = useState("");
  const [notes, setNotes] = useState("");

  const activeClasses = classes.filter((c) => c.is_active);
  const allowsAccumulated = funding === "opening" || funding === "existing";

  const pickClass = (id: number) => {
    setClassId(id);
    const c = classes.find((x) => x.id === id);
    if (c) {
      setLife(String(c.useful_life_months));
      setMethod(c.depreciation_method);
      setRate(c.declining_rate != null ? String(Number(c.declining_rate)) : "");
    }
  };

  const costN = Number(cost) || 0;
  const salvageN = Number(salvage) || 0;
  const lifeN = Number(life) || 0;
  const rateN = Number(rate) || 0;
  const lifeError = lifeProblem(life);
  const rateError = rateN < 0 || rateN > 100 ? "Rate must be between 0 and 100" : null;
  const accumulatedN = allowsAccumulated ? Number(accumulated) || 0 : 0;
  const monthly = estimateMonthly(method, costN, salvageN, lifeN, rateN);

  const save = useMutation({
    mutationFn: () =>
      fixedAssetsApi.create({
        name: name.trim(),
        asset_class_id: Number(classId),
        branch_code: branchCode || undefined,
        cost_center_id: costCenterId === "" ? undefined : costCenterId,
        serial_no: serialNo.trim() || undefined,
        location: location.trim() || undefined,
        acquisition_date: acquisitionDate,
        cost: costN,
        salvage_value: salvageN || undefined,
        useful_life_months: lifeN || undefined,
        depreciation_method: method,
        declining_rate: method === "declining" && rateN ? rateN : undefined,
        depreciation_start: startDate || undefined,
        accumulated_depreciation: accumulatedN || undefined,
        funding,
        notes: notes.trim() || undefined,
      }),
    onSuccess: (a) => {
      showSuccessToast(`${a.asset_no} ${a.name} added. Book value ${fmt(a.book_value)}.`);
      queryClient.invalidateQueries({ queryKey: ["fixed-assets"] });
      invalidateLedgerQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["depreciation-preview"] });
      onSaved(a);
    },
    onError: (err) => handleApiError(err, "Could not add the asset"),
  });

  const salvageTooHigh = salvageN > costN && costN > 0;
  const accumulatedTooHigh = accumulatedN > costN - salvageN && costN > 0;
  const valid =
    !!name.trim() &&
    classId !== "" &&
    !!acquisitionDate &&
    costN > 0 &&
    !salvageTooHigh &&
    !accumulatedTooHigh &&
    (method === "declining" ? rateN > 0 : lifeN > 0) &&
    !lifeError &&
    !rateError;

  return (
    <DetailShell
      header={
        <DetailPanelHeader
          breadcrumbs={[...BASE_CRUMBS, { label: "New Asset" }]}
          title=""
          titleIcon={<PrecisionManufacturingIcon color="primary" />}
          isCreating
          createTitle="New Asset"
        />
      }
      toolbar={
        <ActionToolbar
          isCreating
          isEditing={false}
          isSaving={save.isPending}
          isFormValid={valid}
          onSave={() => submitOnce("FixedAssetsPage-save-1", save)}
          onCancel={onCancel}
        />
      }
    >
      <FormSection title="Asset" columns={3}>
        <TextField
          label="What is it?"
          placeholder="e.g. Delivery van, Office laptop"
          size="small"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          inputProps={{ maxLength: 200 }}
        />
        <TextField
          select
          label="Kind of asset"
          size="small"
          required
          value={classId}
          onChange={(e) => pickClass(Number(e.target.value))}
          helperText={activeClasses.length === 0 ? "Add an asset class first." : undefined}
        >
          {activeClasses.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField select label="Branch" size="small" value={branchCode} onChange={(e) => setBranchCode(e.target.value)}>
          <MenuItem value="">
            <em>None</em>
          </MenuItem>
          {filteredBranches.map((b) => (
            <MenuItem key={b.branch_code} value={b.branch_code}>
              {b.branch_name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Cost center"
          size="small"
          value={costCenterId}
          onChange={(e) => setCostCenterId(e.target.value === "" ? "" : Number(e.target.value))}
        >
          <MenuItem value="">
            <em>None</em>
          </MenuItem>
          {(costCenters ?? []).map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.code} · {c.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField label="Serial no." size="small" value={serialNo} onChange={(e) => setSerialNo(e.target.value)} inputProps={{ maxLength: 100 }} />
        <TextField label="Where is it?" size="small" value={location} onChange={(e) => setLocation(e.target.value)} inputProps={{ maxLength: 200 }} />
      </FormSection>

      <FormSection title="Cost" columns={3}>
        <TextField
          label="Bought on"
          type="date"
          size="small"
          required
          value={acquisitionDate}
          onChange={(e) => setAcquisitionDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <TextField label="Cost" type="number" size="small" required value={cost} onChange={(e) => setCost(e.target.value)} />
        <TextField
          label="Value at end of life"
          type="number"
          size="small"
          value={salvage}
          onChange={(e) => setSalvage(e.target.value)}
          error={salvageTooHigh}
          helperText={salvageTooHigh ? "Cannot be more than the cost." : "What you expect to sell it for at the end. Often 0."}
        />
      </FormSection>

      <FormSection title="Depreciation" columns={method === "declining" ? 4 : 3}>
        <TextField
          select
          label="How value is spread"
          size="small"
          value={method}
          onChange={(e) => setMethod(e.target.value as DepreciationMethod)}
        >
          {(Object.keys(METHOD_LABEL) as DepreciationMethod[]).map((m) => (
            <MenuItem key={m} value={m}>
              {METHOD_LABEL[m]}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Useful life (months)"
          type="number"
          size="small"
          required={method !== "declining"}
          value={life}
          onChange={(e) => setLife(e.target.value)}
          inputProps={{ min: 1, max: 1200, step: 1 }}
          error={!!lifeError}
          helperText={lifeError ?? (lifeN > 0 ? lifeText(lifeN) : undefined)}
        />
        {method === "declining" && (
          <TextField
            label="Rate per year (%)"
            type="number"
            size="small"
            required
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            inputProps={{ min: 0, max: 100, step: 0.01 }}
            error={!!rateError}
            helperText={rateError ?? undefined}
          />
        )}
        <TextField
          label="Start depreciating from"
          type="date"
          size="small"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
          helperText="Leave empty to use the bought date."
        />
      </FormSection>

      <FormSection title="Funding" columns={2}>
        <TextField
          select
          label="How was it paid for?"
          size="small"
          value={funding}
          onChange={(e) => setFunding(e.target.value as AssetFunding)}
        >
          {(Object.keys(FUNDING_LABEL) as AssetFunding[]).map((f) => (
            <MenuItem key={f} value={f}>
              {FUNDING_LABEL[f]}
            </MenuItem>
          ))}
        </TextField>
        {allowsAccumulated && (
          <TextField
            label="Depreciation already taken"
            type="number"
            size="small"
            value={accumulated}
            onChange={(e) => setAccumulated(e.target.value)}
            error={accumulatedTooHigh}
            helperText={
              accumulatedTooHigh ? "Cannot be more than cost minus value at end of life." : "For assets you already had before."
            }
          />
        )}
      </FormSection>

      <FormSection title="Remarks" columns={1}>
        <TRemarkField label="Note (optional)" size="small" value={notes} onChange={(v) => setNotes(v)} multiline rows={2} />
      </FormSection>

      <Alert severity="info" variant="outlined">
        {costN > 0 ? (
          <>
            About <b>{fmt(monthly)}</b> a month will be counted as depreciation
            {method === "declining" ? " to start with (less each month after)" : ""}. Book value today:{" "}
            <b>{fmt(costN - accumulatedN)}</b>.
          </>
        ) : (
          "Enter the cost to see the monthly depreciation."
        )}
      </Alert>
    </DetailShell>
  );
}

// ─── Sell / scrap ───────────────────────────────────────────────────────────

function DisposeDialog({
  asset,
  initialKind,
  onClose,
  onDone,
}: {
  asset: FixedAsset;
  initialKind: DisposalKind;
  onClose: () => void;
  onDone: (a: FixedAsset) => void;
}) {
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();
  const [kind, setKind] = useState<DisposalKind>(initialKind);
  const [proceeds, setProceeds] = useState("");
  const [receivedInto, setReceivedInto] = useState<"bank" | "cash">("bank");
  const [date, setDate] = useState(TODAY);
  const [notes, setNotes] = useState("");

  const bookValue = Number(asset.book_value);
  const proceedsN = kind === "sold" ? Number(proceeds) || 0 : 0;
  const gain = proceedsN - bookValue;

  const dispose = useMutation({
    mutationFn: () =>
      fixedAssetsApi.dispose(asset.id, {
        kind,
        disposal_date: date || undefined,
        proceeds: kind === "sold" ? proceedsN : undefined,
        received_into: receivedInto,
        notes: notes.trim() || undefined,
      }),
    onSuccess: (a) => {
      showSuccessToast(`${a.asset_no} ${a.name} marked as ${STATUS_LABEL[a.status].toLowerCase()}.`);
      queryClient.invalidateQueries({ queryKey: ["fixed-assets"] });
      invalidateLedgerQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["depreciation-preview"] });
      onDone(a);
    },
    onError: (err) => handleApiError(err, "Could not record the disposal"),
  });

  const gainText = gain >= 0 ? `a gain of ${fmt(gain)}` : `a loss of ${fmt(-gain)}`;

  const submit = async () => {
    const ok = await confirmDialog.confirm({
      title: kind === "sold" ? `Sell ${asset.asset_no}?` : `Scrap ${asset.asset_no}?`,
      message:
        (kind === "sold"
          ? `${asset.name} sold for ${fmt(proceedsN)} (into ${receivedInto}).`
          : `${asset.name} will be written off as scrapped.`) +
        `\nBook value ${fmt(bookValue)} → ${gainText}.\nThis cannot be undone from this screen.`,
      confirmText: kind === "sold" ? "Record sale" : "Scrap asset",
      confirmColor: "warning",
    });
    if (ok) submitOnce("FixedAssetsPage-dispose", dispose);
  };

  const valid = !!date && (kind === "scrapped" || proceedsN >= 0);

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Sell or scrap {asset.asset_no} · {asset.name}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Cost {fmt(asset.cost)} · depreciation so far {fmt(asset.accumulated_depreciation)} · book value{" "}
            {fmt(asset.book_value)}
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              select
              label="What happened?"
              size="small"
              value={kind}
              onChange={(e) => setKind(e.target.value as DisposalKind)}
              sx={{ flex: 1 }}
            >
              <MenuItem value="sold">Sold it</MenuItem>
              <MenuItem value="scrapped">Scrapped / thrown away</MenuItem>
            </TextField>
            <TextField
              label="Date"
              type="date"
              size="small"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ flex: 1 }}
            />
          </Stack>
          {kind === "sold" && (
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Sold for"
                type="number"
                size="small"
                value={proceeds}
                onChange={(e) => setProceeds(e.target.value)}
                sx={{ flex: 1 }}
              />
              <TextField
                select
                label="Money received into"
                size="small"
                value={receivedInto}
                onChange={(e) => setReceivedInto(e.target.value as "bank" | "cash")}
                sx={{ flex: 1 }}
              >
                <MenuItem value="bank">Bank</MenuItem>
                <MenuItem value="cash">Cash</MenuItem>
              </TextField>
            </Stack>
          )}
          <TextField label="Note (optional)" size="small" multiline minRows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Alert severity={gain >= 0 ? "success" : "warning"} variant="outlined">
            {kind === "sold" ? `Sold for ${fmt(proceedsN)}` : "Nothing received"} against a book value of {fmt(bookValue)}:{" "}
            <b>{gainText}</b>.
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" color="warning" disabled={!valid || dispose.isPending} onClick={submit}>
          {kind === "sold" ? "Record sale…" : "Scrap…"}
        </Button>
      </DialogActions>
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </Dialog>
  );
}

// ─── Asset detail ───────────────────────────────────────────────────────────

function AssetViewPanel({ asset, onDispose }: { asset: FixedAsset; onDispose: (kind: DisposalKind) => void }) {
  const canCreate = usePermission("journal_entries", "create");
  const { data: costCenters } = useQuery({
    queryKey: ["cost-centers", "active-options"],
    queryFn: assetCostCentersApi.getActive,
  });
  const cc = asset.cost_center_id != null ? costCenters?.find((c) => c.id === asset.cost_center_id) : undefined;
  const ccText = asset.cost_center_id == null ? "" : cc ? `${cc.code} · ${cc.name}` : `#${asset.cost_center_id}`;
  const disposed = asset.status === "sold" || asset.status === "scrapped";

  return (
    <DetailShell
      header={
        <DetailPanelHeader
          breadcrumbs={[...BASE_CRUMBS, { label: asset.asset_no }]}
          title={`${asset.asset_no} · ${asset.name}`}
          titleIcon={<PrecisionManufacturingIcon color="primary" />}
          chips={[assetChip(asset.status)]}
        />
      }
      toolbar={
        <ActionToolbar
          hasSelectedItem
          isCreating={false}
          isEditing={false}
          endActions={
            canCreate && IN_USE.includes(asset.status) ? (
              <Box sx={{ display: "flex", gap: 0.5 }}>
                <Button size="small" variant="outlined" startIcon={<SellIcon />} onClick={() => onDispose("sold")}>
                  Sell
                </Button>
                <Button size="small" variant="outlined" startIcon={<DeleteSweepIcon />} onClick={() => onDispose("scrapped")}>
                  Scrap
                </Button>
              </Box>
            ) : undefined
          }
        />
      }
    >
      <FormSection title="Asset Information" columns={3}>
        {ro("Asset No", asset.asset_no)}
        {ro("Name", asset.name)}
        {ro("Kind of asset", asset.asset_class_name ?? "")}
        {ro("Branch", asset.branch_code ?? "")}
        {ro("Cost center", ccText)}
        {ro("Bought on", asset.acquisition_date)}
        {ro("Serial no.", asset.serial_no ?? "")}
        {ro("Where is it?", asset.location ?? "")}
      </FormSection>
      <FormSection title="Value" columns={4}>
        {ro("Cost", fmt(asset.cost))}
        {ro("Depreciation so far", fmt(asset.accumulated_depreciation))}
        {ro("Book value", fmt(asset.book_value))}
        {ro("Per month", asset.status === "active" ? fmt(asset.monthly_depreciation) : "—")}
      </FormSection>
      <FormSection title="Depreciation" columns={4}>
        {ro("How value is spread", METHOD_LABEL[asset.depreciation_method])}
        {ro("Useful life", lifeText(asset.useful_life_months))}
        {ro(
          "Rate per year",
          asset.depreciation_method === "declining" && asset.declining_rate != null ? `${Number(asset.declining_rate)}%` : "—",
        )}
        {ro("Value at end of life", fmt(asset.salvage_value))}
        {ro("Start depreciating from", asset.depreciation_start ?? asset.acquisition_date)}
      </FormSection>
      {disposed && (
        <FormSection title="Disposal" columns={3}>
          {ro("Status", STATUS_LABEL[asset.status])}
          {ro("Date", asset.disposal_date ?? "")}
          {asset.status === "sold" && ro("Sold for", fmt(asset.disposal_proceeds))}
        </FormSection>
      )}
      <FormSection title="Remarks" columns={1}>
        <TRemarkField label="Note" size="small" value={asset.notes ?? ""} onChange={() => undefined} disabled multiline rows={2} />
      </FormSection>
    </DetailShell>
  );
}

// ─── Register tab ───────────────────────────────────────────────────────────

function RegisterTab({ nav }: { nav: TabNav }) {
  const canCreate = usePermission("journal_entries", "create");
  const { filteredBranches } = useReferenceData();
  const { data: assets, isLoading, refetch } = useQuery({ queryKey: ["fixed-assets"], queryFn: () => fixedAssetsApi.getAll() });
  const { data: classes } = useQuery({ queryKey: ["asset-classes"], queryFn: assetClassesApi.getAll });

  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>("in_use");
  const [selected, setSelected] = useState<FixedAsset | null>(null);
  const [creating, setCreating] = useState(false);
  const [disposeKind, setDisposeKind] = useState<DisposalKind | null>(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (assets ?? []).filter(
      (a) =>
        (!status || (status === "in_use" ? IN_USE.includes(a.status) : a.status === status)) &&
        (!branch || a.branch_code === branch) &&
        (!q || [a.asset_no, a.name, a.asset_class_name, a.serial_no, a.location].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [assets, search, branch, status]);

  const columns: TDataGridColumn<FixedAsset>[] = [
    { field: "asset_no", header: "Asset No", minWidth: 120, flex: 0.8 },
    { field: "name", header: "Name", minWidth: 180, flex: 1.4 },
    { field: "asset_class_name", header: "Class", minWidth: 130, flex: 1 },
    { field: "branch_code", header: "Branch", width: 110 },
    { field: "acquisition_date", header: "Bought", width: 120, type: "date" },
    { field: "cost", header: "Cost", width: 130, type: "currency", align: "right", headerAlign: "right" },
    {
      field: "accumulated_depreciation",
      header: "Depreciation So Far",
      width: 160,
      type: "currency",
      align: "right",
      headerAlign: "right",
    },
    { field: "book_value", header: "Book Value", width: 130, type: "currency", align: "right", headerAlign: "right" },
    {
      field: "monthly_depreciation",
      header: "Per Month",
      width: 120,
      align: "right",
      headerAlign: "right",
      renderCell: (p) => (p.row.status === "active" ? fmt(p.row.monthly_depreciation) : "—"),
    },
    {
      field: "status",
      header: "Status",
      width: 150,
      renderCell: (p) => (
        <TStatusChip status={p.row.status} statusMap="financeDocument" customMap={{ active: { label: "In use", color: "success" } }} />
      ),
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
      <AssetCreatePanel
        classes={classes ?? []}
        onCancel={back}
        onSaved={(a) => {
          setCreating(false);
          setSelected(a);
        }}
      />
    );
  } else if (selected) {
    body = <AssetViewPanel asset={selected} onDispose={setDisposeKind} />;
  } else {
    body = (
      <ListBody>
        <TDataGrid<FixedAsset>
          rows={rows}
          columns={columns}
          loading={isLoading}
          onRowClick={(row) => setSelected(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No assets here yet."
          autoHeight={false}
          height="100%"
        />
      </ListBody>
    );
  }

  return (
    <>
      <MasterDetailLayout
        title="Fixed Assets"
        tabs={detailMode ? undefined : TABS}
        activeTab={nav.activeTab}
        onTabChange={nav.onTabChange}
        titleSlot={
          detailMode ? (
            <BackButton label="Back to Register" onClick={back} />
          ) : (
            <FilterRow
              showClear={!!search || !!branch || status !== "in_use"}
              onClear={() => {
                setSearch("");
                setBranch(null);
                setStatus("in_use");
              }}
            >
              <SearchBox value={search} onChange={setSearch} placeholder="Search assets..." />
              <Box sx={{ width: 150, flexShrink: 0 }}>
                <TBranchFilter branches={filteredBranches} value={branch} onChange={setBranch} label="" size="small" />
              </Box>
              <StatusSelect value={status} onChange={setStatus} options={REGISTER_STATUS_OPTIONS} />
            </FilterRow>
          )
        }
        headerActions={!detailMode && canCreate ? <AddButton label="Add Asset" onClick={() => setCreating(true)} /> : undefined}
        onRefresh={() => refetch()}
        isLoading={isLoading}
      >
        {body}
      </MasterDetailLayout>
      {disposeKind && selected && (
        <DisposeDialog
          asset={selected}
          initialKind={disposeKind}
          onClose={() => setDisposeKind(null)}
          onDone={(a) => {
            setDisposeKind(null);
            setSelected(a);
          }}
        />
      )}
    </>
  );
}

// ─── Depreciation tab ───────────────────────────────────────────────────────

function DepreciationCreatePanel({
  runs,
  onCancel,
  onPosted,
}: {
  runs: DepreciationRun[] | undefined;
  onCancel: () => void;
  onPosted: (r: DepreciationRun) => void;
}) {
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();
  const canPost = usePermission("accounting_periods", "update");
  const [year, setYear] = useState(THIS_YEAR);
  const [month, setMonth] = useState(THIS_MONTH);

  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ["depreciation-preview", year, month],
    queryFn: () => depreciationRunsApi.preview(year, month),
  });

  const previewTotal = (preview ?? []).reduce((s, l) => s + Number(l.amount), 0);
  const alreadyPosted = (runs ?? []).some((r) => r.status === "posted" && r.period_year === year && r.period_month === month);
  const isFuture = year * 12 + month > THIS_YEAR * 12 + THIS_MONTH;
  const label = monthLabel(year, month);

  const post = useMutation({
    mutationFn: () => depreciationRunsApi.post(year, month),
    onSuccess: (r) => {
      showSuccessToast(`Depreciation for ${monthLabel(r.period_year, r.period_month)} posted: ${fmt(r.total)}.`);
      queryClient.invalidateQueries({ queryKey: ["depreciation-runs"] });
      invalidateLedgerQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["depreciation-preview"] });
      queryClient.invalidateQueries({ queryKey: ["fixed-assets"] });
      onPosted(r);
    },
    onError: (err) => handleApiError(err, "Could not post depreciation"),
  });

  const handlePost = async () => {
    const ok = await confirmDialog.confirm({
      title: `Post depreciation for ${label}?`,
      message: `${fmt(previewTotal)} across ${preview?.length ?? 0} asset(s) will be booked as a cost for ${label}, and their book values will go down.`,
      confirmText: "Post depreciation",
    });
    if (ok) submitOnce("FixedAssetsPage-post-run", post);
  };

  const years = Array.from({ length: 6 }, (_, i) => THIS_YEAR - 4 + i);
  const previewRows = (preview ?? []).map((l) => ({ ...l, id: l.asset_id }));
  const previewColumns: TDataGridColumn<(typeof previewRows)[number]>[] = [
    { field: "asset_no", header: "Asset No", minWidth: 120, flex: 0.8 },
    { field: "name", header: "Name", minWidth: 180, flex: 1.5 },
    { field: "branch_code", header: "Branch", width: 120 },
    { field: "amount", header: "Amount", width: 140, type: "currency", align: "right", headerAlign: "right" },
  ];

  return (
    <DetailShell
      header={
        <DetailPanelHeader
          breadcrumbs={[...BASE_CRUMBS, { label: "Depreciation" }, { label: "New Run" }]}
          title=""
          titleIcon={<TrendingDownIcon color="primary" />}
          isCreating
          createTitle="New Depreciation Run"
        />
      }
      toolbar={
        <ActionToolbar
          isCreating
          isEditing={false}
          isSaving={post.isPending}
          onCancel={onCancel}
          endActions={
            canPost ? (
              <Button
                size="small"
                variant="outlined"
                startIcon={<TrendingDownIcon />}
                disabled={alreadyPosted || isFuture || !preview || preview.length === 0 || post.isPending}
                onClick={handlePost}
              >
                Post Depreciation for {label}
              </Button>
            ) : undefined
          }
        />
      }
    >
      <Alert severity="info" variant="outlined" sx={{ mb: 1.5 }}>
        Depreciation is usually posted once a month, before you close the month.
      </Alert>
      <FormSection title="Period" columns={4}>
        <TextField select label="Month" size="small" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {MONTHS.map((m, i) => (
            <MenuItem key={m} value={i + 1}>
              {m}
            </MenuItem>
          ))}
        </TextField>
        <TextField select label="Year" size="small" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => (
            <MenuItem key={y} value={y}>
              {y}
            </MenuItem>
          ))}
        </TextField>
        {ro("Assets", preview?.length ?? 0)}
        {ro("Total to post", fmt(previewTotal))}
      </FormSection>
      {alreadyPosted && (
        <Alert severity="success" variant="outlined" sx={{ mb: 1.5 }}>
          Depreciation for {label} has already been posted.
        </Alert>
      )}
      {isFuture && (
        <Alert severity="warning" variant="outlined" sx={{ mb: 1.5 }}>
          {label} has not started yet. Depreciation can only be posted for the current or a past month.
        </Alert>
      )}
      <FormSection title={`What will be posted for ${label}`} columns={1}>
        <TDataGrid
          rows={previewRows}
          columns={previewColumns}
          loading={previewLoading}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          autoHeight
          emptyMessage={alreadyPosted ? "Already posted for this month." : "Nothing to depreciate for this month."}
        />
      </FormSection>
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </DetailShell>
  );
}

function DepreciationRunPanel({
  run,
  isLatest,
  onReversed,
}: {
  run: DepreciationRun;
  isLatest: boolean;
  onReversed: (r: DepreciationRun) => void;
}) {
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();
  const canPost = usePermission("accounting_periods", "update");
  const label = monthLabel(run.period_year, run.period_month);

  const reverse = useMutation({
    mutationFn: () => depreciationRunsApi.reverse(run.id),
    onSuccess: (r) => {
      showSuccessToast(`Depreciation for ${monthLabel(r.period_year, r.period_month)} reversed.`);
      queryClient.invalidateQueries({ queryKey: ["depreciation-runs"] });
      invalidateLedgerQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["depreciation-preview"] });
      queryClient.invalidateQueries({ queryKey: ["fixed-assets"] });
      onReversed(r);
    },
    onError: (err) => handleApiError(err, "Could not reverse the run"),
  });

  const handleReverse = async () => {
    const ok = await confirmDialog.confirm({
      title: `Reverse depreciation for ${label}?`,
      message: `The ${fmt(run.total)} posted for ${label} will be taken back and book values restored. You can post it again afterwards.`,
      confirmText: "Reverse",
      confirmColor: "warning",
    });
    if (ok) submitOnce("FixedAssetsPage-reverse-run", reverse);
  };

  return (
    <DetailShell
      header={
        <DetailPanelHeader
          breadcrumbs={[...BASE_CRUMBS, { label: "Depreciation" }, { label }]}
          title={`Depreciation · ${label}`}
          titleIcon={<TrendingDownIcon color="primary" />}
          chips={[getStatusProps(run.status, "financeDocument")]}
        />
      }
      toolbar={
        <ActionToolbar
          hasSelectedItem
          isCreating={false}
          isEditing={false}
          endActions={
            canPost && isLatest && run.status === "posted" ? (
              <Button size="small" variant="outlined" startIcon={<UndoIcon />} disabled={reverse.isPending} onClick={handleReverse}>
                Reverse
              </Button>
            ) : undefined
          }
        />
      }
    >
      <FormSection title="Run Information" columns={4}>
        {ro("Month", label)}
        {ro("Posted on", run.run_date)}
        {ro("Assets", run.asset_count)}
        {ro("Total", fmt(run.total))}
      </FormSection>
      {run.status === "posted" && !isLatest && (
        <Alert severity="info" variant="outlined">
          Only the latest posted month can be reversed.
        </Alert>
      )}
      {run.status === "reversed" && (
        <Alert severity="info" variant="outlined">
          This run was reversed: the depreciation was taken back and book values restored.
        </Alert>
      )}
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </DetailShell>
  );
}

type RunRow = DepreciationRun & { period_key: number };

function DepreciationTab({ nav }: { nav: TabNav }) {
  const canPost = usePermission("accounting_periods", "update");
  const { data: runs, isLoading, refetch } = useQuery({ queryKey: ["depreciation-runs"], queryFn: depreciationRunsApi.getAll });

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [selected, setSelected] = useState<DepreciationRun | null>(null);
  const [creating, setCreating] = useState(false);

  const latestPosted = useMemo(
    () =>
      (runs ?? [])
        .filter((r) => r.status === "posted")
        .reduce<DepreciationRun | null>(
          (best, r) =>
            !best || r.period_year * 12 + r.period_month > best.period_year * 12 + best.period_month ? r : best,
          null,
        ),
    [runs],
  );

  const rows: RunRow[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (runs ?? [])
      .filter(
        (r) =>
          (!status || r.status === status) &&
          (!q || monthLabel(r.period_year, r.period_month).toLowerCase().includes(q) || r.run_date.includes(q)),
      )
      .map((r) => ({ ...r, period_key: r.period_year * 12 + r.period_month }));
  }, [runs, search, status]);

  const columns: TDataGridColumn<RunRow>[] = [
    {
      field: "period_key",
      header: "Month",
      minWidth: 160,
      flex: 1,
      renderCell: (p) => monthLabel(p.row.period_year, p.row.period_month),
    },
    { field: "run_date", header: "Posted On", width: 130, type: "date" },
    { field: "asset_count", header: "Assets", width: 110, type: "number" },
    { field: "total", header: "Total", width: 150, type: "currency", align: "right", headerAlign: "right" },
    { field: "status", header: "Status", width: 130, type: "status", statusMap: "financeDocument" },
  ];

  const back = () => {
    setSelected(null);
    setCreating(false);
  };
  const detailMode = creating || !!selected;

  let body: ReactNode;
  if (creating) {
    body = (
      <DepreciationCreatePanel
        runs={runs}
        onCancel={back}
        onPosted={(r) => {
          setCreating(false);
          setSelected(r);
        }}
      />
    );
  } else if (selected) {
    // After a post / reverse the list refetches; the latest check uses the
    // fresh list, falling back to the run itself right after posting.
    const isLatest = latestPosted ? latestPosted.id === selected.id : selected.status === "posted";
    body = <DepreciationRunPanel run={selected} isLatest={isLatest} onReversed={setSelected} />;
  } else {
    body = (
      <ListBody>
        <TDataGrid<RunRow>
          rows={rows}
          columns={columns}
          loading={isLoading}
          onRowClick={(row) => setSelected(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No depreciation posted yet."
          autoHeight={false}
          height="100%"
        />
      </ListBody>
    );
  }

  return (
    <MasterDetailLayout
      title="Fixed Assets"
      tabs={detailMode ? undefined : TABS}
      activeTab={nav.activeTab}
      onTabChange={nav.onTabChange}
      titleSlot={
        detailMode ? (
          <BackButton label="Back to Depreciation" onClick={back} />
        ) : (
          <FilterRow
            showClear={!!search || !!status}
            onClear={() => {
              setSearch("");
              setStatus(null);
            }}
          >
            <SearchBox value={search} onChange={setSearch} placeholder="Search runs..." />
            <StatusSelect value={status} onChange={setStatus} options={RUN_STATUS_OPTIONS} />
          </FilterRow>
        )
      }
      headerActions={
        !detailMode && canPost ? <AddButton label="New Depreciation Run" onClick={() => setCreating(true)} /> : undefined
      }
      onRefresh={() => refetch()}
      isLoading={isLoading}
    >
      {body}
    </MasterDetailLayout>
  );
}

// ─── Asset classes tab ──────────────────────────────────────────────────────

function AssetClassPanel({
  existing,
  onCancelCreate,
  onSaved,
}: {
  existing: AssetClass | null;
  onCancelCreate: () => void;
  onSaved: (c: AssetClass) => void;
}) {
  const queryClient = useQueryClient();
  const canEdit = usePermission("chart_of_accounts", "update");
  const creating = !existing;
  const [editing, setEditing] = useState(false);

  const [code, setCode] = useState(existing?.code ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [accountId, setAccountId] = useState<number | null>(existing?.asset_account_id ?? null);
  const [method, setMethod] = useState<DepreciationMethod>(existing?.depreciation_method ?? "straight_line");
  const [life, setLife] = useState(existing ? String(existing.useful_life_months) : "60");
  const [rate, setRate] = useState(existing?.declining_rate != null ? String(Number(existing.declining_rate)) : "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [isActive, setIsActive] = useState(existing?.is_active ?? true);

  const resetFrom = (c: AssetClass) => {
    setCode(c.code);
    setName(c.name);
    setAccountId(c.asset_account_id);
    setMethod(c.depreciation_method);
    setLife(String(c.useful_life_months));
    setRate(c.declining_rate != null ? String(Number(c.declining_rate)) : "");
    setDescription(c.description ?? "");
    setIsActive(c.is_active);
  };

  const { data: accounts, isLoading: accountsLoading } = useQuery({
    queryKey: ["chart-of-accounts", "active-all"],
    queryFn: () => chartOfAccountsApi.getAll({ is_active: true, limit: 1000 }),
  });
  const assetLeaves = useMemo(() => {
    const list = accounts ?? [];
    const parents = new Set(list.filter((a) => a.is_active && a.parent_account_id).map((a) => a.parent_account_id));
    return list.filter((a) => a.is_active && a.account_type === "Asset" && !parents.has(a.id));
  }, [accounts]);
  const account = assetLeaves.find((a) => a.id === accountId) ?? null;

  const lifeN = Number(life) || 0;
  const rateN = Number(rate) || 0;
  const lifeError = lifeProblem(life);
  const rateError = rateN < 0 || rateN > 100 ? "Rate must be between 0 and 100" : null;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: code.trim(),
        name: name.trim(),
        asset_account_id: accountId as number,
        depreciation_method: method,
        useful_life_months: lifeN,
        declining_rate: method === "declining" ? rateN : null,
        description: description.trim() || null,
      };
      return existing ? assetClassesApi.update(existing.id, { ...body, is_active: isActive }) : assetClassesApi.create(body);
    },
    onSuccess: (c) => {
      showSuccessToast(existing ? `${c.name} updated.` : `${c.name} added.`);
      queryClient.invalidateQueries({ queryKey: ["asset-classes"] });
      setEditing(false);
      onSaved(c);
    },
    onError: (err) => handleApiError(err, "Could not save the asset class"),
  });

  const valid =
    !!code.trim() && !!name.trim() && accountId !== null && lifeN > 0 && !lifeError && !rateError && (method !== "declining" || rateN > 0);
  const readOnly = !creating && !editing;

  return (
    <DetailShell
      header={
        <DetailPanelHeader
          breadcrumbs={[...BASE_CRUMBS, { label: "Asset Classes" }, { label: existing ? existing.code : "New Asset Class" }]}
          title={existing ? `${existing.code} · ${existing.name}` : ""}
          titleIcon={<CategoryIcon color="primary" />}
          isCreating={creating}
          createTitle="New Asset Class"
          chips={existing ? [getStatusProps(existing.is_active ? "active" : "inactive", "financeDocument")] : []}
        />
      }
      toolbar={
        <ActionToolbar
          hasSelectedItem={!!existing}
          isCreating={creating}
          isEditing={editing}
          isSaving={save.isPending}
          isFormValid={valid}
          canUpdate={canEdit}
          onEdit={() => setEditing(true)}
          onSave={() => submitOnce("FixedAssetsPage-save-2", save)}
          onCancel={() => {
            if (existing) {
              resetFrom(existing);
              setEditing(false);
            } else {
              onCancelCreate();
            }
          }}
        />
      }
    >
      <FormSection title="Asset Class" columns={2}>
        <TextField label="Code" size="small" required value={code} onChange={(e) => setCode(e.target.value)} disabled={readOnly} inputProps={{ maxLength: 20 }} />
        <TextField
          label="Name"
          placeholder="e.g. Vehicles"
          size="small"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={readOnly}
          inputProps={{ maxLength: 100 }}
        />
        <Box sx={{ gridColumn: "1 / -1" }}>
          <Autocomplete
            options={assetLeaves}
            loading={accountsLoading}
            value={account}
            onChange={(_, v) => setAccountId(v?.id ?? null)}
            getOptionLabel={(a) => `${a.account_code} · ${a.account_name}`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            disabled={readOnly}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Account the cost is kept in"
                size="small"
                required
                helperText="An asset account, e.g. Motor Vehicles."
              />
            )}
          />
        </Box>
      </FormSection>
      <FormSection title="Depreciation Defaults" columns={method === "declining" ? 3 : 2}>
        <TextField
          select
          label="How value is spread"
          size="small"
          value={method}
          onChange={(e) => setMethod(e.target.value as DepreciationMethod)}
          disabled={readOnly}
        >
          {(Object.keys(METHOD_LABEL) as DepreciationMethod[]).map((m) => (
            <MenuItem key={m} value={m}>
              {METHOD_LABEL[m]}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Useful life (months)"
          type="number"
          size="small"
          required
          value={life}
          onChange={(e) => setLife(e.target.value)}
          inputProps={{ min: 1, max: 1200, step: 1 }}
          error={!!lifeError}
          helperText={lifeError ?? (lifeN > 0 ? lifeText(lifeN) : undefined)}
          disabled={readOnly}
        />
        {method === "declining" && (
          <TextField
            label="Rate per year (%)"
            type="number"
            size="small"
            required
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            inputProps={{ min: 0, max: 100, step: 0.01 }}
            error={!!rateError}
            helperText={rateError ?? undefined}
            disabled={readOnly}
          />
        )}
      </FormSection>
      <FormSection title="Remarks" columns={1}>
        <TRemarkField
          label="Description (optional)"
          size="small"
          value={description}
          onChange={(v) => setDescription(v)}
          multiline
          rows={2}
          disabled={readOnly}
        />
        {existing && editing && (
          <FormControlLabel control={<Switch checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />} label="Active" />
        )}
      </FormSection>
      {creating && (
        <Alert severity="info" variant="outlined">
          Each kind of asset sets the account, life and spreading method new assets start with.
        </Alert>
      )}
    </DetailShell>
  );
}

function AssetClassesTab({ nav }: { nav: TabNav }) {
  const canEdit = usePermission("chart_of_accounts", "update");
  const { data: classes, isLoading, refetch } = useQuery({ queryKey: ["asset-classes"], queryFn: assetClassesApi.getAll });

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [selected, setSelected] = useState<AssetClass | null>(null);
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (classes ?? []).filter(
      (c) =>
        (!status || (status === "active") === c.is_active) &&
        (!q || [c.code, c.name, c.description].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [classes, search, status]);

  const columns: TDataGridColumn<AssetClass>[] = [
    { field: "code", header: "Code", width: 120 },
    { field: "name", header: "Name", minWidth: 180, flex: 1.2 },
    {
      field: "depreciation_method",
      header: "How Value Is Spread",
      minWidth: 220,
      flex: 1.2,
      renderCell: (p) => METHOD_LABEL[p.row.depreciation_method],
    },
    {
      field: "useful_life_months",
      header: "Useful Life",
      width: 130,
      align: "right",
      headerAlign: "right",
      renderCell: (p) => lifeText(p.row.useful_life_months),
    },
    {
      field: "declining_rate",
      header: "Rate / Yr",
      width: 110,
      align: "right",
      headerAlign: "right",
      renderCell: (p) =>
        p.row.depreciation_method === "declining" && p.row.declining_rate != null ? `${Number(p.row.declining_rate)}%` : "—",
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
  if (detailMode) {
    body = (
      <AssetClassPanel
        key={selected?.id ?? "new"}
        existing={creating ? null : selected}
        onCancelCreate={back}
        onSaved={(c) => {
          setCreating(false);
          setSelected(c);
        }}
      />
    );
  } else {
    body = (
      <ListBody>
        <TDataGrid<AssetClass>
          rows={rows}
          columns={columns}
          loading={isLoading}
          onRowClick={(row) => setSelected(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No asset classes yet. Add one (e.g. Vehicles, Computers) before adding assets."
          autoHeight={false}
          height="100%"
        />
      </ListBody>
    );
  }

  return (
    <MasterDetailLayout
      title="Fixed Assets"
      tabs={detailMode ? undefined : TABS}
      activeTab={nav.activeTab}
      onTabChange={nav.onTabChange}
      titleSlot={
        detailMode ? (
          <BackButton label="Back to Asset Classes" onClick={back} />
        ) : (
          <FilterRow
            showClear={!!search || !!status}
            onClear={() => {
              setSearch("");
              setStatus(null);
            }}
          >
            <SearchBox value={search} onChange={setSearch} placeholder="Search classes..." />
            <StatusSelect value={status} onChange={setStatus} options={CLASS_STATUS_OPTIONS} />
          </FilterRow>
        )
      }
      headerActions={!detailMode && canEdit ? <AddButton label="Add Asset Class" onClick={() => setCreating(true)} /> : undefined}
      onRefresh={() => refetch()}
      isLoading={isLoading}
    >
      {body}
    </MasterDetailLayout>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

/** Useful life must be a whole number of months, 1 to 1200 (100 years). */
function lifeProblem(life: string): string | null {
  if (String(life ?? "").trim() === "") return null;
  const n = Number(life);
  if (!Number.isInteger(n)) return "Enter whole months, e.g. 12 or 60";
  if (n < 1 || n > 1200) return "Useful life must be between 1 and 1200 months";
  return null;
}

export default function FixedAssetsPage() {
  const [tab, setTab] = useState(0);
  const nav: TabNav = { activeTab: tab, onTabChange: (t) => setTab(Number(t)) };

  if (tab === 1) return <DepreciationTab nav={nav} />;
  if (tab === 2) return <AssetClassesTab nav={nav} />;
  return <RegisterTab nav={nav} />;
}
