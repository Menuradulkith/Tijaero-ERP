/**
 * GroupsPage - Refactored to use Tijaero-style reusable components
 */

import HistoryIcon from "@mui/icons-material/History";
import SecurityIcon from "@mui/icons-material/Security";
import {
    Alert,
    Box,
    Card,
    CardContent,
    Checkbox,
    IconButton,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Tijaero Components
import {
    ActionToolbar,
    DetailPanelHeader,
    EmptyState,
    FormSection,
    MasterDetailLayout,
    SearchableList,
    SelectableListItem,
    SortOption,
    TActivityHistoryPanel,
    TDetailSkeleton,
    TExportButton,
    TPageSkeleton,
    useMasterDetailState,
    handleApiError,
    showErrorToast,
    showSuccessToast,
    TConfirmDialog,
    useConfirmDialog,
} from "@/components/tijaero";

import {
    Group,
    GroupCreate,
    groupsApi,
    GroupUpdate,
    Permission,
    permissionsApi,
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
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);

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

  // Guards against out-of-order responses: if two loadData() calls overlap
  // (e.g. save then a quick delete), a slower/older call's response must not
  // clobber state already updated by a call that started later.
  const loadDataSeqRef = useRef(0);

  const loadData = async () => {
    const seq = ++loadDataSeqRef.current;
    try {
      setLoading(true);
      setError(null);
      const [groupsData, permissionsData] = await Promise.all([
        groupsApi.getGroups(),
        permissionsApi.getPermissions(),
      ]);

      // A newer loadData() call has since started — this response is stale.
      if (seq !== loadDataSeqRef.current) return;

      setGroups(groupsData);
      setPermissions(permissionsData);
    } catch (err: unknown) {
      if (seq !== loadDataSeqRef.current) return;
      const errorMsg = handleApiError(err, "Failed to load data");
      setError(errorMsg);
      showErrorToast(errorMsg);
    } finally {
      if (seq === loadDataSeqRef.current) setLoading(false);
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

  // Filter grouped permissions by the permission search box; resources with
  // no matches are hidden entirely rather than shown empty.
  const [permissionSearch, setPermissionSearch] = useState("");
  const filteredGroupedPermissions = useMemo(() => {
    const query = permissionSearch.trim().toLowerCase();
    if (!query) return groupedPermissions;

    const result: Record<string, Permission[]> = {};
    for (const [resource, perms] of Object.entries(groupedPermissions)) {
      const matched = perms.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.resource.toLowerCase().includes(query) ||
          p.action.toLowerCase().includes(query) ||
          (p.description || "").toLowerCase().includes(query)
      );
      if (matched.length > 0) result[resource] = matched;
    }
    return result;
  }, [groupedPermissions, permissionSearch]);

  // Handlers
  const handleSave = useCallback(async () => {
    try {
      setError(null);
      if (isCreating) {
        const newGroup = await groupsApi.createGroup(formData);
        showSuccessToast("Role created successfully");
        // Reset state first
        setIsCreating(false);
        setIsEditing(false);
        await loadData();
        // Select new group after state reset and data reload
        setTimeout(() => setSelectedGroup(newGroup), 0);
      } else if (selectedGroup) {
        await groupsApi.updateGroup(selectedGroup.id, formData as GroupUpdate);
        showSuccessToast("Role updated successfully");
        setIsEditing(false);
        await loadData();
      }
    } catch (err: unknown) {
      const errorMsg = handleApiError(err, "Failed to save role");
      setError(errorMsg);
      showErrorToast(errorMsg);
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
          showSuccessToast("Role deleted successfully");
          setSelectedGroup(null);
          await loadData();
        } catch (err: unknown) {
          const errorMsg = handleApiError(err, "Failed to delete role");
          setError(errorMsg);
          showErrorToast(errorMsg);
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

  const handleResourceToggle = useCallback((resourcePerms: Permission[], checked: boolean) => {
    const resourceIds = resourcePerms.map((p) => p.id);
    setFormData((prev) => ({
      ...prev,
      permission_ids: checked
        ? [...new Set([...prev.permission_ids, ...resourceIds])]
        : prev.permission_ids.filter((id) => !resourceIds.includes(id)),
    }));
  }, [setFormData]);

  if (loading) {
    return <TPageSkeleton variant="detail" />;
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
        actions={
          selectedGroup && !isCreating ? (
            <Tooltip title="View activity history">
              <IconButton size="small" onClick={() => setActivityHistoryOpen(true)}>
                <HistoryIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : undefined
        }
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
        ) : loading && !isCreating ? (
          <TDetailSkeleton sections={1} fieldsPerSection={4} showHeader={false} showToolbar={false} />
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
            <FormSection
              title={`Permissions (${formData.permission_ids.length} selected)`}
              columns={1}
              titleAction={
                <TextField
                  size="small"
                  placeholder="Search permissions..."
                  value={permissionSearch}
                  onChange={(e) => setPermissionSearch(e.target.value)}
                  sx={{ width: 220 }}
                />
              }
            >
              <Box sx={{ maxHeight: 400, overflowY: "auto" }}>
                {Object.keys(filteredGroupedPermissions).length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: "center" }}>
                    No permissions match "{permissionSearch}"
                  </Typography>
                ) : (
                Object.entries(filteredGroupedPermissions).map(([resource, perms]) => {
                  const resourceIds = perms.map((p) => p.id);
                  const selectedCount = resourceIds.filter((id) => formData.permission_ids.includes(id)).length;
                  const allSelected = selectedCount === resourceIds.length;
                  const someSelected = selectedCount > 0 && !allSelected;
                  return (
                  <Card key={resource} sx={{ mb: 2 }} variant="outlined">
                    <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                      <Box display="flex" alignItems="center" sx={{ mb: 0.5 }}>
                        <Checkbox
                          size="small"
                          checked={allSelected}
                          indeterminate={someSelected}
                          disabled={!isEditing && !isCreating}
                          onChange={(e) => handleResourceToggle(perms, e.target.checked)}
                        />
                        <Typography variant="subtitle2" fontWeight="bold" color="primary">
                          {resource.toUpperCase()}
                        </Typography>
                      </Box>
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
                  );
                })
                )}
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
        headerActions={
          <TExportButton
            filename="roles"
            headers={["Role Name", "Permissions Count"]}
            rows={() =>
              filteredGroups.map((g) => [g.name || "", g.permissions?.length ?? 0])
            }
            disabled={filteredGroups.length === 0}
          />
        }
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
      <TActivityHistoryPanel
        open={activityHistoryOpen}
        onClose={() => setActivityHistoryOpen(false)}
        entityType="group"
        entityId={selectedGroup?.id}
        actionLabels={{
          create: "Role created",
          update: "Role updated",
          delete: "Role deleted",
        }}
      />
    </>
  );
}
