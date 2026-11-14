"""The children, the parents and the first start of a family (v1.6, #136 / #137): pure Python, no Home Assistant imports.

Since v1.6 a child is defined in the game state, not in catalog.yaml: `state["kids"][<slug>]["profile"]` = {name, vocative, ha_user, hero}
(hero = the fixed look the game creates the hero from; None = the child picks it on the hero screen). The slug (the key) stays for ever: it
is the panel /homequest-<slug>, the entity ids of the sensors and the kid_id of the events. The manager builds the old `catalog["kids"]` mapping
from the profiles (kids_catalog), so every rule of the game keeps working on the same shape.

`state["parents"]` = HA user ids who may approve and use the Rodič tab besides the HA admins (an admin is always a parent).
`state["started_at"]` = the game runs; until then a child sees "Tvrz se staví" and the parent the setup guide (Spustit hru).
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from .const import BODY_TYPES, ERR_INVALID_PARAMS, ERR_INVALID_STATE, ERR_NOT_FOUND, HERO_NAME_MAX

MIGRATION_KIDS = "v1.6-kids-in-state"
# the vocatives of the first install's children, written once by the migration (legacy_install.py, not in the public package, v1.7)
try:
    from .legacy_install import LEGACY_VOCATIVE
except ImportError:
    LEGACY_VOCATIVE: dict[str, str] = {}

NAME_MAX = 20
KIDS_MAX = 8
PARENTS_MAX = 10
SLUG_RE = re.compile(r"^[a-z0-9_]+$")
# slugs that would clash with the panels of the integration (/homequest-<slug>)
RESERVED_SLUGS = {"motion", "games", "sounds", "learning", "swing_lab", "swinglab", "3d"}
SETUP_STEPS = ("kids", "accounts", "parents", "place", "notify", "optional")
REQUIRED_STEPS = ("kids", "accounts", "parents", "notify")
START_CONFIRM = "SMAZAT"            # the second confirmation of a clean start over existing children (typed by the parent)


class SetupError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _text(value: Any, what: str, max_len: int = NAME_MAX, required: bool = True) -> str:
    s = " ".join(str(value or "").split()) if isinstance(value, (str, type(None))) else None
    if s is None:
        raise SetupError(ERR_INVALID_PARAMS, f"{what}: a text")
    if required and not s:
        raise SetupError(ERR_INVALID_PARAMS, f"{what}: missing")
    if len(s) > max_len:
        raise SetupError(ERR_INVALID_PARAMS, f"{what}: at most {max_len} characters")
    return s


def slug_for(name: str, taken: Any) -> str:
    """A new child's slug from the name: no diacritics, a-z 0-9 _ (Žofie -> zofie); a taken one gets _2, _3, ..."""
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    base = re.sub(r"[^a-z0-9]+", "_", plain).strip("_")[:20] or "dite"
    if base in RESERVED_SLUGS:
        base = f"dite_{base}"
    slug, n = base, 2
    while slug in taken:
        slug, n = f"{base}_{n}", n + 1
    return slug


# ------------------------------------------------------------- the profiles ----


def kids_catalog(state: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """The children of the game in the old catalog shape {slug: {id, name, vocative, ha_user, hero}}, in the order they were added.
    A state entry without a profile (a child removed from catalog.yaml before v1.6) is not a child of the game, as before."""
    out: dict[str, dict[str, Any]] = {}
    for slug, kid in (state.get("kids") or {}).items():
        prof = kid.get("profile") if isinstance(kid, dict) else None
        if not isinstance(prof, dict):
            continue
        out[slug] = {
            "id": slug,
            "name": prof.get("name") or slug,
            "vocative": prof.get("vocative") or prof.get("name") or slug,
            "ha_user": prof.get("ha_user"),
            "hero": dict(prof["hero"]) if isinstance(prof.get("hero"), dict) else None,
        }
    return out


def migrate_kids(state: dict[str, Any], yaml_kids: dict[str, dict[str, Any]], admin_ids: list[str], ts: str, new_kid: Any) -> bool:
    """One-off (v1.6, #136): the children of catalog.yaml (parsed) become profiles in the state; slugs, coins, items, history stay as they are
    (only `profile` is added). An install that already had children counts as a started game (started_at = now, nothing is reset) and its
    parents are today's HA admins. catalog.yaml keeps its `kids:` (a backup), the game does not read it any more. Idempotent (marker)."""
    done = state.setdefault("migrations", [])
    if MIGRATION_KIDS in done:
        return False
    kids = state.setdefault("kids", {})
    had_game = bool(yaml_kids) or bool(kids)
    for slug, k in yaml_kids.items():
        kid = kids.get(slug)
        if kid is None:
            kid = kids[slug] = new_kid()
        if not isinstance(kid.get("profile"), dict):
            kid["profile"] = {
                "name": k.get("name") or slug,
                "vocative": LEGACY_VOCATIVE.get(slug) or k.get("name") or slug,
                "ha_user": k.get("ha_user"),
                "hero": dict(k["hero"]) if isinstance(k.get("hero"), dict) else None,
            }
    if had_game:
        state.setdefault("started_at", ts)
        state.setdefault("parents", list(dict.fromkeys(admin_ids)))
    else:
        state.setdefault("parents", [])
    done.append(MIGRATION_KIDS)
    return True


def _hero_preset(catalog: dict[str, Any], hero_name: str, body: str, hair: Any = None, skin: Any = None, old: dict[str, Any] | None = None) -> dict[str, Any]:
    """The fixed look of a child's hero from the guide: the hero's name and body (boy / girl), hair and skin from the catalog's choices."""
    if body not in BODY_TYPES:
        raise SetupError(ERR_INVALID_PARAMS, "body: male or female")
    app = catalog.get("appearance") or {}
    styles = [s["id"] for s in app.get("hair_styles") or []]
    skins = list(app.get("skins") or [])
    colors = list(app.get("hair_colors") or [])
    old = old or {}

    def pick(value: Any, allowed: list[str], keep: Any, what: str) -> str:
        if value not in (None, ""):
            if allowed and value not in allowed:
                raise SetupError(ERR_INVALID_PARAMS, f"{what} '{value}' is not available")
            return str(value)
        if keep and (not allowed or keep in allowed):
            return str(keep)
        return allowed[0] if allowed else "default"

    return {
        "name": _text(hero_name, "hero name", HERO_NAME_MAX),
        "body": body,
        "hair": pick(hair, styles, old.get("hair") if old.get("body") == body else None, "hair"),
        "skin": pick(skin, skins, old.get("skin"), "skin"),
        "hair_color": pick(None, colors, old.get("hair_color"), "hair_color"),
    }


def add_kid(state: dict[str, Any], catalog: dict[str, Any], data: dict[str, Any], new_kid: Any) -> dict[str, Any]:
    """A new child from the guide (name, vocative, HA account, hero name, body; hair and skin optional). Returns {kid_id}."""
    profiles = kids_catalog(state)
    if len(profiles) >= KIDS_MAX:
        raise SetupError(ERR_INVALID_PARAMS, f"at most {KIDS_MAX} children")
    name = _text(data.get("name"), "name")
    vocative = _text(data.get("vocative"), "vocative", required=False) or name
    ha_user = _text(data.get("ha_user"), "ha_user", 64, required=False) or None
    if ha_user and any((p.get("ha_user") or "").lower() == ha_user.lower() for p in profiles.values()):
        raise SetupError(ERR_INVALID_PARAMS, "this HA account belongs to another child")
    hero = _hero_preset(catalog, data.get("hero_name") or name, data.get("body"), data.get("hair"), data.get("skin"))
    slug = slug_for(name, set(state.get("kids") or {}) | RESERVED_SLUGS)
    kid = new_kid()
    kid["profile"] = {"name": name, "vocative": vocative, "ha_user": ha_user, "hero": hero}
    state.setdefault("kids", {})[slug] = kid
    return {"kid_id": slug}


def update_kid(state: dict[str, Any], catalog: dict[str, Any], kid_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """The parent edits a child: name, vocative, HA account and the hero's name at any time; body, hair and skin only before the game starts
    (afterwards the clothes and the hairstyle the child owns belong to the body). The slug never changes."""
    kid = (state.get("kids") or {}).get(kid_id)
    if not isinstance(kid, dict) or not isinstance(kid.get("profile"), dict):
        raise SetupError(ERR_NOT_FOUND, f"unknown child '{kid_id}'")
    prof = kid["profile"]
    new = dict(prof)
    if "name" in data:
        new["name"] = _text(data["name"], "name")
    if "vocative" in data:
        new["vocative"] = _text(data["vocative"], "vocative", required=False) or new["name"]
    if "ha_user" in data:
        ha_user = _text(data["ha_user"], "ha_user", 64, required=False) or None
        others = [p for s, p in kids_catalog(state).items() if s != kid_id]
        if ha_user and any((p.get("ha_user") or "").lower() == ha_user.lower() for p in others):
            raise SetupError(ERR_INVALID_PARAMS, "this HA account belongs to another child")
        new["ha_user"] = ha_user
    old_hero = prof.get("hero") or {}
    looks = {k: data[k] for k in ("body", "hair", "skin") if data.get(k) not in (None, "")}
    if looks and state.get("started_at"):
        changed = {k for k, v in looks.items() if old_hero.get(k) != v}
        if changed:
            raise SetupError(ERR_INVALID_STATE, "the hero's body, hair and skin change only before the game starts")
    if "hero_name" in data or (looks and not state.get("started_at")):
        body = looks.get("body") or old_hero.get("body")
        new["hero"] = _hero_preset(catalog, data.get("hero_name") or old_hero.get("name") or new["name"], body, looks.get("hair"), looks.get("skin"), old_hero)
        if not state.get("started_at") and kid.get("hero") and kid["hero"].get("body") != body:
            kid["hero"] = None                     # before the start a new body: the hero is made again with the starter items of that body
            kid["inventory"], kid["equipped"] = [], {}
    kid["profile"] = new
    return {"kid_id": kid_id}


def remove_kid(state: dict[str, Any], kid_id: str) -> dict[str, Any]:
    """Only before the game starts (a mistyped child in the guide); a started game never loses a child's data this way."""
    if state.get("started_at"):
        raise SetupError(ERR_INVALID_STATE, "a child is removed only before the game starts")
    if kid_id not in kids_catalog(state):
        raise SetupError(ERR_NOT_FOUND, f"unknown child '{kid_id}'")
    del state["kids"][kid_id]
    return {"kid_id": kid_id}


# ------------------------------------------------------------------ parents ----


def set_parents(state: dict[str, Any], user_ids: Any, kid_user_ids: set[str]) -> dict[str, Any]:
    """The HA users (ids) who are parents besides the admins. A child's own account cannot be a parent."""
    if not isinstance(user_ids, list) or not all(isinstance(u, str) and u for u in user_ids):
        raise SetupError(ERR_INVALID_PARAMS, "parents: a list of HA user ids")
    clean = list(dict.fromkeys(user_ids))
    if len(clean) > PARENTS_MAX:
        raise SetupError(ERR_INVALID_PARAMS, f"at most {PARENTS_MAX} parents")
    bad = [u for u in clean if u in kid_user_ids]
    if bad:
        raise SetupError(ERR_INVALID_PARAMS, "a child's account cannot be a parent")
    state["parents"] = clean
    return {"parents": clean}


def is_parent(state: dict[str, Any], user_id: str, is_admin: bool) -> bool:
    return bool(is_admin) or user_id in (state.get("parents") or [])


# -------------------------------------------------------------- the guide ----


def mark_step(state: dict[str, Any], step: Any) -> dict[str, Any]:
    """The parent confirmed or skipped a step of the guide (place = the story's places, notify = the phones, ...)."""
    if step not in SETUP_STEPS:
        raise SetupError(ERR_INVALID_PARAMS, f"unknown step {step!r}")
    steps = state.setdefault("setup_steps", [])
    if step not in steps:
        steps.append(step)
    return {"steps": list(steps)}


def has_progress(state: dict[str, Any]) -> bool:
    """Something a clean start would throw away: coins, completed tasks or bought items of any child."""
    for kid in kids_catalog(state):
        k = state["kids"][kid]
        if k.get("coins") or k.get("coins_earned_total") or k.get("tasks_done_total") or any(e.get("type") in ("approved", "bought") for e in k.get("history") or []):
            return True
    return False


def steps_status(state: dict[str, Any], resolved: dict[str, bool]) -> dict[str, bool]:
    """Which steps of the guide are done (the green ticks). resolved = {slug: the child's HA account exists}."""
    profiles = kids_catalog(state)
    marked = set(state.get("setup_steps") or [])
    return {
        "kids": bool(profiles),
        "accounts": bool(profiles) and all(resolved.get(s) for s in profiles),
        "parents": True,                                   # an HA admin is always a parent; more parents are optional
        "place": "place" in marked,
        "notify": "notify" in marked,
        "optional": "optional" in marked,
    }


def can_start(steps: dict[str, bool]) -> bool:
    return all(steps.get(s) for s in REQUIRED_STEPS)


def start_game(state: dict[str, Any], steps: dict[str, bool], confirm: Any, ts: str, fortress_done: Any) -> dict[str, Any]:
    """Spustit hru: the children start from zero (coins, history, tasks of the day, the day's plan, gifts, scenes, sieges) and the fortress
    from zero (state["fortress_baseline"] = the completed tasks counted so far), the hero is made again from its look with the starter items.
    Over existing progress only with the typed second confirmation (START_CONFIRM). Never twice."""
    if state.get("started_at"):
        raise SetupError(ERR_INVALID_STATE, "the game is running already")
    if not can_start(steps):
        missing = [s for s in REQUIRED_STEPS if not steps.get(s)]
        raise SetupError(ERR_INVALID_STATE, "finish the steps first: " + ", ".join(missing))
    if has_progress(state) and confirm != START_CONFIRM:
        raise SetupError("confirm_required", f"the children have coins or completed tasks: type {START_CONFIRM} to start from zero")
    for slug in kids_catalog(state):
        k = state["kids"][slug]
        k.update({"coins": 0, "coins_earned_total": 0, "history": [], "tasks": {}, "inventory": [], "equipped": {}, "hero": None})
        for key in ("gifts", "scenes", "seen", "trophies", "siege_away"):
            k.pop(key, None)
    for key in ("day_plan", "sieges"):
        state.pop(key, None)
    for o in (state.get("oneoffs") or {}).values():
        if isinstance(o, dict) and o.get("status") == "active":
            o["done_by"] = {}                               # a one-off task the parent prepared during the setup stays open for everybody
    state["fortress_baseline"] = 0
    state["fortress_baseline"] = fortress_done(state)       # the counters stay (lifetime); the fortress counts from here
    state["started_at"] = ts
    return {"started_at": ts}
