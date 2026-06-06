/**
 * HRDashboard - Overview dashboard for HR module
 * Follows PurchasingDashboard / FinanceDashboard pattern with TPageHeader, TStatCard, Quick Actions.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Grid,
  Typography,
  List,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Skeleton,
  Paper,
  Divider,
  Card,
} from "@mui/material";
import {
  AccountBalance as PayrollIcon,
  TrendingUp as PromotionIcon,
  Receipt as ReimbursementIcon,
  MoneyOff as DeductionIcon,
  Devices as AssetsIcon,
  Person as ProfileIcon,
  Assessment as SummaryIcon,
  CheckCircle as ApproveIcon,
  Group as EmployeesIcon,
  EventAvailable as LeaveIcon,
  AccessTime as AttendanceIcon,
} from "@mui/icons-material";

import { TPageHeader, TStatCard, TStatusChip, TChip } from "@/components/tijaero";
import { KpiSparkCard } from "@/components/dashboard";
import {
  payrollBatchApi,
  salaryProfilesApi,
  promotionsApi,
  reimbursementsApi,
  salaryDeductionsApi,
  employeeAssetsApi,
  employeesApi,
  attendanceApi,
  leavesApi,
} from "@/modules/hr/api";
import type { PayrollBatch, Reimbursement } from "@/modules/hr/types";

// ─── Recent Item Component ──────────────────────────────────────────────────

interface RecentItemProps {
  primary: string;
  secondary: string;
  status?: string;
  icon: React.ReactNode;
  onClick: () => void;
}

function RecentItem({ primary, secondary, status, icon, onClick }: RecentItemProps) {
  return (
    <ListItemButton onClick={onClick} sx={{ borderRadius: 1 }}>
      <ListItemIcon sx={{ minWidth: 40 }}>{icon}</ListItemIcon>
      <ListItemText
        primary={primary}
        secondary={secondary}
        primaryTypographyProps={{ variant: "body2", fontWeight: 500 }}
        secondaryTypographyProps={{ variant: "caption" }}
      />
      {status && (
        <TStatusChip status={status} statusMap="payrollStatus" size="small" />
      )}
    </ListItemButton>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function HRDashboard() {
  const navigate = useNavigate();

  // Data queries
  const { data: batches, isLoading: batchesLoading } = useQuery({
    queryKey: ["payroll-batches"],
    queryFn: () => payrollBatchApi.getAll(),
  });

  const { data: profiles, isLoading: profilesLoading } = useQuery({
    queryKey: ["salary-profiles-count"],
    queryFn: () => salaryProfilesApi.getAll(),
    refetchOnMount: "always",
  });

  const { data: promotions, isLoading: promotionsLoading } = useQuery({
    queryKey: ["promotions-count"],
    queryFn: () => promotionsApi.getAll(),
    refetchOnMount: "always",
  });

  const { data: reimbursements, isLoading: reimbursementsLoading } = useQuery({
    queryKey: ["reimbursements-count"],
    queryFn: () => reimbursementsApi.getAll({ limit: 500 }),
    refetchOnMount: "always",
  });

  const { data: deductions, isLoading: deductionsLoading } = useQuery({
    queryKey: ["deductions-count"],
    queryFn: () => salaryDeductionsApi.getAll(),
    refetchOnMount: "always",
  });

  const { data: assets, isLoading: assetsLoading } = useQuery({
    queryKey: ["assets-count"],
    queryFn: () => employeeAssetsApi.getAll(),
    refetchOnMount: "always",
  });

  const { data: hrEmployees } = useQuery({
    queryKey: ["hr-employees-count"],
    queryFn: () => employeesApi.getAll({ limit: 500 }),
    refetchOnMount: "always",
  });

  const today = new Date().toISOString().split("T")[0];
  const { data: todayAttendance } = useQuery({
    queryKey: ["attendance-today", today],
    queryFn: () => attendanceApi.getAll({ date_from: today, date_to: today, limit: 500 }),
    refetchOnMount: "always",
  });

  const { data: pendingLeaves } = useQuery({
    queryKey: ["leaves-pending-count"],
    queryFn: () => leavesApi.getAll({ status: "pending", limit: 200 }),
  });

  // Stats
  const stats = useMemo(() => {
    const totalProfiles = profiles?.length || 0;
    const pendingBatches = (batches || []).filter(
      (b: PayrollBatch) => b.status === "pending_approval" || b.status === "draft"
    ).length;
    const pendingReimbursements = (reimbursements || []).filter(
      (r: Reimbursement) => r.status === "pending" || r.status === "submitted"
    ).length;
    const totalDeductions = deductions?.length || 0;
    const totalPromotions = promotions?.length || 0;
    const activeAssets = (assets || []).filter((a: any) => !a.revoke_assignment).length;
    const totalEmployees = hrEmployees?.length || 0;
    const presentToday = (todayAttendance || []).filter(
      (a) => a.status === "present" || a.status === "late"
    ).length;
    const pendingLeavesCount = pendingLeaves?.length || 0;

    return {
      totalProfiles,
      pendingBatches,
      pendingReimbursements,
      totalDeductions,
      totalPromotions,
      activeAssets,
      totalEmployees,
      presentToday,
      pendingLeavesCount,
    };
  }, [
    batches,
    profiles,
    reimbursements,
    deductions,
    promotions,
    assets,
    hrEmployees,
    todayAttendance,
    pendingLeaves,
  ]);

  // Recent payroll batches
  const recentBatches = useMemo(() => {
    if (!batches?.length) return [];
    return [...batches]
      .sort((a, b) => new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime())
      .slice(0, 5);
  }, [batches]);

  // Recent reimbursements
  const recentReimbursements = useMemo(() => {
    if (!reimbursements?.length) return [];
    return [...reimbursements]
      .sort((a: Reimbursement, b: Reimbursement) =>
        new Date(b.claim_date || "").getTime() - new Date(a.claim_date || "").getTime()
      )
      .slice(0, 5);
  }, [reimbursements]);

  return (
    <Box
      sx={(theme) => ({
        p: { xs: 1.5, md: 2.5 },
        height: "100%",
        overflow: "auto",
        background: theme.palette.mode === "dark"
          ? `linear-gradient(180deg, ${theme.palette.background.default} 0%, ${theme.palette.background.paper} 280px)`
          : "linear-gradient(180deg, #f6f8fc 0%, #ffffff 280px)",
      })}
    >
      {/* Header */}
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="h5" fontWeight={700}>Human Resources</Typography>
        <Typography variant="caption" color="text.secondary">
          Manage payroll, promotions, reimbursements and employee records
        </Typography>
      </Box>

      {/* Stats Row */}
      <Grid container spacing={2.5} mb={3}>
        <Grid item xs={12} sm={6} md={4} lg={2}>
          <KpiSparkCard
            title="Employees"
            value={stats.totalEmployees}
            icon={<EmployeesIcon />}
            color="primary"
            onClick={() => navigate("/hr/employees")}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg={2}>
          <KpiSparkCard
            title="Present Today"
            value={stats.presentToday}
            icon={<AttendanceIcon />}
            color="success"
            onClick={() => navigate("/hr/attendance")}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg={2}>
          <KpiSparkCard
            title="Pending Leaves"
            value={stats.pendingLeavesCount}
            icon={<LeaveIcon />}
            color="warning"
            onClick={() => navigate("/hr/leave-approvals")}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg={2}>
          <KpiSparkCard
            title="Salary Profiles"
            value={stats.totalProfiles}
            icon={<ProfileIcon />}
            color="primary"
            onClick={() => navigate("/hr/salary-profiles")}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg={2}>
          <KpiSparkCard
            title="Pending Batches"
            value={stats.pendingBatches}
            icon={<PayrollIcon />}
            color="warning"
            onClick={() => navigate("/hr/payroll-processing")}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg={2}>
          <KpiSparkCard
            title="Pending Reimb."
            value={stats.pendingReimbursements}
            icon={<ReimbursementIcon />}
            color="info"
            onClick={() => navigate("/hr/reimbursements")}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg={2}>
          <KpiSparkCard
            title="Deductions"
            value={stats.totalDeductions}
            icon={<DeductionIcon />}
            color="error"
            onClick={() => navigate("/hr/deductions")}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg={2}>
          <KpiSparkCard
            title="Promotions"
            value={stats.totalPromotions}
            icon={<PromotionIcon />}
            color="success"
            onClick={() => navigate("/hr/promotions")}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg={2}>
          <KpiSparkCard
            title="Active Assets"
            value={stats.activeAssets}
            icon={<AssetsIcon />}
            color="primary"
            onClick={() => navigate("/hr/assets")}
          />
        </Grid>
      </Grid>

      {/* Recent Items Row */}
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, height: "100%" }}>
            <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
              <Typography variant="h6" fontWeight="bold">
                Recent Payroll Batches
              </Typography>
              <TChip
                label={`${batches?.length || 0} total`}
                size="small"
                color="primary"
                variant="outlined"
              />
            </Box>
            <Divider sx={{ mb: 1 }} />
            {batchesLoading ? (
              <Box>
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} height={60} sx={{ my: 1 }} />
                ))}
              </Box>
            ) : recentBatches.length === 0 ? (
              <Box textAlign="center" py={4}>
                <PayrollIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
                <Typography color="text.secondary">No payroll batches yet</Typography>
              </Box>
            ) : (
              <List disablePadding>
                {recentBatches.map((batch) => (
                  <RecentItem
                    key={batch.id}
                    primary={batch.batch_no || `Batch-${batch.id}`}
                    secondary={`${batch.total_employees} employees • ${batch.payroll_month}/${batch.payroll_year}`}
                    status={batch.status}
                    icon={<PayrollIcon fontSize="small" color="action" />}
                    onClick={() => navigate("/hr/payroll-processing")}
                  />
                ))}
              </List>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, height: "100%" }}>
            <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
              <Typography variant="h6" fontWeight="bold">
                Recent Reimbursements
              </Typography>
              <TChip
                label={`${reimbursements?.length || 0} total`}
                size="small"
                color="info"
                variant="outlined"
              />
            </Box>
            <Divider sx={{ mb: 1 }} />
            {reimbursementsLoading ? (
              <Box>
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} height={60} sx={{ my: 1 }} />
                ))}
              </Box>
            ) : recentReimbursements.length === 0 ? (
              <Box textAlign="center" py={4}>
                <ReimbursementIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
                <Typography color="text.secondary">No reimbursements yet</Typography>
              </Box>
            ) : (
              <List disablePadding>
                {recentReimbursements.map((r: Reimbursement) => (
                  <RecentItem
                    key={r.id}
                    primary={r.reimbursement_no || `RMB-${r.id}`}
                    secondary={`${r.employee_id} • ${r.claim_date ? new Date(r.claim_date).toLocaleDateString() : ""}`}
                    status={r.status}
                    icon={<ReimbursementIcon fontSize="small" color="action" />}
                    onClick={() => navigate("/hr/reimbursements")}
                  />
                ))}
              </List>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Quick Actions */}
      <Box mt={4}>
        <Typography variant="h6" fontWeight="bold" gutterBottom>
          Quick Actions
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={6} sm={4} md={2}>
            <Card
              sx={{
                cursor: "pointer",
                textAlign: "center",
                p: 2,
                transition: "all 0.2s",
                "&:hover": { bgcolor: "action.hover", transform: "translateY(-2px)" },
              }}
              onClick={() => navigate("/hr/employees")}
            >
              <EmployeesIcon color="primary" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="body2" fontWeight="500">
                Employees
              </Typography>
            </Card>
          </Grid>
          <Grid item xs={6} sm={4} md={2}>
            <Card
              sx={{
                cursor: "pointer",
                textAlign: "center",
                p: 2,
                transition: "all 0.2s",
                "&:hover": { bgcolor: "action.hover", transform: "translateY(-2px)" },
              }}
              onClick={() => navigate("/hr/attendance")}
            >
              <AttendanceIcon color="success" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="body2" fontWeight="500">
                Attendance
              </Typography>
            </Card>
          </Grid>
          <Grid item xs={6} sm={4} md={2}>
            <Card
              sx={{
                cursor: "pointer",
                textAlign: "center",
                p: 2,
                transition: "all 0.2s",
                "&:hover": { bgcolor: "action.hover", transform: "translateY(-2px)" },
              }}
              onClick={() => navigate("/hr/leaves")}
            >
              <LeaveIcon color="warning" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="body2" fontWeight="500">
                Leaves
              </Typography>
            </Card>
          </Grid>
          <Grid item xs={6} sm={4} md={2}>
            <Card
              sx={{
                cursor: "pointer",
                textAlign: "center",
                p: 2,
                transition: "all 0.2s",
                "&:hover": { bgcolor: "action.hover", transform: "translateY(-2px)" },
              }}
              onClick={() => navigate("/hr/payroll")}
            >
              <PayrollIcon color="primary" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="body2" fontWeight="500">
                Payroll Records
              </Typography>
            </Card>
          </Grid>
          <Grid item xs={6} sm={4} md={2}>
            <Card
              sx={{
                cursor: "pointer",
                textAlign: "center",
                p: 2,
                transition: "all 0.2s",
                "&:hover": { bgcolor: "action.hover", transform: "translateY(-2px)" },
              }}
              onClick={() => navigate("/hr/payroll-processing")}
            >
              <SummaryIcon color="warning" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="body2" fontWeight="500">
                Run Payroll
              </Typography>
            </Card>
          </Grid>
          <Grid item xs={6} sm={4} md={2}>
            <Card
              sx={{
                cursor: "pointer",
                textAlign: "center",
                p: 2,
                transition: "all 0.2s",
                "&:hover": { bgcolor: "action.hover", transform: "translateY(-2px)" },
              }}
              onClick={() => navigate("/hr/salary-profiles")}
            >
              <ProfileIcon color="success" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="body2" fontWeight="500">
                Salary Profiles
              </Typography>
            </Card>
          </Grid>
          <Grid item xs={6} sm={4} md={2}>
            <Card
              sx={{
                cursor: "pointer",
                textAlign: "center",
                p: 2,
                transition: "all 0.2s",
                "&:hover": { bgcolor: "action.hover", transform: "translateY(-2px)" },
              }}
              onClick={() => navigate("/hr/reimbursements")}
            >
              <ReimbursementIcon color="info" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="body2" fontWeight="500">
                Reimbursements
              </Typography>
            </Card>
          </Grid>
          <Grid item xs={6} sm={4} md={2}>
            <Card
              sx={{
                cursor: "pointer",
                textAlign: "center",
                p: 2,
                transition: "all 0.2s",
                "&:hover": { bgcolor: "action.hover", transform: "translateY(-2px)" },
              }}
              onClick={() => navigate("/hr/payroll-approvals")}
            >
              <ApproveIcon color="success" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="body2" fontWeight="500">
                Approvals
              </Typography>
            </Card>
          </Grid>
          <Grid item xs={6} sm={4} md={2}>
            <Card
              sx={{
                cursor: "pointer",
                textAlign: "center",
                p: 2,
                transition: "all 0.2s",
                "&:hover": { bgcolor: "action.hover", transform: "translateY(-2px)" },
              }}
              onClick={() => navigate("/hr/promotions")}
            >
              <PromotionIcon color="warning" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="body2" fontWeight="500">
                Promotions
              </Typography>
            </Card>
          </Grid>
        </Grid>
      </Box>
    </Box>
  );
}
