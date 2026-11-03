/**
 * LoansPage — company loans and salary advances. Each one is recovered in monthly instalments by the
 * payroll run (never more than the pay left); a leaver's balance is recovered in the last month.
 * Standard master-detail layout: browse grid -> full-page detail (create / view / change plan).
 */
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box, Button, Chip, IconButton, InputAdornment, MenuItem, Table, TableBody, TableCell, TableHead, TableRow, TextField,
  Tooltip, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import PaymentIcon from "@mui/icons-material/Payment";
import CancelIcon from "@mui/icons-material/Cancel";
import type { GridRenderCellParams } from "@mui/x-data-grid";

import {
  ActionToolbar, DetailPanelHeader, FormSection, MasterDetailLayout, TConfirmDialog, TDataGrid, type TDataGridColumn,
  TSidePanel, TStatusFilter, fmtLKR, handleApiError, modernTableStyles, showErrorToast, showSuccessToast, useConfirmDialog,
} from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";
import { employeesApi, loansApi } from "@/modules/hr/api";
import type { EmployeeLoan, LoanCreate, LoanType } from "@/modules/hr/types";
import { formatDate } from "@/utils/formatters";

// Local calendar date (toISOString would give yesterday's date shortly after midnight in Sri Lanka)
const today = () => formatDate(new Date());
const thisPeriod = () => today().slice(0, 7);
const PAYMENT_METHODS = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
];
const STATUS_COLOR: Record<string, "success" | "default" | "warning"> = { active: "warning", settled: "success", cancelled: "default" };
const STATUS_OPTIONS = [
  { value: null, label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "settled", label: "Settled" },
  { value: "cancelled", label: "Cancelled" },
];
const typeLabel = (t: string) => (t === "advance" ? "Salary advance" : "Loan");

const newLoan = (): LoanCreate => ({
  employee_pk: 0, loan_type: "advance", issue_date: today(), amount: 0, installments: 1, installment_amount: null,
  start_period: thisPeriod(), payment_method: "cash", remarks: "",
});

type RepayForm = { amount: number; payment_method: string; payment_date: string; remarks: string };
type PlanForm = { installment_amount: number; start_period: string; remarks: string };

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <Box>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography variant="body2" component="div">{children}</Typography>
  </Box>
);

export default function LoansPage() {
  const qc = useQueryClient();
  const confirmDialog = useConfirmDialog();
  const canCreate = usePermission("deductions", "create");
  const canUpdate = usePermission("deductions", "update");
  const canDelete = usePermission("deductions", "delete");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>("active");
  const [form, setForm] = useState<LoanCreate | null>(null); // non-null = create mode
  const [openId, setOpenId] = useState<number | null>(null);
  const [repay, setRepay] = useState<RepayForm | null>(null);
  const [plan, setPlan] = useState<PlanForm | null>(null); // non-null = editing the recovery plan

  // In-flight guards: a double click must never submit twice (QA found duplicate loans on double-clicking Issue)
  const createRef = useRef(false);
  const repayRef = useRef(false);
  const planRef = useRef(false);
  const cancelRef = useRef(false);

  const { data: loans = [], isLoading, refetch } = useQuery({
    queryKey: ["hr-loans", statusFilter ?? ""],
    queryFn: () => loansApi.getAll(statusFilter ? { status: statusFilter } : undefined),
  });
  const { data: employees = [] } = useQuery({ queryKey: ["hr-employees-light"], queryFn: () => employeesApi.getAll({ limit: 500 }) });
  const { data: loan, isLoading: loanLoading } = useQuery({
    queryKey: ["hr-loan", openId], queryFn: () => loansApi.getById(openId as number), enabled: !!openId,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["hr-loans"] });
    qc.invalidateQueries({ queryKey: ["hr-loan"] });
  };
  const createMut = useMutation({
    mutationFn: (d: LoanCreate) => loansApi.create(d),
    onSuccess: (l) => { refresh(); showSuccessToast(`${l.loan_no} issued`); setForm(null); setOpenId(l.id); },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to issue loan")),
  });
  const repayMut = useMutation({
    mutationFn: ({ id, d }: { id: number; d: RepayForm }) => loansApi.repay(id, d),
    onSuccess: () => { refresh(); showSuccessToast("Repayment recorded"); setRepay(null); },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to record repayment")),
  });
  const planMut = useMutation({
    mutationFn: ({ id, d }: { id: number; d: PlanForm }) => loansApi.update(id, d),
    onSuccess: () => { refresh(); showSuccessToast("Recovery plan updated"); setPlan(null); },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to update plan")),
  });
  const cancelMut = useMutation({
    mutationFn: (id: number) => loansApi.cancel(id),
    onSuccess: () => { refresh(); showSuccessToast("Loan cancelled"); },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to cancel loan")),
  });
  const anyPending = createMut.isPending || repayMut.isPending || planMut.isPending || cancelMut.isPending;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return loans.filter((l) => !q || [l.loan_no, l.employee_id, l.employee_name].some((x) => (x || "").toLowerCase().includes(q)));
  }, [loans, search]);
  const outstanding = filtered.reduce((s, l) => s + Number(l.balance || 0), 0);

  const openLoan = useCallback((id: number) => { setForm(null); setPlan(null); setRepay(null); setOpenId(id); }, []);

  const columns: TDataGridColumn<EmployeeLoan>[] = useMemo(() => [
    { field: "loan_no", header: "No.", width: 130 },
    { field: "employee_name", header: "Employee", flex: 1, minWidth: 180,
      renderCell: (p: GridRenderCellParams<EmployeeLoan>) => `${p.row.employee_name || ""} (${p.row.employee_id})` },
    { field: "loan_type", header: "Type", width: 120, renderCell: (p: GridRenderCellParams<EmployeeLoan>) => typeLabel(p.row.loan_type) },
    { field: "issue_date", header: "Issued", width: 120, renderCell: (p: GridRenderCellParams<EmployeeLoan>) => formatDate(p.row.issue_date) },
    { field: "amount", header: "Amount", width: 130, align: "right", headerAlign: "right", renderCell: (p: GridRenderCellParams<EmployeeLoan>) => fmtLKR(p.row.amount) },
    { field: "installment_amount", header: "Monthly", width: 120, align: "right", headerAlign: "right", renderCell: (p: GridRenderCellParams<EmployeeLoan>) => fmtLKR(p.row.installment_amount) },
    { field: "balance", header: "Balance", width: 130, align: "right", headerAlign: "right", renderCell: (p: GridRenderCellParams<EmployeeLoan>) => <strong>{fmtLKR(p.row.balance)}</strong> },
    { field: "status", header: "Status", width: 110, renderCell: (p: GridRenderCellParams<EmployeeLoan>) => (
      <Chip size="small" label={p.row.status} color={STATUS_COLOR[p.row.status]} sx={{ textTransform: "capitalize" }} />
    ) },
    { field: "view", header: "", width: 56, sortable: false, align: "center", headerAlign: "center",
      renderCell: (p: GridRenderCellParams<EmployeeLoan>) => (
        <Tooltip title="Open"><IconButton size="small" onClick={(e) => { e.stopPropagation(); openLoan(p.row.id); }}><OpenInNewIcon fontSize="small" color="action" /></IconButton></Tooltip>
      ) },
  ], [openLoan]);

  const liveEmployees = employees.filter((e) => ["active", "probation", "notice_period"].includes((e as { status?: string }).status ?? "active"));
  const formValid = !!form && form.employee_pk > 0 && form.amount > 0 && form.installments >= 1 && !!form.start_period && !!form.issue_date;
  const monthly = form ? (form.installment_amount || (form.amount && form.installments ? Math.ceil((form.amount / form.installments) * 100) / 100 : 0)) : 0;

  const isCreating = !!form;
  const isDetailMode = isCreating || !!openId;

  // ---- handlers (each guarded by isPending + a ref spanning the whole handler) ----
  const handleIssue = () => {
    if (!form || !formValid || createMut.isPending || createRef.current) return;
    createRef.current = true;
    createMut.mutate(form, { onSettled: () => { createRef.current = false; } });
  };
  const handleSavePlan = () => {
    if (!plan || !openId || !plan.installment_amount || planMut.isPending || planRef.current) return;
    planRef.current = true;
    planMut.mutate({ id: openId, d: plan }, { onSettled: () => { planRef.current = false; } });
  };
  const handleRepay = () => {
    if (!repay || !openId || !repay.amount || repayMut.isPending || repayRef.current) return;
    repayRef.current = true;
    repayMut.mutate({ id: openId, d: repay }, { onSettled: () => { repayRef.current = false; } });
  };
  const handleCancelLoan = async () => {
    if (!loan || cancelMut.isPending || cancelRef.current) return;
    cancelRef.current = true;
    try {
      const ok = await confirmDialog.confirm({
        title: "Cancel loan",
        message: `Cancel ${loan.loan_no} for ${loan.employee_name || loan.employee_id}? This reverses the issue posting.`,
        confirmText: "Cancel loan", cancelText: "Keep", confirmColor: "error", danger: true,
      });
      if (!ok) { cancelRef.current = false; return; }
      cancelMut.mutate(loan.id, { onSettled: () => { cancelRef.current = false; } });
    } catch {
      cancelRef.current = false;
    }
  };
  const handleBack = () => {
    if (anyPending) return;
    setForm(null); setPlan(null); setRepay(null); setOpenId(null);
  };

  // ---- render: create body ----
  const renderCreateBody = (f: LoanCreate) => (
    <>
      <FormSection title="Loan / Advance">
        <TextField select label="Employee" size="small" required fullWidth value={f.employee_pk || ""} sx={{ gridColumn: "1 / -1" }}
          onChange={(e) => setForm({ ...f, employee_pk: Number(e.target.value) })}>
          {liveEmployees.map((e) => <MenuItem key={e.id} value={e.id}>{e.full_name ? `${e.full_name} (${e.employee_id})` : e.employee_id}</MenuItem>)}
        </TextField>
        <TextField select label="Type" size="small" fullWidth value={f.loan_type} onChange={(e) => setForm({ ...f, loan_type: e.target.value as LoanType })}>
          <MenuItem value="advance">Salary advance</MenuItem>
          <MenuItem value="loan">Company loan</MenuItem>
        </TextField>
        <TextField label="Issue date" type="date" size="small" fullWidth value={f.issue_date} InputLabelProps={{ shrink: true }}
          onChange={(e) => setForm({ ...f, issue_date: e.target.value })} />
        <TextField label="Amount" type="number" size="small" required fullWidth value={f.amount || ""} inputProps={{ min: 0, step: "0.01" }}
          onChange={(e) => setForm({ ...f, amount: parseFloat(e.target.value) || 0 })} />
        <TextField select label="Paid out by" size="small" fullWidth value={f.payment_method} onChange={(e) => setForm({ ...f, payment_method: e.target.value })}>
          {PAYMENT_METHODS.map((m) => <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>)}
        </TextField>
        <TextField label="Remarks" size="small" fullWidth value={f.remarks || ""} sx={{ gridColumn: "1 / -1" }}
          onChange={(e) => setForm({ ...f, remarks: e.target.value })} />
      </FormSection>
      <FormSection title="Recovery" isLast>
        <TextField label="Instalments (months)" type="number" size="small" fullWidth value={f.installments} inputProps={{ min: 1, max: 120 }}
          onChange={(e) => setForm({ ...f, installments: parseInt(e.target.value) || 1, installment_amount: null })} />
        <TextField label="First recovery month" type="month" size="small" fullWidth value={f.start_period} InputLabelProps={{ shrink: true }}
          onChange={(e) => setForm({ ...f, start_period: e.target.value })} />
        <Typography variant="body2" color="text.secondary" sx={{ gridColumn: "1 / -1" }}>
          Monthly recovery: <strong>{fmtLKR(monthly)}</strong> from payroll, starting {f.start_period}. Issuing posts Employee Advances against {f.payment_method === "cash" ? "Cash" : "Bank"}.
        </Typography>
      </FormSection>
    </>
  );

  // ---- render: view body ----
  const renderViewBody = (l: EmployeeLoan) => (
    <>
      <FormSection title="Loan Details" columns={4}>
        <Field label="Employee">{`${l.employee_name || ""} (${l.employee_id})`}</Field>
        <Field label="Type">{typeLabel(l.loan_type)}</Field>
        <Field label="Issued">{formatDate(l.issue_date)}</Field>
        <Field label="Status"><Box component="span" sx={{ textTransform: "capitalize" }}>{l.status}</Box></Field>
        <Field label="Amount">{fmtLKR(l.amount)}</Field>
        <Field label="Recovered">{fmtLKR(l.recovered)}</Field>
        <Field label="Balance"><strong>{fmtLKR(l.balance)}</strong></Field>
        <Field label="Remarks">{l.remarks || "-"}</Field>
      </FormSection>
      <FormSection title="Recovery Plan" columns={plan ? 3 : 4}>
        {plan ? (
          <>
            <TextField label="Monthly instalment" type="number" size="small" fullWidth required value={plan.installment_amount || ""}
              error={!plan.installment_amount} inputProps={{ min: 0, step: "0.01" }}
              onChange={(e) => setPlan({ ...plan, installment_amount: parseFloat(e.target.value) || 0 })} />
            <TextField label="From month" type="month" size="small" fullWidth value={plan.start_period} InputLabelProps={{ shrink: true }}
              onChange={(e) => setPlan({ ...plan, start_period: e.target.value })} />
            <TextField label="Remarks" size="small" fullWidth value={plan.remarks} onChange={(e) => setPlan({ ...plan, remarks: e.target.value })} />
          </>
        ) : (
          <>
            <Field label="Monthly instalment">{fmtLKR(l.installment_amount)}</Field>
            <Field label="From month">{l.start_period}</Field>
          </>
        )}
      </FormSection>
      <FormSection title="Recoveries" columns={1} isLast>
        {(l.recoveries || []).length === 0 ? (
          <Typography variant="body2" color="text.secondary">Nothing recovered yet</Typography>
        ) : (
          <Table size="small" sx={modernTableStyles}>
            <TableHead><TableRow><TableCell>Month</TableCell><TableCell>From</TableCell><TableCell align="right">Amount</TableCell><TableCell>Remarks</TableCell></TableRow></TableHead>
            <TableBody>
              {(l.recoveries || []).map((r) => (
                <TableRow key={r.id} sx={{ opacity: r.cancelled ? 0.5 : 1 }}>
                  <TableCell>{r.period}</TableCell>
                  <TableCell>{r.source === "payroll" ? `Payroll ${r.payroll_batch_no || ""}${r.cancelled ? " (cancelled)" : ""}` : `Repaid ${r.payment_date ? formatDate(r.payment_date) : ""}`}</TableCell>
                  <TableCell align="right">{fmtLKR(r.amount)}</TableCell>
                  <TableCell>{r.remarks || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </FormSection>
    </>
  );

  // ---- render: detail page ----
  const renderDetail = () => {
    const isActive = loan?.status === "active";
    const canRepay = !isCreating && !plan && isActive && canUpdate;
    const canCancelLoan = !isCreating && !plan && isActive && canDelete && Number(loan?.recovered) === 0;
    return (
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <DetailPanelHeader
          breadcrumbs={[
            { label: "HR" },
            { label: "Loans & Advances", href: "/hr/loans" },
            { label: isCreating ? "New" : loan?.loan_no || "" },
          ]}
          title={!isCreating && loan ? loan.loan_no : loanLoading ? "Loading..." : ""}
          titleIcon={<AccountBalanceWalletIcon color="primary" />}
          isCreating={isCreating}
          createTitle="New Loan / Salary Advance"
          noSelectionTitle="Loan"
          subtitle={!isCreating && loan ? `${loan.employee_name || loan.employee_id} · ${typeLabel(loan.loan_type)}` : undefined}
          chips={!isCreating && loan ? [{ label: loan.status.charAt(0).toUpperCase() + loan.status.slice(1), color: STATUS_COLOR[loan.status] }] : []}
        />
        <ActionToolbar
          hasSelectedItem={!!loan && !isCreating}
          isCreating={isCreating}
          isEditing={!!plan}
          isSaving={isCreating ? createMut.isPending : planMut.isPending}
          isFormValid={isCreating ? formValid && !createMut.isPending : !!plan?.installment_amount && !planMut.isPending}
          canCreate={false}
          canUpdate={canUpdate && isActive && !anyPending}
          canDelete={false}
          canDuplicate={false}
          onEdit={loan && isActive ? () => setPlan({ installment_amount: Number(loan.installment_amount), start_period: loan.start_period, remarks: loan.remarks || "" }) : undefined}
          onSave={isCreating ? handleIssue : handleSavePlan}
          onCancel={isCreating ? handleBack : () => { if (!planMut.isPending) setPlan(null); }}
          endActions={canRepay || canCancelLoan ? (
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              {canRepay && loan && (
                <Button size="small" variant="contained" startIcon={<PaymentIcon />} disabled={anyPending}
                  onClick={() => setRepay({ amount: Number(loan.balance), payment_method: "cash", payment_date: today(), remarks: "" })}>
                  Record repayment
                </Button>
              )}
              {canCancelLoan && (
                <Button size="small" color="error" variant="outlined" startIcon={<CancelIcon />} disabled={anyPending} onClick={handleCancelLoan}>
                  {cancelMut.isPending ? "Cancelling..." : "Cancel loan"}
                </Button>
              )}
            </Box>
          ) : undefined}
        />
        <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
          {form ? renderCreateBody(form) : loan ? renderViewBody(loan) : null}
        </Box>
      </Box>
    );
  };

  return (
    <>
      <MasterDetailLayout
        title="Loans & Advances"
        icon={<AccountBalanceWalletIcon />}
        titleSlot={isDetailMode ? (
          <Button size="small" startIcon={<ArrowBackIcon fontSize="small" />} onClick={handleBack} disabled={anyPending} sx={{ textTransform: "none" }}>
            Back to Loans
          </Button>
        ) : (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flex: 1, minWidth: 0, flexWrap: "wrap" }}>
            <TextField size="small" placeholder="Search loans..." value={search} onChange={(e) => setSearch(e.target.value)}
              sx={{ width: 190, flexShrink: 0, "& .MuiOutlinedInput-root": { borderRadius: "24px" } }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" color="action" /></InputAdornment> }} />
            <Box sx={{ width: 170, flexShrink: 0 }}>
              <TStatusFilter options={STATUS_OPTIONS} value={statusFilter} onChange={setStatusFilter} label="" placeholder="All Statuses" size="small" />
            </Box>
            {(search || statusFilter !== "active") && (
              <Button size="small" onClick={() => { setSearch(""); setStatusFilter("active"); }} sx={{ textTransform: "none" }}>Clear</Button>
            )}
            <Typography variant="body2" color="text.secondary">Outstanding: <strong>{fmtLKR(outstanding)}</strong></Typography>
          </Box>
        )}
        headerActions={!isDetailMode && canCreate ? (
          <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => { setOpenId(null); setPlan(null); setForm(newLoan()); }} sx={{ mr: 1 }}>New loan</Button>
        ) : undefined}
        onRefresh={refetch}
        isLoading={isLoading}
      >
        {isDetailMode ? renderDetail() : (
          <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
            <TDataGrid<EmployeeLoan> rows={filtered} columns={columns} loading={isLoading} onRowClick={(row) => openLoan(row.id)}
              pageSizeOptions={[10, 25, 50, 100]} pageSize={25} emptyMessage="No loans or advances" autoHeight={false} height="100%" />
          </Box>
        )}
      </MasterDetailLayout>

      <TSidePanel
        open={!!repay}
        onClose={() => { if (!repayMut.isPending) setRepay(null); }}
        title="Record Repayment"
        submitText="Save"
        isSubmitting={repayMut.isPending}
        submitDisabled={!repay?.amount || repayMut.isPending}
        onSubmit={handleRepay}
      >
        {repay && (
          <FormSection title="Repayment" columns={1} isLast>
            <Typography variant="body2">Balance: <strong>{fmtLKR(loan?.balance)}</strong></Typography>
            <TextField label="Amount repaid" type="number" size="small" fullWidth required value={repay.amount || ""} inputProps={{ min: 0, step: "0.01" }}
              onChange={(e) => setRepay({ ...repay, amount: parseFloat(e.target.value) || 0 })} />
            <TextField select label="Received by" size="small" fullWidth value={repay.payment_method} onChange={(e) => setRepay({ ...repay, payment_method: e.target.value })}>
              {PAYMENT_METHODS.map((m) => <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>)}
            </TextField>
            <TextField label="Date" type="date" size="small" fullWidth value={repay.payment_date} InputLabelProps={{ shrink: true }}
              onChange={(e) => setRepay({ ...repay, payment_date: e.target.value })} />
            <TextField label="Remarks" size="small" fullWidth value={repay.remarks} onChange={(e) => setRepay({ ...repay, remarks: e.target.value })} />
          </FormSection>
        )}
      </TSidePanel>

      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
