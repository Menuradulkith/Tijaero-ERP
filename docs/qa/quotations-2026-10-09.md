# Sales › Quotations and Quotation Approvals QA — 2026-10-09

Scope: `/sales/quotations` (QuotationsPage), `/sales/approvals/quotation-approvals` (QuotationApprovalsPage), `/sales/quotes/*` (create/update/delete/status/submit/send/accept/revise/cancel/convert/create-po/mark-expired …) and the shared approval API `/common/approvals/*` for `sales_quote` approvals.
Method: two API audit scripts (validation matrix, parallel bursts, a limited Sales Manager user in one branch) + built-in browser smoke (both pages load; 13 real quotations, 4 pending). Playwright MCP unavailable. Everything created (37 quotations with approvals, 3 customers, 3 QA branches, 2 users) was removed with a guarded DB script. Stock was 0 for the test product, so *conversion to a sales order* itself (and its race) could not be exercised — only its guards.

## Findings

| # | Area | Finding | Severity |
|---|---|---|---|
| 1 | **Approval bypass** | **Any user with `quotations:update` can approve their own quotation without the approver**: `PATCH /sales/quotes/{id}/status {"status":"approved"}` returned 200 for a Sales Manager without approval rights — the quote became `approved` (`approval=true`) while its approval row stayed *pending*. The same call can set `completed`. Legacy statuses "can transition forward freely", so `pending_approval → approved / accepted / completed` is allowed | **Critical** |
| 2 | **Approval bypass** | `POST /{id}/accept` and `POST /{id}/revise` work on a quote that is still **pending approval** (accept → 200; revise → status `revised`, leaving the approval row pending so it still shows in approval lists) | High |
| 3 | **Branch access (IDOR)** | A user limited to branch A can **read (200), edit (200) and delete (204) a quotation of branch B**, and **create quotations in branch B (201)**. List filtering by `branch_code` of another branch returns 200 and `GET /` only hid rows by luck of the user's branch; there is no branch check on any by-id route. (Approve/reject of another branch's quote is refused 403 only because the user lacks the approve permission — the PO-only branch rule in the approval service does not cover quotations) | **Critical** |
| 3b | Maker-checker | No rule stops the creator of a quotation from approving it when they hold the approve permission (none of the test roles has it; superusers can) | Medium |
| 4 | Global action | `POST /sales/quotes/mark-expired` expires **every** quotation in the system and any `quotations:update` user can call it | High |
| 5 | **Validation (create)** | Accepted: **empty item list** (quote of 0.00), selling price 0, price `1e30` (total 2e30), selling price below the product's own minimum price, `discount fixed` of 1e9 and `percentage` of 150 (silently ignored), `tax_mode: "weird"`, valid-until in the past (2000) or far future (2999), expected delivery before today or after the quote expires, warranty `"forever"`, duplicate lines, customer agent = the customer itself, 1 MB remarks / terms / line remark / description | High |
| 6 | **500s** | quantity `2^40`, product id `2^40`, price-tier id `2^40`, customer / agent / sale-rep id `2^40`; every by-id route with an out-of-range id (`GET/PUT/DELETE/PATCH /{2^31}`); list filter `customer_id=2^40` | High |
| 7 | **Validation (update)** | `PUT` accepts an **empty item list** (wipes the quote's lines), an unknown `branch_code` (stored — one test quote now sits in branch `NOPE-BR`), a past `valid_until`, 150 % discount, 1 MB remarks; `null` branch/customer are silently ignored (no error) | High |
| 8 | List | `GET /sales/quotes/` returns **`total` = 1** for 35 rows (the count loses its FROM when unfiltered) so the pager total is wrong; `search=%` matches every quote (wildcards unescaped); `per_page` allows 100 000; `page=2^40` returns 200 | High |
| 9 | **List caps** | QuotationsPage loads at most **200** quotes (`per_page: 200`) and QuotationApprovalsPage loads **every** quote (`per_page: 100000`) and filters client-side: beyond 200 quotes the oldest disappear from the quotations page; the approvals page transfers the whole table every time | High |
| 10 | Audit | `created_by` / `created_by_name` are never recorded on a quotation (`null`), there is no `version` token (no concurrency check on edit — two editors overwrite each other) | Medium |
| 11 | Reasons | Cancel accepts no reason (`{}` → 200); reject/approve remarks were already bounded by the shared approval fix (1 MB → 422) | Low |
| 12 | Approvals | `GET /common/approvals/pending` is refused (403) for a quotation user without `common:view`, so the approvals data comes from the quote list instead (see #9) | Low |

## Verified OK
- 401 without a token on every route.
- **Approve/reject race:** 6 approves + 3 rejects on one pending quote → exactly 1×200; quote and approval row agree; second approve → 400.
- Cancel race (6 parallel) → 1×200; approved quote edited → goes back to *pending approval* with its approval reset (good).
- Reject needs a non-blank reason (400) and stores it as the rejection reason; resubmitting a rejected quote creates a fresh approval; inactive customers rejected (400); unknown customer 404, unknown branch 404, unknown product 409; negative price / quantity 0 / discount > 100 % on lines / bad dates / quote type / over-long branch → 422; `convert` validates payment method (400) and negative amounts (422) and refuses when there is no stock; mass assignment (`status`, `approval`, `quote_no`, `total_amount`, `approval_id`) ignored on create.
- Pages: `/sales/quotations` (New Quotation, Export, filters) and the approvals page (default filter "Pending Approval") load.

## Phases run / not run
Smoke (partial) · 1b validation & security (API) · 2 races (approve/reject, cancel) · optional 1 workflow, 5 approval matrix, 7 pagination. Not run: UI create wizard end to end, sales-order conversion with stock (and the convert race), create-PO from a quote, stock reservations release, print / email.

## Suggested fix order
1. #1/#2: remove the generic status PATCH (or allow only safe transitions that never skip the approval), gate `accept` / `revise` / `send` on an approved quote, keep the approval row and quote in step.
2. #3/#4: branch checks on every by-id route and on create/update; maker≠checker (approval service) for `sales_quote` too; restrict `mark-expired` (permission, branch scope or scheduler only).
3. #5–#7: strict create/update schemas (≥ 1 line, quantity / price / discount bounds, price ≥ product minimum, tax mode from a list, dates in a sensible window, text lengths, ids int4), validate the branch on update.
4. #8/#9: fix the list total, escape search, bound `per_page`, add a paged endpoint (status, branch, customer, search, sort) and move both pages to server paging with export-all.
5. #10/#11: record `created_by`, add a version token, require a cancel reason.

## Fix log (2026-10-09)
Verified by 62 new backend tests (`backend/tests/test_quotation_rules.py`), a re-run of the audit scenarios, and live in the browser (Quotations: "1–13 of 13", search by quote number, descending sort, Export-all = 13 + header; Quotation Approvals: "Pending Approval" filter, "1–4 of 4", Export-all).

Correction: **#4 (`mark-expired`) was not a real problem** — expiry is purely date-driven (a quote past its valid-until date is expired), the list already applies it lazily for everyone, so calling it changes nothing a user couldn't see; left as is.

- **#1 approval bypass:** `PATCH /{id}/status` only accepts `accepted`, `cancelled` and `expired`; `approved`, `rejected`, `pending_approval`, `completed`, `revised`, `so_created`, `partially_processed` and `sent` return 400 (they belong to the approval workflow and the document actions). `accepted` also needs the internal approval first. The old tests that set draft→completed by hand were rewritten to assert this.
- **#2 gate:** `accept`, `submit-to-customer`, `customer-approve`, `under-review` and `send` need an internally approved quote (400 on a pending one). `revise` of a *pending* quote now closes its approval request (it no longer lingers in the approval list), and a superseded / cancelled / completed quote cannot be revised. `reject-quote` is refused for a quote still waiting for approval (use the approvals page). Cancelling or deleting a quote closes its pending approval.
- **#3 branch access:** a router-level guard checks the branch of every `/{quote_id}...` route (403), create and update refuse a branch the user cannot access, the list and `expiring` are branch-scoped, and an inaccessible `branch_code` filter is 403. The shared approval service now applies the branch rule and **maker ≠ checker for quotation approvals** too (creator cannot approve, superusers exempt) and hides other branches' quotation approvals from the pending list.
- **#5/#6/#7 validation:** at least one line (≤ 200); quantity 1–1 000 000; selling price > 0 (0 only on price-estimate lines), ≥ minimum price and ≤ 999 999 999.99; discount 0–100 %; tax mode none / inclusive / exclusive; valid-until today … +2 years (an edit may resend an old date but cannot move it into the past); delivery date window; fixed discount ≤ quotation total; warranty digits; agent ≠ customer; text lengths (remarks 2 000, terms 5 000, line remark 500 / description 1 000); every id int4. Update: no nulls on branch / customer, items cannot be emptied, an unknown branch is refused, closed quotes (completed / cancelled / revised / SO created) are read-only. 500s on huge ids are now 422.
- **#8 list:** the shared `fast_count` helper lost its FROM when nothing filtered the table (it returned 1) — fixed for every list that uses it; search is literal (`%` finds nothing) and also matches customer name; `per_page` ≤ 200, `page` ≤ 1 000 000; whitelisted sort with id tie-break; date range filters.
- **#9 pages:** both pages now fetch one page at a time with server-side search / filters / sort and **Export-all**; opening a quote from another page (`selectedQuoteId`) loads it by id.
- **#10:** `created_by` / `updated_by` are recorded; quotations carry a `version` token and an update with a stale `expected_version` is a 409 (the page sends it).
- **#11:** cancelling needs a reason (the page now asks for one in a dialog; 422 without).

Tests changed: `test_sales_process` — the minimum-price check now fails at the schema (accepts either error) and the "draft → completed / sent" status-machine tests became "system-managed statuses cannot be set by hand" / "accept needs prior approval".
Not covered: conversion to a sales order with stock (the convert race) and create-PO-from-quote still need a stocked product to exercise.
All QA data from the audits (37 quotations with approvals, customers, branches, users) was removed with a guarded DB script before the fixes.
