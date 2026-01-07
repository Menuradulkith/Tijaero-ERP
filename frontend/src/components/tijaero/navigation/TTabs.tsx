/**
 * TTabs - Standardized tabs component
 * 
 * Provides consistent tab navigation with panel support.
 * 
 * @example
 * ```tsx
 * <TTabs
 *   tabs={[
 *     { id: "details", label: "Details", icon: <InfoIcon /> },
 *     { id: "history", label: "History", icon: <HistoryIcon /> },
 *   ]}
 *   activeTab={activeTab}
 *   onChange={setActiveTab}
 * >
 *   <TTabPanel value={activeTab} index="details">
 *     <DetailsContent />
 *   </TTabPanel>
 *   <TTabPanel value={activeTab} index="history">
 *     <HistoryContent />
 *   </TTabPanel>
 * </TTabs>
 * ```
 */

import React from "react";
import { Box, Tabs, Tab, Paper, Divider } from "@mui/material";

export interface TTabConfig {
  /** Unique tab ID */
  id: string | number;
  /** Tab label */
  label: string;
  /** Tab icon */
  icon?: React.ReactNode;
  /** Disabled state */
  disabled?: boolean;
  /** Badge count */
  badge?: number;
}

export interface TTabsProps {
  /** Tab configurations */
  tabs: TTabConfig[];
  /** Currently active tab */
  activeTab: string | number;
  /** Tab change handler */
  onChange: (tabId: string | number) => void;
  /** Tab content (children) */
  children?: React.ReactNode;
  /** Tabs variant */
  variant?: "standard" | "scrollable" | "fullWidth";
  /** Tabs orientation */
  orientation?: "horizontal" | "vertical";
  /** Indicator color */
  indicatorColor?: "primary" | "secondary";
  /** Text color */
  textColor?: "primary" | "secondary" | "inherit";
  /** Centered tabs */
  centered?: boolean;
  /** Show divider below tabs */
  showDivider?: boolean;
  /** Wrap in Paper */
  paper?: boolean;
  /** Custom styles for tabs container */
  sx?: Record<string, unknown>;
}

export const TTabs: React.FC<TTabsProps> = ({
  tabs,
  activeTab,
  onChange,
  children,
  variant = "standard",
  orientation = "horizontal",
  indicatorColor = "primary",
  textColor = "primary",
  centered = false,
  showDivider = true,
  paper = false,
  sx,
}) => {
  const handleChange = (_: React.SyntheticEvent, newValue: string | number) => {
    onChange(newValue);
  };

  const tabsContent = (
    <>
      <Tabs
        value={activeTab}
        onChange={handleChange}
        variant={variant}
        orientation={orientation}
        indicatorColor={indicatorColor}
        textColor={textColor}
        centered={centered}
        sx={{
          ...(orientation === "horizontal" && { px: 2 }),
          "& .MuiTab-root": {
            textTransform: "none",
            minHeight: 48,
            fontWeight: 500,
          },
          ...sx,
        }}
      >
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            value={tab.id}
            label={
              tab.badge !== undefined ? (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  {tab.label}
                  <Box
                    component="span"
                    sx={{
                      bgcolor: "error.main",
                      color: "white",
                      borderRadius: "50%",
                      minWidth: 20,
                      height: 20,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                    }}
                  >
                    {tab.badge}
                  </Box>
                </Box>
              ) : (
                tab.label
              )
            }
            icon={tab.icon as React.ReactElement}
            iconPosition="start"
            disabled={tab.disabled}
          />
        ))}
      </Tabs>
      {showDivider && orientation === "horizontal" && <Divider />}
      {children}
    </>
  );

  if (paper) {
    return <Paper sx={{ overflow: "hidden" }}>{tabsContent}</Paper>;
  }

  return <Box>{tabsContent}</Box>;
};

/**
 * TTabPanel - Tab panel wrapper component
 */
export interface TTabPanelProps {
  /** Current tab value */
  value: string | number;
  /** This panel's index */
  index: string | number;
  /** Panel content */
  children: React.ReactNode;
  /** Keep content mounted when hidden */
  keepMounted?: boolean;
  /** Padding */
  padding?: number;
  /** Custom styles */
  sx?: Record<string, unknown>;
}

export const TTabPanel: React.FC<TTabPanelProps> = ({
  value,
  index,
  children,
  keepMounted = false,
  padding = 3,
  sx,
}) => {
  const isActive = value === index;

  if (!keepMounted && !isActive) {
    return null;
  }

  return (
    <Box
      role="tabpanel"
      hidden={!isActive}
      id={`tabpanel-${index}`}
      aria-labelledby={`tab-${index}`}
      sx={{
        p: padding,
        display: isActive ? "block" : "none",
        ...sx,
      }}
    >
      {children}
    </Box>
  );
};

export default TTabs;
