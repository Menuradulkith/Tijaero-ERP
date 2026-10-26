"""Restore the cashbook SQL objects on databases that never got them

Revision ID: s101_restore_cashbook_objects
Revises: s100_supplier_advances_asset
Create Date: 2026-10-24

A database built with ``Base.metadata.create_all`` and then stamped has the
``cashbook_entries`` table but none of the SQL from a1b2c3d4e5f6:
``fn_insert_cashbook_entry`` and the ``trg_cashbook_*`` trigger functions and
triggers. The cashbook stays empty, and every Python caller of
``fn_insert_cashbook_entry`` (supplier advance returns, ...) fails.

This re-runs that migration's function and trigger SQL (CREATE OR REPLACE;
triggers dropped first so it is idempotent), backfills only when the cashbook
is empty, then re-applies the later function fixes (20260607_fix_ccs, s96) so
the functions end at their current versions. On a database that already has
everything it is a no-op apart from replacing functions with themselves.
"""
import importlib.util
import os
import re

from alembic import op
import sqlalchemy as sa

revision = 's101_restore_cashbook_objects'
down_revision = 's100_supplier_advances_asset'
branch_labels = None
depends_on = None

_HERE = os.path.dirname(__file__)


def _load(filename):
    spec = importlib.util.spec_from_file_location(f"_s101_{filename[:-3]}", os.path.join(_HERE, filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _ReplayOp:
    """Forwards a1b2c3d4e5f6's SQL, skipping what already exists."""

    def __init__(self, backfill: bool):
        self.backfill = backfill

    def create_table(self, *args, **kwargs):  # the table exists (create_all)
        pass

    def create_index(self, *args, **kwargs):
        pass

    # Schema drift since a1b2c3d4e5f6 (same corrections s96 made to the
    # supplier trigger functions): the table is "supplier", its name column
    # "company_name".
    _DRIFT = (
        ("COALESCE(full_name, company_name)", "company_name"),
        ("JOIN suppliers s ON", "JOIN supplier s ON"),
    )

    def execute(self, sql):
        text_sql = str(sql)
        for old, new in self._DRIFT:
            text_sql = text_sql.replace(old, new)
        sql = text_sql
        trigger = re.search(r"CREATE\s+TRIGGER\s+(\w+)\s+.*?\bON\s+(\w+)", text_sql, re.S | re.I)
        if trigger:
            op.execute(f"DROP TRIGGER IF EXISTS {trigger.group(1)} ON {trigger.group(2)};")
        elif "DO $$" in text_sql and not self.backfill:
            return
        op.execute(sql)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.execute(sa.text("SELECT to_regclass('cashbook_entries')")).scalar() is None:
        return  # a1b2c3d4e5f6 has not run its table yet; nothing to restore
    empty = bind.execute(sa.text("SELECT NOT EXISTS (SELECT 1 FROM cashbook_entries)")).scalar()

    # fn_insert_cashbook_entry lists only its own columns; a create_all-built
    # table (plus the later audit columns) has NOT NULL columns without the
    # defaults a1b2c3d4e5f6 gave them, which makes every insert fail.
    for column, default in (
        ("created_at", "now()"), ("updated_at", "now()"), ("money_in", "0"),
        ("money_out", "0"), ("running_balance", "0"), ("is_reversal", "false"),
    ):
        has_default = bind.execute(sa.text(
            "SELECT column_default IS NOT NULL FROM information_schema.columns "
            "WHERE table_name = 'cashbook_entries' AND column_name = :c"
        ), {"c": column}).scalar()
        if has_default is False:
            op.execute(f"ALTER TABLE cashbook_entries ALTER COLUMN {column} SET DEFAULT {default}")

    original = _load("a1b2c3d4e5f6_create_materialized_cashbook_entries.py")
    original.op = _ReplayOp(backfill=bool(empty))
    original.upgrade()

    for later in ("20260607_fix_cashbook_credit_settlement_time_and_format.py", "s96_fix_supplier_cashbook.py"):
        _load(later).upgrade()


def downgrade() -> None:
    # Nothing to undo: the objects belong to a1b2c3d4e5f6 and its fixes.
    pass
