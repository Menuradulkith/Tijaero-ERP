"""Standard printed documents: the data every document layout prints.

Each builder turns one record (invoice, purchase order, GRN, ...) into a `doc` dict that
the shared layout (templates/standard/document.html) prints the same way for every
document type, as ERP letterheads do (SAP, Odoo, Dynamics, IFS):

    letterhead (logo, company, address, TIN / BRN)  |  title, number, status
    parties (bill to / ship to / supplier / from-to)  |  details (dates, references, terms)
    lines table
    tax summary + amount in words                    |  totals
    payment details, terms, notes, signatures, footer

Figures are taken from what the system stored and posted (subtotal, VAT, grand total,
balances), never recomputed in a different way, so a printout always agrees with the
ledger. A tax invoice follows the Sri Lanka IRD tax-invoice particulars: "TAX INVOICE"
title, supplier and purchaser TIN, invoice number and date, date of supply, value
excluding VAT, VAT and total including VAT.
"""

from __future__ import annotations

from collections import OrderedDict
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Optional

from sqlalchemy.orm import Session

ZERO = Decimal("0")
CENTS = Decimal("0.01")

# Column types the layout knows how to format.
#   text, money, qty, percent, date, int
_STATUS_LABELS = {"pending_approval": "Pending approval", "partially_received": "Partially received"}


def money(value: Any) -> Decimal:
    if value is None:
        return ZERO
    return Decimal(str(value)).quantize(CENTS, rounding=ROUND_HALF_UP)


def _date(value: Any) -> Optional[date]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def label(value: Optional[str]) -> str:
    if not value:
        return ""
    return _STATUS_LABELS.get(value, str(value).replace("_", " ").strip().capitalize())


# --------------------------------------------------------------------------- #
# Amount in words
# --------------------------------------------------------------------------- #
_ONES = ("", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven",
         "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen")
_TENS = ("", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety")
_SCALES = ((10 ** 12, "Trillion"), (10 ** 9, "Billion"), (10 ** 6, "Million"), (10 ** 3, "Thousand"))
_CURRENCY_WORDS = {
    "LKR": ("Rupees", "Cents"), "USD": ("Dollars", "Cents"), "EUR": ("Euros", "Cents"),
    "GBP": ("Pounds", "Pence"), "INR": ("Rupees", "Paise"), "AUD": ("Dollars", "Cents"),
}


def _under_thousand(n: int) -> str:
    words = []
    if n >= 100:
        words.append(f"{_ONES[n // 100]} Hundred")
        n %= 100
        if n:
            words.append("and")
    if n >= 20:
        words.append(_TENS[n // 10] + (f"-{_ONES[n % 10]}" if n % 10 else ""))
    elif n:
        words.append(_ONES[n])
    return " ".join(words)


def number_in_words(n: int) -> str:
    if n == 0:
        return "Zero"
    parts = []
    for scale, name in _SCALES:
        if n >= scale:
            parts.append(f"{number_in_words(n // scale)} {name}")
            n %= scale
    if n:
        if parts and n < 100:
            parts.append("and")
        parts.append(_under_thousand(n))
    return " ".join(parts)


def amount_in_words(amount: Any, currency_code: str = "LKR") -> str:
    """'Rupees One Thousand Two Hundred and Fifty and Cents Fifty Only'."""
    value = money(amount)
    negative = value < 0
    value = abs(value)
    whole = int(value)
    cents = int((value - whole) * 100)
    major, minor = _CURRENCY_WORDS.get((currency_code or "").upper(), (currency_code or "", "Cents"))
    text = f"{major} {number_in_words(whole)}".strip()
    if cents:
        text += f" and {minor} {number_in_words(cents)}"
    return ("Minus " if negative else "") + text + " Only"


# --------------------------------------------------------------------------- #
# Company, branch and parties
# --------------------------------------------------------------------------- #
def lines(*parts: Optional[str]) -> list[str]:
    return [str(p).strip() for p in parts if p and str(p).strip()]


def company_profile(db: Session) -> dict:
    """Company identity printed on every document and report letterhead."""
    from app.modules.settings.models import Currency, Settings

    s = db.query(Settings).first()
    if s is None:
        return {"name": "", "address_lines": [], "currency_code": "LKR", "currency_symbol": "Rs.", "bank": {}}
    currency = db.query(Currency).filter(Currency.code == s.default_currency).first()
    return {
        "name": s.company_name or "",
        "address": s.company_address or "",
        "address_lines": lines(*(s.company_address or "").replace("\r", "").split("\n")),
        "phone": s.company_telephone_number or "",
        "fax": s.company_fax_number or "",
        "email": s.company_email or "",
        "website": s.company_website or "",
        "tax_registration_number": s.tax_registration_number or "",
        "business_registration_number": s.business_registration_number or "",
        "logo": s.company_logo or "",
        "currency_code": currency.code if currency else (s.default_currency or "LKR"),
        "currency_symbol": currency.symbol if currency else "Rs.",
        "bank": {
            "name": s.bank_name or "",
            "branch": s.bank_branch or "",
            "account_name": s.bank_account_name or "",
            "account_number": s.bank_account_number or "",
            "swift_code": s.bank_swift_code or "",
        },
    }


def branch_profile(db: Session, branch_code: Optional[str]) -> dict:
    from app.auth.models import Branch

    b = db.query(Branch).filter(Branch.branch_code == branch_code).first() if branch_code else None
    if b is None:
        return {"code": branch_code or "", "name": branch_code or "", "address_lines": [], "phone": "", "email": ""}
    return {
        "code": b.branch_code,
        "name": b.branch_name or b.branch_code,
        "address_lines": lines(b.address_line1, b.address_line2, ", ".join(lines(b.city, b.state, b.postal_code))) or lines(b.address),
        "phone": b.contact_number or "",
        "email": b.email or "",
    }


def customer_party(customer, title: str = "Bill to", shipping: bool = False) -> Optional[dict]:
    if customer is None:
        return None
    if shipping:
        addr = lines(customer.shipping_address_line1, customer.shipping_address_line2,
                     ", ".join(lines(customer.shipping_city, customer.shipping_state, customer.shipping_postal_code))) \
            or lines(customer.delivery_address)
    else:
        addr = lines(customer.billing_address_line1, customer.billing_address_line2,
                     ", ".join(lines(customer.billing_city, customer.billing_state, customer.billing_postal_code))) \
            or lines(customer.payment_address)
    name = customer.company_name or customer.customer_name
    attention = customer.customer_name if customer.company_name and customer.customer_name != customer.company_name else None
    return {
        "title": title,
        "name": name,
        "attention": attention,
        "code": customer.customer_no or "",
        "lines": addr,
        "phone": " / ".join(lines(customer.mobile_contact_number, customer.home_contact_number)),
        "email": customer.email or "",
        "tax_no": customer.tax_registration_number or "",
    }


def _shipping_differs(customer) -> bool:
    return bool(customer and (customer.shipping_address_line1 or customer.delivery_address)) and (
        (customer.shipping_address_line1 or customer.delivery_address or "").strip()
        != (customer.billing_address_line1 or customer.payment_address or "").strip()
    )


def supplier_party(supplier, title: str = "Supplier") -> Optional[dict]:
    if supplier is None:
        return None
    return {
        "title": title,
        "name": supplier.company_name,
        "attention": None,
        "code": supplier.supplier_no or "",
        "lines": lines(supplier.billing_address_line1, supplier.billing_address_line2,
                       ", ".join(lines(supplier.billing_city, supplier.billing_state, supplier.billing_postal_code))),
        "phone": " / ".join(lines(supplier.mobile_contact_number, supplier.home_contact_number)),
        "email": supplier.email or "",
        "tax_no": supplier.tax_registration_number or "",
    }


def branch_party(branch: dict, title: str) -> dict:
    return {"title": title, "name": branch["name"], "attention": None, "code": branch["code"],
            "lines": branch["address_lines"], "phone": branch["phone"], "email": branch["email"], "tax_no": ""}


def user_name(db: Session, user_id: Optional[int]) -> str:
    if not user_id:
        return ""
    from app.auth.models import User

    u = db.query(User).filter(User.id == user_id).first()
    if u is None:
        return ""
    return " ".join(lines(u.first_name, u.last_name)) or u.username


def _product_label(product, fallback_id) -> tuple[str, str, str]:
    """(item code, description, unit) for a line."""
    if product is None:
        return "", f"Product #{fallback_id}", ""
    return product.item_code or "", product.name, getattr(product, "unit_of_measure", "") or ""


def _doc(**kw) -> dict:
    base = {
        "title": "", "number": "", "status": None, "meta": [], "parties": [], "columns": [], "lines": [],
        "totals": [], "tax_summary": None, "amount_in_words": None, "sections": [], "notes": [],
        "signatures": [], "currency": "LKR", "show_payment_details": False,
    }
    base.update(kw)
    base["meta"] = [m for m in base["meta"] if m[1] not in (None, "", "N/A")]
    base["parties"] = [p for p in base["parties"] if p]
    base["notes"] = [n for n in base["notes"] if n and n[1]]
    return base


def _total(label_: str, value: Any, strong: bool = False, sign: str = "") -> dict:
    return {"label": label_, "value": money(value), "strong": strong, "sign": sign}


# --------------------------------------------------------------------------- #
# Sales
# --------------------------------------------------------------------------- #
LINE_COLUMNS = [
    {"key": "no", "label": "#", "type": "int", "align": "center"},
    {"key": "code", "label": "Item code", "type": "text"},
    {"key": "description", "label": "Description", "type": "text", "wide": True},
    {"key": "qty", "label": "Qty", "type": "qty", "align": "right"},
    {"key": "unit", "label": "Unit", "type": "text"},
    {"key": "price", "label": "Unit price", "type": "money", "align": "right"},
    {"key": "discount", "label": "Disc. %", "type": "percent", "align": "right"},
    {"key": "amount", "label": "Amount", "type": "money", "align": "right"},
]


def _columns(*keys: str, labels: Optional[dict] = None, extra: Optional[list] = None) -> list[dict]:
    cols = [dict(c) for c in LINE_COLUMNS if c["key"] in keys] + (extra or [])
    order = {k: i for i, k in enumerate(keys)}
    cols.sort(key=lambda c: order.get(c["key"], 99))
    for c in cols:
        if labels and c["key"] in labels:
            c["label"] = labels[c["key"]]
    return cols


def build_invoice(db: Session, invoice, customer, company: dict, show_discount: bool = True) -> dict:
    tax = money(invoice.tax_amount)
    rate = Decimal(str(invoice.tax_rate or 0))
    is_tax = tax > 0 or bool(invoice.is_tax_invoice)

    # One line per product / price / discount / warranty; serial numbers listed under it.
    grouped: "OrderedDict[tuple, dict]" = OrderedDict()
    for it in invoice.items:
        disc = Decimal(str(it.discount_percent or 0)) if show_discount else ZERO
        key = (it.product_id, money(it.selling_price), disc, it.warrenty_month)
        code, desc, unit = _product_label(it.product, it.product_id)
        row = grouped.setdefault(key, {"code": code, "description": desc, "serials": [], "unit": unit,
                                       "warranty": it.warrenty_month, "qty": 0, "price": money(it.selling_price),
                                       "discount": disc if disc else None, "amount": ZERO})
        row["qty"] += it.quantity or 0
        amount = it.line_total if it.line_total is not None else (it.quantity or 0) * (it.selling_price or 0)
        row["amount"] += money(amount)
        if it.barcode:
            row["serials"].append(it.barcode)
    rows = []
    for i, r in enumerate(grouped.values(), start=1):
        details = []
        if r["warranty"] and str(r["warranty"]) not in ("0", ""):
            details.append(f"Warranty: {r['warranty']} months")
        if r["serials"]:
            details.append("S/N: " + ", ".join(r["serials"]))
        rows.append({**r, "no": i, "details": details})
    lines_total = sum((r["amount"] for r in rows), ZERO)

    header_discount = money(invoice.discount_amount)
    coupon = money(invoice.cupon_amount)
    subtotal = money(invoice.subtotal)
    service = money(invoice.service_charge_amount)
    voucher = money(invoice.gift_voucher_amount)
    credit_note = money(invoice.credit_note_amount)
    grand = money(invoice.grand_total)
    total_incl = subtotal + tax + service
    advance = total_incl - voucher - credit_note - grand
    advance = advance if advance >= CENTS else ZERO

    totals = [_total("Lines total", lines_total)]
    if header_discount:
        totals.append(_total("Discount", header_discount, sign="-"))
    if coupon:
        totals.append(_total("Coupon", coupon, sign="-"))
    if is_tax:
        totals.append(_total("Value excluding VAT", subtotal, strong=True))
        totals.append(_total(f"VAT @ {rate.normalize():f}%" if rate else "VAT", tax))
    if service:
        totals.append(_total("Service charge", service))
    totals.append(_total("Total including VAT" if is_tax else "Total", total_incl, strong=True))
    for lbl, val in (("Gift voucher", voucher), ("Credit note", credit_note), ("Advance applied", advance)):
        if val:
            totals.append(_total(lbl, val, sign="-"))
    if voucher or credit_note or advance:
        totals.append(_total("Amount payable", grand, strong=True))
    paid = money(invoice.paid_amount)
    balance = money(invoice.balance_due)
    if paid and balance:
        totals.append(_total("Paid", paid, sign="-"))
    if balance:
        totals.append(_total("Balance due", balance, strong=True))

    tax_summary = [{"rate": rate, "taxable": subtotal, "tax": tax, "total": subtotal + tax}] if is_tax else None

    issued = _date(invoice.created_date)
    credit_days = getattr(customer, "credit_days", None) if customer else None
    is_credit = (invoice.payment_method or "") == "credit" or money(invoice.credit_amount) > 0
    due = issued + timedelta(days=int(credit_days)) if (is_credit and issued and credit_days) else None
    terms = f"Credit, {credit_days} days" if (is_credit and credit_days) else label(invoice.payment_method)

    payments = [(m, money(v)) for m, v in (
        ("Cash", invoice.cash_amount), ("Visa card", invoice.card_visa_amount), ("Mastercard", invoice.card_mastercard_amount),
        ("Amex card", invoice.card_amex_amount), ("Cheque", invoice.cheque_amount), ("Bank transfer", invoice.bank_transfer_amount))
        if v and money(v) > 0]  # the credit part is owed, not received: it shows as Paid / Balance due
    sections = []
    if payments:
        sections.append({"title": "Payment received", "columns": [
            {"key": "method", "label": "Method", "type": "text"}, {"key": "amount", "label": "Amount", "type": "money", "align": "right"}],
            "rows": [{"method": m, "amount": a} for m, a in payments], "compact": True})

    quote_no = None
    if invoice.source_quote_id:
        from app.modules.sales.quotation_models import SalesQuote

        quote_no = db.query(SalesQuote.quote_no).filter(SalesQuote.id == invoice.source_quote_id).scalar()

    parties = [customer_party(customer, "Bill to")]
    if _shipping_differs(customer):
        parties.append(customer_party(customer, "Ship to", shipping=True))
    return _doc(
        key="invoice",
        title="TAX INVOICE" if is_tax else "INVOICE",
        number=invoice.invoice_no,
        status=None if invoice.approval_status in ("approved", "completed") else label(invoice.approval_status),
        currency=company["currency_code"],
        meta=[
            ("Invoice no.", invoice.invoice_no),
            ("Invoice date", issued),
            ("Date of supply", issued),
            ("Payment terms", terms),
            ("Due date", due),
            ("Quotation ref.", quote_no),
            ("Customer code", customer.customer_no if customer else None),
        ],
        parties=parties,
        columns=_columns("no", "code", "description", "qty", "unit", "price", "discount", "amount")
        if show_discount and any(r["discount"] for r in rows)
        else _columns("no", "code", "description", "qty", "unit", "price", "amount"),
        lines=rows,
        totals=totals,
        tax_summary=tax_summary,
        amount_in_words=amount_in_words(grand, company["currency_code"]),
        sections=sections,
        notes=[("Remarks", invoice.remarks)],
        signatures=["Prepared by", "Authorised signature", "Customer's signature"],
        show_payment_details=balance > 0,
    )


def build_quotation(db: Session, quote, customer, company: dict, show_discount: bool = True) -> dict:
    rows = []
    lines_total = ZERO
    for i, it in enumerate(quote.items, start=1):
        code, desc, unit = _product_label(getattr(it, "product", None), it.product_id)
        if not code and it.product_id:
            from app.modules.products.models import Product

            code, desc, unit = _product_label(db.query(Product).filter(Product.id == it.product_id).first(), it.product_id)
        base = money(it.selling_price) * (it.quantity or 0)
        disc = Decimal(str(it.discount_percentage or 0))
        amount = money(base - base * disc / 100)
        lines_total += amount
        details = lines(it.description, f"Warranty: {it.warrenty_month} months" if it.warrenty_month and str(it.warrenty_month) != "0" else None)
        rows.append({"no": i, "code": code, "description": desc, "details": details, "qty": it.quantity, "unit": unit,
                     "price": money(it.selling_price), "discount": disc if (disc and show_discount) else None, "amount": amount})
    if not show_discount:
        for r in rows:
            r["price"] = money(r["amount"] / r["qty"]) if r["qty"] else r["price"]

    disc_type = quote.discount_type or "none"
    disc_value = Decimal(str(quote.discount_percentage or 0))
    header_discount = ZERO
    if disc_value > 0 and lines_total > 0:
        header_discount = money(lines_total * min(disc_value, Decimal("100")) / 100) if disc_type == "percentage" \
            else money(min(disc_value, lines_total)) if disc_type == "fixed" else ZERO
    net = lines_total - header_discount
    rate = Decimal(str(quote.tax_rate or 0))
    mode = quote.tax_mode or "none"
    totals = [_total("Lines total", lines_total)]
    if header_discount:
        totals.append(_total(f"Discount ({disc_value.normalize():f}%)" if disc_type == "percentage" else "Discount", header_discount, sign="-"))
    tax_summary = None
    if mode == "exclusive" and rate > 0:
        tax = money(net * rate / 100)
        totals += [_total("Value excluding VAT", net, strong=True), _total(f"VAT @ {rate.normalize():f}%", tax),
                   _total("Total including VAT", money(quote.total_amount), strong=True)]
        tax_summary = [{"rate": rate, "taxable": net, "tax": tax, "total": net + tax}]
    elif mode == "inclusive" and rate > 0:
        excl = money(net / (1 + rate / 100))
        totals += [_total("Total including VAT", money(quote.total_amount), strong=True)]
        tax_summary = [{"rate": rate, "taxable": excl, "tax": net - excl, "total": net}]
    else:
        totals.append(_total("Total", money(quote.total_amount), strong=True))

    title = "ESTIMATE" if quote.is_estimate else "QUOTATION"
    return _doc(
        key="quotation", title=title, number=quote.quote_no, currency=company["currency_code"],
        status=label(quote.status) if quote.status in ("draft", "cancelled", "revised") else None,
        meta=[
            ("Quotation no.", quote.quote_no),
            ("Date", _date(quote.created_date)),
            ("Valid until", _date(quote.valid_until)),
            ("Expected delivery", _date(quote.expected_delivery_date)),
            ("Revision", f"Rev. {quote.revision_number}" if quote.revision_number else None),
            ("Customer code", customer.customer_no if customer else None),
        ],
        parties=[customer_party(customer, "Quotation for")],
        columns=_columns("no", "code", "description", "qty", "unit", "price", "discount", "amount")
        if show_discount and any(r["discount"] for r in rows)
        else _columns("no", "code", "description", "qty", "unit", "price", "amount"),
        lines=rows, totals=totals, tax_summary=tax_summary,
        amount_in_words=amount_in_words(quote.total_amount, company["currency_code"]),
        notes=[("Notes", quote.customer_notes), ("Remarks", quote.remarks)],
        signatures=["Prepared by", "Authorised signature", "Accepted by (customer)"],
    )


def build_credit_note(db: Session, sale_return, customer, company: dict) -> dict:
    from app.modules.products.models import Product

    rows = []
    for i, it in enumerate(sale_return.items, start=1):
        product = db.query(Product).filter(Product.id == it.product_id).first() if it.product_id else None
        code, desc, unit = _product_label(product, it.product_id)
        qty = it.quantity or 1
        rows.append({"no": i, "code": code, "description": desc, "unit": unit,
                     "details": lines(f"S/N: {it.barcode}" if it.barcode else None,
                                      f"Condition: {label(it.condition)}" if it.condition else None),
                     "qty": qty, "price": money(it.return_price), "amount": money(Decimal(str(it.return_price or 0)) * qty)})
    total = money(sale_return.total_refund)
    tax = money(sale_return.tax_refund)
    if tax < 0 or tax > total:
        tax = ZERO  # same rule as the GL posting of the return
    totals = [_total("Lines total", sum((r["amount"] for r in rows), ZERO))]
    if tax:
        totals += [_total("Value excluding VAT", total - tax, strong=True), _total("VAT", tax)]
    totals.append(_total("Total credit", total, strong=True))
    inv = sale_return.invoice
    return _doc(
        key="credit-note", title="CREDIT NOTE", number=sale_return.sale_return_no, currency=company["currency_code"],
        status=None if sale_return.status == "processed" else label(sale_return.status),
        meta=[
            ("Credit note no.", sale_return.sale_return_no),
            ("Date", _date(sale_return.added_date)),
            ("Original invoice", inv.invoice_no if inv else None),
            ("Invoice date", _date(inv.created_date) if inv else None),
            ("Reason", label(sale_return.return_reason)),
            ("Refund method", label(sale_return.payment_method)),
            ("Refund reference", sale_return.refund_reference),
        ],
        parties=[customer_party(customer, "Customer")],
        columns=_columns("no", "code", "description", "qty", "unit", "price", "amount", labels={"price": "Return price"}),
        lines=rows, totals=totals,
        tax_summary=[{"rate": None, "taxable": total - tax, "tax": tax, "total": total}] if tax else None,
        amount_in_words=amount_in_words(total, company["currency_code"]),
        notes=[("Remarks", sale_return.remark)],
        signatures=["Prepared by", "Authorised signature", "Customer's signature"],
    )


# --------------------------------------------------------------------------- #
# Purchasing
# --------------------------------------------------------------------------- #
def build_purchase_order(db: Session, po, supplier, branch: dict, company: dict) -> dict:
    rows, total = [], ZERO
    for i, it in enumerate(po.items, start=1):
        code, desc, unit = _product_label(getattr(it, "product", None), it.product_id)
        if not code:
            from app.modules.products.models import Product

            code, desc, unit = _product_label(db.query(Product).filter(Product.id == it.product_id).first(), it.product_id)
        amount = money(Decimal(str(it.unit_price or 0)) * (it.quantity or 0))
        total += amount
        rows.append({"no": i, "code": code, "description": desc, "unit": unit, "qty": it.quantity,
                     "details": lines(it.remark, f"Warranty: {it.warrenty_month} months" if it.warrenty_month and str(it.warrenty_month) != "0" else None),
                     "price": money(it.unit_price), "amount": amount})
    credit_days = getattr(supplier, "credit_days", None)
    if (po.payment_method or "").lower() == "credit":
        terms = f"{credit_days} days credit" if credit_days else "Due on receipt"
    else:  # older POs that were raised with a payment method
        terms = label(po.payment_method)
    return _doc(
        key="purchase-order", title="PURCHASE ORDER", number=po.purchasing_order_no, currency=company["currency_code"],
        status=label(po.status) if po.status not in ("approved", "completed", "partially_received", "received") else None,
        meta=[
            ("PO no.", po.purchasing_order_no),
            ("PO date", _date(po.purchasing_order_date)),
            ("Required by", _date(po.required_date) or _date(po.good_received_note_date)),
            ("Payment terms", terms),
            ("Supplier ref.", po.purchasing_invoice_no),
            ("Supplier code", supplier.supplier_no if supplier else None),
        ],
        parties=[supplier_party(supplier, "Supplier"), branch_party(branch, "Deliver to")],
        columns=_columns("no", "code", "description", "qty", "unit", "price", "amount"),
        lines=rows,
        totals=[_total("Total", total, strong=True)],
        amount_in_words=amount_in_words(total, company["currency_code"]),
        notes=[("Remarks", po.remarks)],
        signatures=["Prepared by", "Approved by", "Supplier's acceptance"],
    )


def build_grn(db: Session, grn, po, supplier, branch: dict, company: dict) -> dict:
    from app.modules.purchasing.models import GoodReceivedItems, GoodReceivedRejection, PurchasingOrderItems

    received = (
        db.query(GoodReceivedItems, PurchasingOrderItems)
        .join(PurchasingOrderItems, PurchasingOrderItems.id == GoodReceivedItems.purchasing_order_items_id)
        .filter(GoodReceivedItems.good_received_note == grn.good_received_no)
        .order_by(GoodReceivedItems.id)
        .all()
    )
    from app.modules.products.models import Product

    products = {p.id: p for p in db.query(Product).filter(Product.id.in_({poi.product_id for _gi, poi in received} or {0})).all()}
    grouped: "OrderedDict[tuple, dict]" = OrderedDict()
    for gi, poi in received:
        code, desc, unit = _product_label(products.get(poi.product_id), poi.product_id)
        key = (poi.id, gi.batch_no, gi.expiry_date)
        row = grouped.setdefault(key, {"code": code, "description": desc, "unit": unit, "qty": 0, "serials": [],
                                       "batch": gi.batch_no, "expiry": gi.expiry_date, "ordered": poi.quantity,
                                       "price": money(poi.unit_price), "amount": ZERO})
        row["qty"] += gi.quantity or 0
        row["amount"] += money(Decimal(str(poi.unit_price or 0)) * (gi.quantity or 0))
        if gi.barcode:
            row["serials"].append(gi.barcode)
    rows = []
    for i, r in enumerate(grouped.values(), start=1):
        details = lines(f"Batch: {r['batch']}" if r["batch"] else None,
                        f"Expiry: {r['expiry']:%Y-%m-%d}" if r["expiry"] else None,
                        ("S/N: " + ", ".join(r["serials"])) if r["serials"] else None)
        rows.append({**r, "no": i, "details": details})
    total = sum((r["amount"] for r in rows), ZERO)

    rejected = (
        db.query(GoodReceivedRejection, PurchasingOrderItems)
        .join(PurchasingOrderItems, PurchasingOrderItems.id == GoodReceivedRejection.purchasing_order_items_id)
        .filter(GoodReceivedRejection.good_received_note_id == grn.id)
        .all()
    )
    sections = []
    if rejected:
        rej_products = {p.id: p for p in db.query(Product).filter(Product.id.in_({poi.product_id for _r, poi in rejected})).all()}
        sections.append({"title": "Rejected at receipt (not stocked)", "columns": [
            {"key": "description", "label": "Item", "type": "text"}, {"key": "qty", "label": "Qty", "type": "qty", "align": "right"},
            {"key": "reason", "label": "Reason", "type": "text"}],
            "rows": [{"description": _product_label(rej_products.get(poi.product_id), poi.product_id)[1], "qty": r.quantity, "reason": r.reason}
                     for r, poi in rejected]})
    return _doc(
        key="grn", title="GOODS RECEIVED NOTE", number=grn.good_received_no, currency=company["currency_code"],
        status="Cancelled" if grn.status == "cancelled" else None,
        meta=[
            ("GRN no.", grn.good_received_no),
            ("Received on", _date(grn.good_received_date)),
            ("PO no.", po.purchasing_order_no if po else None),
            ("Supplier invoice", grn.supplier_invoice_no),
            ("Invoice date", _date(grn.supplier_invoice_date)),
            ("Delivery note", grn.delivery_note_no),
            ("Vehicle no.", grn.vehicle_no),
            ("Received by", grn.received_by),
        ],
        parties=[supplier_party(supplier, "Supplier"), branch_party(branch, "Received at")],
        columns=_columns("no", "code", "description") + [
            {"key": "ordered", "label": "Ordered", "type": "qty", "align": "right"},
            {"key": "qty", "label": "Received", "type": "qty", "align": "right"},
            {"key": "unit", "label": "Unit", "type": "text"},
            {"key": "price", "label": "Unit cost", "type": "money", "align": "right"},
            {"key": "amount", "label": "Value", "type": "money", "align": "right"}],
        lines=rows,
        totals=[_total("Total value", total, strong=True)],
        column_totals={"qty": sum((r["qty"] for r in rows), 0)},
        sections=sections,
        notes=[("Remarks", grn.remark), ("Cancellation reason", grn.cancel_reason if grn.status == "cancelled" else None)],
        signatures=["Received by", "Checked by", "Store keeper"],
    )


def build_purchase_return(db: Session, pr, grn, po, supplier, branch: dict, company: dict) -> dict:
    rows, total = [], ZERO
    for i, it in enumerate(pr.items, start=1):
        code, desc, unit = _product_label(getattr(it, "product", None), it.product_id)
        qty = it.quantity or 1
        price = money(it.return_price if it.return_price is not None else it.purchasing_price)
        amount = money(price * qty)
        total += amount
        batch = it.sales_stock.batch_no if getattr(it, "sales_stock", None) else None
        rows.append({"no": i, "code": code, "description": desc, "unit": unit, "qty": qty, "price": price, "amount": amount,
                     "details": lines(f"S/N: {it.barcode}" if it.barcode else None, f"Batch: {batch}" if batch else None)})
    return _doc(
        key="purchase-return", title="PURCHASE RETURN NOTE", number=pr.purchasing_return_no, currency=company["currency_code"],
        status=None if pr.status == "approved" else label(pr.status),
        meta=[
            ("Return no.", pr.purchasing_return_no),
            ("Date", _date(pr.added_date)),
            ("Approved on", _date(pr.approved_date)),
            ("GRN no.", grn.good_received_no if grn else None),
            ("PO no.", po.purchasing_order_no if po else None),
            ("Reason", label(pr.reason)),
        ],
        parties=[supplier_party(supplier, "Return to"), branch_party(branch, "Returned from")],
        columns=_columns("no", "code", "description", "qty", "unit", "price", "amount", labels={"price": "Return price"}),
        lines=rows,
        totals=[_total("Total", total, strong=True)],
        amount_in_words=amount_in_words(total, company["currency_code"]),
        notes=[("Remarks", pr.remark)],
        signatures=["Prepared by", "Approved by", "Received by (supplier)"],
    )


# --------------------------------------------------------------------------- #
# Finance / warehouse / HR
# --------------------------------------------------------------------------- #
def build_expense(db: Session, expense, branch: dict, company: dict) -> dict:
    amount = money(expense.expense_amount)
    return _doc(
        key="expense", title="PAYMENT VOUCHER", number=expense.expenses_no, currency=company["currency_code"],
        status=label(expense.status) if expense.status not in ("approved", "paid") else None,
        meta=[
            ("Voucher no.", expense.expenses_no),
            ("Expense date", _date(expense.expense_date) or _date(expense.created_date)),
            ("Category", label(expense.expense_category)),
            ("Type", label(expense.expense_type)),
            ("Bill reference", expense.bill_reference),
            ("Receipt no.", expense.receipt_number),
            ("GL account", expense.account_code),
            ("Cost centre", expense.cost_center),
            ("Payment method", label(expense.payment_method or expense.expenses_method)),
            ("Paid on", _date(expense.payment_date)),
            ("Payment ref.", expense.payment_reference),
        ],
        parties=[{"title": "Pay to", "name": expense.vendor_name or "-", "attention": None, "code": "", "lines": [],
                  "phone": "", "email": "", "tax_no": ""}, branch_party(branch, "Branch")],
        columns=[{"key": "no", "label": "#", "type": "int", "align": "center"},
                 {"key": "description", "label": "Description", "type": "text", "wide": True},
                 {"key": "amount", "label": "Amount", "type": "money", "align": "right"}],
        lines=[{"no": 1, "description": expense.description or label(expense.expense_category) or "Expense", "details": [], "amount": amount}],
        totals=[_total("Total", amount, strong=True)],
        amount_in_words=amount_in_words(amount, company["currency_code"]),
        notes=[("Remarks", expense.remarks)],
        signatures=["Prepared by", "Approved by", "Received by (payee)"],
    )


def build_item_transfer_note(db: Session, itn, from_branch: dict, to_branch: dict, from_loc, to_loc, company: dict) -> dict:
    rows = []
    for i, it in enumerate(itn.items, start=1):
        code, desc, unit = _product_label(it.product, it.product_id)
        rows.append({"no": i, "code": code, "description": desc, "unit": unit, "qty": it.quantity or 1,
                     "details": lines(f"S/N: {it.barcode}" if it.barcode else None, it.remark),
                     "received": "Yes" if it.item_recieved else "No"})
    p_from = branch_party(from_branch, "From")
    p_to = branch_party(to_branch, "To")
    if from_loc is not None:
        p_from["lines"] = [f"Location: {from_loc.name}"] + p_from["lines"]
    if to_loc is not None:
        p_to["lines"] = [f"Location: {to_loc.name}"] + p_to["lines"]
    return _doc(
        key="item-transfer-note", title="STOCK TRANSFER NOTE", number=itn.item_transfer_note, currency=company["currency_code"],
        status=label(itn.status),
        meta=[("Transfer no.", itn.item_transfer_note), ("Date", _date(itn.created_date)),
              ("Status", label(itn.status))],
        parties=[p_from, p_to],
        columns=_columns("no", "code", "description", "qty", "unit") + [{"key": "received", "label": "Received", "type": "text", "align": "center"}],
        lines=rows,
        column_totals={"qty": sum((r["qty"] for r in rows), 0)},
        notes=[("Remarks", itn.remark)],
        signatures=["Dispatched by", "Transported by", "Received by"],
    )


def build_journal_entry(db: Session, je, branch: dict, company: dict) -> dict:
    rows = []
    for ln in sorted(je.lines, key=lambda x: x.line_number):
        acc = ln.account
        rows.append({"no": ln.line_number, "code": acc.account_code if acc else "", "description": acc.account_name if acc else f"Account #{ln.account_id}",
                     "details": lines(ln.description), "debit": money(ln.debit_amount) or None, "credit": money(ln.credit_amount) or None})
    return _doc(
        key="journal-entry", title="JOURNAL VOUCHER", number=je.journal_entry_no, currency=company["currency_code"],
        status=label(je.status) + (" (reversed)" if je.is_reversed else ""),
        meta=[("Entry no.", je.journal_entry_no), ("Entry date", _date(je.entry_date)), ("Posting date", _date(je.posting_date)),
              ("Type", label(je.entry_type)), ("Period", f"{je.fiscal_year} / {int(je.fiscal_period):02d}" if je.fiscal_year else None),
              ("Branch", branch["name"] if je.branch_code else None),
              ("Prepared by", user_name(db, je.created_by)), ("Approved by", user_name(db, je.approved_by))],
        parties=[],
        columns=[{"key": "no", "label": "#", "type": "int", "align": "center"},
                 {"key": "code", "label": "Account", "type": "text"},
                 {"key": "description", "label": "Account name / narration", "type": "text", "wide": True},
                 {"key": "debit", "label": "Debit", "type": "money", "align": "right"},
                 {"key": "credit", "label": "Credit", "type": "money", "align": "right"}],
        lines=rows,
        column_totals={"debit": money(je.total_debit), "credit": money(je.total_credit)},
        notes=[("Narration", je.description)],
        signatures=["Prepared by", "Checked by", "Approved by"],
    )


def build_voucher(db: Session, voucher, usages: list[dict], expiry: Optional[date], branch: dict, company: dict) -> dict:
    value = money(voucher.amount)
    used = sum((money(u["amount"]) for u in usages), ZERO)
    return _doc(
        key="voucher", title="GIFT VOUCHER", number=voucher.barcode_no, currency=company["currency_code"],
        status=label(voucher.status),
        meta=[("Voucher no.", voucher.barcode_no), ("Issued on", _date(voucher.date)), ("Valid until", expiry),
              ("Issued with invoice", voucher.purchased_invoice_no), ("Payment method", label(voucher.payment_method))],
        parties=[{"title": "Issued to", "name": voucher.customer_name or "Bearer", "attention": None, "code": "", "lines": [],
                  "phone": "", "email": "", "tax_no": ""}, branch_party(branch, "Issued at") if voucher.branch_code else None],
        columns=[{"key": "description", "label": "Description", "type": "text", "wide": True},
                 {"key": "amount", "label": "Value", "type": "money", "align": "right"}],
        lines=[{"description": "Gift voucher", "details": [], "amount": value}],
        totals=[_total("Voucher value", value, strong=True), _total("Redeemed", used, sign="-"),
                _total("Balance", money(voucher.balance), strong=True)],
        amount_in_words=amount_in_words(value, company["currency_code"]),
        sections=[{"title": "Redemptions", "columns": [
            {"key": "date", "label": "Date", "type": "date"}, {"key": "reference", "label": "Invoice", "type": "text"},
            {"key": "amount", "label": "Amount", "type": "money", "align": "right"}],
            "rows": usages}] if usages else [],
        signatures=["Issued by", "Authorised signature"],
    )


def build_payroll(db: Session, year: int, month: int, company: dict) -> dict:
    from app.modules.employees.models import Employee, EmployeePayroll

    q = (
        db.query(EmployeePayroll, Employee)
        .join(Employee, Employee.employee_id == EmployeePayroll.employee_id)  # payroll keys on the employee number
        .filter(EmployeePayroll.payroll_year == year, EmployeePayroll.payroll_month == month)
        .order_by(Employee.employee_id)
    )
    rows = []
    records = q.all()
    for p, e in records:
        allowances = sum((money(v) for v in (p.add_1_value, p.add_2_value, p.add_sales_commision, p.add_bonus,
                                              p.add_reimbursements, p.add_salary_advance)), ZERO)
        other = sum((money(v) for v in (p.less_stamp_duty, p.less_late_deductions, p.less_salary_advance_repayment,
                                         p.less_loan_repayment, p.less_other_deductions)), ZERO)
        rows.append({"code": e.employee_id, "description": e.name_with_initials or e.employee_id, "details": [],
                     "basic": money(p.basic_salary), "allowances": allowances, "gross": money(p.gross_salary),
                     "epf": money(p.less_epf_employee), "apit": money(p.less_apit), "other": other,
                     "net": money(p.net_salary), "epf_er": money(p.epf_employer), "etf_er": money(p.etf_employer)})
    for i, r in enumerate(rows, start=1):
        r["no"] = i
    s = lambda k: sum((r[k] for r in rows), ZERO)  # noqa: E731
    period = date(year, month, 1).strftime("%B %Y")
    return _doc(
        key="payroll", title="PAYROLL SUMMARY", number=period, currency=company["currency_code"],
        meta=[("Period", period), ("Employees", len(rows)),
              ("Batch", ", ".join(sorted({p.payroll_batch_no for p, _e in records if p.payroll_batch_no})) or None)],
        columns=[{"key": "no", "label": "#", "type": "int", "align": "center"},
                 {"key": "code", "label": "Emp. no.", "type": "text"},
                 {"key": "description", "label": "Name", "type": "text", "wide": True},
                 {"key": "basic", "label": "Basic", "type": "money", "align": "right"},
                 {"key": "allowances", "label": "Allowances", "type": "money", "align": "right"},
                 {"key": "gross", "label": "Gross", "type": "money", "align": "right"},
                 {"key": "epf", "label": "EPF 8%", "type": "money", "align": "right"},
                 {"key": "apit", "label": "APIT", "type": "money", "align": "right"},
                 {"key": "other", "label": "Other ded.", "type": "money", "align": "right"},
                 {"key": "net", "label": "Net pay", "type": "money", "align": "right"}],
        lines=rows,
        column_totals={k: s(k) for k in ("basic", "allowances", "gross", "epf", "apit", "other", "net")},
        totals=[_total("Net pay", s("net"), strong=True), _total("Employer EPF 12%", s("epf_er")),
                _total("Employer ETF 3%", s("etf_er")),
                _total("Total employer cost", s("gross") + s("epf_er") + s("etf_er"), strong=True)],
        empty_message="No payroll has been run for this period.",
        signatures=["Prepared by", "Checked by", "Approved by"],
        landscape=True,
    )


# --------------------------------------------------------------------------- #
# Template filters (built-in layouts and admins' custom HTML)
# --------------------------------------------------------------------------- #
# --------------------------------------------------------------------------- #
# Manufacturing
# --------------------------------------------------------------------------- #
def _minutes(value: Any) -> str:
    m = Decimal(str(value or 0))
    if m <= 0:
        return "-"
    hours, rest = divmod(int(m.quantize(Decimal("1"), rounding=ROUND_HALF_UP)), 60)
    return f"{hours} h {rest:02d} min" if hours else f"{rest} min"


def _order_meta(db: Session, order, bom) -> list:
    quote = order.quote_item.quote if getattr(order, "quote_item", None) else None
    return [
        ("Order no.", order.order_no),
        ("Product", f"{order.product.item_code} - {order.product.name}" if order.product else None),
        ("BOM", f"{bom.bom_no} (v{bom.version})" if bom else None),
        ("Quantity", f"{order.planned_quantity} {order.product.unit_of_measure if order.product else ''}".strip()),
        ("Planned start", _date(order.planned_start_date)),
        ("Planned end", _date(order.planned_end_date)),
        ("Priority", label(order.priority)),
        ("Status", label(order.status)),
        ("Made to order for", f"{quote.quote_no} - {quote.customer.customer_name}" if quote and quote.customer else None),
        ("Reference", order.source_reference if not quote else None),
        ("Released", _date(order.released_at)),
        ("Released by", user_name(db, order.released_by)),
    ]


def build_production_order(db: Session, order, bom, branch: dict, location_name: Optional[str], company: dict,
                            outputs: list) -> dict:
    """Production (work) order: what to make, the components to pick and the routing."""
    rows = []
    for i, m in enumerate(order.materials, start=1):
        code, desc, unit = _product_label(m.product, m.product_id)
        rows.append({"no": i, "code": code, "description": desc, "unit": unit,
                     "details": lines("Backflushed on output" if m.issue_method == "backflush" else None,
                                      f"Scrap allowance {Decimal(str(m.scrap_pct)).normalize()}%" if m.scrap_pct else None),
                     "per_unit": Decimal(str(m.quantity_per_unit)).normalize(), "qty": m.required_quantity,
                     "issued": m.issued_quantity})
    operations = [{"seq": op.sequence, "operation": op.name,
                   "work_center": f"{op.work_center.code} - {op.work_center.name}" if op.work_center else "",
                   "planned": _minutes(op.planned_minutes), "actual": _minutes(op.actual_minutes),
                   "done": op.completed_quantity, "status": label(op.status)} for op in order.operations]
    planned = money(order.planned_material_cost) + money(order.planned_labor_cost) + money(order.planned_overhead_cost)
    actual = money(order.actual_material_cost) + money(order.actual_labor_cost) + money(order.actual_overhead_cost)
    sections = [{
        "title": "Operations (routing)", "compact": False,
        "columns": [{"key": "seq", "label": "Seq"}, {"key": "operation", "label": "Operation"},
                    {"key": "work_center", "label": "Work center"},
                    {"key": "planned", "label": "Planned time", "align": "right"},
                    {"key": "actual", "label": "Actual time", "align": "right"},
                    {"key": "done", "label": "Qty done", "type": "qty", "align": "right"},
                    {"key": "status", "label": "Status"}],
        "rows": operations,
    }]
    if outputs:
        sections.append({
            "title": "Output received", "compact": False,
            "columns": [{"key": "date", "label": "Date", "type": "date"}, {"key": "qty", "label": "Good", "type": "qty", "align": "right"},
                        {"key": "scrap", "label": "Scrap", "type": "qty", "align": "right"},
                        {"key": "lot", "label": "Batch / serials"}, {"key": "location", "label": "Location"}],
            "rows": outputs,
        })
    sections.append({
        # Not compact: compact sections sit beside a totals block, which this document has none of
        "title": "Cost summary", "compact": False,
        "columns": [{"key": "element", "label": "Cost"}, {"key": "planned", "label": "Planned", "type": "money", "align": "right"},
                    {"key": "actual", "label": "Actual", "type": "money", "align": "right"}],
        "rows": [
            {"element": "Material", "planned": money(order.planned_material_cost), "actual": money(order.actual_material_cost)},
            {"element": "Labour", "planned": money(order.planned_labor_cost), "actual": money(order.actual_labor_cost)},
            {"element": "Overhead", "planned": money(order.planned_overhead_cost), "actual": money(order.actual_overhead_cost)},
            {"element": "Total", "planned": planned, "actual": actual},
        ],
    })
    produced = f"{order.produced_quantity} of {order.planned_quantity}" + (f", scrap {order.scrapped_quantity}" if order.scrapped_quantity else "")
    production_at = branch_party(branch, "Production at")
    if location_name:
        production_at["lines"] = [f"Output to: {location_name}"] + production_at["lines"]
    return _doc(
        key="production-order", title="PRODUCTION ORDER", number=order.order_no, currency=company["currency_code"],
        status=label(order.status) if order.status != "released" else None,
        meta=_order_meta(db, order, bom) + [("Produced", produced if order.produced_quantity or order.scrapped_quantity else None)],
        parties=[production_at],
        columns=[{"key": "no", "label": "#", "type": "int", "align": "center"},
                 {"key": "code", "label": "Item code", "type": "text"},
                 {"key": "description", "label": "Component", "type": "text", "wide": True},
                 {"key": "per_unit", "label": "Per unit", "type": "qty", "align": "right"},
                 {"key": "qty", "label": "Required", "type": "qty", "align": "right"},
                 {"key": "issued", "label": "Issued", "type": "qty", "align": "right"},
                 {"key": "unit", "label": "Unit", "type": "text"}],
        lines=rows,
        empty_message="This BOM has no components.",
        sections=sections,
        notes=[("Remarks", order.remark)],
        signatures=["Prepared by", "Materials issued by", "Approved by"],
    )


def build_job_card(db: Session, order, bom, branch: dict, company: dict) -> dict:
    """Job card (shop traveller): one row per operation with space for the operator to
    record start, finish, quantities and sign off; the components to pick below."""
    rows = []
    for op in order.operations:
        rows.append({"no": op.sequence, "code": op.work_center.code if op.work_center else "",
                     "description": op.name,
                     "details": lines(op.work_center.name if op.work_center else None,
                                      f"Done so far: {op.completed_quantity}" if op.completed_quantity else None),
                     "planned": _minutes(op.planned_minutes), "qty": order.planned_quantity,
                     # write-in blanks for the operator
                     "start": "__:__", "finish": "__:__", "good": "_____", "scrap": "_____", "sign": "__________"})
    components = []
    for m in order.materials:
        code, desc, unit = _product_label(m.product, m.product_id)
        components.append({"code": code, "component": desc, "qty": m.required_quantity, "unit": unit,
                           "method": "Backflush" if m.issue_method == "backflush" else "Issue",
                           "issued": m.issued_quantity})
    return _doc(
        key="job-card", title="JOB CARD", number=order.order_no, currency=company["currency_code"],
        status=label(order.status) if order.status not in ("released", "in_progress") else None,
        meta=_order_meta(db, order, bom),
        parties=[branch_party(branch, "Production at")],
        columns=[{"key": "no", "label": "Seq", "type": "int", "align": "center"},
                 {"key": "code", "label": "Work center", "type": "text"},
                 {"key": "description", "label": "Operation", "type": "text", "wide": True},
                 {"key": "planned", "label": "Planned", "type": "text", "align": "right"},
                 {"key": "qty", "label": "Qty", "type": "qty", "align": "right"},
                 {"key": "start", "label": "Start", "type": "text"},
                 {"key": "finish", "label": "Finish", "type": "text"},
                 {"key": "good", "label": "Good", "type": "text"},
                 {"key": "scrap", "label": "Scrap", "type": "text"},
                 {"key": "sign", "label": "Operator", "type": "text"}],
        lines=rows,
        empty_message="This order has no routing operations.",
        sections=[{
            "title": "Components to pick", "compact": False,
            "columns": [{"key": "code", "label": "Item code"}, {"key": "component", "label": "Component"},
                        {"key": "qty", "label": "Required", "type": "qty", "align": "right"},
                        {"key": "issued", "label": "Issued", "type": "qty", "align": "right"},
                        {"key": "unit", "label": "Unit"}, {"key": "method", "label": "Method"}],
            "rows": components,
        }],
        notes=[("Instructions", order.remark)],
        signatures=["Supervisor", "Quality check", "Completed by"],
    )


def _fmt_money(value: Any) -> str:
    if value is None or value == "":
        return ""
    return f"{money(value):,.2f}"


def _fmt_qty(value: Any) -> str:
    if value is None or value == "":
        return ""
    d = Decimal(str(value))
    return f"{d:,.0f}" if d == d.to_integral_value() else f"{d.normalize():,f}"


def _fmt_date(value: Any) -> str:
    d = _date(value)
    return d.strftime("%d %b %Y") if d else ("" if value is None else str(value))


def register_filters(env) -> None:
    env.filters["money"] = _fmt_money
    env.filters["qty"] = _fmt_qty
    env.filters["fmt_date"] = _fmt_date
    env.tests["date_like"] = lambda v: isinstance(v, (date, datetime))
