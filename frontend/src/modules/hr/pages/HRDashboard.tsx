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
  AccountBalance as PayrollIcon,
  TrendingUp as PromotionIcon,
  Receipt as ReimbursementIcon,
  MoneyOff as DeductionIcon,
  Devices as AssetsIcon,
  Person as ProfileIcon,
} from "@mui/icons-material";

const hrModules = [
  {
    title: "Payroll",
    description: "Manage employee payroll records",
    icon: <PayrollIcon sx={{ fontSize: 48 }} />,
    path: "/hr/payroll",
    color: "#1976d2",
  },
  {
    title: "Salary Profiles",
    description: "Employee salary configurations",
    icon: <ProfileIcon sx={{ fontSize: 48 }} />,
    path: "/hr/salary-profiles",
    color: "#2e7d32",
  },
  {
    title: "Promotions",
    description: "Track employee promotions",
    icon: <PromotionIcon sx={{ fontSize: 48 }} />,
    path: "/hr/promotions",
    color: "#ed6c02",
  },
  {
    title: "Reimbursements",
    description: "Process expense reimbursements",
    icon: <ReimbursementIcon sx={{ fontSize: 48 }} />,
    path: "/hr/reimbursements",
    color: "#9c27b0",
  },
  {
    title: "Deductions",
    description: "Manage salary deductions",
    icon: <DeductionIcon sx={{ fontSize: 48 }} />,
    path: "/hr/deductions",
    color: "#d32f2f",
  },
  {
    title: "Employee Assets",
    description: "Track company asset assignments",
    icon: <AssetsIcon sx={{ fontSize: 48 }} />,
    path: "/hr/assets",
    color: "#0288d1",
  },
];

export default function HRDashboard() {
  const navigate = useNavigate();

  return (
    <Box>
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        Human Resources Management
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        Manage payroll, promotions, reimbursements, and employee records
      </Typography>

      <Grid container spacing={3}>
        {hrModules.map((module) => (
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
