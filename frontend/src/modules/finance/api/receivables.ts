/**
 * Receivables setup and actions (finance blueprint phase C):
 * customer write-offs (and per-group limits), cheque register actions.
 */
import apiClient from "@/api/client";

const ACCT_BASE = "/finance/accounting";

// ─── Write-offs ─────────────────────────────────────────────────────────────
export interface WriteOff {
  id: number;
  write_off_no: string;
  invoice_id: number;
  invoice_no?: string | null;
  customer_id: number;
  customer_name?: string | null;
  branch_code?: string | null;
  write_off_date: string;
  amount: number;
  reason: string;
  reason_label: string;
  notes?: string | null;
  status: "posted" | "reversed";
  journal_entry_id?: number | null;
}

export interface WriteOffSetup {
  reasons: { value: string; label: string }[];
  my_limit: number | null;
}

export interface WriteOffLimit {
  group_id: number;
  group_name: string;
  max_amount: number;
}

export const writeOffsApi = {
  setup: async () => (await apiClient.get<WriteOffSetup>(`${ACCT_BASE}/write-offs/setup`)).data,
  getAll: async (params?: { customer_id?: number; invoice_id?: number }) =>
    (await apiClient.get<WriteOff[]>(`${ACCT_BASE}/write-offs`, { params })).data,
  create: async (data: { invoice_id: number; amount: number; reason: string; write_off_date?: string; notes?: string }) =>
    (await apiClient.post<WriteOff>(`${ACCT_BASE}/write-offs`, data)).data,
  reverse: async (id: number, reason: string) =>
    (await apiClient.post<WriteOff>(`${ACCT_BASE}/write-offs/${id}/reverse`, { reason })).data,
  getLimits: async () => (await apiClient.get<WriteOffLimit[]>(`${ACCT_BASE}/write-off-limits`)).data,
  setLimit: async (groupId: number, max_amount: number) =>
    (await apiClient.put<WriteOffLimit[]>(`${ACCT_BASE}/write-off-limits/${groupId}`, { max_amount })).data,
};

// ─── Cheque register ────────────────────────────────────────────────────────
export type ChequeStatus = "received" | "deposited" | "cleared" | "bounced";

export const CHEQUE_STATUS_LABEL: Record<ChequeStatus, string> = {
  received: "In hand",
  deposited: "Deposited",
  cleared: "Cleared",
  bounced: "Bounced",
};

export const chequeActionsApi = {
  clear: async (id: number, status_date?: string) =>
    (await apiClient.post(`${ACCT_BASE}/cheques/${id}/clear`, { status_date })).data,
  bounce: async (id: number, reason: string, status_date?: string) =>
    (await apiClient.post(`${ACCT_BASE}/cheques/${id}/bounce`, { reason, status_date })).data,
};
