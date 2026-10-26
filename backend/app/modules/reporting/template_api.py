"""Admin API for document print templates (Settings → Print Templates).

Layout changes need `print_templates:update`; writing or changing custom HTML also
needs `print_templates:edit_html`. Branch templates can only be changed by users
assigned to that branch. Every save is snapshotted so it can be restored.
"""

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import HTMLResponse
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_active_user, validate_branch_access
from app.auth.models import Branch, User
from app.auth.rbac import Permissions, require_permission, user_has_permission
from app.core import timezone as tz
from app.db.session import get_db
from app.modules.reporting import schemas
from app.modules.reporting.models import DocumentTemplate, DocumentTemplateVersion
from app.reporting import print_templates
from app.reporting.print_templates import DOCUMENT_TYPES

router = APIRouter(prefix="/reporting/print-templates", tags=["reporting"])

RowId = Annotated[int, Path(ge=1, le=2_147_483_647)]

_SNAPSHOT_FIELDS = ("name", "paper_size", "orientation", "settings", "custom_html", "is_active")


def _doc_type(key: str):
    doc = DOCUMENT_TYPES.get(key)
    if doc is None:
        raise HTTPException(status_code=422, detail=f"Unknown document type '{key}'")
    return doc


def _get(db: Session, template_id: int) -> DocumentTemplate:
    tmpl = db.query(DocumentTemplate).filter(DocumentTemplate.id == template_id).first()
    if tmpl is None:
        raise HTTPException(status_code=404, detail="Print template not found")
    return tmpl


def _check_branch(db: Session, user: User, branch_code: Optional[str]) -> None:
    if branch_code is None:
        return
    if not db.query(Branch.id).filter(Branch.branch_code == branch_code).first():
        raise HTTPException(status_code=422, detail=f"Branch '{branch_code}' does not exist")
    if not validate_branch_access(user, branch_code):
        raise HTTPException(status_code=403, detail="You do not have access to this branch")


def _check_layout(doc, settings: schemas.PrintLayoutSettings) -> None:
    allowed = {print_templates.STANDARD_LAYOUT} | {k for k, _l, _f in doc.layouts}
    if settings.layout_style not in allowed:
        raise HTTPException(status_code=422, detail=f"Layout '{settings.layout_style}' is not available for {doc.label}")


def _check_custom_html(
    user: User, document_type: str, new_html: Optional[str], old_html: Optional[str]
) -> Optional[str]:
    """Validate a template's custom HTML; returns the value to store ('' counts as none)."""
    new_html = new_html or None
    if new_html != (old_html or None) and not user_has_permission(user, *Permissions.PRINT_TEMPLATE_EDIT_HTML):
        raise HTTPException(
            status_code=403,
            detail="Permission denied. Required: print_templates:edit_html",
        )
    if new_html:
        problems = print_templates.validate_custom_html(document_type, new_html)
        if problems:
            raise HTTPException(status_code=422, detail=problems[0])
    return new_html


def _snapshot(tmpl: DocumentTemplate, user: User) -> DocumentTemplateVersion:
    return DocumentTemplateVersion(
        template_id=tmpl.id,
        version=tmpl.version,
        snapshot={f: getattr(tmpl, f) for f in _SNAPSHOT_FIELDS},
        created_by=user.id,
        created_at=tz.now(),
    )


def _clear_other_defaults(db: Session, tmpl: DocumentTemplate) -> None:
    q = db.query(DocumentTemplate).filter(
        DocumentTemplate.document_type == tmpl.document_type,
        DocumentTemplate.is_default.is_(True),
        DocumentTemplate.id != tmpl.id,
    )
    q = (
        q.filter(DocumentTemplate.branch_code.is_(None))
        if tmpl.branch_code is None
        else q.filter(DocumentTemplate.branch_code == tmpl.branch_code)
    )
    for other in q.all():
        other.is_default = False
    db.flush()


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Another default template was set for this document at the same time. Reload and try again.",
        ) from exc


# --------------------------------------------------------------------------- #
# Catalogue
# --------------------------------------------------------------------------- #
@router.get("/document-types")
def list_document_types(
    _user: User = Depends(require_permission(*Permissions.PRINT_TEMPLATE_VIEW)),
):
    """Document types that can have print templates, with what each supports."""
    return [
        {
            "key": d.key,
            "label": d.label,
            "required_fields": list(d.required_fields),
            "supports_discount": d.supports_discount,
            "layouts": [{"key": print_templates.STANDARD_LAYOUT, "label": "Standard A4"}]
            + [{"key": k, "label": label} for k, label, _file in d.layouts],
            "has_id": d.has_id,
        }
        for d in DOCUMENT_TYPES.values()
    ]


# Document type -> (model path, number attribute) for picking preview documents.
_SAMPLE_SOURCES = {
    "invoice": ("app.modules.sales.models", "Invoice", "invoice_no"),
    "quotation": ("app.modules.sales.quotation_models", "SalesQuote", "quote_no"),
    "credit-note": ("app.modules.sales.models", "SaleReturn", "sale_return_no"),
    "purchase-order": ("app.modules.purchasing.models", "PurchasingOrder", "purchasing_order_no"),
    "grn": ("app.modules.purchasing.models", "GoodReceivedNote", "good_received_no"),
    "purchase-return": ("app.modules.purchasing.models", "PurchasingReturn", "purchasing_return_no"),
    "expense": ("app.modules.finance.models", "Expenses", "expenses_no"),
    "item-transfer-note": ("app.modules.warehouse.models", "ItemTransferNote", "item_transfer_note"),
    "journal-entry": ("app.modules.finance.accounting_models", "JournalEntry", "journal_entry_no"),
    "voucher": ("app.modules.customers.models", "CustomerGiftVoucher", "barcode_no"),
}


@router.get("/sample-documents")
def list_sample_documents(
    document_type: str = Query(..., max_length=50),
    user: User = Depends(require_permission(*Permissions.PRINT_TEMPLATE_VIEW)),
    db: Session = Depends(get_db),
):
    """Recent printable documents of a type, to preview a template with real data."""
    import importlib

    from app.common.document_guard import _registry, is_printable_status

    doc = _doc_type(document_type)
    if not doc.has_id:
        return []
    module, cls, number_attr = _SAMPLE_SOURCES[doc.key]
    model = getattr(importlib.import_module(module), cls)
    guard = _registry().get(doc.key)
    status_attr = guard[1] if guard else None

    q = db.query(model)
    if hasattr(model, "branch_code") and not user.is_superuser:
        q = q.filter(model.branch_code.in_([b.branch_code for b in user.branches]))
    rows = q.order_by(model.id.desc()).limit(200).all()
    out = []
    for row in rows:
        if status_attr and not is_printable_status(getattr(row, status_attr, None)):
            continue
        out.append({
            "id": row.id,
            "number": str(getattr(row, number_attr, None) or f"#{row.id}"),
            "branch_code": getattr(row, "branch_code", None),
        })
        if len(out) == 20:
            break
    return out


@router.get("/for-document")
def templates_for_document(
    document_type: str = Query(..., max_length=50),
    document_id: Optional[int] = Query(None, ge=1, le=2_147_483_647),
    user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """What the print dialog needs for one document: the templates it may be printed
    with and the section switches of the one used by default. Needs the document's
    own view permission, not template permissions."""
    import importlib

    doc = _doc_type(document_type)
    if not user_has_permission(user, *doc.permission):
        raise HTTPException(
            status_code=403,
            detail=f"Permission denied. Required: {doc.permission[0]}:{doc.permission[1]}",
        )
    branch_code = None
    if doc.has_id and document_id is not None and doc.key in _SAMPLE_SOURCES:
        module, cls, _ = _SAMPLE_SOURCES[doc.key]
        model = getattr(importlib.import_module(module), cls)
        row = db.query(model).filter(model.id == document_id).first()
        branch_code = getattr(row, "branch_code", None) if row else None
        if branch_code and not validate_branch_access(user, branch_code):
            raise HTTPException(status_code=404, detail="Document not found")

    resolved = print_templates.resolve(db, doc.key, branch_code)
    available = (
        db.query(DocumentTemplate)
        .filter(
            DocumentTemplate.document_type == doc.key,
            DocumentTemplate.is_active.is_(True),
            or_(DocumentTemplate.branch_code.is_(None), DocumentTemplate.branch_code == branch_code),
        )
        .order_by(DocumentTemplate.branch_code.nullslast(), DocumentTemplate.name)
        .all()
    )
    return {
        "default_template_id": resolved.template.id if resolved.template else None,
        "show_header": resolved.settings["show_header"],
        "show_discount": resolved.settings["show_discount"],
        "show_signatures": resolved.settings["show_signatures"],
        "templates": [
            {
                "id": t.id,
                "name": t.name,
                "branch_code": t.branch_code,
                "show_header": print_templates.effective_settings(t.settings)["show_header"],
                "show_discount": print_templates.effective_settings(t.settings)["show_discount"],
                "show_signatures": print_templates.effective_settings(t.settings)["show_signatures"],
            }
            for t in available
        ],
    }


# --------------------------------------------------------------------------- #
# Templates
# --------------------------------------------------------------------------- #
@router.get("", response_model=list[schemas.PrintTemplateSummary])
def list_templates(
    document_type: Optional[str] = Query(None, max_length=50),
    _user: User = Depends(require_permission(*Permissions.PRINT_TEMPLATE_VIEW)),
    db: Session = Depends(get_db),
):
    q = db.query(DocumentTemplate)
    if document_type:
        q = q.filter(DocumentTemplate.document_type == document_type)
    return q.order_by(
        DocumentTemplate.document_type,
        DocumentTemplate.branch_code.nullsfirst(),
        DocumentTemplate.is_default.desc(),
        DocumentTemplate.name,
    ).all()


@router.get("/{template_id}", response_model=schemas.PrintTemplateDetail)
def get_template(
    template_id: RowId,
    _user: User = Depends(require_permission(*Permissions.PRINT_TEMPLATE_VIEW)),
    db: Session = Depends(get_db),
):
    return _get(db, template_id)


@router.post("", response_model=schemas.PrintTemplateDetail, status_code=201)
def create_template(
    body: schemas.PrintTemplateCreate,
    user: User = Depends(require_permission(*Permissions.PRINT_TEMPLATE_CREATE)),
    db: Session = Depends(get_db),
):
    doc = _doc_type(body.document_type)
    _check_branch(db, user, body.branch_code)
    _check_layout(doc, body.settings)
    custom_html = _check_custom_html(user, doc.key, body.custom_html, None)
    tmpl = DocumentTemplate(
        document_type=doc.key,
        name=body.name,
        branch_code=body.branch_code,
        paper_size=body.paper_size,
        orientation=body.orientation,
        settings=body.settings.model_dump(),
        custom_html=custom_html,
        is_active=body.is_active,
        is_default=False,
        version=1,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(tmpl)
    db.flush()
    if body.is_default and body.is_active:
        # Clear the old default first: the unique index allows one at a time.
        _clear_other_defaults(db, tmpl)
        tmpl.is_default = True
        db.flush()
    db.add(_snapshot(tmpl, user))
    _commit(db)
    db.refresh(tmpl)
    return tmpl


@router.put("/{template_id}", response_model=schemas.PrintTemplateDetail)
def update_template(
    template_id: RowId,
    body: schemas.PrintTemplateUpdate,
    user: User = Depends(require_permission(*Permissions.PRINT_TEMPLATE_UPDATE)),
    db: Session = Depends(get_db),
):
    tmpl = _get(db, template_id)
    if body.expected_version is not None and body.expected_version != tmpl.version:
        raise HTTPException(
            status_code=409,
            detail="This template was changed by someone else. Reload it before saving.",
        )
    _check_branch(db, user, tmpl.branch_code)
    if body.branch_code != tmpl.branch_code:
        _check_branch(db, user, body.branch_code)
    _check_layout(DOCUMENT_TYPES[tmpl.document_type], body.settings)
    custom_html = _check_custom_html(user, tmpl.document_type, body.custom_html, tmpl.custom_html)

    tmpl.name = body.name
    tmpl.branch_code = body.branch_code
    tmpl.paper_size = body.paper_size
    tmpl.orientation = body.orientation
    tmpl.settings = body.settings.model_dump()
    tmpl.custom_html = custom_html
    tmpl.is_active = body.is_active
    if not tmpl.is_active:
        tmpl.is_default = False
    tmpl.version += 1
    tmpl.updated_by = user.id
    db.flush()
    if tmpl.is_default:
        _clear_other_defaults(db, tmpl)
    db.add(_snapshot(tmpl, user))
    _commit(db)
    db.refresh(tmpl)
    return tmpl


@router.post("/{template_id}/set-default", response_model=schemas.PrintTemplateDetail)
def set_default_template(
    template_id: RowId,
    user: User = Depends(require_permission(*Permissions.PRINT_TEMPLATE_UPDATE)),
    db: Session = Depends(get_db),
):
    tmpl = _get(db, template_id)
    _check_branch(db, user, tmpl.branch_code)
    if not tmpl.is_active:
        raise HTTPException(status_code=422, detail="Activate the template before making it the default")
    _clear_other_defaults(db, tmpl)
    tmpl.is_default = True
    tmpl.updated_by = user.id
    _commit(db)
    db.refresh(tmpl)
    return tmpl


@router.post("/{template_id}/unset-default", response_model=schemas.PrintTemplateDetail)
def unset_default_template(
    template_id: RowId,
    user: User = Depends(require_permission(*Permissions.PRINT_TEMPLATE_UPDATE)),
    db: Session = Depends(get_db),
):
    """Stop using this template by default (documents fall back to the next level)."""
    tmpl = _get(db, template_id)
    _check_branch(db, user, tmpl.branch_code)
    tmpl.is_default = False
    tmpl.updated_by = user.id
    _commit(db)
    db.refresh(tmpl)
    return tmpl


@router.delete("/{template_id}", status_code=204)
def delete_template(
    template_id: RowId,
    user: User = Depends(require_permission(*Permissions.PRINT_TEMPLATE_DELETE)),
    db: Session = Depends(get_db),
):
    tmpl = _get(db, template_id)
    _check_branch(db, user, tmpl.branch_code)
    db.delete(tmpl)
    db.commit()


@router.get("/{template_id}/versions", response_model=list[schemas.PrintTemplateVersionOut])
def list_versions(
    template_id: RowId,
    _user: User = Depends(require_permission(*Permissions.PRINT_TEMPLATE_VIEW)),
    db: Session = Depends(get_db),
):
    _get(db, template_id)
    return (
        db.query(DocumentTemplateVersion)
        .filter(DocumentTemplateVersion.template_id == template_id)
        .order_by(DocumentTemplateVersion.version.desc())
        .all()
    )


@router.post("/{template_id}/versions/{version}/restore", response_model=schemas.PrintTemplateDetail)
def restore_version(
    template_id: RowId,
    version: Annotated[int, Path(ge=1, le=2_147_483_647)],
    user: User = Depends(require_permission(*Permissions.PRINT_TEMPLATE_UPDATE)),
    db: Session = Depends(get_db),
):
    """Make an old version current again (saved as a new version, so nothing is lost)."""
    tmpl = _get(db, template_id)
    _check_branch(db, user, tmpl.branch_code)
    old = (
        db.query(DocumentTemplateVersion)
        .filter(DocumentTemplateVersion.template_id == template_id, DocumentTemplateVersion.version == version)
        .first()
    )
    if old is None:
        raise HTTPException(status_code=404, detail="Version not found")
    snap = old.snapshot
    custom_html = _check_custom_html(user, tmpl.document_type, snap.get("custom_html"), tmpl.custom_html)
    tmpl.name = snap.get("name") or tmpl.name
    tmpl.paper_size = snap.get("paper_size")
    tmpl.orientation = snap.get("orientation") or "portrait"
    tmpl.settings = schemas.PrintLayoutSettings(**(snap.get("settings") or {})).model_dump()
    tmpl.custom_html = custom_html
    tmpl.is_active = snap.get("is_active", True)
    if not tmpl.is_active:
        tmpl.is_default = False
    tmpl.version += 1
    tmpl.updated_by = user.id
    db.flush()
    db.add(_snapshot(tmpl, user))
    _commit(db)
    db.refresh(tmpl)
    return tmpl


# --------------------------------------------------------------------------- #
# Preview
# --------------------------------------------------------------------------- #
@router.post("/preview", response_class=HTMLResponse)
def preview_template(
    body: schemas.PrintTemplatePreview,
    user: User = Depends(require_permission(*Permissions.PRINT_TEMPLATE_VIEW)),
    db: Session = Depends(get_db),
):
    """Render an unsaved template against a real document.

    The document goes through the same checks as printing it (the document's own view
    permission, branch access, approved status). Custom HTML is validated but the
    preview does not require edit rights, so a reviewer can look at an admin's draft.
    """
    from app.common.document_guard import ensure_document_printable
    from app.reporting.document_reports import get_document_report_service

    doc = _doc_type(body.document_type)
    if not user_has_permission(user, *doc.permission):
        raise HTTPException(
            status_code=403,
            detail=f"Permission denied. Required: {doc.permission[0]}:{doc.permission[1]}",
        )
    if doc.has_id and body.document_id is None:
        raise HTTPException(status_code=422, detail="Pick a document to preview with")
    _check_layout(doc, body.settings)
    if body.custom_html:
        problems = print_templates.validate_custom_html(doc.key, body.custom_html)
        if problems:
            raise HTTPException(status_code=422, detail=problems[0])
    if doc.guarded:
        ensure_document_printable(db, doc.key, body.document_id, user)

    draft = DocumentTemplate(
        document_type=doc.key,
        name=body.name,
        branch_code=body.branch_code,
        paper_size=body.paper_size,
        orientation=body.orientation,
        settings=body.settings.model_dump(),
        custom_html=body.custom_html or None,
        version=0,
    )
    service = get_document_report_service(db, preview_template=draft)
    generate = getattr(service, doc.method)
    html = generate(body.document_id) if doc.has_id else generate()
    headers = {"Cache-Control": "no-store"}
    if service.last_render.fallback_error:
        reason = " ".join(service.last_render.fallback_error.split())[:200]
        headers["X-Print-Template-Fallback"] = reason.encode("ascii", "replace").decode("ascii")
    if service.last_render.custom_html:
        headers["Content-Security-Policy"] = print_templates.CUSTOM_HTML_CSP
    return HTMLResponse(content=html, headers=headers)
