"""The siege of the fortress (#118): the children play Obrana brány v2 together from their own panels, once both are in and both pressed Start.
The commands once for both transports (the HA websocket and tools/mock_ha.py): (hub, owner, command, message, kid, kids, siege) -> result.

A child acts only as itself (pid = its kid id), so a child who reopens the panel during the game takes its hero back. `siege` is the siege of the
state (logic.siege_info + the children who play and how they look): {stage, game, kids, looks} or None when the fortress is not under siege; then
nothing can be joined. A join answers {pid, looks}: a child's view has only its own kid, the panel draws the other hero from the looks."""

from __future__ import annotations

from typing import Any

from .session import GameError, GameHub, GameSession


def siege_session(hub: GameHub) -> GameSession | None:
    s = hub.session
    return s if s is not None and s.siege is not None else None


def view(hub: GameHub) -> dict[str, Any]:
    """What a child's panel sees: only a siege session (a test game of the parent's games panel is not shown)."""
    hub.sweep()
    s = siege_session(hub)
    return {"session": s.snapshot() if s else None, "server_ms": hub.clock()}


def handle(hub: GameHub, owner: str, cmd: str, msg: dict, kid_id: str, kids: dict, siege: dict | None) -> dict[str, Any]:
    """kids: the catalog's kids {id: {name, ...}}. Raises GameError."""
    if cmd == "ping":
        return {"t": hub.clock()}
    if cmd == "state":
        return {**view(hub), "me": owner}
    s = siege_session(hub)
    if cmd == "join":
        if siege is None:
            raise GameError("not_active", "the fortress is not under siege")
        if kid_id not in siege["kids"]:
            raise GameError("forbidden", "this child does not defend the fortress")
        if s is not None and s.phase == "running":
            if left_game(s, kid_id):
                raise GameError("left", "this child left the running defence")   # the cross (#118): no way back into this game
            if any(p["pid"] == kid_id for p in s.players):
                return {"pid": kid_id, "looks": siege.get("looks") or {}}     # back in the running game (the panel was reopened)
            raise GameError("busy", "the defence has already started")
        if s is None or s.phase == "finished" or s.siege["stage"] != siege["stage"]:
            if hub.session is not None and hub.session.phase == "running":
                raise GameError("busy", "another game is running")
            s = hub.create(owner, siege["game"], siege={"stage": siege["stage"], "kids": list(siege["kids"])})
        mine = next((p for p in s.players if p["pid"] == kid_id), None)
        if mine is not None:
            mine["owner"] = owner                         # the same child from a new connection (another phone or a reload)
        else:
            s.join(owner, "kid", kid_id, kids.get(kid_id, {}).get("name") or kid_id, "normal")
        hub.emit()
        return {"pid": kid_id, "looks": siege.get("looks") or {}}     # how both heroes look (a child's view has only its own)
    if s is None:
        raise GameError("not_found", "there is no defence to join")
    if cmd == "leave":
        lane = next((i for i, p in enumerate(s.players) if p["pid"] == kid_id), None)
        if s.phase == "running" and s.v2 and lane is not None:
            # the cross in a running game (#118): the hero leaves for good at the server's time; the other one plays on alone,
            # everybody gone = the game ends without a result (status "left", see engine_v2._leave)
            if not left_game(s, kid_id):
                s.sim.add_event({"lane": lane, "action": "leave", "t": max(0, s.sim_now())})
                s.state = s.sim.public()
                hub.emit("state")
            return {"left": True}
        s.leave(kid_id)
        hub.emit()
        return {}
    if cmd == "ready":
        if s.phase != "lobby" or not any(p["pid"] == kid_id for p in s.players):
            raise GameError("not_found", "join the defence first")
        if kid_id not in s.ready:
            s.ready.append(kid_id)
        if siege is not None:
            s.siege["kids"] = list(siege["kids"])          # who is waited for now (a child away from the attack is not, #118)
        if not start_when_ready(hub, s, owner):
            hub.emit()
        return {"started": s.phase == "running"}
    if cmd == "event":
        res = s.event(kid_id, int(msg["t"]), msg.get("action"))
        hub.emit("state")
        if s.phase == "finished":
            hub.finished(s)
            hub.emit()
        return res
    raise GameError("invalid", f"unknown siege command '{cmd}'")


def start_when_ready(hub: GameHub, s: GameSession, owner: str | None = None) -> bool:
    """The lobby starts when every child waited for has joined and pressed Start (the last one starts it; emits). True when it started."""
    need = set(s.siege["kids"])
    joined = {p["pid"] for p in s.players}
    if s.phase != "lobby" or not need or not need <= joined or not need <= set(s.ready):
        return False
    hub.start(s.id, owner or next(p["owner"] for p in s.players if p["pid"] in need))
    return True


def refresh_kids(hub: GameHub, siege: dict | None) -> None:
    """A child left the attack or came back (#118): the lobby waits for the children of the siege now; the ones left may start alone
    (when all of them pressed Start already, it starts)."""
    s = siege_session(hub)
    if s is None or s.phase != "lobby" or siege is None or s.siege["stage"] != siege["stage"]:
        return
    s.siege["kids"] = list(siege["kids"])
    if not start_when_ready(hub, s):
        hub.emit()


def abort(hub: GameHub) -> bool:
    """The parent ended the attack (a replay): a lobby or a running game of the siege ends without a result. True when there was one."""
    s = siege_session(hub)
    if s is None or s.phase == "finished":
        return False
    s.phase, s.finished_ms = "finished", hub.clock()
    if s.state and s.state.get("status") == "running":
        s.state["status"] = "aborted"
    hub.finished(s)
    hub.emit()
    return True


def win_test(hub: GameHub, kid_id: str) -> dict[str, Any]:
    """TEST only ("Vyhrát", the caller checks env_test): the running siege game ends as won by the real path (on_finish -> won_at, thanks, amulet)."""
    s = siege_session(hub)
    if s is None or s.phase != "running" or not any(p["pid"] == kid_id for p in s.players):
        raise GameError("not_running", "no running defence of this child")
    hub.win_test(s)
    return {"won": True}


def left_game(s: GameSession, kid_id: str) -> bool:
    """True when the child left this game with the cross (#118): its leave is in the log (the state settles it grace_ms later)."""
    lane = next((i for i, p in enumerate(s.players) if p["pid"] == kid_id), None)
    events = s.sim.events if s.sim is not None else ((s.state or {}).get("events") or [])
    return lane is not None and any(e["lane"] == lane and e["action"] == "leave" for e in events)


def result(s: GameSession) -> tuple[str, bool, list[str]] | None:
    """(stage, won, kids) of a finished siege game for the state, or None (not a siege, aborted, everybody left).
    A child who left with the cross (#118) is not among the kids: no loss, no thanks, no amulet, no replay counted for it."""
    if s.siege is None or not s.state or s.state.get("status") not in ("won", "lost"):
        return None
    kids = [p["pid"] for p in s.players if not left_game(s, p["pid"])]
    return s.siege["stage"], s.state["status"] == "won", kids
