"""The learning commands once, for both transports (the HA websocket and tools/mock_ha.py): (hub, command, message, kids) -> result."""

from __future__ import annotations

from typing import Any

from .learning import LearnError, LearningHub, _kid, done_today, ham_state, overview, public, reward_open


def _kid_ids(kids: dict, msg: dict) -> str:
    kid = msg.get("kid_id")
    if kid not in kids:
        raise LearnError("not_found", f"unknown kid '{kid}'")
    return kid


def handle(hub: LearningHub, cmd: str, msg: dict, kids: dict) -> dict[str, Any]:
    """kids: the catalog's kids {id: {name, ...}}. Raises LearnError."""
    cfg = hub.cfg
    if cmd == "state":
        day = hub.today()
        return {"ops": cfg["learning"]["ops"], "set_size": cfg["learning"]["set_size"], "scene": cfg["scene"], "daily": cfg["learning"]["daily"],
                "day": day, "reward": cfg["learning"]["reward"],
                "kids": {k: {"done_today": done_today(hub.data, k, day, cfg), **ham_state(_kid(hub.data, k), cfg),
                             "reward_open": {op: reward_open(_kid(hub.data, k), op, day) for op in cfg["learning"]["ops"]}} for k in kids}}
    if cmd == "start":
        s = hub.start(_kid_ids(kids, msg), msg.get("op"))
        kd = _kid(hub.data, s.kid)
        return {"set_id": s.id, "op": s.op, "size": s.size, "problem": public(s.current), "hits": 0, "reward_open": reward_open(kd, s.op, s.day), **ham_state(kd, cfg)}
    if cmd == "answer":
        raw = msg.get("answer")
        value = int(raw) if isinstance(raw, (int, float)) or (isinstance(raw, str) and raw.lstrip("-").isdigit()) else None
        ms = msg.get("ms")
        return hub.answer(msg["set_id"], value, int(ms) if isinstance(ms, (int, float)) else None)
    if cmd == "overview":
        return {"kid_id": _kid_ids(kids, msg), "ops": overview(hub.data, msg["kid_id"], cfg, int(msg.get("top") or 5))}
    raise LearnError("invalid", f"unknown learning command '{cmd}'")
