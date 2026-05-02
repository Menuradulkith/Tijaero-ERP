from sqlalchemy.orm import Session
from sqlalchemy import func, and_, text
from fastapi import HTTPException, status
from datetime import date, datetime, timedelta
from decimal import Decimal
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
            "left_credit_amount": customer.left_credit_amount or (customer.max_credit_limit - outstanding),
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
        total_credit = db.query(func.coalesce(func.sum(Invoice.credit_amount), 0)).filter(
            Invoice.customer_id == customer_id,
            Invoice.credit_amount > 0,
            Invoice.status == True,  # Exclude cancelled invoices
            Invoice.approval_status.notin_(['cancelled', 'rejected'])  # Exclude rejected
        ).scalar() or Decimal("0")

        total_settled = db.query(
            func.coalesce(func.sum(CustomerCreditsSettleTransaction.payment_amount), 0)
        ).join(
            CustomerCreditsSettle,
            CustomerCreditsSettleTransaction.customer_credit_settle_id == CustomerCreditsSettle.id
        ).filter(
            CustomerCreditsSettle.customer_id == customer_id
        ).scalar() or Decimal("0")
        
        return total_credit - total_settled
    
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
            CustomerCreditsSettleTransaction.invoice_id == invoice_id
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
    
    def update_customer_credit_balance(self, db: Session, customer_id: int):
        # Lock the customer row to prevent concurrent credit balance updates
        customer = db.query(Customer).filter(Customer.id == customer_id).with_for_update().first()
        if not customer:
            return
        
        outstanding = self._calculate_outstanding_credit(db, customer_id)
        customer.left_credit_amount = int(customer.max_credit_limit - outstanding)
        db.commit()

    
    def create_credit_settlement(
        self, 
        db: Session, 
        settlement_data: schemas.CustomerCreditsSettleCreate
    ) -> CustomerCreditsSettle:

        customer = db.query(Customer).filter(
            Customer.id == settlement_data.customer_id
        ).first()
        if not customer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Customer {settlement_data.customer_id} not found"
            )

        for trans in settlement_data.transactions:
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

            remaining = self._get_invoice_remaining_credit(db, invoice.id, invoice.credit_amount)
            if trans.payment_amount > remaining:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Payment amount {trans.payment_amount} exceeds remaining credit {remaining} for invoice {invoice.invoice_no}"
                )

        # ── Advisory lock to prevent duplicate settlement numbers ──
        prefix = f"SETTLE{tz.today().strftime('%Y%m%d')}"
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        count = db.query(func.count(CustomerCreditsSettle.id)).filter(
            CustomerCreditsSettle.customer_credits_settle_no.like(f"{prefix}%")
        ).scalar()
        settle_no = f"{prefix}{count + 1:04d}"

        settlement = CustomerCreditsSettle(
            customer_credits_settle_no=settle_no,
            branch_code=settlement_data.branch_code,
            customer_id=settlement_data.customer_id,
            created_date=tz.now()
        )
        db.add(settlement)
        db.flush()

        created_transactions = []
        for trans in settlement_data.transactions:
            transaction = CustomerCreditsSettleTransaction(
                payment_method=trans.payment_method,
                cheque_date=trans.cheque_date,
                payment_amount=trans.payment_amount,
                payment_method_number=trans.payment_method_number,
                remarks=trans.remarks,
                customer_credit_settle_id=settlement.id,
                invoice_id=trans.invoice_id,
                created_date=tz.today()
            )
            db.add(transaction)
            created_transactions.append(transaction)
        
        db.commit()

        self.update_customer_credit_balance(db, settlement_data.customer_id)
        
        # ── GL Auto-Posting: Customer Credit Settlement (Gap B3) ─────────
        try:
            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
            gl_service = PurchaseExpensePayrollGL(db)
            gl_service.post_customer_credit_settlement_to_gl(
                settlement, created_transactions, user_id=0
            )
            db.commit()
        except Exception as gl_err:
            import logging
            logging.getLogger(__name__).warning(
                f"GL posting for credit settlement {settlement.customer_credits_settle_no} "
                f"failed (non-blocking): {gl_err}"
            )
        # ─────────────────────────────────────────────────────────────────
        
        db.refresh(settlement)
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
        for settle, customer_name in settlement_rows:
            txns = txn_by_settle.get(settle.id, [])
            total_amount = float(sum(txn.payment_amount for txn, _ in txns))
            methods = list(dict.fromkeys(txn.payment_method for txn, _ in txns if txn.payment_method))
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
                    "payment_method": t.payment_method,
                    "amount": float(t.payment_amount),
                    "reference": t.payment_method_number,
                    "remarks": t.remarks
                }
                for t in transactions
            ]
        }
    
    def get_aging_report(self, db: Session, customer_id: Optional[int] = None) -> Dict[str, Any]:

        query = db.query(Invoice).filter(Invoice.credit_amount > 0)
        if customer_id:
            query = query.filter(Invoice.customer_id == customer_id)
        
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

        invoice_query = db.query(Invoice).filter(
            Invoice.customer_id == customer_id,
            Invoice.credit_amount > 0
        )
        if from_date:
            invoice_query = invoice_query.filter(Invoice.created_date >= from_date)
        if to_date:
            invoice_query = invoice_query.filter(Invoice.created_date <= to_date)
        
        invoices = invoice_query.order_by(Invoice.created_date).all()

        settle_query = db.query(CustomerCreditsSettle).filter(
            CustomerCreditsSettle.customer_id == customer_id
        )
        if from_date:
            settle_query = settle_query.filter(CustomerCreditsSettle.created_date >= from_date)
        if to_date:
            settle_query = settle_query.filter(CustomerCreditsSettle.created_date <= to_date)
        
        settlements = settle_query.order_by(CustomerCreditsSettle.created_date).all()

        lines = []
        running_balance = Decimal("0")

        for invoice in invoices:
            due_date = self.calculate_due_date(invoice.created_date, customer.credit_days)
            running_balance += invoice.credit_amount
            lines.append({
                "date": invoice.created_date,
                "type": "INVOICE",
                "reference": invoice.invoice_no,
                "description": f"Invoice {invoice.invoice_no}",
                "debit": float(invoice.credit_amount),
                "credit": 0,
                "balance": float(running_balance),
                "due_date": due_date
            })

        for settlement in settlements:
            transactions = db.query(CustomerCreditsSettleTransaction).filter(
                CustomerCreditsSettleTransaction.customer_credit_settle_id == settlement.id
            ).all()
            
            total_payment = sum(t.payment_amount for t in transactions)
            running_balance -= total_payment
            
            lines.append({
                "date": settlement.created_date.date() if hasattr(settlement.created_date, 'date') else settlement.created_date,
                "type": "PAYMENT",
                "reference": settlement.customer_credits_settle_no,
                "description": f"Payment received - {settlement.customer_credits_settle_no}",
                "debit": 0,
                "credit": float(total_payment),
                "balance": float(running_balance),
                "due_date": None
            })

        lines.sort(key=lambda x: x["date"])

        running_balance = Decimal("0")
        for line in lines:
            if line["type"] == "INVOICE":
                running_balance += Decimal(str(line["debit"]))
            else:
                running_balance -= Decimal(str(line["credit"]))
            line["balance"] = float(running_balance)
        
        return {
            "customer_id": customer_id,
            "customer_name": customer.customer_name,
            "from_date": from_date,
            "to_date": to_date,
            "credit_days": customer.credit_days,
            "max_credit_limit": customer.max_credit_limit,
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
