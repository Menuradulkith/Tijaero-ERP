import apiClient from "@/api/client";
import {
  Supplier,
  SupplierCreate,
  SupplierUpdate,
  PurchasingOrder,
  PurchasingOrderWithItems,
  PurchasingOrderCreate,
  PurchasingOrderUpdate,
  PurchasingReturnWithItems,
  PurchasingReturnCreate,
  GoodReceivedNote,
  GoodReceivedNoteCreate,
  GoodReceivedItem,
  GoodReceivedItemCreate,
  SupplierCreditsSettle,
  SupplierCreditsSettleCreate,
  SupplierCreditsSettleWithTransactions,
} from "./types";

// Helper to clean empty strings to null/undefined for optional fields
const cleanSupplierData = (data: SupplierCreate | SupplierUpdate) => {
  return {
    ...data,
    name_in_cheque_card: data.name_in_cheque_card?.trim() || null,
    occupation: data.occupation?.trim() || null,
    company_name: data.company_name?.trim() || null,
    company_registration_number: data.company_registration_number?.trim() || null,
    company_postal_address: data.company_postal_address?.trim() || null,
    company_contact_number: data.company_contact_number?.trim() || null,
    company_website: data.company_website?.trim() || null,
    bank_details: data.bank_details?.trim() || null,
    birthdate: data.birthdate?.trim() || null,
    id_card_number: data.id_card_number?.trim() || null,
    passport_no: data.passport_no?.trim() || null,
    email: data.email?.trim() || null,
    home_contact_number: data.home_contact_number?.trim() || null,
  };
};

// Supplier API
export const suppliersApi = {
  getAll: async (params?: {
    active?: boolean;
    country_id?: number;
    search?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<Supplier[]>("/purchasing/suppliers", {
      params,
    });
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<Supplier>(
      `/purchasing/suppliers/${id}`
    );
    return response.data;
  },

  create: async (data: SupplierCreate) => {
    const cleanData = cleanSupplierData(data);
    const response = await apiClient.post<Supplier>(
      "/purchasing/suppliers",
      cleanData
    );
    return response.data;
  },

  update: async (id: number, data: SupplierUpdate) => {
    const cleanData = cleanSupplierData(data);
    const response = await apiClient.patch<Supplier>(
      `/purchasing/suppliers/${id}`,
      cleanData
    );
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/purchasing/suppliers/${id}`);
  },
};

// Purchase Orders API
export const purchaseOrdersApi = {
  getAll: async (params?: {
    status?: string;
    supplier_id?: number;
    branch_code?: string;
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<PurchasingOrder[]>(
      "/purchasing/orders",
      { params }
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<PurchasingOrderWithItems>(
      `/purchasing/orders/${id}`
    );
    return response.data;
  },

  create: async (data: PurchasingOrderCreate) => {
    const response = await apiClient.post<PurchasingOrderWithItems>(
      "/purchasing/orders",
      data
    );
    return response.data;
  },

  update: async (id: number, data: PurchasingOrderUpdate) => {
    const response = await apiClient.patch<PurchasingOrder>(
      `/purchasing/orders/${id}`,
      data
    );
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/purchasing/orders/${id}`);
  },

  getSupplierOrders: async (supplierId: number, skip = 0, limit = 100) => {
    const response = await apiClient.get<PurchasingOrder[]>(
      `/purchasing/suppliers/${supplierId}/orders`,
      { params: { skip, limit } }
    );
    return response.data;
  },
};

// Purchase Returns API
export const purchaseReturnsApi = {
  getAll: async (params?: {
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<PurchasingReturnWithItems[]>(
      "/purchasing/returns",
      { params }
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<PurchasingReturnWithItems>(
      `/purchasing/returns/${id}`
    );
    return response.data;
  },

  create: async (data: PurchasingReturnCreate) => {
    const response = await apiClient.post<PurchasingReturnWithItems>(
      "/purchasing/returns",
      data
    );
    return response.data;
  },
};

// Good Received Notes API
export const goodReceivedNotesApi = {
  getAll: async (params?: {
    branch_code?: string;
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<GoodReceivedNote[]>(
      "/purchasing/grn",
      { params }
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<GoodReceivedNote>(
      `/purchasing/grn/${id}`
    );
    return response.data;
  },

  create: async (data: GoodReceivedNoteCreate) => {
    const response = await apiClient.post<GoodReceivedNote>(
      "/purchasing/grn",
      data
    );
    return response.data;
  },

  update: async (id: number, data: Partial<GoodReceivedNoteCreate>) => {
    const response = await apiClient.patch<GoodReceivedNote>(
      `/purchasing/grn/${id}`,
      data
    );
    return response.data;
  },
};

// Good Received Items API
export const goodReceivedItemsApi = {
  getByGRN: async (grnId: number) => {
    const response = await apiClient.get<GoodReceivedItem[]>(
      `/purchasing/grn/${grnId}/items`
    );
    return response.data;
  },

  create: async (data: GoodReceivedItemCreate) => {
    const response = await apiClient.post<GoodReceivedItem>(
      "/purchasing/grn-items",
      data
    );
    return response.data;
  },
};

// Supplier Credits Settlement API
export const supplierCreditsSettleApi = {
  getAll: async (skip = 0, limit = 100) => {
    const response = await apiClient.get<SupplierCreditsSettle[]>(
      "/purchasing/credit-settlements",
      { params: { skip, limit } }
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<SupplierCreditsSettleWithTransactions>(
      `/purchasing/credit-settlements/${id}`
    );
    return response.data;
  },

  create: async (data: SupplierCreditsSettleCreate) => {
    const response = await apiClient.post<SupplierCreditsSettle>(
      "/purchasing/credit-settlements",
      data
    );
    return response.data;
  },

  getBySupplier: async (supplierId: number) => {
    const response = await apiClient.get<SupplierCreditsSettle[]>(
      `/purchasing/suppliers/${supplierId}/credit-settlements`
    );
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/purchasing/credit-settlements/${id}`);
  },
};

// ==================== SUPPLIER CREDIT MANAGEMENT API ====================

export interface SupplierCreditStatus {
  supplier_id: number;
  supplier_name: string;
  company_name: string | null;
  credit_days: number;
  max_credit_limit: number;
  initial_credit_amount: number;
  left_credit_amount: number;
  outstanding_payable: number;
  available_credit: number;
  overdue_count: number;
  total_overdue_amount: number;
  overdue_grns: {
    grn_id: number;
    grn_no: string;
    grn_date: string;
    supplier_invoice_no: string;
    due_date: string;
    days_overdue: number;
    remaining_amount: number;
  }[];
  unpaid_grns: {
    grn_id: number;
    grn_no: string;
    grn_date: string;
    supplier_invoice_no: string;
    due_date: string;
    days_overdue: number;
    is_overdue: boolean;
    remaining_amount: number;
  }[];
  credit_purchase_orders: {
    po_id: number;
    po_no: string;
    invoice_no: string;
    po_date: string;
    status: string;
    total_amount: number;
    settled_amount: number;
    remaining_amount: number;
    is_settled: boolean;
    has_grn: boolean;
    grn_id: number | null;
    grn_no: string | null;
    due_date: string;
    days_overdue: number;
    is_overdue: boolean;
    branch_code: string;
  }[];
}

export interface SupplierCreditCheckResult {
  allowed: boolean;
  current_outstanding: number;
  new_purchase_amount: number;
  new_total_outstanding: number;
  max_credit_limit: number;
  available_credit: number;
  will_exceed_limit: boolean;
  excess_amount: number;
  overdue_count: number;
  has_overdue: boolean;
  message: string;
}

export interface SupplierAgingReport {
  current: { count: number; amount: number };
  "1_30_days": { count: number; amount: number };
  "31_60_days": { count: number; amount: number };
  "61_90_days": { count: number; amount: number };
  over_90_days: { count: number; amount: number };
  total: { count: number; amount: number };
}

export interface SupplierStatement {
  supplier_id: number;
  supplier_name: string;
  company_name: string | null;
  from_date: string | null;
  to_date: string | null;
  credit_days: number;
  max_credit_limit: number;
  current_balance: number;
  statement_lines: {
    date: string;
    type: "PURCHASE" | "PAYMENT";
    reference: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
    due_date: string | null;
  }[];
}

export interface GrnPaymentHistory {
  grn_id: number;
  grn_no: string;
  grn_date: string;
  supplier_invoice_no: string;
  due_date: string;
  total_amount: number;
  total_paid: number;
  remaining: number;
  is_fully_paid: boolean;
  payments: {
    transaction_id: number;
    settlement_id: number;
    payment_date: string;
    payment_method: string;
    amount: number;
    reference: string;
    remarks: string | null;
  }[];
}

export const supplierCreditApi = {
  getCreditStatus: async (supplierId: number) => {
    const response = await apiClient.get<SupplierCreditStatus>(
      `/purchasing/suppliers/${supplierId}/credit-status`
    );
    return response.data;
  },

  checkCredit: async (
    supplierId: number,
    purchaseAmount: number,
    allowOverLimit = false
  ) => {
    const response = await apiClient.post<SupplierCreditCheckResult>(
      `/purchasing/suppliers/${supplierId}/credit-check`,
      null,
      { params: { purchase_amount: purchaseAmount, allow_over_limit: allowOverLimit } }
    );
    return response.data;
  },

  getAgingReport: async (supplierId: number) => {
    const response = await apiClient.get<SupplierAgingReport>(
      `/purchasing/suppliers/${supplierId}/aging-report`
    );
    return response.data;
  },

  getAllAgingReport: async () => {
    const response = await apiClient.get<SupplierAgingReport>(
      "/purchasing/reports/payables-aging"
    );
    return response.data;
  },

  getStatement: async (
    supplierId: number,
    fromDate?: string,
    toDate?: string
  ) => {
    const response = await apiClient.get<SupplierStatement>(
      `/purchasing/suppliers/${supplierId}/statement`,
      { params: { from_date: fromDate, to_date: toDate } }
    );
    return response.data;
  },

  getGrnPaymentHistory: async (grnId: number) => {
    const response = await apiClient.get<GrnPaymentHistory>(
      `/purchasing/grn/${grnId}/payment-history`
    );
    return response.data;
  },
};
