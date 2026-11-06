"""
Branch Daily Account Summary Report

Aggregates per-branch financial data for a given date using the actual
Invoice model field names:
  - Invoice.created_date  (Date column, NOT added_date)
  - Per-payment-method columns: cash_amount, card_visa_amount, etc.
  - Gross sales = the sale value the GL posts (subtotal + tax + service
    charge), before gift vouchers / credit notes / customer advances
  - SaleReturn.added_date + total_refund
  - PurchasingOrder.purchasing_order_date + PurchasingOrderItems value
  - BankDeposits.created_date + deposits_amount
  - Cash in hand = GL balance of the cash (till) accounts for the branch, the
    same accounts day-end reconciles; CashbookEntryRecord money_in / money_out
  - PettyCash.current_balance
"""

from datetime import date
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import cast, func, Date, and_
from sqlalchemy.orm import Session

from app.auth.models import Branch
from app.modules.finance.accounting_models import ChartOfAccounts, GeneralLedger
from app.modules.finance.posting_rules import PostingRuleResolver
from app.modules.finance.reconciliation_service import CASH_ACCOUNT_CODE
from app.modules.finance.models import BankDeposits, CashbookEntryRecord, PettyCash, Expenses, Vouchers
from app.modules.purchasing.models import PurchasingOrder, PurchasingOrderItems
from app.modules.sales.models import Invoice, SaleReturn
from app.modules.sales.sales_metrics import counted_invoice_filters


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
            *counted_invoice_filters(),
        )
        .all()
    )

    sales_cash = _d(0)
    sales_card = _d(0)
    sales_bank = _d(0)
    sales_credit = _d(0)
    sales_cheque = _d(0)
    sales_other = _d(0)
    total_sales = _d(0)

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
        # Sale value as the GL posts it (Cr revenue + tax + service charge); the
        # part not paid by a tender column was paid by voucher / credit note / advance.
        value = _d(inv.subtotal) + _d(inv.tax_amount) + _d(inv.service_charge_amount)
        total_sales += value
        sales_other += value - (cash + card + bank + credit + cheque)

        sales_details.append({
            "invoice_no": inv.invoice_no,
            "total": float(value),
            "cash": float(cash),
            "card": float(card),
            "bank": float(bank),
            "credit": float(credit),
            "cheque": float(cheque),
        })

    # ── Sale Returns ──────────────────────────────────────────────────────────
    returns_recs = (
        db.query(SaleReturn)
        .filter(
            SaleReturn.branch_code == branch_code,
            SaleReturn.added_date.between(start_date, end_date),
            SaleReturn.status == "processed",  # pending/approved returns refunded nothing yet
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
            PurchasingOrder.status.notin_(("cancelled", "rejected")),
        )
        .all()
    )

    po_total_value = _d(0)
    po_by_status: dict = {}
    po_details = []
    # Every order's value in one query (was one query per order).
    po_values = dict(
        db.query(
            PurchasingOrderItems.purchasingorders_id,
            func.sum(PurchasingOrderItems.quantity * PurchasingOrderItems.unit_price),
        )
        .filter(PurchasingOrderItems.purchasingorders_id.in_([po.id for po in pos] or [0]))
        .group_by(PurchasingOrderItems.purchasingorders_id)
        .all()
    )

    for po in pos:
        st = po.status or "unknown"
        po_by_status[st] = po_by_status.get(st, 0) + 1
        val = _d(po_values.get(po.id))
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
            func.coalesce(BankDeposits.status, "") != "rejected",
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

    # ── Cash in hand: the till, i.e. the branch's GL cash accounts ────────────
    # (1010 plus any account a CASH posting rule points to - the accounts the
    # day-end reconciliation checks), balance up to the end date. The cashbook
    # running balance mixes cash with bank and the whole book.
    cash_codes = [code for code, method in PostingRuleResolver(db).cashbook_accounts().items() if method == "Cash"]         or [CASH_ACCOUNT_CODE]
    cash_in_hand = _d(
        db.query(
            func.coalesce(func.sum(GeneralLedger.debit_amount), 0)
            - func.coalesce(func.sum(GeneralLedger.credit_amount), 0)
        )
        .join(ChartOfAccounts, GeneralLedger.account_id == ChartOfAccounts.id)
        .filter(
            ChartOfAccounts.account_code.in_(cash_codes),
            GeneralLedger.branch_code == branch_code,
            GeneralLedger.posting_date <= end_date,
        )
        .scalar()
    )

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
            Expenses.expense_date.between(start_date, end_date),
            Expenses.status.notin_(("rejected", "cancelled")),
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
            cast(Vouchers.created_date, Date).between(start_date, end_date),
            func.coalesce(Vouchers.status, "active").notin_(("cancelled", "void", "rejected")),
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
            "other": float(sales_other),
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
