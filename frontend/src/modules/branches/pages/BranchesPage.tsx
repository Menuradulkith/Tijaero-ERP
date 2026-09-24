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
 * - Locations management section
 */

import AddIcon from "@mui/icons-material/Add";
import BusinessIcon from "@mui/icons-material/Business";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import HistoryIcon from "@mui/icons-material/History";
import InventoryIcon from "@mui/icons-material/Inventory";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import MonetizationOnIcon from "@mui/icons-material/MonetizationOn";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import StarIcon from "@mui/icons-material/Star";
import StarOutlineIcon from "@mui/icons-material/StarBorder";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import {
    Avatar,
    Box,
    Button,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControlLabel,
    Grid,
    IconButton,
    InputAdornment,
    List,
    ListItem,
    ListItemSecondaryAction,
    ListItemText,
    Paper,
    Switch,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState, useEffect } from "react";

// Tijaero Components - Import everything from one place
import {
    ActionToolbar,
    DetailPanelHeader,
    EmptyState,
    FormSection,
    MasterDetailLayout,
    TDetailSkeleton,
    TExportButton,
    useMasterDetailState,
    TConfirmDialog,
    useConfirmDialog,
    handleApiError,
    showErrorToast,
    showSuccessToast,
    TActivityHistoryPanel,
    TStatusFilter,
    fmtLKR,
    type TFilterStatusOption,
    TDataGrid,
    SelectableListItem,
    type TDataGridColumn,
} from "@/components/tijaero";
import { KpiSparkCard } from "@/components/dashboard";
import { formatDateTimeReadable } from "@/utils/formatters";
import { usePermission } from "@/auth/components/PermissionGuard";
import { PERMISSIONS } from "@/auth/permissions";

import type { Branch, BranchCreate } from "@/api/types";
import { Location, LocationCreate, locationsApi } from "@/modules/common/api";
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
  address: "",
  email: "",
  contact_number: "",
  active: true,
};

const resetFormFromBranch = (branch: Branch): BranchCreate => ({
  branch_name: branch.branch_name,
  branch_code: branch.branch_code,
  address: branch.address || "",
  email: branch.email || "",
  contact_number: branch.contact_number || "",
  active: branch.active,
});

export default function BranchesPage() {
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();

  // Permissions
  const canCreate = usePermission(PERMISSIONS.BRANCH_CREATE.resource, PERMISSIONS.BRANCH_CREATE.action);
  const canUpdate = usePermission(PERMISSIONS.BRANCH_UPDATE.resource, PERMISSIONS.BRANCH_UPDATE.action);
  const canDelete = usePermission(PERMISSIONS.BRANCH_DELETE.resource, PERMISSIONS.BRANCH_DELETE.action);

  // Location dialog state
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [locationName, setLocationName] = useState("");

  // Track locations for the current branch being created/edited
  const [branchLocations, setBranchLocations] = useState<Location[]>([]);

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
    favorites,
    toggleFavorite,
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
    favoritesKey: "branches_favorites",
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
  const { data: locations, isLoading: locationsLoading } = useQuery({
    queryKey: ["locations", selectedBranch?.branch_code],
    queryFn: () => selectedBranch ? locationsApi.getAll(selectedBranch.branch_code) : Promise.resolve([]),
    enabled: !!selectedBranch && !isCreating, // Only fetch for existing branches
  });

  // Performance widget - quick sales/stock KPIs for the selected branch
  const { data: performance, isLoading: performanceLoading } = useQuery({
    queryKey: ["branch-performance", selectedBranch?.id],
    queryFn: () => branchApi.getPerformance(selectedBranch!.id),
    enabled: !!selectedBranch && !isCreating,
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

  // Clear branch locations when starting to create a new branch
  useEffect(() => {
    if (isCreating) {
      setBranchLocations([]);
    } else if (selectedBranch && locations) {
      // When selecting an existing branch, load its specific locations
      setBranchLocations(locations);
    }
  }, [isCreating, selectedBranch, locations]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: branchApi.create,
    onSuccess: async (newBranch) => {
      
      // Create locations after branch is created
      if (branchLocations.length > 0) {
        const locationPromises = branchLocations.map(loc => 
          locationsApi.create({ name: loc.name, branch_code: newBranch.branch_code })
        );
        
        try {
          await Promise.all(locationPromises);
        } catch (error) {
          showErrorToast("Branch created but some locations failed to save");
        }
      }
      
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      queryClient.invalidateQueries({ queryKey: ["locations", newBranch.branch_code] });
      showSuccessToast("Branch created successfully");
      markAsSaved();
      // Reset state first to avoid "unsaved changes" prompt
      setIsCreating(false);
      setIsEditing(false);
      setBranchLocations([]);
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
    onSuccess: (updatedBranch) => {
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

  const deleteMutation = useMutation({
    mutationFn: branchApi.delete,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      // Use the success message from backend if available
      showSuccessToast(data?.message || "Branch deleted successfully");
      setSelectedBranch(null);
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to delete branch"));
    },
  });

  // Location mutations
  const createLocationMutation = useMutation({
    mutationFn: locationsApi.create,
    onSuccess: (newLocation) => {
      // Invalidate queries for the specific branch
      const branch_code = isCreating ? formData.branch_code : selectedBranch?.branch_code;
      if (branch_code) {
        queryClient.invalidateQueries({ queryKey: ["locations", branch_code] });
      }
      // If creating a new branch, add location to local state
      if (isCreating) {
        setBranchLocations(prev => [...prev, newLocation]);
      }
      showSuccessToast("Location created successfully");
      handleCloseLocationDialog();
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to create location"));
    },
  });

  const updateLocationMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: LocationCreate }) =>
      locationsApi.update(id, data),
    onSuccess: (updatedLocation) => {
      // Invalidate queries for the specific branch
      const branch_code = isCreating ? formData.branch_code : selectedBranch?.branch_code;
      if (branch_code) {
        queryClient.invalidateQueries({ queryKey: ["locations", branch_code] });
      }
      // If creating a new branch, update location in local state
      if (isCreating) {
        setBranchLocations(prev => 
          prev.map(loc => loc.id === updatedLocation.id ? updatedLocation : loc)
        );
      }
      showSuccessToast("Location updated successfully");
      handleCloseLocationDialog();
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to update location"));
    },
  });

  const deleteLocationMutation = useMutation({
    mutationFn: locationsApi.delete,
    onSuccess: (_, deletedId) => {
      // Invalidate queries for the specific branch
      const branch_code = isCreating ? formData.branch_code : selectedBranch?.branch_code;
      if (branch_code) {
        queryClient.invalidateQueries({ queryKey: ["locations", branch_code] });
      }
      // If creating a new branch, remove location from local state
      if (isCreating) {
        setBranchLocations(prev => prev.filter(loc => loc.id !== deletedId));
      }
      showSuccessToast("Location deleted successfully");
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to delete location"));
    },
  });

  // Handlers
  const handleSave = useCallback(async () => {
    setBranchCodeError(null);
    setBranchNameError(null);
    setBranchEmailError(null);

    if (branchLocations.length === 0) {
      showErrorToast("At least one location is required");
      return;
    }

    const excludeId = isCreating ? undefined : selectedBranch?.id;

    if (formData.branch_code) {
      const codeExists = await branchApi.checkCodeExists(formData.branch_code, excludeId);
      if (codeExists) {
        setBranchCodeError("Branch code already exists");
        showErrorToast("Branch code already exists");
        return;
      }
    }

    if (formData.branch_name) {
      const nameExists = await branchApi.checkNameExists(formData.branch_name, excludeId);
      if (nameExists) {
        setBranchNameError("Branch name already exists");
        showErrorToast("Branch name already exists");
        return;
      }
    }

    if (formData.email) {
      const emailExists = await branchApi.checkEmailExists(formData.email, excludeId);
      if (emailExists) {
        setBranchEmailError("Email already exists");
        showErrorToast("Email already exists");
        return;
      }
    }

    if (isCreating) {
      createMutation.mutate(formData);
    } else if (selectedBranch) {
      updateMutation.mutate({ id: selectedBranch.id, data: formData });
    }
  }, [isCreating, isEditing, selectedBranch, formData, branchLocations, createMutation, updateMutation]);

  const handleDelete = useCallback(async () => {
    if (selectedBranch) {
      const confirmed = await confirmDialog.confirm({
        title: "Delete Branch",
        message: "Are you sure you want to delete this branch?",
        confirmText: "Delete",
        confirmColor: "error",
      });
      if (confirmed) {
        deleteMutation.mutate(selectedBranch.id);
      }
    }
  }, [selectedBranch, deleteMutation, confirmDialog]);

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

  // Location handlers
  const handleOpenLocationDialog = useCallback((location?: Location) => {
    if (location) {
      setEditingLocation(location);
      setLocationName(location.name);
    } else {
      setEditingLocation(null);
      setLocationName("");
    }
    setLocationDialogOpen(true);
  }, []);

  const handleCloseLocationDialog = useCallback(() => {
    setLocationDialogOpen(false);
    setEditingLocation(null);
    setLocationName("");
  }, []);

  const handleSaveLocation = useCallback(() => {
    if (!locationName.trim()) {
      showErrorToast("Location name is required");
      return;
    }
    
    // Get branch_code from formData (for new branch) or selectedBranch (for existing)
    const branch_code = isCreating ? formData.branch_code : selectedBranch?.branch_code;
    
    if (!branch_code) {
      showErrorToast("Please enter branch code first");
      return;
    }
    
    // When creating a new branch, store locations locally (don't create via API yet)
    if (isCreating) {
      if (editingLocation) {
        // Update local location
        setBranchLocations(prev => 
          prev.map(loc => loc.id === editingLocation.id ? { ...loc, name: locationName } : loc)
        );
        showSuccessToast("Location updated");
      } else {
        // Add new local location with temporary ID
        const tempLocation: Location = {
          id: Date.now(), // Temporary ID
          name: locationName,
          branch_code,
          created_date: new Date().toISOString(),
        };
        setBranchLocations(prev => [...prev, tempLocation]);
        showSuccessToast("Location added (will be saved with branch)");
      }
      handleCloseLocationDialog();
    } else {
      // For existing branches, create/update via API immediately
      if (editingLocation) {
        updateLocationMutation.mutate({ 
          id: editingLocation.id, 
          data: { name: locationName, branch_code } 
        });
      } else {
        createLocationMutation.mutate({ name: locationName, branch_code });
      }
    }
  }, [locationName, editingLocation, createLocationMutation, updateLocationMutation, isCreating, formData.branch_code, selectedBranch, handleCloseLocationDialog]);

  const handleDeleteLocation = useCallback(async (location: Location) => {
    const confirmed = await confirmDialog.confirm({
      title: "Delete Location",
      message: `Are you sure you want to delete location "${location.name}"?`,
      confirmText: "Delete",
      confirmColor: "error",
    });
    if (confirmed) {
      if (isCreating) {
        // For new branches, remove from local state
        setBranchLocations(prev => prev.filter(loc => loc.id !== location.id));
        showSuccessToast("Location removed");
      } else {
        // For existing branches, delete via API
        deleteLocationMutation.mutate(location.id);
      }
    }
  }, [confirmDialog, deleteLocationMutation, isCreating]);

  const isFormValid = formData.branch_code && formData.branch_name && branchLocations.length > 0;
  const isSaving = createMutation.isPending || updateMutation.isPending;

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
      {
        field: "favorite",
        header: "",
        width: 48,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<Branch>) => (
          <IconButton size="small" onClick={(e) => toggleFavorite(params.row.id, e)}>
            {favorites.includes(params.row.id) ? (
              <StarIcon fontSize="small" color="warning" />
            ) : (
              <StarOutlineIcon fontSize="small" color="action" />
            )}
          </IconButton>
        ),
      },
      { field: "branch_code", header: "Branch Code", width: 140 },
      { field: "branch_name", header: "Name", flex: 1, minWidth: 200 },
      { field: "address", header: "Address", flex: 1, minWidth: 200 },
      { field: "contact_number", header: "Phone", width: 150 },
      {
        field: "active",
        header: "Status",
        width: 110,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<Branch>) => (
          <Chip
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
    [favorites, toggleFavorite, handleSelectBranch]
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

  // Detail mode: a narrow left panel showing only the current branch (or the
  // "New Branch" placeholder while creating). A "Back to Branches" link
  // returns to the table.
  const singleBranchPanel = (
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
          onClick={handleBackToBranches}
          sx={{ textTransform: "none" }}
        >
          Back to Branches
        </Button>
      </Box>
      {isCreating ? (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ bgcolor: "primary.main" }}>
              <BusinessIcon fontSize="small" />
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              New Branch
            </Typography>
          </Box>
        </Box>
      ) : selectedBranch && (
        <Box>
          <SelectableListItem
            id={selectedBranch.id}
            isSelected
            onClick={() => {}}
            primaryText={
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
                <Avatar sx={{ bgcolor: "primary.main" }}>
                  <BusinessIcon fontSize="small" />
                </Avatar>
                <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5, minWidth: 0 }}>
                  <span>{selectedBranch.branch_name}</span>
                  <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                    {selectedBranch.branch_code}
                  </Typography>
                </Box>
              </Box>
            }
            isFavorite={favorites.includes(selectedBranch.id)}
            onToggleFavorite={(e) => toggleFavorite(selectedBranch.id, e)}
          />
        </Box>
      )}
    </Paper>
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
        isFavorite={selectedBranch ? favorites.includes(selectedBranch.id) : false}
        onToggleFavorite={selectedBranch ? (e) => toggleFavorite(selectedBranch.id, e) : undefined}
      />

      {/* Toolbar */}
      <ActionToolbar
        canCreate={canCreate}
        canUpdate={canUpdate}
        canDelete={canDelete}
        hasSelectedItem={!!selectedBranch}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={!!isFormValid}
        onNew={handleNewBranch}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
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
              inputProps={{ style: { textTransform: "uppercase" } }}
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
              error={!!branchEmailError}
              helperText={branchEmailError}
            />
            <TextField
              label="Contact Number"
              size="small"
              value={formData.contact_number}
              onChange={(e) => setFormData({ ...formData, contact_number: e.target.value })}
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
            <TextField
              label="Address"
              size="small"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              disabled={!isEditing && !isCreating}
              multiline
              rows={2}
              sx={{ gridColumn: { sm: "1 / -1" } }}
            />
          </FormSection>
        )}

        {/* Branch Performance Widget - quick sales/stock KPIs, similar to the main dashboard */}
        {selectedBranch && !isCreating && (
          <>
            <Divider sx={{ my: 3 }} />
            <Typography variant="h6" sx={{ mb: 2, display: "flex", alignItems: "center", gap: 1 }}>
              <TrendingUpIcon color="primary" /> Branch Performance
            </Typography>
            {performanceLoading ? (
              <Typography color="text.secondary">Loading performance...</Typography>
            ) : performance ? (
              <Grid container spacing={2}>
                <Grid item xs={6} sm={4} md={3}>
                  <KpiSparkCard title="Sales Today" value={fmtLKR(performance.sales_today)} icon={<MonetizationOnIcon />} color="success" />
                </Grid>
                <Grid item xs={6} sm={4} md={3}>
                  <KpiSparkCard title="Sales This Month" value={fmtLKR(performance.sales_month)} icon={<TrendingUpIcon />} color="primary" />
                </Grid>
                <Grid item xs={6} sm={4} md={3}>
                  <KpiSparkCard title="Orders Today" value={performance.orders_today} subtitle={`${performance.orders_month} this month`} icon={<ReceiptLongIcon />} color="info" />
                </Grid>
                <Grid item xs={6} sm={4} md={3}>
                  <KpiSparkCard title="In Stock" value={performance.in_stock} icon={<InventoryIcon />} color="secondary" />
                </Grid>
                <Grid item xs={6} sm={4} md={3}>
                  <KpiSparkCard title="Reserved" value={performance.reserved} icon={<InventoryIcon />} color="warning" />
                </Grid>
                <Grid item xs={6} sm={4} md={3}>
                  <KpiSparkCard title="Sold Today" value={performance.sold_today} icon={<ReceiptLongIcon />} color="success" />
                </Grid>
                <Grid item xs={6} sm={4} md={3}>
                  <KpiSparkCard title="Returned" value={performance.returned} icon={<InventoryIcon />} color="error" />
                </Grid>
              </Grid>
            ) : null}
          </>
        )}

        {/* Locations Section - Show for both creating and editing, hide when nothing selected */}
        {(selectedBranch || isCreating) && (
          <>
            <Divider sx={{ my: 3 }} />
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <LocationOnIcon color="primary" />
                <Typography variant="h6">
                  Warehouse Locations <Typography component="span" color="error.main">*</Typography>
                </Typography>
              </Box>
              {(isEditing || isCreating) && (isCreating ? canCreate : canUpdate) && (
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => handleOpenLocationDialog()}
                  disabled={isCreating && !formData.branch_code}
                  title={isCreating && !formData.branch_code ? "Enter branch code first" : ""}
                >
                  Add Location
                </Button>
              )}
            </Box>
            <Paper variant="outlined">
              {locationsLoading ? (
                <Box sx={{ p: 2, textAlign: "center" }}>
                  <Typography color="text.secondary">Loading locations...</Typography>
                </Box>
              ) : !branchLocations || branchLocations.length === 0 ? (
                <Box sx={{ p: 2, textAlign: "center" }}>
                  <Typography color={isEditing || isCreating ? "error.main" : "text.secondary"}>
                    {isCreating || isEditing
                      ? "At least one location is required. Click 'Add Location' to create one."
                      : "No locations defined yet"}
                  </Typography>
                </Box>
              ) : (
                <List dense disablePadding>
                  {branchLocations.map((location, index) => (
                    <ListItem
                      key={location.id}
                      divider={index < branchLocations.length - 1}
                      sx={{ py: 1 }}
                    >
                      <ListItemText
                        primary={location.name}
                        secondary={`Created: ${new Date(location.created_date).toLocaleDateString()}`}
                      />
                      {(isEditing || isCreating) && (canUpdate || canDelete) && (
                        <ListItemSecondaryAction>
                          {(isCreating ? canCreate : canUpdate) && (
                            <IconButton
                              size="small"
                              onClick={() => handleOpenLocationDialog(location)}
                              sx={{ mr: 0.5 }}
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                          )}
                          {(isCreating ? canCreate : canDelete) && (
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => handleDeleteLocation(location)}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          )}
                        </ListItemSecondaryAction>
                      )}
                    </ListItem>
                  ))}
                </List>
              )}
            </Paper>
          </>
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
          isBranchDetailMode ? undefined : (
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
              sx={{ width: 220, flexShrink: 0 }}
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
              <Tooltip title="Clear filters">
                <IconButton size="small" onClick={handleClearFilters}>
                  <ClearIcon fontSize="small" />
                </IconButton>
              </Tooltip>
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
              <TExportButton
                filename="branches"
                headers={["Branch Code", "Branch Name", "Address", "Contact Number", "Email"]}
                rows={() =>
                  filteredBranches.map((b) => [
                    b.branch_code || "",
                    b.branch_name || "",
                    b.address || "",
                    b.contact_number || "",
                    b.email || "",
                  ])
                }
                disabled={filteredBranches.length === 0}
              />
            </>
          )
        }
        {...(isBranchDetailMode ? { masterPanel: singleBranchPanel, detailPanel } : { children: branchTablePanel })}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
      
      {/* Location Dialog */}
      <Dialog 
        open={locationDialogOpen} 
        onClose={handleCloseLocationDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {editingLocation ? "Edit Location" : "Add New Location"}
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Location Name"
            fullWidth
            value={locationName}
            onChange={(e) => setLocationName(e.target.value)}
            placeholder="e.g., Main Warehouse, Store Room A"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseLocationDialog}>Cancel</Button>
          <Button 
            onClick={handleSaveLocation} 
            variant="contained"
            disabled={!locationName.trim() || createLocationMutation.isPending || updateLocationMutation.isPending}
          >
            {editingLocation ? "Update" : "Create"}
          </Button>
        </DialogActions>
      </Dialog>

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
