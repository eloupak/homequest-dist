"""Learning games (maths hunt): problems, sets, tracking of the problems each child has trouble with. Pure Python, no HA, no I/O except `load_config`.

The tracking data is one plain dict (the caller keeps it in its own storage, `.storage/homequest.learning`, NOT in homequest.state):

    {"version": 1, "kids": {kid_id: {"problems": {"mul:7x8": {op, a, b, attempts, wrong, wrong_answers[-5:], times_ms[-10:], last}},
                                     "sets": [{op, day, ts, hits, first_try, size}]}}}

Time to answer is measured by the client and cut to `max_time_ms`; the child never sees it."""

from __future__ import annotations

import os
import random
import statistics
from typing import Any, Callable

import yaml

OPS = ("add", "sub", "mul", "div")
SYMBOL = {"add": "+", "sub": "−", "mul": "×", "div": "÷"}
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "configs", "hunt.yaml")
KEEP_WRONG, KEEP_TIMES, KEEP_SETS = 5, 10, 200


class LearnError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code, self.message = code, message


def load_config(path: str = CONFIG_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def empty_data() -> dict:
    return {"version": 1, "kids": {}}


# ---- problems ------------------------------------------------------------------------------------------------------------------------
def problem(op: str, a: int, b: int) -> dict:
    """{key, op, a, b, answer, text}: a, b as shown (division: a is the dividend, b the divisor)."""
    answer = a + b if op == "add" else a - b if op == "sub" else a * b if op == "mul" else a // b
    sep = {"add": "+", "sub": "-", "mul": "x", "div": "/"}[op]
    return {"key": f"{op}:{a}{sep}{b}", "op": op, "a": a, "b": b, "answer": answer, "text": f"{a} {SYMBOL[op]} {b}"}


def all_problems(op: str, ranges: dict) -> list[dict]:
    """Every problem of an operation within its range (no negative results, division without remainder)."""
    r = ranges[op]
    out: list[dict] = []
    if op == "add":
        out = [problem(op, a, b) for a in range(1, r["max"]) for b in range(1, r["max"] - a + 1)]
    elif op == "sub":
        out = [problem(op, a, b) for a in range(2, r["max"] + 1) for b in range(1, a + 1)]
    elif op == "mul":
        out = [problem(op, a, b) for a in range(r["a"][0], r["a"][1] + 1) for b in range(r["b"][0], r["b"][1] + 1)]
    elif op == "div":
        out = [problem(op, d * q, d) for d in range(r["divisor"][0], r["divisor"][1] + 1) for q in range(r["quotient"][0], r["quotient"][1] + 1)]
    else:
        raise LearnError("invalid", f"unknown operation '{op}'")
    return out


def public(p: dict) -> dict:
    """What the client sees before it has answered: no result."""
    return {"key": p["key"], "op": p["op"], "text": p["text"], "a": p["a"], "b": p["b"]}


# ---- tracking ------------------------------------------------------------------------------------------------------------------------
def _kid(data: dict, kid: str) -> dict:
    return data.setdefault("kids", {}).setdefault(kid, {"problems": {}, "sets": []})


def record(data: dict, kid: str, p: dict, given: int | None, correct: bool, ms: int | None, cfg: dict, now: float) -> dict:
    """Count one attempt of a problem."""
    e = _kid(data, kid)["problems"].setdefault(p["key"], {"op": p["op"], "a": p["a"], "b": p["b"], "attempts": 0, "wrong": 0, "wrong_answers": [], "times_ms": [], "last": 0})
    e["attempts"] += 1
    e["last"] = int(now)
    if not correct:
        e["wrong"] += 1
        if given is not None:
            e["wrong_answers"] = (e["wrong_answers"] + [given])[-KEEP_WRONG:]
    if ms is not None:
        cap = int(cfg["learning"]["max_time_ms"])
        e["times_ms"] = (e["times_ms"] + [max(0, min(int(ms), cap))])[-KEEP_TIMES:]
    return e


def op_median_ms(data: dict, kid: str, op: str) -> float | None:
    """The child's median time for an operation: the median of the medians of its problems that have times."""
    meds = [statistics.median(e["times_ms"]) for e in _kid(data, kid)["problems"].values() if e["op"] == op and e["times_ms"]]
    return statistics.median(meds) if meds else None


def problem_score(e: dict, opmed: float | None, cfg: dict) -> float:
    """0..1: how much trouble this problem makes (0 = none). Wrong answers count by the rate, slowness by how far the median time is over the allowed factor."""
    pr = cfg["learning"]["problematic"]
    score = 0.0
    if e["attempts"] >= pr["min_attempts"] and e["wrong"]:
        score = min(1.0, (e["wrong"] / e["attempts"]) / (2 * pr["wrong_rate"]))      # at the threshold 0.5, at twice the threshold 1
    if opmed and len(e["times_ms"]) >= pr["min_times"]:
        ratio = statistics.median(e["times_ms"]) / opmed
        if ratio >= pr["slow_factor"]:
            score = max(score, min(1.0, 0.5 + (ratio - pr["slow_factor"]) * 0.25))
    return round(score, 3)


def is_problematic(e: dict, opmed: float | None, cfg: dict) -> tuple[bool, list[str]]:
    pr = cfg["learning"]["problematic"]
    why = []
    if e["attempts"] >= pr["min_attempts"] and e["wrong"] / e["attempts"] >= pr["wrong_rate"]:
        why.append("wrong")
    if opmed and len(e["times_ms"]) >= pr["min_times"] and statistics.median(e["times_ms"]) / opmed >= pr["slow_factor"]:
        why.append("slow")
    return bool(why), why


def overview(data: dict, kid: str, cfg: dict, top: int = 5) -> dict:
    """Per operation: the child's most problematic problems, worst first, plus totals."""
    out: dict[str, Any] = {}
    kd = _kid(data, kid)
    for op in cfg["learning"]["ops"]:
        opmed = op_median_ms(data, kid, op)
        rows = []
        for key, e in kd["problems"].items():
            if e["op"] != op:
                continue
            bad, why = is_problematic(e, opmed, cfg)
            if bad:
                rows.append({"key": key, "text": problem(op, e["a"], e["b"])["text"], "attempts": e["attempts"], "wrong": e["wrong"], "wrong_answers": e["wrong_answers"],
                             "median_ms": int(statistics.median(e["times_ms"])) if e["times_ms"] else None, "why": why, "score": problem_score(e, opmed, cfg)})
        rows.sort(key=lambda r: (-r["score"], -r["wrong"], r["key"]))
        mine = [e for e in kd["problems"].values() if e["op"] == op]
        out[op] = {"top": rows[:top], "problems_seen": len(mine), "attempts": sum(e["attempts"] for e in mine), "wrong": sum(e["wrong"] for e in mine),
                   "median_ms": int(opmed) if opmed else None}
    return out


def done_today(data: dict, kid: str, day: str, cfg: dict) -> dict:
    need = int(cfg["learning"]["daily"]["sets_per_op"])
    sets = _kid(data, kid)["sets"]
    return {op: sum(1 for s in sets if s["op"] == op and s["day"] == day) >= need for op in cfg["learning"]["ops"]}


# ---- hams and coins --------------------------------------------------------------------------------------------------------------------
def ham_state(kd: dict, cfg: dict) -> dict:
    """The ham balance of a child and what is missing to the next coin."""
    per = int(cfg["learning"]["reward"]["hams_per_coin"])
    bal = int(kd.get("hams", 0))
    return {"balance": bal, "per_coin": per, "to_next": per - bal % per if per else 0}


def reward_open(kd: dict, op: str, day: str) -> bool:
    """Hams are paid only for the first finished set of an operation per day."""
    return not any(x["op"] == op and x["day"] == day for x in kd["sets"])


def reward(kd: dict, op: str, day: str, hits: int, cfg: dict) -> dict:
    """Finished set -> hams (1 per right answer, only if the day's reward of this operation is still open) into the child's balance; every `hams_per_coin` hams
    become a coin (kd["pending_coins"], paid by the caller through the HomeQuest store and then settled). Returns what the child sees."""
    rc = cfg["learning"]["reward"]
    eligible = reward_open(kd, op, day)
    hams = int(hits) * int(rc["hams_per_hit"]) if eligible else 0
    per = int(rc["hams_per_coin"])
    bal = int(kd.get("hams", 0)) + hams
    coins = bal // per
    kd["hams"] = bal - coins * per
    kd["pending_coins"] = int(kd.get("pending_coins", 0)) + coins
    return {"eligible": eligible, "hams": hams, "coins": coins, **ham_state(kd, cfg)}


def pending_coins(data: dict) -> dict[str, int]:
    """{kid: coins waiting to be paid}: a coin is paid through the store after the set; if that fails it waits here and is paid with the next command."""
    return {k: int(v.get("pending_coins", 0)) for k, v in data["kids"].items() if int(v.get("pending_coins", 0)) > 0}


def settle_coins(data: dict, kid: str, n: int) -> None:
    kd = _kid(data, kid)
    kd["pending_coins"] = max(0, int(kd.get("pending_coins", 0)) - n)


# ---- sets ----------------------------------------------------------------------------------------------------------------------------
def draw_problems(data: dict, kid: str, op: str, cfg: dict, rng: random.Random, n: int | None = None) -> list[dict]:
    """n distinct problems, weighted: a problem the child has trouble with comes up more often (weight 1 + per_score x score); at least `fresh_per_set` are new ones."""
    lc = cfg["learning"]
    n = n or int(lc["set_size"])
    pool = all_problems(op, lc["ranges"])
    seen = _kid(data, kid)["problems"]
    opmed = op_median_ms(data, kid, op)
    w = lc["weights"]
    weights = [w["unseen"] + (w["per_score"] * problem_score(seen[p["key"]], opmed, cfg) if p["key"] in seen else 0) for p in pool]
    fresh_idx = [i for i, p in enumerate(pool) if p["key"] not in seen]
    chosen: list[int] = []
    for _ in range(min(int(w["fresh_per_set"]), n, len(fresh_idx))):
        i = rng.choice(fresh_idx)
        if i not in chosen:
            chosen.append(i)
    while len(chosen) < min(n, len(pool)):
        i = rng.choices(range(len(pool)), weights=weights)[0]
        if i not in chosen:
            chosen.append(i)
    picked = [pool[i] for i in chosen]
    rng.shuffle(picked)
    return picked


class LearnSet:
    """One set of a child and an operation: exactly `set_size` problems (a wrong answer counts); a wrong one comes back a few places later in place of an unasked one (at most max_repeats times)."""

    def __init__(self, set_id: str, kid: str, op: str, problems: list[dict], cfg: dict, rng: random.Random, day: str) -> None:
        self.id, self.kid, self.op, self.day = set_id, kid, op, day
        self.cfg, self.rng = cfg, rng
        self.queue: list[dict] = list(problems)
        self.size = len(problems)
        self.hits = 0
        self.first_try = 0
        self.tries: dict[str, int] = {}
        self.repeats: dict[str, int] = {}
        self.wrong_log: list[dict] = []
        self.done = False

    @property
    def current(self) -> dict | None:
        return self.queue[0] if self.queue else None

    def answer(self, value: int | None) -> dict:
        p = self.current
        if p is None:
            raise LearnError("finished", "the set is finished")
        correct = value is not None and value == p["answer"]
        key = p["key"]
        self.tries[key] = self.tries.get(key, 0) + 1
        self.queue.pop(0)
        if correct:
            self.hits += 1
            if self.tries[key] == 1:
                self.first_try += 1
        else:
            self.wrong_log.append({"text": p["text"], "given": value, "answer": p["answer"]})
            rp = self.cfg["learning"]["repeat"]
            if self.queue and self.repeats.get(key, 0) < int(rp["max_repeats"]):       # the set keeps its size: the wrong one takes the place of a later, not yet asked problem
                self.repeats[key] = self.repeats.get(key, 0) + 1
                gap = self.rng.randint(int(rp["gap"][0]), int(rp["gap"][1]))
                self.queue[min(gap - 1, len(self.queue) - 1)] = p
        self.done = not self.queue
        return {"problem": p, "correct": correct}

    def summary(self) -> dict:
        return {"op": self.op, "size": self.size, "hits": self.hits, "first_try": self.first_try, "wrong": self.wrong_log}


class LearningHub:
    """The running sets (in memory) on top of the tracking data (`data`, saved through `save`)."""

    def __init__(self, data: dict | None = None, cfg: dict | None = None, save: Callable[[dict], None] | None = None,
                 now: Callable[[], float] | None = None, today: Callable[[], str] | None = None, rng: random.Random | None = None) -> None:
        import time
        import datetime
        self.data = data if data is not None else empty_data()
        self.data.setdefault("kids", {})
        self.cfg = cfg or load_config()
        self.save = save or (lambda d: None)
        self.now = now or time.time
        self.today = today or (lambda: datetime.date.today().isoformat())
        self.rng = rng or random.Random()
        self.sets: dict[str, LearnSet] = {}
        self._n = 0

    def start(self, kid: str, op: str) -> LearnSet:
        if op not in self.cfg["learning"]["ops"]:
            raise LearnError("invalid", f"unknown operation '{op}'")
        for sid in [i for i, s in self.sets.items() if s.kid == kid]:      # one running set per child
            del self.sets[sid]
        self._n += 1
        s = LearnSet(f"s{self._n}-{int(self.now())}", kid, op, draw_problems(self.data, kid, op, self.cfg, self.rng), self.cfg, self.rng, self.today())
        self.sets[s.id] = s
        return s

    def need(self, set_id: str) -> LearnSet:
        s = self.sets.get(set_id)
        if not s:
            raise LearnError("not_found", "no such set (it ended or the server restarted)")
        return s

    def answer(self, set_id: str, value: int | None, ms: int | None) -> dict:
        s = self.need(set_id)
        res = s.answer(value)
        p = res["problem"]
        record(self.data, s.kid, p, value, res["correct"], ms, self.cfg, self.now())
        out = {"correct": res["correct"], "answer": p["answer"], "text": p["text"], "hits": s.hits, "remaining": len(s.queue), "done": s.done,
               "next": public(s.current) if s.current else None}
        if s.done:
            kd = _kid(self.data, s.kid)
            out["reward"] = reward(kd, s.op, s.day, s.hits, self.cfg)             # before the set is recorded: "first set of the day" looks at the earlier ones
            kd["sets"] = (kd["sets"] + [{"op": s.op, "day": s.day, "ts": int(self.now()), "hits": s.hits, "first_try": s.first_try, "size": s.size, "hams": out["reward"]["hams"]}])[-KEEP_SETS:]
            out["summary"] = s.summary()
            out["daily"] = done_today(self.data, s.kid, s.day, self.cfg)
            del self.sets[set_id]
        self.save(self.data)
        return out
