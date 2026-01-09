/**
 * MasterDetailLayout - Tijaero-style page layout component
 * 
 * Provides a consistent master-detail layout structure with:
 * - Page header with title and refresh button
 * - Optional tabs
 * - Left master panel and right detail panel
 * - Responsive design for mobile
 */

import React from "react";
import {
  Box,
  Typography,
  IconButton,
  Tabs,
  Tab,
  useMediaQuery,
  useTheme,
  CircularProgress,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { MasterDetailLayoutProps } from "../types";

export const MasterDetailLayout: React.FC<MasterDetailLayoutProps> = ({
  title,
  icon,
  onRefresh,
  children,
  masterPanel,
  detailPanel,
  tabs,
  activeTab,
  onTabChange,
  headerActions,
  isLoading,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  // Get current tab value - support both index and string id
  const getTabValue = () => {
    if (activeTab !== undefined) return activeTab;
    if (tabs && tabs.length > 0) {
      return tabs[0]?.id ?? 0;
    }
    return 0;
  };

  // Handle tab change - support both index and string id
  const handleTabChange = (_: React.SyntheticEvent, newValue: string | number) => {
    if (onTabChange) {
      onTabChange(newValue);
    }
  };

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Page Header */}
      <Box
        sx={{
          px: 1.5,
          py: 1,
          borderBottom: 1,
          borderColor: "divider",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {icon}
          <Typography variant="h6" fontWeight={600}>
            {title}
          </Typography>
          {isLoading && <CircularProgress size={18} sx={{ ml: 1 }} />}
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {headerActions}
          {onRefresh && (
            <IconButton onClick={() => onRefresh()} size="small" disabled={isLoading}>
              <RefreshIcon />
            </IconButton>
          )}
        </Box>
      </Box>

      {/* Optional Tabs */}
      {tabs && tabs.length > 0 && (
        <Box sx={{ borderBottom: 1, borderColor: "divider", flexShrink: 0 }}>
          <Tabs
            value={getTabValue()}
            onChange={handleTabChange}
            sx={{ px: 2 }}
          >
            {tabs.map((tab, index) => (
              <Tab
                key={tab.id ?? index}
                value={tab.id ?? index}
                label={tab.label}
                icon={tab.icon as React.ReactElement}
                iconPosition="start"
                sx={{ textTransform: "none", minHeight: 48 }}
              />
            ))}
          </Tabs>
        </Box>
      )}

      {/* Main Content - Either children or master/detail panels */}
      {children ? (
        children
      ) : (
        <Box
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            overflow: "hidden",
          }}
        >
          {/* Master Panel */}
          {masterPanel}

          {/* Detail Panel */}
          {detailPanel}
        </Box>
      )}
    </Box>
  );
};

export default MasterDetailLayout;
