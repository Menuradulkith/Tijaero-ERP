from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from fastapi import HTTPException, status
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import List, Optional, Dict, Any

from app.modules.customers.models import (
    Customer, 
    CustomerCreditsSettle, 
    CustomerCreditsSettleTransaction
)
from app.modules.sales.models import Invoice
from app.modules.customers import schemas


class CustomerCreditService:

    
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
        return (date.today() - due_date).days
    

    
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
    
    def _calculate_outstanding_credit(self, db: Session, customer_id: int) -> Decimal:
        total_credit = db.query(func.coalesce(func.sum(Invoice.credit_amount), 0)).filter(
            Invoice.customer_id == customer_id,
            Invoice.credit_amount > 0
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
        cutoff_date = date.today() - timedelta(days=credit_days)
        
        invoices = db.query(Invoice).filter(
            Invoice.customer_id == customer_id,
            Invoice.credit_amount > 0,
            Invoice.created_date < cutoff_date
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
                    "days_overdue": (date.today() - due_date).days,
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
        
        new_outstanding = status["outstanding_credit"] + float(credit_amount)
        will_exceed = new_outstanding > status["max_credit_limit"]
        
        result = {
            "allowed": not will_exceed or allow_over_limit,
            "current_outstanding": status["outstanding_credit"],
            "new_credit_amount": float(credit_amount),
            "new_total_outstanding": new_outstanding,
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
    
    def update_customer_credit_balance(self, db: Session, customer_id: int):

        customer = db.query(Customer).filter(Customer.id == customer_id).first()
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

        settlement = CustomerCreditsSettle(
            customer_credits_settle_no=settlement_data.customer_credits_settle_no,
            branch_code=settlement_data.branch_code,
            customer_id=settlement_data.customer_id,
            created_date=datetime.now()
        )
        db.add(settlement)
        db.flush()

        for trans in settlement_data.transactions:
            transaction = CustomerCreditsSettleTransaction(
                payment_method=trans.payment_method,
                cheque_date=trans.cheque_date,
                payment_amount=trans.payment_amount,
                payment_method_number=trans.payment_method_number,
                remarks=trans.remarks,
                customer_credit_settle_id=settlement.id,
                invoice_id=trans.invoice_id,
                created_date=date.today()
            )
            db.add(transaction)
        
        db.commit()

        self.update_customer_credit_balance(db, settlement_data.customer_id)
        
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

customer_credit_service = CustomerCreditService()
