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
}

export interface InvoiceUpdate {
  remarks?: string;
  status?: boolean;
  approval?: boolean;
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
}

export interface SaleReturnItemCreate {
  barcode: string;
  return_price: number;
  sold_price: number;
  branch_code: string;
  invoice_item_id?: number;
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
}

export interface SaleReturnCreate {
  sale_return_no: string;
  branch_code: string;
  invoice_id: number;
  good_received_locations_id: number;
  payment_method: string;
  remark?: string;
  items: SaleReturnItemCreate[];
}

export interface SaleReturnWithItems extends SaleReturn {
  items: SaleReturnItem[];
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
