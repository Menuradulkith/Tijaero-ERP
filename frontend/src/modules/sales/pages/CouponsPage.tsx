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
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import StarIcon from "@mui/icons-material/Star";
import StarOutlineIcon from "@mui/icons-material/StarBorder";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Paper,
  Autocomplete,
  Chip,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { format } from "date-fns";

import {
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  fmtLKR,
  FormSection,
  handleApiError,
  MasterDetailLayout,
  showErrorToast,
  showSuccessToast,
  TDetailSkeleton,
  TConfirmDialog,
  TSearchableSelect,
  useCrudMutation,
  useMasterDetailState,
  useTConfirmDialog,
  modernTableStyles,
  TDataGrid,
  type TDataGridColumn,
  SelectableListItem,
} from "@/components/tijaero";
import { formatDateTimeReadable } from "@/utils/formatters";
import { exportToCSV } from "@/utils/csvExport";
import DownloadIcon from "@mui/icons-material/FileDownload";

import { usePermission } from "@/auth/permissions";
import { couponsApi } from "@/modules/customers/api";
import { CustomerCuponCodes, CustomerCuponCodesCreate } from "@/modules/customers/types";
import { productsApi } from "@/modules/inventory/api";

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
  const canViewProducts = usePermission("products", "view");
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Permissions
  const canCreate = usePermission("customers", "create");
  const canUpdate = usePermission("customers", "update");
  const canDelete = usePermission("customers", "delete");

  // Filter state - all filters apply live as the user types/selects, no
  // separate "Search" step needed.
  const [filterStatus, setFilterStatus] = useState<string | null>(null);

  // Use reusable state hook
  const {
    searchQuery,
    setSearchQuery,
    selectedItem: selectedCoupon,
    setSelectedItem: setSelectedCoupon,
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

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterStatus(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Data fetching
  const { data: coupons, isLoading, refetch } = useQuery({
    queryKey: ["coupons"],
    queryFn: () => couponsApi.getAll(),
  });

  // Fetch products for validity selection
  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => productsApi.getAll(),
    enabled: canViewProducts,
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

    // Default order before the user sorts a column in the table itself
    // (the table's own column-header sort takes over from there).
    filtered.sort((a, b) => a.cupon_code.localeCompare(b.cupon_code));

    return filtered;
  }, [coupons, searchQuery, filterStatus]);

  // Mutations
  const createMutation = useCrudMutation({
    mutationFn: couponsApi.create,
    invalidateQueryKeys: [["coupons"]],
    successMessage: "Coupon created successfully",
    errorMessage: "Failed to create coupon",
    onSuccess: (newCoupon) => {
      setIsCreating(false);
      setIsEditing(false);
      setTimeout(() => handleSelectCoupon(newCoupon), 0);
    },
  });

  const updateMutation = useCrudMutation({
    mutationFn: ({ id, data }: { id: number; data: CustomerCuponCodesCreate }) =>
      couponsApi.update(id, data),
    invalidateQueryKeys: [["coupons"]],
    successMessage: "Coupon updated successfully",
    errorMessage: "Failed to update coupon",
    onSuccess: (updatedCoupon) => {
      setIsEditing(false);
      setSelectedCoupon(updatedCoupon);
    },
  });

  const deleteMutation = useCrudMutation({
    mutationFn: couponsApi.delete,
    invalidateQueryKeys: [["coupons"]],
    successMessage: "Coupon deleted successfully",
    errorMessage: "Failed to delete coupon",
    onSuccess: () => {
      setSelectedCoupon(null);
    },
  });

  const confirmDialog = useTConfirmDialog();

  // Handlers
  const handleExportCSV = () => {
    const headers = [
      "Coupon Code",
      "Description",
      "Discount Type",
      "Discount Value",
      "Min Invoice Amount",
      "Total Limit",
      "Usage Count",
      "Customer Limit",
      "Valid Until",
      "Status"
    ];

    const rows = filteredCoupons.map(coupon => [
      coupon.cupon_code,
      coupon.description || "",
      coupon.discount_type,
      coupon.discount_value,
      coupon.minimum_invoice_amount,
      coupon.limit_by_usage,
      coupon.usage_count || 0,
      coupon.limit_for_customer,
      coupon.valid_until_date ? new Date(coupon.valid_until_date).toLocaleDateString() : "",
      getCouponStatus(coupon)
    ]);

    exportToCSV({
      filename: `coupons_${new Date().toISOString().split("T")[0]}`,
      headers,
      rows
    });
  };

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

  // Whether we're showing a single coupon's detail view (selected or being
  // created) instead of the browse table.
  const isCouponDetailMode = !!selectedCoupon || isCreating;

  // Returns to the browse table from the detail view.
  const handleBackToCoupons = useCallback(() => {
    setSelectedCoupon(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [isCreating, setSelectedCoupon, setIsCreating, setIsEditing]);

  // Cancelling out of "New Coupon" should return to the browse table, not
  // auto-open the first coupon the way useMasterDetailState's generic
  // handleCancel does (that made sense for the old always-visible detail
  // panel, but not here). Cancelling out of editing an existing coupon
  // still just reverts its form, which the generic handler already does
  // correctly.
  const handleCancelCoupon = useCallback(() => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedCoupon(null);
    } else {
      baseHandleCancel(filteredCoupons);
    }
  }, [isCreating, filteredCoupons, baseHandleCancel, setIsCreating, setIsEditing, setSelectedCoupon]);

  // The table sorts by whichever column the user clicks; the Status column
  // displays a computed value (not stored on the record), so it needs that
  // value as its own field for the grid to sort on correctly.
  const couponRows = useMemo(
    () =>
      filteredCoupons.map((coupon) => ({
        ...coupon,
        computed_status: getCouponStatus(coupon),
      })),
    [filteredCoupons]
  );

  // Browse mode: a full-width table of every coupon. Sorting is done
  // per-column via the grid's own column header menu, not a separate
  // "Sort by" control.
  const couponColumns: TDataGridColumn<(typeof couponRows)[number]>[] = useMemo(
    () => [
      {
        field: "favorite",
        header: "",
        width: 48,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<(typeof couponRows)[number]>) => (
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
        field: "cupon_code",
        header: "Coupon Code",
        flex: 1,
        minWidth: 160,
        renderCell: (params: GridRenderCellParams<(typeof couponRows)[number]>) => (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, height: "100%" }}>
            <LocalOfferIcon fontSize="small" color="action" />
            <Typography variant="body2" fontWeight={600}>
              {params.row.cupon_code}
            </Typography>
          </Box>
        ),
      },
      {
        field: "discount_value",
        header: "Discount",
        width: 150,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<(typeof couponRows)[number]>) =>
          params.row.discount_type === "PERCENT"
            ? `${params.row.discount_value}%`
            : `Rs. ${params.row.discount_value.toLocaleString()}`,
      },
      {
        field: "created_date",
        header: "Issue Date",
        width: 130,
        renderCell: (params: GridRenderCellParams<(typeof couponRows)[number]>) =>
          params.row.created_date ? format(new Date(params.row.created_date), "dd/MM/yyyy") : "-",
      },
      {
        field: "valid_until_date",
        header: "Expiry",
        width: 130,
        renderCell: (params: GridRenderCellParams<(typeof couponRows)[number]>) =>
          format(new Date(params.row.valid_until_date), "dd/MM/yyyy"),
      },
      {
        field: "computed_status",
        header: "Status",
        width: 130,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<(typeof couponRows)[number]>) => {
          const status = params.row.computed_status;
          return (
            <Chip
              label={status === "expiring_soon" ? "Expiring Soon" : status.charAt(0).toUpperCase() + status.slice(1)}
              size="small"
              color={
                status === "active" ? "success" :
                status === "expiring_soon" ? "warning" :
                status === "expired" || status === "exhausted" ? "error" : "default"
              }
            />
          );
        },
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<(typeof couponRows)[number]>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectCoupon(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [favorites, toggleFavorite, handleSelectCoupon]
  );

  const couponTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid
          rows={couponRows}
          columns={couponColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectCoupon(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No coupons found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Detail mode: a narrow left panel showing only the current coupon (or
  // the "New Coupon" placeholder while creating), with a "Back to
  // Coupons" link returning to the table.
  const singleCouponPanel = (
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
          onClick={handleBackToCoupons}
          sx={{ textTransform: "none" }}
        >
          Back to Coupons
        </Button>
      </Box>
      {isCreating ? (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ bgcolor: "primary.main" }}>
              <LocalOfferIcon />
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              New Coupon
            </Typography>
          </Box>
        </Box>
      ) : selectedCoupon && (
        <SelectableListItem
          id={selectedCoupon.id}
          isSelected
          onClick={() => {}}
          primaryText={
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
              <Avatar sx={{ bgcolor: "primary.main" }}>
                <LocalOfferIcon />
              </Avatar>
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0 }}>
                <span>{selectedCoupon.cupon_code}</span>
              </Box>
            </Box>
          }
          isFavorite={favorites.includes(selectedCoupon.id)}
          onToggleFavorite={(e) => toggleFavorite(selectedCoupon.id, e)}
        />
      )}
    </Paper>
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
        onCancel={handleCancelCoupon}
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

            {/* Activity History (view mode only) */}
            {selectedCoupon && !isCreating && !isEditing && (
              <FormSection title="Activity History" columns={2}>
                <Box>
                  <Typography variant="caption" color="text.secondary">Created</Typography>
                  <Typography variant="body2">{formatDateTimeReadable(selectedCoupon.created_date) || "-"}</Typography>
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
        title="Coupons"
        titleSlot={
          isCouponDetailMode ? undefined : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search coupons..."
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
              <Box sx={{ width: 170, flexShrink: 0 }}>
                <TSearchableSelect
                  label=""
                  value={filterStatus}
                  onChange={(val) => setFilterStatus(val as string | null)}
                  options={STATUS_OPTIONS.map((opt) => ({
                    value: opt.value,
                    label: opt.label,
                  }))}
                  showAllOption
                  allOptionLabel="All Statuses"
                  placeholder="All Statuses"
                  size="small"
                  fullWidth
                />
              </Box>
              {(searchQuery || filterStatus) && (
                <Tooltip title="Clear filters">
                  <IconButton size="small" onClick={handleClearFilters}>
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          )
        }
        headerActions={
          isCouponDetailMode ? undefined : (
            <>
              {canCreate && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={handleNewCoupon}
                  sx={{ mr: 1 }}
                >
                  Add Coupon
                </Button>
              )}
              <Button
                variant="outlined"
                size="small"
                startIcon={<DownloadIcon />}
                onClick={handleExportCSV}
                disabled={filteredCoupons.length === 0}
                sx={{ mr: 1 }}
              >
                Export CSV
              </Button>
            </>
          )
        }
        onRefresh={refetch}
        isLoading={isLoading}
        {...(isCouponDetailMode
          ? { masterPanel: singleCouponPanel, detailPanel }
          : { children: couponTablePanel })}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
