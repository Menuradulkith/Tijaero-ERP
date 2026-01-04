import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Box,
  Typography,
  Divider,
} from "@mui/material";
import DashboardIcon from "@mui/icons-material/Dashboard";
import PeopleIcon from "@mui/icons-material/People";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import InventoryIcon from "@mui/icons-material/Inventory";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import GroupIcon from "@mui/icons-material/Group";
import BusinessIcon from "@mui/icons-material/Business";
import WarehouseIcon from "@mui/icons-material/Warehouse";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import AssessmentIcon from "@mui/icons-material/Assessment";
import PersonIcon from "@mui/icons-material/Person";
import SecurityIcon from "@mui/icons-material/Security";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/state/authStore";
import { hasPermission, PERMISSIONS } from "@/auth/permissions";

interface SidebarProps {
  drawerWidth: number;
  mobileOpen: boolean;
  onDrawerToggle: () => void;
  isMobile: boolean;
}

interface MenuItem {
  text: string;
  icon: JSX.Element;
  path: string;
  permission?: { resource: string; action: string };
}

const menuItems: MenuItem[] = [
  { text: "Dashboard", icon: <DashboardIcon />, path: "/dashboard" },
  {
    text: "Customers",
    icon: <PeopleIcon />,
    path: "/customers",
    permission: PERMISSIONS.CUSTOMER_VIEW,
  },
  {
    text: "Sales",
    icon: <ShoppingCartIcon />,
    path: "/sales",
    permission: PERMISSIONS.SALES_VIEW,
  },
  {
    text: "Purchasing",
    icon: <LocalShippingIcon />,
    path: "/purchasing",
    permission: PERMISSIONS.PURCHASING_VIEW,
  },
  {
    text: "Inventory",
    icon: <InventoryIcon />,
    path: "/inventory",
    permission: PERMISSIONS.INVENTORY_VIEW,
  },
  {
    text: "Finance",
    icon: <AccountBalanceIcon />,
    path: "/finance",
    permission: PERMISSIONS.FINANCE_VIEW,
  },
  {
    text: "HR",
    icon: <GroupIcon />,
    path: "/hr",
    permission: PERMISSIONS.HR_VIEW,
  },
  {
    text: "Warehouse",
    icon: <WarehouseIcon />,
    path: "/warehouse",
    permission: PERMISSIONS.WAREHOUSE_VIEW,
  },
  {
    text: "Support",
    icon: <SupportAgentIcon />,
    path: "/support",
    permission: PERMISSIONS.SUPPORT_VIEW,
  },
  {
    text: "Reporting",
    icon: <AssessmentIcon />,
    path: "/reporting",
    permission: PERMISSIONS.REPORTING_VIEW,
  },
  {
    text: "Branches",
    icon: <BusinessIcon />,
    path: "/branches",
    permission: PERMISSIONS.BRANCH_VIEW,
  },
  {
    text: "Users",
    icon: <PersonIcon />,
    path: "/users",
    permission: PERMISSIONS.USER_VIEW,
  },
  {
    text: "Roles",
    icon: <SecurityIcon />,
    path: "/roles",
    permission: PERMISSIONS.GROUP_VIEW,
  },
];

const bottomMenuItems: MenuItem[] = [];

export default function Sidebar({
  drawerWidth,
  mobileOpen,
  onDrawerToggle,
  isMobile,
}: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);

  const handleNavigation = (path: string) => {
    navigate(path);
    if (isMobile) {
      onDrawerToggle();
    }
  };

  // Filter menu items based on user permissions
  const visibleMenuItems = menuItems.filter((item) => {
    if (!item.permission) return true; // No permission required (e.g., Dashboard)
    return hasPermission(
      user,
      item.permission.resource,
      item.permission.action
    );
  });

  const drawer = (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Toolbar sx={{ bgcolor: "primary.main", color: "white" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <AccountBalanceIcon />
          <Typography variant="h6" noWrap>
            ERP System
          </Typography>
        </Box>
      </Toolbar>
      <Divider />
      <Box sx={{ flexGrow: 1, overflow: "auto" }}>
        <List>
          {visibleMenuItems.map((item) => {
            const isActive = location.pathname.startsWith(item.path);
            return (
              <ListItem key={item.text} disablePadding>
                <ListItemButton
                  onClick={() => handleNavigation(item.path)}
                  selected={isActive}
                  sx={{
                    "&.Mui-selected": {
                      bgcolor: "primary.light",
                      color: "white",
                      "&:hover": {
                        bgcolor: "primary.main",
                      },
                      "& .MuiListItemIcon-root": {
                        color: "white",
                      },
                    },
                  }}
                >
                  <ListItemIcon sx={{ color: isActive ? "white" : "inherit" }}>
                    {item.icon}
                  </ListItemIcon>
                  <ListItemText primary={item.text} />
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
      </Box>
      <Divider />
      <List>
        {bottomMenuItems.map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          return (
            <ListItem key={item.text} disablePadding>
              <ListItemButton
                onClick={() => handleNavigation(item.path)}
                selected={isActive}
              >
                <ListItemIcon>{item.icon}</ListItemIcon>
                <ListItemText primary={item.text} />
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>
    </Box>
  );

  return (
    <Box
      component="nav"
      sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}
    >
      {isMobile ? (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={onDrawerToggle}
          ModalProps={{ keepMounted: true }}
          sx={{
            "& .MuiDrawer-paper": {
              boxSizing: "border-box",
              width: drawerWidth,
            },
          }}
        >
          {drawer}
        </Drawer>
      ) : (
        <Drawer
          variant="permanent"
          sx={{
            "& .MuiDrawer-paper": {
              boxSizing: "border-box",
              width: drawerWidth,
            },
          }}
          open
        >
          {drawer}
        </Drawer>
      )}
    </Box>
  );
}
