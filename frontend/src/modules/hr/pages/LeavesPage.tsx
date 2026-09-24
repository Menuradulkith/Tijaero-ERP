/**
 * LeavesPage — Browse table + single-record detail toggle.
 * Browse mode: a full-width table of every leave application.
 * Detail mode: the record's detail form (unchanged), full-width, with a
 * "Back to Leaves" link returning to the table.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, Box, Button, Chip, IconButton, InputAdornment, MenuItem, Paper, TextField, Tooltip, Typography } from "@mui/material";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { format } from "date-fns";

import {
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  FormSection,
  MasterDetailLayout,
  SelectableListItem,
  TConfirmDialog,
  TDetailSkeleton,
  TExportButton,
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
import { leavesApi, employeesApi } from "@/modules/hr/api";
import type { Leave, LeaveCreate } from "@/modules/hr/types";

const STATUS_OPTIONS: TFilterStatusOption[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const LEAVE_TYPES = [
  { value: "annual", label: "Annual" },
  { value: "casual", label: "Casual" },
  { value: "medical", label: "Medical" },
  { value: "unpaid", label: "Unpaid" },
];

const LEAVE_TIMES = [
  { value: "full_day", label: "Full Day" },
  { value: "first_half", label: "First Half" },
  { value: "second_half", label: "Second Half" },
];

const INITIAL_FORM: LeaveCreate = {
  employee_id: "",
  leave_type: "annual",
  from_date: new Date().toISOString().split("T")[0],
  to_date: new Date().toISOString().split("T")[0],
  leave_reason: "",
  leave_duration: 1,
  leave_time: "full_day",
};

const computeDays = (from: string, to: string): number => {
  if (!from || !to) return 0;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (b < a) return 0;
  return Math.round((b - a) / (1000 * 60 * 60 * 24)) + 1;
};

const statusColor = (s: string): "success" | "warning" | "error" | "default" => {
  switch (s) {
    case "approved": return "success";
    case "pending": return "warning";
    case "rejected": return "error";
    default: return "default";
  }
};

export default function LeavesPage() {
  const qc = useQueryClient();
  const canCreate = usePermission("leaves", "create");
  const canUpdate = usePermission("leaves", "update");
  const canDelete = usePermission("leaves", "delete");

  // Filter state (applied - drives the actual list filtering)
  const [filterStatus, setFilterStatus] = useState<string | null>(null);

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterStatus(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const {
    searchQuery,
    setSearchQuery,
    selectedItem: selectedLeave,
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
  } = useMasterDetailState<Leave, LeaveCreate>({
    initialFormData: INITIAL_FORM,
    resetFormFromItem: (l) => ({
      employee_id: l.employee_id,
      leave_type: l.leave_type,
      from_date: l.from_date,
      to_date: l.to_date,
      leave_reason: l.leave_reason,
      leave_duration: l.leave_duration,
      leave_time: l.leave_time,
    }),
    defaultSortField: "created_desc",
  });

  const { data: leaves, isLoading, refetch } = useQuery({
    queryKey: ["hr-leaves"],
    queryFn: () => leavesApi.getAll({ limit: 500 }),
  });

  const { data: employees } = useQuery({
    queryKey: ["hr-employees-light"],
    queryFn: () => employeesApi.getAll({ limit: 500 }),
  });

  const { data: balance } = useQuery({
    queryKey: ["leave-balance", formData.employee_id],
    queryFn: () => leavesApi.balance(formData.employee_id),
    enabled: !!formData.employee_id && (isCreating || isEditing),
  });

  // Sync computed days
  useEffect(() => {
    if (isCreating || isEditing) {
      const d = computeDays(formData.from_date, formData.to_date);
      if (d !== formData.leave_duration) {
        setFormData({ ...formData, leave_duration: d });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.from_date, formData.to_date, isCreating, isEditing]);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    let list = (leaves || []).filter((l) => {
      if (filterStatus && l.status !== filterStatus) return false;
      if (!q) return true;
      return (
        l.employee_id.toLowerCase().includes(q) ||
        (l.employee_name || "").toLowerCase().includes(q) ||
        l.leave_type.toLowerCase().includes(q) ||
        l.leave_reason.toLowerCase().includes(q)
      );
    });
    // Default order before the user sorts a column in the table itself
    // (the table's own column-header sort takes over from there).
    list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    return list;
  }, [leaves, searchQuery, filterStatus]);

  const createMutation = useMutation({
    mutationFn: (d: LeaveCreate) => leavesApi.create(d),
    onSuccess: (rec) => {
      qc.invalidateQueries({ queryKey: ["hr-leaves"] });
      showSuccessToast("Leave application submitted");
      setIsCreating(false);
      setIsEditing(false);
      setTimeout(() => handleSelectItem(rec), 0);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to submit leave")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<LeaveCreate> }) =>
      leavesApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr-leaves"] });
      showSuccessToast("Leave updated");
      setIsEditing(false);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to update leave")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => leavesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr-leaves"] });
      showSuccessToast("Leave application cancelled");
      setSelectedItem(null);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to cancel leave")),
  });

  const confirmDialog = useTConfirmDialog();

  const handleSave = useCallback(() => {
    if (isCreating) createMutation.mutate(formData);
    else if (selectedLeave) updateMutation.mutate({ id: selectedLeave.id, data: formData });
  }, [isCreating, selectedLeave, formData, createMutation, updateMutation]);

  const handleDelete = useCallback(async () => {
    if (!selectedLeave) return;
    const ok = await confirmDialog.confirm({
      title: "Cancel Leave",
      message: `Cancel ${selectedLeave.leave_type} leave for ${selectedLeave.employee_id}?`,
      confirmText: "Cancel Leave",
      confirmColor: "error",
    });
    if (ok) deleteMutation.mutate(selectedLeave.id);
  }, [selectedLeave, deleteMutation, confirmDialog]);

  // Cancelling out of "Apply for Leave" should return to the browse table,
  // not auto-open the first record the way useMasterDetailState's generic
  // handleCancel does (that behavior made sense for the old always-visible
  // detail panel, but not here). Cancelling out of editing an existing
  // record still just reverts its form, which the generic handler already
  // does correctly.
  const handleCancelLeave = useCallback(() => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedItem(null);
    } else {
      baseCancel(filtered);
    }
  }, [isCreating, filtered, baseCancel, setIsCreating, setIsEditing, setSelectedItem]);

  // Returns to the browse table from the detail view.
  const handleBackToLeaves = useCallback(() => {
    setSelectedItem(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [isCreating, setSelectedItem, setIsCreating, setIsEditing]);

  const isFormValid =
    !!formData.employee_id && !!formData.from_date && !!formData.to_date && !!formData.leave_reason;
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDisabled = !isEditing && !isCreating;
  const canEditSelected = selectedLeave?.status === "pending";

  // Whether we're showing a single leave's detail view (selected or being
  // created) instead of the browse table.
  const isLeaveDetailMode = !!selectedLeave || isCreating;

  // The table sorts by whichever column the user clicks via the grid's own
  // column-header menu, not a separate "Sort by" control.
  const leaveColumns: TDataGridColumn<Leave>[] = useMemo(
    () => [
      {
        field: "employee_name",
        header: "Employee",
        flex: 1,
        minWidth: 160,
        renderCell: (params: GridRenderCellParams<Leave>) =>
          params.row.employee_name || params.row.employee_id,
      },
      {
        field: "leave_type",
        header: "Leave Type",
        width: 130,
        renderCell: (params: GridRenderCellParams<Leave>) => params.row.leave_type.toUpperCase(),
      },
      {
        field: "from_date",
        header: "From",
        width: 120,
        renderCell: (params: GridRenderCellParams<Leave>) =>
          format(new Date(params.row.from_date), "MMM dd, yyyy"),
      },
      {
        field: "to_date",
        header: "To",
        width: 120,
        renderCell: (params: GridRenderCellParams<Leave>) =>
          format(new Date(params.row.to_date), "MMM dd, yyyy"),
      },
      {
        field: "leave_duration",
        header: "Days",
        width: 90,
        align: "right",
        headerAlign: "right",
      },
      {
        field: "status",
        header: "Status",
        width: 120,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<Leave>) => (
          <Chip
            label={params.row.status}
            size="small"
            color={statusColor(params.row.status) as any}
            sx={{ textTransform: "capitalize" }}
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
        renderCell: (params: GridRenderCellParams<Leave>) => (
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

  // Browse mode: a full-width table of every leave application.
  const leaveTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<Leave>
          rows={filtered}
          columns={leaveColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectItem(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No leave applications found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Detail mode: a narrow left panel showing only the current leave
  // application (or the "Apply for Leave" placeholder while creating) plus a
  // "Back to Leaves" link that returns to the table.
  const singleLeavePanel = (
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
          onClick={handleBackToLeaves}
          sx={{ textTransform: "none" }}
        >
          Back to Leaves
        </Button>
      </Box>
      {isCreating ? (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ bgcolor: "action.disabledBackground" }}>
              <EventAvailableIcon color="primary" />
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              Apply for Leave
            </Typography>
          </Box>
        </Box>
      ) : selectedLeave && (
        <SelectableListItem
          id={selectedLeave.id}
          isSelected
          onClick={() => {}}
          primaryText={
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
              <Avatar sx={{ bgcolor: "action.disabledBackground" }}>
                <EventAvailableIcon color="primary" />
              </Avatar>
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0 }}>
                <span>
                  {selectedLeave.leave_type.toUpperCase()} •{" "}
                  {selectedLeave.employee_name || selectedLeave.employee_id}
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
          { label: "Leaves", href: "/hr/leaves" },
          ...(selectedLeave || isCreating
            ? [{ label: isCreating ? "Apply Leave" : `LV-${selectedLeave?.id}` }]
            : []),
        ]}
        title={
          selectedLeave
            ? `${selectedLeave.leave_type.toUpperCase()} • ${selectedLeave.employee_name || selectedLeave.employee_id}`
            : ""
        }
        titleIcon={<EventAvailableIcon color="primary" />}
        isCreating={isCreating}
        createTitle="Apply for Leave"
        noSelectionTitle="Select a Leave Application"
        chips={
          selectedLeave && !isCreating
            ? [{ label: selectedLeave.status, color: statusColor(selectedLeave.status) }]
            : []
        }
      />

      <ActionToolbar
        canCreate={canCreate}
        canUpdate={canUpdate && canEditSelected}
        canDelete={canDelete && canEditSelected}
        hasSelectedItem={!!selectedLeave}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={isFormValid}
        onNew={handleNew}
        onDelete={handleDelete}
        onSave={handleSave}
        onCancel={handleCancelLeave}
        onEdit={handleStartEdit}
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedLeave && !isCreating ? (
          <EmptyState message="Select a leave application from the list or create a new one" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} />
        ) : (
          <>
            <FormSection title="Leave Application" columns={3}>
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
                label="Leave Type"
                size="small"
                select
                value={formData.leave_type}
                onChange={(e) => setFormData({ ...formData, leave_type: e.target.value })}
                disabled={isDisabled}
                required
              >
                {LEAVE_TYPES.map((t) => (
                  <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
                ))}
              </TextField>
              <TextField
                label="Leave Time"
                size="small"
                select
                value={formData.leave_time || "full_day"}
                onChange={(e) => setFormData({ ...formData, leave_time: e.target.value })}
                disabled={isDisabled}
              >
                {LEAVE_TIMES.map((t) => (
                  <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
                ))}
              </TextField>
              <TextField
                label="From Date"
                size="small"
                type="date"
                value={formData.from_date}
                onChange={(e) => setFormData({ ...formData, from_date: e.target.value })}
                disabled={isDisabled}
                InputLabelProps={{ shrink: true }}
                required
              />
              <TextField
                label="To Date"
                size="small"
                type="date"
                value={formData.to_date}
                onChange={(e) => setFormData({ ...formData, to_date: e.target.value })}
                disabled={isDisabled}
                InputLabelProps={{ shrink: true }}
                required
              />
              <TextField
                label="Days"
                size="small"
                type="number"
                value={formData.leave_duration}
                disabled
                InputLabelProps={{ shrink: true }}
              />
              <Box sx={{ gridColumn: "1 / -1" }}>
                <TextField
                  label="Reason"
                  size="small"
                  value={formData.leave_reason}
                  onChange={(e) => setFormData({ ...formData, leave_reason: e.target.value })}
                  disabled={isDisabled}
                  fullWidth
                  multiline
                  rows={2}
                  required
                />
              </Box>
            </FormSection>

            {balance && (isCreating || isEditing) && (
              <FormSection title={`Leave Balance (${balance.year})`} columns={3}>
                <Box>
                  <Typography variant="caption" color="text.secondary">Annual</Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {balance.annual_remaining} / {balance.annual_total}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Casual</Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {balance.casual_remaining} / {balance.casual_total}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Medical</Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {balance.medical_remaining} / {balance.medical_total}
                  </Typography>
                </Box>
              </FormSection>
            )}

            {selectedLeave && !isCreating && selectedLeave.status === "rejected" && selectedLeave.rejection_reason && (
              <FormSection title="Rejection Details" columns={1}>
                <Box>
                  <Typography variant="caption" color="text.secondary">Reason</Typography>
                  <Typography variant="body2">{selectedLeave.rejection_reason}</Typography>
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
        title="Leaves"
        titleSlot={
          isLeaveDetailMode ? undefined : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search by employee, type, reason..."
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
              {(searchQuery || filterStatus) && (
                <Tooltip title="Clear filters">
                  <IconButton size="small" onClick={handleClearFilters}>
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          )
        }
        onRefresh={refetch}
        isLoading={isLoading}
        {...(isLeaveDetailMode
          ? { masterPanel: singleLeavePanel, detailPanel }
          : { children: leaveTablePanel })}
        headerActions={
          isLeaveDetailMode ? undefined : (
            <>
              {canCreate && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={handleNew}
                  sx={{ mr: 1 }}
                >
                  Apply for Leave
                </Button>
              )}
              <TExportButton
                filename="leaves"
                headers={[
                  "Employee ID",
                  "Employee",
                  "Leave Type",
                  "From Date",
                  "To Date",
                  "Duration",
                  "Time",
                  "Status",
                  "Reason",
                ]}
                rows={() =>
                  filtered.map((l) => [
                    l.employee_id || "",
                    l.employee_name || "",
                    l.leave_type || "",
                    l.from_date || "",
                    l.to_date || "",
                    l.leave_duration ?? "",
                    l.leave_time || "",
                    l.status || "",
                    l.leave_reason || "",
                  ])
                }
                disabled={filtered.length === 0}
              />
            </>
          )
        }
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
