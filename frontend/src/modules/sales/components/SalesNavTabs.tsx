import {
    People as CustomersIcon,
    Dashboard as DashboardIcon,
    Receipt as OrdersIcon,
    Description as QuotationsIcon,
    AssignmentReturn as ReturnsIcon,
} from "@mui/icons-material";
import { Box, Tab, Tabs } from "@mui/material";
import { useLocation, useNavigate } from "react-router-dom";

interface SalesNavTabsProps {
  value?: string;
}

const salesTabs = [
  { value: "/sales/dashboard", label: "Dashboard", icon: <DashboardIcon />, path: "/sales/dashboard" },
  { value: "/sales/customers", label: "Customers", icon: <CustomersIcon />, path: "/sales/customers" },
  { value: "/sales/quotations", label: "Quotations", icon: <QuotationsIcon />, path: "/sales/quotations" },
  { value: "/sales", label: "Orders", icon: <OrdersIcon />, path: "/sales" },
  { value: "/sales/returns", label: "Returns", icon: <ReturnsIcon />, path: "/sales/returns" },
];

export default function SalesNavTabs({ value }: SalesNavTabsProps) {
  const navigate = useNavigate();
  const location = useLocation();

  // Determine current tab from location
  const currentTab = value || (() => {
    const path = location.pathname;
    // Check for exact matches
    const exactMatch = salesTabs.find((tab) => path === tab.path);
    if (exactMatch) return exactMatch.value;
    // Default to orders
    return "/sales";
  })();

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
