import type { ColumnType } from "./center-api";
import { displayDate, formatDateTimeReadable } from "@/utils/formatters";

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
      return displayDate(String(value).slice(0, 10)) || String(value);
    case "datetime":
      return formatDateTimeReadable(String(value)) || String(value);
    default:
      return String(value);
  }
}
