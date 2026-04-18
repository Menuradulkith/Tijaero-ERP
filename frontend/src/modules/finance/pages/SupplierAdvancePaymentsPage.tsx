/**
 * Supplier Advance Payments Page
 * 
 * Master-Detail layout for managing supplier advance payments.
 * Follows the Purchasing/Sales UI pattern with Tijaero components.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
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
  TSupplierFilter,
  GENERIC_PAYMENT_METHOD,
  TConfirmDialog,
  useConfirmDialog,
  useCrudMutation,
  fmtLKR,
} from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";

import { suppliersApi, supplierAdvancePaymentsApi, supplierCreditApi } from "@/modules/purchasing/api";
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

interface EligibleAdvancePOOption {
  po_id: number;
  po_no: string;
  supplier_id: number;
  supplier_name: string;
  branch_code: string;
  remaining_amount: number;
}

const SORT_OPTIONS: SortOption[] = [
  { value: "created_at", label: "Date" },
  { value: "advance_no", label: "Advance No" },
  { value: "original_amount", label: "Amount" },
];

const INITIAL_FORM_DATA: Partial<SupplierAdvancePaymentCreate> = {
  supplier_id: 0,
  purchasing_order_id: undefined,
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
  purchasing_order_id: item.purchasing_order_id,
  payment_date: item.payment_date?.split("T")[0] || new Date().toISOString().split("T")[0],
  payment_method: item.payment_method || "Bank Transfer",
  original_amount: Number(item.original_amount) || 0,
  reference_number: item.reference_number || "",
  bank_name: item.bank_name || "",
  branch_code: item.branch_code || "",
  remarks: item.remarks || "",
});

export default function SupplierAdvancePaymentsPage() {
  const confirmDialog = useConfirmDialog();
  const canViewSuppliers = usePermission("suppliers", "view");

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
  const { filteredBranches, defaultBranchCode } = useReferenceData(["branches"]);
  const branches: Branch[] = filteredBranches || [];

  // Auto-default branch filter for non-superuser users
  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  // Fetch suppliers
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => suppliersApi.getAll(),
    enabled: canViewSuppliers,
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
    enabled: branchResolved,
    placeholderData: (prev) => prev,
  });

  // Fetch full selected advance detail for accurate tracking values
  const { data: selectedAdvanceDetail } = useQuery({
    queryKey: ["supplier-advance-detail", selectedItem?.id],
    queryFn: () => supplierAdvancePaymentsApi.getById(selectedItem!.id),
    enabled: !!selectedItem?.id && !isCreating,
    placeholderData: (prev) => prev,
  });

  const detailAdvance = selectedAdvanceDetail || selectedItem;

  // Fetch payment status for selected advance supplier to derive linked PO totals
  const { data: selectedSupplierPaymentStatus } = useQuery({
    queryKey: ["selected-advance-supplier-payment-status", detailAdvance?.supplier_id],
    queryFn: () => supplierCreditApi.getPaymentStatus(detailAdvance!.supplier_id),
    enabled: !!detailAdvance?.supplier_id && !isCreating,
    placeholderData: (prev) => prev,
  });

  const linkedPONonCreditStatus = useMemo(() => {
    if (!detailAdvance?.purchasing_order_id) return null;
    return (
      selectedSupplierPaymentStatus?.non_credit_purchase_orders?.find(
        (po) => po.po_id === detailAdvance.purchasing_order_id
      ) || null
    );
  }, [detailAdvance?.purchasing_order_id, selectedSupplierPaymentStatus]);

  const trackingOriginalAmount = linkedPONonCreditStatus
    ? Number(linkedPONonCreditStatus.total_amount || 0)
    : Number(detailAdvance?.original_amount || 0);

  const trackingAppliedAmount = Number(detailAdvance?.original_amount || 0);

  const trackingRemainingAmount = Math.max(0, trackingOriginalAmount - trackingAppliedAmount);

  // Fetch eligible PO list globally for PO-first advance flow
  const { data: eligibleAdvancePOs = [] } = useQuery({
    queryKey: ["eligible-advance-pos", suppliers.length],
    queryFn: async (): Promise<EligibleAdvancePOOption[]> => {
      const statuses = await Promise.all(
        suppliers.map(async (supplier: Supplier) => {
          try {
            return await supplierCreditApi.getPaymentStatus(supplier.id);
          } catch {
            return null;
          }
        })
      );

      const options: EligibleAdvancePOOption[] = [];
      for (const status of statuses) {
        if (!status) continue;
        for (const po of status.non_credit_purchase_orders || []) {
          const isEligible = po.status === "approved" && !po.has_grn && po.remaining_amount > 0;
          if (!isEligible) continue;
          options.push({
            po_id: po.po_id,
            po_no: po.po_no,
            supplier_id: status.supplier_id,
            supplier_name: status.supplier_name,
            branch_code: po.branch_code,
            remaining_amount: po.remaining_amount,
          });
        }
      }

      options.sort((a, b) => a.po_no.localeCompare(b.po_no));
      return options;
    },
    enabled: isCreating && suppliers.length > 0,
  });

  const selectedPOOption = useMemo(
    () => eligibleAdvancePOs.find((po) => po.po_id === formData.purchasing_order_id) || null,
    [eligibleAdvancePOs, formData.purchasing_order_id]
  );

  useEffect(() => {
    if (!isCreating || !selectedPOOption) return;
    setFormData((prev) => ({
      ...prev,
      purchasing_order_id: selectedPOOption.po_id,
      supplier_id: selectedPOOption.supplier_id,
      branch_code: selectedPOOption.branch_code,
      original_amount: prev.original_amount && prev.original_amount > 0 ? prev.original_amount : selectedPOOption.remaining_amount,
    }));
  }, [isCreating, selectedPOOption, setFormData]);

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
  const createMutation = useCrudMutation({
    mutationFn: (data: SupplierAdvancePaymentCreate) => supplierAdvancePaymentsApi.create(data),
    invalidateQueryKeys: [["supplier-advance-payments"]],
    successMessage: "Supplier advance payment created successfully",
    errorMessage: "Failed to create advance payment",
    onSuccess: (newItem) => {
      setIsCreating(false);
      setIsEditing(false);
      setTouched({});
      setTimeout(() => handleSelectItem(newItem), 0);
    },
  });

  const deleteMutation = useCrudMutation({
    mutationFn: (id: number) => supplierAdvancePaymentsApi.delete(id),
    invalidateQueryKeys: [["supplier-advance-payments"]],
    successMessage: "Advance payment deleted successfully",
    errorMessage: "Failed to delete advance payment",
    onSuccess: () => {
      setSelectedItem(null);
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
      case "purchasing_order_id":
        if (!formData.purchasing_order_id) return "Purchase Order is required";
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
    !!formData.purchasing_order_id &&
    formData.purchasing_order_id > 0 &&
    !!formData.branch_code &&
    !!formData.original_amount &&
    formData.original_amount > 0 &&
    !!formData.payment_date;

  const isSaving = createMutation.isPending;

  const handleSave = useCallback(() => {
    if (isCreating) {
      const selectedPO = eligibleAdvancePOs.find((po) => po.po_id === formData.purchasing_order_id);
      if (!selectedPO) {
        showErrorToast("Please select an approved non-credit PO without GRN");
        return;
      }

      if (formData.original_amount && formData.original_amount > selectedPO.remaining_amount) {
        showErrorToast(`Advance amount cannot exceed PO remaining amount: Rs. ${fmtLKR(selectedPO.remaining_amount)}`);
        return;
      }

      createMutation.mutate(formData as SupplierAdvancePaymentCreate);
    }
  }, [isCreating, formData, createMutation, eligibleAdvancePOs]);

  const handleNewAdvance = useCallback(() => {
    handleNew();
    if (defaultBranchCode) {
      setFormData(prev => ({ ...prev, branch_code: defaultBranchCode }));
    }
    setTouched({});
  }, [handleNew, defaultBranchCode, setFormData]);

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
                      Rs. {fmtLKR(Number(adv.original_amount || 0))}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Original)
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption" sx={{ color: "success.main" }}>
                      Rs. {fmtLKR(Number(adv.remaining_amount || 0))}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Remaining)
                    </Typography>
                  </Box>
                  {adv.purchasing_order_id && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {adv.po_no || `PO #${adv.purchasing_order_id}`}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Purchase Order)
                      </Typography>
                    </Box>
                  )}
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
              ? `${adv.supplier_name || getSupplierName(adv.supplier_id)}${adv.po_no ? ` • ${adv.po_no}` : adv.purchasing_order_id ? ` • PO #${adv.purchasing_order_id}` : ""} - Rs. ${fmtLKR(Number(adv.original_amount || 0))}`
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
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} />
        ) : (
          <>
            <FormSection title="Purchase Order Information" columns={3}>
              <Autocomplete
                size="small"
                options={eligibleAdvancePOs}
                getOptionLabel={(option) => `${option.po_no} - ${option.supplier_name} - Rs. ${fmtLKR(option.remaining_amount)} Remaining`}
                value={selectedPOOption}
                onChange={(_, newValue) => {
                  setFormData((prev) => ({
                    ...prev,
                    purchasing_order_id: newValue?.po_id,
                    supplier_id: newValue?.supplier_id || 0,
                    branch_code: newValue?.branch_code || "",
                    original_amount: newValue ? newValue.remaining_amount : 0,
                  }));
                  handleBlur("purchasing_order_id");
                }}
                disabled={!isEditing && !isCreating}
                noOptionsText="No approved non-credit pre-GRN POs found"
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Purchase Order"
                    required
                    error={hasError("purchasing_order_id")}
                    helperText={getFieldError("purchasing_order_id") || "Select PO first to auto-fill supplier and branch"}
                  />
                )}
              />
              <Autocomplete
                size="small"
                options={suppliers}
                getOptionLabel={(option: Supplier) =>
                  option.company_name
                    ? `${option.full_name} (${option.company_name})`
                    : option.full_name || ""
                }
                value={suppliers.find((s: Supplier) => s.id === formData.supplier_id) || null}
                onChange={() => undefined}
                disabled
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
                onChange={() => undefined}
                disabled
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

            {detailAdvance && detailAdvance.purchasing_order_id && !isCreating && (
              <FormSection title="Linked Purchase Order" columns={2}>
                <TextField
                  label="PO ID"
                  size="small"
                  value={detailAdvance.purchasing_order_id}
                  disabled
                  InputProps={{ readOnly: true }}
                />
                <TextField
                  label="PO Number"
                  size="small"
                  value={detailAdvance.po_no || "-"}
                  disabled
                  InputProps={{ readOnly: true }}
                />
              </FormSection>
            )}

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
            {detailAdvance && !isCreating && (
              <FormSection title="Amount Tracking" columns={4}>
                <TextField
                  label="Original Amount"
                  size="small"
                  value={`Rs. ${fmtLKR(trackingOriginalAmount)}`}
                  disabled
                  InputProps={{ readOnly: true }}
                />
                <TextField
                  label="Applied Amount"
                  size="small"
                  value={`Rs. ${fmtLKR(trackingAppliedAmount)}`}
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
                  value={`Rs. ${fmtLKR(trackingRemainingAmount)}`}
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
                    label={trackingRemainingAmount <= 0 ? "Fully Applied" : "Active"}
                    size="small"
                    color={trackingRemainingAmount <= 0 ? "default" : "success"}
                    icon={trackingRemainingAmount <= 0 ? <CheckCircleIcon /> : undefined}
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
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
