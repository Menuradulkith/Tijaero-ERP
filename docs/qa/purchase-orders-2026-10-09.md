# Purchasing › Purchase Orders and PO Approvals QA — 2026-10-09

Scope: `/purchasing/orders` (PurchaseOrdersPage), `/purchasing/approvals` (POApprovalsPage), `POST/GET/PATCH /purchasing/orders…`, `/orders/{id}/cancel|short-close`, `/orders/check-credit`, `/orders/daily-limit`, `/orders/available-stock`, and the shared approval API `/common/approvals/*` (approve / reject / pending).
Method: two API audit scripts (validation matrix, parallel bursts, limited-role users in two branches) + built-in browser smoke (both pages load, 5 real POs). Playwright MCP unavailable. Everything the audit created (124 POs with their approvals, 14 suppliers, 40 QA branches, 9 users) was removed by a guarded DB script; the 5 real POs are untouched. Note: an unrelated auto-reload of the dev server dropped a few connections mid-run — those were retried, not counted as findings.

## Findings

| # | Area | Finding | Severity |
|---|---|---|---|
| 1 | **Branch access (IDOR)** | A user limited to branch X can **read, edit and cancel POs of branch Y**: `GET /orders/{id}`, `PATCH /orders/{id}` and `POST /orders/{id}/cancel` all returned 200 for another branch's PO (create is correctly refused: 403). Approve/reject by id is likewise not branch-checked in the PO code path (not exercised: the PO had already been cancelled by the previous call) | **Critical** |
| 2 | **Broken branch filter** | `GET /orders?branch_code=<other branch>` for a limited user answers **500** instead of 403: the parameter named `status` shadows FastAPI's `status` module, so `status.HTTP_403_FORBIDDEN` raises `AttributeError` | High |
| 3 | **Status tampering** | `PATCH /orders/{id}` accepts `status: "completed"` on a pending **or approved** PO (200). Result: a "completed" PO with no goods received, whose approval row stays *pending*. Only `approved`, and unknown values, are refused; `payment_method` can be blanked (`" "`) | High |
| 4 | **Edit after approval** | An approved PO can be edited without re-approval: line prices changed from 10 to 9 999 (total 20 → 19 998) and the approval stayed *approved* | High |
| 5 | Maker / checker | The user who created a PO can approve their own PO (Purchasing Manager: 201 then approve 200). There is no "requester ≠ approver" rule. The step-up override (`approver_username/password`) also lets a user without the approve permission approve with a colleague's credentials (works; the actor recorded is the credential owner) — fine if intended, but unthrottled | High |
| 6 | **Validation on create** | None of these is rejected: **empty item list** (PO of 0.00), quantity 0 and **negative** (total −30.00), unit price 0 and **negative** (−10.00), price `1e30`, 3-decimal prices (rounded), blank / free-text warranty, **duplicate product lines**, payment method `bitcoin` / blank / any text, second supplier = first supplier, `credit_date` negative, order date 1999 or 2999, **GRN date before the order date**, required date in the past, 1 MB remarks | High |
| 7 | **500s** | `quantity 2^40`, product id `2^40`, supplier id `2^40` (create, list, credit check), `credit_date 2^40`, warranty text 10 000 chars, `payment_method` 31 chars, `purchasing_invoice_no` 300 chars, remarks 100 000 chars in a line, `date_from=nope`, `check_date=nope`, `product_ids=a,b`, `po_value` negative / NaN; ids `2^31`/`2^40` on every `/orders/{id}` route and on `/common/approvals/{id}`; reject/approve remarks of 5 000+ characters | High |
| 8 | **Approval routes shadowed** | `GET /common/approvals/pending`, `/statistics` and `/types` are declared after `/approvals/{approval_id}`, so they are parsed as an id and return **422** — the endpoints (and the dashboard/chat agent that use them) cannot work | High |
| 9 | Reject reason | A reason of only spaces is accepted (`"   "` → 200, PO rejected); no length limit (500 on 5 000 chars) | Medium |
| 10 | **List cap** | Both pages call `purchaseOrdersApi.getAll()` with no limit, so the API's default `limit=100` applies: once there are more than 100 POs the older ones silently disappear from the PO page *and* from PO Approvals (a pending PO can become unapprovable). Sorting/filtering is client-side; the approvals page loads *all* POs and filters by status | High |
| 11 | Consistency | Cancelling a PO does not touch its approval row (stays *pending* if it was never decided → shows in approval lists); `short-close` on an approved PO with no receipts returns 400 (by design), fine; completed/cancel-race outcomes are correct | Medium |
| 12 | Free-text | `remarks` unbounded text; `<img onerror>` stored (rendered as text); `purchasing_order_no` in the body is ignored (good) | Low |

## Verified OK
- 401 without a token on every PO and approval route.
- **Approve/reject race:** 6 approves + 3 rejects on one approval → exactly 1×200, PO and approval agree.
- **Cancel race** (6 parallel on an approved PO) → 1×200; cancel vs short-close race → exactly one winner, final status consistent.
- **Daily limit of 5 POs per branch** holds under 8 parallel creates (5×201, 3×400); PO numbers unique (0 duplicates in 85+ POs).
- Mass assignment on create (`status`, `approval_id`, `created_by`, `total_amount`, `paid_amount`, `purchase_batch_id`) is ignored; new POs start `pending_approval` with an approval row.
- Inactive suppliers rejected (400), unknown supplier/product/quotation/branch → 404/409, bad dates → 422.
- Role checks: a Branch Manager (create, no approve) gets 403 on approve, reject, cancel and edit; create in a foreign branch → 403.
- Pages: `/purchasing/orders` (5 rows, search, branch / supplier / status filters, Add Purchase Order, Export) and `/purchasing/approvals` load.

## Phases run / not run
Smoke (partial) · 1b validation & security (API) · 2 races (API) · optional 1 workflow (approve/cancel/short-close), 5 approval matrix (maker/checker, roles), 7 pagination (cap). Not run: UI create wizard end to end, GRN against a PO (separate page), credit-limit warning flow in the UI, load, email/print.

## Suggested fix order
1. #1/#2 branch checks on get / patch / cancel / short-close / approve / reject, fix the `status` shadowing; #8 route order for `/approvals/pending|statistics|types`.
2. #3/#4 PATCH rules: status not editable via PATCH, no edits once approved (or re-approval), keep approval row in step with cancel.
3. #6/#7 strict create/update schemas (items ≥ 1, quantity 1–1 000 000, price > 0 and bounded to 2 decimals, warranty from a list or bounded text, payment method from the allowed set, dates consistent, ids int4, lengths), bounded reject reason and list/credit params.
4. #5 maker ≠ checker (configurable) and throttle the step-up credentials; #9 non-blank reason; #10 server paging + status filter for both pages (`/orders/paged`, pending-only for approvals) with Export-all.

## Fix log (2026-10-09)
Verified by 58 new backend tests (`backend/tests/test_purchase_order_rules.py`), a re-run of the audit scenarios, and live in the browser (PO list with search / sort / export, PO Approvals: open a pending PO → Approver Login → "Purchase order approved successfully").

Corrections to the report: **#4 (edit after approval) and #11 (cancel/approval row) were misreads** — an edited approved PO already goes back to `pending_approval` with its approval reset, and cancelling a PO already cancels a *pending* approval row (the one I looked at had already been approved). What was real in #4 was `status: completed` being accepted (fixed under #3).

- **#1 branch IDOR:** `GET`, `PATCH`, `cancel`, `short-close` on `/orders/{id}` now 403 for a PO of a branch the user cannot access (404 if it does not exist); the supplier-orders list, `daily-limit` and `available-stock` are branch-scoped; `PATCH` cannot move a PO to a branch the user has no access to. Approve/reject check the PO's branch in the shared approval service (so the chat agent is covered too) and the pending list hides other branches' PO approvals.
- **#2:** the `status` query parameter no longer shadows FastAPI's `status` (it is `?status=` via an alias), so an inaccessible `branch_code` filter is a 403, not a 500.
- **#3:** `status` is not an editable field any more (ignored if sent); cancelled and short-closed POs are read-only; delivery date ≥ order date and second ≠ first supplier are re-checked against the stored order.
- **#5:** the creator of a PO cannot approve it (superusers exempt, so a single-admin setup keeps working); the approver sign-in override now needs both username and password, and 5 failed override sign-ins per approver name in 5 minutes → 429. (The override still lets a user without the approve permission approve with a colleague's credentials, recorded under the colleague — kept as designed.)
- **#6 create/update validation:** at least one line (≤200), quantity 1–1 000 000, unit price > 0 (≤ 999 999 999 999.99, rounded to cents), warranty 0–999 months, payment method from the allowed set (Credit / Non-credit / Cash / Bank transfer / Cheque / Card / Online; `non_credit` style spellings accepted), order date within a year of today, expected delivery ≥ order date, required date ≥ order date, `credit_date` 0–3650, remarks ≤ 2 000, line remark ≤ 500, invoice no ≤ 200, second supplier ≠ first (0 means none). The same product on two lines **is allowed** (existing flows use it for different prices).
- **#7 500s → 422:** ids bounded everywhere (body, path, query, including `/common/approvals/{id}`), dates typed (`date_from`, `check_date`), `product_ids` parsed safely (≤ 200), credit-check value 0–1e12 and finite, text lengths, reject/approve remarks ≤ 500.
- **#8:** `/common/approvals/pending`, `/statistics` and `/types` are declared before `/approvals/{approval_id}` (they were unreachable); an unknown `approval_type` is a 422.
- **#9:** a reason of only spaces counts as no reason (400); reasons ≤ 500 characters.
- **#10 list cap:** new `GET /purchasing/orders/paged` (search by PO no or supplier name, status, supplier, branch, order-date and created-date ranges, requested-by, batch, whitelisted sort, branch-scoped). The PO page and the PO Approvals page now load only the visible page ("1–20 of 20" verified), with Export-all, the `?focus=<id>` deep link and "created from quotation" navigation opening the PO by id, and the sibling orders of a multi-supplier purchase fetched by batch id. The "next PO number" preview is replaced by "Assigned on save" (the server always generated it). The list endpoint now orders by date then id.
- **#12:** lengths above.

Tests changed: `test_frontend_api::test_po_approver_can_approve` now assigns the approver to the PO's branch (the new branch rule).
Not changed: pages that still call `purchaseOrdersApi.getAll()` without a limit (GRN creation and a few lookups) are subject to the API's default of 100 and should move to the paged API or a filtered query next.
All QA data from the audits (POs, suppliers, 44 branches, users) was removed with a guarded DB script.
