/* "Quest" tab, the intro dialog and the celebration of a reached stage: a scene at the fortress (background = the stage of the fortress,
 * the giver walks in to the paved road). Texts, stages and positions come from story.yaml; the number of completed tasks from the game. */

import { h, icon } from "../lib/dom.js";
import { bgUrl, castMember, fillText, giverVars, introPages, introVars, npcUrl, replayList, sceneOf, serverSeen, stageAt, stageSeen, stageVars } from "../lib/story.js";
import { coinGift, rebuildScene } from "./transition.js";
import { pausableTimeout } from "../lib/upright.js";

const reduced = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
export const WALK_MS = 1400;
export const LEAVE_MS = 1000;
export const FADE_MS = 1300;

function giverPlaceholder(member) {
  return h("div", { class: "npc-fig npc-placeholder", "data-placeholder": "npc" }, icon("mdi:account-tie", 56), h("span", {}, member.name));
}

/** A background picture that falls back along `chain` (the wanted stage, then the previous ones); no picture at all = a plain sky and grass. */
function bgImage(ctx, chain, scene) {
  let i = 0;
  const img = h("img", { class: "scene-bg", alt: "", draggable: "false", src: bgUrl(ctx.assets, chain[0]) });
  img.dataset.bg = chain[0];
  img.onerror = () => {
    i++;
    if (i < chain.length) {
      img.dataset.bg = chain[i];
      img.src = bgUrl(ctx.assets, chain[i]);
    } else {
      img.remove();
      scene.classList.add("nobg");
    }
  };
  return img;
}

/** Does the picture of this stage exist (so that it can be shown)? */
export function bgExists(ctx, id) {
  return new Promise((res) => {
    const i = new Image();
    i.onload = () => res(true);
    i.onerror = () => res(false);
    i.src = bgUrl(ctx.assets, id);
  });
}

/** The scene (sc = sceneOf(...)): the picture (cover, centred) with the giver standing on the road. box.walk is the walking wrapper.
 *  opts.fromChain: the previous stage, shown first and faded into the new background by box.swap(). */
export function sceneBox(ctx, sc, cls = "", opts = {}) {
  const box = h("div", { class: `scene-box ${cls}`.trim() });
  if (!sc) return box;
  const scene = h("div", { class: "scene", "data-bg": sc.background });
  if (opts.fromChain) scene.append(bgImage(ctx, opts.fromChain, scene));
  const bg = bgImage(ctx, sc.chain, scene);
  if (opts.fromChain) {
    bg.classList.add("fade");
    box.swap = () => bg.classList.add("in");
  }
  scene.append(bg);
  box.append(scene);
  if (sc.giver) {
    const fig = h("img", { class: "npc-fig", src: npcUrl(ctx.assets, sc.giver), alt: sc.giver.name, draggable: "false" });
    fig.onerror = () => fig.replaceWith(giverPlaceholder(sc.giver));
    const walk = h("div", { class: "giver-walk" }, h("div", { class: "giver-bob" }, h("div", { class: "giver-breath" }, fig)));
    scene.append(h("div", { class: "giver-pos", "data-giver": sc.giver.id, style: giverVars(sc.pos, sc.giver.enter_from) }, walk));
    box.walk = walk;
    box.giver = sc.giver;
  }
  return box;
}

export function renderQuest(ctx) {
  const story = ctx.view.story;
  const root = h("div", { class: "questscreen" });
  const ch = story ? story.chapters[0] : null;
  if (!story || !ch) {
    root.append(h("div", { class: "empty" }, "Příběh zatím není nastavený."));
    return root;
  }
  const done = ctx.view.fortress ? ctx.view.fortress.done : 0;
  const sc = sceneOf(story, ch.id, done);
  sc.giver = null;                                   // no character on the fortress picture for now (the cast stays in the data)
  const box = sceneBox(ctx, sc, "tab");
  root.append(
    box,
    h("div", { class: "card chapter", "data-chapter": ch.id }, h("h2", {}, ch.title), ...ch.text.map((t) => h("p", {}, t))),
    ...replayList({ story, done, gifts: (ctx.kid && ctx.kid.gifts) || [], seen: Math.max(stageSeen(window.localStorage, ctx.kidId), serverSeen(ctx.kid).stage), isAdmin: ctx.isAdmin,
      scenes: (ctx.kid && ctx.kid.scenes) || [], trophies: (ctx.kid && ctx.kid.trophies) || [], siege: ctx.view.siege }).map((r) =>
      r.kind === "intro"
        ? h("button", { class: "btn gold block replay", "data-act": "replay-intro", onclick: () => ctx.playIntro() }, icon("mdi:replay", 24), r.label)
        : r.kind === "siege-battle"
          ? h("button", { class: "btn gold block replay", "data-act": "siege-battle", "data-stage": r.id, onclick: () => ctx.siegeBack() }, icon("mdi:sword-cross", 24), r.label)
        : r.kind === "siege-won"
          ? h("button", { class: "btn gold block replay", "data-act": "replay-siege-won", "data-stage": r.id, onclick: () => ctx.playSiegeWon(story.fortress.stages[r.index]) }, icon("mdi:shield-star", 24), r.label)
          : h("button", { class: "btn gold block replay", "data-act": "replay-stage", "data-stage": r.id, onclick: () => ctx.playStage({ ...stageAt(story, story.fortress.stages[r.index].tasks), done }) }, icon("mdi:castle", 24), r.label))
  );
  // no separate "replay the rebuilding" button for the parent any more (#127): the stage buttons above play the same scene with the rebuilding
  return root;
}

export function progressBar(at) {
  return h("div", { class: "prog", role: "progressbar", "aria-valuenow": String(at.pct), "aria-valuemin": "0", "aria-valuemax": "100" }, h("i", { style: `width:${at.pct}%` }));
}

/** A dialog on the scene: the giver walks in, a bubble with one paragraph per page (text pages), the last button closes, the giver walks away.
 *  overlay.dataset.state: arriving -> talking -> leaving. opts: {pages:[{text,last}], doneLabel, title, fromChain}. onDone() when the child finishes. */
export function storyDialog(ctx, sc, pages, onDone, opts = {}) {
  const box = sceneBox(ctx, sc, "full", opts);
  const name = box.giver ? box.giver.name : "";
  let i = 0;
  const bubble = h("div", { class: "bubble", "data-page": "0" });
  const dots = h("div", { class: "dots" });
  const next = h("button", { class: "btn gold", "data-act": "intro-next" }, "Dál");
  const ui = h("div", { class: "story-ui" }, bubble, dots, next);
  const overlay = h("div", { class: `story-overlay${opts.hurry ? " hurry" : ""}`, role: "dialog", "aria-label": name, "data-state": "arriving", "data-kind": opts.kind || "intro" }, box, ui);
  const talk = () => {
    if (overlay.dataset.state !== "arriving") return;
    overlay.dataset.state = "talking";
    if (box.swap) box.swap();
  };
  const show = () => {
    const p = pages[i];
    bubble.replaceChildren(h("div", { class: "who" }, opts.title || name), h("p", {}, p.text));
    bubble.dataset.page = String(i);
    if (opts.hurry) {                                   // the first `hurry` paragraphs: the bubble shakes (he comes running with news)
      overlay.classList.toggle("hurry", i < opts.hurry);
      bubble.classList.remove("shake");
      if (i < opts.hurry) { void bubble.offsetWidth; bubble.classList.add("shake"); }
    }
    dots.replaceChildren(...(pages.length > 1 ? pages.map((_, k) => h("i", { class: k === i ? "on" : "" })) : []));
    next.textContent = p.last ? opts.doneLabel || "Do toho!" : "Dál";
    next.dataset.act = p.last ? "intro-done" : "intro-next";
  };
  next.onclick = () => {
    if (overlay.dataset.state !== "talking") return;
    if (pages[i].last) {
      overlay.dataset.state = "leaving";
      pausableTimeout(overlay, reduced() ? 0 : LEAVE_MS, () => { overlay.remove(); if (onDone) onDone(); });
      return;
    }
    i++;
    show();
  };
  show();
  pausableTimeout(overlay, reduced() ? 0 : box.giver ? (opts.hurry ? WALK_MS / 2 : WALK_MS) : 400, talk);
  return overlay;
}

/** The intro: the farmer at stage 0, "Dál" ... "Do toho!". */
export function introDialog(ctx, story, onDone) {
  return storyDialog(ctx, sceneOf(story, "intro", 0), introPages(story, introVars(ctx.kid && ctx.kid.hero)), onDone);
}

/** A reached stage, from the first picture to the gift. The fortress is rebuilt (old picture -> new one), then the characters of the stage's scene
 *  talk in turn on the new picture (each walks in, speaks, walks away; a stage with only an `announce` is a text-only bubble), then the gift
 *  (stage.gives) is paid by the server (opts.claim: a replay by the parent passes false) and the coins fly into the purse.
 *  onDone(ok): ok = false when the gift could not be claimed (the child sees the scene again next time). at = stageAt(...).
 *  opts.rebuild = false: no rebuilding, the characters talk on the new picture straight away (the child has seen the rebuild already). */
export function stageDialog(ctx, story, at, onDone, opts = {}) {
  const layer = opts.layer;
  const prev = story.fortress.stages[at.index - 1];
  const vars = stageVars(ctx.cat);
  const parts = at.stage.scene && at.stage.scene.length
    ? at.stage.scene.map((p) => ({ giver: castMember(story, p.giver), text: p.text, hurry: p.hurry || 0 }))
    : [{ giver: null, text: at.stage.announce }];
  const show = (el) => { layer.append(el); return el; };
  const talk = (n) => {
    if (n >= parts.length) return gift();
    const part = parts[n];
    const last = n === parts.length - 1;
    const sc = sceneOf(story, story.chapters[0] ? story.chapters[0].id : "intro", at.done);
    sc.background = at.stage.id;
    sc.chain = [at.stage.background, ...(prev ? [prev.background] : [])];
    sc.pos = at.stage.giver_pos || sc.pos;
    sc.giver = part.giver;
    const pages = part.text.map((text, i, a) => ({ text: fillText(text, vars), last: i === a.length - 1 }));
    show(storyDialog(ctx, sc, pages, () => talk(n + 1), { kind: "stage", doneLabel: last ? at.stage.done_label || "Do toho!" : "Dál", hurry: part.hurry }));
  };
  const gift = async () => {
    const g = at.stage.gives;
    if (!g || opts.claim === false) return onDone && onDone(true);
    const ok = await ctx.act("claim_gift", { stage: at.stage.id }, { quiet: true });
    if (!ok) return onDone && onDone(false);
    show(coinGift(ctx, g.coins, () => onDone && onDone(true)));
  };
  if (prev && opts.rebuild !== false) show(rebuildScene(ctx, [prev.background], [at.stage.background, prev.background], () => talk(0)));
  else talk(0);
}
