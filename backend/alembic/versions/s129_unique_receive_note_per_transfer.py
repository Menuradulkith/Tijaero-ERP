"""One receive note per transfer note

Revision ID: s129_unique_receive_note
Revises: s128_nonpositive_advances
Create Date: 2026-11-05
"""
from alembic import op

revision = 's129_unique_receive_note'
down_revision = 's128_nonpositive_advances'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Two concurrent receipts could each create a receive note. Keep the latest one,
    # which carries the final status, and fold the earlier notes' text into it.
    op.execute(
        """
        WITH ranked AS (
            SELECT id, item_transfer_note_id,
                   row_number() OVER (PARTITION BY item_transfer_note_id ORDER BY id DESC) AS rn
              FROM item_receive_note
        ),
        merged AS (
            SELECT item_transfer_note_id,
                   right(string_agg(nullif(trim(received_note), ''), ' | ' ORDER BY id), 355) AS note
              FROM item_receive_note
             WHERE item_transfer_note_id IN (SELECT item_transfer_note_id FROM ranked WHERE rn > 1)
             GROUP BY item_transfer_note_id
        )
        UPDATE item_receive_note r
           SET received_note = m.note
          FROM merged m, ranked k
         WHERE r.id = k.id AND k.rn = 1 AND r.item_transfer_note_id = m.item_transfer_note_id
        """
    )
    op.execute(
        """
        DELETE FROM item_receive_note r
         USING item_receive_note newer
         WHERE newer.item_transfer_note_id = r.item_transfer_note_id
           AND newer.id > r.id
        """
    )
    op.create_unique_constraint(
        'uq_item_receive_note_transfer_note', 'item_receive_note', ['item_transfer_note_id']
    )


def downgrade() -> None:
    op.drop_constraint('uq_item_receive_note_transfer_note', 'item_receive_note', type_='unique')
