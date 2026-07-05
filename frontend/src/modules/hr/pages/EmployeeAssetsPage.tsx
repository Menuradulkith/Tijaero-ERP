/**
 * EmployeeAssetsPage — Master/Detail layout for employee asset assignments.
 */
import { useCallback, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, Chip, FormControlLabel, Switch, TextField, Typography } from "@mui/material";
import DevicesIcon from "@mui/icons-material/Devices";

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
  handleApiError,
  showErrorToast,
  showSuccessToast,
  useMasterDetailState,
  useTConfirmDialog,
} from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";
import { employeeAssetsApi } from "@/modules/hr/api";
import { formatDateTimeReadable } from "@/utils/formatters";
import type { EmployeeAsset, EmployeeAssetCreate } from "@/modules/hr/types";

const SORT_OPTIONS: SortOption[] = [
  { value: "created_desc", label: "Date (Newest)" },
  { value: "employee_id", label: "Employee ID" },
  { value: "asset_id", label: "Asset ID" },
];

const INITIAL_FORM: EmployeeAssetCreate = {
  employee_id: "",
  asset_id: 0,
  assign_reason: "",
  revoke_assignment: false,
};

export default function EmployeeAssetsPage() {
  const qc = useQueryClient();
  const canCreate = usePermission("hr_assets", "create");
  const canUpdate = usePermission("hr_assets", "update");
  const canDelete = usePermission("hr_assets", "delete");

  const {
    searchQuery, setSearchQuery,
    sortField, setSortField,
    selectedItem, isEditing, isCreating,
    setIsCreating, setIsEditing,
    formData, setFormData,
    handleSelectItem, handleNew, handleCancel: baseCancel, handleStartEdit,
  } = useMasterDetailState<EmployeeAsset, EmployeeAssetCreate>({
    initialFormData: INITIAL_FORM,
    resetFormFromItem: (a) => ({
      employee_id: a.employee_id,
      asset_id: a.asset_id,
      assign_reason: a.assign_reason || "",
      revoke_assignment: a.revoke_assignment,
    }),
    defaultSortField: "created_desc",
  });

  const { data: assets, isLoading, refetch } = useQuery({
    queryKey: ["employee-assets"],
    queryFn: () => employeeAssetsApi.getAll(),
  });

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    let list = (assets || []).filter(
      (a) => !q || a.employee_id.toLowerCase().includes(q) || String(a.asset_id).includes(q) || (a.assign_reason || "").toLowerCase().includes(q)
    );
    list.sort((a, b) => {
      if (sortField === "employee_id") return a.employee_id.localeCompare(b.employee_id);
      if (sortField === "asset_id") return a.asset_id - b.asset_id;
      return (b.created_at || "").localeCompare(a.created_at || "");
    });
    return list;
  }, [assets, searchQuery, sortField]);

  useEffect(() => {
    if (filtered.length > 0 && !selectedItem && !isCreating) handleSelectItem(filtered[0]);
  }, [filtered, selectedItem, isCreating, handleSelectItem]);

  const createMut = useMutation({
    mutationFn: (d: EmployeeAssetCreate) => employeeAssetsApi.create(d),
    onSuccess: (rec) => {
      qc.invalidateQueries({ queryKey: ["employee-assets"] });
      showSuccessToast("Asset assigned");
      setIsCreating(false); setIsEditing(false);
      setTimeout(() => handleSelectItem(rec), 0);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to assign asset")),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: EmployeeAssetCreate }) => employeeAssetsApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employee-assets"] });
      showSuccessToast("Assignment updated");
      setIsEditing(false);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to update assignment")),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => employeeAssetsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employee-assets"] });
      showSuccessToast("Assignment deleted");
      baseCancel(filtered);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to delete assignment")),
  });

  const confirmDialog = useTConfirmDialog();

  const handleSave = useCallback(() => {
    if (isCreating) createMut.mutate(formData);
    else if (selectedItem) updateMut.mutate({ id: selectedItem.id, data: formData });
  }, [isCreating, selectedItem, formData, createMut, updateMut]);

  const handleDelete = useCallback(async () => {
    if (!selectedItem) return;
    const ok = await confirmDialog.confirm({ title: "Delete Assignment", message: "Delete this asset assignment?", confirmText: "Delete", confirmColor: "error" });
    if (ok) deleteMut.mutate(selectedItem.id);
  }, [selectedItem, deleteMut, confirmDialog]);

  const isFormValid = !!formData.employee_id && formData.asset_id > 0;
  const isSaving = createMut.isPending || updateMut.isPending;
  const isDisabled = !isEditing && !isCreating;

  const masterPanel = (
    <SearchableList<EmployeeAsset>
      items={filtered}
      isLoading={isLoading}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search assignments..."
      sortOptions={SORT_OPTIONS}
      currentSort={sortField}
      onSortChange={setSortField}
      selectedItem={selectedItem}
      onSelectItem={handleSelectItem}
      emptyMessage="No asset assignments found"
      renderItem={(a, isSelected) => (
        <SelectableListItem
          key={a.id}
          id={a.id}
          isSelected={isSelected}
          onClick={() => handleSelectItem(a)}
          primaryText={
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{a.employee_id}</span>
              <Chip
                label={a.revoke_assignment ? "Revoked" : "Active"}
                size="small"
                color={a.revoke_assignment ? "error" : "success"}
                sx={{ height: 18, fontSize: "0.65rem" }}
              />
            </Box>
          }
          secondaryText={`Asset #${a.asset_id}${a.assign_reason ? " • " + a.assign_reason.substring(0, 30) : ""}`}
        />
      )}
    />
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[{ label: "HR", href: "/hr" }, { label: "Assets", href: "/hr/assets" },
          ...(selectedItem || isCreating ? [{ label: isCreating ? "New Assignment" : `#${selectedItem?.id}` }] : [])]}
        title={selectedItem ? `${selectedItem.employee_id} • Asset #${selectedItem.asset_id}` : ""}
        titleIcon={<DevicesIcon color="primary" />}
        isCreating={isCreating} createTitle="New Asset Assignment" noSelectionTitle="Select an Assignment"
        chips={selectedItem && !isCreating ? [{ label: selectedItem.revoke_assignment ? "Revoked" : "Active", color: selectedItem.revoke_assignment ? ("error" as const) : ("success" as const) }] : []}
      />
      <ActionToolbar canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} hasSelectedItem={!!selectedItem}
        isCreating={isCreating} isEditing={isEditing} isSaving={isSaving} isFormValid={isFormValid}
        onNew={handleNew} onDelete={handleDelete} onSave={handleSave} onCancel={() => baseCancel(filtered)} onEdit={handleStartEdit}
      />
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedItem && !isCreating ? (
          <EmptyState message="Select an assignment from the list or create a new one" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={2} fieldsPerSection={3} showHeader={false} showToolbar={false} />
        ) : (
          <>
            <FormSection title="Assignment Details" columns={2}>
              <TextField label="Employee ID" size="small" value={formData.employee_id} onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })} disabled={isDisabled} required />
              <TextField label="Asset ID" size="small" type="number" value={formData.asset_id || ""} onChange={(e) => setFormData({ ...formData, asset_id: Number(e.target.value) })} disabled={isDisabled} required />
              <Box sx={{ gridColumn: "1 / -1" }}>
                <TextField label="Assignment Reason" size="small" value={formData.assign_reason || ""} onChange={(e) => setFormData({ ...formData, assign_reason: e.target.value })} disabled={isDisabled} fullWidth multiline rows={2} />
              </Box>
              <FormControlLabel
                control={<Switch checked={formData.revoke_assignment} onChange={(e) => setFormData({ ...formData, revoke_assignment: e.target.checked })} disabled={isDisabled} />}
                label="Revoke Assignment"
              />
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
      <MasterDetailLayout title="Employee Assets" onRefresh={refetch} isLoading={isLoading} masterPanel={masterPanel} detailPanel={detailPanel}
        headerActions={
          <TExportButton
            filename="employee_assets"
            headers={["Employee ID", "Asset ID", "Assign Reason", "Revoked"]}
            rows={() =>
              filtered.map((a) => [
                a.employee_id || "",
                a.asset_id ?? "",
                a.assign_reason || "",
                a.revoke_assignment ? "Yes" : "No",
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
