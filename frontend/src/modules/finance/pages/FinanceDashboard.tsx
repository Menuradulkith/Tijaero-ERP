/**
 * FinanceDashboard — "how is the business doing" in under a minute.
 *
 * Every figure comes from ONE source: this month's cashbook entries (1st of the
 * month to today). The Money In / Money Out headlines are the sum of their
 * breakdown tiles (anything without its own tile goes to "Other"), the charts
 * are built from the same rows, and the comparison is the same days of last
 * month. A bank deposit only moves cash into the bank, so it is shown apart and
 * not counted as money out.
 */
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
  IconButton,
  Tooltip,
  Divider,
  Stack,
  Avatar,
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
  TrendingFlat as TrendingFlatIcon,
  Refresh as RefreshIcon,
  ArrowForward as ArrowForwardIcon,
  AccountBalanceWallet as WalletIcon,
  SwapHoriz as TransferIcon,
  PointOfSale as CashIcon,
  PendingActions as PendingIcon,
  CardGiftcard as VoucherIcon,
  MoreHoriz as OtherIcon,
  Groups as SalaryIcon,
  Handshake as LoanIcon,
  Business as AssetIcon,
  LocalShipping as GoodsIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
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
import { TChip, TCurrency, TPageSkeleton, TBranchFilter, fmtLKR } from '@/components/tijaero';
import { KpiSparkCard } from '@/components/dashboard';
import { cashbookApi, bankDepositsApi } from '../api';
import { CashbookEntry } from '../types';
import { useReferenceData } from '@/hooks';
import { useCurrencyStore } from '@/state/currencyStore';
import { daysAgoISO, displayDate, localDateISO, startOfMonthISO, todayISO } from '@/utils/formatters';

// ─── Period helpers ─────────────────────────────────────────────────────────

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "1–7 Nov" (same month) for two YYYY-MM-DD dates. */
function shortRange(from: string, to: string) {
  const [, fm, fd] = from.split('-').map(Number);
  const [, tm, td] = to.split('-').map(Number);
  if (fm === tm) return fd === td ? `${fd} ${MONTHS_SHORT[fm - 1]}` : `${fd}–${td} ${MONTHS_SHORT[fm - 1]}`;
  return `${fd} ${MONTHS_SHORT[fm - 1]} – ${td} ${MONTHS_SHORT[tm - 1]}`;
}

/** The same days of the previous month: 1–7 Nov → 1–7 Oct (clamped to that month's length). */
function sameDaysLastMonth(today: Date) {
  const y = today.getFullYear();
  const m = today.getMonth();
  const lastDayPrev = new Date(y, m, 0).getDate();
  return {
    from: localDateISO(new Date(y, m - 1, 1)),
    to: localDateISO(new Date(y, m - 1, Math.min(today.getDate(), lastDayPrev))),
  };
}

// ─── Grouping the cashbook rows ─────────────────────────────────────────────

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

type Tone = 'success' | 'info' | 'primary' | 'warning' | 'error' | 'secondary';

interface Category {
  key: string;
  label: string;
  direction: 'in' | 'out';
  color: Tone;
  icon: React.ReactElement;
}

const IN_CATEGORIES: Category[] = [
  { key: 'invoice_receipt', label: 'Sales paid now', direction: 'in', color: 'success', icon: <CashIcon /> },
  { key: 'customer_credit_settle', label: 'Customers paying their credit', direction: 'in', color: 'primary', icon: <CreditNoteIcon /> },
  { key: 'customer_advance', label: 'Customer advances', direction: 'in', color: 'info', icon: <AdvanceIcon /> },
  { key: 'voucher_sale', label: 'Gift vouchers sold', direction: 'in', color: 'secondary', icon: <VoucherIcon /> },
  { key: 'purchase_return', label: 'Refunds from suppliers', direction: 'in', color: 'success', icon: <CreditNoteIcon /> },
  { key: 'gl_employee_loan', label: 'Staff loans paid back', direction: 'in', color: 'info', icon: <LoanIcon /> },
  { key: 'fixed_asset', label: 'Assets sold', direction: 'in', color: 'secondary', icon: <AssetIcon /> },
];
const OUT_CATEGORIES: Category[] = [
  { key: 'supplier_payment', label: 'Paid to suppliers', direction: 'out', color: 'warning', icon: <WalletIcon /> },
  { key: 'supplier_advance', label: 'Supplier advances', direction: 'out', color: 'warning', icon: <AdvanceIcon /> },
  { key: 'expense', label: 'Expenses', direction: 'out', color: 'error', icon: <ExpenseIcon /> },
  { key: 'grn_payment', label: 'Goods paid on delivery', direction: 'out', color: 'warning', icon: <GoodsIcon /> },
  { key: 'salaries', label: 'Salaries and EPF / ETF', direction: 'out', color: 'primary', icon: <SalaryIcon /> },
  { key: 'gl_employee_loan', label: 'Staff loans and advances', direction: 'out', color: 'info', icon: <LoanIcon /> },
  { key: 'fixed_asset', label: 'Assets bought', direction: 'out', color: 'secondary', icon: <AssetIcon /> },
];
/** Out tiles shown even when empty this month. */
const ALWAYS_OUT = new Set(['supplier_payment', 'expense']);

/** Which tile a row belongs to (same rules as the cashbook summary). Null = a bank deposit (transfer). */
function categoryOf(e: CashbookEntry): string | null {
  if (e.entry_type === 'bank_deposit') return null;
  if (e.source_table === 'supplier_advance_payment') return 'supplier_advance';
  if (e.entry_type === 'supplier_payment' || e.source_table === 'supplier_payments') return 'supplier_payment';
  if (e.entry_type === 'payroll' || e.entry_type === 'statutory_payment') return 'salaries';
  return e.entry_type;
}

const humanize = (s: string) => {
  const t = (s || 'other').replace(/^gl_/, '').replace(/_/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

interface Totals {
  moneyIn: number;
  moneyOut: number;
  /** category key -> { amount, count } split by direction */
  in: Record<string, { amount: number; count: number }>;
  out: Record<string, { amount: number; count: number }>;
  otherInTypes: Set<string>;
  otherOutTypes: Set<string>;
  bankDeposits: number;
  bankDepositsCount: number;
}

function summarise(entries: CashbookEntry[] | undefined): Totals {
  const t: Totals = {
    moneyIn: 0,
    moneyOut: 0,
    in: {},
    out: {},
    otherInTypes: new Set(),
    otherOutTypes: new Set(),
    bankDeposits: 0,
    bankDepositsCount: 0,
  };
  const knownIn = new Set(IN_CATEGORIES.map((c) => c.key));
  const knownOut = new Set(OUT_CATEGORIES.map((c) => c.key));
  (entries ?? []).forEach((e) => {
    const mi = num(e.money_in);
    const mo = num(e.money_out);
    const cat = categoryOf(e);
    if (cat === null) {
      t.bankDeposits += mo;
      t.bankDepositsCount += 1;
      return;
    }
    if (mi > 0) {
      t.moneyIn += mi;
      const key = knownIn.has(cat) ? cat : 'other';
      if (key === 'other') t.otherInTypes.add(humanize(e.entry_type));
      const b = (t.in[key] ??= { amount: 0, count: 0 });
      b.amount += mi;
      b.count += 1;
    }
    if (mo > 0) {
      t.moneyOut += mo;
      const key = knownOut.has(cat) ? cat : 'other';
      if (key === 'other') t.otherOutTypes.add(humanize(e.entry_type));
      const b = (t.out[key] ??= { amount: 0, count: 0 });
      b.amount += mo;
      b.count += 1;
    }
  });
  return t;
}

/** % change, or null when last period had nothing to compare with. */
const pctChange = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null);

// ─── Cards ──────────────────────────────────────────────────────────────────

const PALETTE = {
  success: '#059669',
  error: '#dc2626',
  warning: '#d97706',
  primary: '#2563eb',
};

/**
 * Money In / Money Out card. The arrow is coloured by what the change MEANS:
 * more money in is good (green); more money out is a warning (amber/red).
 */
function MoneyCard({
  title,
  value,
  subtitle,
  icon,
  color,
  change,
  goodWhenUp,
  compareLabel,
  onClick,
}: {
  title: string;
  value: number;
  subtitle: string;
  icon: React.ReactElement;
  color: keyof typeof PALETTE;
  change: number | null;
  goodWhenUp: boolean;
  compareLabel: string;
  onClick?: () => void;
}) {
  const main = PALETTE[color];
  const dir = change === null ? 'none' : change > 0.5 ? 'up' : change < -0.5 ? 'down' : 'flat';
  const good = dir === 'flat' ? null : (dir === 'up') === goodWhenUp;
  const trendColor =
    good === null ? 'text.secondary' : good ? 'success.main' : goodWhenUp ? 'error.main' : Math.abs(change ?? 0) > 25 ? 'error.main' : 'warning.main';
  const TrendIcon = dir === 'up' ? TrendingUpIcon : dir === 'down' ? TrendingDownIcon : TrendingFlatIcon;

  return (
    <Card
      elevation={0}
      onClick={onClick}
      sx={{
        p: 2.25,
        height: '100%',
        borderRadius: 3,
        border: '1px solid',
        borderColor: 'divider',
        cursor: onClick ? 'pointer' : 'default',
        background: (theme) =>
          theme.palette.mode === 'dark'
            ? `linear-gradient(160deg, ${theme.palette.background.paper} 0%, ${alpha(main, 0.08)} 100%)`
            : `linear-gradient(160deg, #ffffff 0%, ${alpha(main, 0.04)} 100%)`,
        transition: 'transform .18s ease, box-shadow .18s ease',
        '&:hover': onClick ? { transform: 'translateY(-2px)', boxShadow: '0 12px 28px -16px rgba(15,23,42,0.25)' } : undefined,
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1.5}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: 0.4 }}>
            {title.toUpperCase()}
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 800, mt: 0.5, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>
            <TCurrency component="span" value={value} />
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
            {subtitle}
          </Typography>
        </Box>
        <Avatar variant="rounded" sx={{ bgcolor: alpha(main, 0.12), color: main, width: 44, height: 44, borderRadius: 2 }}>
          {icon}
        </Avatar>
      </Stack>
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 1.5 }}>
        {change === null ? (
          <Typography variant="caption" color="text.secondary">
            Nothing to compare with ({compareLabel})
          </Typography>
        ) : (
          <>
            <TrendIcon sx={{ fontSize: 16, color: trendColor }} />
            <Typography variant="caption" sx={{ color: trendColor, fontWeight: 700 }}>
              {change > 0 ? '+' : ''}
              {change.toFixed(0)}%
            </Typography>
            <Typography variant="caption" color="text.secondary">
              vs {compareLabel}
            </Typography>
          </>
        )}
      </Stack>
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
          <TCurrency component="span" value={amount} />
          <Typography variant="caption" color="text.secondary">
            ({percentage.toFixed(1)}%)
          </Typography>
        </Box>
      </Box>
      <LinearProgress
        variant="determinate"
        value={Math.min(100, percentage)}
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
  color: Tone;
  icon: React.ReactNode;
  isOut?: boolean;
  hint?: string;
}

function TransactionBreakdownCard({ label, amount, count, color, icon, isOut, hint }: TransactionBreakdownCardProps) {
  const card = (
    <Card
      variant="outlined"
      sx={{
        height: '100%',
        borderRadius: 2.5,
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
          sx={{ mb: 0.25, fontVariantNumeric: 'tabular-nums' }}
        >
          {isOut ? '-' : '+'}<TCurrency component="span" value={amount} showSymbol={false} />
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {count} {count === 1 ? 'entry' : 'entries'}
        </Typography>
      </CardContent>
    </Card>
  );
  return hint ? <Tooltip title={hint}>{card}</Tooltip> : card;
}

// Chart Colors
const CHART_COLORS = {
  moneyIn: '#4caf50',
  moneyOut: '#f44336',
};

const METHOD_STYLE: Record<string, { color: string; icon: React.ReactElement }> = {
  cash: { color: '#4caf50', icon: <CashIcon /> },
  card: { color: '#2196f3', icon: <CardIcon /> },
  visa: { color: '#2196f3', icon: <CardIcon /> },
  mastercard: { color: '#1565c0', icon: <CardIcon /> },
  amex: { color: '#0d47a1', icon: <CardIcon /> },
  'credit card': { color: '#2196f3', icon: <CardIcon /> },
  cheque: { color: '#ff9800', icon: <ChequeIcon /> },
  'bank transfer': { color: '#9c27b0', icon: <TransferIcon /> },
  'bank deposit': { color: '#9c27b0', icon: <BankIcon /> },
};
const FALLBACK_COLORS = ['#00bcd4', '#795548', '#607d8b', '#e91e63', '#8bc34a'];

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
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const [branchCode, setBranchCode] = useState<string | null>(null);

  // Fetch reference data for branches
  const { filteredBranches } = useReferenceData(['branches']);
  const branches = filteredBranches || [];

  // This month so far (local dates), and the same days of last month.
  const today = new Date();
  const monthStart = startOfMonthISO(today);
  const todayStr = todayISO();
  const last = sameDaysLastMonth(today);
  const periodLabel = `This month: ${shortRange(monthStart, todayStr)}`;
  const compareLabel = shortRange(last.from, last.to);

  const { data: cashbookData, isLoading: cashbookLoading, refetch: refetchCashbook } = useQuery({
    queryKey: ['finance-dashboard-cashbook', branchCode, monthStart, todayStr],
    queryFn: () => cashbookApi.getReport({
      branch_code: branchCode || undefined,
      date_from: monthStart,
      date_to: todayStr,
    }),
  });

  const { data: lastMonthCashbook, refetch: refetchLast } = useQuery({
    queryKey: ['finance-dashboard-cashbook-last-month', branchCode, last.from, last.to],
    queryFn: () => cashbookApi.getReport({
      branch_code: branchCode || undefined,
      date_from: last.from,
      date_to: last.to,
    }),
  });

  const { data: pendingDeposits, isLoading: depositsLoading, refetch: refetchDeposits } = useQuery({
    queryKey: ['finance-dashboard-pending-deposits', branchCode],
    queryFn: () => bankDepositsApi.getAll({
      branch_code: branchCode || undefined,
      verified: false,
      limit: 1000,
    }),
  });

  // One pass over the rows: headline, tiles and "Other" all come from here.
  const totals = useMemo(() => summarise(cashbookData?.entries), [cashbookData]);
  const lastTotals = useMemo(() => summarise(lastMonthCashbook?.entries), [lastMonthCashbook]);
  const netPosition = totals.moneyIn - totals.moneyOut;
  const pendingDepositsCount = pendingDeposits?.length || 0;
  const pendingDepositsAmount = pendingDeposits?.reduce((sum, d) => sum + num(d.deposits_amount), 0) || 0;

  const inChange = lastMonthCashbook ? pctChange(totals.moneyIn, lastTotals.moneyIn) : null;
  const outChange = lastMonthCashbook ? pctChange(totals.moneyOut, lastTotals.moneyOut) : null;

  // Money in by payment method — same rows, same total as the Money In card.
  const paymentBreakdown = useMemo(() => {
    const breakdown: Record<string, number> = {};
    (cashbookData?.entries ?? []).forEach((entry: CashbookEntry) => {
      const mi = num(entry.money_in);
      if (mi <= 0 || categoryOf(entry) === null) return;
      const method = (entry.payment_method || '').trim() || 'Not recorded';
      breakdown[method] = (breakdown[method] || 0) + mi;
    });
    return Object.entries(breakdown)
      .filter(([, amount]) => amount > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([label, amount], i) => {
        const style = METHOD_STYLE[label.toLowerCase()];
        return {
          label,
          amount,
          color: style?.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length],
          icon: style?.icon || <CashIcon />,
        };
      });
  }, [cashbookData]);

  // Daily cashflow for the last 14 days of the period
  const cashflowChartData = useMemo(() => {
    const fromDay = daysAgoISO(13);
    const dailyData: Record<string, { day: string; in: number; out: number }> = {};
    (cashbookData?.entries ?? []).forEach((entry: CashbookEntry) => {
      if (categoryOf(entry) === null) return; // a bank deposit is not money out
      const day = (entry.transaction_date || '').slice(0, 10);
      if (!day || day < fromDay) return;
      const d = (dailyData[day] ??= { day, in: 0, out: 0 });
      d.in += num(entry.money_in);
      d.out += num(entry.money_out);
    });
    return Object.values(dailyData)
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((d) => ({ ...d, date: displayDate(d.day).slice(0, 6) }));
  }, [cashbookData]);

  // Recent transactions
  const recentTransactions = useMemo(() => {
    if (!cashbookData?.entries) return [];
    return [...cashbookData.entries]
      .sort((a, b) => new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime())
      .slice(0, 10);
  }, [cashbookData]);

  const handleRefresh = () => {
    refetchCashbook();
    refetchLast();
    refetchDeposits();
  };

  const isLoading = cashbookLoading || depositsLoading;

  if (isLoading) {
    return <TPageSkeleton variant="dashboard" />;
  }

  const otherIn = totals.in.other;
  const otherOut = totals.out.other;

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
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
            <TChip label={periodLabel} size="small" color="primary" variant="outlined" />
            <Typography variant="caption" color="text.secondary">
              Money that came in and went out, compared with {compareLabel}
            </Typography>
          </Stack>
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
          <MoneyCard
            title="Money In"
            value={totals.moneyIn}
            subtitle={periodLabel}
            icon={<TrendingUpIcon />}
            color="success"
            change={inChange}
            goodWhenUp
            compareLabel={compareLabel}
            onClick={() => navigate('/finance/cashbook')}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MoneyCard
            title="Money Out"
            value={totals.moneyOut}
            subtitle={periodLabel}
            icon={<TrendingDownIcon />}
            color="error"
            change={outChange}
            goodWhenUp={false}
            compareLabel={compareLabel}
            onClick={() => navigate('/finance/cashbook')}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiSparkCard
            title="Net Position"
            value={<TCurrency component="span" value={netPosition} />}
            subtitle={netPosition >= 0 ? 'More came in than went out' : 'More went out than came in'}
            icon={<WalletIcon />}
            color={netPosition >= 0 ? 'primary' : 'warning'}
            onClick={() => navigate('/finance/cashbook')}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiSparkCard
            title="Pending Deposits"
            value={pendingDepositsCount}
            subtitle={`Total: ${currencySymbol} ${fmtLKR(pendingDepositsAmount)}`}
            icon={<PendingIcon />}
            color="warning"
            onClick={() => navigate('/finance/bank-deposits')}
          />
        </Grid>
      </Grid>

      <Paper sx={{ ...surfaceCardSx, mb: 3.5 }}>
        <Typography variant="h6" gutterBottom>
          Where the money came from and went
        </Typography>
        <Divider sx={{ mb: 2 }} />

        <Typography variant="subtitle2" color="success.main" sx={{ mb: 1 }}>
          Money in: {currencySymbol} {fmtLKR(totals.moneyIn)}
        </Typography>
        <Grid container spacing={2} sx={{ mb: 2.5 }}>
          {IN_CATEGORIES.filter((c) => totals.in[c.key] || c.key === 'invoice_receipt').map((c) => (
            <Grid item xs={12} sm={6} md={4} lg={2} key={c.key}>
              <TransactionBreakdownCard
                label={c.label}
                amount={totals.in[c.key]?.amount ?? 0}
                count={totals.in[c.key]?.count ?? 0}
                color={c.color}
                icon={c.icon}
              />
            </Grid>
          ))}
          {otherIn && (
            <Grid item xs={12} sm={6} md={4} lg={2}>
              <TransactionBreakdownCard
                label="Other money in"
                amount={otherIn.amount}
                count={otherIn.count}
                color="info"
                icon={<OtherIcon />}
                hint={`Includes: ${[...totals.otherInTypes].join(', ')}`}
              />
            </Grid>
          )}
        </Grid>

        <Typography variant="subtitle2" color="error.main" sx={{ mb: 1 }}>
          Money out: {currencySymbol} {fmtLKR(totals.moneyOut)}
        </Typography>
        <Grid container spacing={2}>
          {OUT_CATEGORIES.filter((c) => totals.out[c.key] || ALWAYS_OUT.has(c.key)).map((c) => (
            <Grid item xs={12} sm={6} md={4} lg={2} key={c.key}>
              <TransactionBreakdownCard
                label={c.label}
                amount={totals.out[c.key]?.amount ?? 0}
                count={totals.out[c.key]?.count ?? 0}
                color={c.color}
                icon={c.icon}
                isOut
              />
            </Grid>
          ))}
          {otherOut && (
            <Grid item xs={12} sm={6} md={4} lg={2}>
              <TransactionBreakdownCard
                label="Other money out"
                amount={otherOut.amount}
                count={otherOut.count}
                color="secondary"
                icon={<OtherIcon />}
                isOut
                hint={`Includes: ${[...totals.otherOutTypes].join(', ')}`}
              />
            </Grid>
          )}
        </Grid>

        {totals.bankDepositsCount > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 2 }}>
            <BankIcon sx={{ fontSize: 16 }} />
            Cash moved to the bank this month: {currencySymbol} {fmtLKR(totals.bankDeposits)} ({totals.bankDepositsCount}{' '}
            {totals.bankDepositsCount === 1 ? 'deposit' : 'deposits'}). It is still your money, so it is not counted as money out.
          </Typography>
        )}
      </Paper>

      {/* Charts and Breakdown Row */}
      <Grid container spacing={2.5} sx={{ mb: 3.5 }}>
        {/* Cashflow Chart */}
        <Grid item xs={12} md={8}>
          <Paper sx={{ ...surfaceCardSx, height: 420 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Money in and out per day
            </Typography>
            {cashflowChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={330}>
                <BarChart data={cashflowChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => fmtLKR(Number(v)).replace(/\.00$/, '')} />
                  <RechartsTooltip
                    formatter={(value) => value !== undefined ? `${currencySymbol} ${fmtLKR(Number(value))}` : ''}
                  />
                  <Legend />
                  <Bar dataKey="in" name="Money In" fill={CHART_COLORS.moneyIn} />
                  <Bar dataKey="out" name="Money Out" fill={CHART_COLORS.moneyOut} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Box sx={{ height: 330, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography color="text.secondary">No money in or out yet this month</Typography>
              </Box>
            )}
          </Paper>
        </Grid>

        {/* Payment Method Pie */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ ...surfaceCardSx, height: 420 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Money In by Payment Method
            </Typography>
            {paymentBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={330}>
                <PieChart>
                  <Pie
                    data={paymentBreakdown.map((p) => ({
                      name: `${p.label} (${totals.moneyIn > 0 ? ((p.amount / totals.moneyIn) * 100).toFixed(0) : 0}%)`,
                      value: p.amount,
                    }))}
                    cx="50%"
                    cy="45%"
                    labelLine={false}
                    outerRadius={95}
                    dataKey="value"
                  >
                    {paymentBreakdown.map((p) => (
                      <Cell key={p.label} fill={p.color} />
                    ))}
                  </Pie>
                  <Legend verticalAlign="bottom" iconType="circle" />
                  <RechartsTooltip
                    formatter={(value) => value !== undefined ? `${currencySymbol} ${fmtLKR(Number(value))}` : ''}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <Box sx={{ height: 330, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography color="text.secondary">No money in yet this month</Typography>
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Payment Breakdown and Recent Transactions */}
      <Grid container spacing={2.5} sx={{ mb: 1 }}>
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
                  total={totals.moneyIn}
                  color={item.color}
                  icon={item.icon}
                />
              ))
            ) : (
              <Typography color="text.secondary" textAlign="center" py={2}>
                No money in yet this month
              </Typography>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={8}>
          <Paper sx={surfaceCardSx}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6">Recent Transactions</Typography>
              <TChip
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
                  const isTransfer = categoryOf(entry) === null;
                  const isMoneyIn = num(entry.money_in) > 0;
                  const amount = isMoneyIn ? num(entry.money_in) : num(entry.money_out);
                  const tone = isTransfer ? 'text.secondary' : isMoneyIn ? 'success.main' : 'error.main';
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
                        backgroundColor: (theme) =>
                          index % 2 === 0 ? theme.palette.action.hover : 'transparent',
                        borderBottom: index < recentTransactions.length - 1 ? '1px solid' : 'none',
                        borderColor: 'divider',
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: tone }} />
                        <Box>
                          <Typography variant="body2" fontWeight="medium">
                            {entry.reference_no || entry.description || 'Transaction'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {entry.transaction_date ? displayDate(entry.transaction_date) : '-'}
                            {entry.payment_method && ` • ${entry.payment_method}`}
                            {isTransfer && ' • moved to bank'}
                          </Typography>
                        </Box>
                      </Box>
                      <Typography variant="body2" fontWeight="bold" color={tone} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {isTransfer ? '' : isMoneyIn ? '+' : '-'}
                        <TCurrency component="span" value={amount} />
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            ) : (
              <Typography color="text.secondary" textAlign="center" py={4}>
                No transactions yet this month
              </Typography>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
