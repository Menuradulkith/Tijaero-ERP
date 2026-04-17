/**
 * SearchableList - Tijaero-style master list panel component
 * 
 * Provides a consistent searchable list with:
 * - Search input
 * - Sort options dropdown
 * - Scrollable list area
 * - Loading state
 * - Empty state
 */

import React from "react";
import {
  Box,
  Paper,
  TextField,
  InputAdornment,
  Button,
  Menu,
  MenuItem,
  List,
  Typography,
  Skeleton,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import SortIcon from "@mui/icons-material/Sort";
import { SearchableListProps, BaseEntity } from "../types";

export function SearchableList<T extends BaseEntity>({
  items,
  children,
  isLoading = false,
  searchValue,
  searchQuery,
  onSearchChange,
  placeholder,
  searchPlaceholder,
  sortOptions,
  sortField,
  currentSort,
  onSortChange,
  selectedItem,
  renderItem,
  emptyMessage = "No items found",
  width = 280,
  listHeader,
  virtualize = false,
  estimatedItemHeight = 84,
  overscanCount = 6,
  sx,
}: SearchableListProps<T>) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const [sortAnchorEl, setSortAnchorEl] = React.useState<null | HTMLElement>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportHeight, setViewportHeight] = React.useState(0);
  const listRef = React.useRef<HTMLUListElement | null>(null);

  // Support both searchValue and searchQuery
  const currentSearchValue = searchValue ?? searchQuery ?? "";
  // Support both placeholder and searchPlaceholder
  const currentPlaceholder = searchPlaceholder ?? placeholder ?? "Search...";
  // Support both sortField and currentSort
  const currentSortField = currentSort ?? sortField;

  const handleSortClick = (event: React.MouseEvent<HTMLElement>) => {
    setSortAnchorEl(event.currentTarget);
  };

  const handleSortClose = () => {
    setSortAnchorEl(null);
  };

  const handleSortSelect = (field: string) => {
    onSortChange?.(field);
    handleSortClose();
  };

  const childNodes = React.useMemo(() => React.Children.toArray(children), [children]);
  const itemNodes = React.useMemo(
    () =>
      items && renderItem
        ? items.map((item) => renderItem(item, selectedItem?.id === item.id))
        : [],
    [items, renderItem, selectedItem],
  );
  const listNodes = children ? childNodes : itemNodes;

  // Determine if list is empty
  const isEmpty = listNodes.length === 0;

  const shouldVirtualize = virtualize && !isLoading && !isEmpty;

  React.useEffect(() => {
    if (!shouldVirtualize) return;

    const listElement = listRef.current;
    if (!listElement) return;

    const updateHeight = () => setViewportHeight(listElement.clientHeight);
    updateHeight();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateHeight);
      observer.observe(listElement);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, [shouldVirtualize]);

  const totalRows = listNodes.length;
  const rowHeight = Math.max(estimatedItemHeight, 1);
  const totalHeight = totalRows * rowHeight;
  const visibleRows = Math.max(1, Math.ceil(viewportHeight / rowHeight));
  const startIndex = shouldVirtualize
    ? Math.max(0, Math.floor(scrollTop / rowHeight) - overscanCount)
    : 0;
  const endIndex = shouldVirtualize
    ? Math.min(totalRows, startIndex + visibleRows + overscanCount * 2)
    : totalRows;
  const visibleNodes = shouldVirtualize
    ? listNodes.slice(startIndex, endIndex)
    : listNodes;
  const topSpacerHeight = shouldVirtualize ? startIndex * rowHeight : 0;
  const bottomSpacerHeight = shouldVirtualize
    ? Math.max(0, totalHeight - endIndex * rowHeight)
    : 0;

  return (
    <Paper
      elevation={0}
      sx={{
        width: isMobile ? "100%" : width,
        minWidth: isMobile ? "100%" : 240,
        maxWidth: isMobile ? "100%" : 300,
        borderRight: 1,
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        maxHeight: isMobile ? 350 : "100%",
        overflow: "hidden",
        ...sx,
      }}
    >
      {/* Search Input */}
      <Box sx={{ p: 1, borderBottom: 1, borderColor: "divider" }}>
        <TextField
          size="small"
          placeholder={currentPlaceholder}
          value={currentSearchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          fullWidth
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
      </Box>

      {/* Sort Options */}
      {sortOptions && sortOptions.length > 0 && (
        <Box
          sx={{
            px: 1.5,
            py: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Button
            size="small"
            startIcon={<SortIcon />}
            onClick={handleSortClick}
            sx={{ textTransform: "none" }}
          >
            Sort by:{" "}
            {sortOptions.find((opt) => opt.value === currentSortField)?.label || "Default"}
          </Button>
          <Menu
            anchorEl={sortAnchorEl}
            open={Boolean(sortAnchorEl)}
            onClose={handleSortClose}
          >
            {sortOptions.map((option) => (
              <MenuItem
                key={option.value}
                selected={currentSortField === option.value}
                onClick={() => handleSortSelect(option.value)}
              >
                {option.label}
              </MenuItem>
            ))}
          </Menu>
        </Box>
      )}

      {/* Custom Header */}
      {listHeader}

      {/* List */}
      <List
        ref={listRef}
        onScroll={
          shouldVirtualize
            ? (event) => setScrollTop(event.currentTarget.scrollTop)
            : undefined
        }
        sx={{ flex: 1, overflow: "auto", py: 0 }}
      >
        {isLoading ? (
          <Box sx={{ p: 1 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 1.5 }}>
                <Skeleton variant="circular" width={32} height={32} animation="wave" />
                <Box sx={{ flex: 1 }}>
                  <Skeleton variant="text" width="70%" animation="wave" />
                  <Skeleton variant="text" width="40%" height={14} animation="wave" />
                </Box>
              </Box>
            ))}
          </Box>
        ) : isEmpty && !children ? (
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              p: 4,
              color: "text.secondary",
            }}
          >
            <Typography variant="body2">{emptyMessage}</Typography>
          </Box>
        ) : shouldVirtualize ? (
          <>
            {topSpacerHeight > 0 && (
              <Box component="li" sx={{ height: topSpacerHeight, p: 0, m: 0, listStyle: "none" }} />
            )}
            {visibleNodes}
            {bottomSpacerHeight > 0 && (
              <Box component="li" sx={{ height: bottomSpacerHeight, p: 0, m: 0, listStyle: "none" }} />
            )}
          </>
        ) : (
          listNodes
        )}
      </List>
    </Paper>
  );
}

export default SearchableList;
