import { handleApiError, showErrorToast, showSuccessToast } from "@/components/tijaero";
import { useAuthStore } from "@/state/authStore";
import {
    Alert,
    Avatar,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    Divider,
    Grid,
    MenuItem,
    Stack,
    TextField,
    Typography,
} from "@mui/material";
import {
  AccountCircle as AccountCircleIcon,
  Badge as BadgeIcon,
  Lock as LockIcon,
  Save as SaveIcon,
  Shield as ShieldIcon,
} from "@mui/icons-material";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { settingsApi } from "../api";
import { PasscodeSettingsSection } from "@/auth/components/PasscodeSettingsSection";


interface ProfileFormData {
  first_name: string;
  middle_name: string;
  last_name: string;
  gender: string;
  date_joined: string;
  birthdate: string;
}

export default function ProfileSettings() {
  const { user, updateUser, logout } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    current_password: "",
    new_password: "",
    confirm_password: "",
  });

  const { control, handleSubmit } = useForm<ProfileFormData>({
    defaultValues: {
      first_name: user?.first_name || "",
      middle_name: user?.middle_name || "",
      last_name: user?.last_name || "",
      gender: user?.gender || "",
      date_joined: user?.date_joined?.split("T")[0] || "",
      birthdate: user?.birthdate?.split("T")[0] || "",
    },
  });

  const onSubmit = async (data: ProfileFormData) => {
    try {
      setLoading(true);
      await settingsApi.updateProfile({
        first_name: data.first_name,
        middle_name: data.middle_name,
        last_name: data.last_name,
        gender: data.gender,
        date_joined: data.date_joined,
        birthdate: data.birthdate,
      });

      // Update local storage state
      if (user) {
        updateUser({
          ...user,
          ...data,
        });
      }
      showSuccessToast("Profile updated successfully");
    } catch (error) {
      showErrorToast("Failed to update profile");
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (!passwordForm.current_password || !passwordForm.new_password || !passwordForm.confirm_password) {
      showErrorToast("Please fill all password fields");
      return;
    }
    if (passwordForm.new_password.length < 8) {
      showErrorToast("New password must be at least 8 characters long");
      return;
    }
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      showErrorToast("New password and confirm password do not match");
      return;
    }

    try {
      setPasswordLoading(true);
      await settingsApi.changePassword(passwordForm);
      setPasswordForm({ current_password: "", new_password: "", confirm_password: "" });
      showSuccessToast("Password changed successfully. Please log in again.");
      logout();
      window.location.href = "/login";
    } catch (error: unknown) {
      showErrorToast(handleApiError(error, "Failed to change password"));
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <Box>
      <Card variant="outlined" sx={{ borderRadius: 2, mb: 2.5 }}>
        <CardContent>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ xs: "flex-start", sm: "center" }}>
            <Avatar sx={{ width: 72, height: 72, bgcolor: "primary.main", fontSize: 30, fontWeight: 700 }}>
              {user?.first_name?.[0] || user?.username?.[0] || "U"}
            </Avatar>
            <Box sx={{ flex: 1 }}>
              <Typography variant="h6" fontWeight={700}>
                {user?.first_name} {user?.last_name}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {user?.email || "No email available"}
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Chip size="small" icon={<BadgeIcon />} label={user?.employee_id || "No Employee ID"} />
                <Chip size="small" color={user?.blocked ? "error" : "success"} label={user?.blocked ? "Blocked" : "Active"} />
              </Stack>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <form onSubmit={handleSubmit(onSubmit)}>
        <Grid container spacing={2.5}>
          <Grid item xs={12} md={8}>
            <Card variant="outlined" sx={{ borderRadius: 2, mb: 2.5 }}>
              <CardContent>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                  <AccountCircleIcon color="primary" />
                  <Typography variant="subtitle1" fontWeight={700}>
                    Profile Information
                  </Typography>
                </Stack>

                <Grid container spacing={2}>
                  <Grid item xs={12} sm={4}>
                    <Controller
                      name="first_name"
                      control={control}
                      render={({ field }) => (
                        <TextField {...field} label="First Name" fullWidth size="small" />
                      )}
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <Controller
                      name="middle_name"
                      control={control}
                      render={({ field }) => (
                        <TextField {...field} label="Middle Name" fullWidth size="small" />
                      )}
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <Controller
                      name="last_name"
                      control={control}
                      render={({ field }) => (
                        <TextField {...field} label="Last Name" fullWidth size="small" />
                      )}
                    />
                  </Grid>

                  <Grid item xs={12} sm={4}>
                    <Controller
                      name="gender"
                      control={control}
                      render={({ field }) => (
                        <TextField {...field} select label="Gender" fullWidth size="small">
                          <MenuItem value="m">Male</MenuItem>
                          <MenuItem value="f">Female</MenuItem>
                          <MenuItem value="other">Other</MenuItem>
                        </TextField>
                      )}
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <Controller
                      name="date_joined"
                      control={control}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          label="Date Joined"
                          type="date"
                          fullWidth
                          size="small"
                          InputLabelProps={{ shrink: true }}
                        />
                      )}
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <Controller
                      name="birthdate"
                      control={control}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          label="Birthdate"
                          type="date"
                          fullWidth
                          size="small"
                          InputLabelProps={{ shrink: true }}
                        />
                      )}
                    />
                  </Grid>

                  <Grid item xs={12}>
                    <Button type="submit" variant="contained" startIcon={<SaveIcon />} disabled={loading}>
                      Save Profile Changes
                    </Button>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>

            <Card variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                  <LockIcon color="primary" />
                  <Typography variant="subtitle1" fontWeight={700}>
                    Security
                  </Typography>
                </Stack>

                <Alert severity="info" sx={{ mb: 2 }}>
                  Use a strong password with at least 8 characters.
                </Alert>

                <Grid container spacing={2}>
                  <Grid item xs={12} sm={4}>
                    <TextField
                      label="Current Password"
                      type="password"
                      value={passwordForm.current_password}
                      onChange={(e) =>
                        setPasswordForm((prev) => ({ ...prev, current_password: e.target.value }))
                      }
                      fullWidth
                      size="small"
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField
                      label="New Password"
                      type="password"
                      value={passwordForm.new_password}
                      onChange={(e) =>
                        setPasswordForm((prev) => ({ ...prev, new_password: e.target.value }))
                      }
                      helperText="Minimum 8 characters"
                      fullWidth
                      size="small"
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField
                      label="Confirm New Password"
                      type="password"
                      value={passwordForm.confirm_password}
                      onChange={(e) =>
                        setPasswordForm((prev) => ({ ...prev, confirm_password: e.target.value }))
                      }
                      fullWidth
                      size="small"
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <Button
                      variant="contained"
                      onClick={handleChangePassword}
                      startIcon={<ShieldIcon />}
                      disabled={passwordLoading}
                    >
                      Update Password
                    </Button>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>

            <Box sx={{ mt: 2.5 }}>
              <PasscodeSettingsSection />
            </Box>
          </Grid>

          <Grid item xs={12} md={4}>
            <Card variant="outlined" sx={{ borderRadius: 2, height: "100%" }}>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                  Account Details
                </Typography>
                <Divider sx={{ mb: 2 }} />

                <Stack spacing={1.5}>
                  <TextField label="Username" value={user?.username || ""} fullWidth disabled size="small" />
                  <TextField label="Email" value={user?.email || ""} fullWidth disabled size="small" />
                  <TextField label="Employee ID" value={user?.employee_id || ""} fullWidth disabled size="small" />
                  <TextField label="Occupation" value={user?.occupation || ""} fullWidth disabled size="small" />
                  <TextField label="Created At" value={user?.created_at || ""} fullWidth disabled size="small" />
                  <TextField label="Updated At" value={user?.updated_at || ""} fullWidth disabled size="small" />
                  <TextField label="Last Login" value={user?.last_login || "Never"} fullWidth disabled size="small" />
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </form>
    </Box>
  );
}
