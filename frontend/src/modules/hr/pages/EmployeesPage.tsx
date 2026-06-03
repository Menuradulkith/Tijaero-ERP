/**
 * EmployeesPage — Master/Detail layout matching Customers / Sales Orders pattern.
 * Left: searchable list of HR-linked employees.
 * Right: employee details (system user + employee ID).
 */
import { useCallback, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, Button, MenuItem, TextField, Typography } from "@mui/material";
import PersonIcon from "@mui/icons-material/Person";

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
  handleApiError,
  showErrorToast,
  showSuccessToast,
  useMasterDetailState,
  useTConfirmDialog,
} from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";
import { employeesApi } from "@/modules/hr/api";
import { usersApi, type UserList } from "@/modules/users/api";
import type { Employee, EmployeeCreate } from "@/modules/hr/types";
import { formatDateTimeReadable } from "@/utils/formatters";
import { exportToCSV } from "@/utils/csvExport";
import DownloadIcon from "@mui/icons-material/FileDownload";

const SORT_OPTIONS: SortOption[] = [
  { value: "employee_id", label: "Employee ID" },
  { value: "full_name", label: "Full Name" },
];

interface EmployeeRow extends Employee {
  full_name: string;
  username: string;
}

const INITIAL_FORM: EmployeeCreate = { user_id: 0, employee_id: "" };

export default function EmployeesPage() {
  const qc = useQueryClient();
  const canCreate = usePermission("employees", "create");
  const canUpdate = usePermission("employees", "update");
  const canDelete = usePermission("employees", "delete");

  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem: selectedEmployee,
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
  } = useMasterDetailState<EmployeeRow, EmployeeCreate>({
    initialFormData: INITIAL_FORM,
    resetFormFromItem: (e) => ({ user_id: e.user_id, employee_id: e.employee_id }),
    defaultSortField: "employee_id",
  });

  const { data: employees, isLoading, refetch } = useQuery({
    queryKey: ["hr-employees"],
    queryFn: () => employeesApi.getAll({ limit: 500 }),
  });

  const { data: users } = useQuery({
    queryKey: ["all-users-light"],
    queryFn: () => usersApi.getUsers(1, 500),
  });

  const userMap = useMemo(() => {
    const m = new Map<number, UserList>();
    (users || []).forEach((u) => m.set(u.id, u));
    return m;
  }, [users]);

  const rows: EmployeeRow[] = useMemo(() => {
    return (employees || []).map((e) => {
      const u = userMap.get(e.user_id);
      return {
        ...e,
        full_name: u
          ? `${u.first_name} ${u.middle_name || ""} ${u.last_name}`.replace(/\s+/g, " ").trim()
          : `User #${e.user_id}`,
        username: u?.username || "",
        email: u?.email || "",
        occupation: u?.occupation || "",
      };
    });
  }, [employees, userMap]);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    let list = rows.filter(
      (r) =>
        !q ||
        r.employee_id.toLowerCase().includes(q) ||
        r.full_name.toLowerCase().includes(q) ||
        (r.email || "").toLowerCase().includes(q) ||
        r.username.toLowerCase().includes(q)
    );
    list.sort((a, b) =>
      sortField === "full_name"
        ? a.full_name.localeCompare(b.full_name)
        : a.employee_id.localeCompare(b.employee_id)
    );
    return list;
  }, [rows, searchQuery, sortField]);

  useEffect(() => {
    if (filtered.length > 0 && !selectedEmployee && !isCreating) {
      handleSelectItem(filtered[0]);
    }
  }, [filtered, selectedEmployee, isCreating, handleSelectItem]);

  const linkedIds = useMemo(() => new Set(rows.map((r) => r.user_id)), [rows]);
  const availableUsers = useMemo(
    () => (users || []).filter((u) => isCreating ? !linkedIds.has(u.id) : true),
    [users, linkedIds, isCreating]
  );

  const createMutation = useMutation({
    mutationFn: (d: EmployeeCreate) => employeesApi.create(d),
    onSuccess: (newEmp) => {
      qc.invalidateQueries({ queryKey: ["hr-employees"] });
      showSuccessToast("Employee linked successfully");
      setIsCreating(false);
      setIsEditing(false);
      const u = userMap.get(newEmp.user_id);
      const row: EmployeeRow = {
        ...newEmp,
        full_name: u ? `${u.first_name} ${u.last_name}` : `User #${newEmp.user_id}`,
        username: u?.username || "",
        email: u?.email || "",
      };
      setTimeout(() => handleSelectItem(row), 0);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to link employee")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: EmployeeCreate }) =>
      employeesApi.update(id, { employee_id: data.employee_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr-employees"] });
      showSuccessToast("Employee updated");
      setIsEditing(false);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to update employee")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => employeesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr-employees"] });
      showSuccessToast("Employee unlinked");
      baseCancel(filtered);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to unlink employee")),
  });

  const confirmDialog = useTConfirmDialog();

  const handleExportCSV = () => {
    const headers = [
      "Employee ID",
      "Full Name",
      "Username",
      "Email",
      "Occupation",
      "Linked On"
    ];

    const rows = filtered.map(emp => [
      emp.employee_id,
      emp.full_name,
      emp.username,
      emp.email || "",
      emp.occupation || "",
      emp.created_at ? new Date(emp.created_at).toLocaleDateString() : ""
    ]);

    exportToCSV({
      filename: `employees_${new Date().toISOString().split("T")[0]}`,
      headers,
      rows
    });
  };

  const handleSave = useCallback(() => {
    if (isCreating) createMutation.mutate(formData);
    else if (selectedEmployee) updateMutation.mutate({ id: selectedEmployee.id, data: formData });
  }, [isCreating, selectedEmployee, formData, createMutation, updateMutation]);

  const handleDelete = useCallback(async () => {
    if (!selectedEmployee) return;
    const ok = await confirmDialog.confirm({
      title: "Unlink Employee",
      message: `Remove HR link for ${selectedEmployee.full_name}?`,
      confirmText: "Unlink",
      confirmColor: "error",
    });
    if (ok) deleteMutation.mutate(selectedEmployee.id);
  }, [selectedEmployee, deleteMutation, confirmDialog]);

  const isFormValid =
    !!formData.employee_id && (isCreating ? !!formData.user_id : true);
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDisabled = !isEditing && !isCreating;

  const masterPanel = (
    <SearchableList<EmployeeRow>
      items={filtered}
      isLoading={isLoading}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search employees..."
      sortOptions={SORT_OPTIONS}
      currentSort={sortField}
      onSortChange={setSortField}
      selectedItem={selectedEmployee}
      onSelectItem={handleSelectItem}
      emptyMessage="No employees found"
      renderItem={(emp, isSelected) => (
        <SelectableListItem
          key={emp.id}
          id={emp.id}
          isSelected={isSelected}
          onClick={() => handleSelectItem(emp)}
          primaryText={emp.full_name}
          secondaryText={`${emp.employee_id}${emp.email ? " • " + emp.email : ""}`}
        />
      )}
    />
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "HR", href: "/hr" },
          { label: "Employees", href: "/hr/employees" },
          ...(selectedEmployee || isCreating
            ? [{ label: isCreating ? "New Employee" : selectedEmployee?.employee_id || "" }]
            : []),
        ]}
        title={selectedEmployee ? selectedEmployee.full_name : ""}
        titleIcon={<PersonIcon color="primary" />}
        isCreating={isCreating}
        createTitle="Link New Employee"
        noSelectionTitle="Select an Employee"
      />

      <ActionToolbar
        canCreate={canCreate}
        canUpdate={canUpdate}
        canDelete={canDelete}
        hasSelectedItem={!!selectedEmployee}
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
        {!selectedEmployee && !isCreating ? (
          <EmptyState message="Select an employee from the list or create a new one" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={2} fieldsPerSection={3} showHeader={false} showToolbar={false} />
        ) : (
          <>
            <FormSection title="Employee Details" columns={2}>
              <TextField
                label="System User"
                size="small"
                select
                value={formData.user_id || ""}
                onChange={(e) => setFormData({ ...formData, user_id: Number(e.target.value) })}
                disabled={!isCreating}
                required
              >
                {availableUsers.map((u) => (
                  <MenuItem key={u.id} value={u.id}>
                    {u.first_name} {u.last_name} ({u.username})
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Employee ID"
                size="small"
                value={formData.employee_id}
                onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                disabled={isDisabled}
                required
                placeholder="e.g. EMP-001"
              />
            </FormSection>

            {selectedEmployee && !isCreating && (
              <FormSection title="Linked User Profile" columns={2}>
                <Box>
                  <Typography variant="caption" color="text.secondary">Username</Typography>
                  <Typography variant="body2">{selectedEmployee.username || "-"}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Email</Typography>
                  <Typography variant="body2">{selectedEmployee.email || "-"}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Occupation</Typography>
                  <Typography variant="body2">{selectedEmployee.occupation || "-"}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Linked On</Typography>
                  <Typography variant="body2">
                    {formatDateTimeReadable(selectedEmployee.created_at) || "-"}
                  </Typography>
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
        title="Employees"
        headerActions={
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
        }
        onRefresh={refetch}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
