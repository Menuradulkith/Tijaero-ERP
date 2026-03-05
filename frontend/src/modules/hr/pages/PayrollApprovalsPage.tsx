/**
 * PayrollApprovalsPage - Payroll Batch Approval Workflow (Gap F1)
 *
 * Shows payroll batches pending approval.
 * Follows MasterDetail pattern with approve/reject actions.
 */

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDateTimeReadable } from "@/utils/formatters";

import {
  EmptyState,
  fmtLKR,
  FormSection,
  getStatusProps,
  handleApiError,
  MasterDetailLayout,
  modernTableStyles,
  SearchableList,
  SelectableListItem,
  type SortOption,
  TBranchFilter,
  TFilterPanel,
  TStatCard,
  TStatusChip,
  showErrorToast,
  showSuccessToast,
  TConfirmDialog,
  TDetailSkeleton,
  useConfirmDialog,
} from "@/components/tijaero";

import { useReferenceData } from "@/hooks";
import { payrollBatchApi } from "@/modules/hr/api";
import type { PayrollBatch, EmployeePayroll } from "@/modules/hr/types";

// ─── Configuration ───────────────────────────────────────────────────────────

const STATUS_FILTER_OPTIONS = [
  { value: "pending", label: "Pending Approval" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "salary_paid", label: "Salary Paid" },
  { value: "statutory_paid", label: "Statutory Paid" },
  { value: "completed", label: "Completed" },
];

const SORT_OPTIONS: SortOption[] = [
  { value: "payroll_month", label: "Payroll Period" },
  { value: "batch_no", label: "Batch No" },
  { value: "total_net_salary", label: "Net Salary" },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function PayrollApprovalsPage() {
  const queryClient = useQueryClient();

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("payroll_month");
  const [filterStatus, setFilterStatus] = useState<string>("pending");
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<PayrollBatch | null>(null);

  // Dialogs
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const approveDialog = useConfirmDialog();

  // Ref data
  const { filteredBranches } = useReferenceData(["branches"]);
  const branches = filteredBranches || [];

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ["payroll-approvals", filterStatus, filterBranch],
    queryFn: () =>
      payrollBatchApi.getAll({
        status: filterStatus || undefined,
        limit: 500,
      }),
  });

  // Fetch selected detail
  const { data: batchDetail, isLoading: isDetailLoading } = useQuery({
    queryKey: ["payroll-approval-detail", selectedBatch?.id],
    queryFn: () =>
      selectedBatch
        ? payrollBatchApi.getById(selectedBatch.id)
        : Promise.resolve(null),
    enabled: !!selectedBatch,
  });

  // ─── Filter & Sort ─────────────────────────────────────────────────────────

  const filteredBatches = useMemo(() => {
    let filtered = [...batches];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (b) =>
          b.batch_no?.toLowerCase().includes(q) ||
          b.description?.toLowerCase().includes(q)
      );
    }
    filtered.sort((a, b) => {
      if (sortField === "total_net_salary")
        return Number(b.total_net_salary || 0) - Number(a.total_net_salary || 0);
      if (sortField === "batch_no")
        return (b.batch_no || "").localeCompare(a.batch_no || "");
      // Default: sort by year then month descending
      if (b.payroll_year !== a.payroll_year)
        return (b.payroll_year || 0) - (a.payroll_year || 0);
      return (b.payroll_month || 0) - (a.payroll_month || 0);
    });
    return filtered;
  }, [batches, searchQuery, sortField]);

  useEffect(() => {
    if (filteredBatches.length > 0 && !selectedBatch) {
      setSelectedBatch(filteredBatches[0]);
    }
  }, [filteredBatches, selectedBatch]);

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["payroll-approvals"] });
    queryClient.invalidateQueries({ queryKey: ["payroll-approval-detail"] });
    queryClient.invalidateQueries({ queryKey: ["payroll-batches"] });
  };

  const approveMutation = useMutation({
    mutationFn: (id: number) => payrollBatchApi.approve(id, {}),
    onSuccess: (data: PayrollBatch) => {
      invalidate();
      showSuccessToast(`Payroll batch ${data.batch_no} approved`);
      setSelectedBatch(data);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to approve payroll batch")),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      payrollBatchApi.reject(id, { rejection_reason: reason }),
    onSuccess: (data: PayrollBatch) => {
      invalidate();
      showSuccessToast(`Payroll batch ${data.batch_no} rejected`);
      setRejectDialogOpen(false);
      setRejectReason("");
      setSelectedBatch(data);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to reject payroll batch")),
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleApprove = useCallback(() => {
    if (!selectedBatch) return;
    approveDialog.open(
      "Approve Payroll Batch",
      `Approve payroll batch ${selectedBatch.batch_no} with ${selectedBatch.total_employees || 0} employees and total net salary of Rs. ${fmtLKR(selectedBatch.total_net_salary || 0)}?`,
      () => approveMutation.mutate(selectedBatch.id)
    );
  }, [selectedBatch, approveDialog, approveMutation]);

  const formatPeriod = (month?: number, year?: number) => {
    if (!month || !year) return "-";
    const date = new Date(year, month - 1, 1);
    return format(date, "MMMM yyyy");
  };

  // ─── Master Panel ──────────────────────────────────────────────────────────

  const masterPanel = (
    <Box>
      <TFilterPanel>
        <TBranchFilter
          branches={branches}
          value={filterBranch}
          onChange={setFilterBranch}
        />
        <TextField
          select
          size="small"
          label="Status"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          sx={{ minWidth: 150 }}
        >
          {STATUS_FILTER_OPTIONS.map((opt) => (
            <MenuItem key={opt.value} value={opt.value || ""}>
              {opt.label}
            </MenuItem>
          ))}
        </TextField>
      </TFilterPanel>

      <SearchableList
        items={filteredBatches}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        placeholder="Search payroll batches..."
        sortOptions={SORT_OPTIONS}
        sortField={sortField}
        onSortChange={setSortField}
        isLoading={isLoading}
        renderItem={(b: PayrollBatch, isSelected: boolean) => (
          <SelectableListItem
            key={b.id}
            id={b.id}
            isSelected={isSelected}
            onClick={() => setSelectedBatch(b)}
            primaryText={b.batch_no}
            secondaryText={
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Typography variant="caption" color="text.secondary">
                  {formatPeriod(b.payroll_month, b.payroll_year)} • {b.total_employees || 0} employees
                </Typography>
                <Typography variant="caption" fontWeight={600}>
                  Rs. {fmtLKR(b.total_net_salary || 0)}
                </Typography>
              </Box>
            }
            statusChip={{
              ...getStatusProps(b.status, "payrollStatus"),
              size: "small" as const,
            }}
          />
        )}
      >
        {!isLoading && filteredBatches.length === 0 && (
          <EmptyState message="No payroll batches match your filters" />
        )}
      </SearchableList>
    </Box>
  );

  // ─── Detail Panel ──────────────────────────────────────────────────────────

  const detail = batchDetail || selectedBatch;

  const detailPanel = isDetailLoading && selectedBatch ? (
    <TDetailSkeleton sections={3} fieldsPerSection={4} showTable />
  ) : detail ? (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight="bold">{detail.batch_no}</Typography>
          <Typography variant="body2" color="text.secondary">
            {formatPeriod(detail.payroll_month, detail.payroll_year)} • {detail.total_employees || 0} employees
          </Typography>
        </Box>
        <TStatusChip status={detail.status} statusMap="payrollStatus" />
      </Box>

      {detail.status === "pending" && (
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 3 }}>
          <Button
            variant="contained"
            color="success"
            startIcon={<CheckCircleIcon />}
            onClick={handleApprove}
            disabled={approveMutation.isPending}
          >
            Approve
          </Button>
          <Button
            variant="outlined"
            color="error"
            startIcon={<CancelIcon />}
            onClick={() => setRejectDialogOpen(true)}
            disabled={rejectMutation.isPending}
          >
            Reject
          </Button>
        </Box>
      )}

      {/* Summary Stats */}
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 2, mb: 3 }}>
        <TStatCard
          title="Gross Salary"
          value={`Rs. ${fmtLKR(detail.total_gross_salary || 0)}`}
          color="primary"
        />
        <TStatCard
          title="Net Salary"
          value={`Rs. ${fmtLKR(detail.total_net_salary || 0)}`}
          color="success"
        />
        <TStatCard
          title="Total EPF"
          value={`Rs. ${fmtLKR(Number(detail.total_employer_epf || 0))}`}
          color="warning"
        />
        <TStatCard
          title="Total ETF"
          value={`Rs. ${fmtLKR(Number(detail.total_employer_etf || 0))}`}
          color="info"
        />
      </Box>

      <FormSection title="Payroll Period">
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2 }}>
          <Box>
            <Typography variant="caption" color="text.secondary">Period</Typography>
            <Typography>{formatPeriod(detail.payroll_month, detail.payroll_year)}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Total Employees</Typography>
            <Typography>{detail.total_employees || 0}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Description</Typography>
            <Typography>{detail.description || "-"}</Typography>
          </Box>
        </Box>
      </FormSection>

      <FormSection title="Deductions Summary">
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2 }}>
          <Box>
            <Typography variant="caption" color="text.secondary">Total Deductions</Typography>
            <Typography>Rs. {fmtLKR(detail.total_deductions || 0)}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Employer EPF (12%)</Typography>
            <Typography>Rs. {fmtLKR(detail.total_employer_epf || 0)}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Employer ETF (3%)</Typography>
            <Typography>Rs. {fmtLKR(detail.total_employer_etf || 0)}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Total APIT</Typography>
            <Typography>Rs. {fmtLKR(detail.total_apit || 0)}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Total Employer Cost</Typography>
            <Typography fontWeight="bold">Rs. {fmtLKR(detail.total_employer_cost || 0)}</Typography>
          </Box>
        </Box>
      </FormSection>

      {detail.payroll_records && detail.payroll_records.length > 0 && (
        <FormSection title="Employee Payroll Records">
          <Table size="small" sx={modernTableStyles.container}>
            <TableHead>
              <TableRow sx={modernTableStyles.headerRow}>
                <TableCell>Employee</TableCell>
                <TableCell align="right">Gross</TableCell>
                <TableCell align="right">EPF</TableCell>
                <TableCell align="right">APIT</TableCell>
                <TableCell align="right">Net</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {detail.payroll_records.slice(0, 10).map((record: EmployeePayroll) => (
                <TableRow key={record.id} sx={modernTableStyles.bodyRow}>
                  <TableCell>{record.employee_id}</TableCell>
                  <TableCell align="right">Rs. {fmtLKR(record.gross_salary || 0)}</TableCell>
                  <TableCell align="right">Rs. {fmtLKR(record.less_epf_employee || 0)}</TableCell>
                  <TableCell align="right">Rs. {fmtLKR(record.less_apit || 0)}</TableCell>
                  <TableCell align="right">Rs. {fmtLKR(record.net_salary || 0)}</TableCell>
                </TableRow>
              ))}
              {detail.payroll_records.length > 10 && (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    <Typography variant="body2" color="text.secondary">
                      ... and {detail.payroll_records.length - 10} more employees
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </FormSection>
      )}

      {detail.status === "rejected" && (
        <Alert severity="error" sx={{ mt: 2 }}>
          <Typography variant="subtitle2">Batch Rejected</Typography>
          <Typography variant="body2">This payroll batch was rejected and needs to be corrected.</Typography>
        </Alert>
      )}

      {/* Record Information */}
      <FormSection title="Record Information" columns={2}>
        <Box>
          <Typography variant="caption" color="text.secondary">Created</Typography>
          <Typography variant="body2">{formatDateTimeReadable(detail.created_at) || "-"}</Typography>
        </Box>
      </FormSection>
    </Box>
  ) : (
    <EmptyState message="Select a payroll batch from the list to view details" />
  );

  return (
    <>
      <MasterDetailLayout
        title="Payroll Approvals"
        icon={<AccountBalanceWalletIcon />}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onClose={() => setRejectDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Reject Payroll Batch</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Rejection Reason"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            multiline
            rows={3}
            sx={{ mt: 2 }}
            required
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => selectedBatch && rejectMutation.mutate({ id: selectedBatch.id, reason: rejectReason })}
            disabled={!rejectReason.trim() || rejectMutation.isPending}
          >
            Reject
          </Button>
        </DialogActions>
      </Dialog>

      <TConfirmDialog {...approveDialog.dialogProps} />
    </>
  );
}
