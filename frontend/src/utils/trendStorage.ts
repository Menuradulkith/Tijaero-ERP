/**
 * Utility for storing and retrieving previous month's metrics for trend calculation
 */

interface PreviousMetrics {
  total_customers: number;
  total_sales_month: number;
  total_products: number;
  month: string; // Format: YYYY-MM
  timestamp: number;
}

const STORAGE_KEY = "dashboard_previous_metrics";

/**
 * Get the current month in YYYY-MM format
 */
function getCurrentMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Store current metrics as previous metrics for next month's comparison
 */
export function storePreviousMetrics(metrics: {
  total_customers: number;
  total_sales_month: number;
  total_products: number;
}): void {
  const data: PreviousMetrics = {
    ...metrics,
    month: getCurrentMonth(),
    timestamp: Date.now(),
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error("Failed to store previous metrics:", error);
  }
}

/**
 * Get previous month's metrics for trend calculation
 * Returns null if no data or data is from current month
 */
export function getPreviousMetrics(): PreviousMetrics | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return null;
    }

    const data: PreviousMetrics = JSON.parse(stored);
    const currentMonth = getCurrentMonth();

    // Only return data if it's from a previous month
    if (data.month === currentMonth) {
      return null;
    }

    return data;
  } catch (error) {
    console.error("Failed to retrieve previous metrics:", error);
    return null;
  }
}

/**
 * Check if we should update stored metrics (at month boundary)
 */
export function shouldUpdateStoredMetrics(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return true;
    }

    const data: PreviousMetrics = JSON.parse(stored);
    const currentMonth = getCurrentMonth();

    // Update if we're in a new month
    return data.month !== currentMonth;
  } catch (error) {
    return true;
  }
}
