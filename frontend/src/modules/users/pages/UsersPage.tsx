import { useState, useEffect } from "react";
import {
  Box,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  OutlinedInput,
  Checkbox,
  ListItemText,
  Grid,
  Alert,
  CircularProgress,
  Tooltip,
} from "@mui/material";
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  Person as PersonIcon,
} from "@mui/icons-material";
import { usersApi, UserList, UserCreate, UserUpdate } from "../api";
import { groupsApi, Group } from "../../groups/api";
import { branchApi } from "../../branches/api";
import type { Branch } from "../../../api/types";
import PermissionGuard, {
  usePermission,
} from "@/auth/components/PermissionGuard";
import { PERMISSIONS } from "@/auth/permissions";

export default function UsersPage() {
  const [users, setUsers] = useState<UserList[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Permission checks
  const canUpdate = usePermission(
    PERMISSIONS.USER_UPDATE.resource,
    PERMISSIONS.USER_UPDATE.action
  );
  const canDelete = usePermission(
    PERMISSIONS.USER_DELETE.resource,
    PERMISSIONS.USER_DELETE.action
  );

  // Dialog states
  const [openDialog, setOpenDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<UserList | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserList | null>(null);

  // Form state
  const [formData, setFormData] = useState<Partial<UserCreate>>({
    username: "",
    password: "",
    email: "",
    first_name: "",
    middle_name: "",
    last_name: "",
    gender: "Male",
    birthdate: new Date().toISOString().split("T")[0],
    occupation: "",
    employee_id: "",
    is_active: true,
    is_staff: false,
    branch_ids: [],
    group_ids: [],
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load data with permission checks
      const promises: Promise<any>[] = [usersApi.getUsers()];

      // Only load groups if user has permission
      promises.push(
        groupsApi.getGroups().catch((err) => {
          if (err.response?.status === 403) {
            console.warn("No permission to view groups");
            return [];
          }
          throw err;
        })
      );

      // Only load branches if user has permission
      promises.push(
        branchApi.getAll(1, 100).catch((err) => {
          if (err.response?.status === 403) {
            console.warn("No permission to view branches");
            return { items: [] };
          }
          throw err;
        })
      );

      const [usersData, groupsData, branchesData] = await Promise.all(promises);

      setUsers(usersData);
      setGroups(groupsData);
      setBranches(branchesData.items || []);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = (user?: UserList) => {
    if (user) {
      setEditingUser(user);
      setFormData({
        username: user.username,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        is_active: user.is_active,
        branch_ids: user.branches.map((b) => b.id),
        group_ids: [],
      });
    } else {
      setEditingUser(null);
      setFormData({
        username: "",
        password: "",
        email: "",
        first_name: "",
        middle_name: "",
        last_name: "",
        gender: "Male",
        birthdate: new Date().toISOString().split("T")[0],
        occupation: "",
        employee_id: "",
        is_active: true,
        is_staff: false,
        branch_ids: [],
        group_ids: [],
      });
    }
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setEditingUser(null);
    setError(null);
  };

  const handleSubmit = async () => {
    try {
      setError(null);
      if (editingUser) {
        await usersApi.updateUser(editingUser.id, formData as UserUpdate);
        setSuccess("User updated successfully");
      } else {
        await usersApi.createUser(formData as UserCreate);
        setSuccess("User created successfully");
      }
      handleCloseDialog();
      loadData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to save user");
    }
  };

  const handleDelete = async () => {
    if (!userToDelete) return;
    try {
      await usersApi.deleteUser(userToDelete.id);
      setSuccess("User deleted successfully");
      setDeleteConfirmOpen(false);
      setUserToDelete(null);
      loadData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to delete user");
    }
  };

  if (loading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="400px"
      >
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box
        display="flex"
        flexDirection={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", sm: "center" }}
        mb={3}
        gap={2}
      >
        <Box display="flex" alignItems="center" gap={2}>
          <PersonIcon
            sx={{ fontSize: { xs: 28, sm: 32 }, color: "primary.main" }}
          />
          <Typography
            variant="h4"
            fontWeight="bold"
            sx={{ fontSize: { xs: "1.5rem", sm: "2rem", md: "2.125rem" } }}
          >
            User Management
          </Typography>
        </Box>
        <Box display="flex" gap={2} flexWrap="wrap">
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={loadData}
            sx={{
              fontSize: { xs: "0.8125rem", sm: "0.875rem" },
              padding: { xs: "6px 12px", sm: "8px 16px" },
            }}
          >
            Refresh
          </Button>
          <PermissionGuard
            resource={PERMISSIONS.USER_CREATE.resource}
            action={PERMISSIONS.USER_CREATE.action}
          >
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => handleOpenDialog()}
              sx={{
                fontSize: { xs: "0.8125rem", sm: "0.875rem" },
                padding: { xs: "6px 12px", sm: "8px 16px" },
              }}
            >
              Add User
            </Button>
          </PermissionGuard>
        </Box>
      </Box>

      {/* Alerts */}
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert
          severity="success"
          onClose={() => setSuccess(null)}
          sx={{ mb: 2 }}
        >
          {success}
        </Alert>
      )}

      {/* Users Table */}
      <TableContainer
        component={Paper}
        elevation={2}
        sx={{ overflowX: "auto" }}
      >
        <Table sx={{ minWidth: { xs: 800, md: "auto" } }}>
          <TableHead>
            <TableRow sx={{ backgroundColor: "primary.main" }}>
              <TableCell
                sx={{
                  color: "white",
                  fontWeight: "bold",
                  fontSize: { xs: "0.75rem", sm: "0.875rem" },
                }}
              >
                Username
              </TableCell>
              <TableCell
                sx={{
                  color: "white",
                  fontWeight: "bold",
                  fontSize: { xs: "0.75rem", sm: "0.875rem" },
                }}
              >
                Name
              </TableCell>
              <TableCell
                sx={{
                  color: "white",
                  fontWeight: "bold",
                  fontSize: { xs: "0.75rem", sm: "0.875rem" },
                  display: { xs: "none", md: "table-cell" },
                }}
              >
                Email
              </TableCell>
              <TableCell
                sx={{
                  color: "white",
                  fontWeight: "bold",
                  fontSize: { xs: "0.75rem", sm: "0.875rem" },
                  display: { xs: "none", lg: "table-cell" },
                }}
              >
                Employee ID
              </TableCell>
              <TableCell
                sx={{
                  color: "white",
                  fontWeight: "bold",
                  fontSize: { xs: "0.75rem", sm: "0.875rem" },
                  display: { xs: "none", lg: "table-cell" },
                }}
              >
                Branches
              </TableCell>
              <TableCell
                sx={{
                  color: "white",
                  fontWeight: "bold",
                  fontSize: { xs: "0.75rem", sm: "0.875rem" },
                }}
              >
                Status
              </TableCell>
              <TableCell
                sx={{
                  color: "white",
                  fontWeight: "bold",
                  fontSize: { xs: "0.75rem", sm: "0.875rem" },
                  display: { xs: "none", sm: "table-cell" },
                }}
              >
                Role
              </TableCell>
              <TableCell
                sx={{
                  color: "white",
                  fontWeight: "bold",
                  fontSize: { xs: "0.75rem", sm: "0.875rem" },
                }}
                align="center"
              >
                Actions
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id} hover>
                <TableCell sx={{ fontSize: { xs: "0.75rem", sm: "0.875rem" } }}>
                  <Box
                    display="flex"
                    alignItems="center"
                    gap={1}
                    flexWrap="wrap"
                  >
                    {user.username}
                    {user.is_superuser && (
                      <Chip label="Admin" size="small" color="error" />
                    )}
                  </Box>
                </TableCell>
                <TableCell
                  sx={{ fontSize: { xs: "0.75rem", sm: "0.875rem" } }}
                >{`${user.first_name} ${user.last_name}`}</TableCell>
                <TableCell
                  sx={{
                    fontSize: { xs: "0.75rem", sm: "0.875rem" },
                    display: { xs: "none", md: "table-cell" },
                  }}
                >
                  {user.email}
                </TableCell>
                <TableCell
                  sx={{
                    fontSize: { xs: "0.75rem", sm: "0.875rem" },
                    display: { xs: "none", lg: "table-cell" },
                  }}
                >
                  {user.employee_id}
                </TableCell>
                <TableCell sx={{ display: { xs: "none", lg: "table-cell" } }}>
                  <Box display="flex" gap={0.5} flexWrap="wrap">
                    {user.branches.map((branch) => (
                      <Chip
                        key={branch.id}
                        label={branch.branch_code}
                        size="small"
                        variant="outlined"
                      />
                    ))}
                  </Box>
                </TableCell>
                <TableCell>
                  <Chip
                    label={user.is_active ? "Active" : "Inactive"}
                    color={user.is_active ? "success" : "default"}
                    size="small"
                  />
                </TableCell>
                <TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}>
                  <Chip
                    label={user.is_staff ? "Staff" : "User"}
                    size="small"
                    variant="outlined"
                  />
                </TableCell>
                <TableCell align="center">
                  <Box
                    sx={{ display: "flex", gap: 0.5, justifyContent: "center" }}
                  >
                    {canUpdate && (
                      <Tooltip title="Edit">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => handleOpenDialog(user)}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {canDelete && !user.is_superuser && (
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => {
                            setUserToDelete(user);
                            setDeleteConfirmOpen(true);
                          }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Create/Edit Dialog */}
      <Dialog
        open={openDialog}
        onClose={handleCloseDialog}
        maxWidth="md"
        fullWidth
        fullScreen={false}
        sx={{
          "& .MuiDialog-paper": {
            margin: { xs: 1, sm: 2 },
            maxHeight: { xs: "calc(100% - 16px)", sm: "calc(100% - 64px)" },
          },
        }}
      >
        <DialogTitle>
          {editingUser ? "Edit User" : "Create New User"}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Username"
                value={formData.username}
                onChange={(e) =>
                  setFormData({ ...formData, username: e.target.value })
                }
                required
                disabled={!!editingUser}
              />
            </Grid>
            {!editingUser && (
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Password"
                  type="password"
                  value={formData.password}
                  onChange={(e) =>
                    setFormData({ ...formData, password: e.target.value })
                  }
                  required
                />
              </Grid>
            )}
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Email"
                type="email"
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="First Name"
                value={formData.first_name}
                onChange={(e) =>
                  setFormData({ ...formData, first_name: e.target.value })
                }
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Middle Name"
                value={formData.middle_name}
                onChange={(e) =>
                  setFormData({ ...formData, middle_name: e.target.value })
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Last Name"
                value={formData.last_name}
                onChange={(e) =>
                  setFormData({ ...formData, last_name: e.target.value })
                }
                required
              />
            </Grid>
            {!editingUser && (
              <>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Gender</InputLabel>
                    <Select
                      value={formData.gender}
                      onChange={(e) =>
                        setFormData({ ...formData, gender: e.target.value })
                      }
                      label="Gender"
                    >
                      <MenuItem value="Male">Male</MenuItem>
                      <MenuItem value="Female">Female</MenuItem>
                      <MenuItem value="Other">Other</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Birthdate"
                    type="date"
                    value={formData.birthdate}
                    onChange={(e) =>
                      setFormData({ ...formData, birthdate: e.target.value })
                    }
                    InputLabelProps={{ shrink: true }}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Occupation"
                    value={formData.occupation}
                    onChange={(e) =>
                      setFormData({ ...formData, occupation: e.target.value })
                    }
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Employee ID"
                    value={formData.employee_id}
                    onChange={(e) =>
                      setFormData({ ...formData, employee_id: e.target.value })
                    }
                    required
                  />
                </Grid>
              </>
            )}
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Branches</InputLabel>
                <Select
                  multiple
                  value={formData.branch_ids || []}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      branch_ids: e.target.value as number[],
                    })
                  }
                  input={<OutlinedInput label="Branches" />}
                  renderValue={(selected) =>
                    branches
                      .filter((b) => selected.includes(b.id))
                      .map((b) => b.branch_name)
                      .join(", ")
                  }
                >
                  {branches.map((branch) => (
                    <MenuItem key={branch.id} value={branch.id}>
                      <Checkbox
                        checked={formData.branch_ids?.includes(branch.id)}
                      />
                      <ListItemText primary={branch.branch_name} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Roles</InputLabel>
                <Select
                  multiple
                  value={formData.group_ids || []}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      group_ids: e.target.value as number[],
                    })
                  }
                  input={<OutlinedInput label="Roles" />}
                  renderValue={(selected) =>
                    groups
                      .filter((g) => selected.includes(g.id))
                      .map((g) => g.name)
                      .join(", ")
                  }
                >
                  {groups.map((group) => (
                    <MenuItem key={group.id} value={group.id}>
                      <Checkbox
                        checked={formData.group_ids?.includes(group.id)}
                      />
                      <ListItemText primary={group.name} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <FormControl>
                <Box display="flex" alignItems="center" gap={2}>
                  <Box>
                    <Checkbox
                      checked={formData.is_active}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          is_active: e.target.checked,
                        })
                      }
                    />
                    Active
                  </Box>
                  <Box>
                    <Checkbox
                      checked={formData.is_staff}
                      onChange={(e) =>
                        setFormData({ ...formData, is_staff: e.target.checked })
                      }
                    />
                    Staff
                  </Box>
                </Box>
              </FormControl>
            </Grid>
          </Grid>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button onClick={handleSubmit} variant="contained">
            {editingUser ? "Update" : "Create"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
      >
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          Are you sure you want to delete user "{userToDelete?.username}"?
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
          <Button onClick={handleDelete} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
