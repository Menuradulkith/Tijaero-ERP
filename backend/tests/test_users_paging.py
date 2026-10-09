"""Users: username character rules and the server-side paged list."""
import uuid

import pytest

from app.auth.models import Group

URL = "/api/v1/users/"
GOOD_PW = "Qa!Pass#2026"


def _u() -> str:
    return uuid.uuid4().hex[:8]


@pytest.fixture
def group(db):
    g = Group(name=f"QA-Role-{_u()}")
    db.add(g)
    db.flush()
    return g


def _body(branch, group, **kw):
    u = _u()
    return {"username": f"qa_{u}", "email": f"qa.{u}@example.com", "first_name": "QA", "last_name": "Tester",
            "password": GOOD_PW, "employee_id": f"QA{u}", "branch_ids": [branch.id], "group_ids": [group.id], **kw}


class TestUsernameRules:
    @pytest.mark.parametrize("name", ["<img>", "ユーザー", "a b", "a/b", "a\b", "a;b", "a'b", "a\"b", "a%b", "😀", "a:b"])
    def test_rejected(self, superclient, make_branch, group, name):
        r = superclient.post(URL, json=_body(make_branch(), group, username=name))
        assert r.status_code == 422, (name, r.text[:150])

    @pytest.mark.parametrize("name", ["john.doe", "john_doe", "john-doe", "john@acme.com", "J0hn"])
    def test_accepted(self, superclient, make_branch, group, name):
        name = f"{name}{_u()}"
        r = superclient.post(URL, json=_body(make_branch(), group, username=name))
        assert r.status_code == 201, r.text[:200]

    def test_update_applies_the_same_rule(self, superclient, make_branch, group):
        r = superclient.post(URL, json=_body(make_branch(), group))
        uid = r.json()["id"]
        assert superclient.put(f"{URL}{uid}", json={"username": "<b>x</b>"}).status_code == 422


class TestPagedList:
    @pytest.fixture
    def seeded(self, make_user, make_branch, db):
        tag = _u()
        b1, b2 = make_branch(), make_branch()
        users = []
        for i in range(7):
            u, _t = make_user(branches=[b1 if i < 5 else b2])
            u.username = f"pg{tag}{i}"
            u.email = f"pg{tag}{i}@example.com"
            u.is_active = i != 6
            users.append(u)
        db.flush()
        return {"tag": tag, "b1": b1, "b2": b2}

    def get(self, c, **p):
        r = c.get(f"{URL}paged", params=p)
        assert r.status_code == 200, r.text
        return r.json()

    def test_pages_cover_everything_without_overlap(self, superclient, seeded):
        tag = seeded["tag"]
        p0 = self.get(superclient, q=tag, size=3, page=0)
        assert p0["total"] == 7 and p0["pages"] == 3 and len(p0["items"]) == 3
        names = []
        for pg in range(3):
            names += [x["username"] for x in self.get(superclient, q=tag, size=3, page=pg)["items"]]
        assert len(names) == 7 and len(set(names)) == 7 and names == sorted(names)
        assert self.get(superclient, q=tag, size=3, page=3)["items"] == []

    def test_filters_and_sort(self, superclient, seeded):
        tag = seeded["tag"]
        assert self.get(superclient, q=tag, branch_id=seeded["b2"].id)["total"] == 2
        assert self.get(superclient, q=tag, active="false")["total"] == 1
        assert self.get(superclient, q=tag, active="true")["total"] == 6
        d = self.get(superclient, q=tag, sort_by="username", order="desc", size=1)
        assert d["items"][0]["username"].endswith("6")

    def test_superusers_are_not_listed(self, superclient, superuser):
        user, _t = superuser
        res = self.get(superclient, q=user.username)
        assert all(not x["is_superuser"] for x in res["items"])

    def test_search_is_literal_and_params_bounded(self, superclient, seeded):
        assert self.get(superclient, q="%")["total"] == 0
        assert self.get(superclient, q="\\")["total"] == 0
        for bad in ({"size": 0}, {"size": 201}, {"page": -1}, {"order": "up"}, {"branch_id": 2 ** 40}):
            assert superclient.get(f"{URL}paged", params=bad).status_code == 422
        assert superclient.get(f"{URL}paged", params={"sort_by": "x; drop table accounts_user"}).status_code == 200

    def test_unfiltered_total_matches_plain_list(self, superclient, seeded):
        plain = [u for u in superclient.get(URL, params={"limit": 100000}).json() if not u["is_superuser"]]
        assert self.get(superclient, size=1)["total"] == len(plain)

    def test_plain_list_is_ordered(self, superclient, seeded):
        names = [u["username"].lower() for u in superclient.get(URL, params={"limit": 100000}).json()]
        assert names == sorted(names)

    def test_requires_permission(self, api, make_user):
        _u2, token = make_user(permissions=[])
        assert api(token).get(f"{URL}paged").status_code == 403
