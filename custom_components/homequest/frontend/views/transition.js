/* The rebuilding of the fortress between two stages (any stage: `from` and `to` are chains of background ids, see bgChain) and the coin gift.
 * Made of the existing pictures only: the old one darkens, dust and splinters rise, the scene shakes with a few hammer blows, the new picture is
 * uncovered from the bottom up by a soft (feathered) edge with a band of dust and splinters riding along it (like behind scaffolding), the dust settles and the windows brighten. With reduced motion: a plain fade. */

import { coin, h } from "../lib/dom.js";
import { bgUrl } from "../lib/story.js";
import { pausableTimeout } from "../lib/upright.js";

export const REBUILD_MS = 4600;
export const REBUILD_REDUCED_MS = 900;
export const COINS_MS = 1900;

const reduced = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

function pic(ctx, chain, cls) {
  let i = 0;
  const img = h("img", { class: `scene-bg ${cls}`, alt: "", draggable: "false", src: bgUrl(ctx.assets, chain[0]) });
  img.onerror = () => { if (++i < chain.length) img.src = bgUrl(ctx.assets, chain[i]); else img.remove(); };
  return img;
}

/** Fixed pseudo-random numbers (the same look every time, and testable). */
const rnd = (i, k) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };

/** from, to: chains of background ids. Returns the overlay (appended by the caller); onDone() when the animation is over and the overlay removed. */
export function rebuildScene(ctx, from, to, onDone) {
  const quick = reduced();
  const dust = [];
  for (let i = 0; i < 7; i++) {
    dust.push(h("i", { class: "dust", style: `--x:${10 + rnd(i, 1) * 80}%;--b:${(rnd(i, 10) * 38 - 8).toFixed(0)}%;--s:${90 + rnd(i, 2) * 110}px;--d:${(0.5 + rnd(i, 3) * 2.4).toFixed(2)}s;--dx:${((rnd(i, 4) - 0.5) * 60).toFixed(0)}px` }));
  }
  const chips = [];
  for (let i = 0; i < 18; i++) {
    chips.push(h("i", { class: "chip-debris", style: `--x:${8 + rnd(i, 5) * 84}%;--d:${(0.7 + rnd(i, 6) * 2.4).toFixed(2)}s;--r:${((rnd(i, 7) - 0.5) * 540).toFixed(0)}deg;--w:${4 + Math.round(rnd(i, 8) * 7)}px` }));
  }
  const stage = h("div", { class: "rebuild-stage" }, pic(ctx, from, "old"), pic(ctx, to, "new"), h("div", { class: "dust-layer" }, ...dust), h("div", { class: "debris-layer" }, ...chips), h("div", { class: "edge-dust" }), h("div", { class: "glow" }));
  const overlay = h("div", { class: `story-overlay rebuild${quick ? " quick" : ""}`, "data-state": "rebuilding", "data-kind": "rebuild", "aria-hidden": "true" }, stage);
  pausableTimeout(overlay, quick ? REBUILD_REDUCED_MS : REBUILD_MS, () => { overlay.remove(); if (onDone) onDone(); });     // stands while the phone is sideways
  return overlay;
}

/** The gift: coins fly to the top right (where the purse is), "+N zlaťáky". onDone() afterwards; the overlay never blocks a tap for long. */
export function coinGift(ctx, coins, onDone) {
  const quick = reduced();
  const flying = Array.from({ length: Math.min(12, Math.max(3, coins * 2)) }, (_, i) =>
    h("span", { class: "flycoin", style: `--i:${i};--dx:${((rnd(i, 9) - 0.5) * 80).toFixed(0)}px;--dl:${(i * 0.09).toFixed(2)}s` }, coin()));
  const overlay = h("div", { class: `coin-gift${quick ? " quick" : ""}`, "data-kind": "gift" }, h("div", { class: "gift-text" }, `+${coins} zlaťáky`), ...flying);
  pausableTimeout(overlay, quick ? 900 : COINS_MS, () => { overlay.remove(); if (onDone) onDone(); });
  return overlay;
}
