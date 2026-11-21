/* The number pad of the learning games: our own keys instead of the system keyboard (it would cover the scene on a phone). Pure helpers + the DOM of the 3 x 4 grid. */

import { h } from "../../lib/dom.js";

export const MAX_DIGITS = 4;
export const LAYOUT = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0", "ok"];

/** The typed text after a key (digits only, no leading zeros, at most MAX_DIGITS). "ok" and unknown keys change nothing. */
export function press(typed, key) {
  if (key === "back") return typed.slice(0, -1);
  if (!/^[0-9]$/.test(key) || typed.length >= MAX_DIGITS) return typed;
  return typed === "0" ? key : typed + key;
}

export const LABEL = { back: "⌫", ok: "OK" };

/** The grid. onKey(key) gets "0".."9", "back" or "ok". Keys react on pointerdown (no 300 ms delay, no double-tap zoom). */
export function buildPad(onKey) {
  const grid = h("div", { class: "np", "data-id": "pad" });
  for (const k of LAYOUT) {
    const b = h("button", { class: `np-k ${k === "ok" ? "ok" : k === "back" ? "back" : ""}`, "data-key": k, "aria-label": k === "back" ? "Smazat" : k === "ok" ? "Odeslat" : k, type: "button" }, LABEL[k] || k);
    b.addEventListener("pointerdown", (ev) => { ev.preventDefault(); if (!b.disabled && !grid.hasAttribute("data-locked")) onKey(k); });
    b.addEventListener("click", (ev) => ev.preventDefault());
    grid.append(b);
  }
  return grid;
}
