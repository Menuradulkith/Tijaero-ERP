/**
 * SelectableListItem - Tijaero-style list item component
 * 
 * Provides a consistent list item with:
 * - Selection highlighting
 * - Primary and secondary text
 * - Status chips
 * - Favorite toggle
 * - Custom end actions
 */

import React from "react";
import {
  ListItemButton,
  ListItemText,
  Typography,
  IconButton,
  Box,
  Chip,
} from "@mui/material";
import StarIcon from "@mui/icons-material/Star";
import StarOutlineIcon from "@mui/icons-material/StarBorder";
import { SelectableListItemProps } from "../types";

export const SelectableListItem: React.FC<SelectableListItemProps> = ({
  isSelected,
  onClick,
  primaryText,
  secondaryText,
  isFavorite,
  onToggleFavorite,
  statusChip,
  chips,
  endAction,
  sx,
}) => {
  const handleToggleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleFavorite) {
      onToggleFavorite(e);
    }
  };

  return (
    <ListItemButton
      selected={isSelected}
      onClick={onClick}
      sx={{
        borderBottom: 1,
        borderColor: "divider",
        "&.Mui-selected": {
          bgcolor: "primary.light",
          color: "primary.contrastText",
          "&:hover": {
            bgcolor: "primary.main",
          },
        },
        ...sx,
      }}
    >
      <ListItemText
        primary={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <Typography
              component="span"
              variant="body2"
              fontWeight={600}
              sx={{
                color: isSelected ? "inherit" : "primary.main",
                flex: typeof primaryText === "string" ? undefined : 1,
              }}
            >
              {primaryText}
            </Typography>
            {statusChip && (
              <Chip
                label={statusChip.label}
                size="small"
                color={statusChip.color || "default"}
                variant={statusChip.variant || "filled"}
                sx={{
                  height: 18,
                  fontSize: "0.65rem",
                }}
              />
            )}
            {chips?.map((chip, index) => (
              <Chip
                key={index}
                label={chip.label}
                size="small"
                color={chip.color || "default"}
                variant={chip.variant || "filled"}
                sx={{
                  height: 18,
                  fontSize: "0.65rem",
                }}
              />
            ))}
          </Box>
        }
        secondary={
          secondaryText && (
            <Typography
              variant="caption"
              sx={{
                color: isSelected ? "inherit" : "text.secondary",
              }}
            >
              {secondaryText}
            </Typography>
          )
        }
      />
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        {endAction}
        {onToggleFavorite && (
          <IconButton
            size="small"
            onClick={handleToggleFavorite}
            sx={{
              color: isSelected
                ? "inherit"
                : isFavorite
                ? "warning.main"
                : "action.disabled",
            }}
          >
            {isFavorite ? (
              <StarIcon fontSize="small" />
            ) : (
              <StarOutlineIcon fontSize="small" />
            )}
          </IconButton>
        )}
      </Box>
    </ListItemButton>
  );
};

export default SelectableListItem;
