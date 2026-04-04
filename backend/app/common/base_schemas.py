from pydantic import BaseModel, ConfigDict, field_serializer
from pydantic.functional_serializers import PlainSerializer
from datetime import datetime
from typing import Optional, Annotated


def format_datetime(dt: datetime) -> str:
    if dt is None:
        return None
    return dt.strftime("%Y-%m-%d %H:%M:%S")

FormattedDateTime = Annotated[
    datetime,
    PlainSerializer(lambda v: v.strftime("%Y-%m-%d %H:%M:%S") if v else None, return_type=str)
]


class TijaeroBaseSchema(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        json_encoders={
            datetime: lambda v: v.strftime("%Y-%m-%d %H:%M:%S") if v else None
        }
    )


class TimestampSchema(TijaeroBaseSchema):
    created_at: datetime
    updated_at: datetime
    
    @field_serializer('created_at', 'updated_at')
    def serialize_datetime(self, dt: datetime) -> str:
        return format_datetime(dt)


class AuditSchema(TimestampSchema):
    created_by: Optional[int] = None
    updated_by: Optional[int] = None
