/**
 * Utility functions for calculations
 */

export interface TrendCalculation {
  current: number;
  previous: number;
  percentageChange: number;
  isPositive: boolean;
}

/**
 * Calculate the percentage change between two values
 * @param current - The current value
 * @param previous - The previous value
 * @returns Trend calculation with percentage change and direction
 */
export function calculateTrend(
  current: number,
  previous: number
): TrendCalculation {
  // Handle case where previous value is zero
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

/**
 * Calculate percentage change as a simple number
 * @param current - The current value
 * @param previous - The previous value
 * @returns Percentage change (can be negative)
 */
export function calculatePercentageChange(
  current: number,
  previous: number
): number {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return ((current - previous) / previous) * 100;
}
