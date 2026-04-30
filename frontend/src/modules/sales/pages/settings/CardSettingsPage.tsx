/**
 * CardSettingsPage - Manage Payment Cards (Credit/Debit)
 * 
 * Allows users to create and manage payment card types with service charges.
 * Cards configured here appear in the payment method dropdown during sales.
 */

import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  InputAdornment,
  IconButton,
  Tooltip,
  Chip,
  Typography,
  Switch,
  FormControlLabel,
  Paper,
  Divider,
} from "@mui/material";
import {
  Add as AddIcon,
  Edit as EditIcon,
  CreditCard as CardIcon,
} from "@mui/icons-material";
import {
  TPageHeader,
  TButton,
  TDataGrid,
  TFormDialog,
  TPageSkeleton,
  TEmptyState,
  useCrudMutation,
  showSuccessToast,
  showErrorToast,
} from "@/components/tijaero";
import { settingsApi } from "@/modules/settings/api";
import { TDataGridColumn } from "@/components/tijaero/data";
import { paymentCardsApi } from "../../api";
import { PaymentCard, PaymentCardCreate, PaymentCardUpdate } from "../../types";
import { GridRenderCellParams } from "@mui/x-data-grid";
import { formatDateTime } from "@/utils/formatters";

const INITIAL_FORM_DATA: PaymentCardCreate = {
  card_name: "",
  card_type: "credit",
  service_charge_percent: 0,
  description: "",
  active: true,
};

export default function CardSettingsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<PaymentCard | null>(null);
  const [formData, setFormData] = useState<PaymentCardCreate>(INITIAL_FORM_DATA);
  const [showInactive, setShowInactive] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Company settings for hide_service_charge toggle
  const { data: companySettings } = useQuery({
    queryKey: ["company-settings"],
    queryFn: () => settingsApi.getCompanySettings(),
  });
  const hideServiceCharge = companySettings?.hide_service_charge ?? false;

  const handleToggleHideServiceCharge = async (value: boolean) => {
    try {
      setSavingSettings(true);
      await settingsApi.updateCompanySettings({ hide_service_charge: value });
      queryClient.invalidateQueries({ queryKey: ["company-settings"] });
      showSuccessToast(value ? "Card surcharge hidden from customers" : "Card surcharge visible to customers");
    } catch {
      showErrorToast("Failed to update setting");
    } finally {
      setSavingSettings(false);
    }
  };

  // Fetch payment cards
  const { data: cards, isLoading } = useQuery({
    queryKey: ["payment-cards", showInactive],
    queryFn: () => paymentCardsApi.getAll(!showInactive),
  });

  // Mutations
  const createMutation = useCrudMutation({
    mutationFn: paymentCardsApi.create,
    invalidateQueryKeys: [["payment-cards"]],
    successMessage: "Payment card created successfully",
    errorMessage: "Failed to create payment card",
    onSuccess: () => {
      handleCloseDialog();
    },
  });

  const updateMutation = useCrudMutation({
    mutationFn: ({ id, data }: { id: number; data: PaymentCardUpdate }) =>
      paymentCardsApi.update(id, data),
    invalidateQueryKeys: [["payment-cards"]],
    successMessage: "Payment card updated successfully",
    errorMessage: "Failed to update payment card",
    onSuccess: () => {
      handleCloseDialog();
    },
  });

  // Handlers
  const handleOpenCreate = () => {
    setEditingCard(null);
    setFormData(INITIAL_FORM_DATA);
    setDialogOpen(true);
  };

  const handleOpenEdit = (card: PaymentCard) => {
    setEditingCard(card);
    setFormData({
      card_name: card.card_name,
      card_type: card.card_type,
      service_charge_percent: card.service_charge_percent,
      description: card.description || "",
      active: card.active,
    });
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingCard(null);
    setFormData(INITIAL_FORM_DATA);
  };

  const handleSubmit = () => {
    if (editingCard) {
      updateMutation.mutate({ id: editingCard.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleToggleActive = (card: PaymentCard, active: boolean) => {
    updateMutation.mutate({
      id: card.id,
      data: {
        card_name: card.card_name,
        card_type: card.card_type,
        service_charge_percent: card.service_charge_percent,
        description: card.description || "",
        active,
      },
    });
  };

  // Grid columns
  const columns: TDataGridColumn<PaymentCard>[] = useMemo(
    () => [
      {
        field: "card_name",
        header: "Card Name",
        flex: 1,
        minWidth: 100,
        renderCell: (params: GridRenderCellParams<PaymentCard>) => (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, height: "100%" }}>
            <CardIcon color="primary" fontSize="small" />
            <Typography fontWeight={500}>{params.row.card_name}</Typography>
          </Box>
        ),
      },
      {
        field: "card_type",
        header: "Type",
        width: 100,
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
        width: 130,
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
        width: 80,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<PaymentCard>) => (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
            <Switch
              size="small"
              checked={params.row.active}
              onChange={(e) => handleToggleActive(params.row, e.target.checked)}
              color={params.row.active ? "success" : "default"}
            />
          </Box>
        ),
      },

   
      {
        field: "actions",
        header: "Actions",
        width: 100,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<PaymentCard>) => (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, justifyContent: "center", height: "100%" }}>
            <Tooltip title="Edit">
              <IconButton size="small" onClick={() => handleOpenEdit(params.row)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        ),
      },
    ],
    []
  );

  if (isLoading) {
    return <TPageSkeleton variant="list" />;
  }

  return (
    <Box sx={{ p: 2, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TPageHeader
        title="Payment Cards"
        subtitle="Manage credit and debit cards with service charges"
        icon={<CardIcon />}
        compact
        actions={
          <Box sx={{ display: "flex", gap: 1.5, alignItems: "center" }}>
            <FormControlLabel
              control={
                <Switch
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                  size="small"
                />
              }
              label={<Typography variant="body2">Show inactive</Typography>}
            />
            <TButton
              variant="primary"
              startIcon={<AddIcon />}
              onClick={handleOpenCreate}
            >
              Add Card
            </TButton>
          </Box>
        }
      />

      {/* Hide service charge global toggle */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Box>
            <Typography variant="subtitle2" fontWeight={600}>
              Hide Card Surcharge from Customers
            </Typography>
            <Typography variant="body2" color="text.secondary">
              When ON, the card service charge is silently included in the total — customers see one price with no surcharge line.
            </Typography>
          </Box>
          <Switch
            checked={hideServiceCharge}
            onChange={(e) => handleToggleHideServiceCharge(e.target.checked)}
            color="success"
            disabled={savingSettings}
          />
        </Box>
      </Paper>

      <Divider sx={{ mb: 2 }} />

      {cards && cards.length > 0 ? (
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <TDataGrid
            rows={cards}
            columns={columns}
            pageSizeOptions={[10, 25, 50]}
            pageSize={10}
            autoHeight
            density="standard"
          />
        </Box>
      ) : (
        <TEmptyState
          title="No Payment Cards"
          message="Add credit or debit cards to use them as payment methods during sales."
          action={{
            label: "Add Card",
            onClick: handleOpenCreate,
            icon: <AddIcon />,
          }}
          icon={<CardIcon sx={{ fontSize: 64 }} />}
        />
      )}

      {/* Create/Edit Dialog */}
      <TFormDialog
        open={dialogOpen}
        onClose={handleCloseDialog}
        title={editingCard ? "Edit Payment Card" : "Add Payment Card"}
        onSubmit={handleSubmit}
        submitText={editingCard ? "Update" : "Create"}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        maxWidth="sm"
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5, pt: 1 }}>
          <TextField
            label="Card Name"
            value={formData.card_name}
            onChange={(e) => setFormData({ ...formData, card_name: e.target.value })}
            required
            fullWidth
            placeholder="e.g., Visa, Mastercard, Commercial Bank Visa"
            helperText="A unique name for this card type"
          />

          <FormControl fullWidth required>
            <InputLabel>Card Type</InputLabel>
            <Select
              value={formData.card_type}
              label="Card Type"
              onChange={(e) =>
                setFormData({ ...formData, card_type: e.target.value as "credit" | "debit" })
              }
            >
              <MenuItem value="credit">Credit Card</MenuItem>
              <MenuItem value="debit">Debit Card</MenuItem>
            </Select>
          </FormControl>

          <TextField
            label="Service Charge"
            type="number"
            value={formData.service_charge_percent}
            onChange={(e) =>
              setFormData({
                ...formData,
                service_charge_percent: parseFloat(e.target.value) || 0,
              })
            }
            required
            fullWidth
            InputProps={{
              endAdornment: <InputAdornment position="end">%</InputAdornment>,
            }}
            inputProps={{ min: 0, max: 100, step: 0.1 }}
            helperText="Percentage charged as service fee for this card"
          />

          <TextField
            label="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            fullWidth
            multiline
            rows={2}
            placeholder="Optional notes about this card"
          />

          <FormControlLabel
            control={
              <Switch
                checked={formData.active}
                onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
              />
            }
            label="Active"
          />
        </Box>
      </TFormDialog>
    </Box>
  );
}
