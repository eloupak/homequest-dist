"""The data that comes with the package (v1.7, #139/#140): a HACS install has `data/` inside the integration (the default catalog without
children, the example story with made-up places, the art). Pure Python, no HA imports; the store runs it in the executor at every start.

- First start: catalog.yaml and story.yaml are copied to /config/homequest/ only when they are missing (a family's own files are never
  replaced; a new story or catalog content reaches an install only through migrations, see story_migrations.py).
- Assets: every file of the package that the install lacks is copied (amulets, story pictures, new art); an existing file is never overwritten.
- Art manifest: the items of the package are merged by the rules of artsync (a new item or a higher revision wins; the install's newer item,
  a same-revision refit and the global fields stay) - this is what tools/promote_art.py did by hand before v1.7.
An install without `data/` in the integration (the private deploy.sh flow) is not touched.
"""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from typing import Any

from . import artsync

FIRST_START_FILES = ("catalog.yaml", "story.yaml")
ART_MANIFEST = Path("art") / "manifest.json"


def _copy(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(dst.name + ".hq-tmp")
    shutil.copyfile(src, tmp)
    os.replace(tmp, dst)


def install_defaults(pkg_data: Path, data_dir: Path) -> dict[str, Any]:
    """-> a report {package, first_start: [files], assets_added, art_promoted: [keys]}."""
    report: dict[str, Any] = {"package": pkg_data.is_dir(), "first_start": [], "assets_added": 0, "art_promoted": []}
    if not report["package"]:
        return report
    data_dir.mkdir(parents=True, exist_ok=True)
    for name in FIRST_START_FILES:
        src, dst = pkg_data / name, data_dir / name
        if src.is_file() and not dst.exists():
            _copy(src, dst)
            report["first_start"].append(name)

    pkg_assets, assets = pkg_data / "assets", data_dir / "assets"
    if not pkg_assets.is_dir():
        return report
    manifest_new = not (assets / ART_MANIFEST).exists()
    for src in sorted(pkg_assets.rglob("*")):
        if not src.is_file():
            continue
        rel = src.relative_to(pkg_assets)
        if rel == ART_MANIFEST and not manifest_new:
            continue                                    # merged below, item by item
        dst = assets / rel
        if not dst.exists():
            _copy(src, dst)
            report["assets_added"] += 1
    if not manifest_new and (pkg_assets / ART_MANIFEST).is_file():
        prod_art, pkg_art = str(assets / "art"), str(pkg_assets / "art")
        promote, _skipped, _warn = artsync.plan(prod_art, pkg_art)
        promote = [p for p in promote if "refit" not in p[1]]        # never overwrite an existing file of the same revision
        if promote:
            artsync.apply(prod_art, pkg_art, promote)
            report["art_promoted"] = [k for k, _, _ in promote]
    return report


def package_version(manifest: Path) -> str:
    try:
        return str(json.loads(manifest.read_text(encoding="utf-8")).get("version") or "")
    except (OSError, ValueError):
        return ""
