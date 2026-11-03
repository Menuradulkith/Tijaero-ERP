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
 *
 * Layout: browse table + full-page detail (same pattern as Purchasing / Sales).
 */

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Button,
  IconButton,
  InputAdornment,
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
} from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import {
  Add as AddIcon,
  ArrowBack as ArrowBackIcon,
  CheckCircle as ApproveIcon,
  Cancel as RejectIcon,
  Calculate as CalculateIcon,
  Done as FinalizeIcon,
  OpenInNew as OpenInNewIcon,
  Payment as PaymentIcon,
  Search as SearchIcon,
  Assessment as SummaryIcon,
  Groups as TeamIcon,
} from "@mui/icons-material";

// Tijaero components
import {
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  FormSection,
  MasterDetailLayout,
  TBranchFilter,
  TCurrency,
  TDataGrid,
  TDetailSkeleton,
  TExportButton,
  TSidePanel,
  TStatusChip,
  TStatusFilter,
  TTabs,
  fmtLKR,
  getStatusProps,
  handleApiError,
  modernTableStyles,
  showErrorToast,
  showSuccessToast,
  TConfirmDialog,
  useConfirmDialog,
  type TDataGridColumn,
  type TFilterBranch,
  type TFilterStatusOption,
  TRemarkField,
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

const YEARS = [2024, 2025, 2026, 2027];

const SUMMARY_STATUS_FILTER_OPTIONS: TFilterStatusOption[] = [
  { value: null, label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "finalized", label: "Finalized" },
  { value: "commission_calculated", label: "Commissions Calculated" },
];

const COMMISSION_STATUS_FILTER_OPTIONS: TFilterStatusOption[] = [
  { value: null, label: "All Statuses" },
  { value: "pending", label: "Pending Approval" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "paid", label: "Paid" },
];

type ViewTab = "summaries" | "commissions";

const VIEW_TABS = [
  { id: "summaries", label: "Monthly summaries", icon: <SummaryIcon fontSize="small" /> },
  { id: "commissions", label: "Officer commissions", icon: <TeamIcon fontSize="small" /> },
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

const renderStatusChip = (status: string) => {
  const cfg = getStatusConfig(status);
  return <TStatusChip status={status} statusMap={cfg.statusMap} fallbackLabel={cfg.label} />;
};

const statusChipConfig = (status: string) => {
  const cfg = getStatusConfig(status);
  const s = getStatusProps(status, cfg.statusMap, cfg.label);
  return { label: s.label, color: s.color };
};

const roundedFilterSx = { flexShrink: 0, "& .MuiOutlinedInput-root": { borderRadius: "24px" } };

/** Read-only label/value pair used inside FormSection grids. */
function ReadField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        {label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ fontWeight: 500 }}>
        {children ?? "—"}
      </Typography>
    </Box>
  );
}

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

  // View switch (summaries / commissions)
  const [activeTab, setActiveTab] = useState<ViewTab>("summaries");

  // Filter State
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);

  // Detail selection
  const [selectedSummaryRow, setSelectedSummaryRow] = useState<MonthlyBranchSalesSummary | null>(null);
  const [selectedCommissionRow, setSelectedCommissionRow] = useState<SalesOfficerCommission | null>(null);

  // Auto-default branch filter for non-superuser users
  useEffect(() => {
    if (defaultBranchCode && selectedBranch === null) {
      setSelectedBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Generate panel state
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [generateBranch, setGenerateBranch] = useState<string>("");
  const [generateYear, setGenerateYear] = useState<number>(currentYear);
  const [generateMonth, setGenerateMonth] = useState<number>(currentMonth);

  // Calculate commissions panel state
  const [calcDialogOpen, setCalcDialogOpen] = useState(false);
  const [calcSummaryId, setCalcSummaryId] = useState<number | null>(null);
  const [commissionPercentage, setCommissionPercentage] = useState<number>(2.5);

  // Approve / reject panel state
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
        status: selectedStatus ?? undefined,
      }),
  });

  const { data: commissions = [], isLoading: commissionsLoading, refetch: refetchCommissions } = useQuery({
    queryKey: ["salesCommission", "commissions", selectedBranch, selectedYear, selectedMonth, selectedStatus],
    queryFn: () =>
      salesCommissionApi.getAll({
        branch_code: selectedBranch || undefined,
        fiscal_year: selectedYear,
        fiscal_month: selectedMonth || undefined,
        status: selectedStatus ?? undefined,
      }),
    enabled: activeTab === "commissions",
  });

  // Summary detail (summary + its commission lines)
  const { data: summaryDetail, isLoading: summaryDetailLoading } = useQuery({
    queryKey: ["salesCommission", "summary", selectedSummaryRow?.id],
    queryFn: () => salesSummaryApi.getById(selectedSummaryRow!.id),
    enabled: !!selectedSummaryRow,
  });

  // Keep the open record in sync with refreshed list data
  const selectedSummary: MonthlyBranchSalesSummary | null = selectedSummaryRow
    ? summaryDetail ?? summaries.find((s) => s.id === selectedSummaryRow.id) ?? selectedSummaryRow
    : null;
  const selectedCommission: SalesOfficerCommission | null = selectedCommissionRow
    ? commissions.find((c) => c.id === selectedCommissionRow.id) ?? selectedCommissionRow
    : null;

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

  const pendingCommissionCount = commissions.filter((c) => c.status === "pending").length;

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

  const handleTabChange = (tab: ViewTab) => {
    setActiveTab(tab);
    setSelectedStatus(null);
  };

  const handleOpenSummary = (summary: MonthlyBranchSalesSummary) => {
    setSelectedCommissionRow(null);
    setSelectedSummaryRow(summary);
  };

  const handleOpenCommission = (commission: SalesOfficerCommission) => {
    setSelectedSummaryRow(null);
    if (activeTab !== "commissions") handleTabChange("commissions");
    setSelectedCommissionRow(commission);
  };

  const handleBack = () => {
    setSelectedSummaryRow(null);
    setSelectedCommissionRow(null);
  };

  const defaultBranch = defaultBranchCode ?? null;
  const hasActiveFilters =
    !!searchQuery ||
    !!selectedStatus ||
    selectedBranch !== defaultBranch ||
    selectedYear !== currentYear ||
    selectedMonth !== currentMonth;

  const handleClearFilters = () => {
    setSearchQuery("");
    setSelectedStatus(null);
    setSelectedBranch(defaultBranch);
    setSelectedYear(currentYear);
    setSelectedMonth(currentMonth);
  };

  // Client-side search over the loaded rows
  const search = searchQuery.trim().toLowerCase();
  const filteredSummaries = useMemo(
    () =>
      !search
        ? summaries
        : summaries.filter((s) =>
            [s.branch_name, s.branch_code, s.month_name].some((v) => (v || "").toLowerCase().includes(search))
          ),
    [summaries, search]
  );
  const filteredCommissions = useMemo(
    () =>
      !search
        ? commissions
        : commissions.filter((c) =>
            [c.employee_name, `employee #${c.employee_id}`, c.branch_name, c.branch_code, c.month_name].some((v) =>
              (v || "").toLowerCase().includes(search)
            )
          ),
    [commissions, search]
  );

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------

  const openColumn = <R extends { id: number }>(onOpen: (row: R) => void): TDataGridColumn<R> => ({
    field: "open",
    header: "",
    width: 56,
    sortable: false,
    align: "center",
    headerAlign: "center",
    renderCell: (params: GridRenderCellParams<R>) => (
      <Tooltip title="Open">
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(params.row);
          }}
        >
          <OpenInNewIcon fontSize="small" color="action" />
        </IconButton>
      </Tooltip>
    ),
  });

  const summaryColumns: TDataGridColumn<MonthlyBranchSalesSummary>[] = [
    {
      field: "branch_name",
      header: "Branch",
      flex: 1,
      minWidth: 160,
      renderCell: (p: GridRenderCellParams<MonthlyBranchSalesSummary>) => p.row.branch_name || p.row.branch_code,
    },
    { field: "month_name", header: "Period", width: 130 },
    {
      field: "total_invoices",
      header: "Invoices",
      width: 100,
      align: "right",
      headerAlign: "right",
      renderCell: (p: GridRenderCellParams<MonthlyBranchSalesSummary>) => p.row.total_invoices || 0,
    },
    {
      field: "total_sales_revenue",
      header: "Revenue",
      width: 140,
      align: "right",
      headerAlign: "right",
      renderCell: (p: GridRenderCellParams<MonthlyBranchSalesSummary>) => <TCurrency value={p.row.total_sales_revenue} />,
    },
    {
      field: "total_sales_cost",
      header: "COGS",
      width: 130,
      align: "right",
      headerAlign: "right",
      renderCell: (p: GridRenderCellParams<MonthlyBranchSalesSummary>) => <TCurrency value={p.row.total_sales_cost} />,
    },
    {
      field: "total_sales_returns",
      header: "Returns",
      width: 120,
      align: "right",
      headerAlign: "right",
      renderCell: (p: GridRenderCellParams<MonthlyBranchSalesSummary>) => <TCurrency value={p.row.total_sales_returns} />,
    },
    {
      field: "total_discounts",
      header: "Discounts",
      width: 120,
      align: "right",
      headerAlign: "right",
      renderCell: (p: GridRenderCellParams<MonthlyBranchSalesSummary>) => <TCurrency value={p.row.total_discounts} />,
    },
    {
      field: "gross_profit",
      header: "Gross Profit",
      width: 140,
      align: "right",
      headerAlign: "right",
      renderCell: (p: GridRenderCellParams<MonthlyBranchSalesSummary>) => (
        <Typography
          component="span"
          variant="body2"
          color={p.row.gross_profit >= 0 ? "success.main" : "error.main"}
          fontWeight="bold"
        >
          <TCurrency value={p.row.gross_profit} />
        </Typography>
      ),
    },
    {
      field: "gross_profit_margin",
      header: "Margin %",
      width: 100,
      align: "right",
      headerAlign: "right",
      renderCell: (p: GridRenderCellParams<MonthlyBranchSalesSummary>) =>
        p.row.gross_profit_margin != null ? `${Number(p.row.gross_profit_margin).toFixed(2)}%` : "—",
    },
    {
      field: "status",
      header: "Status",
      width: 190,
      renderCell: (p: GridRenderCellParams<MonthlyBranchSalesSummary>) => renderStatusChip(p.row.status),
    },
    openColumn<MonthlyBranchSalesSummary>(handleOpenSummary),
  ];

  const commissionColumns: TDataGridColumn<SalesOfficerCommission>[] = [
    {
      field: "employee_name",
      header: "Employee",
      flex: 1,
      minWidth: 170,
      renderCell: (p: GridRenderCellParams<SalesOfficerCommission>) =>
        p.row.employee_name || `Employee #${p.row.employee_id}`,
    },
    {
      field: "branch_name",
      header: "Branch",
      width: 150,
      renderCell: (p: GridRenderCellParams<SalesOfficerCommission>) => p.row.branch_name || p.row.branch_code,
    },
    { field: "month_name", header: "Period", width: 120 },
    {
      field: "branch_gross_profit",
      header: "Branch Profit",
      width: 140,
      align: "right",
      headerAlign: "right",
      renderCell: (p: GridRenderCellParams<SalesOfficerCommission>) => <TCurrency value={p.row.branch_gross_profit} />,
    },
    {
      field: "commission_percentage",
      header: "Commission %",
      width: 120,
      align: "right",
      headerAlign: "right",
      renderCell: (p: GridRenderCellParams<SalesOfficerCommission>) => `${p.row.commission_percentage}%`,
    },
    {
      field: "total_commission_pool",
      header: "Pool",
      width: 130,
      align: "right",
      headerAlign: "right",
      renderCell: (p: GridRenderCellParams<SalesOfficerCommission>) => <TCurrency value={p.row.total_commission_pool} />,
    },
    { field: "total_branch_employees", header: "Officers", width: 90, align: "center", headerAlign: "center" },
    {
      field: "individual_commission_amount",
      header: "Amount",
      width: 140,
      align: "right",
      headerAlign: "right",
      renderCell: (p: GridRenderCellParams<SalesOfficerCommission>) => (
        <Typography component="span" variant="body2" fontWeight="bold" color="success.main">
          <TCurrency value={p.row.individual_commission_amount} />
        </Typography>
      ),
    },
    {
      field: "status",
      header: "Status",
      width: 160,
      renderCell: (p: GridRenderCellParams<SalesOfficerCommission>) => renderStatusChip(p.row.status),
    },
    openColumn<SalesOfficerCommission>(handleOpenCommission),
  ];

  // ---------------------------------------------------------------------------
  // Render: browse
  // ---------------------------------------------------------------------------

  const statFigures = [
    { label: "Pending summaries", value: String(dashboardStats?.total_summaries_pending || 0) },
    { label: "Finalized summaries", value: String(dashboardStats?.total_summaries_finalized || 0) },
    {
      label: "Pending commissions",
      value: `${dashboardStats?.total_commissions_pending || 0} · ${fmtLKR(dashboardStats?.total_pending_amount || 0)}`,
    },
    {
      label: "Approved",
      value: `${dashboardStats?.total_commissions_approved || 0} · ${fmtLKR(dashboardStats?.total_approved_amount || 0)}`,
    },
    {
      label: "Paid",
      value: `${dashboardStats?.total_commissions_paid || 0} · ${fmtLKR(dashboardStats?.total_paid_amount || 0)}`,
    },
  ];

  const browsePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", px: 1.5, pb: 1 }}>
        <TTabs
          tabs={VIEW_TABS}
          activeTab={activeTab}
          onChange={(id) => handleTabChange(id as ViewTab)}
          appearance="segmented"
          showDivider={false}
        />
        <Box sx={{ flex: 1 }} />
        <Box sx={{ display: "flex", gap: 2.5, flexWrap: "wrap" }}>
          {statFigures.map((f) => (
            <Box key={f.label}>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", lineHeight: 1.2 }}>
                {f.label}
              </Typography>
              <Typography variant="body2" fontWeight={600}>
                {f.value}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        {activeTab === "summaries" ? (
          <TDataGrid<MonthlyBranchSalesSummary>
            rows={filteredSummaries}
            columns={summaryColumns}
            loading={summariesLoading}
            onRowClick={handleOpenSummary}
            pageSizeOptions={[10, 25, 50, 100]}
            pageSize={25}
            emptyMessage="No summaries found. Generate a monthly sales summary to calculate commissions."
            autoHeight={false}
            height="100%"
          />
        ) : (
          <TDataGrid<SalesOfficerCommission>
            rows={filteredCommissions}
            columns={commissionColumns}
            loading={commissionsLoading}
            onRowClick={handleOpenCommission}
            pageSizeOptions={[10, 25, 50, 100]}
            pageSize={25}
            emptyMessage="Commissions will appear after calculating from finalized summaries"
            autoHeight={false}
            height="100%"
          />
        )}
      </Box>
    </Box>
  );

  // ---------------------------------------------------------------------------
  // Render: detail
  // ---------------------------------------------------------------------------

  const summaryLines = summaryDetail?.commissions ?? [];

  const summaryDetailPanel = selectedSummary && (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "HR" },
          { label: "Sales Commissions" },
          { label: `${selectedSummary.branch_name || selectedSummary.branch_code} · ${selectedSummary.month_name}` },
        ]}
        title={`${selectedSummary.branch_name || selectedSummary.branch_code} · ${selectedSummary.month_name}`}
        titleIcon={<SummaryIcon color="primary" />}
        chips={[statusChipConfig(selectedSummary.status)]}
      />
      <ActionToolbar
        hasSelectedItem
        isCreating={false}
        isEditing={false}
        endActions={
          <Box sx={{ display: "flex", gap: 1 }}>
            {selectedSummary.status === "draft" && (
              <Button
                size="small"
                variant="outlined"
                color="info"
                startIcon={<FinalizeIcon />}
                onClick={() => handleFinalizeSummary(selectedSummary)}
                disabled={finalizeMutation.isPending}
              >
                Finalize
              </Button>
            )}
            {(selectedSummary.status === "finalized" || selectedSummary.status === "commission_calculated") && (
              <Button
                size="small"
                variant="contained"
                startIcon={<CalculateIcon />}
                onClick={() => handleOpenCalculateDialog(selectedSummary)}
                disabled={calculateCommissionsMutation.isPending}
              >
                Calculate Commissions
              </Button>
            )}
          </Box>
        }
      />
      <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
        <FormSection title="Period" columns={4}>
          <ReadField label="Branch">{selectedSummary.branch_name || selectedSummary.branch_code}</ReadField>
          <ReadField label="Period">{selectedSummary.month_name}</ReadField>
          <ReadField label="Fiscal Year">{selectedSummary.fiscal_year}</ReadField>
          <ReadField label="Invoices">{selectedSummary.total_invoices || 0}</ReadField>
          <ReadField label="Period Start">{selectedSummary.period_start_date}</ReadField>
          <ReadField label="Period End">{selectedSummary.period_end_date}</ReadField>
          <ReadField label="Finalized By">{selectedSummary.finalized_by_name || "—"}</ReadField>
          <ReadField label="Finalized At">
            {selectedSummary.finalized_at ? new Date(selectedSummary.finalized_at).toLocaleString() : "—"}
          </ReadField>
        </FormSection>
        <FormSection title="Sales Figures" columns={4}>
          <ReadField label="Revenue"><TCurrency value={selectedSummary.total_sales_revenue} /></ReadField>
          <ReadField label="COGS"><TCurrency value={selectedSummary.total_sales_cost} /></ReadField>
          <ReadField label="Returns"><TCurrency value={selectedSummary.total_sales_returns} /></ReadField>
          <ReadField label="Discounts"><TCurrency value={selectedSummary.total_discounts} /></ReadField>
          <ReadField label="Net Sales Revenue"><TCurrency value={selectedSummary.net_sales_revenue} /></ReadField>
          <ReadField label="Gross Profit">
            <Typography
              component="span"
              variant="body2"
              color={selectedSummary.gross_profit >= 0 ? "success.main" : "error.main"}
              fontWeight="bold"
            >
              <TCurrency value={selectedSummary.gross_profit} />
            </Typography>
          </ReadField>
          <ReadField label="Margin %">
            {selectedSummary.gross_profit_margin != null
              ? `${Number(selectedSummary.gross_profit_margin).toFixed(2)}%`
              : "—"}
          </ReadField>
        </FormSection>
        <FormSection title={`Officer Commissions (${summaryLines.length})`} columns={1} isLast>
          {summaryDetailLoading ? (
            <TDetailSkeleton />
          ) : summaryLines.length === 0 ? (
            <EmptyState message="No commissions calculated for this summary yet" />
          ) : (
            <Table size="small" sx={modernTableStyles}>
              <TableHead>
                <TableRow>
                  <TableCell>Employee</TableCell>
                  <TableCell align="right">Commission %</TableCell>
                  <TableCell align="right">Pool</TableCell>
                  <TableCell align="center">Officers</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {summaryLines.map((c) => (
                  <TableRow key={c.id} hover sx={{ cursor: "pointer" }} onClick={() => handleOpenCommission(c)}>
                    <TableCell>{c.employee_name || `Employee #${c.employee_id}`}</TableCell>
                    <TableCell align="right">{c.commission_percentage}%</TableCell>
                    <TableCell align="right"><TCurrency value={c.total_commission_pool} /></TableCell>
                    <TableCell align="center">{c.total_branch_employees}</TableCell>
                    <TableCell align="right"><TCurrency value={c.individual_commission_amount} /></TableCell>
                    <TableCell>{renderStatusChip(c.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </FormSection>
      </Box>
    </Box>
  );

  const commissionDetailPanel = selectedCommission && (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "HR" },
          { label: "Sales Commissions" },
          { label: selectedCommission.employee_name || `Employee #${selectedCommission.employee_id}` },
        ]}
        title={`${selectedCommission.employee_name || `Employee #${selectedCommission.employee_id}`} · ${selectedCommission.month_name || ""}`}
        titleIcon={<TeamIcon color="primary" />}
        chips={[
          statusChipConfig(selectedCommission.status),
          ...(selectedCommission.status === "approved"
            ? [{ label: "Ready for Payroll", color: "success" as const }]
            : []),
        ]}
      />
      <ActionToolbar
        hasSelectedItem
        isCreating={false}
        isEditing={false}
        endActions={
          selectedCommission.status === "pending" ? (
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<RejectIcon />}
                onClick={() => handleRejectCommission(selectedCommission)}
                disabled={rejectMutation.isPending || approveMutation.isPending}
              >
                Reject
              </Button>
              <Button
                size="small"
                variant="contained"
                color="success"
                startIcon={<ApproveIcon />}
                onClick={() => handleApproveCommission(selectedCommission)}
                disabled={approveMutation.isPending || rejectMutation.isPending}
              >
                Approve
              </Button>
            </Box>
          ) : undefined
        }
      />
      <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
        <FormSection title="Officer" columns={4}>
          <ReadField label="Employee">
            {selectedCommission.employee_name || `Employee #${selectedCommission.employee_id}`}
          </ReadField>
          <ReadField label="Branch">{selectedCommission.branch_name || selectedCommission.branch_code}</ReadField>
          <ReadField label="Period">{selectedCommission.month_name}</ReadField>
          <ReadField label="Fiscal Year">{selectedCommission.fiscal_year}</ReadField>
        </FormSection>
        <FormSection title="Calculation" columns={4}>
          <ReadField label="Branch Gross Profit"><TCurrency value={selectedCommission.branch_gross_profit} /></ReadField>
          <ReadField label="Commission %">{selectedCommission.commission_percentage}%</ReadField>
          <ReadField label="Commission Pool"><TCurrency value={selectedCommission.total_commission_pool} /></ReadField>
          <ReadField label="Sales Officers">{selectedCommission.total_branch_employees}</ReadField>
          <ReadField label="Individual Amount">
            <Typography component="span" variant="body2" fontWeight="bold" color="success.main">
              <TCurrency value={selectedCommission.individual_commission_amount} />
            </Typography>
          </ReadField>
        </FormSection>
        <FormSection title="Approval" columns={4} isLast>
          <ReadField label="Status">{renderStatusChip(selectedCommission.status)}</ReadField>
          <ReadField label="Approved By">{selectedCommission.approved_by_name || "—"}</ReadField>
          <ReadField label="Approved At">
            {selectedCommission.approved_at ? new Date(selectedCommission.approved_at).toLocaleString() : "—"}
          </ReadField>
          <ReadField label="Payroll">
            {selectedCommission.paid_in_payroll_id ? (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <PaymentIcon fontSize="small" color="success" />#{selectedCommission.paid_in_payroll_id}
              </Box>
            ) : (
              "—"
            )}
          </ReadField>
          <ReadField label="Remarks">{selectedCommission.remarks || "—"}</ReadField>
        </FormSection>
      </Box>
    </Box>
  );

  const isDetailMode = !!selectedSummary || !!selectedCommission;

  // ---------------------------------------------------------------------------
  // Render: page
  // ---------------------------------------------------------------------------

  const titleSlot = isDetailMode ? (
    <Button size="small" startIcon={<ArrowBackIcon fontSize="small" />} onClick={handleBack} sx={{ textTransform: "none" }}>
      Back to Sales Commissions
    </Button>
  ) : (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
      <TextField
        size="small"
        placeholder={activeTab === "summaries" ? "Search branch / period" : "Search officer / branch"}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" color="action" />
            </InputAdornment>
          ),
        }}
        sx={{ width: 190, ...roundedFilterSx }}
      />
      <Box sx={{ width: 170, ...roundedFilterSx }}>
        <TStatusFilter
          options={activeTab === "summaries" ? SUMMARY_STATUS_FILTER_OPTIONS : COMMISSION_STATUS_FILTER_OPTIONS}
          value={selectedStatus}
          onChange={setSelectedStatus}
          label=""
          placeholder="All Statuses"
          size="small"
        />
      </Box>
      <Box sx={{ width: 160, ...roundedFilterSx }}>
        <TBranchFilter
          branches={branchOptions}
          value={selectedBranch}
          onChange={setSelectedBranch}
          label=""
          placeholder="All Branches"
          size="small"
        />
      </Box>
      <Box sx={{ width: 100, ...roundedFilterSx }}>
        <TextField
          select
          fullWidth
          size="small"
          value={selectedYear}
          onChange={(e) => setSelectedYear(Number(e.target.value))}
          inputProps={{ "aria-label": "Year" }}
        >
          {YEARS.map((y) => (
            <MenuItem key={y} value={y}>
              {y}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      <Box sx={{ width: 140, ...roundedFilterSx }}>
        <TextField
          select
          fullWidth
          size="small"
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(Number(e.target.value))}
          inputProps={{ "aria-label": "Month" }}
        >
          <MenuItem value={0}>All Months</MenuItem>
          {MONTHS.map((m) => (
            <MenuItem key={m.value} value={m.value}>
              {m.label}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      {hasActiveFilters && (
        <Button size="small" onClick={handleClearFilters} sx={{ textTransform: "none" }}>
          Clear
        </Button>
      )}
    </Box>
  );

  const headerActions = isDetailMode ? undefined : activeTab === "summaries" ? (
    <Box sx={{ display: "flex", gap: 1, alignItems: "center", mr: 1 }}>
      <TExportButton
        filename="branch_sales_summaries"
        headers={["Branch", "Period", "Invoices", "Revenue", "COGS", "Returns", "Discounts", "Gross Profit", "Margin %", "Status"]}
        rows={() =>
          filteredSummaries.map((s) => [
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
        disabled={filteredSummaries.length === 0}
      />
      <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setGenerateDialogOpen(true)}>
        Generate Summary
      </Button>
    </Box>
  ) : (
    <Box sx={{ display: "flex", gap: 1, alignItems: "center", mr: 1 }}>
      <TExportButton
        filename="officer_commissions"
        headers={["Employee", "Branch", "Period", "Branch Profit", "Commission %", "Pool", "Officers", "Amount", "Status"]}
        rows={() =>
          filteredCommissions.map((c) => [
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
        disabled={filteredCommissions.length === 0}
      />
      <Button
        variant="contained"
        size="small"
        color="success"
        startIcon={<ApproveIcon />}
        onClick={handleBulkApprove}
        disabled={pendingCommissionCount === 0 || bulkApproveMutation.isPending}
      >
        Approve All Pending
      </Button>
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title="Sales Commissions"
        titleSlot={titleSlot}
        headerActions={headerActions}
        onRefresh={() =>
          activeTab === "commissions"
            ? Promise.all([refetchSummaries(), refetchCommissions()])
            : refetchSummaries()
        }
        isLoading={activeTab === "summaries" ? summariesLoading : commissionsLoading}
      >
        {summaryDetailPanel || commissionDetailPanel || browsePanel}
      </MasterDetailLayout>

      {/* Generate Summary */}
      <TSidePanel
        open={generateDialogOpen}
        onClose={() => setGenerateDialogOpen(false)}
        title="Generate Monthly Sales Summary"
        onSubmit={handleGenerateSummary}
        isSubmitting={generateMutation.isPending}
        submitDisabled={generateMutation.isPending}
        submitText="Generate"
      >
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Generate sales summary from invoices for the selected period. This calculates revenue, COGS, returns,
          discounts, and gross profit.
        </Typography>
        <FormSection title="Period" columns={2} isLast>
          <Box sx={{ gridColumn: "1 / -1" }}>
            <TextField
              select
              fullWidth
              size="small"
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
          </Box>
          <TextField
            select
            fullWidth
            size="small"
            label="Year"
            value={generateYear}
            onChange={(e) => setGenerateYear(Number(e.target.value))}
          >
            {YEARS.map((y) => (
              <MenuItem key={y} value={y}>
                {y}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            fullWidth
            size="small"
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
        </FormSection>
      </TSidePanel>

      {/* Calculate Commissions */}
      <TSidePanel
        open={calcDialogOpen}
        onClose={() => setCalcDialogOpen(false)}
        title="Calculate Sales Officer Commissions"
        onSubmit={handleCalculateCommissions}
        isSubmitting={calculateCommissionsMutation.isPending}
        submitDisabled={calculateCommissionsMutation.isPending}
        submitText="Calculate"
      >
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Calculate individual commissions for each Sales Officer in the branch.
          <br />
          <strong>Formula:</strong> Individual = (Branch Gross Profit × Commission %) ÷ Number of Sales Officers
        </Typography>
        <TextField
          fullWidth
          size="small"
          label="Commission Percentage"
          type="number"
          value={commissionPercentage}
          onChange={(e) => setCommissionPercentage(Number(e.target.value))}
          inputProps={{ min: 0, max: 100, step: 0.1 }}
          helperText="Default: 2.5%"
          sx={{ mt: 1 }}
        />
        <Alert severity="info" sx={{ mt: 2 }}>
          No commission will be calculated if the branch made a loss (gross profit ≤ 0).
        </Alert>
      </TSidePanel>

      {/* Approve */}
      <TSidePanel
        open={approveDialogOpen}
        onClose={() => setApproveDialogOpen(false)}
        title="Approve Commission"
        onSubmit={() => {
          if (selectedCommissionId) {
            approveMutation.mutate({ id: selectedCommissionId, remarks: approveRemarks });
          }
        }}
        isSubmitting={approveMutation.isPending}
        submitDisabled={approveMutation.isPending}
        submitText="Approve"
      >
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Approve this commission for payroll inclusion.
        </Typography>
        <TRemarkField
          fullWidth
          label="Remarks (Optional)"
          value={approveRemarks}
          onChange={(value) => setApproveRemarks(value)}
          multiline
          rows={2}
        />
      </TSidePanel>

      {/* Reject */}
      <TSidePanel
        open={rejectDialogOpen}
        onClose={() => setRejectDialogOpen(false)}
        title="Reject Commission"
        onSubmit={() => {
          if (selectedCommissionId && rejectReason.trim()) {
            rejectMutation.mutate({ id: selectedCommissionId, reason: rejectReason });
          }
        }}
        isSubmitting={rejectMutation.isPending}
        submitDisabled={rejectMutation.isPending || !rejectReason.trim()}
        submitText="Reject"
      >
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
      </TSidePanel>

      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
