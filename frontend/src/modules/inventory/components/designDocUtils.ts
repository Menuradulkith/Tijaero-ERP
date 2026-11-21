/** Helpers shared by the Design Brief and Design Detail tabs. */
import type { DesignBriefItemOption } from "../types";

export const UNCATEGORISED = "Uncategorised";
export const URL_RE = /^https?:\/\/\S+$/i;
export const MAX_TEXT = 2000;

/** The item part every brief / detail line has. */
export interface ItemLine {
  key: string;
  category_id: number | null;
  category_name: string;
  material_id: number | null;
  item_code: string;
  item_name: string;
}

export interface CategoryOption {
  id: number;
  name: string;
}

/** Categories with active items, plus any already used on the lines (an item may have gone inactive). */
export function buildCategories(options: DesignBriefItemOption[], lines: ItemLine[]): CategoryOption[] {
  const map = new Map<number, string>();
  for (const o of options) map.set(o.category_id, o.category_name || UNCATEGORISED);
  for (const l of lines) if (l.category_id != null && !map.has(l.category_id)) map.set(l.category_id, l.category_name);
  return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The category's items not used on another line (plus the line's own item, even if now inactive). */
export function itemOptionsFor(
  options: DesignBriefItemOption[],
  lines: ItemLine[],
  line: ItemLine,
): DesignBriefItemOption[] {
  const usedElsewhere = new Set(lines.filter((l) => l.key !== line.key).map((l) => l.material_id));
  const list = options.filter((o) => o.category_id === line.category_id && !usedElsewhere.has(o.id));
  if (line.material_id != null && !list.some((o) => o.id === line.material_id)) {
    list.unshift({
      id: line.material_id,
      item_code: line.item_code,
      name: line.item_name,
      category_id: line.category_id ?? 0,
      category_name: line.category_name,
      design_required: false,
    });
  }
  return list;
}

export const urlError = (v: string, required: boolean) =>
  !v.trim() ? (required ? "Required" : null) : !URL_RE.test(v.trim()) ? "Must start with http:// or https://" : null;
