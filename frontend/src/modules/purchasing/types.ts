// Supplier Types
export interface Supplier {
  id: number;
  title: string;
  full_name: string;
  company_name?: string;
  email?: string;
  mobile_contact_number: string;
  postal_address: string;
  credit_days: number;
  max_credit_limit: number;
  left_credit_amount?: number;
  active: boolean;
  country_id?: number;
  created_at: string;
  updated_at: string;
}

export interface SupplierCreate {
  title: string;
  full_name: string;
  company_name?: string;
  email?: string;
  mobile_contact_number: string;
  postal_address: string;
  permenent_address: string;
  credit_days: number;
  max_credit_limit: number;
  gender: string;
  civil_status: string;
  no_of_kids: string;
  active?: boolean;
  country_id?: number;
}

export interface SupplierUpdate {
  full_name?: string;
  company_name?: string;
  email?: string;
  mobile_contact_number?: string;
  postal_address?: string;
  credit_days?: number;
  max_credit_limit?: number;
  active?: boolean;
}

// Purchase Order Types
export interface PurchasingOrder {
  id: number;
  purchasing_order_no: string;
  purchasing_invoice_no: string;
  branch_code: string;
  payment_method: string;
  purchasing_order_date: string;
  good_received_note_date: string;
  remarks?: string;
  first_suppliers_id: number;
  second_suppliers_id: number;
  created_date: string;
}

export interface PurchasingOrderItem {
  id: number;
  quantity: number;
  unit_price: number;
  warrenty_month: string;
  remark?: string;
  product_id: number;
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
  first_suppliers_id: number;
  second_suppliers_id: number;
  items: Omit<PurchasingOrderItem, "id">[];
}

export interface PurchasingOrderUpdate {
  remarks?: string;
  payment_method?: string;
}

// Purchase Return Types
export interface PurchasingReturn {
  id: number;
  purchasing_return_no: string;
  branch_code: string;
  remark?: string;
  added_date: string;
  goodreceivednote_id: number;
}

export interface PurchasingReturnItem {
  id: number;
  purchasing_price: number;
  return_price: number;
  barcode: string;
  product_id: number;
}

export interface PurchasingReturnWithItems extends PurchasingReturn {
  items: PurchasingReturnItem[];
}

export interface PurchasingReturnCreate {
  purchasing_return_no: string;
  branch_code: string;
  remark?: string;
  goodreceivednote_id: number;
  items: Omit<PurchasingReturnItem, "id">[];
}
