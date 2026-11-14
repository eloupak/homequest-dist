"""Art of a release into an install (v1.7, #140): the rules of tools/promote_art.py, used also by the integration itself when HACS brings
a new package (data/assets/art inside the integration) - so no manual promotion step is left. Pure Python (os, json, shutil), no HA imports.

Rule: every manifest item that the install lacks, or that has a higher revision (__rN) in the source, or the same revision, different content
and a newer file in the source (a refit), is copied with all its files; an item NEWER in the install is never touched; global manifest fields
(canvas, heads, tokens) are never changed. Only plain file copies, nothing is deleted.
"""
import hashlib
import json
import os
import shutil
import tempfile


def _files(item):
    """Every asset file of a manifest item, relative to assets/art (the thumb is added by the caller)."""
    out = [item["file"]]
    out += [o["file"] for o in (item.get("overlays") or {}).values()]
    for group in (item.get("variants") or {}).values():
        out += list(group.values())
    return out


def _thumb(item):
    if item["kind"] != "layer" and item["kind"] != "icon":
        return None
    prefix = item["slot"] if item["kind"] == "layer" else "icon"
    return f"thumbs/{prefix}_{item['id']}.webp"


def item_files(item, root):
    fs = _files(item)
    th = _thumb(item)
    if th and os.path.exists(os.path.join(root, th)):
        fs.append(th)
    return fs


def _digest(root, files):
    h = hashlib.sha256()
    for f in sorted(files):
        p = os.path.join(root, f)
        h.update(f.encode())
        h.update(hashlib.sha256(open(p, "rb").read()).digest() if os.path.exists(p) else b"-")
    return h.hexdigest()


def _newest(root, files):
    return max((os.path.getmtime(os.path.join(root, f)) for f in files if os.path.exists(os.path.join(root, f))), default=0)


def plan(prod_art, test_art):
    """-> (promote: [(key, text, files)], skipped: [text], warnings: [text])."""
    pm = json.load(open(os.path.join(prod_art, "manifest.json")))
    tm = json.load(open(os.path.join(test_art, "manifest.json")))
    promote, skipped, warnings = [], [], []
    for k in ("canvas", "heads", "tokens"):
        if pm.get(k) != tm.get(k):
            warnings.append(f"manifest field '{k}' differs between test and production (not changed by the promotion)")
    for key, ti in sorted(tm["items"].items()):
        pi = pm["items"].get(key)
        tfiles = item_files(ti, test_art)
        missing = [f for f in tfiles if not os.path.exists(os.path.join(test_art, f))]
        if missing:
            warnings.append(f"{key}: test files missing {missing[:2]} - not promoted")
            continue
        if pi is None:
            promote.append((key, f"NEW r{ti.get('revision', 1)}", tfiles))
            continue
        tr, pr = ti.get("revision", 1), pi.get("revision", 1)
        if tr < pr:
            skipped.append(f"SKIP {key}: production r{pr} is newer than test r{tr}")
        elif tr > pr:
            promote.append((key, f"r{pr} -> r{tr}", tfiles))
        elif _digest(test_art, tfiles) != _digest(prod_art, item_files(pi, prod_art)):
            if _newest(test_art, tfiles) > _newest(prod_art, item_files(pi, prod_art)):
                promote.append((key, f"r{tr} refit (newer in test)", tfiles))
            else:
                skipped.append(f"SKIP {key}: r{tr} content differs but production is newer than test")
    return promote, skipped, warnings


def apply(prod_art, test_art, promote):
    pm_path = os.path.join(prod_art, "manifest.json")
    pm = json.load(open(pm_path))
    tm = json.load(open(os.path.join(test_art, "manifest.json")))
    for key, _, files in promote:
        for f in files:
            dst = os.path.join(prod_art, f)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            tmp = dst + ".promote-tmp"
            shutil.copyfile(os.path.join(test_art, f), tmp)
            os.replace(tmp, dst)
        pm["items"][key] = tm["items"][key]
    if promote:
        pm["updated"] = tm.get("updated", pm.get("updated"))
        fd, tmp = tempfile.mkstemp(dir=prod_art, suffix=".json")
        with os.fdopen(fd, "w") as fh:
            json.dump(pm, fh, ensure_ascii=False, indent=1, sort_keys=True)
            fh.write("\n")
        os.replace(tmp, pm_path)
