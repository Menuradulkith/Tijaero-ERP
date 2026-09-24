import { createTheme } from "@mui/material/styles";

// Define PaletteMode type
type PaletteMode = "light" | "dark";

// Function to create theme based on mode
export const createAppTheme = (mode: PaletteMode) => {
  const isLight = mode === "light";

  return createTheme({
    palette: {
      mode,
      primary: {
        main: "#714B67", // Deep purple - professional and distinctive
        light: "#9B6B8F",
        dark: "#4A2F42",
        contrastText: "#ffffff",
      },
      secondary: {
        main: "#00A09D", // Teal accent - modern and fresh
        light: "#33B3B0",
        dark: "#00706E",
        contrastText: "#ffffff",
      },
      success: {
        main: "#00A04A", // Green for approved/success states
        light: "#33B36E",
        dark: "#007033",
      },
      warning: {
        main: "#F0AD4E", // Amber for pending/warning states
        light: "#F3BD71",
        dark: "#EC971F",
      },
      error: {
        main: "#D9534F", // Red for rejected/error states
        light: "#E17572",
        dark: "#C9302C",
      },
      info: {
        main: "#5BC0DE", // Light blue for info
        light: "#7FCCE8",
        dark: "#46B8DA",
      },
      background: {
        default: isLight ? "#F0F0F0" : "#121212",
        paper: isLight ? "#FFFFFF" : "#1E1E1E",
      },
      text: {
        primary: isLight ? "#2C3E50" : "#E0E0E0",
        secondary: isLight ? "#7F8C8D" : "#A0A0A0",
      },
      divider: isLight ? "#E0E0E0" : "#333333",
      grey: {
        50: isLight ? "#FAFAFA" : "#303030",
        100: isLight ? "#F5F5F5" : "#2A2A2A",
        200: isLight ? "#EEEEEE" : "#252525",
        300: isLight ? "#E0E0E0" : "#333333",
        400: isLight ? "#BDBDBD" : "#4A4A4A",
        500: isLight ? "#9E9E9E" : "#6A6A6A",
        600: isLight ? "#757575" : "#8A8A8A",
        700: isLight ? "#616161" : "#A0A0A0",
        800: isLight ? "#424242" : "#BDBDBD",
        900: isLight ? "#212121" : "#E0E0E0",
      },
    },
    typography: {
      fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
      fontSize: 14,
      h1: {
        fontSize: "2.25rem",
        fontWeight: 600,
        lineHeight: 1.2,
        "@media (max-width:600px)": {
          fontSize: "1.75rem",
        },
      },
      h2: {
        fontSize: "1.875rem",
        fontWeight: 600,
        lineHeight: 1.3,
        "@media (max-width:600px)": {
          fontSize: "1.5rem",
        },
      },
      h3: {
        fontSize: "1.5rem",
        fontWeight: 600,
        lineHeight: 1.4,
        "@media (max-width:600px)": {
          fontSize: "1.25rem",
        },
      },
      h4: {
        fontSize: "1.25rem",
        fontWeight: 600,
        lineHeight: 1.4,
        "@media (max-width:600px)": {
          fontSize: "1.125rem",
        },
      },
      h5: {
        fontSize: "1.125rem",
        fontWeight: 600,
        lineHeight: 1.5,
        "@media (max-width:600px)": {
          fontSize: "1rem",
        },
      },
      h6: {
        fontSize: "1rem",
        fontWeight: 600,
        lineHeight: 1.5,
        "@media (max-width:600px)": {
          fontSize: "0.9375rem",
        },
      },
      subtitle1: {
        fontSize: "1rem",
        fontWeight: 500,
        lineHeight: 1.5,
      },
      subtitle2: {
        fontSize: "0.875rem",
        fontWeight: 500,
        lineHeight: 1.57,
      },
      body1: {
        fontSize: "0.875rem",
        lineHeight: 1.5,
      },
      body2: {
        fontSize: "0.8125rem",
        lineHeight: 1.5,
      },
      button: {
        fontSize: "0.875rem",
        fontWeight: 500,
        textTransform: "none",
      },
    },
    shape: {
      borderRadius: 4,
    },
    shadows: [
      "none",
      "0px 1px 3px rgba(0, 0, 0, 0.08)",
      "0px 2px 4px rgba(0, 0, 0, 0.08)",
      "0px 3px 6px rgba(0, 0, 0, 0.08)",
      "0px 4px 8px rgba(0, 0, 0, 0.08)",
      "0px 6px 12px rgba(0, 0, 0, 0.08)",
      "0px 8px 16px rgba(0, 0, 0, 0.08)",
      "0px 12px 24px rgba(0, 0, 0, 0.08)",
      "0px 16px 32px rgba(0, 0, 0, 0.08)",
      "0px 20px 40px rgba(0, 0, 0, 0.08)",
      "0px 24px 48px rgba(0, 0, 0, 0.08)",
      "0px 2px 4px rgba(0, 0, 0, 0.1)",
      "0px 3px 6px rgba(0, 0, 0, 0.1)",
      "0px 4px 8px rgba(0, 0, 0, 0.1)",
      "0px 6px 12px rgba(0, 0, 0, 0.1)",
      "0px 8px 16px rgba(0, 0, 0, 0.1)",
      "0px 12px 24px rgba(0, 0, 0, 0.1)",
      "0px 16px 32px rgba(0, 0, 0, 0.1)",
      "0px 20px 40px rgba(0, 0, 0, 0.1)",
      "0px 24px 48px rgba(0, 0, 0, 0.1)",
      "0px 32px 64px rgba(0, 0, 0, 0.1)",
      "0px 40px 80px rgba(0, 0, 0, 0.1)",
      "0px 48px 96px rgba(0, 0, 0, 0.1)",
      "0px 56px 112px rgba(0, 0, 0, 0.1)",
      "0px 64px 128px rgba(0, 0, 0, 0.1)",
    ],
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: "none",
            fontWeight: 500,
            borderRadius: 12,
            padding: "8px 16px",
            "@media (max-width:600px)": {
              padding: "6px 12px",
              fontSize: "0.8125rem",
            },
          },
          contained: {
            boxShadow: "none",
            "&:hover": {
              boxShadow: "0px 2px 4px rgba(0, 0, 0, 0.12)",
            },
          },
          sizeSmall: {
            padding: "4px 10px",
            fontSize: "0.8125rem",
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            boxShadow: "0px 1px 3px rgba(0, 0, 0, 0.08)",
            borderRadius: 12,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
            borderRadius: 12,
          },
          elevation1: {
            boxShadow: "0px 1px 3px rgba(0, 0, 0, 0.08)",
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            boxShadow: "0px 1px 3px rgba(0, 0, 0, 0.08)",
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            borderRight: isLight ? "1px solid #E0E0E0" : "1px solid #333333",
            boxShadow: "none",
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderBottom: isLight ? "1px solid #E0E0E0" : "1px solid #333333",
            padding: "12px 16px",
            "@media (max-width:600px)": {
              padding: "8px 12px",
              fontSize: "0.75rem",
            },
          },
          head: {
            fontWeight: 600,
            backgroundColor: isLight ? "#FAFAFA" : "#2A2A2A",
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            "@media (max-width:600px)": {
              margin: "16px",
              maxHeight: "calc(100% - 32px)",
              width: "calc(100% - 32px)",
            },
          },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: {
            "@media (max-width:600px)": {
              fontSize: "1.125rem",
              padding: "12px 16px",
            },
          },
        },
      },
      MuiDialogContent: {
        styleOverrides: {
          root: {
            "@media (max-width:600px)": {
              padding: "12px 16px",
            },
          },
        },
      },
      MuiDialogActions: {
        styleOverrides: {
          root: {
            "@media (max-width:600px)": {
              padding: "12px 16px",
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            fontWeight: 500,
            borderRadius: 4,
          },
        },
      },
      MuiTextField: {
        styleOverrides: {
          root: {
            "& .MuiOutlinedInput-root": {
              "& fieldset": {
                borderColor: isLight ? "#E0E0E0" : "#333333",
              },
            },
            // Light red background for required fields — applied to the
            // input container (.MuiInputBase-root, which inherits the
            // rounded corners), not the inner <input>/<textarea> itself,
            // which doesn't inherit border-radius and would show a
            // square-cornered patch poking out past the rounded outline.
            "& .MuiInputBase-root.Mui-required, &.Mui-required .MuiInputBase-root": {
              backgroundColor: isLight ? "rgba(255, 235, 238, 0.4)" : "rgba(211, 47, 47, 0.08)",
            },
            // Disabled + required (e.g. a view-mode form) reads as neutral
            // grey instead of the attention-grabbing red — more specific
            // than the rule above so it wins.
            "& .MuiInputBase-root.Mui-required.Mui-disabled, &.Mui-required .MuiInputBase-root.Mui-disabled": {
              backgroundColor: isLight ? "rgba(0, 0, 0, 0.06)" : "rgba(255, 255, 255, 0.09)",
            },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            // Search boxes and filter dropdowns (Autocomplete/Select all
            // render through this) should read as solid white fields against
            // the app's grey page background, not blend into it.
            backgroundColor: isLight ? "#FFFFFF" : "#1E1E1E",
            // Softer, more rounded corners than the app's default 4px
            // (shape.borderRadius) — scoped to inputs only, not buttons/
            // cards/dialogs, which keep their own separate radii.
            borderRadius: 12,
            // Apply light red background when required attribute is present.
            // Only on the root (which properly inherits the rounded corners
            // above) — not on the inner <input> element, which doesn't
            // inherit border-radius and would show a square-cornered patch
            // poking out past the rounded outline.
            "&.Mui-required": {
              backgroundColor: isLight ? "rgba(255, 235, 238, 0.4)" : "rgba(211, 47, 47, 0.08)",
            },
            // A required field that's also disabled (e.g. a form shown in
            // read-only/view mode) shouldn't keep the attention-grabbing red
            // tint — a plain neutral grey reads as "disabled", not "needs
            // attention". More specific than the red rule above so it wins.
            "&.Mui-required.Mui-disabled": {
              backgroundColor: isLight ? "rgba(0, 0, 0, 0.06)" : "rgba(255, 255, 255, 0.09)",
            },
          },
        },
      },
      MuiFilledInput: {
        styleOverrides: {
          // Root only (inherits border-radius) — not the inner <input>,
          // which would show a square-cornered patch past the rounded edge.
          root: {
            "&.Mui-required": {
              backgroundColor: isLight ? "rgba(255, 235, 238, 0.5)" : "rgba(211, 47, 47, 0.12)",
            },
          },
        },
      },
      // No MuiSelect required-background override — a `TextField select`
      // renders its select through MuiOutlinedInput-root (fixed above),
      // which already gets the tint with correctly-rounded corners. A
      // select-level background here would sit on an element whose own
      // border-radius doesn't match the outer rounded outline.
      MuiAutocomplete: {
        styleOverrides: {
          inputRoot: {
            "&.Mui-required": {
              backgroundColor: isLight ? "rgba(255, 235, 238, 0.4)" : "rgba(211, 47, 47, 0.08)",
            },
            "&.Mui-required.Mui-disabled": {
              backgroundColor: isLight ? "rgba(0, 0, 0, 0.06)" : "rgba(255, 255, 255, 0.09)",
            },
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: "none",
            fontWeight: 500,
            fontSize: "0.875rem",
          },
        },
      },
    },
  });
};

// Default light theme for backward compatibility
const theme = createAppTheme("light");
export default theme;
