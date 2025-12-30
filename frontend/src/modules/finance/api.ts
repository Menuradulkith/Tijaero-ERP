import apiClient from "@/api/client";
import {
  BankDeposit,
  BankDepositCreate,
  CardPayment,
  CardPaymentCreate,
  ChequePayment,
  ChequePaymentCreate,
  Expense,
  ExpenseCreate,
  CustomerAdvancePayment,
  CustomerAdvancePaymentCreate,
  CustomerCreditNote,
  CustomerCreditNoteCreate,
} from "./types";

// Bank Deposits API
export const bankDepositsApi = {
  getAll: async (params?: {
    branch_code?: string;
    verified?: boolean;
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<BankDeposit[]>(
      "/finance/bank-deposits",
      { params }
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<BankDeposit>(
      `/finance/bank-deposits/${id}`
    );
    return response.data;
  },

  create: async (data: BankDepositCreate) => {
    const response = await apiClient.post<BankDeposit>(
      "/finance/bank-deposits",
      data
    );
    return response.data;
  },

  verify: async (id: number) => {
    const response = await apiClient.patch<BankDeposit>(
      `/finance/bank-deposits/${id}/verify`
    );
    return response.data;
  },
};

// Card Payments API
export const cardPaymentsApi = {
  getAll: async (params?: {
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<CardPayment[]>(
      "/finance/card-payments",
      { params }
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<CardPayment>(
      `/finance/card-payments/${id}`
    );
    return response.data;
  },

  create: async (data: CardPaymentCreate) => {
    const response = await apiClient.post<CardPayment>(
      "/finance/card-payments",
      data
    );
    return response.data;
  },
};

// Cheque Payments API
export const chequePaymentsApi = {
  getAll: async (params?: {
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<ChequePayment[]>(
      "/finance/cheque-payments",
      { params }
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<ChequePayment>(
      `/finance/cheque-payments/${id}`
    );
    return response.data;
  },

  create: async (data: ChequePaymentCreate) => {
    const response = await apiClient.post<ChequePayment>(
      "/finance/cheque-payments",
      data
    );
    return response.data;
  },
};

// Expenses API
export const expensesApi = {
  getAll: async (params?: {
    branch_code?: string;
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<Expense[]>("/finance/expenses", {
      params,
    });
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<Expense>(`/finance/expenses/${id}`);
    return response.data;
  },

  create: async (data: ExpenseCreate) => {
    const response = await apiClient.post<Expense>("/finance/expenses", data);
    return response.data;
  },
};

// Customer Advance Payments API
export const advancePaymentsApi = {
  getById: async (id: number) => {
    const response = await apiClient.get<CustomerAdvancePayment>(
      `/finance/advance-payments/${id}`
    );
    return response.data;
  },

  create: async (data: CustomerAdvancePaymentCreate) => {
    const response = await apiClient.post<CustomerAdvancePayment>(
      "/finance/advance-payments",
      data
    );
    return response.data;
  },

  getCustomerAdvances: async (customerId: number) => {
    const response = await apiClient.get<CustomerAdvancePayment[]>(
      `/finance/customers/${customerId}/advance-payments`
    );
    return response.data;
  },
};

// Customer Credit Notes API
export const creditNotesApi = {
  getById: async (id: number) => {
    const response = await apiClient.get<CustomerCreditNote>(
      `/finance/credit-notes/${id}`
    );
    return response.data;
  },

  create: async (data: CustomerCreditNoteCreate) => {
    const response = await apiClient.post<CustomerCreditNote>(
      "/finance/credit-notes",
      data
    );
    return response.data;
  },

  getCustomerCreditNotes: async (customerId: number) => {
    const response = await apiClient.get<CustomerCreditNote[]>(
      `/finance/customers/${customerId}/credit-notes`
    );
    return response.data;
  },
};
