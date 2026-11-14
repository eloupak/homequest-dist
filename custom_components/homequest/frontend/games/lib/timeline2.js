/* JS port of custom_components/homequest/game/engine_v2.py (Defend the fortress v2, side view): the same orc list and the same fold of player
 * actions in fixed steps, whole numbers only (Math.imul for the 32-bit parts, Math.floor for divisions of non-negative integers).
 * tests/js/games2.test.mjs compares it with the Python numbers (tests/js/games-v2-vectors.json, written by tests/test_games_v2.py). */

import { Mulberry32 } from "./timeline.js";

export { Mulberry32 };

export const ACTIONS = ["swing", "jump", "leave"];   // leave (#118): the child left the game with the cross; its hero is gone for good
const HITTABLE = ["walk", "attack", "grab", "hold", "throw", "stun"];
const PHASES = ["wait", "walk", "attack", "grab", "hold", "throw", "stun", "flee", "gone"];
const fl = Math.floor;
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

export function playerNumbers(cfg, level) {
  const lv = cfg.levels[level] || cfg.levels.normal;
  return [lv.speed_pm, lv.window_pm];
}

/** Where the heroes stand: one in the centre, two symmetrically around it (index = lane, lane 0 on the left). */
export const heroXs = (cfg, n) => (n === 1 ? [0] : [-cfg.hero_gap, cfg.hero_gap]);

/** Where the orcs appear (|x|). */
export const edgeOf = (cfg, n) => Math.max(...heroXs(cfg, n).map(Math.abs)) + cfg.spawn_gap;

/** players: [{speed_pm, window_pm}] (the index is the lane). Order of random calls: wave, lane, i -> jitter, pick, gem (, side for one player). */
export function generate(cfg, seed, players) {
  const rng = new Mulberry32(seed);
  const specs = [];
  cfg.waves.forEach((wave, wi) => {
    const pairs = wave.types;
    const total = pairs.reduce((s, p) => s + p[1], 0);
    players.forEach((_pl, lane) => {
      for (let i = 0; i < wave.count; i++) {
        const jitter = rng.below((wave.jitter_ms || 0) + 1);
        let pick = rng.below(total);
        let typ = pairs[pairs.length - 1][0];
        for (const [name, w] of pairs) {
          if (pick < w) { typ = name; break; }
          pick -= w;
        }
        const gem = rng.below(1000) < cfg.types[typ].gem_pm;
        const side = players.length === 1 ? rng.below(2) : lane;
        specs.push({ id: specs.length, lane, side, type: typ, spawn: wave.start_ms + i * wave.gap_ms + jitter, gem: gem ? 1 : 0, wave: wi });
      }
    });
  });
  return specs;
}

function fnv(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}

export function timelineCheck(specs) {
  return fnv(specs.map((o) => `${o.id}:${o.lane}:${o.side}:${o.type}:${o.spawn}:${o.gem};`).join(""));
}

const keyLess = (a, b) => {
  for (const k of ["tq", "lane", "t"]) if (a[k] !== b[k]) return a[k] < b[k];
  return a.action < b.action;
};
const sameKey = (a, b) => a.tq === b.tq && a.lane === b.lane && a.t === b.t && a.action === b.action;

export class Sim {
  constructor(cfg, specs, players) {
    this.cfg = cfg;
    this.specs = specs;
    this.players = players;
    this.stepMs = cfg.step_ms;
    this.xs = heroXs(cfg, players.length);
    this.edge = edgeOf(cfg, players.length);
    this.waveStarts = cfg.waves.map((w) => w.start_ms).sort((a, b) => a - b);
    this.events = [];
    this.reset();
  }

  reset() {
    const c = this.cfg;
    this.cursor = -this.stepMs;
    this.ei = 0;
    this.status = "running";
    this.endT = null;
    this.livesMax = c.lives;
    this.gems = 0;
    this.kills = this.players.map(() => 0);
    this.stones = [];
    this.heroes = this.players.map((pl, i) => ({
      x: this.xs[i], lives: c.lives, out: false, back_at: -1, stagger_until: -1, air_from: -1, air_until: -1, cd_until: 0, caught: null, shakes: 0,
      caught_until: 0, reach: fl((c.weapons[pl.weapon || "default"] || c.weapons.default).reach * pl.window_pm / 1000), last_swing: -100000, hits_taken: 0, gone: false,
    }));
    this.en = this.specs.map((sp) => {
      const td = c.types[sp.type];
      const pl = this.players[sp.lane];
      const wp = pl.window_pm;
      return {
        id: sp.id, lane: sp.lane, side: sp.side, type: sp.type, spawn: sp.spawn, gem: sp.gem, hp: td.hp, helmet: !!td.helmet, beh: td.behavior,
        spd: fl(td.speed * pl.speed_pm / 1000), windup: fl(td.windup_ms * wp / 1000), period: td.period_ms,
        throw_windup: fl((td.throw_windup_ms || 0) * wp / 1000), mode: td.behavior === "thrower" ? "thrower" : "melee",
        throws_left: td.throws || 0, phase: "wait", t0: 0, x0: 0, goal: 0, target: -1, t_next: 0,
      };
    });
  }

  /** Insert an action {lane, action, t}. True when the past had to be re-simulated. */
  addEvent(ev) {
    const t = ev.t;
    const e = { lane: ev.lane, action: ev.action, t, tq: t - (t % this.stepMs) };
    if (this.events.some((x) => sameKey(x, e))) return false;
    let i = this.events.length;
    while (i > 0 && keyLess(e, this.events[i - 1])) i--;
    this.events.splice(i, 0, e);
    if (e.tq <= this.cursor) {
      const c = this.cursor;
      this.reset();
      this.runTo(c);
      return true;
    }
    return false;
  }

  /** Would an action of `lane` made at sim time t do anything (the client does not send what the rules ignore)? */
  canAct(lane, action, t) {
    const T = t - (t % this.stepMs);
    const h = this.heroes[lane];
    if (!h || h.out || T < h.stagger_until || this.airborne(h, T) || T < h.cd_until) return false;
    return !(action === "jump" && h.caught !== null);
  }

  /** Same events as another list (by key), for reconciling the prediction with the server's log. */
  hasEvent(ev) {
    const t = ev.t, tq = t - (t % this.stepMs);
    return this.events.some((x) => x.tq === tq && x.lane === ev.lane && x.t === t && x.action === ev.action);
  }

  /** Throw the log away and fold the given actions instead. */
  setEvents(list) {
    this.events = [];
    this.reset();
    for (const ev of list) {
      const t = ev.t;
      this.events.push({ lane: ev.lane, action: ev.action, t, tq: t - (t % this.stepMs) });
    }
    this.events.sort((a, b) => (keyLess(a, b) ? -1 : keyLess(b, a) ? 1 : 0));
  }

  eventList() {
    return this.events.map((e) => ({ lane: e.lane, action: e.action, t: e.t }));
  }

  runTo(t) {
    t = t >= 0 ? t - (t % this.stepMs) : -this.stepMs;
    while (this.status === "running" && this.cursor + this.stepMs <= t) {
      this.cursor += this.stepMs;
      this.step(this.cursor);
    }
  }

  step(T) {
    for (const h of this.heroes) if (h.out && h.back_at >= 0 && h.back_at <= T) { h.out = false; h.back_at = -1; h.lives = this.livesMax; }
    while (this.ei < this.events.length && this.events[this.ei].tq <= T) {
      this.act(this.events[this.ei], T);
      this.ei++;
    }
    for (const h of this.heroes) if (h.caught !== null && T >= h.caught_until) this.release(h, T);
    if (this.stones.length) {
      const keep = [];
      for (const s of this.stones) {
        if (s.t_land <= T) {
          if (!this.airborne(this.heroes[s.target], T)) this.heroHit(s.target, T);
        } else keep.push(s);
      }
      this.stones = keep;
    }
    for (const e of this.en) this.enemy(e, T);
    if (this.heroes.every((h) => h.gone)) { this.status = "left"; this.endT = T; }
    else if (this.heroes.every((h) => h.out)) { this.status = "lost"; this.endT = T; }
    else if (this.en.every((e) => e.phase === "gone")) { this.status = "won"; this.endT = T; }
  }

  airborne(h, T) { return h.air_from <= T && T < h.air_until; }
  heroFree(h, T) { return !h.out && T >= h.stagger_until && h.caught === null; }

  pos(e, T) {
    if (e.phase === "walk") {
      const way = Math.abs(e.goal - e.x0);
      return e.x0 + sign(e.goal - e.x0) * Math.min(way, fl(e.spd * (T - e.t0) / 1000));
    }
    if (e.phase === "flee") return e.x0 + sign(e.goal) * fl(this.cfg.flee_speed * (T - e.t0) / 1000);
    return e.x0;
  }

  /** The nearest hero still in the game (the left one on a tie), -1 when nobody is. */
  nearest(x) {
    let best = -1, bd = 0;
    this.heroes.forEach((h, i) => { if (!h.out && (best < 0 || Math.abs(x - h.x) < bd)) { best = i; bd = Math.abs(x - h.x); } });
    return best;
  }

  goWalk(e, T, x) {
    const tg = this.nearest(x);
    e.phase = "walk"; e.t0 = T; e.x0 = x; e.target = tg;
    if (tg < 0) { e.goal = x; return; }
    const hx = this.heroes[tg].x;
    const rel = sign(x - hx) || (e.side ? 1 : -1);
    e.goal = hx + rel * (e.mode === "thrower" ? this.cfg.throw_gap : this.cfg.engage_gap);
  }

  flee(e, T) {
    const x = this.pos(e, T);
    e.phase = "flee"; e.t0 = T; e.x0 = x;
    e.goal = sign(x) || (e.side ? 1 : -1);
  }

  act(ev, T) {
    const h = this.heroes[ev.lane];
    if (ev.action === "leave") { this.leave(ev.lane, T); return; }
    if (h.out || T < h.stagger_until || this.airborne(h, T) || T < h.cd_until) return;
    const c = this.cfg;
    if (ev.action === "jump") {
      if (h.caught !== null) return;
      h.air_from = T;
      h.air_until = T + c.jump_ms;
      h.cd_until = h.air_until + c.jump_gap_ms;
      return;
    }
    h.last_swing = T;
    if (h.caught !== null) {
      h.shakes++;
      h.cd_until = T + c.shake_cd_ms;
      if (h.shakes >= c.types.grabber.shake_count) this.kill(this.en[h.caught], T, ev.lane);
      return;
    }
    h.cd_until = T + c.cooldown_ms;
    for (const e of this.en) if (HITTABLE.includes(e.phase) && Math.abs(this.pos(e, T) - h.x) <= h.reach) this.hit(e, T, ev.lane);
    for (const o of this.heroes) if (o !== h && o.caught !== null) this.kill(this.en[o.caught], T, ev.lane);
  }

  hit(e, T, by) {
    if (e.phase === "hold") { this.kill(e, T, by); return; }
    e.hp--;
    if (e.hp <= 0) { this.kill(e, T, by); return; }
    e.helmet = false;
    this.knock(e, T);
  }

  knock(e, T) {
    let x = this.pos(e, T);
    const hx = e.target >= 0 ? this.heroes[e.target].x : 0;
    const rel = sign(x - hx) || (e.side ? 1 : -1);
    x = Math.max(-this.edge, Math.min(this.edge, x + rel * this.cfg.knock));
    e.phase = "stun"; e.t0 = T; e.x0 = x; e.t_next = T + this.cfg.hit_stun_ms;
  }

  kill(e, T, by) {
    for (const h of this.heroes) if (h.caught === e.id) h.caught = null;
    this.flee(e, T);
    this.kills[by]++;
    this.gems += e.gem;
  }

  /** The child left (#118): the same as engine_v2._leave. */
  leave(lane, T) {
    const h = this.heroes[lane];
    if (h.gone) return;
    h.gone = true; h.out = true; h.back_at = -1;
    if (h.caught !== null) {
      const g = this.en[h.caught];
      h.caught = null;
      this.knock(g, T);
    }
    for (const e of this.en) {
      if (e.lane === lane && e.phase === "wait") e.phase = "gone";
      else if (e.target === lane && ["walk", "attack", "grab", "throw", "hold"].includes(e.phase)) this.goWalk(e, T, this.pos(e, T));
    }
  }

  heroHit(lane, T) {
    const h = this.heroes[lane];
    if (h.out || T < h.stagger_until) return;
    h.hits_taken++;
    h.lives--;
    h.stagger_until = T + this.cfg.stagger_ms;
    if (h.caught !== null) {
      const g = this.en[h.caught];
      h.caught = null;
      this.knock(g, T);
    }
    if (h.lives <= 0) {
      h.out = true;
      const nx = this.waveStarts.find((s) => s > T);
      h.back_at = nx === undefined ? -1 : nx;
      for (const e of this.en) if (e.target === lane && ["walk", "attack", "grab", "throw"].includes(e.phase)) this.goWalk(e, T, this.pos(e, T));
    }
  }

  release(h, T) {
    this.heroHit(this.heroes.indexOf(h), T);
  }

  enemy(e, T) {
    const c = this.cfg;
    let ph = e.phase;
    if (ph === "wait") {
      if (T < e.spawn) return;
      e.phase = "walk";
      this.goWalk(e, e.spawn, e.side ? this.edge : -this.edge);
      ph = "walk";
    }
    if ((ph === "attack" || ph === "grab" || ph === "throw") && this.heroes[e.target].out) {
      this.goWalk(e, T, e.x0);
      ph = "walk";
    }
    if (ph === "walk") {
      if (e.target < 0 || this.heroes[e.target].out) {
        this.goWalk(e, T, this.pos(e, T));
        if (e.target < 0) return;
      }
      if (this.pos(e, T) !== e.goal) return;
      e.x0 = e.goal; e.t0 = T;
      if (e.mode === "thrower") { e.phase = "throw"; e.t_next = T + e.throw_windup; }
      else { e.phase = e.beh === "grabber" ? "grab" : "attack"; e.t_next = T + e.windup; }
    } else if (ph === "attack") {
      if (T >= e.t_next) {
        const h = this.heroes[e.target];
        if (this.heroFree(h, T) && !this.airborne(h, T)) this.heroHit(e.target, T);
        e.t_next = Math.max(e.t_next + e.period, h.stagger_until + e.windup);     // after a stagger he winds up again
      }
    } else if (ph === "grab") {
      if (T >= e.t_next) {
        const h = this.heroes[e.target];
        if (this.airborne(h, T) || !this.heroFree(h, T)) e.t_next += e.period;
        else { h.caught = e.id; h.shakes = 0; h.caught_until = T + c.types.grabber.shake_ms; e.phase = "hold"; }
      }
    } else if (ph === "throw") {
      if (T >= e.t_next) {
        this.stones.push({ target: e.target, x: e.x0, t_launch: T, t_land: T + c.types.thrower.stone_ms, from: e.id });
        e.throws_left--;
        if (e.throws_left > 0) e.t_next += c.types.thrower.throw_period_ms;
        else { e.mode = "melee"; this.goWalk(e, T, e.x0); }
      }
    } else if (ph === "stun") {
      if (T >= e.t_next) this.goWalk(e, T, e.x0);
    } else if (ph === "flee") {
      if (T - e.t0 >= c.flee_ms) e.phase = "gone";
    }
  }

  public() {
    return { status: this.status, end_t: this.endT, lives: this.heroes.map((h) => h.lives), lives_max: this.livesMax, gems: this.gems, kills: [...this.kills], events: this.eventList(), gone: this.heroes.map((h) => h.gone) };
  }

  digest() {
    const parts = [this.cursor, this.gems, ({ running: 1, won: 2, lost: 3 })[this.status] || 4, ...this.kills];
    for (const h of this.heroes) parts.push(h.lives, h.out ? 1 : 0, h.back_at, h.stagger_until, h.air_until, h.cd_until, h.caught === null ? -1 : h.caught, h.shakes);
    for (const e of this.en) parts.push(PHASES.indexOf(e.phase), this.pos(e, this.cursor), e.target, e.hp, e.t_next);
    parts.push(this.stones.length);
    return fnv(parts.join(":"));
  }
}

/** The progress of the game for the HUD (the same on every phone: only the orc list and the folded state): the wave that has started last
 *  (1-based; 1 before the first one), how many orcs of the waves so far are not gone yet, and how many of all are gone.
 *  {wave, waves, left, gone, total} */
export function waveInfo(sim, now) {
  const starts = sim.cfg.waves.map((w) => w.start_ms);
  let wave = 0;
  starts.forEach((s, i) => { if (s <= now) wave = i; });
  let left = 0, gone = 0;
  for (const e of sim.en) {
    if (e.phase === "gone") gone++;
    else if (sim.specs[e.id].wave <= wave) left++;
  }
  return { wave: wave + 1, waves: starts.length, left, gone, total: sim.en.length };
}
