/* Parent settings of v1.5 (#128): which phones get the task notifications, and the places and characters of the story (story variables).
 * Data: view.settings (only for the parent); the phone list comes from homequest/notify_services when the section is opened. */
import { h, icon } from "../lib/dom.js";
import { kidsCard, parentsCard, storyTextsBlock } from "./setup.js";

/** The phones to show: every known phone, and a chosen one HA does not know (any more) marked as missing. Pure, tested in node. */
export function phoneRows(services, targets) {
  const rows = (services || []).map((s) => ({ ...s, on: (targets || []).includes(s.service), missing: false }));
  for (const t of targets || []) if (!rows.some((r) => r.service === t)) rows.push({ service: t, name: t, parent: false, on: true, missing: true });
  return rows;
}

/** What to save from the story form: only values different from the default (a value equal to the default or empty = the default). */
export function storyVarsToSave(values, defaults) {
  const out = {};
  for (const [k, v] of Object.entries(values || {})) {
    const s = String(v || "").trim();
    if (s && s !== (defaults || {})[k]) out[k] = s;
  }
  return out;
}

const KID_SAMPLE = { deti: "Karle, Aničko", jmeno: "Karel", jeden: "Karel" };   // a child's placeholder in an example sentence (made-up names)

/** An example sentence of the story as pieces [text, isTheField]: {key} = the value being typed (else its default), other story variables =
 * their values, a child's placeholder = a made-up name. Pure, tested in node (#137). */
export function exampleParts(sentence, key, typed, values, defaults) {
  if (!sentence) return null;
  const parts = [];
  let last = 0;
  for (const m of sentence.matchAll(/\{([a-z0-9_]+)\}/g)) {
    if (m.index > last) parts.push([sentence.slice(last, m.index), false]);
    const k = m[1];
    if (k === key) parts.push([String(typed || "").trim() || (defaults || {})[k] || "…", true]);
    else parts.push([(values || {})[k] || (defaults || {})[k] || KID_SAMPLE[k] || m[0], false]);
    last = m.index + m[0].length;
  }
  if (last < sentence.length) parts.push([sentence.slice(last), false]);
  return parts;
}

/** A story form no text of the story uses (examples() on the server gives no sentence): its field is hidden, its value kept (#129 add. 2). */
export function storyVarUsed(sv, key) {
  return !(sv && sv.examples) || !!sv.examples[key];
}

/** The fields of the story variables in groups (Obec, Osada / ulice, Hora, Sedlák, Kastelán): a heading that says what it is, per form a
 * small case hint, the input and a sentence of the story that changes as the parent types. Used by the guide (Vaše okolí) and Settings. */
export function storyVarFields(sv) {
  const inputs = {};
  const wrap = h("div", { "data-id": "story-var-fields" });
  if (!sv) return { el: wrap, inputs };
  const groups = sv.groups && sv.groups.length ? sv.groups : [{ id: "all", title: "", text: "", keys: sv.order }];
  for (const g of groups) {
    const box = h("div", { class: "var-group", "data-group": g.id, style: { margin: "14px 0 4px", paddingTop: "8px", borderTop: "1px solid #0002" } },
      g.title ? h("div", { style: { fontWeight: "800", fontSize: "19px" } }, g.title) : null,
      g.text ? h("div", { class: "muted" }, g.text) : null);
    let shown = 0;
    for (const key of g.keys) {
      const sentence = (sv.examples || {})[key];
      const input = h("input", { class: "field", type: "text", maxlength: "40", value: sv.values[key] || "", placeholder: sv.defaults[key] || "", "data-var": key });
      if (!storyVarUsed(sv, key)) {            // not in the story (yet): no field, but the value goes back unchanged when saving
        inputs[key] = input;
        continue;
      }
      shown += 1;
      const ex = h("div", { class: "var-example", "data-example": key, style: { margin: "4px 2px 0", fontStyle: "italic" } });
      const draw = () => {
        const parts = exampleParts(sentence, key, input.value, sv.values, sv.defaults);
        ex.replaceChildren(...(parts ? ["„", ...parts.map(([t, own]) => (own ? h("b", { style: { fontStyle: "normal", background: "#e8b33a55", borderRadius: "4px", padding: "0 3px" } }, t) : t)), "“"]
          : [h("span", { class: "muted" }, "V příběhu se tento tvar zatím nepoužívá.")]));
      };
      input.addEventListener("input", draw);
      draw();
      inputs[key] = input;
      box.append(h("label", { style: { display: "block", margin: "10px 0 2px" } },
        h("span", { class: "muted", style: { fontSize: "14px" } }, (sv.hints || {})[key] || sv.labels[key] || key), input), ex);
    }
    if (shown) wrap.append(box);
  }
  return { el: wrap, inputs };
}

export function settingsSections(ctx) {
  const st = ctx.view.settings;
  if (!st) return [];
  const setup = ctx.view.setup;
  const out = [];
  if (setup && setup.started) {                     // v1.6: after the start the children and the parents are edited here (before: in the guide)
    out.push(h("div", { class: "section", "data-id": "settings-kids" }, h("h2", {}, "Děti"), kidsCard(ctx, setup)));
    out.push(h("div", { class: "section", "data-id": "settings-parents" }, h("h2", {}, "Rodiče"), parentsCard(ctx, setup, { lazy: true })));
  }
  return [...out, notifySection(ctx, st), storySection(ctx, st)];
}

function notifySection(ctx, st) {
  const sec = h("div", { class: "section", "data-id": "settings-notify" }, h("h2", {}, "Notifikace"));
  const card = h("div", { class: "card" });
  card.append(h("div", { class: "muted", style: { marginBottom: "8px" } }, "Komu přijde zpráva, když dítě splní úkol nebo úkol čeká na schválení."));
  const list = h("div", { "data-id": "notify-list" }, h("div", { class: "muted" }, `Vybráno telefonů: ${st.notify_targets.length}`));
  const load = async () => {
    let res;
    try {
      res = await ctx.api.call("notify_services");
    } catch (e) {
      list.replaceChildren(h("div", { class: "muted" }, "Seznam telefonů se nepodařilo načíst."));
      return;
    }
    const rows = phoneRows(res.services, res.targets);
    const chosen = new Set(rows.filter((r) => r.on).map((r) => r.service));
    if (!rows.length) {
      list.replaceChildren(h("div", { class: "muted" }, "Home Assistant nezná žádný telefon s mobilní aplikací."));
      return;
    }
    const boxes = rows.map((r) =>
      h(
        "label",
        { class: "row", style: { minHeight: "44px", gap: "10px" }, "data-notify": r.service },
        h("input", { type: "checkbox", checked: r.on, style: { width: "24px", height: "24px" }, onchange: (ev) => (ev.target.checked ? chosen.add(r.service) : chosen.delete(r.service)) }),
        h("span", { class: "grow" }, r.name, r.parent ? h("span", { class: "muted" }, " · rodič") : null, r.missing ? h("span", { style: { color: "#8a2d28" } }, " · telefon chybí") : null)
      )
    );
    const save = h("button", { class: "btn gold block", "data-act": "notify-save", onclick: async () => {
      const targets = rows.map((r) => r.service).filter((s) => chosen.has(s));
      if (await ctx.act("set_notify_targets", { targets })) ctx.toast(targets.length ? `Uloženo, telefonů: ${targets.length}.` : "Uloženo, notifikace o úkolech nechodí.");
    } }, icon("mdi:content-save", 22), "Uložit");
    list.replaceChildren(...boxes, h("div", { style: { height: "8px" } }), save);
  };
  // stays open over a re-render (the saved targets come back in a new view)
  const open = h("button", { class: "btn ghost", "data-act": "notify-open", onclick: () => { ctx.ui.notifyOpen = true; open.remove(); load(); } }, "Vybrat telefony…");
  card.append(list);
  if (ctx.ui.notifyOpen) load();
  else card.append(open);
  sec.append(card);
  return sec;
}

function storySection(ctx, st) {
  const sv = st.story_vars;
  const sec = h("div", { class: "section", "data-id": "settings-story" }, h("h2", {}, "Příběh"));
  const card = h("div", { class: "card" });
  card.append(h("div", { class: "muted", style: { marginBottom: "8px" } }, "Místa a postavy, o kterých příběh mluví. Čeština skloňuje, proto se některé tvary píšou zvlášť; pod polem uvidíte větu z příběhu. Prázdné pole = výchozí hodnota."));
  const { el: fields, inputs } = storyVarFields(sv);
  card.append(fields);
  card.append(
    h("div", { style: { height: "10px" } }),
    h("button", { class: "btn gold block", "data-act": "story-vars-save", onclick: async () => {
      const values = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));
      if (await ctx.act("set_story_vars", { vars: storyVarsToSave(values, sv.defaults) })) ctx.toast("Příběh uložen.");
    } }, icon("mdi:content-save", 22), "Uložit"),
    storyTextsBlock(ctx)
  );
  sec.append(card);
  return sec;
}
