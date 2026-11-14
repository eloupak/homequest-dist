import { coin, h, icon } from "../lib/dom.js";
import { avatar, classOf, coinCount } from "./common.js";

export function czDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}. ${m}. ${y}`;
}

const ORDER = { open: 0, pending: 1, approved: 2 };

export function renderQuests(ctx) {
  const { kid, cat } = ctx;
  const info = ctx.view.tasks_info || {};
  const sort = (a, b) => ORDER[a.st.status] - ORDER[b.st.status];
  // today's daily tasks (the server only gives the ones of today's kind of day); the one-off tasks of the parent are shown until they are done
  // by today's plan (a task that is archived but still runs today, e.g. after a release, is shown); without a plan: the tasks that are not archived
  const plan = info.day_plan ? new Set(info.day_plan) : null;
  const daily = cat.tasks
    .filter((t) => t.period === "daily" && (plan ? plan.has(t.id) : !t.archived) && kid.tasks[t.id])
    .map((task) => ({ task, st: kid.tasks[task.id] }))
    .sort(sort);
  const oneoff = (info.oneoffs || [])
    .filter((o) => o.status === "active" && kid.tasks[o.id] && kid.tasks[o.id].status !== "approved")
    .map((o) => ({ task: { id: o.id, name: o.name, reward: o.reward, icon: "mdi:star-circle" }, st: kid.tasks[o.id] }))
    .sort(sort);
  const done = daily.filter((e) => e.st.status === "approved").length;
  const pending = daily.filter((e) => e.st.status === "pending").length;
  const pct = daily.length ? Math.round((done / daily.length) * 100) : 0;

  const root = h("div");
  root.append(
    h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "herohead" },
        avatar(ctx, kid, "avatar-q"),
        h("div", { class: "grow" }, h("h2", {}, kid.hero.name), h("div", { class: "muted" }, classOf(ctx, kid)?.name || ""), coinCount(ctx, kid))
      ),
      h(
        "div",
        { class: "progress" },
        h("div", { class: "bar" }, h("i", { style: { width: `${pct}%` } })),
        h("div", { class: "label" }, `${done}/${daily.length} dnes`, pending ? ` · ${pending} čeká na schválení` : "")
      )
    )
  );

  if (info.holidays_active) {
    root.append(h("div", { class: "holiday", "data-holiday": info.holidays_until }, icon("mdi:beach", 22), `Prázdniny do ${czDate(info.holidays_until)}`));
  }
  if (daily.length && done === daily.length) {
    root.append(h("div", { class: "hint" }, "Skvělá práce, dnes máš všechno splněno!"));
  }
  const list = (title, items) => {
    if (!items.length) return null;
    const sec = h("div", { class: "section" }, title ? h("h2", {}, title) : null);
    for (const e of items) sec.append(questCard(ctx, e));
    return sec;
  };
  root.append(...[list("Dnes", daily), list("Jednorázové", oneoff)].filter(Boolean));
  if (!daily.length && !oneoff.length) root.append(h("div", { class: "empty" }, "Zatím tu nejsou žádné úkoly."));
  return root;
}

function questCard(ctx, { task, st }) {
  let action;
  if (st.status === "open") {
    action = h(
      "button",
      {
        class: "btn",
        "data-act": `done-${task.id}`,
        onclick: async () => {
          const yes = await ctx.confirm({ title: task.name, text: "Opravdu už je to hotové?", yes: "Ano, hotovo!", no: "Ještě ne" });
          if (yes) await ctx.act("complete", { task_id: task.id });
        },
      },
      icon("mdi:check-bold", 24),
      "Hotovo"
    );
  } else if (st.status === "pending") {
    action = h("div", { class: "status pending" }, icon("mdi:timer-sand", 26), "Čeká na schválení");
  } else {
    action = h("div", { class: "status done" }, icon("mdi:check-circle", 30));
  }
  return h(
    "div",
    { class: `card quest ${st.status}`, "data-task": task.id },
    h("div", { class: "qicon" }, icon(task.icon)),
    h("div", { class: "grow" }, h("div", { class: "qname" }, task.name), task.note ? h("div", { class: "qnote" }, task.note) : null, h("div", { class: "qreward" }, "+", String(task.reward), " ", coin())),
    action
  );
}
