/**
 * FormSection - Tijaero-style form section component
 * 
 * Provides a consistent form section with:
 * - Title
 * - Grid layout with configurable columns
 * - Optional collapsible behavior
 * - Section icon
 */

import React, { useState } from "react";
import {
  Box,
  Paper,
  Typography,
  Collapse,
  IconButton,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { FormSectionProps } from "../types";

export const FormSection: React.FC<FormSectionProps> = ({
  title,
  columns = 2,
  children,
  collapsible = false,
  defaultCollapsed = false,
  icon,
  isLast = false,
  sx,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  const gridTemplateColumns = {
    1: "1fr",
    2: { xs: "1fr", sm: "1fr 1fr" },
    3: { xs: "1fr", sm: "1fr 1fr", md: "1fr 1fr 1fr" },
    4: { xs: "1fr", sm: "1fr 1fr", md: "1fr 1fr 1fr 1fr" },
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: isLast ? 0 : 2, ...sx }}>
      {/* Section Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mb: collapsible && isCollapsed ? 0 : 2,
          cursor: collapsible ? "pointer" : "default",
        }}
        onClick={() => collapsible && setIsCollapsed(!isCollapsed)}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {icon}
          <Typography variant="subtitle2" fontWeight={600}>
            {title}
          </Typography>
        </Box>
        {collapsible && (
          <IconButton size="small">
            {isCollapsed ? <ExpandMoreIcon /> : <ExpandLessIcon />}
          </IconButton>
        )}
      </Box>

      {/* Section Content */}
      <Collapse in={!collapsible || !isCollapsed}>
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
    </Paper>
  );
};

export default FormSection;
