/**
 * Manufacturing Dashboard.
 *
 * Shop-floor KPIs in the shape of Odoo MRP / ERPNext Manufacturing / Business Central:
 * - Open and late production orders, WIP value, output this month, scrap rate, shortages
 * - Monthly output chart (good vs scrap) and order status donut
 * - Work-center load (open planned time vs daily capacity)
 * - Late orders and upcoming orders
 *
 * All data sourced from `/manufacturing/dashboard`.
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
  Grid,
  IconButton,
  LinearProgress,
  List,
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
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import AssignmentIcon from "@mui/icons-material/Assignment";
import FactoryIcon from "@mui/icons-material/Factory";
import LaunchIcon from "@mui/icons-material/Launch";
import PlaylistAddCheckIcon from "@mui/icons-material/PlaylistAddCheck";
import PrecisionManufacturingIcon from "@mui/icons-material/PrecisionManufacturing";
import RefreshIcon from "@mui/icons-material/Refresh";
import ScheduleIcon from "@mui/icons-material/Schedule";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

import { BreakdownDonut, DashboardPanel, KpiSparkCard, type BreakdownSlice } from "@/components/dashboard";
import { fmtLKR, TPageSkeleton, TStatusChip } from "@/components/tijaero";
import { useReferenceData, BranchRef } from "@/hooks";
import { planningApi } from "@/modules/manufacturing/api";
import type { ProductionOrder } from "@/modules/manufacturing/types";
import { useCurrencyStore } from "@/state/currencyStore";

const STATUS_COLORS: Record<string, string> = {
  draft: "#94a3b8",
  released: "#0284c7",
  in_progress: "#2563eb",
  completed: "#059669",
  closed: "#7c3aed",
  cancelled: "#dc2626",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  released: "Released",
  in_progress: "In Progress",
  completed: "Completed",
  closed: "Closed",
  cancelled: "Cancelled",
};

const orderLink = (id: number) => `/manufacturing/orders?order=${id}`;

export default function ManufacturingDashboard() {
  const navigate = useNavigate();
  const theme = useTheme();
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  const { filteredBranches, defaultBranchCode } = useReferenceData(["branches"]);
  const branches = (filteredBranches as BranchRef[]) || [];

  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) setFilterBranch(defaultBranchCode);
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  const { data: stats, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["manufacturing-dashboard", filterBranch],
    queryFn: () => planningApi.getDashboard(filterBranch || undefined),
    enabled: branchResolved,
    placeholderData: (prev) => prev,
  });

  const outputSpark = useMemo(
    () => stats?.monthly_output?.map((m) => ({ value: m.quantity })) ?? [],
    [stats],
  );

  const chartData = useMemo(
    () =>
      stats?.monthly_output?.map((m) => ({
        month: format(new Date(`${m.month}-01T00:00:00`), "MMM yy"),
        good: m.quantity,
        scrap: m.scrap_quantity,
      })) ?? [],
    [stats],
  );

  const statusSlices = useMemo<BreakdownSlice[]>(() => {
    if (!stats) return [];
    return stats.status_counts
      .filter((s) => s.count > 0)
      .map((s) => ({ label: STATUS_LABELS[s.status] || s.status, value: s.count, color: STATUS_COLORS[s.status] || "#64748b" }));
  }, [stats]);

  if (isError) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h5" fontWeight={700} sx={{ mb: 2 }}>Manufacturing Dashboard</Typography>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => refetch()}>
              Retry
            </Button>
          }
        >
          Failed to load manufacturing statistics.
        </Alert>
      </Box>
    );
  }

  if (isLoading || !stats) return <TPageSkeleton variant="dashboard" />;

  const branchName = filterBranch && branches.find((b) => b.branch_code === filterBranch)?.branch_name;
  const variance = Number(stats.variance_this_month);

  const orderList = (orders: ProductionOrder[], empty: string) =>
    orders.length === 0 ? (
      <Box sx={{ textAlign: "center", py: 4 }}>
        <AssignmentIcon sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />
        <Typography variant="body2" color="text.secondary">{empty}</Typography>
      </Box>
    ) : (
      <List dense disablePadding>
        {orders.map((o) => (
          <ListItemButton key={o.id} divider onClick={() => navigate(orderLink(o.id))} sx={{ borderRadius: 1.5, mb: 0.25 }}>
            <ListItemText
              primary={`${o.order_no} · ${o.product_name || ""}`}
              secondary={`${o.produced_quantity}/${o.planned_quantity} ${o.unit_of_measure || ""} · due ${
                o.planned_end_date ? format(new Date(o.planned_end_date), "MMM dd, yyyy") : "—"
              }`}
              primaryTypographyProps={{ variant: "body2", fontWeight: 600, noWrap: true }}
              secondaryTypographyProps={{ variant: "caption" }}
            />
            <TStatusChip status={o.status} statusMap="productionOrder" size="small" />
          </ListItemButton>
        ))}
      </List>
    );

  return (
    <Box
      sx={(theme) => ({
        p: { xs: 1.5, md: 2.5 },
        height: "100%",
        overflow: "auto",
        background: theme.palette.mode === "dark"
          ? `linear-gradient(180deg, ${theme.palette.background.default} 0%, ${theme.palette.background.paper} 280px)`
          : "linear-gradient(180deg, #eef4ff 0%, #ffffff 280px)",
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
          <Typography variant="h5" fontWeight={700}>Manufacturing Dashboard</Typography>
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
            title="Open Orders"
            value={stats.open_orders.toLocaleString()}
            subtitle={`${stats.late_orders} late`}
            icon={<AssignmentIcon />}
            color={stats.late_orders > 0 ? "warning" : "primary"}
            onClick={() => navigate("/manufacturing/orders")}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiSparkCard
            title="Output This Month"
            value={stats.output_this_month.toLocaleString()}
            subtitle={`${currencySymbol} ${fmtLKR(Number(stats.output_value_this_month))} at standard cost`}
            icon={<PrecisionManufacturingIcon />}
            color="success"
            spark={outputSpark}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiSparkCard
            title="Work in Progress"
            value={`${currencySymbol} ${fmtLKR(Number(stats.wip_value))}`}
            subtitle={`Variance this month: ${variance > 0 ? "+" : ""}${fmtLKR(variance)}`}
            icon={<FactoryIcon />}
            color="info"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiSparkCard
            title="Material Shortages"
            value={stats.material_shortages.toLocaleString()}
            subtitle={`Scrap rate (6 months): ${Number(stats.scrap_rate_pct)}%`}
            icon={<PlaylistAddCheckIcon />}
            color={stats.material_shortages > 0 ? "error" : "secondary"}
            onClick={() => navigate("/manufacturing/mrp")}
          />
        </Grid>

        {/* ─── Monthly output chart ───────────────────────────── */}
        <Grid item xs={12} lg={8}>
          <DashboardPanel title="Monthly Output" subtitle="Good units and scrap — last 6 months">
            {chartData.every((d) => d.good === 0 && d.scrap === 0) ? (
              <Box sx={{ textAlign: "center", py: 6, color: "text.secondary" }}>
                <Typography>No output recorded yet</Typography>
              </Box>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 10, right: 18, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.6)} />
                  <XAxis dataKey="month" fontSize={12} tick={{ fill: theme.palette.text.secondary }} />
                  <YAxis fontSize={12} tick={{ fill: theme.palette.text.secondary }} allowDecimals={false} />
                  <RechartsTooltip
                    contentStyle={{
                      borderRadius: 8,
                      border: `1px solid ${theme.palette.divider}`,
                      backgroundColor: theme.palette.background.paper,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="good" name="Good" stackId="out" fill={theme.palette.success.main} />
                  <Bar dataKey="scrap" name="Scrap" stackId="out" fill={theme.palette.error.light} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </DashboardPanel>
        </Grid>

        {/* ─── Order Status Donut ─────────────────────────────── */}
        <Grid item xs={12} lg={4}>
          <DashboardPanel title="Order Status" subtitle={`${stats.active_boms} active BOMs · ${stats.active_work_centers} work centers`}>
            <BreakdownDonut
              data={statusSlices}
              centerLabel="Open"
              centerValue={stats.open_orders.toLocaleString()}
              formatValue={(v) => v.toLocaleString()}
              height={240}
            />
          </DashboardPanel>
        </Grid>

        {/* ─── Work center load ───────────────────────────────── */}
        <Grid item xs={12} lg={5}>
          <DashboardPanel
            title="Work Center Load"
            subtitle="Open planned time in days of capacity"
            action={
              <Button size="small" endIcon={<LaunchIcon />} onClick={() => navigate("/manufacturing/job-cards")}
                sx={{ textTransform: "none" }}>
                Job Cards
              </Button>
            }
          >
            {stats.work_center_load.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 4 }}>
                <FactoryIcon sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />
                <Typography variant="body2" color="text.secondary">No active work centers</Typography>
              </Box>
            ) : (
              <Stack spacing={1.5}>
                {stats.work_center_load.map((wc) => {
                  const days = Number(wc.load_days);
                  // a week of work fills the bar
                  const pct = Math.min((days / 5) * 100, 100);
                  const color = days > 5 ? "error" : days > 2 ? "warning" : "success";
                  return (
                    <Box key={wc.work_center_id}>
                      <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                        <Typography variant="body2" fontWeight={600} noWrap>
                          {wc.code} · {wc.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {(Number(wc.open_load_minutes) / 60).toFixed(1)} h · {days.toFixed(1)} d · {wc.open_operations} ops
                        </Typography>
                      </Stack>
                      <LinearProgress variant="determinate" value={pct} color={color}
                        sx={{ height: 8, borderRadius: 4, mt: 0.5 }} />
                    </Box>
                  );
                })}
              </Stack>
            )}
          </DashboardPanel>
        </Grid>

        {/* ─── Late + upcoming orders ─────────────────────────── */}
        <Grid item xs={12} md={6} lg={3.5}>
          <DashboardPanel
            title="Late Orders"
            subtitle="Past their planned end date"
            action={
              stats.late_orders > 0 ? (
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: "error.main" }}>
                  <WarningAmberIcon fontSize="small" />
                  <Typography variant="caption" fontWeight={700}>{stats.late_orders}</Typography>
                </Stack>
              ) : undefined
            }
          >
            {orderList(stats.late_order_list, "Nothing is running late")}
          </DashboardPanel>
        </Grid>
        <Grid item xs={12} md={6} lg={3.5}>
          <DashboardPanel
            title="Upcoming Orders"
            subtitle="Open orders by planned start"
            action={
              <Button size="small" endIcon={<ScheduleIcon />} onClick={() => navigate("/manufacturing/orders")}
                sx={{ textTransform: "none" }}>
                View All
              </Button>
            }
          >
            {orderList(stats.upcoming_orders, "No open production orders")}
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
