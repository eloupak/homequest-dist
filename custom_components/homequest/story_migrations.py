"""Data migrations of story.yaml and catalog.yaml that run by themselves at the start (v1.7, #140): no manual step of a release is left.

Before v1.7 a release changed the live files with scripts run by hand (tools/release_*.py). Now a release adds a step here; the store runs the
steps in order, each once per install (its id in state["migrations"]), with a backup `<file>.bak-<id>` before the first change. Steps work on
the text (comments and the family's own changes stay) and are idempotent:
- `replace_block`: an exact block of the default text is replaced only when it is there unchanged (checked by its sha256); a block the family
  changed in the file is left alone and reported. A paragraph the parent rewrote in the app (story_texts, v1.6) is kept apart from the file
  and stays: Settings shows "výchozí text se změnil" for it.
- custom functions for structural changes (cast_ids, shop_off below).
Pure Python (re, hashlib, yaml), no HA imports.
"""
from __future__ import annotations

import hashlib
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import yaml

# a character whose name uses the variable gets the plain id; its picture keeps the old name through `art:`
CAST_IDS = {"{kastelan}": "castellan", "{sedlak}": "farmer"}


@dataclass(frozen=True)
class Step:
    id: str
    file: str                                   # "story.yaml" or "catalog.yaml"
    run: Callable[[str], tuple[str, int, list[str]]]   # text -> (new text, changes, notes)


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def replace_block(old: str, new: str, old_sha: str) -> Callable[[str], tuple[str, int, list[str]]]:
    """A step body: `old` (exactly, once) -> `new`. `old_sha` guards that the step carries the text it was written for."""
    if sha(old) != old_sha:
        raise ValueError("replace_block: the sha256 does not match the old block")

    def run(text: str) -> tuple[str, int, list[str]]:
        if new in text and old not in text:
            return text, 0, []                      # done already
        if text.count(old) != 1:
            return text, 0, ["the default block is not in the file (changed by the family?) - left as it is"]
        return text.replace(old, new), 1, []
    return run


def cast_ids(text: str) -> tuple[str, int, list[str]]:
    """v1.7: the castellan and the farmer of the first install had ids with real names; they become `castellan` and `farmer` (ids of the
    package's story, so later steps can name them). Found by their name variable, not by the old id."""
    try:
        raw = yaml.safe_load(text) or {}
    except yaml.YAMLError:
        return text, 0, ["story.yaml cannot be read - left as it is"]
    cast = raw.get("cast") if isinstance(raw, dict) else None
    if not isinstance(cast, list):
        return text, 0, []
    taken = {str(c.get("id")) for c in cast if isinstance(c, dict)}
    n, notes = 0, []
    for c in cast:
        if not isinstance(c, dict):
            continue
        old, name = str(c.get("id") or ""), str(c.get("name") or "")
        new = next((v for k, v in CAST_IDS.items() if k in name), None)
        if not new or not old or old == new:
            continue
        if new in taken:
            notes.append(f"cast id {new} is taken - {old} left as it is")
            continue
        line = re.compile(rf"^(?P<ind>[ \t]*)-[ \t]+id:[ \t]*['\"]?{re.escape(old)}['\"]?[ \t]*$", re.M)
        m = line.search(text)
        if not m:
            notes.append(f"cast {old}: its line not found - left as it is")
            continue
        art = "" if c.get("art") else f"\n{m.group('ind')}  art: {old}"
        text = text[:m.start()] + f"{m.group('ind')}- id: {new}{art}" + text[m.end():]
        text = re.sub(rf"(\bgiver:[ \t]*['\"]?){re.escape(old)}(?=['\"]?[ \t]*$)", rf"\g<1>{new}", text, flags=re.M)
        taken.add(new)
        n += 1
    return text, n, notes


# items taken out of the shop: `shop: false`, the item stays in the catalog (owners keep it), its art stays (#130, #140)
#   hat_wizard - the wizard hat was dropped from the game (#130); its art stays
SHOP_OFF = ("hat_wizard",)


def _flow(text: str, iid: str) -> tuple[str, str]:
    """One-line item: returns (new text, 'changed' | 'ok' | '')."""
    m = re.compile(r"^( *- \{ *id: " + re.escape(iid) + r" *,)(.*)\}[ \t]*$", re.M).search(text)
    if not m:
        return text, ""
    body = m.group(2)
    sm = re.search(r"\bshop: *(\w+)", body)
    if sm and sm.group(1).lower() == "false":
        return text, "ok"
    if sm:
        body = body[: sm.start()] + "shop: false" + body[sm.end():]
    else:
        pm = re.search(r"(\bprice: *[^,}]+,?)", body)               # next to the price, like the other items with shop: false
        if pm and pm.group(1).endswith(","):
            body = body[: pm.end()] + " shop: false," + body[pm.end():]
        else:
            body = body.rstrip() + ", shop: false "
    line = m.group(1) + body + "}"
    return text[: m.start()] + line + text[m.end():], "changed"


def _block(text: str, iid: str) -> tuple[str, str]:
    """Block item `- id: X` followed by keys indented deeper: returns (new text, 'changed' | 'ok' | '')."""
    m = re.compile(r"^( *)- id: " + re.escape(iid) + r"[ \t]*\n", re.M).search(text)
    if not m:
        return text, ""
    key_indent = m.group(1) + "  "
    end = m.end()
    keys = re.compile(r"^" + re.escape(key_indent) + r"(\w+):(.*)\n", re.M)
    while True:
        k = keys.match(text, end)
        if not k:
            break
        if k.group(1) == "shop":
            if k.group(2).strip().lower() == "false":
                return text, "ok"
            return text[: k.start()] + f"{key_indent}shop: false\n" + text[k.end():], "changed"
        end = k.end()
    return text[: m.end()] + f"{key_indent}shop: false\n" + text[m.end():], "changed"


def shop_off_ids(text: str, ids=SHOP_OFF) -> tuple[str, dict]:
    """Returns (new text, {id: 'changed' | 'ok' | 'missing'})."""
    out = {}
    for iid in ids:
        text, how = _flow(text, iid)
        if not how:
            text, how = _block(text, iid)
        out[iid] = how or "missing"
    return text, out


def shop_off(text: str) -> tuple[str, int, list[str]]:
    """v1.7: SHOP_OFF items get `shop: false` (text-level, comments stay); an item missing in the catalog is fine (a new family)."""
    text, res = shop_off_ids(text)
    return text, sum(1 for h in res.values() if h == "changed"), []


STEPS: list[Step] = [
    Step("v1.7-cast-ids", "story.yaml", cast_ids),
    Step("v1.7-shop-off", "catalog.yaml", shop_off),
]


def pending(done: list[str] | None, file: str) -> list[Step]:
    return [s for s in STEPS if s.file == file and s.id not in (done or [])]


def apply_all(text: str, steps: list[Step]) -> tuple[str, list[dict[str, Any]]]:
    """Run the steps on the text in order -> (new text, [{id, changes, notes}])."""
    out = []
    for s in steps:
        text, n, notes = s.run(text)
        out.append({"id": s.id, "changes": n, "notes": notes})
    return text, out
