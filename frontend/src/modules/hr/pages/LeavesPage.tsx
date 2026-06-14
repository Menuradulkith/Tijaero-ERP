/**
 * LeavesPage — Master/Detail layout for leave applications.
 * Left: searchable list of leaves with status filter.
 * Right: leave details + apply form with live balance preview.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, Chip, MenuItem, TextField, Typography } from "@mui/material";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
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
  TConfirmDialog,
  TDetailSkeleton,
  TFilterPanel,
  TExportButton,
  TStatusFilter,
  type TFilterStatusOption,
  handleApiError,
  showErrorToast,
  showSuccessToast,
  useMasterDetailState,
  useTConfirmDialog,
} from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";
import { leavesApi, employeesApi } from "@/modules/hr/api";
import type { Leave, LeaveCreate } from "@/modules/hr/types";

const SORT_OPTIONS: SortOption[] = [
  { value: "created_desc", label: "Date Applied (Newest)" },
  { value: "from_date", label: "From Date" },
  { value: "employee_id", label: "Employee ID" },
];

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

  const [filterStatus, setFilterStatus] = useState<string | null>(null);

  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem: selectedLeave,
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
    list.sort((a, b) => {
      if (sortField === "from_date") return b.from_date.localeCompare(a.from_date);
      if (sortField === "employee_id") return a.employee_id.localeCompare(b.employee_id);
      return (b.created_at || "").localeCompare(a.created_at || "");
    });
    return list;
  }, [leaves, searchQuery, sortField, filterStatus]);

  useEffect(() => {
    if (filtered.length > 0 && !selectedLeave && !isCreating) {
      handleSelectItem(filtered[0]);
    }
  }, [filtered, selectedLeave, isCreating, handleSelectItem]);

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
      baseCancel(filtered);
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

  const isFormValid =
    !!formData.employee_id && !!formData.from_date && !!formData.to_date && !!formData.leave_reason;
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDisabled = !isEditing && !isCreating;
  const canEditSelected = selectedLeave?.status === "pending";

  const masterPanel = (
    <SearchableList<Leave>
      items={filtered}
      isLoading={isLoading}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search by employee, type, reason..."
      sortOptions={SORT_OPTIONS}
      currentSort={sortField}
      onSortChange={setSortField}
      selectedItem={selectedLeave}
      onSelectItem={handleSelectItem}
      emptyMessage="No leave applications found"
      listHeader={
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, p: 1.5, pb: 0 }}>
          <TFilterPanel>
            <TStatusFilter
              options={STATUS_OPTIONS}
              value={filterStatus}
              onChange={setFilterStatus}
            />
          </TFilterPanel>
        </Box>
      }
      renderItem={(leave, isSelected) => (
        <SelectableListItem
          key={leave.id}
          id={leave.id}
          isSelected={isSelected}
          onClick={() => handleSelectItem(leave)}
          primaryText={
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{leave.employee_name || leave.employee_id}</span>
                <Chip
                  label={leave.status}
                  size="small"
                  color={statusColor(leave.status) as any}
                  sx={{ height: 18, fontSize: "0.65rem", textTransform: "capitalize" }}
                />
              </Box>
              <Typography component="span" variant="caption" sx={{ color: isSelected ? "inherit" : "text.secondary" }}>
                {leave.leave_type.toUpperCase()} • {leave.leave_duration} day(s)
              </Typography>
            </Box>
          }
          secondaryText={
            !isSelected
              ? `${format(new Date(leave.from_date), "MMM dd")} → ${format(new Date(leave.to_date), "MMM dd, yyyy")}`
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
        onCancel={() => baseCancel(filtered)}
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
        onRefresh={refetch}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
        headerActions={
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
        }
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
