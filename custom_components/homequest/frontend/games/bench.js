/* "Test výkonu" (#174, 2026-11-16): how smoothly this phone plays the heavy parts of the game, as numbers a parent can send.
 * 1) the rebuilding of the fortress (views/transition.js, the same animation as in the Quest) between the two last stages it has pictures of,
 * 2) ~20 s of Obrana brány v2 (views/defend_gate_v2.js, the siege's own view) with two heroes and one dense wave of every orc type, played
 *    locally by a bot (no server, the same as the swing lab on TEST): nothing is sent, nothing is stored - no coins, amulet or state.
 * The time between animation frames is measured in each part (lib/perf.js). Opened from the diagnostics (triple tap on the title) and from
 * Rodič -> O hře. The result: frames per second, the worst frame, stutters over 50 ms, a verdict, Poslat / Kopírovat. */

import { h, icon } from "../lib/dom.js";
import { ART_CSS } from "../lib/layers.js";
import { bgChain, stageAt } from "../lib/story.js";
import { VERDICT_TEXT, sampler, verdict, worst } from "../lib/perf.js";
import { rebuildScene, REBUILD_MS } from "../views/transition.js";
import { CSS, CSS2 } from "./styles.js";
import { mountDefendGate2 } from "./views/defend_gate_v2.js";
import { BENCH_CFG } from "./lib/bench_cfg.js";

export const BATTLE_MS = 20000;
const SWING_EVERY_MS = 600;              // the bot: each hero swings this often (the cooldown is 350 ms)
const MIN_STAGE = 2;

const BENCH_CSS = `
:host { position: fixed; inset: 0; z-index: 95; height: auto; }
.body { top: 0; }
.g2-ctl .g2-btn { pointer-events: none; }
.bn-screen { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 20px; text-align: center; background: #1c1a2e; color: #f3ecd8; overflow: auto; }
.bn-screen h2 { margin: 0; font-size: 22px; }
.bn-screen p { margin: 0; font-size: 16px; max-width: 520px; }
.bn-res { font: 13px/1.45 ui-monospace, Menlo, monospace; text-align: left; white-space: pre-wrap; background: #2a2742; border-radius: 10px; padding: 10px 12px; max-width: 560px; width: 100%; box-sizing: border-box; user-select: all; -webkit-user-select: all; }
.bn-verdict { font-size: 24px; font-weight: 800; }
.bn-verdict.smooth { color: #8fe08a; } .bn-verdict.jerky { color: #ffd34d; } .bn-verdict.slow { color: #ff9a8a; }
.bn-row { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
.bn-row .btn { min-height: 48px; min-width: 120px; font-size: 17px; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.bn-tag { position: absolute; z-index: 30; top: 44px; left: 50%; transform: translateX(-50%); background: rgba(28, 26, 46, .8); color: #fff; border-radius: 10px; padding: 4px 12px; font-size: 14px; pointer-events: none; }
`;

/** The two pictures of the rebuild: the stage before the current one and the current one (at least stages 0 -> 1), as the Quest plays it. */
export function rebuildPair(story, done) {
  const st = (story && story.fortress && story.fortress.stages) || [];
  if (st.length < 2) return null;
  const at = stageAt(story, done || 0);
  const i = Math.max(1, at ? at.index : 1);
  if (!st[i].background || !st[i - 1].background) return null;
  return { from: [st[i - 1].background], to: [st[i].background, st[i - 1].background] };
}

/** The heroes of the battle: the shown child twice (a child's view has only its own child), or the first two children with a look. */
export function benchKids(view, kidId) {
  const kids = view.kids || {};
  const ids = (view.catalog.kids || []).map((k) => k.id).filter((id) => kids[id] && kids[id].hero);
  const one = kidId && kids[kidId] ? kidId : ids[0];
  if (!one) return [];
  return ids.length >= 2 && !kidId ? ids.slice(0, 2) : [one, one];
}

/** opts: {layer (the panel's scene layer), appCtx (the panel's ctx), view, stage, kidId, facts() -> report facts, reportUrl(extra) , onClose(result)}. */
export function openBench(root, opts) {
  const { view } = opts;
  const host = h("div", { class: "bench", "data-bench": "" });
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = ART_CSS + CSS + CSS2 + BENCH_CSS;
  const body = h("div", { class: "body" });
  shadow.append(style, body);
  root.append(host);
  let closed = false, run = null, timer = 0, botTimer = 0, rebuildEl = null;
  const result = { rebuild: null, battle: null };

  const screen = (...kids) => body.replaceChildren(h("div", { class: "bn-screen" }, ...kids));
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    clearInterval(botTimer);
    if (run) run.destroy();
    if (rebuildEl) rebuildEl.remove();
    host.remove();
    if (opts.onClose) opts.onClose(result.verdict ? result : null);
  };

  function intro() {
    screen(h("h2", {}, "Test výkonu"),
      h("p", {}, "Přehraje přerod tvrze a asi 20 vteřin bitvy se skřety naprázdno a změří, jak plynule to telefon zvládá. Nic se neukládá, zlaťáky ani amulet se nemění."),
      h("p", {}, "Trvá asi půl minuty. Na telefon během testu nesahej."),
      h("div", { class: "bn-row" },
        h("button", { class: "btn", "data-act": "bench-start", onclick: () => partRebuild() }, "Spustit"),
        h("button", { class: "btn ghost", "data-act": "bench-close", onclick: close }, "Zavřít")));
  }

  function partRebuild() {
    const pair = rebuildPair(view.story, view.fortress ? view.fortress.done : 0);
    if (!pair) return partBattle();
    body.replaceChildren();
    host.style.display = "none";                                     // the rebuild plays in the panel's scene layer, under this layer
    const s = sampler();
    rebuildEl = rebuildScene(opts.appCtx, pair.from, pair.to, () => { rebuildEl = null; });
    rebuildEl.setAttribute("data-bench-rebuild", "");
    opts.layer.append(rebuildEl);
    timer = setTimeout(() => {
      result.rebuild = s.stop();
      result.rebuildMs = REBUILD_MS;
      if (rebuildEl) { rebuildEl.remove(); rebuildEl = null; }
      host.style.display = "";
      if (!closed) partBattle();
    }, REBUILD_MS + 200);
  }

  function partBattle() {
    const ids = benchKids(view, opts.kidId);
    if (!ids.length || closed) return finish();
    const kidsOf = Object.fromEntries((view.catalog.kids || []).map((k) => [k.id, { ...((view.kids || {})[k.id] || {}), id: k.id, name: k.name }]));
    const t0 = performance.now();
    const stages = view.story && view.story.fortress ? view.story.fortress.stages : [];
    const at = stageAt(view.story, view.fortress ? view.fortress.done : 0);
    const ctx = {
      assets: "/homequest_assets", kids: kidsOf, hctx: { cat: view.catalog, items: Object.fromEntries(view.catalog.items.map((i) => [i.id, i])) },
      stage: opts.stage, heroVariant: "a", showRtt: false, debug: false, error: "",
      fortressBg: at ? bgChain(view.story, stages[Math.max(at.index, Math.min(MIN_STAGE, stages.length - 1))].id) : null,   // as the siege
      clock: { serverNow: () => performance.now() - t0, stats: { rtt_med: 0, rtt_max: 0, n: 1 } },
      call: async () => ({ ok: true }), render: () => {}, resultView: () => [],
      mypid: "b0", stats: null,
    };
    ctx.session = {
      id: "bench", game: "defend_gate_v2", phase: "running", seed: 7, check: null, config: BENCH_CFG,
      start_ms: Math.round(BENCH_CFG.countdown_ms), state: { status: "running", events: [] },
      players: ids.map((id, i) => ({ pid: `b${i}`, kid_id: id, name: (kidsOf[id] && kidsOf[id].name) || `${i + 1}`, speed_pm: 1000, window_pm: 1000 })),
    };
    body.replaceChildren(h("div", { class: "bn-tag" }, "Test výkonu: bitva"));
    const stageHost = h("div", { style: "position:absolute;inset:0" });
    body.append(stageHost);
    run = mountDefendGate2(ctx, stageHost);
    window.__hqBench = { ctx, run };                                  // the tests
    let k = 0;
    botTimer = setInterval(() => {                                    // the bot: the heroes swing in turns (both lanes, as the swing lab does)
      const t = Math.round(ctx.clock.serverNow() - ctx.session.start_ms);
      if (t < 0) return;
      run.sim.runTo(t);
      const lane = k++ % ids.length;
      if (run.sim.canAct(lane, "swing", t)) run.sim.addEvent({ lane, action: "swing", t });
    }, Math.round(SWING_EVERY_MS / ids.length));
    const s = sampler();
    timer = setTimeout(() => {
      result.battle = s.stop();
      result.battleMs = BATTLE_MS;
      clearInterval(botTimer);
      run.destroy();
      run = null;
      finish();
    }, BATTLE_MS);
  }

  function finish() {
    if (closed) return;
    const v = [result.rebuild ? verdict(result.rebuild, result.rebuildMs) : null, result.battle ? verdict(result.battle, result.battleMs) : null].filter(Boolean);
    result.verdict = v.length ? worst(...v) : "slow";
    result.verdictText = VERDICT_TEXT[result.verdict];
    result.orientation = window.matchMedia && window.matchMedia("(orientation: landscape)").matches ? "landscape" : "portrait";
    result.size = `${window.innerWidth}×${window.innerHeight}`;
    const lines = opts.lines(result);
    const text = lines.join("\n");
    screen(h("h2", {}, "Test výkonu hotový"),
      h("div", { class: `bn-verdict ${result.verdict}`, "data-id": "bench-verdict", "data-verdict": result.verdict }, result.verdictText),
      h("pre", { class: "bn-res", "data-id": "bench-result" }, text),
      h("div", { class: "bn-row" },
        h("a", { class: "btn", "data-act": "bench-send", href: opts.reportUrl(lines), target: "_blank", rel: "noopener" }, icon("mdi:bug-outline", 20), "Poslat"),
        h("button", { class: "btn ghost", "data-act": "bench-copy", onclick: (e) => copyText(text, e.currentTarget) }, "Kopírovat"),
        h("button", { class: "btn ghost", "data-act": "bench-close", onclick: close }, "Zavřít")));
    if (opts.onResult) opts.onResult(result);
  }

  intro();
  return { close, result };
}

/** Copies text (the clipboard API where it is allowed, else the old way through a hidden field); the button says how it went. */
export function copyText(text, btn) {
  const said = (ok) => { if (btn) btn.textContent = ok ? "Zkopírováno" : "Nejde kopírovat, označ text"; };
  const old = () => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    said(ok);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => said(true), old);
  else old();
}
