/**
 * EmptyState - Tijaero-style empty/no-selection state component
 * 
 * Provides a consistent empty state display with:
 * - Message text
 * - Optional icon
 * - Optional action button
 */

import React from "react";
import { Box, Typography, Button } from "@mui/material";
import InboxIcon from "@mui/icons-material/Inbox";
import { EmptyStateProps } from "../types";

export const EmptyState: React.FC<EmptyStateProps> = ({
  message,
  icon,
  action,
  sx,
}) => {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: "text.secondary",
        p: 4,
        textAlign: "center",
        ...sx,
      }}
    >
      {icon || <InboxIcon sx={{ fontSize: 48, mb: 2, opacity: 0.5 }} />}
      <Typography variant="body1" sx={{ mb: action ? 2 : 0 }}>
        {message}
      </Typography>
      {action && (
        <Button
          variant="contained"
          color="primary"
          onClick={action.onClick}
          startIcon={action.icon}
        >
          {action.label}
        </Button>
      )}
    </Box>
  );
};

export default EmptyState;
