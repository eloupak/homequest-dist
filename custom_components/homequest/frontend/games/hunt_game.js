/* The hunt (maths) in the child's game (#189, v1.9): Quest -> "Na lov" opens this layer over the panel. Menu (the four operations, the hams),
 * the hunt itself (views/hunt.js in the aiming mode of #188: a right answer lets an animal peek out, the child shoots with a finger), the result.
 * The server (websocket_learning.py) checks that the child may hunt (the fortress stage and the bow) and pays the hams. Own shadow root with the
 * styles of the games; the panel is pinned to the visible viewport like the learning panel (the pad stays in view on a phone). */

import { h, icon } from "../lib/dom.js";
import { ART_CSS } from "../lib/layers.js";
import { CSS } from "./styles.js";
import { CSS_L } from "./styles_learning.js";
import { mountHunt } from "./views/hunt.js";
import { castMember, fillText, npcUrl, stageVars } from "../lib/story.js";

export const OP_NAME = { add: "Sčítání", sub: "Odčítání", mul: "Násobení", div: "Dělení" };
export const OP_SYMBOL = { add: "+", sub: "−", mul: "×", div: "÷" };

const HUNT_CSS = `
:host { position: fixed; inset: 0; z-index: 90; height: auto; overscroll-behavior: none; }
.body { top: 0; }
.ht-menu { max-width: 520px; margin: 0 auto; padding: calc(14px + env(safe-area-inset-top, 0px)) 14px calc(14px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 12px; }
.ht-head { display: flex; align-items: center; gap: 10px; }
.ht-head h2 { margin: 0; font-size: 24px; flex: 1; }
.ht-x { width: 48px; height: 48px; border: 0; border-radius: 50%; background: #3a3658; color: #fff; display: flex; align-items: center; justify-content: center; }
.ht-hams { font-size: 17px; }
.ht-hams b { color: #e0b040; font-size: 22px; }
.ht-ham { display: inline-block; vertical-align: -3px; margin: 0 6px 0 4px; }
[data-id="res-hams"] { color: #e0b040; font-size: 22px; }
.ht-hunter { display: flex; align-items: flex-end; gap: 10px; }
.ht-hunter img { width: 34%; max-width: 170px; aspect-ratio: 2 / 3; object-fit: contain; object-position: bottom; flex: none; }
.ht-hunter .ht-bubble { position: relative; flex: 1; margin-bottom: 18%; padding: 10px 14px; border-radius: 16px; background: #f3ecd8; color: #2a2742; }
.ht-hunter .ht-bubble::before { content: ""; position: absolute; left: -10px; bottom: 16px; border: 10px solid transparent; border-right-color: #f3ecd8; border-left: 0; }
.ht-bubble .who { font-size: 13px; font-weight: 700; opacity: .7; }
.ht-bubble p { margin: 2px 0 0; font-size: 20px; font-weight: 700; }
.ht-res { text-align: center; }
.ht-res .big { font-size: 22px; }
.ht-res .big b { font-size: 42px; color: #e0b040; }
.ht-wrong .ov-row { padding: 2px 0; }
`;

/** opts: {hass, api, stage (the panel's art stage), view, kidId, onClose()}. Returns {close()}. */
export function openHuntGame(root, opts) {
  const { api, view, kidId } = opts;
  const assets = opts.assets || "/homequest_assets";
  const host = h("div", { class: "hunt-game", "data-hunt": "" });
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = ART_CSS + CSS + CSS_L + HUNT_CSS;
  const body = h("div", { class: "body" });
  shadow.append(style, body);
  root.append(host);

  const k = view.catalog.kids.find((x) => x.id === kidId) || { id: kidId, name: "" };
  const kid = { ...((view.kids || {})[kidId] || {}), id: kidId, name: k.name };
  const q = new URLSearchParams(location.search);
  const ctx = {
    stage: opts.stage, hctx: { cat: view.catalog, items: Object.fromEntries(view.catalog.items.map((i) => [i.id, i])) },
    info: null, error: "", result: null, speed: q.has("fast") ? 12 : 1, assets,
    call: (type, data = {}) => api.call(type, { ...data, kid_id: kidId }).catch((e) => { throw { code: (e && e.code) || "error", message: (e && e.message) || String(e) }; }),
  };
  window.__hqHuntGame = ctx;                                         // the tests
  let run = null, closed = false;

  const vp = () => {                                                 // the visible viewport (iOS: the pad must not hide under the browser bars)
    const vv = window.visualViewport;
    if (!vv) return;
    Object.assign(host.style, { position: "fixed", left: "0", right: "0", top: `${vv.offsetTop}px`, height: `${vv.height}px` });
  };
  if (window.visualViewport) { window.visualViewport.addEventListener("resize", vp); window.visualViewport.addEventListener("scroll", vp); }
  vp();

  function close() {
    if (closed) return;
    closed = true;
    if (run) run.destroy();
    run = null;
    if (window.visualViewport) { window.visualViewport.removeEventListener("resize", vp); window.visualViewport.removeEventListener("scroll", vp); }
    host.remove();
    opts.onClose && opts.onClose();
  }

  async function load() {
    try {
      ctx.info = await ctx.call("learn_state");
    } catch (e) {
      ctx.info = null;
      ctx.error = e.message || String(e);
    }
    render();
  }

  function play(op) {
    if (!ctx.info) return;
    ctx.result = null;
    body.classList.add("playing");
    run = mountHunt(ctx, body, {
      kid, op, info: ctx.info, mode: ctx.info.mode,
      onFinish: async (res) => {
        if (run) run.destroy();
        run = null;
        body.classList.remove("playing");
        ctx.result = res || null;
        await load();
      },
    });
  }

  function menu() {
    const info = ctx.info;
    const ki = (info && info.kids && info.kids[kidId]) || {};
    const wrap = h("div", { class: "ht-menu", "data-screen": "menu" });
    wrap.append(h("div", { class: "ht-head" }, h("h2", {}, "Lov"), h("button", { class: "ht-x", "data-act": "hunt-close", "aria-label": "Zavřít", onclick: close }, icon("mdi:close", 28))));
    if (!info) {
      wrap.append(h("div", { class: "card", "data-id": "error" }, ctx.error ? `Lov se nenačetl: ${ctx.error}` : "Načítám…"));
      return wrap;
    }
    if (ki.open === false) {
      wrap.append(h("div", { class: "card", "data-id": "locked" }, (view.hunt && view.hunt.locked_item) || "Na lov se zatím nedá."));
      return wrap;
    }
    const entry = info.entry || {};
    const giver = castMember(view.story, entry.giver || "hunter");            // addendum 5: the hunter asks where to go (story.yaml cast, {lovec})
    const pic = giver && giver.art ? h("img", { src: npcUrl(assets, giver), alt: "", draggable: false, onerror: (ev) => ev.target.remove() }) : null;
    wrap.append(h("div", { class: "ht-hunter", "data-id": "hunter" }, pic,
      h("div", { class: "ht-bubble" }, giver ? h("div", { class: "who" }, fillText(giver.name, stageVars(view.catalog))) : null, h("p", { "data-id": "ask" }, entry.ask || "Kam dnes vyrazíme?"))));
    wrap.append(h("div", { class: "card" },
      h("p", { class: "ht-hams", "data-id": "hams" }, h("b", {}, String(ki.balance || 0)), ` šunek — do zlaťáku chybí ${ki.to_next ?? info.reward.hams_per_coin}`),
      h("p", { class: "muted", "data-id": "help" }, entry.help || "Vypočítej, kde je zvíře, jak daleko máš střílet a odkud fouká vítr. Když to zvládneš, zastihneš kořist nekrytou. Natáhni luk, počkej, zamiř a vystřel, než uteče! Lovit můžeš kolikrát chceš, ale z každého loviště dostaneš šunku jen jednou za den.")));
    const open = ki.reward_open || {}, done = ki.done_today || {};
    const gr = info.grounds || {};
    wrap.append(h("div", { class: "ops" }, info.ops.map((op) => h("button", { class: gr[op] ? "op ground" : "op", "data-op": op, "data-ground": gr[op] ? gr[op].id : null,
      style: groundStyle(gr[op]), onclick: () => play(op) },
      gr[op] ? h("span", { class: "gname" }, gr[op].name) : null,
      h("span", { class: "sym" }, OP_SYMBOL[op]), h("span", { class: "nm" }, OP_NAME[op]),
      done[op] ? h("i", { class: "done", "data-id": `done-${op}`, title: "dnes splněno" }, "✓") : null,
      open[op] === false ? h("small", { class: "muted", "data-id": `noham-${op}` }, "dnes už bez šunky") : null))));
    if (ctx.error) wrap.append(h("div", { class: "card", "data-id": "error" }, ctx.error));
    return wrap;
  }

  /** #191: the ground's picture behind its button (a CSS background: a missing file just leaves the colour). */
  function groundStyle(g) {
    const f = g && (g.background_wide || g.background);
    if (!f) return null;
    return `--gbg:url("${/^(\/|https?:|data:)/.test(f) ? f : `${assets}/${f}`}")`;
  }

  /** Addendum 10 (#189): the hams by a number are a picture, not a word (the same drawn ham as the counter of the scene). */
  function hamIcon() {
    return h("span", { class: "sc-score-icon ht-ham", "aria-label": "šunky" }, h("div", { class: "sc-shape ham" }, h("i", { class: "meat" }), h("i", { class: "bone" })));
  }

  function result(res) {
    const s = res.summary, r = res.reward || {};
    const wrap = h("div", { class: "ht-menu ht-res", "data-screen": "result", "data-id": "result" });
    const won = s.won != null ? s.won : r.hams;
    wrap.append(
      h("div", { class: "ht-head" }, h("h2", {}, `${s.quit ? "Konec lovu" : "Hotovo!"} ${s.ground && s.ground.name ? `${s.ground.name} · ` : ""}${OP_SYMBOL[s.op]} ${OP_NAME[s.op]}`), h("button", { class: "ht-x", "data-act": "hunt-close", "aria-label": "Zavřít", onclick: close }, icon("mdi:close", 28))),
      h("div", { class: "card" },
        h("p", { class: "big" }, h("b", { "data-id": "res-hits" }, String(s.hits)), ` správně z ${s.quit ? s.answered : s.size}`),
        s.shots ? h("p", { "data-id": "res-shots" }, `Zásahy: ${s.shots.hit}, vedle: ${s.shots.miss}`) : null,
        h("p", { "data-id": "res-reward" }, r.eligible
          ? [h("b", { "data-id": "res-hams" }, String(won || 0)), hamIcon(), `${r.coins ? ` → ${r.coins === 1 ? "zlaťák" : `${r.coins} zlaťáky`}!` : ""} Do zlaťáku chybí ${r.to_next}.`]
          : `Tohle kolo bylo bez šunky (dnes už jednou). Do zlaťáku chybí ${r.to_next}.`)),   // addendum 10: no count = singular, no gender
      s.wrong.length ? h("div", { class: "card ht-wrong", "data-id": "res-wrong" }, h("p", {}, "Tohle si ještě procvič:"),
        s.wrong.map((w) => h("div", { class: "ov-row" }, h("b", {}, `${w.text} = ${w.answer}`)))) : h("div", { class: "card" }, "Bez jediné chyby!"),
      h("div", { class: "row", style: { justifyContent: "center" } },
        h("button", { class: "btn", "data-act": "again", onclick: () => play(s.op) }, "Ještě jednou"),
        h("button", { class: "btn ghost", "data-act": "menu", onclick: () => { ctx.result = null; render(); } }, ((ctx.info && ctx.info.entry) || {}).other || "Jiné loviště")));
    return wrap;
  }

  function render() {
    if (closed || run) return;
    body.replaceChildren(ctx.result ? result(ctx.result) : menu());
  }

  render();
  load();
  return { close };
}
