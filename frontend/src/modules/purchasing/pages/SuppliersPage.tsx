/**
 * SuppliersPage - Using Tijaero-style reusable components
 */

import { useMemo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { formatDateTimeReadable, formatCurrency } from "@/utils/formatters";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import {
  Box,
  Button,
  TextField,
  MenuItem,
  Switch,
  FormControlLabel,
  Typography,
  IconButton,
  Alert,
  Avatar,
  Tooltip,
  InputAdornment,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import BusinessIcon from "@mui/icons-material/Business";
import LocationOnOutlinedIcon from "@mui/icons-material/LocationOnOutlined";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import AccountBalanceWalletOutlinedIcon from "@mui/icons-material/AccountBalanceWalletOutlined";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import LocalAtmIcon from "@mui/icons-material/LocalAtm";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import SyncAltIcon from "@mui/icons-material/SyncAlt";
import DescriptionIcon from "@mui/icons-material/Description";
import CreditCardIcon from "@mui/icons-material/CreditCard";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import HistoryIcon from "@mui/icons-material/History";
import { useAuthStore } from "@/state/authStore";
import { useCurrencyStore } from "@/state/currencyStore";
import { hasPermission, PERMISSIONS } from "@/auth/permissions";
import { useReferenceData, type CountryRef, type CurrencyRef } from "@/hooks/useReferenceData";
// ConfirmDialog now uses TConfirmDialog from tijaero

import {
  TChip,
  MasterDetailLayout,
  DetailPanelHeader,
  ActionToolbar,
  FormSection,
  EmptyState,
  useMasterDetailState,
  showErrorToast,
  showSuccessToast,
  showWarningToast,
  handleApiError,
  TConfirmDialog,
  TDetailSkeleton,
  TStatusFilter,
  TTabs,
  TTabPanel,
  type TTabConfig,
  TITLE_CHOICES,
  GENDER_CHOICES,
  SUPPLIER_TAX_AREA,
  SUPPLIER_PAYMENT_TERMS,
  SUPPLIER_PAYMENT_TERMS_CUSTOM,
  getPaymentTermsLabel,
  SUPPLIER_SAVED_PAYMENT_METHOD_TYPE,
  SUPPLIER_PAYMENT_CARD_TYPE,
  SUPPLIER_LC_TYPE,
  SUPPLIER_WALLET_PROVIDER,
  useCrudMutation,
  useTConfirmDialog,
  TDataGrid,
  type TDataGridColumn,
  TSidePanel,
  TActivityHistoryPanel,
  TFormSection,
  TButton,
  TAutocomplete,
} from "@/components/tijaero";

import { suppliersApi } from "@/modules/purchasing/api";
import {
  Supplier,
  SupplierCreate,
  SupplierUpdate,
  SupplierPaymentAccount,
  SupplierPaymentAccountCreate,
  SupplierPaymentAccountType,
  SupplierContactPerson,
  SupplierContactPersonCreate,
} from "@/modules/purchasing/types";
import SupplierLogoUploader from "@/modules/purchasing/components/SupplierLogoUploader";

// A supplier row as shown in the browse table, with the country name looked
// up and attached directly so the table's own column-header sort orders by
// the displayed name rather than the raw country_id.
type SupplierRow = Supplier & { country_name: string };

// The API client's baseURL includes /api/v1; uploaded files are served from
// the plain origin at /uploads (mirrors SupplierLogoUploader's own helper).
const LOGO_API_ORIGIN = (
  import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1"
).replace(/\/api\/v1$/, "");

function supplierLogoUrl(logoPath?: string): string | undefined {
  return logoPath ? `${LOGO_API_ORIGIN}/uploads/${logoPath}` : undefined;
}

/** Company avatar: shows the uploaded logo if present, else the company
 * name's initials, else a generic placeholder icon (e.g. a brand-new,
 * not-yet-named supplier being created). */
function SupplierAvatarCircle({
  companyName,
  logoPath,
  size = 36,
}: {
  companyName?: string;
  logoPath?: string;
  size?: number;
}) {
  const url = supplierLogoUrl(logoPath);
  const initials = companyName?.trim() ? companyName.trim().slice(0, 2).toUpperCase() : null;
  return (
    <Avatar
      src={url}
      variant="circular"
      sx={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        bgcolor: url ? undefined : "action.disabledBackground",
        color: "text.secondary",
      }}
    >
      {!url && (initials || <PersonOutlineIcon sx={{ fontSize: size * 0.55 }} />)}
    </Avatar>
  );
}

const TODAY_DATE_STRING = new Date().toISOString().split("T")[0];

// Runs `fn` once per item, one at a time (not concurrently). Used for flushing
// draft contact persons / payment methods after a new supplier is created:
// firing them all in parallel (Promise.allSettled) would let two drafts that
// share a "unique" field (id_card_number, email, is_default, ...) both pass
// the backend's check-before-insert validation before either commits, since
// neither request can see the other's not-yet-committed row.
async function runSequentially<T>(
  items: T[],
  fn: (item: T) => Promise<unknown>
): Promise<PromiseSettledResult<unknown>[]> {
  const results: PromiseSettledResult<unknown>[] = [];
  for (const item of items) {
    try {
      const value = await fn(item);
      results.push({ status: "fulfilled", value });
    } catch (reason) {
      results.push({ status: "rejected", reason });
    }
  }
  return results;
}

const SUPPLIER_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const ACTIVITY_ACTION_LABELS: Record<string, string> = {
  create: "Supplier created",
  update: "Supplier updated",
  delete: "Supplier deleted",
};

const PAYMENT_METHOD_TYPE_LABELS: Record<SupplierPaymentAccountType, string> = {
  bank_transfer: "Bank Transfer",
  cash: "Cash",
  cheque: "Cheque",
  direct_debit: "Direct Debit / ACH",
  letter_of_credit: "Letter of Credit",
  credit_card: "Credit Card",
  digital_wallet: "Digital Wallet",
};

const PAYMENT_METHOD_TYPE_ICONS: Record<SupplierPaymentAccountType, ReactNode> = {
  bank_transfer: <AccountBalanceIcon fontSize="small" color="action" />,
  cash: <LocalAtmIcon fontSize="small" color="action" />,
  cheque: <ReceiptLongIcon fontSize="small" color="action" />,
  direct_debit: <SyncAltIcon fontSize="small" color="action" />,
  letter_of_credit: <DescriptionIcon fontSize="small" color="action" />,
  credit_card: <CreditCardIcon fontSize="small" color="action" />,
  digital_wallet: <AccountBalanceWalletIcon fontSize="small" color="action" />,
};

const INITIAL_PAYMENT_METHOD_FORM: SupplierPaymentAccountCreate = {
  method_type: "bank_transfer",
  bank_name: "",
  account_number: "",
  account_holder_name: "",
  branch: "",
  bank_branch_code: "",
  swift_code: "",
  correspondent_bank_name: "",
  correspondent_bank_swift_code: "",
  mandate_reference: "",
  mandate_date: "",
  lc_number: "",
  issuing_bank_name: "",
  advising_bank_name: "",
  lc_amount: undefined,
  lc_currency: "",
  lc_type: "",
  lc_issue_date: "",
  lc_expiry_date: "",
  latest_shipment_date: "",
  card_type: "",
  card_last4: "",
  card_expiry: "",
  cardholder_name: "",
  wallet_provider: "",
  wallet_id: "",
  is_default: false,
};

const INITIAL_CONTACT_PERSON_FORM: SupplierContactPersonCreate = {
  title: "mr",
  full_name: "",
  occupation: "",
  gender: "m",
  birthdate: "",
  id_card_number: "",
  passport_no: "",
  email: "",
  phone: "",
};

const SUPPLIER_DETAIL_TABS: TTabConfig[] = [
  { id: "general", label: "General", icon: <BusinessIcon fontSize="small" /> },
  { id: "address", label: "Address", icon: <LocationOnOutlinedIcon fontSize="small" /> },
  { id: "contactPerson", label: "Contact Person", icon: <PersonOutlineIcon fontSize="small" /> },
  { id: "payment", label: "Payment", icon: <AccountBalanceWalletOutlinedIcon fontSize="small" /> },
];

// Lead time is always stored in days (SupplierCreate/Update.lead_time_days);
// the unit dropdown next to the input is purely a display/entry convenience
// — whatever unit is picked, the typed number is converted to days before
// being saved, and converted back for display when the unit changes.
type LeadTimeUnit = "hours" | "days" | "weeks";
const LEAD_TIME_UNIT_OPTIONS: { value: LeadTimeUnit; label: string }[] = [
  { value: "hours", label: "Hours" },
  { value: "days", label: "Days" },
  { value: "weeks", label: "Weeks" },
];
const LEAD_TIME_UNIT_TO_DAYS: Record<LeadTimeUnit, number> = {
  hours: 1 / 24,
  days: 1,
  weeks: 7,
};
const daysToUnit = (days: number, unit: LeadTimeUnit): number =>
  Math.round((days / LEAD_TIME_UNIT_TO_DAYS[unit]) * 100) / 100;
const unitToDays = (value: number, unit: LeadTimeUnit): number =>
  Math.round(value * LEAD_TIME_UNIT_TO_DAYS[unit]);

const INITIAL_FORM_DATA: SupplierCreate = {
  company_name: "",
  company_registration_number: "",
  tax_registration_number: "",
  tax_area: undefined,
  company_website: "",
  billing_address_line1: "",
  billing_address_line2: "",
  billing_city: "",
  billing_state: "",
  billing_postal_code: "",
  shipping_address_line1: "",
  shipping_address_line2: "",
  shipping_city: "",
  shipping_state: "",
  shipping_postal_code: "",
  email: "",
  home_contact_number: "",
  mobile_contact_number: "",
  credit_days: 30,
  // No auto-filled default — the user must explicitly set the credit
  // limit for each new supplier rather than inheriting an arbitrary value.
  max_credit_limit: 0,
  active: true,
  country_id: undefined,
  lead_time_days: undefined,
  default_currency: undefined,
};

const resetFormFromSupplier = (supplier: Supplier): SupplierCreate => ({
  company_name: supplier.company_name || "",
  company_registration_number: supplier.company_registration_number || "",
  tax_registration_number: supplier.tax_registration_number || "",
  tax_area: supplier.tax_area || undefined,
  company_website: supplier.company_website || "",
  billing_address_line1: supplier.billing_address_line1 || "",
  billing_address_line2: supplier.billing_address_line2 || "",
  billing_city: supplier.billing_city || "",
  billing_state: supplier.billing_state || "",
  billing_postal_code: supplier.billing_postal_code || "",
  shipping_address_line1: supplier.shipping_address_line1 || "",
  shipping_address_line2: supplier.shipping_address_line2 || "",
  shipping_city: supplier.shipping_city || "",
  shipping_state: supplier.shipping_state || "",
  shipping_postal_code: supplier.shipping_postal_code || "",
  email: supplier.email || "",
  home_contact_number: supplier.home_contact_number || "",
  mobile_contact_number: supplier.mobile_contact_number || "",
  credit_days: supplier.credit_days,
  max_credit_limit: supplier.max_credit_limit,
  active: supplier.active,
  country_id: supplier.country_id,
  lead_time_days: supplier.lead_time_days ?? undefined,
  default_currency: supplier.default_currency || undefined,
});

export default function SuppliersPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const currencySymbol = useCurrencyStore((s) => s.symbol);

  const canCreateSupplier = hasPermission(
    user,
    PERMISSIONS.SUPPLIERS_CREATE.resource,
    PERMISSIONS.SUPPLIERS_CREATE.action,
  );
  const canUpdateSupplier = hasPermission(
    user,
    PERMISSIONS.SUPPLIERS_UPDATE.resource,
    PERMISSIONS.SUPPLIERS_UPDATE.action,
  );

  // Confirm dialog for unsaved changes and delete actions
  const confirmDialog = useTConfirmDialog();

  // Filter state - all filters apply live as the user types/selects, no
  // separate "Search" step needed.
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterCountryId, setFilterCountryId] = useState<number | null>(null);

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterStatus(null);
    setFilterCountryId(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Validation state - track which fields have been touched/blurred
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Mark field as touched when user leaves it
  const handleBlur = (fieldName: string) => {
    setTouched(prev => ({ ...prev, [fieldName]: true }));
  };

  // Which of the Address / Contact Person / Payment tabs is active, shown
  // below the always-visible Company/Contact Information section.
  const [activeSection, setActiveSection] = useState<"general" | "address" | "contactPerson" | "payment">("general");

  // "Same as billing" toggle for shipping address — checked whenever the
  // shipping fields are currently empty or already mirror billing, so it
  // defaults to on for a brand-new supplier without fighting existing data.
  const [shippingSameAsBilling, setShippingSameAsBilling] = useState(true);

  // Which unit the Lead Time field is currently displayed/typed in — purely
  // local UI state, never sent to the backend (formData.lead_time_days is
  // always in days; see daysToUnit/unitToDays above).
  const [leadTimeUnit, setLeadTimeUnit] = useState<LeadTimeUnit>("days");

  // Sticky "user explicitly chose Custom" flag for the Payment Terms
  // dropdown — without this, clearing the custom day-count input back to ""
  // would make formData.credit_days no longer match any standard option,
  // which already shows "Custom" on its own; this flag only matters for the
  // moment right after picking "Custom" but before typing a value.
  const [paymentTermsCustom, setPaymentTermsCustom] = useState(false);

  // Whether the user has actually picked a Payment Terms option for a new
  // supplier yet — the dropdown starts blank rather than pre-selecting
  // "Net 30" (formData.credit_days can't itself represent "unset" since 0
  // is a real option, "Due on Receipt"). Existing suppliers always have a
  // real saved value, so this is set true whenever one is selected.
  const [paymentTermsChosen, setPaymentTermsChosen] = useState(false);

  const { data: countryRefData } = useReferenceData(["countries", "currencies"]);
  const countries: CountryRef[] = countryRefData?.countries || [];
  const currencies: CurrencyRef[] = countryRefData?.currencies || [];

  const {
    searchQuery,
    setSearchQuery,
    selectedItem: selectedSupplier,
    setSelectedItem: setSelectedSupplier,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    formData,
    setFormData,
    handleSelectItem: handleSelectSupplier,
    handleNew: handleNewSupplierRaw,
    handleCancel,
    handleStartEdit,
  } = useMasterDetailState<Supplier, SupplierCreate>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromSupplier,
    defaultSortField: "company_name",
    confirmUnsavedChanges: () => confirmDialog.confirm({
      title: "Discard Changes",
      message: "You have unsaved changes. Discard them?",
      confirmText: "Discard",
      cancelText: "Keep Editing",
      confirmColor: "warning",
    }),
  });

  // Wraps the hook's handler so a brand-new supplier starts with Payment
  // Terms genuinely unchosen (see paymentTermsChosen above).
  const handleNewSupplier = useCallback(async () => {
    const started = await handleNewSupplierRaw();
    if (started) setPaymentTermsChosen(false);
    return started;
  }, [handleNewSupplierRaw]);

  // Which supplier is on screen right now, readable from async callbacks
  // that resolve later: a response must only be applied if the user is still
  // on the supplier it belongs to (they may have gone Back or opened another).
  const selectedSupplierIdRef = useRef<number | null>(null);
  selectedSupplierIdRef.current = selectedSupplier?.id ?? null;

  const selectedCountry = countries.find((c) => c.id === formData.country_id) || null;

  // Reset the detail panel's active tab back to "General" whenever a
  // different supplier is selected or a new one is started — but not when
  // just toggling Edit/Cancel on the same record, so the user isn't yanked
  // away from what they're reviewing.
  useEffect(() => {
    setActiveSection("general");
  }, [selectedSupplier?.id, isCreating]);

  // Reflect whether this supplier's shipping address was actually left
  // blank (mirroring billing) or explicitly filled in with its own values.
  // Keyed on the id and shipping value rather than the whole object: a logo
  // upload or "Keep My Edits" swaps in a new selectedSupplier object, and
  // that must not reset a toggle the user changed while editing. Re-syncs
  // on leaving edit mode (save or cancel), when the saved value is truth.
  const selectedShippingLine1 = selectedSupplier?.shipping_address_line1;
  useEffect(() => {
    if (isEditing && !isCreating) return;
    if (selectedSupplier) {
      setShippingSameAsBilling(!selectedShippingLine1);
    } else if (isCreating) {
      setShippingSameAsBilling(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
  }, [selectedSupplier?.id, selectedShippingLine1, isCreating, isEditing]);

  // Whether formData.credit_days already matches a standard option decides
  // "Custom" mode on its own — this just clears a stale explicit-Custom
  // pick from a previously-viewed supplier.
  useEffect(() => {
    setPaymentTermsCustom(false);
  }, [selectedSupplier?.id, isCreating]);

  // Saved payment methods for the currently-selected supplier (fetched fresh
  // whenever the selection changes; a brand-new, not-yet-saved supplier has
  // no id to fetch against, so this stays empty until after the first save).
  // A single panel (TSidePanel) serves Add / Edit / View — panelMode selects
  // which; null means the panel is closed.
  const [paymentMethods, setPaymentMethods] = useState<SupplierPaymentAccount[]>([]);
  const [paymentMethodPanelMode, setPaymentMethodPanelMode] = useState<"create" | "edit" | "view" | null>(null);
  const [activePaymentMethod, setActivePaymentMethod] = useState<SupplierPaymentAccount | null>(null);
  const [paymentMethodForm, setPaymentMethodForm] = useState<SupplierPaymentAccountCreate>(INITIAL_PAYMENT_METHOD_FORM);
  const [savingPaymentMethod, setSavingPaymentMethod] = useState(false);

  // While creating a brand-new supplier (no id yet to attach child records
  // to), payment methods the user adds are held here as local-only drafts
  // with a negative temp id, then flushed to the real API right after the
  // supplier itself is created (see handleSave's createMutation.onSuccess).
  const [draftPaymentMethods, setDraftPaymentMethods] = useState<SupplierPaymentAccountCreate[]>([]);

  // Same local-draft pattern for the company logo — held as a raw File while
  // creating a new supplier, then uploaded right after the supplier is saved.
  const [draftLogoFile, setDraftLogoFile] = useState<File | null>(null);
  useEffect(() => {
    if (!isCreating) {
      setDraftLogoFile(null);
    }
  }, [isCreating]);

  // Activity History is opened on demand from a detail icon in Record
  // Information, rather than shown inline on the page.
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);

  const refreshPaymentMethods = useCallback(async (supplierId: number) => {
    try {
      const methods = await suppliersApi.getPaymentMethods(supplierId);
      // Drop a slow response for a supplier the user has since left, or it
      // would show that supplier's bank accounts under the current one.
      if (selectedSupplierIdRef.current === supplierId) setPaymentMethods(methods);
    } catch {
      if (selectedSupplierIdRef.current === supplierId) setPaymentMethods([]);
    }
  }, []);

  useEffect(() => {
    if (selectedSupplier) {
      refreshPaymentMethods(selectedSupplier.id);
    } else {
      setPaymentMethods([]);
    }
    if (!isCreating) {
      setDraftPaymentMethods([]);
    }
  }, [selectedSupplier?.id, isCreating, refreshPaymentMethods]);

  // Draft rows rendered in the same grid as saved ones use negative ids so
  // they can't collide with real ones; this view-model adds the display
  // fields TDataGrid/the columns expect (id, is_default) uniformly.
  const displayedPaymentMethods: SupplierPaymentAccount[] = selectedSupplier
    ? paymentMethods
    : draftPaymentMethods.map((draft, index) => ({
        id: -(index + 1),
        supplier_id: 0,
        ...draft,
      } as SupplierPaymentAccount));

  // Stays fillable without an Edit click for as long as no payment method
  // has been added yet — checked every time the supplier is opened, not
  // just right after creation.
  const isPaymentMethodsUnfilled = displayedPaymentMethods.length === 0;
  const isPaymentMethodsEditable = isEditing || isCreating || isPaymentMethodsUnfilled;

  const handleOpenAddPaymentMethod = useCallback(() => {
    setActivePaymentMethod(null);
    setPaymentMethodForm({ ...INITIAL_PAYMENT_METHOD_FORM, is_default: displayedPaymentMethods.length === 0 });
    setPaymentMethodPanelMode("create");
  }, [displayedPaymentMethods.length]);

  const paymentMethodFormFromRecord = (method: SupplierPaymentAccount): SupplierPaymentAccountCreate => ({
    method_type: method.method_type,
    bank_name: method.bank_name || "",
    account_number: method.account_number || "",
    account_holder_name: method.account_holder_name || "",
    branch: method.branch || "",
    bank_branch_code: method.bank_branch_code || "",
    swift_code: method.swift_code || "",
    correspondent_bank_name: method.correspondent_bank_name || "",
    correspondent_bank_swift_code: method.correspondent_bank_swift_code || "",
    mandate_reference: method.mandate_reference || "",
    mandate_date: method.mandate_date?.split("T")[0] || "",
    lc_number: method.lc_number || "",
    issuing_bank_name: method.issuing_bank_name || "",
    advising_bank_name: method.advising_bank_name || "",
    lc_amount: method.lc_amount,
    lc_currency: method.lc_currency || "",
    lc_type: method.lc_type || "",
    lc_issue_date: method.lc_issue_date?.split("T")[0] || "",
    lc_expiry_date: method.lc_expiry_date?.split("T")[0] || "",
    latest_shipment_date: method.latest_shipment_date?.split("T")[0] || "",
    card_type: method.card_type || "",
    card_last4: method.card_last4 || "",
    card_expiry: method.card_expiry || "",
    cardholder_name: method.cardholder_name || "",
    wallet_provider: method.wallet_provider || "",
    wallet_id: method.wallet_id || "",
    is_default: method.is_default,
  });

  const handleViewPaymentMethod = useCallback((method: SupplierPaymentAccount) => {
    setActivePaymentMethod(method);
    setPaymentMethodForm(paymentMethodFormFromRecord(method));
    setPaymentMethodPanelMode(selectedSupplier ? "view" : "edit");
  }, [selectedSupplier]);

  const handleOpenEditPaymentMethod = useCallback((method: SupplierPaymentAccount) => {
    setActivePaymentMethod(method);
    setPaymentMethodForm(paymentMethodFormFromRecord(method));
    setPaymentMethodPanelMode("edit");
  }, []);

  const handleClosePaymentMethodPanel = useCallback(() => {
    setPaymentMethodPanelMode(null);
    setActivePaymentMethod(null);
  }, []);

  const handleSavePaymentMethod = useCallback(async () => {
    if (!selectedSupplier) {
      // Draft mode: no supplier id yet, so just hold the form data locally.
      if (activePaymentMethod) {
        const index = -activePaymentMethod.id - 1;
        setDraftPaymentMethods((prev) =>
          prev.map((d, i) => (i === index ? paymentMethodForm : d))
        );
        showSuccessToast("Payment method updated");
      } else {
        setDraftPaymentMethods((prev) => [...prev, paymentMethodForm]);
        showSuccessToast("Payment method added");
      }
      handleClosePaymentMethodPanel();
      return;
    }
    setSavingPaymentMethod(true);
    try {
      if (activePaymentMethod) {
        await suppliersApi.updatePaymentMethod(selectedSupplier.id, activePaymentMethod.id, paymentMethodForm);
        showSuccessToast("Payment method updated");
      } else {
        await suppliersApi.createPaymentMethod(selectedSupplier.id, paymentMethodForm);
        showSuccessToast("Payment method added");
      }
      await refreshPaymentMethods(selectedSupplier.id);
      handleClosePaymentMethodPanel();
    } catch (err) {
      showErrorToast(handleApiError(err, "Failed to save payment method"));
    } finally {
      setSavingPaymentMethod(false);
    }
  }, [selectedSupplier, activePaymentMethod, paymentMethodForm, refreshPaymentMethods, handleClosePaymentMethodPanel]);

  const handleDeletePaymentMethod = useCallback(async (method: SupplierPaymentAccount) => {
    if (!selectedSupplier) {
      const confirmed = await confirmDialog.confirm({
        title: "Delete Payment Method",
        message: `Delete this ${PAYMENT_METHOD_TYPE_LABELS[method.method_type]} payment method?`,
        confirmText: "Delete",
        confirmColor: "error",
      });
      if (!confirmed) return;
      const index = -method.id - 1;
      setDraftPaymentMethods((prev) => prev.filter((_, i) => i !== index));
      showSuccessToast("Payment method deleted");
      handleClosePaymentMethodPanel();
      return;
    }
    const confirmed = await confirmDialog.confirm({
      title: "Delete Payment Method",
      message: `Delete this ${PAYMENT_METHOD_TYPE_LABELS[method.method_type]} payment method?`,
      confirmText: "Delete",
      confirmColor: "error",
    });
    if (!confirmed) return;
    try {
      await suppliersApi.deletePaymentMethod(selectedSupplier.id, method.id);
      showSuccessToast("Payment method deleted");
      await refreshPaymentMethods(selectedSupplier.id);
      handleClosePaymentMethodPanel();
    } catch {
      showErrorToast("Failed to delete payment method");
    }
  }, [selectedSupplier, confirmDialog, refreshPaymentMethods, handleClosePaymentMethodPanel]);

  const paymentMethodColumns: TDataGridColumn<SupplierPaymentAccount>[] = useMemo(
    () => [
      {
        field: "method_type",
        header: "Type",
        width: 160,
        renderCell: (params: GridRenderCellParams<SupplierPaymentAccount>) => (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, height: "100%" }}>
            {PAYMENT_METHOD_TYPE_ICONS[params.row.method_type]}
            <Typography variant="body2" fontWeight={600}>
              {PAYMENT_METHOD_TYPE_LABELS[params.row.method_type]}
            </Typography>
          </Box>
        ),
      },
      { field: "bank_name", header: "Bank", flex: 1, minWidth: 130 },
      {
        field: "account_number",
        header: "Account No.",
        width: 140,
        renderCell: (params: GridRenderCellParams<SupplierPaymentAccount>) =>
          params.row.account_number ? `•••${params.row.account_number.slice(-4)}` : "",
      },
      { field: "account_holder_name", header: "Account Name", flex: 1, minWidth: 150 },
      {
        field: "is_default",
        header: "Default",
        width: 100,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<SupplierPaymentAccount>) =>
          params.row.is_default ? (
            <TChip label="Default" size="small" color="primary" sx={{ height: 20, fontSize: "0.65rem" }} />
          ) : null,
      },
      {
        field: "actions",
        header: "Actions",
        width: 100,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<SupplierPaymentAccount>) =>
          canUpdateSupplier || isPaymentMethodsEditable ? (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", gap: 0.5 }}>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenEditPaymentMethod(params.row);
                }}
              >
                <EditIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                color="error"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeletePaymentMethod(params.row);
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ) : null,
      },
    ],
    [canUpdateSupplier, isPaymentMethodsEditable] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Contact persons for the currently-selected supplier (same fetch-on-select
  // pattern as payment methods above). A single panel (TSidePanel) serves
  // Add / Edit / View — panelMode selects which; null means the panel is closed.
  const [contactPersons, setContactPersons] = useState<SupplierContactPerson[]>([]);
  const [contactPersonPanelMode, setContactPersonPanelMode] = useState<"create" | "edit" | "view" | null>(null);
  const [activeContactPerson, setActiveContactPerson] = useState<SupplierContactPerson | null>(null);
  const [contactPersonForm, setContactPersonForm] = useState<SupplierContactPersonCreate>(INITIAL_CONTACT_PERSON_FORM);
  const [savingContactPerson, setSavingContactPerson] = useState(false);

  // Same local-draft pattern as payment methods above: while creating a new
  // supplier (no id yet), contact persons are held here and flushed to the
  // real API right after the supplier itself is created.
  const [draftContactPersons, setDraftContactPersons] = useState<SupplierContactPersonCreate[]>([]);

  const refreshContactPersons = useCallback(async (supplierId: number) => {
    try {
      const contacts = await suppliersApi.getContactPersons(supplierId);
      // Same stale-response guard as refreshPaymentMethods.
      if (selectedSupplierIdRef.current === supplierId) setContactPersons(contacts);
    } catch {
      if (selectedSupplierIdRef.current === supplierId) setContactPersons([]);
    }
  }, []);

  useEffect(() => {
    if (selectedSupplier) {
      refreshContactPersons(selectedSupplier.id);
    } else {
      setContactPersons([]);
    }
    if (!isCreating) {
      setDraftContactPersons([]);
    }
  }, [selectedSupplier?.id, isCreating, refreshContactPersons]);

  const displayedContactPersons: SupplierContactPerson[] = selectedSupplier
    ? contactPersons
    : draftContactPersons.map((draft, index) => ({
        id: -(index + 1),
        supplier_id: 0,
        ...draft,
      } as SupplierContactPerson));

  // These sections stay fillable without an Edit click for as long as they
  // genuinely have nothing in them yet — checked every time the supplier is
  // opened, not just right after creation — since users without update
  // permission would otherwise have no way to ever fill them in. The moment
  // any of them has real data, they lock again like General does.
  const isAddressUnfilled = !selectedSupplier || ([
    selectedSupplier.billing_address_line1,
    selectedSupplier.billing_address_line2,
    selectedSupplier.billing_city,
    selectedSupplier.billing_state,
    selectedSupplier.billing_postal_code,
    selectedSupplier.shipping_address_line1,
    selectedSupplier.shipping_address_line2,
    selectedSupplier.shipping_city,
    selectedSupplier.shipping_state,
    selectedSupplier.shipping_postal_code,
  ].every((field) => !field) && !selectedSupplier.country_id);
  const isContactPersonUnfilled = displayedContactPersons.length === 0;

  // Whether the fields on each tab can be edited right now, independent of
  // whether the user is in a full Edit session: Address/Contact Person stay
  // open for as long as they're still empty. General and Payment
  // Terms/Max Credit Limit are always required at creation, so they're
  // "filled" the instant the supplier is first saved and always need Edit
  // afterward, like before.
  const isAddressEditable = isEditing || isCreating || isAddressUnfilled;
  const isContactPersonEditable = isEditing || isCreating || isContactPersonUnfilled;

  // Contact Person rows are added/edited through their own side-panel
  // dialog (its own Save button) — the main toolbar's Save/Cancel is
  // redundant there regardless of whether the list is still empty.
  const hideToolbarSaveForSection = activeSection === "contactPerson";

  // The main toolbar's Save/Cancel only cover fields that live directly on
  // formData — General always (once in Edit mode); Address only while it's
  // still unfilled; Payment Terms/Max Credit Limit follow the Payment
  // Methods list's own unfilled state, so the whole Payment tab unlocks and
  // locks together (Contact Person and the Payment Methods list otherwise
  // save through their own dialogs, never this button).
  const showToolbarSaveForSection =
    !hideToolbarSaveForSection &&
    (activeSection === "address"
      ? isAddressEditable
      : activeSection === "payment"
        ? isPaymentMethodsEditable
        : isEditing || isCreating);

  const handleOpenAddContactPerson = useCallback(() => {
    setActiveContactPerson(null);
    setContactPersonForm(INITIAL_CONTACT_PERSON_FORM);
    setContactPersonPanelMode("create");
  }, []);

  const contactPersonFormFromRecord = (contact: SupplierContactPerson): SupplierContactPersonCreate => ({
    title: contact.title || "mr",
    full_name: contact.full_name,
    occupation: contact.occupation || "",
    gender: contact.gender || "m",
    birthdate: contact.birthdate?.split("T")[0] || "",
    id_card_number: contact.id_card_number || "",
    passport_no: contact.passport_no || "",
    email: contact.email || "",
    phone: contact.phone || "",
  });

  const handleViewContactPerson = useCallback((contact: SupplierContactPerson) => {
    setActiveContactPerson(contact);
    setContactPersonForm(contactPersonFormFromRecord(contact));
    setContactPersonPanelMode(selectedSupplier ? "view" : "edit");
  }, [selectedSupplier]);

  const handleOpenEditContactPerson = useCallback((contact: SupplierContactPerson) => {
    setActiveContactPerson(contact);
    setContactPersonForm(contactPersonFormFromRecord(contact));
    setContactPersonPanelMode("edit");
  }, []);

  const handleCloseContactPersonPanel = useCallback(() => {
    setContactPersonPanelMode(null);
    setActiveContactPerson(null);
  }, []);

  const handleSaveContactPerson = useCallback(async () => {
    if (!selectedSupplier) {
      // Draft mode: no supplier id yet, so just hold the form data locally.
      if (activeContactPerson) {
        const index = -activeContactPerson.id - 1;
        setDraftContactPersons((prev) =>
          prev.map((d, i) => (i === index ? contactPersonForm : d))
        );
        showSuccessToast("Contact person updated");
      } else {
        setDraftContactPersons((prev) => [...prev, contactPersonForm]);
        showSuccessToast("Contact person added");
      }
      handleCloseContactPersonPanel();
      return;
    }
    setSavingContactPerson(true);
    try {
      if (activeContactPerson) {
        await suppliersApi.updateContactPerson(selectedSupplier.id, activeContactPerson.id, contactPersonForm);
        showSuccessToast("Contact person updated");
      } else {
        await suppliersApi.createContactPerson(selectedSupplier.id, contactPersonForm);
        showSuccessToast("Contact person added");
      }
      await refreshContactPersons(selectedSupplier.id);
      handleCloseContactPersonPanel();
    } catch {
      showErrorToast("Failed to save contact person");
    } finally {
      setSavingContactPerson(false);
    }
  }, [selectedSupplier, activeContactPerson, contactPersonForm, refreshContactPersons, handleCloseContactPersonPanel]);

  const handleDeleteContactPerson = useCallback(async (contact: SupplierContactPerson) => {
    if (!selectedSupplier) {
      const confirmed = await confirmDialog.confirm({
        title: "Delete Contact Person",
        message: `Delete "${contact.full_name}" from this supplier's contact persons?`,
        confirmText: "Delete",
        confirmColor: "error",
      });
      if (!confirmed) return;
      const index = -contact.id - 1;
      setDraftContactPersons((prev) => prev.filter((_, i) => i !== index));
      showSuccessToast("Contact person deleted");
      handleCloseContactPersonPanel();
      return;
    }
    const confirmed = await confirmDialog.confirm({
      title: "Delete Contact Person",
      message: `Delete "${contact.full_name}" from this supplier's contact persons?`,
      confirmText: "Delete",
      confirmColor: "error",
    });
    if (!confirmed) return;
    try {
      await suppliersApi.deleteContactPerson(selectedSupplier.id, contact.id);
      showSuccessToast("Contact person deleted");
      await refreshContactPersons(selectedSupplier.id);
      handleCloseContactPersonPanel();
    } catch {
      showErrorToast("Failed to delete contact person");
    }
  }, [selectedSupplier, confirmDialog, refreshContactPersons, handleCloseContactPersonPanel]);

  const contactPersonColumns: TDataGridColumn<SupplierContactPerson>[] = useMemo(
    () => [
      {
        field: "full_name",
        header: "Name",
        flex: 1,
        minWidth: 160,
        renderCell: (params: GridRenderCellParams<SupplierContactPerson>) => (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, height: "100%" }}>
            <PersonOutlineIcon fontSize="small" color="action" />
            <Typography variant="body2" fontWeight={600}>
              {[params.row.title, params.row.full_name].filter(Boolean).join(" ")}
            </Typography>
          </Box>
        ),
      },
      { field: "occupation", header: "Occupation", flex: 1, minWidth: 130 },
      { field: "email", header: "Email", flex: 1, minWidth: 160 },
      { field: "phone", header: "Phone", width: 130 },
      {
        field: "actions",
        header: "Actions",
        width: 100,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<SupplierContactPerson>) =>
          canUpdateSupplier || isContactPersonEditable ? (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", gap: 0.5 }}>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenEditContactPerson(params.row);
                }}
              >
                <EditIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                color="error"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteContactPerson(params.row);
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ) : null,
      },
    ],
    [canUpdateSupplier, isContactPersonEditable] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const { data: suppliers, isLoading, refetch } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => suppliersApi.getAll(),
  });

  const filteredSuppliers = useMemo(() => {
    if (!suppliers) return [];

    let filtered = suppliers.filter((supplier) =>
      supplier.company_name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Apply status filter
    if (filterStatus) {
      const isActive = filterStatus === "active";
      filtered = filtered.filter((supplier) => supplier.active === isActive);
    }

    // Apply country filter
    if (filterCountryId !== null) {
      filtered = filtered.filter((supplier) => supplier.country_id === filterCountryId);
    }

    // Default order before the user sorts a column in the table itself
    // (the table's own column-header sort takes over from there).
    filtered.sort((a, b) => a.company_name.localeCompare(b.company_name));

    return filtered;
  }, [suppliers, searchQuery, filterStatus, filterCountryId]);

  // The table sorts by whichever column the user clicks; the Country column
  // displays a looked-up name rather than the raw country_id, so it needs
  // that name as its own field for the grid to sort on correctly.
  const supplierRows = useMemo(
    () =>
      filteredSuppliers.map((supplier) => ({
        ...supplier,
        country_name: countries.find((c) => c.id === supplier.country_id)?.name || "-",
      })),
    [filteredSuppliers, countries]
  );

  // Internal selection handler - wraps hook's handler to reset validation state
  const handleSelectSupplierWithCheck = useCallback(async (supplier: Supplier) => {
    await handleSelectSupplier(supplier);
    setTouched({}); // Reset validation state
    setPaymentTermsChosen(true);
  }, [handleSelectSupplier]);

  const supplierColumns: TDataGridColumn<SupplierRow>[] = useMemo(
    () => [
      { field: "supplier_no", header: "No.", width: 90 },
      {
        field: "company_name",
        header: "Company",
        flex: 1,
        minWidth: 200,
        renderCell: (params: GridRenderCellParams<SupplierRow>) => (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, height: "100%" }}>
            <SupplierAvatarCircle companyName={params.row.company_name} logoPath={params.row.logo_path} size={30} />
            <Typography variant="body2" fontWeight={600}>
              {params.row.company_name}
            </Typography>
          </Box>
        ),
      },
      {
        field: "country_name",
        header: "Country",
        width: 150,
      },
      { field: "email", header: "Email", flex: 1, minWidth: 170 },
      { field: "mobile_contact_number", header: "Mobile Contact", width: 150 },
      {
        field: "credit_days",
        header: "Payment Terms",
        width: 130,
        renderCell: (params: GridRenderCellParams<SupplierRow>) =>
          getPaymentTermsLabel(params.row.credit_days),
      },
      {
        field: "lead_time_days",
        header: "Lead Time",
        width: 120,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<SupplierRow>) =>
          params.row.lead_time_days != null
            ? `${params.row.lead_time_days} ${params.row.lead_time_days === 1 ? "day" : "days"}`
            : "-",
      },
      {
        field: "default_currency",
        header: "Currency",
        width: 110,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<SupplierRow>) =>
          params.row.default_currency || "-",
      },
      {
        field: "max_credit_limit",
        header: "Max Credit Limit",
        width: 150,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<SupplierRow>) =>
          formatCurrency(params.row.max_credit_limit || 0),
      },
      {
        field: "left_credit_amount",
        header: "Left Credit Amount",
        width: 160,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<SupplierRow>) =>
          formatCurrency(params.row.left_credit_amount || 0),
      },
      {
        field: "active",
        header: "Status",
        width: 110,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<SupplierRow>) => (
          <TChip
            label={params.row.active ? "Active" : "Inactive"}
            size="small"
            color={params.row.active ? "success" : "default"}
          />
        ),
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<SupplierRow>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectSupplierWithCheck(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [handleSelectSupplierWithCheck]
  );

  const createMutation = useCrudMutation({
    mutationFn: suppliersApi.create,
    invalidateQueryKeys: [["suppliers"], ["referenceData"]],
    successMessage: "Supplier created successfully",
    errorMessage: "Failed to create supplier",
    onSuccess: async (newSupplier) => {
      // Flush any contact persons / payment methods added while the supplier
      // didn't have an id yet (drafts held in local state) against the real
      // new supplier id, now that one exists.
      const contactResults = await runSequentially(
        draftContactPersons,
        (draft) => suppliersApi.createContactPerson(newSupplier.id, draft)
      );
      const paymentResults = await runSequentially(
        draftPaymentMethods,
        (draft) => suppliersApi.createPaymentMethod(newSupplier.id, draft)
      );
      let logoFailed = false;
      if (draftLogoFile) {
        try {
          await suppliersApi.uploadLogo(newSupplier.id, draftLogoFile);
        } catch {
          logoFailed = true;
        }
      }
      // Name each draft that failed, with the server's reason, so the user
      // knows exactly what to re-add — previously only a count was shown and
      // the failed drafts were silently discarded.
      const failures: string[] = [];
      contactResults.forEach((r, i) => {
        if (r.status === "rejected") {
          failures.push(
            `Contact "${draftContactPersons[i].full_name || "(unnamed)"}": ${handleApiError(r.reason, "failed to save")}`
          );
        }
      });
      paymentResults.forEach((r, i) => {
        if (r.status === "rejected") {
          const d = draftPaymentMethods[i];
          const label = PAYMENT_METHOD_TYPE_LABELS[d.method_type] ?? d.method_type;
          failures.push(`Payment method "${label}": ${handleApiError(r.reason, "failed to save")}`);
        }
      });
      if (logoFailed) failures.push("Logo: failed to upload");
      if (failures.length > 0) {
        showWarningToast(
          `Supplier saved, but these weren't — please add them again: ${failures.join(" • ")}`
        );
      }
      setDraftContactPersons([]);
      setDraftPaymentMethods([]);
      setDraftLogoFile(null);
      setIsCreating(false);
      setIsEditing(false);
      // newSupplier is the response from before the logo/contact/payment
      // drafts above were flushed against its id, so it doesn't reflect them
      // yet (e.g. logo_path is still null even though the upload above just
      // succeeded) — refetch the real record before selecting it, otherwise
      // the newly-uploaded logo appears not to have saved.
      const freshSupplier = await suppliersApi.getById(newSupplier.id).catch(() => newSupplier);
      queryClient.setQueryData<Supplier[]>(["suppliers"], (prev) =>
        prev ? prev.map((s) => (s.id === freshSupplier.id ? freshSupplier : s)) : prev
      );
      setTimeout(() => {
        handleSelectSupplier(freshSupplier);
        setPaymentTermsChosen(true);
      }, 0);
    },
  });

  const updateMutation = useCrudMutation({
    mutationFn: ({ id, data }: { id: number; data: SupplierUpdate }) =>
      suppliersApi.update(id, data),
    invalidateQueryKeys: [["suppliers"], ["referenceData"], ["supplierActivityLog"]],
    successMessage: "Supplier updated successfully",
    errorMessage: "Failed to update supplier",
    onSuccess: (updatedSupplier) => {
      // Only if the user is still on this supplier — they may have pressed
      // Back or opened another while the save was in flight, and reselecting
      // this one would yank them back (with the other's form still loaded).
      if (selectedSupplierIdRef.current !== updatedSupplier.id) return;
      setIsEditing(false);
      setSelectedSupplier(updatedSupplier);
      setFormData(resetFormFromSupplier(updatedSupplier));
    },
    onError: async (error, variables) => {
      if (!axios.isAxiosError(error)) return;
      const status = error.response?.status;

      // 404 = someone deleted this supplier while it was open here.
      if (status === 404) {
        queryClient.setQueryData<Supplier[]>(["suppliers"], (prev) =>
          prev ? prev.filter((s) => s.id !== variables.id) : prev
        );
        if (selectedSupplierIdRef.current === variables.id) {
          setIsEditing(false);
          setSelectedSupplier(null);
        }
        return;
      }

      // 409 = someone else saved this supplier since it was loaded (see
      // expected_version / SupplierService.update_supplier). The global
      // axios interceptor already toasts the server's message.
      if (status !== 409) return;
      try {
        const fresh = await suppliersApi.getById(variables.id);
        // Not actually stale (version unchanged) → some other conflict;
        // leave the user's edits alone.
        if (!variables.data.expected_version || fresh.version === variables.data.expected_version) return;
        queryClient.setQueryData<Supplier[]>(["suppliers"], (prev) =>
          prev ? prev.map((s) => (s.id === fresh.id ? fresh : s)) : prev
        );
        if (selectedSupplierIdRef.current !== fresh.id) return;

        // Let the user choose instead of silently discarding their edits.
        const reload = await confirmDialog.confirm({
          title: "Supplier Changed by Someone Else",
          message: `${fresh.updated_by_name || "Another user"} saved changes to "${fresh.company_name}" after you opened it. Load their version (your unsaved edits will be discarded), or keep editing yours? If you keep yours, saving again will overwrite their changes.`,
          confirmText: "Load Their Version",
          cancelText: "Keep My Edits",
          confirmColor: "warning",
        });
        if (selectedSupplierIdRef.current !== fresh.id) return;
        setSelectedSupplier(fresh);
        if (reload) {
          setFormData(resetFormFromSupplier(fresh));
          setIsEditing(false);
        }
        // Keep: formData stays as the user's edits; selectedSupplier now
        // carries the fresh version, so the next save is a deliberate
        // overwrite the user just agreed to.
      } catch {
        // Refresh failed too — the error toast from the 409 already told
        // the user what happened; nothing more useful to do here.
      }
    },
  });


  const handleSave = useCallback(() => {
    if (isCreating) {
      if (!canCreateSupplier) {
        showErrorToast("You don't have permission to create suppliers");
        return;
      }
      createMutation.mutate(formData);
    } else if (selectedSupplier) {
      if (!canUpdateSupplier && !isAddressEditable && !isPaymentMethodsEditable) {
        showErrorToast("You don't have permission to update suppliers");
        return;
      }
      updateMutation.mutate({
        id: selectedSupplier.id,
        data: {
          ...formData,
          expected_updated_at: selectedSupplier.updated_at,
          expected_version: selectedSupplier.version,
        },
      });
    }
  }, [
    isCreating,
    isAddressEditable,
    isPaymentMethodsEditable,
    selectedSupplier,
    formData,
    createMutation,
    updateMutation,
    canCreateSupplier,
    canUpdateSupplier,
  ]);

  // A logo upload/remove response is merged into the current record as just
  // logo_path — never swapped in wholesale. The response carries the latest
  // version token; adopting it while the form still holds older values would
  // let a stale save pass the conflict check and overwrite another user's
  // changes. Also skipped if the user has since moved to another supplier.
  const handleLogoUpdated = useCallback(
    (updated: Supplier) => {
      const merge = (s: Supplier) => (s.id === updated.id ? { ...s, logo_path: updated.logo_path } : s);
      queryClient.setQueryData<Supplier[]>(["suppliers"], (prev) => (prev ? prev.map(merge) : prev));
      setSelectedSupplier((current) => (current ? merge(current) : current));
    },
    [queryClient, setSelectedSupplier]
  );

  const handleDuplicate = useCallback(async () => {
    if (!selectedSupplier) return;
    // Build the copy first: handleNewSupplier resets the form to blank, so
    // the copy must be applied after it (previously it was applied before
    // and immediately wiped, leaving a blank form).
    const copy: SupplierCreate = {
      ...formData,
      company_name: `${selectedSupplier.company_name} (Copy)`,
      // Must be unique per supplier — copying them would only fail on save.
      company_registration_number: "",
      tax_registration_number: "",
      email: "",
    };
    const started = await handleNewSupplier();
    if (!started) return; // user chose to keep editing instead
    setFormData(copy);
    setTouched({}); // Reset validation state
    // The copy carries over the original supplier's real credit_days, not a
    // stale default, so Payment Terms doesn't need to be re-chosen.
    setPaymentTermsChosen(true);
  }, [selectedSupplier, formData, setFormData, handleNewSupplier]);

  // Cancelling out of "New Supplier" should return to the browse table, not
  // auto-open the first supplier the way useMasterDetailState's generic
  // handleCancel does (that behavior made sense for the old always-visible
  // detail panel, but not here). Cancelling out of editing an existing
  // supplier still just reverts its form, which the generic handler already
  // does correctly.
  const handleCancelSupplier = useCallback(() => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedSupplier(null);
    } else {
      handleCancel(filteredSuppliers);
    }
  }, [isCreating, filteredSuppliers, handleCancel, setIsCreating, setIsEditing, setSelectedSupplier]);

  // Returns to the browse table from the detail view (the "Back to
  // Suppliers" link in the mini left panel).
  const handleBackToSuppliers = useCallback(() => {
    setSelectedSupplier(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [isCreating, setSelectedSupplier, setIsCreating, setIsEditing]);

  // Email validation regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // Phone validation regex (allows digits, spaces, dashes, parentheses, plus)
  const phoneRegex = /^[\d\s\-\(\)\+]+$/;

  // Validation error messages
  const getFieldError = (fieldName: string): string | undefined => {
    if (!touched[fieldName] && !isCreating) return undefined;
    
    switch (fieldName) {
      case 'email':
        if (!formData.email) return 'Email is required';
        if (!emailRegex.test(formData.email)) return 'Invalid email format';
        break;
      case 'mobile_contact_number':
        if (!formData.mobile_contact_number) return 'Mobile number is required';
        if (!phoneRegex.test(formData.mobile_contact_number)) return 'Invalid phone format';
        break;
      case 'home_contact_number':
        if (formData.home_contact_number && !phoneRegex.test(formData.home_contact_number)) return 'Invalid phone format';
        break;
      case 'company_name':
        if (!formData.company_name) return 'Company name is required';
        break;
      case 'credit_days':
        if (!paymentTermsChosen) return 'Please select payment terms';
        if (formData.credit_days === undefined || formData.credit_days < 0) return 'Payment terms must be 0 days or more';
        break;
      case 'max_credit_limit':
        if (formData.max_credit_limit === undefined || formData.max_credit_limit < 0) return 'Credit limit must be 0 or more';
        break;
    }
    return undefined;
  };

  // Check if a field has an error (for styling)
  const hasError = (fieldName: string): boolean => {
    return !!getFieldError(fieldName);
  };

  // Only the Main section's fields gate Save — Address and Payment (including
  // Payment Terms, which defaults to Net 30 until the user picks otherwise)
  // can be filled in later via their own sections after the supplier is
  // created (mirrors ProductsPage, where only Main + cost_price gate Save and
  // selling_price/suppliers are filled in afterward).
  const isFormValid = formData.company_name &&
    formData.mobile_contact_number &&
    formData.email &&
    emailRegex.test(formData.email);
  const isSaving = createMutation.isPending || updateMutation.isPending;

  // Style for required field labels (red asterisk)
  const requiredFieldSx = {
    '& .MuiInputLabel-asterisk': {
      color: 'error.main',
    },
  };

  // Whether we're showing a single supplier's detail view (selected or being
  // created) instead of the browse table.
  const isSupplierDetailMode = !!selectedSupplier || isCreating;

  // Browse mode: a full-width table of every supplier (shown when nothing is
  // selected and nothing is being created). Sorting is done per-column via
  // the grid's own column header menu, not a separate "Sort by" control.
  const supplierTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<SupplierRow>
          rows={supplierRows}
          columns={supplierColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectSupplierWithCheck(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No suppliers found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Purchasing", href: "/purchasing" },
          { label: "Suppliers", href: "/purchasing/suppliers" },
          ...(selectedSupplier || isCreating
            ? [{ label: isCreating ? "New Supplier" : selectedSupplier?.company_name || "" }]
            : []),
        ]}
        title={selectedSupplier ? selectedSupplier.company_name : ""}
        titleIcon={<BusinessIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Supplier"
        noSelectionTitle="Select a Supplier"
        tabsSlot={
          (selectedSupplier || isCreating) && (
            <TTabs
              tabs={SUPPLIER_DETAIL_TABS}
              activeTab={activeSection}
              onChange={(id) => setActiveSection(id as typeof activeSection)}
              showDivider={false}
            />
          )
        }
      />

      <ActionToolbar
        hasSelectedItem={!!selectedSupplier}
        isCreating={isCreating}
        isEditing={showToolbarSaveForSection}
        isSaving={isSaving}
        isFormValid={!!isFormValid}
        onNew={canCreateSupplier ? handleNewSupplier : undefined}
        onDuplicate={handleDuplicate}
        onSave={handleSave}
        onCancel={handleCancelSupplier}
        onEdit={canUpdateSupplier ? handleStartEdit : undefined}
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedSupplier && !isCreating ? (
          <EmptyState message="Select a supplier from the list or create a new one" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={3} fieldsPerSection={6} showHeader={false} showToolbar={false} />
        ) : (
          <>
          <TTabPanel value={activeSection} index="general" padding={0}>
            <FormSection title="Company Information" columns={3}>
              <TextField
                label="Company Name"
                size="small"
                value={formData.company_name}
                onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                onBlur={() => handleBlur('company_name')}
                disabled={!isEditing && !isCreating}
                required
                sx={requiredFieldSx}
                error={hasError('company_name')}
                helperText={getFieldError('company_name')}
              />
              <TextField
                label="Company Registration No."
                size="small"
                value={formData.company_registration_number}
                onChange={(e) => setFormData({ ...formData, company_registration_number: e.target.value })}
                disabled={!isEditing && !isCreating}
              />
              <TextField
                label="Tax/VAT Number"
                size="small"
                value={formData.tax_registration_number}
                onChange={(e) => setFormData({ ...formData, tax_registration_number: e.target.value })}
                disabled={!isEditing && !isCreating}
              />
              <TextField
                select
                label="Tax Area"
                size="small"
                value={formData.tax_area ?? ""}
                onChange={(e) => setFormData({ ...formData, tax_area: e.target.value || undefined })}
                disabled={!isEditing && !isCreating}
                SelectProps={{ displayEmpty: true }}
                InputLabelProps={{ shrink: true }}
              >
                <MenuItem value="">
                  <em>None</em>
                </MenuItem>
                {SUPPLIER_TAX_AREA.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Default Currency"
                size="small"
                value={formData.default_currency ?? ""}
                onChange={(e) => setFormData({ ...formData, default_currency: e.target.value || undefined })}
                disabled={!isEditing && !isCreating}
                SelectProps={{ displayEmpty: true }}
                InputLabelProps={{ shrink: true }}
              >
                <MenuItem value="">
                  <em>None</em>
                </MenuItem>
                {currencies.map((currency) => (
                  <MenuItem key={currency.code} value={currency.code}>
                    {currency.code} — {currency.name} ({currency.symbol})
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Company Website"
                size="small"
                value={formData.company_website}
                onChange={(e) => setFormData({ ...formData, company_website: e.target.value })}
                disabled={!isEditing && !isCreating}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.active}
                    onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                    disabled={!isEditing && !isCreating}
                  />
                }
                label="Active"
              />
              <Box sx={{ display: "flex", gap: 1 }}>
                <TextField
                  label="Lead Time"
                  size="small"
                  type="number"
                  value={
                    formData.lead_time_days != null
                      ? daysToUnit(formData.lead_time_days, leadTimeUnit)
                      : ""
                  }
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw.trim() === "") {
                      setFormData({ ...formData, lead_time_days: undefined });
                      return;
                    }
                    const parsed = Number(raw);
                    setFormData({
                      ...formData,
                      lead_time_days: Number.isFinite(parsed) ? unitToDays(Math.max(0, parsed), leadTimeUnit) : undefined,
                    });
                  }}
                  disabled={!isEditing && !isCreating}
                  inputProps={{ min: 0 }}
                  sx={{ flex: 1 }}
                />
                <TextField
                  select
                  size="small"
                  value={leadTimeUnit}
                  onChange={(e) => setLeadTimeUnit(e.target.value as LeadTimeUnit)}
                  disabled={!isEditing && !isCreating}
                  sx={{ width: 110, flexShrink: 0 }}
                >
                  {LEAD_TIME_UNIT_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Box>
              {selectedSupplier && !isCreating && (
                <TextField
                  label="Avg. Lead Time (computed)"
                  size="small"
                  value={
                    selectedSupplier.average_lead_time_days != null
                      ? `${selectedSupplier.average_lead_time_days} days`
                      : "No completed orders yet"
                  }
                  disabled
                  InputProps={{ readOnly: true }}
                  helperText="From actual delivery history — read-only"
                />
              )}
            </FormSection>

            <FormSection title="Contact Information" columns={3}>
              <TextField
                label="Email"
                size="small"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                onBlur={() => handleBlur('email')}
                disabled={!isEditing && !isCreating}
                required
                sx={requiredFieldSx}
                error={hasError('email')}
                helperText={getFieldError('email')}
              />
              <TextField
                label="Mobile Contact 1"
                size="small"
                value={formData.mobile_contact_number}
                onChange={(e) => setFormData({ ...formData, mobile_contact_number: e.target.value })}
                onBlur={() => handleBlur('mobile_contact_number')}
                disabled={!isEditing && !isCreating}
                required
                error={hasError('mobile_contact_number')}
                helperText={getFieldError('mobile_contact_number')}
              />
              <TextField
                label="Mobile Contact 2"
                size="small"
                value={formData.home_contact_number}
                onChange={(e) => setFormData({ ...formData, home_contact_number: e.target.value })}
                onBlur={() => handleBlur('home_contact_number')}
                disabled={!isEditing && !isCreating}
                error={hasError('home_contact_number')}
                helperText={getFieldError('home_contact_number')}
              />
            </FormSection>

            {(selectedSupplier || isCreating) && (
              <FormSection title="Logo" columns={1}>
                <SupplierLogoUploader
                  supplier={selectedSupplier && !isCreating ? selectedSupplier : undefined}
                  draftFile={draftLogoFile}
                  onDraftFileChange={setDraftLogoFile}
                  onUpdated={handleLogoUpdated}
                  disabled={!isEditing && !isCreating}
                />
              </FormSection>
            )}

            {selectedSupplier && !isEditing && !isCreating && (
              <FormSection
                title="Activity History"
                columns={2}
                titleAction={
                  <Tooltip title="View activity history">
                    <IconButton size="small" onClick={() => setActivityHistoryOpen(true)}>
                      <HistoryIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
              >
                <Box>
                  <Typography variant="caption" color="text.secondary">Created By</Typography>
                  <Typography variant="body2">
                    {selectedSupplier.created_by_name || "-"}
                    {selectedSupplier.created_at ? ` on ${formatDateTimeReadable(selectedSupplier.created_at)}` : ""}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Last Modified By</Typography>
                  <Typography variant="body2">
                    {selectedSupplier.updated_by_name || "-"}
                    {selectedSupplier.updated_at ? ` on ${formatDateTimeReadable(selectedSupplier.updated_at)}` : ""}
                  </Typography>
                </Box>
              </FormSection>
            )}
          </TTabPanel>

            <>
              <TTabPanel value={activeSection} index="address" padding={0} sx={{ pt: 2 }}>
                <FormSection title="Country" columns={2}>
                <TAutocomplete<CountryRef>
                  label="Country"
                  options={countries}
                  value={selectedCountry}
                  onChange={(value) =>
                    setFormData({ ...formData, country_id: (value as CountryRef | null)?.id })
                  }
                  getOptionLabel={(c) => c.name}
                  disabled={!isAddressEditable}
                />
              </FormSection>

              <FormSection title="Billing Address" columns={2}>
                <TextField
                  label="Address Line 1"
                  size="small"
                  value={formData.billing_address_line1}
                  onChange={(e) => setFormData({ ...formData, billing_address_line1: e.target.value })}
                  disabled={!isAddressEditable}
                />
                <TextField
                  label="Address Line 2"
                  size="small"
                  value={formData.billing_address_line2}
                  onChange={(e) => setFormData({ ...formData, billing_address_line2: e.target.value })}
                  disabled={!isAddressEditable}
                />
                <TextField
                  label="City"
                  size="small"
                  value={formData.billing_city}
                  onChange={(e) => setFormData({ ...formData, billing_city: e.target.value })}
                  disabled={!isAddressEditable}
                />
                <TextField
                  label="State / Province"
                  size="small"
                  value={formData.billing_state}
                  onChange={(e) => setFormData({ ...formData, billing_state: e.target.value })}
                  disabled={!isAddressEditable}
                />
                <TextField
                  label="Postal Code"
                  size="small"
                  value={formData.billing_postal_code}
                  onChange={(e) => setFormData({ ...formData, billing_postal_code: e.target.value })}
                  disabled={!isAddressEditable}
                />
              </FormSection>

              <FormSection title="Shipping Address" columns={2}>
                <FormControlLabel
                  sx={{ gridColumn: "span 2" }}
                  control={
                    <Switch
                      checked={shippingSameAsBilling}
                      disabled={!isAddressEditable}
                      onChange={(e) => {
                        const same = e.target.checked;
                        setShippingSameAsBilling(same);
                        if (same) {
                          setFormData({
                            ...formData,
                            shipping_address_line1: "",
                            shipping_address_line2: "",
                            shipping_city: "",
                            shipping_state: "",
                            shipping_postal_code: "",
                          });
                        }
                      }}
                    />
                  }
                  label="Same as billing address"
                />
                {!shippingSameAsBilling && (
                  <>
                    <TextField
                      label="Address Line 1"
                      size="small"
                      value={formData.shipping_address_line1}
                      onChange={(e) => setFormData({ ...formData, shipping_address_line1: e.target.value })}
                      disabled={!isAddressEditable}
                    />
                    <TextField
                      label="Address Line 2"
                      size="small"
                      value={formData.shipping_address_line2}
                      onChange={(e) => setFormData({ ...formData, shipping_address_line2: e.target.value })}
                      disabled={!isAddressEditable}
                    />
                    <TextField
                      label="City"
                      size="small"
                      value={formData.shipping_city}
                      onChange={(e) => setFormData({ ...formData, shipping_city: e.target.value })}
                      disabled={!isAddressEditable}
                    />
                    <TextField
                      label="State / Province"
                      size="small"
                      value={formData.shipping_state}
                      onChange={(e) => setFormData({ ...formData, shipping_state: e.target.value })}
                      disabled={!isAddressEditable}
                    />
                    <TextField
                      label="Postal Code"
                      size="small"
                      value={formData.shipping_postal_code}
                      onChange={(e) => setFormData({ ...formData, shipping_postal_code: e.target.value })}
                      disabled={!isAddressEditable}
                    />
                  </>
                )}
              </FormSection>
              </TTabPanel>

              <TTabPanel value={activeSection} index="contactPerson" padding={0} sx={{ pt: 2 }}>
                <FormSection title="Contact Persons" columns={1}>
                  {!selectedSupplier && (
                    <Alert severity="info" sx={{ mb: 1.5 }}>
                      Contact persons added here will be saved together with the supplier.
                    </Alert>
                  )}
                  {(canUpdateSupplier || isContactPersonEditable) && (
                    <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1.5 }}>
                      <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={handleOpenAddContactPerson}>
                        Add Contact Person
                      </Button>
                    </Box>
                  )}
                  {displayedContactPersons.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No contact persons added yet.
                    </Typography>
                  ) : (
                    <TDataGrid
                      rows={displayedContactPersons}
                      columns={contactPersonColumns}
                      onRowClick={(row) => handleViewContactPerson(row)}
                      autoHeight
                      density="standard"
                      pageSizeOptions={[10, 25, 50]}
                      pageSize={10}
                    />
                  )}
                </FormSection>
              </TTabPanel>

              <TTabPanel value={activeSection} index="payment" padding={0} sx={{ pt: 2 }}>
              <FormSection title="Payment" columns={3}>
              <TextField
                select
                label="Payment Terms"
                size="small"
                value={
                  !paymentTermsChosen
                    ? ""
                    : paymentTermsCustom ||
                      !SUPPLIER_PAYMENT_TERMS.some((t) => t.value === formData.credit_days)
                      ? SUPPLIER_PAYMENT_TERMS_CUSTOM
                      : formData.credit_days
                }
                onChange={(e) => {
                  setPaymentTermsChosen(true);
                  if (e.target.value === SUPPLIER_PAYMENT_TERMS_CUSTOM) {
                    setPaymentTermsCustom(true);
                    return;
                  }
                  setPaymentTermsCustom(false);
                  setFormData({ ...formData, credit_days: Number(e.target.value) });
                }}
                onBlur={() => handleBlur('credit_days')}
                disabled={!isPaymentMethodsEditable}
                required
                sx={requiredFieldSx}
                error={hasError('credit_days')}
                helperText={getFieldError('credit_days') || "How many days after invoicing this supplier expects payment"}
                SelectProps={{ displayEmpty: true }}
                InputLabelProps={{ shrink: true }}
              >
                <MenuItem value="" disabled>
                  Select payment terms
                </MenuItem>
                {SUPPLIER_PAYMENT_TERMS.map((term) => (
                  <MenuItem key={term.value} value={term.value}>
                    {term.label}
                  </MenuItem>
                ))}
                <MenuItem value={SUPPLIER_PAYMENT_TERMS_CUSTOM}>Custom</MenuItem>
              </TextField>
              {(paymentTermsCustom ||
                !SUPPLIER_PAYMENT_TERMS.some((t) => t.value === formData.credit_days)) && (
                <TextField
                  label="Custom Payment Terms (days)"
                  size="small"
                  type="number"
                  value={formData.credit_days}
                  onChange={(e) => setFormData({ ...formData, credit_days: parseInt(e.target.value) || 0 })}
                  onBlur={() => handleBlur('credit_days')}
                  disabled={!isPaymentMethodsEditable}
                  required
                  sx={requiredFieldSx}
                  error={hasError('credit_days')}
                  helperText={getFieldError('credit_days')}
                  inputProps={{ min: 0 }}
                />
              )}
              <TextField
                label="Max Credit Limit"
                size="small"
                type="number"
                value={formData.max_credit_limit}
                onChange={(e) => setFormData({ ...formData, max_credit_limit: parseInt(e.target.value) || 0 })}
                onBlur={() => handleBlur('max_credit_limit')}
                disabled={!isPaymentMethodsEditable}
                required
                sx={requiredFieldSx}
                error={hasError('max_credit_limit')}
                helperText={getFieldError('max_credit_limit')}
                inputProps={{ min: 0 }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">{currencySymbol}</InputAdornment>
                  ),
                }}
              />
              {selectedSupplier && !isCreating && (
                <>
                  <TextField
                    label="Initial Credit Amount"
                    size="small"
                    type="number"
                    value={selectedSupplier.initial_credit_amount || 0}
                    disabled
                    InputProps={{
                      readOnly: true,
                      startAdornment: (
                        <InputAdornment position="start">{currencySymbol}</InputAdornment>
                      ),
                    }}
                  />
                  <TextField
                    label="Left Credit Amount"
                    size="small"
                    type="number"
                    value={selectedSupplier.left_credit_amount || 0}
                    disabled
                    InputProps={{
                      readOnly: true,
                      startAdornment: (
                        <InputAdornment position="start">{currencySymbol}</InputAdornment>
                      ),
                    }}
                  />
                </>
              )}
            </FormSection>

            <FormSection title="Payment Methods" columns={1}>
              {!selectedSupplier && (
                <Alert severity="info" sx={{ mb: 1.5 }}>
                  Payment methods added here will be saved together with the supplier.
                </Alert>
              )}
              {(canUpdateSupplier || isPaymentMethodsEditable) && (
                <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1.5 }}>
                  <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={handleOpenAddPaymentMethod}>
                    Add Payment Method
                  </Button>
                </Box>
              )}
              {displayedPaymentMethods.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No payment methods saved yet.
                </Typography>
              ) : (
                <TDataGrid
                  rows={displayedPaymentMethods}
                  columns={paymentMethodColumns}
                  onRowClick={(row) => handleViewPaymentMethod(row)}
                  autoHeight
                  density="standard"
                  pageSizeOptions={[10, 25, 50]}
                  pageSize={10}
                />
              )}
            </FormSection>
              </TTabPanel>
            </>
          </>
        )}
      </Box>
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title="Suppliers"
        titleSlot={
          isSupplierDetailMode ? (
            <Button
              size="small"
              startIcon={<ArrowBackIcon fontSize="small" />}
              onClick={handleBackToSuppliers}
              sx={{ textTransform: "none" }}
            >
              Back to Suppliers
            </Button>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search suppliers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                }}
                sx={{ width: 190, flexShrink: 0, "& .MuiOutlinedInput-root": { borderRadius: "24px" } }}
              />
              <Box sx={{ width: 150, flexShrink: 0 }}>
                <TStatusFilter
                  options={SUPPLIER_STATUS_OPTIONS}
                  value={filterStatus}
                  onChange={setFilterStatus}
                  label=""
                  placeholder="All Status"
                  size="small"
                />
              </Box>
              <Box sx={{ width: 170, flexShrink: 0 }}>
                <TAutocomplete<CountryRef>
                  label=""
                  placeholder="All Countries"
                  options={countries}
                  value={countries.find((c) => c.id === filterCountryId) || null}
                  onChange={(value) => setFilterCountryId((value as CountryRef | null)?.id ?? null)}
                  getOptionLabel={(c) => c.name}
                  size="small"
                />
              </Box>
              {(searchQuery || filterStatus || filterCountryId !== null) && (
                <Button size="small" onClick={handleClearFilters} sx={{ textTransform: "none" }}>
                  Clear
                </Button>
              )}
            </Box>
          )
        }
        headerActions={
          isSupplierDetailMode ? undefined : (
            <>
              {canCreateSupplier && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={handleNewSupplier}
                  sx={{ mr: 1 }}
                >
                  Add Supplier
                </Button>
              )}
            </>
          )
        }
        onRefresh={refetch}
        isLoading={isLoading}
        {...(isSupplierDetailMode
          ? { children: detailPanel }
          : { children: supplierTablePanel })}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />

      <TSidePanel
        open={paymentMethodPanelMode !== null}
        onClose={handleClosePaymentMethodPanel}
        title={
          paymentMethodPanelMode === "view"
            ? "Payment Method Details"
            : paymentMethodPanelMode === "edit"
              ? "Edit Payment Method"
              : "Add Payment Method"
        }
        onSubmit={paymentMethodPanelMode === "view" ? undefined : handleSavePaymentMethod}
        isSubmitting={savingPaymentMethod}
        extraActions={
          paymentMethodPanelMode === "view" && (canUpdateSupplier || isPaymentMethodsEditable) ? (
            <TButton
              variant="secondary"
              onClick={() => activePaymentMethod && handleOpenEditPaymentMethod(activePaymentMethod)}
            >
              Edit
            </TButton>
          ) : undefined
        }
      >
        <TFormSection title="Payment Method" variant="plain" columns={2}>
          <TextField
            select
            label="Type"
            size="small"
            value={paymentMethodForm.method_type}
            disabled={paymentMethodPanelMode === "view"}
            onChange={(e) =>
              setPaymentMethodForm({ ...paymentMethodForm, method_type: e.target.value as SupplierPaymentAccountType })
            }
          >
            {SUPPLIER_SAVED_PAYMENT_METHOD_TYPE.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            sx={{ alignSelf: "center" }}
            control={
              <Switch
                checked={!!paymentMethodForm.is_default}
                disabled={paymentMethodPanelMode === "view"}
                onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, is_default: e.target.checked })}
              />
            }
            label="Set as default"
          />
        </TFormSection>
        {["bank_transfer", "cheque", "direct_debit"].includes(paymentMethodForm.method_type) && (
          <TFormSection title="Account Details" variant="plain" columns={2}>
            <TextField
              label="Account Name"
              size="small"
              value={paymentMethodForm.account_holder_name}
              disabled={paymentMethodPanelMode === "view"}
              onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, account_holder_name: e.target.value })}
            />
            <TextField
              label="Bank Name"
              size="small"
              value={paymentMethodForm.bank_name}
              disabled={paymentMethodPanelMode === "view"}
              onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, bank_name: e.target.value })}
            />
            <TextField
              label="Account Number"
              size="small"
              value={paymentMethodForm.account_number}
              disabled={paymentMethodPanelMode === "view"}
              onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, account_number: e.target.value })}
            />
          </TFormSection>
        )}
        {(paymentMethodForm.method_type === "bank_transfer" || paymentMethodForm.method_type === "direct_debit") && (
          <TFormSection title="Wire Details" variant="plain" columns={2}>
            <TextField
              label="Branch"
              size="small"
              value={paymentMethodForm.branch}
              disabled={paymentMethodPanelMode === "view"}
              onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, branch: e.target.value })}
            />
            <TextField
              label="Branch Code"
              size="small"
              value={paymentMethodForm.bank_branch_code}
              disabled={paymentMethodPanelMode === "view"}
              onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, bank_branch_code: e.target.value })}
            />
            <TextField
              label="Swift Code"
              size="small"
              value={paymentMethodForm.swift_code}
              disabled={paymentMethodPanelMode === "view"}
              onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, swift_code: e.target.value })}
            />
          </TFormSection>
        )}
        {paymentMethodForm.method_type === "bank_transfer" && (
          <TFormSection title="Correspondent Bank" variant="plain" columns={2}>
            <TextField
              label="Bank Name"
              size="small"
              placeholder="e.g. Citibank"
              value={paymentMethodForm.correspondent_bank_name}
              disabled={paymentMethodPanelMode === "view"}
              onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, correspondent_bank_name: e.target.value })}
            />
            <TextField
              label="Swift Code"
              size="small"
              value={paymentMethodForm.correspondent_bank_swift_code}
              disabled={paymentMethodPanelMode === "view"}
              onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, correspondent_bank_swift_code: e.target.value })}
            />
          </TFormSection>
        )}
        {paymentMethodForm.method_type === "direct_debit" && (
          <TFormSection title="Mandate Details" variant="plain" columns={2}>
            <TextField
              label="Mandate Reference"
              size="small"
              value={paymentMethodForm.mandate_reference}
              disabled={paymentMethodPanelMode === "view"}
              onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, mandate_reference: e.target.value })}
            />
            <TextField
              label="Mandate / Authorization Date"
              type="date"
              size="small"
              value={paymentMethodForm.mandate_date}
              disabled={paymentMethodPanelMode === "view"}
              onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, mandate_date: e.target.value })}
              InputLabelProps={{ shrink: true }}
            />
          </TFormSection>
        )}
        {paymentMethodForm.method_type === "letter_of_credit" && (
          <>
            <TFormSection title="Letter of Credit" variant="plain" columns={2}>
              <TextField
                label="LC Number"
                size="small"
                value={paymentMethodForm.lc_number}
                disabled={paymentMethodPanelMode === "view"}
                onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, lc_number: e.target.value })}
              />
              <TextField
                select
                label="LC Type"
                size="small"
                value={paymentMethodForm.lc_type || ""}
                disabled={paymentMethodPanelMode === "view"}
                onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, lc_type: e.target.value })}
                SelectProps={{ displayEmpty: true }}
                InputLabelProps={{ shrink: true }}
              >
                <MenuItem value="">
                  <em>None</em>
                </MenuItem>
                {SUPPLIER_LC_TYPE.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Issuing Bank"
                size="small"
                value={paymentMethodForm.issuing_bank_name}
                disabled={paymentMethodPanelMode === "view"}
                onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, issuing_bank_name: e.target.value })}
              />
              <TextField
                label="Advising Bank"
                size="small"
                value={paymentMethodForm.advising_bank_name}
                disabled={paymentMethodPanelMode === "view"}
                onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, advising_bank_name: e.target.value })}
              />
              <TextField
                label="LC Amount"
                type="number"
                size="small"
                value={paymentMethodForm.lc_amount ?? ""}
                disabled={paymentMethodPanelMode === "view"}
                onChange={(e) =>
                  setPaymentMethodForm({
                    ...paymentMethodForm,
                    lc_amount: e.target.value ? parseFloat(e.target.value) : undefined,
                  })
                }
                inputProps={{ min: 0 }}
              />
              <TextField
                label="LC Currency"
                size="small"
                placeholder="e.g. USD"
                value={paymentMethodForm.lc_currency}
                disabled={paymentMethodPanelMode === "view"}
                onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, lc_currency: e.target.value.toUpperCase() })}
                inputProps={{ maxLength: 3 }}
              />
            </TFormSection>
            <TFormSection title="LC Dates" variant="plain" columns={2}>
              <TextField
                label="Issue Date"
                type="date"
                size="small"
                value={paymentMethodForm.lc_issue_date}
                disabled={paymentMethodPanelMode === "view"}
                onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, lc_issue_date: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="Expiry Date"
                type="date"
                size="small"
                value={paymentMethodForm.lc_expiry_date}
                disabled={paymentMethodPanelMode === "view"}
                onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, lc_expiry_date: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="Latest Shipment Date"
                type="date"
                size="small"
                value={paymentMethodForm.latest_shipment_date}
                disabled={paymentMethodPanelMode === "view"}
                onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, latest_shipment_date: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </TFormSection>
          </>
        )}
        {paymentMethodForm.method_type === "credit_card" && (
          <TFormSection title="Card Details" variant="plain" columns={2}>
            <TextField
              select
              label="Card Type"
              size="small"
              value={paymentMethodForm.card_type || ""}
              disabled={paymentMethodPanelMode === "view"}
              onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, card_type: e.target.value })}
              SelectProps={{ displayEmpty: true }}
              InputLabelProps={{ shrink: true }}
            >
              <MenuItem value="">
                <em>None</em>
              </MenuItem>
              {SUPPLIER_PAYMENT_CARD_TYPE.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Cardholder Name"
              size="small"
              value={paymentMethodForm.cardholder_name}
              disabled={paymentMethodPanelMode === "view"}
              onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, cardholder_name: e.target.value })}
            />
            <TextField
              label="Card Number (last 4 digits)"
              size="small"
              placeholder="1234"
              value={paymentMethodForm.card_last4}
              disabled={paymentMethodPanelMode === "view"}
              onChange={(e) =>
                setPaymentMethodForm({
                  ...paymentMethodForm,
                  card_last4: e.target.value.replace(/\D/g, "").slice(0, 4),
                })
              }
              inputProps={{ maxLength: 4, inputMode: "numeric" }}
              helperText={paymentMethodPanelMode === "view" ? undefined : "Only the last 4 digits are stored — never the full card number"}
            />
            <TextField
              label="Expiry (MM/YYYY)"
              size="small"
              placeholder="12/2027"
              value={paymentMethodForm.card_expiry}
              disabled={paymentMethodPanelMode === "view"}
              onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, card_expiry: e.target.value })}
              inputProps={{ maxLength: 7 }}
            />
          </TFormSection>
        )}
        {paymentMethodForm.method_type === "digital_wallet" && (
          <TFormSection title="Wallet Details" variant="plain" columns={2}>
            <TextField
              select
              label="Provider"
              size="small"
              value={paymentMethodForm.wallet_provider || ""}
              disabled={paymentMethodPanelMode === "view"}
              onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, wallet_provider: e.target.value })}
              SelectProps={{ displayEmpty: true }}
              InputLabelProps={{ shrink: true }}
            >
              <MenuItem value="">
                <em>None</em>
              </MenuItem>
              {SUPPLIER_WALLET_PROVIDER.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Wallet ID / Email"
              size="small"
              value={paymentMethodForm.wallet_id}
              disabled={paymentMethodPanelMode === "view"}
              onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, wallet_id: e.target.value })}
            />
          </TFormSection>
        )}
      </TSidePanel>

      <TSidePanel
        open={contactPersonPanelMode !== null}
        onClose={handleCloseContactPersonPanel}
        title={
          contactPersonPanelMode === "view"
            ? "Contact Person Details"
            : contactPersonPanelMode === "edit"
              ? "Edit Contact Person"
              : "Add Contact Person"
        }
        onSubmit={contactPersonPanelMode === "view" ? undefined : handleSaveContactPerson}
        isSubmitting={savingContactPerson}
        submitDisabled={
          !contactPersonForm.full_name ||
          (!!contactPersonForm.birthdate && contactPersonForm.birthdate > TODAY_DATE_STRING)
        }
        extraActions={
          contactPersonPanelMode === "view" && (canUpdateSupplier || isContactPersonEditable) ? (
            <TButton
              variant="secondary"
              onClick={() => activeContactPerson && handleOpenEditContactPerson(activeContactPerson)}
            >
              Edit
            </TButton>
          ) : undefined
        }
      >
        <TFormSection title="Contact" variant="plain" columns={2}>
          <TextField
            select
            label="Title"
            size="small"
            value={contactPersonForm.title}
            disabled={contactPersonPanelMode === "view"}
            onChange={(e) => setContactPersonForm({ ...contactPersonForm, title: e.target.value })}
          >
            {TITLE_CHOICES.map((t) => (
              <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            label="Full Name"
            size="small"
            value={contactPersonForm.full_name}
            disabled={contactPersonPanelMode === "view"}
            onChange={(e) => setContactPersonForm({ ...contactPersonForm, full_name: e.target.value })}
            required
          />
          <TextField
            label="Occupation"
            size="small"
            value={contactPersonForm.occupation}
            disabled={contactPersonPanelMode === "view"}
            onChange={(e) => setContactPersonForm({ ...contactPersonForm, occupation: e.target.value })}
          />
          <TextField
            select
            label="Gender"
            size="small"
            value={contactPersonForm.gender}
            disabled={contactPersonPanelMode === "view"}
            onChange={(e) => setContactPersonForm({ ...contactPersonForm, gender: e.target.value })}
          >
            {GENDER_CHOICES.map((g) => (
              <MenuItem key={g.value} value={g.value}>{g.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            label="Birthdate"
            type="date"
            size="small"
            value={contactPersonForm.birthdate}
            disabled={contactPersonPanelMode === "view"}
            onChange={(e) => setContactPersonForm({ ...contactPersonForm, birthdate: e.target.value })}
            InputLabelProps={{ shrink: true }}
            inputProps={{ max: TODAY_DATE_STRING }}
            error={!!contactPersonForm.birthdate && contactPersonForm.birthdate > TODAY_DATE_STRING}
            helperText={
              contactPersonForm.birthdate && contactPersonForm.birthdate > TODAY_DATE_STRING
                ? "Birthdate cannot be a future date"
                : undefined
            }
          />
          <TextField
            label="ID Card Number"
            size="small"
            value={contactPersonForm.id_card_number}
            disabled={contactPersonPanelMode === "view"}
            onChange={(e) => setContactPersonForm({ ...contactPersonForm, id_card_number: e.target.value })}
          />
          <TextField
            label="Passport No."
            size="small"
            value={contactPersonForm.passport_no}
            disabled={contactPersonPanelMode === "view"}
            onChange={(e) => setContactPersonForm({ ...contactPersonForm, passport_no: e.target.value })}
          />
        </TFormSection>
        <TFormSection title="Communication Methods" variant="plain" columns={2}>
          <TextField
            label="Email"
            type="email"
            size="small"
            value={contactPersonForm.email}
            disabled={contactPersonPanelMode === "view"}
            onChange={(e) => setContactPersonForm({ ...contactPersonForm, email: e.target.value })}
          />
          <TextField
            label="Phone"
            size="small"
            value={contactPersonForm.phone}
            disabled={contactPersonPanelMode === "view"}
            onChange={(e) => setContactPersonForm({ ...contactPersonForm, phone: e.target.value })}
          />
        </TFormSection>
      </TSidePanel>

      <TActivityHistoryPanel
        open={activityHistoryOpen}
        onClose={() => setActivityHistoryOpen(false)}
        entityType="supplier"
        entityId={selectedSupplier?.id}
        actionLabels={ACTIVITY_ACTION_LABELS}
      />
    </>
  );
}
