/* The measurement of the performance test (#174): the time between two animation frames while a part of the game plays. Pure numbers in
 * frameStats / verdict (tests/js/perf.test.mjs), the sampler needs requestAnimationFrame. */

export const LONG_MS = 50;               // a frame this long or longer is a visible stutter

/** deltas: ms between frames -> {frames, fps, avg, p95, worst, long}. */
export function frameStats(deltas) {
  const d = deltas.filter((x) => x > 0 && Number.isFinite(x));
  if (!d.length) return { frames: 0, fps: 0, avg: 0, p95: 0, worst: 0, long: 0 };
  const sum = d.reduce((a, b) => a + b, 0);
  const sorted = [...d].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  return {
    frames: d.length,
    fps: Math.round((1000 * d.length) / sum),
    avg: Math.round((sum / d.length) * 10) / 10,
    p95: Math.round(p95),
    worst: Math.round(sorted[sorted.length - 1]),
    long: d.filter((x) => x >= LONG_MS).length,
  };
}

/** The verdict of one part: "smooth" | "jerky" (now and then) | "slow". long per 10 s of play. */
export function verdict(s, ms) {
  if (!s || !s.frames) return "slow";
  const longPer10 = (s.long * 10000) / Math.max(1000, ms);
  if (s.fps >= 45 && longPer10 <= 3) return "smooth";
  if (s.fps >= 28 && longPer10 <= 12) return "jerky";
  return "slow";
}

export const VERDICT_TEXT = { smooth: "plynulé", jerky: "občas trhá", slow: "trhá" };
const RANK = { smooth: 0, jerky: 1, slow: 2 };

/** The worse of the verdicts. */
export const worst = (...v) => v.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "smooth");

/** Records frame deltas until stop() (returns the stats). raf: the frame function (window.requestAnimationFrame). */
export function sampler(raf = requestAnimationFrame, caf = cancelAnimationFrame) {
  const deltas = [];
  let last = 0, id = 0, on = true;
  const tick = (t) => {
    if (!on) return;
    if (last) deltas.push(t - last);
    last = t;
    id = raf(tick);
  };
  id = raf(tick);
  return { stop() { on = false; caf(id); return frameStats(deltas); }, deltas };
}
