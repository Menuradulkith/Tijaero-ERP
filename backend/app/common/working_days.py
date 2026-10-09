"""Working-day arithmetic for delivery estimates.

A working day is Monday-Friday. There is no holiday calendar in the system,
so public holidays count as working days.
"""
from datetime import date, timedelta


def add_working_days(start: date, days: int) -> date:
    """`start` moved forward by `days` working days (a weekend `start` counts as the next weekday)."""
    current = start
    remaining = max(int(days), 0)
    while remaining > 0:
        current += timedelta(days=1)
        if current.weekday() < 5:
            remaining -= 1
    return current
