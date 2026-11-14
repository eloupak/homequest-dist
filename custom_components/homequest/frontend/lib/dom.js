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

export function coin() {
  const span = document.createElement("span");
  span.className = "coin-wrap";
  span.innerHTML = COIN_SVG; // static markup only
  return span;
}
