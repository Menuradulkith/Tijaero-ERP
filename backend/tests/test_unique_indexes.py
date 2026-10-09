"""The database, not just the service, must reject case/space variants (races can't slip past a pre-check)."""
import uuid
from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app.auth.models import Branch, User
from app.core.security import get_password_hash
from app.modules.employees.models import Employee


def _u() -> str:
    return uuid.uuid4().hex[:8]


def _user(**kw) -> User:
    u = _u()
    base = dict(
        username=f"idx_{u}", email=f"idx.{u}@example.com", hashed_password=get_password_hash("Qa!Pass#2026"),
        first_name="I", last_name="X", employee_id=f"IDX{u}", is_active=True, is_staff=False, is_superuser=False,
        verify=True, blocked=False, date_joined=date.today(), middle_name="", occupation="",
    )
    base.update(kw)
    return User(**base)


def _collides(db, obj) -> bool:
    try:
        with db.begin_nested():
            db.add(obj)
            db.flush()
    except IntegrityError:
        return True
    return False


class TestUserIndexes:
    @pytest.fixture
    def base(self, db):
        user = _user()
        db.add(user)
        db.flush()
        return user

    def test_username_variants_collide(self, db, base):
        for variant in (base.username.upper(), f" {base.username} ", base.username.title()):
            assert _collides(db, _user(username=variant)), variant

    def test_email_variants_collide(self, db, base):
        for variant in (base.email.upper(), f" {base.email} "):
            assert _collides(db, _user(email=variant)), variant

    def test_employee_id_variants_collide(self, db, base):
        for variant in (base.employee_id.lower(), f" {base.employee_id} "):
            assert _collides(db, _user(employee_id=variant)), variant

    def test_distinct_values_and_missing_emails_are_fine(self, db, base):
        assert not _collides(db, _user())
        assert not _collides(db, _user(email=None))
        assert not _collides(db, _user(email=None))     # NULL emails never collide with each other
        assert not _collides(db, _user(email=""))
        assert not _collides(db, _user(email=" "))     # blank emails are excluded from the index too

    def test_employee_record_variants_collide(self, db, base):
        db.add(Employee(user_id=base.id, employee_id=base.employee_id))
        db.flush()
        other = _user()
        db.add(other)
        db.flush()
        assert _collides(db, Employee(user_id=other.id, employee_id=f" {base.employee_id.lower()} "))


class TestBranchIndexes:
    @pytest.fixture
    def base(self, db):
        u = _u()
        branch = Branch(branch_name=f"Idx Branch {u}", branch_code=f"IDX{u}", email=f"idx.{u}@example.com", active=True)
        db.add(branch)
        db.flush()
        return branch

    def _branch(self, **kw):
        u = _u()
        base = dict(branch_name=f"Other {u}", branch_code=f"OTH{u}", email=f"other.{u}@example.com", active=True)
        base.update(kw)
        return Branch(**base)

    def test_name_variants_collide(self, db, base):
        for variant in (base.branch_name.upper(), f" {base.branch_name} "):
            assert _collides(db, self._branch(branch_name=variant)), variant

    def test_code_variants_collide(self, db, base):
        for variant in (base.branch_code.lower(), f" {base.branch_code} "):
            assert _collides(db, self._branch(branch_code=variant)), variant

    def test_email_variants_collide(self, db, base):
        for variant in (base.email.upper(), f" {base.email} "):
            assert _collides(db, self._branch(email=variant)), variant

    def test_blank_and_null_emails_are_fine(self, db, base):
        assert not _collides(db, self._branch(email=None))
        assert not _collides(db, self._branch(email=None))
        assert not _collides(db, self._branch(email=""))


# ---------------------------------------------------------------------------------------------
# The losing side of a race: a concurrent request passed the service's duplicate pre-check, so only
# the database index stops it. That must surface as a clean 400, never a 500.
# ---------------------------------------------------------------------------------------------
class TestUpdateRaceLosers:
    def test_branch_rename_onto_taken_name(self, superclient, make_branch, monkeypatch):
        from app.modules.branches.repository import BranchRepository

        a, b = make_branch(), make_branch()
        monkeypatch.setattr(BranchRepository, "get_by_name", lambda self, db, name: None)
        r = superclient.put(f"/api/v1/branches/{b.id}", json={"branch_name": f" {a.branch_name.upper()} "})
        assert r.status_code == 400, r.text
        assert "already exists" in r.json()["detail"]

    def test_branch_email_onto_taken_email(self, superclient, make_branch, monkeypatch):
        from app.modules.branches.repository import BranchRepository

        a = make_branch()
        a.email = f"taken.{_u()}@example.com"
        b = make_branch()
        monkeypatch.setattr(BranchRepository, "get_by_email", lambda self, db, email: None)
        r = superclient.put(f"/api/v1/branches/{b.id}", json={"email": a.email.upper()})
        assert r.status_code == 400, r.text

    def test_user_rename_onto_taken_username(self, superclient, make_user, monkeypatch):
        from app.auth.service import AuthService

        a, _ = make_user()
        b, _ = make_user()
        monkeypatch.setattr(AuthService, "check_username_exists", lambda self, db, username, exclude_user_id=None: False)
        r = superclient.put(f"/api/v1/users/{b.id}", json={"username": a.username.upper()})
        assert r.status_code == 400, r.text
        assert "already exists" in r.json()["detail"]

    def test_role_rename_onto_taken_name(self, superclient, db, monkeypatch):
        from app.auth.models import Group
        from app.auth.service import GroupService

        a, b = Group(name=f"QA-A-{_u()}"), Group(name=f"QA-B-{_u()}")
        db.add_all([a, b])
        db.flush()
        monkeypatch.setattr(GroupService, "_name_taken", lambda self, db, name, exclude_id=None: False)
        r = superclient.put(f"/api/v1/groups/{b.id}", json={"name": f" {a.name.lower()} "})
        assert r.status_code == 400, r.text
        assert "already exists" in r.json()["detail"]
