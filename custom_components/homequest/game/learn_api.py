"""The learning commands once, for both transports (the HA websocket and tools/mock_ha.py): (hub, command, message, kids) -> result.

Who may do what (#189, v1.9: the hunt is in the child's game): `as_kid` = the child the caller acts as (a child's own account or a child
panel); None = a parent (admin), who may act for any child (the test panel "HomeQuest Učení"). A child sees and plays only itself; the
overview of problematic problems is the parent's. `entry` = {kid: (open, reason)} from the caller (the fortress stage and the bow, store side):
a child whose hunt is closed cannot start a set."""

from __future__ import annotations

from typing import Any

from .learning import LearnError, LearningHub, _kid, animals, default_mode, done_today, ham_state, overview, public, public_ground, reward_open, sell_min_stage


def _kid_ids(kids: dict, msg: dict, as_kid: str | None = None) -> str:
    kid = msg.get("kid_id") or as_kid
    if kid not in kids:
        raise LearnError("not_found", f"unknown kid '{kid}'")
    if as_kid is not None and kid != as_kid:
        raise LearnError("forbidden", "a child plays only for itself")
    return kid


def _own_set(hub: LearningHub, msg: dict, as_kid: str | None) -> None:
    s = hub.need(msg["set_id"])
    if as_kid is not None and s.kid != as_kid:
        raise LearnError("forbidden", "not your hunt")


def handle(hub: LearningHub, cmd: str, msg: dict, kids: dict, as_kid: str | None = None, entry: dict | None = None, stage: int | None = None) -> dict[str, Any]:
    """kids: the catalog's kids {id: {name, ...}}. stage: the fortress stage reached (sell_hams waits for sell_min_stage; None = not checked). Raises LearnError."""
    cfg = hub.cfg
    if cmd == "state":
        day = hub.today()
        shown = [as_kid] if as_kid is not None else list(kids)
        gm = hub.grounds(day)
        gid = {op: (gm.get(op) or {}).get("id") for op in cfg["learning"]["ops"]}
        return {"ops": cfg["learning"]["ops"], "set_size": cfg["learning"]["set_size"], "scene": cfg["scene"], "daily": cfg["learning"]["daily"],
                "day": day, "reward": cfg["learning"]["reward"], "mode": default_mode(cfg), "animals": animals(cfg), "aim": cfg.get("aim") or {},
                "entry": cfg.get("entry") or {}, "grounds": {op: public_ground(g) for op, g in gm.items()},
                "kids": {k: {"done_today": done_today(hub.data, k, day, cfg), **ham_state(_kid(hub.data, k), cfg),
                             "reward_open": {op: reward_open(_kid(hub.data, k), op, day, gid[op]) for op in cfg["learning"]["ops"]},
                             **({"open": bool(entry[k][0]), "locked": entry[k][1]} if entry and k in entry else {})} for k in shown if k in kids}}
    if cmd == "start":
        kid = _kid_ids(kids, msg, as_kid)
        if as_kid is not None and entry is not None and not (entry.get(kid) or (False, ""))[0]:
            raise LearnError("locked", (entry.get(kid) or (False, "the hunt is closed"))[1] or "the hunt is closed")
        s = hub.start(kid, msg.get("op"), msg.get("mode"))
        kd = _kid(hub.data, s.kid)
        return {"set_id": s.id, "op": s.op, "size": s.size, "mode": s.mode, "problem": public(s.current), "hits": 0, "reward_open": reward_open(kd, s.op, s.day, s.ground["id"] if s.ground else None),
                "ground": public_ground(s.ground), **ham_state(kd, cfg)}
    if cmd == "answer":
        _own_set(hub, msg, as_kid)
        raw = msg.get("answer")
        value = int(raw) if isinstance(raw, (int, float)) or (isinstance(raw, str) and raw.lstrip("-").isdigit()) else None
        ms = msg.get("ms")
        return hub.answer(msg["set_id"], value, int(ms) if isinstance(ms, (int, float)) else None)
    if cmd == "shot":
        _own_set(hub, msg, as_kid)
        return hub.shot(msg["set_id"], bool(msg.get("hit")))
    if cmd == "quit":                                                   # addendum 7 (#189): the cross = the end of the round now
        _own_set(hub, msg, as_kid)
        return hub.quit(msg["set_id"])
    if cmd == "sell_hams":                                              # #226: the ham in the shop
        kid = _kid_ids(kids, msg, as_kid)
        if stage is not None and stage < sell_min_stage(cfg):
            raise LearnError("locked", "the shop buys hams from a higher fortress stage")
        return hub.sell(kid)
    if cmd == "overview":
        if as_kid is not None:
            raise LearnError("forbidden", "the overview is for parents")
        return {"kid_id": _kid_ids(kids, msg), "ops": overview(hub.data, msg["kid_id"], cfg, int(msg.get("top") or 5))}
    raise LearnError("invalid", f"unknown learning command '{cmd}'")
