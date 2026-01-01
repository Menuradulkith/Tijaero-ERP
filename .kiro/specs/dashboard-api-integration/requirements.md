# Requirements Document

## Introduction

This specification defines the requirements for integrating the frontend Dashboard page with the backend reporting APIs. Currently, the dashboard displays hardcoded placeholder data. This feature will connect the dashboard to real-time data from the backend, displaying actual metrics for customers, sales, inventory, revenue, and recent activities.

## Glossary

- **Dashboard**: The main landing page that displays key business metrics and statistics
- **API_Client**: The frontend service responsible for making HTTP requests to the backend
- **Reporting_Service**: The backend service that provides aggregated business metrics
- **Stat_Card**: A UI component displaying a single metric with its value and trend
- **Recent_Activities**: A chronological list of recent system events and transactions
- **Dashboard_Metrics**: The aggregated data structure returned by the `/reporting/dashboard` endpoint

## Requirements

### Requirement 1: Fetch Dashboard Metrics

**User Story:** As a user, I want to see real-time business metrics on the dashboard, so that I can monitor the current state of the business.

#### Acceptance Criteria

1. WHEN the Dashboard page loads, THE System SHALL fetch metrics from the `/reporting/dashboard` endpoint
2. WHEN the API request is in progress, THE System SHALL display loading indicators on stat cards
3. IF the API request fails, THEN THE System SHALL display an error message and retry option
4. WHEN metrics are successfully fetched, THE System SHALL update all stat cards with real data
5. THE System SHALL cache dashboard metrics for 5 minutes to reduce API calls

### Requirement 2: Display Customer Metrics

**User Story:** As a business manager, I want to see the total number of active customers, so that I can track customer base growth.

#### Acceptance Criteria

1. WHEN dashboard metrics are loaded, THE System SHALL display the total customer count in the "Total Customers" stat card
2. THE System SHALL calculate the month-over-month percentage change for customer count
3. WHEN the customer count increases, THE System SHALL display a positive trend indicator
4. WHEN the customer count decreases, THE System SHALL display a negative trend indicator
5. THE System SHALL format the customer count as a comma-separated number

### Requirement 3: Display Sales Metrics

**User Story:** As a sales manager, I want to see current month sales figures, so that I can track sales performance against targets.

#### Acceptance Criteria

1. WHEN dashboard metrics are loaded, THE System SHALL display total sales for the current month in the "Sales This Month" stat card
2. THE System SHALL format sales amounts as currency with appropriate symbols
3. THE System SHALL calculate the month-over-month percentage change for sales
4. WHEN sales increase, THE System SHALL display a positive trend with green color
5. WHEN sales decrease, THE System SHALL display a negative trend with red color

### Requirement 4: Display Inventory Metrics

**User Story:** As an inventory manager, I want to see the total number of active products, so that I can monitor inventory levels.

#### Acceptance Criteria

1. WHEN dashboard metrics are loaded, THE System SHALL display the total product count in the "Inventory Items" stat card
2. THE System SHALL calculate the month-over-month percentage change for inventory
3. THE System SHALL display low stock warnings when applicable
4. THE System SHALL format the inventory count as a comma-separated number
5. WHEN inventory decreases significantly, THE System SHALL display a warning indicator

### Requirement 5: Display Revenue Metrics

**User Story:** As a financial manager, I want to see total revenue figures, so that I can assess financial performance.

#### Acceptance Criteria

1. WHEN dashboard metrics are loaded, THE System SHALL display total revenue in the "Revenue" stat card
2. THE System SHALL format revenue as currency with two decimal places
3. THE System SHALL calculate the month-over-month percentage change for revenue
4. THE System SHALL include all payment types in revenue calculation
5. WHEN revenue data is unavailable, THE System SHALL display a placeholder value

### Requirement 6: Display Recent Activities

**User Story:** As a user, I want to see recent system activities, so that I can stay informed about important events.

#### Acceptance Criteria

1. WHEN dashboard metrics are loaded, THE System SHALL display the most recent activities in the "Recent Activities" section
2. THE System SHALL display a maximum of 5 recent activities
3. WHEN displaying activities, THE System SHALL show the activity description and relative timestamp
4. THE System SHALL categorize activities by type with appropriate icons
5. WHEN no recent activities exist, THE System SHALL display an empty state message

### Requirement 7: Handle Loading States

**User Story:** As a user, I want to see loading indicators while data is being fetched, so that I know the system is working.

#### Acceptance Criteria

1. WHEN the dashboard is loading data, THE System SHALL display skeleton loaders on stat cards
2. WHEN the dashboard is loading data, THE System SHALL disable user interactions with loading components
3. THE System SHALL display loading indicators for a minimum of 200ms to prevent flashing
4. WHEN data loads successfully, THE System SHALL smoothly transition from loading to loaded state
5. THE System SHALL maintain layout stability during loading transitions

### Requirement 8: Handle Error States

**User Story:** As a user, I want to see clear error messages when data cannot be loaded, so that I understand what went wrong.

#### Acceptance Criteria

1. IF the API request fails, THEN THE System SHALL display an error message describing the issue
2. WHEN an error occurs, THE System SHALL provide a "Retry" button to attempt reloading
3. WHEN the retry button is clicked, THE System SHALL attempt to fetch data again
4. THE System SHALL log API errors for debugging purposes
5. WHEN network errors occur, THE System SHALL display a network-specific error message

### Requirement 9: Implement Data Refresh

**User Story:** As a user, I want the dashboard to refresh periodically, so that I always see current data.

#### Acceptance Criteria

1. THE System SHALL provide a manual refresh button on the dashboard
2. WHEN the refresh button is clicked, THE System SHALL fetch fresh data from the API
3. THE System SHALL automatically refresh dashboard data every 5 minutes
4. WHEN the user navigates away from the dashboard, THE System SHALL stop automatic refreshing
5. WHEN the user returns to the dashboard, THE System SHALL resume automatic refreshing

### Requirement 10: Calculate Trend Indicators

**User Story:** As a manager, I want to see trend indicators showing whether metrics are improving or declining, so that I can quickly assess performance.

#### Acceptance Criteria

1. WHEN displaying metrics, THE System SHALL calculate percentage change from the previous period
2. THE System SHALL display an upward arrow icon for positive trends
3. THE System SHALL display a downward arrow icon for negative trends
4. THE System SHALL use green color for positive trends and red color for negative trends
5. WHEN trend data is unavailable, THE System SHALL display "N/A" instead of a percentage
