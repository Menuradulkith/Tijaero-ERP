# QA audit: Sales + Customers (2026-11-03)

Counts: 2 Critical, 7 High, 12 Medium, 12 Low (33) + 10 frontend items. Log: scratchpad/qa/sales/log.txt.
Note: credit sales are blocked after 18:00 server time; later credit tests used admin override.

## Critical
- **SAL-01** sales/service.py:1844-1890, accounting_integration.py:280-320 — editing a pending credit order leaves credit_amount stale; AR/revenue journal silently not posted while gl-status says posted.
- **SAL-03** bank-transfer order paying 50 of 100 accepted; verify marks it fully paid, no revenue posted.

## High
- **SAL-02** editing a credit order bypasses credit limit (limit 1000, approved at 1800).
- **SAL-04** quotation_service.py:1304-1560 — quote conversion skips payment, credit-limit, credit-hours and GL checks; cash under-paid invoice can never be collected.
- **SAL-05** SalesOrderApprovalsPage.tsx:1098-1103, api.ts:57 vs sales/api.py:548 — approver username/password sent by UI are ignored.
- **SAL-06** credit_service.py:437-461 — multi-transaction settlement not atomic (400 but payment recorded).
- **SAL-07** service.py:2898, api.py:476 — branch-A user creates and processes return on branch-B invoice; refund GL in branch A.
- **SAL-08** commission_schemas.py:44 — PUT can set commission status to paid/approved/anything.

## Medium
- SAL-09 customers/api.py:402-531 — statement, outstanding docs, payments report, settlements not branch-scoped.
- SAL-10 customers/schemas.py:504 — coupon update skips create rules (500% coupon, bogus type).
- SAL-11 return accepts barcode not on invoice; wrong unit restored.
- SAL-12 empty return accepted and processable.
- SAL-13 voucher amount edit doesn't adjust balance.
- SAL-14 vouchers issued for another branch.
- SAL-15 quote update: no discount cap, tax changes dropped, editable in pending_approval.
- SAL-16 invoice numbers reused after hard delete.
- SAL-17 customers/api.py:501 — bad date on payments report → 500.
- SAL-20 commission create not branch-scoped.
- SAL-22a coupon restricted to unknown product becomes unrestricted.
- FE-3..FE-10: wrong permission names on coupons/vouchers pages, silent 403, commissions page hard-codes branch "MAIN", approval buttons ungated, quote cancel unreachable, order edit drops remarks, Delete shown on approved orders, return Edit dead end, shared customers query keys truncate lists.

## Low
SAL-18 cheque settlement without cheque no/bank; SAL-19 commission wrong customer; SAL-21 payment card name checks; SAL-22b coupon code/limit/date checks; SAL-23 duplicate bank-transfer reference; SAL-24 ignored order fields; SAL-25 return statistics all branches; SAL-26 settlement of another customer by id; SAL-27 commission payment returns {}; SAL-28 deactivate customer with receivable; SAL-29 gender message / duplicate mobile; SAL-30 debtors_api router not mounted; FE-11 misc.

## Verified OK
Customer/order validation, order state guards, settlement guards, return/quote guards, stock reserve/release, concurrency (last-stock race, approve/cancel race, settlement race), qa-none 403, branch 404 on invoices, confirms, invalidation, error display, no XSS sinks.

## Leftovers
Invoices 14568-14577, 14581, 14582, 14585-14593; returns 1383/1384/1387; settlements CCS-2026-00082..84; quotes 11136/11139; commissions 1286/1289; customers 36430-36437 deactivated; products 74823/74824; locations 80477/80478.
