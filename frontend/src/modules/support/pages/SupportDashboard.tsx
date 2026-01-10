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
  ConfirmationNumber as TicketIcon,
  Build as JobIcon,
  Phone as CallIcon,
  VerifiedUser as WarrantyIcon,
} from "@mui/icons-material";

const supportModules = [
  {
    title: "Support Tickets",
    description: "Manage customer support tickets",
    icon: <TicketIcon sx={{ fontSize: 48 }} />,
    path: "/support/tickets",
    color: "#1976d2",
  },
  {
    title: "Job Items",
    description: "Track job items and tasks",
    icon: <JobIcon sx={{ fontSize: 48 }} />,
    path: "/support/job-items",
    color: "#2e7d32",
  },
  {
    title: "Call Logs",
    description: "Customer call history",
    icon: <CallIcon sx={{ fontSize: 48 }} />,
    path: "/support/call-logs",
    color: "#ed6c02",
  },
  {
    title: "Warranty Claims",
    description: "Process warranty claims",
    icon: <WarrantyIcon sx={{ fontSize: 48 }} />,
    path: "/support/warranty-claims",
    color: "#9c27b0",
  },
];

export default function SupportDashboard() {
  const navigate = useNavigate();

  return (
    <Box>
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        Customer Support Management
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        Manage support tickets, job items, call logs, and warranty claims
      </Typography>

      <Grid container spacing={3}>
        {supportModules.map((module) => (
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
