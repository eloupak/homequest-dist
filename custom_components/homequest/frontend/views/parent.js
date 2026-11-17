/* The Rodič screen (#129, 2026-11-14): three tabs (Přehled, Nastavení, O hře), a sober technical look (.parent-ui, tokens `parent`
 * in design/tokens.json, light/dark after the HA theme). The parent gets here with the shield in the header (homequest-panel.js); the game's
 * bottom bar is hidden meanwhile. Sub-screens (task settings, Upravit aktivní, Historie, Nastavení hry, ...) are kept in ctx.ui.pview.
 * Addendum 1 (UAT 2026-11-15): days = at most one kind (none = every day), 5 recent + Zobrazit další, Přidat/Odebrat coins, the parent's
 * own sheets (pSheet / pConfirm / choose), Nastavení hry (Zlaťáky, Schvalování úkolů, Prázdniny).
 * Addendum 2 (UAT 2026-11-15): Děti a účty gone (the guide edits children and parents), Smazat hrdinu -> Nastavení hry -> Reset hrdiny,
 * no yellow buttons (styles.js), story forms the story does not use hidden (settings.js). */
import { coin, h, icon } from "../lib/dom.js";
import { historyText, when } from "../lib/cs.js";
import { holidaysCard, whoPicker, whoParams } from "./tasks_admin.js";
import { settingsSections } from "./settings.js";
import { renderSetup } from "./setup.js";
import { reportUrl } from "../lib/report.js";

export const PARENT_TABS = [["overview", "Přehled"], ["settings", "Nastavení"], ["about", "O hře"]];
export const LICENSE_URL = "https://creativecommons.org/licenses/by-nc-nd/4.0/deed.cs";

export function renderParent(ctx) {
  const root = h("div", { class: `parent-ui${ctx.dark ? " dark" : ""}`, "data-parent": "" });
  const pv = ctx.ui.pview;
  if (pv) {
    root.append(subScreen(ctx, pv));
    return root;
  }
  const tab = ctx.ui.ptab || "overview";
  root.append(seg(PARENT_TABS, tab, (v) => { ctx.ui.ptab = v; ctx.rerender(); }, "ptab"));
  if (tab === "settings") root.append(...settingsTab(ctx));
  else if (tab === "about") root.append(aboutTab(ctx));
  else root.append(...overviewTab(ctx));
  return root;
}

/* ------------------------------------------------------------------ pieces */

function seg(options, value, onChange, name) {
  return h("div", { class: "p-seg", role: "tablist", "data-seg": name },
    options.map(([id, label]) => h("button", { role: "tab", "data-seg-id": id, "aria-selected": String(id === value), onclick: () => onChange(id) }, label)));
}

function card(...children) {
  return h("div", { class: "p-card" }, ...children);
}

function go(ctx, name, data = {}) {
  ctx.ui.pview = { name, ...data };
  ctx.rerender();
}

function back(ctx) {
  ctx.ui.pview = null;
  ctx.rerender();
}

function backBar(ctx, title, to) {
  return h("div", { class: "p-back" },
    h("button", { class: "p-btn ghost", "data-act": "p-back", "aria-label": "Zpět", onclick: () => (to ? go(ctx, to) : back(ctx)) }, icon("mdi:chevron-left", 22), "Zpět"),
    h("h2", {}, title));
}

const kidName = (ctx, id) => (ctx.cat.kids.find((k) => k.id === id) || { name: id }).name;

/* ------------------------------------------------------------------ Přehled */

/** v1.7 (#141): "Je dostupná nová verze" on top of Přehled (from update.homequest of the Marketplace, or GitHub for a package install). */
export function updateBanner(update) {
  if (!update || !update.available || !update.latest) return null;
  const how = update.source === "hacs" ? "Aktualizujete ji v Nastavení → Aktualizace a pak restartujte Home Assistant." : "Aktualizujete ji v Marketplace a pak restartujte Home Assistant.";
  return h("div", { class: "p-banner", "data-id": "update-banner" }, icon("mdi:update", 24),
    h("div", { class: "grow" }, h("b", {}, `Je dostupná nová verze HomeQuestu ${update.latest}`), update.installed ? h("span", { class: "p-muted" }, ` (máte ${update.installed})`) : null,
      h("div", { class: "p-muted" }, how, " Rozehraná hra a nastavení zůstanou.")));
}

function pendingList(ctx) {
  const out = [];
  for (const k of ctx.cat.kids) {
    const kid = ctx.view.kids[k.id];
    if (!kid) continue;
    for (const [taskId, st] of Object.entries(kid.tasks)) {
      const task = ctx.cat.tasks.find((t) => t.id === taskId) || ((ctx.view.tasks_info || {}).oneoffs || []).find((o) => o.id === taskId);
      if (st.status === "pending" && task) out.push({ kid: k, task });
    }
  }
  return out;
}

function overviewTab(ctx) {
  const out = [];
  const upd = updateBanner(ctx.view.update);                     // v1.7 (#141): a new version for the parent, only when there is one
  if (upd) out.push(upd);
  // --- approvals: hidden when no child needs them (all switches off and nothing waits)
  const pending = pendingList(ctx);
  const anyApproval = ctx.cat.kids.some((k) => ctx.view.kids[k.id] && ctx.view.kids[k.id].require_approval);
  if (anyApproval || pending.length) {
    const sec = h("div", { class: "p-section", "data-id": "approvals" }, h("h3", {}, `Ke schválení (${pending.length})`));
    if (pending.length) {
      sec.append(h("button", {
        class: "p-btn primary block", "data-act": "approve-all",
        onclick: async () => {
          const yes = await pConfirm(ctx, { title: "Schválit vše?", text: `Schválí se ${pending.length} úkolů a dětem se přičtou zlaťáky.`, yes: "Schválit vše", no: "Zpět" });
          if (!yes) return;
          for (const p of pending) await ctx.act("approve", { kid_id: p.kid.id, task_id: p.task.id }, { quiet: true });
          ctx.toast("Všechno schváleno.");
        },
      }, icon("mdi:check-all", 22), "Schválit vše"));
      const list = card();
      for (const p of pending) {
        list.append(h("div", { class: "p-row", "data-pending": `${p.kid.id}:${p.task.id}` },
          h("div", { class: "grow" }, h("div", { class: "p-title" }, p.task.name), h("div", { class: "p-muted" }, `${p.kid.name} · +${p.task.reward} `, coin())),
          h("button", { class: "p-icon danger", "data-act": "reject", "aria-label": "Zamítnout", onclick: () => ctx.act("reject", { kid_id: p.kid.id, task_id: p.task.id }) }, icon("mdi:close", 24)),
          h("button", { class: "p-icon ok", "data-act": "approve", "aria-label": "Schválit", onclick: () => ctx.act("approve", { kid_id: p.kid.id, task_id: p.task.id }) }, icon("mdi:check", 24))));
      }
      sec.append(list);
    } else {
      sec.append(card(h("div", { class: "p-muted" }, "Nic nečeká na schválení.")));
    }
    out.push(sec);
  }
  out.push(addTaskSection(ctx));
  out.push(h("div", { class: "p-section" },
    h("button", { class: "p-btn block", "data-act": "edit-tasks", onclick: () => go(ctx, "edit") }, icon("mdi:pencil", 22), "Upravit aktivní")));
  return out;
}

/* ------------------------------------------------------------------ Přidat úkol */

/** Days of a daily task in the UI: at most one kind; none = every day (stored as both kinds, as before - nothing to migrate). */
export const DAY_ALL = ["workday", "free"];
export function daysPick(days) {
  return days && days.length === 1 ? days[0] : "";
}
export function daysOf(pick) {
  return pick ? [pick] : DAY_ALL.slice();
}

/** The defaults of a new task: one-off, every child, reward 1. */
export function newTaskConfig(name = "") {
  return { mode: "add", name, period: "oneoff", who: "", days: ["workday", "free"], reward: 1 };
}

/** A task of the lists -> the settings screen (who: "" everybody, a child id, "*" Pouze 1). */
export function configOf(t, allKids) {
  const only = t.kids && t.kids.length && t.kids.length < allKids.length ? t.kids : null;
  return {
    name: t.name, reward: t.reward, period: t.period === "daily" ? "daily" : "oneoff",
    who: t.single ? "*" : only ? only[0] : "", days: t.period === "daily" ? (t.days || ["workday", "free"]) : ["workday", "free"],
  };
}

/** What add_task / update_task get from the settings screen. */
export function taskParams(cfg, allKids) {
  const who = whoParams(cfg.who);
  const out = { name: cfg.name.trim(), reward: cfg.reward, single: who.single, kids: who.kids || allKids.slice() };
  if (cfg.period === "daily") out.days = cfg.days.slice();
  return out;
}

export const RECENT_SHOWN = 5;

function addTaskSection(ctx) {
  const allKids = ctx.cat.kids.map((k) => k.id);
  const name = h("input", { class: "p-field", type: "text", maxlength: "60", placeholder: "Nový úkol", "data-field": "new-task", "aria-label": "Nový úkol" });
  const sec = h("div", { class: "p-section", "data-id": "add-task" }, h("h3", {}, "Přidat úkol"));
  sec.append(card(
    h("div", { class: "p-inline" },
      name,
      h("button", { class: "p-icon", "data-act": "new-task-settings", "aria-label": "Nastavení úkolu", onclick: () => go(ctx, "config", { cfg: newTaskConfig(name.value) }) }, icon("mdi:cog", 24)),
      h("button", {
        class: "p-btn primary", "data-act": "new-task-add",
        onclick: async () => {
          const n = name.value.trim();
          if (!n) return ctx.toast("Napiš název úkolu.", "error");
          if (await ctx.act("add_task", { name: n, reward: 1, period: "oneoff", single: false })) ctx.toast(`Přidáno: ${n}`);
        },
      }, "Přidat")),
    h("div", { class: "p-muted small" }, "Bez nastavení: jednorázový úkol pro všechny děti za 1 zlaťák.")));
  const recent = (ctx.view.tasks_info || {}).recent || [];
  if (recent.length) {
    const list = card(h("div", { class: "p-label" }, "Naposledy přidané"));
    const more = !!ctx.ui.precentAll;
    for (const r of more ? recent : recent.slice(0, RECENT_SHOWN)) {
      list.append(h("div", { class: "p-row", "data-recent": r.id },
        h("div", { class: "grow" }, h("div", { class: "p-title" }, r.name), h("div", { class: "p-muted" }, taskMeta(ctx, r))),
        h("button", { class: "p-icon", "data-act": `recent-settings-${r.id}`, "aria-label": "Nastavení úkolu", onclick: () => go(ctx, "config", { cfg: { mode: "add", ...configOf(r, allKids) } }) }, icon("mdi:cog", 24)),
        h("button", {
          class: "p-btn", "data-act": `recent-add-${r.id}`,
          onclick: async () => { if (await ctx.act("add_task", { period: r.period, ...taskParams(configOf(r, allKids), allKids) })) ctx.toast(`Přidáno: ${r.name}`); },
        }, "Přidat")));
    }
    if (recent.length > RECENT_SHOWN) {
      list.append(h("div", { class: "p-row" }, h("button", { class: "p-link", "data-act": "recent-more", onclick: () => { ctx.ui.precentAll = !more; ctx.rerender(); } },
        more ? "Zobrazit méně" : `Zobrazit další (${recent.length - RECENT_SHOWN})`)));
    }
    sec.append(list);
  }
  return sec;
}

function taskMeta(ctx, t) {
  const parts = [t.period === "daily" ? `Denní${t.days && t.days.length === 1 ? (t.days[0] === "workday" ? " · pracovní dny" : " · volné dny") : ""}` : "Jednorázový"];
  if (t.single) parts.push("Pouze 1");
  else if (t.kids && t.kids.length && t.kids.length < ctx.cat.kids.length) parts.push(t.kids.map((k) => kidName(ctx, k)).join(", "));
  parts.push(`+${t.reward}`);
  return parts.join(" · ");
}

/* ------------------------------------------------------------------ Nastavení úkolu */

function configScreen(ctx, pv) {
  const cfg = pv.cfg;
  const allKids = ctx.cat.kids.map((k) => k.id);
  const editing = cfg.mode === "edit";
  const root = h("div", { "data-id": "task-config" }, backBar(ctx, editing ? "Upravit úkol" : "Nový úkol", pv.from));
  const name = h("input", { class: "p-field", type: "text", maxlength: "60", value: cfg.name, placeholder: "Název úkolu", "data-field": "task-name", oninput: () => { cfg.name = name.value; } });
  const reward = h("input", { class: "p-field num", type: "number", inputmode: "numeric", min: "0", max: "50", value: String(cfg.reward), "data-field": "task-reward", oninput: () => { cfg.reward = parseInt(reward.value, 10); } });
  const dayBox = h("div", { class: "p-checks", "data-field": "task-days" });
  const drawDays = () => {
    const pick = daysPick(cfg.days);                                     // like "Pro koho": at most one; tap the chosen one again = none
    dayBox.replaceChildren(...[["workday", "Pracovní dny"], ["free", "Volné dny"]].map(([d, label]) => {
      const on = pick === d;
      return h("button", { class: `p-chip${on ? " on" : ""}`, "aria-pressed": String(on), "data-day": d, onclick: () => { cfg.days = daysOf(on ? "" : d); drawDays(); } }, on ? icon("mdi:check", 18) : null, label);
    }), h("div", { class: "p-muted small", "data-id": "days-hint", style: { flexBasis: "100%" } }, pick ? (pick === "workday" ? "Jen pracovní dny." : "Jen volné dny a prázdniny.") : "Každý den"));
  };
  drawDays();
  const daysRow = h("div", { class: "p-fieldrow", "data-id": "days-row", style: { display: cfg.period === "daily" ? "" : "none" } }, h("div", { class: "p-label" }, "Dny"), dayBox);
  const kinds = seg([["daily", "Denní"], ["oneoff", "Jednorázový"]], cfg.period, (v) => {
    if (editing) return;                                       // a task keeps its kind: a new one is added instead
    cfg.period = v;
    for (const b of kinds.querySelectorAll("button")) b.setAttribute("aria-selected", String(b.dataset.segId === v));
    daysRow.style.display = v === "daily" ? "" : "none";
  }, "period");
  if (editing) kinds.classList.add("locked");
  root.append(card(
    h("div", { class: "p-fieldrow" }, h("label", { class: "p-label" }, "Název"), name),
    h("div", { class: "p-fieldrow" }, h("div", { class: "p-label" }, "Typ"), kinds),
    ctx.cat.kids.length > 1 ? h("div", { class: "p-fieldrow" }, h("div", { class: "p-label" }, "Pro koho"), whoPicker(ctx, cfg.who, "cfg", (v) => { cfg.who = v; }, true),
      h("div", { class: "p-muted small" }, "Nic nevybráno = všechny děti. Pouze 1 = splní kterékoli dítě, ale jen jedno.")) : null,
    daysRow,
    h("div", { class: "p-fieldrow" }, h("label", { class: "p-label" }, "Odměna"), h("div", { class: "p-inline" }, reward, coin()))));
  const check = () => {
    if (!cfg.name.trim()) return ctx.toast("Napiš název úkolu.", "error"), false;
    if (!(cfg.reward >= 0 && cfg.reward <= 50)) return ctx.toast("Odměna musí být číslo 0–50.", "error"), false;
    return true;
  };
  const actions = h("div", { class: "p-actions" });
  if (!editing) {
    actions.append(h("button", { class: "p-btn ghost", onclick: () => (pv.from ? go(ctx, pv.from) : back(ctx)) }, "Zpět"),
      h("button", { class: "p-btn primary", "data-act": "config-add", onclick: async () => {
        if (!check()) return;
        if (await ctx.act("add_task", { period: cfg.period, ...taskParams(cfg, allKids) })) { ctx.toast(`Přidáno: ${cfg.name.trim()}`); back(ctx); }
      } }, "Přidat"));
  } else {
    actions.append(h("button", { class: "p-btn danger-ghost", "data-act": "config-remove", onclick: () => removeTask(ctx, pv.task) }, "Odebrat"),
      h("button", { class: "p-btn primary", "data-act": "config-save", onclick: async () => {
        if (!check()) return;
        const p = taskParams(cfg, allKids);
        if (await ctx.act("update_task", { task_id: pv.task.id, ...p })) { ctx.toast("Uloženo."); go(ctx, "edit"); }
      } }, "Uložit"));
  }
  root.append(actions);
  if (cfg.period === "daily") root.append(h("p", { class: "p-muted small" }, editing ? "Změna dnů a dětí platí od zítřka, název a odměna hned." : "Nový denní úkol se ukáže hned, když dnes je jeho den."));
  return root;
}

async function removeTask(ctx, t) {
  const mine = t.kids && t.kids.length ? t.kids : ctx.cat.kids.map((k) => k.id);
  let only = null;
  if (mine.length > 1) {
    only = await choose(ctx, `Odebrat „${t.name}“`, "Pro koho?", [["*", mine.length === 2 ? "Oba" : "Všechny děti"], ...mine.map((k) => [k, `Jen ${kidName(ctx, k)}`])]);
    if (only === null) return;
  } else if (!(await pConfirm(ctx, { title: `Odebrat „${t.name}“?`, text: t.period === "daily" ? "Denní úkol se vypne, historie zůstane." : "Dětem zmizí.", yes: "Odebrat", no: "Zpět", danger: true }))) return;
  const data = { task_id: t.id, ...(only && only !== "*" ? { only_kid: only } : {}) };
  if (await ctx.act("remove_task", data)) { ctx.toast("Odebráno."); go(ctx, "edit"); }
}

/** A sheet in the look of the Rodič screen (not the game's parchment): build(c, close) -> the content. */
export function pSheet(ctx, build, onClose = null) {
  ctx.sheet((c, close) => h("div", { class: `parent-ui${c.dark ? " dark" : ""}`, "data-psheet": "" }, build(c, close)), { parent: true, dark: ctx.dark, onClose });
}

/** ctx.confirm in the look of Rodič: resolves true / false (false also when dismissed). The buttons keep data-act yes / no. */
export function pConfirm(ctx, { title, text, yes = "Ano", no = "Zrušit", danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (v, close) => { answered = true; resolve(v); close(); };
    pSheet(ctx, (c, close) => h("div", { "data-id": "p-confirm" }, h("h2", {}, title), text ? h("p", { class: "p-muted" }, text) : null,
      h("div", { class: "p-actions" },
        h("button", { class: "p-btn ghost", "data-act": "no", onclick: () => answer(false, close) }, no),
        h("button", { class: `p-btn ${danger ? "danger" : "primary"}`, "data-act": "yes", onclick: () => answer(true, close) }, yes))),
    () => { if (!answered) resolve(false); });
  });
}

/** A small choice sheet; resolves the chosen id or null. */
function choose(ctx, title, text, options) {
  return new Promise((resolve) => {
    let done = false;
    pSheet(ctx, (c, close) => h("div", { "data-id": "choose" },
      h("h2", {}, title), h("p", { class: "p-muted" }, text),
      ...options.map(([id, label]) => h("button", { class: "p-btn block", "data-choose": id, onclick: () => { done = true; close(); resolve(id); } }, label)),
      h("button", { class: "p-btn ghost block", onclick: () => close() }, "Zpět")), () => { if (!done) resolve(null); });
  });
}

/* ------------------------------------------------------------------ Upravit úkoly */

/** The tasks a parent can still change: daily tasks that are not archived (on or switched off) and the one-off tasks not done yet.
 *  A task for more children is one row with the children's chips. filter = "" (all) or a child id. */
export function editableTasks(view, cat, filter = "") {
  const info = view.tasks_info || {};
  const eff = Object.fromEntries((info.tasks || cat.tasks).map((t) => [t.id, t]));
  const allKids = cat.kids.map((k) => k.id);
  const daily = cat.tasks.filter((t) => t.period === "daily" && !t.archived).map((t) => ({ ...t, ...(eff[t.id] || {}) }))
    .filter((t) => t.enabled !== false && (t.days || []).length);
  const oneoff = (info.oneoffs || []).filter((o) => o.status === "active").map((o) => ({ ...o, period: "oneoff", kids: o.kids && o.kids.length ? o.kids : allKids }));
  return [...daily.map((t) => ({ ...t, kids: t.kids && t.kids.length ? t.kids : allKids })), ...oneoff].filter((t) => !filter || t.kids.includes(filter));
}

function editScreen(ctx) {
  const allKids = ctx.cat.kids.map((k) => k.id);
  const filter = ctx.ui.pfilter || "";
  const root = h("div", { "data-id": "edit-tasks" }, backBar(ctx, "Upravit aktivní"));
  if (ctx.cat.kids.length > 1) root.append(seg([["", "Vše"], ...ctx.cat.kids.map((k) => [k.id, k.name])], filter, (v) => { ctx.ui.pfilter = v; ctx.rerender(); }, "kidfilter"));
  const list = card();
  const tasks = editableTasks(ctx.view, ctx.cat, filter);
  if (!tasks.length) list.append(h("div", { class: "p-muted" }, "Žádné úkoly."));
  for (const t of tasks) {
    list.append(h("button", { class: "p-row tap", "data-edit": t.id, onclick: () => go(ctx, "config", { cfg: { mode: "edit", ...configOf(t, allKids) }, task: t, from: "edit" }) },
      h("div", { class: "grow" }, h("div", { class: "p-title" }, t.name), h("div", { class: "p-muted" }, `${t.period === "daily" ? "Denní" : "Jednorázový"}${t.single ? " · Pouze 1" : ""} · +${t.reward}`),
        h("div", { class: "p-kids" }, t.kids.map((k) => h("span", { class: "p-kidchip" }, kidName(ctx, k))))),
      icon("mdi:chevron-right", 22)));
  }
  root.append(list);
  return root;
}

/* ------------------------------------------------------------------ Nastavení */

function settingsTab(ctx) {
  const out = [];
  const kidsSec = h("div", { class: "p-section", "data-id": "kid-cards" }, h("h3", {}, "Děti"));
  for (const k of ctx.cat.kids) {
    const kid = ctx.view.kids[k.id];
    if (!kid) continue;
    kidsSec.append(h("div", { class: "p-card", "data-kid": k.id },
      h("div", { class: "p-row" }, h("div", { class: "grow" }, h("div", { class: "p-title" }, k.name), h("div", { class: "p-muted" }, kid.hero ? kid.hero.name : "Hrdina ještě není vytvořen")),
        h("div", { class: "p-coins", "data-coins": k.id }, coin(), ` ${kid.coins}`))));
  }
  out.push(kidsSec);
  out.push(h("div", { class: "p-section" }, rowList(ctx, SETTINGS_ROWS)));
  return out;
}

/* Nastavení: "Nastavení hry" first (addendum 1); its own rows lead to Zlaťáky, Schvalování úkolů, Prázdniny, Reset hrdiny (addendum 2). */
const SETTINGS_ROWS = [["game", "Nastavení hry", "mdi:cog-outline"], ["history", "Historie", "mdi:history"], ["notify", "Notifikace", "mdi:bell-outline"],
  ["story", "Příběh (místa a jména)", "mdi:book-open-variant"], ["guide", "Průvodce nastavením", "mdi:map-marker-path"]];
export const GAME_ROWS = [["coins", "Zlaťáky", "mdi:plus-minus"], ["approvals", "Schvalování úkolů", "mdi:check-decagram-outline"],
  ["holidays", "Prázdniny", "mdi:beach"], ["reset", "Reset hrdiny", "mdi:account-reactivate-outline"], ["report", "Kam hlásit problémy", "mdi:bug-outline"],
  ["ha", "Úkoly z Home Assistantu", "mdi:home-assistant"]];

function rowList(ctx, rows, from = null) {
  return card(...rows.map(([id, label, ic]) =>
    h("button", { class: "p-row tap", "data-settings": id, onclick: () => go(ctx, id, from ? { from } : {}) }, icon(ic, 22), h("div", { class: "grow" }, label), icon("mdi:chevron-right", 22))));
}

function gameScreen(ctx) {
  return h("div", { "data-screen": "game" }, backBar(ctx, "Nastavení hry"), rowList(ctx, GAME_ROWS, "game"));
}

function coinsScreen(ctx) {
  const list = card();
  for (const k of ctx.cat.kids) {
    const kid = ctx.view.kids[k.id];
    if (!kid) continue;
    list.append(h("div", { class: "p-row", "data-kid": k.id },
      h("div", { class: "grow" }, h("div", { class: "p-title" }, k.name), h("div", { class: "p-muted", "data-coins": k.id }, coin(), ` ${kid.coins}`)),
      h("button", { class: "p-btn", "data-act": "adjust-custom", onclick: () => adjustSheet(ctx, k) }, icon("mdi:plus-minus", 20), "Změnit")));
  }
  return h("div", { "data-screen": "coins" }, backBar(ctx, "Zlaťáky", "game"), list);
}

function approvalsScreen(ctx) {
  const list = card();
  for (const k of ctx.cat.kids) {
    const kid = ctx.view.kids[k.id];
    if (!kid) continue;
    list.append(h("div", { class: "p-row", "data-kid": k.id },
      h("div", { class: "grow" }, h("div", { class: "p-title" }, k.name), h("div", { class: "p-muted small" }, kid.require_approval ? "Hotový úkol čeká, až ho schválíš." : "Hotový úkol se hned započítá.")),
      h("button", { class: `p-switch${kid.require_approval ? " on" : ""}`, role: "switch", "aria-checked": String(!!kid.require_approval), "aria-pressed": String(!!kid.require_approval), "aria-label": `Schvalovat (${k.name})`, "data-act": "approval",
        onclick: () => ctx.act("set_approval", { kid_id: k.id, value: !kid.require_approval }) }, h("span", {}))));
  }
  return h("div", { "data-screen": "approvals" }, backBar(ctx, "Schvalování úkolů", "game"),
    h("p", { class: "p-muted small" }, "Když je schvalování zapnuté, hotové úkoly čekají v Přehledu v sekci Ke schválení."), list);
}

/** Reset hrdiny (addendum 2, before: Smazat hrdinu on the child's card): pick a child, the same confirmation and the same reset_hero. */
function resetScreen(ctx) {
  const list = card();
  for (const k of ctx.cat.kids) {
    const kid = ctx.view.kids[k.id];
    if (!kid) continue;
    list.append(h("div", { class: "p-row", "data-kid": k.id },
      h("div", { class: "grow" }, h("div", { class: "p-title" }, k.name), h("div", { class: "p-muted" }, kid.hero ? kid.hero.name : "Hrdina ještě není vytvořen")),
      kid.hero ? h("button", { class: "p-btn danger-ghost", "data-act": "reset-hero", onclick: async () => {
        const yes = await pConfirm(ctx, { title: `Smazat hrdinu (${k.name})?`, text: "Zlaťáky a věci zůstanou, hrdina si vybere vzhled znovu.", yes: "Smazat hrdinu", no: "Zpět", danger: true });
        if (yes) await ctx.act("reset_hero", { kid_id: k.id });
      } }, "Resetovat") : null));
  }
  return h("div", { "data-screen": "reset" }, backBar(ctx, "Reset hrdiny", "game"),
    h("p", { class: "p-muted small" }, "Dítě si vytvoří hrdinu znovu (vzhled a jméno) a znovu si nasadí výbavu. Zlaťáky, věci a splněné úkoly zůstanou."), list);
}

/** #175 Kam hlásit problémy: the GitHub repository "Nahlásit problém" opens (empty = the default of the package). */
function reportScreen(ctx) {
  const st = ctx.view.settings || {};
  const def = st.report_repo_default || "";
  const own = st.report_repo && st.report_repo !== def ? st.report_repo : "";
  const field = h("input", { class: "p-field", type: "text", value: own, placeholder: def, "data-field": "report-repo", autocapitalize: "off", autocorrect: "off", spellcheck: "false", "aria-label": "Repozitář na GitHubu" });
  return h("div", { "data-screen": "report" }, backBar(ctx, "Kam hlásit problémy", "game"),
    h("p", { class: "p-muted small" }, "Tlačítko „Nahlásit problém“ v O hře otevře nové hlášení na GitHubu v tomto repozitáři. Zadejte vlastník/název, např. ",
      h("code", {}, "eloupak/homequest-feedback"), ". Prázdné pole = výchozí ", h("code", {}, def), "."),
    card(h("div", { class: "p-fieldrow" }, h("label", { class: "p-label" }, "Repozitář na GitHubu"), field)),
    h("div", { class: "p-actions" },
      h("button", { class: "p-btn primary", "data-act": "report-repo-save", onclick: async () => {
        if (await ctx.act("set_report_repo", { repo: field.value.trim() || null })) ctx.toast("Uloženo.");
      } }, "Uložit")));
}

/** v1.8 (#173, #166): the children's To-do lists in HA; the reward of a task a parent or an automation adds straight into a child's list. */
function haTasksScreen(ctx) {
  const st = ctx.view.settings || {};
  const val = st.ha_task_reward == null ? 1 : st.ha_task_reward;
  const field = h("input", { class: "p-field num", type: "number", inputmode: "numeric", min: "0", max: "50", value: String(val), "data-field": "ha-reward", "aria-label": "Odměna za úkol přidaný v HA" });
  return h("div", { "data-screen": "ha" }, backBar(ctx, "Úkoly z Home Assistantu", "game"),
    h("p", { class: "p-muted small" }, "Každé dítě má v Home Assistantu svůj seznam úkolů (To-do lists, ", h("code", {}, "todo.homequest_…"),
      "). Odškrtnutí tam = Hotovo ve hře. Rodič nebo automatizace tam může přidat úkol, dítě dostane jednorázový úkol s touto odměnou. Automatizace mohou použít i akci ",
      h("code", {}, "homequest.add_task"), " s vlastní odměnou."),
    card(h("div", { class: "p-fieldrow" }, h("label", { class: "p-label" }, "Odměna za úkol přidaný v HA"), field)),
    h("div", { class: "p-actions" },
      h("button", { class: "p-btn primary", "data-act": "ha-reward-save", onclick: async () => {
        const n = parseInt(field.value, 10);
        if (!Number.isInteger(n) || n < 0 || n > 50) { ctx.toast("Zadej celé číslo 0–50."); return; }
        if (await ctx.act("set_ha_reward", { reward: n })) ctx.toast("Uloženo.");
      } }, "Uložit")));
}

/** The facts "Nahlásit problém" fills in (technical only). */
export function reportFacts(ctx) {
  const v = (ctx.view.update && ctx.view.update.installed) || ctx.view.version || "";
  const b = ctx.view.build ? String(ctx.view.build).split(" ") : null;
  return { hq: b ? `${v} (TEST ${b[0]} ${b[1]})` : v, ha: ctx.haVersion, ua: typeof navigator !== "undefined" ? navigator.userAgent : "", lang: ctx.lang };
}

function adjustSheet(ctx, kidInfo) {
  let mode = "add";                                                       // iOS has no minus on the number pad: Přidat / Odebrat + a positive number
  pSheet(ctx, (c, close) => {
    const kid = c.view.kids[kidInfo.id];
    const delta = h("input", { class: "p-field num", type: "number", inputmode: "numeric", min: "1", placeholder: "3", "data-field": "delta", "aria-label": "Počet zlaťáků" });
    const note = h("input", { class: "p-field", type: "text", maxlength: "100", placeholder: "Důvod (nepovinný)", "data-field": "note" });
    const sign = seg([["add", "Přidat"], ["sub", "Odebrat"]], mode, (v) => {
      mode = v;
      for (const b of sign.querySelectorAll("button")) b.setAttribute("aria-selected", String(b.dataset.segId === v));
    }, "adjust-mode");
    return h("div", { "data-id": "adjust" },
      h("h2", {}, `Zlaťáky: ${kidInfo.name}`),
      h("div", { class: "p-muted" }, "Teď má: ", coin(), ` ${kid ? kid.coins : 0}. Odebrat smí i pod nulu.`),
      h("div", { class: "p-fieldrow" }, sign),
      h("div", { class: "p-fieldrow p-inline" }, delta, coin()), h("div", { class: "p-fieldrow" }, note),
      h("div", { class: "p-actions" },
        h("button", { class: "p-btn ghost", onclick: close }, "Zrušit"),
        h("button", { class: "p-btn primary", "data-act": "adjust-save", onclick: async () => {
          const n = Math.abs(parseInt(delta.value, 10));
          if (!n) return c.toast("Napiš počet zlaťáků, např. 3.", "error");
          close();
          await c.act("admin_adjust", { kid_id: kidInfo.id, delta: mode === "sub" ? -n : n, note: note.value.trim() });
        } }, "Uložit")));
  });
}

function historyScreen(ctx) {
  const root = h("div", { "data-screen": "history" }, backBar(ctx, "Historie"));
  const hk = ctx.ui.histKid && ctx.view.kids[ctx.ui.histKid] ? ctx.ui.histKid : ctx.cat.kids[0] && ctx.cat.kids[0].id;
  if (ctx.cat.kids.length > 1) root.append(seg(ctx.cat.kids.map((k) => [k.id, k.name]), hk, (v) => { ctx.ui.histKid = v; ctx.rerender(); }, "histkid"));
  const entries = hk && ctx.view.kids[hk] ? ctx.view.kids[hk].history.slice().reverse().slice(0, 30) : [];
  const list = card();
  if (!entries.length) list.append(h("div", { class: "p-muted" }, "Zatím nic."));
  for (const e of entries) list.append(h("div", { class: "p-row hist" }, h("span", { class: "p-muted t" }, when(e.ts)), h("span", { class: "grow" }, historyText(e, ctx.cat))));
  root.append(list);
  return root;
}

function subScreen(ctx, pv) {
  if (pv.name === "config") return configScreen(ctx, pv);
  if (pv.name === "edit") return editScreen(ctx);
  if (pv.name === "history") return historyScreen(ctx);
  if (pv.name === "game") return gameScreen(ctx);
  if (pv.name === "coins") return coinsScreen(ctx);
  if (pv.name === "approvals") return approvalsScreen(ctx);
  if (pv.name === "reset") return resetScreen(ctx);
  if (pv.name === "report") return reportScreen(ctx);
  if (pv.name === "ha") return haTasksScreen(ctx);
  const titles = { holidays: "Prázdniny", notify: "Notifikace", story: "Příběh", guide: "Průvodce nastavením" };
  const root = h("div", { "data-screen": pv.name }, backBar(ctx, titles[pv.name] || "", pv.from));
  const wrap = h("div", { class: "p-legacy" });            // the cards of v1.5/v1.6 (settings.js, setup.js) inside the sober frame
  if (pv.name === "holidays") wrap.append(h("p", { class: "p-muted", "data-id": "holidays-hint" }, "Během prázdnin se úkoly chovají jako ve volné dny."), holidaysCard(ctx));
  else if (pv.name === "guide") wrap.append(renderSetup(ctx));
  else {
    const want = { notify: ["settings-notify"], story: ["settings-story"] }[pv.name] || [];
    for (const sec of settingsSections(ctx)) if (want.includes(sec.dataset.id)) wrap.append(sec);
    if (!wrap.childNodes.length) wrap.append(card(h("div", { class: "p-muted" }, "Zatím tu nic není.")));
  }
  root.append(wrap);
  return root;
}

/* ------------------------------------------------------------------ O hře */

function aboutTab(ctx) {
  const v = (ctx.view.update && ctx.view.update.installed) || ctx.view.version || "";
  const b = ctx.view.build ? String(ctx.view.build).split(" ") : null;          // TEST: "<branch> <commit> <date> <time>" from deploy.sh test
  return h("div", { class: "p-section", "data-id": "about" },
    card(
      h("div", { class: "p-row" }, h("div", { class: "grow" }, h("strong", {}, "HomeQuest")),
        h("div", { "data-id": "version" }, b ? `TEST · ${b[0]} ${b[1]}` : v ? `verze ${v}` : "verze neznámá")),
      b ? h("div", { class: "p-muted small", "data-id": "build" }, `nasazeno ${b.slice(2).join(" ")}${v ? ` · manifest ${v}` : ""}`) : null,
      h("p", {}, "Domácí úkoly jako dobrodružství."),
      h("div", { class: "p-label" }, "Úkoly v Home Assistantu"),
      h("p", { "data-id": "ha-todo" }, "Každé dítě má v Home Assistantu seznam úkolů (Seznamy úkolů, todo.homequest_…). Odškrtnutí tam = Hotovo ve hře. Automatizace přidá úkol akcí homequest.add_task, např. když dopere pračka. Podrobnosti v Nastavení hry → Úkoly z Home Assistantu."),
      h("div", { class: "p-label" }, "Licence"),
      h("p", { "data-id": "license" }, "CC BY-NC-ND 4.0: hru můžete zdarma používat doma a dál ji šířit beze změny a s uvedením autora. Nesmí se prodávat ani upravovat a šířit upravená."),
      h("a", { class: "p-link", href: LICENSE_URL, target: "_blank", rel: "noopener" }, "Plné znění licence")),
    h("a", { class: "p-btn block", "data-act": "report-problem", href: reportUrl((ctx.view.settings || {}).report_repo || "eloupak/homequest-dist", reportFacts(ctx)), target: "_blank", rel: "noopener" },
      icon("mdi:bug-outline", 22), "Nahlásit problém"),
    h("p", { class: "p-muted small", "data-id": "report-hint" }, "Otevře nové hlášení na GitHubu s verzí hry a Home Assistantu, bez jmen. Kam se hlásí, změníte v Nastavení hry."),
    h("button", { class: "p-btn block", "data-act": "bench", onclick: () => ctx.bench && ctx.bench() }, icon("mdi:speedometer", 22), "Test výkonu telefonu"),
    h("p", { class: "p-muted small", "data-id": "bench-hint" }, "Přehraje přerod tvrze a chvíli bitvy naprázdno a změří, jak plynule to tento telefon zvládá. Nic se neukládá. Na telefonu dítěte: třikrát klepnout na nápis HomeQuest nahoře."));
}
