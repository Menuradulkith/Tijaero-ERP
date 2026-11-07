/**
 * PettyCashPage — petty cash funds, their transactions and reconciliation.
 *
 * Flow: open a fund → record expenses / replenish it → reconcile & close
 * (physical cash count, shows the variance).
 *
 * Same layout as the purchasing / sales pages: a full-width list with filters,
 * a full-page detail with breadcrumb and actions, and a full-page create form.
 */

import { usePermission } from "@/auth/permissions";
import {
  ActionToolbar,
  DetailPanelHeader,
  EXPENSE_CATEGORIES,
  FormSection,
  getStatusProps,
  MasterDetailLayout,
  showErrorToast,
  showSuccessToast,
  TBranchFilter,
  TCurrency,
  TDataGrid,
  type TDataGridColumn,
  TRemarkField,
  TSearchableSelect,
  useRecordParam,
  TDatePicker,
} from "@/components/tijaero";
import { handleApiError } from "@/utils/errorHandling";
import { useReferenceData } from "@/hooks";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CancelIcon from "@mui/icons-material/Cancel";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import SearchIcon from "@mui/icons-material/Search";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  LinearProgress,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { displayDate, formatCurrency, todayISO } from "@/utils/formatters";
import { useMemo, useRef, useState } from "react";
import { pettyCashApi } from "../api";
import {
  PettyCashFund,
  PettyCashFundCreate,
  PettyCashExpenseCreate,
  PettyCashReplenishCreate,
  PettyCashTransaction,
} from "../types";

const fmt = (v: number | string | null | undefined) =>
  Number(v ?? 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const categoryLabel = (code?: string | null) =>
  (code && EXPENSE_CATEGORIES.find((c) => c.value === code)?.label) ||
  (code ? code.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "-");

// Older expenses stored "<category_code> expense" as the description; show what
// the user typed (purpose) instead.
const txnDescription = (t: PettyCashTransaction) => {
  const d = (t.description || "").trim();
  const isCodeText = !d || /^[a-z0-9_]+ expense$/.test(d);
  return (isCodeText ? t.purpose || d : d) || "-";
};

const STATUS_OPTIONS = [
  { value: "active", label: "Active", color: "success" as const },
  { value: "closed", label: "Closed", color: "default" as const },
];

const BREADCRUMBS = [
  { label: "Finance", href: "/finance" },
  { label: "Petty Cash", href: "/finance/petty-cash" },
];

export default function PettyCashPage() {
  const queryClient = useQueryClient();
  // Petty cash endpoints are gated by the cashbook permission on the backend
  // (see backend/app/modules/finance/api.py) — there is no separate
  // petty_cash permission, so the UI must check the same resource.
  const canCreate = usePermission("cashbook", "create");
  const { filteredBranches } = useReferenceData();

  // UI State
  const [selectedFundId, setSelectedFundId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [branchFilter, setBranchFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Dialog states
  const [showExpenseDialog, setShowExpenseDialog] = useState(false);
  const [showReplenishDialog, setShowReplenishDialog] = useState(false);
  const [showReconcileDialog, setShowReconcileDialog] = useState(false);

  // Form states
  const emptyFund = (): Partial<PettyCashFundCreate> => ({
    branch_code: filteredBranches[0]?.branch_code || "MAIN",
    opening_balance: 0,
    opened_date: todayISO(),
  });
  const [formData, setFormData] = useState<Partial<PettyCashFundCreate>>(emptyFund);

  const [expenseData, setExpenseData] = useState<Partial<PettyCashExpenseCreate>>({
    petty_cash_id: selectedFundId || 0,
    amount: 0,
    expense_type: "office_supplies",
    transaction_date: todayISO(),
  });

  const [replenishData, setReplenishData] = useState<Partial<PettyCashReplenishCreate>>({
    petty_cash_id: selectedFundId || 0,
    amount: 0,
    transaction_date: todayISO(),
  });

  const [closingBalance, setClosingBalance] = useState(0);
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  // Field messages in the expense / replenish dialogs show after the first submit attempt.
  const [dialogTried, setDialogTried] = useState(false);
  const todayStr = todayISO();
  const MAX_AMOUNT = 999999999.99;
  const dateProblem = (d?: string) =>
    !d ? "Enter the transaction date" : d > todayStr ? "The date cannot be in the future" : null;
  const amountProblem = (a?: number) =>
    !a || Number.isNaN(a) || a <= 0
      ? "Enter an amount greater than 0"
      : a > MAX_AMOUNT
        ? "The amount can be at most 999,999,999.99"
        : Math.round(a * 100) !== Math.round(a * 1000) / 10
          ? "Use at most 2 decimals"
          : null;
  const expenseErrors = {
    amount: amountProblem(expenseData.amount),
    recipient: expenseData.recipient_name?.trim() ? null : "Enter who received the money",
    purpose: expenseData.purpose?.trim() ? null : "Enter what the money was for",
    date: dateProblem(expenseData.transaction_date),
  };
  const replenishErrors = {
    amount: amountProblem(replenishData.amount),
    date: dateProblem(replenishData.transaction_date),
  };

  // List funds query
  const {
    data: fundsData,
    isLoading: isLoadingFunds,
    refetch,
  } = useQuery({
    queryKey: ["petty-cash-funds"],
    queryFn: () =>
      pettyCashApi.listFunds({
        skip: 0,
        limit: 100,
      }),
  });

  // Get selected fund details
  const {
    data: selectedFund,
    isLoading: isLoadingDetail,
  } = useQuery({
    queryKey: ["petty-cash-fund", selectedFundId],
    queryFn: () => (selectedFundId ? pettyCashApi.getFundDetails(selectedFundId) : null),
    enabled: !!selectedFundId,
  });

  // Filter funds
  const filteredFunds = useMemo(() => {
    if (!fundsData?.items) return [];
    const q = searchTerm.toLowerCase();
    return (fundsData.items as PettyCashFund[]).filter(
      (fund) =>
        (!branchFilter || fund.branch_code === branchFilter) &&
        (!statusFilter || fund.status === statusFilter) &&
        (fund.petty_cash_no.toLowerCase().includes(q) || fund.branch_code.toLowerCase().includes(q)),
    );
  }, [fundsData?.items, searchTerm, branchFilter, statusFilter]);

  // Header falls back to the list row while the detail query loads.
  const fund: PettyCashFund | undefined =
    selectedFund ?? (fundsData?.items as PettyCashFund[] | undefined)?.find((f) => f.id === selectedFundId);

  // Blocks a second click on any of the money dialogs before the first request settles.
  const submitInFlightRef = useRef(false);

  // Handlers
  const handleCreateFund = async () => {
    if (!formData.opening_balance || formData.opening_balance <= 0) {
      showErrorToast("Opening balance must be greater than 0");
      return;
    }

    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setIsSubmitting(true);
    try {
      const result = await pettyCashApi.createFund(formData);
      queryClient.invalidateQueries({ queryKey: ["petty-cash-funds"] });
      showSuccessToast(`Fund ${result.petty_cash_no} created successfully`);
      setSelectedFundId(result.id);
      setFormData(emptyFund());
      setCreating(false);
    } catch (error: any) {
      showErrorToast(handleApiError(error, "Failed to create fund"));
    } finally {
      setIsSubmitting(false);
      submitInFlightRef.current = false;
    }
  };

  const handleRecordExpense = async () => {
    const firstError = Object.values(expenseErrors).find(Boolean);
    if (firstError) {
      setDialogTried(true);
      showErrorToast(firstError);
      return;
    }

    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setIsSubmitting(true);
    try {
      await pettyCashApi.recordExpense(expenseData);
      queryClient.invalidateQueries({ queryKey: ["petty-cash-funds"] });
      queryClient.invalidateQueries({ queryKey: ["petty-cash-fund", selectedFundId] });
      showSuccessToast("Expense recorded successfully");
      setExpenseData({
        petty_cash_id: selectedFundId || 0,
        amount: 0,
        expense_type: "office_supplies",
        transaction_date: todayISO(),
      });
      setShowExpenseDialog(false);
    } catch (error: any) {
      showErrorToast(handleApiError(error, "Failed to record expense"));
    } finally {
      setIsSubmitting(false);
      submitInFlightRef.current = false;
    }
  };

  const handleReplenish = async () => {
    const firstError = Object.values(replenishErrors).find(Boolean);
    if (firstError) {
      setDialogTried(true);
      showErrorToast(firstError);
      return;
    }

    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setIsSubmitting(true);
    try {
      await pettyCashApi.replenishFund(replenishData);
      queryClient.invalidateQueries({ queryKey: ["petty-cash-funds"] });
      queryClient.invalidateQueries({ queryKey: ["petty-cash-fund", selectedFundId] });
      showSuccessToast("Fund replenished successfully");
      setReplenishData({
        petty_cash_id: selectedFundId || 0,
        amount: 0,
        transaction_date: todayISO(),
      });
      setShowReplenishDialog(false);
    } catch (error: any) {
      showErrorToast(handleApiError(error, "Failed to replenish fund"));
    } finally {
      setIsSubmitting(false);
      submitInFlightRef.current = false;
    }
  };

  const handleReconcile = async () => {
    if (Number.isNaN(closingBalance) || closingBalance < 0) {
      showErrorToast("Valid closing balance is required");
      return;
    }
    if (!selectedFundId) return;

    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setIsSubmitting(true);
    try {
      await pettyCashApi.reconcileFund(selectedFundId, {
        physical_cash_count: closingBalance,
      });
      queryClient.invalidateQueries({ queryKey: ["petty-cash-funds"] });
      queryClient.invalidateQueries({ queryKey: ["petty-cash-fund", selectedFundId] });
      showSuccessToast("Fund reconciled and closed successfully");
      setSelectedFundId(null);
      setClosingBalance(0);
      setShowReconcileDialog(false);
    } catch (error: any) {
      showErrorToast(handleApiError(error, "Failed to reconcile fund"));
    } finally {
      setIsSubmitting(false);
      submitInFlightRef.current = false;
    }
  };

  const back = () => {
    setSelectedFundId(null);
    setCreating(false);
    setFormData(emptyFund());
  };

  const detailMode = creating || !!selectedFundId;

  // Open fund lives in the URL (?id= / ?new=1): browser Back returns to the list.
  useRecordParam<PettyCashFund>({
    current: selectedFundId,
    creating,
    items: fundsData?.items as PettyCashFund[] | undefined,
    loading: isLoadingFunds,
    fetchById: (id) => pettyCashApi.getFundDetails(Number(id)) as Promise<PettyCashFund>,
    onOpen: (f) => {
      setCreating(false);
      setSelectedFundId(f.id);
    },
    onClose: back,
    onNew: canCreate ? () => { setFormData(emptyFund()); setCreating(true); } : undefined,
  });
  const createValid = !!formData.branch_code && !!formData.opening_balance && formData.opening_balance > 0;

  const columns: TDataGridColumn<PettyCashFund>[] = [
    { field: "petty_cash_no", header: "Fund No", minWidth: 150, flex: 1 },
    { field: "branch_code", header: "Branch", width: 120 },
    { field: "opened_date", header: "Opened", width: 120, type: "date" },
    { field: "opening_balance", header: "Opening Balance", width: 150, type: "currency", align: "right", headerAlign: "right" },
    { field: "current_balance", header: "Current Balance", width: 150, type: "currency", align: "right", headerAlign: "right" },
    { field: "closed_date", header: "Closed", width: 120, type: "date" },
    { field: "status", header: "Status", width: 120, type: "status", statusMap: "financeDocument" },
  ];

  // Money out shows as "−350.00" on one line (Rs. is in the header), so the
  // Balance column still fits next to it at 1440 px.
  const txnColumns: TDataGridColumn<PettyCashTransaction>[] = [
    { field: "transaction_date", header: "Date", width: 110, type: "date" },
    { field: "transaction_no", header: "Transaction No", minWidth: 140, flex: 1 },
    {
      field: "transaction_type",
      header: "Type",
      width: 125,
      renderCell: (p) => (
        <Typography
          variant="body2"
          sx={{ color: p.row.transaction_type === "expense" ? "error.main" : "success.main" }}
        >
          {p.row.transaction_type === "expense" ? "Expense" : "Replenishment"}
        </Typography>
      ),
    },
    {
      field: "description",
      header: "Description",
      minWidth: 160,
      flex: 1.5,
      renderCell: (p) => txnDescription(p.row),
    },
    {
      field: "expense_type",
      header: "Category",
      minWidth: 120,
      flex: 0.8,
      renderCell: (p) => (p.row.transaction_type === "expense" ? categoryLabel(p.row.expense_type) : "-"),
    },
    { field: "recipient_name", header: "Recipient", minWidth: 120, flex: 0.8 },
    {
      field: "amount",
      header: "Amount (Rs.)",
      width: 125,
      align: "right",
      headerAlign: "right",
      renderCell: (p) => (
        <Box
          component="span"
          sx={{ whiteSpace: "nowrap", color: p.row.transaction_type === "expense" ? "error.main" : "success.main" }}
        >
          {p.row.transaction_type === "expense" ? "−" : "+"}
          {fmt(p.row.amount)}
        </Box>
      ),
    },
    {
      field: "balance_after",
      header: "Balance (Rs.)",
      width: 125,
      align: "right",
      headerAlign: "right",
      renderCell: (p) => <Box component="span" sx={{ whiteSpace: "nowrap" }}>{fmt(p.row.balance_after)}</Box>,
    },
  ];

  const createForm = (
    <>
      <FormSection title="Fund" columns={3}>
        <TextField
          label="Branch"
          select
          size="small"
          required
          value={formData.branch_code || ""}
          onChange={(e) => setFormData({ ...formData, branch_code: e.target.value })}
        >
          {filteredBranches.map((branch) => (
            <MenuItem key={branch.branch_code} value={branch.branch_code}>
              {branch.branch_name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Opening Balance"
          type="number"
          size="small"
          required
          value={formData.opening_balance || ""}
          onChange={(e) => setFormData({ ...formData, opening_balance: e.target.value === "" ? 0 : parseFloat(e.target.value) })}
          inputProps={{ step: "0.01", min: "0", max: MAX_AMOUNT }}
        />
        <TDatePicker
          label="Opened Date"
          size="small"
          value={formData.opened_date || ""}
          onChange={(v) => setFormData({ ...formData, opened_date: v ?? "" })}
        />
      </FormSection>
      <FormSection title="Remarks" columns={1}>
        <TRemarkField
          fullWidth
          label="Remarks"
          size="small"
          multiline
          rows={3}
          value={formData.remarks || ""}
          onChange={(value) => setFormData({ ...formData, remarks: value })}
        />
      </FormSection>
    </>
  );

  const viewDetail = fund && (
    <>
      {isLoadingDetail && <LinearProgress sx={{ mb: 1 }} />}
      <FormSection title="Fund Information" columns={3}>
        <TextField label="Fund No" size="small" value={fund.petty_cash_no} disabled />
        <TextField label="Branch" size="small" value={fund.branch_code ?? ""} disabled />
        <TextField label="Opened Date" size="small" value={displayDate(fund.opened_date)} disabled />
        <TextField label="Opening Balance" size="small" value={fmt(fund.opening_balance)} disabled />
        <TextField label="Current Balance" size="small" value={fmt(fund.current_balance)} disabled />
        {fund.status === "closed" && (
          <TextField
            label="Closing Balance (counted)"
            size="small"
            value={fund.closing_balance !== null && fund.closing_balance !== undefined ? fmt(fund.closing_balance) : ""}
            disabled
          />
        )}
        {fund.status === "closed" && (
          <TextField label="Closed Date" size="small" value={displayDate(fund.closed_date)} disabled />
        )}
      </FormSection>
      {fund.remarks && (
        <FormSection title="Remarks" columns={1}>
          <TRemarkField label="Remarks" size="small" value={fund.remarks} onChange={() => undefined} disabled multiline rows={2} />
        </FormSection>
      )}
      <FormSection title="Transactions" columns={1}>
        <TDataGrid<PettyCashTransaction>
          rows={(selectedFund?.transactions as PettyCashTransaction[] | undefined) ?? []}
          columns={txnColumns}
          loading={isLoadingDetail}
          pageSize={10}
          pageSizeOptions={[10, 25, 50]}
          emptyMessage="No transactions yet"
          autoHeight
        />
      </FormSection>
    </>
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[...BREADCRUMBS, { label: creating ? "New Fund" : fund?.petty_cash_no ?? "" }]}
        title={fund?.petty_cash_no ?? ""}
        titleIcon={<AccountBalanceWalletIcon color="primary" />}
        isCreating={creating}
        createTitle="Open Petty Cash Fund"
        noSelectionTitle="Select a fund"
        chips={fund && !creating ? [getStatusProps(fund.status, "financeDocument")] : []}
      />
      <ActionToolbar
        hasSelectedItem={!!fund}
        isCreating={creating}
        isEditing={false}
        isSaving={isSubmitting}
        isFormValid={createValid}
        onSave={creating ? handleCreateFund : undefined}
        onCancel={creating ? back : undefined}
        endActions={
          !creating && fund && fund.status === "active" ? (
            <>
              <Button
                size="small"
                variant="contained"
                onClick={() => {
                  setExpenseData({ ...expenseData, petty_cash_id: selectedFundId || 0, transaction_date: todayISO() });
                  setDialogTried(false);
                  setShowExpenseDialog(true);
                }}
              >
                Record Expense
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="success"
                onClick={() => {
                  setReplenishData({ ...replenishData, petty_cash_id: selectedFundId || 0, transaction_date: todayISO() });
                  setDialogTried(false);
                  setShowReplenishDialog(true);
                }}
              >
                Replenish
              </Button>
              {/* Closing the fund is rare and final: kept behind a menu, away from the daily buttons. */}
              <Tooltip title="More actions">
                <IconButton
                  size="small"
                  aria-label="More actions"
                  onClick={(e) => setMoreAnchor(e.currentTarget)}
                  sx={{ ml: 2 }}
                >
                  <MoreVertIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Menu anchorEl={moreAnchor} open={!!moreAnchor} onClose={() => setMoreAnchor(null)}>
                <MenuItem
                  onClick={() => {
                    setMoreAnchor(null);
                    setClosingBalance(fund.current_balance);
                    setShowReconcileDialog(true);
                  }}
                  sx={{ color: "error.main" }}
                >
                  Count cash &amp; close fund…
                </MenuItem>
              </Menu>
            </>
          ) : undefined
        }
      />
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>{creating ? createForm : viewDetail}</Box>
    </Box>
  );

  const listPanel = (
    <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
      <TDataGrid<PettyCashFund>
        rows={filteredFunds}
        columns={columns}
        loading={isLoadingFunds}
        onRowClick={(row) => setSelectedFundId(row.id)}
        pageSizeOptions={[10, 25, 50, 100]}
        pageSize={25}
        emptyMessage="No funds found"
        autoHeight={false}
        height="100%"
      />
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title="Petty Cash"
        titleSlot={
          detailMode ? (
            <Button size="small" startIcon={<ArrowBackIcon fontSize="small" />} onClick={back} sx={{ textTransform: "none" }}>
              Back to Petty Cash
            </Button>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <Box sx={{ flexShrink: 0 }}>
                <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.2 }}>
                  Petty Cash
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Small cash kept at a branch for daily expenses
                </Typography>
              </Box>
              <TextField
                size="small"
                placeholder="Search funds..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                }}
                sx={{ width: 190, flexShrink: 0 }}
              />
              <Box sx={{ width: 150, flexShrink: 0 }}>
                <TBranchFilter branches={filteredBranches} value={branchFilter} onChange={setBranchFilter} label="" size="small" />
              </Box>
              <Box sx={{ width: 150, flexShrink: 0 }}>
                <TSearchableSelect
                  label=""
                  value={statusFilter}
                  onChange={(v) => setStatusFilter(v as string | null)}
                  options={STATUS_OPTIONS}
                  showAllOption
                  allOptionLabel="All Statuses"
                  placeholder="Search status..."
                  size="small"
                />
              </Box>
              {(searchTerm || branchFilter || statusFilter) && (
                <Button
                  size="small"
                  onClick={() => {
                    setSearchTerm("");
                    setBranchFilter(null);
                    setStatusFilter(null);
                  }}
                  sx={{ textTransform: "none" }}
                >
                  Clear
                </Button>
              )}
            </Box>
          )
        }
        headerActions={
          !detailMode && canCreate ? (
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => {
                setFormData(emptyFund());
                setCreating(true);
              }}
              sx={{ mr: 1 }}
            >
              Open Fund
            </Button>
          ) : undefined
        }
        onRefresh={() => refetch()}
        isLoading={isLoadingFunds}
      >
        {detailMode ? detailPanel : listPanel}
      </MasterDetailLayout>

      {/* Record Expense Dialog */}
      <Dialog
        open={showExpenseDialog}
        onClose={() => setShowExpenseDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Record Expense</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Alert
            severity={(expenseData.amount || 0) > Number(fund?.current_balance || 0) ? "error" : "info"}
            variant="outlined"
            sx={{ mt: 1 }}
          >
            Available {formatCurrency(Number(fund?.current_balance || 0))}
            {(expenseData.amount || 0) > 0 &&
              ` · left after this: ${formatCurrency(Number(fund?.current_balance || 0) - (expenseData.amount || 0))}`}
          </Alert>
          <TextField
            fullWidth
            label="Amount"
            type="number"
            required
            value={expenseData.amount || ""}
            onChange={(e) =>
              setExpenseData({
                ...expenseData,
                amount: e.target.value === "" ? 0 : parseFloat(e.target.value),
              })
            }
            margin="normal"
            inputProps={{ step: "0.01", min: "0.01", max: MAX_AMOUNT }}
            error={dialogTried && !!expenseErrors.amount}
            helperText={dialogTried ? expenseErrors.amount : undefined}
          />

          <TextField
            select
            fullWidth
            label="Category"
            value={expenseData.expense_type || "office_supplies"}
            onChange={(e) => setExpenseData({ ...expenseData, expense_type: e.target.value })}
            margin="normal"
          >
            {EXPENSE_CATEGORIES.map((cat) => (
              <MenuItem key={cat.value} value={cat.value}>
                {cat.label}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            fullWidth
            label="Recipient Name"
            required
            inputProps={{ maxLength: 200 }}
            error={dialogTried && !!expenseErrors.recipient}
            helperText={dialogTried ? expenseErrors.recipient : undefined}
            value={expenseData.recipient_name || ""}
            onChange={(e) =>
              setExpenseData({
                ...expenseData,
                recipient_name: e.target.value,
              })
            }
            margin="normal"
          />

          <TextField
            fullWidth
            label="Purpose"
            required
            inputProps={{ maxLength: 500 }}
            error={dialogTried && !!expenseErrors.purpose}
            helperText={dialogTried ? expenseErrors.purpose : undefined}
            value={expenseData.purpose || ""}
            onChange={(e) =>
              setExpenseData({
                ...expenseData,
                purpose: e.target.value,
              })
            }
            margin="normal"
          />

          <TextField
            fullWidth
            label="Receipt Number"
            value={expenseData.receipt_number || ""}
            onChange={(e) =>
              setExpenseData({
                ...expenseData,
                receipt_number: e.target.value,
              })
            }
            margin="normal"
          />

          <TDatePicker
            fullWidth
            label="Transaction Date"
            required
            value={expenseData.transaction_date || ""}
            onChange={(v) =>
              setExpenseData({
                ...expenseData,
                transaction_date: v ?? "",
              })
            }
            margin="normal"
            inputProps={{ max: todayStr }}
            error={dialogTried && !!expenseErrors.date}
            helperText={dialogTried ? expenseErrors.date : undefined}
          />

          <TextField
            fullWidth
            label="Description"
            multiline
            rows={2}
            value={expenseData.description || ""}
            onChange={(e) =>
              setExpenseData({
                ...expenseData,
                description: e.target.value,
              })
            }
            margin="normal"
          />
        </DialogContent>
        <DialogActions>
          <Button variant="contained" color="error" startIcon={<CancelIcon />} onClick={() => setShowExpenseDialog(false)}>Cancel</Button>
          <Button
            onClick={handleRecordExpense}
            variant="contained"
            disabled={isSubmitting}
          >
            Record
          </Button>
        </DialogActions>
      </Dialog>

      {/* Replenish Fund Dialog */}
      <Dialog
        open={showReplenishDialog}
        onClose={() => setShowReplenishDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Replenish Petty Cash Fund</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Alert severity="info" variant="outlined" sx={{ mt: 1 }}>
            Available {formatCurrency(Number(fund?.current_balance || 0))}
            {(replenishData.amount || 0) > 0 &&
              ` · after topping up: ${formatCurrency(Number(fund?.current_balance || 0) + (replenishData.amount || 0))}`}
          </Alert>
          <TextField
            fullWidth
            label="Replenishment Amount"
            type="number"
            required
            value={replenishData.amount || ""}
            onChange={(e) =>
              setReplenishData({
                ...replenishData,
                amount: e.target.value === "" ? 0 : parseFloat(e.target.value),
              })
            }
            margin="normal"
            inputProps={{ step: "0.01", min: "0.01", max: MAX_AMOUNT }}
            error={dialogTried && !!replenishErrors.amount}
            helperText={dialogTried ? replenishErrors.amount : undefined}
          />

          <TDatePicker
            fullWidth
            label="Transaction Date"
            required
            value={replenishData.transaction_date || ""}
            onChange={(v) =>
              setReplenishData({
                ...replenishData,
                transaction_date: v ?? "",
              })
            }
            margin="normal"
            inputProps={{ max: todayStr }}
            error={dialogTried && !!replenishErrors.date}
            helperText={dialogTried ? replenishErrors.date : undefined}
          />

          <TextField
            fullWidth
            label="Description"
            multiline
            rows={2}
            value={replenishData.description || ""}
            onChange={(e) =>
              setReplenishData({
                ...replenishData,
                description: e.target.value,
              })
            }
            margin="normal"
          />
        </DialogContent>
        <DialogActions>
          <Button variant="contained" color="error" startIcon={<CancelIcon />} onClick={() => setShowReplenishDialog(false)}>Cancel</Button>
          <Button
            onClick={handleReplenish}
            variant="contained"
            disabled={isSubmitting}
          >
            Replenish
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reconcile Dialog */}
      <Dialog
        open={showReconcileDialog}
        onClose={() => setShowReconcileDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Reconcile and Close Fund</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Current Balance:{" "}
            <TCurrency value={fund?.current_balance} />
          </Typography>

          <TextField
            fullWidth
            label="Closing Balance"
            type="number"
            value={Number.isNaN(closingBalance) ? "" : closingBalance}
            onChange={(e) => setClosingBalance(e.target.value === "" ? NaN : parseFloat(e.target.value))}
            margin="normal"
            inputProps={{ step: "0.01", min: "0" }}
          />

          {closingBalance !== fund?.current_balance && (
            <Typography
              variant="body2"
              sx={{
                mt: 1,
                color:
                  closingBalance > (fund?.current_balance || 0)
                    ? "success.main"
                    : "error.main",
              }}
            >
              Variance:{" "}
              {closingBalance > (fund?.current_balance || 0) ? "+" : ""}
              <TCurrency value={closingBalance - (fund?.current_balance || 0)} />
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="contained" color="error" startIcon={<CancelIcon />} onClick={() => setShowReconcileDialog(false)}>Cancel</Button>
          <Button
            onClick={handleReconcile}
            variant="contained"
            color="error"
            disabled={isSubmitting}
          >
            Close Fund
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
