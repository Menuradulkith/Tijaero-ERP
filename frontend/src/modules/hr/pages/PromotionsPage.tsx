/**
 * PromotionsPage — Master/Detail layout for employee promotions.
 */
import { useCallback, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, TextField, Typography } from "@mui/material";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
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
  handleApiError,
  showErrorToast,
  showSuccessToast,
  useMasterDetailState,
  useTConfirmDialog,
} from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";
import { promotionsApi } from "@/modules/hr/api";
import { formatDateTimeReadable } from "@/utils/formatters";
import type { EmployeePromotion, EmployeePromotionCreate } from "@/modules/hr/types";

const SORT_OPTIONS: SortOption[] = [
  { value: "appointed_desc", label: "Date (Newest)" },
  { value: "employee_id", label: "Employee ID" },
  { value: "designation", label: "Designation" },
];

const INITIAL_FORM: EmployeePromotionCreate = {
  employee_id: "",
  designation: "",
  appointed_date: new Date().toISOString().split("T")[0],
  remark: "",
};

export default function PromotionsPage() {
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
  } = useMasterDetailState<EmployeePromotion, EmployeePromotionCreate>({
    initialFormData: INITIAL_FORM,
    resetFormFromItem: (p) => ({
      employee_id: p.employee_id,
      designation: p.designation,
      appointed_date: p.appointed_date,
      remark: p.remark || "",
    }),
    defaultSortField: "appointed_desc",
  });

  const { data: promotions, isLoading, refetch } = useQuery({
    queryKey: ["promotions"],
    queryFn: () => promotionsApi.getAll(),
  });

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    let list = (promotions || []).filter(
      (p) => !q || p.employee_id.toLowerCase().includes(q) || p.designation.toLowerCase().includes(q) || (p.remark || "").toLowerCase().includes(q)
    );
    list.sort((a, b) => {
      if (sortField === "employee_id") return a.employee_id.localeCompare(b.employee_id);
      if (sortField === "designation") return a.designation.localeCompare(b.designation);
      return b.appointed_date.localeCompare(a.appointed_date);
    });
    return list;
  }, [promotions, searchQuery, sortField]);

  useEffect(() => {
    if (filtered.length > 0 && !selectedItem && !isCreating) handleSelectItem(filtered[0]);
  }, [filtered, selectedItem, isCreating, handleSelectItem]);

  const createMut = useMutation({
    mutationFn: (d: EmployeePromotionCreate) => promotionsApi.create(d),
    onSuccess: (rec) => {
      qc.invalidateQueries({ queryKey: ["promotions"] });
      showSuccessToast("Promotion created");
      setIsCreating(false); setIsEditing(false);
      setTimeout(() => handleSelectItem(rec), 0);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to create promotion")),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: EmployeePromotionCreate }) => promotionsApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["promotions"] });
      showSuccessToast("Promotion updated");
      setIsEditing(false);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to update promotion")),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => promotionsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["promotions"] });
      showSuccessToast("Promotion deleted");
      baseCancel(filtered);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to delete promotion")),
  });

  const confirmDialog = useTConfirmDialog();

  const handleSave = useCallback(() => {
    if (isCreating) createMut.mutate(formData);
    else if (selectedItem) updateMut.mutate({ id: selectedItem.id, data: formData });
  }, [isCreating, selectedItem, formData, createMut, updateMut]);

  const handleDelete = useCallback(async () => {
    if (!selectedItem) return;
    const ok = await confirmDialog.confirm({ title: "Delete Promotion", message: "Delete this promotion record?", confirmText: "Delete", confirmColor: "error" });
    if (ok) deleteMut.mutate(selectedItem.id);
  }, [selectedItem, deleteMut, confirmDialog]);

  const isFormValid = !!formData.employee_id && !!formData.designation && !!formData.appointed_date;
  const isSaving = createMut.isPending || updateMut.isPending;
  const isDisabled = !isEditing && !isCreating;

  const masterPanel = (
    <SearchableList<EmployeePromotion>
      items={filtered}
      isLoading={isLoading}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search promotions..."
      sortOptions={SORT_OPTIONS}
      currentSort={sortField}
      onSortChange={setSortField}
      selectedItem={selectedItem}
      onSelectItem={handleSelectItem}
      emptyMessage="No promotions found"
      renderItem={(p, isSelected) => (
        <SelectableListItem
          key={p.id}
          id={p.id}
          isSelected={isSelected}
          onClick={() => handleSelectItem(p)}
          primaryText={
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.3 }}>
              <span>{p.employee_id}</span>
              <Typography component="span" variant="caption" sx={{ color: isSelected ? "inherit" : "text.secondary", fontWeight: 600 }}>
                {p.designation}
              </Typography>
            </Box>
          }
          secondaryText={format(new Date(p.appointed_date), "MMM dd, yyyy")}
        />
      )}
    />
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[{ label: "HR", href: "/hr" }, { label: "Promotions", href: "/hr/promotions" },
          ...(selectedItem || isCreating ? [{ label: isCreating ? "New Promotion" : `#${selectedItem?.id}` }] : [])]}
        title={selectedItem ? `${selectedItem.employee_id} → ${selectedItem.designation}` : ""}
        titleIcon={<TrendingUpIcon color="primary" />}
        isCreating={isCreating} createTitle="New Promotion" noSelectionTitle="Select a Promotion"
      />
      <ActionToolbar canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} hasSelectedItem={!!selectedItem}
        isCreating={isCreating} isEditing={isEditing} isSaving={isSaving} isFormValid={isFormValid}
        onNew={handleNew} onDelete={handleDelete} onSave={handleSave} onCancel={() => baseCancel(filtered)} onEdit={handleStartEdit}
      />
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedItem && !isCreating ? (
          <EmptyState message="Select a promotion from the list or create a new one" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={2} fieldsPerSection={3} showHeader={false} showToolbar={false} />
        ) : (
          <>
            <FormSection title="Promotion Details" columns={2}>
              <TextField label="Employee ID" size="small" value={formData.employee_id} onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })} disabled={isDisabled} required />
              <TextField label="Designation" size="small" value={formData.designation} onChange={(e) => setFormData({ ...formData, designation: e.target.value })} disabled={isDisabled} required />
              <TextField label="Appointed Date" size="small" type="date" value={formData.appointed_date} onChange={(e) => setFormData({ ...formData, appointed_date: e.target.value })} disabled={isDisabled} InputLabelProps={{ shrink: true }} required />
              <Box sx={{ gridColumn: "1 / -1" }}>
                <TextField label="Remark" size="small" value={formData.remark || ""} onChange={(e) => setFormData({ ...formData, remark: e.target.value })} disabled={isDisabled} fullWidth multiline rows={3} />
              </Box>
            </FormSection>
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
      <MasterDetailLayout title="Promotions" onRefresh={refetch} isLoading={isLoading} masterPanel={masterPanel} detailPanel={detailPanel} />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
