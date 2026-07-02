from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Header
from sqlalchemy.orm import Session
from app.api.deps import get_db, get_current_active_user
from app.auth.models import User
from app.modules.communication.schemas import EmailDraftResponse, EmailSendRequest
from app.modules.communication.models import EmailTemplate, EmailLog
from app.core.email import send_document_email_task
from app.modules.customers.models import Customer
from app.modules.purchasing.models import Supplier, PurchasingOrder, PurchasingReturn
from app.modules.sales.models import Invoice, SaleReturn
from app.modules.sales.quotation_models import SalesQuote
from app.modules.communication.schemas import (
    EmailDraftResponse, EmailSendRequest, EmailTemplateUpdate, 
    EmailTemplateResponse, EmailLogResponse
)
from app.modules.communication.models import EmailTemplate, EmailLog

router = APIRouter()

@router.get("/email/logs", response_model=list[EmailLogResponse])
def get_email_logs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    logs = db.query(EmailLog).order_by(EmailLog.id.desc()).limit(100).all()
    # Serialize datetime to string
    response_logs = []
    for log in logs:
        response_logs.append({
            "id": log.id,
            "document_type": log.document_type,
            "document_id": log.document_id,
            "to_email": log.to_email,
            "cc_email": log.cc_email,
            "subject": log.subject,
            "status": log.status,
            "error_message": log.error_message,
            "sent_at": log.sent_at.isoformat() if log.sent_at else None,
            "created_date": log.created_date.isoformat() if log.created_date else ""
        })
    return response_logs

@router.get("/email/templates", response_model=list[EmailTemplateResponse])
def get_email_templates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    templates = db.query(EmailTemplate).all()
    # Initialize default templates if they don't exist
    default_docs = ["quotation", "proforma", "sales-order", "sales-return", "invoice", "purchase-order", "purchase-return"]
    existing_docs = {t.document_type for t in templates}
    
    for doc in default_docs:
        if doc not in existing_docs:
            new_template = EmailTemplate(
                document_type=doc,
                subject_template=f"{doc.replace('-', ' ').title()} #{{document_id}}",
                body_template=f"Please find attached the {doc.replace('-', ' ').title()} #{{document_id}}.\n\nThank you,\n{{company_name}}"
            )
            db.add(new_template)
    
    if len(existing_docs) < len(default_docs):
        db.commit()
        templates = db.query(EmailTemplate).all()

    return templates

@router.put("/email/templates/{template_id}", response_model=EmailTemplateResponse)
def update_email_template(
    template_id: int,
    request: EmailTemplateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    template = db.query(EmailTemplate).filter(EmailTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    
    if request.subject_template is not None:
        template.subject_template = request.subject_template
    if request.body_template is not None:
        template.body_template = request.body_template
        
    db.commit()
    db.refresh(template)
    return template

@router.get("/email-draft/{document_type}/{document_id}", response_model=EmailDraftResponse)
def get_email_draft(
    document_type: str,
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    to_email = ""
    cc_email = ""
    customer_name = ""
    supplier_name = ""

    # Look up email based on document type
    if document_type in ["quotation", "proforma"]:
        doc = db.query(SalesQuote).filter(SalesQuote.id == document_id).first()
        if doc and doc.customer:
            to_email = doc.customer.email
            customer_name = doc.customer.customer_name
    elif document_type in ["invoice", "sales-order"]:
        doc = db.query(Invoice).filter(Invoice.id == document_id).first()
        if doc and doc.customer:
            to_email = doc.customer.email
            customer_name = doc.customer.customer_name
    elif document_type == "sales-return":
        doc = db.query(SaleReturn).filter(SaleReturn.id == document_id).first()
        if doc and doc.customer:
            to_email = doc.customer.email
            customer_name = doc.customer.customer_name
    elif document_type == "purchase-order":
        doc = db.query(PurchasingOrder).filter(PurchasingOrder.id == document_id).first()
        if doc and doc.supplier:
            to_email = doc.supplier.email
            supplier_name = doc.supplier.supplier_name
    elif document_type == "purchase-return":
        doc = db.query(PurchasingReturn).filter(PurchasingReturn.id == document_id).first()
        if doc and doc.supplier:
            to_email = doc.supplier.email
            supplier_name = doc.supplier.supplier_name

    # Check for template in DB
    template = db.query(EmailTemplate).filter(EmailTemplate.document_type == document_type).first()
    
    if template:
        subject = template.subject_template
        body = template.body_template
    else:
        # Fallback templates
        subject = f"{document_type.replace('-', ' ').title()} #{document_id}"
        body = f"Please find attached the {document_type.replace('-', ' ').title()} #{document_id}."

    # Dynamic Replacements
    subject = subject.replace("{document_id}", str(document_id))
    body = body.replace("{document_id}", str(document_id))
    if customer_name:
        body = body.replace("{customer_name}", customer_name)
    if supplier_name:
        body = body.replace("{supplier_name}", supplier_name)

    # Disclaimer
    disclaimer = "\n\n---\nThis email is computer generated. Please do not reply directly to this email."
    if "This email is computer generated" not in body:
        body += disclaimer

    return EmailDraftResponse(
        to_email=to_email or "",
        cc_email=cc_email or None,
        subject=subject,
        body=body
    )

@router.post("/email/send")
def send_email(
    request: EmailSendRequest,
    background_tasks: BackgroundTasks,
    authorization: str = Header(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    # Extract token
    token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
    
    # 1. Create Log
    email_log = EmailLog(
        document_type=request.document_type,
        document_id=request.document_id,
        to_email=request.to_email,
        cc_email=request.cc_email,
        subject=request.subject,
        body=request.body,
        status="pending"
    )
    db.add(email_log)
    db.commit()
    db.refresh(email_log)

    # 2. Queue Background Task
    background_tasks.add_task(send_document_email_task, email_log.id, token)

    return {"status": "success", "message": "Email queued for sending."}
