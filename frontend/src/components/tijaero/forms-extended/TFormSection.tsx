/**
 * TFormSection - Standardized form section component
 * 
 * Enhanced version of the existing FormSection with additional features.
 * Groups related form fields with a title and optional collapse behavior.
 * 
 * @example
 * ```tsx
 * <TFormSection title="Basic Information" icon={<InfoIcon />}>
 *   <TFormField control={control} name="name" label="Name" />
 *   <TFormField control={control} name="code" label="Code" />
 * </TFormSection>
 * ```
 */

import React, { useState } from "react";
import {
  Box,
  Paper,
  Typography,
  Collapse,
  IconButton,
  Divider,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";

export interface TFormSectionProps {
  /** Section title */
  title: string;
  /** Section subtitle */
  subtitle?: string;
  /** Section icon */
  icon?: React.ReactNode;
  /** Number of columns */
  columns?: 1 | 2 | 3 | 4;
  /** Section content */
  children: React.ReactNode;
  /** Collapsible section */
  collapsible?: boolean;
  /** Default collapsed state */
  defaultCollapsed?: boolean;
  /** Is last section (no margin bottom) */
  isLast?: boolean;
  /** Section variant */
  variant?: "paper" | "outlined" | "plain";
  /** Required section indicator */
  required?: boolean;
  /** Header actions */
  actions?: React.ReactNode;
  /** Custom styles */
  sx?: Record<string, unknown>;
}

export const TFormSection: React.FC<TFormSectionProps> = ({
  title,
  subtitle,
  icon,
  columns = 2,
  children,
  collapsible = false,
  defaultCollapsed = false,
  isLast = false,
  variant = "outlined",
  required = false,
  actions,
  sx,
}) => {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  // Grid template columns based on column count
  const gridTemplateColumns = {
    1: "1fr",
    2: { xs: "1fr", sm: "1fr 1fr" },
    3: { xs: "1fr", sm: "1fr 1fr", md: "1fr 1fr 1fr" },
    4: { xs: "1fr", sm: "1fr 1fr", md: "1fr 1fr 1fr 1fr" },
  };

  const containerSx = {
    p: variant === "plain" ? 0 : 2,
    mb: isLast ? 0 : 2,
    ...sx,
  };

  const sectionContent = (
    <>
      {/* Section Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mb: collapsible && collapsed ? 0 : 2,
          cursor: collapsible ? "pointer" : "default",
        }}
        onClick={collapsible ? () => setCollapsed(!collapsed) : undefined}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {icon && (
            <Box sx={{ color: "primary.main", display: "flex" }}>{icon}</Box>
          )}
          <Box>
            <Typography variant="subtitle1" fontWeight={600}>
              {title}
              {required && (
                <Typography component="span" color="error.main">
                  {" "}
                  *
                </Typography>
              )}
            </Typography>
            {subtitle && (
              <Typography variant="caption" color="text.secondary">
                {subtitle}
              </Typography>
            )}
          </Box>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {actions}
          {collapsible && (
            <IconButton size="small">
              {collapsed ? <ExpandMoreIcon /> : <ExpandLessIcon />}
            </IconButton>
          )}
        </Box>
      </Box>

      {/* Divider for paper/outlined variants */}
      {variant !== "plain" && !collapsible && <Divider sx={{ mb: 2, mt: -1 }} />}

      {/* Section Content */}
      <Collapse in={!collapsible || !collapsed}>
        {variant !== "plain" && collapsible && !collapsed && (
          <Divider sx={{ mb: 2 }} />
        )}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: gridTemplateColumns[columns],
            gap: 2,
          }}
        >
          {children}
        </Box>
      </Collapse>
    </>
  );

  // Render based on variant
  if (variant === "plain") {
    return <Box sx={containerSx}>{sectionContent}</Box>;
  }

  if (variant === "outlined") {
    return <Paper variant="outlined" sx={containerSx}>{sectionContent}</Paper>;
  }

  return <Paper elevation={1} sx={containerSx}>{sectionContent}</Paper>;
};

export default TFormSection;
