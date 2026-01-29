/**
 * TPaginationControls - Pagination controls component for paginated lists
 * 
 * Features:
 * - Page navigation (first, prev, next, last)
 * - Page size selector
 * - Current page indicator
 * - Loading state handling
 * 
 * @example
 * ```tsx
 * <TPaginationControls
 *   page={page}
 *   totalPages={totalPages}
 *   pageSize={pageSize}
 *   total={total}
 *   onPageChange={setPage}
 *   onPageSizeChange={setPageSize}
 *   isLoading={isFetching}
 * />
 * ```
 */

import React from "react";
import {
  Box,
  IconButton,
  Typography,
  Select,
  MenuItem,
  FormControl,
  CircularProgress,
  Tooltip,
} from "@mui/material";
import {
  FirstPage as FirstPageIcon,
  LastPage as LastPageIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
} from "@mui/icons-material";

export interface TPaginationControlsProps {
  /** Current page (1-indexed) */
  page: number;
  /** Total number of pages */
  totalPages: number;
  /** Current page size */
  pageSize: number;
  /** Total number of items */
  total: number;
  /** Page change handler */
  onPageChange: (page: number) => void;
  /** Page size change handler */
  onPageSizeChange?: (pageSize: number) => void;
  /** Available page sizes */
  pageSizeOptions?: number[];
  /** Loading state */
  isLoading?: boolean;
  /** Show page size selector */
  showPageSize?: boolean;
  /** Compact mode (less padding) */
  compact?: boolean;
}

export const TPaginationControls: React.FC<TPaginationControlsProps> = ({
  page,
  totalPages,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100, 200],
  isLoading = false,
  showPageSize = true,
  compact = false,
}) => {
  const startItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, total);

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 2,
        px: compact ? 1 : 2,
        py: compact ? 0.5 : 1,
        borderTop: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
      }}
    >
      {/* Left side: Page size selector */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {showPageSize && onPageSizeChange && (
          <>
            <Typography variant="body2" color="text.secondary">
              Rows per page:
            </Typography>
            <FormControl size="small" variant="standard">
              <Select
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                disabled={isLoading}
                sx={{ minWidth: 60 }}
              >
                {pageSizeOptions.map((size) => (
                  <MenuItem key={size} value={size}>
                    {size}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </>
        )}
      </Box>

      {/* Center: Item count */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {isLoading && <CircularProgress size={16} />}
        <Typography variant="body2" color="text.secondary">
          {total === 0 ? "No items" : `${startItem}-${endItem} of ${total.toLocaleString()}`}
        </Typography>
      </Box>

      {/* Right side: Navigation buttons */}
      <Box sx={{ display: "flex", alignItems: "center" }}>
        <Tooltip title="First page">
          <span>
            <IconButton
              size="small"
              onClick={() => onPageChange(1)}
              disabled={page === 1 || isLoading}
            >
              <FirstPageIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Previous page">
          <span>
            <IconButton
              size="small"
              onClick={() => onPageChange(page - 1)}
              disabled={page === 1 || isLoading}
            >
              <ChevronLeftIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Typography
          variant="body2"
          sx={{ mx: 1, minWidth: 80, textAlign: "center" }}
        >
          Page {page} of {totalPages || 1}
        </Typography>
        <Tooltip title="Next page">
          <span>
            <IconButton
              size="small"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages || isLoading}
            >
              <ChevronRightIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Last page">
          <span>
            <IconButton
              size="small"
              onClick={() => onPageChange(totalPages)}
              disabled={page >= totalPages || isLoading}
            >
              <LastPageIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
};

export default TPaginationControls;
