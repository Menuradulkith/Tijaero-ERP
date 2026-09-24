/**
 * SalaryProfilesPage — Browse table + single-record detail toggle for employee salary profiles.
 */
import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, Box, Button, IconButton, InputAdornment, Paper, TextField, Tooltip, Typography } from "@mui/material";
import PersonIcon from "@mui/icons-material/Person";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SearchIcon from "@mui/icons-material/Search";
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
  TDataGrid,
  type TDataGridColumn,
  TDetailSkeleton,
  TExportButton,
  fmtLKR,
  handleApiError,
  showErrorToast,
  showSuccessToast,
  useMasterDetailState,
  useTConfirmDialog,
} from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";
import { salaryProfilesApi } from "@/modules/hr/api";
import { formatDateTimeReadable } from "@/utils/formatters";
import type { EmployeeSalaryProfile, EmployeeSalaryProfileCreate } from "@/modules/hr/types";

const INITIAL_FORM: EmployeeSalaryProfileCreate = {
  employee_id: "",
  basic_salary: 0,
  add_1_name: "",
  add_1_value: 0,
  add_2_name: "",
  add_2_value: 0,
  designation: "",
  department: "",
  effective_from_date: "",
  benefits: "",
};

export default function SalaryProfilesPage() {
  const qc = useQueryClient();
  const canCreate = usePermission("salary_profiles", "create");
  const canUpdate = usePermission("salary_profiles", "update");
  const canDelete = usePermission("salary_profiles", "delete");

  const {
    searchQuery, setSearchQuery,
    selectedItem, setSelectedItem, isEditing, isCreating,
    setIsCreating, setIsEditing,
    formData, setFormData,
    handleSelectItem, handleNew, handleCancel: baseCancel, handleStartEdit,
  } = useMasterDetailState<EmployeeSalaryProfile, EmployeeSalaryProfileCreate>({
    initialFormData: INITIAL_FORM,
    resetFormFromItem: (p) => ({
      employee_id: p.employee_id,
      basic_salary: p.basic_salary,
      add_1_name: p.add_1_name || "",
      add_1_value: p.add_1_value || 0,
      add_2_name: p.add_2_name || "",
      add_2_value: p.add_2_value || 0,
      designation: p.designation || "",
      department: p.department || "",
      effective_from_date: p.effective_from_date || "",
      benefits: p.benefits || "",
    }),
    defaultSortField: "created_desc",
  });

  const { data: profiles, isLoading, refetch } = useQuery({
    queryKey: ["salary-profiles"],
    queryFn: () => salaryProfilesApi.getAll(),
  });

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    let list = (profiles || []).filter(
      (p) => !q || p.employee_id.toLowerCase().includes(q) || (p.designation || "").toLowerCase().includes(q) || (p.department || "").toLowerCase().includes(q)
    );
    // Fixed default order (newest first) — the browse table's own
    // column-header sort takes over from here.
    list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    return list;
  }, [profiles, searchQuery]);

  const createMut = useMutation({
    mutationFn: (d: EmployeeSalaryProfileCreate) => salaryProfilesApi.create(d),
    onSuccess: (rec) => {
      qc.invalidateQueries({ queryKey: ["salary-profiles"] });
      showSuccessToast("Salary profile created");
      setIsCreating(false); setIsEditing(false);
      setTimeout(() => handleSelectItem(rec), 0);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to create profile")),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: EmployeeSalaryProfileCreate }) => salaryProfilesApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["salary-profiles"] });
      showSuccessToast("Salary profile updated");
      setIsEditing(false);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to update profile")),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => salaryProfilesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["salary-profiles"] });
      showSuccessToast("Salary profile deleted");
      // Return to the browse table rather than the hook's default handleCancel,
      // which would try to re-select an item from the (now stale) filtered list.
      setSelectedItem(null);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to delete profile")),
  });

  const confirmDialog = useTConfirmDialog();

  const handleSave = useCallback(() => {
    if (isCreating) createMut.mutate(formData);
    else if (selectedItem) updateMut.mutate({ id: selectedItem.id, data: formData });
  }, [isCreating, selectedItem, formData, createMut, updateMut]);

  const handleDelete = useCallback(async () => {
    if (!selectedItem) return;
    const ok = await confirmDialog.confirm({ title: "Delete Profile", message: "Delete this salary profile?", confirmText: "Delete", confirmColor: "error" });
    if (ok) deleteMut.mutate(selectedItem.id);
  }, [selectedItem, deleteMut, confirmDialog]);

  const isFormValid = !!formData.employee_id && formData.basic_salary > 0;
  const isSaving = createMut.isPending || updateMut.isPending;
  const isDisabled = !isEditing && !isCreating;

  const totalSalary = formData.basic_salary + (formData.add_1_value || 0) + (formData.add_2_value || 0);

  // Cancelling a brand-new record returns to the browse table (the hook's
  // default handleCancel would instead auto-select the first item, which made
  // sense for the old always-visible detail panel but not here). Cancelling
  // an edit of an existing record still just reverts its form.
  const handleCancelProfile = useCallback(() => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedItem(null);
    } else {
      baseCancel(filtered);
    }
  }, [isCreating, filtered, baseCancel, setIsCreating, setIsEditing, setSelectedItem]);

  // Returns to the browse table from the detail view.
  const handleBackToProfiles = useCallback(() => {
    setSelectedItem(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [isCreating, setSelectedItem, setIsCreating, setIsEditing]);

  // Whether we're showing a single profile's detail view (selected or being
  // created) instead of the browse table.
  const isDetailMode = !!selectedItem || isCreating;

  const columns: TDataGridColumn<EmployeeSalaryProfile>[] = useMemo(
    () => [
      {
        field: "employee_id",
        header: "Employee",
        flex: 1,
        minWidth: 160,
        renderCell: (params: GridRenderCellParams<EmployeeSalaryProfile>) => params.row.employee_name || params.row.employee_id,
      },
      {
        field: "basic_salary",
        header: "Basic Salary",
        width: 140,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<EmployeeSalaryProfile>) => fmtLKR(params.row.basic_salary),
      },
      {
        field: "add_1_value",
        header: "Allowances",
        width: 140,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<EmployeeSalaryProfile>) =>
          fmtLKR((params.row.add_1_value || 0) + (params.row.add_2_value || 0)),
      },
      {
        field: "effective_from_date",
        header: "Effective Date",
        width: 140,
        renderCell: (params: GridRenderCellParams<EmployeeSalaryProfile>) =>
          params.row.effective_from_date ? formatDateTimeReadable(params.row.effective_from_date) : "-",
      },
      {
        field: "designation",
        header: "Designation",
        flex: 1,
        minWidth: 150,
        renderCell: (params: GridRenderCellParams<EmployeeSalaryProfile>) =>
          [params.row.designation, params.row.department].filter(Boolean).join(" • ") || "-",
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<EmployeeSalaryProfile>) => (
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

  // Browse mode: a full-width table of every salary profile. Sorting is
  // done per-column via the grid's own column header menu.
  const tablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<EmployeeSalaryProfile>
          rows={filtered}
          columns={columns}
          loading={isLoading}
          onRowClick={(row) => handleSelectItem(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No salary profiles found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Detail mode: a narrow left panel showing only the current salary
  // profile (or the "New Profile" placeholder while creating) plus a
  // "Back to Salary Profiles" link that returns to the table.
  const singleProfilePanel = (
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
        <Button size="small" startIcon={<ArrowBackIcon fontSize="small" />} onClick={handleBackToProfiles} sx={{ textTransform: "none" }}>
          Back to Salary Profiles
        </Button>
      </Box>
      {isCreating ? (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ bgcolor: "action.disabledBackground" }}>
              <PersonIcon color="primary" />
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              New Salary Profile
            </Typography>
          </Box>
        </Box>
      ) : selectedItem && (
        <SelectableListItem
          id={selectedItem.id}
          isSelected
          onClick={() => {}}
          primaryText={
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
              <Avatar sx={{ bgcolor: "action.disabledBackground" }}>
                <PersonIcon color="primary" />
              </Avatar>
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0 }}>
                <span>
                  {selectedItem.employee_id}
                  {selectedItem.designation ? ` • ${selectedItem.designation}` : ""}
                </span>
              </Box>
            </Box>
          }
        />
      )}
    </Paper>
  );

  // Detail mode: the existing detail content, unchanged, shown full-width.
  const detailContent = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[{ label: "HR", href: "/hr" }, { label: "Salary Profiles", href: "/hr/salary-profiles" },
          ...(selectedItem || isCreating ? [{ label: isCreating ? "New Profile" : selectedItem?.employee_id || "" }] : [])]}
        title={selectedItem ? `${selectedItem.employee_id}${selectedItem.designation ? " • " + selectedItem.designation : ""}` : ""}
        titleIcon={<PersonIcon color="primary" />}
        isCreating={isCreating} createTitle="New Salary Profile" noSelectionTitle="Select a Salary Profile"
      />
      <ActionToolbar canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} hasSelectedItem={!!selectedItem}
        isCreating={isCreating} isEditing={isEditing} isSaving={isSaving} isFormValid={isFormValid}
        onNew={handleNew} onDelete={handleDelete} onSave={handleSave} onCancel={handleCancelProfile} onEdit={handleStartEdit}
      />
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedItem && !isCreating ? (
          <EmptyState message="Select a salary profile from the list or create a new one" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={3} fieldsPerSection={3} showHeader={false} showToolbar={false} />
        ) : (
          <>
            <FormSection title="Basic Information" columns={3}>
              <TextField label="Employee ID" size="small" value={formData.employee_id} onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })} disabled={isDisabled} required />
              <TextField label="Designation" size="small" value={formData.designation || ""} onChange={(e) => setFormData({ ...formData, designation: e.target.value })} disabled={isDisabled} />
              <TextField label="Department" size="small" value={formData.department || ""} onChange={(e) => setFormData({ ...formData, department: e.target.value })} disabled={isDisabled} />
              <TextField label="Effective From" size="small" type="date" value={formData.effective_from_date || ""} onChange={(e) => setFormData({ ...formData, effective_from_date: e.target.value })} disabled={isDisabled} InputLabelProps={{ shrink: true }} />
              <Box sx={{ gridColumn: "1 / -1" }}>
                <TextField label="Benefits" size="small" value={formData.benefits || ""} onChange={(e) => setFormData({ ...formData, benefits: e.target.value })} disabled={isDisabled} fullWidth multiline rows={2} />
              </Box>
            </FormSection>

            <FormSection title="Salary Breakdown" columns={2}>
              <TextField label="Basic Salary" size="small" type="number" value={Number(formData.basic_salary) || ""} onChange={(e) => setFormData({ ...formData, basic_salary: parseFloat(e.target.value) || 0 })} disabled={isDisabled} required inputProps={{ step: "0.01" }} />
              <Box />
              <TextField label="Addition 1 Name" size="small" value={formData.add_1_name || ""} onChange={(e) => setFormData({ ...formData, add_1_name: e.target.value })} disabled={isDisabled} />
              <TextField label="Addition 1 Value" size="small" type="number" value={formData.add_1_value || ""} onChange={(e) => setFormData({ ...formData, add_1_value: parseFloat(e.target.value) || 0 })} disabled={isDisabled} inputProps={{ step: "0.01" }} />
              <TextField label="Addition 2 Name" size="small" value={formData.add_2_name || ""} onChange={(e) => setFormData({ ...formData, add_2_name: e.target.value })} disabled={isDisabled} />
              <TextField label="Addition 2 Value" size="small" type="number" value={formData.add_2_value || ""} onChange={(e) => setFormData({ ...formData, add_2_value: parseFloat(e.target.value) || 0 })} disabled={isDisabled} inputProps={{ step: "0.01" }} />
            </FormSection>

            {(isCreating || isEditing) && (
              <FormSection title="Total" columns={1}>
                <Box>
                  <Typography variant="caption" color="text.secondary">Total Monthly Salary</Typography>
                  <Typography variant="h6" fontWeight={700} color="success.main">{fmtLKR(totalSalary)}</Typography>
                </Box>
              </FormSection>
            )}

            {selectedItem && !isCreating && !isEditing && (
              <FormSection title="Record Info" columns={2}>
                <Box><Typography variant="caption" color="text.secondary">Created</Typography><Typography variant="body2">{formatDateTimeReadable(selectedItem.created_at) || "-"}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">Last Modified</Typography><Typography variant="body2">{formatDateTimeReadable(selectedItem.updated_at) || "-"}</Typography></Box>
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
        title="Salary Profiles"
        titleSlot={
          isDetailMode ? undefined : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search profiles..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                }}
                sx={{ width: 260 }}
              />
            </Box>
          )
        }
        headerActions={
          isDetailMode ? undefined : (
            <>
              {canCreate && (
                <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={handleNew} sx={{ mr: 1 }}>
                  Add Salary Profile
                </Button>
              )}
              <TExportButton
                filename="salary_profiles"
                headers={[
                  "Employee ID",
                  "Designation",
                  "Department",
                  "Basic Salary",
                  "Addition 1",
                  "Add 1 Value",
                  "Addition 2",
                  "Add 2 Value",
                  "Effective From",
                  "Benefits",
                ]}
                rows={() =>
                  filtered.map((p) => [
                    p.employee_id || "",
                    p.designation || "",
                    p.department || "",
                    p.basic_salary ?? 0,
                    p.add_1_name || "",
                    p.add_1_value ?? 0,
                    p.add_2_name || "",
                    p.add_2_value ?? 0,
                    p.effective_from_date || "",
                    p.benefits || "",
                  ])
                }
                disabled={filtered.length === 0}
              />
            </>
          )
        }
        onRefresh={refetch}
        isLoading={isLoading}
        {...(isDetailMode
          ? { masterPanel: singleProfilePanel, detailPanel: detailContent }
          : { children: tablePanel })}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
