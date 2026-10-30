/**
 * HR Approvals Page
 *
 * Overview page for HR approval workflows (leave, payroll, reimbursements).
 * Follows the same pattern as Purchasing / Sales ApprovalsPage.
 */

import { Box, Grid, Paper, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  FactCheck as ApprovalIcon,
  EventAvailable as LeaveIcon,
  Payments as PayrollIcon,
  AccountBalanceWallet as ReimbursementIcon,
} from "@mui/icons-material";

import { TPageHeader, TStatCard } from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";
import { leavesApi, payrollBatchApi, reimbursementsApi } from "@/modules/hr/api";

interface ApprovalCard {
  title: string;
  description: string;
  icon: JSX.Element;
  path: string;
  color: "primary" | "success" | "warning" | "info" | "error";
  resource: string;
}

const approvalTypes: ApprovalCard[] = [
  {
    title: "Leave Approvals",
    description: "Review and approve pending leave requests",
    icon: <LeaveIcon sx={{ fontSize: 48 }} />,
    path: "/hr/approvals/leave-approvals",
    color: "primary",
    resource: "leave_approvals",
  },
  {
    title: "Payroll Approvals",
    description: "Review and approve submitted payroll batches",
    icon: <PayrollIcon sx={{ fontSize: 48 }} />,
    path: "/hr/approvals/payroll-approvals",
    color: "success",
    resource: "payroll_approvals",
  },
  {
    title: "Reimbursement Approvals",
    description: "Review, verify and approve employee claims",
    icon: <ReimbursementIcon sx={{ fontSize: 48 }} />,
    path: "/hr/approvals/reimbursement-approvals",
    color: "info",
    resource: "reimbursement_approvals",
  },
];

export default function HRApprovalsPage() {
  const navigate = useNavigate();
  const canLeave = usePermission("leave_approvals", "view");
  const canPayroll = usePermission("payroll_approvals", "view");
  const canReimb = usePermission("reimbursement_approvals", "view");
  const allowed: Record<string, boolean> = {
    leave_approvals: canLeave,
    payroll_approvals: canPayroll,
    reimbursement_approvals: canReimb,
  };

  const { data: pendingLeaves } = useQuery({
    queryKey: ["hr-approvals", "pending-leaves"],
    queryFn: () => leavesApi.getAll({ status: "pending", limit: 200 }),
    enabled: canLeave,
    refetchInterval: 30_000,
  });
  const { data: pendingBatches } = useQuery({
    queryKey: ["hr-approvals", "pending-payroll"],
    queryFn: () => payrollBatchApi.getAll({ status: "pending_approval", limit: 500 }),
    enabled: canPayroll,
    refetchInterval: 30_000,
  });
  const { data: pendingClaims } = useQuery({
    queryKey: ["hr-approvals", "pending-reimbursements"],
    queryFn: () => reimbursementsApi.getAll({ status: "pending", limit: 500 }),
    enabled: canReimb,
    refetchInterval: 30_000,
  });

  const visible = approvalTypes.filter((a) => allowed[a.resource]);

  return (
    <Box>
      <TPageHeader title="HR Approvals" subtitle="Manage leave, payroll and reimbursement approvals" icon={<ApprovalIcon />} />

      <Grid container spacing={3}>
        {visible.map((approval) => (
          <Grid item xs={12} sm={6} md={4} key={approval.title}>
            <Paper
              sx={{
                p: 4,
                cursor: "pointer",
                transition: "all 0.2s ease-in-out",
                "&:hover": { transform: "translateY(-4px)", boxShadow: 4 },
                borderRadius: 2,
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
              }}
              onClick={() => navigate(approval.path)}
            >
              <Box sx={{ p: 2, borderRadius: "50%", bgcolor: `${approval.color}.light`, color: `${approval.color}.main`, mb: 2 }}>
                {approval.icon}
              </Box>
              <Typography variant="h5" fontWeight="bold" gutterBottom>
                {approval.title}
              </Typography>
              <Typography variant="body1" color="text.secondary">
                {approval.description}
              </Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      <Typography variant="h6" fontWeight="bold" sx={{ mt: 4, mb: 2 }}>
        Quick Overview
      </Typography>
      <Grid container spacing={2}>
        {canLeave && (
          <Grid item xs={12} sm={6} md={3}>
            <TStatCard title="Pending Leaves" value={pendingLeaves?.length ?? 0} icon={<LeaveIcon />} color="primary" />
          </Grid>
        )}
        {canPayroll && (
          <Grid item xs={12} sm={6} md={3}>
            <TStatCard title="Payroll Batches Pending" value={pendingBatches?.length ?? 0} icon={<PayrollIcon />} color="success" />
          </Grid>
        )}
        {canReimb && (
          <Grid item xs={12} sm={6} md={3}>
            <TStatCard title="Pending Reimbursements" value={pendingClaims?.length ?? 0} icon={<ReimbursementIcon />} color="info" />
          </Grid>
        )}
      </Grid>
    </Box>
  );
}
