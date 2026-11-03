# QA audit: Support, Reporting, Notifications, Communication, Common, Chat-agent, Peek (2026-11-03)

Counts: 4 High, 1 Medium-High, 9 Medium, 13 Low (27 findings). Marketing has models only and no router.
All 33 Report Center reports returned 200 in under 2 s with default params. No real email was sent.

## High
- **MSC-01** `GET /common/reference-data` (common/api.py:25): qa-none reads all products incl. cost_price/minimum_price, customers, suppliers, employees, sales stock.
- **MSC-02** `GET /common/activity-log` (common/api.py:241): no permission/branch check; qa-none reads audit trail of users and journal entries.
- **SUP-01** Support module (support/service.py:41,:63; support/api.py): no branch scoping; qa_adm_a (QA-BR-A) reads/creates/edits QA-BR-B tickets, job items, warranty claims.
- **RPT-01** Legacy reporting (/reporting/sales :40, dashboard :130 with shared cache :29, quick-stats, /finance, /hr, /branches :399, /branch-summary :409): ignores user branches; branch users see company totals and other branches' cash.

## Medium-High
- **MSC-03** Approvals (common/approval_service.py:419-453, common/api.py:450): only sales_quote/purchase_order branch-filtered; `GET /common/approvals/{id}` has no branch check.

## Medium
- **SUP-02** `?date_from=notadate` on /support/tickets and /support/warranty-claims → 500 (support/api.py:53-54, :179-180).
- **SUP-03** Delete ticket with job items → 400 "A required value is missing"; delete with call logs → 204 and orphans them, `GET /support/call-logs/3` → 500 (service.py:97, models.py:70 vs schemas.py:47).
- **COM-01** Sales-order / sales-return emails always fail: no such PDF document type (core/email.py:33 vs print_templates DOCUMENT_TYPES); UI says "Email queued". PDF URL hard-coded to 127.0.0.1:8000.
- **COM-02** Email subject tags other than {document_id} not substituted (communication/api.py:209).
- **RPT-02** Print preview passes JWT in URL `?token=` (TPrintButton.tsx:95; auth/dependencies.py:83).
- **MSC-04** (code review) csvExport.ts:9-24 no CSV formula-injection guard.
- **CHAT-01** `GET /chat-agent/conversations?limit=-5` → 500 (chat_agent/api.py:83).
- **CHAT-02** `POST /chat-agent/chat` with conversation_id 99999999999 → 500 (chat_agent/schemas.py:9).
- **RPT-06** Invoice PDF 16.3 s cold / 7-8 s warm; Report Center PDF export 7.1 s.

## Low
- SUP-04 tickets have no status field (close/reopen untestable).
- SUP-05 accepts blank job_type, unknown branch_code, quantity -5, any job_status; overlong error doesn't name field; job-items of missing ticket → 200 [].
- SUP-06 JobItemsPage / CallLogsPage are stubs.
- SUP-07 SupportTicketsPage: Job Number ignored by backend, raw ID fields, View button no handler, no permission gating, generic toasts, only 100 rows load (WarrantyClaimsPage similar).
- NTF-01 notification message unbounded, empty title/message accepted, unknown branch_codes "sent" to nobody, javascript: action_url accepted.
- RPT-03 /reporting/sales accepts start > end; /reporting/finance accepts any report_type.
- RPT-04 custom_remarks unbounded; duplicate template names.
- RPT-05 template that always hits sandbox saves then silently falls back (sandbox itself held).
- RPT-07 saved report can store an inaccessible branch.
- RPT-08 (code review) HTML export via window.open(blob:) drops CSP (output autoescaped).
- COM-03 (code review) CR/LF in subject leaves log "pending" forever; /email/send validates before permission; GET /email/templates writes rows.
- MSC-05 `POST /common/approvals` accepts status "approved" and any approval_for.
- MSC-06 locations no branch scoping; QA-BR-A has two locations.
- PEEK-01 out-of-branch quotations/POs → 403 not 404 (existence leak).

## Verified OK
Notification IDOR, print-template sandbox/CSP/validation/409/restore, Report Center permissions + branch scope + param fuzzing + saved-report sharing, document print branch 404 / qa-none 403, bad FKs → 400, overlong → 422.

## Leftovers
Approval 31937 (QAAUDIT-1103), ~6 notification content rows, report_executions rows. Email template 4 restored.
