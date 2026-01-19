export interface InvoiceItem {
  id: number;
  product_id: number;
  quantity: number;
  selling_price: number;
  minimum_selling_price: number;
  warrenty_month: string;
  invoice_id: number;
  created_date: string;
}

export interface InvoiceItemCreate {
  product_id: number;
  quantity: number;
  selling_price: number;
  minimum_selling_price: number;
  warrenty_month: string;
}

export interface Invoice {
  id: number;
  invoice_no: string;
  branch_code: string;
  customer_id: number;
  sale_rep_id: number;
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
  // Cheque payment details
  cheque_number?: string;
  cheque_bank?: string;
  cheque_date?: string;
  // Card payment details
  card_ref_number?: string;
  card_holder_name?: string;
  // Bank transfer details
  bank_transfer_ref?: string;
  bank_name?: string;
  // Credit note
  credit_note_id?: number;
  // Tax and discount
  tax_rate?: number;
  discount_percent?: number;
  discount_amount?: number;
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
  totalOrders: number;
  totalRevenue: number;
  currentMonthOrders: number;
  currentMonthRevenue: number;
  pendingApproval: number;
  saleReturnsCount: number;
}

// Payment Method Options
export type PaymentMethod =
  | "cash"
  | "card_visa"
  | "card_mastercard"
  | "card_amex"
  | "cheque"
  | "bank_transfer"
  | "credit";

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "card_visa", label: "Visa Card" },
  { value: "card_mastercard", label: "Mastercard" },
  { value: "card_amex", label: "Amex Card" },
  { value: "cheque", label: "Cheque" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "credit", label: "Credit" },
];
