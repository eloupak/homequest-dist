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

/* ---- the archer (#189, brief-025) ---------------------------------------------------------------------------------------------------------- */

/** The archer picture for an aim: the pose of the nearest angle (aim<deg>_<relaxed|drawn>, deg = up from horizontal) among `keys`; null = none. */
export function pickAimPose(keys, angle, drawn) {
  const want = drawn ? "drawn" : "relaxed", up = (-angle * 180) / Math.PI;
  let best = null, bd = Infinity;
  for (const k of keys || []) {
    const m = /^aim(\d+)_(relaxed|drawn)$/.exec(k);
    if (!m || m[2] !== want) continue;
    const d = Math.abs(Number(m[1]) - up);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

/** The bow picture on the fist (unrotated, scene px): art = hunt.yaml scene.art.bow, len = the bow height in px. -> {k, x, y, w, h, mirror,
 *  tipDx (the string line from the grip, px; negative = towards the hero), half (the half length between the tips)}. */
export function bowArtPlace(art, grip, len) {
  const [W, H] = art.size, [t0, t1] = art.tips, [gx, gy] = art.grip;
  const k = len / Math.max(1, Math.abs(t1[1] - t0[1]));
  const m = !!art.mirror, gxm = m ? W - gx : gx, txm = m ? W - (t0[0] + t1[0]) / 2 : (t0[0] + t1[0]) / 2;
  return { k, x: grip.x - gxm * k, y: grip.y - gy * k, w: W * k, h: H * k, mirror: m, tipDx: (txm - gxm) * k, half: len / 2 };
}

/** background-size / -position (px) that put the drawn part `box` of a picture (canvas `size`) over a box of w x h px (stretched to fit). */
export function boxFit(art, w, h) {
  const [W, H] = art.size, [x0, y0, x1, y1] = art.box || [0, 0, W, H];
  const sx = w / Math.max(1, x1 - x0), sy = h / Math.max(1, y1 - y0);
  return { size: `${(W * sx).toFixed(1)}px ${(H * sy).toFixed(1)}px`, pos: `${(-x0 * sx).toFixed(1)}px ${(-y0 * sy).toFixed(1)}px` };
}

/* ---- the aiming hunt (#188): the child pulls the string with a finger (power), moves it to aim (direction), lets go to shoot ----------------
 * Everything in scene px; up is negative y. aim = the `aim` section of hunt.yaml: pull_max (the longest pull, x the unit U), min_power (a shorter
 * pull does not shoot), gravity (x the scene height per s^2), range (the longest shot at 45 degrees, x the scene width), preview (seconds of the
 * flight shown as dots while aiming: the help with aiming), hit_scale (x the hit zone of every animal: generous for small children). */
export const AIM_DEFAULTS = { pull_max: 0.32, min_power: 0.18, gravity: 1.3, range: 1.5, preview: 0.32, hit_scale: 1.25, angle_min: -75, angle_max: 25, show_ms: 1100, lurk: 0.45, window_ms: 3000, flight_speed: 2.0, flight_max_ms: 650 };

/** The pull of a finger (from where it was put down to where it is now) -> {power 0..1, angle in radians, the arrow flies away from the pull}.
 *  The angle is kept towards the target side (right): -75..+25 degrees by default. */
export function pullToShot(p0, p, aim, U) {
  const a = { ...AIM_DEFAULTS, ...(aim || {}) };
  const dx = p0.x - p.x, dy = p0.y - p.y;
  const len = Math.hypot(dx, dy);
  const power = clamp(len / (a.pull_max * U), 0, 1);
  let ang = len < 1 ? 0 : Math.atan2(dy, Math.max(dx, 0.0001));
  ang = clamp(ang, (a.angle_min * Math.PI) / 180, (a.angle_max * Math.PI) / 180);
  return { power, angle: ang };
}

/** The flight parameters in px: the speed at full power and the gravity. */
export function flightParams(aim, W, H) {
  const a = { ...AIM_DEFAULTS, ...(aim || {}) };
  const g = a.gravity * H;
  return { g, vmax: Math.sqrt(a.range * W * g) };
}

/** Addendum 7 (#189): how long the flight of `t` s of the curve is shown (ms): faster than real (aim.flight_speed), capped by aim.flight_max_ms. */
export function flightShowMs(t, aim) {
  const a = { ...AIM_DEFAULTS, ...(aim || {}) };
  return Math.min((t * 1000) / Math.max(0.1, Number(a.flight_speed) || 1), Number(a.flight_max_ms) || Infinity);
}

/** The position of the arrow after t seconds. */
export function flightAt(from, power, angle, fp, t) {
  const v = power * fp.vmax;
  return { x: from.x + v * Math.cos(angle) * t, y: from.y + v * Math.sin(angle) * t + 0.5 * fp.g * t * t };
}

/** Flies the arrow until it hits the circle `zone` {x, y, r}, leaves the scene (W x H) or falls under `floor` -> {hit, t, points}. */
export function simulateShot(from, power, angle, fp, zone, W, H, floor = H, dt = 1 / 120) {
  const pts = [];
  for (let t = 0; t < 4; t += dt) {
    const p = flightAt(from, power, angle, fp, t);
    pts.push({ ...p, t });
    if (zone && Math.hypot(p.x - zone.x, p.y - zone.y) <= zone.r) return { hit: true, t, points: pts };
    if (p.x > W + 40 || p.x < -40 || p.y > floor || p.y < -H) return { hit: false, t, points: pts };
  }
  return { hit: false, t: 4, points: pts };
}

/** A pull that hits `zone` from `from` (for the tests and as a reference of the difficulty): the lowest angle from 20 degrees up whose speed is in reach. */
export function solveShot(from, zone, fp) {
  const dx = zone.x - from.x, dy = from.y - zone.y;                       // dy: up positive
  for (let deg = 20; deg <= 70; deg += 2) {
    const th = (deg * Math.PI) / 180, c = Math.cos(th);
    const den = 2 * c * c * (dx * Math.tan(th) - dy);
    if (den <= 0) continue;
    const v = Math.sqrt((fp.g * dx * dx) / den);
    if (v <= fp.vmax * 0.98) return { power: v / fp.vmax, angle: -th };
  }
  return null;
}

const SHAPES = {
  hare: () => h("div", { class: "sc-shape hare" }, h("i", { class: "ear l" }), h("i", { class: "ear r" }), h("i", { class: "head" }), h("i", { class: "body" }), h("i", { class: "eye" }), h("i", { class: "tail" })),
  deer: () => h("div", { class: "sc-shape deer" }, h("i", { class: "body" }), h("i", { class: "neck" }), h("i", { class: "head" }), h("i", { class: "ear l" }), h("i", { class: "ear r" }), h("i", { class: "eye" }), h("i", { class: "rump" })),
  boar: () => h("div", { class: "sc-shape boar" }, h("i", { class: "body" }), h("i", { class: "head" }), h("i", { class: "snout" }), h("i", { class: "tusk" }), h("i", { class: "ear" }), h("i", { class: "eye" }), h("i", { class: "mane" })),
  ham: () => h("div", { class: "sc-shape ham" }, h("i", { class: "meat" }), h("i", { class: "bone" })),
  arrow: () => h("div", { class: "sc-shape arrow" }, h("i", { class: "shaft" }), h("i", { class: "head" }), h("i", { class: "fletch" })),
};

const SVGNS = "http://www.w3.org/2000/svg";

export class Scene {
  /** host: the element the scene fills (it gets a fixed aspect from cfg.aspect and the width of the host); heroNode: the drawn hero (or null). */
  constructor(host, cfg, { heroNode = null, speed = 1, score = 0, body = null, poses = {} } = {}) {
    this.cfg = { ...cfg, bow: { ...(cfg.bow || {}) } };                          // the bow's grip changes with the archer pose: our own copy
    cfg = this.cfg;
    this.poses = poses || {};
    this.heroPose = null;
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
    this.heroBox = h("div", { class: "sc-hero", "data-pose": "idle" }, heroNode, ...Object.entries(this.poses).map(([k, p]) => { p.node.dataset.aimPose = k; p.node.hidden = true; return p.node; }));
    this._baseHero = heroNode;
    if (heroNode) heroNode.hidden = false;                                         // addendum 7 (#189): the stage keeps the hero node between rounds; the last round hid it behind an aim pose
    this._baseGrip = body && cfg.bow.grip_canvas ? cfg.bow.grip_canvas[body] : null;
    this.arrow = this._sprite(cfg.projectile.sprite, "sc-arrow");
    this.bowSvg = document.createElementNS(SVGNS, "svg");                              // the bow and its string, drawn in scene px (placeholder; the finished sprite replaces it)
    this.bowSvg.setAttribute("class", "sc-bow");
    this.bowSvg.setAttribute("data-id", "bow");
    this.bowArc = document.createElementNS(SVGNS, "path");
    this.bowString = document.createElementNS(SVGNS, "polyline");
    this.bowArc.setAttribute("class", "arc");
    this.bowString.setAttribute("class", "string");
    this.bowG = document.createElementNS(SVGNS, "g");                                // rotated around the fist while aiming (#188)
    this.bowImg = document.createElementNS(SVGNS, "image");                          // #189: the bow picture (shown once it loads; the arc is the fallback)
    this.bowImg.setAttribute("class", "art");
    this.bowImg.setAttribute("preserveAspectRatio", "none");
    this.bowG.append(this.bowImg, this.bowArc, this.bowString);
    this.bowDots = document.createElementNS(SVGNS, "g");                             // the help with aiming: dots of the start of the flight
    this.bowDots.setAttribute("class", "dots");
    this.bowSvg.append(this.bowDots, this.bowG);
    this.aimAngle = 0;
    this.loot = this._sprite(cfg.loot.sprite, "sc-loot");
    this.scoreEl = h("div", { class: "sc-score", "data-id": "score" }, this._sprite(cfg.loot.sprite, "sc-score-icon"), h("b", { "data-id": "score-n" }, String(this.hits)), cfg.score && cfg.score.label ? h("span", {}, cfg.score.label) : null);  // addendum 10: the hunt shows only the number and the ham
    this.eq = h("div", { class: "sc-eq", "data-id": "eq", "data-mode": "idle" });
    this.hint = h("div", { class: "sc-hint", "data-id": "aim-hint", hidden: true }, "Přilož prst a táhni dozadu. Pusť = výstřel!");
    this.plus = h("div", { class: "sc-plus", "data-id": "plus" });
    this.timerBar = h("div", { class: "sc-timer", "data-id": "aim-timer", hidden: true }, h("i"));     // addendum 5: the time left to shoot once the animal is out
    this.photo = h("div", { class: "sc-photo", "data-id": "ground-photo" });            // #191: the picture of the hunting ground (missing = the drawn meadow)
    this.el.append(h("div", { class: "sc-sky" }), this.trees, h("div", { class: "sc-ground" }), this.photo, this.target, ...this.coverEls.values(), this.heroBox, this.bowSvg, this.arrow, this.loot, this.plus, this.scoreEl, this.eq, this.hint, this.timerBar);
    host.replaceChildren(this.el);
    this._loadArt();
    for (const files of Object.values(cfg.sprites || {})) if (files && typeof files === "object") Object.values(files).forEach((f) => typeof f === "string" && this._preload(f));   // #211
    this.ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => this.measure()) : null;
    if (this.ro) this.ro.observe(host);
    this._host = host;
    this.measure();
  }

  /** #189 (brief-025): the bow, the arrow and the bush pictures of hunt.yaml scene.art; each is used only once it has loaded (else the drawn shape). */
  _loadArt() {
    const art = this.cfg.art || {};
    this.artOk = {};
    if (typeof Image !== "function") return;
    for (const [id, a] of Object.entries(art)) {
      if (!a || !a.file) continue;
      const probe = new Image();
      probe.onload = () => {
        if (!this.alive) return;
        this.artOk[id] = true;
        this.el.classList.add(`art-${id}`);
        if (id === "bow") this.bowImg.setAttribute("href", a.file);
        if (id === "arrow") this.arrow.style.backgroundImage = `url("${a.file}")`;
        if (id === "cover") for (const e of this.coverEls.values()) e.style.backgroundImage = `url("${a.file}")`;
        this.measure();
      };
      probe.src = a.file;
    }
  }

  /** #189: the archer picture `key` (aim<deg>_<relaxed|drawn>), null = the plain (reach) hero; the bow moves to its fist. */
  _setHeroPose(key) {
    if (key === this.heroPose || (key && !this.poses[key])) return;
    this.heroPose = key;
    if (this._baseHero) this._baseHero.hidden = !!key;
    for (const [k, p] of Object.entries(this.poses)) p.node.hidden = k !== key;
    if (this.body) this.cfg.bow.grip_canvas = { ...(this.cfg.bow.grip_canvas || {}), [this.body]: key ? this.poses[key].grip : this._baseGrip };
    this.heroBox.setAttribute("data-aim-pose", key || "");
  }

  /** The string hand of the current archer picture in scene px (hunt.yaml hero.string_hand), null when it has none (the string then pulls by `pull`). */
  _stringHand() {
    const c = this.heroPose && this.body && (((this.cfg.hero.string_hand || {})[this.body] || {})[this.heroPose]);
    if (!c) return null;
    const hh = this.cfg.hero.size * this.H;
    return { x: this.cfg.hero.x * this.W - hh / 2 + (c[0] / 1024) * hh, y: this.cfg.hero.y * this.H - hh + (c[1] / 1024) * hh };
  }

  /** #191: the ground's picture for the current shape of the scene (background_wide on a landscape box); a file that does not load = the drawn meadow. */
  _groundPhoto() {
    const g = this.cfg.ground;
    if (!g || typeof Image !== "function") return;
    const want = (this.W / Math.max(1, this.H) > 1.25 && g.background_wide) || g.background || g.background_wide;
    if (!want || this._photoUrl === want) return;
    this._photoUrl = want;
    // #211: the drawn meadow with its trees (a "forest") must not flash before the picture of the chosen ground comes: while it loads the
    // scene shows neither (photo-wait: a plain dark box), a cached picture is painted at once; only a picture that fails = the drawn meadow
    if (!this.el.classList.contains("photo")) this.el.classList.add("photo-wait");
    const probe = new Image();
    probe.onload = () => {
      if (this._photoUrl !== want) return;
      this.photo.style.backgroundImage = `url("${want}")`;
      this.el.classList.add("photo");
      this.el.classList.remove("photo-wait");
      this.el.setAttribute("data-ground", g.id);
    };
    probe.onerror = () => {
      if (this._photoUrl !== want) return;
      if (want !== g.background && g.background) { this._photoUrl = null; this.cfg.ground = { ...g, background_wide: null }; this._groundPhoto(); return; }
      this.el.classList.remove("photo-wait");
    };
    probe.src = want;
    if (probe.complete && probe.naturalWidth) probe.onload();          // already in the cache (the menu showed it on its button): no frame of the meadow
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
    if (!f) return;
    // #211: a picture not loaded yet (the flee of an animal the first time on an iPhone) left the box empty for the whole run = the
    // animal "vanished"; the old picture stays until the new one is ready (all of them are preloaded, see _preload)
    const img = this._preload(f);
    if (!img || (img.complete && img.naturalWidth) || !el.style.backgroundImage) { el.style.backgroundImage = `url(${f})`; return; }
    el._want = f;
    img.addEventListener("load", () => { if (el._want === f) el.style.backgroundImage = `url(${f})`; }, { once: true });
  }

  /** #211: every state picture of the sprites (the animals: peek, wait, flee, hit...) is fetched when the scene starts, not when needed. */
  _preload(f) {
    if (!f || typeof Image !== "function") return null;
    const m = (this._pre = this._pre || new Map());
    if (!m.has(f)) { const i = new Image(); i.decoding = "async"; i.src = f; m.set(f, i); }
    return m.get(f);
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
    if (this.animal) this._sizeAnimal();
    for (const c of this.cfg.covers) {
      const e = this.coverEls.get(c.id);
      Object.assign(e.style, { left: `${c.x * W - (c.w * W) / 2}px`, top: `${c.y * H - c.h * H}px`, width: `${c.w * W}px`, height: `${c.h * H}px` });
    }
    const hh = this.cfg.hero.size * H;
    Object.assign(this.heroBox.style, { left: `${this.cfg.hero.x * W - hh / 2}px`, top: `${this.cfg.hero.y * H - hh}px`, width: `${hh}px`, height: `${hh}px` });
    const aw = Math.max(40, this.U * 0.2);
    Object.assign(this.arrow.style, { width: `${aw}px`, height: `${aw * 0.2}px` });
    const art = this.cfg.art || {}, ok = this.artOk || {};
    if (ok.arrow) {                                                               // the drawn arrow: full width, half the box height, in its middle
      const f = boxFit(art.arrow, aw, aw * 0.1);
      const [, y0] = f.pos.split(" ");
      Object.assign(this.arrow.style, { backgroundSize: f.size, backgroundPosition: `${f.pos.split(" ")[0]} ${(parseFloat(y0) + aw * 0.05).toFixed(1)}px`, backgroundRepeat: "no-repeat" });
    }
    if (ok.cover) for (const c of this.cfg.covers) {
      const f = boxFit(art.cover, c.w * W, c.h * H);
      Object.assign(this.coverEls.get(c.id).style, { backgroundSize: f.size, backgroundPosition: f.pos, backgroundRepeat: "no-repeat" });
    }
    const lw = Math.max(26, this.U * 0.1);
    Object.assign(this.loot.style, { width: `${lw}px`, height: `${lw * 0.8}px` });
    this.bowSvg.setAttribute("width", String(W));
    this.bowSvg.setAttribute("height", String(H));
    this._drawBow(0);
    if (this.cover) this._placeTarget(this.cover);
    this._groundPhoto();
  }

  /** Draws the bow with the string drawn back by `pull` px (towards the hero). */
  _drawBow(pull) {
    const g = bowGeometry(this.cfg, this.W, this.H, pull, this.body);
    let [a, b] = g.tips, nock = g.nock;
    const art = this.cfg.art && this.cfg.art.bow;
    if (art && this.artOk && this.artOk.bow) {                                    // #189: the picture on the fist; the string between its tips
      const P = bowArtPlace(art, g.grip, (this.cfg.bow.height || 0.2) * this.H);
      this.bowImg.setAttribute("width", P.w.toFixed(1));
      this.bowImg.setAttribute("height", P.h.toFixed(1));
      this.bowImg.setAttribute("transform", P.mirror ? `translate(${(P.x + P.w).toFixed(1)} ${P.y.toFixed(1)}) scale(-1 1)` : `translate(${P.x.toFixed(1)} ${P.y.toFixed(1)})`);
      a = { x: g.grip.x + P.tipDx, y: g.grip.y - P.half };
      b = { x: g.grip.x + P.tipDx, y: g.grip.y + P.half };
      nock = { x: g.grip.x + P.tipDx - pull, y: g.grip.y };
    }
    const hand = pull > 0 && this._stringHand();
    let rot = this.aimAngle;
    if (hand) {                                                                   // the drawn hand holds the string: into the bow's own (unrotated) frame
      rot = Math.atan2(g.grip.y - hand.y, g.grip.x - hand.x);                    // the picture's arm decides how the bow and the arrow lie (the flight keeps the aim)
      const r = -rot, dx = hand.x - g.grip.x, dy = hand.y - g.grip.y;
      nock = { x: g.grip.x + dx * Math.cos(r) - dy * Math.sin(r), y: g.grip.y + dx * Math.sin(r) + dy * Math.cos(r) };
    }
    this._nock = nock;
    this.bowArc.setAttribute("d", `M ${a.x} ${a.y} Q ${g.back.x + (g.back.x - g.grip.x)} ${g.grip.y} ${b.x} ${b.y}`);
    this.bowString.setAttribute("points", `${a.x},${a.y} ${nock.x},${nock.y} ${b.x},${b.y}`);
    this.bowG.setAttribute("transform", `rotate(${(rot * 180) / Math.PI} ${g.grip.x} ${g.grip.y})`);
    this._bowRot = rot;
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
    const size = this.animal && this._animalSize ? this._animalSize.w : this.cfg.target.size * this.U;
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
      if (!this.noScore) {                                                          // addendum 12: a round without hams counts nothing
        this.hits += 1;
        this.scoreEl.querySelector('[data-id="score-n"]').textContent = String(this.hits);
        this._anim(this.scoreEl, [{ transform: "scale(1)" }, { transform: "scale(1.3)" }, { transform: "scale(1)" }], 300);
      }
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

  /* ---------------------------------------------------------------- the aiming hunt (#188) */

  get aimCfg() { return { ...AIM_DEFAULTS, ...(this.cfg.aim || {}) }; }

  /** The animal of hunt.yaml `animals` (id, size, hit...): its placeholder shape (or art) and size in the target box. */
  _setAnimal(a) {
    const def = (this.cfg.animals || []).find((x) => x.id === a.id) || {};
    this.animal = { ...def, ...a };
    const files = (this.cfg.sprites || {})[a.id] || null;
    this.hare._files = files;
    this.hare._want = null;
    if (files) Object.values(files).forEach((f) => this._preload(f));
    this.hare.classList.toggle("art", !!files);
    if (files && typeof Image === "function" && !(this._artOk || {})[a.id]) {         // art missing on this install (an old package): back to the shape
      const probe = new Image();
      probe.onload = () => { (this._artOk = this._artOk || {})[a.id] = true; };
      probe.onerror = () => {
        if (this.animal && this.animal.id === a.id && this.hare._files === files) { this.hare._files = null; this.hare.classList.remove("art"); this.hare.style.backgroundImage = ""; }
        if (this.cfg.sprites) delete this.cfg.sprites[a.id];
      };
      probe.src = files.peek || Object.values(files)[0];
    }
    this.hare.setAttribute("data-sprite", a.id);
    this.hare.setAttribute("data-animal", a.id);
    this.hare.replaceChildren((SHAPES[a.id] || SHAPES.hare)());
    this._sizeAnimal();
  }

  _sizeAnimal() {
    const a = this.animal || {};
    const size = (a.size || this.cfg.target.size) * this.U, ratio = a.ratio || 0.9;
    Object.assign(this.hare.style, { width: `${size}px`, height: `${size * ratio}px`, marginLeft: `${-size / 2}px` });
    this._animalSize = { w: size, h: size * ratio };
  }

  /** How far the animal rises from the bottom of its window: show = the share of its height above the cover. */
  _riseFor(c, show) {
    return -(0.78 * c.h * this.H - (1 - show) * this._animalSize.h);
  }

  /** After a right answer (#188 addendum 1, point 3): the animal peeks out of a cover for a moment (all of it), then crouches so that only its
   *  back and head show (aim.lurk) and waits for the shot there. Resolves when it is waiting. */
  async reveal(animal, rnd = Math.random) {
    const c = pickCover(this.cfg.covers, this.lastCover, rnd);
    this.cover = c;
    this.lastCover = c.id;
    this._setAnimal(animal);
    this.hare.getAnimations().forEach((x) => x.cancel());
    this.hare.style.opacity = "1";
    this.hare.style.transform = "translateY(105%)";
    this._placeTarget(c);
    for (const [id, e] of this.coverEls) e.style.zIndex = id === c.id ? "6" : "4";
    this.el.setAttribute("data-state", "peek");
    this.el.setAttribute("data-animal", animal.id);
    this._setState(this.hare, "peek");
    const up = `translateY(${this._riseFor(c, 0.95)}px)`, lurk = `translateY(${this._riseFor(c, this.aimCfg.lurk)}px)`;
    await this._anim(this.hare, [{ transform: "translateY(105%)" }, { transform: up }], this.cfg.target.peek_ms);
    this.hare.style.transform = up;
    await new Promise((r) => setTimeout(r, dur(this.aimCfg.show_ms, this.speed)));
    if (!this.alive) return;
    await this._anim(this.hare, [{ transform: up }, { transform: lurk }], 380);
    this.hare.style.transform = lurk;
    this._rest = this._riseFor(c, this.aimCfg.lurk);
    this.el.setAttribute("data-state", "wait");
    this._setState(this.hare, "wait");
  }

  /** Addendum 5 (#189): the animal runs out of a cover the moment the bow is drawn, straight to where it waits (aim.lurk). Resolves when it waits. */
  async _appear(animal, rnd = Math.random) {
    const c = pickCover(this.cfg.covers, this.lastCover, rnd);
    this.cover = c;
    this.lastCover = c.id;
    this._setAnimal(animal);
    this.hare.getAnimations().forEach((x) => x.cancel());
    this.hare.style.opacity = "1";
    this._placeTarget(c);
    for (const [id, e] of this.coverEls) e.style.zIndex = id === c.id ? "6" : "4";
    this.el.setAttribute("data-state", "peek");
    this.el.setAttribute("data-animal", animal.id);
    this._setState(this.hare, "peek");
    this._log("appear");
    const lurk = `translateY(${this._riseFor(c, this.aimCfg.lurk)}px)`;
    await this._anim(this.hare, [{ transform: "translateY(105%)" }, { transform: lurk }], this.cfg.target.peek_ms);
    this.hare.style.transform = lurk;
    this._rest = this._riseFor(c, this.aimCfg.lurk);
    this.el.setAttribute("data-state", "wait");
    this._setState(this.hare, "wait");
  }

  /** Addendum 5 (#189), the new turn after a right answer: the child draws the bow first (no animal yet); once the pull reaches aim.min_power the
   *  animal runs out; from the moment it waits the child has aim.window_ms to aim and let go, else it runs away. A release before the animal is
   *  out does not shoot (the bow relaxes, pull again). Resolves {hit, power, angle} | {hit: false, timeout: true} | {hit: false, cancelled: true}. */
  drawHunt(animal, { onOut } = {}) {
    const el = this.el, A = this.aimCfg;
    this.cover = null;
    this.hare.style.opacity = "0";
    el.setAttribute("data-aim", "ready");
    el.setAttribute("data-phase", "draw");
    this.hint.textContent = "Natáhni luk! Přilož prst a táhni dozadu.";
    this.hint.hidden = false;
    this._aimPose(0, -0.35);
    return new Promise((resolve) => {
      let p0 = null, id = null, cur = { power: 0, angle: -0.35 }, out = false, ready = false, timer = null, done = false;
      const pt = (ev) => { const r = el.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
      const finish = (res) => { if (done) return; done = true; cleanup(); resolve(res); };
      const startClock = () => {
        const ms = Number(A.window_ms) || 3000;                                // real time even with ?fast (it is the child's time, not an animation)
        this.timerBar.hidden = false;
        const bar = this.timerBar.firstChild;
        if (bar.animate) { bar.getAnimations().forEach((x) => x.cancel()); bar.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: ms, easing: "linear", fill: "forwards" }); }
        timer = setTimeout(() => {
          if (done || !this.alive) return;
          this._log("timeout");
          this.heroBox.setAttribute("data-pose", "idle");
          this.aimAngle = 0;
          this._aimPose(0, 0);
          this.arrow.style.opacity = "0";
          finish({ hit: false, timeout: true });
        }, ms);
      };
      const comeOut = async () => {
        out = true;
        if (onOut) onOut();
        el.setAttribute("data-phase", "appear");
        this.hint.hidden = true;
        await this._appear(animal);
        if (done || !this.alive) return;
        ready = true;
        el.setAttribute("data-phase", "aim");
        if (!p0) { this.hint.textContent = "Zamiř a pusť!"; this.hint.hidden = false; }
        startClock();
      };
      const down = (ev) => {
        if (p0 || !this.alive || done) return;
        ev.preventDefault();
        p0 = pt(ev);
        id = ev.pointerId;
        try { el.setPointerCapture(id); } catch (e) { /* a synthetic event */ }
        this.hint.hidden = true;
        el.setAttribute("data-aim", "pulling");
        this.heroBox.setAttribute("data-pose", "draw");
      };
      const move = (ev) => {
        if (!p0 || ev.pointerId !== id) return;
        ev.preventDefault();
        cur = pullToShot(p0, pt(ev), A, this.U);
        this._aimPose(cur.power, cur.angle);
        el.setAttribute("data-power", cur.power.toFixed(2));
        if (!out && cur.power >= A.min_power) comeOut();
      };
      const up = async (ev) => {
        if (!p0 || ev.pointerId !== id) return;
        ev.preventDefault();
        p0 = null;
        if (!ready || cur.power < A.min_power) {                                // not out yet / too short: no shot, the bow relaxes
          el.setAttribute("data-aim", "ready");
          this.heroBox.setAttribute("data-pose", "idle");
          this._aimPose(0, cur.angle);
          this.hint.textContent = ready ? "Zamiř a pusť!" : "Natáhni luk! Přilož prst a táhni dozadu.";
          this.hint.hidden = out && !ready;
          return;
        }
        if (done) return;
        done = true;
        cleanup();
        resolve(await this._fire(cur.power, cur.angle));
      };
      const block = (ev) => { if (ev.cancelable) ev.preventDefault(); };
      const cleanup = () => {
        clearTimeout(timer);
        el.removeEventListener("pointerdown", down);
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        el.removeEventListener("touchmove", block);
        el.removeAttribute("data-aim");
        el.removeAttribute("data-phase");
        this.hint.hidden = true;
        this.timerBar.hidden = true;
        this._cancelAim = null;
      };
      el.addEventListener("pointerdown", down);
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("touchmove", block, { passive: false });
      this._cancelAim = () => finish({ hit: false, cancelled: true });
      this._drawNow = () => { if (!out) { this._aimPose(A.min_power, -0.35); comeOut(); } };       // the tests: as if the bow was drawn
      this._shootNow = (power, angle) => { if (done) return; done = true; cleanup(); this._fire(power, angle).then(resolve); };   // the tests
    });
  }

  /** The hit zone in scene px: a circle around the visible part of the animal (above its cover), the radius from its size, `hit` and aim.hit_scale. */
  hitZone() {
    const c = this.cover, a = this.animal || {};
    if (!c) return null;
    const er = this.el.getBoundingClientRect(), r = this.hare.getBoundingClientRect();
    const coverTop = c.y * this.H - c.h * this.H;
    const top = r.top - er.top, bottom = Math.min(r.bottom - er.top, coverTop + c.h * this.H * 0.25);
    const w = this._animalSize ? this._animalSize.w : r.width;
    return { x: r.left - er.left + r.width / 2, y: (top + Math.max(top + 1, bottom)) / 2, r: (w / 2) * (a.hit || 1) * this.aimCfg.hit_scale };
  }

  _from() {
    const g = gripPoint(this.cfg, this.W, this.H, this.body);
    return { x: g.x, y: g.y };
  }

  _drawDots(power, angle) {
    const fp = flightParams(this.aimCfg, this.W, this.H), from = this._from(), n = 7;
    const dots = [];
    for (let i = 1; i <= n; i++) {
      const p = flightAt(from, power, angle, fp, (this.aimCfg.preview * i) / n);
      const c = document.createElementNS(SVGNS, "circle");
      c.setAttribute("cx", String(p.x));
      c.setAttribute("cy", String(p.y));
      c.setAttribute("r", String(Math.max(2, 4.5 - i * 0.35)));
      dots.push(c);
    }
    this.bowDots.replaceChildren(...dots);
  }

  _aimPose(power, angle) {
    this.aimAngle = angle;
    const keys = Object.keys(this.poses);
    if (keys.length) this._setHeroPose(pickAimPose(keys, angle, power > 0) || null);
    const pull = power * this.U * 0.09;
    this._drawBow(pull);
    const aw = parseFloat(this.arrow.style.width) || 60, from = this._from();
    const back = { x: from.x - Math.cos(angle) * pull, y: from.y - Math.sin(angle) * pull };
    const hand = power > 0 && this._stringHand();
    this.arrow.style.opacity = "1";
    this.arrow.style.transformOrigin = "0 50%";
    if (hand) {                                                                   // #189: the nock in the drawn hand, the arrow over the fist, a little past the bow
      const len = Math.hypot(from.x - hand.x, from.y - hand.y) * 1.15;
      this.arrow.style.transform = `translate(${hand.x}px, ${hand.y - aw * 0.1}px) rotate(${this._bowRot}rad) scaleX(${(len / aw).toFixed(3)})`;
    } else this.arrow.style.transform = `translate(${back.x - aw * 0.15}px, ${back.y - aw * 0.1}px) rotate(${angle}rad)`;
    if (power > 0) this._drawDots(power, angle); else this.bowDots.replaceChildren();
  }

  /** Waits for the child's shot: pointer down anywhere on the scene, pull (power + direction), let go. A pull shorter than aim.min_power does not
   *  shoot (the bow goes back, try again). The page must not scroll meanwhile (touch-action: none on the scene, #188). Resolves {hit, power, angle}. */
  aim() {
    const el = this.el, A = this.aimCfg;
    el.setAttribute("data-aim", "ready");
    this.hint.hidden = false;
    this._aimPose(0, -0.35);
    return new Promise((resolve) => {
      let p0 = null, id = null, cur = { power: 0, angle: -0.35 };
      const pt = (ev) => { const r = el.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
      const down = (ev) => {
        if (p0 || !this.alive) return;
        ev.preventDefault();
        p0 = pt(ev);
        id = ev.pointerId;
        try { el.setPointerCapture(id); } catch (e) { /* a synthetic event */ }
        this.hint.hidden = true;
        el.setAttribute("data-aim", "pulling");
        this.heroBox.setAttribute("data-pose", "draw");
      };
      const move = (ev) => {
        if (!p0 || ev.pointerId !== id) return;
        ev.preventDefault();
        cur = pullToShot(p0, pt(ev), A, this.U);
        this._aimPose(cur.power, cur.angle);
        el.setAttribute("data-power", cur.power.toFixed(2));
      };
      const up = async (ev) => {
        if (!p0 || ev.pointerId !== id) return;
        ev.preventDefault();
        p0 = null;
        if (cur.power < A.min_power) {                                         // too short: no shot, the bow relaxes
          el.setAttribute("data-aim", "ready");
          this.heroBox.setAttribute("data-pose", "idle");
          this._aimPose(0, cur.angle);
          this.hint.hidden = false;
          return;
        }
        cleanup();
        resolve(await this._fire(cur.power, cur.angle));
      };
      const block = (ev) => { if (ev.cancelable) ev.preventDefault(); };       // iOS: no scroll / bounce / pull-to-refresh while aiming
      const cleanup = () => {
        el.removeEventListener("pointerdown", down);
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        el.removeEventListener("touchmove", block);
        el.removeAttribute("data-aim");
        this.hint.hidden = true;
        this._cancelAim = null;
      };
      el.addEventListener("pointerdown", down);
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("touchmove", block, { passive: false });
      this._cancelAim = () => { cleanup(); resolve({ hit: false, cancelled: true }); };
      this._shootNow = (power, angle) => { cleanup(); this._fire(power, angle).then(resolve); };   // the tests
    });
  }

  /** The tests (and a reference of the difficulty): a pull that hits the waiting animal, as client coordinates of the finger (down at x0,y0, up at x1,y1). */
  solveDrag(miss = false) {
    const fp = flightParams(this.aimCfg, this.W, this.H), zone = this.hitZone(), from = this._from();
    let s = null;                                                                           // a miss: over the animal's head (a big deer far off: lower, still clear)
    for (const k of miss ? [3.5, 2.5, 2] : [0]) if (!s) s = solveShot(from, { ...zone, y: zone.y - k * zone.r }, fp);
    if (!s) return null;
    const r = this.el.getBoundingClientRect(), len = s.power * this.aimCfg.pull_max * this.U;
    const x0 = r.left + this.W * 0.5, y0 = r.top + this.H * 0.4;
    return { ...s, x0, y0, x1: x0 - Math.cos(s.angle) * len, y1: y0 - Math.sin(s.angle) * len };
  }

  /** Looses the arrow along its curve; a hit stops it in the animal. */
  async _fire(power, angle) {
    this.bowDots.replaceChildren();
    this.heroBox.setAttribute("data-pose", "release");
    this.el.setAttribute("data-state", "flight");
    this._log("release");
    const fp = flightParams(this.aimCfg, this.W, this.H), zone = this.hitZone(), from = this._from();
    const sim = simulateShot(from, power, angle, fp, zone, this.W, this.H, this.H * 0.98);
    this._tween(this.cfg.hero.release_ms, (k) => { this._drawBow(power * this.U * 0.09 * (1 - k)); });
    const aw = parseFloat(this.arrow.style.width) || 60;
    const total = Math.max(0.05, sim.t);
    await this._tween(flightShowMs(total, this.aimCfg), (k) => {
      const t = k * total, p = flightAt(from, power, angle, fp, t), v = power * fp.vmax;
      const ang = Math.atan2(v * Math.sin(angle) + fp.g * t, v * Math.cos(angle));
      this.arrow.style.transform = `translate(${p.x - aw * (sim.hit ? 0.8 : 0.5)}px, ${p.y - aw * 0.1}px) rotate(${ang}rad)`;
    });
    this.heroBox.setAttribute("data-pose", "idle");
    if (Object.keys(this.poses).length) this._setHeroPose(pickAimPose(Object.keys(this.poses), angle, false));   // #189: the string hand comes back
    this.aimAngle = 0;
    this._drawBow(0);
    this.lastShot = { hit: sim.hit, power, angle, zone };
    return { hit: sim.hit, power, angle };
  }

  /** Addendum 12: a round without hams (the ground gave them today already): no counter at the top (neither the ham nor the number) and
   *  no "+N"; a hit ham still leaps off the animal towards the hidden counter's place and fades there. on = true puts it back. */
  setScoring(on) {
    this.noScore = !on;
    this.scoreEl.style.visibility = on ? "" : "hidden";
    if (on) this.el.removeAttribute("data-noscore"); else this.el.setAttribute("data-noscore", "");
  }

  /** The animal is hit: the hams (`hams` of the animal) leap into the score with "+N" (a round without hams: no number, see setScoring). */
  async animalHit(hams = 1) {
    const cfg = this.cfg, rest = this._rest || 0;
    this.el.setAttribute("data-state", "hit");
    this._setState(this.hare, "hit");
    this._log("hit");
    const zone = this.hitZone() || { x: this.W * 0.6, y: this.H * 0.5 };
    this.arrow.style.opacity = "0";
    const sb = this.scoreEl.getBoundingClientRect(), eb = this.el.getBoundingClientRect();
    const lootTo = { x: sb.left - eb.left + sb.width * 0.2, y: sb.top - eb.top + sb.height * 0.5 };
    const pts = arcPoints({ x: zone.x, y: zone.y }, lootTo, cfg.loot.arc_height * this.H);
    const lw = parseFloat(this.loot.style.width) || 30;
    this.loot.style.opacity = "1";
    this._setState(this.loot, "loot");
    this.plus.textContent = this.noScore ? "" : `+${hams}`;                       // addendum 12: nothing counted, no "+N"
    this.plus.style.transform = `translate(${zone.x}px, ${zone.y - this.U * 0.12}px)`;
    const frames = pts.map((p, i) => ({ transform: `translate(${p.x - lw / 2}px, ${p.y - lw * 0.4}px) rotate(${i * 40}deg) scale(${1 - 0.35 * (i / pts.length)})`, offset: i / (pts.length - 1) }));
    await Promise.all([
      this._anim(this.hare, [{ transform: `translateY(${rest}px) scale(1)`, opacity: 1 }, { transform: `translateY(${rest - this.U * 0.06}px) scale(1.1) rotate(10deg)`, opacity: 1, offset: 0.4 }, { transform: `translateY(${rest + this.U * 0.1}px) scale(.6)`, opacity: 0 }], cfg.target.hit_ms),
      this._anim(this.loot, frames, cfg.loot.arc_ms, { easing: "linear" }),
      this.noScore ? this._anim(this.loot, [{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], cfg.loot.arc_ms, { fill: "none" })   // fades, then style.opacity 0 below
        : this._anim(this.plus, [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], cfg.loot.arc_ms + 200),
    ]);
    this.loot.style.opacity = "0";
    if (!this.noScore) {
      this.hits += hams;
      this.scoreEl.querySelector('[data-id="score-n"]').textContent = String(this.hits);
      this._anim(this.scoreEl, [{ transform: "scale(1)" }, { transform: "scale(1.3)" }, { transform: "scale(1)" }], 300);
    }
    this._settle();
  }

  /** Missed: the arrow lands in the grass, the animal runs away. */
  async animalFlee({ arrow = true } = {}) {                                     // arrow false: no shot (addendum 5, the time ran out)
    this.el.setAttribute("data-state", "flee");
    this._setState(this.hare, "flee");
    this._log("flee");
    await Promise.all([arrow ? this._anim(this.arrow, [{ opacity: 1 }, { opacity: 0 }], 300, { delay: dur(150, this.speed) }) : null, this._flee(this.cover, this._rest || 0)]);
    this._log("fled");
    this._settle();
  }

  _settle() {
    this.arrow.style.opacity = "0";
    this.hare.style.opacity = "0";
    this.el.setAttribute("data-state", "idle");
    this.el.removeAttribute("data-animal");
    this._setState(this.hare, "hidden");
  }

  destroy() {
    this.alive = false;
    if (this._cancelAim) this._cancelAim();
    if (this.ro) this.ro.disconnect();
  }
}
