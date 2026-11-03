import {
  Box,
  Typography,
  FormControlLabel,
  Switch,
  Button,
  CircularProgress,
} from "@mui/material";
import { useEffect, useState } from "react";
import { handleApiError, showErrorToast, showSuccessToast } from "@/components/tijaero";
import { settingsApi } from "../api";

// Only the channels the backend actually stores (user preferences) are shown,
// so "Save" really saves.
export default function NotificationsSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [desktopNotifications, setDesktopNotifications] = useState(false);

  useEffect(() => {
    settingsApi
      .getPreferences()
      .then((p) => {
        setNotificationsEnabled(p.notifications_enabled ?? true);
        setEmailNotifications(p.email_notifications ?? true);
        setDesktopNotifications(p.desktop_notifications ?? false);
      })
      .catch((error) => showErrorToast(handleApiError(error, "Failed to load notification settings")))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      await settingsApi.updatePreferences({
        notifications_enabled: notificationsEnabled,
        email_notifications: emailNotifications,
        desktop_notifications: desktopNotifications,
      });
      showSuccessToast("Notification settings saved successfully");
    } catch (error) {
      showErrorToast(handleApiError(error, "Failed to save notification settings"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Notification Channels
      </Typography>
      <Box sx={{ mb: 3 }}>
        <FormControlLabel
          control={
            <Switch
              checked={notificationsEnabled}
              onChange={(e) => setNotificationsEnabled(e.target.checked)}
            />
          }
          label="In-app Notifications"
        />
        <Typography variant="body2" color="text.secondary" sx={{ ml: 4 }}>
          Show notifications inside the ERP
        </Typography>
      </Box>

      <Box sx={{ mb: 3 }}>
        <FormControlLabel
          control={
            <Switch
              checked={emailNotifications}
              onChange={(e) => setEmailNotifications(e.target.checked)}
            />
          }
          label="Email Notifications"
        />
        <Typography variant="body2" color="text.secondary" sx={{ ml: 4 }}>
          Receive notifications via email
        </Typography>
      </Box>

      <Box sx={{ mb: 3 }}>
        <FormControlLabel
          control={
            <Switch
              checked={desktopNotifications}
              onChange={(e) => setDesktopNotifications(e.target.checked)}
            />
          }
          label="Desktop Notifications"
        />
        <Typography variant="body2" color="text.secondary" sx={{ ml: 4 }}>
          Receive push notifications in your browser
        </Typography>
      </Box>

      <Button variant="contained" onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : "Save Settings"}
      </Button>
    </Box>
  );
}
