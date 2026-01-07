/**
 * TAutocomplete - Standardized autocomplete/search select component
 * 
 * Provides searchable dropdown with:
 * - Async loading support
 * - Multiple selection
 * - Custom option rendering
 * - Creatable options
 * 
 * @example
 * ```tsx
 * <TAutocomplete
 *   label="Product"
 *   options={products}
 *   value={selectedProduct}
 *   onChange={setSelectedProduct}
 *   getOptionLabel={(p) => p.name}
 *   loading={isLoading}
 * />
 * ```
 */

import {
  Autocomplete,
  TextField,
  CircularProgress,
  Box,
  Typography,
  Chip,
} from "@mui/material";

export interface TAutocompleteProps<T> {
  /** Input label */
  label: string;
  /** Current value */
  value: T | T[] | null;
  /** Change handler */
  onChange: (value: T | T[] | null) => void;
  /** Options to display */
  options: T[];
  /** Get display label for option */
  getOptionLabel?: (option: T) => string;
  /** Get secondary text for option */
  getOptionSecondary?: (option: T) => string;
  /** Compare options for equality */
  isOptionEqualToValue?: (option: T, value: T) => boolean;
  /** Loading state */
  loading?: boolean;
  /** Error message */
  error?: string | boolean;
  /** Required field */
  required?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Size */
  size?: "small" | "medium";
  /** View mode */
  viewMode?: boolean;
  /** Full width */
  fullWidth?: boolean;
  /** Multiple selection */
  multiple?: boolean;
  /** Disabled */
  disabled?: boolean;
  /** Custom styles */
  sx?: object;
  /** Freesolo - allow custom values */
  freeSolo?: boolean;
  /** Disable clearable */
  disableClearable?: boolean;
  /** Filter options function */
  filterOptions?: (options: T[], state: { inputValue: string }) => T[];
  /** Group by function */
  groupBy?: (option: T) => string;
  /** Render tags for multiple selection */
  renderTags?: (value: T[], getTagProps: (params: { index: number }) => object) => React.ReactNode;
  /** No options text */
  noOptionsText?: string;
  /** Loading text */
  loadingText?: string;
}

export function TAutocomplete<T>({
  label,
  value,
  onChange,
  options,
  getOptionLabel,
  getOptionSecondary,
  isOptionEqualToValue,
  loading = false,
  error,
  required = false,
  placeholder,
  size = "small",
  viewMode = false,
  fullWidth = true,
  multiple = false,
  disabled,
  sx,
  freeSolo = false,
  disableClearable = false,
  filterOptions,
  groupBy,
  noOptionsText = "No options",
  loadingText = "Loading...",
}: TAutocompleteProps<T>) {
  const showError = typeof error === "string" ? error : undefined;

  // Default option label getter
  const defaultGetOptionLabel = (option: T | string): string => {
    if (typeof option === "string") return option;
    if (typeof option === "object" && option !== null) {
      const obj = option as Record<string, unknown>;
      return String(obj.name || obj.label || obj.title || obj.code || "");
    }
    return String(option);
  };

  const labelFn = getOptionLabel 
    ? (option: T | string) => typeof option === 'string' ? option : getOptionLabel(option as T)
    : defaultGetOptionLabel;

  return (
    <Autocomplete
      options={options}
      value={value as T | T[] | null}
      onChange={(_, newValue) => onChange(newValue as T | T[] | null)}
      multiple={multiple}
      disabled={disabled || viewMode}
      loading={loading}
      fullWidth={fullWidth}
      size={size}
      freeSolo={freeSolo}
      disableClearable={disableClearable}
      filterOptions={filterOptions}
      groupBy={groupBy}
      noOptionsText={noOptionsText}
      loadingText={loadingText}
      getOptionLabel={labelFn}
      isOptionEqualToValue={isOptionEqualToValue || ((option, val) => {
        if (typeof option === "object" && typeof val === "object" && option !== null && val !== null) {
          const optObj = option as Record<string, unknown>;
          const valObj = val as Record<string, unknown>;
          return optObj.id === valObj.id;
        }
        return option === val;
      })}
      renderOption={(props, option) => {
        const { key, ...otherProps } = props;
        const secondary = getOptionSecondary?.(option);
        const optLabel = labelFn(option);
        
        return (
          <Box component="li" key={key} {...otherProps}>
            <Box>
              <Typography variant="body2">{optLabel}</Typography>
              {secondary && (
                <Typography variant="caption" color="text.secondary">
                  {secondary}
                </Typography>
              )}
            </Box>
          </Box>
        );
      }}
      renderTags={(tagValue, getTagProps) =>
        tagValue.map((option, index) => {
          const { key, ...chipProps } = getTagProps({ index });
          return (
            <Chip
              key={key}
              size="small"
              label={(getOptionLabel || defaultGetOptionLabel)(option)}
              {...chipProps}
            />
          );
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          required={required}
          placeholder={placeholder}
          error={!!error}
          helperText={showError}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading && <CircularProgress color="inherit" size={20} />}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
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
}

export default TAutocomplete;
