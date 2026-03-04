/**
 * TPageSkeleton - Full-page loading skeleton for route transitions
 * 
 * Provides realistic page-shaped skeletons that replace spinner-based
 * loading indicators across the ERP. Supports multiple layout variants
 * to match the destination page structure.
 * 
 * @example
 * ```tsx
 * // Default - toolbar + data table layout
 * <TPageSkeleton />
 * 
 * // Dashboard with stat cards
 * <TPageSkeleton variant="dashboard" />
 * 
 * // Detail / form page
 * <TPageSkeleton variant="detail" />
 * 
 * // Simple list
 * <TPageSkeleton variant="list" />
 * ```
 */

import React from "react";
import { Box, Card, CardContent, Grid, Paper, Skeleton } from "@mui/material";

export type TPageSkeletonVariant = "default" | "dashboard" | "detail" | "list";

export interface TPageSkeletonProps {
  /** Layout variant matching the destination page type */
  variant?: TPageSkeletonVariant;
  /** Skeleton animation style */
  animation?: "pulse" | "wave" | false;
  /** Number of table/list rows for default/list variants */
  rows?: number;
  /** Number of stat cards for dashboard variant */
  statCards?: number;
}

// ─── Header / Toolbar skeleton (shared across variants) ──────────────────────
const HeaderSkeleton: React.FC<{ animation: TPageSkeletonProps["animation"] }> = ({ animation }) => (
  <Box
    sx={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      mb: 3,
    }}
  >
    {/* Page title + breadcrumb */}
    <Box>
      <Skeleton animation={animation} variant="text" width={200} height={36} />
      <Skeleton animation={animation} variant="text" width={140} height={18} />
    </Box>
    {/* Action buttons */}
    <Box sx={{ display: "flex", gap: 1 }}>
      <Skeleton animation={animation} variant="rounded" width={100} height={36} />
      <Skeleton animation={animation} variant="rounded" width={120} height={36} />
    </Box>
  </Box>
);

// ─── Filter / search bar skeleton ────────────────────────────────────────────
const FilterBarSkeleton: React.FC<{ animation: TPageSkeletonProps["animation"] }> = ({ animation }) => (
  <Paper
    variant="outlined"
    sx={{
      display: "flex",
      alignItems: "center",
      gap: 2,
      p: 1.5,
      mb: 2,
    }}
  >
    <Skeleton animation={animation} variant="rounded" width={240} height={36} />
    <Skeleton animation={animation} variant="rounded" width={140} height={36} />
    <Skeleton animation={animation} variant="rounded" width={140} height={36} />
    <Box sx={{ flex: 1 }} />
    <Skeleton animation={animation} variant="rounded" width={80} height={36} />
  </Paper>
);

// ─── Data table skeleton ─────────────────────────────────────────────────────
const TableSkeleton: React.FC<{
  rows: number;
  animation: TPageSkeletonProps["animation"];
}> = ({ rows, animation }) => (
  <Paper variant="outlined" sx={{ overflow: "hidden" }}>
    {/* Table header */}
    <Box
      sx={{
        display: "flex",
        gap: 2,
        px: 2,
        py: 1.5,
        bgcolor: "action.hover",
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Skeleton animation={animation} variant="text" width="5%" height={22} />
      <Skeleton animation={animation} variant="text" width="20%" height={22} />
      <Skeleton animation={animation} variant="text" width="25%" height={22} />
      <Skeleton animation={animation} variant="text" width="15%" height={22} />
      <Skeleton animation={animation} variant="text" width="15%" height={22} />
      <Skeleton animation={animation} variant="text" width="10%" height={22} />
      <Skeleton animation={animation} variant="text" width="10%" height={22} />
    </Box>
    {/* Table rows */}
    {Array.from({ length: rows }).map((_, i) => (
      <Box
        key={i}
        sx={{
          display: "flex",
          gap: 2,
          px: 2,
          py: 1.5,
          borderBottom: i < rows - 1 ? 1 : 0,
          borderColor: "divider",
        }}
      >
        <Skeleton animation={animation} variant="text" width="5%" height={20} />
        <Skeleton animation={animation} variant="text" width="20%" height={20} />
        <Skeleton animation={animation} variant="text" width="25%" height={20} />
        <Skeleton animation={animation} variant="text" width="15%" height={20} />
        <Skeleton animation={animation} variant="text" width="15%" height={20} />
        <Skeleton animation={animation} variant="rounded" width={60} height={22} />
        <Skeleton animation={animation} variant="circular" width={28} height={28} />
      </Box>
    ))}
  </Paper>
);

// ─── Stat card skeleton ──────────────────────────────────────────────────────
const StatCardSkeleton: React.FC<{ animation: TPageSkeletonProps["animation"] }> = ({ animation }) => (
  <Card variant="outlined">
    <CardContent sx={{ py: 2, "&:last-child": { pb: 2 } }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <Box sx={{ flex: 1 }}>
          <Skeleton animation={animation} variant="text" width="60%" height={18} sx={{ mb: 0.5 }} />
          <Skeleton animation={animation} variant="text" width="45%" height={36} sx={{ mb: 0.5 }} />
          <Skeleton animation={animation} variant="text" width="50%" height={16} />
        </Box>
        <Skeleton animation={animation} variant="rounded" width={48} height={48} sx={{ borderRadius: 1.5 }} />
      </Box>
    </CardContent>
  </Card>
);

// ─── Chart placeholder skeleton ──────────────────────────────────────────────
const ChartSkeleton: React.FC<{ animation: TPageSkeletonProps["animation"] }> = ({ animation }) => (
  <Card variant="outlined">
    <CardContent>
      <Skeleton animation={animation} variant="text" width="30%" height={24} sx={{ mb: 2 }} />
      <Skeleton animation={animation} variant="rectangular" height={200} sx={{ borderRadius: 1 }} />
    </CardContent>
  </Card>
);

// ─── List item skeleton ──────────────────────────────────────────────────────
const ListItemsSkeleton: React.FC<{
  rows: number;
  animation: TPageSkeletonProps["animation"];
}> = ({ rows, animation }) => (
  <Paper variant="outlined">
    {Array.from({ length: rows }).map((_, i) => (
      <Box
        key={i}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          px: 2,
          py: 1.5,
          borderBottom: i < rows - 1 ? 1 : 0,
          borderColor: "divider",
        }}
      >
        <Skeleton animation={animation} variant="circular" width={40} height={40} />
        <Box sx={{ flex: 1 }}>
          <Skeleton animation={animation} variant="text" width="55%" height={20} />
          <Skeleton animation={animation} variant="text" width="35%" height={16} />
        </Box>
        <Skeleton animation={animation} variant="rounded" width={70} height={24} />
        <Skeleton animation={animation} variant="circular" width={28} height={28} />
      </Box>
    ))}
  </Paper>
);

// ─── Detail / form section skeleton ──────────────────────────────────────────
const FormSectionSkeleton: React.FC<{ animation: TPageSkeletonProps["animation"] }> = ({ animation }) => (
  <Card variant="outlined" sx={{ mb: 2 }}>
    <CardContent>
      <Skeleton animation={animation} variant="text" width="25%" height={24} sx={{ mb: 2 }} />
      <Grid container spacing={2}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Grid item xs={12} sm={6} md={4} key={i}>
            <Skeleton animation={animation} variant="text" width="40%" height={16} sx={{ mb: 0.5 }} />
            <Skeleton animation={animation} variant="rounded" height={40} />
          </Grid>
        ))}
      </Grid>
    </CardContent>
  </Card>
);

// =============================================================================
// VARIANT LAYOUTS
// =============================================================================

/** Default — toolbar + filter bar + data table (master list pages) */
const DefaultLayout: React.FC<{ rows: number; animation: TPageSkeletonProps["animation"] }> = ({
  rows,
  animation,
}) => (
  <>
    <HeaderSkeleton animation={animation} />
    <FilterBarSkeleton animation={animation} />
    <TableSkeleton rows={rows} animation={animation} />
  </>
);

/** Dashboard — stat cards + charts + recent activity */
const DashboardLayout: React.FC<{
  statCards: number;
  animation: TPageSkeletonProps["animation"];
}> = ({ statCards, animation }) => (
  <>
    <HeaderSkeleton animation={animation} />
    {/* Stat cards row */}
    <Grid container spacing={2} sx={{ mb: 3 }}>
      {Array.from({ length: statCards }).map((_, i) => (
        <Grid item xs={12} sm={6} md={3} key={i}>
          <StatCardSkeleton animation={animation} />
        </Grid>
      ))}
    </Grid>
    {/* Charts row */}
    <Grid container spacing={2} sx={{ mb: 3 }}>
      <Grid item xs={12} md={8}>
        <ChartSkeleton animation={animation} />
      </Grid>
      <Grid item xs={12} md={4}>
        <ChartSkeleton animation={animation} />
      </Grid>
    </Grid>
    {/* Recent list */}
    <ListItemsSkeleton rows={4} animation={animation} />
  </>
);

/** Detail — header + form sections + line items table */
const DetailLayout: React.FC<{ animation: TPageSkeletonProps["animation"] }> = ({ animation }) => (
  <>
    {/* Detail header with status + actions */}
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
        <Skeleton animation={animation} variant="circular" width={36} height={36} />
        <Box>
          <Skeleton animation={animation} variant="text" width={180} height={32} />
          <Skeleton animation={animation} variant="text" width={120} height={18} />
        </Box>
        <Skeleton animation={animation} variant="rounded" width={80} height={24} sx={{ ml: 1 }} />
      </Box>
      <Box sx={{ display: "flex", gap: 1 }}>
        <Skeleton animation={animation} variant="rounded" width={90} height={36} />
        <Skeleton animation={animation} variant="rounded" width={90} height={36} />
        <Skeleton animation={animation} variant="rounded" width={36} height={36} />
      </Box>
    </Box>
    {/* Form sections */}
    <FormSectionSkeleton animation={animation} />
    <FormSectionSkeleton animation={animation} />
    {/* Line items table */}
    <Card variant="outlined">
      <CardContent>
        <Skeleton animation={animation} variant="text" width="20%" height={24} sx={{ mb: 2 }} />
        <TableSkeleton rows={3} animation={animation} />
      </CardContent>
    </Card>
  </>
);

/** List — header + search + list items */
const ListLayout: React.FC<{ rows: number; animation: TPageSkeletonProps["animation"] }> = ({
  rows,
  animation,
}) => (
  <>
    <HeaderSkeleton animation={animation} />
    {/* Search bar */}
    <Box sx={{ mb: 2 }}>
      <Skeleton animation={animation} variant="rounded" width="100%" height={40} />
    </Box>
    <ListItemsSkeleton rows={rows} animation={animation} />
  </>
);

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const TPageSkeleton: React.FC<TPageSkeletonProps> = ({
  variant = "default",
  animation = "wave",
  rows = 8,
  statCards = 4,
}) => {
  const content = (() => {
    switch (variant) {
      case "dashboard":
        return <DashboardLayout statCards={statCards} animation={animation} />;
      case "detail":
        return <DetailLayout animation={animation} />;
      case "list":
        return <ListLayout rows={rows} animation={animation} />;
      default:
        return <DefaultLayout rows={rows} animation={animation} />;
    }
  })();

  return (
    <Box sx={{ p: 3, width: "100%" }}>
      {content}
    </Box>
  );
};

export default TPageSkeleton;
