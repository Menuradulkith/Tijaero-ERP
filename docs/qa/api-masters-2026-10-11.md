# API QA: Roles, Users, Branches (+Locations), Customers, Suppliers (2026-10-11)

Scope: API only (no browser). Backend `http://localhost:8020/api/v1`, admin login, throwaway `QA-` roles/users/branches. About 1,180 distinct checks were recorded (1,116 passed, 61 flagged; after triage 25 real findings, the rest were by-design behaviour or test-expectation errors).
Scripts live in the session scratchpad (`.../scratchpad/am/`), not in the repo. Nothing was fixed or deleted.

## Summary by severity

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 5 |
| Low | 19 |

## Findings

| # | Area | Endpoint | Input | Expected | Actual | Severity |
|---|---|---|---|---|---|---|
| 1 | Branches / Locations | `POST /branches/`, `POST /common/locations` | create a branch; then create 2 locations for the same `branch_code`; 6 identical locations in parallel | each branch has exactly one location (auto-created, 2nd rejected, DB-unique) | new branch gets **0** locations (only the UI is assumed to create one); a 2nd location for the same branch returns 201; 6 identical parallel creates all 201; `good_received_locations` has no unique index on `branch_code` | High |
| 2 | All 5 modules | POST/PUT/PATCH of any text field (customer name/occupation, contact person name, supplier name/city, payment-method bank_name, branch name/city, user first_name/occupation, role name, location name) | value containing a NUL char `"a\u0000b"` | 422 | **500** `A secure database error occurred` (14 endpoints). No trace leaked and nothing persisted, but it is a 5xx on user input | Medium |
| 3 | Customers, Suppliers | `PUT /customers/{id}`, `PATCH /purchasing/suppliers/{id}` | send only `home_contact_number` equal to the stored mobile (or only mobile equal to stored home) | 422 "Contact No 1 and 2 must be different" | 200, accepted. The distinct-number rule only compares the two values present in the request body, not the stored one. Create and the both-in-body update are correct (`0771234567` vs `+94771234567` is caught) | Medium |
| 4 | Locations | `POST/PUT /common/locations`, `GET /common/locations/{id}` | empty / whitespace name; name 256 and 10k chars; id 99999999999 | 422 | empty and `"   "` names created (201); long names and the over-int4 id give **500**; no length/trim constraints in `LocationCreate`; `GET` has no permission check (any logged-in user) | Medium |
| 5 | Users, Branches | `GET /users/`, `GET /users/{id}`, `PUT /users/{id}`, `PUT /branches/{id}` | user of branch B2 (`users:update`, `branches:update`) acts on a user/branch of B1; non-superuser reads superuser `admin` | scoped to own branches / 403; superuser hidden | B2 manager lists all users (13) including superuser `admin`, reads `/users/1` (email, employee id, groups, permissions), edits a B1 user (200) and edits branch B1 (200). Privilege rules (user_access.py) hold, but there is no branch scoping at all on users or branches. (`/users/paged` hides superusers; `/users/` and `/users/{id}` do not) | Medium |
| 6 | Suppliers | `PATCH /purchasing/suppliers/1127` (legacy "Apple") with its own GET body | full round-trip | 200 | 422: `company_website 'fwff'`, `home_contact_number '344'`, `mobile_contact_number '122'` fail the new validators; any UI save of this supplier is blocked until the data is fixed (all other 11 suppliers and all 61 customers round-trip OK, checked offline against the schemas) | Medium |
| 7 | Suppliers | `POST /purchasing/suppliers/{id}/products` | mapping on an **inactive** supplier | 400 like payment methods / contact persons on inactive suppliers | 201 | Low |
| 8 | Suppliers | `PATCH /purchasing/suppliers/{id}` (+ contact `full_name`, mapping `cost_price`) | explicit `null` for `company_name`, `mobile_contact_number`, `billing_address_line1`, `active`, contact `full_name`, mapping `cost_price`; `mobile_contact_number: ""` | 422 with a field message | 400 "The data could not be saved because it breaks a database rule" (7 cases). Clean, but no field name (customers/branches/users/roles return proper 422) | Low |
| 9 | Suppliers | `PATCH .../contact-persons/{id}` | `phone: ""`, `title: null`, `title: ""` | create requires both; update leniency documented | 200, contact can end up without phone/title | Low |
| 10 | Users | `POST /users/` | password `Password123!`, and `Qauserx#2026!` for username `qauserx` | policy | accepted (policy only checks length/classes, exact username equality; no common-password or contains-username rule) | Low |
| 11 | Customers / Suppliers / Users / Branches | `POST` with email | `qa@x.local`; `qa@example.test` | consistent rule | customers accept `.local` (regex); suppliers, users, branches reject special-use TLDs (`.local`, `.test`, so the brief's `@example.test` is refused: use `@example.com`) | Low |
| 12 | Customers | `GET /customers/export-csv` | export | includes new fields | no `Customer No`, bank_* (6), billing/shipping country or currency columns; formula cells ARE neutralised (`'=HYPERLINK...`) | Low |
| 13 | Customers | `DELETE /customers/{id}/contact-persons/{cid}` | 5 parallel deletes of one contact | 1x204 + 4x404 | 5x204 (idempotent, no error, no 5xx). Suppliers: 2x204 + 3x404 | Low |
| 14 | Customers | `PUT /customers/{id}` | business customer with contact persons switched to `individual` | 400 or contacts removed | 200; contact persons stay attached and `GET .../contact-persons` still lists them | Low |
| 15 | Users | `POST /users/{id}/profile-picture` | 8 parallel uploads for one user, then remove | no leftover files | 5 orphan files (no row lock, unlike supplier logo which is clean). `uploads/users/` also holds 40 files not referenced by any user (pre-existing + this run) | Low |
| 16 | Cross-cutting | `GET /api/v1/openapi.json` | | 200 | 500 `custom_openapi` reads `app.openapi_schema` on the middleware-wrapped app (`'ProxyHeadersMiddleware' object has no attribute 'openapi_schema'`); `/docs` and `/redoc` load but the schema is broken | Low |
| 17 | Cross-cutting | any authenticated JSON | headers | `X-Content-Type-Options`, `Cache-Control: no-store`, `X-Frame-Options` | none sent (CORS is correct: only `localhost:3000` origins echoed; `/uploads` static sends nosniff) | Low |
| 18 | Roles/Branches/UI | `GET /groups/` (no `limit`), UI `branchApi.getAll(1, 100)` in BranchesPage, API `GET /branches/` default `size=10`, `/users/`,`/customers/`,`/suppliers` default `limit=100` | list > 100 rows | no silent caps | UI `BranchesPage` and the roles list silently stop at 100 rows (DB has 43 branches / 31 roles now). API totals match list lengths and paging is stable (no repeats) | Low |
| 19 | Users | `PUT /users/1` round trip | admin GET body | 200 | 422 "At least one branch is required" (superuser has no branches; hidden in the UI, so cosmetic) | Low |
| 20 | Users | `PUT /users/{id}` `{password}` | users:update holder resets password of a peer with identical permissions | by design (subset rule) | 200: any users:update holder can set a peer's password without knowing the old one; no "reset requires users:reset_password" | Low |
| 21 | Roles | `GET /groups/{Admin}` | non-superuser with groups:view | by design | returns the full Admin permission catalogue | Low |
| 22 | Branches | `PUT /branches/{id}` `active=false` | branch with an active assigned user | 400 or allowed | 200 allowed; user keeps the branch and can still be edited; new assignments to the inactive branch are correctly refused (400) | Low |
| 23 | Customers | `POST .../contact-persons` | contact on an inactive customer | documented | 201 | Low |
| 24 | Cross-cutting | `POST /purchasing/suppliers/` (trailing slash) and `GET /customers` | | route-consistent | 307 redirects (efficiency; double request if the client omits the slash) | Low |
| 25 | Customers/Suppliers | list/default | `GET /customers/`, `/purchasing/suppliers` | | `Currency` check differs: customers require an **active** currency, suppliers only an existing one (all 5 currencies are active now, so no observable bug yet) | Low |

## Verified OK (recent changes and core rules)

Customers
- Structured bank fields `bank_account_name / bank_name / bank_account_no / bank_branch / bank_branch_code / bank_swift_code`: all optional at the API, persisted, clearable with blanks, length limits 255/255/50/255/30/20 enforced (422 at +1).
- `billing_country_id`, `shipping_country_id`, `country_id`: 999999 -> 400 "Unknown country"; 0, -1, 2^31, "abc", 1.5 -> 422; null clears.
- `default_currency`: `lkr`/`usd ` -> upper-cased; `XXX` -> 400 not a configured active currency; `''`, `' '`, null -> NULL; `12345`, `LK`, `LKRR`, `L1R` -> 422.
- Mobile vs home must differ after E.164 normalisation on create (`0771234567` vs `+94771234567`, spaced variants, equal values) and on update when both are sent (gap in finding 3).
- Business requires `company_name` (also whitespace) and `mobile_contact_number`; individual requires title, gender, civil_status, no_of_kids, mobile; same rules re-applied on update (null/blank title, switch to business without company -> 422).
- Contact person create requires title and phone (blank/null/letters -> 422); update does not (finding 9 is the supplier twin; customer update rejects null/blank phone). Only business customers accept contacts; first contact is primary; 8 parallel `is_primary=true` leave exactly one primary; delete promotes another; wrong-parent id -> 404 (IDOR safe); mass-assigned `customer_id` ignored.
- PUT partial body, empty body and the full GET body round-trip all 200 with identical response keys (no secret columns); all 61 existing GET bodies pass `CustomerUpdate` offline.
- Mass assignment (`is_superuser`, `created_by`, `customer_no`, `left/initial_credit_amount`, `id`, `version`) ignored on POST and PUT; credit balances follow `max_credit_limit`.
- Case/space unique checks on email, id card, passport, company reg, tax reg (sequential, 8-way parallel variants, 6-way rename race): exactly 1 winner each, 0 x 5xx; 8 identical creates: 1x201 + 7x400; 10 parallel creates -> 10 unique `customer_no`; optimistic `expected_version`: 1x200 + 3x409.
- Ranges: credit_days (-1, 3651, 1.5), limit (-1, 2^31, NaN), commission (-1, 101, NaN), birthdate (future, 1800, 2026-02-30), id/passport patterns, kids, email length: all clean 422.

Suppliers
- `billing_country_id`/`shipping_country_id`/`country_id`: 999999 -> 400, 0/-1/2^31/abc/1.5 -> 422, null clears.
- `lead_time_days`: 0, 1, 3650, "7", null accepted; -1, 3651, 1.5, "abc", 1e12, "1e12", 2^31 -> 422 (`True` is coerced to 1; harmless).
- `default_currency` validated against the currency table: `XXX`, `ZZZ` -> 400; `lkr` -> LKR; `12345`/`LK`/`L1R` -> 422.
- Address not required: name + mobile only -> 201; `billing_address_line1: ""` accepted on PATCH.
- Distinct mobile/home on create and when both sent on PATCH (gap in finding 3).
- Contact person create requires title and phone; system-wide unique email / id card / passport (case variants, 8-way race: 1 winner); wrong-parent PATCH/DELETE -> 404.
- Payment methods: type enum, per-type required fields, account number 3-34, SWIFT 8/11, LC dates/amount/currency, full PAN rejected, card expiry, `is_default` exclusivity under 7 parallel sets (exactly 1 default), wrong-parent -> 404.
- Product mapping: duplicate pair 400, unknown product 404, negative/3-decimal/1e13/NaN cost 422, MOQ 0 422, 8 identical parallel -> 1x201; second `is_preferred` for the same product auto-demotes the first (no 500).
- Logo upload: type/magic-byte check, scripted SVG refused, oversize 6 MB and 25 MB -> 400, traversal filename ignored (uuid name under `suppliers/`), 6/8 parallel uploads clean, no orphans.
- Unique company name/email/reg/tax: case/space variants 400; 8-way variants: 1x201; 6-way rename: 1x200; 10 parallel creates -> unique `supplier_no`; `expected_version` stale -> 409 (1x200 + 3x409 under race); full GET body round-trip 200, same keys.

Branches
- Create, duplicate code/name/email in case/space variants -> 400 (sequential and 8-way: exactly 1x201; 6-way rename: 1x200); unique indexes `uq_branches_*_ci` exist; `check-code/name/email` are case/space-insensitive.
- `branch_code`, `id`, `created_at` are not mass-assignable; null `branch_name`/`active` -> 422; full GET round-trip 200; legacy branch passes `BranchUpdate`; paging stable; inactive branch refused for user assignment (400).
- Address line1/city optional at the API (UI-only requirement confirmed).

Roles / Users
- Privilege rules (`user_access.py`) all held for a `users/groups/branches` manager: cannot assign Admin / Sales Manager / Branch Manager / Viewer / Finance Manager roles (403), cannot assign a foreign branch, cannot edit or unblock a superuser, cannot edit a more-privileged user, cannot change own roles/branches/active, cannot create roles with permissions it lacks (customers:delete, users:delete, all), cannot edit Admin, a bigger role or self-grant through its own role; `is_superuser` mass assignment ignored on create/update; `/users/` responses never contain `hashed_password`/`password` (create, update, get).
- Case-insensitive uniqueness of username, email, employee_id, role name (sequential, 8-way parallel variants: 1 winner; 8 identical: 1x201; 6-way rename: 1x200); `uq_accounts_user_*_ci` and `uq_auth_group_name_ci` indexes exist; no case-insensitive duplicates in the DB scan.
- Validation: username charset/length, names 30, password policy, employee id, branch/role id lists (0, -1, 2^31, unknown), primary branch must be assigned, birthdate/date_joined rules, 5000 duplicate permission ids deduped; parallel edits (fields + role + branch replacement, name + permission replacement) all 200.
- Deactivated user's existing token is rejected (401/403); role change is applied on the next request.
- Profile picture: PNG/JPEG/WEBP only (GIF, SVG, txt, HTML-as-PNG, PNG-magic-as-JPEG refused), empty and >5 MB refused, double extension / `../` / `..\` / NUL filenames stored as `users/<uuid>.png`, `/uploads/../.env` variants 404, replace and remove delete the old file.

Cross-cutting
- No token -> 401 on every list/create/update/delete/sub-resource endpoint tried (68 GET + 31 write calls x 3 actors); a user without any module permission gets 403 on all of them (only `GET /common/locations*` is open); a view-only user gets 200 on reads and 403 on every write (customers, suppliers incl. logo/payment methods/products/contacts, branches, users incl. unblock/force reset/profile picture, roles, locations). Denied writes created no rows.
- Garbage/`alg:none`/Basic tokens and `?token=` -> 401; malformed JSON, array/form/text bodies, non-UTF8, 5000-deep nesting, 12 MB body -> clean 4xx, no stack traces, SQL or paths in any error body; all `DELETE`/wrong-verb routes -> 405 (no deletes by design on customers, suppliers, users, roles, branches); path id 0/-1/abc/>int4 -> 422, unknown -> 404 (except locations, finding 4).
- All list endpoints cap `size`/`limit` with a 422 (size 201, limit 100001) and return totals equal to list lengths; `sort_by=hashed_password`/unknown falls back safely; `q=%`, `' OR 1=1 --`, long q -> clean.
- XSS/SQLi/template strings (`<img onerror>`, `' OR 1=1 --`, `{{7*7}}`, emoji/RTL) stored verbatim and returned as JSON (escaping is the UI's job; not checked in a browser).

## Phases run / not run

| Phase | Status |
|---|---|
| 1 Smoke (UI per-page) | not run (API only; a UI tester is working separately) |
| 1b Field validation and security (API) | run for all five modules, incl. AuthZ matrix, IDOR, mass assignment, injection strings, uploads, error leakage, headers/CORS |
| 2 Duplicates and races (API) | run: identical, case-variant, rename and parallel-edit bursts per create endpoint; double-submit UI buttons not run |
| 3 Load | not run (not requested) |
| Backend pytest for confirmed cases | not added (no code changes requested) |

Optional checks: #1 skipped (no status workflow in these modules); #2/#3/#4/#6 skipped (no money/stock flow); #5 partially (privilege matrix via user_access.py cases); #7 run (API paging/sort/filter totals); #8 run partially (branch/supplier/customer deactivation on QA data; alembic up/down not run); #9, #10, #12, #13, #14 skipped; #11 partial (deactivated-user token, role change). Not covered: coupons/vouchers/credit/settlement endpoints of customers, supplier PO/payment/advance endpoints (only their permission gates), UI behaviour, a user from another branch against sales/purchasing documents.

Limits: login is cached per script; some 403 results on supplier sub-resources (`/orders`, `/payments`, `/statement`, `/advance-balance`, `/aging-report`) and `/users/check-*` for a view-only user are by design (they need other permissions, `users:create`).

## QA- records created (all via API as admin, nothing deleted)

Prefix is `QA-`/`qa-` except where the test payload itself was a name (marked *). Another tester also created `QA-` rows (customers 10006/10007, suppliers 15481-15487, branches 23651-23663/23712-23717, users 31247-31254, locations 9289/9290/9305/9306): not listed as mine.

- Branches (23): ids 23649-23650 (QA-B1, QA-B2), 23664-23674, 23682, 23690, 23698, 23706-23711, 23718; codes `QA-B1/B2`, `QA-C2*`, `QA-C3*`, `QA-C4L` (one has code `QA/C 2`). All active except none deactivated. Names/codes of the XSS/SQLi test rows are `QA-Br3 ...`.
- Locations (12) on branch `QA-C31`: ids 9291-9292, 9294-9295 (empty / whitespace names), 9297-9304 (includes `<script>` name).
- Roles (18): ids 3565-3567 (`QA-Role-None/View/Mgr`), 3568-3574, 3582, 3590-3596; * `<img src=x onerror=alert(1)>` (3572), `qa-role2 rv` (3582), plus `QA-Role-esc4`.
- Users (32): ids 31243-31246 (`qa-none`, `qa-viewer`, `qa-mgr-b1`, `qa-mgr-b2`, password known to the brief only), 31255-31266, 31274, 31282, 31290, 31297-31309 (`qa-u2*`, `qa-u3*`, `qa-u4-life*`, `qauserx`, `qa-azx` was refused). Throwaway "victim" user was deactivated then reactivated.
- Customers (56): ids 10008-10036, 10041, 10049, 10057, 10065, 10073, 10080-10101; * 10020 `<img src=x onerror=alert(1)>`, 10021 `' OR 1=1 --`, 10022 `{{7*7}}`, 10099 `=HYPERLINK(...)`, 10017 `QANNN...` (255 chars). Includes business customers with contact persons (`QA-Contact*`, `QA-AZ`, `QA-CL`).
- Suppliers (70): ids 15488-15489, 15493-15505, 15509-15534, 15542-15543, 15550, 15555, 15563, 15570-15588, 15592-15596; * 15521 `<img ...>`, 15522 `' OR 1=1 --`, 15523 `{{7*7}}`, 15526 `qa-supp uq`. Sub-records: contact persons (`QA-SContact*`, `QA-AZs`), payment methods (cash/cheque/bank/LC/card/wallet), product mappings to product 4863 (Apple mackbook) and 2189 (fffef) on QA suppliers only (15504-15505 and `QA-Supp5 pref*`), logo files.
- Files: `backend/uploads/users/*.png` (about 45 files, 5 orphaned by finding 15) and `backend/uploads/suppliers/*` (logo test files).
- Audit log rows for all of the above.

Cleanup note: no delete endpoints by design, so users/roles/branches/locations need a guarded DB script (dependents: `good_received_locations` row per QA branch, user-role/branch links, supplier contact/payment/product rows, customer contact rows).
