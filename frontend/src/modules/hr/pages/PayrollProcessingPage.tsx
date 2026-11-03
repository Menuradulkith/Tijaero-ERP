import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Typography,
  Button,
  TextField,
  MenuItem,
  InputAdornment,
  IconButton,
  Tooltip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Stepper,
  Step,
  StepLabel,
  Alert,
} from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import {
  PlayArrow as RunIcon,
  CheckCircle as ApproveIcon,
  Cancel as RejectIcon,
  Cancel as CancelIcon,
  Payment as PaymentIcon,
  AccountBalance as StatutoryIcon,
  DoneAll as CompleteIcon,
  Send as SubmitIcon,
  Search as SearchIcon,
  ArrowBack as ArrowBackIcon,
  OpenInNew as OpenInNewIcon,
  Payments as PayrollIcon,
} from "@mui/icons-material";
import {
  ActionToolbar,
  DetailPanelHeader,
  FormSection,
  MasterDetailLayout,
  TConfirmDialog,
  TCurrency,
  TDataGrid,
  TDetailSkeleton,
  TPrintButton,
  TSidePanel,
  TStatusChip,
  TStatusFilter,
  getStatusProps,
  handleApiError,
  showErrorToast,
  showSuccessToast,
  useTConfirmDialog,
  type TDataGridColumn,
  type TFilterStatusOption,
} from "@/components/tijaero";
import { payrollBatchApi, statutoryReturnsApi } from "@/modules/hr/api";
import type {
  EmployeePayroll,
  PayrollBatch,
  PayrollRunRequest,
  PayrollBatchProcessPayment,
  PayrollBatchProcessStatutory,
  StatutoryReturnKind,
} from "@/modules/hr/types";

const n = (v: unknown) => Number(v || 0);
/** Earnings above basic: allowance lines (or the old two slots), overtime, commission, bonus. */
const allowancesOf = (r: EmployeePayroll) =>
  n(r.allowances_total) + n(r.add_overtime) + n(r.add_sales_commision) + n(r.add_bonus);
/** Deductions other than EPF and APIT. */
const otherDeductionsOf = (r: EmployeePayroll) =>
  n(r.less_stamp_duty) + n(r.less_late_deductions) + n(r.less_salary_advance_repayment) + n(r.less_loan_repayment)
  + n(r.less_other_deductions) + n(r.less_nopay);

const RETURNS: { kind: StatutoryReturnKind; label: string; hint: string }[] = [
  { kind: "epf", label: "EPF Form C", hint: "Monthly EPF contributions (8% + 12%) per member" },
  { kind: "etf", label: "ETF R4", hint: "Monthly ETF contributions (3%) per member" },
  { kind: "apit", label: "APIT schedule", hint: "Tax deducted per employee for the IRD" },
  { kind: "bank", label: "Bank transfer file", hint: "Net pay per bank account, for the salary upload" },
];

const WORKFLOW_STEPS = [
  "Setup Profiles",
  "Run Payroll",
  "Review & Submit",
  "Approve",
  "Salary Payment",
  "Statutory Payment",
  "Complete",
];

function getActiveStep(status: string): number {
  switch (status) {
    case "draft":
      return 2;
    case "pending_approval":
      return 3;
    case "approved":
      return 4;
    case "salary_paid":
      return 5;
    case "statutory_paid":
      return 6;
    case "completed":
      return 7;
    default:
      return 0;
  }
}

const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

const periodOf = (b: Pick<PayrollBatch, "payroll_month" | "payroll_year">) =>
  `${MONTHS.find((m) => m.value === b.payroll_month)?.label ?? ""} ${b.payroll_year}`.trim();

const STATUS_FILTER_OPTIONS: TFilterStatusOption[] = [
  "draft",
  "pending_approval",
  "approved",
  "salary_paid",
  "statutory_paid",
  "completed",
  "cancelled",
].map((s) => ({ value: s, label: getStatusProps(s, "payrollStatus").label }));

type BatchRow = PayrollBatch & { period: string };

/** Label + value cell used inside FormSection grids. */
function Figure({ label, children, color }: { label: string; children: React.ReactNode; color?: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h6" color={color}>
        {children}
      </Typography>
    </Box>
  );
}

export default function PayrollProcessingPage() {
  const queryClient = useQueryClient();
  const { dialogProps, confirm } = useTConfirmDialog();

  // State
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterYear, setFilterYear] = useState<string>("");
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [statutoryDialogOpen, setStatutoryDialogOpen] = useState(false);
  const [runForm, setRunForm] = useState<PayrollRunRequest>({
    payroll_month: new Date().getMonth() + 1,
    payroll_year: new Date().getFullYear(),
    description: "",
  });
  const [paymentForm, setPaymentForm] = useState<PayrollBatchProcessPayment>({
    payment_method: "bank_transfer",
    payment_reference: "",
  });
  const [statutoryForm, setStatutoryForm] = useState<PayrollBatchProcessStatutory>({
    epf_reference: "",
    etf_reference: "",
  });

  // Synchronous in-flight guard: `isPending` only flips on the next render, so a
  // fast double click could otherwise fire the same mutation twice.
  const inFlight = useRef(false);
  const guarded = (fire: (onSettled: () => void) => void) => {
    if (inFlight.current) return;
    inFlight.current = true;
    fire(() => {
      inFlight.current = false;
    });
  };

  // Queries
  const { data: batches, isLoading } = useQuery({
    queryKey: ["payroll-batches"],
    queryFn: () => payrollBatchApi.getAll(),
  });

  const { data: selectedBatch, isLoading: isBatchLoading } = useQuery({
    queryKey: ["payroll-batch", selectedBatchId],
    queryFn: () => payrollBatchApi.getById(selectedBatchId!),
    enabled: !!selectedBatchId,
  });

  // Mutations
  const runMutation = useMutation({
    mutationFn: payrollBatchApi.run,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["payroll-batches"] });
      setSelectedBatchId(data.id);
      showSuccessToast(`Payroll batch ${data.batch_no} created with ${data.total_employees} employees`);
      setRunDialogOpen(false);
    },
    onError: (err: unknown) => {
      showErrorToast(handleApiError(err, "Failed to run payroll"));
    },
  });

  const submitMutation = useMutation({
    mutationFn: (id: number) => payrollBatchApi.submit(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-batches"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-batch", selectedBatchId] });
      showSuccessToast("Payroll submitted for approval");
    },
    onError: (err: unknown) => {
      showErrorToast(handleApiError(err, "Failed to submit"));
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => payrollBatchApi.approve(id, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-batches"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-batch", selectedBatchId] });
      showSuccessToast("Payroll batch approved");
    },
    onError: (err: unknown) => {
      showErrorToast(handleApiError(err, "Failed to approve"));
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      payrollBatchApi.reject(id, { rejection_reason: reason }),
    onSuccess: () => {
      setRejectDialogOpen(false);
      setRejectReason("");
      queryClient.invalidateQueries({ queryKey: ["payroll-batches"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-batch", selectedBatchId] });
      showSuccessToast("Payroll batch rejected and returned to draft");
    },
    onError: (err: unknown) => {
      showErrorToast(handleApiError(err, "Failed to reject"));
    },
  });

  const paymentMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: PayrollBatchProcessPayment }) =>
      payrollBatchApi.processPayment(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-batches"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-batch", selectedBatchId] });
      showSuccessToast("Salary payments processed successfully");
      setPaymentDialogOpen(false);
    },
    onError: (err: unknown) => {
      showErrorToast(handleApiError(err, "Failed to process payment"));
    },
  });

  const statutoryMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: PayrollBatchProcessStatutory }) =>
      payrollBatchApi.processStatutory(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-batches"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-batch", selectedBatchId] });
      showSuccessToast("Statutory payments processed (EPF/ETF)");
      setStatutoryDialogOpen(false);
    },
    onError: (err: unknown) => {
      showErrorToast(handleApiError(err, "Failed to process statutory"));
    },
  });

  const completeMutation = useMutation({
    mutationFn: (id: number) => payrollBatchApi.complete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-batches"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-batch", selectedBatchId] });
      showSuccessToast("Payroll cycle completed!");
    },
    onError: (err: unknown) => {
      showErrorToast(handleApiError(err, "Failed to complete"));
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => payrollBatchApi.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-batches"] });
      setSelectedBatchId(null);
      showSuccessToast("Payroll batch cancelled");
    },
    onError: (err: unknown) => {
      showErrorToast(handleApiError(err, "Failed to cancel"));
    },
  });

  const anyWorkflowPending =
    submitMutation.isPending ||
    approveMutation.isPending ||
    rejectMutation.isPending ||
    paymentMutation.isPending ||
    statutoryMutation.isPending ||
    completeMutation.isPending ||
    cancelMutation.isPending;

  // Handlers
  const handleRun = () => guarded((onSettled) => runMutation.mutate(runForm, { onSettled }));

  const handleSubmitBatch = async () => {
    if (!selectedBatchId) return;
    const confirmed = await confirm({
      title: "Submit for Approval",
      message: "Submit this payroll batch for approval? This will lock all records for review.",
      confirmText: "Submit",
    });
    if (confirmed) guarded((onSettled) => submitMutation.mutate(selectedBatchId, { onSettled }));
  };

  const handleApproveBatch = async () => {
    if (!selectedBatchId) return;
    const confirmed = await confirm({
      title: "Approve Payroll",
      message: "Approve this payroll batch? This allows salary payments to be processed.",
      confirmText: "Approve",
    });
    if (confirmed) guarded((onSettled) => approveMutation.mutate(selectedBatchId, { onSettled }));
  };

  const handleRejectBatch = () => {
    if (!selectedBatchId) return;
    setRejectReason("");
    setRejectDialogOpen(true);
  };

  const handleConfirmReject = () => {
    if (!selectedBatchId || !rejectReason.trim()) return;
    guarded((onSettled) =>
      rejectMutation.mutate({ id: selectedBatchId, reason: rejectReason.trim() }, { onSettled }),
    );
  };

  const handleProcessPayment = () => {
    if (!selectedBatchId) return;
    guarded((onSettled) => paymentMutation.mutate({ id: selectedBatchId, data: paymentForm }, { onSettled }));
  };

  const handleProcessStatutory = () => {
    if (!selectedBatchId) return;
    guarded((onSettled) => statutoryMutation.mutate({ id: selectedBatchId, data: statutoryForm }, { onSettled }));
  };

  const handleCompleteBatch = async () => {
    if (!selectedBatchId) return;
    const confirmed = await confirm({
      title: "Complete Payroll Cycle",
      message: "Mark this payroll cycle as complete? This action is final.",
      confirmText: "Complete",
    });
    if (confirmed) guarded((onSettled) => completeMutation.mutate(selectedBatchId, { onSettled }));
  };

  const handleCancelBatch = async () => {
    if (!selectedBatchId) return;
    const confirmed = await confirm({
      title: "Cancel Payroll Batch",
      message: "Cancel this payroll batch? All payroll records will be marked as cancelled.",
      confirmText: "Cancel Batch",
      danger: true,
    });
    if (confirmed) guarded((onSettled) => cancelMutation.mutate(selectedBatchId, { onSettled }));
  };

  const handleClearFilters = () => {
    setSearchQuery("");
    setFilterStatus(null);
    setFilterYear("");
  };

  // Browse data
  const yearOptions = useMemo(
    () => Array.from(new Set((batches ?? []).map((b) => b.payroll_year))).sort((a, b) => b - a),
    [batches],
  );

  const batchRows = useMemo<BatchRow[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    return (batches ?? [])
      .map((b) => ({ ...b, period: periodOf(b) }))
      .filter((b) => !filterStatus || b.status === filterStatus)
      .filter((b) => !filterYear || String(b.payroll_year) === filterYear)
      .filter(
        (b) =>
          !q ||
          b.batch_no.toLowerCase().includes(q) ||
          b.period.toLowerCase().includes(q) ||
          (b.description ?? "").toLowerCase().includes(q),
      );
  }, [batches, searchQuery, filterStatus, filterYear]);

  const batchColumns = useMemo<TDataGridColumn<BatchRow>[]>(
    () => [
      {
        field: "batch_no",
        header: "Batch No",
        flex: 1,
        minWidth: 140,
        renderCell: (params: GridRenderCellParams<BatchRow>) => (
          <Typography variant="body2" fontWeight="bold">
            {params.row.batch_no}
          </Typography>
        ),
      },
      { field: "period", header: "Period", width: 160 },
      { field: "total_employees", header: "Employees", width: 110, align: "right" },
      {
        field: "total_gross_salary",
        header: "Gross Salary",
        width: 150,
        align: "right",
        renderCell: (params: GridRenderCellParams<BatchRow>) => (
          <TCurrency value={params.row.total_gross_salary || 0} />
        ),
      },
      {
        field: "total_net_salary",
        header: "Net Salary",
        width: 150,
        align: "right",
        renderCell: (params: GridRenderCellParams<BatchRow>) => <TCurrency value={params.row.total_net_salary || 0} />,
      },
      {
        field: "total_employer_cost",
        header: "Employer Cost",
        width: 150,
        align: "right",
        renderCell: (params: GridRenderCellParams<BatchRow>) => (
          <TCurrency value={params.row.total_employer_cost || 0} />
        ),
      },
      {
        field: "status",
        header: "Status",
        width: 150,
        renderCell: (params: GridRenderCellParams<BatchRow>) => (
          <TStatusChip status={params.row.status} statusMap="payrollStatus" />
        ),
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<BatchRow>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedBatchId(params.row.id);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [],
  );

  const isDetailMode = selectedBatchId !== null;
  const hasFilters = !!(searchQuery || filterStatus || filterYear);

  // Workflow buttons based on batch status (same rules as before).
  const renderActions = (batch: PayrollBatch) => {
    switch (batch.status) {
      case "draft":
        return (
          <>
            <Button variant="contained" color="primary" startIcon={<SubmitIcon />} onClick={handleSubmitBatch}
              size="small" disabled={anyWorkflowPending}>
              Submit for Approval
            </Button>
            <Button variant="contained" color="error" startIcon={<CancelIcon />} onClick={handleCancelBatch}
              size="small" disabled={anyWorkflowPending}>
              Cancel
            </Button>
          </>
        );
      case "pending_approval":
        return (
          <>
            <Button variant="contained" color="success" startIcon={<ApproveIcon />} onClick={handleApproveBatch}
              size="small" disabled={anyWorkflowPending}>
              Approve
            </Button>
            <Button variant="outlined" color="error" startIcon={<RejectIcon />} onClick={handleRejectBatch}
              size="small" disabled={anyWorkflowPending}>
              Reject
            </Button>
          </>
        );
      case "approved":
        return (
          <Button variant="contained" color="primary" startIcon={<PaymentIcon />}
            onClick={() => setPaymentDialogOpen(true)} size="small" disabled={anyWorkflowPending}>
            Process Salary Payment
          </Button>
        );
      case "salary_paid":
        return (
          <Button variant="contained" color="secondary" startIcon={<StatutoryIcon />}
            onClick={() => setStatutoryDialogOpen(true)} size="small" disabled={anyWorkflowPending}>
            Process Statutory (EPF/ETF)
          </Button>
        );
      case "statutory_paid":
        return (
          <Button variant="contained" color="success" startIcon={<CompleteIcon />} onClick={handleCompleteBatch}
            size="small" disabled={anyWorkflowPending}>
            Complete Payroll Cycle
          </Button>
        );
      default:
        return null;
    }
  };

  const batchTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<BatchRow>
          rows={batchRows}
          columns={batchColumns}
          loading={isLoading}
          onRowClick={(row) => setSelectedBatchId(row.id)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage={
            hasFilters
              ? "No payroll batches match the filters"
              : 'No payroll batches found. Click "Run Payroll" to generate payroll records for all employees.'
          }
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  const records = selectedBatch?.payroll_records ?? [];

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "HR" },
          { label: "Payroll Processing" },
          ...(selectedBatch ? [{ label: selectedBatch.batch_no }] : []),
        ]}
        title={selectedBatch?.batch_no ?? ""}
        titleIcon={<PayrollIcon color="primary" />}
        subtitle={
          selectedBatch
            ? `${periodOf(selectedBatch)}${selectedBatch.description ? ` — ${selectedBatch.description}` : ""}`
            : undefined
        }
        noSelectionTitle="Payroll Batch"
        chips={
          selectedBatch
            ? (() => {
              const s = getStatusProps(selectedBatch.status, "payrollStatus");
              return [{ label: s.label, color: s.color }];
            })()
            : []
        }
      />

      <ActionToolbar
        hasSelectedItem={!!selectedBatch}
        isCreating={false}
        isEditing={false}
        endActions={
          selectedBatch ? <Box sx={{ display: "flex", gap: 1 }}>{renderActions(selectedBatch)}</Box> : undefined
        }
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {isBatchLoading || !selectedBatch ? (
          <TDetailSkeleton />
        ) : (
          <>
            <FormSection title="Workflow" columns={1}>
              <Stepper activeStep={getActiveStep(selectedBatch.status)} alternativeLabel>
                {WORKFLOW_STEPS.map((label) => (
                  <Step key={label}>
                    <StepLabel>{label}</StepLabel>
                  </Step>
                ))}
              </Stepper>
            </FormSection>

            <FormSection title="Summary" columns={4}>
              <Figure label="Employees">{selectedBatch.total_employees}</Figure>
              <Figure label="Gross Salary">
                <TCurrency value={selectedBatch.total_gross_salary || 0} />
              </Figure>
              <Figure label="Total Deductions" color="error.main">
                <TCurrency value={selectedBatch.total_deductions || 0} />
              </Figure>
              <Figure label="Net Salary" color="success.main">
                <TCurrency value={selectedBatch.total_net_salary || 0} />
              </Figure>
              <Figure label="Employer EPF">
                <TCurrency value={selectedBatch.total_employer_epf || 0} />
              </Figure>
              <Figure label="Employer ETF">
                <TCurrency value={selectedBatch.total_employer_etf || 0} />
              </Figure>
              <Figure label="APIT Tax" color="warning.main">
                <TCurrency value={selectedBatch.total_apit || 0} />
              </Figure>
            </FormSection>

            {(selectedBatch.salary_payment_date || selectedBatch.statutory_payment_date) && (
              <FormSection title="Payment Information" columns={2}>
                {selectedBatch.salary_payment_date && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">Salary Paid</Typography>
                    <Typography variant="body2">
                      {selectedBatch.salary_payment_date}
                      {selectedBatch.salary_payment_reference && ` (Ref: ${selectedBatch.salary_payment_reference})`}
                    </Typography>
                  </Box>
                )}
                {selectedBatch.statutory_payment_date && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">Statutory Paid</Typography>
                    <Typography variant="body2">
                      {selectedBatch.statutory_payment_date}
                      {selectedBatch.statutory_payment_reference &&
                        ` (Ref: ${selectedBatch.statutory_payment_reference})`}
                    </Typography>
                  </Box>
                )}
              </FormSection>
            )}

            <FormSection title="Employee Payroll Records" columns={1}
              isLast={selectedBatch.status === "cancelled" || !records.length}>
              {records.length ? (
                <TableContainer>
                  <Table size="small" sx={{ "& td, & th": { whiteSpace: "nowrap" } }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Employee</TableCell>
                        <TableCell align="right">Basic</TableCell>
                        <TableCell align="right">Allowances</TableCell>
                        <TableCell align="right">Gross</TableCell>
                        <TableCell align="right">EPF (8%)</TableCell>
                        <TableCell align="right">ETF (3%)</TableCell>
                        <TableCell align="right">APIT</TableCell>
                        <TableCell align="right">Other Ded.</TableCell>
                        <TableCell align="right">Net Salary</TableCell>
                        <TableCell align="right">EPF Emp (12%)</TableCell>
                        <TableCell align="right">ETF Emp (3%)</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell padding="checkbox" />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {records.map((record) => (
                        <TableRow key={record.id}>
                          <TableCell>
                            <Typography variant="body2" fontWeight="bold">
                              {record.employee_name || record.employee_id}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {record.employee_id}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <TCurrency value={record.basic_salary || 0} />
                          </TableCell>
                          <TableCell align="right">
                            <TCurrency value={allowancesOf(record)} />
                            {n(record.add_overtime) > 0 && (
                              <Typography variant="caption" color="text.secondary" display="block">
                                incl. OT {n(record.ot_hours)} h
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell align="right">
                            <TCurrency value={record.gross_salary || 0} />
                          </TableCell>
                          <TableCell align="right">
                            <TCurrency value={record.less_epf_employee || 0} />
                          </TableCell>
                          <TableCell align="right">
                            <TCurrency value={record.less_etf_employee || 0} />
                          </TableCell>
                          <TableCell align="right">
                            <TCurrency value={record.less_apit || 0} />
                          </TableCell>
                          <TableCell align="right">
                            <TCurrency value={otherDeductionsOf(record)} />
                            {n(record.less_nopay) > 0 && (
                              <Typography variant="caption" color="text.secondary" display="block">
                                incl. no-pay {n(record.nopay_days)} d
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell align="right">
                            <Typography fontWeight="bold" color="success.main" variant="body2">
                              <TCurrency value={record.net_salary || 0} />
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <TCurrency value={record.epf_employer || 0} />
                          </TableCell>
                          <TableCell align="right">
                            <TCurrency value={record.etf_employer || 0} />
                          </TableCell>
                          <TableCell>
                            <TStatusChip status={record.status || "draft"} statusMap="payrollStatus" />
                          </TableCell>
                          <TableCell padding="checkbox">
                            <TPrintButton documentType="payslip" documentId={record.id} size="small"
                              tooltip="Print payslip" disabled={record.status === "cancelled"}
                              disabledReason="Cancelled" />
                          </TableCell>
                        </TableRow>
                      ))}
                      {/* Totals Row */}
                      <TableRow sx={{ "& td": { fontWeight: "bold", borderTop: 2 } }}>
                        <TableCell>TOTALS</TableCell>
                        <TableCell align="right">
                          <TCurrency value={records.reduce((sum, r) => sum + (r.basic_salary || 0), 0)} />
                        </TableCell>
                        <TableCell align="right">
                          <TCurrency value={records.reduce((sum, r) => sum + allowancesOf(r), 0)} />
                        </TableCell>
                        <TableCell align="right">
                          <TCurrency value={selectedBatch.total_gross_salary || 0} />
                        </TableCell>
                        <TableCell align="right">
                          <TCurrency value={records.reduce((sum, r) => sum + (r.less_epf_employee || 0), 0)} />
                        </TableCell>
                        <TableCell align="right">
                          <TCurrency value={records.reduce((sum, r) => sum + (r.less_etf_employee || 0), 0)} />
                        </TableCell>
                        <TableCell align="right">
                          <TCurrency value={selectedBatch.total_apit || 0} />
                        </TableCell>
                        <TableCell align="right">
                          <TCurrency value={records.reduce((sum, r) => sum + otherDeductionsOf(r), 0)} />
                        </TableCell>
                        <TableCell align="right">
                          <TCurrency value={selectedBatch.total_net_salary || 0} />
                        </TableCell>
                        <TableCell align="right">
                          <TCurrency value={selectedBatch.total_employer_epf || 0} />
                        </TableCell>
                        <TableCell align="right">
                          <TCurrency value={selectedBatch.total_employer_etf || 0} />
                        </TableCell>
                        <TableCell />
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No payroll records in this batch.
                </Typography>
              )}
            </FormSection>

            {selectedBatch.status !== "cancelled" && !!records.length && (
              <FormSection title="Statutory returns & bank file" columns={1} isLast>
                <Box>
                  <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                    {RETURNS.map((r) => (
                      <Button key={r.kind} variant="outlined" size="small" title={r.hint}
                        onClick={() => statutoryReturnsApi.downloadCsv(selectedBatch.id, r.kind)
                          .catch((e) => showErrorToast(handleApiError(e, `Failed to download ${r.label}`)))}>
                        {r.label} (CSV)
                      </Button>
                    ))}
                  </Box>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                    Set the employer EPF number and TIN in HR Setup → Payroll. Members without an EPF number or bank
                    account are listed as warnings in the file.
                  </Typography>
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
        title="Payroll Processing"
        titleSlot={
          isDetailMode ? (
            <Button
              size="small"
              startIcon={<ArrowBackIcon fontSize="small" />}
              onClick={() => setSelectedBatchId(null)}
              sx={{ textTransform: "none" }}
            >
              Back to Payroll Batches
            </Button>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search batch / period"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                }}
                sx={{ width: 190, flexShrink: 0, "& .MuiOutlinedInput-root": { borderRadius: "24px" } }}
              />
              <Box sx={{ width: 170, flexShrink: 0 }}>
                <TStatusFilter
                  options={STATUS_FILTER_OPTIONS}
                  value={filterStatus}
                  onChange={setFilterStatus}
                  label=""
                  placeholder="All Statuses"
                  size="small"
                />
              </Box>
              <Box sx={{ width: 130, flexShrink: 0 }}>
                <TextField
                  select
                  size="small"
                  fullWidth
                  value={filterYear}
                  onChange={(e) => setFilterYear(e.target.value)}
                  SelectProps={{ displayEmpty: true }}
                >
                  <MenuItem value="">All Years</MenuItem>
                  {yearOptions.map((y) => (
                    <MenuItem key={y} value={String(y)}>
                      {y}
                    </MenuItem>
                  ))}
                </TextField>
              </Box>
              {hasFilters && (
                <Button size="small" onClick={handleClearFilters} sx={{ textTransform: "none" }}>
                  Clear
                </Button>
              )}
            </Box>
          )
        }
        headerActions={
          isDetailMode ? undefined : (
            <Button
              variant="contained"
              size="small"
              startIcon={<RunIcon />}
              onClick={() => setRunDialogOpen(true)}
              sx={{ mr: 1 }}
            >
              Run Payroll
            </Button>
          )
        }
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ["payroll-batches"] });
          if (selectedBatchId) queryClient.invalidateQueries({ queryKey: ["payroll-batch", selectedBatchId] });
        }}
        isLoading={isLoading}
      >
        {isDetailMode ? detailPanel : batchTablePanel}
      </MasterDetailLayout>

      {/* Reject Payroll */}
      <TSidePanel
        open={rejectDialogOpen}
        onClose={() => setRejectDialogOpen(false)}
        title="Reject Payroll"
        onSubmit={handleConfirmReject}
        isSubmitting={rejectMutation.isPending}
        submitDisabled={!rejectReason.trim() || rejectMutation.isPending}
        submitText="Reject"
      >
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          The batch returns to draft for corrections. Say what needs to change.
        </Typography>
        <TextField
          label="Reason"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          inputProps={{ maxLength: 1000 }}
          multiline
          minRows={2}
          fullWidth
          autoFocus
          required
        />
      </TSidePanel>

      {/* Run Payroll */}
      <TSidePanel
        open={runDialogOpen}
        onClose={() => setRunDialogOpen(false)}
        title="Run Payroll"
        onSubmit={handleRun}
        isSubmitting={runMutation.isPending}
        submitDisabled={runMutation.isPending}
        submitText={runMutation.isPending ? "Processing..." : "Run Payroll"}
      >
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          This will generate payroll records for all employees with salary profiles, using the salary in force at
          month end. EPF (8% / 12%) and ETF (3%) are on basic + EPF-liable allowances; overtime and late minutes come
          from attendance; no-pay leave, loan instalments, stamp duty and APIT (2025/2026) are worked out automatically.
          Rates are in HR Setup → Payroll.
        </Typography>
        <Box sx={{ display: "flex", gap: 2, mt: 2 }}>
          <TextField
            select
            label="Month"
            value={runForm.payroll_month}
            onChange={(e) => setRunForm({ ...runForm, payroll_month: Number(e.target.value) })}
            fullWidth
          >
            {MONTHS.map((m) => (
              <MenuItem key={m.value} value={m.value}>
                {m.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Year"
            type="number"
            value={runForm.payroll_year}
            onChange={(e) => setRunForm({ ...runForm, payroll_year: Number(e.target.value) })}
            fullWidth
          />
        </Box>
        <TextField
          label="Description (optional)"
          value={runForm.description}
          onChange={(e) => setRunForm({ ...runForm, description: e.target.value })}
          fullWidth
          sx={{ mt: 2 }}
        />
      </TSidePanel>

      {/* Process Salary Payment */}
      <TSidePanel
        open={paymentDialogOpen}
        onClose={() => setPaymentDialogOpen(false)}
        title="Process Salary Payment"
        onSubmit={handleProcessPayment}
        isSubmitting={paymentMutation.isPending}
        submitDisabled={paymentMutation.isPending}
        submitText={paymentMutation.isPending ? "Processing..." : "Process Payment"}
      >
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Process salary payments for all employees in this batch.
          Total net salary:{" "}
          <strong>
            <TCurrency value={selectedBatch?.total_net_salary || 0} />
          </strong>
        </Typography>
        <TextField
          select
          label="Payment Method"
          value={paymentForm.payment_method}
          onChange={(e) => setPaymentForm({ ...paymentForm, payment_method: e.target.value })}
          fullWidth
          sx={{ mt: 2 }}
        >
          <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
          <MenuItem value="cheque">Cheque</MenuItem>
          <MenuItem value="cash">Cash</MenuItem>
        </TextField>
        <TextField
          label="Payment Reference"
          value={paymentForm.payment_reference}
          onChange={(e) => setPaymentForm({ ...paymentForm, payment_reference: e.target.value })}
          fullWidth
          sx={{ mt: 2 }}
        />
      </TSidePanel>

      {/* Process Statutory Payment */}
      <TSidePanel
        open={statutoryDialogOpen}
        onClose={() => setStatutoryDialogOpen(false)}
        title="Process Statutory Payments (EPF / ETF)"
        onSubmit={handleProcessStatutory}
        isSubmitting={statutoryMutation.isPending}
        submitDisabled={statutoryMutation.isPending}
        submitText={statutoryMutation.isPending ? "Processing..." : "Process Statutory"}
      >
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Record EPF and ETF payments to the Department of Labour.
        </Typography>
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2">
            Total EPF (Employee + Employer):{" "}
            <strong>
              <TCurrency
                value={
                  (selectedBatch?.total_employer_epf || 0) +
                  (selectedBatch?.payroll_records?.reduce((sum, r) => sum + (r.less_epf_employee || 0), 0) || 0)
                }
              />
            </strong>
          </Typography>
          <Typography variant="body2">
            Total ETF (Employee + Employer):{" "}
            <strong>
              <TCurrency
                value={
                  (selectedBatch?.total_employer_etf || 0) +
                  (selectedBatch?.payroll_records?.reduce((sum, r) => sum + (r.less_etf_employee || 0), 0) || 0)
                }
              />
            </strong>
          </Typography>
        </Alert>
        <TextField
          label="EPF Payment Reference"
          value={statutoryForm.epf_reference}
          onChange={(e) => setStatutoryForm({ ...statutoryForm, epf_reference: e.target.value })}
          fullWidth
          sx={{ mt: 2 }}
        />
        <TextField
          label="ETF Payment Reference"
          value={statutoryForm.etf_reference}
          onChange={(e) => setStatutoryForm({ ...statutoryForm, etf_reference: e.target.value })}
          fullWidth
          sx={{ mt: 2 }}
        />
      </TSidePanel>

      <TConfirmDialog {...dialogProps} />
    </>
  );
}
