/**
 * Payment Methods Page
 * 
 * Overview page for payment methods including Bank Deposits, Card Payments,
 * Cheque Payments, and Credit Notes.
 * Uses Tijaero components for consistent UI.
 */

import { Box, Grid, Paper, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";
import {
  AccountBalance as BankIcon,
  Payment as CardIcon,
  Receipt as ChequeIcon,
  CreditScore as CreditNoteIcon,
  AccountBalanceWallet as WalletIcon,
} from "@mui/icons-material";

// Tijaero Components
import { TPageHeader, TStatCard } from "@/components/tijaero";

interface PaymentMethodCard {
  title: string;
  description: string;
  icon: JSX.Element;
  path: string;
  color: "primary" | "success" | "warning" | "info" | "error";
}

const paymentMethods: PaymentMethodCard[] = [
  {
    title: "Bank Deposits",
    description: "Manage bank deposit records and verifications",
    icon: <BankIcon sx={{ fontSize: 48 }} />,
    path: "/finance/payment-methods/bank-deposits",
    color: "primary",
  },
  {
    title: "Card Payments",
    description: "Track credit and debit card transactions",
    icon: <CardIcon sx={{ fontSize: 48 }} />,
    path: "/finance/payment-methods/card-payments",
    color: "success",
  },
  {
    title: "Cheque Payments",
    description: "Manage cheque payments and clearances",
    icon: <ChequeIcon sx={{ fontSize: 48 }} />,
    path: "/finance/payment-methods/cheque-payments",
    color: "warning",
  },
  {
    title: "Credit Notes",
    description: "Issue and track credit notes for customers",
    icon: <CreditNoteIcon sx={{ fontSize: 48 }} />,
    path: "/finance/payment-methods/credit-notes",
    color: "info",
  },
];

export default function PaymentMethodsPage() {
  const navigate = useNavigate();

  return (
    <Box>
      {/* Page Header */}
      <TPageHeader
        title="Payment Methods"
        subtitle="Manage different payment methods and transactions"
        icon={<WalletIcon />}
      />

      {/* Payment Method Cards */}
      <Grid container spacing={3}>
        {paymentMethods.map((method) => (
          <Grid item xs={12} sm={6} md={3} key={method.title}>
            <Paper
              sx={{
                p: 3,
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
              onClick={() => navigate(method.path)}
            >
              <Box
                sx={{
                  p: 2,
                  borderRadius: "50%",
                  bgcolor: `${method.color}.light`,
                  color: `${method.color}.main`,
                  mb: 2,
                }}
              >
                {method.icon}
              </Box>
              <Typography variant="h6" fontWeight="bold" gutterBottom>
                {method.title}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {method.description}
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
            title="Bank Deposits"
            value="View All"
            icon={<BankIcon />}
            color="primary"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Card Payments"
            value="View All"
            icon={<CardIcon />}
            color="success"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Cheque Payments"
            value="View All"
            icon={<ChequeIcon />}
            color="warning"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Credit Notes"
            value="View All"
            icon={<CreditNoteIcon />}
            color="info"
          />
        </Grid>
      </Grid>
    </Box>
  );
}
