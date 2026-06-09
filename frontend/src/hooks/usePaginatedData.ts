/**
 * usePaginatedData - Reusable hook for server-side pagination with load balancing
 * 
 * Features:
 * - Server-side pagination (reduces data transfer)
 * - Debounced search (reduces API calls)
 * - Optimistic page transitions (keepPreviousData)
 * - Configurable cache and stale times
 * - Branch filtering integration
 * 
 * @example
 * ```tsx
 * const {
 *   data,
 *   isLoading,
 *   page,
 *   pageSize,
 *   totalPages,
 *   setPage,
 *   setSearch,
 *   setFilters,
 * } = usePaginatedData({
 *   queryKey: "sales",
 *   fetchFn: salesApi.getPaginated,
 *   defaultPageSize: 100000,
 * });
 * ```
 */

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useState, useCallback, useMemo } from "react";
import { useDebounce } from "./useDebounce";
import { DELAYS } from "@/constants/config";

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface PaginatedDataFilters {
  branchCode?: string;
  status?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface UsePaginatedDataOptions<T, F extends PaginatedDataFilters = PaginatedDataFilters> {
  /** Unique query key for caching */
  queryKey: string;
  /** Function to fetch paginated data */
  fetchFn: (params: {
    page: number;
    pageSize: number;
    search?: string;
    sortBy?: string;
    sortDesc?: boolean;
  } & F) => Promise<PaginatedResponse<T>>;
  /** Default page size */
  defaultPageSize?: number;
  /** Default sort field */
  defaultSortBy?: string;
  /** Default sort direction */
  defaultSortDesc?: boolean;
  /** Initial filters */
  initialFilters?: F;
  /** Stale time in ms (default: 30s) */
  staleTime?: number;
  /** Whether the query is enabled */
  enabled?: boolean;
}

export interface UsePaginatedDataReturn<T, F extends PaginatedDataFilters = PaginatedDataFilters> {
  /** Current page data */
  data: T[];
  /** Is loading initial data */
  isLoading: boolean;
  /** Is fetching (includes background refetch) */
  isFetching: boolean;
  /** Total number of items */
  total: number;
  /** Current page (1-indexed) */
  page: number;
  /** Page size */
  pageSize: number;
  /** Total number of pages */
  totalPages: number;
  /** Current search term */
  search: string;
  /** Current sort field */
  sortBy: string;
  /** Current sort direction */
  sortDesc: boolean;
  /** Current filters */
  filters: F;
  /** Set current page */
  setPage: (page: number) => void;
  /** Set page size */
  setPageSize: (size: number) => void;
  /** Set search term (debounced) */
  setSearch: (search: string) => void;
  /** Set sort field and direction */
  setSort: (field: string, desc?: boolean) => void;
  /** Set filters */
  setFilters: (filters: Partial<F>) => void;
  /** Reset all filters and pagination */
  reset: () => void;
  /** Refetch current data */
  refetch: () => void;
  /** Has more pages */
  hasNextPage: boolean;
  /** Has previous pages */
  hasPreviousPage: boolean;
  /** Go to next page */
  nextPage: () => void;
  /** Go to previous page */
  previousPage: () => void;
}

export function usePaginatedData<T, F extends PaginatedDataFilters = PaginatedDataFilters>(
  options: UsePaginatedDataOptions<T, F>
): UsePaginatedDataReturn<T, F> {
  const {
    queryKey,
    fetchFn,
    defaultPageSize = 100000,
    defaultSortBy = "created_date",
    defaultSortDesc = true,
    initialFilters = {} as F,
    staleTime = 30000, // 30 seconds
    enabled = true,
  } = options;

  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  
  // Search state (with debounce)
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebounce(searchInput, DELAYS.SEARCH_DEBOUNCE);
  
  // Sort state
  const [sortBy, setSortBy] = useState(defaultSortBy);
  const [sortDesc, setSortDesc] = useState(defaultSortDesc);
  
  // Filter state
  const [filters, setFiltersState] = useState<F>(initialFilters);

  // Build query params
  const queryParams = useMemo(() => ({
    page,
    pageSize,
    search: debouncedSearch || undefined,
    sortBy,
    sortDesc,
    ...filters,
  }), [page, pageSize, debouncedSearch, sortBy, sortDesc, filters]);

  // Query with keepPreviousData for smooth pagination
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: [queryKey, "paginated", queryParams],
    queryFn: () => fetchFn(queryParams),
    staleTime,
    placeholderData: keepPreviousData, // Smooth page transitions
    enabled,
  });

  // Reset page when filters change
  const setFilters = useCallback((newFilters: Partial<F>) => {
    setFiltersState(prev => ({ ...prev, ...newFilters }));
    setPage(1); // Reset to first page on filter change
  }, []);

  const setSearch = useCallback((search: string) => {
    setSearchInput(search);
    setPage(1); // Reset to first page on search
  }, []);

  const setSort = useCallback((field: string, desc = true) => {
    setSortBy(field);
    setSortDesc(desc);
    setPage(1);
  }, []);

  const handleSetPageSize = useCallback((size: number) => {
    setPageSize(size);
    setPage(1);
  }, []);

  const reset = useCallback(() => {
    setPage(1);
    setPageSize(defaultPageSize);
    setSearchInput("");
    setSortBy(defaultSortBy);
    setSortDesc(defaultSortDesc);
    setFiltersState(initialFilters);
  }, [defaultPageSize, defaultSortBy, defaultSortDesc, initialFilters]);

  const totalPages = data?.total_pages || 1;
  const hasNextPage = page < totalPages;
  const hasPreviousPage = page > 1;

  const nextPage = useCallback(() => {
    if (hasNextPage) setPage(p => p + 1);
  }, [hasNextPage]);

  const previousPage = useCallback(() => {
    if (hasPreviousPage) setPage(p => p - 1);
  }, [hasPreviousPage]);

  return {
    data: data?.items || [],
    isLoading,
    isFetching,
    total: data?.total || 0,
    page,
    pageSize,
    totalPages,
    search: searchInput,
    sortBy,
    sortDesc,
    filters,
    setPage,
    setPageSize: handleSetPageSize,
    setSearch,
    setSort,
    setFilters,
    reset,
    refetch,
    hasNextPage,
    hasPreviousPage,
    nextPage,
    previousPage,
  };
}

export default usePaginatedData;
