/**
 * MasterTab — a small, reusable list + create/edit form for HR masters.
 *
 * Two layouts:
 *  - variant="page"  — the ERP's standard full-page browse / detail pattern (like Product
 *    categories / brands): a MasterDetailLayout whose browse mode is a searchable full-width
 *    grid and whose detail mode is DetailPanelHeader + ActionToolbar + FormSections.
 *    Used by HR Setup (departments, designations, employment types, shifts, leave types).
 *  - variant="panel" (default) — an embedded grid whose create / edit form opens in a
 *    TSidePanel. Used where a full page does not fit (e.g. employee sub-records).
 */
import React, { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Box, Button, FormControlLabel, IconButton, InputAdornment, MenuItem, Switch, TextField, Tooltip, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SearchIcon from "@mui/icons-material/Search";
import {
  ActionToolbar, DetailPanelHeader, FormSection, MasterDetailLayout, TConfirmDialog, TDataGrid, type TDataGridColumn, TSidePanel, TStatusFilter,
  handleApiError, showErrorToast, showSuccessToast, useTConfirmDialog,
} from "@/components/tijaero";

export type FieldDef =
  | { name: string; label: string; type: "text" | "multiline" | "time" | "date"; required?: boolean; helper?: string; maxLength?: number; disabledWhenEditing?: boolean; span?: 1 | 2 }
  | { name: string; label: string; type: "number"; required?: boolean; helper?: string; min?: number; max?: number; step?: number; nullable?: boolean; span?: 1 | 2 }
  | { name: string; label: string; type: "select"; options: { value: string | number | null; label: string }[]; required?: boolean; helper?: string; span?: 1 | 2 }
  | { name: string; label: string; type: "switch"; helper?: string; span?: 1 | 2 };

interface Props<T extends { id: number; version?: string | null }> {
  title: string;
  queryKey: unknown[];
  fetcher: () => Promise<T[]>;
  create: (data: Record<string, unknown>) => Promise<T>;
  update: (id: number, data: Record<string, unknown>) => Promise<T>;
  columns: TDataGridColumn<T>[];
  fields: FieldDef[];
  blank: Record<string, unknown>;
  canCreate: boolean;
  canUpdate: boolean;
  noun: string;
  /** extra queries to refresh after a change (e.g. lists used in other dropdowns) */
  invalidate?: unknown[][];
  /** when given, records can be removed (row button in panel mode, toolbar Delete in page mode) */
  remove?: (id: number) => Promise<void>;
  /** panel mode: embed without the title row (e.g. inside an employee tab) */
  compact?: boolean;
  /** extra toolbar content (panel mode: next to Add; page mode: in the header actions) */
  extra?: React.ReactNode;
  /** "page" = full-page browse / detail; "panel" (default) = embedded grid + side-panel form */
  variant?: "page" | "panel";
  /** page mode: title of the surrounding page (e.g. "HR Setup") */
  pageTitle?: string;
  /** page mode: breadcrumbs leading to this master (the master and record are appended) */
  breadcrumbs?: { label: string; href?: string }[];
  /** page mode: icon shown next to the record title */
  icon?: React.ReactNode;
  /** page mode: content rendered above the browse grid (e.g. the page's section tabs) */
  tabsSlot?: React.ReactNode;
  /** page mode: record subtitle (e.g. its code) */
  subtitleOf?: (row: T) => string | undefined;
}

const isEmpty = (v: unknown) => v === "" || v === null || v === undefined || (typeof v === "string" && !v.trim());

export default function MasterTab<T extends { id: number; version?: string | null }>({
  title, queryKey, fetcher, create, update, columns, fields, blank, canCreate, canUpdate, noun, invalidate, remove, compact, extra,
  variant = "panel", pageTitle, breadcrumbs = [], icon, tabsSlot, subtitleOf,
}: Props<T>) {
  const isPage = variant === "page";
  const qc = useQueryClient();
  const { dialogProps, confirm } = useTConfirmDialog();
  const { data = [], isLoading, isFetching, refetch } = useQuery({ queryKey, queryFn: fetcher });

  // ── shared form state ──
  /** the record being edited (null while creating) */
  const [editTarget, setEditTarget] = useState<T | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const savingRef = useRef(false);

  // ── panel mode ──
  const [open, setOpen] = useState(false);

  // ── page mode ──
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [lastSaved, setLastSaved] = useState<T | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const hasActive = fields.some((f) => f.name === "active" && f.type === "switch");
  const current = selectedId === null ? null : data.find((r) => r.id === selectedId) ?? (lastSaved?.id === selectedId ? lastSaved : null);
  const inDetail = creating || selectedId !== null;
  const formOpen = creating || isEditing;

  const rowToForm = (row: T): Record<string, unknown> => {
    const next: Record<string, unknown> = {};
    fields.forEach((f) => {
      const v = (row as unknown as Record<string, unknown>)[f.name];
      next[f.name] = f.type === "time" && typeof v === "string" ? v.slice(0, 5) : v ?? (f.type === "switch" ? false : "");
    });
    return next;
  };

  const refresh = () => {
    qc.invalidateQueries({ queryKey });
    (invalidate ?? []).forEach((k) => qc.invalidateQueries({ queryKey: k }));
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = { ...form };
      fields.forEach((f) => {
        if (f.type === "date") payload[f.name] = String(form[f.name] ?? "") || null;
        if (f.type === "text" || f.type === "multiline") payload[f.name] = String(form[f.name] ?? "").trim() || (f.type === "text" && "required" in f && f.required ? "" : null);
        if (f.type === "number") payload[f.name] = form[f.name] === "" || form[f.name] == null ? (f.nullable ? null : 0) : Number(form[f.name]);
      });
      if (editTarget) payload.expected_version = editTarget.version ?? null;
      return editTarget ? update(editTarget.id, payload) : create(payload);
    },
    onSuccess: (saved) => {
      showSuccessToast(`${noun} ${editTarget ? "updated" : "created"} successfully`);
      refresh();
      if (isPage) {
        setLastSaved(saved);
        setSelectedId(saved.id);
        setCreating(false);
        setIsEditing(false);
        setEditTarget(null);
      } else {
        setOpen(false);
      }
    },
    onError: (e) => showErrorToast(handleApiError(e, `Failed to save ${noun.toLowerCase()}`)),
    onSettled: () => { savingRef.current = false; },
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) => remove!(id),
    onSuccess: () => {
      showSuccessToast(`${noun} removed`);
      refresh();
      if (isPage) { setSelectedId(null); setIsEditing(false); }
      else setOpen(false);
    },
    onError: (e) => showErrorToast(handleApiError(e, `Failed to remove ${noun.toLowerCase()}`)),
  });

  const validate = () => {
    const e: Record<string, string> = {};
    fields.forEach((f) => {
      const v = form[f.name];
      if ("required" in f && f.required && isEmpty(v)) e[f.name] = `${f.label} is required`;
      if (f.type === "number" && v !== "" && v != null) {
        const n = Number(v);
        if (Number.isNaN(n)) e[f.name] = "Enter a number";
        else if (f.min !== undefined && n < f.min) e[f.name] = `Minimum is ${f.min}`;
        else if (f.max !== undefined && n > f.max) e[f.name] = `Maximum is ${f.max}`;
      }
      if ((f.type === "text" || f.type === "multiline") && f.maxLength && String(v ?? "").length > f.maxLength) e[f.name] = `At most ${f.maxLength} characters`;
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = () => {
    if (savingRef.current || saveMutation.isPending) return;
    if (!validate()) return;
    savingRef.current = true;
    saveMutation.mutate();
  };

  const startNew = () => {
    setEditTarget(null);
    setForm({ ...blank });
    setErrors({});
    if (isPage) { setSelectedId(null); setIsEditing(false); setCreating(true); }
    else setOpen(true);
  };
  const startEdit = (row: T) => {
    setEditTarget(row);
    setForm(rowToForm(row));
    setErrors({});
    if (isPage) setIsEditing(true);
    else setOpen(true);
  };

  const confirmRemove = async (row: T) => {
    if (await confirm({ title: `Remove ${noun.toLowerCase()}`, message: `Remove this ${noun.toLowerCase()}?`, confirmText: "Remove", danger: true })) removeMutation.mutate(row.id);
  };

  // ── page-mode navigation ──
  const openRecord = (row: T) => {
    setCreating(false);
    setIsEditing(false);
    setEditTarget(null);
    setErrors({});
    setSelectedId(row.id);
  };
  const discardOk = async () => !formOpen
    || confirm({ title: "Discard changes?", message: "Your unsaved changes will be lost.", confirmText: "Discard", danger: true });
  const backToList = async () => {
    if (saveMutation.isPending || !(await discardOk())) return;
    setCreating(false);
    setIsEditing(false);
    setEditTarget(null);
    setSelectedId(null);
  };
  const cancelForm = () => {
    setErrors({});
    setEditTarget(null);
    if (creating) { setCreating(false); setSelectedId(null); }
    else setIsEditing(false);
  };

  // ── fields ──
  const renderField = (f: FieldDef, values: Record<string, unknown>, readOnly: boolean) => {
    const span = f.span === 2 || f.type === "multiline" ? { gridColumn: { sm: "1 / -1" } } : {};
    const set = (v: unknown) => setForm((prev) => ({ ...prev, [f.name]: v }));
    if (f.type === "switch") {
      return (
        <Box key={f.name} sx={{ ...span, display: "flex", alignItems: "center", flexWrap: "wrap" }}>
          <FormControlLabel
            control={<Switch checked={Boolean(values[f.name])} disabled={readOnly} onChange={(e) => set(e.target.checked)} />}
            label={f.label}
          />
          {f.helper && <Typography variant="caption" color="text.secondary">{f.helper}</Typography>}
        </Box>
      );
    }
    const common = {
      size: "small" as const, label: f.label, fullWidth: true, sx: span, disabled: readOnly,
      required: "required" in f ? f.required : false, error: Boolean(errors[f.name]), helperText: errors[f.name] || ("helper" in f ? f.helper : undefined),
    };
    if (f.type === "select") {
      return (
        <TextField key={f.name} {...common} select value={values[f.name] ?? ""} onChange={(e) => set(e.target.value === "" ? null : e.target.value)}>
          {f.options.map((o) => <MenuItem key={String(o.value)} value={o.value ?? ""}>{o.label}</MenuItem>)}
        </TextField>
      );
    }
    if (f.type === "number") {
      return (
        <TextField key={f.name} {...common} type="number" inputProps={{ min: f.min, max: f.max, step: f.step ?? 1 }} value={values[f.name] ?? ""}
          onChange={(e) => set(e.target.value)} />
      );
    }
    if (f.type === "time" || f.type === "date") {
      return <TextField key={f.name} {...common} type={f.type} InputLabelProps={{ shrink: true }} value={values[f.name] ?? ""} onChange={(e) => set(e.target.value)} />;
    }
    return (
      <TextField key={f.name} {...common} multiline={f.type === "multiline"} minRows={f.type === "multiline" ? 2 : undefined}
        disabled={readOnly || Boolean(editTarget && f.disabledWhenEditing)} inputProps={{ maxLength: f.maxLength }}
        value={values[f.name] ?? ""} onChange={(e) => set(e.target.value)} />
    );
  };

  // ── grid columns ──
  const cols = useMemo<TDataGridColumn<T>[]>(() => {
    if (isPage) {
      return [...columns, {
        field: "__open", header: "", width: 56, sortable: false, align: "center", headerAlign: "center",
        renderCell: (p: { row: T }) => (
          <Tooltip title="Open">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); openRecord(p.row); }}>
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      } as TDataGridColumn<T>];
    }
    return remove && canUpdate ? [...columns, {
      field: "__remove", header: "", width: 64, sortable: false,
      renderCell: (p: { row: T }) => (
        <Tooltip title={`Remove ${noun.toLowerCase()}`}>
          <IconButton size="small" onClick={(e) => { e.stopPropagation(); confirmRemove(p.row); }}>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ),
    } as TDataGridColumn<T>] : columns;
  }, [columns, remove, canUpdate, isPage]); // eslint-disable-line react-hooks/exhaustive-deps

  // ───────────────────────────── panel mode ─────────────────────────────
  if (!isPage) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <TConfirmDialog {...dialogProps} />
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1, gap: 1 }}>
          {compact ? <Box /> : <Typography variant="subtitle1" fontWeight={600}>{title}</Typography>}
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            {extra}
            {canCreate && (
              <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={startNew} sx={{ textTransform: "none" }}>
                Add {noun}
              </Button>
            )}
          </Box>
        </Box>
        <Box sx={{ flex: 1, minHeight: compact ? 220 : 320 }}>
          <TDataGrid<T>
            rows={data}
            columns={cols}
            loading={isLoading}
            onRowClick={(row) => (canUpdate ? startEdit(row) : undefined)}
            emptyMessage={`No ${title.toLowerCase()} yet`}
            pageSizeOptions={[10, 25, 50]}
            pageSize={10}
            autoHeight={false}
            height="100%"
          />
        </Box>

        <TSidePanel
          open={open}
          onClose={() => { if (!saveMutation.isPending) setOpen(false); }}
          title={editTarget ? `Edit ${noun}` : `Add ${noun}`}
          onSubmit={handleSave}
          isSubmitting={saveMutation.isPending}
          submitDisabled={saveMutation.isPending}
          submitText="Save"
          width={560}
        >
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5, pt: 1 }}>
            {fields.map((f) => renderField(f, form, false))}
          </Box>
        </TSidePanel>
      </Box>
    );
  }

  // ───────────────────────────── page mode ─────────────────────────────
  const q = search.trim().toLowerCase();
  const rows = data.filter((r) => {
    const rec = r as unknown as Record<string, unknown>;
    if (hasActive && statusFilter) {
      if ((statusFilter === "active") !== Boolean(rec.active)) return false;
    }
    if (!q) return true;
    return columns.some((c) => {
      const v = rec[String(c.field)];
      return (typeof v === "string" || typeof v === "number") && String(v).toLowerCase().includes(q);
    });
  });

  const browsePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {tabsSlot && <Box sx={{ px: 1.5, pb: 1, flexShrink: 0 }}>{tabsSlot}</Box>}
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<T>
          rows={rows}
          columns={cols}
          loading={isLoading}
          onRowClick={openRecord}
          emptyMessage={q || statusFilter ? `No ${title.toLowerCase()} match the filters` : `No ${title.toLowerCase()} yet`}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  const values = formOpen ? form : current ? rowToForm(current) : blank;
  const readOnly = !formOpen;
  const mainFields = fields.filter((f) => f.type !== "switch");
  const switchFields = fields.filter((f) => f.type === "switch");
  const currentRec = current as unknown as Record<string, unknown> | null;
  const recordTitle = currentRec ? String(currentRec.name ?? currentRec.code ?? `${noun} #${current!.id}`) : "";

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[...breadcrumbs, { label: title }, { label: creating ? `New ${noun}` : recordTitle || "…" }]}
        title={creating ? "" : recordTitle}
        subtitle={current && !creating ? subtitleOf?.(current) : undefined}
        titleIcon={icon}
        isCreating={creating}
        createTitle={`New ${noun}`}
        noSelectionTitle={isLoading ? `Loading ${noun.toLowerCase()}…` : `${noun} not found`}
        chips={hasActive && current && !creating
          ? [{ label: currentRec?.active ? "Active" : "Inactive", color: currentRec?.active ? "success" : "default" }]
          : undefined}
      />
      <ActionToolbar
        canCreate={canCreate}
        canUpdate={canUpdate}
        canDelete={Boolean(remove) && canUpdate}
        canDuplicate={false}
        hasSelectedItem={!!current && !creating}
        isCreating={creating}
        isEditing={isEditing && !creating}
        isSaving={saveMutation.isPending || removeMutation.isPending}
        onNew={canCreate ? startNew : undefined}
        onEdit={current && canUpdate ? () => startEdit(current) : undefined}
        onSave={handleSave}
        onCancel={cancelForm}
        onDelete={remove && current && canUpdate ? () => confirmRemove(current) : undefined}
      />
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!creating && !current ? (
          isLoading ? null : <Alert severity="info">This {noun.toLowerCase()} could not be found. Go back to the list.</Alert>
        ) : (
          <>
            {hasActive && current && !creating && !currentRec?.active && !isEditing && (
              <Alert severity="warning" sx={{ mb: 1.5 }}>This {noun.toLowerCase()} is inactive. Edit to reactivate.</Alert>
            )}
            {mainFields.length > 0 && (
              <FormSection title={`${noun} Information`} isLast={switchFields.length === 0}>
                {mainFields.map((f) => renderField(f, values, readOnly))}
              </FormSection>
            )}
            {switchFields.length > 0 && (
              <FormSection title="Options" isLast>
                {switchFields.map((f) => renderField(f, values, readOnly))}
              </FormSection>
            )}
          </>
        )}
      </Box>
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title={pageTitle ?? title}
        titleSlot={inDetail ? (
          <Button size="small" startIcon={<ArrowBackIcon fontSize="small" />} onClick={backToList} sx={{ textTransform: "none" }}>
            Back to {title}
          </Button>
        ) : (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <TextField size="small" placeholder={`Search ${title.toLowerCase()}...`} value={search} onChange={(e) => setSearch(e.target.value)}
              sx={{ width: 190, flexShrink: 0, "& .MuiOutlinedInput-root": { borderRadius: "24px" } }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" color="action" /></InputAdornment> }} />
            {hasActive && (
              <Box sx={{ width: 150, flexShrink: 0 }}>
                <TStatusFilter
                  options={[{ value: null, label: "All Status" }, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]}
                  value={statusFilter} onChange={setStatusFilter} label="" placeholder="All Status" size="small" />
              </Box>
            )}
            {(search || statusFilter) && (
              <Button size="small" sx={{ textTransform: "none" }} onClick={() => { setSearch(""); setStatusFilter(null); }}>Clear</Button>
            )}
          </Box>
        )}
        headerActions={inDetail ? undefined : (
          <>
            {extra}
            {canCreate && (
              <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={startNew} sx={{ mr: 1 }}>Add {noun}</Button>
            )}
          </>
        )}
        onRefresh={() => refetch()}
        isLoading={isFetching && !isLoading}
      >
        {inDetail ? detailPanel : browsePanel}
      </MasterDetailLayout>
      <TConfirmDialog {...dialogProps} />
    </>
  );
}
