/**
 * Customer Payment Methods Page
 * 
 * Overview page for customer payment methods including Bank Deposits,
 * Card Payments, Cheque Payments, Credit Notes, and Credit Payments.
 * Cash payments are recorded directly in sales invoices and tracked through the cashbook.
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
  CreditScore as CreditPaymentIcon,
  LocalAtm as CashIcon,
} from "@mui/icons-material";

// Tijaero Components
import { TPageHeader, TStatCard } from "@/components/tijaero";

interface PaymentMethodCard {
  title: string;
  description: string;
  icon: JSX.Element;
  path: string;
  color: "primary" | "success" | "warning" | "info" | "error" | "secondary";
}

const paymentMethods: PaymentMethodCard[] = [
  {
    title: "Bank Deposits",
    description: "Manage bank deposit records and verifications",
    icon: <BankIcon sx={{ fontSize: 48 }} />,
    path: "/finance/customer-payment-methods/bank-deposits",
    color: "primary",
  },
  {
    title: "Card Payments",
    description: "Track credit and debit card transactions",
    icon: <CardIcon sx={{ fontSize: 48 }} />,
    path: "/finance/customer-payment-methods/card-payments",
    color: "success",
  },
  {
    title: "Cheque Payments",
    description: "Manage cheque payments and clearances",
    icon: <ChequeIcon sx={{ fontSize: 48 }} />,
    path: "/finance/customer-payment-methods/cheque-payments",
    color: "warning",
  },
  {
    title: "Credit Notes",
    description: "Issue and track credit notes for customers",
    icon: <CreditNoteIcon sx={{ fontSize: 48 }} />,
    path: "/finance/customer-payment-methods/credit-notes",
    color: "info",
  },
  {
    title: "Credit Payments",
    description: "Manage customer credit terms and balances",
    icon: <CreditPaymentIcon sx={{ fontSize: 48 }} />,
    path: "/finance/customer-payment-methods/credit-payments",
    color: "secondary",
  },
  {
    title: "Cash Payments",
    description: "View cash payments received from sales invoices",
    icon: <CashIcon sx={{ fontSize: 48 }} />,
    path: "/finance/customer-payment-methods/cash-payments",
    color: "error",
  },
];

export default function CustomerPaymentMethodsPage() {
  const navigate = useNavigate();

  return (
    <Box>
      {/* Page Header */}
      <TPageHeader
        title="Customer Payment Methods"
        subtitle="Manage different customer payment methods and transactions"
        icon={<WalletIcon />}
      />

      {/* Info Box */}
      <Box
        sx={{
          mb: 3,
          p: 2,
          borderRadius: 2,
          bgcolor: "info.50",
          border: 1,
          borderColor: "info.main",
        }}
      >
        <Typography variant="body2" color="info.dark">
          <strong>Note:</strong> Customer payment methods can be managed using the sections below. Cash payments are logged directly from sales invoices.
        </Typography>
      </Box>

      {/* Payment Method Cards */}
      <Grid container spacing={3}>
        {paymentMethods.map((method) => (
          <Grid item xs={12} sm={6} md={2} key={method.title}>
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
              <Typography variant="h6" fontWeight="bold" gutterBottom sx={{ fontSize: "1.1rem" }}>
                {method.title}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.825rem" }}>
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
        <Grid item xs={12} sm={6} md={2}>
          <TStatCard
            title="Bank Deposits"
            value="View All"
            icon={<BankIcon />}
            color="primary"
            onClick={() => navigate("/finance/customer-payment-methods/bank-deposits")}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <TStatCard
            title="Card Payments"
            value="View All"
            icon={<CardIcon />}
            color="success"
            onClick={() => navigate("/finance/customer-payment-methods/card-payments")}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <TStatCard
            title="Cheque Payments"
            value="View All"
            icon={<ChequeIcon />}
            color="warning"
            onClick={() => navigate("/finance/customer-payment-methods/cheque-payments")}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <TStatCard
            title="Credit Notes"
            value="View All"
            icon={<CreditNoteIcon />}
            color="info"
            onClick={() => navigate("/finance/customer-payment-methods/credit-notes")}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <TStatCard
            title="Credit Payments"
            value="View All"
            icon={<CreditPaymentIcon />}
            color="secondary"
            onClick={() => navigate("/finance/customer-payment-methods/credit-payments")}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <TStatCard
            title="Cash Payments"
            value="View All"
            icon={<CashIcon />}
            color="error"
            onClick={() => navigate("/finance/customer-payment-methods/cash-payments")}
          />
        </Grid>
      </Grid>
    </Box>
  );
}
