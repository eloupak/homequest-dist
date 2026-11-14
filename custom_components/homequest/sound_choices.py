"""The parent's choice of one sound variant (a/b/c) per game action (pure file handling, no Home Assistant; used by sound_lab.py)."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

CHOICES_FILE = "sound_choices.json"
VARIANTS = ("a", "b", "c")
SOUNDS_DIR = Path(__file__).parent / "frontend" / "sounds"


def action_ids(sounds_dir: Path = SOUNDS_DIR) -> list[str]:
    """The actions the lab knows (from sounds/actions.json, written by tools/build_sounds.py)."""
    try:
        data = json.loads((sounds_dir / "actions.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [a["id"] for a in data.get("actions", []) if isinstance(a, dict) and "id" in a]


def load_choices(path: Path) -> dict[str, str]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {k: v for k, v in data.items() if isinstance(data, dict) and v in VARIANTS} if isinstance(data, dict) else {}


def save_choice(path: Path, action: str, variant: str, valid: list[str]) -> dict[str, str]:
    """Store one choice atomically; returns all choices. ValueError for an unknown action or variant."""
    if action not in valid:
        raise ValueError(f"unknown action '{action}'")
    if variant not in VARIANTS:
        raise ValueError(f"unknown variant '{variant}'")
    choices = load_choices(path)
    choices[action] = variant
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(choices, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")
    os.replace(tmp, path)
    return choices
