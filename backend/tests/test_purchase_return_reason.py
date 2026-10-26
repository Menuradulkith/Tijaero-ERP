"""Purchase return reason / comment rules enforced by the create schema."""
import pytest
from pydantic import ValidationError

from app.modules.purchasing.schemas import PURCHASE_RETURN_REASONS, PurchasingReturnCreate


def _payload(**overrides):
    base = {
        "branch_code": "HQ", "goodreceivednote_id": 1,
        "items": [{"product_id": 1, "purchasing_price": 10, "return_price": 10, "barcode": "B1"}],
    }
    base.update(overrides)
    return base


@pytest.mark.parametrize("reason", PURCHASE_RETURN_REASONS[:-1])
def test_listed_reasons_are_accepted_without_a_comment(reason):
    assert PurchasingReturnCreate(**_payload(reason=reason)).reason == reason


def test_unknown_reason_is_rejected():
    with pytest.raises(ValidationError):
        PurchasingReturnCreate(**_payload(reason="Changed my mind"))


def test_other_requires_a_comment():
    with pytest.raises(ValidationError):
        PurchasingReturnCreate(**_payload(reason="Other", remark="   "))
    assert PurchasingReturnCreate(**_payload(reason="Other", remark="Wrong colour")).reason == "Other"


def test_reason_is_optional_for_existing_callers():
    assert PurchasingReturnCreate(**_payload()).reason is None
