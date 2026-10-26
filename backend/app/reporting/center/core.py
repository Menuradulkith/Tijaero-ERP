"""Report Center core: report definitions, parameters and results.

A report is defined once in code (`ReportDef`) with its parameters, the permission it
needs and a `run` function that returns a `ReportResult`: headline metrics plus one or
more tables. The API, the Report Center page and every export format (CSV, Excel, PDF)
all work from that one result, so a report is written once and shows up everywhere.

Reports compute their figures in code; users only choose parameters and how the
result is shown (columns, sort), which is what a saved report stores.
"""

from __future__ import annotations

import calendar
import enum
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, localcontext
from typing import Any, Callable, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.rbac import user_has_permission
from app.core import timezone as tz

# Money columns are Numeric(60, 2); sums of them need more than Decimal's default 28 digits.
DECIMAL_PRECISION = 80
INT4_MAX = 2_147_483_647

# Rows above this are cut off (the result says so) to keep the page and exports responsive.
MAX_ROWS = 20_000

COLUMN_TYPES = ("text", "int", "number", "money", "percent", "date", "datetime", "bool")
PARAM_TYPES = ("date", "int", "year", "text", "select", "bool", "branch", "customer", "supplier", "product", "account")
# Filters picked from a searchable list (GET /reporting/center/lookup/{kind}).
LOOKUP_TYPES = ("customer", "supplier", "product", "account")


# --------------------------------------------------------------------------- #
# Definitions
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Param:
    key: str
    label: str
    type: str = "text"
    required: bool = False
    # A value, or one of: "today", "month_start", "year_start", "current_year", "last_month_start", "last_month_end".
    default: Any = None
    options: tuple[tuple[str, str], ...] = ()  # (value, label) for "select"
    min: Optional[int] = None
    max: Optional[int] = None
    help: Optional[str] = None


@dataclass(frozen=True)
class ReportDef:
    key: str
    title: str
    module: str
    description: str
    permission: tuple[str, str]
    run: Callable[["RunContext", dict], "ReportResult"]
    params: tuple[Param, ...] = ()
    # Data for the whole company regardless of the user's branches (no branch parameter).
    company_wide: bool = False
    tags: tuple[str, ...] = ()


@dataclass
class Column:
    key: str
    label: str
    type: str = "text"
    total: bool = False


@dataclass
class Table:
    key: str
    title: str
    columns: list[Column]
    rows: list[dict]
    totals: Optional[dict] = None
    truncated: bool = False


@dataclass
class Metric:
    label: str
    value: Any
    type: str = "number"


@dataclass
class ReportResult:
    metrics: list[Metric] = field(default_factory=list)
    tables: list[Table] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


REGISTRY: dict[str, ReportDef] = {}


def register(report: ReportDef) -> ReportDef:
    if report.key in REGISTRY:
        raise ValueError(f"Report '{report.key}' is registered twice")
    for p in report.params:
        if p.type not in PARAM_TYPES:
            raise ValueError(f"{report.key}: unknown parameter type {p.type!r}")
    REGISTRY[report.key] = report
    return report


def get_report(key: str) -> ReportDef:
    report = REGISTRY.get(key)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return report


def can_run(user: User, report: ReportDef) -> bool:
    return user_has_permission(user, *report.permission)


# --------------------------------------------------------------------------- #
# Running
# --------------------------------------------------------------------------- #
@dataclass
class RunContext:
    db: Session
    user: User

    @property
    def allowed_branches(self) -> Optional[list[str]]:
        """None = every branch (superuser); otherwise the user's branch codes."""
        if self.user.is_superuser:
            return None
        return [b.branch_code for b in self.user.branches]

    def branch_scope(self, branch_code: Optional[str]) -> tuple[Optional[str], Optional[list[str]]]:
        """(branch_code, branch_codes) for reports that can filter on several branches."""
        allowed = self.allowed_branches
        if allowed is None:
            return branch_code, None
        if branch_code:
            self._check_branch(branch_code)
            return branch_code, None
        if not allowed:
            raise HTTPException(status_code=403, detail="You are not assigned to any branch")
        return None, allowed

    def single_branch(self, branch_code: Optional[str]) -> Optional[str]:
        """The branch for reports that take one branch (or all of them).

        A branch-limited user cannot ask for "all branches"; with one branch it is used
        automatically, with several they must pick one."""
        allowed = self.allowed_branches
        if allowed is None:
            return branch_code
        if branch_code:
            self._check_branch(branch_code)
            return branch_code
        if len(allowed) == 1:
            return allowed[0]
        raise HTTPException(status_code=422, detail="Pick a branch for this report")

    def _check_branch(self, branch_code: str) -> None:
        allowed = self.allowed_branches
        if allowed is not None and branch_code not in allowed:
            raise HTTPException(status_code=403, detail=f"Access denied to branch: {branch_code}")


def _resolve_default(value: Any) -> Any:
    today = tz.today()
    if value == "today":
        return today
    if value == "month_start":
        return today.replace(day=1)
    if value == "year_start":
        return date(today.year, 1, 1)
    if value == "current_year":
        return today.year
    if value in ("last_month_start", "last_month_end"):
        y, m = (today.year, today.month - 1) if today.month > 1 else (today.year - 1, 12)
        return date(y, m, 1) if value == "last_month_start" else date(y, m, calendar.monthrange(y, m)[1])
    return value


def parse_params(report: ReportDef, raw: Optional[dict]) -> dict:
    """Validate and convert user-supplied parameters; unknown keys are ignored."""
    raw = raw or {}
    out: dict[str, Any] = {}
    for p in report.params:
        value = raw.get(p.key)
        if value in (None, ""):
            value = _resolve_default(p.default)
            if value is None:
                if p.required:
                    raise HTTPException(status_code=422, detail=f"'{p.label}' is required")
                out[p.key] = None
                continue
        try:
            out[p.key] = _convert(p, value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail=f"'{p.label}' is not a valid {p.type}")
    for p in report.params:
        if p.type == "date" and p.key.endswith("_to"):
            start = out.get(p.key[: -len("_to")] + "_from")
            if start and out.get(p.key) and start > out[p.key]:
                raise HTTPException(status_code=422, detail="The start date is after the end date")
    return out


def _convert(p: Param, value: Any) -> Any:
    if p.type == "date":
        return value if isinstance(value, date) else date.fromisoformat(str(value)[:10])
    if p.type in ("int", "year", "customer", "supplier", "product"):
        if isinstance(value, bool) or (isinstance(value, float) and not value.is_integer()):
            raise ValueError
        number = int(value)
        lo = p.min if p.min is not None else (2000 if p.type == "year" else None)
        hi = p.max if p.max is not None else (2100 if p.type == "year" else None)
        # Ids and counts go to integer (int4) columns: anything larger cannot match and
        # would make Postgres fail the query.
        if not -INT4_MAX - 1 <= number <= INT4_MAX:
            raise ValueError
        if (lo is not None and number < lo) or (hi is not None and number > hi) or (
            p.type in ("customer", "supplier", "product") and number < 1
        ):
            raise ValueError
        return number
    if p.type == "bool":
        if isinstance(value, bool):
            return value
        if str(value).lower() in ("true", "1", "yes"):
            return True
        if str(value).lower() in ("false", "0", "no"):
            return False
        raise ValueError
    if p.type == "select":
        if str(value) not in {v for v, _ in p.options}:
            raise ValueError
        return str(value)
    if p.type == "account":
        code = str(value).strip()
        if not code or len(code) > 20 or not code.replace("-", "").replace(".", "").isalnum():
            raise ValueError
        return code
    text = str(value).strip()
    if len(text) > 255:
        raise ValueError
    return text


def execute(ctx: RunContext, report: ReportDef, raw_params: Optional[dict]) -> tuple[dict, ReportResult]:
    if not can_run(ctx.user, report):
        raise HTTPException(
            status_code=403,
            detail=f"Permission denied. Required: {report.permission[0]}:{report.permission[1]}",
        )
    params = parse_params(report, raw_params)
    with localcontext() as dctx:
        dctx.prec = DECIMAL_PRECISION
        result = report.run(ctx, params)
    for table in result.tables:
        if len(table.rows) > MAX_ROWS:
            table.rows = table.rows[:MAX_ROWS]
            table.truncated = True
            result.notes.append(f"{table.title}: only the first {MAX_ROWS:,} rows are shown.")
    return params, result


# --------------------------------------------------------------------------- #
# Building results
# --------------------------------------------------------------------------- #
_MONEY_HINTS = (
    "amount", "total", "revenue", "price", "value", "balance", "paid", "outstanding",
    "salary", "payroll", "cost", "income", "expense", "debit", "credit", "sales", "net",
    "refund", "deposit", "payment", "due", "cash", "profit",
)


def _label(key: str) -> str:
    return key.replace("_", " ").replace(".", " · ").strip().capitalize()


def _infer_type(key: str, values: list[Any]) -> str:
    sample = next((v for v in values if v is not None), None)
    if isinstance(sample, bool):
        return "bool"
    if isinstance(sample, datetime):
        return "datetime"
    if isinstance(sample, date):
        return "date"
    if isinstance(sample, int):
        return "int"
    if isinstance(sample, (float, Decimal)):
        k = key.lower()
        if "percent" in k or k.endswith("_rate") or k.endswith("_pct"):
            return "percent"
        return "money" if any(h in k for h in _MONEY_HINTS) else "number"
    if isinstance(sample, str) and len(sample) >= 10 and sample[4:5] == "-" and sample[7:8] == "-" and sample[:4].isdigit():
        return "datetime" if len(sample) > 10 and sample[10:11] in ("T", " ") else "date"
    return "text"


def flatten(row: dict, prefix: str = "") -> dict:
    """Nested dicts become dotted keys (`sales.total`); lists are dropped."""
    out = {}
    for key, value in row.items():
        full = f"{prefix}{key}"
        if isinstance(value, dict):
            out.update(flatten(value, full + "."))
        elif not isinstance(value, (list, tuple, set)):
            out[full] = value
    return out


def to_plain(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return to_plain(value.model_dump())
    if isinstance(value, dict):
        return {k: to_plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_plain(v) for v in value]
    if isinstance(value, enum.Enum):
        return value.value
    return value


def table(
    key: str,
    title: str,
    rows: Any,
    columns: Optional[list[Column | tuple]] = None,
    *,
    exclude: tuple[str, ...] = ("id",),
    totals: bool = True,
) -> Table:
    """A table from row dicts (or models). Columns not given are inferred from the data;
    numeric money/number/int columns are totalled unless `totals=False`."""
    plain = [flatten(r) for r in to_plain(list(rows or []))]
    if columns is None:
        keys: list[str] = []
        for r in plain:
            for k in r:
                if k not in keys and k not in exclude:
                    keys.append(k)
        # Internal numeric ids (customer_id, employee_pk...) are noise; codes like EMP-001 stay.
        keys = [
            k for k in keys
            if not (k.endswith(("_id", "_pk")) and all(isinstance(r.get(k), (int, type(None))) for r in plain))
        ]
        cols = [Column(k, _label(k), _infer_type(k, [r.get(k) for r in plain])) for k in keys]
        for c in cols:
            c.total = totals and c.type in ("money",)
    else:
        cols = [c if isinstance(c, Column) else Column(*c) for c in columns]
    return Table(key, title, cols, [{c.key: r.get(c.key) for c in cols} for r in plain], None)


def metric(label: str, value: Any, type: str = "number") -> Metric:
    return Metric(label, to_plain(value), type)


def finalize_totals(t: Table) -> None:
    if not any(c.total for c in t.columns):
        return
    totals: dict[str, Any] = {}
    with localcontext() as dctx:
        dctx.prec = DECIMAL_PRECISION
        for c in t.columns:
            if c.total:
                totals[c.key] = sum(Decimal(str(r.get(c.key) or 0)) for r in t.rows)
    t.totals = totals


# --------------------------------------------------------------------------- #
# Serialising
# --------------------------------------------------------------------------- #
def json_value(value: Any, type_: str = "text") -> Any:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (int, float, bool, str)):
        return value
    return str(value)


def result_json(result: ReportResult) -> dict:
    tables = []
    for t in result.tables:
        finalize_totals(t)
        tables.append({
            "key": t.key,
            "title": t.title,
            "columns": [{"key": c.key, "label": c.label, "type": c.type, "total": c.total} for c in t.columns],
            "rows": [{k: json_value(v) for k, v in r.items()} for r in t.rows],
            "totals": {k: json_value(v) for k, v in t.totals.items()} if t.totals else None,
            "truncated": t.truncated,
        })
    return {
        "metrics": [{"label": m.label, "value": json_value(m.value), "type": m.type} for m in result.metrics],
        "tables": tables,
        "notes": result.notes,
    }


def param_json(p: Param) -> dict:
    return {
        "key": p.key,
        "label": p.label,
        "type": p.type,
        "required": p.required,
        "default": json_value(_resolve_default(p.default)),
        "options": [{"value": v, "label": label} for v, label in p.options],
        "min": p.min,
        "max": p.max,
        "help": p.help,
    }


def report_json(r: ReportDef) -> dict:
    return {
        "key": r.key,
        "title": r.title,
        "module": r.module,
        "description": r.description,
        "params": [param_json(p) for p in r.params],
        "company_wide": r.company_wide,
        "tags": list(r.tags),
    }
