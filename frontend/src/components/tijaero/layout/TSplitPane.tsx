/**
 * TSplitPane Component
 * 
 * Resizable split pane layout for master-detail views.
 * Supports horizontal and vertical splits with drag-to-resize.
 * 
 * @example Horizontal split (left-right)
 * ```tsx
 * <TSplitPane
 *   left={<MasterList />}
 *   right={<DetailView />}
 *   defaultLeftWidth={300}
 * />
 * ```
 * 
 * @example Vertical split (top-bottom)
 * ```tsx
 * <TSplitPane
 *   orientation="vertical"
 *   top={<CodeEditor />}
 *   bottom={<OutputPanel />}
 *   defaultTopHeight={400}
 * />
 * ```
 */

import React from 'react';
import { Box } from '@mui/material';

export interface TSplitPaneProps {
  /** Left/Top pane content */
  left?: React.ReactNode;
  top?: React.ReactNode;
  /** Right/Bottom pane content */
  right?: React.ReactNode;
  bottom?: React.ReactNode;
  /** Split orientation */
  orientation?: 'horizontal' | 'vertical';
  /** Default left pane width (horizontal) or top pane height (vertical) */
  defaultLeftWidth?: number;
  defaultTopHeight?: number;
  /** Minimum left/top pane size */
  minLeftWidth?: number;
  minTopHeight?: number;
  /** Maximum left/top pane size */
  maxLeftWidth?: number;
  maxTopHeight?: number;
  /** Enable drag-to-resize */
  resizable?: boolean;
  /** Divider width/height */
  dividerSize?: number;
  /** Collapse left/top pane */
  collapsed?: boolean;
  /** Collapsed pane size */
  collapsedSize?: number;
  /** Callback when size changes */
  onResize?: (size: number) => void;
  /** Custom styles */
  sx?: object;
}

export const TSplitPane: React.FC<TSplitPaneProps> = ({
  left,
  top,
  right,
  bottom,
  orientation = 'horizontal',
  defaultLeftWidth = 300,
  defaultTopHeight = 300,
  minLeftWidth = 150,
  minTopHeight = 100,
  maxLeftWidth = 600,
  maxTopHeight = 600,
  resizable = true,
  dividerSize = 8,
  collapsed = false,
  collapsedSize = 0,
  onResize,
  sx,
}) => {
  const isHorizontal = orientation === 'horizontal';
  const primaryPane = isHorizontal ? left : top;
  const secondaryPane = isHorizontal ? right : bottom;
  
  const defaultSize = isHorizontal ? defaultLeftWidth : defaultTopHeight;
  const minSize = isHorizontal ? minLeftWidth : minTopHeight;
  const maxSize = isHorizontal ? maxLeftWidth : maxTopHeight;
  
  const [paneSize, setPaneSize] = React.useState(defaultSize);
  const [isDragging, setIsDragging] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const startPosRef = React.useRef(0);
  const startSizeRef = React.useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!resizable) return;
    e.preventDefault();
    setIsDragging(true);
    startPosRef.current = isHorizontal ? e.clientX : e.clientY;
    startSizeRef.current = paneSize;
  };

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      
      const currentPos = isHorizontal ? e.clientX : e.clientY;
      const delta = currentPos - startPosRef.current;
      const newSize = Math.min(maxSize, Math.max(minSize, startSizeRef.current + delta));
      
      setPaneSize(newSize);
      onResize?.(newSize);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, isHorizontal, maxSize, minSize, onResize]);

  const actualSize = collapsed ? collapsedSize : paneSize;

  return (
    <Box
      ref={containerRef}
      sx={{
        display: 'flex',
        flexDirection: isHorizontal ? 'row' : 'column',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        ...sx,
      }}
    >
      {/* Primary pane (left/top) */}
      <Box
        sx={{
          [isHorizontal ? 'width' : 'height']: actualSize,
          flexShrink: 0,
          overflow: 'auto',
          transition: collapsed ? 'all 0.2s ease-in-out' : undefined,
        }}
      >
        {primaryPane}
      </Box>

      {/* Resizable divider */}
      <Box
        onMouseDown={handleMouseDown}
        sx={{
          [isHorizontal ? 'width' : 'height']: dividerSize,
          flexShrink: 0,
          bgcolor: isDragging ? 'primary.main' : 'divider',
          cursor: resizable ? (isHorizontal ? 'col-resize' : 'row-resize') : 'default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background-color 0.2s',
          '&:hover': resizable ? {
            bgcolor: 'primary.light',
          } : {},
          // Visual indicator dots
          '&::before': {
            content: '""',
            display: 'block',
            [isHorizontal ? 'width' : 'height']: 4,
            [isHorizontal ? 'height' : 'width']: 30,
            bgcolor: isDragging ? 'primary.contrastText' : 'action.disabled',
            borderRadius: 2,
          },
        }}
      />

      {/* Secondary pane (right/bottom) */}
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          overflow: 'auto',
        }}
      >
        {secondaryPane}
      </Box>
    </Box>
  );
};

export default TSplitPane;
