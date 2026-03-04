/**
 * Purchasing Approvals Page
 * 
 * Overview page for purchasing approval workflows including PO Approvals
 * and Return Approvals.
 * Follows the same pattern as Finance ApprovalsPage.
 */

import { Box, Grid, Paper, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  FactCheck as ApprovalIcon,
  ReceiptLong as POIcon,
  AssignmentReturn as ReturnIcon,
  CheckCircle as CheckIcon,
} from "@mui/icons-material";

// Tijaero Components
import { TPageHeader, TStatCard } from "@/components/tijaero";
import { purchaseOrdersApi, purchaseReturnsApi } from "@/modules/purchasing/api";

interface ApprovalCard {
  title: string;
  description: string;
  icon: JSX.Element;
  path: string;
  color: "primary" | "success" | "warning" | "info" | "error";
}

const approvalTypes: ApprovalCard[] = [
  {
    title: "PO Approvals",
    description: "Review and approve pending purchase orders",
    icon: <POIcon sx={{ fontSize: 48 }} />,
    path: "/purchasing/approvals/po-approvals",
    color: "primary",
  },
  {
    title: "Return Approvals",
    description: "Review and approve pending purchase return requests",
    icon: <ReturnIcon sx={{ fontSize: 48 }} />,
    path: "/purchasing/approvals/return-approvals",
    color: "warning",
  },
];

export default function PurchasingApprovalsPage() {
  const navigate = useNavigate();

  // Live pending PO count
  const { data: pendingPOs } = useQuery({
    queryKey: ["purchasing-approvals", "pending-pos"],
    queryFn: () => purchaseOrdersApi.getAll({ status: "pending_approval" }),
    refetchInterval: 30_000,
  });

  // Live pending return count
  const { data: pendingReturns } = useQuery({
    queryKey: ["purchasing-approvals", "pending-returns"],
    queryFn: () => purchaseReturnsApi.getAll({ status_filter: "pending_approval" }),
    refetchInterval: 30_000,
  });

  // Live approved today counts
  const { data: approvedPOs } = useQuery({
    queryKey: ["purchasing-approvals", "approved-pos-today"],
    queryFn: () => purchaseOrdersApi.getAll({
      status: "approved",
      date_from: new Date().toISOString().split("T")[0],
      date_to: new Date().toISOString().split("T")[0],
    }),
    refetchInterval: 30_000,
  });

  const pendingPOCount = pendingPOs?.length ?? 0;
  const pendingReturnCount = pendingReturns?.length ?? 0;
  const totalPending = pendingPOCount + pendingReturnCount;
  const approvedTodayCount = approvedPOs?.length ?? 0;

  return (
    <Box>
      {/* Page Header */}
      <TPageHeader
        title="Purchasing Approvals"
        subtitle="Manage purchase order and return approvals"
        icon={<ApprovalIcon />}
      />

      {/* Approval Type Cards */}
      <Grid container spacing={3}>
        {approvalTypes.map((approval) => (
          <Grid item xs={12} sm={6} key={approval.title}>
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
            title="Pending POs"
            value={pendingPOCount}
            icon={<POIcon />}
            color="primary"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Pending Returns"
            value={pendingReturnCount}
            icon={<ReturnIcon />}
            color="warning"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Approved Today"
            value={approvedTodayCount}
            icon={<CheckIcon />}
            color="success"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Total Pending"
            value={totalPending}
            icon={<ApprovalIcon />}
            color="info"
          />
        </Grid>
      </Grid>
    </Box>
  );
}
