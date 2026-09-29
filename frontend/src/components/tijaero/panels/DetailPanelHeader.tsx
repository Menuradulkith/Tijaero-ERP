/**
 * DetailPanelHeader - Tijaero-style detail panel header component
 *
 * Provides a consistent header for detail panels with:
 * - Breadcrumbs navigation
 * - Title with icon
 * - Status chips
 * - Custom actions
 */

import React from "react";
import {
  Box,
  Breadcrumbs,
  Link,
  Typography,
} from "@mui/material";
import HomeIcon from "@mui/icons-material/Home";
import { DetailPanelHeaderProps } from "../types";
import { TStatusChip } from "../base/TStatusChip";

export const DetailPanelHeader: React.FC<DetailPanelHeaderProps> = ({
  breadcrumbs,
  title,
  titleSlot,
  titleIcon,
  icon,
  subtitle,
  isCreating = false,
  createTitle = "New Item",
  noSelectionTitle = "Select an item",
  chips,
  actions,
  tabsSlot,
  sx,
}) => {
  return (
    <Box
      sx={{
        px: 1.5,
        py: 1,
        border: 1,
        borderColor: "divider",
        borderRadius: "12px",
        bgcolor: "grey.50",
        ...sx,
      }}
    >
      {/* Back button (or other titleSlot content), its own row at the top */}
      {titleSlot && (
        <Box sx={{ mb: 0.5 }}>
          {titleSlot}
        </Box>
      )}

      {/* Breadcrumbs */}
      <Breadcrumbs sx={{ mb: 0.5 }}>
        {breadcrumbs.map((crumb, index) => {
          const isLast = index === breadcrumbs.length - 1;
          return isLast || !crumb.href ? (
            <Typography key={index} color="text.primary" sx={{ display: "flex", alignItems: "center" }}>
              {crumb.icon || (index === 0 && <HomeIcon sx={{ mr: 0.5 }} fontSize="small" />)}
              {crumb.label}
            </Typography>
          ) : (
            <Link
              key={index}
              underline="hover"
              color="inherit"
              href={crumb.href}
              sx={{ display: "flex", alignItems: "center" }}
            >
              {crumb.icon || (index === 0 && <HomeIcon sx={{ mr: 0.5 }} fontSize="small" />)}
              {crumb.label}
            </Link>
          );
        })}
      </Breadcrumbs>

      {/* Chips + actions row — the icon/title text is no longer shown here;
          the "Back to X" button living in MasterDetailLayout's own header
          bar above already identifies the page, so this row is just for
          status chips and action buttons (print, activity history, ...). */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        {subtitle && (
          <Typography variant="body2" color="text.secondary">
            ({subtitle})
          </Typography>
        )}

        {/* Status Chips — same soft tinted style as TStatusChip everywhere else */}
        {!isCreating && title && chips?.map((chip, index) => (
          <TStatusChip
            key={index}
            status={chip.label}
            size={chip.size || "small"}
            variant={chip.variant || "filled"}
            customMap={{
              [chip.label.toLowerCase().replace(/\s+/g, "_")]: {
                label: chip.label,
                color: chip.color || "default",
              },
            }}
          />
        ))}

        {/* Custom Actions */}
        {actions && (
          <Box sx={{ ml: "auto", display: "flex", gap: 1 }}>
            {actions}
          </Box>
        )}
      </Box>

      {/* Optional in-header tab bar */}
      {tabsSlot && (
        <Box sx={{ mt: 0.5, mx: -1.5 }}>
          {tabsSlot}
        </Box>
      )}
    </Box>
  );
};

export default DetailPanelHeader;
