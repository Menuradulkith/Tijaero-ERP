/**
 * TDatePicker - Standardized date input component
 * 
 * Uses native HTML5 date input for broad compatibility.
 * For advanced date picking, consider using @mui/x-date-pickers.
 * 
 * @example
 * ```tsx
 * <TDatePicker label="Start Date" value={startDate} onChange={setStartDate} />
 * <TDatePicker label="End Date" min={startDate} />
 * ```
 */

import React from "react";
import { TextField, TextFieldProps } from "@mui/material";
import { format, parseISO } from "date-fns";

export interface TDatePickerProps extends Omit<TextFieldProps, "type" | "value" | "onChange" | "error" | "variant"> {
  /** Date value (ISO string or Date object) */
  value: string | Date | null;
  /** Change handler */
  onChange: (date: string | null) => void;
  /** Include time picker */
  includeTime?: boolean;
  /** Minimum date */
  min?: string | Date;
  /** Maximum date */
  max?: string | Date;
  /** Error message */
  error?: string | boolean;
  /** View mode */
  viewMode?: boolean;
  /** Size */
  size?: "small" | "medium";
}

// Format date to input value
const formatForInput = (date: string | Date | null, includeTime: boolean): string => {
  if (!date) return "";
  try {
    const d = typeof date === "string" ? parseISO(date) : date;
    return includeTime ? format(d, "yyyy-MM-dd'T'HH:mm") : format(d, "yyyy-MM-dd");
  } catch {
    return "";
  }
};

// Format min/max date
const formatMinMax = (date: string | Date | undefined): string | undefined => {
  if (!date) return undefined;
  try {
    const d = typeof date === "string" ? parseISO(date) : date;
    return format(d, "yyyy-MM-dd");
  } catch {
    return undefined;
  }
};

export const TDatePicker: React.FC<TDatePickerProps> = ({
  value,
  onChange,
  includeTime = false,
  min,
  max,
  error,
  viewMode = false,
  size = "small",
  disabled,
  sx,
  InputProps,
  inputProps,
  helperText,
  ...rest
}) => {
  const showError = typeof error === "string" ? error : undefined;

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const val = event.target.value;
    onChange(val || null);
  };

  return (
    <TextField
      {...rest}
      type={includeTime ? "datetime-local" : "date"}
      variant="outlined"
      size={size}
      value={formatForInput(value, includeTime)}
      onChange={handleChange}
      error={!!error}
      helperText={showError || helperText}
      disabled={disabled || viewMode}
      InputProps={{
        ...InputProps,
      }}
      inputProps={{
        min: formatMinMax(min),
        max: formatMinMax(max),
        ...inputProps,
      }}
      InputLabelProps={{
        shrink: true,
      }}
      sx={{
        ...(viewMode && {
          "& .MuiOutlinedInput-root": {
            backgroundColor: "grey.50",
          },
        }),
        ...sx,
      }}
    />
  );
};

export default TDatePicker;
