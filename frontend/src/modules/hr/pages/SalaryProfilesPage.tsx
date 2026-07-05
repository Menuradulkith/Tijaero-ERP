/**
 * SalaryProfilesPage — Master/Detail layout for employee salary profiles.
 */
import { useCallback, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, TextField, Typography } from "@mui/material";
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

const SORT_OPTIONS: SortOption[] = [
  { value: "created_desc", label: "Date (Newest)" },
  { value: "employee_id", label: "Employee ID" },
  { value: "salary_desc", label: "Salary (Highest)" },
];

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
    sortField, setSortField,
    selectedItem, isEditing, isCreating,
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
    list.sort((a, b) => {
      if (sortField === "employee_id") return a.employee_id.localeCompare(b.employee_id);
      if (sortField === "salary_desc") return b.basic_salary - a.basic_salary;
      return (b.created_at || "").localeCompare(a.created_at || "");
    });
    return list;
  }, [profiles, searchQuery, sortField]);

  useEffect(() => {
    if (filtered.length > 0 && !selectedItem && !isCreating) handleSelectItem(filtered[0]);
  }, [filtered, selectedItem, isCreating, handleSelectItem]);

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
      baseCancel(filtered);
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

  const masterPanel = (
    <SearchableList<EmployeeSalaryProfile>
      items={filtered}
      isLoading={isLoading}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search profiles..."
      sortOptions={SORT_OPTIONS}
      currentSort={sortField}
      onSortChange={setSortField}
      selectedItem={selectedItem}
      onSelectItem={handleSelectItem}
      emptyMessage="No salary profiles found"
      renderItem={(p, isSelected) => (
        <SelectableListItem
          key={p.id}
          id={p.id}
          isSelected={isSelected}
          onClick={() => handleSelectItem(p)}
          primaryText={
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.3 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{p.employee_id}</span>
                <Typography component="span" variant="caption" fontWeight={600}
                  sx={{ color: isSelected ? "inherit" : "success.main" }}>
                  {fmtLKR(p.basic_salary)}
                </Typography>
              </Box>
              {p.designation && (
                <Typography component="span" variant="caption" sx={{ color: isSelected ? "inherit" : "text.secondary" }}>
                  {p.designation}{p.department ? ` • ${p.department}` : ""}
                </Typography>
              )}
            </Box>
          }
          secondaryText={!isSelected && p.employee_name ? p.employee_name : undefined}
        />
      )}
    />
  );

  const detailPanel = (
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
        onNew={handleNew} onDelete={handleDelete} onSave={handleSave} onCancel={() => baseCancel(filtered)} onEdit={handleStartEdit}
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
      <MasterDetailLayout title="Salary Profiles" onRefresh={refetch} isLoading={isLoading} masterPanel={masterPanel} detailPanel={detailPanel}
        headerActions={
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
        }
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
