from datetime import datetime

def format_currency(amount: float, currency: str = "USD") -> str:
    return f"{currency} {amount:,.2f}"

def format_date(date: datetime, format: str = "%Y-%m-%d") -> str:
    return date.strftime(format)
