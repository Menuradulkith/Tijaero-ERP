import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Grid,
  Paper,
  Typography,
  Card,
  CardContent,
  LinearProgress,
  Chip,
  IconButton,
  Tooltip,
  Divider,
  Stack,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  AccountBalance as BankIcon,
  CreditCard as CardIcon,
  Receipt as ChequeIcon,
  ShoppingCart as ExpenseIcon,
  MoneyOff as AdvanceIcon,
  AssignmentReturn as CreditNoteIcon,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  Refresh as RefreshIcon,
  ArrowForward as ArrowForwardIcon,
  AccountBalanceWallet as WalletIcon,
  SwapHoriz as TransferIcon,
  PointOfSale as CashIcon,
  PendingActions as PendingIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { TPageHeader, TCurrency, TPageSkeleton, TBranchFilter, fmtLKR } from '@/components/tijaero';
import { KpiSparkCard } from '@/components/dashboard';
import { cashbookApi, bankDepositsApi, expensesApi } from '../api';
import { CashbookEntry } from '../types';
import { useReferenceData } from '@/hooks';

// Stat Card Component - Similar to other dashboards
interface StatCardProps {
  title: string;
  value: React.ReactNode;
  subtitle?: string;
  icon: React.ReactNode;
  color: 'primary' | 'success' | 'error' | 'warning' | 'info';
  trend?: {
    value: number;
    direction: 'up' | 'down';
    label: string;
  };
  onClick?: () => void;
}

function StatCard({ title, value, subtitle, icon, color, trend, onClick }: StatCardProps) {
  const colorMap = {
    primary: { iconBg: '#1976d2', iconColor: '#fff', ring: '#90caf9' },
    success: { iconBg: '#2e7d32', iconColor: '#fff', ring: '#a5d6a7' },
    error: { iconBg: '#d32f2f', iconColor: '#fff', ring: '#ef9a9a' },
    warning: { iconBg: '#ed6c02', iconColor: '#fff', ring: '#ffcc80' },
    info: { iconBg: '#0288d1', iconColor: '#fff', ring: '#81d4fa' },
  };

  const colors = colorMap[color];

  return (
    <Card
      variant="outlined"
      sx={{
        height: '100%',
        cursor: onClick ? 'pointer' : 'default',
        borderRadius: 3,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        transition: 'all 0.25s ease-in-out',
        boxShadow: '0 2px 12px rgba(15, 23, 42, 0.05)',
        '&:hover': onClick
          ? {
              transform: 'translateY(-3px)',
              boxShadow: `0 8px 24px ${alpha(colors.ring, 0.35)}`,
              borderColor: alpha(colors.iconBg, 0.35),
            }
          : {},
      }}
      onClick={onClick}
    >
      <CardContent sx={{ p: 2.25, '&:last-child': { pb: 2.25 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', letterSpacing: 0.4, textTransform: 'uppercase' }}>
              {title}
            </Typography>
            <Typography variant="h5" fontWeight={800} color="text.primary" sx={{ mt: 0.75, lineHeight: 1.15 }}>
              {value}
            </Typography>
            {subtitle && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
                {subtitle}
              </Typography>
            )}
            {trend && (
              <Box sx={{ display: 'flex', alignItems: 'center', mt: 1.1, gap: 0.5 }}>
                {trend.direction === 'up' ? (
                  <TrendingUpIcon sx={{ fontSize: 16, color: 'success.main' }} />
                ) : (
                  <TrendingDownIcon sx={{ fontSize: 16, color: 'error.main' }} />
                )}
                <Typography
                  variant="caption"
                  sx={{ color: trend.direction === 'up' ? 'success.main' : 'error.main' }}
                >
                  {trend.value}%
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {trend.label}
                </Typography>
              </Box>
            )}
          </Box>
          <Box
            sx={{
              background: `linear-gradient(135deg, ${colors.iconBg} 0%, ${alpha(colors.iconBg, 0.75)} 100%)`,
              borderRadius: 2.5,
              p: 1.25,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: `0 8px 16px ${alpha(colors.iconBg, 0.35)}`,
            }}
          >
            {React.cloneElement(icon as React.ReactElement, {
              sx: { color: colors.iconColor, fontSize: 28 },
            })}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

// Payment Method Breakdown Item
interface PaymentBreakdownItemProps {
  label: string;
  amount: number;
  total: number;
  color: string;
  icon: React.ReactNode;
}

function PaymentBreakdownItem({ label, amount, total, color, icon }: PaymentBreakdownItemProps) {
  const percentage = total > 0 ? (amount / total) * 100 : 0;

  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {React.cloneElement(icon as React.ReactElement, {
            sx: { color: color, fontSize: 18 },
          })}
          <Typography variant="body2">{label}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TCurrency value={amount} />
          <Typography variant="caption" color="text.secondary">
            ({percentage.toFixed(1)}%)
          </Typography>
        </Box>
      </Box>
      <LinearProgress
        variant="determinate"
        value={percentage}
        sx={{
          height: 8,
          borderRadius: 4,
          backgroundColor: `${color}20`,
          '& .MuiLinearProgress-bar': {
            backgroundColor: color,
            borderRadius: 4,
          },
        }}
      />
    </Box>
  );
}

interface TransactionBreakdownCardProps {
  label: string;
  amount: number;
  count: number;
  color: 'success' | 'info' | 'primary' | 'warning' | 'error' | 'secondary';
  icon: React.ReactNode;
  isOut?: boolean;
}

function TransactionBreakdownCard({
  label,
  amount,
  count,
  color,
  icon,
  isOut,
}: TransactionBreakdownCardProps) {
  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 2.5,
        borderColor: `${color}.100`,
        bgcolor: 'background.paper',
        boxShadow: '0 1px 8px rgba(15, 23, 42, 0.04)',
      }}
    >
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          {React.cloneElement(icon as React.ReactElement, {
            sx: { color: `${color}.main`, fontSize: 18 },
          })}
          <Typography variant="caption" color="text.secondary" noWrap>
            {label}
          </Typography>
        </Box>
        <Typography
          variant="body1"
          fontWeight={700}
          color={isOut ? 'error.main' : 'success.main'}
          sx={{ mb: 0.25 }}
        >
          {isOut ? '-' : '+'}<TCurrency value={amount} showSymbol={false} />
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {count} {count === 1 ? 'entry' : 'entries'}
        </Typography>
      </CardContent>
    </Card>
  );
}

// Chart Colors
const CHART_COLORS = {
  moneyIn: '#4caf50',
  moneyOut: '#f44336',
  net: '#2196f3',
};

const PIE_COLORS = ['#4caf50', '#2196f3', '#ff9800', '#9c27b0', '#00bcd4'];

const surfaceCardSx = {
  p: 3,
  borderRadius: 3,
  border: '1px solid',
  borderColor: 'divider',
  bgcolor: 'background.paper',
  boxShadow: '0 2px 16px rgba(15, 23, 42, 0.05)',
} as const;

export default function FinanceDashboard() {
  const navigate = useNavigate();
  const [branchCode, setBranchCode] = useState<string | null>(null);

  // Fetch reference data for branches
  const { filteredBranches } = useReferenceData(['branches']);
  const branches = filteredBranches || [];

  // Get current month range
  const today = new Date();
  const monthStart = format(startOfMonth(today), 'yyyy-MM-dd');
  const monthEnd = format(endOfMonth(today), 'yyyy-MM-dd');
  const lastMonthStart = format(startOfMonth(subMonths(today, 1)), 'yyyy-MM-dd');
  const lastMonthEnd = format(endOfMonth(subMonths(today, 1)), 'yyyy-MM-dd');

  // Fetch cashbook data for current month
  const { data: cashbookData, isLoading: cashbookLoading, refetch: refetchCashbook } = useQuery({
    queryKey: ['finance-dashboard-cashbook', branchCode, monthStart, monthEnd],
    queryFn: () => cashbookApi.getReport({
      branch_code: branchCode || undefined,
      date_from: monthStart,
      date_to: monthEnd,
    }),
  });

  // Fetch last month cashbook for comparison
  const { data: lastMonthCashbook } = useQuery({
    queryKey: ['finance-dashboard-cashbook-last-month', branchCode, lastMonthStart, lastMonthEnd],
    queryFn: () => cashbookApi.getReport({
      branch_code: branchCode || undefined,
      date_from: lastMonthStart,
      date_to: lastMonthEnd,
    }),
  });

  // Fetch pending bank deposits
  const { data: pendingDeposits, isLoading: depositsLoading } = useQuery({
    queryKey: ['finance-dashboard-pending-deposits', branchCode],
    queryFn: () => bankDepositsApi.getAll({
      branch_code: branchCode || undefined,
      verified: false,
    }),
  });

  // Fetch expenses - unused but kept for future expansion
  const { isLoading: expensesLoading } = useQuery({
    queryKey: ['finance-dashboard-expenses', branchCode, monthStart, monthEnd],
    queryFn: () => expensesApi.getAll({
      branch_code: branchCode || undefined,
      date_from: monthStart,
      date_to: monthEnd,
    }),
  });

  // Calculate summary values
  const summary = useMemo(() => {
    if (!cashbookData?.summary) {
      return {
        totalIn: 0,
        totalOut: 0,
        netPosition: 0,
        pendingDepositsCount: 0,
        pendingDepositsAmount: 0,
      };
    }

    const s = cashbookData.summary;
    return {
      totalIn: s.total_money_in,
      totalOut: s.total_money_out,
      netPosition: s.total_money_in - s.total_money_out, // net_movement
      pendingDepositsCount: pendingDeposits?.length || 0,
      pendingDepositsAmount: pendingDeposits?.reduce((sum, d) => sum + (d.deposits_amount || 0), 0) || 0,
    };
  }, [cashbookData, pendingDeposits]);

  // Calculate trend compared to last month
  const trends = useMemo(() => {
    if (!lastMonthCashbook?.summary) {
      return { moneyIn: undefined, moneyOut: undefined };
    }

    const lastMonthIn = lastMonthCashbook.summary.total_money_in || 1;
    const lastMonthOut = lastMonthCashbook.summary.total_money_out || 1;

    const moneyInChange = ((summary.totalIn - lastMonthIn) / lastMonthIn) * 100;
    const moneyOutChange = ((summary.totalOut - lastMonthOut) / lastMonthOut) * 100;

    return {
      moneyIn: {
        value: Math.abs(Math.round(moneyInChange)),
        direction: moneyInChange >= 0 ? 'up' : 'down',
        label: 'vs last month',
      },
      moneyOut: {
        value: Math.abs(Math.round(moneyOutChange)),
        direction: moneyOutChange >= 0 ? 'up' : 'down',
        label: 'vs last month',
      },
    };
  }, [summary, lastMonthCashbook]);

  // Payment breakdown data - calculate from entries by payment method
  const paymentBreakdown = useMemo(() => {
    if (!cashbookData?.entries) return [];

    // Calculate breakdown from entries
    const breakdown: Record<string, number> = {};
    cashbookData.entries.forEach((entry: CashbookEntry) => {
      if (entry.money_in > 0 && entry.payment_method) {
        const method = entry.payment_method;
        breakdown[method] = (breakdown[method] || 0) + entry.money_in;
      }
    });

    const colorMap: Record<string, { color: string; icon: React.ReactElement }> = {
      'CASH': { color: '#4caf50', icon: <CashIcon /> },
      'Cash': { color: '#4caf50', icon: <CashIcon /> },
      'CARD': { color: '#2196f3', icon: <CardIcon /> },
      'Card': { color: '#2196f3', icon: <CardIcon /> },
      'CHEQUE': { color: '#ff9800', icon: <ChequeIcon /> },
      'Cheque': { color: '#ff9800', icon: <ChequeIcon /> },
      'BANK_TRANSFER': { color: '#9c27b0', icon: <TransferIcon /> },
      'Bank Transfer': { color: '#9c27b0', icon: <TransferIcon /> },
    };

    return Object.entries(breakdown)
      .map(([label, amount]) => ({
        label,
        amount,
        color: colorMap[label]?.color || '#607d8b',
        icon: colorMap[label]?.icon || <CashIcon />,
      }))
      .filter(item => item.amount > 0);
  }, [cashbookData]);

  // Prepare daily cashflow chart data
  const cashflowChartData = useMemo(() => {
    if (!cashbookData?.entries) return [];

    // Group entries by date
    const dailyData: Record<string, { date: string; in: number; out: number }> = {};

    cashbookData.entries.forEach((entry: CashbookEntry) => {
      const date = entry.transaction_date?.split('T')[0] || '';
      if (!dailyData[date]) {
        dailyData[date] = { date, in: 0, out: 0 };
      }
      dailyData[date].in += entry.money_in || 0;
      dailyData[date].out += entry.money_out || 0;
    });

    return Object.values(dailyData)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14) // Last 14 days
      .map(d => ({
        ...d,
        date: format(new Date(d.date), 'MMM dd'),
        net: d.in - d.out,
      }));
  }, [cashbookData]);

  // Pie chart data for payment methods - derive from entries
  const pieChartData = useMemo(() => {
    if (!cashbookData?.entries) return [];

    const breakdown: Record<string, number> = {};
    cashbookData.entries.forEach((entry: CashbookEntry) => {
      if (entry.money_in > 0 && entry.payment_method) {
        breakdown[entry.payment_method] = (breakdown[entry.payment_method] || 0) + entry.money_in;
      }
    });

    return Object.entries(breakdown)
      .map(([name, value]) => ({ name, value }))
      .filter(item => item.value > 0);
  }, [cashbookData]);

  // Recent transactions
  const recentTransactions = useMemo(() => {
    if (!cashbookData?.entries) return [];
    return [...cashbookData.entries]
      .sort((a, b) => new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime())
      .slice(0, 10);
  }, [cashbookData]);

  // Handle refresh
  const handleRefresh = () => {
    refetchCashbook();
  };

  const isLoading = cashbookLoading || depositsLoading || expensesLoading;

  if (isLoading) {
    return <TPageSkeleton variant="dashboard" />;
  }

  return (
    <Box
      sx={{
        overflow: 'auto',
        minHeight: '100%',
        background: (theme: import('@mui/material').Theme) => theme.palette.mode === 'dark'
          ? `linear-gradient(180deg, ${theme.palette.background.default} 0%, ${theme.palette.background.paper} 280px)`
          : 'radial-gradient(circle at 10% 0%, #f3f7ff 0%, #f8fafc 35%, #ffffff 100%)',
        borderRadius: 2,
        p: { xs: 1, md: 1.5 },
      }}
    >
      {/* Header */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        alignItems={{ xs: "flex-start", sm: "center" }}
        justifyContent="space-between"
        spacing={1.5}
        sx={{ mb: 2.5 }}
      >
        <Box>
          <Typography variant="h5" fontWeight={700}>Finance Dashboard</Typography>
          <Typography variant="caption" color="text.secondary">
            {`Cashflow, deposits and expenses for ${format(today, 'MMMM yyyy')}`}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box sx={{ minWidth: 240 }}>
            <TBranchFilter
              branches={branches}
              value={branchCode}
              onChange={setBranchCode}
            />
          </Box>
          <Tooltip title="Refresh Data">
            <IconButton
              onClick={handleRefresh}
              color="primary"
              sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}
            >
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      {/* KPI Cards */}
      <Grid container spacing={2.5} sx={{ mb: 3.5 }}>
        <Grid item xs={12} sm={6} md={3}>
          <KpiSparkCard
            title="Money In"
            value={<TCurrency value={summary.totalIn} />}
            subtitle="This month"
            icon={<TrendingUpIcon />}
            color="success"
            trend={trends.moneyIn?.value as number | undefined}
            trendLabel="vs last month"
            onClick={() => navigate('/finance/cashbook')}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiSparkCard
            title="Money Out"
            value={<TCurrency value={summary.totalOut} />}
            subtitle="This month"
            icon={<TrendingDownIcon />}
            color="error"
            trend={trends.moneyOut?.value as number | undefined}
            trendLabel="vs last month"
            onClick={() => navigate('/finance/cashbook')}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiSparkCard
            title="Net Position"
            value={<TCurrency value={summary.netPosition} />}
            subtitle={summary.netPosition >= 0 ? 'Positive cashflow' : 'Negative cashflow'}
            icon={<WalletIcon />}
            color={summary.netPosition >= 0 ? 'primary' : 'warning'}
            onClick={() => navigate('/finance/cashbook')}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiSparkCard
            title="Pending Deposits"
            value={summary.pendingDepositsCount}
            subtitle={`Total: Rs. ${fmtLKR(summary.pendingDepositsAmount)}`}
            icon={<PendingIcon />}
            color="warning"
            onClick={() => navigate('/finance/bank-deposits')}
          />
        </Grid>
      </Grid>

      <Paper sx={{ ...surfaceCardSx, mb: 3.5 }}>
        <Typography variant="h6" gutterBottom>
          Transaction Breakdown
        </Typography>
        <Divider sx={{ mb: 2 }} />
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} md={4} lg={2}>
            <TransactionBreakdownCard
              label="Invoice Receipts"
              amount={cashbookData?.summary?.invoice_receipts || 0}
              count={cashbookData?.summary?.invoice_receipts_count || 0}
              color="success"
              icon={<CashIcon />}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4} lg={2}>
            <TransactionBreakdownCard
              label="Customer Advances"
              amount={cashbookData?.summary?.customer_advances || 0}
              count={cashbookData?.summary?.customer_advances_count || 0}
              color="info"
              icon={<AdvanceIcon />}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4} lg={2}>
            <TransactionBreakdownCard
              label="Credit Settlements"
              amount={cashbookData?.summary?.customer_credit_settlements || 0}
              count={cashbookData?.summary?.customer_credit_settlements_count || 0}
              color="primary"
              icon={<CreditNoteIcon />}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4} lg={2}>
            <TransactionBreakdownCard
              label="Supplier Payments"
              amount={cashbookData?.summary?.supplier_payments || 0}
              count={cashbookData?.summary?.supplier_payments_count || 0}
              color="warning"
              icon={<WalletIcon />}
              isOut
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4} lg={2}>
            <TransactionBreakdownCard
              label="Expenses"
              amount={cashbookData?.summary?.expenses || 0}
              count={cashbookData?.summary?.expenses_count || 0}
              color="error"
              icon={<ExpenseIcon />}
              isOut
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4} lg={2}>
            <TransactionBreakdownCard
              label="Bank Deposits"
              amount={cashbookData?.summary?.bank_deposits || 0}
              count={cashbookData?.summary?.bank_deposits_count || 0}
              color="secondary"
              icon={<BankIcon />}
              isOut
            />
          </Grid>
        </Grid>
      </Paper>

      {/* Charts and Breakdown Row */}
      <Grid container spacing={2.5} sx={{ mb: 3.5 }}>
        {/* Cashflow Chart */}
        <Grid item xs={12} md={8}>
          <Paper sx={{ ...surfaceCardSx, height: 420 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Daily Cashflow (Last 14 Days)
            </Typography>
            {cashflowChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={330}>
                <BarChart data={cashflowChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <RechartsTooltip
                    formatter={(value) => value !== undefined ? `Rs. ${fmtLKR(Number(value))}` : ''}
                  />
                  <Legend />
                  <Bar dataKey="in" name="Money In" fill={CHART_COLORS.moneyIn} />
                  <Bar dataKey="out" name="Money Out" fill={CHART_COLORS.moneyOut} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Box
                sx={{
                  height: 330,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Typography color="text.secondary">No cashflow data available</Typography>
              </Box>
            )}
          </Paper>
        </Grid>

        {/* Payment Method Breakdown */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ ...surfaceCardSx, height: 420 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Money In by Payment Method
            </Typography>
            {pieChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={330}>
                <PieChart>
                  <Pie
                    data={pieChartData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} (${((percent || 0) * 100).toFixed(0)}%)`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {pieChartData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    formatter={(value) => value !== undefined ? `Rs. ${fmtLKR(Number(value))}` : ''}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <Box
                sx={{
                  height: 330,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Typography color="text.secondary">No payment data available</Typography>
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Payment Breakdown and Recent Transactions */}
      <Grid container spacing={2.5} sx={{ mb: 1 }}>
        {/* Payment Breakdown Details */}
        <Grid item xs={12} md={4}>
          <Paper sx={surfaceCardSx}>
            <Typography variant="h6" gutterBottom>
              Payment Method Breakdown
            </Typography>
            <Divider sx={{ mb: 2 }} />
            {paymentBreakdown.length > 0 ? (
              paymentBreakdown.map((item) => (
                <PaymentBreakdownItem
                  key={item.label}
                  label={item.label}
                  amount={item.amount}
                  total={summary.totalIn}
                  color={item.color}
                  icon={item.icon}
                />
              ))
            ) : (
              <Typography color="text.secondary" textAlign="center" py={2}>
                No payment data for this period
              </Typography>
            )}
          </Paper>
        </Grid>

        {/* Recent Transactions */}
        <Grid item xs={12} md={8}>
          <Paper sx={surfaceCardSx}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6">Recent Transactions</Typography>
              <Chip
                label="View All"
                size="small"
                clickable
                onClick={() => navigate('/finance/cashbook')}
                icon={<ArrowForwardIcon />}
              />
            </Box>
            <Divider sx={{ mb: 2 }} />
            {recentTransactions.length > 0 ? (
              <Box sx={{ maxHeight: 320, overflow: 'auto' }}>
                {recentTransactions.map((entry, index) => {
                  const isMoneyIn = entry.money_in > 0;
                  const amount = isMoneyIn ? entry.money_in : entry.money_out;
                  return (
                    <Box
                      key={entry.id || index}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        py: 1.5,
                        px: 1,
                        borderRadius: 2,
                        backgroundColor: index % 2 === 0 ? alpha('#f8fafc', 0.75) : '#fff',
                        borderBottom: index < recentTransactions.length - 1 ? '1px solid' : 'none',
                        borderColor: 'divider',
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Box
                          sx={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            backgroundColor: isMoneyIn ? 'success.main' : 'error.main',
                          }}
                        />
                        <Box>
                          <Typography variant="body2" fontWeight="medium">
                            {entry.reference_no || entry.description || 'Transaction'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {entry.transaction_date ? format(new Date(entry.transaction_date), 'MMM dd, yyyy HH:mm') : '-'}
                            {entry.payment_method && ` • ${entry.payment_method}`}
                          </Typography>
                        </Box>
                      </Box>
                      <Typography
                        variant="body2"
                        fontWeight="bold"
                        color={isMoneyIn ? 'success.main' : 'error.main'}
                      >
                        {isMoneyIn ? '+' : '-'}
                        <TCurrency value={amount} />
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            ) : (
              <Typography color="text.secondary" textAlign="center" py={4}>
                No recent transactions
              </Typography>
            )}
          </Paper>
        </Grid>
      </Grid>

    </Box>
  );
}
