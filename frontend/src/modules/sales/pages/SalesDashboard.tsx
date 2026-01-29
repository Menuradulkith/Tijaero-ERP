import {
  TCurrency,
  TLoading,
  TPageHeader,
  TStatCard,
  TStatusChip,
} from "@/components/tijaero";
import { useReferenceData } from "@/hooks";
import {
  AttachMoney as MoneyIcon,
  People as PeopleIcon,
  Receipt as ReceiptIcon,
  AssignmentReturn as ReturnIcon,
} from "@mui/icons-material";
import {
  Autocomplete,
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { salesApi } from "../api";

/**
 * OPTIMIZED Sales Dashboard
 * 
 * Performance improvements:
 * - Uses `/sales/statistics` endpoint instead of fetching ALL invoices
 * - Backend performs SQL aggregations for KPIs, payment breakdown
 * - Top 5 and Recent 5 invoices fetched via SQL LIMIT (not client-side filter)
 * - Branch filtering available via URL params (TODO: implement when needed)
 */
export default function SalesDashboard() {
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  // OPTIMIZED: Use statistics endpoint - single API call with SQL aggregations
  const { data: stats, isLoading } = useQuery({
    queryKey: ["sales-statistics", filterBranch],
    queryFn: () => salesApi.getStatistics(),
    staleTime: 30000, // Cache for 30 seconds
  });

  // Branch list for filter dropdown
  const { data: refData } = useReferenceData(["branches"]);
  const branches = refData?.branches || [];

  // Calculate trends from statistics
  const trends = useMemo(() => {
    if (!stats) return { revenue: 0, orders: 0 };
    
    const revenueTrend = stats.current_month_revenue > 0 && stats.total_revenue > 0
      ? ((stats.current_month_revenue / stats.total_revenue) * 100)
      : 0;
    
    const ordersTrend = stats.last_month_orders > 0
      ? ((stats.current_month_orders - stats.last_month_orders) / stats.last_month_orders) * 100
      : 0;
    
    return { revenue: revenueTrend, orders: ordersTrend };
  }, [stats]);

  if (isLoading || !stats) {
    return <TLoading message="Loading sales data..." />;
  }

  // Format payment breakdown for display
  const paymentBreakdownDisplay = {
    cash: stats.payment_breakdown.cash,
    card: stats.payment_breakdown.card,
    cheque: stats.payment_breakdown.cheque,
    "Bank Transfer": stats.payment_breakdown.bank_transfer,
    credit: stats.payment_breakdown.credit,
  };

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

      <Grid container spacing={3}>
        {/* Stat Cards */}
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Total Revenue"
            value={`Rs. ${stats.total_revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            subtitle={`This month: Rs. ${stats.current_month_revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            icon={<MoneyIcon />}
            color="success"
            trend={trends.revenue}
            trendLabel="of total"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Total Orders"
            value={stats.total_orders}
            subtitle={`This month: ${stats.current_month_orders}`}
            icon={<ReceiptIcon />}
            color="primary"
            trend={trends.orders}
            trendLabel="from last month"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Pending Approval"
            value={stats.pending_approval}
            subtitle={`Approved: ${stats.approved}`}
            icon={<PeopleIcon />}
            color="warning"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Sale Returns"
            value={stats.sale_returns_count}
            subtitle="Total returns processed"
            icon={<ReturnIcon />}
            color="error"
          />
        </Grid>

        {/* Payment Breakdown */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, height: "100%" }}>
            <Typography variant="h6" gutterBottom>
              Payment Methods
            </Typography>
            <Divider sx={{ mb: 2 }} />
            {Object.entries(paymentBreakdownDisplay).map(([method, amount]) => {
              const percentage = stats.total_revenue > 0 ? (amount / stats.total_revenue) * 100 : 0;
              return (
                <Box key={method} sx={{ mb: 2 }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                    <Typography variant="body2" sx={{ textTransform: "capitalize" }}>
                      {method.replace(/_/g, ' ')}
                    </Typography>
                    <Typography variant="body2" fontWeight={500}>
                      Rs. {amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({percentage.toFixed(1)}%)
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={percentage}
                    sx={{ height: 8, borderRadius: 1 }}
                  />
                </Box>
              );
            })}
          </Paper>
        </Grid>

        {/* Recent Invoices */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, height: "100%" }}>
            <Typography variant="h6" gutterBottom>
              Recent Orders
            </Typography>
            <Divider sx={{ mb: 1 }} />
            <List dense>
              {stats.recent_invoices.map((invoice) => (
                <ListItem key={invoice.id} divider>
                  <ListItemText
                    primary={invoice.invoice_no}
                    secondary={format(new Date(invoice.created_date), "MMM dd, yyyy")}
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
                </ListItem>
              ))}
            </List>
          </Paper>
        </Grid>

        {/* Top Invoices */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Top Orders by Value
            </Typography>
            <Divider sx={{ mb: 2 }} />
            <Grid container spacing={2}>
              {stats.top_invoices.map((invoice, index) => (
                <Grid item xs={12} sm={6} md={2.4} key={invoice.id}>
                  <Card variant="outlined">
                    <CardContent sx={{ textAlign: "center" }}>
                      <Chip label={`#${index + 1}`} size="small" color="primary" sx={{ mb: 1 }} />
                      <Typography variant="subtitle2" noWrap>
                        {invoice.invoice_no}
                      </Typography>
                      <Typography variant="h6" color="success.main" fontWeight={700}>
                        Rs. {invoice.total.toFixed(2)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {format(new Date(invoice.created_date), "MMM dd")}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
