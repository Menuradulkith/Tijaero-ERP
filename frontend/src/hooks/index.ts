/**
 * Reusable Hooks for TijaeroERP Frontend
 */

export { useDashboardMetrics } from './useDashboardMetrics';
export { useDebounce } from './useDebounce';
export { useLocalStorage } from './useLocalStorage';
export { usePagination } from './usePagination';
export { useAsync } from './useAsync';
export { useClickOutside } from './useClickOutside';
export { useMediaQuery } from './useMediaQuery';
export { useToggle } from './useToggle';
export { useCopyToClipboard } from './useCopyToClipboard';
export { useDocumentTitle } from './useDocumentTitle';

// Optimized data fetching hooks
export { 
  useReferenceData, 
  REFERENCE_DATA_PRESETS,
  type ReferenceDataType,
  type ReferenceDataResponse,
  type BranchRef,
  type CategoryRef,
  type BrandRef,
  type LocationRef,
  type ProductRef,
  type CountryRef,
  type SupplierRef,
  type CustomerRef,
} from './useReferenceData';
