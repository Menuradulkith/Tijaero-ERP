/**
 * TaxSettingsPage - Configure Default Tax Rate
 *
 * Sets the default tax rate applied to new sales orders.
 * Tax is always back-calculated (inclusive) — price stays the same,
 * tax amount is extracted from the price for accounting purposes.
 */

import { showErrorToast, showSuccessToast } from "@/components/tijaero";
import { settingsApi } from "@/modules/settings/api";
import ReceiptIcon from "@mui/icons-material/Receipt";
import {
  Box,
  CircularProgress,
  Grid,
  InputAdornment,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { TButton } from "@/components/tijaero";

export default function TaxSettingsPage() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [defaultTaxRate, setDefaultTaxRate] = useState(0);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["company-settings"],
    queryFn: () => settingsApi.getCompanySettings(),
  });

  useEffect(() => {
    if (settings) {
      setDefaultTaxRate(settings.default_tax_rate ?? 0);
      setDirty(false);
    }
  }, [settings]);

  const handleSave = async () => {
    try {
      setSaving(true);
      await settingsApi.updateCompanySettings({
        default_tax_rate: defaultTaxRate,
      });
      queryClient.invalidateQueries({ queryKey: ["company-settings"] });
      showSuccessToast("Tax settings saved successfully");
      setDirty(false);
    } catch {
      showErrorToast("Failed to save tax settings");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", mt: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, maxWidth: 720 }}>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3 }}>
        <ReceiptIcon color="primary" />
        <Box>
          <Typography variant="h6" fontWeight={600}>
            Tax Settings
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Set the default tax rate applied to new sales orders
          </Typography>
        </Box>
      </Box>

      {/* Tax Rate Section */}
      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>
          Default Tax Rate
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Auto-applied to every new sales order. Tax is back-calculated (inclusive) —
          the customer's price stays the same and tax is extracted from it for accounting.
        </Typography>
        <Grid container spacing={3} alignItems="flex-start">
          <Grid item xs={12} sm={5}>
            <TextField
              label="Tax Rate"
              type="number"
              value={defaultTaxRate}
              onChange={(e) => {
                const v = Math.min(100, Math.max(0, parseFloat(e.target.value) || 0));
                setDefaultTaxRate(v);
                setDirty(true);
              }}
              fullWidth
              size="small"
              InputProps={{
                endAdornment: <InputAdornment position="end">%</InputAdornment>,
                inputProps: { min: 0, max: 100, step: 0.5 },
              }}
              helperText="e.g. 18 for 18% VAT / GST"
            />
          </Grid>
          <Grid item xs={12} sm={7}>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 0.5 }}>
              {[0, 5, 8, 12, 18].map((rate) => (
                <Box
                  key={rate}
                  onClick={() => { setDefaultTaxRate(rate); setDirty(true); }}
                  sx={{
                    px: 1.5, py: 0.5, borderRadius: 2, cursor: "pointer",
                    border: 1,
                    borderColor: defaultTaxRate === rate ? "primary.main" : "divider",
                    bgcolor: defaultTaxRate === rate ? "primary.main" : "background.paper",
                    color: defaultTaxRate === rate ? "white" : "text.primary",
                    fontSize: 13, fontWeight: 500,
                    "&:hover": { borderColor: "primary.main" },
                  }}
                >
                  {rate}%
                </Box>
              ))}
            </Box>
          </Grid>
        </Grid>

        {defaultTaxRate > 0 && (
          <Box sx={{ mt: 2, p: 1.5, bgcolor: "info.50", borderRadius: 1, border: 1, borderColor: "info.light" }}>
            <Typography variant="body2" color="info.dark">
              <strong>Example:</strong> Item priced at Rs. 500 with {defaultTaxRate}% tax →{" "}
              Customer pays Rs. 500 · Tax extracted ={" "}
              Rs. {(500 * (defaultTaxRate / 100) / (1 + defaultTaxRate / 100)).toFixed(2)} · Net ={" "}
              Rs. {(500 - 500 * (defaultTaxRate / 100) / (1 + defaultTaxRate / 100)).toFixed(2)}
            </Typography>
          </Box>
        )}
      </Paper>

      <TButton
        variant="primary"
        onClick={handleSave}
        disabled={saving || !dirty}
        loading={saving}
      >
        Save Tax Settings
      </TButton>
    </Box>
  );
}
