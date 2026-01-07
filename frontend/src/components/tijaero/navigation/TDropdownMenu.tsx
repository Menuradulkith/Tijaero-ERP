/**
 * TDropdownMenu - Standardized dropdown/action menu
 * 
 * Button-triggered dropdown menu for actions.
 * 
 * @example
 * ```tsx
 * <TDropdownMenu
 *   label="Actions"
 *   icon={<MoreVertIcon />}
 *   items={[
 *     { label: "Edit", icon: <EditIcon />, onClick: handleEdit },
 *     { label: "Duplicate", icon: <ContentCopyIcon />, onClick: handleDuplicate },
 *     { type: "divider" },
 *     { label: "Delete", icon: <DeleteIcon />, onClick: handleDelete, color: "error" },
 *   ]}
 * />
 * ```
 */

import React, { useState } from "react";
import {
  Button,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Typography,
} from "@mui/material";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import MoreVertIcon from "@mui/icons-material/MoreVert";

export interface TDropdownMenuItem {
  /** Menu item type */
  type?: "item" | "divider" | "header";
  /** Item label */
  label?: string;
  /** Item icon */
  icon?: React.ReactNode;
  /** Click handler */
  onClick?: () => void;
  /** Disabled state */
  disabled?: boolean;
  /** Color */
  color?: "inherit" | "primary" | "secondary" | "error" | "warning" | "info" | "success";
}

export interface TDropdownMenuProps {
  /** Button label (for text button) */
  label?: string;
  /** Button icon */
  icon?: React.ReactNode;
  /** Button variant */
  variant?: "button" | "icon" | "text";
  /** Button size */
  size?: "small" | "medium" | "large";
  /** Button color */
  color?: "inherit" | "primary" | "secondary" | "error" | "warning" | "info" | "success";
  /** Menu items */
  items: TDropdownMenuItem[];
  /** Disabled state */
  disabled?: boolean;
  /** Tooltip for icon button */
  tooltip?: string;
}

export const TDropdownMenu: React.FC<TDropdownMenuProps> = ({
  label,
  icon,
  variant = "button",
  size = "medium",
  color = "primary",
  items,
  disabled = false,
  tooltip,
}) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleItemClick = (item: TDropdownMenuItem) => {
    if (item.onClick && !item.disabled) {
      item.onClick();
      handleClose();
    }
  };

  // Render trigger button based on variant
  const renderTrigger = () => {
    if (variant === "icon") {
      return (
        <IconButton
          onClick={handleClick}
          disabled={disabled}
          size={size}
          color={color}
          title={tooltip}
        >
          {icon || <MoreVertIcon />}
        </IconButton>
      );
    }

    if (variant === "text") {
      return (
        <Button
          onClick={handleClick}
          disabled={disabled}
          size={size}
          color={color}
          endIcon={<ArrowDropDownIcon />}
          sx={{ textTransform: "none" }}
        >
          {icon && <span style={{ marginRight: 8, display: "flex" }}>{icon}</span>}
          {label}
        </Button>
      );
    }

    // Default button variant
    return (
      <Button
        onClick={handleClick}
        disabled={disabled}
        size={size}
        color={color}
        variant="contained"
        endIcon={<ArrowDropDownIcon />}
        startIcon={icon}
        sx={{ textTransform: "none" }}
      >
        {label}
      </Button>
    );
  };

  return (
    <>
      {renderTrigger()}
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "right",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "right",
        }}
        slotProps={{
          paper: {
            sx: {
              minWidth: 160,
              mt: 0.5,
            },
          },
        }}
      >
        {items.map((item, index) => {
          // Divider
          if (item.type === "divider") {
            return <Divider key={index} />;
          }

          // Header
          if (item.type === "header") {
            return (
              <Typography
                key={index}
                variant="caption"
                color="text.secondary"
                sx={{ px: 2, py: 0.5, display: "block", fontWeight: 600 }}
              >
                {item.label}
              </Typography>
            );
          }

          // Regular item
          return (
            <MenuItem
              key={index}
              onClick={() => handleItemClick(item)}
              disabled={item.disabled}
              sx={{
                color: item.color ? `${item.color}.main` : undefined,
              }}
            >
              {item.icon && (
                <ListItemIcon
                  sx={{
                    color: item.color ? `${item.color}.main` : undefined,
                  }}
                >
                  {item.icon}
                </ListItemIcon>
              )}
              <ListItemText>{item.label}</ListItemText>
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
};

export default TDropdownMenu;
