import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  CardActionArea,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import {
  LocalShipping as TransferIcon,
  Inventory as ReceiveIcon,
  CheckCircle as ApprovalIcon,
  Assignment as ReportsIcon,
} from "@mui/icons-material";

const warehouseModules = [
  {
    title: "Transfer Notes",
    description: "Create and manage item transfer notes",
    icon: <TransferIcon sx={{ fontSize: 48 }} />,
    path: "/warehouse/transfer-notes",
    color: "#1976d2",
  },
  {
    title: "Receive Notes",
    description: "Process incoming item receipts",
    icon: <ReceiveIcon sx={{ fontSize: 48 }} />,
    path: "/warehouse/receive-notes",
    color: "#2e7d32",
  },
  {
    title: "Approvals",
    description: "Approve transfer requests",
    icon: <ApprovalIcon sx={{ fontSize: 48 }} />,
    path: "/warehouse/approvals",
    color: "#ed6c02",
  },
  {
    title: "Reports",
    description: "View warehouse reports and analytics",
    icon: <ReportsIcon sx={{ fontSize: 48 }} />,
    path: "/warehouse/reports",
    color: "#9c27b0",
  },
];

export default function WarehouseDashboard() {
  const navigate = useNavigate();

  return (
    <Box>
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        Sales Stock
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        Manage inventory transfers, receipts, and sales stock operations
      </Typography>

      <Grid container spacing={3}>
        {warehouseModules.map((module) => (
          <Grid item xs={12} sm={6} md={3} key={module.path}>
            <Card
              sx={{
                height: "100%",
                transition: "transform 0.2s, box-shadow 0.2s",
                "&:hover": {
                  transform: "translateY(-4px)",
                  boxShadow: 4,
                },
              }}
            >
              <CardActionArea
                onClick={() => navigate(module.path)}
                sx={{ height: "100%", p: 2 }}
              >
                <CardContent>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      mb: 2,
                      color: module.color,
                    }}
                  >
                    {module.icon}
                  </Box>
                  <Typography variant="h6" fontWeight="bold" gutterBottom>
                    {module.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {module.description}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
