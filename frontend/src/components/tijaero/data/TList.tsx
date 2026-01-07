/**
 * TList - Standardized list component
 * 
 * Configurable list for displaying items with icons, actions, and status.
 * 
 * @example
 * ```tsx
 * <TList
 *   items={recentOrders}
 *   getItemConfig={(order) => ({
 *     id: order.id,
 *     primary: order.orderNumber,
 *     secondary: order.customerName,
 *     icon: <ReceiptIcon />,
 *     status: { label: order.status, statusMap: "orderStatus" },
 *     onClick: () => navigate(`/orders/${order.id}`),
 *   })}
 * />
 * ```
 */

import React from "react";
import {
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListItemSecondaryAction,
  Typography,
  Box,
  Divider,
  Skeleton,
  Paper,
} from "@mui/material";
import { TStatusChip, StatusMapName } from "../base/TStatusChip";

export interface TListItem {
  /** Unique identifier */
  id: string | number;
  /** Primary text */
  primary: string;
  /** Secondary text */
  secondary?: string;
  /** Tertiary text (below secondary) */
  tertiary?: string;
  /** Icon */
  icon?: React.ReactNode;
  /** Avatar element */
  avatar?: React.ReactNode;
  /** Status chip */
  status?: {
    label: string;
    statusMap?: StatusMapName;
  };
  /** Additional chips */
  chips?: { label: string; color?: "primary" | "secondary" | "success" | "error" | "warning" | "info" }[];
  /** Click handler */
  onClick?: () => void;
  /** Secondary action */
  action?: React.ReactNode;
  /** Disabled state */
  disabled?: boolean;
}

export interface TListProps<T = unknown> {
  /** List items (when using getItemConfig) */
  items?: T[];
  /** Function to get list item config from data */
  getItemConfig?: (item: T, index: number) => TListItem;
  /** Pre-configured list items (when not using getItemConfig) */
  listItems?: TListItem[];
  /** Loading state */
  loading?: boolean;
  /** Loading skeleton count */
  loadingCount?: number;
  /** Empty message */
  emptyMessage?: string;
  /** Empty icon */
  emptyIcon?: React.ReactNode;
  /** Show dividers between items */
  dividers?: boolean;
  /** Dense layout */
  dense?: boolean;
  /** Wrap in Paper */
  paper?: boolean;
  /** Max height for scrolling */
  maxHeight?: number | string;
  /** List header */
  header?: React.ReactNode;
}

export function TList<T = unknown>({
  items,
  getItemConfig,
  listItems: configuredItems,
  loading = false,
  loadingCount = 5,
  emptyMessage = "No items",
  emptyIcon,
  dividers = true,
  dense = false,
  paper = true,
  maxHeight,
  header,
}: TListProps<T>) {
  // Build list items from data or use provided items
  const listItems: TListItem[] = React.useMemo(() => {
    if (configuredItems) return configuredItems;
    if (items && getItemConfig) {
      return items.map((item, index) => getItemConfig(item, index));
    }
    return [];
  }, [items, getItemConfig, configuredItems]);

  // Render loading skeleton
  if (loading) {
    const content = (
      <>
        {header}
        <List dense={dense}>
          {Array.from({ length: loadingCount }).map((_, index) => (
            <React.Fragment key={index}>
              <ListItem>
                <ListItemIcon>
                  <Skeleton variant="circular" width={40} height={40} />
                </ListItemIcon>
                <ListItemText
                  primary={<Skeleton variant="text" width="60%" />}
                  secondary={<Skeleton variant="text" width="40%" />}
                />
              </ListItem>
              {dividers && index < loadingCount - 1 && <Divider />}
            </React.Fragment>
          ))}
        </List>
      </>
    );

    return paper ? <Paper sx={{ maxHeight, overflow: "auto" }}>{content}</Paper> : <>{content}</>;
  }

  // Render empty state
  if (listItems.length === 0) {
    const content = (
      <>
        {header}
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            py: 4,
            color: "text.secondary",
          }}
        >
          {emptyIcon}
          <Typography variant="body2">{emptyMessage}</Typography>
        </Box>
      </>
    );

    return paper ? <Paper sx={{ maxHeight, overflow: "auto" }}>{content}</Paper> : <>{content}</>;
  }

  // Render list
  const content = (
    <>
      {header}
      <List dense={dense} sx={{ py: 0 }}>
        {listItems.map((item, index) => {
          const isClickable = !!item.onClick;

          return (
            <React.Fragment key={item.id}>
              {isClickable ? (
                <ListItemButton onClick={item.onClick} disabled={item.disabled}>
                  {(item.icon || item.avatar) && (
                    <ListItemIcon sx={{ minWidth: item.avatar ? 56 : 40 }}>
                      {item.avatar || item.icon}
                    </ListItemIcon>
                  )}
                  <ListItemText
                    primary={
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Typography variant="body2" fontWeight={500}>
                          {item.primary}
                        </Typography>
                        {item.chips?.map((chip, chipIdx) => (
                          <TStatusChip
                            key={chipIdx}
                            status={chip.label}
                            customMap={{
                              [chip.label.toLowerCase()]: {
                                label: chip.label,
                                color: chip.color || "default",
                              },
                          }}
                          size="small"
                        />
                      ))}
                    </Box>
                  }
                  secondary={
                    <>
                      {item.secondary && (
                        <Typography
                          component="span"
                          variant="body2"
                          color="text.secondary"
                        >
                          {item.secondary}
                        </Typography>
                      )}
                      {item.tertiary && (
                        <Typography
                          component="span"
                          variant="caption"
                          color="text.secondary"
                          display="block"
                        >
                          {item.tertiary}
                        </Typography>
                      )}
                    </>
                  }
                />
                {(item.status || item.action) && (
                  <ListItemSecondaryAction>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      {item.status && (
                        <TStatusChip
                          status={item.status.label}
                          statusMap={item.status.statusMap || "orderStatus"}
                          size="small"
                        />
                      )}
                      {item.action}
                    </Box>
                  </ListItemSecondaryAction>
                )}
              </ListItemButton>
              ) : (
              <ListItem>
                {(item.icon || item.avatar) && (
                  <ListItemIcon sx={{ minWidth: item.avatar ? 56 : 40 }}>
                    {item.avatar || item.icon}
                  </ListItemIcon>
                )}
                <ListItemText
                  primary={
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography variant="body2" fontWeight={500}>
                        {item.primary}
                      </Typography>
                      {item.chips?.map((chip, chipIdx) => (
                        <TStatusChip
                          key={chipIdx}
                          status={chip.label}
                          customMap={{
                            [chip.label.toLowerCase()]: {
                              label: chip.label,
                              color: chip.color || "default",
                            },
                          }}
                          size="small"
                        />
                      ))}
                    </Box>
                  }
                  secondary={
                    <>
                      {item.secondary && (
                        <Typography
                          component="span"
                          variant="body2"
                          color="text.secondary"
                        >
                          {item.secondary}
                        </Typography>
                      )}
                      {item.tertiary && (
                        <Typography
                          component="span"
                          variant="caption"
                          color="text.secondary"
                          display="block"
                        >
                          {item.tertiary}
                        </Typography>
                      )}
                    </>
                  }
                />
                {(item.status || item.action) && (
                  <ListItemSecondaryAction>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      {item.status && (
                        <TStatusChip
                          status={item.status.label}
                          statusMap={item.status.statusMap || "orderStatus"}
                          size="small"
                        />
                      )}
                      {item.action}
                    </Box>
                  </ListItemSecondaryAction>
                )}
              </ListItem>
              )}
              {dividers && index < listItems.length - 1 && <Divider />}
            </React.Fragment>
          );
        })}
      </List>
    </>
  );

  return paper ? (
    <Paper sx={{ maxHeight, overflow: "auto" }}>{content}</Paper>
  ) : (
    <>{content}</>
  );
}

export default TList;
