export interface InvoiceItem {
  id: number;
  product_id: number;
  quantity: number;
  selling_price: number;
  minimum_selling_price: number;
  warrenty_month: string;
  barcode?: string;
  invoice_id: number;
  created_date: string;
  discount_percent?: number;
  discount_amount?: number;
}

export interface InvoiceItemCreate {
  product_id: number;
  quantity: number;
  selling_price: number;
  minimum_selling_price: number;
  warrenty_month: string;
  discount_percent?: number;
  discount_amount?: number;
}

export interface Invoice {
  id: number;
  invoice_no: string;
  branch_code: string;
  customer_id: number;
  sale_rep_id: number;
  customer_agent_id?: number;
  payment_method: string;
  cash_amount: number;
  card_visa_amount: number;
  card_mastercard_amount: number;
  card_amex_amount: number;
  cheque_amount: number;
  bank_transfer_amount: number;
  credit_amount: number;
  payment_adjustments: number;
  cupon_amount: number;
  credit_note_amount: number;
  // Gift voucher
  gift_voucher_id?: number;
  gift_voucher_amount: number;
  remarks?: string;
  special: boolean;
  created_date: string;
  created_date_time: string;
  status: boolean;
  approval: boolean;
  approval_status: string;
  // Tax and discount
  tax_rate: number;
  tax_amount: number;
  discount_percent: number;
  discount_amount: number;
  // Totals
  subtotal: number;
  grand_total: number;
  // Service charges
  service_charge_rate: number;
  service_charge_amount: number;
  // Payment tracking
  paid_amount: number;
  balance_due: number;
  payment_status: string;  // unpaid, partial, paid
  // Timestamps
  created_at: string;
  updated_at: string;
}

export interface InvoiceCreate {
  invoice_no: string;
  branch_code: string;
  customer_id: number;
  sale_rep_id: number;
  customer_agent_id?: number;
  payment_method: string;
  cash_amount?: number;
  card_visa_amount?: number;
  card_mastercard_amount?: number;
  card_amex_amount?: number;
  cheque_amount?: number;
  bank_transfer_amount?: number;
  credit_amount?: number;
  payment_adjustments?: number;
  remarks?: string;
  special?: boolean;
  items: InvoiceItemCreate[];
  // Source proforma/quotation link
  source_quote_id?: number;
  source_quote_type?: string;
  // Cheque payment details
  cheque_number?: string;
  cheque_bank?: string;
  cheque_date?: string;
  // Card payment details
  card_ref_number?: string;
  card_holder_name?: string;
  payment_card_id?: number; // Reference to PaymentCard from settings
  // Bank transfer details
  bank_transfer_ref?: string;
  bank_name?: string;
  // Credit note
  credit_note_id?: number;
  // Tax and discount
  tax_rate?: number;
  discount_percent?: number;
  discount_amount?: number;
  // Coupon/discount code
  cupon_id?: number;
  cupon_amount?: number;
  // Credit note redemption
  credit_note_amount?: number;
  // Gift voucher (legacy single voucher)
  gift_voucher_id?: number;
  gift_voucher_amount?: number;
  // Multiple voucher redemptions
  voucher_redemptions?: Array<{
    voucher_id: number;
    amount_to_redeem: number;
  }>;
}

export interface InvoiceUpdate {
  remarks?: string;
  status?: boolean;
  approval?: boolean;
  approval_status?: string;
  items?: InvoiceItemCreate[];
}

export interface InvoiceWithItems extends Invoice {
  items: InvoiceItem[];
}

export interface SaleReturnItem {
  id: number;
  barcode: string;
  return_price: number;
  sold_price: number;
  branch_code: string;
  invoice_item_id?: number;
  sale_return_id: number;
  added_date: string;
  sales_stock_id?: number;
  product_id?: number;
  quantity: number;
  condition: string;  // good, damaged, defective, opened
  restockable: boolean;
  restocked: boolean;
}

export interface SaleReturnItemCreate {
  barcode: string;
  return_price: number;
  sold_price: number;
  branch_code: string;
  invoice_item_id?: number;
  product_id?: number;
  quantity?: number;
  condition?: string;
  restockable?: boolean;
}

export interface SaleReturn {
  id: number;
  sale_return_no: string;
  branch_code: string;
  invoice_id: number;
  good_received_locations_id: number;
  payment_method: string;
  remark?: string;
  added_date: string;
  cheque_date: string;
  approval_id?: number;
  // Status
  status: string;  // pending, approved, processed, rejected
  return_reason?: string;
  // Totals
  subtotal: number;
  tax_refund: number;
  total_refund: number;
  // Refund tracking
  refund_status: string;  // pending, processed, partial
  refund_amount: number;
  refund_date?: string;
  refund_reference?: string;
  credit_note_id?: number;
  // User tracking
  created_by?: number;
  approved_by?: number;
  processed_by?: number;
  created_at?: string;
  updated_at?: string;
}

export interface SaleReturnCreate {
  sale_return_no: string;
  branch_code: string;
  invoice_id: number;
  good_received_locations_id: number;
  payment_method: string;
  remark?: string;
  return_reason?: string;
  items: SaleReturnItemCreate[];
}

export interface SaleReturnWithItems extends SaleReturn {
  items: SaleReturnItem[];
}

export interface SaleReturnProcessResponse {
  sale_return: SaleReturn;
  credit_note_id?: number;
  refund_reference?: string;
  items_restocked: number;
  message: string;
}

// Sales Statistics Types
export interface SalesStats {
  total_orders: number;
  total_revenue: number;
  current_month_orders: number;
  current_month_revenue: number;
  last_month_orders: number;
  last_month_revenue: number;
  today_revenue: number;
  today_orders: number;
  avg_order_value: number;
  pending_approval: number;
  approved: number;
  sale_returns_count: number;
  payment_breakdown: {
    cash: number;
    card: number;
    cheque: number;
    bank_transfer: number;
    credit: number;
  };
  daily_sales: { date: string; revenue: number; orders: number }[];
  monthly_sales: { month: string; revenue: number; orders: number }[];
  top_customers: { name: string; orders: number; revenue: number }[];
  status_breakdown: { approved: number; pending: number; total: number };
  top_invoices: SalesStatsInvoice[];
  recent_invoices: SalesStatsInvoice[];
}

export interface SalesStatsInvoice {
  id: number;
  invoice_no: string;
  created_date: string;
  total: number;
  approval: boolean;
  customer_code: string;
}

// Paginated Response Types (for load balancing)
export interface PaginatedInvoices {
  items: Invoice[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface PaginatedSaleReturns {
  items: SaleReturn[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// Payment Method Options
export type PaymentMethod =
  | "cash"
  | "card_visa"
  | "card_mastercard"
  | "card_amex"
  | "card"
  | "cheque"
  | "bank_transfer"
  | "credit";

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "card_visa", label: "Visa Card" },
  { value: "card_mastercard", label: "Mastercard" },
  { value: "card_amex", label: "Amex Card" },
  { value: "card", label: "Card" },  // Generic card option - uses PaymentCard settings
  { value: "cheque", label: "Cheque" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "credit", label: "Credit" },
];


// =============================================================================
// Payment Card Types (for Card Settings)
// =============================================================================

export interface PaymentCard {
  id: number;
  card_name: string;
  card_type: "credit" | "debit";
  service_charge_percent: number;
  description?: string;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface PaymentCardCreate {
  card_name: string;
  card_type: "credit" | "debit";
  service_charge_percent: number;
  description?: string;
  active?: boolean;
}

export interface PaymentCardUpdate {
  card_name?: string;
  card_type?: "credit" | "debit";
  service_charge_percent?: number;
  description?: string;
  active?: boolean;
}
