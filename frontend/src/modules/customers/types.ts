export interface Customer {
  id: number;
  customer_name: string;
  title: string;
  email?: string;
  mobile_contact_number: string;
  home_contact_number?: string;
  company_name?: string;
  occupation?: string;
  gender: string;
  civil_status: string;
  no_of_kids: string;
  birthdate?: string;
  id_card_number?: string;
  passport_no?: string;
  payment_address?: string;
  delivery_address?: string;
  bank_details?: string;
  name_in_cheque_card?: string;
  credit_days: number;
  max_credit_limit: number;
  left_credit_amount?: number;
  initial_credit_amount?: number;
  active: boolean;
  is_customer_agent: boolean;
  country_id?: number;
  date_joined: string;
  created_at: string;
  updated_at: string;
  created_by?: number;
  updated_by?: number;
}

export interface CustomerCreate {
  customer_name: string;
  title: string;
  email?: string;
  mobile_contact_number: string;
  home_contact_number?: string;
  company_name?: string;
  occupation?: string;
  gender: string;
  civil_status: string;
  no_of_kids: string;
  birthdate?: string;
  id_card_number?: string;
  passport_no?: string;
  payment_address?: string;
  delivery_address?: string;
  bank_details?: string;
  name_in_cheque_card?: string;
  credit_days?: number;
  max_credit_limit?: number;
  left_credit_amount?: number;
  initial_credit_amount?: number;
  active?: boolean;
  is_customer_agent?: boolean;
  country_id?: number;
}

export interface CustomerUpdate {
  customer_name?: string;
  title?: string;
  email?: string;
  mobile_contact_number?: string;
  home_contact_number?: string;
  company_name?: string;
  occupation?: string;
  gender?: string;
  civil_status?: string;
  no_of_kids?: string;
  birthdate?: string;
  id_card_number?: string;
  passport_no?: string;
  payment_address?: string;
  delivery_address?: string;
  bank_details?: string;
  name_in_cheque_card?: string;
  credit_days?: number;
  max_credit_limit?: number;
  left_credit_amount?: number;
  initial_credit_amount?: number;
  active?: boolean;
  is_customer_agent?: boolean;
  country_id?: number;
}


// Customer Advance Payments Types
export interface CustomerAdvancePayments {
  id: number;
  advance_payments_no: string;
  payment_method: string;
  branch_code: string;
  payment_amount: number;
  remarks?: string;
  created_date: string;
  customer_id: number;
  cheque_date: string;
  active: boolean;
}

export interface CustomerAdvancePaymentsCreate {
  advance_payments_no: string;
  payment_method: string;
  branch_code: string;
  payment_amount: number;
  remarks?: string;
  customer_id: number;
  cheque_date: string;
  active?: boolean;
}

export interface CustomerAdvancePaymentsUpdate {
  payment_method?: string;
  branch_code?: string;
  payment_amount?: number;
  remarks?: string;
  cheque_date?: string;
  active?: boolean;
}


// Customer Credit Notes Types
export interface CustomerCreditNotes {
  id: number;
  customer_id: number;
  date: string;
  amount: number;
  remark: string;
  invoice_no?: string;
}

export interface CustomerCreditNotesCreate {
  customer_id: number;
  amount: number;
  remark: string;
  invoice_no?: string;
}


// Customer Credits Settle Types
export interface CustomerCreditsSettleTransaction {
  id: number;
  payment_method: string;
  cheque_date: string;
  payment_amount: number;
  payment_method_number?: string;
  remarks?: string;
  created_date: string;
  customer_credit_settle_id: number;
  invoice_id: number;
}

export interface CustomerCreditsSettleTransactionCreate {
  payment_method: string;
  cheque_date: string;
  payment_amount: number;
  payment_method_number?: string;
  remarks?: string;
  invoice_id: number;
}

export interface CustomerCreditsSettle {
  id: number;
  customer_credits_settle_no: string;
  branch_code: string;
  created_date: string;
  customer_id: number;
}

export interface CustomerCreditsSettleCreate {
  customer_credits_settle_no: string;
  branch_code: string;
  customer_id: number;
  transactions: CustomerCreditsSettleTransactionCreate[];
}

export interface CustomerCreditsSettleWithTransactions extends CustomerCreditsSettle {
  transactions: CustomerCreditsSettleTransaction[];
}


// Customer Coupon Codes Types
export interface CustomerCuponCodes {
  id: number;
  cupon_code: string;
  description?: string;
  discount_type: 'PERCENT' | 'AMOUNT';
  discount_value: number;
  minimum_invoice_amount: number;
  limit_by_usage: number;
  limit_for_customer: number;
  valid_until_date: string;
  active: boolean;
  limit_validity_product_id?: number;
  product_ids?: number[];
  created_date: string;
  usage_count: number;
}

export interface CustomerCuponCodesCreate {
  cupon_code: string;
  description?: string;
  discount_type: 'PERCENT' | 'AMOUNT';
  discount_value: number;
  minimum_invoice_amount?: number;
  limit_by_usage?: number;
  limit_for_customer?: number;
  valid_until_date: string;
  active?: boolean;
  limit_validity_product_id?: number;
  product_ids?: number[];
}

export interface CustomerCuponCodesUpdate {
  cupon_code?: string;
  description?: string;
  discount_type?: 'PERCENT' | 'AMOUNT';
  discount_value?: number;
  minimum_invoice_amount?: number;
  limit_by_usage?: number;
  limit_for_customer?: number;
  valid_until_date?: string;
  active?: boolean;
  limit_validity_product_id?: number;
  product_ids?: number[];
}

export interface CouponUsage {
  id: number;
  coupon_id: number;
  customer_id: number;
  invoice_id: number;
  discount_amount: number;
  used_date: string;
  invoice_no?: string;
  customer_name?: string;
}

export interface CouponValidationRequest {
  coupon_code: string;
  customer_id: number;
  invoice_subtotal: number;
  product_ids?: number[];
  category_ids?: number[];
  line_items?: Array<{
    product_id: number;
    quantity: number;
    selling_price: number;
  }>;
}

export interface CouponValidationResponse {
  valid: boolean;
  coupon_id?: number;
  discount_type?: 'PERCENT' | 'AMOUNT';
  discount_value?: number;
  calculated_discount?: number;
  message: string;
}


// Customer Gift Voucher Types
export interface CustomerGiftVoucher {
  id: number;
  date: string;
  amount: number;
  barcode_no: number;
  valid_period_in_months: number;
  claimed_date?: string;
  purchased_invoice_no?: string;
  claimed_invoice_no?: string;
}

export interface CustomerGiftVoucherCreate {
  date: string;
  amount: number;
  barcode_no: number;
  valid_period_in_months?: number;
  purchased_invoice_no?: string;
}

export interface CustomerGiftVoucherUpdate {
  claimed_date?: string;
  claimed_invoice_no?: string;
}


// Customer Support Types
export interface CustomerCallLog {
  id: number;
  date: string;
  contact_person?: string;
  comment?: string;
  customer_support_id?: number;
}

export interface CustomerCallLogCreate {
  contact_person?: string;
  comment?: string;
  customer_support_id?: number;
}

export interface CustomerSupport {
  id: number;
  job_number: string;
  job_type: string;
  date: string;
  job_description?: string;
  contact_person: string;
  branch_code: string;
  assigned_user_id: number;
  customer_id?: number;
  invoice_id?: number;
}

export interface CustomerSupportCreate {
  job_number: string;
  job_type: string;
  date: string;
  job_description?: string;
  contact_person: string;
  branch_code: string;
  assigned_user_id: number;
  customer_id?: number;
  invoice_id?: number;
}

export interface CustomerSupportUpdate {
  job_type?: string;
  date?: string;
  job_description?: string;
  contact_person?: string;
  branch_code?: string;
  assigned_user_id?: number;
  customer_id?: number;
  invoice_id?: number;
}

export interface CustomerSupportWithCallLogs extends CustomerSupport {
  call_logs: CustomerCallLog[];
}
