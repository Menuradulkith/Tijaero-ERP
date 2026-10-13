from sqlalchemy.orm import Session
from sqlalchemy import func, and_, text
from fastapi import HTTPException, status
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Optional, Dict, Any
from app.core import timezone as tz

from app.modules.customers.models import (
    Customer, 
    CustomerCreditsSettle, 
    CustomerCreditsSettleTransaction
)
from app.modules.sales.models import Invoice
from app.modules.customers import schemas


class CustomerCreditService:

    # Credit sale allowed hours (09:00 AM to 06:00 PM)
    CREDIT_SALE_START_HOUR = 9   # 09:00 AM
    CREDIT_SALE_END_HOUR = 18    # 06:00 PM
    
    def validate_credit_sale_time(self) -> Dict[str, Any]:
        """
        Validate that credit sales are only allowed during business hours (09:00 AM - 06:00 PM).
        Returns validation result with current time and allowed hours.
        """
        current_time = tz.now()
        current_hour = current_time.hour
        
        is_allowed = self.CREDIT_SALE_START_HOUR <= current_hour < self.CREDIT_SALE_END_HOUR
        
        return {
            "allowed": is_allowed,
            "current_time": current_time.strftime("%H:%M"),
            "current_hour": current_hour,
            "allowed_start": f"{self.CREDIT_SALE_START_HOUR:02d}:00",
            "allowed_end": f"{self.CREDIT_SALE_END_HOUR:02d}:00",
            "message": "Credit sales are allowed" if is_allowed else f"Credit sales are only allowed between {self.CREDIT_SALE_START_HOUR:02d}:00 AM and {self.CREDIT_SALE_END_HOUR:02d}:00 PM"
        }
    
    def validate_customer_for_credit_sale(self, db: Session, customer_id: int) -> Dict[str, Any]:
        """
        Validate customer eligibility for credit sales.
        Requirements:
        - Customer must be active
        - Customer must have valid name
        - Customer must have mobile contact number
        - Customer must have email
        - Customer must have payment/delivery address
        """
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            return {
                "valid": False,
                "errors": ["Customer not found"],
                "customer_id": customer_id
            }
        
        errors = []
        warnings = []
        
        # Check if customer is active
        if not customer.active:
            errors.append("Customer account is not active")
        
        # Check customer name
        if not customer.customer_name or len(customer.customer_name.strip()) < 2:
            errors.append("Customer name is required")
        
        # Check mobile contact number
        if not customer.mobile_contact_number or len(customer.mobile_contact_number.strip()) < 10:
            errors.append("Valid mobile contact number is required for credit sales")
        
        # Check email
        if not customer.email or "@" not in customer.email:
            errors.append("Valid email address is required for credit sales")
        
        # Check address (payment or delivery)
        has_address = (
            (customer.payment_address and len(customer.payment_address.strip()) > 5) or
            (customer.delivery_address and len(customer.delivery_address.strip()) > 5)
        )
        if not has_address:
            errors.append("Customer must have a valid payment or delivery address for credit sales")
        
        # Warnings for missing optional info
        if not customer.id_card_number:
            warnings.append("ID card number is not provided")
        
        return {
            "valid": len(errors) == 0,
            "customer_id": customer_id,
            "customer_name": customer.customer_name,
            "active": customer.active,
            "has_phone": bool(customer.mobile_contact_number),
            "has_email": bool(customer.email),
            "has_address": has_address,
            "errors": errors,
            "warnings": warnings
        }
    
    def validate_credit_sale_comprehensive(
        self, 
        db: Session, 
        customer_id: int, 
        credit_amount: Decimal,
        skip_time_check: bool = False,
        allow_over_limit: bool = False
    ) -> Dict[str, Any]:
        """
        Comprehensive validation for credit sales.
        Validates:
        1. Time restriction (09:00 AM - 06:00 PM)
        2. Customer eligibility (active, name, phone, email, address)
        3. Credit limit (BLOCKING - not warning)
        4. Overdue invoices
        
        Returns detailed validation result with all checks.
        """
        result = {
            "allowed": True,
            "time_check": None,
            "customer_check": None,
            "credit_check": None,
            "errors": [],
            "warnings": []
        }
        
        # Step 1: Time restriction check
        if not skip_time_check:
            time_check = self.validate_credit_sale_time()
            result["time_check"] = time_check
            if not time_check["allowed"]:
                result["allowed"] = False
                result["errors"].append(time_check["message"])
        
        # Step 2: Customer eligibility check
        customer_check = self.validate_customer_for_credit_sale(db, customer_id)
        result["customer_check"] = customer_check
        if not customer_check["valid"]:
            result["allowed"] = False
            result["errors"].extend(customer_check["errors"])
        if customer_check.get("warnings"):
            result["warnings"].extend(customer_check["warnings"])
        
        # Step 3: Credit limit check (BLOCKING, not warning-only)
        credit_status = self.get_customer_credit_status(db, customer_id)
        current_outstanding = Decimal(str(credit_status["outstanding_credit"]))
        new_outstanding = current_outstanding + Decimal(str(credit_amount))
        max_credit = Decimal(str(credit_status["max_credit_limit"]))
        
        will_exceed = new_outstanding > max_credit
        
        credit_check = {
            "current_outstanding": float(current_outstanding),
            "new_credit_amount": float(credit_amount),
            "new_total_outstanding": float(new_outstanding),
            "max_credit_limit": credit_status["max_credit_limit"],
            "available_credit": credit_status["available_credit"],
            "will_exceed_limit": will_exceed,
            "excess_amount": float(max(0, new_outstanding - max_credit)),
            "overdue_count": credit_status["overdue_count"],
            "total_overdue_amount": credit_status["total_overdue_amount"],
            "has_overdue": credit_status["overdue_count"] > 0
        }
        result["credit_check"] = credit_check
        
        # BLOCKING: Credit limit exceeded (not just warning)
        if will_exceed and not allow_over_limit:
            result["allowed"] = False
            result["errors"].append(
                f"Credit limit exceeded. Max: Rs. {max_credit:,.2f}, "
                f"New total would be: Rs. {new_outstanding:,.2f}. "
                f"Exceeds limit by Rs. {(new_outstanding - max_credit):,.2f}"
            )
        elif will_exceed and allow_over_limit:
            result["warnings"].append(
                f"Credit limit will be exceeded by Rs. {(new_outstanding - max_credit):,.2f} - requires approval"
            )
        
        # Warning: Has overdue invoices
        if credit_status["overdue_count"] > 0:
            result["warnings"].append(
                f"Customer has {credit_status['overdue_count']} overdue invoice(s) "
                f"totaling Rs. {credit_status['total_overdue_amount']:,.2f}"
            )
        
        return result
    
    def calculate_due_date(self, invoice_date: date, credit_days: int) -> date:
        return invoice_date + timedelta(days=credit_days)
    
    def get_invoice_due_date(self, db: Session, invoice_id: int) -> date:
        invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
        if not invoice:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Invoice {invoice_id} not found"
            )
        
        customer = db.query(Customer).filter(Customer.id == invoice.customer_id).first()
        if not customer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Customer not found for invoice {invoice_id}"
            )
        
        return self.calculate_due_date(invoice.created_date, customer.credit_days)
    
    def get_days_overdue(self, invoice_date: date, credit_days: int) -> int:
        due_date = self.calculate_due_date(invoice_date, credit_days)
        return (tz.today() - due_date).days
    

    
    def get_customer_credit_status(self, db: Session, customer_id: int) -> Dict[str, Any]:

        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Customer {customer_id} not found"
            )

        outstanding = self._calculate_outstanding_credit(db, customer_id)
        
        overdue_invoices = self._get_overdue_invoices(db, customer_id, customer.credit_days)
        
        return {
            "customer_id": customer_id,
            "customer_name": customer.customer_name,
            "credit_days": customer.credit_days,
            "max_credit_limit": customer.max_credit_limit,
            "initial_credit_amount": customer.initial_credit_amount or customer.max_credit_limit,
            "left_credit_amount": self.compute_left_credit(customer.max_credit_limit, outstanding),
            "outstanding_credit": outstanding,
            "available_credit": max(0, customer.max_credit_limit - outstanding),
            "overdue_count": len(overdue_invoices),
            "total_overdue_amount": sum(inv["remaining_amount"] for inv in overdue_invoices),
            "overdue_invoices": overdue_invoices
        }

    def get_customer_credit_summary(self, db: Session, customer_id: int) -> Dict[str, Any]:
        """Compatibility alias for API consumers expecting credit summary."""
        return self.get_customer_credit_status(db, customer_id)
    
    def _calculate_outstanding_credit(self, db: Session, customer_id: int) -> Decimal:
        # Single source of truth: what the customer still owes on live credit
        # invoices (invoice.balance_due). balance_due only moves when a
        # settlement is actually applied (a bank-transfer settlement is applied on
        # verification, never while pending and never when rejected), so pending /
        # rejected settlements cannot free credit.
        outstanding = db.query(func.coalesce(func.sum(Invoice.balance_due), 0)).filter(
            Invoice.customer_id == customer_id,
            Invoice.credit_amount > 0,
            Invoice.balance_due > 0,
            Invoice.status == True,  # Exclude cancelled invoices
            Invoice.approval_status.notin_(['cancelled', 'rejected'])  # Exclude rejected
        ).scalar() or Decimal("0")
        return Decimal(str(outstanding))
    
    def _get_overdue_invoices(self, db: Session, customer_id: int, credit_days: int) -> List[Dict]:
        cutoff_date = tz.today() - timedelta(days=credit_days)
        
        invoices = db.query(Invoice).filter(
            Invoice.customer_id == customer_id,
            Invoice.credit_amount > 0,
            Invoice.created_date < cutoff_date,
            Invoice.status == True,  # Exclude cancelled invoices
            Invoice.approval_status.notin_(['cancelled', 'rejected'])  # Exclude rejected
        ).all()
        
        overdue_list = []
        for invoice in invoices:
            remaining = self._get_invoice_remaining_credit(db, invoice.id, invoice.credit_amount)
            if remaining > 0:
                due_date = self.calculate_due_date(invoice.created_date, credit_days)
                overdue_list.append({
                    "invoice_id": invoice.id,
                    "invoice_no": invoice.invoice_no,
                    "invoice_date": invoice.created_date,
                    "due_date": due_date,
                    "days_overdue": (tz.today() - due_date).days,
                    "credit_amount": float(invoice.credit_amount),
                    "remaining_amount": float(remaining)
                })
        
        return overdue_list
    
    def _get_invoice_remaining_credit(self, db: Session, invoice_id: int, credit_amount: Decimal) -> Decimal:
        paid = db.query(
            func.coalesce(func.sum(CustomerCreditsSettleTransaction.payment_amount), 0)
        ).filter(
            CustomerCreditsSettleTransaction.invoice_id == invoice_id,
            # only money actually received: not pending / rejected bank transfers
            CustomerCreditsSettleTransaction.status.notin_(["pending_verification", "rejected"]),
        ).scalar() or Decimal("0")
        
        return credit_amount - paid
    
    def validate_credit_sale(
        self, 
        db: Session, 
        customer_id: int, 
        credit_amount: Decimal,
        allow_over_limit: bool = False
    ) -> Dict[str, Any]:

        status = self.get_customer_credit_status(db, customer_id)
        
        current_outstanding = Decimal(str(status["outstanding_credit"]))
        new_outstanding = current_outstanding + Decimal(str(credit_amount))
        will_exceed = new_outstanding > Decimal(str(status["max_credit_limit"]))
        
        result = {
            "allowed": not will_exceed or allow_over_limit,
            "current_outstanding": float(current_outstanding),
            "new_credit_amount": float(credit_amount),
            "new_total_outstanding": float(new_outstanding),
            "max_credit_limit": status["max_credit_limit"],
            "available_credit": status["available_credit"],
            "will_exceed_limit": will_exceed,
            "excess_amount": max(0, new_outstanding - status["max_credit_limit"]),
            "overdue_count": status["overdue_count"],
            "has_overdue": status["overdue_count"] > 0,
            "message": ""
        }
        
        if will_exceed:
            result["message"] = f"Credit limit exceeded. Max: {status['max_credit_limit']}, New total: {new_outstanding}"
        elif status["overdue_count"] > 0:
            result["message"] = f"Customer has {status['overdue_count']} overdue invoice(s)"
        else:
            result["message"] = "Credit sale approved"
        
        return result

    def check_credit_availability(
        self,
        db: Session,
        customer_id: int,
        credit_amount: Decimal,
        allow_over_limit: bool = False
    ) -> Dict[str, Any]:
        """Check credit availability for a proposed sale amount."""
        return self.validate_credit_sale(
            db,
            customer_id,
            credit_amount,
            allow_over_limit=allow_over_limit
        )
    
    @staticmethod
    def compute_left_credit(max_credit_limit, outstanding) -> int:
        """Stored/displayed 'left credit': never negative (real exposure lives in
        outstanding), rounded half-up to a whole rupee (the column is an int)."""
        left = Decimal(str(max_credit_limit or 0)) - Decimal(str(outstanding or 0))
        return max(0, int(left.quantize(Decimal("1"), rounding=ROUND_HALF_UP)))

    def refresh_customer_left_credit(self, db: Session, customer_id: int):
        """Recompute left_credit_amount (locks the customer row, no commit)."""
        customer = db.query(Customer).filter(Customer.id == customer_id).with_for_update().first()
        if not customer:
            return
        outstanding = self._calculate_outstanding_credit(db, customer_id)
        customer.left_credit_amount = self.compute_left_credit(customer.max_credit_limit, outstanding)

    def update_customer_credit_balance(self, db: Session, customer_id: int):
        # Lock the customer row to prevent concurrent credit balance updates
        self.refresh_customer_left_credit(db, customer_id)
        db.commit()

    
    def create_credit_settlement(
        self,
        db: Session,
        settlement_data: schemas.CustomerCreditsSettleCreate,
        user_id: int = 0,
    ) -> CustomerCreditsSettle:
        """M8: record payments received against a customer's credit invoices.

        This is the same operation as ``POST /sales/{invoice_id}/settle-payment``, so every transaction is routed
        through ``SalesService.settle_credit_payment`` (invoice lock, over-settlement refusal, paid / balance_due /
        payment_status, customer credit refresh, balanced journal entry). Each transaction becomes its own settlement
        record; the first record is returned. The whole request is validated before anything is written, and a
        repeated request can never settle more than the invoice still owes.
        """
        from app.modules.sales.service import SalesService
        from app.modules.sales import schemas as sales_schemas

        customer = db.query(Customer).filter(
            Customer.id == settlement_data.customer_id
        ).first()
        if not customer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Customer {settlement_data.customer_id} not found"
            )
        if not settlement_data.transactions:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one payment is required")

        # Pre-validate every transaction (customer match, amounts per invoice) before the first one is applied
        requested_per_invoice: Dict[int, Decimal] = {}
        for trans in settlement_data.transactions:
            if Decimal(str(trans.payment_amount)) <= 0:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment amount must be greater than zero")
            invoice = db.query(Invoice).filter(Invoice.id == trans.invoice_id).first()
            if not invoice:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Invoice {trans.invoice_id} not found"
                )
            if invoice.customer_id != settlement_data.customer_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invoice {trans.invoice_id} does not belong to customer {settlement_data.customer_id}"
                )
            requested_per_invoice[invoice.id] = requested_per_invoice.get(invoice.id, Decimal("0")) + Decimal(str(trans.payment_amount))
            if requested_per_invoice[invoice.id] > Decimal(str(invoice.balance_due or 0)):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Payment amount {requested_per_invoice[invoice.id]} exceeds the balance "
                        f"{Decimal(str(invoice.balance_due or 0))} of invoice {invoice.invoice_no}"
                    ),
                )

        allowed_methods = ("cash", "cheque", "card", "card_visa", "card_mastercard", "card_amex", "bank_transfer")
        sales_service = SalesService()
        first_settlement_id = None
        for trans in settlement_data.transactions:
            method = (trans.payment_method or "").strip().lower()
            if method == "bank":
                method = "bank_transfer"
            if method not in allowed_methods:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unsupported payment method '{trans.payment_method}'")
            payment = sales_schemas.CreditPaymentCreate(
                invoice_id=trans.invoice_id,
                payment_method=method,
                payment_amount=float(trans.payment_amount),
                payment_date=tz.today(),
                cheque_number=trans.payment_method_number if method == "cheque" else None,
                cheque_date=trans.cheque_date if method == "cheque" else None,
                card_ref_number=trans.payment_method_number if method.startswith("card") else None,
                bank_transfer_ref=trans.payment_method_number if method == "bank_transfer" else None,
                remarks=trans.remarks,
            )
            result = sales_service.settle_credit_payment(db, payment, user_id)
            if first_settlement_id is None:
                first_settlement_id = result["settlement_record_id"]

        settlement = db.query(CustomerCreditsSettle).filter(CustomerCreditsSettle.id == first_settlement_id).first()
        return settlement

    def get_settlement(self, db: Session, settlement_id: int) -> CustomerCreditsSettle:

        settlement = db.query(CustomerCreditsSettle).filter(
            CustomerCreditsSettle.id == settlement_id
        ).first()
        if not settlement:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Credit settlement {settlement_id} not found"
            )
        return settlement
    
    def get_settlement_with_transactions(
        self, 
        db: Session, 
        settlement_id: int
    ) -> schemas.CustomerCreditsSettleWithTransactions:
        settlement = self.get_settlement(db, settlement_id)
        transactions = db.query(CustomerCreditsSettleTransaction).filter(
            CustomerCreditsSettleTransaction.customer_credit_settle_id == settlement_id
        ).all()
        
        return schemas.CustomerCreditsSettleWithTransactions(
            id=settlement.id,
            customer_credits_settle_no=settlement.customer_credits_settle_no,
            branch_code=settlement.branch_code,
            created_date=settlement.created_date,
            customer_id=settlement.customer_id,
            transactions=[
                schemas.CustomerCreditsSettleTransaction.model_validate(t) 
                for t in transactions
            ]
        )
    
    def get_customer_settlements(
        self, 
        db: Session, 
        customer_id: int,
        skip: int = 0,
        limit: int = 100
    ) -> List[CustomerCreditsSettle]:

        return db.query(CustomerCreditsSettle).filter(
            CustomerCreditsSettle.customer_id == customer_id
        ).order_by(
            CustomerCreditsSettle.created_date.desc()
        ).offset(skip).limit(limit).all()

    def get_payment_report(
        self,
        db: Session,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        customer_id: Optional[int] = None,
        branch_code: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get consolidated customer payment report with one efficient DB query."""
        # Query settlements joined with customer
        settle_query = db.query(
            CustomerCreditsSettle,
            Customer.customer_name,
        ).join(Customer, CustomerCreditsSettle.customer_id == Customer.id)

        if date_from:
            settle_query = settle_query.filter(CustomerCreditsSettle.created_date >= date_from)
        if date_to:
            settle_query = settle_query.filter(CustomerCreditsSettle.created_date <= date_to)
        if customer_id:
            settle_query = settle_query.filter(CustomerCreditsSettle.customer_id == customer_id)
        if branch_code:
            settle_query = settle_query.filter(CustomerCreditsSettle.branch_code == branch_code)

        settlement_rows = settle_query.order_by(CustomerCreditsSettle.created_date.desc()).all()

        if not settlement_rows:
            return {
                "items": [],
                "summary": {
                    "total_amount": 0.0,
                    "total_count": 0,
                    "credit_settlements": 0.0,
                    "credit_settlements_count": 0,
                },
            }

        # Get all transactions + invoice_no in a single query
        settle_ids = [row[0].id for row in settlement_rows]
        txn_rows = (
            db.query(CustomerCreditsSettleTransaction, Invoice.invoice_no)
            .join(Invoice, CustomerCreditsSettleTransaction.invoice_id == Invoice.id, isouter=True)
            .filter(CustomerCreditsSettleTransaction.customer_credit_settle_id.in_(settle_ids))
            .all()
        )

        # Group transactions by settlement id
        txn_by_settle: Dict[int, list] = {}
        for txn, inv_no in txn_rows:
            sid = txn.customer_credit_settle_id
            txn_by_settle.setdefault(sid, []).append((txn, inv_no))

        # Build report items
        items = []
        pm_map = {
            "cash": "Cash",
            "card": "Card",
            "card_visa": "Visa Card",
            "card_mastercard": "Mastercard",
            "card_amex": "Amex Card",
            "bank_transfer": "Bank Transfer",
            "bank": "Bank Transfer",
            "cheque": "Cheque",
        }
        for settle, customer_name in settlement_rows:
            txns = txn_by_settle.get(settle.id, [])
            total_amount = float(sum(txn.payment_amount for txn, _ in txns))
            methods = list(dict.fromkeys(pm_map.get(txn.payment_method.lower(), txn.payment_method) for txn, _ in txns if txn.payment_method))
            inv_refs = list(dict.fromkeys(inv_no for _, inv_no in txns if inv_no))
            remarks_parts = [txn.remarks for txn, _ in txns if txn.remarks]

            date_str = settle.created_date.isoformat() if settle.created_date else ""

            items.append({
                "id": settle.id,
                "date": date_str,
                "customer_id": settle.customer_id,
                "customer_name": customer_name,
                "document_no": settle.customer_credits_settle_no or f"CS-{settle.id}",
                "invoice_refs": ", ".join(inv_refs) if inv_refs else "-",
                "payment_method": ", ".join(methods) if methods else "-",
                "amount": total_amount,
                "branch_code": settle.branch_code or "-",
                "remarks": "; ".join(remarks_parts) if remarks_parts else "",
            })

        grand_total = sum(i["amount"] for i in items)
        return {
            "items": items,
            "summary": {
                "total_amount": grand_total,
                "total_count": len(items),
                "credit_settlements": grand_total,
                "credit_settlements_count": len(items),
            },
        }
    
    def get_invoice_payment_history(
        self, 
        db: Session, 
        invoice_id: int
    ) -> Dict[str, Any]:
        invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
        if not invoice:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Invoice {invoice_id} not found"
            )
        
        transactions = db.query(CustomerCreditsSettleTransaction).filter(
            CustomerCreditsSettleTransaction.invoice_id == invoice_id
        ).order_by(CustomerCreditsSettleTransaction.created_date).all()
        
        total_paid = sum(t.payment_amount for t in transactions)
        remaining = invoice.credit_amount - total_paid
        
        customer = db.query(Customer).filter(Customer.id == invoice.customer_id).first()
        due_date = self.calculate_due_date(invoice.created_date, customer.credit_days)
        
        return {
            "invoice_id": invoice_id,
            "invoice_no": invoice.invoice_no,
            "invoice_date": invoice.created_date,
            "due_date": due_date,
            "credit_amount": float(invoice.credit_amount),
            "total_paid": float(total_paid),
            "remaining": float(remaining),
            "is_fully_paid": remaining <= 0,
            "payments": [
                {
                    "transaction_id": t.id,
                    "settlement_id": t.customer_credit_settle_id,
                    "payment_date": t.created_date,
                    "payment_method": pm_map.get(t.payment_method.lower(), t.payment_method) if t.payment_method else "",
                    "amount": float(t.payment_amount),
                    "reference": t.payment_method_number,
                    "remarks": t.remarks
                }
                for t in transactions
            ]
        }
    
    def get_aging_report(
        self,
        db: Session,
        customer_id: Optional[int] = None,
        branch_code: Optional[str] = None,
        branch_codes: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """AR aging. ``branch_code`` limits it to one branch; ``branch_codes`` (the
        caller's branch scope, None = all) limits it to those branches."""
        query = db.query(Invoice).filter(Invoice.credit_amount > 0)
        if customer_id:
            query = query.filter(Invoice.customer_id == customer_id)
        if branch_code:
            query = query.filter(Invoice.branch_code == branch_code)
        elif branch_codes is not None:
            query = query.filter(Invoice.branch_code.in_(branch_codes))
        
        invoices = query.all()
        
        aging = {
            "current": {"count": 0, "amount": Decimal("0")},
            "1_30_days": {"count": 0, "amount": Decimal("0")},
            "31_60_days": {"count": 0, "amount": Decimal("0")},
            "61_90_days": {"count": 0, "amount": Decimal("0")},
            "over_90_days": {"count": 0, "amount": Decimal("0")},
            "total": {"count": 0, "amount": Decimal("0")}
        }
        
        for invoice in invoices:
            customer = db.query(Customer).filter(Customer.id == invoice.customer_id).first()
            if not customer:
                continue
                
            remaining = self._get_invoice_remaining_credit(db, invoice.id, invoice.credit_amount)
            if remaining <= 0:
                continue
            
            days_overdue = self.get_days_overdue(invoice.created_date, customer.credit_days)
            
            if days_overdue <= 0:
                bucket = "current"
            elif days_overdue <= 30:
                bucket = "1_30_days"
            elif days_overdue <= 60:
                bucket = "31_60_days"
            elif days_overdue <= 90:
                bucket = "61_90_days"
            else:
                bucket = "over_90_days"
            
            aging[bucket]["count"] += 1
            aging[bucket]["amount"] += remaining
            aging["total"]["count"] += 1
            aging["total"]["amount"] += remaining

        for key in aging:
            aging[key]["amount"] = float(aging[key]["amount"])
        
        return aging
    
    def get_customer_statement(
        self, 
        db: Session, 
        customer_id: int,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None
    ) -> Dict[str, Any]:
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Customer {customer_id} not found"
            )

        from app.modules.sales.models import SaleReturn

        # Only LIVE credit invoices belong on the statement: approved/completed
        # and not cancelled/rejected/pending. Pending, cancelled and rejected
        # orders never created a receivable.
        invoices = db.query(Invoice).filter(
            Invoice.customer_id == customer_id,
            Invoice.credit_amount > 0,
            Invoice.status == True,
            Invoice.approval_status.in_(["approved", "completed"]),
        ).order_by(Invoice.created_date, Invoice.id).all()
        invoice_ids = [inv.id for inv in invoices]

        def _d(value) -> date:
            return value.date() if isinstance(value, datetime) else value

        # (sort_date, order, line) - order keeps INVOICE before PAYMENT/RETURN on a day
        entries = []
        settled_by_invoice: Dict[int, Decimal] = {}

        for invoice in invoices:
            due_date = self.calculate_due_date(invoice.created_date, customer.credit_days)
            entries.append((invoice.created_date, 0, {
                "date": invoice.created_date,
                "type": "INVOICE",
                "reference": invoice.invoice_no,
                "description": f"Invoice {invoice.invoice_no}",
                "debit": float(invoice.credit_amount),
                "credit": 0,
                "due_date": due_date,
            }))

        # Settlements count only when verified ("completed"); pending and
        # rejected transfers/cheques have not reduced what the customer owes.
        if invoice_ids:
            txns = db.query(
                CustomerCreditsSettleTransaction, CustomerCreditsSettle
            ).join(
                CustomerCreditsSettle,
                CustomerCreditsSettleTransaction.customer_credit_settle_id == CustomerCreditsSettle.id,
            ).filter(
                CustomerCreditsSettle.customer_id == customer_id,
                CustomerCreditsSettleTransaction.invoice_id.in_(invoice_ids),
                CustomerCreditsSettleTransaction.status == "completed",
            ).all()
            per_settlement: Dict[int, Dict[str, Any]] = {}
            for txn, settlement in txns:
                settled_by_invoice[txn.invoice_id] = (
                    settled_by_invoice.get(txn.invoice_id, Decimal("0")) + txn.payment_amount
                )
                row = per_settlement.setdefault(
                    settlement.id, {"settlement": settlement, "total": Decimal("0")}
                )
                row["total"] += txn.payment_amount
            for row in per_settlement.values():
                settlement = row["settlement"]
                entries.append((_d(settlement.created_date), 1, {
                    "date": _d(settlement.created_date),
                    "type": "PAYMENT",
                    "reference": settlement.customer_credits_settle_no,
                    "description": f"Payment received - {settlement.customer_credits_settle_no}",
                    "debit": 0,
                    "credit": float(row["total"]),
                    "due_date": None,
                }))

        # Returns / credit notes that cleared receivable: whatever part of the
        # invoice is neither settled nor still owed (balance_due is the ledger-
        # reconciled figure for credit invoices).
        for invoice in invoices:
            adjustment = (
                Decimal(str(invoice.credit_amount))
                - settled_by_invoice.get(invoice.id, Decimal("0"))
                - Decimal(str(invoice.balance_due or 0))
            )
            if adjustment <= 0:
                continue
            returns = db.query(SaleReturn).filter(
                SaleReturn.invoice_id == invoice.id,
                SaleReturn.status == "processed",
            ).order_by(SaleReturn.added_date, SaleReturn.id).all()
            ref = ", ".join(r.sale_return_no for r in returns) or invoice.invoice_no
            when = _d(returns[-1].refund_date or returns[-1].added_date) if returns else invoice.created_date
            when = max(when, invoice.created_date)
            entries.append((when, 1, {
                "date": when,
                "type": "RETURN",
                "reference": ref,
                "description": f"Sales return / credit note against {invoice.invoice_no}",
                "debit": 0,
                "credit": float(adjustment),
                "due_date": None,
            }))

        entries.sort(key=lambda e: (e[0], e[1]))

        running_balance = Decimal("0")
        opening_balance = Decimal("0")
        lines = []
        for when, _order, line in entries:
            if to_date and when > to_date:
                continue
            running_balance += Decimal(str(line["debit"])) - Decimal(str(line["credit"]))
            if from_date and when < from_date:
                opening_balance = running_balance
                continue
            line["balance"] = float(running_balance)
            lines.append(line)

        return {
            "customer_id": customer_id,
            "customer_name": customer.customer_name,
            "from_date": from_date,
            "to_date": to_date,
            "credit_days": customer.credit_days,
            "max_credit_limit": customer.max_credit_limit,
            "opening_balance": float(opening_balance),
            "current_balance": float(running_balance),
            "statement_lines": lines
        }

    def get_outstanding_documents(
        self,
        db: Session,
        customer_id: Optional[int] = None,
        branch_code: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get all outstanding (unpaid/partial) credit invoices across all customers.
        Only includes completed invoices with credit_amount > 0 that haven't been fully settled."""
        query = db.query(Invoice, Customer).join(
            Customer, Invoice.customer_id == Customer.id
        ).filter(
            Invoice.credit_amount > 0,
            Invoice.status == True,
            Invoice.approval_status == "completed",
        )
        if customer_id:
            query = query.filter(Invoice.customer_id == customer_id)
        if branch_code:
            query = query.filter(Invoice.branch_code == branch_code)

        rows = query.order_by(Invoice.created_date.desc()).all()

        items: list[Dict[str, Any]] = []
        total_outstanding = Decimal("0")
        total_overdue = Decimal("0")
        overdue_count = 0

        for invoice, customer in rows:
            remaining = self._get_invoice_remaining_credit(db, invoice.id, invoice.credit_amount)
            if remaining <= 0:
                continue
            due_date = self.calculate_due_date(invoice.created_date, customer.credit_days)
            days_overdue = (tz.today() - due_date).days
            is_overdue = days_overdue > 0

            total_outstanding += remaining
            if is_overdue:
                total_overdue += remaining
                overdue_count += 1

            items.append({
                "invoice_id": invoice.id,
                "invoice_no": invoice.invoice_no,
                "invoice_date": str(invoice.created_date),
                "customer_id": customer.id,
                "customer_name": customer.customer_name,
                "credit_amount": float(invoice.credit_amount),
                "paid_amount": float(invoice.credit_amount - remaining),
                "balance_due": float(remaining),
                "due_date": str(due_date),
                "days_overdue": max(days_overdue, 0),
                "is_overdue": is_overdue,
                "branch_code": invoice.branch_code,
            })

        return {
            "items": items,
            "summary": {
                "total_documents": len(items),
                "total_outstanding": float(total_outstanding),
                "total_overdue": float(total_overdue),
                "overdue_count": overdue_count,
            },
        }


customer_credit_service = CustomerCreditService()
