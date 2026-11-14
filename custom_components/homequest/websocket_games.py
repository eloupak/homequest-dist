"""Websocket commands of the minigames (homequest/game_*). Registered ONLY where <data>/dev_panels exists, and for admins only."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .game.api import handle
from .game.session import GameError, GameHub
from .store import get_manager
from .websocket_siege import get_hub

SCHEMAS: dict[str, dict] = {
    "ping": {},
    "state": {},
    "create": {vol.Optional("game"): str},
    "join": {vol.Required("session_id"): str, vol.Optional("kind"): vol.In(("kid", "guest")), vol.Optional("kid_id"): str, vol.Optional("name"): str, vol.Optional("level"): str},
    "leave": {vol.Required("session_id"): str, vol.Required("pid"): str},
    "start": {vol.Required("session_id"): str},
    "end": {vol.Required("session_id"): str},
    "win": {vol.Required("session_id"): str},
    "event": {vol.Required("session_id"): str, vol.Required("pid"): str, vol.Required("t"): int, vol.Optional("action"): vol.In(("swing", "jump"))},
}


def _hub(hass: HomeAssistant) -> GameHub:
    return hass.data[DOMAIN + "_games"]


def _owner(connection: Any) -> str:
    return f"c{id(connection)}"


def _command(cmd: str):
    @websocket_api.websocket_command({vol.Required("type"): f"homequest/game_{cmd}", **SCHEMAS[cmd]})
    @websocket_api.async_response
    async def run(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
        if connection.user is None or not connection.user.is_admin:
            connection.send_error(msg["id"], "forbidden", "the games are for parents (admins) only")
            return
        try:
            result = handle(_hub(hass), _owner(connection), cmd, msg, get_manager(hass).catalog["kids"])
        except GameError as err:
            connection.send_error(msg["id"], err.code, err.message)
            return
        connection.send_result(msg["id"], result)

    return run


@websocket_api.websocket_command({vol.Required("type"): "homequest/game_subscribe"})
@websocket_api.async_response
async def ws_game_subscribe(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
    """Events {kind: "session", session: snapshot|None} on every structural change, {kind: "state", ...} on every change of the shared state."""
    if connection.user is None or not connection.user.is_admin:
        connection.send_error(msg["id"], "forbidden", "the games are for parents (admins) only")
        return
    hub, owner = _hub(hass), _owner(connection)

    def push(kind: str, payload: dict) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], {"kind": kind, "me": owner, **payload}))

    lid = hub.add_listener(push)

    def unsub() -> None:
        hub.remove_listener(lid)
        hub.drop_owner(owner)

    connection.subscriptions[msg["id"]] = unsub
    connection.send_result(msg["id"])
    push("session", hub.current())


def async_register(hass: HomeAssistant) -> None:
    get_hub(hass)                                 # the hub of the siege (websocket_siege) is shared
    for cmd in SCHEMAS:
        websocket_api.async_register_command(hass, _command(cmd))
    websocket_api.async_register_command(hass, ws_game_subscribe)
