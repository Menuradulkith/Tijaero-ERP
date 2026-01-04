import { Box, Tabs, Tab } from "@mui/material";
import {
  Receipt as OrdersIcon,
  AssignmentReturn as ReturnsIcon,
  Dashboard as DashboardIcon,
} from "@mui/icons-material";
import { useNavigate, useLocation } from "react-router-dom";

interface SalesNavTabsProps {
  value?: string;
}

const salesTabs = [
  { value: "/sales", label: "Orders", icon: <OrdersIcon />, path: "/sales" },
  { value: "/sales/returns", label: "Returns", icon: <ReturnsIcon />, path: "/sales/returns" },
  { value: "/sales/dashboard", label: "Dashboard", icon: <DashboardIcon />, path: "/sales/dashboard" },
];

export default function SalesNavTabs({ value }: SalesNavTabsProps) {
  const navigate = useNavigate();
  const location = useLocation();

  // Determine current tab from location
  const currentTab = value || (
    salesTabs.find((tab) => location.pathname === tab.path)?.value || "/sales"
  );

  const handleChange = (_: React.SyntheticEvent, newValue: string) => {
    navigate(newValue);
  };

  return (
    <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 2, bgcolor: "background.paper" }}>
      <Tabs
        value={currentTab}
        onChange={handleChange}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          "& .MuiTab-root": {
            minHeight: 48,
            textTransform: "none",
          },
        }}
      >
        {salesTabs.map((tab) => (
          <Tab
            key={tab.value}
            value={tab.value}
            label={tab.label}
            icon={tab.icon}
            iconPosition="start"
          />
        ))}
      </Tabs>
    </Box>
  );
}
