/**
 * TGridLayout Component
 * 
 * Responsive grid layout using CSS Grid for complex layouts.
 * Provides an easy way to create multi-column layouts with named areas.
 * 
 * @example Basic responsive grid
 * ```tsx
 * <TGridLayout columns={{ xs: 1, sm: 2, md: 3, lg: 4 }} spacing={2}>
 *   <TGridItem><Card1 /></TGridItem>
 *   <TGridItem><Card2 /></TGridItem>
 *   <TGridItem><Card3 /></TGridItem>
 *   <TGridItem><Card4 /></TGridItem>
 * </TGridLayout>
 * ```
 * 
 * @example With column spans
 * ```tsx
 * <TGridLayout columns={12} spacing={3}>
 *   <TGridItem colSpan={8}>
 *     <MainContent />
 *   </TGridItem>
 *   <TGridItem colSpan={4}>
 *     <Sidebar />
 *   </TGridItem>
 * </TGridLayout>
 * ```
 * 
 * @example Named grid areas
 * ```tsx
 * <TGridLayout
 *   areas={`
 *     "header header"
 *     "sidebar main"
 *     "footer footer"
 *   `}
 *   rows="auto 1fr auto"
 *   columns="250px 1fr"
 * >
 *   <TGridItem area="header"><Header /></TGridItem>
 *   <TGridItem area="sidebar"><Sidebar /></TGridItem>
 *   <TGridItem area="main"><Main /></TGridItem>
 *   <TGridItem area="footer"><Footer /></TGridItem>
 * </TGridLayout>
 * ```
 */

import React from 'react';
import { Box } from '@mui/material';

export interface TGridLayoutProps {
  /** Child grid items */
  children: React.ReactNode;
  /** Number of columns (can be responsive object) */
  columns?: number | { xs?: number; sm?: number; md?: number; lg?: number; xl?: number } | string;
  /** Row definitions (CSS grid-template-rows) */
  rows?: string;
  /** Grid template areas (CSS grid-template-areas) */
  areas?: string;
  /** Gap between grid items */
  spacing?: number;
  /** Row gap (overrides spacing for rows) */
  rowSpacing?: number;
  /** Column gap (overrides spacing for columns) */
  columnSpacing?: number;
  /** Align items within the grid */
  alignItems?: 'start' | 'center' | 'end' | 'stretch';
  /** Justify items within the grid */
  justifyItems?: 'start' | 'center' | 'end' | 'stretch';
  /** Minimum height */
  minHeight?: string | number;
  /** Custom styles */
  sx?: object;
}

export const TGridLayout: React.FC<TGridLayoutProps> = ({
  children,
  columns = 12,
  rows,
  areas,
  spacing = 2,
  rowSpacing,
  columnSpacing,
  alignItems = 'stretch',
  justifyItems = 'stretch',
  minHeight,
  sx,
}) => {
  const getGridTemplateColumns = () => {
    if (areas) {
      return columns as string;
    }
    if (typeof columns === 'string') {
      return columns;
    }
    if (typeof columns === 'number') {
      return `repeat(${columns}, 1fr)`;
    }
    return `repeat(${columns.xs || 1}, 1fr)`;
  };

  const getResponsiveStyles = () => {
    if (typeof columns !== 'object') return {};

    return {
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
    };
  };

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: getGridTemplateColumns(),
        gridTemplateRows: rows,
        gridTemplateAreas: areas,
        gap: spacing,
        rowGap: rowSpacing,
        columnGap: columnSpacing,
        alignItems,
        justifyItems,
        minHeight,
        ...getResponsiveStyles(),
        ...sx,
      }}
    >
      {children}
    </Box>
  );
};

// Grid Item Component
export interface TGridItemProps {
  /** Child content */
  children: React.ReactNode;
  /** Column span */
  colSpan?: number | { xs?: number; sm?: number; md?: number; lg?: number; xl?: number };
  /** Row span */
  rowSpan?: number;
  /** Grid area name (when using areas) */
  area?: string;
  /** Align self */
  alignSelf?: 'start' | 'center' | 'end' | 'stretch';
  /** Justify self */
  justifySelf?: 'start' | 'center' | 'end' | 'stretch';
  /** Custom styles */
  sx?: object;
}

export const TGridItem: React.FC<TGridItemProps> = ({
  children,
  colSpan,
  rowSpan,
  area,
  alignSelf,
  justifySelf,
  sx,
}) => {
  const getColSpanStyles = () => {
    if (!colSpan) return {};
    
    if (typeof colSpan === 'number') {
      return { gridColumn: `span ${colSpan}` };
    }

    return {
      gridColumn: `span ${colSpan.xs || 1}`,
      '@media (min-width: 600px)': {
        gridColumn: `span ${colSpan.sm || colSpan.xs || 1}`,
      },
      '@media (min-width: 900px)': {
        gridColumn: `span ${colSpan.md || colSpan.sm || colSpan.xs || 1}`,
      },
      '@media (min-width: 1200px)': {
        gridColumn: `span ${colSpan.lg || colSpan.md || colSpan.sm || colSpan.xs || 1}`,
      },
      '@media (min-width: 1536px)': {
        gridColumn: `span ${colSpan.xl || colSpan.lg || colSpan.md || colSpan.sm || colSpan.xs || 1}`,
      },
    };
  };

  return (
    <Box
      sx={{
        ...getColSpanStyles(),
        ...(rowSpan && { gridRow: `span ${rowSpan}` }),
        ...(area && { gridArea: area }),
        alignSelf,
        justifySelf,
        minWidth: 0, // Prevent overflow in grid items
        ...sx,
      }}
    >
      {children}
    </Box>
  );
};

// Attach GridItem to GridLayout for convenience
Object.assign(TGridLayout, { Item: TGridItem });

export default TGridLayout;
