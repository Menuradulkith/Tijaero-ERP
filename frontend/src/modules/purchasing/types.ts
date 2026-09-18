// Supplier Types
export interface Supplier {
  id: number;
  company_name: string;
  company_registration_number?: string;
  tax_registration_number?: string;
  company_website?: string;
  billing_address_line1: string;
  billing_address_line2?: string;
  billing_city?: string;
  billing_state?: string;
  billing_postal_code?: string;
  shipping_address_line1?: string;
  shipping_address_line2?: string;
  shipping_city?: string;
  shipping_state?: string;
  shipping_postal_code?: string;
  email?: string;
  home_contact_number?: string;
  mobile_contact_number: string;
  credit_days: number;
  max_credit_limit: number;
  active: boolean;
  country_id?: number;
  date_joined: string;
  left_credit_amount?: number;
  initial_credit_amount?: number;
  logo_path?: string;
  average_lead_time_days?: number | null;
  created_at?: string;
  updated_at?: string;
  created_by?: number;
  updated_by?: number;
  created_by_name?: string;
  updated_by_name?: string;
}

export interface SupplierActivityLogEntry {
  id: number;
  action: string;
  changes?: Record<string, unknown> | null;
  timestamp: string;
  user_id: number;
  user_name?: string;
}

export interface SupplierContactPerson {
  id: number;
  supplier_id: number;
  title?: string;
  full_name: string;
  occupation?: string;
  gender?: string;
  birthdate?: string;
  id_card_number?: string;
  passport_no?: string;
  email?: string;
  phone?: string;
  created_at: string;
  updated_at: string;
}

export interface SupplierContactPersonCreate {
  title?: string;
  full_name: string;
  occupation?: string;
  gender?: string;
  birthdate?: string;
  id_card_number?: string;
  passport_no?: string;
  email?: string;
  phone?: string;
}

export type SupplierContactPersonUpdate = Partial<SupplierContactPersonCreate>;

// Supplier Payment Account Types (saved bank/cash/cheque details on a
// supplier's profile — distinct from `SupplierPaymentMethod` below, which is
// the method used on an actual posted SupplierPayment transaction)
export type SupplierPaymentAccountType = "cash" | "bank_transfer" | "cheque";

export interface SupplierPaymentAccount {
  id: number;
  supplier_id: number;
  method_type: SupplierPaymentAccountType;
  bank_name?: string;
  account_number?: string;
  account_holder_name?: string;
  is_default: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SupplierPaymentAccountCreate {
  method_type: SupplierPaymentAccountType;
  bank_name?: string;
  account_number?: string;
  account_holder_name?: string;
  is_default?: boolean;
  active?: boolean;
}

export interface SupplierPaymentAccountUpdate {
  method_type?: SupplierPaymentAccountType;
  bank_name?: string;
  account_number?: string;
  account_holder_name?: string;
  is_default?: boolean;
  active?: boolean;
}

// Supplier <-> Product mapping (the "approved vendor list"): which suppliers
// can supply a given product, and on what terms. Read from either side —
// supplier_id + product_id are both always present, and product_name /
// supplier_company_name are filled in by the backend for display.
export interface SupplierProduct {
  id: number;
  supplier_id: number;
  product_id: number;
  supplier_sku?: string;
  cost_price: number;
  lead_time_days?: number;
  minimum_order_qty?: number;
  is_preferred: boolean;
  active: boolean;
  product_name?: string;
  product_item_code?: string;
  supplier_company_name?: string;
  created_at: string;
  updated_at: string;
}

export interface SupplierProductCreate {
  product_id: number;
  supplier_sku?: string;
  cost_price: number;
  lead_time_days?: number;
  minimum_order_qty?: number;
  is_preferred?: boolean;
  active?: boolean;
}

export type SupplierProductUpdate = Partial<SupplierProductCreate>;

export interface SupplierCreate {
  company_name: string;
  company_registration_number?: string;
  tax_registration_number?: string;
  company_website?: string;
  billing_address_line1: string;
  billing_address_line2?: string;
  billing_city?: string;
  billing_state?: string;
  billing_postal_code?: string;
  shipping_address_line1?: string;
  shipping_address_line2?: string;
  shipping_city?: string;
  shipping_state?: string;
  shipping_postal_code?: string;
  email?: string;
  home_contact_number?: string;
  mobile_contact_number: string;
  credit_days: number;
  max_credit_limit: number;
  active?: boolean;
  country_id?: number;
}

export interface SupplierUpdate {
  company_name?: string;
  company_registration_number?: string;
  tax_registration_number?: string;
  company_website?: string;
  billing_address_line1?: string;
  billing_address_line2?: string;
  billing_city?: string;
  billing_state?: string;
  billing_postal_code?: string;
  shipping_address_line1?: string;
  shipping_address_line2?: string;
  shipping_city?: string;
  shipping_state?: string;
  shipping_postal_code?: string;
  email?: string;
  home_contact_number?: string;
  mobile_contact_number?: string;
  credit_days?: number;
  max_credit_limit?: number;
  active?: boolean;
  country_id?: number;
  /** The `updated_at` this edit was based on — lets the backend reject the
   * save with a 409 if someone else changed the record in the meantime,
   * instead of silently overwriting their change. Omit to skip the check. */
  expected_updated_at?: string;
}

// Purchase Order Types
export interface PurchasingOrderItem {
  id: number;
  product_id: number;
  quantity: number;
  unit_price: number;
  warrenty_month: string;
  remark?: string;
  purchasingorders_id: number;
  created_date: string;
  added_date: string;
}

export interface PurchasingOrderItemCreate {
  product_id: number;
  quantity: number;
  unit_price: number;
  warrenty_month: string;
  remark?: string;
}

export interface PurchasingOrder {
  id: number;
  purchasing_order_no: string;
  purchasing_invoice_no?: string;
  branch_code: string;
  payment_method: string;
  purchasing_order_date: string;
  good_received_note_date: string;
  remarks?: string;
  credit_date?: number;
  first_suppliers_id: number;
  second_suppliers_id: number;
  created_date: string;
  added_date: string;
  approval_id?: number;
  created_by?: number;
  created_by_name?: string;
  approved_by?: number;
  approved_by_name?: string;
  status: string;
  total_amount: number;
  paid_amount: number;
  supplier_name?: string;
}

export interface PurchasingOrderWithItems extends PurchasingOrder {
  items: PurchasingOrderItem[];
}

export interface PurchasingOrderCreate {
  purchasing_order_no: string;
  purchasing_invoice_no?: string;
  branch_code: string;
  payment_method: string;
  purchasing_order_date: string;
  good_received_note_date: string;
  remarks?: string;
  credit_date?: number;
  first_suppliers_id: number;
  second_suppliers_id: number;
  sales_quote_id?: number;  // Link to source proforma/quotation
  items: PurchasingOrderItemCreate[];
}

export interface PurchasingOrderUpdate {
  purchasing_invoice_no?: string;
  branch_code?: string;
  payment_method?: string;
  purchasing_order_date?: string;
  good_received_note_date?: string;
  remarks?: string;
  credit_date?: number;
  first_suppliers_id?: number;
  second_suppliers_id?: number;
  status?: string;
}

// Purchase Return Types
export type PurchaseReturnStatus = "draft" | "pending" | "approved" | "rejected";

export interface PurchasingReturnItem {
  id: number;
  product_id: number;
  purchasing_price: number;
  return_price: number;
  barcode: string;
  purchasingreturn_id: number;
  branch_code: string;
  added_date: string;
  sales_stock_id?: number;
  product_name?: string;
  warranty_month?: string;
}

export interface PurchasingReturnItemCreate {
  product_id: number;
  purchasing_price: number;
  return_price: number;
  barcode: string;
  sales_stock_id?: number;
}

export interface PurchasingReturn {
  id: number;
  purchasing_return_no: string;
  branch_code: string;
  remark?: string;
  goodreceivednote_id: number;
  added_date: string;
  status: PurchaseReturnStatus;
  approved_date?: string;
  approval_id?: number;
  grn_no?: string;
  po_no?: string;
  supplier_name?: string;
}

export interface PurchasingReturnWithItems extends PurchasingReturn {
  items: PurchasingReturnItem[];
}

export interface PurchasingReturnCreate {
  purchasing_return_no?: string;  // Auto-generated if not provided
  branch_code: string;
  remark?: string;
  goodreceivednote_id: number;
  items: PurchasingReturnItemCreate[];
  require_approval?: boolean;  // Whether to submit for approval or approve immediately
}

// Barcode Validation Types for Purchase Return
export interface BarcodeValidationRequest {
  barcode: string;
  grn_id: number;
  branch_code: string;
}

export interface BarcodeValidationStockInfo {
  id: number;
  barcode: string;
  product_id: number;
  product_name?: string;
  purchasing_price: number;
  branch_code: string;
  status: string;
  grn_id?: number;
  grn_no?: string;
  supplier_id?: number;
  supplier_name?: string;
}

export interface BarcodeValidationResponse {
  valid: boolean;
  barcode: string;
  message: string;
  sales_stock_id?: number;
  product_id?: number;
  product_name?: string;
  purchasing_price?: number;
  status?: string;
  sales_stock?: BarcodeValidationStockInfo;
  warranty_month?: string;
  warranty_expired?: boolean;
  warranty_expiry_date?: string;
}

export interface PurchaseReturnApprovalRequest {
  return_id: number;
  approve: boolean;
  remarks?: string;
}

// Good Received Note Types
export interface GoodReceivedNote {
  id: number;
  good_received_no: string;
  good_received_date: string;
  supplier_invoice_no: string;
  supplier_invoice_date: string;
  remark?: string;
  branch_code: string;
  created_date: string;
  good_received_locations_id: number;
  purchasingorders_id: number;
  added_date: string;
  po_no?: string;
  supplier_name?: string;
}

export interface GoodReceivedNoteCreate {
  good_received_no: string;
  good_received_date: string;
  supplier_invoice_no: string;
  supplier_invoice_date: string;
  remark?: string;
  branch_code: string;
  good_received_locations_id: number;
  purchasingorders_id: number;
}

// Good Received Items Types
export interface GoodReceivedItem {
  id: number;
  good_received_note: string;
  barcode: string;
  branch_code: string;
  active: boolean;
  created_date: string;
  purchasing_order_items_id: number;
  added_date: string;
  // Enhanced fields
  product_id?: number;
  product_name?: string;
  saved_to_sales_stock?: boolean;
  saved_to_company_assets?: boolean;
}

export interface GoodReceivedItemCreate {
  good_received_note: string;
  barcode: string;
  branch_code: string;
  active: boolean;
  purchasing_order_items_id: number;
}

// Supplier Credits Settlement Types
export interface SupplierCreditsSettle {
  id: number;
  supplier_credits_settle_no: string;
  branch_code: string;
  created_date: string;
  suppliers_id: number;
  status: "pending" | "verified" | "cancelled";
  verified_by?: number;
  verified_date?: string;
  supplier?: Supplier;
  transactions?: SupplierCreditsSettleTransaction[];
}

export interface SupplierCreditsSettleTransaction {
  id: number;
  payment_method: string;
  cheque_date: string;
  payment_amount: number;
  payment_method_number?: string;
  remarks?: string;
  created_date: string;
  good_received_id: number;
  supplier_credit_settle_id: number;
  // GRN details for display
  grn_no?: string;
  po_no?: string;
  invoice_no?: string;
}

export interface SupplierCreditsSettleTransactionCreate {
  payment_method: string;
  cheque_date: string;
  payment_amount: number;
  payment_method_number?: string;
  remarks?: string;
  good_received_id: number;
}

export interface SupplierCreditsSettleCreate {
  supplier_credits_settle_no: string;
  branch_code: string;
  suppliers_id: number;
  transactions: SupplierCreditsSettleTransactionCreate[];
}

export interface SupplierCreditsSettleUpdate {
  branch_code?: string;
}

export interface SupplierCreditsSettleWithTransactions extends SupplierCreditsSettle {
  transactions: SupplierCreditsSettleTransaction[];
}

// Daily PO Limit Check
export interface DailyPOLimitCheck {
  branch_code: string;
  date: string;
  count: number;
  limit: number;
  remaining: number;
  can_create: boolean;
  message: string;
}


// ==================== SUPPLIER PAYMENT TYPES ====================

export type SupplierPaymentStatus = "pending" | "verified" | "cancelled";
export type SupplierPaymentFor = "Purchase" | "Advance" | "Refund" | "Other";
export type SupplierPaymentMethod = "Cash" | "Bank Transfer" | "Cheque";

export interface SupplierPayment {
  id: number;
  payment_no: string;
  supplier_id: number;
  purchasing_order_id?: number;
  payment_date: string;
  payment_method: SupplierPaymentMethod | string;
  payment_amount: number;
  reference_number?: string;
  bank_name?: string;
  branch_code: string;
  payment_for: SupplierPaymentFor | string;
  invoice_reference?: string;
  remarks?: string;
  status: SupplierPaymentStatus;
  verified_by?: number;
  verified_date?: string;
  created_date: string;
  created_by?: number;
  // Loaded from relationships
  supplier_name?: string;
  po_no?: string;
}

export interface SupplierPaymentCreate {
  supplier_id: number;
  purchasing_order_id?: number;
  payment_date: string;
  payment_method: string;
  payment_amount: number;
  reference_number?: string;
  bank_name?: string;
  branch_code: string;
  payment_for: string;
  invoice_reference?: string;
  remarks?: string;
}

export interface SupplierPaymentUpdate {
  payment_date?: string;
  payment_method?: string;
  payment_amount?: number;
  reference_number?: string;
  bank_name?: string;
  payment_for?: string;
  invoice_reference?: string;
  remarks?: string;
  status?: string;
}


// ==================== SUPPLIER ADVANCE PAYMENT TYPES ====================

export interface SupplierAdvancePayment {
  id: number;
  advance_no: string;
  supplier_id: number;
  purchasing_order_id?: number;
  payment_voucher_id?: number;
  payment_date: string;
  branch_code: string;
  payment_method: SupplierPaymentMethod | string;
  original_amount: number;
  applied_amount: number;
  remaining_amount: number;
  reference_number?: string;
  bank_name?: string;
  is_fully_applied: boolean;
  returned_amount?: number;
  return_date?: string;
  return_method?: string;
  return_reference?: string;
  return_remarks?: string;
  remarks?: string;
  created_by?: number;
  created_at?: string;
  updated_at?: string;
  // Loaded from relationships
  supplier_name?: string;
  po_no?: string;
}

export interface SupplierAdvanceReturnCreate {
  return_amount: number;
  return_date: string;
  return_method: string;
  return_reference?: string;
  return_remarks?: string;
}

export interface SupplierAdvancePaymentCreate {
  supplier_id: number;
  purchasing_order_id?: number;
  payment_date: string;
  payment_method: string;
  original_amount: number;
  reference_number?: string;
  bank_name?: string;
  branch_code: string;
  remarks?: string;
}

export interface SupplierAdvancePaymentUpdate {
  payment_date?: string;
  payment_method?: string;
  reference_number?: string;
  bank_name?: string;
  remarks?: string;
}

export interface SupplierAdvanceApplication {
  id: number;
  advance_id: number;
  grn_id: number;
  applied_amount: number;
  application_date: string;
  remarks?: string;
  created_at?: string;
  updated_at?: string;
  // Loaded from relationships
  grn_no?: string;
  advance_no?: string;
}

export interface SupplierAdvanceApplicationCreate {
  advance_id: number;
  grn_id: number;
  applied_amount: number;
  application_date: string;
  remarks?: string;
}

export interface SupplierAdvancePaymentWithApplications extends SupplierAdvancePayment {
  applications: SupplierAdvanceApplication[];
}

export interface SupplierAdvanceBalanceSummary {
  supplier_id: number;
  supplier_name: string;
  total_advances: number;
  total_applied: number;
  available_balance: number;
  active_advance_count: number;
  advances: SupplierAdvancePayment[];
}

export interface SupplierAdvancePaymentListFilter {
  supplier_id?: number;
  branch_code?: string;
  is_fully_applied?: boolean;
  date_from?: string;
  date_to?: string;
  skip?: number;
  limit?: number;
}

// ── Dashboard Statistics ─────────────────────────────────────────────────
export interface PurchasingStats {
  total_suppliers: number;
  active_suppliers: number;
  total_pos: number;
  current_month_pos: number;
  last_month_pos: number;
  total_po_value: number;
  current_month_po_value: number;
  last_month_po_value: number;
  pending_pos: number;
  approved_pos: number;
  completed_pos: number;
  rejected_pos: number;
  total_grns: number;
  current_month_grns: number;
  total_returns: number;
  pending_returns: number;
  daily_orders: { date: string; orders: number }[];
  monthly_spending: { month: string; value: number; orders: number }[];
  top_suppliers: { name: string; orders: number; value: number }[];
  payment_methods: Record<string, number>;
  recent_pos: { id: number; po_no: string; date: string; status: string; supplier: string }[];
  recent_grns: { id: number; grn_no: string; date: string; po_id: number }[];
}
