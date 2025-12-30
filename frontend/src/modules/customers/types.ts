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
