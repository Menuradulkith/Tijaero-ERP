/**
 * Supplier Advance Payments Page
 * 
 * Master-Detail layout for managing supplier advance payments.
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
  CheckCircle as CheckCircleIcon,
} from "@mui/icons-material";
import { ConfirmDialog, useConfirmDialog } from "@/components/ConfirmDialog";

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
  TBranchFilter,
  TFilterPanel,
  TSupplierFilter,
  GENERIC_PAYMENT_METHOD,
} from "@/components/tijaero";

import { suppliersApi, supplierAdvancePaymentsApi } from "@/modules/purchasing/api";
import {
  SupplierAdvancePayment,
  SupplierAdvancePaymentCreate,
} from "@/modules/purchasing/types";
import { useReferenceData } from "@/hooks";

// Types
interface Branch {
  branch_code: string;
  branch_name: string;
}

interface Supplier {
  id: number;
  full_name: string;
  company_name?: string;
}

const SORT_OPTIONS: SortOption[] = [
  { value: "created_at", label: "Date" },
  { value: "advance_no", label: "Advance No" },
  { value: "original_amount", label: "Amount" },
];

const INITIAL_FORM_DATA: Partial<SupplierAdvancePaymentCreate> = {
  supplier_id: 0,
  payment_date: new Date().toISOString().split("T")[0],
  payment_method: "Bank Transfer",
  original_amount: 0,
  reference_number: "",
  bank_name: "",
  branch_code: "",
  remarks: "",
};

const resetFormFromItem = (item: SupplierAdvancePayment): Partial<SupplierAdvancePaymentCreate> => ({
  supplier_id: item.supplier_id || 0,
  payment_date: item.payment_date?.split("T")[0] || new Date().toISOString().split("T")[0],
  payment_method: item.payment_method || "Bank Transfer",
  original_amount: Number(item.original_amount) || 0,
  reference_number: item.reference_number || "",
  bank_name: item.bank_name || "",
  branch_code: item.branch_code || "",
  remarks: item.remarks || "",
});

export default function SupplierAdvancePaymentsPage() {
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();

  // Validation state
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const handleBlur = (fieldName: string) => {
    setTouched((prev) => ({ ...prev, [fieldName]: true }));
  };

  // Filter states
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterSupplier, setFilterSupplier] = useState<number | null>(null);

  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem,
    setSelectedItem,
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
  } = useMasterDetailState<SupplierAdvancePayment, Partial<SupplierAdvancePaymentCreate>>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromItem,
    favoritesKey: "supplier_advance_payments_favorites",
    defaultSortField: "created_at",
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
  const { data: refData } = useReferenceData(["branches"]);
  const branches: Branch[] = refData?.branches || [];

  // Fetch suppliers
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => suppliersApi.getAll(),
  });

  // Fetch supplier advance payments
  const {
    data: advances = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["supplier-advance-payments", filterBranch, filterSupplier],
    queryFn: () =>
      supplierAdvancePaymentsApi.getAll({
        branch_code: filterBranch ?? undefined,
        supplier_id: filterSupplier ?? undefined,
      }),
  });

  // Filtered & sorted list
  const filteredAdvances = useMemo(() => {
    if (!advances) return [];

    let filtered = advances.filter(
      (adv) =>
        (adv.advance_no || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (adv.supplier_name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(adv.id).includes(searchQuery)
    );

    // Sort
    filtered.sort((a, b) => {
      if (sortField === "created_at") {
        return new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
      }
      if (sortField === "original_amount") {
        return Number(b.original_amount || 0) - Number(a.original_amount || 0);
      }
      const fieldA = a[sortField as keyof SupplierAdvancePayment] || "";
      const fieldB = b[sortField as keyof SupplierAdvancePayment] || "";
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
    mutationFn: (data: SupplierAdvancePaymentCreate) => supplierAdvancePaymentsApi.create(data),
    onSuccess: (newItem) => {
      queryClient.invalidateQueries({ queryKey: ["supplier-advance-payments"] });
      showSuccessToast("Supplier advance payment created successfully");
      setIsCreating(false);
      setIsEditing(false);
      setTouched({});
      setTimeout(() => handleSelectItem(newItem), 0);
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to create advance payment"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => supplierAdvancePaymentsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-advance-payments"] });
      showSuccessToast("Advance payment deleted successfully");
      setSelectedItem(null);
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to delete advance payment"));
    },
  });

  // Helper functions
  const getSupplierName = useCallback(
    (supplierId: number) => {
      const supplier = suppliers.find((s: Supplier) => s.id === supplierId);
      return supplier?.full_name || supplier?.company_name || `Supplier #${supplierId}`;
    },
    [suppliers]
  );

  // Delete handler
  const handleDelete = useCallback(async () => {
    if (selectedItem && !selectedItem.is_fully_applied && Number(selectedItem.applied_amount) === 0) {
      const confirmed = await confirmDialog.confirm({
        title: "Delete Advance Payment",
        message: `Are you sure you want to delete advance "${selectedItem.advance_no}"? This action cannot be undone.`,
        confirmText: "Delete",
        confirmColor: "error",
      });
      if (confirmed) {
        deleteMutation.mutate(selectedItem.id);
      }
    } else {
      showErrorToast("Cannot delete an advance that has been applied");
    }
  }, [selectedItem, deleteMutation, confirmDialog]);

  // Can delete check
  const canDelete = !!(
    selectedItem &&
    !selectedItem.is_fully_applied &&
    Number(selectedItem.applied_amount) === 0
  );

  // Validation
  const getFieldError = (fieldName: string): string | undefined => {
    if (!touched[fieldName] && !isCreating) return undefined;

    switch (fieldName) {
      case "supplier_id":
        if (!formData.supplier_id || formData.supplier_id === 0) return "Supplier is required";
        break;
      case "branch_code":
        if (!formData.branch_code) return "Branch is required";
        break;
      case "original_amount":
        if (!formData.original_amount || formData.original_amount <= 0) return "Amount must be greater than 0";
        break;
      case "payment_date":
        if (!formData.payment_date) return "Payment date is required";
        break;
    }
    return undefined;
  };

  const hasError = (fieldName: string): boolean => !!getFieldError(fieldName);

  const isFormValid =
    !!formData.supplier_id &&
    formData.supplier_id > 0 &&
    !!formData.branch_code &&
    !!formData.original_amount &&
    formData.original_amount > 0 &&
    !!formData.payment_date;

  const isSaving = createMutation.isPending;

  const handleSave = useCallback(() => {
    if (isCreating) {
      createMutation.mutate(formData as SupplierAdvancePaymentCreate);
    }
  }, [isCreating, formData, createMutation]);

  const handleNewAdvance = useCallback(() => {
    handleNew();
    setTouched({});
  }, [handleNew]);

  const handleSelectWithCheck = useCallback(
    async (item: SupplierAdvancePayment) => {
      await handleSelectItem(item);
      setTouched({});
    },
    [handleSelectItem]
  );

  // Master panel
  const masterPanel = (
    <SearchableList<SupplierAdvancePayment>
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
      emptyMessage="No supplier advance payments found"
      listHeader={
        <TFilterPanel>
          <TBranchFilter
            branches={branches}
            value={filterBranch}
            onChange={setFilterBranch}
          />
          <TSupplierFilter
            suppliers={suppliers || []}
            value={filterSupplier}
            onChange={setFilterSupplier}
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
              {/* Advance No */}
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{adv.advance_no || `ADV-${adv.id}`}</span>
                {isSelected && (
                  <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                    (Advance No)
                  </Typography>
                )}
              </Box>
              {/* Additional fields when selected */}
              {isSelected && (
                <>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      {adv.supplier_name || getSupplierName(adv.supplier_id)}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Supplier)
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      Rs. {Number(adv.original_amount || 0).toLocaleString("en-LK", { minimumFractionDigits: 2 })}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Original)
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption" sx={{ color: "success.main" }}>
                      Rs. {Number(adv.remaining_amount || 0).toLocaleString("en-LK", { minimumFractionDigits: 2 })}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Remaining)
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      {adv.payment_date ? new Date(adv.payment_date).toLocaleDateString() : "-"}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Date)
                    </Typography>
                  </Box>
                  {/* Status Chip */}
                  <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                    <Chip
                      label={adv.is_fully_applied ? "Fully Applied" : "Active"}
                      size="small"
                      color={adv.is_fully_applied ? "default" : "success"}
                      sx={{ height: 18, fontSize: "0.65rem" }}
                    />
                  </Box>
                </>
              )}
            </Box>
          }
          secondaryText={
            !isSelected
              ? `${adv.supplier_name || getSupplierName(adv.supplier_id)} - Rs. ${Number(adv.original_amount || 0).toLocaleString("en-LK", { minimumFractionDigits: 2 })}`
              : undefined
          }
          isFavorite={favorites.includes(adv.id)}
          onToggleFavorite={(e) => toggleFavorite(adv.id, e)}
          statusChip={
            !isSelected
              ? adv.is_fully_applied
                ? { label: "Fully Applied", color: "default" }
                : { label: "Active", color: "success" }
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
          { label: "Supplier Advances", href: "/finance/advance-payments/supplier" },
          ...(selectedItem || isCreating
            ? [{ label: isCreating ? "New Advance" : selectedItem?.advance_no || `ADV-${selectedItem?.id}` }]
            : []),
        ]}
        title={selectedItem ? (selectedItem.advance_no || `ADV-${selectedItem.id}`) : ""}
        titleIcon={<WalletIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Supplier Advance Payment"
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
        onDelete={canDelete ? handleDelete : undefined}
        canDelete={canDelete}
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedItem && !isCreating ? (
          <EmptyState message="Select a supplier advance payment from the list or create a new one" />
        ) : (
          <>
            <FormSection title="Supplier Information" columns={3}>
              <Autocomplete
                size="small"
                options={suppliers}
                getOptionLabel={(option: Supplier) =>
                  option.company_name
                    ? `${option.full_name} (${option.company_name})`
                    : option.full_name || ""
                }
                value={suppliers.find((s: Supplier) => s.id === formData.supplier_id) || null}
                onChange={(_, newValue: Supplier | null) => {
                  setFormData({ ...formData, supplier_id: newValue?.id || 0 });
                  handleBlur("supplier_id");
                }}
                disabled={!isEditing && !isCreating}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Supplier"
                    required
                    error={hasError("supplier_id")}
                    helperText={getFieldError("supplier_id")}
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
              <TextField
                label="Payment Date"
                size="small"
                type="date"
                value={formData.payment_date || ""}
                onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
                onBlur={() => handleBlur("payment_date")}
                disabled={!isEditing && !isCreating}
                InputLabelProps={{ shrink: true }}
                required
                error={hasError("payment_date")}
                helperText={getFieldError("payment_date")}
              />
            </FormSection>

            <FormSection title="Payment Details" columns={3}>
              <TextField
                select
                label="Payment Method"
                size="small"
                value={formData.payment_method || "Bank Transfer"}
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
                value={formData.original_amount || ""}
                onChange={(e) => setFormData({ ...formData, original_amount: parseFloat(e.target.value) || 0 })}
                onBlur={() => handleBlur("original_amount")}
                disabled={!isEditing && !isCreating}
                required
                error={hasError("original_amount")}
                helperText={getFieldError("original_amount")}
                InputProps={{
                  startAdornment: <InputAdornment position="start">Rs.</InputAdornment>,
                }}
                inputProps={{ min: 0, step: 0.01 }}
              />
              {/* Conditional fields for Bank Transfer / Cheque */}
              {(formData.payment_method === "Bank Transfer" || formData.payment_method === "Cheque") && (
                <TextField
                  label={formData.payment_method === "Cheque" ? "Cheque Number" : "Reference Number"}
                  size="small"
                  value={formData.reference_number || ""}
                  onChange={(e) => setFormData({ ...formData, reference_number: e.target.value })}
                  disabled={!isEditing && !isCreating}
                />
              )}
            </FormSection>

            {/* Bank info for Bank Transfer / Cheque */}
            {(formData.payment_method === "Bank Transfer" || formData.payment_method === "Cheque") && (
              <FormSection title="Bank Information" columns={3}>
                <TextField
                  label="Bank Name"
                  size="small"
                  value={formData.bank_name || ""}
                  onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                  disabled={!isEditing && !isCreating}
                />
              </FormSection>
            )}

            {/* View-only amount tracking section */}
            {selectedItem && !isCreating && (
              <FormSection title="Amount Tracking" columns={4}>
                <TextField
                  label="Original Amount"
                  size="small"
                  value={`Rs. ${Number(selectedItem.original_amount || 0).toLocaleString("en-LK", { minimumFractionDigits: 2 })}`}
                  disabled
                  InputProps={{ readOnly: true }}
                />
                <TextField
                  label="Applied Amount"
                  size="small"
                  value={`Rs. ${Number(selectedItem.applied_amount || 0).toLocaleString("en-LK", { minimumFractionDigits: 2 })}`}
                  disabled
                  InputProps={{ readOnly: true }}
                  sx={{
                    "& .MuiInputBase-input.Mui-disabled": {
                      WebkitTextFillColor: "orange",
                    },
                  }}
                />
                <TextField
                  label="Remaining Amount"
                  size="small"
                  value={`Rs. ${Number(selectedItem.remaining_amount || 0).toLocaleString("en-LK", { minimumFractionDigits: 2 })}`}
                  disabled
                  InputProps={{ readOnly: true }}
                  sx={{
                    "& .MuiInputBase-input.Mui-disabled": {
                      WebkitTextFillColor: "green",
                      fontWeight: "bold",
                    },
                  }}
                />
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography variant="body2" color="text.secondary">Status:</Typography>
                  <Chip
                    label={selectedItem.is_fully_applied ? "Fully Applied" : "Active"}
                    size="small"
                    color={selectedItem.is_fully_applied ? "default" : "success"}
                    icon={selectedItem.is_fully_applied ? <CheckCircleIcon /> : undefined}
                  />
                </Box>
              </FormSection>
            )}

            {/* Tracking info */}
            {selectedItem && !isCreating && (
              <FormSection title="Tracking" columns={2}>
                <TextField
                  label="Created Date"
                  size="small"
                  value={selectedItem.created_at ? new Date(selectedItem.created_at).toLocaleString() : "-"}
                  disabled
                  InputProps={{ readOnly: true }}
                />
                <TextField
                  label="Last Updated"
                  size="small"
                  value={selectedItem.updated_at ? new Date(selectedItem.updated_at).toLocaleString() : "-"}
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
        title="Supplier Advance Payments"
        onRefresh={refetch}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />
      <ConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
