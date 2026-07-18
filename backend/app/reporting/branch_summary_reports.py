"""
Branch Daily Account Summary Report

Aggregates per-branch financial data for a given date using the actual
Invoice model field names:
  - Invoice.created_date  (Date column, NOT added_date)
  - Per-payment-method columns: cash_amount, card_visa_amount, etc.
  - SaleReturn.added_date + total_refund
  - PurchasingOrder.purchasing_order_date + PurchasingOrderItems value
  - BankDeposits.created_date + deposits_amount
  - CashbookEntryRecord running_balance / money_in / money_out
  - PettyCash.current_balance
"""

from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import cast, func, Date, and_
from sqlalchemy.orm import Session

from app.auth.models import Branch
from app.modules.finance.models import BankDeposits, CashbookEntryRecord, PettyCash, Expenses, Vouchers
from app.modules.purchasing.models import PurchasingOrder, PurchasingOrderItems
from app.modules.sales.models import Invoice, SaleReturn


def _d(v) -> Decimal:
    return Decimal(str(v or 0))


def get_branch_list(db: Session) -> List[dict]:
    rows = db.query(Branch).filter(Branch.active == True).order_by(Branch.branch_name).all()
    return [{"branch_code": b.branch_code, "branch_name": b.branch_name} for b in rows]


def get_branch_daily_summary(
    db: Session,
    start_date: date,
    end_date: date,
    branch_codes: Optional[List[str]] = None,
) -> List[dict]:
    q = db.query(Branch).filter(Branch.active == True)
    if branch_codes:
        q = q.filter(Branch.branch_code.in_(branch_codes))
    branches = q.order_by(Branch.branch_name).all()
    return [_build_summary(db, start_date, end_date, b.branch_code, b.branch_name) for b in branches]


def _build_summary(db: Session, start_date: date, end_date: date, branch_code: str, branch_name: str) -> dict:
    # ── Sales ──────────────────────────────────────────────────────────────────
    invoices = (
        db.query(Invoice)
        .filter(
            Invoice.branch_code == branch_code,
            Invoice.created_date.between(start_date, end_date),          
            Invoice.approval_status.in_(["approved", "completed"]),
        )
        .all()
    )

    sales_cash = _d(0)
    sales_card = _d(0)
    sales_bank = _d(0)
    sales_credit = _d(0)
    sales_cheque = _d(0)

    sales_details = []

    for inv in invoices:
        cash = _d(inv.cash_amount)
        card = _d(inv.card_visa_amount) + _d(inv.card_mastercard_amount) + _d(inv.card_amex_amount)
        bank = _d(inv.bank_transfer_amount)
        credit = _d(inv.credit_amount)
        cheque = _d(inv.cheque_amount)

        sales_cash += cash
        sales_card += card
        sales_bank += bank
        sales_credit += credit
        sales_cheque += cheque

        sales_details.append({
            "invoice_no": inv.invoice_no,
            "total": float(_d(inv.grand_total)),
            "cash": float(cash),
            "card": float(card),
            "bank": float(bank),
            "credit": float(credit),
            "cheque": float(cheque),
        })

    total_sales = sales_cash + sales_card + sales_bank + sales_credit + sales_cheque

    # ── Sale Returns ──────────────────────────────────────────────────────────
    returns_recs = (
        db.query(SaleReturn)
        .filter(
            SaleReturn.branch_code == branch_code,
            SaleReturn.added_date.between(start_date, end_date),
        )
        .all()
    )
    total_returns = _d(0)
    returns_details = []
    for ret in returns_recs:
        amt = _d(ret.total_refund)
        total_returns += amt
        returns_details.append({
            "return_no": ret.sale_return_no,
            "total_refund": float(amt)
        })
    net_sales = total_sales - total_returns

    # ── Purchase Orders ────────────────────────────────────────────────────────
    pos = (
        db.query(PurchasingOrder)
        .filter(
            PurchasingOrder.branch_code == branch_code,
            PurchasingOrder.purchasing_order_date.between(start_date, end_date),
        )
        .all()
    )
    
    po_total_value = _d(0)
    po_by_status: dict = {}
    po_details = []

    for po in pos:
        st = po.status or "unknown"
        po_by_status[st] = po_by_status.get(st, 0) + 1
        
        val = _d(
            db.query(
                func.coalesce(
                    func.sum(PurchasingOrderItems.quantity * PurchasingOrderItems.unit_price), 0
                )
            )
            .filter(PurchasingOrderItems.purchasingorders_id == po.id)
            .scalar()
        )
        po_total_value += val
        
        po_details.append({
            "po_no": po.purchasing_order_no,
            "status": st,
            "value": float(val)
        })

    # ── Bank Deposits ─────────────────────────────────────────────────────────
    deposits = (
        db.query(BankDeposits)
        .filter(
            BankDeposits.branch_code == branch_code,
            cast(BankDeposits.created_date, Date).between(start_date, end_date),
        )
        .all()
    )
    banked = _d(0)
    banking_details = []
    for d in deposits:
        amt = _d(d.deposits_amount)
        banked += amt
        banking_details.append({
            "time": str(d.created_date),
            "amount": float(amt)
        })

    # ── Cashbook Entries ──────────────────────────────────────────────────────
    end_of_period = datetime.combine(end_date, datetime.max.time())
    last_entry = (
        db.query(CashbookEntryRecord)
        .filter(
            CashbookEntryRecord.branch_code == branch_code,
            CashbookEntryRecord.transaction_date <= end_of_period,
        )
        .order_by(CashbookEntryRecord.transaction_date.desc(), CashbookEntryRecord.id.desc())
        .first()
    )
    cash_in_hand = _d(last_entry.running_balance if last_entry else 0)

    cashbook_period = (
        db.query(CashbookEntryRecord)
        .filter(
            CashbookEntryRecord.branch_code == branch_code,
            cast(CashbookEntryRecord.transaction_date, Date).between(start_date, end_date),
        )
        .all()
    )
    
    day_in = _d(0)
    day_out = _d(0)
    inflow_details = []
    outflow_details = []

    for cb in cashbook_period:
        in_amt = _d(cb.money_in)
        out_amt = _d(cb.money_out)
        day_in += in_amt
        day_out += out_amt
        
        if in_amt > 0:
            inflow_details.append({
                "time": str(cb.transaction_date),
                "type": cb.entry_type,
                "source_table": cb.source_table,
                "source_id": cb.source_id,
                "amount": float(in_amt)
            })
        if out_amt > 0:
            outflow_details.append({
                "time": str(cb.transaction_date),
                "type": cb.entry_type,
                "source_table": cb.source_table,
                "source_id": cb.source_id,
                "amount": float(out_amt)
            })

    # ── Petty Cash ────────────────────────────────────────────────────────────
    petty = (
        db.query(PettyCash)
        .filter(PettyCash.branch_code == branch_code, PettyCash.status == "active")
        .order_by(PettyCash.id.desc())
        .first()
    )
    petty_balance = _d(petty.current_balance if petty else 0)

    # ── Expenses ──────────────────────────────────────────────────────────────
    expenses_recs = (
        db.query(Expenses)
        .filter(
            Expenses.branch_code == branch_code,
            Expenses.expense_date.between(start_date, end_date)
        )
        .all()
    )
    total_expenses = _d(0)
    expenses_details = []
    for exp in expenses_recs:
        amt = _d(exp.expense_amount)
        total_expenses += amt
        expenses_details.append({
            "expense_no": exp.expenses_no,
            "type": exp.expense_type,
            "vendor": exp.vendor_name or "",
            "amount": float(amt)
        })

    # ── Payment Vouchers ──────────────────────────────────────────────────────
    vouchers_recs = (
        db.query(Vouchers)
        .filter(
            Vouchers.branch_code == branch_code,
            cast(Vouchers.created_date, Date).between(start_date, end_date)
        )
        .all()
    )
    total_vouchers = _d(0)
    vouchers_details = []
    for v in vouchers_recs:
        amt = _d(v.amount)
        total_vouchers += amt
        vouchers_details.append({
            "voucher_no": v.voucher_number or "",
            "type": v.voucher_type or "",
            "amount": float(amt)
        })

    return {
        "branch_code": branch_code,
        "branch_name": branch_name,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "sales": {
            "invoice_count": len(invoices),
            "cash": float(sales_cash),
            "card": float(sales_card),
            "bank_transfer": float(sales_bank),
            "credit": float(sales_credit),
            "cheque": float(sales_cheque),
            "other": 0.0,
            "total_gross": float(total_sales),
            "details": sales_details
        },
        "returns": {
            "total_refunds": float(total_returns),
            "details": returns_details
        },
        "net_sales": float(net_sales),
        "purchasing": {
            "po_count": len(pos),
            "total_value": float(po_total_value),
            "by_status": po_by_status,
            "details": po_details
        },
        "cash_banking": {
            "total_banked": float(banked),
            "banking_details": banking_details,
            "money_in": float(day_in),
            "inflow_details": inflow_details,
            "money_out": float(day_out),
            "outflow_details": outflow_details,
            "cash_in_hand_eod": float(cash_in_hand),
            "petty_cash_balance": float(petty_balance),
        },
        "expenses": {
            "total": float(total_expenses),
            "details": expenses_details
        },
        "vouchers": {
            "total": float(total_vouchers),
            "details": vouchers_details
        }
    }
