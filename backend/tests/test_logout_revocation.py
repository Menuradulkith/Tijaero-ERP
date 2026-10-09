"""Logout must revoke the access token (and refresh token), not just clear the cookie."""
from app.core.security import create_access_token, decode_token, get_password_marker


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_access_token_carries_jti():
    token = create_access_token({"sub": "1", "pwd": "x"})
    payload = decode_token(token)
    assert payload["jti"]
    assert payload["jti"] != decode_token(create_access_token({"sub": "1", "pwd": "x"}))["jti"]


def test_token_rejected_after_logout(client, make_user):
    user, _ = make_user()
    token = create_access_token(
        {"sub": str(user.id), "pwd": get_password_marker(user.hashed_password)}
    )
    assert client.get("/api/v1/users/me", headers=_auth(token)).status_code == 200

    assert client.post("/api/v1/auth/logout", headers=_auth(token)).status_code == 200

    resp = client.get("/api/v1/users/me", headers=_auth(token))
    assert resp.status_code == 401


def test_logout_only_revokes_that_session(client, make_user):
    user, _ = make_user()
    marker = get_password_marker(user.hashed_password)
    first = create_access_token({"sub": str(user.id), "pwd": marker})
    second = create_access_token({"sub": str(user.id), "pwd": marker})

    client.post("/api/v1/auth/logout", headers=_auth(first))

    assert client.get("/api/v1/users/me", headers=_auth(first)).status_code == 401
    assert client.get("/api/v1/users/me", headers=_auth(second)).status_code == 200


def test_logout_without_or_with_bad_token_still_succeeds(client):
    assert client.post("/api/v1/auth/logout").status_code == 200
    assert client.post("/api/v1/auth/logout", headers=_auth("garbage")).status_code == 200


def test_revoked_refresh_token_cannot_refresh(client, make_user):
    from app.core.security import create_refresh_token

    user, _ = make_user()
    refresh = create_refresh_token(
        {"sub": str(user.id), "pwd": get_password_marker(user.hashed_password)}
    )
    client.cookies.set("refresh_token", refresh)
    assert client.post("/api/v1/auth/refresh").status_code == 200

    client.cookies.clear()
    client.cookies.set("refresh_token", refresh)
    client.post("/api/v1/auth/logout")

    client.cookies.clear()
    client.cookies.set("refresh_token", refresh)
    assert client.post("/api/v1/auth/refresh").status_code == 401


def test_revoking_same_token_twice_is_a_noop(db):
    """The loser of a concurrent-logout race inserts the same jti again."""
    from app.auth import token_revocation

    payload = decode_token(create_access_token({"sub": "1", "pwd": "x"}))
    token_revocation.revoke(db, payload)
    token_revocation.revoke(db, payload)  # must not raise
    assert token_revocation.is_revoked(db, payload["jti"])


def test_double_logout_of_same_token_succeeds(client, make_user):
    user, _ = make_user()
    token = create_access_token(
        {"sub": str(user.id), "pwd": get_password_marker(user.hashed_password)}
    )
    assert client.post("/api/v1/auth/logout", headers=_auth(token)).status_code == 200
    assert client.post("/api/v1/auth/logout", headers=_auth(token)).status_code == 200
