/**
 * TSelect - Standardized select dropdown component
 * 
 * Provides consistent select styling with:
 * - Simple option configuration
 * - Optional empty/none option
 * - Error states
 * - View mode
 * 
 * @example
 * ```tsx
 * <TSelect
 *   label="Status"
 *   value={status}
 *   onChange={handleChange}
 *   options={[
 *     { value: "active", label: "Active" },
 *     { value: "inactive", label: "Inactive" },
 *   ]}
 * />
 * ```
 */

import React from "react";
import {
  TextField,
  MenuItem,
  TextFieldProps,
} from "@mui/material";

export interface TSelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

export interface TSelectProps extends Omit<TextFieldProps, "select" | "error" | "variant" | "onChange"> {
  /** Available options */
  options: TSelectOption[];
  /** Current value */
  value: string | number | "";
  /** Change handler */
  onChange: (value: string | number) => void;
  /** Error message */
  error?: string | boolean;
  /** Show empty/none option */
  showEmpty?: boolean;
  /** Empty option label */
  emptyLabel?: string;
  /** View mode (read-only with styling) */
  viewMode?: boolean;
  /** Size */
  size?: "small" | "medium";
}

export const TSelect: React.FC<TSelectProps> = ({
  options,
  value,
  onChange,
  error,
  showEmpty = false,
  emptyLabel = "-- Select --",
  viewMode = false,
  size = "small",
  sx,
  disabled,
  ...rest
}) => {
  const showError = typeof error === "string" ? error : undefined;

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    // Try to preserve numeric type
    const numValue = Number(newValue);
    onChange(!isNaN(numValue) && newValue !== "" ? numValue : newValue);
  };

  return (
    <TextField
      {...rest}
      select
      variant="outlined"
      size={size}
      value={value}
      onChange={handleChange}
      error={!!error}
      helperText={showError}
      disabled={disabled || viewMode}
      sx={{
        ...(viewMode && {
          "& .MuiOutlinedInput-root": {
            backgroundColor: "grey.50",
          },
        }),
        ...sx,
      }}
    >
      {showEmpty && (
        <MenuItem value="">
          <em>{emptyLabel}</em>
        </MenuItem>
      )}
      {options.map((option) => (
        <MenuItem
          key={option.value}
          value={option.value}
          disabled={option.disabled}
        >
          {option.label}
        </MenuItem>
      ))}
    </TextField>
  );
};

export default TSelect;
