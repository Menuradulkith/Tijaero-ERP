"""Admin-configurable print templates for documents (invoice, PO, GRN, ...).

A `DocumentTemplate` only changes how a document looks. The document renderers in
`document_reports.py` compute every figure and hand the template a fixed context; the
template decides layout, branding, texts and which sections show.

Two kinds of template:
- settings only: the built-in layout file is used, with the admin's logo, colour,
  texts, paper size and section switches applied on top of it;
- custom HTML: the admin's Jinja HTML replaces the layout file. It is rendered in a
  sandbox (no attribute access to internals, no imports), served with a
  Content-Security-Policy that blocks scripts and remote loads, and rendered to PDF
  with JavaScript and network access disabled. If it fails to render, the built-in
  layout is printed instead and the error is logged.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any, Optional

from jinja2 import TemplateSyntaxError
from jinja2.sandbox import ImmutableSandboxedEnvironment
from markupsafe import Markup, escape
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth.rbac import Permissions
from app.modules.reporting.models import DocumentTemplate
from app.reporting import documents

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DocumentType:
    key: str
    label: str
    file_template: str
    permission: tuple[str, str]
    method: str
    # Template paths a custom HTML template must print (document number, date, totals).
    required_fields: tuple[str, ...]
    # Whether the print gate (approved documents only) applies — see common/document_guard.py.
    guarded: bool = True
    has_id: bool = True
    supports_discount: bool = False
    # Alternative built-in layouts besides the standard one: {key: (label, template file)}.
    layouts: tuple[tuple[str, str, str], ...] = ()


DOCUMENT_TYPES: dict[str, DocumentType] = {
    d.key: d
    for d in (
        DocumentType(
            "invoice", "Invoice", "standard/document.html", Permissions.SALES_ORDER_VIEW,
            "generate_invoice_report", ("invoice.invoiceNo", "invoice.date", "invoice.netTotal"),
            supports_discount=True,
            layouts=(("preprinted", "Pre-printed stationery (821 x 768 px)", "printable_invoice.html"),),
        ),
        DocumentType(
            "quotation", "Quotation", "standard/document.html", Permissions.QUOTATION_VIEW,
            "generate_quotation_report", ("quote.quote_no", "quote.created_date", "totals.total_amount"),
            supports_discount=True,
        ),
        DocumentType(
            "credit-note", "Credit Note", "standard/document.html", Permissions.SALES_RETURN_VIEW,
            "generate_credit_note_report", ("credit_note.sale_return_no", "credit_note.added_date", "totals.total_refund"),
        ),
        DocumentType(
            "purchase-order", "Purchase Order", "standard/document.html", Permissions.PURCHASE_ORDER_VIEW,
            "generate_purchase_order_report", ("po.purchasing_order_no", "po.purchasing_order_date", "subtotal"),
        ),
        DocumentType(
            "grn", "Goods Received Note", "standard/document.html", Permissions.GRN_VIEW,
            "generate_grn_report", ("grn.good_received_no", "grn.added_date", "total_value"),
        ),
        DocumentType(
            "purchase-return", "Purchase Return", "standard/document.html", Permissions.PURCHASE_RETURN_VIEW,
            "generate_purchase_return_report", ("return_data.purchasing_return_no", "return_data.added_date", "total_value"),
        ),
        DocumentType(
            "expense", "Expense", "standard/document.html", Permissions.EXPENSE_VIEW,
            "generate_expense_report", ("expense.expenses_no", "expense.expense_amount"),
        ),
        DocumentType(
            "item-transfer-note", "Item Transfer Note", "standard/document.html", Permissions.ITN_VIEW,
            "generate_itn_report", ("itn.itn_no", "itn.transfer_date", "total_quantity"),
        ),
        DocumentType(
            "journal-entry", "Journal Entry", "standard/document.html", Permissions.JOURNAL_ENTRY_VIEW,
            "generate_journal_entry_report", ("je.journal_entry_no", "je.entry_date", "je.total_debit", "je.total_credit"),
        ),
        DocumentType(
            "voucher", "Gift Voucher", "standard/document.html", Permissions.GIFT_VOUCHER_VIEW,
            "generate_voucher_report", ("voucher.voucher_code", "voucher.amount"),
            guarded=False,
        ),
        DocumentType(
            "payroll", "Payroll Summary", "standard/document.html", Permissions.PAYROLL_VIEW,
            "generate_payroll_report", ("total_net_pay",),
            guarded=False, has_id=False,
        ),
    )
}

PAPER_SIZES = ("A4", "A5", "Letter", "Legal", "80mm")
ORIENTATIONS = ("portrait", "landscape")

DEFAULT_PRIMARY_COLOR = "#1a4480"
STANDARD_LAYOUT = "standard"
# The pre-printed invoice stationery: fixed page, image background, laid out in script.
PREPRINTED_PAGE = ("821px", "768px")

# Layout settings and their built-in values. Anything else in `settings` is ignored.
DEFAULT_SETTINGS: dict[str, Any] = {
    "show_header": True,
    "show_discount": True,
    "show_signatures": True,
    "logo": None,  # data:image/png|jpeg|webp;base64,...
    "primary_color": None,  # "#rrggbb"
    "company_name": None,
    "company_address": None,
    "company_phone": None,
    "company_email": None,
    "header_text": None,
    "terms": None,
    "bank_details": None,
    "footer_text": None,
    "layout_style": STANDARD_LAYOUT,  # "standard" or one of DocumentType.layouts
    "show_amount_in_words": True,
    "show_bank_details": True,
}


# Served with custom HTML templates: inline styles and data: images/fonts only.
CUSTOM_HTML_CSP = (
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; "
    "script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'"
)

_sandbox = ImmutableSandboxedEnvironment(autoescape=True)
documents.register_filters(_sandbox)


def layout_file(doc: "DocumentType", settings: dict[str, Any]) -> tuple[str, bool]:
    """(template file, is the standard layout) for a document with these settings."""
    for key, _label, file in doc.layouts:
        if settings.get("layout_style") == key:
            return file, False
    return doc.file_template, True


@dataclass
class ResolvedTemplate:
    """What `resolve` picked for a print: the stored template (if any) and its effective settings."""

    template: Optional[DocumentTemplate]
    settings: dict[str, Any]

    @property
    def custom_html(self) -> Optional[str]:
        return self.template.custom_html if self.template is not None else None


def effective_settings(stored: Optional[dict]) -> dict[str, Any]:
    merged = dict(DEFAULT_SETTINGS)
    for key, value in (stored or {}).items():
        if key in DEFAULT_SETTINGS:
            merged[key] = value
    return merged


def resolve(
    db: Session,
    document_type: str,
    branch_code: Optional[str],
    template_id: Optional[int] = None,
) -> ResolvedTemplate:
    """Pick the template for a print.

    An explicit `template_id` wins (it must be an active template of this document type,
    company-wide or for this branch); otherwise the branch default, then the company-wide
    default, then the built-in layout.
    """
    q = db.query(DocumentTemplate).filter(
        DocumentTemplate.document_type == document_type,
        DocumentTemplate.is_active.is_(True),
    )
    tmpl = None
    if template_id is not None:
        tmpl = q.filter(
            DocumentTemplate.id == template_id,
            or_(DocumentTemplate.branch_code.is_(None), DocumentTemplate.branch_code == branch_code),
        ).first()
        if tmpl is None:
            from fastapi import HTTPException

            raise HTTPException(status_code=404, detail="Print template not found for this document")
    else:
        defaults = q.filter(DocumentTemplate.is_default.is_(True))
        if branch_code:
            tmpl = defaults.filter(DocumentTemplate.branch_code == branch_code).first()
        if tmpl is None:
            tmpl = defaults.filter(DocumentTemplate.branch_code.is_(None)).first()
    return ResolvedTemplate(tmpl, effective_settings(tmpl.settings if tmpl else None))


# --------------------------------------------------------------------------- #
# Validation
# --------------------------------------------------------------------------- #
def _field_pattern(path: str) -> re.Pattern:
    parts = path.split(".")
    pattern = re.escape(parts[0]) + r"\b"
    for part in parts[1:]:
        pattern += r"\s*(?:\.\s*" + re.escape(part) + r"\b|\[\s*['\"]" + re.escape(part) + r"['\"]\s*\])"
    return re.compile(pattern)


def validate_custom_html(document_type: str, source: str) -> list[str]:
    """Problems that stop a custom HTML template from being saved (empty list = valid)."""
    doc = DOCUMENT_TYPES[document_type]
    try:
        _sandbox.parse(source)
    except TemplateSyntaxError as exc:
        return [f"Template syntax error on line {exc.lineno}: {exc.message}"]
    expressions = " ".join(re.findall(r"\{\{(.*?)\}\}", source, flags=re.S))
    statements = " ".join(re.findall(r"\{%(.*?)%\}", source, flags=re.S))
    missing = [f for f in doc.required_fields if not _field_pattern(f).search(expressions)]
    # Templates built on the standard `doc` data print its number and its totals.
    uses_doc = _field_pattern("doc.number").search(expressions) and _field_pattern("doc.totals").search(expressions + " " + statements)
    if missing and not uses_doc:
        return [
            "The template must print these fields: " + ", ".join("{{ " + f + " }}" for f in missing)
            + " (or, with the standard data, {{ doc.number }} and doc.totals)"
        ]
    return []


# --------------------------------------------------------------------------- #
# Rendering
# --------------------------------------------------------------------------- #
def apply_settings(context: dict[str, Any], settings: dict[str, Any]) -> None:
    """Fold the layout settings into the renderer's context (in place).

    Section switches fill in only where the request left them unset (None), so the
    print-preview toggles still override the template for a single print.
    """
    options = context.setdefault("options", {})
    for flag in ("show_header", "show_discount", "show_signatures"):
        if options.get(flag) is None:
            options[flag] = bool(settings[flag])

    company = dict(context.get("company") or {})
    for key in ("name", "address", "phone", "email"):
        value = settings.get(f"company_{key}")
        if value:
            company[key] = value
            if key == "address":
                company["address_lines"] = [ln.strip() for ln in value.splitlines() if ln.strip()]
    if settings.get("logo"):
        company["logo"] = settings["logo"]
    context["company"] = company
    context["layout"] = settings


def _nl2br(text: Optional[str]) -> Markup:
    return Markup("<br>").join(escape(line) for line in (text or "").splitlines())


def _style_block(settings: dict[str, Any], paper_size: Optional[str], orientation: str, extras: bool = True) -> str:
    css = [f":root{{--doc-primary:{settings.get('primary_color') or DEFAULT_PRIMARY_COLOR}}}"]
    if paper_size:
        size = "80mm 297mm" if paper_size == "80mm" else f"{paper_size} {orientation}"
        css.append(f"@page{{size:{size}}}")
    if extras:
        css.append(
            ".tpl-extra{font-family:'Segoe UI',Arial,sans-serif;font-size:9px;color:#495057;"
            "max-width:210mm;margin:6px auto;padding:0 15mm;line-height:1.4}"
            ".tpl-extra h4{font-size:9px;text-transform:uppercase;margin:6px 0 2px;color:var(--doc-primary)}"
            ".tpl-header-text{text-align:center;font-weight:600}"
            ".tpl-footer-text{text-align:center;color:#6c757d;border-top:1px solid #dee2e6;padding-top:4px}"
        )
    return "<style>" + "".join(css) + "</style>"


def _decorate_builtin(html: str, settings: dict[str, Any], paper_size: Optional[str], orientation: str) -> str:
    """Add the settings-driven pieces to a built-in layout: colour/paper CSS, header text,
    terms, bank details and footer text."""
    style = _style_block(settings, paper_size, orientation)
    html = html.replace("</head>", style + "</head>", 1) if "</head>" in html else style + html

    if settings.get("header_text"):
        top = f'<div class="tpl-extra tpl-header-text">{_nl2br(settings["header_text"])}</div>'
        html = re.sub(r"(<body[^>]*>)", lambda m: m.group(1) + top, html, count=1)

    bottom = []
    if settings.get("terms"):
        bottom.append(f"<h4>Terms &amp; Conditions</h4><div>{_nl2br(settings['terms'])}</div>")
    if settings.get("bank_details"):
        bottom.append(f"<h4>Bank Details</h4><div>{_nl2br(settings['bank_details'])}</div>")
    if settings.get("footer_text"):
        bottom.append(f'<div class="tpl-footer-text">{_nl2br(settings["footer_text"])}</div>')
    if bottom:
        block = '<div class="tpl-extra">' + "".join(bottom) + "</div>"
        html = html.replace("</body>", block + "</body>", 1) if "</body>" in html else html + block
    return html


@dataclass
class RenderResult:
    html: str
    template_id: Optional[int]
    template_version: Optional[int]
    custom_html: bool
    paper_size: Optional[str]
    orientation: str
    fallback_error: Optional[str] = None
    # Built-in standard layout (page numbers in the PDF), else a fixed alternative layout.
    standard_layout: bool = True
    landscape: bool = False


def render(
    file_env,
    doc: DocumentType,
    context: dict[str, Any],
    resolved: ResolvedTemplate,
    *,
    preview: Optional[DocumentTemplate] = None,
) -> RenderResult:
    """Render a document with its resolved template (or an unsaved `preview` template)."""
    tmpl = preview if preview is not None else resolved.template
    settings = effective_settings(tmpl.settings if tmpl is not None else None)
    apply_settings(context, settings)
    paper_size = tmpl.paper_size if tmpl is not None else None
    orientation = (tmpl.orientation if tmpl is not None else None) or "portrait"
    meta = dict(
        template_id=tmpl.id if tmpl is not None else None,
        template_version=tmpl.version if tmpl is not None else None,
        paper_size=paper_size,
        orientation=orientation,
    )

    fallback_error = None
    if tmpl is not None and tmpl.custom_html:
        try:
            html = _sandbox.from_string(tmpl.custom_html).render(**context)
            # The CSP also travels inside the page, for previews shown through iframe srcdoc.
            head = (
                f'<meta http-equiv="Content-Security-Policy" content="{CUSTOM_HTML_CSP}">'
                + _style_block(settings, paper_size, orientation)
            )
            if re.search(r"<head[^>]*>", html, flags=re.I):
                html = re.sub(r"(<head[^>]*>)", lambda m: m.group(1) + head, html, count=1, flags=re.I)
            else:
                html = head + html
            return RenderResult(html, custom_html=True, **meta)
        except Exception as exc:  # noqa: BLE001 - any failure falls back to the built-in layout
            fallback_error = f"{type(exc).__name__}: {exc}"
            logger.warning(
                "Print template %s (%s) failed to render, using the built-in layout: %s",
                tmpl.id, doc.key, fallback_error,
            )

    file, standard = layout_file(doc, settings)
    if not standard and settings.get("logo"):
        context["stationery"] = settings["logo"]  # the template's image replaces the stationery background
    html = file_env.get_template(file).render(**context)
    if standard:
        # The standard layout prints header text, terms, bank details and footer itself.
        style = _style_block(settings, paper_size, orientation, extras=False)
        html = html.replace("</head>", style + "</head>", 1) if "</head>" in html else style + html
    else:
        html = _decorate_builtin(html, settings, paper_size, orientation)
    landscape = bool((context.get("doc") or {}).get("landscape")) or orientation == "landscape"
    return RenderResult(html, custom_html=False, fallback_error=fallback_error,
                        standard_layout=standard, landscape=landscape, **meta)


# --------------------------------------------------------------------------- #
# PDF
# --------------------------------------------------------------------------- #
def html_to_pdf(html: str, doc: DocumentType, result: RenderResult) -> bytes:
    """Print rendered HTML to PDF with headless Chromium.

    Network access is blocked (only data: URIs load) so a template cannot make the
    server fetch internal URLs; JavaScript runs only for the invoice stationery layout,
    which lays its lines out in script. Other layouts get page numbers in the footer.
    """
    from app.reporting.chromium import chromium

    fixed_layout = not result.standard_layout and not result.custom_html  # the invoice stationery
    pdf_kwargs: dict[str, Any] = {"print_background": True, "prefer_css_page_size": True}
    viewport = None
    if fixed_layout and result.paper_size is None:
        width, height = PREPRINTED_PAGE
        pdf_kwargs.update(width=width, height=height, margin={"top": "0", "right": "0", "bottom": "0", "left": "0"})
        viewport = {"width": int(width.rstrip("px")), "height": int(height.rstrip("px"))}
        fixed_css = f"<style>@page{{size:{width} {height};margin:0;}}html,body{{margin:0;padding:0;}}.invoice-bg{{margin-bottom:0;}}</style>"
        html = html.replace("</head>", fixed_css + "</head>", 1) if "</head>" in html else fixed_css + html
    else:
        if result.paper_size is None:
            pdf_kwargs.update(format="A4", landscape=result.landscape)
        if result.paper_size != "80mm":
            # "Page 1 of 3" at the foot of every page (Chromium's header/footer templates).
            pdf_kwargs.update(
                display_header_footer=True,
                header_template="<span></span>",
                footer_template='<div style="font-size:7px;width:100%;text-align:right;padding:0 12mm;color:#888">'
                                'Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
                margin={"top": "12mm", "right": "12mm", "bottom": "16mm", "left": "12mm"},
            )

    with chromium() as browser:
        context = browser.new_context(java_script_enabled=fixed_layout, viewport=viewport)
        page = context.new_page()
        page.route(
            "**/*",
            lambda route: route.continue_() if route.request.url.startswith("data:") else route.abort(),
        )
        page.emulate_media(media="screen" if fixed_layout else "print")
        page.set_content(html, wait_until="load")
        if fixed_layout and doc.key == "invoice":
            page.wait_for_function(
                "() => { const el = document.querySelector('#invoice-no');"
                " return el && el.textContent && el.textContent.trim().length > 0; }",
                timeout=3000,
            )
            page.wait_for_timeout(100)
        return page.pdf(**pdf_kwargs)
