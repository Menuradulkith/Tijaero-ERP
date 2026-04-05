/**
 * VouchersPage - Gift Voucher Management
 * Features:
 * - Create and manage gift vouchers
 * - Barcode-based voucher codes
 * - Balance tracking and partial redemption
 * - Expiry date management
 * - Usage history tracking
 */

import ReceiptIcon from "@mui/icons-material/Receipt";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import {
  Box,
  InputAdornment,
  MenuItem,
  TextField,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Paper,
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
  TPrintButton,
  TPrintPreviewDialog,
  useMasterDetailState,
  useTConfirmDialog,
  modernTableStyles,
} from "@/components/tijaero";
import { formatDateTimeReadable } from "@/utils/formatters";


import { usePermission } from "@/auth/permissions";
import { useReferenceData } from "@/hooks";
import { vouchersApi } from "@/modules/customers/api";
import { CustomerGiftVoucher, CustomerGiftVoucherCreate, VoucherUsage } from "@/modules/customers/types";

// Configuration
const SORT_OPTIONS: SortOption[] = [
  { value: "barcode_no", label: "Voucher Code" },
  { value: "date", label: "Issue Date" },
  { value: "amount", label: "Amount" },
  { value: "balance", label: "Balance" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "expiring_soon", label: "Expiring Soon" },
  { value: "fully_claimed", label: "Fully Claimed" },
  { value: "expired", label: "Expired" },
];

const VALIDITY_OPTIONS = [
  { value: 6, label: "6 Months" },
  { value: 12, label: "12 Months (1 Year)" },
  { value: 18, label: "18 Months" },
  { value: 24, label: "24 Months (2 Years)" },
  { value: 36, label: "36 Months (3 Years)" },
];

const INITIAL_FORM_DATA: CustomerGiftVoucherCreate = {
  barcode_no: "",
  amount: 0,
  valid_period_in_months: 12,
  purchased_invoice_no: "",
  payment_method: "cash",
  branch_code: "",
  customer_name: "",
};

const resetFormFromVoucher = (voucher: CustomerGiftVoucher): CustomerGiftVoucherCreate => ({
  barcode_no: voucher.barcode_no,
  amount: voucher.amount,
  valid_period_in_months: voucher.valid_period_in_months,
  purchased_invoice_no: voucher.purchased_invoice_no,
  payment_method: "cash",
  branch_code: "",
  customer_name: "",
});

const getVoucherStatus = (voucher: CustomerGiftVoucher): string => {
  const expiryDate = calculateExpiryDate(voucher.date, voucher.valid_period_in_months);
  const today = new Date();
  
  if (voucher.status === "fully_claimed") return "fully_claimed";
  if (expiryDate < today) return "expired";
  if (voucher.balance <= 0) return "fully_claimed";
  const daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (daysUntilExpiry <= 30 && daysUntilExpiry > 0) return "expiring_soon";
  return "active";
};

const calculateExpiryDate = (issueDate: string, months: number): Date => {
  const date = new Date(issueDate);
  date.setMonth(date.getMonth() + months);
  return date;
};

export default function VouchersPage() {
  const queryClient = useQueryClient();
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Permissions
  const canCreate = usePermission("customers", "create");
  const canUpdate = usePermission("customers", "update");
  const canDelete = usePermission("customers", "delete");

  // Filter states
  const [filterStatus, setFilterStatus] = useState<string>("");

  // Use reusable state hook
  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem: selectedVoucher,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    favorites,
    toggleFavorite,
    formData,
    setFormData,
    handleSelectItem: handleSelectVoucher,
    handleNew: handleNewVoucher,
    handleCancel: baseHandleCancel,
    handleStartEdit,
  } = useMasterDetailState<CustomerGiftVoucher, CustomerGiftVoucherCreate>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromVoucher,
    favoritesKey: "vouchers_favorites",
    defaultSortField: "barcode_no",
  });

  // Data fetching
  const { filteredBranches, defaultBranchCode } = useReferenceData(["branches"]);
  const branches = filteredBranches || [];

  // Set default branch when creating new voucher
  useEffect(() => {
    if (isCreating && defaultBranchCode && !formData.branch_code) {
      setFormData(prev => ({ ...prev, branch_code: defaultBranchCode }));
    }
  }, [isCreating, defaultBranchCode, formData.branch_code, setFormData]);

  const { data: vouchers, isLoading, refetch } = useQuery({
    queryKey: ["vouchers"],
    queryFn: () => vouchersApi.getAll(),
  });

  // Fetch usage history for selected voucher
  const { data: usageHistory } = useQuery({
    queryKey: ["voucher-usage", selectedVoucher?.id],
    queryFn: () => selectedVoucher ? vouchersApi.getUsageHistory(selectedVoucher.id) : Promise.resolve([]),
    enabled: !!selectedVoucher && !isCreating && !isEditing,
  });

  // Filter and sort
  const filteredVouchers = useMemo(() => {
    if (!vouchers) return [];

    let filtered = vouchers.filter(
      (voucher) =>
        voucher.barcode_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
        voucher.purchased_invoice_no?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Apply status filter
    if (filterStatus) {
      filtered = filtered.filter((voucher) => getVoucherStatus(voucher) === filterStatus);
    }

    filtered.sort((a, b) => {
      if (sortField === "barcode_no") {
        return a.barcode_no.localeCompare(b.barcode_no);
      } else if (sortField === "date") {
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      } else if (sortField === "amount") {
        return b.amount - a.amount;
      } else if (sortField === "balance") {
        return b.balance - a.balance;
      }
      return 0;
    });

    return filtered;
  }, [vouchers, searchQuery, sortField, filterStatus]);

  // Auto-select first item when data loads
  useEffect(() => {
    if (filteredVouchers.length > 0 && !selectedVoucher && !isCreating) {
      handleSelectVoucher(filteredVouchers[0]);
    }
  }, [filteredVouchers, selectedVoucher, isCreating]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: vouchersApi.create,
    onSuccess: async (newVoucher) => {
      await queryClient.invalidateQueries({ queryKey: ["vouchers"] });
      showSuccessToast(`Voucher ${newVoucher.barcode_no} created successfully`);
      setIsCreating(false);
      handleSelectVoucher(newVoucher);
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to create voucher"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      vouchersApi.update(id, data),
    onSuccess: async (updatedVoucher) => {
      await queryClient.invalidateQueries({ queryKey: ["vouchers"] });
      showSuccessToast("Voucher updated successfully");
      setIsEditing(false);
      handleSelectVoucher(updatedVoucher);
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to update voucher"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: vouchersApi.delete,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["vouchers"] });
      showSuccessToast("Voucher deleted successfully");
      baseHandleCancel(filteredVouchers);
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to delete voucher"));
    },
  });

  // Handlers
  const handleSave = useCallback(() => {
    if (!formData.barcode_no.trim()) {
      showErrorToast("Voucher code is required");
      return;
    }
    if (formData.amount <= 0) {
      showErrorToast("Amount must be greater than 0");
      return;
    }

    if (isEditing && selectedVoucher) {
      updateMutation.mutate({
        id: selectedVoucher.id,
        data: {
          amount: formData.amount,
          valid_period_in_months: formData.valid_period_in_months,
        },
      });
    } else {
      createMutation.mutate(formData);
    }
  }, [formData, isEditing, selectedVoucher]);

  const confirmDialog = useTConfirmDialog();
  const [printDialogOpen, setPrintDialogOpen] = useState(false);

  const handleDelete = useCallback(async () => {
    if (!selectedVoucher) return;

    const confirmed = await confirmDialog.confirm({
      title: "Delete Voucher",
      message: `Are you sure you want to delete voucher ${selectedVoucher.barcode_no}?`,
      confirmText: "Delete",
      confirmColor: "error",
    });
    if (confirmed) {
      deleteMutation.mutate(selectedVoucher.id);
    }
  }, [selectedVoucher, confirmDialog, deleteMutation]);

  // Duplicate voucher
  const handleDuplicate = useCallback(() => {
    if (!selectedVoucher) return;
    setIsCreating(true);
    setFormData({
      ...resetFormFromVoucher(selectedVoucher),
      barcode_no: "", // Clear barcode for new voucher
    });
  }, [selectedVoucher, setFormData, setIsCreating]);

  // Barcode scanning - auto-focus
  useEffect(() => {
    if (isCreating && barcodeInputRef.current) {
      barcodeInputRef.current.focus();
    }
  }, [isCreating]);

  const handleBarcodeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // Move to amount field
    }
  };

  const getStatusColor = (status: string): "success" | "default" | "error" | "warning" => {
    switch (status) {
      case "active":
        return "success";
      case "expiring_soon":
        return "warning";
      case "fully_claimed":
        return "default";
      case "expired":
        return "error";
      default:
        return "default";
    }
  };

  // Computed states
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isFormValid = formData.barcode_no.trim() && formData.amount > 0;
  const isDisabled = !isEditing && !isCreating;

  // Master Panel
  const masterPanel = (
    <SearchableList<CustomerGiftVoucher>
      items={filteredVouchers}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search by voucher code or invoice..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedVoucher}
      onSelectItem={handleSelectVoucher}
      emptyMessage="No vouchers found"
      listHeader={
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider" }}>
          <TextField
            select
            size="small"
            label="Filter by Status"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            fullWidth
          >
            {STATUS_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        </Box>
      }
      renderItem={(voucher: CustomerGiftVoucher, isSelected: boolean) => {
        const status = getVoucherStatus(voucher);
        const expiryDate = calculateExpiryDate(voucher.date, voucher.valid_period_in_months);
        
        return (
          <SelectableListItem
            key={voucher.id}
            isSelected={isSelected}
            onClick={() => handleSelectVoucher(voucher)}
            isFavorite={favorites.includes(voucher.id)}
            onToggleFavorite={() => toggleFavorite(voucher.id)}
            primaryText={
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
                {/* Voucher Code */}
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{voucher.barcode_no}</span>
                  {isSelected && (
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Voucher Code)
                    </Typography>
                  )}
                </Box>
                {/* Amount */}
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Typography
                    component="span"
                    variant="caption"
                    fontWeight={600}
                    sx={{ color: isSelected ? "common.white" : "text.primary" }}
                  >
                    Rs. {fmtLKR(voucher.amount)}
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
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {format(expiryDate, "dd/MM/yyyy")}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Expires)
                      </Typography>
                    </Box>
                    {/* Status Chip - shown below all fields when selected */}
                    <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                      <Chip
                        label={status === "expiring_soon" ? "Expiring Soon" : status.charAt(0).toUpperCase() + status.slice(1).replace("_", " ")}
                        size="small"
                        color={getStatusColor(status)}
                        sx={{ height: 18, fontSize: "0.65rem" }}
                      />
                    </Box>
                  </>
                )}
              </Box>
            }
            secondaryText={!isSelected ? `${format(expiryDate, "dd/MM/yyyy")}${voucher.purchased_invoice_no ? ` • ${voucher.purchased_invoice_no}` : ''}` : undefined}
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
          { label: "Gift Vouchers", href: "/sales/vouchers" },
          ...(selectedVoucher || isCreating
            ? [{ label: isCreating ? "New Voucher" : selectedVoucher?.barcode_no || "" }]
            : []),
        ]}
        title={selectedVoucher ? selectedVoucher.barcode_no : ""}
        titleIcon={<ReceiptIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Voucher"
        noSelectionTitle="Select a Voucher"
        isFavorite={selectedVoucher ? favorites.includes(selectedVoucher.id) : false}
        onToggleFavorite={selectedVoucher ? (e) => toggleFavorite(selectedVoucher.id, e) : undefined}
      />

      <ActionToolbar
        canCreate={canCreate}
        canUpdate={canUpdate}
        canDelete={canDelete}
        hasSelectedItem={!!selectedVoucher}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={!!isFormValid}
        onNew={handleNewVoucher}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
        onSave={handleSave}
        onCancel={() => baseHandleCancel(filteredVouchers)}
        onEdit={handleStartEdit}
        endActions={
          selectedVoucher && !isCreating && !isEditing ? (
            <TPrintButton
              documentType="voucher"
              documentId={selectedVoucher.id}
              tooltip="Print Voucher"
              onClick={() => setPrintDialogOpen(true)}
            />
          ) : undefined
        }
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedVoucher && !isCreating ? (
          <EmptyState message="Select a voucher from the list or create a new one" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} />
        ) : (
          <>
            {/* Voucher Code with Barcode Scanner */}
            <FormSection title="Voucher Code" icon={<QrCodeScannerIcon />} columns={2}>
              <TextField
                label="Voucher Code (Barcode)"
                size="small"
                value={formData.barcode_no}
                onChange={(e) =>
                  setFormData({ ...formData, barcode_no: e.target.value.toUpperCase() })
                }
                onKeyDown={handleBarcodeKeyDown}
                inputRef={barcodeInputRef}
                disabled={!isCreating}
                required
                placeholder="Scan barcode or enter code"
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <QrCodeScannerIcon color="action" />
                    </InputAdornment>
                  ),
                }}
                helperText={isEditing ? "Voucher code cannot be changed" : "Scan pre-printed barcode or enter manually"}
              />
              <TextField
                label="Linked Invoice No"
                size="small"
                value={formData.purchased_invoice_no || ""}
                onChange={(e) => setFormData({ ...formData, purchased_invoice_no: e.target.value })}
                disabled={isDisabled}
                placeholder="e.g., INV-2024-001"
                helperText="Invoice where voucher was purchased"
              />
            </FormSection>

            {/* Voucher Value Settings */}
            <FormSection title="Voucher Value" columns={3}>
              <TextField
                size="small"
                label="Voucher Amount (Rs.)"
                type="number"
                value={formData.amount}
                onChange={(e) =>
                  setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })
                }
                disabled={isDisabled}
                required
                inputProps={{ min: 0, step: 100 }}
                InputProps={{
                  startAdornment: <InputAdornment position="start">Rs.</InputAdornment>,
                }}
              />
              <TextField
                select
                size="small"
                label="Validity Period"
                value={formData.valid_period_in_months}
                onChange={(e) =>
                  setFormData({ ...formData, valid_period_in_months: parseInt(e.target.value) || 12 })
                }
                disabled={isDisabled}
                required
              >
                {VALIDITY_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </TextField>
              {selectedVoucher && !isCreating && (
                <TextField
                  size="small"
                  label="Current Balance (Rs.)"
                  value={fmtLKR(selectedVoucher.balance)}
                  disabled
                  InputProps={{
                    startAdornment: <InputAdornment position="start">Rs.</InputAdornment>,
                    readOnly: true,
                  }}
                />
              )}
            </FormSection>

            {/* Payment Details - Only when creating */}
            {isCreating && (
              <FormSection title="Payment Details (for Cashbook)" columns={2}>
                <TextField
                  select
                  size="small"
                  label="Payment Method"
                  value={formData.payment_method || "cash"}
                  onChange={(e) =>
                    setFormData({ ...formData, payment_method: e.target.value })
                  }
                  required
                >
                  <MenuItem value="cash">Cash</MenuItem>
                  <MenuItem value="card">Card</MenuItem>
                  <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
                  <MenuItem value="cheque">Cheque</MenuItem>
                </TextField>
                <TextField
                  select
                  size="small"
                  label="Branch"
                  value={formData.branch_code || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, branch_code: e.target.value })
                  }
                  required
                >
                  {branches.map((branch: { branch_code: string; branch_name: string }) => (
                    <MenuItem key={branch.branch_code} value={branch.branch_code}>
                      {branch.branch_code} - {branch.branch_name}
                    </MenuItem>
                  ))}
                </TextField>
              </FormSection>
            )}

            {/* Usage Statistics (View Only) */}
            {selectedVoucher && !isCreating && !isEditing && (
              <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5 }}>
                <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>
                  Usage Statistics
                </Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" }, gap: 2, mb: 2 }}>
                  <Paper variant="outlined" sx={{ textAlign: "center", p: 2, bgcolor: "action.hover" }}>
                    <Typography variant="h4" color="primary">
                      Rs. {fmtLKR(selectedVoucher.amount)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Original Amount
                    </Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ textAlign: "center", p: 2, bgcolor: "action.hover" }}>
                    <Typography variant="h4" color="success.main">
                      Rs. {fmtLKR(selectedVoucher.balance)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Remaining Balance
                    </Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ textAlign: "center", p: 2, bgcolor: "action.hover" }}>
                    <Typography variant="h4" color="error.main">
                      Rs. {fmtLKR(selectedVoucher.amount - selectedVoucher.balance)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Amount Used
                    </Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ textAlign: "center", p: 2, bgcolor: "action.hover" }}>
                    <Typography variant="h4">
                      {usageHistory?.length || 0}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Redemptions
                    </Typography>
                  </Paper>
                </Box>

                {/* Usage History Table */}
                {usageHistory && usageHistory.length > 0 && (
                  <Paper variant="outlined" sx={{ mt: 2 }}>
                    <Box sx={{ p: 1.5, bgcolor: "action.hover", borderBottom: 1, borderColor: "divider" }}>
                      <Typography variant="subtitle2">
                        Redemption History
                      </Typography>
                    </Box>
                    <Table size="small" sx={modernTableStyles}>
                      <TableHead>
                        <TableRow>
                          <TableCell>Date</TableCell>
                          <TableCell>Invoice No</TableCell>
                          <TableCell align="right">Amount Redeemed</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {usageHistory.slice(0, 10).map((usage: VoucherUsage) => (
                          <TableRow key={usage.id}>
                            <TableCell>
                              {format(new Date(usage.used_date), "dd MMM yyyy HH:mm")}
                            </TableCell>
                            <TableCell>{usage.invoice_no || `#${usage.invoice_id}`}</TableCell>
                            <TableCell align="right">
                              Rs. {fmtLKR(usage.amount_used)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Paper>
                )}
              </Paper>
            )}

            {/* Record Information (view mode only) */}
            {selectedVoucher && !isCreating && !isEditing && (
              <FormSection title="Record Information" columns={2}>
                <Box>
                  <Typography variant="caption" color="text.secondary">Created</Typography>
                  <Typography variant="body2">{formatDateTimeReadable(selectedVoucher.created_at) || "-"}</Typography>
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
        title="Gift Vouchers"
        onRefresh={refetch}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />

      {/* Print Preview Dialog */}
      {selectedVoucher && (
        <TPrintPreviewDialog
          open={printDialogOpen}
          onClose={() => setPrintDialogOpen(false)}
          documentType="voucher"
          documentId={selectedVoucher.id}
          title={`Print Voucher: ${selectedVoucher.barcode_no}`}
        />
      )}
    </>
  );
}
