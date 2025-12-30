import { Box, Typography, Grid, Card, CardContent, Paper } from "@mui/material";
import {
  TrendingUp as TrendingUpIcon,
  Inventory as InventoryIcon,
  LocalShipping as ShippingIcon,
  CheckCircle as CheckIcon,
} from "@mui/icons-material";

export default function ReportsPage() {
  // Placeholder data - in real app, fetch from API
  const stats = [
    {
      title: "Total Transfers",
      value: "0",
      icon: <ShippingIcon sx={{ fontSize: 40 }} />,
      color: "#1976d2",
    },
    {
      title: "Pending Approvals",
      value: "0",
      icon: <TrendingUpIcon sx={{ fontSize: 40 }} />,
      color: "#ed6c02",
    },
    {
      title: "Completed",
      value: "0",
      icon: <CheckIcon sx={{ fontSize: 40 }} />,
      color: "#2e7d32",
    },
    {
      title: "Items in Transit",
      value: "0",
      icon: <InventoryIcon sx={{ fontSize: 40 }} />,
      color: "#9c27b0",
    },
  ];

  return (
    <Box>
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        Warehouse Reports & Analytics
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        Overview of warehouse operations and transfer statistics
      </Typography>

      <Grid container spacing={3} sx={{ mb: 4 }}>
        {stats.map((stat, index) => (
          <Grid item xs={12} sm={6} md={3} key={index}>
            <Card>
              <CardContent>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <Box>
                    <Typography variant="h4" fontWeight="bold">
                      {stat.value}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {stat.title}
                    </Typography>
                  </Box>
                  <Box sx={{ color: stat.color }}>{stat.icon}</Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" fontWeight="bold" gutterBottom>
              Recent Transfers
            </Typography>
            <Typography variant="body2" color="text.secondary">
              No recent transfers to display
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" fontWeight="bold" gutterBottom>
              Transfer by Location
            </Typography>
            <Typography variant="body2" color="text.secondary">
              No location data available
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" fontWeight="bold" gutterBottom>
              Monthly Transfer Trends
            </Typography>
            <Typography variant="body2" color="text.secondary">
              No trend data available
            </Typography>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
