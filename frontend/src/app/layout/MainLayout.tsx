import { useState, useEffect } from "react";
import { Outlet } from "react-router-dom";
import { Box, useMediaQuery, useTheme } from "@mui/material";
import IdleSessionManager from "@/auth/components/IdleSessionManager";
import Sidebar from "./Sidebar";
import Header from "./Header";
import IconNav from "./IconNav";
import ChatAgentWidget from "@/features/chat-agent/ChatWidget";
import { useFormGuardStore } from "@/state/formGuardStore";

const DRAWER_WIDTH = 220;
const ICON_NAV_WIDTH = 48;

export default function MainLayout() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isDirty = useFormGuardStore((s) => s.isDirty);

  // Warn on browser close/refresh when form has unsaved changes
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleSidebarCollapse = () => {
    setSidebarCollapsed((prev) => !prev);
  };

  // On desktop, sidebar can be collapsed; on mobile, it's always a drawer
  const effectiveDrawerWidth = isMobile || !sidebarCollapsed ? DRAWER_WIDTH : 0;

  return (
    <Box sx={{ 
      display: "flex", 
      minHeight: "100dvh", 
      width: "100%",
      "@media print": {
        display: "block",
        height: "auto",
        minHeight: "auto",
        overflow: "visible"
      }
    }}>
      <IdleSessionManager />

      <Box className="no-print" sx={{ "@media print": { display: "none" } }}>
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
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 1, sm: 1, md: 1.5, lg: 2 },
          width: "100%",
          ml: {
            xs: "var(--icon-nav-width)",
            md: `calc(var(--icon-nav-width) + ${effectiveDrawerWidth}px)`,
          },
          mt: "var(--header-height)",
          bgcolor: "background.default",
          height: "calc(100dvh - var(--header-height))",
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          "@media print": {
            ml: 0,
            mt: 0,
            p: 0,
            height: "auto",
            overflow: "visible",
            display: "block",
            bgcolor: "white",
          },
        }}
      >
        <Outlet />
      </Box>

      {/* Floating AI assistant — renders only for users with ai_assistant:view */}
      <Box className="no-print" sx={{ "@media print": { display: "none" } }}>
        <ChatAgentWidget />
      </Box>
    </Box>
  );
}
