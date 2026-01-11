/**
 * UsersPage - Refactored to use Tijaero-style reusable components
 */

import { ConfirmDialog, useConfirmDialog } from "@/components/ConfirmDialog";
import { formatErrorMessage } from "@/utils/errorHandling";
import PersonIcon from "@mui/icons-material/Person";
import {
    Alert,
    Autocomplete,
    Box,
    Checkbox,
    Chip,
    CircularProgress,
    FormControlLabel,
    Switch,
    TextField,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

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
    useMasterDetailState,
    GENDER_CHOICES,
} from "@/components/tijaero";

import { usePermission } from "@/auth/components/PermissionGuard";
import { PERMISSIONS } from "@/auth/permissions";
import type { Branch } from "../../../api/types";
import { branchApi } from "../../branches/api";
import { Group, groupsApi } from "../../groups/api";
import { UserCreate, UserList, usersApi, UserUpdate } from "../api";

// Configuration
const SORT_OPTIONS: SortOption[] = [
  { value: "username", label: "Username" },
  { value: "first_name", label: "First Name" },
  { value: "email", label: "Email" },
];

const INITIAL_FORM_DATA: Partial<UserCreate> = {
  username: "",
  password: "",
  email: "",
  first_name: "",
  middle_name: "",
  last_name: "",
  gender: "m",
  birthdate: new Date().toISOString().split("T")[0],
  occupation: "",
  employee_id: "",
  is_active: true,
  is_staff: false,
  branch_ids: [],
  group_ids: [],
};

const resetFormFromUser = (user: UserList): Partial<UserCreate> => ({
  username: user.username,
  email: user.email,
  first_name: user.first_name,
  middle_name: "",
  last_name: user.last_name,
  gender: "m",
  birthdate: new Date().toISOString().split("T")[0],
  occupation: user.occupation || "",
  employee_id: user.employee_id || "",
  is_active: user.is_active,
  is_staff: user.is_staff,
  branch_ids: user.branches.map((b) => b.id),
  group_ids: user.groups?.map((g) => g.id) || [],
});

// Password validation
const validatePassword = (password: string): string | null => {
  if (!password) return null;
  if (password.length < 8) return "Password must be at least 8 characters long";
  if (!/[A-Z]/.test(password)) return "Password must contain at least one uppercase letter";
  if (!/[a-z]/.test(password)) return "Password must contain at least one lowercase letter";
  if (!/[0-9]/.test(password)) return "Password must contain at least one number";
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) return "Password must contain at least one special character";
  return null;
};

export default function UsersPage() {
  const [users, setUsers] = useState<UserList[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [filterBranchId, setFilterBranchId] = useState<number | null>(null);
  const [filterRoleId, setFilterRoleId] = useState<number | null>(null);

  // Permissions
  const canCreate = usePermission(PERMISSIONS.USER_CREATE.resource, PERMISSIONS.USER_CREATE.action);
  const canUpdate = usePermission(PERMISSIONS.USER_UPDATE.resource, PERMISSIONS.USER_UPDATE.action);
  const canDelete = usePermission(PERMISSIONS.USER_DELETE.resource, PERMISSIONS.USER_DELETE.action);

  // Use reusable state hook
  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem: selectedUser,
    setSelectedItem: setSelectedUser,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    favorites,
    toggleFavorite,
    formData,
    setFormData,
    handleSelectItem: baseHandleSelectUser,
    handleNew: handleCreate,
    handleCancel: baseHandleCancel,
    handleStartEdit: handleEdit,
  } = useMasterDetailState<UserList, Partial<UserCreate>>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromUser,
    favoritesKey: "users_favorites",
    defaultSortField: "username",
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async (refreshSelectedUserId?: number) => {
    try {
      setLoading(true);
      setError(null);

      const promises: Promise<any>[] = [usersApi.getUsers()];
      promises.push(groupsApi.getGroups().catch(() => []));
      promises.push(branchApi.getAll(1, 100).catch(() => ({ items: [] })));

      const [usersData, groupsData, branchesData] = await Promise.all(promises);
      setUsers(usersData);
      setGroups(groupsData);
      setBranches(branchesData.items || []);
      
      // Refresh selected user with updated data
      if (refreshSelectedUserId) {
        const updatedUser = usersData.find((u: UserList) => u.id === refreshSelectedUserId);
        if (updatedUser) {
          setSelectedUser(updatedUser);
          setFormData(resetFormFromUser(updatedUser));
        }
      }
    } catch (err: any) {
      const errorMsg = formatErrorMessage(err) || "Failed to load data";
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // Filter users (hide superusers)
  const filteredUsers = useMemo(() => {
    let filtered = users.filter((user) => !user.is_superuser);

    // Filter by branch
    if (filterBranchId) {
      filtered = filtered.filter((user) =>
        user.branches.some((b) => b.id === filterBranchId)
      );
    }

    // Filter by role
    if (filterRoleId) {
      filtered = filtered.filter((user) =>
        user.groups.some((g) => g.id === filterRoleId)
      );
    }

    if (searchQuery) {
      filtered = filtered.filter(
        (user) =>
          user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
          user.first_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          user.last_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          user.email.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    filtered.sort((a, b) => {
      if (sortField === "username") return a.username.localeCompare(b.username);
      if (sortField === "first_name") return a.first_name.localeCompare(b.first_name);
      if (sortField === "email") return a.email.localeCompare(b.email);
      return 0;
    });

    return filtered;
  }, [users, searchQuery, sortField, filterBranchId, filterRoleId]);

  // Handlers
  const handleSelectUser = useCallback((user: UserList) => {
    setPasswordError(null);
    baseHandleSelectUser(user);
  }, [baseHandleSelectUser]);

  const handlePasswordChange = useCallback((value: string) => {
    setFormData((prev) => ({ ...prev, password: value }));
    setPasswordError(validatePassword(value));
  }, [setFormData]);

  const handleSave = useCallback(async () => {
    console.log("[UsersPage] handleSave called:", { isCreating, isEditing, selectedUser, formData });
    try {
      setError(null);
      setUsernameError(null);
      setSaving(true);
      
      // Check for duplicate username when creating
      if (isCreating && formData.username) {
        const exists = await usersApi.checkUsernameExists(formData.username);
        if (exists) {
          setUsernameError("Username already exists");
          toast.error("Username already exists");
          setSaving(false);
          return;
        }
      }
      
      // Clean up empty strings to null for optional fields
      const cleanedData = {
        ...formData,
        middle_name: formData.middle_name?.trim() || null,
      };
      
      if (isCreating) {
        console.log("[UsersPage] Creating new user:", cleanedData);
        await usersApi.createUser(cleanedData as UserCreate);
        console.log("[UsersPage] Create success");
        toast.success("User created successfully");
        setIsCreating(false);
        setIsEditing(false);
        loadData();
      } else if (selectedUser) {
        console.log("[UsersPage] Updating user:", selectedUser.id, cleanedData);
        await usersApi.updateUser(selectedUser.id, cleanedData as UserUpdate);
        console.log("[UsersPage] Update success");
        toast.success("User updated successfully");
        setIsEditing(false);
        // Refresh with selected user ID to update the view
        loadData(selectedUser.id);
      } else {
        console.warn("[UsersPage] handleSave called but no action taken");
        loadData();
      }
    } catch (err: any) {
      console.error("[UsersPage] Save error:", err);
      console.error("[UsersPage] Error response:", err.response);
      const errorMsg = formatErrorMessage(err) || "Failed to save user";
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setSaving(false);
    }
  }, [isCreating, selectedUser, formData, setIsCreating, setIsEditing]);

  const handleCancel = useCallback(() => {
    setPasswordError(null);
    baseHandleCancel(filteredUsers);
  }, [baseHandleCancel, filteredUsers]);

  const confirmDialog = useConfirmDialog();

  const handleDelete = useCallback(async () => {
    if (selectedUser) {
      const confirmed = await confirmDialog.confirm({
        title: "Delete User",
        message: `Are you sure you want to delete user "${selectedUser.username}"?`,
        confirmText: "Delete",
        confirmColor: "error",
      });
      if (confirmed) {
        try {
          await usersApi.deleteUser(selectedUser.id);
          toast.success("User deleted successfully");
          setSelectedUser(null);
          loadData();
        } catch (err: any) {
          toast.error(formatErrorMessage(err) || "Failed to delete user");
        }
      }
    }
  }, [selectedUser, setSelectedUser, confirmDialog]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  const isFormValid = formData.username && formData.email && formData.first_name && formData.last_name &&
    formData.employee_id && formData.occupation &&
    (isCreating ? !passwordError && formData.password : true);
  const isDisabled = !isEditing && !isCreating;

  // Master Panel
  const masterPanel = (
    <SearchableList<UserList>
      items={filteredUsers}
      isLoading={loading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search users..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedUser}
      onSelectItem={handleSelectUser}
      emptyMessage="No users found"
      width={300}
      listHeader={
        <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: "divider" }}>
          <Autocomplete
            size="small"
            options={branches}
            getOptionLabel={(option) => option.branch_name}
            value={branches.find((b) => b.id === filterBranchId) || null}
            onChange={(_, newValue) => setFilterBranchId(newValue?.id || null)}
            renderInput={(params) => (
              <TextField {...params} placeholder="Filter by Branch" size="small" />
            )}
            sx={{ mb: 1 }}
          />
          <Autocomplete
            size="small"
            options={groups}
            getOptionLabel={(option) => option.name}
            value={groups.find((g) => g.id === filterRoleId) || null}
            onChange={(_, newValue) => setFilterRoleId(newValue?.id || null)}
            renderInput={(params) => (
              <TextField {...params} placeholder="Filter by Role" size="small" />
            )}
          />
        </Box>
      }
      renderItem={(user, isSelected) => (
        <SelectableListItem
          key={user.id}
          id={user.id}
          isSelected={isSelected}
          onClick={() => handleSelectUser(user)}
          primaryText={user.username}
          secondaryText={`${user.first_name} ${user.last_name}`}
          isFavorite={favorites.includes(user.id)}
          onToggleFavorite={(e) => toggleFavorite(user.id, e)}
          statusChip={
            user.is_active
              ? { label: "Active", color: "success" }
              : { label: "Inactive", color: "default" }
          }
          chips={user.is_staff ? [{ label: "Staff", color: "warning" }] : []}
        />
      )}
    />
  );

  // Detail Panel
  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Users", href: "#" },
          ...(selectedUser || isCreating
            ? [{ label: isCreating ? "New User" : selectedUser?.username || "" }]
            : []),
        ]}
        title={selectedUser ? `${selectedUser.first_name} ${selectedUser.last_name}` : ""}
        titleIcon={<PersonIcon color="primary" />}
        isCreating={isCreating}
        createTitle="Create New User"
        noSelectionTitle="Select a User"
        chips={selectedUser ? [
          { label: selectedUser.is_active ? "Active" : "Inactive", color: selectedUser.is_active ? "success" : "default" as const },
          { label: selectedUser.is_staff ? "Staff" : "User", variant: "outlined" as const },
        ] : []}
        isFavorite={selectedUser ? favorites.includes(selectedUser.id) : false}
        onToggleFavorite={selectedUser ? (e) => toggleFavorite(selectedUser.id, e) : undefined}
      />

      <ActionToolbar
        canCreate={canCreate}
        canUpdate={canUpdate}
        canDelete={canDelete}
        canDuplicate={false}
        hasSelectedItem={!!selectedUser}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={saving}
        isFormValid={!!isFormValid}
        onNew={handleCreate}
        onDelete={handleDelete}
        onSave={handleSave}
        onCancel={handleCancel}
        onEdit={handleEdit}
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
        {!selectedUser && !isCreating ? (
          <EmptyState message="Select a user from the list or create a new one" />
        ) : (
          <>
            {error && (
              <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            {/* Account Information */}
            <FormSection title="Account Information" columns={2}>
              <TextField
                label="Username"
                value={formData.username}
                onChange={(e) => {
                  setFormData({ ...formData, username: e.target.value });
                  setUsernameError(null);
                }}
                disabled={isDisabled}
                required
                size="small"
                fullWidth
                autoComplete="off"
                error={!!usernameError}
                helperText={usernameError}
              />
              {isCreating && (
                <TextField
                  label="Password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => handlePasswordChange(e.target.value)}
                  required
                  size="small"
                  fullWidth
                  autoComplete="new-password"
                  error={!!passwordError}
                  helperText={passwordError || "Min 8 chars, uppercase, lowercase, number, special char"}
                />
              )}
              <TextField
                label="Email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                disabled={isDisabled}
                required
                size="small"
                fullWidth
              />
              <TextField
                label="Employee ID"
                value={formData.employee_id}
                onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                disabled={isDisabled}
                required
                size="small"
                fullWidth
              />
            </FormSection>

            {/* Personal Information */}
            <FormSection title="Personal Information" columns={3}>
              <TextField
                label="First Name"
                value={formData.first_name}
                onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                disabled={isDisabled}
                required
                size="small"
                fullWidth
              />
              <TextField
                label="Middle Name"
                value={formData.middle_name}
                onChange={(e) => setFormData({ ...formData, middle_name: e.target.value })}
                disabled={isDisabled}
                size="small"
                fullWidth
              />
              <TextField
                label="Last Name"
                value={formData.last_name}
                onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                disabled={isDisabled}
                required
                size="small"
                fullWidth
              />
              <Autocomplete
                options={GENDER_CHOICES}
                getOptionLabel={(option) => typeof option === 'string' ? option : option.label}
                value={GENDER_CHOICES.find(g => g.value === formData.gender) || GENDER_CHOICES[0]}
                onChange={(_, newValue) => setFormData({ ...formData, gender: newValue?.value || "m" })}
                disabled={isDisabled}
                renderInput={(params) => <TextField {...params} label="Gender" size="small" />}
                fullWidth
              />
              <TextField
                label="Birthdate"
                type="date"
                value={formData.birthdate}
                onChange={(e) => setFormData({ ...formData, birthdate: e.target.value })}
                disabled={isDisabled}
                size="small"
                fullWidth
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="Occupation"
                value={formData.occupation}
                onChange={(e) => setFormData({ ...formData, occupation: e.target.value })}
                disabled={isDisabled}
                required
                size="small"
                fullWidth
              />
            </FormSection>

            {/* Access & Permissions */}
            <FormSection title="Access & Permissions" columns={2}>
              <Autocomplete
                multiple
                options={branches}
                getOptionLabel={(option) => option.branch_name}
                value={branches.filter((b) => formData.branch_ids?.includes(b.id))}
                onChange={(_, newValue) => setFormData({ ...formData, branch_ids: newValue.map((b) => b.id) })}
                disabled={isDisabled}
                renderInput={(params) => (
                  <TextField {...params} label="Branches" placeholder="Search branches..." size="small" />
                )}
                renderOption={(props, option, { selected }) => (
                  <li {...props}>
                    <Checkbox checked={selected} sx={{ mr: 1 }} size="small" />
                    {option.branch_name}
                  </li>
                )}
                disableCloseOnSelect
                fullWidth
              />
              <Autocomplete
                multiple
                options={groups}
                getOptionLabel={(option) => option.name}
                value={groups.filter((g) => formData.group_ids?.includes(g.id))}
                onChange={(_, newValue) => setFormData({ ...formData, group_ids: newValue.map((g) => g.id) })}
                disabled={isDisabled}
                renderInput={(params) => (
                  <TextField {...params} label="Roles" placeholder="Search roles..." size="small" />
                )}
                renderOption={(props, option, { selected }) => (
                  <li {...props}>
                    <Checkbox checked={selected} sx={{ mr: 1 }} size="small" />
                    {option.name}
                  </li>
                )}
                disableCloseOnSelect
                fullWidth
              />
              <Box sx={{ display: "flex", gap: 3, gridColumn: "1 / -1" }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      disabled={isDisabled}
                    />
                  }
                  label="Active"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={formData.is_staff}
                      onChange={(e) => setFormData({ ...formData, is_staff: e.target.checked })}
                      disabled={isDisabled}
                    />
                  }
                  label="Staff"
                />
              </Box>
            </FormSection>

            {/* Assigned Branches (View Mode) */}
            {selectedUser && !isEditing && !isCreating && selectedUser.branches.length > 0 && (
              <FormSection title="Assigned Branches" columns={1}>
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                  {selectedUser.branches.map((branch) => (
                    <Chip
                      key={branch.id}
                      label={`${branch.branch_name} (${branch.branch_code})`}
                      size="small"
                      variant="outlined"
                      color="primary"
                    />
                  ))}
                </Box>
              </FormSection>
            )}

            {/* Assigned Roles (View Mode) */}
            {selectedUser && !isEditing && !isCreating && selectedUser.groups && selectedUser.groups.length > 0 && (
              <FormSection title="Assigned Roles" columns={1}>
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                  {selectedUser.groups.map((group) => (
                    <Chip
                      key={group.id}
                      label={group.name}
                      size="small"
                      variant="outlined"
                      color="secondary"
                    />
                  ))}
                </Box>
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
        title="User Management"
        icon={<PersonIcon color="primary" />}
        onRefresh={loadData}
        isLoading={loading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />
      <ConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
