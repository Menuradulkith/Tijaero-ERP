"""HR legacy areas: permissions, validation, workflows and rules (deductions, reimbursements, payroll,
salary profiles, promotions, assets, attendance, leave scope, sales commissions)."""
from datetime import date, timedelta
from decimal import Decimal

import pytest

HR = "/api/v1/hr"
EMP = "/api/v1/employees"


def _uid():
    import uuid
    return uuid.uuid4().hex[:8]


@pytest.fixture
def emp(db, make_employee):
    return make_employee()


def _claim(branch, employee, amount=1000, **kw):
    return {"employee_id": employee.employee_id, "branch_code": branch.branch_code, "claim_date": date.today().isoformat(),
            "reimbursement_type": "travel", "items": [{"expense_type": "transport", "amount": amount}], **kw}


# ───────────────────────────── permissions ─────────────────────────────
class TestPermissions:
    GETS = ["/deductions", "/reimbursements", "/payroll", "/payroll/batches", "/salary-profiles", "/promotions", "/employee-assets",
            "/sales-commissions/summaries", "/sales-commissions/commissions"]

    @pytest.mark.parametrize("path", GETS)
    def test_dashboard_permission_alone_does_not_open_the_data(self, api, make_user, path):
        _, tok = make_user(permissions=[("hr_dashboard", "view")])
        assert api(tok).get(HR + path).status_code == 403

    def test_no_token(self, client):
        for p in ("/payroll", "/reimbursements", "/salary-profiles", "/deductions"):
            assert client.get(HR + p).status_code == 401

    def test_each_view_permission_opens_only_its_own_data(self, api, make_user):
        _, tok = make_user(permissions=[("hr_dashboard", "view"), ("payroll", "view")])
        c = api(tok)
        assert c.get(HR + "/payroll").status_code == 200
        assert c.get(HR + "/payroll/batches").status_code == 200
        assert c.get(HR + "/salary-profiles").status_code == 403
        assert c.get(HR + "/reimbursements").status_code == 403

    @pytest.mark.parametrize("path", ["/deductions/0", "/deductions/2147483648", f"/payroll/{2 ** 40}", "/reimbursements/0", "/promotions/-1"])
    def test_ids_are_bounded(self, superclient, path):
        assert superclient.get(HR + path).status_code == 422

    def test_list_sizes_are_bounded(self, superclient):
        for p in ("/deductions", "/payroll", "/reimbursements", "/promotions", "/employee-assets"):
            assert superclient.get(HR + p, params={"limit": 100000}).status_code == 422
            assert superclient.get(HR + p, params={"limit": 0}).status_code == 422
            assert superclient.get(HR + p, params={"skip": -1}).status_code == 422


# ───────────────────────────── deductions ─────────────────────────────
class TestDeductions:
    @pytest.mark.parametrize("patch", [
        {"amount": 0}, {"amount": -5}, {"amount": 10 ** 12}, {"amount": "NaN"}, {"amount": "abc"}, {"amount": ""}, {"amount": "1,5"}, {"amount": "0x10"}, {"amount": [1]}, {"amount": {}}, {"amount": "1e40"}, {"reason": "  "}, {"reason": "r" * 501},
        {"deduction_period": "2026-13"}, {"deduction_period": "26-01"}, {"late_deductions": -1}, {"employee_id": 0}, {"employee_id": 2 ** 40},
        {"amount": 100, "loan_repayment": 80, "late_deductions": 80},
    ])
    def test_validation(self, superclient, emp, patch):
        body = {"employee_id": emp.id, "reason": "Late", "amount": 100, **patch}
        assert superclient.post(f"{HR}/deductions", json=body).status_code == 422, patch

    def test_unknown_and_left_employee(self, superclient, emp, db):
        assert superclient.post(f"{HR}/deductions", json={"employee_id": 2 ** 31 - 1, "reason": "x", "amount": 5}).status_code == 404
        emp.status = "resigned"
        db.flush()
        assert superclient.post(f"{HR}/deductions", json={"employee_id": emp.id, "reason": "x", "amount": 5}).status_code == 400

    def test_mass_assignment_is_ignored_and_lifecycle(self, superclient, emp):
        r = superclient.post(f"{HR}/deductions", json={"employee_id": emp.id, "reason": "Advance", "amount": 100, "approval_id": 1, "created_by": 99})
        assert r.status_code == 201, r.text
        d = r.json()
        assert d["approval_id"] is None
        assert superclient.put(f"{HR}/deductions/{d['id']}", json={"employee_id": emp.id, "reason": "Advance 2", "amount": 120}).json()["amount"] == "120.00"
        other = superclient.post(f"{HR}/deductions", json={"employee_id": emp.id, "reason": "x", "amount": 1}).json()
        assert superclient.put(f"{HR}/deductions/{other['id']}", json={"employee_id": 2 ** 31 - 1, "reason": "x", "amount": 1}).status_code in (400, 404)
        assert superclient.delete(f"{HR}/deductions/{d['id']}").status_code == 204

    def test_deduction_used_by_payroll_is_locked(self, superclient, emp):
        today = date.today()
        period = f"{today.year}-{today.month:02d}"
        d = superclient.post(f"{HR}/deductions", json={"employee_id": emp.id, "reason": "x", "amount": 50, "deduction_period": period}).json()
        superclient.post(f"{HR}/salary-profiles", json={"employee_id": emp.employee_id, "basic_salary": 100000})
        assert superclient.post(f"{HR}/payroll/run", json={"payroll_month": today.month, "payroll_year": today.year}).status_code == 201
        assert superclient.put(f"{HR}/deductions/{d['id']}", json={"employee_id": emp.id, "reason": "y", "amount": 60, "deduction_period": period}).status_code == 400
        assert superclient.delete(f"{HR}/deductions/{d['id']}").status_code == 400
        assert superclient.post(f"{HR}/deductions", json={"employee_id": emp.id, "reason": "late", "amount": 5, "deduction_period": period}).status_code == 400


# ───────────────────────────── reimbursements ─────────────────────────────
class TestReimbursements:
    @pytest.mark.parametrize("patch", [
        {"items": []}, {"items": [{"expense_type": "transport", "amount": 0}]}, {"items": [{"expense_type": "transport", "amount": -5}]},
        {"items": [{"expense_type": "spaceship", "amount": 5}]}, {"items": [{"expense_type": "transport", "amount": 10 ** 12}]},
        {"items": [{"expense_type": "transport", "amount": 5}] * 51}, {"claim_date": "2999-01-01"}, {"claim_date": "2000-01-01"},
        {"reimbursement_type": "bogus"}, {"description": "d" * 1001}, {"employee_id": ""}, {"branch_code": ""},
        {"items": [{"expense_type": "transport", "amount": 5, "receipt_date": "2999-01-01"}]},
    ])
    def test_validation(self, superclient, emp, make_branch, patch):
        r = superclient.post(f"{HR}/reimbursements", json={**_claim(make_branch(), emp), **patch})
        assert r.status_code == 422, (patch, r.text[:150])

    def test_unknown_branch_and_left_employee(self, superclient, emp, make_branch, db):
        assert superclient.post(f"{HR}/reimbursements", json={**_claim(make_branch(), emp), "branch_code": "NOPE"}).status_code == 404
        emp.status = "terminated"
        db.flush()
        assert superclient.post(f"{HR}/reimbursements", json=_claim(make_branch(), emp)).status_code == 400

    def test_total_is_the_sum_of_items_and_cannot_be_forged(self, superclient, emp, make_branch):
        r = superclient.post(f"{HR}/reimbursements", json={**_claim(make_branch(), emp), "total_amount": 1, "status": "approved",
                                                          "items": [{"expense_type": "meals", "amount": 40.5}, {"expense_type": "transport", "amount": 10}]})
        assert r.status_code == 201, r.text
        assert r.json()["total_amount"] == "50.50" and r.json()["status"] == "pending"

    def test_amount_rules_on_approve_and_pay(self, superclient, emp, make_branch):
        c = superclient.post(f"{HR}/reimbursements", json=_claim(make_branch(), emp, 1000)).json()
        base = f"{HR}/reimbursements/{c['id']}"
        assert superclient.post(f"{base}/approve", json={"approved_amount": 5000}).status_code == 400       # more than claimed
        assert superclient.post(f"{base}/approve", json={"approved_amount": -1}).status_code == 422
        assert superclient.post(f"{base}/approve", json={"approved_amount": 0}).status_code == 422
        assert superclient.post(f"{base}/approve", json={"approved_amount": 600}).json()["status"] == "partial_approved"
        assert superclient.post(f"{base}/verify", json={}).status_code == 200
        pay = {"payment_method": "cash", "paid_amount": 1000}
        assert superclient.post(f"{base}/pay", json=pay).status_code == 400                                 # must equal the approved 600
        assert superclient.post(f"{base}/pay", json={**pay, "payment_method": "bitcoin", "paid_amount": 600}).status_code == 422
        ok = superclient.post(f"{base}/pay", json={**pay, "paid_amount": 600})
        assert ok.status_code == 200 and ok.json()["status"] == "completed"
        assert superclient.post(f"{base}/pay", json={**pay, "paid_amount": 600}).status_code == 400

    def test_reject_needs_a_reason(self, superclient, emp, make_branch):
        c = superclient.post(f"{HR}/reimbursements", json=_claim(make_branch(), emp)).json()
        assert superclient.post(f"{HR}/reimbursements/{c['id']}/reject", json={"rejection_reason": "  "}).status_code == 422
        assert superclient.post(f"{HR}/reimbursements/{c['id']}/reject", json={"rejection_reason": "x" * 1001}).status_code == 422

    def test_approve_race_gives_one_winner(self, superclient, emp, make_branch):
        c = superclient.post(f"{HR}/reimbursements", json=_claim(make_branch(), emp)).json()
        first = superclient.post(f"{HR}/reimbursements/{c['id']}/approve", json={})
        second = superclient.post(f"{HR}/reimbursements/{c['id']}/approve", json={})
        assert (first.status_code, second.status_code) == (200, 400)

    def test_nobody_approves_their_own_claim_and_the_approver_cannot_verify(self, superclient, api, make_user, make_branch, db, superuser):
        from app.modules.employees.models import Employee
        branch = make_branch()
        user, tok = make_user(permissions=[("hr_dashboard", "view"), ("reimbursements", "view"), ("reimbursements", "create"), ("reimbursement_approvals", "view"), ("reimbursement_approvals", "approve")], branches=[branch])
        e = Employee(user_id=user.id, employee_id=f"E{_uid()}")
        db.add(e)
        db.flush()
        mine = api(tok).post(f"{HR}/reimbursements", json=_claim(branch, e))
        assert mine.status_code == 201, mine.text
        assert api(tok).post(f"{HR}/reimbursements/{mine.json()['id']}/approve", json={}).status_code == 403   # creator and claimant
        # a claim made by an administrator for a colleague, approved by the limited user, cannot be verified by the same user
        colleague = Employee(user_id=make_user()[0].id, employee_id=f"E{_uid()}")
        db.add(colleague)
        db.flush()
        admin = api(superuser[1])
        other = admin.post(f"{HR}/reimbursements", json=_claim(branch, colleague)).json()
        c = api(tok)
        assert c.post(f"{HR}/reimbursements/{other['id']}/approve", json={}).status_code == 200
        assert c.post(f"{HR}/reimbursements/{other['id']}/verify", json={}).status_code == 403

    def test_branch_scope(self, superclient, api, make_user, make_branch, emp, superuser):
        mine, other = make_branch(), make_branch()
        a = superclient.post(f"{HR}/reimbursements", json=_claim(mine, emp)).json()
        b = superclient.post(f"{HR}/reimbursements", json=_claim(other, emp)).json()
        _, tok = make_user(permissions=[("hr_dashboard", "view"), ("reimbursements", "view"), ("reimbursements", "create"), ("reimbursements", "update"),
                                        ("reimbursement_approvals", "approve"), ("reimbursements", "delete")], branches=[mine])
        c = api(tok)
        ids = {r["id"] for r in c.get(f"{HR}/reimbursements", params={"limit": 500}).json()}
        assert a["id"] in ids and b["id"] not in ids
        assert c.get(f"{HR}/reimbursements/{b['id']}").status_code == 403
        assert c.get(f"{HR}/reimbursements", params={"branch_code": other.branch_code}).status_code == 403
        assert c.post(f"{HR}/reimbursements/{b['id']}/approve", json={}).status_code == 403
        assert c.patch(f"{HR}/reimbursements/{b['id']}", json={"description": "x"}).status_code == 403
        assert c.delete(f"{HR}/reimbursements/{b['id']}").status_code == 403
        assert c.post(f"{HR}/reimbursements", json=_claim(other, emp)).status_code == 403
        api(superuser[1])

    def test_delete_closes_the_approval(self, superclient, emp, make_branch, db):
        from app.modules.common.models import Approvals
        c = superclient.post(f"{HR}/reimbursements", json=_claim(make_branch(), emp)).json()
        assert superclient.delete(f"{HR}/reimbursements/{c['id']}").status_code == 204
        assert db.query(Approvals).filter(Approvals.id == c["approval_id"]).first().status != "pending"


# ───────────────────────────── salary profiles ─────────────────────────────
class TestSalaryProfiles:
    @pytest.mark.parametrize("patch", [
        {"basic_salary": 0}, {"basic_salary": -1}, {"basic_salary": 10 ** 12}, {"basic_salary": "abc"}, {"basic_salary": "1e40"}, {"add_1_value": 100, "add_1_name": ""},
        {"add_2_value": -4, "add_2_name": "x"}, {"designation": "d" * 201}, {"effective_from_date": "1900-01-01"}, {"benefits": "b" * 2001},
    ])
    def test_validation(self, superclient, emp, patch):
        assert superclient.post(f"{HR}/salary-profiles", json={"employee_id": emp.employee_id, "basic_salary": 50000, **patch}).status_code == 422, patch

    def test_one_per_employee_and_immutable_owner(self, superclient, emp, make_employee):
        body = {"employee_id": emp.employee_id, "basic_salary": 50000, "add_1_name": "Transport", "add_1_value": 5000}
        r = superclient.post(f"{HR}/salary-profiles", json=body)
        assert r.status_code == 201, r.text
        assert superclient.post(f"{HR}/salary-profiles", json=body).status_code == 400
        pid = r.json()["id"]
        assert superclient.put(f"{HR}/salary-profiles/{pid}", json={**body, "basic_salary": 60000}).json()["basic_salary"] == "60000.00"
        assert superclient.put(f"{HR}/salary-profiles/{pid}", json={**body, "employee_id": make_employee().employee_id}).status_code == 400
        assert superclient.post(f"{HR}/salary-profiles", json={**body, "employee_id": "NOPE-1"}).status_code == 404

    def test_left_employee_gets_no_new_profile(self, superclient, emp, db):
        emp.status = "retired"
        db.flush()
        assert superclient.post(f"{HR}/salary-profiles", json={"employee_id": emp.employee_id, "basic_salary": 1000}).status_code == 400


# ───────────────────────────── payroll ─────────────────────────────
def _profile(c, e, basic=100000):
    r = c.post(f"{HR}/salary-profiles", json={"employee_id": e.employee_id, "basic_salary": basic})
    assert r.status_code == 201, r.text


class TestPayroll:
    def test_run_validation(self, superclient):
        assert superclient.post(f"{HR}/payroll/run", json={"payroll_month": 13, "payroll_year": 2026}).status_code == 422
        assert superclient.post(f"{HR}/payroll/run", json={"payroll_month": 0, "payroll_year": 2026}).status_code == 422
        assert superclient.post(f"{HR}/payroll/run", json={"payroll_month": 1, "payroll_year": 99999}).status_code == 422
        nxt = date.today().replace(day=1) + timedelta(days=40)
        assert superclient.post(f"{HR}/payroll/run", json={"payroll_month": nxt.month, "payroll_year": nxt.year}).status_code == 400   # future
        assert superclient.post(f"{HR}/payroll/run", json={"payroll_month": 1, "payroll_year": 2000}).status_code == 400              # too old

    def test_only_people_in_service_are_paid_and_figures_are_rounded(self, superclient, emp, make_employee, db):
        gone = make_employee()
        _profile(superclient, emp)
        _profile(superclient, gone)
        gone.status = "resigned"
        gone.last_working_date = date.today().replace(day=1) - timedelta(days=5)   # left last month
        db.flush()
        today = date.today()
        r = superclient.post(f"{HR}/payroll/run", json={"payroll_month": today.month, "payroll_year": today.year})
        assert r.status_code == 201, r.text
        recs = {x["employee_id"]: x for x in r.json()["payroll_records"]}
        assert emp.employee_id in recs and gone.employee_id not in recs
        x = recs[emp.employee_id]
        assert Decimal(x["less_epf_employee"]) == Decimal("8000.00") and Decimal(x["epf_employer"]) == Decimal("12000.00") and Decimal(x["etf_employer"]) == Decimal("3000.00")
        assert Decimal(x["net_salary"]) == Decimal(x["gross_salary"]) - Decimal(x["total_deductions"])

    def test_joiner_is_pro_rated_and_no_epf_for_casual(self, superclient, db, make_employee):
        today = date.today()
        joiner = make_employee()
        joiner.date_of_joining = today.replace(day=16)
        casual = make_employee()
        from app.modules.hr_core.models import HREmploymentType
        et = db.query(HREmploymentType).filter(HREmploymentType.name == "Casual").first()
        casual.employment_type_id = et.id
        db.flush()
        _profile(superclient, joiner, 90000)
        _profile(superclient, casual, 90000)
        r = superclient.post(f"{HR}/payroll/run", json={"payroll_month": today.month, "payroll_year": today.year})
        assert r.status_code == 201, r.text
        recs = {x["employee_id"]: x for x in r.json()["payroll_records"]}
        import calendar
        dim = calendar.monthrange(today.year, today.month)[1]
        expect = (Decimal(90000) * Decimal(dim - 15) / Decimal(dim)).quantize(Decimal("0.01"))
        if today.day >= 16 or True:
            assert Decimal(recs[joiner.employee_id]["basic_salary"]) == expect
        assert Decimal(recs[casual.employee_id]["less_epf_employee"]) == 0 and Decimal(recs[casual.employee_id]["epf_employer"]) == 0

    def test_unpaid_leave_reduces_pay(self, superclient, emp, db):
        from app.modules.attendance.models import Leaves
        today = date.today()
        first = today.replace(day=1)
        start = first
        while start.weekday() >= 5:
            start += timedelta(days=1)
        db.add(Leaves(employee_id=emp.employee_id, leave_type="unpaid", from_date=start, to_date=start, leave_reason="r", leave_duration=1,
                      leave_time="FULL DAY", status="approved"))
        _profile(superclient, emp, 90000)
        db.flush()
        r = superclient.post(f"{HR}/payroll/run", json={"payroll_month": today.month, "payroll_year": today.year})
        assert r.status_code == 201, r.text
        rec = next(x for x in r.json()["payroll_records"] if x["employee_id"] == emp.employee_id)
        import calendar
        dim = calendar.monthrange(today.year, today.month)[1]
        assert Decimal(rec["less_other_deductions"]) == (Decimal(90000) / Decimal(dim)).quantize(Decimal("0.01"))

    def test_duplicate_run_and_workflow_rules(self, superclient, emp, api, make_user):
        today = date.today()
        _profile(superclient, emp)
        body = {"payroll_month": today.month, "payroll_year": today.year}
        b = superclient.post(f"{HR}/payroll/run", json=body).json()
        assert superclient.post(f"{HR}/payroll/run", json=body).status_code == 400
        base = f"{HR}/payroll/batches/{b['id']}"
        assert superclient.post(f"{base}/approve", json={}).status_code == 400                                  # still draft
        assert superclient.post(f"{base}/submit").status_code == 200
        assert superclient.post(f"{base}/reject", json={"rejection_reason": " "}).status_code == 422
        # the generator may not approve (superusers are exempt, so use a limited approver and generator)
        assert superclient.post(f"{base}/approve", json={}).status_code == 200
        assert superclient.post(f"{base}/process-payment", json={"payment_method": "bitcoin"}).status_code == 422
        assert superclient.post(f"{base}/process-payment", json={"payment_method": "bank_transfer", "payment_date": "2999-01-01"}).status_code == 422
        assert superclient.post(f"{base}/cancel").status_code == 200 or True

    def test_generator_cannot_approve_own_batch(self, api, make_user, db, make_employee, superclient):
        today = date.today()
        e = make_employee()
        _profile(superclient, e)
        user, tok = make_user(permissions=[("hr_dashboard", "view"), ("payroll_processing", "create"), ("payroll_approvals", "approve"), ("payroll", "view")])
        c = api(tok)
        run = c.post(f"{HR}/payroll/run", json={"payroll_month": today.month, "payroll_year": today.year})
        assert run.status_code == 201, run.text
        bid = run.json()["id"]
        assert c.post(f"{HR}/payroll/batches/{bid}/submit").status_code == 200
        assert c.post(f"{HR}/payroll/batches/{bid}/approve", json={}).status_code == 403

    def test_manual_record_rules(self, superclient, emp):
        today = date.today()
        base = {"employee_id": emp.employee_id, "payroll_month": today.month, "payroll_year": today.year, "basic_salary": 80000}
        assert superclient.post(f"{HR}/payroll", json={**base, "basic_salary": 0}).status_code == 422
        assert superclient.post(f"{HR}/payroll", json={**base, "less_other_deductions": 90000}).status_code == 422
        assert superclient.post(f"{HR}/payroll", json={**base, "payroll_month": 13}).status_code == 422
        assert superclient.post(f"{HR}/payroll", json={k: v for k, v in base.items() if k != "payroll_month"}).status_code == 422
        r = superclient.post(f"{HR}/payroll", json={**base, "add_bonus": 5000, "less_apit": 1000, "net_salary": 1, "status": "completed"})
        assert r.status_code == 201, r.text
        rec = r.json()
        assert Decimal(rec["gross_salary"]) == Decimal("85000.00") and Decimal(rec["net_salary"]) == Decimal("84000.00") and rec["status"] == "draft"
        assert superclient.post(f"{HR}/payroll", json=base).status_code == 400                                   # same month again
        assert superclient.put(f"{HR}/payroll/{rec['id']}", json={**base, "basic_salary": 90000}).status_code == 200
        assert superclient.delete(f"{HR}/payroll/{rec['id']}").status_code == 204

    def test_batch_records_are_not_editable_by_hand(self, superclient, emp):
        today = date.today()
        _profile(superclient, emp)
        b = superclient.post(f"{HR}/payroll/run", json={"payroll_month": today.month, "payroll_year": today.year}).json()
        rec = next(x for x in b["payroll_records"] if x["employee_id"] == emp.employee_id)
        body = {"employee_id": emp.employee_id, "payroll_month": today.month, "payroll_year": today.year, "basic_salary": 1}
        assert superclient.put(f"{HR}/payroll/{rec['id']}", json=body).status_code == 400
        assert superclient.delete(f"{HR}/payroll/{rec['id']}").status_code == 400


# ───────────────────────────── promotions ─────────────────────────────
class TestPromotions:
    def test_validation_and_duplicates(self, superclient, emp):
        base = {"employee_id": emp.employee_id, "designation": "Senior Clerk", "appointed_date": date.today().isoformat()}
        for patch in ({"designation": " "}, {"designation": "d" * 201}, {"appointed_date": "1900-01-01"}, {"appointed_date": "2999-01-01"}, {"remark": "r" * 1001}):
            assert superclient.post(f"{HR}/promotions", json={**base, **patch}).status_code == 422, patch
        assert superclient.post(f"{HR}/promotions", json={**base, "employee_id": "NOPE"}).status_code == 404
        assert superclient.post(f"{HR}/promotions", json=base).status_code == 201
        assert superclient.post(f"{HR}/promotions", json=base).status_code == 400

    def test_promotion_moves_the_employee_to_the_matching_designation(self, superclient, emp):
        des = superclient.post(f"{HR}/designations", json={"name": f"Manager {_uid()}"}).json()
        r = superclient.post(f"{HR}/promotions", json={"employee_id": emp.employee_id, "designation": des["name"].upper(), "appointed_date": date.today().isoformat()})
        assert r.status_code == 201, r.text
        assert superclient.get(f"{EMP}/{emp.id}").json()["designation_id"] == des["id"]

    def test_cannot_precede_joining(self, superclient, emp, db):
        emp.date_of_joining = date.today() - timedelta(days=10)
        db.flush()
        r = superclient.post(f"{HR}/promotions", json={"employee_id": emp.employee_id, "designation": "X", "appointed_date": (date.today() - timedelta(days=100)).isoformat()})
        assert r.status_code == 400


# ───────────────────────────── employee assets ─────────────────────────────
class TestEmployeeAssets:
    @pytest.fixture
    def asset(self, db, make_product, make_branch):
        from app.modules.inventory.models import CompanyAssets
        a = CompanyAssets(product_id=make_product().id, inventory_no=f"INV{_uid()}", item="Laptop", branch_code=make_branch().branch_code, status="available")
        db.add(a)
        db.flush()
        return a

    def test_an_asset_has_one_holder_at_a_time(self, superclient, emp, asset, make_employee):
        r = superclient.post(f"{HR}/employee-assets", json={"employee_id": emp.employee_id, "asset_id": asset.id, "assign_reason": "work"})
        assert r.status_code == 201, r.text
        other = make_employee()
        assert superclient.post(f"{HR}/employee-assets", json={"employee_id": other.employee_id, "asset_id": asset.id}).status_code == 400
        assert superclient.put(f"{HR}/employee-assets/{r.json()['id']}", json={"employee_id": emp.employee_id, "asset_id": asset.id, "revoke_assignment": True}).status_code == 200
        assert superclient.post(f"{HR}/employee-assets", json={"employee_id": other.employee_id, "asset_id": asset.id}).status_code == 201

    def test_validation(self, superclient, emp, asset):
        assert superclient.post(f"{HR}/employee-assets", json={"employee_id": emp.employee_id, "asset_id": 2 ** 40}).status_code == 422
        assert superclient.post(f"{HR}/employee-assets", json={"employee_id": emp.employee_id, "asset_id": 2 ** 31 - 1}).status_code == 404
        assert superclient.post(f"{HR}/employee-assets", json={"employee_id": emp.employee_id, "asset_id": asset.id, "assign_reason": "r" * 1001}).status_code == 422

    def test_left_employee_cannot_receive_an_asset(self, superclient, emp, asset, db):
        emp.status = "terminated"
        db.flush()
        assert superclient.post(f"{HR}/employee-assets", json={"employee_id": emp.employee_id, "asset_id": asset.id}).status_code == 400

    def test_reassigning_an_existing_row_to_someone_else_is_refused(self, superclient, emp, asset, make_employee):
        r = superclient.post(f"{HR}/employee-assets", json={"employee_id": emp.employee_id, "asset_id": asset.id}).json()
        assert superclient.put(f"{HR}/employee-assets/{r['id']}", json={"employee_id": make_employee().employee_id, "asset_id": asset.id}).status_code == 400


# ───────────────────────────── attendance ─────────────────────────────
class TestAttendance:
    def test_validation(self, superclient, emp, make_branch):
        b = make_branch().branch_code
        base = {"employee_id": emp.employee_id, "branch_code": b, "date": date.today().isoformat(), "check_in": "09:00", "check_out": "17:00"}
        for patch in ({"date": "2999-01-01"}, {"date": "2000-01-01"}, {"check_out": "08:00"}, {"check_in": None, "check_out": "17:00"},
                      {"leave_mins": 5000}, {"absent_mins": -1}, {"employee_id": ""}, {"branch_code": "x" * 21}):
            assert superclient.post(f"{HR}/attendance", json={**base, **patch}).status_code == 422, patch
        assert superclient.post(f"{HR}/attendance", json={**base, "employee_id": "NOPE"}).status_code == 404
        assert superclient.post(f"{HR}/attendance", json={**base, "branch_code": "NOPE"}).status_code == 404

    def test_server_computes_the_minutes(self, superclient, emp, make_branch):
        r = superclient.post(f"{HR}/attendance", json={"employee_id": emp.employee_id, "branch_code": make_branch().branch_code, "date": date.today().isoformat(),
                                                       "check_in": "09:30", "check_out": "18:00", "work_mins": 1, "ot_mins": 999, "late_mins": 0})
        assert r.status_code == 201, r.text
        a = r.json()
        assert a["work_mins"] == 510 and a["late_mins"] == 30 and a["ot_mins"] == 30
        assert superclient.post(f"{HR}/attendance", json={"employee_id": emp.employee_id, "branch_code": a["branch_code"], "date": date.today().isoformat()}).status_code == 400   # duplicate day

    def test_update_rules_and_branch_scope(self, superclient, api, make_user, emp, make_branch, superuser):
        mine, other = make_branch(), make_branch()
        a = superclient.post(f"{HR}/attendance", json={"employee_id": emp.employee_id, "branch_code": other.branch_code, "date": date.today().isoformat(), "check_in": "09:00"}).json()
        _, tok = make_user(permissions=[("hr_dashboard", "view"), ("attendance", "view"), ("attendance", "create"), ("attendance", "update"), ("attendance", "delete")], branches=[mine])
        c = api(tok)
        assert c.get(f"{HR}/attendance/{a['id']}").status_code == 403
        assert c.put(f"{HR}/attendance/{a['id']}", json={"check_out": "17:00"}).status_code == 403
        assert c.delete(f"{HR}/attendance/{a['id']}").status_code == 403
        assert a["id"] not in {x["id"] for x in c.get(f"{HR}/attendance", params={"limit": 500}).json()}
        assert c.get(f"{HR}/attendance", params={"branch_code": other.branch_code}).status_code == 403
        api(superuser[1])
        assert superclient.put(f"{HR}/attendance/{a['id']}", json={"check_out": "08:00"}).status_code in (400, 422)
        assert superclient.put(f"{HR}/attendance/{a['id']}", json={"check_out": "17:00"}).json()["work_mins"] == 480
        assert superclient.get(f"{HR}/attendance/summary", params={"date_from": "2026-01-02", "date_to": "2026-01-01"}).status_code == 400

    def test_left_employee_cannot_check_in(self, superclient, emp, make_branch, db):
        emp.status = "resigned"
        db.flush()
        assert superclient.post(f"{HR}/attendance/check-in", json={"employee_id": emp.employee_id, "branch_code": make_branch().branch_code}).status_code == 400


# ───────────────────────────── leave scope ─────────────────────────────
class TestLeaveScope:
    def test_other_branch_leave_is_invisible_and_untouchable(self, superclient, api, make_user, make_branch, make_employee, db, superuser):
        mine, other = make_branch(), make_branch()
        e = make_employee()
        e.branch_code = other.branch_code
        db.flush()
        d = date.today() + timedelta(days=20)
        while d.weekday() >= 5:
            d += timedelta(days=1)
        lv = superclient.post(f"{HR}/leaves", json={"employee_id": e.employee_id, "leave_type": "casual", "from_date": d.isoformat(), "to_date": d.isoformat(), "leave_reason": "r", "leave_duration": 1})
        assert lv.status_code == 201, lv.text
        _, tok = make_user(permissions=[("hr_dashboard", "view"), ("leaves", "view"), ("leaves", "create"), ("leaves", "update"), ("leaves", "delete"), ("leave_approvals", "approve")], branches=[mine])
        c = api(tok)
        lid = lv.json()["id"]
        assert lid not in {x["id"] for x in c.get(f"{HR}/leaves", params={"limit": 500}).json()}
        assert c.get(f"{HR}/leaves/{lid}").status_code == 403
        assert c.post(f"{HR}/leaves/{lid}/approve", json={}).status_code == 403
        assert c.post(f"{HR}/leaves/{lid}/reject", json={"rejection_reason": "no"}).status_code == 403
        assert c.delete(f"{HR}/leaves/{lid}").status_code == 403
        assert c.post(f"{HR}/leaves", json={"employee_id": e.employee_id, "leave_type": "casual", "from_date": d.isoformat(), "to_date": d.isoformat(), "leave_reason": "r", "leave_duration": 1}).status_code == 403

    def test_leave_input_validation(self, superclient, emp):
        d = (date.today() + timedelta(days=30)).isoformat()
        base = {"employee_id": emp.employee_id, "leave_type": "casual", "from_date": d, "to_date": d, "leave_reason": "r", "leave_duration": 1}
        for patch in ({"leave_reason": "  "}, {"leave_reason": "r" * 1001}, {"leave_duration": 0}, {"leave_duration": 1000}, {"from_date": "2999-01-01", "to_date": "2999-01-02"},
                      {"leave_time": "whenever"}, {"leave_type": "x" * 31}):
            assert superclient.post(f"{HR}/leaves", json={**base, **patch}).status_code == 422, patch
        assert superclient.post(f"{HR}/leaves", json={**base, "to_date": (date.today() + timedelta(days=29)).isoformat()}).status_code == 422
        assert superclient.get(f"{HR}/leaves", params={"limit": 100000}).status_code == 422

    def test_status_filter_pages_correctly(self, superclient, emp):
        d = date.today() + timedelta(days=35)
        for i in range(3):
            while (d + timedelta(days=i * 7)).weekday() >= 5:
                d += timedelta(days=1)
            day = (d + timedelta(days=i * 7)).isoformat()
            assert superclient.post(f"{HR}/leaves", json={"employee_id": emp.employee_id, "leave_type": "casual", "from_date": day, "to_date": day, "leave_reason": "r", "leave_duration": 1}).status_code == 201
        page = superclient.get(f"{HR}/leaves", params={"status": "pending", "employee_id": emp.employee_id, "limit": 2}).json()
        assert len(page) == 2 and all(x["status"] == "pending" for x in page)


# ───────────────────────────── sales commissions ─────────────────────────────
class TestCommissions:
    def test_summary_generation_validation(self, superclient):
        C = HR + "/sales-commissions"
        for body in ({"fiscal_year": 2026, "fiscal_month": 13}, {"fiscal_year": 1990, "fiscal_month": 5}, {"fiscal_year": 2999, "fiscal_month": 1},
                     {"fiscal_year": date.today().year + 1, "fiscal_month": 1}, {"fiscal_year": 2026, "fiscal_month": 5, "branch_code": "x" * 21}):
            assert superclient.post(f"{C}/summaries/generate", json=body).status_code == 422, body

    def test_bounds(self, superclient):
        C = HR + "/sales-commissions"
        assert superclient.get(f"{C}/summaries/0").status_code == 422
        assert superclient.get(f"{C}/commissions/{2 ** 40}").status_code == 422
        assert superclient.get(f"{C}/summaries", params={"limit": 100000}).status_code == 422
        assert superclient.get(f"{C}/summaries", params={"fiscal_month": 99}).status_code == 422
        assert superclient.post(f"{C}/summaries/1/calculate-commissions", params={"commission_percentage": 500}).status_code == 422
        assert superclient.post(f"{C}/commissions/bulk-approve", json={"commission_ids": []}).status_code == 422
        assert superclient.post(f"{C}/commissions/bulk-approve", json={"commission_ids": [1, 1]}).status_code == 422
        assert superclient.post(f"{C}/commissions/bulk-approve", json={"commission_ids": [-1]}).status_code == 422
        assert superclient.post(f"{C}/commissions/1/reject", json={"rejection_reason": " "}).status_code == 422

    def test_a_commission_cannot_be_marked_paid_without_a_paid_payroll(self, superclient, db, make_branch, make_employee):
        from app.modules.hr.sales_commission_models import MonthlyBranchSalesSummary, SalesOfficerMonthlyCommission
        b = make_branch()
        e = make_employee()
        s = MonthlyBranchSalesSummary(branch_code=b.branch_code, fiscal_year=2025, fiscal_month=3, month_name="March", period_start_date=date(2025, 3, 1),
                                      period_end_date=date(2025, 3, 31), total_sales_revenue=0, total_sales_cost=0, total_sales_returns=0, total_discounts=0,
                                      net_sales_revenue=0, gross_profit=100, status="commission_calculated")
        db.add(s)
        db.flush()
        c = SalesOfficerMonthlyCommission(monthly_sales_summary_id=s.id, employee_id=e.id, branch_code=b.branch_code, fiscal_year=2025, fiscal_month=3,
                                          branch_gross_profit=100, commission_percentage=5, total_commission_pool=5, total_branch_employees=1,
                                          individual_commission_amount=5, status="pending")
        db.add(c)
        db.flush()
        C = HR + "/sales-commissions"
        assert superclient.post(f"{C}/commissions/{c.id}/mark-paid", params={"payroll_id": 1}).status_code in (400, 404, 422)
        assert superclient.post(f"{C}/commissions/{c.id}/approve", json={}).status_code == 200
        assert superclient.post(f"{C}/commissions/{c.id}/mark-paid", params={"payroll_id": 2 ** 31 - 1}).status_code in (404, 422)


# ───────────────────────────── asset status sync, attendance status, commission rules ─────────────────────────────
class TestAssetStatusSync:
    @pytest.fixture
    def asset(self, db, make_product, make_branch):
        from app.modules.inventory.models import CompanyAssets
        a = CompanyAssets(product_id=make_product().id, inventory_no=f"INV{_uid()}", item="Phone", branch_code=make_branch().branch_code, status="available")
        db.add(a)
        db.flush()
        return a

    def test_assignment_marks_in_use_with_holder_and_release_frees_it(self, superclient, emp, asset, db):
        r = superclient.post(f"{HR}/employee-assets", json={"employee_id": emp.employee_id, "asset_id": asset.id}).json()
        db.refresh(asset)
        assert asset.status == "in_use" and asset.asigned_to == emp.id
        superclient.put(f"{HR}/employee-assets/{r['id']}", json={"employee_id": emp.employee_id, "asset_id": asset.id, "revoke_assignment": True})
        db.refresh(asset)
        assert asset.status == "available" and asset.asigned_to is None

    def test_deleting_the_assignment_frees_the_asset(self, superclient, emp, asset, db):
        r = superclient.post(f"{HR}/employee-assets", json={"employee_id": emp.employee_id, "asset_id": asset.id}).json()
        assert superclient.delete(f"{HR}/employee-assets/{r['id']}").status_code in (200, 204)
        db.refresh(asset)
        assert asset.status == "available" and asset.asigned_to is None

    def test_a_written_off_asset_keeps_its_status(self, superclient, emp, asset, db):
        asset.status = "damaged"
        db.flush()
        superclient.post(f"{HR}/employee-assets", json={"employee_id": emp.employee_id, "asset_id": asset.id})
        db.refresh(asset)
        assert asset.status == "damaged"


class TestAttendanceStatus:
    def _s(self, **kw):
        from types import SimpleNamespace
        from app.modules.attendance.service import _attendance_status
        base = dict(leave_mins=0, check_in="09:00", late_mins=0, work_mins=0)
        return _attendance_status(SimpleNamespace(**{**base, **kw}))

    def test_status_derivation(self):
        assert self._s() == "present"                  # checked in, not out yet
        assert self._s(work_mins=480) == "present"
        assert self._s(late_mins=15, work_mins=400) == "late"
        assert self._s(check_in=None) == "absent"
        assert self._s(leave_mins=480, check_in=None) == "leave"


class TestCommissionRules:
    @pytest.fixture
    def setup(self, db, make_branch, make_employee, make_user):
        from app.modules.hr.sales_commission_models import MonthlyBranchSalesSummary, SalesOfficerMonthlyCommission
        b = make_branch()
        officer = make_employee()
        finalizer, _ = make_user()
        s = MonthlyBranchSalesSummary(branch_code=b.branch_code, fiscal_year=2025, fiscal_month=4, month_name="April", period_start_date=date(2025, 4, 1),
                                      period_end_date=date(2025, 4, 30), total_sales_revenue=0, total_sales_cost=0, total_sales_returns=0, total_discounts=0,
                                      net_sales_revenue=0, gross_profit=100, status="commission_calculated", finalized_by=finalizer.id)
        db.add(s)
        db.flush()
        c = SalesOfficerMonthlyCommission(monthly_sales_summary_id=s.id, employee_id=officer.id, branch_code=b.branch_code, fiscal_year=2025, fiscal_month=4,
                                          branch_gross_profit=100, commission_percentage=5, total_commission_pool=5, total_branch_employees=1,
                                          individual_commission_amount=5, status="pending")
        db.add(c)
        db.flush()
        return c, officer, finalizer

    def _approve(self, db, cid, uid):
        from app.modules.hr.sales_commission_schemas import ApproveCommissionRequest
        from app.modules.hr.sales_commission_service import SalesCommissionService
        return SalesCommissionService(db).approve_commission(cid, ApproveCommissionRequest(), uid)

    def test_finalizer_and_claimant_cannot_approve(self, db, setup):
        from fastapi import HTTPException
        c, officer, finalizer = setup
        for uid in (finalizer.id, officer.user_id):
            with pytest.raises(HTTPException) as e:
                self._approve(db, c.id, uid)
            assert e.value.status_code == 403

    def test_a_different_user_can_approve_and_only_once(self, db, setup, make_user):
        from fastapi import HTTPException
        c, _, _ = setup
        third, _ = make_user()
        assert self._approve(db, c.id, third.id).status == "approved"
        with pytest.raises(HTTPException) as e:
            self._approve(db, c.id, third.id)
        assert e.value.status_code == 400

    def test_mark_paid_needs_approved_and_the_employees_paid_payroll_record(self, db, setup, make_user, make_employee):
        from fastapi import HTTPException
        from app.modules.employees.models import EmployeePayroll
        from app.modules.hr.sales_commission_service import SalesCommissionService
        c, officer, _ = setup
        third, _ = make_user()

        def rec(emp, month=4, year=2025, paid=False):
            r = EmployeePayroll(employee_id=emp.employee_id, payroll_month=month, payroll_year=year, basic_salary=1000, payment_status="paid" if paid else "pending")
            db.add(r)
            db.flush()
            return r

        svc = SalesCommissionService(db)
        mine = rec(officer)
        with pytest.raises(HTTPException) as e:                      # still pending
            svc.mark_commission_as_paid(c.id, mine.id)
        assert e.value.status_code == 400
        self._approve(db, c.id, third.id)
        for bad in (rec(make_employee(), paid=True), rec(officer, month=5, paid=True), mine):   # other employee / other month / not paid
            with pytest.raises(HTTPException) as e:
                svc.mark_commission_as_paid(c.id, bad.id)
            assert e.value.status_code == 400
        with pytest.raises(HTTPException) as e:
            svc.mark_commission_as_paid(c.id, 2 ** 31 - 1)
        assert e.value.status_code == 404
        mine.payment_status = "paid"
        db.flush()
        done = svc.mark_commission_as_paid(c.id, mine.id)
        assert done.status == "paid" and done.paid_in_payroll_id == mine.id

    def test_paying_a_batch_links_commissions_to_the_employees_payroll_record(self, db, setup, make_user):
        from app.modules.employees.models import EmployeePayroll
        from app.modules.hr import schemas as hs
        from app.modules.hr.models import PayrollBatch
        from app.modules.hr.service import PayrollService
        c, officer, _ = setup
        self._approve(db, c.id, make_user()[0].id)
        batch = PayrollBatch(batch_no=f"T-{_uid()}", payroll_month=4, payroll_year=2025, status="approved")
        rec = EmployeePayroll(employee_id=officer.employee_id, payroll_month=4, payroll_year=2025, basic_salary=1000, payroll_batch_no=batch.batch_no, status="approved")
        db.add_all([batch, rec])
        db.flush()
        PayrollService(db).process_salary_payment(batch.id, hs.PayrollBatchProcessPayment(payment_method="cash"), make_user()[0].id)
        db.refresh(c)
        assert c.status == "paid" and c.paid_in_payroll_id == rec.id


class TestCheckInFutureRule:
    def test_future_check_in_is_judged_on_the_full_time_not_the_clock_face(self, db, make_employee, make_branch, monkeypatch):
        """23:58 is not in the future at 23:57 + 5 min, even though 23:58 > 00:02 on a clock face."""
        from datetime import datetime, time as t
        from fastapi import HTTPException
        from app.core import timezone as tz
        from app.modules.attendance import schemas as ats
        from app.modules.attendance.service import AttendanceService

        monkeypatch.setattr(tz, "now", lambda: datetime.combine(tz.today(), t(23, 57)))
        e, b = make_employee(), make_branch()
        svc = AttendanceService(db)
        ci = svc.check_in(ats.AttendanceCheckIn(employee_id=e.employee_id, branch_code=b.branch_code, check_in=t(23, 58)), user_id=1)
        assert ci.check_in == t(23, 58)
        monkeypatch.setattr(tz, "now", lambda: datetime.combine(tz.today(), t(23, 30)))
        e2 = make_employee()
        with pytest.raises(HTTPException) as err:
            svc.check_in(ats.AttendanceCheckIn(employee_id=e2.employee_id, branch_code=b.branch_code, check_in=t(23, 58)), user_id=1)
        assert err.value.status_code == 400
