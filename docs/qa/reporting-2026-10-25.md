# Reporting QA (A to Z, Playwright) — 2026-10-25

Scope: everything under reporting.
- **Report Center** (`/reporting`): all 28 reports, filters, sort, column choice, paging, favourites, recent runs, saved and shared reports, and CSV/Excel/PDF/printable exports.
- **Branch Summary.**
- **Document printing:** 11 document types as HTML and PDF, plus the print-preview dialog.
- **Settings:** Print Templates, and Company Settings → Documents.

Environment: local dev, frontend `:3000` and backend `:8020` (`uvicorn --reload`, started outside this session). Logged in as `admin` / `admin123`. The UI was driven by the Playwright MCP; API checks used Playwright's request context and httpx scripts (`scratchpad/qa/security.py`, `qa/docs_security.py`). The backend restarted twice during the run because another session was editing `purchasing/service.py`. Affected steps were retried; no finding depends on those restarts.

## Findings

| Page | Status | Finding | Severity | Repro |
|---|---|---|---|---|
| Print-preview dialog (14 document pages: POs, GRNs, quotations, sales, returns, expenses, journal entries, vouchers, ITNs, credit notes, payroll) | Issue | `TPrintPreviewDialog` turns the document URL into a relative path (`urlObj.pathname + urlObj.search`, line 118). The preview and "Print / Save as PDF" therefore call `/api/v1/...` on the frontend host. In dev, Vite proxies `/api/v1` to `:8000`, but the backend is on `:8020` (`VITE_API_URL`): the preview iframe gets **500** and the PDF tab shows a Chrome error page. The frontend `nginx.conf` has no `/api` location either, so a containerised deployment would serve the SPA instead of the document unless an outer proxy routes `/api`. This predates the reporting work. | High | Purchase Orders → open an approved PO → print icon: blank preview, console `500 … :3000/api/v1/reporting/documents/purchase-order/10803` |
| Payroll page → "Print Payslip" | Issue | The button calls `/reporting/documents/payroll/{payroll id}`, but payroll is a monthly summary with no id: **404**. No per-employee payslip document exists. The dev DB has no payroll runs, so this was confirmed from code plus the API (`GET /reporting/documents/payroll/5` → 404). | High | Payroll page → select a payroll record → Print Payslip |
| Print Templates → HTML tab preview | Issue | Invalid custom HTML shows only "Request failed with status code 422". The server's explanation ("The template must print … {{ doc.number }} and doc.totals") is lost, because the preview request reads its error as text and `handleApiError` gets a string instead of JSON. | Medium | New template → HTML → `<p>{{ doc.number }}</p>` |
| Document / report PDFs | Issue | Each PDF starts a new headless Chromium: **5–12 s** per document PDF (29 measured) and ~6 s per report PDF. The request holds a worker thread for that whole time. | Medium (perf) | Any `/reporting/documents/{type}/{id}/pdf` |
| Report Center filters | Note | Clearing a required date (From) and running silently uses the default (start of month) instead of warning. The field shows the default again after the run. | Low (UX) | Sales summary → clear From → Run |
| Report Center filter dropdowns | Issue | MUI `Select` filters (Age by, Branch, Layout) are not linked to their labels: the combobox is announced by its value ("Due date"), not its name. | Low (a11y) | Inspect `Age by` combobox: no accessible name |
| Document pages → print icon | Issue | Icon-only print button has no accessible name (the tooltip is on a wrapper span). | Low (a11y) | PO detail → print icon `aria-label` = null |
| Print Templates → History | Issue | Each history row is a `ListItemButton` (role=button, no action) wrapping the real Restore button: clicking the row does nothing, and nested interactive controls confuse screen readers. | Low (a11y/UX) | History → click a row |
| Shared confirm dialog | Issue | React warning `validateDOMNesting: <h6> cannot appear as a child of <h2>` from `TConfirmDialog` (DialogTitle wraps a Typography h6). Shared component, predates this work. | Low | Any delete confirmation |
| Payroll document period | Note | `period=2026-10'; --` is accepted (only the first 7 characters are parsed). Nothing reaches SQL. | Low | `GET /reporting/documents/payroll?period=2026-10'%3B --` |
| Dev only | Note | The TanStack Query devtools button covers the bottom-right paging controls of tall tables in dev builds. | Info | GL detail postings → next page under the devtools icon |
| Report Center: all 28 reports in the UI | OK | Each opened and ran: 200, 0 console errors, 0 failed API calls. Page ready in 1.2–1.9 s, run 1.6–3.5 s. Metrics and tables rendered, Export enabled. | — | Playwright loop over catalogue |
| Report Center features | OK | Search (results + empty state), favourites survive reload, reversed dates show "The start date is after the end date", sort desc correct, hiding a column removes it, export request carries hidden columns + sort, paging "1–50 of 1447" → "51–100", phone layout switches catalogue ↔ report with "All reports" and no overflow. | — | |
| Saved reports | OK | Double-click Save → **1** POST. Name with HTML shown as text. Reopening restores the filter ("Document date") and auto-runs. Save changes (PUT) + Share → "Shared" chip. Delete with confirm removes it. | — | |
| Document printing (API) | OK | 29 documents (3 of each type + payroll): HTML 200 with the standard letterhead and PDF 200 (`%PDF`). Amount in words on financial documents. No stray None/undefined/NaN; the two "None" hits are a product named "QA-Lot None Item". | — | |
| Print Templates (UI) | OK | Live preview renders the standard layout. Switching to "Pre-printed stationery" changes the preview and the switch labels. Terms with `<script>` render as text. Double-click Save → 1 POST. Edit → History → Restore (v1 restored as v3). Make/Remove default. Delete with confirm. | — | |
| Company Settings → Documents | OK | Shows logo, BRN, bank account. Save is disabled until something changes. Logo endpoint: 401 without login, 403 without `settings:view`/`update`. Company settings response carries no logo blob. Field limits (BRN 50, SWIFT 20, website 255) → 422. | — | |
| Report exports | OK | `suppliers.aging` as PDF (`%PDF`), printable HTML (letterhead with logo, name, TIN), Excel (zip), CSV (UTF-8 BOM). | — | |

### Security (Phase 1b, API)

`scratchpad/qa/security.py` re-run: **0 findings**.
- **Authentication:** no token → 401.
- **Permissions:** no-permission user → 403 or an empty catalogue.
- **Branch isolation:** other-branch reports → 403, single-branch auto-select, multi-branch "pick a branch" → 422. Other-branch invoice print and `for-document` → 404.
- **Saved reports:** another user's private report → 404. Mass-assigned fields are ignored.
- **Field validation:** names (empty, spaces, 201 chars, 10k chars) → 422. Ids beyond int4 → 422 (the 500 from 2026-10-24 stays fixed).
- **Injection:** SQL-like branch/account/lookup inputs are handled. HTML in the export title is escaped. CSV formulas are neutralised.
- **Print templates:** logo/colour/paper/size limits → 422. Jinja sandbox escapes fall back to the built-in layout. `<script>` in the footer is escaped. A version of 99 is ignored on create.
- **Headers:** `nosniff`, `no-store`, `DENY`.

### Duplicates & races (Phase 2)

| Check | Result |
|---|---|
| 10 parallel `set-default` on two templates | 10×200, exactly 1 default — OK |
| 8 parallel PUT with the same `expected_version` | 1×200, 7×409 — OK |
| UI double-click Save (saved report, print template) | 1 write each — OK |
| 10 parallel identical saved-report creates | 10×201 (names are not unique, by design) |

## Coverage

Phases run: smoke (UI + API), field validation, security, duplicates & races. **Not run:** load (needs a separate database, only on request).

Optional checks:
1. Workflow & status transitions — skipped (trigger not met).
2. Accounting integrity — run (invoice print totals against the posted figures, see `test_document_layouts_2026_10_25.py`; VAT vs GL in earlier pass).
3. Stock integrity — skipped (no stock-moving flows in reporting).
4. Calculation accuracy — run (totals rows and invoice/quotation totals, amount in words).
5. Approval matrix — skipped (trigger not met).
6. Reports & exports — run (all formats, date edges, export = screen).
7. Pagination/sort/filter — run (client sort, column hide, paging).
8. Data lifecycle — skipped (trigger not met).
9. Time & locale — light (dates print as "12 Oct 2026", amounts LKR).
10. Accessibility — light (findings above), not a full audit.
11. Session — skipped (trigger not met).
12. Resilience — light (backend restarts mid-run: UI recovered after the server came back).
13. Regression pinning — not yet (no fixes made in this pass).
14. Visual regression — skipped (not requested).

## Test data

Created and removed in this pass:
- saved report "QA-PW saved aging" (id 57)
- print templates "QA-PW invoice layout" (231) and "QA-PW invoice layout 2"
- the `QA-sec*` / `QA-race*` / `QA-tpl*` rows from `security.py`

Final check: 0 `QA-` rows in `reports` and `document_templates`. A favourite toggled on and off is left in the browser's localStorage only. The sample company details from 2026-10-25 are still in place (restore script: `scratchpad/set_sample_company.py --restore`).
