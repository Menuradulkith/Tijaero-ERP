import { hasPermission, PERMISSIONS } from "@/auth/permissions";
import { useAuthStore } from "@/state/authStore";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AssessmentIcon from "@mui/icons-material/Assessment";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import BusinessIcon from "@mui/icons-material/Business";
import CategoryIcon from "@mui/icons-material/Category";
import DashboardIcon from "@mui/icons-material/Dashboard";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import GroupIcon from "@mui/icons-material/Group";
import InventoryIcon from "@mui/icons-material/Inventory";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import LocalShippingOutlinedIcon from "@mui/icons-material/LocalShippingOutlined";
import PaymentIcon from "@mui/icons-material/Payment";
import PeopleIcon from "@mui/icons-material/People";
import PersonIcon from "@mui/icons-material/Person";
import PointOfSaleIcon from "@mui/icons-material/PointOfSale";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import SecurityIcon from "@mui/icons-material/Security";
import SellIcon from "@mui/icons-material/Sell";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import SpeedIcon from "@mui/icons-material/Speed";
import StoreIcon from "@mui/icons-material/Store";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import WarehouseIcon from "@mui/icons-material/Warehouse";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import {
    Box,
    Divider,
    Drawer,
    List,
    ListItem,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Toolbar,
    Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

interface SidebarProps {
  drawerWidth: number;
  mobileOpen: boolean;
  onDrawerToggle: () => void;
  isMobile: boolean;
  iconNavWidth?: number;
  collapsed?: boolean;
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
    text: "Sales",
    icon: <ShoppingCartIcon />,
    path: "/sales",
    permission: PERMISSIONS.SALES_VIEW,
    subItems: [
      { text: "Dashboard", icon: <SpeedIcon />, path: "/sales/dashboard" },
      { text: "Customers", icon: <PeopleIcon />, path: "/sales/customers" },
      { text: "Quotations", icon: <ReceiptLongIcon />, path: "/sales/quotations" },
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
      { text: "PO Approvals", icon: <FactCheckIcon />, path: "/purchasing/approvals" },
      { text: "Good Received Notes", icon: <LocalShippingOutlinedIcon />, path: "/purchasing/grn" },
      { text: "Purchase Returns", icon: <AssignmentReturnIcon />, path: "/purchasing/returns" },
      { text: "Return Approvals", icon: <FactCheckIcon />, path: "/purchasing/return-approvals" },
      { text: "Supplier Payments", icon: <PaymentIcon />, path: "/purchasing/payments" },
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
    text: "Sales Stock",
    icon: <WarehouseIcon />,
    path: "/warehouse",
    permission: PERMISSIONS.WAREHOUSE_VIEW,
    subItems: [
      { text: "Dashboard", icon: <SpeedIcon />, path: "/warehouse" },
      { text: "Sales Track", icon: <ReceiptLongIcon />, path: "/warehouse/sales-track" },
      { text: "Item Transfer Notes", icon: <SwapHorizIcon />, path: "/warehouse/item-transfer-notes" },
      { text: "ITN Approvals", icon: <FactCheckIcon />, path: "/warehouse/itn-approvals" },
      { text: "Receive Notes", icon: <InventoryIcon />, path: "/warehouse/receive-notes" },
    ],
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
  iconNavWidth = 0,
  collapsed = false,
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
            TijaeroERP
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

  // Don't render on desktop when collapsed
  if (!isMobile && collapsed) {
    return null;
  }

  return (
    <Box
      component="nav"
      sx={{
        width: { md: drawerWidth },
        flexShrink: { md: 0 },
        position: "fixed",
        left: iconNavWidth,
        top: 0,
        height: "100vh",
        zIndex: 1200,
      }}
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
              left: iconNavWidth,
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
              left: iconNavWidth,
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
