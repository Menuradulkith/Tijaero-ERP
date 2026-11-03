# QA audit: Auth, Users, Roles, Permissions, Branches, Settings (2026-11-03)

Counts: 1 High, 14 Medium, 17 Low (32). Scripts: scratchpad/qa/admin/.
Incident: the cleanup briefly deactivated other auditors' qaaudit1103_a/_b (~30 s) and _u1.._u8 (~2.5 min) at 18:01–18:04; all were reactivated. 403s in that window are not real findings.

## High
- **ADM-02** auth/schemas.py:92 — `UserBase.email: EmailStr` reused in response model; users with e.g. `.test` emails (10 of 62) get 500 on GET /users/{id}, GET /users/me, PUT /users/{id} (PUT still commits).

## Medium
- **ADM-01** auth/service.py:330 — PUT /users/{id} with password containing username (no username in body) → 500 (uncaught ValueError).
- **ADM-03** branches/api.py:58-65 — GET /branches/{id}/performance has no branch-access check (IDOR).
- **ADM-04** settings/api.py:24-114 — profile/preferences/notifications/change-password use get_current_user; deactivated user's token still works.
- **ADM-05** auth/user_access.py:60-61 — user with users:update changes own password via PUT /users/{self} without current password.
- **ADM-06** auth/api.py:104-109, dependencies.py:75, api.py:137 — must_change_password enforced only in frontend; passcode login skips it.
- **ADM-07** passcode_service.py:281-294, auth/api.py:66,107 — password login doesn't clear passcode lockout; response lacks passcode_locked_out.
- **ADM-08** no account lockout: `blocked` never set, not checked on tokens, Unblock dead code; only in-memory per-IP 20/min.
- **ADM-09** passcode_service.py:213-234 — passcode login returns 3 distinct errors (user enumeration).
- **ADM-10** frontend App.tsx:188-192 — /settings route needs settings:view, so ordinary users can't change own password/profile.
- **ADM-11** auth/user_access.py:153-161 — branch-scoped role manager can edit shared roles, changing permissions of users in other branches.
- **FE-01** CompanySettingsPage.tsx — no settings:update check; save/currency controls shown to view-only users.
- **FE-02** CompanySettingsPage.tsx:478 — currency delete has no confirm.
- **FE-03** GroupsPage.tsx:383-394, 556-566 — ignores groups:create/update.
- **FE-04** UsersPage.tsx:847-858 — Employee ID editable but ignored by backend, UI says success.
- **FE-05** NotificationsSettings.tsx:19-21 — Save is fake (toast only).

## Low
- ADM-12 no DELETE for users/roles/branches (405) though delete permissions exist.
- ADM-13 branches/repository.py:81-112 — deactivate branch with no checks (users' only branch, own branch); branch_code in PUT silently ignored.
- ADM-14 change-password accepts same password / password containing username.
- ADM-15 passcode can be re-set to current value.
- ADM-16 users can change own date_joined via /settings/profile.
- ADM-17 branch list has no ORDER BY.
- ADM-18 settings changes not audited; currency hard delete without reference check; POST currencies → 200 not 201.
- ADM-19 (code review) last-superuser guard race.
- FE-06 client password special-char set narrower than backend.
- FE-07 LoginPage.tsx:195-200 lockout banners never show.
- FE-08 Profile/Preferences errors swallowed.
- FE-09 gender codes m/f/other vs m/f/u.
- FE-10 force reset / unblock / remove avatar without confirm.
- FE-11 avatar picker allows SVG, backend rejects.
- FE-12 roles/branches load failures hidden.
- FE-13 stale role view after update; company save doesn't invalidate cache.

## Verified OK
No hashed_password leak; mass assignment of is_superuser/blocked ignored; no self role/branch change or self-deactivation; superuser targets protected; Admin role / un-held permission grants 403; logout revocation; password change invalidates tokens; qa-none 403 on 22 endpoints; create races clean 400.

## Leftovers
Deactivated users qaaudit1103_mgr/_t1/_t2/_big/_ma/_su/_race; emptied roles 8290-8292; deactivated branches 91397, 91398, 91403. admin, QA users and company settings unchanged.
