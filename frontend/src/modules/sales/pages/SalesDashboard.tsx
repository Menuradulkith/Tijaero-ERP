/**
 * Sales Dashboard — modernized.
 *
 * Inspired by Odoo, Zoho Books and NetSuite sales overviews:
 * - Gradient hero with greeting, branch filter, refresh and "+ New Order" CTA
 * - KPI cards with inline sparklines and trend deltas
 * - Combined revenue / orders chart (last 7 days)
 * - Payment-method donut + Order status donut
 * - Monthly revenue bar
 * - Top customers leaderboard with avatar ranks
 * - Recent orders + Top orders by value
 *
 * All data sourced from `/sales/statistics` (no UI-side mocking).
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  Grid,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from "@mui/material";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import BarChartIcon from "@mui/icons-material/BarChart";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import LaunchIcon from "@mui/icons-material/Launch";
import PeopleIcon from "@mui/icons-material/People";
import ReceiptIcon from "@mui/icons-material/Receipt";
import RefreshIcon from "@mui/icons-material/Refresh";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";

import {
  BreakdownDonut,
  DashboardPanel,
  KpiSparkCard,
  type BreakdownSlice,
} from "@/components/dashboard";
import { fmtLKR, TPageSkeleton, TStatusChip } from "@/components/tijaero";
import { useReferenceData } from "@/hooks";
import { salesApi } from "../api";

export default function SalesDashboard() {
  const navigate = useNavigate();
  const theme = useTheme();
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  const { filteredBranches, defaultBranchCode } = useReferenceData(["branches"]);
  const branches = filteredBranches || [];

  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) setFilterBranch(defaultBranchCode);
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  const { data: stats, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["sales-statistics", filterBranch],
    queryFn: () => salesApi.getStatistics(filterBranch || undefined),
    enabled: branchResolved,
    placeholderData: (prev) => prev,
  });

  const trends = useMemo(() => {
    if (!stats) return { revenue: 0, orders: 0 };
    return {
      revenue:
        stats.last_month_revenue > 0
          ? ((stats.current_month_revenue - stats.last_month_revenue) / stats.last_month_revenue) * 100
          : 0,
      orders:
        stats.last_month_orders > 0
          ? ((stats.current_month_orders - stats.last_month_orders) / stats.last_month_orders) * 100
          : 0,
    };
  }, [stats]);

  const revenueSpark = useMemo(
    () => stats?.daily_sales?.map((d) => ({ value: d.revenue })) ?? [],
    [stats],
  );
  const orderSpark = useMemo(
    () => stats?.daily_sales?.map((d) => ({ value: d.orders })) ?? [],
    [stats],
  );

  const paymentSlices = useMemo<BreakdownSlice[]>(() => {
    if (!stats) return [];
    const pb = stats.payment_breakdown;
    return [
      { label: "Cash", value: pb.cash, color: "#10b981" },
      { label: "Card", value: pb.card, color: "#2563eb" },
      { label: "Bank Transfer", value: pb.bank_transfer, color: "#0ea5e9" },
      { label: "Credit", value: pb.credit, color: "#f59e0b" },
      { label: "Cheque", value: pb.cheque, color: "#8b5cf6" },
    ].filter((s) => s.value > 0);
  }, [stats]);

  const statusSlices = useMemo<BreakdownSlice[]>(() => {
    if (!stats) return [];
    return [
      { label: "Approved", value: stats.approved, color: "#10b981" },
      { label: "Pending", value: stats.pending_approval, color: "#f59e0b" },
    ].filter((s) => s.value > 0);
  }, [stats]);

  if (isError) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h5" fontWeight={700} sx={{ mb: 2 }}>Sales Dashboard</Typography>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => refetch()}>
              Retry
            </Button>
          }
        >
          Failed to load sales statistics.
        </Alert>
      </Box>
    );
  }

  if (isLoading || !stats) return <TPageSkeleton variant="dashboard" />;

  const branchName =
    filterBranch && branches.find((b) => b.branch_code === filterBranch)?.branch_name;

  return (
    <Box
      sx={{
        p: { xs: 1.5, md: 2.5 },
        height: "100%",
        overflow: "auto",
        background: "linear-gradient(180deg, #f6f8fc 0%, #ffffff 280px)",
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
          <Typography variant="h5" fontWeight={700}>Sales Dashboard</Typography>
          {branchName && (
            <Typography variant="caption" color="text.secondary">{branchName}</Typography>
          )}
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Autocomplete
            size="small"
            options={branches}
            getOptionLabel={(o) => `${o.branch_code} — ${o.branch_name}`}
            value={branches.find((b) => b.branch_code === filterBranch) || null}
            onChange={(_, v) => setFilterBranch(v?.branch_code || null)}
            sx={{ minWidth: 220, bgcolor: "background.paper", borderRadius: 2 }}
            renderInput={(p) => <TextField {...p} placeholder="All Branches" size="small" />}
          />
          <Button
            variant="contained"
            size="small"
            startIcon={<AddCircleOutlineIcon />}
            onClick={() => navigate("/sales/new")}
            sx={{ borderRadius: 2, fontWeight: 700 }}
            color="success"
          >
            New Order
          </Button>
          <Tooltip title="Refresh">
            <IconButton size="small" onClick={() => refetch()} disabled={isFetching}
              sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
              <RefreshIcon fontSize="small" sx={{
                animation: isFetching ? "spin 1s linear infinite" : "none",
                "@keyframes spin": { "0%": { transform: "rotate(0deg)" }, "100%": { transform: "rotate(360deg)" } },
              }} />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      {/* Quick action chips */}
      <Stack direction="row" spacing={1} sx={{ mb: 2.5, flexWrap: "wrap", rowGap: 1 }}>
        <Chip
          icon={<ShoppingCartIcon />}
          label="All Orders"
          onClick={() => navigate("/sales")}
          variant="outlined"
        />
        <Chip
          icon={<HourglassEmptyIcon />}
          label={`Approvals (${stats.pending_approval})`}
          color="warning"
          variant={stats.pending_approval > 0 ? "filled" : "outlined"}
          onClick={() => navigate("/sales/approvals")}
        />
        <Chip
          icon={<PeopleIcon />}
          label="Customers"
          onClick={() => navigate("/sales/customers")}
          variant="outlined"
        />
        <Chip
          icon={<ReceiptIcon />}
          label={`Returns (${stats.sale_returns_count})`}
          onClick={() => navigate("/sales/returns")}
          variant="outlined"
        />
      </Stack>

      <Grid container spacing={2.25}>
        {/* ─── KPI Row ───────────────────────────────────────────── */}
        <Grid item xs={12} sm={6} md={3}>
          <KpiSparkCard
            title="Today's Revenue"
            value={`Rs. ${fmtLKR(stats.today_revenue)}`}
            subtitle={`${stats.today_orders} order${stats.today_orders !== 1 ? "s" : ""} so far`}
            icon={<AttachMoneyIcon />}
            color="success"
            spark={revenueSpark}
            onClick={() => navigate("/sales")}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiSparkCard
            title="Month Revenue"
            value={`Rs. ${fmtLKR(stats.current_month_revenue)}`}
            subtitle={`Last month: Rs. ${fmtLKR(stats.last_month_revenue)}`}
            icon={<BarChartIcon />}
            color="primary"
            trend={trends.revenue}
            trendLabel="vs last month"
            spark={revenueSpark}
            onClick={() => navigate("/sales")}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiSparkCard
            title="Orders This Month"
            value={stats.current_month_orders.toLocaleString()}
            subtitle={`Last month: ${stats.last_month_orders}`}
            icon={<ShoppingCartIcon />}
            color="info"
            trend={trends.orders}
            trendLabel="vs last month"
            spark={orderSpark}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiSparkCard
            title="Avg Order Value"
            value={`Rs. ${fmtLKR(stats.avg_order_value)}`}
            subtitle={`${stats.total_orders.toLocaleString()} total orders`}
            icon={<ReceiptIcon />}
            color="warning"
          />
        </Grid>

        {/* ─── Combined trend chart ─────────────────────────────── */}
        <Grid item xs={12} lg={8}>
          <DashboardPanel
            title="Revenue & Orders — Last 7 Days"
            subtitle="Daily totals — revenue (left) and order count (right)"
          >
            {stats.daily_sales.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 6, color: "text.secondary" }}>
                <ReceiptIcon sx={{ fontSize: 44, opacity: 0.3, mb: 1 }} />
                <Typography>No sales data available</Typography>
              </Box>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={stats.daily_sales} margin={{ top: 10, right: 18, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={theme.palette.success.main} stopOpacity={0.45} />
                      <stop offset="100%" stopColor={theme.palette.success.main} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.6)} />
                  <XAxis dataKey="date" fontSize={12} tick={{ fill: theme.palette.text.secondary }} />
                  <YAxis
                    yAxisId="rev"
                    fontSize={12}
                    tick={{ fill: theme.palette.text.secondary }}
                    tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))}
                  />
                  <YAxis
                    yAxisId="ord"
                    orientation="right"
                    fontSize={12}
                    tick={{ fill: theme.palette.text.secondary }}
                    allowDecimals={false}
                  />
                  <RechartsTooltip
                    formatter={(v: number | undefined, n: string | undefined) => {
                      const num = v ?? 0;
                      return n === "Revenue"
                        ? ([`Rs. ${fmtLKR(num)}`, n] as [string, string])
                        : ([num, n ?? ""] as [number, string]);
                    }}
                    contentStyle={{
                      borderRadius: 8,
                      border: `1px solid ${theme.palette.divider}`,
                      backgroundColor: theme.palette.background.paper,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area
                    yAxisId="rev"
                    type="monotone"
                    dataKey="revenue"
                    name="Revenue"
                    stroke={theme.palette.success.main}
                    strokeWidth={2.5}
                    fill="url(#revGrad)"
                  />
                  <Line
                    yAxisId="ord"
                    type="monotone"
                    dataKey="orders"
                    name="Orders"
                    stroke={theme.palette.primary.main}
                    strokeWidth={2}
                    dot={{ r: 3, fill: theme.palette.primary.main }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </DashboardPanel>
        </Grid>

        {/* ─── Order Status Donut ───────────────────────────────── */}
        <Grid item xs={12} lg={4}>
          <DashboardPanel
            title="Order Status"
            subtitle={`${stats.total_orders.toLocaleString()} orders to date`}
          >
            <BreakdownDonut
              data={statusSlices}
              centerLabel="Approved"
              centerValue={`${
                stats.total_orders > 0
                  ? ((stats.approved / stats.total_orders) * 100).toFixed(0)
                  : 0
              }%`}
              formatValue={(v) => v.toLocaleString()}
              height={200}
            />
            <Divider sx={{ my: 2 }} />
            <Stack direction="row" spacing={2}>
              <Box sx={{ flex: 1, textAlign: "center" }}>
                <Avatar sx={{ bgcolor: alpha(theme.palette.success.main, 0.12), color: "success.main", mx: "auto", width: 36, height: 36 }}>
                  <CheckCircleIcon fontSize="small" />
                </Avatar>
                <Typography variant="h6" sx={{ fontWeight: 800, mt: 0.5 }}>{stats.approved}</Typography>
                <Typography variant="caption" color="text.secondary">Approved</Typography>
              </Box>
              <Box sx={{ flex: 1, textAlign: "center" }}>
                <Avatar sx={{ bgcolor: alpha(theme.palette.warning.main, 0.12), color: "warning.main", mx: "auto", width: 36, height: 36 }}>
                  <HourglassEmptyIcon fontSize="small" />
                </Avatar>
                <Typography variant="h6" sx={{ fontWeight: 800, mt: 0.5 }}>{stats.pending_approval}</Typography>
                <Typography variant="caption" color="text.secondary">Pending</Typography>
              </Box>
            </Stack>
          </DashboardPanel>
        </Grid>

        {/* ─── Monthly bar + Payment donut ──────────────────────── */}
        <Grid item xs={12} lg={7}>
          <DashboardPanel title="Monthly Revenue" subtitle="Last 6 months">
            {stats.monthly_sales.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 5, color: "text.secondary" }}>
                <Typography>No monthly data</Typography>
              </Box>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={stats.monthly_sales} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.6)} />
                  <XAxis dataKey="month" fontSize={12} tick={{ fill: theme.palette.text.secondary }} />
                  <YAxis
                    fontSize={12}
                    tick={{ fill: theme.palette.text.secondary }}
                    tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))}
                  />
                  <RechartsTooltip
                    formatter={(v: number | undefined) =>
                      [`Rs. ${fmtLKR(v ?? 0)}`, "Revenue"] as [string, string]
                    }
                    contentStyle={{
                      borderRadius: 8,
                      border: `1px solid ${theme.palette.divider}`,
                      backgroundColor: theme.palette.background.paper,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="revenue" radius={[6, 6, 0, 0]} fill={theme.palette.success.main} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </DashboardPanel>
        </Grid>

        <Grid item xs={12} lg={5}>
          <DashboardPanel title="Payment Methods" subtitle="Total revenue by tender">
            <BreakdownDonut
              data={paymentSlices}
              centerLabel="Total"
              centerValue={`Rs. ${fmtLKR(stats.total_revenue)}`}
              formatValue={(v) => `Rs. ${fmtLKR(v)}`}
              height={220}
            />
          </DashboardPanel>
        </Grid>

        {/* ─── Top customers + Recent orders ────────────────────── */}
        <Grid item xs={12} md={5}>
          <DashboardPanel
            title="Top Customers"
            subtitle="By revenue"
            action={
              <Button
                size="small"
                endIcon={<LaunchIcon />}
                onClick={() => navigate("/sales/customers")}
                sx={{ textTransform: "none" }}
              >
                View
              </Button>
            }
          >
            {stats.top_customers.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 4 }}>
                <PeopleIcon sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />
                <Typography variant="body2" color="text.secondary">
                  No customer data
                </Typography>
              </Box>
            ) : (
              <List dense disablePadding>
                {stats.top_customers.map((c, idx) => (
                  <ListItem key={idx} disablePadding sx={{ py: 0.75 }}>
                    <ListItemAvatar sx={{ minWidth: 40 }}>
                      <Avatar
                        sx={{
                          width: 32,
                          height: 32,
                          fontSize: 13,
                          fontWeight: 800,
                          bgcolor:
                            idx === 0
                              ? "warning.main"
                              : idx === 1
                                ? "grey.400"
                                : idx === 2
                                  ? "#CD7F32"
                                  : "grey.200",
                          color: idx < 3 ? "white" : "text.primary",
                        }}
                      >
                        {idx + 1}
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={c.name}
                      secondary={`${c.orders} order${c.orders !== 1 ? "s" : ""}`}
                      primaryTypographyProps={{ variant: "body2", fontWeight: 600, noWrap: true }}
                      secondaryTypographyProps={{ variant: "caption" }}
                    />
                    <Typography variant="body2" sx={{ fontWeight: 700, color: "success.main", whiteSpace: "nowrap" }}>
                      Rs. {fmtLKR(c.revenue)}
                    </Typography>
                  </ListItem>
                ))}
              </List>
            )}
          </DashboardPanel>
        </Grid>

        <Grid item xs={12} md={7}>
          <DashboardPanel
            title="Recent Orders"
            subtitle={`${stats.total_orders.toLocaleString()} total`}
            action={
              <Button
                size="small"
                endIcon={<LaunchIcon />}
                onClick={() => navigate("/sales")}
                sx={{ textTransform: "none" }}
              >
                View All
              </Button>
            }
          >
            {stats.recent_invoices.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 4 }}>
                <ReceiptIcon sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />
                <Typography variant="body2" color="text.secondary">
                  No recent orders
                </Typography>
              </Box>
            ) : (
              <List dense disablePadding>
                {stats.recent_invoices.map((inv) => (
                  <ListItemButton
                    key={inv.id}
                    divider
                    onClick={() => navigate(`/sales?invoice=${inv.id}`)}
                    sx={{ borderRadius: 1.5, mb: 0.25 }}
                  >
                    <ListItemText
                      primary={inv.invoice_no}
                      secondary={inv.created_date ? format(new Date(inv.created_date), "MMM dd, yyyy") : "—"}
                      primaryTypographyProps={{ variant: "body2", fontWeight: 600 }}
                      secondaryTypographyProps={{ variant: "caption" }}
                    />
                    <Stack direction="row" spacing={1.25} alignItems="center">
                      <Typography variant="body2" sx={{ fontWeight: 700, color: "success.main" }}>
                        Rs. {fmtLKR(inv.total)}
                      </Typography>
                      <TStatusChip
                        status={inv.approval ? "approved" : "pending"}
                        statusMap="orderStatus"
                        size="small"
                      />
                    </Stack>
                  </ListItemButton>
                ))}
              </List>
            )}
          </DashboardPanel>
        </Grid>

        {/* ─── Top orders by value ─────────────────────────────── */}
        <Grid item xs={12}>
          <DashboardPanel title="Top Orders by Value" subtitle="Highest grossing invoices">
            {stats.top_invoices.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 3 }}>
                <ReceiptIcon sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />
                <Typography variant="body2" color="text.secondary">
                  No orders yet
                </Typography>
              </Box>
            ) : (
              <Grid container spacing={2}>
                {stats.top_invoices.map((inv, i) => (
                  <Grid item xs={12} sm={6} md={2.4} key={inv.id}>
                    <Box
                      onClick={() => navigate(`/sales?invoice=${inv.id}`)}
                      sx={{
                        cursor: "pointer",
                        p: 2,
                        borderRadius: 2,
                        border: "1px solid",
                        borderColor: "divider",
                        textAlign: "center",
                        transition: "all .18s ease",
                        "&:hover": {
                          transform: "translateY(-2px)",
                          boxShadow: "0 10px 22px -12px rgba(15,23,42,0.25)",
                          borderColor: alpha(theme.palette.success.main, 0.4),
                        },
                      }}
                    >
                      <Chip
                        label={`#${i + 1}`}
                        size="small"
                        sx={{
                          mb: 1,
                          fontWeight: 800,
                          bgcolor: i === 0 ? "warning.main" : "grey.200",
                          color: i === 0 ? "white" : "text.primary",
                        }}
                      />
                      <Typography variant="caption" color="text.secondary" display="block" noWrap>
                        {inv.invoice_no}
                      </Typography>
                      <Typography variant="h6" sx={{ fontWeight: 800, color: "success.main", mt: 0.5 }}>
                        Rs. {fmtLKR(inv.total)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {inv.created_date ? format(new Date(inv.created_date), "MMM dd") : "—"}
                      </Typography>
                    </Box>
                  </Grid>
                ))}
              </Grid>
            )}
          </DashboardPanel>
        </Grid>
      </Grid>

      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", textAlign: "right", mt: 2 }}
      >
        Last updated {format(new Date(), "MMM dd, yyyy HH:mm")}
      </Typography>
    </Box>
  );
}
