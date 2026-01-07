/**
 * TEmptyState - Standardized empty state component
 * 
 * Consistent empty state display with icon and optional action.
 * Enhanced version of the existing EmptyState component.
 * 
 * @example
 * ```tsx
 * <TEmptyState
 *   title="No Orders Found"
 *   message="Create your first order to get started."
 *   icon={<ReceiptIcon />}
 *   action={{
 *     label: "Create Order",
 *     onClick: handleCreate,
 *   }}
 * />
 * ```
 */

import React from "react";
import { Box, Typography, SxProps, Theme } from "@mui/material";
import InboxIcon from "@mui/icons-material/Inbox";
import { TButton } from "../base/TButton";

export interface TEmptyStateProps {
  /** Title text */
  title?: string;
  /** Message text */
  message: string;
  /** Icon to display */
  icon?: React.ReactNode;
  /** Primary action */
  action?: {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
  };
  /** Secondary action */
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  /** Size variant */
  size?: "small" | "medium" | "large";
  /** Custom styles */
  sx?: SxProps<Theme>;
}

// Size configurations
const sizeConfig = {
  small: {
    iconSize: 40,
    titleVariant: "subtitle1" as const,
    messageVariant: "body2" as const,
    padding: 2,
  },
  medium: {
    iconSize: 56,
    titleVariant: "h6" as const,
    messageVariant: "body1" as const,
    padding: 4,
  },
  large: {
    iconSize: 72,
    titleVariant: "h5" as const,
    messageVariant: "body1" as const,
    padding: 6,
  },
};

export const TEmptyState: React.FC<TEmptyStateProps> = ({
  title,
  message,
  icon,
  action,
  secondaryAction,
  size = "medium",
  sx,
}) => {
  const config = sizeConfig[size];

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        p: config.padding,
        minHeight: size === "large" ? 300 : size === "medium" ? 200 : 120,
        ...sx,
      }}
    >
      {/* Icon */}
      <Box
        sx={{
          color: "text.disabled",
          mb: 2,
          "& > svg": {
            fontSize: config.iconSize,
          },
        }}
      >
        {icon || <InboxIcon sx={{ fontSize: config.iconSize }} />}
      </Box>

      {/* Title */}
      {title && (
        <Typography
          variant={config.titleVariant}
          fontWeight={600}
          color="text.primary"
          sx={{ mb: 0.5 }}
        >
          {title}
        </Typography>
      )}

      {/* Message */}
      <Typography
        variant={config.messageVariant}
        color="text.secondary"
        sx={{ mb: action || secondaryAction ? 2 : 0, maxWidth: 400 }}
      >
        {message}
      </Typography>

      {/* Actions */}
      {(action || secondaryAction) && (
        <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
          {action && (
            <TButton
              variant="primary"
              onClick={action.onClick}
              startIcon={action.icon}
            >
              {action.label}
            </TButton>
          )}
          {secondaryAction && (
            <TButton variant="secondary" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </TButton>
          )}
        </Box>
      )}
    </Box>
  );
};

export default TEmptyState;
