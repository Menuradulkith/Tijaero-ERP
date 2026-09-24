/**
 * EmployeeAssetsPage — Browse table + single-record detail toggle for employee asset assignments.
 */
import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, Box, Button, Chip, FormControlLabel, IconButton, InputAdornment, Paper, Switch, TextField, Tooltip, Typography } from "@mui/material";
import DevicesIcon from "@mui/icons-material/Devices";
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
    selectedItem, setSelectedItem, isEditing, isCreating,
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
    // Fixed default order (newest first) — the browse table's own
    // column-header sort takes over from here.
    list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    return list;
  }, [assets, searchQuery]);

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
      // Return to the browse table rather than the hook's default handleCancel,
      // which would try to re-select an item from the (now stale) filtered list.
      setSelectedItem(null);
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

  // Cancelling a brand-new record returns to the browse table (the hook's
  // default handleCancel would instead auto-select the first item, which made
  // sense for the old always-visible detail panel but not here). Cancelling
  // an edit of an existing record still just reverts its form.
  const handleCancelAsset = useCallback(() => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedItem(null);
    } else {
      baseCancel(filtered);
    }
  }, [isCreating, filtered, baseCancel, setIsCreating, setIsEditing, setSelectedItem]);

  // Returns to the browse table from the detail view.
  const handleBackToAssets = useCallback(() => {
    setSelectedItem(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [isCreating, setSelectedItem, setIsCreating, setIsEditing]);

  // Whether we're showing a single assignment's detail view (selected or
  // being created) instead of the browse table.
  const isDetailMode = !!selectedItem || isCreating;

  const columns: TDataGridColumn<EmployeeAsset>[] = useMemo(
    () => [
      { field: "employee_id", header: "Employee", width: 150 },
      {
        field: "asset_id",
        header: "Asset ID",
        width: 110,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<EmployeeAsset>) => `#${params.row.asset_id}`,
      },
      {
        field: "assign_reason",
        header: "Reason",
        flex: 1,
        minWidth: 200,
        renderCell: (params: GridRenderCellParams<EmployeeAsset>) => params.row.assign_reason || "-",
      },
      {
        field: "revoke_assignment",
        header: "Status",
        width: 120,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<EmployeeAsset>) => (
          <Chip
            label={params.row.revoke_assignment ? "Revoked" : "Active"}
            size="small"
            color={params.row.revoke_assignment ? "error" : "success"}
            sx={{ height: 20, fontSize: "0.65rem" }}
          />
        ),
      },
      {
        field: "created_at",
        header: "Created",
        width: 170,
        renderCell: (params: GridRenderCellParams<EmployeeAsset>) => formatDateTimeReadable(params.row.created_at) || "-",
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<EmployeeAsset>) => (
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

  // Browse mode: a full-width table of every assignment. Sorting is done
  // per-column via the grid's own column header menu.
  const tablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<EmployeeAsset>
          rows={filtered}
          columns={columns}
          loading={isLoading}
          onRowClick={(row) => handleSelectItem(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No asset assignments found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Detail mode: a narrow left panel showing only the current assignment
  // (or the "New Assignment" placeholder while creating) plus a
  // "Back to Employee Assets" link that returns to the table.
  const singleAssetPanel = (
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
        <Button size="small" startIcon={<ArrowBackIcon fontSize="small" />} onClick={handleBackToAssets} sx={{ textTransform: "none" }}>
          Back to Employee Assets
        </Button>
      </Box>
      {isCreating ? (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ bgcolor: "action.disabledBackground" }}>
              <DevicesIcon color="primary" />
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              New Asset Assignment
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
                <DevicesIcon color="primary" />
              </Avatar>
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0 }}>
                <span>{selectedItem.employee_id} • Asset #{selectedItem.asset_id}</span>
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
        breadcrumbs={[{ label: "HR", href: "/hr" }, { label: "Assets", href: "/hr/assets" },
          ...(selectedItem || isCreating ? [{ label: isCreating ? "New Assignment" : `#${selectedItem?.id}` }] : [])]}
        title={selectedItem ? `${selectedItem.employee_id} • Asset #${selectedItem.asset_id}` : ""}
        titleIcon={<DevicesIcon color="primary" />}
        isCreating={isCreating} createTitle="New Asset Assignment" noSelectionTitle="Select an Assignment"
        chips={selectedItem && !isCreating ? [{ label: selectedItem.revoke_assignment ? "Revoked" : "Active", color: selectedItem.revoke_assignment ? ("error" as const) : ("success" as const) }] : []}
      />
      <ActionToolbar canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} hasSelectedItem={!!selectedItem}
        isCreating={isCreating} isEditing={isEditing} isSaving={isSaving} isFormValid={isFormValid}
        onNew={handleNew} onDelete={handleDelete} onSave={handleSave} onCancel={handleCancelAsset} onEdit={handleStartEdit}
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
      <MasterDetailLayout
        title="Employee Assets"
        titleSlot={
          isDetailMode ? undefined : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search assignments..."
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
                  Add Asset Assignment
                </Button>
              )}
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
            </>
          )
        }
        onRefresh={refetch}
        isLoading={isLoading}
        {...(isDetailMode
          ? { masterPanel: singleAssetPanel, detailPanel: detailContent }
          : { children: tablePanel })}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
