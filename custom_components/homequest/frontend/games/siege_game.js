/* The game of the siege (#118) over the child's panel: the phone turns sideways, "Čekáme, až se připojí …" until both children are in, Start of both,
 * Obrana brány v2 (views/defend_gate_v2.js with the same synced clock and the same fold of actions), then the castellan after a lost game
 * ("Znovu do boje": waiting and Start again) or "Tvrz ubráněna!" -> "Pokračovat" -> the phone turns upright -> onWon (the panel plays the end).
 * The layer has its own shadow root with the game styles; the HA sidebar is hidden while it is shown sideways (as in the games panel). */

import { h, icon } from "../lib/dom.js";
import { ART_CSS, addPoseEntries } from "../lib/layers.js";
import { bgChain, npcUrl, castMember, stageAt } from "../lib/story.js";
import { ClockSync } from "./lib/clocksync.js";
import { CSS, CSS2 } from "./styles.js";
import { mountDefendGate2 } from "./views/defend_gate_v2.js";

const LANDSCAPE = window.matchMedia("(orientation: landscape)");
const ROTATE_MS = 1600;                  // the turning phone; then it goes on by itself once the phone is the right way (or by the button)
const MIN_STAGE = 2;

const SIEGE_CSS = `
:host { position: fixed; inset: 0; z-index: 90; height: auto; }
.body { top: 0; }
/* addendum 7 (#189): on a portrait iPhone the HUD strip of the game lay under the status bar (the layer covers the whole screen) */
@media (orientation: portrait) { .g2 { padding-top: calc(4px + env(safe-area-inset-top, 0px)); } }
.sg-screen { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: calc(20px + env(safe-area-inset-top, 0px)) 20px calc(20px + env(safe-area-inset-bottom, 0px)); text-align: center; background: #1c1a2e; }
.sg-screen h2 { margin: 0; font-size: 24px; }
.sg-screen p { margin: 0; font-size: 18px; max-width: 520px; }
.sg-phone { width: 70px; height: 120px; border: 6px solid #f3ecd8; border-radius: 14px; position: relative; animation: sg-turn ${ROTATE_MS}ms ease-in-out infinite; }
.sg-phone::after { content: ""; position: absolute; left: 50%; bottom: 6px; width: 14px; height: 4px; margin-left: -7px; border-radius: 2px; background: #f3ecd8; }
.sg-phone.back { animation-name: sg-turn-back; }
@keyframes sg-turn { 0%, 20% { transform: rotate(0); } 60%, 100% { transform: rotate(90deg); } }
@keyframes sg-turn-back { 0%, 20% { transform: rotate(90deg); } 60%, 100% { transform: rotate(0); } }
@media (prefers-reduced-motion: reduce) { .sg-phone { animation: none; } }
.sg-kids { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; }
.sg-kid { min-width: 130px; padding: 10px 14px; border-radius: 12px; background: #2a2742; font-weight: 700; }
.sg-kid .st { display: block; font-size: 13px; font-weight: 600; opacity: .8; margin-top: 4px; }
.sg-kid.in { outline: 2px solid #6fc06a; }
.sg-kid.ready { background: #2f4a2f; }
.sg-start { font-size: 26px; min-width: 200px; min-height: 64px; }
.sg-castle { display: flex; align-items: flex-end; gap: 12px; max-width: 640px; }
.sg-castle img { width: 110px; height: 110px; object-fit: contain; flex: none; }
.sg-bubble { background: #f6ecd2; color: #3a2a10; border: 4px solid #c99a2e; border-radius: 18px; padding: 12px 14px; font-size: 18px; text-align: left; }
.sg-bubble b { display: block; color: #8a5f10; margin-bottom: 4px; }
.sg-err { color: #ff9a8a; font-size: 14px; }
/* the cross (#118): top right under the HUD strip, away from Švih / Skok in the bottom corners; the game goes on under the question (realtime) */
.sg-x { position: absolute; z-index: 20; top: calc(38px + env(safe-area-inset-top)); right: max(8px, env(safe-area-inset-right)); width: 48px; height: 48px; border: 0; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; background: rgba(28, 26, 46, .7); color: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.4); touch-action: manipulation; }
.sg-x[hidden] { display: none; }
.sg-ask { position: absolute; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center; background: rgba(20, 18, 40, .55); }
.sg-ask .box { background: #2a2742; color: #fff; border-radius: 16px; padding: 18px 20px; min-width: 260px; max-width: 90%; text-align: center; box-shadow: 0 6px 18px rgba(0,0,0,.5); }
.sg-ask h3 { margin: 0 0 14px; font-size: 20px; }
.sg-ask .row { display: flex; gap: 12px; justify-content: center; }
.sg-ask .btn { min-width: 110px; min-height: 48px; font-size: 18px; }
`;

/** The swing poses of the motion PoC into the panel's art index (once per index; entries the live manifest has win). */
async function loadPoses(ctx) {
  if (ctx.stage.ix.motionPoses !== undefined) return;
  try {
    const r = await fetch(`${ctx.assets}/motion_test/art/manifest.json?v=${Date.now()}`, { cache: "no-cache" });
    ctx.stage.ix.motionPoses = r.ok ? addPoseEntries(ctx.stage.ix, await r.json(), "../motion_test/art/") : 0;
  } catch (e) { ctx.stage.ix.motionPoses = 0; }
}

/** opts: {hass, api, stage (the panel's art stage), view, kidId, onWon(), onClose()}. Returns {close()}. */
export function openSiegeGame(root, opts) {
  const { api, view, kidId } = opts;
  const story = view.story;
  const stageId = view.siege.stage;
  const st = story.fortress.stages.find((s) => s.id === stageId);
  const castellan = castMember(story, (st.siege.lost && st.siege.lost.giver) || "castellan");
  const host = h("div", { class: "siege-game", "data-siege": "" });
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = ART_CSS + CSS + CSS2 + SIEGE_CSS;
  const body = h("div", { class: "body" });
  const exitBtn = h("button", { class: "sg-x", "data-act": "siege-exit", "aria-label": "Odejít z bitvy", onclick: () => askLeave() }, icon("mdi:close", 28));
  shadow.append(style, body, exitBtn);
  root.append(host);

  const kidsOf = Object.fromEntries(view.catalog.kids.map((k) => [k.id, { ...((view.kids || {})[k.id] || {}), id: k.id, name: k.name }]));
  const ctx = {
    assets: "/homequest_assets", session: null, me: null, mypid: null, kids: kidsOf, hctx: { cat: view.catalog, items: Object.fromEntries(view.catalog.items.map((i) => [i.id, i])) },
    // #101 variant A everywhere (v1.4.0): the swing poses of the live art (the outfit's set poses and the weapons in the pose) where they
    // exist, else the hero's one picture (plan D). The motion PoC art (assets/motion_test) is mixed in only on TEST (production has none)
    stage: opts.stage, heroVariant: "a", showRtt: view.env === "test", debug: false, error: "",
    fortressBg: null,
  };
  const at = stageAt(story, view.fortress ? view.fortress.done : 0);
  if (at) ctx.fortressBg = bgChain(story, story.fortress.stages[Math.max(at.index, Math.min(MIN_STAGE, story.fortress.stages.length - 1))].id);
  ctx.call = (type, data = {}) => {
    if (type === "game_event") return api.call("siege_event", { t: data.t, action: data.action });
    return api.call(type, data);
  };
  ctx.clock = new ClockSync(async () => (await api.call("siege_ping")).t);
  if (view.env === "test") ctx.winTest = () => api.call("siege_win").catch((e) => { ctx.error = e.message || String(e); render(); });   // "Vyhrát", TEST only
  ctx.resultView = (c, s) => resultView(s);
  window.__hqSiege = ctx;                // the tests
  const poses = view.env === "test" && ctx.stage && ctx.stage.illustrated && ctx.stage.ix ? loadPoses(ctx) : Promise.resolve();

  let mode = "rotate";                   // rotate -> lobby -> game -> (lost -> lobby) | won -> back -> done
  let run = null, unsub = null, closed = false, kioskWas = null, rotateTimer = 0, rotateReady = false;

  const kiosk = () => {
    const want = !closed && LANDSCAPE.matches && mode !== "back";
    if (want === (kioskWas !== null)) return;
    if (want) kioskWas = !!(opts.hass && opts.hass.kioskMode);
    window.dispatchEvent(new CustomEvent("hass-kiosk-mode", { detail: { enable: want ? true : kioskWas } }));
    if (!want) kioskWas = null;
  };
  const onOrient = () => { kiosk(); if ((mode === "rotate" && rotateReady && LANDSCAPE.matches) || (mode === "back" && rotateReady && !LANDSCAPE.matches)) advance(); else render(); };
  LANDSCAPE.addEventListener("change", onOrient);

  function startRotate(next) {
    mode = next;
    rotateReady = false;
    clearTimeout(rotateTimer);
    rotateTimer = setTimeout(() => {
      rotateReady = true;
      const right = mode === "rotate" ? LANDSCAPE.matches : !LANDSCAPE.matches;
      if (right) advance();
      else render();
    }, ROTATE_MS);
    render();
  }

  async function advance() {
    clearTimeout(rotateTimer);
    if (mode === "rotate") {
      mode = "lobby";
      render();
      await join();
    } else if (mode === "back") {
      close();
      opts.onWon && opts.onWon();
    }
  }

  let joining = false, autoJoined = "";
  async function join() {
    if (joining) return;
    joining = true;
    ctx.error = "";
    try {
      const r = await api.call("siege_join");
      ctx.mypid = r.pid;
      autoJoined = "";                        // in again: a later drop from the lobby may rejoin by itself
      // the other defender's hero (the view has only this child); this child's own look stays the view's
      for (const [id, look] of Object.entries(r.looks || {})) if (kidsOf[id] && id !== kidId) Object.assign(kidsOf[id], look);
      await poses;
      ctx.clock.sync(9, 40).then(() => render());
    } catch (e) {
      ctx.error = e.message || String(e);
    }
    joining = false;
    render();
  }

  async function ready() {
    ctx.error = "";
    try {
      await ctx.clock.sync(9, 40);
      await api.call("siege_ready");
    } catch (e) {
      ctx.error = e.message || String(e);
    }
    render();
  }

  function onEvent(ev) {
    ctx.me = ev.me;
    if (ev.kind === "session") {
      if (ctx.session && ev.session && ctx.session.id === ev.session.id) Object.assign(ctx.session, ev.session);
      else ctx.session = ev.session;
      render();
    } else if (ev.kind === "state" && ctx.session && ctx.session.id === ev.id) {
      ctx.session.state = ev.state;
      ctx.session.phase = ev.phase;
      if (run) run.onState();
      if (ev.phase === "finished") render();
    }
  }

  function resultView(s) {
    const won = s.state && s.state.status === "won";
    if (won) {
      return [h("div", { class: "res-t", "data-id": "result" }, "Tvrz ubráněna!"),
        h("button", { class: "btn", "data-act": "siege-continue", onclick: () => { stopRun(); startRotate("back"); } }, "Pokračovat")];
    }
    const lost = st.siege.lost;
    return [h("div", { class: "sg-castle", "data-id": "result", "data-result": "lost" },
      h("img", { src: npcUrl(ctx.assets, castellan), alt: castellan.name, onerror: (e) => { e.target.style.visibility = "hidden"; } }),
      h("div", { class: "sg-bubble" }, h("b", {}, castellan.name), lost.text.join(" "))),
    h("button", { class: "btn", "data-act": "siege-retry", onclick: () => { stopRun(); mode = "lobby"; ctx.session = null; render(); join(); } }, "Znovu do boje")];
  }

  function stopRun() {
    if (run) run.destroy();
    run = null;
    host.removeAttribute("playing");
  }

  function render() {
    if (closed) return;
    kiosk();
    exitBtn.hidden = mode === "back";
    const s = ctx.session;
    if ((mode === "lobby" || mode === "game") && s && (s.phase === "running" || s.phase === "finished") && s.players.some((p) => p.pid === ctx.mypid)) {
      mode = "game";
      if (!run || run.sid !== s.id) {
        stopRun();
        host.setAttribute("playing", "");
        run = { sid: s.id, ...mountDefendGate2(ctx, body) };
        ctx.run = run;
      }
      return;
    }
    if (mode === "game") mode = "lobby";       // the session went away under a running view
    stopRun();
    const key = s ? `${s.id}.${s.phase}` : "none";
    if (mode === "lobby" && ctx.mypid && !joining && autoJoined !== key && !(s && s.phase === "lobby" && s.players.some((p) => p.pid === ctx.mypid))) {
      autoJoined = key;                       // once per session and phase: a refused join does not loop
      // not in the lobby any more: the other child started a new one after a loss, or the connection came back (the server drops a lost
      // connection from the lobby). Join again by itself, so both phones show the same lobby with their own Start (v1.4.0, #118)
      join();
    }
    if (mode === "rotate" || mode === "back") {
      const right = mode === "rotate" ? LANDSCAPE.matches : !LANDSCAPE.matches;
      body.replaceChildren(h("div", { class: "sg-screen", "data-id": mode === "rotate" ? "rotate" : "rotate-back" },
        h("div", { class: `sg-phone${mode === "back" ? " back" : ""}` }),
        h("h2", {}, mode === "rotate" ? "Otoč telefon na šířku" : "Otoč telefon zpátky"),
        rotateReady && !right ? h("button", { class: "btn ghost", "data-act": "rotate-skip", onclick: () => advance() }, "Pokračovat") : null));
      return;
    }
    body.replaceChildren(lobbyView(s));
  }

  function lobbyView(s) {
    const need = (s && s.siege && s.siege.kids) || view.catalog.kids.map((k) => k.id);
    const joined = new Set(s ? s.players.map((p) => p.pid) : []);
    const readyIds = new Set(s ? s.ready || [] : []);
    const name = (id) => (kidsOf[id] && kidsOf[id].name) || id;
    const missing = need.filter((id) => !joined.has(id));
    const iReady = readyIds.has(ctx.mypid);
    const others = need.filter((id) => id !== ctx.mypid && !readyIds.has(id));
    let text;
    if (!ctx.mypid) text = "Připojuji…";
    else if (missing.length) text = `Čekáme, až se připojí ${missing.map(name).join(" a ")}…`;
    else if (iReady) text = others.length ? `Start zmáčknutý. Čekáme, až ${others.map(name).join(" a ")} zmáčkne Start…` : "Začínáme!";
    else text = "Všichni jsou tady. Zmáčkni Start, až budeš chtít začít.";
    return h("div", { class: "sg-screen", "data-id": "siege-lobby" },
      h("h2", {}, "Obrana tvrze"),
      h("p", { "data-id": "siege-wait" }, text),
      h("div", { class: "sg-kids" }, need.map((id) => h("div", { class: `sg-kid${joined.has(id) ? " in" : ""}${readyIds.has(id) ? " ready" : ""}`, "data-kid": id },
        name(id), h("span", { class: "st" }, readyIds.has(id) ? "připraven" : joined.has(id) ? "připojen" : "čeká se")))),
      ctx.mypid && !missing.length && !iReady ? h("button", { class: "btn sg-start", "data-act": "siege-start", onclick: () => ready() }, "Start") : null,
      ctx.error ? h("div", { class: "sg-err", "data-id": "error" }, ctx.error) : null,
      h("button", { class: "btn ghost", "data-act": "siege-leave", onclick: () => leave() }, icon("mdi:arrow-left", 20), "Zpět na přípravu"));
  }

  /** The cross (#118): "Opravdu odejít z bitvy?" Ano / Zpět. The game does not stop for the question (it is realtime). */
  function askLeave() {
    if (closed || shadow.querySelector(".sg-ask")) return;
    const ask = h("div", { class: "sg-ask", "data-id": "siege-exit-ask" },
      h("div", { class: "box" }, h("h3", {}, "Opravdu odejít z bitvy?"),
        h("div", { class: "row" },
          h("button", { class: "btn ghost", "data-act": "siege-exit-no", onclick: () => ask.remove() }, "Zpět"),
          h("button", { class: "btn", "data-act": "siege-exit-yes", onclick: () => { ask.remove(); leaveBattle(); } }, "Ano"))));
    shadow.append(ask);
  }

  /** Out of the battle (#118): out of the lobby or the running game (the hero goes for good, the other one plays on), away from this attack on
   *  the server (no jump back by itself), nothing is lost or given; the panel shows the hero. */
  async function leaveBattle() {
    const s = ctx.session;
    try { if (ctx.mypid && s && (s.phase === "lobby" || s.phase === "running")) await api.call("siege_leave"); } catch (e) { /* nothing to leave */ }
    try { await api.call("siege_away", { away: true }); } catch (e) { /* the attack ended meanwhile */ }
    close();
    (opts.onLeft || opts.onClose) && (opts.onLeft || opts.onClose)();
  }

  async function leave() {
    try { if (ctx.mypid && ctx.session && ctx.session.phase === "lobby") await api.call("siege_leave"); } catch (e) { /* nothing to leave */ }
    close();
    opts.onClose && opts.onClose();
  }

  function close() {
    if (closed) return;
    stopRun();
    closed = true;
    kiosk();
    clearTimeout(rotateTimer);
    LANDSCAPE.removeEventListener("change", onOrient);
    document.removeEventListener("visibilitychange", onVisible);
    if (unsub) Promise.resolve(unsub).then((u) => u && u());
    host.remove();
    if (window.__hqSiege === ctx) window.__hqSiege = null;
  }

  const onVisible = () => {                // the screen came back on: ask for the lobby again (a dropped connection left it)
    if (document.visibilityState !== "visible" || closed) return;
    api.call("siege_state").then((r) => { if (r && r.session !== undefined) onEvent({ kind: "session", me: r.me, session: r.session }); }).catch(() => {});
  };
  document.addEventListener("visibilitychange", onVisible);
  unsub = api.subscribeTo("siege_subscribe", onEvent).catch((e) => { ctx.error = e.message || String(e); render(); });
  startRotate("rotate");
  return { close, ctx };
}
