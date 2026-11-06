/**
 * LineAmountField - compact quantity / unit price box for order line tables.
 *
 * Keeps the typed text as a draft so the box can be empty or hold a lone "-"
 * while editing (a controlled `type="number"` box would snap back to "0" and
 * append the next keystroke, and drop the minus sign). The parent receives the
 * parsed number on every keystroke (0 while empty) and the field flags zero,
 * negative and, for `integer`, fractional values so the caller's save
 * validation has a visible reason.
 */

import { TextField, type SxProps, type Theme } from "@mui/material";
import { useEffect, useRef, useState } from "react";

const NUMERIC_DRAFT = /^-?\d*\.?\d*$/;

export interface LineAmountFieldProps {
  value: number;
  onChange: (value: number) => void;
  /** Whole numbers only (quantities). */
  integer?: boolean;
  disabled?: boolean;
  width?: number;
  sx?: SxProps<Theme>;
}

export function lineAmountError(value: number, integer = false): string | undefined {
  if (!Number.isFinite(value) || value <= 0) return "Must be > 0";
  if (integer && !Number.isInteger(value)) return "Whole number";
  return undefined;
}

export default function LineAmountField({
  value,
  onChange,
  integer = false,
  disabled = false,
  width = 80,
  sx,
}: LineAmountFieldProps) {
  const [draft, setDraft] = useState(String(value ?? ""));
  const emitted = useRef(value);
  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setDraft(String(value ?? ""));
    }
  }, [value]);

  const [touched, setTouched] = useState(false);
  const parsed = Number(draft);
  // A fresh line's placeholder 0 isn't flagged until the user has been in the box.
  const error =
    !touched && parsed === 0
      ? undefined
      : draft === "" || draft === "-"
        ? "Required"
        : lineAmountError(parsed, integer);

  return (
    <TextField
      size="small"
      value={draft}
      disabled={disabled}
      onChange={(e) => {
        const text = e.target.value.trim();
        if (!NUMERIC_DRAFT.test(text)) return;
        setDraft(text);
        setTouched(true);
        const n = Number(text);
        const out = Number.isFinite(n) ? n : 0;
        emitted.current = out;
        onChange(out);
      }}
      onBlur={() => {
        setTouched(true);
        if (draft !== "" && draft !== "-" && Number.isFinite(parsed)) setDraft(String(parsed));
      }}
      error={!!error}
      helperText={error}
      inputProps={{ inputMode: integer ? "numeric" : "decimal", style: { textAlign: "right" } }}
      FormHelperTextProps={{ sx: { mx: 0, whiteSpace: "nowrap" } }}
      sx={[{ width }, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}
    />
  );
}
