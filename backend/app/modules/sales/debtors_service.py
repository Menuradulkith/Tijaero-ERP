"""
Debtors Management Service

Business logic for debtors management including calculations and data retrieval.
"""

from datetime import datetime, date, timedelta
from decimal import Decimal
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, desc, func, desc as desc_order
from typing import List, Dict, Optional, Tuple

from app.modules.sales.models import Invoice
from app.modules.sales.debtors_models import InvoicePayment, CustomerFollowup
from app.modules.customers.models import Customer


class DebtorsService:
    """Service for managing debtors and collections"""

    @staticmethod
    def get_outstanding_balance(db: Session, invoice_id: int) -> Decimal:
        """Calculate outstanding balance for an invoice"""
        invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
        if not invoice:
            return Decimal(0)
        
        total_paid = db.query(func.sum(InvoicePayment.amount)).filter(
            InvoicePayment.invoice_id == invoice_id
        ).scalar() or Decimal(0)
        
        invoice_amount = invoice.grand_total or Decimal(0)
        outstanding = max(Decimal(0), invoice_amount - total_paid)
        
        return outstanding

    @staticmethod
    def get_days_overdue(invoice: Invoice) -> int:
        """Calculate days overdue for an invoice"""
        if not invoice.created_date:
            return 0
        
        # Calculate due date: created_date + credit_days
        customer = invoice.customer
        if not customer:
            return 0
        
        credit_days = customer.credit_days or 0
        due_date = invoice.created_date + timedelta(days=credit_days)
        
        days_overdue = (date.today() - due_date).days
        return max(0, days_overdue)

    @staticmethod
    def get_invoice_status(invoice_id: int, db: Session) -> str:
        """Determine invoice payment status"""
        invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
        if not invoice:
            return "unknown"
        
        outstanding = DebtorsService.get_outstanding_balance(db, invoice_id)
        invoice_amount = invoice.grand_total or Decimal(0)
        
        if outstanding == 0:
            return "paid"
        
        if outstanding < invoice_amount:
            return "partial"
        
        days_overdue = DebtorsService.get_days_overdue(invoice)
        if days_overdue > 0:
            return "overdue"
        
        return "unpaid"

    @staticmethod
    def get_debtor_status(customer_id: int, db: Session) -> str:
        """Determine overall debtor status (current, overdue, critical)"""
        # Get all outstanding invoices for customer
        outstanding_invoices = db.query(Invoice).filter(
            and_(
                Invoice.customer_id == customer_id,
                Invoice.payment_status.in_(['unpaid', 'partial'])
            )
        ).all()
        
        if not outstanding_invoices:
            return "current"
        
        # Check if any invoices are critical (90+ days overdue)
        for invoice in outstanding_invoices:
            days_overdue = DebtorsService.get_days_overdue(invoice)
            if days_overdue >= 90:
                return "critical"
        
        # Check if any invoices are overdue
        for invoice in outstanding_invoices:
            days_overdue = DebtorsService.get_days_overdue(invoice)
            if days_overdue > 0:
                return "overdue"
        
        return "current"

    @staticmethod
    def get_days_outstanding(invoice: Invoice) -> int:
        """Calculate days since invoice was created"""
        if not invoice.created_date:
            return 0
        
        days = (date.today() - invoice.created_date).days
        return max(0, days)

    @staticmethod
    def get_debtors_list(
        db: Session,
        status_filter: str = "all",
        sort_by: str = "outstanding_balance",
        sort_order: str = "desc",
        skip: int = 0,
        limit: int = 100,
        branch_code: Optional[str] = None
    ) -> Dict:
        """Get list of debtors with filtering and sorting"""
        
        # Query all customers
        customer_query = db.query(Customer).filter(Customer.active == True)
        
        debtors = []
        total_outstanding_all = Decimal(0)
        total_overdue_all = Decimal(0)
        critical_count = 0
        overdue_count = 0
        current_count = 0
        
        for customer in customer_query.all():
            # Get outstanding invoices for this customer
            invoices_query = db.query(Invoice).filter(
                and_(
                    Invoice.customer_id == customer.id,
                    Invoice.payment_status.in_(['unpaid', 'partial'])
                )
            )
            
            if branch_code:
                invoices_query = invoices_query.filter(Invoice.branch_code == branch_code)
            
            outstanding_invoices = invoices_query.all()
            
            if not outstanding_invoices:
                continue
            
            # Calculate totals
            total_sales = Decimal(0)
            total_paid = Decimal(0)
            oldest_invoice = None
            max_days_overdue = 0
            
            for invoice in outstanding_invoices:
                invoice_amount = invoice.grand_total or Decimal(0)
                total_sales += invoice_amount
                
                # Get payments for this invoice
                payments = db.query(func.sum(InvoicePayment.amount)).filter(
                    InvoicePayment.invoice_id == invoice.id
                ).scalar() or Decimal(0)
                total_paid += payments
                
                # Track oldest invoice
                if oldest_invoice is None or invoice.created_date < oldest_invoice.created_date:
                    oldest_invoice = invoice
                
                # Track max days overdue
                days_overdue = DebtorsService.get_days_overdue(invoice)
                max_days_overdue = max(max_days_overdue, days_overdue)
            
            outstanding_balance = total_sales - total_paid
            
            if outstanding_balance <= 0:
                continue
            
            # Determine status
            debtor_status = DebtorsService.get_debtor_status(customer.id, db)
            
            # Update totals
            total_outstanding_all += outstanding_balance
            
            if debtor_status == "critical":
                total_overdue_all += outstanding_balance
                critical_count += 1
            elif debtor_status == "overdue":
                total_overdue_all += outstanding_balance
                overdue_count += 1
            else:
                current_count += 1
            
            debtor = {
                'customer_id': customer.id,
                'customer_name': customer.customer_name,
                'company_name': customer.company_name,
                'outstanding_balance': outstanding_balance,
                'credit_limit': Decimal(customer.max_credit_limit or 0),
                'credit_days': customer.credit_days or 0,
                'days_overdue': max_days_overdue,
                'status': debtor_status,
                'contact_number': customer.mobile_contact_number,
                'email': customer.email,
                'last_sale_date': oldest_invoice.created_date if oldest_invoice else None,
                'oldest_invoice_date': oldest_invoice.created_date if oldest_invoice else None,
                'total_credit_sales': total_sales,
                'total_paid': total_paid,
            }
            
            # Apply status filter
            if status_filter != "all" and debtor['status'] != status_filter:
                continue
            
            debtors.append(debtor)
        
        # Sort debtors
        if sort_by == "outstanding_balance":
            debtors.sort(
                key=lambda x: x['outstanding_balance'],
                reverse=(sort_order == "desc")
            )
        elif sort_by == "days_overdue":
            debtors.sort(
                key=lambda x: x['days_overdue'],
                reverse=(sort_order == "desc")
            )
        elif sort_by == "customer_name":
            debtors.sort(
                key=lambda x: x['customer_name'],
                reverse=(sort_order == "desc")
            )
        
        # Paginate
        total_debtors = len(debtors)
        debtors_page = debtors[skip:skip+limit]
        
        return {
            'total_debtors': total_debtors,
            'total_outstanding': total_outstanding_all,
            'total_overdue': total_overdue_all,
            'critical_count': critical_count,
            'overdue_count': overdue_count,
            'current_count': current_count,
            'debtors': debtors_page
        }

    @staticmethod
    def get_customer_debt_details(db: Session, customer_id: int) -> Optional[Dict]:
        """Get detailed debt information for a customer"""
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            return None
        
        # Get outstanding invoices
        invoices = db.query(Invoice).filter(
            and_(
                Invoice.customer_id == customer_id,
                Invoice.payment_status.in_(['unpaid', 'partial'])
            )
        ).order_by(Invoice.created_date.desc()).all()
        
        invoice_details = []
        total_outstanding = Decimal(0)
        
        for invoice in invoices:
            outstanding = DebtorsService.get_outstanding_balance(db, invoice.id)
            days_overdue = DebtorsService.get_days_overdue(invoice)
            days_outstanding = DebtorsService.get_days_outstanding(invoice)
            paid = (invoice.grand_total or Decimal(0)) - outstanding
            
            invoice_details.append({
                'invoice_id': invoice.id,
                'invoice_no': invoice.invoice_no,
                'sale_date': invoice.created_date,
                'created_date': invoice.created_date,
                'invoice_amount': invoice.grand_total or Decimal(0),
                'amount_paid': paid,
                'outstanding_balance': outstanding,
                'days_outstanding': days_outstanding,
                'days_overdue': max(0, days_overdue),
                'status': DebtorsService.get_invoice_status(invoice.id, db),
                'payment_status': invoice.payment_status,
                'items_description': invoice.remarks
            })
            
            total_outstanding += outstanding
        
        # Get follow-ups
        followups = db.query(CustomerFollowup).filter(
            CustomerFollowup.customer_id == customer_id
        ).order_by(CustomerFollowup.followup_date.desc()).all()
        
        return {
            'customer_id': customer_id,
            'customer_name': customer.customer_name,
            'company_name': customer.company_name,
            'phone': customer.mobile_contact_number,
            'email': customer.email,
            'credit_limit': Decimal(customer.max_credit_limit or 0),
            'credit_days': customer.credit_days or 0,
            'total_outstanding': total_outstanding,
            'invoices': invoice_details,
            'followup_history': [
                {
                    'id': f.id,
                    'customer_id': f.customer_id,
                    'followup_date': f.followup_date,
                    'followup_type': f.followup_type,
                    'notes': f.notes,
                    'amount_promised': f.amount_promised,
                    'promised_payment_date': f.promised_payment_date,
                    'created_by': f.created_by,
                    'is_resolved': f.is_resolved,
                }
                for f in followups
            ]
        }

    @staticmethod
    def record_payment(
        db: Session,
        customer_id: int,
        invoice_id: int,
        amount: Decimal,
        payment_date: date,
        payment_method: str,
        branch_code: str,
        reference_no: Optional[str] = None,
        notes: Optional[str] = None,
        created_by: Optional[int] = None
    ) -> Dict:
        """Record a payment against an invoice"""
        
        # SELECT ... FOR UPDATE on the invoice row to serialize concurrent
        # payments. Without this lock two simultaneous payments can each read
        # the same outstanding balance, both pass the check below, and together
        # over-apply beyond what is owed. Holding the row lock makes the
        # outstanding-balance check and the paid_amount update atomic.
        invoice = db.query(Invoice).filter(
            and_(Invoice.id == invoice_id, Invoice.customer_id == customer_id)
        ).with_for_update().first()
        
        if not invoice:
            raise ValueError("Invalid invoice or customer")
        
        outstanding = DebtorsService.get_outstanding_balance(db, invoice_id)
        if amount > outstanding:
            raise ValueError(f"Payment amount exceeds outstanding balance: {outstanding}")
        
        payment = InvoicePayment(
            invoice_id=invoice_id,
            customer_id=customer_id,
            amount=amount,
            payment_date=payment_date,
            payment_method=payment_method,
            reference_no=reference_no,
            notes=notes,
            branch_code=branch_code,
            created_by=created_by
        )
        
        db.add(payment)
        
        # Update invoice paid_amount and balance_due
        invoice.paid_amount = (invoice.paid_amount or Decimal(0)) + amount
        invoice.balance_due = (invoice.grand_total or Decimal(0)) - invoice.paid_amount
        
        # Update payment status
        if invoice.balance_due <= 0:
            invoice.payment_status = "paid"
        elif invoice.paid_amount > 0:
            invoice.payment_status = "partial"
        else:
            invoice.payment_status = "unpaid"
        
        db.commit()
        db.refresh(payment)
        
        return {
            'id': payment.id,
            'invoice_id': payment.invoice_id,
            'customer_id': payment.customer_id,
            'amount': payment.amount,
            'payment_date': payment.payment_date,
            'payment_method': payment.payment_method,
            'reference_no': payment.reference_no,
            'notes': payment.notes,
            'created_at': payment.created_at,
            'created_by': payment.created_by
        }

    @staticmethod
    def create_followup(
        db: Session,
        customer_id: int,
        followup_date: date,
        followup_type: str,
        notes: str,
        branch_code: str,
        amount_promised: Optional[Decimal] = None,
        promised_payment_date: Optional[date] = None,
        created_by: Optional[int] = None
    ) -> Dict:
        """Create a follow-up record"""
        
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            raise ValueError("Customer not found")
        
        followup = CustomerFollowup(
            customer_id=customer_id,
            followup_date=followup_date,
            followup_type=followup_type,
            notes=notes,
            amount_promised=amount_promised,
            promised_payment_date=promised_payment_date,
            branch_code=branch_code,
            created_by=created_by,
            is_resolved=0
        )
        
        db.add(followup)
        db.commit()
        db.refresh(followup)
        
        return {
            'id': followup.id,
            'customer_id': followup.customer_id,
            'followup_date': followup.followup_date,
            'followup_type': followup.followup_type,
            'notes': followup.notes,
            'amount_promised': followup.amount_promised,
            'promised_payment_date': followup.promised_payment_date,
            'created_at': followup.created_at,
            'created_by': followup.created_by,
            'is_resolved': followup.is_resolved,
        }

    @staticmethod
    def get_followup_history(db: Session, customer_id: int) -> List[Dict]:
        """Get follow-up history for a customer"""
        followups = db.query(CustomerFollowup).filter(
            CustomerFollowup.customer_id == customer_id
        ).order_by(CustomerFollowup.followup_date.desc()).all()
        
        return [
            {
                'id': f.id,
                'customer_id': f.customer_id,
                'followup_date': f.followup_date,
                'followup_type': f.followup_type,
                'notes': f.notes,
                'amount_promised': f.amount_promised,
                'promised_payment_date': f.promised_payment_date,
                'created_at': f.created_at,
                'created_by': f.created_by,
                'is_resolved': f.is_resolved,
            }
            for f in followups
        ]
