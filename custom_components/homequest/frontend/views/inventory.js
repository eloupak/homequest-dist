import { coin, h } from "../lib/dom.js";
import { DYE_SLOT, POUR_MS } from "../lib/dye.js";
import { OUTFIT_STYLE_NAMES, RARITY, SHOP_SECTIONS, SLOT_NAMES, coinsWord } from "../lib/cs.js";

const LAYERED = ["torso", "legs", "feet"];
const usesSets = (ctx) => !!(ctx.stage.ix && ctx.stage.ix.hasSets);
import { coinCount, fitsBody, heroSpec, restriction } from "./common.js";

export function renderInventory(ctx) {
  const { kid, cat } = ctx;
  const ui = ctx.ui;
  const root = h("div");
  root.append(
    h(
      "div",
      { class: "row", style: { justifyContent: "space-between", marginBottom: "10px" } },
      h("h2", { style: { color: "var(--gold)" } }, ui.invTab === "shop" ? "Obchod" : "Inventář"),
      coinCount(ctx, kid)
    ),
    h(
      "div",
      { class: "seg" },
      h("button", { "aria-pressed": String(ui.invTab !== "shop"), "data-seg": "inv", onclick: () => setTab(ctx, "inv") }, "Inventář"),
      h("button", { "aria-pressed": String(ui.invTab === "shop"), "data-seg": "shop", onclick: () => setTab(ctx, "shop") }, "Obchod")
    ),
    h(
      "div",
      { class: "chips" },
      chip(ctx, "all", "Vše"),
      cat.slots.filter((s) => s !== "ears" && !(usesSets(ctx) && (LAYERED.includes(s) || s === "hands"))).map((s) => chip(ctx, s, SLOT_NAMES[s]))
    )
  );
  const filter = (i) => ui.slotFilter === "all" || i.slot === ui.slotFilter;
  if (ui.invTab === "shop") root.append(shopGrid(ctx, filter));
  else root.append(inventoryGrid(ctx, filter));
  return root;
}

function setTab(ctx, tab) {
  ctx.ui.invTab = tab;
  ctx.rerender();
}

function chip(ctx, value, label) {
  return h("button", { class: "chip", "aria-pressed": String(ctx.ui.slotFilter === value), "data-slot-filter": value, onclick: () => { ctx.ui.slotFilter = value; ctx.rerender(); } }, label);
}

function inventoryGrid(ctx, filter) {
  const { kid } = ctx;
  const owned = kid.inventory.map((id) => ctx.items[id]).filter((i) => i && filter(i) && fitsBody(i, kid.hero) && !(usesSets(ctx) && LAYERED.includes(i.slot)));
  if (!owned.length) return h("div", { class: "empty" }, "Tady zatím nic není. V obchodě si můžeš něco koupit za zlaťáky.");
  const grid = h("div", { class: "grid" });
  for (const item of owned) {
    const why = restriction(ctx, kid, item);
    const on = kid.equipped[item.slot] === item.id;
    grid.append(
      h(
        "button",
        {
          class: `icard r-${item.rarity} ${why ? "locked" : ""}`,
          "data-item": item.id,
          disabled: !!why,
          onclick: () => tapItem(ctx, item, on),
        },
        on ? h("span", { class: "tag" }, "Nasazeno") : null,
        why ? h("span", { class: "tag lock" }, "Bez obrázku") : null,
        ctx.stage.thumb(item, kid.hero.body, ctx.items, item.slot === "outfit" ? 112 : 64),
        h("div", { class: "iname" }, item.name),
        h("div", { class: "muted", style: { fontSize: "13px" } }, SLOT_NAMES[item.slot])
      )
    );
  }
  return grid;
}

/** One tap rule for the Inventory and the slot sheet (#118): a worn weapon, offhand item or amulet comes off, the worn clothes stay
 *  (another outfit replaces them: nothing happens, no server error), anything else goes on. */
export function tapItem(ctx, item, on) {
  if (!on) return ctx.act("equip", { item_id: item.id });
  if (item.slot === "outfit") return null;
  return ctx.act("equip", { item_id: null, slot: item.slot });
}

function shopCard(ctx, kid, item) {
  const have = item.slot === DYE_SLOT && kid.hero.hair_color === item.color;     // a bottle is bought again and again; not for the colour the hero has now
  return h(
    "button",
    { class: `icard r-${item.rarity} ${have ? "have" : ""}`, "data-item": item.id, onclick: () => openDetail(ctx, item) },
    have ? h("span", { class: "tag", "data-have": "" }, "Máš teď") : null,
    ctx.stage.thumb(item, kid.hero.body, ctx.items, item.slot === "outfit" ? 112 : 64),
    h("div", { class: "iname" }, item.name),
    item.slot === DYE_SLOT ? h("div", { class: "muted", "data-dye-note": "", style: { fontSize: "12px", lineHeight: "1.2" } }, "Obarví vlasy hrdiny") : null,
    h("div", { class: "iprice" }, coin(), ` ${item.price}`)
  );
}

function shopGrid(ctx, filter) {
  const { kid } = ctx;
  const reached = (ctx.view && ctx.view.fortress && ctx.view.fortress.stage) || 0;     // #187: an item with min_stage waits for its fortress stage
  const stock = ctx.cat.items
    .filter((i) => i.shop && (i.min_stage || 0) <= reached && !kid.inventory.includes(i.id) && filter(i) && fitsBody(i, kid.hero) && ctx.stage.supports(i, kid.hero.body))
    .sort((a, b) => a.price - b.price);
  if (!stock.length) return h("div", { class: "empty" }, "V obchodě už pro tebe nic nezbylo. Máš všechno!");
  if (!usesSets(ctx)) {
    const grid = h("div", { class: "grid" });
    for (const item of stock) grid.append(shopCard(ctx, kid, item));
    return grid;
  }
  // whole-outfit sets: Výbava (by style and tier), Zbraně, Do druhé ruky, Doplňky
  const wrap = h("div");
  for (const sec of SHOP_SECTIONS) {
    const items = stock.filter((i) => sec.slots.includes(i.slot));
    if (!items.length) continue;
    wrap.append(h("h3", { class: "shop-sec", "data-sec": sec.id, style: { margin: "14px 0 6px", color: "var(--gold)" } }, sec.name));
    if (sec.id === "outfit") {
      for (const style of Object.keys(OUTFIT_STYLE_NAMES)) {
        const part = items.filter((i) => (i.style || "cloth") === style).sort((a, b) => a.tier - b.tier || a.price - b.price);
        if (!part.length) continue;
        wrap.append(h("div", { style: { margin: "8px 2px 4px", color: "#d9d0f0", fontWeight: "700" } }, OUTFIT_STYLE_NAMES[style]));
        const grid = h("div", { class: "grid" });
        for (const item of part) grid.append(shopCard(ctx, kid, item));
        wrap.append(grid);
      }
    } else {
      const grid = h("div", { class: "grid" });
      for (const item of items) grid.append(shopCard(ctx, kid, item));
      wrap.append(grid);
    }
  }
  return wrap;
}

/** Bottom sheet: hero wearing the item before buying. Rebuilt live as coins change. */
function openDetail(ctx, item) {
  ctx.sheet((c, close) => {
    const kid = c.kid;
    const owned = kid.inventory.includes(item.id);
    const why = restriction(c, kid, item);
    const missing = item.price - kid.coins;
    const dye = item.slot === DYE_SLOT;
    const pspec = heroSpec(c, kid, dye
      ? { scale: 4, expression: "wink", hero: { ...kid.hero, hair_color: item.color } }                    // a bottle: the hero with the new hair colour
      : { scale: 4, expression: "wink", equipped: { ...kid.equipped, [item.slot]: item.id } });
    const preview = c.stage.hero("preview", pspec);
    if (c.stage.illustrated) preview.onclick = (ev) => c.zoom(pspec, ev);                                    // a tap: this hero (with the item) on the whole screen
    const left = dye && c.ui.pour && c.ui.pour.item === item.id ? POUR_MS - (Date.now() - c.ui.pour.t) : 0;
    const pour = left > 0 ? h("div", { class: "pour", style: `--dye:${c.ui.pour.hex}` }, h("i", { class: "bottle" }), h("i", { class: "stream" })) : null;
    if (pour) setTimeout(() => pour.remove(), left);
    let button;
    if (dye && kid.hero.hair_color === item.color) {
      button = h("button", { class: "btn block", disabled: true, "data-act": "have" }, "Tuhle barvu máš teď");
    } else if (owned) {
      button = h("button", { class: "btn gold block", "data-act": "wear", onclick: async () => { close(); await c.act("equip", { item_id: item.id }); } }, "Nasadit");
    } else if (missing > 0) {
      button = h("button", { class: "btn block", disabled: true, "data-act": "buy" }, `Chybí ${missing} ${coinsWord(missing)}`);
    } else {
      button = h(
        "button",
        {
          class: "btn gold block",
          "data-act": "buy",
          onclick: async () => {
            if (await c.act("buy", { item_id: item.id })) {
              c.toast(dye ? `Vlasy obarveny: ${item.name}!` : `Koupeno: ${item.name}!`);
              if (dye) {
                // the colour is on the hero already (the server applies it with the purchase): pour it over him in this sheet
                const pal = c.stage.manifest && c.stage.manifest.palettes && c.stage.manifest.palettes.hair;
                const col = pal && pal.variants[item.color];
                c.ui.pour = { item: item.id, t: Date.now(), hex: (col && col[3]) || "#888" };
                c.rerender();
              }
            }
          },
        },
        "Koupit za ",
        coin(),
        ` ${item.price}`
      );
    }
    return h(
      "div",
      { class: "center" },
      h("h2", {}, item.name),
      h("div", { class: "muted" }, dye ? "Obarví vlasy hrdiny" : `${SLOT_NAMES[item.slot]} · ${RARITY[item.rarity]}`),
      h("div", { class: "dyewrap", style: { display: "flex", justifyContent: "center", margin: "10px 0", position: "relative" } }, h("div", { class: "herostage" }, preview), pour),
      h("div", { class: "muted", style: { marginTop: "4px" } }, "Máš: ", coin(), ` ${kid.coins}`),
      h("div", { class: "actions" }, button, h("button", { class: "btn ghost", onclick: close }, "Zavřít"))
    );
  });
}
