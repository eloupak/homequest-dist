"""Deterministic timeline and shared state of the minigames (whole milliseconds, no floats).

Server and clients generate the same orc timeline from (config, seed, players); the JS port is frontend/games/lib/timeline.js and
tests/vectors check that both give the same numbers. The shared state (wall hp, hits, breaches) is a plain reducer: the server
runs it with its own clock, the client only shows it."""

from __future__ import annotations

from typing import Any

M32 = 0xFFFFFFFF


class Mulberry32:
    def __init__(self, seed: int) -> None:
        self.a = seed & M32

    def next_u32(self) -> int:
        self.a = (self.a + 0x6D2B79F5) & M32
        t = self.a
        t = ((t ^ (t >> 15)) * (t | 1)) & M32
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & M32)) & M32
        return (t ^ (t >> 14)) & M32

    def below(self, n: int) -> int:
        return self.next_u32() % n


def player_numbers(cfg: dict, level: str) -> tuple[int, int]:
    lv = cfg["levels"].get(level) or cfg["levels"]["normal"]
    return int(lv["speed_pm"]), int(lv["window_pm"])


def generate(cfg: dict, seed: int, players: list[dict]) -> list[dict]:
    """The orc list. players: [{speed_pm, window_pm}], the index is the lane. Order of random calls is fixed: wave, lane, i."""
    rng = Mulberry32(seed)
    objs: list[dict] = []
    for wave in cfg["waves"]:
        pairs = wave["types"]
        total = sum(int(w) for _, w in pairs)
        for lane, pl in enumerate(players):
            for i in range(int(wave["count"])):
                jitter = rng.below(int(wave.get("jitter_ms", 0)) + 1)
                pick = rng.below(total)
                typ = pairs[-1][0]
                for name, w in pairs:
                    if pick < int(w):
                        typ = name
                        break
                    pick -= int(w)
                tdef = cfg["types"][typ]
                spd = int(tdef["speed_pm"]) * int(pl["speed_pm"]) // 1000
                travel = int(cfg["track_ms"]) * 1000 // spd
                t_spawn = int(wave["start_ms"]) + i * int(wave["gap_ms"]) + jitter
                objs.append({
                    "id": len(objs), "lane": lane, "type": typ, "t_spawn": t_spawn, "t_arrive": t_spawn + travel,
                    "win": int(cfg["window_ms"]) * int(pl["window_pm"]) // 1000, "dmg": int(tdef["damage"]),
                })
    return objs


def timeline_check(objs: list[dict]) -> int:
    """FNV-1a over the numbers: a cheap proof that the client built the same timeline."""
    h = 2166136261
    for o in objs:
        for c in f"{o['id']}:{o['lane']}:{o['t_spawn']}:{o['t_arrive']}:{o['win']};".encode("ascii"):
            h = ((h ^ c) * 16777619) & M32
    return h


def wall_hp(cfg: dict, n_players: int) -> int:
    return int(cfg["wall_hp"]) + int(cfg["wall_hp_per_player"]) * n_players


def new_state(cfg: dict, n_players: int) -> dict[str, Any]:
    hp = wall_hp(cfg, n_players)
    return {"hp": hp, "hp_max": hp, "hits": {}, "breaches": [], "status": "running", "end_t": None}


def _resolved(state: dict, oid: int) -> bool:
    return str(oid) in state["hits"] or oid in state["breaches"]


def advance(state: dict, objs: list[dict], now: int, grace: int) -> bool:
    """Resolve every orc that got past the wall (+ grace for late packets) up to sim time `now`. True when the state changed."""
    if state["status"] != "running":
        return False
    changed = False
    for o in sorted(objs, key=lambda x: (x["t_arrive"], x["id"])):
        if o["t_arrive"] + grace > now:
            break
        if _resolved(state, o["id"]):
            continue
        state["breaches"].append(o["id"])
        state["hp"] = max(0, state["hp"] - o["dmg"])
        changed = True
        if state["hp"] == 0:
            state["status"], state["end_t"] = "lost", o["t_arrive"]
            return True
    if state["status"] == "running" and all(_resolved(state, o["id"]) for o in objs):
        state["status"], state["end_t"] = "won", max((o["t_arrive"] for o in objs), default=0)
        changed = True
    return changed


def find_target(state: dict, objs: list[dict], lane: int, t: int) -> dict | None:
    """The orc a tap at sim time t hits: the earliest unresolved one of the lane whose window [t_arrive - win, t_arrive] holds t."""
    best = None
    for o in objs:
        if o["lane"] != lane or _resolved(state, o["id"]):
            continue
        if o["t_arrive"] - o["win"] <= t <= o["t_arrive"] and (best is None or o["t_arrive"] < best["t_arrive"]):
            best = o
    return best


def apply_tap(state: dict, objs: list[dict], lane: int, t: int, now: int, grace: int) -> dict[str, Any]:
    """A tap event with its own sim time t, received at server sim time `now`. The time of the tap counts, not the time of delivery.
    Refused: the future (more than `grace` ahead of the server clock), before the start, after the end, nothing in the window."""
    advance(state, objs, now, grace)
    if state["status"] != "running":
        return {"ok": False, "reason": "finished"}
    if t < 0:
        return {"ok": False, "reason": "before_start"}
    if t > now + grace:
        return {"ok": False, "reason": "future"}
    target = find_target(state, objs, lane, t)
    if target is None:
        return {"ok": False, "reason": "no_target"}
    state["hits"][str(target["id"])] = t
    return {"ok": True, "id": target["id"]}
