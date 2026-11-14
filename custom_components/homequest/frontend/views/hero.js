import { h, icon } from "../lib/dom.js";
import { BODY_NAMES, RARITY, SLOT_ICONS, SLOT_NAMES } from "../lib/cs.js";
import { coinCount, currentExpression, fitsBody, heroSpec, restriction } from "./common.js";
import { tapItem } from "./inventory.js";

const LEFT = ["head", "neck", "torso", "legs", "feet"];
const RIGHT = ["back", "belt", "hands", "weapon", "offhand"];
const LEFT_SETS = ["outfit", "hair", "head", "neck"];            // whole-outfit sets: no layered clothing
const RIGHT_SETS = ["weapon", "offhand", "back", "belt"];
const DIRS = ["down", "left", "up", "right"];

export function renderHero(ctx) {
  const { kid } = ctx;
  const art = !!ctx.stage.illustrated;
  const sets = !!(ctx.stage.ix && ctx.stage.ix.hasSets);          // front view only, no turn button
  const dir = DIRS[ctx.ui.dirIndex % 4];
  const view = !sets && ctx.ui.view === "back" ? "back" : "front";
  const turn = () => {
    if (sets) return;
    if (art) ctx.ui.view = view === "front" ? "back" : "front";
    else ctx.ui.dirIndex++;
    ctx.rerender();
  };
  const spec = heroSpec(ctx, kid, art ? { scale: 4, view, expression: currentExpression(ctx) } : { scale: 4, dir });
  const canvas = ctx.stage.hero("main", spec);
  if (art) canvas.onclick = (ev) => ctx.zoom(spec, ev);          // a tap on the hero: the whole screen
  else canvas.onclick = turn;                                      // the old pixel-art fallback turns
  const col = (slots) => h("div", { class: "slotcol" }, slots.map((s) => slotButton(ctx, s)));
  return h(
    "div",
    {},
    h(
      "div",
      { class: "card", style: { textAlign: "center" } },
      h("h2", {}, kid.hero.name),
      h("div", { class: "muted" }, BODY_NAMES[kid.hero.body] || ""),
      coinCount(ctx, kid)
    ),
    h("div", { class: "stagebox" }, col(sets ? LEFT_SETS : LEFT), h("div", { class: "herostage" }, canvas), col(sets ? RIGHT_SETS : RIGHT)),
    art && !sets ? h("div", { style: { textAlign: "center", marginTop: "10px" } }, h("button", { class: "btn ghost", "data-act": "turn", onclick: turn }, icon("mdi:rotate-3d-variant", 24), "Otočit")) : null,
    h("div", { class: "soft", style: { textAlign: "center", marginTop: "10px", fontSize: "14px" } }, art ? (sets ? "Klepni na hrdinu, zvětší se. Klepni na místo pro výbavu." : "Klepni na hrdinu a zvětší se. Klepni na místo pro výbavu a vyber, co si nasadíš.") : "Klepni na hrdinu a otočí se. Klepni na místo pro výbavu a vyber, co si nasadíš.")
  );
}

function slotButton(ctx, slot) {
  const { kid } = ctx;
  const item = ctx.items[kid.equipped[slot]];
  const btn = h(
    "button",
    { class: `slot ${item ? "has" : ""}`, "data-slot": slot, onclick: () => openSlotSheet(ctx, slot) },
    item ? ctx.stage.thumb(item, kid.hero.body, ctx.items, 44) : icon(SLOT_ICONS[slot]),
    h("span", {}, SLOT_NAMES[slot])
  );
  return btn;
}

function openSlotSheet(ctx, slot) {
  ctx.sheet((c, close) => {
    const kid = c.kid;
    const owned = kid.inventory.map((id) => c.items[id]).filter((i) => i && i.slot === slot && fitsBody(i, kid.hero));
    const wearing = kid.equipped[slot];
    const equip = async (item) => {
      close();
      await tapItem(c, item, wearing === item.id);       // the worn one: off (not the clothes), as in the Inventory
    };
    const grid = h("div", { class: "grid" });
    for (const item of owned) {
      const why = restriction(c, kid, item);
      const on = wearing === item.id;
      grid.append(
        h(
          "button",
          {
            class: `icard r-${item.rarity} ${why ? "locked" : ""}`,
            "data-item": item.id,
            disabled: !!why,
            onclick: () => equip(item),
          },
          on ? h("span", { class: "tag" }, "Nasazeno") : null,
          why ? h("span", { class: "tag lock" }, why === "class" ? "Jiná třída" : "Bez obrázku") : null,
          c.stage.thumb(item, kid.hero.body, c.items, 64),
          h("div", { class: "iname" }, item.name),
          h("div", { class: "muted", style: { fontSize: "13px" } }, RARITY[item.rarity])
        )
      );
    }
    return h(
      "div",
      {},
      h("h2", {}, SLOT_NAMES[slot]),
      owned.length ? grid : h("div", { class: "muted" }, "Pro tohle místo zatím nic nemáš. Mrkni do obchodu!"),
      h(
        "div",
        { class: "actions" },
        wearing && slot !== "outfit"                      // the clothes cannot be taken off: the grey base body never shows
          ? h("button", { class: "btn ghost", "data-act": "unequip", onclick: async () => { close(); await c.act("equip", { item_id: null, slot }); } }, "Sundat")
          : null,
        h("button", { class: "btn gold", onclick: close }, "Zavřít")
      )
    );
  });
}
