# Races & duplicate creation – Branches, Users, Roles (2026-10-09)

Follow-up to the module audits. Scope: concurrent creates, concurrent renames, parallel edits of one record, and UI double-submit. Local dev, 4–10 parallel requests per burst, every request's status recorded (a dropped connection counts as a failure).

## Before this pass (state after the earlier fixes)
| Gap | Detail |
|---|---|
| No DB backstop for Branches / Users | Case/space-insensitive checks lived only in the service, so two simultaneous requests could both pass the check. The dev database still held case-variant QA rows, which blocked adding unique indexes. |
| Never re-run after the fixes | The parallel bursts had only been run *before* the fixes. |
| Never tested | Concurrent updates, parallel edits of one record, UI double-submit on Branches/Users. |

## What was done
1. **Cleanup.** Removed all QA test rows (44 users + 44 employee records + 44 welcome notifications, 23 branches + 2 test locations, 3 junk permission rows, QA roles) with a guarded DB script: only rows matching my test data, abort if *anything* outside the system-created children (memberships, employee record, notifications, locations) references them. Left: `admin`, branch `123`, 13 seed roles.
2. **Database indexes** (migration `s84_users_branches_unique_ci`, chained after your `s83_customer_bank_account`; roles/permissions indexes were `s82`): unique on `lower(btrim(...))` for `accounts_user.username/email/employee_id`, `employees.employee_id`, `branches.branch_name/branch_code/email` (blank/NULL emails excluded). The upgrade stops with the list of clashing values if existing data collides. DB-level tests prove each variant is rejected.
3. **Live re-verification** of everything below, then fixes for what it found.

## Results (live, after fixes)
| Scenario | Branches | Users | Roles |
|---|---|---|---|
| 10 parallel identical creates | 1×201, 9×400 | 1×201, 9×400 | 1×201, 9×400 |
| 8 parallel case/space variants of the **name / username** | 1×201, 7×400 | 1×201, 7×400 | 1×201, 7×400 |
| …of the **code / employee ID** | 1×201, 7×400 | 1×201, 7×400 | – |
| …of the **email** | 1×201, 7×400 | 1×201, 7×400 | – |
| 4–6 records renamed onto the **same name** at once | 1×200, 5×400 | 1×200, 5×400 | 1×200, 5×400 |
| …same, for the **email** | 1×200, 5×400 | 1×200, 5×400 | – |
| 8 parallel edits of **one** record (different fields) | 8×200 | 8×200 | 6×200 |
| Parallel **role/branch reassignment** of one user, 3 rounds × 8 | – | 24×200 | – |
| Mixed password + role + field edits on one user, 3 rounds × 6 | – | 18×200 | – |
| Different permission sets on one role, 3 rounds × 8 | – | – | 24×200, no duplicate rows |
| 5xx or dropped connections | none | none | none |
| Case-insensitive duplicate groups left in the data | 0 | 0 | 0 |
| **UI double-click Save** (create) | 1 POST, 1 toast, 1 row | 1 POST, 1 toast, 1 row | 1 POST, 1 toast, 1 row |
| **UI triple-click Save** (edit) | 1 PUT, 1 toast | – | – |

Earlier, before the fixes, the same variant bursts produced 2 successes (Users, Roles) and duplicates.

## Defects found by the re-verification (all fixed)
| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | **High** | **Concurrent renames onto a taken name returned 500** (3 of 4 requests) on Branches, Users and Roles once the DB indexes existed. Root cause: `log_audit()` flushes the caller's pending UPDATE inside a blanket `try/except Exception`, so the unique violation was swallowed as an "audit log failure" and left the session in a failed state; the later `commit()` then raised a 500. This also hid the true error for *every* module that calls `log_audit`. | `log_audit` now flushes the caller's own changes *before* its try block so their errors reach the caller, and the three update paths (`BranchRepository.update`, `AuthService.update_user`, `GroupService.update_group`) turn any `IntegrityError` into a clean `400`. 4 regression tests simulate the losing request (pre-check bypassed so only the DB decides). |
| 2 | **High** | **Parallel role/branch reassignment of the same user returned 500** (2 of 6 requests; final data stayed consistent). Replacing the roles/branches collections deletes and re-inserts association rows, and two requests doing that at once collided. | Updates of one user (and one role's permissions) are serialized with a row lock (`SELECT … FOR UPDATE` + `populate_existing`). 0 failures over 24 + 18 + 24 concurrent requests afterwards. |
| 3 | Medium | **Branches page: double-click Save created the branch, then showed "Branch code already exists"** (two POSTs). `isSaving` only turned on once the mutation started, but `handleSave` first awaits three duplicate-check requests; both clicks passed those checks before either had created anything. Users already had a guard; Roles was fixed earlier. | A ref-based in-flight guard covers the whole save (checks + mutation); the mutations are awaited inside it. |

## Not covered / notes
- **Lost updates** (two admins saving the same field at once): last write wins, there is no version check or `409`. That is how every page here behaves today; adding optimistic locking (an `updated_at`/version in the request) is a design decision.
- Parallel **logins**, **password changes** from the Settings page, passcode set/lockout, and the sequential **display numbers** (customers/suppliers) were not tested here — they belong with the Sales/Purchasing passes.
- Load/soak testing was not done (needs a staging DB).
- A one-off `ECONNRESET` appeared once during a burst of bcrypt-heavy user creations (single dev worker); it did not reproduce when the matrix was re-run in smaller scripts, and no request returned a 5xx.
- The audit log rows for the removed QA records remain (they are plain integers, not foreign keys).
- Migration numbering: another `s83_customer_bank_account` (yours) appeared at the same time as mine; mine was renumbered to `s84` so there is a single head. Both are applied to the dev database.
