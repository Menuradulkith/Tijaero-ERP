/**
 * Enhanced Purchasing Dashboard
 *
 * Uses `/purchasing/statistics` backend endpoint with SQL aggregations.
 * Features: KPI cards, 7-day order trend, monthly spending bar chart,
 * PO status breakdown, top suppliers, payment methods, recent POs & GRNs.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Avatar,
  Box,
  Card,
  Chip,
  Divider,
  Grid,
  LinearProgress,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Autocomplete,
  TextField,
  Typography,
  useTheme,
  Alert,
  Button,
  IconButton,
  Tooltip,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import BusinessIcon from "@mui/icons-material/Business";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import CancelIcon from "@mui/icons-material/Cancel";
import DoneAllIcon from "@mui/icons-material/DoneAll";
import RefreshIcon from "@mui/icons-material/Refresh";

import { purchasingStatsApi } from "@/modules/purchasing/api";
import { useReferenceData, BranchRef } from "@/hooks";
import { fmtLKR, TStatCard, TPageHeader, TPageSkeleton, TStatusChip } from "@/components/tijaero";
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

const panelSx = {
  p: 2.25,
  borderRadius: 3,
  border: "1px solid",
  borderColor: "divider",
  background: "linear-gradient(180deg, #ffffff 0%, #fbfcff 100%)",
  boxShadow: "0 2px 14px rgba(15, 23, 42, 0.05)",
} as const;

const sectionTitleSx = {
  fontWeight: 700,
  letterSpacing: 0.2,
} as const;

export default function PurchasingDashboard() {
  const navigate = useNavigate();
  const theme = useTheme();
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  const { filteredBranches, defaultBranchCode } = useReferenceData(["branches"]);
  const branches = filteredBranches || [];

  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  const { data: stats, isLoading, isError, refetch } = useQuery({
    queryKey: ["purchasing-statistics", filterBranch],
    queryFn: () => purchasingStatsApi.getStatistics(filterBranch || undefined),
    enabled: branchResolved,
    placeholderData: (prev) => prev,
  });

  const trends = useMemo(() => {
    if (!stats) return { poValue: 0, poCount: 0 };
    const poValueTrend = stats.last_month_po_value > 0
      ? ((stats.current_month_po_value - stats.last_month_po_value) / stats.last_month_po_value) * 100
      : 0;
    const poCountTrend = stats.last_month_pos > 0
      ? ((stats.current_month_pos - stats.last_month_pos) / stats.last_month_pos) * 100
      : 0;
    return { poValue: poValueTrend, poCount: poCountTrend };
  }, [stats]);

  if (isError) {
    return (
      <Box sx={{ p: 3 }}>
        <TPageHeader title="Purchasing Dashboard" subtitle="Overview of purchasing activities" />
        <Alert
          severity="error"
          action={<Button color="inherit" size="small" onClick={() => refetch()}>Retry</Button>}
          sx={{ mt: 2 }}
        >
          Failed to load purchasing statistics. Please try again.
        </Alert>
      </Box>
    );
  }

  if (isLoading || !stats) {
    return <TPageSkeleton variant="dashboard" />;
  }

  const totalPOStatuses = stats.pending_pos + stats.approved_pos + stats.completed_pos + stats.rejected_pos;

  return (
    <Box
      sx={{
        p: { xs: 1.5, md: 2.5 },
        height: "100%",
        overflow: "auto",
        borderRadius: 2,
        background: "radial-gradient(circle at 10% 0%, #f3f7ff 0%, #f8fafc 35%, #ffffff 100%)",
      }}
    >
      <TPageHeader
        title="Purchasing Dashboard"
        subtitle={
          filterBranch
            ? `Overview of purchasing activities — ${branches.find((b) => b.branch_code === filterBranch)?.branch_name || filterBranch}`
            : "Overview of purchasing activities and spending"
        }
        actions={
          <Stack direction="row" spacing={1.25} alignItems="center">
            <Autocomplete
              size="small"
              options={branches}
              getOptionLabel={(option: BranchRef) => `${option.branch_code} - ${option.branch_name}`}
              value={branches.find((b) => b.branch_code === filterBranch) || null}
              onChange={(_, newValue) => setFilterBranch(newValue?.branch_code || null)}
              renderInput={(params) => (
                <TextField {...params} placeholder="Filter by Branch" size="small" />
              )}
              sx={{ minWidth: 260, backgroundColor: "#fff", borderRadius: 2 }}
            />
            <Tooltip title="Refresh Statistics">
              <IconButton
                onClick={() => refetch()}
                color="primary"
                sx={{
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 2,
                  backgroundColor: "#fff",
                }}
              >
                <RefreshIcon />
              </IconButton>
            </Tooltip>
          </Stack>
        }
      />

      {/* ── Row 1: KPI Stat Cards ─────────────────────────────────── */}
      <Grid container spacing={2.5}>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="This Month Spending"
            value={`Rs. ${fmtLKR(stats.current_month_po_value)}`}
            subtitle={`Last month: Rs. ${fmtLKR(stats.last_month_po_value)}`}
            icon={<TrendingUpIcon />}
            color="primary"
            trend={trends.poValue}
            trendLabel="vs last month"
            onClick={() => navigate("/purchasing/orders")}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Purchase Orders"
            value={stats.current_month_pos}
            subtitle={`Last month: ${stats.last_month_pos} | Total: ${stats.total_pos}`}
            icon={<ShoppingCartIcon />}
            color="warning"
            trend={trends.poCount}
            trendLabel="vs last month"
            onClick={() => navigate("/purchasing/orders")}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Active Suppliers"
            value={stats.active_suppliers}
            subtitle={`Total: ${stats.total_suppliers}`}
            icon={<BusinessIcon />}
            color="info"
            onClick={() => navigate("/purchasing/suppliers")}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Goods Received"
            value={stats.current_month_grns}
            subtitle={`Total GRNs: ${stats.total_grns}`}
            icon={<ReceiptLongIcon />}
            color="success"
            onClick={() => navigate("/purchasing/grn")}
          />
        </Grid>

        {/* ── Row 2: Daily Order Trend + PO Status Breakdown ──────── */}
        <Grid item xs={12} md={8}>
          <Paper elevation={0} variant="outlined" sx={{ ...panelSx, height: "100%" }}>
            <Typography variant="h6" sx={sectionTitleSx} gutterBottom>
              Purchase Orders — Last 7 Days
            </Typography>
            <Divider sx={{ mb: 2 }} />
            {stats.daily_orders.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 6, color: "text.secondary" }}>
                <ShoppingCartIcon sx={{ fontSize: 48, mb: 1, opacity: 0.3 }} />
                <Typography>No order data available</Typography>
              </Box>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={stats.daily_orders}>
                  <defs>
                    <linearGradient id="poGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={theme.palette.warning.main} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={theme.palette.warning.main} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.8)} />
                  <XAxis dataKey="date" fontSize={12} tick={{ fill: theme.palette.text.secondary }} />
                  <YAxis fontSize={12} tick={{ fill: theme.palette.text.secondary }} allowDecimals={false} />
                  <RechartsTooltip
                    formatter={(value: number | undefined) => [value, "Orders"] as [number | undefined, string]}
                    contentStyle={{
                      borderRadius: 8,
                      border: `1px solid ${theme.palette.divider}`,
                      backgroundColor: theme.palette.background.paper,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="orders"
                    stroke={theme.palette.warning.main}
                    fill="url(#poGrad)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={4}>
          <Stack spacing={3} sx={{ height: "100%" }}>
            {/* PO Status Breakdown */}
            <Paper elevation={0} variant="outlined" sx={{ ...panelSx, flex: 1 }}>
              <Typography variant="h6" sx={sectionTitleSx} gutterBottom>
                PO Status
              </Typography>
              <Divider sx={{ mb: 2 }} />
              {[
                { label: "Pending / Draft", count: stats.pending_pos, color: "warning", icon: <HourglassEmptyIcon sx={{ fontSize: 16 }} /> },
                { label: "Approved", count: stats.approved_pos, color: "success", icon: <CheckCircleIcon sx={{ fontSize: 16 }} /> },
                { label: "Completed", count: stats.completed_pos, color: "info", icon: <DoneAllIcon sx={{ fontSize: 16 }} /> },
                { label: "Rejected", count: stats.rejected_pos, color: "error", icon: <CancelIcon sx={{ fontSize: 16 }} /> },
              ].map(({ label, count, color }) => {
                const pct = totalPOStatuses > 0 ? (count / totalPOStatuses) * 100 : 0;
                return (
                  <Box key={label} sx={{ mb: 1.5 }}>
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                      <Typography variant="body2" color="text.secondary">{label}</Typography>
                      <Typography variant="body2" fontWeight={600}>{count}</Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={pct}
                      color={color as "warning" | "success" | "info" | "error"}
                      sx={{ height: 8, borderRadius: 1 }}
                    />
                  </Box>
                );
              })}
            </Paper>

            {/* Returns Quick Stat */}
            <Paper elevation={0} variant="outlined" sx={panelSx}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="body2" color="text.secondary">Purchase Returns</Typography>
                  <Typography variant="h4" fontWeight={700} color="error.main">{stats.total_returns}</Typography>
                  <Typography variant="caption" color="text.secondary">{stats.pending_returns} pending</Typography>
                </Box>
                <Avatar sx={{ bgcolor: "error.light", width: 48, height: 48 }}>
                  <AssignmentReturnIcon sx={{ color: "error.dark" }} />
                </Avatar>
              </Stack>
            </Paper>
          </Stack>
        </Grid>

        {/* ── Row 3: Monthly Spending Chart + Top Suppliers ────────── */}
        <Grid item xs={12} md={7}>
          <Paper elevation={0} variant="outlined" sx={{ ...panelSx, height: "100%" }}>
            <Typography variant="h6" sx={sectionTitleSx} gutterBottom>
              Monthly Spending — Last 6 Months
            </Typography>
            <Divider sx={{ mb: 2 }} />
            {stats.monthly_spending.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 6, color: "text.secondary" }}>
                <Typography>No spending data</Typography>
              </Box>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={stats.monthly_spending}>
                  <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.8)} />
                  <XAxis dataKey="month" fontSize={12} tick={{ fill: theme.palette.text.secondary }} />
                  <YAxis
                    fontSize={12}
                    tick={{ fill: theme.palette.text.secondary }}
                    tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)}
                  />
                  <RechartsTooltip
                    formatter={(value: number | undefined, name: string | undefined) => [
                      name === "value" ? `Rs. ${fmtLKR(value ?? 0)}` : value,
                      name === "value" ? "Spending" : "Orders",
                    ] as [string | number | undefined, string]}
                    contentStyle={{
                      borderRadius: 8,
                      border: `1px solid ${theme.palette.divider}`,
                      backgroundColor: theme.palette.background.paper,
                    }}
                  />
                  <Bar dataKey="value" fill={theme.palette.primary.main} radius={[4, 4, 0, 0]} name="value" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={5}>
          <Paper elevation={0} variant="outlined" sx={{ ...panelSx, height: "100%" }}>
            <Typography variant="h6" sx={sectionTitleSx} gutterBottom>
              Top Suppliers
            </Typography>
            <Divider sx={{ mb: 1 }} />
            {stats.top_suppliers.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 4 }}>
                <BusinessIcon sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />
                <Typography variant="body2" color="text.secondary">No supplier data</Typography>
              </Box>
            ) : (
              <List dense disablePadding>
                {stats.top_suppliers.map((supplier, idx) => (
                  <ListItem key={idx} disablePadding sx={{ py: 0.75 }}>
                    <ListItemAvatar sx={{ minWidth: 40 }}>
                      <Avatar
                        sx={{
                          width: 32,
                          height: 32,
                          fontSize: 14,
                          fontWeight: 700,
                          bgcolor: idx === 0 ? "warning.main" : idx === 1 ? "grey.400" : idx === 2 ? "#CD7F32" : "grey.200",
                          color: idx < 3 ? "white" : "text.primary",
                        }}
                      >
                        {idx + 1}
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={supplier.name}
                      secondary={`${supplier.orders} order${supplier.orders !== 1 ? "s" : ""}`}
                      primaryTypographyProps={{ variant: "body2", fontWeight: 500, noWrap: true }}
                      secondaryTypographyProps={{ variant: "caption" }}
                    />
                    <Typography variant="body2" fontWeight={600} color="primary.main" sx={{ whiteSpace: "nowrap" }}>
                      Rs. {fmtLKR(supplier.value)}
                    </Typography>
                  </ListItem>
                ))}
              </List>
            )}
          </Paper>
        </Grid>

        {/* ── Row 4: Recent POs + Recent GRNs ─────────────────────── */}
        <Grid item xs={12} md={6}>
          <Paper elevation={0} variant="outlined" sx={{ ...panelSx, height: "100%" }}>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
              <Typography variant="h6" sx={sectionTitleSx}>
                Recent Purchase Orders
              </Typography>
              <Chip label={`${stats.total_pos} total`} size="small" color="warning" variant="outlined" />
            </Box>
            <Divider sx={{ mb: 1 }} />
            {stats.recent_pos.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 4 }}>
                <ShoppingCartIcon sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />
                <Typography variant="body2" color="text.secondary">No purchase orders yet</Typography>
              </Box>
            ) : (
              <List dense disablePadding>
                {stats.recent_pos.map((po) => (
                  <ListItemButton
                    key={po.id}
                    divider
                    onClick={() => navigate("/purchasing/orders")}
                    sx={{
                      borderRadius: 1.5,
                      mb: 0.35,
                      '&:hover': { backgroundColor: alpha(theme.palette.warning.main, 0.08) },
                    }}
                  >
                    <ListItemText
                      primary={po.po_no}
                      secondary={`${po.supplier} • ${po.date ? new Date(po.date).toLocaleDateString() : "—"}`}
                      primaryTypographyProps={{ variant: "body2", fontWeight: 500 }}
                      secondaryTypographyProps={{ variant: "caption" }}
                    />
                    <TStatusChip
                      status={po.status}
                      statusMap="purchaseOrder"
                      size="small"
                    />
                  </ListItemButton>
                ))}
              </List>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper elevation={0} variant="outlined" sx={{ ...panelSx, height: "100%" }}>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
              <Typography variant="h6" sx={sectionTitleSx}>
                Recent Good Received Notes
              </Typography>
              <Chip label={`${stats.total_grns} total`} size="small" color="info" variant="outlined" />
            </Box>
            <Divider sx={{ mb: 1 }} />
            {stats.recent_grns.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 4 }}>
                <ReceiptLongIcon sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />
                <Typography variant="body2" color="text.secondary">No GRNs yet</Typography>
              </Box>
            ) : (
              <List dense disablePadding>
                {stats.recent_grns.map((grn) => (
                  <ListItemButton
                    key={grn.id}
                    divider
                    onClick={() => navigate("/purchasing/grn")}
                    sx={{
                      borderRadius: 1.5,
                      mb: 0.35,
                      '&:hover': { backgroundColor: alpha(theme.palette.info.main, 0.08) },
                    }}
                  >
                    <ListItemText
                      primary={grn.grn_no}
                      secondary={`PO #${grn.po_id} • ${grn.date ? new Date(grn.date).toLocaleDateString() : "—"}`}
                      primaryTypographyProps={{ variant: "body2", fontWeight: 500 }}
                      secondaryTypographyProps={{ variant: "caption" }}
                    />
                    <Chip label="Received" size="small" color="success" variant="outlined" />
                  </ListItemButton>
                ))}
              </List>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
