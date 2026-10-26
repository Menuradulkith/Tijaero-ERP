import { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, CircularProgress, Divider, Grid, Stack, TextField, Typography } from "@mui/material";
import { usePermission } from "@/auth/permissions";
import { showErrorToast, showSuccessToast } from "@/components/tijaero";
import { handleApiError } from "@/utils/errorHandling";
import { settingsApi } from "../api";
import type { CompanyDocumentDetails } from "../types";

const MAX_LOGO_BYTES = 1024 * 1024;
const EMPTY: CompanyDocumentDetails = {
  company_website: "",
  business_registration_number: "",
  bank_name: "",
  bank_branch: "",
  bank_account_name: "",
  bank_account_number: "",
  bank_swift_code: "",
};

/**
 * Company Settings → Documents: the logo, registration numbers and bank account
 * printed on invoices, quotations, purchase orders and other documents and on report
 * exports. Per-document wording (terms, footer) lives in Settings → Print Templates.
 */
export default function CompanyDocumentSettings() {
  const canUpdate = usePermission("settings", "update");
  const [values, setValues] = useState<CompanyDocumentDetails>(EMPTY);
  const [initial, setInitial] = useState<CompanyDocumentDetails>(EMPTY);
  const [logo, setLogo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    Promise.all([settingsApi.getCompanySettings(), settingsApi.getCompanyLogo()])
      .then(([s, l]) => {
        const v: CompanyDocumentDetails = {
          company_website: s.company_website ?? "",
          business_registration_number: s.business_registration_number ?? "",
          bank_name: s.bank_name ?? "",
          bank_branch: s.bank_branch ?? "",
          bank_account_name: s.bank_account_name ?? "",
          bank_account_number: s.bank_account_number ?? "",
          bank_swift_code: s.bank_swift_code ?? "",
        };
        setValues(v);
        setInitial(v);
        setLogo(l.logo);
      })
      .catch((e) => showErrorToast(handleApiError(e, "Failed to load document settings")))
      .finally(() => setLoading(false));
  }, []);

  const set = (key: keyof CompanyDocumentDetails) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      // Empty fields are sent as null so they are cleared, not left unchanged.
      const body = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim() || null]));
      await settingsApi.updateCompanySettings(body);
      setInitial(values);
      showSuccessToast("Document details saved");
    } catch (e) {
      showErrorToast(handleApiError(e, "Failed to save document details"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const uploadLogo = (file?: File) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      showErrorToast("Use a PNG, JPEG or WebP image");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      showErrorToast("The logo must be 1 MB or smaller");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await settingsApi.updateCompanyLogo(reader.result as string);
        setLogo(res.logo);
        showSuccessToast("Logo updated");
      } catch (e) {
        showErrorToast(handleApiError(e, "Failed to upload the logo"));
      }
    };
    reader.readAsDataURL(file);
  };

  const removeLogo = async () => {
    try {
      await settingsApi.updateCompanyLogo(null);
      setLogo(null);
      showSuccessToast("Logo removed");
    } catch (e) {
      showErrorToast(handleApiError(e, "Failed to remove the logo"));
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" p={4}>
        <CircularProgress />
      </Box>
    );
  }

  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const field = (key: keyof CompanyDocumentDetails, label: string, max: number, help?: string) => (
    <TextField
      label={label}
      value={values[key]}
      onChange={set(key)}
      fullWidth
      size="small"
      disabled={!canUpdate}
      inputProps={{ maxLength: max }}
      helperText={help}
    />
  );

  return (
    <Box maxWidth={820}>
      <Typography variant="body2" color="text.secondary" paragraph>
        These details print on every document letterhead (invoices, quotations, purchase orders, GRNs, credit notes,
        vouchers) and on report exports. Company name, address, phone, email and TIN come from Company Details.
      </Typography>

      <Typography variant="subtitle2" gutterBottom>
        Logo
      </Typography>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 3 }}>
        <Box
          sx={{ width: 180, height: 72, border: 1, borderColor: "divider", borderRadius: 1, display: "flex",
                alignItems: "center", justifyContent: "center", bgcolor: "background.default" }}
        >
          {logo ? (
            <Box component="img" src={logo} alt="Company logo" sx={{ maxWidth: 170, maxHeight: 64, objectFit: "contain" }} />
          ) : (
            <Typography variant="caption" color="text.secondary">No logo</Typography>
          )}
        </Box>
        {canUpdate && (
          <Stack spacing={1}>
            <Button component="label" variant="outlined" size="small">
              {logo ? "Replace logo" : "Upload logo"}
              <input hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => uploadLogo(e.target.files?.[0])} />
            </Button>
            {logo && (
              <Button size="small" color="error" onClick={removeLogo}>
                Remove
              </Button>
            )}
          </Stack>
        )}
        <Typography variant="caption" color="text.secondary">
          PNG, JPEG or WebP, up to 1 MB. A wide logo on a white or transparent background prints best.
        </Typography>
      </Stack>

      <Divider sx={{ mb: 2 }} />
      <Typography variant="subtitle2" gutterBottom>
        Registration
      </Typography>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6}>
          {field("business_registration_number", "Business registration no. (BRN)", 50)}
        </Grid>
        <Grid item xs={12} sm={6}>
          {field("company_website", "Website", 255)}
        </Grid>
      </Grid>

      <Typography variant="subtitle2" gutterBottom>
        Bank account for customer payments
      </Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        Printed as payment details on invoices with a balance due. A print template can replace it with its own text.
      </Alert>
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6}>
          {field("bank_account_name", "Account name", 150)}
        </Grid>
        <Grid item xs={12} sm={6}>
          {field("bank_account_number", "Account number", 50)}
        </Grid>
        <Grid item xs={12} sm={6}>
          {field("bank_name", "Bank", 100)}
        </Grid>
        <Grid item xs={12} sm={6}>
          {field("bank_branch", "Branch", 100)}
        </Grid>
        <Grid item xs={12} sm={6}>
          {field("bank_swift_code", "SWIFT / BIC", 20)}
        </Grid>
      </Grid>

      {canUpdate && (
        <Box display="flex" justifyContent="flex-end" mt={3}>
          <Button variant="contained" onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving..." : "Save document details"}
          </Button>
        </Box>
      )}
    </Box>
  );
}
