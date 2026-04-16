/**
 * Customer Advance Payments Page
 * 
 * Master-Detail layout for managing customer advance payments.
 * Follows the Purchasing/Sales UI pattern with Tijaero components.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Autocomplete,
  Box,
  Chip,
  InputAdornment,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import {
  AccountBalanceWallet as WalletIcon,
} from "@mui/icons-material";

import {
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  DetailPanelHeader,
  ActionToolbar,
  FormSection,
  EmptyState,
  handleApiError,
  useMasterDetailState,
  showErrorToast,
  showSuccessToast,
  SortOption,
  TDetailSkeleton,
  TBranchFilter,
  TFilterPanel,
  GENERIC_PAYMENT_METHOD,
  TConfirmDialog,
  useConfirmDialog,
  fmtLKR,
} from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";

import { advancePaymentsApi } from "@/modules/finance/api";
import { customersApi } from "@/modules/customers/api";
import { CustomerAdvancePayment, CustomerAdvancePaymentCreate } from "@/modules/finance/types";
import { useReferenceData } from "@/hooks";

// Types
interface Branch {
  branch_code: string;
  branch_name: string;
}

interface Customer {
  id: number;
  customer_name: string;
  company_name?: string;
}

const SORT_OPTIONS: SortOption[] = [
  { value: "created_date", label: "Date" },
  { value: "advance_payments_no", label: "Payment No" },
  { value: "payment_amount", label: "Amount" },
];

const INITIAL_FORM_DATA: Partial<CustomerAdvancePaymentCreate> = {
  advance_payments_no: "",
  payment_method: "cash",
  branch_code: "",
  payment_amount: 0,
  remarks: "",
  customer_id: 0,
  cheque_date: new Date().toISOString().split("T")[0],
  active: true,
};

const resetFormFromItem = (item: CustomerAdvancePayment): Partial<CustomerAdvancePaymentCreate> => ({
  advance_payments_no: item.advance_payments_no || "",
  payment_method: item.payment_method || "cash",
  branch_code: item.branch_code || "",
  payment_amount: Number(item.payment_amount) || 0,
  remarks: item.remarks || "",
  customer_id: item.customer_id || 0,
  cheque_date: item.cheque_date?.split("T")[0] || new Date().toISOString().split("T")[0],
  active: item.active ?? true,
});

export default function CustomerAdvancePaymentsPage() {
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();
  const canViewCustomers = usePermission("customers", "view");

  // Validation state
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const handleBlur = (fieldName: string) => {
    setTouched((prev) => ({ ...prev, [fieldName]: true }));
  };

  // Filter states
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    favorites,
    toggleFavorite,
    formData,
    setFormData,
    handleSelectItem,
    handleNew,
    handleCancel,
  } = useMasterDetailState<CustomerAdvancePayment, Partial<CustomerAdvancePaymentCreate>>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromItem,
    favoritesKey: "customer_advance_payments_favorites",
    defaultSortField: "created_date",
    confirmUnsavedChanges: () =>
      confirmDialog.confirm({
        title: "Discard Changes",
        message: "You have unsaved changes. Discard them?",
        confirmText: "Discard",
        cancelText: "Keep Editing",
        confirmColor: "warning",
      }),
  });

  // Reference data
  const { filteredBranches, defaultBranchCode } = useReferenceData(["branches"]);
  const branches: Branch[] = filteredBranches || [];

  // Auto-default branch filter for non-superuser users
  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  // Fetch customers
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.getAll(),
    enabled: canViewCustomers,
  });

  // Fetch customer advance payments
  const {
    data: advances = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["customer-advance-payments", filterBranch],
    queryFn: () =>
      advancePaymentsApi.getAll({
        branch_code: filterBranch ?? undefined,
      }),
    enabled: branchResolved,
    placeholderData: (prev) => prev,
  });

  // Filtered & sorted list
  const filteredAdvances = useMemo(() => {
    if (!advances) return [];

    let filtered = advances.filter(
      (adv) =>
        (adv.advance_payments_no || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(adv.id).includes(searchQuery)
    );

    // Sort
    filtered.sort((a, b) => {
      if (sortField === "created_date") {
        return new Date(b.created_date || "").getTime() - new Date(a.created_date || "").getTime();
      }
      if (sortField === "payment_amount") {
        return Number(b.payment_amount || 0) - Number(a.payment_amount || 0);
      }
      const fieldA = a[sortField as keyof CustomerAdvancePayment] || "";
      const fieldB = b[sortField as keyof CustomerAdvancePayment] || "";
      return String(fieldA).localeCompare(String(fieldB));
    });

    return filtered;
  }, [advances, searchQuery, sortField]);

  // Auto-select first item
  useEffect(() => {
    if (filteredAdvances.length > 0 && !selectedItem && !isCreating) {
      handleSelectItem(filteredAdvances[0]);
    }
  }, [filteredAdvances, selectedItem, isCreating]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: CustomerAdvancePaymentCreate) => advancePaymentsApi.create(data),
    onSuccess: (newItem) => {
      queryClient.invalidateQueries({ queryKey: ["customer-advance-payments"] });
      showSuccessToast("Customer advance payment recorded successfully");
      setIsCreating(false);
      setIsEditing(false);
      setTouched({});
      setTimeout(() => handleSelectItem(newItem), 0);
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to record advance payment"));
    },
  });

  // Helper functions
  const getCustomerName = useCallback(
    (customerId: number) => {
      const customer = customers.find((c: Customer) => c.id === customerId);
      return customer?.customer_name || `Customer #${customerId}`;
    },
    [customers]
  );

  // Validation
  const getFieldError = (fieldName: string): string | undefined => {
    if (!touched[fieldName] && !isCreating) return undefined;

    switch (fieldName) {
      case "customer_id":
        if (!formData.customer_id || formData.customer_id === 0) return "Customer is required";
        break;
      case "advance_payments_no":
        if (!formData.advance_payments_no) return "Payment number is required";
        break;
      case "branch_code":
        if (!formData.branch_code) return "Branch is required";
        break;
      case "payment_amount":
        if (!formData.payment_amount || formData.payment_amount <= 0) return "Amount must be greater than 0";
        break;
      case "cheque_date":
        if (!formData.cheque_date) return "Payment date is required";
        break;
    }
    return undefined;
  };

  const hasError = (fieldName: string): boolean => !!getFieldError(fieldName);

  const isFormValid =
    !!formData.customer_id &&
    formData.customer_id > 0 &&
    !!formData.advance_payments_no &&
    !!formData.branch_code &&
    !!formData.payment_amount &&
    formData.payment_amount > 0 &&
    !!formData.cheque_date;

  const isSaving = createMutation.isPending;

  const handleSave = useCallback(() => {
    if (isCreating) {
      createMutation.mutate(formData as CustomerAdvancePaymentCreate);
    }
  }, [isCreating, formData, createMutation]);

  const handleNewAdvance = useCallback(() => {
    handleNew();
    if (defaultBranchCode) {
      setFormData(prev => ({ ...prev, branch_code: defaultBranchCode }));
    }
    setTouched({});
  }, [handleNew, defaultBranchCode, setFormData]);

  const handleSelectWithCheck = useCallback(
    async (item: CustomerAdvancePayment) => {
      await handleSelectItem(item);
      setTouched({});
    },
    [handleSelectItem]
  );

  // Master panel
  const masterPanel = (
    <SearchableList<CustomerAdvancePayment>
      items={filteredAdvances}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search advances..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedItem}
      onSelectItem={handleSelectWithCheck}
      emptyMessage="No customer advance payments found"
      listHeader={
        <TFilterPanel>
          <TBranchFilter
            branches={branches}
            value={filterBranch}
            onChange={setFilterBranch}
          />
        </TFilterPanel>
      }
      renderItem={(adv, isSelected) => (
        <SelectableListItem
          key={adv.id}
          id={adv.id}
          isSelected={isSelected}
          onClick={() => handleSelectWithCheck(adv)}
          primaryText={
            <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
              {/* Payment No */}
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{adv.advance_payments_no || `ADV-${adv.id}`}</span>
                {isSelected && (
                  <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                    (Payment No)
                  </Typography>
                )}
              </Box>
              {/* Additional fields when selected */}
              {isSelected && (
                <>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      {getCustomerName(adv.customer_id)}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Customer)
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      Rs. {fmtLKR(Number(adv.payment_amount || 0))}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Amount)
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      {adv.cheque_date ? new Date(adv.cheque_date).toLocaleDateString() : "-"}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Date)
                    </Typography>
                  </Box>
                  {/* Status Chip */}
                  <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                    <Chip
                      label={adv.active ? "Active" : "Inactive"}
                      size="small"
                      color={adv.active ? "success" : "default"}
                      sx={{ height: 18, fontSize: "0.65rem" }}
                    />
                  </Box>
                </>
              )}
            </Box>
          }
          secondaryText={
            !isSelected
              ? `${getCustomerName(adv.customer_id)} - Rs. ${fmtLKR(Number(adv.payment_amount || 0))}`
              : undefined
          }
          isFavorite={favorites.includes(adv.id)}
          onToggleFavorite={(e) => toggleFavorite(adv.id, e)}
          statusChip={
            !isSelected
              ? adv.active
                ? { label: "Active", color: "success" }
                : { label: "Inactive", color: "default" }
              : undefined
          }
        />
      )}
    />
  );

  // Detail panel
  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Finance", href: "/finance" },
          { label: "Advance Payments", href: "/finance/advance-payments" },
          { label: "Customer Advances", href: "/finance/advance-payments/customer" },
          ...(selectedItem || isCreating
            ? [{ label: isCreating ? "New Advance" : selectedItem?.advance_payments_no || `ADV-${selectedItem?.id}` }]
            : []),
        ]}
        title={selectedItem ? (selectedItem.advance_payments_no || `ADV-${selectedItem.id}`) : ""}
        titleIcon={<WalletIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Customer Advance Payment"
        noSelectionTitle="Select an Advance Payment"
        isFavorite={selectedItem ? favorites.includes(selectedItem.id) : false}
        onToggleFavorite={selectedItem ? (e) => toggleFavorite(selectedItem.id, e) : undefined}
      />

      <ActionToolbar
        hasSelectedItem={!!selectedItem}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={isFormValid}
        onNew={handleNewAdvance}
        onSave={handleSave}
        onCancel={() => handleCancel(filteredAdvances)}
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedItem && !isCreating ? (
          <EmptyState message="Select a customer advance payment from the list or create a new one" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} />
        ) : (
          <>
            <FormSection title="Payment Information" columns={3}>
              <TextField
                label="Payment Number"
                size="small"
                value={formData.advance_payments_no || ""}
                onChange={(e) => setFormData({ ...formData, advance_payments_no: e.target.value })}
                onBlur={() => handleBlur("advance_payments_no")}
                disabled={!isEditing && !isCreating}
                required
                error={hasError("advance_payments_no")}
                helperText={getFieldError("advance_payments_no")}
              />
              <Autocomplete
                size="small"
                options={customers}
                getOptionLabel={(option: Customer) =>
                  option.company_name
                    ? `${option.customer_name} (${option.company_name})`
                    : option.customer_name || ""
                }
                value={customers.find((c: Customer) => c.id === formData.customer_id) || null}
                onChange={(_, newValue: Customer | null) => {
                  setFormData({ ...formData, customer_id: newValue?.id || 0 });
                  handleBlur("customer_id");
                }}
                disabled={!isEditing && !isCreating}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Customer"
                    required
                    error={hasError("customer_id")}
                    helperText={getFieldError("customer_id")}
                  />
                )}
              />
              <Autocomplete
                size="small"
                options={branches}
                getOptionLabel={(option: Branch) => `${option.branch_code} - ${option.branch_name}`}
                value={branches.find((b) => b.branch_code === formData.branch_code) || null}
                onChange={(_, newValue) => {
                  setFormData({ ...formData, branch_code: newValue?.branch_code || "" });
                  handleBlur("branch_code");
                }}
                disabled={!isEditing && !isCreating}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Branch"
                    required
                    error={hasError("branch_code")}
                    helperText={getFieldError("branch_code")}
                  />
                )}
              />
            </FormSection>

            <FormSection title="Payment Details" columns={3}>
              <TextField
                select
                label="Payment Method"
                size="small"
                value={formData.payment_method || "cash"}
                onChange={(e) => setFormData({ ...formData, payment_method: e.target.value })}
                disabled={!isEditing && !isCreating}
              >
                {GENERIC_PAYMENT_METHOD.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Amount"
                size="small"
                type="number"
                value={formData.payment_amount || ""}
                onChange={(e) => setFormData({ ...formData, payment_amount: parseFloat(e.target.value) || 0 })}
                onBlur={() => handleBlur("payment_amount")}
                disabled={!isEditing && !isCreating}
                required
                error={hasError("payment_amount")}
                helperText={getFieldError("payment_amount")}
                InputProps={{
                  startAdornment: <InputAdornment position="start">Rs.</InputAdornment>,
                }}
                inputProps={{ min: 0, step: 0.01 }}
              />
              <TextField
                label="Payment Date"
                size="small"
                type="date"
                value={formData.cheque_date || ""}
                onChange={(e) => setFormData({ ...formData, cheque_date: e.target.value })}
                onBlur={() => handleBlur("cheque_date")}
                disabled={!isEditing && !isCreating}
                InputLabelProps={{ shrink: true }}
                required
                error={hasError("cheque_date")}
                helperText={getFieldError("cheque_date")}
              />
            </FormSection>

            {/* View-only status section */}
            {selectedItem && !isCreating && (
              <FormSection title="Status" columns={3}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography variant="body2" color="text.secondary">Status:</Typography>
                  <Chip
                    label={selectedItem.active ? "Active" : "Inactive"}
                    size="small"
                    color={selectedItem.active ? "success" : "default"}
                  />
                </Box>
                <TextField
                  label="Created Date"
                  size="small"
                  value={selectedItem.created_date ? new Date(selectedItem.created_date).toLocaleString() : "-"}
                  disabled
                  InputProps={{ readOnly: true }}
                />
                <TextField
                  label="Branch"
                  size="small"
                  value={selectedItem.branch_code || "-"}
                  disabled
                  InputProps={{ readOnly: true }}
                />
              </FormSection>
            )}

            <FormSection title="Remarks" columns={1}>
              <TextField
                label="Remarks"
                size="small"
                value={formData.remarks || ""}
                onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                disabled={!isEditing && !isCreating}
                multiline
                rows={2}
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
        title="Customer Advance Payments"
        onRefresh={refetch}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
