from app.core import timezone as tz

from app.db.base import Base
from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import relationship
from app.common.base_models import AuditMixin


class Report(Base, AuditMixin):

    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text)
    report_type = Column(String(50), nullable=False)  # sales, finance, inventory, etc.
    category = Column(String(50))  # summary, detailed, comparison, etc.
    parameters = Column(Text)  # JSON string of report parameters
    created_by = Column(Integer, ForeignKey("accounts_user.id"))
    created_date = Column(DateTime, default=tz.now)
    is_template = Column(Boolean, default=False)
    is_scheduled = Column(Boolean, default=False)
    schedule_frequency = Column(String(50))  # daily, weekly, monthly
    last_run = Column(DateTime)
    # Report Center saved reports: report_type holds the report key, parameters a JSON
    # {"params": {...}, "view": {...}}; shared ones are visible to everyone who can run the report.
    is_shared = Column(Boolean, nullable=False, default=False, server_default=text("false"))


class ReportExecution(Base, AuditMixin):

    __tablename__ = "report_executions"

    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, ForeignKey("reports.id", ondelete="SET NULL"))
    report_key = Column(String(100), index=True)  # Report Center report that was run
    executed_by = Column(Integer, ForeignKey("accounts_user.id"))
    execution_date = Column(DateTime, default=tz.now)
    status = Column(String(50))
    parameters = Column(Text)
    result_summary = Column(Text)
    execution_time = Column(Integer)
    error_message = Column(Text)

    report = relationship("Report", backref="executions")


class DocumentTemplate(Base, AuditMixin):
    """A print layout for one document type (invoice, purchase order, ...).

    `settings` holds the layout options (logo, colours, texts, which sections show);
    `custom_html`, when set, replaces the built-in layout file and is rendered in a
    sandbox. A template with no branch applies company-wide; a branch template wins
    over it for that branch's documents. Templates only change how a document looks:
    every figure on it is computed by the document renderer.
    """

    __tablename__ = "document_templates"

    id = Column(Integer, primary_key=True, index=True)
    document_type = Column(String(50), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    branch_code = Column(
        String(255),
        ForeignKey("branches.branch_code", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    paper_size = Column(String(20), nullable=True)  # None = the layout's own size
    orientation = Column(String(10), nullable=False, default="portrait", server_default="portrait")
    settings = Column(JSON, nullable=False, default=dict)
    custom_html = Column(Text, nullable=True)
    is_default = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    is_active = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    version = Column(Integer, nullable=False, default=1, server_default="1")

    @property
    def has_custom_html(self) -> bool:
        return bool(self.custom_html)

    versions = relationship(
        "DocumentTemplateVersion",
        back_populates="template",
        cascade="all, delete-orphan",
        order_by="DocumentTemplateVersion.version.desc()",
    )

    __table_args__ = (
        # At most one active default per document type and branch (NULL branch = company-wide).
        Index(
            "uq_document_templates_default",
            "document_type",
            func.coalesce(branch_code, ""),
            unique=True,
            postgresql_where=text("is_default AND is_active"),
        ),
    )


class DocumentTemplateVersion(Base):
    """Snapshot of a template taken on every save, so an admin can see and restore history."""

    __tablename__ = "document_template_versions"

    id = Column(Integer, primary_key=True, index=True)
    template_id = Column(
        Integer,
        ForeignKey("document_templates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version = Column(Integer, nullable=False)
    snapshot = Column(JSON, nullable=False)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=tz.now)

    template = relationship("DocumentTemplate", back_populates="versions")

    __table_args__ = (UniqueConstraint("template_id", "version", name="uq_document_template_version"),)
