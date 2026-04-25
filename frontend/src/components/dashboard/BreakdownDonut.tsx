/**
 * BreakdownDonut - Compact donut chart for showing category breakdowns
 * (payment methods, PO status, ticket priority, etc.).
 */

import { Box, Stack, Typography, useTheme } from "@mui/material";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

export interface BreakdownSlice {
  label: string;
  value: number;
  color: string;
  [key: string]: string | number;
}

interface BreakdownDonutProps {
  data: BreakdownSlice[];
  /** Headline shown in the centre */
  centerLabel?: string;
  /** Sub-line shown in the centre (e.g. total) */
  centerValue?: string;
  /** Format slice values for tooltip / legend */
  formatValue?: (value: number) => string;
  height?: number;
}

export default function BreakdownDonut({
  data,
  centerLabel,
  centerValue,
  formatValue,
  height = 220,
}: BreakdownDonutProps) {
  const theme = useTheme();
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const fmt = formatValue || ((v: number) => v.toLocaleString());
  const hasData = total > 0;

  return (
    <Stack direction={{ xs: "column", sm: "row" }} alignItems="center" spacing={2}>
      <Box sx={{ position: "relative", width: { xs: "100%", sm: height }, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={hasData ? data : [{ label: "—", value: 1, color: theme.palette.action.hover }]}
              cx="50%"
              cy="50%"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={hasData ? 2 : 0}
              dataKey="value"
              stroke="none"
              isAnimationActive={false}
            >
              {(hasData ? data : [{ color: theme.palette.action.hover }]).map((slice, i) => (
                <Cell key={i} fill={slice.color} />
              ))}
            </Pie>
            {hasData && (
              <Tooltip
                formatter={(v: number | string | undefined, _n: unknown, item: any) => [
                  fmt(typeof v === "number" ? v : Number(v ?? 0)),
                  item?.payload?.label ?? "",
                ]}
                contentStyle={{
                  borderRadius: 8,
                  border: `1px solid ${theme.palette.divider}`,
                  backgroundColor: theme.palette.background.paper,
                  fontSize: 12,
                }}
              />
            )}
          </PieChart>
        </ResponsiveContainer>
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          {centerLabel && (
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
              {centerLabel}
            </Typography>
          )}
          {centerValue !== undefined && (
            <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
              {centerValue}
            </Typography>
          )}
        </Box>
      </Box>

      <Stack spacing={1.1} sx={{ flex: 1, width: "100%" }}>
        {data.map((slice) => {
          const pct = hasData ? (slice.value / total) * 100 : 0;
          return (
            <Box key={slice.label}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    bgcolor: slice.color,
                    flexShrink: 0,
                  }}
                />
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                  {slice.label}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {fmt(slice.value)}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ width: 44, textAlign: "right", flexShrink: 0 }}
                >
                  {pct.toFixed(1)}%
                </Typography>
              </Stack>
            </Box>
          );
        })}
        {!hasData && (
          <Typography variant="caption" color="text.secondary">
            No data available
          </Typography>
        )}
      </Stack>
    </Stack>
  );
}
