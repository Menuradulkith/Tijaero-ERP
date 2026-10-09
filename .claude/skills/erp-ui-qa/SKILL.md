---
name: erp-ui-qa
description: Evaluate one Tijaero ERP module in the browser with the Playwright MCP — login, walk every page, check console/network errors, exercise list/filter/create-dialog flows, and write a findings report. Use when asked to test, QA, evaluate, or smoke-check a module (sales, purchasing, finance, warehouse, hr, support, reporting, inventory, branches, users, settings) in the UI.
---

# ERP UI QA (Playwright MCP)

Evaluate ONE module per run. Never the whole system at once.

## Setup (local dev only)
- Frontend http://localhost:3000, backend http://localhost:8020 (see `frontend/.env`; check with `netstat -ano | grep -E ":3000|:8020"`; if down, tell the user — don't start servers yourself unless asked).
- Login `/login`: seeded dev account `admin` / `admin123` (from `START_BACKEND.sh`). Local dev host only.
- Load Playwright tools first with ToolSearch `select:` (navigate, snapshot, click, type, fill_form, find, console_messages, network_requests, take_screenshot, press_key, wait_for, select_option, resize, evaluate).

## Gotchas learned
- API base is `VITE_API_URL` in `frontend/.env` = **http://localhost:8020/api/v1** (not 8000). Vite does not proxy `/api`; for direct API checks use `page.context().request` (no CORS).
- The Playwright profile autofills the login form, so an "empty submit" can really log in. Always `fill('')` both fields first.
- Auth lives in `localStorage['auth-storage']` (zustand persist). To log out for a test use `removeItem('auth-storage')` + `clearCookies()`; `localStorage.clear()` can race with the app re-persisting.
- `getByLabel('Password')` is ambiguous (tabpanel + input) — use `#login-panel-password input`. Usernames: `getByRole('textbox',{name:'Username'})`.
- Errors are toasts (`[role=status]`/`[role=alert]`) and stack up; read them right after the action.
- If the Playwright MCP is unavailable (connect timeout), fall back to (a) direct API checks and races with an async Python client (`httpx.AsyncClient` + `asyncio.gather`, see the verify script pattern in `docs/qa/product-catalogs-2026-10-09.md`) and (b) the built-in browser (`mcp__Claude_Browser__*`: `find` → `computer` clicks/typing for forms, `javascript_tool` to click grid rows and read toasts, `read_network_requests` to count POSTs). `resize_window` to 1440x900 first (viewport can start at 0x0) and reset to `desktop` afterwards.
- Login rate limit: 4th rapid bad login returns 429 — don't hammer it.
- UI sessions expire (~1 h access token) and the refresh cookie is gone after `clearCookies()`: if a page suddenly lands on `/login` or expected buttons are missing, sign in again via the UI before assuming a bug.
- Login is rate-limited (~5 per minute per IP, counting good logins): log in once per script, reuse the token, and `browser_wait_for` 60 s between scripts that need several accounts.
- AuthZ testing recipe: create a throwaway role with only the permission under test (`POST /groups/` with `permission_ids` taken from the Admin group's `permissions`), create `QA` users in it and in a read-only role (`Viewer`), log in as each and call the endpoints directly. Deactivate the users and delete the role at the end. Superuser accounts cannot be created via API; test edits against them only with same-value no-op PUTs.
- Roles can no longer be deleted through the API (by design: no delete on Roles, Users or Branches). Create the fewest QA roles possible, move test users off them, and remove them with a DB script that refuses anything not named `QA-` or still assigned (see the scratchpad pattern used in docs/qa/roles-2026-10-08.md). The permission catalog is superuser-only; do not add rows to it while testing.
- The backend now enforces "no privilege you do not hold" (see `backend/app/auth/user_access.py`): a role-limited test manager can only manage users whose permissions are a subset of theirs, so to test the happy path give the target user no extra permissions.
- `/users` list uses `skip`/`limit` (returns a plain array), `/branches` uses `page`/`size`. UsersPage hides superusers by design.
- Dirty forms (e.g. Add Branch) trigger a `beforeunload` guard that blocks `goto`/reload and conflicts with a script-level `page.on("dialog")` handler. Run each scenario on a fresh `const p = await page.context().newPage()` (auth is shared via localStorage) and `p.close()` afterwards.
- Some MUI dialogs (e.g. location dialog) lack `role=dialog`: use `.MuiDialog-paper`. DataGrid renders only visible rows (virtualized) — compare with the footer count, don't assume a bug.
- Text inputs wrapped by `TPhoneField`: type with `keyboard.press` per key; `fill()` works for programmatic values; synthetic `ClipboardEvent` paste is ignored by React.
- No-delete entities (e.g. branches): QA records can only be deactivated — create the minimum, prefix `QA-`, deactivate at the end and list them in the report.
- FastAPI answers a no-trailing-slash URL on a collection route with a 307 redirect, so request listeners see every call twice (list GETs and POST/PUT) — not a double submit; confirm in the DB. Report slash-less `apiClient` calls as an efficiency finding.
- After editing backend files uvicorn auto-reloads for a few seconds; parallel/API calls in that window fail with `ECONNRESET` — wait and retry before suspecting a bug.

## Token rules (important)
1. Prefer `browser_snapshot` with `filename` + `browser_find` (text/regex) over full snapshots in context. Screenshots only for visual bugs, `scale: css`, JPEG.
2. After each page navigation, check `browser_console_messages(level: error)` and `browser_network_requests(static: false, filter: "/api/")` — report only 4xx/5xx.
3. Batch with `browser_run_code_unsafe` for repetitive steps (loop over routes, collect page title, error toasts, row count) and return a compact JSON.
4. Don't re-read pages already checked. Keep notes terse: one line per finding.

## Per-page checklist
- Loads without console errors / failed API calls / blank screen / stuck spinner.
- Table: rows render, pagination, search, filters (open panel, apply, clear), sort, empty state.
- Row actions and view/edit dialogs open and close; required-field validation shows messages.
- Create flow: open dialog, submit empty (expect validation), then valid test data prefixed `QA-` so it's identifiable. Do NOT delete, approve, post, or pay real-looking records; only act on `QA-` records.
- Layout at 1440x900 and 390x844 (resize) — overflow, clipped dialogs.
- Phone fields use `TPhoneField`; check formatting/validation where present.

## Phases
Run in order; say which phases were NOT run in the report so coverage is never implied.
1. **Smoke** — per-page checklist above (default phase), then **1b field validation & security**.
2. **Duplicates & races** — only on `QA-` data, only for modules with create/approve/post flows (see below).
3. **Load** — only on request, never on the dev DB (see below).

### Phase 1b: field validation & security (per module, on `QA-` data)
Field validation — test every form field in the UI, then repeat the failing/edge values straight against the API (frontend checks can be bypassed; expect a clean 4xx with a message, never a 500 or silent acceptance):
- Required: empty, whitespace-only. Length: at max, max+1, very long (10k chars). Unicode/emoji/RTL text.
- Numbers/money: 0, negative, decimals beyond precision, 1e12, `NaN`, non-numeric. Quantities and prices must reject negatives where nonsensical; totals must not overflow.
- Dates: past/future where illegal, end < start, invalid (`2026-02-30`), wrong format.
- Email, phone (`TPhoneField`: E.164, country code, letters, too short/long), NIC/ID formats, uniqueness (case-insensitive and trailing-space variants).
- Selects/enums: value not in list; foreign key to a non-existent or other-branch record.

Security:
- **AuthZ / RBAC:** call each list/create/approve/delete endpoint as (a) no token, (b) a low-permission user (see `backend/scripts/create_demo_users.py`, `backend/tests/conftest.py::make_user`), (c) a user from another branch. Expect 401/403 and branch-scoped results — also check the UI hides what the API forbids. Try IDOR: change the numeric id in `/…/{id}` to another branch's record.
- **Injection / XSS:** put `<img src=x onerror=alert(1)>`, `"><script>`, `' OR 1=1 --`, `{{7*7}}` in names, notes, search boxes and filters; confirm they render escaped in tables, dialogs, print previews, PDFs and exports, and that no `dialog` event fires (`browser_handle_dialog`).
- **Mass assignment:** POST/PUT extra fields (`is_superuser`, `branch_code`, `status`, `created_by`, `approved`) — must be ignored or rejected.
- **Exports:** a cell starting with `=`, `+`, `-`, `@` must be neutralised in CSV/Excel exports.
- **Uploads:** wrong type, oversize, double extension, path traversal in filename.
- **Tokens/URLs:** secrets in URLs (print previews accept `?token=`), tokens in console/network logs, response headers (CORS origins, `X-Content-Type-Options`, cache headers on authenticated JSON).
- **Errors:** responses must not leak stack traces, SQL or file paths.
Report each as Page | Field/Endpoint | Input | Expected | Actual | Severity.

### Phase 2: duplicate creation & race conditions
UI (Playwright):
- Double-click Save / Submit; press Enter twice quickly; click Save, then Save again while the spinner shows. Expect exactly one new row and the button disabled while pending.
- Submit, then browser Back and resubmit; reload right after submit. Expect no second record.
- Same unique value twice (e.g. same customer name/phone/email, supplier, SKU, invoice no) — expect a clear validation error, not a 500 or silent duplicate.
- Open the same record in two tabs, edit in both, save both — check last-write-wins vs. conflict handling; no crash.
- Approve/reject the same item from two tabs — second action must fail cleanly, not double-post.

API (use `page.context().request`, API base is `http://localhost:8020/api/v1`):
- Fire the same create 10x in parallel with `Promise.all`; assert 1 success and the rest 4xx (unique constraint), 0 × 500.
- Parallel creates with *different* payloads: check sequential display numbers / document numbers (customers, suppliers, SO, PO, GRN, invoices) are unique and gap-free-or-explainably-gapped.
- Parallel approve/post/pay on the same document: check ledger, cashbook and stock were written once (query the resulting list/report endpoints).
- Idempotent endpoints (logout, cancel, close): call twice concurrently, both must succeed or return a clean 4xx — never 500.
Backend: add the confirmed cases as pytest (threads + a real DB session, see `backend/tests/test_logout_revocation.py` for the fixture style) so they stay fixed.
Cleanup: report the `QA-` records created; delete only those, only if the user asks.

#### Race-test recipe (proven on Branches / Users / Roles)
- Fire bursts with `Promise.all` over `page.context().request`, **catch each request** (`.catch(() => ({s:'ERR'}))`) and tally statuses; any `5xx`/`ERR` is a finding. Keep bcrypt-heavy bursts (user creates) ≤ 10 per script.
- Per create endpoint run: (a) N identical bodies → expect exactly **1×201**; (b) 8 case/space variants of each unique field (`X`, `x`, ` X `, `X `, `X  `…) with *other* fields distinct → exactly 1×201; (c) N records renamed onto the **same** value at once → exactly 1×200, rest clean 400; (d) parallel edits of **one** record (different fields, and role/branch/permission replacement) → all 200; (e) afterwards scan the list for case-insensitive duplicates → 0.
- Service-level checks alone are not race-proof: a unique functional index (`lower(btrim(col))`) must back them; unit-test it by inserting variants inside `db.begin_nested()` and expecting `IntegrityError` (see `backend/tests/test_unique_indexes.py`). The harness can't run true concurrency (single shared connection), so prove concurrency live and the DB rule in tests.
- UI: `dblclick()` / `click({clickCount: 3})` on Save, count `POST`/`PUT` requests and toasts; expect 1 write, 1 success toast, no error toast. Save handlers that `await` duplicate checks before the mutation need a ref guard that spans the whole save.
- Cleanup of test rows that have no delete endpoint: DB script that selects by my id range, asserts all are inactive/QA-named, **dry-runs the FK dependents** (resolve the actually referenced column: `id`, `branch_code`, `employee_id`…) and aborts if any non-system table references them. Look at `docs/qa/races-and-duplicates-2026-10-09.md` for the pattern.

#### Lessons from the Product Catalog pass
- **After creating QA rows, re-check the list endpoints and the list page.** A row the API accepted but cannot serialize (e.g. one created by a request that returned 500 *after* commit) makes the whole list/search/page return 500 for everyone. When a list returns 5xx, bisect by `skip`/`limit=1` and by `GET /{id}`, then check the row against the response schema (`Schema.model_validate(row)` in a DB script).
- A request that returns **500 after having created data** is a finding by itself: check the DB afterwards (count rows before/after) and clean the leftover.
- Check route order: a static path declared after `/{id}` (`/products/export-csv`, `/search`) is shadowed and returns 422 on the path param.
- Pair "sequential duplicate check is case-insensitive" with the 8-way parallel variant burst; without a DB unique index 5 of 8 usually win.
- Page-size gotchas: list endpoints cap `limit` (products accepts 1000, not 100000); a 422 on the scan makes duplicate scans silently empty — assert the list length before trusting a "0 duplicates" result.
- Test UI Save with `dblclick()` on every create form; the same missing in-flight guard turned up on Branches, Roles, Products, Categories and Brands.
- **Check for silent list caps:** grep the page for `getAll(0, <n>)`/`limit` and count rows via API vs the grid footer. A hard-coded limit with client-side paging/filtering hides rows past it with no warning; seed >1 page of QA rows and verify the footer total, page 2, search-resets-to-page-1 and sort across pages. Also verify an **unfiltered** total (a `count(*)` after `with_entities` loses its FROM, so filtered tests pass while the plain list says "1 of 1").
- **Fetching a page at a time breaks "export what I see":** after switching a grid to server paging give it an `exportAllRows` (fetch every page with the same filters) and check the CSV line count against the footer total. Also test the **double-click Save** and an over-long value (256 chars, 2^40) on every text/number field — unbounded schema fields are the most common source of 500s.
- **Check response models, not just inputs:** a PUT that returns the ORM object with no `response_model` leaks every column (`PUT /settings/profile` returned `hashed_password`). After any "update" call, diff the response keys. Also test the **full-roundtrip PUT** (send the whole GET body back, nulls included) — constraints on Optional fields and validators like `EmailStr` (rejects `.local`) can break saving untouched forms. Snapshot global settings/profile rows before destructive tests and restore after.
- **Branch scope on every by-id route:** for each document type, log in as a user limited to branch X and GET / PATCH / cancel / approve a document of branch Y (and the list with `?branch_code=Y`). Check `?status=`-style query params for names that shadow imported modules, route declaration order (static paths after `/{id}`), and maker≠checker on approvals. Use rotating QA branches when a daily-limit rule caps creates per branch.

### Phase 3: load (on request only)
- Playwright is NOT a load tool. Use k6 or Locust against the API; get the user's OK on target, VUs and duration first.
- Never against the dev DB or production. Needs a staging copy or throwaway DB; ask where it is.
- Scenarios: concurrent logins (note the login rate limit: 4th rapid bad login → 429, so use valid creds and a test-only limit), list endpoints with large page sizes and filters, reports/exports, create-and-approve flows.
- Report p50/p95/p99 latency, error rate and throughput; flag endpoints with N+1 queries or >1s p95. Ramp up (e.g. 5 → 25 → 50 VUs), stop on first sustained errors.

## Optional checks (run ONLY when triggered)
Default run = smoke + 1b. Do not run an optional check unless its trigger holds for the module/change under test, or the user asks for it by name or number. In the report, list each as `run (reason)` or `skipped (trigger not met)`. Keep each one short and reuse data from earlier phases; stop at the first confirmed finding per check and note how to widen it.

| # | Check | Run when | What to do |
|---|---|---|---|
| 1 | **Workflow & status transitions** | module has statuses/approvals (sales, purchasing, finance, warehouse, hr), or a status/cancel/short-close/approval change is under test | Walk the chain quotation → SO → approval → delivery → invoice → payment → return on `QA-` data. Illegal jumps must fail: edit after approval, approve twice, pay a cancelled/closed doc, return more than sold. Cancel/short-close must reverse reservations, stock and balances. UI buttons must match what the API allows (call the endpoint directly for the forbidden ones). |
| 2 | **Accounting integrity** | flow posts money (payments, invoices, expenses, cashbook, vouchers, payroll, returns) | After the flow: journal entry balances (Dr = Cr); general ledger, cashbook, trial balance/balance sheet agree with the source docs; nothing posts into a closed accounting period; `finance/posting-failures` has no new rows; day-end reconciliation matches. |
| 3 | **Stock integrity** | flow moves stock (GRN, sales, returns, transfer notes, ITN, receive notes) | Quantity before/after per step; no negative stock unless allowed; batch/serial uniqueness; sender and receiver branch totals agree after a transfer; cancelled docs restore stock. |
| 4 | **Calculation accuracy** | amounts are computed (tax, discount, coupons, vouchers, commission, payroll, currency) | Recompute 2–3 cases by hand incl. rounding edge (x.5, many lines). UI total = API total = printed PDF = report. Test with the non-default currency/decimals setting. |
| 5 | **Approval & permission matrix** | module has an approvals page or a maker/checker rule | Maker ≠ checker; approver limited to own branch/limit; rejection reason required and stored; audit trail shows who/when. Complements 1b AuthZ, don't repeat it. |
| 6 | **Reports & exports** | module has reports, CSV/Excel/PDF export or print preview | Report totals = list-page totals. Date edges: month end, single day, empty range, timezone boundary. Export contents = on-screen data; print preview renders and needs no extra login. |
| 7 | **Pagination / sort / filter correctness** | list has >1 page, server-side filters or sort | Filtered count = rows returned; page 2 never repeats page 1; sort is stable and correct on number/date/text; filters survive reload/back; ~10k rows stays responsive (<2s). Use `browser_run_code_unsafe` to compare API vs. DOM. |
| 8 | **Data lifecycle** | entity is referenced by others (customer, supplier, product, branch, user) or a migration changed it | Deactivate/delete a referenced record on `QA-` data: clean block or soft-delete, no orphans, no 500. Display numbers stay sequential. For migrations: `alembic upgrade` / `downgrade -1` / `upgrade` with data present (scratch DB only). |
| 9 | **Time & locale** | dates/currency shown, or around day-end/month-end docs | Configured timezone vs. server time near midnight; same date in UI, API and PDF; date/currency/decimal formatting matches company settings. |
| 10 | **Accessibility** | new or changed UI (dialogs, forms, tables), or user asks | Keyboard-only run of the flow; focus trapped in dialogs and returned on close; visible focus; labels on inputs/icon buttons; contrast in dark mode (`browser_emulate_media`). For a full audit use the `design:accessibility-review` skill. |
| 11 | **Session behavior** | auth/session code changed, or long forms | Idle timeout (`IdleSessionManager`); token expiry mid-form must not lose input (refresh flow); logout in tab A → tab B's next action is rejected; forced password change (`must_change_password`) traps to `/settings`. |
| 12 | **Resilience** | page does remote loads/saves, or user asks | Backend slow/down (block `/api/` with `page.route`, or add latency): clear error + retry, no blank page or infinite spinner, no lost form data; double-failure doesn't create duplicates. |
| 13 | **Regression pinning** | any confirmed bug | Add a pytest (backend, see `backend/tests/test_logout_revocation.py`) or Playwright test that fails before the fix and passes after; prove it fails first. |
| 14 | **Visual regression** | shared components (`components/tijaero/*`, theme) changed, or UI refactor under test | Screenshot key pages at 1440 and 390 wide (JPEG, `scale: css`) into `docs/qa/screens/<date>/`; compare against the previous baseline folder if present; otherwise just save as the new baseline. Look at diffs only for changed areas to save tokens. |

## Routes (under frontend/src/modules/<m>/routes.tsx)
- sales: dashboard orders quotations returns track customers coupons vouchers agent-commissions approvals(+quotation-approvals, so-approvals, return-approvals, commission-approvals)
- purchasing: suppliers orders procurement-queue top grn invoices(+outstanding-grns) returns approvals(+po-approvals, return-approvals) settlements payments payment-approvals
- finance: cashbook expenses payment-methods bank-deposits card-payments cheque-payments credit-notes advance-payments(+customer, supplier) approvals(+payment/expense/bank-transfer-verify/commission) commission-payments petty-cash payment-vouchers supplier-payments customer-payments chart-of-accounts journal-entries general-ledger accounting-periods cash-flow income-statement balance-sheet day-end-reconciliation posting-failures
- warehouse: company-assets sales-track transfer-notes item-transfer-notes itn-approvals receive-notes
- hr: employees attendance leaves leave-approvals payroll payroll-processing payroll-approvals sales-commissions promotions salary-profiles reimbursements reimbursement-approvals deductions assets
- support: tickets job-items call-logs warranty-claims
- reporting: sales finance inventory hr warehouse support branch-summary
- others: /product-catalogs (categories, brands), /branches, /users, /roles, /settings, /company-settings, /dashboard
URL = `/<module>/<route>`.

## Output
Write `docs/qa/<module>-<YYYY-MM-DD>.md`: table of Page | Status (OK/Issue) | Finding | Severity | Repro, plus a "Phases run / not run" line (smoke, field validation, security, duplicates & races, load) and an "Optional checks" line listing each of #1–14 as `run (reason)` or `skipped (trigger not met)`. Then give the user a ≤10-line summary. Fix nothing unless asked; offer to fix confirmed bugs next.

#### UI create/update flows without Playwright (built-in browser)
- Store a small helper in `localStorage` (set a `fill(map)` that sets React inputs via the native value setter + `input` event, `byLabel`, `btn(text)`, `toasts()`, `errs()`) and `eval(localStorage.qa_helper)` after every navigation; this beats clicking field by field. MUI `Select` (role=combobox DIV) opens with a synthetic `mousedown`, then click `[role=option]`; `Autocomplete` inputs need real clicks + typing (use `computer`), and their options appear only after typing. Date inputs take `YYYY-MM-DD`; phone fields accept `+94771234567` via the setter.
- Every create form is a full page (Branches, Roles, Users, Categories, Brands, Products, Suppliers, Customers, PO wizard, Quotation) that returns to the detail view; edit = `Edit` button -> change -> `Save`. Check the toast text ("... created/updated successfully") and `.Mui-error` after each Save; a failed Save also shows "Please fill in the highlighted mandatory fields".
- Approval pages ask for approver username/password in a step-up dialog; use the dev admin test account only. A PO needs a supplier mapped to the product (product page -> Suppliers tab) before the PO wizard offers it. Pick autocomplete options by name, not first row (the first row can be a real supplier).
- Cleanup: `cleanup_ui.py`-style script keyed on one QA branch code plus name prefixes (dry-run first, abort on unexpected FK dependents); remember the auto-created `good_received_locations` row blocks deleting the branch.
