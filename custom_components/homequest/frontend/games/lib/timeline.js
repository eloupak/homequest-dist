/* JS port of custom_components/homequest/game/engine.py: the same timeline from (config, seed, players), whole milliseconds,
 * integer arithmetic only (Math.imul for the 32-bit parts, Math.floor for the divisions of positive integers).
 * tests/js/games.test.mjs compares it with the Python numbers. */

export class Mulberry32 {
  constructor(seed) {
    this.a = seed >>> 0;
  }

  nextU32() {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  below(n) {
    return this.nextU32() % n;
  }
}

export function playerNumbers(cfg, level) {
  const lv = cfg.levels[level] || cfg.levels.normal;
  return [lv.speed_pm, lv.window_pm];
}

/** players: [{speed_pm, window_pm}] (the index is the lane). */
export function generate(cfg, seed, players) {
  const rng = new Mulberry32(seed);
  const objs = [];
  for (const wave of cfg.waves) {
    const pairs = wave.types;
    const total = pairs.reduce((s, p) => s + p[1], 0);
    players.forEach((pl, lane) => {
      for (let i = 0; i < wave.count; i++) {
        const jitter = rng.below((wave.jitter_ms || 0) + 1);
        let pick = rng.below(total);
        let typ = pairs[pairs.length - 1][0];
        for (const [name, w] of pairs) {
          if (pick < w) {
            typ = name;
            break;
          }
          pick -= w;
        }
        const tdef = cfg.types[typ];
        const spd = Math.floor((tdef.speed_pm * pl.speed_pm) / 1000);
        const travel = Math.floor((cfg.track_ms * 1000) / spd);
        const tSpawn = wave.start_ms + i * wave.gap_ms + jitter;
        objs.push({ id: objs.length, lane, type: typ, t_spawn: tSpawn, t_arrive: tSpawn + travel, win: Math.floor((cfg.window_ms * pl.window_pm) / 1000), dmg: tdef.damage });
      }
    });
  }
  return objs;
}

export function timelineCheck(objs) {
  let h = 2166136261;
  for (const o of objs) {
    const s = `${o.id}:${o.lane}:${o.t_spawn}:${o.t_arrive}:${o.win};`;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  }
  return h >>> 0;
}

/** The earliest unresolved orc of the lane whose window [t_arrive - win, t_arrive] holds t. resolved(id) -> bool. */
export function findTarget(objs, resolved, lane, t) {
  let best = null;
  for (const o of objs) {
    if (o.lane !== lane || resolved(o.id)) continue;
    if (o.t_arrive - o.win <= t && t <= o.t_arrive && (!best || o.t_arrive < best.t_arrive)) best = o;
  }
  return best;
}

/** What to draw for an orc at sim time `now`: the server's word wins, then our own prediction, then "it got through". */
export function orcStatus(o, server, predicted, now) {
  const st = server || { hits: {}, breaches: [] };
  if (o.id in st.hits || String(o.id) in st.hits) return { s: "hit", t: st.hits[o.id] ?? st.hits[String(o.id)] };
  if (st.breaches.includes(o.id)) return { s: "breach", t: o.t_arrive };
  if (predicted && o.id in predicted) return { s: "hit", t: predicted[o.id], predicted: true };
  if (now >= o.t_arrive) return { s: "breach", t: o.t_arrive, predicted: true };
  return { s: "run" };
}
