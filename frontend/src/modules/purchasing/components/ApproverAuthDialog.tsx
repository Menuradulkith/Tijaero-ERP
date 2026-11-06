import React, { useRef, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  Box,
} from "@mui/material";

import CancelIcon from "@mui/icons-material/Cancel";
interface ApproverAuthDialogProps {
  open: boolean;
  title?: string;
  onClose: () => void;
  onSubmit: (username: string, password: string) => void;
  loading?: boolean;
}

export default function ApproverAuthDialog({
  open,
  title = "Approver Login required",
  onClose,
  onSubmit,
  loading = false,
}: ApproverAuthDialogProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // Blocks a second submit before the parent's `loading` flag arrives.
  const submittedRef = useRef(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submittedRef.current || loading) return;
    if (!username.trim() || !password.trim()) return;
    submittedRef.current = true;
    window.setTimeout(() => {
      submittedRef.current = false;
    }, 1500);
    onSubmit(username, password);
  };

  React.useEffect(() => {
    if (open) {
      setUsername("");
      setPassword("");
      submittedRef.current = false;
    }
  }, [open]);

  React.useEffect(() => {
    if (!loading) submittedRef.current = false;
  }, [loading]);

  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} maxWidth="sm" fullWidth>
      {/* The approver must type their own credentials: the browser's saved login must never fill these. */}
      <form onSubmit={handleSubmit} autoComplete="off">
        <DialogTitle>{title}</DialogTitle>
        <DialogContent>
          <Box sx={{ mb: 2, mt: 1 }}>
            <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
              Please enter your credentials to confirm this approval. The action will be recorded under your name.
            </Typography>
            <TextField
              autoFocus
              margin="dense"
              label="Approver Username"
              type="text"
              name="approver-id"
              autoComplete="off"
              inputProps={{ autoComplete: "off", "data-lpignore": "true", "data-1p-ignore": "true" }}
              fullWidth
              variant="outlined"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              required
              sx={{ mb: 2 }}
            />
            <TextField
              margin="dense"
              label="Password (or Passcode)"
              type="password"
              name="approver-secret"
              autoComplete="new-password"
              inputProps={{ autoComplete: "new-password", "data-lpignore": "true", "data-1p-ignore": "true" }}
              fullWidth
              variant="outlined"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              required
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button variant="contained" color="error" startIcon={<CancelIcon />} onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            color="primary"
            disabled={loading || !username.trim() || !password.trim()}
          >
            {loading ? "Verifying..." : "Approve"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
