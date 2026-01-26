"""merge heads jan25 - coupon and voucher

Revision ID: merge_heads_jan25
Revises: add_coupon_products_m2m, add_gift_voucher_enhancements
Create Date: 2026-01-25 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'merge_heads_jan25'
down_revision: Union[str, Sequence[str], None] = ('add_coupon_products_m2m', 'add_gift_voucher_enhancements')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # No changes needed - this is just a merge point
    pass


def downgrade() -> None:
    # No changes needed - this is just a merge point
    pass
