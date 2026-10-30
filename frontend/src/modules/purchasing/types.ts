// Supplier Types
export interface Supplier {
  id: number;
  /** Sequential display number (0001, 0002, ...) shown as the grid's first column. */
  supplier_no: string;
  company_name: string;
  company_registration_number?: string;
  tax_registration_number?: string;
  /** Tax treatment classification — see SUPPLIER_TAX_AREA in @/components/tijaero. */
  tax_area?: string | null;
  company_website?: string;
  billing_address_line1: string;
  billing_address_line2?: string;
  billing_city?: string;
  billing_state?: string;
  billing_postal_code?: string;
  billing_country_id?: number;
  shipping_address_line1?: string;
  shipping_address_line2?: string;
  shipping_city?: string;
  shipping_state?: string;
  shipping_postal_code?: string;
  shipping_country_id?: number;
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
  /** Manually-set planning default (days) — always editable, independent
   * of the computed average_lead_time_days below. */
  lead_time_days?: number | null;
  /** Read-only, computed live from actual PO->GRN delivery history. */
  average_lead_time_days?: number | null;
  /** 3-letter ISO 4217 code, e.g. "LKR" — options come from the
   * currencies reference data (useReferenceData(["currencies"])). */
  default_currency?: string | null;
  created_at?: string;
  updated_at?: string;
  created_by?: number;
  updated_by?: number;
  created_by_name?: string;
  updated_by_name?: string;
  /** Full-precision change token — echo back as expected_version on save. */
  version?: string;
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
  active: boolean;
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
  active?: boolean;
}

export type SupplierContactPersonUpdate = Partial<SupplierContactPersonCreate>;

// Supplier Payment Account Types (saved standing/preferred payment methods
// on a supplier's profile — distinct from `SupplierPaymentMethod` below,
// which is the method used on an actual posted SupplierPayment transaction)
export type SupplierPaymentAccountType =
  | "cash"
  | "bank_transfer"
  | "cheque"
  | "direct_debit"
  | "letter_of_credit"
  | "credit_card"
  | "digital_wallet";

export interface SupplierPaymentAccount {
  id: number;
  supplier_id: number;
  method_type: SupplierPaymentAccountType;
  bank_name?: string;
  account_number?: string;
  account_holder_name?: string;
  // Bank-transfer-only wire details — not used for cheque/cash.
  branch?: string;
  bank_branch_code?: string;
  swift_code?: string;
  correspondent_bank_name?: string;
  correspondent_bank_swift_code?: string;
  // Direct Debit / ACH only.
  mandate_reference?: string;
  mandate_date?: string;
  // Letter of Credit only.
  lc_number?: string;
  issuing_bank_name?: string;
  advising_bank_name?: string;
  lc_amount?: number;
  lc_currency?: string;
  lc_type?: string;
  lc_issue_date?: string;
  lc_expiry_date?: string;
  latest_shipment_date?: string;
  // Credit Card only — PCI-DSS: last 4 digits only, never the full PAN.
  card_type?: string;
  card_last4?: string;
  card_expiry?: string;
  cardholder_name?: string;
  // Digital Wallet only.
  wallet_provider?: string;
  wallet_id?: string;
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
  branch?: string;
  bank_branch_code?: string;
  swift_code?: string;
  correspondent_bank_name?: string;
  correspondent_bank_swift_code?: string;
  mandate_reference?: string;
  mandate_date?: string;
  lc_number?: string;
  issuing_bank_name?: string;
  advising_bank_name?: string;
  lc_amount?: number;
  lc_currency?: string;
  lc_type?: string;
  lc_issue_date?: string;
  lc_expiry_date?: string;
  latest_shipment_date?: string;
  card_type?: string;
  card_last4?: string;
  card_expiry?: string;
  cardholder_name?: string;
  wallet_provider?: string;
  wallet_id?: string;
  is_default?: boolean;
  active?: boolean;
}

export interface SupplierPaymentAccountUpdate {
  method_type?: SupplierPaymentAccountType;
  bank_name?: string;
  account_number?: string;
  account_holder_name?: string;
  branch?: string;
  bank_branch_code?: string;
  swift_code?: string;
  correspondent_bank_name?: string;
  correspondent_bank_swift_code?: string;
  mandate_reference?: string;
  mandate_date?: string;
  lc_number?: string;
  issuing_bank_name?: string;
  advising_bank_name?: string;
  lc_amount?: number;
  lc_currency?: string;
  lc_type?: string;
  lc_issue_date?: string;
  lc_expiry_date?: string;
  latest_shipment_date?: string;
  card_type?: string;
  card_last4?: string;
  card_expiry?: string;
  cardholder_name?: string;
  wallet_provider?: string;
  wallet_id?: string;
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
  minimum_order_qty?: number;
  is_preferred?: boolean;
  active?: boolean;
}

export type SupplierProductUpdate = Partial<SupplierProductCreate>;

export interface SupplierCreate {
  company_name: string;
  company_registration_number?: string;
  tax_registration_number?: string;
  tax_area?: string;
  company_website?: string;
  billing_address_line1: string;
  billing_address_line2?: string;
  billing_city?: string;
  billing_state?: string;
  billing_postal_code?: string;
  billing_country_id?: number;
  shipping_address_line1?: string;
  shipping_address_line2?: string;
  shipping_city?: string;
  shipping_state?: string;
  shipping_postal_code?: string;
  shipping_country_id?: number;
  email?: string;
  home_contact_number?: string;
  mobile_contact_number: string;
  credit_days: number;
  max_credit_limit: number;
  active?: boolean;
  country_id?: number;
  lead_time_days?: number;
  default_currency?: string;
}

export interface SupplierUpdate {
  company_name?: string;
  company_registration_number?: string;
  tax_registration_number?: string;
  tax_area?: string;
  company_website?: string;
  billing_address_line1?: string;
  billing_address_line2?: string;
  billing_city?: string;
  billing_state?: string;
  billing_postal_code?: string;
  billing_country_id?: number;
  shipping_address_line1?: string;
  shipping_address_line2?: string;
  shipping_city?: string;
  shipping_state?: string;
  shipping_postal_code?: string;
  shipping_country_id?: number;
  email?: string;
  home_contact_number?: string;
  mobile_contact_number?: string;
  credit_days?: number;
  max_credit_limit?: number;
  active?: boolean;
  country_id?: number;
  lead_time_days?: number;
  default_currency?: string;
  /** The `updated_at` this edit was based on — lets the backend reject the
   * save with a 409 if someone else changed the record in the meantime,
   * instead of silently overwriting their change. Omit to skip the check. */
  expected_updated_at?: string;
  /** Preferred over expected_updated_at: the exact `version` token from the
   * Supplier response (catches changes within the same second too). */
  expected_version?: string;
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
  /** Set when this line was sourced from a Sales Quotation. */
  quote_item_id?: number | null;
}

export interface PurchasingOrderItemCreate {
  product_id: number;
  quantity: number;
  unit_price: number;
  warrenty_month: string;
  remark?: string;
  /** Links this line back to the SalesQuoteItem it fulfills, when creating
   * purchase orders from a Sales Quotation. */
  quote_item_id?: number | null;
}

export interface PurchasingOrder {
  id: number;
  purchasing_order_no: string;
  purchasing_invoice_no?: string;
  branch_code: string;
  payment_method: string;
  purchasing_order_date: string;
  good_received_note_date: string;
  /** Optional "needed by" date for the whole order — one per PO, set per
   * supplier group in the product-first PO creation wizard's Step 2. */
  required_date?: string | null;
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
  updated_by?: number;
  updated_by_name?: string;
  status: string;
  total_amount: number;
  /** Sum of every line item's quantity — derived server-side. */
  total_quantity: number;
  paid_amount: number;
  supplier_name?: string;
  /** Set when this PO was created as part of a multi-supplier product-first
   * checkout — every sibling PO from that same checkout shares this value. */
  purchase_batch_id?: string | null;
  /** Set when this PO was created from a Sales Quotation. */
  sales_quote_id?: number | null;
  sales_quote_no?: string | null;
  /** Why the approver rejected the PO; only set when it is rejected. */
  rejection_reason?: string | null;
  cancellation_reason?: string | null;
  cancelled_date?: string | null;
  cancelled_by?: number | null;
  short_close_reason?: string | null;
  short_closed_date?: string | null;
  short_closed_by?: number | null;
}

export interface PurchasingOrderWithItems extends PurchasingOrder {
  items: PurchasingOrderItem[];
}

// Product-first, multi-supplier PO checkout: one group per supplier, each
// shaped exactly like a normal PurchasingOrderCreate. The backend creates
// one PurchasingOrder per group, all tagged with a shared purchase_batch_id.
export interface PurchasingOrderBatchCreate {
  groups: PurchasingOrderCreate[];
}

export interface PurchasingOrderBatchResponse {
  purchase_batch_id: string;
  orders: PurchasingOrderWithItems[];
}

export interface PurchasingOrderCreate {
  purchasing_order_no: string;
  purchasing_invoice_no?: string;
  branch_code: string;
  payment_method?: string;
  purchasing_order_date: string;
  good_received_note_date: string;
  /** Optional "needed by" date for the whole order. */
  required_date?: string | null;
  remarks?: string;
  credit_date?: number;
  first_suppliers_id: number;
  second_suppliers_id: number;
  sales_quote_id?: number;  // Link to source quotation
  items: PurchasingOrderItemCreate[];
}

export interface PurchasingOrderUpdate {
  purchasing_invoice_no?: string;
  branch_code?: string;
  payment_method?: string;
  purchasing_order_date?: string;
  good_received_note_date?: string;
  required_date?: string | null;
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
  return_price: number;  // per unit
  barcode?: string | null;  // null for batch/none lot returns
  quantity: number;
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
  return_price: number;  // per unit
  barcode?: string;  // serial units; omit for batch/none lots
  quantity?: number;  // lots: units returned (identified by sales_stock_id)
  sales_stock_id?: number;
}

export interface LotReturnValidationRequest {
  grn_id: number;
  sales_stock_id: number;
  quantity: number;
  branch_code?: string;  // the returning branch: the lot must be stocked there
}

export interface LotReturnValidationResponse {
  valid: boolean;
  message: string;
  sales_stock_id?: number;
  product_id?: number;
  product_name?: string;
  batch_no?: string;
  available_quantity: number;
  purchasing_price?: number;  // per unit
}

export const PURCHASE_RETURN_REASONS = [
  "Quality issue",
  "Incorrect item",
  "Quantity mismatch",
  "Damaged during delivery",
  "Label errors",
  "Other",
] as const;

export type PurchaseReturnReason = (typeof PURCHASE_RETURN_REASONS)[number];

export interface PurchasingReturn {
  id: number;
  purchasing_return_no: string;
  branch_code: string;
  remark?: string;  // comment
  reason?: string | null;
  goodreceivednote_id: number;
  added_date: string;
  status: PurchaseReturnStatus;
  approved_date?: string;
  approval_id?: number;
  grn_no?: string;
  po_no?: string;
  supplier_name?: string;
  created_by?: number;
  created_by_name?: string;
  total_quantity?: number;  // units going back to the supplier
  total_amount?: number | string | null;
}

export interface PurchasingReturnWithItems extends PurchasingReturn {
  items: PurchasingReturnItem[];
}

export interface PurchasingReturnCreate {
  purchasing_return_no?: string;  // Auto-generated if not provided
  branch_code: string;
  remark?: string;  // comment; required when reason is "Other"
  reason?: string;
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
  supplier_invoice_no?: string;  // legacy: the supplier invoice is matched at purchase-invoice time
  supplier_invoice_date?: string;
  delivery_note_no?: string | null;
  vehicle_no?: string | null;
  received_by?: string | null;
  status?: "posted" | "cancelled";
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  remark?: string;
  branch_code: string;
  created_date: string;
  good_received_locations_id: number;
  purchasingorders_id: number;
  added_date: string;
  po_no?: string;
  supplier_name?: string;
  created_by_name?: string;
  units_received?: number;  // accepted units (lots count by quantity)
  units_rejected?: number;
  total_value?: number | string | null;  // received units at their purchase-order price
  // GRNs have no approval step; these describe the linked PO's approval.
  po_approved_by_name?: string;
  po_approved_date?: string;
}

export interface GoodReceivedNoteCreate {
  good_received_no: string;
  good_received_date: string;
  supplier_invoice_no?: string;
  supplier_invoice_date?: string;
  delivery_note_no?: string;
  vehicle_no?: string;
  received_by?: string;  // defaults to the posting user
  remark?: string;
  branch_code: string;
  good_received_locations_id: number;
  purchasingorders_id: number;
}

// Atomic receipt (POST /purchasing/grn/receive): header + accepted/rejected quantities per PO line
export interface GRNReceiveUnit {
  barcode: string;
  warranty_month?: string;
}

export interface GRNReceiveLine {
  purchasing_order_items_id: number;
  units?: GRNReceiveUnit[];  // accepted serial units
  quantity?: number;  // accepted qty for batch/none products
  batch_no?: string;
  expiry_date?: string;
  warranty_month?: string;
  rejected_quantity?: number;
  rejection_reason?: string;
}

export interface GoodReceivedNoteReceive extends GoodReceivedNoteCreate {
  lines: GRNReceiveLine[];
}

export interface GoodReceivedNoteReceiveResult {
  grn: GoodReceivedNote;
  units_received: number;
  units_rejected: number;
}

// Landed cost (freight, duty...) allocated across a GRN's lines
export interface LandedCostCreate {
  charge_type: "freight" | "duty" | "insurance" | "handling" | "other";
  amount: number;
  allocation_basis: "value" | "quantity";
  payment_method: "credit" | "cash" | "bank";
  description?: string;
  reference_no?: string;
  supplier_id?: number;
  voucher_date?: string;
}

export interface LandedCostVoucher {
  id: number;
  voucher_no: string;
  voucher_date: string;
  charge_type: string;
  description?: string | null;
  amount: number | string;
  allocation_basis: string;
  payment_method: string;
  supplier_name?: string | null;
  reference_no?: string | null;
  status: "posted" | "cancelled";
  cancel_reason?: string | null;
}

export interface LandedCostLine {
  purchasing_order_items_id: number;
  product_name?: string | null;
  quantity: number;
  unit_price: number | string;
  landed_total: number | string;
  landed_per_unit: number | string;
  landed_unit_cost: number | string;
}

export interface LandedCostSummary {
  vouchers: LandedCostVoucher[];
  lines: LandedCostLine[];
  total_landed: number | string;
}

export interface GRNRejection {
  id: number;
  purchasing_order_items_id: number;
  quantity: number;
  reason: string;
  product_name?: string;
}

// Good Received Items Types
export interface GoodReceivedItem {
  id: number;
  good_received_note: string;
  barcode?: string | null;  // null for batch/none-tracked receipts
  quantity: number;  // units this row represents (1 for serial)
  batch_no?: string | null;
  expiry_date?: string | null;
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
  barcode?: string;  // required for serial-tracked products only
  quantity?: number;  // defaults to 1; the received qty for batch/none products
  batch_no?: string;
  expiry_date?: string;
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

// ==================== PROCUREMENT QUEUE (Procurement Queue page) ====================
// A quotation item with a supplier already chosen (via the Sales Quotation
// page's "Select Products & Suppliers for Procurement" dialog) but no
// Purchase Order created for it yet. Feeds the central TOP page, which
// aggregates queued items across every quotation, grouped by supplier.

export interface ProcurementQueueItemInput {
  quote_item_id: number;
  supplier_id: number;
  quantity: number;
  unit_price: number;
}

export interface ProcurementQueueItem {
  id: number;
  quote_item_id: number;
  quote_id: number;
  quote_no: string;
  branch_code: string;
  supplier_id: number;
  supplier_name?: string;
  product_id: number;
  product_name?: string;
  quantity: number;
  unit_price: number;
  added_date: string;
  /** Still-required qty on the quote line (quantity - converted_qty). */
  required_quantity: number;
  /** Already-in-stock qty for this product at the quote's branch. */
  available_quantity: number;
  /** Qty already ordered on a PO for this exact quote line, if any. */
  ordered_quantity: number;
  /** required - available - ordered, floored at 0 — what actually still needs buying. */
  to_purchase_quantity: number;
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
