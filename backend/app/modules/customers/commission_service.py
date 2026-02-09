"""
Customer Agent Commission Service
Business logic for commission management
"""

from typing import List, Optional
from datetime import datetime, date
from decimal import Decimal
from sqlalchemy.orm import Session
from fastapi import HTTPException, status

from app.modules.customers.commission_repository import commission_repository
from app.modules.customers.commission_schemas import (
    CustomerAgentCommissionCreate,
    CustomerAgentCommissionUpdate,
    CustomerAgentCommissionWithDetails,
    CustomerAgentCommissionPaymentCreate,
    CustomerAgentCommissionPaymentUpdate,
    CustomerAgentCommissionPaymentWithItems,
    CommissionPaymentItemWithDetails,
    AgentCommissionSummary,
    CommissionListResponse,
)
from app.modules.customers.commission_models import (
    CustomerAgentCommission,
    CustomerAgentCommissionPayment,
    CustomerAgentCommissionPaymentItem,
)
from app.modules.customers.models import Customer
from app.modules.sales.models import Invoice


class CommissionService:
    """Service for managing customer agent commissions"""

    # =========================================================================
    # Commissions
    # =========================================================================

    def get_commission(self, db: Session, commission_id: int) -> CustomerAgentCommission:
        commission = commission_repository.get_commission_by_id(db, commission_id)
        if not commission:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Commission with id {commission_id} not found"
            )
        return commission

    def get_commissions(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 100,
        agent_id: Optional[int] = None,
        commission_status: Optional[str] = None,
        search: Optional[str] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
    ) -> CommissionListResponse:
        """Get paginated commissions with details"""
        enriched, total = commission_repository.get_commissions(
            db, skip, limit, agent_id, commission_status, search, date_from, date_to
        )

        items = []
        for entry in enriched:
            commission = entry["commission"]
            item = CustomerAgentCommissionWithDetails(
                id=commission.id,
                invoice_id=commission.invoice_id,
                customer_agent_id=commission.customer_agent_id,
                represented_customer_id=commission.represented_customer_id,
                invoice_amount=commission.invoice_amount,
                commission_type=commission.commission_type,
                commission_rate=commission.commission_rate,
                commission_amount=commission.commission_amount,
                status=commission.status,
                approved_by=commission.approved_by,
                approved_date=commission.approved_date,
                remarks=commission.remarks,
                created_at=commission.created_at,
                updated_at=commission.updated_at,
                agent_name=entry["agent_name"],
                customer_name=entry["customer_name"],
                invoice_no=entry["invoice_no"],
                total_paid=entry["total_paid"],
            )
            items.append(item)

        return CommissionListResponse(items=items, total=total)

    def create_commission(
        self,
        db: Session,
        data: CustomerAgentCommissionCreate,
    ) -> CustomerAgentCommission:
        """Create a new commission record"""
        # Validate agent exists and is_customer_agent
        agent = db.query(Customer).filter(Customer.id == data.customer_agent_id).first()
        if not agent:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Customer Agent with id {data.customer_agent_id} not found"
            )
        if not agent.is_customer_agent:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Customer '{agent.customer_name}' is not registered as a customer agent"
            )

        # Validate represented customer exists
        customer = db.query(Customer).filter(Customer.id == data.represented_customer_id).first()
        if not customer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Represented customer with id {data.represented_customer_id} not found"
            )

        # Validate invoice exists
        invoice = db.query(Invoice).filter(Invoice.id == data.invoice_id).first()
        if not invoice:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Invoice with id {data.invoice_id} not found"
            )

        # Validate commission type
        if data.commission_type not in ["PERCENT", "AMOUNT"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="commission_type must be 'PERCENT' or 'AMOUNT'"
            )

        if data.commission_type == "PERCENT" and (data.commission_rate is None or data.commission_rate <= 0):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="commission_rate is required and must be > 0 for PERCENT type"
            )

        commission_data = data.model_dump()
        return commission_repository.create_commission(db, commission_data)

    def update_commission(
        self,
        db: Session,
        commission_id: int,
        data: CustomerAgentCommissionUpdate,
    ) -> CustomerAgentCommission:
        """Update a commission record"""
        commission = self.get_commission(db, commission_id)

        if commission.status == "paid":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot update a paid commission"
            )

        update_data = data.model_dump(exclude_unset=True)
        updated = commission_repository.update_commission(db, commission_id, update_data)
        if not updated:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Commission with id {commission_id} not found"
            )
        return updated

    def approve_commission(
        self,
        db: Session,
        commission_id: int,
        approved_by: int,
    ) -> CustomerAgentCommission:
        """Approve a pending commission"""
        commission = self.get_commission(db, commission_id)

        if commission.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Commission is '{commission.status}', only 'pending' commissions can be approved"
            )

        update_data = {
            "status": "approved",
            "approved_by": approved_by,
            "approved_date": datetime.utcnow(),
        }
        return commission_repository.update_commission(db, commission_id, update_data)

    def delete_commission(self, db: Session, commission_id: int) -> dict:
        """Delete a pending commission"""
        commission = self.get_commission(db, commission_id)

        if commission.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete commission with status '{commission.status}'. Only pending commissions can be deleted."
            )

        success = commission_repository.delete_commission(db, commission_id)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to delete commission"
            )
        return {"message": "Commission deleted successfully"}

    # =========================================================================
    # Commission Payments
    # =========================================================================

    def get_payment(self, db: Session, payment_id: int) -> CustomerAgentCommissionPayment:
        payment = commission_repository.get_payment_by_id(db, payment_id)
        if not payment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Commission payment with id {payment_id} not found"
            )
        return payment

    def get_payments(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 100,
        agent_id: Optional[int] = None,
        payment_status: Optional[str] = None,
        search: Optional[str] = None,
    ) -> dict:
        """Get paginated payments with details"""
        enriched, total = commission_repository.get_payments(
            db, skip, limit, agent_id, payment_status, search
        )

        items = []
        for entry in enriched:
            payment = entry["payment"]
            item = {
                **payment.__dict__,
                "agent_name": entry["agent_name"],
            }
            # Remove SQLAlchemy internal state
            item.pop("_sa_instance_state", None)
            items.append(item)

        return {"items": items, "total": total}

    def get_payment_with_items(self, db: Session, payment_id: int) -> dict:
        """Get payment with items and details"""
        result = commission_repository.get_payment_with_items(db, payment_id)
        if not result:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Commission payment with id {payment_id} not found"
            )
        return result

    def create_payment(
        self,
        db: Session,
        data: CustomerAgentCommissionPaymentCreate,
        created_by: int,
    ) -> CustomerAgentCommissionPayment:
        """Create a commission payment"""
        # Validate agent exists and is_customer_agent
        agent = db.query(Customer).filter(Customer.id == data.customer_agent_id).first()
        if not agent:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Customer Agent with id {data.customer_agent_id} not found"
            )
        if not agent.is_customer_agent:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Customer '{agent.customer_name}' is not registered as a customer agent"
            )

        # Validate all commission items
        total_items_amount = Decimal("0")
        for item in data.items:
            commission = commission_repository.get_commission_by_id(db, item.commission_id)
            if not commission:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Commission with id {item.commission_id} not found"
                )
            if commission.customer_agent_id != data.customer_agent_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Commission {item.commission_id} does not belong to agent {data.customer_agent_id}"
                )
            if commission.status not in ["approved", "pending"]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Commission {item.commission_id} has status '{commission.status}' and cannot be paid"
                )
            total_items_amount += item.paid_amount

        # Validate total payment matches items (with tolerance for floating point)
        if abs(total_items_amount - data.payment_amount) > Decimal("0.01"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Payment amount ({data.payment_amount}) does not match sum of items ({total_items_amount})"
            )

        payment_data = data.model_dump(exclude={"items"})
        payment_data["created_by"] = created_by
        items_data = [item.model_dump() for item in data.items]

        payment = commission_repository.create_payment(db, payment_data, items_data)

        # Update commission statuses to 'paid' for fully paid commissions
        for item in data.items:
            commission = commission_repository.get_commission_by_id(db, item.commission_id)
            if commission:
                # Calculate total paid for this commission
                total_paid = db.query(
                    func.coalesce(func.sum(CustomerAgentCommissionPaymentItem.paid_amount), 0)
                ).filter(
                    CustomerAgentCommissionPaymentItem.commission_id == commission.id
                ).scalar()

                if total_paid >= commission.commission_amount:
                    commission.status = "paid"
                    db.commit()

        return payment

    def verify_payment(
        self,
        db: Session,
        payment_id: int,
        verified_by: int,
    ) -> CustomerAgentCommissionPayment:
        """Verify a payment"""
        payment = commission_repository.verify_payment(db, payment_id, verified_by)
        if not payment:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Payment not found or is not in 'pending' status"
            )
        return payment

    def cancel_payment(self, db: Session, payment_id: int) -> CustomerAgentCommissionPayment:
        """Cancel a payment"""
        payment = commission_repository.cancel_payment(db, payment_id)
        if not payment:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Payment not found or is not in 'pending' status"
            )

        # Revert commission statuses if needed
        for item in payment.items:
            commission = commission_repository.get_commission_by_id(db, item.commission_id)
            if commission and commission.status == "paid":
                commission.status = "approved"
                db.commit()

        return payment

    # =========================================================================
    # Summaries
    # =========================================================================

    def get_agent_summary(self, db: Session, agent_id: int) -> AgentCommissionSummary:
        """Get commission summary for an agent"""
        summary_data = commission_repository.get_agent_commission_summary(db, agent_id)
        if not summary_data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Agent with id {agent_id} not found"
            )
        return AgentCommissionSummary(**summary_data)

    def get_all_agents_summary(self, db: Session) -> List[AgentCommissionSummary]:
        """Get commission summaries for all agents"""
        summaries = commission_repository.get_all_agents_with_commissions(db)
        return [AgentCommissionSummary(**s) for s in summaries]

    def get_pending_commissions_for_agent(self, db: Session, agent_id: int) -> List[CustomerAgentCommission]:
        """Get pending/approved commissions for an agent (for payment creation)"""
        agent = db.query(Customer).filter(Customer.id == agent_id).first()
        if not agent:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Agent with id {agent_id} not found"
            )
        if not agent.is_customer_agent:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Customer '{agent.customer_name}' is not a customer agent"
            )
        return commission_repository.get_pending_commissions_by_agent(db, agent_id)

    # =========================================================================
    # Report Methods (Scenario 19)
    # =========================================================================

    def get_pending_commissions_report(
        self,
        db: Session,
        agent_id: Optional[int] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
    ) -> List[CustomerAgentCommissionWithDetails]:
        """Scenario 19.1: Pending commissions report"""
        enriched = commission_repository.get_pending_commissions_report(db, agent_id, date_from, date_to)
        items = []
        for entry in enriched:
            commission = entry["commission"]
            items.append(CustomerAgentCommissionWithDetails(
                id=commission.id,
                invoice_id=commission.invoice_id,
                customer_agent_id=commission.customer_agent_id,
                represented_customer_id=commission.represented_customer_id,
                invoice_amount=commission.invoice_amount,
                commission_type=commission.commission_type,
                commission_rate=commission.commission_rate,
                commission_amount=commission.commission_amount,
                status=commission.status,
                approved_by=commission.approved_by,
                approved_date=commission.approved_date,
                remarks=commission.remarks,
                created_at=commission.created_at,
                updated_at=commission.updated_at,
                agent_name=entry["agent_name"],
                customer_name=entry["customer_name"],
                invoice_no=entry["invoice_no"],
                total_paid=entry["total_paid"],
            ))
        return items

    def get_agent_summary_report(
        self,
        db: Session,
        agent_id: Optional[int] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
    ) -> List[AgentCommissionSummary]:
        """Scenario 19.2: Agent commission summary report"""
        summaries = commission_repository.get_agent_summary_with_date_range(
            db, agent_id, date_from, date_to
        )
        return [AgentCommissionSummary(**s) for s in summaries]

    def get_payment_history_report(
        self,
        db: Session,
        agent_id: Optional[int] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> dict:
        """Scenario 19.3: Payment history report"""
        enriched, total = commission_repository.get_payment_history(
            db, agent_id, date_from, date_to, skip, limit
        )
        items = []
        for entry in enriched:
            payment = entry["payment"]
            item = {
                **payment.__dict__,
                "agent_name": entry["agent_name"],
                "items": entry["items"],
            }
            item.pop("_sa_instance_state", None)
            items.append(item)
        return {"items": items, "total": total}


# Import func for payment creation
from sqlalchemy import func

commission_service = CommissionService()
