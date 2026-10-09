"""Case-insensitive uniqueness for role names and permissions

Revision ID: s82_roles_unique_ci
Revises: s81_branch_structured_address
Create Date: 2026-10-08

The API now compares role names and (resource, action) pairs ignoring case and
surrounding whitespace; these indexes make the database enforce the same rule
so two concurrent requests cannot both succeed.

Fails if existing rows already collide (e.g. "Admin" and "admin ") — clean those
up first.
"""
from alembic import op

revision = 's82_roles_unique_ci'
down_revision = 's81_branch_structured_address'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE UNIQUE INDEX uq_auth_group_name_ci ON auth_group (lower(btrim(name)))")
    op.execute(
        "CREATE UNIQUE INDEX uq_auth_permission_resource_action_ci "
        "ON auth_permission (lower(btrim(resource)), lower(btrim(action)))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_auth_permission_resource_action_ci")
    op.execute("DROP INDEX IF EXISTS uq_auth_group_name_ci")
