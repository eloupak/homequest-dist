/* HomeQuest panel — root web component. Kids' chore game inside Home Assistant.
 * Plain ES modules, Shadow DOM, no build step. All rules live in the Python backend; this file
 * only displays state and calls homequest/* websocket commands. */

import { headerName } from "./lib/headname.js";
import { Api } from "./lib/api.js";
import { coin, h, icon } from "./lib/dom.js";
import { errText } from "./lib/cs.js";
import { SOUND_IN_PROD, SoundBank, approvedKeys, dailyAllDone, rewardsSince } from "./lib/sound.js";
import { ART_CSS, IllustratedStage, loadArtManifest } from "./lib/layers.js";
import { CSS } from "./styles.js";
import { renderHero } from "./views/hero.js";
import { renderInventory } from "./views/inventory.js";
import { renderParent } from "./views/parent.js";
import { renderNotStarted, renderSetup } from "./views/setup.js";
import { renderQuests } from "./views/quests.js";
import { pinSettings, renderPinPad } from "./views/pin.js";
import { bgExists, introDialog, renderQuest, stageDialog } from "./views/quest.js";
import { renderPrep, siegeMode, victoryFlow } from "./views/siege.js";
import { layoutReport, reportLines, viewportHeight } from "./lib/layout.js";
import { UPRIGHT_CSS, uprightGuard } from "./lib/upright.js";
import { barGain, introSeen, markIntroSeen, markStageSeen, serverSeen, shouldAutoIntro, stageAt, stageSeen, stageToCelebrate } from "./lib/story.js";

const ASSETS = "/homequest_assets";
const BASE = new URL(".", import.meta.url).href; // .../homequest_static/
const EXPRESSION_MS = 4000;
const LS = "homequest.ui";

const TABS = [
  { id: "quests", label: "Úkoly", icon: "mdi:format-list-checks" },
  { id: "hero", label: "Hrdina", icon: "mdi:sword-cross" },
  { id: "inv", label: "Inventář", icon: "mdi:bag-personal" },
  { id: "story", label: "Quest", icon: "mdi:castle", needsStory: true },
  { id: "parent", label: "Rodič", icon: "mdi:shield-account", admin: true },
];

/** Commands that have a sound of their own (task completion, rewards, quest stages and the error sound are triggered by the view changes, see _notifyChanges). */
const ACT_SOUND = { buy: "purchase", equip: "equip", unequip: "equip" };

class HomeQuestPanel extends HTMLElement {
  constructor() {
    super();
    this.view = null;
    this.tab = "quests";
    this.kidId = null;
    this._narrow = false;
    this.ui = { coins: {}, drafts: {}, invTab: "inv", slotFilter: "all", dirIndex: 0, view: "front", expr: "neutral", exprUntil: 0, histKid: null };
    this._sheet = null;
    this.sound = new SoundBank();                                 // game sounds (lib/sound.js): switch in the header, unlocked by the first tap
    const root = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS + ART_CSS + UPRIGHT_CSS;
    // design tokens (custom properties) live in the shadow root; @font-face must be in the document
    const tokens = document.createElement("link");
    tokens.rel = "stylesheet";
    tokens.href = new URL("tokens.css", BASE).href;
    if (!document.head.querySelector("link[data-homequest-fonts]")) {
      const fonts = document.createElement("link");
      fonts.rel = "stylesheet";
      fonts.href = new URL("fonts/fonts.css", BASE).href;
      fonts.dataset.homequestFonts = "1";
      document.head.append(fonts);
    }
    this._header = h("header");
    this._fort = h("div", { class: "fortbar-slot" });
    this._main = h("main");
    this._nav = h("nav");
    this._layer = h("div");
    uprightGuard(this._layer);                                    // a scene on a phone turned sideways: paused, "Otoč telefon na výšku" (#118)
    this._zoomLayer = h("div");                                   // the full-screen hero (separate: the sheet layer is rebuilt on every render)
    this._toasts = h("div", { class: "toasts" });
    root.append(tokens, style, h("div", { class: "app" }, this._header, this._fort, this._main, this._nav, this._layer, this._zoomLayer, this._toasts));
    for (const ev of ["click", "touchend"]) root.addEventListener(ev, () => this.sound.unlock(), true);     // iOS: sound only after a tap
    try {
      const saved = JSON.parse(localStorage.getItem(LS) || "{}");
      if (saved.tab) this.tab = saved.tab;
      if (saved.kid) this.kidId = saved.kid;
    } catch (e) {
      /* no storage */
    }
  }

  /** HA sets `panel` (with the config of a child panel: {kid_id}) after `hass`, so the start waits for the end of this turn. */
  set panel(p) {
    this._panelKid = (p && p.config && p.config.kid_id) || null;
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) queueMicrotask(() => this._hass && this._start());
  }

  /* ------------------------------------------------------- viewport (iOS) */

  get narrow() {
    return !!this._narrow;
  }

  /** HA sets `narrow` on phones: only then the panel is pinned to the visible area (on a wide screen it sits next to the sidebar). */
  set narrow(v) {
    this._narrow = !!v;
    this._applyViewport();
  }

  connectedCallback() {
    if (this._vpOn) return;
    this._vpOn = true;
    this._vpHandler = () => { this._applyViewport(); this._updateDebug(); };
    window.addEventListener("resize", this._vpHandler);
    window.addEventListener("orientationchange", this._vpHandler);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", this._vpHandler);
      window.visualViewport.addEventListener("scroll", this._vpHandler);
    }
    this._applyViewport();
    if (new URLSearchParams(location.search).get("debug") === "layout") this._toggleDebug(true);
  }

  _applyViewport() {
    const fixed = !!this._narrow && this.isConnected !== false;
    this.toggleAttribute("fixed", fixed);
    const root = document.documentElement;
    if (fixed) {
      this.style.setProperty("--hq-vh", `${viewportHeight(window)}px`);
      if (!this._scrollLocked) {                      // the page behind the panel must not scroll away (the menu would leave with it)
        this._scrollLocked = { html: root.style.overflow, body: document.body && document.body.style.overflow, over: root.style.overscrollBehavior };
        root.style.overflow = "hidden";
        root.style.overscrollBehavior = "none";
        if (document.body) document.body.style.overflow = "hidden";
      }
      if (window.scrollY) window.scrollTo(0, 0);
    } else {
      this.style.removeProperty("--hq-vh");
      this._unlockScroll();
    }
  }

  _unlockScroll() {
    if (!this._scrollLocked) return;
    const root = document.documentElement;
    root.style.overflow = this._scrollLocked.html || "";
    root.style.overscrollBehavior = this._scrollLocked.over || "";
    if (document.body) document.body.style.overflow = this._scrollLocked.body || "";
    this._scrollLocked = null;
  }

  /** safe-area insets as the browser resolves them (env() cannot be read directly): a hidden probe with that padding. */
  _insets() {
    let probe = this.shadowRoot.querySelector(".safeprobe");
    if (!probe) {
      probe = document.createElement("div");
      probe.className = "safeprobe";
      probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) max(env(safe-area-inset-bottom,0px),var(--hq-safe-bottom,0px)) env(safe-area-inset-left,0px)";
      this.shadowRoot.append(probe);
    }
    const cs = getComputedStyle(probe);
    return { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
  }

  /** The hidden overview (triple tap on the title): what the phone really measures. A tap on it closes it. */
  _toggleDebug(on) {
    const want = on == null ? !this._dbg : on;
    if (!want) {
      if (this._dbg) this._dbg.remove();
      this._dbg = null;
      return;
    }
    if (this._dbg) return;
    this._dbg = document.createElement("div");
    this._dbg.className = "layoutdebug";
    this._dbg.addEventListener("click", () => this._toggleDebug(false));
    this.shadowRoot.append(this._dbg);
    this._updateDebug();
    clearInterval(this._dbgTimer);
    this._dbgTimer = setInterval(() => (this._dbg ? this._updateDebug() : clearInterval(this._dbgTimer)), 1000);
  }

  _updateDebug() {
    if (!this._dbg) return;
    const r = this.shadowRoot;
    const report = layoutReport({ win: window, doc: document, host: this, main: r.querySelector("main"), nav: r.querySelector("nav"), insets: this._insets(), narrow: this._narrow, fixed: this.hasAttribute("fixed") });
    this._lastLayout = report;
    this._dbg.textContent = ["HomeQuest layout (klepnutím zavřeš)", ...reportLines(report)].join("\n");
  }

  disconnectedCallback() {
    this._closeZoom(true);
    this._vpOn = false;
    if (this._vpHandler) {
      window.removeEventListener("resize", this._vpHandler);
      window.removeEventListener("orientationchange", this._vpHandler);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", this._vpHandler);
        window.visualViewport.removeEventListener("scroll", this._vpHandler);
      }
    }
    this._unlockScroll();
    clearInterval(this._dbgTimer);
    if (this._unsub) this._unsub();
    this._unsub = null;
    if (this.stage) this.stage.destroy();
    this.stage = null;
    this._hass = null;
  }

  async _start() {
    // dev page, not linked from the tabs: /homequest?dev=motion (2D motion proof of concept, own test art under assets/motion_test)
    if (new URLSearchParams(location.search).get("dev") === "motion") {
      this.shadowRoot.querySelector(".app").style.display = "none";
      try {
        const m = await import("./views/motion.js");
        this._motion = await m.mountMotionPage(this.shadowRoot, { base: `${ASSETS}/motion_test` });
      } catch (e) {
        this.shadowRoot.append(h("div", { class: "card" }, "Test pohybu se nespustil: " + (e.message || e)));
      }
      return;
    }
    this._main.append(h("div", { class: "empty" }, "Načítám…"));
    this.api = new Api(this._hass, this._panelKid || null);
    try {
      this._unsub = await this.api.subscribe((view) => {
        // serialise: stage loading is async and views may arrive quickly
        this._chain = (this._chain || Promise.resolve()).then(() => this._onView(view)).catch((e) => this._fatal(e.message || String(e)));
      });
    } catch (e) {
      this._fatal(errText(e));
    }
  }

  /** The stage of the illustrated art (the only one since #127); a new one when the art manifest changes (view.art.version). */
  async _ensureStage(view) {
    const want = String((view.art && view.art.version) || 0);
    if (this.stage && this._stageKey === want) return;
    const stage = new IllustratedStage(ASSETS, await loadArtManifest(ASSETS));
    if (this.stage) this.stage.destroy();
    this.stage = stage;
    this._stageKey = want;
  }

  _fatal(text) {
    this._main.replaceChildren(h("div", { class: "card" }, h("h2", {}, "HomeQuest se nespustil"), h("p", {}, text)));
  }

  /* ---------------------------------------------------------------- state */

  async _onView(view) {
    await this._ensureStage(view);
    const prev = this.view;
    this.view = view;
    this.sound.available = SOUND_IN_PROD || view.env === "test";
    if (view.env === "test" && !this._soundMapAsked) {            // the test instance: the variants chosen in the sound lab
      this._soundMapAsked = true;
      this.api.call("sound_map").then((r) => this.sound.setMap(r.map), () => {});
    }
    if (!view.is_admin) this.kidId = view.my_kid;
    else if (!this.kidId || !view.kids[this.kidId]) this.kidId = (view.catalog.kids[0] || {}).id || null;
    this._notifyChanges(prev, view);
    this.render();
    const pinOn = !!(view.pin && view.pin.enabled);
    if (pinOn !== !!(prev && prev.pin && prev.pin.enabled) || (pinOn && this._pinUnlocked === undefined)) this._refreshPin();   // the PIN was turned on or off elsewhere
  }

  /** Coin pop when a task of the shown kid got approved; toast to parents about new pending tasks. */
  _notifyChanges(prev, view) {
    if (!prev) {
      // the game was just opened: a reward paid since the last time (approved while the child was away) is owed a sound, at the first tap
      if (!view.is_admin && this.kidId && view.kids[this.kidId] && rewardsSince(localStorage, this.kidId, approvedKeys(view, this.kidId)).length) this.sound.defer("reward");
      return;
    }
    if (this.kidId && !dailyAllDone(prev, this.kidId) && dailyAllDone(view, this.kidId) && this.tab !== "parent") setTimeout(() => this.sound.play("all_done"), 900);
    const cat = view.catalog;
    for (const [kidId, kid] of Object.entries(view.kids)) {
      const before = prev.kids[kidId];
      if (!before) continue;
      for (const [taskId, st] of Object.entries(kid.tasks)) {
        const was = before.tasks[taskId];
        if (!was || was.status === st.status || was.period_key !== st.period_key) continue;
        const task = cat.tasks.find((t) => t.id === taskId);
        if (!task) continue;
        if (st.status === "approved" && kidId === this.kidId && this.tab !== "parent") {
          this._coinPop(task.reward);
          this.sound.reward();
          this.toast(`${was.status === "open" ? "Splněno" : "Schváleno"}: ${task.name}`);
          this.ui.expr = "happy";
          this.ui.exprUntil = Date.now() + EXPRESSION_MS;
          setTimeout(() => this.render(), EXPRESSION_MS + 100);
        } else if (st.status === "open" && was.status === "pending" && kidId === this.kidId && this.tab !== "parent") {
          this.sound.play("task_rejected");                   // the parent sent it back (gentle sound)
        } else if (st.status === "pending" && kidId === this.kidId && this.tab !== "parent" && !view.is_admin) {
          this.sound.play("task_done");                       // the child's own task went to the parent
        } else if (st.status === "pending" && view.is_admin && this.tab !== "parent") {
          const name = (cat.kids.find((k) => k.id === kidId) || {}).name || kidId;
          this.toast(`${name}: „${task.name}“ čeká na schválení`);
        }
      }
    }
  }

  _save() {
    try {
      localStorage.setItem(LS, JSON.stringify({ tab: this.tab, kid: this.kidId }));
    } catch (e) {
      /* ignore */
    }
  }

  /* ------------------------------------------------------------ context */

  _ctx() {
    const view = this.view;
    const cat = view.catalog;
    const kid = this.kidId ? view.kids[this.kidId] : null;
    return {
      view, cat, kid, kidId: this.kidId, isAdmin: view.is_admin,
      items: Object.fromEntries(cat.items.map((i) => [i.id, i])),
      stage: this.stage, ui: this.ui, assets: ASSETS, api: this.api,
      rerender: () => this.render(),
      playIntro: () => this._playIntro(),
      playStage: (at) => this._playStage(at, false),
      playSiegeWon: (stage) => this._playSiegeWon(stage, false),
      siegeBack: () => this._siegeBack(),
      toast: (t, k) => this.toast(t, k),
      sheet: (build) => this._openSheet(build),
      zoom: (spec, ev) => this._openZoom(spec, ev),
      confirm: (o) => this._confirm(o),
      /** Run a command for the shown kid; toast the error. Returns true on success. */
      pin: { enabled: !!(view.pin && view.pin.enabled), unlocked: !(view.pin && view.pin.enabled) || this._pinUnlocked === true },
      refreshPin: () => this._refreshPin(),
      act: async (type, data = {}, opts = {}) => {
        try {
          await this.api.call(type, { kid_id: this.kidId, ...data });
          if (ACT_SOUND[type]) this.sound.play(ACT_SOUND[type]);
          return true;
        } catch (e) {
          if (e && e.code === "pin_required") {              // the server wants the parent PIN: back to the pad
            this._pinUnlocked = false;
            if (view.is_admin) { this.tab = "parent"; this.render(); }
          }
          if (!opts.quiet) this.toast(errText(e), "error");
          return false;
        }
      },
    };
  }

  /** Ask the server whether this connection has entered the parent PIN (only while a PIN is set). */
  async _refreshPin() {
    const enabled = !!(this.view && this.view.pin && this.view.pin.enabled);
    if (!enabled) {
      this._pinUnlocked = true;
    } else {
      try {
        this._pinUnlocked = !!(await this.api.call("pin_status")).unlocked;
      } catch (e) {
        this._pinUnlocked = false;
      }
    }
    this.render();
  }

  /* -------------------------------------------------------------- render */

  render() {
    if (!this.view || !this.stage) return;
    const ctx = this._ctx();
    const kid = ctx.kid;
    const waiting = !ctx.isAdmin && this.view.started === false;               // v1.6: before the parent's "Spustit hru" the child only waits
    const setupOpen = ctx.isAdmin && this.view.setup && !this.view.setup.started;   // the guide sits on top of the Rodič tab until the start
    if (ctx.isAdmin && !kid) this.tab = "parent";                              // a new family: no child yet, only the guide
    const needHero = (kid && !kid.hero && this.tab !== "parent") || waiting;
    const siege = needHero ? null : siegeMode(this.view, kid, ctx.kidId);       // the siege of the fortress (#118): the child's panel goes straight into it
    if (this.tab === "parent" && !ctx.isAdmin) this.tab = "quests";
    if (this.tab === "story" && !ctx.view.story) this.tab = "quests";

    this.stage.begin("v");
    const scroll = this._main.scrollTop;
    let content;
    try {
      if (waiting) content = renderNotStarted();
      else if (!kid && !setupOpen) content = h("div", { class: "empty" }, "Žádné dítě není nastavené.");
      else if (this.tab === "parent" && ctx.pin.enabled && !ctx.pin.unlocked) content = renderPinPad(ctx);
      else if (!kid) content = h("div", {}, renderSetup(ctx), pinSettings(ctx));
      else if (siege && siege.mode === "prep") content = renderPrep(ctx, () => this._openSiegeGame(), () => this._siegeAway());
      else if (needHero) content = h("div", { class: "card", "data-nohero": "" }, h("h2", {}, "Hrdina se připravuje…"), h("p", { class: "muted" }, "Hrdina tohoto dítěte ještě není nastavený. Nastavuje se v katalogu (rodič)."));
      else if (this.tab === "parent" && ctx.pin.enabled && !ctx.pin.unlocked) content = renderPinPad(ctx);
      else if (this.tab === "parent") content = h("div", {}, setupOpen ? renderSetup(ctx) : null, renderParent(ctx), pinSettings(ctx));
      else if (this.tab === "hero") content = renderHero(ctx);
      else if (this.tab === "inv") content = renderInventory(ctx);
      else if (this.tab === "story" && ctx.view.story) content = renderQuest(ctx);
      else content = renderQuests(ctx);
    } catch (e) {
      console.error("render failed", e);
      content = h("div", { class: "card" }, h("h2", {}, "Něco se pokazilo"), h("p", {}, String(e.message || e)));
    }
    this.stage.end();
    this._main.replaceChildren(content);
    this._main.scrollTop = scroll;
    this._renderHeader(ctx, needHero);
    this._renderFortress(ctx, needHero);
    this._renderNav(ctx, needHero, siege || (waiting ? { waiting } : null) || (!kid ? { nokid: true } : null));
    this._renderSheet();
    this._maybeIntro(ctx, needHero);
  }

  /* ------------------------------------------------------------- intro */

  /** The first start: a child who has a hero sees the quest giver's intro once per device (localStorage). The parent account never gets it by itself. */
  _maybeIntro(ctx, needHero) {
    if (this._introOpen || !ctx.kid || needHero) return;
    const seen = introSeen(localStorage, ctx.kidId) || serverSeen(ctx.kid).intro;      // the server knows it on every device (v1.4.0)
    if (shouldAutoIntro({ story: ctx.view.story, isAdmin: ctx.isAdmin, hasHero: !!ctx.kid.hero, seen })) this._playIntro(true);
  }

  /** The thin bar of the shared fortress under the header: "Tvrz: 12 / 30"; it pulses with a "+N" when completed tasks were added. */
  _renderFortress(ctx, needHero) {
    const story = ctx.view.story;
    const at = story && ctx.kid && !needHero ? stageAt(story, ctx.view.fortress ? ctx.view.fortress.done : 0) : null;
    if (!at) {
      this._fort.replaceChildren();
      return;
    }
    const gain = barGain(this._fortDone, at.done);
    this._fortDone = at.done;
    const bar = h(
      "div",
      { class: `fortbar${gain ? " bump" : ""}`, "data-act": "open-fortress", "data-done": String(at.done), onclick: () => { this.tab = "story"; this.render(); } },
      icon("mdi:castle", 20),
      h("span", { class: "ftxt" }, at.label),
      h("div", { class: "prog" }, h("i", { style: `width:${at.pct}%` })),
      gain ? h("span", { class: "plus" }, `+${gain}`) : null
    );
    this._fort.replaceChildren(bar);
    this._maybeStage(ctx, at);
  }

  /** A reached stage is played once per child (a stage with a gift: until the server has paid it), when its picture exists
   *  (so a missing picture does not spoil it). A gift that could not be claimed is not retried until the panel is reopened. */
  async _maybeStage(ctx, at) {
    if (this._introOpen || this._stageBusy || !ctx.kid) return;
    const seen = Math.max(stageSeen(localStorage, ctx.kidId), serverSeen(ctx.kid).stage);
    const go = stageToCelebrate({ story: ctx.view.story, isAdmin: ctx.isAdmin, done: at.done, seen, gifts: ctx.kid.gifts || [] });
    if (!go) return this._maybeSiege(ctx);
    if (this._stageFailed && this._stageFailed.has(`${ctx.kidId}.${go.stage.id}`)) return;
    this._stageBusy = true;
    try {
      if (!(await bgExists(ctx, go.stage.background))) return;
      if (this._introOpen) return;
      this._playStage(go, true);
    } finally {
      this._stageBusy = false;
    }
  }

  /** Play the scene of a stage. claim = false: a replay (the parent), nothing is paid. */
  _playStage(go, claim) {
    const ctx = this._ctx();
    this._introOpen = true;
    this.sound.play("quest_progress");
    const kidId = ctx.kidId;
    stageDialog(ctx, ctx.view.story, go, (ok) => {
      this._introOpen = false;
      if (claim && ok) this._markStage(kidId, go.index);
      if (claim && !ok) (this._stageFailed = this._stageFailed || new Set()).add(`${kidId}.${go.stage.id}`);
    }, { layer: this._layer, claim });
  }

  /** A stage celebration seen to the end: on this device and on the server (another phone does not play it again, v1.4.0). */
  _markStage(kidId, index) {
    markStageSeen(localStorage, kidId, index);
    const ctx = this._ctx();
    if (!ctx.isAdmin && ctx.kidId === kidId) ctx.act("story_seen", { what: "stage", index }, { quiet: true });
  }

  /* ------------------------------------------------------------- siege (#118) */

  /** The scene of the siege stage (once per child, on any device: the server keeps it) or the end of a won siege with the choice of the amulet. */
  _maybeSiege(ctx) {
    if (this._introOpen || this._siegeGame) return;
    const sm = siegeMode(ctx.view, ctx.kid, ctx.kidId);
    if (!sm || sm.mode === "prep") return;
    if (this._stageFailed && this._stageFailed.has(`${ctx.kidId}.${sm.stage.id}.${sm.mode}`)) return;
    if (sm.mode === "scene") this._playSiegeScene(sm.stage);
    else this._playSiegeWon(sm.stage, true);
  }

  /** The rebuild is skipped when the child has seen this stage reached on this device already (PROD v1.3.2 played its warning scene, #118). */
  _playSiegeScene(stage) {
    const ctx = this._ctx();
    const story = ctx.view.story;
    this._introOpen = true;
    this.sound.play("quest_progress");
    const kidId = ctx.kidId;
    const at = stageAt(story, stage.tasks);
    const rebuild = Math.max(stageSeen(localStorage, kidId), serverSeen(ctx.kid).stage) < at.index;
    stageDialog(ctx, story, { ...at, done: ctx.view.fortress ? ctx.view.fortress.done : stage.tasks }, async () => {
      const ok = await ctx.act("scene_seen", { stage: stage.id }, { quiet: true });
      if (ok && rebuild) this._markStage(kidId, at.index);
      this._introOpen = false;
      const kid = this.view.kids[kidId];
      if (ok && kid && !(kid.scenes || []).includes(stage.id)) kid.scenes = [...(kid.scenes || []), stage.id];   // the new view may come after this render
      if (!ok) (this._stageFailed = this._stageFailed || new Set()).add(`${kidId}.${stage.id}.scene`);
      this.render();
    }, { layer: this._layer, claim: false, rebuild });
  }

  /** claim = false: the replay from the Quest tab (the amulets only to look at). */
  _playSiegeWon(stage, claim) {
    if (this._introOpen) return;
    const ctx = this._ctx();
    this._introOpen = true;
    victoryFlow(ctx, ctx.view.story, stage, { layer: this._layer, claim, onDone: () => { this._introOpen = false; this.render(); } });
  }

  /** The cross (#118): the child is away from this attack (on the server: no jump into it by itself on any device), the panel shows the hero. */
  async _siegeAway() {
    const ok = await this._ctx().act("siege_away", { away: true }, { quiet: true });
    if (ok && this.view.siege) this.view.siege = { ...this.view.siege, away: [...new Set([...(this.view.siege.away || []), this.kidId])] };   // the new view may come later
    this.tab = "hero";
    this.render();
  }

  /** The Quest button of the battle (#118): back into the attack (or, after the win, a replay only for this child), then the preparation. */
  async _siegeBack() {
    const sg = this.view.siege;
    if (!sg) return;
    const ok = await this._ctx().act(sg.active ? "siege_away" : "siege_replay", sg.active ? { away: false } : {}, { quiet: true });
    if (!ok) return this.toast("Do bitvy se teď nedá.", "error");
    if (sg.active) this.view.siege = { ...sg, away: (sg.away || []).filter((k) => k !== this.kidId) };
    this.render();
  }

  /** "Do boje!": the game layer over the panel (loaded on demand: games/). */
  async _openSiegeGame() {
    if (this._siegeGame) return;
    this._siegeGame = true;
    const done = () => { this._siegeGame = null; this.render(); };
    const replay = !!(this.view.siege && this.view.siege.replay);
    const stage = this.view.story.fortress.stages.find((s) => s.id === this.view.siege.stage);
    const won = () => {                     // a won replay: a short thanks of the castellan, no amulet (addendum 1); the first win: the panel plays the end
      this._siegeGame = null;
      // the first win, or a replay won by a child without the amulet yet (it left the first battle, #118): the whole end with the choice
      const has = ((this.view.kids[this.kidId] || {}).trophies || []).some((t) => t.stage === stage.id);
      if (!replay || !has) return this.render();
      this._introOpen = true;
      victoryFlow(this._ctx(), this.view.story, stage, { layer: this._layer, replay: true, onDone: () => { this._introOpen = false; this.render(); } });
    };
    try {
      const m = await import("./games/siege_game.js");
      const left = () => { this._siegeGame = null; this.tab = "hero"; this.render(); };    // the cross in the game (#118): away already, back on the hero
      this._siegeGame = m.openSiegeGame(this.shadowRoot, { hass: this._hass, api: this.api, stage: this.stage, view: this.view, kidId: this.kidId, onWon: won, onClose: done, onLeft: left });
    } catch (e) {
      this._siegeGame = null;
      this.toast("Hra se nespustila: " + (e.message || e), "error");
    }
  }

  _playIntro(first = false) {
    const ctx = this._ctx();
    const story = ctx.view.story;
    if (!story || this._introOpen) return;
    this._introOpen = true;
    const kidId = ctx.kidId;
    const dlg = introDialog(ctx, story, () => {
      this._introOpen = false;
      markIntroSeen(localStorage, kidId);
      if (!ctx.isAdmin) this._ctx().act("story_seen", { what: "intro" }, { quiet: true });
      this.render();                                   // a reached stage is celebrated right after the intro
    });
    this._layer.append(dlg);
  }

  _renderHeader(ctx, needHero) {
    const showKids = ctx.isAdmin && this.tab !== "parent";
    const menu = this.narrow ? h("ha-menu-button", { hass: "", narrow: "" }) : null;
    if (menu) {
      menu.hass = this._hass;
      menu.narrow = true;
    }
    const kids = showKids
      ? h(
          "div",
          { class: "kidswitch" },
          ctx.cat.kids.map((k) =>
            h("button", { class: "chip", "data-kid": k.id, "aria-pressed": String(k.id === this.kidId), onclick: () => { this.kidId = k.id; this._save(); this.render(); } }, k.name)
          )
        )
      : null;
    const title = h("h1", { "data-debug-tap": "" }, "HomeQuest");
    title.addEventListener("click", () => {                      // three taps within 1.2 s open the hidden layout overview
      const now = Date.now();
      this._taps = (this._taps || []).filter((t) => now - t < 1200).concat(now);
      if (this._taps.length >= 3) { this._taps = []; this._toggleDebug(); }
    });
    const who = headerName(ctx.cat, this.kidId, this.tab, ctx.isAdmin);
    const player = who ? h("span", { class: "playername", "data-player": "", title: who }, who) : null;
    const env = { test: ["TEST", "Testovací prostředí"], clean: ["CLEAN", "Zkušební rodina (čistá instalace)"] }[ctx.view.env];   // only the test instances have a flag
    const badge = env ? h("span", { class: "envbadge", "data-env": ctx.view.env, title: env[1] }, env[0]) : null;
    const on = this.sound.enabled;
    const speaker = !this.sound.available ? null : h("button", { class: "chip soundbtn", "data-sound": "", "aria-pressed": String(on), "aria-label": on ? "Zvuk zapnutý" : "Zvuk vypnutý", title: "Zvuk",
      onclick: () => { this.sound.unlock(); if (this.sound.toggle()) this.sound.play("tick"); this.render(); } }, icon(on ? "mdi:volume-high" : "mdi:volume-off", 26));
    this._header.replaceChildren(...[menu, h("div", { class: "titlegroup" }, title, player), badge, h("div", { class: "spacer" }), speaker, kids].filter(Boolean));
  }

  _renderNav(ctx, needHero, siege) {
    if (siege) {                                         // during the siege the other tabs are closed
      this._nav.replaceChildren();
      return;
    }
    const pending = ctx.isAdmin
      ? Object.values(ctx.view.kids).reduce((n, k) => n + Object.values(k.tasks).filter((t) => t.status === "pending").length, 0)
      : 0;
    this._nav.replaceChildren(
      ...TABS.filter((t) => (!t.admin || ctx.isAdmin) && (!t.needsStory || ctx.view.story)).map((t) => {
        const locked = needHero && !t.admin; // tabs of a kid without hero all show onboarding
        return h(
          "button",
          { "data-tab": t.id, "aria-current": !locked && this.tab === t.id ? "page" : null, onclick: () => { this.sound.play("tick"); this.tab = t.id; this._save(); this.render(); } },
          icon(t.icon),
          t.label,
          t.id === "parent" && pending ? h("span", { class: "badge" }, String(pending)) : null
        );
      })
    );
  }

  /* --------------------------------------------------- sheet / toast ---- */

  /** The hero on the whole screen (tap on the hero anywhere): the same layers as the small one (spec), drawn big from the full-size pictures.
   *  A tap closes it; it also closes with the browser's Back (one history entry is added while it is open). */
  _openZoom(spec, ev) {
    if (this._zoomOpen || !this.stage) return;
    this._zoomOpen = true;
    this.sound.play("hero_zoom");
    this._zoomId = (this._zoomId || 0) + 1;
    this.stage.begin("zoom");
    const fig = this.stage.hero("zoom", { ...spec, crop: null, scale: 8 });
    this.stage.end();
    let ox = 50;
    let oy = 50;
    const r = this.getBoundingClientRect();
    if (ev && ev.clientX != null && r.width) {
      ox = Math.round(((ev.clientX - r.left) / r.width) * 100);
      oy = Math.round(((ev.clientY - r.top) / r.height) * 100);
    }
    const ov = h("div", { class: "hero-zoom", "data-zoom": "", style: `--ox:${ox}%;--oy:${oy}%`, onclick: () => this._closeZoom() }, h("div", { class: "zoomstage" }, fig));
    this._zoomLayer.replaceChildren(ov);
    try { history.pushState({ hqzoom: true }, "", location.href); this._zoomPushed = true; } catch (e) { this._zoomPushed = false; }
    this._zoomPop = () => this._closeZoom(true);
    this._zoomKey = (e) => { if (e.key === "Escape") this._closeZoom(); };
    window.addEventListener("popstate", this._zoomPop);
    window.addEventListener("keydown", this._zoomKey);
  }

  _closeZoom(done = false) {
    if (!this._zoomOpen) return;
    if (!done && this._zoomPushed && history.state && history.state.hqzoom) {   // our own history entry: go back, the popstate closes it
      this._zoomPushed = false;
      const id = this._zoomId;
      history.back();
      setTimeout(() => { if (this._zoomId === id) this._closeZoom(true); }, 400);   // in case no popstate comes (never closes a newer one)
      return;
    }
    this._zoomOpen = false;
    window.removeEventListener("popstate", this._zoomPop);
    window.removeEventListener("keydown", this._zoomKey);
    this._zoomLayer.replaceChildren();
    if (this.stage) this.stage.entries.delete("zoom:zoom");
  }

  _openSheet(build, onClose = null) {
    this._sheet = build;
    this._sheetOnClose = onClose;
    this._renderSheet();
  }

  _closeSheet() {
    const onClose = this._sheetOnClose;
    this._sheetOnClose = null;
    this._sheet = null;
    if (onClose) onClose();
    this._layer.replaceChildren();
    if (this.stage) {
      this.stage.begin("m");
      this.stage.end();
    }
  }

  _renderSheet() {
    if (!this._sheet) return;
    const ctx = this._ctx();
    this.stage.begin("m");
    const close = () => this._closeSheet();
    let body;
    try {
      body = this._sheet(ctx, close);
    } catch (e) {
      console.error("sheet failed", e);
      body = h("p", {}, String(e.message || e));
    }
    this.stage.end();
    const overlay = h("div", { class: "overlay", onclick: (e) => e.target === overlay && close() }, h("div", { class: "sheet", role: "dialog" }, body));
    const old = this._layer.querySelector(".sheet");
    const top = old ? old.scrollTop : 0;
    this._layer.replaceChildren(overlay);
    overlay.firstChild.scrollTop = top;
  }

  _confirm({ title, text, yes = "Ano", no = "Zrušit", danger = false }) {
    return new Promise((resolve) => {
      let answered = false;
      const answer = (v, close) => {
        answered = true;
        resolve(v);
        close();
      };
      this._openSheet(
        (ctx, close) =>
          h(
            "div",
            { class: "center" },
            h("h2", {}, title),
            text ? h("p", {}, text) : null,
            h(
              "div",
              { class: "actions" },
              h("button", { class: "btn ghost", "data-act": "no", onclick: () => answer(false, close) }, no),
              h("button", { class: `btn ${danger ? "red" : ""}`, "data-act": "yes", onclick: () => answer(true, close) }, yes)
            )
          ),
        () => {
          if (!answered) resolve(false); // dismissed by tapping outside
        }
      );
    });
  }

  toast(text, kind = "ok") {
    if (kind === "error") this.sound.play("cant_do");
    const el = h("div", { class: `toast ${kind === "error" ? "error" : ""}` }, text);
    this._toasts.append(el);
    const shown = this._toasts.querySelectorAll(".toast");
    for (let i = 0; i < shown.length - 3; i++) shown[i].remove(); // keep at most 3
    setTimeout(() => el.remove(), 3100);
  }

  _coinPop(n) {
    const pop = h("div", { class: "coinpop" }, coin(), `+${n}`);
    this._toasts.append(pop);
    setTimeout(() => pop.remove(), 1700);
  }
}

if (!customElements.get("homequest-panel")) customElements.define("homequest-panel", HomeQuestPanel);   // a module loaded twice (another ?v=) must not throw (#137)
