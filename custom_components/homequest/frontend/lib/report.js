/* #175 "Nahlásit problém": the URL of a new GitHub issue with only technical facts filled in - the versions of HomeQuest and Home
 * Assistant, the browser / system and the language. Never a child's, parent's or place's name, nor install_id (a family-data rule).
 * The parent writes what happened. Pure, tested in node (tests/js/report.test.mjs). */

export const REPORT_TEXTS = {
  cs: {
    title: "Problém: ",
    body: ["### Co se stalo", "", "(popište, co jste dělali a co se stalo)", "", "### Co jste čekali", "", "", "---",
      "Vyplněno automaticky (bez jmen a osobních údajů):"],
    labels: { hq: "HomeQuest", ha: "Home Assistant", ua: "Prohlížeč / systém", lang: "Jazyk" },
  },
  en: {
    title: "Problem: ",
    body: ["### What happened", "", "(describe what you did and what happened)", "", "### What you expected", "", "", "---",
      "Filled in automatically (no names or personal data):"],
    labels: { hq: "HomeQuest", ha: "Home Assistant", ua: "Browser / system", lang: "Language" },
  },
};

export function reportLang(lang) {
  return String(lang || "").toLowerCase().startsWith("cs") ? "cs" : "en";
}

/** repo "owner/name"; facts: { hq, ha, ua, lang } (missing = "?"); extra: lines of the diagnostics (lib/compat.js, #174), in a code block. */
export function reportUrl(repo, facts, extra = null) {
  const t = REPORT_TEXTS[reportLang(facts.lang)];
  const tech = Object.entries(t.labels).map(([k, label]) => `- ${label}: ${String(facts[k] || "?").replace(/\s+/g, " ").trim()}`);
  const diag = extra && extra.length ? ["", "```", ...extra.map((l) => String(l).slice(0, 400)), "```"] : [];
  const body = [...t.body, ...tech, ...diag].join("\n");
  const q = new URLSearchParams({ title: t.title, body });
  return `https://github.com/${repo}/issues/new?${q.toString()}`;
}
