/**
 * PasscodeSettingsSection
 *
 * Inline section rendered inside the user's Profile / Security settings page.
 * Allows authenticated users to:
 *   - View the current passcode status (set, expiry, lockout)
 *   - Set or change their 6-digit passcode (with last-5 reuse prevention)
 *   - Remove their active passcode
 */

import { handleApiError, showErrorToast, showSuccessToast } from "@/components/tijaero";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import LockPersonIcon from "@mui/icons-material/LockPerson";
import PinIcon from "@mui/icons-material/Pin";
import ShieldIcon from "@mui/icons-material/Shield";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { passcodeApi } from "../api";

// ─── 6-cell PIN input (same component pattern as LoginPage) ──────────────────

interface PinInputProps {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

function PinInput({ label, value, onChange, disabled = false, autoFocus = false }: PinInputProps) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>(Array(6).fill(null));

  useEffect(() => {
    if (autoFocus) inputRefs.current[0]?.focus();
  }, [autoFocus]);

  const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (value[idx]) {
        const arr = value.split("");
        arr[idx] = "";
        onChange(arr.join(""));
      } else if (idx > 0) {
        const arr = value.split("");
        arr[idx - 1] = "";
        onChange(arr.join(""));
        inputRefs.current[idx - 1]?.focus();
      }
      e.preventDefault();
    } else if (e.key === "ArrowLeft" && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
    } else if (e.key === "ArrowRight" && idx < 5) {
      inputRefs.current[idx + 1]?.focus();
    }
  };

  const handleChange = (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "").slice(-1);
    if (!raw) return;
    const arr = (value.padEnd(6, " ")).split("");
    arr[idx] = raw;
    const next = arr.join("").replace(/ /g, "");
    onChange(next);
    if (idx < 5) inputRefs.current[idx + 1]?.focus();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted) {
      onChange(pasted);
      inputRefs.current[Math.min(pasted.length, 5)]?.focus();
    }
    e.preventDefault();
  };

  return (
    <Box>
      {label && (
        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
          {label}
        </Typography>
      )}
      <Box sx={{ display: "flex", gap: 1 }}>
        {Array.from({ length: 6 }).map((_, idx) => (
          <Box
            key={idx}
            component="input"
            ref={(el) => { inputRefs.current[idx] = el as HTMLInputElement; }}
            type="password"
            inputMode="numeric"
            maxLength={1}
            value={value[idx] ?? ""}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange(idx, e)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => handleKeyDown(idx, e)}
            onPaste={handlePaste}
            disabled={disabled}
            onClick={() => inputRefs.current[idx]?.select()}
            sx={{
              width: 44,
              height: 52,
              textAlign: "center",
              fontSize: "1.4rem",
              fontWeight: 600,
              fontFamily: "monospace",
              border: "2px solid",
              borderColor: value[idx] ? "primary.main" : "divider",
              borderRadius: 1.5,
              bgcolor: "background.paper",
              color: "text.primary",
              outline: "none",
              cursor: disabled ? "not-allowed" : "text",
              opacity: disabled ? 0.5 : 1,
              transition: "border-color 0.15s, box-shadow 0.15s",
              "&:focus": {
                borderColor: "primary.main",
                boxShadow: (theme) => `0 0 0 3px ${theme.palette.primary.main}30`,
              },
            }}
          />
        ))}
      </Box>
    </Box>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PasscodeSettingsSection() {
  const queryClient = useQueryClient();

  // Fetch current status
  const { data: status, isLoading } = useQuery({
    queryKey: ["passcode-status"],
    queryFn: passcodeApi.getStatus,
    staleTime: 30_000,
  });

  // Form state
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Reset form when status changes
  useEffect(() => {
    setNewPin("");
    setConfirmPin("");
    setMismatch(false);
  }, [status?.has_passcode]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const setMutation = useMutation({
    mutationFn: () => passcodeApi.setPasscode(newPin, confirmPin),
    onSuccess: () => {
      showSuccessToast("Passcode set successfully!");
      setNewPin("");
      setConfirmPin("");
      queryClient.invalidateQueries({ queryKey: ["passcode-status"] });
    },
    onError: (err) => {
      showErrorToast(handleApiError(err, "Failed to set passcode"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: passcodeApi.deletePasscode,
    onSuccess: () => {
      showSuccessToast("Passcode removed.");
      setDeleteDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["passcode-status"] });
    },
    onError: (err) => {
      showErrorToast(handleApiError(err, "Failed to remove passcode"));
    },
  });

  const handleSet = () => {
    if (newPin.length !== 6 || confirmPin.length !== 6) return;
    if (newPin !== confirmPin) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    setMutation.mutate();
  };

  if (isLoading) {
    return <CircularProgress size={24} />;
  }

  return (
    <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
      {/* Header */}
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
        <PinIcon color="primary" />
        <Box>
          <Typography variant="h6" fontWeight={600}>
            6-Digit Passcode
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Quick login alternative to your password
          </Typography>
        </Box>
      </Stack>

      <Divider sx={{ mb: 2 }} />

      {/* Status chips */}
      <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2 }}>
        {status?.has_passcode ? (
          <>
            {status.locked_out ? (
              <Chip
                size="small"
                color="error"
                icon={<LockPersonIcon />}
                label="Passcode Login Stopped"
              />
            ) : (
              <Chip
                size="small"
                color={status.is_expired ? "error" : "success"}
                icon={status.is_expired ? <WarningAmberIcon /> : <ShieldIcon />}
                label={status.is_expired ? "Expired" : "Active"}
              />
            )}
            {!status.is_expired && !status.locked_out && status.days_until_expiry !== null && (
              <Chip
                size="small"
                variant="outlined"
                icon={<InfoOutlinedIcon />}
                label={
                  status.days_until_expiry === 0
                    ? "Expires today"
                    : `Expires in ${status.days_until_expiry} day${status.days_until_expiry !== 1 ? "s" : ""}`
                }
              />
            )}
          </>
        ) : (
          <Chip size="small" variant="outlined" icon={<LockOpenIcon />} label="No passcode set" />
        )}
      </Stack>

      {/* Expired warning */}
      {status?.has_passcode && status.is_expired && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Your passcode has expired. Set a new one below to re-enable quick login.
        </Alert>
      )}

      {/* Locked-out notice */}
      {status?.has_passcode && status.locked_out && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Passcode locked after 3 failed attempts. You can set a new passcode here.
        </Alert>
      )}

      {/* History notice */}
      <Alert severity="info" icon={<InfoOutlinedIcon />} sx={{ mb: 2.5, fontSize: "0.8rem" }}>
        You cannot reuse any of your last 5 passcodes. Passcode expires after the configured
        period (max 30 days).
      </Alert>

      {/* PIN entry form */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <PinInput
          label={status?.has_passcode ? "New Passcode" : "New Passcode"}
          value={newPin}
          onChange={(v) => { setNewPin(v); setMismatch(false); }}
          disabled={setMutation.isPending}
          autoFocus={false}
        />
        <PinInput
          label="Confirm Passcode"
          value={confirmPin}
          onChange={(v) => { setConfirmPin(v); setMismatch(false); }}
          disabled={setMutation.isPending}
        />

        {mismatch && (
          <Typography variant="caption" color="error">
            Passcodes do not match. Please re-enter.
          </Typography>
        )}

        <Stack direction="row" spacing={1.5} sx={{ mt: 1 }}>
          <Button
            variant="contained"
            onClick={handleSet}
            disabled={
              setMutation.isPending ||
              newPin.length !== 6 ||
              confirmPin.length !== 6
            }
            startIcon={<PinIcon />}
          >
            {setMutation.isPending
              ? "Saving…"
              : status?.has_passcode
              ? "Change Passcode"
              : "Set Passcode"}
          </Button>

          {status?.has_passcode && (
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteOutlineIcon />}
              onClick={() => setDeleteDialogOpen(true)}
              disabled={deleteMutation.isPending}
            >
              Remove
            </Button>
          )}
        </Stack>
      </Box>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Remove Passcode?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Your passcode will be removed. You'll need to login with your username and password.
            Your passcode history will be retained, so you cannot reuse your last 5 codes when you set a new one.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? "Removing…" : "Remove Passcode"}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

export default PasscodeSettingsSection;
