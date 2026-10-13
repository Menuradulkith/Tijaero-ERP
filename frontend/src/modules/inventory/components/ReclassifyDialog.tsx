import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";

export interface ReclassifyLocationOption {
  id: number;
  name: string;
}

interface ReclassifyDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  /** Show a target-location picker (used when returning an asset to stock). */
  locations?: ReclassifyLocationOption[];
  isSubmitting: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (reason: string, locationId?: number) => void;
}

/** Reason (required) [+ optional location] prompt for moving a serial unit between sales stock and company assets. */
export default function ReclassifyDialog({
  open,
  title,
  description,
  confirmLabel,
  locations,
  isSubmitting,
  error,
  onClose,
  onSubmit,
}: ReclassifyDialogProps) {
  const [reason, setReason] = useState("");
  const [locationId, setLocationId] = useState<number | "">("");

  useEffect(() => {
    if (open) {
      setReason("");
      setLocationId("");
    }
  }, [open]);

  const reasonValid = reason.trim().length >= 3;

  return (
    <Dialog open={open} onClose={isSubmitting ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
        <Typography variant="body2" color="text.secondary">
          {description}
        </Typography>
        <TextField
          label="Reason"
          required
          autoFocus
          multiline
          minRows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          inputProps={{ maxLength: 500 }}
          helperText="Recorded in the audit history"
        />
        {locations && (
          <TextField
            select
            label="Location (optional)"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value === "" ? "" : Number(e.target.value))}
          >
            <MenuItem value="">Keep previous location</MenuItem>
            {locations.map((l) => (
              <MenuItem key={l.id} value={l.id}>
                {l.name}
              </MenuItem>
            ))}
          </TextField>
        )}
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={!reasonValid || isSubmitting}
          onClick={() => onSubmit(reason.trim(), locationId === "" ? undefined : locationId)}
          startIcon={isSubmitting ? <CircularProgress size={16} /> : undefined}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
