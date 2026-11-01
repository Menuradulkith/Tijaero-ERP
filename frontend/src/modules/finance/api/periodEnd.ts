/**
 * Recurring journals and opening balances (finance blueprint phase E).
 */
import apiClient from "@/api/client";

const ACCT_BASE = "/finance/accounting";

export interface RecurringLine {
  line_number?: number;
  account_id: number;
  debit_amount: number | string;
  credit_amount: number | string;
  description?: string | null;
  cost_center_id?: number | null;
}

export interface RecurringJournal {
  id: number;
  name: string;
  description: string;
  branch_code?: string | null;
  frequency: "monthly" | "quarterly" | "yearly";
  next_date: string;
  end_date?: string | null;
  auto_reverse: boolean;
  is_active: boolean;
  last_journal_entry_id?: number | null;
  lines: RecurringLine[];
}

export interface RecurringJournalCreate {
  name: string;
  description: string;
  branch_code?: string | null;
  frequency: RecurringJournal["frequency"];
  next_date: string;
  end_date?: string | null;
  auto_reverse: boolean;
  lines: RecurringLine[];
}

export interface OpeningBalanceLine {
  account_code: string;
  debit?: number | string;
  credit?: number | string;
  description?: string;
}

export const recurringJournalsApi = {
  getAll: async () => (await apiClient.get<RecurringJournal[]>(`${ACCT_BASE}/recurring-journals`)).data,
  create: async (data: RecurringJournalCreate) =>
    (await apiClient.post<RecurringJournal>(`${ACCT_BASE}/recurring-journals`, data)).data,
  update: async (id: number, data: Partial<Pick<RecurringJournal, "name" | "next_date" | "end_date" | "is_active">>) =>
    (await apiClient.put<RecurringJournal>(`${ACCT_BASE}/recurring-journals/${id}`, data)).data,
  createDue: async () => (await apiClient.post<string[]>(`${ACCT_BASE}/recurring-journals/create-due`)).data,
};

export const openingBalancesApi = {
  create: async (data: { entry_date: string; branch_code?: string; description?: string; lines: OpeningBalanceLine[] }) =>
    (await apiClient.post<{ id: number; journal_entry_no: string }>(`${ACCT_BASE}/opening-balances`, data)).data,
};
