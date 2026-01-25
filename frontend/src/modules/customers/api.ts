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
  getAll: async (skip = 0, limit = 100) => {
    const response = await apiClient.get<Customer[]>("/customers/", {
      params: { skip, limit },
    });
    return response.data;
  },

  search: async (query: string, skip = 0, limit = 100) => {
    const response = await apiClient.get<Customer[]>("/customers/search", {
      params: { q: query, skip, limit },
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

  getCreditSettlements: async (customerId: number, skip = 0, limit = 100) => {
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
};


// ==================== COUPON API ====================

export const couponsApi = {
  getAll: async (skip = 0, limit = 100, activeOnly = false) => {
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

  getUsageHistory: async (couponId: number, skip = 0, limit = 100) => {
    const response = await apiClient.get<CouponUsage[]>(
      `/customers/coupons/${couponId}/usage`,
      { params: { skip, limit } }
    );
    return response.data;
  },
};
