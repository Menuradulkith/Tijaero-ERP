/**
 * DashboardPanel - Standardised section card used across module dashboards
 * for consistent visual hierarchy.
 */

import { ReactNode } from "react";
import { Box, Paper, Stack, Typography } from "@mui/material";

interface DashboardPanelProps {
  title: string;
  subtitle?: string;
  /** Right-aligned slot in the header (chip / button / link) */
  action?: ReactNode;
  children: ReactNode;
  /** Force a fixed height (e.g. when sitting next to charts) */
  height?: number | string;
  /** Reduce padding for dense lists */
  dense?: boolean;
}

export default function DashboardPanel({
  title,
  subtitle,
  action,
  children,
  height,
  dense,
}: DashboardPanelProps) {
  return (
    <Paper
      elevation={0}
      variant="outlined"
      sx={{
        p: dense ? 1.5 : 2.25,
        borderRadius: 3,
        border: "1px solid",
        borderColor: "divider",
        height: height ?? "100%",
        display: "flex",
        flexDirection: "column",
        background: "linear-gradient(180deg, #ffffff 0%, #fbfcff 100%)",
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        sx={{ mb: 1.25 }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="caption" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
        {action}
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0 }}>{children}</Box>
    </Paper>
  );
}
