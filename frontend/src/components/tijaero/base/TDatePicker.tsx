/**
 * TDatePicker - Standardized date input component
 *
 * Shows the date the way the rest of the ERP does ("07 Nov 2026") instead of
 * the browser's locale format. The visible field is a text box that only
 * displays the date; the browser's own calendar comes from a visually hidden
 * native <input type="date"> that holds the ISO value. value/onChange stay ISO
 * "YYYY-MM-DD" strings. The datetime variant (includeTime) stays a plain
 * native datetime-local input.
 *
 * @example
 * ```tsx
 * <TDatePicker label="Start Date" value={startDate} onChange={setStartDate} />
 * <TDatePicker label="End Date" min={startDate} />
 * ```
 */

import React, { useRef } from "react";
import { IconButton, InputAdornment, TextField, TextFieldProps } from "@mui/material";
import CalendarMonthOutlinedIcon from "@mui/icons-material/CalendarMonthOutlined";
import { format, parseISO } from "date-fns";
import { displayDate } from "../../../utils/formatters";

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
    if (isNaN(d.getTime())) return "";
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
    if (isNaN(d.getTime())) return undefined;
    return format(d, "yyyy-MM-dd");
  } catch {
    return undefined;
  }
};

const hiddenInputStyle: React.CSSProperties = {
  position: "absolute",
  left: 0,
  bottom: 0,
  width: "100%",
  height: 1,
  padding: 0,
  margin: 0,
  border: 0,
  opacity: 0,
  pointerEvents: "none",
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
  required,
  sx,
  InputProps,
  inputProps,
  helperText,
  placeholder,
  ...rest
}) => {
  const hiddenRef = useRef<HTMLInputElement>(null);
  const showError = typeof error === "string" ? error : undefined;
  const isDisabled = !!(disabled || viewMode);
  const minValue = formatMinMax(min) ?? (inputProps?.min as string | undefined);
  const maxValue = formatMinMax(max) ?? (inputProps?.max as string | undefined);
  const viewSx = viewMode ? { "& .MuiOutlinedInput-root": { backgroundColor: "grey.50" } } : {};
  const callerSx = Array.isArray(sx) ? sx : [sx];

  if (includeTime) {
    return (
      <TextField
        {...rest}
        type="datetime-local"
        variant="outlined"
        size={size}
        required={required}
        placeholder={placeholder}
        value={formatForInput(value, true)}
        onChange={(event) => onChange(event.target.value || null)}
        error={!!error}
        helperText={showError || helperText}
        disabled={isDisabled}
        InputProps={{ notched: true, ...InputProps }}
        inputProps={{ ...inputProps, min: minValue, max: maxValue }}
        InputLabelProps={{ shrink: true }}
        sx={[viewSx, ...callerSx]}
      />
    );
  }

  const isoValue = formatForInput(value, false);

  const openPicker = () => {
    const input = hiddenRef.current;
    if (!input || isDisabled) return;
    try {
      if (typeof input.showPicker === "function") {
        input.showPicker();
        return;
      }
    } catch {
      // fall through to the focus/click fallback
    }
    try {
      input.focus();
      input.click();
    } catch {
      // nothing else to try
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
      event.preventDefault();
      openPicker();
    } else if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      if (!required && isoValue) onChange(null);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      // The field only displays the date; typing goes nowhere.
      event.preventDefault();
    }
  };

  const callerEnd = InputProps?.endAdornment;

  return (
    <TextField
      {...rest}
      type="text"
      variant="outlined"
      size={size}
      required={required}
      placeholder={placeholder ?? "Select date"}
      value={displayDate(isoValue)}
      // Controlled display only: edits are swallowed, the hidden input owns the value.
      onChange={() => {}}
      error={!!error}
      helperText={showError || helperText}
      disabled={isDisabled}
      InputProps={{
        notched: true,
        ...InputProps,
        endAdornment: (
          <>
            {callerEnd}
            <InputAdornment position="end">
              <IconButton
                size="small"
                edge="end"
                tabIndex={-1}
                aria-label="Open calendar"
                disabled={isDisabled}
                onClick={openPicker}
              >
                <CalendarMonthOutlinedIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
            <input
              ref={hiddenRef}
              type="date"
              tabIndex={-1}
              aria-hidden="true"
              value={isoValue}
              min={minValue}
              max={maxValue}
              disabled={isDisabled}
              onChange={(event) => onChange(event.target.value || null)}
              style={hiddenInputStyle}
            />
          </>
        ),
      }}
      inputProps={{
        ...inputProps,
        min: undefined,
        max: undefined,
        inputMode: "none",
        autoComplete: "off",
        "data-iso-value": isoValue,
        onClick: (event: React.MouseEvent<HTMLInputElement>) => {
          (inputProps?.onClick as ((e: React.MouseEvent<HTMLInputElement>) => void) | undefined)?.(event);
          openPicker();
        },
        onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
          (inputProps?.onKeyDown as ((e: React.KeyboardEvent<HTMLInputElement>) => void) | undefined)?.(event);
          handleKeyDown(event);
        },
        onPaste: (event: React.ClipboardEvent<HTMLInputElement>) => event.preventDefault(),
      }}
      InputLabelProps={{ shrink: true }}
      sx={[
        { "& .MuiInputBase-input": { cursor: isDisabled ? "default" : "pointer", caretColor: "transparent" } },
        viewSx,
        ...callerSx,
      ]}
    />
  );
};

export default TDatePicker;
