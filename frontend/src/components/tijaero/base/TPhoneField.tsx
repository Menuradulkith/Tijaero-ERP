/**
 * TPhoneField - international contact number input (country flag dropdown +
 * dial code) with validation.
 *
 * Values are stored in E.164 form ("+94771234567"). Older records may hold a
 * local number ("0771234567"); `normalizePhone` converts those using the
 * default country (Sri Lanka) when a form is loaded, so they validate and are
 * saved in the new format.
 */

import { MuiTelInput, type MuiTelInputCountry } from "mui-tel-input";
import { getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { useEffect, useRef, useState } from "react";
import type { SxProps, Theme } from "@mui/material";

export const DEFAULT_PHONE_COUNTRY: CountryCode = "LK";

/** Converts a stored/legacy number to E.164 where it can be parsed; otherwise returns it trimmed. */
export const normalizePhone = (value?: string | null): string => {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const parsed = parsePhoneNumberFromString(raw, DEFAULT_PHONE_COUNTRY);
  return parsed ? parsed.number : raw;
};

/** True for an empty value (field is optional) or a valid number for its country. */
export const isValidPhone = (value?: string | null): boolean => {
  const raw = (value ?? "").trim();
  if (!raw) return true;
  return !!parsePhoneNumberFromString(raw, DEFAULT_PHONE_COUNTRY)?.isValid();
};

/** Error message for a number, or undefined when it is acceptable. */
export const phoneError = (value?: string | null, required = false): string | undefined => {
  const raw = (value ?? "").trim();
  if (!raw) return required ? "Contact No is required" : undefined;
  return isValidPhone(raw) ? undefined : "Enter a valid contact number";
};

export interface TPhoneFieldProps {
  label?: string;
  value?: string | null;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  /** Extra error text from the parent (overrides built-in validation). */
  helperText?: string;
  defaultCountry?: CountryCode;
  size?: "small" | "medium";
  fullWidth?: boolean;
  sx?: SxProps<Theme>;
}

export function TPhoneField({
  label = "Contact No",
  value,
  onChange,
  required = false,
  disabled = false,
  helperText,
  defaultCountry = DEFAULT_PHONE_COUNTRY,
  size = "small",
  fullWidth = true,
  sx,
}: TPhoneFieldProps) {
  const [touched, setTouched] = useState(false);

  const normalized = normalizePhone(value);

  // The library needs to keep seeing its own raw text (e.g. a bare "+94"
  // dial code). The parent only receives "" for an empty field, so if we fed
  // that "" straight back as `value`, the library would reset itself after the
  // user cleared the field and swallow the next digit typed. So hold the raw
  // text locally and re-sync from the parent only for genuinely external
  // changes (form load/reset/duplicate).
  const [inner, setInner] = useState(normalized);
  const emitted = useRef(normalized);
  useEffect(() => {
    if (normalized !== emitted.current) {
      emitted.current = normalized;
      setInner(normalized);
    }
  }, [normalized]);
  const message = helperText ?? (touched || normalized ? phoneError(normalized, required && touched) : undefined);
  // Don't flag a half-typed number as invalid until the field has been left.
  const showError = !!helperText || (touched && !!phoneError(normalized, required));

  return (
    <MuiTelInput
      label={label}
      size={size}
      fullWidth={fullWidth}
      required={required}
      disabled={disabled}
      defaultCountry={defaultCountry as MuiTelInputCountry}
      value={inner}
      onChange={(rawNext, info) => {
        // Local-format entry ("0771234567") carries a trunk "0" that does not
        // belong after the default country's dial code; drop it so it matches
        // what the fresh field already does and validates as E.164.
        const dial = `+${getCountryCallingCode(defaultCountry)}`;
        const compact = rawNext.replace(/\s/g, "");
        const next = compact.startsWith(`${dial}0`)
          ? dial + compact.slice(dial.length).replace(/^0+/, "")
          : rawNext;
        const changed = next !== rawNext;
        const national = changed ? next.slice(dial.length).replace(/\D/g, "") : info.nationalNumber;
        const numberValue = changed ? parsePhoneNumberFromString(next)?.number : info.numberValue;
        // A bare dial code ("+94") means nothing has been entered.
        const out = national ? (numberValue ?? next.replace(/[^\d+]/g, "")) : "";
        emitted.current = normalizePhone(out);
        // A fully emptied input has no dial code, so the library would guess a
        // country from the first digit typed next (e.g. "7" -> +7). Fall back to
        // the default country's dial code, which is what an untouched field shows.
        setInner(next.trim() ? next : dial);
        onChange(out);
      }}
      onBlur={() => setTouched(true)}
      // A bare dial code ("+94") is not a value: require 7+ digits so a required
      // field counts as empty for the form's "highlight missing fields" check.
      inputProps={required ? { pattern: "[^\\d]*(\\d[^\\d]*){7,}" } : undefined}
      error={showError}
      helperText={showError ? message : undefined}
      // Country dropdown: the library's flag button is a square, full-height
      // icon button with no arrow. Make it a compact "flag ▾ |" selector.
      sx={[
        {
          "& .MuiInputAdornment-positionStart": { marginRight: 1 },
          "& .MuiTelInput-IconButton": {
            aspectRatio: "auto",
            height: 24,
            width: "auto",
            minWidth: 0,
            padding: "0 8px 0 4px",
            borderRadius: 0,
            borderRight: "1px solid",
            borderColor: "divider",
            "&::after": {
              content: '""',
              marginLeft: "6px",
              borderLeft: "4px solid transparent",
              borderRight: "4px solid transparent",
              borderTop: "4px solid currentColor",
              opacity: 0.6,
            },
          },
          "& .MuiTelInput-FlagImg": { width: 20, height: "auto" },
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
      MenuProps={{
        PaperProps: {
          sx: {
            maxHeight: 240,
            "& .MuiTelInput-MenuItem": { minHeight: 30, py: 0.25, fontSize: "0.85rem" },
            "& .MuiTelInput-ListItemIcon-flag": { minWidth: 0, mr: 1 },
            "& .MuiTelInput-FlagImg": { width: 18, height: "auto" },
          },
        },
      }}
    />
  );
}

export default TPhoneField;
