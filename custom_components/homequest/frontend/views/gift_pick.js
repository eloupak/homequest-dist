/* #185 addendum 4: the choice that is part of a stage gift (story.yaml gives.choose: the hunting hat by the colour of its feather). Looks and
 * works like the choice of the Defender's amulet (views/siege.js amuletChooser): the cards 2 x 2, a tap shows one big with a cross and
 * "Tohle!" (story gives.choose.button, add. 12: the feather is neuter), the server keeps the first pick (claim_gift with pick), a child who has chosen sees its pick marked and no choice. Addendum 5: a card
 * shows the child's own hero (head and shoulders, in the gift's outfit) wearing that hat; a small swatch of the feather colour stays in the
 * corner (without the hat's art the bust has no hat, the swatch tells the colours apart). No hero / no illustrated art = the item's thumbnail. */

import { h } from "../lib/dom.js";
import { BUST_HAT } from "../lib/layers.js";
import { heroSpec } from "./common.js";
import { pausableTimeout } from "../lib/upright.js";
import { SWATCH, pickColor, pickLabel, pickedAt } from "../lib/pick.js";

export { pickedAt };

const reduced = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

/** The overlay. opts: {giver (cast member or null), claim (false = a replay: only to look at), onDone}. */
export function giftChooser(ctx, stage, giver, { claim = true, onDone } = {}) {
  const choose = stage.gives.choose;
  const have = pickedAt(ctx.kid, stage.id);
  const canChoose = claim && !have;
  const items = ctx.items || {};
  const body = ctx.kid && ctx.kid.hero ? ctx.kid.hero.body : null;
  const gives = stage.gives || {};
  const outfit = gives.item && items[gives.item] && items[gives.item].slot === "outfit" ? gives.item : null;   // the hat goes with the gift's outfit
  /** The hero (head and shoulders) wearing the item, or null (no hero, no illustrated art). */
  const bust = (id, name) => {
    const kid = ctx.kid;
    if (!kid || !kid.hero || !ctx.stage || !ctx.stage.illustrated || !ctx.cat || !items[id]) return null;
    try {
      const equipped = { ...(kid.equipped || {}), [items[id].slot || "head"]: id };
      delete equipped.weapon;
      delete equipped.offhand;
      if (outfit) equipped.outfit = outfit;
      return ctx.stage.hero(name, heroSpec(ctx, kid, { scale: 3, equipped, cropBox: BUST_HAT }));
    } catch (e) {
      return null;
    }
  };
  /** The card picture: the hero with the item; without a hero the item's thumbnail; without art the swatch alone, big (class noart).
   *  Addendum 10 (#189): no swatch in the corner of a picture, the feather on the hat says the colour. */
  const pictured = (id, size, cls) => {
    const box = h("div", { class: cls });
    const noart = () => { box.classList.add("noart"); if (!box.querySelector(".pick-swatch")) box.append(swatch(id) || ""); };
    const hero = bust(id, `pick-${size}-${id}`);
    if (hero) {
      box.classList.add("bust");
      box.append(hero);
      return box;
    }
    const item = items[id];
    let img = null;
    try {
      if (item && ctx.stage) img = ctx.stage.thumb(item, body, items, size);
    } catch (e) {
      img = null;
    }
    if (!img) noart();
    else {
      img.addEventListener("error", () => { img.remove(); noart(); });
      box.append(img);
    }
    return box;
  };
  const swatch = (id) => {
    const c = pickColor(id);
    return c ? h("span", { class: "pick-swatch", style: `--sw:${SWATCH[c]}`, "aria-hidden": "true" }) : null;
  };
  const bubble = h("div", { class: "bubble" }, h("div", { class: "who" }, giver ? giver.name : ""), h("p", {}, have ? choose.chosen || choose.text : choose.text));
  const grid = h("div", { class: "amulets", "data-id": "gift-picks" });
  const zoom = h("div", { class: "amulet-zoom", "data-id": "gift-pick-zoom", hidden: true });
  const footer = h("div", { class: "amulet-foot" });
  const overlay = h("div", { class: "story-overlay amulet-choice gift-pick", role: "dialog", "data-state": "talking", "data-kind": "gift-pick", "data-stage": stage.id },
    h("div", { class: "amulet-ui" }, bubble, grid, footer), zoom);
  const finish = () => { overlay.remove(); if (onDone) onDone(true); };
  for (const id of choose.items) {
    grid.append(h("button", { class: `amulet${have === id ? " mine" : ""}`, "data-item": id, "aria-label": pickLabel(id, items), onclick: () => open(id) },
      pictured(id, 160, "pick-pic"), h("span", {}, pickLabel(id, items))));
  }
  if (have) grid.classList.add("chosen");
  if (!canChoose) footer.append(h("button", { class: "btn gold", "data-act": "gift-pick-close", onclick: finish }, have && claim ? "Díky!" : "Zavřít"));

  function open(id) {
    zoom.hidden = false;
    zoom.replaceChildren(
      h("button", { class: "amulet-x", "data-act": "gift-pick-x", "aria-label": "Zavřít", onclick: () => { zoom.hidden = true; zoom.replaceChildren(); } }, "✕"),
      pictured(id, 320, "pick-pic big amulet-big"),
      h("div", { class: "amulet-name" }, pickLabel(id, items)),
      canChoose ? h("button", { class: "btn gold big", "data-act": "gift-pick", "data-item": id, onclick: () => pick(id) }, choose.button || "Tohle!") : null);
  }

  async function pick(id) {
    const btn = zoom.querySelector('[data-act="gift-pick"]');
    if (btn) btn.disabled = true;
    const ok = await ctx.act("claim_gift", { stage: stage.id, pick: id });
    if (!ok) { if (btn) btn.disabled = false; return; }
    if (ctx.kid && !pickedAt(ctx.kid, stage.id)) ctx.kid.gift_picks = { ...(ctx.kid.gift_picks || {}), [stage.id]: id };   // before the new view
    const big = zoom.querySelector(".amulet-big");
    if (big && !reduced()) big.classList.add("fly");
    pausableTimeout(overlay, reduced() ? 0 : 900, () => {
      zoom.hidden = true;
      zoom.replaceChildren();
      grid.querySelectorAll(".amulet").forEach((b) => b.classList.toggle("mine", b.dataset.item === id));
      grid.classList.add("chosen");
      bubble.lastChild.textContent = choose.chosen || "";
      footer.replaceChildren(h("button", { class: "btn gold", "data-act": "gift-pick-thanks", onclick: finish }, "Díky!"));
    });
  }
  return overlay;
}
