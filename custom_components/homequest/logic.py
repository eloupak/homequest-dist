"""HomeQuest game rules (pure Python, no Home Assistant imports).

Every function mutates the given state dict in place and returns a small
result dict that callers use for events. Time is always passed in.
"""

from __future__ import annotations

import re
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Callable

from . import story_vars as _story_vars
from .const import (
    BODY_TYPES,
    ERR_ALREADY_OWNED,
    ERR_BODY_RESTRICTED,
    BODY_OF_HERO,
    ERR_FORBIDDEN,
    ERR_INSUFFICIENT_COINS,
    ERR_INVALID_PARAMS,
    ERR_INVALID_STATE,
    ERR_NOT_FOUND,
    HERO_NAME_MAX,
    HISTORY_LIMIT,
    NOTE_MAX,
    DYE_SLOT,
    SLOTS,
    STORAGE_VERSION,
)


class HomeQuestError(Exception):
    """Rule violation; `code` is returned to the client."""

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code
        self.message = message or code


# ---------------------------------------------------------------- state ----


def new_state() -> dict[str, Any]:
    return {"version": STORAGE_VERSION, "kids": {}}


def _new_kid() -> dict[str, Any]:
    return {
        "hero": None,
        "require_approval": False,
        "coins": 0,
        "coins_earned_total": 0,
        "inventory": [],
        "equipped": {},
        "tasks": {},
        "history": [],
    }


def _done_total(kid: dict[str, Any]) -> int:
    """Approved tasks of one child. Kept as a counter (the history keeps only the last HISTORY_LIMIT entries); a child
    without the counter yet (state from before the fortress) is counted once from the history."""
    n = kid.get("tasks_done_total")
    if n is None:
        n = sum(1 for e in kid["history"] if e.get("type") == "approved" and e.get("task"))
    return int(n)


def _count_task(kid: dict[str, Any]) -> None:
    kid["tasks_done_total"] = _done_total(kid) + 1


def fortress_done(state: dict[str, Any]) -> int:
    """Tasks completed by all children together (approved ones only): what the shared fortress grows with. A clean start of the game
    (Spustit hru, v1.6) sets state["fortress_baseline"] to the count of that moment: the fortress counts from there, the children's counters stay."""
    return max(0, sum(_done_total(k) for k in state.get("kids", {}).values()) - int(state.get("fortress_baseline") or 0))


def period_key(period: str, day: date) -> str:
    if period == "weekly":
        iso = day.isocalendar()
        return f"{iso[0]}-W{iso[1]:02d}"
    return day.isoformat()


def task_key(task: dict[str, Any], day: date) -> str:
    """Key of the period a task entry belongs to; an adhoc task never rolls over (until its `round` changes)."""
    if task["period"] == "adhoc":
        return f"adhoc-{task.get('round', 1)}"
    return period_key(task["period"], day)


def _history(kid: dict[str, Any], ts: str, **entry: Any) -> None:
    kid["history"].append({"ts": ts, **entry})
    del kid["history"][:-HISTORY_LIMIT]


MIGRATION_V11_FIXES = "v1.1-fixes"


def migrate(state: dict[str, Any], catalog: dict[str, Any], ts: str) -> bool:
    """One-off data fixes after the test of 1.1, applied once (marker in state["migrations"]; coins and task history are never touched):
    the wooden sword is taken from every kid (inventory and hands: it is bought in the shop now) and the old hair-dye unlocks
    (bottles kept in the inventory) are dropped (a bottle is used up when bought). Returns True when something was applied."""
    done = state.setdefault("migrations", [])
    if MIGRATION_V11_FIXES in done:
        return False
    for kid in state.get("kids", {}).values():
        notes = []
        if "sword_wooden" in kid["inventory"] or kid["equipped"].get("weapon") == "sword_wooden":
            kid["inventory"] = [i for i in kid["inventory"] if i != "sword_wooden"]
            if kid["equipped"].get("weapon") == "sword_wooden":
                del kid["equipped"]["weapon"]
            notes.append("dřevěný meč odebrán (koupí se v obchodě)")
        dyes = [i for i in kid["inventory"] if (catalog["items"].get(i) or {}).get("slot") == DYE_SLOT or i.startswith("dye_")]
        if dyes:
            kid["inventory"] = [i for i in kid["inventory"] if i not in dyes]
            notes.append("staré lahvičky barev odebrány")
        if notes:
            _history(kid, ts, type="migrated", coins=0, note="; ".join(notes))
    done.append(MIGRATION_V11_FIXES)
    return True


MIGRATION_V11_STARTER_HAIR = "v1.1-starter-hair"


def migrate_starters(state: dict[str, Any], catalog: dict[str, Any], ts: str) -> bool:
    """One-off (addendum 3): the start hairstyle and the basic clothes belong to the kid as ordinary items: every starter hairstyle / outfit of the
    hero's body that the kid does not own yet is added, and worn when nothing is worn in that slot. Coins and history are not touched."""
    done = state.setdefault("migrations", [])
    if MIGRATION_V11_STARTER_HAIR in done:
        return False
    for kid in state.get("kids", {}).values():
        hero = kid.get("hero")
        if not hero:
            continue
        cls = catalog["classes"].get(hero.get("class")) or next(iter(catalog["classes"].values()), None)
        if cls is None:
            continue
        added = []
        for iid in cls["starter_items_by_body"].get(hero.get("body"), cls["starter_items"]):
            item = catalog["items"].get(iid)
            if not item or item["slot"] not in ("hair", "outfit") or not _body_ok(item, kid):
                continue
            if iid not in kid["inventory"]:
                kid["inventory"].append(iid)
                added.append(iid)
            if item["slot"] not in kid["equipped"]:
                # nothing worn in this slot: for the clothes the kid's own latest outfit (he may have bought one), else the starter
                own = [i for i in kid["inventory"] if (catalog["items"].get(i) or {}).get("slot") == item["slot"] == "outfit" and _body_ok(catalog["items"][i], kid)]
                pick = own[-1] if own else iid
                kid["equipped"][item["slot"]] = pick
                if pick not in added:
                    added.append(pick)
        if added:
            _history(kid, ts, type="migrated", coins=0, note="výchozí účes a oblečení jsou v inventáři: " + ", ".join(added))
    done.append(MIGRATION_V11_STARTER_HAIR)
    return True


def sync(state: dict[str, Any], catalog: dict[str, Any], today: date, ts: str, workday: bool | None = None) -> bool:
    """Make state match catalog and the current period. Returns True if changed.
    `workday` = is today a working day (HA's workday sensor); None = unknown: Monday-Friday.

    Safe to call at any time (startup, midnight, before each mutation): tasks
    whose period key differs from the current one are reset to open; pending
    ones are dropped without reward.
    """
    changed = False
    kids = state.setdefault("kids", {})
    if state.get("holidays_until") and today.isoformat() > state["holidays_until"]:
        state["holidays_until"] = state["holidays_from"] = None  # the holidays are over: switch off by themselves
        changed = True
    if _day_plan(state, catalog, today, workday, ts):      # the list of daily tasks of the day: made once, changes only at midnight
        changed = True
    plan_ids = set(state["day_plan"]["tasks"])
    for kid_id in catalog["kids"]:
        if kid_id not in kids:
            kids[kid_id] = _new_kid()
            changed = True
    if ensure_ids(state):                                  # stable ids (v1.5, #128): the install and every child, independent of names
        changed = True
    for kid_id, kid in kids.items():
        preset = (catalog["kids"].get(kid_id) or {}).get("hero")
        if kid["hero"] is not None and preset:                # the hero is fixed in the catalog: name, body, hair and skin follow it (a dyed hair colour stays)
            fixed = {k: preset[k] for k in ("name", "body", "hair", "skin")}
            if any(kid["hero"].get(k) != v for k, v in fixed.items()):
                kid["hero"].update(fixed)
                changed = True
        if kid["hero"] is None and preset:                 # the hero of this child is fixed in the catalog: no hero screen
            try:
                onboard(state, catalog, kid_id, {**preset, "class": next(iter(catalog["classes"]), None)}, ts)
                changed = True
            except HomeQuestError:
                pass                                       # a preset that does not fit the catalog: the child stays without a hero (logged by the caller)
        if "require_approval" not in kid:
            kid["require_approval"] = False
            changed = True
        applicable = {}
        plan_kids = state["day_plan"].get("kids") or {}
        for t in catalog["tasks"].values():
            if t["period"] == "daily":
                if kid_id not in plan_kids.get(t["id"], t["kids"]):    # whose task it is was decided with today's plan (a plan without it: the catalog's list)
                    continue
            elif kid_id not in effective_task(state, t)["kids"]:
                continue
            if t["period"] == "daily":
                if t["id"] in plan_ids:                          # in today's plan (also an archived one that was already running today)
                    owner = _single_owner(state, t["id"], today)
                    if owner is None or owner == kid_id:         # "Pouze 1": a sibling has done it, it is gone for this child today
                        applicable[t["id"]] = t
                continue
            e = effective_task(state, t)                         # weekly / ad hoc catalog tasks (old, not used by the app any more)
            if not e.get("archived") and e.get("enabled", True):
                applicable[e["id"]] = e
        tasks = kid.setdefault("tasks", {})
        for task_id in list(tasks):
            if task_id in state.get("oneoffs", {}):
                continue                                         # one-off tasks: handled below
            if task_id not in applicable:
                if tasks[task_id].get("status") == "pending" and task_id in catalog["tasks"]:
                    continue                                     # waiting for the parent (a task that is gone from the list): keep it until decided
                del tasks[task_id]
                changed = True
        for task_id, task in applicable.items():
            key = task_key(task, today)
            cur = tasks.get(task_id)
            if cur is not None and cur.get("period_key") == key:
                continue
            if cur is not None and cur.get("status") == "pending":
                _history(kid, ts, type="expired", task=task_id, coins=0)
            tasks[task_id] = {"period_key": key, "status": "open", "done_at": None}
            changed = True
    if _sync_oneoffs(state, today, ts):
        changed = True
    return changed


# ------------------------------------------------- day type, one-off tasks --

DAY_TYPES = ("workday", "free")
ONEOFF_NAME_MAX = 60
ONEOFF_REWARD_MAX = 50
TEMPLATES_MAX = 40
ONEOFF_KEEP = 30                 # finished / deleted one-off tasks kept for the overview
DEFAULT_TEMPLATES = [
    "Naplnit myčku", "Vyndat myčku", "Uklidit pokojíček na vysávání", "Uklidit si vyprané prádlo",
    "Srovnat prádlo", "Zamést schody", "Umýt nádobí", "Úkol do školy",
]


def holiday_active(state: dict[str, Any], today: date) -> bool:
    """Holidays run from `holidays_from` (set to tomorrow when they are switched on) to `holidays_until`, both included."""
    until = state.get("holidays_until")
    return bool(until) and (state.get("holidays_from") or "0000-00-00") <= today.isoformat() <= until


def _plan_ids(state: dict[str, Any], catalog: dict[str, Any], dtype: str) -> list[str]:
    return [t["id"] for t in catalog["tasks"].values()
            if t["period"] == "daily" and not t.get("archived") and t.get("enabled", True) and dtype in effective_task(state, t)["days"]]


PLAN_REFRESH_HOURS = 2     # just after midnight the workday sensor may still hold yesterday's value: a plan nobody has touched is made again when it changes


def _day_plan(state: dict[str, Any], catalog: dict[str, Any], today: date, workday: bool | None, ts: str = "") -> bool:
    """The daily tasks of a day are decided at the first sync of that day and do not change until midnight (settings, holidays,
    the workday sensor, a release: all of it counts from the next day). One exception: in the first hours after midnight, when the workday
    sensor changes its value and no child has touched today's tasks yet, the plan is made again (the sensor was late). Returns True when a plan was made."""
    plan = state.get("day_plan")
    if plan and plan.get("date") == today.isoformat():
        late_sensor = (not plan.get("frozen") and "sensor" in plan and plan["sensor"] != workday
                       and ts[11:13].isdigit() and int(ts[11:13]) < PLAN_REFRESH_HOURS)
        untouched = all((kid.get("tasks", {}).get(tid) or {}).get("status", "open") == "open"
                        for kid in state.get("kids", {}).values() for tid in plan["tasks"])
        if not (late_sensor and untouched):
            return False
    dtype = day_type(state, today, workday)
    ids = _plan_ids(state, catalog, dtype)
    state["day_plan"] = {"date": today.isoformat(), "type": dtype, "sensor": workday, "tasks": ids,
                         "kids": {tid: effective_task(state, catalog["tasks"][tid])["kids"] for tid in ids},      # "for whom" is frozen with the plan, a change counts from the next day
                         "single": [tid for tid in ids if effective_task(state, catalog["tasks"][tid]).get("single")]}      # "Pouze 1": only one child does it (frozen as well)
    return True


def day_type(state: dict[str, Any], today: date, workday: bool | None = None) -> str:
    """workday | free. Holidays count as free days; unknown workday sensor = Monday-Friday."""
    if holiday_active(state, today):
        return "free"
    if workday is None:
        workday = today.weekday() < 5
    return "workday" if workday else "free"


def effective_task(state: dict[str, Any], task: dict[str, Any]) -> dict[str, Any]:
    """The catalog task with the parent's settings from the app (enabled, days) on top."""
    ov = (state.get("task_settings") or {}).get(task["id"])
    out = dict(task)
    out.setdefault("days", list(DAY_TYPES))
    out["optional"] = bool(task.get("optional"))                 # #227: shown every day, not counted in the day's progress
    if ov:
        if ov.get("kids"):                                       # the parent's "for whom" wins over the catalog's list; no setting = the catalog's (all children)
            out["kids"] = [k for k in (state.get("kids") or {}) if k in ov["kids"]] or list(task["kids"])
        if "days" in ov:
            out["days"] = [d for d in DAY_TYPES if d in ov["days"]]
        if ov.get("single"):
            out["single"] = True                                 # "Pouze 1": the first child to finish a daily task owns it
        if "optional" in ov:
            out["optional"] = bool(ov["optional"])               # #227: the parent's "Volitelný" wins over the catalog's
        if ov.get("enabled") is False:                           # an old "off" switch: no kind of day
            out["days"] = []
    out["enabled"] = bool(task.get("enabled", True)) and bool(out["days"])   # a daily task with no kind of day is off
    return out


def _oneoff_task(o: dict[str, Any]) -> dict[str, Any]:
    out = {"id": o["id"], "name": o["name"], "icon": "mdi:star-circle", "period": "oneoff", "reward": o["reward"], "single": o["single"]}
    if o.get("kids"):
        out["kids"] = list(o["kids"])
    return out


def _oneoff_kids(state: dict[str, Any], o: dict[str, Any]) -> list[str]:
    """The children a one-off task is for: its `kids`, none given = every child (old tasks have no `kids`)."""
    return [k for k in state.get("kids", {}) if not o.get("kids") or k in o["kids"]]


def _sync_oneoffs(state: dict[str, Any], today: date, ts: str) -> bool:
    """Every active one-off task has an entry for each child who may still do it; "only one child": the first one to finish it owns it
    (while it waits for approval it is gone for the others; a rejection gives it back to all). Approved entries disappear the next day."""
    changed = False
    oneoffs = state.setdefault("oneoffs", {})
    kids = state.get("kids", {})
    for oid, o in oneoffs.items():
        owner = None
        mine = _oneoff_kids(state, o)
        if o["status"] == "active" and o["single"]:
            owner = next((k for k, kid in kids.items() if k in mine and (kid["tasks"].get(oid) or {}).get("status") in ("pending", "approved")), None)
        for kid_id, kid in kids.items():
            tasks = kid.setdefault("tasks", {})
            cur = tasks.get(oid)
            if o["status"] != "active":                        # deleted / done: nothing open stays
                if cur is not None and cur["status"] != "approved":
                    if cur["status"] == "pending":
                        _history(kid, ts, type="expired", task=oid, name=o["name"], coins=0)
                    del tasks[oid]
                    changed = True
                elif cur is not None and (cur.get("done_at") or "")[:10] < today.isoformat():
                    del tasks[oid]
                    changed = True
                continue
            if cur is not None and cur["status"] == "approved":
                if (cur.get("done_at") or "")[:10] < today.isoformat():
                    del tasks[oid]
                    changed = True
                continue
            if kid_id not in mine:                             # a task for other children only: this child never gets it
                if cur is not None:
                    del tasks[oid]
                    changed = True
                continue
            if kid_id in o["done_by"]:
                continue
            if owner is not None and kid_id != owner:
                if cur is not None:
                    del tasks[oid]
                    changed = True
                continue
            if cur is None:
                tasks[oid] = {"period_key": "oneoff", "status": "open", "done_at": None}
                changed = True
    return changed


def _oneoff_paid(state: dict[str, Any], kid_id: str, task_id: str, ts: str) -> None:
    """A one-off task of this child was approved: remember it; when all who may do it are done, the task is done."""
    o = state.get("oneoffs", {}).get(task_id)
    if o is None:
        return
    o["done_by"][kid_id] = ts
    kids = state.get("kids", {})
    if o["single"] or all(k in o["done_by"] for k in _oneoff_kids(state, o)):
        o["status"] = "done"
        o["finished_at"] = ts
        _prune_oneoffs(state)


def _hname(task: dict[str, Any]) -> dict[str, Any]:
    """History entries of one-off tasks carry the name (the task itself may be deleted later)."""
    return {"name": task["name"]} if task.get("period") == "oneoff" else {}


def _single_owner(state: dict[str, Any], task_id: str, today: date) -> str | None:
    """"Pouze 1" daily task: the child who finished it today (waiting for approval or approved), None = nobody yet / not such a task."""
    plan = state.get("day_plan") or {}
    if task_id not in (plan.get("single") or []) or plan.get("date") != today.isoformat():
        return None
    key = period_key("daily", today)
    for kid_id, kid in state.get("kids", {}).items():
        e = (kid.get("tasks") or {}).get(task_id)
        if e and e.get("period_key") == key and e.get("status") in ("pending", "approved"):
            return kid_id
    return None


def _single_daily_after(state: dict[str, Any], task_id: str, ts: str) -> None:
    """After a finish / rejection of a "Pouze 1" daily task: the siblings lose it, or (rejected, nobody owns it) get it back."""
    plan = state.get("day_plan") or {}
    if task_id not in (plan.get("single") or []):
        return
    today = date.fromisoformat(ts[:10])
    owner = _single_owner(state, task_id, today)
    for kid_id, kid in state.get("kids", {}).items():
        tasks = kid.setdefault("tasks", {})
        if owner is not None:
            if kid_id != owner:
                tasks.pop(task_id, None)
        elif task_id not in tasks and kid_id in (plan.get("kids") or {}).get(task_id, list(state["kids"])):
            tasks[task_id] = {"period_key": period_key("daily", today), "status": "open", "done_at": None}


def _oneoff_after(state: dict[str, Any], kid_id: str, task_id: str, ts: str, paid: bool = False) -> None:
    if task_id not in state.get("oneoffs", {}):
        _single_daily_after(state, task_id, ts)
        return
    if paid:
        _oneoff_paid(state, kid_id, task_id, ts)
    _sync_oneoffs(state, date.fromisoformat(ts[:10]), ts)


def _prune_oneoffs(state: dict[str, Any]) -> None:
    gone = [o for o in state["oneoffs"].values() if o["status"] != "active"]
    gone.sort(key=lambda o: o.get("finished_at") or o["created_at"])
    for o in gone[:-ONEOFF_KEEP]:
        del state["oneoffs"][o["id"]]


def tasks_view(state: dict[str, Any], catalog: dict[str, Any], today: date, workday: bool | None, is_admin: bool) -> dict[str, Any]:
    """What the clients need on top of the catalog: the tasks with the parent's settings, the kind of day, holidays, one-off tasks, templates."""
    out: dict[str, Any] = {
        "tasks": [effective_task(state, t) for t in catalog["tasks"].values()],
        "day_type": (state.get("day_plan") or {}).get("type") if (state.get("day_plan") or {}).get("date") == today.isoformat() and (state.get("day_plan") or {}).get("type") else day_type(state, today, workday),
        "day_plan": list((state.get("day_plan") or {}).get("tasks", [])) if (state.get("day_plan") or {}).get("date") == today.isoformat() else None,   # today's daily tasks (also archived ones that run out today)
        "holidays_until": state.get("holidays_until"),             # set (also when it starts tomorrow) or None
        "holidays_from": state.get("holidays_from") if state.get("holidays_until") else None,
        "holidays_active": holiday_active(state, today),
        "oneoffs": [o for o in state.get("oneoffs", {}).values() if o["status"] != "deleted"],
    }
    if is_admin:
        out["templates"] = list(state.get("task_templates", {}).values())     # empty after v1.7-recent-tasks (#129); kept for an old panel
        out["recent"] = list(state.get("recent_tasks", []))                   # #129: the tasks the parent added lately, newest first
    else:
        out["oneoffs"] = [o for o in out["oneoffs"] if o["status"] == "active"]
    return out


# ----------------------------------------------------------------- helpers --


def _kid(state: dict[str, Any], kid_id: str) -> dict[str, Any]:
    kid = state.get("kids", {}).get(kid_id)
    if kid is None:
        raise HomeQuestError(ERR_NOT_FOUND, f"unknown kid '{kid_id}'")
    return kid


def _task_entry(
    state: dict[str, Any], catalog: dict[str, Any], kid_id: str, task_id: str
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    kid = _kid(state, kid_id)
    task = catalog["tasks"].get(task_id)
    if task is None and task_id in state.get("oneoffs", {}):
        task = _oneoff_task(state["oneoffs"][task_id])
    entry = kid["tasks"].get(task_id)
    if task is None or entry is None:
        raise HomeQuestError(ERR_NOT_FOUND, f"task '{task_id}' not available for '{kid_id}'")
    return kid, task, entry


def _item(catalog: dict[str, Any], item_id: str) -> dict[str, Any]:
    item = catalog["items"].get(item_id)
    if item is None:
        raise HomeQuestError(ERR_NOT_FOUND, f"unknown item '{item_id}'")
    return item


def _body_ok(item: dict[str, Any], kid: dict[str, Any]) -> bool:
    """A hairstyle for boys is not for a girl and vice versa (item.body boy | girl | any)."""
    want = item.get("body", "any")
    if want == "any":
        return True
    hero = kid.get("hero")
    return bool(hero) and BODY_OF_HERO.get(hero.get("body")) == want


def _equip_into(kid: dict[str, Any], item: dict[str, Any]) -> None:
    kid["equipped"][item["slot"]] = item["id"]


# ------------------------------------------------------------------ tasks ---


def complete(
    state: dict[str, Any], catalog: dict[str, Any], kid_id: str, task_id: str, ts: str
) -> dict[str, Any]:
    kid, task, entry = _task_entry(state, catalog, kid_id, task_id)
    if entry["status"] != "open":
        raise HomeQuestError(ERR_INVALID_STATE, f"task is {entry['status']}")
    entry["done_at"] = ts
    if not kid.get("require_approval", False):
        # no approval needed: the reward is paid at once (the parent still gets the completed event)
        entry["status"] = "approved"
        kid["coins"] += task["reward"]
        kid["coins_earned_total"] += task["reward"]
        _count_task(kid)
        _history(kid, ts, type="approved", task=task_id, coins=task["reward"], auto=True, **_hname(task))
        _oneoff_after(state, kid_id, task_id, ts, paid=True)
        return {"kid_id": kid_id, "task_id": task_id, "task": task, "auto_approved": True, "coins": task["reward"]}
    entry["status"] = "pending"
    _oneoff_after(state, kid_id, task_id, ts)
    return {"kid_id": kid_id, "task_id": task_id, "task": task, "auto_approved": False, "coins": 0}


def set_approval(
    state: dict[str, Any], catalog: dict[str, Any], kid_id: str, value: Any, ts: str
) -> dict[str, Any]:
    """Per-kid switch: does a finished task need a parent's approval before the reward is paid?"""
    kid = _kid(state, kid_id)
    if not isinstance(value, bool):
        raise HomeQuestError(ERR_INVALID_PARAMS, "value must be true or false")
    if kid.get("require_approval", False) != value:
        kid["require_approval"] = value
        _history(kid, ts, type="approval_setting", value=value, coins=0)
    return {"kid_id": kid_id, "require_approval": value}


def approve(
    state: dict[str, Any], catalog: dict[str, Any], kid_id: str, task_id: str, ts: str
) -> dict[str, Any]:
    kid, task, entry = _task_entry(state, catalog, kid_id, task_id)
    if entry["status"] != "pending":
        raise HomeQuestError(ERR_INVALID_STATE, f"task is {entry['status']}")
    entry["status"] = "approved"
    kid["coins"] += task["reward"]
    kid["coins_earned_total"] += task["reward"]
    _count_task(kid)
    _history(kid, ts, type="approved", task=task_id, coins=task["reward"], **_hname(task))
    _oneoff_after(state, kid_id, task_id, ts, paid=True)
    return {"kid_id": kid_id, "task_id": task_id, "task": task, "coins": task["reward"]}


def reject(
    state: dict[str, Any], catalog: dict[str, Any], kid_id: str, task_id: str, ts: str
) -> dict[str, Any]:
    kid, task, entry = _task_entry(state, catalog, kid_id, task_id)
    if entry["status"] != "pending":
        raise HomeQuestError(ERR_INVALID_STATE, f"task is {entry['status']}")
    entry["status"] = "open"
    entry["done_at"] = None
    _history(kid, ts, type="rejected", task=task_id, coins=0, **_hname(task))
    _oneoff_after(state, kid_id, task_id, ts)
    return {"kid_id": kid_id, "task_id": task_id, "task": task}


# ------------------------------------------------- parent: task settings --


def _assignees(catalog: dict[str, Any], kids: Any) -> list[str] | None:
    """The children chosen by the parent, validated and in catalog order; None = not given. Every child chosen = all children (no restriction)."""
    if kids is None:
        return None
    if not isinstance(kids, list) or not all(isinstance(k, str) for k in kids):
        raise HomeQuestError(ERR_INVALID_PARAMS, "kids must be a list of child ids")
    unknown = [k for k in kids if k not in catalog["kids"]]
    if unknown:
        raise HomeQuestError(ERR_INVALID_PARAMS, f"unknown child '{unknown[0]}'")
    chosen = [k for k in catalog["kids"] if k in kids]
    if not chosen:
        raise HomeQuestError(ERR_INVALID_PARAMS, "choose at least one child")
    return chosen


def set_task(state: dict[str, Any], catalog: dict[str, Any], task_id: str, workday: Any = None, free: Any = None, kids: Any = None, single: Any = None) -> dict[str, Any]:
    """Parent's setting of a daily task: on which kinds of day it shows (none = off) and for whom (all children = the default). Counts from the next day (see _day_plan)."""
    task = catalog["tasks"].get(task_id)
    if task is None or task["period"] != "daily" or task.get("archived"):
        raise HomeQuestError(ERR_NOT_FOUND, f"no daily task '{task_id}'")
    for v in (workday, free, single):
        if v is not None and not isinstance(v, bool):
            raise HomeQuestError(ERR_INVALID_PARAMS, "values must be true or false")
    chosen = _assignees(catalog, kids)
    ov = state.setdefault("task_settings", {}).setdefault(task_id, {})
    ov.pop("enabled", None)
    if chosen is not None:
        if len(chosen) == len(catalog["kids"]) and set(task["kids"]) == set(catalog["kids"]):
            ov.pop("kids", None)                                  # everybody and the catalog says everybody: no setting
        else:
            ov["kids"] = chosen
    days = set(effective_task(state, task)["days"])
    for name, v in (("workday", workday), ("free", free)):
        if v is True:
            days.add(name)
        elif v is False:
            days.discard(name)
    if single is True:
        ov["single"] = True                                       # "Pouze 1" counts from the next day, like everything else
    elif single is False:
        ov.pop("single", None)
    ov["days"] = [d for d in DAY_TYPES if d in days]
    return {"task_id": task_id, **ov}


def set_holidays(state: dict[str, Any], until: Any, today: date) -> dict[str, Any]:
    """Holidays from tomorrow to a date (inclusive); None switches them off, also from tomorrow (today stays as it began)."""
    tomorrow = today + timedelta(days=1)
    if until is None or until == "":
        if holiday_active(state, today):
            state["holidays_until"] = today.isoformat()           # runs out after today
        else:
            state["holidays_until"] = state["holidays_from"] = None
    else:
        try:
            d = date.fromisoformat(str(until))
        except ValueError:
            raise HomeQuestError(ERR_INVALID_PARAMS, "date must look like 2026-12-31") from None
        if d < tomorrow:
            raise HomeQuestError(ERR_INVALID_PARAMS, "the last day of the holidays must be tomorrow or later")
        state["holidays_from"] = tomorrow.isoformat()
        state["holidays_until"] = d.isoformat()
    return {"holidays_from": state.get("holidays_from"), "holidays_until": state.get("holidays_until")}


def _oneoff_fields(name: Any, reward: Any, single: Any) -> tuple[str, int, bool]:
    name = str(name or "").strip()
    if not name or len(name) > ONEOFF_NAME_MAX:
        raise HomeQuestError(ERR_INVALID_PARAMS, f"name: 1-{ONEOFF_NAME_MAX} characters")
    if isinstance(reward, bool) or not isinstance(reward, int) or not 0 <= reward <= ONEOFF_REWARD_MAX:
        raise HomeQuestError(ERR_INVALID_PARAMS, f"reward: a whole number 0-{ONEOFF_REWARD_MAX}")
    if not isinstance(single, bool):
        raise HomeQuestError(ERR_INVALID_PARAMS, "single must be true or false")
    return name, reward, single


def _stored_kids(catalog: dict[str, Any], kids: Any) -> list[str] | None:
    """What a one-off task or template keeps: the chosen children, None when it is for everybody."""
    chosen = _assignees(catalog, kids)
    return None if chosen is None or len(chosen) == len(catalog["kids"]) else chosen


def add_oneoff(state: dict[str, Any], catalog: dict[str, Any], name: Any, reward: Any, single: Any, ts: str, kids: Any = None, source: Any = None) -> dict[str, Any]:
    """The parent assigns a one-off task to the children (all of them, or the chosen ones); it is also kept as a template.
    `single` stays what it was: anybody of the assigned children may do it, but only one of them."""
    name, reward, single = _oneoff_fields(name, reward, single)
    only = _stored_kids(catalog, kids)
    seq = state["oneoff_seq"] = int(state.get("oneoff_seq", 0)) + 1
    oid = f"oneoff_{seq}"
    o = {"id": oid, "name": name, "reward": reward, "single": single, "status": "active", "created_at": ts, "finished_at": None, "done_by": {}}
    if only:
        o["kids"] = only
    if isinstance(source, str) and source:
        o["source"] = source[:40]                                # #228: the "Naposledy přidané" entry it was added from (the duplicate check)
    state.setdefault("oneoffs", {})[oid] = o
    remember_task(state, {"name": name, "reward": reward, "period": "oneoff", "single": single, "kids": only}, ts)
    _prune_oneoffs(state)
    _sync_oneoffs(state, date.fromisoformat(ts[:10]), ts)
    return {"task_id": oid, "task": _oneoff_task(o)}


def delete_oneoff(state: dict[str, Any], task_id: str, ts: str) -> dict[str, Any]:
    o = state.get("oneoffs", {}).get(task_id)
    if o is None or o["status"] != "active":
        raise HomeQuestError(ERR_NOT_FOUND, f"no active one-off task '{task_id}'")
    o["status"] = "deleted"
    o["finished_at"] = ts
    _sync_oneoffs(state, date.fromisoformat(ts[:10]), ts)
    _prune_oneoffs(state)
    return {"task_id": task_id}


def save_template(state: dict[str, Any], name: Any, reward: Any, single: Any, catalog: dict[str, Any] | None = None, kids: Any = None) -> dict[str, Any]:
    name, reward, single = _oneoff_fields(name, reward, single)
    only = _stored_kids(catalog, kids) if catalog is not None else (kids or None)
    tpl = state.setdefault("task_templates", {})
    if len(tpl) >= TEMPLATES_MAX:
        raise HomeQuestError(ERR_INVALID_STATE, f"at most {TEMPLATES_MAX} templates")
    seq = state["template_seq"] = int(state.get("template_seq", 0)) + 1
    tid = f"tpl_{seq}"
    tpl[tid] = {"id": tid, "name": name, "reward": reward, "single": single}
    if only:
        tpl[tid]["kids"] = only
    return tpl[tid]


def delete_template(state: dict[str, Any], template_id: str) -> dict[str, Any]:
    if template_id not in state.get("task_templates", {}):
        raise HomeQuestError(ERR_NOT_FOUND, f"no template '{template_id}'")
    del state["task_templates"][template_id]
    return {"template_id": template_id}


# ------------------------------------------------- parent: the new Rodič screen (#129) --

RECENT_MAX = 12
MIGRATION_RECENT = "v1.7-recent-tasks"
CUSTOM_ICON = "mdi:star-circle"


def remember_task(state: dict[str, Any], entry: dict[str, Any], ts: str = "") -> None:
    """The list "naposledy přidané" (#129, replaces the templates): newest first, one entry per same task, at most RECENT_MAX."""
    e = {"name": entry["name"], "reward": entry["reward"], "period": entry.get("period", "oneoff"), "single": bool(entry.get("single"))}
    if entry.get("kids"):
        e["kids"] = list(entry["kids"])
    if e["period"] == "daily":
        e["days"] = list(entry.get("days") or DAY_TYPES)
    if entry.get("optional"):
        e["optional"] = True                                       # #227
    same = lambda r: {k: v for k, v in r.items() if k not in ("id", "at")} == e     # noqa: E731
    old = next((r for r in state.get("recent_tasks", []) if same(r)), None)
    rec = [r for r in state.get("recent_tasks", []) if not same(r)]
    if old is not None:
        rid = old["id"]                                            # #228: the same task keeps its id (one-off tasks point to it as their source)
    else:
        seq = state["recent_seq"] = int(state.get("recent_seq", 0)) + 1
        rid = f"rec_{seq}"
    state["recent_tasks"] = ([{"id": rid, **e, "at": ts}] + rec)[:RECENT_MAX]


def migrate_recent_tasks(state: dict[str, Any], ts: str) -> bool:
    """One-off (v1.7, #129): the templates become the list of recently added tasks (one-off tasks, in their order); nothing else changes."""
    done = state.setdefault("migrations", [])
    if MIGRATION_RECENT in done:
        return False
    rec = list(state.get("recent_tasks", []))
    for t in reversed(list((state.get("task_templates") or {}).values())):   # the oldest first, so the list ends newest first
        e = {"name": t["name"], "reward": t["reward"], "period": "oneoff", "single": bool(t.get("single")), **({"kids": list(t["kids"])} if t.get("kids") else {})}
        if not any({k: v for k, v in r.items() if k not in ("id", "at")} == e for r in rec):
            seq = state["recent_seq"] = int(state.get("recent_seq", 0)) + 1
            rec.insert(0, {"id": f"rec_{seq}", **e, "at": ts})
    state["recent_tasks"] = rec[:max(RECENT_MAX, len(rec))]
    state["task_templates"] = {}
    done.append(MIGRATION_RECENT)
    return True


def with_parent_tasks(catalog: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    """The catalog with the daily tasks the parent added in the app (state custom_tasks) and the parent's names/rewards of daily tasks
    (task_settings.<id>.name / reward). Returns a new mapping; the catalog file is never changed."""
    tasks = dict(catalog["tasks"])
    kids = list(catalog["kids"])
    for cid, c in (state.get("custom_tasks") or {}).items():
        tasks[cid] = {"id": cid, "name": c["name"], "icon": CUSTOM_ICON, "period": "daily", "reward": c["reward"], "enabled": True, "round": None,
                      "days": list(DAY_TYPES), "note": "", "archived": False, "kids": kids, "kids_set": False, "custom": True, "optional": False}
    for tid, ov in (state.get("task_settings") or {}).items():
        if tid in tasks and ("name" in ov or "reward" in ov):
            tasks[tid] = {**tasks[tid], **{k: ov[k] for k in ("name", "reward") if k in ov}}
    return {**catalog, "tasks": tasks}


def _days_of(days: Any) -> list[str]:
    if not isinstance(days, list) or not all(d in DAY_TYPES for d in days):
        raise HomeQuestError(ERR_INVALID_PARAMS, "days: a list of workday / free")
    return [d for d in DAY_TYPES if d in days]


def add_task(state: dict[str, Any], catalog: dict[str, Any], name: Any, reward: Any, period: Any, ts: str, kids: Any = None, single: Any = False,
             days: Any = None, today: date | None = None, optional: Any = False, source: Any = None) -> dict[str, Any]:
    """#129 "Přidat úkol": a one-off task (as before) or a new daily task. A new daily task joins today's list at once when today's kind of day
    is one of its days (adding takes nothing from the children; every other change of the daily tasks counts from the next day).
    The caller puts the new daily task into its catalog (with_parent_tasks) before the next sync."""
    if period == "oneoff":
        return add_oneoff(state, catalog, name, reward, single, ts, kids, source)
    if period != "daily":
        raise HomeQuestError(ERR_INVALID_PARAMS, "period must be daily or oneoff")
    name, reward, single = _oneoff_fields(name, reward, single)
    days = _days_of(list(DAY_TYPES) if days is None else days)
    if not days:
        raise HomeQuestError(ERR_INVALID_PARAMS, "choose at least one kind of day")
    only = _stored_kids(catalog, kids)
    same = next((t for t in catalog["tasks"].values() if t["period"] == "daily" and not t.get("archived") and t["name"].casefold() == name.casefold()), None)
    if same is not None and effective_task(state, same)["enabled"]:
        raise HomeQuestError(ERR_INVALID_STATE, f"the daily task '{name}' exists already")
    if same is not None:                                  # a switched-off daily task of the same name comes back (no second copy)
        cid = same["id"]
        if cid in (state.get("custom_tasks") or {}):
            state["custom_tasks"][cid]["reward"] = reward
        else:
            state.setdefault("task_settings", {}).setdefault(cid, {})["reward"] = reward
        ov = state.setdefault("task_settings", {}).setdefault(cid, {})
        ov.pop("kids", None)
        ov.pop("single", None)
        ov.pop("optional", None)
    else:
        seq = state["custom_seq"] = int(state.get("custom_seq", 0)) + 1
        cid = f"custom_{seq}"
        state.setdefault("custom_tasks", {})[cid] = {"id": cid, "name": name, "reward": reward, "created_at": ts}
        ov = state.setdefault("task_settings", {}).setdefault(cid, {})
    ov["days"] = days
    if only:
        ov["kids"] = only
    if single:
        ov["single"] = True
    if optional:
        ov["optional"] = True                                     # #227
    plan = state.get("day_plan")
    if plan and plan.get("date") == (today.isoformat() if today else ts[:10]) and plan.get("type") in days and cid not in plan["tasks"]:
        plan["tasks"] = [*plan["tasks"], cid]
        plan.setdefault("kids", {})[cid] = only or [k for k in catalog["kids"]]
        if single:
            plan.setdefault("single", []).append(cid)
    remember_task(state, {"name": name, "reward": reward, "period": "daily", "single": single, "kids": only, "days": days, "optional": bool(optional)}, ts)
    return {"task_id": cid}


def update_task(state: dict[str, Any], catalog: dict[str, Any], task_id: str, ts: str, name: Any = None, reward: Any = None, kids: Any = None,
                single: Any = None, days: Any = None, optional: Any = None) -> dict[str, Any]:
    """#129 "Upravit úkoly" → Uložit: name, reward, for whom, "Pouze 1" and (daily) the kinds of day. A daily task counts from the next day
    (the name and the reward at once); an active one-off task at once."""
    o = (state.get("oneoffs") or {}).get(task_id)
    if o is not None:
        if o["status"] != "active":
            raise HomeQuestError(ERR_NOT_FOUND, f"no active one-off task '{task_id}'")
        n, r, sg = _oneoff_fields(o["name"] if name is None else name, o["reward"] if reward is None else reward, o["single"] if single is None else single)
        o.update(name=n, reward=r, single=sg)
        if kids is not None:
            only = _stored_kids(catalog, kids)
            if only:
                o["kids"] = only
            else:
                o.pop("kids", None)
        _sync_oneoffs(state, date.fromisoformat(ts[:10]), ts)
        return {"task_id": task_id}
    task = catalog["tasks"].get(task_id)
    if task is None or task["period"] != "daily" or task.get("archived"):
        raise HomeQuestError(ERR_NOT_FOUND, f"no task '{task_id}'")
    n, r, _ = _oneoff_fields(task["name"] if name is None else name, task["reward"] if reward is None else reward, False)
    custom = (state.get("custom_tasks") or {}).get(task_id)
    ov = state.setdefault("task_settings", {}).setdefault(task_id, {})
    if custom is not None:
        custom.update(name=n, reward=r)
    else:
        base = {"name": n, "reward": r}
        for k, v in base.items():
            ov[k] = v
    if optional is not None:
        ov["optional"] = bool(optional)                           # #227: at once (it changes only where the task is listed and the progress)
    if days is not None:
        d = _days_of(days)
        set_task(state, catalog, task_id, "workday" in d, "free" in d, kids, single)
    else:
        set_task(state, catalog, task_id, None, None, kids, single)
    return {"task_id": task_id}


def remove_task(state: dict[str, Any], catalog: dict[str, Any], task_id: str, ts: str, kid_id: Any = None) -> dict[str, Any]:
    """#129 Odebrat: a one-off task is deleted (or only one child is taken off it); a daily task is switched off (no kind of day, the
    history stays) or only one child is taken off it. Taking off the last child = the whole task."""
    o = (state.get("oneoffs") or {}).get(task_id)
    if o is not None:
        mine = [k for k in catalog["kids"] if k in _oneoff_kids(state, o)]
        if kid_id and len(mine) > 1:
            if kid_id not in mine:
                raise HomeQuestError(ERR_INVALID_PARAMS, f"'{kid_id}' does not have this task")
            o["kids"] = [k for k in mine if k != kid_id]
            _sync_oneoffs(state, date.fromisoformat(ts[:10]), ts)
            return {"task_id": task_id, "kid_id": kid_id}
        return delete_oneoff(state, task_id, ts)
    task = catalog["tasks"].get(task_id)
    if task is None or task["period"] != "daily":
        raise HomeQuestError(ERR_NOT_FOUND, f"no task '{task_id}'")
    mine = effective_task(state, task)["kids"]
    if kid_id and len(mine) > 1:
        if kid_id not in mine:
            raise HomeQuestError(ERR_INVALID_PARAMS, f"'{kid_id}' does not have this task")
        return set_task(state, catalog, task_id, kids=[k for k in mine if k != kid_id])
    return set_task(state, catalog, task_id, False, False)


MIGRATION_TASKS = "v1.2-tasks"


def migrate_tasks(state: dict[str, Any], catalog: dict[str, Any], ts: str) -> bool:
    """One-off (daily and one-off tasks): the default templates. Coins, items, heroes and history are not touched;
    the catalog side (old tasks archived, the new daily ones) is done by tools/release_tasks.py."""
    done = state.setdefault("migrations", [])
    if MIGRATION_TASKS in done:
        return False
    state.setdefault("oneoffs", {})
    state.setdefault("task_settings", {})
    state.setdefault("holidays_until", None)
    if "day_plan" not in state:     # a release during the day: today's daily list stays as the kids have it (the new list comes at midnight)
        have = [tid for tid in catalog["tasks"] if catalog["tasks"][tid]["period"] == "daily"
                and any(tid in k.get("tasks", {}) for k in state.get("kids", {}).values())]
        state["day_plan"] = {"date": ts[:10], "type": None, "frozen": True, "tasks": have}
    for name in DEFAULT_TEMPLATES:
        save_template(state, name, 1, False)
    done.append(MIGRATION_TASKS)
    return True


# ------------------------------------------------------------------- hero ---


def onboard(
    state: dict[str, Any], catalog: dict[str, Any], kid_id: str, hero: dict[str, Any], ts: str
) -> dict[str, Any]:
    kid = _kid(state, kid_id)
    if kid["hero"] is not None:
        raise HomeQuestError(ERR_INVALID_STATE, "hero already created")
    name = str(hero.get("name", "")).strip()
    if not name or len(name) > HERO_NAME_MAX:
        raise HomeQuestError(ERR_INVALID_PARAMS, f"hero name must be 1-{HERO_NAME_MAX} chars")
    cls = catalog["classes"].get(hero.get("class"))
    if cls is None and not catalog.get("use_classes", True):
        cls = next(iter(catalog["classes"].values()), None)      # no classes: the implicit hero
    if cls is None:
        raise HomeQuestError(ERR_INVALID_PARAMS, "unknown class")
    if hero.get("body") not in BODY_TYPES:
        raise HomeQuestError(ERR_INVALID_PARAMS, "unknown body type")
    clean = {"name": name, "class": cls["id"], "body": hero["body"]}
    appearance = catalog.get("appearance") or {}
    allowed = {
        "skin": appearance.get("skins") or [],
        "hair": [s["id"] for s in appearance.get("hair_styles") or []],
        "hair_color": appearance.get("hair_colors") or [],
    }
    for key in ("skin", "hair", "hair_color"):
        value = hero.get(key)
        if not isinstance(value, str) or not value or len(value) > 32:
            raise HomeQuestError(ERR_INVALID_PARAMS, f"invalid {key}")
        if allowed[key] and value not in allowed[key]:
            raise HomeQuestError(ERR_INVALID_PARAMS, f"{key} '{value}' is not available")
        clean[key] = value
    if cls["body_options"]:
        clean["body_options"] = dict(cls["body_options"])
    kid["hero"] = clean
    kid["equipped"] = {}
    for item_id in cls["starter_items_by_body"].get(clean["body"], cls["starter_items"]):
        item = _item(catalog, item_id)
        if item_id not in kid["inventory"]:
            kid["inventory"].append(item_id)
        _equip_into(kid, item)
    _history(kid, ts, type="onboarded", coins=0)
    return {"kid_id": kid_id, "hero": clean}


def reset_hero(
    state: dict[str, Any], catalog: dict[str, Any], kid_id: str, ts: str
) -> dict[str, Any]:
    kid = _kid(state, kid_id)
    kid["hero"] = None
    kid["equipped"] = {}
    _history(kid, ts, type="hero_reset", coins=0)
    return {"kid_id": kid_id}


# ----------------------------------------------------------------- shop -----


def buy(
    state: dict[str, Any], catalog: dict[str, Any], kid_id: str, item_id: str, ts: str, stage: int | None = None,
    has_art: Callable[[dict[str, Any], str], bool] | None = None, hunt_item: str | None = None,
) -> dict[str, Any]:
    """stage: the fortress stage reached (fortress_stage); an item with min_stage above it is not for sale yet (#187). None = not checked.
    has_art(item, body_type): False = the item has no picture for the hero's body and is not for sale (#230, art.supports_item). None = not checked.
    hunt_item: the item the hunt needs (hunt.yaml entry.needs_item): its first purchase sets kid.seen.bow_hunt = "pending" (#226 point 6)."""
    kid = _kid(state, kid_id)
    item = _item(catalog, item_id)
    if not item["shop"]:
        raise HomeQuestError(ERR_NOT_FOUND, "item is not for sale")
    if stage is not None and int(item.get("min_stage") or 0) > stage:
        raise HomeQuestError(ERR_NOT_FOUND, "item is not for sale yet (the fortress has not reached its stage)")
    if kid["hero"] is None:
        raise HomeQuestError(ERR_INVALID_STATE, "create a hero first")
    if has_art is not None and not has_art(item, kid["hero"].get("body", "male")):
        raise HomeQuestError(ERR_NOT_FOUND, "item is not for sale (no picture yet)")
    dye = item["slot"] == DYE_SLOT
    if dye and kid["hero"].get("hair_color") == item["color"]:
        raise HomeQuestError(ERR_ALREADY_OWNED, "the hero has this hair colour already")
    if not dye and item_id in kid["inventory"]:
        raise HomeQuestError(ERR_ALREADY_OWNED, "already owned")
    if not _body_ok(item, kid):
        raise HomeQuestError(ERR_BODY_RESTRICTED, "item is not for this body")
    if kid["coins"] < item["price"]:
        raise HomeQuestError(
            ERR_INSUFFICIENT_COINS, f"missing {item['price'] - kid['coins']} coins"
        )
    kid["coins"] -= item["price"]
    if dye:
        kid["hero"]["hair_color"] = item["color"]      # a bottle of dye is used up at once: the colour is on the hero, nothing is kept
    else:
        kid["inventory"].append(item_id)
        if hunt_item and item_id == hunt_item:                          # #226 point 6: "Máš luk!" once, after the first purchase only
            seen = kid.setdefault("seen", {"intro": False, "stage": 0})
            seen.setdefault("bow_hunt", "pending")                      # not again after a refund and a new purchase (the key stays)
    _history(kid, ts, type="bought", item=item_id, coins=-item["price"])
    return {"kid_id": kid_id, "item_id": item_id, "item": item}


# --------------------------------------------------------------- refund -----
# #182: the parent gives back a purchase of the shop within 24 hours, for the price paid (the purchase entry keeps both: ts and coins).

REFUND_WINDOW = timedelta(hours=24)


def _parse_ts(ts: Any) -> datetime | None:
    try:
        return datetime.fromisoformat(ts) if isinstance(ts, str) else None
    except ValueError:
        return None


def refund_block(kid: dict[str, Any], catalog: dict[str, Any], entry: dict[str, Any], now: datetime) -> str | None:
    """Why this history entry cannot be refunded now (None = it can). Only a purchase (`bought`) of an item the kid still owns, not a hair dye
    (used up at once), not refunded yet, younger than 24 h by its own ts (no or a broken ts = not refundable). Gifts and trophies are not purchases."""
    if entry.get("type") != "bought":
        return "not a purchase"
    if entry.get("refunded"):
        return "already refunded"
    item = catalog["items"].get(entry.get("item"))
    if item is None or item["slot"] == DYE_SLOT:
        return "this item cannot be returned"
    if not isinstance(entry.get("coins"), int) or entry["coins"] > 0:
        return "no price in the purchase"
    bought = _parse_ts(entry.get("ts"))
    if bought is None or bought.tzinfo is None or now.tzinfo is None:
        return "no time of the purchase"
    age = now - bought
    if age < timedelta(0) or age >= REFUND_WINDOW:
        return "older than 24 hours"
    if entry["item"] not in kid["inventory"]:
        return "the kid does not have the item any more"
    return None


def _starter_for(catalog: dict[str, Any], kid: dict[str, Any], slot: str) -> str | None:
    """The starter item of the hero's body for `slot` (the basic outfit, the starter hairstyle), as given at the hero's creation."""
    hero = kid.get("hero")
    if not hero:
        return None
    cls = catalog["classes"].get(hero.get("class")) or next(iter(catalog["classes"].values()), None)
    if cls is None:
        return None
    for iid in cls["starter_items_by_body"].get(hero.get("body"), cls["starter_items"]):
        item = catalog["items"].get(iid)
        if item and item["slot"] == slot and _body_ok(item, kid):
            return iid
    return None


def refund(
    state: dict[str, Any], catalog: dict[str, Any], kid_id: str, bought_ts: str, item_id: str, ts: str
) -> dict[str, Any]:
    """The parent returns a purchase (#182): the item leaves the inventory, the coins paid come back, the purchase is marked `refunded`
    and a `refunded` entry is added. Worn: the clothes and the hairstyle go back to the starter of the hero's body (never without an outfit),
    anything else just comes off. Not a task: the fortress and the tasks are not touched."""
    kid = _kid(state, kid_id)
    entry = next((e for e in reversed(kid["history"]) if e.get("type") == "bought" and e.get("ts") == bought_ts and e.get("item") == item_id), None)
    if entry is None:
        raise HomeQuestError(ERR_NOT_FOUND, "purchase not found")
    now = _parse_ts(ts)
    why = refund_block(kid, catalog, entry, now) if now is not None else "no time"
    if why:
        raise HomeQuestError(ERR_INVALID_STATE, why)
    item = catalog["items"][item_id]
    price = -entry["coins"]
    kid["inventory"].remove(item_id)
    slot = item["slot"]
    if kid["equipped"].get(slot) == item_id:
        repl = _starter_for(catalog, kid, slot) if slot in ("outfit", "hair") else None
        if repl and repl != item_id:
            if repl not in kid["inventory"]:
                kid["inventory"].append(repl)
            kid["equipped"][slot] = repl
        elif slot == "outfit":
            own = [i for i in kid["inventory"] if (catalog["items"].get(i) or {}).get("slot") == "outfit" and _body_ok(catalog["items"][i], kid)]
            if own:
                kid["equipped"]["outfit"] = own[-1]
            else:
                kid["equipped"].pop("outfit", None)
        else:
            kid["equipped"].pop(slot, None)
    kid["coins"] += price
    entry["refunded"] = ts
    _history(kid, ts, type="refunded", item=item_id, coins=price, bought_ts=bought_ts)
    return {"kid_id": kid_id, "item_id": item_id, "coins": price}


def equip(
    state: dict[str, Any],
    catalog: dict[str, Any],
    kid_id: str,
    item_id: str | None = None,
    slot: str | None = None,
    story: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Equip an owned item, or unequip `slot` (when item_id is None). Only the clothes stay on (another outfit replaces them); a weapon, an
    offhand item and the amulet of a won siege (a trophy, not in the catalog, #118) come off. Hairstyles are out of scope (as before)."""
    kid = _kid(state, kid_id)
    if kid["hero"] is None:
        raise HomeQuestError(ERR_INVALID_STATE, "create a hero first")
    trophy = trophy_items(story).get(item_id) if item_id is not None else None
    if trophy is not None:
        if item_id not in trophy_ids(kid, story):
            raise HomeQuestError(ERR_FORBIDDEN, "only the defender who won it wears this amulet")
        kid["equipped"][trophy["slot"]] = item_id
        return {"kid_id": kid_id, "slot": trophy["slot"], "item_id": item_id}
    if item_id is not None:
        item = _item(catalog, item_id)
        if item_id not in kid["inventory"]:
            raise HomeQuestError(ERR_FORBIDDEN, "item not owned")
        if item["slot"] == DYE_SLOT:
            raise HomeQuestError(ERR_INVALID_PARAMS, "a hair dye is not worn: choose the colour instead")
        if not _body_ok(item, kid):
            raise HomeQuestError(ERR_BODY_RESTRICTED, "item is not for this body")
        _equip_into(kid, item)
        return {"kid_id": kid_id, "slot": item["slot"], "item_id": item_id}
    if slot not in SLOTS:
        raise HomeQuestError(ERR_INVALID_PARAMS, "item_id or a valid slot required")
    if slot == "outfit":
        raise HomeQuestError(ERR_INVALID_STATE, "the clothes cannot be taken off: choose another outfit")
    kid["equipped"].pop(slot, None)
    return {"kid_id": kid_id, "slot": slot, "item_id": None}


def admin_adjust(
    state: dict[str, Any], catalog: dict[str, Any], kid_id: str, delta: int, note: str, ts: str
) -> dict[str, Any]:
    kid = _kid(state, kid_id)
    if isinstance(delta, bool) or not isinstance(delta, int) or delta == 0:
        raise HomeQuestError(ERR_INVALID_PARAMS, "delta must be a non-zero integer")
    note = (note or "").strip()
    if len(note) > NOTE_MAX:
        raise HomeQuestError(ERR_INVALID_PARAMS, f"note too long (max {NOTE_MAX})")
    if kid["coins"] + delta < 0:
        raise HomeQuestError(ERR_INSUFFICIENT_COINS, "coins cannot go below zero")
    kid["coins"] += delta
    _history(kid, ts, type="adjusted", coins=delta, note=note)
    return {"kid_id": kid_id, "delta": delta}


def claim_stage_gift(state: dict[str, Any], story: dict[str, Any] | None, kid_id: str, stage_id: str, ts: str,
                     catalog: dict[str, Any] | None = None, pick: Any = None) -> dict[str, Any]:
    """The gift of a reached fortress stage (stage.gives): coins to this child, once per stage and child (kid["gifts"] keeps the stages,
    so a second call, a second device or a replay of the scene pays nothing). Not a task: it does not count towards the fortress.
    #185: gives.item = an item of the catalog (the hunting gear at stage 3): into the inventory and put on at once (the child may change back).
    An item missing in the catalog is skipped (the coins still come) rather than blocking the scene.
    #185 addendum 4: gives.choose = {items: [...]} - the child also picks ONE of these (the hunting hat by the colour of its feather), once per
    stage and child (kid["gift_picks"][stage]); the picked item goes into the inventory and onto the hero, the others never. `pick` may come
    with the first claim or later (the gear paid before the choice existed, another device); a second pick keeps the first one."""
    kid = _kid(state, kid_id)
    fort = (story or {}).get("fortress") or {}
    stage = next((s for s in fort.get("stages", []) if s["id"] == stage_id), None)
    if stage is None or not stage.get("gives"):
        raise HomeQuestError(ERR_NOT_FOUND, f"stage '{stage_id}' has no gift")
    done = max(0, fortress_done(state) - fort.get("baseline", 0))
    if done < stage["tasks"]:
        raise HomeQuestError(ERR_INVALID_STATE, "the stage is not reached yet")
    choose = stage["gives"].get("choose") or {}
    if pick is not None and (not isinstance(pick, str) or pick not in (choose.get("items") or [])):
        raise HomeQuestError(ERR_INVALID_PARAMS, f"pick: one of {', '.join(choose.get('items') or []) or 'nothing (no choice here)'}")
    gifts = kid.setdefault("gifts", [])
    if stage_id in gifts:
        picked = _gift_pick(kid, catalog, stage_id, pick, stage["gives"]["note"], ts)
        return {"kid_id": kid_id, "stage": stage_id, "coins": 0, "claimed": False, "pick": picked}
    gifts.append(stage_id)
    coins = int(stage["gives"].get("coins") or 0)
    kid["coins"] += coins
    item_id = stage["gives"].get("item")
    item = (catalog or {}).get("items", {}).get(item_id) if item_id else None
    if item is not None and kid.get("hero") is not None:
        if item_id not in kid["inventory"]:
            kid["inventory"].append(item_id)
        if item["slot"] != DYE_SLOT and _body_ok(item, kid):
            _equip_into(kid, item)
    else:
        item_id = None
    extra = {"item": item_id} if item_id else {}
    _history(kid, ts, type="gift", coins=coins, note=stage["gives"]["note"], stage=stage_id, **extra)
    picked = _gift_pick(kid, catalog, stage_id, pick, stage["gives"]["note"], ts)
    return {"kid_id": kid_id, "stage": stage_id, "coins": coins, "item": item_id, "claimed": True, "pick": picked}


def _gift_pick(kid: dict[str, Any], catalog: dict[str, Any] | None, stage_id: str, pick: str | None, note: str, ts: str) -> str | None:
    """The chosen item of a stage gift (already validated against gives.choose): once per stage; returns the item the child has (or None)."""
    picks = kid.get("gift_picks") or {}
    if stage_id in picks or pick is None:
        return picks.get(stage_id)
    item = (catalog or {}).get("items", {}).get(pick)
    if item is None:
        raise HomeQuestError(ERR_NOT_FOUND, f"item '{pick}' is not in the catalog")
    kid.setdefault("gift_picks", {})[stage_id] = pick
    if pick not in kid["inventory"]:
        kid["inventory"].append(pick)
    if kid.get("hero") is not None and item["slot"] != DYE_SLOT and _body_ok(item, kid):
        _equip_into(kid, item)
    _history(kid, ts, type="gift", coins=0, note=note, stage=stage_id, item=pick)
    return pick


# ------------------------------------------------------------------ siege ---
# A stage with `siege` (story.yaml, #118): once it is reached AND a parent started the attack (v1.4.0: state["sieges"][stage]["started_at"]; missing
# = not started, no migration) the fortress is under siege until the children win its game. state["sieges"][stage] = {started_at, won_at, lost,
# kids} keeps the first siege; after the win a parent may start it again as a game only (replay_started_at while it runs, replays, replay_wins,
# replay_lost): a replay never changes won_at, the gifts or the stage. kid["scenes"] the stage scenes the child has seen to the end,
# kid["trophies"] the gifts for the win (an amulet in the colour the child chose, once per child and stage).


def _siege_stage(story: dict[str, Any] | None, stage_id: str) -> dict[str, Any]:
    stage = next((s for s in ((story or {}).get("fortress") or {}).get("stages", []) if s["id"] == stage_id), None)
    if stage is None or not stage.get("siege"):
        raise HomeQuestError(ERR_NOT_FOUND, f"stage '{stage_id}' has no siege")
    return stage


def siege_info(state: dict[str, Any], story: dict[str, Any] | None) -> dict[str, Any] | None:
    """The siege of the highest reached stage that has one: {stage, active, won_at, lost, game}, or None (no such stage reached)."""
    fort = (story or {}).get("fortress") or {}
    done = max(0, fortress_done(state) - fort.get("baseline", 0))
    found = None
    for st in fort.get("stages", []):
        if st.get("siege") and done >= st["tasks"]:
            found = st
    if found is None:
        return None
    rec = state.get("sieges", {}).get(found["id"], {})
    started, won, replay = bool(rec.get("started_at")), bool(rec.get("won_at")), bool(rec.get("won_at") and rec.get("replay_started_at"))
    active = started and (not won or replay)
    attack = _siege_attack(rec) if active else None
    away = sorted(k for k, kid in (state.get("kids") or {}).items() if attack and (kid.get("siege_away") or {}).get(found["id"]) == attack)
    return {"stage": found["id"], "active": active, "waiting": not started, "replay": replay,
            "started_at": rec.get("started_at"), "won_at": rec.get("won_at"), "lost": int(rec.get("lost", 0)),
            "replays": int(rec.get("replays", 0)), "replay_wins": int(rec.get("replay_wins", 0)), "game": found["siege"]["game"],
            "away": away, "won_kids": list(rec.get("kids") or []) if won else []}


def _siege_attack(rec: dict[str, Any]) -> str | None:
    """Which attack of the siege runs now (#118): the time the parent (or a child after the win) started it. A child who left it with the cross
    is away from this one only; a new start is a new attack and the panel goes into it again."""
    return rec.get("replay_started_at") or rec.get("started_at")


def siege_start(state: dict[str, Any], story: dict[str, Any] | None, ts: str) -> dict[str, Any]:
    """A parent starts the attack of the reached siege stage (idempotent: a running siege or replay changes nothing). After the win it starts a
    replay: only a game, nothing is given for it (addendum 1), except the amulet to a child who has not won the first battle (#118)."""
    info = siege_info(state, story)
    if info is None:
        raise HomeQuestError(ERR_INVALID_STATE, "no stage with a siege is reached")
    rec = state.setdefault("sieges", {}).setdefault(info["stage"], {"won_at": None, "lost": 0})
    if not rec.get("started_at"):
        rec["started_at"] = ts
        return {"stage": info["stage"], "changed": True, "replay": False}
    if rec.get("won_at") and not rec.get("replay_started_at"):
        rec["replay_started_at"] = ts
        rec["replays"] = int(rec.get("replays", 0)) + 1
        return {"stage": info["stage"], "changed": True, "replay": True}
    return {"stage": info["stage"], "changed": False, "replay": bool(rec.get("replay_started_at"))}


def siege_away(state: dict[str, Any], story: dict[str, Any] | None, kid_id: str, away: bool) -> dict[str, Any]:
    """The cross (#118): away = True, the child left the running attack (from the preparation or from the game): its panel does not go
    into the siege by itself any more (on any device), the lobby does not wait for it, nothing is lost or given. away = False: the Quest
    button "back into the battle" of this attack. Kept on the server per attack (kid.siege_away.<stage> = the attack's start time)."""
    kid = _kid(state, kid_id)
    info = siege_info(state, story)
    if info is None or not info["active"]:
        raise HomeQuestError(ERR_INVALID_STATE, "the fortress is not under siege")
    rec = state["sieges"][info["stage"]]
    marks = kid.setdefault("siege_away", {})
    if away:
        marks[info["stage"]] = _siege_attack(rec)
    else:
        marks.pop(info["stage"], None)
    return {"kid_id": kid_id, "stage": info["stage"], "away": bool(away)}


def siege_replay_by_kid(state: dict[str, Any], story: dict[str, Any] | None, kid_id: str, ts: str) -> dict[str, Any]:
    """The Quest button after the win (#118): a child starts a replay itself (only a game, as the parent's replay; a win gives the amulet to a child without it). Only
    this child goes into it: the other children are away from it (their panels stay as they are; they can come by their own Quest button)."""
    _kid(state, kid_id)
    info = siege_info(state, story)
    if info is None or not info["won_at"]:
        raise HomeQuestError(ERR_INVALID_STATE, "the siege is not won yet")
    if info["active"]:                                       # a replay runs already: just back into it
        return {**siege_away(state, story, kid_id, False), "replay": True, "changed": False}
    res = siege_start(state, story, ts)
    attack = _siege_attack(state["sieges"][info["stage"]])
    for k, kid in (state.get("kids") or {}).items():
        marks = kid.setdefault("siege_away", {})
        if k == kid_id:
            marks.pop(info["stage"], None)
        else:
            marks[info["stage"]] = attack
    return {"kid_id": kid_id, "stage": info["stage"], "away": False, "replay": True, "changed": res["changed"]}


def siege_stop(state: dict[str, Any], story: dict[str, Any] | None) -> dict[str, Any]:
    """A parent ends a running replay (the children did not finish it). The first siege is not stopped: it ends with the win."""
    info = siege_info(state, story)
    rec = state.get("sieges", {}).get(info["stage"], {}) if info else {}
    if not rec.get("replay_started_at"):
        return {"stage": info["stage"] if info else None, "changed": False}
    rec.pop("replay_started_at")
    return {"stage": info["stage"], "changed": True}


def siege_looks(state: dict[str, Any], kid_ids: list[str]) -> dict[str, Any]:
    """How the defenders look ({kid: {hero, equipped}}): a child's view has only its own kid, so its panel draws the other hero from this. Nothing
    else of the other child (coins, history, inventory) goes out."""
    kids = state.get("kids", {})
    return {k: {"hero": kids[k].get("hero"), "equipped": dict(kids[k].get("equipped") or {})} for k in kid_ids if k in kids}


def mark_scene_seen(state: dict[str, Any], story: dict[str, Any] | None, kid_id: str, stage_id: str, what: str = "scene") -> dict[str, Any]:
    """The child has seen the scene of a siege stage to the end (on any device): next time the panel goes straight to the preparation.
    what="won": the castellan's thanks after the won siege (kept as "won:<stage>" in kid["scenes"], #127: before only in the browser,
    so a new phone played the thanks again)."""
    kid = _kid(state, kid_id)
    _siege_stage(story, stage_id)
    if what not in ("scene", "won"):
        raise HomeQuestError(ERR_INVALID_PARAMS, "what: scene or won")
    key = stage_id if what == "scene" else f"won:{stage_id}"
    scenes = kid.setdefault("scenes", [])
    if key not in scenes:
        scenes.append(key)
    return {"kid_id": kid_id, "stage": stage_id, "what": what}


def mark_story_seen(state: dict[str, Any], story: dict[str, Any] | None, kid_id: str, what: str, index: int | None = None) -> dict[str, Any]:
    """The child has seen the intro (what="intro") or the celebration of a fortress stage up to `index` (what="stage") on some device: kid["seen"]
    = {intro, stage} (v1.4.0, #118). Before, this was only in the browser (localStorage), so a new phone played the intro again."""
    kid = _kid(state, kid_id)
    seen = kid.setdefault("seen", {"intro": False, "stage": 0})
    if what == "intro":
        seen["intro"] = True
    elif what == "stage":
        stages = ((story or {}).get("fortress") or {}).get("stages", [])
        if index is None or not 0 <= int(index) < len(stages):
            raise HomeQuestError(ERR_INVALID_PARAMS, "index: a stage of the fortress")
        seen["stage"] = max(int(seen.get("stage", 0)), int(index))
    elif what == "bow_hunt":                                           # #226 point 6: the "Máš luk!" window was closed
        seen["bow_hunt"] = True
    else:
        raise HomeQuestError(ERR_INVALID_PARAMS, "what: intro, stage or bow_hunt")
    return {"kid_id": kid_id, "seen": dict(seen)}


MIGRATION_SEEN = "v1.4-seen"


def migrate_seen(state: dict[str, Any], story: dict[str, Any] | None, ts: str) -> bool:
    """One-off (v1.4.0): what the children have seen moves to the server. A child with a hero and any completed task has seen the intro; the
    stage reached now counts as seen (PROD: both children saw the stage 2 scene of v1.3.2). Coins, items and history are not touched."""
    done = state.setdefault("migrations", [])
    if MIGRATION_SEEN in done:
        return False
    fort = (story or {}).get("fortress") or {}
    reached = max(0, fortress_done(state) - fort.get("baseline", 0))
    index = max([i for i, st in enumerate(fort.get("stages", [])) if reached >= st["tasks"]] or [0])
    for kid in state.get("kids", {}).values():
        if not kid.get("hero"):
            continue
        seen = kid.setdefault("seen", {"intro": False, "stage": 0})
        if _done_total(kid) > 0 or kid.get("history"):
            seen["intro"] = True
            seen["stage"] = max(int(seen.get("stage", 0)), index)
    done.append(MIGRATION_SEEN)
    return True


def siege_end(state: dict[str, Any], story: dict[str, Any] | None, stage_id: str, won: bool, kids: list[str], ts: str) -> dict[str, Any]:
    """The server's game of the siege ended: a win ends the siege (once; a later win changes nothing), a loss is only counted."""
    _siege_stage(story, stage_id)
    rec = state.setdefault("sieges", {}).setdefault(stage_id, {"won_at": None, "lost": 0})
    if rec.get("won_at"):
        if not rec.get("replay_started_at"):
            return {"stage": stage_id, "changed": False}
        if won:                                               # a won replay ends by itself; the first win and its gifts stay as they are
            rec.pop("replay_started_at")
            rec["replay_wins"] = int(rec.get("replay_wins", 0)) + 1
            # a child who did not finish the first battle (the cross, #118) earns its amulet by winning a replay (decided 2026-11-04)
            rec["kids"] = list(rec.get("kids") or []) + [k for k in kids if k not in (rec.get("kids") or [])]
        else:
            rec["replay_lost"] = int(rec.get("replay_lost", 0)) + 1
        return {"stage": stage_id, "changed": True, "replay": True}
    if won:
        rec["won_at"], rec["kids"] = ts, list(kids)
    else:
        rec["lost"] = int(rec.get("lost", 0)) + 1
    return {"stage": stage_id, "changed": True}


def claim_siege_gift(state: dict[str, Any], story: dict[str, Any] | None, kid_id: str, stage_id: str, color: Any, ts: str) -> dict[str, Any]:
    """The gift for the won siege: the amulet in the colour the child chose, once per child and stage (a second call, a second device or a
    replay gives nothing and keeps the first colour). A record in the history, no coins."""
    kid = _kid(state, kid_id)
    gives = _siege_stage(story, stage_id)["siege"]["gives"]
    if not gives:
        raise HomeQuestError(ERR_NOT_FOUND, f"the siege of '{stage_id}' gives nothing")
    rec = state.get("sieges", {}).get(stage_id) or {}
    if not rec.get("won_at"):
        raise HomeQuestError(ERR_INVALID_STATE, "the siege is not won yet")
    if rec.get("kids") is not None and kid_id not in rec["kids"]:      # left the winning game with the cross (#118): no amulet
        raise HomeQuestError(ERR_FORBIDDEN, "this child did not defend the fortress to the end")
    trophies = kid.setdefault("trophies", [])
    have = next((t for t in trophies if t.get("stage") == stage_id), None)
    if have:
        return {"kid_id": kid_id, "stage": stage_id, "color": have["color"], "claimed": False}
    if color not in gives["colors"]:
        raise HomeQuestError(ERR_INVALID_PARAMS, f"colour: one of {', '.join(gives['colors'])}")
    trophies.append({"id": gives["item"], "name": gives["name"], "color": color, "stage": stage_id, "at": ts})
    _history(kid, ts, type="gift", coins=0, note=gives["note"], stage=stage_id, item=gives["item"], color=color)
    if kid.get("hero"):                                       # the chosen amulet goes straight onto the hero (decided 2026-11-04); it comes off by a tap
        kid["equipped"][TROPHY_SLOT] = trophy_item_id(gives["item"], color)
    return {"kid_id": kid_id, "stage": stage_id, "color": color, "claimed": True}


# ---------------------------------------------------------------- trophies ---
# The amulet of a won siege is worn like an item (#118, v1.4.0) but it is not in catalog.yaml and never in the shop: the server derives one
# item per colour from story.yaml (siege.gives) and a child owns the one of its kid["trophies"]. Equipped as kid["equipped"]["neck"].

TROPHY_SLOT = "neck"
MIGRATION_BOW_HUNT = "v1.9-bow-hunt-seen"


def migrate_bow_hunt_seen(state: dict[str, Any], hunt_item: str | None) -> bool:
    """One-off (#226 point 6, v1.9.0-beta.2): a child who owns the hunt's item already (bought with beta 1) does not get "Máš luk!" afterwards.
    Coins, items and history are not touched."""
    done = state.setdefault("migrations", [])
    if MIGRATION_BOW_HUNT in done or not hunt_item:                # without the hunt's item it waits (not marked done)
        return False
    for kid in state.get("kids", {}).values():
        if hunt_item in (kid.get("inventory") or []):
            kid.setdefault("seen", {"intro": False, "stage": 0})["bow_hunt"] = True
    done.append(MIGRATION_BOW_HUNT)
    return True


MIGRATION_AMULET_WORN = "v1.4-amulet-worn"


def trophy_item_id(gift_item: str, color: str) -> str:
    """item_amulet_defender + blue -> amulet_defender_blue (the picture stays assets/story/item_amulet_defender_blue.webp)."""
    base = gift_item[5:] if gift_item.startswith("item_") else gift_item
    return f"{base}_{color}"


def trophy_items(story: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    """The wearable trophies of the story: {item id: item}, shaped like a catalog item for the client (shop false, price 0)."""
    out: dict[str, dict[str, Any]] = {}
    for stage in ((story or {}).get("fortress") or {}).get("stages", []):
        gives = (stage.get("siege") or {}).get("gives")
        if not gives:
            continue
        for color in gives["colors"]:
            iid = trophy_item_id(gives["item"], color)
            out[iid] = {"id": iid, "name": gives["name"], "slot": TROPHY_SLOT, "price": 0, "shop": False, "rarity": "legendary",
                        "body": "any", "trophy": True, "color": color,
                        "picture": f"story/{gives['item']}_{color}.webp"}       # no layer art yet: the client draws this picture on the neck
    return out


def trophy_ids(kid: dict[str, Any], story: dict[str, Any] | None) -> list[str]:
    """The wearable trophies the child owns (in the order won)."""
    items = trophy_items(story)
    ids = [trophy_item_id(t["id"], t["color"]) for t in kid.get("trophies") or [] if t.get("id") and t.get("color")]
    return [i for i in dict.fromkeys(ids) if i in items]


def migrate_amulet_worn(state: dict[str, Any], story: dict[str, Any] | None, ts: str) -> bool:
    """One-off (v1.4.0): a child who chose its amulet before it could be worn (TEST; nobody on PROD has one) wears it now, unless something is
    on its neck already. Coins, inventory and history are not touched."""
    done = state.setdefault("migrations", [])
    if MIGRATION_AMULET_WORN in done or not trophy_items(story):     # no siege in the story (or a broken story.yaml): try again next start
        return False
    for kid in state.get("kids", {}).values():
        own = trophy_ids(kid, story)
        if kid.get("hero") and own and not kid.setdefault("equipped", {}).get(TROPHY_SLOT):
            kid["equipped"][TROPHY_SLOT] = own[0]
    done.append(MIGRATION_AMULET_WORN)
    return True


# ------------------------------------------- v1.5: ids, notifications, story variables (#128) ---

MIGRATION_STORY_VARS = _story_vars.MIGRATION
NOTIFY_MAX = 10
_NOTIFY_RE = re.compile(r"^[a-z0-9_]+$")


def ensure_ids(state: dict[str, Any]) -> bool:
    """Stable ids (v1.5, #128): `install_id` of this install and `uuid` of every child, made once and never changed. The child's key in the
    state (karel, anna, ...) stays: it is the slug of the panel and of the events. Returns True when something was added."""
    changed = False
    if not state.get("install_id"):
        state["install_id"] = uuid.uuid4().hex
        changed = True
    for kid in state.get("kids", {}).values():
        if not kid.get("uuid"):
            kid["uuid"] = uuid.uuid4().hex
            changed = True
    return changed


# what another family may one day see of a child (heroes side by side); nothing is shared now, the view only marks the split
PUBLIC_KID_KEYS = ("uuid", "hero", "equipped", "trophies", "tasks_done_total")


def kid_split(kid_id: str, kid: dict[str, Any], name: str, install_id: str | None) -> dict[str, Any]:
    """The child in two parts (#128): `public` = what could be shared with other families one day (hero, outfit, trophies, counts, ids);
    `private` = what stays at home (slug, name, and the names of the other fields: coins, tasks, history, inventory, PIN, ...)."""
    public = {k: kid.get(k) for k in PUBLIC_KID_KEYS}
    public["install_id"] = install_id
    if public["tasks_done_total"] is None:
        public["tasks_done_total"] = _done_total(kid)
    private_fields = sorted(k for k in kid if k not in PUBLIC_KID_KEYS)
    return {"public": public, "private": {"slug": kid_id, "name": name, "fields": private_fields}}


def set_notify_targets(state: dict[str, Any], targets: Any) -> dict[str, Any]:
    """The parent's phones that get the task notifications: notify service names without the domain (mobile_app_<phone>). [] = none."""
    if not isinstance(targets, list) or any(not isinstance(t, str) or not _NOTIFY_RE.match(t) for t in targets):
        raise HomeQuestError(ERR_INVALID_PARAMS, "targets: a list of notify service names")
    clean = list(dict.fromkeys(targets))
    if len(clean) > NOTIFY_MAX:
        raise HomeQuestError(ERR_INVALID_PARAMS, f"at most {NOTIFY_MAX} phones")
    state["notify_targets"] = clean
    return {"notify_targets": clean}


def drop_report_repo(state: dict[str, Any]) -> bool:
    """#175 addendum 1: the setting "Kam hlásit problémy" is gone (reports go to one fixed repository); a value saved by v1.7-v1.9
    is dropped quietly on load, nothing else changes. True when there was one."""
    return state.pop("report_repo", None) is not None


def _coins_word(n: int) -> str:
    return "zlaťák" if n == 1 else ("zlaťáky" if n < 5 else "zlaťáků")


def task_notification(kind: str, kid_name: str, female: bool, task_name: str, reward: int = 0) -> dict[str, str]:
    """Title and text of a parent notification, word for word as the YAML automations of #67 wrote them (homequest_notify.yaml).
    kind: "pending" (waits for approval) or "done" (counted without approval)."""
    verb = "splnila" if female else "splnil"
    if kind == "pending":
        msg = f"{kid_name} {verb} úkol {task_name} a čeká na schválení."
    else:
        r = int(reward or 0)
        msg = f"{kid_name} {verb} úkol {task_name}" + (f" (+{r} {_coins_word(r)})" if r > 0 else "") + "."
    return {"title": "HomeQuest", "message": msg}


def set_story_vars(state: dict[str, Any], raw: Any) -> dict[str, Any]:
    """The parent's values of the story variables (Settings -> Story). A missing or empty key = the default of story.yaml / the made-up one."""
    if not isinstance(raw, dict):
        raise HomeQuestError(ERR_INVALID_PARAMS, "vars: a mapping")
    unknown = [k for k in raw if k not in _story_vars.VARS]
    if unknown:
        raise HomeQuestError(ERR_INVALID_PARAMS, f"unknown story variable: {', '.join(sorted(unknown))}")
    state["story_vars"] = _story_vars.clean(raw)
    return {"story_vars": dict(state["story_vars"])}


def migrate_story_vars(state: dict[str, Any], replaced: int) -> bool:
    """One-off (v1.5): the live story.yaml had real places and names (the first install) and they were turned into variables (`replaced` phrases,
    store.py); the real values become the parent's own setting, so the children read word for word the same text. A story without those
    phrases (another family, a new install) keeps the defaults. A value the parent has set already is never overwritten."""
    done = state.setdefault("migrations", [])
    if MIGRATION_STORY_VARS in done:
        return False
    if replaced > 0:
        state["story_vars"] = {**_story_vars.LEGACY_VALUES, **_story_vars.clean(state.get("story_vars"))}
    done.append(MIGRATION_STORY_VARS)
    return True


# ------------------------------------------------------------------ views ---


def pending_list(state: dict[str, Any], catalog: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for kid_id, kid in state.get("kids", {}).items():
        for task_id, entry in kid.get("tasks", {}).items():
            if entry["status"] == "pending" and task_id in catalog["tasks"]:
                out.append(
                    {
                        "kid": kid_id,
                        "kid_name": catalog["kids"][kid_id]["name"] if kid_id in catalog["kids"] else kid_id,
                        "task": task_id,
                        "name": catalog["tasks"][task_id]["name"],
                        "done_at": entry["done_at"],
                    }
                )
    return out


def fortress_stage(state: dict[str, Any], story: dict[str, Any] | None) -> int:
    """The index of the fortress stage reached (story.yaml fortress.stages, 0 = the first): what `min_stage` of a shop item compares with (#187)."""
    fort = (story or {}).get("fortress") or {}
    done = max(0, fortress_done(state) - fort.get("baseline", 0))
    idx = 0
    for i, st in enumerate(fort.get("stages", [])):
        if done >= st["tasks"]:
            idx = i
    return idx


def fortress_next(state: dict[str, Any], story: dict[str, Any] | None) -> dict[str, Any] | None:
    """For the parents' notification (Mal, #67/#118): how many completed tasks the next fortress stage still needs and whether the children can
    reach it today (it needs no more than the tasks of both children that are still open or waiting for approval). None without a next stage."""
    fort = (story or {}).get("fortress") or {}
    done = max(0, fortress_done(state) - fort.get("baseline", 0))
    nxt = next((st for st in fort.get("stages", []) if st["tasks"] > done), None)
    if nxt is None:
        return None
    todo = 0
    for kid in state.get("kids", {}).values():
        todo += sum(1 for e in kid.get("tasks", {}).values() if e["status"] in ("open", "pending"))
    left = nxt["tasks"] - done
    return {"stage": nxt["id"], "tasks": nxt["tasks"], "done": done, "left": left, "open_today": todo, "reachable_today": left <= todo}


def open_count(state: dict[str, Any], kid_id: str) -> int:
    kid = state.get("kids", {}).get(kid_id, {})
    return sum(1 for e in kid.get("tasks", {}).values() if e["status"] == "open")


def version_newer(latest: str, installed: str) -> bool:
    """v1.7 (#141): "1.7.1" > "1.7.0"; a pre-release ("1.8.0-beta.1") is never offered as newer; unreadable = False."""
    def parse(v: str) -> tuple[int, ...] | None:
        v = str(v or "").strip().lstrip("v")
        if not v or "-" in v:
            return None
        try:
            return tuple(int(x) for x in v.split("."))
        except ValueError:
            return None
    a, b = parse(latest), parse(installed)
    return bool(a and b and a > b)
