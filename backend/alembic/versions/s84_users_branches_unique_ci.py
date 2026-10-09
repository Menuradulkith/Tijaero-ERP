"""Case-insensitive uniqueness for users, employees and branches

Revision ID: s84_users_branches_unique_ci
Revises: s83_customer_bank_account
Create Date: 2026-10-09

The services compare usernames, emails, employee IDs, branch names and branch
codes ignoring case and surrounding whitespace; these indexes make the database
enforce the same rule so two concurrent requests ("Bob" and "bob ") cannot both
succeed. Blank/NULL emails are excluded (an email is optional).

If existing rows already collide, the upgrade stops with a list of the clashing
values so they can be merged or renamed first.
"""
from alembic import op
from sqlalchemy import text

revision = 's84_users_branches_unique_ci'
down_revision = 's83_customer_bank_account'
branch_labels = None
depends_on = None

# (index name, table, expression, optional WHERE)
_INDEXES = [
    ('uq_accounts_user_username_ci', 'accounts_user', 'lower(btrim(username))', None),
    ('uq_accounts_user_email_ci', 'accounts_user', 'lower(btrim(email))', "email IS NOT NULL AND btrim(email) <> ''"),
    ('uq_accounts_user_employee_id_ci', 'accounts_user', 'lower(btrim(employee_id))', None),
    ('uq_employees_employee_id_ci', 'employees', 'lower(btrim(employee_id))', None),
    ('uq_branches_branch_name_ci', 'branches', 'lower(btrim(branch_name))', None),
    ('uq_branches_branch_code_ci', 'branches', 'lower(btrim(branch_code))', None),
    ('uq_branches_email_ci', 'branches', 'lower(btrim(email))', "email IS NOT NULL AND btrim(email) <> ''"),
]


def upgrade() -> None:
    conn = op.get_bind()
    clashes = []
    for name, table, expr, where in _INDEXES:
        sql = f"SELECT {expr} AS k, count(*) AS n FROM {table}"
        if where:
            sql += f" WHERE {where}"
        sql += f" GROUP BY {expr} HAVING count(*) > 1"
        for key, n in conn.execute(text(sql)).fetchall():
            clashes.append(f"{table}: {key!r} appears {n} times (needed for {name})")
    if clashes:
        raise RuntimeError(
            "Cannot add case-insensitive unique indexes; resolve these duplicates first:\n  " + "\n  ".join(clashes)
        )
    for name, table, expr, where in _INDEXES:
        op.execute(f"CREATE UNIQUE INDEX {name} ON {table} ({expr})" + (f" WHERE {where}" if where else ""))


def downgrade() -> None:
    for name, _table, _expr, _where in reversed(_INDEXES):
        op.execute(f"DROP INDEX IF EXISTS {name}")
