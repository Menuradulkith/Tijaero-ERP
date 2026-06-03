import {
  hasAnyModuleAccess,
  hasPermission,
  PERMISSIONS,
} from "@/auth/permissions";
import { TConfirmDialog, useConfirmDialog } from "@/components/tijaero";
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
  permission?: { resource: string; action: string };
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
  { text: "Dashboard", icon: <DashboardIcon />, path: "/dashboard", permission: PERMISSIONS.DASHBOARD_VIEW },
  {
    text: "Sales",
    icon: <ShoppingCartIcon />,
    path: "/sales",
    permission: PERMISSIONS.SALES_DASHBOARD_VIEW,
    subItems: [
      { text: "Dashboard", icon: <SpeedIcon />, path: "/sales/dashboard", permission: PERMISSIONS.SALES_DASHBOARD_VIEW },
      { text: "Customers", icon: <PeopleIcon />, path: "/sales/customers", permission: PERMISSIONS.CUSTOMERS_VIEW },
      {
        text: "Quotations",
        icon: <ReceiptLongIcon />,
        path: "/sales/quotations",
        permission: PERMISSIONS.QUOTATIONS_VIEW,
      },
      {
        text: "Proforma Invoices",
        icon: <ReceiptLongIcon />,
        path: "/sales/proforma",
        permission: PERMISSIONS.PROFORMA_INVOICES_VIEW,
      },
      {
        text: "Sales Orders",
        icon: <PointOfSaleIcon />,
        path: "/sales/orders",
        permission: PERMISSIONS.SALES_ORDERS_VIEW,
      },
      {
        text: "Approvals",
        icon: <FactCheckIcon />,
        path: "/sales/approvals",
        subItems: [
          {
            text: "Credit SO Approvals",
            icon: <FactCheckIcon />,
            path: "/sales/approvals/so-approvals",
            permission: PERMISSIONS.SO_APPROVALS_VIEW,
          },
          {
            text: "Return Approvals",
            icon: <FactCheckIcon />,
            path: "/sales/approvals/return-approvals",
            permission: PERMISSIONS.SALES_RETURN_APPROVALS_VIEW,
          },
          {
            text: "Commission Approvals",
            icon: <FactCheckIcon />,
            path: "/sales/approvals/commission-approvals",
            permission: PERMISSIONS.COMMISSION_APPROVALS_VIEW,
          },
        ],
      },
      {
        text: "Sales Returns",
        icon: <AssignmentReturnIcon />,
        path: "/sales/returns",
        permission: PERMISSIONS.SALES_RETURNS_VIEW,
      },
      { text: "Coupons", icon: <LocalOfferIcon />, path: "/sales/coupons", permission: PERMISSIONS.COUPONS_VIEW },
      { text: "Gift Vouchers", icon: <ReceiptIcon />, path: "/sales/vouchers", permission: PERMISSIONS.GIFT_VOUCHERS_VIEW },
      {
        text: "Agent Commissions",
        icon: <MonetizationOnIcon />,
        path: "/sales/agent-commissions",
        permission: PERMISSIONS.AGENT_COMMISSIONS_VIEW,
      },
    ],
  },
  {
    text: "Purchasing",
    icon: <LocalShippingIcon />,
    path: "/purchasing",
    permission: PERMISSIONS.PURCHASING_DASHBOARD_VIEW,
    subItems: [
      { text: "Dashboard", icon: <SpeedIcon />, path: "/purchasing", permission: PERMISSIONS.PURCHASING_DASHBOARD_VIEW },
      { text: "Suppliers", icon: <StoreIcon />, path: "/purchasing/suppliers", permission: PERMISSIONS.SUPPLIERS_VIEW },
      {
        text: "Purchase Orders",
        icon: <ReceiptLongIcon />,
        path: "/purchasing/orders",
        permission: PERMISSIONS.PURCHASE_ORDERS_VIEW,
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
            permission: PERMISSIONS.PO_APPROVALS_VIEW,
          },
          {
            text: "Return Approvals",
            icon: <FactCheckIcon />,
            path: "/purchasing/approvals/return-approvals",
            permission: PERMISSIONS.PURCHASE_RETURN_APPROVALS_VIEW,
          },
        ],
      },
      {
        text: "Good Received Notes",
        icon: <LocalShippingOutlinedIcon />,
        path: "/purchasing/grn",
        permission: PERMISSIONS.GRN_VIEW,
      },
      {
        text: "Supplier Voucher Payment",
        icon: <ReceiptLongIcon />,
        path: "/purchasing/invoices",
        permission: PERMISSIONS.PURCHASE_ORDERS_VIEW,
      },
      {
        text: "Purchase Returns",
        icon: <AssignmentReturnIcon />,
        path: "/purchasing/returns",
        permission: PERMISSIONS.PURCHASE_RETURNS_VIEW,
      },
    ],
  },
  {
    text: "Product Catalogs",
    icon: <InventoryIcon />,
    path: "/product-catalogs",
    permission: PERMISSIONS.PRODUCTS_VIEW,
    subItems: [
      { text: "Products", icon: <Inventory2Icon />, path: "/product-catalogs", permission: PERMISSIONS.PRODUCTS_VIEW },
      {
        text: "Categories",
        icon: <CategoryIcon />,
        path: "/product-catalogs/categories",
        permission: PERMISSIONS.CATEGORIES_VIEW,
      },
      { text: "Brands", icon: <SellIcon />, path: "/product-catalogs/brands", permission: PERMISSIONS.BRANDS_VIEW },
    ],
  },
  {
    text: "Finance",
    icon: <AccountBalanceIcon />,
    path: "/finance",
    permission: PERMISSIONS.FINANCE_DASHBOARD_VIEW,
    subItems: [
      { text: "Dashboard", icon: <SpeedIcon />, path: "/finance", permission: PERMISSIONS.FINANCE_DASHBOARD_VIEW },
      {
        text: "Cashbook",
        icon: <AccountBalanceWalletIcon />,
        path: "/finance/cashbook",
        permission: PERMISSIONS.CASHBOOK_VIEW,
      },
      {
        text: "Expenses",
        icon: <ReceiptLongIcon />,
        path: "/finance/expenses",
        permission: PERMISSIONS.EXPENSES_VIEW,
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
            permission: PERMISSIONS.BANK_DEPOSITS_VIEW,
          },
          {
            text: "Card Payments",
            icon: <PaymentIcon />,
            path: "/finance/payment-methods/card-payments",
            permission: PERMISSIONS.CARD_PAYMENTS_VIEW,
          },
          {
            text: "Cheque Payments",
            icon: <ReceiptIcon />,
            path: "/finance/payment-methods/cheque-payments",
            permission: PERMISSIONS.CHEQUE_PAYMENTS_VIEW,
          },
          {
            text: "Credit Notes",
            icon: <ReceiptIcon />,
            path: "/finance/payment-methods/credit-notes",
            permission: PERMISSIONS.CREDIT_NOTES_VIEW,
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
            permission: PERMISSIONS.CUSTOMER_ADVANCES_VIEW,
          },
          {
            text: "Supplier Advances",
            icon: <PaymentIcon />,
            path: "/finance/advance-payments/supplier",
            permission: PERMISSIONS.SUPPLIER_ADVANCES_VIEW,
          },
        ],
      },
      {
        text: "Supplier Payments",
        icon: <PaymentIcon />,
        path: "/finance/supplier-payments",
        permission: PERMISSIONS.SUPPLIER_PAYMENTS_VIEW,
      },
      {
        text: "Customer Payments",
        icon: <PaymentIcon />,
        path: "/finance/customer-payments",
        permission: PERMISSIONS.CUSTOMER_PAYMENTS_VIEW,
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
            permission: PERMISSIONS.CHART_OF_ACCOUNTS_VIEW,
          },
          {
            text: "Journal Entries",
            icon: <ReceiptLongIcon />,
            path: "/finance/journal-entries",
            permission: PERMISSIONS.JOURNAL_ENTRIES_VIEW,
          },
          {
            text: "General Ledger",
            icon: <BalanceIcon />,
            path: "/finance/general-ledger",
            permission: PERMISSIONS.GENERAL_LEDGER_VIEW,
          },
          {
            text: "Accounting Periods",
            icon: <CalendarMonthIcon />,
            path: "/finance/accounting-periods",
            permission: PERMISSIONS.ACCOUNTING_PERIODS_VIEW,
          },
          {
            text: "Cash Flow",
            icon: <TrendingUpIcon />,
            path: "/finance/cash-flow",
            permission: PERMISSIONS.CASH_FLOW_VIEW,
          },
          {
            text: "Income Statement",
            icon: <AssessmentIcon />,
            path: "/finance/income-statement",
            permission: PERMISSIONS.GENERAL_LEDGER_VIEW,
          },
          {
            text: "Balance Sheet",
            icon: <BalanceIcon />,
            path: "/finance/balance-sheet",
            permission: PERMISSIONS.GENERAL_LEDGER_VIEW,
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
            permission: PERMISSIONS.PAYMENT_APPROVALS_VIEW,
          },
          {
            text: "Expense Approvals",
            icon: <FactCheckIcon />,
            path: "/finance/approvals/expense-approvals",
            permission: PERMISSIONS.EXPENSE_APPROVALS_VIEW,
          },
          {
            text: "Bank Transfer Verify",
            icon: <AccountBalanceIcon />,
            path: "/finance/approvals/bank-transfer-verify",
            permission: PERMISSIONS.BANK_TRANSFER_VERIFY_VIEW,
          },
          {
            text: "Commission Payment Approvals",
            icon: <FactCheckIcon />,
            path: "/finance/approvals/commission-payment-approvals",
            permission: PERMISSIONS.COMMISSION_PAYMENT_APPROVALS_VIEW,
          },
        ],
      },
      {
        text: "Commission Payments",
        icon: <PaymentIcon />,
        path: "/finance/commission-payments",
        permission: PERMISSIONS.COMMISSION_PAYMENTS_VIEW,
      },
    ],
  },
  {
    text: "HR",
    icon: <GroupIcon />,
    path: "/hr",
    permission: PERMISSIONS.HR_DASHBOARD_VIEW,
    subItems: [
      { text: "Dashboard", icon: <SpeedIcon />, path: "/hr", permission: PERMISSIONS.HR_DASHBOARD_VIEW },
      {
        text: "Employees",
        icon: <PersonIcon />,
        path: "/hr/employees",
        permission: PERMISSIONS.EMPLOYEES_VIEW,
      },
      {
        text: "Attendance",
        icon: <ReceiptLongIcon />,
        path: "/hr/attendance",
        permission: PERMISSIONS.ATTENDANCE_VIEW,
      },
      {
        text: "Leaves",
        icon: <ReceiptIcon />,
        path: "/hr/leaves",
        permission: PERMISSIONS.LEAVES_VIEW,
      },
      {
        text: "Leave Approvals",
        icon: <FactCheckIcon />,
        path: "/hr/leave-approvals",
        permission: PERMISSIONS.LEAVE_APPROVALS_VIEW,
      },
      {
        text: "Salary Profiles",
        icon: <PersonIcon />,
        path: "/hr/salary-profiles",
        permission: PERMISSIONS.SALARY_PROFILES_VIEW,
      },
      { text: "Deductions", icon: <ReceiptIcon />, path: "/hr/deductions", permission: PERMISSIONS.DEDUCTIONS_VIEW },
      {
        text: "Payroll Records",
        icon: <ReceiptLongIcon />,
        path: "/hr/payroll",
        permission: PERMISSIONS.PAYROLL_VIEW,
      },
      {
        text: "Payroll Processing",
        icon: <PaymentIcon />,
        path: "/hr/payroll-processing",
        permission: PERMISSIONS.PAYROLL_PROCESSING_VIEW,
      },
      {
        text: "Sales Commissions",
        icon: <SellIcon />,
        path: "/hr/sales-commissions",
        permission: PERMISSIONS.HR_SALES_COMMISSIONS_VIEW,
      },
      {
        text: "Reimbursements",
        icon: <AccountBalanceWalletIcon />,
        path: "/hr/reimbursements",
        permission: PERMISSIONS.REIMBURSEMENTS_VIEW,
      },
      { text: "Promotions", icon: <SellIcon />, path: "/hr/promotions", permission: PERMISSIONS.PROMOTIONS_VIEW },
      { text: "Assets", icon: <Inventory2Icon />, path: "/hr/assets", permission: PERMISSIONS.HR_ASSETS_VIEW },
    ],
  },
  {
    text: "Sales Stock",
    icon: <WarehouseIcon />,
    path: "/warehouse",
    permission: PERMISSIONS.SALES_STOCK_VIEW,
    subItems: [
      { text: "Dashboard", icon: <SpeedIcon />, path: "/warehouse", permission: PERMISSIONS.SALES_STOCK_VIEW },
      {
        text: "Sales Track",
        icon: <ReceiptLongIcon />,
        path: "/warehouse/sales-track",
        permission: PERMISSIONS.WAREHOUSE_SALES_TRACK_VIEW,
      },
      {
        text: "Item Transfer Notes",
        icon: <SwapHorizIcon />,
        path: "/warehouse/item-transfer-notes",
        permission: PERMISSIONS.ITN_VIEW,
      },
      {
        text: "ITN Approvals",
        icon: <FactCheckIcon />,
        path: "/warehouse/itn-approvals",
        permission: PERMISSIONS.ITN_APPROVALS_VIEW,
      },
      {
        text: "Receive Notes",
        icon: <InventoryIcon />,
        path: "/warehouse/receive-notes",
        permission: PERMISSIONS.RECEIVE_NOTES_VIEW,
      },
    ],
  },
  {
    text: "Company Assets",
    icon: <BusinessCenterIcon />,
    path: "/warehouse/company-assets",
    permission: PERMISSIONS.COMPANY_ASSETS_VIEW,
  },
  {
    text: "Support",
    icon: <SupportAgentIcon />,
    path: "/support",
    permission: PERMISSIONS.SUPPORT_DASHBOARD_VIEW,
  },
  {
    text: "Reporting",
    icon: <AssessmentIcon />,
    path: "/reporting",
    permission: PERMISSIONS.REPORTING_DASHBOARD_VIEW,
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

  // Helper: check if user has a given permission (undefined = always accessible)
  const canView = (perm?: { resource: string; action: string }) =>
    !perm || hasPermission(user, perm.resource, perm.action);

  // Helper: true if at least one leaf sub-item is accessible
  const hasVisibleChild = (subs: SubMenuItem[]): boolean =>
    subs.some((s) =>
      s.subItems?.length ? hasVisibleChild(s.subItems) : canView(s.permission),
    );

  // Recursively filter sub-items to only accessible ones
  const filterSubs = (subs: SubMenuItem[]): SubMenuItem[] =>
    subs
      .filter((s) =>
        s.subItems?.length ? hasVisibleChild(s.subItems) : canView(s.permission),
      )
      .map((s): SubMenuItem =>
        s.subItems?.length ? { ...s, subItems: filterSubs(s.subItems) } : s,
      );

  // Filter menu items based on user permissions, pre-filtering sub-items
  const visibleMenuItems = menuItems
    .filter((item) => {
      if (item.path === "/dashboard") return hasAnyModuleAccess(user);
      if (item.subItems?.length) {
        return canView(item.permission) || hasVisibleChild(item.subItems);
      }
      return canView(item.permission);
    })
    .map((item): MenuItem =>
      item.subItems?.length
        ? { ...item, subItems: filterSubs(item.subItems) }
        : item,
    );

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
