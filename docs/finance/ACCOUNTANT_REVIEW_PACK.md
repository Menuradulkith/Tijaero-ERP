# Tijaero ERP — finance review pack for an accountant

Purpose: let a Sri Lankan accountant check, in about an hour, that the ERP books
transactions the way they expect. Everything below is what the software does
today (generated from its posting rules and verified by automated tests). Please
mark each section ✔ / ✘ and write corrections next to it.

## 1. Accounts the system posts to

Every automatic posting goes to one of these accounts. Each can be re-pointed
to another account in **Finance → Accounting Setup → Posting Rules** (per branch
or per expense category) without changing code.

| Group | Purpose | Default account |
|---|---|---|
| Cash & bank | Cash on hand / Bank (main) / Cheques in hand / Petty cash | 1010 / 1020 / 1040 / 1030 |
| | Bank charges / Bank interest received | 5184 / 4120 |
| Receivables | Customer receivables / Employee advances & loans | 1110 / 1130 |
| Inventory | Inventory / WIP / Goods in transit / Stock write-offs / Stock used as company assets | 1210 / 1230 / 1220 / 5186 / 1310 |
| Payables | Supplier payables / Supplier advances (asset) | 2010 / 2020 |
| Customer balances | Gift vouchers outstanding / Customer deposits / Customer credit notes | 2510 / 2520 / 2530 |
| Tax | Output VAT / Input VAT / VAT due to the IRD (after settlement) | 2210 / 1140 / 2220 |
| Payroll | Salaries payable / EPF payable / ETF payable / Other deductions / APIT payable | 2110 / 2120 / 2130 / 2140 / 2150 |
| | Salaries / EPF employer 12% / ETF employer 3% / Commission | 5110 / 5210 / 5220 / 5150 |
| Sales | Cash sales / Credit sales / Sales returns / Other income | 4010 / 4020 / 4030 / 4190 |
| Costs | Cost of goods sold / Discounts given / Bad debts & write-offs / Discount received / Expenses (default) | 5010 / 5160 / 5185 / 4110 / 5190 |
| Fixed assets | Accumulated depreciation / Depreciation / Gain / Loss on disposal | 1330 / 5170 / 4130 / 5187 |
| General | Opening balance equity / Rounding / Retained earnings / Current year P&L | 3900 / 5900 / 3100 / 3200 |

Question for you: ☐ Are these the account names and groupings you want on the statements?

## 2. What each document posts

| Document | Debit | Credit | When |
|---|---|---|---|
| Cash / card sale | Cash 1010 (card/bank: 1020) | Cash sales 4010, Output VAT 2210 | On completion |
| — cost of the sale | COGS 5010 | Inventory 1210 | Same time, at the stock's cost |
| Credit sale | Trade debtors 1110 | Credit sales 4020, Output VAT 2210 | On approval |
| Customer settles a credit sale | Cash / Bank / Cheques in hand | Trade debtors 1110 | On payment |
| Cheque bounces | Trade debtors 1110 | Cheques in hand / Bank | On bounce |
| Sales return | Sales returns 4030 (+ VAT) ; Inventory 1210 | Cash / Trade debtors ; COGS 5010 | On return |
| Customer write-off | Bad debts 5185 | Trade debtors 1110 | On write-off (within the user's limit) |
| Customer advance | Cash / Bank | Customer deposits 2520 | Received; applied: Dr 2520 / Cr 1110 |
| Gift voucher sold / used / expired | Cash ; 2510 ; 2510 | 2510 ; sale ; Other income 4190 | Unused remainder on a one-time voucher → 4190 |
| GRN (goods received) | Inventory 1210 | Trade creditors 2010 (cash PO: Cash/Bank) | On receipt, at PO price |
| Landed cost (freight, duty) | Inventory 1210 | Trade creditors 2010 (or Cash/Bank) | On entry |
| Supplier invoice | Input VAT 1140 | Trade creditors 2010 | Goods already owed from the GRN; invoice adds VAT |
| Supplier payment | Trade creditors 2010 | Cash / Bank | On verification |
| Supplier advance | Supplier advances 2020 | Cash / Bank | Applied: Dr 2010 / Cr 2020 |
| Purchase return | Trade creditors 2010 | Inventory 1210 | On approval |
| Expense | Expense account by category (default 5190) | Cash / Bank | On payment |
| Petty cash | Fund: Dr 1030 / Cr Bank; spend: Dr expense / Cr 1030; close: Dr Bank (counted) + shortage expense or surplus income / Cr 1030 | | |
| Bank deposit | Bank 1020 | Cash 1010 | On verification |
| Bank statement item (charge / interest) | Bank charges 5184 or Bank | Bank or Interest received 4120 | Entered from the statement |
| Payroll | Salaries 5110, EPF 12% 5210, ETF 3% 5220 | Salaries payable 2110, EPF payable 2120 (8%+12%), ETF payable 2130, APIT 2150, other deductions 2140, Employee advances 1130 (loan instalments) | On payroll approval |
| Salary paid / statutory paid | 2110 ; 2120 + 2130 | Bank | On payment |
| Employee loan | Employee advances 1130 | Cash / Bank | Issued; recovered through payroll or cash |
| Fixed asset bought | Asset account (class) | Bank / Cash / Trade creditors | On entry |
| Depreciation (monthly run) | Depreciation 5170 | Accumulated depreciation 1330 | Straight-line or declining, never below salvage |
| Asset sold / scrapped | Bank / Cash, Accum. dep. 1330, Loss 5187 | Asset cost, Gain 4130 | On disposal |
| VAT settlement | Output VAT 2210 | Input VAT 1140, VAT due 2220 | Monthly/quarterly, from the VAT return |
| Year-end close | Revenue accounts ; 3200 | 3200 ; expense accounts ; 3200 → Retained earnings 3100 | Only after the year has ended |

Questions: ☐ Credit sales recognised at approval (not at delivery) — OK?  ☐ Stock valued at PO price on receipt; COGS at the stock's recorded cost — OK?  ☐ Unused gift-voucher remainder to Other income — OK?  ☐ Supplier payable recognised on the GRN, invoice adds only VAT — OK?

## 3. Controls built in
- Every journal balances (debits = credits) or is refused; amounts are kept in cents.
- Manual journals: maker ≠ checker; header and inactive accounts can't be posted to; control accounts (debtors, creditors, inventory, VAT, cash) can only change through their documents.
- Closed accounting periods can't be posted into; documents can't be dated in the future.
- Reversals are mirror journals; nothing is deleted.
- Day-end check: trial balance balanced, cash/bank = cashbook, no failed postings, no unposted drafts.
- Write-off limits per user group.

## 4. Sri Lankan rates the system uses (checked against official sources, Nov 2026)

| Item | System | Official | Source |
|---|---|---|---|
| VAT standard rate | 18%; zero-rated and exempt codes | 18% since 1 Jan 2024, unchanged by Budget 2026 | IRD / Budget 2026 summaries |
| EPF | 8% employee, 12% employer on basic + EPF-liable allowances | Minimum 8% / 12% of total earnings | EPF Act No. 15 of 1958 (CBSL) |
| ETF | 3% employer only | 3% employer only | ETF Act No. 46 of 1980 (ETF Board) |
| APIT (Table 01, monthly) | Relief Rs 150,000; then 6% / 18% / 24% / 30% / 36% on the IRD bands | Same bands from 1 Apr 2025 | IRD APIT Table 01, 2025/26 |
| Stamp duty on salary | Rs 25 when pay > Rs 25,000 | Rs 25 on receipts > Rs 25,000 | Stamp Duty (Special Provisions) Act No. 12 of 2006 |
| Gratuity | ½ month's salary × completed years, after 5 years | Same, at the last drawn rate | Payment of Gratuity Act No. 12 of 1983 |

Not in the system yet — please say whether the businesses need them:
- ☐ **SSCL** (Social Security Contribution Levy, 2.5% of liable turnover).
- ☐ **WHT** on service payments to resident individuals (5% above Rs 100,000/month; scope widened from June 2026).
- ☐ **Tax invoice rules**: today the "TAX INVOICE" heading follows the "prices include VAT" switch. Under the VAT Act it should follow "VAT-registered seller selling to a VAT-registered buyer", and the buyer's VAT number should be on it.
- ☐ VAT registration threshold warning (Rs 15m a quarter / Rs 60m a year).

## 5. Reports to look at
Trial balance, income statement, balance sheet (Finance → Accounting), cash flow,
VAT return, cashbook and day-end reconciliation, receivables aging, supplier
balances, fixed asset register, payroll reports; Report Center for printable versions.
A worked example month is in section 6.

## 6. Example month (simulated, checked against a hand-made ledger)
A two-branch retailer, 1–3 Nov 2026: opening balances, 14 sales (cash, card, credit,
VAT 18%, discounts, a gift voucher, a customer advance, a return), a bounced cheque,
a write-off, 3 purchases with a supplier invoice, payment, advance, return and freight,
4 expenses, petty cash, a bank deposit and statement, a fixed asset and its
depreciation, rent, payroll for 3 staff with a loan, and the VAT settlement.

Every posting matched the hand-made ledger. Headline figures: revenue 235,000; cost
of sales 163,400; output VAT 19,620, input VAT 9,000, VAT paid 10,620; payroll gross
430,000 with EPF 8%/12% and ETF 3%; receivables 15,400; bank reconciliation difference
0.00. Details: `docs/qa/finance-hardening-2026-11-03.md`.

Please look at: ☐ the trial balance and balance sheet of a real month from one of your
clients, entered in the ERP, against your own working papers.
