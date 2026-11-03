"""Sri Lankan payroll: EPF on EPF-liable allowances, overtime from attendance, stamp duty threshold,
loan / advance recovery, effective-dated salary revisions, statutory returns and final settlement."""
from datetime import date, timedelta
from decimal import Decimal as D

import pytest

HR = "/api/v1/hr"

TODAY = date.today()
PERIOD = {"payroll_month": TODAY.month, "payroll_year": TODAY.year}
FIRST = TODAY.replace(day=1)


@pytest.fixture
def emp(db, make_employee):
    e = make_employee()
    e.epf_no, e.nic, e.bank_account_no, e.bank_name = "EPF-77", "199012345678", "000111222", "BOC"
    db.flush()
    return e


def _profile(c, e, basic=100000, allowances=None, **kw):
    r = c.post(f"{HR}/salary-profiles", json={"employee_id": e.employee_id, "basic_salary": basic, "allowances": allowances or [], **kw})
    assert r.status_code == 201, r.text
    return r.json()


def _run(c):
    r = c.post(f"{HR}/payroll/run", json=PERIOD)
    assert r.status_code == 201, r.text
    return r.json()


def _rec(batch, e):
    return next(x for x in batch["payroll_records"] if x["employee_id"] == e.employee_id)


class TestCalculation:
    def test_epf_is_on_basic_plus_epf_liable_allowances(self, superclient, emp):
        _profile(superclient, emp, 100000, [
            {"name": "BRA", "amount": 3500, "epf_liable": True, "taxable": True},
            {"name": "Transport", "amount": 10000, "epf_liable": False, "taxable": False},
        ])
        r = _rec(_run(superclient), emp)
        assert D(r["gross_salary"]) == D("113500.00")
        assert D(r["epf_earnings"]) == D("103500.00")
        assert D(r["less_epf_employee"]) == D("8280.00") and D(r["epf_employer"]) == D("12420.00") and D(r["etf_employer"]) == D("3105.00")
        assert D(r["taxable_income"]) == D("103500.00")          # transport is not taxable
        assert D(r["less_apit"]) == 0                            # under the 150,000 monthly relief
        assert D(r["less_stamp_duty"]) == D("25.00")
        assert [a["name"] for a in r["allowance_lines"]] == ["BRA", "Transport"]
        assert D(r["net_salary"]) == D(r["gross_salary"]) - D(r["total_deductions"])

    def test_no_stamp_duty_at_or_below_the_threshold(self, superclient, emp):
        _profile(superclient, emp, 25000)
        assert D(_rec(_run(superclient), emp)["less_stamp_duty"]) == 0

    def test_overtime_and_late_from_attendance_follow_the_settings(self, superclient, emp, db):
        from app.modules.attendance.models import Attendance
        db.add(Attendance(employee_id=emp.employee_id, branch_code="MAIN", date=FIRST, work_mins=600, ot_mins=120, late_mins=60))
        db.flush()
        _profile(superclient, emp, 120000)                       # hourly = 120000 / 240 = 500
        s = superclient.get(f"{HR}/payroll-settings").json()
        assert superclient.put(f"{HR}/payroll-settings", json={**s, "deduct_late": True}).status_code == 200
        r = _rec(_run(superclient), emp)
        assert D(r["ot_hours"]) == 2 and D(r["add_overtime"]) == D("1500.00")     # 2 h x 500 x 1.5
        assert D(r["less_late_deductions"]) == D("500.00")                          # 1 h at the plain rate
        assert D(r["epf_earnings"]) == D("119500.00")                               # OT is not EPF earnings; late cut is

    def test_overtime_can_be_switched_off_per_employee(self, superclient, emp, db):
        from app.modules.attendance.models import Attendance
        db.add(Attendance(employee_id=emp.employee_id, branch_code="MAIN", date=FIRST, work_mins=600, ot_mins=120))
        emp.overtime_eligible = False
        db.flush()
        _profile(superclient, emp, 120000)
        assert D(_rec(_run(superclient), emp)["add_overtime"]) == 0

    def test_settings_validation(self, superclient):
        s = superclient.get(f"{HR}/payroll-settings").json()
        assert superclient.put(f"{HR}/payroll-settings", json={**s, "epf_employee_rate": 150}).status_code == 422
        assert superclient.put(f"{HR}/payroll-settings", json={**s, "ot_divisor": 10}).status_code == 422


class TestSalaryRevisions:
    def test_payroll_uses_the_salary_in_force_at_month_end(self, superclient, emp):
        p = _profile(superclient, emp, 100000, effective_from_date=(FIRST - timedelta(days=60)).isoformat())
        nxt = (FIRST + timedelta(days=32)).replace(day=1)
        body = {"employee_id": emp.employee_id, "basic_salary": 150000, "allowances": [], "effective_from_date": nxt.isoformat(),
                "revision_reason": "increment"}
        assert superclient.put(f"{HR}/salary-profiles/{p['id']}", json=body).status_code == 200
        revs = superclient.get(f"{HR}/employees/{emp.employee_id}/salary-revisions").json()
        assert [r["reason"] for r in revs] == ["increment", "joining"] and D(revs[0]["change"]) == D("50000")
        assert D(_rec(_run(superclient), emp)["basic_salary"]) == D("100000.00")   # the raise starts next month

    def test_unchanged_pay_adds_no_revision(self, superclient, emp):
        p = _profile(superclient, emp, 100000, effective_from_date=(FIRST - timedelta(days=60)).isoformat())
        body = {"employee_id": emp.employee_id, "basic_salary": 100000, "allowances": [], "designation": "Clerk",
                "effective_from_date": FIRST.isoformat()}
        assert superclient.put(f"{HR}/salary-profiles/{p['id']}", json=body).status_code == 200
        assert len(superclient.get(f"{HR}/employees/{emp.employee_id}/salary-revisions").json()) == 1


class TestLoans:
    def _loan(self, c, e, amount=30000, installments=3, **kw):
        r = c.post(f"{HR}/loans", json={"employee_pk": e.id, "amount": amount, "installments": installments,
                                        "issue_date": TODAY.isoformat(), "start_period": FIRST.strftime("%Y-%m"), **kw})
        assert r.status_code == 201, r.text
        return r.json()

    def test_instalment_is_recovered_and_a_cancelled_batch_gives_it_back(self, superclient, emp):
        _profile(superclient, emp, 100000)
        loan = self._loan(superclient, emp)
        assert loan["installment_amount"] == "10000.00" or D(loan["installment_amount"]) == 10000
        batch = _run(superclient)
        assert D(_rec(batch, emp)["less_loan_repayment"]) == D("10000.00")
        assert D(superclient.get(f"{HR}/loans/{loan['id']}").json()["balance"]) == D("20000")
        assert superclient.post(f"{HR}/loans/{loan['id']}/cancel").status_code == 400          # instalment held by a batch
        assert superclient.post(f"{HR}/payroll/batches/{batch['id']}/cancel").status_code == 200
        assert D(superclient.get(f"{HR}/loans/{loan['id']}").json()["balance"]) == D("30000")
        assert superclient.post(f"{HR}/loans/{loan['id']}/cancel").json()["status"] == "cancelled"

    def test_recovery_never_makes_net_pay_negative(self, superclient, emp):
        _profile(superclient, emp, 30000)
        self._loan(superclient, emp, amount=100000, installments=1)
        r = _rec(_run(superclient), emp)
        assert D(r["net_salary"]) == 0 and D(r["less_loan_repayment"]) > 0

    def test_cash_repayment_settles_the_loan(self, superclient, emp):
        loan = self._loan(superclient, emp, amount=5000, installments=1)
        assert superclient.post(f"{HR}/loans/{loan['id']}/repay", json={"amount": 6000}).status_code == 400
        done = superclient.post(f"{HR}/loans/{loan['id']}/repay", json={"amount": 5000, "payment_method": "cash"}).json()
        assert done["status"] == "settled" and D(done["balance"]) == 0

    @pytest.mark.parametrize("patch", [{"amount": 0}, {"installments": 0}, {"installment_amount": 50000},
                                       {"start_period": "2000-01"}, {"loan_type": "gift"}])
    def test_validation(self, superclient, emp, patch):
        body = {"employee_pk": emp.id, "amount": 30000, "installments": 3, "issue_date": TODAY.isoformat(),
                "start_period": FIRST.strftime("%Y-%m"), **patch}
        assert superclient.post(f"{HR}/loans", json=body).status_code == 422

    def test_loans_need_the_deduction_permission(self, api, make_user):
        _, tok = make_user(permissions=[("hr_dashboard", "view")])
        assert api(tok).get(f"{HR}/loans").status_code == 403


class TestReturnsAndSettlement:
    def test_epf_etf_apit_and_bank_returns(self, superclient, emp):
        _profile(superclient, emp, 300000, [{"name": "BRA", "amount": 3500, "epf_liable": True, "taxable": True}])
        batch = _run(superclient)
        epf = superclient.get(f"{HR}/payroll/batches/{batch['id']}/returns/epf").json()
        row = next(r for r in epf["rows"] if r["nic"] == emp.nic)
        assert row["member_no"] == "EPF-77" and D(row["earnings"]) == D("303500") and D(row["total"]) == D("303500") * D("0.20")
        etf = superclient.get(f"{HR}/payroll/batches/{batch['id']}/returns/etf").json()
        assert D(next(r for r in etf["rows"] if r["nic"] == emp.nic)["contribution"]) == D("9105.00")
        apit = superclient.get(f"{HR}/payroll/batches/{batch['id']}/returns/apit").json()
        assert D(next(r for r in apit["rows"] if r["nic"] == emp.nic)["apit"]) > 0
        bank = superclient.get(f"{HR}/payroll/batches/{batch['id']}/returns/bank").json()
        assert next(r for r in bank["rows"] if r["nic"] == emp.nic)["account_no"] == "000111222"
        csv = superclient.get(f"{HR}/payroll/batches/{batch['id']}/returns/epf/csv")
        assert csv.status_code == 200 and csv.headers["content-type"].startswith("text/csv") and "EPF-77" in csv.text
        assert superclient.get(f"{HR}/payroll/batches/{batch['id']}/returns/xyz").status_code == 422

    def test_gratuity_after_five_years_and_loans_owed(self, superclient, emp, db):
        emp.date_of_joining = TODAY.replace(year=TODAY.year - 6) - timedelta(days=1)
        db.flush()
        _profile(superclient, emp, 100000, [{"name": "BRA", "amount": 3500, "epf_liable": True, "taxable": True}],
                 effective_from_date=(TODAY - timedelta(days=30)).isoformat())
        superclient.post(f"{HR}/loans", json={"employee_pk": emp.id, "amount": 20000, "installments": 4,
                                              "issue_date": TODAY.isoformat(), "start_period": FIRST.strftime("%Y-%m")})
        fs = superclient.get(f"{HR}/employees/{emp.id}/final-settlement").json()
        assert fs["completed_years"] == 6 and fs["gratuity_eligible"]
        assert D(fs["gratuity"]) == D("310500.00")              # 103,500 / 2 x 6
        assert D(fs["loans_owed"]) == D("20000") and D(fs["net_settlement"]) == D("290500.00")

    def test_no_gratuity_before_five_years(self, superclient, emp, db):
        emp.date_of_joining = TODAY.replace(year=TODAY.year - 4)
        db.flush()
        _profile(superclient, emp, 100000)
        fs = superclient.get(f"{HR}/employees/{emp.id}/final-settlement").json()
        assert not fs["gratuity_eligible"] and D(fs["gratuity"]) == 0


class TestPayslip:
    def test_payslip_lists_allowances_overtime_and_employer_contributions(self, superclient, emp):
        _profile(superclient, emp, 100000, [{"name": "BRA", "amount": 3500, "epf_liable": True, "taxable": True}])
        rec = _rec(_run(superclient), emp)
        r = superclient.get(f"/api/v1/reporting/documents/payslip/{rec['id']}")
        assert r.status_code == 200, r.text[:300]
        assert "PAYSLIP" in r.text and "BRA" in r.text and "ETF employer contribution" in r.text
        assert superclient.get("/api/v1/reporting/documents/payslip/2147483000").status_code == 404

    def test_payslip_needs_payroll_view(self, api, make_user, superclient, emp):
        _profile(superclient, emp, 100000)
        rec = _rec(_run(superclient), emp)
        _, tok = make_user(permissions=[("hr_dashboard", "view")])
        assert api(tok).get(f"/api/v1/reporting/documents/payslip/{rec['id']}").status_code == 403


class TestPayrollToLedger:
    def test_loan_overtime_and_nopay_post_to_the_right_accounts(self, superclient, emp, db):
        """HR -> Finance: issuing a loan debits Employee Advances; the payroll payment credits it with the
        instalment, books salary expense net of no-pay, and the whole thing balances."""
        from app.modules.attendance.models import Attendance, Leaves
        from tests.money_invariants import Books
        books = Books(db)
        start = FIRST
        while start.weekday() >= 5:
            start += timedelta(days=1)
        db.add(Leaves(employee_id=emp.employee_id, leave_type="unpaid", from_date=start, to_date=start, leave_reason="r",
                      leave_duration=1, leave_time="FULL DAY", status="approved"))
        db.add(Attendance(employee_id=emp.employee_id, branch_code="MAIN", date=FIRST, work_mins=600, ot_mins=120))
        db.flush()
        _profile(superclient, emp, 120000, [{"name": "BRA", "amount": 3500, "epf_liable": True, "taxable": True}])
        loan = superclient.post(f"{HR}/loans", json={"employee_pk": emp.id, "amount": 30000, "installments": 3, "payment_method": "cash",
                                                     "issue_date": TODAY.isoformat(), "start_period": FIRST.strftime("%Y-%m")}).json()
        assert books.entries_for("EmployeeLoan", loan["id"]).get("1130") == (D("30000.00"), D("0"))
        batch = _run(superclient)
        rec = _rec(batch, emp)
        assert D(rec["less_loan_repayment"]) == D("10000.00") and D(rec["less_nopay"]) > 0 and D(rec["add_overtime"]) > 0
        for step in ("submit", "approve"):
            assert superclient.post(f"{HR}/payroll/batches/{batch['id']}/{step}", json={}).status_code == 200
        assert superclient.post(f"{HR}/payroll/batches/{batch['id']}/process-payment", json={"payment_method": "bank_transfer"}).status_code == 200
        je = books.entries_for("PayrollBatch", batch["id"])
        gross = sum(D(r["gross_salary"]) for r in batch["payroll_records"])
        nopay = sum(D(r["less_nopay"] or 0) for r in batch["payroll_records"])
        loans = sum(D(r["less_loan_repayment"] or 0) for r in batch["payroll_records"])
        assert je["5110"][0] == gross - nopay, (je, gross, nopay)          # no-pay is pay not earned
        assert je["1130"][1] == loans                                        # instalments clear Employee Advances
        assert je.get("2140", (D(0), D(0)))[1] == sum(D(r["less_stamp_duty"] or 0) for r in batch["payroll_records"])
        books.assert_balanced("payroll with loan, overtime and no-pay")
