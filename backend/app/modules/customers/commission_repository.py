"""
Customer Agent Commission Repository
Database operations for commission management
"""

from typing import List, Optional, Tuple
from datetime import datetime, date
from decimal import Decimal
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, and_, case, text

from app.modules.customers.commission_models import (
    CustomerAgentCommission,
    CustomerAgentCommissionPayment,
    CustomerAgentCommissionPaymentItem,
)
from app.modules.customers.models import Customer
from app.modules.sales.models import Invoice


class CommissionRepository:
    """Repository for commission CRUD operations"""

    # =========================================================================
    # Commissions
    # =========================================================================

    def get_commission_by_id(self, db: Session, commission_id: int) -> Optional[CustomerAgentCommission]:
        return db.query(CustomerAgentCommission).filter(
            CustomerAgentCommission.id == commission_id
        ).first()

    def get_commissions(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 100,
        agent_id: Optional[int] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
    ) -> Tuple[List[dict], int]:
        """Get commissions with agent/customer/invoice details"""
        agent_customer = db.query(Customer).subquery()

        query = db.query(
            CustomerAgentCommission,
            Customer.customer_name.label("customer_name"),
            Invoice.invoice_no.label("invoice_no"),
        ).join(
            Invoice, CustomerAgentCommission.invoice_id == Invoice.id
        ).join(
            Customer, CustomerAgentCommission.represented_customer_id == Customer.id
        )

        if agent_id:
            query = query.filter(CustomerAgentCommission.customer_agent_id == agent_id)

        if status:
            query = query.filter(CustomerAgentCommission.status == status)

        if search:
            query = query.filter(
                or_(
                    Invoice.invoice_no.ilike(f"%{search}%"),
                    Customer.customer_name.ilike(f"%{search}%"),
                )
            )

        if date_from:
            query = query.filter(CustomerAgentCommission.created_at >= datetime.combine(date_from, datetime.min.time()))
        if date_to:
            query = query.filter(CustomerAgentCommission.created_at <= datetime.combine(date_to, datetime.max.time()))

        total = query.count()

        results = query.order_by(
            CustomerAgentCommission.created_at.desc()
        ).offset(skip).limit(limit).all()

        # Build enriched results
        enriched = []
        for commission, customer_name, invoice_no in results:
            # Get agent name
            agent = db.query(Customer.customer_name).filter(
                Customer.id == commission.customer_agent_id
            ).scalar()

            # Get total paid for this commission
            total_paid = db.query(
                func.coalesce(func.sum(CustomerAgentCommissionPaymentItem.paid_amount), 0)
            ).filter(
                CustomerAgentCommissionPaymentItem.commission_id == commission.id
            ).scalar()

            enriched.append({
                "commission": commission,
                "agent_name": agent,
                "customer_name": customer_name,
                "invoice_no": invoice_no,
                "total_paid": total_paid,
            })

        return enriched, total

    def get_commissions_by_invoice(self, db: Session, invoice_id: int) -> List[CustomerAgentCommission]:
        return db.query(CustomerAgentCommission).filter(
            CustomerAgentCommission.invoice_id == invoice_id
        ).all()

    def get_pending_commissions_by_agent(self, db: Session, agent_id: int) -> List[CustomerAgentCommission]:
        """Get approved but unpaid commissions for an agent"""
        return db.query(CustomerAgentCommission).filter(
            CustomerAgentCommission.customer_agent_id == agent_id,
            CustomerAgentCommission.status.in_(["pending", "approved"]),
        ).order_by(CustomerAgentCommission.created_at.asc()).all()

    def create_commission(self, db: Session, commission_data: dict) -> CustomerAgentCommission:
        commission = CustomerAgentCommission(**commission_data)
        db.add(commission)
        db.commit()
        db.refresh(commission)
        return commission

    def update_commission(self, db: Session, commission_id: int, update_data: dict) -> Optional[CustomerAgentCommission]:
        commission = self.get_commission_by_id(db, commission_id)
        if not commission:
            return None
        for field, value in update_data.items():
            if hasattr(commission, field) and value is not None:
                setattr(commission, field, value)
        db.commit()
        db.refresh(commission)
        return commission

    def delete_commission(self, db: Session, commission_id: int) -> bool:
        commission = self.get_commission_by_id(db, commission_id)
        if not commission:
            return False
        if commission.status != "pending":
            return False
        db.delete(commission)
        db.commit()
        return True

    # =========================================================================
    # Commission Payments
    # =========================================================================

    def get_payment_by_id(self, db: Session, payment_id: int) -> Optional[CustomerAgentCommissionPayment]:
        return db.query(CustomerAgentCommissionPayment).filter(
            CustomerAgentCommissionPayment.id == payment_id
        ).first()

    def get_payments(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 100,
        agent_id: Optional[int] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
    ) -> Tuple[List[dict], int]:
        """Get payments with agent details"""
        query = db.query(
            CustomerAgentCommissionPayment,
            Customer.customer_name.label("agent_name"),
        ).join(
            Customer, CustomerAgentCommissionPayment.customer_agent_id == Customer.id
        )

        if agent_id:
            query = query.filter(CustomerAgentCommissionPayment.customer_agent_id == agent_id)

        if status:
            query = query.filter(CustomerAgentCommissionPayment.status == status)

        if search:
            query = query.filter(
                or_(
                    CustomerAgentCommissionPayment.payment_no.ilike(f"%{search}%"),
                    Customer.customer_name.ilike(f"%{search}%"),
                    CustomerAgentCommissionPayment.reference_number.ilike(f"%{search}%"),
                )
            )

        total = query.count()

        results = query.order_by(
            CustomerAgentCommissionPayment.created_at.desc()
        ).offset(skip).limit(limit).all()

        enriched = []
        for payment, agent_name in results:
            enriched.append({
                "payment": payment,
                "agent_name": agent_name,
            })

        return enriched, total

    def get_payment_with_items(self, db: Session, payment_id: int) -> Optional[dict]:
        """Get payment with items and commission details"""
        payment = self.get_payment_by_id(db, payment_id)
        if not payment:
            return None

        agent_name = db.query(Customer.customer_name).filter(
            Customer.id == payment.customer_agent_id
        ).scalar()

        items_with_details = []
        for item in payment.items:
            commission = self.get_commission_by_id(db, item.commission_id)
            invoice_no = None
            if commission:
                invoice_no = db.query(Invoice.invoice_no).filter(
                    Invoice.id == commission.invoice_id
                ).scalar()

            items_with_details.append({
                "item": item,
                "invoice_no": invoice_no,
                "invoice_amount": commission.invoice_amount if commission else None,
                "commission_amount": commission.commission_amount if commission else None,
                "commission_status": commission.status if commission else None,
            })

        return {
            "payment": payment,
            "agent_name": agent_name,
            "items": items_with_details,
        }

    def generate_payment_no(self, db: Session) -> str:
        """Generate next payment number: ACP-YYYYMMDD-XXXX"""
        today = datetime.now().strftime("%Y%m%d")
        prefix = f"ACP-{today}-"

        # Advisory lock to prevent race conditions on sequence generation
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        last_payment = db.query(CustomerAgentCommissionPayment).filter(
            CustomerAgentCommissionPayment.payment_no.like(f"{prefix}%")
        ).order_by(CustomerAgentCommissionPayment.payment_no.desc()).first()

        if last_payment:
            last_num = int(last_payment.payment_no.split("-")[-1])
            next_num = last_num + 1
        else:
            next_num = 1

        return f"{prefix}{next_num:04d}"

    def create_payment(self, db: Session, payment_data: dict, items_data: list) -> CustomerAgentCommissionPayment:
        """Create a commission payment with items"""
        payment_no = self.generate_payment_no(db)
        payment_data["payment_no"] = payment_no

        payment = CustomerAgentCommissionPayment(**payment_data)
        db.add(payment)
        db.flush()

        for item_data in items_data:
            item = CustomerAgentCommissionPaymentItem(
                payment_id=payment.id,
                commission_id=item_data["commission_id"],
                paid_amount=item_data["paid_amount"],
            )
            db.add(item)

        db.commit()
        db.refresh(payment)
        return payment

    def verify_payment(self, db: Session, payment_id: int, verified_by: int) -> Optional[CustomerAgentCommissionPayment]:
        """Verify a payment"""
        payment = self.get_payment_by_id(db, payment_id)
        if not payment or payment.status != "pending":
            return None

        payment.status = "verified"
        payment.verified_by = verified_by
        payment.verified_date = datetime.utcnow()
        db.commit()
        db.refresh(payment)
        return payment

    def cancel_payment(self, db: Session, payment_id: int) -> Optional[CustomerAgentCommissionPayment]:
        """Cancel a payment"""
        payment = self.get_payment_by_id(db, payment_id)
        if not payment or payment.status != "pending":
            return None

        payment.status = "cancelled"
        db.commit()
        db.refresh(payment)
        return payment

    # =========================================================================
    # Summaries
    # =========================================================================

    def get_agent_commission_summary(self, db: Session, agent_id: int) -> dict:
        """Get commission summary for an agent"""
        agent = db.query(Customer).filter(Customer.id == agent_id).first()
        if not agent:
            return {}

        commissions = db.query(CustomerAgentCommission).filter(
            CustomerAgentCommission.customer_agent_id == agent_id
        ).all()

        total_commissions = Decimal("0")
        pending_amount = Decimal("0")
        approved_amount = Decimal("0")
        paid_amount = Decimal("0")
        pending_count = 0
        approved_count = 0
        paid_count = 0

        for c in commissions:
            total_commissions += c.commission_amount
            if c.status == "pending":
                pending_amount += c.commission_amount
                pending_count += 1
            elif c.status == "approved":
                approved_amount += c.commission_amount
                approved_count += 1
            elif c.status == "paid":
                paid_amount += c.commission_amount
                paid_count += 1

        return {
            "agent_id": agent_id,
            "agent_name": agent.customer_name,
            "total_commissions": total_commissions,
            "pending_amount": pending_amount,
            "approved_amount": approved_amount,
            "paid_amount": paid_amount,
            "total_invoices": len(commissions),
            "pending_count": pending_count,
            "approved_count": approved_count,
            "paid_count": paid_count,
        }

    def get_all_agents_with_commissions(self, db: Session) -> List[dict]:
        """Get list of all agents with their commission summaries"""
        agents = db.query(Customer).filter(
            Customer.is_customer_agent == True,
            Customer.active == True,
        ).all()

        result = []
        for agent in agents:
            summary = self.get_agent_commission_summary(db, agent.id)
            if summary:
                result.append(summary)

        return result

    # =========================================================================
    # Report Methods (Scenario 19)
    # =========================================================================

    def get_pending_commissions_report(
        self,
        db: Session,
        agent_id: Optional[int] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
    ) -> List[dict]:
        """Scenario 19.1: Get approved commissions not yet fully paid"""
        # Subquery: commission IDs that have been fully paid via payment items
        paid_subq = db.query(
            CustomerAgentCommissionPaymentItem.commission_id
        ).join(
            CustomerAgentCommissionPayment,
            CustomerAgentCommissionPaymentItem.payment_id == CustomerAgentCommissionPayment.id
        ).filter(
            CustomerAgentCommissionPayment.status != "cancelled"
        ).group_by(
            CustomerAgentCommissionPaymentItem.commission_id
        ).having(
            func.sum(CustomerAgentCommissionPaymentItem.paid_amount) >= 
            db.query(CustomerAgentCommission.commission_amount).filter(
                CustomerAgentCommission.id == CustomerAgentCommissionPaymentItem.commission_id
            ).correlate(CustomerAgentCommissionPaymentItem).scalar_subquery()
        ).subquery()

        query = db.query(
            CustomerAgentCommission,
            Customer.customer_name.label("customer_name"),
            Invoice.invoice_no.label("invoice_no"),
        ).join(
            Invoice, CustomerAgentCommission.invoice_id == Invoice.id
        ).join(
            Customer, CustomerAgentCommission.represented_customer_id == Customer.id
        ).filter(
            CustomerAgentCommission.status.in_(["approved", "pending"]),
            ~CustomerAgentCommission.id.in_(db.query(paid_subq))
        )

        if agent_id:
            query = query.filter(CustomerAgentCommission.customer_agent_id == agent_id)
        if date_from:
            query = query.filter(CustomerAgentCommission.created_at >= datetime.combine(date_from, datetime.min.time()))
        if date_to:
            query = query.filter(CustomerAgentCommission.created_at <= datetime.combine(date_to, datetime.max.time()))

        results = query.order_by(CustomerAgentCommission.created_at.desc()).all()

        enriched = []
        for commission, customer_name, invoice_no in results:
            agent_name = db.query(Customer.customer_name).filter(
                Customer.id == commission.customer_agent_id
            ).scalar()
            total_paid = db.query(
                func.coalesce(func.sum(CustomerAgentCommissionPaymentItem.paid_amount), 0)
            ).filter(
                CustomerAgentCommissionPaymentItem.commission_id == commission.id
            ).scalar()
            enriched.append({
                "commission": commission,
                "agent_name": agent_name,
                "customer_name": customer_name,
                "invoice_no": invoice_no,
                "total_paid": total_paid,
            })
        return enriched

    def get_agent_summary_with_date_range(
        self,
        db: Session,
        agent_id: Optional[int] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
    ) -> List[dict]:
        """Scenario 19.2: Agent commission summary with date range"""
        query = db.query(Customer).filter(
            Customer.is_customer_agent == True,
            Customer.active == True,
        )
        if agent_id:
            query = query.filter(Customer.id == agent_id)

        agents = query.all()
        result = []

        for agent in agents:
            comm_query = db.query(CustomerAgentCommission).filter(
                CustomerAgentCommission.customer_agent_id == agent.id
            )
            if date_from:
                comm_query = comm_query.filter(
                    CustomerAgentCommission.created_at >= datetime.combine(date_from, datetime.min.time())
                )
            if date_to:
                comm_query = comm_query.filter(
                    CustomerAgentCommission.created_at <= datetime.combine(date_to, datetime.max.time())
                )

            commissions = comm_query.all()

            total_commissions = Decimal("0")
            pending_amount = Decimal("0")
            approved_amount = Decimal("0")
            paid_amount = Decimal("0")
            pending_count = 0
            approved_count = 0
            paid_count = 0

            for c in commissions:
                total_commissions += c.commission_amount
                if c.status == "pending":
                    pending_amount += c.commission_amount
                    pending_count += 1
                elif c.status == "approved":
                    approved_amount += c.commission_amount
                    approved_count += 1
                elif c.status == "paid":
                    paid_amount += c.commission_amount
                    paid_count += 1

            result.append({
                "agent_id": agent.id,
                "agent_name": agent.customer_name,
                "total_commissions": total_commissions,
                "pending_amount": pending_amount,
                "approved_amount": approved_amount,
                "paid_amount": paid_amount,
                "total_invoices": len(commissions),
                "pending_count": pending_count,
                "approved_count": approved_count,
                "paid_count": paid_count,
            })

        return result

    def get_payment_history(
        self,
        db: Session,
        agent_id: Optional[int] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> Tuple[List[dict], int]:
        """Scenario 19.3: Payment history with date range filtering"""
        query = db.query(
            CustomerAgentCommissionPayment,
            Customer.customer_name.label("agent_name"),
        ).join(
            Customer, CustomerAgentCommissionPayment.customer_agent_id == Customer.id
        )

        if agent_id:
            query = query.filter(CustomerAgentCommissionPayment.customer_agent_id == agent_id)
        if date_from:
            query = query.filter(CustomerAgentCommissionPayment.payment_date >= date_from)
        if date_to:
            query = query.filter(CustomerAgentCommissionPayment.payment_date <= date_to)

        total = query.count()
        results = query.order_by(
            CustomerAgentCommissionPayment.payment_date.desc()
        ).offset(skip).limit(limit).all()

        enriched = []
        for payment, agent_name in results:
            # Get items with commission details
            items_details = []
            for item in payment.items:
                commission = self.get_commission_by_id(db, item.commission_id)
                invoice_no = None
                if commission:
                    invoice_no = db.query(Invoice.invoice_no).filter(
                        Invoice.id == commission.invoice_id
                    ).scalar()
                items_details.append({
                    "item": item,
                    "invoice_no": invoice_no,
                    "invoice_amount": commission.invoice_amount if commission else None,
                    "commission_amount": commission.commission_amount if commission else None,
                    "commission_status": commission.status if commission else None,
                })
            enriched.append({
                "payment": payment,
                "agent_name": agent_name,
                "items": items_details,
            })

        return enriched, total


commission_repository = CommissionRepository()
