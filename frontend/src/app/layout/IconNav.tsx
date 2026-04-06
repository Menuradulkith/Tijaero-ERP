import { hasAnyModuleAccess, hasModuleAccess } from "@/auth/permissions";
import { TConfirmDialog, useConfirmDialog } from "@/components/tijaero";
import { useAuthStore } from "@/state/authStore";
import { useFormGuardStore } from "@/state/formGuardStore";
import HomeIcon from "@mui/icons-material/Home";
import MenuIcon from "@mui/icons-material/Menu";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
import SearchIcon from "@mui/icons-material/Search";
import {
  Box,
  ClickAwayListener,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Popper,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

interface IconNavProps {
  width: number;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

// All searchable pages in the app — module field maps to MODULE_PERMISSIONS key
const allPages = [
  {
    text: "Dashboard",
    path: "/dashboard",
    keywords: ["home", "main", "overview"],
    module: "/dashboard",
  },
  {
    text: "Customers",
    path: "/sales/customers",
    keywords: ["clients", "people"],
    module: "/sales",
  },
  {
    text: "Sales Dashboard",
    path: "/sales/dashboard",
    keywords: ["revenue", "orders"],
    module: "/sales",
  },
  {
    text: "Sales Orders",
    path: "/sales/orders",
    keywords: ["invoices", "transactions"],
    module: "/sales",
  },
  {
    text: "Sales Returns",
    path: "/sales/returns",
    keywords: ["refunds"],
    module: "/sales",
  },
  {
    text: "Suppliers",
    path: "/purchasing/suppliers",
    keywords: ["vendors"],
    module: "/purchasing",
  },
  {
    text: "Purchase Orders",
    path: "/purchasing/orders",
    keywords: ["PO", "buy"],
    module: "/purchasing",
  },
  {
    text: "PO Approvals",
    path: "/purchasing/approvals/po-approvals",
    keywords: ["approve", "authorize", "pending", "purchase order"],
    module: "/purchasing",
  },
  {
    text: "Good Received Notes",
    path: "/purchasing/grn",
    keywords: ["GRN", "receive"],
    module: "/purchasing",
  },
  {
    text: "Purchase Returns",
    path: "/purchasing/returns",
    keywords: ["return goods"],
    module: "/purchasing",
  },
  {
    text: "Purchase Return Approvals",
    path: "/purchasing/approvals/return-approvals",
    keywords: ["approve return", "return approval"],
    module: "/purchasing",
  },
  {
    text: "Supplier Payments",
    path: "/purchasing/payments",
    keywords: [
      "cash",
      "bank",
      "cheque",
      "pay supplier",
      "credits",
      "settlements",
      "credit settlement",
    ],
    module: "/purchasing",
  },
  {
    text: "Payment Approvals",
    path: "/purchasing/payment-approvals",
    keywords: ["verify", "approve payment", "payment verification"],
    module: "/purchasing",
  },
  {
    text: "Products",
    path: "/inventory",
    keywords: ["items", "stock"],
    module: "/inventory",
  },
  {
    text: "Categories",
    path: "/inventory/categories",
    keywords: ["groups"],
    module: "/inventory",
  },
  {
    text: "Brands",
    path: "/inventory/brands",
    keywords: ["manufacturers"],
    module: "/inventory",
  },
  {
    text: "Finance",
    path: "/finance",
    keywords: ["accounting", "money"],
    module: "/finance",
  },
  {
    text: "HR",
    path: "/hr",
    keywords: ["employees", "human resources", "staff"],
    module: "/hr",
  },
  {
    text: "Sales Stock",
    path: "/warehouse",
    keywords: ["warehouse", "storage", "logistics", "sales stock"],
    module: "/warehouse",
  },
  {
    text: "Support",
    path: "/support",
    keywords: ["help", "tickets"],
    module: "/support",
  },
  {
    text: "Reporting",
    path: "/reporting",
    keywords: ["reports", "analytics"],
    module: "/reporting",
  },
  {
    text: "Branches",
    path: "/branches",
    keywords: ["locations", "offices"],
    module: "/branches",
  },
  {
    text: "Users",
    path: "/users",
    keywords: ["accounts", "members"],
    module: "/users",
  },
  {
    text: "Roles",
    path: "/roles",
    keywords: ["permissions", "groups", "security"],
    module: "/roles",
  },
  {
    text: "Settings",
    path: "/company-settings",
    keywords: ["company config", "settings"],
    module: "/company-settings",
  },
  {
    text: "My Preferences",
    path: "/settings",
    keywords: ["preferences", "configuration", "profile", "account"],
    module: "/settings",
  },
];

export default function IconNav({
  width,
  sidebarOpen,
  onToggleSidebar,
}: IconNavProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isDirty = useFormGuardStore((s) => s.isDirty);
  const executeDiscard = useFormGuardStore((s) => s.executeDiscard);
  const discardDialog = useConfirmDialog();
  const user = useAuthStore((s) => s.user);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchButtonRef = useRef<HTMLButtonElement>(null);

  // Filter pages the user has access to
  const accessiblePages = useMemo(() => {
    return allPages.filter((page) => {
      // Dashboard is only visible if the user can access at least one module
      if (page.module === "/dashboard") return hasAnyModuleAccess(user);
      return hasModuleAccess(user, page.module);
    });
  }, [user]);

  const guardedNavigate = async (path: string) => {
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
  };

  const filteredPages = useMemo(() => {
    if (!searchQuery.trim()) return accessiblePages;
    const q = searchQuery.toLowerCase();
    return accessiblePages.filter(
      (page) =>
        page.text.toLowerCase().includes(q) ||
        page.path.toLowerCase().includes(q) ||
        page.keywords.some((k) => k.toLowerCase().includes(q)),
    );
  }, [searchQuery, accessiblePages]);

  const handleSearchSelect = (path: string) => {
    guardedNavigate(path);
    setSearchOpen(false);
    setSearchQuery("");
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && filteredPages.length > 0) {
      handleSearchSelect(filteredPages[0].path);
    } else if (e.key === "Escape") {
      setSearchOpen(false);
      setSearchQuery("");
    }
  };

  return (
    <Box
      sx={{
        position: "fixed",
        left: 0,
        top: 0,
        width,
        height: "100dvh",
        bgcolor: "primary.dark",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        py: 1,
        zIndex: 1300,
      }}
    >
      {/* Home button */}
      <Tooltip title="Home" placement="right">
        <IconButton
          onClick={() => guardedNavigate("/dashboard")}
          sx={{
            color: "white",
            "&:hover": { bgcolor: "primary.main" },
            mb: 1,
          }}
        >
          <HomeIcon />
        </IconButton>
      </Tooltip>

      {/* Sidebar toggle */}
      <Tooltip
        title={sidebarOpen ? "Hide Sidebar" : "Show Sidebar"}
        placement="right"
      >
        <IconButton
          onClick={onToggleSidebar}
          sx={{
            color: "white",
            "&:hover": { bgcolor: "primary.main" },
            mb: 1,
          }}
        >
          {sidebarOpen ? <MenuOpenIcon /> : <MenuIcon />}
        </IconButton>
      </Tooltip>

      {/* Search button */}
      <Tooltip title="Find Page" placement="right">
        <IconButton
          ref={searchButtonRef}
          onClick={() => setSearchOpen((prev) => !prev)}
          sx={{
            color: searchOpen ? "primary.light" : "white",
            "&:hover": { bgcolor: "primary.main" },
          }}
        >
          <SearchIcon />
        </IconButton>
      </Tooltip>

      {/* Search Popper */}
      <Popper
        open={searchOpen}
        anchorEl={searchButtonRef.current}
        placement="right-start"
        sx={{ zIndex: 1400 }}
      >
        <ClickAwayListener onClickAway={() => setSearchOpen(false)}>
          <Paper
            elevation={8}
            sx={{
              width: 280,
              maxHeight: 400,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              ml: 1,
            }}
          >
            <Box sx={{ p: 1 }}>
              <TextField
                autoFocus
                fullWidth
                size="small"
                placeholder="Find a page..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                }}
              />
            </Box>
            <List dense sx={{ overflow: "auto", maxHeight: 320, py: 0 }}>
              {filteredPages.length > 0 ? (
                filteredPages.map((page) => (
                  <ListItemButton
                    key={page.path}
                    onClick={() => handleSearchSelect(page.path)}
                    sx={{ py: 0.75 }}
                  >
                    <ListItemText
                      primary={page.text}
                      secondary={page.path}
                      primaryTypographyProps={{ fontSize: "0.875rem" }}
                      secondaryTypographyProps={{ fontSize: "0.75rem" }}
                    />
                  </ListItemButton>
                ))
              ) : (
                <Box sx={{ p: 2, textAlign: "center" }}>
                  <Typography variant="body2" color="text.secondary">
                    No pages found
                  </Typography>
                </Box>
              )}
            </List>
          </Paper>
        </ClickAwayListener>
      </Popper>
      <TConfirmDialog {...discardDialog.dialogProps} />
    </Box>
  );
}
