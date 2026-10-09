"""Who may create, change or grant access to whom.

``users:create`` / ``users:update`` alone must not be a path to more privilege
than the caller already holds. Without these rules a user-manager could give
themselves (or anyone) the Admin role, or edit/reset a superuser.
"""
from typing import Iterable, List, Optional, Set, Tuple

from app.auth.models import Branch, Group, Permission, User
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

PermissionKey = Tuple[str, str]


def effective_permissions(user: User) -> Set[PermissionKey]:
    """Every (resource, action) the user holds, directly or through a role."""
    perms: Set[PermissionKey] = {(p.resource, p.action) for p in user.permissions}
    for group in user.groups:
        perms.update((p.resource, p.action) for p in group.permissions)
    return perms


def _forbidden(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def assert_can_manage_user(actor: User, target: User) -> None:
    """Superusers may manage anyone. Everyone else may not touch a superuser
    or a user holding permissions they do not hold themselves."""
    if actor.is_superuser:
        return
    if target.is_superuser:
        raise _forbidden("Only a superuser can modify a superuser account")
    if target.id == actor.id:
        return
    if not effective_permissions(target) <= effective_permissions(actor):
        raise _forbidden("You cannot modify a user who has more privileges than you")


def assert_can_assign_groups(
    db: Session, actor: User, group_ids: Iterable[int], target: Optional[User] = None
) -> None:
    """A non-superuser may only grant roles whose permissions they already
    hold, and may not change their own roles."""
    if actor.is_superuser:
        return
    if target is not None and target.id == actor.id:
        raise _forbidden("You cannot change your own roles")
    ids = list(group_ids)
    if not ids:
        return
    groups: List[Group] = db.query(Group).filter(Group.id.in_(ids)).all()
    allowed = effective_permissions(actor)
    for group in groups:
        needed = {(p.resource, p.action) for p in group.permissions}
        if not needed <= allowed:
            raise _forbidden(f"You cannot assign the role '{group.name}': it grants permissions you do not have")


def assert_can_assign_branches(
    db: Session, actor: User, branch_ids: Iterable[int], target: Optional[User] = None
) -> None:
    """A non-superuser may only assign branches they belong to, and may not
    change their own branch access."""
    if actor.is_superuser:
        return
    if target is not None and target.id == actor.id:
        raise _forbidden("You cannot change your own branch access")
    own = {b.id for b in actor.branches}
    for branch_id in set(branch_ids):
        if branch_id not in own:
            raise _forbidden("You can only assign branches you belong to")


def assert_can_set_active(db: Session, actor: User, target: User, is_active: bool) -> None:
    """Nobody deactivates their own account, and the last active superuser
    can never be deactivated (that would lock everyone out)."""
    if is_active:
        return
    if target.id == actor.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot deactivate your own account")
    if target.is_superuser:
        others = (
            db.query(User)
            .filter(User.is_superuser.is_(True), User.is_active.is_(True), User.id != target.id)
            .count()
        )
        if others == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The last active superuser cannot be deactivated",
            )


def load_branches(db: Session, branch_ids: Iterable[int], already_assigned: Iterable[int] = ()) -> List[Branch]:
    """Resolve branch ids, rejecting unknown ids and (newly assigned) inactive branches."""
    ids = list(dict.fromkeys(branch_ids))
    branches = db.query(Branch).filter(Branch.id.in_(ids)).all() if ids else []
    found = {b.id for b in branches}
    missing = [i for i in ids if i not in found]
    if missing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Branch not found: {missing}")
    keep = set(already_assigned)
    for b in branches:
        if not b.active and b.id not in keep:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Branch '{b.branch_name.strip() or b.branch_code}' is inactive and cannot be assigned",
            )
    return branches


def load_groups(db: Session, group_ids: Iterable[int]) -> List[Group]:
    """Resolve role ids, rejecting unknown ones."""
    ids = list(dict.fromkeys(group_ids))
    groups = db.query(Group).filter(Group.id.in_(ids)).all() if ids else []
    found = {g.id for g in groups}
    missing = [i for i in ids if i not in found]
    if missing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Role not found: {missing}")
    return groups


# ----------------------------------------------------------------------- roles
def assert_can_edit_role(actor: User, group: Group) -> None:
    """A non-superuser may only change a role whose permissions they already
    hold in full. That keeps the Admin role (and any role bigger than the
    caller's own access) out of reach."""
    if actor.is_superuser:
        return
    role_perms = {(p.resource, p.action) for p in group.permissions}
    if not role_perms <= effective_permissions(actor):
        raise _forbidden("You cannot modify a role that grants permissions you do not have")


def assert_can_grant_permissions(actor: User, permissions: Iterable[Permission]) -> None:
    """A non-superuser may only put permissions into a role that they hold
    themselves; otherwise 'groups:update' is a way to grant yourself anything."""
    if actor.is_superuser:
        return
    allowed = effective_permissions(actor)
    denied = sorted(f"{p.resource}:{p.action}" for p in permissions if (p.resource, p.action) not in allowed)
    if denied:
        shown = ", ".join(denied[:5]) + (" …" if len(denied) > 5 else "")
        raise _forbidden(f"You cannot grant permissions you do not have: {shown}")


def load_permissions(db: Session, permission_ids: Iterable[int]) -> List[Permission]:
    """Resolve permission ids, rejecting unknown ones instead of silently dropping them
    (a silent drop on update used to strip a role of all its permissions)."""
    ids = list(dict.fromkeys(permission_ids))
    found = db.query(Permission).filter(Permission.id.in_(ids)).all() if ids else []
    known = {p.id for p in found}
    missing = [i for i in ids if i not in known]
    if missing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Permission not found: {missing}")
    return found
