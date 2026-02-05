/**
 * Approvals Page
 * 
 * Overview page for approval workflows including Payment Approvals
 * and Bank Transfer Verifications.
 * Uses Tijaero components for consistent UI.
 */

import { Box, Grid, Paper, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";
import {
  FactCheck as ApprovalIcon,
  Payment as PaymentIcon,
  AccountBalance as BankIcon,
  CheckCircle as CheckIcon,
} from "@mui/icons-material";

// Tijaero Components
import { TPageHeader, TStatCard } from "@/components/tijaero";

interface ApprovalCard {
  title: string;
  description: string;
  icon: JSX.Element;
  path: string;
  color: "primary" | "success" | "warning" | "info" | "error";
}

const approvalTypes: ApprovalCard[] = [
  {
    title: "Payment Approvals",
    description: "Review and approve pending payment requests",
    icon: <PaymentIcon sx={{ fontSize: 48 }} />,
    path: "/finance/approvals/payment-approvals",
    color: "primary",
  },
  {
    title: "Bank Transfer Verify",
    description: "Verify and confirm bank transfer transactions",
    icon: <BankIcon sx={{ fontSize: 48 }} />,
    path: "/finance/approvals/bank-transfer-verify",
    color: "success",
  },
];

export default function ApprovalsPage() {
  const navigate = useNavigate();

  return (
    <Box>
      {/* Page Header */}
      <TPageHeader
        title="Approvals"
        subtitle="Manage payment approvals and bank transfer verifications"
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
            title="Payment Approvals"
            value="View Pending"
            icon={<PaymentIcon />}
            color="primary"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Bank Transfers"
            value="View Pending"
            icon={<BankIcon />}
            color="success"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Approved Today"
            value="—"
            icon={<CheckIcon />}
            color="info"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Pending Review"
            value="—"
            icon={<ApprovalIcon />}
            color="warning"
          />
        </Grid>
      </Grid>
    </Box>
  );
}
