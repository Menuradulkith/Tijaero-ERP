// ==================== Enums ====================

export type QuoteType = 'quotation' | 'proforma';

export type QuoteStatus = 
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'converted'
  | 'cancelled'
  | 'revised';

export type DiscountType = 'none' | 'percentage' | 'fixed';

// ==================== Quote Item Types ====================

export interface SalesQuoteItem {
  id: number;
  quote_id: number;
  product_id: number;
  quantity: number;
  selling_price: number;
  minimum_selling_price: number;
  warrenty_month: string;
  created_date: string;
  
  // Quote specific
  min_price?: number;
  max_price?: number;
  is_price_estimate: boolean;
  description?: string;
  discount_percent: number;
  tax_rate: number;
  line_total: number;
  remark?: string;
}

export interface SalesQuoteItemCreate {
  product_id: number;
  quantity: number;
  selling_price: number;
  minimum_selling_price: number;
  warrenty_month: string;
  min_price?: number;
  max_price?: number;
  is_price_estimate?: boolean;
  description?: string;
  discount_percent?: number;
  tax_rate?: number;
  remark?: string;
}

export interface SalesQuoteItemWithProduct extends SalesQuoteItem {
  product_name?: string;
  product_code?: string;
}

// ==================== Quote Types ====================

export interface SalesQuote {
  id: number;
  quote_no: string;
  quote_type: QuoteType;
  branch_code: string;
  customer_id: number;
  sale_rep_id: number;
  customer_agent_id?: number;
  
  created_date: string;
  created_date_time: string;
  valid_until: string;
  expected_delivery_date?: string;
  
  status: QuoteStatus;
  approval: boolean;
  approval_id?: number;
  special: boolean;
  sys_code?: number;
  
  is_estimate: boolean;
  revision_number: number;
  parent_quote_id?: number;
  
  payment_terms?: string;
  delivery_terms?: string;
  
  remarks?: string;
  customer_notes?: string;
  terms_conditions?: string;
  
  discount_type: DiscountType;
  discount_value: number;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  
  converted_to_invoice_id?: number;
  converted_at?: string;
  converted_by?: number;
  
  created_at: string;
  updated_at: string;
}

export interface SalesQuoteWithItems extends SalesQuote {
  items: SalesQuoteItem[];
}

export interface SalesQuoteDetail extends SalesQuoteWithItems {
  customer_name?: string;
  customer_agent_name?: string;
  sale_rep_name?: string;
  converted_invoice_no?: string;
}

// ==================== Create/Update Types ====================

export interface SalesQuoteCreate {
  quote_type: QuoteType;
  branch_code: string;
  customer_id: number;
  sale_rep_id: number;
  customer_agent_id?: number;
  valid_until: string;
  expected_delivery_date?: string;
  
  is_estimate?: boolean;
  payment_terms?: string;
  delivery_terms?: string;
  
  remarks?: string;
  customer_notes?: string;
  terms_conditions?: string;
  
  discount_type?: DiscountType;
  discount_value?: number;
  special?: boolean;
  
  items: SalesQuoteItemCreate[];
}

export interface SalesQuoteUpdate {
  branch_code?: string;
  customer_id?: number;
  sale_rep_id?: number;
  customer_agent_id?: number;
  valid_until?: string;
  expected_delivery_date?: string;
  
  is_estimate?: boolean;
  payment_terms?: string;
  delivery_terms?: string;
  
  remarks?: string;
  customer_notes?: string;
  terms_conditions?: string;
  
  discount_type?: DiscountType;
  discount_value?: number;
  special?: boolean;
  
  items?: SalesQuoteItemCreate[];
}

export interface SalesQuoteStatusUpdate {
  status: QuoteStatus;
  remarks?: string;
}

// ==================== Conversion Types ====================

export interface ConvertToInvoiceRequest {
  payment_method: string;
  cash_amount?: number;
  card_visa_amount?: number;
  card_mastercard_amount?: number;
  card_amex_amount?: number;
  cheque_amount?: number;
  cheque_date?: string;
  bank_transfer_amount?: number;
  credit_amount?: number;
  payment_adjustments?: number;
  remarks?: string;
}

export interface ConvertToInvoiceResponse {
  quote_id: number;
  quote_no: string;
  invoice_id: number;
  invoice_no: string;
  message: string;
}

export interface CreateRevisionRequest {
  remarks?: string;
}

export interface CreateRevisionResponse {
  original_quote_id: number;
  original_quote_no: string;
  new_quote_id: number;
  new_quote_no: string;
  revision_number: number;
  message: string;
}

// ==================== List/Filter Types ====================

export interface SalesQuoteList {
  items: SalesQuote[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

export interface SalesQuoteFilter {
  quote_type?: QuoteType;
  status?: QuoteStatus;
  customer_id?: number;
  sale_rep_id?: number;
  branch_code?: string;
  date_from?: string;
  date_to?: string;
  is_expired?: boolean;
  search?: string;
}

// ==================== Status Display Helpers ====================

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  sent: 'Sent',
  accepted: 'Accepted',
  rejected: 'Rejected',
  expired: 'Expired',
  converted: 'Converted',
  cancelled: 'Cancelled',
  revised: 'Revised',
};

export const QUOTE_STATUS_COLORS: Record<QuoteStatus, string> = {
  draft: 'gray',
  pending_approval: 'yellow',
  approved: 'blue',
  sent: 'purple',
  accepted: 'green',
  rejected: 'red',
  expired: 'orange',
  converted: 'teal',
  cancelled: 'red',
  revised: 'gray',
};

export const QUOTE_TYPE_LABELS: Record<QuoteType, string> = {
  quotation: 'Quotation',
  proforma: 'Proforma Invoice',
};
