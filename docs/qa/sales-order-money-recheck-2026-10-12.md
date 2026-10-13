# Sales Order money-integrity RE-AUDIT - 2026-10-12

Scope: API only (backend http://localhost:8020/api/v1, admin superuser), read-only SQL on Postgres. Re-run, with fresh orders, of every finding of `sales-order-money-2026-10-11.md` plus a general matrix. Nothing was fixed or deleted. Known drift (no `fn_insert_cashbook_entry`, empty `cashbook_entries`, day-end `is_balanced` false because of it) is not reported again.

Data created (all `QA-RECHECK` / branch `QA-RCK`): 125 sales orders (93 completed, 11 approved credit, 13 cancelled, 8 pending credit), 18 sale returns (17 processed, 1 pending left by the hardening test), 52 credit settlement records, 30 gift-voucher sale JEs, 305 JEs, 32 customers (QA-RECHECK-*), 3 products (QA-RECHECK-P1/P3/P4), 1 PO + GRN (GRN-QA-RCK-26000001 through the new `POST /purchasing/grn/receive`: 80 + 30 serial units, 3,000-unit lot).

## 0. READ FIRST - the hardening test polluted the dev database (needs a manual clean-up)

The input-hardening matrix found that `POST /finance/credit-notes`, `POST /finance/advance-payments` and `POST /customers/vouchers/` accept `1e30` and **post it to the ledger**. Because nothing may be deleted, these rows are still there:

| Record | Posting |
|---|---|
| credit note 160 (customer QA-RECHECK-HARD3, id 17944) | Dr 4030 / Cr 2530 1,000,000,000,000,000,000,000,000,000,000.00 |
| customer advance 106 (same customer) | Dr 1010 / Cr 2520 1e30 |
| gift voucher 458 (`QAH6075753300`) | Dr 1010 / Cr 2510 1e30 |
| also created without any JE: credit notes 159 (-1.00), 162 (-5.00), 163 (0.00), advances 105 (-1.00), 108 (-5.00), 109 (0.00) | none |

Effect: every JE still balances in SQL, but the trial balance / balance sheet / income statement endpoints now show Dr != Cr by 2 and `is_balanced: false` because the report code adds the 1e30 rows in a 28-digit Decimal context (rounding). The reports were verified **before** this pollution (section 5, all green) and the SQL trial balance excluding those three references is exactly balanced (Dr = Cr = 44,001,409,432.30). The same company-wide TB also contains 20,000,000,000 + 1,000,000,000 of QA settlement cash from the M7 test (an order of 19,999,999,999.80 that the API accepted, settled in full with 20 x 999,999,999.99 cash payments) - harmless but it dominates the figures. Clean-up: delete GL rows / JEs / records of the three references above (and the customer 17944 records) or reset the QA data.

## 1. Result in one table (first audit findings)

Counts: 35 findings re-tested -> **Fixed 31, Partly 4, Still open 0, New regression 1** (plus new findings in section 3).

| # | Area | Before | After (this re-run) | Status |
|---|---|---|---|---|
| C1 | Revenue JE with discount/coupon | JE failed, cash/revenue missing | header 10% of 250 (cash 225): Dr 1010 225 / Cr 4010 225, no 5160 pair; fixed 20 off 200; coupon 20 off 200; line 10% + tax 5%; inclusive tax 105; hdr 10% + tax 5% split tender; hdr 10% + coupon 20 on 250 (207.00): all exact, balanced. Old failed orders 3972/3973/4125/4149 re-posted (8 GL rows each), failure rows 590/591/598/599 now `resolved`; 0 new posting failures. Single-use coupon: 1 of 5 parallel orders accepted | Fixed |
| C2 | Parallel credit-note redemption | 5 x 201, redeemed 260 of 100 | 5 parallel redemptions of 40 with 40 left -> [201,400,400,400,400], redeemed 100.00 of 100.00 issued, balance 0, redeem 50 of 40 refused | Fixed |
| C3 | Credit-note refund balance | balance 0 | return refunded as credit note: credit-balance 200.00, JE Dr 4030 200 / Cr 2530 200, redeeming 100 later works (balance 100); `invoice.credit_note_amount` stays 0 | Fixed |
| C4 | Partial return with discount + tax | refund 105.00 | 2 x 100, line 10%, tax 5% excl (paid 189): return 1 -> 94.50 (90.00 + 4.50), JE Dr 4030 90 / Dr 2210 4.50 / Cr 1010 94.50; 2nd unit 94.50 (sum 189.00); 3rd refused. Header 10% + tax 5%: 94.50 + 94.50. 3 x 33.33: three returns sum 99.99 | Fixed |
| C5 | Voucher amount without voucher | 201, discount given | 400 (no id) and 400 (unknown id) | Fixed |
| C6 | Voucher sale JE | none | cash 350 / card 80 / bank 80: Dr 1010 or 1020 / Cr 2510; fully redeemed voucher nets 2510 to 0; reuse of claimed voucher refused; redeem 150 of 100 refused | Fixed |
| C7 | Income statement | revenue +114,550 | 4030 shown as contra; net income = TB (revenue accounts - expense accounts) exactly; today's period equals GL movement | Fixed |
| H1 | Balance sheet | assets 0, not balanced | `is_balanced: true`; assets, liabilities and equity (incl. current-year earnings) equal the TB by section | Fixed |
| H2 | Inventory via GRN | nothing posted | `/purchasing/grn/receive` of 80 x 100 + 30 x 50 + 3,000 x 1.00 posts Dr 1210 12,500.00 (= PO value) / Cr 1020 12,500.00; branch 1210 = 12,500 - net COGS. Legacy 1210 balance (-419,431 company-wide) is history from sales before the fix | Fixed (new receipts) |
| H3 | Returned order balance | balance_due = refund | full / partial returns: balance_due 0, paid_amount reduced, `payment_status refunded` | Fixed |
| H4 | Pending / rejected settlements | outstanding wrong | pending 30 transfer: outstanding 200 -> unchanged; rejected: unchanged; second 30 verified: 170, invoice paid 30 / balance 170 = live balance | Fixed |
| H5 | Credit released after return | outstanding 300 | credit 200 returned: outstanding back to 100, left 4,900, JE Dr 4030 / Cr 1110, no credit note issued for an unpaid sale; partial 1 of 2: balance 100, outstanding 100; part-paid credit (50 + 150) returned: Dr 4030 200 / Cr 1110 150 / Cr 1010 50 | Fixed |
| H6 | Sales report / statistics | counted cancelled, wrong totals | `/reporting/sales` total_orders 104 and total_sales 21,000,012,742.72 = SQL (completed + approved, net of returns); statistics pending_approval 8 = SQL; export-csv rows/total = SQL; top_products now branch-filtered (but see N7) | Fixed |
| H7 | Customer statement | included cancelled/pending | 31 customers: statement current_balance = live posted balance_due = GL 1110 of the customer's documents (pending credit orders are not on the statement by design; outstanding includes them) | Fixed |
| H8 | Advance applied | dropped | advance 150 + cash 50 on 200: grand 50, advance applied 150 / remaining 0, JEs Dr 1010 50 / Dr 2520 150 / Cr 4010 200; reuse refused; 5 parallel orders -> 1 accepted; cancel of a pending order restores the advance (remaining 300) | Fixed (see N5) |
| H9 | return-full inclusive / header discount | 400 | inclusive 105: refund 105.00 (100 + 5), header 10% (paid 180): refund 180.00 | Fixed |
| H10 | Rejected transfer deposit | stays pending | deposit `rejected`, verify -> 400 | Fixed |
| H11 | paid + balance = grand_total | 200 vs 100 | credit 200 with voucher 100: paid 0 + balance 100 = grand 100 on create, GET, approve and after settlement | Fixed |
| M1 | Rounding | half-even | 1.005 -> 1.01, 0.025 -> 0.03, 10.125 -> 10.13, tax 0.51 / 0.53, 7 x (19.99 less 10%) at 12% = 141.04, 3 x 33.33 at 12.5% = 87.48 foots | Fixed |
| M2 | Zero price | 201 | 422 for 0 and 0.004 | Fixed |
| M3 | Partly paid credit status | unpaid | `partial` on create, after approve, `paid` after settlement | Fixed |
| M4 | Cancelled credit order | balance 200 | balance_due 0, credit_amount 0 | Fixed |
| M5 | Settlement dates | accepted | 2020-01-01, 2027-11-15, 0001-01-01 -> 400 | Fixed |
| M6 | Credit-limit override | negative left, no lock | 600 + 600 on 1,000: left 0 (clamped), outstanding 1,200, approval remark "CREDIT LIMIT OVERRIDDEN ... exceeds limit by Rs. 200.00"; pending order already counts (left 400); 5 parallel overrides: 5 x 201, outstanding 3,000 = live balance, left 0, no 5xx; cancelling restores | Fixed |
| M7 | Huge order total | 201 then 500 | 20 x 999,999,999.99 order (19,999,999,999.80) still 201 and approve now 200 (no 500, left clamped to 0) - no explicit per-order cap | Partly |
| M8 | `/customers/{id}/credit-settlements` | 500 | 201, invoice 200 -> 50 paid / 150 balance, GL 1110 150, outstanding 150, overpay 151 refused | Fixed |
| M9 | Print data | no discount line | discount, coupon, gift voucher, credit note, advance, tax-included lines present and foot (subTotal + vat + adjustments = netTotal = grand_total). Card service charge has no line (N6) | Partly |
| M10 | Voucher forfeiture | silent | 500 voucher redeemed 100: forfeit Dr 2510 400 / Cr 4100 400; 2510 life-cycle nets 0 | Fixed |
| M11 | Service charge account | 4110 | card_visa 205.40 (2.7%): Dr 1020 205.40 / Cr 4010 200 / Cr 4100 5.40; card 205 with adjustment 5: Cr 4100 5.00 | Fixed |
| M12 | Cost of sales | in opex | `cost_of_sales` holds 5010, gross_profit = revenue - cost_of_sales | Fixed |
| L1 | Cash tolerance | short accepted | 199.96 / 199.99 refused; over-tender 200.04 / 205 / 250 -> change_due 0.04 / 5 / 50, books 200.00, no 5900 | Fixed |
| L2 | Cheque in hand | Dr 1020 | cheque sale Dr 1040, deposit verify moves 1040 -> 1020 (BankDeposit JE); split cash + cheque Dr 1010 / Dr 1040. Cheque credit SETTLEMENT still Dr 1020 (N3) | Partly |
| L3 | Deposit status | stays pending | `confirmed` after bank-transfer verify | Fixed |
| L4 | Strict types | coerced | sales order body: `true`, `"2"`, tax 100, qty 1.5, cash true -> 422. Settlement `payment_amount` still coerces `true` and `"1e2"` (N2) | Partly |
| L5 | left_credit while pending | stale | 10,000 -> 9,800 on create of a pending 200 | Fixed |

Regression: **R1** below.

## 2. Remaining discrepancies (Area | Scenario | Expected | Actual | Severity)

| ID | Area | Scenario | Expected (Decimal) | Actual | Severity |
|---|---|---|---|---|---|
| R1 | Hardening (NEW REGRESSION) | `POST /sales/` with an explicit JSON `null` on an optional id/money/percent field: `customer_agent_id`, `agent_commission_rate`, `agent_commission_amount`, `cupon_id`, `gift_voucher_id`, `customer_advance_payments_id`, `customer_advance_amount`, `source_quote_id`, item `discount_percent`, `discount_amount`, `price_tier_id`. Also `settle-payment` with `service_charge_amount: null` | 201 (null = absent) or 422 | **500** for every one (pydantic TypeError "Unable to apply constraint 'ge' to supplied value None" raised by the `OptId` / `OptMoney` / `OptPercent100` aliases in `sales/schemas.py`); one case also dropped the connection. `credit_terms`, `cheque_date`, `remarks`, `override_credit_validation`, `barcode` = null are fine. The first audit's null tests were clean, so this came with the strict-type batch; the quote-to-order page sends `customer_agent_id: selectedQuote.customer_agent_id` (null for quotes without an agent) | High |
| N1 | Hardening / ledger | `POST /finance/credit-notes`, `/finance/advance-payments`, `/customers/vouchers/` with `amount` = 1e30 | 422 (> MAX_MONEY) | 201 and a 1e30 JE is posted (section 0). 1e308 -> 500 "database error". Negative (-1, "-5") and 0.001/0.00 accepted for credit notes and advances (record created, no JE, no balance effect; the customer's credit-balance endpoint then 500s); `"1e2"` string accepted; voucher 0.001 -> 500 | Critical (amount bound), High (negative / 0.00 / 500s) |
| N2 | Hardening | `settle-payment` `payment_amount` `true`, `"1e2"`, `0.001` | 422 | 200: `true` applied as 1.00, `"1e2"` applied as 100.00, 0.001 recorded as a 0.00 settlement (same L4 coercion that was closed for the order body) | Medium |
| N3 | Payments | Cheque credit settlement 40 / 80 | Dr 1040 until deposited (as for cheque sales) | Dr 1020 Bank at once | Low |
| N4 | Returns | Order paid 100 cash + 100 voucher (or 140 cash + 60 credit note) fully returned, refund method cash | refund the cash tendered (100 / 140) and restore voucher / credit note, or an explicit policy | Refund 200.00 / 200.00 in cash (JE Cr 1010 200). Books balance and 2510/2530 stay consistent, but the voucher / credit-note part leaves as cash; `paid_amount` clamps to 0. Card order with 5.40 service charge: refund 200, `paid_amount` stays 5.40 (fee kept) | Low (policy) |
| N5 | Journal | Fully advance-covered credit order (advance 300, order 200) while pending | 1110 not touched before the receivable exists | Application JE Dr 2520 200 / Cr 1110 200 is posted at creation, the receivable Dr 1110 / Cr 4020 only at approval: 1110 is -200.00 while pending, nets to 0 after approval | Low |
| N6 | Print | Card order with 2.7% service charge (grand 205.40) | a "Service charge" adjustment line | printed subTotal 200.00 + vat 0.00, no adjustment, netTotal 205.40 (does not foot) | Low |
| N7 | Reports | `POST /reporting/sales` `top_products.revenue` | net line value: QA-RECHECK-P4 213.41, P1 13,211.27 | gross list value 239.92 and 13,231.27 (line discounts ignored; header discount / coupon also ignored) | Low |
| N8 | Day-end | Branch with cheque sales (1040 net +300.00) | included in cash/bank net or shown separately | `gl_bank_movement` = 1020 only (-9,594.40); 1040 is in neither figure | Low |
| N9 | Returns | `return_price` / `sold_price` 0.001 on `POST /sales/returns/` | 422 | 201 (refund still computed from the invoice, so no money effect) | Low |
| N10 | Settlement | Card settlement | service charge applied like card sales (2.7%) | a card settlement carries a charge only if the client sends `service_charge_amount` (card sales add it server-side) | Low (info) |
| N11 | M7 residual | 20 x 999,999,999.99 credit order | refused or capped | accepted and approved (see M7) | Low |
| Info | Purchasing (out of scope) | Cash-payment PO received through `grn/receive` | credit of the paying account | Cr 1020 Bank (not 1010 Cash on Hand); bank account shows -9,594.40 in QA-RCK | Info |
| Info | Legacy | 410 `gl_posting_failures` rows (Invoice, `pending`) from before the fix reference invoices that were rolled back; 103 SupplierAdvanceReturn rows = missing cashbook function | none new | 0 new failures during this run | Info |

## 3. General matrix (fresh orders)

Orders: cash exact / over-tender, split cash + card, split cash + cheque, card visa with 2.7% charge, card with adjustment 5, cheque, bank transfer (verified, rejected, parallel verify, cancelled while pending), credit (full, part-paid, pending, approved, settled by cash/card/cheque/bank transfer/customer endpoint), voucher (partial, full, with cash, credit order), credit note, advance (cash and credit order), header discount percent / fixed, coupon, hdr + coupon, line discount, tax exclusive and inclusive, hdr + tax, rounding set, returns (partial, full, credit note, cash, part-paid credit, voucher order, credit-note order, card order), cancelled, parallel races. Per-order verifier on 91 orders (documents + all related Invoice / Settlement / SaleReturn / Advance JEs): **0 problems** - footing (subtotal + tax + service - voucher - credit note - advance = grand_total), paid + balance = grand_total, revenue = subtotal less returned subtotals, tax = tax less refunds, 4100 = service charge, COGS pair, 1010 / 1040 / 1110 / 2510 / 2530 / 2520 per document, cancelled / pending orders have no postings and balance_due 0, refunded orders balance 0.

Books (checked before the 1e30 pollution, section 0 explains the later state):
- Every journal entry in the database: Dr = Cr, header = lines, GL rows = JE lines, no posted JE without GL (0 exceptions, also re-confirmed after the pollution).
- Trial balance FY2026 Dr = Cr = 44,001,403,285.30 = sum of account rows = GL table. Balance sheet `is_balanced: true`, assets 22,000,078,660.49 = TB asset accounts, liabilities 6,443.50 = TB, equity = TB equity + current-year earnings. Income statement net income 22,000,072,216.99 = TB (revenue - expense); today's income statement = GL movement of today.
- Branch QA-RCK GL: Dr = Cr; 4010+4020 = sum(subtotal) of live orders (21,000,012,316.96), 4030 = sum(return subtotal) 2,039.99, 2210 = tax - refunds, 4100 = 436.60 (service charges, settlement charges, voucher forfeits).
- Cash by source reconciles to the documents: 1010 Invoice 5,000.32 = cash tendered, settlements = cash settlements, SaleReturn = cash refunds (1,562.99 total refund less 150 of AR cancelled on the part-paid credit return = 1,412.99), advances 600, voucher sales 1,750; 1020 Invoice 2,005.60 = card 1,605.60 + bank transfers 400, settlements 240 = 100 + 60 + 80; 1040 = cheques 500 less deposits 200.
- Customer statement current_balance = live posted balance_due = GL 1110 for 31 customers; outstanding = live balance_due including pending credit orders.
- Sales report / statistics / export-csv / `/sales/list` = SQL.
- Day-end: `gl_total_debit` = `gl_total_credit`, `trial_balanced: true`; cash = documents (except N8).

Parallel safety (all pass): 5 credit-note redemptions -> 1; 5 settle x100 on 200 -> 2 x 200 + 3 x 400, balance 0, 1 JE each; 5 full settles -> 1; mixed-method 5 x 120 on 200 -> 1 accepted, paid 120; 5 approve -> 1 revenue JE; 5 cancel -> 1; approve + cancel races x4 -> 1 winner, never a posted cancelled order, no 5xx; 5 post-to-gl on a posted order -> no new JE; 5 return-full -> 1; 5 process of one return -> 1 JE; 5 voucher redemptions -> 1; 5 advance applications -> 1 (applied 150.00); 5 single-use coupons -> 1; 5 bank-transfer verifies -> 1 x 200.

Input hardening: 340 sales-order requests (14 order money fields, 5 item fields, voucher_redemptions x 17 bad values: -1, NaN, +-Infinity, 1e30, 1e308, "abc", true/false, [], {}, "1e2", "NaN", "-5", "", null, 0.001) -> all clean 4xx except R1 (null -> 500) and 0.001 (silently rounded to 0.00, harmless). Settlement, return, credit-note, advance and voucher inputs: see N1, N2, N9.

## 4. Do the books balance end to end?

Yes for the sales order module: every order kind posts the correct revenue, tax, service charge, receivable, tender and liability amounts; cancelled and returned orders net to zero as designed; trial balance, balance sheet and income statement agree (verified before the pollution described in section 0). Open items are R1 (500 on JSON null), N1/N2 (money-field bounds on credit-note, advance, voucher and settlement endpoints) and Low-severity presentation / policy items.

## 5. Not tested

- Closed accounting periods (none exist), non-superuser use of `override_credit_validation` (no sellable branch for a non-superuser), cashbook (known drift), product-restricted / percent coupons, multi-currency, agent commission amounts.
- The 1e30 clean-up (section 0) is left to the owner of the data.
