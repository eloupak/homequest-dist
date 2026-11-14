/* Defend the fortress v2 (side view). The fortress (the picture of its current stage from the Quest) stands behind the heroes in the middle;
 * one hero stands in the centre, two symmetrically around it (lane 0 left, lane 1 right). Orcs come along one horizontal axis from both
 * sides to the nearest hero and attack him; each hero has lives (not shown: a lost life is the stagger). Two buttons: Švih (sword) and Skok (jump).
 * The HUD: the names, the wave with the orcs left in it and a thin bar of the whole game (waveInfo, the same on every phone); no gems (decided 2026-11-04, the engine still counts them).
 *
 * The state is a fold of the log of actions (lib/timeline2.js, the same code as the server's engine_v2.py): our own action is applied at
 * once (the time of the tap on the synced server clock), sent to the server, and the server's log (which holds the actions of both players)
 * is merged in whenever it arrives; an older action of the other player makes the sim re-fold the past. The hero comes from the layered art; an
 * orc type is the sprite set `sprite_goblin_<type>_<pose>` (aligned by the art import onto the hero's canvas: feet on the same ground row) when
 * the whole set is in the art manifest, else a placeholder made of CSS shapes; the stones and everything else are CSS shapes. */

import { h } from "../../lib/dom.js";
import { heroSpec } from "../../views/common.js";
import { findEntry, hasPose } from "../../lib/layers.js";
import { poseWeights } from "../lib/heropose.js";
import { bgUrl } from "../../lib/story.js";
import { Sim, generate, timelineCheck, waveInfo } from "../lib/timeline2.js";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const LUNGE_MS = 280;
// the band of the picture (fractions of its height) where the heroes may stand: any line in it is put on the ground line of the game (see
// fortFit). The Quest picture bg_<stage> is portrait 2:3, the wide one bg_<stage>_wide (bg_fortress_wide_<n>) 3:2 with the meadow from ~0.73 down
const FORT_FOOT = [0.6, 0.6];
const WIDE_FOOT = [0.75, 0.92];
const ACTIVE = ["walk", "attack", "grab", "hold", "throw", "stun"];
const STRIKE_MS = 260;
const WAVE_SHOW_MS = 1800;               // the announcement "Vlna N" over the scene when a wave starts                   // the strike picture after each blow, throw of a stone or missed grab
// the orc types drawn from sprite sets (group of design/sprites.json; a type with a half set stays a placeholder). nohelm: the armored after
// his first hit (lost the helmet); poses: the grabber also holds the caught hero
const SPRITES = {
  basic: { group: "goblin_basic" },
  scout: { group: "goblin_scout" },
  thrower: { group: "goblin_thrower" },
  armored: { group: "goblin_armored", nohelm: "goblin_armored_nohelm" },
  grabber: { group: "goblin_grabber", poses: ["hold"] },
};
const SPRITE_POSES = ["walk_a", "walk_b", "raise", "strike", "hit"];


export function mountDefendGate2(ctx, host) {
  const s = ctx.session;
  const cfg = s.config;
  const specs = generate(cfg, s.seed, s.players);
  const check = timelineCheck(specs);
  const mismatch = check !== s.check;
  const sim = new Sim(cfg, specs, s.players);
  const myLane = s.players.findIndex((p) => p.pid === ctx.mypid);
  const stats = (ctx.stats = ctx.stats || { taps: [], lags: [], acks: [], rebuilds: 0 });
  const pending = [];                    // our own actions that the server's log does not contain (yet): {ev, sent}
  const els = new Map();                 // orc id -> element
  const stoneEls = new Map();
  const seenSwing = [-1, -1];
  const facing = s.players.map((_p, i) => (i === 1 ? "r" : "l"));
  const sprites = spriteSets(ctx);
  let raf = 0, dead = false, dirty = false, lastOver = "", lastWave = "", annWave = 0;
  const dims = { w: 0, h: 0, cx: 0, inner: 0, kOut: 0, ground: 0, hero: 64 };

  const rttTxt = ctx.showRtt === false ? null : h("span", { class: "g2-rtt", "data-id": "rtt" });
  const waveTxt = h("span", { class: "g2-wt", "data-id": "wave" });
  const waveBar = h("i", { class: "g2-wbar-in" });
  const hud = h("div", { class: "g2-top" },
    h("span", { class: "g2-names" }, ...s.players.flatMap((p, i) => [i ? " · " : null, h("span", { class: "g2-pl" }, p.name)].filter(Boolean))),
    h("span", { class: "g2-wave" }, waveTxt, h("i", { class: "g2-wbar", "data-id": "progress" }, waveBar)),
    h("span", { class: "g2-gems" }, rttTxt),          // no gems in the game (decided 2026-11-04), the right corner keeps the RTT on TEST
    ctx.winTest ? h("button", { class: "btn g2-win", "data-act": "win-test", onclick: (e) => { e.currentTarget.disabled = true; ctx.winTest(); } }, "Vyhrát") : null);   // TEST only
  const waveAnn = h("div", { class: "g2-ann", "data-id": "wave-ann" });
  const fort = fortressEl(ctx, () => measure());
  const scene = h("div", { class: "g2-scene" }, h("div", { class: "g2-hills" }), fort, h("div", { class: "g2-ground" }));
  const dbg = h("div", { class: "g2-dbg", "data-id": "dbg" });
  const over = h("div", { class: "over" });
  const btnSwing = h("button", { class: "g2-btn swing", "data-act": "swing", "aria-label": "Švih" }, h("span", {}, "Švih"));
  const btnJump = h("button", { class: "g2-btn jump", "data-act": "jump", "aria-label": "Skok" }, h("span", {}, "Skok"));
  const controls = myLane >= 0 ? h("div", { class: "g2-ctl" }, btnSwing, btnJump) : h("div", { class: "g2-ctl watch" }, "Díváš se jen, nehraješ.");
  scene.append(waveAnn);
  const root = h("div", { class: "g2" }, hud, scene, controls, ctx.debug ? dbg : null, over);
  host.replaceChildren(root);

  // heroes: lane 0 stands on the left, lane 1 on the right (one hero in the centre). He faces the nearest orc that comes for him (at the start
  // lane 0 and a lone hero left, lane 1 right): the front view holds the weapon on the left of the picture, so facing right = mirrored
  if (ctx.stage && ctx.stage.begin) ctx.stage.begin("games");
  const heroes = s.players.map((p, i) => {
    const he = heroEl(ctx, p, i);
    const flip = h("div", { class: "g2-hflip", "data-side": i === 0 ? "l" : "r" }, ...he.els);
    const slash = h("i", { class: "g2-slash" });
    const dust = h("i", { class: "g2-held" });
    const box = h("div", { class: `g2-hero ${i === myLane ? "own" : ""}`, "data-lane": i }, flip, slash, dust);   // no name over the hero (v1.4.0): the names are in the top HUD
    scene.append(box);
    return { box, flip, slash, dust, shown: -1, poses: he.poses, preview: !!he.preview };
  });
  if (heroes.some((x) => x.preview)) scene.append(h("span", { class: "g2-prev", "data-id": "swing-preview" }, "Náhled švihu"));
  if (ctx.stage && ctx.stage.end) ctx.stage.end();

  const simNow = () => ctx.clock.serverNow() - s.start_ms;
  // x (units, signed, 0 = the centre) -> px. Symmetric around the middle of the scene. With two heroes the part between them is drawn wide
  // enough that the two pictures do not overlap, the rest out to the edge fills the width; sprites keep one size.
  const gap = s.players.length === 2 ? cfg.hero_gap : 0;
  const xOf = (x) => {
    const a = Math.abs(x);
    const px = a <= gap ? (gap ? (a * dims.inner) / gap : 0) : dims.inner + (a - gap) * dims.kOut;
    return dims.cx + Math.sign(x) * px;
  };

  function measure() {
    dims.w = scene.clientWidth;
    dims.h = scene.clientHeight;
    dims.cx = dims.w / 2;
    // landscape: the buttons lie over the scene (position absolute in the CSS), so the ground strip is high enough to hold them below the feet
    const overlay = getComputedStyle(controls).position === "absolute";
    dims.ground = overlay ? Math.max(dims.h * 0.2, btnSwing.offsetHeight + 18) : dims.h * 0.2;
    dims.hero = clamp(Math.min(dims.w * 0.25, dims.h * 0.4, (dims.h - dims.ground) * 0.55), 50, 130);
    const half = dims.cx - 8;
    dims.inner = gap ? Math.max((gap * half) / sim.edge, dims.hero * 0.62) : 0;
    dims.kOut = (half - dims.inner) / (sim.edge - gap);
    scene.style.setProperty("--hero", `${dims.hero}px`);
    scene.style.setProperty("--ground", `${dims.ground}px`);
    // the fortress: covers the whole scene (sideways the width, cropped at the top and bottom), as little zoomed as it can be, centred
    const iw = fort.naturalWidth, ih = fort.naturalHeight;
    if (iw && ih) {
      const f = fortFit(dims.w, dims.h, dims.ground, iw, ih, fort.dataset.foot.split(",").map(Number));
      Object.assign(fort.style, { width: `${f.W}px`, height: `${f.H}px`, left: `${f.left}px`, top: `${f.top}px` });
      fort.dataset.fit = JSON.stringify({ h: +(Math.min(1, dims.h / f.H) * 100).toFixed(1), w: +(Math.min(1, dims.w / f.W) * 100).toFixed(1), foot: +f.foot.toFixed(3),
        from: +((-f.top / f.H) * 100).toFixed(1) });
    }
  }
  const ro = new ResizeObserver(measure);
  ro.observe(scene);

  // ------------------------------------------------------------------ input
  let lastList = null;
  function reconcile() {
    const list = (s.state && s.state.events) || [];
    if (!dirty && list === lastList) return;
    lastList = list;
    for (let i = pending.length - 1; i >= 0; i--) if (list.some((e) => e.lane === pending[i].ev.lane && e.action === pending[i].ev.action && e.t === pending[i].ev.t)) pending.splice(i, 1);
    if (dirty) {                         // the server refused one of our actions: fold again from the server's log plus what is still on its way
      const c = sim.cursor;
      sim.setEvents([...list, ...pending.map((p) => p.ev)]);
      sim.runTo(c);
      stats.rebuilds++;
      dirty = false;
    } else {
      for (const e of list) if (!sim.hasEvent(e) && sim.addEvent(e)) stats.rebuilds++;
    }
  }

  function act(action) {
    if (myLane < 0 || s.phase !== "running" || !s.state || s.state.status !== "running") return;
    const t = Math.round(simNow());
    if (t < 0) return;
    sim.runTo(t);
    stats.taps.push({ t, action });
    if (!sim.canAct(myLane, action, t)) return;
    const ev = { lane: myLane, action, t };
    sim.addEvent(ev);
    const rec = { ev, sent: performance.now() };
    pending.push(rec);
    ctx.call("game_event", { session_id: s.id, pid: ctx.mypid, t, action }).then(
      (res) => {
        stats.acks.push({ ...ev, ...res, ms: performance.now() - rec.sent });
        if (res.ok === false) { const i = pending.indexOf(rec); if (i >= 0) pending.splice(i, 1); dirty = true; }
      },
      (e) => { stats.acks.push({ ...ev, ok: false, reason: e.code || String(e) }); const i = pending.indexOf(rec); if (i >= 0) pending.splice(i, 1); dirty = true; });
  }
  const press = (action) => (ev) => { ev.preventDefault(); act(action); };
  btnSwing.addEventListener("pointerdown", press("swing"));
  btnJump.addEventListener("pointerdown", press("jump"));
  const onKey = (ev) => {
    if (ev.repeat) return;
    if (ev.code === "Space" || ev.code === "KeyA" || ev.code === "KeyJ") { ev.preventDefault(); act("swing"); }
    else if (ev.code === "ArrowUp" || ev.code === "KeyW" || ev.code === "KeyK") { ev.preventDefault(); act("jump"); }
  };
  window.addEventListener("keydown", onKey);

  // ------------------------------------------------------------------ drawing
  function frame() {
    if (dead) return;
    const now = simNow();
    reconcile();
    if (now >= 0 && s.phase !== "finished") sim.runTo(now);
    const at = Math.max(now, 0);
    drawHeroes(at);
    drawOrcs(at);
    drawStones(at);
    drawWave(now);
    const rtt = `${ctx.clock.stats.rtt_med.toFixed(0)} ms`;
    if (rttTxt && rttTxt.textContent !== rtt) rttTxt.textContent = rtt;
    // the overlay is rebuilt only when it changes (a button that is replaced every frame cannot be pressed)
    let okey = "", build = null, cls = "over";
    if (s.phase === "running" && now < 0) { okey = `c${Math.ceil(-now / 1000)}`; build = () => [h("div", { class: "big" }, String(Math.ceil(-now / 1000)))]; }
    else if (s.phase === "finished" && s.state) { okey = `r${s.state.status}${s.state.gems}`; cls = "over res"; build = () => (ctx.resultView || resultNodes)(ctx, s, stats); }
    if (okey !== lastOver) { lastOver = okey; over.className = cls; over.replaceChildren(...(build ? build() : [])); }
    if (ctx.debug) dbg.textContent = `sim ${Math.round(now)}  cursor ${sim.cursor}  events ${sim.events.length}  pending ${pending.length}  rebuilds ${stats.rebuilds}  rtt ${ctx.clock.stats.rtt_med.toFixed(0)}  check ${check}${mismatch ? " MISMATCH" : ""}`;
    raf = requestAnimationFrame(frame);
  }

  function drawHeroes(now) {
    s.players.forEach((_p, i) => {
      const st = sim.heroes[i];
      const el = heroes[i];
      let near = null;
      for (const e of sim.en) {
        if (e.target !== i || !ACTIVE.includes(e.phase)) continue;
        const d = Math.abs(sim.pos(e, now) - st.x);
        if (!near || d < near.d) near = { d, side: sim.pos(e, now) < st.x ? "l" : "r" };
      }
      if (near && st.caught === null) facing[i] = near.side;
      if (el.flip.dataset.side !== facing[i]) el.flip.dataset.side = facing[i];
      const dir = facing[i] === "l" ? -1 : 1;
      const x = xOf(st.x);
      let dx = 0, dy = 0;
      const lp = (now - st.last_swing) / LUNGE_MS;
      if (lp >= 0 && lp <= 1 && st.caught === null) dx = dir * Math.sin(Math.PI * lp) * dims.hero * 0.28;
      const jp = (now - st.air_from) / cfg.jump_ms;
      if (st.air_from >= 0 && jp >= 0 && jp <= 1) dy = -4 * jp * (1 - jp) * dims.hero * 0.85;
      el.box.style.transform = `translate(${(x - dims.hero / 2 + dx).toFixed(1)}px, ${dy.toFixed(1)}px)`;
      if (seenSwing[i] !== st.last_swing) {
        seenSwing[i] = st.last_swing;
        el.slash.classList.remove("on");
        if (lp >= 0 && lp < 1) { void el.slash.offsetWidth; el.slash.classList.add("on"); }
      }
      if (el.poses) setPoses(el.poses, now - st.last_swing, st.caught !== null);
      const staggered = now < st.stagger_until;
      el.box.classList.toggle("stagger", staggered);
      el.box.classList.toggle("held", st.caught !== null);
      el.box.classList.toggle("air", st.air_from >= 0 && jp >= 0 && jp <= 1);
      el.box.classList.toggle("out", st.out);
      el.box.classList.toggle("gone", !!st.gone);              // left the game with the cross (#118): not drawn any more
      if (el.shown !== st.lives) { el.shown = st.lives; el.box.dataset.lives = String(st.lives); }      // not drawn (#100 addendum 7), for the tests
    });
  }

  /** "Vlna 2/4 · zbývá 6" and the bar of the whole game in the HUD; when a wave starts its number over the scene for a moment. */
  function drawWave(now) {
    const wi = waveInfo(sim, Math.max(now, 0));
    const txt = s.phase === "finished" ? `Vlna ${wi.wave}/${wi.waves}` : `Vlna ${wi.wave}/${wi.waves} · zbývá ${wi.left}`;
    if (txt !== lastWave) {
      lastWave = txt;
      waveTxt.textContent = txt;
      waveBar.style.width = `${((100 * wi.gone) / Math.max(1, wi.total)).toFixed(1)}%`;
      hud.dataset.wave = String(wi.wave);
      hud.dataset.left = String(wi.left);
    }
    const start = cfg.waves[wi.wave - 1].start_ms;
    const show = s.phase === "running" && now >= start && now < start + WAVE_SHOW_MS ? wi.wave : 0;
    if (show !== annWave) {
      annWave = show;
      waveAnn.textContent = show ? (show === wi.waves && wi.waves > 1 ? `Vlna ${show} — poslední!` : `Vlna ${show}`) : "";
      waveAnn.classList.toggle("on", !!show);
    }
  }

  function drawOrcs(now) {
    for (const e of sim.en) {
      let el = els.get(e.id);
      const visible = e.phase !== "wait" && e.phase !== "gone";
      if (!visible) { if (el) { el.root.remove(); els.delete(e.id); } continue; }
      if (!el) {
        el = orcEl(e, sprites[e.type]);
        scene.append(el.root);
        els.set(e.id, el);
      }
      const ex = sim.pos(e, now);
      // a sprite is drawn on the hero's square canvas (the same scale and ground row as the hero picture); a placeholder is a box of its own
      const w = el.art ? dims.hero : dims.hero * (e.type === "scout" ? 0.5 : e.type === "grabber" ? 0.78 : 0.62);
      const tx = e.target >= 0 ? sim.heroes[e.target].x : 0;
      // the grabber holding the hero stands right at him (drawing only, the sim keeps him where he grabbed)
      const x = xOf(e.phase === "hold" ? tx + Math.sign(ex - tx) * (cfg.hold_gap || 0) : ex);
      const side = e.phase === "flee" ? (e.goal < 0 ? "r" : "l") : ex < tx ? "l" : "r";       // "l" = on the left of his hero, faces right
      if (el.inner.dataset.side !== side) el.inner.dataset.side = side;
      let up = 0;
      if (e.phase === "walk") up = Math.abs(Math.sin(now / (e.type === "scout" ? 70 : 140))) * dims.hero * 0.04;
      if (e.phase === "flee") up = Math.min(1, (now - e.t0) / 250) * dims.hero * 0.35;
      el.root.style.transform = `translate(${(x - w / 2).toFixed(1)}px, ${(-up).toFixed(1)}px)`;
      el.root.style.width = `${w}px`;
      el.root.style.height = `${el.art ? w : w * 1.15}px`;
      // a blow of the club, a thrown stone or a missed grab: the time of the next one moved on in the same phase -> the strike picture for a moment
      const swings = e.phase === "attack" || e.phase === "throw" || e.phase === "grab";
      if (swings && el.tn !== undefined && el.tph === e.phase && e.t_next !== el.tn && el.tn <= now) el.struck = el.tn;
      el.tn = swings ? e.t_next : undefined;
      el.tph = e.phase;
      let pose = e.phase;
      if (e.phase === "attack" || e.phase === "grab") pose = e.t_next - now <= e.windup ? "raise" : "ready";
      if (e.phase === "throw") pose = e.t_next - now <= e.throw_windup ? "raise" : "ready";
      if (swings && pose !== "raise" && now - el.struck < STRIKE_MS) pose = "strike";
      if (e.phase === "walk") pose = Math.floor(now / (e.type === "scout" ? 120 : 260)) % 2 ? "walk-b" : "walk-a";
      el.inner.dataset.pose = pose;
      if (el.art) setSprite(el, pose, !e.helmet);
      el.inner.classList.toggle("nohelmet", !e.helmet);
      el.root.dataset.phase = e.phase;
      el.root.dataset.hp = String(e.hp);
    }
  }

  function drawStones(now) {
    const live = new Set();
    for (const st of sim.stones) {
      const key = `${st.from}:${st.t_launch}`;
      live.add(key);
      let el = stoneEls.get(key);
      if (!el) { el = h("i", { class: "g2-stone" }); scene.append(el); stoneEls.set(key, el); }
      const f = clamp((now - st.t_launch) / (st.t_land - st.t_launch), 0, 1);
      const x = st.x + (sim.heroes[st.target].x - st.x) * f;
      const arc = Math.sin(Math.PI * f) * dims.hero * 0.5 + dims.hero * 0.35 * (1 - f) + dims.hero * 0.25 * f;
      el.style.transform = `translate(${(xOf(x) - 7).toFixed(1)}px, ${(-arc).toFixed(1)}px) rotate(${Math.round(f * 720)}deg)`;
    }
    for (const [k, el] of stoneEls) if (!live.has(k)) { el.remove(); stoneEls.delete(k); }
  }

  measure();
  raf = requestAnimationFrame(frame);

  return {
    sim, check, mismatch, pending,
    onState() {},
    destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", onKey);
    },
  };
}

/** The place of the fortress picture (iw x ih) in a scene w x h whose ground strip is `ground` px high: the smallest size which covers the
 *  scene (width and height) and can put a line of the band foot = [min, max] on the ground line (the highest such line: the heroes stand as
 *  close to the wall as the band lets them, a picture taller than the scene loses mostly sky). Centred. {W, H, left, top, foot} */
export function fortFit(w, h, ground, iw, ih, [fmin, fmax]) {
  const sky = h - ground;
  const H = Math.max(h, (w * ih) / iw, sky / fmax, ground / (1 - fmin));
  const W = (H * iw) / ih;
  const foot = Math.max(fmin, sky / H);
  return { W, H, left: w / 2 - W / 2, top: sky - foot * H, foot };
}

/** fortress_1 -> fortress_wide_1 (the wide picture of a stage for the game). */
export const wideBg = (id) => { const m = /^(.*)_(\d+)$/.exec(id); return m ? `${m[1]}_wide_${m[2]}` : `${id}_wide`; };

/** The pictures to try for the fortress, best first: for the current stage (ctx.fortressBg = stage ids, the wanted one first) its wide picture
 *  (the art manifest, else assets/story), then the Quest picture; a missing one falls back to the previous stage. [{bg, src, foot}] */
export function fortressCandidates(ctx) {
  const chain = ctx.fortressBg && ctx.fortressBg.length ? ctx.fortressBg : ["fortress_1", "fortress_0"];
  const assets = ctx.assets || "/homequest_assets";
  const ix = ctx.stage && ctx.stage.ix;
  const out = [];
  for (const id of chain) {
    const wide = wideBg(id);
    const e = ix ? findEntry(ix, "bg", null, wide, null, null) : null;
    if (e) out.push({ bg: wide, src: ctx.stage.url(e.file), foot: WIDE_FOOT });
    out.push({ bg: wide, src: bgUrl(assets, wide), foot: WIDE_FOOT });
    out.push({ bg: id, src: bgUrl(assets, id), foot: FORT_FOOT });
  }
  return out;
}

/** The fortress behind the heroes over the whole scene (see fortressCandidates; none at all leaves the sky, the hills and the ground strip). */
function fortressEl(ctx, onLoad) {
  const cands = fortressCandidates(ctx);
  const img = h("img", { class: "g2-fort", alt: "", draggable: "false", "data-id": "fortress" });
  let i = 0;
  const show = () => { img.dataset.bg = cands[i].bg; img.dataset.foot = String(cands[i].foot); img.src = cands[i].src; };
  img.onload = () => { img.dataset.ok = "1"; onLoad(); };
  img.onerror = () => {
    i++;
    if (i < cands.length) show();
    else img.style.display = "none";
  };
  show();
  return img;
}

/** {type: {pose: url}} of the orc types whose whole sprite set is in the art manifest (TEST: imported by the art timer; nothing is drawn from
 *  a half set). The armored's set without the helmet goes in as `nohelm:<pose>` when it is whole too. */
function spriteSets(ctx) {
  const out = {};
  const ix = ctx.stage && ctx.stage.ix;
  if (!ix || !ctx.stage.url) return out;
  const set = (group, poses) => {
    const urls = {};
    for (const p of poses) {
      const e = findEntry(ix, "sprite", null, `${group}_${p}`, null, null);
      if (e) urls[p] = ctx.stage.url(e.file);
    }
    return Object.keys(urls).length === poses.length ? urls : null;
  };
  for (const [type, sp] of Object.entries(SPRITES)) {
    const urls = set(sp.group, [...SPRITE_POSES, ...(sp.poses || [])]);
    if (!urls) continue;
    const bare = sp.nohelm ? set(sp.nohelm, SPRITE_POSES) : null;
    if (bare) for (const [p, u] of Object.entries(bare)) urls[`nohelm:${p}`] = u;
    out[type] = urls;
  }
  return out;
}

/** Game pose -> sprite picture: walking alternates walk_a / walk_b, waiting between blows stands as walk_a (weapon on the shoulder), the wind-up
 *  is raise, the blow (or the throw) strike, a hit and running away hit, the grabber holding the hero hold (walk_a in a set without it). */
const SPRITE_OF = { "walk-a": "walk_a", "walk-b": "walk_b", ready: "walk_a", raise: "raise", strike: "strike", stun: "hit", flee: "hit", hold: "hold", throw: "walk_a" };

function setSprite(el, pose, bare) {
  let want = SPRITE_OF[pose] || "walk_a";
  if (!el.art[want]) want = "walk_a";
  if (bare && el.art[`nohelm:${want}`]) want = `nohelm:${want}`;
  if (el.shownSprite === want) return;
  el.shownSprite = want;
  el.inner.dataset.sprite = want;
  for (const [p, im] of Object.entries(el.art)) im.classList.toggle("on", p === want);
}

function orcEl(e, art) {
  // all pictures of the set stacked, one shown (no reload or flicker when the pose changes)
  const imgs = art ? Object.fromEntries(Object.entries(art).map(([p, url]) => [p, h("img", { class: `spr${p === "walk_a" ? " on" : ""}`, src: url, alt: "", draggable: "false", "data-sprite": p })])) : null;
  const shapes = imgs ? Object.values(imgs) : [h("i", { class: "body" }), h("i", { class: "eye" }), h("i", { class: "hm" }), h("i", { class: "sh" }), h("i", { class: "wp" }), h("i", { class: "arm" })];
  const inner = h("div", { class: `g2-orc t-${e.type}${imgs ? " art" : ""}`, "data-side": e.side === 0 ? "l" : "r", "data-pose": "walk-a", "data-sprite": imgs ? "walk_a" : null },
    ...shapes, h("i", { class: "stars" }));
  return { root: h("div", { class: "g2-orcbox", "data-orc": e.id }, inner), inner, art: imgs, shownSprite: imgs ? "walk_a" : null, struck: -1e9 };
}

/** Spec the swing can be drawn with: the hero's own when its outfit and weapon have the raise / swing art, else null: the hero stays in its own
 *  outfit with its own weapon, one picture without the swing (v1.4.0, plan D of #101: no "Náhled švihu" with the boy's cloth_0 any more). */
function swingSpec(ctx, spec) {
  const ok = (sp) => hasPose(ctx.stage.ix, sp, "raise") && hasPose(ctx.stage.ix, sp, "swing");
  return ok(spec) ? { spec, preview: false } : null;
}

/** {els, poses, preview}: the hero picture(s) of a lane. Variant A (the default; `?hero=old` off): three stacked pictures (angle, raise, swing)
 *  cross-faded by setPoses, with the boy's cloth_0 drawing as a preview where the hero has no such art; otherwise one picture (or the placeholder)
 *  and poses = null. */
function heroEl(ctx, p, lane) {
  const kid = p.kid_id && ctx.kids[p.kid_id];
  if (kid && kid.hero && ctx.stage && ctx.stage.illustrated) {
    try {
      const own = heroSpec(ctx.hctx, kid, { scale: 4 });
      const sw = ctx.heroVariant === "old" ? null : swingSpec(ctx, own);
      if (sw) {
        const spec = sw.spec;
        const mk = (pose) => {
          const el = ctx.stage.hero(`g2-${lane}-${pose || "base"}`, pose ? { ...spec, pose } : spec);
          el.style.setProperty("--delay", "0s");             // the three pictures breathe together
          el.classList.add("g2-pose");
          el.dataset.pose = pose || "base";
          return el;
        };
        const poses = { base: mk(null), raise: mk("raise"), swing: mk("swing") };
        poses.raise.style.opacity = poses.swing.style.opacity = "0";
        return { els: [poses.base, poses.raise, poses.swing], poses, preview: sw.preview };
      }
      return { els: [ctx.stage.hero(`g2-${lane}`, own)], poses: null };
    } catch (e) { /* placeholder below */ }
  }
  return { els: [h("div", { class: "guest" }, (p.name || "?").slice(0, 1))], poses: null };
}

function setPoses(poses, ms, held) {
  const w = held ? { base: 1, raise: 0, swing: 0 } : poseWeights(ms);
  for (const k of ["base", "raise", "swing"]) {
    const v = w[k].toFixed(2);
    if (poses[k].style.opacity !== v) poses[k].style.opacity = v;
  }
}

const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);

function resultNodes(ctx, s, stats) {
  const st = s.state;
  const title = st.status === "won" ? "Tvrz ubráněna!" : st.status === "lost" ? "Skřeti vás přemohli" : "Hra přerušena";
  const per = s.players.map((p, i) => `${p.name}: ${st.kills ? st.kills[i] : 0}`);
  const rej = stats.acks.filter((a) => a.ok === false).length;
  return [h("div", { class: "res-t", "data-id": "result" }, title),
    h("div", {}, `Poražení skřeti — ${per.join(" · ")}`),
    h("div", { class: "muted", "data-id": "measure" }, `Měření: odezva ${ctx.clock.stats.rtt_med.toFixed(0)} ms (max ${ctx.clock.stats.rtt_max.toFixed(0)}), potvrzení akce serverem za ${med(stats.acks.filter((a) => a.ok).map((a) => a.ms)) === null ? "?" : med(stats.acks.filter((a) => a.ok).map((a) => a.ms)).toFixed(0)} ms (medián z ${stats.acks.filter((a) => a.ok).length}), odmítnuto ${rej} z ${stats.acks.length}, přepočtů ${stats.rebuilds}`),
    h("button", { class: "btn", "data-act": "back", onclick: () => { ctx.dismissed = s.id; ctx.render(); } }, "Zpět")];
}
