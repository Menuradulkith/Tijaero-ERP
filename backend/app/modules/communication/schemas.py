from pydantic import BaseModel, EmailStr
from typing import Optional

class EmailDraftResponse(BaseModel):
    to_email: str
    cc_email: Optional[str] = None
    subject: str
    body: str
    display_id: str

class EmailSendRequest(BaseModel):
    document_type: str
    document_id: int
    display_id: str
    to_email: EmailStr
    cc_email: Optional[EmailStr] = None
    subject: str
    body: str

class EmailTemplateResponse(BaseModel):
    id: int
    document_type: str
    subject_template: str
    body_template: str

    class Config:
        from_attributes = True

class EmailTemplateUpdate(BaseModel):
    subject_template: Optional[str] = None
    body_template: Optional[str] = None

class EmailLogResponse(BaseModel):
    id: int
    document_type: str
    document_id: int
    display_id: Optional[str] = None
    to_email: str
    cc_email: Optional[str] = None
    subject: str
    status: str
    error_message: Optional[str] = None
    sent_at: Optional[str] = None
    created_date: str
    sender_name: Optional[str] = None

    class Config:
        from_attributes = True
