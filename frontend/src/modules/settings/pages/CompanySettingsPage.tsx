import {
  handleApiError,
  showErrorToast,
  showSuccessToast,
  TButton,
  TDataGrid,
  TFormDialog,
  TEmptyState,
  useCrudMutation,
} from "@/components/tijaero";
import BusinessIcon from "@mui/icons-material/Business";
import CreditCardIcon from "@mui/icons-material/CreditCard";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import {
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { settingsApi } from "../api";
import { paymentCardsApi } from "@/modules/sales/api";
import { PaymentCard, PaymentCardCreate, PaymentCardUpdate } from "@/modules/sales/types";
import { TDataGridColumn } from "@/components/tijaero/data";
import { GridRenderCellParams } from "@mui/x-data-grid";

const INITIAL_CARD_FORM: PaymentCardCreate = {
  card_name: "",
  card_type: "credit",
  service_charge_percent: 0,
  description: "",
  active: true,
};

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}
function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div hidden={value !== index}>
      {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  );
}

interface CompanySettingsForm {
  company_name: string;
  company_address: string;
  company_telephone_number: string;
  company_email: string;
  tax_registration_number: string;
  depreciation_rate: number;
}

export default function CompanySettingsPage() {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState(0);

  // ── Payment Cards state ──────────────────────────────────────────────
  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<PaymentCard | null>(null);
  const [cardFormData, setCardFormData] = useState<PaymentCardCreate>(INITIAL_CARD_FORM);
  const [showInactiveCards, setShowInactiveCards] = useState(false);
  const [savingCardSettings, setSavingCardSettings] = useState(false);

  const { data: companySettings } = useQuery({
    queryKey: ["company-settings"],
    queryFn: () => settingsApi.getCompanySettings(),
  });
  const hideServiceCharge = companySettings?.hide_service_charge ?? false;

  const { data: cards, isLoading: cardsLoading } = useQuery({
    queryKey: ["payment-cards", showInactiveCards],
    queryFn: () => paymentCardsApi.getAll(!showInactiveCards),
  });

  const createCardMutation = useCrudMutation({
    mutationFn: paymentCardsApi.create,
    invalidateQueryKeys: [["payment-cards"], ["payment-cards-active"]],
    successMessage: "Payment card created successfully",
    errorMessage: "Failed to create payment card",
    onSuccess: () => handleCloseCardDialog(),
  });

  const updateCardMutation = useCrudMutation({
    mutationFn: ({ id, data }: { id: number; data: PaymentCardUpdate }) =>
      paymentCardsApi.update(id, data),
    invalidateQueryKeys: [["payment-cards"], ["payment-cards-active"]],
    successMessage: "Payment card updated successfully",
    errorMessage: "Failed to update payment card",
    onSuccess: () => handleCloseCardDialog(),
  });

  const handleOpenCreateCard = () => {
    setEditingCard(null);
    setCardFormData(INITIAL_CARD_FORM);
    setCardDialogOpen(true);
  };

  const handleOpenEditCard = (card: PaymentCard) => {
    setEditingCard(card);
    setCardFormData({
      card_name: card.card_name,
      card_type: card.card_type,
      service_charge_percent: card.service_charge_percent,
      description: card.description || "",
      active: card.active,
    });
    setCardDialogOpen(true);
  };

  const handleCloseCardDialog = () => {
    setCardDialogOpen(false);
    setEditingCard(null);
    setCardFormData(INITIAL_CARD_FORM);
  };

  const handleSubmitCard = () => {
    if (editingCard) {
      updateCardMutation.mutate({ id: editingCard.id, data: cardFormData });
    } else {
      createCardMutation.mutate(cardFormData);
    }
  };

  const handleToggleCardActive = (card: PaymentCard, active: boolean) => {
    updateCardMutation.mutate({
      id: card.id,
      data: { card_name: card.card_name, card_type: card.card_type, service_charge_percent: card.service_charge_percent, description: card.description || "", active },
    });
  };

  const handleToggleHideServiceCharge = async (value: boolean) => {
    try {
      setSavingCardSettings(true);
      await settingsApi.updateCompanySettings({ hide_service_charge: value });
      queryClient.invalidateQueries({ queryKey: ["company-settings"] });
      showSuccessToast(value ? "Card surcharge hidden from customers" : "Card surcharge visible to customers");
    } catch {
      showErrorToast("Failed to update setting");
    } finally {
      setSavingCardSettings(false);
    }
  };

  const cardColumns: TDataGridColumn<PaymentCard>[] = useMemo(
    () => [
      {
        field: "card_name",
        header: "Card Name",
        flex: 1,
        minWidth: 120,
        renderCell: (params: GridRenderCellParams<PaymentCard>) => (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, height: "100%" }}>
            <CreditCardIcon color="primary" fontSize="small" />
            <Typography fontWeight={500}>{params.row.card_name}</Typography>
          </Box>
        ),
      },
      {
        field: "card_type",
        header: "Type",
        width: 110,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<PaymentCard>) => (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
            <Chip
              label={params.row.card_type === "credit" ? "Credit" : "Debit"}
              size="small"
              color={params.row.card_type === "credit" ? "primary" : "secondary"}
              variant="outlined"
            />
          </Box>
        ),
      },
      {
        field: "service_charge_percent",
        header: "Service Charge",
        width: 140,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<PaymentCard>) => (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
            <Typography fontWeight={500} color="warning.main">
              {params.row.service_charge_percent}%
            </Typography>
          </Box>
        ),
      },
      {
        field: "description",
        header: "Description",
        flex: 2,
        minWidth: 150,
      },
      {
        field: "active",
        header: "Status",
        width: 90,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<PaymentCard>) => (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
            <Switch
              size="small"
              checked={params.row.active}
              onChange={(e) => handleToggleCardActive(params.row, e.target.checked)}
              color={params.row.active ? "success" : "default"}
            />
          </Box>
        ),
      },
      {
        field: "actions",
        header: "Actions",
        width: 80,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<PaymentCard>) => (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
            <Tooltip title="Edit">
              <IconButton size="small" onClick={() => handleOpenEditCard(params.row)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        ),
      },
    ],
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── Company Settings form ────────────────────────────────────────────

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
      showErrorToast(handleApiError(err, "Failed to load company settings."));
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
      showErrorToast(handleApiError(err, "Failed to save company settings."));
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
        Company Configuration
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Manage company details, contact information, financial settings, and payment methods
      </Typography>

      <Paper sx={{ p: 3 }}>
        {/* Tab navigation */}
        <Tabs
          value={activeTab}
          onChange={(_, v) => setActiveTab(v)}
          sx={{ borderBottom: 1, borderColor: "divider", mb: 0 }}
        >
          <Tab
            label="Company Details"
            icon={<BusinessIcon fontSize="small" />}
            iconPosition="start"
          />
          <Tab
            label="Payment Cards"
            icon={<CreditCardIcon fontSize="small" />}
            iconPosition="start"
          />
        </Tabs>

        {/* ── Tab 0: Company Details ── */}
        <TabPanel value={activeTab} index={0}>
          <Box sx={{ display: "flex", alignItems: "center", mb: 4 }}>
            <Avatar sx={{ width: 80, height: 80, mr: 2, bgcolor: "primary.main" }}>
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
                    <TextField {...field} label="Tax Registration Number" fullWidth />
                  )}
                />
              </Grid>

              <Grid item xs={12}>
                <Controller
                  name="company_address"
                  control={control}
                  render={({ field }) => (
                    <TextField {...field} label="Company Address" fullWidth multiline rows={2} />
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
                  render={({ field: { onChange, value, ...field }, fieldState: { error } }) => (
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
                      helperText={error?.message || "Standard annual depreciation percentage"}
                      InputProps={{ inputProps: { min: 0, max: 100, step: "0.1" } }}
                    />
                  )}
                />
              </Grid>
            </Grid>

            <Grid container spacing={3} sx={{ mt: 2 }}>
              <Grid item xs={12}>
                <Button type="submit" variant="contained" disabled={saving || !isDirty}>
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
              </Grid>
            </Grid>
          </form>
        </TabPanel>

        {/* ── Tab 1: Payment Cards ── */}
        <TabPanel value={activeTab} index={1}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 3 }}>
            <Box>
              <Typography variant="h6" fontWeight={600}>
                Payment Cards
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Manage credit and debit card types with service charge rates
              </Typography>
            </Box>
            <Box sx={{ display: "flex", gap: 1.5, alignItems: "center" }}>
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={showInactiveCards}
                    onChange={(e) => setShowInactiveCards(e.target.checked)}
                  />
                }
                label={<Typography variant="body2">Show inactive</Typography>}
              />
              <TButton variant="primary" startIcon={<AddIcon />} onClick={handleOpenCreateCard}>
                Add Card
              </TButton>
            </Box>
          </Box>

          {/* Hide service charge global toggle */}
          <Paper
            variant="outlined"
            sx={{
              p: 2,
              mb: 3,
              borderRadius: 2,
              bgcolor: "background.default",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 2,
            }}
          >
            <Box>
              <Typography variant="subtitle2" fontWeight={600}>
                Hide Card Surcharge from Customers
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                When enabled, the card service charge is silently included in the total — customers see one price with no surcharge line.
              </Typography>
            </Box>
            <Switch
              checked={hideServiceCharge}
              onChange={(e) => handleToggleHideServiceCharge(e.target.checked)}
              color="success"
              disabled={savingCardSettings}
            />
          </Paper>

          <Divider sx={{ mb: 2 }} />

          {cardsLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress />
            </Box>
          ) : cards && cards.length > 0 ? (
            <TDataGrid
              rows={cards}
              columns={cardColumns}
              pageSizeOptions={[10, 25, 50]}
              pageSize={10}
              autoHeight
              density="standard"
            />
          ) : (
            <TEmptyState
              title="No Payment Cards"
              message="Add credit or debit cards to use them as payment methods during sales."
              action={{ label: "Add Card", onClick: handleOpenCreateCard, icon: <AddIcon /> }}
              icon={<CreditCardIcon sx={{ fontSize: 64 }} />}
            />
          )}

          {/* Create / Edit Dialog */}
          <TFormDialog
            open={cardDialogOpen}
            onClose={handleCloseCardDialog}
            title={editingCard ? "Edit Payment Card" : "Add Payment Card"}
            onSubmit={handleSubmitCard}
            submitText={editingCard ? "Update" : "Create"}
            isSubmitting={createCardMutation.isPending || updateCardMutation.isPending}
            maxWidth="sm"
          >
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5, pt: 1 }}>
              <TextField
                label="Card Name"
                value={cardFormData.card_name}
                onChange={(e) => setCardFormData({ ...cardFormData, card_name: e.target.value })}
                required
                fullWidth
                placeholder="e.g., Visa, Mastercard, Commercial Bank Visa"
                helperText="A unique name for this card type"
              />

              <FormControl fullWidth required>
                <InputLabel>Card Type</InputLabel>
                <Select
                  value={cardFormData.card_type}
                  label="Card Type"
                  onChange={(e) =>
                    setCardFormData({ ...cardFormData, card_type: e.target.value as "credit" | "debit" })
                  }
                >
                  <MenuItem value="credit">Credit Card</MenuItem>
                  <MenuItem value="debit">Debit Card</MenuItem>
                </Select>
              </FormControl>

              <TextField
                label="Service Charge"
                type="number"
                value={cardFormData.service_charge_percent}
                onChange={(e) =>
                  setCardFormData({ ...cardFormData, service_charge_percent: parseFloat(e.target.value) || 0 })
                }
                required
                fullWidth
                InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
                inputProps={{ min: 0, max: 100, step: 0.1 }}
                helperText="Percentage charged as service fee for this card"
              />

              <TextField
                label="Description"
                value={cardFormData.description}
                onChange={(e) => setCardFormData({ ...cardFormData, description: e.target.value })}
                fullWidth
                multiline
                rows={2}
                placeholder="Optional notes about this card"
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={cardFormData.active}
                    onChange={(e) => setCardFormData({ ...cardFormData, active: e.target.checked })}
                  />
                }
                label="Active"
              />
            </Box>
          </TFormDialog>
        </TabPanel>
      </Paper>
    </Box>
  );
}
