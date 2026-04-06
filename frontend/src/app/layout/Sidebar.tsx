import { TConfirmDialog, useConfirmDialog } from "@/components/tijaero";
import { hasPermission, hasAnyModuleAccess, PERMISSIONS } from "@/auth/permissions";
import { useAuthStore } from "@/state/authStore";
import { useFormGuardStore } from "@/state/formGuardStore";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import AssessmentIcon from "@mui/icons-material/Assessment";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import BalanceIcon from "@mui/icons-material/Balance";
import BookIcon from "@mui/icons-material/Book";
import BusinessIcon from "@mui/icons-material/Business";
import BusinessCenterIcon from "@mui/icons-material/BusinessCenter";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import CategoryIcon from "@mui/icons-material/Category";
import DashboardIcon from "@mui/icons-material/Dashboard";
import ExpandLess from "@mui/icons-material/ExpandLess";
import ExpandMore from "@mui/icons-material/ExpandMore";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import GroupIcon from "@mui/icons-material/Group";
import InventoryIcon from "@mui/icons-material/Inventory";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import LocalShippingOutlinedIcon from "@mui/icons-material/LocalShippingOutlined";
import MonetizationOnIcon from "@mui/icons-material/MonetizationOn";
import PaymentIcon from "@mui/icons-material/Payment";
import PeopleIcon from "@mui/icons-material/People";
import PersonIcon from "@mui/icons-material/Person";
import PointOfSaleIcon from "@mui/icons-material/PointOfSale";
import ReceiptIcon from "@mui/icons-material/Receipt";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import SecurityIcon from "@mui/icons-material/Security";
import SellIcon from "@mui/icons-material/Sell";
import SettingsIcon from "@mui/icons-material/Settings";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import SpeedIcon from "@mui/icons-material/Speed";
import StoreIcon from "@mui/icons-material/Store";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import WarehouseIcon from "@mui/icons-material/Warehouse";
import {
    Box,
    Collapse,
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
  subItems?: SubMenuItem[];
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
      {
        text: "Quotations",
        icon: <ReceiptLongIcon />,
        path: "/sales/quotations",
      },
      {
        text: "Proforma Invoices",
        icon: <ReceiptLongIcon />,
        path: "/sales/proforma",
      },
      {
        text: "Sales Orders",
        icon: <PointOfSaleIcon />,
        path: "/sales/orders",
      },
      {
        text: "Approvals",
        icon: <FactCheckIcon />,
        path: "/sales/approvals",
        subItems: [
          {
            text: "SO Approvals",
            icon: <FactCheckIcon />,
            path: "/sales/approvals/so-approvals",
          },
          {
            text: "Return Approvals",
            icon: <FactCheckIcon />,
            path: "/sales/approvals/return-approvals",
          },
          {
            text: "Commission Approvals",
            icon: <FactCheckIcon />,
            path: "/sales/approvals/commission-approvals",
          },
        ],
      },
      {
        text: "Sales Returns",
        icon: <AssignmentReturnIcon />,
        path: "/sales/returns",
      },
      { text: "Coupons", icon: <LocalOfferIcon />, path: "/sales/coupons" },
      { text: "Gift Vouchers", icon: <ReceiptIcon />, path: "/sales/vouchers" },
      {
        text: "Agent Commissions",
        icon: <MonetizationOnIcon />,
        path: "/sales/agent-commissions",
      },
      { text: "Settings", icon: <SettingsIcon />, path: "/sales/settings" },
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
      {
        text: "Purchase Orders",
        icon: <ReceiptLongIcon />,
        path: "/purchasing/orders",
      },
      {
        text: "Approvals",
        icon: <FactCheckIcon />,
        path: "/purchasing/approvals",
        subItems: [
          {
            text: "PO Approvals",
            icon: <FactCheckIcon />,
            path: "/purchasing/approvals/po-approvals",
          },
          {
            text: "Return Approvals",
            icon: <FactCheckIcon />,
            path: "/purchasing/approvals/return-approvals",
          },
        ],
      },
      {
        text: "Good Received Notes",
        icon: <LocalShippingOutlinedIcon />,
        path: "/purchasing/grn",
      },
      {
        text: "Purchase Returns",
        icon: <AssignmentReturnIcon />,
        path: "/purchasing/returns",
      },
    ],
  },
  {
    text: "Inventory",
    icon: <InventoryIcon />,
    path: "/inventory",
    permission: PERMISSIONS.INVENTORY_VIEW,
    subItems: [
      { text: "Products", icon: <Inventory2Icon />, path: "/inventory" },
      {
        text: "Categories",
        icon: <CategoryIcon />,
        path: "/inventory/categories",
      },
      { text: "Brands", icon: <SellIcon />, path: "/inventory/brands" },
    ],
  },
  {
    text: "Finance",
    icon: <AccountBalanceIcon />,
    path: "/finance",
    permission: PERMISSIONS.FINANCE_VIEW,
    subItems: [
      { text: "Dashboard", icon: <SpeedIcon />, path: "/finance" },
      {
        text: "Cashbook",
        icon: <AccountBalanceWalletIcon />,
        path: "/finance/cashbook",
      },
      {
        text: "Expenses",
        icon: <ReceiptLongIcon />,
        path: "/finance/expenses",
      },
      {
        text: "Payment Methods",
        icon: <PaymentIcon />,
        path: "/finance/payment-methods",
        subItems: [
          {
            text: "Bank Deposits",
            icon: <AccountBalanceIcon />,
            path: "/finance/payment-methods/bank-deposits",
          },
          {
            text: "Card Payments",
            icon: <PaymentIcon />,
            path: "/finance/payment-methods/card-payments",
          },
          {
            text: "Cheque Payments",
            icon: <ReceiptIcon />,
            path: "/finance/payment-methods/cheque-payments",
          },
          {
            text: "Credit Notes",
            icon: <ReceiptIcon />,
            path: "/finance/payment-methods/credit-notes",
          },
        ],
      },
      {
        text: "Advance Payments",
        icon: <PaymentIcon />,
        path: "/finance/advance-payments",
        subItems: [
          {
            text: "Customer Advances",
            icon: <PaymentIcon />,
            path: "/finance/advance-payments/customer",
          },
          {
            text: "Supplier Advances",
            icon: <PaymentIcon />,
            path: "/finance/advance-payments/supplier",
          },
        ],
      },
      {
        text: "Supplier Payments",
        icon: <PaymentIcon />,
        path: "/finance/supplier-payments",
      },
      {
        text: "Customer Payments",
        icon: <PaymentIcon />,
        path: "/finance/customer-payments",
      },
      {
        text: "Accounting",
        icon: <BookIcon />,
        path: "/finance/chart-of-accounts",
        subItems: [
          {
            text: "Chart of Accounts",
            icon: <AccountTreeIcon />,
            path: "/finance/chart-of-accounts",
          },
          {
            text: "Journal Entries",
            icon: <ReceiptLongIcon />,
            path: "/finance/journal-entries",
          },
          {
            text: "General Ledger",
            icon: <BalanceIcon />,
            path: "/finance/general-ledger",
          },
          {
            text: "Accounting Periods",
            icon: <CalendarMonthIcon />,
            path: "/finance/accounting-periods",
          },
          {
            text: "Cash Flow",
            icon: <TrendingUpIcon />,
            path: "/finance/cash-flow",
          },
        ],
      },
      {
        text: "Approvals",
        icon: <FactCheckIcon />,
        path: "/finance/approvals",
        subItems: [
          {
            text: "Payment Approvals",
            icon: <FactCheckIcon />,
            path: "/finance/approvals/payment-approvals",
          },
          {
            text: "Expense Approvals",
            icon: <FactCheckIcon />,
            path: "/finance/approvals/expense-approvals",
          },
          {
            text: "Bank Transfer Verify",
            icon: <AccountBalanceIcon />,
            path: "/finance/approvals/bank-transfer-verify",
          },
          {
            text: "Commission Payment Approvals",
            icon: <FactCheckIcon />,
            path: "/finance/approvals/commission-payment-approvals",
          },
        ],
      },
      {
        text: "Commission Payments",
        icon: <PaymentIcon />,
        path: "/finance/commission-payments",
      },
    ],
  },
  {
    text: "HR",
    icon: <GroupIcon />,
    path: "/hr",
    permission: PERMISSIONS.HR_VIEW,
    subItems: [
      { text: "Dashboard", icon: <SpeedIcon />, path: "/hr" },
      {
        text: "Salary Profiles",
        icon: <PersonIcon />,
        path: "/hr/salary-profiles",
      },
      { text: "Deductions", icon: <ReceiptIcon />, path: "/hr/deductions" },
      {
        text: "Payroll Records",
        icon: <ReceiptLongIcon />,
        path: "/hr/payroll",
      },
      {
        text: "Payroll Processing",
        icon: <PaymentIcon />,
        path: "/hr/payroll-processing",
      },
      {
        text: "Sales Commissions",
        icon: <SellIcon />,
        path: "/hr/sales-commissions",
      },
      {
        text: "Reimbursements",
        icon: <AccountBalanceWalletIcon />,
        path: "/hr/reimbursements",
      },
      { text: "Promotions", icon: <SellIcon />, path: "/hr/promotions" },
      { text: "Assets", icon: <Inventory2Icon />, path: "/hr/assets" },
    ],
  },
  {
    text: "Sales Stock",
    icon: <WarehouseIcon />,
    path: "/warehouse",
    permission: PERMISSIONS.WAREHOUSE_VIEW,
    subItems: [
      { text: "Dashboard", icon: <SpeedIcon />, path: "/warehouse" },
      {
        text: "Sales Track",
        icon: <ReceiptLongIcon />,
        path: "/warehouse/sales-track",
      },
      {
        text: "Item Transfer Notes",
        icon: <SwapHorizIcon />,
        path: "/warehouse/item-transfer-notes",
      },
      {
        text: "ITN Approvals",
        icon: <FactCheckIcon />,
        path: "/warehouse/itn-approvals",
      },
      {
        text: "Receive Notes",
        icon: <InventoryIcon />,
        path: "/warehouse/receive-notes",
      },
    ],
  },
  {
    text: "Company Assets",
    icon: <BusinessCenterIcon />,
    path: "/warehouse/company-assets",
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
  {
    text: "Settings",
    icon: <SettingsIcon />,
    path: "/company-settings",
    permission: PERMISSIONS.SETTINGS_VIEW,
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

  // Track which menus are expanded (showing sub-items inline)
  const [expandedMenus, setExpandedMenus] = useState<Set<string>>(new Set());

  // Auto-expand menu based on current path
  useEffect(() => {
    const newExpanded = new Set<string>();
    for (const item of menuItems) {
      if (item.subItems) {
        const isInPath =
          location.pathname.startsWith(item.path) ||
          item.subItems.some(
            (sub) =>
              location.pathname.startsWith(sub.path) ||
              sub.subItems?.some((child) =>
                location.pathname.startsWith(child.path),
              ),
          );
        if (isInPath) {
          newExpanded.add(item.text);
          // Also expand nested sub-menus
          for (const sub of item.subItems) {
            if (sub.subItems) {
              const isNestedActive =
                location.pathname.startsWith(sub.path) ||
                sub.subItems.some((child) =>
                  location.pathname.startsWith(child.path),
                );
              if (isNestedActive) {
                newExpanded.add(sub.text);
              }
            }
          }
        }
      }
    }
    setExpandedMenus(newExpanded);
  }, [location.pathname]);

  const isDirty = useFormGuardStore((s) => s.isDirty);
  const executeDiscard = useFormGuardStore((s) => s.executeDiscard);
  const discardDialog = useConfirmDialog();

  const handleNavigation = async (path: string) => {
    // Skip guard if navigating to the same page
    if (location.pathname === path) return;

    if (isDirty) {
      const confirmed = await discardDialog.confirm({
        title: "Discard Changes",
        message: "You have unsaved changes. Discard them?",
        confirmText: "Discard",
        cancelText: "Keep Editing",
        type: "warning",
        confirmColor: "warning",
      });
      if (!confirmed) return;
      executeDiscard();
    }

    navigate(path);
    if (isMobile) {
      onDrawerToggle();
    }
  };

  const toggleMenu = (menuText: string) => {
    setExpandedMenus((prev) => {
      const next = new Set(prev);
      if (next.has(menuText)) {
        next.delete(menuText);
      } else {
        next.add(menuText);
      }
      return next;
    });
  };

  const handleMenuClick = (item: MenuItem) => {
    if (item.subItems && item.subItems.length > 0) {
      toggleMenu(item.text);
    } else {
      handleNavigation(item.path);
    }
  };

  const handleSubMenuClick = (subItem: SubMenuItem) => {
    if (subItem.subItems && subItem.subItems.length > 0) {
      toggleMenu(subItem.text);
    } else {
      handleNavigation(subItem.path);
    }
  };

  // Filter menu items based on user permissions
  const visibleMenuItems = menuItems.filter((item) => {
    // Dashboard: only show if user has access to at least one module
    if (item.path === "/dashboard") {
      return hasAnyModuleAccess(user);
    }
    if (!item.permission) return true;
    return hasPermission(
      user,
      item.permission.resource,
      item.permission.action,
    );
  });

  const drawer = (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Toolbar
        sx={{
          bgcolor: "primary.main",
          color: "white",
          minHeight: "var(--header-height)",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <AccountBalanceIcon fontSize="small" />
          <Typography variant="subtitle1" fontWeight={600} noWrap>
            TijaeroERP
          </Typography>
        </Box>
      </Toolbar>
      <Divider />
      <Box sx={{ flexGrow: 1, overflow: "auto" }}>
        <List disablePadding>
          {visibleMenuItems.map((item) => {
            const isActive =
              location.pathname === item.path ||
              (!item.subItems && location.pathname.startsWith(item.path));
            const hasSubItems = item.subItems && item.subItems.length > 0;
            const isExpanded = expandedMenus.has(item.text);
            const isParentActive = item.subItems?.some(
              (sub) =>
                location.pathname.startsWith(sub.path) ||
                sub.subItems?.some((child) =>
                  location.pathname.startsWith(child.path),
                ),
            );

            return (
              <Box key={item.text}>
                <ListItem disablePadding>
                  <ListItemButton
                    onClick={() => handleMenuClick(item)}
                    selected={isActive || (isParentActive && !isExpanded)}
                    sx={{
                      py: 0.75,
                      "&.Mui-selected": {
                        bgcolor: "primary.light",
                        color: "white",
                        "&:hover": { bgcolor: "primary.main" },
                        "& .MuiListItemIcon-root": { color: "white" },
                      },
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        color:
                          isActive || (isParentActive && !isExpanded)
                            ? "white"
                            : "inherit",
                        minWidth: 32,
                      }}
                    >
                      {item.icon}
                    </ListItemIcon>
                    <ListItemText
                      primary={item.text}
                      primaryTypographyProps={{ fontSize: "0.85rem" }}
                    />
                    {hasSubItems &&
                      (isExpanded ? (
                        <ExpandLess fontSize="small" />
                      ) : (
                        <ExpandMore fontSize="small" />
                      ))}
                  </ListItemButton>
                </ListItem>

                {/* Inline sub-items */}
                {hasSubItems && (
                  <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                    <List disablePadding>
                      {item.subItems!.map((subItem) => {
                        const isSubActive = subItem.subItems
                          ? false
                          : location.pathname.startsWith(subItem.path) &&
                            (subItem.path === item.path
                              ? location.pathname === subItem.path
                              : true);
                        const hasNestedSubItems =
                          subItem.subItems && subItem.subItems.length > 0;
                        const isNestedExpanded = expandedMenus.has(
                          subItem.text,
                        );
                        const isNestedParentActive = subItem.subItems?.some(
                          (child) => location.pathname.startsWith(child.path),
                        );

                        return (
                          <Box key={subItem.path}>
                            <ListItem disablePadding>
                              <ListItemButton
                                onClick={() => handleSubMenuClick(subItem)}
                                selected={
                                  isSubActive ||
                                  (isNestedParentActive && !isNestedExpanded)
                                }
                                sx={{
                                  py: 0.5,
                                  pl: 4,
                                  "&.Mui-selected": {
                                    bgcolor: "primary.light",
                                    color: "white",
                                    "&:hover": { bgcolor: "primary.main" },
                                    "& .MuiListItemIcon-root": {
                                      color: "white",
                                    },
                                  },
                                }}
                              >
                                <ListItemIcon
                                  sx={{
                                    color:
                                      isSubActive ||
                                      (isNestedParentActive &&
                                        !isNestedExpanded)
                                        ? "white"
                                        : "text.secondary",
                                    minWidth: 28,
                                    "& .MuiSvgIcon-root": {
                                      fontSize: "1.1rem",
                                    },
                                  }}
                                >
                                  {subItem.icon}
                                </ListItemIcon>
                                <ListItemText
                                  primary={subItem.text}
                                  primaryTypographyProps={{
                                    fontSize: "0.8rem",
                                  }}
                                />
                                {hasNestedSubItems &&
                                  (isNestedExpanded ? (
                                    <ExpandLess sx={{ fontSize: "1rem" }} />
                                  ) : (
                                    <ExpandMore sx={{ fontSize: "1rem" }} />
                                  ))}
                              </ListItemButton>
                            </ListItem>

                            {/* Nested sub-items (3rd level) */}
                            {hasNestedSubItems && (
                              <Collapse
                                in={isNestedExpanded}
                                timeout="auto"
                                unmountOnExit
                              >
                                <List disablePadding>
                                  {subItem.subItems!.map((nestedItem) => {
                                    const isNestedActive =
                                      location.pathname.startsWith(
                                        nestedItem.path,
                                      );
                                    return (
                                      <ListItem
                                        key={nestedItem.path}
                                        disablePadding
                                      >
                                        <ListItemButton
                                          onClick={() =>
                                            handleNavigation(nestedItem.path)
                                          }
                                          selected={isNestedActive}
                                          sx={{
                                            py: 0.4,
                                            pl: 6,
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
                                              color: isNestedActive
                                                ? "white"
                                                : "text.secondary",
                                              minWidth: 24,
                                              "& .MuiSvgIcon-root": {
                                                fontSize: "0.95rem",
                                              },
                                            }}
                                          >
                                            {nestedItem.icon}
                                          </ListItemIcon>
                                          <ListItemText
                                            primary={nestedItem.text}
                                            primaryTypographyProps={{
                                              fontSize: "0.78rem",
                                            }}
                                          />
                                        </ListItemButton>
                                      </ListItem>
                                    );
                                  })}
                                </List>
                              </Collapse>
                            )}
                          </Box>
                        );
                      })}
                    </List>
                  </Collapse>
                )}
              </Box>
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
        height: "100dvh",
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
      <TConfirmDialog {...discardDialog.dialogProps} />
    </Box>
  );
}
