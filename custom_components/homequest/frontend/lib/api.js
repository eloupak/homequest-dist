/* Thin wrapper over hass.connection for the homequest/* websocket commands. */

export class Api {
  /** panelKid: a child panel (the parent's phone, fixed to one kid): every command carries it and the server then acts as that child only. */
  constructor(hass, panelKid = null) {
    this.hass = hass;
    this.panelKid = panelKid;
  }

  subscribe(cb) {
    return this.hass.connection.subscribeMessage(cb, { type: "homequest/subscribe", ...(this.panelKid ? { panel_kid: this.panelKid } : {}) });
  }

  /** Another subscription of the panel (e.g. siege_subscribe), with the child panel's kid like every command. Resolves with the unsubscribe. */
  subscribeTo(type, cb) {
    return this.hass.connection.subscribeMessage(cb, { type: `homequest/${type}`, ...(this.panelKid ? { panel_kid: this.panelKid } : {}) });
  }

  /** Resolves with the result; rejects with {code, message}. */
  async call(type, data = {}) {
    try {
      return await this.hass.connection.sendMessagePromise({ type: `homequest/${type}`, ...data, ...(this.panelKid ? { panel_kid: this.panelKid } : {}) });
    } catch (e) {
      throw { code: (e && e.code) || "error", message: (e && e.message) || String(e) };
    }
  }
}
