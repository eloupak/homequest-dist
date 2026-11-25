/** #227 (task-kind-names, 2026-11-25): the game names of the three kinds of a task, a short subtitle and a big icon.
 *  The internal kinds stay (daily = counted in the day's progress, chance = a daily task with `optional`, oneoff = a one-off task);
 *  only what is shown changes. The icons are art in frontend/img/taskkind_<daily|watch|mission>.webp. */

/** The art (brief task-kind-icons, 2026-11-25): 192 px WebP cropped from 1254 px, with its own soft shadow. */
const IMG = (name) => new URL(`../img/taskkind_${name}.webp`, import.meta.url).href;

/** [id, name, subtitle, icon] in the order of the groups (the subtitle is also the meaning under the parent's switch). */
export const TASK_KINDS = [
  ["daily", "Denní služba", "Splň každý den", "daily"],
  ["chance", "Hlídka", "Hlídej, jestli není potřeba", "watch"],
  ["oneoff", "Zvláštní mise", "Jen jednou, pak zmizí", "mission"],
];

export const kindInfo = (id) => {
  const k = TASK_KINDS.find(([kid]) => kid === id) || TASK_KINDS[0];
  return { id: k[0], name: k[1], sub: k[2], img: IMG(k[3]) };
};

/** The big icon of a group (static markup only). */
export function kindIcon(id, cls = "kind-icon") {
  const span = document.createElement("span");
  span.className = cls;
  span.setAttribute("aria-hidden", "true");
  const img = document.createElement("img");
  img.src = kindInfo(id).img;
  img.alt = "";
  img.decoding = "async";
  img.draggable = false;
  span.append(img);
  return span;
}

/** The head of a group: the icon over the edge, the name and the subtitle. h = lib/dom.js h. */
export function kindHead(h, id, tag = "h2") {
  const k = kindInfo(id);
  return h("div", { class: "kind-head" }, kindIcon(id), h(tag, { class: "kind-name" }, k.name), h("div", { class: "kind-sub" }, k.sub));
}
