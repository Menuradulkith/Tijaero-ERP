/**
 * TSearchableSelect - Drop-in replacement for TextField select with search
 * 
 * Provides a searchable dropdown that can easily replace any <TextField select>
 * pattern in the ERP. Uses MUI Autocomplete internally.
 * 
 * @example
 * // Replace this:
 * <TextField
 *   select
 *   label="Status"
 *   value={status}
 *   onChange={(e) => setStatus(e.target.value)}
 * >
 *   {options.map(opt => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
 * </TextField>
 * 
 * // With this:
 * <TSearchableSelect
 *   label="Status"
 *   value={status}
 *   onChange={setStatus}
 *   options={options}
 * />
 */

import {
  Autocomplete,
  TextField,
  Box,
  Typography,
  Chip,
} from "@mui/material";
import { SyntheticEvent } from "react";

export interface TSearchableSelectOption {
  value: string | number;
  label: string;
  /** Optional secondary text */
  secondary?: string;
  /** Optional color for chip display */
  color?: "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning";
  /** Optional icon */
  icon?: React.ReactNode;
  /** Disabled option */
  disabled?: boolean;
}

export interface TSearchableSelectProps {
  /** Input label */
  label: string;
  /** Current value (can be value or the full option object) */
  value: string | number | null | undefined;
  /** Change handler - receives the value (not the full option) */
  onChange: (value: string | number | null) => void;
  /** Options array - can be simple {value, label} or extended with secondary, color */
  options: TSearchableSelectOption[];
  /** Placeholder text */
  placeholder?: string;
  /** Required field */
  required?: boolean;
  /** Error state or message */
  error?: boolean | string;
  /** Helper text */
  helperText?: string;
  /** Size variant */
  size?: "small" | "medium";
  /** Full width */
  fullWidth?: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Read-only view mode */
  viewMode?: boolean;
  /** Allow clearing the selection */
  clearable?: boolean;
  /** Custom styles */
  sx?: object;
  /** No options text */
  noOptionsText?: string;
  /** Show "All" option at the top */
  showAllOption?: boolean;
  /** Label for "All" option */
  allOptionLabel?: string;
  /** Multiple selection */
  multiple?: boolean;
  /** Group options by a function */
  groupBy?: (option: TSearchableSelectOption) => string;
}

/**
 * A searchable select dropdown that replaces TextField with select prop.
 * Supports searching/filtering options as the user types.
 */
export function TSearchableSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  required = false,
  error,
  helperText,
  size = "small",
  fullWidth = true,
  disabled = false,
  viewMode = false,
  clearable = true,
  sx,
  noOptionsText = "No options found",
  showAllOption = false,
  allOptionLabel = "All",
  multiple = false,
  groupBy,
}: TSearchableSelectProps) {
  // Build options list with optional "All" at top
  const allOptions: TSearchableSelectOption[] = showAllOption
    ? [{ value: "", label: allOptionLabel }, ...options]
    : options;

  // Find the selected option based on value
  const selectedOption = allOptions.find((opt) => opt.value === value) || null;

  // For multiple selection
  const selectedOptions = multiple
    ? allOptions.filter((opt) => 
        Array.isArray(value) 
          ? (value as (string | number)[]).includes(opt.value)
          : opt.value === value
      )
    : undefined;

  const handleChange = (
    _event: SyntheticEvent,
    newValue: TSearchableSelectOption | TSearchableSelectOption[] | null
  ) => {
    if (multiple) {
      const values = (newValue as TSearchableSelectOption[] | null)?.map((v) => v.value) || [];
      onChange(values as unknown as string | number | null);
    } else {
      onChange((newValue as TSearchableSelectOption | null)?.value ?? null);
    }
  };

  const errorMessage = typeof error === "string" ? error : undefined;
  const hasError = Boolean(error);

  return (
    <Autocomplete
      options={allOptions}
      value={multiple ? selectedOptions : selectedOption}
      onChange={handleChange}
      multiple={multiple}
      disabled={disabled || viewMode}
      fullWidth={fullWidth}
      size={size}
      disableClearable={!clearable}
      noOptionsText={noOptionsText}
      groupBy={groupBy ? (opt) => groupBy(opt) : undefined}
      getOptionLabel={(option) => option?.label || ""}
      getOptionDisabled={(option) => option.disabled || false}
      isOptionEqualToValue={(option, val) => option?.value === val?.value}
      renderOption={(props, option) => {
        const { key, ...otherProps } = props;
        return (
          <Box
            component="li"
            key={key}
            {...otherProps}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              py: 0.5,
            }}
          >
            {option.icon && (
              <Box sx={{ display: "flex", alignItems: "center", color: "text.secondary" }}>
                {option.icon}
              </Box>
            )}
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2">
                {option.label}
              </Typography>
              {option.secondary && (
                <Typography variant="caption" color="text.secondary">
                  {option.secondary}
                </Typography>
              )}
            </Box>
            {option.color && option.color !== "default" && (
              <Chip
                size="small"
                label=""
                color={option.color}
                sx={{ width: 12, height: 12, minWidth: 12 }}
              />
            )}
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          required={required}
          error={hasError}
          helperText={errorMessage || helperText}
          sx={sx}
        />
      )}
      renderTags={multiple ? (value, getTagProps) =>
        value.map((option, index) => (
          <Chip
            {...getTagProps({ index })}
            key={option.value}
            label={option.label}
            size="small"
            color={option.color || "default"}
          />
        ))
      : undefined}
      sx={{
        "& .MuiAutocomplete-inputRoot": {
          paddingRight: "39px !important",
        },
      }}
    />
  );
}

export default TSearchableSelect;
