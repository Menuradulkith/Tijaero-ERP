import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Query keys of pages that read the General Ledger (trial balance, account
 * ledger, cashbook, VAT, cost-center profit...). Finance mutations that post,
 * reverse or move ledger rows invalidate these, so a report open in another
 * tab doesn't show stale totals for the global 5-minute staleTime.
 */
export const LEDGER_QUERY_KEYS: QueryKey[] = [
  ["journal-entries"],
  ["journal-entry-detail"],
  ["trial-balance"],
  ["account-ledger"],
  ["general-ledger"],
  ["cashbook"],
  ["day-end-reconciliation"],
  ["vat-return"],
  ["vat-return-transactions"],
  ["profit-by-cost-center"],
  ["gl-posting-failures"],
];

export function invalidateLedgerQueries(queryClient: QueryClient): void {
  for (const queryKey of LEDGER_QUERY_KEYS) {
    queryClient.invalidateQueries({ queryKey });
  }
  // Finance dashboard keys are strings like "finance-dashboard-cashbook".
  queryClient.invalidateQueries({
    predicate: (q) => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith("finance-dashboard"),
  });
}
