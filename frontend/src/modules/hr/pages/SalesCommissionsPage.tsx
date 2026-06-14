/**
 * SalesCommissionsPage - Scenario 28A
 * Sales Officer Monthly Commission Calculation and Management
 * 
 * Workflow:
 * 1. Generate monthly branch sales summary from invoices
 * 2. Finance reviews and finalizes summary
 * 3. Calculate individual commissions for Sales Officers
 * 4. Finance Manager approves commissions
 * 5. Commissions included in payroll
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  LinearProgress,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  Alert,
  Tab,
  Tabs,
} from "@mui/material";
import {
  Add as AddIcon,
  CheckCircle as ApproveIcon,
  Cancel as RejectIcon,
  Calculate as CalculateIcon,
  Refresh as RefreshIcon,
  Done as FinalizeIcon,
  Payment as PaymentIcon,
  TrendingUp as ProfitIcon,
  Assessment as SummaryIcon,
  Groups as TeamIcon,
  Store as BranchIcon,
} from "@mui/icons-material";

// Tijaero components
import {
  EmptyState,
  fmtLKR,
  TBranchFilter,
  TCurrency,
  TExportButton,
  TStatCard,
  TStatusChip,
  handleApiError,
  modernTableStyles,
  showErrorToast,
  showSuccessToast,
  TConfirmDialog,
  useConfirmDialog,
  type TFilterBranch,
} from "@/components/tijaero";

import { useReferenceData } from "@/hooks";
import { salesSummaryApi, salesCommissionApi } from "@/modules/hr/api";
import type {
  MonthlyBranchSalesSummary,
  SalesOfficerCommission,
  GenerateSalesSummaryRequest,
} from "@/modules/hr/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

const SUMMARY_STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "finalized", label: "Finalized" },
  { value: "commission_calculated", label: "Commissions Calculated" },
];

const COMMISSION_STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "pending", label: "Pending Approval" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "paid", label: "Paid" },
];

interface StatusChipConfig {
  label: string;
  statusMap: "orderStatus" | "payrollStatus" | "commissionStatus" | "paymentStatus";
}

const getStatusConfig = (status: string): StatusChipConfig => {
  const configMap: Record<string, StatusChipConfig> = {
    draft: { label: "Draft", statusMap: "orderStatus" },
    finalized: { label: "Finalized", statusMap: "orderStatus" },
    commission_calculated: { label: "Commissions Calculated", statusMap: "orderStatus" },
    pending: { label: "Pending Approval", statusMap: "commissionStatus" },
    approved: { label: "Approved", statusMap: "commissionStatus" },
    rejected: { label: "Rejected", statusMap: "commissionStatus" },
    paid: { label: "Paid", statusMap: "commissionStatus" },
  };
  return configMap[status] || { label: status, statusMap: "orderStatus" };
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function SalesCommissionsPage() {
  const queryClient = useQueryClient();
  const { filteredBranches, defaultBranchCode } = useReferenceData();
  const confirmDialog = useConfirmDialog();

  // Convert branches to the format expected by TBranchFilter
  const branchOptions: TFilterBranch[] = filteredBranches.map((b) => ({
    branch_code: b.branch_code,
    branch_name: b.branch_name,
  }));

  // Tab State
  const [activeTab, setActiveTab] = useState<number>(0);

  // Filter State
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedStatus, setSelectedStatus] = useState<string>("all");

  // Auto-default branch filter for non-superuser users
  useEffect(() => {
    if (defaultBranchCode && selectedBranch === null) {
      setSelectedBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Generate Dialog State
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [generateBranch, setGenerateBranch] = useState<string>("");
  const [generateYear, setGenerateYear] = useState<number>(new Date().getFullYear());
  const [generateMonth, setGenerateMonth] = useState<number>(new Date().getMonth() + 1);

  // Calculate Commissions Dialog State
  const [calcDialogOpen, setCalcDialogOpen] = useState(false);
  const [calcSummaryId, setCalcSummaryId] = useState<number | null>(null);
  const [commissionPercentage, setCommissionPercentage] = useState<number>(2.5);

  // Approve/Reject Dialog State
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [selectedCommissionId, setSelectedCommissionId] = useState<number | null>(null);
  const [approveRemarks, setApproveRemarks] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  const { data: dashboardStats } = useQuery({
    queryKey: ["salesCommission", "stats"],
    queryFn: salesCommissionApi.getDashboardStats,
  });

  const { data: summaries = [], isLoading: summariesLoading, refetch: refetchSummaries } = useQuery({
    queryKey: ["salesCommission", "summaries", selectedBranch, selectedYear, selectedMonth, selectedStatus],
    queryFn: () =>
      salesSummaryApi.getAll({
        branch_code: selectedBranch || undefined,
        fiscal_year: selectedYear,
        fiscal_month: selectedMonth || undefined,
        status: selectedStatus === "all" ? undefined : selectedStatus,
      }),
  });

  const { data: commissions = [], isLoading: commissionsLoading, refetch: refetchCommissions } = useQuery({
    queryKey: ["salesCommission", "commissions", selectedBranch, selectedYear, selectedMonth, selectedStatus],
    queryFn: () =>
      salesCommissionApi.getAll({
        branch_code: selectedBranch || undefined,
        fiscal_year: selectedYear,
        fiscal_month: selectedMonth || undefined,
        status: selectedStatus === "all" ? undefined : selectedStatus,
      }),
    enabled: activeTab === 1,
  });

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const generateMutation = useMutation({
    mutationFn: (data: GenerateSalesSummaryRequest) => salesSummaryApi.generate(data),
    onSuccess: (data) => {
      showSuccessToast(`Generated ${data.length} monthly summary(ies)`);
      setGenerateDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["salesCommission"] });
    },
    onError: (error) => handleApiError(error, "Failed to generate summary"),
  });

  const finalizeMutation = useMutation({
    mutationFn: (id: number) => salesSummaryApi.finalize(id),
    onSuccess: () => {
      showSuccessToast("Summary finalized successfully");
      queryClient.invalidateQueries({ queryKey: ["salesCommission"] });
    },
    onError: (error) => handleApiError(error, "Failed to finalize summary"),
  });

  const calculateCommissionsMutation = useMutation({
    mutationFn: ({ id, percentage }: { id: number; percentage?: number }) =>
      salesSummaryApi.calculateCommissions(id, percentage),
    onSuccess: (data) => {
      showSuccessToast(`Calculated ${data.length} commission(s)`);
      setCalcDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["salesCommission"] });
    },
    onError: (error) => handleApiError(error, "Failed to calculate commissions"),
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, remarks }: { id: number; remarks?: string }) =>
      salesCommissionApi.approve(id, { remarks }),
    onSuccess: () => {
      showSuccessToast("Commission approved");
      setApproveDialogOpen(false);
      setSelectedCommissionId(null);
      setApproveRemarks("");
      queryClient.invalidateQueries({ queryKey: ["salesCommission"] });
    },
    onError: (error) => handleApiError(error, "Failed to approve commission"),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      salesCommissionApi.reject(id, { rejection_reason: reason }),
    onSuccess: () => {
      showSuccessToast("Commission rejected");
      setRejectDialogOpen(false);
      setSelectedCommissionId(null);
      setRejectReason("");
      queryClient.invalidateQueries({ queryKey: ["salesCommission"] });
    },
    onError: (error) => handleApiError(error, "Failed to reject commission"),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: (ids: number[]) => salesCommissionApi.bulkApprove({ commission_ids: ids }),
    onSuccess: (data) => {
      showSuccessToast(`Approved ${data.length} commission(s)`);
      queryClient.invalidateQueries({ queryKey: ["salesCommission"] });
    },
    onError: (error) => handleApiError(error, "Failed to bulk approve"),
  });

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleGenerateSummary = () => {
    generateMutation.mutate({
      fiscal_year: generateYear,
      fiscal_month: generateMonth,
      branch_code: generateBranch || undefined,
    });
  };

  const handleFinalizeSummary = (summary: MonthlyBranchSalesSummary) => {
    confirmDialog.open(
      "Finalize Summary",
      `Are you sure you want to finalize the sales summary for ${summary.month_name} (${summary.branch_name || summary.branch_code})? This action cannot be undone.`,
      () => finalizeMutation.mutate(summary.id)
    );
  };

  const handleOpenCalculateDialog = (summary: MonthlyBranchSalesSummary) => {
    setCalcSummaryId(summary.id);
    setCalcDialogOpen(true);
  };

  const handleCalculateCommissions = () => {
    if (calcSummaryId) {
      calculateCommissionsMutation.mutate({
        id: calcSummaryId,
        percentage: commissionPercentage,
      });
    }
  };

  const handleApproveCommission = (commission: SalesOfficerCommission) => {
    setSelectedCommissionId(commission.id);
    setApproveDialogOpen(true);
  };

  const handleRejectCommission = (commission: SalesOfficerCommission) => {
    setSelectedCommissionId(commission.id);
    setRejectDialogOpen(true);
  };

  const handleBulkApprove = () => {
    const pendingIds = commissions
      .filter((c) => c.status === "pending")
      .map((c) => c.id);
    if (pendingIds.length === 0) {
      showErrorToast("No pending commissions to approve");
      return;
    }
    confirmDialog.open(
      "Bulk Approve",
      `Approve all ${pendingIds.length} pending commissions?`,
      () => bulkApproveMutation.mutate(pendingIds)
    );
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const renderDashboard = () => (
    <Grid container spacing={2} sx={{ mb: 3 }}>
      <Grid item xs={12} sm={6} md={2.4}>
        <TStatCard
          title="Pending Summaries"
          value={dashboardStats?.total_summaries_pending || 0}
          icon={<SummaryIcon />}
          color="warning"
        />
      </Grid>
      <Grid item xs={12} sm={6} md={2.4}>
        <TStatCard
          title="Finalized Summaries"
          value={dashboardStats?.total_summaries_finalized || 0}
          icon={<SummaryIcon />}
          color="info"
        />
      </Grid>
      <Grid item xs={12} sm={6} md={2.4}>
        <TStatCard
          title="Pending Commissions"
          value={dashboardStats?.total_commissions_pending || 0}
          subtitle={fmtLKR(dashboardStats?.total_pending_amount || 0)}
          icon={<ProfitIcon />}
          color="warning"
        />
      </Grid>
      <Grid item xs={12} sm={6} md={2.4}>
        <TStatCard
          title="Approved"
          value={dashboardStats?.total_commissions_approved || 0}
          subtitle={fmtLKR(dashboardStats?.total_approved_amount || 0)}
          icon={<ApproveIcon />}
          color="success"
        />
      </Grid>
      <Grid item xs={12} sm={6} md={2.4}>
        <TStatCard
          title="Paid"
          value={dashboardStats?.total_commissions_paid || 0}
          subtitle={fmtLKR(dashboardStats?.total_paid_amount || 0)}
          icon={<PaymentIcon />}
          color="success"
        />
      </Grid>
    </Grid>
  );

  const renderFilters = () => (
    <Box sx={{ display: "flex", gap: 2, mb: 2, flexWrap: "wrap", alignItems: "center" }}>
      <TBranchFilter
        branches={branchOptions}
        value={selectedBranch}
        onChange={setSelectedBranch}
      />
      <TextField
        select
        label="Year"
        value={selectedYear}
        onChange={(e) => setSelectedYear(Number(e.target.value))}
        size="small"
        sx={{ minWidth: 100 }}
      >
        {[2024, 2025, 2026, 2027].map((y) => (
          <MenuItem key={y} value={y}>
            {y}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="Month"
        value={selectedMonth}
        onChange={(e) => setSelectedMonth(Number(e.target.value))}
        size="small"
        sx={{ minWidth: 120 }}
      >
        <MenuItem value={0}>All Months</MenuItem>
        {MONTHS.map((m) => (
          <MenuItem key={m.value} value={m.value}>
            {m.label}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="Status"
        value={selectedStatus}
        onChange={(e) => setSelectedStatus(e.target.value)}
        size="small"
        sx={{ minWidth: 150 }}
      >
        {(activeTab === 0 ? SUMMARY_STATUS_FILTER_OPTIONS : COMMISSION_STATUS_FILTER_OPTIONS).map((opt) => (
          <MenuItem key={opt.value} value={opt.value}>
            {opt.label}
          </MenuItem>
        ))}
      </TextField>
      <Button
        startIcon={<RefreshIcon />}
        onClick={() => {
          refetchSummaries();
          refetchCommissions();
        }}
        variant="outlined"
        size="small"
      >
        Refresh
      </Button>
    </Box>
  );

  const renderSummariesTab = () => (
    <>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2 }}>
        <Typography variant="h6">Monthly Branch Sales Summaries</Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          <TExportButton
            filename="branch_sales_summaries"
            headers={[
              "Branch",
              "Period",
              "Invoices",
              "Revenue",
              "COGS",
              "Returns",
              "Discounts",
              "Gross Profit",
              "Margin %",
              "Status",
            ]}
            rows={() =>
              summaries.map((s) => [
                s.branch_name || s.branch_code || "",
                s.month_name || "",
                s.total_invoices ?? 0,
                s.total_sales_revenue ?? 0,
                s.total_sales_cost ?? 0,
                s.total_sales_returns ?? 0,
                s.total_discounts ?? 0,
                s.gross_profit ?? 0,
                s.gross_profit_margin ?? 0,
                s.status || "",
              ])
            }
            disabled={summaries.length === 0}
          />
          <Button
            startIcon={<AddIcon />}
            variant="contained"
            onClick={() => setGenerateDialogOpen(true)}
          >
            Generate Summary
          </Button>
        </Box>
      </Box>

      {summariesLoading && <LinearProgress sx={{ mb: 2 }} />}

      {summaries.length === 0 && !summariesLoading ? (
        <EmptyState
          message="Generate a monthly sales summary to calculate commissions"
          action={{
            label: "Generate Summary",
            onClick: () => setGenerateDialogOpen(true),
          }}
        />
      ) : (
        <Table size="small" sx={modernTableStyles}>
          <TableHead>
            <TableRow>
              <TableCell>Branch</TableCell>
              <TableCell>Period</TableCell>
              <TableCell align="right">Invoices</TableCell>
              <TableCell align="right">Revenue</TableCell>
              <TableCell align="right">COGS</TableCell>
              <TableCell align="right">Returns</TableCell>
              <TableCell align="right">Discounts</TableCell>
              <TableCell align="right">Gross Profit</TableCell>
              <TableCell align="right">Margin %</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {summaries.map((summary) => {
              const statusConfig = getStatusConfig(summary.status);
              return (
                <TableRow key={summary.id} hover>
                  <TableCell>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <BranchIcon fontSize="small" color="action" />
                      {summary.branch_name || summary.branch_code}
                    </Box>
                  </TableCell>
                  <TableCell>{summary.month_name}</TableCell>
                  <TableCell align="right">{summary.total_invoices || 0}</TableCell>
                  <TableCell align="right">
                    <TCurrency value={summary.total_sales_revenue} />
                  </TableCell>
                  <TableCell align="right">
                    <TCurrency value={summary.total_sales_cost} />
                  </TableCell>
                  <TableCell align="right">
                    <TCurrency value={summary.total_sales_returns} />
                  </TableCell>
                  <TableCell align="right">
                    <TCurrency value={summary.total_discounts} />
                  </TableCell>
                  <TableCell align="right">
                    <Typography
                      color={summary.gross_profit >= 0 ? "success.main" : "error.main"}
                      fontWeight="bold"
                    >
                      <TCurrency value={summary.gross_profit} />
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    {summary.gross_profit_margin?.toFixed(2)}%
                  </TableCell>
                  <TableCell>
                    <TStatusChip status={summary.status} statusMap={statusConfig.statusMap} />
                  </TableCell>
                  <TableCell align="center">
                    {summary.status === "draft" && (
                      <Tooltip title="Finalize Summary">
                        <IconButton
                          size="small"
                          color="info"
                          onClick={() => handleFinalizeSummary(summary)}
                        >
                          <FinalizeIcon />
                        </IconButton>
                      </Tooltip>
                    )}
                    {(summary.status === "finalized" || summary.status === "commission_calculated") && (
                      <Tooltip title="Calculate Commissions">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => handleOpenCalculateDialog(summary)}
                        >
                          <CalculateIcon />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </>
  );

  const renderCommissionsTab = () => (
    <>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2 }}>
        <Typography variant="h6">Sales Officer Commissions</Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          <TExportButton
            filename="officer_commissions"
            headers={[
              "Employee",
              "Branch",
              "Period",
              "Branch Profit",
              "Commission %",
              "Pool",
              "Officers",
              "Amount",
              "Status",
            ]}
            rows={() =>
              commissions.map((c) => [
                c.employee_name || `Employee #${c.employee_id}`,
                c.branch_name || c.branch_code || "",
                c.month_name || "",
                c.branch_gross_profit ?? 0,
                c.commission_percentage ?? 0,
                c.total_commission_pool ?? 0,
                c.total_branch_employees ?? 0,
                c.individual_commission_amount ?? 0,
                c.status || "",
              ])
            }
            disabled={commissions.length === 0}
          />
          <Button
            startIcon={<ApproveIcon />}
            variant="contained"
            color="success"
            onClick={handleBulkApprove}
            disabled={commissions.filter((c) => c.status === "pending").length === 0}
          >
            Approve All Pending
          </Button>
        </Box>
      </Box>

      {commissionsLoading && <LinearProgress sx={{ mb: 2 }} />}

      {commissions.length === 0 && !commissionsLoading ? (
        <EmptyState
          message="Commissions will appear after calculating from finalized summaries"
        />
      ) : (
        <Table size="small" sx={modernTableStyles}>
          <TableHead>
            <TableRow>
              <TableCell>Employee</TableCell>
              <TableCell>Branch</TableCell>
              <TableCell>Period</TableCell>
              <TableCell align="right">Branch Profit</TableCell>
              <TableCell align="right">Commission %</TableCell>
              <TableCell align="right">Pool</TableCell>
              <TableCell align="center">Officers</TableCell>
              <TableCell align="right">Amount</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {commissions.map((commission) => {
              const statusConfig = getStatusConfig(commission.status);
              return (
                <TableRow key={commission.id} hover>
                  <TableCell>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <TeamIcon fontSize="small" color="action" />
                      {commission.employee_name || `Employee #${commission.employee_id}`}
                    </Box>
                  </TableCell>
                  <TableCell>{commission.branch_name || commission.branch_code}</TableCell>
                  <TableCell>{commission.month_name}</TableCell>
                  <TableCell align="right">
                    <TCurrency value={commission.branch_gross_profit} />
                  </TableCell>
                  <TableCell align="right">{commission.commission_percentage}%</TableCell>
                  <TableCell align="right">
                    <TCurrency value={commission.total_commission_pool} />
                  </TableCell>
                  <TableCell align="center">{commission.total_branch_employees}</TableCell>
                  <TableCell align="right">
                    <Typography fontWeight="bold" color="success.main">
                      <TCurrency value={commission.individual_commission_amount} />
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <TStatusChip status={commission.status} statusMap={statusConfig.statusMap} />
                  </TableCell>
                  <TableCell align="center">
                    {commission.status === "pending" && (
                      <>
                        <Tooltip title="Approve">
                          <IconButton
                            size="small"
                            color="success"
                            onClick={() => handleApproveCommission(commission)}
                          >
                            <ApproveIcon />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Reject">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleRejectCommission(commission)}
                          >
                            <RejectIcon />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                    {commission.status === "approved" && (
                      <Tooltip title="Ready for Payroll">
                        <PaymentIcon fontSize="small" color="success" />
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </>
  );

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" sx={{ mb: 3 }}>
        Sales Officer Commission Management
      </Typography>

      {renderDashboard()}

      <Card>
        <CardContent>
          <Tabs
            value={activeTab}
            onChange={(_, newValue) => {
              setActiveTab(newValue);
              setSelectedStatus("all");
            }}
            sx={{ mb: 2 }}
          >
            <Tab label="Branch Sales Summaries" icon={<SummaryIcon />} iconPosition="start" />
            <Tab label="Officer Commissions" icon={<TeamIcon />} iconPosition="start" />
          </Tabs>

          {renderFilters()}

          {activeTab === 0 && renderSummariesTab()}
          {activeTab === 1 && renderCommissionsTab()}
        </CardContent>
      </Card>

      {/* Generate Summary Dialog */}
      <Dialog open={generateDialogOpen} onClose={() => setGenerateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Generate Monthly Sales Summary</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Generate sales summary from invoices for the selected period. This calculates revenue, COGS, returns, discounts, and gross profit.
          </Typography>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                select
                fullWidth
                label="Branch (Optional)"
                value={generateBranch}
                onChange={(e) => setGenerateBranch(e.target.value)}
                helperText="Leave empty to generate for all branches"
              >
                <MenuItem value="">All Branches</MenuItem>
                {branchOptions.map((b) => (
                  <MenuItem key={b.branch_code} value={b.branch_code}>
                    {b.branch_name}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={6}>
              <TextField
                select
                fullWidth
                label="Year"
                value={generateYear}
                onChange={(e) => setGenerateYear(Number(e.target.value))}
              >
                {[2024, 2025, 2026, 2027].map((y) => (
                  <MenuItem key={y} value={y}>
                    {y}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={6}>
              <TextField
                select
                fullWidth
                label="Month"
                value={generateMonth}
                onChange={(e) => setGenerateMonth(Number(e.target.value))}
              >
                {MONTHS.map((m) => (
                  <MenuItem key={m.value} value={m.value}>
                    {m.label}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGenerateDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleGenerateSummary}
            disabled={generateMutation.isPending}
          >
            {generateMutation.isPending ? "Generating..." : "Generate"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Calculate Commissions Dialog */}
      <Dialog open={calcDialogOpen} onClose={() => setCalcDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Calculate Sales Officer Commissions</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Calculate individual commissions for each Sales Officer in the branch.
            <br />
            <strong>Formula:</strong> Individual = (Branch Gross Profit × Commission %) ÷ Number of Sales Officers
          </Typography>
          <TextField
            fullWidth
            label="Commission Percentage"
            type="number"
            value={commissionPercentage}
            onChange={(e) => setCommissionPercentage(Number(e.target.value))}
            inputProps={{ min: 0, max: 100, step: 0.1 }}
            helperText="Default: 2.5%"
            sx={{ mt: 2 }}
          />
          <Alert severity="info" sx={{ mt: 2 }}>
            No commission will be calculated if the branch made a loss (gross profit ≤ 0).
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCalcDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCalculateCommissions}
            disabled={calculateCommissionsMutation.isPending}
          >
            {calculateCommissionsMutation.isPending ? "Calculating..." : "Calculate"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Approve Dialog */}
      <Dialog open={approveDialogOpen} onClose={() => setApproveDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Approve Commission</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Approve this commission for payroll inclusion.
          </Typography>
          <TextField
            fullWidth
            label="Remarks (Optional)"
            value={approveRemarks}
            onChange={(e) => setApproveRemarks(e.target.value)}
            multiline
            rows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApproveDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="success"
            onClick={() => {
              if (selectedCommissionId) {
                approveMutation.mutate({ id: selectedCommissionId, remarks: approveRemarks });
              }
            }}
            disabled={approveMutation.isPending}
          >
            {approveMutation.isPending ? "Approving..." : "Approve"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onClose={() => setRejectDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Reject Commission</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Please provide a reason for rejecting this commission.
          </Typography>
          <TextField
            fullWidth
            required
            label="Rejection Reason"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            multiline
            rows={3}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              if (selectedCommissionId && rejectReason.trim()) {
                rejectMutation.mutate({ id: selectedCommissionId, reason: rejectReason });
              }
            }}
            disabled={rejectMutation.isPending || !rejectReason.trim()}
          >
            {rejectMutation.isPending ? "Rejecting..." : "Reject"}
          </Button>
        </DialogActions>
      </Dialog>

      <TConfirmDialog {...confirmDialog.dialogProps} />
    </Box>
  );
}
