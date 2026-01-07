/**
 * TSidebar Component
 * 
 * Collapsible sidebar navigation for module-level navigation.
 * Supports nested menu items, icons, and badges.
 * 
 * @example Basic sidebar
 * ```tsx
 * <TSidebar
 *   items={[
 *     { label: 'Dashboard', icon: <DashboardIcon />, href: '/dashboard' },
 *     { label: 'Orders', icon: <OrderIcon />, href: '/orders', badge: 5 },
 *     { 
 *       label: 'Settings', 
 *       icon: <SettingsIcon />,
 *       children: [
 *         { label: 'General', href: '/settings/general' },
 *         { label: 'Users', href: '/settings/users' },
 *       ]
 *     },
 *   ]}
 * />
 * ```
 * 
 * @example Collapsible sidebar
 * ```tsx
 * const [collapsed, setCollapsed] = useState(false);
 * 
 * <TSidebar
 *   items={sidebarItems}
 *   collapsed={collapsed}
 *   onCollapse={setCollapsed}
 *   collapsible
 * />
 * ```
 */

import React from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Collapse,
  Badge,
  IconButton,
  Tooltip,
  Divider,
  Typography,
} from '@mui/material';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useNavigate, useLocation } from 'react-router-dom';

export interface TSidebarItem {
  /** Unique identifier */
  id?: string;
  /** Display label */
  label: string;
  /** Icon element */
  icon?: React.ReactNode;
  /** Navigation URL */
  href?: string;
  /** Badge count or content */
  badge?: number | string;
  /** Badge color */
  badgeColor?: 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success';
  /** Nested items */
  children?: TSidebarItem[];
  /** Is this item disabled */
  disabled?: boolean;
  /** Divider after this item */
  divider?: boolean;
  /** Section header (non-clickable) */
  isSection?: boolean;
  /** Custom click handler */
  onClick?: () => void;
}

export interface TSidebarProps {
  /** Sidebar menu items */
  items: TSidebarItem[];
  /** Collapsed state */
  collapsed?: boolean;
  /** Callback when collapse state changes */
  onCollapse?: (collapsed: boolean) => void;
  /** Show collapse button */
  collapsible?: boolean;
  /** Sidebar width (expanded) */
  width?: number;
  /** Sidebar width (collapsed) */
  collapsedWidth?: number;
  /** Header content */
  header?: React.ReactNode;
  /** Footer content */
  footer?: React.ReactNode;
  /** Background color */
  bgcolor?: string;
  /** Custom styles */
  sx?: object;
}

export const TSidebar: React.FC<TSidebarProps> = ({
  items,
  collapsed = false,
  onCollapse,
  collapsible = false,
  width = 280,
  collapsedWidth = 64,
  header,
  footer,
  bgcolor = 'background.paper',
  sx,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [expandedItems, setExpandedItems] = React.useState<Set<string>>(new Set());

  const toggleExpand = (itemId: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(itemId)) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedItems(newExpanded);
  };

  const handleItemClick = (item: TSidebarItem) => {
    if (item.onClick) {
      item.onClick();
    } else if (item.href) {
      navigate(item.href);
    } else if (item.children) {
      toggleExpand(item.id || item.label);
    }
  };

  const isItemActive = (item: TSidebarItem): boolean => {
    if (item.href) {
      return location.pathname === item.href || location.pathname.startsWith(item.href + '/');
    }
    if (item.children) {
      return item.children.some(child => isItemActive(child));
    }
    return false;
  };

  const renderItem = (item: TSidebarItem, depth: number = 0) => {
    const itemId = item.id || item.label;
    const isExpanded = expandedItems.has(itemId);
    const isActive = isItemActive(item);
    const hasChildren = item.children && item.children.length > 0;

    if (item.isSection) {
      if (collapsed) return null;
      return (
        <React.Fragment key={itemId}>
          <ListItem sx={{ pt: depth === 0 ? 2 : 1, pb: 0.5 }}>
            <Typography
              variant="overline"
              sx={{
                color: 'text.secondary',
                fontWeight: 600,
                fontSize: '0.7rem',
              }}
            >
              {item.label}
            </Typography>
          </ListItem>
          {item.divider && <Divider sx={{ my: 1 }} />}
        </React.Fragment>
      );
    }

    const button = (
      <ListItemButton
        onClick={() => handleItemClick(item)}
        disabled={item.disabled}
        selected={isActive}
        sx={{
          pl: collapsed ? 2 : 2 + depth * 2,
          borderRadius: 1,
          mx: 1,
          mb: 0.5,
          '&.Mui-selected': {
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            '&:hover': {
              bgcolor: 'primary.dark',
            },
            '& .MuiListItemIcon-root': {
              color: 'inherit',
            },
          },
        }}
      >
        {item.icon && (
          <ListItemIcon
            sx={{
              minWidth: collapsed ? 0 : 40,
              color: isActive ? 'inherit' : 'action.active',
            }}
          >
            {item.badge !== undefined ? (
              <Badge
                badgeContent={item.badge}
                color={item.badgeColor || 'primary'}
                max={99}
              >
                {item.icon}
              </Badge>
            ) : (
              item.icon
            )}
          </ListItemIcon>
        )}
        {!collapsed && (
          <>
            <ListItemText
              primary={item.label}
              primaryTypographyProps={{
                variant: 'body2',
                fontWeight: isActive ? 600 : 400,
              }}
            />
            {!collapsed && item.badge !== undefined && !item.icon && (
              <Badge
                badgeContent={item.badge}
                color={item.badgeColor || 'primary'}
                max={99}
              />
            )}
            {hasChildren && (
              isExpanded ? <ExpandLess /> : <ExpandMore />
            )}
          </>
        )}
      </ListItemButton>
    );

    return (
      <React.Fragment key={itemId}>
        {collapsed && item.icon ? (
          <Tooltip title={item.label} placement="right">
            {button}
          </Tooltip>
        ) : (
          button
        )}
        {hasChildren && !collapsed && (
          <Collapse in={isExpanded} timeout="auto" unmountOnExit>
            <List component="div" disablePadding>
              {item.children!.map(child => renderItem(child, depth + 1))}
            </List>
          </Collapse>
        )}
        {item.divider && <Divider sx={{ my: 1, mx: 2 }} />}
      </React.Fragment>
    );
  };

  return (
    <Box
      sx={{
        width: collapsed ? collapsedWidth : width,
        flexShrink: 0,
        bgcolor,
        borderRight: 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        transition: 'width 0.2s ease-in-out',
        overflow: 'hidden',
        ...sx,
      }}
    >
      {/* Header */}
      {header && (
        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
          {header}
        </Box>
      )}

      {/* Navigation items */}
      <Box sx={{ flex: 1, overflow: 'auto', py: 1 }}>
        <List component="nav" disablePadding>
          {items.map(item => renderItem(item))}
        </List>
      </Box>

      {/* Footer */}
      {footer && (
        <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
          {footer}
        </Box>
      )}

      {/* Collapse button */}
      {collapsible && (
        <Box
          sx={{
            p: 1,
            borderTop: 1,
            borderColor: 'divider',
            display: 'flex',
            justifyContent: collapsed ? 'center' : 'flex-end',
          }}
        >
          <IconButton
            size="small"
            onClick={() => onCollapse?.(!collapsed)}
            sx={{ bgcolor: 'action.hover' }}
          >
            {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          </IconButton>
        </Box>
      )}
    </Box>
  );
};

export default TSidebar;
