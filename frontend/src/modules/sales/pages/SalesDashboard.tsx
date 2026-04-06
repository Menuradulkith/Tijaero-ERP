import {
  fmtLKR,
  TCurrency,
  TPageHeader,
  TPageSkeleton,
  TStatCard,
  TStatusChip,
} from "@/components/tijaero";
import { useReferenceData } from "@/hooks";
import { useEffect } from "react";
import {
  AttachMoney as MoneyIcon,
  People as PeopleIcon,
  Receipt as ReceiptIcon,
  AssignmentReturn as ReturnIcon,
} from "@mui/icons-material";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  const navigate = useNavigate();

  // Branch list for filter dropdown — resolved BEFORE query fires
  const { filteredBranches, defaultBranchCode } = useReferenceData(["branches"]);
  const branches = filteredBranches || [];

  // Auto-default branch filter for non-superuser users
  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wait until the branch default is resolved before firing the stats query.
  // If defaultBranchCode exists (branch user) we wait for it to be applied;
  // if there is no defaultBranchCode (superuser / no branch) we fire immediately.
  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  // OPTIMIZED: Use statistics endpoint - single API call with SQL aggregations
  const { data: stats, isLoading, isError, refetch } = useQuery({
    queryKey: ["sales-statistics", filterBranch],
    queryFn: () => salesApi.getStatistics(filterBranch || undefined),
    enabled: branchResolved,
    placeholderData: (prev) => prev, // keep showing previous data while re-fetching
  });

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

  if (isError) {
    return (
      <Box sx={{ p: 3 }}>
        <TPageHeader title="Sales Dashboard" subtitle="Overview of sales performance and statistics" />
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => refetch()}>
              Retry
            </Button>
          }
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
            value={`Rs. ${fmtLKR(stats.total_revenue)}`}
            subtitle={`This month: Rs. ${fmtLKR(stats.current_month_revenue)}`}
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
                      Rs. {fmtLKR(amount)} ({percentage.toFixed(1)}%)
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
            {stats.recent_invoices.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 3 }}>
                <ReceiptIcon sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />
                <Typography variant="body2" color="text.secondary">No recent orders</Typography>
              </Box>
            ) : (
            <List dense>
              {stats.recent_invoices.map((invoice) => (
                <ListItemButton key={invoice.id} divider onClick={() => navigate(`/sales?invoice=${invoice.id}`)} sx={{ borderRadius: 1 }}>
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
                </ListItemButton>
              ))}
            </List>
            )}
          </Paper>
        </Grid>

        {/* Top Invoices */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
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
                <Grid item xs={12} sm={6} md={2} key={invoice.id}>
                  <Card variant="outlined" sx={{ cursor: "pointer" }} onClick={() => navigate(`/sales?invoice=${invoice.id}`)}>
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
