"""audit_passcode

Revision ID: s39_audit_passcode
Revises: s38_passcode_login
Create Date: 2026-07-01

"""
from alembic import op
import sqlalchemy as sa


revision = "s39_audit_passcode"
down_revision = "s38_passcode_login"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add created_by and updated_by to user_passcodes
    op.add_column("user_passcodes", sa.Column("created_by", sa.Integer(), nullable=True))
    op.add_column("user_passcodes", sa.Column("updated_by", sa.Integer(), nullable=True))
    
    # Add created_by and updated_by to user_passcode_history
    op.add_column("user_passcode_history", sa.Column("created_by", sa.Integer(), nullable=True))
    op.add_column("user_passcode_history", sa.Column("updated_by", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("user_passcode_history", "updated_by")
    op.drop_column("user_passcode_history", "created_by")
    
    op.drop_column("user_passcodes", "updated_by")
    op.drop_column("user_passcodes", "created_by")
