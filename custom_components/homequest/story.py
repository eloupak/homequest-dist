"""Story data (cast, fortress stages, intro, chapters): validation of story.yaml (pure Python, no HA imports)."""

from __future__ import annotations

import re
from typing import Any

from . import story_vars

ID_RE = re.compile(r"^[a-z0-9_]+$")
MAX_PARAGRAPHS = 10
MAX_PARAGRAPH_LEN = 700
MAX_CHAPTERS = 30
MAX_CAST = 30
MAX_STAGES = 12
MAX_GIFT_COINS = 100
SIEGE_GAMES = ("defend_gate_v2",)
AMULET_COLORS = ("blue", "red", "green", "purple")
# where the giver stands in the scene (a % of the scene picture: x = centre of the feet, y = feet line, h = figure height)
DEFAULT_POS = {"x": 50.0, "y": 80.0, "h": 34.0}
POS_RANGE = {"x": (0, 100), "y": (0, 100), "h": (5, 100)}


def _paragraphs(value: Any, where: str, errors: list[str]) -> list[str]:
    if isinstance(value, str):
        value = [p.strip() for p in value.split("\n\n")]
    if not isinstance(value, list) or not value:
        errors.append(f"{where}: needs at least one paragraph (a list of texts)")
        return []
    out: list[str] = []
    for p in value:
        if not isinstance(p, str) or not p.strip():
            errors.append(f"{where}: every paragraph must be a non-empty text")
            continue
        if len(p) > MAX_PARAGRAPH_LEN:
            errors.append(f"{where}: a paragraph is longer than {MAX_PARAGRAPH_LEN} characters")
        out.append(p.strip())
    if len(out) > MAX_PARAGRAPHS:
        errors.append(f"{where}: at most {MAX_PARAGRAPHS} paragraphs")
    return out


def _id(value: Any, where: str, errors: list[str]) -> str:
    s = str(value or "").strip()
    if not ID_RE.match(s):
        errors.append(f"{where}: lowercase letters, digits and _ only")
    return s


def _pos(value: Any, where: str, errors: list[str], base: dict[str, Any] | None = None) -> dict[str, Any]:
    """giver_pos: optional, missing keys take `base` (the stage's position, or the defaults)."""
    pos = dict(base or DEFAULT_POS)
    if value is None:
        return pos
    if not isinstance(value, dict):
        errors.append(f"{where}: must be a mapping (x, y, h)")
        return pos
    for key, v in value.items():
        if key in POS_RANGE:
            lo, hi = POS_RANGE[key]
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi:
                errors.append(f"{where}.{key}: a number {lo}..{hi}")
            else:
                pos[key] = float(v)
        else:
            errors.append(f"{where}: unknown key '{key}'")
    return pos


def _speech(value: Any, where: str, cast_ids: set[str], errors: list[str]) -> dict[str, Any]:
    """{giver, text}: one character and its paragraphs."""
    if not isinstance(value, dict):
        errors.append(f"{where}: must be a mapping (giver, text)")
        return {"giver": "", "text": []}
    gid = _id(value.get("giver"), f"{where}.giver", errors)
    if gid and gid not in cast_ids:
        errors.append(f"{where}.giver: '{gid}' is not in the cast")
    return {"giver": gid, "text": _paragraphs(value.get("text"), f"{where}.text", errors)}


def _siege(value: Any, where: str, cast_ids: set[str], errors: list[str]) -> dict[str, Any] | None:
    """The siege of a stage (#118): from reaching the stage until the children win the game the fortress is under siege; `lost` and `won` are
    what the giver says after the game, `gives` the gift for the win (an amulet whose colour every child chooses, once per child)."""
    if not isinstance(value, dict):
        errors.append(f"{where}: must be a mapping (game, lost, won, gives)")
        return None
    game = str(value.get("game") or "")
    if game not in SIEGE_GAMES:
        errors.append(f"{where}.game: one of {', '.join(SIEGE_GAMES)}")
    g = value.get("gives")
    gives = None
    if not isinstance(g, dict) or not g.get("item") or not g.get("name"):
        errors.append(f"{where}.gives: a mapping with item, name (and colors, note, choose, chosen)")
    else:
        colors = g.get("colors") or list(AMULET_COLORS)
        if not isinstance(colors, list) or not colors or any(c not in AMULET_COLORS for c in colors):
            errors.append(f"{where}.gives.colors: a list of {', '.join(AMULET_COLORS)}")
            colors = list(AMULET_COLORS)
        gives = {
            "item": _id(g.get("item"), f"{where}.gives.item", errors),       # picture: assets/story/<item>_<colour>.webp
            "name": str(g["name"]).strip()[:60],
            "colors": colors,
            "note": str(g.get("note") or "Dar").strip()[:60],
            "choose": str(g.get("choose") or "").strip()[:MAX_PARAGRAPH_LEN],   # what the giver says over the choice
            "chosen": str(g.get("chosen") or "").strip()[:MAX_PARAGRAPH_LEN],   # what he says when the child has chosen
        }
    return {
        "game": game,
        "lost": _speech(value.get("lost"), f"{where}.lost", cast_ids, errors),
        "won": _speech(value.get("won"), f"{where}.won", cast_ids, errors),
        "won_label": str(value.get("won_label") or "").strip()[:60],     # the Quest button that plays the end of the siege again
        "battle_label": str(value.get("battle_label") or "").strip()[:60],   # the Quest button back into the battle / a replay after the win (#118)
        "gives": gives,
    }


def parse_story(raw: Any) -> tuple[dict[str, Any] | None, list[str]]:
    """Validate and normalise story.yaml. Returns (story, errors); the story must not be used when errors is non-empty."""
    errors: list[str] = []
    if not isinstance(raw, dict):
        return None, ["story.yaml must be a mapping with cast, intro and chapters"]

    # ---- cast
    cast: list[dict[str, Any]] = []
    cast_ids: set[str] = set()
    craw = raw.get("cast")
    if not isinstance(craw, list) or not craw:
        errors.append("cast: a non-empty list of characters is required")
        craw = []
    if len(craw) > MAX_CAST:
        errors.append(f"cast: at most {MAX_CAST} characters")
    for i, c in enumerate(craw):
        if not isinstance(c, dict):
            errors.append(f"cast[{i}]: must be a mapping")
            continue
        cid = _id(c.get("id"), f"cast[{i}].id", errors)
        if cid in cast_ids:
            errors.append(f"cast[{i}]: duplicate id '{cid}'")
        cast_ids.add(cid)
        name = str(c.get("name", "") or "").strip()
        if not name:
            errors.append(f"cast[{i}].name: missing")
        if c.get("enter_from", "right") not in ("left", "right"):
            errors.append(f"cast[{i}].enter_from: left or right")
        gives = c.get("gives", [])
        if not isinstance(gives, list) or any(not isinstance(g, str) for g in gives):
            errors.append(f"cast[{i}].gives: a list of chapter ids")
            gives = []
        cast.append({
            "id": cid,
            "name": name,
            "role": str(c.get("role", "") or "").strip(),
            "quote": str(c.get("quote", "") or "").strip(),
            "art": str(c.get("art") or cid).strip(),       # picture: assets/story/npc_<art>.webp
            "enter_from": c.get("enter_from", "right"),     # the side the character walks in from
            "show": bool(c.get("show", False)),            # only characters with show: true appear in the game; the others are a record
            "gives": [str(g) for g in gives],
        })

    baseline = 0
    if isinstance(raw.get("fortress"), dict) and raw["fortress"].get("baseline") is not None:
        b = raw["fortress"]["baseline"]
        if isinstance(b, bool) or not isinstance(b, int) or b < 0:
            errors.append("fortress.baseline: a whole number, 0 or more (completed tasks that do not count)")
        else:
            baseline = b

    # ---- fortress stages
    stages: list[dict[str, Any]] = []
    stage_ids: set[str] = set()
    fort = raw.get("fortress", {})
    sraw = fort.get("stages", []) if isinstance(fort, dict) else None
    if sraw is None or not isinstance(sraw, list):
        errors.append("fortress.stages: must be a list")
        sraw = []
    if len(sraw) > MAX_STAGES:
        errors.append(f"fortress.stages: at most {MAX_STAGES}")
    for i, s in enumerate(sraw):
        if not isinstance(s, dict):
            errors.append(f"fortress.stages[{i}]: must be a mapping")
            continue
        sid = _id(s.get("id"), f"fortress.stages[{i}].id", errors)
        if sid in stage_ids:
            errors.append(f"fortress.stages[{i}]: duplicate id '{sid}'")
        stage_ids.add(sid)
        name = str(s.get("name", "") or "").strip()
        if not name:
            errors.append(f"fortress.stages[{i}].name: missing")
        tasks = s.get("tasks")
        if isinstance(tasks, bool) or not isinstance(tasks, int) or tasks < 0:
            errors.append(f"fortress.stages[{i}].tasks: completed tasks needed in total (a whole number, 0 or more)")
            tasks = 0
        elif stages and tasks <= stages[-1]["tasks"]:
            errors.append(f"fortress.stages[{i}].tasks: must be more than the previous stage ({stages[-1]['tasks']})")
        elif not stages and tasks != 0:
            errors.append("fortress.stages[0].tasks: the first stage starts at 0")
        announce = _paragraphs(s["announce"], f"fortress.stages[{i}].announce", errors) if s.get("announce") else []
        scene: list[dict[str, Any]] = []
        sc_raw = s.get("scene")
        if sc_raw is not None:
            if not isinstance(sc_raw, list) or not sc_raw:
                errors.append(f"fortress.stages[{i}].scene: a list of {{giver, text}} (who speaks, in turn)")
                sc_raw = []
            for j, part in enumerate(sc_raw):
                where = f"fortress.stages[{i}].scene[{j}]"
                if not isinstance(part, dict):
                    errors.append(f"{where}: must be a mapping (giver, text)")
                    continue
                gid = _id(part.get("giver"), f"{where}.giver", errors)
                if gid and gid not in cast_ids:
                    errors.append(f"{where}.giver: '{gid}' is not in the cast")
                hurry = part.get("hurry", 0)
                if isinstance(hurry, bool) or not isinstance(hurry, int) or hurry < 0:
                    errors.append(f"{where}.hurry: how many first paragraphs are spoken in a hurry (a whole number, 0 or more)")
                    hurry = 0
                scene.append({"giver": gid, "text": _paragraphs(part.get("text"), f"{where}.text", errors), "hurry": hurry})
        gives: dict[str, Any] | None = None
        if s.get("gives") is not None:
            g = s["gives"]
            coins = g.get("coins") if isinstance(g, dict) else None
            if isinstance(coins, bool) or not isinstance(coins, int) or coins < 1 or coins > MAX_GIFT_COINS:
                errors.append(f"fortress.stages[{i}].gives.coins: a whole number 1-{MAX_GIFT_COINS} (coins every child gets once at this stage)")
            else:
                gives = {"coins": coins, "note": str(g.get("note") or "Dar").strip()[:60]}
        stages.append({
            "id": sid,
            "name": name,
            "description": str(s.get("description", "") or "").strip(),
            "tasks": tasks,
            "announce": announce,                                          # what the castellan says when the stage is reached (text only)
            "scene": scene,                                                # or a scene: the characters speak in turn (replaces announce)
            "gives": gives,                                                # a gift for every child, once per stage and child (server side)
            "replay_label": str(s.get("replay_label") or "").strip()[:60],  # the button in the Quest tab that plays the scene again (empty: no button)
            "done_label": str(s.get("done_label") or "").strip()[:40],     # the last button of the scene (empty: "Do toho!")
            "siege": _siege(s.get("siege"), f"fortress.stages[{i}].siege", cast_ids, errors) if s.get("siege") is not None else None,
            "background": str(s.get("background") or sid).strip(),        # picture: assets/story/bg_<background>.webp
            "giver_pos": _pos(s.get("giver_pos"), f"fortress.stages[{i}].giver_pos", errors),
        })

    def background(value: Any, where: str) -> str:
        if value in (None, ""):
            return ""                                       # empty = the stage the fortress is at
        bg = _id(value, where, errors)
        if bg and stage_ids and bg not in stage_ids:
            errors.append(f"{where}: unknown fortress stage '{bg}'")
        return bg

    def giver(value: Any, where: str) -> str:
        g = _id(value, where, errors)
        if g and g not in cast_ids:
            errors.append(f"{where}: '{g}' is not in the cast")
        return g

    # ---- intro
    iraw = raw.get("intro")
    intro: dict[str, Any] = {}
    if not isinstance(iraw, dict):
        errors.append("intro: must be a mapping (giver, background, text)")
    else:
        intro = {
            "giver": giver(iraw.get("giver"), "intro.giver"),
            "background": background(iraw.get("background"), "intro.background"),
            "giver_pos": _pos(iraw["giver_pos"], "intro.giver_pos", errors) if iraw.get("giver_pos") is not None else None,   # None: the position of its stage
            "text": _paragraphs(iraw.get("text"), "intro.text", errors),
            "replay_label": str(iraw.get("replay_label") or "").strip()[:60],   # the button of the Quest tab that plays the intro again
        }

    # ---- chapters
    chapters: list[dict[str, Any]] = []
    seen: set[str] = set()
    chraw = raw.get("chapters", [])
    if not isinstance(chraw, list):
        errors.append("chapters: must be a list")
        chraw = []
    if len(chraw) > MAX_CHAPTERS:
        errors.append(f"chapters: at most {MAX_CHAPTERS}")
    for i, ch in enumerate(chraw):
        if not isinstance(ch, dict):
            errors.append(f"chapters[{i}]: must be a mapping")
            continue
        cid = _id(ch.get("id"), f"chapters[{i}].id", errors)
        if cid in seen:
            errors.append(f"chapters[{i}]: duplicate id '{cid}'")
        seen.add(cid)
        title = str(ch.get("title", "")).strip()
        if not title:
            errors.append(f"chapters[{i}].title: missing")
        chapters.append({
            "id": cid,
            "title": title,
            "giver": giver(ch.get("giver"), f"chapters[{i}].giver"),
            "background": background(ch.get("background"), f"chapters[{i}].background"),
            "giver_pos": _pos(ch["giver_pos"], f"chapters[{i}].giver_pos", errors) if ch.get("giver_pos") is not None else None,
            "text": _paragraphs(ch.get("text"), f"chapters[{i}].text", errors),
        })
    for c in cast:
        for g in c["gives"]:
            if g not in seen:
                errors.append(f"cast '{c['id']}'.gives: unknown chapter '{g}'")
    if errors:
        return None, errors
    # ---- variables of the story (v1.5, #128): default values of {obec}, {sedlak}, ... (story_vars.py); unknown keys are ignored
    if raw.get("vars") is not None and not isinstance(raw.get("vars"), dict):
        errors.append("vars: must be a mapping (obec, obec_2, ...)")
        return None, errors
    svars = story_vars.clean(raw.get("vars"))
    return {"cast": cast, "fortress": {"stages": stages, "baseline": baseline}, "intro": intro, "chapters": chapters, "vars": svars}, []
