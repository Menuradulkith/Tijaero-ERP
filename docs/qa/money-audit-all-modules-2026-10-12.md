# Money audit - finance, sales, purchasing, warehouse, HR (2026-10-12)

Goal: every money flow must balance - journal entries, trial balance, cashbook vs GL cash/bank, sub-ledgers.

## Method
* `backend/tests/money_invariants.py` - read-only ledger checks (`Books`): every journal entry balances (lines and header, to the cent), no malformed lines, trial balance of posted entries balances, per-document journal lookup, cashbook vs GL cash/bank.
* `backend/tests/test_money_audit_cross_module_2026_10_12.py` - 18 end-to-end scenarios through the real API (sales cash/credit/cancel; purchasing credit/cash GRN, GRN cancel, landed cost; supplier settlement, advance, purchase return; finance expense, bank deposit, manual JE post/reverse, unbalanced JE refused; HR payroll maths, payroll full cycle, reimbursement). Each ends with `assert_balanced`.
* Run on a clean, fully migrated database (`erp_audit`, migrations to s96) so results do not depend on dev-data drift.
* UI sweep of 96 routes in the browser pane (console + network errors).

## Result
Full backend suite on the clean DB: **1554 passed, 0 failed**. All 18 money scenarios pass; trial balance is zero after every flow.

## Findings

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| 1 | **High** | Payroll: salary payment posted `Cr 2110 Salaries Payable` but never cleared it and never credited cash/bank - liability overstated and cash/bank overstated by the full net pay on every payroll run. | **Fixed** - `post_payroll_batch_to_gl` now also posts `Dr 2110 / Cr 1010|1020` (by payment method). Covered by test. |
| 2 | **High** | Supplier credit settlement and supplier advance cashbook triggers referenced a wrong table/column - HTTP 500 on migration-built databases. | **Fixed** - migration `s96_fix_supplier_cashbook`. **Must be applied to every real DB.** |
| 3 | Medium | Cashbook has no trigger for reimbursement, payroll and commission cash-outs, so cashbook != GL cash for HR payments (GL is correct). | Open - decide whether the cashbook must include them. |
| 4 | Medium | Dev DB `erp_db` has no cashbook functions/triggers (cashbook empty) and 512 rows in `gl_posting_failures` (environment drift; some with absurd amounts). | Open - re-run migrations / review failures before relying on dev numbers. |
| 5 | Medium | `/finance/petty-cash` page: backend returns a bare array but the page read `.items`, so funds never showed; the empty-state early return also crashed React ("Rendered fewer hooks"). | **Fixed** - `listFunds` normalises the response; empty-state branch removed (main layout already shows "No funds found" + Create Fund). |
| 6 | Low | Duplicate React key on `/finance/approvals/bank-transfer-verify` (key `4002`). | Open |
| 7 | Info | Landed cost is capitalised to inventory but COGS uses product/tier cost_price, so landed cost does not reach COGS. GRN GL is direct-model (not GR/IR). | Design note |
| 8 | Info | Credit sales post revenue to 4020 (cash sales 4010) by design; GL for payroll posts at *process-payment*, not at approval. | Documented |

## Not covered / next
Partial sale returns, per-flow subledger vs GL reconciliation reports (debtors/creditors), warehouse stock-value vs 1210 reconciliation, multi-branch payroll.
