/**
 * GroupsPage - Refactored to use Tijaero-style reusable components
 */

import HistoryIcon from "@mui/icons-material/History";
import SecurityIcon from "@mui/icons-material/Security";
import SearchIcon from "@mui/icons-material/Search";
import StarIcon from "@mui/icons-material/Star";
import StarOutlineIcon from "@mui/icons-material/StarBorder";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import {
    Alert,
    Avatar,
    Box,
    Button,
    Card,
    CardContent,
    Checkbox,
    IconButton,
    InputAdornment,
    Paper,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Tijaero Components
import {
    ActionToolbar,
    DetailPanelHeader,
    EmptyState,
    FormSection,
    MasterDetailLayout,
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
    TDataGrid,
    SelectableListItem,
    type TDataGridColumn,
} from "@/components/tijaero";

import {
    Group,
    GroupCreate,
    groupsApi,
    GroupUpdate,
    Permission,
    permissionsApi,
} from "../api";

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

    // Default order before the user sorts a column in the browse table
    // itself (the table's own column-header sort takes over from there).
    filtered.sort((a, b) => a.name.localeCompare(b.name));

    return filtered;
  }, [groups, searchQuery]);

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

  // Cancelling out of "New Role" should return to the browse table, not
  // auto-open the first role the way useMasterDetailState's generic
  // handleCancel does (that behavior made sense for the old always-visible
  // detail panel, but not here). Cancelling out of editing an existing role
  // still just reverts its form, which the generic handler already does
  // correctly.
  const handleCancel = useCallback(() => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedGroup(null);
    } else {
      baseHandleCancel(filteredGroups);
    }
  }, [isCreating, baseHandleCancel, filteredGroups, setIsCreating, setIsEditing, setSelectedGroup]);

  // Returns to the browse table from the detail view (the "Back to Roles"
  // link above the detail header).
  const handleBackToGroups = useCallback(() => {
    setSelectedGroup(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [isCreating, setSelectedGroup, setIsCreating, setIsEditing]);

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

  const isFormValid = !!formData.name;

  // Whether we're showing a single role's detail view (selected or being
  // created) instead of the browse table.
  const isGroupDetailMode = !!selectedGroup || isCreating;

  // Browse mode: a full-width table of every role. The permission count is
  // looked up and attached directly so the table's own column-header sort
  // orders it numerically rather than by the underlying array reference.
  // (Group here means a permissions role, not a user-membership group — it
  // has no code/type/member-count/status fields, just a name and its
  // assigned permissions.)
  type GroupRow = Group & { permissions_count: number };

  const groupRows: GroupRow[] = useMemo(
    () => filteredGroups.map((group) => ({ ...group, permissions_count: group.permissions.length })),
    [filteredGroups]
  );

  const groupColumns: TDataGridColumn<GroupRow>[] = useMemo(
    () => [
      {
        field: "favorite",
        header: "",
        width: 48,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<GroupRow>) => (
          <IconButton size="small" onClick={(e) => toggleFavorite(params.row.id, e)}>
            {favorites.includes(params.row.id) ? (
              <StarIcon fontSize="small" color="warning" />
            ) : (
              <StarOutlineIcon fontSize="small" color="action" />
            )}
          </IconButton>
        ),
      },
      { field: "name", header: "Name", flex: 1, minWidth: 220 },
      {
        field: "permissions_count",
        header: "Permissions Count",
        width: 180,
        align: "right",
        headerAlign: "right",
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<GroupRow>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectGroup(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [favorites, toggleFavorite, handleSelectGroup]
  );

  const groupsTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<GroupRow>
          rows={groupRows}
          columns={groupColumns}
          loading={loading}
          onRowClick={(row) => handleSelectGroup(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No roles found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Detail mode: a narrow left panel showing only the current role (or the
  // "New Role" placeholder while creating). A "Back to Roles" link returns
  // to the table.
  const singleGroupPanel = (
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
          onClick={handleBackToGroups}
          sx={{ textTransform: "none" }}
        >
          Back to Roles
        </Button>
      </Box>
      {isCreating ? (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ bgcolor: "primary.main" }}>
              <SecurityIcon fontSize="small" />
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              New Role
            </Typography>
          </Box>
        </Box>
      ) : selectedGroup && (
        <Box>
          <SelectableListItem
            id={selectedGroup.id}
            isSelected
            onClick={() => {}}
            primaryText={
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
                <Avatar sx={{ bgcolor: "primary.main" }}>
                  <SecurityIcon fontSize="small" />
                </Avatar>
                <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5, minWidth: 0 }}>
                  <span>{selectedGroup.name}</span>
                </Box>
              </Box>
            }
            isFavorite={favorites.includes(selectedGroup.id)}
            onToggleFavorite={(e) => toggleFavorite(selectedGroup.id, e)}
          />
        </Box>
      )}
    </Paper>
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

  if (loading) {
    return <TPageSkeleton variant="detail" />;
  }

  return (
    <>
      <MasterDetailLayout
        title="Roles & Permissions"
        icon={<SecurityIcon sx={{ fontSize: 32, color: "primary.main" }} />}
        titleSlot={
          isGroupDetailMode ? undefined : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search roles..."
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
            </Box>
          )
        }
        onRefresh={loadData}
        isLoading={loading}
        headerActions={
          isGroupDetailMode ? undefined : (
            <>
              <Button
                variant="contained"
                size="small"
                startIcon={<AddIcon />}
                onClick={handleNewGroup}
                sx={{ mr: 1 }}
              >
                Add Role
              </Button>
              <TExportButton
                filename="roles"
                headers={["Role Name", "Permissions Count"]}
                rows={() =>
                  filteredGroups.map((g) => [g.name || "", g.permissions?.length ?? 0])
                }
                disabled={filteredGroups.length === 0}
              />
            </>
          )
        }
        {...(isGroupDetailMode ? { masterPanel: singleGroupPanel, detailPanel } : { children: groupsTablePanel })}
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
