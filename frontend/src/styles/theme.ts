import { createTheme } from "@mui/material/styles";

// Professional ERP theme inspired by Odoo, SAP, and modern business applications
const theme = createTheme({
  palette: {
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
      default: "#F0F0F0", // Light gray background
      paper: "#FFFFFF",
    },
    text: {
      primary: "#2C3E50", // Dark blue-gray for primary text
      secondary: "#7F8C8D", // Medium gray for secondary text
    },
    divider: "#E0E0E0",
    grey: {
      50: "#FAFAFA",
      100: "#F5F5F5",
      200: "#EEEEEE",
      300: "#E0E0E0",
      400: "#BDBDBD",
      500: "#9E9E9E",
      600: "#757575",
      700: "#616161",
      800: "#424242",
      900: "#212121",
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    fontSize: 14,
    h1: {
      fontSize: "2.25rem",
      fontWeight: 600,
      lineHeight: 1.2,
      color: "#2C3E50",
      "@media (max-width:600px)": {
        fontSize: "1.75rem",
      },
    },
    h2: {
      fontSize: "1.875rem",
      fontWeight: 600,
      lineHeight: 1.3,
      color: "#2C3E50",
      "@media (max-width:600px)": {
        fontSize: "1.5rem",
      },
    },
    h3: {
      fontSize: "1.5rem",
      fontWeight: 600,
      lineHeight: 1.4,
      color: "#2C3E50",
      "@media (max-width:600px)": {
        fontSize: "1.25rem",
      },
    },
    h4: {
      fontSize: "1.25rem",
      fontWeight: 600,
      lineHeight: 1.4,
      color: "#2C3E50",
      "@media (max-width:600px)": {
        fontSize: "1.125rem",
      },
    },
    h5: {
      fontSize: "1.125rem",
      fontWeight: 600,
      lineHeight: 1.5,
      color: "#2C3E50",
      "@media (max-width:600px)": {
        fontSize: "1rem",
      },
    },
    h6: {
      fontSize: "1rem",
      fontWeight: 600,
      lineHeight: 1.5,
      color: "#2C3E50",
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
          borderRadius: 4,
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
          borderRadius: 8,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
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
          borderRight: "1px solid #E0E0E0",
          boxShadow: "none",
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: "1px solid #E0E0E0",
          padding: "12px 16px",
          "@media (max-width:600px)": {
            padding: "8px 12px",
            fontSize: "0.75rem",
          },
        },
        head: {
          fontWeight: 600,
          backgroundColor: "#FAFAFA",
          color: "#2C3E50",
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
              borderColor: "#E0E0E0",
            },
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

export default theme;
