/**
 * TLoadingSkeleton - Standardized skeleton loading component
 * 
 * Placeholder skeletons for loading states.
 * 
 * @example
 * ```tsx
 * <TLoadingSkeleton type="card" />
 * <TLoadingSkeleton type="list" count={5} />
 * <TLoadingSkeleton type="form" rows={4} />
 * ```
 */

import React from "react";
import { Box, Skeleton, Card, CardContent, Grid } from "@mui/material";

export interface TLoadingSkeletonProps {
  /** Skeleton type */
  type?: "text" | "card" | "list" | "table" | "form" | "statCard";
  /** Number of items/rows */
  count?: number;
  /** Number of columns (for table/form) */
  columns?: number;
  /** Animation */
  animation?: "pulse" | "wave" | false;
  /** Width */
  width?: number | string;
  /** Height */
  height?: number | string;
}

// Text skeleton
const TextSkeleton: React.FC<{ count: number; animation: TLoadingSkeletonProps["animation"] }> = ({
  count,
  animation,
}) => (
  <Box>
    {Array.from({ length: count }).map((_, i) => (
      <Skeleton
        key={i}
        animation={animation}
        variant="text"
        width={i === count - 1 ? "60%" : "100%"}
        sx={{ mb: 0.5 }}
      />
    ))}
  </Box>
);

// Card skeleton
const CardSkeleton: React.FC<{ animation: TLoadingSkeletonProps["animation"] }> = ({
  animation,
}) => (
  <Card>
    <CardContent>
      <Skeleton animation={animation} variant="rectangular" height={140} sx={{ mb: 2 }} />
      <Skeleton animation={animation} variant="text" width="80%" />
      <Skeleton animation={animation} variant="text" width="60%" />
    </CardContent>
  </Card>
);

// List skeleton
const ListSkeleton: React.FC<{
  count: number;
  animation: TLoadingSkeletonProps["animation"];
}> = ({ count, animation }) => (
  <Box>
    {Array.from({ length: count }).map((_, i) => (
      <Box
        key={i}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          py: 1.5,
          borderBottom: i < count - 1 ? 1 : 0,
          borderColor: "divider",
        }}
      >
        <Skeleton animation={animation} variant="circular" width={40} height={40} />
        <Box sx={{ flex: 1 }}>
          <Skeleton animation={animation} variant="text" width="60%" />
          <Skeleton animation={animation} variant="text" width="40%" />
        </Box>
        <Skeleton animation={animation} variant="rounded" width={60} height={24} />
      </Box>
    ))}
  </Box>
);

// Table skeleton
const TableSkeleton: React.FC<{
  count: number;
  columns: number;
  animation: TLoadingSkeletonProps["animation"];
}> = ({ count, columns, animation }) => (
  <Box>
    {/* Header */}
    <Box
      sx={{
        display: "flex",
        gap: 2,
        py: 1,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton
          key={i}
          animation={animation}
          variant="text"
          sx={{ flex: i === 0 ? 2 : 1 }}
          height={24}
        />
      ))}
    </Box>
    {/* Rows */}
    {Array.from({ length: count }).map((_, rowIdx) => (
      <Box
        key={rowIdx}
        sx={{
          display: "flex",
          gap: 2,
          py: 1.5,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        {Array.from({ length: columns }).map((_, colIdx) => (
          <Skeleton
            key={colIdx}
            animation={animation}
            variant="text"
            sx={{ flex: colIdx === 0 ? 2 : 1 }}
          />
        ))}
      </Box>
    ))}
  </Box>
);

// Form skeleton
const FormSkeleton: React.FC<{
  count: number;
  columns: number;
  animation: TLoadingSkeletonProps["animation"];
}> = ({ count, columns, animation }) => (
  <Grid container spacing={2}>
    {Array.from({ length: count }).map((_, i) => (
      <Grid item xs={12} sm={12 / columns} key={i}>
        <Skeleton animation={animation} variant="text" width="40%" height={16} sx={{ mb: 0.5 }} />
        <Skeleton animation={animation} variant="rounded" height={40} />
      </Grid>
    ))}
  </Grid>
);

// Stat card skeleton
const StatCardSkeleton: React.FC<{ animation: TLoadingSkeletonProps["animation"] }> = ({
  animation,
}) => (
  <Card>
    <CardContent>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <Box sx={{ flex: 1 }}>
          <Skeleton animation={animation} variant="text" width="60%" height={20} sx={{ mb: 1 }} />
          <Skeleton animation={animation} variant="text" width="40%" height={40} sx={{ mb: 1 }} />
          <Skeleton animation={animation} variant="text" width="50%" height={20} />
        </Box>
        <Skeleton animation={animation} variant="rounded" width={56} height={56} sx={{ borderRadius: 2 }} />
      </Box>
    </CardContent>
  </Card>
);

export const TLoadingSkeleton: React.FC<TLoadingSkeletonProps> = ({
  type = "text",
  count = 3,
  columns = 4,
  animation = "pulse",
  width,
  height,
}) => {
  const containerStyle = {
    width: width || "100%",
    height: height,
  };

  switch (type) {
    case "card":
      return (
        <Box sx={containerStyle}>
          <CardSkeleton animation={animation} />
        </Box>
      );

    case "list":
      return (
        <Box sx={containerStyle}>
          <ListSkeleton count={count} animation={animation} />
        </Box>
      );

    case "table":
      return (
        <Box sx={containerStyle}>
          <TableSkeleton count={count} columns={columns} animation={animation} />
        </Box>
      );

    case "form":
      return (
        <Box sx={containerStyle}>
          <FormSkeleton count={count} columns={columns > 2 ? 2 : columns} animation={animation} />
        </Box>
      );

    case "statCard":
      return (
        <Box sx={containerStyle}>
          <StatCardSkeleton animation={animation} />
        </Box>
      );

    default:
      return (
        <Box sx={containerStyle}>
          <TextSkeleton count={count} animation={animation} />
        </Box>
      );
  }
};

export default TLoadingSkeleton;
