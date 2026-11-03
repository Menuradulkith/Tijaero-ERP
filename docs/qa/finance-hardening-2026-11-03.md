# Finance hardening — 2026-11-03

Follow-up to `finance-audit-2026-11-02.md`: one simulated month checked against a
hand-computed ledger, Sri Lankan statutory rates checked against official
sources, race conditions, load, and a security review. All tests ran on throwaway
databases; the dev DB was not written to (except one QA expense created from the UI).

## 1. Simulated month vs. independent expected ledger
A month of trading for a two-branch retailer (opening balances; 14 sales incl. VAT,
discounts, credit, voucher, advance, return; cheque bounce; write-off; 3 GRNs, landed
cost, supplier invoice, payment, advance, return; 4 expenses; petty cash; bank deposit
and statement; fixed asset + depreciation; recurring rent; payroll for 3 with a loan;
VAT settlement) driven through the API.

- **Every one of the 56 postings was right** (Dr/Cr and amount), except APIT 4 cents.
- Trial balance, income statement, day-end (company + per branch), VAT return,
  receivables, fixed-asset register, payroll, bank reconciliation: all matched.
- 25 mismatches were all in **reports that recompute totals themselves**. Fixed:

| Report | Was | Fix |
|---|---|---|
| Payables aging / supplier outstanding | 479,000 vs GL 291,000 (ignored verified supplier payments, invoice VAT, landed costs) | Per-document lines built from the same rules as the ledger; direct verified payments subtracted |
| Balance sheet / GL detail / profit by cost center | Depreciation dated at month-end (still ahead) was left out of "today" | Current-month depreciation is dated no later than today |
| Cashbook summary closing | Bank deposit counted only as money out | A deposit is a till→bank transfer: no change to cash+bank (as day-end) |
| Branch summary | "Cash in hand" showed cash+bank; gross sales net of vouchers/advances | Till from the cash GL accounts; sales at subtotal + tax + service charge |
| VAT summary | Unpaid supplier invoices' input VAT missing | Reads the tax ledger, like the VAT return |
| Customer payments, finance summary deposits, several lists | Last day of the range dropped (timestamp ≤ date) | Inclusive end date everywhere found |
| Finance summary "net profit" | Receipts minus expense-module only | Income/expenses/net from the income statement; receipts shown separately |
| Payroll summary | Deductions from the wrong table; all-time basic salary | Paid batches in the range |
| Supplier payments report | Advance counted when paid and again when applied | Counted once |
| APIT | Monthly whole-rupee bands, 4 cents out | IRD annual bands / 12 (= IRD formula, e.g. 400,000 → 50,000.00) |

Also: the main bank account's reconciliation now starts at its first posting or the
start of the year (a fresh install refused statements dated before install day).

## 2. Sri Lankan rates (official sources, Nov 2026)
VAT 18%, EPF 8%/12%, ETF 3%, APIT Table 01 (2025/26), stamp duty Rs 25 > Rs 25,000,
gratuity ½ month/year after 5 years — **all match**. Not in the system: SSCL 2.5%,
WHT on service payments, VAT-registration threshold warning (questions in
`docs/finance/ACCOUNTANT_REVIEW_PACK.md`). Fixed: the old printable invoice showed
"TAX INVOICE" only for tax-inclusive prices; now whenever VAT is charged.

## 3. Race conditions (10–20 simultaneous requests, real 4-worker server)
Held (exactly one effect): journal approve/post/reverse/correct, expense pay, supplier
settlement over-pay, advance over-apply, customer over-payment, write-off, gift voucher,
petty cash overspend and double close, depreciation twice, asset disposal, VAT
settlement twice, bank matching, recurring generation, commission, payroll, document
numbers (no duplicates). Fixed:

| Race | Was | Fix |
|---|---|---|
| Year-end close ×12 | 12 complete closes (24 journals) | One close per year at a time (transaction lock); the rest are refused |
| Verify vs cancel supplier settlement | Cancelled settlement kept its live journal + cashbook outflow | Journal saved in the same transaction as "verified", under the row lock |
| Supplier payment verify ×12 | 4 passed the status check | Row lock |

Known, not changed: closing a period at the same instant a document dated in it is
posted can leave that document's journal as a posting failure (it is listed under
Posting Failures and blocks a clean day-end; reopen and retry). Uvicorn with several
workers on Windows occasionally stalls a request ~20 s (no data effect; not seen with
one worker) — run production on Linux.

## 4. Load (high-volume copy: 1,003,340 GL rows, 300,835 invoices)
13 finance operations (reports, ledger lists, a full expense create→pay cycle), 4 workers:

| Users | Ops/s | Errors | Slowest (p95) |
|---|---|---|---|
| 10 | 8.9 | 0 | trial balance 0.5 s, balance sheet 0.8 s |
| 25 | 18.0 | 0 | trial balance 2.7 s (a few 20 s stalls, see above) |
| 50 | 26.7 | 0 | trial balance 5.6 s, balance sheet 4.2 s, expense cycle 2.4 s |

After the run: all 502 load-test expenses had exactly one balanced journal and one
cashbook row. Recommendation if more than ~25 people use finance reports at once:
serve trial balance / balance sheet from the running account balances instead of
summing a million ledger rows per request.

## 5. Security
Fixed:
- **Refresh tokens worked as access tokens** (7 days, also in print URLs) — only access tokens are accepted now.
- **Journal entries by id ignored branch**: get/update/post/reverse/delete/submit/approve/reject/correct now check the user's branches (company-wide journals stay visible, as in the list).
- **"Correct" a journal** posted an approved adjustment by one person and skipped the control-account rule: only manual/adjustment journals can be corrected (documents are corrected through their document), with the manual-journal account rules.
- **Supplier invoice payment**: listing the same invoice twice overpaid it — refused; purchase invoices are now branch-scoped (lists, by id, create, pay, cancel).
- **Petty cash** routes by fund id now check the fund's branch.
- **Bank statement "book it"** could move money into debtors/creditors/inventory/VAT or a heading — refused.
- **Payslips, payroll summary, vouchers** could be printed (and template-previewed) for any branch — branch-checked.
- **CSV exports**: text starting with = + - @ is neutralised (spreadsheet formula injection).
- **Client-set fields ignored**: system-account flag on new accounts, document references on manual journal lines, bank-deposit user, expense number; an expense's account must be an active, postable expense account (was any code, e.g. a bank).
- **Cash-flow setup** (categories, finalize/delete statements) needed only "view" — now chart-of-accounts / period permissions.

Reported, not changed (design decisions for the owner): maker ≠ checker on expenses,
bank-deposit verify, supplier payments and settlements, commissions and loans (journals
and payroll already enforce it); credit notes have no approval or limit; posting-rule
changes are not audited; dedicated permissions for write-offs, period close/year-end,
expense payment. The `/sales/debtors` API is dead code with its own aging — remove later.
