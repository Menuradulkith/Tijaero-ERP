export interface Category {
  id: number;
  name: string;
  category_code: string;
  memo?: string;
  description?: string;
  active: boolean;
  created_date: string;
  created_at: string;
  updated_at: string;
}

export interface CategoryCreate {
  name: string;
  category_code: string;
  memo?: string;
  description?: string;
  active?: boolean;
}

export interface CategoryUpdate {
  name?: string;
  category_code?: string;
  memo?: string;
  description?: string;
  active?: boolean;
}

export interface Brand {
  id: number;
  brand_name: string;
  brand_code: string;
  description?: string;
  active: boolean;
}

export interface BrandCreate {
  brand_name: string;
  brand_code: string;
  description?: string;
  active?: boolean;
}

export interface BrandUpdate {
  brand_name?: string;
  brand_code?: string;
  description?: string;
  active?: boolean;
}

export interface Product {
  id: number;
  name: string;
  item_code: string;
  model?: string;
  item_type: string;
  description?: string;
  website_active: boolean;
  website_price?: number;
  selling_price?: number;  // Selling price for sales stock
  active: boolean;
  cost_price: number;
  category_id: number;
  items_brand_id: number;
  image_url?: string;
  created_date: string;
  added_date: string;
  created_at: string;
  updated_at: string;
}

export interface MinimumPrice {
  id: number;
  minimum_price: number;
  product_id: number;
  created_date: string;
  created_at: string;
  updated_at: string;
}

export interface MinimumPriceCreate {
  minimum_price: number;
}

export interface ProductCreate {
  name: string;
  item_code: string;
  model?: string;
  item_type: string;
  description?: string;
  website_active?: boolean;
  website_price?: number;
  selling_price?: number;  // Selling price for sales stock
  active?: boolean;
  cost_price?: number;
  category_id: number;
  items_brand_id: number;
  image_url?: string;
}

export interface ProductUpdate {
  name?: string;
  model?: string;
  item_type?: string;
  description?: string;
  website_active?: boolean;
  website_price?: number;
  selling_price?: number;  // Selling price for sales stock
  active?: boolean;
  cost_price?: number;
  category_id?: number;
  items_brand_id?: number;
  image_url?: string;
}

// Product with related details
export interface ProductWithDetails extends Product {
  category?: Category;
  brand?: Brand;
}

// Minimum Price types
export interface MinimumPrice {
  id: number;
  minimum_price: number;
  product_id: number;
  created_date: string;
  created_at: string;
  updated_at: string;
}

export interface MinimumPriceCreate {
  minimum_price: number;
}

// Sales Stock Types - items available for sale
// Mirrors backend StockStatus (app/common/enums.py)
export type SalesStockStatus =
  | "available"
  | "sold"
  | "reserved"
  | "returned"
  | "returned_to_supplier"
  | "returned_non_restockable"
  | "return_pending"
  | "transferred"
  | "transfer_pending"
  | "in_transit"
  | "damaged";

export interface SalesStock {
  id: number;
  product_id: number;
  barcode: string;
  branch_code: string;
  location_id?: number;  // Current physical location (good_received_locations)
  good_received_note_id: number;
  purchasing_order_items_id: number;
  warranty_month?: string;  // Warranty period from PO or entered in GRN
  status: SalesStockStatus;
  is_active: boolean;  // Soft delete flag
  returned_date?: string;  // When item was returned
  purchase_return_id?: number;  // Link to return record
  added_date: string;
  grn_no?: string;  // GRN number from relationship
  location_name?: string;  // Location name from GRN
  cost_price?: number;  // Cost price from product
  selling_price?: number;  // Selling price from product
  minimum_selling_price?: number;  // Minimum selling price from product
  product_name?: string;  // Product name from relationship
  item_code?: string;  // Item code from product
  brand_id?: number;  // Brand ID from product
}

export interface SalesStockCreate {
  product_id: number;
  barcode: string;
  branch_code: string;
  location_id?: number;  // good_received_locations_id from GRN
  good_received_note_id: number;
  purchasing_order_items_id: number;
  warranty_month?: string;  // From PO item or entered in GRN
  status?: string;
}

// Branch-scoped KPI counters returned alongside the paginated list
export interface SalesStockSummary {
  in_stock: number;
  reserved: number;
  sold_today: number;
  returned: number;
}

// Server-side paginated sales-stock response
export interface SalesStockPaginated {
  items: SalesStock[];
  total: number;
  summary: SalesStockSummary;
}

// Extra context for a tracking event
export interface StockTrackingEventExtra {
  po_no?: string | null;
  location?: string | null;
  branch?: string | null;
  selling_price?: number | null;
  return_price?: number | null;
  condition?: string | null;
  restocked?: boolean | null;
  from_location?: string | null;
  to_location?: string | null;
  received?: boolean | null;
  status?: string | null;
}

// Stock Tracking Event — one entry in the item's lifecycle timeline
export interface StockTrackingEvent {
  date: string | null;
  action: string;          // Received, Sold, Customer Return, Returned to Supplier, Transferred, Marked Damaged
  details: string;         // Human-readable description
  reference_type: string | null;  // GRN, Invoice, SaleReturn, PurchaseReturn, ITN
  reference_no: string | null;
  extra: StockTrackingEventExtra;
  color: string;           // Timeline dot colour
}

// Company Assets Types - Real table for company-owned items
export interface CompanyAsset {
  id: number;
  product_id?: number;
  inventory_no: string;
  item: string;
  description?: string;
  branch_code: string;
  asigned_to?: number;
  barcode?: string;
  warranty_month?: string;
  good_received_note_id?: number;
  purchasing_order_items_id?: number;
  status: "available" | "in_use" | "retired" | "disposed" | "returned";
  return_reason?: string;
  sale_return_id?: number;
  source?: "grn" | "sale_return";
  added_date?: string;
  // Enriched fields from backend
  product_name?: string;
  item_code?: string;
  brand_id?: number;
  cost_price?: number;
  grn_no?: string;
}

export interface CompanyAssetCreate {
  product_id?: number;
  inventory_no: string;
  item: string;
  description?: string;
  branch_code: string;
  asigned_to?: number;
  barcode?: string;
  warranty_month?: string;
  good_received_note_id?: number;
  purchasing_order_items_id?: number;
  status?: string;
  return_reason?: string;
  sale_return_id?: number;
  source?: string;
}
