import {
  Box,
  Typography,
  FormControl,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Switch,
  Button,
  Divider,
} from "@mui/material";
import { useState } from "react";
import { showSuccessToast } from "@/components/tijaero";

export default function PreferencesSettings() {
  const [theme, setTheme] = useState("light");
  const [language, setLanguage] = useState("en");
  const [compactView, setCompactView] = useState(false);

  const handleSave = () => {
    showSuccessToast("Preferences saved successfully");
  };

  return (
    <Box>
      <FormControl component="fieldset" sx={{ mb: 3 }}>
        <FormLabel component="legend">Theme</FormLabel>
        <RadioGroup
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          sx={{ mt: 1 }}
        >
          <FormControlLabel value="light" control={<Radio />} label="Light" />
          <FormControlLabel value="dark" control={<Radio />} label="Dark" />
          <FormControlLabel value="auto" control={<Radio />} label="Auto" />
        </RadioGroup>
      </FormControl>

      <Divider sx={{ my: 3 }} />

      <FormControl component="fieldset" sx={{ mb: 3 }}>
        <FormLabel component="legend">Language</FormLabel>
        <RadioGroup
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          sx={{ mt: 1 }}
        >
          <FormControlLabel value="en" control={<Radio />} label="English" />
          <FormControlLabel value="es" control={<Radio />} label="Spanish" />
          <FormControlLabel value="fr" control={<Radio />} label="French" />
        </RadioGroup>
      </FormControl>

      <Divider sx={{ my: 3 }} />

      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle1" gutterBottom>
          Display Options
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={compactView}
              onChange={(e) => setCompactView(e.target.checked)}
            />
          }
          label="Compact View"
        />
      </Box>

      <Button variant="contained" onClick={handleSave}>
        Save Preferences
      </Button>
    </Box>
  );
}
