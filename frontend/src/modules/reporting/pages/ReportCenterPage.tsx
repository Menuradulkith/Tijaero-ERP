import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SearchIcon from "@mui/icons-material/Search";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import DownloadIcon from "@mui/icons-material/Download";
import SaveIcon from "@mui/icons-material/Save";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { showErrorToast, showSuccessToast, TConfirmDialog, useTConfirmDialog } from "@/components/tijaero";
import { handleApiError } from "@/utils/errorHandling";
import {
  reportCenterApi,
  type ExportFormat,
  type Option,
  type ParamValues,
  type RecentRun,
  type ReportCatalog,
  type ReportDefinition,
  type ReportRunResult,
  type ReportView,
  type SavedReport,
} from "../center-api";
import ReportParamsForm from "../components/ReportParamsForm";
import ReportResultView from "../components/ReportResultView";

const FAVOURITES_KEY = "report-center-favourites";

function readFavourites(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FAVOURITES_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function defaultsFor(report: ReportDefinition): ParamValues {
  return Object.fromEntries(report.params.map((p) => [p.key, p.default ?? null]));
}

/** Axios errors from blob requests carry the JSON error body as a Blob. */
async function blobErrorMessage(error: unknown, fallback: string): Promise<string> {
  const data = axios.isAxiosError(error) ? error.response?.data : undefined;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      if (typeof parsed?.detail === "string") return parsed.detail;
    } catch {
      /* not JSON */
    }
  }
  return handleApiError(error, fallback);
}

/**
 * Report Center: every report in one place. Pick a report (or a saved one), set its
 * filters, run it, change columns and sort, export to Excel/CSV/PDF, save the setup.
 */
export default function ReportCenterPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Phones and small tablets show the catalogue or the open report, not both stacked.
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down("md"));
  const confirmDialog = useTConfirmDialog();

  const [catalog, setCatalog] = useState<ReportCatalog | null>(null);
  const [recent, setRecent] = useState<RecentRun[]>([]);
  const [branches, setBranches] = useState<Option[]>([]);
  const [favourites, setFavourites] = useState<string[]>(readFavourites);
  const [search, setSearch] = useState("");

  const [params, setParams] = useState<ParamValues>({});
  const [view, setView] = useState<ReportView>({});
  const [result, setResult] = useState<ReportRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);
  const [exporting, setExporting] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);

  const reportKey = searchParams.get("report");
  const savedId = Number(searchParams.get("saved")) || null;
  const report = useMemo(() => catalog?.reports.find((r) => r.key === reportKey) ?? null, [catalog, reportKey]);
  const saved = useMemo(() => catalog?.saved.find((s) => s.id === savedId) ?? null, [catalog, savedId]);

  const loadCatalog = useCallback(async () => {
    try {
      setCatalog(await reportCenterApi.catalog());
    } catch (e) {
      showErrorToast(handleApiError(e, "Failed to load reports"));
    }
  }, []);

  useEffect(() => {
    loadCatalog();
    reportCenterApi.recent().then(setRecent).catch(() => {});
    reportCenterApi.branches().then(setBranches).catch(() => {});
  }, [loadCatalog]);

  // ── Running ──────────────────────────────────────────────────────────────
  const abortRef = useRef<AbortController | null>(null);
  const run = useCallback(
    async (key: string, values: ParamValues, fromSaved: number | null) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      setRunError(null);
      try {
        const data = await reportCenterApi.run(key, values, fromSaved, controller.signal);
        setResult(data);
        setParams(data.params);
        reportCenterApi.recent().then(setRecent).catch(() => {});
      } catch (e) {
        if (axios.isCancel(e)) return;
        setResult(null);
        setRunError(handleApiError(e, "The report could not be run"));
      } finally {
        if (abortRef.current === controller) setRunning(false);
      }
    },
    [],
  );

  // Selecting a report or a saved report (URL is the source of truth, so links work).
  const lastSelection = useRef<string>("");
  useEffect(() => {
    if (!catalog || !report) return;
    const selection = `${report.key}:${savedId ?? ""}`;
    if (lastSelection.current === selection) return;
    lastSelection.current = selection;
    setResult(null);
    setRunError(null);
    if (saved) {
      const values = { ...defaultsFor(report), ...saved.params };
      setParams(values);
      setView(saved.view ?? {});
      run(report.key, values, saved.id);
    } else {
      setParams(defaultsFor(report));
      setView({});
    }
  }, [catalog, report, saved, savedId, run]);

  const select = (key: string, savedReportId?: number | null, values?: ParamValues) => {
    const next: Record<string, string> = { report: key };
    if (savedReportId) next.saved = String(savedReportId);
    setSearchParams(next);
    if (narrow) window.scrollTo({ top: 0 });
    if (values) {
      // A recent run: show it with the same filters straight away.
      const def = catalog?.reports.find((r) => r.key === key);
      if (def) {
        lastSelection.current = `${key}:${savedReportId ?? ""}`;
        const merged = { ...defaultsFor(def), ...values };
        setParams(merged);
        setView({});
        run(key, merged, null);
      }
    }
  };

  const toggleFavourite = (key: string) => {
    const next = favourites.includes(key) ? favourites.filter((f) => f !== key) : [...favourites, key];
    setFavourites(next);
    try {
      localStorage.setItem(FAVOURITES_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: favourites last for this visit only */
    }
  };

  // ── Export ───────────────────────────────────────────────────────────────
  // Refs, not state: a second click can arrive before the disabled button re-renders.
  const exportingRef = useRef(false);
  const doExport = async (format: ExportFormat, table?: string) => {
    if (!report || exportingRef.current) return;
    exportingRef.current = true;
    setExportAnchor(null);
    setExporting(true);
    try {
      const { blob, filename } = await reportCenterApi.export(report.key, {
        params,
        view,
        format,
        table,
        title: saved?.name,
      });
      const url = URL.createObjectURL(blob);
      if (format === "html") {
        window.open(url, "_blank", "noopener");
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      showErrorToast(await blobErrorMessage(e, "Export failed"));
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  };

  // ── Saved reports ────────────────────────────────────────────────────────
  const deleteSaved = async () => {
    if (!saved) return;
    const ok = await confirmDialog.confirm({
      title: "Delete saved report",
      message: `Delete "${saved.name}"? ${saved.is_shared ? "Everyone it was shared with loses it too." : ""}`,
      confirmText: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await reportCenterApi.deleteSaved(saved.id);
      showSuccessToast("Saved report deleted");
      setSearchParams({ report: saved.report_key });
      await loadCatalog();
    } catch (e) {
      showErrorToast(handleApiError(e, "Failed to delete"));
    }
  };

  // ── Catalogue list ───────────────────────────────────────────────────────
  const term = search.trim().toLowerCase();
  const matches = (r: ReportDefinition) =>
    !term || [r.title, r.description, r.module, ...r.tags].some((s) => s.toLowerCase().includes(term));
  const byModule = useMemo(() => {
    const groups = new Map<string, ReportDefinition[]>();
    for (const r of catalog?.reports ?? []) {
      if (!matches(r)) continue;
      groups.set(r.module, [...(groups.get(r.module) ?? []), r]);
    }
    return [...groups.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, term]);
  const favReports = (catalog?.reports ?? []).filter((r) => favourites.includes(r.key) && matches(r));
  const savedList = (catalog?.saved ?? []).filter((s) => !term || s.name.toLowerCase().includes(term));
  const titleOf = (key: string) => catalog?.reports.find((r) => r.key === key)?.title ?? key;

  if (!catalog) {
    return (
      <Box display="flex" justifyContent="center" p={6}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        Report Center
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Run any report you have access to, export it, and save the filters and columns you use.
      </Typography>

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "300px 1fr" }, alignItems: "start" }}>
        {/* ── Catalogue ── */}
        {(!narrow || !report) && (
          <Paper variant="outlined" sx={{ position: { md: "sticky" }, top: { md: 80 }, maxHeight: { md: "calc(100vh - 110px)" }, overflow: "auto" }}>
            <Box sx={{ p: 1.5, pb: 0.5 }}>
              <TextField
                size="small"
                fullWidth
                placeholder="Search reports"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
              />
            </Box>
            <List dense disablePadding sx={{ pb: 1 }}>
              {favReports.length > 0 && <ListSubheader disableSticky>Favourites</ListSubheader>}
              {favReports.map((r) => (
                <ListItemButton key={`fav-${r.key}`} selected={reportKey === r.key && !savedId} onClick={() => select(r.key)}>
                  <ListItemText primary={r.title} />
                </ListItemButton>
              ))}
              {savedList.length > 0 && <ListSubheader disableSticky>Saved reports</ListSubheader>}
              {savedList.map((s) => (
                <ListItemButton key={`saved-${s.id}`} selected={savedId === s.id} onClick={() => select(s.report_key, s.id)}>
                  <ListItemText
                    primary={s.name}
                    secondary={`${titleOf(s.report_key)}${s.is_shared ? " · shared" : ""}`}
                  />
                </ListItemButton>
              ))}
              {!term && recent.length > 0 && <ListSubheader disableSticky>Recent</ListSubheader>}
              {!term &&
                recent.slice(0, 5).map((r) => (
                  <ListItemButton key={`recent-${r.report_key}`} onClick={() => select(r.report_key, null, r.params)}>
                    <ListItemText primary={r.title} secondary={new Date(r.run_at).toLocaleString()} />
                  </ListItemButton>
                ))}
              {byModule.map(([module, reports]) => (
                <Box key={module}>
                  <ListSubheader disableSticky>{module}</ListSubheader>
                  {reports.map((r) => (
                    <ListItemButton key={r.key} selected={reportKey === r.key && !savedId} onClick={() => select(r.key)}>
                      <ListItemText primary={r.title} />
                    </ListItemButton>
                  ))}
                </Box>
              ))}
              {byModule.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                  {catalog.reports.length === 0 ? "You don't have access to any reports." : "No reports match your search."}
                </Typography>
              )}
            </List>
          </Paper>
        )}

        {/* ── Viewer ── */}
        {!report ? (
          !narrow && (
            <Paper variant="outlined" sx={{ p: 4 }}>
              <Typography variant="h6" gutterBottom>
                Pick a report
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {catalog.reports.length} reports are available to you. Star the ones you use most; save a report to keep its
                filters and columns.
              </Typography>
            </Paper>
          )
        ) : (
          <Stack spacing={2} sx={{ minWidth: 0 }}>
            {narrow && (
              <Button startIcon={<ArrowBackIcon />} onClick={() => setSearchParams({})} sx={{ alignSelf: "flex-start" }}>
                All reports
              </Button>
            )}
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" alignItems="flex-start" spacing={1} sx={{ mb: 2 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
                    <Typography variant="h5" fontWeight={600}>
                      {saved?.name ?? report.title}
                    </Typography>
                    <Tooltip title={favourites.includes(report.key) ? "Remove from favourites" : "Add to favourites"}>
                      <IconButton size="small" onClick={() => toggleFavourite(report.key)} aria-label="Toggle favourite">
                        {favourites.includes(report.key) ? <StarIcon color="warning" fontSize="small" /> : <StarBorderIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                    <Chip size="small" label={report.module} />
                    {report.company_wide && <Chip size="small" variant="outlined" label="Company-wide" />}
                    {saved?.is_shared && <Chip size="small" color="info" variant="outlined" label="Shared" />}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {saved ? `${report.title} · ${saved.description ?? report.description}` : report.description}
                  </Typography>
                </Box>
              </Stack>

              {report.params.length > 0 && (
                <ReportParamsForm params={report.params} values={params} onChange={setParams} branches={branches} />
              )}

              <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
                <Button
                  variant="contained"
                  startIcon={running ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
                  onClick={() => run(report.key, params, saved?.id ?? null)}
                  disabled={running}
                >
                  Run report
                </Button>
                <Button
                  variant="outlined"
                  startIcon={exporting ? <CircularProgress size={16} /> : <DownloadIcon />}
                  onClick={(e) => setExportAnchor(e.currentTarget)}
                  disabled={exporting || !result}
                >
                  Export
                </Button>
                <Menu anchorEl={exportAnchor} open={!!exportAnchor} onClose={() => setExportAnchor(null)}>
                  <MenuItem onClick={() => doExport("xlsx")}>Excel (all tables)</MenuItem>
                  <MenuItem onClick={() => doExport("pdf")}>PDF</MenuItem>
                  <MenuItem onClick={() => doExport("html")}>Printable page</MenuItem>
                  <Divider />
                  {(result?.tables ?? []).map((t) => (
                    <MenuItem key={t.key} onClick={() => doExport("csv", t.key)}>
                      CSV: {t.title}
                    </MenuItem>
                  ))}
                </Menu>
                <Button variant="outlined" startIcon={<SaveIcon />} onClick={() => setSaveOpen(true)}>
                  {saved?.can_edit ? "Save changes" : "Save as…"}
                </Button>
                {saved?.can_edit && (
                  <Button color="error" startIcon={<DeleteOutlineIcon />} onClick={deleteSaved}>
                    Delete
                  </Button>
                )}
              </Stack>
            </Paper>

            {runError && <Alert severity="error">{runError}</Alert>}
            {running && !result && (
              <Box display="flex" justifyContent="center" p={4}>
                <CircularProgress />
              </Box>
            )}
            {result && result.report.key === report.key && (
              <Box sx={{ opacity: running ? 0.5 : 1, transition: "opacity .2s" }}>
                <ReportResultView result={result} view={view} onViewChange={setView} />
              </Box>
            )}
          </Stack>
        )}
      </Box>

      {report && (
        <SaveDialog
          open={saveOpen}
          onClose={() => setSaveOpen(false)}
          report={report}
          saved={saved}
          canShare={catalog.can_share}
          params={params}
          view={view}
          onSaved={async (s) => {
            setSaveOpen(false);
            await loadCatalog();
            lastSelection.current = `${s.report_key}:${s.id}`;
            setSearchParams({ report: s.report_key, saved: String(s.id) });
          }}
        />
      )}
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </Box>
  );
}

function SaveDialog({
  open,
  onClose,
  report,
  saved,
  canShare,
  params,
  view,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  report: ReportDefinition;
  saved: SavedReport | null;
  canShare: boolean;
  params: ParamValues;
  view: ReportView;
  onSaved: (s: SavedReport) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  // A double-click reaches submit twice before `busy` disables the button; the ref stops the second save.
  const busyRef = useRef(false);
  const updating = !!saved?.can_edit;

  useEffect(() => {
    if (!open) return;
    setName(updating ? saved!.name : saved ? `${saved.name} (copy)` : report.title);
    setDescription(saved?.description ?? "");
    setShared(updating ? saved!.is_shared : false);
  }, [open, saved, report, updating]);

  // Only keep filters the user changed from the defaults, so "this month" stays relative.
  const changedParams = () =>
    Object.fromEntries(
      report.params
        .filter((p) => params[p.key] !== null && params[p.key] !== undefined && params[p.key] !== "" && params[p.key] !== p.default)
        .map((p) => [p.key, params[p.key]]),
    );

  const submit = async (asNew: boolean) => {
    if (!name.trim() || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const body = { name: name.trim(), description: description.trim() || null, params: changedParams(), view, is_shared: shared };
      const s =
        updating && !asNew
          ? await reportCenterApi.updateSaved(saved!.id, body)
          : await reportCenterApi.createSaved({ ...body, report_key: report.key });
      showSuccessToast("Report saved");
      onSaved(s);
    } catch (e) {
      showErrorToast(handleApiError(e, "Failed to save the report"));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{updating ? "Save changes" : "Save report"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus size="small" />
          <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} multiline minRows={2} size="small" />
          <Typography variant="caption" color="text.secondary">
            Keeps the filters you changed (dates left at their defaults stay relative, like "this month") and your column and
            sort choices.
          </Typography>
          {canShare && (
            <FormControlLabel
              control={<Switch checked={shared} onChange={(e) => setShared(e.target.checked)} />}
              label="Share with everyone who can run this report"
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        {updating && (
          <Button onClick={() => submit(true)} disabled={busy || !name.trim()}>
            Save as new
          </Button>
        )}
        <Button variant="contained" onClick={() => submit(false)} disabled={busy || !name.trim()}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
