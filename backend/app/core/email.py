import smtplib
from email.message import EmailMessage
import urllib.request
import logging
from app.core.config import settings
from app.db.session import SessionLocal
from app.modules.communication.models import EmailLog
from app.core import timezone as tz

logger = logging.getLogger(__name__)

def send_document_email_task(
    email_log_id: int,
    auth_token: str
):
    """
    Background task to generate PDF, send email, and update EmailLog status.
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

        # 1. Fetch PDF from local API
        pdf_url = f"http://127.0.0.1:8000/api/v1/reporting/documents/{email_log.document_type}/{email_log.document_id}/pdf"
        
        req = urllib.request.Request(pdf_url)
        req.add_header("Authorization", f"Bearer {auth_token}")
        
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                pdf_bytes = response.read()
        except urllib.error.URLError as e:
            error_details = str(e)
            if hasattr(e, 'read'):
                error_details += f" - {e.read().decode('utf-8')[:200]}"
            email_log.status = "failed"
            email_log.error_message = f"Failed to generate PDF: {error_details}"
            db.commit()
            return

        # 2. Prepare Email
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
        try:
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
            email_log.error_message = f"SMTP Error: {str(e)}"
            db.commit()

    except Exception as e:
        logger.exception("Unexpected error in send_document_email_task")
    finally:
        db.close()
