import { QueryClient } from "@tanstack/react-query";

/**
 * OPTIMIZED QueryClient Configuration
 *
 * - Increased staleTime: Reduces unnecessary refetches
 * - gcTime (cacheTime): Keeps data in cache longer
 * - refetchOnWindowFocus: Disabled to reduce API calls
 * - retry: Limited to 1 retry to fail fast
 */
export const queryClient = new QueryClient({
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

// Query keys that hold stock positions: the warehouse dashboard's unit list and KPI cards
// ("salesStock"), its Stock Summary tab ("salesStockSummary") and the per-unit tracking panel.
const isStockQuery = (key: readonly unknown[]) => {
  const root = key[0];
  return typeof root === "string" && (root.startsWith("salesStock") || root === "stock-tracking");
};

export function invalidateStockQueries() {
  return queryClient.invalidateQueries({ predicate: (q) => isStockQuery(q.queryKey) });
}

// A write to any of these API areas can move stock (sales orders, returns, GRNs, transfers, approvals),
// so the cached dashboard figures must not outlive it.
const STOCK_WRITE_PATH = /^\/?(sales|purchasing\/(returns|grn|orders)|warehouse|inventory|common\/approvals)(\/|\?|$)/;

export function isStockWrite(method: string | undefined, url: string | undefined) {
  const verb = (method || "get").toLowerCase();
  if (verb === "get" || verb === "head" || verb === "options") return false;
  return STOCK_WRITE_PATH.test(url || "");
}
