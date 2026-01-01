# Implementation Plan: Dashboard API Integration

## Overview

This implementation plan breaks down the dashboard API integration into discrete coding tasks. Each task builds on previous work, with testing integrated throughout to catch issues early. The plan follows a bottom-up approach: utilities → API client → custom hook → component integration.

## Tasks

- [x] 1. Create utility functions for data formatting and calculations

  - Create `frontend/src/utils/formatters.ts` with currency, number, and relative time formatting functions
  - Create `frontend/src/utils/calculations.ts` with trend calculation logic
  - _Requirements: 2.2, 2.5, 3.2, 5.2, 10.1_

- [ ]\* 1.1 Write property test for percentage change calculation

  - **Property 4: Percentage change calculation**
  - **Validates: Requirements 2.2, 3.3, 5.3, 10.1**

- [ ]\* 1.2 Write property test for number formatting

  - **Property 6: Number formatting with commas**
  - **Validates: Requirements 2.5, 4.4**

- [ ]\* 1.3 Write property test for currency formatting

  - **Property 7: Currency formatting**
  - **Validates: Requirements 3.2, 5.2**

- [ ]\* 1.4 Write unit tests for edge cases

  - Test formatCurrency with negative values
  - Test formatNumber with zero
  - Test calculateTrend with zero previous value
  - Test formatRelativeTime with various timestamps
  - _Requirements: 2.2, 2.5, 3.2, 10.5_

- [x] 2. Create API client for reporting endpoints

  - Create `frontend/src/api/reporting.ts` with TypeScript interfaces and API functions
  - Define `DashboardMetrics` and `RecentActivity` interfaces
  - Implement `getDashboardMetrics()` function using existing Axios client
  - Add proper error handling and type safety
  - _Requirements: 1.1, 8.1_

- [ ]\* 2.1 Write unit tests for API client

  - Test successful API call returns correct data structure
  - Test API call with network error throws appropriate error
  - Test API call with 401 status throws authentication error
  - Test API call with 500 status throws server error
  - _Requirements: 1.1, 8.1, 8.5_

- [x] 3. Implement caching mechanism

  - Create `frontend/src/utils/cache.ts` with in-memory cache implementation
  - Implement 5-minute TTL (time-to-live) logic
  - Add cache invalidation on manual refresh
  - _Requirements: 1.5_

- [ ]\* 3.1 Write property test for cache behavior

  - **Property 11: Cache prevents redundant API calls**
  - **Validates: Requirements 1.5**

- [x] 4. Create useDashboardMetrics custom hook

  - Create `frontend/src/hooks/useDashboardMetrics.ts`
  - Implement state management for metrics, loading, and error states
  - Implement data fetching with cache integration
  - Implement manual refresh function
  - Implement auto-refresh with 5-minute interval
  - Implement cleanup on unmount
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 9.2, 9.3, 9.4, 9.5_

- [ ]\* 4.1 Write unit tests for useDashboardMetrics hook

  - Test hook initializes with loading state
  - Test hook updates state on successful fetch
  - Test hook sets error state on failed fetch
  - Test manual refresh triggers new API call
  - Test cleanup stops auto-refresh on unmount
  - _Requirements: 1.2, 1.3, 1.4, 9.4_

- [x] 5. Create loading skeleton components

  - Create `frontend/src/components/StatCardSkeleton.tsx`
  - Implement skeleton loader matching StatCard layout
  - Use MUI Skeleton component
  - _Requirements: 7.1_

- [x] 6. Create error display component

  - Create `frontend/src/components/ErrorDisplay.tsx`
  - Implement error message display with retry button
  - Add error logging functionality
  - _Requirements: 8.1, 8.2, 8.4_

- [x] 7. Update DashboardPage component to use API data

  - Import and use `useDashboardMetrics` hook
  - Replace hardcoded data with API data
  - Implement loading state with skeleton loaders
  - Implement error state with error display and retry
  - Transform API metrics into StatCard props
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 3.1, 4.1, 5.1_

- [ ]\* 7.1 Write property test for loading state displays indicators

  - **Property 1: Loading state displays indicators**
  - **Validates: Requirements 1.2, 7.1, 7.2**

- [ ]\* 7.2 Write property test for successful data fetch updates UI

  - **Property 2: Successful data fetch updates UI**
  - **Validates: Requirements 1.4**

- [ ]\* 7.3 Write property test for API errors display error UI

  - **Property 3: API errors display error UI**
  - **Validates: Requirements 8.1, 8.4**

- [x] 8. Implement trend calculation and display

  - Add trend calculation logic to DashboardPage
  - Store previous month's metrics in localStorage
  - Calculate percentage changes for all metrics
  - Display trend indicators (arrows and colors) on StatCards
  - _Requirements: 2.2, 2.3, 2.4, 3.3, 3.4, 3.5, 5.3, 10.1, 10.2, 10.3, 10.4_

- [ ]\* 8.1 Write property test for trend indicators match data direction

  - **Property 5: Trend indicators match data direction**
  - **Validates: Requirements 2.3, 2.4, 3.4, 3.5, 10.2, 10.3, 10.4**

- [ ]\* 8.2 Write unit test for unavailable trend data

  - Test displays "N/A" when trend data is unavailable
  - _Requirements: 10.5_

- [x] 9. Implement number and currency formatting in StatCards

  - Apply `formatNumber()` to customer and inventory counts
  - Apply `formatCurrency()` to sales and revenue amounts
  - Ensure all StatCard values are properly formatted
  - _Requirements: 2.5, 3.2, 4.4, 5.2_

- [x] 10. Implement Recent Activities section with API data

  - Update Recent Activities to use `metrics.recent_activities` from API
  - Implement activity type to icon mapping
  - Format activity timestamps as relative time
  - Limit display to maximum 5 activities
  - Implement empty state when no activities exist
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ]\* 10.1 Write property test for activity list truncation

  - **Property 8: Recent activities limited to maximum**
  - **Validates: Requirements 6.2**

- [ ]\* 10.2 Write property test for activity display fields

  - **Property 9: Activity display includes required fields**
  - **Validates: Requirements 6.3**

- [ ]\* 10.3 Write property test for activity icon mapping

  - **Property 10: Activity type icon mapping**
  - **Validates: Requirements 6.4**

- [ ]\* 10.4 Write unit test for empty activities

  - Test displays empty state message when no activities exist
  - _Requirements: 6.5_

- [x] 11. Implement manual refresh button

  - Add refresh button to dashboard header
  - Connect button to `refresh()` function from hook
  - Add loading indicator during refresh
  - Implement debouncing (1 second) to prevent rapid clicks
  - _Requirements: 9.1, 9.2_

- [ ]\* 11.1 Write unit test for refresh button

  - Test refresh button triggers data refetch
  - Test debouncing prevents multiple rapid calls
  - _Requirements: 9.2_

- [x] 12. Implement low stock warning indicator

  - Add conditional warning badge to Inventory stat card
  - Display warning when `low_stock_items > 0`
  - Use warning color and icon
  - _Requirements: 4.3_

- [ ]\* 12.1 Write property test for low stock warnings

  - **Property 12: Low stock warnings display conditionally**
  - **Validates: Requirements 4.3**

- [x] 13. Add error logging and monitoring

  - Implement error logging function in API client
  - Log all API errors with context
  - Add console logging for development
  - Prepare integration points for error tracking service
  - _Requirements: 8.4_

- [x] 14. Checkpoint - Ensure all tests pass

  - Run all unit tests and property tests
  - Verify dashboard loads and displays data correctly
  - Test error scenarios manually
  - Ask the user if questions arise

- [ ]\* 15. Write integration tests

  - Test complete happy path: mount → fetch → display data
  - Test error recovery: mount → error → retry → success
  - Test navigation cleanup: mount → navigate away → verify cleanup
  - _Requirements: 1.1, 1.3, 8.3, 9.4_

- [x] 16. Final testing and polish

  - Test with real backend API
  - Verify all metrics display correctly
  - Test on different screen sizes
  - Verify loading states and transitions
  - Test error scenarios with network throttling
  - _Requirements: All_

- [x] 17. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise

## Notes

- Each task references specific requirements for traceability
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- Integration tests verify end-to-end flows
- The implementation uses TypeScript for type safety
- Fast-check library will be used for property-based testing
- React Testing Library will be used for component testing
- All tests are required for comprehensive validation
