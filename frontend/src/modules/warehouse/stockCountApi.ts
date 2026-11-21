/**
 * Stock count API (base /inventory/stock-counts).
 * A stock count snapshots the system quantity of every stock line in a branch
 * (optionally one location / item category); the user enters counted quantities,
 * then posting writes count adjustments to the stock ledger and a journal entry.
 */
import apiClient from "@/api/client";
import { format, parseISO } from "date-fns";

// ── Types ────────────────────────────────────────────────────────────────

export type StockCountStatus = "counting" | "posted" | "cancelled";

export const STOCK_COUNT_STATUS_OPTIONS: { value: StockCountStatus; label: string; color: "info" | "success" | "default" }[] = [
  { value: "counting", label: "Counting", color: "info" },
  { value: "posted", label: "Posted", color: "success" },
  { value: "cancelled", label: "Cancelled", color: "default" },
];

export const stockCountStatusOption = (s: string) =>
  STOCK_COUNT_STATUS_OPTIONS.find((o) => o.value === s) ?? { value: s as StockCountStatus, label: s, color: "default" as const };

export interface StockCountLine {
  id: number;
  stock_id: number | null;
  material_id: number;
  material_item_code: string | null;
  material_name: string | null;
  unit_of_measure: string | null;
  tracking_type: string | null;
  location_id: number | null;
  location_name: string | null;
  batch_no: string | null;
  barcode: string | null;
  expiry_date: string | null;
  system_quantity: number;
  /** null = not counted yet. */
  counted_quantity: number | null;
  difference: number | null;
  unit_cost: number;
  difference_value: number | null;
  /** Added during the count (not in the system snapshot); only these can be deleted. */
  is_found: boolean;
  remark: string | null;
}

export interface StockCount {
  id: number;
  count_no: string;
  branch_code: string;
  branch_name: string | null;
  location_id: number | null;
  location_name: string | null;
  category_id: number | null;
  category_name: string | null;
  status: StockCountStatus;
  remark: string | null;
  created_by_name: string | null;
  created_at: string | null;
  posted_by_name: string | null;
  posted_at: string | null;
  cancel_reason: string | null;
  journal_entry_id: number | null;
  journal_entry_no: string | null;
  line_count: number;
  counted_count: number;
  difference_count: number;
  gain_value: number;
  loss_value: number;
  net_value: number;
  /** Only on the single-count responses. */
  lines?: StockCountLine[];
}

export interface StockCountListParams {
  branch_code?: string;
  status?: string;
  search?: string;
  skip?: number;
  limit?: number;
}

export interface StockCountCreate {
  branch_code: string;
  location_id?: number | null;
  category_id?: number | null;
  remark?: string | null;
}

export interface StockCountLineUpdate {
  id: number;
  counted_quantity: number | null;
  remark?: string | null;
}

export interface StockCountFoundLineCreate {
  material_id: number;
  location_id: number;
  counted_quantity: number;
  batch_no?: string | null;
  barcode?: string | null;
  expiry_date?: string | null;
  unit_cost?: number | null;
}

// ── Normalisation (Decimal fields may arrive as strings) ─────────────────

type Raw<T> = { [K in keyof T]: unknown };

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function normalizeLine(raw: Raw<StockCountLine>): StockCountLine {
  const l = raw as unknown as StockCountLine;
  return {
    ...l,
    system_quantity: num(raw.system_quantity),
    counted_quantity: numOrNull(raw.counted_quantity),
    difference: numOrNull(raw.difference),
    unit_cost: num(raw.unit_cost),
    difference_value: numOrNull(raw.difference_value),
    is_found: !!raw.is_found,
  };
}

export function normalizeStockCount(raw: Raw<StockCount>): StockCount {
  const c = raw as unknown as StockCount;
  return {
    ...c,
    line_count: num(raw.line_count),
    counted_count: num(raw.counted_count),
    difference_count: num(raw.difference_count),
    gain_value: num(raw.gain_value),
    loss_value: num(raw.loss_value),
    net_value: num(raw.net_value),
    lines: Array.isArray(raw.lines) ? (raw.lines as Raw<StockCountLine>[]).map(normalizeLine) : undefined,
  };
}

// ── API ──────────────────────────────────────────────────────────────────

const BASE = "/inventory/stock-counts";

/** Drop empty values so the backend sees only the filters that are set. */
function clean<T extends object>(params: T): Partial<T> {
  const out: Partial<T> = {};
  (Object.keys(params) as (keyof T)[]).forEach((k) => {
    const v = params[k];
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  });
  return out;
}

/** Let the page show the backend message inline instead of the global toast. */
const QUIET = { headers: { "X-Hide-Error-Toast": "true" } };

export const stockCountApi = {
  list: async (params: StockCountListParams) => {
    const res = await apiClient.get<{ items: Raw<StockCount>[]; total: number }>(`${BASE}/`, { params: clean(params) });
    return { items: (res.data.items || []).map(normalizeStockCount), total: num(res.data.total) };
  },

  get: async (id: number) => normalizeStockCount((await apiClient.get<Raw<StockCount>>(`${BASE}/${id}`)).data),

  /** 409 = an open count overlaps; 422 = nothing to count. Errors are not toasted (shown in the dialog). */
  create: async (data: StockCountCreate) =>
    normalizeStockCount((await apiClient.post<Raw<StockCount>>(`${BASE}/`, clean(data), QUIET)).data),

  updateLines: async (id: number, lines: StockCountLineUpdate[]) =>
    normalizeStockCount((await apiClient.put<Raw<StockCount>>(`${BASE}/${id}/lines`, { lines })).data),

  /** Errors are not toasted (shown in the dialog). */
  addFoundLine: async (id: number, data: StockCountFoundLineCreate) =>
    normalizeStockCount((await apiClient.post<Raw<StockCount>>(`${BASE}/${id}/lines`, clean(data), QUIET)).data),

  deleteLine: async (id: number, lineId: number) =>
    normalizeStockCount((await apiClient.delete<Raw<StockCount>>(`${BASE}/${id}/lines/${lineId}`)).data),

  post: async (id: number) => normalizeStockCount((await apiClient.post<Raw<StockCount>>(`${BASE}/${id}/post`)).data),

  /** Errors are not toasted (shown in the dialog). */
  cancel: async (id: number, reason: string) =>
    normalizeStockCount((await apiClient.post<Raw<StockCount>>(`${BASE}/${id}/cancel`, { reason }, QUIET)).data),

  /** Download the count sheet as CSV (authenticated client, then saves the blob). */
  exportCsv: async (id: number, fallbackName = "stock_count.csv") => {
    const res = await apiClient.get<Blob>(`${BASE}/${id}/export-csv`, { responseType: "blob" });
    const disposition = String(res.headers["content-disposition"] || "");
    const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] || fallbackName;
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  },
};

// ── Formatting ───────────────────────────────────────────────────────────

export const fmtDateTime = (v: string | null | undefined) => {
  if (!v) return "-";
  try {
    return format(parseISO(v), "dd MMM yyyy HH:mm");
  } catch {
    return v;
  }
};

export const fmtDate = (v: string | null | undefined) => {
  if (!v) return "-";
  try {
    return format(parseISO(v), "dd MMM yyyy");
  } catch {
    return v;
  }
};

/** Quantity with up to 3 decimals. */
export const fmtQty = (v: number | null | undefined) =>
  v === null || v === undefined ? "-" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 3 });
