/**
 * UsersPage - Refactored to use Tijaero-style reusable components
 */

import PersonIcon from "@mui/icons-material/Person";
import {
    Alert,
    Autocomplete,
    Box,
    Checkbox,
    Chip,
    FormControlLabel,
    Switch,
    TextField,
    Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDateTimeReadable } from "@/utils/formatters";

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
    TDetailSkeleton,
    TPageSkeleton,
    useMasterDetailState,
    GENDER_CHOICES,
    TConfirmDialog,
    useConfirmDialog,
    handleApiError,
    useCrudMutation,
    showErrorToast,
} from "@/components/tijaero";

import { usePermission } from "@/auth/components/PermissionGuard";
import { PERMISSIONS } from "@/auth/permissions";
import { useAuthStore } from "@/state/authStore";
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
  date_joined: new Date().toISOString().split("T")[0],
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
  middle_name: user.middle_name || "",
  last_name: user.last_name,
  gender: user.gender || "m",
  birthdate: user.birthdate || new Date().toISOString().split("T")[0],
  date_joined: user.date_joined || new Date().toISOString().split("T")[0],
  occupation: user.occupation || "",
  employee_id: user.employee_id || "",
  is_active: user.is_active,
  is_staff: user.is_staff,
  branch_ids: user.branches.map((b) => b.id),
  group_ids: user.groups?.map((g) => g.id) || [],
});

// Email validation
const validateEmail = (email: string): string | null => {
  if (!email) return "Email is required";
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return "Please enter a valid email address";
  return null;
};

// Employee ID validation
const validateEmployeeId = (employeeId: string): string | null => {
  if (!employeeId) return "Employee ID is required";
  if (employeeId.length < 3) return "Employee ID must be at least 3 characters long";
  if (!/^[a-zA-Z0-9-_]+$/.test(employeeId)) return "Employee ID can only contain letters, numbers, hyphens, and underscores";
  return null;
};

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
  const currentUser = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [users, setUsers] = useState<UserList[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [employeeIdError, setEmployeeIdError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [filterBranchId, setFilterBranchId] = useState<number | null>(null);
  const [filterRoleId, setFilterRoleId] = useState<number | null>(null);

  // Permissions
  const canCreate = usePermission(PERMISSIONS.USER_CREATE.resource, PERMISSIONS.USER_CREATE.action);
  const canUpdate = usePermission(PERMISSIONS.USER_UPDATE.resource, PERMISSIONS.USER_UPDATE.action);
  const canDelete = usePermission(PERMISSIONS.USER_DELETE.resource, PERMISSIONS.USER_DELETE.action);

  const confirmDialog = useConfirmDialog();

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
    markAsSaved,
    handleSelectItem: baseHandleSelectUser,
    handleNew: handleCreate,
    handleCancel: baseHandleCancel,
    handleStartEdit: handleEdit,
  } = useMasterDetailState<UserList, Partial<UserCreate>>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromUser,
    favoritesKey: "users_favorites",
    defaultSortField: "username",
    confirmUnsavedChanges: () => confirmDialog.confirm({
      title: "Discard Changes",
      message: "You have unsaved changes. Discard them?",
      confirmText: "Discard",
      cancelText: "Keep Editing",
      confirmColor: "warning",
    }),
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
    } catch (err: unknown) {
      const errorMsg = handleApiError(err, "Failed to load data");
      setError(errorMsg);
      showErrorToast(errorMsg);
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

  const createUserMutation = useCrudMutation({
    mutationFn: (user: UserCreate) => usersApi.createUser(user),
    invalidateQueryKeys: [["users"]],
    successMessage: "User created successfully",
    errorMessage: "Failed to save user",
    onSuccess: async () => {
      markAsSaved();
      setIsCreating(false);
      setIsEditing(false);
      await loadData();
    },
  });

  const updateUserMutation = useCrudMutation({
    mutationFn: ({ id, user }: { id: number; user: UserUpdate }) =>
      usersApi.updateUser(id, user),
    invalidateQueryKeys: [["users"]],
    getSuccessMessage: (_data, variables) => {
      const isPasswordReset = Boolean(variables.user.password?.trim());
      const isSelfReset =
        Boolean(currentUser) && variables.id === currentUser!.id;
      if (isPasswordReset && isSelfReset) {
        return "Password reset successfully. Please log in again.";
      }
      return "User updated successfully";
    },
    errorMessage: "Failed to save user",
    onSuccess: async (_data, variables) => {
      const isPasswordReset = Boolean(variables.user.password?.trim());
      const isSelfReset =
        Boolean(currentUser) && variables.id === currentUser!.id;

      if (isPasswordReset && isSelfReset) {
        logout();
        window.location.href = "/login";
        return;
      }

      markAsSaved();
      setIsEditing(false);
      await loadData(variables.id);
    },
  });

  const deleteUserMutation = useCrudMutation({
    mutationFn: (id: number) => usersApi.deleteUser(id),
    invalidateQueryKeys: [["users"]],
    successMessage: "User deleted successfully",
    errorMessage: "Failed to delete user",
    onSuccess: async () => {
      setSelectedUser(null);
      await loadData();
    },
  });

  // Handlers
  const handleSelectUser = useCallback((user: UserList) => {
    setPasswordError(null);
    setEmailError(null);
    setEmployeeIdError(null);
    setUsernameError(null);
    baseHandleSelectUser(user);
  }, [baseHandleSelectUser]);

  // Auto-select first user when users are loaded or filtered
  // But NOT when we're creating a new item (selectedUser is null during creation)
  useEffect(() => {
    if (filteredUsers.length > 0 && !selectedUser && !isCreating) {
      handleSelectUser(filteredUsers[0]);
    }
  }, [filteredUsers, selectedUser, isCreating, handleSelectUser]);

  const handlePasswordChange = useCallback((value: string) => {
    setFormData((prev) => ({ ...prev, password: value }));
    setPasswordError(validatePassword(value));
  }, [setFormData]);

  const handleEmailChange = useCallback((value: string) => {
    setFormData((prev) => ({ ...prev, email: value }));
    setEmailError(validateEmail(value));
  }, [setFormData]);

  const handleEmployeeIdChange = useCallback(async (value: string) => {
    setFormData((prev) => ({ ...prev, employee_id: value }));
    
    // Basic validation first
    const basicValidation = validateEmployeeId(value);
    if (basicValidation) {
      setEmployeeIdError(basicValidation);
      return;
    }
    
    // Check for duplicates when creating and value is valid
    if (isCreating && value.length >= 3) {
      try {
        const exists = await usersApi.checkEmployeeIdExists(value);
        if (exists) {
          setEmployeeIdError("Employee ID already exists");
        } else {
          setEmployeeIdError(null);
        }
      } catch {
        // Ignore API errors for real-time validation
        setEmployeeIdError(null);
      }
    } else {
      setEmployeeIdError(null);
    }
  }, [setFormData, isCreating]);

  const handleSave = useCallback(async () => {
    try {
      setError(null);
      setUsernameError(null);
      setEmailError(null);
      setEmployeeIdError(null);
      setSaving(true);
      
      // Validate required fields
      const validationErrors = [];
      if (!formData.username?.trim()) validationErrors.push("Username is required");
      if (!formData.first_name?.trim()) validationErrors.push("First name is required");
      if (!formData.last_name?.trim()) validationErrors.push("Last name is required");
      if (!formData.occupation?.trim()) validationErrors.push("Occupation is required");
      
      // Validate email format
      const emailValidation = validateEmail(formData.email || '');
      if (emailValidation) {
        setEmailError(emailValidation);
        validationErrors.push(emailValidation);
      }
      
      // Validate employee ID
      const employeeIdValidation = validateEmployeeId(formData.employee_id || '');
      if (employeeIdValidation) {
        setEmployeeIdError(employeeIdValidation);
        validationErrors.push(employeeIdValidation);
      }
      
      // Validate password when creating or when resetting during edit
      if (isCreating || (!!formData.password && formData.password.trim().length > 0)) {
        const passwordValidation = validatePassword(formData.password || '');
        if (passwordValidation) {
          setPasswordError(passwordValidation);
          validationErrors.push(passwordValidation);
        }
      }
      
      if (validationErrors.length > 0) {
        showErrorToast(`Please fix the following errors: ${validationErrors.join(", ")}`);
        setSaving(false);
        return;
      }
      
      // Check for duplicate username when creating
      if (isCreating && formData.username) {
        const exists = await usersApi.checkUsernameExists(formData.username);
        if (exists) {
          setUsernameError("Username already exists");
          showErrorToast("Username already exists");
          setSaving(false);
          return;
        }
      }
      
      // Check for duplicate employee ID when creating
      if (isCreating && formData.employee_id) {
        const employeeExists = await usersApi.checkEmployeeIdExists(formData.employee_id);
        if (employeeExists) {
          setEmployeeIdError("Employee ID already exists");
          showErrorToast("Employee ID already exists");
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
        await createUserMutation.mutateAsync(cleanedData as UserCreate);
      } else if (selectedUser) {
        await updateUserMutation.mutateAsync({
          id: selectedUser.id,
          user: cleanedData as UserUpdate,
        });
      } else {
        await loadData();
      }
    } catch (err: unknown) {
      const errorMsg = handleApiError(err, "Failed to save user");
      setError(errorMsg);
    } finally {
      setSaving(false);
    }
  }, [
    isCreating,
    selectedUser,
    formData,
    createUserMutation,
    updateUserMutation,
    setIsCreating,
    setIsEditing,
    markAsSaved,
  ]);

  const handleCancel = useCallback(() => {
    setPasswordError(null);
    setEmailError(null);
    setEmployeeIdError(null);
    setUsernameError(null);
    baseHandleCancel(filteredUsers);
  }, [baseHandleCancel, filteredUsers]);

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
          await deleteUserMutation.mutateAsync(selectedUser.id);
        } catch (err: unknown) {
          const errorMessage = handleApiError(err, "Failed to delete user");
          setError(errorMessage);
        }
      }
    }
  }, [selectedUser, deleteUserMutation, confirmDialog]);

  if (loading) {
    return <TPageSkeleton variant="detail" />;
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
          isSelected={isSelected}
          onClick={() => handleSelectUser(user)}
          primaryText={
            <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
              {/* Username */}
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{user.username}</span>
                {isSelected && (
                  <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                    (Username)
                  </Typography>
                )}
              </Box>
              {/* Additional fields when selected */}
              {isSelected && (
                <>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      {user.first_name} {user.last_name}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Name)
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      {user.email}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Email)
                    </Typography>
                  </Box>
                  {/* Status Chips - shown below all fields when selected */}
                  <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                    <Chip
                      label={user.is_active ? "Active" : "Inactive"}
                      size="small"
                      color={user.is_active ? "success" : "default"}
                      sx={{ height: 18, fontSize: "0.65rem" }}
                    />
                    {user.is_staff && (
                      <Chip
                        label="Staff"
                        size="small"
                        color="warning"
                        sx={{ height: 18, fontSize: "0.65rem" }}
                      />
                    )}
                    {user.is_superuser && (
                      <Chip
                        label="Super"
                        size="small"
                        color="error"
                        sx={{ height: 18, fontSize: "0.65rem" }}
                      />
                    )}
                  </Box>
                </>
              )}
            </Box>
          }
          secondaryText={!isSelected ? `${user.first_name} ${user.last_name}` : undefined}
          isFavorite={favorites.includes(user.id)}
          onToggleFavorite={(e) => toggleFavorite(user.id, e)}
          chips={!isSelected ? [
            ...(user.is_active ? [{ label: "Active", color: "success" as const }] : [{ label: "Inactive", color: "default" as const }]),
            ...(user.is_staff ? [{ label: "Staff", color: "warning" as const }] : []),
          ] : []}
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
        ) : loading && !isCreating ? (
          <TDetailSkeleton sections={3} fieldsPerSection={4} showHeader={false} showToolbar={false} />
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
              {isEditing && (
                <TextField
                  label="Reset Password (Optional)"
                  type="password"
                  value={formData.password || ""}
                  onChange={(e) => handlePasswordChange(e.target.value)}
                  size="small"
                  fullWidth
                  autoComplete="new-password"
                  error={!!passwordError}
                  helperText={passwordError || "Leave empty to keep current password"}
                />
              )}
              <TextField
                label="Email"
                type="email"
                value={formData.email}
                onChange={(e) => handleEmailChange(e.target.value)}
                disabled={isDisabled}
                required
                size="small"
                fullWidth
                error={!!emailError}
                helperText={emailError}
              />
              <TextField
                label="Employee ID"
                value={formData.employee_id}
                onChange={(e) => handleEmployeeIdChange(e.target.value)}
                disabled={isDisabled}
                required
                size="small"
                fullWidth
                error={!!employeeIdError}
                helperText={employeeIdError || "Unique identifier for the employee (letters, numbers, hyphens, underscores)"}
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
                label="Date Joined"
                type="date"
                value={formData.date_joined}
                onChange={(e) => setFormData({ ...formData, date_joined: e.target.value })}
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

            {/* Record Information (view mode only) */}
            {selectedUser && !isEditing && !isCreating && (
              <FormSection title="Record Information" columns={2}>
                <Box>
                  <Typography variant="caption" color="text.secondary">Created</Typography>
                  <Typography variant="body2">{formatDateTimeReadable(selectedUser.created_at) || "-"}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Last Modified</Typography>
                  <Typography variant="body2">{formatDateTimeReadable(selectedUser.updated_at) || "-"}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Last Login</Typography>
                  <Typography variant="body2">{selectedUser.last_login ? formatDateTimeReadable(selectedUser.last_login) : "Never"}</Typography>
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
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
