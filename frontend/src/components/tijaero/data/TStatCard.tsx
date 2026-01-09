/**
 * TStatCard - Standardized statistics card component
 * 
 * Used for dashboard statistics and KPI displays.
 * 
 * @example
 * ```tsx
 * <TStatCard
 *   title="Total Orders"
 *   value={1234}
 *   icon={<ShoppingCartIcon />}
 *   color="primary"
 *   trend={{ value: 12, direction: "up" }}
 * />
 * ```
 */

import React from "react";
import {
  Card,
  CardContent,
  Box,
  Typography,
  Skeleton,
  CardActionArea,
} from "@mui/material";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import TrendingFlatIcon from "@mui/icons-material/TrendingFlat";

export interface TStatCardProps {
  /** Card title */
  title: string;
  /** Main value to display */
  value: string | number;
  /** Optional subtitle */
  subtitle?: string;
  /** Icon to display */
  icon?: React.ReactNode;
  /** Theme color */
  color?: "primary" | "secondary" | "success" | "error" | "warning" | "info";
  /** Trend indicator - can be a number (percentage) or object with details */
  trend?: number | {
    value: number;
    direction?: "up" | "down" | "flat";
    label?: string;
  };
  /** Trend label - alternative to trend.label (for backward compatibility) */
  trendLabel?: string;
  /** Loading state */
  loading?: boolean;
  /** Click handler */
  onClick?: () => void;
  /** Format value as currency */
  isCurrency?: boolean;
  /** Custom format - alternative to isCurrency */
  format?: "currency" | "number" | "percent";
  /** Custom value formatter */
  formatValue?: (value: string | number) => string;
  /** Tooltip text */
  tooltip?: string;
  /** Badge count (e.g., for alerts) */
  badge?: number;
}

// Color palette for cards
const colorPalette: Record<string, { main: string; light: string }> = {
  primary: { main: "#1976d2", light: "#e3f2fd" },
  secondary: { main: "#9c27b0", light: "#f3e5f5" },
  success: { main: "#2e7d32", light: "#e8f5e9" },
  error: { main: "#d32f2f", light: "#ffebee" },
  warning: { main: "#ed6c02", light: "#fff3e0" },
  info: { main: "#0288d1", light: "#e1f5fe" },
};

// Format large numbers
const formatNumber = (value: string | number, isCurrency = false): string => {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return String(value);

  if (isCurrency) {
    return `Rs. ${new Intl.NumberFormat("en-LK", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(num)}`;
  }

  // Format with K, M, B suffixes for large numbers
  if (num >= 1000000000) {
    return `${(num / 1000000000).toFixed(1)}B`;
  }
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toLocaleString();
};

// Get trend icon
const getTrendIcon = (direction?: "up" | "down" | "flat") => {
  switch (direction) {
    case "up":
      return <TrendingUpIcon fontSize="small" />;
    case "down":
      return <TrendingDownIcon fontSize="small" />;
    default:
      return <TrendingFlatIcon fontSize="small" />;
  }
};

// Get trend color
const getTrendColor = (direction?: "up" | "down" | "flat"): string => {
  switch (direction) {
    case "up":
      return "success.main";
    case "down":
      return "error.main";
    default:
      return "text.secondary";
  }
};

export const TStatCard: React.FC<TStatCardProps> = ({
  title,
  value,
  subtitle,
  icon,
  color = "primary",
  trend,
  trendLabel,
  loading = false,
  onClick,
  isCurrency = false,
  format,
  formatValue: customFormatter,
}) => {
  const colors = colorPalette[color] || colorPalette.primary;
  const shouldFormatAsCurrency = isCurrency || format === "currency";
  const formattedValue = customFormatter
    ? customFormatter(value)
    : formatNumber(value, shouldFormatAsCurrency);

  // Normalize trend - support both number and object format
  const normalizedTrend = typeof trend === "number"
    ? { value: trend, direction: trend > 0 ? "up" as const : trend < 0 ? "down" as const : "flat" as const, label: trendLabel }
    : trend ? { ...trend, label: trend.label || trendLabel } : undefined;

  // Determine trend direction from value if not specified
  const trendDirection = normalizedTrend?.direction || (
    normalizedTrend?.value !== undefined && normalizedTrend.value > 0 ? "up" : normalizedTrend?.value !== undefined && normalizedTrend.value < 0 ? "down" : "flat"
  );

  const content = (
    <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {/* Title */}
          {loading ? (
            <Skeleton variant="text" width="60%" height={18} sx={{ mb: 0.5 }} />
          ) : (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mb: 0.25, fontWeight: 500, display: "block" }}
              noWrap
            >
              {title}
            </Typography>
          )}

          {/* Value */}
          {loading ? (
            <Skeleton variant="text" width="40%" height={32} sx={{ mb: 0.5 }} />
          ) : (
            <Typography
              variant="h5"
              fontWeight="bold"
              sx={{ mb: 0.25, color: colors.main }}
            >
              {formattedValue}
            </Typography>
          )}

          {/* Subtitle or Trend */}
          {loading ? (
            <Skeleton variant="text" width="50%" height={20} />
          ) : normalizedTrend ? (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                color: getTrendColor(trendDirection),
              }}
            >
              {getTrendIcon(trendDirection)}
              <Typography variant="body2" fontWeight={500}>
                {Math.abs(normalizedTrend.value)}%
              </Typography>
              {normalizedTrend.label && (
                <Typography variant="body2" color="text.secondary">
                  {normalizedTrend.label}
                </Typography>
              )}
            </Box>
          ) : subtitle ? (
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          ) : null}
        </Box>

        {/* Icon */}
        {icon && !loading && (
          <Box
            sx={{
              p: 1,
              borderRadius: 1.5,
              bgcolor: colors.light,
              color: colors.main,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {icon}
          </Box>
        )}
        {loading && (
          <Skeleton
            variant="rounded"
            width={44}
            height={44}
            sx={{ borderRadius: 1.5 }}
          />
        )}
      </Box>
    </CardContent>
  );

  if (onClick) {
    return (
      <Card sx={{ height: "100%" }}>
        <CardActionArea onClick={onClick} sx={{ height: "100%" }}>
          {content}
        </CardActionArea>
      </Card>
    );
  }

  return <Card sx={{ height: "100%" }}>{content}</Card>;
};

export default TStatCard;
