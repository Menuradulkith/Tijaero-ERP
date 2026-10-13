/**
 * Leave Balances — yearly leave entitlement per employee and leave type, with what has been used.
 * Entitlements can be generated for the whole company from the leave types (with carry-forward) and adjusted by hand.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Switch, TextField, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import type { GridPaginationModel } from "@mui/x-data-grid";
import { MasterDetailLayout, TDataGrid, type TDataGridColumn, handleApiError, showErrorToast, showSuccessToast } from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";
import { fetchAllPages } from "@/utils/fetchAllPages";
import { employeeCoreApi, hrOrgApi, leaveAllocationApi, type LeaveAllocation } from "@/modules/hr/core-api";

import CancelIcon from "@mui/icons-material/Cancel";
import SaveIcon from "@mui/icons-material/Save";
const thisYear = new Date().getFullYear();

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

  // generate
  const [genOpen, setGenOpen] = useState(false);
  const [gen, setGen] = useState({ year: thisYear, carry_forward: true, overwrite: false });
  const generate = useMutation({
    mutationFn: () => leaveAllocationApi.generate(gen),
    onSuccess: (r) => { showSuccessToast(`Created ${r.created}, updated ${r.updated}, skipped ${r.skipped}`); setGenOpen(false); setYear(gen.year); qc.invalidateQueries({ queryKey: ["hr", "allocations"] }); },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to generate the allocations")),
  });

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
  const openEdit = (a: LeaveAllocation) => {
    if (!canUpdate) return;
    setF({ employee_pk: a.employee_pk, leave_type_id: a.leave_type_id, year: a.year, allocated: String(a.allocated), carried_forward: String(a.carried_forward), adjustment: String(a.adjustment), remarks: a.remarks ?? "" });
    setDialog({ edit: a });
  };
  const numOk = (v: string, min = 0) => v.trim() !== "" && !Number.isNaN(Number(v)) && Number(v) >= min && Number(v) <= 366;

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
  ], []);

  return (
    <>
      <MasterDetailLayout
        title="Leave Balances"
        titleSlot={(
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1 }}>
            <TextField size="small" type="number" label="Year" value={year} onChange={(e) => setYear(Number(e.target.value) || thisYear)} sx={{ width: 100 }} inputProps={{ min: 2000, max: 2100 }} />
            <TextField select size="small" label="Leave type" value={typeId} onChange={(e) => setTypeId(e.target.value === "" ? "" : Number(e.target.value))} sx={{ width: 190 }}>
              <MenuItem value=""><em>All</em></MenuItem>{types.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Employee" value={employeePk} onChange={(e) => setEmployeePk(e.target.value === "" ? "" : Number(e.target.value))} sx={{ width: 230 }}>
              <MenuItem value=""><em>All</em></MenuItem>{(emps?.items ?? []).map((e) => <MenuItem key={e.id} value={e.id}>{e.full_name ?? e.employee_id} ({e.employee_id})</MenuItem>)}
            </TextField>
          </Box>
        )}
        headerActions={(
          <>
            {canCreate && <Button size="small" variant="outlined" startIcon={<AutoFixHighIcon />} sx={{ mr: 1, textTransform: "none" }} onClick={() => { setGen({ year, carry_forward: true, overwrite: false }); setGenOpen(true); }}>Generate for year</Button>}
            {canCreate && <Button size="small" variant="contained" startIcon={<AddIcon />} sx={{ mr: 1 }} onClick={() => { setF({ employee_pk: employeePk, leave_type_id: typeId, year, allocated: "0", carried_forward: "0", adjustment: "0", remarks: "" }); setDialog({ edit: null }); }}>Add allocation</Button>}
          </>
        )}
        onRefresh={refetch}
        isLoading={isFetching}
      >
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", p: 1.5, gap: 1 }}>
          <Alert severity="info" sx={{ py: 0 }}>
            Employees without an allocation row for the year are given each leave type's yearly entitlement automatically (pro-rated for new joiners). Use this page to generate rows with carry-forward or to adjust one person.
          </Alert>
          <Box sx={{ flex: 1, display: "flex", minHeight: 0 }}>
            <TDataGrid<LeaveAllocation>
              rows={data?.items ?? []} columns={columns} loading={isFetching} onRowClick={openEdit} emptyMessage="No allocations for these filters — use Generate for year"
              pageSizeOptions={[10, 25, 50, 100]} autoHeight={false} height="100%" exportFileName={`leave-balances-${year}`}
              serverPagination={{ rowCount: data?.total ?? 0, paginationModel: paging, onPaginationModelChange: setPaging }}
              exportAllRows={() => fetchAllPages((p) => leaveAllocationApi.list({ ...params(0, 200), page: p, size: 200 }))}
            />
          </Box>
        </Box>
      </MasterDetailLayout>

      <Dialog open={genOpen} onClose={() => setGenOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Generate leave allocations</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "grid", gap: 1.5, pt: 1 }}>
            <TextField size="small" type="number" label="Year" value={gen.year} inputProps={{ min: 2000, max: 2100 }} onChange={(e) => setGen({ ...gen, year: Number(e.target.value) })} />
            <FormControlLabel control={<Switch checked={gen.carry_forward} onChange={(e) => setGen({ ...gen, carry_forward: e.target.checked })} />} label="Carry forward unused days (up to each type's limit)" />
            <FormControlLabel control={<Switch checked={gen.overwrite} onChange={(e) => setGen({ ...gen, overwrite: e.target.checked })} />} label="Replace existing rows for this year" />
            <Typography variant="caption" color="text.secondary">
              Creates a row per employee in service and leave type, using the type's yearly days, its gender and service rules, and pro-rating for people who joined during the year. Manual adjustments are kept.
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" color="error" startIcon={<CancelIcon />} onClick={() => setGenOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={generate.isPending || gen.year < 2000 || gen.year > 2100} onClick={() => generate.mutate()}>{generate.isPending ? "Generating..." : "Generate"}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!dialog} onClose={() => setDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{dialog?.edit ? "Edit allocation" : "New allocation"}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5, pt: 1 }}>
            <TextField select size="small" label="Employee" required disabled={!!dialog?.edit} value={f.employee_pk} onChange={(e) => setF({ ...f, employee_pk: Number(e.target.value) })} sx={{ gridColumn: { sm: "1 / -1" } }}>
              {(emps?.items ?? []).map((e) => <MenuItem key={e.id} value={e.id}>{e.full_name ?? e.employee_id} ({e.employee_id})</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Leave type" required disabled={!!dialog?.edit} value={f.leave_type_id} onChange={(e) => setF({ ...f, leave_type_id: Number(e.target.value) })}>
              {types.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
            </TextField>
            <TextField size="small" type="number" label="Year" disabled={!!dialog?.edit} value={f.year} onChange={(e) => setF({ ...f, year: Number(e.target.value) })} />
            <TextField size="small" type="number" label="Entitled days" required value={f.allocated} error={!numOk(f.allocated)} onChange={(e) => setF({ ...f, allocated: e.target.value })} inputProps={{ step: 0.5, min: 0, max: 366 }} />
            <TextField size="small" type="number" label="Carried forward" value={f.carried_forward} error={!numOk(f.carried_forward)} onChange={(e) => setF({ ...f, carried_forward: e.target.value })} inputProps={{ step: 0.5, min: 0, max: 366 }} />
            <TextField size="small" type="number" label="Adjustment (+/-)" value={f.adjustment} error={f.adjustment.trim() === "" || Number.isNaN(Number(f.adjustment))} onChange={(e) => setF({ ...f, adjustment: e.target.value })} inputProps={{ step: 0.5, min: -366, max: 366 }} />
            <TextField size="small" label="Remarks" value={f.remarks} inputProps={{ maxLength: 500 }} onChange={(e) => setF({ ...f, remarks: e.target.value })} />
          </Box>
          {dialog?.edit && <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>Used {dialog.edit.used} · pending {dialog.edit.pending} · balance {dialog.edit.balance}</Typography>}
        </DialogContent>
        <DialogActions>
          <Button variant="contained" color="error" startIcon={<CancelIcon />} onClick={() => setDialog(null)}>Cancel</Button>
          <Button variant="contained" color="success" startIcon={<SaveIcon />} disabled={save.isPending || (!dialog?.edit && (!f.employee_pk || !f.leave_type_id)) || !numOk(f.allocated) || !numOk(f.carried_forward)} onClick={() => save.mutate()}>Save</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
