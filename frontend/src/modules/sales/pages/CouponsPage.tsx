/**
 * CouponsPage - Complete Coupon/Discount Code Management
 * Features:
 * - Create coupons with barcode scanning
 * - Percent or fixed amount discounts
 * - Global and per-customer usage limits
 * - Product/Category validity restrictions
 * - Usage tracking and history
 */

import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import {
  Box,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  Switch,
  TextField,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Paper,
  Autocomplete,
  Chip,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";

import {
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  fmtLKR,
  FormSection,
  handleApiError,
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  showErrorToast,
  showSuccessToast,
  SortOption,
  TDetailSkeleton,
  TConfirmDialog,
  TSearchableSelect,
  useMasterDetailState,
  useTConfirmDialog,
  modernTableStyles,
} from "@/components/tijaero";

import { usePermission } from "@/auth/permissions";
import { couponsApi } from "@/modules/customers/api";
import { CustomerCuponCodes, CustomerCuponCodesCreate } from "@/modules/customers/types";
import { productsApi } from "@/modules/inventory/api";

// Configuration
const SORT_OPTIONS: SortOption[] = [
  { value: "cupon_code", label: "Coupon Code" },
  { value: "valid_until_date", label: "Expiry Date" },
  { value: "discount_value", label: "Discount Value" },
];

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "expiring_soon", label: "Expiring Soon" },
  { value: "inactive", label: "Inactive" },
  { value: "expired", label: "Expired" },
  { value: "exhausted", label: "Exhausted" },
];

const DISCOUNT_TYPE_OPTIONS = [
  { value: "PERCENT", label: "Percentage (%)" },
  { value: "AMOUNT", label: "Fixed Amount (Rs.)" },
];

const INITIAL_FORM_DATA: CustomerCuponCodesCreate = {
  cupon_code: "",
  description: "",
  discount_type: "PERCENT",
  discount_value: 0,
  minimum_invoice_amount: 0,
  limit_by_usage: 1000,
  limit_for_customer: 10,
  valid_until_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0], // 30 days from now
  active: true,
  limit_validity_product_id: undefined,
  product_ids: [],
};

const resetFormFromCoupon = (coupon: CustomerCuponCodes): CustomerCuponCodesCreate => ({
  cupon_code: coupon.cupon_code,
  description: coupon.description || "",
  discount_type: coupon.discount_type,
  discount_value: coupon.discount_value,
  minimum_invoice_amount: coupon.minimum_invoice_amount,
  limit_by_usage: coupon.limit_by_usage,
  limit_for_customer: coupon.limit_for_customer,
  valid_until_date: coupon.valid_until_date,
  active: coupon.active,
  limit_validity_product_id: coupon.limit_validity_product_id,
  product_ids: coupon.product_ids || [],
});

const getCouponStatus = (coupon: CustomerCuponCodes): string => {
  const today = new Date();
  const expiryDate = new Date(coupon.valid_until_date);
  const daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  
  if (!coupon.active) return "inactive";
  if (expiryDate < today) return "expired";
  if (coupon.usage_count && coupon.usage_count >= coupon.limit_by_usage) return "exhausted";
  if (daysUntilExpiry <= 7) return "expiring_soon";
  return "active";
};

export default function CouponsPage() {
  const queryClient = useQueryClient();
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Permissions
  const canCreate = usePermission("customers", "create");
  const canUpdate = usePermission("customers", "update");
  const canDelete = usePermission("customers", "delete");

  // Filter states
  const [filterStatus, setFilterStatus] = useState<string | null>(null);

  // Use reusable state hook
  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem: selectedCoupon,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    favorites,
    toggleFavorite,
    formData,
    setFormData,
    handleSelectItem: handleSelectCoupon,
    handleNew: handleNewCoupon,
    handleCancel: baseHandleCancel,
    handleStartEdit,
  } = useMasterDetailState<CustomerCuponCodes, CustomerCuponCodesCreate>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromCoupon,
    favoritesKey: "coupons_favorites",
    defaultSortField: "cupon_code",
  });

  // Data fetching
  const { data: coupons, isLoading, refetch } = useQuery({
    queryKey: ["coupons"],
    queryFn: () => couponsApi.getAll(),
  });

  // Fetch products for validity selection
  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => productsApi.getAll(),
  });

  // Fetch usage history for selected coupon
  const { data: usageHistory } = useQuery({
    queryKey: ["coupon-usage", selectedCoupon?.id],
    queryFn: () => selectedCoupon ? couponsApi.getUsageHistory(selectedCoupon.id) : Promise.resolve([]),
    enabled: !!selectedCoupon && !isCreating && !isEditing,
  });

  // Filter and sort
  const filteredCoupons = useMemo(() => {
    if (!coupons) return [];

    let filtered = coupons.filter(
      (coupon) =>
        coupon.cupon_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        coupon.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Apply status filter
    if (filterStatus) {
      filtered = filtered.filter((coupon) => getCouponStatus(coupon) === filterStatus);
    }

    filtered.sort((a, b) => {
      if (sortField === "cupon_code") {
        return a.cupon_code.localeCompare(b.cupon_code);
      } else if (sortField === "valid_until_date") {
        return new Date(a.valid_until_date).getTime() - new Date(b.valid_until_date).getTime();
      } else if (sortField === "discount_value") {
        return b.discount_value - a.discount_value;
      }
      return 0;
    });

    return filtered;
  }, [coupons, searchQuery, sortField, filterStatus]);

  // Auto-select first item when data loads
  useEffect(() => {
    if (filteredCoupons.length > 0 && !selectedCoupon && !isCreating) {
      handleSelectCoupon(filteredCoupons[0]);
    }
  }, [filteredCoupons, selectedCoupon, isCreating]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: couponsApi.create,
    onSuccess: (newCoupon) => {
      queryClient.invalidateQueries({ queryKey: ["coupons"] });
      showSuccessToast("Coupon created successfully");
      setIsCreating(false);
      setIsEditing(false);
      setTimeout(() => handleSelectCoupon(newCoupon), 0);
    },
    onError: (error: unknown) => showErrorToast(handleApiError(error, "Failed to create coupon")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: CustomerCuponCodesCreate }) =>
      couponsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coupons"] });
      showSuccessToast("Coupon updated successfully");
      setIsEditing(false);
    },
    onError: (error: unknown) => showErrorToast(handleApiError(error, "Failed to update coupon")),
  });

  const deleteMutation = useMutation({
    mutationFn: couponsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coupons"] });
      showSuccessToast("Coupon deleted successfully");
      baseHandleCancel(filteredCoupons);
    },
    onError: (error: unknown) => showErrorToast(handleApiError(error, "Failed to delete coupon")),
  });

  const confirmDialog = useTConfirmDialog();

  // Handlers
  const handleSave = useCallback(() => {
    // Validate
    if (!formData.cupon_code) {
      showErrorToast("Coupon code is required");
      return;
    }
    if (formData.discount_value <= 0) {
      showErrorToast("Discount value must be greater than 0");
      return;
    }
    if (formData.discount_type === "PERCENT" && formData.discount_value > 100) {
      showErrorToast("Percentage discount cannot exceed 100%");
      return;
    }

    if (isCreating) {
      createMutation.mutate(formData);
    } else if (selectedCoupon) {
      updateMutation.mutate({ id: selectedCoupon.id, data: formData });
    }
  }, [isCreating, selectedCoupon, formData, createMutation, updateMutation]);

  const handleDelete = useCallback(async () => {
    if (selectedCoupon) {
      const confirmed = await confirmDialog.confirm({
        title: "Delete Coupon",
        message: `Are you sure you want to delete coupon "${selectedCoupon.cupon_code}"? This cannot be undone.`,
        confirmText: "Delete",
        confirmColor: "error",
      });
      if (confirmed) {
        deleteMutation.mutate(selectedCoupon.id);
      }
    }
  }, [selectedCoupon, deleteMutation, confirmDialog]);

  const handleDuplicate = useCallback(() => {
    if (selectedCoupon) {
      setFormData({
        ...formData,
        cupon_code: `${selectedCoupon.cupon_code}-COPY`,
      });
      handleNewCoupon();
    }
  }, [selectedCoupon, formData, setFormData, handleNewCoupon]);

  // Handle barcode scan
  const handleBarcodeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // Barcode already set via onChange
    }
  };

  const isFormValid = formData.cupon_code && formData.discount_value > 0 && formData.valid_until_date;
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDisabled = !isEditing && !isCreating;

  // Master Panel
  const masterPanel = (
    <SearchableList<CustomerCuponCodes>
      items={filteredCoupons}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search coupons..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedCoupon}
      onSelectItem={handleSelectCoupon}
      emptyMessage="No coupons found"
      listHeader={
        <Box sx={{ p: 1, borderBottom: "1px solid", borderColor: "divider" }}>
          <TSearchableSelect
            label="Filter by Status"
            value={filterStatus}
            onChange={(val) => setFilterStatus(val as string | null)}
            options={STATUS_OPTIONS.map((opt) => ({
              value: opt.value,
              label: opt.label,
            }))}
            showAllOption
            allOptionLabel="All Statuses"
            placeholder="Search status..."
          />
        </Box>
      }
      renderItem={(coupon: CustomerCuponCodes, isSelected: boolean) => {
        const status = getCouponStatus(coupon);
        const discountText = coupon.discount_type === "PERCENT"
          ? `${coupon.discount_value}% Discount`
          : `Rs. ${coupon.discount_value.toLocaleString()} Discount`;
        
        return (
          <SelectableListItem
            key={coupon.id}
            isSelected={isSelected}
            onClick={() => handleSelectCoupon(coupon)}
            isFavorite={favorites.includes(coupon.id)}
            onToggleFavorite={() => toggleFavorite(coupon.id)}
            primaryText={
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
                {/* Coupon Code */}
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{coupon.cupon_code}</span>
                  {isSelected && (
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Coupon Code)
                    </Typography>
                  )}
                </Box>
                {/* Discount */}
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Typography
                    component="span"
                    variant="caption"
                    fontWeight={600}
                    sx={{ color: isSelected ? "common.white" : "text.primary" }}
                  >
                    {discountText}
                  </Typography>
                  {isSelected && (
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Discount)
                    </Typography>
                  )}
                </Box>
                {/* Additional details - only when selected */}
                {isSelected && (
                  <>
                    {coupon.description && (
                      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <Typography component="span" variant="caption">
                          {coupon.description}
                        </Typography>
                        <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                          (Description)
                        </Typography>
                      </Box>
                    )}
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {format(new Date(coupon.valid_until_date), "dd/MM/yyyy")}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Expires)
                      </Typography>
                    </Box>
                    {/* Status Chip - shown below all fields when selected */}
                    <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                      <Chip
                        label={status === "expiring_soon" ? "Expiring Soon" : status.charAt(0).toUpperCase() + status.slice(1)}
                        size="small"
                        color={
                          status === "active" ? "success" :
                          status === "expiring_soon" ? "warning" :
                          status === "expired" || status === "exhausted" ? "error" : "default"
                        }
                        sx={{ height: 18, fontSize: "0.65rem" }}
                      />
                    </Box>
                  </>
                )}
              </Box>
            }
            secondaryText={!isSelected ? `${format(new Date(coupon.valid_until_date), "dd/MM/yyyy")}${coupon.description ? ` • ${coupon.description}` : ''}` : undefined}
          />
        );
      }}
    />
  );

  // Detail Panel
  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Sales", href: "/sales" },
          { label: "Coupons", href: "/sales/coupons" },
          ...(selectedCoupon || isCreating
            ? [{ label: isCreating ? "New Coupon" : selectedCoupon?.cupon_code || "" }]
            : []),
        ]}
        title={selectedCoupon ? selectedCoupon.cupon_code : ""}
        titleIcon={<LocalOfferIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Coupon"
        noSelectionTitle="Select a Coupon"
        isFavorite={selectedCoupon ? favorites.includes(selectedCoupon.id) : false}
        onToggleFavorite={selectedCoupon ? (e) => toggleFavorite(selectedCoupon.id, e) : undefined}
      />

      <ActionToolbar
        canCreate={canCreate}
        canUpdate={canUpdate}
        canDelete={canDelete}
        hasSelectedItem={!!selectedCoupon}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={!!isFormValid}
        onNew={handleNewCoupon}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
        onSave={handleSave}
        onCancel={() => baseHandleCancel(filteredCoupons)}
        onEdit={handleStartEdit}
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedCoupon && !isCreating ? (
          <EmptyState message="Select a coupon from the list or create a new one" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} />
        ) : (
          <>
            {/* Coupon Code with Barcode Scanner */}
            <FormSection title="Coupon Code" icon={<QrCodeScannerIcon />} columns={2}>
              <TextField
                label="Coupon Code (Barcode)"
                size="small"
                value={formData.cupon_code}
                onChange={(e) =>
                  setFormData({ ...formData, cupon_code: e.target.value.toUpperCase() })
                }
                onKeyDown={handleBarcodeKeyDown}
                inputRef={barcodeInputRef}
                disabled={isDisabled}
                required
                placeholder="Scan barcode or enter code"
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <QrCodeScannerIcon color="action" />
                    </InputAdornment>
                  ),
                }}
                helperText="Scan pre-printed barcode or enter manually"
              />
              <TextField
                label="Description"
                size="small"
                value={formData.description || ""}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                disabled={isDisabled}
                placeholder="e.g., New Year Discount"
              />
            </FormSection>

            {/* Discount Settings */}
            <FormSection title="Discount Settings" columns={3}>
              <TextField
                select
                size="small"
                label="Discount Type"
                value={formData.discount_type}
                onChange={(e) =>
                  setFormData({ ...formData, discount_type: e.target.value as "PERCENT" | "AMOUNT" })
                }
                disabled={isDisabled}
                required
              >
                {DISCOUNT_TYPE_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                label={formData.discount_type === "PERCENT" ? "Discount %" : "Discount Amount (Rs.)"}
                type="number"
                value={formData.discount_value}
                onChange={(e) =>
                  setFormData({ ...formData, discount_value: parseFloat(e.target.value) || 0 })
                }
                disabled={isDisabled}
                required
                inputProps={{
                  min: 0,
                  max: formData.discount_type === "PERCENT" ? 100 : undefined,
                  step: formData.discount_type === "PERCENT" ? 1 : 0.01,
                }}
              />
              <TextField
                size="small"
                label="Minimum Invoice Amount (Rs.)"
                type="number"
                value={formData.minimum_invoice_amount || 0}
                onChange={(e) =>
                  setFormData({ ...formData, minimum_invoice_amount: parseFloat(e.target.value) || 0 })
                }
                disabled={isDisabled}
                inputProps={{ min: 0, step: 0.01 }}
                helperText="Minimum order amount required"
              />
            </FormSection>

            {/* Usage Limits */}
            <FormSection title="Usage Limits" columns={3}>
              <TextField
                size="small"
                label="Total Usage Limit"
                type="number"
                value={formData.limit_by_usage}
                onChange={(e) =>
                  setFormData({ ...formData, limit_by_usage: parseInt(e.target.value) || 1 })
                }
                disabled={isDisabled}
                required
                inputProps={{ min: 1 }}
                helperText="Max times coupon can be used globally"
              />
              <TextField
                size="small"
                label="Per Customer Limit"
                type="number"
                value={formData.limit_for_customer}
                onChange={(e) =>
                  setFormData({ ...formData, limit_for_customer: parseInt(e.target.value) || 1 })
                }
                disabled={isDisabled}
                required
                inputProps={{ min: 1 }}
                helperText="Max times per customer"
              />
              <TextField
                size="small"
                label="Valid Until"
                type="date"
                value={formData.valid_until_date}
                onChange={(e) => setFormData({ ...formData, valid_until_date: e.target.value })}
                disabled={isDisabled}
                required
                InputLabelProps={{ shrink: true }}
              />
            </FormSection>

            {/* Product Restriction & Status */}
            <FormSection title="Product Restriction & Status" columns={3}>
              <Autocomplete
                multiple
                size="small"
                options={products || []}
                getOptionLabel={(option) => `${option.name} (${option.item_code})`}
                value={(products || []).filter(p => (formData.product_ids || []).includes(p.id))}
                onChange={(_, newValue) => {
                  setFormData({
                    ...formData,
                    product_ids: newValue.map(p => p.id),
                  });
                }}
                disabled={isDisabled}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Exclude Products (Cannot Use Coupon)"
                    placeholder="Search products to exclude..."
                    helperText="Selected products CANNOT use this coupon"
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      {...getTagProps({ index })}
                      key={option.id}
                      label={option.name}
                      size="small"
                    />
                  ))
                }
              />
              <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formData.active ?? true}
                      onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                      disabled={isDisabled}
                    />
                  }
                  label="Coupon Active"
                />
              </Box>
            </FormSection>

            {/* Usage Statistics (View Only) */}
            {selectedCoupon && !isCreating && !isEditing && (
              <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5 }}>
                <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>
                  Usage Statistics
                </Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" }, gap: 2, mb: 2 }}>
                  <Paper variant="outlined" sx={{ textAlign: "center", p: 2, bgcolor: "action.hover" }}>
                    <Typography variant="h4" color="primary">
                      {selectedCoupon.usage_count || 0}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Times Used
                    </Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ textAlign: "center", p: 2, bgcolor: "action.hover" }}>
                    <Typography variant="h4" color="success.main">
                      {selectedCoupon.limit_by_usage - (selectedCoupon.usage_count || 0)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Remaining
                    </Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ textAlign: "center", p: 2, bgcolor: "action.hover" }}>
                    <Typography variant="h4">
                      {selectedCoupon.discount_type === "PERCENT"
                        ? `${selectedCoupon.discount_value}%`
                        : `Rs.${selectedCoupon.discount_value}`}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Discount
                    </Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ textAlign: "center", p: 2, bgcolor: "action.hover" }}>
                    <Typography variant="h4">
                      {(selectedCoupon.product_ids && selectedCoupon.product_ids.length > 0) 
                        ? `${selectedCoupon.product_ids.length} Excluded`
                        : selectedCoupon.limit_validity_product_id ? "1 Excluded" : "All Products"}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Product Restriction
                    </Typography>
                  </Paper>
                </Box>

                {/* Usage History Table */}
                {usageHistory && usageHistory.length > 0 && (
                  <Paper variant="outlined" sx={{ mt: 2 }}>
                    <Box sx={{ p: 1.5, bgcolor: "action.hover", borderBottom: 1, borderColor: "divider" }}>
                      <Typography variant="subtitle2">
                        Recent Usage History
                      </Typography>
                    </Box>
                    <Table size="small" sx={modernTableStyles}>
                      <TableHead>
                        <TableRow>
                          <TableCell>Date</TableCell>
                          <TableCell>Invoice No</TableCell>
                          <TableCell>Customer Name</TableCell>
                          <TableCell align="right">Discount Applied</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {usageHistory.slice(0, 10).map((usage) => (
                          <TableRow key={usage.id}>
                            <TableCell>
                              {format(new Date(usage.used_date), "dd MMM yyyy HH:mm")}
                            </TableCell>
                            <TableCell>{usage.invoice_no || `#${usage.invoice_id}`}</TableCell>
                            <TableCell>{usage.customer_name || `Customer #${usage.customer_id}`}</TableCell>
                            <TableCell align="right">
                              Rs. {fmtLKR(usage.discount_amount)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Paper>
                )}
              </Paper>
            )}
          </>
        )}
      </Box>
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title="Coupons"
        onRefresh={refetch}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
