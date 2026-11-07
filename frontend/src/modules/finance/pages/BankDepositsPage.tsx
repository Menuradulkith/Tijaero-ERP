/**
 * Bank Deposits Page - Master-Detail Layout
 * Follows the Purchasing/Sales UI pattern with Tijaero components.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  IconButton,
  InputAdornment,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  AccountBalance as BankIcon,
  History as HistoryIcon,
  Search as SearchIcon,
  ArrowBack as ArrowBackIcon,
  OpenInNew as OpenInNewIcon,
  Add as AddIcon,
  Verified as VerifiedIcon,
} from "@mui/icons-material";
import type { GridRenderCellParams } from "@mui/x-data-grid";

import {
  TChip,
  MasterDetailLayout,
  DetailPanelHeader,
  FormSection,
  EmptyState,
  useMasterDetailState,
  useRecordParam,
  TDetailSkeleton,
  TBranchFilter,
  TStatusFilter,
  TDataGrid,
  type TDataGridColumn,
  fmtLKR,
  TActivityHistoryPanel,
  TRemarkField,
  ActionToolbar,
  TConfirmDialog,
  useTConfirmDialog,
  useCrudMutation,
  showErrorToast,
} from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";

import { bankDepositsApi, bankReconciliationApi, cashbookApi } from "@/modules/finance/api";
import { BankAccount, BankDeposit, BankDepositCreate } from "@/modules/finance/types";
import { useReferenceData } from "@/hooks";
import { useCurrencyStore } from "@/state/currencyStore";
import { displayDate, formatCurrency, todayISO } from "@/utils/formatters";

// The number shown everywhere else (cashbook, ledger) for a deposit.
const depositNo = (d: { id: number }) => `DEP-${d.id}`;

// "Payment for" in plain words instead of the stored code.
const PAYMENT_FOR_LABELS: Record<string, string> = {
  cash_deposit: "Cash deposit",
  "Sales Invoice": "Bank / card payment on a sale",
  "Credit Settlement": "Customer paid balance into bank",
  "Cheque Deposit - Sales Invoice": "Cheque deposit",
};
const paymentForLabel = (v?: string | null) => {
  if (!v) return "-";
  if (PAYMENT_FOR_LABELS[v]) return PAYMENT_FOR_LABELS[v];
  const words = v.replace(/_/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};
// Deposits whose money never sat in the till (same list as the backend's cash check).
const NON_CASH_SOURCES = ["Sales Invoice", "Credit Settlement", "Cheque Deposit - Sales Invoice"];

// Same label as the expense pay dialog: "HNB QA-42228 bank · 1234" — several
// accounts can be at the same bank, so the account name and number tell them apart.
const bankAccountLabel = (a: BankAccount) =>
  [a.bank_name && a.bank_name !== a.name ? `${a.bank_name} ${a.name}` : a.name, a.account_number]
    .filter(Boolean)
    .join(" · ");

interface Branch {
  branch_code: string;
  branch_name: string;
}

// A bank deposit row as shown in the browse table, with the branch name
// looked up and attached directly so the table's own column-header sort
// orders by the displayed name rather than the raw branch_code.
type BankDepositRow = BankDeposit & { branch_name: string };

const INITIAL_FORM_DATA: Partial<BankDepositCreate> = {
  deposits_amount: 0,
  branch_code: "",
  bank_name: "",
  remarks: "",
  payment_for: "",
  invoice_no: "",
};

// Cash taken from a branch to the bank (the only kind of deposit created from this page).
const CASH_DEPOSIT = "cash_deposit";

const resetFormFromItem = (item: BankDeposit): Partial<BankDepositCreate> => ({
  deposits_amount: Number(item.deposits_amount) || 0,
  branch_code: item.branch_code || "",
  bank_name: item.bank_name || "",
  remarks: item.remarks || "",
  payment_for: item.payment_for || "",
  invoice_no: item.invoice_no || "",
});

export default function BankDepositsPage() {
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  // Filter state - all filters apply live as the user types/selects, no
  // separate "Search" step needed.
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterVerified, setFilterVerified] = useState<string | null>(null);

  const {
    searchQuery,
    setSearchQuery,
    selectedItem,
    openItem,
    setSelectedItem,
    isCreating,
    setIsCreating,
    setIsEditing,
    formData,
    setFormData,
    handleSelectItem,
    handleNew,
  } = useMasterDetailState<BankDeposit, Partial<BankDepositCreate>>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem,
    defaultSortField: "created_date",
  });

  // Activity History is opened on demand from a detail icon next to the
  // Status section title, rather than shown inline.
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);

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
    setFilterVerified(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  const { data: deposits = [], isLoading, refetch } = useQuery({
    queryKey: ["bank-deposits", filterBranch, filterVerified],
    queryFn: () =>
      bankDepositsApi.getAll({
        branch_code: filterBranch || undefined,
        verified: filterVerified === null ? undefined : filterVerified === "verified",
      }),
    enabled: branchResolved,
    placeholderData: (prev) => prev,
  });

  const filteredDeposits = useMemo(() => {
    if (!deposits) return [];
    let filtered = deposits.filter(
      (d) =>
        (d.bank_name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (d.invoice_no || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        paymentForLabel(d.payment_for).toLowerCase().includes(searchQuery.toLowerCase()) ||
        depositNo(d).toLowerCase().includes(searchQuery.toLowerCase())
    );
    // Default order before the user sorts a column in the table itself (the
    // table's own column-header sort takes over from there).
    filtered.sort((a, b) => {
      const timeDiff = new Date(b.created_date || "").getTime() - new Date(a.created_date || "").getTime();
      if (timeDiff !== 0) return timeDiff;
      return b.id - a.id;
    });
    return filtered;
  }, [deposits, searchQuery]);

  const handleSelectWithCheck = useCallback(
    async (item: BankDeposit) => {
      await handleSelectItem(item);
    },
    [handleSelectItem]
  );

  // Whether we're showing a single bank deposit's detail view (selected or
  // being created) instead of the browse table.
  const isDepositDetailMode = !!selectedItem || isCreating;

  // Returns to the browse table from the detail view (also leaves "New Deposit").
  const handleBackToDeposits = useCallback(() => {
    setSelectedItem(null);
    setIsCreating(false);
    setIsEditing(false);
  }, [setSelectedItem, setIsCreating, setIsEditing]);

  // ---- Create / verify -------------------------------------------------------
  // The backend gates create on bank_deposits:create and verify on
  // bank_transfer_verify:approve, so the buttons follow the same permissions.
  const canCreate = usePermission("bank_deposits", "create");
  const canVerify = usePermission("bank_transfer_verify", "approve");
  const verifyDialog = useTConfirmDialog();
  const [showErrors, setShowErrors] = useState(false);
  // Blocks a second Save / Verify click before the first request has settled.
  const savingRef = useRef(false);

  const fieldErrors = {
    branch_code: !formData.branch_code ? "Branch is required" : undefined,
    bank_name: !(formData.bank_name || "").trim() ? "Bank name is required" : undefined,
    deposits_amount: !(Number(formData.deposits_amount) > 0) ? "Amount must be greater than 0" : undefined,
  };
  const isFormValid = !fieldErrors.branch_code && !fieldErrors.bank_name && !fieldErrors.deposits_amount;

  // Registered bank accounts (Bank Reconciliation). Free text only when there are none
  // (or this user may not see them).
  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: bankReconciliationApi.listAccounts,
    enabled: isCreating,
    retry: false,
  });
  const bankOptions = useMemo(() => {
    const active = bankAccounts.filter((a) => a.is_active);
    const forBranch = active.filter((a) => !a.branch_code || a.branch_code === formData.branch_code);
    return (forBranch.length ? forBranch : active).map((a) => ({ id: a.id, label: bankAccountLabel(a) }));
  }, [bankAccounts, formData.branch_code]);

  // "How much cash is there to deposit?" — the cashbook's cash in hand for the branch
  // today, less cash deposits still waiting for verification.
  const depositBranch = isCreating ? formData.branch_code || "" : "";
  const { data: branchCashbook } = useQuery({
    queryKey: ["cashbook", "cash-in-hand", depositBranch, todayISO()],
    queryFn: () => cashbookApi.getReport({ branch_code: depositBranch, date_from: todayISO(), date_to: todayISO() }),
    enabled: !!depositBranch,
    retry: false,
  });
  const { data: pendingDeposits = [] } = useQuery({
    queryKey: ["bank-deposits", "pending", depositBranch],
    queryFn: () => bankDepositsApi.getAll({ branch_code: depositBranch, verified: false }),
    enabled: !!depositBranch,
    retry: false,
  });
  const cashAvailable =
    branchCashbook?.summary?.cash_closing_balance === undefined
      ? null
      : Number(branchCashbook.summary.cash_closing_balance) -
        pendingDeposits
          .filter((d) => !d.verified && !NON_CASH_SOURCES.includes(d.payment_for || ""))
          .reduce((s, d) => s + Number(d.deposits_amount || 0), 0);
  const depositBranchName = branches.find((b) => b.branch_code === depositBranch)?.branch_name || depositBranch;
  const errorFor = (field: keyof typeof fieldErrors) => (isCreating && showErrors ? fieldErrors[field] : undefined);

  const handleNewDeposit = useCallback(async () => {
    const ok = await handleNew();
    if (!ok) return;
    setShowErrors(false);
    setFormData({ ...INITIAL_FORM_DATA, branch_code: defaultBranchCode || "", payment_for: CASH_DEPOSIT });
  }, [handleNew, setFormData, defaultBranchCode]);

  const createMutation = useCrudMutation({
    mutationFn: bankDepositsApi.create,
    invalidateQueryKeys: [["bank-deposits"]],
    successMessage: "Bank deposit recorded",
    errorMessage: "Failed to record bank deposit",
    onSuccess: (created: BankDeposit) => {
      setIsCreating(false);
      setIsEditing(false);
      handleSelectItem(created);
    },
  });

  const verifyMutation = useCrudMutation({
    mutationFn: (id: number) => bankDepositsApi.verify(id),
    invalidateQueryKeys: [["bank-deposits"]],
    successMessage: "Bank deposit verified",
    errorMessage: "Failed to verify bank deposit",
    onSuccess: (verified: BankDeposit) => {
      handleSelectItem(verified);
    },
  });

  const isSaving = createMutation.isPending || verifyMutation.isPending;

  const handleSave = useCallback(() => {
    if (!isCreating || savingRef.current) return;
    if (!isFormValid) {
      setShowErrors(true);
      showErrorToast("Enter the branch, bank name and an amount greater than 0");
      return;
    }
    const payload: BankDepositCreate = {
      deposits_amount: Number(formData.deposits_amount),
      branch_code: formData.branch_code || "",
      bank_name: (formData.bank_name || "").trim(),
      invoice_no: (formData.invoice_no || "").trim() || undefined,
      remarks: (formData.remarks || "").trim() || undefined,
      payment_for: CASH_DEPOSIT,
    };
    savingRef.current = true;
    createMutation.mutate(payload, { onSettled: () => { savingRef.current = false; } });
  }, [isCreating, isFormValid, formData, createMutation]);

  const handleCancelCreate = useCallback(() => {
    setIsCreating(false);
    setIsEditing(false);
    setSelectedItem(null);
    setShowErrors(false);
  }, [setIsCreating, setIsEditing, setSelectedItem]);

  const handleVerify = useCallback(() => {
    if (!selectedItem || selectedItem.verified || savingRef.current) return;
    const deposit = selectedItem;
    verifyDialog.open(
      "Verify Bank Deposit",
      `Confirm that deposit ${depositNo(deposit)} of ${currencySymbol} ${fmtLKR(Number(deposit.deposits_amount || 0))} to ${deposit.bank_name || "the bank"} has reached the bank account?`,
      () => {
        if (savingRef.current) return;
        savingRef.current = true;
        verifyMutation.mutate(deposit.id, { onSettled: () => { savingRef.current = false; } });
      }
    );
  }, [selectedItem, verifyDialog, verifyMutation, currencySymbol]);

  // The table sorts by whichever column the user clicks; the Branch column
  // displays a looked-up name rather than the raw branch_code, so it needs
  // that name as its own field for the grid to sort on correctly.
  const depositRows: BankDepositRow[] = useMemo(
    () =>
      filteredDeposits.map((dep) => ({
        ...dep,
        branch_name: branches.find((b) => b.branch_code === dep.branch_code)?.branch_name || dep.branch_code || "-",
      })),
    [filteredDeposits, branches]
  );

  const depositColumns: TDataGridColumn<BankDepositRow>[] = useMemo(
    () => [
      {
        field: "id",
        header: "Deposit No",
        width: 130,
        renderCell: (params: GridRenderCellParams<BankDepositRow>) => depositNo(params.row),
      },
      { field: "bank_name", header: "Bank", flex: 1, minWidth: 150 },
      { field: "branch_name", header: "Branch", width: 150 },
      { field: "created_date", header: "Date", width: 120, type: "date" },
      {
        field: "payment_for",
        header: "Payment For",
        width: 170,
        renderCell: (params: GridRenderCellParams<BankDepositRow>) => paymentForLabel(params.row.payment_for),
      },
      {
        field: "deposits_amount",
        header: "Amount",
        width: 140,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<BankDepositRow>) => `${currencySymbol} ${fmtLKR(Number(params.row.deposits_amount || 0))}`,
      },
      {
        field: "invoice_no",
        header: "Reference",
        width: 150,
        renderCell: (params: GridRenderCellParams<BankDepositRow>) => params.row.invoice_no || "-",
      },
      {
        field: "verified",
        header: "Status",
        width: 120,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<BankDepositRow>) => (
          <TChip
            label={params.row.verified ? "Verified" : "Pending"}
            size="small"
            color={params.row.verified ? "success" : "warning"}
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
        renderCell: (params: GridRenderCellParams<BankDepositRow>) => (
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
    [handleSelectWithCheck, currencySymbol]
  );

  // Browse mode: a full-width table of every bank deposit (shown when
  // nothing is selected). Sorting is done per-column via the grid's own
  // column header menu, not a separate "Sort by" control.
  const depositTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<BankDepositRow>
          rows={depositRows}
          columns={depositColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectWithCheck(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No bank deposits found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Finance", href: "/finance" },
          { label: "Customer Payment Methods", href: "/finance/customer-payment-methods" },
          { label: "Bank Deposits", href: "/finance/customer-payment-methods/bank-deposits" },
          ...(selectedItem || isCreating ? [{ label: isCreating ? "New Deposit" : depositNo(selectedItem!) }] : []),
        ]}
        title={selectedItem ? `${depositNo(selectedItem)}${selectedItem.bank_name ? ` · ${selectedItem.bank_name}` : ""}` : ""}
        titleIcon={<BankIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Bank Deposit"
        noSelectionTitle="Select a Deposit"
      />

      {(isCreating || (selectedItem && !selectedItem.verified && canVerify)) && (
        <ActionToolbar
          hasSelectedItem={!!selectedItem}
          isCreating={isCreating}
          isEditing={isCreating}
          isSaving={isSaving}
          saveDisabled={isSaving}
          canCreate={false}
          canUpdate={false}
          canDelete={false}
          onSave={handleSave}
          onCancel={handleCancelCreate}
          endActions={
            selectedItem && !isCreating && !selectedItem.verified && canVerify ? (
              <Button
                size="small"
                variant="contained"
                color="success"
                startIcon={<VerifiedIcon />}
                onClick={handleVerify}
                disabled={isSaving}
              >
                Verify
              </Button>
            ) : undefined
          }
        />
      )}

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedItem && !isCreating ? (
          <EmptyState message="Select a bank deposit from the list or create a new one" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} />
        ) : (
          <>
            <FormSection title="Deposit Information" columns={3}>
              <TextField
                label="Deposit Amount"
                size="small"
                type="number"
                required={isCreating}
                value={isCreating ? (formData.deposits_amount || "") : (Number(formData.deposits_amount) || "")}
                onChange={(e) => setFormData((prev) => ({ ...prev, deposits_amount: e.target.value === "" ? 0 : Number(e.target.value) }))}
                disabled={!isCreating}
                inputProps={{ min: 0, step: "0.01" }}
                InputProps={{ readOnly: !isCreating }}
                error={!!errorFor("deposits_amount")}
                helperText={errorFor("deposits_amount")}
              />
              <Autocomplete
                size="small"
                options={branches}
                getOptionLabel={(option: Branch) => `${option.branch_code} - ${option.branch_name}`}
                isOptionEqualToValue={(o: Branch, v: Branch) => o.branch_code === v.branch_code}
                value={branches.find((b) => b.branch_code === formData.branch_code) || null}
                onChange={(_, v: Branch | null) => setFormData((prev) => ({ ...prev, branch_code: v?.branch_code || "" }))}
                disabled={!isCreating}
                readOnly={!isCreating}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Branch"
                    required={isCreating}
                    error={!!errorFor("branch_code")}
                    helperText={errorFor("branch_code")}
                    InputProps={{ ...params.InputProps, readOnly: !isCreating }}
                  />
                )}
              />
              {isCreating && bankOptions.length > 0 ? (
                <Autocomplete
                  size="small"
                  options={bankOptions}
                  value={bankOptions.find((o) => o.label === formData.bank_name) ?? null}
                  onChange={(_, v) => setFormData((prev) => ({ ...prev, bank_name: v?.label || "" }))}
                  getOptionLabel={(o) => o.label}
                  isOptionEqualToValue={(o, v) => o.id === v.id}
                  renderOption={(props, o) => (
                    <li {...props} key={o.id}>
                      {o.label}
                    </li>
                  )}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Bank"
                      required
                      error={!!errorFor("bank_name")}
                      helperText={errorFor("bank_name")}
                    />
                  )}
                />
              ) : (
                <TextField
                  label="Bank Name"
                  size="small"
                  required={isCreating}
                  value={formData.bank_name || ""}
                  onChange={(e) => setFormData((prev) => ({ ...prev, bank_name: e.target.value }))}
                  disabled={!isCreating}
                  InputProps={{ readOnly: !isCreating }}
                  error={!!errorFor("bank_name")}
                  helperText={errorFor("bank_name")}
                />
              )}
              {isCreating && depositBranch && cashAvailable !== null && (
                <Alert
                  severity={Number(formData.deposits_amount || 0) > cashAvailable + 0.005 ? "error" : "info"}
                  variant="outlined"
                  sx={{ gridColumn: "1 / -1", py: 0 }}
                >
                  Cash available at {depositBranchName}: <strong>{formatCurrency(Math.max(cashAvailable, 0))}</strong>
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    (cash and cheques in the till, less deposits waiting for verification)
                  </Typography>
                </Alert>
              )}
            </FormSection>

            <FormSection title="Reference Details" columns={2}>
              <TextField
                label="Payment For"
                size="small"
                value={paymentForLabel(formData.payment_for)}
                disabled
                InputProps={{ readOnly: true }}
              />
              <TextField
                label="Reference No"
                size="small"
                value={formData.invoice_no || ""}
                onChange={(e) => setFormData((prev) => ({ ...prev, invoice_no: e.target.value }))}
                disabled={!isCreating}
                InputProps={{ readOnly: !isCreating }}
                placeholder={isCreating ? "Bank slip / reference number" : undefined}
              />
            </FormSection>

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
                  <Typography variant="body2" color="text.secondary">Verification:</Typography>
                  <TChip label={selectedItem.verified ? "Verified" : "Pending"} size="small" color={selectedItem.verified ? "success" : "warning"} />
                </Box>
                <TextField
                  label="Date"
                  size="small"
                  value={displayDate(selectedItem.created_date) || "-"}
                  disabled
                  InputProps={{ readOnly: true }}
                />
                {selectedItem.returned !== undefined && (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography variant="body2" color="text.secondary">Returned:</Typography>
                    <TChip label={selectedItem.returned ? "Yes" : "No"} size="small" color={selectedItem.returned ? "error" : "default"} />
                  </Box>
                )}
              </FormSection>
            )}

            <FormSection title="Remarks" columns={1}>
              <TRemarkField
                label="Remarks"
                size="small"
                value={formData.remarks || ""}
                onChange={(value) => setFormData((prev) => ({ ...prev, remarks: value }))}
                disabled={!isCreating}
                InputProps={{ readOnly: !isCreating }}
                multiline
                rows={2}
              />
            </FormSection>
          </>
        )}
      </Box>
    </Box>
  );

  // Open record lives in the URL (?id= / ?new=1): browser Back returns to the list.
  useRecordParam({
    current: selectedItem?.id,
    creating: isCreating,
    items: deposits,
    loading: isLoading,
    fetchById: (id) => bankDepositsApi.getById(Number(id)),
    onOpen: openItem,
    onClose: handleBackToDeposits,
    onNew: canCreate ? handleNewDeposit : undefined,
  });

  return (
    <>
    <MasterDetailLayout
      title="Bank Deposits"
      titleSlot={
        isDepositDetailMode ? (
          <Button
            size="small"
            startIcon={<ArrowBackIcon fontSize="small" />}
            onClick={handleBackToDeposits}
            sx={{ textTransform: "none" }}
          >
            Back to Bank Deposits
          </Button>
          ) : (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <TextField
              size="small"
              placeholder="Search deposits..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              }}
              sx={{ width: 190, flexShrink: 0 }}
            />
            <Box sx={{ width: 170, flexShrink: 0 }}>
              <TBranchFilter branches={branches} value={filterBranch} onChange={setFilterBranch} label="" placeholder="All Branches" size="small" />
            </Box>
            <Box sx={{ width: 150, flexShrink: 0 }}>
              <TStatusFilter
                options={[
                  { value: null, label: "All" },
                  { value: "verified", label: "Verified" },
                  { value: "pending", label: "Pending" },
                ]}
                value={filterVerified}
                onChange={setFilterVerified}
                label=""
                placeholder="All"
                size="small"
              />
            </Box>
            {(searchQuery || filterBranch || filterVerified) && (
              <Button size="small" onClick={handleClearFilters} sx={{ textTransform: "none" }}>
                Clear
              </Button>
            )}
          </Box>
        )
      }
      headerActions={
        isDepositDetailMode || !canCreate ? undefined : (
          <Button
            variant="contained"
            size="small"
            startIcon={<AddIcon />}
            onClick={handleNewDeposit}
            sx={{ mr: 1 }}
          >
            New Deposit
          </Button>
        )
      }
      onRefresh={refetch}
      isLoading={isLoading}
      {...(isDepositDetailMode
        ? { children: detailPanel }
        : { children: depositTablePanel })}
    />

    <TActivityHistoryPanel
      open={activityHistoryOpen}
      onClose={() => setActivityHistoryOpen(false)}
      entityType="bank_deposit"
      entityId={selectedItem?.id}
      actionLabels={{
        create: "Deposit created",
        verify: "Deposit verified",
      }}
    />
    <TConfirmDialog {...verifyDialog.dialogProps} />
    </>
  );
}
