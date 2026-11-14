import { coin, h, icon } from "../lib/dom.js";
import { historyText, when } from "../lib/cs.js";
import { avatar, classOf, coinCount } from "./common.js";
import { tasksAdmin } from "./tasks_admin.js";
import { settingsSections } from "./settings.js";

/** v1.7 (#141): "Je dostupná nová verze" for the parent only (the view has `update` only for a parent). Kept small and standalone, so the
 * Rodič screen of #129 can move it anywhere. Pure DOM from the view; null = nothing to show. */
export function updateBanner(update) {
  if (!update || !update.available || !update.latest) return null;
  const how = update.source === "hacs" ? "Aktualizujete ji v Nastavení → Aktualizace (nebo v HACS) a pak restartujte Home Assistant." : "Aktualizujete ji v HACS a pak restartujte Home Assistant.";
  return h("div", { class: "card", "data-id": "update-banner", style: { background: "#fff3cf", border: "2px solid var(--gold-dark)", marginBottom: "12px" } },
    h("div", { class: "row", style: { gap: "10px", alignItems: "flex-start" } }, icon("mdi:update", 26),
      h("div", { class: "grow" }, h("b", {}, `Je dostupná nová verze HomeQuestu ${update.latest}`), update.installed ? h("span", { class: "muted" }, ` (máte ${update.installed})`) : null,
        h("div", { class: "muted" }, how, " Rozehraná hra a nastavení zůstanou."))));
}

export function renderParent(ctx) {
  const { view, cat } = ctx;
  const root = h("div");
  const upd = updateBanner(view.update);
  if (upd) root.append(upd);

  // --- pending approvals
  const pending = [];
  for (const k of cat.kids) {
    const kid = view.kids[k.id];
    if (!kid) continue;
    for (const [taskId, st] of Object.entries(kid.tasks)) {
      const task = cat.tasks.find((t) => t.id === taskId) || ((view.tasks_info || {}).oneoffs || []).find((o) => o.id === taskId);
      if (st.status === "pending" && task) pending.push({ kid: k, task, st });
    }
  }
  const sec = h("div", { class: "section" }, h("h2", {}, `Ke schválení (${pending.length})`));
  if (pending.length) {
    sec.append(
      h(
        "button",
        {
          class: "btn gold block",
          "data-act": "approve-all",
          onclick: async () => {
            const yes = await ctx.confirm({ title: "Schválit vše?", text: `Schválí se ${pending.length} úkolů a dětem se přičtou zlaťáky.`, yes: "Schválit vše", no: "Zpět" });
            if (!yes) return;
            for (const p of pending) await ctx.act("approve", { kid_id: p.kid.id, task_id: p.task.id }, { quiet: true });
            ctx.toast("Všechno schváleno.");
          },
        },
        icon("mdi:check-all", 26),
        "Schválit vše"
      ),
      h("div", { style: { height: "10px" } })
    );
    for (const p of pending) {
      sec.append(
        h(
          "div",
          { class: "card pend", "data-pending": `${p.kid.id}:${p.task.id}` },
          h("div", { class: "grow" }, h("span", { class: "kidtag" }, p.kid.name), h("div", { class: "qname", style: { marginTop: "4px" } }, p.task.name), h("div", { class: "qreward" }, "+", String(p.task.reward), " ", coin())),
          h("button", { class: "btn", "data-act": "approve", onclick: () => ctx.act("approve", { kid_id: p.kid.id, task_id: p.task.id }) }, icon("mdi:check-bold", 24), "Schválit"),
          h("button", { class: "btn red", "data-act": "reject", onclick: () => ctx.act("reject", { kid_id: p.kid.id, task_id: p.task.id }) }, icon("mdi:close-thick", 24), "Zamítnout")
        )
      );
    }
  } else {
    sec.append(h("div", { class: "empty" }, "Nic nečeká na schválení."));
  }
  root.append(sec);

  const sg = siegeSection(ctx);
  if (sg) root.append(sg);

  root.append(tasksAdmin(ctx));

  // --- kids: coins + hero
  const kidsSec = h("div", { class: "section" }, h("h2", {}, "Děti"));
  for (const k of cat.kids) {
    const kid = view.kids[k.id];
    if (!kid) continue;
    const adj = (n) =>
      h("button", { class: "btn ghost", "data-adj": `${k.id}:${n}`, onclick: () => ctx.act("admin_adjust", { kid_id: k.id, delta: n, note: "rychlá úprava" }) }, n > 0 ? `+${n}` : `−${Math.abs(n)}`);
    kidsSec.append(
      h(
        "div",
        { class: "card", "data-kid": k.id },
        h("div", { class: "herohead" }, avatar(ctx, kid, `avatar-p-${k.id}`), h("div", { class: "grow" }, h("h2", {}, k.name), h("div", { class: "muted" }, kid.hero ? `${kid.hero.name} · ${classOf(ctx, kid)?.name || ""}` : "Hrdina ještě není vytvořen"), coinCount(ctx, kid, k.id))),
        h(
          "div",
          { class: "adj" },
          adj(-5), adj(-1), adj(1), adj(5),
          h("button", { class: "btn ghost", "data-act": "adjust-custom", onclick: () => adjustSheet(ctx, k) }, "Upravit…")
        ),
        h(
          "div",
          { class: "row", style: { marginTop: "10px" } },
          h("div", { class: "grow" }, h("b", {}, "Vyžadovat schválení"), h("div", { class: "muted", style: { fontSize: "14px" } }, kid.require_approval ? "Hotový úkol čeká, až ho schválíš." : "Hotový úkol se hned započítá, jen ti přijde zpráva.")),
          h("button", { class: "btn ghost", "data-act": "approval", "aria-pressed": String(!!kid.require_approval), onclick: () => ctx.act("set_approval", { kid_id: k.id, value: !kid.require_approval }) }, kid.require_approval ? "Zapnuto" : "Vypnuto")
        ),
        kid.hero
          ? h(
              "div",
              { style: { marginTop: "10px" } },
              h(
                "button",
                {
                  class: "btn ghost",
                  "data-act": "reset-hero",
                  onclick: async () => {
                    const yes = await ctx.confirm({ title: `Smazat hrdinu (${k.name})?`, text: "Zlaťáky a věci zůstanou, hrdina si vybere vzhled a třídu znovu.", yes: "Smazat hrdinu", no: "Zpět", danger: true });
                    if (yes) await ctx.act("reset_hero", { kid_id: k.id });
                  },
                },
                "Smazat hrdinu"
              )
            )
          : null
      )
    );
  }
  root.append(kidsSec);

  // --- history
  const hk = ctx.ui.histKid && view.kids[ctx.ui.histKid] ? ctx.ui.histKid : cat.kids[0] && cat.kids[0].id;
  const hist = h("div", { class: "section" }, h("h2", {}, "Historie"));
  hist.append(
    h("div", { class: "kidswitch", style: { marginBottom: "8px" } }, cat.kids.map((k) => h("button", { class: "chip", "aria-pressed": String(k.id === hk), onclick: () => { ctx.ui.histKid = k.id; ctx.rerender(); } }, k.name)))
  );
  const entries = hk && view.kids[hk] ? view.kids[hk].history.slice().reverse().slice(0, 20) : [];
  const card = h("div", { class: "card" });
  if (!entries.length) card.append(h("div", { class: "muted" }, "Zatím nic."));
  for (const e of entries) card.append(h("div", { class: "hist" }, h("span", { class: "t" }, when(e.ts)), h("span", { class: "grow" }, historyText(e, cat))));
  hist.append(card);
  root.append(hist);

  // --- settings (v1.5, #128): notifications, story places and characters
  for (const sec of settingsSections(ctx)) root.append(sec);

  // --- art status / about
  root.append(artSection(ctx));
  root.append(aboutSection(ctx));
  return root;
}

function adjustSheet(ctx, kidInfo) {
  ctx.sheet((c, close) => {
    const kid = c.view.kids[kidInfo.id];
    const delta = h("input", { class: "field", type: "number", inputmode: "numeric", placeholder: "Změna zlaťáků, např. 3 nebo -2", "data-field": "delta" });
    const note = h("input", { class: "field", type: "text", maxlength: "100", placeholder: "Poznámka (proč)", "data-field": "note" });
    return h(
      "div",
      {},
      h("h2", {}, `Upravit zlaťáky: ${kidInfo.name}`),
      h("div", { class: "muted", style: { marginBottom: "10px" } }, "Teď má: ", coin(), ` ${kid ? kid.coins : 0}`),
      delta,
      h("div", { style: { height: "10px" } }),
      note,
      h(
        "div",
        { class: "actions" },
        h("button", { class: "btn ghost", onclick: close }, "Zrušit"),
        h(
          "button",
          {
            class: "btn gold",
            "data-act": "adjust-save",
            onclick: async () => {
              const n = parseInt(delta.value, 10);
              if (!n) return c.toast("Napiš změnu zlaťáků, např. 3 nebo -2.", "error");
              close();
              await c.act("admin_adjust", { kid_id: kidInfo.id, delta: n, note: note.value.trim() });
            },
          },
          "Uložit"
        )
      )
    );
  });
}

function artSection(ctx) {
  const art = ctx.view.art;
  const sec = h("div", { class: "section", "data-art-status": art ? art.effective : "none" }, h("h2", {}, "Grafika"));
  if (!art) return sec;
  const card = h("div", { class: "card" });
  if (art.blocking && art.blocking.length) {     // a hero would miss these drawings (#127: there is no other art to fall back to)
    card.append(h("div", { style: { color: "#8a2d28", fontWeight: "bold" } }, "Chybí obrázky, které děti potřebují:"));
    card.append(h("ul", { class: "muted", style: { margin: "4px 0 0 18px", padding: "0" } }, art.blocking.map((t) => h("li", {}, t))));
  }
  if (!(art.blocking && art.blocking.length) && !(art.missing && art.missing.length)) card.append(h("div", {}, "Všechny obrázky jsou na místě."));
  if (art.missing && art.missing.length) {
    card.append(h("details", { style: { marginTop: "8px" } }, h("summary", { style: { minHeight: "44px", lineHeight: "44px", fontWeight: "bold" } }, `Chybějící obrázky (${art.missing.length})`), h("ul", { class: "muted", style: { margin: "4px 0 0 18px", padding: "0" } }, art.missing.map((t) => h("li", {}, t)))));
  }
  sec.append(card);
  return sec;
}

function aboutSection(ctx) {
  // #127: only our own drawings are shown (the LPC pixel art is gone), so no list of authors is needed
  return h("div", { class: "section" }, h("h2", {}, "O hře"), h("div", { class: "card" }, h("div", {}, "HomeQuest — domácí úkoly jako dobrodružství.")));
}

/** The attack of the goblins (#118, v1.4.0): the siege stage is reached, but the children see it only after a parent starts it. After the win the
 *  parent may start it again (a replay, only a game: nothing is given) and end a replay the children did not finish. */
export function siegeSection(ctx) {
  const sg = ctx.view.siege;
  if (!sg) return null;
  const start = async (replay) => {
    const yes = await ctx.confirm(replay
      ? { title: "Spustit útok znovu?", text: "Dětem naskočí Příprava a hra. Za další výhru už nic nedostanou.", yes: "Spustit", no: "Zpět" }
      : { title: "Spustit útok skřetů?", text: "Dětem hned naskočí scéna obléhání a hra. Vrátit to nejde.", yes: "Spustit útok", no: "Zpět" });
    if (yes) await ctx.act("siege_start", {});
  };
  let state, btn = null;
  if (sg.waiting) {
    state = "Tvrz je na stupni s útokem skřetů. Děti ho uvidí, až ho spustíš.";
    btn = h("button", { class: "btn gold block", "data-act": "siege-start", onclick: () => start(false) }, icon("mdi:sword-cross", 24), "Spustit útok skřetů");
  } else if (sg.replay) {
    state = "Útok běží znovu (jen hra, bez odměny).";
    btn = h("button", { class: "btn red block", "data-act": "siege-stop", onclick: async () => {
      const yes = await ctx.confirm({ title: "Ukončit útok?", text: "Rozehraná hra skončí a děti se vrátí do běžného panelu.", yes: "Ukončit", no: "Zpět" });
      if (yes) await ctx.act("siege_stop", {});
    } }, icon("mdi:stop", 24), "Ukončit útok");
  } else if (sg.active) {
    state = "Útok běží.";
  } else {
    state = `Ubráněno.${sg.replay_wins ? ` Znovu ubráněno: ${sg.replay_wins}×.` : ""}`;
    btn = h("button", { class: "btn gold block", "data-act": "siege-replay", onclick: () => start(true) }, icon("mdi:replay", 24), "Spustit útok znovu");
  }
  return h("div", { class: "section", "data-id": "siege-admin", "data-state": sg.waiting ? "waiting" : sg.replay ? "replay" : sg.active ? "active" : "won" },
    h("h2", {}, "Útok skřetů"), h("p", { class: "muted", "data-id": "siege-state" }, state), btn);
}

