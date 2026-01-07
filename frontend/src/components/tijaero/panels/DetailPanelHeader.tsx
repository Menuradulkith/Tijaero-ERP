/**
 * DetailPanelHeader - Tijaero-style detail panel header component
 * 
 * Provides a consistent header for detail panels with:
 * - Breadcrumbs navigation
 * - Title with icon
 * - Status chips
 * - Favorite toggle
 * - Custom actions
 */

import React from "react";
import {
  Box,
  Breadcrumbs,
  Link,
  Typography,
  Chip,
  IconButton,
} from "@mui/material";
import HomeIcon from "@mui/icons-material/Home";
import StarIcon from "@mui/icons-material/Star";
import StarOutlineIcon from "@mui/icons-material/StarBorder";
import { DetailPanelHeaderProps } from "../types";

export const DetailPanelHeader: React.FC<DetailPanelHeaderProps> = ({
  breadcrumbs,
  title,
  titleIcon,
  icon,
  subtitle,
  isCreating = false,
  createTitle = "New Item",
  noSelectionTitle = "Select an item",
  chips,
  isFavorite,
  onToggleFavorite,
  actions,
  sx,
}) => {
  // Support both titleIcon and icon props
  const iconElement = titleIcon || icon;
  
  // Determine the display title
  const displayTitle = isCreating ? createTitle : title || noSelectionTitle;

  return (
    <Box
      sx={{
        px: 1.5,
        py: 1,
        borderBottom: 1,
        borderColor: "divider",
        bgcolor: "grey.50",
        ...sx,
      }}
    >
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

      {/* Title Row */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        {iconElement}
        <Typography variant="h6" fontWeight={600}>
          {displayTitle}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary">
            ({subtitle})
          </Typography>
        )}

        {/* Status Chips */}
        {!isCreating && title && chips?.map((chip, index) => (
          <Chip
            key={index}
            label={chip.label}
            size={chip.size || "small"}
            color={chip.color || "default"}
            variant={chip.variant || "filled"}
          />
        ))}

        {/* Favorite Toggle */}
        {!isCreating && title && onToggleFavorite && (
          <IconButton
            size="small"
            onClick={onToggleFavorite}
            color={isFavorite ? "warning" : "default"}
          >
            {isFavorite ? <StarIcon /> : <StarOutlineIcon />}
          </IconButton>
        )}

        {/* Custom Actions */}
        {actions && (
          <Box sx={{ ml: "auto", display: "flex", gap: 1 }}>
            {actions}
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default DetailPanelHeader;
