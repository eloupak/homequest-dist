"""HomeQuest — kids' chore game inside Home Assistant."""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any

import voluptuous as vol

from aiohttp import web

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import HomeAssistantView, StaticPathConfig
from homeassistant import config_entries
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.discovery import async_load_platform

from . import sound_lab, websocket, websocket_games, websocket_learning, websocket_siege
from .const import ASSETS_URL, DEV_PANELS_FLAG, DOMAIN, STATIC_URL, VERSION
from .logic import HomeQuestError
from .store import HomeQuestManager

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.empty_config_schema(DOMAIN)

class FrontendView(HomeAssistantView):
    """Serve the panel's JS with `Cache-Control: no-cache` so app/browser caches always revalidate
    (ETag makes that cheap) and updated modules are picked up after a deploy."""

    url = STATIC_URL + "/{path:.*}"
    name = "homequest:static"
    requires_auth = False

    def __init__(self, root: Path) -> None:
        self._root = root.resolve()

    async def get(self, request: web.Request, path: str) -> web.StreamResponse:
        target = (self._root / path).resolve()
        if not target.is_file() or self._root not in target.parents:
            raise web.HTTPNotFound()
        return web.FileResponse(target, headers={"Cache-Control": "no-cache"})


KID_TASK_SCHEMA = vol.Schema({vol.Required("kid_id"): str, vol.Required("task_id"): str})
ADD_TASK_SCHEMA = vol.Schema({                          # v1.8 (#166): homequest.add_task for automations
    vol.Optional("entity_id"): cv.comp_entity_ids,      # the children's To-do lists; none = every child
    vol.Required("name"): vol.All(cv.string, vol.Length(min=1, max=60)),
    vol.Optional("reward"): vol.All(vol.Coerce(int), vol.Range(min=0, max=50)),
    vol.Optional("single", default=False): cv.boolean,
    vol.Optional("skip_if_open", default=True): cv.boolean,
}, extra=vol.ALLOW_EXTRA)                               # target: device_id / area_id are ignored, the lists have neither


async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    """`homequest:` in configuration.yaml (the first install's PROD and TEST): start here. Without it the integration is added in Settings -> Devices &
    services (config flow, v1.6) and starts in async_setup_entry; one HomeQuest per HA either way."""
    if DOMAIN not in config:
        return True
    # v1.7 (#143): take the YAML over into a config entry (once); the entry does not start a second HomeQuest (async_setup_entry sees hass.data)
    hass.async_create_task(hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_IMPORT}, data={}))
    return await _async_start(hass, config)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    if DOMAIN in hass.data:
        return True                                   # started from configuration.yaml already
    return await _async_start(hass, {})


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    return False                                      # panels, websocket commands and timers stay until HA restarts


def _panel_path(kid_id: str) -> str:
    return f"homequest-{kid_id.replace('_', '-')}"


async def _async_sync_kid_panels(hass: HomeAssistant, mgr: HomeQuestManager, registered: dict[str, str], module_url: str) -> None:
    """One panel per child for playing on the parent's phone (admins only): the same web component, fixed to one kid by its config.
    v1.6: also while HA runs (a child added in the guide gets its panel at once, a renamed one a new sidebar title, a removed one loses it)."""
    want = {_panel_path(k["id"]): k for k in mgr.catalog["kids"].values()}
    for path in list(registered):
        if path not in want or registered[path] != want[path]["name"]:
            frontend.async_remove_panel(hass, path, warn_if_unknown=False)
            del registered[path]
    for path, kid in want.items():
        if path in registered:
            continue
        # the server refuses every parent command that comes with a child panel's kid (access.resolve), hiding the tab is not the protection
        try:
            await panel_custom.async_register_panel(
                hass,
                frontend_url_path=path,
                webcomponent_name="homequest-panel",
                sidebar_title=f"HomeQuest {kid['name']}",
                sidebar_icon="mdi:sword-cross",
                module_url=module_url,                # the same URL as /homequest: another ?v= loads the module twice (define error, #137)
                config={"kid_id": kid["id"]},
                require_admin=True,
                embed_iframe=False,
            )
        except Exception as err:  # noqa: BLE001  (#140 d: the family sees it in Repairs, the other panels go on)
            _panel_failed(mgr, path, err)
            continue
        registered[path] = kid["name"]


def _panel_failed(mgr: HomeQuestManager, path: str, err: Exception) -> None:
    _LOGGER.error("HomeQuest panel /%s could not be registered: %s", path, err)
    mgr.repair("panel_failed", {"panel": f"/{path}", "error": f"{type(err).__name__}: {err}"[:300]})


async def _async_start(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    mgr = HomeQuestManager(hass)
    if not await mgr.async_setup():
        _LOGGER.error("HomeQuest not started: see the error above (Settings -> Repairs), then restart Home Assistant")
        return False
    hass.data[DOMAIN] = mgr

    websocket.async_register(hass)
    websocket_siege.async_register(hass)          # the siege of the fortress (#118): the children's game, everywhere
    _register_services(hass, mgr)

    frontend_dir = Path(__file__).parent / "frontend"
    await hass.async_add_executor_job(
        lambda: mgr.assets_dir.mkdir(parents=True, exist_ok=True)
    )
    hass.http.register_view(FrontendView(frontend_dir))
    await hass.http.async_register_static_paths(
        [StaticPathConfig(ASSETS_URL, str(mgr.assets_dir), True)]
    )
    panel_url = f"{STATIC_URL}/homequest-panel.js?v={VERSION}-{int(time.time())}"   # one URL for every HomeQuest panel of this HA run
    try:
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path="homequest",
            webcomponent_name="homequest-panel",
            sidebar_title="HomeQuest",
            sidebar_icon="mdi:castle",
            module_url=panel_url,
            require_admin=False,
            embed_iframe=False,
        )
    except Exception as err:  # noqa: BLE001  (#140 d)
        _panel_failed(mgr, "homequest", err)
    kid_panels: dict[str, str] = {}

    async def _kids_changed() -> None:
        await _async_sync_kid_panels(hass, mgr, kid_panels, panel_url)
        if mgr.add_kid_sensors:
            mgr.add_kid_sensors()                     # the sensors of a new child (sensor.py), without a restart
        if mgr.add_kid_todo:
            mgr.add_kid_todo()                        # v1.8: the To-do list of a new child, away with a removed one (todo.py)

    mgr.kids_changed = _kids_changed
    await _kids_changed()
    # the learning games (the maths hunt): own commands and own storage file; since v1.9 (#189) everywhere, a child hunts from the Quest tab
    await websocket_learning.async_setup_learning(hass)
    # development panels (3D heroes, 2D motion test page): only where the flag file <data>/dev_panels exists (the test instance), never in production
    if await hass.async_add_executor_job((mgr.data_dir / DEV_PANELS_FLAG).exists):
        # second, independent panel: 3D heroes (KayKit), admin only for now. Same static view (frontend/three3d/), models via the assets route.
        # Paused: deploy.sh test leaves frontend/three3d out, then the panel is not registered.
        if await hass.async_add_executor_job((Path(__file__).parent / "frontend" / "three3d").is_dir):
            await panel_custom.async_register_panel(
                hass,
                frontend_url_path="homequest3d",
                webcomponent_name="homequest3d-panel",
                sidebar_title="HomeQuest 3D",
                sidebar_icon="mdi:cube-outline",
                module_url=f"{STATIC_URL}/three3d/homequest3d-panel.js?v={VERSION}-{int(time.time())}",
                require_admin=True,
                embed_iframe=False,
            )
        # third panel (admin only): the 2D motion test page as a sidebar entry (no ?dev=motion URL needed in the app)
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path="homequest-motion",
            webcomponent_name="homequest-motion-panel",
            sidebar_title="HomeQuest pohyb",
            sidebar_icon="mdi:run-fast",
            module_url=f"{STATIC_URL}/homequest-motion-panel.js?v={VERSION}-{int(time.time())}",
            require_admin=True,
            embed_iframe=False,
        )
        # fourth (admin only, test only): the minigames. Their websocket commands exist only here, never in production.
        websocket_games.async_register(hass)
        sound_lab.async_register(hass)             # the sound lab: the parent's choice of the sound variants (test only)
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path="homequest-sounds",
            webcomponent_name="homequest-sounds-panel",
            sidebar_title="HomeQuest Zvuky (test)",
            sidebar_icon="mdi:volume-high",
            module_url=f"{STATIC_URL}/sounds/homequest-sounds-panel.js?v={VERSION}-{int(time.time())}",
            require_admin=True,
            embed_iframe=False,
        )
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path="homequest-learning",
            webcomponent_name="homequest-learning-panel",
            sidebar_title="HomeQuest Učení (test)",
            sidebar_icon="mdi:school",
            module_url=f"{STATIC_URL}/games/homequest-learning-panel.js?v={VERSION}-{int(time.time())}",
            require_admin=True,
            embed_iframe=False,
        )
        # the swing lab (#101): the scene of the siege without orcs and without a server game, any outfit / weapon / offhand (page memory only)
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path="homequest-swing-lab",
            webcomponent_name="homequest-swinglab-panel",
            sidebar_title="HomeQuest Zkušebna švihu (test)",
            sidebar_icon="mdi:sword",
            module_url=f"{STATIC_URL}/games/homequest-swinglab-panel.js?v={VERSION}-{int(time.time())}",
            require_admin=True,
            embed_iframe=False,
        )
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path="homequest-games",
            webcomponent_name="homequest-games-panel",
            sidebar_title="HomeQuest Hry (test)",
            sidebar_icon="mdi:gamepad-variant",
            module_url=f"{STATIC_URL}/games/homequest-games-panel.js?v={VERSION}-{int(time.time())}",
            require_admin=True,
            embed_iframe=False,
        )
    hass.async_create_task(async_load_platform(hass, "sensor", DOMAIN, {}, config))
    hass.async_create_task(async_load_platform(hass, "todo", DOMAIN, {}, config))      # v1.8 (#173): a To-do list per child
    return True


def _register_services(hass: HomeAssistant, mgr: HomeQuestManager) -> None:
    async def _call(func: Any, call: ServiceCall) -> None:
        try:
            await func(call.data["kid_id"], call.data["task_id"])
        except HomeQuestError as err:
            raise vol.Invalid(f"{err.code}: {err.message}") from err

    async def approve(call: ServiceCall) -> None:
        await _call(mgr.async_approve, call)

    async def reject(call: ServiceCall) -> None:
        await _call(mgr.async_reject, call)

    async def reload_catalog(call: ServiceCall) -> None:
        if not await mgr.async_reload_catalog():
            raise vol.Invalid("catalog.yaml or story.yaml is invalid, see the Home Assistant log")

    hass.services.async_register(DOMAIN, "approve", approve, KID_TASK_SCHEMA)
    hass.services.async_register(DOMAIN, "reject", reject, KID_TASK_SCHEMA)
    async def start_siege(call: ServiceCall) -> None:
        """The parent's "Spustit útok skřetů" for an automation (v1.4.0); idempotent, after the win a replay."""
        try:
            await mgr.async_siege_start()
        except HomeQuestError as err:
            raise vol.Invalid(f"{err.code}: {err.message}") from err

    async def add_task(call: ServiceCall) -> ServiceResponse:
        """A one-off task for the children of the chosen To-do lists (none = all): the parent's "Přidat úkol" for automations (#166)."""
        from .todo import error                          # noqa: PLC0415  (todo.py imports HA's todo component)
        kids = None
        if call.data.get("entity_id"):
            by_entity = {ent.entity_id: kid_id for kid_id, ent in mgr.todo_lists.items()}
            unknown = [e for e in call.data["entity_id"] if e not in by_entity]
            if unknown:
                raise error(HomeQuestError("not_a_kid_list"))
            kids = list(dict.fromkeys(by_entity[e] for e in call.data["entity_id"]))
        try:
            res = await mgr.async_service_add_task(call.data["name"], kids, call.data.get("reward"), call.data["single"],
                                                   call.data["skip_if_open"], call.context.user_id)
        except HomeQuestError as err:
            raise error(err) from err
        return res

    hass.services.async_register(DOMAIN, "reload_catalog", reload_catalog)
    hass.services.async_register(DOMAIN, "add_task", add_task, ADD_TASK_SCHEMA, supports_response=SupportsResponse.OPTIONAL)
    hass.services.async_register(DOMAIN, "start_siege", start_siege)
