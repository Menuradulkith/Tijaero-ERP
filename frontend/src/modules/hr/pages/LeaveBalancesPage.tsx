/**
 * Leave Balances — yearly leave entitlement per employee and leave type, with what has been used.
 * Entitlements can be generated for the whole company from the leave types (with carry-forward) and adjusted by hand.
 * Rows are one employee + leave type each (no per-employee detail page), so the page stays a grid;
 * generate / grant lieu day / add-edit allocation open as side panels.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Alert, Box, Button, FormControlLabel, IconButton, MenuItem, Switch, TextField, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { GridPaginationModel } from "@mui/x-data-grid";
import {
  FormSection, MasterDetailLayout, TDataGrid, type TDataGridColumn, TSidePanel, TStatusFilter, handleApiError, showErrorToast, showSuccessToast,
} from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";
import { fetchAllPages } from "@/utils/fetchAllPages";
import { employeeCoreApi, hrOrgApi, leaveAllocationApi, type LeaveAllocation } from "@/modules/hr/core-api";
import { lieuLeaveApi } from "@/modules/hr/api";
import { formatDate } from "@/utils/formatters";

const thisYear = new Date().getFullYear();

type LieuForm = { employee_pk: number | ""; worked_date: string; days: number; remarks: string };

export default function LeaveBalancesPage() {
  const qc = useQueryClient();
  const canCreate = usePermission("leave_allocations", "create");
  const canUpdate = usePermission("leave_allocations", "update");
  const [year, setYear] = useState(thisYear);
  const [typeId, setTypeId] = useState<number | "">("");
  const [employeePk, setEmployeePk] = useState<number | "">("");
  const [paging, setPaging] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  useEffect(() => { setPaging((m) => (m.page === 0 ? m : { ...m, page: 0 })); }, [year, typeId, employeePk]);

  const { data: types = [] } = useQuery({ queryKey: ["hr", "leave-types"], queryFn: () => hrOrgApi.leaveTypes.list() });
  const { data: emps } = useQuery({ queryKey: ["hr", "employee-options"], queryFn: () => employeeCoreApi.paged({ size: 200, status: "live", sort_by: "name" }) });
  const params = (page: number, size: number) => ({ year, leave_type_id: typeId || undefined, employee_pk: employeePk || undefined, page: page + 1, size });
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["hr", "allocations", year, typeId, employeePk, paging.page, paging.pageSize],
    queryFn: () => leaveAllocationApi.list(params(paging.page, paging.pageSize)),
    placeholderData: keepPreviousData,
  });

  // In-flight guards so a double click can never submit twice
  const genRef = useRef(false);
  const lieuRef = useRef(false);
  const saveRef = useRef(false);

  // generate
  const [genOpen, setGenOpen] = useState(false);
  const [gen, setGen] = useState({ year: thisYear, carry_forward: true, overwrite: false });
  const generate = useMutation({
    mutationFn: () => leaveAllocationApi.generate(gen),
    onSuccess: (r) => { showSuccessToast(`Created ${r.created}, updated ${r.updated}, skipped ${r.skipped}`); setGenOpen(false); setYear(gen.year); qc.invalidateQueries({ queryKey: ["hr", "allocations"] }); },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to generate the allocations")),
  });
  const genValid = gen.year >= 2000 && gen.year <= 2100;
  const handleGenerate = () => {
    if (!genValid || generate.isPending || genRef.current) return;
    genRef.current = true;
    generate.mutate(undefined, { onSettled: () => { genRef.current = false; } });
  };

  // lieu leave
  const [lieu, setLieu] = useState<LieuForm | null>(null);
  const grantLieu = useMutation({
    mutationFn: (d: { employee_pk: number; worked_date: string; days: number; remarks?: string }) => lieuLeaveApi.grant(d),
    onSuccess: (r) => {
      showSuccessToast(`Lieu leave granted${r.balance != null ? ` — balance ${r.balance} day(s)` : ""}`);
      setLieu(null);
      qc.invalidateQueries({ queryKey: ["hr", "allocations"] });
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to grant lieu leave")),
  });
  const handleGrantLieu = () => {
    if (!lieu || !lieu.employee_pk || !lieu.worked_date || grantLieu.isPending || lieuRef.current) return;
    lieuRef.current = true;
    grantLieu.mutate(
      { employee_pk: Number(lieu.employee_pk), worked_date: lieu.worked_date, days: lieu.days, remarks: lieu.remarks.trim() || undefined },
      { onSettled: () => { lieuRef.current = false; } },
    );
  };

  // create / edit
  const [dialog, setDialog] = useState<{ edit: LeaveAllocation | null } | null>(null);
  const [f, setF] = useState({ employee_pk: "" as number | "", leave_type_id: "" as number | "", year: thisYear, allocated: "0", carried_forward: "0", adjustment: "0", remarks: "" });
  const save = useMutation({
    mutationFn: () => {
      const nums = { allocated: Number(f.allocated), carried_forward: Number(f.carried_forward), adjustment: Number(f.adjustment), remarks: f.remarks.trim() || null };
      return dialog?.edit
        ? leaveAllocationApi.update(dialog.edit.id, { ...nums, expected_version: dialog.edit.version ?? null })
        : leaveAllocationApi.create({ employee_pk: Number(f.employee_pk), leave_type_id: Number(f.leave_type_id), year: f.year, ...nums });
    },
    onSuccess: () => { showSuccessToast("Allocation saved"); setDialog(null); qc.invalidateQueries({ queryKey: ["hr", "allocations"] }); },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to save the allocation")),
  });
  const openEdit = useCallback((a: LeaveAllocation) => {
    if (!canUpdate) return;
    setF({ employee_pk: a.employee_pk, leave_type_id: a.leave_type_id, year: a.year, allocated: String(a.allocated), carried_forward: String(a.carried_forward), adjustment: String(a.adjustment), remarks: a.remarks ?? "" });
    setDialog({ edit: a });
  }, [canUpdate]);
  const numOk = (v: string, min = 0) => v.trim() !== "" && !Number.isNaN(Number(v)) && Number(v) >= min && Number(v) <= 366;
  const saveValid = (!!dialog?.edit || (!!f.employee_pk && !!f.leave_type_id)) && numOk(f.allocated) && numOk(f.carried_forward);
  const handleSave = () => {
    if (!saveValid || save.isPending || saveRef.current) return;
    saveRef.current = true;
    save.mutate(undefined, { onSettled: () => { saveRef.current = false; } });
  };

  const columns = useMemo<TDataGridColumn<LeaveAllocation>[]>(() => [
    { field: "employee_id", header: "Employee ID", width: 130 },
    { field: "employee_name", header: "Employee", flex: 1, minWidth: 180 },
    { field: "leave_type_name", header: "Leave type", width: 170 },
    { field: "allocated", header: "Entitled", width: 90, align: "right", headerAlign: "right" },
    { field: "carried_forward", header: "Carried", width: 90, align: "right", headerAlign: "right" },
    { field: "adjustment", header: "Adjusted", width: 90, align: "right", headerAlign: "right" },
    { field: "used", header: "Used", width: 80, align: "right", headerAlign: "right" },
    { field: "pending", header: "Pending", width: 90, align: "right", headerAlign: "right" },
    { field: "balance", header: "Balance", width: 100, align: "right", headerAlign: "right", renderCell: (p) => <b style={{ color: p.row.balance < 0 ? "#d32f2f" : undefined }}>{p.row.balance}</b> },
    ...(canUpdate ? [{
      field: "view", header: "", width: 56, sortable: false, align: "center", headerAlign: "center",
      renderCell: (p) => (
        <Tooltip title="Edit"><IconButton size="small" onClick={(e) => { e.stopPropagation(); openEdit(p.row); }}><OpenInNewIcon fontSize="small" color="action" /></IconButton></Tooltip>
      ),
    } as TDataGridColumn<LeaveAllocation>] : []),
  ], [canUpdate, openEdit]);

  const filtersSet = year !== thisYear || typeId !== "" || employeePk !== "";

  return (
    <>
      <MasterDetailLayout
        title="Leave Balances"
        icon={<EventAvailableIcon />}
        titleSlot={(
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <TextField size="small" type="number" placeholder="Year" value={year} onChange={(e) => setYear(Number(e.target.value) || thisYear)} inputProps={{ min: 2000, max: 2100, "aria-label": "Year" }}
              sx={{ width: 110, flexShrink: 0, "& .MuiOutlinedInput-root": { borderRadius: "24px" } }} />
            <Box sx={{ width: 190, flexShrink: 0 }}>
              <TStatusFilter
                options={[{ value: null, label: "All Leave Types" }, ...types.map((t) => ({ value: String(t.id), label: t.name }))]}
                value={typeId === "" ? null : String(typeId)} onChange={(v) => setTypeId(v ? Number(v) : "")}
                label="" placeholder="All Leave Types" size="small" />
            </Box>
            <Box sx={{ width: 240, flexShrink: 0 }}>
              <TStatusFilter
                options={[{ value: null, label: "All Employees" }, ...(emps?.items ?? []).map((e) => ({ value: String(e.id), label: `${e.full_name ?? e.employee_id} (${e.employee_id})` }))]}
                value={employeePk === "" ? null : String(employeePk)} onChange={(v) => setEmployeePk(v ? Number(v) : "")}
                label="" placeholder="All Employees" size="small" />
            </Box>
            {filtersSet && (
              <Button size="small" sx={{ textTransform: "none" }} onClick={() => { setYear(thisYear); setTypeId(""); setEmployeePk(""); }}>Clear</Button>
            )}
          </Box>
        )}
        headerActions={canCreate ? (
          <>
            <Button size="small" variant="outlined" startIcon={<AutoFixHighIcon />} sx={{ mr: 1, textTransform: "none" }} onClick={() => { setGen({ year, carry_forward: true, overwrite: false }); setGenOpen(true); }}>Generate for year</Button>
            <Button size="small" variant="outlined" sx={{ mr: 1, textTransform: "none" }} onClick={() => setLieu({ employee_pk: employeePk, worked_date: "", days: 1, remarks: "" })}>Grant lieu day</Button>
            <Button size="small" variant="contained" startIcon={<AddIcon />} sx={{ mr: 1 }} onClick={() => { setF({ employee_pk: employeePk, leave_type_id: typeId, year, allocated: "0", carried_forward: "0", adjustment: "0", remarks: "" }); setDialog({ edit: null }); }}>Add allocation</Button>
          </>
        ) : undefined}
        onRefresh={refetch}
        isLoading={isFetching}
      >
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", p: 1.5, gap: 1 }}>
          <Alert severity="info" sx={{ py: 0 }}>
            Employees without an allocation row for the year are given each leave type's yearly entitlement automatically (annual leave follows the
            Shop &amp; Office Act: none in the joining year, then 14/10/7/4 days by joining quarter). Use this page to generate rows with
            carry-forward, adjust one person, or grant a lieu day for work on a holiday or weekly off.
          </Alert>
          <Box sx={{ flex: 1, display: "flex", minHeight: 0 }}>
            <TDataGrid<LeaveAllocation>
              rows={data?.items ?? []} columns={columns} loading={isFetching} onRowClick={openEdit} emptyMessage="No allocations for these filters — use Generate for year"
              pageSizeOptions={[10, 25, 50, 100]} autoHeight={false} height="100%" exportFileName={`leave-balances-${year}`}
              serverPagination={{ rowCount: data?.total ?? 0, paginationModel: paging, onPaginationModelChange: setPaging }}
              exportAllRows={() => fetchAllPages((p) => leaveAllocationApi.list({ ...params(0, 200), page: p + 1, size: 200 }))}
            />
          </Box>
        </Box>
      </MasterDetailLayout>

      {/* ---- GRANT LIEU LEAVE ---- */}
      <TSidePanel
        open={!!lieu}
        onClose={() => { if (!grantLieu.isPending) setLieu(null); }}
        title="Grant Lieu Leave"
        submitText="Grant"
        isSubmitting={grantLieu.isPending}
        submitDisabled={grantLieu.isPending || !lieu?.employee_pk || !lieu?.worked_date}
        onSubmit={handleGrantLieu}
      >
        {lieu && (
          <FormSection title="Lieu Day" columns={1} isLast>
            <Typography variant="body2" color="text.secondary">
              For working on a holiday or weekly off. The employee needs attendance with working time on that day.
            </Typography>
            <TextField select size="small" fullWidth label="Employee" required value={lieu.employee_pk} onChange={(e) => setLieu({ ...lieu, employee_pk: Number(e.target.value) })}>
              {(emps?.items ?? []).map((e) => <MenuItem key={e.id} value={e.id}>{`${e.full_name ?? e.employee_id} (${e.employee_id})`}</MenuItem>)}
            </TextField>
            <TextField size="small" fullWidth label="Worked on" type="date" required InputLabelProps={{ shrink: true }} value={lieu.worked_date}
              inputProps={{ max: formatDate(new Date()) }} onChange={(e) => setLieu({ ...lieu, worked_date: e.target.value })} />
            <TextField select size="small" fullWidth label="Days" value={lieu.days} onChange={(e) => setLieu({ ...lieu, days: Number(e.target.value) })}>
              <MenuItem value={1}>1 day</MenuItem>
              <MenuItem value={0.5}>Half day</MenuItem>
            </TextField>
            <TextField size="small" fullWidth label="Remarks" value={lieu.remarks} inputProps={{ maxLength: 300 }} onChange={(e) => setLieu({ ...lieu, remarks: e.target.value })} />
          </FormSection>
        )}
      </TSidePanel>

      {/* ---- GENERATE ---- */}
      <TSidePanel
        open={genOpen}
        onClose={() => { if (!generate.isPending) setGenOpen(false); }}
        title="Generate Leave Allocations"
        submitText={generate.isPending ? "Generating..." : "Generate"}
        isSubmitting={generate.isPending}
        submitDisabled={generate.isPending || !genValid}
        onSubmit={handleGenerate}
      >
        <FormSection title="Generate" columns={1} isLast>
          <TextField size="small" fullWidth type="number" label="Year" value={gen.year} error={!genValid} inputProps={{ min: 2000, max: 2100 }} onChange={(e) => setGen({ ...gen, year: Number(e.target.value) })} />
          <FormControlLabel control={<Switch checked={gen.carry_forward} onChange={(e) => setGen({ ...gen, carry_forward: e.target.checked })} />} label="Carry forward unused days (up to each type's limit)" />
          <FormControlLabel control={<Switch checked={gen.overwrite} onChange={(e) => setGen({ ...gen, overwrite: e.target.checked })} />} label="Replace existing rows for this year" />
          <Typography variant="caption" color="text.secondary">
            Creates a row per employee in service and leave type, using the type's yearly days, its gender and service rules, and pro-rating for people who joined during the year. Manual adjustments are kept.
          </Typography>
        </FormSection>
      </TSidePanel>

      {/* ---- ADD / EDIT ALLOCATION ---- */}
      <TSidePanel
        open={!!dialog}
        onClose={() => { if (!save.isPending) setDialog(null); }}
        title={dialog?.edit ? "Edit Allocation" : "New Allocation"}
        submitText="Save"
        isSubmitting={save.isPending}
        submitDisabled={save.isPending || !saveValid}
        onSubmit={handleSave}
      >
        <FormSection title="Allocation" columns={2} isLast>
          <TextField select size="small" fullWidth label="Employee" required disabled={!!dialog?.edit} value={f.employee_pk} onChange={(e) => setF({ ...f, employee_pk: Number(e.target.value) })} sx={{ gridColumn: "1 / -1" }}>
            {(emps?.items ?? []).map((e) => <MenuItem key={e.id} value={e.id}>{e.full_name ?? e.employee_id} ({e.employee_id})</MenuItem>)}
          </TextField>
          <TextField select size="small" fullWidth label="Leave type" required disabled={!!dialog?.edit} value={f.leave_type_id} onChange={(e) => setF({ ...f, leave_type_id: Number(e.target.value) })}>
            {types.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
          </TextField>
          <TextField size="small" fullWidth type="number" label="Year" disabled={!!dialog?.edit} value={f.year} onChange={(e) => setF({ ...f, year: Number(e.target.value) })} />
          <TextField size="small" fullWidth type="number" label="Entitled days" required value={f.allocated} error={!numOk(f.allocated)} onChange={(e) => setF({ ...f, allocated: e.target.value })} inputProps={{ step: 0.5, min: 0, max: 366 }} />
          <TextField size="small" fullWidth type="number" label="Carried forward" value={f.carried_forward} error={!numOk(f.carried_forward)} onChange={(e) => setF({ ...f, carried_forward: e.target.value })} inputProps={{ step: 0.5, min: 0, max: 366 }} />
          <TextField size="small" fullWidth type="number" label="Adjustment (+/-)" value={f.adjustment} error={f.adjustment.trim() === "" || Number.isNaN(Number(f.adjustment))} onChange={(e) => setF({ ...f, adjustment: e.target.value })} inputProps={{ step: 0.5, min: -366, max: 366 }} />
          <TextField size="small" fullWidth label="Remarks" value={f.remarks} inputProps={{ maxLength: 500 }} onChange={(e) => setF({ ...f, remarks: e.target.value })} />
          {dialog?.edit && <Typography variant="caption" color="text.secondary" sx={{ gridColumn: "1 / -1" }}>Used {dialog.edit.used} · pending {dialog.edit.pending} · balance {dialog.edit.balance}</Typography>}
        </FormSection>
      </TSidePanel>
    </>
  );
}
