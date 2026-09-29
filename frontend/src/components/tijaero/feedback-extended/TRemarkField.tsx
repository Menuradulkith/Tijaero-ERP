/**
 * TRemarkField - Drop-in replacement for a remark/remarks TextField that adds
 * a button to expand the remark into a larger dialog for easier typing/reading.
 *
 * @example
 * ```tsx
 * <TRemarkField
 *   label="Remarks"
 *   size="small"
 *   fullWidth
 *   value={formData.remarks}
 *   onChange={(value) => setFormData({ ...formData, remarks: value })}
 *   disabled={!isEditing}
 * />
 * ```
 */

import React, { useState } from "react";
import { TextField, IconButton, InputAdornment, Tooltip } from "@mui/material";
import type { TextFieldProps } from "@mui/material";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import { TRemarkDialog } from "./TRemarkDialog";

export interface TRemarkFieldProps
  extends Omit<TextFieldProps, "onChange" | "value"> {
  /** Remark value */
  value: string | null | undefined;
  /** Change handler, receives the new string value directly */
  onChange: (value: string) => void;
  /** Title used for the expanded dialog (defaults to the field label) */
  dialogTitle?: string;
  /** Hide the expand button */
  hideExpandButton?: boolean;
}

export const TRemarkField: React.FC<TRemarkFieldProps> = ({
  value,
  onChange,
  label = "Remarks",
  placeholder = "Enter remark...",
  disabled,
  dialogTitle,
  hideExpandButton = false,
  InputProps,
  ...rest
}) => {
  const [open, setOpen] = useState(false);
  const safeValue = value ?? "";

  return (
    <>
      <TextField
        label={label}
        placeholder={placeholder}
        value={safeValue}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        InputProps={{
          ...InputProps,
          endAdornment: hideExpandButton ? (
            InputProps?.endAdornment
          ) : (
            <InputAdornment position="end">
              {InputProps?.endAdornment}
              <Tooltip title="Expand remark">
                <IconButton
                  size="small"
                  edge="end"
                  tabIndex={-1}
                  onClick={() => setOpen(true)}
                >
                  <MenuBookIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ),
        }}
        {...rest}
      />
      <TRemarkDialog
        open={open}
        onClose={() => setOpen(false)}
        title={dialogTitle || (typeof label === "string" ? label : "Remark")}
        value={safeValue}
        onChange={disabled ? undefined : onChange}
        onSave={disabled ? undefined : () => setOpen(false)}
        readOnly={disabled}
        label={typeof label === "string" ? label : "Remark"}
        placeholder={placeholder as string}
      />
    </>
  );
};

export default TRemarkField;
