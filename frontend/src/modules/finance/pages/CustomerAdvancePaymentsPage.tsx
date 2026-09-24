/**
 * Customer Advance Payments Page
 * 
 * Master-Detail layout for managing customer advance payments.
 * Follows the Purchasing/Sales UI pattern with Tijaero components.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Autocomplete,
  Avatar,
  Box,
  Button,
  Chip,
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
  History as HistoryIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
  Star as StarIcon,
  StarBorder as StarOutlineIcon,
  ArrowBack as ArrowBackIcon,
  Add as AddIcon,
  OpenInNew as OpenInNewIcon,
} from "@mui/icons-material";
import type { GridRenderCellParams } from "@mui/x-data-grid";

import {
  MasterDetailLayout,
  DetailPanelHeader,
  ActionToolbar,
  FormSection,
  EmptyState,
  handleApiError,
  SelectableListItem,
  useMasterDetailState,
  showErrorToast,
  showSuccessToast,
  TDetailSkeleton,
  TExportButton,
  TBranchFilter,
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
  const confirmDialog = useConfirmDialog();
  const canViewCustomers = usePermission("customers", "view");

  // Validation state
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const handleBlur = (fieldName: string) => {
    setTouched((prev) => ({ ...prev, [fieldName]: true }));
  };

  // Filter state - all filters apply live as the user types/selects, no
  // separate "Search" step needed.
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

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
    handleCancel: handleCancelBase,
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

  // Activity History is opened on demand from a detail icon next to the
  // Status section title, rather than shown inline.
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

    // Default order before the user sorts a column in the table itself (the
    // table's own column-header sort takes over from there).
    filtered.sort((a, b) => {
      const diff = new Date(b.created_date || "").getTime() - new Date(a.created_date || "").getTime();
      return diff !== 0 ? diff : (b.id || 0) - (a.id || 0);
    });

    return filtered;
  }, [advances, searchQuery]);

  // Mutations
  const createMutation = useCrudMutation({
    mutationFn: (data: CustomerAdvancePaymentCreate) => advancePaymentsApi.create(data),
    invalidateQueryKeys: [["customer-advance-payments"]],
    successMessage: "Customer advance payment recorded successfully",
    errorMessage: "Failed to record advance payment",
    onSuccess: (newItem) => {
      setIsCreating(false);
      setIsEditing(false);
      setTouched({});
      setTimeout(() => handleSelectItem(newItem), 0);
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

  // Cancelling out of "New Advance" should return to the browse table, not
  // auto-open the first advance the way useMasterDetailState's generic
  // handleCancel does (that behavior made sense for the old always-visible
  // detail panel, but not here).
  const handleCancelAdvance = useCallback(() => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedItem(null);
    } else {
      handleCancelBase(filteredAdvances);
    }
  }, [isCreating, filteredAdvances, handleCancelBase, setIsCreating, setIsEditing, setSelectedItem]);

  // Returns to the browse table from the detail view.
  const handleBackToAdvances = useCallback(() => {
    setSelectedItem(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [isCreating, setSelectedItem, setIsCreating, setIsEditing]);

  // Whether we're showing a single advance's detail view (selected or being
  // created) instead of the browse table.
  const isAdvanceDetailMode = !!selectedItem || isCreating;

  // ─── Browse Table ───────────────────────────────────────────────────────

  type AdvanceRow = CustomerAdvancePayment & { customer_name: string };

  const advanceRows: AdvanceRow[] = useMemo(
    () =>
      filteredAdvances.map((adv) => ({
        ...adv,
        customer_name: getCustomerName(adv.customer_id),
      })),
    [filteredAdvances, getCustomerName]
  );

  const advanceColumns: TDataGridColumn<AdvanceRow>[] = useMemo(
    () => [
      {
        field: "favorite",
        header: "",
        width: 48,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<AdvanceRow>) => (
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
        field: "advance_payments_no",
        header: "Ref No",
        flex: 1,
        minWidth: 150,
        renderCell: (params: GridRenderCellParams<AdvanceRow>) =>
          params.row.advance_payments_no || `ADV-${params.row.id}`,
      },
      { field: "customer_name", header: "Customer", flex: 1, minWidth: 170 },
      { field: "branch_code", header: "Branch", width: 120 },
      {
        field: "cheque_date",
        header: "Date",
        width: 140,
        renderCell: (params: GridRenderCellParams<AdvanceRow>) =>
          params.row.cheque_date ? new Date(params.row.cheque_date).toLocaleDateString() : "-",
      },
      {
        field: "payment_amount",
        header: "Amount",
        width: 140,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<AdvanceRow>) => `Rs. ${fmtLKR(Number(params.row.payment_amount || 0))}`,
      },
      {
        field: "active",
        header: "Status",
        width: 110,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<AdvanceRow>) => (
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
        renderCell: (params: GridRenderCellParams<AdvanceRow>) => (
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
    [favorites, toggleFavorite, handleSelectWithCheck]
  );

  const advanceTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<AdvanceRow>
          rows={advanceRows}
          columns={advanceColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectWithCheck(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No customer advance payments found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Detail mode: a narrow left panel showing only the current advance payment
  // (or the "New Advance" placeholder while creating) plus a "Back to
  // Customer Advance Payments" link that returns to the table.
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
          Back to Customer Advance Payments
        </Button>
      </Box>
      {isCreating ? (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ width: 40, height: 40 }}>
              <WalletIcon fontSize="small" />
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              New Customer Advance Payment
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
              <Avatar sx={{ width: 36, height: 36 }}>
                <WalletIcon fontSize="small" />
              </Avatar>
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5, minWidth: 0 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{selectedItem.advance_payments_no || `ADV-${selectedItem.id}`}</span>
                </Box>
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
        onCancel={handleCancelAdvance}
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
                value={Number(formData.payment_amount) || ""}
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
              <FormSection
                title="Status"
                columns={3}
                titleAction={
                  <Tooltip title="View activity history">
                    <IconButton size="small" onClick={() => setActivityHistoryOpen(true)}>
                      <HistoryIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
              >
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
              <Box sx={{ width: 170, flexShrink: 0 }}>
                <TBranchFilter branches={branches} value={filterBranch} onChange={setFilterBranch} label="" placeholder="All Branches" size="small" />
              </Box>
              {(searchQuery || filterBranch) && (
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
              <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={handleNewAdvance} sx={{ mr: 1 }}>
                Add Advance Payment
              </Button>
              <TExportButton
                filename="customer_advance_payments"
                headers={[
                  "Payment No",
                  "Customer",
                  "Amount",
                  "Method",
                  "Created Date",
                  "Cheque Date",
                  "Proforma Invoice ID",
                  "Remarks",
                ]}
                rows={() =>
                  filteredAdvances.map((adv) => [
                    adv.advance_payments_no || "",
                    getCustomerName(adv.customer_id),
                    adv.payment_amount ?? 0,
                    adv.payment_method || "",
                    adv.created_date || "",
                    adv.cheque_date || "",
                    adv.proforma_invoice_id ?? "",
                    adv.remarks || "",
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

      <TActivityHistoryPanel
        open={activityHistoryOpen}
        onClose={() => setActivityHistoryOpen(false)}
        entityType="customer_advance_payment"
        entityId={selectedItem?.id}
        actionLabels={{
          create: "Advance payment created",
        }}
      />
    </>
  );
}
