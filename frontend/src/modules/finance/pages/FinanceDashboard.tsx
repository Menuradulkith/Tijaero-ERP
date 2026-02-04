import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Grid,
  Paper,
  Typography,
  Card,
  CardContent,
  CardActionArea,
  LinearProgress,
  Chip,
  IconButton,
  Tooltip,
  Divider,
  Stack,
} from '@mui/material';
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
import { TPageHeader, TCurrency, TLoading, TBranchFilter } from '@/components/tijaero';
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
    primary: { bg: '#e3f2fd', iconBg: '#1976d2', iconColor: '#fff' },
    success: { bg: '#e8f5e9', iconBg: '#2e7d32', iconColor: '#fff' },
    error: { bg: '#ffebee', iconBg: '#d32f2f', iconColor: '#fff' },
    warning: { bg: '#fff3e0', iconBg: '#ed6c02', iconColor: '#fff' },
    info: { bg: '#e1f5fe', iconBg: '#0288d1', iconColor: '#fff' },
  };

  const colors = colorMap[color];

  return (
    <Card
      sx={{
        height: '100%',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.2s ease-in-out',
        '&:hover': onClick ? { transform: 'translateY(-2px)', boxShadow: 3 } : {},
      }}
      onClick={onClick}
    >
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {title}
            </Typography>
            <Typography variant="h4" fontWeight="bold" color="text.primary">
              {value}
            </Typography>
            {subtitle && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {subtitle}
              </Typography>
            )}
            {trend && (
              <Box sx={{ display: 'flex', alignItems: 'center', mt: 1, gap: 0.5 }}>
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
              backgroundColor: colors.iconBg,
              borderRadius: 2,
              p: 1.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
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

// Module Quick Access Card
interface ModuleCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  path: string;
  count?: number;
  color: string;
}

function ModuleCard({ title, description, icon, path, count, color }: ModuleCardProps) {
  const navigate = useNavigate();

  return (
    <Card sx={{ height: '100%' }}>
      <CardActionArea onClick={() => navigate(path)} sx={{ height: '100%' }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box
              sx={{
                backgroundColor: `${color}15`,
                borderRadius: 2,
                p: 1.5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {React.cloneElement(icon as React.ReactElement, {
                sx: { color: color, fontSize: 28 },
              })}
            </Box>
            <Box sx={{ flex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="subtitle1" fontWeight="medium">
                  {title}
                </Typography>
                {count !== undefined && (
                  <Chip
                    label={count}
                    size="small"
                    color="primary"
                    sx={{ minWidth: 40 }}
                  />
                )}
              </Box>
              <Typography variant="body2" color="text.secondary">
                {description}
              </Typography>
            </Box>
            <ArrowForwardIcon sx={{ color: 'text.secondary' }} />
          </Box>
        </CardContent>
      </CardActionArea>
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

// Chart Colors
const CHART_COLORS = {
  moneyIn: '#4caf50',
  moneyOut: '#f44336',
  net: '#2196f3',
};

const PIE_COLORS = ['#4caf50', '#2196f3', '#ff9800', '#9c27b0', '#00bcd4'];

export default function FinanceDashboard() {
  const navigate = useNavigate();
  const [branchCode, setBranchCode] = useState<string | null>(null);

  // Fetch reference data for branches
  const { data: refData } = useReferenceData(['branches']);
  const branches = refData?.branches || [];

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
    return <TLoading message="Loading Finance Dashboard..." />;
  }

  return (
    <Box sx={{ overflow: "auto" }}>
      {/* Header */}
      <TPageHeader
        title="Finance Dashboard"
        subtitle={`Financial overview for ${format(today, 'MMMM yyyy')}`}
        actions={
          <Stack direction="row" spacing={2} alignItems="center">
            <Box sx={{ minWidth: 280 }}>
              <TBranchFilter 
                branches={branches} 
                value={branchCode} 
                onChange={setBranchCode} 
              />
            </Box>
            <Tooltip title="Refresh Data">
              <IconButton onClick={handleRefresh} color="primary">
                <RefreshIcon />
              </IconButton>
            </Tooltip>
          </Stack>
        }
      />

      {/* KPI Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Total Money In"
            value={<TCurrency value={summary.totalIn} />}
            subtitle="This month"
            icon={<TrendingUpIcon />}
            color="success"
            trend={trends.moneyIn as any}
            onClick={() => navigate('/finance/cashbook')}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Total Money Out"
            value={<TCurrency value={summary.totalOut} />}
            subtitle="This month"
            icon={<TrendingDownIcon />}
            color="error"
            trend={trends.moneyOut as any}
            onClick={() => navigate('/finance/cashbook')}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Net Position"
            value={<TCurrency value={summary.netPosition} />}
            subtitle={summary.netPosition >= 0 ? 'Positive cashflow' : 'Negative cashflow'}
            icon={<WalletIcon />}
            color={summary.netPosition >= 0 ? 'primary' : 'warning'}
            onClick={() => navigate('/finance/cashbook')}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Pending Deposits"
            value={summary.pendingDepositsCount}
            subtitle={`Total: $${summary.pendingDepositsAmount.toLocaleString()}`}
            icon={<PendingIcon />}
            color="warning"
            onClick={() => navigate('/finance/bank-deposits')}
          />
        </Grid>
      </Grid>

      {/* Charts and Breakdown Row */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        {/* Cashflow Chart */}
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3, height: 400 }}>
            <Typography variant="h6" gutterBottom>
              Daily Cashflow (Last 14 Days)
            </Typography>
            {cashflowChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={cashflowChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <RechartsTooltip
                    formatter={(value) => value !== undefined ? `$${Number(value).toLocaleString()}` : ''}
                  />
                  <Legend />
                  <Bar dataKey="in" name="Money In" fill={CHART_COLORS.moneyIn} />
                  <Bar dataKey="out" name="Money Out" fill={CHART_COLORS.moneyOut} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Box
                sx={{
                  height: 320,
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
          <Paper sx={{ p: 3, height: 400 }}>
            <Typography variant="h6" gutterBottom>
              Money In by Payment Method
            </Typography>
            {pieChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
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
                    formatter={(value) => value !== undefined ? `$${Number(value).toLocaleString()}` : ''}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <Box
                sx={{
                  height: 320,
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
      <Grid container spacing={3} sx={{ mb: 3 }}>
        {/* Payment Breakdown Details */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3 }}>
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
          <Paper sx={{ p: 3 }}>
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
              <Box sx={{ maxHeight: 300, overflow: 'auto' }}>
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

      {/* Quick Access Modules */}
      <Typography variant="h6" sx={{ mb: 2 }}>
        Finance Modules
      </Typography>
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={4}>
          <ModuleCard
            title="Cashbook"
            description="Track all money in/out transactions"
            icon={<WalletIcon />}
            path="/finance/cashbook"
            color="#4caf50"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <ModuleCard
            title="Bank Deposits"
            description="Manage and verify bank deposits"
            icon={<BankIcon />}
            path="/finance/bank-deposits"
            count={summary.pendingDepositsCount}
            color="#2196f3"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <ModuleCard
            title="Bank Transfer Verify"
            description="Verify pending bank transfers"
            icon={<TransferIcon />}
            path="/finance/bank-transfer-verify"
            color="#9c27b0"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <ModuleCard
            title="Card Payments"
            description="Track card payment settlements"
            icon={<CardIcon />}
            path="/finance/card-payments"
            color="#ff9800"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <ModuleCard
            title="Cheque Payments"
            description="Manage cheque processing"
            icon={<ChequeIcon />}
            path="/finance/cheque-payments"
            color="#00bcd4"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <ModuleCard
            title="Expenses"
            description="Track business expenses"
            icon={<ExpenseIcon />}
            path="/finance/expenses"
            color="#f44336"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <ModuleCard
            title="Advance Payments"
            description="Manage customer advances"
            icon={<AdvanceIcon />}
            path="/finance/advance-payments"
            color="#607d8b"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <ModuleCard
            title="Credit Notes"
            description="Handle refunds and credits"
            icon={<CreditNoteIcon />}
            path="/finance/credit-notes"
            color="#795548"
          />
        </Grid>
      </Grid>
    </Box>
  );
}
