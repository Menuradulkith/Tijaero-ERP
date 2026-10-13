/**
 * MasterTab — a small, reusable list + create/edit dialog for HR setup masters
 * (departments, designations, employment types, shifts, leave types ...).
 */
import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, Switch, TextField, Tooltip, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { TDataGrid, type TDataGridColumn, handleApiError, showErrorToast, showSuccessToast, TConfirmDialog, useTConfirmDialog } from "@/components/tijaero";

import CancelIcon from "@mui/icons-material/Cancel";
import SaveIcon from "@mui/icons-material/Save";
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
  /** when given, rows get a delete button */
  remove?: (id: number) => Promise<void>;
  /** embed without the title row (e.g. inside an employee tab) */
  compact?: boolean;
  /** extra toolbar content */
  extra?: React.ReactNode;
}

export default function MasterTab<T extends { id: number; version?: string | null }>({
  title, queryKey, fetcher, create, update, columns, fields, blank, canCreate, canUpdate, noun, invalidate, remove, compact, extra,
}: Props<T>) {
  const qc = useQueryClient();
  const { dialogProps, confirm } = useTConfirmDialog();
  const { data = [], isLoading } = useQuery({ queryKey, queryFn: fetcher });
  const [editing, setEditing] = useState<T | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const finish = () => {
    qc.invalidateQueries({ queryKey });
    (invalidate ?? []).forEach((k) => qc.invalidateQueries({ queryKey: k }));
    setOpen(false);
  };
  const saveMutation = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = { ...form };
      fields.forEach((f) => {
        if (f.type === "date") payload[f.name] = String(form[f.name] ?? "") || null;
        if (f.type === "text" || f.type === "multiline") payload[f.name] = String(form[f.name] ?? "").trim() || (f.type === "text" && "required" in f && f.required ? "" : null);
        if (f.type === "number") payload[f.name] = form[f.name] === "" || form[f.name] == null ? (f.nullable ? null : 0) : Number(form[f.name]);
      });
      if (editing) payload.expected_version = editing.version ?? null;
      return editing ? update(editing.id, payload) : create(payload);
    },
    onSuccess: () => {
      showSuccessToast(`${noun} ${editing ? "updated" : "created"} successfully`);
      finish();
    },
    onError: (e) => showErrorToast(handleApiError(e, `Failed to save ${noun.toLowerCase()}`)),
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) => remove!(id),
    onSuccess: () => { showSuccessToast(`${noun} removed`); finish(); },
    onError: (e) => showErrorToast(handleApiError(e, `Failed to remove ${noun.toLowerCase()}`)),
  });

  const openNew = () => {
    setEditing(null);
    setForm({ ...blank });
    setErrors({});
    setOpen(true);
  };
  const openEdit = (row: T) => {
    setEditing(row);
    const next: Record<string, unknown> = {};
    fields.forEach((f) => {
      const v = (row as unknown as Record<string, unknown>)[f.name];
      next[f.name] = f.type === "time" && typeof v === "string" ? v.slice(0, 5) : v ?? (f.type === "switch" ? false : "");
    });
    setForm(next);
    setErrors({});
    setOpen(true);
  };

  const validate = () => {
    const e: Record<string, string> = {};
    fields.forEach((f) => {
      const v = form[f.name];
      if ("required" in f && f.required && (v === "" || v === null || v === undefined || (typeof v === "string" && !v.trim()))) e[f.name] = `${f.label} is required`;
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

  const cols = useMemo<TDataGridColumn<T>[]>(() => (remove && canUpdate ? [...columns, {
    field: "__remove", header: "", width: 64, sortable: false,
    renderCell: (p: { row: T }) => (
      <Tooltip title={`Remove ${noun.toLowerCase()}`}>
        <IconButton size="small" onClick={async (e) => { e.stopPropagation(); if (await confirm({ title: `Remove ${noun.toLowerCase()}`, message: `Remove this ${noun.toLowerCase()}?`, confirmText: "Remove", danger: true })) removeMutation.mutate(p.row.id); }}>
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    ),
  } as TDataGridColumn<T>] : columns), // eslint-disable-line react-hooks/exhaustive-deps
  [columns, remove, canUpdate]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <TConfirmDialog {...dialogProps} />
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1, gap: 1 }}>
        {compact ? <Box /> : <Typography variant="subtitle1" fontWeight={600}>{title}</Typography>}
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
        {extra}
        {canCreate && (
          <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={openNew} sx={{ textTransform: "none" }}>
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
          onRowClick={(row) => (canUpdate ? openEdit(row) : undefined)}
          emptyMessage={`No ${title.toLowerCase()} yet`}
          pageSizeOptions={[10, 25, 50]}
          pageSize={10}
          autoHeight={false}
          height="100%"
        />
      </Box>

      <Dialog open={open} onClose={() => !saveMutation.isPending && setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? `Edit ${noun}` : `New ${noun}`}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5, pt: 1 }}>
            {fields.map((f) => {
              const span = f.span === 2 || f.type === "multiline" ? { gridColumn: { sm: "1 / span 2" } } : {};
              if (f.type === "switch") {
                return (
                  <Box key={f.name} sx={{ ...span, display: "flex", alignItems: "center" }}>
                    <FormControlLabel
                      control={<Switch checked={Boolean(form[f.name])} onChange={(e) => setForm({ ...form, [f.name]: e.target.checked })} />}
                      label={f.label}
                    />
                    {f.helper && <Typography variant="caption" color="text.secondary">{f.helper}</Typography>}
                  </Box>
                );
              }
              const common = {
                size: "small" as const, label: f.label, fullWidth: true, sx: span,
                required: "required" in f ? f.required : false, error: Boolean(errors[f.name]), helperText: errors[f.name] || ("helper" in f ? f.helper : undefined),
              };
              if (f.type === "select") {
                return (
                  <TextField key={f.name} {...common} select value={form[f.name] ?? ""} onChange={(e) => setForm({ ...form, [f.name]: e.target.value === "" ? null : e.target.value })}>
                    {f.options.map((o) => <MenuItem key={String(o.value)} value={o.value ?? ""}>{o.label}</MenuItem>)}
                  </TextField>
                );
              }
              if (f.type === "number") {
                return (
                  <TextField key={f.name} {...common} type="number" inputProps={{ min: f.min, max: f.max, step: f.step ?? 1 }} value={form[f.name] ?? ""}
                    onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} />
                );
              }
              if (f.type === "time" || f.type === "date") {
                return <TextField key={f.name} {...common} type={f.type} InputLabelProps={{ shrink: true }} value={form[f.name] ?? ""} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} />;
              }
              return (
                <TextField key={f.name} {...common} multiline={f.type === "multiline"} minRows={f.type === "multiline" ? 2 : undefined}
                  disabled={Boolean(editing && f.disabledWhenEditing)} inputProps={{ maxLength: f.maxLength }}
                  value={form[f.name] ?? ""} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} />
              );
            })}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" color="error" startIcon={<CancelIcon />} onClick={() => setOpen(false)} disabled={saveMutation.isPending}>Cancel</Button>
          <Button variant="contained" color="success" startIcon={<SaveIcon />} disabled={saveMutation.isPending} onClick={() => validate() && saveMutation.mutate()}>
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
