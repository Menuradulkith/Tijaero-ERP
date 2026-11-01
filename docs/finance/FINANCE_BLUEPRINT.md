# Tijaero Finance Blueprint (learned from IFS Cloud)

_Written 2026-10-31. Sources: the IFS Cloud 27R1 finance components (`C:\27R1\workspace`: accrul, genled, payled, invoic, taxled, fixass, cshpln, sinwof, …) and Tijaero's current code in `backend/app/modules/finance`._

The IFS finance components hold more than 1,200 entities, but most of them are country localizations and file formats. The core ideas are small and can be copied. This document explains them in plain language, shows what Tijaero already has, and orders the gaps by importance.

---

## 1. Finance basics in five minutes

| Term | Plain meaning |
|---|---|
| **Chart of Accounts (COA)** | The list of "buckets" money is sorted into: Cash, Bank, Customers owe us (AR), We owe suppliers (AP), Sales, Rent expense, … |
| **Double entry** | Every transaction has at least two sides, and debits always equal credits. A cash sale of 100 is Dr Cash 100 / Cr Sales 100. |
| **Voucher / Journal entry** | One balanced transaction (header + lines). IFS calls it a *voucher*. |
| **General Ledger (GL)** | All posted vouchers. Once a voucher is posted it must never be edited; you fix mistakes by reversing it. |
| **Sub-ledgers (AR / AP)** | Per-customer and per-supplier detail: which invoices are open, partly paid or paid. The GL only shows the total. |
| **Period** | Usually a month. Closing a period stops anyone posting into it, so that reports stay stable. |
| **Dimension** (IFS: *code part*) | An extra tag on a GL line, such as branch, cost center, project or department. It lets you see profit per branch or project. |
| **Posting rule** (IFS: *posting control*) | A configuration table that answers "which account does this business event hit?", for example "sale of item group FOOD → account 4010". |
| **Trial balance / P&L / Balance sheet** | The three core reports. Profit & Loss = income minus expenses for a period. Balance sheet = what we own vs. owe on a date. |
| **Year-end** | Move the year's profit into Retained Earnings and start the new year with opening balances. |

---

## 2. What Tijaero already does well ✅

The code review confirmed all of these:

- **GL posting gateway** (`gl_posting_service.py`):
  - idempotent posting under an advisory lock;
  - balance check with rounding to account 5900;
  - closed-period guard;
  - failure outbox with retry/regenerate;
  - day-end reconciliation.
- **Auto-posting from almost every business event:** sales, returns, gift vouchers, GRN, landed cost, supplier and customer advances, credit settlements, expenses, payroll and statutory payments, commissions, bank deposits, manufacturing.
- **Manual journals:** draft → submit → approve → post. The approver must be a different person from the maker (maker ≠ checker), and manual entries cannot hit control accounts (AR, AP, Inventory).
- **Reversal and correction** of entries, never edit-in-place.
- **Periods:** open → closed → locked, with a pre-close check. A 3-step year-end closing posts to retained earnings.
- **Reports:** trial balance, account ledger, GL listing, P&L, balance sheet, cash-flow statement, audit trail, AR/AP aging.

This is already a solid base, comparable to IFS's "voucher + GL + period" core.

---

## 3. Gap analysis vs. IFS: what to add, in priority order

### 🔴 Priority 1: Foundations (do these first; everything else builds on them)

**1.1 Configurable posting rules (IFS posting control)**
- **Today:** account codes are Python constants (`ACCT_VAT_PAYABLE = "2210"` in `purchase_expense_payroll_gl.py:89-108`, `accounting_integration.py:82-96`, plus the `EXPENSE_CATEGORY_MAP` dict). Any change needs a developer.
- **IFS idea, simplified:**
  - `posting_types`: system-defined business events. Examples: `SALES_REVENUE`, `COGS`, `INVENTORY`, `AP_TRADE`, `AR_TRADE`, `OUTPUT_VAT`, `INPUT_VAT`, `CASH`, `BANK`, `ROUNDING`, `FX_GAIN`, `FX_LOSS`, `DEPRECIATION`, …
  - `posting_rules`: `(posting_type, control_type, default_account, valid_from)`. `control_type` is what decides the account: *none (fixed)*, *item category*, *customer group*, *supplier group*, *expense category*, *tax code*, *payment method*, *branch*.
  - `posting_rule_details`: `(rule_id, control_value, account, valid_from)`, for example item category `RAW` → 1220 and `FG` → 1210.
- **Hook point:** the hook functions call `resolve_account("INVENTORY", item_category="RAW")` instead of using constants. Seed the rules with today's constants so behaviour does not change.
- **UI:** a "Posting Rules" page with one row per business event, a dropdown for the account, and an optional "split by" table.
- **Why first:** tax, multi-bank, fixed assets and FX all need new accounts. Building them on hard-coded constants makes the problem worse.

**1.2 Purchase invoice posts to the GL (GRNI accrual)**
- **Today:** AP is recognised at GRN (Dr Inventory / Cr 2010), and the purchase invoice posts nothing. Price differences and input VAT never reach the GL.
- **Standard practice (IFS, SAP, Odoo):**
  - At GRN: Dr Inventory / Cr **GRNI** (Goods Received Not Invoiced, a liability clearing account).
  - At invoice: Dr GRNI (the received value) + Dr Input VAT + Dr/Cr **Price Variance** / Cr **AP Supplier**.
- **Result:** AP equals real supplier invoices, VAT can be reclaimed, and GRNI shows deliveries still waiting for an invoice.
- **States** (IFS `Invoice.entity`): Draft → Posted → (Authorized) → Partly paid → Paid, plus Cancelled. Only authorized invoices can be paid.

**1.3 Tax codes and input VAT (IFS `StatutoryFee` + taxled)**
- **Today:** a flat `tax_rate` and a single output VAT account 2210, with no input VAT and no VAT return.
- **Add:**
  - a `tax_codes` table: code, rate, type (VAT / Exempt / Zero-rated / Withholding), output account, input account, valid dates;
  - a tax code on sales and purchase lines;
  - a `tax_transactions` row written on every taxed posting (base amount, tax amount, direction, document).
- **Report:** a **VAT return report** per period (output VAT − input VAT = payable), plus a "VAT settlement" voucher that clears both to VAT Payable.

**1.4 Dimensions on GL lines: cost center (and project later)**
- **Today:** branch only. `Expenses.cost_center` exists but never reaches the GL.
- **IFS idea:** each account says whether a dimension is **Mandatory, Optional or Blocked**. For example, expense accounts require a cost center and balance-sheet accounts block it.
- **Add:**
  - nullable `cost_center_id` and `project_id` on `journal_entry_lines` and `general_ledger`;
  - the per-account requirement flags;
  - a cost-center master.
- **Reports:** P&L filtered by branch and cost center.

### 🟠 Priority 2: Daily money operations (what accountants use every day)

**2.1 Bank accounts master + bank reconciliation** (IFS `CashAccount`, `BankStatement`, matching handlings)
- **Today:** one bank account (1020), no statement import, no reconciliation.
- **Add:**
  - a `bank_accounts` table: name, bank, account number, currency, GL account;
  - statement import (CSV/Excel);
  - **auto-match** on amount, date ±3 days and reference, with **manual match** for the rest;
  - creation of missing entries (bank fees, interest) from unmatched lines;
  - a "reconciled" flag on GL bank lines.
- This is the #1 control auditors check.

**2.2 Payment terms with due dates** (IFS `PaymentTerm`, `PaymentTermDetails`)
- A term such as "Net 30", "50% now / 50% in 60 days" or "2% discount if paid in 10 days" calculates invoice due dates automatically.
- Aging then uses **due date**, not invoice date.

**2.3 Customer payment matching screen** (IFS `MixedPayment`)
- One screen: pick a customer, enter the amount received, and see all open invoices.
- Tick the invoices to settle. Any remainder becomes **on-account / advance** or a **small-difference write-off**.
- Tijaero's `InvoicePayment` is one-invoice-per-row; this generalises it, the same way AP already does with `PurchaseInvoicePayment`.

**2.4 Write-offs with limits** (IFS `WriteOffCode`, `WriteOffCodeLimit`)
- Reasons (bad debt, rounding, small difference) each map to a GL account.
- A maximum write-off amount per user role.
- Today there is no write-off function at all.

**2.5 Cheque lifecycle**
- Statuses: received → deposited → cleared / **bounced**.
- A bounced cheque reverses the payment and reopens the invoice.

**2.6 Supplier payment proposal** (IFS `PaymentProposal`)
- "Show me everything due by Friday" → review → approve → create payments, with an optional bank file export.

**2.7 Customer statements + reminders** (IFS `ReminderTemplate`, `ReminderLevel`)
- **Customer statement PDF:** opening balance, invoices, payments, closing balance.
- **Dunning levels:** for example level 1 at 7 days overdue (friendly), level 2 at 30 days (firm), level 3 at 60 days (final, with credit block). Run it as a "reminder proposal" that generates letters or emails.
- Credit limit and block are partly present already (`customers/credit_service.py`).

### 🟡 Priority 3: Period-end and assets

**3.1 Fixed assets** (IFS `FaObject`, `FaMethod`, `DeprProposal`)
- **Asset register:** asset class (default accounts, life, method), cost, acquisition date, salvage value, status (Active / Sold / Scrapped).
- **Methods:** straight-line, and declining balance with an optional switch to straight-line.
- **Monthly depreciation run:** proposal → review → post, with rollback allowed.
- **Disposal:** sale or scrap, with automatic gain/loss posting.
- **Create the asset from a purchase invoice line.**
- A separate tax book can come later.

**3.2 Better period control** (IFS `AccPeriodLedgerInfo`, `UserGroupPeriod`)
- Rename the statuses to Open / Closed / **Finally closed** (Tijaero already has open / closed / locked).
- Add a **role override**: the "Finance Manager" role may still post into a Closed (but not Finally closed) period for adjustments.
- Add special **period 0 (opening)** and **period 13 (closing)**, so year-end entries don't distort December figures.

**3.3 Year-end in two steps + opening balances**
- **Preliminary year-end** computes provisional opening balances so the new year can start before the audit is done.
- **Final year-end** posts the closing voucher to period 13 and the opening voucher to period 0.
- Also add an **opening balance import** (Excel) for new customers moving to Tijaero.

**3.4 Recurring and auto-reversing journals** (IFS `VoucherTemplate`, `PeriodAllocation`)
- **Templates:** "monthly rent", posted on schedule.
- **Accruals:** "reverse on the 1st of next month" ticked on a journal.
- **Prepaid spreading:** split a 12-month insurance invoice over 12 periods.

**3.5 Voucher types and number series** (IFS `VoucherType`, `VoucherNoSerial`)
- Prefix per source: `MJ` manual, `SI` sales invoice, `PI` purchase invoice, `CR` cash receipt, `CP` cash payment, `DP` depreciation, `OB` opening, `YE` year-end.
- Gap-free numbering per year, for example `PI-2026-000123`.
- Auditors like this, and users can tell at a glance where an entry came from.

**3.6 Inventory adjustments post to GL**
- Stock adjustments, write-offs and transfers currently have no GL hook.
- Add posting types `INV_ADJUST_GAIN` / `INV_ADJUST_LOSS` / `INV_WRITE_OFF`.

### 🟢 Priority 4: Planning and insight

- **Budgets** (IFS `BudgetVersion`, `BudgetPeriodAmount`): enter a budget per account + cost center per month, import from Excel, and report **Budget vs Actual** with variance %.
- **Financial statement layouts** (IFS `ReportingStructure`): a configurable tree of P&L and balance-sheet lines instead of fixed account-type grouping, with comparative columns (this month vs. last month, this year vs. last year).
- **Cash forecast** (light IFS cshpln): bank balance today + AR by due date − AP by due date ± manual recurring items (salaries, rent), shown per week for 13 weeks.
- **Pre-aggregated balances table** (IFS `AccountingBalance`): balance per account, period and dimension, so reports stay fast as the GL grows.

### ⚪ Priority 5: Only when a customer needs it

- **Multi-currency:** currency + rate + foreign amount on GL lines, rate table (`CurrencyRate` with types), realized FX on payment, and month-end **revaluation** with auto-reverse. Do it after posting rules, because it needs FX gain/loss accounts that don't exist yet.
- **Withholding tax** on supplier payments.
- **AP invoice approval workflow** by amount and cost center (IFS sinwof).
- **Interest on overdue invoices.**
- **Multi-company / consolidation.**

### ❌ Skip (IFS enterprise-only)

Internal/parallel ledgers (add only a `ledger_id` hook), IFRS 15 revenue recognition, IFRS 16 leasing, multi-company cost allocation, generic external-file engines, e-invoicing standards, bill of exchange, SEPA mandates, and all country localizations.

---

## 4. Making it user-friendly (people without finance knowledge)

IFS is powerful but hard to use. These are the main things to do differently:

1. **Hide debits and credits in daily screens.** Users see "Money received from customer", "Pay supplier" and "Record expense". The system writes the journal entry. Only the Journal Entry page shows Dr/Cr.
2. **"Show accounting" drawer** on every document (invoice, GRN, payment): it shows the GL lines that document created, with a link to the journal. This builds trust and helps people learn.
3. **Setup wizard:** choose an industry template COA → set the fiscal year start → bank accounts → tax codes → opening balances. Posting rules come pre-filled; there is nothing to configure on day 1.
4. **Smart defaults:** posting rules decide accounts and payment terms decide due dates. Tax code comes from the item, cost center from the user or branch.
5. **Plain-language validation messages:** "This period (Sep 2026) is closed. Ask a Finance Manager to post an adjustment" instead of "Period status C".
6. **Month-end checklist page:** bank reconciled ✓, depreciation run ✓, posting failures = 0 ✓, VAT report reviewed ✓ → *Close period*. Tijaero's pre-close check is the start of this.
7. **Dashboard:** cash in bank, receivables due this week, payables due this week, overdue customers, this month's profit vs. budget.

---

## 5. Suggested roadmap

| Phase | Contents | Why this order |
|---|---|---|
| **A** ✅ | Posting rules (1.1) + voucher types (3.5) | Unblocks everything; no behaviour change if seeded from current constants |
| **B** ✅ | Tax codes + input VAT + VAT report (1.3), purchase invoice GL / GRNI (1.2) | Legal correctness; VAT is money the business is losing |
| **C** ✅ | Bank accounts + reconciliation (2.1), payment terms (2.2), payment matching + write-offs (2.3, 2.4), cheque lifecycle (2.5) | Daily accountant work; audit control |
| **D** ✅ | Cost center dimension (1.4), inventory adjustments to GL (3.6) | Better management reporting |
| **E** ✅ | Fixed assets (3.1), recurring/auto-reverse journals (3.4), period 0/13 + two-step year-end (3.2, 3.3) | Month-end and year-end completeness |
| **F** | Customer statements + reminders (2.7), supplier payment proposal (2.6) | Collections and cash control |
| **G** | Budgets, statement layouts, cash forecast, balances table | Planning and insight |

---

## 6. Small issues found during the review (fix anytime)

- `ACCOUNTING.md` mentions accounts that don't exist in the seed: 1710 (the seed has 1330 for accumulated depreciation), and 8000/8010 for FX. It also describes a Depreciation page that doesn't exist.
- `backend/app/reporting/financial_reports.py` is a stub that returns zeros.
- `finance/api.py`: `/expenses/export-csv` and `/bank-deposits/export-csv` are declared after `/{id}` routes. This may be the same route-shadowing bug as QA item F-9 (not tested live).
- The Payment Vouchers page (`frontend/src/modules/finance/pages/PaymentVouchersPage.tsx`) is still a placeholder.
- The `PurchaseInvoice` docstring says "AP is recognized here, not at GRN", but the code does the opposite (see 1.2).

---

## 7. Phase A: what was built (2026-10-31)

- **Posting types** (`backend/app/modules/finance/posting_rules.py`): 36 system-defined business events (CASH, BANK, INVENTORY, AP_TRADE, OUTPUT_VAT, EXPENSE, ROUNDING, RETAINED_EARNINGS, …). Each has a default account (today's code), the allowed account types, and the allowed splits.
- **Rules** (`posting_rules`, `posting_rule_details`, migration `s114`):
  - **Same account everywhere**, **split by branch** (any type except year-end), or **split by expense category** (EXPENSE).
  - No rule means the built-in default, so nothing changed until someone edits a rule.
- **How it plugs in:** the module constants (`ACCT_BANK_ACCOUNT`, …) are now `PostingRef` values. Each is a `str` equal to the default code that also carries its posting type. `GLPostingService.post` resolves them before validating, so all hooks work without per-call changes.
  - Failure payloads keep the posting type, so a retry after fixing a rule uses the new account.
  - Cashbook and day-end reconciliation treat any account a CASH / BANK / CHEQUES_IN_HAND rule points to as cash.
  - Year-end closing and the trial-balance retained-earnings line resolve through the rules.
- **Voucher types** (`voucher_types`, `journal_entries.voucher_type`):
  - Derived from the existing JE prefix (`JE-SALE-…` → SALE; manual → MJ; closing → YE); a reversal keeps its original's type.
  - Existing entries were backfilled. Names can be edited.
  - Journal Entries has a Source column and filter.
- **UI:** Finance → Accounting → **Accounting Setup** (Posting Rules and Voucher Types tabs). Editing needs `chart_of_accounts:update`. Only active, postable accounts of the right type can be chosen.
- **Deferred:**
  - Valid-from dating of rules.
  - Item-group / customer-group control types; these need the hooks to pass item and customer data.
  - Per-year gap-free numbering and per-user voucher-type rights. JE numbers still follow the existing `PREFIX-YYYYMM-NNNN` scheme.


## 8. Phase B: what was built (2026-10-31)

- **Tax codes** (`tax_codes`, Accounting Setup → Tax Codes):
  - Seeded: VAT 18% (default for sales and purchases), ZERO, EXEMPT.
  - Types: standard / zero-rated / exempt. Each code is for sales, purchases or both. One default per direction.
  - A code already used on posted entries keeps its rate and type. When the law changes, create a new code.
- **Tax ledger** (`tax_transactions`):
  - One row per VAT line of an automatic posting, written by the gateway from lines built with `tax_service.vat_line()`.
  - Returns and cancellations are negative rows. Reversing a journal entry by hand negates its rows.
  - Existing sales and sale-return VAT was backfilled from the 2210 lines.
- **Supplier invoices:**
  - Creating one posts Dr 1140 Input VAT / Cr 2010 for the VAT and Dr 2010 / Cr 4110 Discount Received for any discount (voucher type PINV). Trade Creditors then equals the invoice total.
  - Editing the amounts re-posts; cancelling reverses.
  - The invoice form now has a tax code and a VAT amount (suggested from the rate, editable). The VAT is spread over the lines.
- **VAT Return** (Finance → Accounting → VAT Return):
  - Output and input VAT by tax code and rate for any period, with the documents behind each line.
  - A GL cross-check warns when the VAT accounts moved outside the ledger, e.g. through a manual journal.
  - **Settle VAT up to a date** clears every unsettled row into 2220 VAT Due to Tax Authority (voucher type VAT) and marks the rows settled. Paying the tax authority is then a normal payment from 2220.
- New posting types: INPUT_VAT (1140), VAT_SETTLEMENT (2220), PURCHASE_DISCOUNT (4110).
- **Decision: no GRNI account.** Tijaero's three-way match forces invoice price = PO price, and supplier payments, advances, credit settlements and returns all work against the GRN's Trade Creditors entry. Moving the liability from the GRN to the invoice would break those flows. So the GRN keeps booking the goods and the invoice adds the VAT and discount. Revisit GRNI only if price differences between invoice and PO are ever allowed.
- **Not yet covered:**
  - Untaxed sales (0%, exempt) don't appear on the return: only lines with VAT are recorded.
  - No withholding tax. No printed return form in the tax authority's layout.
  - Supplier invoices created before this phase have no VAT posting (the dev data had none).


## 9. Phase C: what was built (2026-11-01)

- **Bank accounts and reconciliation** (Finance → Accounting → Bank Reconciliation; `bank_reconciliation.py`, migration `s116`):
  - Bank accounts are tied to a leaf GL account. Adding one creates its ledger account under 1000 by default. "Main bank account" on 1020 is seeded.
  - Statements are entered by CSV import (parsed in the browser: separate withdrawal/deposit columns or one signed amount, several date formats) or typed by hand.
  - Unambiguous lines match automatically (same amount, within 5 days, reference used to break ties); the rest are matched by hand. One line can clear several entries if the totals agree.
  - Bank-only items (charges, interest) are booked from the line and matched in one step (voucher BREC, posting types BANK_CHARGES 5184 / BANK_INTEREST 4120).
  - The summary shows books − not yet on the statement + only on the statement vs. the closing balance. "Finish" requires a zero difference and no unmatched lines, then locks the statement (Reopen undoes it).
  - A reversed entry and its reversal drop off the outstanding list together.
- **Payment terms** (`payment_terms.py`, `s117`; the terms list was later removed, see section 12):
  - Terms are N days or N days after month end, with 8 seeded.
  - Credit sales now **store** their due date (backfilled as invoice date + credit days), so aging, overdue checks and the outstanding-documents report no longer re-age old invoices when a customer's terms change.
  - Customers and suppliers can have a `payment_term_id`; their forms still show the days picker.
- **Customer write-offs** (Finance → Accounting → Customer Write-offs; `write_off_service.py`, `s118`):
  - Each write-off has a reason. It posts Dr 5185 Bad Debts & Write-offs / Cr 1110 (voucher WOFF), lowers the invoice balance with the same rules as a settlement, refreshes the customer's credit, and is left out of aging.
  - A limit is set per user group (Accounting Setup → Write-off Limits); superusers have none. A write-off can be reversed.
- **Cheque register** (`cheque_service.py`, `s118`):
  - Statuses: in hand → deposited (when the cheque's bank deposit is confirmed; settlement cheques start deposited because the settlement books them to 1020) → cleared or bounced. Status and actions appear on the Cheque Payments page.
  - A bounce posts Dr 1110 / Cr 1040 or 1020 (voucher CHQB) and puts the debt back on the customer.
    - Sale cheque: the invoice becomes owed and its pending deposit is cancelled.
    - Settlement cheque: the settlement transaction is rejected and the balance reopens.
- **Not done / follow-ups:**
  - The customer and supplier forms don't offer the new terms list yet (end-of-month terms can only be assigned through the API).
  - A multi-invoice customer payment is still one request per invoice, so it isn't atomic.
  - No supplier payment proposal (moved to phase F as planned), no bank-file export, no editing of bank accounts in the UI, and no Dr/Cr indicator column in CSV import.
  - Supplier-side GRN aging still uses credit_days.


## 10. Phase D: what was built (2026-11-01)

- **Cost centers** (Accounting Setup → Cost Centers; `cost_centers.py`, migration `s119`):
  - `cost_center_id` on journal lines and GL rows. Only income and expense lines carry one; balance-sheet lines never do.
  - A line gets the cost center it names (manual journal line, or an expense's `cost_center` code), else the branch's default cost center, else none.
  - Accounts can be flagged "needs a cost center", which is enforced on manual journals.
  - Reversals keep the original cost center.
  - The Journal Entries editor shows a cost-center column once any cost center exists.
  - **Profit by Cost Center** report (Finance → Accounting).
- **Stock movements now post** (`stock_gl.py`, valued at the PO line price, else product cost):
  - Marking a unit damaged: Dr 5186 Stock Write-offs / Cr 1210. Back to sellable reverses it.
  - Cross-branch transfer, on receipt: source branch Dr 1220 / Cr 1210, destination Dr 1210 / Cr 1220. Damaged arrivals are written off at the destination. Moves within one branch post nothing.
  - Stock moved to company assets: Dr 1310 / Cr 1210, and back on return.
  - Voucher type STK. New posting types: GOODS_IN_TRANSIT, INVENTORY_WRITE_OFF, COMPANY_ASSETS.
- **Not done / caveats:**
  - There is no stock-take / count-adjustment document in Tijaero yet, so there is nothing to post. It would be a new feature.
  - COGS is valued at tier/product cost while GRN and these movements use PO cost, so small differences can remain in 1210 until costing is unified.
  - Existing GL history has no cost centers.
  - The expense form's cost-center field is free text; only values matching a cost-center code are used.


## 11. Phase E: what was built (2026-11-01)

- **Fixed assets** (Finance → Accounting → Fixed Assets; `fixed_assets.py`, migration `s120`):
  - **Asset classes:** cost account, method and life. Seeded EQUIP (1310, 5 years) and FURN (1320, 8 years).
  - **Register:**
    - Registering an asset can book its purchase from bank, cash, supplier or opening balance equity, or just record an asset that is already in the books.
    - Assets brought in with depreciation already taken are supported.
    - Depreciation starts the month after a mid-month purchase.
  - **Monthly depreciation run:**
    - Straight-line, or declining balance with a yearly rate; never below the end-of-life value.
    - Posts per branch: Dr 5170 (the asset's cost center) / Cr 1330.
    - One run per month. Only the latest run can be reversed.
  - **Sell or scrap:** Dr 1330, Dr bank/cash, Cr asset cost, with the gain to 4130 or the loss to 5187 (voucher FA).
- **Recurring journals** (Finance → Accounting → Recurring & Opening):
  - Templates repeat monthly, quarterly or yearly. "Create due journals" makes a draft journal for every due date up to today (catching up missed months); each still needs approval.
  - "Reverse next month" turns them into accruals.
- **Auto-reversing journals:** a journal can carry a "Reverse on" date. Posting it also posts the reversal on that date.
- **Opening balances:** paste "account code, debit, credit" lines. The result is one draft "Opening" journal (voucher OB); control accounts are allowed, and any difference goes to 3900 Opening Balance Equity.
- **Closed periods stay closed.** A closed-period override was tried and then removed (2026-11-01): reopening a closed (not locked) period already covers adjustments, and keeping "closed means closed" is simpler.
- **Not done:**
  - Special opening/closing periods (0 and 13) and the two-step year-end. Every report reads periods 1-12, so this needs its own careful change.
  - Opening balances for receivables and payables don't create customer or supplier open items; use the existing customer/supplier opening fields for those.
  - Stock moved to company assets (1310) isn't linked automatically to a fixed-asset record; register it with "already in the books".
  - No partial-month depreciation at disposal.


## 12. Sri Lanka clean-up (2026-11-01)

The finance module is aimed at Sri Lankan SMEs, so features that don't fit were removed (migration `s121_simplify_finance`):
- **Posting rules split by tax code:** removed (one VAT regime).
- **"Account needs a cost center" rule:** removed; branch default cost centers cover it.
- **Voucher-type renaming:** removed; the list is read-only.
- **Payment Terms list** and the customer/supplier `payment_term_id`: removed. Credit days decide due dates, and credit sales still store their due date.
- **Closed-period override:** removed (see section 11).

Kept as standard: VAT 18 % / zero-rated / exempt and the VAT Return, bank reconciliation, the cheque register, write-offs with limits, fixed assets (straight-line and reducing balance under LKAS 16), EPF/ETF/APIT postings, cost centers, recurring journals and opening balances.

QA after the clean-up: `docs/qa/finance-2026-11-01.md`.
