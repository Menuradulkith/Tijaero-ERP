import {
  Box,
  Typography,
  FormControlLabel,
  Switch,
  Button,
  Divider,
} from "@mui/material";
import { useState } from "react";
import { showSuccessToast } from "@/components/tijaero";

export default function NotificationsSettings() {
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(true);
  const [salesAlerts, setSalesAlerts] = useState(true);
  const [inventoryAlerts, setInventoryAlerts] = useState(true);
  const [systemUpdates, setSystemUpdates] = useState(false);

  const handleSave = () => {
    showSuccessToast("Notification settings saved successfully");
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Notification Channels
      </Typography>
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
              checked={pushNotifications}
              onChange={(e) => setPushNotifications(e.target.checked)}
            />
          }
          label="Push Notifications"
        />
        <Typography variant="body2" color="text.secondary" sx={{ ml: 4 }}>
          Receive push notifications in your browser
        </Typography>
      </Box>

      <Divider sx={{ my: 3 }} />

      <Typography variant="h6" gutterBottom>
        Alert Types
      </Typography>
      <Box sx={{ mb: 2 }}>
        <FormControlLabel
          control={
            <Switch
              checked={salesAlerts}
              onChange={(e) => setSalesAlerts(e.target.checked)}
            />
          }
          label="Sales Alerts"
        />
      </Box>

      <Box sx={{ mb: 2 }}>
        <FormControlLabel
          control={
            <Switch
              checked={inventoryAlerts}
              onChange={(e) => setInventoryAlerts(e.target.checked)}
            />
          }
          label="Inventory Alerts"
        />
      </Box>

      <Box sx={{ mb: 3 }}>
        <FormControlLabel
          control={
            <Switch
              checked={systemUpdates}
              onChange={(e) => setSystemUpdates(e.target.checked)}
            />
          }
          label="System Updates"
        />
      </Box>

      <Button variant="contained" onClick={handleSave}>
        Save Settings
      </Button>
    </Box>
  );
}
