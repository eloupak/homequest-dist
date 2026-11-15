import { coin, h, icon } from "../lib/dom.js";
import { czDate } from "./quests.js";

const czShort = (iso) => (iso ? `${Number(iso.slice(8, 10))}. ${Number(iso.slice(5, 7))}.` : "");

/** An on/off switch: on = green with a tick, off = the card's colour with a thin outline (yellow stays for action buttons). */
function toggle(label, on, attrs, onclick) {
  return h("button", { class: `tgl ${on ? "on" : "off"}`, "aria-pressed": String(on), ...attrs, onclick }, on ? icon("mdi:check-bold", 20) : null, label);
}

/** "Pro koho": one choice. Nothing on = everybody; one child on = only that child; with `anyone` a third switch "Pouze 1" (anybody, but only one does it).
 * value is "" (everybody), a child id or "*" (anyone); onChange gets the new value. Tapping the one that is on switches it off. */
export function whoPicker(ctx, value, attrPrefix, onChange, anyone) {
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
export const whoParams = (who) => (who === "*" ? { single: true } : { single: false, ...(who ? { kids: [who] } : {}) });

/** Rodič → Nastavení → Prázdniny (#129; before: a card of the long Rodič page). */
export function holidaysCard(ctx) {
  const { view } = ctx;
  const info = view.tasks_info || {};
  // --- holidays: from tomorrow to the chosen day (included); today's tasks do not change
  const hol = info.holidays_until;
  const tomorrow = (() => { const d = new Date(`${view.today}T12:00:00`); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();
  const date = h("input", { class: "field", type: "date", "data-field": "holiday-until", min: tomorrow, "aria-label": "Poslední den prázdnin", style: { flex: "1" } });
  return h(
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
    );
}
