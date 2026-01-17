from sqlalchemy.orm import Session

def get_balance_sheet(db: Session):

    return {"assets": 0, "liabilities": 0, "equity": 0}
