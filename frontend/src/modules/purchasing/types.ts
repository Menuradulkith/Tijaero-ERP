// Supplier Types
export interface Supplier {
  id: number;
  title: string;
  full_name: string;
  name_in_cheque_card?: string;
  occupation?: string;
  company_name?: string;
  company_registration_number?: string;
  company_postal_address?: string;
  company_contact_number?: string;
  company_website?: string;
  postal_address: string;
  permenent_address: string;
  bank_details?: string;
  birthdate?: string;
  id_card_number?: string;
  gender: string;
  civil_status: string;
  passport_no?: string;
  no_of_kids: string;
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
}

export interface SupplierCreate {
  title: string;
  full_name: string;
  name_in_cheque_card?: string;
  occupation?: string;
  company_name?: string;
  company_registration_number?: string;
  company_postal_address?: string;
  company_contact_number?: string;
  company_website?: string;
  postal_address: string;
  permenent_address: string;
  bank_details?: string;
  birthdate?: string;
  id_card_number?: string;
  gender: string;
  civil_status: string;
  passport_no?: string;
  no_of_kids: string;
  email?: string;
  home_contact_number?: string;
  mobile_contact_number: string;
  credit_days: number;
  max_credit_limit: number;
  active?: boolean;
  country_id?: number;
}

export interface SupplierUpdate {
  title?: string;
  full_name?: string;
  name_in_cheque_card?: string;
  occupation?: string;
  company_name?: string;
  company_registration_number?: string;
  company_postal_address?: string;
  company_contact_number?: string;
  company_website?: string;
  postal_address?: string;
  permenent_address?: string;
  bank_details?: string;
  birthdate?: string;
  id_card_number?: string;
  gender?: string;
  civil_status?: string;
  passport_no?: string;
  no_of_kids?: string;
  email?: string;
  home_contact_number?: string;
  mobile_contact_number?: string;
  credit_days?: number;
  max_credit_limit?: number;
  active?: boolean;
  country_id?: number;
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
  purchasing_invoice_no: string;
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
  status: string;
  total_amount: number;
  paid_amount: number;
}

export interface PurchasingOrderWithItems extends PurchasingOrder {
  items: PurchasingOrderItem[];
}

export interface PurchasingOrderCreate {
  purchasing_order_no: string;
  purchasing_invoice_no: string;
  branch_code: string;
  payment_method: string;
  purchasing_order_date: string;
  good_received_note_date: string;
  remarks?: string;
  credit_date?: number;
  first_suppliers_id: number;
  second_suppliers_id: number;
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
export interface PurchasingReturnItem {
  id: number;
  product_id: number;
  purchasing_price: number;
  return_price: number;
  barcode: string;
  purchasingreturn_id: number;
  branch_code: string;
  added_date: string;
}

export interface PurchasingReturnItemCreate {
  product_id: number;
  purchasing_price: number;
  return_price: number;
  barcode: string;
}

export interface PurchasingReturn {
  id: number;
  purchasing_return_no: string;
  branch_code: string;
  remark?: string;
  goodreceivednote_id: number;
  added_date: string;
  approval_id?: number;
}

export interface PurchasingReturnWithItems extends PurchasingReturn {
  items: PurchasingReturnItem[];
}

export interface PurchasingReturnCreate {
  purchasing_return_no: string;
  branch_code: string;
  remark?: string;
  goodreceivednote_id: number;
  items: PurchasingReturnItemCreate[];
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
