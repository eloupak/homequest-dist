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


# ---- v1.9 (#183): stage 3 of the fortress (the tower) with the hunter, the bow in the shop from stage 3, the hunting gear as the gift ----

FORTRESS3_OLD = """    - id: fortress_3
      name: Tvrz s věží
      description: Hlásná věž nad branou.
      tasks: 220
      announce:
        - "Nad bránou vyrostla věž! Hlídky uvidí nepřítele dřív, než dojde k lesu."
      giver_pos: {x: 56, y: 90, h: 30}
"""
FORTRESS3_OLD_SHA = "15515237248294924633d62c3cb7209d08c0a6ee00b812a24f83e4dc28240a1d"
FORTRESS3_NEW = """    - id: fortress_3
      name: Tvrz s věží
      description: Hlásná věž nad branou.
      tasks: 220
      replay_label: "Lovec a luky"
      scene:
        - giver: castellan
          text:
            - "{deti}, podívejte! Tvrz má novou věž. Z ní uvidíme daleko do kraje."
        - giver: hunter
          text:
            - "Zdravím, statečná družino! Jsem lovec {lovec}. Takovou věž jsem v celém kraji neviděl."
            - "Z věže uvidíte skřety dřív, než dorazí k bráně. A až přijdou, bude se hodit dobrý luk."
            - "Přivezl jsem z lesa pár luků. Najdete je v obchodě."
            - "Kdo má luk, může se mnou chodit na lov. Na lov je potřeba být dobře připraven. Dobře spočítat vzdálenost kořisti a směr větru. No, uvidíte sami."
        - giver: farmer
          text:
            - "Konečně pořádná šunka na stůl!"
            - "Jsem si jist, že pokud nalovíte dost, můžete maso prodat na trhu."
        - giver: castellan
          text:
            - "Počkejte ještě! Za tu krásnou věž pro vás mám něco, co se vám určitě bude hodit."
            - "Lovecká výstroj. V lese vás v ní žádný zajíc nezahlédne. Ať se vám na lovu daří!"
      gives: {item: outfit_hunter_1, note: "Dar od kastelána"}
      giver_pos: {x: 56, y: 90, h: 30}
"""

HUNTER_CAST = """  - id: hunter
    name: Lovec {lovec}
    role: Lov, luky (tvrz s věží)
    quote: "Zdravím, statečná družino!"
    show: true
"""


def hunter_cast(text: str) -> tuple[str, int, list[str]]:
    """v1.9: the hunter joins the cast (after the castellan, else at the end of the cast list); there already = nothing."""
    try:
        raw = yaml.safe_load(text) or {}
    except yaml.YAMLError:
        return text, 0, ["story.yaml cannot be read - left as it is"]
    cast = raw.get("cast") if isinstance(raw, dict) else None
    if not isinstance(cast, list):
        return text, 0, ["no cast list - left as it is"]
    if any(isinstance(c, dict) and c.get("id") == "hunter" for c in cast):
        return text, 0, []
    m = re.compile(r"^  - id: castellan[ \t]*\n(?:    .*\n|[ \t]*\n(?=    ))*", re.M).search(text)
    if not m:
        m = re.compile(r"^cast:[ \t]*\n(?:(?:  .*|[ \t]*)\n)*", re.M).search(text)
        if not m:
            return text, 0, ["the cast list not found - left as it is"]
        end = m.end()
        while end > m.start() and text[end - 2: end] == "\n\n":            # before trailing blank lines
            end -= 1
        return text[:end] + HUNTER_CAST + text[end:], 1, []
    return text[: m.end()] + HUNTER_CAST + text[m.end():], 1, []


def fortress3(text: str) -> tuple[str, int, list[str]]:
    """v1.9: the hunter in the cast + stage 3 with its scene and the gift (only when the stage is the default one of v1.1-v1.8)."""
    text, n1, notes1 = hunter_cast(text)
    if FORTRESS3_OLD not in text and FORTRESS3_NEW in text.replace(GIFT_NEW, GIFT_OLD):
        return text, n1, notes1                     # done already, with the hat choice of v1.9-hunter-hat (the package story)
    text, n2, notes2 = replace_block(FORTRESS3_OLD, FORTRESS3_NEW, FORTRESS3_OLD_SHA)(text)
    return text, n1 + n2, notes1 + [f"fortress_3: {x}" for x in notes2]


BOW_LINE = re.compile(r"^( *)- \{ *id: bow_short *,.*\}[ \t]*(?:#.*)?$", re.M)
BOW = {"name": "Luk", "price": 20, "min_stage": 3}           # the keys the step sets; `shop: false` goes away (the bow is for sale)
BOW_NEW = "{ind}- {{ id: bow_short, name: Luk, slot: weapon, price: 20, min_stage: 3, rarity: common, material: wood }}   # v1.9 (#187): in the shop from the tower on; who owns it may go hunting"
HUNTER_GEAR = {"id": "outfit_hunter_1", "name": "Lovecká výstroj", "slot": "outfit", "art": "hunter_1", "style": "hunter",
               "tier": 1, "price": 0, "shop": False, "rarity": "common", "material": "leather"}
HUNTER_GEAR_NOTE = "v1.9 (#185): the castellan's gift at stage 3"   # addendum 4: no art_fallback any more, the hunter_1 art comes with the package


def _scalar(v: Any) -> str:
    return yaml.safe_dump(v, allow_unicode=True, default_flow_style=True).strip().removesuffix("...").strip()


def _block_item(text: str, iid: str) -> re.Match | None:
    """A block item `- id: X` and the keys under it (any indent of the list)."""
    return re.compile(r"^(?P<ind> *)- id: " + re.escape(iid) + r"[ \t]*\n(?P<keys>(?:(?P=ind)  [a-z_]+:.*\n)*)", re.M).search(text)


def bow_hunter(text: str) -> tuple[str, int, list[str]]:
    """v1.9: the bow (bow_short) for sale from stage 3 for 20 coins; the hunting gear outfit (a gift, not in the shop) after the last outfit.
    Both forms of the catalog: one-line items (the first install) and block items (yaml.dump of tools/default_catalog.py, new families)."""
    n, notes = 0, []
    m = BOW_LINE.search(text)
    b = None if m else _block_item(text, "bow_short")
    if m:
        if "min_stage" not in m.group(0):
            text = text[: m.start()] + BOW_NEW.format(ind=m.group(1)) + text[m.end():]
            n += 1
    elif b:
        ind = b.group("ind") + "  "
        keys = [ln for ln in b.group("keys").splitlines() if ln.strip()]
        if not any(ln.strip().startswith("min_stage:") for ln in keys):
            out, seen = [], set()
            for ln in keys:
                k = ln.strip().split(":", 1)[0]
                if k == "shop":
                    continue
                if k in BOW:
                    ln = f"{ind}{k}: {_scalar(BOW[k])}"
                    seen.add(k)
                out.append(ln)
            out += [f"{ind}{k}: {_scalar(v)}" for k, v in BOW.items() if k not in seen]
            text = text[: b.start("keys")] + "".join(x + "\n" for x in out) + text[b.end("keys"):]
            n += 1
    else:
        notes.append("bow_short not in the catalog - left as it is")
    if not re.search(r"^ *- (?:\{ *)?id: outfit_hunter_1\b", text, re.M):
        lines = list(re.finditer(r"^( *)- \{ *id: outfit_[a-z0-9_]+ *,.*\}[ \t]*(?:#.*)?$", text, re.M))
        blocks = list(re.compile(r"^(?P<ind> *)- id: outfit_[a-z0-9_]+[ \t]*\n(?P<keys>(?:(?P=ind)  [a-z_]+:.*\n)*)", re.M).finditer(text))
        if lines:
            last = lines[-1]
            body = ", ".join(f"{k}: {_scalar(v)}" for k, v in HUNTER_GEAR.items())
            text = text[: last.end()] + f"\n{last.group(1)}- {{ {body} }}   # {HUNTER_GEAR_NOTE}" + text[last.end():]
            n += 1
        elif blocks:
            last, ind = blocks[-1], blocks[-1].group("ind")
            items = list(HUNTER_GEAR.items())
            block = f"{ind}- {items[0][0]}: {_scalar(items[0][1])}\n" + "".join(f"{ind}  {k}: {_scalar(v)}\n" for k, v in items[1:])
            text = text[: last.end()] + block + text[last.end():]
            n += 1
        else:
            notes.append("no outfit_ items - the hunting gear not added")
    return text, n, notes


# ---- v1.9 (#185 addendum 4): the hunting hat with a feather in one of 4 colours, the child picks one as a part of the stage 3 gift ----
# A step of its own (TEST ran v1.9-fortress-3 and v1.9-bow-hunter before the hat existed); a new install runs all four in one start.

HAT_COLORS = (("red", "červeným"), ("blue", "modrým"), ("white", "bílým"), ("gold", "zlatým"))
HAT_IDS = [f"hat_hunter_{c}" for c, _ in HAT_COLORS]
HAT_NOTE = "v1.9 (#185): the castellan's gift at stage 3, the child picks one colour of the feather (not in the shop)"
GIFT_OLD = """      gives: {item: outfit_hunter_1, note: "Dar od kastelána"}
"""
GIFT_NEW = """      gives:
        item: outfit_hunter_1
        note: "Dar od kastelána"
        choose:
          items: [hat_hunter_red, hat_hunter_blue, hat_hunter_white, hat_hunter_gold]
          text: "K výstroji patří lovecký klobouk. Vyber si barvu pírka!"
          chosen: "Sluší ti! Ať se ti na lovu daří."
"""


def hat_item(color: str, adj: str) -> dict[str, Any]:
    prep = "se" if color == "gold" else "s"
    return {"id": f"hat_hunter_{color}", "name": f"Lovecký klobouk {prep} {adj} pírkem", "slot": "head", "price": 0, "shop": False,
            "rarity": "rare", "material": "leather"}


def hunter_hat_gift(text: str) -> tuple[str, int, list[str]]:
    """v1.9: the gift of stage 3 (as v1.9-fortress-3 wrote it) gets the choice of the hat; a gift line the family changed is left alone."""
    if "hat_hunter_" in text:
        return text, 0, []
    if text.count(GIFT_OLD) != 1:
        return text, 0, ["the gift of stage 3 is not the default one - the hat choice not added"]
    return text.replace(GIFT_OLD, GIFT_NEW), 1, []


def hunter_hats(text: str) -> tuple[str, int, list[str]]:
    """v1.9: the four hunting hats (slot head, not in the shop) right after the hunting gear, in the form of the catalog (one-line or block)."""
    missing = [(c, a) for c, a in HAT_COLORS if not re.search(r"^ *- (?:\{ *)?id: hat_hunter_" + c + r"\b", text, re.M)]
    if not missing:
        return text, 0, []
    line = re.search(r"^( *)- \{ *id: outfit_hunter_1 *,.*\}[ \t]*(?:#.*)?$", text, re.M)
    block = None if line else _block_item(text, "outfit_hunter_1")
    if line:
        ind = line.group(1)
        add = "".join(f"\n{ind}- {{ " + ", ".join(f"{k}: {_scalar(v)}" for k, v in hat_item(c, a).items()) + f" }}   # {HAT_NOTE}" for c, a in missing)
        return text[: line.end()] + add + text[line.end():], len(missing), []
    if block:
        ind = block.group("ind")
        add = ""
        for c, a in missing:
            items = list(hat_item(c, a).items())
            add += f"{ind}- {items[0][0]}: {_scalar(items[0][1])}\n" + "".join(f"{ind}  {k}: {_scalar(v)}\n" for k, v in items[1:])
        return text[: block.end()] + add + text[block.end():], len(missing), []
    return text, 0, ["outfit_hunter_1 not in the catalog - the hats not added"]


# ---- v1.9 (#210, addendum 12): the short bob is called "Mikádo" (what the family calls it); the id and the art stay, owners keep it ----
MIKADO_ID, MIKADO_OLD, MIKADO_NEW = "hair_short_bob", "Krátký bob", "Mikádo"


def mikado(text: str) -> tuple[str, int, list[str]]:
    """v1.9: the name of hair_short_bob "Krátký bob" -> "Mikádo" (one-line or block item); a name the family changed, or no such item, is left."""
    m = re.search(r"^( *- \{ *id: " + MIKADO_ID + r" *,.*?\bname: *)(\"?)" + re.escape(MIKADO_OLD) + r"\2( *[,}])", text, re.M)
    if m:
        return text[: m.start()] + m.group(1) + m.group(2) + MIKADO_NEW + m.group(2) + m.group(3) + text[m.end():], 1, []
    b = _block_item(text, MIKADO_ID)
    if b:
        n = re.compile(r"^( +name: *)(\"?)" + re.escape(MIKADO_OLD) + r"\2[ \t]*$", re.M).search(text, b.start(), b.end())
        if n:
            return text[: n.start()] + n.group(1) + n.group(2) + MIKADO_NEW + n.group(2) + text[n.end():], 1, []
    return text, 0, []


# ---- v1.9 (#184, addendum 14): stage 4 of the fortress at 360 tasks instead of 400 (variant B: about a month at the current pace) ----
F4_ID, F4_OLD, F4_NEW = "fortress_4", 400, 360


def fortress4_threshold(text: str) -> tuple[str, int, list[str]]:
    """v1.9: `tasks: 400` of stage fortress_4 -> 360 (block or one-line stage); another value the family set, or no such stage, is left."""
    m = re.search(r"^( *)- (?:\{ *)?id: *" + F4_ID + r"\b", text, re.M)
    if not m:
        return text, 0, []
    ind = len(m.group(1))
    nxt = re.compile(r"^ {0,%d}(?:- |\S)" % ind, re.M).search(text, m.end())   # the next item of the list, or less indented
    end = nxt.start() if nxt else len(text)
    t = re.compile(r"(\btasks: *)%d\b" % F4_OLD).search(text, m.start(), end)
    if not t:
        return text, 0, []
    return text[: t.start()] + t.group(1) + str(F4_NEW) + text[t.end():], 1, []


STEPS: list[Step] = [
    Step("v1.7-cast-ids", "story.yaml", cast_ids),
    Step("v1.7-shop-off", "catalog.yaml", shop_off),
    Step("v1.9-fortress-3", "story.yaml", fortress3),
    Step("v1.9-bow-hunter", "catalog.yaml", bow_hunter),
    Step("v1.9-hunter-hat", "story.yaml", hunter_hat_gift),
    Step("v1.9-hunter-hats", "catalog.yaml", hunter_hats),
    Step("v1.9-mikado", "catalog.yaml", mikado),
    Step("v1.9-fortress-4-threshold", "story.yaml", fortress4_threshold),
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
