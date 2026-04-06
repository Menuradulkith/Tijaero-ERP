import { showErrorToast, showSuccessToast } from "@/components/tijaero";
import BusinessIcon from "@mui/icons-material/Business";
import {
    Avatar,
    Box,
    Button,
    CircularProgress,
    Divider,
    Grid,
    Paper,
    TextField,
    Typography,
} from "@mui/material";
import { AxiosError } from "axios";
import { useCallback, useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { settingsApi } from "../api";

interface CompanySettingsForm {
  company_name: string;
  company_address: string;
  company_telephone_number: string;
  company_email: string;
  tax_registration_number: string;
  depreciation_rate: number;
}

export default function CompanySettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const {
    control,
    handleSubmit,
    reset,
    formState: { isDirty },
  } = useForm<CompanySettingsForm>({
    defaultValues: {
      company_name: "",
      company_address: "",
      company_telephone_number: "",
      company_email: "",
      tax_registration_number: "",
      depreciation_rate: 0,
    },
  });

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const data = await settingsApi.getCompanySettings();
      reset({
        company_name: data.company_name || "",
        company_address: data.company_address || "",
        company_telephone_number: data.company_telephone_number || "",
        company_email: data.company_email || "",
        tax_registration_number: data.tax_registration_number || "",
        depreciation_rate: data.depreciation_rate || 0,
      });
    } catch (err: unknown) {
      console.error("Failed to load company settings:", err);
      const axiosError = err as AxiosError<{ detail?: string }>;
      const errorMessage =
        axiosError.response?.data?.detail || "Failed to load company settings.";
      showErrorToast(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [reset]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const onSubmit = async (data: CompanySettingsForm) => {
    try {
      setSaving(true);
      await settingsApi.updateCompanySettings(data);
      showSuccessToast("Company settings updated successfully");
      reset(data); // reset form to clear isDirty state
    } catch (err: unknown) {
      console.error("Failed to update company settings:", err);
      const axiosError = err as AxiosError<{ detail?: string }>;
      const errorMessage =
        axiosError.response?.data?.detail || "Failed to save company settings.";
      showErrorToast(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        Settings
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Manage company details, contact information, and financial settings
      </Typography>

      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 4 }}>
          <Avatar
            sx={{ width: 80, height: 80, mr: 2, bgcolor: "primary.main" }}
          >
            <BusinessIcon fontSize="large" />
          </Avatar>
          <Box>
            <Typography variant="h6">Company Logo</Typography>
            <Button size="small" sx={{ mt: 1 }}>
              Change Logo
            </Button>
          </Box>
        </Box>

        <form onSubmit={handleSubmit(onSubmit)}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Basic Details
          </Typography>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={6}>
              <Controller
                name="company_name"
                control={control}
                rules={{ required: "Company Name is required" }}
                render={({ field, fieldState: { error } }) => (
                  <TextField
                    {...field}
                    required
                    label="Company Name"
                    fullWidth
                    error={!!error}
                    helperText={error?.message}
                  />
                )}
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <Controller
                name="tax_registration_number"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Tax Registration Number"
                    fullWidth
                  />
                )}
              />
            </Grid>

            <Grid item xs={12}>
              <Controller
                name="company_address"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Company Address"
                    fullWidth
                    multiline
                    rows={2}
                  />
                )}
              />
            </Grid>
          </Grid>

          <Divider sx={{ my: 4 }} />

          <Typography variant="h6" sx={{ mb: 2 }}>
            Contact Information
          </Typography>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={6}>
              <Controller
                name="company_telephone_number"
                control={control}
                render={({ field }) => (
                  <TextField {...field} label="Telephone" fullWidth />
                )}
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <Controller
                name="company_email"
                control={control}
                rules={{
                  pattern: {
                    value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                    message: "Invalid email address",
                  },
                }}
                render={({ field, fieldState: { error } }) => (
                  <TextField
                    {...field}
                    type="email"
                    label="Company Email"
                    fullWidth
                    error={!!error}
                    helperText={error?.message}
                  />
                )}
              />
            </Grid>
          </Grid>

          <Divider sx={{ my: 4 }} />

          <Typography variant="h6" sx={{ mb: 2 }}>
            Financial Settings
          </Typography>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={6}>
              <Controller
                name="depreciation_rate"
                control={control}
                rules={{
                  min: { value: 0, message: "Rate must be positive" },
                  max: { value: 100, message: "Rate cannot exceed 100%" },
                }}
                render={({
                  field: { onChange, value, ...field },
                  fieldState: { error },
                }) => (
                  <TextField
                    {...field}
                    type="number"
                    label="Depreciation Rate (%)"
                    fullWidth
                    value={value}
                    onChange={(e) => {
                      const val = e.target.value;
                      onChange(val === "" ? "" : Number(val));
                    }}
                    error={!!error}
                    helperText={
                      error?.message ||
                      "Standard annual depreciation percentage"
                    }
                    InputProps={{
                      inputProps: { min: 0, max: 100, step: "0.1" },
                    }}
                  />
                )}
              />
            </Grid>

            <Grid item xs={12} sx={{ mt: 2 }}>
              <Button
                type="submit"
                variant="contained"
                disabled={saving || !isDirty}
              >
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </Grid>
          </Grid>
        </form>
      </Paper>
    </Box>
  );
}
