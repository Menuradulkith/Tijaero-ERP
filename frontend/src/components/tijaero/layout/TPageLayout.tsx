/**
 * TPageLayout Component
 * 
 * Standard page layout wrapper with consistent padding, max-width, and structure.
 * Provides the foundation for all ERP pages.
 * 
 * @example Basic usage
 * ```tsx
 * <TPageLayout>
 *   <TPageHeader title="Dashboard" />
 *   <YourContent />
 * </TPageLayout>
 * ```
 * 
 * @example Full-width page
 * ```tsx
 * <TPageLayout maxWidth={false}>
 *   <TDataGrid {...gridProps} />
 * </TPageLayout>
 * ```
 * 
 * @example With sidebar
 * ```tsx
 * <TPageLayout
 *   sidebar={<FiltersSidebar />}
 *   sidebarPosition="right"
 * >
 *   <MainContent />
 * </TPageLayout>
 * ```
 */

import React from 'react';
import {
  Box,
  Container,
  Paper,
  type ContainerProps,
} from '@mui/material';

export interface TPageLayoutProps {
  /** Page content */
  children: React.ReactNode;
  /** Maximum width of the content container */
  maxWidth?: ContainerProps['maxWidth'] | false;
  /** Add padding to the content */
  padding?: boolean;
  /** Custom padding value */
  paddingValue?: number;
  /** Wrap content in a Paper component */
  paper?: boolean;
  /** Paper elevation (if paper is true) */
  paperElevation?: number;
  /** Sidebar content */
  sidebar?: React.ReactNode;
  /** Sidebar position */
  sidebarPosition?: 'left' | 'right';
  /** Sidebar width */
  sidebarWidth?: number | string;
  /** Make sidebar collapsible */
  sidebarCollapsible?: boolean;
  /** Sidebar collapsed state (controlled) */
  sidebarCollapsed?: boolean;
  /** Callback when sidebar collapse state changes */
  onSidebarCollapse?: (collapsed: boolean) => void;
  /** Full height layout (100vh) */
  fullHeight?: boolean;
  /** Background color */
  bgcolor?: string;
  /** Custom styles */
  sx?: object;
}

export const TPageLayout: React.FC<TPageLayoutProps> = ({
  children,
  maxWidth = 'xl',
  padding = true,
  paddingValue = 3,
  paper = false,
  paperElevation = 0,
  sidebar,
  sidebarPosition = 'left',
  sidebarWidth = 280,
  sidebarCollapsible = false,
  sidebarCollapsed = false,
  fullHeight = false,
  bgcolor,
  sx,
}) => {
  const [internalCollapsed] = React.useState(sidebarCollapsed);
  const isCollapsed = sidebarCollapsible ? (sidebarCollapsed ?? internalCollapsed) : false;

  const contentElement = (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      {paper ? (
        <Paper
          elevation={paperElevation}
          sx={{
            p: padding ? paddingValue : 0,
            height: fullHeight ? '100%' : 'auto',
            borderRadius: 2,
          }}
        >
          {children}
        </Paper>
      ) : (
        children
      )}
    </Box>
  );

  const layoutContent = sidebar ? (
    <Box
      sx={{
        display: 'flex',
        flexDirection: sidebarPosition === 'right' ? 'row' : 'row-reverse',
        gap: 3,
        height: fullHeight ? '100%' : 'auto',
      }}
    >
      {/* Main content */}
      {contentElement}

      {/* Sidebar */}
      {!isCollapsed && (
        <Box
          sx={{
            width: sidebarWidth,
            flexShrink: 0,
            order: sidebarPosition === 'left' ? -1 : 1,
          }}
        >
          {sidebar}
        </Box>
      )}
    </Box>
  ) : (
    contentElement
  );

  // If maxWidth is false, don't use Container
  if (maxWidth === false) {
    return (
      <Box
        sx={{
          p: padding && !paper ? paddingValue : 0,
          height: fullHeight ? '100vh' : 'auto',
          bgcolor,
          ...sx,
        }}
      >
        {layoutContent}
      </Box>
    );
  }

  return (
    <Container
      maxWidth={maxWidth}
      sx={{
        py: padding && !paper ? paddingValue : 0,
        height: fullHeight ? '100vh' : 'auto',
        bgcolor,
        ...sx,
      }}
    >
      {layoutContent}
    </Container>
  );
};

export default TPageLayout;
