/**
 * Central warehouse stock API (base /inventory/warehouse-stock).
 * Dashboard KPIs, items on hand by branch / location, and the stock movement ledger.
 */
import apiClient from "@/api/client";

// ── Types ────────────────────────────────────────────────────────────────

export type StockBucket =
  | "reserved"
  | "in_transit"
  | "damaged"
  | "frozen"
  | "expiring"
  | "expired"
  | "low_stock";

export const STOCK_BUCKET_OPTIONS: { value: StockBucket; label: string }[] = [
  { value: "reserved", label: "Reserved" },
  { value: "in_transit", label: "In Transit" },
  { value: "damaged", label: "Damaged" },
  { value: "frozen", label: "Frozen / QC hold" },
  { value: "expiring", label: "Expiring ≤30 days" },
  { value: "expired", label: "Expired" },
  { value: "low_stock", label: "Low stock" },
];

export type OnHandSortField =
  | "item_name"
  | "item_code"
  | "on_hand"
  | "available"
  | "value"
  | "ageing_days"
  | "nearest_expiry"
  | "branch_code";

/** One row per Item Catalog item + branch + location (item_code / name / category / brand are the item's). */
export interface OnHandRow {
  /** A product linked to the item (may be null). */
  product_id: number | null;
  /** The Item Catalog item (the stock key). */
  material_id: number | null;
  item_code: string | null;
  item_name: string | null;
  category_name: string | null;
  brand_name: string | null;
  unit_of_measure: string | null;
  tracking_type: string | null;
  branch_code: string;
  location_id: number | null;
  location_name: string | null;
  on_hand: number;
  reserved: number;
  available: number;
  in_transit: number;
  damaged: number;
  frozen: number;
  value: number | null;
  avg_unit_cost: number | null;
  oldest_received: string | null;
  ageing_days: number | null;
  nearest_expiry: string | null;
}

export interface OnHandParams {
  page?: number;
  size?: number;
  q?: string;
  branch_code?: string;
  location_id?: number;
  category_id?: number;
  brand_id?: number;
  bucket?: StockBucket;
  sort_by?: OnHandSortField;
  order?: "asc" | "desc";
}

export interface StockMovement {
  id: number;
  created_at: string;
  movement_type: string;
  item_code: string | null;
  item_name: string | null;
  /** The Item Catalog item moved (the stock key). */
  material_id: number | null;
  /** A product linked to the item (may be null). */
  product_id: number | null;
  quantity: number;
  on_hand_change: number;
  from_status: string | null;
  to_status: string | null;
  branch_code: string | null;
  from_location_name: string | null;
  to_location_name: string | null;
  batch_no: string | null;
  barcode: string | null;
  unit_cost: number | null;
  value: number | null;
  reference_type: string | null;
  reference_id: number | null;
  reference_no: string | null;
  user_name: string | null;
}

export interface MovementParams {
  page?: number;
  size?: number;
  product_id?: number;
  material_id?: number;
  stock_id?: number;
  branch_code?: string;
  location_id?: number;
  movement_type?: string;
  reference_type?: string;
  reference_id?: number;
  date_from?: string;
  date_to?: string;
  q?: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

// ── Movement type labels / direction ─────────────────────────────────────

export type MovementDirection = "in" | "out" | "internal";

export const MOVEMENT_TYPES: { value: string; label: string; direction: MovementDirection }[] = [
  { value: "opening_balance", label: "Opening Balance", direction: "in" },
  { value: "receipt", label: "Receipt", direction: "in" },
  { value: "manual_create", label: "Manual Entry", direction: "in" },
  { value: "production_output", label: "Production Output", direction: "in" },
  { value: "by_product", label: "By-product", direction: "in" },
  { value: "sale", label: "Sale", direction: "out" },
  { value: "sale_reversal", label: "Sale Reversal", direction: "in" },
  { value: "sale_return", label: "Sale Return", direction: "in" },
  { value: "reserve", label: "Reserve", direction: "internal" },
  { value: "unreserve", label: "Unreserve", direction: "internal" },
  { value: "issue_to_production", label: "Issue to Production", direction: "out" },
  { value: "return_from_production", label: "Return from Production", direction: "in" },
  { value: "purchase_return", label: "Purchase Return", direction: "out" },
  { value: "purchase_return_reversed", label: "Purchase Return Reversed", direction: "in" },
  { value: "transfer_pending", label: "Transfer Pending", direction: "internal" },
  { value: "transfer_cancelled", label: "Transfer Cancelled", direction: "internal" },
  { value: "transfer_out", label: "Transfer Out", direction: "out" },
  { value: "transfer_in", label: "Transfer In", direction: "in" },
  { value: "damage", label: "Damaged", direction: "internal" },
  { value: "undamage", label: "Damage Cleared", direction: "internal" },
  { value: "freeze", label: "Frozen / QC Hold", direction: "internal" },
  { value: "unfreeze", label: "Released from Hold", direction: "internal" },
  { value: "reclass_to_asset", label: "Moved to Company Assets", direction: "out" },
  { value: "reclass_from_asset", label: "Returned from Company Assets", direction: "in" },
  { value: "receipt_cancelled", label: "Receipt Cancelled", direction: "out" },
  { value: "location_change", label: "Location Change", direction: "internal" },
  { value: "quantity_adjustment", label: "Quantity Adjustment", direction: "internal" },
  { value: "count_adjustment", label: "Count adjustment", direction: "internal" },
  { value: "status_change", label: "Status Change", direction: "internal" },
];

const MOVEMENT_TYPE_MAP = new Map(MOVEMENT_TYPES.map((m) => [m.value, m]));

const humanize = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function movementTypeLabel(type: string): string {
  return MOVEMENT_TYPE_MAP.get(type)?.label ?? humanize(type);
}

/** Direction of a movement: from the known type, else from the on-hand change sign. */
export function movementDirection(type: string, onHandChange?: number | null): MovementDirection {
  // A count adjustment can be a gain or a loss: colour it by the on-hand change.
  if (type === "count_adjustment" && onHandChange) return onHandChange > 0 ? "in" : "out";
  const known = MOVEMENT_TYPE_MAP.get(type)?.direction;
  if (known) return known;
  if (onHandChange && onHandChange > 0) return "in";
  if (onHandChange && onHandChange < 0) return "out";
  return "internal";
}

// ── Source document labels / links ───────────────────────────────────────

/** Normalise a reference_type ("SalesOrder", "sales_order", "Invoice"...) to a key. */
const refKey = (t: string) => t.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase().replace(/[\s-]+/g, "_");

const REFERENCE_LABELS: Record<string, string> = {
  sales_order: "Sales Order",
  invoice: "Sales Order",
  sale: "Sales Order",
  sale_return: "Sale Return",
  sales_return: "Sale Return",
  purchase_order: "Purchase Order",
  po: "Purchase Order",
  grn: "GRN",
  good_received_note: "GRN",
  goods_received_note: "GRN",
  purchase_return: "Purchase Return",
  itn: "Item Transfer Note",
  item_transfer_note: "Item Transfer Note",
  production_order: "Production Order",
  work_order: "Production Order",
  company_asset: "Company Asset",
  stock_count: "Stock count",
};

export const REFERENCE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "sales_order", label: "Sales Order" },
  { value: "sale_return", label: "Sale Return" },
  { value: "purchase_order", label: "Purchase Order" },
  { value: "grn", label: "GRN" },
  { value: "purchase_return", label: "Purchase Return" },
  { value: "item_transfer_note", label: "Item Transfer Note" },
  { value: "production_order", label: "Production Order" },
  { value: "company_asset", label: "Company Asset" },
  { value: "stock_count", label: "Stock count" },
];

export function referenceTypeLabel(type: string | null | undefined): string {
  if (!type) return "";
  return REFERENCE_LABELS[refKey(type)] ?? humanize(type);
}

/** Link to the source document, only where the target page can open a document by id. */
export function referenceLink(type: string | null | undefined, id: number | null | undefined): string | null {
  if (!type || !id) return null;
  switch (refKey(type)) {
    case "sales_order":
    case "invoice":
    case "sale":
      return `/sales/orders?focus=${id}`;
    case "purchase_order":
    case "po":
      return `/purchasing/orders?focus=${id}`;
    case "production_order":
    case "work_order":
      return `/manufacturing/orders?order=${id}`;
    case "stock_count":
      return `/warehouse/stock-counts/${id}`;
    default:
      return null;
  }
}

// ── API ──────────────────────────────────────────────────────────────────

const BASE = "/inventory/warehouse-stock";

/** Drop empty values so the backend sees only the filters that are set. */
function clean<T extends object>(params: T): Partial<T> {
  const out: Partial<T> = {};
  (Object.keys(params) as (keyof T)[]).forEach((k) => {
    const v = params[k];
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  });
  return out;
}

export const warehouseStockApi = {
  getOnHand: async (params: OnHandParams) =>
    (await apiClient.get<Paged<OnHandRow>>(`${BASE}/on-hand`, { params: clean(params) })).data,

  getMovements: async (params: MovementParams) =>
    (await apiClient.get<Paged<StockMovement>>(`${BASE}/movements`, { params: clean(params) })).data,

  /** Download the movements matching the filters as CSV (authenticated client, then saves the blob). */
  exportMovementsCsv: async (params: MovementParams) => {
    const res = await apiClient.get<Blob>(`${BASE}/movements/export-csv`, {
      params: clean({ ...params, page: undefined, size: undefined }),
      responseType: "blob",
    });
    const disposition = String(res.headers["content-disposition"] || "");
    const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] || "stock_movements.csv";
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  },
};

/** Fetch every page of a paged endpoint (for the grid's "export all rows"). */
export async function fetchAllPages<T>(
  fetchPage: (page: number, size: number) => Promise<Paged<T>>,
  size = 200,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const resp = await fetchPage(page, size);
    out.push(...resp.items);
    if (resp.items.length === 0 || out.length >= resp.total || page >= (resp.pages || 1)) break;
  }
  return out;
}
