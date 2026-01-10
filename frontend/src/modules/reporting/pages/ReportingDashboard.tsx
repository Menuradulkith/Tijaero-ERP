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
  TrendingUp as SalesIcon,
  AccountBalance as FinanceIcon,
  Inventory as InventoryIcon,
  People as HRIcon,
  Warehouse as WarehouseIcon,
  SupportAgent as SupportIcon,
} from "@mui/icons-material";

const reportModules = [
  {
    title: "Sales Reports",
    description: "Sales analytics, top products, revenue trends",
    icon: <SalesIcon sx={{ fontSize: 48 }} />,
    path: "/reporting/sales",
    color: "#1976d2",
  },
  {
    title: "Finance Reports",
    description: "Income, expenses, profit analysis",
    icon: <FinanceIcon sx={{ fontSize: 48 }} />,
    path: "/reporting/finance",
    color: "#2e7d32",
  },
  {
    title: "Inventory Reports",
    description: "Stock levels, product analytics",
    icon: <InventoryIcon sx={{ fontSize: 48 }} />,
    path: "/reporting/inventory",
    color: "#ed6c02",
  },
  {
    title: "HR Reports",
    description: "Payroll, employees, attendance",
    icon: <HRIcon sx={{ fontSize: 48 }} />,
    path: "/reporting/hr",
    color: "#9c27b0",
  },
  {
    title: "Warehouse Reports",
    description: "Transfers, receives, approvals",
    icon: <WarehouseIcon sx={{ fontSize: 48 }} />,
    path: "/reporting/warehouse",
    color: "#0288d1",
  },
  {
    title: "Support Reports",
    description: "Tickets, warranty claims, call logs",
    icon: <SupportIcon sx={{ fontSize: 48 }} />,
    path: "/reporting/support",
    color: "#d32f2f",
  },
];

export default function ReportingDashboard() {
  const navigate = useNavigate();

  return (
    <Box>
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        Reports & Analytics
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        Generate comprehensive reports and analytics across all modules
      </Typography>

      <Grid container spacing={3}>
        {reportModules.map((module) => (
          <Grid item xs={12} sm={6} md={4} key={module.path}>
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
