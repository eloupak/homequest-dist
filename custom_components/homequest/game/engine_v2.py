"""Defend the fortress v2 (side view): a deterministic simulation in whole numbers (ms, units, permille), no floats.

The fortress stands behind the heroes in the middle (a picture, not a game object). One hero stands in the centre, two stand symmetrically
around it (x = -hero_gap / +hero_gap). Orcs come from both sides along one axis (signed x, 0 = the centre) to the nearest hero who is still
in the game and attack him; a blow that is not dodged (jump) or stopped (swing in the wind-up) costs the hero a life and he staggers.
A hero without lives is out until the next wave starts; the game is lost when every hero is out, won when every orc is gone.

Server and clients build the same orc list from (config, seed, players) and then FOLD the same sorted log of player actions
(swing / jump) in fixed steps (`step_ms`). The state is therefore a pure function of (specs, events): whoever has the same events
has the same game. The JS port is frontend/games/lib/timeline2.js; tests/js/games-v2-vectors.json proves both give the same numbers.

Authority: the server settles the state `grace_ms` behind its clock and refuses actions older than that (so it never has to rewind),
a client shows its own prediction and rebuilds from the log when an older action of someone else arrives (`add_event`)."""

from __future__ import annotations

from typing import Any

from .engine import M32, Mulberry32

ACTIONS = ("swing", "jump", "leave")     # leave (#118): the child left the game with the cross; its hero is gone for good
HITTABLE = ("walk", "attack", "grab", "hold", "throw", "stun")
PHASES = ("wait", "walk", "attack", "grab", "hold", "throw", "stun", "flee", "gone")


def player_numbers(cfg: dict, level: str) -> tuple[int, int]:
    lv = cfg["levels"].get(level) or cfg["levels"]["normal"]
    return int(lv["speed_pm"]), int(lv["window_pm"])


def hero_xs(cfg: dict, n_players: int) -> list[int]:
    """Where the heroes stand: one in the centre, two symmetrically around it (index = lane, lane 0 on the left)."""
    g = int(cfg["hero_gap"])
    return [0] if n_players == 1 else [-g, g]


def edge(cfg: dict, n_players: int) -> int:
    """Where the orcs appear (|x|): the same way to walk to the outer hero for one and two players."""
    return max(abs(x) for x in hero_xs(cfg, n_players)) + int(cfg["spawn_gap"])


def generate(cfg: dict, seed: int, players: list[dict]) -> list[dict]:
    """The orc list. With two players every player gets the groups on his own side (side = lane); one player gets them from both sides
    (a random side per orc). Order of random calls is fixed: wave, lane, i -> jitter, pick, gem (, side for one player).
    `lane` = whose level (speed, wind-up) the orc has, `side` = 0 comes from the left, 1 from the right, `wave` = index of its wave
    (only for the progress in the HUD, not in the check)."""
    rng = Mulberry32(seed)
    specs: list[dict] = []
    for wi, wave in enumerate(cfg["waves"]):
        pairs = wave["types"]
        total = sum(int(w) for _, w in pairs)
        for lane, _pl in enumerate(players):
            for i in range(int(wave["count"])):
                jitter = rng.below(int(wave.get("jitter_ms", 0)) + 1)
                pick = rng.below(total)
                typ = pairs[-1][0]
                for name, w in pairs:
                    if pick < int(w):
                        typ = name
                        break
                    pick -= int(w)
                gem = rng.below(1000) < int(cfg["types"][typ]["gem_pm"])
                side = rng.below(2) if len(players) == 1 else lane
                specs.append({"id": len(specs), "lane": lane, "side": side, "type": typ,
                              "spawn": int(wave["start_ms"]) + i * int(wave["gap_ms"]) + jitter, "gem": 1 if gem else 0, "wave": wi})
    return specs


def timeline_check(specs: list[dict]) -> int:
    """FNV-1a over the numbers: a cheap proof that the client built the same orc list."""
    h = 2166136261
    for o in specs:
        for c in f"{o['id']}:{o['lane']}:{o['side']}:{o['type']}:{o['spawn']}:{o['gem']};".encode("ascii"):
            h = ((h ^ c) * 16777619) & M32
    return h


def event_key(ev: dict) -> tuple:
    return (ev["tq"], ev["lane"], ev["t"], ev["action"])


def sign(v: int) -> int:
    return (v > 0) - (v < 0)


class Sim:
    def __init__(self, cfg: dict, specs: list[dict], players: list[dict]) -> None:
        self.cfg = cfg
        self.specs = specs
        self.players = players          # [{speed_pm, window_pm, weapon?}] index = lane
        self.step_ms = int(cfg["step_ms"])
        self.xs = hero_xs(cfg, len(players))
        self.edge = edge(cfg, len(players))
        self.wave_starts = sorted(int(w["start_ms"]) for w in cfg["waves"])
        self.events: list[dict] = []
        self.reset()

    # ------------------------------------------------------------- setup
    def reset(self) -> None:
        c = self.cfg
        self.cursor = -self.step_ms          # last simulated step time
        self.ei = 0                          # next unapplied event
        self.status = "running"              # running | won | lost | left (everybody left: no result)
        self.end_t: int | None = None
        self.lives_max = int(c["lives"])
        self.gems = 0
        self.kills = [0] * len(self.players)
        self.stones: list[dict] = []
        self.heroes = []
        for i, pl in enumerate(self.players):
            reach = int(c["weapons"].get(pl.get("weapon") or "default", c["weapons"]["default"])["reach"]) * int(pl["window_pm"]) // 1000
            self.heroes.append({"x": self.xs[i], "lives": self.lives_max, "out": False, "back_at": -1, "stagger_until": -1, "air_from": -1,
                                "air_until": -1, "cd_until": 0, "caught": None, "shakes": 0, "caught_until": 0, "reach": reach,
                                "last_swing": -100000, "hits_taken": 0, "gone": False})
        self.en = []
        for sp in self.specs:
            td = c["types"][sp["type"]]
            pl = self.players[sp["lane"]]
            wp = int(pl["window_pm"])
            self.en.append({
                "id": sp["id"], "lane": sp["lane"], "side": sp["side"], "type": sp["type"], "spawn": sp["spawn"], "gem": sp["gem"],
                "hp": int(td["hp"]), "helmet": bool(td.get("helmet")), "beh": td["behavior"],
                "spd": int(td["speed"]) * int(pl["speed_pm"]) // 1000,
                "windup": int(td["windup_ms"]) * wp // 1000, "period": int(td["period_ms"]),
                "throw_windup": int(td.get("throw_windup_ms", 0)) * wp // 1000,
                "mode": "thrower" if td["behavior"] == "thrower" else "melee",   # melee | thrower
                "throws_left": int(td.get("throws", 0)),
                "phase": "wait", "t0": 0, "x0": 0, "goal": 0, "target": -1, "t_next": 0,
            })

    # ------------------------------------------------------------- events
    def add_event(self, ev: dict) -> bool:
        """Insert an action {lane, action, t}; fills tq. True when the past had to be re-simulated."""
        ev = {"lane": int(ev["lane"]), "action": ev["action"], "t": int(ev["t"]), "tq": int(ev["t"]) - int(ev["t"]) % self.step_ms}
        key = event_key(ev)
        if any(event_key(e) == key for e in self.events):
            return False
        i = len(self.events)
        while i > 0 and event_key(self.events[i - 1]) > key:
            i -= 1
        self.events.insert(i, ev)
        if ev["tq"] <= self.cursor:
            c = self.cursor
            self.reset()
            self.run_to(c)
            return True
        return False

    def event_list(self) -> list[dict]:
        return [{"lane": e["lane"], "action": e["action"], "t": e["t"]} for e in self.events]

    # ------------------------------------------------------------- run
    def run_to(self, t: int) -> None:
        t = t - t % self.step_ms if t >= 0 else -self.step_ms
        while self.status == "running" and self.cursor + self.step_ms <= t:
            self.cursor += self.step_ms
            self._step(self.cursor)

    def _step(self, T: int) -> None:
        for h in self.heroes:
            if h["out"] and 0 <= h["back_at"] <= T:
                h["out"], h["back_at"], h["lives"] = False, -1, self.lives_max
        while self.ei < len(self.events) and self.events[self.ei]["tq"] <= T:
            self._act(self.events[self.ei], T)
            self.ei += 1
        for h in self.heroes:
            if h["caught"] is not None and T >= h["caught_until"]:
                self._release(h, T)
        if self.stones:
            keep = []
            for s in self.stones:
                if s["t_land"] <= T:
                    if not self.airborne(self.heroes[s["target"]], T):
                        self._hero_hit(s["target"], T)
                else:
                    keep.append(s)
            self.stones = keep
        for e in self.en:
            self._enemy(e, T)
        if all(h["gone"] for h in self.heroes):
            self.status, self.end_t = "left", T
        elif all(h["out"] for h in self.heroes):
            self.status, self.end_t = "lost", T
        elif all(e["phase"] == "gone" for e in self.en):
            self.status, self.end_t = "won", T

    # ------------------------------------------------------------- helpers
    def airborne(self, h: dict, T: int) -> bool:
        return h["air_from"] <= T < h["air_until"]

    def hero_free(self, h: dict, T: int) -> bool:
        return not h["out"] and T >= h["stagger_until"] and h["caught"] is None

    def pos(self, e: dict, T: int) -> int:
        ph = e["phase"]
        if ph == "walk":
            way = abs(e["goal"] - e["x0"])
            return e["x0"] + sign(e["goal"] - e["x0"]) * min(way, e["spd"] * (T - e["t0"]) // 1000)
        if ph == "flee":
            return e["x0"] + sign(e["goal"]) * (int(self.cfg["flee_speed"]) * (T - e["t0"]) // 1000)
        return e["x0"]

    def _nearest(self, x: int) -> int:
        """The nearest hero still in the game (the left one on a tie), -1 when nobody is."""
        best, bd = -1, 0
        for i, h in enumerate(self.heroes):
            if not h["out"] and (best < 0 or abs(x - h["x"]) < bd):
                best, bd = i, abs(x - h["x"])
        return best

    def _go_walk(self, e: dict, T: int, x: int) -> None:
        """Walk from x to the nearest hero: stop engage_gap (melee) or throw_gap (thrower) in front of him, on the side the orc comes from."""
        c = self.cfg
        tg = self._nearest(x)
        e["phase"], e["t0"], e["x0"], e["target"] = "walk", T, x, tg
        if tg < 0:
            e["goal"] = x
            return
        hx = self.heroes[tg]["x"]
        rel = sign(x - hx) or (1 if e["side"] else -1)
        e["goal"] = hx + rel * int(c["throw_gap"] if e["mode"] == "thrower" else c["engage_gap"])

    def _flee(self, e: dict, T: int) -> None:
        x = self.pos(e, T)
        e["phase"], e["t0"], e["x0"] = "flee", T, x
        e["goal"] = sign(x) or (1 if e["side"] else -1)          # only the direction: outwards

    # ------------------------------------------------------------- actions
    def _act(self, ev: dict, T: int) -> None:
        h = self.heroes[ev["lane"]]
        if ev["action"] == "leave":
            self._leave(ev["lane"], T)
            return
        if h["out"] or T < h["stagger_until"] or self.airborne(h, T) or T < h["cd_until"]:
            return
        c = self.cfg
        if ev["action"] == "jump":
            if h["caught"] is not None:
                return
            h["air_from"], h["air_until"] = T, T + int(c["jump_ms"])
            h["cd_until"] = h["air_until"] + int(c["jump_gap_ms"])
            return
        h["last_swing"] = T
        if h["caught"] is not None:
            h["shakes"] += 1
            h["cd_until"] = T + int(c["shake_cd_ms"])
            if h["shakes"] >= int(c["types"]["grabber"]["shake_count"]):
                self._kill(self.en[h["caught"]], T, ev["lane"])
            return
        h["cd_until"] = T + int(c["cooldown_ms"])
        for e in self.en:
            if e["phase"] in HITTABLE and abs(self.pos(e, T) - h["x"]) <= h["reach"]:
                self._hit(e, T, ev["lane"])
        for o in self.heroes:                # a blow of a free hero frees the other one from a grabber
            if o is not h and o["caught"] is not None:
                self._kill(self.en[o["caught"]], T, ev["lane"])

    def _hit(self, e: dict, T: int, by: int) -> None:
        if e["phase"] == "hold":             # whoever hits the grabber frees the held hero at once
            self._kill(e, T, by)
            return
        e["hp"] -= 1
        if e["hp"] <= 0:
            self._kill(e, T, by)
            return
        e["helmet"] = False
        self._knock(e, T)

    def _knock(self, e: dict, T: int) -> None:
        """Pushed back away from his hero (or from the centre), then stunned for a moment."""
        x = self.pos(e, T)
        hx = self.heroes[e["target"]]["x"] if e["target"] >= 0 else 0
        rel = sign(x - hx) or (1 if e["side"] else -1)
        x = max(-self.edge, min(self.edge, x + rel * int(self.cfg["knock"])))
        e["phase"], e["t0"], e["x0"], e["t_next"] = "stun", T, x, T + int(self.cfg["hit_stun_ms"])

    def _kill(self, e: dict, T: int, by: int) -> None:
        for h in self.heroes:
            if h["caught"] == e["id"]:
                h["caught"] = None
        self._flee(e, T)
        self.kills[by] += 1
        self.gems += e["gem"]

    def _hero_hit(self, lane: int, T: int) -> None:
        """A blow or a stone that was not dodged: one life less and a stagger (no further hit while it lasts); 0 lives = out until the next wave."""
        h = self.heroes[lane]
        if h["out"] or T < h["stagger_until"]:
            return
        h["hits_taken"] += 1
        h["lives"] -= 1
        h["stagger_until"] = T + int(self.cfg["stagger_ms"])
        if h["caught"] is not None:
            g = self.en[h["caught"]]
            h["caught"] = None
            self._knock(g, T)
        if h["lives"] <= 0:
            h["out"] = True
            h["back_at"] = next((s for s in self.wave_starts if s > T), -1)
            for e in self.en:                # his orcs go for the other hero
                if e["target"] == lane and e["phase"] in ("walk", "attack", "grab", "throw"):
                    self._go_walk(e, T, self.pos(e, T))

    def _leave(self, lane: int, T: int) -> None:
        """The child left (#118): the hero is out for good (no return with the next wave), his orcs that have not come yet stay away
        (the one who stays does not get twice as many), the ones on the field go for the other hero."""
        h = self.heroes[lane]
        if h["gone"]:
            return
        h["gone"], h["out"], h["back_at"] = True, True, -1
        if h["caught"] is not None:
            g = self.en[h["caught"]]
            h["caught"] = None
            self._knock(g, T)
        for e in self.en:
            if e["lane"] == lane and e["phase"] == "wait":
                e["phase"] = "gone"
            elif e["target"] == lane and e["phase"] in ("walk", "attack", "grab", "throw", "hold"):
                self._go_walk(e, T, self.pos(e, T))

    def _release(self, h: dict, T: int) -> None:
        """Nobody shook the grabber off in time: the hero loses a life, the grabber steps back and comes again."""
        self._hero_hit(self.heroes.index(h), T)

    # ------------------------------------------------------------- orcs
    def _enemy(self, e: dict, T: int) -> None:
        c = self.cfg
        ph = e["phase"]
        if ph == "wait":
            if T < e["spawn"]:
                return
            e["phase"] = "walk"
            self._go_walk(e, e["spawn"], self.edge if e["side"] else -self.edge)
            ph = "walk"
        if ph in ("attack", "grab", "throw") and self.heroes[e["target"]]["out"]:
            self._go_walk(e, T, e["x0"])
            ph = "walk"
        if ph == "walk":
            if e["target"] < 0 or self.heroes[e["target"]]["out"]:
                self._go_walk(e, T, self.pos(e, T))
                if e["target"] < 0:
                    return
            if self.pos(e, T) != e["goal"]:
                return
            e["x0"], e["t0"] = e["goal"], T
            if e["mode"] == "thrower":
                e["phase"], e["t_next"] = "throw", T + e["throw_windup"]
            else:
                e["phase"], e["t_next"] = ("grab" if e["beh"] == "grabber" else "attack"), T + e["windup"]
        elif ph == "attack":
            if T >= e["t_next"]:
                h = self.heroes[e["target"]]
                if self.hero_free(h, T) and not self.airborne(h, T):
                    self._hero_hit(e["target"], T)
                # after a stagger he winds up again: the hero always gets the whole window to answer
                e["t_next"] = max(e["t_next"] + e["period"], h["stagger_until"] + e["windup"])
        elif ph == "grab":
            if T >= e["t_next"]:
                h = self.heroes[e["target"]]
                if self.airborne(h, T) or not self.hero_free(h, T):
                    e["t_next"] += e["period"]
                else:
                    h["caught"], h["shakes"], h["caught_until"] = e["id"], 0, T + int(c["types"]["grabber"]["shake_ms"])
                    e["phase"] = "hold"
        elif ph == "throw":
            if T >= e["t_next"]:
                self.stones.append({"target": e["target"], "x": e["x0"], "t_launch": T, "t_land": T + int(c["types"]["thrower"]["stone_ms"]), "from": e["id"]})
                e["throws_left"] -= 1
                if e["throws_left"] > 0:
                    e["t_next"] += int(c["types"]["thrower"]["throw_period_ms"])
                else:
                    e["mode"] = "melee"
                    self._go_walk(e, T, e["x0"])
        elif ph == "stun":
            if T >= e["t_next"]:
                self._go_walk(e, T, e["x0"])
        elif ph == "flee":
            if T - e["t0"] >= int(c["flee_ms"]):
                e["phase"] = "gone"

    # ------------------------------------------------------------- view
    def public(self) -> dict[str, Any]:
        return {"status": self.status, "end_t": self.end_t, "lives": [h["lives"] for h in self.heroes], "lives_max": self.lives_max,
                "gems": self.gems, "kills": list(self.kills), "events": self.event_list(), "gone": [h["gone"] for h in self.heroes]}

    def digest(self) -> int:
        """FNV-1a over the state at the cursor (for cross-language vectors)."""
        parts = [self.cursor, self.gems, {"running": 1, "won": 2, "lost": 3}.get(self.status, 4), *self.kills]
        for h in self.heroes:
            parts += [h["lives"], 1 if h["out"] else 0, h["back_at"], h["stagger_until"], h["air_until"], h["cd_until"],
                      -1 if h["caught"] is None else h["caught"], h["shakes"]]
        for e in self.en:
            parts += [PHASES.index(e["phase"]), self.pos(e, self.cursor), e["target"], e["hp"], e["t_next"]]
        parts += [len(self.stones)]
        h = 2166136261
        for c in (":".join(str(p) for p in parts)).encode("ascii"):
            h = ((h ^ c) * 16777619) & M32
        return h
