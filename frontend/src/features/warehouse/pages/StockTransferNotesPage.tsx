/**
 * StockTransferNotesPage - Manage stock transfers between branches
 */

import { Box, Typography, Paper } from "@mui/material";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";

export default function StockTransferNotesPage() {
  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3 }}>
        <SwapHorizIcon sx={{ fontSize: 40, color: "primary.main" }} />
        <Box>
          <Typography variant="h4" fontWeight="bold">
            Transfer Notes
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Create and manage stock transfers between branches
          </Typography>
        </Box>
      </Box>

      <Paper sx={{ p: 4, textAlign: "center" }}>
        <Typography variant="h6" color="text.secondary" gutterBottom>
          Coming Soon
        </Typography>
        <Typography color="text.secondary">
          This page will allow you to create transfer notes to move stock between branches.
        </Typography>
      </Paper>
    </Box>
  );
}
