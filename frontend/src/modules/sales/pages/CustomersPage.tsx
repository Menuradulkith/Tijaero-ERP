/**
 * CustomersPage - Refactored to use Tijaero-style reusable components
 */

import { formatDateTimeReadable } from "@/utils/formatters";
import { FileDownload as DownloadIcon } from "@mui/icons-material";
import PersonIcon from "@mui/icons-material/Person";
import {
  Box,
  Button,
  Chip,
  FormControlLabel,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ActionToolbar,
  CIVIL_CHOICES,
  DetailPanelHeader,
  EmptyState,
  FormSection,
  GENDER_CHOICES,
  handleApiError,
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  showErrorToast,
  showSuccessToast,
  SortOption,
  TConfirmDialog,
  TDetailSkeleton,
  TITLE_CHOICES,
  TStatusFilter,
  useCrudMutation,
  useMasterDetailState,
  useTConfirmDialog,
} from "@/components/tijaero";
import SalesFilterPanel from "@/modules/sales/components/ui/SalesFilterPanel";

import apiClient from "@/api/client";
import { usePermission } from "@/auth/permissions";
import { customersApi } from "@/modules/customers/api";
import { Customer, CustomerCreate } from "@/modules/customers/types";

// Configuration
const SORT_OPTIONS: SortOption[] = [
  { value: "customer_name", label: "Customer Name" },
  { value: "company_name", label: "Company Name" },
];

// Status filter options
const CUSTOMER_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const AGENT_FILTER_OPTIONS = [
  { value: "agent", label: "Agents Only" },
  { value: "non-agent", label: "Non-Agents" },
];

const INITIAL_FORM_DATA: CustomerCreate = {
  customer_name: "",
  title: "mr",
  email: "",
  mobile_contact_number: "",
  home_contact_number: "",
  company_name: "",
  occupation: "",
  gender: "m",
  civil_status: "single",
  no_of_kids: "0",
  birthdate: "",
  id_card_number: "",
  passport_no: "",
  payment_address: "",
  delivery_address: "",
  bank_details: "",
  name_in_cheque_card: "",
  credit_days: 0,
  max_credit_limit: 0,
  active: true,
  is_customer_agent: false,
  commission_rate: 0,
};

const resetFormFromCustomer = (customer: Customer): CustomerCreate => ({
  customer_name: customer.customer_name,
  title: customer.title,
  email: customer.email || "",
  mobile_contact_number: customer.mobile_contact_number,
  home_contact_number: customer.home_contact_number || "",
  company_name: customer.company_name || "",
  occupation: customer.occupation || "",
  gender: customer.gender,
  civil_status: customer.civil_status,
  no_of_kids: customer.no_of_kids,
  birthdate: customer.birthdate || "",
  id_card_number: customer.id_card_number || "",
  passport_no: customer.passport_no || "",
  payment_address: customer.payment_address || "",
  delivery_address: customer.delivery_address || "",
  bank_details: customer.bank_details || "",
  name_in_cheque_card: customer.name_in_cheque_card || "",
  credit_days: customer.credit_days,
  max_credit_limit: customer.max_credit_limit,
  active: customer.active,
  is_customer_agent: customer.is_customer_agent,
  commission_rate: customer.commission_rate || 0,
});

export default function CustomersPage() {
  const queryClient = useQueryClient();

  // Permissions
  const canCreate = usePermission("customers", "create");
  const canUpdate = usePermission("customers", "update");
  const canDelete = usePermission("customers", "delete");

  // Filter states
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterAgent, setFilterAgent] = useState<string | null>(null);

  // Use reusable state hook
  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem: selectedCustomer,
    setSelectedItem: setSelectedCustomer,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    favorites,
    toggleFavorite,
    formData,
    setFormData,
    handleSelectItem: handleSelectCustomer,
    handleNew: handleNewCustomer,
    handleCancel: baseHandleCancel,
    handleStartEdit,
  } = useMasterDetailState<Customer, CustomerCreate>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromCustomer,
    favoritesKey: "customers_favorites",
    defaultSortField: "customer_name",
  });

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

    // Apply agent filter
    if (filterAgent) {
      const isAgent = filterAgent === "agent";
      filtered = filtered.filter(
        (customer) => customer.is_customer_agent === isAgent,
      );
    }

    filtered.sort((a, b) => {
      if (sortField === "customer_name") {
        return a.customer_name.localeCompare(b.customer_name);
      } else if (sortField === "company_name") {
        return (a.company_name || "").localeCompare(b.company_name || "");
      }
      return 0;
    });

    return filtered;
  }, [
    customers,
    searchQuery,
    sortField,
    filterStatus,
    filterAgent,
  ]);

  // Auto-select first item when data loads
  useEffect(() => {
    if (filteredCustomers.length > 0 && !selectedCustomer && !isCreating) {
      handleSelectCustomer(filteredCustomers[0]);
    }
  }, [filteredCustomers, selectedCustomer, isCreating]);

  // Mutations
  const createMutation = useCrudMutation({
    mutationFn: customersApi.create,
    invalidateQueryKeys: [["customers"], ["customers-all"], ["referenceData"]],
    successMessage: "Customer created successfully",
    errorMessage: "Failed to create customer",
    onSuccess: (newCustomer) => {
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

  const deleteMutation = useCrudMutation({
    mutationFn: customersApi.delete,
    invalidateQueryKeys: [["customers"], ["customers-all"], ["referenceData"]],
    successMessage: "Customer deleted successfully",
    errorMessage: "Failed to delete customer",
    onSuccess: () => {
      setSelectedCustomer(null);
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

  const handleDelete = useCallback(async () => {
    if (selectedCustomer) {
      const confirmed = await confirmDialog.confirm({
        title: "Delete Customer",
        message: "Are you sure you want to delete this customer?",
        confirmText: "Delete",
        confirmColor: "error",
      });
      if (confirmed) {
        deleteMutation.mutate(selectedCustomer.id);
      }
    }
  }, [selectedCustomer, deleteMutation, confirmDialog]);

  const handleDuplicate = useCallback(() => {
    if (selectedCustomer) {
      setFormData({
        ...formData,
        customer_name: `${selectedCustomer.customer_name} (Copy)`,
      });
      handleNewCustomer();
    }
  }, [selectedCustomer, formData, setFormData, handleNewCustomer]);

  const isFormValid = formData.customer_name && formData.mobile_contact_number;
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDisabled = !isEditing && !isCreating;

  // CSV Export
  const handleExportCSV = async () => {
    try {
      const activeParam = filterStatus === "active" ? "&active_only=true" : "";

      const response = await apiClient.get<Blob>(
        `/customers/export-csv?limit=100000${activeParam}`,
        {
          responseType: "blob",
        },
      );

      const blob = response.data;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const dateStr = new Date().toISOString().split("T")[0];
      link.download = `customers_${dateStr}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      // Fallback or show error mechanism
    }
  };

  // Master Panel
  const masterPanel = (
    <SearchableList<Customer>
      items={filteredCustomers}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search customers..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedCustomer}
      onSelectItem={handleSelectCustomer}
      emptyMessage="No customers found"
      listHeader={
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 1,
            padding: 1.5,
            paddingBottom: 0,
          }}
        >
          <SalesFilterPanel
            statusOptions={CUSTOMER_STATUS_OPTIONS}
            statusValue={filterStatus}
            onStatusChange={setFilterStatus}
          >
            <TStatusFilter
              options={AGENT_FILTER_OPTIONS}
              value={filterAgent}
              onChange={setFilterAgent}
              label="Type"
            />
          </SalesFilterPanel>
        </Box>
      }
      renderItem={(customer, isSelected) => (
        <SelectableListItem
          key={customer.id}
          id={customer.id}
          isSelected={isSelected}
          onClick={() => handleSelectCustomer(customer)}
          primaryText={
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                width: "100%",
                gap: 0.5,
              }}
            >
              {/* Customer Name */}
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>{customer.customer_name}</span>
                {isSelected && (
                  <Typography
                    component="span"
                    variant="caption"
                    sx={{ color: "inherit", opacity: 0.7 }}
                  >
                    (Name)
                  </Typography>
                )}
              </Box>
              {/* Additional fields when selected */}
              {isSelected && (
                <>
                  {customer.company_name && (
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <Typography component="span" variant="caption">
                        {customer.company_name}
                      </Typography>
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{ color: "inherit", opacity: 0.7 }}
                      >
                        (Company)
                      </Typography>
                    </Box>
                  )}
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Typography component="span" variant="caption">
                      {customer.mobile_contact_number}
                    </Typography>
                    <Typography
                      component="span"
                      variant="caption"
                      sx={{ color: "inherit", opacity: 0.7 }}
                    >
                      (Mobile)
                    </Typography>
                  </Box>
                  {/* Status Chips - shown below all fields when selected */}
                  <Box
                    sx={{
                      display: "flex",
                      gap: 0.5,
                      mt: 0.5,
                      flexWrap: "wrap",
                    }}
                  >
                    <Chip
                      label={customer.active ? "Active" : "Inactive"}
                      size="small"
                      color={customer.active ? "success" : "default"}
                      sx={{ height: 18, fontSize: "0.65rem" }}
                    />
                    {customer.title && (
                      <Chip
                        label={
                          customer.title.charAt(0).toUpperCase() +
                          customer.title.slice(1)
                        }
                        size="small"
                        color="secondary"
                        variant="outlined"
                        sx={{ height: 18, fontSize: "0.65rem" }}
                      />
                    )}
                    {customer.is_customer_agent && (
                      <Chip
                        label="Agent"
                        size="small"
                        color="info"
                        sx={{ height: 18, fontSize: "0.65rem" }}
                      />
                    )}
                  </Box>
                </>
              )}
            </Box>
          }
          secondaryText={
            !isSelected
              ? customer.company_name || customer.mobile_contact_number
              : undefined
          }
          isFavorite={favorites.includes(customer.id)}
          onToggleFavorite={(e) => toggleFavorite(customer.id, e)}
          statusChip={
            !isSelected
              ? customer.active
                ? { label: "Active", color: "success" }
                : { label: "Inactive", color: "default" }
              : undefined
          }
          chips={
            !isSelected && customer.is_customer_agent
              ? [{ label: "Agent", color: "info" }]
              : undefined
          }
        />
      )}
    />
  );

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
            ? `${selectedCustomer.title} ${selectedCustomer.customer_name}`
            : ""
        }
        titleIcon={<PersonIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Customer"
        noSelectionTitle="Select a Customer"
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
        isFavorite={
          selectedCustomer ? favorites.includes(selectedCustomer.id) : false
        }
        onToggleFavorite={
          selectedCustomer
            ? (e) => toggleFavorite(selectedCustomer.id, e)
            : undefined
        }
      />

      <ActionToolbar
        canCreate={canCreate}
        canUpdate={canUpdate}
        canDelete={canDelete}
        hasSelectedItem={!!selectedCustomer}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={!!isFormValid}
        onNew={handleNewCustomer}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
        onSave={handleSave}
        onCancel={() => baseHandleCancel(filteredCustomers)}
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
            {/* Basic Information */}
            <FormSection title="Basic Information" columns={3}>
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
              <TextField
                label="Customer Name"
                size="small"
                value={formData.customer_name}
                onChange={(e) =>
                  setFormData({ ...formData, customer_name: e.target.value })
                }
                disabled={isDisabled}
                required
              />
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
                required
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
              <TextField
                label="Gender"
                size="small"
                select
                value={formData.gender}
                onChange={(e) =>
                  setFormData({ ...formData, gender: e.target.value })
                }
                disabled={isDisabled}
              >
                {GENDER_CHOICES.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Civil Status"
                size="small"
                select
                value={formData.civil_status}
                onChange={(e) =>
                  setFormData({ ...formData, civil_status: e.target.value })
                }
                disabled={isDisabled}
              >
                {CIVIL_CHOICES.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="No. of Kids"
                size="small"
                value={formData.no_of_kids}
                onChange={(e) =>
                  setFormData({ ...formData, no_of_kids: e.target.value })
                }
                disabled={isDisabled}
              />
              <TextField
                label="Birthdate"
                size="small"
                type="date"
                value={formData.birthdate}
                onChange={(e) =>
                  setFormData({ ...formData, birthdate: e.target.value })
                }
                disabled={isDisabled}
                InputLabelProps={{ shrink: true }}
              />
            </FormSection>

            {/* ID & Documents */}
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

            {/* Address & Banking */}
            <FormSection title="Address & Banking" columns={2}>
              <TextField
                label="Payment Address"
                size="small"
                value={formData.payment_address}
                onChange={(e) =>
                  setFormData({ ...formData, payment_address: e.target.value })
                }
                disabled={isDisabled}
                multiline
                rows={2}
              />
              <TextField
                label="Delivery Address"
                size="small"
                value={formData.delivery_address}
                onChange={(e) =>
                  setFormData({ ...formData, delivery_address: e.target.value })
                }
                disabled={isDisabled}
                multiline
                rows={2}
              />
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

            {/* Record Information (view mode only) */}
            {selectedCustomer && !isCreating && !isEditing && (
              <FormSection title="Record Information" columns={2}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Created
                  </Typography>
                  <Typography variant="body2">
                    {formatDateTimeReadable(selectedCustomer.created_at) || "-"}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Last Modified
                  </Typography>
                  <Typography variant="body2">
                    {formatDateTimeReadable(selectedCustomer.updated_at) || "-"}
                  </Typography>
                </Box>
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
        title="Customers"
        headerActions={
          <Button
            variant="outlined"
            size="small"
            startIcon={<DownloadIcon />}
            onClick={handleExportCSV}
            disabled={filteredCustomers.length === 0}
            sx={{ mr: 1 }}
          >
            Export CSV
          </Button>
        }
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ["customers"] });
          queryClient.invalidateQueries({ queryKey: ["branches"] });
        }}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
