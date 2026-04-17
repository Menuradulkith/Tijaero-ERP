import { showErrorToast, showSuccessToast } from "@/components/tijaero";
import {
  SettingsSuggest as SettingsSuggestIcon,
  Notifications as NotificationsIcon,
  Palette as PaletteIcon,
  Save as SaveIcon,
  Tune as TuneIcon,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControlLabel,
  Grid,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { settingsApi } from "../api";
import type { UserPreferencesUpdate } from "../types";

const ITEMS_PER_PAGE_OPTIONS = [10, 25, 50, 100];

const INITIAL_PREFS: UserPreferencesUpdate = {
  theme: "light",
  language: "en",
  timezone: "UTC",
  notifications_enabled: true,
  email_notifications: true,
  desktop_notifications: false,
  items_per_page: 25,
  date_format: "YYYY-MM-DD",
  currency_format: "LKR",
};

export default function PreferencesSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState<UserPreferencesUpdate>(INITIAL_PREFS);
  const [lastUpdatedText, setLastUpdatedText] = useState<string>("Not available");

  useEffect(() => {
    const loadPreferences = async () => {
      try {
        setLoading(true);
        const data = await settingsApi.getPreferences();
        setPrefs({
          theme: data.theme,
          language: data.language,
          timezone: data.timezone,
          notifications_enabled: data.notifications_enabled,
          email_notifications: data.email_notifications,
          desktop_notifications: data.desktop_notifications,
          default_branch: data.default_branch,
          items_per_page: data.items_per_page,
          date_format: data.date_format,
          currency_format: data.currency_format,
        });
        setLastUpdatedText(new Date(data.updated_date).toLocaleString());
      } catch {
        showErrorToast("Failed to load preferences");
      } finally {
        setLoading(false);
      }
    };

    loadPreferences();
  }, []);

  const updatePref = <K extends keyof UserPreferencesUpdate>(
    key: K,
    value: UserPreferencesUpdate[K],
  ) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const updated = await settingsApi.updatePreferences(prefs);
      setLastUpdatedText(new Date(updated.updated_date).toLocaleString());
      showSuccessToast("Preferences saved successfully");
    } catch {
      showErrorToast("Failed to save preferences");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Stack
        direction={{ xs: "column", md: "row" }}
        alignItems={{ xs: "flex-start", md: "center" }}
        justifyContent="space-between"
        spacing={1.5}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h6" fontWeight={700}>
            Experience Preferences
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Personalize your ERP workspace look and behavior.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip
            size="small"
            color="default"
            icon={<SettingsSuggestIcon />}
            label={`Updated: ${lastUpdatedText}`}
          />
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={handleSave}
            disabled={saving || loading}
          >
            Save Preferences
          </Button>
        </Stack>
      </Stack>

      {loading && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Loading your preferences...
        </Alert>
      )}

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={6}>
          <Card variant="outlined" sx={{ borderRadius: 2, height: "100%" }}>
            <CardContent>
              <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 2 }}>
                <PaletteIcon color="primary" />
                <Typography variant="subtitle1" fontWeight={700}>
                  Appearance
                </Typography>
              </Stack>

              <TextField
                select
                fullWidth
                size="small"
                label="Theme"
                value={prefs.theme || "light"}
                onChange={(e) => updatePref("theme", e.target.value as "light" | "dark")}
                sx={{ mb: 2 }}
                disabled={loading}
              >
                <MenuItem value="light">Light</MenuItem>
                <MenuItem value="dark">Dark</MenuItem>
              </TextField>

              <TextField
                select
                fullWidth
                size="small"
                label="Items per page"
                value={prefs.items_per_page ?? 25}
                onChange={(e) => updatePref("items_per_page", Number(e.target.value))}
                disabled={loading}
              >
                {ITEMS_PER_PAGE_OPTIONS.map((value) => (
                  <MenuItem key={value} value={value}>
                    {value}
                  </MenuItem>
                ))}
              </TextField>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent>
              <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 2 }}>
                <NotificationsIcon color="primary" />
                <Typography variant="subtitle1" fontWeight={700}>
                  Notifications
                </Typography>
              </Stack>

              <Grid container spacing={1}>
                <Grid item xs={12} md={4}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={!!prefs.notifications_enabled}
                        onChange={(e) => updatePref("notifications_enabled", e.target.checked)}
                        disabled={loading}
                      />
                    }
                    label="Enable notifications"
                  />
                </Grid>
                <Grid item xs={12} md={4}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={!!prefs.email_notifications}
                        onChange={(e) => updatePref("email_notifications", e.target.checked)}
                        disabled={loading}
                      />
                    }
                    label="Email notifications"
                  />
                </Grid>
                <Grid item xs={12} md={4}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={!!prefs.desktop_notifications}
                        onChange={(e) => updatePref("desktop_notifications", e.target.checked)}
                        disabled={loading}
                      />
                    }
                    label="Desktop notifications"
                  />
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: "background.default" }}>
            <CardContent>
              <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1 }}>
                <TuneIcon color="primary" />
                <Typography variant="subtitle2" fontWeight={700}>
                  ERP Best-Practice Tip
                </Typography>
              </Stack>
              <Divider sx={{ mb: 1.5 }} />
              <Typography variant="body2" color="text.secondary">
                Keep `Items per page` between 25 and 50 for faster list pages, and enable desktop notifications for approvals and urgent operational alerts.
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
