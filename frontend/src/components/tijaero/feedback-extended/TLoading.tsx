/**
 * TLoading - Standardized loading indicator component
 * 
 * Consistent loading states for various use cases.
 * 
 * @example
 * ```tsx
 * <TLoading />
 * <TLoading message="Loading orders..." />
 * <TLoading fullScreen />
 * <TLoading overlay />
 * ```
 */

import React from "react";
import {
  Box,
  CircularProgress,
  LinearProgress,
  Typography,
  Backdrop,
} from "@mui/material";

export interface TLoadingProps {
  /** Loading message */
  message?: string;
  /** Loading variant */
  variant?: "circular" | "linear";
  /** Size for circular variant */
  size?: "small" | "medium" | "large" | number;
  /** Full screen loading */
  fullScreen?: boolean;
  /** Overlay on content */
  overlay?: boolean;
  /** Overlay opacity */
  overlayOpacity?: number;
  /** Progress value (0-100) for determinate mode */
  progress?: number;
  /** Color */
  color?: "primary" | "secondary" | "inherit";
}

// Size map for predefined sizes
const sizeMap = {
  small: 24,
  medium: 40,
  large: 60,
};

export const TLoading: React.FC<TLoadingProps> = ({
  message,
  variant = "circular",
  size = "medium",
  fullScreen = false,
  overlay = false,
  overlayOpacity = 0.7,
  progress,
  color = "primary",
}) => {
  const circularSize = typeof size === "number" ? size : sizeMap[size];
  const isDeterminate = progress !== undefined;

  const content = (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
      }}
    >
      {variant === "circular" ? (
        <CircularProgress
          size={circularSize}
          color={color}
          variant={isDeterminate ? "determinate" : "indeterminate"}
          value={progress}
        />
      ) : (
        <Box sx={{ width: "100%", maxWidth: 300 }}>
          <LinearProgress
            color={color}
            variant={isDeterminate ? "determinate" : "indeterminate"}
            value={progress}
          />
        </Box>
      )}
      {message && (
        <Typography variant="body2" color="text.secondary">
          {message}
        </Typography>
      )}
    </Box>
  );

  // Full screen loading
  if (fullScreen) {
    return (
      <Backdrop
        open
        sx={{
          bgcolor: `rgba(255, 255, 255, ${overlayOpacity})`,
          zIndex: (theme) => theme.zIndex.drawer + 1,
        }}
      >
        {content}
      </Backdrop>
    );
  }

  // Overlay loading
  if (overlay) {
    return (
      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: `rgba(255, 255, 255, ${overlayOpacity})`,
          zIndex: 10,
        }}
      >
        {content}
      </Box>
    );
  }

  // Inline loading
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: 4,
      }}
    >
      {content}
    </Box>
  );
};

export default TLoading;
