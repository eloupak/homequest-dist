"""v1.8 (#173, #177, #178, #166): the children's tasks as HA To-do lists - pure functions, no HA imports (tested without HA).

One list per child (todo.homequest_<slug>). Its items are exactly the tasks the child sees in the game today (views/quests.js):
today's daily tasks from the frozen day plan, and the parent's active one-off tasks the child has not had approved yet.
The texts (reward, "waiting for approval", errors) come from the integration's translations, here only their keys and numbers.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from .logic import ERR_INVALID_PARAMS, ONEOFF_REWARD_MAX, HomeQuestError

ORDER = {"open": 0, "pending": 1, "approved": 2}
HA_REWARD_DEFAULT = 1                 # Rodič -> Nastavení hry -> Úkoly z Home Assistantu: the reward of a task added in an HA list


def uid_of(task_id: str, period_key: str | None) -> str:
    """Daily: `<task>:<day>` (a new day = a new item, HA never joins yesterday's and today's "Ustlat"); one-off: its id."""
    return task_id if task_id.startswith("oneoff_") else f"{task_id}:{period_key}"


def task_of_uid(uid: str) -> str:
    return uid.split(":", 1)[0]


def plural(n: int) -> str:
    """The Czech plural form of a number of coins (1 / 2-4 / 0 and 5+); the English texts use the same keys."""
    return "one" if n == 1 else ("few" if 2 <= n <= 4 else "many")


def _rejected_today(kid: dict[str, Any], task_id: str, today: date) -> bool:
    """The parent sent the task back today and it is open again (the last word about it today is a rejection)."""
    for e in reversed(kid.get("history") or []):
        if e.get("task") != task_id:
            continue
        return e.get("type") == "rejected" and str(e.get("ts", ""))[:10] == today.isoformat()
    return False


def kid_items(state: dict[str, Any], catalog: dict[str, Any], kid_id: str, today: date) -> list[dict[str, Any]]:
    """The items of one child's list, in the game's order (daily first, then one-off; open, waiting, done).
    Each: uid, task_id, name, status (open|pending|approved), kind (open|rejected|pending|approved), reward, single, due (date or None)."""
    kid = (state.get("kids") or {}).get(kid_id)
    if kid is None:
        return []
    tasks = kid.get("tasks") or {}
    plan = state.get("day_plan") or {}
    plan_ids = set(plan.get("tasks") or []) if plan.get("date") == today.isoformat() else None
    single_daily = set(plan.get("single") or []) if plan_ids is not None else set()
    daily: list[dict[str, Any]] = []
    for t in catalog["tasks"].values():
        if t.get("period") != "daily" or t["id"] not in tasks:
            continue
        if not (t["id"] in plan_ids if plan_ids is not None else not t.get("archived")):
            continue
        st = tasks[t["id"]]
        daily.append(_item(kid, t["id"], t["name"], int(t.get("reward") or 0), t["id"] in single_daily, st, today, today))
    oneoff: list[dict[str, Any]] = []
    for o in (state.get("oneoffs") or {}).values():
        st = tasks.get(o["id"])
        if o.get("status") != "active" or st is None or st.get("status") == "approved":
            continue
        oneoff.append(_item(kid, o["id"], o["name"], int(o.get("reward") or 0), bool(o.get("single")), st, None, today))
    key = lambda i: ORDER.get(i["status"], 9)                               # noqa: E731  (a stable sort, like the game)
    return sorted(daily, key=key) + sorted(oneoff, key=key)


def _item(kid: dict[str, Any], task_id: str, name: str, reward: int, single: bool, st: dict[str, Any], due: date | None, today: date) -> dict[str, Any]:
    status = st.get("status", "open")
    kind = status
    if status == "open" and _rejected_today(kid, task_id, today):
        kind = "rejected"
    return {"uid": uid_of(task_id, st.get("period_key")), "task_id": task_id, "name": name, "status": status, "kind": kind,
            "reward": reward, "single": single, "due": due}


def find(items: list[dict[str, Any]], uid: str | None) -> dict[str, Any] | None:
    return next((i for i in items if i["uid"] == uid), None)


# ------------------------------------------------------------- HA -> game --

def decide_update(cur: dict[str, Any], new_status: str, renamed: bool, actor: str) -> str:
    """What an update of an item in HA means. `actor`: kid (the list's own child), parent, automation (no user), other (a sibling, anybody else).
    Returns complete | reject | none, or raises HomeQuestError(code) with the translation key of the error as the code."""
    if actor == "other":
        raise HomeQuestError("not_your_list")
    if renamed:
        raise HomeQuestError("edit_in_game")
    done = new_status == "completed"
    if done:
        if cur["status"] == "open":
            return "complete"
        return "none"                                                     # done already (the game or another phone was faster): nothing twice
    if cur["status"] == "open":
        return "none"
    if cur["status"] == "approved":
        raise HomeQuestError("cannot_undo_approved")
    if actor != "parent":                                                 # waiting for approval: only a parent may send it back (= Zamítnout)
        raise HomeQuestError("only_parent_can_undo")
    return "reject"


def may_add(actor: str) -> None:
    """A new item in a child's list (todo.add_item, Assist, the + in the list) and homequest.add_task: a parent or an automation, never a child."""
    if actor not in ("parent", "automation"):
        raise HomeQuestError("only_parent_can_add")


def same_open_oneoff(state: dict[str, Any], name: str, kids: list[str] | None, single: bool) -> str | None:
    """skip_if_open of homequest.add_task: the id of an active one-off task with the same name for the same children (None = all), or None."""
    want = name.strip().casefold()
    for o in (state.get("oneoffs") or {}).values():
        if o.get("status") == "active" and o["name"].strip().casefold() == want and (o.get("kids") or None) == (kids or None) and bool(o.get("single")) == single:
            return o["id"]
    return None


def set_ha_reward(state: dict[str, Any], reward: Any) -> dict[str, Any]:
    """Rodič -> Nastavení hry -> Úkoly z Home Assistantu: the reward of a task added straight into a child's list in HA."""
    if isinstance(reward, bool) or not isinstance(reward, int) or not 0 <= reward <= ONEOFF_REWARD_MAX:
        raise HomeQuestError(ERR_INVALID_PARAMS, f"reward: a whole number 0-{ONEOFF_REWARD_MAX}")
    state["ha_task_reward"] = reward
    return {"ha_task_reward": reward}


def ha_reward(state: dict[str, Any]) -> int:
    v = state.get("ha_task_reward")
    return HA_REWARD_DEFAULT if v is None else int(v)
