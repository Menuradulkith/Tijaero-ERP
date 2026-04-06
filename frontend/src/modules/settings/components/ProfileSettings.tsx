import { showErrorToast, showSuccessToast } from "@/components/tijaero";
import { useAuthStore } from "@/state/authStore";
import {
    Avatar,
    Box,
    Button,
    Divider,
    Grid,
    MenuItem,
    TextField,
    Typography,
} from "@mui/material";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { settingsApi } from "../api";

interface ProfileFormData {
  first_name: string;
  middle_name: string;
  last_name: string;
  gender: string;
  date_joined: string;
  birthdate: string;
}

export default function ProfileSettings() {
  const { user, updateUser } = useAuthStore();
  const [loading, setLoading] = useState(false);

  const { control, handleSubmit } = useForm<ProfileFormData>({
    defaultValues: {
      first_name: user?.first_name || "",
      middle_name: user?.middle_name || "",
      last_name: user?.last_name || "",
      gender: user?.gender || "",
      date_joined: user?.date_joined || "",
      birthdate: user?.birthdate || "",
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

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", mb: 4 }}>
        <Avatar sx={{ width: 80, height: 80, mr: 2, bgcolor: "primary.main" }}>
          {user?.first_name?.[0] || user?.username?.[0] || "U"}
        </Avatar>
        <Box>
          <Typography variant="h6">Profile Picture</Typography>
          <Button size="small" sx={{ mt: 1 }}>
            Change Photo
          </Button>
        </Box>
      </Box>

      <form onSubmit={handleSubmit(onSubmit)}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Editable Details
        </Typography>
        <Grid container spacing={3}>
          <Grid item xs={12} sm={4}>
            <Controller
              name="first_name"
              control={control}
              render={({ field }) => (
                <TextField {...field} label="First Name" fullWidth />
              )}
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <Controller
              name="middle_name"
              control={control}
              render={({ field }) => (
                <TextField {...field} label="Middle Name" fullWidth />
              )}
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <Controller
              name="last_name"
              control={control}
              render={({ field }) => (
                <TextField {...field} label="Last Name" fullWidth />
              )}
            />
          </Grid>

          <Grid item xs={12} sm={4}>
            <Controller
              name="gender"
              control={control}
              render={({ field }) => (
                <TextField {...field} select label="Gender" fullWidth>
                  <MenuItem value="m">Male (m)</MenuItem>
                  <MenuItem value="f">Female (f)</MenuItem>
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
                  InputLabelProps={{ shrink: true }}
                />
              )}
            />
          </Grid>

          <Grid item xs={12}>
            <Button type="submit" variant="contained" disabled={loading}>
              Save Changes
            </Button>
          </Grid>
        </Grid>

        <Divider sx={{ my: 4 }} />

        <Typography variant="h6" sx={{ mb: 2 }}>
          Read-Only Details
        </Typography>
        <Grid container spacing={3}>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Username"
              value={user?.username || ""}
              fullWidth
              disabled
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Email"
              value={user?.email || ""}
              fullWidth
              disabled
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Employee ID"
              value={user?.employee_id || ""}
              fullWidth
              disabled
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Occupation"
              value={user?.occupation || ""}
              fullWidth
              disabled
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField
              label="Verified"
              value={user?.verify ? "Yes" : "No"}
              fullWidth
              disabled
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Blocked"
              value={user?.blocked ? "Yes" : "No"}
              fullWidth
              disabled
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField
              label="Created At"
              value={user?.created_at || ""}
              fullWidth
              disabled
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Updated At"
              value={user?.updated_at || ""}
              fullWidth
              disabled
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Last Login"
              value={user?.last_login || "Never"}
              fullWidth
              disabled
            />
          </Grid>
        </Grid>
      </form>
    </Box>
  );
}
