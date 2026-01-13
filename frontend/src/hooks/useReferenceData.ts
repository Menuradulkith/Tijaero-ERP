/**
 * useReferenceData - Optimized hook for fetching multiple reference datasets in a single API call.
 * 
 * This hook reduces the number of API calls needed when loading pages that require
 * multiple reference datasets (branches, categories, brands, locations, products, etc.)
 * 
 * BEFORE: 6 separate API calls
 * AFTER: 1 aggregated API call
 * 
 * @example
 * // Fetch branches, categories, and brands in one call
 * const { data, isLoading } = useReferenceData(["branches", "categories", "brands"]);
 * 
 * // Access individual datasets
 * const branches = data?.branches || [];
 * const categories = data?.categories || [];
 */

import { useQuery, UseQueryOptions } from "@tanstack/react-query";
import apiClient from "@/api/client";

// Types for reference data items
export interface BranchRef {
  id: number;
  branch_code: string;
  branch_name: string;
  created_at?: string;
  updated_at?: string;
}

export interface CategoryRef {
  id: number;
  name: string;
  is_active?: boolean;
}

export interface BrandRef {
  id: number;
  brand_name: string;
}

export interface LocationRef {
  id: number;
  name: string;
  branch_code: string;
}

export interface ProductRef {
  id: number;
  name: string;
  item_code: string;
  category_id?: number;
  items_brand_id?: number;
  cost_price?: number;
  selling_price?: number;
  item_type?: string;
  website_active?: boolean;
  active?: boolean;
  description?: string;
  model?: string;
  website_price?: number;
}

export interface CountryRef {
  id: number;
  name: string;
  iso: string;
}

export interface SupplierRef {
  id: number;
  full_name: string;
  company_name?: string;
}

export interface CustomerRef {
  id: number;
  customer_name: string;
  mobile_contact_number?: string;
  email?: string;
}

// All available reference data types
export type ReferenceDataType = 
  | "branches" 
  | "categories" 
  | "brands" 
  | "locations" 
  | "products" 
  | "countries"
  | "suppliers"
  | "customers";

// Response type from the API
export interface ReferenceDataResponse {
  branches?: BranchRef[];
  categories?: CategoryRef[];
  brands?: BrandRef[];
  locations?: LocationRef[];
  products?: ProductRef[];
  countries?: CountryRef[];
  suppliers?: SupplierRef[];
  customers?: CustomerRef[];
}

// Options for the hook
export interface UseReferenceDataOptions {
  /** Maximum number of products to fetch (default: 500) */
  productsLimit?: number;
  /** Whether the query should be enabled (default: true) */
  enabled?: boolean;
  /** Additional React Query options */
  queryOptions?: Omit<UseQueryOptions<ReferenceDataResponse, Error>, 'queryKey' | 'queryFn'>;
}

/**
 * Fetch reference data from the optimized aggregated endpoint
 */
async function fetchReferenceData(
  include: ReferenceDataType[],
  productsLimit: number = 500
): Promise<ReferenceDataResponse> {
  const response = await apiClient.get<ReferenceDataResponse>("/common/reference-data", {
    params: {
      include: include.join(","),
      products_limit: productsLimit,
    },
  });
  return response.data;
}

/**
 * Hook for fetching multiple reference datasets in a single optimized API call.
 * 
 * @param include - Array of reference data types to include
 * @param options - Additional options like productsLimit and React Query options
 * @returns Query result with aggregated reference data
 */
export function useReferenceData(
  include: ReferenceDataType[] = ["branches"],
  options: UseReferenceDataOptions = {}
) {
  const { productsLimit = 500, enabled = true, queryOptions = {} } = options;
  
  // Sort include array to ensure consistent query keys
  const sortedInclude = [...include].sort();
  
  return useQuery<ReferenceDataResponse, Error>({
    queryKey: ["referenceData", sortedInclude.join(","), productsLimit],
    queryFn: () => fetchReferenceData(sortedInclude, productsLimit),
    // Reference data rarely changes, use longer stale time
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes (formerly cacheTime)
    refetchOnWindowFocus: false,
    enabled,
    ...queryOptions,
  });
}

/**
 * Predefined reference data combinations for common use cases
 */
export const REFERENCE_DATA_PRESETS = {
  /** For sales pages: branches, customers, products */
  SALES: ["branches", "customers", "products"] as ReferenceDataType[],
  /** For purchasing pages: branches, suppliers, products */
  PURCHASING: ["branches", "suppliers", "products"] as ReferenceDataType[],
  /** For inventory pages: branches, categories, brands, products */
  INVENTORY: ["branches", "categories", "brands", "products"] as ReferenceDataType[],
  /** For warehouse pages: branches, locations, products */
  WAREHOUSE: ["branches", "locations", "products"] as ReferenceDataType[],
  /** For dashboard: branches, categories, brands, locations, products */
  DASHBOARD: ["branches", "categories", "brands", "locations", "products"] as ReferenceDataType[],
  /** Basic: just branches */
  BASIC: ["branches"] as ReferenceDataType[],
} as const;

export default useReferenceData;
