/**
 * TCardLayout Component
 * 
 * Layout component for organizing content in cards with consistent spacing.
 * Supports various card arrangements and responsive behavior.
 * 
 * @example Basic card layout
 * ```tsx
 * <TCardLayout>
 *   <TCardLayout.Card title="Summary">
 *     <SummaryContent />
 *   </TCardLayout.Card>
 *   <TCardLayout.Card title="Details">
 *     <DetailsContent />
 *   </TCardLayout.Card>
 * </TCardLayout>
 * ```
 * 
 * @example Grid of stat cards
 * ```tsx
 * <TCardLayout columns={4} spacing={2}>
 *   <TStatCard title="Revenue" value={125000} />
 *   <TStatCard title="Orders" value={48} />
 *   <TStatCard title="Customers" value={156} />
 *   <TStatCard title="Products" value={89} />
 * </TCardLayout>
 * ```
 */

import React from 'react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  CardActions,
  Collapse,
  IconButton,
  Typography,
  Divider,
  Skeleton,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

// Card Layout Container
export interface TCardLayoutProps {
  /** Child cards or content */
  children: React.ReactNode;
  /** Number of columns (for grid layout) */
  columns?: number | { xs?: number; sm?: number; md?: number; lg?: number; xl?: number };
  /** Spacing between cards */
  spacing?: number;
  /** Stack cards vertically */
  stack?: boolean;
  /** Custom styles */
  sx?: object;
}

const TCardLayoutComponent: React.FC<TCardLayoutProps> = ({
  children,
  columns,
  spacing = 3,
  stack = false,
  sx,
}) => {
  // If columns specified, use grid layout
  if (columns) {
    const getGridTemplateColumns = () => {
      if (typeof columns === 'number') {
        return `repeat(${columns}, 1fr)`;
      }
      // For responsive columns, we'll use CSS grid with media queries
      return `repeat(${columns.xs || 1}, 1fr)`;
    };

    return (
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: getGridTemplateColumns(),
          gap: spacing,
          ...(typeof columns === 'object' && {
            '@media (min-width: 600px)': {
              gridTemplateColumns: `repeat(${columns.sm || columns.xs || 1}, 1fr)`,
            },
            '@media (min-width: 900px)': {
              gridTemplateColumns: `repeat(${columns.md || columns.sm || columns.xs || 1}, 1fr)`,
            },
            '@media (min-width: 1200px)': {
              gridTemplateColumns: `repeat(${columns.lg || columns.md || columns.sm || columns.xs || 1}, 1fr)`,
            },
            '@media (min-width: 1536px)': {
              gridTemplateColumns: `repeat(${columns.xl || columns.lg || columns.md || columns.sm || columns.xs || 1}, 1fr)`,
            },
          }),
          ...sx,
        }}
      >
        {children}
      </Box>
    );
  }

  // Default: stack layout
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: stack ? 'column' : 'row',
        flexWrap: stack ? 'nowrap' : 'wrap',
        gap: spacing,
        ...sx,
      }}
    >
      {children}
    </Box>
  );
};

// Individual Card Component
export interface TLayoutCardProps {
  /** Card title */
  title?: string;
  /** Card subtitle */
  subtitle?: string;
  /** Header action button/element */
  action?: React.ReactNode;
  /** Card content */
  children: React.ReactNode;
  /** Footer actions */
  footer?: React.ReactNode;
  /** Make card collapsible */
  collapsible?: boolean;
  /** Default collapsed state */
  defaultCollapsed?: boolean;
  /** Card elevation */
  elevation?: number;
  /** Remove padding from content */
  noPadding?: boolean;
  /** Show loading skeleton */
  loading?: boolean;
  /** Minimum height */
  minHeight?: number | string;
  /** Fill available height */
  fullHeight?: boolean;
  /** Custom styles */
  sx?: object;
}

const TLayoutCard: React.FC<TLayoutCardProps> = ({
  title,
  subtitle,
  action,
  children,
  footer,
  collapsible = false,
  defaultCollapsed = false,
  elevation = 1,
  noPadding = false,
  loading = false,
  minHeight,
  fullHeight = false,
  sx,
}) => {
  const [expanded, setExpanded] = React.useState(!defaultCollapsed);

  const handleExpandClick = () => {
    setExpanded(!expanded);
  };

  if (loading) {
    return (
      <Card
        elevation={elevation}
        sx={{
          minHeight,
          height: fullHeight ? '100%' : 'auto',
          display: 'flex',
          flexDirection: 'column',
          ...sx,
        }}
      >
        {title && (
          <CardHeader
            title={<Skeleton width={150} height={28} />}
            subheader={subtitle && <Skeleton width={100} height={20} />}
          />
        )}
        <CardContent sx={{ flex: 1 }}>
          <Skeleton variant="rectangular" height={100} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      elevation={elevation}
      sx={{
        minHeight,
        height: fullHeight ? '100%' : 'auto',
        display: 'flex',
        flexDirection: 'column',
        ...sx,
      }}
    >
      {(title || action || collapsible) && (
        <CardHeader
          title={
            title && (
              <Typography variant="h6" component="h2">
                {title}
              </Typography>
            )
          }
          subheader={subtitle}
          action={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {action}
              {collapsible && (
                <IconButton
                  onClick={handleExpandClick}
                  size="small"
                  sx={{
                    transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.3s',
                  }}
                >
                  <ExpandMoreIcon />
                </IconButton>
              )}
            </Box>
          }
          sx={{ pb: title && !collapsible ? 1 : 2 }}
        />
      )}

      {title && <Divider />}

      <Collapse in={!collapsible || expanded} timeout="auto">
        <CardContent
          sx={{
            flex: 1,
            p: noPadding ? 0 : 2,
            '&:last-child': { pb: noPadding ? 0 : 2 },
          }}
        >
          {children}
        </CardContent>

        {footer && (
          <>
            <Divider />
            <CardActions sx={{ justifyContent: 'flex-end', p: 2 }}>
              {footer}
            </CardActions>
          </>
        )}
      </Collapse>
    </Card>
  );
};

// Compound component pattern
export const TCardLayout = Object.assign(TCardLayoutComponent, {
  Card: TLayoutCard,
});

export default TCardLayout;
