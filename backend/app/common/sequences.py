from sqlalchemy.orm import Session
from datetime import datetime

class SequenceGenerator:
    def generate(self, db: Session, prefix: str, entity_type: str) -> str:
        year = datetime.now().year
        return f"{prefix}-{year}-{entity_type}-{datetime.now().timestamp():.0f}"

sequence_generator = SequenceGenerator()
