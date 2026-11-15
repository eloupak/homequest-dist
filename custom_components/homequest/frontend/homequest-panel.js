/* HomeQuest panel — the entry Home Assistant loads (module_url of every HomeQuest panel). #174
 *
 * It checks that the browser has what the game needs (feature detection, never the user agent) and then loads the game
 * (homequest-app.js). On a browser that is too old it shows a short message for the child instead of a broken screen.
 * Minimum: iOS 15 / Safari 15, Chrome and Android WebView 100+, Firefox 100+ (README, tests/js/compat.test.mjs).
 *
 * Keep this file in old, plain JavaScript (ES2017 + import() and import.meta): it must run where the game itself cannot.
 * tests/js/compat.test.mjs checks that. No static imports: one module the old browser cannot parse would stop this file too. */

var TEXTS = {
  cs: {
    title: "Tenhle telefon je na hru moc starý.",
    text: "Zkus jiný, nebo řekni rodičům.",
    parent: "Pro rodiče: HomeQuest potřebuje iOS 15 (Safari 15) nebo novější, Chrome 100 nebo novější. Chybí: ",
  },
  en: {
    title: "This phone is too old for the game.",
    text: "Try another one, or tell your parents.",
    parent: "For parents: HomeQuest needs iOS 15 (Safari 15) or newer, Chrome 100 or newer. Missing: ",
  },
};

/** What the game needs and the browser lacks (an empty list = supported). Exported for the tests. */
export function missingFeatures(win) {
  var miss = [];
  var css = win.CSS && typeof win.CSS.supports === "function" ? win.CSS : null;
  if (!css) miss.push("CSS.supports");
  else {
    if (!css.supports("aspect-ratio", "1 / 1")) miss.push("aspect-ratio");          // the hero, portraits, the scenes (Safari 15)
    if (!css.supports("inset", "0")) miss.push("inset");
    if (!css.supports("--hq-probe", "0")) miss.push("CSS variables");
  }
  if (!win.customElements || typeof win.customElements.define !== "function") miss.push("customElements");
  if (!win.Element || !win.Element.prototype.attachShadow) miss.push("Shadow DOM");
  if (typeof win.ResizeObserver !== "function") miss.push("ResizeObserver");
  try {
    new win.Function("a", "return a?.b ?? 1")({});                                   // optional chaining and ?? (ES2020) in the game's code
  } catch (e) {
    miss.push("ES2020");
  }
  return miss;
}

/** The language of the message: the HA language when it is Czech, else English. Exported for the tests. */
export function messageLang(hass) {
  var lang = (hass && ((hass.locale && hass.locale.language) || hass.language)) || "";
  return String(lang).toLowerCase().indexOf("cs") === 0 ? "cs" : "en";
}

function defineUnsupported(miss) {
  if (window.customElements.get("homequest-panel")) return;
  class Unsupported extends HTMLElement {
    get hass() { return this._hass; }
    set hass(h) { var first = !this._hass; this._hass = h; if (first) this._draw(); }
    connectedCallback() {
      if (Object.prototype.hasOwnProperty.call(this, "hass")) { var v = this.hass; delete this.hass; this.hass = v; }   // set before define
      this._draw();
    }
  }
  Unsupported.prototype._draw = function () {   // the message (plain DOM, no Shadow DOM: it may be what is missing)
    var t = TEXTS[messageLang(this._hass)];
    this.setAttribute("data-unsupported", miss.join(","));
    this.innerHTML = "";
    var box = document.createElement("div");
    box.setAttribute("data-id", "unsupported");
    box.style.cssText = "box-sizing:border-box;min-height:100vh;padding:48px 24px;background:#1c1a2e;color:#f3ecd8;font-family:system-ui,-apple-system,sans-serif;text-align:center";
    var icon = document.createElement("div");
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="72" height="72" aria-hidden="true"><path fill="#E8B33A" d="M2,13H4V15H6V13H8V15H10V13H12V15H14V10L17,7V1H19L23,3L19,5V7L22,10V22H11V19A2,2 0 0,0 9,17A2,2 0 0,0 7,19V22H2V13M18,10C17.45,10 17,10.54 17,11.2V13H19V11.2C19,10.54 18.55,10 18,10Z"/></svg>';   // mdi:castle
    icon.style.cssText = "margin-bottom:12px";
    var h = document.createElement("h1");
    h.textContent = t.title;
    h.style.cssText = "font-size:24px;margin:0 0 10px";
    var p = document.createElement("p");
    p.textContent = t.text;
    p.style.cssText = "font-size:20px;margin:0 0 28px";
    var small = document.createElement("p");
    small.textContent = t.parent + miss.join(", ");
    small.style.cssText = "font-size:13px;opacity:.7;margin:0";
    box.appendChild(icon);
    box.appendChild(h);
    box.appendChild(p);
    box.appendChild(small);
    this.appendChild(box);
  };
  window.customElements.define("homequest-panel", Unsupported);
}

var MISSING = typeof window !== "undefined" ? missingFeatures(window) : [];
if (typeof window !== "undefined" && window.customElements) {
  if (MISSING.length) defineUnsupported(MISSING);
  else {
    var here = new URL(import.meta.url);
    import(new URL("homequest-app.js" + here.search, here).href).catch(function (e) {
      // a browser that passed the checks but still cannot load the game: the message instead of an empty screen
      console.error("HomeQuest: the game could not be loaded", e);
      defineUnsupported(["homequest-app.js: " + (e && e.message ? e.message : e)]);
    });
  }
}
