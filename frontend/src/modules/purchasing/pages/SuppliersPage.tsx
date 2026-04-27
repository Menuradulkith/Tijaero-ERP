/**
 * SuppliersPage - Using Tijaero-style reusable components
 */

import { useMemo, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDateTimeReadable } from "@/utils/formatters";
import { useQuery } from "@tanstack/react-query";
import {
  Box,
  Button,
  TextField,
  MenuItem,
  Switch,
  FormControlLabel,
  Typography,
  Chip,
} from "@mui/material";
import BusinessIcon from "@mui/icons-material/Business";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import { useAuthStore } from "@/state/authStore";
import { hasPermission, PERMISSIONS } from "@/auth/permissions";
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
  SortOption,
  TConfirmDialog,
  TDetailSkeleton,
  TITLE_CHOICES,
  GENDER_CHOICES,
  CIVIL_CHOICES,
  useCrudMutation,
  useTConfirmDialog,
} from "@/components/tijaero";

import { suppliersApi } from "@/modules/purchasing/api";
import { Supplier, SupplierCreate } from "@/modules/purchasing/types";

const SORT_OPTIONS: SortOption[] = [
  { value: "full_name", label: "Name" },
  { value: "company_name", label: "Company" },
  { value: "email", label: "Email" },
];

const INITIAL_FORM_DATA: SupplierCreate = {
  title: "mr",
  full_name: "",
  name_in_cheque_card: "",
  occupation: "",
  company_name: "",
  company_registration_number: "",
  company_postal_address: "",
  company_contact_number: "",
  company_website: "",
  postal_address: "",
  permenent_address: "",
  bank_details: "",
  birthdate: "",
  id_card_number: "",
  gender: "m",
  civil_status: "single",
  passport_no: "",
  no_of_kids: "0",
  email: "",
  home_contact_number: "",
  mobile_contact_number: "",
  credit_days: 30,
  max_credit_limit: 100000,
  active: true,
  country_id: undefined,
};

const resetFormFromSupplier = (supplier: Supplier): SupplierCreate => ({
  title: supplier.title || "mr",
  full_name: supplier.full_name,
  name_in_cheque_card: supplier.name_in_cheque_card || "",
  occupation: supplier.occupation || "",
  company_name: supplier.company_name || "",
  company_registration_number: supplier.company_registration_number || "",
  company_postal_address: supplier.company_postal_address || "",
  company_contact_number: supplier.company_contact_number || "",
  company_website: supplier.company_website || "",
  postal_address: supplier.postal_address || "",
  permenent_address: supplier.permenent_address || "",
  bank_details: supplier.bank_details || "",
  birthdate: supplier.birthdate?.split("T")[0] || "",
  id_card_number: supplier.id_card_number || "",
  gender: supplier.gender || "m",
  civil_status: supplier.civil_status || "single",
  passport_no: supplier.passport_no || "",
  no_of_kids: supplier.no_of_kids || "0",
  email: supplier.email || "",
  home_contact_number: supplier.home_contact_number || "",
  mobile_contact_number: supplier.mobile_contact_number || "",
  credit_days: supplier.credit_days,
  max_credit_limit: supplier.max_credit_limit,
  active: supplier.active,
  country_id: supplier.country_id,
});

export default function SuppliersPage() {
  const navigate = useNavigate();
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
  const canCreatePO = hasPermission(
    user,
    PERMISSIONS.PURCHASE_ORDERS_CREATE.resource,
    PERMISSIONS.PURCHASE_ORDERS_CREATE.action,
  );

  // Confirm dialog for unsaved changes and delete actions
  const confirmDialog = useTConfirmDialog();

  // Validation state - track which fields have been touched/blurred
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  
  // Mark field as touched when user leaves it
  const handleBlur = (fieldName: string) => {
    setTouched(prev => ({ ...prev, [fieldName]: true }));
  };

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
    defaultSortField: "full_name",
    confirmUnsavedChanges: () => confirmDialog.confirm({
      title: "Discard Changes",
      message: "You have unsaved changes. Discard them?",
      confirmText: "Discard",
      cancelText: "Keep Editing",
      confirmColor: "warning",
    }),
  });

  const { data: suppliers, isLoading, refetch } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => suppliersApi.getAll(),
  });

  const filteredSuppliers = useMemo(() => {
    if (!suppliers) return [];

    let filtered = suppliers.filter(
      (supplier) =>
        supplier.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (supplier.company_name?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
        (supplier.email?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
    );

    filtered.sort((a, b) => {
      const fieldA = a[sortField as keyof Supplier] || "";
      const fieldB = b[sortField as keyof Supplier] || "";
      return String(fieldA).localeCompare(String(fieldB));
    });

    return filtered;
  }, [suppliers, searchQuery, sortField]);

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
    onSuccess: (newSupplier) => {
      setIsCreating(false);
      setIsEditing(false);
      setTimeout(() => handleSelectSupplier(newSupplier), 0);
    },
  });

  const updateMutation = useCrudMutation({
    mutationFn: ({ id, data }: { id: number; data: SupplierCreate }) =>
      suppliersApi.update(id, data),
    invalidateQueryKeys: [["suppliers"], ["referenceData"]],
    successMessage: "Supplier updated successfully",
    errorMessage: "Failed to update supplier",
    onSuccess: () => {
      setIsEditing(false);
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
      updateMutation.mutate({ id: selectedSupplier.id, data: formData });
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
        message: `Are you sure you want to delete "${selectedSupplier.full_name}"?`,
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
        full_name: `${selectedSupplier.full_name} (Copy)`,
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
      case 'full_name':
        if (!formData.full_name) return 'Full name is required';
        if (formData.full_name.length < 2) return 'Name must be at least 2 characters';
        break;
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
      case 'company_contact_number':
        if (formData.company_contact_number && !phoneRegex.test(formData.company_contact_number)) return 'Invalid phone format';
        break;
      case 'postal_address':
        if (!formData.postal_address) return 'Postal address is required';
        break;
      case 'permenent_address':
        if (!formData.permenent_address) return 'Permanent address is required';
        break;
      case 'credit_days':
        if (formData.credit_days === undefined || formData.credit_days < 0) return 'Credit days must be 0 or more';
        break;
      case 'max_credit_limit':
        if (formData.max_credit_limit === undefined || formData.max_credit_limit < 0) return 'Credit limit must be 0 or more';
        break;
      case 'no_of_kids':
        if (formData.no_of_kids && parseInt(formData.no_of_kids) < 0) return 'Cannot be negative';
        break;
    }
    return undefined;
  };

  // Check if a field has an error (for styling)
  const hasError = (fieldName: string): boolean => {
    return !!getFieldError(fieldName);
  };

  const isFormValid = formData.full_name && 
    formData.mobile_contact_number && 
    formData.postal_address && 
    formData.permenent_address && 
    formData.no_of_kids &&
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
      placeholder="Search suppliers..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedSupplier}
      onSelectItem={handleSelectSupplierWithCheck}
      emptyMessage="No suppliers found"
      renderItem={(supplier, isSelected) => (
        <SelectableListItem
          key={supplier.id}
          id={supplier.id}
          isSelected={isSelected}
          onClick={() => handleSelectSupplierWithCheck(supplier)}
          primaryText={
            <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
              {/* Supplier Name */}
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{supplier.full_name}</span>
                {isSelected && (
                  <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                    (Name)
                  </Typography>
                )}
              </Box>
              {/* Additional fields when selected */}
              {isSelected && (
                <>
                  {supplier.company_name && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {supplier.company_name}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Company)
                      </Typography>
                    </Box>
                  )}
                  {supplier.email && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {supplier.email}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Email)
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
                    {supplier.title && (
                      <Chip
                        label={supplier.title.charAt(0).toUpperCase() + supplier.title.slice(1)}
                        size="small"
                        color="secondary"
                        variant="outlined"
                        sx={{ height: 18, fontSize: "0.65rem" }}
                      />
                    )}
                  </Box>
                </>
              )}
            </Box>
          }
          secondaryText={!isSelected ? (supplier.company_name || supplier.email || "No company") : undefined}
          isFavorite={favorites.includes(supplier.id)}
          onToggleFavorite={(e) => toggleFavorite(supplier.id, e)}
          statusChip={!isSelected ? (
            supplier.active
              ? { label: "Active", color: "success" }
              : { label: "Inactive", color: "default" }
          ) : undefined}
        />
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
            ? [{ label: isCreating ? "New Supplier" : selectedSupplier?.full_name || "" }]
            : []),
        ]}
        title={
          selectedSupplier
            ? `${selectedSupplier.title} ${selectedSupplier.full_name}`
            : ""
        }
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
        endActions={
          !isCreating &&
          !isEditing &&
          selectedSupplier &&
          canCreatePO && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<LocalShippingIcon />}
              onClick={() =>
                navigate("/purchasing/orders", {
                  state: {
                    createPOFromSupplier: true,
                    supplierId: selectedSupplier.id,
                  },
                })
              }
              sx={{ ml: 1 }}
            >
              Create Purchase Order
            </Button>
          )
        }
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedSupplier && !isCreating ? (
          <EmptyState message="Select a supplier from the list or create a new one" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={3} fieldsPerSection={6} showHeader={false} showToolbar={false} />
        ) : (
          <>
            <FormSection title="Personal Information" columns={3}>
              <TextField
                select
                label="Title"
                size="small"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                disabled={!isEditing && !isCreating}
              >
                {TITLE_CHOICES.map((t) => (
                  <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
                ))}
              </TextField>
              <TextField
                label="Full Name"
                size="small"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                onBlur={() => handleBlur('full_name')}
                disabled={!isEditing && !isCreating}
                required
                error={hasError('full_name')}
                helperText={getFieldError('full_name')}
              />
              <TextField
                label="Name in Cheque/Card"
                size="small"
                value={formData.name_in_cheque_card}
                onChange={(e) => setFormData({ ...formData, name_in_cheque_card: e.target.value })}
                disabled={!isEditing && !isCreating}
              />
              <TextField
                label="Occupation"
                size="small"
                value={formData.occupation}
                onChange={(e) => setFormData({ ...formData, occupation: e.target.value })}
                disabled={!isEditing && !isCreating}
              />
              <TextField
                select
                label="Gender"
                size="small"
                value={formData.gender}
                onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                disabled={!isEditing && !isCreating}
              >
                {GENDER_CHOICES.map((g) => (
                  <MenuItem key={g.value} value={g.value}>{g.label}</MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Civil Status"
                size="small"
                value={formData.civil_status}
                onChange={(e) => setFormData({ ...formData, civil_status: e.target.value })}
                disabled={!isEditing && !isCreating}
              >
                {CIVIL_CHOICES.map((s) => (
                  <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>
                ))}
              </TextField>
              <TextField
                label="Birthdate"
                type="date"
                size="small"
                value={formData.birthdate}
                onChange={(e) => setFormData({ ...formData, birthdate: e.target.value })}
                disabled={!isEditing && !isCreating}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="ID Card Number"
                size="small"
                value={formData.id_card_number}
                onChange={(e) => setFormData({ ...formData, id_card_number: e.target.value })}
                disabled={!isEditing && !isCreating}
              />
              <TextField
                label="Passport No."
                size="small"
                value={formData.passport_no}
                onChange={(e) => setFormData({ ...formData, passport_no: e.target.value })}
                disabled={!isEditing && !isCreating}
              />
              <TextField
                label="No. of Kids"
                size="small"
                value={formData.no_of_kids}
                onChange={(e) => setFormData({ ...formData, no_of_kids: e.target.value })}
                onBlur={() => handleBlur('no_of_kids')}
                disabled={!isEditing && !isCreating}
                required
                sx={requiredFieldSx}
                error={hasError('no_of_kids')}
                helperText={getFieldError('no_of_kids')}
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
                label="Mobile Contact"
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
                label="Home Contact"
                size="small"
                value={formData.home_contact_number}
                onChange={(e) => setFormData({ ...formData, home_contact_number: e.target.value })}
                onBlur={() => handleBlur('home_contact_number')}
                disabled={!isEditing && !isCreating}
                error={hasError('home_contact_number')}
                helperText={getFieldError('home_contact_number')}
              />
            </FormSection>

            <FormSection title="Company Information" columns={3}>
              <TextField
                label="Company Name"
                size="small"
                value={formData.company_name}
                onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                disabled={!isEditing && !isCreating}
              />
              <TextField
                label="Company Registration No."
                size="small"
                value={formData.company_registration_number}
                onChange={(e) => setFormData({ ...formData, company_registration_number: e.target.value })}
                disabled={!isEditing && !isCreating}
              />
              <TextField
                label="Company Website"
                size="small"
                value={formData.company_website}
                onChange={(e) => setFormData({ ...formData, company_website: e.target.value })}
                disabled={!isEditing && !isCreating}
              />
              <TextField
                label="Company Contact Number"
                size="small"
                value={formData.company_contact_number}
                onChange={(e) => setFormData({ ...formData, company_contact_number: e.target.value })}
                onBlur={() => handleBlur('company_contact_number')}
                disabled={!isEditing && !isCreating}
                error={hasError('company_contact_number')}
                helperText={getFieldError('company_contact_number')}
              />
              <TextField
                label="Company Postal Address"
                size="small"
                value={formData.company_postal_address}
                onChange={(e) => setFormData({ ...formData, company_postal_address: e.target.value })}
                disabled={!isEditing && !isCreating}
                sx={{ gridColumn: "span 2" }}
              />
            </FormSection>

            <FormSection title="Address" columns={2}>
              <TextField
                label="Postal Address"
                size="small"
                value={formData.postal_address}
                onChange={(e) => setFormData({ ...formData, postal_address: e.target.value })}
                onBlur={() => handleBlur('postal_address')}
                disabled={!isEditing && !isCreating}
                multiline
                rows={2}
                required
                sx={requiredFieldSx}
                error={hasError('postal_address')}
                helperText={getFieldError('postal_address')}
              />
              <TextField
                label="Permanent Address"
                size="small"
                value={formData.permenent_address}
                onChange={(e) => setFormData({ ...formData, permenent_address: e.target.value })}
                onBlur={() => handleBlur('permenent_address')}
                disabled={!isEditing && !isCreating}
                multiline
                rows={2}
                required
                sx={requiredFieldSx}
                error={hasError('permenent_address')}
                helperText={getFieldError('permenent_address')}
              />
            </FormSection>

            <FormSection title="Financial Information" columns={3}>
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
              <TextField
                label="Bank Details"
                size="small"
                value={formData.bank_details}
                onChange={(e) => setFormData({ ...formData, bank_details: e.target.value })}
                disabled={!isEditing && !isCreating}
                multiline
                rows={2}
                sx={{ gridColumn: "span 3" }}
              />
            </FormSection>

            {/* Record Information (view mode only) */}
            {selectedSupplier && !isEditing && !isCreating && (
              <FormSection title="Record Information" columns={2}>
                <Box>
                  <Typography variant="caption" color="text.secondary">Date Joined</Typography>
                  <Typography variant="body2">{formatDateTimeReadable(selectedSupplier.date_joined) || "-"}</Typography>
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
        title="Suppliers"
        onRefresh={refetch}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
