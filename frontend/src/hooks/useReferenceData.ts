/**
 * useReferenceData - Optimized hook for fetching multiple reference datasets in a single API call.
 * 
 * This hook reduces the number of API calls needed when loading pages that require
 * multiple reference datasets (branches, categories, brands, locations, products, etc.)
 * 
 * BEFORE: 6 separate API calls
 * AFTER: 1 aggregated API call
 * 
 * Branch-based access control: When fetching branches, the returned data will
 * be filtered based on the user's assigned branches. Superusers see all branches.
 * 
 * @example
 * // Fetch branches, categories, and brands in one call
 * const { data, isLoading, filteredBranches } = useReferenceData(["branches", "categories", "brands"]);
 * 
 * // Use filteredBranches for dropdowns (respects user's branch access)
 * const branches = filteredBranches || [];
 * 
 * // Access other individual datasets
 * const categories = data?.categories || [];
 */

import apiClient from "@/api/client";
import { useQuery, UseQueryOptions } from "@tanstack/react-query";
import { useBranchFilter } from "./useBranchFilter";

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
  is_customer_agent?: boolean;
  active?: boolean;
  commission_rate?: number;
}

export interface EmployeeRef {
  id: number;
  employee_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
}

export interface SalesStockRef {
  id: number;
  product_code: string;
  product_name: string;
  description?: string;
  category_id?: number;
  brand_id?: number;
  unit_of_measure?: string;
  reorder_level?: number;
  status: boolean;
  available_quantity: number;
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
  | "customers"
  | "employees"
  | "sales_stock";

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
  employees?: EmployeeRef[];
  sales_stock?: SalesStockRef[];
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
 * @returns Query result with aggregated reference data plus filteredBranches for access control
 */
export function useReferenceData(
  include: ReferenceDataType[] = ["branches"],
  options: UseReferenceDataOptions = {}
) {
  const { productsLimit = 500, enabled = true, queryOptions = {} } = options;
  const { filterBranches, canAccessBranch, hasAllBranchAccess, getDefaultBranchCode } = useBranchFilter();

  // Sort include array to ensure consistent query keys
  const sortedInclude = [...include].sort();

  const query = useQuery<ReferenceDataResponse, Error>({
    queryKey: ["referenceData", sortedInclude.join(","), productsLimit],
    queryFn: () => fetchReferenceData(sortedInclude, productsLimit),
    // Reference data can change (customers, products, etc.), use shorter stale time
    staleTime: 30 * 1000, // 30 seconds - refetch if data is older than 30 seconds
    gcTime: 30 * 60 * 1000, // 30 minutes (formerly cacheTime)
    refetchOnWindowFocus: true, // Refetch when window regains focus
    enabled,
    ...queryOptions,
  });

  // Filter branches based on user's access rights
  const filteredBranches = query.data?.branches 
    ? filterBranches(query.data.branches)
    : [];

  // Filter locations to only show those from accessible branches
  const filteredLocations = query.data?.locations
    ? query.data.locations.filter((loc) => canAccessBranch(loc.branch_code))
    : [];

  return {
    ...query,
    /** Branches filtered by user's access rights - use this for dropdowns */
    filteredBranches,
    /** Locations filtered by user's branch access */
    filteredLocations,
    /** Check if user can access a specific branch */
    canAccessBranch,
    /** True if user has access to all branches (superuser) */
    hasAllBranchAccess,
    /** User's default/first branch code for form defaults */
    defaultBranchCode: getDefaultBranchCode,
  };
}

/**
 * Predefined reference data combinations for common use cases
 */
export const REFERENCE_DATA_PRESETS = {
  /** For sales pages: branches, customers, products, employees */
  SALES: ["branches", "customers", "products", "employees"] as ReferenceDataType[],
  /** For quotations: branches, customers, products, employees */
  QUOTATIONS: ["branches", "customers", "products", "employees"] as ReferenceDataType[],
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
