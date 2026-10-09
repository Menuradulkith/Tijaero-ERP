# Users page re-check — 2026-10-09

Follow-up to `users-2026-10-08.md` (all of that pass's findings were fixed). Method: API audit script (async client, bursts of 6 because user creation is bcrypt-heavy) + built-in browser smoke. Playwright MCP unavailable.

## Result: no regressions, 4 small findings

| # | Area | Finding | Severity |
|---|---|---|---|
| 1 | Validation | Username accepts markup and any Unicode: `<img>` and `ユーザー…` were created (only whitespace and `/ \` are refused). It renders escaped in the grid, but it ends up in logs, audit rows, emails and exports; the login name is better limited to letters, digits and `. _ - @` | Medium |
| 2 | List | `GET /users/` has no `ORDER BY` (the ids came back sorted by luck of the physical order); the grid sorts client-side, so a skip/limit window can repeat or miss users | Low |
| 3 | List | The page loads every user (`limit=100000`) and filters/pages in the browser. Fine today, but it is the same pattern that was replaced with server paging on Products and Suppliers | Low |
| 4 | UI | `handleSave` has no in-flight ref guard (only `setSaving`, which re-renders after the first click). A real double-click is blocked by the disabled button, but two synchronous clicks, or Enter + click, can still send two creates; the unique indexes would reject the second with an "already exists" toast | Low |

## Verified OK (re-tested)
- 401 without a token on every route (including POST); no `hashed_password` or `password` in list / get / me / create responses.
- Create validation, all 422/400 with no 5xx: blank/over-long/space/slash usernames, names 31 chars or blank, bad / 255-char / reserved-domain emails, bad or 31-char phones, short / weak / username-containing / 129-char passwords, bad employee id, future / pre-1900 / invalid birthdates, joined-before-birth, empty or 2^40 or unknown branch/group ids, primary branch not assigned.
- Mass assignment (`is_superuser`, `verify`, `blocked`, `hashed_password`, `id`) ignored on create **and** on update (values unchanged afterwards).
- Update: nulls on required fields, blank names, bad email, weak or 129-char password, empty branches/groups all rejected; empty password = unchanged; empty body = 200.
- Duplicates and races: sequential case/space variants of username, email and employee id → 400; bursts of 6 identical, username-variant, email-variant and employee-id-variant creates → exactly 1×201 each; 5 parallel renames and 6 parallel edits of one user → all 200; no case-insensitive duplicate usernames afterwards.
- Actions: unblock, force-password-reset (twice), unknown id (422) clean. Profile picture: text-as-PNG, SVG and 8 MB rejected (400); `../../x.png` stored under a generated name.
- Path/query bounds: `limit=0`, `limit=1e9`, ids `0`, `abc`, `2^31` → 422 (`skip=2^40` returns an empty list).
- UI: `/users` renders the grid (9 rows in the test state, footer "1–9 of 9"), `<img>` username shown as text, Add User button present, no horizontal overflow.

## Phases run / not run
Smoke (partial) · 1b validation & security (API) · 2 races (API). Not run: UI create/edit forms end to end (branch/role pickers), low-privilege-user matrix (covered by `test_users_security.py` in the previous pass), load.
Optional checks: 5/8/11 partly covered earlier; the rest skipped.

## Cleanup
9 QA users (all deactivated, `QA-` employee ids) and their 9 auto-created employee rows, group/branch links and notifications were removed with a guarded DB script (dry-run first; nothing else referenced them). Only the `admin` account remains. Users have no delete endpoint by design.

## Fix log (2026-10-09)
Verified by 24 backend tests (`backend/tests/test_users_paging.py`; the existing `test_users_security.py` still passes), and live in the browser.

- **#1 username:** only letters, digits and `. _ - @` (1–50 chars) on create **and** update (`<img>`, Unicode, quotes, `;`, `%`, `:`, emoji → 422). Existing users with other characters still load and log in (response schemas stay lenient).
- **#2 order:** `GET /users/` is ordered by lower(username), id.
- **#3 paging:** new `GET /users/paged` (page/size ≤ 200, literal search over username / names / email / employee id, status, branch, role, whitelisted sort, superusers excluded). The page loads only the visible page (search debounced 300 ms, any filter or sort change returns to page 1) and Export writes **every** matching row. Role / Branch columns are not sortable (they are lists). Verified: "1–12 of 12", search "qa-pg0" → "1–10 of 10", `%` → 0, descending sort, CSV 13 lines.
- **#4 save guard:** in-flight ref in `handleSave`; verified a double-click sends one `PUT` (plus the refresh `GET`) and one success toast.
- `loadData` no longer loads all users; after a save it invalidates the grid query and re-reads only the open user.

## Heads-up (not part of this fix)
The uncommitted `Supplier.billing_country_id` / `shipping_country_id` model change (migration `s86_supplier_address_countries`) is not applied to the dev database: every supplier insert now fails with `UndefinedColumn` (≈140 tests across purchasing/sales workflows, and supplier endpoints on the running server). It also made the SQLAlchemy mappers fail ("multiple foreign key paths" on `Country.suppliers`); I pinned `foreign_keys` on `Supplier.country` / `Country.suppliers` so the models load. Run `alembic upgrade head` when ready.
