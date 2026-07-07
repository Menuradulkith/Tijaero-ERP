import {
  handleApiError,
  showErrorToast,
  showSuccessToast,
} from "@/components/tijaero";
import { useAuthStore } from "@/state/authStore";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import LockIcon from "@mui/icons-material/Lock";
import PersonIcon from "@mui/icons-material/Person";
import PinIcon from "@mui/icons-material/Pin";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  IconButton,
  InputAdornment,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { authApi, passcodeApi, type PasscodeErrorDetail } from "../api";

// ─── PIN input — 6 individual cells ──────────────────────────────────────────

interface PinInputProps {
  value: string;
  onChange: (v: string) => void;
  shake?: boolean;
  disabled?: boolean;
}

function PinInput({ value, onChange, shake = false, disabled = false }: PinInputProps) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>(Array(6).fill(null));

  const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (value[idx]) {
        // Clear current cell
        const arr = value.split("");
        arr[idx] = "";
        onChange(arr.join(""));
      } else if (idx > 0) {
        // Move back and clear previous
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
      const focusIdx = Math.min(pasted.length, 5);
      inputRefs.current[focusIdx]?.focus();
    }
    e.preventDefault();
  };

  return (
    <Box
      sx={{
        display: "flex",
        gap: 1,
        justifyContent: "center",
        my: 2,
        animation: shake ? "pinShake 0.4s ease" : "none",
        "@keyframes pinShake": {
          "0%,100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-6px)" },
          "40%": { transform: "translateX(6px)" },
          "60%": { transform: "translateX(-4px)" },
          "80%": { transform: "translateX(4px)" },
        },
      }}
    >
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
            width: 48,
            height: 56,
            textAlign: "center",
            fontSize: "1.5rem",
            fontWeight: 600,
            fontFamily: "monospace",
            letterSpacing: "0.1em",
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
  );
}

// ─── Main Login Page ──────────────────────────────────────────────────────────

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuthStore((state) => state.login);
  const clearAuth = useAuthStore((state) => state.clearAuth);

  const searchParams = new URLSearchParams(location.search);
  const redirectParam = searchParams.get("redirect");

  const from = location.state?.from?.pathname
    ? `${location.state.from.pathname}${location.state.from.search || ""}`
    : redirectParam || "/dashboard";

  // ── Tab state ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<0 | 1>(0);

  // ── Password login state ───────────────────────────────────────────────────
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // ── Passcode login state ───────────────────────────────────────────────────
  const [pcUsername, setPcUsername] = useState("");
  const [pin, setPin] = useState("");
  const [pinShake, setPinShake] = useState(false);
  const [passcodeError, setPasscodeError] = useState<PasscodeErrorDetail | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);

  // ── Passcode-expired notification after password login ────────────────────
  const [showExpiredBanner, setShowExpiredBanner] = useState(false);
  const [showLockedBanner, setShowLockedBanner] = useState(false);

  // Auto-focus first PIN cell when switching to Passcode tab
  useEffect(() => {
    if (activeTab === 1) setPin("");
  }, [activeTab]);

  // ─── Password login mutation ───────────────────────────────────────────────
  const loginMutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: async (data) => {
      login(data.access_token, null as any);
      try {
        const user = await authApi.getCurrentUser();
        login(data.access_token, user);
        showSuccessToast("Login successful");
        if ((data as any).passcode_locked_out) {
          setTimeout(() => setShowLockedBanner(true), 600);
        } else if ((data as any).passcode_expired) {
          // Delay so the page has time to mount the dashboard notification
          setTimeout(() => setShowExpiredBanner(true), 600);
        }
        navigate(from, { replace: true });
      } catch (error: unknown) {
        clearAuth();
        showErrorToast(handleApiError(error, "Failed to fetch user data"));
      }
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Login failed"));
    },
  });

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      showErrorToast("Username and password are required");
      return;
    }
    loginMutation.mutate({ username, password });
  };

  // ─── Passcode login mutation ───────────────────────────────────────────────
  const passcodeMutation = useMutation({
    mutationFn: passcodeApi.login,
    onSuccess: async (data) => {
      setPasscodeError(null);
      login(data.access_token, null as any);
      try {
        const user = await authApi.getCurrentUser();
        login(data.access_token, user);
        showSuccessToast("Login successful");
        navigate(from, { replace: true });
      } catch (error: unknown) {
        clearAuth();
        showErrorToast(handleApiError(error, "Failed to fetch user data"));
      }
    },
    onError: (error: unknown) => {
      // Parse structured error from backend
      let detail: PasscodeErrorDetail | null = null;
      try {
        const axiosErr = error as any;
        const raw = axiosErr?.response?.data?.detail;
        if (typeof raw === "object" && raw?.code) {
          detail = raw as PasscodeErrorDetail;
        }
      } catch { /* ignore */ }

      if (!detail) {
        detail = { code: "PASSCODE_INVALID", message: handleApiError(error, "Login failed") };
      }

      setPasscodeError(detail);
      setAttemptsRemaining(detail.attempts_remaining ?? null);

      if (detail.code === "PASSCODE_EXPIRED" || detail.code === "PASSCODE_LOCKED") {
        // Auto-switch to Password tab with explanation banner
        setTimeout(() => setActiveTab(0), 200);
      } else {
        // Shake the PIN cells
        setPin("");
        setPinShake(true);
        setTimeout(() => setPinShake(false), 500);
      }
    },
  });

  const handlePasscodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pcUsername.trim()) {
      showErrorToast("Username is required");
      return;
    }
    if (pin.length !== 6) {
      showErrorToast("Please enter all 6 digits");
      return;
    }
    passcodeMutation.mutate({ username: pcUsername, passcode: pin });
  };

  // Auto-submit when all 6 digits are entered
  useEffect(() => {
    if (pin.length === 6 && pcUsername.trim() && !passcodeMutation.isPending) {
      passcodeMutation.mutate({ username: pcUsername, passcode: pin });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  // ─── Banner to show on Password tab after a redirect from Passcode tab ────
  const redirectedErrorBanner = passcodeError &&
    (passcodeError.code === "PASSCODE_EXPIRED" || passcodeError.code === "PASSCODE_LOCKED") &&
    activeTab === 0;

  return (
    <Box sx={{ display: "flex", minHeight: "100dvh", bgcolor: "background.default" }}>
      {/* Left Side — Branding */}
      <Box
        sx={{
          flex: 1,
          display: { xs: "none", md: "flex" },
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: (t) =>
            `linear-gradient(145deg, ${t.palette.primary.dark} 0%, ${t.palette.primary.main} 60%, ${t.palette.primary.light} 100%)`,
          color: "white",
          p: 4,
        }}
      >
        <AccountBalanceIcon sx={{ fontSize: 88, mb: 3, opacity: 0.95 }} />
        <Typography variant="h3" gutterBottom fontWeight={700} letterSpacing="-0.5px">
          TijaeroERP
        </Typography>
        <Typography variant="h6" align="center" sx={{ maxWidth: 380, opacity: 0.85, lineHeight: 1.5 }}>
          Streamline your business operations with our comprehensive enterprise resource planning solution.
        </Typography>
      </Box>

      {/* Right Side — Login Form */}
      <Box
        sx={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          p: 4,
        }}
      >
        <Card sx={{ p: 4, maxWidth: 460, width: "100%", boxShadow: 4 }}>
          {/* Logo on mobile */}
          <Box sx={{ display: { xs: "flex", md: "none" }, justifyContent: "center", mb: 2 }}>
            <AccountBalanceIcon sx={{ fontSize: 48, color: "primary.main" }} />
          </Box>

          <Typography variant="h4" component="h1" fontWeight={700} gutterBottom align="center">
            Welcome Back
          </Typography>
          <Typography variant="body2" color="text.secondary" align="center" sx={{ mb: 3 }}>
            Sign in to access your ERP dashboard
          </Typography>

          {/* Passcode-expired banner (shown when redirected from passcode tab) */}
          {redirectedErrorBanner && (
            <Alert
              severity={passcodeError!.code === "PASSCODE_EXPIRED" ? "warning" : "error"}
              icon={<WarningAmberIcon />}
              sx={{ mb: 2, fontSize: "0.85rem" }}
              onClose={() => setPasscodeError(null)}
            >
              {passcodeError!.message}
            </Alert>
          )}

          {/* Passcode-expired nudge after successful password login */}
          {showExpiredBanner && (
            <Alert
              severity="info"
              sx={{ mb: 2, fontSize: "0.85rem" }}
              onClose={() => setShowExpiredBanner(false)}
            >
              Your passcode has expired. Visit <strong>Profile → Security</strong> to set a new one.
            </Alert>
          )}

          {/* Passcode-locked nudge after successful password login */}
          {showLockedBanner && (
            <Alert
              severity="error"
              icon={<LockIcon />}
              sx={{ mb: 2, fontSize: "0.85rem" }}
              onClose={() => setShowLockedBanner(false)}
            >
              Your passcode was locked due to too many failed attempts. Create a new one in <strong>Profile → Security</strong>.
            </Alert>
          )}

          {/* Tab switcher */}
          <Tabs
            value={activeTab}
            onChange={(_, v) => { setActiveTab(v); setPasscodeError(null); }}
            variant="fullWidth"
            sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
          >
            <Tab
              label="Password"
              icon={<LockIcon fontSize="small" />}
              iconPosition="start"
              id="login-tab-password"
              aria-controls="login-panel-password"
            />
            <Tab
              label="Passcode"
              icon={<PinIcon fontSize="small" />}
              iconPosition="start"
              id="login-tab-passcode"
              aria-controls="login-panel-passcode"
            />
          </Tabs>

          {/* ── Password Tab ── */}
          <Box
            role="tabpanel"
            id="login-panel-password"
            aria-labelledby="login-tab-password"
            hidden={activeTab !== 0}
          >
            {activeTab === 0 && (
              <form onSubmit={handlePasswordSubmit}>
                <TextField
                  fullWidth
                  label="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  margin="normal"
                  autoFocus
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <PersonIcon color="action" />
                      </InputAdornment>
                    ),
                  }}
                />
                <TextField
                  fullWidth
                  label="Password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  margin="normal"
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <LockIcon color="action" />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton onClick={() => setShowPassword(!showPassword)} edge="end">
                          {showPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
                <Button
                  fullWidth
                  type="submit"
                  variant="contained"
                  size="large"
                  sx={{ mt: 3, py: 1.5, borderRadius: 2 }}
                  disabled={loginMutation.isPending}
                >
                  {loginMutation.isPending ? "Signing in…" : "Sign In"}
                </Button>
              </form>
            )}
          </Box>

          {/* ── Passcode Tab ── */}
          <Box
            role="tabpanel"
            id="login-panel-passcode"
            aria-labelledby="login-tab-passcode"
            hidden={activeTab !== 1}
          >
            {activeTab === 1 && (
              <form onSubmit={handlePasscodeSubmit}>
                <TextField
                  fullWidth
                  label="Username"
                  value={pcUsername}
                  onChange={(e) => { setPcUsername(e.target.value); setPasscodeError(null); }}
                  margin="normal"
                  autoFocus
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <PersonIcon color="action" />
                      </InputAdornment>
                    ),
                  }}
                />

                <Typography
                  variant="body2"
                  color="text.secondary"
                  align="center"
                  sx={{ mt: 1, mb: 0 }}
                >
                  Enter your 6-digit passcode
                </Typography>

                <PinInput
                  value={pin}
                  onChange={(v) => { setPin(v); setPasscodeError(null); }}
                  shake={pinShake}
                  disabled={passcodeMutation.isPending}
                />

                {/* Attempt counter */}
                {passcodeError?.code === "PASSCODE_INVALID" && attemptsRemaining !== null && (
                  <Box sx={{ textAlign: "center", mb: 1 }}>
                    <Chip
                      size="small"
                      color={attemptsRemaining === 1 ? "error" : "warning"}
                      label={`${attemptsRemaining} attempt${attemptsRemaining !== 1 ? "s" : ""} remaining`}
                    />
                  </Box>
                )}

                {/* Generic passcode error */}
                {passcodeError?.code === "PASSCODE_INVALID" && !attemptsRemaining && (
                  <Typography variant="caption" color="error" display="block" align="center" sx={{ mb: 1 }}>
                    {passcodeError.message}
                  </Typography>
                )}

                <Button
                  fullWidth
                  type="submit"
                  variant="contained"
                  size="large"
                  sx={{ mt: 1, py: 1.5, borderRadius: 2 }}
                  disabled={passcodeMutation.isPending || pin.length < 6 || !pcUsername.trim()}
                >
                  {passcodeMutation.isPending ? "Verifying…" : "Sign In with Passcode"}
                </Button>

                <Box sx={{ mt: 2, textAlign: "center" }}>
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => { setActiveTab(0); setPasscodeError(null); }}
                    sx={{ textTransform: "none", fontSize: "0.8rem" }}
                  >
                    Use password instead
                  </Button>
                </Box>
              </form>
            )}
          </Box>

          <Box sx={{ mt: 3, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              If you don't have an account, please contact your administrator to get access.
            </Typography>
          </Box>
        </Card>
      </Box>
    </Box>
  );
}
