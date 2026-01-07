/**
 * TSection Component
 * 
 * Content section with optional title, description, and collapsible behavior.
 * Use for organizing page content into logical sections.
 * 
 * @example Basic section
 * ```tsx
 * <TSection title="Order Details">
 *   <OrderForm />
 * </TSection>
 * ```
 * 
 * @example Collapsible section
 * ```tsx
 * <TSection
 *   title="Advanced Options"
 *   description="Configure advanced settings"
 *   collapsible
 *   defaultCollapsed
 * >
 *   <AdvancedSettings />
 * </TSection>
 * ```
 * 
 * @example With actions
 * ```tsx
 * <TSection
 *   title="Line Items"
 *   action={<TButton size="small" startIcon={<AddIcon />}>Add Item</TButton>}
 * >
 *   <LineItemsTable />
 * </TSection>
 * ```
 */

import React from 'react';
import {
  Box,
  Typography,
  Collapse,
  IconButton,
  Divider,
  Paper,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

export interface TSectionProps {
  /** Section title */
  title?: string;
  /** Section description/subtitle */
  description?: string;
  /** Section content */
  children: React.ReactNode;
  /** Make section collapsible */
  collapsible?: boolean;
  /** Default collapsed state (for collapsible sections) */
  defaultCollapsed?: boolean;
  /** Controlled collapsed state */
  collapsed?: boolean;
  /** Callback when collapse state changes */
  onCollapse?: (collapsed: boolean) => void;
  /** Action element (displayed in header) */
  action?: React.ReactNode;
  /** Icon to display before title */
  icon?: React.ReactNode;
  /** Show divider below header */
  divider?: boolean;
  /** Wrap content in Paper */
  paper?: boolean;
  /** Paper elevation (if paper is true) */
  elevation?: number;
  /** Remove padding from content */
  noPadding?: boolean;
  /** Add margin bottom */
  marginBottom?: number;
  /** Custom styles */
  sx?: object;
}

export const TSection: React.FC<TSectionProps> = ({
  title,
  description,
  children,
  collapsible = false,
  defaultCollapsed = false,
  collapsed: controlledCollapsed,
  onCollapse,
  action,
  icon,
  divider = false,
  paper = false,
  elevation = 1,
  noPadding = false,
  marginBottom = 3,
  sx,
}) => {
  const [internalCollapsed, setInternalCollapsed] = React.useState(defaultCollapsed);
  
  const isControlled = controlledCollapsed !== undefined;
  const isCollapsed = isControlled ? controlledCollapsed : internalCollapsed;

  const handleToggle = () => {
    if (isControlled) {
      onCollapse?.(!controlledCollapsed);
    } else {
      setInternalCollapsed(!internalCollapsed);
      onCollapse?.(!internalCollapsed);
    }
  };

  const hasHeader = title || action || collapsible;

  const content = (
    <Box sx={{ ...sx }}>
      {/* Header */}
      {hasHeader && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: divider ? 0 : 2,
            pb: divider ? 1.5 : 0,
            cursor: collapsible ? 'pointer' : 'default',
          }}
          onClick={collapsible ? handleToggle : undefined}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1 }}>
            {icon && (
              <Box
                sx={{
                  display: 'flex',
                  color: 'primary.main',
                  '& svg': { fontSize: 24 },
                }}
              >
                {icon}
              </Box>
            )}
            <Box>
              {title && (
                <Typography
                  variant="h6"
                  component="h2"
                  sx={{ fontWeight: 600, lineHeight: 1.3 }}
                >
                  {title}
                </Typography>
              )}
              {description && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 0.25 }}
                >
                  {description}
                </Typography>
              )}
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {action && (
              <Box onClick={(e) => e.stopPropagation()}>
                {action}
              </Box>
            )}
            {collapsible && (
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggle();
                }}
                sx={{
                  transition: 'transform 0.2s',
                }}
              >
                {isCollapsed ? <ExpandMoreIcon /> : <ExpandLessIcon />}
              </IconButton>
            )}
          </Box>
        </Box>
      )}

      {/* Divider */}
      {divider && hasHeader && <Divider sx={{ mb: 2 }} />}

      {/* Content */}
      {collapsible ? (
        <Collapse in={!isCollapsed} timeout="auto">
          <Box sx={{ p: noPadding ? 0 : undefined }}>
            {children}
          </Box>
        </Collapse>
      ) : (
        <Box sx={{ p: noPadding ? 0 : undefined }}>
          {children}
        </Box>
      )}
    </Box>
  );

  if (paper) {
    return (
      <Paper
        elevation={elevation}
        sx={{
          p: noPadding ? 0 : 3,
          mb: marginBottom,
          borderRadius: 2,
        }}
      >
        {content}
      </Paper>
    );
  }

  return (
    <Box sx={{ mb: marginBottom }}>
      {content}
    </Box>
  );
};

export default TSection;
