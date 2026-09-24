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
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import StarIcon from "@mui/icons-material/Star";
import StarOutlineIcon from "@mui/icons-material/StarBorder";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import {
  Avatar,
  Box,
  Button,
  IconButton,
  InputAdornment,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Paper,
  Chip,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
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
  showErrorToast,
  showSuccessToast,
  TDataGrid,
  type TDataGridColumn,
  TDetailSkeleton,
  TConfirmDialog,
  TPrintButton,
  TPrintPreviewDialog,
  useCrudMutation,
  useMasterDetailState,
  useTConfirmDialog,
  modernTableStyles,
  SelectableListItem,
} from "@/components/tijaero";
import { formatDateTimeReadable } from "@/utils/formatters";
import { exportToCSV } from "@/utils/csvExport";
import DownloadIcon from "@mui/icons-material/FileDownload";


import { usePermission } from "@/auth/permissions";
import { useReferenceData } from "@/hooks";
import { vouchersApi } from "@/modules/customers/api";
import { CustomerGiftVoucher, CustomerGiftVoucherCreate, VoucherUsage } from "@/modules/customers/types";

// Configuration
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
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Permissions
  const canCreate = usePermission("customers", "create");
  const canUpdate = usePermission("customers", "update");
  const canDelete = usePermission("customers", "delete");

  // Filter state - all filters apply live as the user types/selects, no
  // separate "Search" step needed.
  const [filterStatus, setFilterStatus] = useState<string>("");

  // Use reusable state hook
  const {
    searchQuery,
    setSearchQuery,
    selectedItem: selectedVoucher,
    setSelectedItem: setSelectedVoucher,
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

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterStatus("");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

    // Default order before the user sorts a column in the table itself
    // (the table's own column-header sort takes over from there).
    filtered.sort((a, b) => a.barcode_no.localeCompare(b.barcode_no));

    return filtered;
  }, [vouchers, searchQuery, filterStatus]);

  // The table sorts by whichever column the user clicks; Expiry and Status
  // are computed rather than raw fields, so they need their own values on
  // the row for the grid to sort/display correctly.
  type VoucherRow = CustomerGiftVoucher & {
    voucher_status: string;
    expiry_date: string;
  };

  const voucherRows: VoucherRow[] = useMemo(
    () =>
      filteredVouchers.map((voucher) => ({
        ...voucher,
        voucher_status: getVoucherStatus(voucher),
        expiry_date: calculateExpiryDate(voucher.date, voucher.valid_period_in_months).toISOString(),
      })),
    [filteredVouchers]
  );

  // Mutations
  const createMutation = useCrudMutation({
    mutationFn: vouchersApi.create,
    invalidateQueryKeys: [["vouchers"]],
    getSuccessMessage: (newVoucher) => `Voucher ${newVoucher.barcode_no} created successfully`,
    errorMessage: "Failed to create voucher",
    onSuccess: async (newVoucher) => {
      setIsCreating(false);
      handleSelectVoucher(newVoucher);
    },
  });

  const updateMutation = useCrudMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      vouchersApi.update(id, data),
    invalidateQueryKeys: [["vouchers"]],
    successMessage: "Voucher updated successfully",
    errorMessage: "Failed to update voucher",
    onSuccess: async (updatedVoucher) => {
      setIsEditing(false);
      handleSelectVoucher(updatedVoucher);
    },
  });

  const deleteMutation = useCrudMutation({
    mutationFn: vouchersApi.delete,
    invalidateQueryKeys: [["vouchers"]],
    successMessage: "Voucher deleted successfully",
    errorMessage: "Failed to delete voucher",
    onSuccess: () => {
      setSelectedVoucher(null);
    },
  });

  // Handlers
  const handleExportCSV = () => {
    const headers = [
      "Voucher Code",
      "Issue Date",
      "Original Amount",
      "Current Balance",
      "Linked Invoice",
      "Validity (Months)",
      "Expiry Date",
      "Status"
    ];

    const rows = filteredVouchers.map(voucher => {
      const expiryDate = calculateExpiryDate(voucher.date, voucher.valid_period_in_months);
      return [
        voucher.barcode_no,
        voucher.date ? new Date(voucher.date).toLocaleDateString() : "",
        voucher.amount,
        voucher.balance,
        voucher.purchased_invoice_no || "",
        voucher.valid_period_in_months,
        expiryDate ? expiryDate.toLocaleDateString() : "",
        getVoucherStatus(voucher)
      ];
    });

    exportToCSV({
      filename: `gift_vouchers_${new Date().toISOString().split("T")[0]}`,
      headers,
      rows
    });
  };

  const handleSave = useCallback(() => {
    if (!formData.barcode_no.trim()) {
      showErrorToast("Voucher code is required");
      return;
    }
    if (formData.amount <= 0) {
      showErrorToast("Amount must be greater than 0");
      return;
    }
    if (isCreating && !formData.branch_code?.trim()) {
      showErrorToast("Branch is required");
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
  }, [formData, isEditing, isCreating, selectedVoucher]);

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
  const isFormValid =
    formData.barcode_no.trim() &&
    formData.amount > 0 &&
    (!isCreating || (formData.branch_code && formData.branch_code.trim() !== ""));
  const isDisabled = !isEditing && !isCreating;

  // The Favorite star column plus real-data columns — sorting is done via
  // the grid's own column header menu, not a separate "Sort by" control.
  const voucherColumns: TDataGridColumn<VoucherRow>[] = useMemo(
    () => [
      {
        field: "favorite",
        header: "",
        width: 48,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<VoucherRow>) => (
          <IconButton size="small" onClick={(e) => toggleFavorite(params.row.id, e)}>
            {favorites.includes(params.row.id) ? (
              <StarIcon fontSize="small" color="warning" />
            ) : (
              <StarOutlineIcon fontSize="small" color="action" />
            )}
          </IconButton>
        ),
      },
      { field: "barcode_no", header: "Voucher Code", flex: 1, minWidth: 160 },
      {
        field: "purchased_invoice_no",
        header: "Linked Invoice",
        width: 150,
        renderCell: (params: GridRenderCellParams<VoucherRow>) =>
          params.row.purchased_invoice_no || "-",
      },
      {
        field: "amount",
        header: "Value",
        width: 130,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<VoucherRow>) =>
          `Rs. ${fmtLKR(params.row.amount)}`,
      },
      {
        field: "balance",
        header: "Balance",
        width: 130,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<VoucherRow>) =>
          `Rs. ${fmtLKR(params.row.balance)}`,
      },
      {
        field: "date",
        header: "Issue Date",
        width: 130,
        renderCell: (params: GridRenderCellParams<VoucherRow>) =>
          format(new Date(params.row.date), "dd/MM/yyyy"),
      },
      {
        field: "expiry_date",
        header: "Expiry",
        width: 130,
        renderCell: (params: GridRenderCellParams<VoucherRow>) =>
          format(new Date(params.row.expiry_date), "dd/MM/yyyy"),
      },
      {
        field: "voucher_status",
        header: "Status",
        width: 140,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<VoucherRow>) => {
          const status = params.row.voucher_status;
          return (
            <Chip
              label={status === "expiring_soon" ? "Expiring Soon" : status.charAt(0).toUpperCase() + status.slice(1).replace("_", " ")}
              size="small"
              color={getStatusColor(status)}
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
        renderCell: (params: GridRenderCellParams<VoucherRow>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectVoucher(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [favorites, toggleFavorite, handleSelectVoucher] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Whether we're showing a single voucher's detail view (selected or being
  // created) instead of the browse table.
  const isVoucherDetailMode = !!selectedVoucher || isCreating;

  // Returns to the browse table from the detail view (the "Back to
  // Vouchers" link above the detail content's breadcrumbs).
  const handleBackToVouchers = useCallback(() => {
    setSelectedVoucher(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [isCreating, setSelectedVoucher, setIsCreating, setIsEditing]);

  // Cancelling out of "New Voucher" should return to the browse table, not
  // auto-open the first voucher the way useMasterDetailState's generic
  // handleCancel does (that behavior made sense for the old always-visible
  // detail panel, but not here). Cancelling out of editing an existing
  // voucher still just reverts its form, which the generic handler already
  // does correctly.
  const handleCancelVoucher = useCallback(() => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedVoucher(null);
    } else {
      baseHandleCancel(filteredVouchers);
    }
  }, [isCreating, filteredVouchers, baseHandleCancel, setIsCreating, setIsEditing, setSelectedVoucher]);

  // Browse mode: a full-width table of every voucher (shown when nothing is
  // selected and nothing is being created).
  const vouchersTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<VoucherRow>
          rows={voucherRows}
          columns={voucherColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectVoucher(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No vouchers found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Detail mode: a narrow left panel showing only the current voucher (or
  // the "New Voucher" placeholder while creating), with a "Back to
  // Vouchers" link returning to the table.
  const singleVoucherPanel = (
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
          onClick={handleBackToVouchers}
          sx={{ textTransform: "none" }}
        >
          Back to Vouchers
        </Button>
      </Box>
      {isCreating ? (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ bgcolor: "primary.main" }}>
              <ReceiptIcon />
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              New Voucher
            </Typography>
          </Box>
        </Box>
      ) : selectedVoucher && (
        <SelectableListItem
          id={selectedVoucher.id}
          isSelected
          onClick={() => {}}
          primaryText={
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
              <Avatar sx={{ bgcolor: "primary.main" }}>
                <ReceiptIcon />
              </Avatar>
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0 }}>
                <span>{selectedVoucher.barcode_no}</span>
              </Box>
            </Box>
          }
          isFavorite={favorites.includes(selectedVoucher.id)}
          onToggleFavorite={(e) => toggleFavorite(selectedVoucher.id, e)}
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
        onCancel={handleCancelVoucher}
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
                value={Number(formData.amount)}
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

            {/* Activity History (view mode only) */}
            {selectedVoucher && !isCreating && !isEditing && (
              <FormSection title="Activity History" columns={2}>
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
        titleSlot={
          isVoucherDetailMode ? undefined : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search by voucher code or invoice..."
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
              <TextField
                select
                size="small"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                sx={{ width: 170, flexShrink: 0 }}
              >
                {STATUS_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
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
          isVoucherDetailMode ? undefined : (
            <>
              {canCreate && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={handleNewVoucher}
                  sx={{ mr: 1 }}
                >
                  Add Voucher
                </Button>
              )}
              <Button
                variant="outlined"
                size="small"
                startIcon={<DownloadIcon />}
                onClick={handleExportCSV}
                disabled={filteredVouchers.length === 0}
                sx={{ mr: 1 }}
              >
                Export CSV
              </Button>
            </>
          )
        }
        onRefresh={refetch}
        isLoading={isLoading}
        {...(isVoucherDetailMode
          ? { masterPanel: singleVoucherPanel, detailPanel }
          : { children: vouchersTablePanel })}
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
