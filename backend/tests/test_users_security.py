"""Users module: privilege-escalation guards, input validation, uniqueness, uploads."""
import uuid

import pytest

from app.auth.models import Group, Permission, User
from app.core.password_policy import validate_password_strength

URL = "/api/v1/users/"
GOOD_PW = "Qa!Pass#2026"


def _u() -> str:
    return uuid.uuid4().hex[:8]


def _perm(db, resource, action):
    p = db.query(Permission).filter(Permission.resource == resource, Permission.action == action).first()
    if p is None:
        p = Permission(name=f"{resource}.{action}.{_u()}", resource=resource, action=action)
        db.add(p)
        db.flush()
    return p


@pytest.fixture
def make_group(db):
    def _make(*perms):
        g = Group(name=f"QA-Role-{_u()}")
        g.permissions = [_perm(db, r, a) for r, a in perms]
        db.add(g)
        db.flush()
        return g

    return _make


@pytest.fixture
def branch(make_branch):
    return make_branch()


def _body(branch, group, **kw):
    u = _u()
    return {
        "username": f"qa_{u}",
        "email": f"qa.{u}@example.com",
        "first_name": "QA",
        "last_name": "Tester",
        "password": GOOD_PW,
        "employee_id": f"QA{u}",
        "branch_ids": [branch.id],
        "group_ids": [group.id],
        **kw,
    }


@pytest.fixture
def role(make_group):
    return make_group(("sales", "view"))


def _create(superclient, branch, role, **kw):
    r = superclient.post(URL, json=_body(branch, role, **kw))
    assert r.status_code == 201, r.text
    return r.json()


# ===================================================================== escalation
class TestPrivilegeEscalation:
    @pytest.fixture
    def manager(self, make_user, branch):
        """A user-manager: users:view + users:update + users:create and nothing else."""
        return make_user(
            permissions=[("users", "view"), ("users", "update"), ("users", "create")], branches=[branch]
        )

    def test_cannot_grant_a_role_with_more_permissions(self, client, api, manager, make_user, make_group, branch):
        admin_like = make_group(("users", "update"), ("finance", "approve"))
        target, _ = make_user(branches=[branch])
        _, token = manager
        r = api(token).put(f"{URL}{target.id}", json={"group_ids": [admin_like.id]})
        assert r.status_code == 403
        assert "cannot assign" in r.json()["detail"].lower()

    def test_cannot_change_own_roles_even_to_a_weaker_one(self, client, api, manager, make_group):
        weak = make_group(("users", "view"))
        user, token = manager
        r = api(token).put(f"{URL}{user.id}", json={"group_ids": [weak.id]})
        assert r.status_code == 403

    def test_cannot_change_own_branches(self, client, api, manager, make_branch):
        user, token = manager
        r = api(token).put(f"{URL}{user.id}", json={"branch_ids": [make_branch().id]})
        assert r.status_code == 403

    def test_can_grant_a_role_within_own_permissions(self, client, api, manager, make_user, make_group, branch):
        within = make_group(("users", "view"))
        target, _ = make_user(branches=[branch])
        _, token = manager
        assert api(token).put(f"{URL}{target.id}", json={"group_ids": [within.id]}).status_code == 200

    def test_cannot_assign_a_branch_they_do_not_belong_to(self, client, api, manager, make_user, make_branch, branch):
        target, _ = make_user(branches=[branch])
        _, token = manager
        r = api(token).put(f"{URL}{target.id}", json={"branch_ids": [make_branch().id]})
        assert r.status_code == 403

    def test_cannot_modify_a_superuser(self, client, api, manager, superuser):
        target, _ = superuser
        _, token = manager
        c = api(token)
        assert c.put(f"{URL}{target.id}", json={"first_name": "Hacked"}).status_code == 403
        assert c.put(f"{URL}{target.id}", json={"password": GOOD_PW}).status_code == 403
        assert c.post(f"{URL}{target.id}/unblock").status_code == 403
        assert c.post(f"{URL}{target.id}/force-password-reset").status_code == 403
        assert c.delete(f"{URL}{target.id}/profile-picture").status_code == 403

    def test_cannot_modify_a_more_privileged_user(self, client, api, manager, make_user, branch):
        target, _ = make_user(permissions=[("users", "view"), ("finance", "approve")], branches=[branch])
        _, token = manager
        assert api(token).put(f"{URL}{target.id}", json={"first_name": "X"}).status_code == 403

    def test_can_still_edit_an_ordinary_user(self, client, api, manager, make_user, branch):
        target, _ = make_user(branches=[branch])
        _, token = manager
        r = api(token).put(f"{URL}{target.id}", json={"occupation": "Clerk"})
        assert r.status_code == 200 and r.json()["occupation"] == "Clerk"

    def test_cannot_create_a_user_with_a_higher_role(self, client, api, manager, make_group, branch):
        higher = make_group(("users", "update"), ("finance", "approve"))
        _, token = manager
        assert api(token).post(URL, json=_body(branch, higher)).status_code == 403

    def test_cannot_create_a_user_in_a_foreign_branch(self, client, api, manager, make_group, make_branch):
        within = make_group(("users", "view"))
        _, token = manager
        assert api(token).post(URL, json=_body(make_branch(), within)).status_code == 403

    def test_superuser_may_assign_any_role(self, superclient, role, make_user, branch, make_group):
        big = make_group(("users", "update"), ("finance", "approve"))
        target, _ = make_user(branches=[branch])
        assert superclient.put(f"{URL}{target.id}", json={"group_ids": [big.id]}).status_code == 200


class TestDeactivation:
    def test_nobody_deactivates_their_own_account(self, superclient, superuser):
        me, _ = superuser
        r = superclient.put(f"{URL}{me.id}", json={"is_active": False})
        assert r.status_code == 400 and "own account" in r.json()["detail"]

    def test_last_active_superuser_cannot_be_deactivated(self, superclient, superuser, make_user, db):
        from app.auth import user_access

        actor, _ = make_user(permissions=[("users", "update")])
        target, _ = superuser
        db.query(User).filter(User.is_superuser.is_(True), User.id != target.id).update(
            {User.is_active: False}, synchronize_session=False
        )
        db.flush()
        with pytest.raises(Exception) as exc:
            user_access.assert_can_set_active(db, actor, target, False)
        assert "last active superuser" in str(exc.value.detail)


# ===================================================================== validation
class TestCreateValidation:
    @pytest.mark.parametrize("field", ["username", "first_name", "last_name", "employee_id"])
    @pytest.mark.parametrize("value", ["", "   "])
    def test_blank_required_text_rejected(self, superclient, branch, role, field, value):
        assert superclient.post(URL, json=_body(branch, role, **{field: value})).status_code == 422

    @pytest.mark.parametrize("username", ["has space", "a/b", "a\\b"])
    def test_bad_username_rejected(self, superclient, branch, role, username):
        assert superclient.post(URL, json=_body(branch, role, username=username)).status_code == 422

    @pytest.mark.parametrize("emp", ["ab", "has space", "x@y", "é1234"])
    def test_employee_id_format(self, superclient, branch, role, emp):
        assert superclient.post(URL, json=_body(branch, role, employee_id=emp)).status_code == 422

    @pytest.mark.parametrize(
        "pw",
        ["Abc!123", "12345678", "password", "        ", "alllowercase1!", "ALLUPPERCASE1!", "NoDigits!!", "NoSpecial123", "Aa1!" * 19],
    )
    def test_weak_passwords_rejected(self, superclient, branch, role, pw):
        assert superclient.post(URL, json=_body(branch, role, password=pw)).status_code == 422

    def test_password_equal_to_username_rejected(self, superclient, branch, role):
        assert superclient.post(URL, json=_body(branch, role, username="Qa!Pass#2026", password="Qa!Pass#2026")).status_code == 422

    def test_blank_optional_dates_and_text_are_accepted_as_empty(self, superclient, branch, role):
        """The UI sends "" for untouched optional fields (this used to 422)."""
        user = _create(superclient, branch, role, birthdate="", gender="", middle_name="", occupation="", phone_number="", date_joined="")
        assert user["birthdate"] is None and user["gender"] is None

    @pytest.mark.parametrize("extra", [{"birthdate": "1800-01-01"}, {"birthdate": "2999-01-01"}, {"birthdate": "2000-01-01", "date_joined": "1990-01-01"}])
    def test_implausible_dates_rejected(self, superclient, branch, role, extra):
        assert superclient.post(URL, json=_body(branch, role, **extra)).status_code == 422

    def test_values_are_trimmed_and_email_lowercased(self, superclient, branch, role):
        u = _u()
        user = _create(superclient, branch, role, username=f"  qa_trim_{u}  ", first_name="  Ann ", email=f"  Ann.{u}@Example.COM ")
        assert user["username"] == f"qa_trim_{u}" and user["first_name"] == "Ann"
        assert user["email"] == f"ann.{u}@example.com"

    def test_mass_assignment_ignored(self, superclient, branch, role):
        user = _create(superclient, branch, role, is_superuser=True, blocked=True, must_change_password=True, id=1)
        assert user["is_superuser"] is False and user["blocked"] is False and user["id"] != 1


class TestUpdateValidation:
    @pytest.fixture
    def target(self, superclient, branch, role):
        return _create(superclient, branch, role)

    @pytest.mark.parametrize("body", [{"username": ""}, {"username": None}, {"first_name": "   "}, {"is_active": None}, {"is_staff": None}, {"username": "a b"}])
    def test_required_fields_cannot_be_blank_or_null(self, superclient, target, body):
        assert superclient.put(f"{URL}{target['id']}", json=body).status_code == 422

    @pytest.mark.parametrize("pw", ["a", "whitespace   ", "        ", "12345678", "NoSpecial123"])
    def test_weak_password_update_rejected(self, superclient, target, pw):
        assert superclient.put(f"{URL}{target['id']}", json={"password": pw}).status_code == 422

    def test_empty_password_means_unchanged(self, superclient, target):
        assert superclient.put(f"{URL}{target['id']}", json={"password": ""}).status_code == 200

    def test_strong_password_update_accepted(self, superclient, target):
        assert superclient.put(f"{URL}{target['id']}", json={"password": "N3w!Passw0rd"}).status_code == 200

    def test_blank_optional_values_clear_the_field(self, superclient, target):
        r = superclient.put(f"{URL}{target['id']}", json={"birthdate": "", "gender": "", "occupation": ""})
        assert r.status_code == 200 and r.json()["birthdate"] is None

    def test_date_joined_before_stored_birthdate_rejected(self, superclient, target):
        superclient.put(f"{URL}{target['id']}", json={"birthdate": "2000-01-01"})
        r = superclient.put(f"{URL}{target['id']}", json={"date_joined": "1990-01-01"})
        assert r.status_code in (400, 422)

    @pytest.mark.parametrize("bad_id", [0, -1, 2**31, 2**40])
    def test_out_of_range_ids_are_422(self, superclient, bad_id):
        assert superclient.put(f"{URL}{bad_id}", json={"occupation": "x"}).status_code == 422
        assert superclient.get(f"{URL}{bad_id}").status_code == 422

    def test_unknown_user_is_404(self, superclient):
        assert superclient.put(f"{URL}2147483647", json={"occupation": "x"}).status_code == 404


class TestUniquenessAndReferences:
    def test_username_email_employee_id_are_case_insensitive(self, superclient, branch, role):
        base = _create(superclient, branch, role)
        full = {"username": base["username"], "email": base["email"], "employee_id": base["employee_id"]}
        for field, expect in (("username", "username"), ("email", "email"), ("employee_id", "employee")):
            for variant in (full[field].upper(), full[field] + " "):
                r = superclient.post(URL, json=_body(branch, role, **{field: variant}))
                assert r.status_code in (400, 422), (field, variant, r.text)
                if r.status_code == 400:
                    assert expect in r.json()["detail"].lower()

    def test_update_username_case_variant_of_another_user_rejected(self, superclient, branch, role):
        a, b = _create(superclient, branch, role), _create(superclient, branch, role)
        r = superclient.put(f"{URL}{a['id']}", json={"username": b["username"].upper()})
        assert r.status_code == 400

    def test_check_endpoints_are_case_insensitive(self, superclient, branch, role):
        base = _create(superclient, branch, role)
        assert superclient.get(f"{URL}check-username/{base['username'].upper()}").json()["exists"] is True
        assert superclient.get(f"{URL}check-employee-id/{base['employee_id'].lower()}").json()["exists"] is True

    def test_unknown_role_rejected_with_a_clear_message(self, superclient, branch, role):
        r = superclient.post(URL, json=_body(branch, role, group_ids=[2_000_000_000]))
        assert r.status_code == 400 and "role not found" in r.json()["detail"].lower()

    def test_unknown_branch_rejected_with_a_clear_message(self, superclient, branch, role):
        r = superclient.post(URL, json=_body(branch, role, branch_ids=[2_000_000_000]))
        assert r.status_code == 400 and "branch not found" in r.json()["detail"].lower()

    def test_inactive_branch_cannot_be_assigned(self, superclient, role, make_branch):
        inactive = make_branch()
        superclient.put(f"/api/v1/branches/{inactive.id}", json={"active": False})
        r = superclient.post(URL, json=_body(inactive, role))
        assert r.status_code == 400 and "inactive" in r.json()["detail"].lower()

    def test_already_assigned_inactive_branch_can_stay(self, superclient, role, make_branch, branch):
        later_inactive = make_branch()
        user = _create(superclient, branch, role, branch_ids=[branch.id, later_inactive.id])
        superclient.put(f"/api/v1/branches/{later_inactive.id}", json={"active": False})
        r = superclient.put(f"{URL}{user['id']}", json={"branch_ids": [branch.id, later_inactive.id]})
        assert r.status_code == 200

    def test_update_with_unknown_ids_rejected(self, superclient, branch, role):
        user = _create(superclient, branch, role)
        assert superclient.put(f"{URL}{user['id']}", json={"group_ids": [2_000_000_000]}).status_code == 400
        assert superclient.put(f"{URL}{user['id']}", json={"branch_ids": [2_000_000_000]}).status_code == 400

    def test_duplicate_ids_are_collapsed(self, superclient, branch, role):
        user = _create(superclient, branch, role, branch_ids=[branch.id, branch.id], group_ids=[role.id, role.id])
        assert len(user["branches"]) == 1 and len(user["groups"]) == 1


# ===================================================================== uploads
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc000000301010018dd8db00000000049454e44ae426082"
)


class TestProfilePicture:
    @pytest.fixture
    def target(self, superclient, branch, role):
        return _create(superclient, branch, role)

    def _post(self, client, user_id, name, mime, data):
        return client.post(f"{URL}{user_id}/profile-picture", files={"file": (name, data, mime)})

    def test_real_png_accepted(self, superclient, target):
        r = self._post(superclient, target["id"], "a.png", "image/png", PNG)
        assert r.status_code == 200 and r.json()["profile_picture_path"].endswith(".png")

    @pytest.mark.parametrize("data", [b"<?php echo 1; ?>", b"<html><script>alert(1)</script></html>", b"MZ\x90\x00"])
    def test_non_image_content_rejected_even_with_image_type(self, superclient, target, data):
        assert self._post(superclient, target["id"], "evil.png", "image/png", data).status_code == 400

    def test_svg_not_allowed_for_avatars(self, superclient, target):
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>'
        assert self._post(superclient, target["id"], "a.svg", "image/svg+xml", svg).status_code == 400

    def test_unknown_user_is_404_and_leaves_no_file(self, superclient):
        from pathlib import Path

        from app.core.config import settings

        folder = Path(settings.UPLOAD_DIR) / "users"
        before = set(folder.glob("*")) if folder.exists() else set()
        assert self._post(superclient, 2_000_000_000, "a.png", "image/png", PNG).status_code == 404
        after = set(folder.glob("*")) if folder.exists() else set()
        assert after == before


class TestSvgSanitising:
    """save_image is shared (supplier / company logos): SVG stays allowed but not active content."""

    def _save(self, data, allow_svg=True):
        import io

        from fastapi import UploadFile
        from starlette.datastructures import Headers

        from app.common.file_storage import save_image

        up = UploadFile(file=io.BytesIO(data), filename="x.svg", headers=Headers({"content-type": "image/svg+xml"}))
        return save_image(up, subdir="qa_tmp", allow_svg=allow_svg)

    @pytest.mark.parametrize(
        "svg",
        [
            b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
            b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
            b'<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><circle r="1"/></a></svg>',
            b'<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>',
        ],
    )
    def test_active_content_rejected(self, svg):
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc:
            self._save(svg)
        assert exc.value.status_code == 400

    def test_plain_svg_still_accepted_for_logos(self):
        from app.common.file_storage import delete_file

        path = self._save(b'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle r="4"/></svg>')
        assert path.endswith(".svg")
        delete_file(path)


# ===================================================================== password policy unit
class TestPasswordPolicy:
    def test_accepts_a_strong_password(self):
        assert validate_password_strength("N3w!Passw0rd", "someone") == "N3w!Passw0rd"

    @pytest.mark.parametrize("pw", ["Short1!", "alllower1!", "ALLUPPER1!", "NoNumber!!", "NoSpecial1A", "        ", "Aa1!" * 19])
    def test_rejects_weak(self, pw):
        with pytest.raises(ValueError):
            validate_password_strength(pw)

    def test_change_password_schema_uses_the_same_policy(self):
        from pydantic import ValidationError

        from app.modules.settings.schemas import PasswordChange

        with pytest.raises(ValidationError):
            PasswordChange(current_password="x", new_password="12345678", confirm_password="12345678")
        assert PasswordChange(current_password="x", new_password="N3w!Passw0rd", confirm_password="N3w!Passw0rd")
