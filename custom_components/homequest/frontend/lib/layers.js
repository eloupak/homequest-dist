/* Illustrated hero compositor: layered WebP cut-outs + CSS animation. Plain ES module.
 *
 * The pure functions (indexManifest, findEntry, buildLayers, supportsItem) work in Node, too.
 * The renderer is DOM based: every layer is an <img> placed in percent of the 1024 px canvas, so
 * the hero scales with CSS and animates (breathing, bob, hair/cape sway, weapon idle sway around
 * the grip) without redrawing anything. Turning front <-> back swaps the layer set at the midpoint
 * of a quick horizontal squash.
 */

export const CANVAS = 1024;
export const BODY_ART = { male: "boy", female: "girl" };
export const FRONT_ONLY = new Set(["weapon", "offhand"]);
// back view: weapon and offhand (front art only) sit partly behind the body
export const BACK_Z = { weapon: 12, offhand: 14 };
export const PORTRAIT = { x: 330, y: 118, w: 364, h: 336 }; // head and shoulders, in canvas px
export const PORTRAIT_SETS = { x: 376, y: 36, w: 272, h: 262 }; // same for whole-outfit sets (smaller head, higher up)
export const BUST_HAT = { x: 302, y: 0, w: 420, h: 420 };       // #185 addendum 5: head and shoulders of a set hero with room for a hat above (the choice of the feather)
// weapons held in two hands hide the offhand item
export const TWO_HANDED = new Set(["staff", "bow"]);
// green-rod grip (addendum 7): which pose set carries the grip of a weapon
export const ANGLE_POSE = new Set(["sword", "dagger", "axe"]);
export const poseOfWeapon = (item) => (item && ANGLE_POSE.has(String(item.art || item.id).split("_")[0]) ? "angle" : "vert");
const ART_SLOT = { outfit: "set" };

/* ------------------------------------------------------------ pure helpers -- */

const key = (kind, slot, id, body, view) => `${kind}|${slot || ""}|${id}|${body || "*"}|${view || "-"}`;

export function indexManifest(manifest) {
  const map = new Map();
  for (const e of Object.values((manifest && manifest.items) || {})) {
    map.set(key(e.kind, e.slot, e.id, e.body, e.view), e);
  }
  // #185 addendum 4: a set delivered only in its poses (hunter_1, brief-021: vert / angle / raise / swing / reach, no plain picture) is drawn
  // by its vert pose wherever the plain set is asked for (the hero tab, the shop, the portraits); a plain picture, when it exists, wins.
  for (const e of [...map.values()]) {
    if (e.kind !== "layer" || e.slot !== "set" || !String(e.id).endsWith(".vert")) continue;
    const plain = key("layer", "set", String(e.id).slice(0, -5), e.body, e.view);
    if (!map.has(plain)) map.set(plain, e);
  }
  const hasSets = [...map.values()].some((e) => e.kind === "layer" && e.slot === "set");
  return { map, manifest: manifest || { items: {} }, version: (manifest && manifest.updated) || 0, hasSets };
}

/** #101 variant A (test only): add the motion PoC pose pictures (ids `<x>.raise` / `<x>.swing`) of another manifest to `ix`, files relative to
 *  `prefix` (e.g. "../motion_test/art/" = served next to the live art). Entries the live manifest has win. Returns how many were added. */
export function addPoseEntries(ix, manifest, prefix, poses = ["raise", "swing"]) {
  let n = 0;
  for (const e of Object.values((manifest && manifest.items) || {})) {
    const pose = String(e.id || "").split(".")[1];
    if (!poses.includes(pose)) continue;
    const k = key(e.kind, e.slot, e.id, e.body, e.view);
    if (ix.map.has(k)) continue;
    ix.map.set(k, { ...e, file: prefix + e.file });
    n++;
  }
  return n;
}

export function findEntry(ix, kind, slot, id, body, view) {
  return ix.map.get(key(kind, slot, id, body, view)) || ix.map.get(key(kind, slot, id, null, view)) || null;
}

export function viewOfSlot(slot, view) {
  return FRONT_ONLY.has(slot) ? "front" : view;
}

/** #185: the art id of an outfit set to draw: its own art, or `art_fallback` (a placeholder from the catalog) while its own does not exist yet. */
export function setArtOf(ix, item, body) {
  const own = (item && (item.art || item.id)) || "";
  if (!item || !item.art_fallback || findEntry(ix, "layer", "set", own, body, "front")) return own;
  return findEntry(ix, "layer", "set", item.art_fallback, body, "front") ? item.art_fallback : own;
}

export function supportsItem(ix, item, bodyType) {
  const body = BODY_ART[bodyType] || bodyType;
  if (item.slot === "hair_dye") return true;                                           // a bottle: nothing is drawn on the hero
  if (item.picture) return true;                                                       // a trophy (#118 amulet): its own picture, see pictureLayer
  if (ix.hasSets && ["torso", "legs", "feet"].includes(item.slot)) return false; // replaced by whole-outfit sets
  if (item.slot === "back" && findEntry(ix, "layer", "back", `${item.art || item.id}.vert`, body, "front")) return true;   // #130 two-layer cape
  if (item.slot === "outfit") return !!findEntry(ix, "layer", "set", setArtOf(ix, item, body), body, "front");
  return !!findEntry(ix, "layer", ART_SLOT[item.slot] || item.slot, item.art || item.id, body, "front");
}

export function isTwoHanded(item, entry) {
  if (entry && entry.two_handed != null) return !!entry.two_handed;
  return TWO_HANDED.has(String(item.art || item.id).split("_")[0]);
}

/** #188 addendum 4: the fist of the worn outfit's pose set (manifest grip.point, px of the hero canvas) when the hero can be drawn in `pose`, else null.
 *  The hunt draws the hero in `reach` (the left arm stretched, brief-021) and puts its bow on this point. */
export function poseGrip(ix, spec, pose) {
  if (!ix || !hasPose(ix, spec, pose)) return null;
  const body = BODY_ART[spec.hero.body] || spec.hero.body;
  const ps = findEntry(ix, "layer", "set", `${setArtOf(ix, spec.items[spec.equipped.outfit], body)}.${pose}`, body, "front");
  return ps && ps.grip && Array.isArray(ps.grip.point) ? ps.grip.point.slice(0, 2) : null;
}

/** #189 (brief-025): the archer poses of the worn outfit that exist -> {pose: [x, y] fist of the bow hand}; e.g. aim25_drawn. */
export function aimPoseGrips(ix, spec, angles = [0, 25, 50]) {
  const out = {};
  for (const a of angles) for (const hand of ["relaxed", "drawn"]) {
    const g = poseGrip(ix, spec, `aim${a}_${hand}`);
    if (g) out[`aim${a}_${hand}`] = g;
  }
  return out;
}

/** #226 point 2: the pose set of the worn outfit in `pose` has its fist cut out (manifest overlays.fist, the import does it for aim*). */
export function hasFist(ix, spec, pose) {
  if (!hasPose(ix, spec, pose)) return false;
  const body = BODY_ART[spec.hero.body] || spec.hero.body;
  const e = findEntry(ix, "layer", "set", `${setArtOf(ix, spec.items[spec.equipped.outfit], body)}.${pose}`, body, "front");
  return !!(e && e.overlays && e.overlays.fist);
}

/** True when the hero of `spec` can be drawn in `pose` (a pose set of the worn outfit with a grip, and the weapon in that pose if one is worn). */
export function hasPose(ix, spec, pose) {
  if (!pose || !spec || !spec.hero) return false;
  const { hero, equipped = {}, items = {} } = spec;
  const body = BODY_ART[hero.body] || hero.body;
  const outfit = equipped.outfit && items[equipped.outfit];
  if (!outfit) return false;
  const ps = findEntry(ix, "layer", "set", `${setArtOf(ix, outfit, body)}.${pose}`, body, "front");
  const wi = equipped.weapon ? items[equipped.weapon] : null;
  return !!(ps && ps.grip && (!wi || findEntry(ix, "layer", "weapon", `${wi.art || wi.id}.${pose}`, body, "front")));
}

/** #130: a set with its own cape (manifest back_hidden_sets, from anchors.json) hides a worn back item. */
export function backHidden(ix, outfitArt) {
  const list = (ix && ix.manifest && ix.manifest.back_hidden_sets) || [];
  return !!outfitArt && list.includes(String(outfitArt));
}

/** #130 addendum 5: default of manifest.cape.pose_map (which cut of a two-layer cape a pose of the worn set uses; "" = plain set). */
export const CAPE_POSE_MAP = { "": "vert", vert: "vert", angle: "vert", combat: "vert", raise: "raise", swing: "raise" };

/** #130 addendum 5: a cape layer cut on cloth_0 (entry.ref_head = [cx, top, chin] of that cloth_0 set) moved onto the head of the worn set:
 *  scaled by the head height, the width also by the style constant kx (manifest.cape.scale_by_style) around the head centre. */
export function placeOnHead(entry, head, kx = 1) {
  if (!entry || !Array.isArray(entry.ref_head) || !Array.isArray(head)) return entry;
  const [rcx, rtop, rchin] = entry.ref_head;
  const [cx, top, chin] = head;
  const s = rchin - rtop > 0 && chin - top > 0 ? (chin - top) / (rchin - rtop) : 1;
  return { ...entry, x: Math.round(cx + (entry.x - rcx) * s * kx), y: Math.round(top + (entry.y - rtop) * s), w: Math.round(entry.w * s * kx), h: Math.round(entry.h * s) };
}

/** #130 addendum 5: the two layers of a cape (back z 10, front piece z 52) for the worn set and pose; null = no two-layer art for it. */
export function capeEntries(ix, art, body, setEntry, outfitArt, pose) {
  const C = (ix && ix.manifest && ix.manifest.cape) || {};
  const lp = { ...CAPE_POSE_MAP, ...(C.pose_map || {}) }[pose || ""] || "vert";
  let id = `${art}.${lp}`;
  let back = findEntry(ix, "layer", "back", id, body, "front");
  if (!back && lp !== "vert") {
    id = `${art}.vert`;
    back = findEntry(ix, "layer", "back", id, body, "front");
  }
  if (!back) return null;
  const style = String(outfitArt || "").split("_")[0];
  const kx = Number((C.scale_by_style || {})[style]) || 1;
  const head = setEntry && setEntry.head;
  return { back: placeOnHead(back, head, kx), front: placeOnHead(findEntry(ix, "layer", "back_front", id, body, "front"), head, kx) };
}

/** #130: how far down (fraction of the layer height) a hair layer is cut away above the hat rim at canvas y `clipY`. */
export function clipTopFrac(entry, y, clipY) {
  if (clipY == null || !entry || !entry.h) return 0;
  return Math.max(0, Math.min(1, (clipY - y) / entry.h));
}

/** Sets mode: one picture per outfit (front only); weapon in the fist, offhand in the left hand. */
function buildSetLayers(ix, spec, plainSet, body, outfitId) {
  const { hero, equipped = {}, items = {}, appearance = {} } = spec;
  // pose set (the hand really grips a rod, the weapon is drawn UNDER the set) when it and the weapon art exist,
  // otherwise the addendum 5 set with the weapon in front and the cut-out fist over it
  const wi0 = equipped.weapon ? items[equipped.weapon] : null;
  const pose = hasPose(ix, spec, spec.pose) ? spec.pose : poseOfWeapon(wi0);        // spec.pose: a motion pose (raise / swing, #101 variant A) where its art exists
  const poseSet = findEntry(ix, "layer", "set", `${outfitId}.${pose}`, body, "front");
  const poseWeapon = wi0 ? findEntry(ix, "layer", "weapon", `${wi0.art || wi0.id}.${pose}`, body, "front") : null;
  const rodMode = !!(poseSet && poseSet.grip && (!wi0 || poseWeapon));
  const setEntry = rodMode ? poseSet : plainSet;
  const out = [];
  let n = 0;
  const add = (entry, file, slot, z, x, y, rot) => {
    if (!entry) return;
    out.push({ entry, file: file || entry.file, slot, z, n: n++, x: x == null ? entry.x : x, y: y == null ? entry.y : y, ...(rot ? { rot } : {}) });
  };
  const worn = (slot) => (equipped[slot] ? items[equipped[slot]] : null);
  const hands = setEntry.hands || {};
  // addendum 11 (#188): a pose set aligned by the figure (the archer aim*) has its head off the common spot by head_dx (measured by the
  // import): the hair, the ears and the hat follow it
  const hdx = rodMode && Number.isFinite(Number(setEntry.head_dx)) ? Number(setEntry.head_dx) : 0;
  const atHead = (entry) => (entry && hdx ? entry.x + hdx : null);
  const ov = setEntry.overlays || {};
  if (spec.fistOnly) {                                     // #226 point 2: only the fist of the pose (the hunt lays it over its own bow)
    if (rodMode && ov.fist) add(ov.fist, null, "fist", 100);
    return out;
  }
  // addendum 5 point 9: a weapon held at a slant (manifest hold_tilt, e.g. the bow): the set picture with the fist turned the same way
  const tiltW = rodMode && poseWeapon && poseWeapon.hold_tilt ? poseWeapon.hold_tilt : 0;
  const tiltSet = tiltW && setEntry.tilt ? setEntry.tilt[String(tiltW)] : null;
  const shownSet = tiltSet ? { ...setEntry, ...tiltSet } : setEntry;
  add(shownSet, null, "set", 20);
  // addendum 9 (#189): the quiver of the bow on the back - part of the weapon (its own art `layer:quiver:<weapon art>`), only while the weapon is held;
  // spec.quiver = the weapon art when the weapon itself is drawn elsewhere (the hunt scene draws its own bow)
  const quiverArt = spec.quiver || (wi0 ? wi0.art || wi0.id : null);
  const qe = quiverArt ? quiverEntry(ix, shownSet, body, rodMode ? (tiltSet ? `${pose}.tilt` : pose) : "plain", quiverArt) : null;
  if (qe) add(qe, null, "quiver", qe.z, qe.x, qe.y, qe.rot);
  const earsItem = worn("ears");
  const earsId = (earsItem && (earsItem.art || earsItem.id)) || (hero.body_options && hero.body_options.ears);
  if (earsId) {
    const ee = findEntry(ix, "layer", "ears", earsId, body, "front");
    if (ee) add(ee, variantFile(ee, "skin", hero.skin), "ears", 15, atHead(ee));
  }
  const back = worn("back");
  if (back && !backHidden(ix, outfitId)) {
    const cape = capeEntries(ix, back.art || back.id, body, setEntry, outfitId, rodMode ? pose : "");
    if (cape) {
      add(cape.back, null, "back", 10);
      add(cape.front, null, "back_front", 52);                  // hood over the shoulders, clasp: over the set, under the neck item and hair
    } else add(findEntry(ix, "layer", "back", back.art || back.id, body, "front"), null, "back", 10);
  }
  const headItem = worn("head");
  const headEntry = headItem ? findEntry(ix, "layer", "head", headItem.art || headItem.id, body, "front") : null;
  const hairItem = worn("hair");                           // a hairstyle bought in the shop wins over the one chosen at the start
  const hideHair = !!((headItem && headItem.hide_hair) || (headEntry && headEntry.hair === "hide") || (worn("outfit") && worn("outfit").hide_hair));   // hood / helmet sets can hide the hair
  const clipY = headEntry && headEntry.hair === "clip" && headEntry.hair_clip_y != null ? headEntry.hair_clip_y : null;   // #130: hair above the rim is cut
  const hairFromItems = !!appearance.hair_items;           // the start hairstyle is an item too: nothing worn = bald
  if ((hairItem || (hero.hair && !hairFromItems)) && !hideHair) {
    const style = (appearance.hair_styles || []).find((st) => st.id === hero.hair);
    const artId = hairItem ? hairItem.art || hairItem.id : (style && style.art) || hero.hair;
    for (const slot of ["hair_back", "hairfill", "hair", "hair_front"]) {      // hairfill: a patch under hairstyles that leave bare skin (only where the art check found it)
      const he = findEntry(ix, "layer", slot, artId, body, "front");
      if (he) {
        add(he, variantFile(he, "hair", hero.hair_color), slot, he.z == null ? (slot === "hairfill" ? 69 : 70) : he.z, atHead(he));
        if (clipY != null) out[out.length - 1].clipY = clipY;
      }
    }
  }
  const neck = worn("neck");
  if (neck) add(findEntry(ix, "layer", "neck", neck.art || neck.id, body, "front") || pendantEntry(ix, setEntry, neck), null, "neck", 55);
  if (headEntry) {
    // addendum 11 (#188): the brim at the sides of the head under the hair (import artlib/hat.py), the rest of the hat over it
    const hb = findEntry(ix, "layer", "head_back", headItem.art || headItem.id, body, "front");
    if (hb) add(hb, null, "head_back", hb.z == null ? 66 : hb.z, atHead(hb));
    add(headEntry, null, "head", 80, atHead(headEntry));
  }
  const wi = worn("weapon");
  const we = wi && (rodMode ? poseWeapon : findEntry(ix, "layer", "weapon", wi.art || wi.id, body, "front"));
  const two = !!(wi && isTwoHanded(wi, we));
  const oi = worn("offhand");
  const oe = oi && !two && findEntry(ix, "layer", "offhand", oi.art || oi.id, body, "front");
  if (oe && hands.lhand && oe.float && hands.lhand.point) {          // #121: levitating by the open palm, no fingers over it
    const [x, y] = floatPos(hands.lhand.point, oe.w, oe.h, oe.float);
    add(oe, null, "offhand", 90, Math.round(x), Math.round(y));
    out[out.length - 1].float = oe.float;
  } else if (oe && hands.lhand) {
    const L = hands.lhand;
    const p = oe.attach === "forearm" && L.forearm ? L.forearm : L.point;
    add(oe, null, "offhand", 90, Math.round(p[0] - oe.w / 2), Math.round(p[1] - oe.h / 2));
    if (oe.hand_overlay && ov.lhand) add(ov.lhand, null, "hand", 91);
  }
  if (rodMode && we && we.grip) {
    const G = poseSet.grip.point;
    // v1.9.2 UAT ("není vidět jílec"): a set with its rod band painted out (manifest weapon_front) would hide the handle below the fist:
    // the weapon goes over the set and the cut-out fist of the set (overlays.fist, the turned one for a slanted weapon) over the weapon
    const fistOv = setEntry.weapon_front ? (tiltSet ? tiltSet.fist : ov.fist) : null;
    add(we, null, "weapon", fistOv ? 22 : we.z == null ? 12 : we.z, Math.round(G[0] - we.grip[0]), Math.round(G[1] - we.grip[1]), tiltSet ? -tiltW : 0);
    if (fistOv) add(fistOv, null, "fist", 23);
    const wt = findEntry(ix, "layer", "weapon_top", `${wi0.art || wi0.id}.${pose}`, body, "front");   // guard + blade over the arm
    if (wt) add(wt, null, "weapon_top", wt.z == null ? 25 : wt.z, Math.round(G[0] - we.grip[0]), Math.round(G[1] - we.grip[1]), tiltSet ? -tiltW : 0);   // addendum 10: the bow string turns with the bow
  } else if (we && hands.fist && we.grip) {
    const F = hands.fist.point;
    add(we, null, "weapon", 95, Math.round(F[0] - we.grip[0]), Math.round(F[1] - we.grip[1]));
    if (ov.fist) add(ov.fist, null, "fist", 100);
  }
  out.sort((a, b) => a.z - b.z || a.n - b.n);
  return out;
}

/** #118: until the amulet has its own layer art, its item picture (assets/story, square) hangs on the chest of the set picture. Set entry `head` =
 *  [cx, top, chin y]; size and offsets are fractions of the head height: width w, top of the picture (the loop) dy below the chin, dx sideways.
 *  The numbers come from design/anchors.json `neck_pendant` (the import copies them into the manifest); these defaults are the same. */
export const NECK_PENDANT = { w: 0.5, dy: 0.42, dx: 0 };
export function pendantEntry(ix, setEntry, item) {
  if (!item || !item.picture || !setEntry || !Array.isArray(setEntry.head)) return null;
  const P = { ...NECK_PENDANT, ...((ix && ix.manifest && ix.manifest.neck_pendant) || {}) };
  const [cx, top, chin] = setEntry.head;
  const hh = chin - top;
  const w = Math.round(hh * P.w);
  return { file: `../${item.picture}`, w, h: w, x: Math.round(cx - w / 2 + P.dx * hh), y: Math.round(chin + P.dy * hh), z: 55, pendant: true };
}

/** Addendum 9 (#189): the quiver behind the body, the feathers over the hero's right shoulder (the left of the picture). One picture for both bodies
 *  (manifest item `layer:quiver:<weapon art>`, w x h px); placed by the head of the shown set picture (entry `head` = [cx, top, chin], like the
 *  amulet): `anchor` (fractions of the quiver picture) goes to (cx + dx * hh, chin + dy * hh), the width = w * hh, rot = degrees (CSS rotate,
 *  positive = clockwise). The numbers: design/anchors.json `quiver` (the import copies it into manifest.quiver) - these defaults, then per body
 *  (`boy` / `girl`), then per pose (`poses.<pose>`, `poses.<body>.<pose>`; pose = the set pose, `<pose>.tilt` for the slanted bow, `plain`).
 *  z 11: over the back cape (10), under the bow held behind the set (12) and the set itself (20). No picture or no head = no quiver. */
export const QUIVER_FIT = { w: 1.7, dx: -0.55, dy: 0.25, rot: 0, anchor: [0.36, 0.29], z: 11 };   // = design/anchors.json quiver
export function quiverFit(ix, body, pose) {
  const Q = (ix && ix.manifest && ix.manifest.quiver) || {};
  const pick = (o) => (o && typeof o === "object" ? Object.fromEntries(Object.entries(o).filter(([k]) => k in QUIVER_FIT)) : {});
  const poses = Q.poses || {};
  return { ...QUIVER_FIT, ...pick(Q), ...pick(Q[body]), ...pick(poses[pose]), ...pick(poses[`${body}.${pose}`]) };
}
export function quiverEntry(ix, setEntry, body, pose, art) {
  const e = findEntry(ix, "layer", "quiver", art, body, "front");
  if (!e || !setEntry || !Array.isArray(setEntry.head) || !(e.w > 0) || !(e.h > 0)) return null;
  const F = quiverFit(ix, body, pose);
  const [cx, top, chin] = setEntry.head;
  const hh = chin - top;
  const w = Math.round(F.w * hh), h = Math.round((e.h / e.w) * F.w * hh);
  const px = cx + F.dx * hh, py = chin + F.dy * hh;
  return { ...e, w, h, x: Math.round(px - F.anchor[0] * w), y: Math.round(py - F.anchor[1] * h), z: F.z, rot: Number(F.rot) || 0 };
}

/** Top-left corner of a levitating offhand item (#121) by the palm point; the same formula as tools/artlib/sets.py float_pos. */
export function floatPos(palm, w, h, fl) {
  return [palm[0] - w / 2 + (Number(fl.dx) || 0) * w, palm[1] - (Number(fl.lift) || 0) * h - h];
}

/** Hair and hats are fitted to the head of the SET pictures; on the base body (a hero without a set) the head is elsewhere and smaller:
 *  map the layer by the head boxes of the manifest (heads[body] = {set: {top, cx, w}, base: {top, cx, w}}). No mapping data = unchanged. */
export function mapToBaseHead(entry, heads, body) {
  const m = heads && heads[body];
  if (!m || !entry) return entry;
  const k = m.base.w / m.set.w;
  const out = { ...entry, x: Math.round(m.base.cx + (entry.x - m.set.cx) * k), y: Math.round(m.base.top + (entry.y - m.set.top) * k), w: Math.round(entry.w * k), h: Math.round(entry.h * k) };
  if (entry.hair_clip_y != null) out.hair_clip_y = Math.round(m.base.top + (entry.hair_clip_y - m.set.top) * k);   // #130
  return out;
}

function variantFile(entry, group, name) {
  const v = entry.variants && entry.variants[group];
  return (v && name && v[name]) || entry.file;
}

/** Ordered layer list for one hero and view. spec: {hero, equipped, items, appearance, classes}. */
export function buildLayers(ix, spec, view = "front", expression = "neutral") {
  const { hero, equipped = {}, items = {}, appearance = {}, classes = [] } = spec;
  const body = BODY_ART[hero.body] || hero.body;
  const out = [];
  let n = 0;
  const add = (entry, file, slot) => {
    if (!entry) return;
    const z = view === "back" && BACK_Z[slot] != null ? BACK_Z[slot] : entry.z == null ? 50 : entry.z;
    out.push({ entry, file: file || entry.file, slot, z, n: n++ });
  };
  const worn = Object.entries(equipped)
    .map(([slot, id]) => items[id])
    .filter(Boolean);
  const covered = new Set(worn.flatMap((i) => i.covers || []));
  let hideHair = worn.some((i) => i.hide_hair);

  const outfit = equipped.outfit && items[equipped.outfit];
  const setArt = outfit ? setArtOf(ix, outfit, body) : "";
  const setEntry = outfit && findEntry(ix, "layer", "set", setArt, body, "front");
  if (setEntry) return buildSetLayers(ix, spec, setEntry, body, setArt);

  const be = findEntry(ix, "body", "body", "base", body, view);
  if (!be) return out;
  add(be, variantFile(be, "skin", hero.skin), "body");

  if (view === "front") {
    const fe = findEntry(ix, "face", "face", expression, body, "front") || findEntry(ix, "face", "face", "neutral", body, "front");
    if (fe) add(fe, variantFile(fe, "skin", hero.skin), "face");
  }
  const cls = classes.find((c) => c.id === hero.class);
  const earsId = (hero.body_options && hero.body_options.ears) || (cls && cls.body_options && cls.body_options.ears);
  if (earsId) {
    const ee = findEntry(ix, "layer", "ears", earsId, body, view);
    if (ee) add(ee, variantFile(ee, "skin", hero.skin), "ears");
  }
  const heads = ix.hasSets && ix.manifest ? ix.manifest.heads : null;       // sets mode: hair and hats are fitted to the set head, the base body has another
  let headClip = null;
  for (const item of worn) {
    if (covered.has(item.slot) || item.slot === "outfit") continue;
    if (heads && item.slot === "hair") continue;                              // drawn below, mapped to the base head
    let e = findEntry(ix, "layer", item.slot, item.art || item.id, body, viewOfSlot(item.slot, view));
    if (heads && (item.slot === "head" || item.slot === "back")) e = mapToBaseHead(e, heads, body);   // #130: capes are fitted to the set head too
    if (item.slot === "head" && e && e.hair === "hide") hideHair = true;
    if (item.slot === "head" && e && e.hair === "clip" && e.hair_clip_y != null) headClip = e.hair_clip_y;
    add(e, null, item.slot);
    if (item.slot === "torso") {
      // skin patch under the torso layer: shows through the neckline hole instead of the grey undershirt
      const nf = findEntry(ix, "layer", "neckfill", item.art || item.id, body, view);
      if (nf) add(nf, variantFile(nf, "skin", hero.skin), "neckfill");
    }
  }
  const hairItem = heads && equipped.hair ? items[equipped.hair] : null;
  if (!hideHair && (hairItem || (hero.hair && !(heads && appearance.hair_items)))) {
    const style = (appearance.hair_styles || []).find((s) => s.id === hero.hair);
    const artId = hairItem ? hairItem.art || hairItem.id : (style && style.art) || hero.hair;
    for (const slot of ["hair_back", "hairfill", "hair", "hair_front"]) {
      const he = mapToBaseHead(findEntry(ix, "layer", slot, artId, body, view), heads, body);
      if (he) {
        add(he, variantFile(he, "hair", hero.hair_color), slot);
        if (headClip != null && view === "front") out[out.length - 1].clipY = headClip;
      }
    }
  }
  out.sort((a, b) => a.z - b.z || a.n - b.n);
  return out;
}

/** Hair styles of the catalog that have art for this body in both views. */
export function availableHairStyles(ix, styles, bodyType) {
  const body = BODY_ART[bodyType] || bodyType;
  return styles.filter((s) => {
    const id = s.art || s.id;
    return (ix.hasSets ? ["front"] : ["front", "back"]).every((v) => ["hair", "hair_back", "hair_front"].some((slot) => findEntry(ix, "layer", slot, id, body, v)));
  });
}

export function thumbPath(item) {
  return `thumbs/${ART_SLOT[item.slot] || item.slot}_${item.art || item.id}.webp`;
}

export async function loadArtManifest(base) {
  const r = await fetch(`${base}/art/manifest.json?v=${Date.now()}`, { cache: "no-cache" });
  if (!r.ok) throw new Error(`art manifest HTTP ${r.status}`);
  return indexManifest(await r.json());
}

/* ----------------------------------------------------------------- renderer -- */

const pct = (v) => `${((v / CANVAS) * 100).toFixed(3)}%`;

export class IllustratedStage {
  constructor(base, ix) {
    this.illustrated = true;
    this.base = base;
    this.ix = ix;
    const tokens = (ix.manifest && ix.manifest.tokens) || {};
    // same shape the LPC stage exposes, so the onboarding swatches work unchanged
    const pal = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([k, c]) => [k, [c, c, c, c]]));
    this.manifest = { palettes: { body: { variants: pal(tokens.skins) }, hair: { variants: pal(tokens.hair_colors) } } };
    this.entries = new Map();
    this._used = new Set();
    this._preloaded = new Set();
  }

  destroy() {
    for (const e of this.entries.values()) clearTimeout(e.timer);
    this.entries.clear();
  }

  begin(scope) {
    this._scope = scope;
    this._used = new Set();
  }

  end() {
    for (const k of [...this.entries.keys()]) {
      if (k.startsWith(this._scope + ":") && !this._used.has(k)) this.entries.delete(k);
    }
  }

  /** The manifest's `updated` is in the URL: a new revision of a picture keeps its file name, the cache must not show the old one. */
  url(file) {
    const v = this.ix && this.ix.version;
    return `${this.base}/art/${file}${v ? `?v=${v}` : ""}`;
  }

  preload(files) {
    for (const f of files) {
      if (this._preloaded.has(f)) continue;
      this._preloaded.add(f);
      const im = new Image();
      im.src = this.url(f);
    }
  }

  supports(item, body) {
    return supportsItem(this.ix, item, body);
  }

  hairStyles(styles, bodyType) {
    return availableHairStyles(this.ix, styles, bodyType);
  }

  _layerEls(spec, view, expression) {
    const layers = buildLayers(this.ix, spec, view, expression);
    this._feetY = feetY(layers);
    return layers.map((l) => {
      const e = l.entry;
      const img = document.createElement("img");
      img.className = `hq-l slot-${l.slot}`;
      img.alt = "";
      img.draggable = false;
      img.src = this.url(l.file);
      img.style.cssText = `left:${pct(l.x == null ? e.x : l.x)};top:${pct(l.y == null ? e.y : l.y)};width:${pct(e.w)};height:${pct(e.h)};`;
      const cut = clipTopFrac(e, l.y == null ? e.y : l.y, l.clipY);            // #130: hair under a hat, cut above the rim
      if (cut > 0) img.style.clipPath = `inset(${(cut * 100).toFixed(2)}% 0 0 0)`;
      if (e.grip && (l.slot === "weapon" || l.slot === "weapon_top")) img.style.transformOrigin = `${((e.grip[0] / e.w) * 100).toFixed(1)}% ${((e.grip[1] / e.h) * 100).toFixed(1)}%`;
      if (l.rot) img.style.rotate = `${l.rot}deg`;                         // addendum 5 point 9: the slanted bow (CSS rotate: positive = clockwise), about the grip
      img.dataset.slot = l.slot;
      if (l.float) return floatEl(img, l.float);
      return img;
    });
  }

  _petEl(spec, view) {
    const pet = spec.hero && spec.hero.pet;
    if (!pet) return null;
    const e = findEntry(this.ix, "pet", null, pet, null, view);
    if (!e) return null;
    const img = document.createElement("img");
    img.className = "hq-pet";
    img.src = this.url(e.file);
    img.alt = "";
    return img;
  }

  /** Animated hero. spec: {hero, equipped, items, appearance, classes, scale, crop, view, expression} */
  hero(name, spec) {
    const k = `${this._scope}:${name}`;
    this._used.add(k);
    const view = spec.view || "front";
    const expression = spec.expression || "neutral";
    let e = this.entries.get(k);
    const sig = JSON.stringify([spec.hero, spec.equipped, expression, spec.pose || null, spec.quiver || null]);
    if (!e) {
      const root = document.createElement("div");
      root.className = "hq-hero";
      root.dataset.view = view;
      const fig = document.createElement("div");
      fig.className = "hq-fig";
      const shadow = document.createElement("div");
      shadow.className = "hq-shadow";
      const layers = document.createElement("div");
      layers.className = "hq-layers";
      fig.append(shadow, layers);
      root.append(fig);
      e = { root, fig, layers, shadow, view: null, sig: null, timer: null, crop: null, size: null };
      this.entries.set(k, e);
      root.style.setProperty("--delay", `${-(Math.random() * 4).toFixed(2)}s`);
    }
    this._applySize(e, spec);
    const viewChanged = e.view !== null && e.view !== view;
    if (viewChanged) {
      // turn: squash, swap the layer set at the midpoint, expand again
      clearTimeout(e.timer);
      e.root.classList.remove("turning");
      void e.root.offsetWidth;
      e.root.classList.add("turning");
      e.view = view;
      e.sig = sig;
      e.timer = setTimeout(() => {
        this._fill(e, spec, view, expression);
        e.root.dataset.view = view;
      }, 170);
      e.timerEnd = setTimeout(() => e.root.classList.remove("turning"), 380);
    } else if (e.sig !== sig || e.view === null) {
      e.view = view;
      e.sig = sig;
      this._fill(e, spec, view, expression);
      e.root.dataset.view = view;
    }
    return e.root;
  }

  _fill(e, spec, view, expression) {
    const els = this._layerEls(spec, view, expression);
    e.shadow.style.top = this._feetY ? `${((this._feetY / CANVAS) * 100 - 4).toFixed(2)}%` : "";   // v1.9.1: under the real soles (the boy's poses reach y ~1080)
    const pet = this._petEl(spec, view);
    e.layers.replaceChildren(...els);
    e.root.querySelectorAll(".hq-pet").forEach((p) => p.remove());
    if (pet) e.root.append(pet);
    this.preload([...buildLayers(this.ix, spec, view === "front" ? "back" : "front", expression).map((l) => l.file)]);
  }

  _applySize(e, spec) {
    const crop = spec.cropBox || (spec.crop ? (this.ix.hasSets && spec.equipped && spec.equipped.outfit ? PORTRAIT_SETS : PORTRAIT) : null);   // cropBox: an own box (#185 add. 5: the bust with a hat)
    const size = `${spec.scale || 4}|${crop ? [crop.x, crop.y, crop.w, crop.h].join(",") : 0}`;
    if (e.size === size) return;
    e.size = size;
    const r = e.root;
    r.classList.toggle("portrait", !!crop);
    if (crop) {
      r.style.aspectRatio = `${crop.w} / ${crop.h}`;
      e.fig.style.cssText = `left:${(-(crop.x / crop.w) * 100).toFixed(2)}%;top:${(-(crop.y / crop.h) * 100).toFixed(2)}%;width:${((CANVAS / crop.w) * 100).toFixed(2)}%;height:${((CANVAS / crop.h) * 100).toFixed(2)}%;`;
    } else {
      r.style.aspectRatio = "1 / 1";
      e.fig.style.cssText = "left:0;top:0;width:100%;height:100%;";
    }
  }

  /** Item thumbnail <img> (icon_<id> when present, else the thumbnail made at import). */
  thumb(item, body, items, size = 56) {
    const img = document.createElement("img");
    img.className = "thumb";
    img.width = img.height = size;
    img.alt = item.name;
    img.draggable = false;
    const icon = item.icon && findEntry(this.ix, "icon", null, item.icon, null, null);
    img.src = item.picture ? `${this.base}/${item.picture}` : this.url(icon ? (item.slot === "hair_dye" ? variantFile(icon, "dye", item.color) : icon.file) : thumbPath(item));
    // addendum 12: a set only in poses (hunter_1) may lack its own thumbnail (art imported before the fix) -> its vert pose;
    // nothing at all = an empty spot (thumb-missing hides it), never the browser's broken "?" picture
    const alt = !item.picture && !icon && item.slot === "outfit" ? this.url(thumbPath(item).replace(/\.webp$/, ".vert.webp")) : null;
    img.onerror = () => {
      if (alt && img.dataset.alt !== "1") { img.dataset.alt = "1"; img.src = alt; return; }
      img.classList.add("thumb-missing");
    };
    return img;
  }
}

/** v1.9.1: the lowest point of the figure (the set, else the body) in canvas px, or null; the shadow sits there. */
export function feetY(layers) {
  let y = null;
  for (const l of layers) {
    if (l.slot !== "set" && l.slot !== "body" && l.slot !== "feet") continue;
    const b = (l.y == null ? l.entry.y : l.y) + l.entry.h;
    if (y == null || b > y) y = b;
  }
  return y;
}

/** #121: the levitating item = a box at the layer's place (the <img> fills it) with a soft halo behind; CSS floats the box.
 *  The halo is a radial gradient, not a filter: cheap to animate on old iPhones. */
function floatEl(img, fl) {
  const box = document.createElement("div");
  box.className = "hq-l hq-float slot-offhand";
  box.dataset.slot = "offhand";
  box.style.cssText = img.style.cssText;
  img.style.cssText = "";
  img.className = "hq-float-img";
  const n = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  box.style.setProperty("--tilt", `${n(fl.tilt, 0)}deg`);
  box.style.setProperty("--bob", `${(-n(fl.bob, 0.05) * 100).toFixed(1)}%`);
  box.style.setProperty("--period", `${n(fl.period, 2.8)}s`);
  if (fl.glow) {
    const halo = document.createElement("div");
    halo.className = "hq-float-glow";
    halo.style.setProperty("--glow", `var(--hq-${String(fl.glow).replace(/[^a-z0-9-]/gi, "")}, #E8B33A)`);
    box.append(halo);
  }
  box.append(img);
  return box;
}

/* --------------------------------------------------------------------- css -- */

export const ART_CSS = `
.hq-hero { position: relative; display: block; margin: 0 auto; max-width: 100%; overflow: visible; user-select: none; -webkit-user-select: none; touch-action: manipulation; }
.hq-hero.portrait { overflow: hidden; }
.hq-fig { position: absolute; }
.hq-layers { position: absolute; inset: 0; transform-origin: 50% 94%; animation: hq-breathe 4.2s ease-in-out infinite; animation-delay: var(--delay, 0s); }
.hq-shadow { position: absolute; left: 30%; width: 40%; top: 91.5%; height: 5%; border-radius: 50%; background: radial-gradient(ellipse at center, #0007 0%, #0000 70%); }
.hq-l { position: absolute; display: block; pointer-events: none; -webkit-user-drag: none; }
.hq-l.slot-hair, .hq-l.slot-hair_back, .hq-l.slot-hair_front, .hq-l.slot-hairfill { transform-origin: 50% 8%; animation: hq-sway 5.5s ease-in-out infinite; animation-delay: var(--delay, 0s); }
.hq-l.slot-back { transform-origin: 50% 4%; animation: hq-sway 6.5s ease-in-out infinite reverse; animation-delay: var(--delay, 0s); }
.hq-l.slot-weapon, .hq-l.slot-weapon_top, .hq-l.slot-offhand { animation: hq-weapon 3.8s ease-in-out infinite; animation-delay: var(--delay, 0s); }
.hq-l.hq-float { transform-origin: 50% 100%; transform: rotate(var(--tilt, 0deg)); animation: hq-float var(--period, 2.8s) ease-in-out infinite; animation-delay: var(--delay, 0s); will-change: transform; }
.hq-float-img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.hq-float-glow { position: absolute; inset: -14% -18%; border-radius: 50%; background: radial-gradient(closest-side, var(--glow), transparent); opacity: 0.45; }
.hq-pet { position: absolute; right: -14%; bottom: 0; width: 30%; animation: hq-bob 2.4s ease-in-out infinite; }
.hq-hero.turning .hq-fig { animation: hq-turn 0.38s ease-in-out; }
@keyframes hq-breathe { 0%, 100% { transform: translateY(0) scale(1, 1); } 50% { transform: translateY(-0.45%) scale(1.004, 1.012); } }
@keyframes hq-sway { 0%, 100% { transform: rotate(-0.9deg); } 50% { transform: rotate(0.9deg); } }
@keyframes hq-weapon { 0%, 100% { transform: rotate(-2.5deg); } 50% { transform: rotate(2.5deg); } }
@keyframes hq-float { 0%, 100% { transform: rotate(var(--tilt, 0deg)) translateY(0); } 50% { transform: rotate(var(--tilt, 0deg)) translateY(var(--bob, -5%)); } }
@keyframes hq-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6%); } }
@keyframes hq-turn { 0% { transform: scaleX(1); } 50% { transform: scaleX(0.04); } 100% { transform: scaleX(1); } }
@media (prefers-reduced-motion: reduce) {
  .hq-layers, .hq-l, .hq-pet, .hq-hero.turning .hq-fig { animation: none !important; }
}
`;
