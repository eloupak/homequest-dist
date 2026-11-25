/* Tiny DOM builder: h("div", {class: "x", onclick: fn}, child, ...). Text is always set via
 * text nodes (never innerHTML), so kid-supplied names cannot inject markup. */

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "value") el.value = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const icon = (name, size) =>
  h("ha-icon", { icon: name, style: size ? { "--mdc-icon-size": `${size}px` } : null });

const COIN_SVG =
  '<svg viewBox="0 0 24 24" class="coin" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#f2c94c" stroke="#a87b1c" stroke-width="2"/>' +
  '<circle cx="12" cy="12" r="6.9" fill="none" stroke="#c99a2e" stroke-width="1.2"/>' +
  // a small crown: three points with balls, a band
  '<path d="M7.2 16.2 7.9 9.6l2.5 2.6L12 8.4l1.6 3.8 2.5-2.6.7 6.6z" fill="#8a5f10" stroke="#8a5f10" stroke-width="0.8" stroke-linejoin="round"/>' +
  '<rect x="7.2" y="16.4" width="9.6" height="1.5" rx="0.5" fill="#8a5f10"/>' +
  '<circle cx="7.9" cy="9" r="0.95" fill="#8a5f10"/><circle cx="12" cy="7.7" r="0.95" fill="#8a5f10"/><circle cx="16.1" cy="9" r="0.95" fill="#8a5f10"/></svg>';

/** UAT beta 2: the ham of the hunt, drawn (variant A "pečená kýta": a roasted leg, the pink cut face, a bone with two knobs). One drawing for
 *  the shop, the hunt's menu and result and the scene (games/lib/scene.js SHAPES.ham); it scales to its box. */
export const HAM_SVG =
  '<svg viewBox="0 0 32 32" class="ham-svg" aria-hidden="true"><defs><radialGradient id="hq-ham-g" cx="35%" cy="35%" r="75%">' +
  '<stop offset="0" stop-color="#e0774f"/><stop offset=".6" stop-color="#b8462c"/><stop offset="1" stop-color="#7a2a1a"/></radialGradient></defs>' +
  '<path d="M20 12 L26.5 5.5" stroke="#9c8b66" stroke-width="5.4" stroke-linecap="round"/>' +
  '<circle cx="26" cy="3.6" r="2.5" fill="#f6efdc" stroke="#9c8b66" stroke-width="1.2"/><circle cx="28.4" cy="6" r="2.5" fill="#f6efdc" stroke="#9c8b66" stroke-width="1.2"/>' +
  '<path d="M20 12 L26.5 5.5" stroke="#f6efdc" stroke-width="3.2" stroke-linecap="round"/>' +
  '<circle cx="26" cy="3.6" r="1.6" fill="#f6efdc"/><circle cx="28.4" cy="6" r="1.6" fill="#f6efdc"/>' +
  '<path d="M22.5 9.5 C26 13.5 24 22 17.5 27 C11.5 31.5 2.5 29 2.5 21 C2.5 13.5 10 8 16 7.6 C18.8 7.4 21 8 22.5 9.5Z" fill="url(#hq-ham-g)" stroke="#5e1f12" stroke-width="1.2"/>' +
  '<ellipse cx="9.5" cy="16" rx="3.4" ry="1.8" transform="rotate(-40 9.5 16)" fill="#fff" opacity=".35"/>' +
  '<ellipse cx="21" cy="11" rx="3.4" ry="2.3" transform="rotate(-45 21 11)" fill="#f5a9a0" stroke="#c2574b" stroke-width="1"/>' +
  '<circle cx="21" cy="11" r="1.1" fill="#f6efdc"/></svg>';

/** #226: a ham as an inline icon (HAM_SVG). */
export function ham() {
  const span = document.createElement("span");
  span.className = "ham-wrap";
  span.setAttribute("aria-label", "šunky");
  span.innerHTML = HAM_SVG; // static markup only
  return span;
}

export function coin() {
  const span = document.createElement("span");
  span.className = "coin-wrap";
  span.innerHTML = COIN_SVG; // static markup only
  return span;
}
