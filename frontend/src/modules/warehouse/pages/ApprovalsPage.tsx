import { Box, Typography } from "@mui/material";

export default function ApprovalsPage() {
  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" fontWeight={600} gutterBottom>
        Transfer Note Approvals
      </Typography>
      <Typography color="text.secondary">
        This page has moved to the centralized Approval Dashboard.
      </Typography>
    </Box>
  );
}
