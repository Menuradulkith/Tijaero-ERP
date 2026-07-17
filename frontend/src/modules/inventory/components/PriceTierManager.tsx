import React, { useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  Alert,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { priceTiersApi } from "../api";
import { PriceTier, PriceTierCreate } from "../types";

interface PriceTierManagerProps {
  productId: number;
  canEdit?: boolean;
}

interface TierFormState {
  cost_price: string;
  minimum_selling_price: string;
  selling_price: string;
  website_price: string;
  remark: string;
  is_active: boolean;
}

const emptyForm: TierFormState = {
  cost_price: "",
  minimum_selling_price: "",
  selling_price: "",
  website_price: "",
  remark: "",
  is_active: true,
};

const fmt = (v?: number | null) =>
  v != null ? v.toLocaleString("en-US", { minimumFractionDigits: 2 }) : "—";

const PriceTierManager: React.FC<PriceTierManagerProps> = ({
  productId,
  canEdit = false,
}) => {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<PriceTier | null>(null);
  const [form, setForm] = useState<TierFormState>(emptyForm);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [error, setError] = useState<string>("");

  const qKey = ["price-tiers", productId];

  const { data: tiers = [], isLoading } = useQuery({
    queryKey: qKey,
    queryFn: () => priceTiersApi.list(productId),
    enabled: !!productId,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qKey });

  const createMut = useMutation({
    mutationFn: (data: PriceTierCreate) => priceTiersApi.create(productId, data),
    onSuccess: () => { invalidate(); closeDialog(); },
    onError: (e: any) => setError(e?.response?.data?.detail || "Failed to save."),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: PriceTierCreate }) =>
      priceTiersApi.update(productId, id, data),
    onSuccess: () => { invalidate(); closeDialog(); },
    onError: (e: any) => setError(e?.response?.data?.detail || "Failed to save."),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      priceTiersApi.toggle(productId, id, isActive),
    onSuccess: invalidate,
    onError: (e: any) => setError(e?.response?.data?.detail || "Failed to update."),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => priceTiersApi.delete(productId, id),
    onSuccess: () => { invalidate(); setDeleteConfirmId(null); },
    onError: (e: any) => setError(e?.response?.data?.detail || "Cannot delete."),
  });

  const openAdd = () => {
    setEditingTier(null);
    setForm(emptyForm);
    setError("");
    setDialogOpen(true);
  };

  const openEdit = (tier: PriceTier) => {
    setEditingTier(tier);
    setForm({
      cost_price: String(tier.cost_price),
      minimum_selling_price: String(tier.minimum_selling_price),
      selling_price: String(tier.selling_price),
      website_price: tier.website_price != null ? String(tier.website_price) : "",
      remark: tier.remark || "",
      is_active: tier.is_active,
    });
    setError("");
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingTier(null);
    setForm(emptyForm);
    setError("");
  };

  const handleSave = () => {
    setError("");
    const payload: PriceTierCreate = {
      cost_price: parseFloat(form.cost_price),
      minimum_selling_price: parseFloat(form.minimum_selling_price),
      selling_price: parseFloat(form.selling_price),
      website_price: form.website_price ? parseFloat(form.website_price) : undefined,
      remark: form.remark || undefined,
      is_active: form.is_active,
    };

    if (isNaN(payload.cost_price) || isNaN(payload.minimum_selling_price) || isNaN(payload.selling_price)) {
      setError("Please fill in all required price fields.");
      return;
    }

    if (editingTier) {
      updateMut.mutate({ id: editingTier.id, data: payload });
    } else {
      createMut.mutate(payload);
    }
  };

  const isBusy = createMut.isPending || updateMut.isPending;

  return (
    <Box>
      {/* Header row */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mb: 1,
        }}
      >
        <Typography variant="subtitle2" color="text.secondary">
          Price Tiers
        </Typography>
        {canEdit && (
          <Button
            size="small"
            startIcon={<AddIcon />}
            variant="outlined"
            onClick={openAdd}
          >
            Add Tier
          </Button>
        )}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {isLoading ? (
        <Box sx={{ display: "flex", justifyContent: "center", p: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : tiers.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          No price tiers yet.
        </Typography>
      ) : (
        <TableContainer
          sx={{
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            maxHeight: 300,
            overflowY: "auto",
          }}
        >
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Remark</TableCell>
                <TableCell align="right">Cost</TableCell>
                <TableCell align="right">Min. Sell</TableCell>
                <TableCell align="right">Selling</TableCell>
                <TableCell align="right">Website</TableCell>
                {canEdit && <TableCell align="center">Active</TableCell>}
                {canEdit && <TableCell align="center">Actions</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {tiers.map((tier) => (
                <TableRow
                  key={tier.id}
                  hover
                  sx={{ opacity: tier.is_active ? 1 : 0.55 }}
                >
                  <TableCell>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      {tier.remark || (
                        <Typography variant="body2" color="text.disabled">
                          —
                        </Typography>
                      )}
                      {!tier.is_active && (
                        <Chip label="Inactive" size="small" color="default" />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell align="right">{fmt(tier.cost_price)}</TableCell>
                  <TableCell align="right">{fmt(tier.minimum_selling_price)}</TableCell>
                  <TableCell align="right">{fmt(tier.selling_price)}</TableCell>
                  <TableCell align="right">{fmt(tier.website_price)}</TableCell>
                  {canEdit && (
                    <TableCell align="center">
                      <Tooltip
                        title={
                          tier.is_active
                            ? "Deactivate (hides from Sales)"
                            : "Activate"
                        }
                      >
                        <Switch
                          size="small"
                          checked={tier.is_active}
                          onChange={(e) =>
                            toggleMut.mutate({
                              id: tier.id,
                              isActive: e.target.checked,
                            })
                          }
                        />
                      </Tooltip>
                    </TableCell>
                  )}
                  {canEdit && (
                    <TableCell align="center">
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => openEdit(tier)}>
                          <EditIcon fontSize="inherit" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => {
                            setError("");
                            setDeleteConfirmId(tier.id);
                          }}
                        >
                          <DeleteIcon fontSize="inherit" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingTier ? "Edit Price Tier" : "Add Price Tier"}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, mt: 1 }}>
            <TextField
              label="Cost Price *"
              type="number"
              value={form.cost_price}
              onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
              inputProps={{ min: 0, step: "0.01" }}
              fullWidth
            />
            <TextField
              label="Min. Selling Price *"
              type="number"
              value={form.minimum_selling_price}
              onChange={(e) =>
                setForm({ ...form, minimum_selling_price: e.target.value })
              }
              inputProps={{ min: 0, step: "0.01" }}
              fullWidth
            />
            <TextField
              label="Selling Price *"
              type="number"
              value={form.selling_price}
              onChange={(e) => setForm({ ...form, selling_price: e.target.value })}
              inputProps={{ min: 0, step: "0.01" }}
              fullWidth
            />
            <TextField
              label="Website Price"
              type="number"
              value={form.website_price}
              onChange={(e) => setForm({ ...form, website_price: e.target.value })}
              inputProps={{ min: 0, step: "0.01" }}
              fullWidth
            />
            <TextField
              label="Remark"
              value={form.remark}
              onChange={(e) => setForm({ ...form, remark: e.target.value })}
              placeholder='e.g. "Special Import Batch — June 2026"'
              fullWidth
              sx={{ gridColumn: "1 / -1" }}
            />
          </Box>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog} disabled={isBusy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={isBusy}
            startIcon={isBusy ? <CircularProgress size={16} /> : undefined}
          >
            {editingTier ? "Save Changes" : "Add Tier"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog
        open={deleteConfirmId !== null}
        onClose={() => setDeleteConfirmId(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete Price Tier?</DialogTitle>
        <DialogContent>
          <Typography>
            This tier will be permanently removed. If it has been used on any
            invoice or quotation, you will see an error and should deactivate
            it instead.
          </Typography>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDeleteConfirmId(null); setError(""); }}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => deleteConfirmId && deleteMut.mutate(deleteConfirmId)}
            disabled={deleteMut.isPending}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PriceTierManager;
