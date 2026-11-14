/* Layout of the panel on a phone (iOS WebView in the HA app): the host is as tall as the VISIBLE area (visualViewport), not 100vh,
 * the document does not scroll, only the content area does. Plus a hidden diagnostic overview for a screenshot from the phone.
 * Pure helpers (tested in node): viewportHeight, layoutReport, reportLines. */

/** Height of the visible area: visualViewport when there is one (iOS: without the browser bars), else innerHeight. */
export function viewportHeight(win) {
  const vv = win && win.visualViewport;
  const h = vv && vv.height ? vv.height : win && win.innerHeight;
  return Math.round(h || 0);
}

const px = (n) => (n == null || Number.isNaN(n) ? "–" : `${Math.round(n * 10) / 10}`);

/** A snapshot of everything that decides whether the menu fits. All inputs are plain objects (rects with top/bottom/height). */
export function layoutReport({ win, doc, host, main, nav, insets, narrow, fixed }) {
  const vv = (win && win.visualViewport) || null;
  const rect = (e) => (e && e.getBoundingClientRect ? e.getBoundingClientRect() : null);
  const hr = rect(host), nr = rect(nav);
  const chain = [];
  for (let e = host && host.parentElement, i = 0; e && i < 6; e = e.parentElement, i++) {
    const r = rect(e);
    chain.push(`${e.tagName.toLowerCase()} ${px(r && r.height)}${e.scrollHeight > e.clientHeight + 1 ? " (scrolls)" : ""}`);
  }
  const root = doc && doc.documentElement;
  return {
    innerHeight: win ? win.innerHeight : null,
    innerWidth: win ? win.innerWidth : null,
    visualViewportHeight: vv ? vv.height : null,
    visualViewportOffsetTop: vv ? vv.offsetTop : null,
    visualViewportScale: vv ? vv.scale : null,
    screenHeight: win && win.screen ? win.screen.height : null,
    documentClientHeight: root ? root.clientHeight : null,
    documentScrollHeight: root ? root.scrollHeight : null,
    scrollY: win ? win.scrollY : null,
    hostHeight: hr ? hr.height : null,
    hostTop: hr ? hr.top : null,
    contentHeight: main ? main.clientHeight : null,
    contentScrollHeight: main ? main.scrollHeight : null,
    navBottom: nr ? nr.bottom : null,
    navHeight: nr ? nr.height : null,
    insets: insets || { top: 0, right: 0, bottom: 0, left: 0 },
    narrow: !!narrow,
    fixed: !!fixed,
    parents: chain,
    menuFits: !!(nr && win && nr.bottom <= viewportHeight(win) + 0.5),
    userAgent: win && win.navigator ? win.navigator.userAgent : "",
  };
}

export function reportLines(r) {
  return [
    `innerHeight ${px(r.innerHeight)} · innerWidth ${px(r.innerWidth)} · screen ${px(r.screenHeight)}`,
    `visualViewport ${px(r.visualViewportHeight)} (top ${px(r.visualViewportOffsetTop)}, scale ${px(r.visualViewportScale)})`,
    `document ${px(r.documentClientHeight)} / scroll ${px(r.documentScrollHeight)} · scrollY ${px(r.scrollY)}`,
    `host ${px(r.hostHeight)} (top ${px(r.hostTop)}) · ${r.fixed ? "fixed" : "in flow"} · narrow ${r.narrow}`,
    `content ${px(r.contentHeight)} / scroll ${px(r.contentScrollHeight)}`,
    `menu bottom ${px(r.navBottom)} · height ${px(r.navHeight)} · ${r.menuFits ? "FITS" : "CUT OFF"}`,
    `safe-area top ${px(r.insets.top)} right ${px(r.insets.right)} bottom ${px(r.insets.bottom)} left ${px(r.insets.left)}`,
    `parents: ${r.parents.join(" > ") || "–"}`,
    String(r.userAgent).slice(0, 110),
  ];
}
