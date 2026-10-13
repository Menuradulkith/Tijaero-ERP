"""Each branch has exactly one location (QA audit 2026-10-11, High)."""
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.modules.common import schemas
from app.modules.common.service import LocationService


def test_second_location_for_a_branch_is_rejected(db, make_branch, make_location):
    branch = make_branch()
    make_location(branch=branch)

    with pytest.raises(HTTPException) as exc:
        LocationService(db).create(schemas.LocationCreate(name="Second", branch_code=branch.branch_code))
    assert exc.value.status_code == 400


def test_first_location_is_created(db, make_branch):
    branch = make_branch()
    location = LocationService(db).create(schemas.LocationCreate(name="Main", branch_code=branch.branch_code))
    assert location.branch_code == branch.branch_code


def test_moving_a_location_onto_a_branch_that_has_one_is_rejected(db, make_branch, make_location):
    a, b = make_branch(), make_branch()
    make_location(branch=a)
    moving = make_location(branch=b)

    with pytest.raises(HTTPException) as exc:
        LocationService(db).update(moving.id, schemas.LocationCreate(name="Moved", branch_code=a.branch_code))
    assert exc.value.status_code == 400


def test_renaming_the_only_location_is_allowed(db, make_branch, make_location):
    branch = make_branch()
    location = make_location(branch=branch)
    updated = LocationService(db).update(
        location.id, schemas.LocationCreate(name="Renamed", branch_code=branch.branch_code)
    )
    assert updated.name == "Renamed"


def test_unknown_branch_is_404(db):
    with pytest.raises(HTTPException) as exc:
        LocationService(db).create(schemas.LocationCreate(name="X", branch_code="NO-SUCH-BRANCH"))
    assert exc.value.status_code == 404


@pytest.mark.parametrize("name", ["", "   ", "a\x00b", "x" * 201])
def test_invalid_location_names_are_rejected(name):
    with pytest.raises(ValidationError):
        schemas.LocationCreate(name=name, branch_code="QA-X")
