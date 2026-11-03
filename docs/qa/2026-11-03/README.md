# Full ERP QA audit: create / edit / delete flows (2026-11-03)

Seven parallel auditors exercised every POST/PUT/PATCH/DELETE endpoint (~420 of 618 routes) against the live dev backend (:8020) with real HTTP calls, and reviewed each module's frontend pages in code. Every auditor covered: happy path, field validation, state machine, referential integrity, authZ (`qa-none` + branch IDOR) and double-submit. One High finding per module was re-checked by hand (all confirmed).

| Module group | Critical | High | Medium | Low | Total | Detail |
|---|---|---|---|---|---|---|
| Sales + Customers | 2 | 7 | 12 (+8 FE) | 12 | 41 | [report](report-sales-customers.md) |
| Purchasing + Inventory | 0 | 6 | 21 | 26 | 53 | [report](report-purchasing-inventory.md) |
| Finance | 0 | 8 | 17 | 15 | 40 | [report](report-finance.md) |
| Warehouse + Manufacturing | 0 | 6 | 13 | 12 | 31 | [report](report-warehouse-manufacturing.md) |
| HR + Employees + Attendance | 0 | 5 | 15 | 8 | 28 | [report](report-hr.md) |
| Admin (Auth, Users, Roles, Branches, Settings) | 0 | 1 | 14 | 17 | 32 | [report](report-admin.md) |
| Support, Reporting, Common, Notifications, Chat | 0 | 4 | 10 | 13 | 27 | [report](report-misc.md) |
| **Total** | **2** | **37** | **~110** | **~103** | **~252** | |

## What works well
- `qa-none` got 403 on every mutation in every module (several hundred endpoints).
- Core validation is solid: negative/zero amounts, bad FKs, overlong text, duplicates, unbalanced journals all return clean 4xx.
- Main state machines hold: no edit/delete after approve/post, no double approve/post/convert, concurrency races give exactly one success (orders, payroll, production, settlements).
- Payroll maths (EPF/ETF/APIT/gratuity), manufacturing WIP/variance GL and trial balance verified correct.
- Print-template sandbox, upload checks, Report Center scoping and fuzzing all held.

## Critical and High (fix first)

### Money / GL integrity
| ID | Problem |
|---|---|
| SAL-01 **Critical** | Editing a pending credit order leaves `credit_amount` stale; revenue/AR journal silently never posts. |
| SAL-03 **Critical** | Bank-transfer order paying 50 of 100 accepted; verify marks it fully paid, no revenue. |
| SAL-02 | Editing a credit order bypasses the credit limit. |
| SAL-04 | Quote → order conversion skips payment, credit-limit and GL checks. |
| SAL-06 | Multi-transaction credit settlement not atomic (400 returned, payment still recorded). |
| SAL-08 | Commission status settable to `paid`/`approved` via PUT. |
| PUR-04 | Purchase invoice PATCH skips create checks (total 400 → 1). |
| PUR-05 | Pending supplier payment amount editable (50 → 5000); verify posts it. |
| PUR-06 | Returned goods can still be invoiced. |
| PUR-03 | Legacy `/grn-items` and `/inventory/sales-stock` create stock on cancelled GRNs with no GL. |
| FIN-02 / 03 / 04 | Journals post into years with no period, can be re-dated at post, and overlapping fiscal years bypass a closed period. |
| FIN-05 | Expense edit moves date into future; payment posts GL there. |
| FIN-06 | Manual reverse accepts source-document (Auto) journals; sub-ledgers drift. |
| FIN-08 | Bank account can be bound to Trade Debtors control account. |
| HR-01 | Payroll run duplicates an existing manual payroll record. |
| HR-05 | No-pay leave approved after payroll run never deducted. |
| WH-01 / WH-02 | ITN line can be marked received without moving stock; stock stuck `in_transit`. |

### Branch scope / IDOR (same pattern in every module)
| ID | Problem |
|---|---|
| PUR-01 / 02 | GRN against another branch's PO; GRN branch/location not tied to PO. |
| SAL-07 | Sale return + refund on another branch's invoice. |
| FIN-07 | Recurring journals / opening balances for another branch. |
| HR-02 / 03 | Leave allocation and lieu leave for other-branch employees. |
| WH-03 | Receiving branch can approve and dispatch the sender's ITN. |
| MFG-01 | Work centers fully editable across branches. |
| SUP-01 | Support tickets have no branch scoping. |
| RPT-01 | Legacy reporting, dashboard, branch-summary show company-wide figures. |
| MSC-01 / 02 | `qa-none` reads all reference data (incl. cost prices) and the full audit trail. |

### Broken flows / crashes
| ID | Problem |
|---|---|
| FIN-01 | Manual journal entries can never be posted from the UI (no submit/approve calls). |
| SAL-05 | Approver username/password entered in UI are ignored by the backend. |
| ADM-02 | Users with `.test`-style emails get 500 on GET/PUT `/users/{id}` and `/users/me` (PUT still commits). |
| HR-04 | Creating an employee wipes the linked user's birthdate and gender. |
| WH-04 | Receive note > 355 chars → 500. |
| FE-01 (WH/PUR) | 403 on save is silent in manufacturing/purchasing (interceptor + `useCrudMutation`). |

## Cross-cutting themes (one fix covers many findings)
1. **Branch check uses the payload branch, not the record's branch.** Seen in GRN, returns, payments, vouchers, commissions, ITN, work centers, leave. A shared "load record → `validate_branch_access(record.branch_code)`" helper would close most IDORs.
2. **Update paths skip create-time validation.** Invoices, payments, coupons, quotes, POs, expenses, loans, employees. Run the same validator on PATCH/PUT.
3. **Client-controlled server fields.** `item_recieved`, commission `status`, `require_approval`, `posting_date`. Remove from input schemas.
4. **Unparsed date query params → 500.** Support, finance GL/JE/TB, customer payments report, chat `limit`. Use typed `date` query params.
5. **Delete with children → "A required value is missing."** Tickets, ITNs, payments, locations. Map FK violations to a clear 400 or block up front.
6. **Frontend 403s are silent**, and many action buttons are not permission-gated.
7. **No maker-checker** on expense approval, deposit verify, JE correction, cash-flow approval.

## Audit side effects on the dev DB
- Test data is prefixed `QAAUDIT-1103` / `qaaudit1103_`; most could not be deleted (no DELETE endpoints) and were deactivated/cancelled instead. Leftovers are listed in each report.
- Finance: 5 other QA expense JEs were reversed by mistake and counter-reversed (GL net zero, status shows "reversed"); sandbox fiscal years 2098/2099 created and period 2099-P3 locked; cash-flow statement CFS-2026-11 deleted in the DB.
- Purchasing: QA-BR-A has used its 5-POs-per-day limit for 2026-11-03.
- Admin cleanup briefly deactivated other auditors' `qaaudit1103_*` users (all reactivated).
- `qa`-users, `admin`, company settings, real periods, posting rules and VAT settings unchanged.

## Fix status (same day)

All seven groups were fixed in parallel (one owner per module, no migrations, no commits). Each group added a regression file `backend/tests/test_qa_audit_fixes_2026_11_03_<group>.py` (~190 new tests).

| Group | Fixed | Deferred (needs decision / migration) |
|---|---|---|
| Sales + Customers | all Critical/High, rest except deferred; PUR-18 COGS now uses PO price + landed cost | SAL-16 number reuse after hard delete, SAL-23 duplicate bank-transfer reference (needs column), SAL-30 delete dead `debtors_*` code, SAL-15 block edits while pending approval (needs draft state) |
| Purchasing + Inventory | all High/Medium, all FE items | PUR-11 reverse a verified supplier payment, supplier statement branch filter, INV-06 Sales Manager sees cost price |
| Finance | 31 + 2 partial; JEs can now be submitted/approved/posted from the UI | FIN-20 credit-note approval/void, FIN-23 unapprove cash-flow, FIN-26 supplier-funded assets, FIN-27 depreciation catch-up, FIN-29 normal balance vs type; maker-checker exempts superusers (strict option possible) |
| Warehouse + Manufacturing | 24 + MFG-02 partial; new ITN cancel | MFG-02 over-issue cap, MFG-04 cost revaluation, WH-13 optional dispatch step |
| HR | 24 | HR-15 payroll reversal, HR-26 rounding/no-pay day policy |
| Admin | 30 + ADM-08 small (blocked users refused) | ADM-12 delete users/roles/branches, full lockout policy |
| Support/Reporting/Common | all High/Medium; shared 403 toast, location scoping, clear FK-on-delete message | SUP-04 ticket status (needs migration), SUP-06 stub pages, RPT-02 print token, RPT-05 fallback banner, RPT-06 PDF speed |

Verification:
- Full backend suite: 2410 passed, 8 failed → 7 fixed (outdated expectations / audit data), 1 remaining: `test_report_center_phase3::test_gl_detail_closing_matches_the_trial_balance` fails only because the audit left 2099-dated verified supplier payments in the dev DB (account 1010 −20.00); no code issue.
- `npx tsc --noEmit`: clean.
- Restarted backend: MSC-01, MSC-02, SUP-02, ADM-02, FIN-21, CHAT-01, SAL-17, RPT-01, WH-01 repros all return the expected status.
- Browser: Journal Entries draft → Submit for Approval → Submitted, Approve disabled for the creator.

Behaviour changes worth knowing:
- Users with a pending forced password reset can only change their password until they do (`qa-u21` is in that state).
- Quote → order conversion now enforces the normal payment/credit rules.
- Purchase returns go through approval for users without approve rights; pending supplier payments no longer lower the statement balance.
- Overtime is now net of the shift break; off-day work counts as overtime.
- Removed unused unsafe routes: PATCH `/warehouse/transfer-note-items/{id}/receive`, POST/PUT `/warehouse/receive-notes`.
