/* "Otoč telefon na výšku" over the story scenes (addendum 2 of #118). iOS in the browser cannot lock the orientation (screen.orientation.lock), so a
 * phone turned sideways during the rebuilding of the fortress, a scene of the castellan or the choice of the amulet pauses it: the CSS animations
 * stand (animation-play-state) and so do the timers started by pausableTimeout, a cover with the turning phone (the same as before the game)
 * asks to turn it back, and everything goes on where it stood once it is upright. Only a phone: a landscape screen at most 500 px high. */

import { h } from "./dom.js";

export const PHONE_LANDSCAPE = window.matchMedia("(orientation: landscape) and (max-height: 500px)");
const SCENES = ".story-overlay, .coin-gift";
const TICK_MS = 100;

/** setTimeout that stands while `el` is inside a paused layer (data-upright="paused"). ms <= 0 runs at once (reduced motion). */
export function pausableTimeout(el, ms, fn) {
  if (ms <= 0) return setTimeout(fn, 0);
  let left = ms;
  const id = setInterval(() => {
    if (el.isConnected && el.closest('[data-upright="paused"]')) return;
    left -= TICK_MS;
    if (left <= 0) { clearInterval(id); fn(); }
  }, TICK_MS);
  return id;
}

/** Watches the story layer of the panel: while it holds a scene and the phone is sideways, the layer is paused and covered. Returns {stop()}. */
export function uprightGuard(layer) {
  const cover = h("div", { class: "upright-cover", "data-id": "upright", role: "alertdialog", "aria-label": "Otoč telefon na výšku" },
    h("div", { class: "upright-phone" }), h("h2", {}, "Otoč telefon na výšku"));
  const update = () => {
    const on = PHONE_LANDSCAPE.matches && !!layer.querySelector(SCENES);
    if (on === (layer.dataset.upright === "paused")) return;
    if (on) { layer.dataset.upright = "paused"; layer.append(cover); }
    else { delete layer.dataset.upright; cover.remove(); }
  };
  const mo = new MutationObserver(update);
  mo.observe(layer, { childList: true });
  PHONE_LANDSCAPE.addEventListener("change", update);
  update();
  return { stop() { mo.disconnect(); PHONE_LANDSCAPE.removeEventListener("change", update); cover.remove(); delete layer.dataset.upright; } };
}

export const UPRIGHT_CSS = `
[data-upright="paused"] .story-overlay, [data-upright="paused"] .story-overlay *, [data-upright="paused"] .coin-gift, [data-upright="paused"] .coin-gift * { animation-play-state: paused !important; }
.upright-cover { position: fixed; inset: 0; z-index: 95; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 20px; text-align: center; background: #1c1a2e; color: #f3ecd8; }
.upright-cover h2 { margin: 0; font-size: 24px; }
.upright-phone { width: 70px; height: 120px; border: 6px solid #f3ecd8; border-radius: 14px; position: relative; animation: hq-upright-turn 1600ms ease-in-out infinite; }
.upright-phone::after { content: ""; position: absolute; left: 50%; bottom: 6px; width: 14px; height: 4px; margin-left: -7px; border-radius: 2px; background: #f3ecd8; }
@keyframes hq-upright-turn { 0%, 20% { transform: rotate(90deg); } 60%, 100% { transform: rotate(0); } }
@media (prefers-reduced-motion: reduce) { .upright-phone { animation: none; } }
`;
