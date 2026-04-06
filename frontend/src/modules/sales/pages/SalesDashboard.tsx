import {
  fmtLKR,
  TCurrency,
  TPageHeader,
  TPageSkeleton,
  TStatCard,
  TStatusChip,
} from "@/components/tijaero";
import { useReferenceData } from "@/hooks";
import { useEffect, useMemo, useState } from "react";
import {
  AttachMoney as MoneyIcon,
  Receipt as ReceiptIcon,
  AssignmentReturn as ReturnIcon,
  ShoppingCart as CartIcon,
  People as PeopleIcon,
  BarChart as BarChartIcon,
} from "@mui/icons-material";
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  LinearProgress,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { salesApi } from "../api";

/**
 * Enhanced Sales Dashboard
 *
 * Uses `/sales/statistics` backend endpoint with SQL aggregations.
 * Features: KPI cards, 7-day trend chart, monthly revenue bar chart,
 * payment breakdown, top customers, order status, recent & top invoices.
 */
export default function SalesDashboard() {
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const navigate = useNavigate();
  const theme = useTheme();

  const { filteredBranches, defaultBranchCode } = useReferenceData(["branches"]);
  const branches = filteredBranches || [];

  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  const { data: stats, isLoading, isError, refetch } = useQuery({
    queryKey: ["sales-statistics", filterBranch],
    queryFn: () => salesApi.getStatistics(filterBranch || undefined),
    enabled: branchResolved,
    placeholderData: (prev) => prev,
  });

  // Calculate trends
  const trends = useMemo(() => {
    if (!stats) return { revenue: 0, orders: 0 };
    const revenueTrend = stats.last_month_revenue > 0
      ? ((stats.current_month_revenue - stats.last_month_revenue) / stats.last_month_revenue) * 100
      : 0;
    const ordersTrend = stats.last_month_orders > 0
      ? ((stats.current_month_orders - stats.last_month_orders) / stats.last_month_orders) * 100
      : 0;
    return { revenue: revenueTrend, orders: ordersTrend };
  }, [stats]);

  if (isError) {
    return (
      <Box sx={{ p: 3 }}>
        <TPageHeader title="Sales Dashboard" subtitle="Overview of sales performance and statistics" />
        <Alert
          severity="error"
          action={<Button color="inherit" size="small" onClick={() => refetch()}>Retry</Button>}
          sx={{ mt: 2 }}
        >
          Failed to load dashboard statistics. Please try again.
        </Alert>
      </Box>
    );
  }

  if (isLoading || !stats) {
    return <TPageSkeleton variant="dashboard" />;
  }

  const approvalRate = stats.total_orders > 0
    ? ((stats.approved / stats.total_orders) * 100).toFixed(1)
    : "0";

  return (
    <Box sx={{ p: 3, height: "100%", overflow: "auto" }}>
      <TPageHeader
        title="Sales Dashboard"
        subtitle="Overview of sales performance and statistics"
        actions={
          <Autocomplete
            size="small"
            options={branches}
            getOptionLabel={(option) => `${option.branch_code} - ${option.branch_name}`}
            value={branches.find(b => b.branch_code === filterBranch) || null}
            onChange={(_, newValue) => setFilterBranch(newValue?.branch_code || null)}
            renderInput={(params) => (
              <TextField {...params} placeholder="Filter by Branch" size="small" />
            )}
            sx={{ minWidth: 250 }}
          />
        }
      />

      {/* ── Row 1: KPI Stat Cards ─────────────────────────────────── */}
      <Grid container spacing={3}>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Today's Revenue"
            value={`Rs. ${fmtLKR(stats.today_revenue)}`}
            subtitle={`${stats.today_orders} order${stats.today_orders !== 1 ? "s" : ""} today`}
            icon={<MoneyIcon />}
            color="success"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="This Month Revenue"
            value={`Rs. ${fmtLKR(stats.current_month_revenue)}`}
            subtitle={`Last month: Rs. ${fmtLKR(stats.last_month_revenue)}`}
            icon={<MoneyIcon />}
            color="primary"
            trend={trends.revenue}
            trendLabel="vs last month"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Orders This Month"
            value={stats.current_month_orders}
            subtitle={`Last month: ${stats.last_month_orders}`}
            icon={<CartIcon />}
            color="info"
            trend={trends.orders}
            trendLabel="vs last month"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Avg. Order Value"
            value={`Rs. ${fmtLKR(stats.avg_order_value)}`}
            subtitle={`Total: ${stats.total_orders} orders`}
            icon={<BarChartIcon />}
            color="warning"
          />
        </Grid>

        {/* ── Row 2: Daily Trend Chart + Order Status / Approvals ─── */}
        <Grid item xs={12} md={8}>
          <Paper elevation={0} variant="outlined" sx={{ p: 2, height: "100%" }}>
            <Typography variant="h6" fontWeight={700} gutterBottom>
              Sales Trend — Last 7 Days
            </Typography>
            <Divider sx={{ mb: 2 }} />
            {stats.daily_sales.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 6, color: "text.secondary" }}>
                <ReceiptIcon sx={{ fontSize: 48, mb: 1, opacity: 0.3 }} />
                <Typography>No sales data available</Typography>
              </Box>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={stats.daily_sales}>
                  <defs>
                    <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={theme.palette.success.main} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={theme.palette.success.main} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                  <XAxis dataKey="date" fontSize={12} tick={{ fill: theme.palette.text.secondary }} />
                  <YAxis
                    fontSize={12}
                    tick={{ fill: theme.palette.text.secondary }}
                    tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)}
                  />
                  <RechartsTooltip
                    formatter={(value: number | undefined) => [`Rs. ${fmtLKR(value ?? 0)}`, "Revenue"] as [string, string]}
                    contentStyle={{
                      borderRadius: 8,
                      border: `1px solid ${theme.palette.divider}`,
                      backgroundColor: theme.palette.background.paper,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke={theme.palette.success.main}
                    fill="url(#salesGrad)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={4}>
          <Stack spacing={3} sx={{ height: "100%" }}>
            {/* Order Status Breakdown */}
            <Paper elevation={0} variant="outlined" sx={{ p: 2, flex: 1 }}>
              <Typography variant="h6" fontWeight={700} gutterBottom>
                Order Status
              </Typography>
              <Divider sx={{ mb: 2 }} />
              <Box sx={{ mb: 2 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                  <Typography variant="body2" color="text.secondary">Approved</Typography>
                  <Typography variant="body2" fontWeight={600} color="success.main">{stats.approved}</Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={stats.total_orders > 0 ? (stats.approved / stats.total_orders) * 100 : 0}
                  color="success"
                  sx={{ height: 8, borderRadius: 1 }}
                />
              </Box>
              <Box sx={{ mb: 2 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                  <Typography variant="body2" color="text.secondary">Pending Approval</Typography>
                  <Typography variant="body2" fontWeight={600} color="warning.main">{stats.pending_approval}</Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={stats.total_orders > 0 ? (stats.pending_approval / stats.total_orders) * 100 : 0}
                  color="warning"
                  sx={{ height: 8, borderRadius: 1 }}
                />
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                Approval Rate: {approvalRate}%
              </Typography>
            </Paper>

            {/* Sale Returns */}
            <Paper elevation={0} variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="body2" color="text.secondary">Sale Returns</Typography>
                  <Typography variant="h4" fontWeight={700} color="error.main">{stats.sale_returns_count}</Typography>
                </Box>
                <Avatar sx={{ bgcolor: "error.light", width: 48, height: 48 }}>
                  <ReturnIcon sx={{ color: "error.dark" }} />
                </Avatar>
              </Stack>
            </Paper>
          </Stack>
        </Grid>

        {/* ── Row 3: Monthly Revenue Chart + Payment Breakdown ───── */}
        <Grid item xs={12} md={7}>
          <Paper elevation={0} variant="outlined" sx={{ p: 2, height: "100%" }}>
            <Typography variant="h6" fontWeight={700} gutterBottom>
              Monthly Revenue — Last 6 Months
            </Typography>
            <Divider sx={{ mb: 2 }} />
            {stats.monthly_sales.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 6, color: "text.secondary" }}>
                <Typography>No monthly data</Typography>
              </Box>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={stats.monthly_sales}>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                  <XAxis dataKey="month" fontSize={12} tick={{ fill: theme.palette.text.secondary }} />
                  <YAxis
                    fontSize={12}
                    tick={{ fill: theme.palette.text.secondary }}
                    tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)}
                  />
                  <RechartsTooltip
                    formatter={(value: number | undefined, name: string | undefined) => [
                      name === "revenue" ? `Rs. ${fmtLKR(value ?? 0)}` : value,
                      name === "revenue" ? "Revenue" : "Orders",
                    ] as [string | number | undefined, string]}
                    contentStyle={{
                      borderRadius: 8,
                      border: `1px solid ${theme.palette.divider}`,
                      backgroundColor: theme.palette.background.paper,
                    }}
                  />
                  <Bar dataKey="revenue" fill={theme.palette.primary.main} radius={[4, 4, 0, 0]} name="revenue" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={5}>
          <Paper elevation={0} variant="outlined" sx={{ p: 2, height: "100%" }}>
            <Typography variant="h6" fontWeight={700} gutterBottom>
              Payment Methods
            </Typography>
            <Divider sx={{ mb: 2 }} />
            {[
              { label: "Cash", amount: stats.payment_breakdown.cash, color: "success" as const },
              { label: "Card", amount: stats.payment_breakdown.card, color: "primary" as const },
              { label: "Bank Transfer", amount: stats.payment_breakdown.bank_transfer, color: "info" as const },
              { label: "Credit", amount: stats.payment_breakdown.credit, color: "warning" as const },
              { label: "Cheque", amount: stats.payment_breakdown.cheque, color: "secondary" as const },
            ].map(({ label, amount, color }) => {
              const pct = stats.total_revenue > 0 ? (amount / stats.total_revenue) * 100 : 0;
              return (
                <Box key={label} sx={{ mb: 2 }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                    <Typography variant="body2">{label}</Typography>
                    <Typography variant="body2" fontWeight={500}>
                      Rs. {fmtLKR(amount)} ({pct.toFixed(1)}%)
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={pct}
                    color={color}
                    sx={{ height: 8, borderRadius: 1 }}
                  />
                </Box>
              );
            })}
          </Paper>
        </Grid>

        {/* ── Row 4: Top Customers + Recent Orders ────────────────── */}
        <Grid item xs={12} md={5}>
          <Paper elevation={0} variant="outlined" sx={{ p: 2, height: "100%" }}>
            <Typography variant="h6" fontWeight={700} gutterBottom>
              Top Customers
            </Typography>
            <Divider sx={{ mb: 1 }} />
            {stats.top_customers.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 4 }}>
                <PeopleIcon sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />
                <Typography variant="body2" color="text.secondary">No customer data</Typography>
              </Box>
            ) : (
              <List dense disablePadding>
                {stats.top_customers.map((customer, idx) => (
                  <ListItem key={idx} disablePadding sx={{ py: 0.75 }}>
                    <ListItemAvatar sx={{ minWidth: 40 }}>
                      <Avatar
                        sx={{
                          width: 32,
                          height: 32,
                          fontSize: 14,
                          fontWeight: 700,
                          bgcolor: idx === 0 ? "warning.main" : idx === 1 ? "grey.400" : idx === 2 ? "#CD7F32" : "grey.200",
                          color: idx < 3 ? "white" : "text.primary",
                        }}
                      >
                        {idx + 1}
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={customer.name}
                      secondary={`${customer.orders} order${customer.orders !== 1 ? "s" : ""}`}
                      primaryTypographyProps={{ variant: "body2", fontWeight: 500, noWrap: true }}
                      secondaryTypographyProps={{ variant: "caption" }}
                    />
                    <Typography variant="body2" fontWeight={600} color="success.main" sx={{ whiteSpace: "nowrap" }}>
                      Rs. {fmtLKR(customer.revenue)}
                    </Typography>
                  </ListItem>
                ))}
              </List>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={7}>
          <Paper elevation={0} variant="outlined" sx={{ p: 2, height: "100%" }}>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
              <Typography variant="h6" fontWeight={700}>
                Recent Orders
              </Typography>
              <Chip label={`${stats.total_orders} total`} size="small" color="primary" variant="outlined" />
            </Box>
            <Divider sx={{ mb: 1 }} />
            {stats.recent_invoices.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 4 }}>
                <ReceiptIcon sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />
                <Typography variant="body2" color="text.secondary">No recent orders</Typography>
              </Box>
            ) : (
              <List dense disablePadding>
                {stats.recent_invoices.map((invoice) => (
                  <ListItemButton
                    key={invoice.id}
                    divider
                    onClick={() => navigate(`/sales?invoice=${invoice.id}`)}
                    sx={{ borderRadius: 1 }}
                  >
                    <ListItemText
                      primary={invoice.invoice_no}
                      secondary={format(new Date(invoice.created_date), "MMM dd, yyyy")}
                      primaryTypographyProps={{ variant: "body2", fontWeight: 500 }}
                      secondaryTypographyProps={{ variant: "caption" }}
                    />
                    <Box sx={{ textAlign: "right" }}>
                      <Typography variant="body2" fontWeight={600} color="success.main">
                        <TCurrency value={invoice.total} />
                      </Typography>
                      <TStatusChip
                        status={invoice.approval ? "approved" : "pending"}
                        statusMap="orderStatus"
                        size="small"
                      />
                    </Box>
                  </ListItemButton>
                ))}
              </List>
            )}
          </Paper>
        </Grid>

        {/* ── Row 5: Top Invoices by Value ────────────────────────── */}
        <Grid item xs={12}>
          <Paper elevation={0} variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" fontWeight={700} gutterBottom>
              Top Orders by Value
            </Typography>
            <Divider sx={{ mb: 2 }} />
            {stats.top_invoices.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 3 }}>
                <ReceiptIcon sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />
                <Typography variant="body2" color="text.secondary">No orders yet</Typography>
              </Box>
            ) : (
              <Grid container spacing={2}>
                {stats.top_invoices.map((invoice, index) => (
                  <Grid item xs={12} sm={6} md={2.4} key={invoice.id}>
                    <Card
                      variant="outlined"
                      sx={{ cursor: "pointer", transition: "all 0.2s", "&:hover": { transform: "translateY(-2px)", boxShadow: 2 } }}
                      onClick={() => navigate(`/sales?invoice=${invoice.id}`)}
                    >
                      <CardContent sx={{ textAlign: "center" }}>
                        <Chip label={`#${index + 1}`} size="small" color="primary" sx={{ mb: 1 }} />
                        <Typography variant="subtitle2" noWrap>
                          {invoice.invoice_no}
                        </Typography>
                        <Typography variant="h6" color="success.main" fontWeight={700}>
                          Rs. {fmtLKR(invoice.total)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {format(new Date(invoice.created_date), "MMM dd, yyyy")}
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
