/**
 * EmployeesPage — the employee master.
 * List: server-paged, searchable, filter by department / branch / status / type.
 * Record: Personal, Job, Bank & Statutory, Family, Qualifications, Documents, Checklist, Leave.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  Alert, Avatar, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, InputAdornment,
  LinearProgress, MenuItem, Paper, Switch, Tab, Tabs, TextField, Tooltip, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SearchIcon from "@mui/icons-material/Search";
import DownloadIcon from "@mui/icons-material/Download";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import type { GridPaginationModel } from "@mui/x-data-grid";

import {
  MasterDetailLayout, TDataGrid, type TDataGridColumn, handleApiError, showErrorToast, showSuccessToast, TConfirmDialog, useTConfirmDialog,
} from "@/components/tijaero";
import { FormSection, TBranchFilter, TStatusChip, TStatusFilter } from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";
import { useDebounce } from "@/hooks";
import { fetchAllPages } from "@/utils/fetchAllPages";
import { branchApi } from "@/modules/branches/api";
import { usersApi } from "@/modules/users/api";
import MasterTab, { type FieldDef } from "@/modules/hr/components/MasterTab";
import {
  employeeCoreApi, hrOrgApi, leaveAllocationApi, type Dependent, type Education, type EmergencyContact, type EmployeeDetail, type EmployeeDocument,
  type EmployeeListItem, type EmployeeProfile, type EmployeeStatus, type Experience, type OnboardingTask, type SeparationInput,
} from "@/modules/hr/core-api";

import CancelIcon from "@mui/icons-material/Cancel";
import SaveIcon from "@mui/icons-material/Save";
const STATUS_META: Record<EmployeeStatus, { label: string; color: "success" | "info" | "warning" | "error" | "default" }> = {
  active: { label: "Active", color: "success" },
  probation: { label: "Probation", color: "info" },
  notice_period: { label: "Notice period", color: "warning" },
  resigned: { label: "Resigned", color: "default" },
  terminated: { label: "Terminated", color: "error" },
  retired: { label: "Retired", color: "default" },
  inactive: { label: "Inactive", color: "default" },
};
const StatusChip = ({ status }: { status: string }) => <TStatusChip status={status} statusMap="employeeLifecycle" size="small" />;

const SECTIONS = ["personal", "job", "bank", "family", "qualifications", "documents", "checklist", "leave"] as const;
type Section = (typeof SECTIONS)[number];
const SECTION_LABEL: Record<Section, string> = {
  personal: "Personal", job: "Job", bank: "Bank & Statutory", family: "Family", qualifications: "Qualifications",
  documents: "Documents", checklist: "Checklist", leave: "Leave",
};

const BLANK: Partial<EmployeeProfile> = {};
type FormState = Record<string, string | number | null>;

const PROFILE_KEYS: (keyof EmployeeProfile)[] = [
  "name_with_initials", "nic", "passport_no", "marital_status", "nationality", "religion", "blood_group", "date_of_birth", "gender",
  "personal_email", "mobile_phone", "home_phone", "address_line1", "address_line2", "city", "district", "postal_code", "permanent_address",
  "department_id", "designation_id", "employment_type_id", "branch_code", "reports_to_id", "grade", "work_location", "shift_id", "holiday_list_id",
  "date_of_joining", "probation_end_date", "confirmation_date", "contract_end_date", "notice_period_days", "retirement_date",
  "bank_name", "bank_branch", "bank_account_no", "bank_account_name", "epf_no", "etf_no", "tin_no",
];
const NUMERIC_KEYS = new Set(["department_id", "designation_id", "employment_type_id", "reports_to_id", "shift_id", "holiday_list_id", "notice_period_days"]);

const toForm = (d?: Partial<EmployeeProfile> | null): FormState => {
  const out: FormState = {};
  PROFILE_KEYS.forEach((k) => { out[k] = (d?.[k] as string | number | null | undefined) ?? ""; });
  return out;
};
const normalise = (k: string, v: string | number | null) => {
  if (v === "" || v === null || v === undefined) return null;
  return NUMERIC_KEYS.has(k) ? Number(v) : typeof v === "string" ? v.trim() : v;
};

const fmtDate = (d?: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");

export default function EmployeesPage() {
  const { dialogProps, confirm } = useTConfirmDialog();
  const qc = useQueryClient();
  const canCreate = usePermission("employees", "create");
  const canUpdate = usePermission("employees", "update");
  const canSensitiveView = usePermission("employee_sensitive", "view");
  const canSensitiveEdit = usePermission("employee_sensitive", "update");

  // ── list state ──
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search, 300);
  const [department, setDepartment] = useState<number | "">("");
  const [branch, setBranch] = useState("");
  const [status, setStatus] = useState("live");
  const [paging, setPaging] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [sort, setSort] = useState<{ field: string; sort: "asc" | "desc" } | null>(null);
  useEffect(() => { setPaging((m) => (m.page === 0 ? m : { ...m, page: 0 })); }, [debounced, department, branch, status, sort]);

  // ── record state ──
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [section, setSection] = useState<Section>("personal");
  const [form, setForm] = useState<FormState>(toForm(BLANK));
  const [newUserId, setNewUserId] = useState<number | "">("");
  const [newEmployeeId, setNewEmployeeId] = useState("");
  const [separateOpen, setSeparateOpen] = useState(false);

  // ── reference data ──
  const { data: departments = [] } = useQuery({ queryKey: ["hr", "departments"], queryFn: () => hrOrgApi.departments.list() });
  const { data: designations = [] } = useQuery({ queryKey: ["hr", "designations"], queryFn: () => hrOrgApi.designations.list() });
  const { data: types = [] } = useQuery({ queryKey: ["hr", "employment-types"], queryFn: () => hrOrgApi.employmentTypes.list() });
  const { data: shifts = [] } = useQuery({ queryKey: ["hr", "shifts"], queryFn: () => hrOrgApi.shifts.list() });
  const { data: holidayLists = [] } = useQuery({ queryKey: ["hr", "holiday-lists"], queryFn: () => hrOrgApi.holidayLists.list() });
  const { data: branches } = useQuery({ queryKey: ["branches", "active"], queryFn: () => branchApi.getAll(1, 1000, true) });
  const branchList = (branches as { items?: { branch_code: string; branch_name: string }[] } | undefined)?.items ?? [];
  const { data: managers } = useQuery({ queryKey: ["hr", "employee-options"], queryFn: () => employeeCoreApi.paged({ size: 200, status: "live", sort_by: "name" }) });

  const pageParams = (page: number, size: number) => ({
    q: debounced.trim() || undefined, department_id: department || undefined, branch_code: branch || undefined, status: status || undefined,
    sort_by: sort ? ({ full_name: "name", employee_id: "employee_id", status: "status", date_of_joining: "date_of_joining", department_name: "department" } as Record<string, string>)[sort.field] : undefined,
    order: sort?.sort, page: page + 1, size,
  });
  const { data: list, isFetching, refetch } = useQuery({
    queryKey: ["hr", "employees", "paged", paging.page, paging.pageSize, debounced.trim(), department, branch, status, sort?.field, sort?.sort],
    queryFn: () => employeeCoreApi.paged(pageParams(paging.page, paging.pageSize)),
    placeholderData: keepPreviousData,
  });

  const { data: detail, isFetching: loadingDetail } = useQuery({
    queryKey: ["hr", "employee", selectedId],
    queryFn: () => employeeCoreApi.get(selectedId!),
    enabled: selectedId !== null,
  });
  useEffect(() => { if (detail && !editing) setForm(toForm(detail)); }, [detail, editing]);

  // users that can still be linked (the users page creates an employee record automatically, so this is rare)
  const { data: allUsers = [] } = useQuery({ queryKey: ["hr", "users-light"], queryFn: () => usersApi.getUsers(1, 5000), enabled: creating });
  const { data: linked } = useQuery({ queryKey: ["hr", "employees", "linked"], queryFn: () => fetchAllPages((p) => employeeCoreApi.paged({ page: p + 1, size: 200 })), enabled: creating });
  const linkedUserIds = useMemo(() => new Set((linked ?? []).map((e) => e.user_id)), [linked]);
  const availableUsers = useMemo(() => allUsers.filter((u) => !linkedUserIds.has(u.id)), [allUsers, linkedUserIds]);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["hr", "employees"] });
    qc.invalidateQueries({ queryKey: ["hr", "employee"] });
    qc.invalidateQueries({ queryKey: ["hr", "departments"] });
  };

  // ── mutations ──
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (creating) {
        const body: Record<string, unknown> = { user_id: Number(newUserId), employee_id: newEmployeeId.trim() };
        PROFILE_KEYS.forEach((k) => { const v = normalise(k, form[k]); if (v !== null) body[k] = v; });
        return employeeCoreApi.create(body as never);
      }
      const body: Record<string, unknown> = { expected_version: detail?.version ?? null };
      PROFILE_KEYS.forEach((k) => {
        const before = (detail as unknown as Record<string, unknown> | undefined)?.[k] ?? null;
        const after = normalise(k, form[k]);
        if ((before ?? null) !== after && !(detail?.sensitive_hidden && ["nic", "passport_no", "bank_name", "bank_branch", "bank_account_no", "bank_account_name", "epf_no", "etf_no", "tin_no"].includes(k))) body[k] = after;
      });
      return employeeCoreApi.update(selectedId!, body);
    },
    onSuccess: (saved) => {
      showSuccessToast(creating ? "Employee created successfully" : "Employee updated successfully");
      setCreating(false);
      setEditing(false);
      setSelectedId(saved.id);
      qc.setQueryData(["hr", "employee", saved.id], saved);
      refreshAll();
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to save the employee")),
  });
  const confirmMutation = useMutation({
    mutationFn: () => employeeCoreApi.confirm(selectedId!),
    onSuccess: () => { showSuccessToast("Employee confirmed"); refreshAll(); },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to confirm the employee")),
  });
  const reinstateMutation = useMutation({
    mutationFn: () => employeeCoreApi.reinstate(selectedId!),
    onSuccess: () => { showSuccessToast("Employee reinstated"); refreshAll(); },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to reinstate the employee")),
  });

  const openRecord = useCallback((row: EmployeeListItem) => { setSelectedId(row.id); setCreating(false); setEditing(false); setSection("personal"); }, []);
  const startCreate = () => { setCreating(true); setEditing(true); setSelectedId(null); setForm(toForm(BLANK)); setNewUserId(""); setNewEmployeeId(""); setSection("personal"); };
  const backToList = async () => {
    if ((creating || editing) && !(await confirm({ title: "Discard changes", message: "Discard your changes?", confirmText: "Discard", danger: true }))) return;
    setSelectedId(null); setCreating(false); setEditing(false);
  };
  const cancelEdit = () => { if (creating) { backToList(); return; } setEditing(false); setForm(toForm(detail)); };

  const set = (k: string, v: string | number | null) => setForm((f) => ({ ...f, [k]: v }));
  const readOnly = !(editing || creating);
  const left = !!detail && ["resigned", "terminated", "retired"].includes(detail.status);

  // ── field helpers ──
  const text = (k: keyof EmployeeProfile, label: string, opts: { type?: string; required?: boolean; helper?: string; max?: number; select?: { value: string | number; label: string }[]; span?: boolean; multiline?: boolean } = {}) => (
    <TextField
      key={k} size="small" fullWidth label={label} required={opts.required} disabled={readOnly || (left && !creating)}
      type={opts.select ? undefined : opts.type} select={Boolean(opts.select)} multiline={opts.multiline} minRows={opts.multiline ? 2 : undefined}
      InputLabelProps={opts.type === "date" ? { shrink: true } : undefined} helperText={opts.helper} inputProps={{ maxLength: opts.max }}
      sx={opts.span ? { gridColumn: { sm: "1 / -1" } } : undefined}
      value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)}
    >
      {opts.select && [<MenuItem key="__none" value=""><em>— Not set —</em></MenuItem>, ...opts.select.map((o) => <MenuItem key={String(o.value)} value={o.value}>{o.label}</MenuItem>)]}
    </TextField>
  );
  const deptDesignations = designations.filter((d) => d.active && (!form.department_id || !d.department_id || d.department_id === Number(form.department_id)));

  // ── columns ──
  const columns = useMemo<TDataGridColumn<EmployeeListItem>[]>(() => [
    { field: "employee_id", header: "Employee ID", width: 130 },
    {
      field: "full_name", header: "Name", flex: 1, minWidth: 200,
      renderCell: (p) => (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Avatar sx={{ width: 26, height: 26, fontSize: 12 }}>{(p.row.full_name ?? "?").slice(0, 1)}</Avatar>
          <Box sx={{ lineHeight: 1.1 }}><Typography variant="body2">{p.row.full_name}</Typography><Typography variant="caption" color="text.secondary">{p.row.email ?? p.row.username}</Typography></Box>
        </Box>
      ),
    },
    { field: "department_name", header: "Department", width: 160 },
    { field: "designation_name", header: "Designation", width: 170 },
    { field: "employment_type_name", header: "Type", width: 120 },
    { field: "branch_code", header: "Branch", width: 100 },
    { field: "date_of_joining", header: "Joined", width: 120, renderCell: (p) => fmtDate(p.row.date_of_joining) },
    { field: "status", header: "Status", width: 130, renderCell: (p) => <StatusChip status={p.row.status} /> },
  ], []);

  const listPanel = (
    <Box sx={{ flex: 1, display: "flex", overflow: "hidden", p: 0 }}>
      <TDataGrid<EmployeeListItem>
        rows={list?.items ?? []}
        columns={columns}
        loading={isFetching}
        onRowClick={openRecord}
        pageSizeOptions={[10, 25, 50, 100]}
        emptyMessage="No employees match these filters"
        autoHeight={false}
        height="100%"
        exportFileName="employees"
        serverPagination={{ rowCount: list?.total ?? 0, paginationModel: paging, onPaginationModelChange: setPaging }}
        onServerSortChange={setSort}
        exportAllRows={() => fetchAllPages((p) => employeeCoreApi.paged({ ...pageParams(0, 200), page: p + 1, size: 200 }))}
      />
    </Box>
  );

  // ── record header / actions ──
  const header = (
    <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5, display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
      <Avatar sx={{ width: 52, height: 52 }}>{(detail?.full_name ?? (creating ? "+" : "?")).slice(0, 1)}</Avatar>
      <Box sx={{ minWidth: 220 }}>
        <Typography variant="h6" sx={{ lineHeight: 1.2 }}>{creating ? "New employee" : detail?.full_name ?? "…"}</Typography>
        <Typography variant="body2" color="text.secondary">
          {creating ? "Link a system user to an HR record" : `${detail?.employee_id ?? ""} · ${detail?.designation_name ?? "No designation"} · ${detail?.department_name ?? "No department"}`}
        </Typography>
      </Box>
      {detail && !creating && <StatusChip status={detail.status} />}
      {detail && !creating && detail.service_years != null && <Chip size="small" variant="outlined" label={`${detail.service_years} yr service`} />}
      <Box sx={{ flex: 1 }} />
      {!creating && detail && canUpdate && !editing && (
        <>
          {detail.status === "probation" && <Button size="small" variant="outlined" sx={{ textTransform: "none" }} disabled={confirmMutation.isPending} onClick={() => confirmMutation.mutate()}>Confirm employment</Button>}
          {left || detail.status === "inactive" || detail.status === "notice_period"
            ? <Button size="small" variant="outlined" sx={{ textTransform: "none" }} disabled={reinstateMutation.isPending} onClick={async () => { if (await confirm({ title: "Reinstate employee", message: "Reinstate this employee?", confirmText: "Reinstate" })) reinstateMutation.mutate(); }}>Reinstate</Button>
            : <Button size="small" color="warning" variant="outlined" sx={{ textTransform: "none" }} onClick={() => setSeparateOpen(true)}>Resign / Terminate</Button>}
          {!left && <Button size="small" variant="contained" sx={{ textTransform: "none" }} onClick={() => setEditing(true)}>Edit</Button>}
        </>
      )}
      {(editing || creating) && (
        <>
          <Button variant="contained" color="error" startIcon={<CancelIcon />} size="small" sx={{ textTransform: "none" }} onClick={cancelEdit} disabled={saveMutation.isPending}>Cancel</Button>
          <Button variant="contained" color="success" startIcon={<SaveIcon />} size="small" sx={{ textTransform: "none" }} disabled={saveMutation.isPending || (creating && (!newUserId || !newEmployeeId.trim()))} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </>
      )}
    </Paper>
  );

  const identity = creating && (
    <FormSection title="Link a user" columns={2}>
      <TextField size="small" select required label="System user" value={newUserId} onChange={(e) => {
        const id = Number(e.target.value); setNewUserId(id);
        const u = allUsers.find((x) => x.id === id); if (u && !newEmployeeId) setNewEmployeeId(u.employee_id ?? "");
      }} helperText={availableUsers.length === 0 ? "Every user already has an HR record" : undefined}>
        {availableUsers.map((u) => <MenuItem key={u.id} value={u.id}>{u.first_name} {u.last_name} ({u.username})</MenuItem>)}
      </TextField>
      <TextField size="small" required label="Employee ID" value={newEmployeeId} inputProps={{ maxLength: 50 }} onChange={(e) => setNewEmployeeId(e.target.value)} helperText="Letters, numbers, - _ / ." />
    </FormSection>
  );

  const personal = (
    <>
      {identity}
      <FormSection title="Personal details" columns={3}>
        {text("name_with_initials", "Name with initials", { max: 200 })}
        {text("date_of_birth", "Date of birth", { type: "date" })}
        {text("gender", "Gender", { select: [{ value: "male", label: "Male" }, { value: "female", label: "Female" }, { value: "other", label: "Other" }] })}
        {text("marital_status", "Marital status", { select: ["single", "married", "divorced", "widowed"].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) })}
        {text("nationality", "Nationality", { max: 60 })}
        {text("religion", "Religion", { max: 60 })}
        {text("blood_group", "Blood group", { select: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((v) => ({ value: v, label: v })) })}
        {!detail?.sensitive_hidden && text("nic", "NIC", { max: 20, helper: "9 digits + V, or 12 digits" })}
        {!detail?.sensitive_hidden && text("passport_no", "Passport no.", { max: 30 })}
      </FormSection>
      <FormSection title="Contact" columns={3}>
        {text("personal_email", "Personal email", { max: 255 })}
        {text("mobile_phone", "Mobile", { max: 30, helper: "e.g. +94 77 123 4567" })}
        {text("home_phone", "Home phone", { max: 30 })}
        {text("address_line1", "Address line 1", { max: 200 })}
        {text("address_line2", "Address line 2", { max: 200 })}
        {text("city", "City", { max: 100 })}
        {text("district", "District", { max: 100 })}
        {text("postal_code", "Postal code", { max: 20 })}
        {text("permanent_address", "Permanent address (if different)", { max: 500, span: true, multiline: true })}
      </FormSection>
      {detail && !creating && (
        <FormSection title="Account" columns={3} isLast>
          <Typography variant="body2"><b>Username:</b> {detail.username}</Typography>
          <Typography variant="body2"><b>Login email:</b> {detail.email ?? "—"}</Typography>
          <Typography variant="body2"><b>Phone:</b> {detail.phone ?? "—"}</Typography>
        </FormSection>
      )}
    </>
  );

  const job = (
    <>
      <FormSection title="Position" columns={3}>
        {text("department_id", "Department", { select: departments.filter((d) => d.active || d.id === detail?.department_id).map((d) => ({ value: d.id, label: d.name })) })}
        {text("designation_id", "Designation", { select: deptDesignations.map((d) => ({ value: d.id, label: d.name })) })}
        {text("employment_type_id", "Employment type", { select: types.filter((t) => t.active || t.id === detail?.employment_type_id).map((t) => ({ value: t.id, label: t.name })) })}
        {text("branch_code", "Branch", { select: branchList.map((b) => ({ value: b.branch_code, label: `${b.branch_code} — ${b.branch_name}` })) })}
        {text("reports_to_id", "Reports to", { select: (managers?.items ?? []).filter((m) => m.id !== detail?.id).map((m) => ({ value: m.id, label: `${m.full_name ?? m.employee_id} (${m.employee_id})` })) })}
        {text("grade", "Grade", { max: 30 })}
        {text("work_location", "Work location", { max: 150 })}
        {text("shift_id", "Shift", { select: shifts.filter((s) => s.active).map((s) => ({ value: s.id, label: `${s.name}${s.is_default ? " (default)" : ""}` })) })}
        {text("holiday_list_id", "Holiday calendar", { select: holidayLists.filter((h) => h.active).map((h) => ({ value: h.id, label: `${h.name} (${h.year})` })) })}
      </FormSection>
      <FormSection title="Employment dates" columns={3}>
        {text("date_of_joining", "Date of joining", { type: "date" })}
        {text("probation_end_date", "Probation ends", { type: "date" })}
        {text("confirmation_date", "Confirmation date", { type: "date" })}
        {text("contract_end_date", "Contract ends", { type: "date" })}
        {text("notice_period_days", "Notice period (days)", { type: "number" })}
        {text("retirement_date", "Retirement date", { type: "date", helper: "Defaults to age 60" })}
      </FormSection>
      {detail && ["resigned", "terminated", "retired", "inactive", "notice_period"].includes(detail.status) && (
        <FormSection title="Separation" columns={3} isLast>
          <Typography variant="body2"><b>Type:</b> {(detail.exit_type ?? "—").replace("_", " ")}</Typography>
          <Typography variant="body2"><b>Resigned on:</b> {fmtDate(detail.resignation_date)}</Typography>
          <Typography variant="body2"><b>Last working day:</b> {fmtDate(detail.last_working_date)}</Typography>
          <Typography variant="body2" sx={{ gridColumn: { sm: "1 / -1" } }}><b>Reason:</b> {detail.exit_reason ?? "—"}</Typography>
        </FormSection>
      )}
    </>
  );

  const bank = detail?.sensitive_hidden && !creating ? (
    <Alert severity="info">Bank, statutory and ID details are only visible to HR users with the sensitive-data permission.</Alert>
  ) : (
    <>
      <FormSection title="Bank account (salary payment)" columns={2}>
        {text("bank_name", "Bank", { max: 100 })}
        {text("bank_branch", "Branch", { max: 100 })}
        {text("bank_account_no", "Account number", { max: 40, helper: "Letters, numbers and - only" })}
        {text("bank_account_name", "Account holder name", { max: 150 })}
      </FormSection>
      <FormSection title="Statutory" columns={3} isLast>
        {text("epf_no", "EPF number", { max: 30 })}
        {text("etf_no", "ETF number", { max: 30 })}
        {text("tin_no", "TIN", { max: 30 })}
      </FormSection>
    </>
  );

  const needsRecord = !selectedId || creating;
  const subEnabled = !needsRecord && !!detail;

  const contactFields: FieldDef[] = [
    { name: "name", label: "Name", type: "text", required: true, maxLength: 150 },
    { name: "relationship_type", label: "Relationship", type: "select", required: true, options: ["Spouse", "Parent", "Sibling", "Child", "Relative", "Friend", "Other"].map((v) => ({ value: v, label: v })) },
    { name: "phone", label: "Phone", type: "text", required: true, maxLength: 30 },
    { name: "alt_phone", label: "Alternative phone", type: "text", maxLength: 30 },
    { name: "address", label: "Address", type: "multiline", maxLength: 500 },
    { name: "is_primary", label: "Primary contact", type: "switch" },
  ];
  const dependentFields: FieldDef[] = [
    { name: "name", label: "Name", type: "text", required: true, maxLength: 150 },
    { name: "relationship_type", label: "Relationship", type: "select", required: true, options: ["Spouse", "Child", "Parent", "Sibling", "Other"].map((v) => ({ value: v, label: v })) },
    { name: "date_of_birth", label: "Date of birth", type: "date" },
    { name: "gender", label: "Gender", type: "select", options: [{ value: null, label: "—" }, { value: "male", label: "Male" }, { value: "female", label: "Female" }, { value: "other", label: "Other" }] },
    { name: "nic", label: "NIC", type: "text", maxLength: 20 },
    { name: "remarks", label: "Remarks", type: "multiline", maxLength: 500 },
    { name: "is_beneficiary", label: "Beneficiary (e.g. insurance)", type: "switch" },
  ];
  const educationFields: FieldDef[] = [
    { name: "level", label: "Level", type: "select", required: true, options: ["school", "certificate", "diploma", "bachelor", "master", "doctorate", "professional", "other"].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) },
    { name: "qualification", label: "Qualification", type: "text", required: true, maxLength: 200 },
    { name: "institution", label: "Institution", type: "text", required: true, maxLength: 200 },
    { name: "field_of_study", label: "Field of study", type: "text", maxLength: 200 },
    { name: "start_year", label: "Start year", type: "number", min: 1940, max: 2100, nullable: true },
    { name: "end_year", label: "End year", type: "number", min: 1940, max: 2100, nullable: true },
    { name: "grade", label: "Grade / result", type: "text", maxLength: 50 },
  ];
  const experienceFields: FieldDef[] = [
    { name: "company", label: "Company", type: "text", required: true, maxLength: 200 },
    { name: "designation", label: "Designation", type: "text", required: true, maxLength: 150 },
    { name: "from_date", label: "From", type: "date", required: true },
    { name: "to_date", label: "To", type: "date" },
    { name: "last_salary", label: "Last salary", type: "number", min: 0, nullable: true },
    { name: "reference_name", label: "Reference name", type: "text", maxLength: 150 },
    { name: "reference_contact", label: "Reference contact", type: "text", maxLength: 50 },
    { name: "reason_for_leaving", label: "Reason for leaving", type: "multiline", maxLength: 1000 },
  ];
  const documentFields: FieldDef[] = [
    { name: "doc_type", label: "Type", type: "select", required: true, options: ["nic", "passport", "driving_license", "contract", "appointment_letter", "certificate", "medical", "police_report", "other"].map((v) => ({ value: v, label: v.replace("_", " ").replace(/^./, (c) => c.toUpperCase()) })) },
    { name: "title", label: "Title", type: "text", required: true, maxLength: 200 },
    { name: "doc_number", label: "Document number", type: "text", maxLength: 100 },
    { name: "issue_date", label: "Issue date", type: "date" },
    { name: "expiry_date", label: "Expiry date", type: "date" },
    { name: "remarks", label: "Remarks", type: "multiline", maxLength: 500 },
  ];

  const sub = <T extends { id: number }>(kind: Parameters<typeof employeeCoreApi.sub.list>[1], extra: Record<string, unknown> = {}) => ({
    queryKey: ["hr", "employee", selectedId, kind],
    fetcher: () => employeeCoreApi.sub.list<T>(selectedId!, kind),
    create: (d: Record<string, unknown>) => employeeCoreApi.sub.create<T>(selectedId!, kind, { ...d, ...extra }),
    update: (id: number, d: Record<string, unknown>) => employeeCoreApi.sub.update<T>(selectedId!, kind, id, { ...d, ...extra }),
    remove: (id: number) => employeeCoreApi.sub.remove(selectedId!, kind, id),
    invalidate: [["hr", "employee", selectedId]] as unknown[][],
    canCreate: canUpdate && !left, canUpdate: canUpdate && !left,
  });

  const familyTab = (
    <>
      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>Emergency contacts</Typography>
      <Box sx={{ mb: 2 }}>
        <MasterTab<EmergencyContact> compact title="Emergency contacts" noun="Contact" {...sub<EmergencyContact>("emergency-contacts")} fields={contactFields}
          blank={{ name: "", relationship_type: "", phone: "", alt_phone: "", address: "", is_primary: false }}
          columns={[{ field: "name", header: "Name", flex: 1, minWidth: 150 }, { field: "relationship_type", header: "Relationship", width: 130 }, { field: "phone", header: "Phone", width: 150 },
            { field: "alt_phone", header: "Alt. phone", width: 150 }, { field: "is_primary", header: "Primary", width: 90, renderCell: (p) => (p.row.is_primary ? <Chip size="small" color="primary" label="Primary" /> : "") }]} />
      </Box>
      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>Dependents</Typography>
      <MasterTab<Dependent> compact title="Dependents" noun="Dependent" {...sub<Dependent>("dependents")} fields={dependentFields}
        blank={{ name: "", relationship_type: "", date_of_birth: "", gender: null, nic: "", remarks: "", is_beneficiary: false }}
        columns={[{ field: "name", header: "Name", flex: 1, minWidth: 150 }, { field: "relationship_type", header: "Relationship", width: 130 }, { field: "date_of_birth", header: "Date of birth", width: 130, renderCell: (p) => fmtDate(p.row.date_of_birth) },
          { field: "is_beneficiary", header: "Beneficiary", width: 110, renderCell: (p) => (p.row.is_beneficiary ? "Yes" : "No") }]} />
    </>
  );

  const qualificationsTab = (
    <>
      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>Education</Typography>
      <Box sx={{ mb: 2 }}>
        <MasterTab<Education> compact title="Education" noun="Qualification" {...sub<Education>("education")} fields={educationFields}
          blank={{ level: "bachelor", qualification: "", institution: "", field_of_study: "", start_year: "", end_year: "", grade: "" }}
          columns={[{ field: "level", header: "Level", width: 110 }, { field: "qualification", header: "Qualification", flex: 1, minWidth: 170 }, { field: "institution", header: "Institution", width: 200 },
            { field: "end_year", header: "Years", width: 120, renderCell: (p) => [p.row.start_year, p.row.end_year].filter(Boolean).join(" – ") }, { field: "grade", header: "Grade", width: 100 }]} />
      </Box>
      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>Work experience</Typography>
      <MasterTab<Experience> compact title="Work experience" noun="Experience" {...sub<Experience>("experience")} fields={experienceFields}
        blank={{ company: "", designation: "", from_date: "", to_date: "", last_salary: "", reference_name: "", reference_contact: "", reason_for_leaving: "" }}
        columns={[{ field: "company", header: "Company", flex: 1, minWidth: 170 }, { field: "designation", header: "Designation", width: 170 },
          { field: "from_date", header: "Period", width: 210, renderCell: (p) => `${fmtDate(p.row.from_date)} – ${p.row.to_date ? fmtDate(p.row.to_date) : "present"}` }]} />
    </>
  );

  const uploadDoc = async (doc: EmployeeDocument) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,image/png,image/jpeg,image/webp";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try { await employeeCoreApi.uploadDocument(selectedId!, doc.id, file); showSuccessToast("File attached"); qc.invalidateQueries({ queryKey: ["hr", "employee", selectedId, "documents"] }); }
      catch (e) { showErrorToast(handleApiError(e, "Upload failed")); }
    };
    input.click();
  };
  const documentsTab = !canSensitiveView ? (
    <Alert severity="info">Employee documents are only visible to users with the sensitive-data permission.</Alert>
  ) : (
    <MasterTab<EmployeeDocument> compact title="Documents" noun="Document" {...sub<EmployeeDocument>("documents")} canCreate={canSensitiveEdit && !left} canUpdate={canSensitiveEdit && !left}
      fields={documentFields} blank={{ doc_type: "nic", title: "", doc_number: "", issue_date: "", expiry_date: "", remarks: "" }}
      columns={[
        { field: "title", header: "Document", flex: 1, minWidth: 190 }, { field: "doc_type", header: "Type", width: 150, renderCell: (p) => p.row.doc_type.replace("_", " ") },
        { field: "doc_number", header: "Number", width: 140 },
        { field: "expiry_date", header: "Expires", width: 170, renderCell: (p) => (p.row.expiry_date ? (
          <Box sx={{ display: "flex", gap: 0.75, alignItems: "center" }}>{fmtDate(p.row.expiry_date)}
            {p.row.expired ? <Chip size="small" color="error" label="Expired" /> : p.row.expires_in_days !== null && p.row.expires_in_days <= 60 ? <Chip size="small" color="warning" label={`${p.row.expires_in_days} d`} /> : null}</Box>) : "—") },
        { field: "file_name", header: "File", width: 150, sortable: false, renderCell: (p) => (
          <Box sx={{ display: "flex", alignItems: "center" }}>
            {p.row.file_path && <Tooltip title={`Download ${p.row.file_name}`}><IconButton size="small" onClick={(e) => { e.stopPropagation(); employeeCoreApi.downloadDocument(selectedId!, p.row.id, p.row.file_name ?? "document").catch((err) => showErrorToast(handleApiError(err, "Download failed"))); }}><DownloadIcon fontSize="small" /></IconButton></Tooltip>}
            {canSensitiveEdit && !left && <Tooltip title={p.row.file_path ? "Replace file" : "Attach file"}><IconButton size="small" onClick={(e) => { e.stopPropagation(); uploadDoc(p.row); }}><UploadFileIcon fontSize="small" /></IconButton></Tooltip>}
          </Box>) },
      ]} />
  );

  const tasksQuery = useQuery({ queryKey: ["hr", "employee", selectedId, "tasks"], queryFn: () => employeeCoreApi.sub.list<OnboardingTask>(selectedId!, "tasks"), enabled: subEnabled && section === "checklist" });
  const taskStatus = useMutation({
    mutationFn: ({ id, status: st }: { id: number; status: OnboardingTask["status"] }) => employeeCoreApi.setTaskStatus(selectedId!, id, st),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hr", "employee", selectedId, "tasks"] }); qc.invalidateQueries({ queryKey: ["hr", "employee", selectedId] }); },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to update the task")),
  });
  const applyChecklist = useMutation({
    mutationFn: (c: "onboarding" | "offboarding") => employeeCoreApi.applyChecklist(selectedId!, c),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hr", "employee", selectedId, "tasks"] }); showSuccessToast("Checklist added"); },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to add the checklist")),
  });
  const checklistTab = (() => {
    const tasks = tasksQuery.data ?? [];
    const group = (cat: "onboarding" | "offboarding") => {
      const rows = tasks.filter((t) => t.category === cat);
      const done = rows.filter((t) => t.status === "done" || t.status === "skipped").length;
      return (
        <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5 }} key={cat}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
            <Typography variant="subtitle1" fontWeight={600}>{cat === "onboarding" ? "Onboarding" : "Offboarding"}</Typography>
            {rows.length > 0 && <Typography variant="caption" color="text.secondary">{done} of {rows.length} done</Typography>}
            <Box sx={{ flex: 1 }} />
            {rows.length === 0 && canUpdate && <Button size="small" sx={{ textTransform: "none" }} onClick={() => applyChecklist.mutate(cat)}>Add standard {cat} checklist</Button>}
          </Box>
          {rows.length > 0 && <LinearProgress variant="determinate" value={(done / rows.length) * 100} sx={{ mb: 1, height: 6, borderRadius: 3 }} />}
          {rows.map((t) => (
            <Box key={t.id} sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 0.5, borderTop: 1, borderColor: "divider" }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ textDecoration: t.status === "done" ? "line-through" : "none" }}>{t.title}</Typography>
                <Typography variant="caption" color="text.secondary">{t.responsible ?? "—"}{t.due_date ? ` · due ${fmtDate(t.due_date)}` : ""}{t.completed_date ? ` · done ${fmtDate(t.completed_date)}` : ""}</Typography>
              </Box>
              <TextField select size="small" value={t.status} disabled={!canUpdate} sx={{ width: 140 }} onChange={(e) => taskStatus.mutate({ id: t.id, status: e.target.value as OnboardingTask["status"] })}>
                <MenuItem value="pending">Pending</MenuItem><MenuItem value="in_progress">In progress</MenuItem><MenuItem value="done">Done</MenuItem><MenuItem value="skipped">Skipped</MenuItem>
              </TextField>
            </Box>
          ))}
        </Paper>
      );
    };
    return <>{group("onboarding")}{group("offboarding")}</>;
  })();

  const balances = useQuery({ queryKey: ["hr", "employee", selectedId, "balances"], queryFn: () => leaveAllocationApi.balances(selectedId!), enabled: subEnabled && section === "leave" });
  const leaveTab = (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>Leave balances — {new Date().getFullYear()}</Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: "2fr repeat(5, 1fr)", gap: 0.5, alignItems: "center" }}>
        {["Leave type", "Entitled", "Carried", "Used", "Pending", "Balance"].map((h, i) => <Typography key={h} variant="caption" color="text.secondary" fontWeight={600} align={i ? "right" : "left"}>{h}</Typography>)}
        {(balances.data ?? []).map((b) => (
          <Box key={b.leave_type_id} sx={{ display: "contents" }}>
            <Typography variant="body2" component="div">{b.name}{!b.is_paid && <Chip size="small" label="Unpaid" sx={{ ml: 1 }} />}</Typography>
            <Typography variant="body2" align="right">{b.entitlement + b.adjustment}</Typography>
            <Typography variant="body2" align="right">{b.carried_forward}</Typography>
            <Typography variant="body2" align="right">{b.used}</Typography>
            <Typography variant="body2" align="right">{b.pending}</Typography>
            <Typography variant="body2" align="right" fontWeight={600} color={b.balance < 0 ? "error" : undefined}>{b.balance}</Typography>
          </Box>
        ))}
      </Box>
      {balances.isLoading && <LinearProgress sx={{ mt: 1 }} />}
    </Paper>
  );

  const body = (() => {
    if (section === "personal") return personal;
    if (section === "job") return job;
    if (section === "bank") return bank;
    if (needsRecord) return <Alert severity="info">Save the employee first, then add {SECTION_LABEL[section].toLowerCase()} records.</Alert>;
    if (section === "family") return familyTab;
    if (section === "qualifications") return qualificationsTab;
    if (section === "documents") return documentsTab;
    if (section === "checklist") return checklistTab;
    return leaveTab;
  })();

  const recordPanel = (
    <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
      {header}
      <Tabs value={section} onChange={(_, v) => setSection(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 1.5, borderBottom: 1, borderColor: "divider" }}>
        {SECTIONS.map((s) => <Tab key={s} value={s} label={<Box sx={{ display: "flex", gap: 0.75, alignItems: "center" }}>{SECTION_LABEL[s]}
          {detail && s === "checklist" && detail.counts?.tasks_open ? <Chip size="small" color="warning" label={detail.counts.tasks_open} sx={{ height: 18 }} /> : null}</Box>} sx={{ textTransform: "none" }} />)}
      </Tabs>
      {loadingDetail && !detail && !creating ? <LinearProgress /> : body}
    </Box>
  );

  const inRecord = creating || selectedId !== null;
  return (
    <>
      <MasterDetailLayout
        title="Employees"
        titleSlot={inRecord ? (
          <Button size="small" startIcon={<ArrowBackIcon fontSize="small" />} onClick={backToList} sx={{ textTransform: "none" }}>Back to Employees</Button>
        ) : (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <TextField size="small" placeholder="Search name, ID, email..." value={search} onChange={(e) => setSearch(e.target.value)}
              sx={{ width: 230, flexShrink: 0, "& .MuiOutlinedInput-root": { borderRadius: "24px" } }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" color="action" /></InputAdornment> }} />
            <Box sx={{ width: 200, flexShrink: 0 }}>
              <TStatusFilter
                options={[{ value: null, label: "All Departments" }, ...departments.map((d) => ({ value: String(d.id), label: d.name }))]}
                value={department === "" ? null : String(department)} onChange={(v) => setDepartment(v ? Number(v) : "")}
                label="" placeholder="All Departments" size="small" />
            </Box>
            <Box sx={{ width: 160, flexShrink: 0, "& .MuiOutlinedInput-root": { borderRadius: "24px" } }}>
              <TBranchFilter branches={branchList} value={branch || null} onChange={(v) => setBranch(v ?? "")} label="" placeholder="All Branches" size="small" />
            </Box>
            <Box sx={{ width: 170, flexShrink: 0 }}>
              <TStatusFilter
                options={[{ value: null, label: "All Statuses" }, { value: "live", label: "In service" }, ...Object.entries(STATUS_META).map(([k, m]) => ({ value: k, label: m.label }))]}
                value={status === "" ? null : status} onChange={(v) => setStatus(v ?? "")}
                label="" placeholder="All Statuses" size="small" />
            </Box>
            {(search || department || branch || status !== "live") && (
              <Button size="small" sx={{ textTransform: "none" }} onClick={() => { setSearch(""); setDepartment(""); setBranch(""); setStatus("live"); }}>Clear</Button>
            )}
          </Box>
        )}
        headerActions={!inRecord && canCreate ? (
          <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={startCreate} sx={{ mr: 1 }}>Add Employee</Button>
        ) : undefined}
        onRefresh={() => { refetch(); refreshAll(); }}
        isLoading={isFetching}
      >
        {inRecord ? recordPanel : listPanel}
      </MasterDetailLayout>

      <TConfirmDialog {...dialogProps} />
      <SeparationDialog open={separateOpen} onClose={() => setSeparateOpen(false)} detail={detail} onDone={() => { setSeparateOpen(false); refreshAll(); }} />
    </>
  );
}

function SeparationDialog({ open, onClose, detail, onDone }: { open: boolean; onClose: () => void; detail?: EmployeeDetail; onDone: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState<SeparationInput>({ exit_type: "resignation", last_working_date: today, resignation_date: today, exit_reason: "", deactivate_user: false });
  useEffect(() => { if (open) setForm({ exit_type: "resignation", last_working_date: today, resignation_date: today, exit_reason: "", deactivate_user: false }); }, [open, today]);
  const mutation = useMutation({
    mutationFn: () => employeeCoreApi.separate(detail!.id, { ...form, resignation_date: form.exit_type === "resignation" ? form.resignation_date : null, expected_version: detail?.version ?? null }),
    onSuccess: () => { showSuccessToast("Separation recorded; the offboarding checklist was added"); onDone(); },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to record the separation")),
  });
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Separation — {detail?.full_name}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5, pt: 1 }}>
          <TextField select size="small" label="Reason type" value={form.exit_type} onChange={(e) => setForm({ ...form, exit_type: e.target.value as SeparationInput["exit_type"] })}>
            {[["resignation", "Resignation"], ["termination", "Termination"], ["retirement", "Retirement"], ["end_of_contract", "End of contract"], ["death", "Death in service"], ["other", "Other"]]
              .map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
          </TextField>
          <TextField size="small" type="date" required label="Last working day" InputLabelProps={{ shrink: true }} value={form.last_working_date} onChange={(e) => setForm({ ...form, last_working_date: e.target.value })} />
          {form.exit_type === "resignation" && (
            <TextField size="small" type="date" label="Resignation date" InputLabelProps={{ shrink: true }} value={form.resignation_date ?? ""} onChange={(e) => setForm({ ...form, resignation_date: e.target.value })} />
          )}
          <TextField size="small" multiline minRows={2} label="Remarks" value={form.exit_reason ?? ""} inputProps={{ maxLength: 2000 }} sx={{ gridColumn: { sm: "1 / -1" } }} onChange={(e) => setForm({ ...form, exit_reason: e.target.value })} />
          <FormControlLabel sx={{ gridColumn: { sm: "1 / -1" } }} control={<Switch checked={Boolean(form.deactivate_user)} onChange={(e) => setForm({ ...form, deactivate_user: e.target.checked })} />}
            label="Also deactivate the system login (takes effect once the last working day has passed)" />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" color="error" startIcon={<CancelIcon />} onClick={onClose}>Cancel</Button>
        <Button variant="contained" color="warning" disabled={mutation.isPending || !form.last_working_date} onClick={() => mutation.mutate()}>Record separation</Button>
      </DialogActions>
    </Dialog>
  );
}
