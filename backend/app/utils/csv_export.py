"""
Reusable CSV export utility for all ERP modules.

Usage:
    from app.utils.csv_export import build_csv_response

    @router.get("/export-csv")
    def export(db: Session = Depends(get_db)):
        rows = db.query(Model).all()
        return build_csv_response(
            filename="expenses",
            headers=["ID", "Amount", "Date"],
            rows=[[r.id, r.amount, r.date] for r in rows],
        )
"""
import csv
import io
from datetime import date, datetime
from decimal import Decimal
from typing import Any, List, Sequence

from fastapi.responses import StreamingResponse


def _format_cell(value: Any) -> str:
    """Format a cell value for CSV output."""
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, Decimal):
        return str(value)
    return str(value)


def build_csv_response(
    filename: str,
    headers: List[str],
    rows: Sequence[Sequence[Any]],
) -> StreamingResponse:
    """
    Build a StreamingResponse containing a CSV file.

    Args:
        filename: File name without extension (e.g. "expenses")
        headers: Column header labels
        rows: List of row data (each row is a list/tuple of cell values)
    """
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)
    for row in rows:
        writer.writerow([_format_cell(c) for c in row])
    output.seek(0)

    today_str = date.today().strftime("%Y-%m-%d")
    response = StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
    )
    response.headers["Content-Disposition"] = (
        f'attachment; filename="{filename}_{today_str}.csv"'
    )
    return response
