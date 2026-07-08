"""
Scenarios 31 & 32: Purchase, Expense & Payroll → General Ledger Automatic Integration

Automatically posts journal entries and GL entries for:
- Purchase transactions (GRN received, advance payments, credit purchases)
- Expense recording (approved & paid expenses)
- Payroll processing (salary, EPF, ETF, APIT, deductions)
- Commission payments (customer agent commissions)

═══════════════════════════════════════════════════════════════════════════
SCENARIO 31: PURCHASE TRANSACTIONS
═══════════════════════════════════════════════════════════════════════════

1. PURCHASE WITH PAYMENT (GRN received, cash/bank/cheque PO):
    Dr  1210  Finished Goods Inventory .. purchase_amount
    Cr  1020  Bank Account .............. purchase_amount

2. SUPPLIER ADVANCE PAYMENT:
    When Advance Given:
        Dr  2020  Supplier Advances ....... advance_amount
        Cr  1020  Bank Account ............ advance_amount
    When Advance Applied (manual or auto during GRN):
        Dr  1210  Inventory ............... applied_amount
        Cr  2020  Supplier Advances ....... applied_amount

3. ADVANCE PURCHASE (GRN received, advance PO):
    Dr  1210  Finished Goods Inventory .. purchase_amount
    Cr  2020  Supplier Advances ......... purchase_amount

4. CREDIT PURCHASE (GRN received, credit PO):
    When GRN Received:
        Dr  1210  Inventory ............... purchase_amount
        Cr  2010  Trade Creditors ......... purchase_amount
    When Credit Settled (Payment Made):
        Dr  2010  Trade Creditors ......... payment_amount
        Cr  1020  Bank Account ............ bank_portion
        Cr  1010  Cash on Hand ............ cash_portion

5. PURCHASE RETURN (approved):
    Credit PO:    Dr 2010 Trade Creditors  / Cr 1210 Inventory
    Cash/Bank PO: Dr 1020 Bank Account    / Cr 1210 Inventory
    Advance PO:   Dr 2020 Supplier Adv    / Cr 1210 Inventory

═══════════════════════════════════════════════════════════════════════════
SCENARIO 32: EXPENSES & PAYROLL
═══════════════════════════════════════════════════════════════════════════

1. EXPENSE POSTING (approved & paid):
    Dr  5xxx  Expense Account ........... expense_amount
    Cr  1020  Bank Account .............. expense_amount

2. PAYROLL POSTING (batch processed):
    Dr  5110  Salaries Expense .......... gross_salary
    Dr  5210  EPF Employer Expense ...... employer_epf
    Dr  5220  ETF Employer Expense ...... employer_etf
    Cr  2110  Salaries Payable .......... net_salary
    Cr  2120  EPF Payable ............... total_epf (employee + employer)
    Cr  2130  ETF Payable ............... total_etf (employee + employer)
    Cr  2140  Other Payroll Deductions .. other_deductions
    Cr  2150  APIT Payable .............. apit_amount

3. COMMISSION PAYMENT:
    Dr  5150  Commission Expense ........ commission_amount
    Cr  1020  Bank Account .............. commission_amount
═══════════════════════════════════════════════════════════════════════════
"""

from sqlalchemy.orm import Session
from sqlalchemy import func
from decimal import Decimal
from datetime import date, datetime
from typing import Optional, List, Dict, Any
import logging
from app.core import timezone as tz

from app.modules.finance.accounting_models import (
    ChartOfAccounts,
    JournalEntry,
    JournalEntryLine,
    GeneralLedger,
    AccountingPeriod,
)
from app.modules.finance.gl_posting_service import GLPostingService

logger = logging.getLogger(__name__)


# ─── Account Code Constants ──────────────────────────────────────────────────
ACCT_CASH_ON_HAND = "1010"
ACCT_BANK_ACCOUNT = "1020"
ACCT_TRADE_DEBTORS = "1110"
ACCT_FINISHED_GOODS = "1210"
ACCT_SUPPLIER_ADVANCES = "2020"
ACCT_TRADE_CREDITORS = "2010"
ACCT_SALARIES_PAYABLE = "2110"
ACCT_EPF_PAYABLE = "2120"
ACCT_ETF_PAYABLE = "2130"
ACCT_OTHER_PAYROLL_DEDUCTIONS = "2140"
ACCT_APIT_PAYABLE = "2150"
ACCT_VAT_PAYABLE = "2210"
ACCT_SALARIES_EXPENSE = "5110"
ACCT_COMMISSION_EXPENSE = "5150"
ACCT_EPF_EMPLOYER_EXPENSE = "5210"
ACCT_ETF_EMPLOYER_EXPENSE = "5220"

# Expense category → COA account code mapping
EXPENSE_CATEGORY_MAP = {
    "utilities": "5130",
    "rent": "5120",
    "travel": "5140",
    "salaries": "5110",
    "office_supplies": "5100",
    "maintenance": "5100",
    "marketing": "5100",
    "insurance": "5100",
    "miscellaneous": "5100",
    "freight": "5020",
    "commission": "5150",
}


class PurchaseExpensePayrollGL:
    """
    Service that creates automatic journal entries and GL postings
    from purchase, expense, and payroll transactions.
    """

    def __init__(self, db: Session):
        self.db = db
        self._account_cache: Dict[str, int] = {}
        self._gl = GLPostingService(db)

    # ─── Helpers (shared with SalesAccountingIntegration) ─────────────────

    def _get_account_id(self, account_code: str) -> Optional[int]:
        """Get COA account ID by code (cached)."""
        if account_code in self._account_cache:
            return self._account_cache[account_code]

        account = self.db.query(ChartOfAccounts).filter(
            ChartOfAccounts.account_code == account_code,
            ChartOfAccounts.is_active == True,
        ).first()

        if account:
            self._account_cache[account_code] = account.id
            return account.id

        logger.warning(f"COA account {account_code} not found - GL posting skipped")
        return None

    def _get_fiscal_period(self, entry_date: date) -> tuple:
        """Determine fiscal year and period from date."""
        period = self.db.query(AccountingPeriod).filter(
            AccountingPeriod.start_date <= entry_date,
            AccountingPeriod.end_date >= entry_date,
        ).first()

        if period:
            return period.fiscal_year, period.period_number
        return entry_date.year, entry_date.month

    def _generate_je_number(self, prefix: str = "JE-PUR") -> str:
        """Generate unique journal entry number.
        Uses pg_advisory_xact_lock to serialize number generation per prefix,
        preventing duplicate numbers when 1000+ records hit concurrently.
        Lock is auto-released on COMMIT/ROLLBACK.
        """
        from sqlalchemy import text
        today = tz.today()
        full_prefix = f"{prefix}-{today.strftime('%Y%m')}-"
        # Advisory lock keyed on prefix — same pattern as cashbook
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": full_prefix})
        last = self.db.query(JournalEntry).filter(
            JournalEntry.journal_entry_no.like(f"{full_prefix}%")
        ).order_by(JournalEntry.journal_entry_no.desc()).first()

        if last and last.journal_entry_no.startswith(full_prefix):
            try:
                seq = int(last.journal_entry_no.split("-")[-1]) + 1
            except (ValueError, IndexError):
                seq = 1
        else:
            seq = 1
        return f"{full_prefix}{seq:04d}"

    def _check_already_posted(self, reference_id: int, description_marker: str) -> bool:
        """Has this exact transaction already been posted to GL?

        Matches on the integer ``reference_id`` recorded on the JE lines (so
        ``GRN ID: 5`` no longer also matches 50/500) further constrained by the
        description marker to tell apart different posting types sharing an id.
        """
        q = (
            self.db.query(JournalEntry.id)
            .join(JournalEntryLine, JournalEntryLine.journal_entry_id == JournalEntry.id)
            .filter(
                JournalEntryLine.reference_id == reference_id,
                JournalEntry.entry_type == "Auto",
                JournalEntry.description.ilike(f"%{description_marker}%"),
            )
        )
        return self.db.query(q.exists()).scalar()

    def _create_je_and_post(
        self,
        entry_date: date,
        description: str,
        lines: List[Dict[str, Any]],
        branch_code: Optional[str],
        user_id: int,
        je_prefix: str = "JE-PUR",
        transaction_type: str = "Purchase",
        reference_type: str = "PO",
        reference_id: Optional[int] = None,
        reference_no: Optional[str] = None,
    ) -> Optional[JournalEntry]:
        """
        Build + post a balanced JE through the central :class:`GLPostingService`.

        Thin wrapper kept so the many call sites in this module stay unchanged.
        All correctness rules now live in one place: *missing account = recorded
        failure* (never a silent skip), sub-cent rounding posted to the dedicated
        ``5900 Rounding Difference`` account, closed-period blocking, and durable
        failure recording for later retry.
        """
        result = self._gl.post(
            reference_type=reference_type,
            reference_id=reference_id,
            reference_no=reference_no,
            lines=lines,
            entry_date=entry_date,
            description=description,
            branch_code=branch_code,
            user_id=user_id,
            transaction_type=transaction_type,
            je_prefix=je_prefix,
            source_module="purchasing",
            # Public post_* methods already guard with _check_already_posted.
            idempotent=False,
            record_failure=True,
        )
        if result.failed:
            logger.error(
                "GL posting failed for %s#%s (%s): %s",
                reference_type, reference_id, result.error_code, result.error_message,
            )
        return result.journal_entry

    # ═══════════════════════════════════════════════════════════════════════
    # SCENARIO 31: PURCHASE TRANSACTIONS
    # ═══════════════════════════════════════════════════════════════════════

    def post_grn_to_gl(self, grn, user_id: int) -> Optional[JournalEntry]:
        """
        Post GRN (Goods Received Note) to GL.
        
        For cash/bank/cheque PO:
            Dr 1210 Inventory / Cr 1020 Bank Account
        For credit PO:
            Dr 1210 Inventory / Cr 2010 Trade Creditors
        """
        from app.modules.purchasing.models import (
            PurchasingOrder, PurchasingOrderItems, GoodReceivedItems
        )

        marker = f"GRN ID: {grn.id}"
        if self._check_already_posted(grn.id, marker):
            logger.info(f"GRN {grn.good_received_no} already posted to GL - skipping")
            return None

        # Get PO and calculate total
        po = self.db.query(PurchasingOrder).filter(
            PurchasingOrder.id == grn.purchasingorders_id
        ).first()
        if not po:
            return None

        # Calculate GRN total from GRN items → PO items
        grn_items = self.db.query(GoodReceivedItems).filter(
            GoodReceivedItems.good_received_note == grn.good_received_no,
            GoodReceivedItems.active == True,
        ).all()

        purchase_amount = Decimal("0")
        po_item_ids = set()
        for item in grn_items:
            po_item_ids.add(item.purchasing_order_items_id)

        for po_item_id in po_item_ids:
            po_item = self.db.query(PurchasingOrderItems).filter(
                PurchasingOrderItems.id == po_item_id
            ).first()
            if po_item:
                # Count received items for this PO item in this GRN
                received_count = sum(
                    1 for gi in grn_items
                    if gi.purchasing_order_items_id == po_item_id
                )
                purchase_amount += Decimal(str(po_item.unit_price)) * Decimal(str(received_count))

        if purchase_amount <= 0:
            return None

        payment_method = (po.payment_method or "").lower()
        is_credit = payment_method == "credit"
        is_advance = payment_method == "advance"

        # Determine credit account based on PO payment method
        if is_credit:
            credit_account = ACCT_TRADE_CREDITORS
            credit_desc = "Trade creditor"
        elif is_advance:
            credit_account = ACCT_SUPPLIER_ADVANCES
            credit_desc = "Advance applied to purchase"
        else:
            credit_account = ACCT_BANK_ACCOUNT
            credit_desc = "Payment to supplier"

        lines = [
            {
                "account_code": ACCT_FINISHED_GOODS,
                "debit": purchase_amount,
                "credit": Decimal("0"),
                "description": f"Inventory purchase - PO #{po.purchasing_order_no}",
            },
            {
                "account_code": credit_account,
                "debit": Decimal("0"),
                "credit": purchase_amount,
                "description": f"{credit_desc} - PO #{po.purchasing_order_no}",
            },
        ]

        description = (
            f"Auto GL - GRN Received | GRN: {grn.good_received_no} | "
            f"PO: {po.purchasing_order_no} | Amount: {purchase_amount} | "
            f"GRN ID: {grn.id}"
        )

        je = self._create_je_and_post(
            entry_date=grn.good_received_date or tz.today(),
            description=description,
            lines=lines,
            branch_code=grn.branch_code,
            user_id=user_id,
            je_prefix="JE-PUR",
            transaction_type="Purchase",
            reference_type="GRN",
            reference_id=grn.id,
            reference_no=grn.good_received_no,
        )

        if je:
            logger.info(
                f"✅ GL Posted: GRN {grn.good_received_no} → JE {je.journal_entry_no} "
                f"(Dr {ACCT_FINISHED_GOODS} / Cr {credit_account} = {purchase_amount})"
            )
        return je

    def post_supplier_advance_to_gl(self, advance, user_id: int) -> Optional[JournalEntry]:
        """
        Post supplier advance payment to GL.
        Dr 2020 Supplier Advances / Cr 1020 Bank Account
        """
        marker = f"Advance ID: {advance.id}"
        if self._check_already_posted(advance.id, marker):
            return None

        amount = Decimal(str(advance.original_amount or 0))
        if amount <= 0:
            return None

        payment_method = (advance.payment_method or "").lower()
        credit_account = ACCT_CASH_ON_HAND if payment_method == "cash" else ACCT_BANK_ACCOUNT

        lines = [
            {
                "account_code": ACCT_SUPPLIER_ADVANCES,
                "debit": amount,
                "credit": Decimal("0"),
                "description": f"Advance to supplier - {advance.advance_no}",
            },
            {
                "account_code": credit_account,
                "debit": Decimal("0"),
                "credit": amount,
                "description": f"Payment for advance - {advance.advance_no}",
            },
        ]

        description = (
            f"Auto GL - Supplier Advance | Advance: {advance.advance_no} | "
            f"Amount: {amount} | Advance ID: {advance.id}"
        )

        je = self._create_je_and_post(
            entry_date=advance.payment_date or tz.today(),
            description=description,
            lines=lines,
            branch_code=advance.branch_code,
            user_id=user_id,
            je_prefix="JE-ADV",
            transaction_type="Payment",
            reference_type="SupplierAdvance",
            reference_id=advance.id,
            reference_no=advance.advance_no,
        )

        if je:
            logger.info(f"✅ GL Posted: Supplier Advance {advance.advance_no} → JE {je.journal_entry_no}")
        return je

    def post_supplier_advance_return_to_gl(
        self,
        advance,
        return_amount: Decimal,
        return_date,
        return_method: str,
        user_id: int,
    ) -> Optional[JournalEntry]:
        """
        Post supplier advance return (supplier refunds unused advance) to GL.
        Reverses the original advance entry:
            Dr 1020 Bank Account (or Cash)  ...  return_amount
            Cr 2020 Supplier Advances       ...  return_amount
        """
        amount = Decimal(str(return_amount))
        if amount <= 0:
            return None

        debit_account = ACCT_CASH_ON_HAND if (return_method or "").lower() == "cash" else ACCT_BANK_ACCOUNT

        lines = [
            {
                "account_code": debit_account,
                "debit": amount,
                "credit": Decimal("0"),
                "description": f"Advance return received - {advance.advance_no}",
            },
            {
                "account_code": ACCT_SUPPLIER_ADVANCES,
                "debit": Decimal("0"),
                "credit": amount,
                "description": f"Advance returned by supplier - {advance.advance_no}",
            },
        ]

        description = (
            f"Auto GL - Supplier Advance Return | Advance: {advance.advance_no} | "
            f"Return: {amount} | Advance ID: {advance.id}"
        )

        je = self._create_je_and_post(
            entry_date=return_date or tz.today(),
            description=description,
            lines=lines,
            branch_code=advance.branch_code,
            user_id=user_id,
            je_prefix="JE-ADV",
            transaction_type="Payment",
            reference_type="SupplierAdvanceReturn",
            reference_id=advance.id,
            reference_no=advance.advance_no,
        )

        if je:
            logger.info(f"✅ GL Posted: Supplier Advance Return {advance.advance_no} → JE {je.journal_entry_no}")
        return je

    def post_advance_application_to_gl(self, application, user_id: int) -> Optional[JournalEntry]:
        """
        Post advance application (when advance is applied against GRN).
        Dr 1210 Inventory / Cr 2020 Supplier Advances
        """
        from app.modules.purchasing.models import GoodReceivedNote
        from app.modules.purchasing.invoice_models import PurchaseInvoice

        marker = f"AdvApp ID: {application.id}"
        if self._check_already_posted(application.id, marker):
            return None

        amount = Decimal(str(application.applied_amount or 0))
        if amount <= 0:
            return None

        if application.grn_id:
            # Advance applied at goods-receipt time -> funds inventory.
            #   Dr 1210 Inventory / Cr 2020 Supplier Advances
            grn = self.db.query(GoodReceivedNote).filter(
                GoodReceivedNote.id == application.grn_id
            ).first()
            grn_no = grn.good_received_no if grn else "N/A"
            branch_code = grn.branch_code if grn else None
            debit_account = ACCT_FINISHED_GOODS
            debit_desc = f"Advance applied to inventory - GRN {grn_no}"
            credit_desc = f"Advance consumed - GRN {grn_no}"
            ref_no = grn_no
            marker_ref = f"GRN: {grn_no}"
        else:
            # Advance applied against a supplier bill -> settles the payable.
            #   Dr 2010 Trade Creditors / Cr 2020 Supplier Advances
            invoice = self.db.query(PurchaseInvoice).filter(
                PurchaseInvoice.id == application.purchase_invoice_id
            ).first()
            inv_no = invoice.invoice_no if invoice else "N/A"
            branch_code = invoice.branch_code if invoice else None
            debit_account = ACCT_TRADE_CREDITORS
            debit_desc = f"Advance applied to payable - Invoice {inv_no}"
            credit_desc = f"Advance consumed - Invoice {inv_no}"
            ref_no = inv_no
            marker_ref = f"Invoice: {inv_no}"

        lines = [
            {
                "account_code": debit_account,
                "debit": amount,
                "credit": Decimal("0"),
                "description": debit_desc,
            },
            {
                "account_code": ACCT_SUPPLIER_ADVANCES,
                "debit": Decimal("0"),
                "credit": amount,
                "description": credit_desc,
            },
        ]

        description = (
            f"Auto GL - Advance Application | {marker_ref} | "
            f"Amount: {amount} | AdvApp ID: {application.id}"
        )

        je = self._create_je_and_post(
            entry_date=application.application_date or tz.today(),
            description=description,
            lines=lines,
            branch_code=branch_code,
            user_id=user_id,
            je_prefix="JE-ADV",
            transaction_type="Purchase",
            reference_type="AdvanceApplication",
            reference_id=application.id,
            reference_no=ref_no,
        )

        if je:
            logger.info(f"✅ GL Posted: Advance Application → JE {je.journal_entry_no}")
        return je

    def post_credit_settlement_to_gl(self, settlement, user_id: int) -> Optional[JournalEntry]:
        """
        Post credit purchase settlement (payment to supplier).
        Dr 2010 Trade Creditors / Cr 1020 Bank Account
        """
        marker = f"CreditSettle ID: {settlement.id}"
        if self._check_already_posted(settlement.id, marker):
            return None

        # Sum up settlement transactions, grouped by payment method
        total_cash = Decimal("0")
        total_bank = Decimal("0")
        for txn in (settlement.transactions or []):
            amount = Decimal(str(txn.payment_amount or 0))
            txn_method = (getattr(txn, "payment_method", "") or "").lower()
            if txn_method == "cash":
                total_cash += amount
            else:
                total_bank += amount

        total_payment = total_cash + total_bank
        if total_payment <= 0:
            return None

        lines = [
            {
                "account_code": ACCT_TRADE_CREDITORS,
                "debit": total_payment,
                "credit": Decimal("0"),
                "description": f"Credit settlement - {settlement.supplier_credits_settle_no}",
            },
        ]
        if total_cash > 0:
            lines.append({
                "account_code": ACCT_CASH_ON_HAND,
                "debit": Decimal("0"),
                "credit": total_cash,
                "description": f"Cash payment to supplier - {settlement.supplier_credits_settle_no}",
            })
        if total_bank > 0:
            lines.append({
                "account_code": ACCT_BANK_ACCOUNT,
                "debit": Decimal("0"),
                "credit": total_bank,
                "description": f"Bank payment to supplier - {settlement.supplier_credits_settle_no}",
            })

        description = (
            f"Auto GL - Credit Settlement | Settle: {settlement.supplier_credits_settle_no} | "
            f"Amount: {total_payment} | CreditSettle ID: {settlement.id}"
        )

        je = self._create_je_and_post(
            entry_date=tz.today(),
            description=description,
            lines=lines,
            branch_code=settlement.branch_code,
            user_id=user_id,
            je_prefix="JE-PUR",
            transaction_type="Payment",
            reference_type="CreditSettle",
            reference_id=settlement.id,
            reference_no=settlement.supplier_credits_settle_no,
        )

        if je:
            logger.info(f"✅ GL Posted: Credit Settlement {settlement.supplier_credits_settle_no} → JE {je.journal_entry_no}")
        return je

    def post_supplier_payment_to_gl(self, payment, user_id: int) -> Optional[JournalEntry]:
        """
        Post supplier payment (general payment to supplier).
        Dr 2010 Trade Creditors / Cr 1020 Bank Account (or 1010 Cash)
        """
        marker = f"SupPayment ID: {payment.id}"
        if self._check_already_posted(payment.id, marker):
            return None

        amount = Decimal(str(payment.payment_amount or 0))
        if amount <= 0:
            return None

        payment_method = (payment.payment_method or "").lower()
        credit_account = ACCT_CASH_ON_HAND if payment_method == "cash" else ACCT_BANK_ACCOUNT

        po_ref = ""
        if payment.purchasing_order:
            po_ref = f" PO: {payment.purchasing_order.purchasing_order_no}"

        lines = [
            {
                "account_code": ACCT_TRADE_CREDITORS,
                "debit": amount,
                "credit": Decimal("0"),
                "description": f"Supplier payment - {payment.payment_no}{po_ref}",
            },
            {
                "account_code": credit_account,
                "debit": Decimal("0"),
                "credit": amount,
                "description": f"Payment to supplier - {payment.payment_no}",
            },
        ]

        description = (
            f"Auto GL - Supplier Payment | Payment: {payment.payment_no} | "
            f"Amount: {amount} | SupPayment ID: {payment.id}"
        )

        je = self._create_je_and_post(
            entry_date=payment.payment_date or tz.today(),
            description=description,
            lines=lines,
            branch_code=payment.branch_code,
            user_id=user_id,
            je_prefix="JE-PUR",
            transaction_type="Payment",
            reference_type="SupplierPayment",
            reference_id=payment.id,
            reference_no=payment.payment_no,
        )

        if je:
            logger.info(f"✅ GL Posted: Supplier Payment {payment.payment_no} → JE {je.journal_entry_no}")
        return je

    # ═══════════════════════════════════════════════════════════════════════
    # SCENARIO 32: EXPENSES
    # ═══════════════════════════════════════════════════════════════════════

    def post_expense_to_gl(self, expense, user_id: int) -> Optional[JournalEntry]:
        """
        Post paid expense to GL.
        Dr 5xxx Expense Account (mapped from expense_category) / Cr 1020 Bank Account
        """
        marker = f"Expense ID: {expense.id}"
        if self._check_already_posted(expense.id, marker):
            return None

        amount = Decimal(str(expense.expense_amount or 0))
        if amount <= 0:
            return None

        # Map expense category to COA account
        category = (expense.expense_category or "miscellaneous").lower().strip()
        expense_account = EXPENSE_CATEGORY_MAP.get(category, "5100")

        # If expense has an explicit account_code, use that
        if expense.account_code:
            expense_account = expense.account_code

        # Determine payment account
        payment_method = (expense.payment_method or expense.expenses_method or "").lower()
        credit_account = ACCT_CASH_ON_HAND if payment_method == "cash" else ACCT_BANK_ACCOUNT

        lines = [
            {
                "account_code": expense_account,
                "debit": amount,
                "credit": Decimal("0"),
                "description": f"{expense.expense_category or 'Expense'} - {expense.expenses_no}",
            },
            {
                "account_code": credit_account,
                "debit": Decimal("0"),
                "credit": amount,
                "description": f"Payment for {expense.expense_category or 'expense'} - {expense.expenses_no}",
            },
        ]

        description = (
            f"Auto GL - Expense | Expense: {expense.expenses_no} | "
            f"Category: {expense.expense_category} | Amount: {amount} | "
            f"Expense ID: {expense.id}"
        )

        je = self._create_je_and_post(
            entry_date=expense.expense_date or expense.payment_date or tz.today(),
            description=description,
            lines=lines,
            branch_code=expense.branch_code,
            user_id=user_id,
            je_prefix="JE-EXP",
            transaction_type="Expense",
            reference_type="Expense",
            reference_id=expense.id,
            reference_no=expense.expenses_no,
        )

        if je:
            logger.info(
                f"✅ GL Posted: Expense {expense.expenses_no} → JE {je.journal_entry_no} "
                f"(Dr {expense_account} / Cr {credit_account})"
            )
        return je

    # ═══════════════════════════════════════════════════════════════════════
    # SCENARIO 32: PAYROLL
    # ═══════════════════════════════════════════════════════════════════════

    def post_payroll_batch_to_gl(self, batch, user_id: int) -> Optional[JournalEntry]:
        """
        Post payroll batch to GL when salary payments are processed.
        
        Creates a single consolidated journal entry for the entire batch:
        Dr  5110  Salaries Expense .......... total_gross_salary
        Dr  5210  EPF Employer Expense ...... total_employer_epf
        Dr  5220  ETF Employer Expense ...... total_employer_etf
        Cr  2110  Salaries Payable .......... total_net_salary
        Cr  2120  EPF Payable ............... employee_epf + employer_epf
        Cr  2130  ETF Payable ............... employee_etf + employer_etf
        Cr  2140  Other Payroll Deductions .. stamp + late + advance + loan + other
        Cr  2150  APIT Payable .............. total_apit
        """
        from app.modules.hr.models import PayrollBatch
        from app.modules.employees.models import EmployeePayroll

        marker = f"PayrollBatch ID: {batch.id}"
        if self._check_already_posted(batch.id, marker):
            logger.info(f"Payroll batch {batch.batch_no} already posted to GL - skipping")
            return None

        # Get all payroll records for this batch
        if isinstance(batch, PayrollBatch):
            payrolls = self.db.query(EmployeePayroll).filter(
                EmployeePayroll.payroll_batch_no == batch.batch_no
            ).all()
        else:
            payrolls = []

        if not payrolls:
            return None

        # Aggregate totals
        total_gross = Decimal("0")
        total_net = Decimal("0")
        total_epf_employee = Decimal("0")
        total_etf_employee = Decimal("0")
        total_epf_employer = Decimal("0")
        total_etf_employer = Decimal("0")
        total_stamp = Decimal("0")
        total_late = Decimal("0")
        total_advance_repay = Decimal("0")
        total_loan_repay = Decimal("0")
        total_other = Decimal("0")
        total_apit = Decimal("0")

        for p in payrolls:
            total_gross += Decimal(str(p.gross_salary or 0))
            total_net += Decimal(str(p.net_salary or 0))
            total_epf_employee += Decimal(str(p.less_epf_employee or 0))
            total_etf_employee += Decimal(str(p.less_etf_employee or 0))
            total_epf_employer += Decimal(str(p.epf_employer or 0))
            total_etf_employer += Decimal(str(p.etf_employer or 0))
            total_stamp += Decimal(str(p.less_stamp_duty or 0))
            total_late += Decimal(str(p.less_late_deductions or 0))
            total_advance_repay += Decimal(str(p.less_salary_advance_repayment or 0))
            total_loan_repay += Decimal(str(p.less_loan_repayment or 0))
            total_other += Decimal(str(p.less_other_deductions or 0))
            total_apit += Decimal(str(p.less_apit or 0))

        # Combined EPF/ETF totals
        total_epf = total_epf_employee + total_epf_employer
        total_etf = total_etf_employee + total_etf_employer
        total_other_deductions = total_stamp + total_late + total_advance_repay + total_loan_repay + total_other

        period_str = f"{batch.payroll_year}-{batch.payroll_month:02d}"

        lines = []

        # DEBIT side: Expenses
        if total_gross > 0:
            lines.append({
                "account_code": ACCT_SALARIES_EXPENSE,
                "debit": total_gross,
                "credit": Decimal("0"),
                "description": f"Gross salary - {period_str}",
            })

        if total_epf_employer > 0:
            lines.append({
                "account_code": ACCT_EPF_EMPLOYER_EXPENSE,
                "debit": total_epf_employer,
                "credit": Decimal("0"),
                "description": f"Employer EPF contribution - {period_str}",
            })

        if total_etf_employer > 0:
            lines.append({
                "account_code": ACCT_ETF_EMPLOYER_EXPENSE,
                "debit": total_etf_employer,
                "credit": Decimal("0"),
                "description": f"Employer ETF contribution - {period_str}",
            })

        # CREDIT side: Liabilities
        if total_net > 0:
            lines.append({
                "account_code": ACCT_SALARIES_PAYABLE,
                "debit": Decimal("0"),
                "credit": total_net,
                "description": f"Net salary payable - {period_str}",
            })

        if total_epf > 0:
            lines.append({
                "account_code": ACCT_EPF_PAYABLE,
                "debit": Decimal("0"),
                "credit": total_epf,
                "description": f"EPF payable (employee + employer) - {period_str}",
            })

        if total_etf > 0:
            lines.append({
                "account_code": ACCT_ETF_PAYABLE,
                "debit": Decimal("0"),
                "credit": total_etf,
                "description": f"ETF payable (employee + employer) - {period_str}",
            })

        if total_other_deductions > 0:
            lines.append({
                "account_code": ACCT_OTHER_PAYROLL_DEDUCTIONS,
                "debit": Decimal("0"),
                "credit": total_other_deductions,
                "description": f"Payroll deductions (stamp, late, advances, loans) - {period_str}",
            })

        if total_apit > 0:
            lines.append({
                "account_code": ACCT_APIT_PAYABLE,
                "debit": Decimal("0"),
                "credit": total_apit,
                "description": f"APIT payable - {period_str}",
            })

        description = (
            f"Auto GL - Payroll | Batch: {batch.batch_no} | "
            f"Period: {period_str} | Gross: {total_gross} | Net: {total_net} | "
            f"Employees: {len(payrolls)} | PayrollBatch ID: {batch.id}"
        )

        je = self._create_je_and_post(
            entry_date=batch.salary_payment_date or tz.today(),
            description=description,
            lines=lines,
            branch_code=None,  # Payroll is company-wide
            user_id=user_id,
            je_prefix="JE-PAY",
            transaction_type="Payroll",
            reference_type="PayrollBatch",
            reference_id=batch.id,
            reference_no=batch.batch_no,
        )

        if je:
            logger.info(
                f"✅ GL Posted: Payroll {batch.batch_no} → JE {je.journal_entry_no} "
                f"(Gross: {total_gross}, Net: {total_net}, EPF: {total_epf}, ETF: {total_etf})"
            )
        return je

    # ═══════════════════════════════════════════════════════════════════════
    # SCENARIO 32: COMMISSION PAYMENTS
    # ═══════════════════════════════════════════════════════════════════════

    def post_commission_payment_to_gl(self, payment, user_id: int) -> Optional[JournalEntry]:
        """
        Post customer agent commission payment to GL.
        Dr 5150 Commission Expense / Cr 1020 Bank Account
        """
        marker = f"CommPayment ID: {payment.id}"
        if self._check_already_posted(payment.id, marker):
            return None

        amount = Decimal(str(payment.payment_amount or 0))
        if amount <= 0:
            return None

        payment_method = (payment.payment_method or "").lower()
        credit_account = ACCT_CASH_ON_HAND if payment_method == "cash" else ACCT_BANK_ACCOUNT

        lines = [
            {
                "account_code": ACCT_COMMISSION_EXPENSE,
                "debit": amount,
                "credit": Decimal("0"),
                "description": f"Agent commission payment - {payment.payment_no}",
            },
            {
                "account_code": credit_account,
                "debit": Decimal("0"),
                "credit": amount,
                "description": f"Commission payment - {payment.payment_no}",
            },
        ]

        description = (
            f"Auto GL - Commission Payment | Payment: {payment.payment_no} | "
            f"Amount: {amount} | CommPayment ID: {payment.id}"
        )

        je = self._create_je_and_post(
            entry_date=payment.payment_date or tz.today(),
            description=description,
            lines=lines,
            branch_code=payment.branch_code,
            user_id=user_id,
            je_prefix="JE-COM",
            transaction_type="Expense",
            reference_type="CommissionPayment",
            reference_id=payment.id,
            reference_no=payment.payment_no,
        )

        if je:
            logger.info(f"✅ GL Posted: Commission Payment {payment.payment_no} → JE {je.journal_entry_no}")
        return je

    # ═══════════════════════════════════════════════════════════════════════
    # PURCHASE RETURNS
    # ═══════════════════════════════════════════════════════════════════════

    def post_purchase_return_to_gl(self, purchase_return, user_id: int) -> Optional[JournalEntry]:
        """
        Post purchase return to GL when approved.
        Reverses the original GRN entry:

        Dr  2010  Trade Creditors (AP) ....... return_total
        Cr  1210  Finished Goods Inventory ... return_total

        For cash purchases (GRN was cash/bank):
        Dr  1020  Bank Account ............... return_total
        Cr  1210  Finished Goods Inventory ... return_total
        """
        marker = f"PurchaseReturn ID: {purchase_return.id}"
        if self._check_already_posted(purchase_return.id, marker):
            return None

        # Calculate total return amount from items
        total_return = Decimal("0")
        for item in (purchase_return.items or []):
            total_return += Decimal(str(item.return_price or item.purchasing_price or 0))

        if total_return <= 0:
            return None

        # Determine debit account based on original GRN/PO payment method
        debit_account = ACCT_TRADE_CREDITORS  # Default: credit purchase
        grn = getattr(purchase_return, "good_received_note", None)
        if grn:
            from app.modules.purchasing.models import PurchasingOrder
            po = self.db.query(PurchasingOrder).filter(
                PurchasingOrder.id == grn.purchasingorders_id
            ).first()
            if po:
                payment_method = (getattr(po, "payment_method", "") or "").lower()
                if payment_method in ("cash", "bank", "cheque"):
                    debit_account = ACCT_BANK_ACCOUNT
                elif payment_method == "advance":
                    debit_account = ACCT_SUPPLIER_ADVANCES

        return_no = purchase_return.purchasing_return_no or f"PR-{purchase_return.id}"

        lines = [
            {
                "account_code": debit_account,
                "debit": total_return,
                "credit": Decimal("0"),
                "description": f"Purchase return {return_no} - reduce payable/receive refund",
            },
            {
                "account_code": ACCT_FINISHED_GOODS,
                "debit": Decimal("0"),
                "credit": total_return,
                "description": f"Inventory returned to supplier - {return_no}",
            },
        ]

        description = (
            f"Auto GL - Purchase Return | Return: {return_no} | "
            f"Amount: {total_return} | PurchaseReturn ID: {purchase_return.id}"
        )

        je = self._create_je_and_post(
            entry_date=getattr(purchase_return, "approved_date", None) or tz.today(),
            description=description,
            lines=lines,
            branch_code=purchase_return.branch_code,
            user_id=user_id,
            je_prefix="JE-PUR",
            transaction_type="Purchase",
            reference_type="PurchaseReturn",
            reference_id=purchase_return.id,
            reference_no=return_no,
        )

        if je:
            logger.info(
                f"✅ GL Posted: Purchase Return {return_no} → JE {je.journal_entry_no} "
                f"(Dr {debit_account} / Cr 1210) Amount: {total_return}"
            )
        return je

    # ═══════════════════════════════════════════════════════════════════════
    # BANK DEPOSIT VERIFICATION GL
    # ═══════════════════════════════════════════════════════════════════════

    def post_bank_deposit_to_gl(self, deposit, user_id: int) -> Optional[JournalEntry]:
        """
        Post bank deposit verification to GL.
        Dr  1020  Bank Account ............. deposit_amount
        Cr  1010  Cash on Hand ............. deposit_amount

        Called when a bank deposit is verified (cash deposited into bank).
        """
        # Do not post bank deposits to GL for bank transfers (which go directly to the bank, not cashbox)
        if getattr(deposit, "payment_for", None) in ("Sales Invoice", "Credit Settlement"):
            logger.info(f"Skipping GL posting for bank transfer BankDeposit {deposit.id}")
            return None

        marker = f"BankDeposit ID: {deposit.id}"
        if self._check_already_posted(deposit.id, marker):
            return None

        amount = Decimal(str(deposit.deposits_amount or 0))
        if amount <= 0:
            return None

        lines = [
            {
                "account_code": ACCT_BANK_ACCOUNT,
                "debit": amount,
                "credit": Decimal("0"),
                "description": f"Bank deposit verified - {getattr(deposit, 'invoice_no', '')}",
            },
            {
                "account_code": ACCT_CASH_ON_HAND,
                "debit": Decimal("0"),
                "credit": amount,
                "description": f"Cash deposited to bank - {getattr(deposit, 'invoice_no', '')}",
            },
        ]

        description = (
            f"Auto GL - Bank Deposit Verified | Amount: {amount} | "
            f"Bank: {getattr(deposit, 'bank_name', '')} | BankDeposit ID: {deposit.id}"
        )

        je = self._create_je_and_post(
            entry_date=getattr(deposit, "created_date", None) or tz.today(),
            description=description,
            lines=lines,
            branch_code=getattr(deposit, "branch_code", None) or "HQ",
            user_id=user_id,
            je_prefix="JE-BNK",
            transaction_type="Banking",
            reference_type="BankDeposit",
            reference_id=deposit.id,
            reference_no=getattr(deposit, "invoice_no", "") or f"DEP-{deposit.id}",
        )

        if je:
            logger.info(
                f"✅ GL Posted: Bank Deposit {deposit.id} → JE {je.journal_entry_no} "
                f"(Dr 1020 / Cr 1010) Amount: {amount}"
            )
        return je

    # ═══════════════════════════════════════════════════════════════════════
    # REIMBURSEMENT PAYMENT GL (Gap B1)
    # ═══════════════════════════════════════════════════════════════════════

    def post_reimbursement_payment_to_gl(
        self, reimbursement, user_id: int
    ) -> Optional[JournalEntry]:
        """
        Post reimbursement payment to GL.
        Dr  5xxx  Expense Account (based on type) ... paid_amount
        Cr  1010  Cash / 1020 Bank ................ paid_amount

        Called when a reimbursement is paid to employee.
        """
        marker = f"ReimbursementPayment ID: {reimbursement.id}"
        if self._check_already_posted(reimbursement.id, marker):
            return None

        amount = Decimal(str(reimbursement.paid_amount or reimbursement.approved_amount or 0))
        if amount <= 0:
            return None

        # Map reimbursement type to expense account
        reimbursement_type = getattr(reimbursement, "reimbursement_type", "general") or "general"
        expense_account = EXPENSE_CATEGORY_MAP.get(reimbursement_type.lower(), "5100")

        # Determine credit account based on payment method
        payment_method = getattr(reimbursement, "payment_method", "bank") or "bank"
        if payment_method.lower() in ("cash", "petty_cash"):
            credit_account = ACCT_CASH_ON_HAND
        else:
            credit_account = ACCT_BANK_ACCOUNT

        lines = [
            {
                "account_code": expense_account,
                "debit": amount,
                "credit": Decimal("0"),
                "description": f"Reimbursement: {reimbursement.reimbursement_no} - {reimbursement.description or ''}",
            },
            {
                "account_code": credit_account,
                "debit": Decimal("0"),
                "credit": amount,
                "description": f"Payment for reimbursement {reimbursement.reimbursement_no}",
            },
        ]

        description = (
            f"Auto GL - Reimbursement Paid | {reimbursement.reimbursement_no} | "
            f"Type: {reimbursement_type} | Amount: {amount} | "
            f"ReimbursementPayment ID: {reimbursement.id}"
        )

        je = self._create_je_and_post(
            entry_date=getattr(reimbursement, "payment_date", None) or tz.today(),
            description=description,
            lines=lines,
            branch_code=getattr(reimbursement, "branch_code", None),
            user_id=user_id,
            je_prefix="JE-RMB",
            transaction_type="HR",
            reference_type="Reimbursement",
            reference_id=reimbursement.id,
            reference_no=reimbursement.reimbursement_no,
        )

        if je:
            logger.info(
                f"✅ GL Posted: Reimbursement {reimbursement.reimbursement_no} → JE {je.journal_entry_no} "
                f"(Dr {expense_account} / Cr {credit_account}) Amount: {amount}"
            )
        return je

    # ═══════════════════════════════════════════════════════════════════════
    # CUSTOMER ADVANCE PAYMENT RECEIPT GL (Gap B2)
    # ═══════════════════════════════════════════════════════════════════════

    def post_customer_advance_receipt_to_gl(
        self, advance, user_id: int
    ) -> Optional[JournalEntry]:
        """
        Post customer advance payment receipt to GL.
        Dr  1010 Cash / 1020 Bank (cheque/card/transfer) .. payment_amount
        Cr  2520 Customer Deposits (Liability) ........... payment_amount

        Called when a customer advance payment is received.

        Cheque/card/bank-transfer receipts post to Bank (1020) — the same
        convention as sales — so GL cash/bank (1010+1020) stays in lock-step
        with the cashbook (which records every receipt as a single money_in)
        and day-end reconciliation balances.
        """
        marker = f"CustomerAdvanceReceipt ID: {advance.id}"
        if self._check_already_posted(advance.id, marker):
            return None

        amount = Decimal(str(advance.payment_amount or 0))
        if amount <= 0:
            return None

        # Determine debit account based on payment method.
        # Cash -> 1010; everything else (cheque/card/bank transfer) -> 1020 Bank,
        # matching the sales flow and the cashbook so day-end reconciliation
        # (which sums only 1010+1020) balances.
        payment_method = getattr(advance, "payment_method", "cash") or "cash"
        payment_method_lower = payment_method.lower()
        if payment_method_lower in ("cash", "petty_cash"):
            debit_account = ACCT_CASH_ON_HAND
        else:
            debit_account = ACCT_BANK_ACCOUNT

        # Customer Advances/Deposits Liability account (2520 = Customer Deposits)
        customer_advances_account = "2520"

        lines = [
            {
                "account_code": debit_account,
                "debit": amount,
                "credit": Decimal("0"),
                "description": f"Customer advance received - {advance.advance_payments_no}",
            },
            {
                "account_code": customer_advances_account,
                "debit": Decimal("0"),
                "credit": amount,
                "description": f"Customer advance liability - {advance.advance_payments_no}",
            },
        ]

        description = (
            f"Auto GL - Customer Advance Received | {advance.advance_payments_no} | "
            f"Customer ID: {advance.customer_id} | Amount: {amount} | "
            f"CustomerAdvanceReceipt ID: {advance.id}"
        )

        je = self._create_je_and_post(
            entry_date=getattr(advance, "created_date", None) or tz.today(),
            description=description,
            lines=lines,
            branch_code=getattr(advance, "branch_code", None),
            user_id=user_id,
            je_prefix="JE-CAD",
            transaction_type="Sales",
            reference_type="CustomerAdvance",
            reference_id=advance.id,
            reference_no=advance.advance_payments_no,
        )

        if je:
            logger.info(
                f"✅ GL Posted: Customer Advance {advance.advance_payments_no} → JE {je.journal_entry_no} "
                f"(Dr {debit_account} / Cr {customer_advances_account}) Amount: {amount}"
            )
        return je

    # ═══════════════════════════════════════════════════════════════════════
    # CUSTOMER CREDIT SETTLEMENT GL (Gap B3)
    # ═══════════════════════════════════════════════════════════════════════

    def post_customer_credit_settlement_to_gl(
        self, settlement, transactions, user_id: int
    ) -> Optional[JournalEntry]:
        """
        Post customer credit settlement to GL.
        Dr  1010 Cash / 1020 Bank (cheque/card/transfer) .. total_payment
        Cr  1110 Trade Debtors (A/R) ..................... total_payment
        Cr  4110 Other Income ........................... card surcharge (if any)

        Called when a customer pays for credit invoices.

        Cheque/card/bank-transfer payments post to Bank (1020) — the same
        convention as sales — so GL cash/bank (1010+1020) stays in lock-step
        with the cashbook and day-end reconciliation balances.
        """
        marker = f"CustomerCreditSettlement ID: {settlement.id}"
        if self._check_already_posted(settlement.id, marker):
            return None

        # Calculate total from transactions
        total_amount = sum(
            Decimal(str(getattr(t, "payment_amount", 0) or 0))
            for t in transactions
        )
        if total_amount <= 0:
            return None

        # Group by payment method and create lines
        lines = []
        payment_breakdown = {}
        total_service_charge = Decimal("0")
        for t in transactions:
            pm = getattr(t, "payment_method", "cash") or "cash"
            amt = Decimal(str(getattr(t, "payment_amount", 0) or 0))
            sc = Decimal(str(getattr(t, "service_charge_amount", 0) or 0))
            payment_breakdown[pm] = payment_breakdown.get(pm, Decimal("0")) + amt + sc
            total_service_charge += sc

        for pm, amt in payment_breakdown.items():
            if amt <= 0:
                continue
            pm_lower = pm.lower()
            if pm_lower in ("cash", "petty_cash"):
                debit_account = ACCT_CASH_ON_HAND
            else:
                # cheque / card / bank transfer -> Bank (1020), matching sales and
                # the cashbook so day-end cash reconciliation balances. Routing
                # cheques to 1030 (Petty Cash) or cards to 1040 (Cheques in Hand)
                # would leave them out of the 1010+1020 reconciliation sum.
                debit_account = ACCT_BANK_ACCOUNT

            lines.append({
                "account_code": debit_account,
                "debit": amt,
                "credit": Decimal("0"),
                "description": f"Credit settlement payment ({pm}) - {settlement.customer_credits_settle_no}",
            })

        # Credit Trade Debtors
        lines.append({
            "account_code": ACCT_TRADE_DEBTORS,
            "debit": Decimal("0"),
            "credit": total_amount,
            "description": f"Credit invoice settlement - {settlement.customer_credits_settle_no}",
        })

        # Credit Card Payment Surcharge to Other Income
        if total_service_charge > 0:
            lines.append({
                "account_code": "4110",  # Other Income
                "debit": Decimal("0"),
                "credit": total_service_charge,
                "description": f"Card payment surcharge - {settlement.customer_credits_settle_no}",
            })

        description = (
            f"Auto GL - Customer Credit Settlement | {settlement.customer_credits_settle_no} | "
            f"Customer ID: {settlement.customer_id} | Total: {total_amount} | "
            f"CustomerCreditSettlement ID: {settlement.id}"
        )

        je = self._create_je_and_post(
            entry_date=getattr(settlement, "created_date", None) or tz.today(),
            description=description,
            lines=lines,
            branch_code=getattr(settlement, "branch_code", None),
            user_id=user_id,
            je_prefix="JE-CST",
            transaction_type="Sales",
            reference_type="CustomerCreditSettlement",
            reference_id=settlement.id,
            reference_no=settlement.customer_credits_settle_no,
        )

        if je:
            logger.info(
                f"✅ GL Posted: Customer Credit Settlement {settlement.customer_credits_settle_no} "
                f"→ JE {je.journal_entry_no} | Total: {total_amount}"
            )
        return je

    # ═══════════════════════════════════════════════════════════════════════
    # CUSTOMER ADVANCE APPLICATION GL (Gap B4)
    # ═══════════════════════════════════════════════════════════════════════

    def post_customer_advance_application_to_gl(
        self, invoice, advance, applied_amount: Decimal, user_id: int
    ) -> Optional[JournalEntry]:
        """
        Post customer advance application to invoice to GL.
        Dr  2520 Customer Deposits (Liability) ... applied_amount
        Cr  1110 Trade Debtors (A/R) ............. applied_amount

        Called when a customer advance is applied to an invoice.
        """
        marker = f"CustomerAdvanceApplication InvID: {invoice.id} AdvID: {advance.id}"
        if self._check_already_posted(invoice.id, marker):
            return None

        amount = Decimal(str(applied_amount))
        if amount <= 0:
            return None

        # Customer Advances/Deposits Liability account (2520 = Customer Deposits)
        customer_advances_account = "2520"

        lines = [
            {
                "account_code": customer_advances_account,
                "debit": amount,
                "credit": Decimal("0"),
                "description": f"Advance applied - {advance.advance_payments_no} to {invoice.invoice_no}",
            },
            {
                "account_code": ACCT_TRADE_DEBTORS,
                "debit": Decimal("0"),
                "credit": amount,
                "description": f"Advance application reduces receivable - {invoice.invoice_no}",
            },
        ]

        description = (
            f"Auto GL - Customer Advance Application | Advance: {advance.advance_payments_no} | "
            f"Invoice: {invoice.invoice_no} | Applied: {amount} | "
            f"CustomerAdvanceApplication InvID: {invoice.id} AdvID: {advance.id}"
        )

        je = self._create_je_and_post(
            entry_date=tz.today(),
            description=description,
            lines=lines,
            branch_code=getattr(invoice, "branch_code", None),
            user_id=user_id,
            je_prefix="JE-CAA",
            transaction_type="Sales",
            reference_type="CustomerAdvanceApplication",
            reference_id=invoice.id,
            reference_no=invoice.invoice_no,
        )

        if je:
            logger.info(
                f"✅ GL Posted: Customer Advance Application | Advance: {advance.advance_payments_no} "
                f"→ Invoice: {invoice.invoice_no} | JE: {je.journal_entry_no} | Amount: {amount}"
            )
        return je

    def post_customer_advance_application_reversal_to_gl(
        self, invoice, advance, applied_amount: Decimal, user_id: int
    ) -> Optional[JournalEntry]:
        """
        Reverse a previously posted customer-advance application when the
        invoice it was applied to is cancelled or deleted.

        Dr  1110 Trade Debtors (A/R) ............. applied_amount
        Cr  2520 Customer Deposits (Liability) ... applied_amount

        Mirror image of ``post_customer_advance_application_to_gl`` so the
        customer's deposit liability is reinstated and the receivable that the
        application had reduced is put back before the invoice goes away.
        """
        marker = f"CustomerAdvanceApplicationReversal InvID: {invoice.id} AdvID: {advance.id}"
        if self._check_already_posted(invoice.id, marker):
            return None

        amount = Decimal(str(applied_amount))
        if amount <= 0:
            return None

        customer_advances_account = "2520"

        lines = [
            {
                "account_code": ACCT_TRADE_DEBTORS,
                "debit": amount,
                "credit": Decimal("0"),
                "description": f"Advance application reversed - {invoice.invoice_no} cancelled",
            },
            {
                "account_code": customer_advances_account,
                "debit": Decimal("0"),
                "credit": amount,
                "description": f"Advance {advance.advance_payments_no} restored - {invoice.invoice_no} cancelled",
            },
        ]

        description = (
            f"Auto GL - Customer Advance Application Reversal | Advance: {advance.advance_payments_no} | "
            f"Invoice: {invoice.invoice_no} | Restored: {amount} | "
            f"CustomerAdvanceApplicationReversal InvID: {invoice.id} AdvID: {advance.id}"
        )

        je = self._create_je_and_post(
            entry_date=tz.today(),
            description=description,
            lines=lines,
            branch_code=getattr(invoice, "branch_code", None),
            user_id=user_id,
            je_prefix="JE-CAA-REV",
            transaction_type="Sales",
            reference_type="CustomerAdvanceApplicationReversal",
            reference_id=invoice.id,
            reference_no=invoice.invoice_no,
        )

        if je:
            logger.info(
                f"✅ GL Posted: Customer Advance Application Reversal | Advance: {advance.advance_payments_no} "
                f"← Invoice: {invoice.invoice_no} | JE: {je.journal_entry_no} | Amount: {amount}"
            )
        return je
