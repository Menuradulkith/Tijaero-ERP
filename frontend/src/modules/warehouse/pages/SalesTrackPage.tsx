/**
 * SalesTrackPage - Placeholder for tracking sales
 */

import { Box, Typography, Paper } from "@mui/material";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";

export default function SalesTrackPage() {
  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3 }}>
        <TrendingUpIcon sx={{ fontSize: 40, color: "primary.main" }} />
        <Box>
          <Typography variant="h4" fontWeight="bold">
            Sales Track
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Track sales and monitor stock movements
          </Typography>
        </Box>
      </Box>

      <Paper sx={{ p: 4, textAlign: "center" }}>
        <Typography variant="h6" color="text.secondary" gutterBottom>
          Coming Soon
        </Typography>
        <Typography color="text.secondary">
          This page will display sales tracking and stock movement history.
        </Typography>
      </Paper>
    </Box>
  );
}
