from pydantic import BaseModel, ConfigDict, computed_field, field_serializer
from pydantic.functional_serializers import PlainSerializer
from datetime import datetime
from typing import Optional, Annotated

from app.core import timezone as tz


def format_datetime(dt: datetime) -> Optional[str]:
    """Serialize a datetime as an ISO 8601 string with a UTC offset attached,
    so clients can correctly convert it to their own display timezone.

    Naive datetimes (the overwhelming majority — every audit timestamp
    produced by app.core.timezone.now() is naive, already in the ERP's
    configured local wall-clock time) are labeled with that configured
    zone. An already timezone-aware datetime is left as-is (its own offset
    is trusted, not overwritten)."""
    if dt is None:
        return None
    aware = dt if dt.tzinfo is not None else dt.replace(tzinfo=tz.LOCAL_TZ)
    return aware.replace(microsecond=0).isoformat()

FormattedDateTime = Annotated[
    datetime,
    PlainSerializer(lambda v: format_datetime(v), return_type=str)
]


class TijaeroBaseSchema(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        json_encoders={
            datetime: format_datetime
        }
    )


class VersionedSchema(BaseModel):
    """Adds a read-only `version` token (full-precision updated_at) to a
    response schema. Clients echo it back as `expected_version` on update for
    an exact optimistic-concurrency check (see app.common.concurrency)."""

    @computed_field  # type: ignore[prop-decorator]
    @property
    def version(self) -> Optional[str]:
        from app.common.concurrency import version_token

        return version_token(getattr(self, "updated_at", None))


class TimestampSchema(TijaeroBaseSchema):
    created_at: datetime
    updated_at: datetime
    
    @field_serializer('created_at', 'updated_at')
    def serialize_datetime(self, dt: datetime) -> str:
        return format_datetime(dt)


class AuditSchema(TimestampSchema):
    created_by: Optional[int] = None
    updated_by: Optional[int] = None
