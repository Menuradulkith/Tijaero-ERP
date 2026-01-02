/**
 * Skeleton loader for StatCard component
 */
import { Card, CardContent, Box, Skeleton } from "@mui/material";

export default function StatCardSkeleton() {
  return (
    <Card>
      <CardContent>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <Box sx={{ flex: 1 }}>
            {/* Title skeleton */}
            <Skeleton variant="text" width="60%" height={20} sx={{ mb: 1 }} />

            {/* Value skeleton */}
            <Skeleton variant="text" width="40%" height={40} sx={{ mb: 1 }} />

            {/* Trend skeleton */}
            <Skeleton variant="text" width="50%" height={20} />
          </Box>

          {/* Icon skeleton */}
          <Skeleton
            variant="rounded"
            width={56}
            height={56}
            sx={{ borderRadius: 2 }}
          />
        </Box>
      </CardContent>
    </Card>
  );
}
