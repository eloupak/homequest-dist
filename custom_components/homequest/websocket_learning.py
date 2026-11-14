"""Websocket commands of the learning games (homequest/learn_*). Registered ONLY where <data>/dev_panels exists, and for admins only.
The tracking data lives in its own storage file (.storage/homequest.learning), never in homequest.state."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN
from .game.learn_api import handle
from .game.learning import LearnError, LearningHub, empty_data, load_config, pending_coins, settle_coins
from .store import get_manager

STORAGE_KEY = "homequest.learning"
STORAGE_VERSION = 1
SAVE_DELAY_S = 5

SCHEMAS: dict[str, dict] = {
    "state": {},
    "start": {vol.Required("kid_id"): str, vol.Required("op"): str},
    "answer": {vol.Required("set_id"): str, vol.Required("answer"): vol.Any(int, str), vol.Optional("ms"): vol.Any(int, float)},
    "overview": {vol.Required("kid_id"): str, vol.Optional("top"): int},
}


def _hub(hass: HomeAssistant) -> LearningHub:
    return hass.data[DOMAIN + "_learning"]


def _command(cmd: str):
    @websocket_api.websocket_command({vol.Required("type"): f"homequest/learn_{cmd}", **SCHEMAS[cmd]})
    @websocket_api.async_response
    async def run(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
        if connection.user is None or not connection.user.is_admin:
            connection.send_error(msg["id"], "forbidden", "the learning games are for parents (admins) only")
            return
        hub, mgr = _hub(hass), get_manager(hass)
        try:
            result = handle(hub, cmd, msg, mgr.catalog["kids"])
        except LearnError as err:
            connection.send_error(msg["id"], err.code, err.message)
            return
        for kid, n in pending_coins(hub.data).items():                 # the coins of the hams go through the store's own mutation; what fails waits for the next command
            try:
                await mgr.async_adjust(kid, n, "Lov: šunky")
            except Exception:                                          # noqa: BLE001 - the child's reward must not break the game; it stays pending
                continue
            settle_coins(hub.data, kid, n)
            hub.save(hub.data)
        connection.send_result(msg["id"], result)

    return run


async def async_setup_learning(hass: HomeAssistant) -> None:
    """Load the tracking data and the hunt configuration, register the commands."""
    store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
    data = await store.async_load() or empty_data()
    cfg = await hass.async_add_executor_job(load_config)
    hass.data[DOMAIN + "_learning"] = LearningHub(data, cfg, save=lambda d: store.async_delay_save(lambda: d, SAVE_DELAY_S))
    for cmd in SCHEMAS:
        websocket_api.async_register_command(hass, _command(cmd))
