# API audit: Sales and Purchasing (quotations, POs, procurement queue, approvals, sales orders) - 2026-10-11

Scope: API only (no browser). Backend http://localhost:8020/api/v1, admin plus 7 QA users (Purchasing Manager x3, Sales Manager x3, Admin-group non-superuser in branch A), 19 QA branches (QA-BR-A..S). Method: ~760 scripted checks (validation matrix, branch IDOR, maker!=checker, parallel bursts, GRN/stock/in-transit numbers, calculation recomputation) against QA- data. Nothing was fixed or deleted in code. Environment notes: (1) mid-run the dev server returned 500 for every product query for ~35 min because the working tree's Product model references `products.tracking_type` (migration s90_product_tracking_type not yet applied; alembic head was s89); testing resumed when it was applied. (2) the dev DB has no `fn_insert_cashbook_entry` function (affects sale-return processing). (3) credit sales are blocked outside 09:00-18:00 (test ran at ~20:00, see override finding), so SO credit flows were driven with `override_credit_validation`.

**Findings (consolidated): 48 - Critical 4, High 18, Medium 17, Low 9.** (Raw checks: 760; 641 verified OK.)

## Findings

| # | Area | Endpoint | Input | Expected | Actual | Severity |
|---|---|---|---|---|---|---|
| 1 | Quotation -> SO | `POST /sales/quotes/{id}/convert` | quote in pending_approval (branch has stock) | 400 (only approved/accepted quotes convert) | 200: invoice created, quote -> completed, approval row stays pending. Earlier report only saw 400 because the test branch had no stock; the status gate never existed | **Critical** |
| 2 | Quotation -> SO | `POST /sales/quotes/{id}/convert` | approved quote WITHOUT sale rep (discount 20 + 5% tax + 10% line discount) | normal SO (totals, stock allocated, approval path) | Invoice row: status=true, approval=true but approval_status 'pending_approval', subtotal/grand_total/paid/balance all 0.00, discount/tax lost, item barcode NULL, stock still available (nothing reserved), sale_rep_id NULL. GET /sales/{id} and GET /sales/ (list, every user) then return 500 until the order is deleted (reproduced twice, order deleted via API to restore) | **Critical** |
| 3 | Quotation -> SO | `POST /sales/quotes/{id}/convert` | approved quote WITH sale_rep_id (any payment method) | 200 | 409 'A duplicate record was detected' every time: quotes.sale_rep_id is an employees.id, invoices.sale_rep_id is an accounts_user.id FK, the copied id violates the FK (misreported as duplicate). A quote with a rep can never be converted; one without creates the poisoned order above | **Critical** |
| 4 | GRN | `POST /purchasing/grn-items` | unit received against a PENDING_APPROVAL PO line (GRN of another PO used) | 400 (PO must be approved; GRN must belong to the PO) | 201: PO jumps pending_approval -> partially_completed while its approval row stays pending (approval bypass). create_item has no PO status guard and does not check the GRN belongs to the PO | **Critical** |
| 5 | GRN | `POST /purchasing/grn-items` | unit received after PO cancelled / short-closed | 400, PO stays cancelled/short_closed | 201; cancelled PO and short-closed PO flip to partially_completed (cancellation/short-close reasons remain); a new GRN is then accepted too | **High** |
| 6 | Stock | `POST /inventory/sales-stock` | stock unit for product 2189 against PO line of 4863; 3rd unit on a 2-unit line; unit not in GRN items | 400 (must match PO line / GRN item / quantity) | 201 for all: sales_stock creation has no over-receipt, product or GRN-item consistency check (the checks exist only on /purchasing/grn-items) | **High** |
| 7 | Sales order | `POST /sales/ (no barcode) and barcode lines` | order in QA-BR-A while QA-BR-L and QA-BR-P hold units of the same product | units taken from the order's branch only | Auto-allocation and barcode path filter only product_id/status, never branch_code: invoice got barcodes of branch L (QA-BC-L3-1/2, QA-SS-OVER) and later a branch P unit; validate_product_availability counts all branches | **High** |
| 8 | Sales order | `POST /sales/ credit order` | override_credit_validation=true (body field) as Sales Manager; customer limit 100, order 400, 20:xx (window 09-18), customer w/o email/address | 400 (flag not client-settable / needs a permission) | 201 pending_approval: the flag bypasses time window, credit limit, email and address rules | **High** |
| 9 | Sales order | `POST /sales/ credit order` | credit_amount=1 on a 400 order | 400 or normalised to the order total | 201 credit_amount=1 with balance_due 400: customer credit usage under-reported (client controls it) | **High** |
| 10 | Approvals (PO) | `POST /common/approvals/{id}/approve/reject, POST /purchasing/orders/{id}/cancel` | remark/reason 256..500 chars (schema allows 500); cancel reason >= 239 chars; credit PO approve with a 200-char remark | 200 | 500 'secure database error': approvals.remark is VARCHAR(255) and cancel writes 'Order cancelled: '+reason, credit approve appends the credit warning. Same on quote approvals (500 chars) and SO reject/approve | **High** |
| 11 | Approvals (SO) | `POST /common/approvals/{id}/reject and POST /sales/{id}/reject` | reason 256-500 chars | 200 or clean 422, order unchanged on failure | 500 although the order was already cancelled and stock released (cancel_invoice commits before the 255-char approval.remark overflows); reason not stored | **High** |
| 12 | Approvals | `PATCH /common/approvals/{id}` | status=approved (admin) / remark edit by a branch-A user on a branch-B approval | 403 or kept in sync with the document | 200: approval row flips to approved while the PO stays pending_approval (desync); a branch-A user with common:update edits another branch's approval | **High** |
| 13 | PO batch | `POST /purchasing/orders/batch` | group 1 branch N (room), group 2 branch O (already 5/5) | 400 (daily limit per branch) | 201, branch O now has 6 POs: only groups[0].branch_code is checked against the daily limit | **High** |
| 14 | Sales order | `approve+cancel / reject+cancel in parallel` | 4+4 and 5+5+3 requests on one pending SO | 1x200, rest 400 | 7-10 x 500 (deadlock: approval-row/invoice-row lock order differs between the approval path and cancel); data stays consistent. approve+reject only: OK (1x200 + 9x400) | **High** |
| 15 | Sales returns | `POST /common/approvals/{id}/approve (sale_return)` | creator approves own return; a branch-B user (holds approve perm) approves a branch-A return | 403 (maker!=checker, branch scope) | 200 both: approval service has no scope/maker-checker rule for sale_return (PO, quote, SO have them) | **High** |
| 16 | Sales returns | `POST /sales/returns/{id}/process` | approved full return, cash refund | 200, stock restocked, reversing JE | 500 every time: dev DB lacks function fn_insert_cashbook_entry; code swallows the error as 'non-blocking' but the aborted transaction fails the whole request. Process twice -> 500. Return stays approved/pending refund, unit stays sold | **High** |
| 17 | Sales returns | `POST /sales/{id}/return-full, POST /sales/returns/` | return_reason 1 MB; good_received_locations_id 2^40; invoice_id 2^40 | 422 | 500 each (no length / int4 bounds on SaleReturn schemas); remark 1 MB accepted (201) | **High** |
| 18 | Quotation | `POST /sales/quotes/ (branch code containing '-R', e.g. QA-BR-R)` | 2nd and later quotation in that branch | 201 unique QT number | 409 duplicate-record forever: get_next_quote_number skips numbers LIKE '%-R%' (meant for -R<n> revisions) so the same number is generated again | **High** |
| 19 | Quotation | `POST /sales/quotes/ + PUT` | discount_type=percentage 10 / fixed 20 (header discount) | total reduced and discount echoed | accepted and validated, but total_amount ignores it and discount_value is returned as 0.0 (stored in discount_percentage, never applied) | **High** |
| 20 | Quotation | `POST /sales/quotes/{id}/mark-so-created` | product_ids=[4863] on a pending-approval quote (no SO exists) | 400 | 200: item so_created, quote -> completed; bare List[int] body, no status/approval check | **High** |
| 21 | PO export | `GET /purchasing/export-csv` | remarks starting with '=' (=HYPERLINK(...)) | cell neutralised | written raw: formula injection in Excel; SO export OK | **High** |
| 22 | PO params | `GET /purchasing/export-csv?supplier_id=2^40, POST /purchasing/grn/check-credit supplier_id/po_id 2^40` | unbounded ids | 422 | 500 (id params not bounded); grn_value NaN/1e30 -> 200 | **High** |
| 23 | PO | `POST /purchasing/orders, /orders/batch` | product not mapped to the supplier (QA-SUP-NOMAP) | 400/409 (approved vendor list) | 201 (also via PATCH supplier switch, and in the procurement queue); MOQ and mapping are never checked server-side | **Medium** |
| 24 | Sales order | `PUT /sales/{id} {remarks} on an approved/completed, partly paid credit SO` | remarks-only edit | 200 without touching approval, or refuse | approval_status completed -> pending_approval, approval=False, approval row reset to pending while GL stays posted and payments are blocked until re-approved (items edit correctly refused) | **Medium** |
| 25 | PO create | `POST /purchasing/orders` | unit_price 0.004 | 422 (>0) | 201: gt=0 passes then quantize(0.01) stores 0.00 (zero-price line, total 0.00) | **Medium** |
| 26 | GRN | `POST /purchasing/grn` | GRN branch QA-BR-A for a PO of branch QA-BR-L | 400 (branch must equal PO branch) | 201; also GET /purchasing/grn-items/by-po/{po} answers 200 for a PO of another branch | **Medium** |
| 27 | PO credit | `POST /purchasing/orders (Credit)` | 5000 vs supplier limit 1000; credit PO for supplier with credit_days 0 / limit 0 | blocked or flagged | 201, approve 200 (flagged only in the approval remark); no server-side payment-term check | **Medium** |
| 28 | Approvals | `GET /common/approvals/{id}` | branch-A common:view user reads branch-B PO/quote approval | 403/404 | 200 (no scope on by-id read; list is scoped) | **Medium** |
| 29 | Approvals | `POST /common/approvals` | forged row status=approved for purchase_order:1:X | 403/422 | 201 (generic create/patch endpoints accept arbitrary rows; cancelled afterwards) | **Medium** |
| 30 | Quotation | `PATCH /sales/quotes/{id}/status` | status=cancelled (no reason) | 422 like /cancel | 200 cancelled without reason; the pending approval row stays pending (still listed in approvals) | **Medium** |
| 31 | Quotation | `POST /sales/quotes/{id}/items/procurement` | pending-approval quote item | 400 | 200 item_status procurement | **Medium** |
| 32 | Quotation | `POST /sales/quotes/{id}/revise` | quote with fixed discount 20, 5% exclusive tax, 10% line discount | revision keeps them | revision total equal (378) but discount_type/tax_mode/tax_rate/line discount reset to none/0 (create_revision copies total only) | **Medium** |
| 33 | Quotation -> SO | `POST /sales/quotes/{id}/convert` | payment_method 'bitcoin' / empty | 422 | 409 (no enum on ConvertToInvoiceRequest; FK error first) | **Medium** |
| 34 | Sales order | `POST /sales/` | credit 400 + cash 50 on 400; source_quote_id=99999999 | 400/404 | 201 with credit_amount 400 + cash 50 (balance 350); unknown quote -> 409 'duplicate record' (FK errors reported as duplicates) | **Medium** |
| 35 | Sales order | `POST /sales/{id}/settle-payment` | cheque without number/bank | 400 | 200 counted as paid immediately; bank transfer without reference accepted as 'pending verification' | **Medium** |
| 36 | Sales returns | `POST /sales/returns/` | items=[] | 400/422 | 201 return with no items | **Medium** |
| 37 | Quotation procurement | `GET /sales/quotes/{id}/procurement-summary, GET /purchasing/procurement-queue` | line 20: cancelled PO 12 + received PO 8 | ordered 8 | ordered_quantity 20 (cancelled PO line counted), outstanding 12, to_purchase 0: shortage hidden | **Medium** |
| 38 | PO dates | `POST /purchasing/orders` | expected delivery / required date 2999-12-31 | 422 | 201 (order date has a one-year window, the other dates have no upper bound) | **Medium** |
| 39 | API docs | `GET /api/v1/openapi.json` | anonymous | 200 or 401/404 | 500 (Swagger schema cannot be generated); /docs loads | **Medium** |
| 40 | PO MOQ | `POST /purchasing/orders` | qty 1 vs supplier-product minimum_order_qty 10 | accepted, warning only in UI | accepted; no server-side warning field exists (as expected, reported for the record) | **Low** |
| 41 | PO create | `POST /purchasing/orders (201 body)` | - | created_by/supplier_name populated | created_by_name, supplier_name null in the create response (populated on GET) | **Low** |
| 42 | PO approvals | `POST /common/approvals/{id}/approve step-up` | 5 bad passwords for any approver name | - | 429 after 5 for that name (works) but an attacker can lock out a real approver's step-up for 5 min | **Low** |
| 43 | PO approve | `PurchasingOrderService._recalculate_expected_delivery / daily-limit count` | code review | tz-aware dates | uses date.today() (server local) and func.date(added_date) (DB zone) while the rest of the module uses tz.today(): off-by-one possible near midnight (not reproduced) | **Low** |
| 44 | Approvals | `GET /common/approvals/statistics` | branch-A user | own-branch counts | global pending counts (all branches) | **Low** |
| 45 | Responses | `authenticated JSON` | - | X-Content-Type-Options, Cache-Control: no-store | neither header set | **Low** |
| 46 | Procurement queue | `GET /purchasing/procurement-queue` | quote cancelled while queued | entry removed | 1 orphan row (quote cancelled) stays in the queue | **Low** |
| 47 | PO params | `GET /purchasing/export-csv?limit=2^40` | unbounded limit | 422 | 200 (limit default 100000, no cap) | **Low** |
| 48 | Sales order | `GET/POST /sales/ response` | - | approval id exposed | SO response has no approval_id; approvers must search /common/approvals/pending | **Low** |

## Earlier findings re-test

Legend: Fixed = behaviour now correct in API tests; Still open; Regressed.

| Report | Finding | Status | Evidence |
|---|---|---|---|
| Quotations | #1 PATCH status approved/completed bypasses approval | Fixed | 13 forbidden targets (approved, completed, revised, so_created, sent, pending_approval, rejected, partially_processed, accepted, under_review, submitted, draft, bogus) -> 400/422 on a pending quote |
| Quotations | #2 accept / send / submit / under-review / customer-approve / reject-quote on pending quote | Fixed | all 400. But the legacy bypasses remain on other routes: convert, mark-so-created, items/procurement (see findings) |
| Quotations | #3 branch IDOR (get/put/delete/create/list) | Fixed | qa_sm_b on a branch-A quote: 24 by-id routes 403, create in A 403, ?branch_code=A 403, unfiltered list contains no foreign rows |
| Quotations | #3b maker != checker | Fixed | non-superuser creator approving own quote -> 403 (superuser exempt by design) |
| Quotations | #4 mark-expired global | Not a defect (per earlier correction) | 200 for any quotations:update user, date-driven |
| Quotations | #5/#6/#7 validation and 500s | Fixed | 35 create cases (empty items, price 0/1e30/NaN/below min, qty 0/2^31, discounts, tax_mode, valid_until, delivery date, warranty, agent==customer, ids 2^40, 1 MB text) and 11 update cases all 422/4xx. Remaining: line total up to 1e15 accepted (Low), header discount ignored (High) |
| Quotations | #8 list total / % search / per_page / page | Fixed | total correct, '%' matches nothing, per_page 201 and 100000 -> 422, page 2^40 -> 422 |
| Quotations | #9 UI list caps | Not tested (UI); API pages by per_page<=200 | - |
| Quotations | #10 created_by / version | Fixed | created_by_name set, version token present, stale expected_version -> 409 |
| Quotations | #11 cancel reason | Fixed for /cancel (empty/whitespace/501 -> 422); still open via PATCH /status cancelled (no reason) | see Medium finding |
| Quotations | #12 approvals list needs common:view | Unchanged (403 for users without common:view) | - |
| Purchase orders | #1 branch IDOR on get/patch/cancel/short-close/list/export | Fixed | qa_pm_b on a branch-A PO: GET, PATCH, cancel, short-close, ?branch_code=A (list, paged, export), daily-limit, available-stock, in-transit, create, batch all 403; unfiltered list/paged/export/supplier orders contain no foreign rows. Residual: /grn-items/by-po and /common/approvals/{id} by-id read are not scoped |
| Purchase orders | #2 branch filter 500 | Fixed | 403 |
| Purchase orders | #3 PATCH status tampering | Fixed | status/approval_id/created_by/total/purchasing_order_no ignored |
| Purchase orders | #4 edit after approval | Fixed (misread earlier) | approved PO edited -> pending_approval, approval pending, total recomputed (299.97), approved_by cleared |
| Purchase orders | #5 maker/checker, step-up throttle | Fixed | creator and creator-via-step-up -> 403; colleague step-up -> approved_by = colleague; 7 bad step-ups -> 5x401 then 429 |
| Purchase orders | #6 create validation | Fixed with gaps | empty items, qty 0/-1/2^31/1e6+1, price <=0/NaN/Inf/1e14, payment bitcoin/blank, dates 1999/2999/GRN<order/required<order, second==first, 1 MB remarks -> 422. Gaps: price 0.004 -> 0.00, unmapped product, far-future expected/required date |
| Purchase orders | #7 500s | Fixed for create/get/list; NEW 500s: approval remark 256-500, cancel reason >=239, credit approve remark, export supplier_id 2^40, grn/check-credit ids | see High findings |
| Purchase orders | #8 approval routes shadowed | Fixed | /common/approvals/pending, /statistics, /types 200 |
| Purchase orders | #9 blank reject reason | Fixed | '', '   ', tab/newline, null, missing -> 400; 501 chars -> 422 |
| Purchase orders | #10 list cap | Fixed (API) | /orders/paged with size<=200 and server filters |
| Purchase orders | #11 cancel vs approval row | Fixed | cancelled pending PO -> approval cancelled |
| Quote->PO | #1/#2 legacy create-po | Fixed | POST /sales/quotes/{id}/create-po -> 404/405 |
| Quote->PO | #3 queue accepts unapproved quotes | Fixed | pending-approval quote item -> 400 |
| Quote->PO | #4 queue branch scope | Fixed | POST by branch-B user 403, GET list scoped, DELETE by branch-B user 403/404 |
| Quote->PO | #5/#6 queue 500s and validation | Fixed | ids 2^40, NaN, 0/negative, 1e30, >200 items, duplicate items, price above selling price -> 4xx; 8 parallel adds of one item -> 1 row. Supplier-product mapping still not checked |
| Quote->PO | #7 partial quantities | Fixed | 12 of 20 then 8 of 8 (6 parallel POs for the same 8 units -> exactly 1x201, total 20) |
| Quote->PO | #8 cancel/reject returns quantity | Fixed | cancelled PO -> item converted_qty 20 -> 8; but procurement summary/queue still count the cancelled PO as ordered |
| Quote->PO | #9 batch branch must equal quote branch | Fixed | 400 |
| Races | approve/reject race on PO and quote | Fixed | 10 parallel approves -> 1x200 + 9x400 (PO, quote, SO); 5+5 approve/reject -> 1 winner; cancel x8 -> 1x200 |
| Races | daily limit 5 per branch under parallel creates | Fixed | 8 parallel creates on a branch with 1 PO -> 4x201, 4x400, total 5, unique numbers. Bypass remains via /orders/batch group[1+] |
| Sales orders | scope, mass assignment, validation, export, route order, available-products, cancel/delete/reject races | Fixed | SO by-id routes (incl. payment-history, gl-*, return-full, bank-transfer, post-to-gl) 403/404 for a branch-B user; lists scoped; status/approval/grand_total/paid/invoice_no ignored on POST and PUT; export-csv and returns/statistics reachable; available-products 200; delete x5 -> 1x200 + 4x404 with stock restored once; cancel x6 -> 1x200; approve x6 -> 1x200 |
| Sales orders | maker!=checker on SO approval | Fixed | creator via /sales/{id}/approve and /common/approvals -> 403 |
| Sales orders | approved order cannot change items | Fixed | items edit -> 400; remarks-only edit still resets approval (Medium finding) |

No earlier finding regressed. Still open from earlier reports: quote convert approval gate (never fixed), 'unmapped product' acceptance, PO cancel/approve remark length (new variant of the old 'unbounded remark' item).

## Verified OK (recent changes)

- **GET /purchasing/orders/in-transit**: pending PO -> {}; approved qty 5 -> {4863:5}; second approved PO (4863 x4, 2189 x3) -> {4863:9, 2189:3}; after 2 GRN items on the first PO -> {4863:7, 2189:3} (status partially_completed); after cancelling the second PO -> {4863:3}; fully received PO -> {} and completed; short-closed (2 of 4 received) -> excluded. Checked with real GRN + grn-items.
- in-transit validation: ids 'a,b', 0, -1, 2^31, 201 ids, 600 ids (length), SQL string, missing branch/ids, branch 201 chars -> 422; empty ids, unknown branch, duplicate ids, spaces -> 200; branch-B user on branch A -> 403; no token -> 401.
- PO rejection_reason: set to the approver remark (list, paged, by id) only when rejected; null otherwise. XSS text stored as plain text.
- cancellation_reason / cancelled_date / cancelled_by and short_close_reason / short_closed_date / short_closed_by populated; short-close needs partially_completed (approved -> 400, cancelled -> 400, twice -> 400); cancel of a PO with GRN items -> 400 'use Short-Close'.
- Reject remark: empty, whitespace, tabs/newline, null, missing -> 400 'Rejection reason is required' via /common/approvals/{id}/reject (PO unchanged); there is no POST /orders/{id}/approve|reject route (404) so the approvals endpoint is the only path.
- Cancel/short-close reason (ReqStr 500): missing, empty, whitespace, null, 501 chars, 1 MB, non-string -> 422 with PO unchanged. 500-char reason is accepted by short-close (200) but cancel fails >= 239 chars (High finding).
- Expected delivery re-base (8 cases, approval on Sunday 2026-10-11): estimate==grn==required (Fri order 09-25, LT5) -> both moved to 10-16; required manually different -> only delivery moved; Saturday order date -> moved to 10-16; delivery +1 day manual -> unchanged; delivery = calendar +5 days -> unchanged; LT0 supplier -> unchanged; no lead time -> unchanged; future order (+30d) -> never earlier, unchanged.
- MOQ: product mapping minimum_order_qty=10, order qty 1 accepted (201) with no warning field in the response, as stated.
- create_batch: empty/null groups, qty 0/2^31, price negative/1e13, 201 lines, GRN<order date, 2999 date, second==first -> 422; inactive supplier in group 2 -> 400 and nothing created (atomic); unknown branch 404; 2 supplier groups -> one batch id, 2 POs pending_approval with approval rows and totals 200.00 / 151.50; 4 groups with 3 remaining -> 400; 50 and 1000 groups -> 400 fast; past order date accepted (1 year window); order date 13 months back -> 422.
- Maker!=checker on PO (creator, creator via own step-up -> 403), branch scope on approve/reject (branch-B user -> 403), edit after approval -> pending_approval, approve twice / reject-after-approve / reject-then-approve -> 400.
- Races: 10 parallel PO approves -> exactly one success (PO and approval agree, no 5xx); 5 approve + 5 reject -> one winner; 8 cancels -> one; approve vs 5 parallel edits -> consistent total (1000.00 == sum of lines); GRN last-unit race (6 parallel) -> 1x201, received == ordered, PO completed; same-barcode race -> 1x201; procurement queue 8 parallel adds -> 1 row; 6 parallel batch POs for the last 8 units -> exactly 1.
- Quote->PO: PO line above quote selling price, qty above remaining, branch != quote branch, foreign quote item, pending quote, unknown item all rejected; partial POs 12 + 8; cancel returns quantity; units received on a quote-linked PO line come in as `reserved` for that quote item (8 of 8) and quote cancel releases them to available.
- Calculation accuracy (quote): tax exclusive 5% on 10.10 -> 10.61, 7.5% on 99.99 -> 107.49, line discount 12.5% -> 52.47, 7 lines x 0.35 x3 at 5% -> 6.98, 100 lines x 0.15 -> 15.00, 0.005 -> 0.01; PO totals = sum of lines (200 lines -> 2020.00, batch 151.50); SO cash/credit grand_total = lines. Header discount is the exception (High).
- Accounting (SO): credit SO approval posts JE-SALE entries Dr = Cr (400/400 and 200/200), re-approval after an edit does not double-post (4 GL rows stay 4), 10 parallel approvals -> one posting; cash SO 200 posts and balances, over-tender 250 stored net of change, under-payment 100 -> 400.
- Sales order: validation matrix (23 cases) -> 4xx; items edit after approval refused; delete x5 -> 1x200 + 4x404; cancel x6 -> 1x200; approve x6 -> 1x200; reject reason empty/whitespace/501/missing -> 422; maker approving own SO -> 403; branch-B user on every by-id route -> 403/404; no token -> 401 on all routes tried.
- Quote approvals: sales manager (no approve perm) -> 403; reject remark empty/whitespace/501 -> 400/422; reject stores rejection_reason/date; resubmit creates a fresh pending approval; branch-A approver on branch-B quote approve/reject/read -> 403 and not in the pending list; 10 parallel approves -> 1x200; approve vs reject -> 1 winner; 8 cancels -> 1x200.
- Mass assignment (PO, quote, SO create/update): status, approval, approval_id, created_by, total_amount, paid_amount, grand_total, quote_no/invoice_no/purchasing_order_no, id, purchase_batch_id ignored. XSS/SQLi/SSTI strings stored as text, JSON-escaped, no 500. Error bodies are generic (no stack traces, SQL or paths).

## Phases run / not run

- Run (API only): Phase 1 smoke of endpoints, 1b field validation and security (RBAC/IDOR, mass assignment, injection, error leakage, CSV export), Phase 2 duplicates and races (PO, quote, SO, GRN, queue).
- Not run: all UI/browser steps (double-click Save, two-tab edits, layouts, console/network checks), Phase 3 load (needs a staging DB), uploads/tokens-in-URL checks, SO approval of bank-transfer/cheque flows, quotation email/print.

## Optional checks run / skipped

- 1 Workflow & status transitions: **run** (quote/PO/SO/return chains, illegal jumps, edit/cancel/short-close after receipt)
- 2 Accounting integrity: **run (partial)** - SO credit/cash JE balance and no double posting; PO flow posts no journal; sale-return posting blocked by the missing cashbook function
- 3 Stock integrity: **run** - GRN/over-receipt, stock creation consistency, cross-branch allocation, reservation and release, cancel/delete restore
- 4 Calculation accuracy: **run** - quote tax/discount/rounding, PO totals, SO totals
- 5 Approval & permission matrix: **run** - maker!=checker, branch scope, step-up, rejection reason stored, who/when
- 6 Reports & exports: **run (partial)** - PO and SO CSV (branch scope, formula injection); no reports
- 7 Pagination/sort/filter: **run (partial)** - API param bounds on paged/list endpoints; no 10k-row test
- 8 Data lifecycle: skipped (not triggered; no deactivate/delete of referenced records except pending-SO delete)
- 9 Time & locale: **run (partial)** - credit window noticed, delivery-date logic on a Sunday; midnight/timezone boundary not exercised
- 10 Accessibility, 11 Session behavior, 12 Resilience, 14 Visual regression: skipped (UI only)
- 13 Regression pinning: skipped (no fixes requested)

## QA- records created

All via API, all prefixed QA-. Pending QA POs (33), quotes (31) and SOs (3) were cancelled at the end so they do not clutter the approval queues; approved/received/partially received QA POs, GRNs, stock units, orders and returns remain (cancel/return paths are blocked or broken, see findings).

- Branches: QA-BR-A ... QA-BR-S (19, id 23651-23656 and later). QA-BR-R can hold only one quotation (numbering bug).
- Users (password in the audit scripts, local only): qa_pm_a1, qa_pm_a2, qa_pm_b (Purchasing Manager), qa_sm_a1, qa_sm_a2, qa_sm_b (Sales Manager), qa_adm_a (Admin group, non-superuser); each with an auto-created employee QA-qa_*. No roles created.
- Suppliers: QA-SUP-LT0 (lead 0), QA-SUP-LTN (none), QA-SUP-LT5 (5), QA-SUP-CR (credit 30d / limit 1000), QA-SUP-NOMAP (no product mapping), QA-SUP-INACT (inactive) + 8 supplier-product mappings (min qty 10) for products 4863 and 2189. Customer: QA-CUST-1 (its max_credit_limit was lowered to 100 during the credit-bypass test).
- Locations: QA- Store A, B, L, P. Purchase orders: 62 in QA-BR-* (ids ~10780-10836, 11661-11666): 38 cancelled (33 of them by the final cleanup), 14 approved, 4 completed, 4 partially_completed, 2 rejected.
- Quotations: 43 (ids 3737-4010; 35 cancelled, 3 completed, 2 partially_processed, 2 revised, 1 rejected). Sales orders: 18 (ids 2953-3158; 10 cancelled, 6 approved, 2 completed); 3 sale returns (one with a 1 MB remark, one empty, one approved but unprocessable). Two earlier poisoned orders created by the quote convert were deleted via the API to restore the list.
- GRNs: 8 (e.g. GRN-QA-BR-L-26000001, GRN-QA-BR-A-26000001 cross-branch, GRN-QA-BR-A-26000002), 38 GRN items, sales stock QA-BR-A 16 units (7 available, 9 sold), QA-BR-L 4, QA-BR-P 8 (barcodes QA-A-*, QA-BC-L*, QA-P-*, plus junk QA-SS-X1 / QA-SS-OVER), 1 orphan procurement-queue row, approval row id 9169 (forged, cancelled).

## Suggested fix order
1. Quote convert (status gate, sale_rep mapping, totals/discount/stock allocation) and GRN-item status/ownership guard. 2. Approvals.remark width (255) vs schema (500) and the cancel/short-close remark, plus the SO reject/cancel lock order. 3. Branch filter in stock allocation and in sales-stock creation consistency. 4. `override_credit_validation` and `credit_amount` client control. 5. Scope and maker!=checker for sale_return approvals; scope on approval by-id and generic PATCH/POST. 6. Batch daily limit per group branch, mapping/MOQ policy, bounds on SaleReturn/export/check-credit params, CSV neutralisation in the PO export, quote numbering `-R` filter.
