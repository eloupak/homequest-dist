"""Who may do what from which panel (pure Python): the parent's panels and the panels of one child on the parent's phone."""

from __future__ import annotations

from .const import ERR_FORBIDDEN, ERR_NOT_FOUND

VIA_KID_PANEL = "kid_panel"


class AccessError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def resolve(
    *,
    is_admin_user: bool,
    own_kid: str | None,
    kid_ids,
    panel_kid: str | None,
    msg_kid: str | None,
    admin_only: bool,
) -> tuple[bool, str | None, str | None]:
    """Returns (acts_as_parent, kid_id, via).

    A command from a child panel (panel_kid set) acts as that child, never as the parent: parent commands are refused (the UI hiding
    them is not enough), another kid_id is refused, the history gets via=kid_panel. Only an admin user (the parent's phone) or the child's
    own account may use a child panel."""
    if panel_kid is None:
        return is_admin_user, msg_kid, None
    if panel_kid not in kid_ids:
        raise AccessError(ERR_NOT_FOUND, f"unknown kid '{panel_kid}'")
    if not is_admin_user and own_kid != panel_kid:
        raise AccessError(ERR_FORBIDDEN, "this panel is for another kid")
    if admin_only:
        raise AccessError(ERR_FORBIDDEN, "parents only: not from a child panel")
    if msg_kid is not None and msg_kid != panel_kid:
        raise AccessError(ERR_FORBIDDEN, "a child panel acts only for its own kid")
    return False, panel_kid, VIA_KID_PANEL if is_admin_user else None
