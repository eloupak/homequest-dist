/* The diagnostics of the phone (#174, 2026-11-16): what the browser is and what it can do, for the hidden overview (triple tap on the title)
 * and the report of a problem. Information only: nothing here stops the game (a feature check up front gave a false "too old" on iOS 15.8).
 * Never a name, a place or install_id in it (a family-data rule, as lib/report.js). Pure functions of `win`, tested in node
 * (tests/js/compat_diag.test.mjs). */

/** Features the game uses, newest first; the ones an old phone lacks have a fallback (README "Older phones"). [label, test(win)]. */
const CSS_FEATURES = [
  ["color-mix (záře vzácných věcí)", (css) => css.supports("color", "color-mix(in srgb, red 50%, blue)")],
  ["container units cqw (Quest)", (css) => css.supports("width", "1cqw")],
  [":has() (švih ve hře)", (css) => css.supports("selector(:has(a))")],
  ["dvh (výška obrazovky)", (css) => css.supports("height", "1dvh")],
  ["aspect-ratio", (css) => css.supports("aspect-ratio", "1 / 1")],
  ["mask-image", (css) => css.supports("mask-image", "none") || css.supports("-webkit-mask-image", "none")],
  ["backdrop-filter", (css) => css.supports("backdrop-filter", "none") || css.supports("-webkit-backdrop-filter", "none")],
];

function safe(fn) {
  try { return !!fn(); } catch (e) { return false; }
}

/** The iOS version from the user agent ("15.8.8"), or "" (HA's app on iOS says "iPhone OS 15_8_8"). Since iOS 26 the WebKit part
 * stays at "iPhone OS 18_7"; HA's app adds the real one ("; iOS 27.0.1)"), which wins. */
export function iosVersion(ua) {
  const s = String(ua || "");
  const app = /[;(]\s*iOS (\d+(?:\.\d+){0,2})\)/.exec(s);
  if (app) return app[1];
  const m = /(?:iPhone|CPU) OS (\d+)[_.](\d+)(?:[_.](\d+))?/.exec(s);
  return m ? [m[1], m[2], m[3]].filter((x) => x != null).join(".") : "";
}

/** The HA companion app and its version from the user agent ("Home Assistant/2026.2.1"), or "". */
export function haApp(ua) {
  const m = /Home ?Assistant\/([\w.]+)/i.exec(String(ua || ""));
  return m ? m[1] : "";
}

/** {device, features: [[label, ok]], errors, reduced} of win. */
export function compatInfo(win) {
  const nav = win.navigator || {};
  const css = win.CSS && typeof win.CSS.supports === "function" ? win.CSS : null;
  const scr = win.screen || {};
  const features = CSS_FEATURES.map(([label, t]) => [label, !!css && safe(() => t(css))]);
  features.push(
    ["ResizeObserver", typeof win.ResizeObserver === "function"],
    ["structuredClone", typeof win.structuredClone === "function"],
    ["Web Animations", !!(win.Element && win.Element.prototype && win.Element.prototype.animate)],
  );
  const reduced = safe(() => win.matchMedia("(prefers-reduced-motion: reduce)").matches);
  return {
    ua: String(nav.userAgent || ""),
    ios: iosVersion(nav.userAgent),
    app: haApp(nav.userAgent),
    screen: `${scr.width || "?"}×${scr.height || "?"} @${win.devicePixelRatio || 1}x`,
    cores: nav.hardwareConcurrency || "?",
    memory: nav.deviceMemory ? `${nav.deviceMemory} GB` : "?",
    reduced,
    features,
    errors: (win.__hqErrors || []).slice(-5),
  };
}

/** The lines of the overview (Czech, the parent reads them; the labels are technical). bench: the last result of the performance test. */
export function compatLines(info, bench) {
  const out = [
    "HomeQuest diagnostika",
    `iOS ${info.ios || "-"} · aplikace HA ${info.app || "-"}`,
    `obrazovka ${info.screen} · jader ${info.cores} · paměť ${info.memory}`,
    `omezit pohyb (systém): ${info.reduced ? "ano" : "ne"}`,
    `prohlížeč: ${info.ua}`,
    "funkce: " + info.features.map(([l, ok]) => `${ok ? "✓" : "✗"} ${l}`).join(" · "),
    `chyby stránky: ${info.errors.length ? info.errors.join(" | ") : "žádné"}`,
  ];
  if (bench) out.push(...benchLines(bench));
  return out;
}

/** The result of the performance test as lines (views: lib/perf.js frameStats per part). */
export function benchLines(bench) {
  const part = (name, s) => (s ? `${name}: ${s.fps} snímků/s, nejhorší ${s.worst} ms, zaseknutí nad 50 ms ${s.long}× (${s.frames} snímků)` : `${name}: -`);
  return [`test výkonu: ${bench.verdictText}`, part("  přerod tvrze", bench.rebuild), part("  bitva", bench.battle),
    `  na ${bench.orientation === "landscape" ? "šířku" : "výšku"}, ${bench.size}`];
}
