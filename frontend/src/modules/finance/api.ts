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
  ExpenseUpdate,
  ExpenseListResponse,
  ExpensePaymentData,
  CustomerAdvancePayment,
  CustomerAdvancePaymentCreate,
  CustomerCreditNote,
  CustomerCreditNoteCreate,
  CreditPayment,
  CreditPaymentCreate,
  CashPayment,
  CashbookReport,
  CashbookFilter,
  ChartOfAccount,
  ChartOfAccountCreate,
  ChartOfAccountUpdate,
  ChartOfAccountTree,
  JournalEntry,
  JournalEntryCreate,
  JournalEntryUpdate,
  PaginatedJournalEntries,
  PaginatedGeneralLedger,
  GeneralLedgerEntry,
  TrialBalance,
  AccountingPeriod,
  GeneratePeriodsRequest,
  CashFlowCategory,
  CashFlowCategoryCreate,
  CashFlowCategoryUpdate,
  CashFlowStatement,
  AccountingDashboardStats,
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
    branch_code?: string;
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
    branch_code?: string;
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
    status?: string;
    expense_category?: string;
    payment_status?: string;
    search?: string;
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<ExpenseListResponse>("/finance/expenses", { params });
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

  update: async (id: number, data: ExpenseUpdate) => {
    const response = await apiClient.put<Expense>(`/finance/expenses/${id}`, data);
    return response.data;
  },

  delete: async (id: number) => {
    const response = await apiClient.delete(`/finance/expenses/${id}`);
    return response.data;
  },

  submit: async (id: number) => {
    const response = await apiClient.post<Expense>(`/finance/expenses/${id}/submit`);
    return response.data;
  },

  approve: async (id: number, remarks?: string) => {
    const response = await apiClient.post<Expense>(`/finance/expenses/${id}/approve`, remarks ? { remarks } : {});
    return response.data;
  },

  reject: async (id: number, rejection_reason: string) => {
    const response = await apiClient.post<Expense>(`/finance/expenses/${id}/reject`, { rejection_reason });
    return response.data;
  },

  processPayment: async (id: number, data: ExpensePaymentData) => {
    const response = await apiClient.post<Expense>(`/finance/expenses/${id}/process-payment`, data);
    return response.data;
  },

  record: async (id: number, data: { account_code: string; cost_center?: string; remarks?: string }) => {
    const response = await apiClient.post<Expense>(`/finance/expenses/${id}/record`, data);
    return response.data;
  },
};

// Customer Advance Payments API
export const advancePaymentsApi = {
  getAll: async (params?: {
    branch_code?: string;
    customer_id?: number;
  }) => {
    const response = await apiClient.get<CustomerAdvancePayment[]>(
      "/finance/advance-payments",
      { params }
    );
    return response.data;
  },

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
  getAll: async (params?: {
    customer_id?: number;
  }) => {
    const response = await apiClient.get<CustomerCreditNote[]>(
      "/finance/credit-notes",
      { params }
    );
    return response.data;
  },

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

// Credit Payments API
export const creditPaymentsApi = {
  getAll: async (params?: {
    branch_code?: string;
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<CreditPayment[]>(
      "/finance/credit-payments",
      { params }
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<CreditPayment>(
      `/finance/credit-payments/${id}`
    );
    return response.data;
  },
};

// Cash Payments API
export const cashPaymentsApi = {
  getAll: async (params?: {
    branch_code?: string;
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<CashPayment[]>(
      "/finance/cash-payments",
      { params }
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<CashPayment>(
      `/finance/cash-payments/${id}`
    );
    return response.data;
  },
};

// Cashbook API
export const cashbookApi = {
  getReport: async (params?: CashbookFilter) => {
    const response = await apiClient.get<CashbookReport>("/finance/cashbook", {
      params,
    });
    return response.data;
  },
};

// ─── Accounting APIs ──────────────────────────────────────────────────────────

const ACCT_BASE = "/finance/accounting";

// Accounting Dashboard API
export const accountingDashboardApi = {
  getStats: async () => {
    const response = await apiClient.get<AccountingDashboardStats>(
      `${ACCT_BASE}/dashboard/stats`
    );
    return response.data;
  },
};

// Chart of Accounts API
export const chartOfAccountsApi = {
  getAll: async (params?: {
    account_type?: string;
    is_active?: boolean;
    search?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<ChartOfAccount[]>(
      `${ACCT_BASE}/chart-of-accounts`,
      { params }
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<ChartOfAccount>(
      `${ACCT_BASE}/chart-of-accounts/${id}`
    );
    return response.data;
  },

  getTree: async () => {
    const response = await apiClient.get<ChartOfAccountTree[]>(
      `${ACCT_BASE}/chart-of-accounts/tree`
    );
    return response.data;
  },

  create: async (data: ChartOfAccountCreate) => {
    const response = await apiClient.post<ChartOfAccount>(
      `${ACCT_BASE}/chart-of-accounts`,
      data
    );
    return response.data;
  },

  update: async (id: number, data: ChartOfAccountUpdate) => {
    const response = await apiClient.put<ChartOfAccount>(
      `${ACCT_BASE}/chart-of-accounts/${id}`,
      data
    );
    return response.data;
  },

  delete: async (id: number) => {
    const response = await apiClient.delete(
      `${ACCT_BASE}/chart-of-accounts/${id}`
    );
    return response.data;
  },

  seed: async (force = false) => {
    const response = await apiClient.post<{
      created: number;
      skipped: number;
      parent_links_set: number;
      total: number;
    }>(`${ACCT_BASE}/chart-of-accounts/seed?force=${force}`);
    return response.data;
  },
};

// Journal Entries API
export const journalEntriesApi = {
  getAll: async (params?: {
    status?: string;
    entry_type?: string;
    date_from?: string;
    date_to?: string;
    search?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<PaginatedJournalEntries>(
      `${ACCT_BASE}/journal-entries`,
      { params }
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<JournalEntry>(
      `${ACCT_BASE}/journal-entries/${id}`
    );
    return response.data;
  },

  create: async (data: JournalEntryCreate) => {
    const response = await apiClient.post<JournalEntry>(
      `${ACCT_BASE}/journal-entries`,
      data
    );
    return response.data;
  },

  update: async (id: number, data: JournalEntryUpdate) => {
    const response = await apiClient.put<JournalEntry>(
      `${ACCT_BASE}/journal-entries/${id}`,
      data
    );
    return response.data;
  },

  delete: async (id: number) => {
    const response = await apiClient.delete(
      `${ACCT_BASE}/journal-entries/${id}`
    );
    return response.data;
  },

  post: async (id: number, posting_date?: string) => {
    const response = await apiClient.post<JournalEntry>(
      `${ACCT_BASE}/journal-entries/${id}/post`,
      { posting_date }
    );
    return response.data;
  },

  reverse: async (id: number, reason: string, reversal_date?: string) => {
    const response = await apiClient.post<JournalEntry>(
      `${ACCT_BASE}/journal-entries/${id}/reverse`,
      { reason, reversal_date }
    );
    return response.data;
  },
};

// General Ledger API
export const generalLedgerApi = {
  getAll: async (params?: {
    account_id?: number;
    date_from?: string;
    date_to?: string;
    fiscal_year?: number;
    fiscal_period?: number;
    transaction_type?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<PaginatedGeneralLedger>(
      `${ACCT_BASE}/general-ledger`,
      { params }
    );
    return response.data;
  },

  getTrialBalance: async (params?: {
    as_of_date?: string;
    fiscal_year?: number;
    fiscal_period?: number;
  }) => {
    const response = await apiClient.get<TrialBalance>(
      `${ACCT_BASE}/general-ledger/trial-balance`,
      { params }
    );
    return response.data;
  },

  getAccountLedger: async (
    accountId: number,
    params?: { date_from?: string; date_to?: string }
  ) => {
    const response = await apiClient.get<GeneralLedgerEntry[]>(
      `${ACCT_BASE}/general-ledger/account/${accountId}`,
      { params }
    );
    return response.data;
  },
};

// Financial Reports API
export const financialReportsApi = {
  getIncomeStatement: async (params: {
    fiscal_year: number;
    fiscal_period?: number;
    date_from?: string;
    date_to?: string;
  }) => {
    const response = await apiClient.get<import("./types").IncomeStatementResponse>(
      `${ACCT_BASE}/reports/income-statement`,
      { params }
    );
    return response.data;
  },

  getBalanceSheet: async (params: {
    fiscal_year: number;
    as_of_date?: string;
  }) => {
    const response = await apiClient.get<import("./types").BalanceSheetResponse>(
      `${ACCT_BASE}/reports/balance-sheet`,
      { params }
    );
    return response.data;
  },
};

// Accounting Periods API
export const accountingPeriodsApi = {
  getAll: async (params?: {
    fiscal_year?: number;
    status?: string;
  }) => {
    const response = await apiClient.get<AccountingPeriod[]>(
      `${ACCT_BASE}/periods`,
      { params }
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<AccountingPeriod>(
      `${ACCT_BASE}/periods/${id}`
    );
    return response.data;
  },

  generate: async (data: GeneratePeriodsRequest) => {
    const response = await apiClient.post<AccountingPeriod[]>(
      `${ACCT_BASE}/periods/generate`,
      data
    );
    return response.data;
  },

  close: async (id: number) => {
    const response = await apiClient.post<AccountingPeriod>(
      `${ACCT_BASE}/periods/${id}/close`
    );
    return response.data;
  },

  reopen: async (id: number) => {
    const response = await apiClient.post<AccountingPeriod>(
      `${ACCT_BASE}/periods/${id}/reopen`
    );
    return response.data;
  },

  lock: async (id: number) => {
    const response = await apiClient.post<AccountingPeriod>(
      `${ACCT_BASE}/periods/${id}/lock`
    );
    return response.data;
  },
};

// Cash Flow Categories API
export const cashFlowCategoriesApi = {
  getAll: async (params?: {
    section?: string;
    is_active?: boolean;
  }) => {
    const response = await apiClient.get<CashFlowCategory[]>(
      `${ACCT_BASE}/cash-flow/categories`,
      { params }
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<CashFlowCategory>(
      `${ACCT_BASE}/cash-flow/categories/${id}`
    );
    return response.data;
  },

  create: async (data: CashFlowCategoryCreate) => {
    const response = await apiClient.post<CashFlowCategory>(
      `${ACCT_BASE}/cash-flow/categories`,
      data
    );
    return response.data;
  },

  update: async (id: number, data: CashFlowCategoryUpdate) => {
    const response = await apiClient.put<CashFlowCategory>(
      `${ACCT_BASE}/cash-flow/categories/${id}`,
      data
    );
    return response.data;
  },

  delete: async (id: number) => {
    const response = await apiClient.delete(
      `${ACCT_BASE}/cash-flow/categories/${id}`
    );
    return response.data;
  },
};

// Cash Flow Statements API
export const cashFlowStatementsApi = {
  getAll: async (params?: {
    fiscal_year?: number;
    status?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<CashFlowStatement[]>(
      `${ACCT_BASE}/cash-flow/statements`,
      { params }
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<CashFlowStatement>(
      `${ACCT_BASE}/cash-flow/statements/${id}`
    );
    return response.data;
  },

  generate: async (data: {
    fiscal_year: number;
    fiscal_period?: number;
    start_date: string;
    end_date: string;
    method?: string;
  }) => {
    const response = await apiClient.post<CashFlowStatement>(
      `${ACCT_BASE}/cash-flow/statements/generate`,
      data
    );
    return response.data;
  },

  finalize: async (id: number) => {
    const response = await apiClient.post<CashFlowStatement>(
      `${ACCT_BASE}/cash-flow/statements/${id}/finalize`
    );
    return response.data;
  },

  approve: async (id: number, remarks?: string) => {
    const response = await apiClient.post<CashFlowStatement>(
      `${ACCT_BASE}/cash-flow/statements/${id}/approve`,
      { remarks }
    );
    return response.data;
  },

  delete: async (id: number) => {
    const response = await apiClient.delete(
      `${ACCT_BASE}/cash-flow/statements/${id}`
    );
    return response.data;
  },
};
