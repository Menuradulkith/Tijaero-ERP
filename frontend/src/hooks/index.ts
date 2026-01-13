/**
 * Reusable Hooks for TijaeroERP Frontend
 */

export { useAsync } from './useAsync';
export { useClickOutside } from './useClickOutside';
export { useCopyToClipboard } from './useCopyToClipboard';
export { useDashboardMetrics } from './useDashboardMetrics';
export { useDebounce } from './useDebounce';
export { useDocumentTitle } from './useDocumentTitle';
export { useLocalStorage } from './useLocalStorage';
export { useMediaQuery } from './useMediaQuery';
export { usePagination } from './usePagination';
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
