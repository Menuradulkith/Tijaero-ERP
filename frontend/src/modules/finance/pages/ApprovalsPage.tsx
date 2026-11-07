/**
 * Approvals Page
 *
 * One place to see everything in Finance waiting for someone's OK, with the
 * real number waiting on each card. Counts come from the same list endpoints
 * the approval pages use (filtered to the waiting status), and a card only
 * shows for users who may open that approval page.
 */

import { Box, Chip, Grid, Paper, Skeleton, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  FactCheck as ApprovalIcon,
  Payment as PaymentIcon,
  AccountBalance as BankIcon,
  ReceiptLong as ExpenseIcon,
  MonetizationOn as CommissionIcon,
} from "@mui/icons-material";

import { TPageHeader } from "@/components/tijaero";
import { hasPermission, PERMISSIONS } from "@/auth/permissions";
import { useAuthStore } from "@/state/authStore";
import { expensesApi } from "@/modules/finance/api";
import { bankTransferApi } from "@/modules/finance/api/bankTransfer";
import { supplierPaymentsApi, supplierCreditsSettleApi } from "@/modules/purchasing/api";
import { commissionPaymentsApi } from "@/modules/sales/commission-api";

type CardColor = "primary" | "success" | "warning" | "info" | "error";

interface ApprovalCardProps {
  title: string;
  description: string;
  icon: JSX.Element;
  path: string;
  color: CardColor;
  count: number | undefined;
  loading: boolean;
}

function ApprovalCard({ title, description, icon, path, color, count, loading }: ApprovalCardProps) {
  const navigate = useNavigate();
  return (
    <Paper
      sx={{
        p: 3,
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
      onClick={() => navigate(path)}
    >
      <Box sx={{ p: 2, borderRadius: "50%", bgcolor: `${color}.light`, color: `${color}.main`, mb: 2 }}>
        {icon}
      </Box>
      <Typography variant="h6" fontWeight="bold" gutterBottom>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {description}
      </Typography>
      {loading ? (
        <Skeleton width={90} height={32} />
      ) : count === undefined ? (
        <Chip label="Could not load" size="small" variant="outlined" />
      ) : (
        <Chip
          label={count === 0 ? "Nothing waiting" : `${count} waiting`}
          color={count === 0 ? "default" : "warning"}
          sx={{ fontWeight: 600 }}
        />
      )}
    </Paper>
  );
}

const isPending = (s?: string | null) => (s ?? "").toLowerCase() === "pending";

export default function ApprovalsPage() {
  const user = useAuthStore((s) => s.user);
  const can = (p: { resource: string; action: string }) => hasPermission(user, p.resource, p.action);

  const canPayments = can(PERMISSIONS.PAYMENT_APPROVALS_VIEW);
  const canExpenses = can(PERMISSIONS.EXPENSE_APPROVALS_VIEW);
  const canBank = can(PERMISSIONS.BANK_TRANSFER_VERIFY_VIEW);
  const canCommission = can(PERMISSIONS.COMMISSION_PAYMENT_APPROVALS_VIEW);

  // Supplier payments + credit settlements are verified on the same page.
  const payments = useQuery({
    queryKey: ["approval-count", "supplier-payments"],
    queryFn: async () => {
      const [direct, credit] = await Promise.all([
        supplierPaymentsApi.getAll({ status: "pending", limit: 10000 }),
        supplierCreditsSettleApi.getAll(),
      ]);
      return direct.filter((p) => isPending(p.status)).length + credit.filter((c) => isPending(c.status)).length;
    },
    enabled: canPayments,
  });

  const expenses = useQuery({
    queryKey: ["approval-count", "expenses"],
    queryFn: async () => (await expensesApi.getAll({ status: "submitted", limit: 1 })).total,
    enabled: canExpenses,
  });

  const bank = useQuery({
    queryKey: ["approval-count", "bank-transfers"],
    queryFn: async () =>
      (await bankTransferApi.getPending()).filter((t) => t.bank_transfer_status === "pending_verification").length,
    enabled: canBank,
  });

  const commission = useQuery({
    queryKey: ["approval-count", "commission-payments"],
    queryFn: async () => (await commissionPaymentsApi.getAll({ status: "pending", limit: 1 })).total,
    enabled: canCommission,
  });

  const cards: (ApprovalCardProps & { show: boolean })[] = [
    {
      show: canPayments,
      title: "Supplier Payments",
      description: "Payments to suppliers waiting to be checked",
      icon: <PaymentIcon sx={{ fontSize: 40 }} />,
      path: "/finance/approvals/payment-approvals",
      color: "primary",
      count: payments.data,
      loading: payments.isLoading,
    },
    {
      show: canExpenses,
      title: "Expenses",
      description: "Expenses sent in for approval",
      icon: <ExpenseIcon sx={{ fontSize: 40 }} />,
      path: "/finance/approvals/expense-approvals",
      color: "warning",
      count: expenses.data,
      loading: expenses.isLoading,
    },
    {
      show: canBank,
      title: "Bank Transfers",
      description: "Customer bank transfers to confirm against the bank",
      icon: <BankIcon sx={{ fontSize: 40 }} />,
      path: "/finance/approvals/bank-transfer-verify",
      color: "success",
      count: bank.data,
      loading: bank.isLoading,
    },
    {
      show: canCommission,
      title: "Commission Payments",
      description: "Agent commission payments waiting to be checked",
      icon: <CommissionIcon sx={{ fontSize: 40 }} />,
      path: "/finance/approvals/commission-payment-approvals",
      color: "info",
      count: commission.data,
      loading: commission.isLoading,
    },
  ];
  const visible = cards.filter((c) => c.show);

  return (
    <Box>
      <TPageHeader
        title="Approvals"
        subtitle="Everything in Finance waiting for your OK"
        icon={<ApprovalIcon />}
      />

      {visible.length === 0 ? (
        <Typography color="text.secondary">You do not have access to any Finance approvals.</Typography>
      ) : (
        <Grid container spacing={3}>
          {visible.map((card) => (
            <Grid item xs={12} sm={6} md={3} key={card.path}>
              <ApprovalCard
                title={card.title}
                description={card.description}
                icon={card.icon}
                path={card.path}
                color={card.color}
                count={card.count}
                loading={card.loading}
              />
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
}
