/**
 * BranchesPage - Refactored to use Tijaero-style reusable components
 * 
 * This page demonstrates how to use the Tijaero component library:
 * - MasterDetailLayout for overall page structure (browse table + single-record detail toggle)
 * - TDataGrid for the browse table
 * - DetailPanelHeader for detail panel header
 * - ActionToolbar for action buttons
 * - FormSection for form sections
 * - EmptyState for empty states
 * - useMasterDetailState hook for state management
 * - Single location field per branch
 */

import AddIcon from "@mui/icons-material/Add";
import BusinessIcon from "@mui/icons-material/Business";
import HistoryIcon from "@mui/icons-material/History";
import SearchIcon from "@mui/icons-material/Search";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import {
  Avatar,
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState, useEffect } from "react";

// Tijaero Components - Import everything from one place
import {
  TChip,
    ActionToolbar,
    DetailPanelHeader,
    EmptyState,
    FormSection,
    MasterDetailLayout,
    TDetailSkeleton,
    useMasterDetailState,
    TConfirmDialog,
    useConfirmDialog,
    handleApiError,
    showErrorToast,
    showSuccessToast,
    TActivityHistoryPanel,
    TStatusFilter,
    type TFilterStatusOption,
    TDataGrid,
    SelectableListItem,
    type TDataGridColumn,
    TPhoneField,
    normalizePhone,
    isValidPhone,
} from "@/components/tijaero";
import { formatDateTimeReadable } from "@/utils/formatters";
import { usePermission } from "@/auth/components/PermissionGuard";
import { PERMISSIONS } from "@/auth/permissions";

import type { Branch, BranchCreate } from "@/api/types";
import { locationsApi } from "@/modules/common/api";
import { branchApi } from "../api";

// Configuration - Define once, use everywhere
const BRANCH_STATUS_OPTIONS: TFilterStatusOption[] = [
  { value: null, label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const INITIAL_FORM_DATA: BranchCreate = {
  branch_name: "",
  branch_code: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  postal_code: "",
  email: "",
  contact_number: "",
  active: true,
};

// Server-side column limits (backend Branch model / BranchCreate schema).
const MAX_LEN = { code: 255, name: 255, email: 75, line: 255, city: 120, state: 120, postal: 20 } as const;

const resetFormFromBranch = (branch: Branch): BranchCreate => ({
  branch_name: branch.branch_name,
  branch_code: branch.branch_code,
  address_line1: branch.address_line1 || "",
  address_line2: branch.address_line2 || "",
  city: branch.city || "",
  state: branch.state || "",
  postal_code: branch.postal_code || "",
  email: branch.email || "",
  contact_number: normalizePhone(branch.contact_number),
  active: branch.active,
});

export default function BranchesPage() {
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();

  // Permissions
  const canCreate = usePermission(PERMISSIONS.BRANCH_CREATE.resource, PERMISSIONS.BRANCH_CREATE.action);
  const canUpdate = usePermission(PERMISSIONS.BRANCH_UPDATE.resource, PERMISSIONS.BRANCH_UPDATE.action);
  // Each branch has exactly one location, edited as a plain form field.
  const [locationName, setLocationName] = useState("");

  // Form validation errors
  const [branchCodeError, setBranchCodeError] = useState<string | null>(null);
  const [branchNameError, setBranchNameError] = useState<string | null>(null);
  const [branchEmailError, setBranchEmailError] = useState<string | null>(null);

  // Filter state - all filters apply live as the user types/selects, no
  // separate "Search" step needed.
  const [filterStatus, setFilterStatus] = useState<string | null>(null);

  // Use the reusable state management hook
  const {
    searchQuery,
    setSearchQuery,
    selectedItem: selectedBranch,
    setSelectedItem: setSelectedBranch,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    formData,
    setFormData,
    markAsSaved,
    handleSelectItem: handleSelectBranch,
    handleNew: handleNewBranch,
    handleCancel: handleCancelBase,
    handleStartEdit,
  } = useMasterDetailState<Branch, BranchCreate>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromBranch,
    defaultSortField: "branch_code",
    confirmUnsavedChanges: () => confirmDialog.confirm({
      title: "Discard Changes",
      message: "You have unsaved changes. Discard them?",
      confirmText: "Discard",
      cancelText: "Keep Editing",
      confirmColor: "warning",
    }),
  });

  // Activity History is opened on demand from a detail icon next to the
  // Activity History section title, rather than shown inline.
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterStatus(null);
  }, [setSearchQuery]);

  // Data fetching
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["branches"],
    queryFn: () => branchApi.getAll(1, 100),
  });

  // Locations data fetching - fetch locations for the selected branch
  const { data: locations } = useQuery({
    queryKey: ["locations", selectedBranch?.branch_code],
    queryFn: () => selectedBranch ? locationsApi.getAll(selectedBranch.branch_code) : Promise.resolve([]),
    enabled: !!selectedBranch && !isCreating, // Only fetch for existing branches
  });

  // Filter and sort branches
  const filteredBranches = useMemo(() => {
    if (!data?.items) return [];

    let filtered = data.items.filter(
      (branch) =>
        branch.branch_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        branch.branch_name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (filterStatus) {
      const isActive = filterStatus === "active";
      filtered = filtered.filter((branch) => branch.active === isActive);
    }

    // Default order before the user sorts a column in the browse table
    // itself (the table's own column-header sort takes over from there).
    filtered.sort((a, b) => a.branch_code.localeCompare(b.branch_code));

    return filtered;
  }, [data?.items, searchQuery, filterStatus]);

  // The branch's single location, shown in the form. Reset whenever the
  // selection changes or an edit is cancelled.
  const savedLocation = locations?.[0];
  useEffect(() => {
    setLocationName(isCreating ? "" : savedLocation?.name ?? "");
  }, [isCreating, isEditing, selectedBranch?.id, savedLocation?.name]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: branchApi.create,
    onSuccess: async (newBranch) => {
      
      try {
        await locationsApi.create({ name: locationName.trim(), branch_code: newBranch.branch_code });
      } catch (error) {
        showErrorToast("Branch created but its location failed to save");
      }

      queryClient.invalidateQueries({ queryKey: ["branches"] });
      queryClient.invalidateQueries({ queryKey: ["locations", newBranch.branch_code] });
      showSuccessToast("Branch created successfully");
      markAsSaved();
      // Reset state first to avoid "unsaved changes" prompt
      setIsCreating(false);
      setIsEditing(false);
      // Then select the new branch (with slight delay to allow state update)
      setTimeout(() => handleSelectBranch(newBranch), 0);
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to create branch"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: BranchCreate }) =>
      branchApi.update(id, data),
    onSuccess: async (updatedBranch) => {
      const name = locationName.trim();
      try {
        if (savedLocation && savedLocation.name !== name) {
          await locationsApi.update(savedLocation.id, { name, branch_code: savedLocation.branch_code });
        } else if (!savedLocation) {
          await locationsApi.create({ name, branch_code: updatedBranch.branch_code });
        }
        queryClient.invalidateQueries({ queryKey: ["locations", updatedBranch.branch_code] });
      } catch (error) {
        showErrorToast("Branch updated but its location failed to save");
      }
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      showSuccessToast("Branch updated successfully");
      markAsSaved();
      setIsEditing(false);
      setSelectedBranch(updatedBranch);
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to update branch"));
    },
  });

  // Handlers
  const saveBranch = useCallback(async () => {
    setBranchCodeError(null);
    setBranchNameError(null);
    setBranchEmailError(null);

    if (!formData.address_line1?.trim() || !formData.city?.trim()) {
      showErrorToast("Address Line 1 and City are required");
      return;
    }

    if (!locationName.trim()) {
      showErrorToast("Location is required");
      return;
    }

    const excludeId = isCreating ? undefined : selectedBranch?.id;

    if (formData.branch_code.trim()) {
      const codeExists = await branchApi.checkCodeExists(formData.branch_code.trim(), excludeId);
      if (codeExists) {
        setBranchCodeError("Branch code already exists");
        showErrorToast("Branch code already exists");
        return;
      }
    }

    if (formData.branch_name.trim()) {
      const nameExists = await branchApi.checkNameExists(formData.branch_name.trim(), excludeId);
      if (nameExists) {
        setBranchNameError("Branch name already exists");
        showErrorToast("Branch name already exists");
        return;
      }
    }

    if (formData.email?.trim()) {
      const emailExists = await branchApi.checkEmailExists(formData.email.trim(), excludeId);
      if (emailExists) {
        setBranchEmailError("Email already exists");
        showErrorToast("Email already exists");
        return;
      }
    }

    // Awaited (errors are already toasted by the mutations' onError) so the
    // in-flight guard in handleSave covers the whole save, not just the checks.
    if (isCreating) {
      await createMutation.mutateAsync(formData).catch(() => undefined);
    } else if (selectedBranch) {
      await updateMutation.mutateAsync({ id: selectedBranch.id, data: formData }).catch(() => undefined);
    }
  }, [isCreating, isEditing, selectedBranch, formData, locationName, createMutation, updateMutation]);

  // A double-click (or Enter + click) used to start two saves: both passed the
  // duplicate checks before either had created the branch, so the first
  // succeeded and the second showed "Branch code already exists". Ignore a save
  // while one is running.
  const saveInFlight = useRef(false);
  const [checking, setChecking] = useState(false);
  const handleSave = useCallback(async () => {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    setChecking(true);
    try {
      await saveBranch();
    } finally {
      saveInFlight.current = false;
      setChecking(false);
    }
  }, [saveBranch]);

  const handleDuplicate = useCallback(() => {
    if (selectedBranch) {
      setFormData({
        ...formData,
        branch_code: `${selectedBranch.branch_code}-COPY`,
        branch_name: `${selectedBranch.branch_name} (Copy)`,
        email: "",
      });
      handleNewBranch();
    }
  }, [selectedBranch, formData, setFormData, handleNewBranch]);

  const isFormValid = formData.branch_code.trim() && formData.branch_name.trim() && formData.address_line1?.trim() && formData.city?.trim() && locationName.trim() && isValidPhone(formData.contact_number);
  const isSaving = checking || createMutation.isPending || updateMutation.isPending;

  // Cancelling out of "New Branch" should return to the browse table, not
  // auto-open the first branch the way useMasterDetailState's generic
  // handleCancel does (that behavior made sense for the old always-visible
  // detail panel, but not here). Cancelling out of editing an existing
  // branch still just reverts its form, which the generic handler already
  // does correctly.
  const handleCancel = useCallback((items: Branch[]) => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedBranch(null);
    } else {
      handleCancelBase(items);
    }
  }, [isCreating, handleCancelBase, setIsCreating, setIsEditing, setSelectedBranch]);

  // Returns to the browse table from the detail view (the "Back to
  // Branches" link above the detail header).
  const handleBackToBranches = useCallback(() => {
    setSelectedBranch(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [isCreating, setSelectedBranch, setIsCreating, setIsEditing]);

  // Whether we're showing a single branch's detail view (selected or being
  // created) instead of the browse table.
  const isBranchDetailMode = !!selectedBranch || isCreating;

  // Browse mode: a full-width table of every branch. Sorting is done
  // per-column via the grid's own column header menu, not a separate
  // "Sort by" control.
  const branchColumns: TDataGridColumn<Branch>[] = useMemo(
    () => [
      { field: "branch_code", header: "Branch Code", width: 140 },
      { field: "branch_name", header: "Name", flex: 1, minWidth: 200 },
      { field: "address", header: "Address", flex: 1, minWidth: 200 },
      { field: "contact_number", header: "Contact No", width: 150 },
      {
        field: "active",
        header: "Status",
        width: 110,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<Branch>) => (
          <TChip
            label={params.row.active ? "Active" : "Inactive"}
            size="small"
            color={params.row.active ? "success" : "default"}
          />
        ),
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<Branch>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectBranch(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [handleSelectBranch]
  );

  const branchTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<Branch>
          rows={filteredBranches}
          columns={branchColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectBranch(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No branches found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Render Detail Panel
  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Branches", href: "#" },
          ...(selectedBranch || isCreating
            ? [{ label: isCreating ? "New Branch" : selectedBranch?.branch_code || "" }]
            : []),
        ]}
        title={
          selectedBranch
            ? `${selectedBranch.branch_code} - ${selectedBranch.branch_name}`
            : ""
        }
        chips={
          selectedBranch
            ? [{ label: selectedBranch.active ? "Active" : "Inactive", color: selectedBranch.active ? "success" : "error", size: "small" }]
            : undefined
        }
        titleIcon={<BusinessIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Branch"
        noSelectionTitle="Select a Branch"
      />

      {/* Toolbar */}
      <ActionToolbar
        canCreate={canCreate}
        canUpdate={canUpdate}
        hasSelectedItem={!!selectedBranch}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={!!isFormValid}
        onNew={handleNewBranch}
        onDuplicate={handleDuplicate}
        onSave={handleSave}
        onCancel={() => handleCancel(filteredBranches)}
        onEdit={handleStartEdit}
      />

      {/* Content */}
      <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
        {!selectedBranch && !isCreating ? (
          <EmptyState message="Select a branch from the list or create a new one" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} />
        ) : (
          <FormSection title="Branch Information" columns={2}>
            <TextField
              label="Branch Code"
              size="small"
              value={formData.branch_code}
              onChange={(e) => {
                setFormData({ ...formData, branch_code: e.target.value.toUpperCase() });
                setBranchCodeError(null);
              }}
              disabled={!isCreating}
              required
              inputProps={{ style: { textTransform: "uppercase" }, maxLength: MAX_LEN.code }}
              error={!!branchCodeError}
              helperText={branchCodeError}
            />
            <TextField
              label="Branch Name"
              size="small"
              value={formData.branch_name}
              onChange={(e) => {
                setFormData({ ...formData, branch_name: e.target.value });
                setBranchNameError(null);
              }}
              disabled={!isCreating}
              required
              inputProps={{ maxLength: MAX_LEN.name }}
              error={!!branchNameError}
              helperText={branchNameError}
            />
            <TextField
              label="Email"
              size="small"
              type="email"
              value={formData.email}
              onChange={(e) => {
                setFormData({ ...formData, email: e.target.value });
                setBranchEmailError(null);
              }}
              disabled={!isEditing && !isCreating}
              inputProps={{ maxLength: MAX_LEN.email }}
              error={!!branchEmailError}
              helperText={branchEmailError}
            />
            <TPhoneField
              label="Contact No"
              value={formData.contact_number}
              onChange={(v) => setFormData({ ...formData, contact_number: v })}
              disabled={!isEditing && !isCreating}
            />
            <Box sx={{ display: "flex", alignItems: "center" }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.active ?? true}
                    onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                    disabled={!isEditing && !isCreating}
                    color="success"
                  />
                }
                label={
                  <Typography variant="body2" color={formData.active ? "success.main" : "text.secondary"}>
                    {formData.active ? "Active" : "Inactive"}
                  </Typography>
                }
              />
            </Box>
          </FormSection>
        )}

        {/* Address — same structured layout as the Supplier page (line 1/2, city, state, postal code) */}
        {(selectedBranch || isCreating) && !(isLoading && !isCreating) && (
          <FormSection title="Address" columns={2}>
            <TextField
              label="Address Line 1"
              size="small"
              required
              value={formData.address_line1}
              onChange={(e) => setFormData({ ...formData, address_line1: e.target.value })}
              disabled={!isEditing && !isCreating}
              inputProps={{ maxLength: MAX_LEN.line }}
            />
            <TextField
              label="Address Line 2"
              size="small"
              value={formData.address_line2}
              onChange={(e) => setFormData({ ...formData, address_line2: e.target.value })}
              disabled={!isEditing && !isCreating}
              inputProps={{ maxLength: MAX_LEN.line }}
            />
            <TextField
              label="City"
              size="small"
              required
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              disabled={!isEditing && !isCreating}
              inputProps={{ maxLength: MAX_LEN.city }}
            />
            <TextField
              label="State / Province"
              size="small"
              value={formData.state}
              onChange={(e) => setFormData({ ...formData, state: e.target.value })}
              disabled={!isEditing && !isCreating}
              inputProps={{ maxLength: MAX_LEN.state }}
            />
            <TextField
              label="Postal Code"
              size="small"
              value={formData.postal_code}
              onChange={(e) => setFormData({ ...formData, postal_code: e.target.value })}
              disabled={!isEditing && !isCreating}
              inputProps={{ maxLength: MAX_LEN.postal }}
            />
            <TextField
              label="Location"
              size="small"
              required
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
              disabled={!isEditing && !isCreating}
              placeholder="e.g., Main Warehouse"
              inputProps={{ maxLength: 255 }}
            />
          </FormSection>
        )}

        {/* Activity History (view mode only) */}
        {selectedBranch && !isCreating && !isEditing && (
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
              <Typography variant="caption" color="text.secondary">Created By</Typography>
              <Typography variant="body2">
                {selectedBranch.created_by_name || "-"}
                {selectedBranch.created_at ? ` on ${formatDateTimeReadable(selectedBranch.created_at)}` : ""}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Last Modified By</Typography>
              <Typography variant="body2">
                {selectedBranch.updated_by_name || "-"}
                {selectedBranch.updated_at ? ` on ${formatDateTimeReadable(selectedBranch.updated_at)}` : ""}
              </Typography>
            </Box>
          </FormSection>
        )}
      </Box>
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title="Branches"
        titleSlot={
          isBranchDetailMode ? (
          <Button
            size="small"
            startIcon={<ArrowBackIcon fontSize="small" />}
            onClick={handleBackToBranches}
            sx={{ textTransform: "none" }}
          >
            Back to Branches
          </Button>
          ) : (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <TextField
              size="small"
              placeholder="Branch code or name"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              }}
              sx={{ width: 190, flexShrink: 0, "& .MuiOutlinedInput-root": { borderRadius: "24px" } }}
            />
            <Box sx={{ width: 150, flexShrink: 0 }}>
              <TStatusFilter
                options={BRANCH_STATUS_OPTIONS}
                value={filterStatus}
                onChange={setFilterStatus}
                label=""
                placeholder="All Status"
                size="small"
              />
            </Box>
            {(searchQuery || filterStatus) && (
              <Button size="small" onClick={handleClearFilters} sx={{ textTransform: "none" }}>
                Clear
              </Button>
            )}
          </Box>
          )
        }
        onRefresh={refetch}
        isLoading={isLoading}
        headerActions={
          isBranchDetailMode ? undefined : (
            <>
              {canCreate && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={handleNewBranch}
                  sx={{ mr: 1 }}
                >
                  Add Branch
                </Button>
              )}
            </>
          )
        }
        {...(isBranchDetailMode ? { children: detailPanel } : { children: branchTablePanel })}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
      

      <TActivityHistoryPanel
        open={activityHistoryOpen}
        onClose={() => setActivityHistoryOpen(false)}
        entityType="branch"
        entityId={selectedBranch?.id}
        actionLabels={{
          create: "Branch created",
          update: "Branch updated",
          delete: "Branch deleted",
        }}
      />
    </>
  );
}
