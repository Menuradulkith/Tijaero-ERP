/**
 * TTextField - Standardized text input component
 * 
 * Provides consistent text field styling with support for:
 * - Various input types (text, number, email, password, multiline)
 * - Read-only and view modes
 * - Helper text and error states
 * - Start and end adornments
 * 
 * @example
 * ```tsx
 * <TTextField label="Name" value={name} onChange={handleChange} required />
 * <TTextField label="Email" type="email" error="Invalid email" />
 * <TTextField label="Description" multiline rows={4} />
 * <TTextField label="Price" type="number" startAdornment="$" />
 * ```
 */

import React from "react";
import { TextField, TextFieldProps, InputAdornment } from "@mui/material";

export interface TTextFieldProps extends Omit<TextFieldProps, "error" | "variant"> {
  /** Input type */
  type?: "text" | "number" | "email" | "password" | "tel" | "url";
  /** Error message (shows error state when provided) */
  error?: string | boolean;
  /** Multiline text area */
  multiline?: boolean;
  /** Number of rows for multiline */
  rows?: number;
  /** Start adornment (text or icon) */
  startAdornment?: React.ReactNode;
  /** End adornment (text or icon) */
  endAdornment?: React.ReactNode;
  /** Read-only mode */
  readOnly?: boolean;
  /** View mode (like read-only but with different styling) */
  viewMode?: boolean;
  /** Size of the input */
  size?: "small" | "medium";
  /** Placeholder text */
  placeholder?: string;
  /** Minimum value for number type */
  min?: number;
  /** Maximum value for number type */
  max?: number;
  /** Step for number type */
  step?: number;
}

export const TTextField: React.FC<TTextFieldProps> = ({
  type = "text",
  error,
  multiline = false,
  rows = 4,
  startAdornment,
  endAdornment,
  readOnly = false,
  viewMode = false,
  size = "small",
  min,
  max,
  step,
  sx,
  InputProps,
  inputProps,
  helperText,
  ...rest
}) => {
  const showError = typeof error === "string" ? error : undefined;

  return (
    <TextField
      {...rest}
      type={type}
      variant="outlined"
      size={size}
      error={!!error}
      helperText={showError || helperText}
      multiline={multiline}
      rows={multiline ? rows : undefined}
      InputProps={{
        readOnly: readOnly || viewMode,
        startAdornment: startAdornment ? (
          <InputAdornment position="start">{startAdornment}</InputAdornment>
        ) : undefined,
        endAdornment: endAdornment ? (
          <InputAdornment position="end">{endAdornment}</InputAdornment>
        ) : undefined,
        ...InputProps,
      }}
      inputProps={{
        min: type === "number" ? min : undefined,
        max: type === "number" ? max : undefined,
        step: type === "number" ? step : undefined,
        ...inputProps,
      }}
      sx={{
        ...(viewMode && {
          "& .MuiOutlinedInput-root": {
            backgroundColor: "grey.50",
            "& fieldset": {
              borderColor: "grey.300",
            },
          },
        }),
        ...sx,
      }}
    />
  );
};

export default TTextField;
