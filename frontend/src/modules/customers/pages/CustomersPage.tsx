/**
 * CustomersPage - Refactored to use Tijaero-style reusable components
 */

import { useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  TextField,
  MenuItem,
  FormControlLabel,
  Switch,
} from "@mui/material";
import PersonIcon from "@mui/icons-material/Person";
import toast from "react-hot-toast";

// Tijaero Components
import {
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  DetailPanelHeader,
  ActionToolbar,
  FormSection,
  EmptyState,
  useMasterDetailState,
  SortOption,
} from "@/components/tijaero";

import { customersApi } from "../api";
import { Customer, CustomerCreate } from "../types";
import { usePermission } from "@/auth/permissions";

// Configuration
const SORT_OPTIONS: SortOption[] = [
  { value: "customer_name", label: "Customer Name" },
  { value: "company_name", label: "Company Name" },
];

const INITIAL_FORM_DATA: CustomerCreate = {
  customer_name: "",
  title: "Mr.",
  email: "",
  mobile_contact_number: "",
  home_contact_number: "",
  company_name: "",
  occupation: "",
  gender: "Male",
  civil_status: "Single",
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
});

export default function CustomersPage() {
  const queryClient = useQueryClient();

  // Permissions
  const canCreate = usePermission("customers", "create");
  const canUpdate = usePermission("customers", "update");
  const canDelete = usePermission("customers", "delete");

  // Use reusable state hook
  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem: selectedCustomer,
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

  // Data fetching
  const { data: customers, isLoading, refetch } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.getAll(),
  });

  // Filter and sort
  const filteredCustomers = useMemo(() => {
    if (!customers) return [];

    let filtered = customers.filter(
      (customer) =>
        customer.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        customer.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        customer.mobile_contact_number?.includes(searchQuery) ||
        customer.company_name?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    filtered.sort((a, b) => {
      if (sortField === "customer_name") {
        return a.customer_name.localeCompare(b.customer_name);
      } else if (sortField === "company_name") {
        return (a.company_name || "").localeCompare(b.company_name || "");
      }
      return 0;
    });

    return filtered;
  }, [customers, searchQuery, sortField]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: customersApi.create,
    onSuccess: (newCustomer) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Customer created successfully");
      // Reset state first to avoid "unsaved changes" prompt
      setIsCreating(false);
      setIsEditing(false);
      setTimeout(() => handleSelectCustomer(newCustomer), 0);
    },
    onError: () => toast.error("Failed to create customer"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: CustomerCreate }) =>
      customersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Customer updated successfully");
      setIsEditing(false);
    },
    onError: () => toast.error("Failed to update customer"),
  });

  const deleteMutation = useMutation({
    mutationFn: customersApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Customer deleted successfully");
      baseHandleCancel(filteredCustomers);
    },
    onError: () => toast.error("Failed to delete customer"),
  });

  // Handlers
  const handleSave = useCallback(() => {
    if (isCreating) {
      createMutation.mutate(formData);
    } else if (selectedCustomer) {
      updateMutation.mutate({ id: selectedCustomer.id, data: formData });
    }
  }, [isCreating, selectedCustomer, formData, createMutation, updateMutation]);

  const handleDelete = useCallback(() => {
    if (selectedCustomer && window.confirm("Are you sure you want to delete this customer?")) {
      deleteMutation.mutate(selectedCustomer.id);
    }
  }, [selectedCustomer, deleteMutation]);

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
      renderItem={(customer, isSelected) => (
        <SelectableListItem
          key={customer.id}
          id={customer.id}
          isSelected={isSelected}
          onClick={() => handleSelectCustomer(customer)}
          primaryText={`${customer.title} ${customer.customer_name}`}
          secondaryText={customer.company_name || customer.mobile_contact_number}
          isFavorite={favorites.includes(customer.id)}
          onToggleFavorite={(e) => toggleFavorite(customer.id, e)}
          statusChip={
            customer.active
              ? { label: "Active", color: "success" }
              : { label: "Inactive", color: "default" }
          }
          chips={customer.is_customer_agent ? [{ label: "Agent", color: "info" }] : undefined}
        />
      )}
    />
  );

  // Detail Panel
  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Customers", href: "#" },
          ...(selectedCustomer || isCreating
            ? [{ label: isCreating ? "New Customer" : selectedCustomer?.customer_name || "" }]
            : []),
        ]}
        title={selectedCustomer ? `${selectedCustomer.title} ${selectedCustomer.customer_name}` : ""}
        titleIcon={<PersonIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Customer"
        noSelectionTitle="Select a Customer"
        chips={selectedCustomer ? [
          { label: selectedCustomer.active ? "Active" : "Inactive", color: selectedCustomer.active ? "success" : "default" as const },
          ...(selectedCustomer.is_customer_agent ? [{ label: "Agent", color: "info" as const }] : [])
        ] : []}
        isFavorite={selectedCustomer ? favorites.includes(selectedCustomer.id) : false}
        onToggleFavorite={selectedCustomer ? (e) => toggleFavorite(selectedCustomer.id, e) : undefined}
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

      <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
        {!selectedCustomer && !isCreating ? (
          <EmptyState message="Select a customer from the list or create a new one" />
        ) : (
          <>
            {/* Basic Information */}
            <FormSection title="Basic Information" columns={3}>
              <TextField
                label="Title"
                size="small"
                select
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                disabled={isDisabled}
              >
                <MenuItem value="Mr.">Mr.</MenuItem>
                <MenuItem value="Mrs.">Mrs.</MenuItem>
                <MenuItem value="Ms.">Ms.</MenuItem>
                <MenuItem value="Dr.">Dr.</MenuItem>
              </TextField>
              <TextField
                label="Customer Name"
                size="small"
                value={formData.customer_name}
                onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                disabled={isDisabled}
                required
              />
              <TextField
                label="Email"
                size="small"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                disabled={isDisabled}
              />
              <TextField
                label="Mobile Contact"
                size="small"
                value={formData.mobile_contact_number}
                onChange={(e) => setFormData({ ...formData, mobile_contact_number: e.target.value })}
                disabled={isDisabled}
                required
              />
              <TextField
                label="Home Contact"
                size="small"
                value={formData.home_contact_number}
                onChange={(e) => setFormData({ ...formData, home_contact_number: e.target.value })}
                disabled={isDisabled}
              />
              <TextField
                label="Company Name"
                size="small"
                value={formData.company_name}
                onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                disabled={isDisabled}
              />
              <TextField
                label="Occupation"
                size="small"
                value={formData.occupation}
                onChange={(e) => setFormData({ ...formData, occupation: e.target.value })}
                disabled={isDisabled}
              />
              <TextField
                label="Gender"
                size="small"
                select
                value={formData.gender}
                onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                disabled={isDisabled}
              >
                <MenuItem value="Male">Male</MenuItem>
                <MenuItem value="Female">Female</MenuItem>
                <MenuItem value="Other">Other</MenuItem>
              </TextField>
              <TextField
                label="Civil Status"
                size="small"
                select
                value={formData.civil_status}
                onChange={(e) => setFormData({ ...formData, civil_status: e.target.value })}
                disabled={isDisabled}
              >
                <MenuItem value="Single">Single</MenuItem>
                <MenuItem value="Married">Married</MenuItem>
                <MenuItem value="Divorced">Divorced</MenuItem>
                <MenuItem value="Widowed">Widowed</MenuItem>
              </TextField>
              <TextField
                label="No. of Kids"
                size="small"
                value={formData.no_of_kids}
                onChange={(e) => setFormData({ ...formData, no_of_kids: e.target.value })}
                disabled={isDisabled}
              />
              <TextField
                label="Birthdate"
                size="small"
                type="date"
                value={formData.birthdate}
                onChange={(e) => setFormData({ ...formData, birthdate: e.target.value })}
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
                onChange={(e) => setFormData({ ...formData, id_card_number: e.target.value })}
                disabled={isDisabled}
              />
              <TextField
                label="Passport No"
                size="small"
                value={formData.passport_no}
                onChange={(e) => setFormData({ ...formData, passport_no: e.target.value })}
                disabled={isDisabled}
              />
            </FormSection>

            {/* Address & Banking */}
            <FormSection title="Address & Banking" columns={2}>
              <TextField
                label="Payment Address"
                size="small"
                value={formData.payment_address}
                onChange={(e) => setFormData({ ...formData, payment_address: e.target.value })}
                disabled={isDisabled}
                multiline
                rows={2}
              />
              <TextField
                label="Delivery Address"
                size="small"
                value={formData.delivery_address}
                onChange={(e) => setFormData({ ...formData, delivery_address: e.target.value })}
                disabled={isDisabled}
                multiline
                rows={2}
              />
              <TextField
                label="Bank Details"
                size="small"
                value={formData.bank_details}
                onChange={(e) => setFormData({ ...formData, bank_details: e.target.value })}
                disabled={isDisabled}
              />
              <TextField
                label="Name in Cheque/Card"
                size="small"
                value={formData.name_in_cheque_card}
                onChange={(e) => setFormData({ ...formData, name_in_cheque_card: e.target.value })}
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
                onChange={(e) => setFormData({ ...formData, credit_days: parseInt(e.target.value) || 0 })}
                disabled={isDisabled}
              />
              <TextField
                label="Max Credit Limit"
                size="small"
                type="number"
                value={formData.max_credit_limit}
                onChange={(e) => setFormData({ ...formData, max_credit_limit: parseFloat(e.target.value) || 0 })}
                disabled={isDisabled}
              />
              <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formData.active}
                      onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                      disabled={isDisabled}
                    />
                  }
                  label="Active"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={formData.is_customer_agent}
                      onChange={(e) => setFormData({ ...formData, is_customer_agent: e.target.checked })}
                      disabled={isDisabled}
                    />
                  }
                  label="Agent"
                />
              </Box>
            </FormSection>
          </>
        )}
      </Box>
    </Box>
  );

  return (
    <MasterDetailLayout
      title="Customers"
      onRefresh={refetch}
      isLoading={isLoading}
      masterPanel={masterPanel}
      detailPanel={detailPanel}
    />
  );
}
