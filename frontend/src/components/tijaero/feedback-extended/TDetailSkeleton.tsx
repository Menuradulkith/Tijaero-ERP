/**
 * TDetailSkeleton - Skeleton for master-detail panel right-hand side
 *
 * Used inside MasterDetailLayout detail panels while data is loading.
 * Mirrors the typical detail panel structure: optional toolbar, optional
 * header, N form sections each with M field skeletons, optional table.
 *
 * @example
 * ```tsx
 * <TDetailSkeleton sections={2} fieldsPerSection={4} />
 * <TDetailSkeleton sections={3} fieldsPerSection={6} showHeader={false} showToolbar={false} />
 * <TDetailSkeleton sections={2} fieldsPerSection={4} showTable />
 * ```
 */

import React from "react";
import { Box, Card, CardContent, Grid, Skeleton } from "@mui/material";

export interface TDetailSkeletonProps {
  /** Number of form sections to render */
  sections?: number;
  /** Number of field skeletons per section */
  fieldsPerSection?: number;
  /** Show a toolbar skeleton at the top (action buttons row) */
  showToolbar?: boolean;
  /** Show a header skeleton (title + status chip) */
  showHeader?: boolean;
  /** Show a line-items table skeleton at the bottom */
  showTable?: boolean;
  /** Skeleton animation */
  animation?: "pulse" | "wave" | false;
}

export const TDetailSkeleton: React.FC<TDetailSkeletonProps> = ({
  sections = 2,
  fieldsPerSection = 4,
  showToolbar = true,
  showHeader = true,
  showTable = false,
  animation = "wave",
}) => {
  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
      {/* Toolbar skeleton */}
      {showToolbar && (
        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
          <Skeleton animation={animation} variant="rounded" width={90} height={34} />
          <Skeleton animation={animation} variant="rounded" width={90} height={34} />
          <Skeleton animation={animation} variant="rounded" width={34} height={34} />
        </Box>
      )}

      {/* Header skeleton */}
      {showHeader && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 0.5 }}>
          <Skeleton animation={animation} variant="text" width={200} height={32} />
          <Skeleton animation={animation} variant="rounded" width={72} height={24} />
        </Box>
      )}

      {/* Form sections */}
      {Array.from({ length: sections }).map((_, sIdx) => (
        <Card key={sIdx} variant="outlined">
          <CardContent sx={{ pb: "12px !important" }}>
            {/* Section title */}
            <Skeleton
              animation={animation}
              variant="text"
              width="30%"
              height={22}
              sx={{ mb: 1.5 }}
            />
            <Grid container spacing={2}>
              {Array.from({ length: fieldsPerSection }).map((_, fIdx) => (
                <Grid item xs={12} sm={6} key={fIdx}>
                  <Skeleton
                    animation={animation}
                    variant="text"
                    width="40%"
                    height={16}
                    sx={{ mb: 0.5 }}
                  />
                  <Skeleton animation={animation} variant="rounded" height={38} />
                </Grid>
              ))}
            </Grid>
          </CardContent>
        </Card>
      ))}

      {/* Optional line-items table */}
      {showTable && (
        <Card variant="outlined">
          <CardContent sx={{ pb: "12px !important" }}>
            <Skeleton
              animation={animation}
              variant="text"
              width="25%"
              height={22}
              sx={{ mb: 1.5 }}
            />
            {/* Table header */}
            <Box
              sx={{
                display: "flex",
                gap: 2,
                py: 1,
                borderBottom: 1,
                borderColor: "divider",
              }}
            >
              {[2, 1, 1, 1, 1].map((flex, i) => (
                <Skeleton
                  key={i}
                  animation={animation}
                  variant="text"
                  sx={{ flex }}
                  height={20}
                />
              ))}
            </Box>
            {/* Table rows */}
            {Array.from({ length: 3 }).map((_, rIdx) => (
              <Box
                key={rIdx}
                sx={{
                  display: "flex",
                  gap: 2,
                  py: 1.25,
                  borderBottom: rIdx < 2 ? 1 : 0,
                  borderColor: "divider",
                }}
              >
                {[2, 1, 1, 1, 1].map((flex, i) => (
                  <Skeleton
                    key={i}
                    animation={animation}
                    variant="text"
                    sx={{ flex }}
                    height={18}
                  />
                ))}
              </Box>
            ))}
          </CardContent>
        </Card>
      )}
    </Box>
  );
};

export default TDetailSkeleton;
