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

// Tijaero Components
import { TPageHeader } from "@/components/tijaero";

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
    </Box>
  );
}
