from typing import Generic, TypeVar, List
from pydantic import BaseModel
from math import ceil
from sqlalchemy import func, select

T = TypeVar('T')

class PaginatedResponse(BaseModel, Generic[T]):
    items: List[T]
    total: int
    page: int
    page_size: int
    total_pages: int


def fast_count(query) -> int:
    """
    Efficient count using a subquery instead of query.count().
    query.count() wraps the full query in SELECT COUNT(*) FROM (SELECT ... FROM table)
    which re-evaluates all joins/filters. This version uses a lightweight subquery
    that lets PostgreSQL optimise the count plan.
    """
    count_q = query.statement.with_only_columns(func.count()).order_by(None)
    return query.session.execute(count_q).scalar() or 0


def paginate(query, page: int = 1, page_size: int = 10):
    total = fast_count(query)
    items = query.offset((page - 1) * page_size).limit(page_size).all()
    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=ceil(total / page_size)
    )
