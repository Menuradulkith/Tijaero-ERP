/**
 * Supplier Advance Payments Page
 * 
 * Master-Detail layout for managing supplier advance payments.
 * Follows the Purchasing/Sales UI pattern with Tijaero components.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Autocomplete,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  AccountBalanceWallet as WalletIcon,
  CheckCircle as CheckCircleIcon,
  History as HistoryIcon,
  Undo as UndoIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
  Add as AddIcon,
  ArrowBack as ArrowBackIcon,
  Star as StarIcon,
  StarBorder as StarOutlineIcon,
  OpenInNew as OpenInNewIcon,
} from "@mui/icons-material";
import type { GridRenderCellParams } from "@mui/x-data-grid";

import {
  MasterDetailLayout,
  DetailPanelHeader,
  ActionToolbar,
  FormSection,
  EmptyState,
  SelectableListItem,
  handleApiError,
  useMasterDetailState,
  showErrorToast,
  showSuccessToast,
  TDetailSkeleton,
  TExportButton,
  TBranchFilter,
  TSupplierFilter,
  GENERIC_PAYMENT_METHOD,
  TConfirmDialog,
  useConfirmDialog,
  useCrudMutation,
  fmtLKR,
  TActivityHistoryPanel,
  TDataGrid,
  type TDataGridColumn,
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
  company_name: string;
}

interface EligibleAdvancePOOption {
  po_id: number;
  po_no: string;
  supplier_id: number;
  supplier_name: string;
  branch_code: string;
  remaining_amount: number;
}

const INITIAL_FORM_DATA: Partial<SupplierAdvancePaymentCreate> = {
  supplier_id: 0,
  purchasing_order_id: undefined,
  payment_date: new Date().toISOString().split("T")[0],
  payment_method: "",
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
  const queryClient = useQueryClient();
  const canViewSuppliers = usePermission("suppliers", "view");

  // Validation state
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const handleBlur = (fieldName: string) => {
    setTouched((prev) => ({ ...prev, [fieldName]: true }));
  };

  // Return dialog state
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [returnAmount, setReturnAmount] = useState<number | "">("");
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split("T")[0]);
  const [returnMethod, setReturnMethod] = useState("Bank Transfer");
  const [returnReference, setReturnReference] = useState("");
  const [returnRemarks, setReturnRemarks] = useState("");
  const [returningAdvance, setReturningAdvance] = useState(false);

  // Filter states (applied - drives the actual list filtering)
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterSupplier, setFilterSupplier] = useState<number | null>(null);

  const {
    searchQuery,
    setSearchQuery,
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

  // Activity History is opened on demand from a detail icon next to the
  // Tracking section title, rather than shown inline.
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);

  // Reference data
  const { filteredBranches, defaultBranchCode } = useReferenceData(["branches"]);
  const branches: Branch[] = filteredBranches || [];

  // Auto-default branch filter for non-superuser users
  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterBranch(null);
    setFilterSupplier(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Fetch eligible PO list from dedicated backend endpoint (single query)
  const { data: eligibleAdvancePOs = [] } = useQuery({
    queryKey: ["eligible-advance-pos"],
    queryFn: async (): Promise<EligibleAdvancePOOption[]> => {
      return await supplierAdvancePaymentsApi.getEligibleAdvancePOs();
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

    // Default order before the user sorts a column in the table itself (the
    // table's own column-header sort takes over from there) — newest first.
    filtered.sort((a, b) => {
      const diff = new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
      return diff !== 0 ? diff : (b.id || 0) - (a.id || 0);
    });

    return filtered;
  }, [advances, searchQuery]);

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
      return supplier?.company_name || `Supplier #${supplierId}`;
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

  // Can return: advance has remaining balance and hasn't been fully returned
  const remainingForReturn = selectedItem
    ? Math.max(0, Number(selectedItem.remaining_amount) - Number(selectedItem.returned_amount || 0))
    : 0;
  const canReturn = !!(selectedItem && remainingForReturn > 0.001 && !isCreating);

  const openReturnDialog = useCallback(() => {
    if (!selectedItem) return;
    setReturnAmount(remainingForReturn);
    setReturnDate(new Date().toISOString().split("T")[0]);
    setReturnMethod(selectedItem.payment_method as string || "Bank Transfer");
    setReturnReference("");
    setReturnRemarks("");
    setReturnDialogOpen(true);
  }, [selectedItem, remainingForReturn]);

  const handleReturnSubmit = useCallback(async () => {
    if (!selectedItem || !returnAmount || returnAmount <= 0) return;
    if (returnAmount > remainingForReturn + 0.001) {
      showErrorToast(`Return amount cannot exceed remaining balance Rs. ${fmtLKR(remainingForReturn)}`);
      return;
    }
    setReturningAdvance(true);
    try {
      await supplierAdvancePaymentsApi.returnAdvance(selectedItem.id, {
        return_amount: returnAmount,
        return_date: returnDate,
        return_method: returnMethod,
        return_reference: returnReference || undefined,
        return_remarks: returnRemarks || undefined,
      });
      showSuccessToast("Advance return recorded successfully");
      setReturnDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["supplier-advance-payments"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-advance-detail", selectedItem.id] });
    } catch (err) {
      showErrorToast(handleApiError(err, "Failed to record advance return"));
    } finally {
      setReturningAdvance(false);
    }
  }, [
    selectedItem, returnAmount, returnDate, returnMethod,
    returnReference, returnRemarks, remainingForReturn, queryClient,
  ]);

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
      case "payment_method":
        if (!formData.payment_method) return "Payment method is required";
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
    !!formData.payment_date &&
    !!formData.payment_method;

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

  // Cancelling out of "New Advance" should return to the browse table, not
  // auto-open the first advance the way useMasterDetailState's generic
  // handleCancel does (that behavior made sense for the old always-visible
  // detail panel, but not here). Cancelling out of editing an existing
  // advance still just reverts its form, which the generic handler already
  // does correctly.
  const handleCancelAdvance = useCallback(() => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedItem(null);
    } else {
      handleCancel(filteredAdvances);
    }
  }, [isCreating, filteredAdvances, handleCancel, setIsCreating, setIsEditing, setSelectedItem]);

  // Returns to the browse table from the detail view.
  const handleBackToAdvances = useCallback(() => {
    setSelectedItem(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [isCreating, setSelectedItem, setIsCreating, setIsEditing]);

  // The table sorts by whichever column the user clicks; the grid's own
  // column-header sort takes over from the fixed default order above.
  const advanceColumns: TDataGridColumn<SupplierAdvancePayment>[] = useMemo(
    () => [
      {
        field: "favorite",
        header: "",
        width: 48,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<SupplierAdvancePayment>) => (
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
        field: "advance_no",
        header: "Ref No",
        flex: 1,
        minWidth: 140,
        renderCell: (params: GridRenderCellParams<SupplierAdvancePayment>) =>
          params.row.advance_no || `ADV-${params.row.id}`,
      },
      {
        field: "supplier_name",
        header: "Supplier",
        flex: 1,
        minWidth: 170,
        renderCell: (params: GridRenderCellParams<SupplierAdvancePayment>) =>
          params.row.supplier_name || getSupplierName(params.row.supplier_id),
      },
      { field: "branch_code", header: "Branch", width: 110 },
      {
        field: "payment_date",
        header: "Date",
        width: 120,
        renderCell: (params: GridRenderCellParams<SupplierAdvancePayment>) =>
          params.row.payment_date ? new Date(params.row.payment_date).toLocaleDateString() : "-",
      },
      {
        field: "original_amount",
        header: "Amount",
        width: 140,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<SupplierAdvancePayment>) =>
          `Rs. ${fmtLKR(Number(params.row.original_amount || 0))}`,
      },
      {
        field: "is_fully_applied",
        header: "Status",
        width: 130,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<SupplierAdvancePayment>) => (
          <Chip
            label={params.row.is_fully_applied ? "Fully Applied" : "Active"}
            size="small"
            color={params.row.is_fully_applied ? "default" : "success"}
          />
        ),
      },
      {
        field: "remaining_amount",
        header: "Balance",
        width: 140,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<SupplierAdvancePayment>) =>
          `Rs. ${fmtLKR(Number(params.row.remaining_amount || 0))}`,
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<SupplierAdvancePayment>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectWithCheck(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [favorites, toggleFavorite, getSupplierName, handleSelectWithCheck]
  );

  // Whether we're showing a single advance's detail view (selected or being
  // created) instead of the browse table.
  const isAdvanceDetailMode = !!selectedItem || isCreating;

  // Browse mode: a full-width table of every advance. Sorting is done
  // per-column via the grid's own column header menu.
  const advanceTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<SupplierAdvancePayment>
          rows={filteredAdvances}
          columns={advanceColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectWithCheck(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No supplier advance payments found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Detail mode: a narrow left panel showing only the current advance
  // payment (or the "New Advance" placeholder while creating). A "Back to
  // Supplier Advances" link returns to the table.
  const singleAdvancePanel = (
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
          onClick={handleBackToAdvances}
          sx={{ textTransform: "none" }}
        >
          Back to Supplier Advances
        </Button>
      </Box>
      {isCreating ? (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ bgcolor: "action.disabledBackground", color: "text.secondary" }}>
              <WalletIcon />
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              New Advance
            </Typography>
          </Box>
        </Box>
      ) : selectedItem && (
        <SelectableListItem
          id={selectedItem.id}
          isSelected
          onClick={() => {}}
          primaryText={
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
              <Avatar sx={{ bgcolor: "action.disabledBackground", color: "text.secondary" }}>
                <WalletIcon />
              </Avatar>
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0 }}>
                <span>{selectedItem.advance_no || `ADV-${selectedItem.id}`}</span>
              </Box>
            </Box>
          }
          isFavorite={favorites.includes(selectedItem.id)}
          onToggleFavorite={(e) => toggleFavorite(selectedItem.id, e)}
        />
      )}
    </Paper>
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
        onCancel={handleCancelAdvance}
        onDelete={undefined}
        canDelete={false}
        endActions={
          canReturn ? (
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button
                size="small"
                variant="outlined"
                color="warning"
                startIcon={<UndoIcon />}
                onClick={openReturnDialog}
              >
                Return Advance
              </Button>
            </Box>
          ) : undefined
        }
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
                getOptionLabel={(option: Supplier) => option.company_name}
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

            <FormSection title="Payment Details" columns={3}>
              <TextField
                select
                label="Payment Method"
                size="small"
                value={formData.payment_method || ""}
                onChange={(e) => {
                  setFormData({ ...formData, payment_method: e.target.value });
                  handleBlur("payment_method");
                }}
                onBlur={() => handleBlur("payment_method")}
                disabled={!isEditing && !isCreating}
                required
                error={hasError("payment_method")}
                helperText={getFieldError("payment_method")}
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
                value={Number(formData.original_amount) || ""}
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
                {Number(detailAdvance.returned_amount || 0) > 0 && (
                  <>
                    <TextField
                      label="Returned Amount"
                      size="small"
                      value={`Rs. ${fmtLKR(Number(detailAdvance.returned_amount))}`}
                      disabled
                      InputProps={{ readOnly: true }}
                      sx={{ "& .MuiInputBase-input.Mui-disabled": { WebkitTextFillColor: "#c62828" } }}
                    />
                    <TextField
                      label="Return Date"
                      size="small"
                      value={detailAdvance.return_date ? new Date(detailAdvance.return_date).toLocaleDateString() : "-"}
                      disabled
                      InputProps={{ readOnly: true }}
                    />
                    <TextField
                      label="Return Method"
                      size="small"
                      value={detailAdvance.return_method || "-"}
                      disabled
                      InputProps={{ readOnly: true }}
                    />
                    {detailAdvance.return_reference && (
                      <TextField
                        label="Return Reference"
                        size="small"
                        value={detailAdvance.return_reference}
                        disabled
                        InputProps={{ readOnly: true }}
                      />
                    )}
                  </>
                )}
              </FormSection>
            )}

            {/* Tracking info */}
            {selectedItem && !isCreating && (
              <FormSection
                title="Tracking"
                columns={2}
                titleAction={
                  <Tooltip title="View activity history">
                    <IconButton size="small" onClick={() => setActivityHistoryOpen(true)}>
                      <HistoryIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
              >
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
        titleSlot={
          isAdvanceDetailMode ? undefined : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search advances..."
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
              <Box sx={{ width: 150, flexShrink: 0 }}>
                <TBranchFilter
                  branches={branches}
                  value={filterBranch}
                  onChange={setFilterBranch}
                  label=""
                  size="small"
                />
              </Box>
              <Box sx={{ width: 170, flexShrink: 0 }}>
                <TSupplierFilter
                  suppliers={suppliers || []}
                  value={filterSupplier}
                  onChange={setFilterSupplier}
                  label=""
                  size="small"
                />
              </Box>
              {(searchQuery || filterBranch || filterSupplier) && (
                <Tooltip title="Clear filters">
                  <IconButton size="small" onClick={handleClearFilters}>
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          )
        }
        onRefresh={refetch}
        isLoading={isLoading}
        headerActions={
          isAdvanceDetailMode ? undefined : (
            <>
              <Button
                variant="contained"
                size="small"
                startIcon={<AddIcon />}
                onClick={handleNewAdvance}
                sx={{ mr: 1 }}
              >
                Add Supplier Advance
              </Button>
              <TExportButton
                filename="supplier_advance_payments"
                headers={[
                  "Advance No",
                  "Supplier",
                  "Payment Date",
                  "Method",
                  "Original",
                  "Applied",
                  "Remaining",
                  "Returned",
                  "Reference",
                  "Created",
                ]}
                rows={() =>
                  filteredAdvances.map((adv) => [
                    adv.advance_no || "",
                    adv.supplier_name || "",
                    adv.payment_date || "",
                    adv.payment_method || "",
                    adv.original_amount ?? 0,
                    adv.applied_amount ?? 0,
                    adv.remaining_amount ?? 0,
                    adv.returned_amount ?? 0,
                    adv.reference_number || "",
                    adv.created_at || "",
                  ])
                }
                disabled={filteredAdvances.length === 0}
              />
            </>
          )
        }
        {...(isAdvanceDetailMode
          ? { masterPanel: singleAdvancePanel, detailPanel }
          : { children: advanceTablePanel })}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />

      {/* Return Advance Dialog */}
      <Dialog open={returnDialogOpen} onClose={() => setReturnDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <UndoIcon color="warning" />
          Return Supplier Advance
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Record money returned by the supplier for advance{" "}
            <strong>{selectedItem?.advance_no}</strong>. Available to return:{" "}
            <strong>Rs. {fmtLKR(remainingForReturn)}</strong>
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <TextField
              label="Return Amount"
              size="small"
              type="number"
              value={returnAmount}
              onChange={(e) => setReturnAmount(parseFloat(e.target.value) || "")}
              required
              InputProps={{ startAdornment: <InputAdornment position="start">Rs.</InputAdornment> }}
              inputProps={{ min: 0.01, max: remainingForReturn, step: 0.01 }}
              helperText={`Max: Rs. ${fmtLKR(remainingForReturn)}`}
              fullWidth
            />
            <TextField
              label="Return Date"
              size="small"
              type="date"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
              required
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField
              select
              label="Return Method"
              size="small"
              value={returnMethod}
              onChange={(e) => setReturnMethod(e.target.value)}
              required
              fullWidth
            >
              {GENERIC_PAYMENT_METHOD.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
              ))}
            </TextField>
            {(returnMethod === "Bank Transfer" || returnMethod === "Cheque") && (
              <TextField
                label={returnMethod === "Cheque" ? "Cheque Number" : "Reference Number"}
                size="small"
                value={returnReference}
                onChange={(e) => setReturnReference(e.target.value)}
                fullWidth
              />
            )}
            <TextField
              label="Remarks"
              size="small"
              value={returnRemarks}
              onChange={(e) => setReturnRemarks(e.target.value)}
              multiline
              rows={2}
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setReturnDialogOpen(false)} disabled={returningAdvance}>Cancel</Button>
          <Button
            variant="contained"
            color="warning"
            onClick={handleReturnSubmit}
            disabled={returningAdvance || !returnAmount || !returnDate || !returnMethod}
            startIcon={<UndoIcon />}
          >
            {returningAdvance ? "Processing..." : "Confirm Return"}
          </Button>
        </DialogActions>
      </Dialog>

      <TActivityHistoryPanel
        open={activityHistoryOpen}
        onClose={() => setActivityHistoryOpen(false)}
        entityType="supplier_advance"
        entityId={selectedItem?.id}
        actionLabels={{
          create: "Advance payment created",
          return: "Advance payment returned",
        }}
      />
    </>
  );
}
