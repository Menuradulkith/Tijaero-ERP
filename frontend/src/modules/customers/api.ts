import apiClient from "@/api/client";
import {
  Customer,
  CustomerCreate,
  CustomerUpdate,
  CustomerCreditsSettle,
  CustomerCreditsSettleCreate,
  CustomerCreditsSettleWithTransactions,
  CustomerCuponCodes,
  CustomerCuponCodesCreate,
  CustomerCuponCodesUpdate,
  CouponUsage,
  CouponValidationRequest,
  CouponValidationResponse,
  CustomerGiftVoucher,
  CustomerGiftVoucherCreate,
  CustomerGiftVoucherUpdate,
  VoucherValidationRequest,
  VoucherValidationResponse,
  VoucherRedeemRequest,
  VoucherRedeemResponse,
  VoucherUsage,
} from "./types";

// Type definitions for credit management responses
export interface CustomerCreditSummary {
  customer_id: number;
  customer_name: string;
  credit_days: number;
  max_credit_limit: number;
  initial_credit_amount: number;
  left_credit_amount: number;
  outstanding_credit: number;
  available_credit: number;
  overdue_count: number;
  total_overdue_amount: number;
  overdue_invoices: {
    invoice_id: number;
    invoice_no: string;
    invoice_date: string;
    due_date: string;
    days_overdue: number;
    credit_amount: number;
    remaining_amount: number;
  }[];
}

export interface CreditCheckResult {
  allowed: boolean;
  current_outstanding: number;
  new_credit_amount: number;
  new_total_outstanding: number;
  max_credit_limit: number;
  available_credit: number;
  will_exceed_limit: boolean;
  excess_amount: number;
  overdue_count: number;
  has_overdue: boolean;
  message: string;
}

// Comprehensive credit sale validation result
export interface CreditSaleValidationResult {
  allowed: boolean;
  time_check: {
    allowed: boolean;
    current_time: string;
    current_hour: number;
    allowed_start: string;
    allowed_end: string;
    message: string;
  } | null;
  customer_check: {
    valid: boolean;
    customer_id: number;
    customer_name: string;
    active: boolean;
    has_phone: boolean;
    has_email: boolean;
    has_address: boolean;
    errors: string[];
    warnings: string[];
  } | null;
  credit_check: {
    current_outstanding: number;
    new_credit_amount: number;
    new_total_outstanding: number;
    max_credit_limit: number;
    available_credit: number;
    will_exceed_limit: boolean;
    excess_amount: number;
    overdue_count: number;
    total_overdue_amount: number;
    has_overdue: boolean;
  } | null;
  errors: string[];
  warnings: string[];
}

export interface AgingReport {
  current: { count: number; amount: number };
  "1_30_days": { count: number; amount: number };
  "31_60_days": { count: number; amount: number };
  "61_90_days": { count: number; amount: number };
  over_90_days: { count: number; amount: number };
  total: { count: number; amount: number };
}

export interface CustomerStatement {
  customer_id: number;
  customer_name: string;
  from_date: string | null;
  to_date: string | null;
  credit_days: number;
  max_credit_limit: number;
  current_balance: number;
  statement_lines: {
    date: string;
    type: "SALE" | "PAYMENT";
    reference: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
    due_date: string | null;
  }[];
}

// Helper to clean empty strings to null for optional fields
const cleanCustomerData = (data: CustomerCreate | CustomerUpdate) => {
  return {
    ...data,
    email: data.email?.trim() || null,
    home_contact_number: data.home_contact_number?.trim() || null,
    company_name: data.company_name?.trim() || null,
    occupation: data.occupation?.trim() || null,
    birthdate: data.birthdate?.trim() || null,
    id_card_number: data.id_card_number?.trim() || null,
    passport_no: data.passport_no?.trim() || null,
    payment_address: data.payment_address?.trim() || null,
    delivery_address: data.delivery_address?.trim() || null,
    bank_details: data.bank_details?.trim() || null,
    name_in_cheque_card: data.name_in_cheque_card?.trim() || null,
  };
};

export const customersApi = {
  getAll: async (skip = 0, limit = 100000, activeOnly = true) => {
    const response = await apiClient.get<Customer[]>("/customers/", {
      params: { skip, limit, active_only: activeOnly },
    });
    return response.data;
  },

  search: async (query: string, skip = 0, limit = 100000, activeOnly = true) => {
    const response = await apiClient.get<Customer[]>("/customers/search", {
      params: { q: query, skip, limit, active_only: activeOnly },
    });
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<Customer>(`/customers/${id}`);
    return response.data;
  },

  create: async (data: CustomerCreate) => {
    const cleanData = cleanCustomerData(data);
    const response = await apiClient.post<Customer>("/customers/", cleanData);
    return response.data;
  },

  update: async (id: number, data: CustomerUpdate) => {
    const cleanData = cleanCustomerData(data);
    const response = await apiClient.put<Customer>(`/customers/${id}`, cleanData);
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/customers/${id}`);
  },

  // ==================== CREDIT MANAGEMENT ====================

  getCreditSummary: async (customerId: number) => {
    const response = await apiClient.get<CustomerCreditSummary>(
      `/customers/${customerId}/credit-summary`
    );
    return response.data;
  },

  checkCredit: async (
    customerId: number,
    saleAmount: number,
    allowOverLimit = false
  ) => {
    const response = await apiClient.post<CreditCheckResult>(
      `/customers/${customerId}/credit-check`,
      null,
      { params: { sale_amount: saleAmount, allow_over_limit: allowOverLimit } }
    );
    return response.data;
  },

  /**
   * Comprehensive credit sale validation.
   * Checks time restriction, customer eligibility, and credit limits.
   */
  validateCreditSale: async (
    customerId: number,
    saleAmount: number,
    options?: { skipTimeCheck?: boolean; allowOverLimit?: boolean }
  ) => {
    const response = await apiClient.post<CreditSaleValidationResult>(
      `/customers/${customerId}/credit-sale-validation`,
      null,
      { 
        params: { 
          sale_amount: saleAmount, 
          skip_time_check: options?.skipTimeCheck ?? false,
          allow_over_limit: options?.allowOverLimit ?? false 
        } 
      }
    );
    return response.data;
  },

  getAgingReport: async (customerId: number) => {
    const response = await apiClient.get<AgingReport>(
      `/customers/${customerId}/aging-report`
    );
    return response.data;
  },

  getAllAgingReport: async () => {
    const response = await apiClient.get<AgingReport>("/customers/reports/aging");
    return response.data;
  },

  getStatement: async (
    customerId: number,
    fromDate?: string,
    toDate?: string
  ) => {
    const response = await apiClient.get<CustomerStatement>(
      `/customers/${customerId}/statement`,
      { params: { from_date: fromDate, to_date: toDate } }
    );
    return response.data;
  },

  // ==================== CREDIT SETTLEMENTS ====================

  createCreditSettlement: async (
    customerId: number,
    data: CustomerCreditsSettleCreate
  ) => {
    const response = await apiClient.post<CustomerCreditsSettle>(
      `/customers/${customerId}/credit-settlements`,
      data
    );
    return response.data;
  },

  getCreditSettlements: async (customerId: number, skip = 0, limit = 100000) => {
    const response = await apiClient.get<CustomerCreditsSettle[]>(
      `/customers/${customerId}/credit-settlements`,
      { params: { skip, limit } }
    );
    return response.data;
  },

  getCreditSettlement: async (customerId: number, settlementId: number) => {
    const response = await apiClient.get<CustomerCreditsSettleWithTransactions>(
      `/customers/${customerId}/credit-settlements/${settlementId}`
    );
    return response.data;
  },

  getPaymentReport: async (params?: {
    date_from?: string;
    date_to?: string;
    customer_id?: number;
    branch_code?: string;
  }) => {
    const response = await apiClient.get<CustomerPaymentReport>(
      "/customers/payments/report",
      { params }
    );
    return response.data;
  },

  getOutstandingDocuments: async (params?: {
    customer_id?: number;
    branch_code?: string;
  }) => {
    const response = await apiClient.get<OutstandingDocumentsReport>(
      "/customers/outstanding-documents",
      { params }
    );
    return response.data;
  },
};

// Customer payment report types
export interface CustomerPaymentReportItem {
  id: number;
  date: string;
  customer_id: number;
  customer_name: string;
  document_no: string;
  invoice_refs: string;
  payment_method: string;
  amount: number;
  branch_code: string;
  remarks: string;
}

export interface CustomerPaymentReportSummary {
  total_amount: number;
  total_count: number;
  credit_settlements: number;
  credit_settlements_count: number;
}

export interface CustomerPaymentReport {
  items: CustomerPaymentReportItem[];
  summary: CustomerPaymentReportSummary;
}

// Outstanding Documents types
export interface OutstandingDocumentItem {
  invoice_id: number;
  invoice_no: string;
  invoice_date: string;
  customer_id: number;
  customer_name: string;
  credit_amount: number;
  paid_amount: number;
  balance_due: number;
  due_date: string;
  days_overdue: number;
  is_overdue: boolean;
  branch_code: string;
}

export interface OutstandingDocumentSummary {
  total_documents: number;
  total_outstanding: number;
  total_overdue: number;
  overdue_count: number;
}

export interface OutstandingDocumentsReport {
  items: OutstandingDocumentItem[];
  summary: OutstandingDocumentSummary;
}


// ==================== COUPON API ====================

export const couponsApi = {
  getAll: async (skip = 0, limit = 100000, activeOnly = false) => {
    const response = await apiClient.get<CustomerCuponCodes[]>("/customers/coupons/", {
      params: { skip, limit, active_only: activeOnly },
    });
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<CustomerCuponCodes>(`/customers/coupons/${id}`);
    return response.data;
  },

  getByCode: async (code: string) => {
    const response = await apiClient.get<CustomerCuponCodes>(`/customers/coupons/code/${code}`);
    return response.data;
  },

  create: async (data: CustomerCuponCodesCreate) => {
    const response = await apiClient.post<CustomerCuponCodes>("/customers/coupons/", data);
    return response.data;
  },

  update: async (id: number, data: CustomerCuponCodesUpdate) => {
    const response = await apiClient.put<CustomerCuponCodes>(`/customers/coupons/${id}`, data);
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/customers/coupons/${id}`);
  },

  validate: async (request: CouponValidationRequest) => {
    const response = await apiClient.post<CouponValidationResponse>(
      "/customers/coupons/validate",
      request
    );
    return response.data;
  },

  getUsageHistory: async (couponId: number, skip = 0, limit = 100000) => {
    const response = await apiClient.get<CouponUsage[]>(
      `/customers/coupons/${couponId}/usage`,
      { params: { skip, limit } }
    );
    return response.data;
  },
};


// ==================== GIFT VOUCHER API ====================

export const vouchersApi = {
  getAll: async (skip = 0, limit = 100000, activeOnly = false) => {
    const response = await apiClient.get<CustomerGiftVoucher[]>("/customers/vouchers/", {
      params: { skip, limit, active_only: activeOnly },
    });
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<CustomerGiftVoucher>(`/customers/vouchers/${id}`);
    return response.data;
  },

  getByBarcode: async (barcodeNo: string) => {
    const response = await apiClient.get<CustomerGiftVoucher>(`/customers/vouchers/barcode/${barcodeNo}`);
    return response.data;
  },

  create: async (data: CustomerGiftVoucherCreate) => {
    const response = await apiClient.post<CustomerGiftVoucher>("/customers/vouchers/", data);
    return response.data;
  },

  update: async (id: number, data: CustomerGiftVoucherUpdate) => {
    const response = await apiClient.put<CustomerGiftVoucher>(`/customers/vouchers/${id}`, data);
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/customers/vouchers/${id}`);
  },

  validate: async (request: VoucherValidationRequest) => {
    const response = await apiClient.post<VoucherValidationResponse>(
      "/customers/vouchers/validate",
      request
    );
    return response.data;
  },

  redeem: async (request: VoucherRedeemRequest) => {
    const response = await apiClient.post<VoucherRedeemResponse>(
      "/customers/vouchers/redeem",
      request
    );
    return response.data;
  },

  getUsageHistory: async (voucherId: number, skip = 0, limit = 100000) => {
    const response = await apiClient.get<VoucherUsage[]>(
      `/customers/vouchers/${voucherId}/usage`,
      { params: { skip, limit } }
    );
    return response.data;
  },
};
