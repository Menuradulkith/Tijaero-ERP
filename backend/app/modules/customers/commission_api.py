"""
Customer Agent Commission API
FastAPI router for commission management endpoints
"""

from typing import List, Optional
from datetime import date
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.auth.models import User
from app.auth.rbac import require_permission, Permissions

from app.modules.customers.commission_service import commission_service
from app.modules.customers import commission_schemas as schemas

router = APIRouter()


# =============================================================================
# Commission Endpoints
# =============================================================================

@router.get(
    "/",
    response_model=schemas.CommissionListResponse,
    summary="List Agent Commissions",
    description="Get paginated list of agent commissions with details",
    dependencies=[Depends(require_permission(*Permissions.AGENT_COMMISSION_VIEW))],
)
def list_commissions(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    agent_id: Optional[int] = Query(None, description="Filter by agent ID"),
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by status (pending/approved/paid)"),
    search: Optional[str] = Query(None, description="Search by invoice no or customer name"),
    date_from: Optional[date] = Query(None, description="Filter commissions from this date"),
    date_to: Optional[date] = Query(None, description="Filter commissions up to this date"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.AGENT_COMMISSION_VIEW)),
):
    return commission_service.get_commissions(
        db, skip, limit, agent_id, status_filter, search, date_from, date_to
    )


@router.get(
    "/agents-summary",
    response_model=List[schemas.AgentCommissionSummary],
    summary="Get All Agents Commission Summary",
    description="Get commission summaries for all active agents",
    dependencies=[Depends(require_permission(*Permissions.AGENT_COMMISSION_VIEW))],
)
def get_all_agents_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.AGENT_COMMISSION_VIEW)),
):
    return commission_service.get_all_agents_summary(db)


@router.get(
    "/agent/{agent_id}/summary",
    response_model=schemas.AgentCommissionSummary,
    summary="Get Agent Commission Summary",
    description="Get commission summary for a specific agent",
    dependencies=[Depends(require_permission(*Permissions.AGENT_COMMISSION_VIEW))],
)
def get_agent_summary(
    agent_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.AGENT_COMMISSION_VIEW)),
):
    return commission_service.get_agent_summary(db, agent_id)


@router.get(
    "/agent/{agent_id}/pending",
    response_model=List[schemas.CustomerAgentCommission],
    summary="Get Pending Commissions for Agent",
    description="Get approved/pending commissions for an agent (for payment creation)",
    dependencies=[Depends(require_permission(*Permissions.AGENT_COMMISSION_VIEW))],
)
def get_pending_commissions_for_agent(
    agent_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.AGENT_COMMISSION_VIEW)),
):
    return commission_service.get_pending_commissions_for_agent(db, agent_id)


@router.get(
    "/{commission_id}",
    response_model=schemas.CustomerAgentCommission,
    summary="Get Commission by ID",
    description="Retrieve commission details by ID",
    dependencies=[Depends(require_permission(*Permissions.AGENT_COMMISSION_VIEW))],
)
def get_commission(
    commission_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.AGENT_COMMISSION_VIEW)),
):
    return commission_service.get_commission(db, commission_id)


@router.post(
    "/",
    response_model=schemas.CustomerAgentCommission,
    status_code=status.HTTP_201_CREATED,
    summary="Create Commission",
    description="Create a new commission record for an agent",
    dependencies=[Depends(require_permission(*Permissions.AGENT_COMMISSION_CREATE))],
)
def create_commission(
    data: schemas.CustomerAgentCommissionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.AGENT_COMMISSION_CREATE)),
):
    return commission_service.create_commission(db, data)


@router.put(
    "/{commission_id}",
    response_model=schemas.CustomerAgentCommission,
    summary="Update Commission",
    description="Update a commission record",
    dependencies=[Depends(require_permission(*Permissions.AGENT_COMMISSION_UPDATE))],
)
def update_commission(
    commission_id: int,
    data: schemas.CustomerAgentCommissionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.AGENT_COMMISSION_UPDATE)),
):
    return commission_service.update_commission(db, commission_id, data)


@router.post(
    "/{commission_id}/approve",
    response_model=schemas.CustomerAgentCommission,
    summary="Approve Commission",
    description="Approve a pending commission",
    dependencies=[Depends(require_permission(*Permissions.COMMISSION_APPROVAL_APPROVE))],
)
def approve_commission(
    commission_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.COMMISSION_APPROVAL_APPROVE)),
):
    return commission_service.approve_commission(db, commission_id, current_user.id)


@router.delete(
    "/{commission_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete Commission",
    description="Delete a pending commission",
    dependencies=[Depends(require_permission(*Permissions.AGENT_COMMISSION_DELETE))],
)
def delete_commission(
    commission_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.AGENT_COMMISSION_DELETE)),
):
    return commission_service.delete_commission(db, commission_id)


# =============================================================================
# Commission Payment Endpoints
# =============================================================================

@router.get(
    "/payments/",
    summary="List Commission Payments",
    description="Get paginated list of commission payments",
    dependencies=[Depends(require_permission(*Permissions.COMMISSION_PAYMENT_VIEW))],
)
def list_payments(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    agent_id: Optional[int] = Query(None, description="Filter by agent ID"),
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by status"),
    search: Optional[str] = Query(None, description="Search by payment no or agent name"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.COMMISSION_PAYMENT_VIEW)),
):
    return commission_service.get_payments(
        db, skip, limit, agent_id, status_filter, search
    )


@router.get(
    "/payments/{payment_id}",
    summary="Get Commission Payment Details",
    description="Get payment with items and commission details",
    dependencies=[Depends(require_permission(*Permissions.COMMISSION_PAYMENT_VIEW))],
)
def get_payment_details(
    payment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.COMMISSION_PAYMENT_VIEW)),
):
    return commission_service.get_payment_with_items(db, payment_id)


@router.post(
    "/payments/",
    status_code=status.HTTP_201_CREATED,
    summary="Create Commission Payment",
    description="Create a new commission payment with items",
    dependencies=[Depends(require_permission(*Permissions.COMMISSION_PAYMENT_CREATE))],
)
def create_payment(
    data: schemas.CustomerAgentCommissionPaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.COMMISSION_PAYMENT_CREATE)),
):
    return commission_service.create_payment(db, data, current_user.id)


@router.post(
    "/payments/{payment_id}/verify",
    summary="Verify Commission Payment",
    description="Verify a pending commission payment",
    dependencies=[Depends(require_permission(*Permissions.COMMISSION_PAYMENT_APPROVAL_APPROVE))],
)
def verify_payment(
    payment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.COMMISSION_PAYMENT_APPROVAL_APPROVE)),
):
    return commission_service.verify_payment(db, payment_id, current_user.id)


@router.post(
    "/payments/{payment_id}/cancel",
    summary="Cancel Commission Payment",
    description="Cancel a pending commission payment",
    dependencies=[Depends(require_permission(*Permissions.COMMISSION_PAYMENT_UPDATE))],
)
def cancel_payment(
    payment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.COMMISSION_PAYMENT_UPDATE)),
):
    return commission_service.cancel_payment(db, payment_id)


# =============================================================================
# Report Endpoints (Scenario 19)
# =============================================================================

@router.get(
    "/reports/pending",
    response_model=List[schemas.CustomerAgentCommissionWithDetails],
    summary="Pending Commissions Report",
    description="Get all approved commissions that have not been fully paid",
    dependencies=[Depends(require_permission(*Permissions.AGENT_COMMISSION_VIEW))],
)
def get_pending_commissions_report(
    agent_id: Optional[int] = Query(None, description="Filter by agent ID"),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.AGENT_COMMISSION_VIEW)),
):
    return commission_service.get_pending_commissions_report(db, agent_id, date_from, date_to)


@router.get(
    "/reports/agent-summary",
    response_model=List[schemas.AgentCommissionSummary],
    summary="Agent Commission Summary Report",
    description="Get commission summary by agent with optional date range",
    dependencies=[Depends(require_permission(*Permissions.AGENT_COMMISSION_VIEW))],
)
def get_agent_summary_report(
    agent_id: Optional[int] = Query(None, description="Filter by specific agent"),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.AGENT_COMMISSION_VIEW)),
):
    return commission_service.get_agent_summary_report(db, agent_id, date_from, date_to)


@router.get(
    "/reports/payment-history",
    summary="Payment History Report",
    description="Get payment history with optional agent and date range filtering",
    dependencies=[Depends(require_permission(*Permissions.AGENT_COMMISSION_VIEW))],
)
def get_payment_history_report(
    agent_id: Optional[int] = Query(None, description="Filter by agent ID"),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.AGENT_COMMISSION_VIEW)),
):
    return commission_service.get_payment_history_report(db, agent_id, date_from, date_to, skip, limit)
