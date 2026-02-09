/**
 * BranchesPage - Refactored to use Tijaero-style reusable components
 * 
 * This page demonstrates how to use the Tijaero component library:
 * - MasterDetailLayout for overall page structure
 * - SearchableList for the master list panel
 * - SelectableListItem for list items
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
import LocationOnIcon from "@mui/icons-material/LocationOn";
import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    IconButton,
    List,
    ListItem,
    ListItemSecondaryAction,
    ListItemText,
    Paper,
    TextField,
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
    SearchableList,
    SelectableListItem,
    SortOption,
    useMasterDetailState,
    TConfirmDialog,
    useConfirmDialog,
    handleApiError,
    showErrorToast,
    showSuccessToast,
} from "@/components/tijaero";

import type { Branch, BranchCreate } from "@/api/types";
import { Location, LocationCreate, locationsApi } from "@/modules/common/api";
import { branchApi } from "../api";

// Configuration - Define once, use everywhere
const SORT_OPTIONS: SortOption[] = [
  { value: "branch_code", label: "Branch Code" },
  { value: "branch_name", label: "Branch Name" },
];

const INITIAL_FORM_DATA: BranchCreate = {
  branch_name: "",
  branch_code: "",
  address: "",
  email: "",
  contact_number: "",
};

const resetFormFromBranch = (branch: Branch): BranchCreate => ({
  branch_name: branch.branch_name,
  branch_code: branch.branch_code,
  address: branch.address || "",
  email: branch.email || "",
  contact_number: branch.contact_number || "",
});

export default function BranchesPage() {
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();

  // Location dialog state
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [locationName, setLocationName] = useState("");
  
  // Track locations for the current branch being created/edited
  const [branchLocations, setBranchLocations] = useState<Location[]>([]);

  // Use the reusable state management hook
  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem: selectedBranch,
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
    handleCancel,
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

  // Filter and sort branches
  const filteredBranches = useMemo(() => {
    if (!data?.items) return [];

    let filtered = data.items.filter(
      (branch) =>
        branch.branch_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        branch.branch_name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    filtered.sort((a, b) => {
      if (sortField === "branch_code") {
        return a.branch_code.localeCompare(b.branch_code);
      } else if (sortField === "branch_name") {
        return a.branch_name.localeCompare(b.branch_name);
      }
      return 0;
    });

    return filtered;
  }, [data?.items, searchQuery, sortField]);

  // Auto-select first branch when branches are loaded or filtered
  // But NOT when we're creating a new item (selectedBranch is null during creation)
  useEffect(() => {
    if (filteredBranches.length > 0 && !selectedBranch && !isCreating) {
      handleSelectBranch(filteredBranches[0]);
    }
  }, [filteredBranches, selectedBranch, isCreating, handleSelectBranch]);

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
      console.log("[BranchesPage] Create success:", newBranch);
      
      // Create locations after branch is created
      if (branchLocations.length > 0) {
        const locationPromises = branchLocations.map(loc => 
          locationsApi.create({ name: loc.name, branch_code: newBranch.branch_code })
        );
        
        try {
          await Promise.all(locationPromises);
          console.log("[BranchesPage] Locations created successfully");
        } catch (error) {
          console.error("[BranchesPage] Error creating locations:", error);
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
      console.error("[BranchesPage] Create error:", error);
      showErrorToast(handleApiError(error, "Failed to create branch"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: BranchCreate }) =>
      branchApi.update(id, data),
    onSuccess: () => {
      console.log("[BranchesPage] Update success");
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      showSuccessToast("Branch updated successfully");
      markAsSaved();
      setIsEditing(false);
    },
    onError: (error: unknown) => {
      console.error("[BranchesPage] Update error:", error);
      showErrorToast(handleApiError(error, "Failed to update branch"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: branchApi.delete,
    onSuccess: (data) => {
      console.log("[BranchesPage] Delete success");
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      // Use the success message from backend if available
      showSuccessToast(data?.message || "Branch deleted successfully");
      handleCancel(filteredBranches);
    },
    onError: (error: unknown) => {
      console.error("[BranchesPage] Delete error:", error);
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
  const handleSave = useCallback(() => {
    console.log("[BranchesPage] handleSave called:", { isCreating, isEditing, selectedBranch, formData });
    if (isCreating) {
      console.log("[BranchesPage] Creating new branch:", formData);
      createMutation.mutate(formData);
    } else if (selectedBranch) {
      console.log("[BranchesPage] Updating branch:", selectedBranch.id, formData);
      updateMutation.mutate({ id: selectedBranch.id, data: formData });
    } else {
      console.warn("[BranchesPage] handleSave called but no action taken - isCreating:", isCreating, "selectedBranch:", selectedBranch);
    }
  }, [isCreating, isEditing, selectedBranch, formData, createMutation, updateMutation]);

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

  const isFormValid = formData.branch_code && formData.branch_name;
  const isSaving = createMutation.isPending || updateMutation.isPending;

  // Render Master List using Tijaero SearchableList component
  const masterPanel = (
    <SearchableList<Branch>
      items={filteredBranches}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search branches..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedBranch}
      onSelectItem={handleSelectBranch}
      emptyMessage="No branches found"
      renderItem={(branch, isSelected) => (
        <SelectableListItem
          key={branch.id}
          isSelected={isSelected}
          onClick={() => handleSelectBranch(branch)}
          primaryText={
            <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
              {/* Branch Code */}
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{branch.branch_code}</span>
                {isSelected && (
                  <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                    (Branch Code)
                  </Typography>
                )}
              </Box>
              {/* Additional fields when selected */}
              {isSelected && (
                <>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      {branch.branch_name}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Name)
                    </Typography>
                  </Box>
                  {branch.address && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {branch.address}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Address)
                      </Typography>
                    </Box>
                  )}
                  {branch.email && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {branch.email}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Email)
                      </Typography>
                    </Box>
                  )}
                  {branch.contact_number && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {branch.contact_number}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Contact)
                      </Typography>
                    </Box>
                  )}
                </>
              )}
            </Box>
          }
          secondaryText={!isSelected ? branch.branch_name : undefined}
          isFavorite={favorites.includes(branch.id)}
          onToggleFavorite={(e) => toggleFavorite(branch.id, e)}
        />
      )}
    />
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
        titleIcon={<BusinessIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Branch"
        noSelectionTitle="Select a Branch"
        isFavorite={selectedBranch ? favorites.includes(selectedBranch.id) : false}
        onToggleFavorite={selectedBranch ? (e) => toggleFavorite(selectedBranch.id, e) : undefined}
      />

      {/* Toolbar */}
      <ActionToolbar
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
        ) : (
          <FormSection title="Branch Information" columns={2}>
            <TextField
              label="Branch Code"
              size="small"
              value={formData.branch_code}
              onChange={(e) =>
                setFormData({ ...formData, branch_code: e.target.value.toUpperCase() })
              }
              disabled={!isCreating}
              required
              inputProps={{ style: { textTransform: "uppercase" } }}
            />
            <TextField
              label="Branch Name"
              size="small"
              value={formData.branch_name}
              onChange={(e) => setFormData({ ...formData, branch_name: e.target.value })}
              disabled={!isCreating}
              required
            />
            <TextField
              label="Email"
              size="small"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              disabled={!isEditing && !isCreating}
            />
            <TextField
              label="Contact Number"
              size="small"
              value={formData.contact_number}
              onChange={(e) => setFormData({ ...formData, contact_number: e.target.value })}
              disabled={!isEditing && !isCreating}
            />
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

        {/* Locations Section - Show for both creating and editing, hide when nothing selected */}
        {(selectedBranch || isCreating) && (
          <>
            <Divider sx={{ my: 3 }} />
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <LocationOnIcon color="primary" />
                <Typography variant="h6">Warehouse Locations</Typography>
              </Box>
              {(isEditing || isCreating) && (
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
                  <Typography color="text.secondary">
                    {isCreating ? "No locations added yet. Click 'Add Location' to create one." : "No locations defined yet"}
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
                      {(isEditing || isCreating) && (
                        <ListItemSecondaryAction>
                          <IconButton
                            size="small"
                            onClick={() => handleOpenLocationDialog(location)}
                            sx={{ mr: 0.5 }}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDeleteLocation(location)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </ListItemSecondaryAction>
                      )}
                    </ListItem>
                  ))}
                </List>
              )}
            </Paper>
          </>
        )}
      </Box>
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title="Branches"
        onRefresh={refetch}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
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
    </>
  );
}
