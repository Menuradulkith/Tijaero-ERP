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

import { useMemo, useCallback, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  Box, 
  TextField, 
  Typography,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Paper,
  Divider,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import BusinessIcon from "@mui/icons-material/Business";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import toast from "react-hot-toast";
import { ConfirmDialog, useConfirmDialog } from "@/components/ConfirmDialog";

// Tijaero Components - Import everything from one place
import {
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  DetailPanelHeader,
  ActionToolbar,
  FormSection,
  EmptyState,
  useMasterDetailState,
  SortOption,
} from "@/components/tijaero";

import { branchApi } from "../api";
import { locationsApi, Location, LocationCreate } from "@/modules/common/api";
import type { Branch, BranchCreate } from "@/api/types";

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

  // Location dialog state
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [locationName, setLocationName] = useState("");

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
    handleSelectItem: handleSelectBranch,
    handleNew: handleNewBranch,
    handleCancel,
    handleStartEdit,
  } = useMasterDetailState<Branch, BranchCreate>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromBranch,
    favoritesKey: "branches_favorites",
    defaultSortField: "branch_code",
  });

  // Data fetching
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["branches"],
    queryFn: () => branchApi.getAll(1, 100),
  });

  // Locations data fetching
  const { data: locations, isLoading: locationsLoading } = useQuery({
    queryKey: ["locations"],
    queryFn: () => locationsApi.getAll(),
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

  // Mutations
  const createMutation = useMutation({
    mutationFn: branchApi.create,
    onSuccess: (newBranch) => {
      console.log("[BranchesPage] Create success:", newBranch);
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      toast.success("Branch created successfully");
      // Reset state first to avoid "unsaved changes" prompt
      setIsCreating(false);
      setIsEditing(false);
      // Then select the new branch (with slight delay to allow state update)
      setTimeout(() => handleSelectBranch(newBranch), 0);
    },
    onError: (error: any) => {
      console.error("[BranchesPage] Create error:", error);
      console.error("[BranchesPage] Error response:", error.response);
      toast.error(error.response?.data?.detail || "Failed to create branch");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: BranchCreate }) =>
      branchApi.update(id, data),
    onSuccess: () => {
      console.log("[BranchesPage] Update success");
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      toast.success("Branch updated successfully");
      setIsEditing(false);
    },
    onError: (error: any) => {
      console.error("[BranchesPage] Update error:", error);
      console.error("[BranchesPage] Error response:", error.response);
      toast.error(error.response?.data?.detail || "Failed to update branch");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: branchApi.delete,
    onSuccess: () => {
      console.log("[BranchesPage] Delete success");
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      toast.success("Branch deleted successfully");
      handleCancel(filteredBranches);
    },
    onError: (error: any) => {
      console.error("[BranchesPage] Delete error:", error);
      console.error("[BranchesPage] Error response:", error.response);
      toast.error(error.response?.data?.detail || "Failed to delete branch");
    },
  });

  // Location mutations
  const createLocationMutation = useMutation({
    mutationFn: locationsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      toast.success("Location created successfully");
      handleCloseLocationDialog();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || "Failed to create location");
    },
  });

  const updateLocationMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: LocationCreate }) =>
      locationsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      toast.success("Location updated successfully");
      handleCloseLocationDialog();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || "Failed to update location");
    },
  });

  const deleteLocationMutation = useMutation({
    mutationFn: locationsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      toast.success("Location deleted successfully");
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || "Failed to delete location");
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

  const confirmDialog = useConfirmDialog();

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
      toast.error("Location name is required");
      return;
    }
    if (editingLocation) {
      updateLocationMutation.mutate({ id: editingLocation.id, data: { name: locationName } });
    } else {
      createLocationMutation.mutate({ name: locationName });
    }
  }, [locationName, editingLocation, createLocationMutation, updateLocationMutation]);

  const handleDeleteLocation = useCallback(async (location: Location) => {
    const confirmed = await confirmDialog.confirm({
      title: "Delete Location",
      message: `Are you sure you want to delete location "${location.name}"?`,
      confirmText: "Delete",
      confirmColor: "error",
    });
    if (confirmed) {
      deleteLocationMutation.mutate(location.id);
    }
  }, [confirmDialog, deleteLocationMutation]);

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
          id={branch.id}
          isSelected={isSelected}
          onClick={() => handleSelectBranch(branch)}
          primaryText={branch.branch_code}
          secondaryText={`Name: ${branch.branch_name}`}
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

        {/* Locations Section - Always visible */}
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
          ) : !locations || locations.length === 0 ? (
            <Box sx={{ p: 2, textAlign: "center" }}>
              <Typography color="text.secondary">No locations defined yet</Typography>
            </Box>
          ) : (
            <List dense disablePadding>
              {locations.map((location, index) => (
                <ListItem 
                  key={location.id}
                  divider={index < locations.length - 1}
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
      <ConfirmDialog {...confirmDialog.dialogProps} />
      
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
