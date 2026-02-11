/**
 * ChartOfAccountsPage - Chart of Accounts Management
 *
 * Displays accounts in a flat list with tree view option.
 * Uses MasterDetailLayout with Tijaero components.
 */

import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
  Typography,
  Switch,
  FormControlLabel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Paper,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import {
  DetailPanelHeader,
  EmptyState,
  FormSection,
  handleApiError,
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  showErrorToast,
  showSuccessToast,
  TConfirmDialog,
  useTConfirmDialog,
  type SortOption,
} from "@/components/tijaero";

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

// ─── Component ───────────────────────────────────────────────────────────────

export default function ChartOfAccountsPage() {
  const queryClient = useQueryClient();

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("account_code");
  const [filterType, setFilterType] = useState<string | null>(null);
  const [filterActive, setFilterActive] = useState<boolean | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<ChartOfAccount | null>(null);

  // Dialogs
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const deleteDialog = useTConfirmDialog();

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["chart-of-accounts", filterType, filterActive],
    queryFn: () =>
      chartOfAccountsApi.getAll({
        account_type: filterType ?? undefined,
        is_active: filterActive ?? undefined,
        limit: 1000,
      }),
  });

  // Also fetch all accounts for parent dropdown
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
    if (filteredAccounts.length > 0 && !selectedAccount) {
      setSelectedAccount(filteredAccounts[0]);
    }
  }, [filteredAccounts, selectedAccount]);

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["chart-of-accounts"] });
  };

  const createMutation = useMutation({
    mutationFn: chartOfAccountsApi.create,
    onSuccess: (data) => {
      invalidate();
      showSuccessToast("Account created successfully");
      setCreateDialogOpen(false);
      setSelectedAccount(data);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to create account")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ChartOfAccountCreate> }) =>
      chartOfAccountsApi.update(id, data),
    onSuccess: (data) => {
      invalidate();
      showSuccessToast("Account updated");
      setEditDialogOpen(false);
      setSelectedAccount(data);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to update account")),
  });

  const deleteMutation = useMutation({
    mutationFn: chartOfAccountsApi.delete,
    onSuccess: () => {
      invalidate();
      showSuccessToast("Account deleted");
      setSelectedAccount(null);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to delete account")),
  });

  const seedMutation = useMutation({
    mutationFn: () => chartOfAccountsApi.seed(true),
    onSuccess: (result) => {
      invalidate();
      showSuccessToast(
        `COA seeded: ${result.created} created, ${result.parent_links_set} parent links set (${result.total} total)`
      );
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to seed Chart of Accounts")),
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleDelete = useCallback(() => {
    if (!selectedAccount) return;
    deleteDialog.open(
      "Delete Account",
      `Are you sure you want to delete account "${selectedAccount.account_code} - ${selectedAccount.account_name}"?`,
      () => deleteMutation.mutate(selectedAccount.id)
    );
  }, [selectedAccount, deleteDialog, deleteMutation]);

  const getTypeColor = (type: AccountType) =>
    ACCOUNT_TYPES.find((t) => t.value === type)?.color || "default";

  // ─── Forms ─────────────────────────────────────────────────────────────────

  const createForm = useForm<ChartOfAccountCreate>({
    defaultValues: {
      account_code: "",
      account_name: "",
      account_type: "Asset",
      account_category: "",
      parent_account_id: null,
      is_active: true,
      is_system_account: false,
      normal_balance: "Debit",
      description: "",
    },
  });

  const editForm = useForm<Partial<ChartOfAccountCreate>>();

  // ─── Master Panel ──────────────────────────────────────────────────────────

  const masterPanel = (
    <SearchableList
      items={filteredAccounts}
      isLoading={isLoading}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search accounts..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      listHeader={
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, p: 1 }}>
          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
            {accounts.length === 0 && (
              <Button
                variant="contained"
                size="small"
                color="secondary"
                startIcon={<PlaylistAddIcon />}
                onClick={() => seedMutation.mutate()}
                disabled={seedMutation.isPending}
              >
                {seedMutation.isPending ? "Seeding..." : "Seed Standard COA"}
              </Button>
            )}
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => {
                createForm.reset();
                setCreateDialogOpen(true);
              }}
            >
              New Account
            </Button>
          </Box>
          <TextField
            select
            size="small"
            label="Account Type"
            value={filterType || ""}
            onChange={(e) => setFilterType(e.target.value || null)}
            fullWidth
          >
            <MenuItem value="">All Types</MenuItem>
            {ACCOUNT_TYPES.map((t) => (
              <MenuItem key={t.value} value={t.value}>
                {t.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Status"
            value={filterActive === null ? "" : filterActive ? "active" : "inactive"}
            onChange={(e) => {
              const v = e.target.value;
              setFilterActive(v === "" ? null : v === "active");
            }}
            fullWidth
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="inactive">Inactive</MenuItem>
          </TextField>
        </Box>
      }
      renderItem={(account: ChartOfAccount, isSelected: boolean) => (
        <SelectableListItem
          key={account.id}
          id={account.id}
          isSelected={isSelected}
          onClick={() => setSelectedAccount(account)}
          primaryText={
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
              <Typography variant="body2" fontWeight={600}>
                {account.account_code}
              </Typography>
              <Chip
                label={account.account_type}
                size="small"
                color={getTypeColor(account.account_type)}
                variant="outlined"
              />
            </Box>
          }
          secondaryText={
            !isSelected ? account.account_name : undefined
          }
        />
      )}
    />
  );

  // ─── Detail Panel ──────────────────────────────────────────────────────────

  const detail = selectedAccount;

  const parentAccount = detail?.parent_account_id
    ? allAccounts.find((a) => a.id === detail.parent_account_id)
    : null;

  const childAccounts = detail
    ? allAccounts.filter((a) => a.parent_account_id === detail.id)
    : [];

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Finance" },
          { label: "Chart of Accounts", href: "/finance/chart-of-accounts" },
          ...(detail ? [{ label: detail.account_code }] : []),
        ]}
        title={detail ? `${detail.account_code} - ${detail.account_name}` : ""}
        titleIcon={<AccountTreeIcon color="primary" />}
        noSelectionTitle="Select an Account"
        chips={
          detail
            ? [
                { label: detail.account_type.charAt(0).toUpperCase() + detail.account_type.slice(1), color: getTypeColor(detail.account_type) },
                ...(detail.is_active ? [] : [{ label: "Inactive", color: "default" as const }]),
              ]
            : []
        }
      />

      {detail && (
        <>
          {/* Action Buttons */}
          <Box sx={{ display: "flex", gap: 1, p: 1, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<EditIcon />}
              onClick={() => {
                editForm.reset({
                  account_name: detail.account_name,
                  account_category: detail.account_category,
                  parent_account_id: detail.parent_account_id,
                  is_active: detail.is_active,
                  normal_balance: detail.normal_balance,
                  description: detail.description,
                });
                setEditDialogOpen(true);
              }}
            >
              Edit
            </Button>
            {!detail.is_system_account && (
              <Button
                variant="outlined"
                size="small"
                color="error"
                startIcon={<DeleteIcon />}
                onClick={handleDelete}
              >
                Delete
              </Button>
            )}
          </Box>

          {/* Account Details */}
          <Box sx={{ p: 2, overflow: "auto" }}>
            <FormSection title="Account Information">
              <Table size="small">
                <TableBody>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600, width: 180 }}>Account Code</TableCell>
                    <TableCell>{detail.account_code}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Account Name</TableCell>
                    <TableCell>{detail.account_name}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Account Type</TableCell>
                    <TableCell>
                      <Chip label={detail.account_type} size="small" color={getTypeColor(detail.account_type)} />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Category</TableCell>
                    <TableCell>{detail.account_category}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Normal Balance</TableCell>
                    <TableCell>
                      <Chip label={detail.normal_balance} size="small" variant="outlined" />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Parent Account</TableCell>
                    <TableCell>
                      {parentAccount
                        ? `${parentAccount.account_code} - ${parentAccount.account_name}`
                        : "None (Root)"}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                    <TableCell>
                      <Chip
                        label={detail.is_active ? "Active" : "Inactive"}
                        size="small"
                        color={detail.is_active ? "success" : "default"}
                      />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>System Account</TableCell>
                    <TableCell>{detail.is_system_account ? "Yes" : "No"}</TableCell>
                  </TableRow>
                  {detail.description && (
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
                      <TableCell>{detail.description}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </FormSection>

            {/* Child Accounts */}
            {childAccounts.length > 0 && (
              <FormSection title={`Sub-Accounts (${childAccounts.length})`}>
                <Paper variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Code</TableCell>
                        <TableCell>Name</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell>Status</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {childAccounts.map((child) => (
                        <TableRow
                          key={child.id}
                          hover
                          sx={{ cursor: "pointer" }}
                          onClick={() => setSelectedAccount(child)}
                        >
                          <TableCell>{child.account_code}</TableCell>
                          <TableCell>{child.account_name}</TableCell>
                          <TableCell>
                            <Chip label={child.account_type} size="small" variant="outlined" />
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
          </Box>
        </>
      )}

      {!detail && (
        <EmptyState message="Select an account from the list to view details" />
      )}
    </Box>
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <MasterDetailLayout
        title="Chart of Accounts"
        icon={<AccountTreeIcon color="primary" />}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />

      {/* Create Dialog */}
      <Dialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create New Account</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
            <Controller
              name="account_code"
              control={createForm.control}
              rules={{ required: "Account code is required" }}
              render={({ field, fieldState }) => (
                <TextField
                  {...field}
                  label="Account Code"
                  fullWidth
                  size="small"
                  error={!!fieldState.error}
                  helperText={fieldState.error?.message}
                />
              )}
            />
            <Controller
              name="account_name"
              control={createForm.control}
              rules={{ required: "Account name is required" }}
              render={({ field, fieldState }) => (
                <TextField
                  {...field}
                  label="Account Name"
                  fullWidth
                  size="small"
                  error={!!fieldState.error}
                  helperText={fieldState.error?.message}
                />
              )}
            />
            <Controller
              name="account_type"
              control={createForm.control}
              render={({ field }) => (
                <TextField {...field} select label="Account Type" fullWidth size="small">
                  {ACCOUNT_TYPES.map((t) => (
                    <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
                  ))}
                </TextField>
              )}
            />
            <Controller
              name="account_category"
              control={createForm.control}
              rules={{ required: "Category is required" }}
              render={({ field, fieldState }) => (
                <TextField
                  {...field}
                  label="Category"
                  fullWidth
                  size="small"
                  error={!!fieldState.error}
                  helperText={fieldState.error?.message}
                />
              )}
            />
            <Controller
              name="normal_balance"
              control={createForm.control}
              render={({ field }) => (
                <TextField {...field} select label="Normal Balance" fullWidth size="small">
                  <MenuItem value="Debit">Debit</MenuItem>
                  <MenuItem value="Credit">Credit</MenuItem>
                </TextField>
              )}
            />
            <Controller
              name="parent_account_id"
              control={createForm.control}
              render={({ field }) => (
                <TextField
                  {...field}
                  value={field.value ?? ""}
                  onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                  select
                  label="Parent Account"
                  fullWidth
                  size="small"
                >
                  <MenuItem value="">None (Root Account)</MenuItem>
                  {allAccounts.map((a) => (
                    <MenuItem key={a.id} value={a.id}>
                      {a.account_code} - {a.account_name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
            <Controller
              name="description"
              control={createForm.control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Description"
                  fullWidth
                  size="small"
                  multiline
                  rows={2}
                />
              )}
            />
            <Controller
              name="is_active"
              control={createForm.control}
              render={({ field }) => (
                <FormControlLabel
                  control={<Switch checked={field.value} onChange={field.onChange} />}
                  label="Active"
                />
              )}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={createForm.handleSubmit((data) => createMutation.mutate(data))}
            disabled={createMutation.isPending}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={editDialogOpen}
        onClose={() => setEditDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Edit Account</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
            <Controller
              name="account_name"
              control={editForm.control}
              render={({ field }) => (
                <TextField {...field} label="Account Name" fullWidth size="small" />
              )}
            />
            <Controller
              name="account_category"
              control={editForm.control}
              render={({ field }) => (
                <TextField {...field} label="Category" fullWidth size="small" />
              )}
            />
            <Controller
              name="normal_balance"
              control={editForm.control}
              render={({ field }) => (
                <TextField {...field} select label="Normal Balance" fullWidth size="small">
                  <MenuItem value="Debit">Debit</MenuItem>
                  <MenuItem value="Credit">Credit</MenuItem>
                </TextField>
              )}
            />
            <Controller
              name="parent_account_id"
              control={editForm.control}
              render={({ field }) => (
                <TextField
                  {...field}
                  value={field.value ?? ""}
                  onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                  select
                  label="Parent Account"
                  fullWidth
                  size="small"
                >
                  <MenuItem value="">None (Root Account)</MenuItem>
                  {allAccounts
                    .filter((a) => a.id !== detail?.id)
                    .map((a) => (
                      <MenuItem key={a.id} value={a.id}>
                        {a.account_code} - {a.account_name}
                      </MenuItem>
                    ))}
                </TextField>
              )}
            />
            <Controller
              name="description"
              control={editForm.control}
              render={({ field }) => (
                <TextField {...field} label="Description" fullWidth size="small" multiline rows={2} />
              )}
            />
            <Controller
              name="is_active"
              control={editForm.control}
              render={({ field }) => (
                <FormControlLabel
                  control={<Switch checked={field.value ?? true} onChange={field.onChange} />}
                  label="Active"
                />
              )}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={editForm.handleSubmit((data) => {
              if (detail) updateMutation.mutate({ id: detail.id, data });
            })}
            disabled={updateMutation.isPending}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <TConfirmDialog {...deleteDialog.dialogProps} />
    </Box>
  );
}
