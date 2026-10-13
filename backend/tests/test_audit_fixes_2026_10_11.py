"""Regression tests for the Medium findings of the 2026-10-11 QA audit."""
import uuid

import pytest

API = "/api/v1"


def _u() -> str:
    return uuid.uuid4().hex[:8]


# --- NUL characters are a clean 422, never a 500 ---------------------------------
@pytest.mark.parametrize("path", ["/branches/", "/groups/", "/common/locations"])
def test_nul_in_json_body_is_422(superclient, path):
    r = superclient.post(f"{API}{path}", json={"name": "a\x00b", "branch_name": "a\x00b", "branch_code": "X"})
    assert r.status_code == 422, r.text


def test_nul_in_nested_json_value_is_422(superclient):
    r = superclient.post(f"{API}/groups/", json={"name": "ok", "permission_ids": [], "x": {"y": ["a\x00"]}})
    assert r.status_code == 422


def test_nul_in_query_string_is_422(superclient):
    assert superclient.get(f"{API}/users/paged?q=%00").status_code == 422


def test_text_that_merely_spells_a_nul_escape_is_accepted(superclient):
    """The two characters backslash-u-0-0-0-0 are ordinary text, not a NUL."""
    r = superclient.post(f"{API}/groups/", json={"name": f"QA {_u()} \\u0000", "permission_ids": []})
    assert r.status_code != 422 or "NUL" not in r.text


# --- the two contact numbers stay different on a partial update ------------------
def test_customer_partial_update_cannot_copy_the_other_number(superclient):
    body = {
        "customer_type": "business", "company_name": f"QA Co {_u()}", "customer_name": f"QA Co {_u()}",
        "mobile_contact_number": "+94771234567",
    }
    created = superclient.post(f"{API}/customers/", json=body)
    assert created.status_code == 201, created.text
    cid = created.json()["id"]

    same = superclient.put(f"{API}/customers/{cid}", json={"home_contact_number": "0771234567"})
    assert same.status_code == 422, same.text

    other = superclient.put(f"{API}/customers/{cid}", json={"home_contact_number": "+94712345678"})
    assert other.status_code == 200, other.text


def test_supplier_partial_update_cannot_copy_the_other_number(superclient, make_supplier):
    supplier = make_supplier()
    stored_mobile = supplier.mobile_contact_number
    r = superclient.patch(f"{API}/purchasing/suppliers/{supplier.id}", json={"home_contact_number": stored_mobile})
    assert r.status_code == 422, r.text


# --- users are branch scoped ------------------------------------------------------
@pytest.fixture
def scoped(make_user, make_branch):
    b1, b2 = make_branch(), make_branch()
    manager, token = make_user(
        permissions=[("users", "view"), ("users", "update")], branches=[b1]
    )
    same_branch, _ = make_user(branches=[b1])
    other_branch, _ = make_user(branches=[b2])
    root, _ = make_user(is_superuser=True, branches=[b1])
    return manager, token, same_branch, other_branch, root


def test_user_list_only_shows_own_branch_users(api, scoped):
    manager, token, same_branch, other_branch, root = scoped
    r = api(token).get(f"{API}/users/?limit=1000")
    assert r.status_code == 200
    ids = {u["id"] for u in r.json()}
    assert same_branch.id in ids and manager.id in ids
    assert other_branch.id not in ids
    assert root.id not in ids


def test_paged_user_list_is_scoped(api, scoped):
    manager, token, same_branch, other_branch, root = scoped
    r = api(token).get(f"{API}/users/paged?size=200")
    ids = {u["id"] for u in r.json()["items"]}
    assert same_branch.id in ids and other_branch.id not in ids


def test_reading_another_branchs_user_or_a_superuser_is_404(api, scoped):
    manager, token, same_branch, other_branch, root = scoped
    client = api(token)
    assert client.get(f"{API}/users/{same_branch.id}").status_code == 200
    assert client.get(f"{API}/users/{other_branch.id}").status_code == 404
    assert client.get(f"{API}/users/{root.id}").status_code == 404


def test_editing_another_branchs_user_is_403(api, scoped):
    manager, token, same_branch, other_branch, root = scoped
    r = api(token).put(f"{API}/users/{other_branch.id}", json={"first_name": "Hacked"})
    assert r.status_code == 403, r.text


# --- branches: only a branch's own members may edit it -----------------------------
def test_editing_another_branch_is_403(api, make_user, make_branch):
    mine, theirs = make_branch(), make_branch()
    _manager, token = make_user(permissions=[("branches", "update")], branches=[mine])
    r = api(token).put(f"{API}/branches/{theirs.id}", json={"branch_name": "Renamed by outsider"})
    assert r.status_code == 403, r.text
