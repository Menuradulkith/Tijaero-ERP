/**
 * TCheckbox - Standardized checkbox component
 * 
 * Provides consistent checkbox styling with label support.
 * 
 * @example
 * ```tsx
 * <TCheckbox label="Active" checked={isActive} onChange={setIsActive} />
 * <TCheckbox label="Send notification" helperText="Email will be sent" />
 * ```
 */

import React from "react";
import {
  FormControlLabel,
  Checkbox,
  CheckboxProps,
  FormHelperText,
  Box,
} from "@mui/material";

export interface TCheckboxProps extends Omit<CheckboxProps, "onChange"> {
  /** Checkbox label */
  label: string;
  /** Checked state */
  checked: boolean;
  /** Change handler */
  onChange: (checked: boolean) => void;
  /** Helper text below checkbox */
  helperText?: string;
  /** Error state */
  error?: boolean;
  /** Required field */
  required?: boolean;
  /** View mode (disabled with different styling) */
  viewMode?: boolean;
}

export const TCheckbox: React.FC<TCheckboxProps> = ({
  label,
  checked,
  onChange,
  helperText,
  error = false,
  required = false,
  viewMode = false,
  disabled,
  sx,
  ...rest
}) => {
  return (
    <Box sx={sx}>
      <FormControlLabel
        control={
          <Checkbox
            {...rest}
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled || viewMode}
            required={required}
            color={error ? "error" : "primary"}
          />
        }
        label={`${label}${required ? " *" : ""}`}
        sx={{
          ...(viewMode && {
            opacity: 0.8,
          }),
        }}
      />
      {helperText && (
        <FormHelperText error={error} sx={{ ml: 4, mt: -0.5 }}>
          {helperText}
        </FormHelperText>
      )}
    </Box>
  );
};

export default TCheckbox;
