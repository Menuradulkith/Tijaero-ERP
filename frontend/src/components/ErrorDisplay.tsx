/**
 * Error display component with retry functionality
 */
import { Alert, Button, Box } from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";

interface ErrorDisplayProps {
  error: Error;
  onRetry?: () => void;
  showRetry?: boolean;
}

/**
 * Display error message with optional retry button
 */
export default function ErrorDisplay({
  error,
  onRetry,
  showRetry = true,
}: ErrorDisplayProps) {
  // Log error for debugging
  console.error("[ErrorDisplay]", {
    message: error.message,
    name: error.name,
    timestamp: new Date().toISOString(),
  });

  return (
    <Box sx={{ width: "100%" }}>
      <Alert
        severity="error"
        action={
          showRetry && onRetry ? (
            <Button
              color="inherit"
              size="small"
              startIcon={<RefreshIcon />}
              onClick={onRetry}
            >
              Retry
            </Button>
          ) : undefined
        }
      >
        {error.message || "An unexpected error occurred"}
      </Alert>
    </Box>
  );
}
