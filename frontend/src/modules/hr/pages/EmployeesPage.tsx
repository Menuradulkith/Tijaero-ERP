/**
 * EmployeesPage — Browse table + single-record detail toggle.
 * Browse mode: a full-width table of every HR-linked employee.
 * Detail mode: the record's detail form (unchanged), full-width, with a
 * "Back to Employees" link returning to the table.
 */
import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, Box, Button, IconButton, InputAdornment, MenuItem, Paper, TextField, Tooltip, Typography } from "@mui/material";
import PersonIcon from "@mui/icons-material/Person";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { GridRenderCellParams } from "@mui/x-data-grid";

import {
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  FormSection,
  MasterDetailLayout,
  SelectableListItem,
  TConfirmDialog,
  TDetailSkeleton,
  TDataGrid,
  type TDataGridColumn,
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
    selectedItem: selectedEmployee,
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
    // Default order before the user sorts a column in the table itself
    // (the table's own column-header sort takes over from there).
    list.sort((a, b) => a.employee_id.localeCompare(b.employee_id));
    return list;
  }, [rows, searchQuery]);

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
      setSelectedItem(null);
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

  // Cancelling out of "Link New Employee" should return to the browse
  // table, not auto-open the first employee the way
  // useMasterDetailState's generic handleCancel does (that behavior made
  // sense for the old always-visible detail panel, but not here).
  // Cancelling out of editing an existing employee still just reverts its
  // form, which the generic handler already does correctly.
  const handleCancelEmployee = useCallback(() => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedItem(null);
    } else {
      baseCancel(filtered);
    }
  }, [isCreating, filtered, baseCancel, setIsCreating, setIsEditing, setSelectedItem]);

  // Returns to the browse table from the detail view.
  const handleBackToEmployees = useCallback(() => {
    setSelectedItem(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [isCreating, setSelectedItem, setIsCreating, setIsEditing]);

  const isFormValid =
    !!formData.employee_id && (isCreating ? !!formData.user_id : true);
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDisabled = !isEditing && !isCreating;

  // Whether we're showing a single employee's detail view (selected or
  // being created) instead of the browse table.
  const isEmployeeDetailMode = !!selectedEmployee || isCreating;

  // The table sorts by whichever column the user clicks via the grid's own
  // column-header menu, not a separate "Sort by" control.
  //
  // NOTE: the underlying Employee record only links a system user to an
  // employee_id — it doesn't carry department/designation/branch/status
  // fields, so those suggested columns aren't available; Username, Email
  // and "Linked On" (from the linked user profile / record metadata) are
  // shown instead.
  const employeeColumns: TDataGridColumn<EmployeeRow>[] = useMemo(
    () => [
      { field: "employee_id", header: "Employee Code", width: 150 },
      { field: "full_name", header: "Name", flex: 1, minWidth: 180 },
      { field: "username", header: "Username", width: 150 },
      { field: "email", header: "Email", flex: 1, minWidth: 180 },
      {
        field: "created_at",
        header: "Linked On",
        width: 140,
        renderCell: (params: GridRenderCellParams<EmployeeRow>) =>
          params.row.created_at ? new Date(params.row.created_at).toLocaleDateString() : "-",
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<EmployeeRow>) => (
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

  // Browse mode: a full-width table of every HR-linked employee.
  const employeeTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<EmployeeRow>
          rows={filtered}
          columns={employeeColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectItem(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No employees found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Detail mode: a narrow left panel showing only the current employee
  // (or the "New Employee" placeholder while creating) plus a
  // "Back to Employees" link that returns to the table.
  const singleEmployeePanel = (
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
          onClick={handleBackToEmployees}
          sx={{ textTransform: "none" }}
        >
          Back to Employees
        </Button>
      </Box>
      {isCreating ? (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ bgcolor: "action.disabledBackground" }}>
              <PersonIcon color="primary" />
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              New Employee
            </Typography>
          </Box>
        </Box>
      ) : selectedEmployee && (
        <SelectableListItem
          id={selectedEmployee.id}
          isSelected
          onClick={() => {}}
          primaryText={
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
              <Avatar sx={{ bgcolor: "action.disabledBackground" }}>
                <PersonIcon color="primary" />
              </Avatar>
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0 }}>
                <span>{selectedEmployee.full_name}</span>
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
        onCancel={handleCancelEmployee}
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
        titleSlot={
          isEmployeeDetailMode ? undefined : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search employees..."
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
              {searchQuery && (
                <Tooltip title="Clear search">
                  <IconButton size="small" onClick={() => setSearchQuery("")}>
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          )
        }
        headerActions={
          isEmployeeDetailMode ? undefined : (
            <>
              {canCreate && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={handleNew}
                  sx={{ mr: 1 }}
                >
                  Add Employee
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
        {...(isEmployeeDetailMode
          ? { masterPanel: singleEmployeePanel, detailPanel }
          : { children: employeeTablePanel })}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
