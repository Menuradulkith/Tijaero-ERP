/**
 * WorkCentersPage - Manufacturing work centers (machines / stations / lines)
 *
 * Master data for routing operations: capacity, efficiency and the labour /
 * overhead rates production orders absorb per hour of booked time.
 * Same browse-table -> detail pattern as the purchasing pages.
 */

import { useCurrencyStore } from "@/state/currencyStore";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import FactoryIcon from "@mui/icons-material/Factory";
import HistoryIcon from "@mui/icons-material/History";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SearchIcon from "@mui/icons-material/Search";
import {
  Autocomplete,
  Box,
  Button,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDateTimeReadable } from "@/utils/formatters";

import {
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  fmtLKR,
  FormSection,
  MasterDetailLayout,
  TActivityHistoryPanel,
  TBranchFilter,
  TConfirmDialog,
  TDataGrid,
  type TDataGridColumn,
  TRemarkField,
  TStatusChip,
  TStatusFilter,
  useCrudMutation,
  useMasterDetailState,
  useTConfirmDialog,
} from "@/components/tijaero";

import { useReferenceData } from "@/hooks";
import { usePermission } from "@/auth/permissions";
import { workCentersApi } from "@/modules/manufacturing/api";
import { WorkCenter, WorkCenterInput } from "@/modules/manufacturing/types";

const INITIAL_FORM_DATA: WorkCenterInput = {
  code: "",
  name: "",
  description: "",
  branch_code: null,
  capacity: 1,
  efficiency_pct: 100,
  working_hours_per_day: 8,
  labor_rate_per_hour: 0,
  overhead_rate_per_hour: 0,
  active: true,
};

const ACTIVE_FILTER_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const resetFormFromWorkCenter = (wc: WorkCenter): WorkCenterInput => ({
  code: wc.code,
  name: wc.name,
  description: wc.description || "",
  branch_code: wc.branch_code || null,
  capacity: wc.capacity,
  efficiency_pct: Number(wc.efficiency_pct),
  working_hours_per_day: Number(wc.working_hours_per_day),
  labor_rate_per_hour: Number(wc.labor_rate_per_hour),
  overhead_rate_per_hour: Number(wc.overhead_rate_per_hour),
  active: wc.active,
});

// A browse-table row with display values precomputed so the grid's own
// column-header sort orders by what is shown.
type WorkCenterRow = WorkCenter & {
  branch_display: string;
  efficiency_num: number;
  labor_num: number;
  overhead_num: number;
  load_hours: number;
  status_key: string;
};

const numberOrZero = (value: string) => {
  const n = parseFloat(value);
  return isNaN(n) ? 0 : n;
};

export default function WorkCentersPage() {
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const queryClient = useQueryClient();
  const confirmDialog = useTConfirmDialog();
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const handleBlur = (field: string) => setTouched((prev) => ({ ...prev, [field]: true }));

  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);

  const {
    searchQuery,
    setSearchQuery,
    selectedItem: selectedWorkCenter,
    setSelectedItem: setSelectedWorkCenter,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    formData,
    setFormData,
    handleSelectItem,
    handleNew: handleNewBase,
    handleCancel: handleCancelBase,
    handleStartEdit,
  } = useMasterDetailState<WorkCenter, WorkCenterInput>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromWorkCenter,
    defaultSortField: "code",
    confirmUnsavedChanges: () => confirmDialog.confirm({
      title: "Discard Changes",
      message: "You have unsaved changes. Discard them?",
      confirmText: "Discard",
      cancelText: "Keep Editing",
      confirmColor: "warning",
    }),
  });

  const { filteredBranches } = useReferenceData(["branches"]);
  const branches = filteredBranches || [];

  const { data: workCenters, isLoading } = useQuery({
    queryKey: ["mfg-work-centers"],
    queryFn: () => workCentersApi.getAll(),
  });

  // Keep the open detail in sync with the latest list data (load figures move
  // as orders are released and time is booked).
  useEffect(() => {
    if (!selectedWorkCenter || !workCenters || isEditing) return;
    const fresh = workCenters.find((w) => w.id === selectedWorkCenter.id);
    if (fresh && fresh !== selectedWorkCenter) setSelectedWorkCenter(fresh);
  }, [workCenters]); // eslint-disable-line react-hooks/exhaustive-deps

  const canCreate = usePermission("work_centers", "create");
  const canUpdate = usePermission("work_centers", "update");
  const canDelete = usePermission("work_centers", "delete");

  const getBranchDisplay = useCallback((branchCode?: string | null) => {
    if (!branchCode) return "All branches";
    const branch = branches.find((b) => b.branch_code === branchCode);
    return branch ? `${branch.branch_code} - ${branch.branch_name}` : branchCode;
  }, [branches]);

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterStatus(null);
    setFilterBranch(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const rows: WorkCenterRow[] = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return (workCenters || [])
      .filter((wc) => !q || wc.code.toLowerCase().includes(q) || wc.name.toLowerCase().includes(q))
      .filter((wc) => !filterStatus || (filterStatus === "active") === wc.active)
      .filter((wc) => !filterBranch || !wc.branch_code || wc.branch_code === filterBranch)
      .map((wc) => ({
        ...wc,
        branch_display: getBranchDisplay(wc.branch_code),
        efficiency_num: Number(wc.efficiency_pct),
        labor_num: Number(wc.labor_rate_per_hour),
        overhead_num: Number(wc.overhead_rate_per_hour),
        load_hours: Math.round((Number(wc.open_load_minutes) / 60) * 10) / 10,
        status_key: wc.active ? "active" : "inactive",
      }));
  }, [workCenters, searchQuery, filterStatus, filterBranch, getBranchDisplay]);

  const afterSave = (saved: WorkCenter) => {
    setIsCreating(false);
    setIsEditing(false);
    setTouched({});
    setTimeout(() => handleSelectItem(saved), 0);
  };

  const createMutation = useCrudMutation({
    mutationFn: workCentersApi.create,
    invalidateQueryKeys: [["mfg-work-centers"]],
    successMessage: "Work center created",
    errorMessage: "Failed to create work center",
    onSuccess: afterSave,
  });

  const updateMutation = useCrudMutation({
    mutationFn: workCentersApi.update,
    invalidateQueryKeys: [["mfg-work-centers"]],
    successMessage: "Work center updated",
    errorMessage: "Failed to update work center",
    onSuccess: afterSave,
  });

  const deleteMutation = useCrudMutation({
    mutationFn: workCentersApi.delete,
    invalidateQueryKeys: [["mfg-work-centers"]],
    successMessage: "Work center deleted",
    errorMessage: "Failed to delete work center",
    onSuccess: () => setSelectedWorkCenter(null),
  });

  // Blocks a second Save click before the first one has settled.
  const savingRef = useRef(false);
  const isSaving = createMutation.isPending || updateMutation.isPending;

  const isFormValid =
    !!formData.code.trim() &&
    !!formData.name.trim() &&
    formData.capacity >= 1 &&
    formData.efficiency_pct >= 1 && formData.efficiency_pct <= 300 &&
    formData.working_hours_per_day > 0 && formData.working_hours_per_day <= 24 &&
    formData.labor_rate_per_hour >= 0 &&
    formData.overhead_rate_per_hour >= 0;

  const handleSave = useCallback(() => {
    if (savingRef.current) return;
    const payload: WorkCenterInput = {
      ...formData,
      code: formData.code.trim(),
      name: formData.name.trim(),
      description: formData.description?.trim() || null,
      branch_code: formData.branch_code || null,
    };
    savingRef.current = true;
    const settle = { onSettled: () => { savingRef.current = false; } };
    if (isCreating) {
      createMutation.mutate(payload, settle);
    } else if (selectedWorkCenter) {
      updateMutation.mutate({ id: selectedWorkCenter.id, data: payload }, settle);
    } else {
      savingRef.current = false;
    }
  }, [formData, isCreating, selectedWorkCenter, createMutation, updateMutation]);

  const handleDelete = useCallback(async () => {
    if (!selectedWorkCenter) return;
    const confirmed = await confirmDialog.confirm({
      title: "Delete Work Center",
      message: `Delete work center "${selectedWorkCenter.code} - ${selectedWorkCenter.name}"? A work center used by a BOM or production order cannot be deleted; deactivate it instead.`,
      confirmText: "Delete",
      confirmColor: "error",
    });
    if (confirmed) deleteMutation.mutate(selectedWorkCenter.id);
  }, [selectedWorkCenter, confirmDialog, deleteMutation]);

  const handleNew = useCallback(() => {
    handleNewBase();
    setTouched({});
  }, [handleNewBase]);

  // Cancelling out of "New" returns to the browse table rather than opening the first row.
  const handleCancel = useCallback(() => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedWorkCenter(null);
    } else {
      handleCancelBase(rows);
    }
    setTouched({});
  }, [isCreating, handleCancelBase, rows, setIsCreating, setIsEditing, setSelectedWorkCenter]);

  const handleBack = useCallback(() => {
    setSelectedWorkCenter(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [isCreating, setSelectedWorkCenter, setIsCreating, setIsEditing]);

  const isDetailMode = !!selectedWorkCenter || isCreating;
  const readOnly = !isEditing && !isCreating;
  const showError = (field: string) => touched[field] || isCreating;

  const columns: TDataGridColumn<WorkCenterRow>[] = useMemo(
    () => [
      {
        field: "code",
        header: "Code",
        width: 130,
        renderCell: (params: GridRenderCellParams<WorkCenterRow>) => (
          <Typography variant="body2" fontWeight={600}>{params.row.code}</Typography>
        ),
      },
      { field: "name", header: "Name", flex: 1, minWidth: 180 },
      { field: "branch_display", header: "Branch", width: 170 },
      { field: "capacity", header: "Capacity", width: 95, type: "number" },
      {
        field: "efficiency_num",
        header: "Efficiency",
        width: 105,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<WorkCenterRow>) => `${params.row.efficiency_num}%`,
      },
      { field: "labor_num", header: `Labour/h (${currencySymbol})`, width: 130, type: "currency" },
      { field: "overhead_num", header: `Overhead/h (${currencySymbol})`, width: 140, type: "currency" },
      {
        field: "load_hours",
        header: "Open Load",
        width: 110,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<WorkCenterRow>) => `${params.row.load_hours} h`,
      },
      { field: "open_operations", header: "Open Ops", width: 95, type: "number" },
      {
        field: "status_key",
        header: "Status",
        width: 110,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<WorkCenterRow>) => (
          <TStatusChip status={params.row.status_key} statusMap="activeInactive" size="small" />
        ),
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<WorkCenterRow>) => (
          <Tooltip title="Open">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleSelectItem(params.row); }}>
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [currencySymbol, handleSelectItem]
  );

  const tablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<WorkCenterRow>
          rows={rows}
          columns={columns}
          loading={isLoading}
          onRowClick={(row) => handleSelectItem(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No work centers found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Hourly cost the center charges a production order (labour + overhead).
  const hourlyCost = (Number(formData.labor_rate_per_hour) || 0) + (Number(formData.overhead_rate_per_hour) || 0);
  const capacityMinutesPerDay = (formData.working_hours_per_day || 0) * 60 * (formData.capacity || 0);

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Manufacturing", href: "/manufacturing" },
          { label: "Work Centers", href: "/manufacturing/work-centers" },
          ...(isDetailMode ? [{ label: isCreating ? "New Work Center" : selectedWorkCenter?.code || "" }] : []),
        ]}
        title={selectedWorkCenter ? `${selectedWorkCenter.code} - ${selectedWorkCenter.name}` : ""}
        titleIcon={<FactoryIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Work Center"
        noSelectionTitle="Select a Work Center"
      />

      <ActionToolbar
        hasSelectedItem={!!selectedWorkCenter}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={isFormValid}
        canCreate={canCreate}
        canUpdate={canUpdate}
        canDelete={canDelete}
        canDuplicate={false}
        onNew={handleNew}
        onEdit={handleStartEdit}
        onSave={handleSave}
        onCancel={handleCancel}
        onDelete={handleDelete}
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!isDetailMode ? (
          <EmptyState message="Select a work center from the list or create a new one" />
        ) : (
          <>
            <FormSection title="Work Center" columns={3}>
              <TextField
                label="Code"
                size="small"
                required
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                onBlur={() => handleBlur("code")}
                disabled={readOnly}
                inputProps={{ maxLength: 30 }}
                error={showError("code") && !formData.code.trim()}
                helperText={showError("code") && !formData.code.trim() ? "Code is required" : undefined}
              />
              <TextField
                label="Name"
                size="small"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                onBlur={() => handleBlur("name")}
                disabled={readOnly}
                inputProps={{ maxLength: 150 }}
                error={showError("name") && !formData.name.trim()}
                helperText={showError("name") && !formData.name.trim() ? "Name is required" : undefined}
              />
              <Autocomplete
                size="small"
                options={branches}
                getOptionLabel={(b) => `${b.branch_code} - ${b.branch_name}`}
                value={branches.find((b) => b.branch_code === formData.branch_code) || null}
                onChange={(_, b) => setFormData({ ...formData, branch_code: b?.branch_code || null })}
                disabled={readOnly}
                renderInput={(params) => (
                  <TextField {...params} label="Branch" placeholder="All branches"
                    helperText="Leave empty to share the center across branches" />
                )}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.active}
                    onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                    disabled={readOnly}
                  />
                }
                label={formData.active ? "Active" : "Inactive"}
              />
            </FormSection>

            <FormSection title="Capacity" columns={3}>
              <TextField
                label="Capacity (parallel operations)"
                size="small"
                type="number"
                required
                value={formData.capacity}
                onChange={(e) => setFormData({ ...formData, capacity: Math.floor(numberOrZero(e.target.value)) })}
                disabled={readOnly}
                inputProps={{ min: 1, max: 1000, step: 1 }}
                error={formData.capacity < 1}
                helperText={formData.capacity < 1 ? "At least 1" : "Machines / stations working at once"}
              />
              <TextField
                label="Efficiency"
                size="small"
                type="number"
                required
                value={formData.efficiency_pct}
                onChange={(e) => setFormData({ ...formData, efficiency_pct: numberOrZero(e.target.value) })}
                disabled={readOnly}
                inputProps={{ min: 1, max: 300, step: 1 }}
                InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
                error={formData.efficiency_pct < 1 || formData.efficiency_pct > 300}
                helperText="Planned minutes are divided by this"
              />
              <TextField
                label="Working Hours / Day"
                size="small"
                type="number"
                required
                value={formData.working_hours_per_day}
                onChange={(e) => setFormData({ ...formData, working_hours_per_day: numberOrZero(e.target.value) })}
                disabled={readOnly}
                inputProps={{ min: 0.5, max: 24, step: 0.5 }}
                error={formData.working_hours_per_day <= 0 || formData.working_hours_per_day > 24}
                helperText={`${capacityMinutesPerDay.toLocaleString()} capacity minutes per day`}
              />
            </FormSection>

            <FormSection title="Costing" columns={3}>
              <TextField
                label={`Labour Rate / Hour (${currencySymbol})`}
                size="small"
                type="number"
                value={formData.labor_rate_per_hour}
                onChange={(e) => setFormData({ ...formData, labor_rate_per_hour: numberOrZero(e.target.value) })}
                disabled={readOnly}
                inputProps={{ min: 0, step: 0.01 }}
              />
              <TextField
                label={`Overhead Rate / Hour (${currencySymbol})`}
                size="small"
                type="number"
                value={formData.overhead_rate_per_hour}
                onChange={(e) => setFormData({ ...formData, overhead_rate_per_hour: numberOrZero(e.target.value) })}
                disabled={readOnly}
                inputProps={{ min: 0, step: 0.01 }}
              />
              <TextField
                label={`Total Cost / Hour (${currencySymbol})`}
                size="small"
                value={fmtLKR(hourlyCost)}
                disabled
                helperText="Absorbed into production orders per hour booked"
              />
            </FormSection>

            <FormSection title="Description" columns={1}>
              <TRemarkField
                label="Description"
                size="small"
                value={formData.description || ""}
                onChange={(value) => setFormData({ ...formData, description: value })}
                disabled={readOnly}
                multiline
                rows={2}
              />
            </FormSection>

            {selectedWorkCenter && !isCreating && !isEditing && (
              <>
                <FormSection title="Current Load" columns={3}>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Open Operations</Typography>
                    <Typography variant="body2" fontWeight={600}>{selectedWorkCenter.open_operations}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Open Load</Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {(Number(selectedWorkCenter.open_load_minutes) / 60).toFixed(1)} h
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Load (working days)</Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {capacityMinutesPerDay > 0
                        ? (Number(selectedWorkCenter.open_load_minutes) / capacityMinutesPerDay).toFixed(1)
                        : "-"}
                    </Typography>
                  </Box>
                </FormSection>

                <FormSection
                  title="Activity History"
                  columns={2}
                  titleAction={
                    <Tooltip title="View activity history">
                      <IconButton size="small" onClick={() => setActivityHistoryOpen(true)}>
                        <HistoryIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  }
                >
                  <Box>
                    <Typography variant="caption" color="text.secondary">Created</Typography>
                    <Typography variant="body2">{formatDateTimeReadable(selectedWorkCenter.created_at) || "-"}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Last Updated</Typography>
                    <Typography variant="body2">{formatDateTimeReadable(selectedWorkCenter.updated_at) || "-"}</Typography>
                  </Box>
                </FormSection>
              </>
            )}
          </>
        )}
      </Box>
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title="Work Centers"
        titleSlot={
          isDetailMode ? (
            <Button size="small" startIcon={<ArrowBackIcon fontSize="small" />} onClick={handleBack} sx={{ textTransform: "none" }}>
              Back to Work Centers
            </Button>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search work centers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                }}
                sx={{ width: 210, flexShrink: 0 }}
              />
              <Box sx={{ width: 150, flexShrink: 0 }}>
                <TStatusFilter options={ACTIVE_FILTER_OPTIONS} value={filterStatus} onChange={setFilterStatus} label="" placeholder="All Statuses" size="small" />
              </Box>
              <Box sx={{ width: 160, flexShrink: 0 }}>
                <TBranchFilter branches={branches} value={filterBranch} onChange={setFilterBranch} label="" placeholder="All Branches" size="small" />
              </Box>
              {(searchQuery || filterStatus || filterBranch) && (
                <Button size="small" onClick={handleClearFilters} sx={{ textTransform: "none" }}>
                  Clear
                </Button>
              )}
            </Box>
          )
        }
        onRefresh={() => queryClient.invalidateQueries({ queryKey: ["mfg-work-centers"] })}
        isLoading={isLoading}
        {...(isDetailMode ? { children: detailPanel } : { children: tablePanel })}
        headerActions={
          isDetailMode || !canCreate ? undefined : (
            <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={handleNew} sx={{ mr: 1 }}>
              Add Work Center
            </Button>
          )
        }
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
      <TActivityHistoryPanel
        open={activityHistoryOpen}
        onClose={() => setActivityHistoryOpen(false)}
        entityType="work_center"
        entityId={selectedWorkCenter?.id}
        actionLabels={{
          create: "Work center created",
          update: "Work center updated",
          delete: "Work center deleted",
        }}
      />
    </>
  );
}
