import { useNavigate } from "react-router-dom";
import {
  Grid,
  Card,
  CardContent,
  Typography,
  Box,
  Paper,
  LinearProgress,
} from "@mui/material";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import PeopleIcon from "@mui/icons-material/People";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import InventoryIcon from "@mui/icons-material/Inventory";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";

interface StatCardProps {
  title: string;
  value: string;
  change: number;
  icon: React.ReactNode;
  color: string;
}

function StatCard({ title, value, change, icon, color }: StatCardProps) {
  const isPositive = change >= 0;

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
          <Box>
            <Typography color="text.secondary" variant="body2" gutterBottom>
              {title}
            </Typography>
            <Typography
              variant="h4"
              component="div"
              sx={{
                mb: 1,
                fontSize: { xs: "1.5rem", sm: "1.75rem", md: "2.125rem" },
              }}
            >
              {value}
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              {isPositive ? (
                <TrendingUpIcon sx={{ fontSize: 16, color: "success.main" }} />
              ) : (
                <TrendingDownIcon sx={{ fontSize: 16, color: "error.main" }} />
              )}
              <Typography
                variant="body2"
                sx={{ color: isPositive ? "success.main" : "error.main" }}
              >
                {Math.abs(change)}%
              </Typography>
              <Typography variant="body2" color="text.secondary">
                vs last month
              </Typography>
            </Box>
          </Box>
          <Box
            sx={{
              bgcolor: color,
              borderRadius: 2,
              p: 1.5,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {icon}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

interface ActivityItem {
  title: string;
  time: string;
  type: "sale" | "customer" | "inventory" | "payment";
}

const recentActivities: ActivityItem[] = [
  { title: "New sale order #SO-2024-001", time: "5 minutes ago", type: "sale" },
  {
    title: 'Customer "ABC Corp" created',
    time: "15 minutes ago",
    type: "customer",
  },
  {
    title: "Low stock alert: Product XYZ",
    time: "1 hour ago",
    type: "inventory",
  },
  { title: "Payment received: $5,000", time: "2 hours ago", type: "payment" },
  { title: "New sale order #SO-2024-002", time: "3 hours ago", type: "sale" },
];

export default function DashboardPage() {
  const navigate = useNavigate();

  return (
    <Box>
      <Typography
        variant="h4"
        gutterBottom
        sx={{
          mb: 3,
          fontSize: { xs: "1.5rem", sm: "2rem", md: "2.125rem" },
        }}
      >
        Dashboard
      </Typography>

      <Grid container spacing={3}>
        {/* Stat Cards */}
        <Grid item xs={12} sm={6} lg={3}>
          <StatCard
            title="Total Customers"
            value="1,234"
            change={12.5}
            icon={<PeopleIcon sx={{ color: "white", fontSize: 32 }} />}
            color="primary.main"
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatCard
            title="Sales This Month"
            value="$45,678"
            change={8.2}
            icon={<ShoppingCartIcon sx={{ color: "white", fontSize: 32 }} />}
            color="success.main"
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatCard
            title="Inventory Items"
            value="567"
            change={-3.1}
            icon={<InventoryIcon sx={{ color: "white", fontSize: 32 }} />}
            color="warning.main"
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatCard
            title="Revenue"
            value="$123,456"
            change={15.3}
            icon={
              <AccountBalanceWalletIcon sx={{ color: "white", fontSize: 32 }} />
            }
            color="info.main"
          />
        </Grid>

        {/* Sales Overview */}
        <Grid item xs={12} lg={8}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Sales Overview
              </Typography>
              <Box sx={{ mt: 3 }}>
                <Box sx={{ mb: 3 }}>
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      mb: 1,
                    }}
                  >
                    <Typography variant="body2">Q1 Target</Typography>
                    <Typography variant="body2" fontWeight={600}>
                      75%
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={75}
                    sx={{ height: 8, borderRadius: 1 }}
                  />
                </Box>
                <Box sx={{ mb: 3 }}>
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      mb: 1,
                    }}
                  >
                    <Typography variant="body2">New Customers</Typography>
                    <Typography variant="body2" fontWeight={600}>
                      60%
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={60}
                    sx={{ height: 8, borderRadius: 1 }}
                    color="success"
                  />
                </Box>
                <Box>
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      mb: 1,
                    }}
                  >
                    <Typography variant="body2">Product Delivery</Typography>
                    <Typography variant="body2" fontWeight={600}>
                      90%
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={90}
                    sx={{ height: 8, borderRadius: 1 }}
                    color="info"
                  />
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Recent Activities */}
        <Grid item xs={12} lg={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Recent Activities
              </Typography>
              <Box sx={{ mt: 2 }}>
                {recentActivities.map((activity, index) => (
                  <Box
                    key={index}
                    sx={{
                      py: 1.5,
                      borderBottom: index < recentActivities.length - 1 ? 1 : 0,
                      borderColor: "divider",
                    }}
                  >
                    <Typography variant="body2" fontWeight={500}>
                      {activity.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {activity.time}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Quick Actions */}
        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Quick Actions
            </Typography>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12} sm={6} md={3}>
                <Box
                  onClick={() => navigate("/customers?action=new")}
                  sx={{
                    p: 2,
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1,
                    textAlign: "center",
                    cursor: "pointer",
                    "&:hover": { bgcolor: "action.hover" },
                  }}
                >
                  <PeopleIcon
                    sx={{ fontSize: 40, color: "primary.main", mb: 1 }}
                  />
                  <Typography variant="body2">Add Customer</Typography>
                </Box>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Box
                  onClick={() => navigate("/sales?action=new")}
                  sx={{
                    p: 2,
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1,
                    textAlign: "center",
                    cursor: "pointer",
                    "&:hover": { bgcolor: "action.hover" },
                  }}
                >
                  <ShoppingCartIcon
                    sx={{ fontSize: 40, color: "success.main", mb: 1 }}
                  />
                  <Typography variant="body2">Create Sale Order</Typography>
                </Box>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Box
                  onClick={() => navigate("/inventory?action=new")}
                  sx={{
                    p: 2,
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1,
                    textAlign: "center",
                    cursor: "pointer",
                    "&:hover": { bgcolor: "action.hover" },
                  }}
                >
                  <InventoryIcon
                    sx={{ fontSize: 40, color: "warning.main", mb: 1 }}
                  />
                  <Typography variant="body2">Add Product</Typography>
                </Box>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Box
                  onClick={() => navigate("/finance")}
                  sx={{
                    p: 2,
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1,
                    textAlign: "center",
                    cursor: "pointer",
                    "&:hover": { bgcolor: "action.hover" },
                  }}
                >
                  <AccountBalanceWalletIcon
                    sx={{ fontSize: 40, color: "info.main", mb: 1 }}
                  />
                  <Typography variant="body2">Record Payment</Typography>
                </Box>
              </Grid>
            </Grid>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
