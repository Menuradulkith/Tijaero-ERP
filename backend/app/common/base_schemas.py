from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class TimestampSchema(BaseModel):
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

class AuditSchema(TimestampSchema):
    created_by: Optional[int] = None
    updated_by: Optional[int] = None
