import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { Box, Button, Paper, Typography } from "@mui/material";
import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // You can also log the error to an error reporting service like Sentry or LogRocket
    console.error("Uncaught component runtime error:", error, errorInfo);
  }

  private handleReload = () => {
    // Attempt to recover by reloading
    window.location.reload();
  };

  private handleGoHome = () => {
    // Reset state and bounce to home
    window.location.href = "/";
  };

  public render() {
    if (this.state.hasError) {
      return (
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            minHeight: "100vh",
            height: "100%",
            width: "100%",
            bgcolor: "background.default",
            p: 3,
          }}
        >
          <Paper
            elevation={4}
            sx={{ p: 5, maxWidth: 640, textAlign: "center", borderRadius: 3 }}
          >
            <ErrorOutlineIcon color="error" sx={{ fontSize: 72, mb: 1 }} />
            <Typography
              variant="h4"
              color="error"
              gutterBottom
              fontWeight="bold"
            >
              Application Error
            </Typography>
            <Typography variant="body1" color="text.secondary" paragraph>
              The user interface encountered an unexpected rendering error. Our
              engineers have been notified. Sorry for the inconvenience.
            </Typography>

            <Box
              sx={{
                mt: 3,
                bgcolor: "#f5f5f5",
                p: 2,
                borderRadius: 1,
                textAlign: "left",
                overflow: "auto",
                maxHeight: 180,
                border: "1px solid #e0e0e0",
              }}
            >
              <Typography
                variant="caption"
                component="pre"
                sx={{
                  color: "error.main",
                  m: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "monospace",
                }}
              >
                {this.state.error?.toString() ||
                  "Unknown Error Component State"}
              </Typography>
            </Box>

            <Box
              sx={{ mt: 4, display: "flex", gap: 2, justifyContent: "center" }}
            >
              <Button
                variant="outlined"
                color="primary"
                onClick={this.handleReload}
                size="large"
              >
                Reload Page
              </Button>
              <Button
                variant="contained"
                color="primary"
                onClick={this.handleGoHome}
                size="large"
              >
                Return to Home
              </Button>
            </Box>
          </Paper>
        </Box>
      );
    }

    return this.props.children;
  }
}
