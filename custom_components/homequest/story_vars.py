"""Story variables (v1.5, #128): the places and characters of the story are values a parent can change, not fixed text (pure Python, no HA imports).

story.yaml writes {obec}, {obec_2}, ... in its texts; the server fills them before the story goes to the panel (fill_story). The value of a
variable comes from, in this order: the parent's setting (state["story_vars"]), the `vars:` mapping of story.yaml, DEFAULTS (made-up names).
{jmeno}, {jeden} and {deti} are not story variables: the panel fills them per child (lib/story.js).

Czech has cases and there is no reliable automatic declension, so every form a text needs is its own variable (the parent types it once).
"""

from __future__ import annotations

import re
from typing import Any

# key -> (label for the parent, default value). The defaults are made up (addendum 2 of #128): a new install has no real places.
VARS: dict[str, tuple[str, str]] = {
    "obec": ("Obec (kdo/co)", "Zlatá Ves"),
    "obec_2": ("Obec (do/z čeho)", "Zlaté Vsi"),
    "obec_4": ("Obec (ubránit koho/co)", "Zlatou Ves"),
    "obec_kde": ("Obec (kde, s předložkou)", "ve Zlaté Vsi"),
    "obec_odkud": ("Obec (odkud, s předložkou)", "ze Zlaté Vsi"),
    "ulice": ("Osada / ulice (u Osady …)", "Lísková"),
    "hora": ("Hora (kdo/co)", "Skřetí hřeben"),
    "hora_2": ("Hora (kolem čeho)", "Skřetího hřebene"),
    "sedlak": ("Jméno sedláka", "Matouš"),
    "sedlak_5": ("Jméno sedláka (oslovení)", "Matouši"),
    "kastelan": ("Jméno kastelána", "Bohumil"),
    "kastelan_5": ("Jméno kastelána (oslovení)", "Bohumile"),
}
DEFAULTS: dict[str, str] = {k: v[1] for k, v in VARS.items()}

# How the guide and Settings show the variables (#137, v1.6 UAT): a heading that says what the place or character is, the case only as a small
# hint under it, and a sentence of the story with the parent's value filled in live (examples()).
GROUPS: list[dict[str, Any]] = [
    {"id": "obec", "title": "Obec", "text": "Vaše obec nebo město, kde se příběh odehrává.", "keys": ["obec", "obec_2", "obec_4", "obec_kde", "obec_odkud"]},
    {"id": "ulice", "title": "Osada / ulice", "text": "Blízké sídliště, čtvrť, ulice nebo vesnice, kde bydlíte.", "keys": ["ulice"]},
    {"id": "hora", "title": "Hora", "text": "Blízká hora nebo kopec, který je od vás vidět.", "keys": ["hora", "hora_2"]},
    {"id": "sedlak", "title": "Sedlák", "text": "Jméno sedláka z vaší obce, který dětem nosí zprávy.", "keys": ["sedlak", "sedlak_5"]},
    {"id": "kastelan", "title": "Kastelán", "text": "Jméno kastelána, správce tvrze, kterou děti stavějí.", "keys": ["kastelan", "kastelan_5"]},
]
HINTS: dict[str, str] = {
    "obec": "kdo/co (1. pád)",
    "obec_2": "do/z čeho (2. pád)",
    "obec_4": "koho/co (4. pád)",
    "obec_kde": "kde, i s předložkou",
    "obec_odkud": "odkud, i s předložkou",
    "ulice": "jak se píše za „u Osady …“",
    "hora": "kdo/co (1. pád)",
    "hora_2": "kolem čeho (2. pád)",
    "sedlak": "kdo (1. pád)",
    "sedlak_5": "oslovení (5. pád)",
    "kastelan": "kdo (1. pád)",
    "kastelan_5": "oslovení (5. pád)",
}
_KID_PLACEHOLDER = re.compile(r"\{(deti|jmeno|jeden)\}")
_SENTENCE = re.compile(r"(?<=[.!?…])[\"“”]?\s+")
EXAMPLE_MAX = 160


def _strings(obj: Any, out: list[str]) -> list[str]:
    if isinstance(obj, str):
        out.append(obj)
    elif isinstance(obj, list):
        for v in obj:
            _strings(v, out)
    elif isinstance(obj, dict):
        for k, v in obj.items():
            if k != "vars":
                _strings(v, out)
    return out


def examples(story: Any) -> dict[str, str | None]:
    """key -> a real sentence of the story with {key} in it (other placeholders left as they are), or None when no text uses the key.
    A sentence of a paragraph is preferred over a short label (a name, a button), one without a child's placeholder over one with it."""
    sentences = [x.strip() for t in _strings(story or {}, []) for x in _SENTENCE.split(t) if x.strip()]
    out: dict[str, str | None] = {}
    for key in VARS:
        tag = "{" + key + "}"
        found = [x for x in sentences if tag in x]
        found.sort(key=lambda x: (bool(_KID_PLACEHOLDER.search(x)), len(x) < 25))   # stable: the story's order otherwise
        best = found[0] if found else None
        if best and len(best) > EXAMPLE_MAX:                       # a long sentence: the part around the place
            i = best.index(tag)
            a, b = max(0, i - 70), min(len(best), i + len(tag) + 70)
            best = ("…" if a else "") + best[a:b].strip() + ("…" if b < len(best) else "")
        out[key] = best
    return out
MAX_LEN = 40

MIGRATION = "v1.5-story-vars"

# The one-off migration of v1.5 needs the phrases and values of the first install's story.yaml (real places and names). They live in
# legacy_install.py, which is not part of the public package (tools/publish_dist.py, v1.7): a new install never had that text.
try:
    from .legacy_install import LEGACY_REPLACE, LEGACY_VALUES
except ImportError:
    try:
        from legacy_install import LEGACY_REPLACE, LEGACY_VALUES   # loaded as a plain module (tests)
    except ImportError:
        LEGACY_REPLACE: list[tuple[str, str]] = []
        LEGACY_VALUES: dict[str, str] = {}

_PLACEHOLDER = re.compile(r"\{([a-z0-9_]+)\}")


def clean(raw: Any) -> dict[str, str]:
    """Only known keys with a non-empty text (trimmed, at most MAX_LEN, no braces)."""
    out: dict[str, str] = {}
    if not isinstance(raw, dict):
        return out
    for key, value in raw.items():
        if key not in VARS or not isinstance(value, str):
            continue
        v = " ".join(value.replace("{", "").replace("}", "").split())[:MAX_LEN]
        if v:
            out[key] = v
    return out


def effective(story_vars: Any, state_vars: Any) -> dict[str, str]:
    """The values the children see: the parent's setting over story.yaml `vars:` over the defaults."""
    return {**DEFAULTS, **clean(story_vars), **clean(state_vars)}


def fill_text(text: str, values: dict[str, str]) -> str:
    """{key} -> value for story variables only; any other {placeholder} ({jmeno}, {deti}, ...) stays for the panel."""
    return _PLACEHOLDER.sub(lambda m: values.get(m.group(1), m.group(0)) if m.group(1) in VARS else m.group(0), text)


def fill_story(obj: Any, values: dict[str, str]) -> Any:
    """A copy of the (parsed) story with the variables filled in every text; the source is not changed."""
    if isinstance(obj, str):
        return fill_text(obj, values)
    if isinstance(obj, list):
        return [fill_story(v, values) for v in obj]
    if isinstance(obj, dict):
        return {k: (v if k == "vars" else fill_story(v, values)) for k, v in obj.items()}
    return obj


def migrate_text(text: str) -> tuple[str, int]:
    """Replace the known phrases of the legacy story text by variables. Returns (new text, number of phrases replaced); idempotent."""
    n = 0
    for old, new in LEGACY_REPLACE:
        if old in text:
            text = text.replace(old, new)
            n += 1
    return text, n
