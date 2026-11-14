"""Sound lab (TEST instance only, registered together with the dev panels): the parent's choice of one variant (a/b/c) per game action.

The choice is a small file <data>/sound_choices.json ({action: "a"|"b"|"c"}); it is never part of the children's game state. The game reads it
through `homequest/sound_map` (test only; in production the command does not exist and sounds/map.json from the release is used)."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .sound_choices import CHOICES_FILE, action_ids, load_choices, save_choice
from .store import get_manager



def _is_admin(connection: Any) -> bool:
    return connection.user is not None and connection.user.is_admin


@websocket_api.websocket_command({vol.Required("type"): "homequest/sound_map", vol.Optional("panel_kid"): str})
@websocket_api.async_response
async def ws_sound_map(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
    """The chosen variants, for the game on the test instance (any logged-in user: the children play there too)."""
    path = get_manager(hass).data_dir / CHOICES_FILE
    connection.send_result(msg["id"], {"map": await hass.async_add_executor_job(load_choices, path)})


@websocket_api.websocket_command({vol.Required("type"): "homequest/sound_choose", vol.Required("action"): str, vol.Required("variant"): str})
@websocket_api.async_response
async def ws_sound_choose(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
    if not _is_admin(connection):
        connection.send_error(msg["id"], "forbidden", "the sound lab is for parents (admins) only")
        return
    path = get_manager(hass).data_dir / CHOICES_FILE
    try:
        valid = await hass.async_add_executor_job(action_ids)
        choices = await hass.async_add_executor_job(save_choice, path, msg["action"], msg["variant"], valid)
    except ValueError as err:
        connection.send_error(msg["id"], "invalid", str(err))
        return
    connection.send_result(msg["id"], {"map": choices})


def async_register(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_sound_map)
    websocket_api.async_register_command(hass, ws_sound_choose)
