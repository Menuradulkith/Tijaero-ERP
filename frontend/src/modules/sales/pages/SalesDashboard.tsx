import {
  TCurrency,
  TLoading,
  TPageHeader,
  TStatCard,
  TStatusChip,
} from "@/components/tijaero";
import { useReferenceData } from "@/hooks";
// OPTIMIZED: Removed branchApi import - using aggregated endpoint
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
import { endOfMonth, format, isWithinInterval, startOfMonth, subMonths } from "date-fns";
import { useMemo, useState } from "react";
import { saleReturnsApi, salesApi } from "../api";
import { Invoice } from "../types";

export default function SalesDashboard() {
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  const { data: invoices, isLoading: invoicesLoading } = useQuery({
    queryKey: ["sales"],
    queryFn: () => salesApi.getAll(),
  });

  const { data: saleReturns, isLoading: returnsLoading } = useQuery({
    queryKey: ["sale-returns"],
    queryFn: () => saleReturnsApi.getAll(),
  });

  // OPTIMIZED: Using aggregated endpoint (was separate branchApi call)
  const { data: refData } = useReferenceData(["branches"]);
  const branches = refData?.branches || [];

  const isLoading = invoicesLoading || returnsLoading;

  // Filter invoices by branch
  const filteredInvoices = useMemo(() => {
    if (!invoices) return [];
    if (!filterBranch) return invoices;
    return invoices.filter((inv) => inv.branch_code === filterBranch);
  }, [invoices, filterBranch]);

  // Filter sale returns by branch
  const filteredReturns = useMemo(() => {
    if (!saleReturns) return [];
    if (!filterBranch) return saleReturns;
    return saleReturns.filter((ret) => ret.branch_code === filterBranch);
  }, [saleReturns, filterBranch]);

  // Calculate total for an invoice
  const calculateTotal = (invoice: Invoice) =>
    invoice.cash_amount +
    invoice.card_visa_amount +
    invoice.card_mastercard_amount +
    invoice.card_amex_amount +
    invoice.cheque_amount +
    invoice.bank_transfer_amount +
    invoice.credit_amount;

  // Calculate statistics
  const stats = useMemo(() => {
    const now = new Date();
    const currentMonthStart = startOfMonth(now);
    const currentMonthEnd = endOfMonth(now);
    const lastMonthStart = startOfMonth(subMonths(now, 1));
    const lastMonthEnd = endOfMonth(subMonths(now, 1));

    // Current month invoices
    const currentMonthInvoices = filteredInvoices.filter((inv) =>
      isWithinInterval(new Date(inv.created_date), {
        start: currentMonthStart,
        end: currentMonthEnd,
      })
    );

    // Last month invoices
    const lastMonthInvoices = filteredInvoices.filter((inv) =>
      isWithinInterval(new Date(inv.created_date), {
        start: lastMonthStart,
        end: lastMonthEnd,
      })
    );

    const currentMonthRevenue = currentMonthInvoices.reduce((sum, inv) => sum + calculateTotal(inv), 0);
    const lastMonthRevenue = lastMonthInvoices.reduce((sum, inv) => sum + calculateTotal(inv), 0);
    const totalRevenue = filteredInvoices.reduce((sum, inv) => sum + calculateTotal(inv), 0);

    const revenueTrend = lastMonthRevenue > 0 
      ? ((currentMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100 
      : 0;

    const ordersTrend = lastMonthInvoices.length > 0
      ? ((currentMonthInvoices.length - lastMonthInvoices.length) / lastMonthInvoices.length) * 100
      : 0;

    // Payment method breakdown
    const paymentBreakdown = {
      cash: filteredInvoices.reduce((sum, inv) => sum + inv.cash_amount, 0),
      card: filteredInvoices.reduce((sum, inv) => sum + inv.card_visa_amount + inv.card_mastercard_amount + inv.card_amex_amount, 0),
      cheque: filteredInvoices.reduce((sum, inv) => sum + inv.cheque_amount, 0),
      bankTransfer: filteredInvoices.reduce((sum, inv) => sum + inv.bank_transfer_amount, 0),
      credit: filteredInvoices.reduce((sum, inv) => sum + inv.credit_amount, 0),
    };

    // Top invoices
    const topInvoices = [...filteredInvoices]
      .sort((a, b) => calculateTotal(b) - calculateTotal(a))
      .slice(0, 5);

    // Recent invoices
    const recentInvoices = [...filteredInvoices]
      .sort((a, b) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime())
      .slice(0, 5);

    // Approval stats
    const pendingApproval = filteredInvoices.filter((inv) => !inv.approval).length;
    const approved = filteredInvoices.filter((inv) => inv.approval).length;

    return {
      totalOrders: filteredInvoices.length,
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
      saleReturnsCount: filteredReturns.length,
    };
  }, [filteredInvoices, filteredReturns]);

  if (isLoading) {
    return <TLoading message="Loading sales data..." />;
  }

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
                      <TCurrency value={calculateTotal(invoice)} />
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
                        Rs. {calculateTotal(invoice).toFixed(2)}
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
