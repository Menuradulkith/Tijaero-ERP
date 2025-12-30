import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Button,
  Card,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Grid,
  useMediaQuery,
  useTheme,
  Stack,
  Paper,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import BusinessIcon from "@mui/icons-material/Business";
import EmailIcon from "@mui/icons-material/Email";
import PhoneIcon from "@mui/icons-material/Phone";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import toast from "react-hot-toast";
import { branchApi } from "../api";
import type { Branch, BranchCreate } from "@/api/types";

export default function BranchesPage() {
  const queryClient = useQueryClient();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const isTablet = useMediaQuery(theme.breakpoints.down("md"));

  const [openDialog, setOpenDialog] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [formData, setFormData] = useState<BranchCreate>({
    branch_name: "",
    branch_code: "",
    address: "",
    email: "",
    contact_number: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["branches"],
    queryFn: () => branchApi.getAll(1, 100),
  });

  const createMutation = useMutation({
    mutationFn: branchApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      toast.success("Branch created successfully");
      handleCloseDialog();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || "Failed to create branch");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      branchApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      toast.success("Branch updated successfully");
      handleCloseDialog();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || "Failed to update branch");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: branchApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      toast.success("Branch deleted successfully");
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || "Failed to delete branch");
    },
  });

  const handleOpenDialog = (branch?: Branch) => {
    if (branch) {
      setEditingBranch(branch);
      setFormData({
        branch_name: branch.branch_name,
        branch_code: branch.branch_code,
        address: branch.address || "",
        email: branch.email || "",
        contact_number: branch.contact_number || "",
      });
    } else {
      setEditingBranch(null);
      setFormData({
        branch_name: "",
        branch_code: "",
        address: "",
        email: "",
        contact_number: "",
      });
    }
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setEditingBranch(null);
  };

  const handleSubmit = () => {
    if (editingBranch) {
      updateMutation.mutate({ id: editingBranch.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (id: number) => {
    if (window.confirm("Are you sure you want to delete this branch?")) {
      deleteMutation.mutate(id);
    }
  };

  // Mobile Card View
  const MobileCard = ({ branch }: { branch: Branch }) => (
    <Paper
      elevation={2}
      sx={{
        p: 2,
        mb: 2,
        borderLeft: 4,
        borderColor: "primary.main",
      }}
    >
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <BusinessIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>
            {branch.branch_name}
          </Typography>
        </Box>
        <Chip label={branch.branch_code} color="primary" size="small" />
      </Box>

      <Stack spacing={1} sx={{ mt: 2 }}>
        {branch.address && (
          <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
            <LocationOnIcon fontSize="small" color="action" />
            <Typography variant="body2" color="text.secondary">
              {branch.address}
            </Typography>
          </Box>
        )}
        {branch.email && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <EmailIcon fontSize="small" color="action" />
            <Typography variant="body2" color="text.secondary">
              {branch.email}
            </Typography>
          </Box>
        )}
        {branch.contact_number && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <PhoneIcon fontSize="small" color="action" />
            <Typography variant="body2" color="text.secondary">
              {branch.contact_number}
            </Typography>
          </Box>
        )}
      </Stack>

      <Box sx={{ display: "flex", gap: 1, mt: 2, justifyContent: "flex-end" }}>
        <IconButton
          size="small"
          onClick={() => handleOpenDialog(branch)}
          color="primary"
        >
          <EditIcon />
        </IconButton>
        <IconButton
          size="small"
          onClick={() => handleDelete(branch.id)}
          color="error"
        >
          <DeleteIcon />
        </IconButton>
      </Box>
    </Paper>
  );

  return (
    <Box sx={{ width: "100%", maxWidth: "100%" }}>
      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          justifyContent: "space-between",
          alignItems: { xs: "flex-start", sm: "center" },
          gap: 2,
          mb: 3,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <BusinessIcon
            sx={{ fontSize: { xs: 28, sm: 32 }, color: "primary.main" }}
          />
          <Typography variant={isMobile ? "h5" : "h4"} fontWeight={600}>
            Branches
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenDialog()}
          fullWidth={isMobile}
          size={isMobile ? "medium" : "large"}
        >
          Add Branch
        </Button>
      </Box>

      {isMobile || isTablet ? (
        // Mobile/Tablet Card View
        <Box>
          {isLoading ? (
            <Typography align="center" sx={{ py: 4 }}>
              Loading...
            </Typography>
          ) : data?.items.length === 0 ? (
            <Paper sx={{ p: 4, textAlign: "center" }}>
              <BusinessIcon
                sx={{ fontSize: 48, color: "text.secondary", mb: 2 }}
              />
              <Typography color="text.secondary">No branches found</Typography>
            </Paper>
          ) : (
            data?.items.map((branch) => (
              <MobileCard key={branch.id} branch={branch} />
            ))
          )}
        </Box>
      ) : (
        // Desktop Table View
        <Card sx={{ width: "100%" }}>
          <TableContainer>
            <Table sx={{ minWidth: 650 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Branch Code</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Branch Name</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Address</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Email</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Contact</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>
                    Actions
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : data?.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      No branches found
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.items.map((branch) => (
                    <TableRow key={branch.id}>
                      <TableCell>
                        <Chip
                          label={branch.branch_code}
                          color="primary"
                          size="small"
                        />
                      </TableCell>
                      <TableCell>
                        <Typography fontWeight={500}>
                          {branch.branch_name}
                        </Typography>
                      </TableCell>
                      <TableCell>{branch.address || "-"}</TableCell>
                      <TableCell>{branch.email || "-"}</TableCell>
                      <TableCell>{branch.contact_number || "-"}</TableCell>
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          onClick={() => handleOpenDialog(branch)}
                          color="primary"
                        >
                          <EditIcon />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => handleDelete(branch.id)}
                          color="error"
                        >
                          <DeleteIcon />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}

      {/* Create/Edit Dialog */}
      <Dialog
        open={openDialog}
        onClose={handleCloseDialog}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogTitle>
          {editingBranch ? "Edit Branch" : "Create New Branch"}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Branch Code"
                value={formData.branch_code}
                onChange={(e) =>
                  setFormData({ ...formData, branch_code: e.target.value })
                }
                required
                disabled={!!editingBranch}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Branch Name"
                value={formData.branch_name}
                onChange={(e) =>
                  setFormData({ ...formData, branch_name: e.target.value })
                }
                required
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Address"
                value={formData.address}
                onChange={(e) =>
                  setFormData({ ...formData, address: e.target.value })
                }
                multiline
                rows={2}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Email"
                type="email"
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Contact Number"
                value={formData.contact_number}
                onChange={(e) =>
                  setFormData({ ...formData, contact_number: e.target.value })
                }
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={handleCloseDialog} fullWidth={isMobile}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            variant="contained"
            disabled={
              !formData.branch_name ||
              !formData.branch_code ||
              createMutation.isPending ||
              updateMutation.isPending
            }
            fullWidth={isMobile}
          >
            {editingBranch ? "Update" : "Create"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
