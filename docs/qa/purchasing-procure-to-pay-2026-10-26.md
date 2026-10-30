# QA audit - procure to pay (2026-10-26)

Scope: supplier creation -> product creation -> PO -> PO approval -> supplier advance -> GRN (serial, lot, quantity)
-> invoice -> supplier payment, and the same chain starting from a quotation
(quote -> approval -> sent -> confirmed -> procurement queue -> PO -> advance -> GRN -> payment).
Plus race conditions, security and load. Run against the dev DB (`erp_postgres2`) on a second backend (port 8021) with an
isolated QA branch/supplier/products per run. Scripts: `qa_*.py` in the session scratchpad (HTTP, real database).

Context: purchase orders no longer carry a payment method (option B): every PO is owed to the supplier, the GRN posts
Dr Inventory / Cr Trade Creditors, and how it is paid is chosen in Finance.

## Result

| Area | Checks | Result |
|---|---|---|
| Supplier (contact person, payment method), products (serial / batch / none) | created, defaults, tracking type required | pass |
| PO create / approve, maker-checker, forged fields | status forced to `pending_approval`, payment method forced to `credit`, number generated | pass (see note 1) |
| Supplier advance | before approval refused, 0 / negative refused, over-return refused, consumed advance cannot be returned / deleted / reduced | pass |
| GRN serial / lot / quantity | stock rows (3 serial rows with barcodes, 1 batch row, 1 qty row), GL Dr 1210 / Cr 2010, PO `partially_completed` -> `completed` | pass |
| GRN negatives | duplicate serial, over-receipt, no batch no., zero / negative qty, duplicate supplier invoice no., unknown PO line, expired batch, no lines, receive on completed / short-closed PO | pass |
| Quotation chain | approval, send, confirm, reject needs reason, approved quote cannot be edited, queue -> PO consumes queue lines, stock reserved for the quote | pass |
| Payments | credit settlement, advance application, invoice payment, cancel restores balances | pass after fixes below |
| Races (parallel requests) | PO approval, receipt of one line, same serial, advance application, GRN cancel, credit settlement, PO numbers, daily PO limit, duplicate supplier / product | pass after fixes below |
| Security | see below | pass, 3 hardening notes |
| Load | 5 / 25 / 60 concurrent clients, 0 errors | see below |

## Bugs found and fixed

1. **Credit settlements could overpay a GRN.** `POST /purchasing/credit-settlements` went through a path that skipped the
   "amount <= still owed" check (the validated method existed but was not used). A GRN of 700 took 1,301 in payments.
   Now validated under the supplier / GRN row locks, counting pending settlements, advances, returns and several lines of one
   request. (`service.py`, `credit_service.py`)
2. **GRN payment history showed the whole PO.** `total_amount` was the PO total, `remaining` ignored advances / returns, and cancelled
   settlements were counted. Now it is this receipt only and uses the same remaining-payable rule.
3. **Advance applied to a credit GRN debited Inventory again.** Dr 1210 / Cr 2020 on top of the GRN's own Dr 1210 / Cr 2010 overstated
   inventory and left Trade Creditors too high. Now Dr 2010 Trade Creditors / Cr 2020 Supplier Advances. (`purchase_expense_payroll_gl.py`)
4. **An advance could be applied beyond what the GRN owes**, and **concurrent applications over-applied the advance** (3 x 60 against
   an advance of 100). Cause: `SELECT ... FOR UPDATE` returned the row already loaded earlier in the request, so the balance that was
   re-checked under the lock was stale. Fixed at the root: every locking SELECT now re-reads the row (`do_orm_execute` hook in
   `db/session.py`, 178 call sites benefit). Lock order advance -> GRN added.
5. **Deadlock between two applications returned HTTP 500.** Deadlock / serialization failures now return 409 "nothing was saved, try again".
6. **Future-dated GRN accepted** (a GRN dated 2999 was posted and received stock). Receipt and supplier-invoice dates cannot be in the future.
7. **Purchase invoices had no three-way match.** The docstring promised it, the code did not do it: invoicing 4 against 3 received, a price
   different from the PO, a header total that disagrees with the lines, and invoicing the same GRN several times were all accepted.
   Now: quantity <= received - already invoiced (per product), price = PO price, line = qty x price, subtotal / total = lines,
   discount <= amount, cancelled GRN refused. (`invoice_service.py`)
8. **Updating a PO with an old client** (still sending `payment_method`) failed with "A required value is missing" - the field is now ignored
   on create and removed from update.

Regression tests: `tests/test_qa_purchasing_2026_10_26.py` (13), plus PO payment-method tests in `test_purchase_order_rules.py`.

## Security (all through the real API)
- 20 anonymous / garbage-token calls on purchasing, finance, users, sales endpoints: all 401/403. A user with no permissions: refused everywhere.
- Branch-scoped users cannot read a PO or receive goods against another branch (403). Settling a GRN under a different supplier: 400.
- Forged `status`, `created_by`, `purchasing_order_no`, `payment_method` on PO create are ignored.
- SQL-looking `search` / `sort_by`, 200 KB malformed JSON, 5 MB text, 500 PO lines, NaN / Infinity / 1e400 / negative prices: inert or 422.
  Errors do not leak stack traces.
- Notes (not changed): no `Strict-Transport-Security`, `Content-Security-Policy` or `Referrer-Policy` header from the API (set them in the
  reverse proxy); login is limited to 20 attempts/min per client but there is no per-account lockout; a superuser can approve a PO they created.

## Load (single uvicorn worker, dev machine, 7 list endpoints)
| clients | req/s | p50 | p95 | errors |
|---|---|---|---|---|
| 5 | 23.7 | 119 ms | 528 ms | 0 |
| 25 | 21.1 | 723 ms | 2.2 s | 0 |
| 60 | 9.8 | 1.8 s | 4.1 s | 0 |

One worker saturates at ~22 req/s: latency grows with concurrency, nothing fails or errors. Single requests are 22-116 ms. Production should run several
workers (see `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` in `db/session.py`).

## Other observations
1. Superuser self-approval of own PO is allowed (non-superusers are maker-checker protected by the existing tests).
2. Dev DB: `test_money_audit_cross_module_2026_10_12.py` (11 tests) and `test_supplier_validation::test_search_is_literal` fail on this DB because
   other QA sessions left huge ledger totals / names with `_`; they compare absolute ledger totals. Not caused by these changes.
3. "Created" time on a GRN's activity history shows 5:30 AM because the receipt stores a date, not a time.
4. QA rows created by this audit (branches `QAX*`, `QAY*`, `QAZ*`, `QAW*`, one supplier, 3 products, POs, GRNs, settlements, invoices) were left in the dev DB.
   One advance application (JE-ADV-202610-0003) was posted before fix 3 and still has the old Dr Inventory posting.

## Final regression run
Full backend suite after all fixes: **2058 passed, 12 failed** - the 12 are the dev-DB items in "Other observations" (11 x `test_money_audit_cross_module`,
1 x `test_supplier_validation::test_search_is_literal`). A hook-related regression found on the way (re-reading a locked row discarded unflushed edits,
broke one sales credit test) was fixed by flushing pending changes before the locked re-read.

## Finance check of the same flow (second pass)
Fresh data, exact numbers: supplier with 30 credit days; PO = serial 3x100 + lot 10x50 + qty 5x20 = 900; advance 200 (cash); GRN1 700 and GRN2 200;
advance 200 applied to GRN1; settlements 300 (cheque) + 200 (transfer) on GRN1; return of 2 lots (100) on GRN2; invoice for the 100 that was kept, paid 60 + 40.

| Account | Expected | Ledger |
|---|---|---|
| 1210 Inventory | 900 - 100 = 800 | 800 |
| 2010 Trade Creditors | 0 | 0 |
| 2020 Supplier Advances | 0 | 0 |
| 1010 + 1020 cash/bank movement | -800 | -800 (cash -200, bank -600) |

Cashbook: 5 rows, money out 800. Day-end reconciliation: balanced, cash reconciled, no pending posting failures. Payment-status, aging and the ledger agree (0 owed).
Whole-ledger trial balance and balance sheet: balanced.

Found and fixed in this pass:
9. **Supplier statement was wrong** (balance 1,300 when 0 was owed): the second GRN was shown at the whole PO value (900 instead of 200), and advances applied,
   purchase returns, invoice payments and cancelled settlements were not handled. Rewritten from the same sources as the ledger (GRN value, settlements,
   advances applied, approved returns, invoice payments; cancelled items excluded) and now also returns `unapplied_advance`.
10. **Cancelling a verified credit settlement left the ledger and cashbook untouched** (sub-ledger said 200 owed again, GL and cashbook still said it was paid).
    It now posts the mirror entry (JE "Credit Settlement Cancelled": Dr bank/cash, Cr 2010) and the cashbook shows the money back in.

Notes (not changed): a *verified* supplier payment cannot be cancelled (400) - only pending ones; a cheque settlement is labelled "Bank Transfer" in the cashbook
(cheques post to the bank account); the data created before fix 10 (settlement CSF-FFBA4F-2) still has its payment in the ledger.
