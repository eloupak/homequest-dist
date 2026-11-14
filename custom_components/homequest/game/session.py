"""One game session in memory (lobby -> running -> finished) and the hub that holds the current one.

Nothing is written anywhere: no state file, no coins, no history. A restart of Home Assistant drops the session."""

from __future__ import annotations

import asyncio
import random
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import yaml

from . import engine, engine_v2

CONFIG_DIR = Path(__file__).parent / "configs"
TICK_S = 0.1
FINISHED_KEEP_MS = 10 * 60 * 1000


class GameError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def now_ms() -> int:
    return int(time.time() * 1000)


def load_config(game: str) -> dict:
    if not game.replace("_", "").isalnum():
        raise GameError("not_found", f"unknown game '{game}'")
    path = CONFIG_DIR / f"{game}.yaml"
    if not path.is_file():
        raise GameError("not_found", f"unknown game '{game}'")
    return yaml.safe_load(path.read_text(encoding="utf-8"))


class GameSession:
    def __init__(self, sid: str, cfg: dict, host: str, clock: Callable[[], int], seed: int | None = None, siege: dict | None = None) -> None:
        self.id = sid
        self.cfg = cfg
        self.host = host                      # token of the connection that created it: only it starts the game
        self.clock = clock
        self.seed = seed if seed is not None else random.randrange(1, 2**32)
        self.phase = "lobby"                  # lobby | running | finished
        self.players: list[dict] = []
        self.start_ms = 0                     # server clock at sim time 0 (after the countdown)
        self.objs: list[dict] = []
        self.state: dict | None = None
        self.check = 0
        self.finished_ms = 0
        self.v2 = cfg.get("engine") == "v2"
        self.sim: engine_v2.Sim | None = None
        self.siege = siege                    # the siege of the fortress (#118): {stage, kids} - only those children, it starts when all are ready
        self.ready: list[str] = []            # siege: pids that pressed Start
        self.reported = False                 # the end was handed to GameHub.on_finish

    # ------------------------------------------------------------- lobby
    def join(self, owner: str, kind: str, kid_id: str | None, name: str, level: str) -> dict:
        if self.phase != "lobby":
            raise GameError("busy", "the game has already started")
        if len(self.players) >= int(self.cfg["lanes_max"]):
            raise GameError("full", "all lanes are taken")
        if level not in self.cfg["levels"]:
            level = "normal"
        if kind == "kid":
            if not kid_id:
                raise GameError("invalid", "kid_id missing")
            pid = kid_id
        else:
            kind = "guest"
            n = 1
            while f"guest-{n}" in {p["pid"] for p in self.players}:
                n += 1
            pid = f"guest-{n}"
        if any(p["pid"] == pid for p in self.players):
            raise GameError("taken", f"{pid} is already in the game")
        pl = {"pid": pid, "name": name or pid, "kind": kind, "kid_id": kid_id if kind == "kid" else None, "level": level, "owner": owner}
        self.players.append(pl)
        return pl

    def leave(self, pid: str) -> None:
        """Leaving is possible in the lobby only; a running game is ended by the host (GameHub.end)."""
        if self.phase == "lobby":
            self.players = [p for p in self.players if p["pid"] != pid]
            self.ready = [r for r in self.ready if r != pid]

    def drop_owner(self, owner: str) -> bool:
        """A connection went away: its players leave a lobby. True when the lobby changed."""
        if self.phase != "lobby":
            return False
        before = len(self.players)
        self.players = [p for p in self.players if p["owner"] != owner]
        self.ready = [r for r in self.ready if any(p["pid"] == r for p in self.players)]
        return len(self.players) != before

    # ------------------------------------------------------------- run
    def lanes(self) -> list[dict]:
        out = []
        for i, p in enumerate(self.players):
            spd, win = engine.player_numbers(self.cfg, p["level"])
            out.append({**p, "lane": i, "speed_pm": spd, "window_pm": win})
        return out

    def start(self, owner: str) -> None:
        if self.siege is None and owner != self.host and not any(p["owner"] == owner for p in self.players):    # the host or anyone who joined (a host whose connection dropped would block the lobby)
            raise GameError("forbidden", "only the one who created the game or a joined player starts it")
        if self.phase != "lobby":
            raise GameError("busy", "the game has already started")
        if not self.players:
            raise GameError("invalid", "nobody has joined")
        if self.v2:
            self.objs = engine_v2.generate(self.cfg, self.seed, self.lanes())
            self.check = engine_v2.timeline_check(self.objs)
            self.sim = engine_v2.Sim(self.cfg, self.objs, self.lanes())
            self.state = self.sim.public()
        else:
            self.objs = engine.generate(self.cfg, self.seed, self.lanes())
            self.check = engine.timeline_check(self.objs)
            self.state = engine.new_state(self.cfg, len(self.players))
        self.start_ms = self.clock() + int(self.cfg["countdown_ms"])
        self.phase = "running"

    def sim_now(self) -> int:
        return self.clock() - self.start_ms

    def tick(self) -> bool:
        """Advance the shared state with the server clock. True when something changed (state or phase)."""
        if self.phase != "running":
            return False
        if self.v2:
            sim = self.sim
            before = (sim.status, tuple(h["lives"] for h in sim.heroes), sim.gems, tuple(sim.kills))
            sim.run_to(self.sim_now() - int(self.cfg["grace_ms"]))
            self.state = sim.public()
            if sim.status != "running":
                self.phase, self.finished_ms = "finished", self.clock()
                return True
            return before != (sim.status, tuple(h["lives"] for h in sim.heroes), sim.gems, tuple(sim.kills))
        changed = engine.advance(self.state, self.objs, self.sim_now(), int(self.cfg["grace_ms"]))
        if self.state["status"] != "running":
            self.phase, self.finished_ms = "finished", self.clock()
            changed = True
        return changed

    def event(self, pid: str, t: int, action: str | None = None) -> dict:
        if self.phase != "running":
            raise GameError("not_running", "the game is not running")
        lane = next((i for i, p in enumerate(self.players) if p["pid"] == pid), None)
        if lane is None:
            raise GameError("not_found", f"{pid} is not in the game")
        if self.v2:
            return self._event_v2(lane, int(t), action or "swing")
        res = engine.apply_tap(self.state, self.objs, lane, int(t), self.sim_now(), int(self.cfg["grace_ms"]))
        if self.state["status"] != "running":
            self.phase, self.finished_ms = "finished", self.clock()
        return res

    def _event_v2(self, lane: int, t: int, action: str) -> dict:
        """An action with its own sim time t. The time of the action counts, not the time of delivery; the server settles the state
        `grace_ms` behind its clock, so an action older than that is refused (it never has to rewind)."""
        grace = int(self.cfg["grace_ms"])
        if action not in engine_v2.ACTIONS:
            raise GameError("invalid", f"unknown action '{action}'")
        if t < 0:
            return {"ok": False, "reason": "before_start"}
        if t > self.sim_now() + grace:
            return {"ok": False, "reason": "future"}
        if t - t % self.sim.step_ms <= self.sim.cursor:
            return {"ok": False, "reason": "late"}
        self.sim.add_event({"lane": lane, "action": action, "t": t})
        self.state = self.sim.public()
        return {"ok": True}

    # ------------------------------------------------------------- view
    def snapshot(self) -> dict[str, Any]:
        return {
            "id": self.id, "game": self.cfg["game"], "phase": self.phase, "host": self.host, "seed": self.seed, "start_ms": self.start_ms,
            "server_ms": self.clock(), "players": self.lanes(), "config": self.cfg, "check": self.check, "state": self.state,
            "siege": self.siege, "ready": list(self.ready),
        }

    def public_state(self) -> dict[str, Any]:
        return {"id": self.id, "phase": self.phase, "state": self.state, "server_ms": self.clock()}


class GameHub:
    """The one current session of the instance (a proof of concept) and the listeners that watch it."""

    def __init__(self, clock: Callable[[], int] = now_ms) -> None:
        self.clock = clock
        self.session: GameSession | None = None
        self.listeners: dict[int, Callable[[str, dict], None]] = {}
        self.on_finish: Callable[[GameSession], None] | None = None     # the end of a game (once per session): the siege records its win
        self._n = 0
        self._ticker: asyncio.Task | None = None

    def add_listener(self, cb: Callable[[str, dict], None]) -> int:
        self._n += 1
        self.listeners[self._n] = cb
        return self._n

    def remove_listener(self, lid: int) -> None:
        self.listeners.pop(lid, None)

    def emit(self, kind: str = "session") -> None:
        s = self.session
        payload = {"session": s.snapshot() if s else None} if kind == "session" else (s.public_state() if s else {})
        for cb in list(self.listeners.values()):
            cb(kind, payload)

    def current(self) -> dict:
        self.sweep()
        return {"session": self.session.snapshot() if self.session else None, "server_ms": self.clock()}

    def sweep(self) -> None:
        s = self.session
        if s and s.phase == "finished" and self.clock() - s.finished_ms > FINISHED_KEEP_MS:
            self.session = None

    def create(self, owner: str, game: str, siege: dict | None = None) -> GameSession:
        self.sweep()
        if self.session and self.session.phase == "running":
            raise GameError("busy", "a game is running")
        cfg = load_config(game)
        self.session = GameSession(f"g{self.clock()}", cfg, owner, self.clock, siege=siege)
        self.emit()
        return self.session

    def need(self, sid: str) -> GameSession:
        if not self.session or self.session.id != sid:
            raise GameError("not_found", "that game does not exist (any more)")
        return self.session

    def start(self, sid: str, owner: str) -> None:
        s = self.need(sid)
        s.start(owner)
        self.emit()
        self._run()

    def end(self, sid: str, owner: str) -> None:
        s = self.need(sid)
        if owner != s.host:
            raise GameError("forbidden", "only the one who created the game ends it")
        s.phase, s.finished_ms = "finished", self.clock()
        if s.state and s.state["status"] == "running":
            s.state["status"] = "aborted"
        self.finished(s)
        self.emit()

    def finished(self, s: GameSession) -> None:
        """Hand the end of a game to on_finish, once."""
        if s.phase != "finished" or s.reported:
            return
        s.reported = True
        if self.on_finish:
            self.on_finish(s)

    def win_test(self, s: GameSession) -> None:
        """TEST only ("Vyhrát"): a running game ends as won by the real path (state, on_finish, the same events as a real win)."""
        if s.phase != "running":
            raise GameError("not_running", "the game is not running")
        if s.v2:
            s.sim.status, s.sim.end_t = "won", s.sim.cursor
            s.state = s.sim.public()
        else:
            s.state["status"] = "won"
        s.phase, s.finished_ms = "finished", self.clock()
        self.emit("state")
        self.finished(s)
        self.emit()

    def drop_owner(self, owner: str) -> None:
        if self.session and self.session.drop_owner(owner):
            self.emit()

    def _run(self) -> None:
        if self._ticker and not self._ticker.done():
            return
        self._ticker = asyncio.get_running_loop().create_task(self._loop())

    async def _loop(self) -> None:
        while self.session and self.session.phase == "running":
            await asyncio.sleep(TICK_S)
            s = self.session
            if s is None:
                return
            if s.tick():
                self.emit("state")
                if s.phase == "finished":
                    self.finished(s)
                    self.emit()
