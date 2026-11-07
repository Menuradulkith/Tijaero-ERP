import smtplib
from email.message import EmailMessage
import logging
from app.core.config import settings
from app.db.session import SessionLocal
from app.modules.communication.models import EmailLog
from app.core import timezone as tz

logger = logging.getLogger(__name__)

# Email document type -> print document type (app/reporting/print_templates.DOCUMENT_TYPES).
# A sales order prints as its invoice and a sales return as its credit note.
PRINT_DOCUMENT_TYPE = {
    "quotation": "quotation",
    "sales-order": "invoice",
    "invoice": "invoice",
    "sales-return": "credit-note",
    "purchase-order": "purchase-order",
    "purchase-return": "purchase-return",
}


def send_plain_email(bcc: list, subject: str, body: str) -> None:
    """Send one plain-text message, hiding recipients from each other.

    No-ops when SMTP is not configured. Runs on a daemon thread so a slow
    mail server cannot hold the request that created the notification.
    """
    import threading

    if not settings.SMTP_HOST or not settings.SMTP_FROM_EMAIL or not bcc:
        return

    def _send() -> None:
        try:
            msg = EmailMessage()
            msg["From"] = settings.SMTP_FROM_EMAIL
            msg["To"] = settings.SMTP_FROM_EMAIL
            msg["Bcc"] = ", ".join(bcc)
            msg["Subject"] = subject
            msg.set_content(body)
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=30) as server:
                server.starttls()
                if settings.SMTP_USER and settings.SMTP_PASSWORD:
                    server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.send_message(msg)
        except Exception:
            logger.exception("Plain notification email failed")

    threading.Thread(target=_send, name="notification-email", daemon=True).start()


def render_document_pdf(db, email_document_type: str, document_id: int) -> bytes:
    """The document's PDF, rendered in-process exactly like GET /reporting/documents/{type}/{id}/pdf
    (the sender's permission and branch access are checked when the email is queued)."""
    from app.reporting import print_templates
    from app.reporting.document_reports import get_document_report_service

    doc = print_templates.DOCUMENT_TYPES[PRINT_DOCUMENT_TYPE[email_document_type]]
    service = get_document_report_service(db)
    html = getattr(service, doc.method)(document_id)
    return print_templates.html_to_pdf(html, doc, service.last_render)


def send_document_email_task(email_log_id: int, auth_token: str = ""):
    """
    Background task to generate PDF, send email, and update EmailLog status.
    ``auth_token`` is no longer used (the PDF is rendered in-process); kept for callers.
    """
    db = SessionLocal()
    try:
        email_log = db.query(EmailLog).filter(EmailLog.id == email_log_id).first()
        if not email_log:
            logger.error(f"EmailLog {email_log_id} not found.")
            return

        if not settings.ENABLE_EMAIL_SERVICE:
            email_log.status = "failed"
            email_log.error_message = "Email service is disabled in settings."
            db.commit()
            return

        # 1. Render the PDF
        try:
            pdf_bytes = render_document_pdf(db, email_log.document_type, email_log.document_id)
        except Exception as e:
            db.rollback()
            logger.warning("Email %s: PDF generation failed", email_log_id, exc_info=True)
            email_log.status = "failed"
            email_log.error_message = f"Failed to generate PDF: {getattr(e, 'detail', None) or e}"[:1000]
            db.commit()
            return

        try:
            # 2. Prepare Email (header values with CR/LF are refused here, so mark the log failed
            # instead of leaving it "pending" forever)
            msg = EmailMessage()
            msg['Subject'] = email_log.subject
            msg['From'] = settings.SMTP_FROM_EMAIL
            msg['To'] = email_log.to_email
            if email_log.cc_email:
                msg['Cc'] = email_log.cc_email

            msg.set_content(email_log.body)

            # Attach PDF
            display_id_safe = email_log.display_id if email_log.display_id else str(email_log.document_id)
            filename = f"{email_log.document_type}-{display_id_safe}.pdf"
            msg.add_attachment(
                pdf_bytes,
                maintype='application',
                subtype='pdf',
                filename=filename
            )

            # 3. Send Email
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=30) as server:
                server.starttls()
                if settings.SMTP_USER and settings.SMTP_PASSWORD:
                    server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.send_message(msg)

            # 4. Update Success
            email_log.status = "sent"
            email_log.sent_at = tz.now()
            db.commit()

        except Exception as e:
            email_log.status = "failed"
            email_log.error_message = f"Send error: {str(e)}"[:1000]
            db.commit()

    except Exception:
        logger.exception("Unexpected error in send_document_email_task")
    finally:
        db.close()
