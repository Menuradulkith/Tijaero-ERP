/**
 * TContextMenu - Standardized context menu (right-click menu)
 * 
 * Provides consistent context menu with hook for easy usage.
 * 
 * @example
 * ```tsx
 * const { contextMenu, handleContextMenu, handleClose } = useContextMenu();
 * 
 * return (
 *   <>
 *     <Box onContextMenu={handleContextMenu}>
 *       Right-click me
 *     </Box>
 *     <TContextMenu
 *       {...contextMenu}
 *       onClose={handleClose}
 *       items={[
 *         { label: "Edit", icon: <EditIcon />, onClick: handleEdit },
 *         { label: "Delete", icon: <DeleteIcon />, onClick: handleDelete, color: "error" },
 *         { type: "divider" },
 *         { label: "Copy", onClick: handleCopy },
 *       ]}
 *     />
 *   </>
 * );
 * ```
 */

import React, { useState, useCallback } from "react";
import {
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Typography,
} from "@mui/material";

export interface TContextMenuItem {
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
  /** Keyboard shortcut hint */
  shortcut?: string;
}

export interface TContextMenuProps {
  /** Menu open state */
  open: boolean;
  /** Menu position */
  anchorPosition?: { top: number; left: number };
  /** Close handler */
  onClose: () => void;
  /** Menu items */
  items: TContextMenuItem[];
}

export const TContextMenu: React.FC<TContextMenuProps> = ({
  open,
  anchorPosition,
  onClose,
  items,
}) => {
  const handleItemClick = (item: TContextMenuItem) => {
    if (item.onClick && !item.disabled) {
      item.onClick();
      onClose();
    }
  };

  return (
    <Menu
      open={open}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={anchorPosition}
      slotProps={{
        paper: {
          sx: {
            minWidth: 180,
            boxShadow: 3,
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
            {item.shortcut && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ ml: 2 }}
              >
                {item.shortcut}
              </Typography>
            )}
          </MenuItem>
        );
      })}
    </Menu>
  );
};

/**
 * Hook for managing context menu state
 */
export interface UseContextMenuReturn {
  /** Context menu state */
  contextMenu: {
    open: boolean;
    anchorPosition: { top: number; left: number } | undefined;
  };
  /** Handle context menu event */
  handleContextMenu: (event: React.MouseEvent) => void;
  /** Close context menu */
  handleClose: () => void;
}

export function useContextMenu(): UseContextMenuReturn {
  const [contextMenu, setContextMenu] = useState<{
    open: boolean;
    anchorPosition: { top: number; left: number } | undefined;
  }>({
    open: false,
    anchorPosition: undefined,
  });

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setContextMenu({
      open: true,
      anchorPosition: {
        top: event.clientY,
        left: event.clientX,
      },
    });
  }, []);

  const handleClose = useCallback(() => {
    setContextMenu({
      open: false,
      anchorPosition: undefined,
    });
  }, []);

  return {
    contextMenu,
    handleContextMenu,
    handleClose,
  };
}

export default TContextMenu;
