from datetime import datetime, timedelta

def get_fiscal_year(date: datetime = None) -> int:
    if date is None:
        date = datetime.now()
    return date.year if date.month >= 4 else date.year - 1

def add_business_days(start_date: datetime, days: int) -> datetime:
    current = start_date
    while days > 0:
        current += timedelta(days=1)
        if current.weekday() < 5:
            days -= 1
    return current
