import { useState } from "react";
import { Box, Typography, Tabs, Tab, Paper } from "@mui/material";
import ProfileSettings from "../components/ProfileSettings";
import PreferencesSettings from "../components/PreferencesSettings";
import NotificationsSettings from "../components/NotificationsSettings";

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`settings-tabpanel-${index}`}
      aria-labelledby={`settings-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

export default function SettingsPage() {
  const [tabValue, setTabValue] = useState(0);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  return (
    <Box>
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        Settings
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Manage your profile, preferences, and notifications
      </Typography>

      <Paper>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          aria-label="settings tabs"
          sx={{ borderBottom: 1, borderColor: "divider" }}
        >
          <Tab label="Profile" />
          <Tab label="Preferences" />
          <Tab label="Notifications" />
        </Tabs>

        <TabPanel value={tabValue} index={0}>
          <ProfileSettings />
        </TabPanel>
        <TabPanel value={tabValue} index={1}>
          <PreferencesSettings />
        </TabPanel>
        <TabPanel value={tabValue} index={2}>
          <NotificationsSettings />
        </TabPanel>
      </Paper>
    </Box>
  );
}
