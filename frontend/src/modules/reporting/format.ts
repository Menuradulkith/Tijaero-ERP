import type { ColumnType } from "./center-api";

export const NUMERIC_COLUMN_TYPES: ColumnType[] = ["int", "number", "money", "percent"];

/** Display text for one Report Center cell or metric. */
export function formatValue(value: unknown, type: ColumnType): string {
  if (value === null || value === undefined || value === "") return "";
  switch (type) {
    case "money":
    case "number":
      return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "int":
      return Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 });
    case "percent":
      return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
    case "bool":
      return value ? "Yes" : "No";
    case "date":
      return String(value).slice(0, 10);
    case "datetime":
      return String(value).replace("T", " ").slice(0, 16);
    default:
      return String(value);
  }
}
