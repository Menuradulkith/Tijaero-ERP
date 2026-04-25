/**
 * DashboardHero - Modern gradient hero banner used across module dashboards.
 *
 * Inspired by Odoo / Zoho / Dynamics 365 ERP dashboards: gradient strip with
 * greeting, contextual subtitle, period selector, optional branch filter,
 * refresh button, and a primary CTA. Designed to be consistent across the
 * Main, Sales, and Purchasing dashboards.
 */

import { ReactNode } from "react";
import {
  Autocomplete,
  Box,
  Chip,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";

export type DashboardPeriod = "today" | "week" | "month" | "quarter" | "year";

const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  today: "Today",
  week: "This Week",
  month: "This Month",
  quarter: "This Quarter",
  year: "This Year",
};

interface BranchOption {
  branch_code: string;
  branch_name: string;
}

interface DashboardHeroProps {
  /** Eyebrow label above the title (e.g. "Sales Module") */
  eyebrow?: string;
  /** Main title */
  title: string;
  /** Supporting copy under the title */
  subtitle?: string;
  /** Gradient accent — defaults to primary blue */
  accent?: "primary" | "success" | "warning" | "info" | "error" | "secondary";
  /** Optional period chips */
  period?: DashboardPeriod;
  onPeriodChange?: (period: DashboardPeriod) => void;
  periods?: DashboardPeriod[];
  /** Optional branch filter */
  branches?: BranchOption[];
  branchValue?: string | null;
  onBranchChange?: (branchCode: string | null) => void;
  /** Refresh handler */
  onRefresh?: () => void;
  isRefreshing?: boolean;
  /** Primary CTA — typically "+ New …" */
  primaryAction?: ReactNode;
  /** Extra slot to the right (chips, links) */
  extra?: ReactNode;
}

const ACCENT_GRADIENTS: Record<NonNullable<DashboardHeroProps["accent"]>, string> = {
  primary: "linear-gradient(120deg, #1e40af 0%, #2563eb 45%, #3b82f6 100%)",
  success: "linear-gradient(120deg, #047857 0%, #059669 45%, #10b981 100%)",
  warning: "linear-gradient(120deg, #b45309 0%, #d97706 45%, #f59e0b 100%)",
  info: "linear-gradient(120deg, #0369a1 0%, #0284c7 45%, #0ea5e9 100%)",
  error: "linear-gradient(120deg, #991b1b 0%, #dc2626 45%, #ef4444 100%)",
  secondary: "linear-gradient(120deg, #5b21b6 0%, #7c3aed 45%, #8b5cf6 100%)",
};

export default function DashboardHero({
  eyebrow,
  title,
  subtitle,
  accent = "primary",
  period,
  onPeriodChange,
  periods = ["today", "week", "month", "quarter", "year"],
  branches,
  branchValue,
  onBranchChange,
  onRefresh,
  isRefreshing,
  primaryAction,
  extra,
}: DashboardHeroProps) {
  const theme = useTheme();

  return (
    <Box
      sx={{
        position: "relative",
        borderRadius: 3,
        p: { xs: 2.25, md: 3 },
        mb: 2.5,
        color: "#fff",
        background: ACCENT_GRADIENTS[accent],
        boxShadow: "0 14px 40px -18px rgba(15,23,42,0.55)",
        overflow: "hidden",
      }}
    >
      {/* decorative blobs */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          top: -60,
          right: -60,
          width: 240,
          height: 240,
          borderRadius: "50%",
          background: alpha("#ffffff", 0.12),
          filter: "blur(8px)",
        }}
      />
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          bottom: -90,
          left: "30%",
          width: 320,
          height: 320,
          borderRadius: "50%",
          background: alpha("#ffffff", 0.06),
          filter: "blur(20px)",
        }}
      />

      <Stack
        direction={{ xs: "column", lg: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", lg: "center" }}
        spacing={2}
        sx={{ position: "relative", zIndex: 1 }}
      >
        {/* Left: titles */}
        <Box sx={{ minWidth: 0, flex: 1 }}>
          {eyebrow && (
            <Typography
              variant="overline"
              sx={{
                color: alpha("#ffffff", 0.85),
                letterSpacing: 1.4,
                fontWeight: 700,
                lineHeight: 1.2,
              }}
            >
              {eyebrow}
            </Typography>
          )}
          <Typography
            variant="h4"
            sx={{
              fontWeight: 800,
              letterSpacing: -0.4,
              lineHeight: 1.15,
              fontSize: { xs: "1.55rem", md: "1.85rem" },
            }}
          >
            {title}
          </Typography>
          {subtitle && (
            <Typography
              variant="body2"
              sx={{
                color: alpha("#ffffff", 0.88),
                mt: 0.5,
                maxWidth: 720,
              }}
            >
              {subtitle}
            </Typography>
          )}
        </Box>

        {/* Right: filters + actions */}
        <Stack
          direction={{ xs: "column", sm: "row" }}
          alignItems={{ xs: "stretch", sm: "center" }}
          spacing={1.25}
          sx={{ flexShrink: 0 }}
        >
          {branches && (
            <Autocomplete
              size="small"
              options={branches}
              getOptionLabel={(o) => `${o.branch_code} — ${o.branch_name}`}
              value={branches.find((b) => b.branch_code === branchValue) || null}
              onChange={(_, v) => onBranchChange?.(v?.branch_code || null)}
              sx={{
                minWidth: 240,
                bgcolor: alpha("#ffffff", 0.95),
                borderRadius: 2,
                "& .MuiOutlinedInput-root": { borderRadius: 2 },
              }}
              renderInput={(p) => (
                <TextField {...p} placeholder="All Branches" size="small" />
              )}
            />
          )}
          {extra}
          {primaryAction}
          {onRefresh && (
            <Tooltip title="Refresh">
              <IconButton
                onClick={onRefresh}
                disabled={isRefreshing}
                sx={{
                  bgcolor: alpha("#ffffff", 0.18),
                  color: "#fff",
                  borderRadius: 2,
                  "&:hover": { bgcolor: alpha("#ffffff", 0.3) },
                }}
              >
                <RefreshIcon
                  sx={{
                    animation: isRefreshing ? "spin 1s linear infinite" : "none",
                    "@keyframes spin": {
                      "0%": { transform: "rotate(0deg)" },
                      "100%": { transform: "rotate(360deg)" },
                    },
                  }}
                />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      </Stack>

      {/* Period chips */}
      {period && onPeriodChange && (
        <Stack
          direction="row"
          spacing={1}
          sx={{ mt: 2, position: "relative", zIndex: 1, flexWrap: "wrap", rowGap: 1 }}
        >
          {periods.map((p) => {
            const active = period === p;
            return (
              <Chip
                key={p}
                label={PERIOD_LABELS[p]}
                onClick={() => onPeriodChange(p)}
                sx={{
                  fontWeight: 600,
                  borderRadius: 2,
                  height: 30,
                  color: active ? theme.palette.text.primary : "#fff",
                  bgcolor: active ? "#fff" : alpha("#ffffff", 0.15),
                  border: `1px solid ${alpha("#ffffff", active ? 0 : 0.35)}`,
                  "&:hover": {
                    bgcolor: active ? "#fff" : alpha("#ffffff", 0.28),
                  },
                }}
              />
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
