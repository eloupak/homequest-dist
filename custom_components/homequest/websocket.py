"""Websocket API for the HomeQuest panel."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .logic import HomeQuestError
from .store import VIA, HomeQuestManager, Identity, get_manager

KID = {vol.Optional("kid_id"): str, vol.Optional("panel_kid"): str}


def _handler(
    admin_only: bool = False,
    pin_gate: bool = True,
    before_start: bool = False,
) -> Callable[[Callable[..., Awaitable[Any]]], Callable[..., Any]]:
    """Wrap a command: resolve identity, map HomeQuestError to websocket errors."""

    def decorator(func: Callable[..., Awaitable[Any]]) -> Callable[..., Any]:
        @websocket_api.async_response
        async def wrapper(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
            mgr = get_manager(hass)
            token = None
            try:
                ident = await mgr.async_identity(connection.user, msg.get("kid_id"), msg.get("panel_kid"), admin_only)
                if admin_only:
                    mgr.require_admin(ident)
                    if pin_gate:
                        mgr.pin_require(id(connection))          # parent functions need the PIN when one is set
                elif not before_start and not ident.is_admin and not mgr.state.get("started_at"):
                    raise HomeQuestError("not_started", "the game has not started yet (Spustit hru in the parent's guide)")
                token = VIA.set(ident.via)
                result = await func(mgr, ident, connection, msg)
            except HomeQuestError as err:
                connection.send_error(msg["id"], err.code, err.message)
                return
            finally:
                if token is not None:
                    VIA.reset(token)
            if result is not None:
                connection.send_result(msg["id"], result)

        return wrapper

    return decorator


@websocket_api.websocket_command({vol.Required("type"): "homequest/state", **KID})
@_handler(before_start=True)
async def ws_state(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    return mgr.view(ident)


@websocket_api.websocket_command({vol.Required("type"): "homequest/subscribe", **KID})
@_handler(before_start=True)
async def ws_subscribe(
    mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict
) -> Any:
    def push() -> None:
        connection.send_message(websocket_api.event_message(msg["id"], mgr.view(ident)))

    connection.subscriptions[msg["id"]] = mgr.add_listener(push)
    connection.send_result(msg["id"])
    push()
    return None


@websocket_api.websocket_command(
    {
        vol.Required("type"): "homequest/onboard",
        vol.Required("hero"): dict,
        **KID,
    }
)
@_handler()
async def ws_onboard(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    await mgr.async_onboard(mgr.require_kid(ident), msg["hero"])
    return {}


@websocket_api.websocket_command(
    {vol.Required("type"): "homequest/complete", vol.Required("task_id"): str, **KID}
)
@_handler()
async def ws_complete(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    await mgr.async_complete(mgr.require_kid(ident), msg["task_id"])
    return {}


@websocket_api.websocket_command(
    {
        vol.Required("type"): "homequest/approve",
        vol.Optional("panel_kid"): str,
        vol.Required("kid_id"): str,
        vol.Required("task_id"): str,
    }
)
@_handler(admin_only=True)
async def ws_approve(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    await mgr.async_approve(msg["kid_id"], msg["task_id"])
    return {}


@websocket_api.websocket_command(
    {
        vol.Required("type"): "homequest/reject",
        vol.Optional("panel_kid"): str,
        vol.Required("kid_id"): str,
        vol.Required("task_id"): str,
    }
)
@_handler(admin_only=True)
async def ws_reject(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    await mgr.async_reject(msg["kid_id"], msg["task_id"])
    return {}


@websocket_api.websocket_command(
    {vol.Required("type"): "homequest/buy", vol.Required("item_id"): str, **KID}
)
@_handler()
async def ws_buy(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    await mgr.async_buy(mgr.require_kid(ident), msg["item_id"])
    return {}


@websocket_api.websocket_command(
    {vol.Required("type"): "homequest/claim_gift", vol.Required("stage"): str, **KID}
)
@_handler()
async def ws_claim_gift(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    """The gift of a reached fortress stage; idempotent (a second call pays nothing)."""
    return await mgr.async_claim_gift(mgr.require_kid(ident), msg["stage"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): "homequest/equip",
        vol.Optional("item_id"): vol.Any(str, None),
        vol.Optional("slot"): vol.Any(str, None),
        **KID,
    }
)
@_handler()
async def ws_equip(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    await mgr.async_equip(mgr.require_kid(ident), msg.get("item_id"), msg.get("slot"))
    return {}


@websocket_api.websocket_command(
    {
        vol.Required("type"): "homequest/admin_adjust",
        vol.Optional("panel_kid"): str,
        vol.Required("kid_id"): str,
        vol.Required("delta"): int,
        vol.Optional("note", default=""): str,
    }
)
@_handler(admin_only=True)
async def ws_adjust(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    await mgr.async_adjust(msg["kid_id"], msg["delta"], msg["note"])
    return {}


@websocket_api.websocket_command(
    {vol.Required("type"): "homequest/reset_hero", vol.Optional("panel_kid"): str, vol.Required("kid_id"): str}
)
@_handler(admin_only=True)
async def ws_reset_hero(
    mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict
) -> Any:
    await mgr.async_reset_hero(msg["kid_id"])
    return {}


@websocket_api.websocket_command(
    {vol.Required("type"): "homequest/set_approval", vol.Optional("panel_kid"): str, vol.Required("kid_id"): str, vol.Required("value"): bool}
)
@_handler(admin_only=True)
async def ws_set_approval(
    mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict
) -> Any:
    return await mgr.async_set_approval(msg["kid_id"], msg["value"])


def _admin_cmd(name: str, fields: dict, fn_name: str, *keys: str):
    """A parent-only command: homequest/<name> with `fields`, calls mgr.<fn_name>(msg[keys]...)."""

    @websocket_api.websocket_command({vol.Required("type"): f"homequest/{name}", vol.Optional("panel_kid"): str, vol.Optional("kid_id"): str, **fields})
    @_handler(admin_only=True)
    async def cmd(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
        return await getattr(mgr, fn_name)(*[msg.get(k) for k in keys])

    cmd.__name__ = f"ws_{name}"
    return cmd


ws_set_task = _admin_cmd("set_task", {vol.Required("task_id"): str, vol.Optional("workday"): vol.Any(bool, None), vol.Optional("free"): vol.Any(bool, None), vol.Optional("kids"): [str], vol.Optional("single"): bool}, "async_set_task", "task_id", "workday", "free", "kids", "single")
ws_add_task = _admin_cmd("add_task", {vol.Required("name"): str, vol.Required("reward"): int, vol.Required("period"): vol.In(["daily", "oneoff"]), vol.Optional("kids"): [str], vol.Optional("single"): bool, vol.Optional("days"): [str]},
                         "async_add_task", "name", "reward", "period", "kids", "single", "days")
ws_update_task = _admin_cmd("update_task", {vol.Required("task_id"): str, vol.Optional("name"): str, vol.Optional("reward"): int, vol.Optional("kids"): [str], vol.Optional("single"): bool, vol.Optional("days"): [str]},
                            "async_update_task", "task_id", "name", "reward", "kids", "single", "days")
ws_remove_task = _admin_cmd("remove_task", {vol.Required("task_id"): str, vol.Optional("only_kid"): str}, "async_remove_task", "task_id", "only_kid")
ws_set_holidays = _admin_cmd("set_holidays", {vol.Required("until"): vol.Any(str, None)}, "async_set_holidays", "until")
ws_add_oneoff = _admin_cmd("add_oneoff", {vol.Required("name"): str, vol.Required("reward"): int, vol.Required("single"): bool, vol.Optional("kids"): [str]}, "async_add_oneoff", "name", "reward", "single", "kids")
ws_delete_oneoff = _admin_cmd("delete_oneoff", {vol.Required("task_id"): str}, "async_delete_oneoff", "task_id")
ws_save_template = _admin_cmd("save_template", {vol.Required("name"): str, vol.Required("reward"): int, vol.Required("single"): bool, vol.Optional("kids"): [str]}, "async_save_template", "name", "reward", "single", "kids")
ws_delete_template = _admin_cmd("delete_template", {vol.Required("template_id"): str}, "async_delete_template", "template_id")

ws_set_notify_targets = _admin_cmd("set_notify_targets", {vol.Required("targets"): [str]}, "async_set_notify_targets", "targets")
ws_set_report_repo = _admin_cmd("set_report_repo", {vol.Required("repo"): vol.Any(str, None)}, "async_set_report_repo", "repo")
ws_set_ha_reward = _admin_cmd("set_ha_reward", {vol.Required("reward"): int}, "async_set_ha_reward", "reward")
ws_set_story_vars = _admin_cmd("set_story_vars", {vol.Required("vars"): {str: str}}, "async_set_story_vars", "vars")


@websocket_api.websocket_command({vol.Required("type"): "homequest/notify_services", vol.Optional("panel_kid"): str})
@_handler(admin_only=True)
async def ws_notify_services(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    """The phones HA knows (notify.mobile_app_*) for Settings -> Notifications (v1.5, #128)."""
    return {"services": await mgr.notify_services(), "targets": list(mgr.state.get("notify_targets") or [])}


# ---- the setup guide (v1.6, #137) and the parent's own paragraphs of the story

SETUP_KID_FIELDS = {vol.Optional(k): vol.Any(str, None) for k in ("name", "vocative", "ha_user", "hero_name", "body", "hair", "skin")}


@websocket_api.websocket_command({vol.Required("type"): "homequest/setup_kid", vol.Optional("panel_kid"): str, vol.Optional("kid_id"): vol.Any(str, None), vol.Optional("child"): vol.Any(str, None), vol.Optional("data", default={}): SETUP_KID_FIELDS})
@_handler(admin_only=True)
async def ws_setup_kid(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    """A new child (no `child`) or a change of one (name, vocative, HA account, hero; body / hair / skin only before the start). `child`, not
    kid_id: on TEST the guide works on a copy where a new child is not a child of the live game yet."""
    return await mgr.async_setup_kid(msg.get("child"), msg["data"])


ws_setup_remove_kid = _admin_cmd("setup_remove_kid", {vol.Required("child"): str}, "async_setup_remove_kid", "child")
ws_set_parents = _admin_cmd("set_parents", {vol.Required("parents"): [str]}, "async_set_parents", "parents")
ws_setup_step = _admin_cmd("setup_step", {vol.Required("step"): str}, "async_setup_step", "step")
ws_start_game = _admin_cmd("start_game", {vol.Optional("confirm"): vol.Any(str, None)}, "async_start_game", "confirm")
ws_setup_reset_sandbox = _admin_cmd("setup_reset_sandbox", {}, "async_setup_reset_sandbox")
ws_set_story_text = _admin_cmd("set_story_text", {vol.Required("paragraph"): str, vol.Required("text"): vol.Any(str, None)}, "async_set_story_text", "paragraph", "text")


@websocket_api.websocket_command({vol.Required("type"): "homequest/setup_users", vol.Optional("panel_kid"): str})
@_handler(admin_only=True)
async def ws_setup_users(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    """The HA users for the guide: the children's accounts and the parents (no passwords, no tokens: id, name, login name, admin)."""
    return {"users": await mgr.async_setup_users()}


@websocket_api.websocket_command({vol.Required("type"): "homequest/story_texts", vol.Optional("panel_kid"): str})
@_handler(admin_only=True)
async def ws_story_texts(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    """Every paragraph of the story with its default and the parent's own text (Settings -> Příběh)."""
    return mgr.story_texts_view()


@websocket_api.websocket_command({vol.Required("type"): "homequest/pin_status", vol.Optional("panel_kid"): str})
@_handler(admin_only=True, pin_gate=False)
async def ws_pin_status(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    return mgr.pin_status(id(connection))


@websocket_api.websocket_command({vol.Required("type"): "homequest/pin_verify", vol.Required("pin"): str, vol.Optional("panel_kid"): str})
@_handler(admin_only=True, pin_gate=False)
async def ws_pin_verify(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    mgr.pin_verify(id(connection), msg["pin"])
    return mgr.pin_status(id(connection))


@websocket_api.websocket_command({vol.Required("type"): "homequest/pin_lock", vol.Optional("panel_kid"): str})
@_handler(admin_only=True, pin_gate=False)
async def ws_pin_lock(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    mgr.pin().lock(id(connection))
    return mgr.pin_status(id(connection))


@websocket_api.websocket_command(
    {vol.Required("type"): "homequest/pin_set", vol.Required("pin"): vol.Any(str, None), vol.Optional("panel_kid"): str}
)
@_handler(admin_only=True, pin_gate=False)
async def ws_pin_set(mgr: HomeQuestManager, ident: Identity, connection: Any, msg: dict) -> Any:
    """Set, change (pin = the new one) or remove (pin = null) the parent PIN; with a PIN already set, the session must have entered it."""
    return await mgr.async_pin_set(id(connection), msg["pin"])


def async_register(hass: HomeAssistant) -> None:
    for cmd in (
        ws_state,
        ws_subscribe,
        ws_onboard,
        ws_complete,
        ws_approve,
        ws_reject,
        ws_buy,
        ws_claim_gift,
        ws_equip,
        ws_adjust,
        ws_reset_hero,
        ws_set_approval,
        ws_set_task,
        ws_add_task,
        ws_update_task,
        ws_remove_task,
        ws_set_holidays,
        ws_add_oneoff,
        ws_delete_oneoff,
        ws_save_template,
        ws_delete_template,
        ws_set_notify_targets,
        ws_set_report_repo,
        ws_set_ha_reward,
        ws_set_story_vars,
        ws_notify_services,
        ws_setup_kid,
        ws_setup_remove_kid,
        ws_set_parents,
        ws_setup_step,
        ws_start_game,
        ws_setup_reset_sandbox,
        ws_set_story_text,
        ws_setup_users,
        ws_story_texts,
        ws_pin_status,
        ws_pin_verify,
        ws_pin_lock,
        ws_pin_set,
    ):
        websocket_api.async_register_command(hass, cmd)
