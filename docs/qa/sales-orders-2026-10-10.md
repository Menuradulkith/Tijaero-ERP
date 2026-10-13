# Sales Orders page audit — 2026-10-10

Scope: `/sales/orders` (create, view, edit, list/filter/search/export), `/sales/approvals/so-approvals`, and the `/api/v1/sales` order endpoints.
Method: API audit (`tests/test_sales_orders.py`, 65 tests), live race script, built-in browser. No GL-posting actions were run in the UI.

## Findings fixed
| Area | Finding | Fix |
|---|---|---|
| Access | `GET /sales/{id}`, payment history, GL entries/journal/status, approve, complete, cancel, return-full, settle, bank-transfer, returns by id: any user with the permission could read or act on another branch's order | `_scope_invoice` / `_scope_return` on every id route (404 outside your branches) |
| Central approvals | Sales-order approvals had no branch scope and no maker-checker | Same rules as quotes/POs; creator cannot approve (superusers exempt); `approve_invoice` too |
| Mass assignment | `PUT` accepted `status`, `approval`, `approval_status` | Removed from `InvoiceUpdate` (approval only through the approval actions) |
| Validation | ids/limits unbounded (500 on 2^40, limit 100000), empty order accepted, `sale_rep_id=0`, any `payment_method`, 5000+ char remarks, amounts to 1e15 (GL logged Dr != Cr), `discount_amount` 1e12 | Strict create/update schemas; limits <= 1000; payment-method enum; money <= 999,999,999.99; items 1..200 |
| Money | Over-tendered cash stored as given (cash 150 on a 100 order -> GL imbalance); card/credit/bank over-payment accepted | Only cash may exceed the total; stored net of change; others refused |
| Payment details | Bank transfer without bank/reference and cheque without number/bank accepted though the form marks them required; the cheque date was silently replaced by today (`strptime` on a date); `cheque_date: ""` -> 422 | Enforced server-side and in the form; date kept; blank = none |
| Edit | Edit button did nothing (Save disabled on step 1, no Next in edit mode, payment balance check blocked any change of total); edited lines lost barcode, stock link, discount and name; stock not reserved after edit; no price floor on edit; bank-pending orders editable | Edit flow fixed; backend `_store_edited_lines` allocates/reserves real units like create, keeps discounts, re-links GRN barcodes; price floor enforced; only orders waiting for approval can be edited; release flushed (session does not autoflush) |
| Cancel | Cancel twice re-ran the release; approved (already posted) order could be cancelled leaving the ledger behind; approval request stayed pending | Once only; approved order -> sale return; approval request closed |
| Complete | A pending order could be completed around approval | Only `approved` can be completed |
| Delete | Deleting any pending order failed with 409 "duplicate record" (ORM tried to null `invoice_items.invoice_id`); no row lock (5 parallel deletes all 200, instruments could be released repeatedly); pending bank-deposit row, card payment rows and quote link left behind; approval left pending | Dependents removed, row locked (1x200 + 4x404), deposit removed, approval closed |
| Reject | "Reject" hard-deleted the order and discarded the reason; the queue listed cancelled/bank-pending orders (`approval == False`) | New `POST /{id}/reject` (reason required, kept on approval + audit), queue = `pending_approval` only |
| Routes | `/export-csv` and `/returns/statistics` were shadowed by `/{id}` routes (422) | Moved ahead |
| Export | CSV cells starting with `= + - @` not neutralised; "Total" ignored bank transfer and card variants; limit 100000 | `_csv_safe`; total = `grand_total`; limit <= 50000 |
| Search | `/search` ignored customer names, `%`/`_` acted as wildcards; sort_by was any attribute (500 risk) | Customer name search, literal wildcards, sort whitelist |
| `/available-products` | 500 on every call (columns that do not exist), unscoped by branch | Rewritten, branch-scoped |
| Frontend | Page asked for `limit=100000`; approvals list amount always 0 (`total_amount`); detail status derived from a boolean ("pending_approval" for a cancelled order); raw `pending_bank_verification`; "payment completed" toast for a bank transfer; Total column summed tender amounts not the order total | Paged fetch (1000/page), `grand_total`, real status + labels + filters, accurate toasts |
| Attendance (found on the way) | Future check-in test compared clock faces (23:58 refused at 23:57); two tests depended on the time of day | Full datetime compare; tests freeze the clock |

Live race audit (credit orders, dev DB): 8 buyers for the last unit -> 1 created, 7 refused; cancel x6 -> 1; reject vs cancel x8 -> 1; 6 parallel edits -> 6x200, 1 line; delete x5 -> 1x200, 4x404; stock released exactly once each time.

## Not covered / follow-ups
- Cash/card orders post to the GL on creation; not exercised in the UI (covered by existing integration tests).
- `credit-settlement/{transaction_id}/bank-transfer/*` is not branch-scoped (needs a transaction -> invoice lookup); the finance roles that call it are not branch-limited today.
- Invoice numbers are `last row + 1`: deleting the newest pending order reuses its number (unique index prevents duplicates). A sequence table would need a migration.
- Mobile (390px): the status filter chip overlaps the "Add Sales Order" button in the list toolbar.
- Page still filters/sorts client-side over all rows (loaded in 1000-row pages); server-side paging via `/sales/list` is available for a larger rewrite.
- Cancel/reject from the order page is API-only; there is no Cancel button on the page.
