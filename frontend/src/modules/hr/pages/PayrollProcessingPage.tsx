import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Paper,
  Typography,
  Chip,
  Divider,
  Button,
  LinearProgress,
  TextField,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Card,
  CardContent,
  Grid,
  Stepper,
  Step,
  StepLabel,
  Alert,
} from "@mui/material";
import {
  PlayArrow as RunIcon,
  CheckCircle as ApproveIcon,
  Cancel as RejectIcon,
  Payment as PaymentIcon,
  AccountBalance as StatutoryIcon,
  DoneAll as CompleteIcon,
  Send as SubmitIcon,
  Visibility as ViewIcon,
  Add as AddIcon,
} from "@mui/icons-material";
import {
  handleApiError,
  showErrorToast,
  showSuccessToast,
  TButton,
  TConfirmDialog,
  TCurrency,
  TPageHeader,
  TStatusChip,
  useTConfirmDialog,
} from "@/components/tijaero";
import { payrollBatchApi } from "@/modules/hr/api";
import type {
  PayrollBatch,
  PayrollRunRequest,
  PayrollBatchProcessPayment,
  PayrollBatchProcessStatutory,
} from "@/modules/hr/types";

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

export default function PayrollProcessingPage() {
  const queryClient = useQueryClient();
  const { dialogProps, confirm } = useTConfirmDialog();

  // State
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [runDialogOpen, setRunDialogOpen] = useState(false);
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

  // Queries
  const { data: batches, isLoading } = useQuery({
    queryKey: ["payroll-batches"],
    queryFn: () => payrollBatchApi.getAll(),
  });

  const { data: selectedBatch } = useQuery({
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
    onError: (err: any) => {
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
    onError: (err: any) => {
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
    onError: (err: any) => {
      showErrorToast(handleApiError(err, "Failed to approve"));
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) =>
      payrollBatchApi.reject(id, { rejection_reason: "Rejected by manager" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-batches"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-batch", selectedBatchId] });
      showSuccessToast("Payroll batch rejected and returned to draft");
    },
    onError: (err: any) => {
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
    onError: (err: any) => {
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
    onError: (err: any) => {
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
    onError: (err: any) => {
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
    onError: (err: any) => {
      showErrorToast(handleApiError(err, "Failed to cancel"));
    },
  });

  // Handlers
  const handleSubmitBatch = async () => {
    if (!selectedBatchId) return;
    const confirmed = await confirm({
      title: "Submit for Approval",
      message: "Submit this payroll batch for approval? This will lock all records for review.",
      confirmText: "Submit",
    });
    if (confirmed) submitMutation.mutate(selectedBatchId);
  };

  const handleApproveBatch = async () => {
    if (!selectedBatchId) return;
    const confirmed = await confirm({
      title: "Approve Payroll",
      message: "Approve this payroll batch? This allows salary payments to be processed.",
      confirmText: "Approve",
    });
    if (confirmed) approveMutation.mutate(selectedBatchId);
  };

  const handleRejectBatch = async () => {
    if (!selectedBatchId) return;
    const confirmed = await confirm({
      title: "Reject Payroll",
      message: "Reject this payroll batch? It will be returned to draft for corrections.",
      confirmText: "Reject",
      danger: true,
    });
    if (confirmed) rejectMutation.mutate(selectedBatchId);
  };

  const handleCompleteBatch = async () => {
    if (!selectedBatchId) return;
    const confirmed = await confirm({
      title: "Complete Payroll Cycle",
      message: "Mark this payroll cycle as complete? This action is final.",
      confirmText: "Complete",
    });
    if (confirmed) completeMutation.mutate(selectedBatchId);
  };

  const handleCancelBatch = async () => {
    if (!selectedBatchId) return;
    const confirmed = await confirm({
      title: "Cancel Payroll Batch",
      message: "Cancel this payroll batch? All payroll records will be marked as cancelled.",
      confirmText: "Cancel Batch",
      danger: true,
    });
    if (confirmed) cancelMutation.mutate(selectedBatchId);
  };

  // Render action buttons based on batch status
  const renderActions = (batch: PayrollBatch) => {
    const actions: JSX.Element[] = [];

    switch (batch.status) {
      case "draft":
        actions.push(
          <Button
            key="submit"
            variant="contained"
            color="primary"
            startIcon={<SubmitIcon />}
            onClick={handleSubmitBatch}
            size="small"
          >
            Submit for Approval
          </Button>,
          <Button
            key="cancel"
            variant="outlined"
            color="error"
            onClick={handleCancelBatch}
            size="small"
          >
            Cancel
          </Button>
        );
        break;
      case "pending_approval":
        actions.push(
          <Button
            key="approve"
            variant="contained"
            color="success"
            startIcon={<ApproveIcon />}
            onClick={handleApproveBatch}
            size="small"
          >
            Approve
          </Button>,
          <Button
            key="reject"
            variant="outlined"
            color="error"
            startIcon={<RejectIcon />}
            onClick={handleRejectBatch}
            size="small"
          >
            Reject
          </Button>
        );
        break;
      case "approved":
        actions.push(
          <Button
            key="pay"
            variant="contained"
            color="primary"
            startIcon={<PaymentIcon />}
            onClick={() => setPaymentDialogOpen(true)}
            size="small"
          >
            Process Salary Payment
          </Button>
        );
        break;
      case "salary_paid":
        actions.push(
          <Button
            key="statutory"
            variant="contained"
            color="secondary"
            startIcon={<StatutoryIcon />}
            onClick={() => setStatutoryDialogOpen(true)}
            size="small"
          >
            Process Statutory (EPF/ETF)
          </Button>
        );
        break;
      case "statutory_paid":
        actions.push(
          <Button
            key="complete"
            variant="contained"
            color="success"
            startIcon={<CompleteIcon />}
            onClick={handleCompleteBatch}
            size="small"
          >
            Complete Payroll Cycle
          </Button>
        );
        break;
    }
    return actions;
  };

  return (
    <Box>
      <TPageHeader
        title="Payroll Processing"
        actions={
          <TButton startIcon={<AddIcon />} onClick={() => setRunDialogOpen(true)}>
            Run Payroll
          </TButton>
        }
      />

      {/* Batches List */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 1 }}>
          Payroll Batches
        </Typography>
        {isLoading ? (
          <LinearProgress sx={{ my: 2 }} />
        ) : !batches?.length ? (
          <Alert severity="info">
            No payroll batches found. Click "Run Payroll" to generate payroll records for all employees.
          </Alert>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Batch No</TableCell>
                  <TableCell>Period</TableCell>
                  <TableCell>Employees</TableCell>
                  <TableCell align="right">Gross Salary</TableCell>
                  <TableCell align="right">Net Salary</TableCell>
                  <TableCell align="right">Employer Cost</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {batches.map((batch) => (
                  <TableRow
                    key={batch.id}
                    hover
                    selected={selectedBatchId === batch.id}
                    sx={{ cursor: "pointer" }}
                    onClick={() => setSelectedBatchId(batch.id)}
                  >
                    <TableCell>
                      <Typography variant="body2" fontWeight="bold">
                        {batch.batch_no}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {MONTHS.find((m) => m.value === batch.payroll_month)?.label}{" "}
                      {batch.payroll_year}
                    </TableCell>
                    <TableCell>{batch.total_employees}</TableCell>
                    <TableCell align="right">
                      <TCurrency value={batch.total_gross_salary || 0} />
                    </TableCell>
                    <TableCell align="right">
                      <TCurrency value={batch.total_net_salary || 0} />
                    </TableCell>
                    <TableCell align="right">
                      <TCurrency value={batch.total_employer_cost || 0} />
                    </TableCell>
                    <TableCell>
                      <TStatusChip status={batch.status} statusMap="payrollStatus" />
                    </TableCell>
                    <TableCell>
                      <Button
                        size="small"
                        startIcon={<ViewIcon />}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedBatchId(batch.id);
                        }}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {/* Batch Detail */}
      {selectedBatch && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
            <Box>
              <Typography variant="h6">
                {selectedBatch.batch_no}
                <Chip
                  label={selectedBatch.status.replace(/_/g, " ").toUpperCase()}
                  size="small"
                  sx={{ ml: 1 }}
                />
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {MONTHS.find((m) => m.value === selectedBatch.payroll_month)?.label}{" "}
                {selectedBatch.payroll_year}
                {selectedBatch.description && ` — ${selectedBatch.description}`}
              </Typography>
            </Box>
            <Box sx={{ display: "flex", gap: 1 }}>
              {renderActions(selectedBatch)}
            </Box>
          </Box>

          {/* Workflow Stepper */}
          <Stepper
            activeStep={getActiveStep(selectedBatch.status)}
            alternativeLabel
            sx={{ mb: 3 }}
          >
            {WORKFLOW_STEPS.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>

          {/* Summary Cards */}
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} sm={6} md={2}>
              <Card variant="outlined">
                <CardContent sx={{ py: 1, "&:last-child": { pb: 1 } }}>
                  <Typography variant="caption" color="text.secondary">
                    Employees
                  </Typography>
                  <Typography variant="h6">{selectedBatch.total_employees}</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <Card variant="outlined">
                <CardContent sx={{ py: 1, "&:last-child": { pb: 1 } }}>
                  <Typography variant="caption" color="text.secondary">
                    Gross Salary
                  </Typography>
                  <Typography variant="h6">
                    <TCurrency value={selectedBatch.total_gross_salary || 0} />
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <Card variant="outlined">
                <CardContent sx={{ py: 1, "&:last-child": { pb: 1 } }}>
                  <Typography variant="caption" color="text.secondary">
                    Total Deductions
                  </Typography>
                  <Typography variant="h6" color="error.main">
                    <TCurrency value={selectedBatch.total_deductions || 0} />
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <Card variant="outlined">
                <CardContent sx={{ py: 1, "&:last-child": { pb: 1 } }}>
                  <Typography variant="caption" color="text.secondary">
                    Net Salary
                  </Typography>
                  <Typography variant="h6" color="success.main">
                    <TCurrency value={selectedBatch.total_net_salary || 0} />
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <Card variant="outlined">
                <CardContent sx={{ py: 1, "&:last-child": { pb: 1 } }}>
                  <Typography variant="caption" color="text.secondary">
                    Employer EPF
                  </Typography>
                  <Typography variant="h6">
                    <TCurrency value={selectedBatch.total_employer_epf || 0} />
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <Card variant="outlined">
                <CardContent sx={{ py: 1, "&:last-child": { pb: 1 } }}>
                  <Typography variant="caption" color="text.secondary">
                    Employer ETF
                  </Typography>
                  <Typography variant="h6">
                    <TCurrency value={selectedBatch.total_employer_etf || 0} />
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <Card variant="outlined">
                <CardContent sx={{ py: 1, "&:last-child": { pb: 1 } }}>
                  <Typography variant="caption" color="text.secondary">
                    APIT Tax
                  </Typography>
                  <Typography variant="h6" color="warning.main">
                    <TCurrency value={selectedBatch.total_apit || 0} />
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Payment Info */}
          {(selectedBatch.salary_payment_date || selectedBatch.statutory_payment_date) && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {selectedBatch.salary_payment_date && (
                <Typography variant="body2">
                  💰 Salary Paid: {selectedBatch.salary_payment_date}
                  {selectedBatch.salary_payment_reference && ` (Ref: ${selectedBatch.salary_payment_reference})`}
                </Typography>
              )}
              {selectedBatch.statutory_payment_date && (
                <Typography variant="body2">
                  🏛 Statutory Paid: {selectedBatch.statutory_payment_date}
                  {selectedBatch.statutory_payment_reference && ` (Ref: ${selectedBatch.statutory_payment_reference})`}
                </Typography>
              )}
            </Alert>
          )}

          <Divider sx={{ mb: 2 }} />

          {/* Employee Payroll Records */}
          <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 1 }}>
            Employee Payroll Records
          </Typography>
          {selectedBatch.payroll_records?.length ? (
            <TableContainer>
              <Table size="small">
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
                  </TableRow>
                </TableHead>
                <TableBody>
                  {selectedBatch.payroll_records.map((record) => (
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
                        <TCurrency
                          value={
                            (record.add_1_value || 0) +
                            (record.add_2_value || 0) +
                            (record.add_sales_commision || 0) +
                            (record.add_bonus || 0)
                          }
                        />
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
                        <TCurrency
                          value={
                            (record.less_stamp_duty || 0) +
                            (record.less_late_deductions || 0) +
                            (record.less_salary_advance_repayment || 0) +
                            (record.less_loan_repayment || 0) +
                            (record.less_other_deductions || 0)
                          }
                        />
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
                    </TableRow>
                  ))}
                  {/* Totals Row */}
                  <TableRow sx={{ "& td": { fontWeight: "bold", borderTop: 2 } }}>
                    <TableCell>TOTALS</TableCell>
                    <TableCell align="right">
                      <TCurrency
                        value={selectedBatch.payroll_records.reduce(
                          (sum, r) => sum + (r.basic_salary || 0),
                          0
                        )}
                      />
                    </TableCell>
                    <TableCell align="right">—</TableCell>
                    <TableCell align="right">
                      <TCurrency value={selectedBatch.total_gross_salary || 0} />
                    </TableCell>
                    <TableCell align="right">—</TableCell>
                    <TableCell align="right">—</TableCell>
                    <TableCell align="right">
                      <TCurrency value={selectedBatch.total_apit || 0} />
                    </TableCell>
                    <TableCell align="right">—</TableCell>
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
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No payroll records in this batch.
            </Typography>
          )}
        </Paper>
      )}

      {/* Run Payroll Dialog */}
      <Dialog
        open={runDialogOpen}
        onClose={() => setRunDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Run Payroll</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            This will generate payroll records for all employees with salary profiles.
            EPF (Employee 8%, Employer 12%), ETF (Employee 3%, Employer 3%), Stamp Duty (LKR 100),
            and APIT (Advance Personal Income Tax 2025/2026) will be calculated automatically.
          </Typography>
          <Box sx={{ display: "flex", gap: 2, mt: 2 }}>
            <TextField
              select
              label="Month"
              value={runForm.payroll_month}
              onChange={(e) =>
                setRunForm({ ...runForm, payroll_month: Number(e.target.value) })
              }
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
              onChange={(e) =>
                setRunForm({ ...runForm, payroll_year: Number(e.target.value) })
              }
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
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRunDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            startIcon={<RunIcon />}
            onClick={() => runMutation.mutate(runForm)}
            disabled={runMutation.isPending}
          >
            {runMutation.isPending ? "Processing..." : "Run Payroll"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Process Salary Payment Dialog */}
      <Dialog
        open={paymentDialogOpen}
        onClose={() => setPaymentDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Process Salary Payment</DialogTitle>
        <DialogContent>
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
            onChange={(e) =>
              setPaymentForm({ ...paymentForm, payment_method: e.target.value })
            }
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
            onChange={(e) =>
              setPaymentForm({ ...paymentForm, payment_reference: e.target.value })
            }
            fullWidth
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPaymentDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            startIcon={<PaymentIcon />}
            onClick={() =>
              selectedBatchId &&
              paymentMutation.mutate({ id: selectedBatchId, data: paymentForm })
            }
            disabled={paymentMutation.isPending}
          >
            {paymentMutation.isPending ? "Processing..." : "Process Payment"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Process Statutory Payment Dialog */}
      <Dialog
        open={statutoryDialogOpen}
        onClose={() => setStatutoryDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Process Statutory Payments (EPF / ETF)</DialogTitle>
        <DialogContent>
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
                    (selectedBatch?.payroll_records?.reduce(
                      (sum, r) => sum + (r.less_epf_employee || 0),
                      0
                    ) || 0)
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
                    (selectedBatch?.payroll_records?.reduce(
                      (sum, r) => sum + (r.less_etf_employee || 0),
                      0
                    ) || 0)
                  }
                />
              </strong>
            </Typography>
          </Alert>
          <TextField
            label="EPF Payment Reference"
            value={statutoryForm.epf_reference}
            onChange={(e) =>
              setStatutoryForm({ ...statutoryForm, epf_reference: e.target.value })
            }
            fullWidth
            sx={{ mt: 2 }}
          />
          <TextField
            label="ETF Payment Reference"
            value={statutoryForm.etf_reference}
            onChange={(e) =>
              setStatutoryForm({ ...statutoryForm, etf_reference: e.target.value })
            }
            fullWidth
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatutoryDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="secondary"
            startIcon={<StatutoryIcon />}
            onClick={() =>
              selectedBatchId &&
              statutoryMutation.mutate({ id: selectedBatchId, data: statutoryForm })
            }
            disabled={statutoryMutation.isPending}
          >
            {statutoryMutation.isPending ? "Processing..." : "Process Statutory"}
          </Button>
        </DialogActions>
      </Dialog>

      <TConfirmDialog {...dialogProps} />
    </Box>
  );
}
