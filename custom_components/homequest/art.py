"""Illustrated art: manifest lookup and the art_style validator (pure Python, no HA imports)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

LAYERED_SLOTS = ("torso", "legs", "feet")
DYE_SLOT = "hair_dye"
BODY_ART = {"male": "boy", "female": "girl"}
FRONT_ONLY_SLOTS = ("weapon", "offhand")


def load_manifest(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) and isinstance(data.get("items"), dict) else None


def index(manifest: dict[str, Any] | None) -> set[tuple]:
    """{(kind, slot, id, body, view)} of everything the manifest holds."""
    out: set[tuple] = set()
    for e in (manifest or {}).get("items", {}).values():
        out.add((e["kind"], e.get("slot"), e["id"], e.get("body"), e.get("view")))
    return out


ART_SLOT = {"outfit": "set"}          # catalog slot -> slot name of the art layer


def sets_mode(catalog: dict[str, Any]) -> bool:
    """Whole-outfit sets (addendum 5): the catalog has outfit items; front view only, no layered clothing."""
    return any(i["slot"] == "outfit" for i in catalog["items"].values())


def views_for(slot: str, front_only: bool = False) -> tuple[str, ...]:
    return ("front",) if front_only or slot in FRONT_ONLY_SLOTS else ("front", "back")


def item_missing(idx: set[tuple], item: dict[str, Any], body_type: str, front_only: bool = False) -> list[str]:
    """Views of an item without illustrated art for this body (empty = fully covered)."""
    body = BODY_ART.get(body_type, body_type)
    art = item.get("art") or item["id"]
    slot = ART_SLOT.get(item["slot"], item["slot"])
    return [v for v in views_for(item["slot"], front_only) if ("layer", slot, art, body, v) not in idx]


def evaluate(catalog: dict[str, Any], manifest: dict[str, Any] | None, state: dict[str, Any]) -> dict[str, Any]:
    """Status of the illustrated art (the only style since #127: the LPC pixel art is gone; an item without its drawing is not shown).

    blocking = what a hero would miss (base bodies, starter items, items kids own), shown to the parent as a warning;
    missing  = informational list incl. shop items.
    """
    idx = index(manifest)
    blocking: list[str] = []
    info: list[str] = []
    items = catalog["items"]

    sets = sets_mode(catalog)
    if not sets:
        for body in BODY_ART.values():
            for view in ("front", "back"):
                if ("body", "body", "base", body, view) not in idx:
                    blocking.append(f"base body {body}/{view}")

    def check(item_id: str, body_type: str, bucket: list[str], why: str) -> None:
        item = items.get(item_id)
        if not item or item["slot"] == DYE_SLOT:      # a bottle of dye is only an icon, not a layer on the hero
            return
        miss = item_missing(idx, item, body_type, sets)
        if miss:
            bucket.append(f"{why} '{item_id}' ({BODY_ART[body_type]}): {', '.join(miss)}")

    for cls in catalog["classes"].values():
        by_body = cls.get("starter_items_by_body") or {bt: cls["starter_items"] for bt in BODY_ART}
        for bt in BODY_ART:
            for sid in by_body.get(bt, []):
                check(sid, bt, blocking, "starter item")
    for kid_id, kid in (state.get("kids") or {}).items():
        hero = kid.get("hero")
        if not hero:
            continue
        for iid in kid.get("inventory", []):
            if sets and (items.get(iid) or {}).get("slot") in LAYERED_SLOTS:
                continue                      # old layered clothing stays in the data but is not drawn
            check(iid, hero.get("body", "male"), blocking, f"{kid_id} owns")
    for item in items.values():
        if item.get("shop"):
            for bt in BODY_ART:
                check(item["id"], bt, info, "shop item")
    for style in catalog["appearance"]["hair_styles"]:
        art = style.get("art") or style["id"]
        for body in BODY_ART.values():
            miss = [v for v in (("front",) if sets else ("front", "back")) if ("layer", "hair", art, body, v) not in idx]
            if miss:
                info.append(f"hair style '{style['id']}' ({body}): {', '.join(miss)}")

    return {
        "sets": sets,
        "requested": "illustrated",
        "effective": "illustrated",
        "blocking": blocking,
        "missing": info,
        "version": int((manifest or {}).get("updated", 0)),
        "has_manifest": manifest is not None,
    }
