import { TConfirmDialog, useConfirmDialog } from "@/components/tijaero";
import { useAuthStore } from "@/state/authStore";
import { useFormGuardStore } from "@/state/formGuardStore";
import { useThemeStore } from "@/state/themeStore";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import Brightness4Icon from "@mui/icons-material/Brightness4";
import Brightness7Icon from "@mui/icons-material/Brightness7";
import LogoutIcon from "@mui/icons-material/Logout";
import MenuIcon from "@mui/icons-material/Menu";
import SettingsIcon from "@mui/icons-material/Settings";
import {
  AppBar,
  Avatar,
  Box,
  Divider,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import NotificationDropdown from "./NotificationDropdown";

interface HeaderProps {
  onMenuClick: () => void;
  drawerWidth: number;
  iconNavWidth?: number;
}

export default function Header({
  onMenuClick,
  drawerWidth,
  iconNavWidth = 0,
}: HeaderProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { mode, toggleTheme } = useThemeStore();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const { isDirty, executeDiscard } = useFormGuardStore();
  const discardDialog = useConfirmDialog();

  const handleLogout = async () => {
    if (isDirty) {
      const confirmed = await discardDialog.confirm({
        title: "Discard Changes",
        message:
          "You have unsaved changes. Are you sure you want to logout? All changes will be lost.",
        confirmText: "Discard & Logout",
        cancelText: "Cancel",
        danger: true,
      });
      if (!confirmed) return;
      executeDiscard();
    }
    logout();
    navigate("/login");
  };

  const totalLeftOffset = iconNavWidth + drawerWidth;

  return (
    <AppBar
      position="fixed"
      sx={{
        width: { md: `calc(100% - ${totalLeftOffset}px)` },
        ml: { md: `${totalLeftOffset}px` },
        bgcolor: "background.paper",
        color: "text.primary",
      }}
    >
      <Toolbar sx={{ minHeight: "var(--header-height)", py: 0 }}>
        <IconButton
          color="inherit"
          edge="start"
          onClick={onMenuClick}
          sx={{ mr: 1, display: { md: "none" } }}
          size="small"
        >
          <MenuIcon />
        </IconButton>

        <Typography
          variant="subtitle1"
          noWrap
          component="div"
          sx={{
            flexGrow: 1,
            fontWeight: 600,
            fontSize: { xs: "0.9rem", sm: "1rem" },
          }}
        >
          TijaeroERP
        </Typography>

        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: { xs: 0.5, sm: 1 },
          }}
        >
          {/* Display Current User Details / Branch */}
          <Box
            sx={{
              display: { xs: "none", md: "flex" },
              flexDirection: "column",
              alignItems: "flex-end",
              mr: 1,
            }}
          >
            <Typography variant="body2" fontWeight={600} color="text.primary">
              {user?.first_name
                ? `${user.first_name} ${user.last_name || ""}`.trim()
                : user?.username}
            </Typography>
            {user?.branches && user.branches.length > 0 ? (
              <Typography variant="caption" color="text.secondary">
                {user.branches[0].branch_name}
              </Typography>
            ) : user?.is_superuser ? (
              <Typography variant="caption" color="error.main" fontWeight={500}>
                Superuser
              </Typography>
            ) : null}
          </Box>

          <NotificationDropdown />
          <IconButton onClick={handleMenu} sx={{ ml: { xs: 0, sm: 1 } }}>
            <Avatar sx={{ width: 32, height: 32, bgcolor: "primary.main" }}>
              {user?.username?.[0]?.toUpperCase() || "U"}
            </Avatar>
          </IconButton>
        </Box>

        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={handleClose}
          transformOrigin={{ horizontal: "right", vertical: "top" }}
          anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
        >
          <Box sx={{ px: 2, py: 1 }}>
            <Typography variant="subtitle1" fontWeight="600">
              {user?.first_name
                ? `${user.first_name} ${user.last_name || ""}`.trim()
                : user?.username}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {user?.email}
            </Typography>

            {user?.groups && user.groups.length > 0 ? (
              <Typography
                variant="caption"
                display="block"
                color="primary.main"
                fontWeight="medium"
              >
                Role: {user.groups.map((g) => g.name).join(", ")}
              </Typography>
            ) : user?.is_superuser ? (
              <Typography
                variant="caption"
                display="block"
                color="error.main"
                fontWeight="medium"
              >
                Role: Superuser
              </Typography>
            ) : null}

            {user?.branches && user.branches.length > 0 && (
              <Typography
                variant="caption"
                display="block"
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                Branch: {user.branches.map((b) => b.branch_name).join(", ")}
              </Typography>
            )}
          </Box>
          <Divider />
          <MenuItem
            onClick={() => {
              handleClose();
              navigate("/settings");
            }}
          >
            <AccountCircleIcon sx={{ mr: 1 }} fontSize="small" />
            Profile
          </MenuItem>
          <MenuItem onClick={toggleTheme}>
            <ListItemIcon>
              {mode === "dark" ? (
                <Brightness7Icon fontSize="small" />
              ) : (
                <Brightness4Icon fontSize="small" />
              )}
            </ListItemIcon>
            {mode === "dark" ? "Light Mode" : "Dark Mode"}
          </MenuItem>
          <MenuItem
            onClick={() => {
              handleClose();
              navigate("/settings");
            }}
          >
            <SettingsIcon sx={{ mr: 1 }} fontSize="small" />
            My Preferences
          </MenuItem>
          <Divider />
          <MenuItem onClick={handleLogout}>
            <LogoutIcon sx={{ mr: 1 }} fontSize="small" />
            Logout
          </MenuItem>
        </Menu>
      </Toolbar>
      <TConfirmDialog {...discardDialog.dialogProps} />
    </AppBar>
  );
}
