/**
 * API client for reporting endpoints
 */
import apiClient from "./client";

/**
 * Recent activity item
 */
export interface RecentActivity {
  title: string;
  time: string;
  type: "sale" | "customer" | "inventory" | "payment";
}

/**
 * Dashboard metrics response from the API
 */
export interface DashboardMetrics {
  // Core KPI
  total_sales_today: number;
  total_sales_month: number;
  total_sales_last_month: number;
  total_orders_today: number;
  total_orders_month: number;
  total_orders_last_month: number;
  total_customers: number;
  new_customers_month: number;
  total_products: number;
  low_stock_items: number;

  // Purchasing
  total_purchases_month: number;
  pending_po_count: number;

  // Receivables / payables
  total_credit_outstanding: number;
  total_supplier_credit: number;

  // Pending approvals breakdown
  pending_approvals: number;
  pending_sales_approvals: number;
  pending_purchase_approvals: number;
  pending_return_approvals: number;
  pending_expense_approvals: number;
  pending_transfer_approvals: number;

  // Support
  open_support_tickets: number;

  // Daily sales trend (last 7 days)
  daily_sales: Array<{ date: string; sales: number; orders: number }>;

  // Top 5 selling products this month
  top_products: Array<{ name: string; item_code: string; quantity: number; revenue: number }>;

  // Recent activities
  recent_activities: RecentActivity[];
}

/**
 * Custom error class for dashboard API errors
 */
export class DashboardError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = "DashboardError";
  }
}

/**
 * Log error with context for debugging
 */
function logError(error: Error, context: string): void {
  console.error(`[Dashboard API] ${context}:`, {
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  });

  // Integration point for error tracking service
  if (typeof window !== "undefined" && (window as any).errorTracker) {
    (window as any).errorTracker.captureException(error, { context });
  }
}

/**
 * Fetch dashboard metrics from the API
 * @returns Promise resolving to dashboard metrics
 * @throws DashboardError on API failure
 */
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  try {
    const response = await apiClient.get<DashboardMetrics>(
      "/reporting/dashboard"
    );
    return response.data;
  } catch (error: any) {
    const context = "getDashboardMetrics";

    // Handle different error types
    if (error.response) {
      // Server responded with error status
      const statusCode = error.response.status;
      const message = error.response.data?.message || error.message;

      logError(error, context);

      if (statusCode === 401) {
        throw new DashboardError(
          "Authentication required. Please log in.",
          "AUTH_ERROR",
          401
        );
      } else if (statusCode === 403) {
        throw new DashboardError(
          "You do not have permission to view dashboard metrics.",
          "PERMISSION_ERROR",
          403
        );
      } else if (statusCode >= 500) {
        throw new DashboardError(
          "Server error occurred. Please try again later.",
          "SERVER_ERROR",
          statusCode
        );
      } else {
        throw new DashboardError(
          message || "Failed to fetch dashboard metrics.",
          "API_ERROR",
          statusCode
        );
      }
    } else if (error.request) {
      // Request was made but no response received
      logError(error, context);
      throw new DashboardError(
        "Unable to connect to server. Please check your internet connection.",
        "NETWORK_ERROR"
      );
    } else {
      // Something else happened
      logError(error, context);
      throw new DashboardError(
        error.message || "An unexpected error occurred.",
        "UNKNOWN_ERROR"
      );
    }
  }
}

/**
 * Get quick statistics for a specific time period
 * @param period - Time period ('today', 'week', 'month', 'year')
 * @returns Promise resolving to quick stats
 */
export async function getQuickStats(
  period: "today" | "week" | "month" | "year" = "today"
): Promise<any> {
  try {
    const response = await apiClient.get("/reporting/quick-stats", {
      params: { period },
    });
    return response.data;
  } catch (error: any) {
    logError(error, "getQuickStats");
    throw error;
  }
}

export const reportingApi = {
  getDashboardMetrics,
  getQuickStats,
};
