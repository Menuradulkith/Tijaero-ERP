/**
 * Custom hook for fetching and managing dashboard metrics
 */
import { DashboardMetrics, getDashboardMetrics } from "@/api/reporting";
import { cache } from "@/utils/cache";
import { useCallback, useEffect, useRef, useState } from "react";

const CACHE_KEY = "dashboard_metrics";
const DEFAULT_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

export interface UseDashboardMetricsOptions {
  autoRefresh?: boolean;
  refreshInterval?: number;
  skipInitialFetch?: boolean;
}

export interface UseDashboardMetricsResult {
  metrics: DashboardMetrics | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  lastUpdated: Date | null;
}

/**
 * Hook for fetching and managing dashboard metrics
 * @param options - Configuration options
 * @returns Dashboard metrics state and control functions
 */
export function useDashboardMetrics(
  options: UseDashboardMetricsOptions = {},
): UseDashboardMetricsResult {
  const {
    autoRefresh = true,
    refreshInterval = DEFAULT_REFRESH_INTERVAL,
    skipInitialFetch = false,
  } = options;

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState<boolean>(!skipInitialFetch);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef<boolean>(true);

  /**
   * Fetch metrics from API or cache
   */
  const fetchMetrics = useCallback(async (skipCache: boolean = false) => {
    try {
      setLoading(true);
      setError(null);

      // Check cache first unless explicitly skipped
      if (!skipCache) {
        const cachedData = cache.get<DashboardMetrics>(CACHE_KEY);
        if (cachedData) {
          if (isMountedRef.current) {
            setMetrics(cachedData);
            setLoading(false);
          }
          return;
        }
      }

      // Fetch from API
      const data = await getDashboardMetrics();

      // Cache the response
      cache.set(CACHE_KEY, data);

      if (isMountedRef.current) {
        setMetrics(data);
        setLastUpdated(new Date());
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(err as Error);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  /**
   * Manual refresh function that bypasses cache
   */
  const refresh = useCallback(async () => {
    // Invalidate cache
    cache.invalidate(CACHE_KEY);
    await fetchMetrics(true);
  }, [fetchMetrics]);

  // Initial fetch on mount
  useEffect(() => {
    if (!skipInitialFetch) {
      fetchMetrics();
    }
  }, [fetchMetrics, skipInitialFetch]);

  // Set up auto-refresh interval
  useEffect(() => {
    if (autoRefresh && refreshInterval > 0) {
      intervalRef.current = setInterval(() => {
        fetchMetrics(true);
      }, refreshInterval);

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
    }
  }, [autoRefresh, refreshInterval, fetchMetrics]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    metrics,
    loading,
    error,
    refresh,
    lastUpdated,
  };
}
