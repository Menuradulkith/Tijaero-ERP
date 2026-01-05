/**
 * SuppliersPage - Using Tijaero-style reusable components
 */

import { useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  TextField,
  MenuItem,
  Switch,
  FormControlLabel,
} from "@mui/material";
import BusinessIcon from "@mui/icons-material/Business";
import toast from "react-hot-toast";
import { ConfirmDialog, useConfirmDialog } from "@/components/ConfirmDialog";

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

import { suppliersApi } from "@/modules/purchasing/api";
import { Supplier, SupplierCreate } from "@/modules/purchasing/types";

const SORT_OPTIONS: SortOption[] = [
  { value: "full_name", label: "Name" },
  { value: "company_name", label: "Company" },
  { value: "email", label: "Email" },
];

const TITLES = ["Mr", "Mrs", "Ms", "Dr", "Prof"];
const GENDERS = ["Male", "Female", "Other"];
const CIVIL_STATUS = ["Single", "Married", "Divorced", "Widowed"];

const INITIAL_FORM_DATA: SupplierCreate = {
  title: "Mr",
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
  gender: "Male",
  civil_status: "Single",
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
  title: supplier.title || "Mr",
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
  gender: supplier.gender || "Male",
  civil_status: supplier.civil_status || "Single",
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
  const queryClient = useQueryClient();

  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem: selectedSupplier,
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

  const createMutation = useMutation({
    mutationFn: suppliersApi.create,
    onSuccess: (newSupplier) => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success("Supplier created successfully");
      setIsCreating(false);
      setIsEditing(false);
      setTimeout(() => handleSelectSupplier(newSupplier), 0);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || "Failed to create supplier");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: SupplierCreate }) =>
      suppliersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success("Supplier updated successfully");
      setIsEditing(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || "Failed to update supplier");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: suppliersApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success("Supplier deleted successfully");
      handleCancel(filteredSuppliers);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || "Failed to delete supplier");
    },
  });

  const handleSave = useCallback(() => {
    if (isCreating) {
      createMutation.mutate(formData);
    } else if (selectedSupplier) {
      updateMutation.mutate({ id: selectedSupplier.id, data: formData });
    }
  }, [isCreating, selectedSupplier, formData, createMutation, updateMutation]);

  const confirmDialog = useConfirmDialog();

  const handleDelete = useCallback(async () => {
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
  }, [selectedSupplier, deleteMutation, confirmDialog]);

  const handleDuplicate = useCallback(() => {
    if (selectedSupplier) {
      setFormData({
        ...formData,
        full_name: `${selectedSupplier.full_name} (Copy)`,
      });
      handleNewSupplier();
    }
  }, [selectedSupplier, formData, setFormData, handleNewSupplier]);

  const isFormValid = formData.full_name && 
    formData.mobile_contact_number && 
    formData.postal_address && 
    formData.permenent_address && 
    formData.no_of_kids &&
    formData.credit_days !== undefined &&
    formData.max_credit_limit !== undefined;
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
      onSelectItem={handleSelectSupplier}
      emptyMessage="No suppliers found"
      renderItem={(supplier, isSelected) => (
        <SelectableListItem
          key={supplier.id}
          id={supplier.id}
          isSelected={isSelected}
          onClick={() => handleSelectSupplier(supplier)}
          primaryText={`${supplier.title} ${supplier.full_name}`}
          secondaryText={supplier.company_name || supplier.email || "No company"}
          isFavorite={favorites.includes(supplier.id)}
          onToggleFavorite={(e) => toggleFavorite(supplier.id, e)}
          statusChip={
            supplier.active
              ? { label: "Active", color: "success" }
              : { label: "Inactive", color: "default" }
          }
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
        onNew={handleNewSupplier}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
        onSave={handleSave}
        onCancel={() => handleCancel(filteredSuppliers)}
        onEdit={handleStartEdit}
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
        {!selectedSupplier && !isCreating ? (
          <EmptyState message="Select a supplier from the list or create a new one" />
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
                {TITLES.map((t) => (
                  <MenuItem key={t} value={t}>{t}</MenuItem>
                ))}
              </TextField>
              <TextField
                label="Full Name"
                size="small"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                disabled={!isEditing && !isCreating}
                required
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
                {GENDERS.map((g) => (
                  <MenuItem key={g} value={g}>{g}</MenuItem>
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
                {CIVIL_STATUS.map((s) => (
                  <MenuItem key={s} value={s}>{s}</MenuItem>
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
                disabled={!isEditing && !isCreating}
                required
                sx={requiredFieldSx}
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
                disabled={!isEditing && !isCreating}
              />
              <TextField
                label="Mobile Contact"
                size="small"
                value={formData.mobile_contact_number}
                onChange={(e) => setFormData({ ...formData, mobile_contact_number: e.target.value })}
                disabled={!isEditing && !isCreating}
                required
              />
              <TextField
                label="Home Contact"
                size="small"
                value={formData.home_contact_number}
                onChange={(e) => setFormData({ ...formData, home_contact_number: e.target.value })}
                disabled={!isEditing && !isCreating}
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
                disabled={!isEditing && !isCreating}
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
                disabled={!isEditing && !isCreating}
                multiline
                rows={2}
                required
                sx={requiredFieldSx}
              />
              <TextField
                label="Permanent Address"
                size="small"
                value={formData.permenent_address}
                onChange={(e) => setFormData({ ...formData, permenent_address: e.target.value })}
                disabled={!isEditing && !isCreating}
                multiline
                rows={2}
                required
                sx={requiredFieldSx}
              />
            </FormSection>

            <FormSection title="Financial Information" columns={3}>
              <TextField
                label="Credit Days"
                size="small"
                type="number"
                value={formData.credit_days}
                onChange={(e) => setFormData({ ...formData, credit_days: parseInt(e.target.value) || 0 })}
                disabled={!isEditing && !isCreating}
                required
                sx={requiredFieldSx}
              />
              <TextField
                label="Max Credit Limit"
                size="small"
                type="number"
                value={formData.max_credit_limit}
                onChange={(e) => setFormData({ ...formData, max_credit_limit: parseInt(e.target.value) || 0 })}
                disabled={!isEditing && !isCreating}
                required
                sx={requiredFieldSx}
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
      <ConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
