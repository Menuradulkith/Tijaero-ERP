from sqlalchemy.orm import Session
from datetime import datetime
from app.core import timezone as tz

class SequenceGenerator:
    def generate(self, db: Session, prefix: str, entity_type: str) -> str:
        year = tz.year()
        return f"{prefix}-{year}-{entity_type}-{tz.now().timestamp():.0f}"

sequence_generator = SequenceGenerator()
