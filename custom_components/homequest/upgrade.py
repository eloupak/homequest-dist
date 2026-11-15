"""v1.7 (#140 b-d): a new version of the integration (an update through the Marketplace runs no release script).

When the integration starts with another version than the one written in the state (state["app_version"]; state["version"] is the
schema of the state, not this):
- before any migration the state, catalog.yaml and story.yaml are copied to <data>/backups/<file>.bak-<old>-to-<new> (the last KEEP updates
  are kept); a failed backup stops the start (no migration runs, Repairs says why),
- the numbers of every child (coins, items, approved tasks) are taken before the migrations and after them; both go to the log and to
  state["upgrades"], a difference raises a repair.
Pure functions (no HA import): store.py calls them and raises the repairs.
"""

from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any

from .logic import _done_total

BACKUP_DIR = "backups"        # in the data dir (config/homequest/backups): next to the files it keeps, out of .storage
KEEP = 5                      # updates whose backups stay (3 files each, ~ the size of the state + the two yaml files)
UPGRADES_KEPT = 20            # entries of state["upgrades"]
UNKNOWN = "unknown"           # the state of an older version has no version written


def _safe(version: str) -> str:
    return re.sub(r"[^0-9A-Za-z.+-]", "_", version or UNKNOWN)


def changed(stored: Any, current: str) -> bool:
    """A version change worth a backup: the manifest has a version and the state another one (or none: written since this version)."""
    return bool(current) and str(stored or "") != current


def tag(old: Any, new: str) -> str:
    return f"{_safe(str(old or UNKNOWN))}-to-{_safe(new)}"


def backup(files: list[Path], backup_dir: Path, old: Any, new: str, keep: int = KEEP) -> list[str]:
    """Copy each existing file to backup_dir/<name>.bak-<old>-to-<new> (an existing copy stays: the first one is the state before the
    update), then drop the backups of older updates beyond `keep`. Returns the names written or kept. Raises OSError (the caller stops)."""
    t = tag(old, new)
    backup_dir.mkdir(parents=True, exist_ok=True)
    names = []
    for src in files:
        if not src.is_file():
            continue
        dst = backup_dir / f"{src.name}.bak-{t}"
        if not dst.exists():
            tmp = dst.with_name(dst.name + ".tmp")
            shutil.copy(src, tmp)                 # not copy2: the file time is the time of the backup (retention)
            tmp.replace(dst)                      # never a half-written backup under the real name
        names.append(dst.name)
    prune(backup_dir, keep, current=t)
    return names


def prune(backup_dir: Path, keep: int, current: str | None = None) -> list[str]:
    """Keep the backups of the newest `keep` updates (by file time); the current one always stays. Only *.bak-*-to-* files are touched."""
    groups: dict[str, list[Path]] = {}
    for p in backup_dir.glob("*.bak-*-to-*"):
        if p.is_file() and not p.name.endswith(".tmp"):
            groups.setdefault(p.name.split(".bak-", 1)[1], []).append(p)
    order = sorted(groups, key=lambda t: max(p.stat().st_mtime for p in groups[t]), reverse=True)
    if current in order:
        order.remove(current)
        order.insert(0, current)
    removed = []
    for t in order[max(keep, 1):]:
        for p in groups[t]:
            p.unlink(missing_ok=True)
            removed.append(p.name)
    return removed


def kid_numbers(state: dict[str, Any]) -> dict[str, dict[str, int]]:
    """{kid id: {coins, items, tasks}} — the numbers the release script used to print before and after (no names, no PIN)."""
    out = {}
    for kid_id, kid in sorted((state.get("kids") or {}).items()):
        if not isinstance(kid, dict):
            continue
        out[kid_id] = {"coins": int(kid.get("coins") or 0), "items": len(kid.get("inventory") or []),
                       "tasks": _done_total({**kid, "history": kid.get("history") or []})}
    return out


def diff(before: dict[str, dict[str, int]], after: dict[str, dict[str, int]]) -> list[str]:
    """Human-readable differences ('anna coins 31 -> 30', 'ben missing'); empty = the same."""
    out = []
    for kid_id in sorted(set(before) | set(after)):
        b, a = before.get(kid_id), after.get(kid_id)
        if b is None or a is None:
            out.append(f"{kid_id} {'missing' if a is None else 'new'}")
            continue
        out += [f"{kid_id} {k} {b[k]} -> {a.get(k)}" for k in b if a.get(k) != b[k]]
    return out


def numbers_text(nums: dict[str, dict[str, int]]) -> str:
    return ", ".join(f"{k} {v['coins']}/{v['items']}/{v['tasks']}" for k, v in nums.items()) or "no children"


def record(state: dict[str, Any], entry: dict[str, Any]) -> None:
    ups = state.setdefault("upgrades", [])
    ups.append(entry)
    del ups[:-UPGRADES_KEPT]
