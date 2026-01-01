# Design Document: Dashboard API Integration

## Overview

This design describes the integration of the frontend Dashboard page with the backend reporting APIs. The implementation will replace hardcoded placeholder data with real-time metrics fetched from the `/reporting/dashboard` endpoint. The solution uses React hooks for state management, implements proper loading and error states, and provides automatic data refresh capabilities.

## Architecture

### High-Level Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│  Dashboard      │────────>│  API Client      │────────>│  Backend API    │
│  Component      │         │  (Axios)         │         │  /reporting/    │
│                 │<────────│                  │<────────│  dashboard      │
└─────────────────┘         └──────────────────┘         └─────────────────┘
       │
       │ uses
       ▼
┌─────────────────┐
│  useDashboard   │
│  Hook           │
│  (State Mgmt)   │
└─────────────────┘
```

### Component Structure

- **DashboardPage**: Main container component that orchestrates data fetching and rendering
- **useDashboardMetrics**: Custom React hook for fetching and managing dashboard data
- **StatCard**: Reusable component for displaying individual metrics (already exists)
- **API Client**: Axios-based service for making HTTP requests to the backend

### Data Flow

1. DashboardPage mounts and calls useDashboardMetrics hook
2. Hook initiates API request to `/reporting/dashboard`
3. Loading state is set, skeleton loaders are displayed
4. API response is received and parsed
5. Metrics are stored in component state
6. StatCards are updated with real data
7. Automatic refresh timer is started (5-minute interval)

## Components and Interfaces

### API Client Interface

```typescript
// frontend/src/api/reporting.ts
interface DashboardMetrics {
  total_sales_today: number;
  total_sales_month: number;
  total_orders_today: number;
  total_orders_month: number;
  total_customers: number;
  total_products: number;
  low_stock_items: number;
  pending_approvals: number;
  open_support_tickets: number;
  recent_activities: RecentActivity[];
}

interface RecentActivity {
  title: string;
  time: string;
  type: "sale" | "customer" | "inventory" | "payment";
}

interface TrendData {
  current: number;
  previous: number;
  percentageChange: number;
}

async function getDashboardMetrics(): Promise<DashboardMetrics>;
```

### Custom Hook Interface

```typescript
// frontend/src/hooks/useDashboardMetrics.ts
interface UseDashboardMetricsResult {
  metrics: DashboardMetrics | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  lastUpdated: Date | null;
}

function useDashboardMetrics(options?: {
  autoRefresh?: boolean;
  refreshInterval?: number;
}): UseDashboardMetricsResult;
```

### Dashboard Component Interface

```typescript
// frontend/src/app/pages/DashboardPage.tsx
interface StatCardData {
  title: string;
  value: string;
  change: number;
  icon: React.ReactNode;
  color: string;
  loading?: boolean;
}

function DashboardPage(): JSX.Element;
```

## Data Models

### DashboardMetrics Model

```typescript
interface DashboardMetrics {
  // Sales metrics
  total_sales_today: number;
  total_sales_month: number;
  total_orders_today: number;
  total_orders_month: number;

  // Customer metrics
  total_customers: number;

  // Inventory metrics
  total_products: number;
  low_stock_items: number;

  // Operational metrics
  pending_approvals: number;
  open_support_tickets: number;

  // Activity feed
  recent_activities: RecentActivity[];
}
```

### Trend Calculation Model

```typescript
interface TrendCalculation {
  current: number;
  previous: number;
  percentageChange: number;
  isPositive: boolean;
}

function calculateTrend(current: number, previous: number): TrendCalculation {
  if (previous === 0) {
    return {
      current,
      previous,
      percentageChange: current > 0 ? 100 : 0,
      isPositive: current >= 0,
    };
  }

  const change = ((current - previous) / previous) * 100;
  return {
    current,
    previous,
    percentageChange: Math.abs(change),
    isPositive: change >= 0,
  };
}
```

### Error Handling Model

```typescript
interface APIError {
  message: string;
  code?: string;
  statusCode?: number;
}

class DashboardError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = "DashboardError";
  }
}
```

## Implementation Details

### API Client Implementation

The API client will use the existing Axios instance configured in `frontend/src/api/client.ts`. A new module `frontend/src/api/reporting.ts` will be created to handle reporting-specific endpoints.

```typescript
import { apiClient } from "./client";

export const reportingApi = {
  getDashboardMetrics: async (): Promise<DashboardMetrics> => {
    const response = await apiClient.get("/reporting/dashboard");
    return response.data;
  },

  getQuickStats: async (period: "today" | "week" | "month" | "year") => {
    const response = await apiClient.get("/reporting/quick-stats", {
      params: { period },
    });
    return response.data;
  },
};
```

### Custom Hook Implementation

The `useDashboardMetrics` hook will manage:

- Data fetching with loading and error states
- Automatic refresh with configurable interval
- Manual refresh capability
- Cleanup on component unmount

```typescript
function useDashboardMetrics(options = {}) {
  const { autoRefresh = true, refreshInterval = 300000 } = options; // 5 minutes default

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchMetrics = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await reportingApi.getDashboardMetrics();
      setMetrics(data);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();

    if (autoRefresh) {
      const interval = setInterval(fetchMetrics, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, refreshInterval]);

  return { metrics, loading, error, refresh: fetchMetrics, lastUpdated };
}
```

### Dashboard Component Updates

The DashboardPage component will be updated to:

1. Use the `useDashboardMetrics` hook
2. Transform API data into StatCard props
3. Display loading skeletons during data fetch
4. Show error messages with retry option
5. Format numbers and currency appropriately

### Trend Calculation Logic

Since the backend currently doesn't provide historical comparison data, we'll implement a client-side solution:

**Option 1: Store previous month's data in localStorage**

- Cache last month's metrics when month changes
- Compare current metrics with cached values
- Fallback to showing 0% change if no historical data

**Option 2: Request comparison data from backend**

- Modify backend to include previous period metrics
- Calculate trends on the server side
- More accurate but requires backend changes

For this implementation, we'll use Option 1 as it doesn't require backend modifications.

### Loading State Implementation

```typescript
// Skeleton loader for StatCard
function StatCardSkeleton() {
  return (
    <Card>
      <CardContent>
        <Skeleton variant="text" width="60%" />
        <Skeleton variant="text" width="40%" height={40} />
        <Skeleton variant="text" width="50%" />
      </CardContent>
    </Card>
  );
}
```

### Error State Implementation

```typescript
function ErrorDisplay({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  return (
    <Alert
      severity="error"
      action={
        <Button color="inherit" size="small" onClick={onRetry}>
          Retry
        </Button>
      }
    >
      Failed to load dashboard metrics: {error.message}
    </Alert>
  );
}
```

## Correctness Properties

_A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees._

### Property 1: Loading state displays indicators

_For any_ dashboard component in loading state, all stat cards should display skeleton loaders and interactive elements should be disabled.

**Validates: Requirements 1.2, 7.1, 7.2**

### Property 2: Successful data fetch updates UI

_For any_ successful API response containing dashboard metrics, all stat cards should be updated with the corresponding data from the response.

**Validates: Requirements 1.4**

### Property 3: API errors display error UI

_For any_ API request failure, the system should display an error message and log the error for debugging.

**Validates: Requirements 8.1, 8.4**

### Property 4: Percentage change calculation

_For any_ pair of current and previous numeric values, the percentage change calculation should return `((current - previous) / previous) * 100`, with special handling when previous is zero.

**Validates: Requirements 2.2, 3.3, 5.3, 10.1**

### Property 5: Trend indicators match data direction

_For any_ metric with trend data, when the current value is greater than the previous value, the system should display an upward arrow with green color, and when the current value is less than the previous value, the system should display a downward arrow with red color.

**Validates: Requirements 2.3, 2.4, 3.4, 3.5, 10.2, 10.3, 10.4**

### Property 6: Number formatting with commas

_For any_ integer value displayed in stat cards, the system should format it with comma separators (e.g., 1234 becomes "1,234").

**Validates: Requirements 2.5, 4.4**

### Property 7: Currency formatting

_For any_ monetary value displayed in stat cards, the system should format it as currency with a dollar sign and two decimal places (e.g., 12345.6 becomes "$12,345.60").

**Validates: Requirements 3.2, 5.2**

### Property 8: Recent activities limited to maximum

_For any_ list of recent activities returned by the API, the system should display at most 5 activities in the Recent Activities section.

**Validates: Requirements 6.2**

### Property 9: Activity display includes required fields

_For any_ activity displayed in the Recent Activities section, the rendered output should contain both the activity description and a relative timestamp.

**Validates: Requirements 6.3**

### Property 10: Activity type icon mapping

_For any_ activity with a valid type ('sale', 'customer', 'inventory', 'payment'), the system should display the corresponding icon for that type.

**Validates: Requirements 6.4**

### Property 11: Cache prevents redundant API calls

_For any_ sequence of dashboard metric requests within a 5-minute window, only the first request should trigger an actual API call, with subsequent requests returning cached data.

**Validates: Requirements 1.5**

### Property 12: Low stock warnings display conditionally

_For any_ dashboard metrics where `low_stock_items` is greater than zero, the system should display a warning indicator on the inventory stat card.

**Validates: Requirements 4.3**

## Error Handling

### API Error Handling

1. **Network Errors**: Display user-friendly message "Unable to connect to server. Please check your internet connection."
2. **Server Errors (5xx)**: Display "Server error occurred. Please try again later."
3. **Authentication Errors (401)**: Redirect to login page
4. **Timeout Errors**: Display "Request timed out. Please try again."
5. **Unknown Errors**: Display generic error message with error code

### Error Recovery

- All errors provide a "Retry" button
- Retry attempts use exponential backoff (1s, 2s, 4s)
- Maximum of 3 automatic retry attempts
- Manual retry always available via button

### Error Logging

```typescript
function logError(error: Error, context: string) {
  console.error(`[Dashboard] ${context}:`, {
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  });

  // Send to error tracking service if available
  if (window.errorTracker) {
    window.errorTracker.captureException(error, { context });
  }
}
```

### Graceful Degradation

- If API fails, show last cached data with warning banner
- If no cached data, show empty state with retry option
- Individual stat cards can fail independently
- Recent activities section can be hidden if data unavailable

## Testing Strategy

### Unit Tests

Unit tests will verify specific examples and edge cases:

1. **API Client Tests**

   - Test successful API call returns correct data structure
   - Test API call with network error throws appropriate error
   - Test API call with 401 status throws authentication error
   - Test API call with 500 status throws server error

2. **Hook Tests**

   - Test hook initializes with loading state
   - Test hook updates state on successful fetch
   - Test hook sets error state on failed fetch
   - Test manual refresh triggers new API call
   - Test cleanup stops auto-refresh on unmount

3. **Component Tests**

   - Test dashboard renders loading skeletons initially
   - Test dashboard renders stat cards with data
   - Test dashboard renders error message on failure
   - Test retry button triggers data refetch
   - Test refresh button triggers manual refresh

4. **Utility Function Tests**

   - Test formatCurrency with various amounts
   - Test formatNumber with various integers
   - Test calculateTrend with positive change
   - Test calculateTrend with negative change
   - Test calculateTrend with zero previous value
   - Test formatRelativeTime with various timestamps

5. **Edge Case Tests**
   - Test with empty recent activities array (displays empty state)
   - Test with null/undefined metric values (displays placeholder)
   - Test with very large numbers (formats correctly)
   - Test with negative revenue (displays correctly)
   - Test with unavailable trend data (displays "N/A")

### Property-Based Tests

Property-based tests will verify universal properties across all inputs using a property-based testing library (fast-check for TypeScript). Each test will run a minimum of 100 iterations.

1. **Property Test: Percentage Change Calculation**

   - **Feature: dashboard-api-integration, Property 4: Percentage change calculation**
   - Generate random pairs of current/previous values
   - Verify formula: `((current - previous) / previous) * 100`
   - Verify special case: when previous is 0, return 100 if current > 0, else 0

2. **Property Test: Trend Indicator Logic**

   - **Feature: dashboard-api-integration, Property 5: Trend indicators match data direction**
   - Generate random pairs of current/previous values
   - Verify: current > previous → upward arrow + green color
   - Verify: current < previous → downward arrow + red color
   - Verify: current === previous → no change indicator

3. **Property Test: Number Formatting**

   - **Feature: dashboard-api-integration, Property 6: Number formatting with commas**
   - Generate random integers (0 to 1,000,000,000)
   - Verify output matches regex: `/^\d{1,3}(,\d{3})*$/`
   - Verify parsing formatted string returns original number

4. **Property Test: Currency Formatting**

   - **Feature: dashboard-api-integration, Property 7: Currency formatting**
   - Generate random monetary values (-1,000,000 to 1,000,000)
   - Verify output matches regex: `/^\$-?\d{1,3}(,\d{3})*\.\d{2}$/`
   - Verify output has exactly 2 decimal places

5. **Property Test: Activity List Truncation**

   - **Feature: dashboard-api-integration, Property 8: Recent activities limited to maximum**
   - Generate random arrays of activities (length 0 to 100)
   - Verify displayed activities length ≤ 5
   - Verify displayed activities are the first 5 from input array

6. **Property Test: Activity Display Fields**

   - **Feature: dashboard-api-integration, Property 9: Activity display includes required fields**
   - Generate random activities with title and time
   - Verify rendered output contains activity.title
   - Verify rendered output contains activity.time

7. **Property Test: Activity Icon Mapping**

   - **Feature: dashboard-api-integration, Property 10: Activity type icon mapping**
   - Generate random activities with valid types
   - Verify each type maps to correct icon component
   - Verify icon is present in rendered output

8. **Property Test: Cache Behavior**
   - **Feature: dashboard-api-integration, Property 11: Cache prevents redundant API calls**
   - Generate random sequences of requests with timestamps
   - Verify requests within 5-minute window use cache
   - Verify requests after 5 minutes trigger new API call

### Integration Tests

Integration tests will verify the complete flow from component mount to data display:

1. Test complete happy path: mount → fetch → display data
2. Test error recovery: mount → error → retry → success
3. Test auto-refresh: mount → wait 5 minutes → verify new fetch
4. Test navigation cleanup: mount → navigate away → verify cleanup

### Test Configuration

- Use Jest as the test runner
- Use React Testing Library for component tests
- Use fast-check for property-based tests
- Use MSW (Mock Service Worker) for API mocking
- Configure property tests to run 100 iterations minimum
- Use data-testid attributes for reliable element selection

## Performance Considerations

### Caching Strategy

- Cache dashboard metrics in memory for 5 minutes
- Use localStorage as fallback for page refreshes
- Implement cache invalidation on manual refresh
- Clear cache on user logout

### Optimization Techniques

1. **Memoization**: Use React.memo for StatCard components
2. **Debouncing**: Debounce manual refresh button (1 second)
3. **Lazy Loading**: Load dashboard data only when route is active
4. **Request Cancellation**: Cancel pending requests on unmount

### Bundle Size

- Import only required MUI components
- Use tree-shaking for utility functions
- Lazy load chart libraries if added later

## Security Considerations

### API Security

- All API requests include authentication token
- Implement CSRF protection
- Validate API response structure before using
- Sanitize any user-generated content in activities

### Data Privacy

- Don't log sensitive financial data
- Mask customer information in error logs
- Implement proper access control checks

## Deployment Considerations

### Environment Configuration

- API base URL configurable via environment variable
- Cache duration configurable via environment variable
- Auto-refresh interval configurable via environment variable

### Monitoring

- Track API response times
- Monitor error rates
- Alert on high failure rates
- Track cache hit/miss ratios

### Rollback Plan

- Feature flag for dashboard API integration
- Ability to revert to hardcoded data if needed
- Gradual rollout to user segments
