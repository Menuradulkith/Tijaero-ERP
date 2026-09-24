/**
 * UsersPage - Refactored to use Tijaero-style reusable components
 */

import HistoryIcon from "@mui/icons-material/History";
import PersonIcon from "@mui/icons-material/Person";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import StarIcon from "@mui/icons-material/Star";
import StarOutlineIcon from "@mui/icons-material/StarBorder";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import {
    Alert,
    Autocomplete,
    Avatar,
    Box,
    Button,
    Checkbox,
    Chip,
    FormControlLabel,
    IconButton,
    InputAdornment,
    Paper,
    Switch,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDateTimeReadable } from "@/utils/formatters";

// Tijaero Components
import {
    ActionToolbar,
    DetailPanelHeader,
    EmptyState,
    FormSection,
    MasterDetailLayout,
    TDetailSkeleton,
    TExportButton,
    TPageSkeleton,
    useMasterDetailState,
    GENDER_CHOICES,
    TConfirmDialog,
    useConfirmDialog,
    handleApiError,
    useCrudMutation,
    showErrorToast,
    TActivityHistoryPanel,
    TStatusFilter,
    TAutocomplete,
    type TFilterStatusOption,
    TDataGrid,
    SelectableListItem,
    type TDataGridColumn,
} from "@/components/tijaero";

import { usePermission } from "@/auth/components/PermissionGuard";
import { PERMISSIONS } from "@/auth/permissions";
import { useAuthStore } from "@/state/authStore";
import type { Branch } from "../../../api/types";
import { branchApi } from "../../branches/api";
import { Group, groupsApi } from "../../groups/api";
import { UserCreate, UserList, usersApi, UserUpdate } from "../api";
import UserAvatarUploader from "../components/UserAvatarUploader";

// Configuration
const USER_STATUS_OPTIONS: TFilterStatusOption[] = [
  { value: null, label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const TODAY = new Date().toISOString().split("T")[0];

const INITIAL_FORM_DATA: Partial<UserCreate> = {
  username: "",
  password: "",
  email: "",
  first_name: "",
  middle_name: "",
  last_name: "",
  gender: "",
  birthdate: "",
  date_joined: TODAY,
  employee_id: "",
  phone_number: "",
  is_active: true,
  is_staff: false,
  branch_ids: [],
  primary_branch_id: undefined,
  group_ids: [],
};

const resetFormFromUser = (user: UserList): Partial<UserCreate> => ({
  username: user.username,
  email: user.email,
  first_name: user.first_name,
  middle_name: user.middle_name || "",
  last_name: user.last_name,
  gender: user.gender || "",
  birthdate: user.birthdate || "",
  date_joined: user.date_joined || TODAY,
  employee_id: user.employee_id || "",
  phone_number: user.phone_number || "",
  is_active: user.is_active,
  is_staff: user.is_staff,
  branch_ids: user.branches.map((b) => b.id),
  primary_branch_id: user.primary_branch?.id,
  group_ids: user.groups?.map((g) => g.id) || [],
});

// Date validation
const validateNotFutureDate = (value: string, label: string): string | null => {
  if (!value) return null;
  if (value > TODAY) return `${label} cannot be a future date`;
  return null;
};

// Email validation (email is optional; format is only checked when provided)
const validateEmail = (email: string): string | null => {
  if (!email) return null;
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
  const [birthdateError, setBirthdateError] = useState<string | null>(null);
  const [dateJoinedError, setDateJoinedError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  // Filter state - all filters apply live as the user types/selects, no
  // separate "Search" step needed.
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterBranch, setFilterBranch] = useState<Branch | null>(null);
  const [filterRole, setFilterRole] = useState<Group | null>(null);

  // Permissions
  const canCreate = usePermission(PERMISSIONS.USER_CREATE.resource, PERMISSIONS.USER_CREATE.action);
  const canUpdate = usePermission(PERMISSIONS.USER_UPDATE.resource, PERMISSIONS.USER_UPDATE.action);
  const canDelete = usePermission(PERMISSIONS.USER_DELETE.resource, PERMISSIONS.USER_DELETE.action);

  const confirmDialog = useConfirmDialog();

  // Use reusable state hook
  const {
    searchQuery,
    setSearchQuery,
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

  // Activity History is opened on demand from a detail icon next to the
  // Activity History section title, rather than shown inline.
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterStatus(null);
    setFilterBranch(null);
    setFilterRole(null);
  }, [setSearchQuery]);

  useEffect(() => {
    loadData();
  }, []);

  // Guards against out-of-order responses: if two loadData() calls overlap
  // (e.g. two quick admin actions in a row), a slower/older call's response
  // must not clobber state already updated by a call that started later.
  const loadDataSeqRef = useRef(0);

  const loadData = async (refreshSelectedUserId?: number) => {
    const seq = ++loadDataSeqRef.current;
    try {
      setLoading(true);
      setError(null);

      const promises: Promise<any>[] = [usersApi.getUsers()];
      promises.push(groupsApi.getGroups().catch(() => []));
      promises.push(branchApi.getAll(1, 100).catch(() => ({ items: [] })));

      const [usersData, groupsData, branchesData] = await Promise.all(promises);

      // A newer loadData() call has since started — this response is stale.
      if (seq !== loadDataSeqRef.current) return;

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
      if (seq !== loadDataSeqRef.current) return;
      const errorMsg = handleApiError(err, "Failed to load data");
      setError(errorMsg);
      showErrorToast(errorMsg);
    } finally {
      if (seq === loadDataSeqRef.current) setLoading(false);
    }
  };

  // Filter users (hide superusers)
  const filteredUsers = useMemo(() => {
    let filtered = users.filter((user) => !user.is_superuser);

    // Filter by branch
    if (filterBranch) {
      filtered = filtered.filter((user) =>
        user.branches.some((b) => b.id === filterBranch.id)
      );
    }

    // Filter by role
    if (filterRole) {
      filtered = filtered.filter((user) =>
        user.groups.some((g) => g.id === filterRole.id)
      );
    }

    // Filter by status
    if (filterStatus) {
      const isActive = filterStatus === "active";
      filtered = filtered.filter((user) => user.is_active === isActive);
    }

    if (searchQuery) {
      filtered = filtered.filter(
        (user) =>
          user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
          user.first_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          user.last_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (user.email || "").toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Default order before the user sorts a column in the browse table
    // itself (the table's own column-header sort takes over from there).
    filtered.sort((a, b) => a.username.localeCompare(b.username));

    return filtered;
  }, [users, searchQuery, filterBranch, filterRole, filterStatus]);

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

  const unblockUserMutation = useCrudMutation({
    mutationFn: (id: number) => usersApi.unblockUser(id),
    invalidateQueryKeys: [["users"]],
    successMessage: "User unblocked successfully",
    errorMessage: "Failed to unblock user",
    onSuccess: async (_data, id) => {
      await loadData(id);
    },
  });

  const forcePasswordResetMutation = useCrudMutation({
    mutationFn: (id: number) => usersApi.forcePasswordReset(id),
    invalidateQueryKeys: [["users"]],
    successMessage: "User will be required to set a new password on next login",
    errorMessage: "Failed to force password reset",
    onSuccess: async (_data, id) => {
      await loadData(id);
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

  const handlePasswordChange = useCallback((value: string) => {
    setFormData((prev) => ({ ...prev, password: value }));
    setPasswordError(validatePassword(value));
  }, [setFormData]);

  const handleEmailChange = useCallback(async (value: string) => {
    setFormData((prev) => ({ ...prev, email: value }));

    const basicValidation = validateEmail(value);
    if (basicValidation) {
      setEmailError(basicValidation);
      return;
    }

    if (isCreating) {
      try {
        const exists = await usersApi.checkEmailExists(value);
        setEmailError(exists ? "Email already exists" : null);
      } catch {
        setEmailError(null);
      }
    } else {
      setEmailError(null);
    }
  }, [setFormData, isCreating]);

  const handleBirthdateChange = useCallback((value: string) => {
    setFormData((prev) => ({ ...prev, birthdate: value }));
    setBirthdateError(validateNotFutureDate(value, "Birthdate"));
  }, [setFormData]);

  const handleDateJoinedChange = useCallback((value: string) => {
    setFormData((prev) => ({ ...prev, date_joined: value }));
    setDateJoinedError(validateNotFutureDate(value, "Date joined"));
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
      setBirthdateError(null);
      setDateJoinedError(null);
      setSaving(true);

      // Validate required fields
      const validationErrors = [];
      if (!formData.username?.trim()) validationErrors.push("Username is required");
      if (!formData.first_name?.trim()) validationErrors.push("First name is required");
      if (!formData.last_name?.trim()) validationErrors.push("Last name is required");
      if (!formData.branch_ids || formData.branch_ids.length === 0) validationErrors.push("At least one branch is required");
      if (formData.branch_ids?.length && !formData.primary_branch_id) validationErrors.push("Primary branch is required");
      if (!formData.group_ids || formData.group_ids.length === 0) validationErrors.push("At least one role is required");

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

      // Validate birthdate / date joined are not in the future
      const birthdateValidation = validateNotFutureDate(formData.birthdate || '', "Birthdate");
      if (birthdateValidation) {
        setBirthdateError(birthdateValidation);
        validationErrors.push(birthdateValidation);
      }
      const dateJoinedValidation = validateNotFutureDate(formData.date_joined || '', "Date joined");
      if (dateJoinedValidation) {
        setDateJoinedError(dateJoinedValidation);
        validationErrors.push(dateJoinedValidation);
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

      // Check for duplicate username
      if (formData.username) {
        const exists = await usersApi.checkUsernameExists(formData.username);
        if (exists && (isCreating || formData.username !== selectedUser?.username)) {
          setUsernameError("Username already exists");
          showErrorToast("Username already exists");
          setSaving(false);
          return;
        }
      }

      // Check for duplicate email
      if (formData.email) {
        const emailExists = await usersApi.checkEmailExists(formData.email);
        if (emailExists && (isCreating || formData.email !== selectedUser?.email)) {
          setEmailError("Email already exists");
          showErrorToast("Email already exists");
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

  // Cancelling out of "New User" should return to the browse table, not
  // auto-open the first user the way useMasterDetailState's generic
  // handleCancel does (that behavior made sense for the old always-visible
  // detail panel, but not here). Cancelling out of editing an existing user
  // still just reverts its form, which the generic handler already does
  // correctly.
  const handleCancel = useCallback(() => {
    setPasswordError(null);
    setEmailError(null);
    setEmployeeIdError(null);
    setUsernameError(null);
    setBirthdateError(null);
    setDateJoinedError(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedUser(null);
    } else {
      baseHandleCancel(filteredUsers);
    }
  }, [isCreating, baseHandleCancel, filteredUsers, setIsCreating, setIsEditing, setSelectedUser]);

  // Returns to the browse table from the detail view (the "Back to Users"
  // link above the detail header).
  const handleBackToUsers = useCallback(() => {
    setSelectedUser(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [isCreating, setSelectedUser, setIsCreating, setIsEditing]);

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

  const isFormValid = formData.username && formData.first_name && formData.last_name &&
    formData.employee_id &&
    !!formData.branch_ids?.length && !!formData.primary_branch_id && !!formData.group_ids?.length &&
    (isCreating ? !passwordError && formData.password : true);
  const isDisabled = !isEditing && !isCreating;

  // Whether we're showing a single user's detail view (selected or being
  // created) instead of the browse table.
  const isUserDetailMode = !!selectedUser || isCreating;

  // Browse mode: a full-width table of every user, with the country/role/
  // branch names looked up and attached directly so the table's own
  // column-header sort orders by the displayed text rather than the raw ids.
  type UserRow = UserList & { full_name: string; role_names: string; branch_names: string };

  const userRows: UserRow[] = useMemo(
    () =>
      filteredUsers.map((user) => ({
        ...user,
        full_name: `${user.first_name} ${user.last_name}`.trim(),
        role_names: (user.groups || []).map((g) => g.name).join(", "),
        branch_names: user.primary_branch?.branch_name || (user.branches || []).map((b) => b.branch_name).join(", "),
      })),
    [filteredUsers]
  );

  const userColumns: TDataGridColumn<UserRow>[] = useMemo(
    () => [
      {
        field: "favorite",
        header: "",
        width: 48,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<UserRow>) => (
          <IconButton size="small" onClick={(e) => toggleFavorite(params.row.id, e)}>
            {favorites.includes(params.row.id) ? (
              <StarIcon fontSize="small" color="warning" />
            ) : (
              <StarOutlineIcon fontSize="small" color="action" />
            )}
          </IconButton>
        ),
      },
      { field: "username", header: "Username", flex: 1, minWidth: 150 },
      { field: "full_name", header: "Full Name", flex: 1, minWidth: 170 },
      { field: "email", header: "Email", flex: 1, minWidth: 190 },
      { field: "role_names", header: "Role", flex: 1, minWidth: 150 },
      { field: "branch_names", header: "Branch", flex: 1, minWidth: 150 },
      {
        field: "is_active",
        header: "Status",
        width: 110,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<UserRow>) => (
          <Chip
            label={params.row.is_active ? "Active" : "Inactive"}
            size="small"
            color={params.row.is_active ? "success" : "default"}
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
        renderCell: (params: GridRenderCellParams<UserRow>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectUser(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [favorites, toggleFavorite, handleSelectUser]
  );

  const usersTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<UserRow>
          rows={userRows}
          columns={userColumns}
          loading={loading}
          onRowClick={(row) => handleSelectUser(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No users found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Detail mode: a narrow left panel showing only the current user (or the
  // "New User" placeholder while creating). A "Back to Users" link returns
  // to the table.
  const singleUserPanel = (
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
          onClick={handleBackToUsers}
          sx={{ textTransform: "none" }}
        >
          Back to Users
        </Button>
      </Box>
      {isCreating ? (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ bgcolor: "primary.main" }}>
              <PersonIcon fontSize="small" />
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              New User
            </Typography>
          </Box>
        </Box>
      ) : selectedUser && (
        <Box>
          <SelectableListItem
            id={selectedUser.id}
            isSelected
            onClick={() => {}}
            primaryText={
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
                <Avatar sx={{ bgcolor: "primary.main" }}>
                  <PersonIcon fontSize="small" />
                </Avatar>
                <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5, minWidth: 0 }}>
                  <span>{`${selectedUser.first_name} ${selectedUser.last_name}`.trim()}</span>
                  <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                    {selectedUser.username}
                  </Typography>
                </Box>
              </Box>
            }
            isFavorite={favorites.includes(selectedUser.id)}
            onToggleFavorite={(e) => toggleFavorite(selectedUser.id, e)}
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

            {/* Profile Picture */}
            {selectedUser && !isCreating && (
              <Box sx={{ mb: 3 }}>
                <UserAvatarUploader
                  user={selectedUser}
                  disabled={!canUpdate}
                  onUpdated={(path) => {
                    setSelectedUser({ ...selectedUser, profile_picture_path: path || undefined });
                  }}
                />
              </Box>
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
              {isEditing && !isCreating && (
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
                value={GENDER_CHOICES.find(g => g.value === formData.gender) || null}
                onChange={(_, newValue) => setFormData({ ...formData, gender: newValue?.value || "" })}
                disabled={isDisabled}
                renderInput={(params) => <TextField {...params} label="Gender" size="small" placeholder="Select gender..." />}
                fullWidth
              />
              <TextField
                label="Birthdate"
                type="date"
                value={formData.birthdate}
                onChange={(e) => handleBirthdateChange(e.target.value)}
                disabled={isDisabled}
                size="small"
                fullWidth
                InputLabelProps={{ shrink: true }}
                inputProps={{ max: TODAY }}
                error={!!birthdateError}
                helperText={birthdateError}
              />
              <TextField
                label="Date Joined"
                type="date"
                value={formData.date_joined}
                onChange={(e) => handleDateJoinedChange(e.target.value)}
                disabled={isDisabled}
                size="small"
                fullWidth
                InputLabelProps={{ shrink: true }}
                inputProps={{ max: TODAY }}
                error={!!dateJoinedError}
                helperText={dateJoinedError}
              />
              <TextField
                label="Phone Number"
                value={formData.phone_number}
                onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                disabled={isDisabled}
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
                onChange={(_, newValue) => {
                  const newBranchIds = newValue.map((b) => b.id);
                  const primaryStillAssigned = !!formData.primary_branch_id && newBranchIds.includes(formData.primary_branch_id);
                  setFormData({
                    ...formData,
                    branch_ids: newBranchIds,
                    primary_branch_id: primaryStillAssigned ? formData.primary_branch_id : newBranchIds[0],
                  });
                }}
                disabled={isDisabled}
                renderInput={(params) => (
                  <TextField {...params} label="Branches" placeholder="Search branches..." size="small" required={!formData.branch_ids?.length} />
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
                options={branches.filter((b) => formData.branch_ids?.includes(b.id))}
                getOptionLabel={(option) => option.branch_name}
                value={branches.find((b) => b.id === formData.primary_branch_id) || null}
                onChange={(_, newValue) => setFormData({ ...formData, primary_branch_id: newValue?.id })}
                disabled={isDisabled || !formData.branch_ids?.length}
                renderInput={(params) => (
                  <TextField {...params} label="Primary Branch" placeholder="Select primary branch..." size="small" required={!!formData.branch_ids?.length} />
                )}
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
                  <TextField {...params} label="Roles" placeholder="Search roles..." size="small" required={!formData.group_ids?.length} />
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
                  {selectedUser.branches.map((branch) => {
                    const isPrimary = selectedUser.primary_branch?.id === branch.id;
                    return (
                      <Chip
                        key={branch.id}
                        label={isPrimary ? `${branch.branch_name} (${branch.branch_code}) · Primary` : `${branch.branch_name} (${branch.branch_code})`}
                        size="small"
                        variant={isPrimary ? "filled" : "outlined"}
                        color="primary"
                      />
                    );
                  })}
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

            {/* Activity History (view mode only) */}
            {selectedUser && !isEditing && !isCreating && (
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

            {/* Account Security (view mode only) */}
            {selectedUser && !isEditing && !isCreating && (
              <FormSection title="Account Security" columns={2}>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <Typography variant="caption" color="text.secondary">Login Status</Typography>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                    <Chip
                      label={selectedUser.blocked ? "Blocked" : "Not Blocked"}
                      size="small"
                      color={selectedUser.blocked ? "error" : "success"}
                      variant={selectedUser.blocked ? "filled" : "outlined"}
                    />
                    {selectedUser.blocked && canUpdate && (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => unblockUserMutation.mutate(selectedUser.id)}
                        disabled={unblockUserMutation.isPending}
                      >
                        Unblock User
                      </Button>
                    )}
                  </Box>
                </Box>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <Typography variant="caption" color="text.secondary">Password Reset</Typography>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                    <Chip
                      label={selectedUser.must_change_password ? "Required on Next Login" : "Not Required"}
                      size="small"
                      color={selectedUser.must_change_password ? "warning" : "default"}
                      variant={selectedUser.must_change_password ? "filled" : "outlined"}
                    />
                    {!selectedUser.must_change_password && canUpdate && (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => forcePasswordResetMutation.mutate(selectedUser.id)}
                        disabled={forcePasswordResetMutation.isPending}
                      >
                        Force Password Reset
                      </Button>
                    )}
                  </Box>
                </Box>
              </FormSection>
            )}
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
        title="Users"
        titleSlot={
          isUserDetailMode ? undefined : (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <TextField
              size="small"
              placeholder="Username, name, or email"
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
                options={USER_STATUS_OPTIONS}
                value={filterStatus}
                onChange={setFilterStatus}
                label=""
                placeholder="All Status"
                size="small"
              />
            </Box>
            <Box sx={{ width: 170, flexShrink: 0 }}>
              <TAutocomplete<Branch>
                label=""
                placeholder="All Branches"
                options={branches}
                value={filterBranch}
                onChange={(value) => setFilterBranch(value as Branch | null)}
                getOptionLabel={(b) => b.branch_name}
                size="small"
              />
            </Box>
            <Box sx={{ width: 170, flexShrink: 0 }}>
              <TAutocomplete<Group>
                label=""
                placeholder="All Roles"
                options={groups}
                value={filterRole}
                onChange={(value) => setFilterRole(value as Group | null)}
                getOptionLabel={(g) => g.name}
                size="small"
              />
            </Box>
            {(searchQuery || filterStatus || filterBranch || filterRole) && (
              <Tooltip title="Clear filters">
                <IconButton size="small" onClick={handleClearFilters}>
                  <ClearIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
          )
        }
        onRefresh={loadData}
        isLoading={loading}
        headerActions={
          isUserDetailMode ? undefined : (
            <>
              {canCreate && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={handleCreate}
                  sx={{ mr: 1 }}
                >
                  Add User
                </Button>
              )}
              <TExportButton
                filename="users"
                headers={[
                  "Username",
                  "First Name",
                  "Middle Name",
                  "Last Name",
                  "Email",
                  "Gender",
                  "Birthdate",
                  "Date Joined",
                  "Employee ID",
                  "Branches",
                  "Roles",
                  "Status",
                ]}
                rows={() =>
                  filteredUsers.map((u) => [
                    u.username || "",
                    u.first_name || "",
                    u.middle_name || "",
                    u.last_name || "",
                    u.email || "",
                    GENDER_CHOICES.find((g) => g.value === u.gender)?.label || "",
                    u.birthdate ? new Date(u.birthdate).toLocaleDateString() : "",
                    u.date_joined ? new Date(u.date_joined).toLocaleDateString() : "",
                    u.employee_id || "",
                    (u.branches || []).map((b) => b.branch_name).join(", "),
                    (u.groups || []).map((g) => g.name).join(", "),
                    u.is_active ? "Active" : "Inactive",
                  ])
                }
                disabled={filteredUsers.length === 0}
              />
            </>
          )
        }
        {...(isUserDetailMode ? { masterPanel: singleUserPanel, detailPanel } : { children: usersTablePanel })}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />

      <TActivityHistoryPanel
        open={activityHistoryOpen}
        onClose={() => setActivityHistoryOpen(false)}
        entityType="user"
        entityId={selectedUser?.id}
        actionLabels={{
          create: "User created",
          update: "User updated",
          delete: "User deleted",
        }}
      />
    </>
  );
}
