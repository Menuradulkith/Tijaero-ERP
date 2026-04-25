/**
 * KpiSparkCard - KPI card with inline sparkline trend.
 *
 * Modern dashboard pattern (NetSuite / Power BI / Stripe): show the
 * headline number alongside a tiny area-line chart that hints at recent
 * movement, plus a delta vs previous period.
 */

import { ReactNode } from "react";
import { Avatar, Box, Card, Stack, Typography, alpha, useTheme } from "@mui/material";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import TrendingFlatIcon from "@mui/icons-material/TrendingFlat";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

export interface KpiSparkCardProps {
  title: string;
  value: ReactNode;
  subtitle?: string;
  icon?: ReactNode;
  /** Mui theme color key */
  color?: "primary" | "success" | "warning" | "info" | "error" | "secondary";
  /** Trend percent vs previous period (e.g. 12.4 or -3.1) */
  trend?: number;
  trendLabel?: string;
  /** Series for the sparkline */
  spark?: Array<{ value: number }>;
  onClick?: () => void;
}

const PALETTE = {
  primary: { main: "#2563eb", soft: "rgba(37,99,235,0.12)" },
  success: { main: "#059669", soft: "rgba(5,150,105,0.12)" },
  warning: { main: "#d97706", soft: "rgba(217,119,6,0.12)" },
  info: { main: "#0284c7", soft: "rgba(2,132,199,0.12)" },
  error: { main: "#dc2626", soft: "rgba(220,38,38,0.12)" },
  secondary: { main: "#7c3aed", soft: "rgba(124,58,237,0.12)" },
};

export default function KpiSparkCard({
  title,
  value,
  subtitle,
  icon,
  color = "primary",
  trend,
  trendLabel,
  spark,
  onClick,
}: KpiSparkCardProps) {
  const theme = useTheme();
  const palette = PALETTE[color];
  const trendDir = trend === undefined ? "flat" : trend > 0.5 ? "up" : trend < -0.5 ? "down" : "flat";
  const trendColor =
    trendDir === "up" ? theme.palette.success.main : trendDir === "down" ? theme.palette.error.main : theme.palette.text.secondary;

  return (
    <Card
      elevation={0}
      onClick={onClick}
      sx={{
        p: 2.25,
        borderRadius: 3,
        border: "1px solid",
        borderColor: "divider",
        cursor: onClick ? "pointer" : "default",
        background: `linear-gradient(160deg, #ffffff 0%, ${alpha(palette.main, 0.04)} 100%)`,
        transition: "transform .18s ease, box-shadow .18s ease, border-color .18s ease",
        "&:hover": onClick
          ? {
              transform: "translateY(-2px)",
              boxShadow: "0 12px 28px -16px rgba(15,23,42,0.25)",
              borderColor: alpha(palette.main, 0.35),
            }
          : undefined,
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1.5}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: 0.4 }}>
            {title.toUpperCase()}
          </Typography>
          <Typography
            variant="h5"
            sx={{ fontWeight: 800, mt: 0.5, color: "text.primary", lineHeight: 1.15, wordBreak: "break-word" }}
          >
            {value}
          </Typography>
          {subtitle && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        {icon && (
          <Avatar
            variant="rounded"
            sx={{
              bgcolor: palette.soft,
              color: palette.main,
              width: 44,
              height: 44,
              borderRadius: 2,
            }}
          >
            {icon}
          </Avatar>
        )}
      </Stack>

      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 1.5 }}>
        {trend !== undefined ? (
          <Stack direction="row" spacing={0.5} alignItems="center">
            {trendDir === "up" && <TrendingUpIcon sx={{ fontSize: 16, color: trendColor }} />}
            {trendDir === "down" && <TrendingDownIcon sx={{ fontSize: 16, color: trendColor }} />}
            {trendDir === "flat" && <TrendingFlatIcon sx={{ fontSize: 16, color: trendColor }} />}
            <Typography variant="caption" sx={{ color: trendColor, fontWeight: 700 }}>
              {trend > 0 ? "+" : ""}
              {trend.toFixed(1)}%
            </Typography>
            {trendLabel && (
              <Typography variant="caption" color="text.secondary">
                {trendLabel}
              </Typography>
            )}
          </Stack>
        ) : (
          <Box />
        )}

        {spark && spark.length > 1 && (
          <Box sx={{ width: 92, height: 36 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={spark} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`spark-${color}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={palette.main} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={palette.main} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={palette.main}
                  strokeWidth={2}
                  fill={`url(#spark-${color})`}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </Box>
        )}
      </Stack>
    </Card>
  );
}
