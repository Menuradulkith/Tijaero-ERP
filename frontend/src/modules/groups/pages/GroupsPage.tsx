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
  Checkbox,
  Grid,
  Alert,
  CircularProgress,
  Tooltip,
  Card,
  CardContent,
} from "@mui/material";
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  Group as GroupIcon,
  Security as SecurityIcon,
} from "@mui/icons-material";
import {
  groupsApi,
  permissionsApi,
  Group,
  GroupCreate,
  GroupUpdate,
  Permission,
} from "../api";

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Dialog states
  const [openDialog, setOpenDialog] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<Group | null>(null);

  // Form state
  const [formData, setFormData] = useState<GroupCreate>({
    name: "",
    permission_ids: [],
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

  const handleOpenDialog = (group?: Group) => {
    if (group) {
      setEditingGroup(group);
      setFormData({
        name: group.name,
        permission_ids: group.permissions.map((p) => p.id),
      });
    } else {
      setEditingGroup(null);
      setFormData({
        name: "",
        permission_ids: [],
      });
    }
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setEditingGroup(null);
    setError(null);
  };

  const handleSubmit = async () => {
    try {
      setError(null);
      if (editingGroup) {
        await groupsApi.updateGroup(editingGroup.id, formData as GroupUpdate);
        setSuccess("Role updated successfully");
      } else {
        await groupsApi.createGroup(formData);
        setSuccess("Role created successfully");
      }
      handleCloseDialog();
      loadData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to save role");
    }
  };

  const handleDelete = async () => {
    if (!groupToDelete) return;
    try {
      await groupsApi.deleteGroup(groupToDelete.id);
      setSuccess("Role deleted successfully");
      setDeleteConfirmOpen(false);
      setGroupToDelete(null);
      loadData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to delete role");
    }
  };

  // Group permissions by resource
  const groupedPermissions = permissions.reduce((acc, perm) => {
    if (!acc[perm.resource]) {
      acc[perm.resource] = [];
    }
    acc[perm.resource].push(perm);
    return acc;
  }, {} as Record<string, Permission[]>);

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
        justifyContent="space-between"
        alignItems="center"
        mb={3}
      >
        <Box display="flex" alignItems="center" gap={2}>
          <SecurityIcon sx={{ fontSize: 32, color: "primary.main" }} />
          <Typography variant="h4" fontWeight="bold">
            Roles & Permissions
          </Typography>
        </Box>
        <Box display="flex" gap={2}>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={loadData}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => handleOpenDialog()}
          >
            Add Role
          </Button>
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

      {/* Groups Table */}
      <TableContainer component={Paper} elevation={2}>
        <Table>
          <TableHead>
            <TableRow sx={{ backgroundColor: "primary.main" }}>
              <TableCell sx={{ color: "white", fontWeight: "bold" }}>
                Role Name
              </TableCell>
              <TableCell sx={{ color: "white", fontWeight: "bold" }}>
                Permissions
              </TableCell>
              <TableCell
                sx={{ color: "white", fontWeight: "bold" }}
                align="center"
              >
                Actions
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {groups.map((group) => (
              <TableRow key={group.id} hover>
                <TableCell>
                  <Box display="flex" alignItems="center" gap={1}>
                    <GroupIcon color="primary" />
                    <Typography fontWeight="medium">{group.name}</Typography>
                  </Box>
                </TableCell>
                <TableCell>
                  <Box display="flex" gap={0.5} flexWrap="wrap">
                    {group.permissions.slice(0, 5).map((perm) => (
                      <Chip
                        key={perm.id}
                        label={perm.name}
                        size="small"
                        variant="outlined"
                        color="primary"
                      />
                    ))}
                    {group.permissions.length > 5 && (
                      <Chip
                        label={`+${group.permissions.length - 5} more`}
                        size="small"
                        variant="outlined"
                      />
                    )}
                  </Box>
                </TableCell>
                <TableCell align="center">
                  <Tooltip title="Edit">
                    <IconButton
                      size="small"
                      color="primary"
                      onClick={() => handleOpenDialog(group)}
                    >
                      <EditIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete">
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => {
                        setGroupToDelete(group);
                        setDeleteConfirmOpen(true);
                      }}
                    >
                      <DeleteIcon />
                    </IconButton>
                  </Tooltip>
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
      >
        <DialogTitle>
          {editingGroup ? "Edit Role" : "Create New Role"}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Role Name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                required
              />
            </Grid>
            <Grid item xs={12}>
              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                Permissions
              </Typography>
              <Box sx={{ maxHeight: 400, overflowY: "auto" }}>
                {Object.entries(groupedPermissions).map(([resource, perms]) => (
                  <Card key={resource} sx={{ mb: 2 }}>
                    <CardContent>
                      <Typography
                        variant="subtitle2"
                        fontWeight="bold"
                        color="primary"
                        gutterBottom
                      >
                        {resource.toUpperCase()}
                      </Typography>
                      <Grid container spacing={1}>
                        {perms.map((perm) => (
                          <Grid item xs={12} sm={6} key={perm.id}>
                            <Box display="flex" alignItems="center">
                              <Checkbox
                                checked={formData.permission_ids.includes(
                                  perm.id
                                )}
                                onChange={(
                                  e: React.ChangeEvent<HTMLInputElement>
                                ) => {
                                  if (e.target.checked) {
                                    setFormData({
                                      ...formData,
                                      permission_ids: [
                                        ...formData.permission_ids,
                                        perm.id,
                                      ],
                                    });
                                  } else {
                                    setFormData({
                                      ...formData,
                                      permission_ids:
                                        formData.permission_ids.filter(
                                          (id) => id !== perm.id
                                        ),
                                    });
                                  }
                                }}
                              />
                              <Box>
                                <Typography variant="body2">
                                  {perm.name}
                                </Typography>
                                {perm.description && (
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                  >
                                    {perm.description}
                                  </Typography>
                                )}
                              </Box>
                            </Box>
                          </Grid>
                        ))}
                      </Grid>
                    </CardContent>
                  </Card>
                ))}
              </Box>
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
            {editingGroup ? "Update" : "Create"}
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
          Are you sure you want to delete role "{groupToDelete?.name}"?
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
