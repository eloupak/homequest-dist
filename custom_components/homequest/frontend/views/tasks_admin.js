import { coin, h, icon } from "../lib/dom.js";
import { czDate } from "./quests.js";

const czShort = (iso) => (iso ? `${Number(iso.slice(8, 10))}. ${Number(iso.slice(5, 7))}.` : "");

/** An on/off switch: on = green with a tick, off = the card's colour with a thin outline (yellow stays for action buttons). */
function toggle(label, on, attrs, onclick) {
  return h("button", { class: `tgl ${on ? "on" : "off"}`, "aria-pressed": String(on), ...attrs, onclick }, on ? icon("mdi:check-bold", 20) : null, label);
}

/** "Pro koho": one choice. Nothing on = everybody; one child on = only that child; with `anyone` a third switch "Pouze 1" (anybody, but only one does it).
 * value is "" (everybody), a child id or "*" (anyone); onChange gets the new value. Tapping the one that is on switches it off. */
function whoPicker(ctx, value, attrPrefix, onChange, anyone) {
  const box = h("div", { class: "checks", "data-for": attrPrefix });
  const options = [...ctx.cat.kids.map((k) => [k.id, k.name]), ...(anyone ? [["*", "Pouze 1"]] : [])];
  const draw = () => box.replaceChildren(...options.map(([id, label]) => toggle(label, value === id, { "data-kid": `${attrPrefix}:${id}` }, () => {
    value = value === id ? "" : id;
    onChange(value);
    draw();
  })));
  draw();
  return box;
}

/** The value of whoPicker -> what the server takes (add_oneoff / save_template); everybody sends no `kids`. */
const whoParams = (who) => (who === "*" ? { single: true } : { single: false, ...(who ? { kids: [who] } : {}) });

/** Rodič → Úkoly: denní úkoly (kdy se zobrazí), prázdniny, jednorázové úkoly a jejich šablony. */
export function tasksAdmin(ctx) {
  const { view, cat } = ctx;
  const info = view.tasks_info || {};
  const root = h("div", { class: "section tadmin", "data-tasks-admin": "" }, h("h2", {}, "Úkoly"));

  // --- daily tasks: the two switches decide on which kinds of day the task shows; none = off. Counts from the next day.
  const daily = cat.tasks.filter((t) => t.period === "daily" && !t.archived);
  const dcard = h("div", { class: "card" }, h("b", {}, "Denní úkoly"), h("div", { class: "muted", style: { fontSize: "14px" } }, `Dnes je ${info.day_type === "workday" ? "pracovní den" : "víkend, svátek nebo prázdniny"}. Změna platí od zítřka.`));
  for (const t of daily) {
    const day = (key, label) => toggle(label, t.days.includes(key), { "data-day": `${t.id}:${key}` }, () => ctx.act("set_task", { task_id: t.id, [key]: !t.days.includes(key) }));
    dcard.append(
      h(
        "div",
        { class: "trow", "data-daily": t.id },
        h("div", { class: "qname", style: { fontSize: "18px", fontWeight: "bold" } }, t.name),
        t.note ? h("div", { class: "muted", style: { fontSize: "14px" } }, t.note) : null,
        h("div", { class: "checks" }, day("workday", "Pracovní den"), day("free", "Víkend a svátky")),
        cat.kids.length > 1 ? h("div", { class: "muted", style: { fontSize: "14px", marginTop: "6px" } }, "Pro koho:") : null,
        cat.kids.length > 1 ? whoPicker(ctx, t.single ? "*" : t.kids && t.kids.length < cat.kids.length ? t.kids[0] : "", `daily-${t.id}`, (who) => ctx.act("set_task", { task_id: t.id, single: who === "*", kids: who && who !== "*" ? [who] : cat.kids.map((k) => k.id) }), true) : null,
        t.days.length ? null : h("div", { class: "muted", "data-off": t.id, style: { fontSize: "14px", marginTop: "4px" } }, "Nezobrazuje se")
      )
    );
  }
  root.append(dcard);

  // --- holidays: from tomorrow to the chosen day (included); today's tasks do not change
  const hol = info.holidays_until;
  const tomorrow = (() => { const d = new Date(`${view.today}T12:00:00`); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();
  const date = h("input", { class: "field", type: "date", "data-field": "holiday-until", min: tomorrow, "aria-label": "Poslední den prázdnin", style: { flex: "1" } });
  root.append(
    h(
      "div",
      { class: "card", "data-holidays": hol || "" },
      h("b", {}, "Prázdniny"),
      h("div", { class: "muted", style: { fontSize: "14px", margin: "2px 0 8px" } }, hol ? `Prázdniny od ${czShort(info.holidays_from)} do ${czShort(hol)} Každý den je jako víkend. Vypnutí platí od zítřka.` : "Při zapnutí platí od zítřka do zvoleného dne (včetně). Dnešní úkoly se nemění."),
      hol ? null : h("label", { class: "muted", style: { fontSize: "14px", display: "block", margin: "0 0 4px" } }, "Poslední den prázdnin"),
      h(
        "div",
        { class: "row" },
        hol ? null : date,
        hol
          ? h("button", { class: "btn ghost", "data-act": "holidays-off", onclick: () => ctx.act("set_holidays", { until: null }) }, "Vypnout prázdniny")
          : h("button", { class: "btn gold", "data-act": "holidays-on", onclick: () => (date.value ? ctx.act("set_holidays", { until: date.value }) : ctx.toast("Vyber poslední den prázdnin.", "error")) }, "Zapnout")
      )
    )
  );

  // --- one-off tasks: form, templates, overview
  const name = h("input", { class: "field", type: "text", maxlength: "60", placeholder: "Název úkolu", "data-field": "oneoff-name" });
  const reward = h("input", { class: "field", type: "number", inputmode: "numeric", min: "0", max: "50", value: "1", "data-field": "oneoff-reward", style: { width: "90px" } });
  let who = "";
  const whoBox = cat.kids.length > 1 ? whoPicker(ctx, who, "oneoff", (v) => { who = v; }, true) : null;
  const form = h(
    "div",
    { class: "card", "data-oneoff-form": "" },
    h("b", {}, "Jednorázový úkol"),
    h("div", { class: "muted", style: { fontSize: "14px", margin: "2px 0 8px" } }, "Uvidí ho děti, pro které je, dokud ho nesplní (nebo ho nesmažeš)."),
    name,
    whoBox ? h("div", { class: "muted", style: { fontSize: "14px", margin: "8px 0 2px" } }, "Pro koho:") : null,
    whoBox,
    h("div", { class: "row", style: { marginTop: "8px" } }, reward, coin()),
    h(
      "button",
      {
        class: "btn gold block",
        style: { marginTop: "10px" },
        "data-act": "oneoff-add",
        onclick: async () => {
          const n = name.value.trim();
          const r = parseInt(reward.value, 10);
          if (!n) return ctx.toast("Napiš název úkolu.", "error");
          if (!(r >= 0)) return ctx.toast("Odměna musí být číslo.", "error");
          await ctx.act("add_oneoff", { name: n, reward: r, ...whoParams(who) });
        },
      },
      icon("mdi:plus-thick", 24),
      "Zadat dětem"
    )
  );
  root.append(form);

  const kidName = (id) => (cat.kids.find((k) => k.id === id) || { name: id }).name;
  const templates = info.templates || [];
  const tcard = h("div", { class: "card", "data-templates": "" }, h("b", {}, "Šablony"), h("div", { class: "muted", style: { fontSize: "14px" } }, "Jedním klepnutím znovu zadáš. Zadaný úkol se sem uloží sám."));
  if (!templates.length) tcard.append(h("div", { class: "muted", style: { marginTop: "6px" } }, "Žádné šablony."));
  for (const t of templates) {
    tcard.append(
      h(
        "div",
        { class: "tpl", "data-template": t.id },
        h("div", { class: "grow" }, h("div", { style: { fontWeight: "bold" } }, t.name), h("div", { class: "muted", style: { fontSize: "14px" } }, "+", String(t.reward), " ", coin(), t.single ? " · jen jedno dítě" : "", t.kids && t.kids.length ? ` · jen ${t.kids.map(kidName).join(", ")}` : "")),
        h("button", { class: "btn gold", "data-act": `tpl-add-${t.id}`, onclick: () => ctx.act("add_oneoff", { name: t.name, reward: t.reward, single: t.single, ...(t.kids && t.kids.length ? { kids: t.kids } : {}) }) }, "Zadat"),
        h("button", { class: "btn ghost", "aria-label": "Smazat šablonu", "data-act": `tpl-del-${t.id}`, onclick: () => ctx.act("delete_template", { template_id: t.id }) }, icon("mdi:delete", 22))
      )
    );
  }
  root.append(tcard);

  const active = (info.oneoffs || []).filter((o) => o.status === "active");
  const finished = (info.oneoffs || []).filter((o) => o.status === "done").slice(-5).reverse();
  const ocard = h("div", { class: "card", "data-oneoffs": "" }, h("b", {}, `Aktivní jednorázové úkoly (${active.length})`));
  if (!active.length) ocard.append(h("div", { class: "muted", style: { marginTop: "6px" } }, "Žádné."));
  const state = (o, kid) => {
    const st = view.kids[kid.id] && view.kids[kid.id].tasks[o.id];
    if (o.done_by[kid.id] || (st && st.status === "approved")) return "splnil";
    if (st && st.status === "pending") return "čeká na schválení";
    return st ? "zatím ne" : "—";
  };
  for (const o of active) {
    ocard.append(
      h(
        "div",
        { class: "oneoff", "data-oneoff": o.id },
        h("div", { class: "row" },
          h("div", { class: "grow" }, h("div", { style: { fontWeight: "bold" } }, o.name), h("div", { class: "muted", style: { fontSize: "14px" } }, "+", String(o.reward), " ", coin(), o.single ? " · jen jedno dítě" : " · každé dítě", o.kids && o.kids.length ? ` · jen ${o.kids.map(kidName).join(", ")}` : "")),
          h("button", {
            class: "btn ghost", "data-act": `oneoff-del-${o.id}`,
            onclick: async () => { if (await ctx.confirm({ title: `Smazat „${o.name}"?`, text: "Dětem zmizí.", yes: "Smazat", no: "Zpět", danger: true })) await ctx.act("delete_oneoff", { task_id: o.id }); },
          }, icon("mdi:delete", 22))),
        h("div", { class: "muted", style: { fontSize: "14px" } }, cat.kids.filter((k) => !(o.kids && o.kids.length) || o.kids.includes(k.id)).map((k) => `${k.name}: ${state(o, k)}`).join(" · "))
      )
    );
  }
  if (finished.length) {
    ocard.append(h("div", { class: "muted", style: { marginTop: "10px", fontSize: "14px" } }, "Hotové: " + finished.map((o) => `${o.name} (${Object.keys(o.done_by).map(kidName).join(", ")})`).join("; ")));
  }
  root.append(ocard);
  return root;
}
