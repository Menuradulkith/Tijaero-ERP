/**
 * TSwitch - Standardized switch/toggle component
 * 
 * Provides consistent switch styling with label support.
 * 
 * @example
 * ```tsx
 * <TSwitch label="Enabled" checked={isEnabled} onChange={setIsEnabled} />
 * <TSwitch label="Notifications" labelPlacement="start" />
 * ```
 */

import React from "react";
import {
  FormControlLabel,
  Switch,
  SwitchProps,
  FormHelperText,
  Box,
} from "@mui/material";

export interface TSwitchProps extends Omit<SwitchProps, "onChange"> {
  /** Switch label */
  label: string;
  /** Checked state */
  checked: boolean;
  /** Change handler */
  onChange: (checked: boolean) => void;
  /** Label placement */
  labelPlacement?: "start" | "end" | "top" | "bottom";
  /** Helper text */
  helperText?: string;
  /** View mode */
  viewMode?: boolean;
}

export const TSwitch: React.FC<TSwitchProps> = ({
  label,
  checked,
  onChange,
  labelPlacement = "end",
  helperText,
  viewMode = false,
  disabled,
  sx,
  ...rest
}) => {
  return (
    <Box sx={sx}>
      <FormControlLabel
        control={
          <Switch
            {...rest}
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled || viewMode}
          />
        }
        label={label}
        labelPlacement={labelPlacement}
        sx={{
          ...(viewMode && {
            opacity: 0.8,
          }),
        }}
      />
      {helperText && (
        <FormHelperText sx={{ ml: labelPlacement === "end" ? 7 : 0, mt: -0.5 }}>
          {helperText}
        </FormHelperText>
      )}
    </Box>
  );
};

export default TSwitch;
