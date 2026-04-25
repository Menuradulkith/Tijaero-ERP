"""Add HR leaves workflow columns and drop unique on employee_id

Revision ID: 20260424_hr_leaves_workflow
Revises: 20260417_adv_po_link
Create Date: 2026-04-24
"""
from alembic import op
import sqlalchemy as sa


revision = "20260424_hr_leaves_workflow"
down_revision = "20260417_adv_po_link"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # 1) Drop unique constraint on leaves.employee_id (was buggy — one leave per employee).
    constraints = inspector.get_unique_constraints("leaves")
    for c in constraints:
        if c["column_names"] == ["employee_id"]:
            op.drop_constraint(c["name"], "leaves", type_="unique")

    # Some older DBs may have it as a unique INDEX rather than constraint
    indexes = inspector.get_indexes("leaves")
    for idx in indexes:
        if idx.get("unique") and idx["column_names"] == ["employee_id"]:
            op.drop_index(idx["name"], table_name="leaves")

    # 2) Make approval_id nullable (we now create approval AFTER the leave row exists).
    op.alter_column("leaves", "approval_id", existing_type=sa.Integer(), nullable=True)

    # 3) Add workflow columns.
    existing_cols = {c["name"] for c in inspector.get_columns("leaves")}
    if "status" not in existing_cols:
        op.add_column(
            "leaves",
            sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        )
        op.create_index("ix_leaves_status", "leaves", ["status"], unique=False)
    if "approved_by" not in existing_cols:
        op.add_column("leaves", sa.Column("approved_by", sa.Integer(), nullable=True))
    if "approved_date" not in existing_cols:
        op.add_column("leaves", sa.Column("approved_date", sa.DateTime(), nullable=True))
    if "rejection_reason" not in existing_cols:
        op.add_column("leaves", sa.Column("rejection_reason", sa.Text(), nullable=True))
    if "created_by" not in existing_cols:
        op.add_column("leaves", sa.Column("created_by", sa.Integer(), nullable=True))
    if "created_at" not in existing_cols:
        op.add_column("leaves", sa.Column("created_at", sa.DateTime(), nullable=True))

    # 4) Add helpful indexes on leaves and attendance.
    existing_lv_idx = {i["name"] for i in inspector.get_indexes("leaves")}
    if "ix_leaves_employee_id" not in existing_lv_idx:
        op.create_index("ix_leaves_employee_id", "leaves", ["employee_id"], unique=False)

    existing_att_idx = {i["name"] for i in inspector.get_indexes("attendance")}
    if "ix_attendance_employee_id" not in existing_att_idx:
        op.create_index("ix_attendance_employee_id", "attendance", ["employee_id"], unique=False)
    if "ix_attendance_branch_code" not in existing_att_idx:
        op.create_index("ix_attendance_branch_code", "attendance", ["branch_code"], unique=False)
    if "ix_attendance_date" not in existing_att_idx:
        op.create_index("ix_attendance_date", "attendance", ["date"], unique=False)


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for name in ("ix_attendance_date", "ix_attendance_branch_code", "ix_attendance_employee_id"):
        try:
            op.drop_index(name, table_name="attendance")
        except Exception:
            pass

    try:
        op.drop_index("ix_leaves_employee_id", table_name="leaves")
    except Exception:
        pass

    cols = {c["name"] for c in inspector.get_columns("leaves")}
    for col in ("created_at", "created_by", "rejection_reason", "approved_date", "approved_by"):
        if col in cols:
            op.drop_column("leaves", col)
    if "status" in cols:
        try:
            op.drop_index("ix_leaves_status", table_name="leaves")
        except Exception:
            pass
        op.drop_column("leaves", "status")

    op.alter_column("leaves", "approval_id", existing_type=sa.Integer(), nullable=False)
    op.create_unique_constraint("uq_leaves_employee_id", "leaves", ["employee_id"])
