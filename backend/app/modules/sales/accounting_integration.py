"""
Scenario 30: Sales → General Ledger Automatic Integration

Automatically posts journal entries and GL entries when sales invoices are
created (cash/card/cheque) or approved (credit/bank transfer).

Posting Logic:
─────────────────────────────────────────────────────────────────────
CASH SALE (payment_method = cash):
    Dr  1010  Cash on Hand ............. grand_total
    Cr  4010  Cash Sales ............... revenue_amount
    Cr  2210  VAT/Tax Payable .......... tax_amount (if any)

CARD SALE (visa/mastercard/amex):
    Dr  1020  Bank Account ............. grand_total
    Cr  4010  Cash Sales ............... revenue_amount
    Cr  2210  VAT/Tax Payable .......... tax_amount (if any)

CHEQUE SALE:
    Dr  1020  Bank Account ............. grand_total
    Cr  4010  Cash Sales ............... revenue_amount
    Cr  2210  VAT/Tax Payable .......... tax_amount (if any)

BANK TRANSFER SALE:
    Dr  1020  Bank Account ............. grand_total
    Cr  4010  Cash Sales ............... revenue_amount
    Cr  2210  VAT/Tax Payable .......... tax_amount (if any)

CREDIT SALE (posted on approval):
    Dr  1110  Trade Debtors ............ grand_total
    Cr  4020  Credit Sales ............. revenue_amount
    Cr  2210  VAT/Tax Payable .......... tax_amount (if any)

COGS ENTRY (for all sale types when approved/paid):
    Dr  5010  Cost of Goods Sold ....... total_cost
    Cr  1210  Finished Goods Inventory . total_cost

DISCOUNT ENTRY (if invoice discount or coupon applied):
    Dr  5160  Discount Given Expense ... discount_total
    Cr  4010/4020  Sales Revenue ....... discount_total

SERVICE CHARGE ENTRY (for card payments):
    Dr  1020  Bank Account ............. service_charge
    Cr  4110  Other Income ............. service_charge  (bank charges recovered)

VOUCHER REDEMPTION:
    Dr  2510  Gift Vouchers Outstanding  voucher_amount
    Cr  4010  Cash Sales ............... voucher_amount

SALE RETURN (reversal):
    Dr  4030  Sales Returns ............ total_refund - tax_refund
    Dr  2210  VAT/Tax Payable .......... tax_refund (if any)
    Cr  1010/1020/1110/2530 ........... total_refund (based on REFUND method)
─────────────────────────────────────────────────────────────────────
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
from app.modules.sales.models import Invoice, InvoiceItems, SaleReturn, SaleReturnItems
from app.modules.inventory.models import SalesStock
from app.modules.products.models import Product
from app.modules.finance.gl_posting_service import GLPostingService

logger = logging.getLogger(__name__)


# ─── Account Code Constants ──────────────────────────────────────────────────
ACCT_CASH_ON_HAND = "1010"
ACCT_BANK_ACCOUNT = "1020"
ACCT_TRADE_DEBTORS = "1110"
ACCT_FINISHED_GOODS = "1210"
ACCT_VAT_PAYABLE = "2210"
ACCT_GIFT_VOUCHERS = "2510"
ACCT_CREDIT_NOTES = "2530"
ACCT_CASH_SALES = "4010"
ACCT_CREDIT_SALES = "4020"
ACCT_SALES_RETURNS = "4030"
ACCT_OTHER_INCOME = "4110"
ACCT_COGS = "5010"
ACCT_DISCOUNT_EXPENSE = "5160"


class SalesAccountingIntegration:
    """
    Service that creates automatic journal entries and GL postings
    from sales transactions.
    """

    def __init__(self, db: Session):
        self.db = db
        self._account_cache: Dict[str, int] = {}
        self._gl = GLPostingService(db)

    # ─── Helpers ──────────────────────────────────────────────────────────

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

    def _generate_je_number(self, prefix: str = "JE-SALE") -> str:
        """Generate a unique journal entry number for sale postings.
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

    def _check_already_posted(
        self,
        reference_id: int,
        marker: Optional[str] = None,
        reference_type: str = "Invoice",
    ) -> bool:
        """Has this exact source document already been posted to GL?

        Keyed on the integer ``reference_id`` (no more ``Invoice ID: 12`` also
        matching 120/125/1234) plus a ``marker`` to tell apart the Revenue,
        COGS and Discount postings that share one invoice.
        """
        return self._gl.already_posted(reference_type, reference_id, marker) is not None

    def _create_je_and_post(
        self,
        entry_date: date,
        description: str,
        lines: List[Dict[str, Any]],
        branch_code: Optional[str],
        user_id: int,
        reference_type: str = "Invoice",
        reference_id: Optional[int] = None,
        reference_no: Optional[str] = None,
        marker: Optional[str] = None,
        transaction_type: str = "Sale",
    ) -> Optional[JournalEntry]:
        """
        Build + post a balanced JE through the central :class:`GLPostingService`.

        Kept as a thin wrapper so the many call sites in this module stay
        unchanged. All correctness rules now live in one place:
        idempotency on the integer reference, *missing account = recorded
        failure* (never a silent skip), sub-cent rounding posted to the
        dedicated ``5900 Rounding Difference`` account, closed-period blocking,
        and durable failure recording for later retry.
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
            je_prefix="JE-SALE",
            source_module="sales",
            marker=marker,
            # The public post_* methods already guard with _check_already_posted,
            # so we avoid a redundant duplicate query here.
            idempotent=False,
            record_failure=True,
        )
        if result.failed:
            logger.error(
                "GL posting failed for %s#%s (%s): %s",
                reference_type, reference_id, result.error_code, result.error_message,
            )
        return result.journal_entry

    # ─── Main Public Methods ──────────────────────────────────────────────

    def post_sale_to_gl(self, invoice: Invoice, user_id: int) -> Optional[JournalEntry]:
        """
        Create journal entry and GL postings for a completed/paid sale.

        Called automatically when:
        - Cash/card/cheque invoice is created (auto-approved)
        - Credit invoice is approved
        - Bank transfer is verified
        """
        if self._check_already_posted(invoice.id, "Revenue"):
            logger.info(f"Invoice {invoice.invoice_no} already posted to GL - skipping")
            return None

        payment_method = (invoice.payment_method or "").lower()
        is_credit = payment_method == "credit"

        # Revenue account
        revenue_account = ACCT_CREDIT_SALES if is_credit else ACCT_CASH_SALES

        # Get amounts
        grand_total = Decimal(str(invoice.grand_total or 0))
        tax_amount = Decimal(str(invoice.tax_amount or 0))
        discount_amount = Decimal(str(invoice.discount_amount or 0))
        coupon_amount = Decimal(str(invoice.cupon_amount or 0))
        service_charge = Decimal(str(invoice.service_charge_amount or 0))
        voucher_amount = Decimal(str(invoice.gift_voucher_amount or 0))
        credit_note_amount = Decimal(str(invoice.credit_note_amount or 0))
        subtotal = Decimal(str(invoice.subtotal or 0))

        # Revenue = subtotal - discount - coupon (before tax, voucher, service charge)
        revenue_amount = subtotal - discount_amount - coupon_amount

        # Build journal entry lines
        lines = []

        # --- DEBIT: Asset / Receivable (split payment aware) ---
        # Each non-zero payment component gets its own GL debit line.
        cash_amt   = Decimal(str(invoice.cash_amount or 0))
        card_amt   = Decimal(str((invoice.card_visa_amount or 0) + (invoice.card_mastercard_amount or 0) + (invoice.card_amex_amount or 0)))
        cheque_amt = Decimal(str(invoice.cheque_amount or 0))
        bank_amt   = Decimal(str(invoice.bank_transfer_amount or 0))
        credit_amt = Decimal(str(invoice.credit_amount or 0))

        total_split = cash_amt + card_amt + cheque_amt + bank_amt + credit_amt

        if total_split > 0:
            # Multi-method split: post each component separately
            if cash_amt > 0:
                lines.append({
                    "account_code": ACCT_CASH_ON_HAND,
                    "debit": cash_amt,
                    "credit": Decimal("0"),
                    "description": f"Sale {invoice.invoice_no} - Cash received",
                })
            if card_amt > 0:
                lines.append({
                    "account_code": ACCT_BANK_ACCOUNT,
                    "debit": card_amt,
                    "credit": Decimal("0"),
                    "description": f"Sale {invoice.invoice_no} - Card received",
                })
            if cheque_amt > 0:
                lines.append({
                    "account_code": ACCT_BANK_ACCOUNT,
                    "debit": cheque_amt,
                    "credit": Decimal("0"),
                    "description": f"Sale {invoice.invoice_no} - Cheque received",
                })
            if bank_amt > 0:
                lines.append({
                    "account_code": ACCT_BANK_ACCOUNT,
                    "debit": bank_amt,
                    "credit": Decimal("0"),
                    "description": f"Sale {invoice.invoice_no} - Bank transfer received",
                })
            if credit_amt > 0:
                lines.append({
                    "account_code": ACCT_TRADE_DEBTORS,
                    "debit": credit_amt,
                    "credit": Decimal("0"),
                    "description": f"Sale {invoice.invoice_no} - Credit (receivable)",
                })
        else:
            # Fallback: use payment_method for full grand_total
            if is_credit:
                debit_account = ACCT_TRADE_DEBTORS
            elif payment_method == "cash":
                debit_account = ACCT_CASH_ON_HAND
            else:
                debit_account = ACCT_BANK_ACCOUNT
            if grand_total > 0:
                lines.append({
                    "account_code": debit_account,
                    "debit": grand_total,
                    "credit": Decimal("0"),
                    "description": f"Sale {invoice.invoice_no} - {payment_method.replace('_', ' ').title()} received",
                })

        # If voucher was used, debit the voucher liability (reduce outstanding voucher obligation)
        if voucher_amount > 0:
            lines.append({
                "account_code": ACCT_GIFT_VOUCHERS,
                "debit": voucher_amount,
                "credit": Decimal("0"),
                "description": f"Gift voucher redeemed on {invoice.invoice_no}",
            })

        # --- CREDIT: Revenue ---
        if revenue_amount > 0:
            lines.append({
                "account_code": revenue_account,
                "debit": Decimal("0"),
                "credit": revenue_amount,
                "description": f"{'Credit' if is_credit else 'Cash'} sale revenue - {invoice.invoice_no}",
            })

        # If voucher amount goes to revenue (customer gets goods worth voucher value)
        if voucher_amount > 0:
            lines.append({
                "account_code": revenue_account,
                "debit": Decimal("0"),
                "credit": voucher_amount,
                "description": f"Revenue from voucher redemption - {invoice.invoice_no}",
            })

        # If credit note was applied, record as revenue adjustment  
        if credit_note_amount > 0:
            # Credit note reduces what customer pays but goods are still delivered
            # The credit note liability was already recorded when the return was processed
            lines.append({
                "account_code": revenue_account,
                "debit": Decimal("0"),
                "credit": credit_note_amount,
                "description": f"Credit note applied - {invoice.invoice_no}",
            })

        # --- CREDIT: Tax ---
        if tax_amount > 0:
            lines.append({
                "account_code": ACCT_VAT_PAYABLE,
                "debit": Decimal("0"),
                "credit": tax_amount,
                "description": f"Tax on sale {invoice.invoice_no}",
            })

        # --- Service Charge (already included in grand_total for card payments) ---
        # Service charge is revenue to the company (passed to customer)
        # Already captured in grand_total debit, so we credit it as other income
        if service_charge > 0:
            lines.append({
                "account_code": ACCT_OTHER_INCOME,
                "debit": Decimal("0"),
                "credit": service_charge,
                "description": f"Card service charge on {invoice.invoice_no}",
            })

        description = (
            f"Auto GL - Sale Revenue | Invoice: {invoice.invoice_no} | "
            f"Method: {payment_method} (split: cash={cash_amt} card={card_amt} cheque={cheque_amt} bank={bank_amt} credit={credit_amt}) | "
            f"Amount: {grand_total} | Invoice ID: {invoice.id}"
        )

        je = self._create_je_and_post(
            entry_date=invoice.created_date or tz.today(),
            description=description,
            lines=lines,
            branch_code=invoice.branch_code,
            user_id=user_id,
            reference_type="Invoice",
            reference_id=invoice.id,
            reference_no=invoice.invoice_no,
            marker="Revenue",
        )

        if je:
            logger.info(
                f"✅ GL Posted: Sale {invoice.invoice_no} → JE {je.journal_entry_no} "
                f"(split payment: cash={cash_amt} card={card_amt} cheque={cheque_amt} bank={bank_amt} credit={credit_amt})"
            )

        return je

    def post_cogs_to_gl(self, invoice: Invoice, user_id: int) -> Optional[JournalEntry]:
        """
        Create COGS journal entry: Dr 5010 COGS / Cr 1210 Inventory.
        
        Looks up cost_price from Product for each invoice item to calculate
        the total cost of goods sold.
        """
        if self._check_already_posted(invoice.id, "COGS"):
            logger.info(f"COGS for invoice {invoice.invoice_no} already posted - skipping")
            return None

        # Calculate total cost
        items = self.db.query(InvoiceItems).filter(
            InvoiceItems.invoice_id == invoice.id
        ).all()

        total_cost = Decimal("0")
        for item in items:
            product = self.db.query(Product).filter(
                Product.id == item.product_id
            ).first()
            if product and product.cost_price:
                item_cost = Decimal(str(product.cost_price)) * Decimal(str(item.quantity))
                total_cost += item_cost

        if total_cost <= 0:
            logger.info(f"No COGS to post for {invoice.invoice_no} (cost=0)")
            return None

        lines = [
            {
                "account_code": ACCT_COGS,
                "debit": total_cost,
                "credit": Decimal("0"),
                "description": f"Cost of goods sold - {invoice.invoice_no}",
            },
            {
                "account_code": ACCT_FINISHED_GOODS,
                "debit": Decimal("0"),
                "credit": total_cost,
                "description": f"Inventory reduction for sale - {invoice.invoice_no}",
            },
        ]

        description = (
            f"Auto GL - COGS | Invoice: {invoice.invoice_no} | "
            f"Cost: {total_cost} | Invoice ID: {invoice.id}"
        )

        je = self._create_je_and_post(
            entry_date=invoice.created_date or tz.today(),
            description=description,
            lines=lines,
            branch_code=invoice.branch_code,
            user_id=user_id,
            reference_type="Invoice",
            reference_id=invoice.id,
            reference_no=invoice.invoice_no,
            marker="COGS",
        )

        if je:
            logger.info(
                f"✅ GL Posted: COGS {invoice.invoice_no} → JE {je.journal_entry_no} "
                f"(Dr {ACCT_COGS} {total_cost} / Cr {ACCT_FINISHED_GOODS})"
            )

        return je

    def post_discount_to_gl(self, invoice: Invoice, user_id: int) -> Optional[JournalEntry]:
        """
        Post discount/coupon as an expense entry if applicable.
        Dr 5160 Discount Given Expense / Cr Revenue account.
        
        This records the discount as a cost to the business.
        """
        discount_amount = Decimal(str(invoice.discount_amount or 0))
        coupon_amount = Decimal(str(invoice.cupon_amount or 0))
        total_discount = discount_amount + coupon_amount

        if total_discount <= 0:
            return None

        if self._check_already_posted(invoice.id, "Discount"):
            return None

        payment_method = (invoice.payment_method or "").lower()
        revenue_account = ACCT_CREDIT_SALES if payment_method == "credit" else ACCT_CASH_SALES

        lines = [
            {
                "account_code": ACCT_DISCOUNT_EXPENSE,
                "debit": total_discount,
                "credit": Decimal("0"),
                "description": f"Discount/coupon on {invoice.invoice_no}",
            },
            {
                "account_code": revenue_account,
                "debit": Decimal("0"),
                "credit": total_discount,
                "description": f"Discount contra revenue - {invoice.invoice_no}",
            },
        ]

        description = (
            f"Auto GL - Discount | Invoice: {invoice.invoice_no} | "
            f"Discount: {total_discount} | Invoice ID: {invoice.id}"
        )

        je = self._create_je_and_post(
            entry_date=invoice.created_date or tz.today(),
            description=description,
            lines=lines,
            branch_code=invoice.branch_code,
            user_id=user_id,
            reference_type="Invoice",
            reference_id=invoice.id,
            reference_no=invoice.invoice_no,
            marker="Discount",
        )

        if je:
            logger.info(
                f"✅ GL Posted: Discount {invoice.invoice_no} → JE {je.journal_entry_no}"
            )

        return je

    def post_sale_return_to_gl(
        self, sale_return: SaleReturn, user_id: int
    ) -> Optional[JournalEntry]:
        """
        Post sale return reversal to GL.

        ``total_refund`` already INCLUDES ``tax_refund`` (service computes
        total_refund = subtotal + tax_refund), so the entry is composed as:

            Dr 4030 Sales Returns ...... total_refund - tax_refund (net revenue reversal)
            Dr 2210 VAT/Tax Payable .... tax_refund               (reverse tax liability)
            Cr <refund account> ........ total_refund             (what goes back to customer)

        The credit account follows the REFUND method chosen on the return
        (``sale_return.payment_method``), not the original invoice tender:
            cash                     -> 1010 Cash on Hand   (cashbook money-out mirrors this)
            bank_transfer / cheque   -> 1020 Bank Account
            credit_note (credit sale)-> 1110 Trade Debtors  (reduces what customer owes)
            credit_note (cash sale)  -> 2530 Customer Credit Notes Outstanding (liability)
        """
        if self._check_already_posted(sale_return.id, reference_type="SaleReturn"):
            return None

        invoice = self.db.query(Invoice).filter(
            Invoice.id == sale_return.invoice_id
        ).first()
        if not invoice:
            return None

        total_refund = Decimal(str(sale_return.total_refund or 0))
        tax_refund = Decimal(str(sale_return.tax_refund or 0))
        if total_refund <= 0:
            return None
        # Guard against bad data: tax can never exceed the total refund.
        if tax_refund < 0 or tax_refund > total_refund:
            tax_refund = Decimal("0")
        revenue_reversal = total_refund - tax_refund

        # Credit account is driven by HOW the refund is issued.
        refund_method = (sale_return.payment_method or "").lower()
        if refund_method == "cash":
            credit_account = ACCT_CASH_ON_HAND
        elif refund_method in ("bank_transfer", "bank", "cheque", "check", "card"):
            credit_account = ACCT_BANK_ACCOUNT
        elif refund_method == "credit_note":
            is_credit_sale = (
                (invoice.payment_method or "").lower() == "credit"
                or Decimal(str(invoice.credit_amount or 0)) > 0
            )
            credit_account = ACCT_TRADE_DEBTORS if is_credit_sale else ACCT_CREDIT_NOTES
        else:
            # Legacy fallback: derive from the original invoice tender.
            original = (invoice.payment_method or "").lower()
            if original == "cash":
                credit_account = ACCT_CASH_ON_HAND
            elif original == "credit":
                credit_account = ACCT_TRADE_DEBTORS
            else:
                credit_account = ACCT_BANK_ACCOUNT

        lines = [
            {
                "account_code": ACCT_SALES_RETURNS,
                "debit": revenue_reversal,
                "credit": Decimal("0"),
                "description": f"Sale return {sale_return.sale_return_no} for {invoice.invoice_no}",
            },
        ]
        if tax_refund > 0:
            lines.append({
                "account_code": ACCT_VAT_PAYABLE,
                "debit": tax_refund,
                "credit": Decimal("0"),
                "description": f"Tax reversed on return {sale_return.sale_return_no}",
            })
        lines.append({
            "account_code": credit_account,
            "debit": Decimal("0"),
            "credit": total_refund,
            "description": f"Refund ({refund_method or 'original method'}) for return {sale_return.sale_return_no}",
        })

        description = (
            f"Auto GL - Sale Return | Return: {sale_return.sale_return_no} | "
            f"Invoice: {invoice.invoice_no} | Refund: {total_refund} | "
            f"Invoice ID: {sale_return.id}"
        )

        je = self._create_je_and_post(
            entry_date=sale_return.added_date or tz.today(),
            description=description,
            lines=lines,
            branch_code=sale_return.branch_code,
            user_id=user_id,
            reference_type="SaleReturn",
            reference_id=sale_return.id,
            reference_no=sale_return.sale_return_no,
            marker="SaleReturn",
        )

        if je:
            logger.info(
                f"✅ GL Posted: Return {sale_return.sale_return_no} → JE {je.journal_entry_no}"
            )

        return je

    # ─── Composite Method ─────────────────────────────────────────────────

    def post_all_for_invoice(self, invoice: Invoice, user_id: int) -> Dict[str, Any]:
        """
        Post all GL entries for a completed invoice:
        1. Revenue entry
        2. COGS entry
        3. Discount entry (if applicable)
        
        Returns summary of what was posted.
        """
        results = {
            "invoice_no": invoice.invoice_no,
            "revenue_je": None,
            "cogs_je": None,
            "discount_je": None,
            "posted": False,
            "errors": [],
        }

        try:
            # 1. Revenue entry
            revenue_je = self.post_sale_to_gl(invoice, user_id)
            if revenue_je:
                results["revenue_je"] = revenue_je.journal_entry_no

            # 2. COGS entry
            cogs_je = self.post_cogs_to_gl(invoice, user_id)
            if cogs_je:
                results["cogs_je"] = cogs_je.journal_entry_no

            # 3. Discount entry
            discount_je = self.post_discount_to_gl(invoice, user_id)
            if discount_je:
                results["discount_je"] = discount_je.journal_entry_no

            results["posted"] = True

        except Exception as e:
            logger.error(f"Error posting invoice {invoice.invoice_no} to GL: {e}")
            results["errors"].append(str(e))

        return results

    # ─── Query Methods ────────────────────────────────────────────────────

    def get_gl_entries_for_invoice(self, invoice_id: int) -> List[Dict[str, Any]]:
        """Get all GL entries posted for a specific invoice."""
        entries = self.db.query(
            GeneralLedger,
            ChartOfAccounts.account_code,
            ChartOfAccounts.account_name,
            ChartOfAccounts.account_type,
        ).join(
            ChartOfAccounts, GeneralLedger.account_id == ChartOfAccounts.id
        ).filter(
            GeneralLedger.reference_type == "Invoice",
            GeneralLedger.reference_id == invoice_id,
        ).order_by(GeneralLedger.id).all()

        results = []
        for gl, acc_code, acc_name, acc_type in entries:
            results.append({
                "id": gl.id,
                "transaction_date": gl.transaction_date.isoformat() if gl.transaction_date else None,
                "posting_date": gl.posting_date.isoformat() if gl.posting_date else None,
                "account_id": gl.account_id,
                "account_code": acc_code,
                "account_name": acc_name,
                "account_type": acc_type,
                "debit_amount": float(gl.debit_amount or 0),
                "credit_amount": float(gl.credit_amount or 0),
                "transaction_type": gl.transaction_type,
                "reference_type": gl.reference_type,
                "reference_no": gl.reference_no,
                "journal_entry_id": gl.journal_entry_id,
                "description": gl.description,
                "branch_code": gl.branch_code,
                "fiscal_year": gl.fiscal_year,
                "fiscal_period": gl.fiscal_period,
            })

        return results

    def get_journal_entries_for_invoice(self, invoice_id: int) -> List[Dict[str, Any]]:
        """Get all journal entries created for a specific invoice."""
        entries = self.db.query(JournalEntry).filter(
            JournalEntry.entry_type == "Auto",
            JournalEntry.description.like(f"%Invoice ID: {invoice_id}%"),
        ).order_by(JournalEntry.id).all()

        results = []
        for je in entries:
            # Load lines
            lines = self.db.query(
                JournalEntryLine,
                ChartOfAccounts.account_code,
                ChartOfAccounts.account_name,
            ).join(
                ChartOfAccounts, JournalEntryLine.account_id == ChartOfAccounts.id
            ).filter(
                JournalEntryLine.journal_entry_id == je.id
            ).order_by(JournalEntryLine.line_number).all()

            line_data = []
            for line, acc_code, acc_name in lines:
                line_data.append({
                    "line_number": line.line_number,
                    "account_code": acc_code,
                    "account_name": acc_name,
                    "debit_amount": float(line.debit_amount or 0),
                    "credit_amount": float(line.credit_amount or 0),
                    "description": line.description,
                })

            results.append({
                "id": je.id,
                "journal_entry_no": je.journal_entry_no,
                "entry_date": je.entry_date.isoformat() if je.entry_date else None,
                "posting_date": je.posting_date.isoformat() if je.posting_date else None,
                "entry_type": je.entry_type,
                "description": je.description,
                "total_debit": float(je.total_debit or 0),
                "total_credit": float(je.total_credit or 0),
                "status": je.status,
                "lines": line_data,
            })

        return results

    def get_gl_posting_status(self, invoice_id: int) -> Dict[str, Any]:
        """Check GL posting status for an invoice."""
        gl_count = self.db.query(func.count(GeneralLedger.id)).filter(
            GeneralLedger.reference_type == "Invoice",
            GeneralLedger.reference_id == invoice_id,
        ).scalar() or 0

        je_count = self.db.query(func.count(JournalEntry.id)).filter(
            JournalEntry.entry_type == "Auto",
            JournalEntry.description.like(f"%Invoice ID: {invoice_id}%"),
        ).scalar() or 0

        return {
            "invoice_id": invoice_id,
            "gl_posted": gl_count > 0,
            "gl_entry_count": gl_count,
            "journal_entry_count": je_count,
        }

    # ═══════════════════════════════════════════════════════════════════════
    # GIFT VOUCHER GL POSTINGS
    # ═══════════════════════════════════════════════════════════════════════

    def _check_gv_already_posted(self, marker: str) -> bool:
        """Check if a gift-voucher GL entry with this marker already exists."""
        existing = self.db.query(JournalEntry).filter(
            JournalEntry.description.like(f"%{marker}%"),
            JournalEntry.entry_type == "Auto",
        ).first()
        return existing is not None

    def post_gift_voucher_sale_to_gl(self, voucher, user_id: int) -> Optional[JournalEntry]:
        """
        Post gift voucher sale to GL.
        Dr  1010/1020  Cash/Bank .............. voucher_amount
        Cr  2510       Gift Vouchers Outstanding voucher_amount

        Called when a gift voucher is created/sold.
        """
        marker = f"GiftVoucherSale ID: {voucher.id}"
        if self._check_gv_already_posted(marker):
            return None

        amount = Decimal(str(voucher.amount or 0))
        if amount <= 0:
            return None

        payment_method = (getattr(voucher, "payment_method", None) or "cash").lower()
        debit_account = ACCT_CASH_ON_HAND if payment_method == "cash" else ACCT_BANK_ACCOUNT

        lines = [
            {
                "account_code": debit_account,
                "debit": amount,
                "credit": Decimal("0"),
                "description": f"Gift voucher sold - {voucher.barcode_no}",
            },
            {
                "account_code": ACCT_GIFT_VOUCHERS,
                "debit": Decimal("0"),
                "credit": amount,
                "description": f"Gift voucher liability - {voucher.barcode_no}",
            },
        ]

        description = (
            f"Auto GL - Gift Voucher Sale | Barcode: {voucher.barcode_no} | "
            f"Amount: {amount} | {marker}"
        )

        je = self._create_je_and_post(
            entry_date=getattr(voucher, "date", None) or tz.today(),
            description=description,
            lines=lines,
            branch_code=getattr(voucher, "branch_code", None) or "HQ",
            user_id=user_id,
            reference_type="GiftVoucherSale",
            reference_id=voucher.id,
            reference_no=voucher.barcode_no,
        )

        if je:
            logger.info(
                f"✅ GL Posted: Gift Voucher Sale {voucher.barcode_no} → JE {je.journal_entry_no} "
                f"(Dr {debit_account} / Cr 2510) Amount: {amount}"
            )
        return je

    def post_gift_voucher_refund_to_gl(self, voucher, refund_amount: Decimal, user_id: int) -> Optional[JournalEntry]:
        """
        Post gift voucher refund to GL.
        Dr  2510       Gift Vouchers Outstanding .. refund_amount
        Cr  1010/1020  Cash/Bank .................. refund_amount

        Called when a gift voucher is refunded to customer.
        """
        marker = f"GiftVoucherRefund ID: {voucher.id}"
        if self._check_gv_already_posted(marker):
            return None

        if refund_amount <= 0:
            return None

        payment_method = (getattr(voucher, "payment_method", None) or "cash").lower()
        credit_account = ACCT_CASH_ON_HAND if payment_method == "cash" else ACCT_BANK_ACCOUNT

        lines = [
            {
                "account_code": ACCT_GIFT_VOUCHERS,
                "debit": refund_amount,
                "credit": Decimal("0"),
                "description": f"Gift voucher refund - {voucher.barcode_no}",
            },
            {
                "account_code": credit_account,
                "debit": Decimal("0"),
                "credit": refund_amount,
                "description": f"Cash refund for voucher - {voucher.barcode_no}",
            },
        ]

        description = (
            f"Auto GL - Gift Voucher Refund | Barcode: {voucher.barcode_no} | "
            f"Refund: {refund_amount} | {marker}"
        )

        je = self._create_je_and_post(
            entry_date=tz.today(),
            description=description,
            lines=lines,
            branch_code=getattr(voucher, "branch_code", None) or "HQ",
            user_id=user_id,
            reference_type="GiftVoucherRefund",
            reference_id=voucher.id,
            reference_no=voucher.barcode_no,
        )

        if je:
            logger.info(
                f"✅ GL Posted: Gift Voucher Refund {voucher.barcode_no} → JE {je.journal_entry_no} "
                f"Amount: {refund_amount}"
            )
        return je

    def post_gift_voucher_expiry_to_gl(self, voucher, user_id: int) -> Optional[JournalEntry]:
        """
        Post gift voucher expiry/breakage to GL.
        Dr  2510  Gift Vouchers Outstanding .. remaining_balance
        Cr  4110  Other Income (Breakage) .... remaining_balance

        Called when a gift voucher expires with unspent balance.
        """
        marker = f"GiftVoucherExpiry ID: {voucher.id}"
        if self._check_gv_already_posted(marker):
            return None

        remaining = Decimal(str(voucher.balance or voucher.amount or 0))
        if remaining <= 0:
            return None

        lines = [
            {
                "account_code": ACCT_GIFT_VOUCHERS,
                "debit": remaining,
                "credit": Decimal("0"),
                "description": f"Gift voucher expired - {voucher.barcode_no}",
            },
            {
                "account_code": ACCT_OTHER_INCOME,
                "debit": Decimal("0"),
                "credit": remaining,
                "description": f"Breakage income from expired voucher - {voucher.barcode_no}",
            },
        ]

        description = (
            f"Auto GL - Gift Voucher Expiry | Barcode: {voucher.barcode_no} | "
            f"Amount: {remaining} | {marker}"
        )

        je = self._create_je_and_post(
            entry_date=tz.today(),
            description=description,
            lines=lines,
            branch_code=getattr(voucher, "branch_code", None) or "HQ",
            user_id=user_id,
            reference_type="GiftVoucherExpiry",
            reference_id=voucher.id,
            reference_no=voucher.barcode_no,
        )

        if je:
            logger.info(
                f"✅ GL Posted: Gift Voucher Expiry {voucher.barcode_no} → JE {je.journal_entry_no} "
                f"Breakage Income: {remaining}"
            )
        return je
