import { useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState, useCallback } from "react";
import { ToggleButtonGroup, ToggleButton, Tooltip } from "@mui/material";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Grid,
  Card,
  CardContent,
  Typography,
  Box,
  Paper,
  LinearProgress,
  Skeleton,
} from "@mui/material";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import PeopleIcon from "@mui/icons-material/People";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import InventoryIcon from "@mui/icons-material/Inventory";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import RefreshIcon from "@mui/icons-material/Refresh";
import IconButton from "@mui/material/IconButton";
import CircularProgress from "@mui/material/CircularProgress";
import WarningIcon from "@mui/icons-material/Warning";
import Badge from "@mui/material/Badge";
import { useDashboardMetrics } from "@/hooks/useDashboardMetrics";
import {
  formatCurrency,
  formatNumber,
  formatRelativeTime,
} from "@/utils/formatters";
import { calculatePercentageChange } from "@/utils/calculations";
import {
  storePreviousMetrics,
  getPreviousMetrics,
  shouldUpdateStoredMetrics,
} from "@/utils/trendStorage";
import StatCardSkeleton from "@/components/StatCardSkeleton";
import ErrorDisplay from "@/components/ErrorDisplay";

interface StatCardProps {
  title: string;
  value: string;
  change: number;
  icon: React.ReactNode;
  color: string;
  onClick?: () => void;
}

function StatCard({
  title,
  value,
  change,
  icon,
  color,
  onClick,
}: StatCardProps) {
  const isPositive = change >= 0;

  return (
    <Card
      sx={{
        cursor: onClick ? "pointer" : "default",
        transition: "transform 0.2s, box-shadow 0.2s",
        "&:hover": onClick
          ? {
              transform: "translateY(-4px)",
              boxShadow: 4,
            }
          : {},
      }}
      onClick={onClick}
    >
      <CardContent>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <Box>
            <Typography color="text.secondary" variant="body2" gutterBottom>
              {title}
            </Typography>
            <Typography
              variant="h4"
              component="div"
              sx={{
                mb: 1,
                fontSize: { xs: "1.5rem", sm: "1.75rem", md: "2.125rem" },
              }}
            >
              {value}
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              {isPositive ? (
                <TrendingUpIcon sx={{ fontSize: 16, color: "success.main" }} />
              ) : (
                <TrendingDownIcon sx={{ fontSize: 16, color: "error.main" }} />
              )}
              <Typography
                variant="body2"
                sx={{ color: isPositive ? "success.main" : "error.main" }}
              >
                {Math.abs(change)}%
              </Typography>
              <Typography variant="body2" color="text.secondary">
                vs last month
              </Typography>
            </Box>
          </Box>
          <Box
            sx={{
              bgcolor: color,
              borderRadius: 2,
              p: 1.5,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {icon}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

interface ActivityItem {
  title: string;
  time: string;
  type: "sale" | "customer" | "inventory" | "payment";
}

/**
 * Get icon component for activity type
 */
function getActivityIcon(type: ActivityItem["type"]) {
  switch (type) {
    case "sale":
      return <ShoppingCartIcon fontSize="small" />;
    case "customer":
      return <PeopleIcon fontSize="small" />;
    case "inventory":
      return <InventoryIcon fontSize="small" />;
    case "payment":
      return <AccountBalanceWalletIcon fontSize="small" />;
    default:
      return null;
  }
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { metrics, loading, error, refresh } = useDashboardMetrics();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [timePeriod, setTimePeriod] = useState<
    "today" | "week" | "month" | "year"
  >("month");

  // Debounced refresh function
  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;

    setIsRefreshing(true);
    try {
      await refresh();
    } finally {
      // Keep refreshing state for at least 1 second for visual feedback
      setTimeout(() => setIsRefreshing(false), 1000);
    }
  }, [refresh, isRefreshing]);

  // Store metrics for next month's trend calculation
  useEffect(() => {
    if (metrics && shouldUpdateStoredMetrics()) {
      storePreviousMetrics({
        total_customers: metrics.total_customers,
        total_sales_month: metrics.total_sales_month,
        total_products: metrics.total_products,
      });
    }
  }, [metrics]);

  // Calculate trends
  const trends = useMemo(() => {
    if (!metrics) {
      return {
        customers: 0,
        sales: 0,
        inventory: 0,
        revenue: 0,
      };
    }

    const previous = getPreviousMetrics();
    if (!previous) {
      return {
        customers: 0,
        sales: 0,
        inventory: 0,
        revenue: 0,
      };
    }

    return {
      customers: calculatePercentageChange(
        metrics.total_customers,
        previous.total_customers
      ),
      sales: calculatePercentageChange(
        metrics.total_sales_month,
        previous.total_sales_month
      ),
      inventory: calculatePercentageChange(
        metrics.total_products,
        previous.total_products
      ),
      revenue: calculatePercentageChange(
        metrics.total_sales_month,
        previous.total_sales_month
      ),
    };
  }, [metrics]);

  // Show error state
  if (error && !loading) {
    return (
      <Box>
        <Typography
          variant="h4"
          gutterBottom
          sx={{
            mb: 3,
            fontSize: { xs: "1.5rem", sm: "2rem", md: "2.125rem" },
          }}
        >
          Dashboard
        </Typography>
        <ErrorDisplay error={error} onRetry={refresh} />
      </Box>
    );
  }

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
          flexWrap: "wrap",
          gap: 2,
        }}
      >
        <Typography
          variant="h4"
          sx={{
            fontSize: { xs: "1.5rem", sm: "2rem", md: "2.125rem" },
          }}
        >
          Dashboard
        </Typography>

        <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
          {/* Time Period Filter */}
          <ToggleButtonGroup
            value={timePeriod}
            exclusive
            onChange={(_, newValue) => {
              if (newValue) setTimePeriod(newValue);
            }}
            size="small"
            aria-label="time period"
          >
            <ToggleButton value="today" aria-label="today">
              Today
            </ToggleButton>
            <ToggleButton value="week" aria-label="week">
              Week
            </ToggleButton>
            <ToggleButton value="month" aria-label="month">
              Month
            </ToggleButton>
            <ToggleButton value="year" aria-label="year">
              Year
            </ToggleButton>
          </ToggleButtonGroup>

          {/* Refresh Button */}
          <Tooltip title="Refresh dashboard">
            <IconButton
              onClick={handleRefresh}
              disabled={isRefreshing || loading}
              color="primary"
              aria-label="refresh dashboard"
            >
              {isRefreshing ? <CircularProgress size={24} /> : <RefreshIcon />}
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Grid container spacing={3}>
        {/* Stat Cards */}
        <Grid item xs={12} sm={6} lg={3}>
          {loading ? (
            <StatCardSkeleton />
          ) : (
            <Tooltip title="Click to view all customers" arrow>
              <Box>
                <StatCard
                  title="Total Customers"
                  value={formatNumber(metrics?.total_customers || 0)}
                  change={trends.customers}
                  icon={<PeopleIcon sx={{ color: "white", fontSize: 32 }} />}
                  color="primary.main"
                  onClick={() => navigate("/customers")}
                />
              </Box>
            </Tooltip>
          )}
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          {loading ? (
            <StatCardSkeleton />
          ) : (
            <Tooltip title="Click to view sales" arrow>
              <Box>
                <StatCard
                  title="Sales This Month"
                  value={formatCurrency(metrics?.total_sales_month || 0)}
                  change={trends.sales}
                  icon={
                    <ShoppingCartIcon sx={{ color: "white", fontSize: 32 }} />
                  }
                  color="success.main"
                  onClick={() => navigate("/sales")}
                />
              </Box>
            </Tooltip>
          )}
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          {loading ? (
            <StatCardSkeleton />
          ) : (
            <Tooltip title="Click to view inventory" arrow>
              <Box sx={{ position: "relative" }}>
                {metrics && metrics.low_stock_items > 0 && (
                  <Badge
                    badgeContent={metrics.low_stock_items}
                    color="error"
                    sx={{
                      position: "absolute",
                      top: 16,
                      right: 16,
                      zIndex: 1,
                    }}
                  >
                    <WarningIcon color="error" />
                  </Badge>
                )}
                <StatCard
                  title="Inventory Items"
                  value={formatNumber(metrics?.total_products || 0)}
                  change={trends.inventory}
                  icon={<InventoryIcon sx={{ color: "white", fontSize: 32 }} />}
                  color="warning.main"
                  onClick={() => navigate("/inventory")}
                />
              </Box>
            </Tooltip>
          )}
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          {loading ? (
            <StatCardSkeleton />
          ) : (
            <Tooltip title="Click to view finance" arrow>
              <Box>
                <StatCard
                  title="Revenue"
                  value={formatCurrency(metrics?.total_sales_month || 0)}
                  change={trends.revenue}
                  icon={
                    <AccountBalanceWalletIcon
                      sx={{ color: "white", fontSize: 32 }}
                    />
                  }
                  color="info.main"
                  onClick={() => navigate("/finance")}
                />
              </Box>
            </Tooltip>
          )}
        </Grid>

        {/* Sales Trend Chart */}
        <Grid item xs={12} lg={8}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Sales Trend
              </Typography>
              {loading ? (
                <Box sx={{ mt: 3 }}>
                  <Skeleton variant="rectangular" height={300} />
                </Box>
              ) : (
                <Box sx={{ mt: 3, height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={[
                        {
                          name: "Week 1",
                          sales: metrics?.total_sales_month
                            ? metrics.total_sales_month * 0.2
                            : 0,
                          orders: metrics?.total_orders_month
                            ? Math.floor(metrics.total_orders_month * 0.2)
                            : 0,
                        },
                        {
                          name: "Week 2",
                          sales: metrics?.total_sales_month
                            ? metrics.total_sales_month * 0.25
                            : 0,
                          orders: metrics?.total_orders_month
                            ? Math.floor(metrics.total_orders_month * 0.25)
                            : 0,
                        },
                        {
                          name: "Week 3",
                          sales: metrics?.total_sales_month
                            ? metrics.total_sales_month * 0.3
                            : 0,
                          orders: metrics?.total_orders_month
                            ? Math.floor(metrics.total_orders_month * 0.3)
                            : 0,
                        },
                        {
                          name: "Week 4",
                          sales: metrics?.total_sales_month
                            ? metrics.total_sales_month * 0.25
                            : 0,
                          orders: metrics?.total_orders_month
                            ? Math.floor(metrics.total_orders_month * 0.25)
                            : 0,
                        },
                      ]}
                      margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis yAxisId="left" />
                      <YAxis yAxisId="right" orientation="right" />
                      <RechartsTooltip
                        formatter={(value: any, name: string | undefined) => {
                          if (name === "sales") {
                            return [formatCurrency(Number(value)), "Sales"];
                          }
                          return [value, "Orders"];
                        }}
                      />
                      <Legend />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="sales"
                        stroke="#2e7d32"
                        strokeWidth={2}
                        name="Sales"
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="orders"
                        stroke="#1976d2"
                        strokeWidth={2}
                        name="Orders"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Performance Metrics */}
        <Grid item xs={12} lg={4}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Performance Metrics
              </Typography>
              {loading ? (
                <Box sx={{ mt: 3 }}>
                  <Skeleton variant="rectangular" height={60} sx={{ mb: 3 }} />
                  <Skeleton variant="rectangular" height={60} sx={{ mb: 3 }} />
                  <Skeleton variant="rectangular" height={60} />
                </Box>
              ) : (
                <Box sx={{ mt: 3 }}>
                  {/* Sales Today */}
                  <Box sx={{ mb: 3 }}>
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        mb: 1,
                      }}
                    >
                      <Typography variant="body2">Today's Sales</Typography>
                      <Typography variant="body2" fontWeight={600}>
                        {formatCurrency(metrics?.total_sales_today || 0)}
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={
                        metrics?.total_sales_month
                          ? Math.min(
                              (metrics.total_sales_today /
                                metrics.total_sales_month) *
                                100,
                              100
                            )
                          : 0
                      }
                      sx={{ height: 8, borderRadius: 1 }}
                    />
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mt: 0.5, display: "block" }}
                    >
                      {metrics?.total_sales_month
                        ? `${(
                            (metrics.total_sales_today /
                              metrics.total_sales_month) *
                            100
                          ).toFixed(1)}% of monthly sales`
                        : "No data"}
                    </Typography>
                  </Box>

                  {/* Orders Today */}
                  <Box sx={{ mb: 3 }}>
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        mb: 1,
                      }}
                    >
                      <Typography variant="body2">Orders Today</Typography>
                      <Typography variant="body2" fontWeight={600}>
                        {metrics?.total_orders_today || 0}
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={
                        metrics?.total_orders_month
                          ? Math.min(
                              (metrics.total_orders_today /
                                metrics.total_orders_month) *
                                100,
                              100
                            )
                          : 0
                      }
                      sx={{ height: 8, borderRadius: 1 }}
                      color="success"
                    />
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mt: 0.5, display: "block" }}
                    >
                      {metrics?.total_orders_month
                        ? `${(
                            (metrics.total_orders_today /
                              metrics.total_orders_month) *
                            100
                          ).toFixed(1)}% of monthly orders`
                        : "No data"}
                    </Typography>
                  </Box>

                  {/* Support Tickets */}
                  <Box>
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        mb: 1,
                      }}
                    >
                      <Typography variant="body2">
                        Open Support Tickets
                      </Typography>
                      <Typography variant="body2" fontWeight={600}>
                        {metrics?.open_support_tickets || 0}
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={
                        metrics?.open_support_tickets
                          ? Math.min(metrics.open_support_tickets * 10, 100)
                          : 0
                      }
                      sx={{ height: 8, borderRadius: 1 }}
                      color={
                        (metrics?.open_support_tickets || 0) > 5
                          ? "warning"
                          : "info"
                      }
                    />
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mt: 0.5, display: "block" }}
                    >
                      {(metrics?.open_support_tickets || 0) > 5
                        ? "High ticket volume"
                        : "Normal ticket volume"}
                    </Typography>
                  </Box>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Recent Activities */}
        <Grid item xs={12} lg={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Recent Activities
              </Typography>
              <Box sx={{ mt: 2 }}>
                {loading ? (
                  <Box>
                    <Skeleton variant="text" width="100%" height={40} />
                    <Skeleton variant="text" width="100%" height={40} />
                    <Skeleton variant="text" width="100%" height={40} />
                  </Box>
                ) : metrics?.recent_activities &&
                  metrics.recent_activities.length > 0 ? (
                  metrics.recent_activities
                    .slice(0, 5)
                    .map((activity, index) => (
                      <Box
                        key={index}
                        sx={{
                          py: 1.5,
                          borderBottom:
                            index <
                            Math.min(metrics.recent_activities.length, 5) - 1
                              ? 1
                              : 0,
                          borderColor: "divider",
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                        }}
                      >
                        <Box sx={{ color: "text.secondary" }}>
                          {getActivityIcon(activity.type)}
                        </Box>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2" fontWeight={500}>
                            {activity.title}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatRelativeTime(activity.time)}
                          </Typography>
                        </Box>
                      </Box>
                    ))
                ) : (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    textAlign="center"
                  >
                    No recent activities
                  </Typography>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Quick Actions */}
        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Quick Actions
            </Typography>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12} sm={6} md={3}>
                <Box
                  onClick={() => navigate("/customers?action=new")}
                  sx={{
                    p: 2,
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1,
                    textAlign: "center",
                    cursor: "pointer",
                    "&:hover": { bgcolor: "action.hover" },
                  }}
                >
                  <PeopleIcon
                    sx={{ fontSize: 40, color: "primary.main", mb: 1 }}
                  />
                  <Typography variant="body2">Add Customer</Typography>
                </Box>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Box
                  onClick={() => navigate("/sales?action=new")}
                  sx={{
                    p: 2,
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1,
                    textAlign: "center",
                    cursor: "pointer",
                    "&:hover": { bgcolor: "action.hover" },
                  }}
                >
                  <ShoppingCartIcon
                    sx={{ fontSize: 40, color: "success.main", mb: 1 }}
                  />
                  <Typography variant="body2">Create Sale Order</Typography>
                </Box>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Box
                  onClick={() => navigate("/inventory?action=new")}
                  sx={{
                    p: 2,
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1,
                    textAlign: "center",
                    cursor: "pointer",
                    "&:hover": { bgcolor: "action.hover" },
                  }}
                >
                  <InventoryIcon
                    sx={{ fontSize: 40, color: "warning.main", mb: 1 }}
                  />
                  <Typography variant="body2">Add Product</Typography>
                </Box>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Box
                  onClick={() => navigate("/finance")}
                  sx={{
                    p: 2,
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1,
                    textAlign: "center",
                    cursor: "pointer",
                    "&:hover": { bgcolor: "action.hover" },
                  }}
                >
                  <AccountBalanceWalletIcon
                    sx={{ fontSize: 40, color: "info.main", mb: 1 }}
                  />
                  <Typography variant="body2">Record Payment</Typography>
                </Box>
              </Grid>
            </Grid>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
