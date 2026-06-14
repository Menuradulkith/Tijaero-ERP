/**
 * DeductionsPage — Master/Detail layout for salary deductions.
 */
import { useCallback, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, TextField, Typography } from "@mui/material";
import MoneyOffIcon from "@mui/icons-material/MoneyOff";

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
import { salaryDeductionsApi } from "@/modules/hr/api";
import { formatDateTimeReadable } from "@/utils/formatters";
import type { SalaryDeduction, SalaryDeductionCreate } from "@/modules/hr/types";

const SORT_OPTIONS: SortOption[] = [
  { value: "created_desc", label: "Date (Newest)" },
  { value: "employee_id", label: "Employee ID" },
  { value: "amount_desc", label: "Amount (Highest)" },
];

const INITIAL_FORM: SalaryDeductionCreate = {
  employee_id: 0,
  reason: "",
  amount: 0,
};

export default function DeductionsPage() {
  const qc = useQueryClient();
  const canCreate = usePermission("hr", "create");
  const canUpdate = usePermission("hr", "update");
  const canDelete = usePermission("hr", "delete");

  const {
    searchQuery, setSearchQuery,
    sortField, setSortField,
    selectedItem, isEditing, isCreating,
    setIsCreating, setIsEditing,
    formData, setFormData,
    handleSelectItem, handleNew, handleCancel: baseCancel, handleStartEdit,
  } = useMasterDetailState<SalaryDeduction, SalaryDeductionCreate>({
    initialFormData: INITIAL_FORM,
    resetFormFromItem: (d) => ({
      employee_id: d.employee_id,
      reason: d.reason,
      amount: d.amount,
      approval_id: d.approval_id,
      remarks: d.remarks || "",
    }),
    defaultSortField: "created_desc",
  });

  const { data: deductions, isLoading, refetch } = useQuery({
    queryKey: ["salary-deductions"],
    queryFn: () => salaryDeductionsApi.getAll(),
  });

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    let list = (deductions || []).filter(
      (d) => !q || String(d.employee_id).includes(q) || d.reason.toLowerCase().includes(q)
    );
    list.sort((a, b) => {
      if (sortField === "employee_id") return String(a.employee_id).localeCompare(String(b.employee_id));
      if (sortField === "amount_desc") return b.amount - a.amount;
      return (b.created_date || b.created_at || "").localeCompare(a.created_date || a.created_at || "");
    });
    return list;
  }, [deductions, searchQuery, sortField]);

  useEffect(() => {
    if (filtered.length > 0 && !selectedItem && !isCreating) handleSelectItem(filtered[0]);
  }, [filtered, selectedItem, isCreating, handleSelectItem]);

  const createMut = useMutation({
    mutationFn: (d: SalaryDeductionCreate) => salaryDeductionsApi.create(d),
    onSuccess: (rec) => {
      qc.invalidateQueries({ queryKey: ["salary-deductions"] });
      showSuccessToast("Deduction created");
      setIsCreating(false); setIsEditing(false);
      setTimeout(() => handleSelectItem(rec), 0);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to create deduction")),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: SalaryDeductionCreate }) => salaryDeductionsApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["salary-deductions"] });
      showSuccessToast("Deduction updated");
      setIsEditing(false);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to update deduction")),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => salaryDeductionsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["salary-deductions"] });
      showSuccessToast("Deduction deleted");
      baseCancel(filtered);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to delete deduction")),
  });

  const confirmDialog = useTConfirmDialog();

  const handleSave = useCallback(() => {
    if (isCreating) createMut.mutate(formData);
    else if (selectedItem) updateMut.mutate({ id: selectedItem.id, data: formData });
  }, [isCreating, selectedItem, formData, createMut, updateMut]);

  const handleDelete = useCallback(async () => {
    if (!selectedItem) return;
    const ok = await confirmDialog.confirm({ title: "Delete Deduction", message: "Delete this deduction?", confirmText: "Delete", confirmColor: "error" });
    if (ok) deleteMut.mutate(selectedItem.id);
  }, [selectedItem, deleteMut, confirmDialog]);

  const isFormValid = !!formData.employee_id && !!formData.reason && formData.amount > 0;
  const isSaving = createMut.isPending || updateMut.isPending;
  const isDisabled = !isEditing && !isCreating;

  const masterPanel = (
    <SearchableList<SalaryDeduction>
      items={filtered}
      isLoading={isLoading}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search deductions..."
      sortOptions={SORT_OPTIONS}
      currentSort={sortField}
      onSortChange={setSortField}
      selectedItem={selectedItem}
      onSelectItem={handleSelectItem}
      emptyMessage="No deductions found"
      renderItem={(d, isSelected) => (
        <SelectableListItem
          key={d.id}
          id={d.id}
          isSelected={isSelected}
          onClick={() => handleSelectItem(d)}
          primaryText={`Employee #${d.employee_id}`}
          secondaryText={`${fmtLKR(d.amount)} • ${d.reason.substring(0, 40)}${d.reason.length > 40 ? "..." : ""}`}
        />
      )}
    />
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[{ label: "HR", href: "/hr" }, { label: "Deductions", href: "/hr/deductions" },
          ...(selectedItem || isCreating ? [{ label: isCreating ? "New Deduction" : `#${selectedItem?.id}` }] : [])]}
        title={selectedItem ? `Deduction #${selectedItem.id} • Employee #${selectedItem.employee_id}` : ""}
        titleIcon={<MoneyOffIcon color="primary" />}
        isCreating={isCreating} createTitle="New Deduction" noSelectionTitle="Select a Deduction"
      />
      <ActionToolbar canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} hasSelectedItem={!!selectedItem}
        isCreating={isCreating} isEditing={isEditing} isSaving={isSaving} isFormValid={isFormValid}
        onNew={handleNew} onDelete={handleDelete} onSave={handleSave} onCancel={() => baseCancel(filtered)} onEdit={handleStartEdit}
      />
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedItem && !isCreating ? (
          <EmptyState message="Select a deduction from the list or create a new one" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={2} fieldsPerSection={3} showHeader={false} showToolbar={false} />
        ) : (
          <>
            <FormSection title="Deduction Details" columns={2}>
              <TextField label="Employee ID" size="small" type="number" value={formData.employee_id || ""} onChange={(e) => setFormData({ ...formData, employee_id: Number(e.target.value) })} disabled={isDisabled} required />
              <TextField label="Amount" size="small" type="number" value={Number(formData.amount) || ""} onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })} disabled={isDisabled} required inputProps={{ step: "0.01" }} />
              <Box sx={{ gridColumn: "1 / -1" }}>
                <TextField label="Reason" size="small" value={formData.reason} onChange={(e) => setFormData({ ...formData, reason: e.target.value })} disabled={isDisabled} required fullWidth multiline rows={3} />
              </Box>
              <TextField label="Remarks (Optional)" size="small" value={formData.remarks || ""} onChange={(e) => setFormData({ ...formData, remarks: e.target.value })} disabled={isDisabled} fullWidth />
              <TextField label="Approval ID (Optional)" size="small" type="number" value={formData.approval_id || ""} onChange={(e) => setFormData({ ...formData, approval_id: Number(e.target.value) || undefined })} disabled={isDisabled} />
            </FormSection>
            {selectedItem && !isCreating && !isEditing && (
              <FormSection title="Record Info" columns={2}>
                <Box><Typography variant="caption" color="text.secondary">Created</Typography><Typography variant="body2">{formatDateTimeReadable(selectedItem.created_date || selectedItem.created_at) || "-"}</Typography></Box>
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
      <MasterDetailLayout title="Salary Deductions" onRefresh={refetch} isLoading={isLoading} masterPanel={masterPanel} detailPanel={detailPanel}
        headerActions={
          <TExportButton
            filename="salary_deductions"
            headers={["Employee ID", "Reason", "Amount", "Remarks", "Created"]}
            rows={() =>
              filtered.map((d) => [
                d.employee_id ?? "",
                d.reason || "",
                d.amount ?? 0,
                d.remarks || "",
                d.created_date || d.created_at || "",
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
