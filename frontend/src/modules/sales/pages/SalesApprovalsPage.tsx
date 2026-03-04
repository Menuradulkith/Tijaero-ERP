/**
 * Sales Approvals Page
 * 
 * Overview page for sales approval workflows including SO Approvals,
 * Return Approvals, and Commission Approvals.
 * Follows the same pattern as Finance ApprovalsPage.
 */

import { Box, Grid, Paper, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";
import {
  FactCheck as ApprovalIcon,
  PointOfSale as SOIcon,
  AssignmentReturn as ReturnIcon,
  MonetizationOn as CommissionIcon,
} from "@mui/icons-material";
import { useQuery } from "@tanstack/react-query";

// Tijaero Components
import { TPageHeader, TStatCard } from "@/components/tijaero";
import { salesApi, saleReturnsApi } from "@/modules/sales/api";
import { commissionsApi } from "@/modules/sales/commission-api";

interface ApprovalCard {
  title: string;
  description: string;
  icon: JSX.Element;
  path: string;
  color: "primary" | "success" | "warning" | "info" | "error";
}

const approvalTypes: ApprovalCard[] = [
  {
    title: "Sales Order Approvals",
    description: "Review and approve pending sales orders",
    icon: <SOIcon sx={{ fontSize: 48 }} />,
    path: "/sales/approvals/so-approvals",
    color: "primary",
  },
  {
    title: "Return Approvals",
    description: "Review and approve pending sales return requests",
    icon: <ReturnIcon sx={{ fontSize: 48 }} />,
    path: "/sales/approvals/return-approvals",
    color: "warning",
  },
  {
    title: "Commission Approvals",
    description: "Review and approve agent commission claims",
    icon: <CommissionIcon sx={{ fontSize: 48 }} />,
    path: "/sales/approvals/commission-approvals",
    color: "success",
  },
];

export default function SalesApprovalsPage() {
  const navigate = useNavigate();

  // Fetch live pending counts
  const { data: pendingSO } = useQuery({
    queryKey: ["sales-pending-approval"],
    queryFn: () => salesApi.getPendingApproval(0, 500),
    staleTime: 30000,
  });

  const { data: pendingReturns } = useQuery({
    queryKey: ["returns-pending-approval"],
    queryFn: () => saleReturnsApi.getAll(0, 500),
    staleTime: 30000,
  });

  const { data: pendingCommissions } = useQuery({
    queryKey: ["commissions-pending-approval"],
    queryFn: () => commissionsApi.getAll({ status: "pending", limit: 500 }),
    staleTime: 30000,
  });

  const soCount = pendingSO?.length ?? "—";
  const returnsCount = pendingReturns
    ? pendingReturns.filter((r) => r.status === "pending").length
    : "—";
  const commissionCount = pendingCommissions
    ? pendingCommissions.items.filter((c) => c.status === "pending").length
    : "—";
  const totalPending =
    typeof soCount === "number" && typeof returnsCount === "number" && typeof commissionCount === "number"
      ? soCount + returnsCount + commissionCount
      : "—";

  return (
    <Box>
      {/* Page Header */}
      <TPageHeader
        title="Sales Approvals"
        subtitle="Manage sales order, return, and commission approvals"
        icon={<ApprovalIcon />}
      />

      {/* Approval Type Cards */}
      <Grid container spacing={3}>
        {approvalTypes.map((approval) => (
          <Grid item xs={12} sm={6} md={4} key={approval.title}>
            <Paper
              sx={{
                p: 4,
                cursor: "pointer",
                transition: "all 0.2s ease-in-out",
                "&:hover": {
                  transform: "translateY(-4px)",
                  boxShadow: 4,
                },
                borderRadius: 2,
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
              }}
              onClick={() => navigate(approval.path)}
            >
              <Box
                sx={{
                  p: 2,
                  borderRadius: "50%",
                  bgcolor: `${approval.color}.light`,
                  color: `${approval.color}.main`,
                  mb: 2,
                }}
              >
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

      {/* Quick Stats */}
      <Typography variant="h6" fontWeight="bold" sx={{ mt: 4, mb: 2 }}>
        Quick Overview
      </Typography>
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="SO Approvals"
            value={soCount}
            icon={<SOIcon />}
            color="primary"
            subtitle="Pending approval"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Return Approvals"
            value={returnsCount}
            icon={<ReturnIcon />}
            color="warning"
            subtitle="Pending approval"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Commission Approvals"
            value={commissionCount}
            icon={<CommissionIcon />}
            color="success"
            subtitle="Pending approval"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Total Pending"
            value={totalPending}
            icon={<ApprovalIcon />}
            color="info"
            subtitle="Across all workflows"
          />
        </Grid>
      </Grid>
    </Box>
  );
}
