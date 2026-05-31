"""
QA suite — Attendance & Products (remaining business-logic modules).

Attendance:
    * Time-calculation engine (_calc_minutes): late, early, OT computation
    * Check-in / check-out flows (duplicate prevention, requires check-in first)
    * Leave approval state machine (pending -> approved | rejected)
    * Leave balance tracking (deductions from approved leaves)
    * Edit/delete guards on leaves

Products:
    * Price validation (selling >= cost, website >= cost)
    * Minimum price guard (min price >= cost)
    * Duplicate item_code rejected
"""

from __future__ import annotations

import uuid
from datetime import date, time
from decimal import Decimal

import pytest

from app.modules.attendance import schemas as att_schemas
from app.modules.attendance.service import AttendanceService, LeaveService
from app.modules.products.service import product_service, minimum_price_service


def _uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


# --------------------------------------------------------------------------- #
# Attendance — time calculations
# --------------------------------------------------------------------------- #
class TestAttendanceCalc:
    """Unit-test the _calc_minutes helper directly (no DB needed beyond service init)."""

    def test_normal_day_no_ot(self, db):
        svc = AttendanceService(db)
        # 09:00 to 17:00 = 480 mins = exactly WORK_DAY_MINUTES, 0 OT
        result = svc._calc_minutes(time(9, 0), time(17, 0))
        assert result["work_mins"] == 480
        assert result["ot_mins"] == 0
        assert result["late_mins"] == 0
        assert result["early_mins"] == 0

    def test_overtime(self, db):
        svc = AttendanceService(db)
        # 09:00 to 19:00 = 600 mins, OT = 600-480 = 120
        result = svc._calc_minutes(time(9, 0), time(19, 0))
        assert result["work_mins"] == 600
        assert result["ot_mins"] == 120

    def test_late_arrival(self, db):
        svc = AttendanceService(db)
        # 09:30 -> 30 mins late (past 10 min grace)
        result = svc._calc_minutes(time(9, 30), time(17, 0))
        assert result["late_mins"] == 30

    def test_within_grace_not_late(self, db):
        svc = AttendanceService(db)
        # 09:10 -> exactly at grace boundary, should NOT be late
        result = svc._calc_minutes(time(9, 10), time(17, 0))
        assert result["late_mins"] == 0

    def test_early_departure(self, db):
        svc = AttendanceService(db)
        # Leave at 16:00 -> 60 mins early
        result = svc._calc_minutes(time(9, 0), time(16, 0))
        assert result["early_mins"] == 60

    def test_no_checkout_zero_work(self, db):
        svc = AttendanceService(db)
        result = svc._calc_minutes(time(9, 0), None)
        assert result["work_mins"] == 0
        assert result["ot_mins"] == 0


# --------------------------------------------------------------------------- #
# Attendance — check-in / check-out flow
# --------------------------------------------------------------------------- #
class TestCheckInOut:
    def test_check_in_then_out(self, db, make_employee, make_branch):
        emp = make_employee()
        branch = make_branch()
        svc = AttendanceService(db)
        ci = svc.check_in(
            att_schemas.AttendanceCheckIn(
                employee_id=emp.employee_id,
                branch_code=branch.branch_code,
                check_in=time(9, 0),
            ),
            user_id=1,
        )
        assert ci.check_in == time(9, 0)
        # After check-in only (no check-out), work_mins=0 so status shows 'absent'
        # Status becomes 'present' only after check-out computes work_mins>0

        co = svc.check_out(
            att_schemas.AttendanceCheckOut(
                employee_id=emp.employee_id,
                check_out=time(17, 30),
            ),
            user_id=1,
        )
        assert co.check_out == time(17, 30)
        assert co.work_mins == 510  # 8.5h
        assert co.ot_mins == 30

    def test_duplicate_check_in_rejected(self, db, make_employee, make_branch):
        from fastapi import HTTPException

        emp = make_employee()
        branch = make_branch()
        svc = AttendanceService(db)
        svc.check_in(
            att_schemas.AttendanceCheckIn(
                employee_id=emp.employee_id,
                branch_code=branch.branch_code,
                check_in=time(9, 0),
            ),
            user_id=1,
        )
        with pytest.raises(HTTPException) as exc:
            svc.check_in(
                att_schemas.AttendanceCheckIn(
                    employee_id=emp.employee_id,
                    branch_code=branch.branch_code,
                    check_in=time(9, 5),
                ),
                user_id=1,
            )
        assert exc.value.status_code == 400

    def test_checkout_without_checkin_rejected(self, db, make_employee):
        from fastapi import HTTPException

        emp = make_employee()
        svc = AttendanceService(db)
        with pytest.raises(HTTPException) as exc:
            svc.check_out(
                att_schemas.AttendanceCheckOut(
                    employee_id=emp.employee_id,
                    check_out=time(17, 0),
                ),
                user_id=1,
            )
        assert exc.value.status_code == 404


# --------------------------------------------------------------------------- #
# Leaves — state machine
# --------------------------------------------------------------------------- #
class TestLeaveWorkflow:
    def _create_leave(self, db, emp, user_id=1):
        svc = LeaveService(db)
        return svc.create(
            att_schemas.LeaveCreate(
                employee_id=emp.employee_id,
                leave_type="annual",
                from_date=date(2026, 6, 1),
                to_date=date(2026, 6, 2),
                leave_reason="Vacation",
                leave_duration=2,
            ),
            user_id=user_id,
        )

    def test_create_leave_pending(self, db, make_employee, make_user):
        user, _ = make_user()
        emp = make_employee(user=user)
        lv = self._create_leave(db, emp, user_id=user.id)
        assert lv.status == "pending"
        assert lv.approval_id is not None

    def test_approve_leave(self, db, make_employee, make_user):
        user, _ = make_user()
        emp = make_employee(user=user)
        approver, _ = make_user()
        lv = self._create_leave(db, emp, user_id=user.id)
        svc = LeaveService(db)
        approved = svc.approve(lv.id, att_schemas.LeaveApprove(remarks="OK"), approver_id=approver.id)
        assert approved.status == "approved"
        assert approved.approved_by == approver.id

    def test_reject_leave(self, db, make_employee, make_user):
        user, _ = make_user()
        emp = make_employee(user=user)
        approver, _ = make_user()
        lv = self._create_leave(db, emp, user_id=user.id)
        svc = LeaveService(db)
        rejected = svc.reject(
            lv.id, att_schemas.LeaveReject(rejection_reason="No coverage"), approver_id=approver.id
        )
        assert rejected.status == "rejected"
        assert rejected.rejection_reason == "No coverage"

    def test_cannot_approve_twice(self, db, make_employee, make_user):
        from fastapi import HTTPException

        user, _ = make_user()
        emp = make_employee(user=user)
        approver, _ = make_user()
        lv = self._create_leave(db, emp, user_id=user.id)
        svc = LeaveService(db)
        svc.approve(lv.id, att_schemas.LeaveApprove(), approver_id=approver.id)
        with pytest.raises(HTTPException) as exc:
            svc.approve(lv.id, att_schemas.LeaveApprove(), approver_id=approver.id)
        assert exc.value.status_code == 400

    def test_cannot_delete_approved(self, db, make_employee, make_user):
        from fastapi import HTTPException

        user, _ = make_user()
        emp = make_employee(user=user)
        approver, _ = make_user()
        lv = self._create_leave(db, emp, user_id=user.id)
        svc = LeaveService(db)
        svc.approve(lv.id, att_schemas.LeaveApprove(), approver_id=approver.id)
        with pytest.raises(HTTPException) as exc:
            svc.delete(lv.id)
        assert exc.value.status_code == 400

    def test_cannot_edit_after_approval(self, db, make_employee, make_user):
        from fastapi import HTTPException

        user, _ = make_user()
        emp = make_employee(user=user)
        approver, _ = make_user()
        lv = self._create_leave(db, emp, user_id=user.id)
        svc = LeaveService(db)
        svc.approve(lv.id, att_schemas.LeaveApprove(), approver_id=approver.id)
        with pytest.raises(HTTPException) as exc:
            svc.update(lv.id, att_schemas.LeaveUpdate(leave_reason="changed"))
        assert exc.value.status_code == 400


# --------------------------------------------------------------------------- #
# Leave balance
# --------------------------------------------------------------------------- #
class TestLeaveBalance:
    def test_fresh_employee_full_balance(self, db, make_employee, make_user):
        user, _ = make_user()
        emp = make_employee(user=user)
        svc = LeaveService(db)
        bal = svc.balance(emp.employee_id, year=2026)
        assert bal.annual_remaining == 14
        assert bal.casual_remaining == 7
        assert bal.medical_remaining == 7

    def test_approved_leave_deducted(self, db, make_employee, make_user):
        user, _ = make_user()
        emp = make_employee(user=user)
        approver, _ = make_user()
        svc = LeaveService(db)
        lv = svc.create(
            att_schemas.LeaveCreate(
                employee_id=emp.employee_id,
                leave_type="annual",
                from_date=date(2026, 3, 1),
                to_date=date(2026, 3, 3),
                leave_reason="Trip",
                leave_duration=3,
            ),
            user_id=user.id,
        )
        svc.approve(lv.id, att_schemas.LeaveApprove(), approver_id=approver.id)
        bal = svc.balance(emp.employee_id, year=2026)
        assert bal.annual_used == 3
        assert bal.annual_remaining == 11

    def test_rejected_leave_not_deducted(self, db, make_employee, make_user):
        user, _ = make_user()
        emp = make_employee(user=user)
        approver, _ = make_user()
        svc = LeaveService(db)
        lv = svc.create(
            att_schemas.LeaveCreate(
                employee_id=emp.employee_id,
                leave_type="casual",
                from_date=date(2026, 4, 1),
                to_date=date(2026, 4, 1),
                leave_reason="Personal",
                leave_duration=1,
            ),
            user_id=user.id,
        )
        svc.reject(lv.id, att_schemas.LeaveReject(rejection_reason="N/A"), approver_id=approver.id)
        bal = svc.balance(emp.employee_id, year=2026)
        assert bal.casual_used == 0
        assert bal.casual_remaining == 7


# --------------------------------------------------------------------------- #
# Products — price validation guards
# --------------------------------------------------------------------------- #
class TestProductPriceValidation:
    def test_selling_price_below_cost_rejected(self, db, make_product):
        from fastapi import HTTPException
        from app.modules.products import schemas as prod_schemas

        product = make_product(cost_price=500)
        with pytest.raises(HTTPException) as exc:
            product_service.update_product(
                db,
                product.id,
                prod_schemas.ProductUpdate(selling_price=300),
                user_id=1,
            )
        assert exc.value.status_code == 400
        assert "cost price" in exc.value.detail.lower()

    def test_website_price_below_cost_rejected(self, db, make_product):
        from fastapi import HTTPException
        from app.modules.products import schemas as prod_schemas

        product = make_product(cost_price=500)
        with pytest.raises(HTTPException) as exc:
            product_service.update_product(
                db,
                product.id,
                prod_schemas.ProductUpdate(website_price=300),
                user_id=1,
            )
        assert exc.value.status_code == 400
        assert "cost price" in exc.value.detail.lower()

    def test_minimum_price_below_cost_rejected(self, db, make_product):
        from fastapi import HTTPException

        product = make_product(cost_price=500)
        with pytest.raises(HTTPException) as exc:
            minimum_price_service.set_minimum_price(db, product.id, 300)
        assert exc.value.status_code == 400
        assert "cost price" in exc.value.detail.lower()

    def test_minimum_price_above_cost_accepted(self, db, make_product):
        product = make_product(cost_price=500)
        result = minimum_price_service.set_minimum_price(db, product.id, 600)
        assert result is not None

    def test_create_duplicate_item_code_rejected(self, db, make_product):
        from fastapi import HTTPException
        from app.modules.products import schemas as prod_schemas

        product = make_product()
        with pytest.raises(HTTPException) as exc:
            product_service.create_product(
                db,
                prod_schemas.ProductCreate(
                    name="Dup",
                    item_code=product.item_code,
                    item_type="general",
                    cost_price=100,
                    category_id=product.category_id,
                    items_brand_id=product.items_brand_id,
                ),
                user_id=1,
            )
        assert exc.value.status_code == 400
