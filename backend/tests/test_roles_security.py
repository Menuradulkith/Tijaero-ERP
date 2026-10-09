"""Roles (groups) and the permission catalog: escalation guards, validation, uniqueness."""
import uuid

import pytest
from sqlalchemy.exc import IntegrityError

from app.auth.models import Group, Permission

URL = "/api/v1/groups/"
PERMS = "/api/v1/permissions/"


def _u() -> str:
    return uuid.uuid4().hex[:8]


def _perm(db, resource, action):
    p = db.query(Permission).filter(Permission.resource == resource, Permission.action == action).first()
    if p is None:
        p = Permission(name=f"{action}_{resource}_{_u()}", resource=resource, action=action)
        db.add(p)
        db.flush()
    return p


@pytest.fixture
def make_group(db):
    def _make(*perms, name=None):
        g = Group(name=name or f"QA-Role-{_u()}")
        g.permissions = [_perm(db, r, a) for r, a in perms]
        db.add(g)
        db.flush()
        return g

    return _make


@pytest.fixture
def manager(make_user, make_group, db):
    """A role manager: groups:view/create/update + users:view, via a role they belong to."""
    own_role = make_group(("groups", "view"), ("groups", "create"), ("groups", "update"), ("users", "view"))
    user, token = make_user()
    user.groups.append(own_role)
    db.flush()
    return user, token, own_role


def _ids(db, *perms):
    return [_perm(db, r, a).id for r, a in perms]


# =============================================================== escalation
class TestRoleEscalation:
    def test_cannot_add_permissions_you_do_not_hold_to_your_own_role(self, client, api, db, manager):
        _, token, own_role = manager
        current = [p.id for p in own_role.permissions]
        r = api(token).put(f"{URL}{own_role.id}", json={"permission_ids": current + _ids(db, ("finance", "approve"))})
        assert r.status_code == 403 and "cannot grant" in r.json()["detail"].lower()

    def test_cannot_grant_everything(self, client, api, db, manager):
        _, token, own_role = manager
        everything = [p.id for p in db.query(Permission).all()]
        assert api(token).put(f"{URL}{own_role.id}", json={"permission_ids": everything}).status_code == 403

    def test_cannot_edit_a_role_bigger_than_your_own_access(self, client, api, db, manager, make_group):
        _, token, _ = manager
        big = make_group(("groups", "update"), ("finance", "approve"), ("users", "update"))
        # even a no-op / rename on a role that grants permissions you lack is refused
        assert api(token).put(f"{URL}{big.id}", json={"name": f"renamed-{_u()}"}).status_code == 403
        assert api(token).put(f"{URL}{big.id}", json={"permission_ids": [p.id for p in big.permissions]}).status_code == 403

    def test_cannot_create_a_role_with_permissions_you_lack(self, client, api, db, manager):
        _, token, _ = manager
        r = api(token).post(URL, json={"name": f"QA-{_u()}", "permission_ids": _ids(db, ("finance", "approve"))})
        assert r.status_code == 403

    def test_can_create_and_edit_roles_within_your_own_permissions(self, client, api, db, manager):
        _, token, own_role = manager
        mine = [p.id for p in own_role.permissions]
        created = api(token).post(URL, json={"name": f"QA-{_u()}", "permission_ids": mine[:2]})
        assert created.status_code == 201
        rid = created.json()["id"]
        assert api(token).put(f"{URL}{rid}", json={"permission_ids": mine}).status_code == 200
        assert api(token).put(f"{URL}{rid}", json={"permission_ids": []}).status_code == 200   # removing is always fine

    def test_can_add_a_permission_held_through_another_route(self, client, api, db, make_user, make_group):
        """The ceiling is the caller's *effective* permissions (direct + every role)."""
        role = make_group(("groups", "update"), ("groups", "view"))
        user, token = make_user(permissions=[("sales", "view")])
        user.groups.append(role)
        db.flush()
        r = api(token).put(f"{URL}{role.id}", json={"permission_ids": [p.id for p in role.permissions] + _ids(db, ("sales", "view"))})
        assert r.status_code == 200

    def test_superuser_may_do_anything(self, superclient, db, make_group):
        role = make_group(("users", "view"))
        everything = [p.id for p in db.query(Permission).all()]
        assert superclient.put(f"{URL}{role.id}", json={"permission_ids": everything}).status_code == 200

    def test_user_without_group_permissions_is_refused(self, client, api, make_user, make_group):
        _, token = make_user(permissions=[("users", "view")])
        role = make_group(("users", "view"))
        c = api(token)
        assert c.get(URL).status_code == 403
        assert c.post(URL, json={"name": f"QA-{_u()}", "permission_ids": []}).status_code == 403
        assert c.put(f"{URL}{role.id}", json={"name": "x"}).status_code == 403


class TestPermissionCatalog:
    def test_non_superuser_cannot_add_permissions(self, client, api, make_user):
        _, token = make_user(permissions=[("groups", "create"), ("groups", "view")])
        r = api(token).post(PERMS, json={"name": f"q_{_u()}", "resource": "qa", "action": "anything"})
        assert r.status_code == 403

    def test_superuser_can_add_a_valid_permission(self, superclient):
        u = _u()
        r = superclient.post(PERMS, json={"name": f"anything_qa_{u}", "resource": f"qa_{u}", "action": "anything"})
        assert r.status_code == 201

    @pytest.mark.parametrize(
        "body",
        [
            {"resource": "", "action": "x"},
            {"resource": "   ", "action": "x"},
            {"resource": "x", "action": ""},
            {"resource": "USERS", "action": "view"},   # identifiers are lower-case snake_case
            {"resource": "has space", "action": "view"},
            {"resource": "a/b", "action": "view"},
            {"resource": "x" * 101, "action": "view"},
        ],
    )
    def test_invalid_identifiers_rejected(self, superclient, body):
        assert superclient.post(PERMS, json={"name": f"qa_{_u()}", **body}).status_code == 422

    def test_existing_resource_action_pair_is_rejected(self, superclient, db):
        _perm(db, "users", "view")
        r = superclient.post(PERMS, json={"name": f"another_{_u()}", "resource": "users", "action": "view"})
        assert r.status_code == 400


# =============================================================== validation
class TestRoleValidation:
    @pytest.mark.parametrize("name", ["", "   ", "\t"])
    def test_blank_name_rejected_on_create(self, superclient, name):
        assert superclient.post(URL, json={"name": name, "permission_ids": []}).status_code == 422

    def test_name_length_limit(self, superclient):
        assert superclient.post(URL, json={"name": "x" * 151, "permission_ids": []}).status_code == 422
        assert superclient.post(URL, json={"name": ("y" + _u()).ljust(150, "z"), "permission_ids": []}).status_code == 201

    def test_name_is_trimmed(self, superclient):
        u = _u()
        r = superclient.post(URL, json={"name": f"  QA Trim {u}  "})
        assert r.status_code == 201 and r.json()["name"] == f"QA Trim {u}"

    @pytest.mark.parametrize("body", [{"name": ""}, {"name": "   "}, {"name": None}, {"permission_ids": None}, {"name": "x" * 151}])
    def test_update_rejects_blank_null_and_oversize(self, superclient, make_group, body):
        role = make_group(("users", "view"))
        assert superclient.put(f"{URL}{role.id}", json=body).status_code == 422

    def test_empty_update_changes_nothing(self, superclient, make_group):
        role = make_group(("users", "view"))
        r = superclient.put(f"{URL}{role.id}", json={})
        assert r.status_code == 200 and len(r.json()["permissions"]) == 1

    def test_duplicate_names_are_case_and_space_insensitive(self, superclient):
        base = f"QA-Dup-{_u()}"
        assert superclient.post(URL, json={"name": base}).status_code == 201
        for variant in (base.upper(), base.lower(), f" {base} ", base + " "):
            assert superclient.post(URL, json={"name": variant}).status_code == 400, variant

    def test_rename_to_a_case_variant_is_rejected(self, superclient, make_group):
        a, b = make_group(), make_group()
        assert superclient.put(f"{URL}{a.id}", json={"name": f" {b.name.upper()} "}).status_code == 400

    def test_rename_to_own_name_in_other_case_is_allowed(self, superclient, make_group):
        a = make_group()
        assert superclient.put(f"{URL}{a.id}", json={"name": a.name.upper()}).status_code == 200


class TestRolePermissionIds:
    def test_unknown_ids_rejected_on_create(self, superclient):
        r = superclient.post(URL, json={"name": f"QA-{_u()}", "permission_ids": [2_000_000_000]})
        assert r.status_code == 400 and "permission not found" in r.json()["detail"].lower()

    def test_unknown_ids_on_update_do_not_wipe_the_role(self, superclient, make_group):
        role = make_group(("users", "view"), ("sales", "view"))
        r = superclient.put(f"{URL}{role.id}", json={"permission_ids": [2_000_000_000]})
        assert r.status_code == 400
        assert len(superclient.get(f"{URL}{role.id}").json()["permissions"]) == 2

    @pytest.mark.parametrize("bad", [0, -1, 2**31, 2**40])
    def test_out_of_range_ids_are_422(self, superclient, make_group, bad):
        role = make_group()
        assert superclient.post(URL, json={"name": f"QA-{_u()}", "permission_ids": [bad]}).status_code == 422
        assert superclient.put(f"{URL}{role.id}", json={"permission_ids": [bad]}).status_code == 422

    def test_duplicate_ids_collapse_and_empty_list_clears(self, superclient, db):
        pid = _perm(db, "users", "view").id
        role = superclient.post(URL, json={"name": f"QA-{_u()}", "permission_ids": [pid, pid]}).json()
        assert len(role["permissions"]) == 1
        assert superclient.put(f"{URL}{role['id']}", json={"permission_ids": []}).json()["permissions"] == []

    @pytest.mark.parametrize("bad_id", [0, -1, 2**31, 2**40])
    def test_out_of_range_path_ids_are_422(self, superclient, bad_id):
        assert superclient.get(f"{URL}{bad_id}").status_code == 422
        assert superclient.put(f"{URL}{bad_id}", json={"name": "x"}).status_code == 422

    def test_unknown_role_is_404(self, superclient):
        assert superclient.get(f"{URL}2147483647").status_code == 404
        assert superclient.put(f"{URL}2147483647", json={"name": "x"}).status_code == 404


# =============================================================== no delete
class TestNoDelete:
    def test_roles_cannot_be_deleted_through_the_api(self, superclient, make_group):
        role = make_group()
        assert superclient.delete(f"{URL}{role.id}").status_code == 405
        assert superclient.get(f"{URL}{role.id}").status_code == 200

    def test_branches_have_no_hard_delete(self):
        from app.modules.branches.repository import BranchRepository

        assert not hasattr(BranchRepository, "delete")

    def test_there_is_no_user_or_branch_delete_route(self, superclient, make_branch, make_user):
        user, _ = make_user()
        assert superclient.delete(f"/api/v1/users/{user.id}").status_code == 405
        assert superclient.delete(f"/api/v1/branches/{make_branch().id}").status_code == 405


# =============================================================== database backstop
class TestDatabaseIndexes:
    def test_case_variant_role_names_collide_at_the_database(self, db):
        base = f"QA-Idx-{_u()}"
        db.add(Group(name=base))
        db.flush()
        with pytest.raises(IntegrityError):
            with db.begin_nested():
                db.add(Group(name=f" {base.upper()} "))
                db.flush()

    def test_case_variant_permission_pair_collides_at_the_database(self, db):
        db.add(Permission(name=f"qa_a_{_u()}", resource="qa_idx", action="view"))
        db.flush()
        with pytest.raises(IntegrityError):
            with db.begin_nested():
                db.add(Permission(name=f"qa_b_{_u()}", resource="QA_IDX", action=" View "))
                db.flush()
