# QA audit: HR + Employees + Attendance (2026-11-03)

Counts: 5 High, 15 Medium, 8 Low (28). Scripts/log: scratchpad/qa/hr/. Payroll maths (EPF/ETF/APIT/gratuity) checked by hand: correct.

## High
- **HR-01** hr/service.py:753-830 — payroll run creates a second record for an employee who already has a manual payroll record that month.
- **HR-02** hr_core/service.py:550, :567 — leave allocation create/update IDOR across branches.
- **HR-03** hr_core/service.py:738 — lieu leave grant IDOR across branches.
- **HR-04** hr_core/service.py:1043 — employee create (model_dump without exclude_unset) wipes linked user's birthdate and gender; blocks maternity leave, retirement date.
- **HR-05** attendance/service.py:363, :453 — no-pay leave created/approved after payroll run never deducted; cancel then wrongly says already deducted.

## Medium
- HR-06 hr/api.py get_payroll_batch / get_statutory_return — branch user sees other branches' salary, NIC, bank account in batch and returns.
- HR-07 attendance/schemas.py:2,170,182 — `date` field shadows type; check-in/out with date → 422.
- HR-08 attendance/service.py:145 — overtime ignores shift break; off-day work not overtime.
- HR-09 attendance/repository.py:65 — cannot clear check_out.
- HR-10 attendance/service.py:249, hr/service.py:1320 — attendance and retro salary still editable after payroll run.
- HR-11 hr_core/service.py:1114-1115 — notice_period never becomes left; leave allowed after last working day.
- HR-12 attendance/service.py:537 — deleting pending leave orphans its approval.
- HR-13 hr_core/schemas.py:614 — partial employee update skips cross-field date rules.
- HR-14 hr/inputs.py:336, hr/loans.py:182 — loan update skips issue-time rules.
- HR-15 hr/service.py:1202 — paid/completed payroll cannot be reversed.
- HR-16 HRSetupPage.tsx:126, MasterTab.tsx:241, api.ts:5-19 — "No weekly off" shift → 422.
- HR-17 (code review) payroll/reimbursement workflow buttons not permission-gated.
- HR-18 (code review) DeductionsPage.tsx:57-62 — edit wipes component amounts.
- HR-19 (code review) stale balances/records after leave and payroll actions.
- HR-20 (code review) UI offers Edit/Delete on locked records; check-in/out ignore entered date/time.

## Low
- HR-21 designation moved to another department while in use.
- HR-22 allocation for resigned employee; negative adjustment total.
- HR-23 salary profile editable after leaving.
- HR-24 5 parallel identical loan POSTs all 201 with GL postings.
- HR-25 leave edit no date-range check.
- HR-26 (code review) HALF_EVEN vs HALF_UP rounding; no-pay rate by calendar days.
- HR-27 (code review) upload read fully before 5 MB check; file_path exposed.
- HR-28 (code review) missing confirms / client upload checks; cleared numbers sent as 0; UTC date default.

## Verified OK
qa-none 403 on 160 operations; qa-hr-d1 403 on other-branch employee records; duplicate ID/NIC/EPF, NIC format, bounds; no 500 anywhere; upload checks; leave overlap/balance/approve-twice/concurrency; payroll workflow order and duplicate period; leaver blocks.

## Leftovers
Employees QAAUDIT1103-E1..E8 (13841-13848, separated), users qaaudit1103_u1..8, batch PAY-2026-10-001 (797) + journal 31960, loans 246-252, leaves 1459/1460, salary profiles 1093-1098, allocations, deactivated masters, deduction 227, approval 31926.
