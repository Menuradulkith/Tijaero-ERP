/**
 * Purchasing Dashboard — modernized.
 *
 * Inspired by SAP Ariba, Odoo Purchase and Zoho Inventory:
 * - Header with branch filter and refresh
 * - KPI cards with inline sparklines and trend deltas
 * - Combined PO count + spending chart (last 7 days / 6 months)
 * - PO status donut + Payment-method donut
 * - Top suppliers leaderboard
 * - Recent POs + Recent GRNs
 *
 * All data sourced from `/purchasing/statistics`.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Divider,
  Grid,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Stack,
  Avatar,
  TextField,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from "@mui/material";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import BusinessIcon from "@mui/icons-material/Business";
import LaunchIcon from "@mui/icons-material/Launch";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import RefreshIcon from "@mui/icons-material/Refresh";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";

import {
  BreakdownDonut,
  DashboardPanel,
  KpiSparkCard,
  type BreakdownSlice,
} from "@/components/dashboard";
import { fmtLKR, TPageSkeleton, TStatusChip } from "@/components/tijaero";
import { useReferenceData, BranchRef } from "@/hooks";
import { purchasingStatsApi } from "@/modules/purchasing/api";

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Cash",
  cheque: "Cheque",
  bank_transfer: "Bank Transfer",
  credit: "Credit",
  card: "Card",
};

const PAYMENT_COLORS: Record<string, string> = {
  cash: "#10b981",
  cheque: "#8b5cf6",
  bank_transfer: "#0ea5e9",
  credit: "#f59e0b",
  card: "#2563eb",
};

export default function PurchasingDashboard() {
  const navigate = useNavigate();
  const theme = useTheme();
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  const { filteredBranches, defaultBranchCode } = useReferenceData(["branches"]);
  const branches = (filteredBranches as BranchRef[]) || [];

  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) setFilterBranch(defaultBranchCode);
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  const { data: stats, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["purchasing-statistics", filterBranch],
    queryFn: () => purchasingStatsApi.getStatistics(filterBranch || undefined),
    enabled: branchResolved,
    placeholderData: (prev) => prev,
  });

  const trends = useMemo(() => {
    if (!stats) return { value: 0, count: 0 };
    return {
      value:
        stats.last_month_po_value > 0
          ? ((stats.current_month_po_value - stats.last_month_po_value) / stats.last_month_po_value) * 100
          : 0,
      count:
        stats.last_month_pos > 0
          ? ((stats.current_month_pos - stats.last_month_pos) / stats.last_month_pos) * 100
          : 0,
    };
  }, [stats]);

  const orderSpark = useMemo(
    () => stats?.daily_orders?.map((d) => ({ value: d.orders })) ?? [],
    [stats],
  );
  const valueSpark = useMemo(
    () => stats?.monthly_spending?.map((d) => ({ value: d.value })) ?? [],
    [stats],
  );

  const statusSlices = useMemo<BreakdownSlice[]>(() => {
    if (!stats) return [];
    return [
      { label: "Approved", value: stats.approved_pos, color: "#10b981" },
      { label: "Pending / Draft", value: stats.pending_pos, color: "#f59e0b" },
      { label: "Completed", value: stats.completed_pos, color: "#0284c7" },
      { label: "Rejected", value: stats.rejected_pos, color: "#dc2626" },
    ].filter((s) => s.value > 0);
  }, [stats]);

  const paymentSlices = useMemo<BreakdownSlice[]>(() => {
    if (!stats || !stats.payment_methods) return [];
    return Object.entries(stats.payment_methods)
      .filter(([_, v]) => (v as number) > 0)
      .map(([k, v]) => ({
        label: PAYMENT_LABELS[k] || k,
        value: v as number,
        color: PAYMENT_COLORS[k] || "#64748b",
      }));
  }, [stats]);

  if (isError) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h5" fontWeight={700} sx={{ mb: 2 }}>Purchasing Dashboard</Typography>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => refetch()}>
              Retry
            </Button>
          }
        >
          Failed to load purchasing statistics.
        </Alert>
      </Box>
    );
  }

  if (isLoading || !stats) return <TPageSkeleton variant="dashboard" />;

  const branchName =
    filterBranch && branches.find((b) => b.branch_code === filterBranch)?.branch_name;

  return (
    <Box
      sx={(theme) => ({
        p: { xs: 1.5, md: 2.5 },
        height: "100%",
        overflow: "auto",
        background: theme.palette.mode === "dark"
          ? `linear-gradient(180deg, ${theme.palette.background.default} 0%, ${theme.palette.background.paper} 280px)`
          : "linear-gradient(180deg, #fff8ec 0%, #ffffff 280px)",
      })}
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
          <Typography variant="h5" fontWeight={700}>Purchasing Dashboard</Typography>
          {branchName && (
            <Typography variant="caption" color="text.secondary">{branchName}</Typography>
          )}
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Autocomplete
            size="small"
            options={branches}
            getOptionLabel={(o: BranchRef) => `${o.branch_code} — ${o.branch_name}`}
            value={branches.find((b) => b.branch_code === filterBranch) || null}
            onChange={(_, v) => setFilterBranch(v?.branch_code || null)}
            sx={{ minWidth: 220, bgcolor: "background.paper", borderRadius: 2 }}
            renderInput={(p) => <TextField {...p} placeholder="All Branches" size="small" />}
          />
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

      <Grid container spacing={2.25}>
        {/* ─── KPI Row ────────────────────────────────────────── */}
        <Grid item xs={12} sm={6} md={3}>
          <KpiSparkCard
            title="Month Spending"
            value={`Rs. ${fmtLKR(stats.current_month_po_value)}`}
            subtitle={`Last month: Rs. ${fmtLKR(stats.last_month_po_value)}`}
            icon={<TrendingUpIcon />}
            color="warning"
            trend={trends.value}
            trendLabel="vs last month"
            spark={valueSpark}
            onClick={() => navigate("/purchasing/orders")}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiSparkCard
            title="Purchase Orders"
            value={stats.current_month_pos.toLocaleString()}
            subtitle={`Total: ${stats.total_pos.toLocaleString()}`}
            icon={<ShoppingCartIcon />}
            color="primary"
            trend={trends.count}
            trendLabel="vs last month"
            spark={orderSpark}
            onClick={() => navigate("/purchasing/orders")}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiSparkCard
            title="Active Suppliers"
            value={stats.active_suppliers.toLocaleString()}
            subtitle={`${stats.total_suppliers} total`}
            icon={<BusinessIcon />}
            color="info"
            onClick={() => navigate("/purchasing/suppliers")}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiSparkCard
            title="Goods Received"
            value={stats.current_month_grns.toLocaleString()}
            subtitle={`Total GRNs: ${stats.total_grns.toLocaleString()}`}
            icon={<ReceiptLongIcon />}
            color="success"
            onClick={() => navigate("/purchasing/grn")}
          />
        </Grid>

        {/* ─── Monthly spending chart ─────────────────────────── */}
        <Grid item xs={12} lg={8}>
          <DashboardPanel title="Monthly Spending" subtitle="Last 6 months — order count overlaid">
            {stats.monthly_spending.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 6, color: "text.secondary" }}>
                <Typography>No spending data</Typography>
              </Box>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={stats.monthly_spending} margin={{ top: 10, right: 18, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.6)} />
                  <XAxis dataKey="month" fontSize={12} tick={{ fill: theme.palette.text.secondary }} />
                  <YAxis
                    yAxisId="val"
                    fontSize={12}
                    tick={{ fill: theme.palette.text.secondary }}
                    tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))}
                  />
                  <YAxis
                    yAxisId="cnt"
                    orientation="right"
                    fontSize={12}
                    tick={{ fill: theme.palette.text.secondary }}
                    allowDecimals={false}
                  />
                  <RechartsTooltip
                    formatter={(v: number | undefined, n: string | undefined) => {
                      const num = v ?? 0;
                      return n === "Spending"
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
                  <Bar
                    yAxisId="val"
                    dataKey="value"
                    name="Spending"
                    fill={theme.palette.warning.main}
                    radius={[6, 6, 0, 0]}
                  />
                  <Bar
                    yAxisId="cnt"
                    dataKey="orders"
                    name="Orders"
                    fill={alpha(theme.palette.primary.main, 0.55)}
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </DashboardPanel>
        </Grid>

        {/* ─── PO Status Donut ────────────────────────────────── */}
        <Grid item xs={12} lg={4}>
          <DashboardPanel title="PO Status" subtitle={`${stats.total_pos.toLocaleString()} orders`}>
            <BreakdownDonut
              data={statusSlices}
              centerLabel="Open"
              centerValue={(stats.pending_pos + stats.approved_pos).toLocaleString()}
              formatValue={(v) => v.toLocaleString()}
              height={200}
            />
            <Divider sx={{ my: 2 }} />
            <Stack direction="row" spacing={1.25} alignItems="center">
              <Avatar sx={{ bgcolor: alpha(theme.palette.error.main, 0.12), color: "error.main", width: 36, height: 36 }}>
                <AssignmentReturnIcon fontSize="small" />
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary">
                  Purchase Returns
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {stats.total_returns} total · {stats.pending_returns} pending
                </Typography>
              </Box>
              <Button
                size="small"
                onClick={() => navigate("/purchasing/returns")}
                sx={{ textTransform: "none" }}
              >
                View
              </Button>
            </Stack>
          </DashboardPanel>
        </Grid>

        {/* ─── Daily orders + Payment methods ─────────────────── */}
        <Grid item xs={12} lg={7}>
          <DashboardPanel title="Daily Order Volume" subtitle="Last 7 days">
            {stats.daily_orders.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 5, color: "text.secondary" }}>
                <Typography>No order data</Typography>
              </Box>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={stats.daily_orders} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.6)} />
                  <XAxis dataKey="date" fontSize={12} tick={{ fill: theme.palette.text.secondary }} />
                  <YAxis fontSize={12} tick={{ fill: theme.palette.text.secondary }} allowDecimals={false} />
                  <RechartsTooltip
                    formatter={(v: number | undefined) => [v ?? 0, "Orders"] as [number, string]}
                    contentStyle={{
                      borderRadius: 8,
                      border: `1px solid ${theme.palette.divider}`,
                      backgroundColor: theme.palette.background.paper,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="orders" radius={[6, 6, 0, 0]} fill={theme.palette.primary.main} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </DashboardPanel>
        </Grid>

        <Grid item xs={12} lg={5}>
          <DashboardPanel title="Payment Methods" subtitle="POs by tender">
            <BreakdownDonut
              data={paymentSlices}
              centerLabel="Total POs"
              centerValue={stats.total_pos.toLocaleString()}
              formatValue={(v) => `${v} PO${v !== 1 ? "s" : ""}`}
              height={220}
            />
          </DashboardPanel>
        </Grid>

        {/* ─── Top suppliers + Recent POs ─────────────────────── */}
        <Grid item xs={12} md={5}>
          <DashboardPanel
            title="Top Suppliers"
            subtitle="By PO value"
            action={
              <Button
                size="small"
                endIcon={<LaunchIcon />}
                onClick={() => navigate("/purchasing/suppliers")}
                sx={{ textTransform: "none" }}
              >
                View
              </Button>
            }
          >
            {stats.top_suppliers.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 4 }}>
                <BusinessIcon sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />
                <Typography variant="body2" color="text.secondary">
                  No supplier data
                </Typography>
              </Box>
            ) : (
              <List dense disablePadding>
                {stats.top_suppliers.map((s, idx) => (
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
                      primary={s.name}
                      secondary={`${s.orders} order${s.orders !== 1 ? "s" : ""}`}
                      primaryTypographyProps={{ variant: "body2", fontWeight: 600, noWrap: true }}
                      secondaryTypographyProps={{ variant: "caption" }}
                    />
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 700, color: "warning.dark", whiteSpace: "nowrap" }}
                    >
                      Rs. {fmtLKR(s.value)}
                    </Typography>
                  </ListItem>
                ))}
              </List>
            )}
          </DashboardPanel>
        </Grid>

        <Grid item xs={12} md={7}>
          <DashboardPanel
            title="Recent Purchase Orders"
            subtitle={`${stats.total_pos.toLocaleString()} total`}
            action={
              <Button
                size="small"
                endIcon={<LaunchIcon />}
                onClick={() => navigate("/purchasing/orders")}
                sx={{ textTransform: "none" }}
              >
                View All
              </Button>
            }
          >
            {stats.recent_pos.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 4 }}>
                <ShoppingCartIcon sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />
                <Typography variant="body2" color="text.secondary">
                  No purchase orders yet
                </Typography>
              </Box>
            ) : (
              <List dense disablePadding>
                {stats.recent_pos.map((po) => (
                  <ListItemButton
                    key={po.id}
                    divider
                    onClick={() => navigate("/purchasing/orders")}
                    sx={{ borderRadius: 1.5, mb: 0.25 }}
                  >
                    <ListItemText
                      primary={po.po_no}
                      secondary={`${po.supplier} · ${po.date ? format(new Date(po.date), "MMM dd, yyyy") : "—"}`}
                      primaryTypographyProps={{ variant: "body2", fontWeight: 600 }}
                      secondaryTypographyProps={{ variant: "caption" }}
                    />
                    <TStatusChip status={po.status} statusMap="purchaseOrder" size="small" />
                  </ListItemButton>
                ))}
              </List>
            )}
          </DashboardPanel>
        </Grid>

        {/* ─── Recent GRNs full width ─────────────────────────── */}
        <Grid item xs={12}>
          <DashboardPanel
            title="Recent Goods Received Notes"
            subtitle={`${stats.total_grns.toLocaleString()} GRNs total`}
            action={
              <Button
                size="small"
                endIcon={<LaunchIcon />}
                onClick={() => navigate("/purchasing/grn")}
                sx={{ textTransform: "none" }}
              >
                View All
              </Button>
            }
          >
            {stats.recent_grns.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 4 }}>
                <LocalShippingIcon sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />
                <Typography variant="body2" color="text.secondary">
                  No GRNs recorded yet
                </Typography>
              </Box>
            ) : (
              <Grid container spacing={2}>
                {stats.recent_grns.map((grn) => (
                  <Grid item xs={12} sm={6} md={4} lg={2.4} key={grn.id}>
                    <Box
                      onClick={() => navigate("/purchasing/grn")}
                      sx={{
                        cursor: "pointer",
                        p: 1.75,
                        borderRadius: 2,
                        border: "1px solid",
                        borderColor: "divider",
                        transition: "all .18s ease",
                        "&:hover": {
                          transform: "translateY(-2px)",
                          boxShadow: "0 10px 22px -12px rgba(15,23,42,0.25)",
                          borderColor: alpha(theme.palette.success.main, 0.4),
                        },
                      }}
                    >
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <Avatar
                          sx={{
                            bgcolor: alpha(theme.palette.success.main, 0.12),
                            color: "success.main",
                            width: 32,
                            height: 32,
                          }}
                        >
                          <LocalShippingIcon fontSize="small" />
                        </Avatar>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                            {grn.grn_no}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" noWrap>
                            PO #{grn.po_id}
                          </Typography>
                        </Box>
                      </Stack>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block", mt: 1 }}
                      >
                        {grn.date ? format(new Date(grn.date), "MMM dd, yyyy") : "—"}
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
