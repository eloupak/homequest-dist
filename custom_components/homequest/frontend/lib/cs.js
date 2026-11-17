/* Czech UI texts. */

export const SLOT_NAMES = {
  outfit: "Výbava",
  hair: "Účes",
  ears: "Uši",
  head: "Hlava",
  torso: "Tělo",
  legs: "Nohy",
  feet: "Boty",
  hands: "Ruce",
  back: "Záda",
  neck: "Krk",
  belt: "Opasek",
  weapon: "Zbraň",
  offhand: "Do druhé ruky",
  hair_dye: "Obarvení vlasů",
};

export const SLOT_ICONS = {
  outfit: "mdi:tshirt-crew",
  hair: "mdi:face-woman-shimmer",
  ears: "mdi:ear-hearing",
  head: "mdi:hat-fedora",
  torso: "mdi:tshirt-crew",
  legs: "mdi:human-male",
  feet: "mdi:shoe-formal",
  hands: "mdi:hand-back-right",
  back: "mdi:bag-personal",
  neck: "mdi:necklace",
  belt: "mdi:ribbon",
  weapon: "mdi:sword",
  offhand: "mdi:shield",
  hair_dye: "mdi:palette",
};

/** Shop sections (whole-outfit sets): outfits by style, then weapons, offhand items, accessories. */
export const OUTFIT_STYLE_NAMES = { cloth: "Plátěné oblečení", light: "Lehká zbroj", heavy: "Těžká zbroj", robe: "Róba" };
export const SHOP_SECTIONS = [
  { id: "outfit", name: "Výbava", slots: ["outfit"] },
  { id: "weapon", name: "Zbraně", slots: ["weapon"] },
  { id: "offhand", name: "Do druhé ruky", slots: ["offhand"] },
  { id: "hair", name: "Účesy", slots: ["hair"] },
  { id: "dye", name: "Obarvit vlasy", slots: ["hair_dye"] },
  { id: "extra", name: "Doplňky", slots: ["head", "neck", "back", "belt", "hands"] },
];

export const RARITY = {
  common: "Obyčejná",
  rare: "Vzácná",
  epic: "Epická",
  legendary: "Legendární",
};

export const BODY_NAMES = { male: "Chlapec", female: "Dívka" };

const ERRORS = {
  insufficient_coins: "Nemáš dost zlaťáků.",
  already_owned: "Tohle už máš.",
  class_restricted: "Tohle je pro jinou třídu hrdiny.",
  body_restricted: "Tenhle účes je pro někoho jiného.",
  invalid_state: "To teď nejde.",
  forbidden: "Tohle smí jen rodič.",
  not_found: "Tohle jsem nenašel.",
  invalid_params: "Něco je špatně vyplněné.",
};

export function errText(err) {
  if (!err) return "Něco se nepovedlo.";
  return ERRORS[err.code] || err.message || "Něco se nepovedlo.";
}

/** Czech plural of "zlaťák": 1 zlaťák, 2-4 zlaťáky, 0 and 5+ zlaťáků. */
export function coinsWord(n) {
  const a = Math.abs(n);
  if (a === 1) return "zlaťák";
  if (a >= 2 && a <= 4) return "zlaťáky";
  return "zlaťáků";
}

export function when(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getDate()}. ${d.getMonth() + 1}. ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The Defender's amulet by the colour of its stone (#118). */
export const AMULET_NAMES = { blue: "Amulet obránce (modrý)", red: "Amulet obránce (červený)", green: "Amulet obránce (zelený)", purple: "Amulet obránce (fialový)" };
export const COLOR_NAMES = { blue: "Modrý", red: "Červený", green: "Zelený", purple: "Fialový" };

export function historyText(e, cat) {
  const task = cat.tasks.find((t) => t.id === e.task) || (e.name ? { name: e.name } : null);   // a one-off task is not in the catalog: the history keeps its name
  const item = cat.items.find((i) => i.id === e.item);
  const sign = e.coins > 0 ? `+${e.coins}` : `${e.coins}`;
  switch (e.type) {
    case "approved": return `${e.auto ? "Splněno" : "Schváleno"}: ${task ? task.name : e.task} (${sign})`;
    case "approval_setting": return e.value ? "Schvalování úkolů zapnuto" : "Schvalování úkolů vypnuto";
    case "rejected": return `Zamítnuto: ${task ? task.name : e.task}`;
    case "expired": return `Nesplněno včas: ${task ? task.name : e.task}`;
    case "bought": return `Koupeno: ${item ? item.name : e.item} (${sign})${e.refunded ? " · Vráceno" : ""}`;
    case "refunded": return `Vráceno: ${item ? item.name : e.item} (${sign})`;
    case "adjusted": return `Úprava zlaťáků${e.note ? ": " + e.note : ""} (${sign})`;
    case "gift": return e.item ? `${e.note || "Dar"}: ${AMULET_NAMES[e.color] || "amulet"}` : `${e.note || "Dar"} (${sign})`;
    case "onboarded": return "Hrdina vytvořen";
    case "hero_reset": return "Hrdina smazán";
    case "migrated": return `Úprava dat${e.note ? ": " + e.note : ""}`;
    default: return e.type;
  }
}
