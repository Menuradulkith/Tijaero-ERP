"""
Foundation smoke tests.

These validate that the QA harness itself works:
* the isolated ``db`` session can create rows,
* the transactional rollback keeps tests independent,
* JWT auth via ``make_user``/``superclient`` is accepted by the real app,
* unauthenticated access is rejected.

If these pass, every module-level test built on the same fixtures is runnable.
"""

from app.auth.models import Branch


class TestHarness:
    def test_db_session_can_create_and_read(self, db, make_branch):
        branch = make_branch(name="Harness Branch", code="HARN1")
        found = db.query(Branch).filter(Branch.id == branch.id).first()
        assert found is not None
        assert found.branch_code == "HARN1"

    def test_rollback_isolates_between_tests_part_a(self, db, make_branch):
        # Create a branch with a fixed code; if rollback works, part_b won't see it.
        make_branch(name="Isolation Probe", code="ISO_PROBE")
        assert (
            db.query(Branch).filter(Branch.branch_code == "ISO_PROBE").count() == 1
        )

    def test_rollback_isolates_between_tests_part_b(self, db):
        # The branch created in part_a must NOT exist here (transaction rolled back).
        assert (
            db.query(Branch).filter(Branch.branch_code == "ISO_PROBE").count() == 0
        )


class TestAuthentication:
    def test_me_requires_authentication(self, client):
        resp = client.get("/api/v1/users/me")
        assert resp.status_code == 401

    def test_superuser_token_is_accepted(self, superclient):
        resp = superclient.get("/api/v1/users/me")
        assert resp.status_code == 200
        body = resp.json()
        assert "username" in body
        assert body.get("is_superuser") is True

    def test_regular_user_token_is_accepted(self, client, make_user):
        _user, token = make_user()
        client.headers.update({"Authorization": f"Bearer {token}"})
        resp = client.get("/api/v1/users/me")
        assert resp.status_code == 200
        assert resp.json().get("is_superuser") is False

    def test_inactive_user_is_forbidden(self, client, make_user):
        _user, token = make_user(is_active=False)
        client.headers.update({"Authorization": f"Bearer {token}"})
        resp = client.get("/api/v1/users/me")
        # get_current_active_user raises 403 for inactive users.
        assert resp.status_code in (401, 403)
