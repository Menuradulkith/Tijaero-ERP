// ==================== Enums ====================

export type QuoteType = 'quotation' | 'proforma';

export type QuoteStatus =
  | 'draft'
  | 'pending_approval'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'converted'
  | 'converted_to_invoice'
  | 'po_created'
  | 'item_received'
  | 'so_created'
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
  is_price_estimate: boolean;
  stock_status?: string; // 'in_stock', 'needs_procurement', or null
  description?: string;
  remark?: string;
  discount_percentage: number;
}

export interface SalesQuoteItemCreate {
  product_id: number;
  quantity: number;
  selling_price: number;
  minimum_selling_price: number;
  warrenty_month: string;
  is_price_estimate?: boolean;
  description?: string;
  remark?: string;
  discount_percent: number;
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
  remarks?: string;
  customer_notes?: string;
  total_amount: number;

  converted_to_invoice_id?: number;
  converted_at?: string;
  converted_by?: number;

  // Workflow date tracking
  submitted_date?: string;
  po_created_date?: string;
  approved_date?: string;
  approved_by_customer?: string;
  rejection_date?: string;
  conversion_date?: string;
  linked_po_id?: number;

  // Revision tracking
  parent_quote_id?: number;
  revision_number: number;

  // Rejection
  rejection_reason?: string;

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
  remarks?: string;
  customer_notes?: string;
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
  remarks?: string;
  customer_notes?: string;
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
  submitted: 'Submitted',
  under_review: 'Under Review',
  approved: 'Approved',
  sent: 'Sent',
  accepted: 'Accepted',
  rejected: 'Rejected',
  expired: 'Expired',
  converted: 'Converted',
  converted_to_invoice: 'Converted to Invoice',
  po_created: 'PO Created',
  item_received: 'Item Received',
  so_created: 'SO Created',
  cancelled: 'Cancelled',
  revised: 'Revised',
};

export const QUOTE_STATUS_COLORS: Record<QuoteStatus, string> = {
  draft: 'gray',
  pending_approval: 'yellow',
  submitted: 'indigo',
  under_review: 'amber',
  approved: 'blue',
  sent: 'purple',
  accepted: 'green',
  rejected: 'red',
  expired: 'orange',
  converted: 'teal',
  converted_to_invoice: 'teal',
  po_created: 'cyan',
  item_received: 'teal',
  so_created: 'indigo',
  cancelled: 'red',
  revised: 'gray',
};

export const QUOTE_TYPE_LABELS: Record<QuoteType, string> = {
  quotation: 'Quotation',
  proforma: 'Proforma Invoice',
};

// ==================== Stock Availability Types ====================

export interface StockAvailabilityItem {
  product_id: number;
  product_name?: string;
  requested_quantity: number;
  available_quantity: number;
  is_sufficient: boolean;
}

export interface StockAvailabilityResponse {
  quote_id: number;
  branch_code: string;
  items: StockAvailabilityItem[];
  all_sufficient: boolean;
}

// ==================== Create PO from Quotation Types ====================

export interface CreatePOFromQuoteRequest {
  first_suppliers_id: number;
  second_suppliers_id: number;
  payment_method: string;
  purchasing_invoice_no: string;
  good_received_note_date: string;
  remarks?: string;
  credit_date?: number;
}

export interface CreatePOFromQuoteResponse {
  quote_id: number;
  quote_no: string;
  purchasing_order_id: number;
  purchasing_order_no: string;
  message: string;
}

// ==================== Toggle Proforma Types ====================

export interface ToggleProformaRequest {
  is_proforma: boolean;
}

export interface ToggleProformaResponse {
  quote_id: number;
  quote_no: string;
  is_proforma: boolean;
  quote_type: string;
  message: string;
}

// ==================== Reject Quote Types ====================

export interface RejectQuoteRequest {
  reason?: string;
  cancel_linked_po?: boolean;
}

// ==================== Customer Approval Types ====================

export interface CustomerApprovalRequest {
  approved_by_customer?: string;
  remarks?: string;
}
