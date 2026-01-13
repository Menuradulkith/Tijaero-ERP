import { useAuthStore } from "@/state/authStore";
import { useThemeStore } from "@/state/themeStore";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import Brightness4Icon from "@mui/icons-material/Brightness4";
import Brightness7Icon from "@mui/icons-material/Brightness7";
import LogoutIcon from "@mui/icons-material/Logout";
import MenuIcon from "@mui/icons-material/Menu";
import NotificationsIcon from "@mui/icons-material/Notifications";
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

interface HeaderProps {
  onMenuClick: () => void;
  drawerWidth: number;
  iconNavWidth?: number;
}

export default function Header({ onMenuClick, drawerWidth, iconNavWidth = 0 }: HeaderProps) {
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

  const handleLogout = () => {
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
      <Toolbar sx={{ minHeight: { xs: 48, sm: 56 }, py: 0 }}>
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
          <IconButton
            color="inherit"
            sx={{ display: { xs: "none", sm: "inline-flex" } }}
          >
            <NotificationsIcon />
          </IconButton>
          <IconButton
            color="inherit"
            sx={{ display: { xs: "none", sm: "inline-flex" } }}
          >
            <SettingsIcon />
          </IconButton>
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
            <Typography variant="subtitle2">{user?.username}</Typography>
            <Typography variant="body2" color="text.secondary">
              {user?.email}
            </Typography>
          </Box>
          <Divider />
          <MenuItem onClick={handleClose}>
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
          <MenuItem onClick={handleClose}>
            <SettingsIcon sx={{ mr: 1 }} fontSize="small" />
            Settings
          </MenuItem>
          <Divider />
          <MenuItem onClick={handleLogout}>
            <LogoutIcon sx={{ mr: 1 }} fontSize="small" />
            Logout
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
}
