"""The parent's own text of a whole paragraph of the story (v1.6, #137): pure Python, no Home Assistant imports.

Every paragraph of the parsed story has a stable id: the path to it, with the id of a stage / chapter instead of its position
(intro.text.0, fortress.stages.fortress_2.scene.1.text.0, fortress.stages.fortress_2.siege.won.text.1, chapters.<id>.text.2, ...).
An own text is kept in the state (state["story_texts"][id] = {text, base}), never in story.yaml, so no release and no migration of story.yaml
overwrites it. `base` = the default text the parent replaced: when a later story.yaml changes that paragraph, the own text still wins and the
parent's settings show a warning (stale) with the new default to compare.
"""

from __future__ import annotations

from typing import Any

from .story import MAX_PARAGRAPH_LEN

TEXT_KEYS = ("text", "announce")
TEXT_STR_KEYS = ("choose", "chosen")          # one-paragraph texts (the giver over the amulet choice, #118)
OVERRIDES_MAX = 200


def _key(obj: Any, i: int) -> str:
    return str(obj["id"]) if isinstance(obj, dict) and isinstance(obj.get("id"), str) and obj.get("id") else str(i)


def paragraphs(story: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Every paragraph of the story in order: {id, text (the default, variables not filled), giver, where}."""
    out: list[dict[str, Any]] = []

    def walk(obj: Any, path: list[str], giver: str, where: str) -> None:
        if isinstance(obj, dict):
            g = obj.get("giver") if isinstance(obj.get("giver"), str) and obj.get("giver") else giver
            for k, v in obj.items():
                if k in TEXT_KEYS and isinstance(v, list) and all(isinstance(p, str) for p in v):
                    for i, p in enumerate(v):
                        out.append({"id": ".".join(path + [k, str(i)]), "text": p, "giver": g, "where": where})
                elif k in TEXT_STR_KEYS and isinstance(v, str) and v.strip():
                    out.append({"id": ".".join(path + [k]), "text": v, "giver": g, "where": where})
                elif isinstance(v, (dict, list)) and k not in ("vars", "cast"):
                    walk(v, path + [k], g, where)
        elif isinstance(obj, list):
            for i, v in enumerate(obj):
                w = where
                if isinstance(v, dict) and path[-1:] == ["stages"]:
                    w = f"stage:{_key(v, i)}"
                elif isinstance(v, dict) and path[-1:] == ["chapters"]:
                    w = f"chapter:{_key(v, i)}"
                walk(v, path + [_key(v, i)], giver, w)

    if story:
        for top in ("intro", "fortress", "chapters"):
            if story.get(top) is not None:
                walk(story[top], [top], "", "intro" if top == "intro" else "")
    return out


def apply(story: dict[str, Any] | None, overrides: Any) -> dict[str, Any] | None:
    """A copy of the story with the parent's own paragraphs in place (unknown ids are ignored: a paragraph gone from story.yaml)."""
    if not story or not isinstance(overrides, dict) or not overrides:
        return story

    def walk(obj: Any, path: list[str]) -> Any:
        if isinstance(obj, dict):
            res = {}
            for k, v in obj.items():
                if k in TEXT_KEYS and isinstance(v, list) and all(isinstance(p, str) for p in v):
                    res[k] = [_own(overrides, ".".join(path + [k, str(i)]), p) for i, p in enumerate(v)]
                elif k in TEXT_STR_KEYS and isinstance(v, str) and v.strip():
                    res[k] = _own(overrides, ".".join(path + [k]), v)
                elif isinstance(v, (dict, list)) and k not in ("vars", "cast"):
                    res[k] = walk(v, path + [k])
                else:
                    res[k] = v
            return res
        if isinstance(obj, list):
            return [walk(v, path + [_key(v, i)]) for i, v in enumerate(obj)]
        return obj

    out = dict(story)
    for top in ("intro", "fortress", "chapters"):
        if story.get(top) is not None:
            out[top] = walk(story[top], [top])
    return out


def _own(overrides: dict[str, Any], pid: str, default: str) -> str:
    o = overrides.get(pid)
    return o["text"] if isinstance(o, dict) and isinstance(o.get("text"), str) and o["text"].strip() else default


def set_text(state: dict[str, Any], story: dict[str, Any] | None, pid: Any, text: Any) -> dict[str, Any]:
    """Save the parent's own paragraph (text) or go back to the default (text None or empty). Raises ValueError on bad input."""
    known = {p["id"]: p for p in paragraphs(story)}
    if not isinstance(pid, str) or pid not in known:
        raise ValueError(f"unknown paragraph {pid!r}")
    own = state.setdefault("story_texts", {})
    if text is None or (isinstance(text, str) and not text.strip()):
        own.pop(pid, None)
        return {"id": pid, "own": False}
    if not isinstance(text, str):
        raise ValueError("text: a text")
    clean = "\n".join(line.rstrip() for line in text.strip().splitlines())
    if len(clean) > MAX_PARAGRAPH_LEN:
        raise ValueError(f"at most {MAX_PARAGRAPH_LEN} characters")
    if clean == known[pid]["text"]:
        own.pop(pid, None)                                   # the same as the default: no own text
        return {"id": pid, "own": False}
    if pid not in own and len(own) >= OVERRIDES_MAX:
        raise ValueError(f"at most {OVERRIDES_MAX} own paragraphs")
    prev = own.get(pid) or {}
    own[pid] = {"text": clean, "base": prev.get("base", known[pid]["text"])}
    return {"id": pid, "own": True}


def settings_view(story: dict[str, Any] | None, overrides: Any) -> list[dict[str, Any]]:
    """For Settings -> Příběh: every paragraph with its default, the own text and whether the default changed under an own text (stale)."""
    own = overrides if isinstance(overrides, dict) else {}
    out = []
    for p in paragraphs(story):
        o = own.get(p["id"]) if isinstance(own.get(p["id"]), dict) else None
        out.append({**p, "own": o["text"] if o else None, "stale": bool(o) and o.get("base") != p["text"]})
    return out


def orphans(story: dict[str, Any] | None, overrides: Any) -> list[str]:
    """Own paragraphs whose paragraph is not in story.yaml any more (kept in the state, shown as a warning)."""
    ids = {p["id"] for p in paragraphs(story)}
    return sorted(k for k in (overrides or {}) if k not in ids)
