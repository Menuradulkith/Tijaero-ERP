import { useState, useEffect } from "react";
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
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SpeedIcon from "@mui/icons-material/Speed";
import StoreIcon from "@mui/icons-material/Store";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import LocalShippingOutlinedIcon from "@mui/icons-material/LocalShippingOutlined";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import CreditScoreIcon from "@mui/icons-material/CreditScore";
import PointOfSaleIcon from "@mui/icons-material/PointOfSale";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import CategoryIcon from "@mui/icons-material/Category";
import SellIcon from "@mui/icons-material/Sell";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/state/authStore";
import { hasPermission, PERMISSIONS } from "@/auth/permissions";

interface SidebarProps {
  drawerWidth: number;
  mobileOpen: boolean;
  onDrawerToggle: () => void;
  isMobile: boolean;
}

interface SubMenuItem {
  text: string;
  icon: JSX.Element;
  path: string;
}

interface MenuItem {
  text: string;
  icon: JSX.Element;
  path: string;
  permission?: { resource: string; action: string };
  subItems?: SubMenuItem[];
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
    subItems: [
      { text: "Dashboard", icon: <SpeedIcon />, path: "/sales/dashboard" },
      { text: "Sales Orders", icon: <PointOfSaleIcon />, path: "/sales/orders" },
      { text: "Sales Returns", icon: <AssignmentReturnIcon />, path: "/sales/returns" },
    ],
  },
  {
    text: "Purchasing",
    icon: <LocalShippingIcon />,
    path: "/purchasing",
    permission: PERMISSIONS.PURCHASING_VIEW,
    subItems: [
      { text: "Dashboard", icon: <SpeedIcon />, path: "/purchasing" },
      { text: "Suppliers", icon: <StoreIcon />, path: "/purchasing/suppliers" },
      { text: "Purchase Orders", icon: <ReceiptLongIcon />, path: "/purchasing/orders" },
      { text: "Good Received Notes", icon: <LocalShippingOutlinedIcon />, path: "/purchasing/grn" },
      { text: "Purchase Returns", icon: <AssignmentReturnIcon />, path: "/purchasing/returns" },
      { text: "Credit Settlements", icon: <CreditScoreIcon />, path: "/purchasing/settlements" },
    ],
  },
  {
    text: "Inventory",
    icon: <InventoryIcon />,
    path: "/inventory",
    permission: PERMISSIONS.INVENTORY_VIEW,
    subItems: [
      { text: "Products", icon: <Inventory2Icon />, path: "/inventory" },
      { text: "Categories", icon: <CategoryIcon />, path: "/inventory/categories" },
      { text: "Brands", icon: <SellIcon />, path: "/inventory/brands" },
    ],
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
  
  // Track which parent menu is expanded (showing sub-items)
  const [expandedMenu, setExpandedMenu] = useState<string | null>(null);

  // Auto-expand menu based on current path
  useEffect(() => {
    const currentParent = menuItems.find(
      (item) => item.subItems && location.pathname.startsWith(item.path)
    );
    if (currentParent) {
      setExpandedMenu(currentParent.text);
    }
  }, [location.pathname]);

  const handleNavigation = (path: string) => {
    navigate(path);
    if (isMobile) {
      onDrawerToggle();
    }
  };

  const handleMenuClick = (item: MenuItem) => {
    if (item.subItems && item.subItems.length > 0) {
      // If has sub-items, expand the sub-menu
      setExpandedMenu(item.text);
    } else {
      // Navigate directly
      handleNavigation(item.path);
    }
  };

  const handleBackClick = () => {
    setExpandedMenu(null);
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

  // Get current expanded menu's sub-items
  const expandedMenuItem = expandedMenu
    ? visibleMenuItems.find((item) => item.text === expandedMenu)
    : null;

  const drawer = (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Toolbar sx={{ bgcolor: "primary.main", color: "white", minHeight: { xs: 48, sm: 56 } }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <AccountBalanceIcon fontSize="small" />
          <Typography variant="subtitle1" fontWeight={600} noWrap>
            ERP System
          </Typography>
        </Box>
      </Toolbar>
      <Divider />
      <Box sx={{ flexGrow: 1, overflow: "auto" }}>
        {/* Show sub-menu if expanded, otherwise show main menu */}
        {expandedMenuItem && expandedMenuItem.subItems ? (
          <List>
            {/* Back button / Header */}
            <ListItem disablePadding>
              <ListItemButton
                onClick={handleBackClick}
                sx={{
                  py: 0.75,
                  bgcolor: "grey.100",
                  "&:hover": {
                    bgcolor: "grey.200",
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <ArrowBackIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={expandedMenuItem.text}
                  primaryTypographyProps={{
                    fontWeight: 600,
                    fontSize: "0.875rem",
                  }}
                />
              </ListItemButton>
            </ListItem>
            <Divider />
            {/* Sub-items */}
            {expandedMenuItem.subItems.map((subItem) => {
              const isModuleRoot = subItem.path === expandedMenuItem.path;
              const isActive = isModuleRoot
                ? location.pathname === subItem.path
                : location.pathname.startsWith(subItem.path);
              
              return (
                <ListItem key={subItem.path} disablePadding>
                  <ListItemButton
                    onClick={() => handleNavigation(subItem.path)}
                    selected={isActive}
                    sx={{
                      py: 0.75,
                      pl: 2,
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
                    <ListItemIcon
                      sx={{
                        color: isActive ? "white" : "inherit",
                        minWidth: 32,
                      }}
                    >
                      {subItem.icon}
                    </ListItemIcon>
                    <ListItemText 
                      primary={subItem.text}
                      primaryTypographyProps={{ fontSize: "0.875rem" }}
                    />
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        ) : (
          <List>
            {visibleMenuItems.map((item) => {
              const isActive = location.pathname.startsWith(item.path);
              const hasSubItems = item.subItems && item.subItems.length > 0;
              return (
                <ListItem key={item.text} disablePadding>
                  <ListItemButton
                    onClick={() => handleMenuClick(item)}
                    selected={isActive}
                    sx={{
                      py: 0.75,
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
                    <ListItemIcon sx={{ color: isActive ? "white" : "inherit", minWidth: 32 }}>
                      {item.icon}
                    </ListItemIcon>
                    <ListItemText 
                      primary={item.text}
                      primaryTypographyProps={{ fontSize: "0.875rem" }}
                    />
                    {hasSubItems && (
                      <Typography variant="body2" color="text.secondary" sx={{ color: isActive ? "white" : "inherit" }}>
                        ›
                      </Typography>
                    )}
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        )}
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
