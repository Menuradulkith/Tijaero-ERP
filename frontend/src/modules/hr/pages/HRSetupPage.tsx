/**
 * HR Setup — the masters the rest of HR hangs on: departments, designations, employment types,
 * shifts, holiday calendars and leave types.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Paper, Tab, Tabs, TextField, Tooltip, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { MasterDetailLayout, TDataGrid, type TDataGridColumn, handleApiError, showErrorToast, showSuccessToast, TConfirmDialog, useTConfirmDialog } from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";
import {
  hrOrgApi, employeeCoreApi, type Department, type Designation, type EmploymentType, type Holiday, type HolidayList, type HolidayType,
  type LeaveType, type Shift,
} from "@/modules/hr/core-api";
import MasterTab, { type FieldDef } from "@/modules/hr/components/MasterTab";

import CancelIcon from "@mui/icons-material/Cancel";
import SaveIcon from "@mui/icons-material/Save";
const ActiveChip = ({ active }: { active: boolean }) => (
  <Chip size="small" label={active ? "Active" : "Inactive"} color={active ? "success" : "default"} variant={active ? "filled" : "outlined"} />
);
const yesNo = (v: boolean) => (v ? "Yes" : "No");
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const offDays = (s: string) => (s ? s.split(",").map((d) => DAYS[Number(d)]).join(", ") : "None");
const HOLIDAY_TYPES: { value: HolidayType; label: string }[] = [
  { value: "public", label: "Public holiday" }, { value: "poya", label: "Poya day" }, { value: "mercantile", label: "Mercantile holiday" },
  { value: "bank", label: "Bank holiday" }, { value: "company", label: "Company holiday" }, { value: "other", label: "Other" },
];

function DepartmentsTab({ canCreate, canUpdate }: { canCreate: boolean; canUpdate: boolean }) {
  const { data: depts = [] } = useQuery({ queryKey: ["hr", "departments"], queryFn: () => hrOrgApi.departments.list() });
  const { data: emps } = useQuery({ queryKey: ["hr", "employee-options"], queryFn: () => employeeCoreApi.paged({ size: 200, status: "live", sort_by: "name" }) });
  const fields: FieldDef[] = useMemo(() => [
    { name: "code", label: "Code", type: "text", required: true, maxLength: 30, helper: "Letters, numbers, - and _" },
    { name: "name", label: "Department name", type: "text", required: true, maxLength: 150 },
    { name: "parent_id", label: "Parent department", type: "select", options: [{ value: null, label: "— None (top level) —" }, ...depts.map((d) => ({ value: d.id, label: d.name }))] },
    { name: "head_employee_id", label: "Department head", type: "select", options: [{ value: null, label: "— Not set —" }, ...(emps?.items ?? []).map((e) => ({ value: e.id, label: `${e.full_name ?? e.employee_id} (${e.employee_id})` }))] },
    { name: "description", label: "Description", type: "multiline", maxLength: 1000 },
    { name: "active", label: "Active", type: "switch" },
  ], [depts, emps]);
  const columns = useMemo<TDataGridColumn<Department>[]>(() => [
    { field: "code", header: "Code", width: 110 },
    { field: "name", header: "Department", flex: 1, minWidth: 180 },
    { field: "parent_name", header: "Parent", width: 170 },
    { field: "head_name", header: "Head", width: 170 },
    { field: "employee_count", header: "Employees", width: 110, align: "right", headerAlign: "right" },
    { field: "active", header: "Status", width: 110, renderCell: (p) => <ActiveChip active={Boolean(p.row.active)} /> },
  ], []);
  return (
    <MasterTab<Department> title="Departments" noun="Department" queryKey={["hr", "departments"]} fetcher={() => hrOrgApi.departments.list()}
      create={(d) => hrOrgApi.departments.create(d as never)} update={(id, d) => hrOrgApi.departments.update(id, d as never)}
      columns={columns} fields={fields} blank={{ code: "", name: "", parent_id: null, head_employee_id: null, description: "", active: true }}
      canCreate={canCreate} canUpdate={canUpdate} invalidate={[["hr", "designations"]]} />
  );
}

function DesignationsTab({ canCreate, canUpdate }: { canCreate: boolean; canUpdate: boolean }) {
  const { data: depts = [] } = useQuery({ queryKey: ["hr", "departments"], queryFn: () => hrOrgApi.departments.list() });
  const fields: FieldDef[] = useMemo(() => [
    { name: "name", label: "Designation", type: "text", required: true, maxLength: 150 },
    { name: "department_id", label: "Department (optional)", type: "select", options: [{ value: null, label: "— Any department —" }, ...depts.map((d) => ({ value: d.id, label: d.name }))] },
    { name: "grade", label: "Grade", type: "text", maxLength: 30 },
    { name: "description", label: "Description", type: "multiline", maxLength: 1000 },
    { name: "active", label: "Active", type: "switch" },
  ], [depts]);
  const columns = useMemo<TDataGridColumn<Designation>[]>(() => [
    { field: "name", header: "Designation", flex: 1, minWidth: 200 },
    { field: "department_name", header: "Department", width: 200 },
    { field: "grade", header: "Grade", width: 100 },
    { field: "employee_count", header: "Employees", width: 110, align: "right", headerAlign: "right" },
    { field: "active", header: "Status", width: 110, renderCell: (p) => <ActiveChip active={Boolean(p.row.active)} /> },
  ], []);
  return (
    <MasterTab<Designation> title="Designations" noun="Designation" queryKey={["hr", "designations"]} fetcher={() => hrOrgApi.designations.list()}
      create={(d) => hrOrgApi.designations.create(d as never)} update={(id, d) => hrOrgApi.designations.update(id, d as never)}
      columns={columns} fields={fields} blank={{ name: "", department_id: null, grade: "", description: "", active: true }} canCreate={canCreate} canUpdate={canUpdate} />
  );
}

function EmploymentTypesTab({ canCreate, canUpdate }: { canCreate: boolean; canUpdate: boolean }) {
  const fields: FieldDef[] = [
    { name: "name", label: "Employment type", type: "text", required: true, maxLength: 80 },
    { name: "default_probation_months", label: "Default probation (months)", type: "number", min: 0, max: 24, helper: "0 = no probation" },
    { name: "description", label: "Description", type: "multiline", maxLength: 1000 },
    { name: "has_end_date", label: "Has a contract end date", type: "switch" },
    { name: "epf_etf_applicable", label: "EPF / ETF applies", type: "switch" },
    { name: "active", label: "Active", type: "switch" },
  ];
  const columns = useMemo<TDataGridColumn<EmploymentType>[]>(() => [
    { field: "name", header: "Employment type", flex: 1, minWidth: 180 },
    { field: "default_probation_months", header: "Probation (months)", width: 150, align: "right", headerAlign: "right" },
    { field: "has_end_date", header: "Contract end date", width: 150, renderCell: (p) => yesNo(Boolean(p.row.has_end_date)) },
    { field: "epf_etf_applicable", header: "EPF / ETF", width: 110, renderCell: (p) => yesNo(Boolean(p.row.epf_etf_applicable)) },
    { field: "employee_count", header: "Employees", width: 110, align: "right", headerAlign: "right" },
    { field: "active", header: "Status", width: 110, renderCell: (p) => <ActiveChip active={Boolean(p.row.active)} /> },
  ], []);
  return (
    <MasterTab<EmploymentType> title="Employment Types" noun="Employment type" queryKey={["hr", "employment-types"]} fetcher={() => hrOrgApi.employmentTypes.list()}
      create={(d) => hrOrgApi.employmentTypes.create(d as never)} update={(id, d) => hrOrgApi.employmentTypes.update(id, d as never)}
      columns={columns} fields={fields} blank={{ name: "", description: "", default_probation_months: 0, has_end_date: false, epf_etf_applicable: true, active: true }}
      canCreate={canCreate} canUpdate={canUpdate} />
  );
}

function ShiftsTab({ canCreate, canUpdate }: { canCreate: boolean; canUpdate: boolean }) {
  const weeklyOff = [
    { value: "6", label: "Sunday" }, { value: "5,6", label: "Saturday and Sunday" }, { value: "0", label: "Monday" }, { value: "", label: "No weekly off" },
  ];
  const fields: FieldDef[] = [
    { name: "name", label: "Shift name", type: "text", required: true, maxLength: 80 },
    { name: "weekly_off_days", label: "Weekly off", type: "select", options: weeklyOff },
    { name: "start_time", label: "Start time", type: "time", required: true },
    { name: "end_time", label: "End time", type: "time", required: true },
    { name: "grace_minutes", label: "Late grace (minutes)", type: "number", min: 0, max: 120 },
    { name: "break_minutes", label: "Break (minutes)", type: "number", min: 0, max: 240 },
    { name: "work_minutes", label: "Full day (working minutes)", type: "number", min: 60, max: 960, helper: "Overtime counts above this" },
    { name: "half_day_minutes", label: "Half day (minutes)", type: "number", min: 30, max: 480 },
    { name: "is_default", label: "Default shift", type: "switch", helper: "Used when an employee has no shift" },
    { name: "active", label: "Active", type: "switch" },
  ];
  const columns = useMemo<TDataGridColumn<Shift>[]>(() => [
    { field: "name", header: "Shift", flex: 1, minWidth: 190, renderCell: (p) => (<>{p.row.name} {p.row.is_default && <Chip size="small" label="Default" color="primary" sx={{ ml: 1 }} />}</>) },
    { field: "start_time", header: "Hours", width: 150, renderCell: (p) => `${String(p.row.start_time).slice(0, 5)} – ${String(p.row.end_time).slice(0, 5)}` },
    { field: "grace_minutes", header: "Grace", width: 90, align: "right", headerAlign: "right", renderCell: (p) => `${p.row.grace_minutes} min` },
    { field: "work_minutes", header: "Full day", width: 100, align: "right", headerAlign: "right", renderCell: (p) => `${(p.row.work_minutes / 60).toFixed(1)} h` },
    { field: "weekly_off_days", header: "Weekly off", width: 170, renderCell: (p) => offDays(p.row.weekly_off_days) },
    { field: "employee_count", header: "Employees", width: 110, align: "right", headerAlign: "right" },
    { field: "active", header: "Status", width: 110, renderCell: (p) => <ActiveChip active={Boolean(p.row.active)} /> },
  ], []);
  return (
    <MasterTab<Shift> title="Shifts" noun="Shift" queryKey={["hr", "shifts"]} fetcher={() => hrOrgApi.shifts.list()}
      create={(d) => hrOrgApi.shifts.create(d as never)} update={(id, d) => hrOrgApi.shifts.update(id, d as never)}
      columns={columns} fields={fields}
      blank={{ name: "", start_time: "09:00", end_time: "17:00", grace_minutes: 10, break_minutes: 60, work_minutes: 480, half_day_minutes: 240, weekly_off_days: "6", is_default: false, active: true }}
      canCreate={canCreate} canUpdate={canUpdate} />
  );
}

function LeaveTypesTab({ canCreate, canUpdate }: { canCreate: boolean; canUpdate: boolean }) {
  const fields: FieldDef[] = [
    { name: "code", label: "Code", type: "text", required: true, maxLength: 30, disabledWhenEditing: true, helper: "Stored on leave applications; cannot change once used" },
    { name: "name", label: "Leave type", type: "text", required: true, maxLength: 80 },
    { name: "annual_entitlement", label: "Days per year", type: "number", min: 0, max: 366, step: 0.5 },
    { name: "accrual", label: "Accrual", type: "select", options: [{ value: "none", label: "Whole entitlement from 1 January" }, { value: "monthly", label: "Accrues month by month" }] },
    { name: "carry_forward_max", label: "Carry forward up to (days)", type: "number", min: 0, max: 366, step: 0.5 },
    { name: "max_consecutive_days", label: "Max consecutive days", type: "number", min: 0, max: 366, nullable: true, step: 0.5, helper: "Empty = no limit" },
    { name: "min_service_months", label: "Minimum service (months)", type: "number", min: 0, max: 120 },
    { name: "applicable_gender", label: "Applies to", type: "select", options: [{ value: "all", label: "Everyone" }, { value: "female", label: "Female employees" }, { value: "male", label: "Male employees" }] },
    { name: "document_required_after_days", label: "Medical certificate after (days)", type: "number", min: 0, max: 366, nullable: true, step: 0.5, helper: "Informational" },
    { name: "description", label: "Description", type: "multiline", maxLength: 1000 },
    { name: "is_paid", label: "Paid leave", type: "switch" },
    { name: "allow_half_day", label: "Half days allowed", type: "switch" },
    { name: "allow_negative_balance", label: "Allow going below zero", type: "switch" },
    { name: "count_holidays", label: "Count weekly offs and holidays as leave", type: "switch" },
    { name: "active", label: "Active", type: "switch" },
  ];
  const columns = useMemo<TDataGridColumn<LeaveType>[]>(() => [
    { field: "code", header: "Code", width: 110 },
    { field: "name", header: "Leave type", flex: 1, minWidth: 170 },
    { field: "annual_entitlement", header: "Days / year", width: 110, align: "right", headerAlign: "right" },
    { field: "accrual", header: "Accrual", width: 100, renderCell: (p) => (p.row.accrual === "monthly" ? "Monthly" : "Upfront") },
    { field: "carry_forward_max", header: "Carry fwd", width: 100, align: "right", headerAlign: "right" },
    { field: "is_paid", header: "Paid", width: 80, renderCell: (p) => yesNo(Boolean(p.row.is_paid)) },
    { field: "applicable_gender", header: "Applies to", width: 110, renderCell: (p) => (p.row.applicable_gender === "all" ? "Everyone" : String(p.row.applicable_gender)) },
    { field: "active", header: "Status", width: 110, renderCell: (p) => <ActiveChip active={Boolean(p.row.active)} /> },
  ], []);
  return (
    <MasterTab<LeaveType> title="Leave Types" noun="Leave type" queryKey={["hr", "leave-types"]} fetcher={() => hrOrgApi.leaveTypes.list()}
      create={(d) => hrOrgApi.leaveTypes.create(d as never)} update={(id, d) => hrOrgApi.leaveTypes.update(id, d as never)}
      columns={columns} fields={fields} invalidate={[["hr", "leave-types-active"]]}
      blank={{ code: "", name: "", description: "", annual_entitlement: 0, accrual: "none", carry_forward_max: 0, is_paid: true, allow_half_day: true,
        allow_negative_balance: false, max_consecutive_days: "", min_service_months: 0, applicable_gender: "all", document_required_after_days: "", count_holidays: false, active: true }}
      canCreate={canCreate} canUpdate={canUpdate} />
  );
}

function HolidaysTab({ canCreate, canUpdate }: { canCreate: boolean; canUpdate: boolean }) {
  const qc = useQueryClient();
  const { dialogProps, confirm } = useTConfirmDialog();
  const { data: lists = [] } = useQuery({ queryKey: ["hr", "holiday-lists"], queryFn: () => hrOrgApi.holidayLists.list() });
  const [selected, setSelected] = useState<number | null>(null);
  const current = lists.find((l) => l.id === selected) ?? lists.find((l) => l.is_default) ?? lists[0] ?? null;
  const { data: holidays = [], isLoading } = useQuery({
    queryKey: ["hr", "holidays", current?.id], queryFn: () => hrOrgApi.holidays.list(current!.id), enabled: !!current,
  });
  const [listDialog, setListDialog] = useState<{ edit: HolidayList | null } | null>(null);
  const [listForm, setListForm] = useState({ name: "", year: new Date().getFullYear(), is_default: false, active: true });
  const [holidayDialog, setHolidayDialog] = useState<{ edit: Holiday | null } | null>(null);
  const [hForm, setHForm] = useState<{ holiday_date: string; name: string; holiday_type: HolidayType }>({ holiday_date: "", name: "", holiday_type: "public" });

  const refreshLists = () => qc.invalidateQueries({ queryKey: ["hr", "holiday-lists"] });
  const saveList = useMutation({
    mutationFn: () => (listDialog?.edit
      ? hrOrgApi.holidayLists.update(listDialog.edit.id, { ...listForm, expected_version: listDialog.edit.version ?? null })
      : hrOrgApi.holidayLists.create(listForm)),
    onSuccess: (saved) => { showSuccessToast("Holiday list saved"); setSelected(saved.id); setListDialog(null); refreshLists(); },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to save the holiday list")),
  });
  const saveHoliday = useMutation({
    mutationFn: () => (holidayDialog?.edit
      ? hrOrgApi.holidays.update(current!.id, holidayDialog.edit.id, hForm)
      : hrOrgApi.holidays.create(current!.id, hForm)),
    onSuccess: () => { showSuccessToast("Holiday saved"); setHolidayDialog(null); qc.invalidateQueries({ queryKey: ["hr", "holidays", current?.id] }); refreshLists(); },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to save the holiday")),
  });
  const removeHoliday = useMutation({
    mutationFn: (id: number) => hrOrgApi.holidays.remove(current!.id, id),
    onSuccess: () => { showSuccessToast("Holiday removed"); qc.invalidateQueries({ queryKey: ["hr", "holidays", current?.id] }); refreshLists(); },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to remove the holiday")),
  });

  const columns = useMemo<TDataGridColumn<Holiday>[]>(() => [
    { field: "holiday_date", header: "Date", width: 140 },
    { field: "weekday", header: "Day", width: 110, renderCell: (p) => new Date(`${p.row.holiday_date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long" }) },
    { field: "name", header: "Holiday", flex: 1, minWidth: 200 },
    { field: "holiday_type", header: "Type", width: 150, renderCell: (p) => HOLIDAY_TYPES.find((t) => t.value === p.row.holiday_type)?.label ?? p.row.holiday_type },
    ...(canUpdate ? [{
      field: "actions", header: "", width: 70, sortable: false,
      renderCell: (p: { row: Holiday }) => (
        <Tooltip title="Remove holiday">
          <IconButton size="small" onClick={async (e) => { e.stopPropagation(); if (await confirm({ title: "Remove holiday", message: `Remove ${p.row.name}?`, confirmText: "Remove", danger: true })) removeHoliday.mutate(p.row.id); }}>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ),
    } as TDataGridColumn<Holiday>] : []),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canUpdate, current?.id]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", gap: 1 }}>
      <TConfirmDialog {...dialogProps} />
      <Box sx={{ display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
        <TextField select size="small" label="Holiday calendar" value={current?.id ?? ""} onChange={(e) => setSelected(Number(e.target.value))} sx={{ minWidth: 300 }}>
          {lists.map((l) => <MenuItem key={l.id} value={l.id}>{l.name} ({l.year}){l.is_default ? " — default" : ""}</MenuItem>)}
        </TextField>
        {current && <Typography variant="body2" color="text.secondary">{current.holiday_count} holiday(s) · {current.employee_count} employee(s)</Typography>}
        <Box sx={{ flex: 1 }} />
        {canUpdate && current && (
          <Button size="small" sx={{ textTransform: "none" }} onClick={() => { setListForm({ name: current.name, year: current.year, is_default: current.is_default, active: current.active }); setListDialog({ edit: current }); }}>
            Edit calendar
          </Button>
        )}
        {canCreate && (
          <Button size="small" variant="outlined" startIcon={<AddIcon />} sx={{ textTransform: "none" }}
            onClick={() => { setListForm({ name: "", year: new Date().getFullYear() + 1, is_default: false, active: true }); setListDialog({ edit: null }); }}>
            New calendar
          </Button>
        )}
        {canCreate && current && (
          <Button size="small" variant="contained" startIcon={<AddIcon />} sx={{ textTransform: "none" }}
            onClick={() => { setHForm({ holiday_date: "", name: "", holiday_type: "public" }); setHolidayDialog({ edit: null }); }}>
            Add holiday
          </Button>
        )}
      </Box>
      <Paper variant="outlined" sx={{ px: 1.5, py: 0.75 }}>
        <Typography variant="caption" color="text.secondary">
          Weekly offs come from each employee's shift. Poya and other religious holidays move every year, so add them here for each calendar.
        </Typography>
      </Paper>
      <Box sx={{ flex: 1, minHeight: 300 }}>
        <TDataGrid<Holiday> rows={holidays} columns={columns} loading={isLoading} emptyMessage="No holidays in this calendar"
          onRowClick={(row) => { if (!canUpdate) return; setHForm({ holiday_date: row.holiday_date, name: row.name, holiday_type: row.holiday_type }); setHolidayDialog({ edit: row }); }}
          pageSizeOptions={[25, 50, 100]} pageSize={25} autoHeight={false} height="100%" />
      </Box>

      <Dialog open={!!listDialog} onClose={() => setListDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{listDialog?.edit ? "Edit holiday calendar" : "New holiday calendar"}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "grid", gap: 1.5, pt: 1 }}>
            <TextField size="small" label="Name" required value={listForm.name} onChange={(e) => setListForm({ ...listForm, name: e.target.value })} inputProps={{ maxLength: 120 }} />
            <TextField size="small" label="Year" type="number" required value={listForm.year} inputProps={{ min: 2000, max: 2100 }}
              onChange={(e) => setListForm({ ...listForm, year: Number(e.target.value) })} />
            <TextField select size="small" label="Default for the year" value={listForm.is_default ? "yes" : "no"} onChange={(e) => setListForm({ ...listForm, is_default: e.target.value === "yes" })}>
              <MenuItem value="no">No</MenuItem><MenuItem value="yes">Yes — used when an employee has no calendar</MenuItem>
            </TextField>
            <TextField select size="small" label="Status" value={listForm.active ? "active" : "inactive"} onChange={(e) => setListForm({ ...listForm, active: e.target.value === "active" })}>
              <MenuItem value="active">Active</MenuItem><MenuItem value="inactive">Inactive</MenuItem>
            </TextField>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" color="error" startIcon={<CancelIcon />} onClick={() => setListDialog(null)}>Cancel</Button>
          <Button variant="contained" color="success" startIcon={<SaveIcon />} disabled={saveList.isPending || !listForm.name.trim()} onClick={() => saveList.mutate()}>Save</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!holidayDialog} onClose={() => setHolidayDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{holidayDialog?.edit ? "Edit holiday" : "Add holiday"}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "grid", gap: 1.5, pt: 1 }}>
            <TextField size="small" label="Date" type="date" required InputLabelProps={{ shrink: true }} value={hForm.holiday_date}
              inputProps={{ min: current ? `${current.year}-01-01` : undefined, max: current ? `${current.year}-12-31` : undefined }}
              onChange={(e) => setHForm({ ...hForm, holiday_date: e.target.value })} />
            <TextField size="small" label="Name" required value={hForm.name} inputProps={{ maxLength: 150 }} onChange={(e) => setHForm({ ...hForm, name: e.target.value })} />
            <TextField select size="small" label="Type" value={hForm.holiday_type} onChange={(e) => setHForm({ ...hForm, holiday_type: e.target.value as HolidayType })}>
              {HOLIDAY_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
            </TextField>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" color="error" startIcon={<CancelIcon />} onClick={() => setHolidayDialog(null)}>Cancel</Button>
          <Button variant="contained" color="success" startIcon={<SaveIcon />} disabled={saveHoliday.isPending || !hForm.holiday_date || !hForm.name.trim()} onClick={() => saveHoliday.mutate()}>Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

const TABS = [
  { id: "departments", label: "Departments" }, { id: "designations", label: "Designations" }, { id: "types", label: "Employment Types" },
  { id: "shifts", label: "Shifts" }, { id: "holidays", label: "Holidays" }, { id: "leave", label: "Leave Types" },
] as const;

export default function HRSetupPage() {
  const canCreate = usePermission("hr_setup", "create");
  const canUpdate = usePermission("hr_setup", "update");
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("departments");
  return (
    <MasterDetailLayout title="HR Setup" isLoading={false}>
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", p: 1.5 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 1.5, borderBottom: 1, borderColor: "divider" }}>
          {TABS.map((t) => <Tab key={t.id} value={t.id} label={t.label} sx={{ textTransform: "none" }} />)}
        </Tabs>
        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {tab === "departments" && <DepartmentsTab canCreate={canCreate} canUpdate={canUpdate} />}
          {tab === "designations" && <DesignationsTab canCreate={canCreate} canUpdate={canUpdate} />}
          {tab === "types" && <EmploymentTypesTab canCreate={canCreate} canUpdate={canUpdate} />}
          {tab === "shifts" && <ShiftsTab canCreate={canCreate} canUpdate={canUpdate} />}
          {tab === "holidays" && <HolidaysTab canCreate={canCreate} canUpdate={canUpdate} />}
          {tab === "leave" && <LeaveTypesTab canCreate={canCreate} canUpdate={canUpdate} />}
        </Box>
      </Box>
    </MasterDetailLayout>
  );
}
