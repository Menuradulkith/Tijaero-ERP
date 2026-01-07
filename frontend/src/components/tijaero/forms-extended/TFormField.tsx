/**
 * TFormField - Standardized form field component with react-hook-form integration
 * 
 * Wraps common form inputs with Controller for react-hook-form.
 * Provides consistent validation display and styling.
 * 
 * @example
 * ```tsx
 * <TFormField
 *   control={control}
 *   name="email"
 *   label="Email"
 *   type="email"
 *   required
 * />
 * 
 * <TFormField
 *   control={control}
 *   name="status"
 *   label="Status"
 *   fieldType="select"
 *   options={statusOptions}
 * />
 * ```
 */

import React from "react";
import { Controller, Control, FieldValues, Path, RegisterOptions } from "react-hook-form";
import {
  TextField,
  MenuItem,
  FormControlLabel,
  Checkbox,
  Switch,
  Autocomplete,
  Box,
  Typography,
  InputAdornment,
} from "@mui/material";

export interface TFormFieldProps<T extends FieldValues = FieldValues> {
  /** react-hook-form control */
  control: Control<T>;
  /** Field name (path in form values) */
  name: Path<T>;
  /** Field label */
  label: string;
  /** Field type */
  fieldType?:
    | "text"
    | "number"
    | "email"
    | "password"
    | "tel"
    | "url"
    | "textarea"
    | "select"
    | "autocomplete"
    | "checkbox"
    | "switch"
    | "date"
    | "datetime";
  /** Options for select/autocomplete */
  options?: { value: string | number; label: string }[];
  /** Autocomplete options (for complex objects) */
  autocompleteOptions?: unknown[];
  /** Get label from autocomplete option */
  getOptionLabel?: (option: unknown) => string;
  /** Required field */
  required?: boolean;
  /** Disabled field */
  disabled?: boolean;
  /** Read-only field */
  readOnly?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Helper text */
  helperText?: string;
  /** Number of rows for textarea */
  rows?: number;
  /** Validation rules */
  rules?: RegisterOptions<T>;
  /** Start adornment */
  startAdornment?: React.ReactNode;
  /** End adornment */
  endAdornment?: React.ReactNode;
  /** Full width */
  fullWidth?: boolean;
  /** Size */
  size?: "small" | "medium";
  /** Minimum value for number */
  min?: number;
  /** Maximum value for number */
  max?: number;
  /** Step for number */
  step?: number;
  /** Custom styles */
  sx?: Record<string, unknown>;
  /** Grid column span (for use in form grids) */
  gridColumn?: string;
}

export function TFormField<T extends FieldValues = FieldValues>({
  control,
  name,
  label,
  fieldType = "text",
  options = [],
  autocompleteOptions = [],
  getOptionLabel,
  required = false,
  disabled = false,
  readOnly = false,
  placeholder,
  helperText,
  rows = 4,
  rules,
  startAdornment,
  endAdornment,
  fullWidth = true,
  size = "small",
  min,
  max,
  step,
  sx,
  gridColumn,
}: TFormFieldProps<T>) {
  // Build validation rules
  const validationRules: RegisterOptions<T> = {
    ...(required && { required: `${label} is required` }),
    ...rules,
  };

  // Container styles for grid layout
  const containerSx = gridColumn ? { gridColumn, ...sx } : sx;

  return (
    <Controller
      name={name}
      control={control}
      rules={validationRules}
      render={({ field, fieldState }) => {
        const error = fieldState.error?.message;

        // Render based on field type
        switch (fieldType) {
          case "select":
            return (
              <TextField
                {...field}
                select
                label={label}
                fullWidth={fullWidth}
                size={size}
                error={!!error}
                helperText={error || helperText}
                disabled={disabled}
                required={required}
                placeholder={placeholder}
                sx={containerSx}
              >
                {options.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </TextField>
            );

          case "autocomplete":
            return (
              <Autocomplete
                {...field}
                options={autocompleteOptions}
                getOptionLabel={getOptionLabel || ((opt) => String(opt))}
                onChange={(_, value) => field.onChange(value)}
                disabled={disabled}
                readOnly={readOnly}
                fullWidth={fullWidth}
                size={size}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={label}
                    error={!!error}
                    helperText={error || helperText}
                    required={required}
                    placeholder={placeholder}
                  />
                )}
                sx={containerSx}
              />
            );

          case "checkbox":
            return (
              <Box sx={containerSx}>
                <FormControlLabel
                  control={
                    <Checkbox
                      {...field}
                      checked={!!field.value}
                      disabled={disabled}
                    />
                  }
                  label={
                    <Typography component="span">
                      {label}
                      {required && <span style={{ color: "red" }}> *</span>}
                    </Typography>
                  }
                />
                {(error || helperText) && (
                  <Typography
                    variant="caption"
                    color={error ? "error" : "text.secondary"}
                    sx={{ ml: 4 }}
                  >
                    {error || helperText}
                  </Typography>
                )}
              </Box>
            );

          case "switch":
            return (
              <Box sx={containerSx}>
                <FormControlLabel
                  control={
                    <Switch
                      {...field}
                      checked={!!field.value}
                      disabled={disabled}
                    />
                  }
                  label={label}
                />
                {(error || helperText) && (
                  <Typography
                    variant="caption"
                    color={error ? "error" : "text.secondary"}
                    sx={{ ml: 7 }}
                  >
                    {error || helperText}
                  </Typography>
                )}
              </Box>
            );

          case "textarea":
            return (
              <TextField
                {...field}
                label={label}
                fullWidth={fullWidth}
                size={size}
                multiline
                rows={rows}
                error={!!error}
                helperText={error || helperText}
                disabled={disabled}
                required={required}
                placeholder={placeholder}
                InputProps={{
                  readOnly,
                }}
                sx={containerSx}
              />
            );

          case "date":
          case "datetime":
            return (
              <TextField
                {...field}
                type={fieldType === "datetime" ? "datetime-local" : "date"}
                label={label}
                fullWidth={fullWidth}
                size={size}
                error={!!error}
                helperText={error || helperText}
                disabled={disabled}
                required={required}
                InputLabelProps={{ shrink: true }}
                InputProps={{
                  readOnly,
                }}
                sx={containerSx}
              />
            );

          case "number":
            return (
              <TextField
                {...field}
                type="number"
                label={label}
                fullWidth={fullWidth}
                size={size}
                error={!!error}
                helperText={error || helperText}
                disabled={disabled}
                required={required}
                placeholder={placeholder}
                inputProps={{ min, max, step }}
                InputProps={{
                  readOnly,
                  startAdornment: startAdornment && (
                    <InputAdornment position="start">{startAdornment}</InputAdornment>
                  ),
                  endAdornment: endAdornment && (
                    <InputAdornment position="end">{endAdornment}</InputAdornment>
                  ),
                }}
                onChange={(e) => {
                  const val = e.target.value;
                  field.onChange(val === "" ? "" : Number(val));
                }}
                sx={containerSx}
              />
            );

          default:
            return (
              <TextField
                {...field}
                type={fieldType}
                label={label}
                fullWidth={fullWidth}
                size={size}
                error={!!error}
                helperText={error || helperText}
                disabled={disabled}
                required={required}
                placeholder={placeholder}
                InputProps={{
                  readOnly,
                  startAdornment: startAdornment && (
                    <InputAdornment position="start">{startAdornment}</InputAdornment>
                  ),
                  endAdornment: endAdornment && (
                    <InputAdornment position="end">{endAdornment}</InputAdornment>
                  ),
                }}
                sx={containerSx}
              />
            );
        }
      }}
    />
  );
}

export default TFormField;
