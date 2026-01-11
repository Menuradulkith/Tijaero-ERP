import { useAuthStore } from "@/state/authStore";
import { formatErrorMessage } from "@/utils/errorHandling";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import LockIcon from "@mui/icons-material/Lock";
import PersonIcon from "@mui/icons-material/Person";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import {
    Box,
    Button,
    Card,
    IconButton,
    InputAdornment,
    TextField,
    Typography,
} from "@mui/material";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { authApi } from "../api";

export default function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const loginMutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: async (data) => {
      // First, store the token temporarily so the next request can use it
      login(data.access_token, null as any);

      // Then get the user data
      try {
        const user = await authApi.getCurrentUser();
        login(data.access_token, user);
        toast.success("Login successful");
        navigate("/dashboard");
      } catch (error: any) {
        toast.error("Failed to fetch user data");
      }
    },
    onError: (error: any) => {
      toast.error(formatErrorMessage(error) || "Login failed");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (username.trim() === "" || password.trim() === "") {
      toast.error("Username and password are required");
      return;
    }

    loginMutation.mutate({ username, password });
  };

  return (
    <Box
      sx={{
        display: "flex",
        minHeight: "100vh",
        bgcolor: "background.default",
      }}
    >
      {/* Left Side - Branding */}
      <Box
        sx={{
          flex: 1,
          display: { xs: "none", md: "flex" },
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          bgcolor: "primary.main",
          color: "white",
          p: 4,
        }}
      >
        <AccountBalanceIcon sx={{ fontSize: 80, mb: 3 }} />
        <Typography variant="h3" gutterBottom fontWeight={600}>
          TijaeroERP
        </Typography>
        <Typography
          variant="h6"
          align="center"
          sx={{ maxWidth: 400, opacity: 0.9 }}
        >
          Streamline your business operations with our comprehensive enterprise
          resource planning solution
        </Typography>
        <Box sx={{ mt: 6, display: "flex", gap: 4 }}>
          <Box sx={{ textAlign: "center" }}>
            <Typography variant="h4" fontWeight={600}>
              1000+
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.8 }}>
              Active Users
            </Typography>
          </Box>
          <Box sx={{ textAlign: "center" }}>
            <Typography variant="h4" fontWeight={600}>
              50+
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.8 }}>
              Companies
            </Typography>
          </Box>
          <Box sx={{ textAlign: "center" }}>
            <Typography variant="h4" fontWeight={600}>
              99.9%
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.8 }}>
              Uptime
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Right Side - Login Form */}
      <Box
        sx={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          p: 4,
        }}
      >
        <Card sx={{ p: 4, maxWidth: 450, width: "100%", boxShadow: 3 }}>
          <Box sx={{ textAlign: "center", mb: 4 }}>
            <Box
              sx={{
                display: { xs: "flex", md: "none" },
                justifyContent: "center",
                mb: 2,
              }}
            >
              <AccountBalanceIcon
                sx={{ fontSize: 48, color: "primary.main" }}
              />
            </Box>
            <Typography
              variant="h4"
              component="h1"
              gutterBottom
              fontWeight={600}
            >
              Welcome Back
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Sign in to access your ERP dashboard
            </Typography>
          </Box>

          <form onSubmit={handleSubmit}>
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
                    <IconButton
                      onClick={() => setShowPassword(!showPassword)}
                      edge="end"
                    >
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
              sx={{ mt: 3, py: 1.5 }}
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? "Signing in..." : "Sign In"}
            </Button>
          </form>

          <Box sx={{ mt: 3, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              Demo credentials: admin / admin
            </Typography>
          </Box>
        </Card>
      </Box>
    </Box>
  );
}
