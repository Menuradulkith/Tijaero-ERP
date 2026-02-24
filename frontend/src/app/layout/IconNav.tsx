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
import { useNavigate } from "react-router-dom";

interface IconNavProps {
  width: number;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

// All searchable pages in the app
const allPages = [
  { text: "Dashboard", path: "/dashboard", keywords: ["home", "main", "overview"] },
  { text: "Customers", path: "/sales/customers", keywords: ["clients", "people"] },
  { text: "Sales Dashboard", path: "/sales/dashboard", keywords: ["revenue", "orders"] },
  { text: "Sales Orders", path: "/sales/orders", keywords: ["invoices", "transactions"] },
  { text: "Sales Returns", path: "/sales/returns", keywords: ["refunds"] },
  { text: "Suppliers", path: "/purchasing/suppliers", keywords: ["vendors"] },
  { text: "Purchase Orders", path: "/purchasing/orders", keywords: ["PO", "buy"] },
  { text: "PO Approvals", path: "/purchasing/approvals", keywords: ["approve", "authorize", "pending"] },
  { text: "Good Received Notes", path: "/purchasing/grn", keywords: ["GRN", "receive"] },
  { text: "Purchase Returns", path: "/purchasing/returns", keywords: ["return goods"] },
  { text: "Supplier Payments", path: "/purchasing/payments", keywords: ["cash", "bank", "cheque", "pay supplier", "credits", "settlements", "credit settlement"] },
  { text: "Payment Approvals", path: "/purchasing/payment-approvals", keywords: ["verify", "approve payment", "payment verification"] },
  { text: "Products", path: "/inventory", keywords: ["items", "stock"] },
  { text: "Categories", path: "/inventory/categories", keywords: ["groups"] },
  { text: "Brands", path: "/inventory/brands", keywords: ["manufacturers"] },
  { text: "Finance", path: "/finance", keywords: ["accounting", "money"] },
  { text: "HR", path: "/hr", keywords: ["employees", "human resources", "staff"] },
  { text: "Sales Stock", path: "/warehouse", keywords: ["warehouse", "storage", "logistics", "sales stock"] },
  { text: "Support", path: "/support", keywords: ["help", "tickets"] },
  { text: "Reporting", path: "/reporting", keywords: ["reports", "analytics"] },
  { text: "Branches", path: "/branches", keywords: ["locations", "offices"] },
  { text: "Users", path: "/users", keywords: ["accounts", "members"] },
  { text: "Roles", path: "/roles", keywords: ["permissions", "groups", "security"] },
];

export default function IconNav({ width, sidebarOpen, onToggleSidebar }: IconNavProps) {
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchButtonRef = useRef<HTMLButtonElement>(null);

  const filteredPages = useMemo(() => {
    if (!searchQuery.trim()) return allPages;
    const q = searchQuery.toLowerCase();
    return allPages.filter(
      (page) =>
        page.text.toLowerCase().includes(q) ||
        page.path.toLowerCase().includes(q) ||
        page.keywords.some((k) => k.toLowerCase().includes(q))
    );
  }, [searchQuery]);

  const handleSearchSelect = (path: string) => {
    navigate(path);
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
          onClick={() => navigate("/dashboard")}
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
      <Tooltip title={sidebarOpen ? "Hide Sidebar" : "Show Sidebar"} placement="right">
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
    </Box>
  );
}
