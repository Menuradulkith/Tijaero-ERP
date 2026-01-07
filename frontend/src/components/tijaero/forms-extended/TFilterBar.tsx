/**
 * TFilterBar - Standardized filter bar component
 * 
 * Configurable filter panel for data grids and lists.
 * 
 * @example
 * ```tsx
 * <TFilterBar
 *   filters={[
 *     { key: "status", label: "Status", type: "select", options: statusOptions },
 *     { key: "branch", label: "Branch", type: "text" },
 *     { key: "dateFrom", label: "From Date", type: "date" },
 *   ]}
 *   values={filterValues}
 *   onChange={setFilterValues}
 *   onReset={handleReset}
 * />
 * ```
 */

import React from "react";
import {
  Box,
  Paper,
  TextField,
  MenuItem,
  Autocomplete,
  IconButton,
  Tooltip,
  Collapse,
  Typography,
} from "@mui/material";
import FilterListIcon from "@mui/icons-material/FilterList";
import ClearIcon from "@mui/icons-material/Clear";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { TButton } from "../base/TButton";

export interface TFilterConfig {
  /** Filter key (corresponds to value key) */
  key: string;
  /** Filter label */
  label: string;
  /** Filter type */
  type: "text" | "select" | "multiselect" | "autocomplete" | "date" | "daterange" | "number" | "boolean";
  /** Options for select/multiselect/autocomplete */
  options?: { value: string | number; label: string }[];
  /** Autocomplete options (for complex objects) */
  autocompleteOptions?: unknown[];
  /** Get option label for autocomplete */
  getOptionLabel?: (option: unknown) => string;
  /** Placeholder text */
  placeholder?: string;
  /** Filter width */
  width?: number | string;
  /** Default value */
  defaultValue?: unknown;
}

export interface TFilterBarProps {
  /** Filter configurations */
  filters: TFilterConfig[];
  /** Current filter values */
  values: Record<string, unknown>;
  /** Change handler */
  onChange: (key: string, value: unknown) => void;
  /** Reset all filters */
  onReset?: () => void;
  /** Apply filters (for deferred filtering) */
  onApply?: () => void;
  /** Collapsible */
  collapsible?: boolean;
  /** Default collapsed */
  defaultCollapsed?: boolean;
  /** Show filter icon */
  showIcon?: boolean;
  /** Show reset button */
  showReset?: boolean;
  /** Show apply button */
  showApply?: boolean;
  /** Variant */
  variant?: "paper" | "inline";
  /** Compact mode */
  compact?: boolean;
}

export const TFilterBar: React.FC<TFilterBarProps> = ({
  filters,
  values,
  onChange,
  onReset,
  onApply,
  collapsible = false,
  defaultCollapsed = false,
  showIcon = true,
  showReset = true,
  showApply = false,
  variant = "paper",
  compact = false,
}) => {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);

  // Check if any filters are active
  const hasActiveFilters = Object.values(values).some(
    (v) => v !== "" && v !== null && v !== undefined
  );

  // Handle filter change
  const handleChange = (key: string, value: unknown) => {
    onChange(key, value);
  };

  // Render filter input based on type
  const renderFilter = (config: TFilterConfig): React.ReactNode => {
    const value = values[config.key] ?? config.defaultValue ?? "";
    const width = config.width || (compact ? 150 : 200);

    switch (config.type) {
      case "select":
        return (
          <TextField
            key={config.key}
            select
            size="small"
            label={config.label}
            value={value}
            onChange={(e) => handleChange(config.key, e.target.value)}
            placeholder={config.placeholder}
            sx={{ width }}
          >
            <MenuItem value="">
              <em>All</em>
            </MenuItem>
            {config.options?.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>
                {opt.label}
              </MenuItem>
            ))}
          </TextField>
        );

      case "autocomplete":
        return (
          <Autocomplete
            key={config.key}
            size="small"
            value={value || null}
            options={config.autocompleteOptions || config.options || []}
            getOptionLabel={
              config.getOptionLabel ||
              ((opt) => {
                if (typeof opt === "object" && opt !== null) {
                  return (opt as { label?: string }).label || String(opt);
                }
                return String(opt);
              })
            }
            onChange={(_, newValue) => handleChange(config.key, newValue)}
            renderInput={(params) => (
              <TextField
                {...params}
                label={config.label}
                placeholder={config.placeholder}
              />
            )}
            sx={{ width }}
          />
        );

      case "date":
        return (
          <TextField
            key={config.key}
            type="date"
            size="small"
            label={config.label}
            value={value}
            onChange={(e) => handleChange(config.key, e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ width }}
          />
        );

      case "number":
        return (
          <TextField
            key={config.key}
            type="number"
            size="small"
            label={config.label}
            value={value}
            onChange={(e) => handleChange(config.key, e.target.value)}
            placeholder={config.placeholder}
            sx={{ width: width || 100 }}
          />
        );

      case "boolean":
        return (
          <TextField
            key={config.key}
            select
            size="small"
            label={config.label}
            value={value === "" ? "" : String(value)}
            onChange={(e) => {
              const val = e.target.value;
              handleChange(
                config.key,
                val === "" ? "" : val === "true"
              );
            }}
            sx={{ width: width || 120 }}
          >
            <MenuItem value="">
              <em>All</em>
            </MenuItem>
            <MenuItem value="true">Yes</MenuItem>
            <MenuItem value="false">No</MenuItem>
          </TextField>
        );

      default:
        return (
          <TextField
            key={config.key}
            size="small"
            label={config.label}
            value={value}
            onChange={(e) => handleChange(config.key, e.target.value)}
            placeholder={config.placeholder}
            sx={{ width }}
          />
        );
    }
  };

  const filterContent = (
    <Box
      sx={{
        display: "flex",
        flexWrap: "wrap",
        gap: compact ? 1 : 2,
        alignItems: "center",
      }}
    >
      {showIcon && (
        <FilterListIcon
          color={hasActiveFilters ? "primary" : "disabled"}
          sx={{ mr: compact ? 0 : 1 }}
        />
      )}

      {filters.map(renderFilter)}

      {showApply && onApply && (
        <TButton variant="primary" size="small" onClick={onApply}>
          Apply
        </TButton>
      )}

      {showReset && onReset && hasActiveFilters && (
        <Tooltip title="Clear all filters">
          <IconButton size="small" onClick={onReset}>
            <ClearIcon />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );

  if (variant === "inline") {
    return filterContent;
  }

  return (
    <Paper sx={{ mb: 2, p: compact ? 1.5 : 2 }}>
      {collapsible ? (
        <>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              cursor: "pointer",
              mb: collapsed ? 0 : 2,
            }}
            onClick={() => setCollapsed(!collapsed)}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <FilterListIcon color={hasActiveFilters ? "primary" : "inherit"} />
              <Typography variant="subtitle2">
                Filters
                {hasActiveFilters && (
                  <Typography
                    component="span"
                    color="primary"
                    sx={{ ml: 1 }}
                  >
                    (Active)
                  </Typography>
                )}
              </Typography>
            </Box>
            <IconButton size="small">
              {collapsed ? <ExpandMoreIcon /> : <ExpandLessIcon />}
            </IconButton>
          </Box>
          <Collapse in={!collapsed}>{filterContent}</Collapse>
        </>
      ) : (
        filterContent
      )}
    </Paper>
  );
};

export default TFilterBar;
