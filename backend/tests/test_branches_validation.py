"""Branch input validation, case-insensitive uniqueness and structured address."""
import uuid

import pytest

URL = "/api/v1/branches/"


def _u() -> str:
    return uuid.uuid4().hex[:8]


def _body(**kw):
    u = _u()
    return {"branch_name": f"QA Branch {u}", "branch_code": f"QB{u}", **kw}


# --- blank / whitespace / length -------------------------------------------------
@pytest.mark.parametrize("field", ["branch_name", "branch_code"])
@pytest.mark.parametrize("value", ["", "   ", "\t\n"])
def test_create_rejects_blank(superclient, field, value):
    assert superclient.post(URL, json=_body(**{field: value})).status_code == 422


@pytest.mark.parametrize("field", ["branch_name", "branch_code"])
def test_create_rejects_over_255(superclient, field):
    assert superclient.post(URL, json=_body(**{field: "x" * 256})).status_code == 422


@pytest.mark.parametrize("field", ["branch_name", "branch_code"])
def test_create_accepts_exactly_255(superclient, field):
    assert superclient.post(URL, json=_body(**{field: "x" * 250 + _u()[:5]})).status_code == 201


def test_create_trims_name_and_code(superclient):
    u = _u()
    r = superclient.post(URL, json={"branch_name": f"  Trim {u}  ", "branch_code": f" T{u} "})
    assert r.status_code == 201
    assert r.json()["branch_name"] == f"Trim {u}"
    assert r.json()["branch_code"] == f"T{u}"


@pytest.mark.parametrize(
    "body",
    [
        {"address": "a" * 1001},
        {"address_line1": "a" * 256},
        {"address_line2": "a" * 256},
        {"city": "a" * 121},
        {"state": "a" * 121},
        {"postal_code": "1" * 21},
        {"email": "a" * 70 + "@x.com"},
    ],
)
def test_create_rejects_over_long_optional_fields(superclient, body):
    assert superclient.post(URL, json=_body(**body)).status_code == 422


# --- case / whitespace-insensitive uniqueness ------------------------------------
def test_duplicate_name_is_case_and_space_insensitive(superclient):
    base = _body()
    assert superclient.post(URL, json=base).status_code == 201
    for variant in (base["branch_name"].upper(), base["branch_name"].lower(), base["branch_name"] + " "):
        r = superclient.post(URL, json=_body(branch_name=variant))
        assert r.status_code == 400, variant
        assert "name" in r.json()["detail"].lower()


def test_duplicate_code_is_case_insensitive(superclient):
    base = _body()
    assert superclient.post(URL, json=base).status_code == 201
    r = superclient.post(URL, json=_body(branch_code=base["branch_code"].lower()))
    assert r.status_code == 400 and "code" in r.json()["detail"].lower()


def test_duplicate_email_is_case_insensitive_and_stored_lowercase(superclient):
    u = _u()
    first = superclient.post(URL, json=_body(email=f"Br{u}@Example.COM"))
    assert first.status_code == 201
    assert first.json()["email"] == f"br{u}@example.com"
    r = superclient.post(URL, json=_body(email=f"BR{u}@example.com"))
    assert r.status_code == 400 and "email" in r.json()["detail"].lower()


def test_check_endpoints_are_case_insensitive(superclient):
    base = _body()
    superclient.post(URL, json=base)
    assert superclient.get(f"{URL}check-code/{base['branch_code'].lower()}").json()["exists"] is True
    assert superclient.get(f"{URL}check-name/{base['branch_name'].upper()}").json()["exists"] is True


# --- update ----------------------------------------------------------------------
def _make(superclient, **kw):
    r = superclient.post(URL, json=_body(**kw))
    assert r.status_code == 201
    return r.json()


@pytest.mark.parametrize("body", [{"branch_name": ""}, {"branch_name": "   "}, {"branch_name": None}, {"active": None}, {"branch_name": "x" * 256}])
def test_update_rejects_bad_values(superclient, body):
    b = _make(superclient)
    assert superclient.put(f"{URL}{b['id']}", json=body).status_code == 422


def test_update_empty_body_is_noop(superclient):
    b = _make(superclient)
    r = superclient.put(f"{URL}{b['id']}", json={})
    assert r.status_code == 200 and r.json()["branch_name"] == b["branch_name"]


def test_update_duplicate_name_case_insensitive(superclient):
    a, b = _make(superclient), _make(superclient)
    r = superclient.put(f"{URL}{a['id']}", json={"branch_name": b["branch_name"].upper()})
    assert r.status_code == 400


def test_update_ignores_mass_assignment(superclient):
    b = _make(superclient)
    r = superclient.put(f"{URL}{b['id']}", json={"branch_code": "HACKED", "id": 1, "created_by": 999, "address_line1": "x"})
    assert r.status_code == 200
    assert r.json()["branch_code"] == b["branch_code"] and r.json()["id"] == b["id"]


# --- ids -------------------------------------------------------------------------
@pytest.mark.parametrize("bad_id", [0, -1, 2**31, 2**40])
def test_out_of_range_ids_are_422_not_500(superclient, bad_id):
    assert superclient.get(f"{URL}{bad_id}").status_code == 422
    assert superclient.put(f"{URL}{bad_id}", json={"address_line1": "x"}).status_code == 422
    assert superclient.get(f"{URL}{bad_id}/performance").status_code == 422


def test_unknown_in_range_id_is_404(superclient):
    assert superclient.get(f"{URL}2147483647").status_code == 404


def test_exclude_id_out_of_range_is_422(superclient):
    assert superclient.get(f"{URL}check-code/abc", params={"exclude_id": 2**40}).status_code == 422


# --- structured address ----------------------------------------------------------
def test_structured_address_roundtrip_and_legacy_sync(superclient):
    b = _make(superclient, address_line1="1/108 Palawatha Rd", address_line2="Near Fort", city="Matara", state="Southern", postal_code="81000")
    assert b["city"] == "Matara" and b["postal_code"] == "81000"
    assert b["address"] == "1/108 Palawatha Rd, Near Fort, Matara, Southern, 81000"


def test_update_address_part_recomposes_legacy_address(superclient):
    b = _make(superclient, address_line1="L1", city="Colombo")
    r = superclient.put(f"{URL}{b['id']}", json={"city": "Kandy"})
    assert r.json()["address"] == "L1, Kandy" and r.json()["address_line1"] == "L1"
    cleared = superclient.put(f"{URL}{b['id']}", json={"address_line1": None, "city": None})
    assert cleared.json()["address"] is None


def test_legacy_address_only_client_still_works(superclient):
    b = _make(superclient, address="Old style one line address")
    assert b["address"] == "Old style one line address"
    assert b["address_line1"] == "Old style one line address"


def test_legacy_blank_rows_still_serialize(superclient, db):
    """Rows created before validation existed (blank name) must not break the list."""
    from app.auth.models import Branch

    # Whitespace-only, with a length unlikely to collide with pre-existing rows.
    blank = " " * (5 + uuid.uuid4().int % 240)
    db.add(Branch(branch_name=blank, branch_code=f"LEG{_u()}", active=False))
    db.flush()
    r = superclient.get(URL, params={"page": 1, "size": 100000})
    assert r.status_code == 200


# --- list pagination totals ------------------------------------------------------
def test_list_total_respects_active_only(superclient):
    active = _make(superclient)
    inactive = _make(superclient)
    superclient.put(f"{URL}{inactive['id']}", json={"active": False})

    everything = superclient.get(URL, params={"page": 1, "size": 100000}).json()
    only_active = superclient.get(URL, params={"page": 1, "size": 100000, "active_only": True}).json()

    assert only_active["total"] == len(only_active["items"])
    assert all(b["active"] for b in only_active["items"])
    assert only_active["total"] < everything["total"]
    assert everything["total"] == len(everything["items"])
    assert active["id"] in {b["id"] for b in only_active["items"]}
    assert inactive["id"] not in {b["id"] for b in only_active["items"]}


def test_list_pages_count_matches_filtered_total(superclient):
    for _ in range(3):
        _make(superclient)
    r = superclient.get(URL, params={"page": 1, "size": 2, "active_only": True}).json()
    assert r["pages"] == (r["total"] + 1) // 2 and len(r["items"]) == 2
