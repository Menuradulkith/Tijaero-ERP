// Customer Support Types
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

// CS Job Item Types
export interface CSJobItem {
  id: number;
  date: string;
  fault_type: string;
  job_status: string;
  quantity?: number;
  active: boolean;
  comment?: string;
  customer_support_id: number;
  product_id: number;
  warrent_claim_id?: number;
}

export interface CSJobItemCreate {
  fault_type: string;
  job_status: string;
  quantity?: number;
  active: boolean;
  comment?: string;
  customer_support_id: number;
  product_id: number;
  warrent_claim_id?: number;
}

// Customer Call Log Types
export interface CustomerCallLog {
  id: number;
  date: string;
  contact_person?: string;
  comment?: string;
  customer_support_id: number;
}

export interface CustomerCallLogCreate {
  contact_person?: string;
  comment?: string;
  customer_support_id: number;
}

// Warranty Claim Types
export interface WarrantyClaim {
  id: number;
  warranty_type: string;
  warranty_status: string;
  product_barcode_old_code: string;
  product_barcode_new_code?: string;
  comment?: string;
  created_date: string;
  order_id: number;
  supplier_warrenty_claims: boolean;
}

export interface WarrantyClaimCreate {
  warranty_type: string;
  warranty_status: string;
  product_barcode_old_code: string;
  product_barcode_new_code?: string;
  comment?: string;
  order_id: number;
  supplier_warrenty_claims: boolean;
}
