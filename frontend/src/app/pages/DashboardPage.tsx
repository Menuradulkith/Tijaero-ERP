import ErrorDisplay from "@/components/ErrorDisplay";
import {
  fmtLKR,
  TEmptyState,
  TIconButton,
  TLoading,
  TLoadingSkeleton,
  TPageHeader,
  TSection,
  TStatCard,
} from "@/components/tijaero";
import { useDashboardMetrics } from "@/hooks/useDashboardMetrics";
import { calculatePercentageChange } from "@/utils/calculations";
import {
  formatRelativeTime,
} from "@/utils/formatters";
import {
  getPreviousMetrics,
  shouldUpdateStoredMetrics,
  storePreviousMetrics,
} from "@/utils/trendStorage";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import InventoryIcon from "@mui/icons-material/Inventory";
import PeopleIcon from "@mui/icons-material/People";
import RefreshIcon from "@mui/icons-material/Refresh";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import { Box, Card, Grid, LinearProgress, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

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
      <Box sx={{ p: 3, height: "100%", overflow: "auto" }}>
        <TPageHeader
          title="Dashboard"
          subtitle="Overview of your business performance and metrics"
        />
        <ErrorDisplay error={error} onRetry={refresh} />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, height: "100%", overflow: "auto" }}>
      <TPageHeader
        title="Dashboard"
        subtitle="Overview of your business performance and metrics"
        actions={
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
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
              <ToggleButton value="today" aria-label="today" sx={{ px: 1.5, py: 0.5 }}>
                Today
              </ToggleButton>
              <ToggleButton value="week" aria-label="week" sx={{ px: 1.5, py: 0.5 }}>
                Week
              </ToggleButton>
              <ToggleButton value="month" aria-label="month" sx={{ px: 1.5, py: 0.5 }}>
                Month
              </ToggleButton>
              <ToggleButton value="year" aria-label="year" sx={{ px: 1.5, py: 0.5 }}>
                Year
              </ToggleButton>
            </ToggleButtonGroup>

            {/* Refresh Button */}
            <TIconButton
              onClick={handleRefresh}
              disabled={isRefreshing || loading}
              color="primary"
              tooltip="Refresh dashboard"
              size="small"
            >
              {isRefreshing ? <TLoading size="small" /> : <RefreshIcon />}
            </TIconButton>
          </Box>
        }
      />

      {/* Stats Row */}
      <Grid container spacing={3} mb={4}>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Total Customers"
            value={metrics?.total_customers || 0}
            trend={trends.customers}
            icon={<PeopleIcon />}
            color="primary"
            loading={loading}
            onClick={() => navigate("/sales/customers")}
            tooltip="Click to view all customers"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Sales This Month"
            value={metrics?.total_sales_month || 0}
            format="currency"
            trend={trends.sales}
            icon={<ShoppingCartIcon />}
            color="success"
            loading={loading}
            onClick={() => navigate("/sales")}
            tooltip="Click to view sales"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Inventory Items"
            value={metrics?.total_products || 0}
            trend={trends.inventory}
            icon={<InventoryIcon />}
            color="warning"
            loading={loading}
            onClick={() => navigate("/inventory")}
            tooltip="Click to view inventory"
            badge={metrics && metrics.low_stock_items > 0 ? metrics.low_stock_items : undefined}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Revenue"
            value={metrics?.total_sales_month || 0}
            format="currency"
            trend={trends.revenue}
            icon={<AccountBalanceWalletIcon />}
            color="info"
            loading={loading}
            onClick={() => navigate("/finance")}
            tooltip="Click to view finance"
          />
        </Grid>
      </Grid>

      {/* Charts Row */}
      <Grid container spacing={3}>
        {/* Sales Trend Chart */}
        <Grid item xs={12} lg={8}>
          <TSection title="Sales Trend" paper>
            {loading ? (
              <TLoadingSkeleton type="card" />
            ) : (
              <Box sx={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
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
                          return [`Rs. ${fmtLKR(Number(value))}`, "Sales"];
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
          </TSection>
        </Grid>

        {/* Performance Metrics */}
        <Grid item xs={12} lg={4}>
          <TSection title="Performance Metrics" paper>
            {loading ? (
              <TLoadingSkeleton type="list" count={3} />
            ) : (
              <Box>
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
                      Rs. {fmtLKR(metrics?.total_sales_today || 0)}
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
          </TSection>
        </Grid>

        {/* Recent Activities */}
        <Grid item xs={12} lg={4}>
          <TSection title="Recent Activities" paper>
            {loading ? (
              <TLoadingSkeleton type="list" count={3} />
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
              <TEmptyState
                title="No recent activities"
                message="Activities will appear here as you use the system"
                size="small"
              />
            )}
          </TSection>
        </Grid>
      </Grid>

      {/* Quick Actions */}
      <Box mt={4}>
        <TSection title="Quick Actions" marginBottom={0}>
          <Grid container spacing={2}>
            <Grid item xs={6} sm={3}>
              <Card
                sx={{
                  cursor: "pointer",
                  textAlign: "center",
                  p: 2,
                  transition: "all 0.2s",
                  "&:hover": { bgcolor: "action.hover", transform: "translateY(-2px)" },
                }}
                onClick={() => navigate("/sales/customers?action=new")}
              >
                <PeopleIcon color="primary" sx={{ fontSize: 40, mb: 1 }} />
                <Typography variant="body2" fontWeight="500">
                  Add Customer
                </Typography>
              </Card>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Card
                sx={{
                  cursor: "pointer",
                  textAlign: "center",
                  p: 2,
                  transition: "all 0.2s",
                  "&:hover": { bgcolor: "action.hover", transform: "translateY(-2px)" },
                }}
                onClick={() => navigate("/sales?action=new")}
              >
                <ShoppingCartIcon color="success" sx={{ fontSize: 40, mb: 1 }} />
                <Typography variant="body2" fontWeight="500">
                  Create Sale Order
                </Typography>
              </Card>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Card
                sx={{
                  cursor: "pointer",
                  textAlign: "center",
                  p: 2,
                  transition: "all 0.2s",
                  "&:hover": { bgcolor: "action.hover", transform: "translateY(-2px)" },
                }}
                onClick={() => navigate("/inventory?action=new")}
              >
                <InventoryIcon color="warning" sx={{ fontSize: 40, mb: 1 }} />
                <Typography variant="body2" fontWeight="500">
                  Add Product
                </Typography>
              </Card>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Card
                sx={{
                  cursor: "pointer",
                  textAlign: "center",
                  p: 2,
                  transition: "all 0.2s",
                  "&:hover": { bgcolor: "action.hover", transform: "translateY(-2px)" },
                }}
                onClick={() => navigate("/finance")}
              >
                <AccountBalanceWalletIcon color="info" sx={{ fontSize: 40, mb: 1 }} />
                <Typography variant="body2" fontWeight="500">
                  Record Payment
                </Typography>
              </Card>
            </Grid>
          </Grid>
        </TSection>
      </Box>
    </Box>
  );
}
