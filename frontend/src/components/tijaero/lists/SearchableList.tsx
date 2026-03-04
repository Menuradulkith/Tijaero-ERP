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
  sx,
}: SearchableListProps<T>) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  
  const [sortAnchorEl, setSortAnchorEl] = React.useState<null | HTMLElement>(null);

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

  // Determine if list is empty
  const isEmpty = items ? items.length === 0 : !children || (Array.isArray(children) && children.length === 0);

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
      <List sx={{ flex: 1, overflow: "auto", py: 0 }}>
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
        ) : children ? (
          // Render children directly if provided
          children
        ) : items ? (
          // Render items using renderItem function
          items.map((item) =>
            renderItem?.(item, selectedItem?.id === item.id)
          )
        ) : null}
      </List>
    </Paper>
  );
}

export default SearchableList;
