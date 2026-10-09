"""The per-request user load is cached for a few seconds; changes must still bite at once."""
from app.auth import user_cache


def _perm(db, resource, action):
    from app.auth.models import Permission

    p = db.query(Permission).filter(Permission.resource == resource, Permission.action == action).first()
    assert p is not None, (resource, action)
    return p


def test_second_request_is_served_from_cache(client, make_user, monkeypatch):
    user, token = make_user(permissions=[("users", "view")])
    calls = []
    real = user_cache._fetch
    monkeypatch.setattr(user_cache, "_fetch", lambda db, uid: (calls.append(uid), real(db, uid))[1])
    h = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/v1/users/me", headers=h).status_code == 200
    assert client.get("/api/v1/users/me", headers=h).status_code == 200
    assert calls == [user.id]


def test_deactivating_user_takes_effect_immediately(client, db, make_user):
    user, token = make_user(permissions=[("users", "view")])
    h = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/v1/users/me", headers=h).status_code == 200  # warms the cache
    user.is_active = False
    db.flush()
    r = client.get("/api/v1/users/me", headers=h)
    assert r.status_code in (401, 403), r.text


def test_removing_a_permission_takes_effect_immediately(client, db, make_user):
    user, token = make_user(permissions=[("users", "view")])
    h = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/v1/users/paged", headers=h).status_code == 200
    for g in list(user.groups):
        g.permissions = []
    user.permissions = []
    db.flush()
    assert client.get("/api/v1/users/paged", headers=h).status_code == 403


def test_cached_objects_are_not_shared_between_requests(client, db, make_user):
    user, token = make_user(permissions=[("users", "view")])
    h = {"Authorization": f"Bearer {token}"}
    client.get("/api/v1/users/me", headers=h)
    cached = user_cache._cache[user.id][1]
    before = cached.first_name
    client.get("/api/v1/users/me", headers=h)
    assert user_cache._cache[user.id][1].first_name == before
