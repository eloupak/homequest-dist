import { coin, h, icon } from "../lib/dom.js";

export const AVATAR_CROP = { x: 14, y: 6, w: 36, h: 34 };      // the face crop of an avatar

export const classOf = (ctx, kid) => ctx.cat.classes.find((c) => kid.hero && c.id === kid.hero.class);

export function heroSpec(ctx, kid, extra = {}) {
  return { hero: kid.hero, equipped: kid.equipped, items: ctx.items, appearance: ctx.cat.appearance, classes: ctx.cat.classes, view: "front", expression: "neutral", ...extra };
}

/** Current face of the shown hero: happy for a few seconds after an approval, else neutral. */
export function currentExpression(ctx) {
  return ctx.ui.exprUntil && ctx.ui.exprUntil > Date.now() ? ctx.ui.expr || "happy" : "neutral";
}

/** Square-ish portrait of the hero (or a placeholder before onboarding). */
export function avatar(ctx, kid, name = "avatar") {
  const box = h("div", { class: "avatar" });
  if (kid.hero) {
    const spec = heroSpec(ctx, kid, { scale: 3, crop: AVATAR_CROP });
    box.append(ctx.stage.hero(name, spec));
    if (ctx.stage.illustrated && ctx.zoom) {                         // a tap on the portrait: the whole hero on the whole screen
      box.classList.add("zoomable");
      box.onclick = (ev) => ctx.zoom({ ...spec, crop: null, scale: 4 }, ev);
    }
  }
  else box.append(h("div", { class: "row", style: { height: "100%", justifyContent: "center" } }, icon("mdi:account-question", 40)));
  return box;
}

/** Coin counter; bumps when the value went up since the last render. */
export function coinCount(ctx, kid, kidId = ctx.kidId) {
  const prev = ctx.ui.coins[kidId];
  ctx.ui.coins[kidId] = kid.coins;
  const el = h("span", { class: "coins" }, coin(), String(kid.coins));
  if (prev !== undefined && kid.coins > prev) el.classList.add("bump");
  return el;
}

/** Hairstyles are for boys, for girls or for both (item.body boy | girl | any): the other body's are not offered at all. */
export function fitsBody(item, hero) {
  const want = item.body || "any";
  return want === "any" || (hero && ({ male: "boy", female: "girl" })[hero.body] === want);
}

/** null | "body": why this hero cannot wear the item (the hero classes are gone, #127). */
export function restriction(ctx, kid, item) {
  if (!ctx.stage.supports(item, kid.hero.body)) return "body";
  return null;
}

