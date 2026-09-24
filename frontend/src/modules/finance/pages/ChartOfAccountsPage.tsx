/**
 * ChartOfAccountsPage - Chart of Accounts Management
 *
 * Displays accounts in a flat list with Master-Detail layout.
 * Follows the same UI pattern as PurchaseOrdersPage / SalesPage.
 * Uses ActionToolbar with inline editing, a header tab filter bar, expanded list items.
 */

import AccountTreeIcon from "@mui/icons-material/AccountTree";
import HistoryIcon from "@mui/icons-material/History";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import StarIcon from "@mui/icons-material/Star";
import StarOutlineIcon from "@mui/icons-material/StarBorder";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AddIcon from "@mui/icons-material/Add";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import {
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  FormSection,
  handleApiError,
  MasterDetailLayout,
  SelectableListItem,
  showErrorToast,
  showSuccessToast,
  TSearchableSelect,
  TExportButton,
  TDetailSkeleton,
  useMasterDetailState,
  TConfirmDialog,
  useConfirmDialog,
  useCrudMutation,
  TActivityHistoryPanel,
  TDataGrid,
  type TDataGridColumn,
} from "@/components/tijaero";
import { formatDateTimeReadable } from "@/utils/formatters";

import { chartOfAccountsApi } from "@/modules/finance/api";
import type {
  ChartOfAccount,
  ChartOfAccountCreate,
  AccountType,
} from "@/modules/finance/types";

// ─── Configuration ───────────────────────────────────────────────────────────

const ACCOUNT_TYPES: { value: AccountType; label: string; color: "success" | "error" | "info" | "warning" | "primary" }[] = [
  { value: "Asset", label: "Asset", color: "success" },
  { value: "Liability", label: "Liability", color: "error" },
  { value: "Equity", label: "Equity", color: "info" },
  { value: "Revenue", label: "Revenue", color: "primary" },
  { value: "Expense", label: "Expense", color: "warning" },
];

const STATUS_FILTER_OPTIONS = [
  { value: "active", label: "Active", color: "success" as const },
  { value: "inactive", label: "Inactive", color: "default" as const },
];

const getTypeColor = (type: string) =>
  ACCOUNT_TYPES.find((t) => t.value === type)?.color || ("default" as const);

const ACTIVITY_ACTION_LABELS: Record<string, string> = {
  create: "Account created",
  update: "Account updated",
  delete: "Account deleted",
};

// ─── Form Data ───────────────────────────────────────────────────────────────

type AccountFormData = ChartOfAccountCreate;

const INITIAL_FORM_DATA: AccountFormData = {
  account_code: "",
  account_name: "",
  account_type: "Asset",
  account_category: "",
  parent_account_id: null,
  is_active: true,
  is_system_account: false,
  normal_balance: "Debit",
  description: "",
};

const resetFormFromAccount = (account: ChartOfAccount): AccountFormData => ({
  account_code: account.account_code,
  account_name: account.account_name,
  account_type: account.account_type,
  account_category: account.account_category || "",
  parent_account_id: account.parent_account_id,
  is_active: account.is_active,
  is_system_account: account.is_system_account,
  normal_balance: account.normal_balance || "Debit",
  description: account.description || "",
});

// ─── Component ───────────────────────────────────────────────────────────────

export default function ChartOfAccountsPage() {
  const confirmDialog = useConfirmDialog();

  // Filter states (applied - drives the actual list filtering)
  const [filterType, setFilterType] = useState<string | null>(null);
  const [filterActive, setFilterActive] = useState<string | null>("active");

  // ─── Master-Detail State ───────────────────────────────────────────────────

  const {
    searchQuery,
    setSearchQuery,
    selectedItem: selectedAccount,
    setSelectedItem: setSelectedAccount,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    favorites,
    toggleFavorite,
    formData,
    setFormData,
    handleSelectItem: handleSelectAccount,
    handleNew,
    handleCancel: handleCancelBase,
    handleStartEdit,
  } = useMasterDetailState<ChartOfAccount, AccountFormData>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromAccount,
    favoritesKey: "chart_of_accounts_favorites",
    defaultSortField: "account_code",
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
  // Activity History section title, rather than shown inline.
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const { data: accounts = [], isLoading, refetch } = useQuery({
    queryKey: ["chart-of-accounts", filterType, filterActive],
    queryFn: () =>
      chartOfAccountsApi.getAll({
        account_type: filterType ?? undefined,
        is_active: filterActive === null ? undefined : filterActive === "active",
        limit: 1000,
      }),
  });

  // Fetch all accounts for parent dropdown
  const { data: allAccounts = [] } = useQuery({
    queryKey: ["chart-of-accounts-all"],
    queryFn: () => chartOfAccountsApi.getAll({ limit: 1000 }),
  });

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterType(null);
    setFilterActive(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Filter & Sort ─────────────────────────────────────────────────────────

  const filteredAccounts = useMemo(() => {
    let filtered = [...accounts];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (a) =>
          a.account_code.toLowerCase().includes(q) ||
          a.account_name.toLowerCase().includes(q) ||
          a.account_category?.toLowerCase().includes(q)
      );
    }
    // Default order before the user sorts a column in the table itself (the
    // table's own column-header sort takes over from there).
    filtered.sort((a, b) => a.account_code.localeCompare(b.account_code));
    return filtered;
  }, [accounts, searchQuery]);

  // Cancelling out of "New Account" should return to the browse table, not
  // auto-open the first account the way useMasterDetailState's generic
  // handleCancel does (that behavior made sense for the old always-visible
  // detail panel, but not here). Cancelling out of editing an existing
  // account still just reverts its form, which the generic handler already
  // does correctly.
  const handleCancelAccount = useCallback(() => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedAccount(null);
    } else {
      handleCancelBase(filteredAccounts);
    }
  }, [isCreating, filteredAccounts, handleCancelBase, setIsCreating, setIsEditing, setSelectedAccount]);

  // Returns to the browse table from the detail view (the "Back to Chart of
  // Accounts" link above the detail header).
  const handleBackToAccounts = useCallback(() => {
    setSelectedAccount(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [isCreating, setSelectedAccount, setIsCreating, setIsEditing]);

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useCrudMutation({
    mutationFn: chartOfAccountsApi.create,
    invalidateQueryKeys: [["chart-of-accounts"], ["chart-of-accounts-all"]],
    successMessage: "Account created successfully",
    errorMessage: "Failed to create account",
    onSuccess: (data) => {
      setIsCreating(false);
      setIsEditing(false);
      setTimeout(() => handleSelectAccount(data), 0);
    },
  });

  const updateMutation = useCrudMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ChartOfAccountCreate> }) =>
      chartOfAccountsApi.update(id, data),
    invalidateQueryKeys: [["chart-of-accounts"], ["chart-of-accounts-all"]],
    successMessage: "Account updated",
    errorMessage: "Failed to update account",
    onSuccess: (data) => {
      setIsEditing(false);
      setSelectedAccount(data);
    },
  });

  const deleteMutation = useCrudMutation({
    mutationFn: chartOfAccountsApi.delete,
    invalidateQueryKeys: [["chart-of-accounts"], ["chart-of-accounts-all"]],
    successMessage: "Account deleted",
    errorMessage: "Failed to delete account",
    onSuccess: () => {
      setSelectedAccount(null);
    },
  });

  const seedMutation = useCrudMutation({
    mutationFn: () => chartOfAccountsApi.seed(true),
    invalidateQueryKeys: [["chart-of-accounts"], ["chart-of-accounts-all"]],
    getSuccessMessage: (result) =>
      `COA seeded: ${result.created} created, ${result.parent_links_set} parent links set (${result.total} total)`,
    errorMessage: "Failed to seed Chart of Accounts",
    onSuccess: (result) => {
      void result;
    },
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (isCreating) {
      createMutation.mutate(formData);
    } else if (selectedAccount) {
      updateMutation.mutate({
        id: selectedAccount.id,
        data: {
          account_name: formData.account_name,
          account_category: formData.account_category,
          parent_account_id: formData.parent_account_id,
          is_active: formData.is_active,
          normal_balance: formData.normal_balance,
          description: formData.description,
        },
      });
    }
  }, [isCreating, selectedAccount, formData, createMutation, updateMutation]);

  const handleDelete = useCallback(async () => {
    if (!selectedAccount || selectedAccount.is_system_account) return;
    const confirmed = await confirmDialog.confirm({
      title: "Delete Account",
      message: `Are you sure you want to delete account "${selectedAccount.account_code} - ${selectedAccount.account_name}"?`,
      confirmText: "Delete",
      confirmColor: "error",
    });
    if (confirmed) {
      deleteMutation.mutate(selectedAccount.id);
    }
  }, [selectedAccount, confirmDialog, deleteMutation]);

  const canEdit = !!selectedAccount;
  const canDelete = !!(selectedAccount && !selectedAccount.is_system_account);
  const isFormValid = !!(formData.account_code && formData.account_name && formData.account_type && formData.account_category);
  const isSaving = createMutation.isPending || updateMutation.isPending;

  // Parent account & child accounts for detail view
  const parentAccount = selectedAccount?.parent_account_id
    ? allAccounts.find((a) => a.id === selectedAccount.parent_account_id)
    : null;

  const childAccounts = selectedAccount
    ? allAccounts.filter((a) => a.parent_account_id === selectedAccount.id)
    : [];

  // Whether we're showing a single account's detail view (selected or being
  // created) instead of the browse table.
  const isAccountDetailMode = !!selectedAccount || isCreating;

  // ─── Browse Table ──────────────────────────────────────────────────────────

  // The table sorts by whichever column the user clicks; the Parent Account
  // column displays a looked-up name rather than the raw parent_account_id,
  // so it needs that name as its own field for the grid to sort on correctly.
  type AccountRow = ChartOfAccount & { parent_account_name: string };

  const accountRows: AccountRow[] = useMemo(
    () =>
      filteredAccounts.map((account) => ({
        ...account,
        parent_account_name: account.parent_account_id
          ? (() => {
              const parent = allAccounts.find((a) => a.id === account.parent_account_id);
              return parent ? `${parent.account_code} - ${parent.account_name}` : "-";
            })()
          : "-",
      })),
    [filteredAccounts, allAccounts]
  );

  const accountColumns: TDataGridColumn<AccountRow>[] = useMemo(
    () => [
      {
        field: "favorite",
        header: "",
        width: 48,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<AccountRow>) => (
          <IconButton size="small" onClick={(e) => toggleFavorite(params.row.id, e)}>
            {favorites.includes(params.row.id) ? (
              <StarIcon fontSize="small" color="warning" />
            ) : (
              <StarOutlineIcon fontSize="small" color="action" />
            )}
          </IconButton>
        ),
      },
      { field: "account_code", header: "Account Code", width: 140 },
      { field: "account_name", header: "Account Name", flex: 1, minWidth: 200 },
      {
        field: "account_type",
        header: "Type",
        width: 120,
        renderCell: (params: GridRenderCellParams<AccountRow>) => (
          <Chip label={params.row.account_type} size="small" color={getTypeColor(params.row.account_type)} />
        ),
      },
      { field: "account_category", header: "Category", width: 160 },
      { field: "parent_account_name", header: "Parent Account", width: 200 },
      {
        field: "is_active",
        header: "Status",
        width: 110,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<AccountRow>) => (
          <Chip
            label={params.row.is_active ? "Active" : "Inactive"}
            size="small"
            color={params.row.is_active ? "success" : "default"}
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
        renderCell: (params: GridRenderCellParams<AccountRow>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectAccount(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [favorites, toggleFavorite, handleSelectAccount]
  );

  // Browse mode: a full-width table of every account (shown when nothing is
  // selected and nothing is being created). Sorting is done per-column via
  // the grid's own column header menu, not a separate "Sort by" control.
  const accountTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<AccountRow>
          rows={accountRows}
          columns={accountColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectAccount(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No accounts found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // ─── Detail Panel ──────────────────────────────────────────────────────────

  // Detail mode: a narrow left panel showing only the current account (or the
  // "New Account" placeholder while creating) plus a "Back to Chart of
  // Accounts" link that returns to the table.
  const singleAccountPanel = (
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
          onClick={handleBackToAccounts}
          sx={{ textTransform: "none" }}
        >
          Back to Chart of Accounts
        </Button>
      </Box>
      {isCreating ? (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ width: 40, height: 40 }}>
              <AccountTreeIcon fontSize="small" />
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              New Account
            </Typography>
          </Box>
        </Box>
      ) : selectedAccount && (
        <SelectableListItem
          id={selectedAccount.id}
          isSelected
          onClick={() => {}}
          primaryText={
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
              <Avatar sx={{ width: 36, height: 36 }}>
                <AccountTreeIcon fontSize="small" />
              </Avatar>
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5, minWidth: 0 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{`${selectedAccount.account_code} - ${selectedAccount.account_name}`}</span>
                </Box>
              </Box>
            </Box>
          }
          isFavorite={favorites.includes(selectedAccount.id)}
          onToggleFavorite={(e) => toggleFavorite(selectedAccount.id, e)}
        />
      )}
    </Paper>
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Finance", href: "/finance" },
          { label: "Chart of Accounts", href: "/finance/chart-of-accounts" },
          ...(selectedAccount || isCreating
            ? [{ label: isCreating ? "New Account" : `${selectedAccount?.account_code}` }]
            : []),
        ]}
        title={selectedAccount ? `${selectedAccount.account_code} - ${selectedAccount.account_name}` : ""}
        titleIcon={<AccountTreeIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Account"
        noSelectionTitle="Select an Account"
        chips={
          selectedAccount && !isCreating
            ? [
                { label: selectedAccount.account_type, color: getTypeColor(selectedAccount.account_type) },
                ...(selectedAccount.is_active ? [] : [{ label: "Inactive", color: "default" as const }]),
              ]
            : []
        }
      />

      <ActionToolbar
        hasSelectedItem={!!selectedAccount}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={isFormValid}
        onNew={handleNew}
        onSave={handleSave}
        onCancel={handleCancelAccount}
        onEdit={canEdit ? handleStartEdit : undefined}
        onDelete={canDelete ? handleDelete : undefined}
        canDelete={canDelete || false}
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedAccount && !isCreating ? (
          <EmptyState message="Select an account from the list or create a new one" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} />
        ) : (
          <>
            {/* Account Information */}
            <FormSection title="Account Information" columns={3}>
              <TextField
                label="Account Code"
                size="small"
                value={formData.account_code}
                onChange={(e) => setFormData({ ...formData, account_code: e.target.value })}
                disabled={!isCreating}
                required
              />
              <TextField
                label="Account Name"
                size="small"
                value={formData.account_name}
                onChange={(e) => setFormData({ ...formData, account_name: e.target.value })}
                disabled={!isEditing && !isCreating}
                required
              />
              <TextField
                select
                label="Account Type"
                size="small"
                value={formData.account_type}
                onChange={(e) => setFormData({ ...formData, account_type: e.target.value as AccountType })}
                disabled={!isCreating}
                required
              >
                {ACCOUNT_TYPES.map((t) => (
                  <MenuItem key={t.value} value={t.value}>
                    {t.label}
                  </MenuItem>
                ))}
              </TextField>
            </FormSection>

            <FormSection title="Classification" columns={3}>
              <TextField
                label="Category"
                size="small"
                value={formData.account_category}
                onChange={(e) => setFormData({ ...formData, account_category: e.target.value })}
                disabled={!isEditing && !isCreating}
                required
              />
              <TextField
                select
                label="Normal Balance"
                size="small"
                value={formData.normal_balance}
                onChange={(e) => setFormData({ ...formData, normal_balance: e.target.value as "Debit" | "Credit" })}
                disabled={!isEditing && !isCreating}
              >
                <MenuItem value="Debit">Debit</MenuItem>
                <MenuItem value="Credit">Credit</MenuItem>
              </TextField>
              <TextField
                select
                label="Parent Account"
                size="small"
                value={formData.parent_account_id ?? ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    parent_account_id: e.target.value ? Number(e.target.value) : null,
                  })
                }
                disabled={!isEditing && !isCreating}
              >
                <MenuItem value="">None (Root Account)</MenuItem>
                {allAccounts
                  .filter((a) => a.id !== selectedAccount?.id)
                  .map((a) => (
                    <MenuItem key={a.id} value={a.id}>
                      {a.account_code} - {a.account_name}
                    </MenuItem>
                  ))}
              </TextField>
            </FormSection>

            <FormSection title="Details" columns={2}>
              <TextField
                label="Description"
                size="small"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                disabled={!isEditing && !isCreating}
                multiline
                rows={2}
                fullWidth
              />
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1, pt: 1 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      disabled={!isEditing && !isCreating}
                    />
                  }
                  label="Active"
                />
                {selectedAccount?.is_system_account && (
                  <Typography variant="caption" color="text.secondary">
                    System account — cannot be deleted
                  </Typography>
                )}
              </Box>
            </FormSection>

            {/* Parent Account Info (view mode) */}
            {!isEditing && !isCreating && parentAccount && (
              <FormSection title="Parent Account">
                <TextField
                  label="Parent"
                  size="small"
                  value={`${parentAccount.account_code} - ${parentAccount.account_name}`}
                  disabled
                />
              </FormSection>
            )}

            {/* Child Accounts (view mode only) */}
            {!isEditing && !isCreating && childAccounts.length > 0 && (
              <FormSection title={`Sub-Accounts (${childAccounts.length})`} columns={1}>
                <Paper variant="outlined" sx={{ width: "100%", overflow: "hidden", borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: "action.hover" }}>
                        <TableCell sx={{ fontWeight: 700 }}>Code</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {childAccounts.map((child) => (
                        <TableRow
                          key={child.id}
                          hover
                          sx={{ cursor: "pointer" }}
                          onClick={() => handleSelectAccount(child)}
                        >
                          <TableCell>{child.account_code}</TableCell>
                          <TableCell>{child.account_name}</TableCell>
                          <TableCell>
                            <Chip label={child.account_type} size="small" color={getTypeColor(child.account_type)} variant="outlined" />
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={child.is_active ? "Active" : "Inactive"}
                              size="small"
                              color={child.is_active ? "success" : "default"}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Paper>
              </FormSection>
            )}

            {/* Activity History (view mode only) */}
            {selectedAccount && !isCreating && !isEditing && (
              <FormSection
                title="Activity History"
                columns={2}
                titleAction={
                  <Tooltip title="View activity history">
                    <IconButton size="small" onClick={() => setActivityHistoryOpen(true)}>
                      <HistoryIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
              >
                <Box>
                  <Typography variant="caption" color="text.secondary">Created By</Typography>
                  <Typography variant="body2">
                    {selectedAccount.created_by_name || "-"}
                    {selectedAccount.created_at ? ` on ${formatDateTimeReadable(selectedAccount.created_at)}` : ""}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Last Modified By</Typography>
                  <Typography variant="body2">
                    {selectedAccount.updated_by_name || "-"}
                    {selectedAccount.updated_at ? ` on ${formatDateTimeReadable(selectedAccount.updated_at)}` : ""}
                  </Typography>
                </Box>
              </FormSection>
            )}
          </>
        )}
      </Box>
    </Box>
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <MasterDetailLayout
        title="Chart of Accounts"
        icon={<AccountTreeIcon color="primary" />}
        titleSlot={
          isAccountDetailMode ? undefined : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search accounts..."
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
                  value={filterType}
                  onChange={(val) => setFilterType(val as string | null)}
                  options={ACCOUNT_TYPES.map((t) => ({
                    value: t.value,
                    label: t.label,
                    color: t.color,
                  }))}
                  showAllOption
                  allOptionLabel="All Types"
                  placeholder="Search types..."
                  size="small"
                />
              </Box>
              <Box sx={{ width: 150, flexShrink: 0 }}>
                <TSearchableSelect
                  label=""
                  value={filterActive}
                  onChange={(val) => setFilterActive(val as string | null)}
                  options={STATUS_FILTER_OPTIONS.map((s) => ({
                    value: s.value,
                    label: s.label,
                    color: s.color,
                  }))}
                  showAllOption
                  allOptionLabel="All Statuses"
                  placeholder="Search status..."
                  size="small"
                />
              </Box>
              {(searchQuery || filterType || filterActive) && (
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
          isAccountDetailMode ? undefined : (
            <>
              <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={handleNew} sx={{ mr: 1 }}>
                Add Account
              </Button>
              {accounts.length === 0 && (
                <button
                  onClick={() => seedMutation.mutate()}
                  disabled={seedMutation.isPending}
                  style={{
                    padding: "6px 12px",
                    background: "#9c27b0",
                    color: "#fff",
                    border: "none",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontSize: "0.8125rem",
                    marginRight: 8,
                  }}
                >
                  {seedMutation.isPending ? "Seeding..." : "Seed Standard COA"}
                </button>
              )}
              <TExportButton
                filename="chart_of_accounts"
                headers={[
                  "Account Code",
                  "Account Name",
                  "Type",
                  "Category",
                  "Normal Balance",
                  "System Account",
                  "Active",
                ]}
                rows={() =>
                  filteredAccounts.map((a) => [
                    a.account_code || "",
                    a.account_name || "",
                    a.account_type || "",
                    a.account_category || "",
                    a.normal_balance || "",
                    a.is_system_account ? "Yes" : "No",
                    a.is_active ? "Yes" : "No",
                  ])
                }
                disabled={filteredAccounts.length === 0}
              />
            </>
          )
        }
        {...(isAccountDetailMode
          ? { masterPanel: singleAccountPanel, detailPanel }
          : { children: accountTablePanel })}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
      <TActivityHistoryPanel
        open={activityHistoryOpen}
        onClose={() => setActivityHistoryOpen(false)}
        entityType="chart_of_account"
        entityId={selectedAccount?.id}
        actionLabels={ACTIVITY_ACTION_LABELS}
      />
    </>
  );
}
