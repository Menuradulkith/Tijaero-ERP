/**
 * GroupsPage - Refactored to use Tijaero-style reusable components
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Box,
  TextField,
  Checkbox,
  Alert,
  CircularProgress,
  Card,
  CardContent,
  Typography,
} from "@mui/material";
import SecurityIcon from "@mui/icons-material/Security";
import toast from "react-hot-toast";
import { ConfirmDialog, useConfirmDialog } from "@/components/ConfirmDialog";

// Tijaero Components
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

import {
  groupsApi,
  permissionsApi,
  Group,
  GroupCreate,
  GroupUpdate,
  Permission,
} from "../api";

// Configuration
const SORT_OPTIONS: SortOption[] = [
  { value: "name", label: "Name" },
  { value: "permissions", label: "Permissions Count" },
];

const INITIAL_FORM_DATA: GroupCreate = {
  name: "",
  permission_ids: [],
};

const resetFormFromGroup = (group: Group): GroupCreate => ({
  name: group.name,
  permission_ids: group.permissions.map((p) => p.id),
});

export default function GroupsPage() {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Use reusable state hook
  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem: selectedGroup,
    setSelectedItem: setSelectedGroup,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    favorites,
    toggleFavorite,
    formData,
    setFormData,
    handleSelectItem: handleSelectGroup,
    handleNew: handleNewGroup,
    handleCancel: baseHandleCancel,
    handleStartEdit,
  } = useMasterDetailState<Group, GroupCreate>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromGroup,
    favoritesKey: "groups_favorites",
    defaultSortField: "name",
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [groupsData, permissionsData] = await Promise.all([
        groupsApi.getGroups(),
        permissionsApi.getPermissions(),
      ]);
      setGroups(groupsData);
      setPermissions(permissionsData);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  // Filter and sort groups
  const filteredGroups = useMemo(() => {
    let filtered = groups.filter((group) =>
      group.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    filtered.sort((a, b) => {
      if (sortField === "name") {
        return a.name.localeCompare(b.name);
      } else if (sortField === "permissions") {
        return b.permissions.length - a.permissions.length;
      }
      return 0;
    });

    return filtered;
  }, [groups, searchQuery, sortField]);

  // Group permissions by resource
  const groupedPermissions = useMemo(() => {
    return permissions.reduce((acc, perm) => {
      if (!acc[perm.resource]) {
        acc[perm.resource] = [];
      }
      acc[perm.resource].push(perm);
      return acc;
    }, {} as Record<string, Permission[]>);
  }, [permissions]);

  // Handlers
  const handleSave = useCallback(async () => {
    try {
      setError(null);
      if (isCreating) {
        const newGroup = await groupsApi.createGroup(formData);
        toast.success("Role created successfully");
        // Reset state first
        setIsCreating(false);
        setIsEditing(false);
        await loadData();
        // Select new group after state reset and data reload
        setTimeout(() => setSelectedGroup(newGroup), 0);
      } else if (selectedGroup) {
        await groupsApi.updateGroup(selectedGroup.id, formData as GroupUpdate);
        toast.success("Role updated successfully");
        setIsEditing(false);
        await loadData();
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to save role");
      toast.error(err.response?.data?.detail || "Failed to save role");
    }
  }, [isCreating, selectedGroup, formData, setIsCreating, setIsEditing, setSelectedGroup]);

  const handleCancel = useCallback(() => {
    baseHandleCancel(filteredGroups);
  }, [baseHandleCancel, filteredGroups]);

  const confirmDialog = useConfirmDialog();

  const handleDelete = useCallback(async () => {
    if (selectedGroup) {
      const confirmed = await confirmDialog.confirm({
        title: "Delete Role",
        message: `Are you sure you want to delete role "${selectedGroup.name}"?`,
        confirmText: "Delete",
        confirmColor: "error",
      });
      if (confirmed) {
        try {
          await groupsApi.deleteGroup(selectedGroup.id);
          toast.success("Role deleted successfully");
          setSelectedGroup(null);
          await loadData();
        } catch (err: any) {
          setError(err.response?.data?.detail || "Failed to delete role");
          toast.error(err.response?.data?.detail || "Failed to delete role");
        }
      }
    }
  }, [selectedGroup, setSelectedGroup, confirmDialog]);

  const handleDuplicate = useCallback(() => {
    if (selectedGroup) {
      setFormData({
        name: `${selectedGroup.name} (Copy)`,
        permission_ids: selectedGroup.permissions.map((p) => p.id),
      });
      handleNewGroup();
    }
  }, [selectedGroup, setFormData, handleNewGroup]);

  const handlePermissionToggle = useCallback((permId: number, checked: boolean) => {
    if (checked) {
      setFormData((prev) => ({
        ...prev,
        permission_ids: [...prev.permission_ids, permId],
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        permission_ids: prev.permission_ids.filter((id) => id !== permId),
      }));
    }
  }, [setFormData]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  const isFormValid = !!formData.name;

  // Master Panel
  const masterPanel = (
    <SearchableList<Group>
      items={filteredGroups}
      isLoading={loading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search roles..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedGroup}
      onSelectItem={handleSelectGroup}
      emptyMessage="No roles found"
      renderItem={(group, isSelected) => (
        <SelectableListItem
          key={group.id}
          id={group.id}
          isSelected={isSelected}
          onClick={() => handleSelectGroup(group)}
          primaryText={group.name}
          secondaryText={`${group.permissions.length} permissions`}
          isFavorite={favorites.includes(group.id)}
          onToggleFavorite={(e) => toggleFavorite(group.id, e)}
        />
      )}
    />
  );

  // Detail Panel
  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Roles", href: "#" },
          ...(selectedGroup || isCreating
            ? [{ label: isCreating ? "New Role" : selectedGroup?.name || "" }]
            : []),
        ]}
        title={selectedGroup?.name || ""}
        titleIcon={<SecurityIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Role"
        noSelectionTitle="Select a Role"
        isFavorite={selectedGroup ? favorites.includes(selectedGroup.id) : false}
        onToggleFavorite={selectedGroup ? (e) => toggleFavorite(selectedGroup.id, e) : undefined}
      />

      <ActionToolbar
        hasSelectedItem={!!selectedGroup}
        isCreating={isCreating}
        isEditing={isEditing}
        isFormValid={isFormValid}
        onNew={handleNewGroup}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
        onSave={handleSave}
        onCancel={handleCancel}
        onEdit={handleStartEdit}
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
        {!selectedGroup && !isCreating ? (
          <EmptyState message="Select a role from the list or create a new one" />
        ) : (
          <>
            {error && (
              <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}
            {success && (
              <Alert severity="success" onClose={() => setSuccess(null)} sx={{ mb: 2 }}>
                {success}
              </Alert>
            )}

            <FormSection title="Role Information" columns={1}>
              <TextField
                label="Role Name"
                size="small"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                disabled={!isEditing && !isCreating}
                required
                fullWidth
              />
            </FormSection>

            {/* Permissions Section - Custom because of complex structure */}
            <FormSection title={`Permissions (${formData.permission_ids.length} selected)`} columns={1}>
              <Box sx={{ maxHeight: 400, overflowY: "auto" }}>
                {Object.entries(groupedPermissions).map(([resource, perms]) => (
                  <Card key={resource} sx={{ mb: 2 }} variant="outlined">
                    <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                      <Typography variant="subtitle2" fontWeight="bold" color="primary" gutterBottom>
                        {resource.toUpperCase()}
                      </Typography>
                      <Box
                        sx={{
                          display: "grid",
                          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                          gap: 0.5,
                        }}
                      >
                        {perms.map((perm) => (
                          <Box key={perm.id} display="flex" alignItems="center">
                            <Checkbox
                              size="small"
                              checked={formData.permission_ids.includes(perm.id)}
                              disabled={!isEditing && !isCreating}
                              onChange={(e) => handlePermissionToggle(perm.id, e.target.checked)}
                            />
                            <Box>
                              <Typography variant="body2">{perm.name}</Typography>
                              {perm.description && (
                                <Typography variant="caption" color="text.secondary">
                                  {perm.description}
                                </Typography>
                              )}
                            </Box>
                          </Box>
                        ))}
                      </Box>
                    </CardContent>
                  </Card>
                ))}
              </Box>
            </FormSection>
          </>
        )}
      </Box>
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title="Roles & Permissions"
        icon={<SecurityIcon sx={{ fontSize: 32, color: "primary.main" }} />}
        onRefresh={loadData}
        isLoading={loading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />
      <ConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
