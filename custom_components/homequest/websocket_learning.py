"""Websocket commands of the learning games (homequest/learn_*). Since v1.9 (#189) registered everywhere (production too): a child plays its own
hunt from the Quest tab once the fortress has reached the stage and the child owns the bow (hunt.yaml `entry`); a parent (admin) may act for any
child (the test panel "HomeQuest Učení" stays TEST only). The tracking data lives in its own storage file (.storage/homequest.learning, in the
backups since v1.9), never in homequest.state."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN
from .game.learn_api import handle
from .game.learning import LearnError, LearningHub, empty_data, entry_status, load_config, pending_coins, settle_coins
from .logic import fortress_stage
from .store import HomeQuestManager, Identity
from .websocket import KID, _handler

STORAGE_KEY = "homequest.learning"
STORAGE_VERSION = 1
SAVE_DELAY_S = 5

SCHEMAS: dict[str, dict] = {
    "state": {},
    "start": {vol.Required("op"): str, vol.Optional("mode"): str},
    "answer": {vol.Required("set_id"): str, vol.Required("answer"): vol.Any(int, str), vol.Optional("ms"): vol.Any(int, float)},
    "shot": {vol.Required("set_id"): str, vol.Required("hit"): bool},
    "quit": {vol.Required("set_id"): str},
    "overview": {vol.Optional("top"): int},
}
ADMIN_ONLY = {"overview"}


def _hub(hass: HomeAssistant) -> LearningHub:
    return hass.data[DOMAIN + "_learning"]


def _entry(mgr: HomeQuestManager, cfg: dict) -> dict[str, tuple[bool, str]]:
    stage = fortress_stage(mgr.state, mgr.story)
    return {k: entry_status(cfg, stage, (mgr.state.get("kids", {}).get(k) or {}).get("inventory")) for k in mgr.catalog["kids"]}


def _command(cmd: str):
    @websocket_api.websocket_command({vol.Required("type"): f"homequest/learn_{cmd}", **KID, **SCHEMAS[cmd]})
    @_handler(admin_only=cmd in ADMIN_ONLY, pin_gate=False)
    async def run(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
        hub = _hub(mgr.hass)
        as_kid = None if ident.is_admin else ident.kid_id
        data = dict(msg)
        if ident.kid_id is not None:
            data["kid_id"] = ident.kid_id
        try:
            result = handle(hub, cmd, data, mgr.catalog["kids"], as_kid, _entry(mgr, hub.cfg))
        except LearnError as err:
            connection.send_error(msg["id"], err.code, err.message)
            return None
        for kid, n in pending_coins(hub.data).items():                 # the coins of the hams go through the store's own mutation; what fails waits for the next command
            try:
                await mgr.async_adjust(kid, n, "Lov: šunky")
            except Exception:                                          # noqa: BLE001 - the child's reward must not break the game; it stays pending
                continue
            settle_coins(hub.data, kid, n)
            hub.save(hub.data)
        return result

    run.__name__ = f"ws_learn_{cmd}"
    return run


async def async_setup_learning(hass: HomeAssistant) -> None:
    """Load the tracking data and the hunt configuration, register the commands."""
    store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
    data = await store.async_load() or empty_data()
    cfg = await hass.async_add_executor_job(load_config)
    hass.data[DOMAIN + "_learning"] = LearningHub(data, cfg, save=lambda d: store.async_delay_save(lambda: d, SAVE_DELAY_S))
    for cmd in SCHEMAS:
        websocket_api.async_register_command(hass, _command(cmd))
