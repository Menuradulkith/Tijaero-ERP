/**
 * ChartOfAccountsPage - Chart of Accounts Management
 *
 * Displays accounts in a flat list with Master-Detail layout.
 * Follows the same UI pattern as PurchaseOrdersPage / SalesPage.
 * Uses ActionToolbar with inline editing, TFilterPanel, expanded list items.
 */

import AccountTreeIcon from "@mui/icons-material/AccountTree";
import {
  Box,
  Chip,
  FormControlLabel,
  MenuItem,
  Paper,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  FormSection,
  handleApiError,
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  showErrorToast,
  showSuccessToast,
  TFilterPanel,
  TSearchableSelect,
  type SortOption,
  TDetailSkeleton,
  useMasterDetailState,
  TConfirmDialog,
  useConfirmDialog,
  useCrudMutation,
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

const SORT_OPTIONS: SortOption[] = [
  { value: "account_code", label: "Account Code" },
  { value: "account_name", label: "Account Name" },
  { value: "account_type", label: "Account Type" },
];

const STATUS_FILTER_OPTIONS = [
  { value: "active", label: "Active", color: "success" as const },
  { value: "inactive", label: "Inactive", color: "default" as const },
];

const getTypeColor = (type: string) =>
  ACCOUNT_TYPES.find((t) => t.value === type)?.color || ("default" as const);

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

  // Filter states
  const [filterType, setFilterType] = useState<string | null>(null);
  const [filterActive, setFilterActive] = useState<string | null>("active");

  // ─── Master-Detail State ───────────────────────────────────────────────────

  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem: selectedAccount,
    setSelectedItem: setSelectedAccount,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
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
    filtered.sort((a, b) => {
      if (sortField === "account_name")
        return a.account_name.localeCompare(b.account_name);
      if (sortField === "account_type")
        return a.account_type.localeCompare(b.account_type);
      return a.account_code.localeCompare(b.account_code);
    });
    return filtered;
  }, [accounts, searchQuery, sortField]);

  useEffect(() => {
    if (filteredAccounts.length > 0 && !selectedAccount && !isCreating) {
      handleSelectAccount(filteredAccounts[0]);
    }
  }, [filteredAccounts, selectedAccount, isCreating]);

  const handleCancel = useCallback(
    (items: ChartOfAccount[]) => {
      handleCancelBase(items);
    },
    [handleCancelBase]
  );

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

  // ─── Master Panel ──────────────────────────────────────────────────────────

  const masterPanel = (
    <SearchableList<ChartOfAccount>
      items={filteredAccounts}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search accounts..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedAccount}
      onSelectItem={handleSelectAccount}
      emptyMessage="No accounts found"
      listHeader={
        <TFilterPanel>
          {accounts.length === 0 && (
            <Box sx={{ width: "100%" }}>
              <button
                onClick={() => seedMutation.mutate()}
                disabled={seedMutation.isPending}
                style={{
                  width: "100%",
                  padding: "6px 12px",
                  background: "#9c27b0",
                  color: "#fff",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontSize: "0.8125rem",
                }}
              >
                {seedMutation.isPending ? "Seeding..." : "Seed Standard COA"}
              </button>
            </Box>
          )}
          <TSearchableSelect
            label="Account Type"
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
          />
          <TSearchableSelect
            label="Status"
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
          />
        </TFilterPanel>
      }
      renderItem={(account: ChartOfAccount, isSelected: boolean) => {
        const typeColor = getTypeColor(account.account_type);
        return (
          <SelectableListItem
            key={account.id}
            id={account.id}
            isSelected={isSelected}
            onClick={() => handleSelectAccount(account)}
            primaryText={
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{account.account_code}</span>
                  {isSelected && (
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Account Code)
                    </Typography>
                  )}
                </Box>
                {isSelected && (
                  <>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {account.account_name}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Name)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {account.account_category || "N/A"}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Category)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                      <Chip
                        label={account.account_type}
                        size="small"
                        color={typeColor}
                        sx={{ height: 18, fontSize: "0.65rem" }}
                      />
                      <Chip
                        label={account.is_active ? "Active" : "Inactive"}
                        size="small"
                        color={account.is_active ? "success" : "default"}
                        variant="outlined"
                        sx={{ height: 18, fontSize: "0.65rem" }}
                      />
                    </Box>
                  </>
                )}
              </Box>
            }
            secondaryText={!isSelected ? account.account_name : undefined}
            statusChip={!isSelected ? { label: account.account_type, color: typeColor } : undefined}
          />
        );
      }}
    />
  );

  // ─── Detail Panel ──────────────────────────────────────────────────────────

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
        onCancel={() => handleCancel(filteredAccounts)}
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
                <Paper variant="outlined" sx={{ width: "100%", overflow: "hidden", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
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

            {/* Record Information (view mode only) */}
            {selectedAccount && !isCreating && !isEditing && (
              <FormSection title="Record Information" columns={2}>
                <Box>
                  <Typography variant="caption" color="text.secondary">Created</Typography>
                  <Typography variant="body2">{formatDateTimeReadable(selectedAccount.created_at) || "-"}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Last Modified</Typography>
                  <Typography variant="body2">{formatDateTimeReadable(selectedAccount.updated_at) || "-"}</Typography>
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
        onRefresh={refetch}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
