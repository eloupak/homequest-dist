/* The siege of the fortress in the child's panel (#118). From reaching a stage with `siege` (story.yaml) until the children win its game the
 * panel of a child goes straight into it: the stage's scene (the castellan comes in a hurry) once per child, then the preparation (the hero and
 * the shop, nothing else, no PIN) with "Do boje!" (the game: games/siege_game.js). After the win the castellan thanks them and every child
 * chooses the colour of the Defender's amulet (addendum 1); until the child has chosen, the panel comes back to the choice.
 * The parent's own panel (an admin without a child panel) stays as it is. */

import { h, icon } from "../lib/dom.js";
import { COLOR_NAMES } from "../lib/cs.js";
import { amuletUrl, castMember, fillText, sceneOf, stageVars } from "../lib/story.js";
import { renderHero } from "./hero.js";
import { renderInventory } from "./inventory.js";
import { storyDialog } from "./quest.js";
import { pausableTimeout } from "../lib/upright.js";

const WON_KEY = (kidId, stage) => `homequest.siegewon.${kidId}.${stage}`;
const reduced = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

/** What the siege wants from this child's panel now: {mode: "scene" | "prep" | "victory", stage} or null (no siege, the parent's panel, all done,
 *  or the child left this attack with the cross: kept on the server, `siege.away`, #118; the Quest button brings it back). */
export function siegeMode(view, kid, kidId) {
  const sg = view.siege;
  if (!sg || view.is_admin || !kid || !kid.hero || !view.story) return null;
  const stage = view.story.fortress.stages.find((s) => s.id === sg.stage);
  if (!stage || !stage.siege) return null;
  if (sg.active && kidId && (sg.away || []).includes(kidId)) return null;
  if (sg.active) return { mode: sg.replay || (kid.scenes || []).includes(sg.stage) ? "prep" : "scene", stage };   // a replay: straight to the preparation
  const defended = !sg.won_kids || !sg.won_kids.length || !kidId || sg.won_kids.includes(kidId);      // left the winning game: no amulet (#118)
  if (sg.won_at && stage.siege.gives && defended && !(kid.trophies || []).some((t) => t.stage === sg.stage)) return { mode: "victory", stage };
  return null;
}

/** The preparation for the defence: the hero (equipment) or the inventory with the shop, and "Do boje!". The cross in the corner (#118):
 *  "Opravdu odejít?" -> onLeave() (the child is away from this attack, the panel shows the hero). */
export function renderPrep(ctx, onFight, onLeave) {
  const ui = ctx.ui;
  const tab = ui.siegeTab || "hero";
  const set = (t) => { ui.siegeTab = t; ctx.rerender(); };
  const leave = async () => {
    if (await ctx.confirm({ title: "Opravdu odejít?", text: "Do bitvy se vrátíš tlačítkem v Questu.", yes: "Ano", no: "Zpět" })) onLeave && onLeave();
  };
  return h("div", { class: "siege-prep", "data-siege": "prep" },
    onLeave ? h("button", { class: "siege-x", "data-act": "siege-exit", "aria-label": "Odejít", onclick: leave }, icon("mdi:close", 28)) : null,
    h("div", { class: "card siege-head" }, h("h2", {}, "Příprava na obranu"), h("p", { class: "muted" }, "Skřeti jdou. Vezmi si to nejlepší, co máš, nebo si něco kup. Až budeš připraven, jdeme na to.")),
    h("div", { class: "seg" },
      h("button", { "aria-pressed": String(tab === "hero"), "data-seg": "siege-hero", onclick: () => set("hero") }, "Výbava"),
      h("button", { "aria-pressed": String(tab === "inv"), "data-seg": "siege-inv", onclick: () => set("inv") }, "Inventář a obchod")),
    tab === "hero" ? renderHero(ctx) : renderInventory(ctx),
    h("div", { class: "siege-go" }, h("button", { class: "btn gold block big", "data-act": "siege-fight", onclick: onFight }, icon("mdi:sword-cross", 26), "Do boje!")));
}

/** The end of the siege: the castellan's thanks (won.text), then the choice of the amulet. opts: {layer, claim (false = a replay: only to look at),
 *  onDone()}. A child who has seen the thanks once comes back straight to the choice. */
export function victoryFlow(ctx, story, stage, opts) {
  const sg = stage.siege;
  const giver = castMember(story, sg.won.giver);
  const vars = stageVars(ctx.cat);
  const claim = opts.claim !== false;
  if (opts.replay) {                         // a won replay (addendum 1): the first page of the thanks, no amulet, nothing is given
    const sc = sceneOf(story, story.chapters[0] ? story.chapters[0].id : "intro", stage.tasks);
    Object.assign(sc, { background: stage.id, chain: [stage.background], pos: stage.giver_pos || sc.pos, giver });
    opts.layer.append(storyDialog(ctx, sc, [{ text: fillText(sg.won.text[0], vars), last: true }], () => opts.onDone && opts.onDone(), { kind: "siege-won", doneLabel: "Děkujeme!" }));
    return;
  }
  const choose = () => {
    try { localStorage.setItem(WON_KEY(ctx.kidId, stage.id), "1"); } catch (e) { /* the server keeps it too */ }
    if (claim && ctx.kid && !ctx.isAdmin) ctx.act("scene_seen", { stage: stage.id, what: "won" }, { quiet: true });   // on every device (#127)
    opts.layer.append(amuletChooser(ctx, stage, giver, { claim, onDone: opts.onDone }));
  };
  let seen = false;
  try { seen = claim && localStorage.getItem(WON_KEY(ctx.kidId, stage.id)) === "1"; } catch (e) { /* not seen */ }
  if (claim && ((ctx.kid && ctx.kid.scenes) || []).includes(`won:${stage.id}`)) seen = true;    // seen on another phone (#127)
  if (seen) return choose();
  const sc = sceneOf(story, story.chapters[0] ? story.chapters[0].id : "intro", stage.tasks);
  sc.background = stage.id;
  sc.chain = [stage.background];
  sc.pos = stage.giver_pos || sc.pos;
  sc.giver = giver;
  const pages = sg.won.text.map((text, i, a) => ({ text: fillText(text, vars), last: i === a.length - 1 }));
  opts.layer.append(storyDialog(ctx, sc, pages, choose, { kind: "siege-won", doneLabel: sg.gives ? "Dál" : "Děkujeme!" }));
}

/** The four amulets (2 x 2 upright), a tap shows one big with a cross (back to the four) and "Tenhle!" (the choice; not in a replay). After the
 *  choice the amulet flies down to the hero and the castellan says "Ať tě chrání." -> "Děkujeme!". A child who has chosen already (another
 *  device) sees its amulet marked and no choice. */
export function amuletChooser(ctx, stage, giver, { claim = true, onDone } = {}) {
  const gives = stage.siege.gives;
  const have = ((ctx.kid && ctx.kid.trophies) || []).find((t) => t.stage === stage.id);
  const canChoose = claim && !have;
  const url = (c) => amuletUrl(ctx.assets, gives.item, c);
  const bubble = h("div", { class: "bubble" }, h("div", { class: "who" }, giver ? giver.name : ""), h("p", {}, gives.choose));
  const grid = h("div", { class: "amulets", "data-id": "amulets" });
  const zoom = h("div", { class: "amulet-zoom", "data-id": "amulet-zoom", hidden: true });
  const footer = h("div", { class: "amulet-foot" });
  const overlay = h("div", { class: "story-overlay amulet-choice", role: "dialog", "data-state": "talking", "data-kind": "amulet" },
    h("div", { class: "amulet-ui" }, bubble, grid, footer), zoom);
  const finish = () => { overlay.remove(); if (onDone) onDone(); };
  for (const c of gives.colors) {
    grid.append(h("button", { class: `amulet${have && have.color === c ? " mine" : ""}`, "data-color": c, "aria-label": COLOR_NAMES[c] || c, onclick: () => open(c) },
      h("img", { src: url(c), alt: "", draggable: "false" }), h("span", {}, COLOR_NAMES[c] || c)));
  }
  if (!canChoose) footer.append(h("button", { class: "btn gold", "data-act": "amulet-close", onclick: finish }, have && claim ? "Děkujeme!" : "Zavřít"));
  // a child who has its amulet is never asked to choose again, not even in the replay from the Quest tab (#127: it looked like a second offer)
  if (have) bubble.lastChild.textContent = gives.chosen || gives.choose;

  function open(c) {
    zoom.hidden = false;
    zoom.replaceChildren(
      h("button", { class: "amulet-x", "data-act": "amulet-x", "aria-label": "Zavřít", onclick: () => { zoom.hidden = true; zoom.replaceChildren(); } }, "✕"),
      h("img", { class: "amulet-big", src: url(c), alt: COLOR_NAMES[c] || c, draggable: "false" }),
      h("div", { class: "amulet-name" }, COLOR_NAMES[c] || c),
      canChoose ? h("button", { class: "btn gold big", "data-act": "amulet-pick", "data-color": c, onclick: () => pick(c) }, "Tenhle!") : null);
  }

  async function pick(c) {
    const btn = zoom.querySelector('[data-act="amulet-pick"]');
    if (btn) btn.disabled = true;
    const ok = await ctx.act("claim_siege", { stage: stage.id, color: c });
    if (!ok) { if (btn) btn.disabled = false; return; }
    if (ctx.kid && !(ctx.kid.trophies || []).some((t) => t.stage === stage.id)) {      // the new view may come after the next render
      ctx.kid.trophies = [...(ctx.kid.trophies || []), { id: gives.item, name: gives.name, color: c, stage: stage.id }];
    }
    const big = zoom.querySelector(".amulet-big");
    if (big && !reduced()) big.classList.add("fly");
    pausableTimeout(overlay, reduced() ? 0 : 900, () => {
      zoom.hidden = true;
      zoom.replaceChildren();
      grid.querySelectorAll(".amulet").forEach((b) => b.classList.toggle("mine", b.dataset.color === c));
      grid.classList.add("chosen");
      bubble.lastChild.textContent = gives.chosen || "";
      footer.replaceChildren(h("button", { class: "btn gold", "data-act": "amulet-thanks", onclick: finish }, "Děkujeme!"));
    });
  }
  return overlay;
}
