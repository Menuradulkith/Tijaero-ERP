# End-to-end workflow and final-balancing audit (2026-10-12, Playwright)

**Goal:** run one full business cycle through the UI (purchase → receive → pay supplier → sell cash and credit → settle → return → vouchers, credit notes and advances → expense → bank deposit). After every step, check that the GL, the sub-ledgers and the reports all agree.

## Method
- **Browser:** Playwright (Python, isolated headless Chromium, 1440x900) on the local dev app at :3000/:8020, using the seeded `admin` account. The Playwright MCP browser profile was locked by a stale session from 2026-10-11, so these were scripts instead of the MCP server.
- **Data:** a fresh, isolated branch **QA-E2E**. It has its own products, supplier, customers and store, so every number can be reconciled exactly. The dev DB's historic data has drifted too far to balance absolutely (see "Environment" below).
- **Checks after each step:**
  - new JEs and their lines;
  - Dr = Cr for every JE and for header vs lines;
  - new `gl_posting_failures` rows;
  - the branch GL delta.
- **Final checks:**
  - sub-ledger vs control account: AR 1110, AP 2010, inventory 1210, vouchers 2510, customer advances 2520, credit notes 2530, supplier advances 2020, cash/bank vs cashbook;
  - report APIs and pages vs ledger SQL: trial balance, income statement, balance sheet, day-end, pre-close check, customer and supplier aging/statements, sales report.
- **UI vs API:** each step below says whether it went through the UI or the API. The API was used only where the UI could not do the step, and each such gap is listed as a finding.

## The flow and its ledger impact (branch QA-E2E)

| # | Step | Path | JE posted | Result |
|---|------|------|-----------|--------|
| 1 | Credit PO 5×pA@400 + 10×pB@120 = 3,200 | API create, **UI approve** (credit warning → step-up) | – | OK |
| 2 | GRN, generated serials, Save double-clicked | **UI** | Dr 1210 / Cr 2010 3,200 | OK. Fixes yesterday's H2. Double-click sent 2 POSTs: 2nd refused, but an error toast follows the success toast |
| 3 | Supplier credit settlement 1,200 cash + verify | API | Dr 2010 / Cr 1010 1,200 | OK |
| 4 | Purchase return 1×pB (API, `require_approval=false`) | API | **none** | **F1** |
| 5 | Cash sale 2×pA = 1,300, Save double-clicked | **UI POS** | Dr 1010 / Cr 4010 1,300; COGS 800 | OK, 1 POST |
| 6 | Credit sale 1×pA + 2×pB = 1,050 | **UI POS** (credit warning) | none until approval | OK |
| 7 | Approve credit order | **UI** step-up | Dr 1110 / Cr 4020 1,050; COGS 640 | OK |
| 8 | Customer settlement 400 cash | API (UI cannot, **F4**) | Dr 1010 / Cr 1110 400 | OK |
| 9 | Partial return 1×pB from the credit sale | API create (UI form broken, **F5**); API approve (page broken, **F6**); process | Dr 4030 / Cr 1110 200; Dr 1210 / Cr 5010 120 | OK. `credit_amount` 1,050→850, `balance_due` 450 (H5 fixed) |
| 10 | Cash sale with 10% header discount (pB 200 → 180) | **UI POS** | Dr 1010 / Cr 4010 180; COGS 120 | OK (yesterday's C1 fixed) |
| 11 | Gift voucher sale 500 | API (Vouchers page broken, **F6**) | Dr 1010 / Cr 2510 500 | OK (C6 fixed) |
| 12 | Customer advance 300 cash | API | Dr 1010 / Cr 2520 300 | JE OK, sub-ledger wrong (**F8**) |
| 13 | POS sale pA 650 = voucher 500 + cash 150 | **UI POS** | Dr 2510 500, Dr 1010 150 / Cr 4010 650 | OK; voucher → `fully_claimed` |
| 14 | Expense 250, Save double-clicked → submit → approve → pay | **UI** throughout | Dr 5100 / Cr 1010 250 (once) | **Duplicate expense created** (**F9**); duplicate rejected in UI |
| 15 | Bank deposit 1,000 + verify | API (no UI, **F10**) | Dr 1020 / Cr 1010 1,000 | OK |
| 16 | Cash-sale return as credit note (pA 650) | API create/approve/process | Dr 4030 / Cr 2530 650; Dr 1210 / Cr 5010 400 | OK, credit balance 650 (C3 fixed) |
| 17 | 5 parallel POS orders each redeeming 200 credit note | API race | 3 × 201, 2 × clean 400 | OK, balance 50 = GL 2530 (C2 fixed) |
| 18 | Purchase return 1×pB via UI (require approval), Save double-clicked | **UI** | – | **2 returns for 1 unit** (**F2**) |
| 19 | Approve both returns | **UI** step-up | **none** for either | **F1 + F2** |
| 20 | Cash PO 2×pA + 3×pB = 1,160; GRN; landed cost 100; supplier advance 500 | API | Dr 1210 / Cr **1020** 1,160; Dr 1210 / Cr 1010 100; Dr 2020 / Cr 1010 500 | OK (see F14) |

## Final balancing, branch QA-E2E

The trial balance is **Dr 16,080.00 = Cr 16,080.00**. All 26 JEs balance, and there are 0 posting failures.

| Control account | Sub-ledger | GL | Diff | Cause |
|---|---|---|---|---|
| 1110 Trade debtors | 450.00 | 450.00 | 0 | ✓ (aging = statement = 450) |
| 2010 Trade creditors | 1,640.00 (counts the duplicate return) | 2,000.00 | 360 | **F1/F2**. True AP is 1,760: three returns never posted, and one of them is a duplicate |
| 1210 Inventory | 2,420.00 (on hand + landed cost) | 2,660.00 | 240 | **F1**: two units returned to the supplier are still in the GL |
| 2510 Gift vouchers | 0.00 | 0.00 | 0 | ✓ |
| 2520 Customer advances | 0.00 | 300.00 | 300 | **F8**: advance stored with `remaining_amount = 0` |
| 2530 Credit notes | 50.00 | 50.00 | 0 | ✓ |
| 2020 Supplier advances | 500.00 | 500.00 | 0 | ✓ |
| 1010+1020 vs cashbook | 0.00 | -380.00 | -380 | **E1**: the dev DB has no cashbook triggers |

Report checks:
- **Day-End page and API:** show exactly the ledger numbers.
- **Balance sheet:** every line item equals the ledger, and the exact identity A = L + E + P holds to 0.00. Only the totals break (**F12**).

## Findings

| # | Sev | Area | Finding | Repro / evidence |
|---|-----|------|---------|------------------|
| F1 | **Critical** | Purchasing → GL | **Purchase returns never reach the GL, on both paths.** `PurchasingReturnService.create_return` (no-approval path, `purchasing/service.py` ~1957-1973) and `approve_return` (~2083-2091) commit first and then call `post_purchase_return_to_gl`. That call only flushes, and nothing commits afterwards: `ApprovalService._dispatch_approve` commits only in its `else` branch, and the routes don't commit. The JE is discarded when the session closes. No failure row is written, so Day-End shows "0 pending". | Returns 56, 57, 58 are `approved`, units are `returned_to_supplier`, and no JE exists. DB-wide: all **4** approved purchase returns (2,360.00) have no JE. In a rolled-back session, the same call on return 56 posts `JE-PUR-…` fine. `test_purchase_return_reverses_inventory_and_creditors` passes only because the `db` fixture keeps everything in one uncommitted transaction. |
| F1b | **Critical** (code review, not live: no supplier invoice payments exist on dev DB) | Purchasing / Customers → GL | A static scan of every GL hook found the same post-after-last-commit pattern in 2 more places. `get_db` (`db/session.py:85`) closes the session without committing, so in both the JE is silently lost: **(a)** `PurchaseInvoiceService.create_payment_with_allocations` → `post_supplier_payment_to_gl` (`purchasing/invoice_service.py:686`, route `POST /purchasing/invoices/pay`). **Cash/bank/cheque supplier payments would never reduce 2010 or cash.** **(b)** `GiftVoucherService.validate_voucher`, expiry branch (`customers/service.py:782`), where voucher breakage never posts. The purchase-return JE survives only by accident: when the cashbook hook commits (cash, bank or cheque POs only). All other GL hooks (~35) were checked and do commit after posting. | Fix pattern: commit inside the same `try` right after the post. On exception, roll back + `record_gl_commit_failure`. For purchase returns, run the cashbook hook before that single commit. |
| F2 | **High** | Purchasing | **Same serial unit returned twice.** Double-clicking Save on the Purchase Return form sends 2 POSTs. Both succeed ("created successfully" ×2), and **both approvals succeed**. `approve_return` does not check that the stock unit is still `return_pending` for *this* return. | Returns 57 + 58 both hold barcode EE29ADCEFA and are both approved. The supplier return total is 360 (real: 240). |
| F3 | **High** | AP reports | **Supplier aging and payment-status count cash GRNs as unpaid.** The cash PO's GRN was paid from bank at receipt (Cr 1020), but it still appears in `unpaid_grns` and in aging (2,800 instead of 1,640). Also, `credit-status` / `_calculate_outstanding_payable` have no status filter on settlements and use ordered qty (code review). | `GET /purchasing/suppliers/34349/aging-report` → 2,800 |
| F4 | **High** | Finance UI | **Customer credit settlements cannot be recorded in the UI.** `ActionToolbar` renders "New" only when `!hasSelectedItem`. `CustomerPaymentsPage` renders the toolbar only when a customer is selected and passes `hasSelectedItem = true`, so the "Receive payment" flow can never start. `DebtorsPage` / `/sales/debtors` is not routed or mounted. | `/finance/customer-payments` → pick customer → only "Payment Report" appears (screenshot in run) |
| F5 | **High** | Sales UI | **Every sale return from the UI fails.** `SaleReturnsPage.tsx:126` and `SaleReturnDialog.tsx:72` hard-code `good_received_locations_id: 1`. There is no location 1 on this DB (min id 1637), so the API answers 400 "references a record that does not exist". The returned stock should go to the return branch's location anyway. Save also has no in-flight guard (2 POSTs). | Add Sale Return → INV-QA-E2E-26000002 → pB → Save |
| F6 | **High** | Lists | **One legacy row takes down whole list pages.** Response schemas reuse input constraints. A sale return with `remark` > 2,000 chars makes `GET /sales/returns/` 500, which breaks **Sale Returns and Return Approvals**. A gift voucher with `amount` 0.00 (id 460) fails `gt=0` and breaks **Vouchers**. The browser reports these as CORS errors because 500s carry no CORS headers. | `/sales/returns`, `/sales/approvals/return-approvals`, `/sales/vouchers` |
| F7 | **High** | Validation | **Money fields in customers, finance and sales are uncapped.** Only HR has `MAX_MONEY`. Earlier QA runs today posted customer advance, credit note and gift voucher amounts of **1e30** (JEs 8282-8284). Every company report is now meaningless, and totals print in scientific notation. | `journal_entries` 8282-8284 |
| F8 | Medium | Customer advances | `POST /finance/advance-payments` never sets `remaining_amount`, so it defaults to 0. Application still works because `sales/service.py:1118` recomputes payment − applied. However, every view of the balance and the 2520 sub-ledger shows 0 while the GL holds the liability. 4 of 14 advances are affected. | Advance 111: paid 300, applied 0, remaining 0 |
| F9 | Medium | Expenses | Double-clicking Save on Add Expense creates **two expenses** (2 POSTs, 2 success toasts). | EXP-QA-E2E-2026-00001/00002 |
| F10 | Medium | Finance UI | There is no UI to create a cash→bank deposit or verify one: the Bank Deposits page is read-only, and Bank Transfer Verify handles sales transfers only. Cash can only be banked through the API. | `/finance/bank-deposits` |
| F11 | Medium | Reports | **Sales report ≠ ledger.** `total_sales` 1,830 vs product revenue 3,800 vs GL net revenue 2,930. Voucher- and credit-note-paid sales count as 0, and returns are not netted (yesterday's H6 is still open). | `POST /reporting/sales` for QA-E2E, today |
| F12 | Medium | Reports | Balance sheet and income statement total in Python's default 28-digit `Decimal` context, so with large values the API returns `is_balanced: false` while the ledger balances exactly. `reconciliation-check` returns **`is_ready_to_close: true`** with 513 pending posting failures, no accounting-period record, and a cashbook mismatch. | `GET …/reports/balance-sheet?fiscal_year=2026`, `…/reconciliation-check` |
| F13 | Medium | Reports / scope | Trial balance, income statement and balance sheet have no branch filter. `/customers/reports/aging` and `/purchasing/reports/payables-aging` take no parameters, so branch users get company-wide AR/AP aging. | |
| F14 | Low | GL mapping | A `cash` PO's GRN credits **1020 Bank**, not 1010 Cash on Hand. Branch cash can also go negative (QA-E2E 1010 = -220) with no warning. Please confirm this is intended. | JE for GRN-QA-E2E-26000002 |
| F15 | Low | UX | GRN Save double-click: the server refuses the 2nd POST correctly, but the user sees "created" and then an error toast. Day-End's message "a transaction posted to the cashbook did not post to the GL" is backwards when the cashbook is the side that is missing. React duplicate-key warnings appear in the POS customer dropdown and on the GRN list. | |

### Re-verified from yesterday's money audit (all fixed)
- **H2:** GRN now posts inventory.
- **C1:** discounted sales post their revenue.
- **C2:** credit-note over-redemption under a race is blocked.
- **C3:** a credit note issued by a return is usable.
- **C6:** gift voucher sales post.
- **H5:** returns reduce the credit exposure.
- **H7:** the customer statement is correct.

## Environment (dev DB `erp_db`): not code bugs, but they block absolute balancing
- **E1:** alembic is at `s95`, but head is `s96_fix_supplier_cashbook`. No `fn_insert_cashbook_entry` or cashbook triggers exist, so `cashbook_entries` is empty and Day-End can never reconcile.
- **E2:** 513 pending `gl_posting_failures`. 1010 holds ~2e30, and 1210 is -417,496 from pre-fix GRNs that never posted.
- **E3:** company-wide AR (1110 vs `invoices.balance_due`) still ties exactly: 335,917.00.

## Fix status (same day)

| # | Status | Change | Re-verified live (Playwright, QA-E2E) |
|---|---|---|---|
| F1 | Fixed | New `PurchasingReturnService._post_approved_return`: GL post, then cashbook in a savepoint, then a single commit. Failure path: rollback + `record_gl_commit_failure`. Used by `create_return` (no approval) and `approve_return`. | UI create + UI approve of PR-496407BE → JE 9157 posted |
| F1b | Fixed | Commit after the post in `create_payment_with_allocations` and in the voucher-expiry branch of `validate_voucher`. | Tests (commit-order spy, proven to fail before the fix) |
| F2 | Fixed | Stock row is locked `FOR UPDATE`. Returns 400 if the unit is already on a pending/approved return or appears twice in one request. Validate-barcode accepts `available` only. Lot qty is capped at the GRN received qty. `approve_return` requires `return_pending`, owned by this return. Purchase Return Save has an in-flight guard. | Double-click Save → 1 POST. Re-POST → 400 "already pending return approval" |
| F3 | Fixed | Payables = credit/advance GRNs only. Received qty × price, minus verified settlements, approved returns, credit-invoice payments and advance applications. Aging and payables-aging take `branch_code` and are scoped to the user's branches. | Supplier aging 2,800 → 1,640 (credit GRN only) |
| F4 | Fixed | "Receive Payment" button on Customer Payments, gated by `customer_payments:create`. Post has an in-flight guard. | Settled 50 through the whole wizard → JE 9158 Dr 1010 / Cr 1110 |
| F5 | Fixed | Sale return loads the branch's locations (defaults to the first, picker if several) and blocks Save if there is none. Save has an in-flight guard. | Full UI return: create → approve → process → JE 9159 |
| F6 | Fixed | Read/response schemas no longer carry input constraints. | `GET /sales/returns/` and `/customers/vouchers/` → 200. All 40 money pages load clean |
| F7 | Fixed | `app/core/money.py` `MAX_MONEY = 999,999,999.99` plus input types that reject NaN/Inf, applied to sales, customers, finance and purchasing inputs. JE input schemas are capped; the internal year-end lines are not. | 1e30 / NaN → 422 on advance, voucher, credit note |
| F8 | Fixed | New advances get `remaining_amount = payment_amount`. | New advance 121: remaining 120.00 |
| F9 | Fixed | In-flight guards on Expense Save, Process Payment and Record, and on other money forms (supplier/customer advances, supplier payments, petty cash, credit settlement). | Double-click → 1 POST |
| F10 | Fixed | Bank Deposits: "New Deposit" (cash deposit) and "Verify" (TConfirmDialog, `bank_transfer_verify:approve`). | Deposit 431 created + verified → JE 9160 Dr 1020 / Cr 1010 |
| F11 | Fixed | Sales report revenue on the GL basis: `invoice.subtotal` of counted invoices, minus processed returns (by return date/branch). Products are netted the same way; filters are honoured. | 2,730 = GL 3,780 − 1,050 returns; product rows sum to 2,730 |
| F12 | Fixed | TB, IS, BS and recon-check sum at precision 80. Recon-check now reports errors for a missing period and for pending posting failures. | Recon-check `is_ready_to_close: false` with both errors |
| F13 | Fixed | `branch_code` (+ branch scoping, 403 outside scope) on TB (+ CSV), IS, BS and customer aging. | TB/BS for QA-E2E return branch-only figures |
| F14 | Fixed | `po_settlement_account`: cash → 1010; bank, cheque and others → 1020; credit → 2010; advance → 2020. Used by GRN, GRN cancel, purchase return and the return cashbook entry. | Cash-GRN return refunded to 1010 |
| F15 | Fixed | GRN Save guard, Day-End message names the missing side, React keys (POS customer/agent, GRN list, bank-transfer verify). | No duplicate-key warnings |

New tests: `tests/test_qa_fix_purchasing_2026_10_12.py` (18) and `tests/test_qa_fix_sales_finance_2026_10_12.py` (36). The commit regressions use a spy on `db.commit`, because the transactional fixture hides missing commits; each was shown to fail before the fix. `test_grn_receive_cancel.py` was updated: a cash PO now credits 1010.

Still open / for decision:
- **MAX_MONEY (999,999,999.99):** also lowers the purchasing caps, which were 9,999,999,999,999.99. Confirm that is enough for single documents.
- **Payments on non-credit POs:** non-credit invoice payments and manual payments on non-credit POs post Dr 2010, although those GRNs were paid at receipt (possible double count).
- **Dashboard and chat-agent:** `get_sales_statistics` (dashboard) still uses `grand_total`. The chat-agent GL tools are not branch-scoped.
- **DebtorsPage:** still unrouted. This is superseded by Customer Payments.

## Recommended next steps
1. Fix F1/F1b: commit after the GL post in the three services. Add pytest that **commits** (or uses a fresh session to read back) so that a missing commit fails the test. The current transactional `db` fixture cannot catch this class of bug. Then back-post the 4 orphaned approved purchase returns with a guarded script that calls `post_purchase_return_to_gl` and commits. Resolve the duplicate return 58 first.
2. F2: a unique "open return per `sales_stock_id`" rule plus a status check in `approve_return`. Add an in-flight guard on the Purchase Return, Expense and Sale Return Save buttons.
3. F4/F5: show "Receive payment" on Customer Payments, and send the branch's real location on sale returns.
4. F6/F7: separate response schemas from input constraints, and add `MAX_MONEY` to all money inputs. Then clean the 1e30 rows from `erp_db`.
5. Apply `alembic upgrade head` to `erp_db` (E1) so the cashbook and Day-End can reconcile.

## Phases run / not run
- Smoke (40 money pages swept): **run**. 3 pages failed, all F6.
- Workflow and transitions: **run**.
- Field validation: **partial** (money caps only, F7).
- Security / AuthZ: **not run**.
- Duplicates & races: **run** (UI double-clicks on every create used; credit-note race).
- Load: **not run**.
- Optional checks:
  - run: #1 workflow, #2 accounting integrity, #3 stock integrity, #4 calculation (discount, voucher, partial return), #6 reports, #13 regression analysis (test-fixture gap noted in F1);
  - skipped (trigger not met / out of scope): #5, #7, #8, #9, #10, #11, #12, #14.
- HR payroll and reimbursement: not re-run (covered by this morning's audit).

## QA records created (nothing deleted)
- **Branch and masters:** branch **QA-E2E** (id 39124), location "QA-E2E Store" 25352, products 28417 / 28418, supplier 34349, customers 17946 / 17947.
- **Purchasing:** PO 27407 / 27408, GRN 22466 / 22467, credit settlement 1, purchase returns 56-58, landed cost 22, supplier advance 104.
- **Sales:** invoices INV-QA-E2E-26000001…07 (6623-6629), sale returns 468 / 469, voucher 462 (QAE2EGV0001), customer advance 111.
- **Finance:** expenses 1701 (paid) / 1702 (rejected), bank deposit 412.
- **Ledger:** JEs 8322-8351, all in branch QA-E2E.
