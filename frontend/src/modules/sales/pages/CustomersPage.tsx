/**
 * CustomersPage - Refactored to use Tijaero-style reusable components
 */

import { formatDateTimeReadable, formatCurrency } from "@/utils/formatters";
import PersonIcon from "@mui/icons-material/Person";
import HistoryIcon from "@mui/icons-material/History";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import AccountBalanceWalletOutlinedIcon from "@mui/icons-material/AccountBalanceWalletOutlined";
import LocationOnOutlinedIcon from "@mui/icons-material/LocationOnOutlined";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import {
  Avatar,
  Box,
  Button,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  TChip,
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  FormSection,
  handleApiError,
  MasterDetailLayout,
  showErrorToast,
  showSuccessToast,
  TConfirmDialog,
  TDetailSkeleton,
  TITLE_CHOICES,
  TStatusFilter,
  useCrudMutation,
  useMasterDetailState,
  useTConfirmDialog,
  TActivityHistoryPanel,
  TDataGrid,
  type TDataGridColumn,
  TTabs,
  TTabPanel,
  type TTabConfig,
  SelectableListItem,
} from "@/components/tijaero";

import { usePermission } from "@/auth/permissions";
import CustomerContactPersons from "@/modules/sales/components/CustomerContactPersons";
import { customersApi } from "@/modules/customers/api";
import {
  Customer,
  CustomerContactPersonCreate,
  CustomerCreate,
  CustomerType,
  customerDisplayName,
} from "@/modules/customers/types";

// Status filter options
const CUSTOMER_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const AGENT_FILTER_OPTIONS = [
  { value: "agent", label: "Agents Only" },
  { value: "non-agent", label: "Non-Agents" },
];

const CUSTOMER_TYPE_OPTIONS = [
  { value: "individual", label: "Individual" },
  { value: "business", label: "Company" },
];

type CustomerSection = "general" | "address" | "contactPerson" | "payment";

// Same section layout as the Suppliers page. "Contact Person" only applies
// to company customers, so it is dropped from the list for individuals.
const CUSTOMER_DETAIL_TABS: (TTabConfig & { id: CustomerSection })[] = [
  { id: "general", label: "General", icon: <PersonIcon fontSize="small" /> },
  { id: "address", label: "Address", icon: <LocationOnOutlinedIcon fontSize="small" /> },
  { id: "contactPerson", label: "Contact Person", icon: <PersonOutlineIcon fontSize="small" /> },
  { id: "payment", label: "Payment", icon: <AccountBalanceWalletOutlinedIcon fontSize="small" /> },
];

const INITIAL_FORM_DATA: CustomerCreate = {
  customer_type: "individual",
  customer_name: "",
  title: "mr",
  email: "",
  mobile_contact_number: "",
  home_contact_number: "",
  company_name: "",
  tax_registration_number: "",
  company_registration_number: "",
  occupation: "",
  gender: "m",
  civil_status: "single",
  no_of_kids: "0",
  birthdate: "",
  id_card_number: "",
  passport_no: "",
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
  bank_details: "",
  name_in_cheque_card: "",
  credit_days: 0,
  max_credit_limit: 0,
  active: true,
  is_customer_agent: false,
  commission_rate: 0,
};

const resetFormFromCustomer = (customer: Customer): CustomerCreate => ({
  customer_type: customer.customer_type,
  customer_name: customer.customer_name,
  title: customer.title,
  email: customer.email || "",
  mobile_contact_number: customer.mobile_contact_number || "",
  home_contact_number: customer.home_contact_number || "",
  company_name: customer.company_name || "",
  tax_registration_number: customer.tax_registration_number || "",
  company_registration_number: customer.company_registration_number || "",
  occupation: customer.occupation || "",
  gender: customer.gender,
  civil_status: customer.civil_status,
  no_of_kids: customer.no_of_kids,
  birthdate: customer.birthdate || "",
  id_card_number: customer.id_card_number || "",
  passport_no: customer.passport_no || "",
  billing_address_line1: customer.billing_address_line1 || "",
  billing_address_line2: customer.billing_address_line2 || "",
  billing_city: customer.billing_city || "",
  billing_state: customer.billing_state || "",
  billing_postal_code: customer.billing_postal_code || "",
  shipping_address_line1: customer.shipping_address_line1 || "",
  shipping_address_line2: customer.shipping_address_line2 || "",
  shipping_city: customer.shipping_city || "",
  shipping_state: customer.shipping_state || "",
  shipping_postal_code: customer.shipping_postal_code || "",
  bank_details: customer.bank_details || "",
  name_in_cheque_card: customer.name_in_cheque_card || "",
  credit_days: customer.credit_days,
  max_credit_limit: customer.max_credit_limit,
  active: customer.active,
  is_customer_agent: customer.is_customer_agent,
  commission_rate: customer.commission_rate || 0,
});

/** Customer avatar: shows the name's initials, or a generic placeholder icon
 * for a brand-new, not-yet-named customer being created — mirrors the
 * company logo/initials circle on the Suppliers page. */
function CustomerAvatarCircle({ name, size = 36 }: { name?: string; size?: number }) {
  const initials = name?.trim() ? name.trim().slice(0, 2).toUpperCase() : null;
  return (
    <Avatar
      variant="circular"
      sx={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        bgcolor: "action.disabledBackground",
        color: "text.secondary",
      }}
    >
      {initials || <PersonIcon sx={{ fontSize: size * 0.55 }} />}
    </Avatar>
  );
}

export default function CustomersPage() {
  const queryClient = useQueryClient();

  // Permissions
  const canCreate = usePermission("customers", "create");
  const canUpdate = usePermission("customers", "update");

  // Filter state - all filters apply live as the user types/selects, no
  // separate "Search" step needed.
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterAgent, setFilterAgent] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<CustomerSection>("general");
  // Delivery address is optional: blank means "same as payment address".
  const [deliverySameAsPayment, setDeliverySameAsPayment] = useState(true);
  // Contact persons entered while creating a company; saved right after the
  // customer itself is created.
  const [draftContactPersons, setDraftContactPersons] = useState<CustomerContactPersonCreate[]>([]);

  // Use reusable state hook
  const {
    searchQuery,
    setSearchQuery,
    selectedItem: selectedCustomer,
    setSelectedItem: setSelectedCustomer,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    formData,
    setFormData,
    handleSelectItem: handleSelectCustomer,
    handleNew: handleNewCustomer,
    handleCancel: baseHandleCancel,
    handleStartEdit,
  } = useMasterDetailState<Customer, CustomerCreate>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromCustomer,
    defaultSortField: "customer_name",
  });

  // Activity History is opened on demand from a detail icon next to the
  // Activity History section title, rather than shown inline.
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterStatus(null);
    setFilterAgent(null);
    setFilterCategory(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Data fetching - fetch ALL customers (including inactive) for this management page
  const { data: customers, isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.getAll(0, 1000, false), // activeOnly=false to get all customers
  });

  // Filter and sort
  const filteredCustomers = useMemo(() => {
    if (!customers) return [];

    let filtered = customers.filter(
      (customer) =>
        customer.customer_name
          .toLowerCase()
          .includes(searchQuery.toLowerCase()) ||
        customer.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        customer.mobile_contact_number?.includes(searchQuery) ||
        customer.company_name
          ?.toLowerCase()
          .includes(searchQuery.toLowerCase()),
    );

    // Apply status filter
    if (filterStatus) {
      const isActive = filterStatus === "active";
      filtered = filtered.filter((customer) => customer.active === isActive);
    }

    if (filterCategory) {
      filtered = filtered.filter(
        (customer) => customer.customer_type === filterCategory,
      );
    }

    // Apply agent filter
    if (filterAgent) {
      const isAgent = filterAgent === "agent";
      filtered = filtered.filter(
        (customer) => customer.is_customer_agent === isAgent,
      );
    }

    // Default order before the user sorts a column in the table itself
    // (the table's own column-header sort takes over from there).
    filtered.sort((a, b) => a.customer_name.localeCompare(b.customer_name));

    return filtered;
  }, [
    customers,
    searchQuery,
    filterStatus,
    filterAgent,
    filterCategory,
  ]);

  // Mutations
  const createMutation = useCrudMutation({
    mutationFn: customersApi.create,
    invalidateQueryKeys: [["customers"], ["customers-all"], ["referenceData"]],
    successMessage: "Customer created successfully",
    errorMessage: "Failed to create customer",
    onSuccess: async (newCustomer) => {
      // Contact persons entered while creating a company are saved now that
      // the customer has an id. A failure here shouldn't undo the customer.
      if (newCustomer.customer_type === "business" && draftContactPersons.length > 0) {
        try {
          for (const draft of draftContactPersons) {
            await customersApi.createContactPerson(newCustomer.id, draft);
          }
        } catch {
          showErrorToast(
            "Customer saved, but some contact persons could not be added. Add them from the Contact Person tab.",
          );
        }
      }
      setDraftContactPersons([]);
      // Reset state first to avoid "unsaved changes" prompt
      setIsCreating(false);
      setIsEditing(false);
      setTimeout(() => handleSelectCustomer(newCustomer), 0);
    },
  });

  const updateMutation = useCrudMutation({
    mutationFn: ({ id, data }: { id: number; data: CustomerCreate }) =>
      customersApi.update(id, data),
    invalidateQueryKeys: [["customers"], ["customers-all"], ["referenceData"]],
    successMessage: "Customer updated successfully",
    errorMessage: "Failed to update customer",
    onSuccess: (updatedCustomer) => {
      setIsEditing(false);
      // Refresh selectedCustomer with the latest data from the server
      setSelectedCustomer(updatedCustomer as Customer);
    },
  });

  const confirmDialog = useTConfirmDialog();

  // Handlers
  const handleSave = useCallback(() => {
    if (isCreating) {
      createMutation.mutate(formData);
    } else if (selectedCustomer) {
      updateMutation.mutate({ id: selectedCustomer.id, data: formData });
    }
  }, [isCreating, selectedCustomer, formData, createMutation, updateMutation]);

  const handleDuplicate = useCallback(() => {
    if (selectedCustomer) {
      setFormData({
        ...formData,
        customer_name: `${selectedCustomer.customer_name} (Copy)`,
      });
      handleNewCustomer();
    }
  }, [selectedCustomer, formData, setFormData, handleNewCustomer]);

  const isBusiness = formData.customer_type === "business";
  const detailTabs = useMemo(
    () => CUSTOMER_DETAIL_TABS.filter((t) => t.id !== "contactPerson" || isBusiness),
    [isBusiness],
  );
  // Falls back to General if the Contact Person tab disappears (e.g. the
  // category is switched to Individual, or another customer is opened).
  const currentSection: CustomerSection =
    activeSection === "contactPerson" && !isBusiness ? "general" : activeSection;
  // The toggle mirrors the saved data: a customer with no delivery address of
  // their own is "same as payment address"; a new customer starts that way.
  const savedDeliveryLine1 = selectedCustomer?.shipping_address_line1;
  useEffect(() => {
    setDeliverySameAsPayment(isCreating || !savedDeliveryLine1);
  }, [selectedCustomer?.id, savedDeliveryLine1, isCreating]);
  // Drafts belong to one "New Customer" session only.
  useEffect(() => {
    if (!isCreating) setDraftContactPersons([]);
  }, [isCreating]);
  // Individuals need a mobile number; companies need a company name instead.
  const isFormValid =
    formData.customer_name &&
    (isBusiness ? formData.company_name : formData.mobile_contact_number);
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDisabled = !isEditing && !isCreating;

  // Whether we're showing a single customer's detail view (selected or
  // being created) instead of the browse table.
  const isCustomerDetailMode = !!selectedCustomer || isCreating;

  // Returns to the browse table from the detail view.
  const handleBackToCustomers = useCallback(() => {
    setSelectedCustomer(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [isCreating, setSelectedCustomer, setIsCreating, setIsEditing]);

  // Cancelling out of "New Customer" should return to the browse table, not
  // auto-open the first customer the way useMasterDetailState's generic
  // handleCancel does (that made sense for the old always-visible detail
  // panel, but not here). Cancelling out of editing an existing customer
  // still just reverts its form, which the generic handler already does
  // correctly.
  const handleCancelCustomer = useCallback(() => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedCustomer(null);
    } else {
      baseHandleCancel(filteredCustomers);
    }
  }, [isCreating, filteredCustomers, baseHandleCancel, setIsCreating, setIsEditing, setSelectedCustomer]);

  // Browse mode: a full-width table of every customer. Sorting is done
  // per-column via the grid's own column header menu, not a separate
  // "Sort by" control.
  const customerColumns: TDataGridColumn<Customer>[] = useMemo(
    () => [
      { field: "customer_no", header: "No.", width: 90 },
      {
        field: "customer_name",
        header: "Name",
        flex: 1,
        minWidth: 180,
        renderCell: (params: GridRenderCellParams<Customer>) => (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, height: "100%" }}>
            <CustomerAvatarCircle name={params.row.customer_name} size={30} />
            <Typography variant="body2" fontWeight={600}>
              {params.row.customer_type === "business"
                ? params.row.customer_name
                : `${params.row.title ?? ""} ${params.row.customer_name}`.trim()}
            </Typography>
          </Box>
        ),
      },
      {
        field: "customer_type",
        header: "Category",
        width: 110,
        renderCell: (params: GridRenderCellParams<Customer>) => (
          <TChip
            label={params.row.customer_type === "business" ? "Company" : "Individual"}
            size="small"
            variant="outlined"
            color={params.row.customer_type === "business" ? "primary" : "default"}
          />
        ),
      },
      { field: "company_name", header: "Company", flex: 1, minWidth: 160 },
      { field: "mobile_contact_number", header: "Contact", width: 150 },
      {
        field: "is_customer_agent",
        header: "Type",
        width: 110,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<Customer>) =>
          params.row.is_customer_agent ? (
            <TChip label="Agent" size="small" color="info" />
          ) : (
            <TChip label="Customer" size="small" variant="outlined" />
          ),
      },
      {
        field: "active",
        header: "Status",
        width: 110,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<Customer>) => (
          <TChip
            label={params.row.active ? "Active" : "Inactive"}
            size="small"
            color={params.row.active ? "success" : "default"}
          />
        ),
      },
      {
        field: "max_credit_limit",
        header: "Credit Limit",
        width: 150,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<Customer>) =>
          formatCurrency(params.row.max_credit_limit || 0),
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<Customer>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectCustomer(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [handleSelectCustomer]
  );

  const customerTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<Customer>
          rows={filteredCustomers}
          columns={customerColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectCustomer(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No customers found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Detail mode: a narrow left panel showing only the current customer (or
  // the "New Customer" placeholder while creating), with a "Back to
  // Customers" link returning to the table.
  // Detail Panel
  const detailPanel = (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Sales", href: "/sales" },
          { label: "Customers", href: "/sales/customers" },
          ...(selectedCustomer || isCreating
            ? [
                {
                  label: isCreating
                    ? "New Customer"
                    : selectedCustomer?.customer_name || "",
                },
              ]
            : []),
        ]}
        title={
          selectedCustomer
            ? customerDisplayName(selectedCustomer)
            : ""
        }
        titleIcon={<PersonIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Customer"
        noSelectionTitle="Select a Customer"
        tabsSlot={
          (selectedCustomer || isCreating) && (
            <TTabs
              tabs={detailTabs}
              activeTab={currentSection}
              onChange={(id) => setActiveSection(id as CustomerSection)}
              showDivider={false}
            />
          )
        }
        chips={
          selectedCustomer
            ? [
                {
                  label: selectedCustomer.active ? "Active" : "Inactive",
                  color: selectedCustomer.active
                    ? "success"
                    : ("default" as const),
                },
                ...(selectedCustomer.is_customer_agent
                  ? [{ label: "Agent", color: "info" as const }]
                  : []),
              ]
            : []
        }
      />

      <ActionToolbar
        canCreate={canCreate}
        canUpdate={canUpdate}
        hasSelectedItem={!!selectedCustomer}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={!!isFormValid}
        onNew={handleNewCustomer}
        onDuplicate={handleDuplicate}
        onSave={handleSave}
        onCancel={handleCancelCustomer}
        onEdit={handleStartEdit}
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedCustomer && !isCreating ? (
          <EmptyState message="Select a customer from the list or create a new one" />
        ) : isSaving || isLoading ? (
          <TDetailSkeleton
            sections={3}
            fieldsPerSection={4}
            showHeader={false}
            showToolbar={false}
          />
        ) : (
          <>
            <TTabPanel value={currentSection} index="general" padding={0}>
            {/* Personal Information */}
            <FormSection
              title={isBusiness ? "Company Information" : "Personal Information"}
              columns={3}
            >
              <TextField
                label="Customer Category"
                size="small"
                select
                value={formData.customer_type ?? "individual"}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    customer_type: e.target.value as CustomerType,
                  })
                }
                // Category is fixed once a customer exists; changing it later
                // would orphan the type-specific fields.
                disabled={!isCreating}
              >
                {CUSTOMER_TYPE_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              {isBusiness ? (
                <TextField
                  label="Company Name"
                  size="small"
                  value={formData.company_name}
                  onChange={(e) =>
                    setFormData({ ...formData, company_name: e.target.value })
                  }
                  disabled={isDisabled}
                  required
                />
              ) : (
                <TextField
                  label="Title"
                  size="small"
                  select
                  value={formData.title}
                  onChange={(e) =>
                    setFormData({ ...formData, title: e.target.value })
                  }
                  disabled={isDisabled}
                >
                  {TITLE_CHOICES.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              <TextField
                label={isBusiness ? "Contact Person" : "Customer Name"}
                size="small"
                value={formData.customer_name}
                onChange={(e) =>
                  setFormData({ ...formData, customer_name: e.target.value })
                }
                disabled={isDisabled}
                required
              />
              {isBusiness ? (
                <>
                  <TextField
                    label="Tax Registration No"
                    size="small"
                    value={formData.tax_registration_number}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        tax_registration_number: e.target.value,
                      })
                    }
                    disabled={isDisabled}
                  />
                  <TextField
                    label="Company Registration No"
                    size="small"
                    value={formData.company_registration_number}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        company_registration_number: e.target.value,
                      })
                    }
                    disabled={isDisabled}
                  />
                </>
              ) : (
                <>
                  <TextField
                    label="Company Name"
                    size="small"
                    value={formData.company_name}
                    onChange={(e) =>
                      setFormData({ ...formData, company_name: e.target.value })
                    }
                    disabled={isDisabled}
                  />
                  <TextField
                    label="Occupation"
                    size="small"
                    value={formData.occupation}
                    onChange={(e) =>
                      setFormData({ ...formData, occupation: e.target.value })
                    }
                    disabled={isDisabled}
                  />
                </>
              )}
            </FormSection>

            {/* Contact Information */}
            <FormSection title="Contact Information" columns={3}>
              <TextField
                label="Email"
                size="small"
                type="email"
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
                disabled={isDisabled}
              />
              <TextField
                label="Mobile Contact"
                size="small"
                value={formData.mobile_contact_number}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    mobile_contact_number: e.target.value,
                  })
                }
                disabled={isDisabled}
                required={!isBusiness}
              />
              <TextField
                label="Home Contact"
                size="small"
                value={formData.home_contact_number}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    home_contact_number: e.target.value,
                  })
                }
                disabled={isDisabled}
              />
            </FormSection>

            {/* ID & Documents (individuals only) */}
            {!isBusiness && (
            <FormSection title="ID & Documents" columns={2}>
              <TextField
                label="ID Card Number"
                size="small"
                value={formData.id_card_number}
                onChange={(e) =>
                  setFormData({ ...formData, id_card_number: e.target.value })
                }
                disabled={isDisabled}
              />
              <TextField
                label="Passport No"
                size="small"
                value={formData.passport_no}
                onChange={(e) =>
                  setFormData({ ...formData, passport_no: e.target.value })
                }
                disabled={isDisabled}
              />
            </FormSection>
            )}

            {/* Activity History (view mode only) */}
            {selectedCustomer && !isCreating && !isEditing && (
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
                  <Typography variant="caption" color="text.secondary">
                    Created By
                  </Typography>
                  <Typography variant="body2">
                    {selectedCustomer.created_by_name || "-"}
                    {selectedCustomer.created_at ? ` on ${formatDateTimeReadable(selectedCustomer.created_at)}` : ""}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Last Modified By
                  </Typography>
                  <Typography variant="body2">
                    {selectedCustomer.updated_by_name || "-"}
                    {selectedCustomer.updated_at ? ` on ${formatDateTimeReadable(selectedCustomer.updated_at)}` : ""}
                  </Typography>
                </Box>
              </FormSection>
            )}
            </TTabPanel>

            <TTabPanel value={currentSection} index="address" padding={0} sx={{ pt: 2 }}>
            <FormSection title="Payment Address" columns={2}>
              <TextField
                label="Address Line 1"
                size="small"
                value={formData.billing_address_line1}
                onChange={(e) => setFormData({ ...formData, billing_address_line1: e.target.value })}
                disabled={isDisabled}
              />
              <TextField
                label="Address Line 2"
                size="small"
                value={formData.billing_address_line2}
                onChange={(e) => setFormData({ ...formData, billing_address_line2: e.target.value })}
                disabled={isDisabled}
              />
              <TextField
                label="City"
                size="small"
                value={formData.billing_city}
                onChange={(e) => setFormData({ ...formData, billing_city: e.target.value })}
                disabled={isDisabled}
              />
              <TextField
                label="State / Province"
                size="small"
                value={formData.billing_state}
                onChange={(e) => setFormData({ ...formData, billing_state: e.target.value })}
                disabled={isDisabled}
              />
              <TextField
                label="Postal Code"
                size="small"
                value={formData.billing_postal_code}
                onChange={(e) => setFormData({ ...formData, billing_postal_code: e.target.value })}
                disabled={isDisabled}
              />
            </FormSection>

            <FormSection title="Delivery Address" columns={2}>
              <FormControlLabel
                sx={{ gridColumn: "span 2" }}
                control={
                  <Switch
                    checked={deliverySameAsPayment}
                    disabled={isDisabled}
                    onChange={(e) => {
                      const same = e.target.checked;
                      setDeliverySameAsPayment(same);
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
                label="Same as payment address"
              />
              {!deliverySameAsPayment && (
                <>
                  <TextField
                    label="Address Line 1"
                    size="small"
                    value={formData.shipping_address_line1}
                    onChange={(e) => setFormData({ ...formData, shipping_address_line1: e.target.value })}
                    disabled={isDisabled}
                  />
                  <TextField
                    label="Address Line 2"
                    size="small"
                    value={formData.shipping_address_line2}
                    onChange={(e) => setFormData({ ...formData, shipping_address_line2: e.target.value })}
                    disabled={isDisabled}
                  />
                  <TextField
                    label="City"
                    size="small"
                    value={formData.shipping_city}
                    onChange={(e) => setFormData({ ...formData, shipping_city: e.target.value })}
                    disabled={isDisabled}
                  />
                  <TextField
                    label="State / Province"
                    size="small"
                    value={formData.shipping_state}
                    onChange={(e) => setFormData({ ...formData, shipping_state: e.target.value })}
                    disabled={isDisabled}
                  />
                  <TextField
                    label="Postal Code"
                    size="small"
                    value={formData.shipping_postal_code}
                    onChange={(e) => setFormData({ ...formData, shipping_postal_code: e.target.value })}
                    disabled={isDisabled}
                  />
                </>
              )}
            </FormSection>
            </TTabPanel>

            <TTabPanel value={currentSection} index="contactPerson" padding={0} sx={{ pt: 2 }}>
              <CustomerContactPersons
                customerId={selectedCustomer && !isCreating ? selectedCustomer.id : undefined}
                canEdit={canUpdate || isCreating}
                drafts={draftContactPersons}
                onDraftsChange={setDraftContactPersons}
              />
            </TTabPanel>

            <TTabPanel value={currentSection} index="payment" padding={0} sx={{ pt: 2 }}>
            {/* Banking Details */}
            <FormSection title="Banking Details" columns={2}>
              <TextField
                label="Bank Details"
                size="small"
                value={formData.bank_details}
                onChange={(e) =>
                  setFormData({ ...formData, bank_details: e.target.value })
                }
                disabled={isDisabled}
              />
              <TextField
                label="Name in Cheque/Card"
                size="small"
                value={formData.name_in_cheque_card}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    name_in_cheque_card: e.target.value,
                  })
                }
                disabled={isDisabled}
              />
            </FormSection>

            {/* Credit Settings */}
            <FormSection title="Credit Settings" columns={3}>
              <TextField
                label="Credit Days"
                size="small"
                type="number"
                value={formData.credit_days}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    credit_days: parseInt(e.target.value) || 0,
                  })
                }
                disabled={isDisabled}
              />
              <TextField
                label="Max Credit Limit"
                size="small"
                type="number"
                value={formData.max_credit_limit}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    max_credit_limit: parseFloat(e.target.value) || 0,
                  })
                }
                disabled={isDisabled}
              />
              <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formData.active ?? true}
                      onChange={(e) =>
                        setFormData({ ...formData, active: e.target.checked })
                      }
                      disabled={isDisabled}
                    />
                  }
                  label="Active"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={formData.is_customer_agent}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          is_customer_agent: e.target.checked,
                        })
                      }
                      disabled={isDisabled}
                    />
                  }
                  label="Agent"
                />
              </Box>
              {formData.is_customer_agent && (
                <TextField
                  label="Default Commission Rate (%)"
                  size="small"
                  type="number"
                  value={formData.commission_rate || 0}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      commission_rate: parseFloat(e.target.value) || 0,
                    })
                  }
                  disabled={isDisabled}
                  inputProps={{ min: 0, max: 100, step: 0.01 }}
                  helperText="Default commission percentage for this agent"
                  sx={{ mt: 1 }}
                />
              )}
            </FormSection>
            </TTabPanel>
          </>
        )}
      </Box>
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title="Customers"
        titleSlot={
          isCustomerDetailMode ? (
          <Button
            size="small"
            startIcon={<ArrowBackIcon fontSize="small" />}
            onClick={handleBackToCustomers}
            sx={{ textTransform: "none" }}
          >
            Back to Customers
          </Button>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search customers..."
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
                  options={CUSTOMER_STATUS_OPTIONS}
                  value={filterStatus}
                  onChange={setFilterStatus}
                  label=""
                  placeholder="All Status"
                  size="small"
                />
              </Box>
              <Box sx={{ width: 160, flexShrink: 0, "& .MuiOutlinedInput-root": { borderRadius: "24px" } }}>
                <TStatusFilter
                  options={AGENT_FILTER_OPTIONS}
                  value={filterAgent}
                  onChange={setFilterAgent}
                  label=""
                  placeholder="All Types"
                  size="small"
                />
              </Box>
              <Box sx={{ width: 160, flexShrink: 0, "& .MuiOutlinedInput-root": { borderRadius: "24px" } }}>
                <TStatusFilter
                  options={CUSTOMER_TYPE_OPTIONS}
                  value={filterCategory}
                  onChange={setFilterCategory}
                  label=""
                  placeholder="All Categories"
                  size="small"
                />
              </Box>
              {(searchQuery || filterStatus || filterAgent || filterCategory) && (
                <Button size="small" onClick={handleClearFilters} sx={{ textTransform: "none" }}>
                  Clear
                </Button>
              )}
            </Box>
          )
        }
        headerActions={
          isCustomerDetailMode ? undefined : (
            <>
              {canCreate && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={handleNewCustomer}
                  sx={{ mr: 1 }}
                >
                  Add Customer
                </Button>
              )}
            </>
          )
        }
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ["customers"] });
          queryClient.invalidateQueries({ queryKey: ["branches"] });
        }}
        isLoading={isLoading}
        {...(isCustomerDetailMode
          ? { children: detailPanel }
          : { children: customerTablePanel })}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />

      <TActivityHistoryPanel
        open={activityHistoryOpen}
        onClose={() => setActivityHistoryOpen(false)}
        entityType="customer"
        entityId={selectedCustomer?.id}
        actionLabels={{
          create: "Customer created",
          update: "Customer updated",
          delete: "Customer deleted",
        }}
      />
    </>
  );
}
