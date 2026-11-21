/**
 * "New Stock Count" dialog: branch (required), optional location and item category,
 * remark. On success the caller opens the new count's sheet.
 */
import { handleApiError } from "@/components/tijaero";
import { useReferenceData } from "@/hooks";
import { materialCategoriesApi } from "@/modules/materials/api";
import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { stockCountApi, type StockCount } from "../stockCountApi";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (count: StockCount) => void;
  /** Branch to preselect (the list's branch filter or the user's branch). */
  defaultBranchCode?: string;
}

export default function NewStockCountDialog({ open, onClose, onCreated, defaultBranchCode }: Props) {
  const { filteredBranches, filteredLocations, isLoading: isLoadingRef } = useReferenceData(["branches", "locations"]);
  const branches = filteredBranches || [];
  const allLocations = filteredLocations || [];

  const { data: categories = [], isLoading: isLoadingCategories } = useQuery({
    queryKey: ["materialCategories", "active"],
    queryFn: () => materialCategoriesApi.getAll(0, 100000, true),
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });

  const [branch, setBranch] = useState("");
  const [locationId, setLocationId] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [remark, setRemark] = useState("");
  const [error, setError] = useState("");

  // Fresh form each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setBranch(defaultBranchCode || "");
    setLocationId(null);
    setCategoryId(null);
    setRemark("");
    setError("");
  }, [open, defaultBranchCode]);

  const locations = branch ? allLocations.filter((l) => l.branch_code === branch) : [];

  const createMutation = useMutation({
    mutationFn: () =>
      stockCountApi.create({
        branch_code: branch,
        location_id: locationId,
        category_id: categoryId,
        remark: remark.trim() || null,
      }),
    onSuccess: (count) => onCreated(count),
    onError: (e) => setError(handleApiError(e, "Could not create the stock count")),
  });

  const submit = () => {
    if (!branch || createMutation.isPending) return;
    setError("");
    createMutation.mutate();
  };

  return (
    <Dialog open={open} onClose={createMutation.isPending ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New Stock Count</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            The count sheet lists every item on hand in the branch (or the chosen location / category) with its
            system quantity. Enter what you count, then post the count to adjust stock.
          </Typography>
          <Autocomplete
            size="small"
            options={branches}
            getOptionLabel={(o) => o.branch_name || o.branch_code || ""}
            value={branches.find((b) => b.branch_code === branch) || null}
            onChange={(_, v) => {
              setBranch(v?.branch_code || "");
              setLocationId(null);
            }}
            renderInput={(params) => <TextField {...params} label="Branch" required />}
            noOptionsText={isLoadingRef ? "Loading..." : "No branches found"}
          />
          <Autocomplete
            size="small"
            options={locations}
            getOptionLabel={(o) => o.name || ""}
            value={locations.find((l) => l.id === locationId) || null}
            onChange={(_, v) => setLocationId(v ? v.id : null)}
            disabled={!branch}
            renderInput={(params) => (
              <TextField {...params} label="Location" placeholder="All locations" InputLabelProps={{ ...params.InputLabelProps, shrink: true }} />
            )}
            noOptionsText={isLoadingRef ? "Loading..." : "No locations in this branch"}
          />
          <Autocomplete
            size="small"
            options={categories}
            getOptionLabel={(o) => o.name || ""}
            value={categories.find((c) => c.id === categoryId) || null}
            onChange={(_, v) => setCategoryId(v ? v.id : null)}
            renderInput={(params) => (
              <TextField {...params} label="Item category" placeholder="All categories" InputLabelProps={{ ...params.InputLabelProps, shrink: true }} />
            )}
            noOptionsText={isLoadingCategories ? "Loading..." : "No categories found"}
          />
          <TextField
            size="small"
            label="Remark"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            multiline
            minRows={2}
            inputProps={{ maxLength: 500 }}
          />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={createMutation.isPending}>
          Cancel
        </Button>
        <Button variant="contained" onClick={submit} disabled={!branch || createMutation.isPending}>
          {createMutation.isPending ? "Creating..." : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
