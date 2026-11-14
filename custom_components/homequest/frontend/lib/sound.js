/* Game sounds (Web Audio). Short clips for the actions of the game, one switch for the whole game (header icon), a random praise of the mother
 * when a reward is paid. Everything is local (sounds/*.mp3, no CDN). The clips and the action -> file map live in sounds/ (see tools/build_sounds.py);
 * which variant an action uses is sounds/map.json ({action: "a"|"b"|"c"}, chosen in the sound lab), praise files are listed in sounds/praise.json.
 *
 * iPhone: a sound may only start after a tap, so the first pointer event unlocks the AudioContext (`unlock`). Where Safari has
 * navigator.audioSession, the type is set so that the sound is heard with the silent switch on and music keeps playing (see `applySession`). */

const LS_KEY = "homequest.sound";
export const SOUNDS_BASE = new URL("../sounds/", import.meta.url).href;

/** Which action plays which file: map = {action: "a"|"b"|"c"} (default "a"), returns "<action>_<variant>.mp3". */
export function soundFile(action, map) {
  const v = map && /^[abc]$/.test(map[action] || "") ? map[action] : "a";
  return `${action}_${v}.mp3`;
}

/** Random element of list that differs from `last` (when the list has more than one); null for an empty list. */
export function pickNext(list, last, rnd = Math.random) {
  if (!list || !list.length) return null;
  const pool = list.length > 1 ? list.filter((x) => x !== last) : list;
  return pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))];
}

/** Today's daily tasks of a kid are all approved (same selection as the Quests tab: the server's day plan; without a plan the not archived ones). */
export function dailyAllDone(view, kidId) {
  const kid = view && view.kids && view.kids[kidId];
  if (!kid) return false;
  const info = view.tasks_info || {};
  const plan = info.day_plan ? new Set(info.day_plan) : null;
  const tasks = ((view.catalog && view.catalog.tasks) || []).filter((t) => t.period === "daily" && (plan ? plan.has(t.id) : !t.archived) && kid.tasks[t.id]);
  return tasks.length > 0 && tasks.every((t) => kid.tasks[t.id].status === "approved");
}

/** Approved tasks of a kid as "task|period" keys (the reward is paid for them). */
export function approvedKeys(view, kidId) {
  const kid = view && view.kids && view.kids[kidId];
  return kid ? Object.entries(kid.tasks).filter(([, t]) => t.status === "approved").map(([id, t]) => `${id}|${t.period_key}`).sort() : [];
}

/** Rewards the child has not seen yet on this device: `seen` = the list stored last time (null = the first start on this device: nothing is new). */
export function newRewards(seen, now) {
  if (!Array.isArray(seen)) return [];
  const had = new Set(seen);
  return now.filter((k) => !had.has(k));
}

const SEEN_KEY = (kid) => `homequest.rewards.${kid}`;

/** Remember what the child has seen; returns the keys that are new since the last time (the reward sound is owed for them). */
export function rewardsSince(storage, kidId, now) {
  let seen = null;
  try {
    seen = JSON.parse(storage.getItem(SEEN_KEY(kidId)) || "null");
  } catch (e) {
    seen = null;
  }
  const fresh = newRewards(seen, now);
  try {
    storage.setItem(SEEN_KEY(kidId), JSON.stringify(now));
  } catch (e) {
    /* ignore */
  }
  return fresh;
}

/** Persisted switch (per device): default on. Never throws (private mode, blocked storage). */
export function readEnabled(storage) {
  try {
    return storage.getItem(LS_KEY) !== "0";
  } catch (e) {
    return true;
  }
}

export function writeEnabled(storage, on) {
  try {
    storage.setItem(LS_KEY, on ? "1" : "0");
  } catch (e) {
    /* ignore */
  }
}

/** Session type that works for short UI sounds: "playback" is heard with the silent switch on (it may pause music on some versions), "ambient"
 *  mixes with music but follows the switch. Which one is used is a decision for the phones, see the sound lab (diagnostics). */
export const DEFAULT_SESSION = "playback";

/** The sounds are part of the game only on the TEST instance until the parent has chosen them and a release switches this on
 *  (then also sounds/map.json must hold the choice and the chosen mp3 files must be in the release). */
export const SOUND_IN_PROD = false;

export class SoundBank {
  constructor({ storage = globalThis.localStorage, fetchImpl = (...a) => fetch(...a), AudioContextImpl = globalThis.AudioContext || globalThis.webkitAudioContext, base = SOUNDS_BASE, rnd = Math.random } = {}) {
    this.storage = storage;
    this.fetch = fetchImpl;
    this.Ctx = AudioContextImpl;
    this.base = base;
    this.rnd = rnd;
    this.enabled = readEnabled(storage);
    this.ctx = null;
    this.buffers = new Map();
    this.map = null;
    this.praise = [];
    this._lastPraise = null;
    this._ready = null;
    this.session = DEFAULT_SESSION;
    this.listeners = new Set();
    this._deferred = null;
    this.available = SOUND_IN_PROD;      // set by the panel (test instance / release)
  }

  /** The choice of the sound lab (test instance): replaces the variants of sounds/map.json. */
  setMap(map) {
    this.map = { ...(this.map || {}), ...(map || {}) };
    this._overrideMap = map || {};
  }

  /** A sound owed to the child that cannot start now (the game was just opened, no tap yet): it plays at the first tap. */
  defer(action) {
    this._deferred = action;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setEnabled(on) {
    this.enabled = !!on;
    writeEnabled(this.storage, this.enabled);
    this.listeners.forEach((fn) => fn(this.enabled));
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  /** Call from a tap handler (the first one unlocks the audio on iOS). Safe to call repeatedly. */
  unlock() {
    if (!this.Ctx) return;
    try {
      this.applySession();
      if (!this.ctx) this.ctx = new this.Ctx();
      if (this.ctx.state === "suspended") this.ctx.resume();
    } catch (e) {
      /* no audio, the game stays silent */
    }
    if (!this._ready) this._ready = this._loadLists();
    if (this._deferred) {
      const action = this._deferred;
      this._deferred = null;
      setTimeout(() => (action === "reward" ? this.reward() : this.play(action)), 200);
    }
  }

  applySession(type = this.session) {
    this.session = type;
    try {
      if (globalThis.navigator && navigator.audioSession) navigator.audioSession.type = type;
    } catch (e) {
      /* not supported in this version */
    }
  }

  async _loadLists() {
    const get = async (name, fallback) => {
      try {
        const r = await this.fetch(`${this.base}${name}`, { cache: "no-cache" });
        return r.ok ? await r.json() : fallback;
      } catch (e) {
        return fallback;
      }
    };
    this.map = { ...(await get("map.json", {})), ...(this._overrideMap || {}) };
    this.praise = (await get("praise.json", { files: [] })).files || [];
    for (const a of Object.keys(this.map)) this._load(soundFile(a, this.map));   // pre-load the chosen files (delay on the first tap)
  }

  async _load(file) {
    if (this.buffers.has(file)) return this.buffers.get(file);
    const p = (async () => {
      try {
        const r = await this.fetch(`${this.base}${file}`);
        if (!r.ok || !this.ctx) return null;
        return await this.ctx.decodeAudioData(await r.arrayBuffer());
      } catch (e) {
        return null;
      }
    })();
    this.buffers.set(file, p);
    return p;
  }

  async _start(file, opts = {}) {
    if (!this.ctx) return false;
    const buf = await this._load(file);
    if (!buf) {
      this.buffers.delete(file);        // a failed load may be retried later
      return false;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const gain = this.ctx.createGain();
    gain.gain.value = opts.volume == null ? 1 : opts.volume;
    src.connect(gain).connect(this.ctx.destination);
    src.start(opts.delay ? this.ctx.currentTime + opts.delay : 0);
    return true;
  }

  /** Play the sound of an action (nothing when the sound is off or not unlocked yet). */
  async play(action) {
    if (!this.available || !this.enabled || !this.ctx) return false;
    if (!this.map) await this._ready;
    return this._start(soundFile(action, this.map));
  }

  /** The reward sound and, a moment later, one random praise (never the same twice in a row). */
  async reward() {
    const ok = await this.play("reward");
    const file = pickNext(this.praise, this._lastPraise, this.rnd);
    if (this.available && this.enabled && this.ctx && file) {
      this._lastPraise = file;
      this._start(`praise/${file}`, { delay: 0.55 });
    }
    return ok;
  }

  /** Sound lab: play a file regardless of the switch and the map. */
  async preview(file) {
    this.unlock();
    return this._start(file);
  }
}
