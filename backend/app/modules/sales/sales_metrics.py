"""Shared definitions for sales reporting (dashboard statistics, sales report).

A sale only counts once it is a real, approved sale: ``approved`` (credit sale
awaiting settlement) or ``completed``. Cancelled, rejected, pending-approval and
pending-bank-verification orders never produced revenue and are excluded.
Value is the document ``grand_total`` net of processed sale returns - not the
sum of the tender columns, which ignores vouchers and credit notes.
"""
from decimal import Decimal

from sqlalchemy import func, select

from app.modules.sales.models import Invoice, SaleReturn

COUNTED_APPROVAL_STATUSES = ("approved", "completed")


def counted_invoice_filters():
    """SQLAlchemy criteria selecting invoices that count as sales."""
    return (
        Invoice.status == True,  # noqa: E712 - cancelled invoices have status False
        Invoice.approval_status.in_(COUNTED_APPROVAL_STATUSES),
    )


def net_sales_expr():
    """Invoice.grand_total less processed returns (per invoice, summable)."""
    returned = (
        func.coalesce(func.sum(SaleReturn.total_refund), 0)
    )
    returned_sq = (
        select(returned)
        .where(SaleReturn.invoice_id == Invoice.id, SaleReturn.status == "processed")
        .correlate(Invoice)
        .scalar_subquery()
    )
    return Invoice.grand_total - func.coalesce(returned_sq, 0)


def gl_revenue_expr():
    """Revenue of one invoice exactly as ``post_sale_to_gl`` credits it (4010/4020).

    ``invoice.subtotal`` is the net revenue: after line/header discounts and
    coupons, before tax, and GROSS of gift vouchers, credit notes and customer
    advances (those settle the sale; they are not revenue reductions).
    """
    return func.coalesce(Invoice.subtotal, 0)


def gl_return_revenue(sale_return) -> Decimal:
    """Revenue reversed by one processed return, exactly as ``post_sale_return_to_gl``
    debits 4030 Sales Returns: ``total_refund - tax_refund`` (tax ignored when invalid)."""
    total = Decimal(str(sale_return.total_refund or 0))
    tax = Decimal(str(sale_return.tax_refund or 0))
    if total <= 0:
        return Decimal("0")
    if tax < 0 or tax > total:
        tax = Decimal("0")
    return total - tax
