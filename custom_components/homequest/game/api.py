"""The game commands once, for both transports (the HA websocket and tools/mock_ha.py): (hub, owner, command, message, kids) -> result."""

from __future__ import annotations

from typing import Any

from .session import GameError, GameHub


def handle(hub: GameHub, owner: str, cmd: str, msg: dict, kids: dict) -> dict[str, Any]:
    """kids: the catalog's kids {id: {name, ...}} (names for kid players). Raises GameError."""
    if cmd == "ping":
        return {"t": hub.clock()}
    if cmd == "state":
        return {**hub.current(), "me": owner}
    if cmd == "create":
        s = hub.create(owner, msg.get("game") or "defend_gate")
        return {"id": s.id}
    if cmd == "join":
        s = hub.need(msg["session_id"])
        kind = msg.get("kind") or "kid"
        kid_id = msg.get("kid_id")
        if kind == "kid":
            if kid_id not in kids:
                raise GameError("not_found", f"unknown kid '{kid_id}'")
            name = kids[kid_id].get("name") or kid_id
        else:
            name = (msg.get("name") or "Host")[:20]
        pl = s.join(owner, kind, kid_id, name, msg.get("level") or "normal")
        hub.emit()
        return {"pid": pl["pid"]}
    if cmd == "leave":
        s = hub.need(msg["session_id"])
        s.leave(msg["pid"])
        hub.emit()
        return {}
    if cmd == "start":
        hub.start(msg["session_id"], owner)
        return {}
    if cmd == "end":
        hub.end(msg["session_id"], owner)
        return {}
    if cmd == "win":                                    # TEST only (the games panel is registered only on TEST): "Vyhrát"
        hub.win_test(hub.need(msg["session_id"]))
        return {"won": True}
    if cmd == "event":
        s = hub.need(msg["session_id"])
        res = s.event(msg["pid"], int(msg["t"]), msg.get("action"))
        hub.emit("state")
        if s.phase == "finished":
            hub.finished(s)
            hub.emit()
        return res
    raise GameError("invalid", f"unknown game command '{cmd}'")
