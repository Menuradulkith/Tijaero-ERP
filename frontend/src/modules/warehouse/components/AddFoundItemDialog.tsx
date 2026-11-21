/**
 * "Add found item" dialog on a stock count sheet: an item that is on the shelf
 * but not on the sheet (no system stock line). Batch items take a batch / expiry,
 * serial items take a barcode with quantity fixed at 1.
 */
import { handleApiError } from "@/components/tijaero";
import type { LocationRef } from "@/hooks/useReferenceData";
import { materialsApi } from "@/modules/materials/api";
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
import { stockCountApi, type StockCount, type StockCountFoundLineCreate } from "../stockCountApi";

interface Props {
  open: boolean;
  onClose: () => void;
  count: StockCount;
  /** Locations of the count's branch. */
  locations: LocationRef[];
  canViewCost: boolean;
  currencySymbol: string;
  onAdded: (count: StockCount) => void;
}

export default function AddFoundItemDialog({ open, onClose, count, locations, canViewCost, currencySymbol, onAdded }: Props) {
  const { data: items = [], isLoading: isLoadingItems } = useQuery({
    queryKey: ["materials", "picker", "active"],
    queryFn: () => materialsApi.getAll(0, 100000, true),
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });

  // A count scoped to one location only takes found items in that location.
  const locationOptions = count.location_id ? locations.filter((l) => l.id === count.location_id) : locations;

  const [materialId, setMaterialId] = useState<number | null>(null);
  const [locationId, setLocationId] = useState<number | null>(null);
  const [qty, setQty] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [expiry, setExpiry] = useState("");
  const [barcode, setBarcode] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setMaterialId(null);
    setLocationId(count.location_id ?? null);
    setQty("");
    setBatchNo("");
    setExpiry("");
    setBarcode("");
    setUnitCost("");
    setError("");
  }, [open, count.location_id]);

  const item = items.find((m) => m.id === materialId) || null;
  const tracking = item?.tracking_type || "none";
  const isSerial = tracking === "serial";
  const isBatch = tracking === "batch";

  const qtyNum = isSerial ? 1 : Number(qty);
  const qtyValid = isSerial || (qty.trim() !== "" && Number.isFinite(qtyNum) && qtyNum > 0);
  const costNum = unitCost.trim() === "" ? null : Number(unitCost);
  const costValid = costNum === null || (Number.isFinite(costNum) && costNum >= 0);
  const canSubmit =
    !!materialId && !!locationId && qtyValid && costValid && (!isSerial || barcode.trim() !== "") && (!isBatch || batchNo.trim() !== "");

  const addMutation = useMutation({
    mutationFn: () => {
      const payload: StockCountFoundLineCreate = {
        material_id: materialId!,
        location_id: locationId!,
        counted_quantity: qtyNum,
        batch_no: isBatch ? batchNo.trim() : null,
        expiry_date: isBatch && expiry ? expiry : null,
        barcode: isSerial ? barcode.trim() : null,
        unit_cost: canViewCost ? costNum : null,
      };
      return stockCountApi.addFoundLine(count.id, payload);
    },
    onSuccess: (updated) => onAdded(updated),
    onError: (e) => setError(handleApiError(e, "Could not add the found item")),
  });

  const submit = () => {
    if (!canSubmit || addMutation.isPending) return;
    setError("");
    addMutation.mutate();
  };

  return (
    <Dialog open={open} onClose={addMutation.isPending ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Found Item</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            An item you found on the shelf that is not on the count sheet.
          </Typography>
          <Autocomplete
            size="small"
            options={items}
            getOptionLabel={(o) => [o.item_code, o.name].filter(Boolean).join(" — ")}
            isOptionEqualToValue={(o, v) => o.id === v.id}
            value={item}
            onChange={(_, v) => {
              setMaterialId(v ? v.id : null);
              setBatchNo("");
              setExpiry("");
              setBarcode("");
            }}
            renderInput={(params) => <TextField {...params} label="Item" required />}
            noOptionsText={isLoadingItems ? "Loading..." : "No items found"}
          />
          <Autocomplete
            size="small"
            options={locationOptions}
            getOptionLabel={(o) => o.name || ""}
            value={locationOptions.find((l) => l.id === locationId) || null}
            onChange={(_, v) => setLocationId(v ? v.id : null)}
            disabled={!!count.location_id}
            renderInput={(params) => <TextField {...params} label="Location" required />}
            noOptionsText="No locations in this branch"
          />
          {isSerial ? (
            <>
              <TextField
                size="small"
                label="Barcode / Serial"
                required
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                inputProps={{ maxLength: 100 }}
              />
              <TextField size="small" label="Counted Qty" value="1" disabled helperText="Serial items are counted one by one" />
            </>
          ) : (
            <TextField
              size="small"
              label={`Counted Qty${item?.unit_of_measure ? ` (${item.unit_of_measure})` : ""}`}
              required
              type="number"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              error={qty !== "" && !qtyValid}
              helperText={qty !== "" && !qtyValid ? "Enter a quantity above 0" : undefined}
              inputProps={{ min: 0, step: "any" }}
            />
          )}
          {isBatch && (
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                size="small"
                label="Batch No"
                required
                fullWidth
                value={batchNo}
                onChange={(e) => setBatchNo(e.target.value)}
                inputProps={{ maxLength: 100 }}
              />
              <TextField
                size="small"
                label="Expiry"
                type="date"
                fullWidth
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Stack>
          )}
          {canViewCost && (
            <TextField
              size="small"
              label={`Unit Cost (${currencySymbol})`}
              type="number"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              error={!costValid}
              helperText={!costValid ? "Enter a cost of 0 or more" : "Optional. Leave blank to use the item's current cost."}
              inputProps={{ min: 0, step: "any" }}
            />
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={addMutation.isPending}>
          Cancel
        </Button>
        <Button variant="contained" onClick={submit} disabled={!canSubmit || addMutation.isPending}>
          {addMutation.isPending ? "Adding..." : "Add"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
