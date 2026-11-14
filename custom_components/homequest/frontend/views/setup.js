/* The setup guide of a new family (v1.6, #137) and the parent's settings of the children and parents (#136).
 *
 * A standalone view: renderSetup(ctx) is the whole guide (the Rodič tab shows it until "Spustit hru"); kidsCard / parentsCard are reused by
 * Settings after the start. It does not depend on the layout of the Rodič screen (#129 A/B: a tab or an accordion can host it as it is).
 * Data: view.setup (only for a parent), the HA users from homequest/setup_users when a step needs them. The commands go to ctx.api directly
 * (no kid_id: a child of the guide may not be a child of the live game yet, on TEST the guide works on a copy of the state). */
import { h, icon } from "../lib/dom.js";
import { phoneRows, storyVarFields, storyVarsToSave } from "./settings.js";

/** An icon with a colour (a green tick, a red warning). */
function ic(name, size, color) {
  const el = icon(name, size);
  if (color) el.style.color = color;
  return el;
}

export const STEPS = [
  { id: "kids", title: "Děti", required: true },
  { id: "accounts", title: "Účty a panely", required: true },
  { id: "parents", title: "Rodiče", required: true },
  { id: "place", title: "Vaše okolí", required: false },
  { id: "notify", title: "Notifikace", required: true },
  { id: "optional", title: "Volitelné", required: false },
];

/** The rows of the step list: done (a green tick), required, and which step to open first (the first required one not done). Pure, tested in node. */
export function stepRows(setup) {
  const steps = (setup && setup.steps) || {};
  const rows = STEPS.map((s, i) => ({ ...s, n: i + 1, done: !!steps[s.id] }));
  const next = rows.find((r) => r.required && !r.done) || rows.find((r) => !r.done) || null;
  return { rows, next: next ? next.id : null };
}

/** The hero's body as the guide shows it. */
export const BODY_LABEL = { male: "kluk", female: "holka" };

/** Which HA users a child's account can be: active, not an HA admin, not the account of another child. Pure, tested in node. */
export function accountChoices(users, kidId) {
  return (users || []).filter((u) => u.active !== false && !u.is_admin && (!u.kid || u.kid === kidId));
}

/** The value a child's `ha_user` stores for an HA user: the login name, else the display name. */
export function accountValue(u) {
  return (u && (u.username || u.name)) || "";
}

/** Error texts of the guide. */
function errText(e) {
  const m = (e && e.message) || "";
  if (e && e.code === "confirm_required") return "Děti už mají zlaťáky nebo splněné úkoly. Pro start od nuly je potřeba druhé potvrzení.";
  if (m.includes("another child")) return "Tenhle účet už má jiné dítě.";
  if (m.includes("only before the game starts")) return "To jde změnit jen před spuštěním hry.";
  if (m.includes("finish the steps")) return "Nejdřív dokončete povinné kroky.";
  if (m.includes("cannot be a parent")) return "Účet dítěte nemůže být rodič.";
  return m || "Nepodařilo se uložit.";
}

async function call(ctx, type, data = {}, ok = null) {
  try {
    const res = await ctx.api.call(type, data);
    if (ok) ctx.toast(ok);
    return res || {};
  } catch (e) {
    ctx.toast(errText(e), "error");
    return null;
  }
}

/** The HA users, loaded once per opened guide (ctx.ui.setupUsers); re-render when they arrive. */
function users(ctx) {
  if (ctx.ui.setupUsers === undefined) {
    ctx.ui.setupUsers = null;
    ctx.api.call("setup_users").then(
      (r) => { ctx.ui.setupUsers = r.users || []; ctx.rerender(); },
      () => { ctx.ui.setupUsers = []; ctx.rerender(); }
    );
  }
  return ctx.ui.setupUsers;
}

/* -------------------------------------------------------------- the guide */

export function renderSetup(ctx) {
  const st = ctx.view.setup;
  const root = h("div", { "data-id": "setup" });
  if (!st) return root;
  const { rows, next } = stepRows(st);
  if (ctx.ui.setupOpen === undefined) ctx.ui.setupOpen = next;
  root.append(
    h("div", { class: "section" },
      h("h2", {}, "Průvodce nastavením"),
      st.sandbox ? sandboxNote(ctx) : null,
      h("div", { class: "card" },
        h("p", { style: { margin: "0 0 8px" } }, "Než děti začnou hrát, projděte pár kroků. Povinné kroky mají hvězdičku, zelená fajfka = hotovo."),
        h("div", { class: "setup-steps", "data-id": "setup-steps" }, ...rows.map((r) => stepHead(ctx, r)))
      )
    )
  );
  for (const r of rows) if (ctx.ui.setupOpen === r.id) root.append(stepBody(ctx, st, r));
  root.append(startCard(ctx, st));
  return root;
}

function sandboxNote(ctx) {
  return h("div", { class: "card", "data-id": "setup-sandbox", style: { background: "#fde7c2", marginBottom: "10px" } },
    h("b", {}, "TEST: "), "průvodce pracuje s kopií dat. Děti, zlaťáky ani panely na TESTu se nezmění.",
    h("div", { style: { height: "8px" } }),
    h("button", { class: "btn ghost", "data-act": "setup-sandbox-reset", onclick: () => call(ctx, "setup_reset_sandbox", {}, "Kopie obnovena.") }, icon("mdi:restore", 20), "Začít znovu z kopie"));
}

function stepHead(ctx, r) {
  const open = ctx.ui.setupOpen === r.id;
  return h("div", {},
    h("button", { class: "row setup-step", "data-step": r.id, "data-done": String(r.done), "aria-expanded": String(open), style: { width: "100%", minHeight: "44px", gap: "10px", background: "transparent", color: "inherit", textAlign: "left" },
      onclick: () => { ctx.ui.setupOpen = open ? null : r.id; ctx.rerender(); } },
      ic(r.done ? "mdi:check-circle" : "mdi:checkbox-blank-circle-outline", 24, r.done ? "#2e7d32" : null),
      h("span", { class: "grow" }, `${r.n}. ${r.title}`, r.required ? " *" : h("span", { class: "muted" }, " (nepovinné)")),
      icon(open ? "mdi:chevron-up" : "mdi:chevron-down", 22)));
}

function stepBody(ctx, st, r) {
  const sec = h("div", { class: "section", "data-id": `setup-${r.id}` }, h("h2", {}, `${r.n}. ${r.title}`));
  if (r.id === "kids") sec.append(kidsCard(ctx, st));
  else if (r.id === "accounts") sec.append(accountsCard(ctx, st));
  else if (r.id === "parents") sec.append(parentsCard(ctx, st));
  else if (r.id === "place") sec.append(placeCard(ctx, st));
  else if (r.id === "notify") sec.append(notifyCard(ctx, st));
  else sec.append(optionalCard(ctx, st));
  return sec;
}

function nextBtn(ctx, step) {
  const { rows } = stepRows(ctx.view.setup);
  const i = rows.findIndex((r) => r.id === step);
  const nxt = rows[i + 1];
  return nxt ? h("button", { class: "btn ghost block", "data-act": "setup-next", onclick: () => { ctx.ui.setupOpen = nxt.id; ctx.rerender(); } }, "Další krok: ", nxt.title) : null;
}

/* ------------------------------------------------------------- children */

/** The children: a line each (name, how the story calls them, the hero) with Upravit; a form for a new child. Also in Settings after the start. */
export function kidsCard(ctx, st) {
  const card = h("div", { class: "card", "data-id": "setup-kids-card" });
  if (!st.kids.length) card.append(h("p", { class: "muted", style: { marginTop: 0 } }, "Zatím žádné dítě. Přidejte každé dítě, které bude hrát."));
  for (const k of st.kids) {
    if (ctx.ui.setupEdit === k.id) {
      card.append(kidForm(ctx, st, k));
      continue;
    }
    card.append(h("div", { class: "row", "data-kid-row": k.id, style: { gap: "10px", minHeight: "52px", borderBottom: "1px solid #0002" } },
      icon(k.hero && k.hero.body === "female" ? "mdi:face-woman" : "mdi:face-man", 28),
      h("div", { class: "grow" },
        h("b", {}, k.name), h("span", { class: "muted" }, ` · oslovení „${k.vocative}“`),
        h("div", { class: "muted" }, `hrdina ${k.hero ? k.hero.name : "–"} (${BODY_LABEL[(k.hero || {}).body] || "?"})`)),
      h("button", { class: "btn ghost", "data-act": "kid-edit", onclick: () => { ctx.ui.setupEdit = k.id; ctx.rerender(); } }, "Upravit")));
  }
  if (ctx.ui.setupEdit === "new") card.append(kidForm(ctx, st, null));
  else card.append(h("div", { style: { height: "8px" } }), h("button", { class: "btn gold block", "data-act": "kid-add", onclick: () => { ctx.ui.setupEdit = "new"; ctx.rerender(); } }, icon("mdi:account-plus", 22), "Přidat dítě"));
  if (!st.started) { const n = nextBtn(ctx, "kids"); if (n && st.kids.length) card.append(h("div", { style: { height: "8px" } }), n); }
  return card;
}

function field(label, attrs, hint) {
  const input = h("input", { class: "field", type: "text", maxlength: "20", ...attrs });
  return { input, el: h("label", { style: { display: "block", margin: "10px 0 2px" } }, h("b", {}, label), hint ? h("div", { class: "muted", style: { fontWeight: "normal" } }, hint) : null, input) };
}

function kidForm(ctx, st, k) {
  const hero = (k && k.hero) || {};
  const name = field("Jméno dítěte", { value: k ? k.name : "", "data-f": "name", placeholder: "Karel" }, "např. Karel");
  const voc = field("Oslovení", { value: k ? k.vocative : "", "data-f": "vocative", placeholder: "Karle" }, "Jak dítě příběh osloví (5. pád): „Karle, pojď sem!“");
  const heroName = field("Jméno hrdiny", { value: hero.name || "", "data-f": "hero_name", placeholder: "Kája" }, "např. Kája · hrdina, za kterého dítě hraje (prázdné = stejné jako jméno)");
  let body = hero.body || ctx.ui.setupBody || "male";
  const locked = !!st.started && !!k;
  const bodyBtns = h("div", { class: "row", style: { gap: "8px", marginTop: "4px" } });
  const drawBody = () => bodyBtns.replaceChildren(...["male", "female"].map((b) =>
    h("button", { class: "opt", type: "button", "data-body": b, "aria-pressed": String(body === b), disabled: locked && b !== body ? "" : null, onclick: () => { if (!locked) { body = b; drawBody(); } } },
      body === b ? icon("mdi:check-bold", 20) : null, b === "male" ? "Kluk" : "Holka")));
  drawBody();
  const save = async () => {
    const data = { name: name.input.value, vocative: voc.input.value, hero_name: heroName.input.value || name.input.value };
    if (!locked) data.body = body;
    const res = await call(ctx, "setup_kid", k ? { child: k.id, data } : { data }, k ? "Uloženo." : "Dítě přidáno.");
    if (res) { ctx.ui.setupEdit = null; ctx.ui.setupUsers = undefined; ctx.rerender(); }
  };
  const remove = k && !st.started ? h("button", { class: "btn ghost", "data-act": "kid-remove", onclick: async () => {
    if (await ctx.confirm({ title: `Odebrat ${k.name}?`, text: "Dítě zmizí z průvodce. Jde to jen před spuštěním hry.", yes: "Odebrat", danger: true })) {
      if (await call(ctx, "setup_remove_kid", { child: k.id }, "Odebráno.")) { ctx.ui.setupEdit = null; ctx.rerender(); }
    }
  } }, icon("mdi:delete", 20), "Odebrat") : null;
  return h("div", { class: "setup-form", "data-id": k ? `kid-form-${k.id}` : "kid-form-new", style: { padding: "6px 0 10px", borderBottom: "1px solid #0002" } },
    name.el, voc.el, heroName.el,
    h("div", { style: { margin: "10px 0 2px" } }, h("b", {}, "Hrdina je"), locked ? h("div", { class: "muted" }, "Po spuštění hry se už nemění (oblečení a účesy patří k postavě).") : null),
    bodyBtns,
    h("div", { class: "actions", style: { marginTop: "12px" } },
      h("button", { class: "btn ghost", "data-act": "kid-cancel", onclick: () => { ctx.ui.setupEdit = null; ctx.rerender(); } }, "Zrušit"),
      remove,
      h("button", { class: "btn gold", "data-act": "kid-save", onclick: save }, icon("mdi:content-save", 20), "Uložit")));
}

/* ------------------------------------------------------------- accounts */

function accountsCard(ctx, st) {
  const card = h("div", { class: "card", "data-id": "setup-accounts-card" });
  card.append(h("p", { style: { marginTop: 0 } }, "Každé dítě se přihlašuje vlastním účtem Home Assistantu (bez práv správce). Účty se zakládají v Home Assistantu: ",
    h("b", {}, "Nastavení → Lidé → Přidat osobu"), " (zapnout „Povolit přihlášení“). Pak tady účet vyberte."));
  if (!st.kids.length) {
    card.append(h("p", { class: "muted" }, "Nejdřív přidejte děti (krok 1)."));
    return card;
  }
  const list = users(ctx);
  if (list === null) {
    card.append(h("div", { class: "muted" }, "Načítám účty…"));
    return card;
  }
  for (const k of st.kids) {
    const choices = accountChoices(list, k.id);
    const current = k.ha_user || "";
    const sel = h("select", { class: "field", "data-account": k.id, onchange: async (ev) => {
      if (await call(ctx, "setup_kid", { child: k.id, data: { ha_user: ev.target.value || null } }, "Účet uložen.")) { ctx.ui.setupUsers = undefined; ctx.rerender(); }
    } },
      h("option", { value: "" }, "– vyberte účet –"),
      ...choices.map((u) => h("option", { value: accountValue(u), selected: accountValue(u).toLowerCase() === current.toLowerCase() ? "" : null }, u.username && u.username !== u.name ? `${u.name} (${u.username})` : u.name)),
      current && !choices.some((u) => accountValue(u).toLowerCase() === current.toLowerCase()) ? h("option", { value: current, selected: "" }, `${current} (nenalezen)`) : null);
    card.append(h("div", { "data-account-row": k.id, style: { padding: "8px 0", borderBottom: "1px solid #0002" } },
      h("div", { class: "row", style: { gap: "8px" } }, ic(k.ha_user_ok ? "mdi:check-circle" : "mdi:alert-circle", 22, k.ha_user_ok ? "#2e7d32" : "#8a2d28"), h("b", { class: "grow" }, k.name)),
      sel,
      h("div", { class: "muted", style: { marginTop: "4px" } }, k.ha_user_ok ? "Panel pro hraní na rodičově telefonu: " : "Bez účtu dítě hrát nemůže. Panel: ", h("code", {}, k.panel))));
  }
  if (!choices0(list)) card.append(h("p", { class: "muted" }, "Home Assistant zatím nemá žádný účet bez práv správce. Založte dětem účty a stránku obnovte."));
  card.append(h("div", { style: { height: "8px" } }), h("button", { class: "btn ghost", "data-act": "accounts-refresh", onclick: () => { ctx.ui.setupUsers = undefined; ctx.rerender(); } }, icon("mdi:refresh", 20), "Načíst účty znovu"));
  const n = nextBtn(ctx, "accounts");
  if (n && !st.started) card.append(h("div", { style: { height: "8px" } }), n);
  return card;
}

function choices0(list) {
  return (list || []).some((u) => !u.is_admin && u.active !== false);
}

/* -------------------------------------------------------------- parents */

/** Who may approve tasks and open Rodič: every HA admin always, other HA users when ticked here. Also in Settings after the start. */
export function parentsCard(ctx, st, { lazy = false } = {}) {
  const card = h("div", { class: "card", "data-id": "setup-parents-card" });
  card.append(h("p", { style: { marginTop: 0 } }, "Rodič schvaluje úkoly a nastavuje hru. Správce Home Assistantu je rodičem vždy; další dospělé zaškrtněte."));
  if (lazy && !ctx.ui.parentsOpen) {            // Settings: the HA users are loaded on demand (their arrival re-renders the page: a PIN being typed would be lost)
    card.append(h("div", { class: "muted" }, `Další rodiče kromě správců: ${(st.parents || []).length}`), h("div", { style: { height: "8px" } }),
      h("button", { class: "btn ghost", "data-act": "parents-open", onclick: () => { ctx.ui.parentsOpen = true; ctx.ui.setupUsers = undefined; ctx.rerender(); } }, "Upravit rodiče…"));
    return card;
  }
  const list = users(ctx);
  if (list === null) {
    card.append(h("div", { class: "muted" }, "Načítám účty…"));
    return card;
  }
  const chosen = new Set(st.parents || []);
  const rows = list.filter((u) => u.active !== false && !u.kid);
  for (const u of rows) {
    card.append(h("label", { class: "row", "data-parent": u.id, style: { minHeight: "44px", gap: "10px" } },
      h("input", { type: "checkbox", checked: u.is_admin || chosen.has(u.id), disabled: u.is_admin ? "" : null, style: { width: "24px", height: "24px" },
        onchange: (ev) => (ev.target.checked ? chosen.add(u.id) : chosen.delete(u.id)) }),
      h("span", { class: "grow" }, u.name, u.is_admin ? h("span", { class: "muted" }, " · správce (vždy rodič)") : null)));
  }
  card.append(h("div", { style: { height: "8px" } }), h("button", { class: "btn gold block", "data-act": "parents-save", onclick: async () => {
    const ids = rows.filter((u) => !u.is_admin && chosen.has(u.id)).map((u) => u.id);
    if (await call(ctx, "set_parents", { parents: ids }, "Rodiče uloženi.") && !st.started) { ctx.ui.setupOpen = "place"; ctx.rerender(); }
  } }, icon("mdi:content-save", 22), "Uložit"));
  return card;
}

/* -------------------------------------------------- place, notifications */

function placeCard(ctx, st) {
  const sv = (ctx.view.settings || {}).story_vars;
  const card = h("div", { class: "card", "data-id": "setup-place-card" });
  card.append(h("p", { style: { marginTop: 0 } }, "Příběh se odehrává u vás doma: v obci, pod horou, kterou děti znají. Jména jsou předvyplněná, můžete je nechat, nebo napsat svoje. Pod každým polem je věta z příběhu, jak ji děti uvidí. Změníte je i později v Nastavení → Příběh."));
  const { el: fields, inputs } = storyVarFields(sv);
  card.append(fields);
  const done = () => { ctx.ui.setupOpen = "notify"; ctx.rerender(); };
  card.append(h("div", { class: "actions", style: { marginTop: "12px" } },
    h("button", { class: "btn ghost", "data-act": "place-skip", onclick: async () => { if (await call(ctx, "setup_step", { step: "place" })) done(); } }, "Přeskočit"),
    h("button", { class: "btn gold", "data-act": "place-save", onclick: async () => {
      if (st.sandbox) ctx.toast("TEST: okolí se v kopii neukládá, krok je označen.");
      else if (sv && !(await call(ctx, "set_story_vars", { vars: storyVarsToSave(Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value])), sv.defaults) }))) return;
      if (await call(ctx, "setup_step", { step: "place" }, "Uloženo.")) done();
    } }, icon("mdi:content-save", 20), "Uložit")));
  return card;
}

function notifyCard(ctx, st) {
  const card = h("div", { class: "card", "data-id": "setup-notify-card" });
  card.append(h("p", { style: { marginTop: 0 } }, "Komu přijde zpráva na telefon, když dítě splní úkol nebo úkol čeká na schválení. Telefon musí mít aplikaci Home Assistant. Klidně nevyberte žádný."));
  const box = h("div", {}, h("div", { class: "muted" }, "Načítám telefony…"));
  card.append(box);
  ctx.api.call("notify_services").then((res) => {
    const rows = phoneRows(res.services, res.targets);
    const chosen = new Set(rows.filter((r) => r.on).map((r) => r.service));
    const boxes = rows.length ? rows.map((r) => h("label", { class: "row", style: { minHeight: "44px", gap: "10px" }, "data-notify": r.service },
      h("input", { type: "checkbox", checked: r.on, style: { width: "24px", height: "24px" }, onchange: (ev) => (ev.target.checked ? chosen.add(r.service) : chosen.delete(r.service)) }),
      h("span", { class: "grow" }, r.name, r.parent ? h("span", { class: "muted" }, " · rodič") : null))) : [h("div", { class: "muted" }, "Home Assistant nezná žádný telefon s mobilní aplikací. Notifikace můžete zapnout později v Nastavení.")];
    box.replaceChildren(...boxes, h("div", { style: { height: "8px" } }), h("button", { class: "btn gold block", "data-act": "notify-confirm", onclick: async () => {
      const targets = rows.map((r) => r.service).filter((s) => chosen.has(s));
      if (st.sandbox) ctx.toast("TEST: telefony se v kopii neukládají, krok je označen.");
      else if (!(await call(ctx, "set_notify_targets", { targets }))) return;
      if (await call(ctx, "setup_step", { step: "notify" }, targets.length ? `Uloženo, telefonů: ${targets.length}.` : "Uloženo, zprávy nechodí.")) { ctx.ui.setupOpen = "optional"; ctx.rerender(); }
    } }, icon("mdi:check", 22), "Potvrdit"));
  }, () => box.replaceChildren(h("div", { class: "muted" }, "Seznam telefonů se nepodařilo načíst.")));
  return card;
}

function optionalCard(ctx, st) {
  const card = h("div", { class: "card", "data-id": "setup-optional-card" });
  const item = (ok, title, text) => h("div", { class: "row", style: { gap: "10px", alignItems: "flex-start", padding: "6px 0" } },
    ic(ok ? "mdi:check-circle" : "mdi:information", 22, ok ? "#2e7d32" : "#8a6d1e"), h("div", { class: "grow" }, h("b", {}, title), h("div", { class: "muted" }, text)));
  card.append(
    item(st.workday_ok, "Pracovní dny a svátky", st.workday_ok ? "Home Assistant zná pracovní dny (integrace Workday), denní úkoly se podle nich řídí." : "Bez integrace Workday platí pondělí až pátek jako pracovní dny. Přidat jde v Nastavení → Zařízení a služby → Workday (senzor binary_sensor.workday_sensor_cz)."),
    item(st.phones > 0, "Mobilní aplikace", st.phones > 0 ? `Home Assistant zná telefonů: ${st.phones}.` : "Pro notifikace a hraní na telefonu si nainstalujte aplikaci Home Assistant."),
    h("div", { style: { height: "8px" } }),
    h("button", { class: "btn ghost block", "data-act": "optional-ok", onclick: async () => { if (await call(ctx, "setup_step", { step: "optional" })) { ctx.ui.setupOpen = null; ctx.rerender(); } } }, "Rozumím"));
  return card;
}

/* ---------------------------------------------------------------- start */

function startCard(ctx, st) {
  const card = h("div", { class: "card", "data-id": "setup-start", style: { marginTop: "14px", textAlign: "center" } });
  card.append(h("p", { style: { marginTop: 0 } }, st.can_start ? "Vše povinné je hotové. Děti začnou od nuly: tvrz, zlaťáky i úkoly." : "„Spustit hru“ půjde po dokončení povinných kroků (*). Do té doby děti uvidí „Tvrz se staví, přijď brzy“."));
  card.append(h("button", { class: "btn gold block", "data-act": "start-game", disabled: st.can_start ? null : "", onclick: () => startGame(ctx, st) }, icon("mdi:flag-checkered", 24), "Spustit hru"));
  return card;
}

async function startGame(ctx, st) {
  const kids = st.kids.map((k) => k.name).join(", ");
  if (!(await ctx.confirm({ title: "Spustit hru?", text: `Hrát začnou: ${kids}. Tlačítko pak zmizí.`, yes: "Spustit" }))) return;
  let confirm = null;
  if (st.has_progress) {
    confirm = await typedConfirm(ctx, st.confirm_word);
    if (!confirm) return;
  }
  const res = await call(ctx, "start_game", confirm ? { confirm } : {}, st.sandbox ? "TEST: hra v kopii spuštěna." : "Hra spuštěna!");
  if (res) { ctx.ui.setupOpen = undefined; ctx.rerender(); }
}

/** The second confirmation over existing progress: the parent types the word (resolves with it, or null). */
function typedConfirm(ctx, word) {
  return new Promise((resolve) => {
    let done = false;
    ctx.sheet((_c, close) => {
      const input = h("input", { class: "field", type: "text", "data-f": "confirm-word", autocomplete: "off", placeholder: word });
      const finish = (v) => { done = true; resolve(v); close(); };
      return h("div", { class: "center", "data-id": "start-confirm" },
        h("h2", {}, "Opravdu od nuly?"),
        h("p", {}, "Děti už mají zlaťáky, věci nebo splněné úkoly. Spuštěním se jim smažou zlaťáky, věci, historie a tvrz začne znovu. Předtím se udělá záloha."),
        h("p", {}, "Pro potvrzení napište ", h("b", {}, word), ":"),
        input,
        h("div", { class: "actions" },
          h("button", { class: "btn ghost", "data-act": "no", onclick: () => finish(null) }, "Zpět"),
          h("button", { class: "btn red", "data-act": "yes", onclick: () => (input.value.trim() === word ? finish(word) : ctx.toast(`Napište ${word}.`, "error")) }, "Smazat a spustit")));
    }, () => { if (!done) resolve(null); });
  });
}

/* ------------------------------------------------- the story's paragraphs */

/** Label of a paragraph for the parent: where in the story and who speaks. Pure, tested in node. */
export function paragraphLabel(p, cast = {}) {
  const parts = p.id.split(".");
  let where = "Příběh";
  if (parts[0] === "intro") where = "Úvod";
  else if (parts[0] === "chapters") where = `Kapitola ${parts[1]}`;
  else if (parts[0] === "fortress") {
    const stage = parts[2];
    if (parts.includes("siege")) where = `Obléhání (${stage})${parts.includes("won") ? ", výhra" : parts.includes("lost") ? ", prohra" : parts.includes("choose") || parts.includes("chosen") ? ", amulet" : ""}`;
    else where = `Tvrz ${stage}${parts.includes("announce") ? ", oznámení" : ""}`;
  }
  const last = parts[parts.length - 1];
  const n = /^\d+$/.test(last) ? ` · odstavec ${Number(last) + 1}` : "";
  const who = p.giver ? ` · ${cast[p.giver] || p.giver}` : "";
  return `${where}${who}${n}`;
}

/** Settings -> Příběh: every paragraph with Upravit and Vrátit výchozí (an own text is kept apart from story.yaml: no release overwrites it). */
export function storyTextsBlock(ctx) {
  const info = ((ctx.view.settings || {}).story_texts) || { own: 0, stale: 0 };
  const wrap = h("div", { "data-id": "story-texts", style: { marginTop: "14px" } },
    h("b", {}, "Texty příběhu"),
    h("div", { class: "muted" }, `Celý odstavec můžete přepsat po svém. Vlastních odstavců: ${info.own}.`),
    info.stale ? h("div", { "data-id": "story-texts-stale", style: { color: "#8a2d28", marginTop: "4px" } }, `Pozor: u ${info.stale} vlastních odstavců se změnil výchozí text (nová verze hry). Váš text zůstal, porovnejte ho.`) : null);
  if (!ctx.ui.storyTexts) {
    wrap.append(h("div", { style: { height: "6px" } }), h("button", { class: "btn ghost", "data-act": "story-texts-open", onclick: async () => {
      const res = await call(ctx, "story_texts");
      if (res) { ctx.ui.storyTexts = res; ctx.rerender(); }
    } }, "Zobrazit odstavce…"));
    return wrap;
  }
  const { paragraphs, cast } = ctx.ui.storyTexts;
  const reload = async (msg) => {
    const res = await call(ctx, "story_texts", {}, msg);
    if (res) { ctx.ui.storyTexts = res; ctx.ui.storyEdit = null; ctx.rerender(); }
  };
  for (const p of paragraphs) {
    const row = h("div", { "data-paragraph": p.id, style: { padding: "8px 0", borderBottom: "1px solid #0002" } },
      h("div", { class: "muted" }, paragraphLabel(p, cast), p.own ? h("b", { style: { color: "#2e7d32" } }, " · vlastní") : null, p.stale ? h("b", { style: { color: "#8a2d28" } }, " · výchozí text se změnil") : null));
    if (ctx.ui.storyEdit === p.id) {
      const ta = h("textarea", { class: "field", rows: "6", maxlength: "700", "data-f": "paragraph", style: { fontSize: "17px" } });
      ta.value = p.own || p.text;
      row.append(ta,
        p.stale ? h("div", { class: "muted" }, "Nový výchozí text: ", p.text) : null,
        h("div", { class: "muted" }, "Proměnné jako {obec_kde} nebo {deti} se doplní samy."),
        h("div", { class: "actions", style: { marginTop: "8px" } },
          h("button", { class: "btn ghost", "data-act": "paragraph-cancel", onclick: () => { ctx.ui.storyEdit = null; ctx.rerender(); } }, "Zrušit"),
          p.own ? h("button", { class: "btn ghost", "data-act": "paragraph-default", onclick: async () => { if (await call(ctx, "set_story_text", { paragraph: p.id, text: null })) reload("Vrácen výchozí text."); } }, "Vrátit výchozí") : null,
          h("button", { class: "btn gold", "data-act": "paragraph-save", onclick: async () => { if (await call(ctx, "set_story_text", { paragraph: p.id, text: ta.value })) reload("Odstavec uložen."); } }, "Uložit")));
    } else {
      row.append(h("div", { style: { whiteSpace: "pre-wrap", margin: "4px 0" } }, p.shown),
        h("button", { class: "btn ghost", "data-act": "paragraph-edit", onclick: () => { ctx.ui.storyEdit = p.id; ctx.rerender(); } }, "Upravit"));
    }
    wrap.append(row);
  }
  return wrap;
}

/* ------------------------------------------------------- the child's wait */

export function renderNotStarted() {
  return h("div", { class: "card center", "data-id": "not-started", style: { textAlign: "center", padding: "28px 16px" } },
    icon("mdi:castle", 64),
    h("h2", {}, "Tvrz se staví, přijď brzy"),
    h("p", { class: "muted" }, "Rodiče ještě chystají hru. Až bude hotová, můžeš začít plnit úkoly."));
}
