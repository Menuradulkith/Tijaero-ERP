from decimal import Decimal
from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.hr import schemas
from app.modules.hr.service import PayrollService
from app.modules.employees.models import EmployeePayroll
from app.modules.hr.service import ReimbursementService, SalaryProfileService
from app.modules.finance.accounting_models import AccountingPeriod, ChartOfAccounts, GeneralLedger, JournalEntry
from app.modules.hr.sales_commission_models import MonthlyBranchSalesSummary, SalesOfficerMonthlyCommission
from app.modules.hr.sales_commission_service import SalesCommissionService
from app.modules.hr import sales_commission_schemas
from app.modules.inventory.models import CompanyAssets
from app.modules.hr.models import PayrollBatch
from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
from app.modules.attendance.service import AttendanceService
from app.modules.attendance import schemas as attendance_schemas


def test_employee_reader_does_not_need_user_admin_access(client, make_user):
    _, token = make_user(permissions=[("employees", "view")])
    response = client.get("/api/v1/employees/", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200


def test_user_reader_cannot_read_employee_records(client, make_user):
    _, token = make_user(permissions=[("users", "view")])
    response = client.get("/api/v1/employees/", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 403


def test_manual_payroll_calculates_totals_on_create_and_update(db, make_employee):
    employee = make_employee()
    service = PayrollService(db)
    payload = schemas.EmployeePayrollCreate(
        employee_id=employee.employee_id, basic_salary=Decimal("100000"),
        add_bonus=Decimal("5000"), less_epf_employee=Decimal("8000"),
        less_apit=Decimal("1000"), epf_employer=Decimal("12000"),
        etf_employer=Decimal("3000"), payroll_month=6, payroll_year=2026,
    )
    payroll = service.create_payroll(payload)
    assert payroll.gross_salary == Decimal("105000")
    assert payroll.total_deductions == Decimal("9000")
    assert payroll.net_salary == Decimal("96000")
    assert payroll.total_employer_cost == Decimal("120000")
    payload.basic_salary = Decimal("110000")
    updated = service.update_payroll(payroll.id, payload)
    assert updated.net_salary == Decimal("106000")


@pytest.mark.parametrize("record_status,batch_no", [
    ("approved", None), ("salary_paid", None), ("completed", None),
    ("draft", "QA-BATCH"),
])
@pytest.mark.parametrize("action", ["update", "delete"])
def test_processed_or_batch_payroll_cannot_be_mutated(
    db, make_employee, record_status, batch_no, action,
):
    employee = make_employee()
    record = EmployeePayroll(
        employee_id=employee.employee_id, basic_salary=Decimal("100000"),
        status=record_status, payroll_batch_no=batch_no,
    )
    db.add(record)
    db.flush()
    service = PayrollService(db)
    with pytest.raises(HTTPException) as error:
        if action == "delete":
            service.delete_payroll(record.id)
        else:
            service.update_payroll(record.id, schemas.EmployeePayrollCreate(
                employee_id=employee.employee_id, basic_salary=Decimal("1"),
            ))
    assert error.value.status_code == 400


def test_employee_reader_receives_display_fields(client, make_employee, make_user):
    employee = make_employee()
    _, token = make_user(permissions=[("employees", "view")])
    response = client.get(f"/api/v1/employees/{employee.id}", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    data = response.json()
    assert data["full_name"] == "Test User"
    assert data["email"] == employee.user.email
    assert "hashed_password" not in data
    assert "user" not in data


@pytest.mark.parametrize("action", ["duplicate_link", "missing_user", "rename_referenced", "delete_referenced"])
def test_employee_invalid_changes_fail_cleanly(superclient, db, make_employee, action):
    employee = make_employee()
    if action == "duplicate_link":
        response = superclient.post("/api/v1/employees/", json={"user_id": employee.user_id, "employee_id": "QA-SECOND-LINK"})
    elif action == "missing_user":
        response = superclient.post("/api/v1/employees/", json={"user_id": 2147483647, "employee_id": "QA-MISSING-USER"})
    else:
        SalaryProfileService(db).create_profile(schemas.EmployeeSalaryProfileCreate(
            employee_id=employee.employee_id, basic_salary=Decimal("100000"),
        ))
        if action == "rename_referenced":
            response = superclient.put(f"/api/v1/employees/{employee.id}", json={"employee_id": "QA-RENAMED"})
        else:
            response = superclient.delete(f"/api/v1/employees/{employee.id}")
    assert response.status_code in (400, 404, 409)


@pytest.mark.parametrize("path,resource", [
    ("payroll", "payroll"), ("payroll/batches", "payroll_processing"),
    ("salary-profiles", "salary_profiles"), ("deductions", "deductions"),
    ("promotions", "promotions"), ("employee-assets", "hr_assets"),
    ("reimbursements", "reimbursements"),
])
def test_hr_read_permissions_are_resource_specific(client, make_user, make_branch, path, resource):
    _, reader_token = make_user(permissions=[(resource, "view")], branches=[make_branch()])
    _, dashboard_token = make_user(permissions=[("hr_dashboard", "view")])
    response = client.get(f"/api/v1/hr/{path}", headers={
        "Authorization": f"Bearer {reader_token}",
    })
    assert response.status_code == 200
    response = client.get(f"/api/v1/hr/{path}", headers={
        "Authorization": f"Bearer {dashboard_token}",
    })
    assert response.status_code == 403


@pytest.mark.parametrize("commission_percentage,commission_amount", [(None, Decimal("2500")), (Decimal("0"), Decimal("0"))])
def test_payroll_batch_lifecycle_and_balanced_postings(db, make_employee, make_user, make_account, make_branch, commission_percentage, commission_amount):
    maker, _ = make_user()
    checker, _ = make_user()
    branch = make_branch()
    officer, _ = make_user(branches=[branch])
    employee = make_employee(user=officer)
    for code in ("5110", "5210", "5220", "2110", "2120", "2130", "2140", "2150", "1020"):
        if not db.query(ChartOfAccounts).filter_by(account_code=code).first():
            account_type = "Expense" if code.startswith("5") else "Liability" if code.startswith("2") else "Asset"
            make_account(code=code, account_type=account_type,
                         normal_balance="Credit" if account_type == "Liability" else "Debit")
    SalaryProfileService(db).create_profile(schemas.EmployeeSalaryProfileCreate(
        employee_id=employee.employee_id, basic_salary=Decimal("100000"), designation="Sales Officer",
    ))
    summary = MonthlyBranchSalesSummary(
        branch_code=branch.branch_code, fiscal_year=2090, fiscal_month=6,
        month_name="June 2090", period_start_date=date(2090, 6, 1),
        period_end_date=date(2090, 6, 30), gross_profit=Decimal("100000"), status="draft",
    )
    db.add(summary)
    db.flush()
    commissions = SalesCommissionService(db)
    commissions.finalize_summary(summary.id, sales_commission_schemas.FinalizeSummaryRequest(), checker.id)
    commission = commissions.calculate_commissions(summary.id, commission_percentage)[0]
    assert commission.individual_commission_amount == commission_amount
    assert commissions.calculate_commissions(summary.id)[0].id == commission.id
    commissions.approve_commission(commission.id, sales_commission_schemas.ApproveCommissionRequest(), checker.id)
    service = PayrollService(db)
    request = schemas.PayrollRunRequest(payroll_month=6, payroll_year=2090, description="QA-payroll")
    batch = service.trigger_payroll_run(request, maker.id)
    record = next(record for record in batch.payroll_records if record.employee_id == employee.employee_id)
    assert record.add_sales_commision == commission_amount
    assert record.net_salary == Decimal("91900") + commission_amount
    assert record.epf_employer == Decimal("12000")
    assert record.etf_employer == Decimal("3000")
    with pytest.raises(HTTPException):
        service.trigger_payroll_run(request, maker.id)
    with pytest.raises(HTTPException):
        service.approve_batch(batch.id, schemas.PayrollBatchApprove(), checker.id)
    assert service.submit_batch(batch.id, maker.id).status == "pending_approval"
    assert service.reject_batch(batch.id, schemas.PayrollBatchReject(rejection_reason="QA-review"), checker.id).status == "draft"
    service.submit_batch(batch.id, maker.id)
    assert service.approve_batch(batch.id, schemas.PayrollBatchApprove(), checker.id).status == "approved"
    payment = schemas.PayrollBatchProcessPayment(payment_date=date(2090, 6, 30), payment_reference="QA-salary")
    assert service.process_salary_payment(batch.id, payment, maker.id).status == "salary_paid"
    paid_commission = db.get(SalesOfficerMonthlyCommission, commission.id)
    db.refresh(paid_commission)
    assert paid_commission.status == "paid"
    assert paid_commission.paid_in_payroll_id == record.id
    with pytest.raises(HTTPException):
        service.process_salary_payment(batch.id, payment, maker.id)
    with pytest.raises(HTTPException):
        service.cancel_batch(batch.id, maker.id)
    statutory = schemas.PayrollBatchProcessStatutory(payment_date=date(2090, 7, 1), epf_reference="QA-EPF", etf_reference="QA-ETF")
    assert service.process_statutory_payment(batch.id, statutory, maker.id).status == "statutory_paid"
    assert service.complete_batch(batch.id, maker.id).status == "completed"
    for reference_type in ("PayrollBatch", "SalaryPayment", "StatutoryPayment"):
        entries = db.query(GeneralLedger).filter_by(reference_type=reference_type, reference_id=batch.id).all()
        assert entries
        assert sum(entry.debit_amount for entry in entries) == sum(entry.credit_amount for entry in entries)
        journal_ids = {entry.journal_entry_id for entry in entries}
        assert len(journal_ids) == 1
        journal = db.get(JournalEntry, journal_ids.pop())
        assert journal.status == "posted"
        assert journal.total_debit == journal.total_credit
    bank = db.query(ChartOfAccounts).filter_by(account_code="1020").one()
    salary_payment = db.query(GeneralLedger).filter_by(
        reference_type="SalaryPayment", reference_id=batch.id, account_id=bank.id,
    ).one()
    assert salary_payment.credit_amount == batch.total_net_salary


@pytest.mark.parametrize("stage", ["salary", "disbursement", "statutory"])
@pytest.mark.parametrize("failure", ["no_entry", "exception", "closed_period"])
def test_payroll_posting_failure_rolls_back_payment(db, make_employee, make_user, make_account, monkeypatch, stage, failure):
    employee = make_employee()
    maker, _ = make_user()
    initial_status = "salary_paid" if stage == "statutory" else "approved"
    for code in ("5110", "5210", "5220", "2110", "2120", "2130", "2140", "1020"):
        if not db.query(ChartOfAccounts).filter_by(account_code=code).first():
            make_account(code=code)
    batch = PayrollBatch(
        batch_no=f"QA-FAIL-{employee.id}", payroll_year=2091, payroll_month=6,
        status=initial_status, total_net_salary=Decimal("90"),
        total_employer_epf=Decimal("12"), total_employer_etf=Decimal("3"),
    )
    db.add(batch)
    db.flush()
    record = EmployeePayroll(
        employee_id=employee.employee_id, payroll_batch_no=batch.batch_no,
        basic_salary=Decimal("100"), gross_salary=Decimal("100"), net_salary=Decimal("90"),
        less_epf_employee=Decimal("8"), less_stamp_duty=Decimal("2"),
        epf_employer=Decimal("12"), etf_employer=Decimal("3"), status=initial_status,
    )
    db.add(record)
    if failure == "closed_period":
        db.add(AccountingPeriod(
            fiscal_year=2091, period_number=6, period_name="QA-closed",
            start_date=date(2091, 6, 1), end_date=date(2091, 6, 30), status="closed",
        ))
    db.commit()
    method = "post_payroll_batch_to_gl" if stage == "salary" else "_create_je_and_post"
    original = getattr(PurchaseExpensePayrollGL, method)

    def fail_posting(service, *args, **kwargs):
        if stage == "disbursement" and kwargs.get("reference_type") != "SalaryPayment":
            return original(service, *args, **kwargs)
        assert kwargs["record_failure"] is False
        if failure == "exception":
            raise RuntimeError("QA-posting-failure")
        return None

    if failure != "closed_period":
        monkeypatch.setattr(PurchaseExpensePayrollGL, method, fail_posting)
    with Session(bind=db.connection(), join_transaction_mode="create_savepoint") as payment_db:
        service = PayrollService(payment_db)
        with pytest.raises(HTTPException) as error:
            if stage != "statutory":
                service.process_salary_payment(batch.id, schemas.PayrollBatchProcessPayment(payment_date=date(2091, 6, 15)), maker.id)
            else:
                service.process_statutory_payment(batch.id, schemas.PayrollBatchProcessStatutory(payment_date=date(2091, 6, 15)), maker.id)
    assert error.value.status_code == 400
    db.refresh(batch)
    db.refresh(record)
    assert batch.status == initial_status
    assert record.status == initial_status
    assert batch.statutory_payment_date is None
    assert db.query(GeneralLedger).filter(
        GeneralLedger.reference_id == batch.id,
        GeneralLedger.reference_type.in_(("PayrollBatch", "SalaryPayment", "StatutoryPayment")),
    ).count() == 0
    if stage != "statutory":
        assert batch.salary_payment_date is None
        assert record.payment_status is None


@pytest.mark.parametrize("path", ["reimbursements", "promotions"])
def test_hr_date_filters_reject_invalid_dates(superclient, path):
    response = superclient.get(f"/api/v1/hr/{path}?date_from=2026-02-30")
    assert response.status_code == 422


@pytest.mark.parametrize("resource", ["promotions", "deductions", "employee-assets", "salary-profiles"])
def test_hr_master_record_crud(superclient, db, make_employee, make_branch, resource):
    employee = make_employee()
    if resource == "promotions":
        payload = {"employee_id": employee.employee_id, "designation": "QA-Officer", "appointed_date": "2026-06-01"}
        field, updated_value = "designation", "QA-Senior Officer"
    elif resource == "deductions":
        payload = {"employee_id": employee.id, "reason": "QA-deduction", "amount": "100.00", "deduction_period": "2026-06"}
        field, updated_value = "reason", "QA-updated deduction"
    elif resource == "salary-profiles":
        payload = {"employee_id": employee.employee_id, "basic_salary": "100000.00", "designation": "QA-Officer"}
        field, updated_value = "designation", "QA-Senior Officer"
    else:
        branch = make_branch()
        asset = CompanyAssets(inventory_no=f"QA-{employee.employee_id}", item="QA-Laptop", branch_code=branch.branch_code)
        db.add(asset)
        db.flush()
        payload = {"employee_id": employee.employee_id, "asset_id": asset.id, "assign_reason": "QA-work"}
        field, updated_value = "revoke_assignment", True
    response = superclient.post(f"/api/v1/hr/{resource}", json=payload)
    assert response.status_code == 201
    record_id = response.json()["id"]
    response = superclient.get(f"/api/v1/hr/{resource}/{record_id}")
    assert response.status_code == 200
    payload[field] = updated_value
    response = superclient.put(f"/api/v1/hr/{resource}/{record_id}", json=payload)
    assert response.status_code == 200
    assert response.json()[field] == updated_value
    response = superclient.delete(f"/api/v1/hr/{resource}/{record_id}")
    assert response.status_code == 204
    response = superclient.get(f"/api/v1/hr/{resource}/{record_id}")
    assert response.status_code == 404


def test_salary_profile_update_validates_employee(db, make_employee):
    employee = make_employee()
    service = SalaryProfileService(db)
    profile = service.create_profile(schemas.EmployeeSalaryProfileCreate(
        employee_id=employee.employee_id, basic_salary=Decimal("100000"),
    ))
    with pytest.raises(HTTPException) as error:
        service.update_profile(profile.id, schemas.EmployeeSalaryProfileCreate(
            employee_id="QA-NONEXISTENT", basic_salary=Decimal("100000"),
        ))
    assert error.value.status_code == 404


def test_salary_profile_update_rejects_duplicate_employee(db, make_employee):
    service = SalaryProfileService(db)
    first_employee = make_employee()
    second_employee = make_employee()
    first = service.create_profile(schemas.EmployeeSalaryProfileCreate(
        employee_id=first_employee.employee_id, basic_salary=Decimal("100000"),
    ))
    service.create_profile(schemas.EmployeeSalaryProfileCreate(
        employee_id=second_employee.employee_id, basic_salary=Decimal("100000"),
    ))
    with pytest.raises(HTTPException) as error:
        service.update_profile(first.id, schemas.EmployeeSalaryProfileCreate(
            employee_id=second_employee.employee_id, basic_salary=Decimal("100000"),
        ))
    assert error.value.status_code == 400


def test_reimbursements_enforce_branch_scope(client, db, make_user, make_branch, make_employee):
    own_branch, other_branch = make_branch(), make_branch()
    employee = make_employee()
    _, token = make_user(permissions=[
        ("reimbursements", "view"), ("reimbursements", "create"),
        ("reimbursements", "update"), ("reimbursements", "delete"),
        ("reimbursement_approvals", "approve"),
    ], branches=[own_branch])
    payload = schemas.ReimbursementCreate(
        employee_id=employee.employee_id, branch_code=other_branch.branch_code,
        claim_date=date(2026, 6, 1), description="QA-cross-branch",
        items=[schemas.ReimbursementItemCreate(expense_type="travel", amount=Decimal("100"))],
    )
    reimbursement = ReimbursementService(db).create_reimbursement(payload, created_by=employee.user_id)
    headers = {"Authorization": f"Bearer {token}"}
    response = client.get("/api/v1/hr/reimbursements", headers=headers)
    assert response.status_code == 200
    assert reimbursement.id not in [record["id"] for record in response.json()]
    response = client.get(f"/api/v1/hr/reimbursements/{reimbursement.id}", headers=headers)
    assert response.status_code == 403
    response = client.post("/api/v1/hr/reimbursements", headers=headers, json=payload.model_dump(mode="json"))
    assert response.status_code == 403
    for action, body in (
        ("approve", {}), ("reject", {"rejection_reason": "QA-denied"}),
        ("verify", {}), ("pay", {"payment_method": "cash", "paid_amount": 100}),
    ):
        response = client.post(f"/api/v1/hr/reimbursements/{reimbursement.id}/{action}", headers=headers, json=body)
        assert response.status_code == 403
    response = client.patch(f"/api/v1/hr/reimbursements/{reimbursement.id}", headers=headers, json={"description": "QA-denied"})
    assert response.status_code == 403
    response = client.delete(f"/api/v1/hr/reimbursements/{reimbursement.id}", headers=headers)
    assert response.status_code == 403
    response = client.get("/api/v1/hr/reimbursements", headers=headers, params={"branch_code": other_branch.branch_code})
    assert response.status_code == 403


def test_attendance_enforces_branch_scope(client, db, make_user, make_branch, make_employee):
    own_branch, other_branch = make_branch(), make_branch()
    employee = make_employee()
    _, token = make_user(permissions=[("attendance", action) for action in ("view", "create", "update", "delete")], branches=[own_branch])
    record = AttendanceService(db).create(attendance_schemas.AttendanceCreate(
        employee_id=employee.employee_id, branch_code=other_branch.branch_code,
        date=date(2026, 6, 1), check_in="09:00", check_out="17:00",
    ))
    headers = {"Authorization": f"Bearer {token}"}
    response = client.get("/api/v1/hr/attendance", headers=headers)
    assert response.status_code == 200
    assert record.id not in [item["id"] for item in response.json()]
    response = client.get("/api/v1/hr/attendance/summary?date_from=2026-06-01&date_to=2026-06-01", headers=headers)
    assert response.status_code == 200
    assert response.json()["total_records"] == 0
    for method, path, body in (
        ("GET", f"attendance/{record.id}", None),
        ("PUT", f"attendance/{record.id}", {"check_out": "18:00"}),
        ("DELETE", f"attendance/{record.id}", None),
        ("POST", "attendance/check-in", {"employee_id": employee.employee_id, "branch_code": own_branch.branch_code, "date": "2026-06-01"}),
        ("POST", "attendance/check-out", {"employee_id": employee.employee_id, "date": "2026-06-01"}),
    ):
        response = client.request(method, f"/api/v1/hr/{path}", headers=headers, json=body)
        assert response.status_code == 403, (method, path, response.json())


def test_leave_approver_can_read_approval_queue(client, make_user):
    _, token = make_user(permissions=[("leave_approvals", "view")])
    response = client.get("/api/v1/hr/leaves?status=pending", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200