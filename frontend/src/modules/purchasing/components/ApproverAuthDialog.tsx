import React, { useState } from "react";
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    onSubmit(username, password);
  };

  // Reset fields when opened
  React.useEffect(() => {
    if (open) {
      setUsername("");
      setPassword("");
    }
  }, [open]);

  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit}>
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
          <Button onClick={onClose} disabled={loading} color="inherit">
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
