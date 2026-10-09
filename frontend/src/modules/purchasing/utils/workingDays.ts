/**
 * Working-day arithmetic for delivery estimates. Mirrors
 * backend/app/common/working_days.py: Monday-Friday are working days, and
 * there is no holiday calendar. Dates are "YYYY-MM-DD" strings handled in
 * local time so the result never shifts a day across timezones.
 */

const toIso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function todayIso(): string {
  return toIso(new Date());
}

/** `startIso` moved forward by `days` working days. */
export function addWorkingDays(startIso: string, days: number): string {
  const [y, m, d] = startIso.split("T")[0].split("-").map(Number);
  const current = new Date(y, m - 1, d);
  let remaining = Math.max(Math.floor(days), 0);
  while (remaining > 0) {
    current.setDate(current.getDate() + 1);
    const weekday = current.getDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return toIso(current);
}
