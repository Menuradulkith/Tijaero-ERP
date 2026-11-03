# Finance module full audit — 2026-11-02

Asked: check every finance field, every rule, that the books balance, and every
connection with other modules.

## How it was checked

| Check | What | Result before fixes |
|---|---|---|
| Ledger reconciliation (read-only, dev DB) | 758 journals; every control account vs its sub-ledger; posting coverage per document type; closed periods | Books balance (trial balance 0.00, balance-sheet equation 0.00, every JE balanced, GL = JE lines). 4 current logic bugs; the other gaps are old QA data from before 12 Oct |
| API fuzz (throwaway DB) | 53 write endpoints, field by field (missing, blank, wrong type, negative, sub-cent, 1e15/1e30, 10k text, 2^40 ids, bad dates, bad enums, unknown ids) + ~190 business-rule probes on ~25 action endpoints | 178 server errors, 282 accepted-but-wrong. Ledger of the fuzz DB stayed balanced |
| UI forms (browser) | Every finance create/edit form, field by field; displayed totals re-computed by hand; 1440 and 390 px | 2 forms unusable, 6 more high/medium problems, calculations correct |
| Backend tests | Full suite on the dev DB and on a fresh empty DB (migrate + seed) | Fresh install could not migrate past s98 |

## Control accounts vs sub-ledgers (after fixes)

| Account | Result |
|---|---|
| Trade Debtors 1110 | Aging and outstanding = GL **335,667.00** exactly |
| Trade Creditors 2010 | Sub-ledger matches GL except 15,980.00 of old QA data: 3 credit landed costs with no supplier (15,620, 26 Oct) and 3 returns from 12 Oct that never posted (360) |
| VAT 2210 / 1140 / 2220 | = tax ledger, per journal |
| Cash / bank | = cashbook (day-end identity) to 0.00; each registered bank matches |
| Fixed assets, depreciation, petty cash 1030 | = register |
| Payroll liabilities, employee loans 1130 | = payroll batches / loans |
| Supplier / customer advances, gift vouchers 2510, credit notes 2530, inventory 1210 | Differences traced to named old QA documents (10-11/12 Oct, before the fixes of those flows); no current code path produces them |

## Fixed

**Money and ledger logic**
- Receivables aging and the outstanding-invoices list (used by Write-offs, customer statements and Report Center aging) looked only at fully-paid invoices and counted cancelled ones: now the approved/completed invoices still owed, using the balance the ledger carries.
- Supplier "amount owed" (also drives available credit) counted invoiced goods twice and counted pending, unverified payments: now GRN value − verified payments − settlements − returns − advances + invoice VAT − discount + credit landed costs, the same as the ledger.
- Supplier "payment status" summary used its own (double-counting) total: now the same calculator.
- Landed cost "on credit" must name the supplier owed (it credits Trade Creditors), and is counted in that supplier's balance.
- Applying a supplier advance saved the advance balance before the application row (a failure in between left them out of step) and used float arithmetic on money: now one transaction, Decimal.
- Depreciation runs posted under the asset reference type with the run id (run 3 looked like asset 3): own reference type `DepreciationRun`.
- Gift voucher stand-alone "redeem" endpoint cut a voucher's balance without touching the invoice or the ledger; it had no screen: removed (sales redeem vouchers inside the sale, which posts correctly).
- Year-end close accepted a future or impossible year (2999 posted closing journals): only a finished year, 2000–2100.

**One date rule for every posting document** (`finance/posting_dates.py`): a date in the future or in a closed accounting period is refused up front with a plain message — expenses (date and payment), petty cash expense and top-up, supplier payments / advances / advance returns, fixed asset purchase and disposal, cheque clearing. Before, the document saved and its journal failed quietly or landed in a year with no periods.

**Input validation (API)**
- Money inputs round to cents as they arrive; a positive amount below 0.01 is refused (0.001 used to save as 0.00). Journal lines round per line before the balance check.
- Text too long for its column, numbers/ids too large, impossible dates now return a clear 422 instead of a server error — for every endpoint (one handler; psycopg 3 `sqlstate`).
- Chart of accounts: code/name trimmed and required, lengths checked, account type and normal balance from the fixed lists, parent must be the same type and not itself or a sub-account.
- Reasons (reverse, reject, correct, write-off reverse, cheque bounce, expense reject) can't be blank.
- Periods: year 2000–2100, month 1–12, end not before start; cash-flow period/method checked.
- Petty cash: user ids come from the login, not the request; one open fund per branch; branch must exist.
- Supplier payments / advances / settlements / returns: payment method from the list (cash is booked to Cash, everything else to bank — a typo must not become a bank payment), branch and "payment for" required, order id ≥ 1, settlement number required and unique, at least one line.
- Commissions: amount from the real invoice, not above it, rate and amount agree, one per invoice and agent, can't decline once paid.
- Bank statements: closing = opening + lines, number unique per account; unmatch on a free line refused; unmatching a created entry reverses it (fixed earlier).
- Fixed assets: depreciation can't start before purchase, method from the list, asset class account must be a fixed-asset account, scrap has no proceeds.
- Recurring journal end date not before its first date; names/descriptions not blank. Tax code code/name not blank. Gift voucher payment method from the list, code not blank, branch must exist.
- Optional numbers on sales settlement (`service_charge_amount: null`) crashed: fixed for all optional sales inputs.

**Screens**
- Expenses: the form had a two-step wizard with no way to step on, so expenses could not be created — now one form with Save.
- Supplier payments: no way to start a payment — "Make Payment" button.
- Accounting periods: a new year could not be generated — "Generate Year".
- Journal entry: only postable accounts in the picker; amounts 2 decimals, no negatives; totals in cents (0.001 no longer shows "balanced"); step 1 needs date and description; the exact problem field is highlighted; lines scroll on phones.
- Customer payment: invalid/future dates and over-payment blocked before review, with a plain explanation.
- Opening balances paste: "1,000" / "1,000.50" / quoted CSV read correctly; unreadable lines listed, never dropped.
- Error messages: technical validation text ("rate: Input should be less than or equal to 100") shown as plain sentences ("Rate must be 100 or less").
- Chart of accounts, tax code, cost center, bank account, write-off limit, petty cash, asset forms: lengths/limits on inputs, required marks.
- Small: React NaN warning (petty cash), dialog heading nesting, Cashbook header and JE lines at 390 px.

**Fresh installs**
- Migrations stopped at s98: revision `s122_supplier_credit_days_nullable` is longer than Alembic's 32-character version column. The migration runner now widens the column first (harmless on existing databases).

## Data repaired in the dev DB
- 3 depreciation-run journals relabelled `DepreciationRun`; 12 ledger rows of 6 older reversals relabelled with their document (reversal labelling was fixed yesterday).
- Two future-dated QA documents (GRN dated 2999, petty cash expense dated 2030) moved to the day they were created.
- QA account with code "   " (id 9550) given the code `QA-UI-9550` (inactive).

## Deliberately not changed
- **Expense maker ≠ checker** — journals enforce it; for expenses a one-person shop must still be able to approve its own. Can be added if wanted.
- **Supplier payment rejection** — a pending supplier invoice payment can only be verified, not rejected. The amount owed now ignores pending payments (matches the ledger), but a wrong pending payment can't be withdrawn. Needs a small "Reject" action if wanted.
- **Credit landed costs can't be paid through Supplier Payments** (they aren't tied to a GRN of that supplier). They now show as owed; paying them needs a manual journal today.
- Bank deposit larger than the till, branch checks on every remaining document type, enum checks on the remaining free-text "method" fields — low risk, not changed to keep the change small.
- Old QA data gaps listed above are not "fixed" by editing history.

## QA records left in the dev DB
From the UI audit: draft JE-202611-0019 "QA-UI-JE validation probe"; inactive account QA-UI-9550; petty cash fund PCF-202611-0003 (open, branch QA-B2) with its expense and top-up; fixed asset FA-00004 "QA-UI-asset probe"; recurring journal "QA-UI-recurring" (inactive). Earlier: petty cash funds PCF-202611-0001/0002.

## Results after fixes

| Check | Before | After |
|---|---|---|
| Backend suite, dev DB | 2171 passed, 1 failed (future-dated rows) | **2199 passed, 0 failed** |
| Backend suite, fresh empty DB (migrate + seed) | could not migrate | **2180 passed, 0 failed, 19 skipped**; seed creates 77 accounts, main bank account, 2 asset classes |
| API fuzz (same 3,176+ cases) | 178 server errors, 282 accepted-but-wrong | **2 server errors → fixed afterwards** (cash-flow period 13, 10k-character settlement remark); 101 "accepted" left — mostly by design (opening-balance plug to 3900, cancelling a verified supplier settlement reverses it, far-future manual journal dates, reversing a reversal) or free-text fields where any value is valid |
| UI | expenses and supplier payments could not be started | both work; journal entry, periods, customer payment, opening balances re-checked in the browser |

Not re-checked in the browser against the new backend: the dev server on port 8020 was started outside this session at 09:27 and still runs the old code — restart it to pick up the backend fixes.
