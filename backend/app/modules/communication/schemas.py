import re
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, EmailStr, Field, StringConstraints, field_validator

DocumentType = Literal["quotation", "sales-order", "invoice", "sales-return", "purchase-order", "purchase-return"]
DocId = Annotated[int, Field(ge=1, le=2_147_483_647)]

# Tags the draft builder (api.get_email_draft) knows how to fill in.
KNOWN_TAGS = {"document_id", "customer_name", "supplier_name", "title", "name", "company_name", "company", "comapny_name"}


def check_template_text(v: str) -> str:
    """Only known {tags}, and braces must be balanced: an unknown tag would be
    sent to the customer as literal text."""
    for tag in re.findall(r"\{([^{}]*)\}", v):
        if tag not in KNOWN_TAGS:
            raise ValueError(f"Unknown tag {{{tag}}}. Allowed: " + ", ".join("{" + t + "}" for t in sorted(KNOWN_TAGS - {"comapny_name"})))
    if re.search(r"[{}]", re.sub(r"\{[^{}]*\}", "", v)):
        raise ValueError("Unbalanced { } in template")
    return v

class EmailDraftResponse(BaseModel):
    to_email: str
    cc_email: Optional[str] = None
    subject: str
    body: str
    display_id: str

class EmailSendRequest(BaseModel):
    document_type: DocumentType
    document_id: DocId
    display_id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    to_email: EmailStr
    cc_email: Optional[EmailStr] = None
    subject: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50000)]

    @field_validator("to_email", "cc_email")
    @classmethod
    def _email_len(cls, v):
        if v and len(str(v)) > 255:
            raise ValueError("Email address is too long")
        return v

class EmailTemplateResponse(BaseModel):
    id: int
    document_type: str
    subject_template: str
    body_template: str

    class Config:
        from_attributes = True

class EmailTemplateUpdate(BaseModel):
    subject_template: Optional[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]] = None
    body_template: Optional[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20000)]] = None

    @field_validator("subject_template", "body_template")
    @classmethod
    def _tags_ok(cls, v):
        return check_template_text(v) if v is not None else v

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
