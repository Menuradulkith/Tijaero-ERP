# Reporting QA — 2026-10-24

Scope: Report Center (`/reporting`, 28 reports), exports (CSV / Excel / PDF / printable page), saved and shared reports, recent runs, old `/reporting/<module>` redirects, Branch Summary page, Settings → Print Templates, document print/PDF routes (`/reporting/documents/*`).

Environment: local dev, backend `:8020`, frontend `:3000`, dev DB `erp_postgres2`. Playwright MCP was locked by another session, so UI checks used the built-in browser and API checks used httpx scripts with locally minted test tokens (scripts: scratchpad `qa/sweep.py`, `qa/security.py`).

## Fix status (same day)

All eight confirmed issues are fixed. Backend regressions are pinned in `backend/tests/test_reporting_qa_fixes_2026_10_24.py`; frontend fixes were re-checked live, since the frontend has no test runner.

| Issue | Fix | Verified by |
|---|---|---|
| id overflow 500 | Report Center integer filters limited to the int4 range; floats and booleans rejected (`center/core.py`). Lookup `ids` and the legacy `POST /reporting/inventory` category are guarded the same way. | pytest: 2^31, 2^40 and -2^40 return 422; int4 max returns 200 |
| Inventory summary stock value | On-hand units × purchase cost, same rule as the Stock Summary and Stock valuation (`ReportingService.get_inventory_report`) | pytest: equals Stock valuation (1,753,103.00 on dev) |
| Threshold ignored | Uses `low_stock_threshold` (bounded 0–1,000,000) | pytest; live: 0, 5, 1000 → 6, 9, 22 items |
| Whitespace names | Schemas trim before the length check (saved reports, print templates) | pytest: "", "   " and tab/newline return 422; padded names are trimmed |
| Double-click Save | Ref guard spanning the whole save (Report Center save dialog, Print Templates editor) and the export menu | Live: triple click gives 1 row and 1 toast |
| Phone layout | Below the `md` breakpoint the page shows the catalogue or the open report, with an "All reports" button | Live at 390×844 |
| Branch Summary export | Shared `modules/reporting/csv.ts` (quoting, formula prefix, BOM, CRLF); button renamed "Export CSV" | Live: `csvCell` cases for = + - @, commas, quotes, line breaks and numbers |

## Findings

| Page | Status | Finding | Severity | Repro |
|---|---|---|---|---|
| Report Center → Inventory summary | Issue | "Stock value" (113,902.20) is the sum of one unit cost per product, not quantity × cost. It contradicts Stock valuation (1,753,103.00) in the same catalogue. This existing code was wrapped unchanged. | High | Run `inventory.summary` and `inventory.valuation` with defaults and compare the stock value tiles |
| Report Center → Inventory summary | Issue | The "Low-stock threshold" filter has no effect: `ReportingService.get_inventory_report` uses the constant `LOW_STOCK_THRESHOLD = 5` | Medium | Threshold 0, 5 and 1000 all give 9 low-stock items |
| Report Center API (`/run`) | Issue | An id filter above int4 (`customer_id = 2^40`) returns 500 "The report could not be generated" (Postgres integer overflow). Same for `supplier_id` and `product_id`. | High | `POST /reporting/center/reports/customers.payments/run {"params":{"customer_id":1099511627776}}` |
| Report Center → Save dialog | Issue | No in-flight guard: a double-click on Save creates two saved reports (ids 18 and 19, 6 ms apart) and shows two "Report saved" toasts | Medium | Open Save as…, enter a name, double-click Save |
| Settings → Print Templates | Issue | Same missing guard on Save: the second POST either creates a duplicate template or, if the first became the default, fails with a generic "A duplicate record was detected" toast | Medium | New template, double-click Save |
| Saved reports + print templates API | Issue | A whitespace-only name passes `min_length=1` and is then stored as "" after `.strip()` | Medium | `POST /reporting/center/saved {"name":"   ",…}` → 201 with name ""; same for `POST /reporting/print-templates` |
| Report Center (phone, 390 px) | Issue | The catalogue (~30 entries) renders above the viewer, so tapping a report seems to do nothing; the report is a long scroll down. No horizontal overflow. | Medium (UX) | Resize to 390×844 and pick a report |
| Branch Summary → "Export Excel" | Issue | Writes a hand-built CSV: values are not quoted (a comma in a branch, vendor or expense name breaks columns) and formulas are not neutralised (a vendor or branch name starting with `=`, `+`, `-` or `@` runs in Excel). The button says Excel but the file is CSV. | Medium | Branch named `=HYPERLINK(...)` or vendor `ACME, Ltd` → Export Excel |
| Report Center → PDF export | Note | Each PDF starts a new headless Chromium: 8–13 s per export, holding a worker thread for that time | Low (perf) | Export PDF of `sales.summary` / `finance.gl_detail` |
| Saved reports | Note | Names are not unique per user: 10 parallel identical creates → 10 rows. Probably fine by design, but combined with the double-click bug it makes duplicates easy. | Low | Burst of 10 `POST /saved` |
| Document print routes | Note (pre-existing) | Print preview iframes pass the JWT in `?token=` (browser history, server logs). Responses are `Cache-Control: no-store`. | Low | `GET /reporting/documents/purchase-order/{id}/pdf?token=…` |
| Report Center — all 28 reports | OK | Run with defaults, a single day, a month-end span and an empty future range → 200. Feb 30 and a reversed range → 422. Every totals row equals the sum of its rows. Slowest run < 2 s. | — | `qa/sweep.py` |
| Exports | OK | CSV, Excel (valid zip) and printable page for all 28. PDF for 4 large reports. CSV rows match the on-screen table and respect hidden columns and sort. CSV/Excel cells starting with `= + - @` are neutralised. | — | |
| Old routes | OK | `/reporting/sales`, `finance`, `inventory`, `hr`, `warehouse`, `support` redirect to the matching report; unknown sub-routes go to `/reporting` | — | |
| Branch Summary page | OK | Loads, generates, no failed API calls; branch names containing `<img onerror>` / `' OR 1=1 --` render as text | — | |
| Document PDFs | OK | PDF for every document type (invoice, quotation, credit note, PO, GRN, purchase return, expense, ITN, journal entry, voucher, payroll) | — | |
| Reconciliation (previous run) | OK | AR/AP aging = outstanding reports; Stock valuation = Stock Summary; GL detail closing = trial balance (20/20 accounts) | — | `backend/tests/test_report_center_phase3_2026_10_24.py` |

### Security (Phase 1b)

| Page | Field/Endpoint | Input | Expected | Actual | Severity |
|---|---|---|---|---|---|
| Report Center | catalog / run / export / recent / lookup, print-templates, documents | no token | 401 | 401 | OK |
| Report Center | catalog | `qa-none` (no permissions) | empty list | empty | OK |
| Report Center | run, export, lookups, print-templates, for-document | `qa-none` | 403 | 403 | OK |
| Report Center | `sales.summary`, `customers.outstanding` | `qa_sm_a1` asks for `QA-BR-B` | 403 | 403 | OK |
| Report Center | `sales.summary` default | `qa_sm_a1` | only `QA-BR-A` rows | only `QA-BR-A` | OK |
| Report Center | `customers.outstanding` | `qa-u21` (2 branches), no branch | 422 "Pick a branch" | 422 | OK |
| Documents | `GET /documents/invoice/{QA-BR-B id}`, `for-document` | `qa_sm_a1` | 404 | 404 | OK |
| Saved reports | run / PUT / DELETE another user's private saved report | `qa_sm_a1` | 404 | 404 | OK |
| Saved reports | POST with `created_by`, `is_template`, `report_type`, `id`, `last_run` | mass assignment | ignored | ignored | OK |
| Saved reports | share without `saved_reports:share` | `qa_sm_a1` | 403 | 403 | OK |
| Saved reports | name 201 chars / 10k / description 1001 / view > 20 kB | length | 422 | 422 | OK |
| Run params | `customer_id` abc / -1, `days` 1e12, `fiscal_year` 2026.5, `account_code` SQL, `product_id` 0, bad select values, 10k-char date | validation | 422 | 422 | OK |
| Run params | `customer_id` 2^40 | overflow | 422 | **500** | High |
| Run params | `branch_code` `' OR 1=1 --` (admin) | injection | 200, no rows | 200 | OK |
| Lookups | `%`, `_`, `\`, `' OR 1=1 --` | injection | 200 | 200 | OK |
| Export | printable page `title` `<img src=x onerror=alert(1)>` | XSS | escaped | escaped | OK |
| Export | `format` `exe` | enum | 422 | 422 | OK |
| Print templates | name 101, unknown type, unknown branch, SVG logo, CSS in colour, paper A0, HTML > 200k | validation | 422 | 422 | OK |
| Print templates | `{{ ''.__class__.__mro__… }}`, `{{ cycler.__init__.__globals__.os.popen('id') }}` | sandbox escape | blocked, built-in layout | fell back (`X-Print-Template-Fallback: 1`), no output | OK |
| Print templates | footer `<script>alert(1)</script>` | XSS | escaped | escaped | OK |
| Print templates | `id`, `version: 99`, `created_by` | mass assignment | ignored | version 1 | OK |
| Any JSON response | headers | — | nosniff, no-store | `nosniff`, `no-store`, `DENY` | OK |
| Run | malformed JSON body | error leak | 422, no internals | 422 | OK |

### Duplicates & races (Phase 2)

| Check | Result |
|---|---|
| 10 parallel `set-default` on two templates | 10×200, exactly 1 default afterwards — OK |
| 8 parallel PUT with the same `expected_version` | 1×200, 7×409 — OK |
| 10 parallel identical saved-report creates | 10×201 (no uniqueness; see Low note) |
| UI double-click Save (saved report, print template) | Duplicate writes — see findings |

## Coverage

Phases run: smoke (UI + API), field validation, security, duplicates & races. Not run: load (needs a separate DB, only on request).

Optional checks:
1 Workflow & status transitions — skipped (trigger not met: reporting has no workflow);
2 Accounting integrity — run (VAT summary vs GL 2210, GL detail vs trial balance; found 2 approved credit invoices never posted to the GL, already reported);
3 Stock integrity — run (stock movement closing vs on hand; 6/19 products differ because of QA data, already reported);
4 Calculation accuracy — run (totals rows recomputed for every table of every report);
5 Approval & permission matrix — skipped (trigger not met);
6 Reports & exports — run (date edges, export = screen, report = source reports);
7 Pagination/sort/filter — run, light (client-side sort and column hiding applied in exports; no server paging in the Report Center);
8 Data lifecycle — skipped (trigger not met);
9 Time & locale — run, light (month-end and single-day ranges; dates in server time zone);
10 Accessibility — skipped (not requested);
11 Session behaviour — skipped (trigger not met);
12 Resilience — skipped (not requested);
13 Regression pinning — not yet (no fixes made);
14 Visual regression — skipped (not requested).

## Test data

Created and deleted again: saved reports `QA-dblclick-save` (ids 18, 19), the `QA-sec` / `QA-race-saved` / validation rows from `security.py`, and print templates `QA-tpl*`, `QA-race-*`, `QA-dblclick-template` (id 132). Final check: 0 `QA-` rows in `reports` and `document_templates`. Report runs made during testing remain in `report_executions` (audit log).
