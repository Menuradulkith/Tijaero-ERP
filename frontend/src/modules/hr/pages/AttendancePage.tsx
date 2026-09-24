/**
 * AttendancePage — Browse table + single-record detail toggle.
 * Browse mode: a full-width table of every attendance record.
 * Detail mode: the record's detail form (unchanged), full-width, with a
 * "Back to Attendance" link returning to the table.
 */
import { useCallback, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, Box, Button, Chip, IconButton, InputAdornment, MenuItem, Paper, TextField, Tooltip, Typography } from "@mui/material";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import LoginIcon from "@mui/icons-material/Login";
import LogoutIcon from "@mui/icons-material/Logout";
import DownloadIcon from "@mui/icons-material/FileDownload";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { format } from "date-fns";
import { exportToCSV } from "@/utils/csvExport";

import {
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  FormSection,
  MasterDetailLayout,
  SelectableListItem,
  TButton,
  TConfirmDialog,
  TDetailSkeleton,
  TBranchFilter,
  TStatusFilter,
  type TFilterStatusOption,
  TDataGrid,
  type TDataGridColumn,
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
    selectedItem: selectedAttendance,
    setSelectedItem,
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

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterStatus(null);
    setFilterBranch(null);
  }, [setSearchQuery]);

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
    // Default order before the user sorts a column in the table itself
    // (the table's own column-header sort takes over from there).
    list.sort((a, b) => b.date.localeCompare(a.date));
    return list;
  }, [attendances, searchQuery, filterStatus, filterBranch]);

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
      setSelectedItem(null);
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

  const handleExportCSV = () => {
    const headers = [
      "Employee ID",
      "Employee Name",
      "Date",
      "Check In",
      "Check Out",
      "Status",
      "Work Hours",
      "Overtime Hours",
      "Late Minutes",
      "Early Out Minutes",
      "Absent Minutes",
      "Leave Minutes",
    ];

    const rows = filtered.map((att) => [
      att.employee_id,
      att.employee_name || "",
      att.date,
      att.check_in ? format(new Date(att.check_in), "yyyy-MM-dd HH:mm:ss") : "",
      att.check_out ? format(new Date(att.check_out), "yyyy-MM-dd HH:mm:ss") : "",
      att.status || "",
      minutesToHours(att.work_mins),
      minutesToHours(att.ot_mins),
      att.late_mins,
      att.early_mins,
      att.absent_mins,
      att.leave_mins,
    ]);

    exportToCSV({
      filename: `attendance_${new Date().toISOString().split("T")[0]}`,
      headers,
      rows,
    });
  };

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

  // Cancelling out of "New Attendance" should return to the browse table,
  // not auto-open the first record the way useMasterDetailState's generic
  // handleCancel does (that behavior made sense for the old always-visible
  // detail panel, but not here). Cancelling out of editing an existing
  // record still just reverts its form, which the generic handler already
  // does correctly.
  const handleCancelAttendance = useCallback(() => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedItem(null);
    } else {
      baseCancel(filtered);
    }
  }, [isCreating, filtered, baseCancel, setIsCreating, setIsEditing, setSelectedItem]);

  // Returns to the browse table from the detail view.
  const handleBackToAttendance = useCallback(() => {
    setSelectedItem(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [isCreating, setSelectedItem, setIsCreating, setIsEditing]);

  const isFormValid = !!formData.employee_id && !!formData.branch_code && !!formData.date;
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDisabled = !isEditing && !isCreating;

  // Whether we're showing a single attendance record's detail view
  // (selected or being created) instead of the browse table.
  const isAttendanceDetailMode = !!selectedAttendance || isCreating;

  // The table sorts by whichever column the user clicks via the grid's own
  // column-header menu, not a separate "Sort by" control.
  const attendanceColumns: TDataGridColumn<Attendance>[] = useMemo(
    () => [
      {
        field: "employee_name",
        header: "Employee",
        flex: 1,
        minWidth: 160,
        renderCell: (params: GridRenderCellParams<Attendance>) =>
          params.row.employee_name || params.row.employee_id,
      },
      {
        field: "date",
        header: "Date",
        width: 130,
        renderCell: (params: GridRenderCellParams<Attendance>) =>
          format(new Date(params.row.date), "MMM dd, yyyy"),
      },
      {
        field: "check_in",
        header: "Check-in",
        width: 110,
        renderCell: (params: GridRenderCellParams<Attendance>) =>
          params.row.check_in ? format(new Date(params.row.check_in), "HH:mm") : "—",
      },
      {
        field: "check_out",
        header: "Check-out",
        width: 110,
        renderCell: (params: GridRenderCellParams<Attendance>) =>
          params.row.check_out ? format(new Date(params.row.check_out), "HH:mm") : "—",
      },
      {
        field: "work_mins",
        header: "Hours",
        width: 100,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<Attendance>) => minutesToHours(params.row.work_mins),
      },
      {
        field: "status",
        header: "Status",
        width: 120,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<Attendance>) => (
          <Chip
            label={params.row.status || "—"}
            size="small"
            color={statusColor(params.row.status) as any}
          />
        ),
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<Attendance>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectItem(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [handleSelectItem]
  );

  // Browse mode: a full-width table of every attendance record.
  const attendanceTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<Attendance>
          rows={filtered}
          columns={attendanceColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectItem(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No attendance records found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Detail mode: a narrow left panel showing only the current attendance
  // record (or the "New Attendance" placeholder while creating) plus a
  // "Back to Attendance" link that returns to the table.
  const singleAttendancePanel = (
    <Paper
      elevation={0}
      sx={{
        width: 280,
        minWidth: 240,
        maxWidth: 300,
        borderRight: 1,
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <Box sx={{ p: 1, borderBottom: 1, borderColor: "divider" }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon fontSize="small" />}
          onClick={handleBackToAttendance}
          sx={{ textTransform: "none" }}
        >
          Back to Attendance
        </Button>
      </Box>
      {isCreating ? (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ bgcolor: "action.disabledBackground" }}>
              <AccessTimeIcon color="primary" />
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              New Attendance
            </Typography>
          </Box>
        </Box>
      ) : selectedAttendance && (
        <SelectableListItem
          id={selectedAttendance.id}
          isSelected
          onClick={() => {}}
          primaryText={
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
              <Avatar sx={{ bgcolor: "action.disabledBackground" }}>
                <AccessTimeIcon color="primary" />
              </Avatar>
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0 }}>
                <span>
                  {selectedAttendance.employee_name || selectedAttendance.employee_id} •{" "}
                  {format(new Date(selectedAttendance.date), "MMM dd, yyyy")}
                </span>
              </Box>
            </Box>
          }
        />
      )}
    </Paper>
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
        onCancel={handleCancelAttendance}
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
        titleSlot={
          isAttendanceDetailMode ? undefined : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search by employee, date..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                }}
                sx={{ width: 220, flexShrink: 0 }}
              />
              <Box sx={{ width: 150, flexShrink: 0 }}>
                <TStatusFilter
                  options={STATUS_OPTIONS}
                  value={filterStatus}
                  onChange={setFilterStatus}
                  label=""
                  placeholder="All Status"
                  size="small"
                />
              </Box>
              <Box sx={{ width: 170, flexShrink: 0 }}>
                <TBranchFilter
                  branches={branchOptions}
                  value={filterBranch}
                  onChange={setFilterBranch}
                  label=""
                  placeholder="All Branches"
                  size="small"
                />
              </Box>
              {(searchQuery || filterStatus || filterBranch) && (
                <Tooltip title="Clear filters">
                  <IconButton size="small" onClick={handleClearFilters}>
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          )
        }
        headerActions={
          isAttendanceDetailMode ? undefined : (
            <>
              {canCreate && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={handleNew}
                  sx={{ mr: 1 }}
                >
                  Add Attendance
                </Button>
              )}
              <Button
                variant="outlined"
                size="small"
                startIcon={<DownloadIcon />}
                onClick={handleExportCSV}
                disabled={filtered.length === 0}
                sx={{ mr: 1 }}
              >
                Export CSV
              </Button>
            </>
          )
        }
        onRefresh={refetch}
        isLoading={isLoading}
        {...(isAttendanceDetailMode
          ? { masterPanel: singleAttendancePanel, detailPanel }
          : { children: attendanceTablePanel })}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
