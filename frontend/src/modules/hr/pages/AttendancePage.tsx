/**
 * AttendancePage — Master/Detail layout matching Customers / Sales Orders pattern.
 * Left: searchable list of attendance records with status & branch filters.
 * Right: details + check-in/check-out actions and editable times.
 */
import { useCallback, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, Chip, MenuItem, TextField, Typography } from "@mui/material";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import LoginIcon from "@mui/icons-material/Login";
import LogoutIcon from "@mui/icons-material/Logout";
import { format } from "date-fns";

import {
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  FormSection,
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  SortOption,
  TButton,
  TConfirmDialog,
  TDetailSkeleton,
  TFilterPanel,
  TBranchFilter,
  TStatusFilter,
  type TFilterStatusOption,
  handleApiError,
  showErrorToast,
  showSuccessToast,
  useMasterDetailState,
  useTConfirmDialog,
} from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";
import { attendanceApi, employeesApi } from "@/modules/hr/api";
import { branchApi } from "@/modules/branches/api";
import type { Attendance, AttendanceCreate } from "@/modules/hr/types";
import { useState } from "react";

const SORT_OPTIONS: SortOption[] = [
  { value: "date_desc", label: "Date (Newest)" },
  { value: "date_asc", label: "Date (Oldest)" },
  { value: "employee_id", label: "Employee ID" },
];

const STATUS_OPTIONS: TFilterStatusOption[] = [
  { value: "present", label: "Present" },
  { value: "late", label: "Late" },
  { value: "absent", label: "Absent" },
  { value: "leave", label: "Leave" },
  { value: "half_day", label: "Half Day" },
];

const todayISO = () => new Date().toISOString().split("T")[0];

const INITIAL_FORM: AttendanceCreate = {
  employee_id: "",
  branch_code: "",
  date: todayISO(),
  check_in: "",
  check_out: "",
};

const statusColor = (s?: string): "success" | "warning" | "error" | "info" | "default" => {
  switch (s) {
    case "present": return "success";
    case "late": return "warning";
    case "absent": return "error";
    case "leave": return "info";
    default: return "default";
  }
};

const minutesToHours = (m: number) => (m / 60).toFixed(2);

export default function AttendancePage() {
  const qc = useQueryClient();
  const canCreate = usePermission("attendance", "create");
  const canUpdate = usePermission("attendance", "update");
  const canDelete = usePermission("attendance", "delete");

  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [dateFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  });
  const [dateTo] = useState<string>(todayISO());

  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem: selectedAttendance,
    isEditing,
    isCreating,
    setIsCreating,
    setIsEditing,
    formData,
    setFormData,
    handleSelectItem,
    handleNew,
    handleCancel: baseCancel,
    handleStartEdit,
  } = useMasterDetailState<Attendance, AttendanceCreate>({
    initialFormData: INITIAL_FORM,
    resetFormFromItem: (a) => ({
      employee_id: a.employee_id,
      branch_code: a.branch_code,
      date: a.date,
      check_in: a.check_in || "",
      check_out: a.check_out || "",
      work_mins: a.work_mins,
      ot_mins: a.ot_mins,
      late_mins: a.late_mins,
      early_mins: a.early_mins,
      absent_mins: a.absent_mins,
      leave_mins: a.leave_mins,
    }),
    defaultSortField: "date_desc",
  });

  const { data: attendances, isLoading, refetch } = useQuery({
    queryKey: ["hr-attendance", dateFrom, dateTo],
    queryFn: () => attendanceApi.getAll({ date_from: dateFrom, date_to: dateTo, limit: 500 }),
  });

  const { data: employees } = useQuery({
    queryKey: ["hr-employees-light"],
    queryFn: () => employeesApi.getAll({ limit: 500 }),
  });

  const { data: branches } = useQuery({
    queryKey: ["branches-light"],
    queryFn: async () => (await branchApi.getAll(1, 200)).items,
  });

  const branchOptions = useMemo(
    () => (branches || []).map((b) => ({ branch_code: b.branch_code, branch_name: b.branch_name })),
    [branches]
  );

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    let list = (attendances || []).filter((a) => {
      if (filterStatus && a.status !== filterStatus) return false;
      if (filterBranch && a.branch_code !== filterBranch) return false;
      if (!q) return true;
      return (
        a.employee_id.toLowerCase().includes(q) ||
        (a.employee_name || "").toLowerCase().includes(q) ||
        a.date.includes(q)
      );
    });
    list.sort((a, b) => {
      if (sortField === "date_asc") return a.date.localeCompare(b.date);
      if (sortField === "employee_id") return a.employee_id.localeCompare(b.employee_id);
      return b.date.localeCompare(a.date);
    });
    return list;
  }, [attendances, searchQuery, sortField, filterStatus, filterBranch]);

  useEffect(() => {
    if (filtered.length > 0 && !selectedAttendance && !isCreating) {
      handleSelectItem(filtered[0]);
    }
  }, [filtered, selectedAttendance, isCreating, handleSelectItem]);

  const createMutation = useMutation({
    mutationFn: (d: AttendanceCreate) => attendanceApi.create(d),
    onSuccess: (rec) => {
      qc.invalidateQueries({ queryKey: ["hr-attendance"] });
      showSuccessToast("Attendance created");
      setIsCreating(false);
      setIsEditing(false);
      setTimeout(() => handleSelectItem(rec), 0);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to create attendance")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<AttendanceCreate> }) =>
      attendanceApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr-attendance"] });
      showSuccessToast("Attendance updated");
      setIsEditing(false);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to update attendance")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => attendanceApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr-attendance"] });
      showSuccessToast("Attendance deleted");
      baseCancel(filtered);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to delete attendance")),
  });

  const checkInMutation = useMutation({
    mutationFn: () =>
      attendanceApi.checkIn({
        employee_id: formData.employee_id,
        branch_code: formData.branch_code,
      }),
    onSuccess: (rec) => {
      qc.invalidateQueries({ queryKey: ["hr-attendance"] });
      showSuccessToast("Checked in successfully");
      setTimeout(() => handleSelectItem(rec), 0);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Check-in failed")),
  });

  const checkOutMutation = useMutation({
    mutationFn: () =>
      attendanceApi.checkOut({ employee_id: selectedAttendance?.employee_id || formData.employee_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr-attendance"] });
      showSuccessToast("Checked out successfully");
    },
    onError: (e) => showErrorToast(handleApiError(e, "Check-out failed")),
  });

  const confirmDialog = useTConfirmDialog();

  const handleSave = useCallback(() => {
    if (isCreating) createMutation.mutate(formData);
    else if (selectedAttendance) updateMutation.mutate({ id: selectedAttendance.id, data: formData });
  }, [isCreating, selectedAttendance, formData, createMutation, updateMutation]);

  const handleDelete = useCallback(async () => {
    if (!selectedAttendance) return;
    const ok = await confirmDialog.confirm({
      title: "Delete Attendance",
      message: `Delete attendance for ${selectedAttendance.employee_id} on ${selectedAttendance.date}?`,
      confirmText: "Delete",
      confirmColor: "error",
    });
    if (ok) deleteMutation.mutate(selectedAttendance.id);
  }, [selectedAttendance, deleteMutation, confirmDialog]);

  const isFormValid = !!formData.employee_id && !!formData.branch_code && !!formData.date;
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDisabled = !isEditing && !isCreating;

  const masterPanel = (
    <SearchableList<Attendance>
      items={filtered}
      isLoading={isLoading}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search by employee, date..."
      sortOptions={SORT_OPTIONS}
      currentSort={sortField}
      onSortChange={setSortField}
      selectedItem={selectedAttendance}
      onSelectItem={handleSelectItem}
      emptyMessage="No attendance records found"
      listHeader={
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, p: 1.5, pb: 0 }}>
          <TFilterPanel>
            <TStatusFilter
              options={STATUS_OPTIONS}
              value={filterStatus}
              onChange={setFilterStatus}
            />
            <TBranchFilter
              branches={branchOptions}
              value={filterBranch}
              onChange={setFilterBranch}
            />
          </TFilterPanel>
        </Box>
      }
      renderItem={(att, isSelected) => (
        <SelectableListItem
          key={att.id}
          id={att.id}
          isSelected={isSelected}
          onClick={() => handleSelectItem(att)}
          primaryText={
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{att.employee_name || att.employee_id}</span>
                <Chip
                  label={att.status || "—"}
                  size="small"
                  color={statusColor(att.status) as any}
                  sx={{ height: 18, fontSize: "0.65rem" }}
                />
              </Box>
              <Typography component="span" variant="caption" sx={{ color: isSelected ? "inherit" : "text.secondary" }}>
                {format(new Date(att.date), "MMM dd, yyyy")} • {att.employee_id}
              </Typography>
            </Box>
          }
          secondaryText={
            !isSelected
              ? `In: ${att.check_in ? format(new Date(att.check_in), "HH:mm") : "—"} • Out: ${att.check_out ? format(new Date(att.check_out), "HH:mm") : "—"}`
              : undefined
          }
        />
      )}
    />
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "HR", href: "/hr" },
          { label: "Attendance", href: "/hr/attendance" },
          ...(selectedAttendance || isCreating
            ? [{ label: isCreating ? "New Attendance" : `${selectedAttendance?.employee_id} - ${selectedAttendance?.date}` }]
            : []),
        ]}
        title={
          selectedAttendance
            ? `${selectedAttendance.employee_name || selectedAttendance.employee_id} • ${format(new Date(selectedAttendance.date), "MMM dd, yyyy")}`
            : ""
        }
        titleIcon={<AccessTimeIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Attendance"
        noSelectionTitle="Select an Attendance Record"
        chips={
          selectedAttendance && !isCreating
            ? [{ label: selectedAttendance.status || "—", color: statusColor(selectedAttendance.status) }]
            : []
        }
      />

      <ActionToolbar
        canCreate={canCreate}
        canUpdate={canUpdate}
        canDelete={canDelete}
        hasSelectedItem={!!selectedAttendance}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={isFormValid}
        onNew={handleNew}
        onDelete={handleDelete}
        onSave={handleSave}
        onCancel={() => baseCancel(filtered)}
        onEdit={handleStartEdit}
        endActions={
          isCreating ? (
            <TButton
              size="small"
              variant="outlined"
              startIcon={<LoginIcon />}
              onClick={() => checkInMutation.mutate()}
              disabled={!formData.employee_id || !formData.branch_code || checkInMutation.isPending}
            >
              Check In
            </TButton>
          ) : selectedAttendance && !selectedAttendance.check_out && !isEditing ? (
            <TButton
              size="small"
              variant="outlined"
              startIcon={<LogoutIcon />}
              onClick={() => checkOutMutation.mutate()}
              disabled={checkOutMutation.isPending}
            >
              Check Out
            </TButton>
          ) : undefined
        }
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedAttendance && !isCreating ? (
          <EmptyState message="Select an attendance record from the list or create a new one" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} />
        ) : (
          <>
            <FormSection title="Attendance Details" columns={3}>
              <TextField
                label="Employee"
                size="small"
                select
                value={formData.employee_id}
                onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                disabled={isDisabled || !isCreating}
                required
              >
                {(employees || []).map((emp) => (
                  <MenuItem key={emp.id} value={emp.employee_id}>
                    {emp.employee_id}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Branch"
                size="small"
                select
                value={formData.branch_code}
                onChange={(e) => setFormData({ ...formData, branch_code: e.target.value })}
                disabled={isDisabled || !isCreating}
                required
              >
                {(branches || []).map((b) => (
                  <MenuItem key={b.branch_code} value={b.branch_code}>
                    {b.branch_name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Date"
                size="small"
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                disabled={isDisabled || !isCreating}
                InputLabelProps={{ shrink: true }}
                required
              />
              <TextField
                label="Check In"
                size="small"
                type="datetime-local"
                value={formData.check_in || ""}
                onChange={(e) => setFormData({ ...formData, check_in: e.target.value })}
                disabled={isDisabled}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="Check Out"
                size="small"
                type="datetime-local"
                value={formData.check_out || ""}
                onChange={(e) => setFormData({ ...formData, check_out: e.target.value })}
                disabled={isDisabled}
                InputLabelProps={{ shrink: true }}
              />
              <Box />
            </FormSection>

            {selectedAttendance && !isCreating && (
              <FormSection title="Time Summary" columns={3}>
                <Box>
                  <Typography variant="caption" color="text.secondary">Work Hours</Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {minutesToHours(selectedAttendance.work_mins)} hrs
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Overtime</Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {minutesToHours(selectedAttendance.ot_mins)} hrs
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Late</Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {selectedAttendance.late_mins} min
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Early Out</Typography>
                  <Typography variant="body2">{selectedAttendance.early_mins} min</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Absent</Typography>
                  <Typography variant="body2">{selectedAttendance.absent_mins} min</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Leave</Typography>
                  <Typography variant="body2">{selectedAttendance.leave_mins} min</Typography>
                </Box>
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
        title="Attendance"
        onRefresh={refetch}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
