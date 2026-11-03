# QA audit: Finance (2026-11-03)

Counts: 0 Critical, 8 High, 17 Medium, 15 Low (40). Scripts: scratchpad/qa/finance/. qa-none 403 on all 84 mutations. Trial balance balanced throughout.

## Global state changed by the audit
- Accidentally reversed 5 other QA expense JEs (8338, 23596, 23796, 25250, 29683); counter-reversed (32020-32024), GL net zero, but those show status "reversed".
- Sandbox fiscal years 2098 (July start) and 2099 created (periods 1214-1237, overlapping); 2099-P3 (1228) permanently locked.
- Deleted in DB: cash-flow statement CFS-2026-11 (id 1, 16 lines) and category 15.
- Depreciation run 23 (Nov 2026, all active assets) reversed immediately.
- Real periods, posting rules, VAT, tax defaults, write-off limits untouched.

## High
- **FIN-01** JournalEntriesPage.tsx:666-676, api.ts:463-500 — UI never calls submit/approve/reject; backend requires approved, so manual/recurring/opening JEs can't be posted from UI.
- **FIN-02** accounting_service.py:464-478 — JEs post into years with no accounting period (2099, 1990 → 200).
- **FIN-03** accounting_api.py:257-267, accounting_service.py:774-778 — /post accepts posting_date that re-dates an approved JE into any period.
- **FIN-04** accounting_service.py:2192-2232 — overlapping fiscal years allowed; closed period bypassed (posted to open overlapping period).
- **FIN-05** service.py:159-164 — expense update skips check_posting_date; payment posts GL in future.
- **FIN-06** accounting_service.py:877-1004 — manual reverse accepts Auto (source-document) JEs; sub-ledger drifts.
- **FIN-07** accounting_api.py:1099-1128 — recurring journals and opening balances for another branch (no validate_branch_access).
- **FIN-08** bank_reconciliation.create_account — bank account can bind to Trade Debtors control account.

## Medium
- FIN-09 correction endpoint posts without second approver; can "correct" a reversal.
- FIN-10 latest create-due draft can't be deleted (template FK), blocks period close.
- FIN-11 approved-but-unposted JE can't be rejected/edited/deleted/resubmitted.
- FIN-12 create-due company-wide; one bad template blocks everyone.
- FIN-13 expense creator can approve own expense.
- FIN-14 deposit creator can verify own deposit.
- FIN-15 sub-account under leaf with GL rows silently turns it into a heading.
- FIN-16 duplicate/overlapping bank statements allowed and block each other.
- FIN-17 account ledger not branch-scoped.
- FIN-18 audit trail not branch-scoped (accounting_api.py:634).
- FIN-19 credit/card payment detail no branch check.
- FIN-20 customer credit notes: no approval, branch, void, empty remark accepted.
- FIN-21 malformed date params → 500 on GL, JEs, trial balance, account ledger.
- FIN-22 cash-flow mutations need only CASH_FLOW_VIEW.
- FIN-23 cash-flow finalizer can approve; approved can't be deleted, blocks period.
- FIN-24 no invalidation of trial balance/GL/report queries after finance mutations (staleTime 5 min).
- FIN-25 seven finance pages never check permissions.

## Low
FIN-26 asset purchase in period-less year / supplier funding bypasses AP; FIN-27 depreciation reversal future-dated, no catch-up; FIN-28 case-sensitive account codes; FIN-29 normal balance not tied to type; FIN-30 free-text account_category; FIN-31 unknown branch codes accepted; FIN-32 blank JE description at create; FIN-33 whitespace cost-center code; FIN-34 silent rounding; FIN-35 reversal of a reversal; FIN-36 2 of 6 parallel submits succeed; FIN-37 retry missing posting failure → 200; FIN-38 free-text fields unvalidated; FIN-39 "Access denied to branch: None"; FIN-40 frontend confirm/pending/validation gaps.

Info: old 1e30 GL rows from 2026-10-12 (CN-160 etc.) make trial-balance totals unreadable.

## Leftovers
Accounts 11029-11035, cost centers 124-126, tax codes 69/70, asset class 12, FA-00005..08 (scrapped), bank accounts 211/212, recurring templates 34/35, expenses 2965/2966, petty cash fund 8 entries, cheques 240/241, card payment 62, deposit 1092, credit note 641, write-offs 21/22.
