"""Repository for Attendance and Leaves."""
from __future__ import annotations

from datetime import date
from typing import List, Optional

from sqlalchemy import and_
from sqlalchemy.orm import Session

from .models import Attendance, Leaves


class AttendanceRepository:
    @staticmethod
    def get(db: Session, attendance_id: int) -> Optional[Attendance]:
        return db.query(Attendance).filter(Attendance.id == attendance_id).first()

    @staticmethod
    def get_by_employee_date(db: Session, employee_id: str, day: date) -> Optional[Attendance]:
        return (
            db.query(Attendance)
            .filter(and_(Attendance.employee_id == employee_id, Attendance.date == day))
            .first()
        )

    @staticmethod
    def list(
        db: Session,
        *,
        employee_id: Optional[str] = None,
        branch_code: Optional[str] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        skip: int = 0,
        limit: int = 200,
    ) -> List[Attendance]:
        q = db.query(Attendance)
        if employee_id:
            q = q.filter(Attendance.employee_id == employee_id)
        if branch_code:
            q = q.filter(Attendance.branch_code == branch_code)
        if date_from:
            q = q.filter(Attendance.date >= date_from)
        if date_to:
            q = q.filter(Attendance.date <= date_to)
        return q.order_by(Attendance.date.desc()).offset(skip).limit(limit).all()

    @staticmethod
    def create(db: Session, **data) -> Attendance:
        obj = Attendance(**data)
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    @staticmethod
    def update(db: Session, obj: Attendance, **data) -> Attendance:
        for k, v in data.items():
            if v is not None:
                setattr(obj, k, v)
        db.commit()
        db.refresh(obj)
        return obj

    @staticmethod
    def delete(db: Session, obj: Attendance) -> None:
        db.delete(obj)
        db.commit()


class LeaveRepository:
    @staticmethod
    def get(db: Session, leave_id: int) -> Optional[Leaves]:
        return db.query(Leaves).filter(Leaves.id == leave_id).first()

    @staticmethod
    def list(
        db: Session,
        *,
        employee_id: Optional[str] = None,
        leave_type: Optional[str] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[Leaves]:
        q = db.query(Leaves)
        if employee_id:
            q = q.filter(Leaves.employee_id == employee_id)
        if leave_type:
            q = q.filter(Leaves.leave_type == leave_type)
        if date_from:
            q = q.filter(Leaves.from_date >= date_from)
        if date_to:
            q = q.filter(Leaves.to_date <= date_to)
        return q.order_by(Leaves.id.desc()).offset(skip).limit(limit).all()

    @staticmethod
    def list_by_employee_year(db: Session, employee_id: str, year: int) -> List[Leaves]:
        return (
            db.query(Leaves)
            .filter(
                Leaves.employee_id == employee_id,
                Leaves.from_date >= date(year, 1, 1),
                Leaves.from_date <= date(year, 12, 31),
            )
            .all()
        )

    @staticmethod
    def create(db: Session, **data) -> Leaves:
        obj = Leaves(**data)
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    @staticmethod
    def update(db: Session, obj: Leaves, **data) -> Leaves:
        for k, v in data.items():
            if v is not None:
                setattr(obj, k, v)
        db.commit()
        db.refresh(obj)
        return obj

    @staticmethod
    def delete(db: Session, obj: Leaves) -> None:
        db.delete(obj)
        db.commit()


attendance_repo = AttendanceRepository()
leave_repo = LeaveRepository()
