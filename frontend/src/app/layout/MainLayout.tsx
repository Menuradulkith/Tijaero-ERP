import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Box, useMediaQuery, useTheme } from "@mui/material";
import Sidebar from "./Sidebar";
import Header from "./Header";
import IconNav from "./IconNav";

const DRAWER_WIDTH = 220;
const ICON_NAV_WIDTH = 48;

export default function MainLayout() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleSidebarCollapse = () => {
    setSidebarCollapsed((prev) => !prev);
  };

  // On desktop, sidebar can be collapsed; on mobile, it's always a drawer
  const effectiveDrawerWidth = isMobile || !sidebarCollapsed ? DRAWER_WIDTH : 0;

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", width: "100%" }}>
      {/* Icon navigation rail on far left */}
      <IconNav
        width={ICON_NAV_WIDTH}
        sidebarOpen={!sidebarCollapsed}
        onToggleSidebar={handleSidebarCollapse}
      />

      <Header
        onMenuClick={handleDrawerToggle}
        drawerWidth={effectiveDrawerWidth}
        iconNavWidth={ICON_NAV_WIDTH}
      />

      {/* Sidebar is fixed position, rendered outside flex flow */}
      <Sidebar
        drawerWidth={DRAWER_WIDTH}
        mobileOpen={mobileOpen}
        onDrawerToggle={handleDrawerToggle}
        isMobile={isMobile}
        iconNavWidth={ICON_NAV_WIDTH}
        collapsed={!isMobile && sidebarCollapsed}
      />

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 1, sm: 1, md: 1.5, lg: 2 },
          width: "100%",
          ml: { xs: `${ICON_NAV_WIDTH}px`, md: `${ICON_NAV_WIDTH + effectiveDrawerWidth}px` },
          mt: "56px",
          bgcolor: "background.default",
          height: "calc(100vh - 56px)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
}
