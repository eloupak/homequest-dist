/* Optional parent PIN: the pad in front of the Rodič tab and the settings card. The PIN is checked on the server (hash only). */

import { h, icon } from "../lib/dom.js";

const PIN_ERR = {
  pin_wrong: "Špatný PIN.",
  pin_locked: "Moc pokusů, chvilku počkej.",
  pin_required: "Nejdřív zadej PIN.",
  invalid_params: "PIN musí mít 4 až 8 číslic.",
};
const pinText = (e) => PIN_ERR[e && e.code] || (e && e.message) || "Něco se nepovedlo.";

/** The pad shown instead of the Rodič tab while a PIN is set and not entered (the server refuses the parent commands anyway). */
export function renderPinPad(ctx) {
  const input = h("input", { type: "password", inputmode: "numeric", autocomplete: "off", maxlength: "8", placeholder: "PIN", "data-pin": "enter", style: { textAlign: "center", letterSpacing: "6px" } });
  const msg = h("div", { class: "muted", "data-pin-msg": "", style: { minHeight: "1.4em", marginTop: "6px" } });
  const submit = async () => {
    try {
      await ctx.api.call("pin_verify", { pin: input.value });
      await ctx.refreshPin();
    } catch (e) {
      msg.textContent = pinText(e);
      input.value = "";
    }
  };
  input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") submit(); });
  return h(
    "div",
    { class: "card pinpad", style: { textAlign: "center" } },
    icon("mdi:lock", 40),
    h("h2", { style: { color: "var(--ink)" } }, "Rodičovský PIN"),
    h("div", { class: "muted" }, "Zadej PIN, abys mohl schvalovat a nastavovat."),
    h("div", { style: { margin: "12px auto", maxWidth: "220px" } }, input),
    h("button", { class: "btn gold block", "data-act": "pin-unlock", onclick: submit }, "Odemknout"),
    msg
  );
}

/** Settings card of the Rodič tab: turn the PIN on, change it, turn it off, lock now. */
export function pinSettings(ctx) {
  const enabled = !!(ctx.view.pin && ctx.view.pin.enabled);
  const input = h("input", { type: "password", inputmode: "numeric", autocomplete: "off", maxlength: "8", placeholder: enabled ? "Nový PIN (4–8 číslic)" : "PIN (4–8 číslic)", "data-pin": "new", style: { textAlign: "center", letterSpacing: "4px" } });
  const msg = h("div", { class: "muted", "data-pin-msg": "", style: { minHeight: "1.4em", marginTop: "6px" } });
  const send = async (pin, done) => {
    try {
      await ctx.api.call("pin_set", { pin });
      await ctx.refreshPin();
      ctx.toast(done);
    } catch (e) {
      msg.textContent = pinText(e);
    }
  };
  return h(
    "div",
    { class: "section", "data-sec": "pin" },
    h("h2", {}, "PIN rodiče"),
    h("div", { class: "card" },
      h("p", { class: "muted", style: { margin: "0 0 8px" } }, enabled
        ? "PIN je zapnutý: záložka Rodič a schvalování ho chtějí. Uložený je jen jako otisk (hash), nikde se nezobrazuje."
        : "Vypnuto. Když ho zapneš, dítě s tvým telefonem nemůže samo schvalovat ani měnit zlaťáky."),
      input,
      h("div", { class: "actions", style: { marginTop: "8px" } },
        h("button", { class: "btn gold", "data-act": "pin-save", onclick: () => send(input.value, enabled ? "PIN změněn." : "PIN zapnut.") }, enabled ? "Změnit PIN" : "Zapnout PIN"),
        enabled ? h("button", { class: "btn ghost", "data-act": "pin-off", onclick: () => send(null, "PIN vypnut.") }, "Vypnout PIN") : null,
        enabled ? h("button", { class: "btn ghost", "data-act": "pin-lock", onclick: async () => { await ctx.api.call("pin_lock"); await ctx.refreshPin(); } }, "Zamknout teď") : null
      ),
      msg
    )
  );
}
