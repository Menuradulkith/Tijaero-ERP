"""Report Center API: catalogue, run, export, saved reports and recent runs.

Every report needs its own permission (see app/reporting/center/definitions.py), and
branch-limited users only ever see their branches' data. Saved reports are private
unless shared (`saved_reports:share`); a shared one is visible to everyone who can run
the report and can be changed by its owner or by `saved_reports:manage`.
"""

import json
import logging
import time
from datetime import timedelta
from typing import Annotated, Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import literal, or_
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_active_user
from app.auth.models import Branch, User
from app.auth.rbac import Permissions, user_has_permission
from app.core import timezone as tz
from app.core.simple_rate_limit import rate_limit
from app.db.session import get_db
from app.modules.reporting.models import Report, ReportExecution
from app.reporting.center import REGISTRY, get_report
from app.reporting.center import exporters
from app.reporting.center.core import RunContext, can_run, execute, json_value, report_json, result_json

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/reporting/center", tags=["reporting"])

_limit_run = rate_limit(30, per_user=True)
_limit_export = rate_limit(10, per_user=True)

RowId = Path(..., ge=1, le=2_147_483_647)


class RunRequest(BaseModel):
    params: dict[str, Any] = Field(default_factory=dict)
    saved_report_id: Optional[int] = Field(None, ge=1, le=2_147_483_647)


class ExportRequest(RunRequest):
    format: Literal["csv", "xlsx", "pdf", "html"]
    view: Optional[dict[str, Any]] = None
    table: Optional[str] = Field(None, max_length=100)
    title: Optional[str] = Field(None, max_length=200)


# Trimmed before the length check, so a name of only spaces is rejected.
SavedName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class SavedReportIn(BaseModel):
    report_key: str = Field(..., max_length=50)
    name: SavedName
    description: Optional[str] = Field(None, max_length=1000)
    params: dict[str, Any] = Field(default_factory=dict)
    view: Optional[dict[str, Any]] = None
    is_shared: bool = False


class SavedReportUpdate(BaseModel):
    name: SavedName
    description: Optional[str] = Field(None, max_length=1000)
    params: dict[str, Any] = Field(default_factory=dict)
    view: Optional[dict[str, Any]] = None
    is_shared: bool = False


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _params_for_storage(params: dict) -> dict:
    return {k: json_value(v) for k, v in params.items()}


def _log_run(db: Session, user: User, key: str, params: dict, started: float, *,
             saved_id: Optional[int] = None, summary: Optional[str] = None, error: Optional[str] = None) -> None:
    """Record a run (best effort: a logging failure never breaks the report)."""
    try:
        if error:
            db.rollback()  # the failed report may have left the transaction unusable
        db.add(ReportExecution(
            report_id=saved_id,
            report_key=key,
            executed_by=user.id,
            execution_date=tz.now(),
            status="error" if error else "success",
            parameters=json.dumps(_params_for_storage(params), default=str),
            result_summary=summary,
            execution_time=int((time.monotonic() - started) * 1000),
            error_message=error,
            created_by=user.id,
        ))
        if saved_id:
            db.query(Report).filter(Report.id == saved_id).update({"last_run": tz.now()})
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("Could not log Report Center run of %s", key)


def _run(db: Session, user: User, key: str, body: RunRequest):
    report = get_report(key)
    saved_id = None
    if body.saved_report_id:
        saved = _visible_saved(db, user, body.saved_report_id)
        if saved.report_type != key:
            raise HTTPException(status_code=422, detail="That saved report belongs to another report")
        saved_id = saved.id
    started = time.monotonic()
    try:
        params, result = execute(RunContext(db, user), report, body.params)
    except HTTPException as exc:
        if exc.status_code >= 500:
            _log_run(db, user, key, body.params, started, saved_id=saved_id, error=str(exc.detail))
        raise
    except Exception as exc:
        logger.exception("Report %s failed", key)
        _log_run(db, user, key, body.params, started, saved_id=saved_id, error=f"{type(exc).__name__}: {exc}"[:2000])
        raise HTTPException(status_code=500, detail="The report could not be generated") from exc
    rows = sum(len(t.rows) for t in result.tables)
    _log_run(db, user, key, params, started, saved_id=saved_id, summary=f"{rows} rows")
    return report, params, result


def _saved_json(r: Report, user: User) -> dict:
    stored = {}
    try:
        stored = json.loads(r.parameters or "{}")
    except ValueError:
        pass
    return {
        "id": r.id,
        "report_key": r.report_type,
        "name": r.name,
        "description": r.description,
        "params": stored.get("params") or {},
        "view": stored.get("view"),
        "is_shared": bool(r.is_shared),
        "is_mine": r.created_by == user.id,
        "can_edit": _can_edit(r, user),
        "created_by": r.created_by,
        "last_run": json_value(r.last_run),
        "updated_at": json_value(r.updated_at),
    }


def _can_edit(r: Report, user: User) -> bool:
    return r.created_by == user.id or (bool(r.is_shared) and user_has_permission(user, *Permissions.SAVED_REPORT_MANAGE))


def _saved_query(db: Session, user: User):
    return db.query(Report).filter(
        Report.is_template.is_(True),
        Report.report_type.in_([k for k, r in REGISTRY.items() if can_run(user, r)]),
        or_(Report.created_by == user.id, Report.is_shared.is_(True)),
    )


def _visible_saved(db: Session, user: User, saved_id: int) -> Report:
    row = _saved_query(db, user).filter(Report.id == saved_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Saved report not found")
    return row


def _check_share(user: User, is_shared: bool) -> None:
    if is_shared and not user_has_permission(user, *Permissions.SAVED_REPORT_SHARE):
        raise HTTPException(status_code=403, detail="Permission denied. Required: saved_reports:share")


def _validated_storage(user: User, db: Session, key: str, params: dict, view: Optional[dict]) -> str:
    report = get_report(key)
    if not can_run(user, report):
        raise HTTPException(status_code=403, detail="You cannot run this report")
    from app.reporting.center.core import parse_params

    # Validate now so a saved report cannot hold values that would fail later; keep
    # only the keys the user actually set (defaults like "today" stay relative).
    parse_params(report, params)
    known = {p.key for p in report.params}
    kept = {k: v for k, v in params.items() if k in known and v not in (None, "")}
    payload = json.dumps({"params": kept, "view": view or {}}, default=str)
    if len(payload) > 20_000:
        raise HTTPException(status_code=422, detail="The saved view is too large")
    return payload


# --------------------------------------------------------------------------- #
# Catalogue
# --------------------------------------------------------------------------- #
@router.get("/catalog")
def catalog(user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    """Reports this user can run, and the saved reports they can see."""
    reports = [report_json(r) for r in REGISTRY.values() if can_run(user, r)]
    saved = [_saved_json(r, user) for r in _saved_query(db, user).order_by(Report.name).all()]
    return {
        "reports": reports,
        "saved": saved,
        "can_share": user_has_permission(user, *Permissions.SAVED_REPORT_SHARE),
    }


@router.get("/recent")
def recent_runs(user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    """This user's latest runs (one per report), newest first."""
    rows = (
        db.query(ReportExecution)
        .filter(
            ReportExecution.executed_by == user.id,
            ReportExecution.report_key.isnot(None),
            ReportExecution.status == "success",
            ReportExecution.execution_date >= tz.now() - timedelta(days=90),
        )
        .order_by(ReportExecution.execution_date.desc())
        .limit(200)
        .all()
    )
    seen, out = set(), []
    for r in rows:
        report = REGISTRY.get(r.report_key)
        if r.report_key in seen or report is None or not can_run(user, report):
            continue
        seen.add(r.report_key)
        try:
            params = json.loads(r.parameters or "{}")
        except ValueError:
            params = {}
        out.append({"report_key": r.report_key, "title": report.title, "params": params,
                    "run_at": json_value(r.execution_date), "saved_report_id": r.report_id})
        if len(out) == 10:
            break
    return out


@router.get("/branches")
def branch_options(user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    """Branches the user may pick in a report's branch filter."""
    q = db.query(Branch).filter(Branch.active.is_(True))
    if not user.is_superuser:
        q = q.filter(Branch.branch_code.in_([b.branch_code for b in user.branches]))
    return [{"value": b.branch_code, "label": b.branch_name or b.branch_code} for b in q.order_by(Branch.branch_name).all()]


@router.get("/lookup/{kind}")
def lookup(
    kind: Literal["customer", "supplier", "product", "account"],
    q: str = Query("", max_length=100),
    ids: Optional[str] = Query(None, max_length=200, description="Comma-separated ids to resolve"),
    user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Picker for customer / supplier / product / account filters; open to users who can run a report with that filter."""
    if not any(can_run(user, r) and any(p.type == kind for p in r.params) for r in REGISTRY.values()):
        raise HTTPException(status_code=403, detail="No report you can run filters by this")
    like = "%" + q.strip().replace("%", r"\%").replace("_", r"\_") + "%"
    if kind == "account":
        from app.modules.finance.accounting_models import ChartOfAccounts as A

        query = db.query(A.account_code, A.account_name).filter(A.is_active.is_(True))
        if ids:
            query = query.filter(A.account_code.in_([x.strip() for x in ids.split(",")][:20]))
        elif q.strip():
            query = query.filter(or_(A.account_code.ilike(like, escape="\\"), A.account_name.ilike(like, escape="\\")))
        return [{"value": c, "label": f"{c} · {n}"} for c, n in query.order_by(A.account_code).limit(30).all()]
    if kind == "product":
        from app.modules.products.models import Product as M

        name, code = M.name, M.item_code
    elif kind == "customer":
        from app.modules.customers.models import Customer as M

        name, code = M.customer_name, None
    else:
        from app.modules.purchasing.models import Supplier as M

        name, code = M.company_name, None
    query = db.query(M.id, name, code) if code is not None else db.query(M.id, name, literal(None))
    if ids:
        wanted = [int(x) for x in ids.split(",") if x.strip().isdigit() and int(x) <= 2_147_483_647][:20]
        query = query.filter(M.id.in_(wanted))
    elif q.strip():
        query = query.filter(or_(name.ilike(like, escape="\\"), *( [code.ilike(like, escape="\\")] if code is not None else [])))
    return [
        {"value": i, "label": f"{c} · {n}" if c else (n or f"#{i}")}
        for i, n, c in query.order_by(name).limit(20).all()
    ]


# --------------------------------------------------------------------------- #
# Run / export
# --------------------------------------------------------------------------- #
@router.post("/reports/{key}/run")
def run_report(
    key: str,
    body: RunRequest,
    user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    _rl: None = Depends(_limit_run),
):
    report, params, result = _run(db, user, key, body)
    return {"report": report_json(report), "params": _params_for_storage(params), **result_json(result)}


@router.post("/reports/{key}/export")
def export_report(
    key: str,
    body: ExportRequest,
    user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    _rl: None = Depends(_limit_export),
):
    report, params, result = _run(db, user, key, body)
    result = exporters.apply_view(result, body.view)
    title = body.title or report.title
    stem = f"{key.replace('.', '-')}-{tz.today():%Y%m%d}"
    if body.format == "csv":
        return Response(exporters.to_csv(result, body.table), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="{stem}.csv"'})
    if body.format == "xlsx":
        return Response(
            exporters.to_xlsx(report, params, result, title),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{stem}.xlsx"'},
        )
    from app.reporting.documents import company_profile

    html, landscape = exporters.to_html(report, params, result, company_profile(db), title)
    if body.format == "html":
        return Response(html, media_type="text/html; charset=utf-8", headers={
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
            "Cache-Control": "no-store",
        })
    return Response(exporters.to_pdf(html, landscape), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{stem}.pdf"'})


# --------------------------------------------------------------------------- #
# Saved reports
# --------------------------------------------------------------------------- #
@router.post("/saved", status_code=201)
def create_saved(body: SavedReportIn, user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    _check_share(user, body.is_shared)
    payload = _validated_storage(user, db, body.report_key, body.params, body.view)
    report = get_report(body.report_key)
    row = Report(
        name=body.name,
        description=body.description,
        report_type=body.report_key,
        category=report.module,
        parameters=payload,
        created_by=user.id,
        updated_by=user.id,
        created_date=tz.now(),
        is_template=True,
        is_scheduled=False,
        is_shared=body.is_shared,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _saved_json(row, user)


@router.put("/saved/{saved_id}")
def update_saved(
    body: SavedReportUpdate,
    saved_id: int = RowId,
    user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    row = _visible_saved(db, user, saved_id)
    if not _can_edit(row, user):
        raise HTTPException(status_code=403, detail="Only the owner can change this saved report")
    if body.is_shared != bool(row.is_shared):
        _check_share(user, True)
    row.parameters = _validated_storage(user, db, row.report_type, body.params, body.view)
    row.name = body.name
    row.description = body.description
    row.is_shared = body.is_shared
    row.updated_by = user.id
    db.commit()
    db.refresh(row)
    return _saved_json(row, user)


@router.delete("/saved/{saved_id}", status_code=204)
def delete_saved(saved_id: int = RowId, user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    row = _visible_saved(db, user, saved_id)
    if not _can_edit(row, user):
        raise HTTPException(status_code=403, detail="Only the owner can delete this saved report")
    db.delete(row)
    db.commit()
