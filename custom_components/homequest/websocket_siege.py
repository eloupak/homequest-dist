"""Websocket commands of the siege of the fortress (#118): homequest/siege_* for the children (and a parent acting as a child, kid_id/panel_kid).
Unlike the minigames (websocket_games.py, test only) they are registered everywhere: the game of the siege is how the children defend the fortress.
The one game hub (hass.data[DOMAIN + "_games"]) is shared with the minigames of the test panel."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .game import siege
from .game.session import GameError, GameHub, GameSession
from .store import HomeQuestManager, Identity, get_manager
from .websocket import KID, _handler

_LOGGER = logging.getLogger(__name__)

SCHEMAS: dict[str, dict] = {
    "ping": {},
    "state": {},
    "join": {},
    "leave": {},
    "ready": {},
    "event": {vol.Required("t"): int, vol.Optional("action"): vol.In(("swing", "jump"))},
}


def get_hub(hass: HomeAssistant) -> GameHub:
    """The game hub of the instance (created once, by whichever module registers first)."""
    key = DOMAIN + "_games"
    if key not in hass.data:
        hass.data[key] = GameHub()
    return hass.data[key]


def _owner(connection: Any) -> str:
    return f"c{id(connection)}"


def _command(cmd: str):
    @websocket_api.websocket_command({vol.Required("type"): f"homequest/siege_{cmd}", **KID, **SCHEMAS[cmd]})
    @_handler()
    async def run(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
        kid_id = mgr.require_kid(ident)
        try:
            return siege.handle(get_hub(mgr.hass), _owner(connection), cmd, msg, kid_id, mgr.catalog["kids"], mgr.siege_for_game())
        except GameError as err:
            connection.send_error(msg["id"], err.code, err.message)
            return None

    run.__name__ = f"ws_siege_{cmd}"
    return run


@websocket_api.websocket_command({vol.Required("type"): "homequest/siege_subscribe", **KID})
@_handler()
async def ws_siege_subscribe(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    """Events {kind: "session", session: snapshot|None} (only a siege session) and {kind: "state", ...} of the siege game."""
    mgr.require_kid(ident)
    hub, owner = get_hub(mgr.hass), _owner(connection)

    def push(kind: str, payload: dict) -> None:
        if kind == "session":
            payload = siege.view(hub)
        elif siege.siege_session(hub) is None:
            return
        connection.send_message(websocket_api.event_message(msg["id"], {"kind": kind, "me": owner, **payload}))

    lid = hub.add_listener(push)

    def unsub() -> None:
        hub.remove_listener(lid)
        hub.drop_owner(owner)

    connection.subscriptions[msg["id"]] = unsub
    connection.send_result(msg["id"])
    push("session", {})
    return None


@websocket_api.websocket_command({vol.Required("type"): "homequest/scene_seen", vol.Required("stage"): str, vol.Optional("what", default="scene"): vol.In(["scene", "won"]), **KID})
@_handler()
async def ws_scene_seen(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    return await mgr.async_scene_seen(mgr.require_kid(ident), msg["stage"], msg["what"])


@websocket_api.websocket_command({vol.Required("type"): "homequest/story_seen", vol.Required("what"): vol.In(("intro", "stage")), vol.Optional("index"): int, **KID})
@_handler()
async def ws_story_seen(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    """The intro / a stage celebration seen to the end on this device: kept on the server, so another phone does not play it again (v1.4.0)."""
    return await mgr.async_story_seen(mgr.require_kid(ident), msg["what"], msg.get("index"))


@websocket_api.websocket_command({vol.Required("type"): "homequest/siege_start", **KID})
@_handler(admin_only=True)
async def ws_siege_start(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    """The parent's "Spustit útok skřetů" (after a win: "Spustit útok znovu", a replay). Idempotent."""
    return await mgr.async_siege_start()


@websocket_api.websocket_command({vol.Required("type"): "homequest/siege_away", vol.Required("away"): bool, **KID})
@_handler()
async def ws_siege_away(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    """The cross (away: true, after siege_leave) / the Quest button back into the battle (away: false), #118."""
    res = await mgr.async_siege_away(mgr.require_kid(ident), msg["away"])
    siege.refresh_kids(get_hub(mgr.hass), mgr.siege_for_game())
    return res


@websocket_api.websocket_command({vol.Required("type"): "homequest/siege_replay", **KID})
@_handler()
async def ws_siege_replay(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    """The Quest button after the win: a replay (only a game) for this child, #118."""
    res = await mgr.async_siege_replay(mgr.require_kid(ident))
    siege.refresh_kids(get_hub(mgr.hass), mgr.siege_for_game())
    return res


@websocket_api.websocket_command({vol.Required("type"): "homequest/siege_stop", **KID})
@_handler(admin_only=True)
async def ws_siege_stop(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    """The parent's "Ukončit útok": ends a running replay (and its lobby or game)."""
    res = await mgr.async_siege_stop()
    if res.get("changed"):
        siege.abort(get_hub(mgr.hass))
    return res


@websocket_api.websocket_command({vol.Required("type"): "homequest/siege_win", **KID})
@_handler()
async def ws_siege_win(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    """TEST only: "Vyhrát" ends the running siege game as won. Registered only with env_test, and refused without it."""
    if not mgr.env_test:
        connection.send_error(msg["id"], "forbidden", "only on the test instance")
        return None
    try:
        return siege.win_test(get_hub(mgr.hass), mgr.require_kid(ident))
    except GameError as err:
        connection.send_error(msg["id"], err.code, err.message)
        return None


@websocket_api.websocket_command({vol.Required("type"): "homequest/claim_siege", vol.Required("stage"): str, vol.Required("color"): str, **KID})
@_handler()
async def ws_claim_siege(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    """The amulet for the won siege in the chosen colour; idempotent (a second call keeps the first colour)."""
    return await mgr.async_claim_siege(mgr.require_kid(ident), msg["stage"], msg["color"])


def async_register(hass: HomeAssistant) -> None:
    hub = get_hub(hass)
    mgr = get_manager(hass)

    def on_finish(s: GameSession) -> None:
        res = siege.result(s)
        if res is None:
            return
        stage, won, kids = res
        _LOGGER.info("siege of %s: %s (%s)", stage, "won" if won else "lost", ", ".join(kids))
        hass.async_create_task(mgr.async_siege_end(stage, won, kids))

    hub.on_finish = on_finish
    for cmd in SCHEMAS:
        websocket_api.async_register_command(hass, _command(cmd))
    for cmd in (ws_siege_subscribe, ws_scene_seen, ws_story_seen, ws_claim_siege, ws_siege_start, ws_siege_stop, ws_siege_away, ws_siege_replay):
        websocket_api.async_register_command(hass, cmd)
    if mgr.env_test:                                     # "Vyhrát" exists only on TEST (the flag file is not in production)
        websocket_api.async_register_command(hass, ws_siege_win)
