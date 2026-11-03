"""Regression tests for the 2026-11-03 Admin QA audit (auth, users, roles,
branches, settings). IDs refer to docs/qa/2026-11-03/report-admin.md."""
import uuid
import random
import string
from datetime import datetime, timedelta

import pytest

from app.auth.models import Group, Permission, User, UserPasscode
from app.common.audit import AuditLog
from app.core.security import get_password_hash

USERS = "/api/v1/users/"
BRANCHES = "/api/v1/branches/"
S = "/api/v1/settings"
AUTH = "/api/v1/auth"
GOOD_PW = "Qa!Pass#2026"


def _u() -> str:
    return uuid.uuid4().hex[:8]


@pytest.fixture(autouse=True)
def _no_login_rate_limit():
    from app.core import simple_rate_limit

    simple_rate_limit._limiter._storage.clear()
    yield
    simple_rate_limit._limiter._storage.clear()


def _perm(db, resource, action):
    p = db.query(Permission).filter(Permission.resource == resource, Permission.action == action).first()
    if p is None:
        p = Permission(name=f"{resource}.{action}.{_u()}", resource=resource, action=action)
        db.add(p)
        db.flush()
    return p


def _login(client, user, password="Passw0rd!"):
    client.headers.pop("Authorization", None)
    return client.post(f"{AUTH}/login", data={"username": user.username, "password": password})


# ---------------------------------------------------------------- ADM-02
def test_adm02_user_with_non_deliverable_email_still_serializes(db, superclient, make_user, make_branch):
    target, token = make_user(branches=[make_branch()])
    target.email = f"qa.{_u()}@example.test"  # EmailStr rejects the .test TLD
    db.flush()
    assert superclient.get(f"{USERS}{target.id}").status_code == 200
    r = superclient.put(f"{USERS}{target.id}", json={"occupation": "Clerk"})
    assert r.status_code == 200, r.text
    superclient.headers["Authorization"] = f"Bearer {token}"
    assert superclient.get(f"{USERS}me").status_code == 200


def test_adm02_email_input_still_validated(superclient, make_user, make_branch):
    target, _ = make_user(branches=[make_branch()])
    assert superclient.put(f"{USERS}{target.id}", json={"email": "not-an-email"}).status_code == 422


# ---------------------------------------------------------------- ADM-01
def test_adm01_password_containing_stored_username_is_422(db, superclient, make_user, make_branch):
    target, _ = make_user(branches=[make_branch()])
    r = superclient.put(f"{USERS}{target.id}", json={"password": f"Xy!9{target.username}"})
    assert r.status_code == 422, r.text
    assert "username" in r.json()["detail"].lower()


# ---------------------------------------------------------------- ADM-03
def test_adm03_branch_performance_requires_branch_access(client, api, make_user, make_branch):
    own, other = make_branch(), make_branch()
    _, token = make_user(permissions=[("branches", "view")], branches=[own])
    c = api(token)
    assert c.get(f"{BRANCHES}{other.id}/performance").status_code == 403
    assert c.get(f"{BRANCHES}{own.id}/performance").status_code == 200


# ---------------------------------------------------------------- ADM-04 / ADM-08 (small)
def test_adm04_deactivated_user_cannot_use_self_service_settings(client, api, make_user):
    _, token = make_user(is_active=False)
    c = api(token)
    assert c.put(f"{S}/profile", json={"first_name": "Zed"}).status_code == 403
    assert c.get(f"{S}/preferences").status_code == 403
    assert c.get(f"{S}/notifications").status_code == 403
    r = c.post(f"{S}/change-password", json={"current_password": "Passw0rd!", "new_password": GOOD_PW, "confirm_password": GOOD_PW})
    assert r.status_code == 403


def test_adm08_blocked_user_token_is_refused(db, client, api, make_user):
    user, token = make_user()
    user.blocked = True
    db.flush()
    assert api(token).get(f"{USERS}me").status_code == 403


# ---------------------------------------------------------------- ADM-05
def test_adm05_own_password_cannot_be_changed_via_put_users(db, client, api, make_user, make_branch, superuser):
    branch = make_branch()
    manager, token = make_user(permissions=[("users", "view"), ("users", "update")], branches=[branch])
    before = manager.hashed_password
    r = api(token).put(f"{USERS}{manager.id}", json={"password": GOOD_PW})
    assert r.status_code == 400 and "change-password" in r.json()["detail"]
    db.refresh(manager)
    assert manager.hashed_password == before
    # Superusers too; other fields still editable, blank password = unchanged.
    su, su_token = superuser
    c = api(su_token)
    assert c.put(f"{USERS}{su.id}", json={"password": GOOD_PW}).status_code == 400
    assert c.put(f"{USERS}{su.id}", json={"password": "", "occupation": "Boss"}).status_code == 200


# ---------------------------------------------------------------- ADM-06
def test_adm06_pending_password_change_limits_the_token(db, client, api, make_user):
    user, token = make_user(permissions=[("sales", "view")])
    user.must_change_password = True
    db.flush()
    c = api(token)
    assert c.get(f"{USERS}me").status_code == 200
    assert c.get(f"{S}/preferences").status_code == 403
    assert c.get(f"{S}/notifications/stats").status_code == 403
    r = c.post(f"{S}/change-password", json={"current_password": "Passw0rd!", "new_password": GOOD_PW, "confirm_password": GOOD_PW})
    assert r.status_code == 200, r.text
    db.refresh(user)
    assert user.must_change_password is False


def test_adm06_passcode_login_reports_pending_password_change(db, client, api, make_user):
    user, token = make_user()
    assert api(token).post(f"{AUTH}/passcode", json={"passcode": "482913", "confirm_passcode": "482913"}).status_code == 200
    user.must_change_password = True
    db.flush()
    client.headers.pop("Authorization", None)
    r = client.post(f"{AUTH}/passcode-login", json={"username": user.username, "passcode": "482913"})
    assert r.status_code == 200, r.text
    assert r.json()["must_change_password"] is True
    c = api(r.json()["access_token"])
    assert c.get(f"{S}/preferences").status_code == 403
    assert c.get(f"{USERS}me").status_code == 200


# ---------------------------------------------------------------- ADM-07
def test_adm07_password_login_clears_locked_passcode_and_says_so(db, client, make_user):
    user, _ = make_user()
    db.add(UserPasscode(user_id=user.id, hashed_passcode=get_password_hash("123456"), failed_attempts=3,
                        locked_out=True, created_at_ts=datetime.utcnow()))
    db.flush()
    r = _login(client, user)
    assert r.status_code == 200, r.text
    assert r.json()["passcode_locked_out"] is True
    assert db.query(UserPasscode).filter(UserPasscode.user_id == user.id).first() is None
    r = _login(client, user)
    assert r.json()["passcode_locked_out"] is False


def test_adm07_password_login_resets_partial_failures(db, client, make_user):
    user, _ = make_user()
    row = UserPasscode(user_id=user.id, hashed_passcode=get_password_hash("123456"), failed_attempts=2,
                       locked_out=False, created_at_ts=datetime.utcnow())
    db.add(row)
    db.flush()
    assert _login(client, user).json()["passcode_locked_out"] is False
    db.refresh(row)
    assert row.failed_attempts == 0


# ---------------------------------------------------------------- ADM-09
def test_adm09_passcode_login_does_not_enumerate_accounts(db, client, make_user):
    no_passcode, _ = make_user()
    inactive, _ = make_user(is_active=False)
    db.add(UserPasscode(user_id=inactive.id, hashed_passcode=get_password_hash("123456"), failed_attempts=0,
                        locked_out=False, created_at_ts=datetime.utcnow()))
    db.flush()
    client.headers.pop("Authorization", None)
    bodies = []
    for username in (f"nobody_{_u()}", no_passcode.username, inactive.username):
        r = client.post(f"{AUTH}/passcode-login", json={"username": username, "passcode": "123456"})
        assert r.status_code == 401
        bodies.append(r.json())
    assert bodies[0] == bodies[1] == bodies[2]


# ---------------------------------------------------------------- ADM-10 (backend side)
def test_adm10_self_service_settings_need_no_settings_permission(client, api, make_user):
    _, token = make_user()  # no permissions at all
    c = api(token)
    assert c.put(f"{S}/profile", json={"first_name": "Zed"}).status_code == 200
    assert c.get(f"{S}/company").status_code == 403


# ---------------------------------------------------------------- ADM-11
def test_adm11_role_shared_with_other_branches_cannot_be_edited(db, client, api, superclient, make_user, make_branch):
    own, other = make_branch(), make_branch()
    role = Group(name=f"QA-Shared-{_u()}")
    role.permissions = [_perm(db, "sales", "view")]
    db.add(role)
    db.flush()
    manager, token = make_user(permissions=[("groups", "view"), ("groups", "update"), ("sales", "view"), ("sales", "create")],
                               branches=[own])
    local, _ = make_user(branches=[own])
    local.groups.append(role)
    db.flush()
    c = api(token)
    # Only held inside the manager's branch: allowed.
    assert c.put(f"/api/v1/groups/{role.id}", json={"name": f"QA-Local-{_u()}"}).status_code == 200
    remote, _ = make_user(branches=[other])
    remote.groups.append(role)
    db.flush()
    r = c.put(f"/api/v1/groups/{role.id}", json={"permission_ids": [_perm(db, "sales", "create").id]})
    assert r.status_code == 403 and "outside your branches" in r.json()["detail"]
    su, su_token = make_user(is_superuser=True)
    assert api(su_token).put(f"/api/v1/groups/{role.id}", json={"name": f"QA-Su-{_u()}"}).status_code == 200


# ---------------------------------------------------------------- ADM-13 / ADM-17
def test_adm13_branch_code_change_and_stranding_deactivation_refused(superclient, make_user, make_branch):
    b = make_branch()
    make_user(branches=[b])
    assert superclient.put(f"{BRANCHES}{b.id}", json={"branch_code": f"X{_u()}"}).status_code == 400
    r = superclient.put(f"{BRANCHES}{b.id}", json={"active": False})
    assert r.status_code == 400 and "only branch" in r.json()["detail"]
    empty = make_branch()
    assert superclient.put(f"{BRANCHES}{empty.id}", json={"active": False}).status_code == 200


def test_adm17_branch_list_is_ordered(superclient):
    items = superclient.get(BRANCHES, params={"page": 1, "size": 500}).json()["items"]
    ids = [b["id"] for b in items]
    assert ids == sorted(ids)


# ---------------------------------------------------------------- ADM-14 / ADM-15 / ADM-16
def test_adm14_change_password_rejects_same_or_username(client, api, make_user):
    user, token = make_user(password=GOOD_PW)
    c = api(token)
    same = c.post(f"{S}/change-password", json={"current_password": GOOD_PW, "new_password": GOOD_PW, "confirm_password": GOOD_PW})
    assert same.status_code == 400 and "different" in same.json()["detail"]
    with_name = f"Xy!9{user.username}"
    r = c.post(f"{S}/change-password", json={"current_password": GOOD_PW, "new_password": with_name, "confirm_password": with_name})
    assert r.status_code == 422


def test_adm15_passcode_cannot_be_reset_to_current_value(client, api, make_user):
    _, token = make_user()
    c = api(token)
    assert c.post(f"{AUTH}/passcode", json={"passcode": "482913", "confirm_passcode": "482913"}).status_code == 200
    assert c.post(f"{AUTH}/passcode", json={"passcode": "482913", "confirm_passcode": "482913"}).status_code == 400


def test_adm16_profile_cannot_change_date_joined(db, client, api, make_user):
    user, token = make_user()
    joined = user.date_joined
    r = api(token).put(f"{S}/profile", json={"date_joined": (joined - timedelta(days=400)).isoformat()})
    assert r.status_code == 200
    db.refresh(user)
    assert user.date_joined == joined


# ---------------------------------------------------------------- ADM-18
def test_adm18_currency_create_201_in_use_delete_refused_and_audited(db, superclient, make_customer):
    existing = {c["code"] for c in superclient.get(f"{S}/currencies").json()}
    code = next(c for c in ("".join(random.choices(string.ascii_uppercase, k=3)) for _ in range(100)) if c not in existing)
    r = superclient.post(f"{S}/currencies", json={"code": code, "name": "QA", "symbol": "Q"})
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    customer = make_customer()
    customer.default_currency = code
    db.flush()
    r = superclient.delete(f"{S}/currencies/{cid}")
    assert r.status_code == 400 and "Deactivate" in r.json()["detail"]
    assert db.query(AuditLog).filter(AuditLog.entity_type == "currency", AuditLog.entity_id == cid,
                                     AuditLog.action == "create").count() == 1


def test_adm18_company_settings_update_is_audited(db, superclient):
    current = superclient.get(f"{S}/company").json()
    new_days = 7 if current.get("passcode_expiry_days") != 7 else 8
    assert superclient.put(f"{S}/company", json={"passcode_expiry_days": new_days}).status_code == 200
    row = (db.query(AuditLog).filter(AuditLog.entity_type == "company_settings")
           .order_by(AuditLog.id.desc()).first())
    assert row is not None and "passcode_expiry_days" in row.changes["fields"]


# ---------------------------------------------------------------- ADM-19
def test_adm19_last_superuser_guard_still_holds(db, make_user):
    from app.auth import user_access
    from fastapi import HTTPException

    actor, _ = make_user(is_superuser=True)
    target, _ = make_user(is_superuser=True)
    # Deactivate every other active superuser inside this rolled-back transaction.
    db.query(User).filter(User.is_superuser.is_(True), User.id != target.id).update({"is_active": False})
    db.flush()
    with pytest.raises(HTTPException) as exc:
        user_access.assert_can_set_active(db, actor, target, False)
    assert exc.value.status_code == 400
