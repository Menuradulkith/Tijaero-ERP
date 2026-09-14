/**
 * SuppliersPage - Using Tijaero-style reusable components
 */

import { useMemo, useCallback, useEffect, useState, type ReactNode } from "react";
import { formatDateTimeReadable } from "@/utils/formatters";
import { exportToCSV } from "@/utils/csvExport";
import DownloadIcon from "@mui/icons-material/FileDownload";
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
  Chip,
  Paper,
  IconButton,
  Alert,
  Avatar,
  Tooltip,
} from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import BusinessIcon from "@mui/icons-material/Business";
import LocationOnOutlinedIcon from "@mui/icons-material/LocationOnOutlined";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import AccountBalanceWalletOutlinedIcon from "@mui/icons-material/AccountBalanceWalletOutlined";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import LocalAtmIcon from "@mui/icons-material/LocalAtm";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import HistoryIcon from "@mui/icons-material/History";
import { useAuthStore } from "@/state/authStore";
import { hasPermission, PERMISSIONS } from "@/auth/permissions";
import { useReferenceData, type CountryRef } from "@/hooks/useReferenceData";
// ConfirmDialog now uses TConfirmDialog from tijaero

import {
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  DetailPanelHeader,
  ActionToolbar,
  FormSection,
  EmptyState,
  useMasterDetailState,
  showErrorToast,
  showSuccessToast,
  SortOption,
  TConfirmDialog,
  TDetailSkeleton,
  TStatusFilter,
  TTabFilterBar,
  TSectionNav,
  type TSectionNavItem,
  TITLE_CHOICES,
  GENDER_CHOICES,
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

const SORT_OPTIONS: SortOption[] = [
  { value: "company_name", label: "Company Name" },
  { value: "country_id", label: "Country" },
  { value: "created_at", label: "Creation Date" },
];

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
};

const PAYMENT_METHOD_TYPE_ICONS: Record<SupplierPaymentAccountType, ReactNode> = {
  bank_transfer: <AccountBalanceIcon fontSize="small" color="action" />,
  cash: <LocalAtmIcon fontSize="small" color="action" />,
  cheque: <ReceiptLongIcon fontSize="small" color="action" />,
};

const INITIAL_PAYMENT_METHOD_FORM: SupplierPaymentAccountCreate = {
  method_type: "bank_transfer",
  bank_name: "",
  account_number: "",
  account_holder_name: "",
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

const SUPPLIER_SECTION_NAV_ITEMS: TSectionNavItem[] = [
  { key: "address", label: "Address", icon: <LocationOnOutlinedIcon fontSize="small" /> },
  { key: "contactPerson", label: "Contact Person", icon: <PersonOutlineIcon fontSize="small" /> },
  { key: "payment", label: "Payment", icon: <AccountBalanceWalletOutlinedIcon fontSize="small" /> },
];

const INITIAL_FORM_DATA: SupplierCreate = {
  company_name: "",
  company_registration_number: "",
  tax_registration_number: "",
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
  max_credit_limit: 100000,
  active: true,
  country_id: undefined,
};

const resetFormFromSupplier = (supplier: Supplier): SupplierCreate => ({
  company_name: supplier.company_name || "",
  company_registration_number: supplier.company_registration_number || "",
  tax_registration_number: supplier.tax_registration_number || "",
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
});

export default function SuppliersPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

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
  const canDeleteSupplier = hasPermission(
    user,
    PERMISSIONS.SUPPLIERS_DELETE.resource,
    PERMISSIONS.SUPPLIERS_DELETE.action,
  );

  // Confirm dialog for unsaved changes and delete actions
  const confirmDialog = useTConfirmDialog();

  // Filter state (applied - drives the actual list filtering)
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterCountryId, setFilterCountryId] = useState<number | null>(null);

  // Filter state (draft - edited via the filter bar, only applied on Search click)
  const [draftSupplierQuery, setDraftSupplierQuery] = useState("");
  const [draftStatus, setDraftStatus] = useState<string | null>(null);
  const [draftCountry, setDraftCountry] = useState<CountryRef | null>(null);

  const handleApplyFilters = useCallback(() => {
    setSearchQuery(draftSupplierQuery);
    setFilterStatus(draftStatus);
    setFilterCountryId(draftCountry?.id ?? null);
  }, [draftSupplierQuery, draftStatus, draftCountry]);

  const handleClearFilters = useCallback(() => {
    setDraftSupplierQuery("");
    setDraftStatus(null);
    setDraftCountry(null);
    setSearchQuery("");
    setFilterStatus(null);
    setFilterCountryId(null);
  }, []);

  // Validation state - track which fields have been touched/blurred
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Mark field as touched when user leaves it
  const handleBlur = (fieldName: string) => {
    setTouched(prev => ({ ...prev, [fieldName]: true }));
  };

  // Detail panel section navigation (Address / Contact Person / Payment).
  // null = no section selected, showing the default "Main" content (Company + Contact + Record Info).
  const [activeSection, setActiveSection] = useState<"address" | "contactPerson" | "payment" | null>(null);
  const handleSectionNavChange = useCallback((key: string) => {
    setActiveSection((prev) => (prev === key ? null : (key as "address" | "contactPerson" | "payment")));
  }, []);

  // "Same as billing" toggle for shipping address — checked whenever the
  // shipping fields are currently empty or already mirror billing, so it
  // defaults to on for a brand-new supplier without fighting existing data.
  const [shippingSameAsBilling, setShippingSameAsBilling] = useState(true);

  const { data: countryRefData } = useReferenceData(["countries"]);
  const countries: CountryRef[] = countryRefData?.countries || [];

  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem: selectedSupplier,
    setSelectedItem: setSelectedSupplier,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    favorites,
    toggleFavorite,
    formData,
    setFormData,
    handleSelectItem: handleSelectSupplier,
    handleNew: handleNewSupplier,
    handleCancel,
    handleStartEdit,
  } = useMasterDetailState<Supplier, SupplierCreate>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromSupplier,
    favoritesKey: "suppliers_favorites",
    defaultSortField: "company_name",
    confirmUnsavedChanges: () => confirmDialog.confirm({
      title: "Discard Changes",
      message: "You have unsaved changes. Discard them?",
      confirmText: "Discard",
      cancelText: "Keep Editing",
      confirmColor: "warning",
    }),
  });

  const selectedCountry = countries.find((c) => c.id === formData.country_id) || null;

  // Reset the detail panel back to "Main" (no section selected) whenever a
  // different supplier is selected or a new one is started — but not when
  // just toggling Edit/Cancel on the same record, so the user isn't yanked
  // away from what they're reviewing.
  useEffect(() => {
    setActiveSection(null);
  }, [selectedSupplier?.id, isCreating]);

  // Reflect whether this supplier's shipping address was actually left
  // blank (mirroring billing) or explicitly filled in with its own values.
  useEffect(() => {
    if (selectedSupplier) {
      setShippingSameAsBilling(!selectedSupplier.shipping_address_line1);
    } else if (isCreating) {
      setShippingSameAsBilling(true);
    }
  }, [selectedSupplier, isCreating]);

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
      setPaymentMethods(methods);
    } catch {
      setPaymentMethods([]);
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
    } catch {
      showErrorToast("Failed to save payment method");
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
      { field: "account_holder_name", header: "Account Holder", flex: 1, minWidth: 150 },
      {
        field: "is_default",
        header: "Default",
        width: 100,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<SupplierPaymentAccount>) =>
          params.row.is_default ? (
            <Chip label="Default" size="small" color="primary" sx={{ height: 20, fontSize: "0.65rem" }} />
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
          canUpdateSupplier ? (
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
    [canUpdateSupplier] // eslint-disable-line react-hooks/exhaustive-deps
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
      setContactPersons(contacts);
    } catch {
      setContactPersons([]);
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
          canUpdateSupplier ? (
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
    [canUpdateSupplier] // eslint-disable-line react-hooks/exhaustive-deps
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

    filtered.sort((a, b) => {
      if (sortField === "country_id") {
        const countryA = countries.find((c) => c.id === a.country_id)?.name || "";
        const countryB = countries.find((c) => c.id === b.country_id)?.name || "";
        return countryA.localeCompare(countryB);
      }
      if (sortField === "created_at") {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateA - dateB;
      }
      const fieldA = a[sortField as keyof Supplier] || "";
      const fieldB = b[sortField as keyof Supplier] || "";
      return String(fieldA).localeCompare(String(fieldB));
    });

    return filtered;
  }, [suppliers, searchQuery, sortField, filterStatus, filterCountryId, countries]);

  // Auto-select first item when data loads
  useEffect(() => {
    if (filteredSuppliers.length > 0 && !selectedSupplier && !isCreating) {
      handleSelectSupplier(filteredSuppliers[0]);
    }
  }, [filteredSuppliers, selectedSupplier, isCreating]);

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
      const failedCount =
        contactResults.filter((r) => r.status === "rejected").length +
        paymentResults.filter((r) => r.status === "rejected").length +
        (logoFailed ? 1 : 0);
      if (failedCount > 0) {
        showErrorToast(`Supplier saved, but ${failedCount} draft item(s) failed to save`);
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
      setTimeout(() => handleSelectSupplier(freshSupplier), 0);
    },
  });

  const updateMutation = useCrudMutation({
    mutationFn: ({ id, data }: { id: number; data: SupplierUpdate }) =>
      suppliersApi.update(id, data),
    invalidateQueryKeys: [["suppliers"], ["referenceData"], ["supplierActivityLog"]],
    successMessage: "Supplier updated successfully",
    errorMessage: "Failed to update supplier",
    onSuccess: () => {
      setIsEditing(false);
    },
    onError: async (error) => {
      // 409 = someone else changed this supplier since it was loaded (see
      // expected_updated_at / SupplierService.update_supplier). The global
      // axios interceptor already toasts the server's message; here we just
      // pull the current record so the user isn't stuck editing stale data.
      if (axios.isAxiosError(error) && error.response?.status === 409 && selectedSupplier) {
        try {
          const fresh = await suppliersApi.getById(selectedSupplier.id);
          queryClient.setQueryData<Supplier[]>(["suppliers"], (prev) =>
            prev ? prev.map((s) => (s.id === fresh.id ? fresh : s)) : prev
          );
          setSelectedSupplier(fresh);
          setFormData(resetFormFromSupplier(fresh));
          setIsEditing(false);
        } catch {
          // Refresh failed too — the error toast from the 409 already told
          // the user what happened; nothing more useful to do here.
        }
      }
    },
  });

  const deleteMutation = useCrudMutation({
    mutationFn: suppliersApi.delete,
    invalidateQueryKeys: [["suppliers"], ["referenceData"]],
    successMessage: "Supplier deleted successfully",
    errorMessage: "Failed to delete supplier",
    onSuccess: () => {
      setSelectedSupplier(null);
    },
  });

  const handleExportCSV = () => {
    const headers = [
      "Company Name",
      "Company Registration No.",
      "Tax/VAT Number",
      "Company Website",
      "Billing Address",
      "Shipping Address",
      "Country",
      "Email",
      "Mobile Contact",
      "Home Contact",
      "Credit Days",
      "Max Credit Limit",
      "Initial Credit Amount",
      "Left Credit Amount",
      "Avg. Lead Time (Days)",
      "Date Joined",
      "Status"
    ];

    const rows = filteredSuppliers.map(supplier => [
      supplier.company_name || "",
      supplier.company_registration_number || "",
      supplier.tax_registration_number || "",
      supplier.company_website || "",
      [supplier.billing_address_line1, supplier.billing_address_line2, supplier.billing_city, supplier.billing_state, supplier.billing_postal_code].filter(Boolean).join(", "),
      [supplier.shipping_address_line1, supplier.shipping_address_line2, supplier.shipping_city, supplier.shipping_state, supplier.shipping_postal_code].filter(Boolean).join(", "),
      countries.find((c) => c.id === supplier.country_id)?.name || "",
      supplier.email || "",
      supplier.mobile_contact_number || "",
      supplier.home_contact_number || "",
      supplier.credit_days,
      supplier.max_credit_limit,
      supplier.initial_credit_amount || 0,
      supplier.left_credit_amount || 0,
      supplier.average_lead_time_days ?? "",
      supplier.date_joined ? new Date(supplier.date_joined).toLocaleDateString() : "",
      supplier.active ? "Active" : "Inactive"
    ]);

    exportToCSV({
      filename: `suppliers_${new Date().toISOString().split("T")[0]}`,
      headers,
      rows
    });
  };

  const handleSave = useCallback(() => {
    if (isCreating) {
      if (!canCreateSupplier) {
        showErrorToast("You don't have permission to create suppliers");
        return;
      }
      createMutation.mutate(formData);
    } else if (selectedSupplier) {
      if (!canUpdateSupplier) {
        showErrorToast("You don't have permission to update suppliers");
        return;
      }
      updateMutation.mutate({
        id: selectedSupplier.id,
        data: { ...formData, expected_updated_at: selectedSupplier.updated_at },
      });
    }
  }, [
    isCreating,
    selectedSupplier,
    formData,
    createMutation,
    updateMutation,
    canCreateSupplier,
    canUpdateSupplier,
  ]);

  // Internal selection handler - wraps hook's handler to reset validation state
  const handleSelectSupplierWithCheck = useCallback(async (supplier: Supplier) => {
    await handleSelectSupplier(supplier);
    setTouched({}); // Reset validation state
  }, [handleSelectSupplier]);

  const handleDelete = useCallback(async () => {
    if (!canDeleteSupplier) {
      showErrorToast("You don't have permission to delete suppliers");
      return;
    }
    if (selectedSupplier) {
      const confirmed = await confirmDialog.confirm({
        title: "Delete Supplier",
        message: `Are you sure you want to delete "${selectedSupplier.company_name}"?`,
        confirmText: "Delete",
        confirmColor: "error",
      });
      if (confirmed) {
        deleteMutation.mutate(selectedSupplier.id);
      }
    }
  }, [selectedSupplier, deleteMutation, confirmDialog, canDeleteSupplier]);

  const handleDuplicate = useCallback(() => {
    if (selectedSupplier) {
      setFormData({
        ...formData,
        company_name: `${selectedSupplier.company_name} (Copy)`,
      });
      handleNewSupplier();
      setTouched({}); // Reset validation state
    }
  }, [selectedSupplier, formData, setFormData, handleNewSupplier]);

  // Email validation regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // Phone validation regex (allows digits, spaces, dashes, parentheses, plus)
  const phoneRegex = /^[\d\s\-\(\)\+]+$/;

  // Validation error messages
  const getFieldError = (fieldName: string): string | undefined => {
    if (!touched[fieldName] && !isCreating) return undefined;
    
    switch (fieldName) {
      case 'email':
        if (formData.email && !emailRegex.test(formData.email)) return 'Invalid email format';
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
      case 'billing_address_line1':
        if (!formData.billing_address_line1) return 'Billing address is required';
        break;
      case 'credit_days':
        if (formData.credit_days === undefined || formData.credit_days < 0) return 'Credit days must be 0 or more';
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

  const isFormValid = formData.company_name &&
    formData.mobile_contact_number &&
    formData.billing_address_line1 &&
    formData.credit_days !== undefined &&
    formData.max_credit_limit !== undefined &&
    (!formData.email || emailRegex.test(formData.email));
  const isSaving = createMutation.isPending || updateMutation.isPending;

  // Style for required field labels (red asterisk)
  const requiredFieldSx = {
    '& .MuiInputLabel-asterisk': {
      color: 'error.main',
    },
  };

  const masterPanel = (
    <SearchableList<Supplier>
      items={filteredSuppliers}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      hideSearch
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedSupplier}
      onSelectItem={handleSelectSupplierWithCheck}
      emptyMessage="No suppliers found"
      listHeader={
        isCreating ? (
          <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
              <SupplierAvatarCircle companyName={formData.company_name} size={40} />
              <Typography variant="caption" color="text.secondary">
                New Supplier
              </Typography>
            </Box>
            <TSectionNav
              items={SUPPLIER_SECTION_NAV_ITEMS}
              activeKey={activeSection}
              onChange={handleSectionNavChange}
              variant="inline"
            />
          </Box>
        ) : undefined
      }
      renderItem={(supplier, isSelected) => (
        <Box key={supplier.id}>
        <SelectableListItem
          id={supplier.id}
          isSelected={isSelected}
          onClick={() => {
            // Re-clicking the already-selected supplier doesn't change its id,
            // so the effect that resets the detail panel to "Company
            // Information" on selection change won't fire on its own — reset
            // it here too so the purple box always returns to the main view.
            if (isSelected) {
              setActiveSection(null);
            } else {
              handleSelectSupplierWithCheck(supplier);
            }
          }}
          primaryText={
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
              <SupplierAvatarCircle companyName={supplier.company_name} logoPath={supplier.logo_path} />
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5, minWidth: 0 }}>
                {/* Company Name */}
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{supplier.company_name}</span>
                  {isSelected && (
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Company Name)
                    </Typography>
                  )}
                </Box>
                {/* Additional fields when selected */}
                {isSelected && (
                  <>
                    {countries.find((c) => c.id === supplier.country_id)?.name && (
                      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <Typography component="span" variant="caption">
                          {countries.find((c) => c.id === supplier.country_id)?.name}
                        </Typography>
                        <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                          (Country)
                        </Typography>
                      </Box>
                    )}
                    {/* Status Chips - shown below all fields when selected */}
                    <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                      <Chip
                        label={supplier.active ? "Active" : "Inactive"}
                        size="small"
                        color={supplier.active ? "success" : "default"}
                        sx={{ height: 18, fontSize: "0.65rem" }}
                      />
                    </Box>
                  </>
                )}
              </Box>
            </Box>
          }
          isFavorite={favorites.includes(supplier.id)}
          onToggleFavorite={(e) => toggleFavorite(supplier.id, e)}
          statusChip={!isSelected ? (
            supplier.active
              ? { label: "Active", color: "success" }
              : { label: "Inactive", color: "default" }
          ) : undefined}
        />
        {isSelected && (
          <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
            <TSectionNav
              items={SUPPLIER_SECTION_NAV_ITEMS}
              activeKey={activeSection}
              onChange={handleSectionNavChange}
              variant="inline"
            />
          </Box>
        )}
        </Box>
      )}
    />
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
        isFavorite={selectedSupplier ? favorites.includes(selectedSupplier.id) : false}
        onToggleFavorite={selectedSupplier ? (e) => toggleFavorite(selectedSupplier.id, e) : undefined}
      />

      <ActionToolbar
        hasSelectedItem={!!selectedSupplier}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={!!isFormValid}
        onNew={canCreateSupplier ? handleNewSupplier : undefined}
        onDuplicate={handleDuplicate}
        onDelete={canDeleteSupplier ? handleDelete : undefined}
        onSave={handleSave}
        onCancel={() => handleCancel(filteredSuppliers)}
        onEdit={canUpdateSupplier ? handleStartEdit : undefined}
        canDelete={canDeleteSupplier}
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedSupplier && !isCreating ? (
          <EmptyState message="Select a supplier from the list or create a new one" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={3} fieldsPerSection={6} showHeader={false} showToolbar={false} />
        ) : (
          <>
          {activeSection === "contactPerson" && (
            <FormSection title="Contact Persons" columns={1}>
              {!selectedSupplier && (
                <Alert severity="info" sx={{ mb: 1.5 }}>
                  Contact persons added here will be saved together with the supplier.
                </Alert>
              )}
              {canUpdateSupplier && (
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
          )}

          {activeSection === null && (
          <>
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
              {selectedSupplier && !isCreating && (
                <Box>
                  <Typography variant="caption" color="text.secondary">Avg. Lead Time (Days)</Typography>
                  <Typography variant="body2">
                    {selectedSupplier.average_lead_time_days != null
                      ? `${selectedSupplier.average_lead_time_days} days`
                      : "No completed orders yet"}
                  </Typography>
                </Box>
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
                  onUpdated={setSelectedSupplier}
                  disabled={!isEditing && !isCreating}
                />
              </FormSection>
            )}

            {selectedSupplier && !isEditing && !isCreating && (
              <FormSection
                title="Record Information"
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
                  <Typography variant="caption" color="text.secondary">Date Joined</Typography>
                  <Typography variant="body2">{formatDateTimeReadable(selectedSupplier.date_joined) || "-"}</Typography>
                </Box>
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
          </>
          )}

          {activeSection === "address" && (
            <>
              <FormSection title="Country" columns={2}>
                <TAutocomplete<CountryRef>
                  label="Country"
                  options={countries}
                  value={selectedCountry}
                  onChange={(value) =>
                    setFormData({ ...formData, country_id: (value as CountryRef | null)?.id })
                  }
                  getOptionLabel={(c) => c.name}
                  disabled={!isEditing && !isCreating}
                />
              </FormSection>

              <FormSection title="Billing Address" columns={2}>
                <TextField
                  label="Address Line 1"
                  size="small"
                  value={formData.billing_address_line1}
                  onChange={(e) => setFormData({ ...formData, billing_address_line1: e.target.value })}
                  onBlur={() => handleBlur('billing_address_line1')}
                  disabled={!isEditing && !isCreating}
                  required
                  sx={requiredFieldSx}
                  error={hasError('billing_address_line1')}
                  helperText={getFieldError('billing_address_line1')}
                />
                <TextField
                  label="Address Line 2"
                  size="small"
                  value={formData.billing_address_line2}
                  onChange={(e) => setFormData({ ...formData, billing_address_line2: e.target.value })}
                  disabled={!isEditing && !isCreating}
                />
                <TextField
                  label="City"
                  size="small"
                  value={formData.billing_city}
                  onChange={(e) => setFormData({ ...formData, billing_city: e.target.value })}
                  disabled={!isEditing && !isCreating}
                />
                <TextField
                  label="State / Province"
                  size="small"
                  value={formData.billing_state}
                  onChange={(e) => setFormData({ ...formData, billing_state: e.target.value })}
                  disabled={!isEditing && !isCreating}
                />
                <TextField
                  label="Postal Code"
                  size="small"
                  value={formData.billing_postal_code}
                  onChange={(e) => setFormData({ ...formData, billing_postal_code: e.target.value })}
                  disabled={!isEditing && !isCreating}
                />
              </FormSection>

              <FormSection title="Shipping Address" columns={2}>
                <FormControlLabel
                  sx={{ gridColumn: "span 2" }}
                  control={
                    <Switch
                      checked={shippingSameAsBilling}
                      disabled={!isEditing && !isCreating}
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
                      disabled={!isEditing && !isCreating}
                    />
                    <TextField
                      label="Address Line 2"
                      size="small"
                      value={formData.shipping_address_line2}
                      onChange={(e) => setFormData({ ...formData, shipping_address_line2: e.target.value })}
                      disabled={!isEditing && !isCreating}
                    />
                    <TextField
                      label="City"
                      size="small"
                      value={formData.shipping_city}
                      onChange={(e) => setFormData({ ...formData, shipping_city: e.target.value })}
                      disabled={!isEditing && !isCreating}
                    />
                    <TextField
                      label="State / Province"
                      size="small"
                      value={formData.shipping_state}
                      onChange={(e) => setFormData({ ...formData, shipping_state: e.target.value })}
                      disabled={!isEditing && !isCreating}
                    />
                    <TextField
                      label="Postal Code"
                      size="small"
                      value={formData.shipping_postal_code}
                      onChange={(e) => setFormData({ ...formData, shipping_postal_code: e.target.value })}
                      disabled={!isEditing && !isCreating}
                    />
                  </>
                )}
              </FormSection>
            </>
          )}

          {activeSection === "payment" && (
            <FormSection title="Payment" columns={3}>
              <TextField
                label="Credit Days"
                size="small"
                type="number"
                value={formData.credit_days}
                onChange={(e) => setFormData({ ...formData, credit_days: parseInt(e.target.value) || 0 })}
                onBlur={() => handleBlur('credit_days')}
                disabled={!isEditing && !isCreating}
                required
                sx={requiredFieldSx}
                error={hasError('credit_days')}
                helperText={getFieldError('credit_days')}
                inputProps={{ min: 0 }}
              />
              <TextField
                label="Max Credit Limit"
                size="small"
                type="number"
                value={formData.max_credit_limit}
                onChange={(e) => setFormData({ ...formData, max_credit_limit: parseInt(e.target.value) || 0 })}
                onBlur={() => handleBlur('max_credit_limit')}
                disabled={!isEditing && !isCreating}
                required
                sx={requiredFieldSx}
                error={hasError('max_credit_limit')}
                helperText={getFieldError('max_credit_limit')}
                inputProps={{ min: 0 }}
              />
              {selectedSupplier && !isCreating && (
                <>
                  <TextField
                    label="Initial Credit Amount"
                    size="small"
                    type="number"
                    value={selectedSupplier.initial_credit_amount || 0}
                    disabled
                    InputProps={{ readOnly: true }}
                  />
                  <TextField
                    label="Left Credit Amount"
                    size="small"
                    type="number"
                    value={selectedSupplier.left_credit_amount || 0}
                    disabled
                    InputProps={{ readOnly: true }}
                  />
                </>
              )}
            </FormSection>
          )}

          {activeSection === "payment" && (
            <FormSection title="Payment Methods" columns={1}>
              {!selectedSupplier && (
                <Alert severity="info" sx={{ mb: 1.5 }}>
                  Payment methods added here will be saved together with the supplier.
                </Alert>
              )}
              {canUpdateSupplier && (
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
          )}
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
          <TTabFilterBar
            tabs={[
              {
                key: "supplier",
                label: "Supplier",
                hasValue: !!draftSupplierQuery,
                render: ({ close }) => (
                  <TextField
                    size="small"
                    autoFocus
                    placeholder="Company name"
                    value={draftSupplierQuery}
                    onChange={(e) => setDraftSupplierQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleApplyFilters();
                        close();
                      }
                    }}
                    fullWidth
                  />
                ),
              },
              {
                key: "status",
                label: "Status",
                hasValue: !!draftStatus,
                render: () => (
                  <TStatusFilter
                    options={SUPPLIER_STATUS_OPTIONS}
                    value={draftStatus}
                    onChange={setDraftStatus}
                    label=""
                    size="small"
                  />
                ),
              },
              {
                key: "country",
                label: "Country",
                hasValue: !!draftCountry,
                render: () => (
                  <TAutocomplete<CountryRef>
                    label="Country"
                    options={countries}
                    value={draftCountry}
                    onChange={(value) => setDraftCountry(value as CountryRef | null)}
                    getOptionLabel={(c) => c.name}
                    size="small"
                  />
                ),
              },
            ]}
            onSearch={handleApplyFilters}
            onClear={handleClearFilters}
            clearDisabled={!draftSupplierQuery && !draftStatus && !draftCountry && !searchQuery && !filterStatus && filterCountryId === null}
          />
        }
        headerActions={
          <Button
            variant="outlined"
            size="small"
            startIcon={<DownloadIcon />}
            onClick={handleExportCSV}
            disabled={filteredSuppliers.length === 0}
            sx={{ mr: 1 }}
          >
            Export CSV
          </Button>
        }
        onRefresh={refetch}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
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
          paymentMethodPanelMode === "view" && canUpdateSupplier ? (
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
            <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
            <MenuItem value="cheque">Cheque</MenuItem>
            <MenuItem value="cash">Cash</MenuItem>
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
        {(paymentMethodForm.method_type !== "cash" || paymentMethodPanelMode === "view") && (
          <TFormSection title="Account Details" variant="plain" columns={1}>
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
            <TextField
              label="Account Holder Name"
              size="small"
              value={paymentMethodForm.account_holder_name}
              disabled={paymentMethodPanelMode === "view"}
              onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, account_holder_name: e.target.value })}
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
          contactPersonPanelMode === "view" && canUpdateSupplier ? (
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
