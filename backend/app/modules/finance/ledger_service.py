from sqlalchemy.orm import Session

class LedgerService:
    def post_entry(self, db: Session, entry_id: int):
        pass

ledger_service = LedgerService()
