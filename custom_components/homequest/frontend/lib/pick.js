/* #185 addendum 4: the rules of the choice in a stage gift (no DOM, tested in tests/js/gift_pick.test.mjs); the view is views/gift_pick.js. */

export const FEATHER = { red: "Červené pírko", blue: "Modré pírko", white: "Bílé pírko", gold: "Zlaté pírko", green: "Zelené pírko", purple: "Fialové pírko" };
export const SWATCH = { red: "#c8372d", blue: "#2f6fd0", white: "#f4f1e8", gold: "#e8b33a", green: "#3f9a4a", purple: "#8a4fc0" };

/** The colour of a pickable item = the last part of its id (hat_hunter_red -> red); anything else = no swatch, the item's name. */
export function pickColor(id) {
  const c = String(id || "").split("_").pop();
  return SWATCH[c] ? c : null;
}

/** The label of a card: the feather (by colour) or the item's name. */
export function pickLabel(id, items) {
  const c = pickColor(id);
  if (c) return FEATHER[c];
  return ((items || {})[id] || {}).name || id;
}

/** Did the child pick at this stage already? (kid.gift_picks = {stage: item}) */
export function pickedAt(kid, stageId) {
  return (kid && kid.gift_picks && kid.gift_picks[stageId]) || null;
}
