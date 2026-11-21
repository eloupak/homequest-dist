"""Catalog parsing and validation (pure Python, no Home Assistant imports)."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .const import (
    BODY_TYPES,
    DEFAULT_CLASS,
    OUTFIT_STYLES,
    DEFAULT_REWARD,
    DEFAULT_TIER,
    MATERIALS,
    PERIODS,
    PRICE_RANGE,
    PRICE_STEP,
    RARITIES,
    SLOT_WEIGHT,
    DYE_SLOT,
    ITEM_BODIES,
    ITEM_SLOTS,
    SLOTS,
    TIERS,
)

ID_RE = re.compile(r"^[a-z0-9_]+$")


BODY_ALIASES = {"boy": "male", "girl": "female", "male": "male", "female": "female"}


def default_price(rarity: str, slot: str) -> int:
    """Default shop price: the rarity gives the range, the slot the position in it."""
    lo, hi = PRICE_RANGE.get(rarity, PRICE_RANGE["common"])
    step = PRICE_STEP.get(rarity, 1)
    raw = lo + SLOT_WEIGHT.get(slot, 0.5) * (hi - lo)
    price = int(round(raw / step)) * step
    return max(lo, min(hi, price))


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def preview_items(raw: Any, drafts_raw: Any) -> list[dict[str, Any]]:
    """Shop entries for the art that the import left in catalog.drafts.yaml (TEST instance only, see store.async_load_catalog).

    A draft becomes a free, visible "Náhled: <id>" item so that new art can be tried on the hero before a release. A draft whose id is already in
    catalog.yaml is ignored (the catalog wins); entries that are not mappings or lack id/slot/art are skipped. Never touches the input."""
    have = {it.get("id") for it in ((raw or {}).get("items") or []) if isinstance(it, dict)} if isinstance(raw, dict) else set()
    items = drafts_raw.get("items") if isinstance(drafts_raw, dict) else None
    out: list[dict[str, Any]] = []
    for d in items or []:
        if not isinstance(d, dict) or not d.get("id") or not d.get("slot") or d["id"] in have:
            continue
        item = dict(d)
        item["art"] = item.get("art") or item["id"]
        item["name"] = f"Náhled: {item['id']}" if str(item.get("name", "TODO")).strip().upper() in ("", "TODO") else f"Náhled: {item['name']}"
        item["price"] = 0
        item["shop"] = True
        out.append(item)
        have.add(d["id"])
    return out


def with_previews(raw: Any, previews: list[dict[str, Any]], assets_dir: Path | None = None) -> tuple[dict[str, Any] | None, list[str], list[str]]:
    """catalog.yaml + the preview items. Returns (catalog or None, warnings, skipped messages). None = nothing usable was added (the caller keeps
    the plain catalog). When the whole set does not parse, only the previews that parse on their own are kept; the rest is reported in `skipped`."""
    items = list(raw.get("items") or [])
    cat, errors, warns = parse_catalog({**raw, "items": items + previews}, assets_dir)
    if not errors:
        return cat, warns, []
    good: list[dict[str, Any]] = []
    skipped: list[str] = []
    for pv in previews:
        _c, errs, _w = parse_catalog({**raw, "items": items + [pv]}, assets_dir)
        if errs:
            skipped.append(f"skipped '{pv.get('id')}' (does not fit this code): {'; '.join(errs[:2])}")
        else:
            good.append(pv)
    if not good:
        return None, [], skipped
    cat, errors, warns = parse_catalog({**raw, "items": items + good}, assets_dir)
    return (None, [], skipped) if errors else (cat, warns, skipped)


def parse_catalog(
    raw: Any, assets_dir: Path | None = None
) -> tuple[dict[str, Any], list[str], list[str]]:
    """Validate and normalise a raw catalog dict.

    Returns (catalog, errors, warnings). The catalog must not be used when
    errors is non-empty. Missing layer files are only warnings (assets are
    fetched separately).
    """
    errors: list[str] = []
    warnings: list[str] = []
    cat: dict[str, Any] = {
        "kids": {},
        "tasks": {},
        "classes": {},
        "items": {},
        "appearance": {"skins": [], "hair_colors": [], "hair_styles": []},
    }

    if not isinstance(raw, dict):
        return cat, ["catalog root must be a mapping"], warnings

    def seq(key: str) -> list[Any]:
        value = raw.get(key) or []
        if not isinstance(value, list):
            errors.append(f"'{key}' must be a list")
            return []
        return value

    def new_id(section: str, entry: Any, seen: dict[str, Any]) -> str | None:
        if not isinstance(entry, dict):
            errors.append(f"{section}: entry must be a mapping, got {entry!r}")
            return None
        eid = entry.get("id")
        if not isinstance(eid, str) or not ID_RE.match(eid):
            errors.append(f"{section}: invalid id {eid!r} (use a-z, 0-9, _)")
            return None
        if eid in seen:
            errors.append(f"{section}: duplicate id '{eid}'")
            return None
        return eid

    def need_name(section: str, eid: str, entry: dict[str, Any]) -> str:
        name = entry.get("name")
        if not isinstance(name, str) or not name.strip():
            errors.append(f"{section} '{eid}': missing name")
            return eid
        return name.strip()

    # art_style, lpc:, layer(s): of the LPC pixel art (gone since #127) are ignored, so an older catalog still loads

    # kids
    for entry in seq("kids"):
        kid_id = new_id("kids", entry, cat["kids"])
        if kid_id is None:
            continue
        ha_user = entry.get("ha_user")
        if ha_user is not None and not isinstance(ha_user, str):
            errors.append(f"kids '{kid_id}': ha_user must be a string")
            ha_user = None
        hero_cfg = entry.get("hero")
        if hero_cfg is not None:
            if not isinstance(hero_cfg, dict) or not all(isinstance(hero_cfg.get(k), str) and hero_cfg.get(k) for k in ("name", "body", "hair", "skin", "hair_color")):
                errors.append(f"kids '{kid_id}': hero must be a mapping with name, body, hair, skin and hair_color")
                hero_cfg = None
            else:
                hero_cfg = {k: hero_cfg[k] for k in ("name", "body", "hair", "skin", "hair_color")}
        cat["kids"][kid_id] = {
            "id": kid_id,
            "name": need_name("kids", kid_id, entry),
            "ha_user": ha_user,
            "hero": hero_cfg,                  # fixed hero of this child (created by itself, no hero screen), or None
        }
    # no `kids:` is fine since v1.6 (#136): the children live in the game state (setup.py), with_kids() puts them in; a `kids:` section is read
    # only by the one-off migration v1.6-kids-in-state (and kept as a backup)

    # items (before classes so starter items can be checked)
    for entry in seq("items"):
        item_id = new_id("items", entry, cat["items"])
        if item_id is None:
            continue
        slot = entry.get("slot")
        if slot not in ITEM_SLOTS:
            errors.append(f"items '{item_id}': unknown slot {slot!r}")
            continue
        rarity = entry.get("rarity", "common")
        if rarity not in RARITIES:
            errors.append(f"items '{item_id}': unknown rarity {rarity!r}")
            rarity = "common"
        shop = bool(entry.get("shop", True))
        price = entry.get("price")
        if price is None or price == "TODO":
            price = default_price(rarity, slot) if shop else 0     # starter items are free
        if not _is_int(price) or price < 0:
            errors.append(f"items '{item_id}': price must be an integer >= 0")
            price = 0
        material = entry.get("material")
        if material is not None and material not in MATERIALS:
            errors.append(f"items '{item_id}': unknown material {material!r} ({', '.join(MATERIALS)})")
            material = None
        tier = entry.get("tier", DEFAULT_TIER[rarity])
        if not _is_int(tier) or tier not in TIERS:
            errors.append(f"items '{item_id}': tier must be 0-5")
            tier = DEFAULT_TIER[rarity]
        style = entry.get("style")
        if style is not None and style not in OUTFIT_STYLES:
            errors.append(f"items '{item_id}': style must be one of {', '.join(OUTFIT_STYLES)}")
            style = None
        # classes: of an item (only for some hero classes) is ignored: the classes are gone, every hero may buy and wear everything (#127)
        stats = entry.get("stats") or {}
        if not isinstance(stats, dict):
            errors.append(f"items '{item_id}': stats must be a mapping")
            stats = {}
        art = entry.get("art")
        if art is not None and not (isinstance(art, str) and ID_RE.match(art)):
            errors.append(f"items '{item_id}': art must be an art id (a-z, 0-9, _)")
            art = None
        art_fallback = entry.get("art_fallback")                 # #185: drawn instead while the item's own art does not exist yet (a placeholder)
        if art_fallback is not None and not (isinstance(art_fallback, str) and ID_RE.match(art_fallback)):
            errors.append(f"items '{item_id}': art_fallback must be an art id (a-z, 0-9, _)")
            art_fallback = None
        icon_id = entry.get("icon")
        if icon_id is not None and not (isinstance(icon_id, str) and ID_RE.match(icon_id)):
            errors.append(f"items '{item_id}': icon must be an art id (a-z, 0-9, _)")
            icon_id = None
        covers = entry.get("covers") or []
        if not isinstance(covers, list) or not all(c in SLOTS for c in covers):
            errors.append(f"items '{item_id}': covers must be a list of slots")
            covers = []
        body = entry.get("body", "any")
        if body not in ITEM_BODIES:
            errors.append(f"items '{item_id}': body must be one of {', '.join(ITEM_BODIES)} (got {body!r})")
            body = "any"
        dye = None
        if slot == DYE_SLOT:
            dye = str(entry.get("color") or "").strip()
            if not re.match(r"^[a-z0-9_]+$", dye):
                errors.append(f"items '{item_id}': a hair dye needs color: <hair colour id> (a-z, 0-9, _)")
            elif any(i.get("color") == dye for i in cat["items"].values()):
                errors.append(f"items '{item_id}': another hair dye already unlocks the colour '{dye}'")
        colors = _parse_colors(item_id, entry, errors)
        min_stage = entry.get("min_stage", 0)
        if not _is_int(min_stage) or min_stage < 0:
            errors.append(f"items '{item_id}': min_stage must be a whole number >= 0 (the index of a fortress stage in story.yaml)")
            min_stage = 0
        cat["items"][item_id] = {
            "id": item_id,
            "name": need_name("items", item_id, entry),
            "slot": slot,
            "price": price,
            "rarity": rarity,
            "shop": shop,
            "material": material,
            "tier": tier,
            "style": style,
            "colors": colors,
            "stats": stats,
            "art": art or item_id,
            "art_fallback": art_fallback,
            "icon": icon_id,
            "body": body,                                    # boy | girl | any: which hero may buy / wear it (hairstyles)
            "color": dye,                                   # hair dye only: the colour it unlocks
            "hide_hair": bool(entry.get("hide_hair", False)),
            "covers": list(covers),
            "min_stage": min_stage,                         # #187: in the shop only from this fortress stage on (0 = always); owned items and the history stay
        }

    # appearance (what a kid can choose at onboarding)
    app_raw = raw.get("appearance") or {}
    if not isinstance(app_raw, dict):
        errors.append("'appearance' must be a mapping")
        app_raw = {}
    for key in ("skins", "hair_colors"):
        vals = app_raw.get(key) or []
        if not isinstance(vals, list) or not all(isinstance(v, str) and v for v in vals):
            errors.append(f"appearance.{key} must be a list of strings")
            vals = []
        cat["appearance"][key] = list(vals)
    styles: dict[str, Any] = {}
    styles_raw = app_raw.get("hair_styles") or []
    if not isinstance(styles_raw, list):
        errors.append("appearance.hair_styles must be a list")
        styles_raw = []
    for entry in styles_raw:
        style_id = new_id("appearance.hair_styles", entry, styles)
        if style_id is None:
            continue
        art_id = entry.get("art")
        if art_id is not None and not (isinstance(art_id, str) and ID_RE.match(art_id)):
            errors.append(f"hair style '{style_id}': art must be an art id")
            art_id = None
        styles[style_id] = {
            "id": style_id,
            "name": need_name("hair style", style_id, entry),
            "art": art_id or style_id,
        }
    cat["appearance"]["hair_styles"] = list(styles.values())

    # classes (gone since addendum 5: without `classes:` one implicit hero class carries `starter_items:`)
    class_entries = seq("classes")
    cat["use_classes"] = bool(class_entries)
    if not class_entries:
        class_entries = [{"id": DEFAULT_CLASS, "name": "Hrdina", "starter_items": raw.get("starter_items") or []}]
    for entry in class_entries:
        class_id = new_id("classes", entry, cat["classes"])
        if class_id is None:
            continue
        raw_starters = entry.get("starter_items") or []
        by_body: dict[str, list[str]] = {}
        if isinstance(raw_starters, list):
            by_body = {b: list(raw_starters) for b in BODY_TYPES}
        elif isinstance(raw_starters, dict):
            # per-body starters: {male: [...], female: [...]} (boy/girl accepted); a missing body gets none
            for key, lst in raw_starters.items():
                body = BODY_ALIASES.get(key)
                if body is None or not isinstance(lst, list):
                    errors.append(f"classes '{class_id}': starter_items keys are male/female with lists")
                    continue
                by_body[body] = list(lst)
            for b in BODY_TYPES:
                by_body.setdefault(b, [])
        else:
            errors.append(f"classes '{class_id}': starter_items must be a list or a male/female mapping")
            by_body = {b: [] for b in BODY_TYPES}
        starters = list(dict.fromkeys(i for lst in by_body.values() for i in lst))
        for sid in starters:
            if sid not in cat["items"]:
                errors.append(f"classes '{class_id}': unknown starter item '{sid}'")
        body_options = entry.get("body_options") or {}
        if not isinstance(body_options, dict):
            errors.append(f"classes '{class_id}': body_options must be a mapping")
            body_options = {}
        cat["classes"][class_id] = {
            "id": class_id,
            "name": need_name("classes", class_id, entry),
            "starter_items": list(starters),
            "starter_items_by_body": by_body,
            "body_options": body_options,
        }
    if not cat["classes"]:
        errors.append("no classes defined")

    # tasks
    for entry in seq("tasks"):
        task_id = new_id("tasks", entry, cat["tasks"])
        if task_id is None:
            continue
        period = entry.get("period", "daily")
        if period not in PERIODS:
            errors.append(f"tasks '{task_id}': unknown period {period!r}")
            period = "daily"
        reward = entry.get("reward", DEFAULT_REWARD[period])
        if not _is_int(reward) or reward < 0:
            errors.append(f"tasks '{task_id}': reward must be an integer >= 0")
            reward = 0
        enabled = entry.get("enabled", True)
        if not isinstance(enabled, bool):
            errors.append(f"tasks '{task_id}': enabled must be true or false")
            enabled = True
        rnd = entry.get("round", 1)
        if not _is_int(rnd) or rnd < 1:
            errors.append(f"tasks '{task_id}': round must be an integer >= 1")
            rnd = 1
        kids = entry.get("kids")
        kids_set = kids is not None                     # no `kids:` = every child of the game (with_kids fills them in)
        if kids is None:
            kids = list(cat["kids"])
        elif not isinstance(kids, list):
            errors.append(f"tasks '{task_id}': kids must be a list")
            kids = []
        for kid_id in kids:
            if cat["kids"] and kid_id not in cat["kids"]:
                errors.append(f"tasks '{task_id}': unknown kid '{kid_id}'")
        icon = entry.get("icon") or "mdi:star"
        days = entry.get("days", ["workday", "free"])
        if not isinstance(days, list) or not days or any(d not in ("workday", "free") for d in days):
            errors.append(f"tasks '{task_id}': days must be a list of workday / free")
            days = ["workday", "free"]
        archived = entry.get("archived", False)
        if not isinstance(archived, bool):
            errors.append(f"tasks '{task_id}': archived must be true or false")
            archived = False
        cat["tasks"][task_id] = {
            "id": task_id,
            "name": need_name("tasks", task_id, entry),
            "icon": str(icon),
            "period": period,
            "reward": reward,
            "enabled": enabled,
            "round": rnd,
            "days": [d for d in ("workday", "free") if d in days],       # daily tasks: which kinds of day it shows on
            "note": str(entry.get("note") or "").strip(),                 # the line under the name
            "archived": archived,                                         # gone from the lists, the name stays for the history
            "kids": [k for k in kids if k in cat["kids"]] if cat["kids"] else [k for k in kids if isinstance(k, str)],
            "kids_set": kids_set,
        }

    return cat, errors, warnings


def _parse_colors(item_id: str, entry: dict[str, Any], errors: list[str]) -> dict[str, str]:
    colors: dict[str, str] = {}
    raw = entry.get("colors") or {}
    if not isinstance(raw, dict) or not all(isinstance(v, str) for v in raw.values()):
        errors.append(f"items '{item_id}': colors must map color_N to a palette/variant name")
        raw = {}
    colors.update(raw)
    color = entry.get("color")
    if color is not None:
        if isinstance(color, str):
            colors.setdefault("color_1", color)
        else:
            errors.append(f"items '{item_id}': color must be a string")
    return colors


def with_kids(catalog: dict[str, Any], kids: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """The catalog with the children of the game (v1.6: from the state, setup.kids_catalog) in place of catalog.yaml's `kids:`. A task without
    `kids:` is for every child; a task naming children keeps the ones that exist (in the order of the children). The YAML children stay
    under `yaml_kids` for the migration. Returns a new mapping; the tasks are copied."""
    out = dict(catalog)
    out.setdefault("yaml_kids", catalog.get("yaml_kids", catalog["kids"]))
    out["kids"] = dict(kids)
    tasks = {}
    for tid, t in catalog["tasks"].items():
        t = dict(t)
        t["kids"] = list(kids) if not t.get("kids_set", True) else [k for k in kids if k in (t.get("kids") or [])]
        tasks[tid] = t
    out["tasks"] = tasks
    return out


def catalog_for_client(catalog: dict[str, Any]) -> dict[str, Any]:
    """Return the catalog as lists (ordered) for the frontend."""
    return {
        "kids": [{"id": k["id"], "name": k["name"], "vocative": k.get("vocative") or k["name"]} for k in catalog["kids"].values()],
        "tasks": list(catalog["tasks"].values()),
        "classes": list(catalog["classes"].values()),
        "use_classes": catalog.get("use_classes", True),
        "items": list(catalog["items"].values()),
        # hair_items: the start hairstyle is an item of the kid (starter items include a hairstyle): the hero has the hair of the worn item only,
        # taking it off makes him bald; without it the hairstyle chosen for the hero (appearance) is drawn as before
        "appearance": {**catalog["appearance"], "hair_items": any((catalog["items"].get(i) or {}).get("slot") == "hair" for c in catalog["classes"].values() for i in c["starter_items"])},
        "slots": list(SLOTS),
    }
