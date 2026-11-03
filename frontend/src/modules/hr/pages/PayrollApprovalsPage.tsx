/**
 * PayrollApprovalsPage - Payroll Batch Approval Workflow (Gap F1)
 *
 * Shows payroll batches pending approval.
 * Follows MasterDetail pattern with approve/reject actions.
 */

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import SearchIcon from "@mui/icons-material/Search";
import {
  Alert,
  Box,
  Button,
  InputAdornment,
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
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDateTimeReadable } from "@/utils/formatters";

import {
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  fmtLKR,
  FormSection,
  getStatusProps,
  handleApiError,
  MasterDetailLayout,
  modernTableStyles,
  TDataGrid,
  type TDataGridColumn,
  TStatusFilter,
  TBranchFilter,
  TStatCard,
  TStatusChip,
  showErrorToast,
  showSuccessToast,
  TConfirmDialog,
  TDetailSkeleton,
  TSidePanel,
  useConfirmDialog,
} from "@/components/tijaero";

import { useReferenceData } from "@/hooks";
import { payrollBatchApi } from "@/modules/hr/api";
import { usePermission } from "@/auth/permissions";
import type { PayrollBatch, EmployeePayroll } from "@/modules/hr/types";
import { useCurrencyStore } from "@/state/currencyStore";

// ─── Configuration ───────────────────────────────────────────────────────────

const STATUS_FILTER_OPTIONS = [
  { value: "pending_approval", label: "Pending Approval" },
  { value: "approved", label: "Approved" },
  { value: "draft", label: "Returned to Draft" },
  { value: "salary_paid", label: "Salary Paid" },
  { value: "statutory_paid", label: "Statutory Paid" },
  { value: "completed", label: "Completed" },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function PayrollApprovalsPage() {
  const queryClient = useQueryClient();
  const canApprove = usePermission("payroll_approvals", "approve");
  const currencySymbol = useCurrencyStore((s) => s.symbol);

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("pending_approval");
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<PayrollBatch | null>(null);

  // Dialogs
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const approveDialog = useConfirmDialog();

  // Ref data
  const { filteredBranches, defaultBranchCode } = useReferenceData(["branches"]);
  const branches = filteredBranches || [];

  // Auto-default branch filter for non-superuser users
  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterStatus("");
    setFilterBranch(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  // ─── Data Fetching ─────────────────────────────────────────────────────────────────

  const { data: batches = [], isLoading, refetch } = useQuery({
    queryKey: ["payroll-approvals", filterStatus, filterBranch],
    queryFn: () =>
      payrollBatchApi.getAll({
        status: filterStatus || undefined,
        limit: 500,
      }),
    enabled: branchResolved,
    placeholderData: (prev) => prev,
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
    filtered.sort((a, b) => new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime() || (b.id || 0) - (a.id || 0));
    return filtered;
  }, [batches, searchQuery]);

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["payroll-approvals"] });
    queryClient.invalidateQueries({ queryKey: ["payroll-approval-detail"] });
    queryClient.invalidateQueries({ queryKey: ["payroll-batches"] });
    queryClient.invalidateQueries({ queryKey: ["payroll"] });
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
      `Approve payroll batch ${selectedBatch.batch_no} with ${selectedBatch.total_employees || 0} employees and total net salary of ${currencySymbol} ${fmtLKR(selectedBatch.total_net_salary || 0)}?`,
      () => {
        if (!approveMutation.isPending) approveMutation.mutate(selectedBatch.id);
      }
    );
  }, [selectedBatch, approveDialog, approveMutation, currencySymbol]);

  const formatPeriod = (month?: number, year?: number) => {
    if (!month || !year) return "-";
    const date = new Date(year, month - 1, 1);
    return format(date, "MMMM yyyy");
  };

  // ─── Master Panel ──────────────────────────────────────────────────────────

  const columns: TDataGridColumn<PayrollBatch>[] = useMemo(
    () => [
      { field: "batch_no", header: "Batch No", width: 170 },
      { field: "payroll_month", header: "Period", width: 160, renderCell: (p: GridRenderCellParams<PayrollBatch>) => formatPeriod(p.row.payroll_month, p.row.payroll_year) },
      { field: "total_employees", header: "Employees", width: 110, align: "right", headerAlign: "right", renderCell: (p: GridRenderCellParams<PayrollBatch>) => p.row.total_employees || 0 },
      { field: "total_net_salary", header: "Net Salary", flex: 1, minWidth: 150, align: "right", headerAlign: "right", renderCell: (p: GridRenderCellParams<PayrollBatch>) => `${currencySymbol} ${fmtLKR(p.row.total_net_salary || 0)}` },
      { field: "status", header: "Status", width: 160, renderCell: (p: GridRenderCellParams<PayrollBatch>) => <TStatusChip status={p.row.status} statusMap="payrollStatus" size="small" /> },
    ],
    [currencySymbol]
  );

  const tablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<PayrollBatch>
          rows={filteredBatches}
          columns={columns}
          loading={isLoading}
          onRowClick={(row) => setSelectedBatch(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No payroll batches match your filters"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // ─── Detail Panel ──────────────────────────────────────────────────────────

  const detail = batchDetail || selectedBatch;

  const detailStatus = detail ? getStatusProps(detail.status, "payrollStatus") : null;
  const actionPending = approveMutation.isPending || rejectMutation.isPending;

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "HR" },
          { label: "Approvals", href: "/hr/approvals" },
          { label: "Payroll Approvals", href: "/hr/approvals/payroll-approvals" },
          ...(detail ? [{ label: detail.batch_no }] : []),
        ]}
        title={detail?.batch_no || ""}
        subtitle={detail ? `${formatPeriod(detail.payroll_month, detail.payroll_year)} • ${detail.total_employees || 0} employees` : undefined}
        titleIcon={<AccountBalanceWalletIcon color="primary" />}
        noSelectionTitle="Select a Payroll Batch"
        chips={detailStatus ? [{ label: detailStatus.label, color: detailStatus.color }] : []}
      />

      {/* Approve / Reject on the right, as on PO Approvals */}
      {detail && detail.status === "pending_approval" && canApprove && (
        <ActionToolbar
          hasSelectedItem
          isCreating={false}
          isEditing={false}
          canCreate={false}
          canDuplicate={false}
          canDelete={false}
          endActions={
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Button
                size="small"
                variant="contained"
                color="success"
                startIcon={<CheckCircleIcon />}
                onClick={handleApprove}
                disabled={actionPending}
              >
                Approve
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<CancelIcon />}
                onClick={() => setRejectDialogOpen(true)}
                disabled={actionPending}
              >
                Reject
              </Button>
            </Box>
          }
        />
      )}

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
      {isDetailLoading && selectedBatch ? (
        <TDetailSkeleton sections={3} fieldsPerSection={4} showTable showHeader={false} showToolbar={false} />
      ) : detail ? (
      <>
      {/* Summary Stats */}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", md: "repeat(4, 1fr)" }, gap: 2, mb: 2 }}>
        <TStatCard
          title="Gross Salary"
          value={`${currencySymbol} ${fmtLKR(detail.total_gross_salary || 0)}`}
          color="primary"
        />
        <TStatCard
          title="Net Salary"
          value={`${currencySymbol} ${fmtLKR(detail.total_net_salary || 0)}`}
          color="success"
        />
        <TStatCard
          title="Total EPF"
          value={`${currencySymbol} ${fmtLKR(Number(detail.total_employer_epf || 0))}`}
          color="warning"
        />
        <TStatCard
          title="Total ETF"
          value={`${currencySymbol} ${fmtLKR(Number(detail.total_employer_etf || 0))}`}
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
            <Typography>{currencySymbol} {fmtLKR(detail.total_deductions || 0)}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Employer EPF (12%)</Typography>
            <Typography>{currencySymbol} {fmtLKR(detail.total_employer_epf || 0)}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Employer ETF (3%)</Typography>
            <Typography>{currencySymbol} {fmtLKR(detail.total_employer_etf || 0)}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Total APIT</Typography>
            <Typography>{currencySymbol} {fmtLKR(detail.total_apit || 0)}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Total Employer Cost</Typography>
            <Typography fontWeight="bold">{currencySymbol} {fmtLKR(detail.total_employer_cost || 0)}</Typography>
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
                  <TableCell align="right">{currencySymbol} {fmtLKR(record.gross_salary || 0)}</TableCell>
                  <TableCell align="right">{currencySymbol} {fmtLKR(record.less_epf_employee || 0)}</TableCell>
                  <TableCell align="right">{currencySymbol} {fmtLKR(record.less_apit || 0)}</TableCell>
                  <TableCell align="right">{currencySymbol} {fmtLKR(record.net_salary || 0)}</TableCell>
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

      {detail.status === "draft" && (detail.description || "").includes("[Rejected:") && (
        <Alert severity="error" sx={{ mt: 2 }}>
          <Typography variant="subtitle2">Batch Rejected</Typography>
          <Typography variant="body2">This payroll batch was rejected and needs to be corrected.</Typography>
        </Alert>
      )}

      {/* Activity History */}
      <FormSection title="Activity History" columns={2} isLast>
        <Box>
          <Typography variant="caption" color="text.secondary">Created</Typography>
          <Typography variant="body2">{formatDateTimeReadable(detail.created_at) || "-"}</Typography>
        </Box>
      </FormSection>
      </>
      ) : (
        <EmptyState message="Select a payroll batch from the list to view details" />
      )}
      </Box>
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title="Payroll Approvals"
        icon={<AccountBalanceWalletIcon />}
        titleSlot={
          selectedBatch ? (
            <Button size="small" startIcon={<ArrowBackIcon fontSize="small" />} onClick={() => setSelectedBatch(null)} sx={{ textTransform: "none" }}>
              Back to Payroll Approvals
            </Button>
          ) : (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <TextField
              size="small"
              placeholder="Search by batch no, description..."
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
            <Box sx={{ width: 170, flexShrink: 0, "& .MuiOutlinedInput-root": { borderRadius: "24px" } }}>
              <TBranchFilter
                branches={branches}
                value={filterBranch}
                onChange={setFilterBranch}
                label=""
                placeholder="All Branches"
                size="small"
              />
            </Box>
            <Box sx={{ width: 180, flexShrink: 0 }}>
              <TStatusFilter
                options={[{ value: null, label: "All Statuses" }, ...(STATUS_FILTER_OPTIONS).filter((opt) => opt.value).map((opt) => ({ value: opt.value as string, label: opt.label }))]}
                value={filterStatus || null}
                onChange={(v) => setFilterStatus(v ?? "")}
                label=""
                placeholder="All Statuses"
                size="small"
              />
            </Box>
            {(searchQuery || filterStatus || filterBranch) && (
              <Button size="small" onClick={handleClearFilters} sx={{ textTransform: "none" }}>
                Clear
              </Button>
            )}
          </Box>
          )
        }
        isLoading={isLoading}
        onRefresh={() => refetch?.()}
      >
        {selectedBatch ? detailPanel : tablePanel}
      </MasterDetailLayout>

      {/* Reject Dialog */}
      <TSidePanel
        open={rejectDialogOpen}
        onClose={() => setRejectDialogOpen(false)}
        title={`Reject Payroll Batch${selectedBatch ? ` — ${selectedBatch.batch_no}` : ""}`}
        onSubmit={() => {
          if (selectedBatch && rejectReason.trim() && !rejectMutation.isPending) {
            rejectMutation.mutate({ id: selectedBatch.id, reason: rejectReason });
          }
        }}
        isSubmitting={rejectMutation.isPending}
        submitDisabled={!rejectReason.trim() || rejectMutation.isPending}
        submitText="Reject"
      >
        <FormSection title="Reason" columns={1} isLast>
          <TextField
            fullWidth
            size="small"
            label="Rejection Reason"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            multiline
            rows={3}
            required
          />
        </FormSection>
      </TSidePanel>

      <TConfirmDialog {...approveDialog.dialogProps} />
    </>
  );
}
