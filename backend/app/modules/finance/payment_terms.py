"""
Invoice due dates (finance blueprint phase C).

A credit sale stores its due date when it is created: invoice date + the
customer's credit days. Aging and overdue checks read that stored date, so
changing a customer's credit days later does not re-age invoices already
issued. Supplier invoices use the supplier's credit days the same way.
"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy.orm import Session


def term_due_date(invoice_date: date, days: int) -> date:
    return invoice_date + timedelta(days=int(days or 0))


def party_due_date(db: Session, party, invoice_date: date) -> date:
    """Due date for a customer / supplier invoice dated ``invoice_date`` (30 days without a party)."""
    credit_days = getattr(party, "credit_days", None) if party is not None else None
    return term_due_date(invoice_date, 30 if credit_days is None else credit_days)


def invoice_due_date(invoice, customer) -> date:
    """Stored due date of a sales invoice; legacy rows without one fall back to
    invoice date + the customer's credit days."""
    if getattr(invoice, "due_date", None):
        return invoice.due_date
    return term_due_date(invoice.created_date, (getattr(customer, "credit_days", 0) or 0))
