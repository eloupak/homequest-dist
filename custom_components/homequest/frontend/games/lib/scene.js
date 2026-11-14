/* A data driven scene for the learning games (hunt now, fishing later): everything comes from the `scene` section of the game configuration
 * (game/configs/hunt.yaml, sent by learn_state). Background and covers, a target with states (peek / wait / hit / flee), the hero's action
 * (shoot: draw the bow and loose the arrow), the loot the target turns into (leaps in an arc into the score). Positions are fractions of the scene box.
 * Placeholders are CSS shapes; `cfg.sprites[name][state]` (a file) replaces a shape when finished art exists. The pure helpers at the top are unit tested. */

import { h } from "../../lib/dom.js";

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** A cover for the next target: not the same one twice in a row. */
export function pickCover(covers, lastId, rnd = Math.random) {
  const pool = covers.length > 1 ? covers.filter((c) => c.id !== lastId) : covers;
  return pool[Math.floor(rnd() * pool.length) % pool.length];
}

/** Points of an arc (a parabola) from `from` to `to`, `height` px above the straight line in the middle. */
export function arcPoints(from, to, height, n = 14) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t - 4 * height * t * (1 - t) });
  }
  return pts;
}

/** The fist that holds the bow (the hero's left hand = the right of the screen): from cfg.bow.grip_canvas[body], else cfg.bow.grip = {x, y} as fractions of the hero's height from his centre / from his feet. */
export function gripPoint(cfg, W, H, body = null) {
  const hero = cfg.hero, hh = hero.size * H, bow = cfg.bow || {};
  const c = body && bow.grip_canvas && bow.grip_canvas[body];                   // the left fist of the drawn hero (design/anchors.json sets.<body>.lhand.point, px of the 1024 canvas the hero box shows)
  if (c) return { x: hero.x * W - hh / 2 + (c[0] / 1024) * hh, y: hero.y * H - hh + (c[1] / 1024) * hh };
  const g = bow.grip || { x: 0.34, y: 0.58 };
  return { x: hero.x * W + hh * g.x, y: hero.y * H - hh * g.y };
}

/** Geometry of one shot in px: where the arrow starts, where it ends (a miss flies on past the target), where the target and the score badge are. */
export function shotGeometry(cfg, W, H, cover, hit, body = null) {
  const size = cfg.target.size * W;
  const from = gripPoint(cfg, W, H, body);
  const target = { x: cover.x * W, y: cover.y * H - size * 0.42 };
  const to = hit ? target : { x: target.x + cfg.projectile.miss_overshoot * W, y: target.y - 0.07 * H };
  return { from, to, target, angle: Math.atan2(to.y - from.y, to.x - from.x) };
}

/** The bow in px: the hero holds it in the hand stretched towards the target (the hero is drawn facing us, so that is his LEFT hand = the right of the screen).
 * Rule: the string is always on the hero's side, the back of the bow (the belly) towards the target; drawing the string moves the nock (and the arrow) towards the body.
 * grip = the fist, tips = the two ends of the bow (the string is fixed to them), back = the outermost point of the arc, nock = where the string holds the arrow. */
export function bowGeometry(cfg, W, H, pull = 0, body = null) {
  const grip = gripPoint(cfg, W, H, body);
  const bow = cfg.bow || {}, len = (bow.height || 0.2) * H, belly = (bow.curve || 0.28) * len;
  return {
    grip,
    tips: [{ x: grip.x, y: grip.y - len / 2 }, { x: grip.x, y: grip.y + len / 2 }],
    back: { x: grip.x + belly, y: grip.y },
    nock: { x: grip.x - pull, y: grip.y },
  };
}

/** How far (px, negative = up) the target rises from the bottom of its window so that about 65 % of it show above the top of the cover. */
export function restOffset(cfg, W, H, cover) {
  const U = Math.min(W, H / 0.8), hh = cfg.target.size * U * 0.9;
  return -(0.78 * cover.h * H - 0.35 * hh);
}

export const dur = (ms, speed) => Math.max(1, Math.round(ms / (speed || 1)));

const SHAPES = {
  hare: () => h("div", { class: "sc-shape hare" }, h("i", { class: "ear l" }), h("i", { class: "ear r" }), h("i", { class: "head" }), h("i", { class: "body" }), h("i", { class: "eye" }), h("i", { class: "tail" })),
  ham: () => h("div", { class: "sc-shape ham" }, h("i", { class: "meat" }), h("i", { class: "bone" })),
  arrow: () => h("div", { class: "sc-shape arrow" }, h("i", { class: "shaft" }), h("i", { class: "head" }), h("i", { class: "fletch" })),
};

const SVGNS = "http://www.w3.org/2000/svg";

export class Scene {
  /** host: the element the scene fills (it gets a fixed aspect from cfg.aspect and the width of the host); heroNode: the drawn hero (or null). */
  constructor(host, cfg, { heroNode = null, speed = 1, score = 0, body = null } = {}) {
    this.cfg = cfg;
    this.body = body;
    this.speed = speed;
    this.W = 0;
    this.H = 0;
    this.cover = null;
    this.lastCover = null;
    this.hits = score;
    this.alive = true;
    const bg = cfg.background;
    this.el = h("div", { class: "sc", "data-state": "idle" });
    for (const [k, v] of [["--sky-a", bg.sky[0]], ["--sky-b", bg.sky[1]], ["--gr-a", bg.ground[0]], ["--gr-b", bg.ground[1]], ["--horizon", `${bg.horizon * 100}%`]]) this.el.style.setProperty(k, v);   // custom properties need setProperty
    this.trees = h("div", { class: "sc-trees" }, Array.from({ length: bg.trees }, (_, i) => {
      const t = h("i", { class: "sc-tree", style: { left: `${(i + 0.5) * (100 / bg.trees)}%` } });
      t.style.setProperty("--s", String(0.8 + ((i * 37) % 7) / 14));
      return t;
    }));
    this.coverEls = new Map(cfg.covers.map((c) => [c.id, h("div", { class: "sc-cover", "data-cover": c.id }, h("i", { class: "leaf a" }), h("i", { class: "leaf b" }), h("i", { class: "leaf c" }))]));
    this.hare = this._sprite(cfg.target.sprite, "sc-tg");                   // the target itself; its window clips it, so it can only rise from BEHIND the cover
    this.hare.setAttribute("data-state", "hidden");
    this.target = h("div", { class: "sc-target" }, this.hare);
    this.heroBox = h("div", { class: "sc-hero", "data-pose": "idle" }, heroNode);
    this.arrow = this._sprite(cfg.projectile.sprite, "sc-arrow");
    this.bowSvg = document.createElementNS(SVGNS, "svg");                              // the bow and its string, drawn in scene px (placeholder; the finished sprite replaces it)
    this.bowSvg.setAttribute("class", "sc-bow");
    this.bowSvg.setAttribute("data-id", "bow");
    this.bowArc = document.createElementNS(SVGNS, "path");
    this.bowString = document.createElementNS(SVGNS, "polyline");
    this.bowArc.setAttribute("class", "arc");
    this.bowString.setAttribute("class", "string");
    this.bowSvg.append(this.bowArc, this.bowString);
    this.loot = this._sprite(cfg.loot.sprite, "sc-loot");
    this.scoreEl = h("div", { class: "sc-score", "data-id": "score" }, this._sprite(cfg.loot.sprite, "sc-score-icon"), h("b", { "data-id": "score-n" }, String(this.hits)), h("span", {}, cfg.score.label));
    this.eq = h("div", { class: "sc-eq", "data-id": "eq", "data-mode": "idle" });
    this.el.append(h("div", { class: "sc-sky" }), this.trees, h("div", { class: "sc-ground" }), this.target, ...this.coverEls.values(), this.heroBox, this.bowSvg, this.arrow, this.loot, this.scoreEl, this.eq);
    host.replaceChildren(this.el);
    this.ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => this.measure()) : null;
    if (this.ro) this.ro.observe(host);
    this._host = host;
    this.measure();
  }

  _sprite(name, cls) {
    const files = (this.cfg.sprites || {})[name];
    const node = (SHAPES[name] || (() => h("div", { class: "sc-shape" })))();
    const box = h("div", { class: cls, "data-sprite": name }, node);
    if (files) box.classList.add("art");
    box._files = files || null;
    return box;
  }

  _setState(el, state) {
    el.setAttribute("data-state", state);
    const f = el._files && el._files[state];
    if (f) el.style.backgroundImage = `url(${f})`;
  }

  measure() {
    const W = this._host.clientWidth || 360;
    const H = this._host.clientHeight || Math.round(W * this.cfg.aspect);       // the scene fills what the screen gives it (fractions); aspect only when the host has no height yet
    this.W = W;
    this.H = H;
    this.U = Math.min(W, H / 0.8);                                               // the unit of sizes that must not grow with a wide landscape box
    const s = this.el.style;
    s.width = `${W}px`;
    s.height = `${H}px`;
    const size = this.cfg.target.size * this.U;
    this.hare.style.width = `${size}px`;
    this.hare.style.height = `${size * 0.9}px`;
    this.hare.style.marginLeft = `${-size / 2}px`;
    for (const c of this.cfg.covers) {
      const e = this.coverEls.get(c.id);
      Object.assign(e.style, { left: `${c.x * W - (c.w * W) / 2}px`, top: `${c.y * H - c.h * H}px`, width: `${c.w * W}px`, height: `${c.h * H}px` });
    }
    const hh = this.cfg.hero.size * H;
    Object.assign(this.heroBox.style, { left: `${this.cfg.hero.x * W - hh / 2}px`, top: `${this.cfg.hero.y * H - hh}px`, width: `${hh}px`, height: `${hh}px` });
    const aw = Math.max(40, this.U * 0.2);
    Object.assign(this.arrow.style, { width: `${aw}px`, height: `${aw * 0.2}px` });
    const lw = Math.max(26, this.U * 0.1);
    Object.assign(this.loot.style, { width: `${lw}px`, height: `${lw * 0.8}px` });
    this.bowSvg.setAttribute("width", String(W));
    this.bowSvg.setAttribute("height", String(H));
    this._drawBow(0);
    if (this.cover) this._placeTarget(this.cover);
  }

  /** Draws the bow with the string drawn back by `pull` px (towards the hero). */
  _drawBow(pull) {
    const g = bowGeometry(this.cfg, this.W, this.H, pull, this.body), [a, b] = g.tips;
    this.bowArc.setAttribute("d", `M ${a.x} ${a.y} Q ${g.back.x + (g.back.x - g.grip.x)} ${g.grip.y} ${b.x} ${b.y}`);
    this.bowString.setAttribute("points", `${a.x},${a.y} ${g.nock.x},${g.nock.y} ${b.x},${b.y}`);
  }

  /** Runs fn(0..1) over ms (scaled by the speed) on animation frames; resolves at 1. */
  _tween(ms, fn) {
    return new Promise((res) => {
      const t0 = performance.now(), total = dur(ms, this.speed);
      const step = (now) => {
        const k = Math.min(1, (now - t0) / total);
        fn(k);
        if (k < 1 && this.alive) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
  }

  /** The window of the target: from far above the cover down to a little above its foot (the cover, drawn over it, hides the rest); the target stands at its bottom. */
  _placeTarget(c) {
    const size = this.cfg.target.size * this.U;
    const w = size * 1.5, hgt = size * 2.4;
    const bottom = c.y * this.H - c.h * this.H * 0.22;
    Object.assign(this.target.style, { left: `${c.x * this.W - w / 2}px`, top: `${bottom - hgt}px`, width: `${w}px`, height: `${hgt}px` });
  }

  _anim(el, frames, ms, opts = {}) {
    if (!this.alive || !el.animate) return Promise.resolve();
    const a = el.animate(frames, { duration: dur(ms, this.speed), fill: "forwards", easing: "ease-out", ...opts });
    return a.finished.catch(() => {});
  }

  /** The target runs out of the picture: from behind its cover away from the hero (to the right), in hops, off the edge of the scene. */
  _flee(c, rest) {
    this.target.style.overflow = "visible";                                           // it is no longer behind the cover: its window must not clip it
    const run = (1 - c.x) * this.W + this.cfg.target.size * this.U * 1.2, hop = this.U * 0.05, n = 6;
    const frames = Array.from({ length: n + 1 }, (_, i) => ({
      transform: `translate(${(run * i) / n}px, ${rest - (i % 2 ? hop : 0)}px) rotate(${i % 2 ? -8 : 4}deg)`,
      opacity: 1, offset: i / n,
    }));
    return this._anim(this.hare, frames, this.cfg.target.flee_ms, { easing: "ease-in" }).then(() => { this.target.style.overflow = ""; });
  }

  _log(ev) {
    (this.events = this.events || []).push(ev);                                       // the order of the shot, for the tests
  }

  /** The target peeks out from a cover (not the one before) and waits. Resolves when it is up. */
  async peek(rnd = Math.random) {
    const c = pickCover(this.cfg.covers, this.lastCover, rnd);
    this.cover = c;
    this.lastCover = c.id;
    this.hare.getAnimations().forEach((a) => a.cancel());
    this.hare.style.opacity = "1";
    this.hare.style.transform = "translateY(105%)";                                 // below the window: not visible
    this._placeTarget(c);
    for (const [id, e] of this.coverEls) e.style.zIndex = id === c.id ? "6" : "4";      // the chosen cover in front of the target
    this.el.setAttribute("data-state", "peek");
    this._setState(this.hare, "peek");
    const rise = `translateY(${restOffset(this.cfg, this.W, this.H, c)}px)`;
    await this._anim(this.hare, [{ transform: "translateY(105%)" }, { transform: rise }], this.cfg.target.peek_ms);
    this.hare.style.transform = rise;
    this.el.setAttribute("data-state", "wait");
    this._setState(this.hare, "wait");
  }

  /** The equation on the scene: mode "typing" while the child types, "right" / "wrong" after the answer. */
  setEquation(text, typed, mode = "typing", answer = null) {
    this.eq.setAttribute("data-mode", mode);
    const parts = [h("span", { class: "q", "data-id": "eq-q" }, `${text} = `)];
    if (mode === "wrong") {
      parts.push(h("s", { class: "given", "data-id": "eq-given" }, typed === "" ? "?" : typed), h("b", { class: "ans", "data-id": "eq-answer" }, String(answer)));
    } else {
      parts.push(h("span", { class: "a", "data-id": "eq-typed" }, typed === "" ? "" : typed), mode === "typing" ? h("i", { class: "caret" }) : null);      // "given": the answer is in, no verdict yet
    }
    this.eq.replaceChildren(...parts.filter(Boolean));
  }

  clearEquation() {
    this.eq.setAttribute("data-mode", "idle");
    this.eq.replaceChildren();
  }

  /** The hero draws the bow, looses the arrow; a hit turns the target into loot that leaps into the score, a miss lets it flee. Resolves when everything has settled. */
  async shoot(hit) {
    const c = this.cover;
    if (!c) return;
    const cfg = this.cfg, g = shotGeometry(cfg, this.W, this.H, c, hit, this.body), sp = this.speed, rest = restOffset(cfg, this.W, this.H, c);
    const aw = parseFloat(this.arrow.style.width) || 60;
    this.events = [];
    this._log("draw");
    this.el.setAttribute("data-state", "draw");
    this.heroBox.setAttribute("data-pose", "draw");
    this.arrow.style.opacity = "1";
    this.arrow.style.transformOrigin = "0 50%";
    const place = (x, y) => `translate(${x}px, ${y - aw * 0.1}px) rotate(${g.angle}rad)`;
    const pull = this.U * 0.06;
    await Promise.all([                                                                  // the string and the arrow go back to the body
      this._tween(cfg.hero.draw_ms, (k) => this._drawBow(pull * k)),
      this._anim(this.arrow, [{ transform: place(g.from.x, g.from.y) }, { transform: place(g.from.x - pull, g.from.y) }], cfg.hero.draw_ms),
    ]);
    this.heroBox.setAttribute("data-pose", "release");
    this._log("release");
    this.el.setAttribute("data-state", "flight");
    this._tween(cfg.hero.release_ms, (k) => this._drawBow(pull * (1 - k)));
    await this._anim(this.arrow, [{ transform: place(g.from.x - pull, g.from.y) }, { transform: place(g.to.x - aw * (hit ? 0.8 : 0.2), g.to.y) }], cfg.projectile.flight_ms, { easing: "linear" });
    this.heroBox.setAttribute("data-pose", "idle");
    if (hit) {
      this.el.setAttribute("data-state", "hit");
      this._setState(this.hare, "hit");
      this.arrow.style.opacity = "0";
      const lootFrom = { x: g.target.x, y: g.target.y };
      const sb = this.scoreEl.getBoundingClientRect(), eb = this.el.getBoundingClientRect();
      const lootTo = { x: sb.left - eb.left + sb.width * 0.2, y: sb.top - eb.top + sb.height * 0.5 };
      const pts = arcPoints(lootFrom, lootTo, cfg.loot.arc_height * this.H);
      const lw = parseFloat(this.loot.style.width) || 30;
      this.loot.style.opacity = "1";
      const frames = pts.map((p, i) => ({ transform: `translate(${p.x - lw / 2}px, ${p.y - lw * 0.4}px) rotate(${i * 40}deg) scale(${1 - 0.35 * (i / pts.length)})`, offset: i / (pts.length - 1) }));
      this._setState(this.loot, "loot");
      await Promise.all([
        this._anim(this.hare, [{ transform: `translateY(${rest}px) scale(1)`, opacity: 1 }, { transform: `translateY(${rest - this.U * 0.1}px) scale(1.15) rotate(12deg)`, opacity: 1, offset: 0.4 }, { transform: `translateY(${rest + this.U * 0.1}px) scale(.6)`, opacity: 0 }], cfg.target.hit_ms),
        this._anim(this.loot, frames, cfg.loot.arc_ms, { easing: "linear" }),
      ]);
      this.loot.style.opacity = "0";
      this.hits += 1;
      this.scoreEl.querySelector('[data-id="score-n"]').textContent = String(this.hits);
      this._anim(this.scoreEl, [{ transform: "scale(1)" }, { transform: "scale(1.3)" }, { transform: "scale(1)" }], 300);
    } else {
      this.el.setAttribute("data-state", "flee");
      this._setState(this.hare, "flee");
      this._log("flee");
      await Promise.all([
        this._anim(this.arrow, [{ opacity: 1 }, { opacity: 0 }], 250, { delay: dur(150, sp) }),
        this._flee(c, rest),
      ]);
      this._log("fled");
    }
    this.arrow.style.opacity = "0";
    this.hare.style.opacity = "0";
    this.el.setAttribute("data-state", "idle");
    this._setState(this.hare, "hidden");
  }

  destroy() {
    this.alive = false;
    if (this.ro) this.ro.disconnect();
  }
}
