/* The hunt (maths): the scene above, our own number pad below. One set = one operation; the server (game/learning.py) draws the problems, checks the
 * answers and tracks the problems each child has trouble with; this view only shows and times (silently: the child never sees the time). */

import { h } from "../../lib/dom.js";
import { heroSpec } from "../../views/common.js";
import { buildPad, press } from "../lib/numpad.js";
import { Scene } from "../lib/scene.js";
import { aimPoseGrips, poseGrip } from "../../lib/layers.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The hero for the scene: the child's hair and skin; the outfit of hunt.yaml scene.hero.outfit (the hunting gear, #185) when the catalog has it,
 *  else the child's own; no weapon (the child's gear is not changed). #188 addendum 4: in the pose `pose` (reach: the left arm stretched to the
 *  side, brief-021) where the outfit has it -> {node, grip}: grip = its fist in px of the hero canvas (the bow goes there), null = the plain hero. */
function heroNode(ctx, kid, outfit, pose = "reach", quiver = null) {
  if (kid && kid.hero && ctx.stage && ctx.stage.illustrated) {
    try {
      const equipped = { ...(kid.equipped || {}) };
      delete equipped.offhand;
      delete equipped.weapon;                                          // the bow is the scene's own (one bow, in the stretched left hand), not the weapon art in the other hand
      if (outfit && ctx.hctx && ctx.hctx.items && ctx.hctx.items[outfit]) equipped.outfit = outfit;
      const spec = heroSpec(ctx.hctx, kid, { scale: 4, equipped });
      if (quiver) spec.quiver = quiver;                                // addendum 9: the quiver of the bow on the back (the bow itself is the scene's)
      const grip = pose ? poseGrip(ctx.stage.ix, spec, pose) : null;
      if (grip) spec.pose = pose;
      const node = ctx.stage.hero(`hunt-${kid.id}${grip ? `-${pose}` : ""}`, spec);
      // #189 (brief-025): the archer - one picture per aim angle (0 / 25 / 50 deg) and string hand (relaxed / drawn), the scene shows the nearest
      const poses = {};
      for (const [p, g] of Object.entries(aimPoseGrips(ctx.stage.ix, spec))) {
        const n = ctx.stage.hero(`hunt-${kid.id}-${p}`, { ...spec, pose: p });
        n.style.setProperty("--delay", "0s");                          // the same idle bob as the others, so a swap does not jump
        poses[p] = { node: n, grip: g };
      }
      if (Object.keys(poses).length) node.style.setProperty("--delay", "0s");
      return { node, grip, poses };
    } catch (e) { /* the placeholder below */ }
  }
  return { node: h("div", { class: "guest" }, ((kid && kid.name) || "?").slice(0, 1)), grip: null, poses: {} };
}

/** hunt.yaml sprites {id: {state: file}} with the files relative to the HomeQuest assets -> URLs (a URL or an absolute path stays). */
export function assetSprites(sprites, assets = "/homequest_assets") {
  const out = {};
  for (const [id, states] of Object.entries(sprites || {})) {
    out[id] = {};
    for (const [st, f] of Object.entries(states || {})) out[id][st] = /^(\/|https?:|data:)/.test(String(f)) ? f : `${assets || "/homequest_assets"}/${f}`;
  }
  return out;
}

export function mountHunt(ctx, host, { kid, op, info, onFinish, mode }) {
  const g = (info.grounds || {})[op] || null;                         // #191: today's hunting ground of this operation (its picture: assets like the sprites)
  const ground = g ? { ...g, ...assetSprites({ g: { background: g.background, background_wide: g.background_wide } }, ctx.assets).g } : null;
  const scfg = { ...info.scene, animals: info.animals || [], aim: info.aim || {}, sprites: assetSprites(info.scene && info.scene.sprites, ctx.assets), ground };
  if (scfg.art) {                                                      // #189 (brief-025): the bow, the arrow and the bush as pictures (a file that does not load = the drawn shape)
    const files = assetSprites({ a: Object.fromEntries(Object.entries(scfg.art).map(([k, v]) => [k, v && v.file])) }, ctx.assets).a;
    scfg.art = Object.fromEntries(Object.entries(scfg.art).map(([k, v]) => [k, { ...v, file: files[k] }]));
  }
  const aimMode = (mode || info.mode || scfg.mode) === "aim" && (info.animals || []).length > 0;
  const sceneHost = h("div", { class: "hn-scene", "data-id": "scene-host" });
  const left = h("b", { "data-id": "remaining" }, "");
  let setId = null;
  /** Addendum 7 (#189): the cross ends the round now, without a question: the server pays the hams of the animals hit so far and counts the
   *  ground as used today (game/learning.py LearningHub.quit), then the result like after a finished round; before the first answer (or when
   *  the server does not know the set any more) back to the hunter's choice. */
  async function quit() {
    if (dead) return;
    dead = true;
    if (resolveAnswer) { const r = resolveAnswer; resolveAnswer = null; r(null); }
    if (scene._cancelAim) scene._cancelAim();
    let res = null;
    if (setId) { try { res = await ctx.call("learn_quit", { set_id: setId }); } catch (e) { res = null; } }
    if (res && res.recorded) return onFinish({ summary: res.summary, daily: res.daily, hits: res.hits, reward: res.reward });
    onFinish(null);
  }
  const hud = h("div", { class: "hn-hud" }, h("span", { class: "hn-left" }, "Zbývá ", left));
  const quitBtn = h("button", { class: "hn-quit", "data-act": "abort", type: "button", "aria-label": "Konec lovu", onclick: quit }, "✕");
  const pad = buildPad((k) => onKey(k));
  const root = h("div", { class: "hn" }, h("div", { class: "hn-top" }, sceneHost, hud, quitBtn), h("div", { class: "hn-bottom" }, pad));
  host.replaceChildren(root);
  if (ctx.stage && ctx.stage.begin) ctx.stage.begin("hunt");
  const { node, grip, poses } = heroNode(ctx, kid, scfg.hero && scfg.hero.outfit, scfg.hero && scfg.hero.pose, scfg.hero && scfg.hero.quiver);
  if (ctx.stage && ctx.stage.end) ctx.stage.end();
  const body = kid && kid.hero ? ({ male: "boy", female: "girl" })[kid.hero.body] || null : null;
  if (grip && body) scfg.bow = { ...(scfg.bow || {}), grip_canvas: { ...((scfg.bow || {}).grip_canvas || {}), [body]: grip } };   // the fist of the reach pose
  const scene = new Scene(sceneHost, scfg, { heroNode: node, speed: ctx.speed || 1, body, poses });
  let dead = false, typed = "", resolveAnswer = null, prob = null, n = 0;

  const lock = (on) => { pad.toggleAttribute("data-locked", on); pad.classList.toggle("locked", on); };
  lock(true);

  function onKey(k) {
    if (k === "ok") {
      if (typed === "" || !resolveAnswer) return;
      const r = resolveAnswer;
      resolveAnswer = null;
      r({ value: Number(typed), ms: performance.now() - t0 });
      return;
    }
    typed = press(typed, k);
    if (prob && resolveAnswer) scene.setEquation(prob.text, typed, "typing");
  }
  let t0 = 0;

  async function loop() {
    let start;
    try { start = await ctx.call("learn_start", { kid_id: kid.id, op, mode: aimMode ? "aim" : "auto" }); } catch (e) { ctx.error = e.message || String(e); return onFinish(null); }
    setId = start.set_id;
    if (dead) return;                                                 // the cross before the set started: nothing to end
    if (aimMode) return aimLoop(start, setId);
    prob = start.problem;
    left.textContent = String(start.size);
    if (!start.reward_open) hud.append(h("span", { class: "hn-left hn-noham", "data-id": "no-hams" }, "Kolo bez šunky"));      // today's hams of this operation are already paid
    scene.setScoring(start.reward_open !== false);                    // addendum 12: no ham counter in a round without hams
    while (prob && !dead) {
      await scene.peek();
      if (dead) return;
      typed = "";
      scene.setEquation(prob.text, "", "typing");
      root.setAttribute("data-n", String(++n));                       // the tests wait for the next problem by this counter
      lock(false);
      const got = await new Promise((r) => { resolveAnswer = r; t0 = performance.now(); });
      lock(true);
      if (dead || !got) return;
      let res;
      try { res = await ctx.call("learn_answer", { set_id: setId, answer: got.value, ms: Math.round(got.ms) }); } catch (e) { ctx.error = e.message || String(e); return onFinish(null); }
      const shown = String(got.value);
      if (res.correct) scene.setEquation(prob.text, shown, "right");
      else scene.setEquation(prob.text, shown, "given");              // wrong: first the shot and the flight of the hare, only then the right result
      root.setAttribute("data-last", res.correct ? "right" : "wrong");
      left.textContent = String(res.remaining);
      await scene.shoot(res.correct);
      if (!res.correct) {
        scene.setEquation(prob.text, shown, "wrong", res.answer);
        scene._log("reveal");
        await sleep(Math.round(scfg.reveal_ms / (ctx.speed || 1)));
      }
      if (dead) return;
      scene.clearEquation();
      if (res.done) return onFinish({ summary: res.summary, daily: res.daily, hits: res.hits, reward: res.reward });
      prob = res.next;
    }
  }
  /** #188 + addendum 5: the problem first (no animal); a right answer -> draw the bow at once, the animal runs out when it is drawn, a few seconds
   *  (hunt.yaml aim.window_ms) to shoot with a finger, else it runs away; a wrong one -> the right result, no animal (the problem comes back later). */
  async function aimLoop(start, setId) {
    prob = start.problem;
    left.textContent = String(start.size);
    root.setAttribute("data-mode", "aim");
    if (!start.reward_open) hud.append(h("span", { class: "hn-left hn-noham", "data-id": "no-hams" }, "Kolo bez šunky"));
    scene.setScoring(start.reward_open !== false);
    let last = null;
    while (prob && !dead) {
      typed = "";
      scene.setEquation(prob.text, "", "typing");
      root.setAttribute("data-n", String(++n));
      lock(false);
      const got = await new Promise((r) => { resolveAnswer = r; t0 = performance.now(); });
      lock(true);
      if (dead || !got) return;
      let res;
      try { res = await ctx.call("learn_answer", { set_id: setId, answer: got.value, ms: Math.round(got.ms) }); } catch (e) { ctx.error = e.message || String(e); return onFinish(null); }
      const shown = String(got.value);
      root.setAttribute("data-last", res.correct ? "right" : "wrong");
      left.textContent = String(res.remaining);
      last = res;
      if (res.correct && res.animal) {                                 // addendum 5: right away the bow; the animal runs out once it is drawn
        scene.setEquation(prob.text, shown, "right");
        root.removeAttribute("data-shot");
        root.setAttribute("data-phase", "draw");
        const shot = await scene.drawHunt(res.animal, { onOut: () => { scene.clearEquation(); root.setAttribute("data-phase", "aim"); } });
        scene.clearEquation();
        if (dead || shot.cancelled) return;
        root.setAttribute("data-phase", "result");
        root.setAttribute("data-shot", shot.hit ? "hit" : shot.timeout ? "timeout" : "miss");
        let sres;
        const call = ctx.call("learn_shot", { set_id: setId, hit: !!shot.hit }).then((r) => { sres = r; }, (e) => { ctx.error = e.message || String(e); });
        await Promise.all([shot.hit ? scene.animalHit(res.animal.hams) : scene.animalFlee({ arrow: !shot.timeout }), call]);
        if (!sres) return onFinish(null);
        last = sres;
        root.removeAttribute("data-phase");
      } else if (res.correct) {                                         // no animal configured: just the right answer
        scene.setEquation(prob.text, shown, "right");
        await sleep(Math.round(700 / (ctx.speed || 1)));
        scene.clearEquation();
      } else {
        scene.setEquation(prob.text, shown, "wrong", res.answer);
        scene._log("reveal");
        await sleep(Math.round(scfg.reveal_ms / (ctx.speed || 1)));
        scene.clearEquation();
      }
      if (dead) return;
      if (last.done) return onFinish({ summary: last.summary, daily: last.daily, hits: last.hits, reward: last.reward });
      prob = last.next;
    }
  }

  loop();
  window.__hqHunt = { scene, get prob() { return prob; }, get typed() { return typed; } };     // for the tests
  return { destroy() { dead = true; scene.destroy(); if (resolveAnswer) resolveAnswer(null); } };
}
