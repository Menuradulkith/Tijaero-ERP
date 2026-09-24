/**
 * CustomersPage - Refactored to use Tijaero-style reusable components
 */

import PersonIcon from "@mui/icons-material/Person";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import StarIcon from "@mui/icons-material/Star";
import StarOutlineIcon from "@mui/icons-material/StarBorder";
import SearchIcon from "@mui/icons-material/Search";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import {
    Avatar,
    Box,
    Button,
    Chip,
    FormControlLabel,
    IconButton,
    InputAdornment,
    MenuItem,
    Paper,
    Switch,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

// Tijaero Components
import {
    ActionToolbar,
    DetailPanelHeader,
    EmptyState,
    FormSection,
    MasterDetailLayout,
    showErrorToast,
    showSuccessToast,
    TDetailSkeleton,
    TExportButton,
    TConfirmDialog,
    useMasterDetailState,
    useTConfirmDialog,
    TITLE_CHOICES,
    GENDER_CHOICES,
    CIVIL_CHOICES,
    TDataGrid,
    SelectableListItem,
    type TDataGridColumn,
} from "@/components/tijaero";
import { formatDateTimeReadable, formatCurrency } from "@/utils/formatters";

import { usePermission } from "@/auth/permissions";
import { customersApi } from "../api";
import { Customer, CustomerCreate } from "../types";

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

    // Default order before the user sorts a column in the table itself
    // (the table's own column-header sort takes over from there).
    filtered.sort((a, b) => a.customer_name.localeCompare(b.customer_name));

    return filtered;
  }, [customers, searchQuery]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: customersApi.create,
    onSuccess: (newCustomer) => {
      // Refetch queries immediately to update the UI
      queryClient.refetchQueries({ queryKey: ["customers"] });
      queryClient.refetchQueries({ queryKey: ["customers-all"] });
      queryClient.refetchQueries({ queryKey: ["referenceData"] });
      showSuccessToast("Customer created successfully");
      // Reset state first to avoid "unsaved changes" prompt
      setIsCreating(false);
      setIsEditing(false);
      setTimeout(() => handleSelectCustomer(newCustomer), 0);
    },
    onError: () => showErrorToast("Failed to create customer"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: CustomerCreate }) =>
      customersApi.update(id, data),
    onSuccess: (updatedCustomer) => {
      // Refetch queries immediately to update the UI
      queryClient.refetchQueries({ queryKey: ["customers"] });
      queryClient.refetchQueries({ queryKey: ["customers-all"] });
      queryClient.refetchQueries({ queryKey: ["referenceData"] });
      showSuccessToast("Customer updated successfully");
      setIsEditing(false);
      // Refresh selected customer with latest server data
      handleSelectCustomer(updatedCustomer);
    },
    onError: () => showErrorToast("Failed to update customer"),
  });

  const deleteMutation = useMutation({
    mutationFn: customersApi.delete,
    onSuccess: () => {
      // Refetch queries immediately to update the UI
      queryClient.refetchQueries({ queryKey: ["customers"] });
      queryClient.refetchQueries({ queryKey: ["customers-all"] });
      queryClient.refetchQueries({ queryKey: ["referenceData"] });
      showSuccessToast("Customer deleted successfully");
      setSelectedCustomer(null);
    },
    onError: () => showErrorToast("Failed to delete customer"),
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
      {
        field: "favorite",
        header: "",
        width: 48,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<Customer>) => (
          <IconButton size="small" onClick={(e) => toggleFavorite(params.row.id, e)}>
            {favorites.includes(params.row.id) ? (
              <StarIcon fontSize="small" color="warning" />
            ) : (
              <StarOutlineIcon fontSize="small" color="action" />
            )}
          </IconButton>
        ),
      },
      {
        field: "customer_name",
        header: "Name",
        flex: 1,
        minWidth: 180,
        renderCell: (params: GridRenderCellParams<Customer>) => (
          <Typography variant="body2" fontWeight={600}>
            {`${params.row.title} ${params.row.customer_name}`}
          </Typography>
        ),
      },
      {
        field: "is_customer_agent",
        header: "Type",
        width: 110,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<Customer>) =>
          params.row.is_customer_agent ? (
            <Chip label="Agent" size="small" color="info" />
          ) : (
            <Chip label="Customer" size="small" variant="outlined" />
          ),
      },
      { field: "mobile_contact_number", header: "Contact", width: 150 },
      { field: "company_name", header: "Company", flex: 1, minWidth: 150 },
      {
        field: "active",
        header: "Status",
        width: 110,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<Customer>) => (
          <Chip
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
    [favorites, toggleFavorite, handleSelectCustomer]
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
  // the "New Customer" placeholder while creating). A "Back to Customers"
  // link returns to the table.
  const singleCustomerPanel = (
    <Paper
      elevation={0}
      sx={{
        width: 280,
        minWidth: 240,
        maxWidth: 300,
        borderRight: 1,
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <Box sx={{ p: 1, borderBottom: 1, borderColor: "divider" }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon fontSize="small" />}
          onClick={handleBackToCustomers}
          sx={{ textTransform: "none" }}
        >
          Back to Customers
        </Button>
      </Box>
      {isCreating ? (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ bgcolor: "primary.main" }}>
              <PersonIcon fontSize="small" />
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              New Customer
            </Typography>
          </Box>
        </Box>
      ) : selectedCustomer && (
        <Box>
          <SelectableListItem
            id={selectedCustomer.id}
            isSelected
            onClick={() => {}}
            primaryText={
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
                <Avatar sx={{ bgcolor: "primary.main" }}>
                  <PersonIcon fontSize="small" />
                </Avatar>
                <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5, minWidth: 0 }}>
                  <span>{`${selectedCustomer.title} ${selectedCustomer.customer_name}`}</span>
                  {selectedCustomer.company_name && (
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      {selectedCustomer.company_name}
                    </Typography>
                  )}
                </Box>
              </Box>
            }
            isFavorite={favorites.includes(selectedCustomer.id)}
            onToggleFavorite={(e) => toggleFavorite(selectedCustomer.id, e)}
          />
        </Box>
      )}
    </Paper>
  );

  // Detail Panel
  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Sales", href: "/sales" },
          { label: "Customers", href: "/sales/customers" },
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
        onCancel={handleCancelCustomer}
        onEdit={handleStartEdit}
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedCustomer && !isCreating ? (
          <EmptyState message="Select a customer from the list or create a new one" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={3} fieldsPerSection={6} showHeader={false} showToolbar={false} />
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
                {TITLE_CHOICES.map((option) => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
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
                {GENDER_CHOICES.map((option) => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
              </TextField>
              <TextField
                label="Civil Status"
                size="small"
                select
                value={formData.civil_status}
                onChange={(e) => setFormData({ ...formData, civil_status: e.target.value })}
                disabled={isDisabled}
              >
                {CIVIL_CHOICES.map((option) => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
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

            {/* Activity History (view mode only) */}
            {selectedCustomer && !isCreating && !isEditing && (
              <FormSection title="Activity History" columns={2}>
                <Box>
                  <Typography variant="caption" color="text.secondary">Created</Typography>
                  <Typography variant="body2">{formatDateTimeReadable(selectedCustomer.created_at) || "-"}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Last Modified</Typography>
                  <Typography variant="body2">{formatDateTimeReadable(selectedCustomer.updated_at) || "-"}</Typography>
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
        titleSlot={
          isCustomerDetailMode ? undefined : (
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
                sx={{ width: 220, flexShrink: 0 }}
              />
            </Box>
          )
        }
        onRefresh={refetch}
        isLoading={isLoading}
        {...(isCustomerDetailMode ? { masterPanel: singleCustomerPanel, detailPanel } : { children: customerTablePanel })}
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
              <TExportButton
                filename="customers"
                headers={[
                  "Customer Name",
                  "Company",
                  "Email",
                  "Mobile",
                  "Home Contact",
                  "ID Card No",
                  "Credit Days",
                  "Max Credit Limit",
                  "Credit Balance",
                  "Is Agent",
                  "Active",
                ]}
                rows={() =>
                  filteredCustomers.map((c) => [
                    c.customer_name || "",
                    c.company_name || "",
                    c.email || "",
                    c.mobile_contact_number || "",
                    c.home_contact_number || "",
                    c.id_card_number || "",
                    c.credit_days ?? 0,
                    c.max_credit_limit ?? 0,
                    c.left_credit_amount ?? "",
                    c.is_customer_agent ? "Yes" : "No",
                    c.active ? "Yes" : "No",
                  ])
                }
                disabled={filteredCustomers.length === 0}
              />
            </>
          )
        }
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
