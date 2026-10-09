"""Customers: case/space-insensitive unique identifiers, one primary contact

Revision ID: s88_customer_unique_ci
Revises: s87_customer_country_currency
Create Date: 2026-10-09

Customers had no uniqueness rule at all (eight identical creates → eight rows).
Email, ID card, passport, company registration and tax registration numbers now
identify one customer (ignoring case and surrounding spaces; blanks are not
compared). Customer *names* and mobile numbers are deliberately not unique —
two real customers can share a name, and families/offices share lines.
A customer can also have at most one primary contact person.

The upgrade stops with the list of clashing values if existing data collides.
"""
from alembic import op
from sqlalchemy import text

revision = 's88_customer_unique_ci'
down_revision = 's87_customer_country_currency'
branch_labels = None
depends_on = None

_UNIQUE = [
    ('uq_customers_email_ci', 'email'),
    ('uq_customers_id_card_ci', 'id_card_number'),
    ('uq_customers_passport_ci', 'passport_no'),
    ('uq_customers_company_reg_ci', 'company_registration_number'),
    ('uq_customers_tax_reg_ci', 'tax_registration_number'),
]


def upgrade() -> None:
    conn = op.get_bind()
    problems = []
    for name, col in _UNIQUE:
        rows = conn.execute(text(
            f"select lower(btrim({col})) v, count(*) n from customers "
            f"where {col} is not null and btrim({col}) <> '' group by 1 having count(*) > 1"
        )).fetchall()
        if rows:
            problems.append(f"customers.{col}: " + ", ".join(f"{r.v!r} x{r.n}" for r in rows[:10]))
    rows = conn.execute(text(
        "select customer_id, count(*) n from customer_contact_person where is_primary group by 1 having count(*) > 1"
    )).fetchall()
    if rows:
        # keep the oldest primary, demote the rest (safe, loses no data)
        conn.execute(text(
            "update customer_contact_person c set is_primary = false where is_primary and id <> ("
            "select min(id) from customer_contact_person where customer_id = c.customer_id and is_primary)"
        ))
    if problems:
        raise RuntimeError("Resolve duplicate customer identifiers first:\n  " + "\n  ".join(problems))

    for name, col in _UNIQUE:
        op.execute(
            f"create unique index {name} on customers (lower(btrim({col}))) "
            f"where {col} is not null and btrim({col}) <> ''"
        )
    op.execute("create unique index uq_customer_contact_one_primary on customer_contact_person (customer_id) where is_primary")


def downgrade() -> None:
    op.execute("drop index if exists uq_customer_contact_one_primary")
    for name, _col in reversed(_UNIQUE):
        op.execute(f"drop index if exists {name}")
