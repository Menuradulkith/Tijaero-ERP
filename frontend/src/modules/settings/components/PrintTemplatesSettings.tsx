import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  FormControl,
  FormControlLabel,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import HistoryIcon from "@mui/icons-material/History";
import { usePermission } from "@/auth/permissions";
import { useAuthStore } from "@/state/authStore";
import { showErrorToast, showSuccessToast, TConfirmDialog, useTConfirmDialog } from "@/components/tijaero";
import { handleApiError } from "@/utils/errorHandling";
import { settingsApi } from "../api";
import type {
  Orientation,
  PaperSize,
  PrintDocumentType,
  PrintLayoutSettings,
  PrintSampleDocument,
  PrintTemplateDetail,
  PrintTemplatePayload,
  PrintTemplateSummary,
  PrintTemplateVersion,
} from "../types";

const PAPER_SIZES: PaperSize[] = ["A4", "A5", "Letter", "Legal", "80mm"];
const MAX_LOGO_BYTES = 1024 * 1024;
// A4 at 96 dpi: the preview is drawn at this size, then scaled to the panel width.
const PREVIEW_PAGE_WIDTH = 794;
const PREVIEW_PAGE_HEIGHT = 1123;

const EMPTY_SETTINGS: PrintLayoutSettings = {
  show_header: true,
  show_discount: true,
  show_signatures: true,
  logo: null,
  primary_color: null,
  company_name: null,
  company_address: null,
  company_phone: null,
  company_email: null,
  header_text: null,
  terms: null,
  bank_details: null,
  footer_text: null,
  layout_style: "standard",
  show_amount_in_words: true,
  show_bank_details: true,
};

const emptyDraft = (): PrintTemplatePayload => ({
  name: "",
  branch_code: null,
  paper_size: null,
  orientation: "portrait",
  settings: { ...EMPTY_SETTINGS },
  custom_html: null,
  is_active: true,
});

const toDraft = (t: PrintTemplateDetail): PrintTemplatePayload => ({
  name: t.name,
  branch_code: t.branch_code,
  paper_size: t.paper_size,
  orientation: t.orientation,
  settings: { ...EMPTY_SETTINGS, ...t.settings },
  custom_html: t.custom_html,
  is_active: t.is_active,
});

/**
 * Settings → Print Templates: how printed documents look (logo, colour, texts,
 * sections, paper), per document type, company-wide or per branch.
 * Figures on a document always come from the backend; templates only lay them out.
 */
export default function PrintTemplatesSettings() {
  const canCreate = usePermission("print_templates", "create");
  const canUpdate = usePermission("print_templates", "update");
  const canDelete = usePermission("print_templates", "delete");
  const canEditHtml = usePermission("print_templates", "edit_html");
  const userBranches = useAuthStore((s) => s.user?.branches ?? []);
  const confirmDialog = useTConfirmDialog();

  const [docTypes, setDocTypes] = useState<PrintDocumentType[]>([]);
  const [docType, setDocType] = useState("");
  const [templates, setTemplates] = useState<PrintTemplateSummary[]>([]);
  const [selected, setSelected] = useState<PrintTemplateDetail | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [draft, setDraft] = useState<PrintTemplatePayload>(emptyDraft());
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [samples, setSamples] = useState<PrintSampleDocument[]>([]);
  const [sampleId, setSampleId] = useState<number | "">("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewWarning, setPreviewWarning] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<PrintTemplateVersion[]>([]);

  const meta = useMemo(() => docTypes.find((d) => d.key === docType), [docTypes, docType]);
  const editing = isNew || selected !== null;
  // The pre-printed stationery layout has a background image instead of a letterhead.
  const stationery = draft.settings.layout_style !== "standard";
  const readOnly = isNew ? !canCreate : !canUpdate;
  const htmlReadOnly = readOnly || !canEditHtml;

  // ── Loading ──────────────────────────────────────────────────────────────
  useEffect(() => {
    settingsApi
      .getPrintDocumentTypes()
      .then((types) => {
        setDocTypes(types);
        if (types.length) setDocType(types[0].key);
      })
      .catch((e) => showErrorToast(handleApiError(e, "Failed to load document types")))
      .finally(() => setLoading(false));
  }, []);

  const loadTemplates = useCallback(async (type: string) => {
    try {
      setTemplates(await settingsApi.getPrintTemplates(type));
    } catch (e) {
      showErrorToast(handleApiError(e, "Failed to load print templates"));
    }
  }, []);

  useEffect(() => {
    if (!docType) return;
    setSelected(null);
    setIsNew(false);
    setPreviewHtml("");
    loadTemplates(docType);
    setSamples([]);
    setSampleId("");
    settingsApi
      .getPrintSampleDocuments(docType)
      .then((docs) => {
        setSamples(docs);
        if (docs.length) setSampleId(docs[0].id);
      })
      .catch(() => setSamples([]));
  }, [docType, loadTemplates]);

  const openTemplate = async (id: number) => {
    try {
      const t = await settingsApi.getPrintTemplate(id);
      setSelected(t);
      setIsNew(false);
      setDraft(toDraft(t));
      setTab(0);
    } catch (e) {
      showErrorToast(handleApiError(e, "Failed to load template"));
    }
  };

  const startNew = () => {
    setSelected(null);
    setIsNew(true);
    setDraft({ ...emptyDraft(), name: `${meta?.label ?? "Document"} layout` });
    setTab(0);
  };

  // ── Preview scale: fit an A4-wide page into the panel ───────────────────
  const previewBoxRef = useRef<HTMLDivElement | null>(null);
  const [previewScale, setPreviewScale] = useState(0.5);
  useEffect(() => {
    const el = previewBoxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setPreviewScale(Math.min(1, Math.max(0.3, (entry.contentRect.width - 8) / PREVIEW_PAGE_WIDTH)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [editing]);

  // ── Live preview (debounced) ─────────────────────────────────────────────
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!editing || !meta || (meta.has_id && sampleId === "")) return;
    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setPreviewLoading(true);
      try {
        const { html, fallbackError } = await settingsApi.previewPrintTemplate(
          { ...draft, document_type: meta.key, document_id: meta.has_id ? Number(sampleId) : null },
          controller.signal,
        );
        setPreviewHtml(html);
        setPreviewError(null);
        setPreviewWarning(fallbackError);
      } catch (e) {
        if (axios.isCancel(e)) return;
        setPreviewError(handleApiError(e, "Preview failed"));
      } finally {
        if (abortRef.current === controller) setPreviewLoading(false);
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [draft, sampleId, meta, editing]);

  // ── Editing helpers ──────────────────────────────────────────────────────
  const setField = <K extends keyof PrintTemplatePayload>(key: K, value: PrintTemplatePayload[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const setSetting = <K extends keyof PrintLayoutSettings>(key: K, value: PrintLayoutSettings[K]) =>
    setDraft((d) => ({ ...d, settings: { ...d.settings, [key]: value } }));
  const textSetting = (key: keyof PrintLayoutSettings) => ({
    value: (draft.settings[key] as string | null) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSetting(key, (e.target.value || null) as never),
    disabled: readOnly,
    fullWidth: true,
    size: "small" as const,
  });

  const onLogoFile = (file?: File) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      showErrorToast("Use a PNG, JPEG or WebP image");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      showErrorToast("The image must be 1 MB or smaller");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setSetting("logo", reader.result as string);
    reader.readAsDataURL(file);
  };

  // ── Actions ──────────────────────────────────────────────────────────────
  // A double-click reaches save twice before `saving` disables the button; the ref stops the second write.
  const savingRef = useRef(false);
  const save = async () => {
    if (savingRef.current) return;
    if (!draft.name.trim()) {
      showErrorToast("Give the template a name");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const payload = { ...draft, custom_html: draft.custom_html?.trim() ? draft.custom_html : null };
      const saved = isNew
        ? await settingsApi.createPrintTemplate({ ...payload, document_type: docType, is_default: templates.length === 0 })
        : await settingsApi.updatePrintTemplate(selected!.id, { ...payload, expected_version: selected!.version });
      setSelected(saved);
      setIsNew(false);
      setDraft(toDraft(saved));
      await loadTemplates(docType);
      showSuccessToast("Template saved");
    } catch (e) {
      showErrorToast(handleApiError(e, "Failed to save template"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const toggleDefault = async () => {
    if (!selected) return;
    try {
      const saved = await settingsApi.setDefaultPrintTemplate(selected.id, !selected.is_default);
      setSelected(saved);
      await loadTemplates(docType);
      showSuccessToast(saved.is_default ? "Now the default layout" : "No longer the default layout");
    } catch (e) {
      showErrorToast(handleApiError(e, "Failed to change the default"));
    }
  };

  const remove = async () => {
    if (!selected) return;
    const ok = await confirmDialog.confirm({
      title: "Delete template",
      message: `Delete "${selected.name}" and its history? Documents will print with the next default layout.`,
      confirmText: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await settingsApi.deletePrintTemplate(selected.id);
      setSelected(null);
      await loadTemplates(docType);
      showSuccessToast("Template deleted");
    } catch (e) {
      showErrorToast(handleApiError(e, "Failed to delete template"));
    }
  };

  const openHistory = async () => {
    if (!selected) return;
    try {
      setVersions(await settingsApi.getPrintTemplateVersions(selected.id));
      setHistoryOpen(true);
    } catch (e) {
      showErrorToast(handleApiError(e, "Failed to load history"));
    }
  };

  const restore = async (version: number) => {
    if (!selected) return;
    try {
      const saved = await settingsApi.restorePrintTemplateVersion(selected.id, version);
      setSelected(saved);
      setDraft(toDraft(saved));
      setHistoryOpen(false);
      await loadTemplates(docType);
      showSuccessToast(`Version ${version} restored as version ${saved.version}`);
    } catch (e) {
      showErrorToast(handleApiError(e, "Failed to restore version"));
    }
  };

  const branchLabel = (code: string | null) =>
    code ? userBranches.find((b) => b.branch_code === code)?.branch_name ?? code : "Company-wide";

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" p={4}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Print Templates
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Choose how printed documents look. A branch's default layout is used for that branch's documents,
        otherwise the company-wide default, otherwise the built-in layout. Amounts and totals always come from the
        system; templates only change how they are shown.
      </Typography>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "280px 380px 1fr" }, gap: 2 }}>
        {/* ── Template list ── */}
        <Paper variant="outlined" sx={{ p: 2, alignSelf: "start" }}>
          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel>Document</InputLabel>
            <Select value={docType} label="Document" onChange={(e) => setDocType(e.target.value)}>
              {docTypes.map((d) => (
                <MenuItem key={d.key} value={d.key}>
                  {d.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <List dense disablePadding>
            {templates.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                No templates yet: documents print with the built-in layout.
              </Typography>
            )}
            {templates.map((t) => (
              <ListItemButton
                key={t.id}
                selected={selected?.id === t.id}
                onClick={() => openTemplate(t.id)}
                sx={{ borderRadius: 1, mb: 0.5 }}
              >
                <ListItemText
                  primary={t.name}
                  secondary={
                    <Stack direction="row" spacing={0.5} component="span" sx={{ mt: 0.5, flexWrap: "wrap" }}>
                      <Chip size="small" label={branchLabel(t.branch_code)} component="span" />
                      {t.is_default && <Chip size="small" color="primary" label="Default" component="span" />}
                      {t.has_custom_html && <Chip size="small" variant="outlined" label="HTML" component="span" />}
                      {!t.is_active && <Chip size="small" color="warning" label="Inactive" component="span" />}
                    </Stack>
                  }
                />
              </ListItemButton>
            ))}
          </List>
          {canCreate && (
            <Button fullWidth startIcon={<AddIcon />} onClick={startNew} sx={{ mt: 1 }} variant="outlined">
              New template
            </Button>
          )}
        </Paper>

        {/* ── Editor ── */}
        <Paper variant="outlined" sx={{ p: 2, alignSelf: "start" }}>
          {!editing ? (
            <Typography variant="body2" color="text.secondary">
              Pick a template or create a new one.
            </Typography>
          ) : (
            <>
              <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" sx={{ mb: 2 }}>
                <Tab label="Layout" />
                <Tab label="Texts" />
                <Tab label="HTML" />
              </Tabs>

              {tab === 0 && (
                <Stack spacing={2}>
                  <TextField
                    label="Template name"
                    size="small"
                    value={draft.name}
                    onChange={(e) => setField("name", e.target.value)}
                    disabled={readOnly}
                    required
                  />
                  <FormControl size="small" disabled={readOnly}>
                    <InputLabel shrink>Applies to</InputLabel>
                    <Select
                      label="Applies to"
                      displayEmpty
                      notched
                      value={draft.branch_code ?? ""}
                      onChange={(e) => setField("branch_code", e.target.value || null)}
                    >
                      <MenuItem value="">Company-wide</MenuItem>
                      {userBranches.map((b) => (
                        <MenuItem key={b.branch_code} value={b.branch_code}>
                          {b.branch_name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Stack direction="row" spacing={1}>
                    <FormControl size="small" fullWidth disabled={readOnly}>
                      <InputLabel shrink>Paper</InputLabel>
                      <Select
                        label="Paper"
                        displayEmpty
                        notched
                        value={draft.paper_size ?? ""}
                        onChange={(e) => setField("paper_size", (e.target.value || null) as PaperSize | null)}
                      >
                        <MenuItem value="">Layout's own size</MenuItem>
                        {PAPER_SIZES.map((p) => (
                          <MenuItem key={p} value={p}>
                            {p === "80mm" ? "80 mm receipt" : p}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl size="small" fullWidth disabled={readOnly || !draft.paper_size || draft.paper_size === "80mm"}>
                      <InputLabel>Orientation</InputLabel>
                      <Select
                        label="Orientation"
                        value={draft.orientation}
                        onChange={(e) => setField("orientation", e.target.value as Orientation)}
                      >
                        <MenuItem value="portrait">Portrait</MenuItem>
                        <MenuItem value="landscape">Landscape</MenuItem>
                      </Select>
                    </FormControl>
                  </Stack>

                  {meta && meta.layouts.length > 1 && (
                    <FormControl size="small" disabled={readOnly}>
                      <InputLabel>Layout</InputLabel>
                      <Select label="Layout" value={draft.settings.layout_style} onChange={(e) => setSetting("layout_style", e.target.value)}>
                        {meta.layouts.map((l) => (
                          <MenuItem key={l.key} value={l.key}>
                            {l.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}

                  <Divider textAlign="left">
                    <Typography variant="caption">Sections</Typography>
                  </Divider>
                  <FormControlLabel
                    control={<Switch checked={draft.settings.show_header} onChange={(e) => setSetting("show_header", e.target.checked)} disabled={readOnly} />}
                    label={stationery ? "Show stationery background" : "Show letterhead (logo, company details)"}
                  />
                  {meta?.supports_discount && (
                    <FormControlLabel
                      control={<Switch checked={draft.settings.show_discount} onChange={(e) => setSetting("show_discount", e.target.checked)} disabled={readOnly} />}
                      label="Show discounts"
                    />
                  )}
                  <FormControlLabel
                    control={<Switch checked={draft.settings.show_signatures} onChange={(e) => setSetting("show_signatures", e.target.checked)} disabled={readOnly} />}
                    label="Show signatures"
                  />
                  {!stationery && (
                    <>
                      <FormControlLabel
                        control={<Switch checked={draft.settings.show_amount_in_words} onChange={(e) => setSetting("show_amount_in_words", e.target.checked)} disabled={readOnly} />}
                        label="Show amount in words"
                      />
                      <FormControlLabel
                        control={<Switch checked={draft.settings.show_bank_details} onChange={(e) => setSetting("show_bank_details", e.target.checked)} disabled={readOnly} />}
                        label="Show bank details when a balance is due"
                      />
                    </>
                  )}
                  <Typography variant="caption" color="text.secondary">
                    These are the defaults; the print-preview switches can still change them for a single print.
                  </Typography>

                  <Divider textAlign="left">
                    <Typography variant="caption">Branding</Typography>
                  </Divider>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Button component="label" variant="outlined" size="small" disabled={readOnly}>
                      {stationery ? "Stationery image" : "Logo"}
                      <input hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => onLogoFile(e.target.files?.[0])} />
                    </Button>
                    {draft.settings.logo && (
                      <>
                        <Box component="img" src={draft.settings.logo} alt="" sx={{ height: 32, maxWidth: 120, objectFit: "contain" }} />
                        <Button size="small" onClick={() => setSetting("logo", null)} disabled={readOnly}>
                          Remove
                        </Button>
                      </>
                    )}
                  </Stack>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <TextField
                      type="color"
                      label="Brand colour"
                      size="small"
                      sx={{ width: 140 }}
                      value={draft.settings.primary_color ?? "#1a4480"}
                      onChange={(e) => setSetting("primary_color", e.target.value)}
                      disabled={readOnly}
                    />
                    {draft.settings.primary_color && (
                      <Button size="small" onClick={() => setSetting("primary_color", null)} disabled={readOnly}>
                        Reset
                      </Button>
                    )}
                  </Stack>
                  <FormControlLabel
                    control={<Switch checked={draft.is_active} onChange={(e) => setField("is_active", e.target.checked)} disabled={readOnly} />}
                    label="Active"
                  />
                </Stack>
              )}

              {tab === 1 && (
                <Stack spacing={2}>
                  <Typography variant="caption" color="text.secondary">
                    Leave a field empty to use the company settings.
                  </Typography>
                  <TextField label="Company name" {...textSetting("company_name")} />
                  <TextField label="Address" {...textSetting("company_address")} multiline minRows={2} />
                  <Stack direction="row" spacing={1}>
                    <TextField label="Phone" {...textSetting("company_phone")} />
                    <TextField label="Email" {...textSetting("company_email")} />
                  </Stack>
                  <TextField label="Header text" {...textSetting("header_text")} multiline minRows={2} />
                  <TextField label="Terms & conditions" {...textSetting("terms")} multiline minRows={4} />
                  <TextField label="Bank details" {...textSetting("bank_details")} multiline minRows={3} />
                  <TextField label="Footer text" {...textSetting("footer_text")} multiline minRows={2} />
                </Stack>
              )}

              {tab === 2 && (
                <Stack spacing={2}>
                  <Alert severity={canEditHtml ? "info" : "warning"}>
                    {canEditHtml
                      ? "Custom HTML replaces the built-in layout. Scripts and external files are blocked. If the template fails to print, the built-in layout is used instead."
                      : "Only users with the 'edit HTML' permission can change custom HTML."}
                  </Alert>
                  {meta && (
                    <Typography variant="caption" color="text.secondary">
                      Must print {"{{ doc.number }}"} and doc.totals (standard data), or{" "}
                      {meta.required_fields.map((f) => `{{ ${f} }}`).join(", ")}. Standard data: {"{{ doc.title }}"}, doc.meta,
                      doc.parties, doc.columns / doc.lines, doc.totals, doc.tax_summary, {"{{ doc.amount_in_words }}"}, company
                      (name, address_lines, tax_registration_number, logo, bank), {"{{ layout.terms }}"}. Filters: money, qty, fmt_date.
                    </Typography>
                  )}
                  <TextField
                    label="Custom HTML (Jinja)"
                    value={draft.custom_html ?? ""}
                    onChange={(e) => setField("custom_html", e.target.value || null)}
                    disabled={htmlReadOnly}
                    multiline
                    minRows={18}
                    fullWidth
                    InputProps={{ sx: { fontFamily: "monospace", fontSize: 12 } }}
                    placeholder="Empty = use the built-in layout"
                  />
                </Stack>
              )}

              <Divider sx={{ my: 2 }} />
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {!readOnly && (
                  <Button variant="contained" onClick={save} disabled={saving}>
                    {saving ? "Saving..." : "Save"}
                  </Button>
                )}
                {selected && canUpdate && (
                  <Button variant="outlined" onClick={toggleDefault} disabled={!selected.is_active}>
                    {selected.is_default ? "Remove default" : "Make default"}
                  </Button>
                )}
                {selected && (
                  <Button startIcon={<HistoryIcon />} onClick={openHistory}>
                    History
                  </Button>
                )}
                {selected && canDelete && (
                  <Button color="error" onClick={remove}>
                    Delete
                  </Button>
                )}
              </Stack>
              {selected && (
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                  Version {selected.version}
                </Typography>
              )}
            </>
          )}
        </Paper>

        {/* ── Preview ── */}
        <Paper variant="outlined" sx={{ p: 2, display: "flex", flexDirection: "column", minHeight: 640 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle2" sx={{ flex: 1 }}>
              Preview {previewLoading && <CircularProgress size={12} sx={{ ml: 1 }} />}
            </Typography>
            {meta?.has_id && (
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel>Sample document</InputLabel>
                <Select label="Sample document" value={sampleId} onChange={(e) => setSampleId(e.target.value as number)}>
                  {samples.map((s) => (
                    <MenuItem key={s.id} value={s.id}>
                      {s.number}
                      {s.branch_code ? ` · ${s.branch_code}` : ""}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Stack>
          {meta?.has_id && samples.length === 0 && (
            <Alert severity="info" sx={{ mb: 1 }}>
              No approved {meta.label.toLowerCase()} is available to preview with yet.
            </Alert>
          )}
          {previewError && <Alert severity="error" sx={{ mb: 1 }}>{previewError}</Alert>}
          {previewWarning && (
            <Alert severity="warning" sx={{ mb: 1 }}>
              The custom HTML failed to render, so the built-in layout is shown: {previewWarning}
            </Alert>
          )}
          <Box ref={previewBoxRef} sx={{ flex: 1, bgcolor: "grey.100", borderRadius: 1, overflow: "auto", minHeight: 600 }}>
            {editing && previewHtml ? (
              // sandbox without allow-same-origin: the page cannot reach this app's storage or session
              // Rendered at A4 width and scaled down to the panel, so the page keeps its real proportions.
              <Box sx={{ width: PREVIEW_PAGE_WIDTH * previewScale, height: PREVIEW_PAGE_HEIGHT * previewScale, mx: "auto" }}>
                <iframe
                  title="Template preview"
                  srcDoc={previewHtml}
                  sandbox="allow-scripts"
                  style={{ width: PREVIEW_PAGE_WIDTH, height: PREVIEW_PAGE_HEIGHT, border: 0, background: "#fff",
                           transform: `scale(${previewScale})`, transformOrigin: "top left" }}
                />
              </Box>
            ) : (
              <Box p={3}>
                <Typography variant="body2" color="text.secondary">
                  {editing ? "Rendering..." : "The preview shows here while you edit a template."}
                </Typography>
              </Box>
            )}
          </Box>
        </Paper>
      </Box>

      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Template history</DialogTitle>
        <DialogContent dividers>
          <List dense>
            {versions.map((v) => (
              <ListItemButton key={v.version} disableRipple sx={{ cursor: "default" }}>
                <ListItemText
                  primary={`Version ${v.version}${v.version === selected?.version ? " (current)" : ""}`}
                  secondary={`${new Date(v.created_at).toLocaleString()}${v.created_by ? ` · user #${v.created_by}` : ""}`}
                />
                {canUpdate && v.version !== selected?.version && (
                  <Button size="small" onClick={() => restore(v.version)}>
                    Restore
                  </Button>
                )}
              </ListItemButton>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHistoryOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <TConfirmDialog {...confirmDialog.dialogProps} />
    </Box>
  );
}
