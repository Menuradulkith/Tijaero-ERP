import ErrorDisplay from "@/components/ErrorDisplay";
import {
    fmtLKR,
    TEmptyState,
    TIconButton,
    TLoading,
    TLoadingSkeleton,
    TPageHeader,
    TStatCard,
} from "@/components/tijaero";
import { useDashboardMetrics } from "@/hooks/useDashboardMetrics";
import { hasPermission, hasAnyModuleAccess, PERMISSIONS } from "@/auth/permissions";
import { useAuthStore } from "@/state/authStore";
import { calculatePercentageChange } from "@/utils/calculations";
import { formatRelativeTime } from "@/utils/formatters";
import AssignmentIcon from "@mui/icons-material/Assignment";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import ConfirmationNumberIcon from "@mui/icons-material/ConfirmationNumber";
import InventoryIcon from "@mui/icons-material/Inventory";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import MonetizationOnIcon from "@mui/icons-material/MonetizationOn";
import PeopleIcon from "@mui/icons-material/People";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import RefreshIcon from "@mui/icons-material/Refresh";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import {
    Avatar,
    Box,
    Card,
    CardActionArea,
    Chip,
    Divider,
    Grid,
    LinearProgress,
    List,
    ListItem,
    ListItemAvatar,
    ListItemText,
    Paper,
    Stack,
    Typography,
    useTheme,
} from "@mui/material";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip as RechartsTooltip,
    XAxis,
    YAxis,
} from "recharts";

interface ActivityItem {
  title: string;
  time: string;
  type: "sale" | "customer" | "inventory" | "payment";
}

function getActivityIcon(type: ActivityItem["type"]) {
  const sx = { fontSize: 20 };
  switch (type) {
    case "sale": return <ShoppingCartIcon sx={sx} />;
    case "customer": return <PeopleIcon sx={sx} />;
    case "inventory": return <InventoryIcon sx={sx} />;
    case "payment": return <AccountBalanceWalletIcon sx={sx} />;
    default: return <AssignmentIcon sx={sx} />;
  }
}

function getActivityColor(type: ActivityItem["type"]) {
  switch (type) {
    case "sale": return "success.main";
    case "customer": return "primary.main";
    case "inventory": return "warning.main";
    case "payment": return "info.main";
    default: return "text.secondary";
  }
}

// ─── Pending Approval Row ────────────────────────────────────────────────────
interface ApprovalRowProps {
  label: string;
  count: number;
  icon: React.ReactNode;
  color: string;
  onClick?: () => void;
}

function ApprovalRow({ label, count, icon, color, onClick }: ApprovalRowProps) {
  if (count === 0) return null;
  return (
    <ListItem
      disablePadding
      sx={{
        py: 0.75, px: 1, borderRadius: 1,
        cursor: onClick ? "pointer" : "default",
        "&:hover": onClick ? { bgcolor: "action.hover" } : {},
      }}
      onClick={onClick}
    >
      <ListItemAvatar sx={{ minWidth: 40 }}>
        <Avatar sx={{ bgcolor: `${color}15`, color, width: 32, height: 32 }}>{icon}</Avatar>
      </ListItemAvatar>
      <ListItemText primary={label} primaryTypographyProps={{ variant: "body2" }} />
      <Chip label={count} size="small" sx={{ fontWeight: 700, bgcolor: `${color}18`, color }} />
    </ListItem>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function DashboardPage() {
  const navigate = useNavigate();
  const theme = useTheme();
  const user = useAuthStore((s) => s.user);

  const canViewDashboard = hasPermission(user, PERMISSIONS.DASHBOARD_VIEW.resource, PERMISSIONS.DASHBOARD_VIEW.action);
  const hasAnyAccess = hasAnyModuleAccess(user);
  const canViewSales = hasPermission(user, PERMISSIONS.SALES_VIEW.resource, PERMISSIONS.SALES_VIEW.action);
  const canViewPurchasing = hasPermission(user, PERMISSIONS.PURCHASING_VIEW.resource, PERMISSIONS.PURCHASING_VIEW.action);
  const canViewFinance = hasPermission(user, PERMISSIONS.FINANCE_VIEW.resource, PERMISSIONS.FINANCE_VIEW.action);
  const canViewInventory = hasPermission(user, PERMISSIONS.INVENTORY_VIEW.resource, PERMISSIONS.INVENTORY_VIEW.action);
  const canViewWarehouse = hasPermission(user, PERMISSIONS.WAREHOUSE_VIEW.resource, PERMISSIONS.WAREHOUSE_VIEW.action);
  const canViewSupport = hasPermission(user, PERMISSIONS.SUPPORT_VIEW.resource, PERMISSIONS.SUPPORT_VIEW.action);

  const { metrics, loading, error, refresh } = useDashboardMetrics({
    autoRefresh: canViewDashboard,
    skipInitialFetch: !canViewDashboard,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try { await refresh(); } finally { setTimeout(() => setIsRefreshing(false), 1000); }
  }, [refresh, isRefreshing]);

  // Trends (vs last month)
  const trends = useMemo(() => {
    if (!metrics) return { sales: 0, orders: 0 };
    return {
      sales: calculatePercentageChange(metrics.total_sales_month, metrics.total_sales_last_month),
      orders: calculatePercentageChange(metrics.total_orders_month, metrics.total_orders_last_month),
    };
  }, [metrics]);

  // Chart data — real daily figures from the backend
  const chartData = useMemo(() => {
    if (!metrics?.daily_sales?.length) return [];
    return metrics.daily_sales.map((d) => ({
      date: new Date(d.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      sales: d.sales,
      orders: d.orders,
    }));
  }, [metrics]);

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error && !loading && canViewDashboard) {
    return (
      <Box sx={{ p: 3, height: "100%", overflow: "auto" }}>
        <TPageHeader title="Dashboard" subtitle="Overview of your business performance" />
        <ErrorDisplay error={error} onRetry={refresh} />
      </Box>
    );
  }

  // ── No-access ──────────────────────────────────────────────────────────────
  if (!hasAnyAccess) {
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

  // ── Main dashboard ─────────────────────────────────────────────────────────
  return (
    <Box sx={{ p: { xs: 2, md: 3 }, height: "100%", overflow: "auto" }}>
      <TPageHeader
        title="Dashboard"
        subtitle={
          canViewDashboard
            ? `Welcome back${user?.first_name ? `, ${user.first_name}` : ""}! Here's what's happening today.`
            : "Welcome to Tijaero ERP"
        }
        actions={
          canViewDashboard && (
            <TIconButton
              onClick={handleRefresh}
              disabled={isRefreshing || loading}
              color="primary"
              tooltip="Refresh dashboard"
              size="small"
            >
              {isRefreshing ? <TLoading size="small" /> : <RefreshIcon />}
            </TIconButton>
          )
        }
      />

      {canViewDashboard && (
        <Grid container spacing={2.5}>

          {/* ═══════ ROW 1 — Key Metrics ═══════ */}
          {canViewSales && (
            <>
              <Grid item xs={12} sm={6} lg={3}>
                <TStatCard
                  title="Sales Today"
                  value={metrics?.total_sales_today || 0}
                  format="currency"
                  subtitle={`${metrics?.total_orders_today || 0} orders`}
                  icon={<MonetizationOnIcon />}
                  color="success"
                  loading={loading}
                  onClick={() => navigate("/sales")}
                  tooltip="Click to view sales"
                />
              </Grid>
              <Grid item xs={12} sm={6} lg={3}>
                <TStatCard
                  title="Sales This Month"
                  value={metrics?.total_sales_month || 0}
                  format="currency"
                  trend={trends.sales}
                  trendLabel="vs last month"
                  icon={<ShoppingCartIcon />}
                  color="primary"
                  loading={loading}
                  onClick={() => navigate("/sales/track")}
                  tooltip="Click to view sales track"
                />
              </Grid>
            </>
          )}
          <Grid item xs={12} sm={6} lg={3}>
            <TStatCard
              title="Total Customers"
              value={metrics?.total_customers || 0}
              subtitle={metrics?.new_customers_month ? `+${metrics.new_customers_month} this month` : "Active customers"}
              icon={<PeopleIcon />}
              color="info"
              loading={loading}
              onClick={() => navigate("/sales/customers")}
              tooltip="Click to view customers"
            />
          </Grid>
          <Grid item xs={12} sm={6} lg={3}>
            <TStatCard
              title="Products"
              value={metrics?.total_products || 0}
              icon={<InventoryIcon />}
              color="warning"
              loading={loading}
              onClick={() => navigate("/inventory")}
              tooltip="Click to view products"
              badge={metrics && metrics.low_stock_items > 0 ? metrics.low_stock_items : undefined}
            />
          </Grid>

          {/* ═══════ ROW 2 — Sales Chart + Pending Approvals ═══════ */}
          <Grid item xs={12} lg={8}>
            <Paper sx={{ p: 2.5, height: "100%", borderRadius: 2 }} elevation={0} variant="outlined">
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
                <Box>
                  <Typography variant="h6" fontWeight={600}>Sales Trend</Typography>
                  <Typography variant="caption" color="text.secondary">Last 7 days</Typography>
                </Box>
                {metrics && (
                  <Chip
                    icon={trends.sales >= 0 ? <TrendingUpIcon fontSize="small" /> : <TrendingDownIcon fontSize="small" />}
                    label={`${trends.sales >= 0 ? "+" : ""}${trends.sales.toFixed(1)}% vs last month`}
                    color={trends.sales >= 0 ? "success" : "error"}
                    size="small"
                    variant="outlined"
                  />
                )}
              </Box>
              {loading ? (
                <TLoadingSkeleton type="card" />
              ) : chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280} minWidth={0}>
                  <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={theme.palette.success.main} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={theme.palette.success.main} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke={theme.palette.text.secondary} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      stroke={theme.palette.text.secondary}
                      tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: theme.palette.background.paper,
                        border: `1px solid ${theme.palette.divider}`,
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(value: any, name: string | undefined) => [
                        name === "sales" ? `Rs. ${fmtLKR(Number(value))}` : value,
                        name === "sales" ? "Revenue" : "Orders",
                      ] as [any, string]}
                    />
                    <Area
                      type="monotone"
                      dataKey="sales"
                      stroke={theme.palette.success.main}
                      strokeWidth={2.5}
                      fill="url(#salesGrad)"
                      name="sales"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <TEmptyState title="No sales data" message="Sales data will appear here as orders are placed" size="small" />
              )}
            </Paper>
          </Grid>

          {/* Pending Approvals */}
          <Grid item xs={12} lg={4}>
            <Paper sx={{ p: 2.5, height: "100%", borderRadius: 2 }} elevation={0} variant="outlined">
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1.5 }}>
                <Typography variant="h6" fontWeight={600}>Pending Approvals</Typography>
                {metrics && metrics.pending_approvals > 0 && (
                  <Chip icon={<WarningAmberIcon fontSize="small" />} label={metrics.pending_approvals} color="warning" size="small" />
                )}
              </Box>
              {loading ? (
                <TLoadingSkeleton type="list" count={4} />
              ) : metrics && metrics.pending_approvals > 0 ? (
                <List disablePadding>
                  <ApprovalRow label="Sales Orders" count={metrics.pending_sales_approvals} icon={<ShoppingCartIcon sx={{ fontSize: 16 }} />} color={theme.palette.success.main} onClick={() => navigate("/sales/approvals")} />
                  <ApprovalRow label="Purchase Orders" count={metrics.pending_purchase_approvals} icon={<LocalShippingIcon sx={{ fontSize: 16 }} />} color={theme.palette.primary.main} onClick={() => navigate("/purchasing/approvals")} />
                  <ApprovalRow label="Returns" count={metrics.pending_return_approvals} icon={<AssignmentReturnIcon sx={{ fontSize: 16 }} />} color={theme.palette.warning.main} onClick={() => navigate("/sales/return-approvals")} />
                  <ApprovalRow label="Expenses" count={metrics.pending_expense_approvals} icon={<ReceiptLongIcon sx={{ fontSize: 16 }} />} color={theme.palette.error.main} onClick={() => navigate("/finance/expense-approvals")} />
                  <ApprovalRow label="Stock Transfers" count={metrics.pending_transfer_approvals} icon={<SwapHorizIcon sx={{ fontSize: 16 }} />} color={theme.palette.info.main} onClick={() => navigate("/warehouse/transfer-approvals")} />
                </List>
              ) : (
                <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", py: 4 }}>
                  <AssignmentIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
                  <Typography variant="body2" color="text.secondary">All caught up!</Typography>
                  <Typography variant="caption" color="text.disabled">No items awaiting approval</Typography>
                </Box>
              )}
            </Paper>
          </Grid>

          {/* ═══════ ROW 3 — Financial Snapshot + Top Products + Recent Activity ═══════ */}

          {/* Financial Snapshot */}
          {canViewFinance && (
            <Grid item xs={12} md={6} lg={4}>
              <Paper sx={{ p: 2.5, height: "100%", borderRadius: 2 }} elevation={0} variant="outlined">
                <Typography variant="h6" fontWeight={600} gutterBottom>Financial Snapshot</Typography>
                <Stack spacing={2.5}>
                  <Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                      <Typography variant="body2" color="text.secondary">Credit Receivables</Typography>
                      <Typography variant="body2" fontWeight={700} color="error.main">
                        Rs. {fmtLKR(metrics?.total_credit_outstanding || 0)}
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={metrics?.total_sales_month ? Math.min(((metrics.total_credit_outstanding || 0) / metrics.total_sales_month) * 100, 100) : 0}
                      color="error"
                      sx={{ height: 6, borderRadius: 1 }}
                    />
                    <Typography variant="caption" color="text.disabled">Outstanding customer credits</Typography>
                  </Box>
                  <Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                      <Typography variant="body2" color="text.secondary">Supplier Payables</Typography>
                      <Typography variant="body2" fontWeight={700} color="warning.main">
                        Rs. {fmtLKR(metrics?.total_supplier_credit || 0)}
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={metrics?.total_purchases_month ? Math.min(((metrics.total_supplier_credit || 0) / metrics.total_purchases_month) * 100, 100) : 0}
                      color="warning"
                      sx={{ height: 6, borderRadius: 1 }}
                    />
                    <Typography variant="caption" color="text.disabled">Outstanding to suppliers</Typography>
                  </Box>
                  <Divider />
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>This Month</Typography>
                    <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.5 }}>
                      <Typography variant="body2">Sales Revenue</Typography>
                      <Typography variant="body2" fontWeight={600} color="success.main">Rs. {fmtLKR(metrics?.total_sales_month || 0)}</Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.5 }}>
                      <Typography variant="body2">Purchases</Typography>
                      <Typography variant="body2" fontWeight={600} color="primary.main">Rs. {fmtLKR(metrics?.total_purchases_month || 0)}</Typography>
                    </Box>
                    <Divider sx={{ my: 1 }} />
                    <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.5 }}>
                      <Typography variant="body2" fontWeight={600}>Net (Sales − Purchases)</Typography>
                      <Typography
                        variant="body2"
                        fontWeight={700}
                        color={(metrics?.total_sales_month || 0) >= (metrics?.total_purchases_month || 0) ? "success.main" : "error.main"}
                      >
                        Rs. {fmtLKR((metrics?.total_sales_month || 0) - (metrics?.total_purchases_month || 0))}
                      </Typography>
                    </Box>
                  </Box>
                </Stack>
              </Paper>
            </Grid>
          )}

          {/* Top Selling Products */}
          <Grid item xs={12} md={6} lg={canViewFinance ? 4 : 6}>
            <Paper sx={{ p: 2.5, height: "100%", borderRadius: 2 }} elevation={0} variant="outlined">
              <Typography variant="h6" fontWeight={600} gutterBottom>Top Selling Products</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>This month by quantity</Typography>
              {loading ? (
                <TLoadingSkeleton type="list" count={5} />
              ) : metrics?.top_products && metrics.top_products.length > 0 ? (
                <Stack spacing={1.5}>
                  {metrics.top_products.map((product, i) => {
                    const maxQty = metrics.top_products[0]?.quantity || 1;
                    const pct = (product.quantity / maxQty) * 100;
                    return (
                      <Box key={i}>
                        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.25 }}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0, flex: 1 }}>
                            <Chip
                              label={`#${i + 1}`}
                              size="small"
                              sx={{
                                fontWeight: 700, fontSize: "0.65rem", height: 20, minWidth: 28,
                                bgcolor: i === 0 ? "warning.main" : i === 1 ? "text.disabled" : "action.selected",
                                color: i < 2 ? "white" : "text.primary",
                              }}
                            />
                            <Typography variant="body2" fontWeight={500} noWrap>{product.name}</Typography>
                          </Box>
                          <Typography variant="body2" fontWeight={600} color="text.secondary" sx={{ ml: 1, flexShrink: 0 }}>
                            {product.quantity} sold
                          </Typography>
                        </Box>
                        <LinearProgress variant="determinate" value={pct} sx={{ height: 4, borderRadius: 1, bgcolor: "action.hover" }} color={i === 0 ? "warning" : "primary"} />
                      </Box>
                    );
                  })}
                </Stack>
              ) : (
                <TEmptyState title="No sales yet" message="Top products will appear here once sales are recorded" size="small" />
              )}
            </Paper>
          </Grid>

          {/* Recent Activity */}
          <Grid item xs={12} md={12} lg={canViewFinance ? 4 : 6}>
            <Paper sx={{ p: 2.5, height: "100%", borderRadius: 2 }} elevation={0} variant="outlined">
              <Typography variant="h6" fontWeight={600} gutterBottom>Recent Activity</Typography>
              {loading ? (
                <TLoadingSkeleton type="list" count={5} />
              ) : metrics?.recent_activities && metrics.recent_activities.length > 0 ? (
                <List disablePadding>
                  {metrics.recent_activities.slice(0, 7).map((activity, i) => (
                    <ListItem
                      key={i}
                      disablePadding
                      sx={{ py: 1, borderBottom: i < Math.min(metrics.recent_activities.length, 7) - 1 ? 1 : 0, borderColor: "divider" }}
                    >
                      <ListItemAvatar sx={{ minWidth: 40 }}>
                        <Avatar sx={{ width: 32, height: 32, bgcolor: `${getActivityColor(activity.type)}15`, color: getActivityColor(activity.type) }}>
                          {getActivityIcon(activity.type)}
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={activity.title}
                        secondary={formatRelativeTime(activity.time)}
                        primaryTypographyProps={{ variant: "body2", fontWeight: 500, noWrap: true }}
                        secondaryTypographyProps={{ variant: "caption" }}
                      />
                    </ListItem>
                  ))}
                </List>
              ) : (
                <TEmptyState title="No recent activity" message="Activities will appear here as you use the system" size="small" />
              )}
            </Paper>
          </Grid>

          {/* ═══════ ROW 4 — Quick Actions ═══════ */}
          <Grid item xs={12}>
            <Paper sx={{ p: 2.5, borderRadius: 2 }} elevation={0} variant="outlined">
              <Typography variant="h6" fontWeight={600} gutterBottom>Quick Actions</Typography>
              <Grid container spacing={1.5}>
                {canViewSales && hasPermission(user, PERMISSIONS.SALES_CREATE.resource, PERMISSIONS.SALES_CREATE.action) && (
                  <Grid item xs={6} sm={4} md={2}>
                    <Card variant="outlined" sx={{ borderRadius: 2 }}>
                      <CardActionArea sx={{ p: 2, textAlign: "center" }} onClick={() => navigate("/sales?action=new")}>
                        <ShoppingCartIcon color="success" sx={{ fontSize: 32, mb: 0.5 }} />
                        <Typography variant="caption" fontWeight={600} display="block">New Sale</Typography>
                      </CardActionArea>
                    </Card>
                  </Grid>
                )}
                {canViewSales && hasPermission(user, PERMISSIONS.CUSTOMER_CREATE.resource, PERMISSIONS.CUSTOMER_CREATE.action) && (
                  <Grid item xs={6} sm={4} md={2}>
                    <Card variant="outlined" sx={{ borderRadius: 2 }}>
                      <CardActionArea sx={{ p: 2, textAlign: "center" }} onClick={() => navigate("/sales/customers?action=new")}>
                        <PersonAddIcon color="primary" sx={{ fontSize: 32, mb: 0.5 }} />
                        <Typography variant="caption" fontWeight={600} display="block">Add Customer</Typography>
                      </CardActionArea>
                    </Card>
                  </Grid>
                )}
                {canViewPurchasing && hasPermission(user, PERMISSIONS.PURCHASING_CREATE.resource, PERMISSIONS.PURCHASING_CREATE.action) && (
                  <Grid item xs={6} sm={4} md={2}>
                    <Card variant="outlined" sx={{ borderRadius: 2 }}>
                      <CardActionArea sx={{ p: 2, textAlign: "center" }} onClick={() => navigate("/purchasing?action=new")}>
                        <LocalShippingIcon color="info" sx={{ fontSize: 32, mb: 0.5 }} />
                        <Typography variant="caption" fontWeight={600} display="block">New PO</Typography>
                      </CardActionArea>
                    </Card>
                  </Grid>
                )}
                {canViewInventory && hasPermission(user, PERMISSIONS.INVENTORY_CREATE.resource, PERMISSIONS.INVENTORY_CREATE.action) && (
                  <Grid item xs={6} sm={4} md={2}>
                    <Card variant="outlined" sx={{ borderRadius: 2 }}>
                      <CardActionArea sx={{ p: 2, textAlign: "center" }} onClick={() => navigate("/inventory?action=new")}>
                        <InventoryIcon color="warning" sx={{ fontSize: 32, mb: 0.5 }} />
                        <Typography variant="caption" fontWeight={600} display="block">Add Product</Typography>
                      </CardActionArea>
                    </Card>
                  </Grid>
                )}
                {canViewWarehouse && (
                  <Grid item xs={6} sm={4} md={2}>
                    <Card variant="outlined" sx={{ borderRadius: 2 }}>
                      <CardActionArea sx={{ p: 2, textAlign: "center" }} onClick={() => navigate("/warehouse/sales-stock")}>
                        <ConfirmationNumberIcon sx={{ fontSize: 32, mb: 0.5, color: "text.secondary" }} />
                        <Typography variant="caption" fontWeight={600} display="block">Sales Stock</Typography>
                      </CardActionArea>
                    </Card>
                  </Grid>
                )}
                {canViewSupport && (
                  <Grid item xs={6} sm={4} md={2}>
                    <Card variant="outlined" sx={{ borderRadius: 2 }}>
                      <CardActionArea sx={{ p: 2, textAlign: "center" }} onClick={() => navigate("/support")}>
                        <SupportAgentIcon sx={{ fontSize: 32, mb: 0.5, color: "secondary.main" }} />
                        <Typography variant="caption" fontWeight={600} display="block">Support</Typography>
                      </CardActionArea>
                    </Card>
                  </Grid>
                )}
              </Grid>
            </Paper>
          </Grid>
        </Grid>
      )}
    </Box>
  );
}
