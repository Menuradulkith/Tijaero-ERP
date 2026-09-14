import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import React, { useEffect, useMemo } from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "react-hot-toast";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ErrorBoundary } from "./components/tijaero/ErrorBoundary";
import { useThemeStore } from "./state/themeStore";
import { useCurrencyStore } from "./state/currencyStore";
import { useTimezoneStore } from "./state/timezoneStore";
import { useAuthStore } from "./state/authStore";
import { settingsApi } from "./modules/settings/api";
import "./styles/global.css"; // Import global styles for required fields
import { createAppTheme } from "./styles/theme";

/**
 * Seed the currency store from the server once on app load, so the active
 * ERP currency (Settings > Company Configuration > Currency) is reflected
 * across all TCurrency/formatCurrency call sites without a hard reload.
 */
function useCurrencyBootstrap() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    (async () => {
      try {
        const [company, currencies] = await Promise.all([
          settingsApi.getCompanySettings(),
          settingsApi.getCurrencies(),
        ]);
        const active = currencies.find((c) => c.code === company.default_currency);
        if (!cancelled && active) {
          useCurrencyStore.getState().setCurrency(active.code, active.symbol);
        }
      } catch {
        // Not logged in yet, or request failed — keep persisted/default currency.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);
}

/**
 * Seed the timezone store from the server once on app load, so the ERP's
 * configured timezone (Settings > Company Configuration > Company Details)
 * is reflected across TDate/formatDateTimeReadable without a hard reload.
 */
function useTimezoneBootstrap() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    (async () => {
      try {
        const company = await settingsApi.getCompanySettings();
        if (!cancelled && company.default_timezone) {
          useTimezoneStore.getState().setTimezone(company.default_timezone);
        }
      } catch {
        // Not logged in yet, or request failed — keep persisted/default timezone.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);
}

/**
 * OPTIMIZED QueryClient Configuration
 *
 * - Increased staleTime: Reduces unnecessary refetches
 * - gcTime (cacheTime): Keeps data in cache longer
 * - refetchOnWindowFocus: Disabled to reduce API calls
 * - retry: Limited to 1 retry to fail fast
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes - data considered fresh
      gcTime: 10 * 60 * 1000, // 10 minutes - keep in cache (formerly cacheTime)
    },
  },
});

function ThemedApp() {
  const { mode } = useThemeStore();
  const theme = useMemo(() => createAppTheme(mode), [mode]);
  useCurrencyBootstrap();
  useTimezoneBootstrap();

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
      <Toaster position="top-right" />
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ThemedApp />
        </BrowserRouter>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
