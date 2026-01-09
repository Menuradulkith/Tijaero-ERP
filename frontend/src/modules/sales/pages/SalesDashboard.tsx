import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Box,
  Grid,
  Paper,
  Typography,
  Card,
  CardContent,
  LinearProgress,
  Divider,
  List,
  ListItem,
  ListItemText,
  Chip,
} from "@mui/material";
import {
  Receipt as ReceiptIcon,
  AttachMoney as MoneyIcon,
  People as PeopleIcon,
  AssignmentReturn as ReturnIcon,
} from "@mui/icons-material";
import {
  TStatCard,
  TPageHeader,
  TStatusChip,
  TLoading,
  TCurrency,
} from "@/components/tijaero";
import { salesApi, saleReturnsApi } from "../api";
import { Invoice } from "../types";
import { format, startOfMonth, endOfMonth, isWithinInterval, subMonths } from "date-fns";

export default function SalesDashboard() {
  const { data: invoices, isLoading: invoicesLoading } = useQuery({
    queryKey: ["sales"],
    queryFn: () => salesApi.getAll(),
  });

  const { data: saleReturns, isLoading: returnsLoading } = useQuery({
    queryKey: ["sale-returns"],
    queryFn: () => saleReturnsApi.getAll(),
  });

  const isLoading = invoicesLoading || returnsLoading;

  // Calculate statistics
  const stats = useMemo(() => {
    if (!invoices) return null;

    const now = new Date();
    const currentMonthStart = startOfMonth(now);
    const currentMonthEnd = endOfMonth(now);
    const lastMonthStart = startOfMonth(subMonths(now, 1));
    const lastMonthEnd = endOfMonth(subMonths(now, 1));

    // Calculate total for an invoice
    const calculateTotal = (invoice: Invoice) =>
      invoice.cash_amount +
      invoice.card_visa_amount +
      invoice.card_mastercard_amount +
      invoice.card_amex_amount +
      invoice.cheque_amount +
      invoice.bank_transfer_amount +
      invoice.credit_amount;

    // Current month invoices
    const currentMonthInvoices = invoices.filter((inv) =>
      isWithinInterval(new Date(inv.created_date), {
        start: currentMonthStart,
        end: currentMonthEnd,
      })
    );

    // Last month invoices
    const lastMonthInvoices = invoices.filter((inv) =>
      isWithinInterval(new Date(inv.created_date), {
        start: lastMonthStart,
        end: lastMonthEnd,
      })
    );

    const currentMonthRevenue = currentMonthInvoices.reduce((sum, inv) => sum + calculateTotal(inv), 0);
    const lastMonthRevenue = lastMonthInvoices.reduce((sum, inv) => sum + calculateTotal(inv), 0);
    const totalRevenue = invoices.reduce((sum, inv) => sum + calculateTotal(inv), 0);

    const revenueTrend = lastMonthRevenue > 0 
      ? ((currentMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100 
      : 0;

    const ordersTrend = lastMonthInvoices.length > 0
      ? ((currentMonthInvoices.length - lastMonthInvoices.length) / lastMonthInvoices.length) * 100
      : 0;

    // Payment method breakdown
    const paymentBreakdown = {
      cash: invoices.reduce((sum, inv) => sum + inv.cash_amount, 0),
      card: invoices.reduce((sum, inv) => sum + inv.card_visa_amount + inv.card_mastercard_amount + inv.card_amex_amount, 0),
      cheque: invoices.reduce((sum, inv) => sum + inv.cheque_amount, 0),
      bankTransfer: invoices.reduce((sum, inv) => sum + inv.bank_transfer_amount, 0),
      credit: invoices.reduce((sum, inv) => sum + inv.credit_amount, 0),
    };

    // Top invoices
    const topInvoices = [...invoices]
      .sort((a, b) => calculateTotal(b) - calculateTotal(a))
      .slice(0, 5);

    // Recent invoices
    const recentInvoices = [...invoices]
      .sort((a, b) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime())
      .slice(0, 5);

    // Approval stats
    const pendingApproval = invoices.filter((inv) => !inv.approval).length;
    const approved = invoices.filter((inv) => inv.approval).length;

    return {
      totalOrders: invoices.length,
      currentMonthOrders: currentMonthInvoices.length,
      totalRevenue,
      currentMonthRevenue,
      revenueTrend,
      ordersTrend,
      paymentBreakdown,
      topInvoices,
      recentInvoices,
      pendingApproval,
      approved,
      saleReturnsCount: saleReturns?.length || 0,
      calculateTotal,
    };
  }, [invoices, saleReturns]);

  if (isLoading) {
    return <TLoading message="Loading sales data..." />;
  }

  if (!stats) {
    return (
      <Box sx={{ p: 3, textAlign: "center" }}>
        <Typography>No sales data available</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <TPageHeader
        title="Sales Dashboard"
        subtitle="Overview of sales performance and statistics"
      />

      <Grid container spacing={3}>
        {/* Stat Cards */}
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Total Revenue"
            value={`Rs. ${stats.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            subtitle={`This month: Rs. ${stats.currentMonthRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            icon={<MoneyIcon />}
            color="success"
            trend={stats.revenueTrend}
            trendLabel="from last month"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Total Orders"
            value={stats.totalOrders}
            subtitle={`This month: ${stats.currentMonthOrders}`}
            icon={<ReceiptIcon />}
            color="primary"
            trend={stats.ordersTrend}
            trendLabel="from last month"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Pending Approval"
            value={stats.pendingApproval}
            subtitle={`Approved: ${stats.approved}`}
            icon={<PeopleIcon />}
            color="warning"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Sale Returns"
            value={stats.saleReturnsCount}
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
            {Object.entries(stats.paymentBreakdown).map(([method, amount]) => {
              const percentage = stats.totalRevenue > 0 ? (amount / stats.totalRevenue) * 100 : 0;
              return (
                <Box key={method} sx={{ mb: 2 }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                    <Typography variant="body2" sx={{ textTransform: "capitalize" }}>
                      {method.replace(/([A-Z])/g, ' $1').trim()}
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
              {stats.recentInvoices.map((invoice) => (
                <ListItem key={invoice.id} divider>
                  <ListItemText
                    primary={invoice.invoice_no}
                    secondary={format(new Date(invoice.created_date), "MMM dd, yyyy")}
                  />
                  <Box sx={{ textAlign: "right" }}>
                    <Typography variant="body2" fontWeight={600} color="success.main">
                      <TCurrency value={stats.calculateTotal(invoice)} />
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
              {stats.topInvoices.map((invoice, index) => (
                <Grid item xs={12} sm={6} md={2.4} key={invoice.id}>
                  <Card variant="outlined">
                    <CardContent sx={{ textAlign: "center" }}>
                      <Chip label={`#${index + 1}`} size="small" color="primary" sx={{ mb: 1 }} />
                      <Typography variant="subtitle2" noWrap>
                        {invoice.invoice_no}
                      </Typography>
                      <Typography variant="h6" color="success.main" fontWeight={700}>
                        Rs. {stats.calculateTotal(invoice).toFixed(2)}
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
