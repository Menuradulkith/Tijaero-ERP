/**
 * Main ERP Dashboard — Professional layout inspired by Odoo / SAP / NetSuite.
 *
 * Layout (top → bottom):
 *  1. Hero banner with greeting + quick-nav chips
 *  2. KPI spark-cards row (Sales Today, Monthly, Customers, Products)
 *  3. Charts row: Sales Trend (8-col) + Pending Approvals (4-col)
 *  4. Bottom row: Financial Snapshot (4) + Top Products (4) + Recent Activity (4)
 */

import {
  hasAnyModuleAccess,
  hasPermission,
  PERMISSIONS,
} from "@/auth/permissions";
import {
  BreakdownDonut,
  DashboardHero,
  DashboardPanel,
  KpiSparkCard,
} from "@/components/dashboard";
import ErrorDisplay from "@/components/ErrorDisplay";
import {
  fmtLKR,
  TEmptyState,
  TLoadingSkeleton,
  TPageHeader,
} from "@/components/tijaero";
import { useDashboardMetrics } from "@/hooks/useDashboardMetrics";
import { useAuthStore } from "@/state/authStore";
import { calculatePercentageChange } from "@/utils/calculations";
import { formatRelativeTime } from "@/utils/formatters";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import AssignmentIcon from "@mui/icons-material/Assignment";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import InventoryIcon from "@mui/icons-material/Inventory";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import MonetizationOnIcon from "@mui/icons-material/MonetizationOn";
import PeopleIcon from "@mui/icons-material/People";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import {
  Avatar,
  Badge,
  Box,
  Button,
  Chip,
  Grid,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Stack,
  Typography,
  useTheme,
} from "@mui/material";
import { useCallback, useMemo, useState } from "react";
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

/* ─── helper types & functions ──────────────────────────────────────────── */

interface ActivityItem {
  title: string;
  time: string;
  type: "sale" | "customer" | "inventory" | "payment";
}

const ACTIVITY_ICON: Record<ActivityItem["type"], React.ReactNode> = {
  sale: <ShoppingCartIcon sx={{ fontSize: 18 }} />,
  customer: <PeopleIcon sx={{ fontSize: 18 }} />,
  inventory: <InventoryIcon sx={{ fontSize: 18 }} />,
  payment: <AccountBalanceWalletIcon sx={{ fontSize: 18 }} />,
};
const ACTIVITY_COLOR: Record<ActivityItem["type"], string> = {
  sale: "success.main",
  customer: "primary.main",
  inventory: "warning.main",
  payment: "info.main",
};

/* ─── Approval Row (compact) ────────────────────────────────────────────── */

function ApprovalRow({
  label,
  count,
  icon,
  color,
  onClick,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  color: string;
  onClick?: () => void;
}) {
  if (count === 0) return null;
  return (
    <ListItem
      disablePadding
      sx={{
        py: 0.6,
        px: 1,
        borderRadius: 1.5,
        cursor: onClick ? "pointer" : "default",
        "&:hover": onClick ? { bgcolor: "action.hover" } : {},
      }}
      onClick={onClick}
    >
      <ListItemAvatar sx={{ minWidth: 36 }}>
        <Avatar
          sx={{
            bgcolor: `${color}15`,
            color,
            width: 28,
            height: 28,
          }}
        >
          {icon}
        </Avatar>
      </ListItemAvatar>
      <ListItemText
        primary={label}
        primaryTypographyProps={{ variant: "body2", fontWeight: 500 }}
      />
      <Chip
        label={count}
        size="small"
        sx={{
          fontWeight: 700,
          fontSize: "0.7rem",
          height: 22,
          bgcolor: `${color}14`,
          color,
        }}
      />
    </ListItem>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */

export default function DashboardPage() {
  const navigate = useNavigate();
  const theme = useTheme();
  const user = useAuthStore((s) => s.user);

  /* ── permissions ─────────────────────────────────────────────────────── */
  const canViewDashboard = hasPermission(
    user,
    PERMISSIONS.DASHBOARD_VIEW.resource,
    PERMISSIONS.DASHBOARD_VIEW.action,
  );
  const canViewSales = hasPermission(
    user,
    PERMISSIONS.SALES_DASHBOARD_VIEW.resource,
    PERMISSIONS.SALES_DASHBOARD_VIEW.action,
  );
  const canViewPurchasing = hasPermission(
    user,
    PERMISSIONS.PURCHASING_DASHBOARD_VIEW.resource,
    PERMISSIONS.PURCHASING_DASHBOARD_VIEW.action,
  );
  const canViewFinance = hasPermission(
    user,
    PERMISSIONS.FINANCE_DASHBOARD_VIEW.resource,
    PERMISSIONS.FINANCE_DASHBOARD_VIEW.action,
  );
  const canViewInventory = hasPermission(
    user,
    PERMISSIONS.PRODUCTS_VIEW.resource,
    PERMISSIONS.PRODUCTS_VIEW.action,
  );
  const canViewWarehouse = hasPermission(
    user,
    PERMISSIONS.SALES_STOCK_VIEW.resource,
    PERMISSIONS.SALES_STOCK_VIEW.action,
  );
  const canViewSupport = hasPermission(
    user,
    PERMISSIONS.SUPPORT_DASHBOARD_VIEW.resource,
    PERMISSIONS.SUPPORT_DASHBOARD_VIEW.action,
  );

  /* ── data fetching ───────────────────────────────────────────────────── */
  const { metrics, loading, error, refresh } = useDashboardMetrics({
    autoRefresh: canViewDashboard,
    skipInitialFetch: !canViewDashboard,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await refresh();
    } finally {
      setTimeout(() => setIsRefreshing(false), 1000);
    }
  }, [refresh, isRefreshing]);

  /* ── derived data ────────────────────────────────────────────────────── */
  const trends = useMemo(() => {
    if (!metrics) return { sales: 0, orders: 0 };
    return {
      sales: calculatePercentageChange(
        metrics.total_sales_month,
        metrics.total_sales_last_month,
      ),
      orders: calculatePercentageChange(
        metrics.total_orders_month,
        metrics.total_orders_last_month,
      ),
    };
  }, [metrics]);

  const chartData = useMemo(() => {
    if (!metrics?.daily_sales?.length) return [];
    return metrics.daily_sales.map((d) => ({
      date: new Date(d.date).toLocaleDateString("en-US", {
        weekday: "short",
        day: "numeric",
      }),
      sales: d.sales,
      orders: d.orders,
    }));
  }, [metrics]);

  // Sparkline arrays for KPI cards (last 7 days sales / orders)
  const salesSpark = useMemo(
    () => (metrics?.daily_sales || []).map((d) => ({ value: d.sales })),
    [metrics],
  );

  // Financial donut data
  const financialDonut = useMemo(() => {
    if (!metrics) return [];
    return [
      {
        label: "Sales Revenue",
        value: metrics.total_sales_month || 0,
        color: theme.palette.success.main,
      },
      {
        label: "Purchases",
        value: metrics.total_purchases_month || 0,
        color: theme.palette.primary.main,
      },
      {
        label: "Receivables",
        value: metrics.total_credit_outstanding || 0,
        color: theme.palette.error.main,
      },
      {
        label: "Payables",
        value: metrics.total_supplier_credit || 0,
        color: theme.palette.warning.main,
      },
    ];
  }, [metrics, theme]);

  // Top products bar chart
  const topProductsData = useMemo(
    () =>
      (metrics?.top_products || []).slice(0, 5).map((p) => ({
        name: p.name.length > 18 ? p.name.slice(0, 16) + "…" : p.name,
        qty: p.quantity,
        revenue: p.revenue,
      })),
    [metrics],
  );

  /* ── error state ─────────────────────────────────────────────────────── */
  if (error && !loading && canViewDashboard) {
    return (
      <Box sx={{ p: 3, height: "100%", overflow: "auto" }}>
        <TPageHeader
          title="Dashboard"
          subtitle="Overview of your business performance"
        />
        <ErrorDisplay error={error} onRetry={refresh} />
      </Box>
    );
  }

  /* ── no-access state ─────────────────────────────────────────────────── */
  if (!hasAnyModuleAccess(user)) {
    return (
      <Box sx={{ p: 3, height: "100%", overflow: "auto" }}>
        <TPageHeader title="Dashboard" subtitle="Welcome to TijaeroERP" />
        <TEmptyState
          title="No Access Assigned"
          message="Your account does not have any roles or permissions assigned yet. Please contact your administrator to get access to the system modules."
          size="large"
        />
      </Box>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════
     MAIN RENDER
     ══════════════════════════════════════════════════════════════════════ */
  return (
    <Box
      sx={{
        p: { xs: 1.5, md: 2.5 },
        height: "100%",
        overflow: "auto",
        bgcolor: "background.default",
      }}
    >
      {/* ─── 1. Hero Banner ────────────────────────────────────────────── */}
      <DashboardHero
        eyebrow="OVERVIEW"
        title={`Welcome back${user?.first_name ? `, ${user.first_name}` : ""}`}
        subtitle={
          canViewDashboard
            ? "Here's a snapshot of your business performance today."
            : "Welcome to Tijaero ERP"
        }
        accent="primary"
        onRefresh={canViewDashboard ? handleRefresh : undefined}
        isRefreshing={isRefreshing || loading}
        primaryAction={
          canViewSales ? (
            <Button
              variant="contained"
              startIcon={<AddCircleOutlineIcon />}
              onClick={() => navigate("/sales/new")}
              sx={{
                bgcolor: "#fff",
                color: "primary.dark",
                fontWeight: 700,
                borderRadius: 2,
                boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                "&:hover": { bgcolor: "#f8fafc" },
              }}
            >
              New Sale
            </Button>
          ) : undefined
        }
      />

      {/* Quick-nav chips */}
      {canViewDashboard && (
        <Stack
          direction="row"
          spacing={1}
          sx={{ mb: 2.5, flexWrap: "wrap", rowGap: 1 }}
        >
          {canViewSales && (
            <Chip
              icon={<ShoppingCartIcon />}
              label="Sales"
              onClick={() => navigate("/sales")}
              variant="outlined"
              size="small"
            />
          )}
          {canViewPurchasing && (
            <Chip
              icon={<LocalShippingIcon />}
              label="Purchasing"
              onClick={() => navigate("/purchasing")}
              variant="outlined"
              size="small"
            />
          )}
          {canViewInventory && (
            <Chip
              icon={<InventoryIcon />}
              label="Inventory"
              onClick={() => navigate("/product-catalogs")}
              variant="outlined"
              size="small"
            />
          )}
          {canViewWarehouse && (
            <Chip
              icon={<SwapHorizIcon />}
              label="Warehouse"
              onClick={() => navigate("/warehouse")}
              variant="outlined"
              size="small"
            />
          )}
          {canViewFinance && (
            <Chip
              icon={<ReceiptLongIcon />}
              label="Finance"
              onClick={() => navigate("/finance")}
              variant="outlined"
              size="small"
            />
          )}
          {canViewSupport && (
            <Chip
              icon={<SupportAgentIcon />}
              label="Support"
              onClick={() => navigate("/support")}
              variant="outlined"
              size="small"
            />
          )}
          {metrics && metrics.pending_approvals > 0 && (
            <Chip
              icon={<WarningAmberIcon />}
              label={`Approvals (${metrics.pending_approvals})`}
              color="warning"
              size="small"
              onClick={() => navigate("/sales/approvals")}
            />
          )}
        </Stack>
      )}

      {canViewDashboard && (
        <Stack spacing={2.5}>
          {/* ─── 2. KPI Spark Cards ──────────────────────────────────── */}
          <Grid container spacing={2}>
            {canViewSales && (
              <>
                <Grid item xs={12} sm={6} lg={3}>
                  <KpiSparkCard
                    title="Sales Today"
                    value={`Rs. ${fmtLKR(metrics?.total_sales_today || 0)}`}
                    subtitle={`${metrics?.total_orders_today || 0} orders`}
                    icon={<MonetizationOnIcon />}
                    color="success"
                    spark={salesSpark}
                    onClick={() => navigate("/sales")}
                  />
                </Grid>
                <Grid item xs={12} sm={6} lg={3}>
                  <KpiSparkCard
                    title="Sales This Month"
                    value={`Rs. ${fmtLKR(metrics?.total_sales_month || 0)}`}
                    subtitle={`${metrics?.total_orders_month || 0} orders`}
                    icon={<TrendingUpIcon />}
                    color="primary"
                    trend={trends.sales}
                    trendLabel="vs last month"
                    spark={salesSpark}
                    onClick={() => navigate("/sales/track")}
                  />
                </Grid>
              </>
            )}
            <Grid item xs={12} sm={6} lg={3}>
              <KpiSparkCard
                title="Total Customers"
                value={(metrics?.total_customers || 0).toLocaleString()}
                subtitle={
                  metrics?.new_customers_month
                    ? `+${metrics.new_customers_month} this month`
                    : "Active customers"
                }
                icon={<PeopleIcon />}
                color="info"
                onClick={() => navigate("/sales/customers")}
              />
            </Grid>
            <Grid item xs={12} sm={6} lg={3}>
              <Badge
                badgeContent={
                  metrics && metrics.low_stock_items > 0
                    ? metrics.low_stock_items
                    : undefined
                }
                color="error"
                sx={{
                  width: "100%",
                  "& .MuiBadge-badge": { top: 12, right: 12 },
                }}
              >
                <Box sx={{ width: "100%" }}>
                  <KpiSparkCard
                    title="Products"
                    value={(metrics?.total_products || 0).toLocaleString()}
                    subtitle={
                      metrics && metrics.low_stock_items > 0
                        ? `${metrics.low_stock_items} low stock`
                        : "In catalog"
                    }
                    icon={<InventoryIcon />}
                    color="warning"
                    onClick={() => navigate("/product-catalogs")}
                  />
                </Box>
              </Badge>
            </Grid>
          </Grid>

          {/* ─── 3. Charts Row: Sales Trend + Pending Approvals ──────── */}
          <Grid container spacing={2.5}>
            {/* Sales Trend Area Chart */}
            <Grid item xs={12} lg={8}>
              <DashboardPanel title="Sales Trend" subtitle="Last 7 days">
                {loading ? (
                  <TLoadingSkeleton type="card" />
                ) : chartData.length > 0 ? (
                  <Box sx={{ height: 280 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={chartData}
                        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient
                            id="salesGrad"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor={theme.palette.success.main}
                              stopOpacity={0.25}
                            />
                            <stop
                              offset="100%"
                              stopColor={theme.palette.success.main}
                              stopOpacity={0.02}
                            />
                          </linearGradient>
                          <linearGradient
                            id="ordersGrad"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor={theme.palette.primary.main}
                              stopOpacity={0.2}
                            />
                            <stop
                              offset="100%"
                              stopColor={theme.palette.primary.main}
                              stopOpacity={0.02}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          vertical={false}
                          stroke={theme.palette.divider}
                        />
                        <XAxis
                          dataKey="date"
                          tickLine={false}
                          axisLine={false}
                          tick={{
                            fontSize: 11,
                            fill: theme.palette.text.secondary,
                          }}
                        />
                        <YAxis
                          yAxisId="left"
                          tickLine={false}
                          axisLine={false}
                          tick={{
                            fontSize: 11,
                            fill: theme.palette.text.secondary,
                          }}
                          tickFormatter={(v: number) =>
                            v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                          }
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          tickLine={false}
                          axisLine={false}
                          tick={{
                            fontSize: 11,
                            fill: theme.palette.text.secondary,
                          }}
                        />
                        <RechartsTooltip
                          contentStyle={{
                            borderRadius: 10,
                            border: `1px solid ${theme.palette.divider}`,
                            backgroundColor: theme.palette.background.paper,
                            fontSize: 12,
                            boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
                          }}
                          formatter={(
                            value: number | string | undefined,
                            name: string | undefined,
                          ) => {
                            if (name === "sales")
                              return [`Rs. ${fmtLKR(Number(value))}`, "Sales"];
                            return [value, "Orders"];
                          }}
                        />
                        <Area
                          yAxisId="left"
                          type="monotone"
                          dataKey="sales"
                          stroke={theme.palette.success.main}
                          strokeWidth={2.5}
                          fill="url(#salesGrad)"
                          name="sales"
                        />
                        <Area
                          yAxisId="right"
                          type="monotone"
                          dataKey="orders"
                          stroke={theme.palette.primary.main}
                          strokeWidth={2}
                          fill="url(#ordersGrad)"
                          name="orders"
                          strokeDasharray="5 3"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </Box>
                ) : (
                  <TEmptyState
                    title="No sales data"
                    message="Sales trend will appear once orders are placed"
                    size="small"
                  />
                )}
              </DashboardPanel>
            </Grid>

            {/* Pending Approvals */}
            <Grid item xs={12} lg={4}>
              <DashboardPanel
                title="Pending Approvals"
                action={
                  metrics && metrics.pending_approvals > 0 ? (
                    <Chip
                      icon={<WarningAmberIcon sx={{ fontSize: 14 }} />}
                      label={metrics.pending_approvals}
                      color="warning"
                      size="small"
                    />
                  ) : undefined
                }
              >
                {loading ? (
                  <TLoadingSkeleton type="list" count={4} />
                ) : metrics && metrics.pending_approvals > 0 ? (
                  <List disablePadding>
                    <ApprovalRow
                      label="Sales Orders"
                      count={metrics.pending_sales_approvals}
                      icon={<ShoppingCartIcon sx={{ fontSize: 14 }} />}
                      color={theme.palette.success.main}
                      onClick={() => navigate("/sales/approvals")}
                    />
                    <ApprovalRow
                      label="Purchase Orders"
                      count={metrics.pending_purchase_approvals}
                      icon={<LocalShippingIcon sx={{ fontSize: 14 }} />}
                      color={theme.palette.primary.main}
                      onClick={() => navigate("/purchasing/approvals")}
                    />
                    <ApprovalRow
                      label="Returns"
                      count={metrics.pending_return_approvals}
                      icon={<AssignmentReturnIcon sx={{ fontSize: 14 }} />}
                      color={theme.palette.warning.main}
                      onClick={() => navigate("/sales/return-approvals")}
                    />
                    <ApprovalRow
                      label="Expenses"
                      count={metrics.pending_expense_approvals}
                      icon={<ReceiptLongIcon sx={{ fontSize: 14 }} />}
                      color={theme.palette.error.main}
                      onClick={() => navigate("/finance/expense-approvals")}
                    />
                    <ApprovalRow
                      label="Stock Transfers"
                      count={metrics.pending_transfer_approvals}
                      icon={<SwapHorizIcon sx={{ fontSize: 14 }} />}
                      color={theme.palette.info.main}
                      onClick={() => navigate("/warehouse/transfer-approvals")}
                    />
                  </List>
                ) : (
                  <Box
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      py: 5,
                    }}
                  >
                    <CheckCircleOutlineIcon
                      sx={{ fontSize: 48, color: "success.light", mb: 1 }}
                    />
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      color="text.secondary"
                    >
                      All caught up!
                    </Typography>
                    <Typography variant="caption" color="text.disabled">
                      No items awaiting approval
                    </Typography>
                  </Box>
                )}
              </DashboardPanel>
            </Grid>
          </Grid>

          {/* ─── 4. Bottom Row: Finance Donut + Top Products Bar + Activity ── */}
          <Grid container spacing={2.5}>
            {/* Financial Snapshot — Donut */}
            {canViewFinance && (
              <Grid item xs={12} md={6} lg={4}>
                <DashboardPanel
                  title="Financial Overview"
                  subtitle="This month"
                  action={
                    <Chip
                      label="Details"
                      size="small"
                      variant="outlined"
                      onClick={() => navigate("/finance")}
                    />
                  }
                >
                  {loading ? (
                    <TLoadingSkeleton type="card" />
                  ) : (
                    <Stack spacing={2}>
                      <BreakdownDonut
                        data={financialDonut}
                        centerLabel="Net"
                        centerValue={`Rs. ${fmtLKR(
                          (metrics?.total_sales_month || 0) -
                            (metrics?.total_purchases_month || 0),
                        )}`}
                        formatValue={(v) => `Rs. ${fmtLKR(v)}`}
                        height={190}
                      />
                      {/* Key figures under the donut */}
                      <Stack
                        direction="row"
                        spacing={1}
                        justifyContent="center"
                        flexWrap="wrap"
                        sx={{ rowGap: 0.5 }}
                      >
                        <Chip
                          size="small"
                          label={`Receivables: Rs. ${fmtLKR(metrics?.total_credit_outstanding || 0)}`}
                          sx={{
                            bgcolor: "error.50",
                            color: "error.main",
                            fontWeight: 600,
                            fontSize: "0.68rem",
                          }}
                        />
                        <Chip
                          size="small"
                          label={`Payables: Rs. ${fmtLKR(metrics?.total_supplier_credit || 0)}`}
                          sx={{
                            bgcolor: "warning.50",
                            color: "warning.dark",
                            fontWeight: 600,
                            fontSize: "0.68rem",
                          }}
                        />
                      </Stack>
                    </Stack>
                  )}
                </DashboardPanel>
              </Grid>
            )}

            {/* Top Selling Products — Horizontal Bar */}
            <Grid item xs={12} md={6} lg={canViewFinance ? 4 : 6}>
              <DashboardPanel
                title="Top Products"
                subtitle="By quantity this month"
                action={
                  <Chip
                    label="View All"
                    size="small"
                    variant="outlined"
                    onClick={() => navigate("/product-catalogs")}
                  />
                }
              >
                {loading ? (
                  <TLoadingSkeleton type="list" count={5} />
                ) : topProductsData.length > 0 ? (
                  <Box sx={{ height: 240 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={topProductsData}
                        layout="vertical"
                        margin={{ top: 4, right: 30, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          horizontal={false}
                          stroke={theme.palette.divider}
                        />
                        <XAxis
                          type="number"
                          tickLine={false}
                          axisLine={false}
                          tick={{
                            fontSize: 11,
                            fill: theme.palette.text.secondary,
                          }}
                        />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={120}
                          tickLine={false}
                          axisLine={false}
                          tick={{
                            fontSize: 11,
                            fill: theme.palette.text.primary,
                          }}
                        />
                        <RechartsTooltip
                          contentStyle={{
                            borderRadius: 10,
                            border: `1px solid ${theme.palette.divider}`,
                            backgroundColor: theme.palette.background.paper,
                            fontSize: 12,
                          }}
                          formatter={(v: number | string | undefined) => [`${Number(v ?? 0)} sold`, "Quantity"]}
                        />
                        <Bar
                          dataKey="qty"
                          fill={theme.palette.primary.main}
                          radius={[0, 6, 6, 0]}
                          barSize={18}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </Box>
                ) : (
                  <TEmptyState
                    title="No sales yet"
                    message="Top products will appear here once sales are recorded"
                    size="small"
                  />
                )}
              </DashboardPanel>
            </Grid>

            {/* Recent Activity */}
            <Grid item xs={12} md={12} lg={canViewFinance ? 4 : 6}>
              <DashboardPanel title="Recent Activity">
                {loading ? (
                  <TLoadingSkeleton type="list" count={5} />
                ) : metrics?.recent_activities &&
                  metrics.recent_activities.length > 0 ? (
                  <List disablePadding>
                    {metrics.recent_activities
                      .slice(0, 7)
                      .map((activity, i) => (
                        <ListItem
                          key={i}
                          disablePadding
                          sx={{
                            py: 0.75,
                            borderBottom:
                              i <
                              Math.min(metrics.recent_activities.length, 7) - 1
                                ? 1
                                : 0,
                            borderColor: "divider",
                          }}
                        >
                          <ListItemAvatar sx={{ minWidth: 36 }}>
                            <Avatar
                              sx={{
                                width: 28,
                                height: 28,
                                bgcolor: `${ACTIVITY_COLOR[activity.type]}15`,
                                color: ACTIVITY_COLOR[activity.type],
                              }}
                            >
                              {ACTIVITY_ICON[activity.type] || (
                                <AssignmentIcon sx={{ fontSize: 16 }} />
                              )}
                            </Avatar>
                          </ListItemAvatar>
                          <ListItemText
                            primary={activity.title}
                            secondary={formatRelativeTime(activity.time)}
                            primaryTypographyProps={{
                              variant: "body2",
                              fontWeight: 500,
                              noWrap: true,
                            }}
                            secondaryTypographyProps={{ variant: "caption" }}
                          />
                        </ListItem>
                      ))}
                  </List>
                ) : (
                  <TEmptyState
                    title="No recent activity"
                    message="Activities will appear here as you use the system"
                    size="small"
                  />
                )}
              </DashboardPanel>
            </Grid>
          </Grid>
        </Stack>
      )}
    </Box>
  );
}

