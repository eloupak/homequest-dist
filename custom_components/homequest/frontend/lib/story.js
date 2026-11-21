/* Story helpers (pure, tested in node): which kid has seen the intro (per device, in the browser; the key has a number: a new start of the game = a new number, the intro comes again) and when it starts by itself. */

export const introKey = (kidId) => `homequest.intro2.${kidId}`;

/** storage = window.localStorage (or a stub); every access is guarded, a blocked storage just means "not seen". */
export function introSeen(storage, kidId) {
  try {
    return storage.getItem(introKey(kidId)) === "1";
  } catch (e) {
    return false;
  }
}

/** What the server knows the child has seen (kid.seen, v1.4.0: on every device; localStorage stays a cache): {intro, stage}. */
export function serverSeen(kid) {
  const s = (kid && kid.seen) || {};
  return { intro: !!s.intro, stage: Number.isFinite(Number(s.stage)) ? Number(s.stage) : 0 };
}

export function markIntroSeen(storage, kidId) {
  try {
    storage.setItem(introKey(kidId), "1");
  } catch (e) {
    /* private mode: the intro will show again next time */
  }
}

/** The intro starts by itself for a child (not for the parent account) who has a hero, when a story exists and it was not seen on this device. */
export function shouldAutoIntro({ story, isAdmin, hasHero, seen }) {
  return !!(story && story.intro && story.intro.text && story.intro.text.length && !isAdmin && hasHero && !seen);
}

/** Pages of the intro dialog: one paragraph each; the last page ends the intro. */
export function introPages(story, vars = {}) {
  const t = story.intro.text;
  return t.map((text, i) => ({ text: fillText(text, vars), last: i === t.length - 1, index: i, of: t.length }));
}

/** {name} placeholders of a story text; an unknown one stays as it is. */
export function fillText(text, vars = {}) {
  return String(text).replace(/\{([a-z_]+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
}

/** What the intro says about the child: {jmeno} = the hero's name, {jeden} = "jeden" for a boy, "jedna" for a girl. */
export function introVars(hero) {
  return { jmeno: (hero && hero.name) || "", jeden: hero && hero.body === "female" ? "jedna" : "jeden" };
}

/** A cast member by id (or null). */
export function castMember(story, id) {
  return (story && story.cast.find((c) => c.id === id)) || null;
}

/** Picture files under assets/story/ (not in the art manifest: the set pipeline does not know them). */
export const npcUrl = (assets, member) => `${assets}/story/npc_${member.art}.webp`;
export const bgUrl = (assets, stageId) => `${assets}/story/bg_${stageId}.webp`;
/** The Defender's amulet in a colour (#118): assets/story/<item>_<colour>.webp (tools/amulet_colors.py). */
export const amuletUrl = (assets, item, color) => `${assets}/story/${item}_${color}.webp`;

/** Where the fortress is: the highest stage whose task count is reached, and the way to the next one. done = completed tasks of both children. */
export function stageAt(story, done) {
  const stages = (story && story.fortress && story.fortress.stages) || [];
  if (!stages.length) return null;
  let index = 0;
  stages.forEach((s, i) => { if (done >= s.tasks) index = i; });
  const stage = stages[index];
  const next = stages[index + 1] || null;
  const span = next ? next.tasks - stage.tasks : 0;
  const into = next ? done - stage.tasks : 0;
  return { index, stage, next, done, into, span, pct: next ? Math.round((into / span) * 100) : 100, label: next ? `Tvrz: ${done} / ${next.tasks}` : `Tvrz: ${done} – hotovo` };
}

/** Stage ids to try for a picture, the wanted one first, then the previous ones (a missing picture keeps the previous background). */
export function bgChain(story, stageId) {
  const stages = (story && story.fortress && story.fortress.stages) || [];
  const i = stages.findIndex((s) => s.id === stageId);
  if (i < 0) return [stageId];
  return stages.slice(0, i + 1).reverse().map((s) => s.background);
}

/** The picture stage of the story screens. which: "intro", a chapter id, or anything else = the first chapter. The background is the stage
 *  of the fortress (the intro: its own, normally stage 0); the giver stands where the stage says unless the scene has its own giver_pos. */
export function sceneOf(story, which, done = 0) {
  const src = which === "intro" ? story.intro : story.chapters.find((c) => c.id === which) || story.chapters[0];
  if (!src) return null;
  const stages = (story.fortress && story.fortress.stages) || [];
  const cur = stageAt(story, done);
  const stageId = src.background || (which === "intro" ? (stages[0] && stages[0].id) : cur && cur.stage.id) || "";
  const stage = stages.find((s) => s.id === stageId) || null;
  return { giver: castMember(story, src.giver), background: stageId, chain: bgChain(story, stageId), pos: src.giver_pos || (stage && stage.giver_pos) || { x: 50, y: 80, h: 34 }, source: src };
}

/** CSS variables of the giver in the scene (% of the scene picture; the figure is square, so width = height in the picture's own units). */
export function giverVars(pos, from = "right", aspect = 2 / 3) {
  const wPct = pos.h / aspect; // the square figure is h% of the height, so its width in % of the picture width is h / aspect
  const dir = from === "right" ? 1 : -1;
  // how far (in widths of the figure) it starts from its place so that it is outside the picture: the distance to the edge plus one width
  const edge = dir > 0 ? 100 - pos.x : pos.x;
  const start = dir * ((edge / wPct) * 100 + 70);
  return `--gx:${pos.x}%;--gy:${pos.y}%;--gh:${pos.h}%;--gw:${wPct.toFixed(2)}%;--gstart:${start.toFixed(0)}%`;
}

/* ---- fortress progress: the celebration of a reached stage (once per child per device) and the "+1" of the bar */

export const stageKey = (kidId) => `homequest.stage2.${kidId}`;

/** Index of the last stage the child has seen celebrated on this device (0 when none, or the storage is blocked). */
export function stageSeen(storage, kidId) {
  try {
    const n = Number(storage.getItem(stageKey(kidId)));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch (e) {
    return 0;
  }
}

export function markStageSeen(storage, kidId, index) {
  try {
    storage.setItem(stageKey(kidId), String(index));
  } catch (e) {
    /* private mode: it may be celebrated again */
  }
}

/** The stage the celebration starts by itself for (a child, not the parent account), or null. A stage with a gift (stage.gives) is played until
 *  the server has paid it (kid.gifts: so it also stays quiet on a second device, and a child who saw the old text-only announcement still gets it);
 *  any other stage once, when it is higher than the last one seen on this device. A stage needs a scene or an announcement to be played. */
export function stageToCelebrate({ story, isAdmin, done, seen, gifts = [], picks = {} }) {
  const at = stageAt(story, done);
  if (!at || isAdmin) return null;
  const stages = story.fortress.stages;
  const playable = (s) => (s.scene && s.scene.length) || (s.announce && s.announce.length);
  for (let i = 1; i <= at.index; i++) {
    if (stages[i].gives && playable(stages[i]) && !gifts.includes(stages[i].id)) return { ...stageAt(story, stages[i].tasks), done };
    // #185 addendum 4: paid, but the choice of the gift (the hat) is missing -> only the choice, no scene again
    if (stages[i].gives && stages[i].gives.choose && gifts.includes(stages[i].id) && !(picks || {})[stages[i].id]) return { ...stageAt(story, stages[i].tasks), done, pickOnly: true };
  }
  if (at.index > seen && !at.stage.gives && !at.stage.siege && playable(at.stage)) return at;     // a siege stage plays its scene in the siege (views/siege.js)
  return null;
}

/** Names the stage texts speak to: {deti} = the children (not the heroes) in the vocative, as the parent typed it (Settings -> Děti, v1.6 #136;
 *  Czech has no reliable rule); a child without one is called by the plain name. Whoever plays, all are spoken to ("Karle, Aničko"). */
export function vocative(kid) {
  return (kid && (kid.vocative || kid.name)) || "";
}
export function stageVars(cat) {
  const names = (cat.kids || []).map(vocative).filter(Boolean);
  return { deti: names.join(", ") };
}

/** How many completed tasks the bar gained since it was last drawn (0 for the first draw or when nothing changed). */
export function barGain(prev, now) {
  return prev == null || now <= prev ? 0 : now - prev;
}

/** The "play again" buttons of the Quest tab, in the order of the story (the intro first). The labels come from story.yaml (`replay_label` of the
 *  intro and of a stage), so a new stage or chapter gets its button by data only. A stage button appears once the stage is reached and the child
 *  has lived the scene: its gift is paid (kid.gifts, true on every device of the child) or, without a gift, the scene was seen on this device
 *  (seen = index of the last seen stage). The parent sees every reached one. */
export function replayList({ story, done, gifts = [], seen = 0, isAdmin = false, scenes = [], trophies = [], siege = null }) {
  const out = [];
  if (!story || !story.intro) return out;
  out.push({ kind: "intro", label: story.intro.replay_label || "Začátek příběhu" });
  const stages = (story.fortress && story.fortress.stages) || [];
  stages.forEach((s, i) => {
    const playable = (s.scene && s.scene.length) || (s.announce && s.announce.length);
    if (i < 1 || !s.replay_label || !playable || done < s.tasks) return;
    const lived = s.gives ? gifts.includes(s.id) : s.siege ? scenes.includes(s.id) : seen >= i;
    if (isAdmin || lived) out.push({ kind: "stage", index: i, id: s.id, label: s.replay_label });
    // the end of a won siege (the castellan's thanks and the amulets to look at): once the child has its amulet
    const won = siege && siege.stage === s.id && siege.won_at;
    if (s.siege && s.siege.won_label && won && (isAdmin || trophies.some((t) => t.stage === s.id))) out.push({ kind: "siege-won", index: i, id: s.id, label: s.siege.won_label });
    // back into the battle (#118): the attack this child left with the cross, or after the win a replay only as a game; not for the parent's own panel
    const open = siege && siege.stage === s.id && (siege.active || siege.won_at);
    if (s.siege && s.siege.battle_label && open && !isAdmin && scenes.includes(s.id)) out.push({ kind: "siege-battle", index: i, id: s.id, label: s.siege.battle_label });
  });
  return out;
}
