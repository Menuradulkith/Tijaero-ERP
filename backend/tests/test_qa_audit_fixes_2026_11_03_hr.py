"""HR / Employees / Attendance fixes from the QA audit of 2026-11-03 (docs/qa/2026-11-03/report-hr.md, HR-01..28)."""
from datetime import date, datetime, timedelta
from decimal import Decimal as D

import pytest

HR = "/api/v1/hr"
EMP = "/api/v1/employees"
TODAY = date.today()
FIRST = TODAY.replace(day=1)
PERIOD = {"payroll_month": TODAY.month, "payroll_year": TODAY.year}
NEXT_MONTH = (FIRST + timedelta(days=32)).replace(day=1)
HR_PERMS = [(r, a) for r in ("hr_dashboard", "payroll", "salary_profiles", "leave_allocations", "leaves", "attendance", "employees")
            for a in ("view", "create", "update", "delete")]


def _profile(c, e, basic=100000, **kw):
    r = c.post(f"{HR}/salary-profiles", json={"employee_id": e.employee_id, "basic_salary": basic, "allowances": [], **kw})
    assert r.status_code == 201, r.text
    return r.json()


def _run(c):
    r = c.post(f"{HR}/payroll/run", json=PERIOD)
    assert r.status_code == 201, r.text
    return r.json()


def _working_day(c, e, leave_type="unpaid", start=FIRST):
    """First day from `start` that costs a leave day for this employee (not a weekly off or holiday)."""
    d = start
    while True:
        days = c.get(f"{HR}/leave-days", params={"employee_id": e.employee_id, "leave_type": leave_type,
                                                 "from_date": d.isoformat(), "to_date": d.isoformat()}).json()["days"]
        if days:
            return d
        d += timedelta(days=1)


@pytest.fixture
def two(db, make_branch, make_employee):
    mine, other = make_branch(), make_branch()
    a, b = make_employee(), make_employee()
    a.branch_code, b.branch_code = mine.branch_code, other.branch_code
    a.bank_account_no = b.bank_account_no = "000111222"
    db.flush()
    return mine, other, a, b


@pytest.fixture
def limited(make_user, api, superuser, two):
    """Switch the shared client to a user limited to the first branch."""
    _, tok = make_user(permissions=HR_PERMS, branches=[two[0]])
    yield lambda: api(tok)
    api(superuser[1])


# ───────────────────────────── payroll ─────────────────────────────
class TestPayrollRun:
    def test_run_skips_an_employee_who_already_has_a_manual_record(self, superclient, make_employee):  # HR-01
        a, b = make_employee(), make_employee()
        _profile(superclient, a)
        _profile(superclient, b)
        manual = superclient.post(f"{HR}/payroll", json={"employee_id": a.employee_id, "basic_salary": 5000, **PERIOD})
        assert manual.status_code == 201, manual.text
        batch = _run(superclient)
        codes = [r["employee_id"] for r in batch["payroll_records"]]
        assert a.employee_id not in codes and b.employee_id in codes
        assert a.employee_id in batch["description"]
        # one record each for the month, never two
        mine = [p for p in superclient.get(f"{HR}/payroll", params={"employee_id": a.employee_id}).json()
                if p["payroll_month"] == TODAY.month and p["payroll_year"] == TODAY.year]
        assert len(mine) == 1 and mine[0]["payroll_batch_no"] is None

    def test_batch_detail_and_returns_only_show_own_branch(self, superclient, two, limited):  # HR-06
        mine, other, a, b = two
        _profile(superclient, a)
        _profile(superclient, b)
        batch = _run(superclient)
        c = limited()
        detail = c.get(f"{HR}/payroll/batches/{batch['id']}")
        assert detail.status_code == 200, detail.text
        codes = {r["employee_id"] for r in detail.json()["payroll_records"]}
        assert a.employee_id in codes and b.employee_id not in codes
        for kind in ("bank", "apit"):
            rows = c.get(f"{HR}/payroll/batches/{batch['id']}/returns/{kind}").json()["rows"]
            ids = {r["employee_id"] for r in rows}
            assert a.employee_id in ids and b.employee_id not in ids, kind
        assert b.employee_id not in c.get(f"{HR}/payroll/batches/{batch['id']}/returns/bank/csv").text

    def test_retro_salary_change_into_a_run_month_is_refused(self, superclient, make_employee):  # HR-10
        e = make_employee()
        p = _profile(superclient, e, 100000, effective_from_date=FIRST.isoformat())
        _run(superclient)
        body = {"employee_id": e.employee_id, "basic_salary": 150000, "allowances": [], "revision_reason": "increment"}
        r = superclient.put(f"{HR}/salary-profiles/{p['id']}", json={**body, "effective_from_date": FIRST.isoformat()})
        assert r.status_code == 400 and "already been run" in r.json()["detail"]
        r = superclient.put(f"{HR}/salary-profiles/{p['id']}", json={**body, "effective_from_date": NEXT_MONTH.isoformat()})
        assert r.status_code == 200, r.text
        # a change that leaves the pay alone is still fine
        r = superclient.put(f"{HR}/salary-profiles/{p['id']}", json={**body, "effective_from_date": NEXT_MONTH.isoformat(), "designation": "Lead"})
        assert r.status_code == 200, r.text

    def test_salary_profile_of_a_leaver_is_read_only(self, superclient, make_employee, db):  # HR-23
        e = make_employee()
        p = _profile(superclient, e)
        e.status, e.last_working_date = "resigned", TODAY - timedelta(days=3)
        db.flush()
        r = superclient.put(f"{HR}/salary-profiles/{p['id']}", json={"employee_id": e.employee_id, "basic_salary": 1})
        assert r.status_code == 400


class TestLoans:
    def _loan(self, c, e, **kw):
        return c.post(f"{HR}/loans", json={"employee_pk": e.id, "amount": 3000, "installments": 3, "issue_date": TODAY.isoformat(),
                                           "start_period": TODAY.strftime("%Y-%m"), **kw})

    def test_update_keeps_the_issue_rules(self, superclient, make_employee):  # HR-14
        e = make_employee()
        loan = self._loan(superclient, e).json()
        up = lambda **kw: superclient.put(f"{HR}/loans/{loan['id']}", json={"installment_amount": 1000, "start_period": TODAY.strftime("%Y-%m"), **kw})
        assert up(installment_amount=999999).status_code == 400
        assert up(start_period="2020-01").status_code == 400
        assert up(installment_amount=1500).status_code == 200

    def test_a_double_submit_issues_one_loan(self, superclient, make_employee):  # HR-24
        e = make_employee()
        assert self._loan(superclient, e).status_code == 201
        r = self._loan(superclient, e)
        assert r.status_code == 400 and "just recorded" in r.json()["detail"]
        assert self._loan(superclient, e, amount=3001).status_code == 201


# ───────────────────────────── leave ─────────────────────────────
class TestLeaveScope:
    def test_allocation_for_another_branch_is_refused(self, superclient, two, limited):  # HR-02
        mine, other, a, b = two
        lt = next(t for t in superclient.get(f"{HR}/leave-types").json() if t["active"])
        year = TODAY.year + 1
        own = superclient.post(f"{HR}/leave-allocations", json={"employee_pk": b.id, "leave_type_id": lt["id"], "year": year, "allocated": 5})
        assert own.status_code == 201, own.text
        c = limited()
        assert c.post(f"{HR}/leave-allocations", json={"employee_pk": b.id, "leave_type_id": lt["id"], "year": year + 1,
                                                       "allocated": 5}).status_code == 403
        assert c.put(f"{HR}/leave-allocations/{own.json()['id']}", json={"allocated": 30}).status_code == 403
        assert c.post(f"{HR}/leave-allocations", json={"employee_pk": a.id, "leave_type_id": lt["id"], "year": year,
                                                       "allocated": 5}).status_code == 201

    def test_lieu_grant_for_another_branch_is_refused(self, two, limited):  # HR-03
        mine, other, a, b = two
        sunday = TODAY - timedelta(days=(TODAY.weekday() + 1) % 7 or 7)
        r = limited().post(f"{HR}/leave-allocations/lieu", json={"employee_pk": b.id, "worked_date": sunday.isoformat()})
        assert r.status_code == 403

    def test_allocation_rules(self, superclient, make_employee, db):  # HR-22
        e = make_employee()
        lt = next(t for t in superclient.get(f"{HR}/leave-types").json() if t["active"])
        body = {"employee_pk": e.id, "leave_type_id": lt["id"], "year": TODAY.year + 1, "allocated": 2}
        assert superclient.post(f"{HR}/leave-allocations", json={**body, "adjustment": -5}).status_code == 422
        e.status = "resigned"
        db.flush()
        assert superclient.post(f"{HR}/leave-allocations", json=body).status_code == 400

    def test_leave_edit_checks_the_date_range(self, superclient):  # HR-25
        assert superclient.put(f"{HR}/leaves/1", json={"from_date": "2000-01-01"}).status_code == 422


class TestNoPayAfterPayroll:  # HR-05
    def test_no_pay_leave_cannot_be_added_to_a_run_month(self, superclient, make_employee, db):
        from app.modules.attendance.models import Leaves
        e = make_employee()
        day = _working_day(superclient, e)
        # pending before the run: approving it afterwards is refused too
        pending = superclient.post(f"{HR}/leaves", json={"employee_id": e.employee_id, "leave_type": "unpaid", "from_date": day.isoformat(),
                                                         "to_date": day.isoformat(), "leave_duration": 1, "leave_reason": "qa"})
        assert pending.status_code == 201, pending.text
        _profile(superclient, e)
        _run(superclient)
        r = superclient.post(f"{HR}/leaves/{pending.json()['id']}/approve", json={})
        assert r.status_code == 400 and "already been run" in r.json()["detail"]
        superclient.delete(f"{HR}/leaves/{pending.json()['id']}")
        r = superclient.post(f"{HR}/leaves", json={"employee_id": e.employee_id, "leave_type": "unpaid", "from_date": day.isoformat(),
                                                   "to_date": day.isoformat(), "leave_duration": 1, "leave_reason": "qa"})
        assert r.status_code == 400 and "already been run" in r.json()["detail"]
        # approved after the run (old data): never deducted, so cancelling it is allowed
        late = Leaves(employee_id=e.employee_id, leave_type="unpaid", from_date=day, to_date=day, leave_reason="r", leave_duration=1,
                      leave_time="FULL DAY", status="approved", approved_date=datetime.now() + timedelta(hours=1))
        db.add(late)
        db.flush()
        assert superclient.post(f"{HR}/leaves/{late.id}/cancel", json={"rejection_reason": "x"}).status_code == 200

    def test_cancel_still_refused_when_the_run_deducted_it(self, superclient, make_employee, db):
        from app.modules.attendance.models import Leaves
        e = make_employee()
        day = _working_day(superclient, e)
        lv = Leaves(employee_id=e.employee_id, leave_type="unpaid", from_date=day, to_date=day, leave_reason="r", leave_duration=1,
                    leave_time="FULL DAY", status="approved", approved_date=datetime.now() - timedelta(days=1))
        db.add(lv)
        db.flush()
        _profile(superclient, e)
        _run(superclient)
        r = superclient.post(f"{HR}/leaves/{lv.id}/cancel", json={"rejection_reason": "x"})
        assert r.status_code == 400 and "already deducted" in r.json()["detail"]


def test_deleting_pending_leave_closes_its_approval(superclient, make_employee, db):  # HR-12
    from app.modules.common.models import Approvals
    e = make_employee()
    day = _working_day(superclient, e, "unpaid", NEXT_MONTH)
    r = superclient.post(f"{HR}/leaves", json={"employee_id": e.employee_id, "leave_type": "unpaid", "from_date": day.isoformat(),
                                               "to_date": day.isoformat(), "leave_duration": 1, "leave_reason": "qa"})
    assert r.status_code == 201, r.text
    approval_id = r.json()["approval_id"]
    assert superclient.delete(f"{HR}/leaves/{r.json()['id']}").status_code == 204
    db.expire_all()
    assert db.query(Approvals).filter(Approvals.id == approval_id).first().status == "cancelled"


# ───────────────────────────── attendance ─────────────────────────────
class TestAttendance:
    def _emp(self, db, make_employee, make_branch):
        br = make_branch()
        e = make_employee()
        e.branch_code = br.branch_code
        db.flush()
        return e, br

    def test_check_in_and_out_with_a_date(self, superclient, db, make_employee, make_branch):  # HR-07
        e, br = self._emp(db, make_employee, make_branch)
        day = (TODAY - timedelta(days=1)).isoformat()
        r = superclient.post(f"{HR}/attendance/check-in", json={"employee_id": e.employee_id, "branch_code": br.branch_code, "date": day, "check_in": "09:00"})
        if r.status_code == 400 and "already been run" in r.text:
            pytest.skip("yesterday's month already has a payroll batch in this database")
        assert r.status_code == 200, r.text
        assert r.json()["date"] == day
        r = superclient.post(f"{HR}/attendance/check-out", json={"employee_id": e.employee_id, "date": day, "check_out": "17:00"})
        assert r.status_code == 200, r.text

    def test_overtime_counts_the_break_and_off_days(self, superclient, db, make_employee, make_branch):  # HR-08
        from app.modules.attendance.service import AttendanceService
        from app.modules.hr_core.models import HRShift
        from datetime import time
        e, br = self._emp(db, make_employee, make_branch)
        shift = HRShift(name=f"QA shift {e.employee_id}", start_time=time(8, 0), end_time=time(17, 0), grace_minutes=10, break_minutes=60,
                        work_minutes=480, half_day_minutes=240, weekly_off_days="6", is_default=False, active=True)
        db.add(shift)
        db.flush()
        e.shift_id = shift.id
        db.flush()
        svc = AttendanceService(db)
        monday = TODAY - timedelta(days=TODAY.weekday())
        sunday = monday - timedelta(days=1)
        normal = svc._calc_minutes(time(8, 0), time(17, 0), e, monday)
        assert normal["ot_mins"] == 0 and normal["work_mins"] == 480
        late_stay = svc._calc_minutes(time(8, 0), time(18, 30), e, monday)
        assert late_stay["ot_mins"] == 90
        off = svc._calc_minutes(time(9, 0), time(13, 0), e, sunday)
        assert off["ot_mins"] == 240 and off["early_mins"] == 0 and off["late_mins"] == 0

    def test_check_out_can_be_cleared(self, superclient, db, make_employee, make_branch):  # HR-09
        e, br = self._emp(db, make_employee, make_branch)
        day = TODAY - timedelta(days=1)
        r = superclient.post(f"{HR}/attendance", json={"employee_id": e.employee_id, "branch_code": br.branch_code, "date": day.isoformat(),
                                                       "check_in": "09:00", "check_out": "17:00"})
        if r.status_code == 400 and "already been run" in r.text:
            pytest.skip("yesterday's month already has a payroll batch in this database")
        assert r.status_code == 201, r.text
        r = superclient.put(f"{HR}/attendance/{r.json()['id']}", json={"check_out": None})
        assert r.status_code == 200, r.text
        assert r.json()["check_out"] is None and r.json()["work_mins"] == 0

    def test_attendance_is_locked_once_payroll_has_run(self, superclient, db, make_employee, make_branch):  # HR-10
        e, br = self._emp(db, make_employee, make_branch)
        r = superclient.post(f"{HR}/attendance", json={"employee_id": e.employee_id, "branch_code": br.branch_code, "date": FIRST.isoformat(),
                                                       "check_in": "09:00", "check_out": "17:00"})
        assert r.status_code == 201, r.text
        att = r.json()["id"]
        _profile(superclient, e)
        _run(superclient)
        assert superclient.put(f"{HR}/attendance/{att}", json={"check_out": "21:00"}).status_code == 400
        assert superclient.delete(f"{HR}/attendance/{att}").status_code == 400
        r = superclient.post(f"{HR}/attendance", json={"employee_id": e.employee_id, "branch_code": br.branch_code, "date": TODAY.isoformat(),
                                                       "check_in": "09:00"})
        assert r.status_code == 400 and "already been run" in r.json()["detail"]


# ───────────────────────────── employee master ─────────────────────────────
def _new(superclient, make_user, **extra):
    import uuid
    user, _ = make_user()
    r = superclient.post(f"{EMP}/", json={"user_id": user.id, "employee_id": f"E{uuid.uuid4().hex[:10]}", **extra})
    return user, r


class TestEmployeeMaster:
    def test_create_keeps_the_users_birthdate_and_gender(self, superclient, make_user, db):  # HR-04
        user, r = _new(superclient, make_user)
        assert r.status_code == 201, r.text
        db.refresh(user)
        assert user.birthdate == date(1990, 1, 1) and user.gender == "other"
        assert r.json()["date_of_birth"] == "1990-01-01" and r.json()["retirement_date"] == "2050-01-01"
        # given explicitly, they are still set
        user2, r2 = _new(superclient, make_user, gender="female", date_of_birth="1992-05-05")
        assert r2.status_code == 201, r2.text
        assert r2.json()["gender"] == "female" and r2.json()["date_of_birth"] == "1992-05-05"

    def test_partial_update_checks_dates_against_the_saved_record(self, superclient, make_user):  # HR-13
        user, r = _new(superclient, make_user, date_of_joining=(TODAY - timedelta(days=100)).isoformat())
        emp = r.json()
        bad = (TODAY - timedelta(days=200)).isoformat()
        for field in ("probation_end_date", "confirmation_date", "contract_end_date"):
            r = superclient.put(f"{EMP}/{emp['id']}", json={field: bad})
            assert r.status_code == 400 and "before the date of joining" in r.json()["detail"], field
        r = superclient.put(f"{EMP}/{emp['id']}", json={"date_of_joining": "1985-01-01"})
        assert r.status_code == 400 and "date of birth" in r.json()["detail"]

    def test_notice_period_ends_on_the_last_working_day(self, superclient, make_user, db):  # HR-11
        from app.modules.employees.models import Employee
        user, r = _new(superclient, make_user, date_of_joining="2020-01-01")
        emp = r.json()
        lwd = TODAY + timedelta(days=20)
        r = superclient.post(f"{EMP}/{emp['id']}/separate", json={"exit_type": "resignation", "last_working_date": lwd.isoformat()})
        assert r.status_code == 200 and r.json()["status"] == "notice_period", r.text
        r = superclient.post(f"{HR}/leaves", json={"employee_id": emp["employee_id"], "leave_type": "casual", "from_date": (lwd + timedelta(days=3)).isoformat(),
                                                   "to_date": (lwd + timedelta(days=3)).isoformat(), "leave_duration": 1, "leave_reason": "after LWD"})
        assert r.status_code == 400 and "last working day" in r.json()["detail"]
        # the last working day passes: the next read makes the employee resigned
        row = db.query(Employee).filter(Employee.id == emp["id"]).first()
        row.last_working_date = TODAY - timedelta(days=1)
        db.flush()
        assert superclient.get(f"{EMP}/{emp['id']}").json()["status"] == "resigned"

    def test_designation_cannot_move_department_while_in_use(self, superclient, make_user):  # HR-21
        import uuid
        d1 = superclient.post(f"{HR}/departments", json={"code": f"D{uuid.uuid4().hex[:6]}", "name": f"Dept {uuid.uuid4().hex[:6]}"}).json()
        d2 = superclient.post(f"{HR}/departments", json={"code": f"D{uuid.uuid4().hex[:6]}", "name": f"Dept {uuid.uuid4().hex[:6]}"}).json()
        des = superclient.post(f"{HR}/designations", json={"name": f"Des {uuid.uuid4().hex[:6]}", "department_id": d1["id"]}).json()
        _, r = _new(superclient, make_user, department_id=d1["id"], designation_id=des["id"])
        assert r.status_code == 201, r.text
        body = {"name": des["name"], "department_id": d2["id"], "active": True}
        r = superclient.put(f"{HR}/designations/{des['id']}", json=body)
        assert r.status_code == 400 and "another department" in r.json()["detail"]

    def test_shift_without_weekly_off(self, superclient):  # HR-16
        import uuid
        r = superclient.post(f"{HR}/shifts", json={"name": f"QA 7 days {uuid.uuid4().hex[:6]}", "start_time": "08:00", "end_time": "17:00",
                                                   "weekly_off_days": None})
        assert r.status_code == 201, r.text
        assert r.json()["weekly_off_days"] == ""

    def test_documents_do_not_expose_the_storage_path(self, superclient, make_user):  # HR-27
        _, r = _new(superclient, make_user)
        emp = r.json()
        doc = superclient.post(f"{EMP}/{emp['id']}/documents", json={"doc_type": "other", "title": "Letter"})
        assert doc.status_code == 201, doc.text
        up = superclient.post(f"{EMP}/{emp['id']}/documents/{doc.json()['id']}/file",
                              files={"file": ("a.pdf", b"%PDF-1.4 test", "application/pdf")})
        assert up.status_code == 200, up.text
        assert "file_path" not in up.json() and up.json()["has_file"] is True
        listed = superclient.get(f"{EMP}/{emp['id']}/documents").json()
        assert listed[0]["has_file"] is True and "file_path" not in listed[0]
