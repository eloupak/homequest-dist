"""State manager: persistence, identity resolution, mutations and events."""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import time
from collections.abc import Callable
from contextvars import ContextVar
from datetime import timedelta
from pathlib import Path
from typing import Any

import yaml

from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import CoreState, HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_state_change_event, async_track_time_change, async_track_time_interval
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util, slugify

from . import access, art, bootstrap, logic, setup, story_migrations, story_texts, story_vars
from .catalog import catalog_for_client, parse_catalog, preview_items, with_kids, with_previews
from .const import (
    UPDATE_URL,
    ASSETS_DIR,
    CATALOG_FILE,
    DRAFTS_FILE,
    STORY_FILE,
    DATA_DIR,
    DOMAIN,
    ERR_FORBIDDEN,
    ERR_INVALID_PARAMS,
    ART_SUBDIR,
    EVENT_ART_IMPORTED,
    EVENT_PURCHASE,
    EVENT_TASK_APPROVED,
    EVENT_TASK_ASSIGNED,
    EVENT_TASK_COMPLETED,
    EVENT_TASK_PENDING,
    SIGNAL_UPDATED,
    STORAGE_KEY,
    STORAGE_VERSION,
    SETUP_MODE_FLAG,
    TEST_ENV_FLAG,
    CLEAN_ENV_FLAG,
)
from .logic import HomeQuestError, fortress_done
from .pin import PinError, PinGuard
from .story import parse_story

_LOGGER = logging.getLogger(__name__)

HISTORY_VIEW = 50
WORKDAY_SENSOR = "binary_sensor.workday_sensor_cz"     # read only; missing = Monday-Friday (warning in the log)


VIA: ContextVar[str | None] = ContextVar("homequest_via", default=None)   # "kid_panel" while a command of a child panel runs


class Identity:
    """Who is calling: a parent (admin) or a kid mapped to an HA user; `via` = "kid_panel" for a child panel on the parent's phone."""

    def __init__(self, is_admin: bool, kid_id: str | None, via: str | None = None) -> None:
        self.is_admin = is_admin
        self.kid_id = kid_id
        self.via = via


class HomeQuestManager:
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._lock = asyncio.Lock()
        self._listeners: list[Callable[[], None]] = []
        self.state: dict[str, Any] = logic.new_state()
        self.catalog: dict[str, Any] = {"kids": {}, "tasks": {}, "classes": {}, "items": {}}
        self.story: dict[str, Any] | None = None
        self.data_dir = Path(hass.config.path(DATA_DIR))
        self.assets_dir = self.data_dir / ASSETS_DIR
        self._user_to_kid: dict[str, str] = {}
        self._unsub_midnight: Callable[[], None] | None = None
        self._unsub_art: Callable[[], None] | None = None
        self._art_manifest: dict[str, Any] | None = None
        self._art_mtime: float | None = None
        self._art_import_mtime: float | None = None
        self._drafts_mtime: float | None = None      # catalog.drafts.yaml (test instance only)
        self._art_polled = False
        self._unsub_workday: Callable[[], None] | None = None
        self.env_test = False                       # the flag file <data>/env_test exists (the test instance)
        self.env_clean = False                      # the flag file <data>/env_clean exists (a trial install): only the CLEAN badge
        self._workday_warned = False
        self._user_warned: set[tuple[str, str]] = set()   # (kid, ha_user) already warned about (#137: once, not on every resolve)
        self.version = ""                                  # v1.7 (#141): manifest version (set in async_setup)
        self._gh_latest: str | None = None
        self._yaml_kids: dict[str, Any] = {}        # catalog.yaml `kids:` (v1.6: read only by the migration v1.6-kids-in-state)
        self._ha_users: list[dict[str, Any]] = []   # the HA users (cache of async_resolve_users) for the setup guide
        self.setup_mode = False                     # the flag file <data>/setup_mode (TEST only): the guide works on a copy of the state
        self._sandbox: dict[str, Any] | None = None # that copy (memory only)
        self.add_kid_sensors: Callable[[], None] | None = None   # sensor.py: the sensors of a child added while HA runs
        self.kids_changed: Callable[[], Any] | None = None   # __init__: (un)register the child panels after a child was added / renamed / removed

    # ------------------------------------------------------------ setup ----

    async def async_setup(self) -> bool:
        # v1.7 (#139/#140): a package with data/ (HACS) fills a first install and brings the art of a new release; never overwrites
        try:
            rep = await self.hass.async_add_executor_job(bootstrap.install_defaults, Path(__file__).parent / "data", self.data_dir)
        except OSError as err:
            _LOGGER.error("HomeQuest: the package data could not be installed: %s", err)
            rep = {}
        if rep.get("first_start"):
            _LOGGER.warning("HomeQuest first start: %s copied from the package to %s", ", ".join(rep["first_start"]), self.data_dir)
        if rep.get("assets_added") or rep.get("art_promoted"):
            _LOGGER.info("HomeQuest package: %d asset files added, art items updated: %s", rep["assets_added"], ", ".join(rep["art_promoted"]) or "none")
        if not await self.async_load_catalog():
            return False
        self.env_test = await self.hass.async_add_executor_job((self.data_dir / TEST_ENV_FLAG).is_file)
        self.env_clean = await self.hass.async_add_executor_job((self.data_dir / CLEAN_ENV_FLAG).is_file)
        self.setup_mode = self.env_test and await self.hass.async_add_executor_job((self.data_dir / SETUP_MODE_FLAG).is_file)
        await self.async_load_story()                 # optional: a broken story.yaml never stops the game
        saved = await self._store.async_load()
        self.state = saved if isinstance(saved, dict) else logic.new_state()
        await self._migrate_kids()                                      # v1.6: the children from catalog.yaml into the state (#136)
        self._apply_kids()
        logic.migrate(self.state, self.catalog, self._now()[1])        # one-off data fixes (marker in the state)
        logic.migrate_starters(self.state, self.catalog, self._now()[1])
        logic.migrate_tasks(self.state, self.catalog, self._now()[1])
        logic.migrate_seen(self.state, self.story, self._now()[1])
        logic.migrate_amulet_worn(self.state, self.story, self._now()[1])
        await self._migrate_story_file()                                # v1.5: real places of the story -> variables (#128)
        await self._run_file_migrations()                               # v1.7: the data steps of the releases (#140)
        self._sync()
        await self._store.async_save(self.state)
        if "notify_targets" not in self.state:                         # v1.5: the parents' phones get the task notifications (#128)
            if self.hass.state is CoreState.running:
                self.hass.async_create_task(self._default_notify_targets())
            else:
                async def _started(_event: Any) -> None:
                    await self._default_notify_targets()

                self.hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _started)
        await self.async_resolve_users()
        self._unsub_midnight = async_track_time_change(
            self.hass, self._midnight, hour=0, minute=0, second=5
        )
        self._unsub_workday = async_track_state_change_event(self.hass, [WORKDAY_SENSOR], self._workday_changed)
        await self.hass.async_add_executor_job(self._art_poll, False)
        self._unsub_art = async_track_time_interval(self.hass, self._art_tick, timedelta(seconds=30))
        pkg = Path(__file__).parent
        self.version, has_data = await self.hass.async_add_executor_job(lambda: (bootstrap.package_version(pkg / "manifest.json"), (pkg / "data").is_dir()))
        self._setup_update_check(has_data)
        return True

    # ------------------------------------------------- a new version for the parent (v1.7, #141) ----

    def _setup_update_check(self, has_data: bool) -> None:
        """HACS gives `update.homequest*`: its changes re-send the view. A package install without it asks GitHub's latest release once a
        day (no token, nothing sent but the request). The private install (deploy.sh, no data/ in the integration) never goes out."""
        self._gh_latest: str | None = None

        @callback
        def _state(event: Any) -> None:
            if str(event.data.get("entity_id", "")).startswith("update.homequest"):
                self._notify()

        self._unsub_update = self.hass.bus.async_listen("state_changed", _state)
        if has_data:
            async def _tick(_now: Any = None) -> None:
                if self._hacs_update() is None:
                    await self._github_latest()
            self.hass.async_create_task(_tick())
            self._unsub_gh = async_track_time_interval(self.hass, _tick, timedelta(hours=24))

    def _hacs_update(self) -> Any:
        return next((st for st in self.hass.states.async_all("update") if st.entity_id.startswith("update.homequest")), None)

    async def _github_latest(self) -> None:
        from homeassistant.helpers.aiohttp_client import async_get_clientsession  # noqa: PLC0415  (only a package install needs it)
        try:
            async with async_get_clientsession(self.hass).get(UPDATE_URL, timeout=20, headers={"Accept": "application/vnd.github+json"}) as resp:
                if resp.status == 200:
                    tag = str((await resp.json()).get("tag_name") or "").lstrip("v")
                    if tag and tag != self._gh_latest:
                        self._gh_latest = tag
                        self._notify()
        except Exception as err:  # noqa: BLE001  (no network = no banner, never an error for the family)
            _LOGGER.debug("HomeQuest update check: %s", err)

    def _update_view(self) -> dict[str, Any] | None:
        """{installed, latest, available, source} for the parent's banner, or None."""
        st = self._hacs_update()
        if st is not None:
            installed = str(st.attributes.get("installed_version") or self.version or "")
            latest = str(st.attributes.get("latest_version") or "")
            return {"installed": installed, "latest": latest, "available": st.state == "on", "source": "hacs",
                    "notes_url": st.attributes.get("release_url")}
        if self._gh_latest:
            return {"installed": self.version, "latest": self._gh_latest, "available": logic.version_newer(self._gh_latest, self.version or ""),
                    "source": "github", "notes_url": None}
        return None

    def async_unload(self) -> None:
        if self._unsub_midnight:
            self._unsub_midnight()
            self._unsub_midnight = None
        if self._unsub_art:
            self._unsub_art()
            self._unsub_art = None
        if self._unsub_workday:
            self._unsub_workday()
            self._unsub_workday = None
        for name in ("_unsub_update", "_unsub_gh"):
            if getattr(self, name, None):
                getattr(self, name)()
                setattr(self, name, None)

    async def async_load_catalog(self) -> bool:
        """(Re)load catalog.yaml. Keeps the previous catalog on errors.

        On the TEST instance (flag file env_test) the new art that the import left in catalog.drafts.yaml is added as free "Náhled" items (the
        shop shows it, the hero can wear it). A draft that does not fit the code running there is skipped and logged, never an error of the catalog."""
        path = self.data_dir / CATALOG_FILE

        def _read() -> Any:
            with path.open(encoding="utf-8") as fh:
                raw = yaml.safe_load(fh)
            previews: list[dict[str, Any]] = []
            if (self.data_dir / TEST_ENV_FLAG).is_file():
                dpath = self.data_dir / DRAFTS_FILE
                try:
                    self._drafts_mtime = dpath.stat().st_mtime
                    with dpath.open(encoding="utf-8") as fh:
                        previews = preview_items(raw, yaml.safe_load(fh))
                except (OSError, yaml.YAMLError) as err:
                    self._drafts_mtime = None
                    if not isinstance(err, FileNotFoundError):
                        _LOGGER.warning("catalog drafts not used: %s", err)
            return raw, previews

        try:
            raw, previews = await self.hass.async_add_executor_job(_read)
        except (OSError, yaml.YAMLError) as err:
            _LOGGER.error("Cannot read %s: %s", path, err)
            return False
        catalog, errors, warnings = await self.hass.async_add_executor_job(
            parse_catalog, raw, self.assets_dir
        )
        if not errors and previews:
            catalog, warnings = await self.hass.async_add_executor_job(self._with_previews, raw, previews, catalog, warnings)
        for warn in warnings:
            _LOGGER.warning("catalog: %s", warn)
        if errors:
            for err in errors:
                _LOGGER.error("catalog: %s", err)
            return False
        self._yaml_kids = catalog["kids"]
        self.catalog = with_kids(catalog, setup.kids_catalog(self.state))      # the children of the game come from the state (v1.6)
        return True

    def _apply_kids(self) -> None:
        """Put the children of the state into the catalog mapping the rules use (after the migration and after every change of a child)."""
        self.catalog = with_kids(self.catalog, setup.kids_catalog(self.state))

    async def _admin_ids(self) -> list[str]:
        return [u.id for u in await self.hass.auth.async_get_users() if u.is_admin and u.is_active and not u.system_generated]

    async def _migrate_kids(self) -> None:
        """v1.6 (#136): catalog.yaml `kids:` -> profiles in the state; a backup of the state first (homequest.state.bak-v1.6-kids, once)."""
        if setup.MIGRATION_KIDS in self.state.get("migrations", []):
            return
        if self.state.get("kids"):
            await self.hass.async_add_executor_job(self._backup_state, "v1.6-kids")
        setup.migrate_kids(self.state, self._yaml_kids, await self._admin_ids(), self._now()[1], logic._new_kid)
        if self._yaml_kids:                                  # a new install (v1.7 package) has none: nothing to say
            _LOGGER.warning("v1.6: %d child(ren) of catalog.yaml moved into the game state (catalog.yaml keeps its kids: as a backup)", len(self._yaml_kids))

    def _backup_state(self, tag: str) -> None:
        """A copy of the saved state file next to it (.storage/homequest.state.bak-<tag>), once; nothing when it exists already."""
        src = Path(self.hass.config.path(".storage", STORAGE_KEY))
        dst = src.with_name(f"{STORAGE_KEY}.bak-{tag}")
        try:
            if src.is_file() and not dst.exists():
                dst.write_bytes(src.read_bytes())
        except OSError as err:
            _LOGGER.error("state backup %s failed: %s", dst, err)

    def _with_previews(self, raw: Any, previews: list[dict[str, Any]], base: dict[str, Any], warnings: list[str]):
        cat, warns, skipped = with_previews(raw, previews, self.assets_dir)
        for msg in skipped:
            _LOGGER.warning("catalog drafts: %s", msg)
        return (base, warnings) if cat is None else (cat, warns)

    async def async_load_story(self) -> bool:
        """(Re)load story.yaml (quest giver, intro, chapters). No file = no story (the Quest tab is hidden).
        Keeps the previous story on errors and returns False."""
        path = self.data_dir / STORY_FILE
        if not await self.hass.async_add_executor_job(path.is_file):
            self.story = None
            return True

        def _read() -> Any:
            with path.open(encoding="utf-8") as fh:
                return yaml.safe_load(fh)

        try:
            raw = await self.hass.async_add_executor_job(_read)
        except (OSError, yaml.YAMLError) as err:
            _LOGGER.error("Cannot read %s: %s", path, err)
            return False
        story, errors = parse_story(raw)
        if errors:
            for err in errors:
                _LOGGER.error("story: %s", err)
            return False
        self.story = story
        return True

    async def _migrate_story_file(self) -> None:
        """One-off (v1.5, #128): the live story.yaml of v1.1-v1.4 has the real places and names in its texts. The known phrases become
        variables in the file (a backup story.yaml.bak-v1.5-story-vars first, comments kept) and the real values the parent's setting, so the
        children read the same text. Runs once (marker in the state); a story without the phrases is not touched."""
        if logic.MIGRATION_STORY_VARS in self.state.get("migrations", []):
            return
        path = self.data_dir / STORY_FILE

        def _rewrite() -> int:
            if not path.is_file():
                return 0
            text = path.read_text(encoding="utf-8")
            new, n = story_vars.migrate_text(text)
            if n:
                bak = path.with_name(f"{STORY_FILE}.bak-{story_vars.MIGRATION}")
                if not bak.exists():
                    bak.write_text(text, encoding="utf-8")
                with path.open("w", encoding="utf-8") as fh:        # in place: the owner and mode of the file stay
                    fh.write(new)
            return n

        try:
            n = await self.hass.async_add_executor_job(_rewrite)
        except OSError as err:
            _LOGGER.error("story variables: cannot rewrite %s: %s (the story keeps its text; tried again next start)", path, err)
            return
        if n:
            _LOGGER.warning("story variables: %d phrases of %s turned into variables, the values kept as the parent's setting", n, path)
            await self.async_load_story()
        logic.migrate_story_vars(self.state, n)

    async def _run_file_migrations(self) -> None:
        """v1.7 (#140): the steps of story_migrations on story.yaml / catalog.yaml, each once (marker in the state), a backup before a change."""
        done = self.state.setdefault("migrations", [])
        for name in ("story.yaml", "catalog.yaml"):
            steps = story_migrations.pending(done, name)
            if not steps:
                continue
            path = self.data_dir / name

            def _run(path: Path = path, steps: list = steps) -> list[dict[str, Any]]:
                if not path.is_file():
                    return [{"id": s.id, "changes": 0, "notes": []} for s in steps]
                text = path.read_text(encoding="utf-8")
                new, rep = story_migrations.apply_all(text, steps)
                if new != text:
                    first = next(r["id"] for r in rep if r["changes"])
                    bak = path.with_name(f"{path.name}.bak-{first}")
                    if not bak.exists():
                        bak.write_text(text, encoding="utf-8")
                    with path.open("w", encoding="utf-8") as fh:          # in place: the owner and mode of the file stay
                        fh.write(new)
                return rep

            try:
                rep = await self.hass.async_add_executor_job(_run)
            except OSError as err:
                _LOGGER.error("HomeQuest migrations of %s: %s (tried again next start)", name, err)
                continue
            for r in rep:
                done.append(r["id"])
                for note in r["notes"]:
                    _LOGGER.warning("HomeQuest migration %s (%s): %s", r["id"], name, note)
            if any(r["changes"] for r in rep):
                _LOGGER.warning("HomeQuest migrations of %s: %s", name, ", ".join(f"{r['id']} ({r['changes']})" for r in rep))
                if name == "story.yaml":
                    await self.async_load_story()
                else:
                    await self.async_load_catalog()
                    self._apply_kids()                                  # v1.6: the children of the state over the reloaded catalog

    # ------------------------------------------------- notifications to parents (v1.5) ----

    async def notify_services(self) -> list[dict[str, Any]]:
        """The phones HA knows (notify.mobile_app_*), with the device name for the parent's choice and whether the owner is an HA admin."""
        known = set(self.hass.services.async_services_for_domain("notify"))
        out: dict[str, dict[str, Any]] = {}
        for entry in self.hass.config_entries.async_entries("mobile_app"):
            name = str(entry.data.get("device_name") or entry.title or "")
            service = f"mobile_app_{slugify(name)}"
            if service not in known:
                continue
            user = await self.hass.auth.async_get_user(entry.data.get("user_id") or "") if entry.data.get("user_id") else None
            out[service] = {"service": service, "name": name, "parent": bool(user and user.is_active and (user.is_admin or user.id in (self.state.get("parents") or [])))}
        for service in sorted(known):
            if service.startswith("mobile_app_") and service not in out:
                out[service] = {"service": service, "name": service[len("mobile_app_"):], "parent": False}
        return sorted(out.values(), key=lambda s: (not s["parent"], s["name"].lower()))

    async def _default_notify_targets(self) -> None:
        """First start of v1.5: the task notifications go to every phone of an HA admin (the parents), so no notification of the YAML
        automations of #67 is lost. The parent changes it in Settings -> Notifications."""
        if "notify_targets" in self.state:
            return
        targets = [s["service"] for s in await self.notify_services() if s["parent"]]
        async with self._lock:
            if "notify_targets" in self.state:
                return
            logic.set_notify_targets(self.state, targets)
            await self._store.async_save(self.state)
        _LOGGER.warning("task notifications: %d parent phone(s) chosen by default: %s", len(targets), ", ".join(f"notify.{t}" for t in targets) or "none")
        self._notify()

    def _send_task_notification(self, kind: str, kid_id: str, task: dict[str, Any], reward: int) -> None:
        targets = self.state.get("notify_targets") or []
        if not targets:
            return
        hero = (self.state.get("kids", {}).get(kid_id) or {}).get("hero") or (self.catalog["kids"].get(kid_id) or {}).get("hero") or {}
        body = logic.task_notification(kind, self._kid_name(kid_id), hero.get("body") == "female", task["name"], reward)
        data = {**body, "data": {"tag": f"homequest-{kid_id}-{task['id']}"}}
        for target in targets:
            if not self.hass.services.has_service("notify", target):
                _LOGGER.warning("task notification: notify.%s does not exist (Settings -> Notifications)", target)
                continue
            self.hass.async_create_task(self._call_notify(target, data))

    async def _call_notify(self, target: str, data: dict[str, Any]) -> None:
        try:
            await self.hass.services.async_call("notify", target, data, blocking=True)
        except Exception as err:  # noqa: BLE001 - one phone must not stop the game or the other phones
            _LOGGER.warning("task notification to notify.%s failed: %s", target, err)

    async def async_set_notify_targets(self, targets: Any) -> dict[str, Any]:
        return await self._mutate(lambda ts: logic.set_notify_targets(self.state, targets))

    async def async_set_story_vars(self, values: Any) -> dict[str, Any]:
        return await self._mutate(lambda ts: logic.set_story_vars(self.state, values))

    def story_values(self) -> dict[str, str]:
        return story_vars.effective((self.story or {}).get("vars"), self.state.get("story_vars"))

    # ------------------------------------------------- illustrated art ----

    @property
    def art_dir(self) -> Path:
        return self.assets_dir / ART_SUBDIR

    def _art_poll(self, fire: bool = True) -> bool:
        """Re-read art/manifest.json when it changed; fire homequest_art_imported on a new import.

        Runs in the executor (file access). Returns True when something changed.
        """
        changed = False
        mpath = self.art_dir / "manifest.json"
        try:
            mtime = mpath.stat().st_mtime
        except OSError:
            mtime = None
        if mtime != self._art_mtime:
            self._art_mtime = mtime
            self._art_manifest = art.load_manifest(mpath) if mtime is not None else None
            changed = True
        ipath = self.art_dir / "last_import.json"
        try:
            imtime = ipath.stat().st_mtime
        except OSError:
            imtime = None
        if imtime != self._art_import_mtime:
            self._art_import_mtime = imtime
            if imtime is not None and fire and self._art_polled:
                try:
                    info = json.loads(ipath.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    info = {}
                self.hass.add_job(self.hass.bus.async_fire, EVENT_ART_IMPORTED, {
                    "imported": info.get("imported", 0), "failed": info.get("failed", 0),
                    "items": info.get("items", [])})
                changed = True
        self._art_polled = True
        return changed

    def _drafts_changed(self) -> bool:
        """Test instance only: catalog.drafts.yaml appeared, changed or vanished since the catalog was loaded."""
        if not (self.data_dir / TEST_ENV_FLAG).is_file():
            return False
        try:
            mtime = (self.data_dir / DRAFTS_FILE).stat().st_mtime
        except OSError:
            mtime = None
        return mtime != self._drafts_mtime

    async def _art_tick(self, _now: Any) -> None:
        changed = await self.hass.async_add_executor_job(self._art_poll, True)
        if self.env_test and await self.hass.async_add_executor_job(self._drafts_changed):
            await self.async_reload_catalog()            # new previews of the import (reload notifies the clients itself)
            return
        if changed:
            self._notify()

    def art_status(self) -> dict[str, Any]:
        return art.evaluate(self.catalog, self._art_manifest, self.state)

    async def async_reload_catalog(self) -> bool:
        async with self._lock:
            ok = await self.async_load_catalog()
            self.env_test = await self.hass.async_add_executor_job((self.data_dir / TEST_ENV_FLAG).is_file)
            self.env_clean = await self.hass.async_add_executor_job((self.data_dir / CLEAN_ENV_FLAG).is_file)
            self.setup_mode = self.env_test and await self.hass.async_add_executor_job((self.data_dir / SETUP_MODE_FLAG).is_file)
            if ok:
                ok = await self.async_load_story()
            if ok:
                self._sync()
                await self._store.async_save(self.state)
                await self.async_resolve_users()
        if ok:
            self._notify()
        return ok

    async def async_resolve_users(self) -> None:
        """Map catalog kids to HA user ids (by login username, then display name)."""
        users = await self.hass.auth.async_get_users()
        cache: list[dict[str, Any]] = []
        for user in users:
            if user.system_generated:
                continue
            username = next((str((c.data or {}).get("username")) for c in user.credentials if c.auth_provider_type == "homeassistant" and (c.data or {}).get("username")), None)
            cache.append({"id": user.id, "name": user.name or username or user.id, "username": username, "is_admin": user.is_admin, "active": user.is_active})
        self._ha_users = cache
        mapping: dict[str, str] = {}
        for kid in self.catalog["kids"].values():
            ha_user = kid["ha_user"]
            uid = self._uid_of(ha_user)
            if uid is None:
                # no account yet is a normal state in the guide (#137): warn only about a filled-in account that HA does not have, once
                if ha_user and (kid["id"], ha_user) not in self._user_warned:
                    self._user_warned.add((kid["id"], ha_user))
                    _LOGGER.warning(
                        "HA user '%s' for kid '%s' not found (parents can still act for the kid)",
                        ha_user,
                        kid["id"],
                    )
            else:
                mapping[uid] = kid["id"]
        self._user_to_kid = mapping

    def _uid_of(self, ha_user: str | None) -> str | None:
        """The HA user id of a child's `ha_user` (the login username, then the display name), from the cache."""
        if not ha_user:
            return None
        low = ha_user.lower()
        return next((u["id"] for u in self._ha_users if (u["username"] or "").lower() == low), None) or next(
            (u["id"] for u in self._ha_users if (u["name"] or "").lower() == low), None)

    def _is_parent(self, user: Any) -> bool:
        """An HA admin, or a user the parent added in the guide (state["parents"]); a child's own account never."""
        if user.is_admin:
            return True
        return user.id in (self.state.get("parents") or []) and user.id not in self._user_to_kid

    # --------------------------------------------------------- identity ----

    async def async_identity(
        self, user: Any, kid_id: str | None, panel_kid: str | None = None, admin_only: bool = False
    ) -> Identity:
        """Resolve who acts. Admins may pass kid_id; kids only act for themselves.
        A command of a child panel (panel_kid) acts as that child only, never as the parent (see access.resolve)."""
        if user is None:
            raise HomeQuestError(ERR_FORBIDDEN, "no user")
        parent = self._is_parent(user)
        if panel_kid is not None:
            own = None
            if not parent:
                own = self._user_to_kid.get(user.id)
                if own is None:
                    await self.async_resolve_users()
                    own = self._user_to_kid.get(user.id)
            try:
                _, kid, via = access.resolve(is_admin_user=parent, own_kid=own, kid_ids=self.catalog["kids"], panel_kid=panel_kid, msg_kid=kid_id, admin_only=admin_only)
            except access.AccessError as err:
                raise HomeQuestError(err.code, err.message) from err
            return Identity(False, kid, via)
        if parent:
            if kid_id is not None and kid_id not in self.catalog["kids"]:
                raise HomeQuestError("not_found", f"unknown kid '{kid_id}'")
            return Identity(True, kid_id)
        own = self._user_to_kid.get(user.id)
        if own is None:
            await self.async_resolve_users()  # kid account may have been created later
            own = self._user_to_kid.get(user.id)
        if own is None:
            raise HomeQuestError(ERR_FORBIDDEN, "user is not a HomeQuest kid")
        if kid_id is not None and kid_id != own:
            raise HomeQuestError(ERR_FORBIDDEN, "cannot act for another kid")
        return Identity(False, own)

    @staticmethod
    def require_kid(ident: Identity) -> str:
        if ident.kid_id is None:
            raise HomeQuestError(ERR_INVALID_PARAMS, "kid_id required")
        return ident.kid_id

    @staticmethod
    def require_admin(ident: Identity) -> None:
        if not ident.is_admin:
            raise HomeQuestError(ERR_FORBIDDEN, "parents only")

    # ------------------------------------------------------------ views ----

    def _client_catalog(self, is_admin: bool) -> dict[str, Any]:
        cat = catalog_for_client(self.catalog)
        cat["items"] = cat["items"] + list(logic.trophy_items(self.story).values())     # the amulets of a won siege: worn, never in the shop (#118)
        cat["tasks"] = logic.tasks_view(self.state, self.catalog, dt_util.now().date(), self._workday(), is_admin)["tasks"]   # with the parent's settings
        return cat

    def view(self, ident: Identity) -> dict[str, Any]:
        kids = self.state.get("kids", {})
        if ident.is_admin:
            ids = [ident.kid_id] if ident.kid_id else list(self.catalog["kids"])
        else:
            ids = [ident.kid_id]
        out: dict[str, Any] = {}
        for kid_id in ids:
            kid = kids.get(kid_id)
            if kid is None:
                continue
            copy = dict(kid)
            copy["history"] = kid["history"][-HISTORY_VIEW:]
            copy["inventory"] = list(kid["inventory"]) + logic.trophy_ids(kid, self.story)   # an amulet won in the siege is in the inventory (#118)
            copy.update(logic.kid_split(kid_id, kid, self._kid_name(kid_id), self.state.get("install_id")))   # kid.public / kid.private (#128)
            out[kid_id] = copy
        return {
            "env": "test" if self.env_test else ("clean" if self.env_clean else None),      # the TEST / CLEAN badge (the flag files exist only on the test instances)
            "is_admin": ident.is_admin,
            "my_kid": None if ident.is_admin else ident.kid_id,
            "today": dt_util.now().date().isoformat(),
            "catalog": self._client_catalog(ident.is_admin),
            "tasks_info": {k: v for k, v in logic.tasks_view(self.state, self.catalog, dt_util.now().date(), self._workday(), ident.is_admin).items() if k != "tasks"},
            "art": self.art_status(),
            "story": story_vars.fill_story(story_texts.apply(self.story, self.state.get("story_texts")), self.story_values()) if self.story else None,   # own paragraphs (v1.6), places and characters filled in (#128)
            "settings": self._settings_view() if ident.is_admin else None,
            "started": bool(self.state.get("started_at")),     # v1.6: before the parent's "Spustit hru" a child sees "Tvrz se staví"
            "setup": self.setup_view() if ident.is_admin else None,
            "update": self._update_view() if ident.is_admin else None,          # v1.7 (#141): a new version, only for the parent
            "fortress": {"done": max(0, fortress_done(self.state) - ((self.story or {}).get("fortress") or {}).get("baseline", 0))},
            "siege": logic.siege_info(self.state, self.story),
            "pin": {"enabled": bool(self.state.get("parent_pin"))} if ident.is_admin else None,
            "kids": out,
        }

    def _settings_view(self) -> dict[str, Any]:
        """The parent's settings of v1.5 (#128): the phones for the task notifications and the story variables."""
        story_defaults = story_vars.effective((self.story or {}).get("vars"), None)
        own = self.state.get("story_texts") or {}
        return {
            "story_texts": {"own": len(own), "stale": sum(1 for p in story_texts.settings_view(self.story, own) if p["stale"]), "orphans": len(story_texts.orphans(self.story, own))},
            "notify_targets": list(self.state.get("notify_targets") or []),
            "story_vars": {
                "values": self.story_values(),
                "defaults": story_defaults,
                "own": dict(self.state.get("story_vars") or {}),
                "labels": {k: v[0] for k, v in story_vars.VARS.items()},
                "order": list(story_vars.VARS),
                "groups": story_vars.GROUPS,                                  # #137: what each place is, the case as a hint, a live sentence
                "hints": story_vars.HINTS,
                "examples": story_vars.examples(story_texts.apply(self.story, own)) if self.story else {},
            },
        }

    # ------------------------------------------------- setup guide (v1.6) ----

    def _setup_state(self) -> dict[str, Any]:
        """The state the guide works on: the live one, or on TEST with <data>/setup_mode a copy in memory (the children's data stay)."""
        if not self.setup_mode:
            return self.state
        if self._sandbox is None:
            self._sandbox = self._new_sandbox()
        return self._sandbox

    def _new_sandbox(self) -> dict[str, Any]:
        box = copy.deepcopy(self.state)
        box.pop("started_at", None)                    # the guide from the beginning, over a copy of the real children (the double confirmation)
        box["setup_steps"] = []
        return box

    def setup_view(self) -> dict[str, Any]:
        st = self._setup_state()
        profiles = setup.kids_catalog(st)
        resolved = {slug: self._uid_of(k["ha_user"]) is not None for slug, k in profiles.items()}
        steps = setup.steps_status(st, resolved)
        return {
            "sandbox": self.setup_mode,
            "started": bool(st.get("started_at")),
            "started_at": st.get("started_at"),
            "kids": [
                {**k, "ha_user_ok": resolved[slug], "panel": f"/homequest-{slug.replace('_', '-')}"}
                for slug, k in profiles.items()
            ],
            "parents": list(st.get("parents") or []),
            "steps": steps,
            "can_start": setup.can_start(steps),
            "has_progress": setup.has_progress(st),
            "confirm_word": setup.START_CONFIRM,
            "workday_ok": self.hass.states.get(WORKDAY_SENSOR) is not None,      # the optional step: only hints
            "phones": sum(1 for x in self.hass.services.async_services_for_domain("notify") if x.startswith("mobile_app_")),
        }

    async def async_setup_users(self) -> list[dict[str, Any]]:
        """The HA users for the guide (accounts of the children, parents), fresh from HA."""
        await self.async_resolve_users()
        st = self._setup_state()
        kid_of = {self._uid_of(k["ha_user"]): slug for slug, k in setup.kids_catalog(st).items() if self._uid_of(k["ha_user"])}
        return [{**u, "kid": kid_of.get(u["id"])} for u in self._ha_users if u["active"]]

    async def _setup_mutate(self, fn: Callable[[dict[str, Any], dict[str, Any], str], dict[str, Any]], kids_changed: bool = False) -> dict[str, Any]:
        """Run a change of the guide on the live state (saved, panels updated) or on the TEST copy (memory only)."""
        async with self._lock:
            st = self._setup_state()
            cat = self.catalog if st is self.state else with_kids(self.catalog, setup.kids_catalog(st))
            _, ts = self._now()
            try:
                result = fn(st, cat, ts)
            except setup.SetupError as err:
                raise HomeQuestError(err.code, err.message) from err
            if st is self.state:
                if kids_changed:
                    self._apply_kids()
                self._sync()
                await self._store.async_save(self.state)
        if kids_changed and st is self.state:
            await self.async_resolve_users()
            if self.kids_changed:
                await self.kids_changed()
        self._notify()
        return result

    async def async_setup_kid(self, kid_id: str | None, data: dict[str, Any]) -> dict[str, Any]:
        if data.get("ha_user"):
            await self.async_resolve_users()
            uid = self._uid_of(data["ha_user"])
            if uid and any(u["id"] == uid and u["is_admin"] for u in self._ha_users):
                raise HomeQuestError(ERR_INVALID_PARAMS, "an HA admin account cannot be a child's account (it is always a parent)")
        if kid_id:
            return await self._setup_mutate(lambda st, cat, ts: setup.update_kid(st, cat, kid_id, data), kids_changed=True)
        return await self._setup_mutate(lambda st, cat, ts: setup.add_kid(st, cat, data, logic._new_kid), kids_changed=True)

    async def async_setup_remove_kid(self, kid_id: str) -> dict[str, Any]:
        return await self._setup_mutate(lambda st, cat, ts: setup.remove_kid(st, kid_id), kids_changed=True)

    async def async_set_parents(self, user_ids: Any) -> dict[str, Any]:
        await self.async_resolve_users()
        st = self._setup_state()
        kid_uids = {self._uid_of(k["ha_user"]) for k in setup.kids_catalog(st).values()} - {None}
        known = {u["id"] for u in self._ha_users}
        if isinstance(user_ids, list) and any(u not in known for u in user_ids):
            raise HomeQuestError(ERR_INVALID_PARAMS, "unknown HA user")
        return await self._setup_mutate(lambda st, cat, ts: setup.set_parents(st, user_ids, kid_uids))

    async def async_setup_step(self, step: Any) -> dict[str, Any]:
        return await self._setup_mutate(lambda st, cat, ts: setup.mark_step(st, step))

    async def async_start_game(self, confirm: Any) -> dict[str, Any]:
        """Spustit hru (#137). On the live state a backup of the state file first (homequest.state.bak-v1.6-start-<time>)."""
        st = self._setup_state()
        if st is self.state and setup.has_progress(st):
            await self.hass.async_add_executor_job(self._backup_state, "v1.6-start-" + dt_util.now().strftime("%Y%m%d-%H%M%S"))

        def fn(st: dict[str, Any], cat: dict[str, Any], ts: str) -> dict[str, Any]:
            resolved = {slug: self._uid_of(k["ha_user"]) is not None for slug, k in setup.kids_catalog(st).items()}
            res = setup.start_game(st, setup.steps_status(st, resolved), confirm, ts, fortress_done)
            if st is not self.state:
                logic.sync(st, cat, self._now()[0], ts, self._workday())      # the copy: the heroes made again, as the live game does
            return res

        res = await self._setup_mutate(fn)
        _LOGGER.warning("HomeQuest started%s: %s", " (TEST copy of the state)" if st is not self.state else "", res["started_at"])
        return res

    async def async_setup_reset_sandbox(self) -> dict[str, Any]:
        """TEST (setup_mode): the copy again from the live state."""
        if not self.setup_mode:
            raise HomeQuestError(ERR_FORBIDDEN, "only on TEST with setup_mode")
        async with self._lock:
            self._sandbox = self._new_sandbox()
        self._notify()
        return {}

    def story_texts_view(self) -> dict[str, Any]:
        own = self.state.get("story_texts") or {}
        values = self.story_values()
        rows = [{**p, "shown": story_vars.fill_text(p["own"] or p["text"], values)} for p in story_texts.settings_view(self.story, own)]
        return {"paragraphs": rows, "orphans": story_texts.orphans(self.story, own), "cast": {c["id"]: c.get("name", c["id"]) for c in (self.story or {}).get("cast", [])}}

    async def async_set_story_text(self, pid: Any, text: Any) -> dict[str, Any]:
        def fn(ts: str) -> dict[str, Any]:
            try:
                return story_texts.set_text(self.state, self.story, pid, text)
            except ValueError as err:
                raise HomeQuestError(ERR_INVALID_PARAMS, str(err)) from err

        return await self._mutate(fn)

    # ---------------------------------------------------- notifications ----

    def add_listener(self, cb: Callable[[], None]) -> Callable[[], None]:
        self._listeners.append(cb)

        def _remove() -> None:
            if cb in self._listeners:
                self._listeners.remove(cb)

        return _remove

    @callback
    def _notify(self) -> None:
        for cb in list(self._listeners):
            try:
                cb()
            except Exception:  # noqa: BLE001 - a broken client must not block others
                _LOGGER.exception("listener failed")
        async_dispatcher_send(self.hass, SIGNAL_UPDATED)

    # -------------------------------------------------------- mutations ----

    def _now(self) -> tuple[Any, str]:
        now = dt_util.now()
        return now.date(), now.isoformat(timespec="seconds")

    def _workday(self) -> bool | None:
        """Is today a working day (public holidays included), from HA's Workday sensor; None = unknown."""
        st = self.hass.states.get(WORKDAY_SENSOR)
        if st is not None and st.state in ("on", "off"):
            return st.state == "on"
        if not self._workday_warned:
            self._workday_warned = True
            _LOGGER.warning("%s is not available: daily tasks follow Monday-Friday", WORKDAY_SENSOR)
        return None

    async def _workday_changed(self, _event: Any) -> None:
        await self._midnight(None)

    def _sync(self) -> bool:
        today, ts = self._now()
        return logic.sync(self.state, self.catalog, today, ts, self._workday())

    async def _mutate(self, fn: Callable[[str], dict[str, Any]]) -> dict[str, Any]:
        """Run a logic function under the lock, then persist and notify."""
        async with self._lock:
            self._sync()
            _, ts = self._now()
            marks = {k: (id(v["history"][-1]) if v["history"] else None) for k, v in self.state.get("kids", {}).items()}
            result = fn(ts)  # raises HomeQuestError before anything is saved
            via = VIA.get()
            if via:                                      # traceability: what a child panel on the parent's phone did is marked in the history
                for k, v in self.state.get("kids", {}).items():
                    hist = v["history"]
                    for entry in reversed(hist):
                        if id(entry) == marks.get(k):
                            break
                        entry["via"] = via
            await self._store.async_save(self.state)
        self._notify()
        return result

    async def _midnight(self, _now: Any) -> None:
        async with self._lock:
            changed = self._sync()
            if changed:
                await self._store.async_save(self.state)
        self._notify()

    def _kid_name(self, kid_id: str) -> str:
        return self.catalog["kids"].get(kid_id, {}).get("name", kid_id)

    async def async_complete(self, kid_id: str, task_id: str) -> dict[str, Any]:
        res = await self._mutate(
            lambda ts: logic.complete(self.state, self.catalog, kid_id, task_id, ts)
        )
        base = {
            "kid_id": kid_id,
            "kid": self._kid_name(kid_id),
            "task_id": task_id,
            "task": res["task"]["name"],
        }
        # always: information for the parent; the actionable "please approve" event only when it is needed
        self.hass.bus.async_fire(
            EVENT_TASK_COMPLETED,
            {**base, "reward": res["task"]["reward"], "requires_approval": not res["auto_approved"],
             "auto_approved": res["auto_approved"]},
        )
        if res["auto_approved"]:
            self.hass.bus.async_fire(EVENT_TASK_APPROVED, {**base, "coins": res["coins"], "auto": True})
        else:
            self.hass.bus.async_fire(EVENT_TASK_PENDING, base)
        # v1.5 (#128): the integration notifies the parents itself (was YAML automations on the events; the events stay for own automations)
        self._send_task_notification("done" if res["auto_approved"] else "pending", kid_id, {"id": task_id, "name": res["task"]["name"]}, res["task"]["reward"])
        return res

    # ---- parent: daily task settings, holidays, one-off tasks, templates

    async def async_set_task(self, task_id: str, workday: Any, free: Any, kids: Any = None, single: Any = None) -> dict[str, Any]:
        return await self._mutate(lambda ts: logic.set_task(self.state, self.catalog, task_id, workday, free, kids, single))

    async def async_set_holidays(self, until: Any) -> dict[str, Any]:
        return await self._mutate(lambda ts: logic.set_holidays(self.state, until, self._now()[0]))

    async def async_add_oneoff(self, name: Any, reward: Any, single: Any, kids: Any = None) -> dict[str, Any]:
        res = await self._mutate(lambda ts: logic.add_oneoff(self.state, self.catalog, name, reward, single, ts, kids))
        who = res["task"].get("kids") or list(self.catalog["kids"])           # the children the task is for (no `kids` = all of them)
        self.hass.bus.async_fire(EVENT_TASK_ASSIGNED, {
            "task_id": res["task_id"], "task": res["task"]["name"], "reward": res["task"]["reward"],
            "single": res["task"]["single"], "kids": [self._kid_name(k) for k in who], "kid_ids": who})
        return res

    async def async_delete_oneoff(self, task_id: str) -> dict[str, Any]:
        return await self._mutate(lambda ts: logic.delete_oneoff(self.state, task_id, ts))

    async def async_save_template(self, name: Any, reward: Any, single: Any, kids: Any = None) -> dict[str, Any]:
        return await self._mutate(lambda ts: logic.save_template(self.state, name, reward, single, self.catalog, kids))

    async def async_delete_template(self, template_id: str) -> dict[str, Any]:
        return await self._mutate(lambda ts: logic.delete_template(self.state, template_id))

    async def async_set_approval(self, kid_id: str, value: bool) -> dict[str, Any]:
        return await self._mutate(
            lambda ts: logic.set_approval(self.state, self.catalog, kid_id, value, ts)
        )

    async def async_approve(self, kid_id: str, task_id: str) -> dict[str, Any]:
        res = await self._mutate(
            lambda ts: logic.approve(self.state, self.catalog, kid_id, task_id, ts)
        )
        self.hass.bus.async_fire(
            EVENT_TASK_APPROVED,
            {
                "kid_id": kid_id,
                "kid": self._kid_name(kid_id),
                "task_id": task_id,
                "task": res["task"]["name"],
                "coins": res["coins"],
            },
        )
        return res

    async def async_reject(self, kid_id: str, task_id: str) -> dict[str, Any]:
        return await self._mutate(
            lambda ts: logic.reject(self.state, self.catalog, kid_id, task_id, ts)
        )

    async def async_onboard(self, kid_id: str, hero: dict[str, Any]) -> dict[str, Any]:
        return await self._mutate(
            lambda ts: logic.onboard(self.state, self.catalog, kid_id, hero, ts)
        )

    async def async_reset_hero(self, kid_id: str) -> dict[str, Any]:
        return await self._mutate(
            lambda ts: logic.reset_hero(self.state, self.catalog, kid_id, ts)
        )

    async def async_buy(self, kid_id: str, item_id: str) -> dict[str, Any]:
        res = await self._mutate(
            lambda ts: logic.buy(self.state, self.catalog, kid_id, item_id, ts)
        )
        self.hass.bus.async_fire(
            EVENT_PURCHASE,
            {
                "kid_id": kid_id,
                "kid": self._kid_name(kid_id),
                "item_id": item_id,
                "item": res["item"]["name"],
                "price": res["item"]["price"],
            },
        )
        return res

    async def async_claim_gift(self, kid_id: str, stage_id: str) -> dict[str, Any]:
        return await self._mutate(lambda ts: logic.claim_stage_gift(self.state, self.story, kid_id, stage_id, ts))

    # ------------------------------------------------------------ siege ----

    def siege_for_game(self) -> dict[str, Any] | None:
        """The siege the children can join (#118): {stage, game, kids, looks} while the fortress is under siege, else None. The kids are those with a
        hero; looks = how they look (logic.siege_looks), for the other child's panel."""
        info = logic.siege_info(self.state, self.story)
        if not info or not info["active"]:
            return None
        # a child away from this attack (the cross, #118) is not waited for in the lobby
        kids = [k for k in self.catalog["kids"] if (self.state.get("kids", {}).get(k) or {}).get("hero") and k not in info["away"]]
        return {"stage": info["stage"], "game": info["game"], "kids": kids, "looks": logic.siege_looks(self.state, kids)}

    async def async_scene_seen(self, kid_id: str, stage_id: str, what: str = "scene") -> dict[str, Any]:
        return await self._mutate(lambda ts: logic.mark_scene_seen(self.state, self.story, kid_id, stage_id, what))

    async def async_story_seen(self, kid_id: str, what: str, index: int | None) -> dict[str, Any]:
        return await self._mutate(lambda ts: logic.mark_story_seen(self.state, self.story, kid_id, what, index))

    async def async_siege_start(self) -> dict[str, Any]:
        """The parent's button / the service homequest.start_siege (idempotent)."""
        return await self._mutate(lambda ts: logic.siege_start(self.state, self.story, ts))

    async def async_siege_away(self, kid_id: str, away: bool) -> dict[str, Any]:
        """The cross (away) / the Quest button back into the battle (#118)."""
        return await self._mutate(lambda ts: logic.siege_away(self.state, self.story, kid_id, away))

    async def async_siege_replay(self, kid_id: str) -> dict[str, Any]:
        """The Quest button after the win: the child starts a replay only for itself (#118)."""
        return await self._mutate(lambda ts: logic.siege_replay_by_kid(self.state, self.story, kid_id, ts))

    async def async_siege_stop(self) -> dict[str, Any]:
        """The parent ends a running replay; a lobby or game of it in the hub is dropped by the caller."""
        return await self._mutate(lambda ts: logic.siege_stop(self.state, self.story))

    async def async_siege_end(self, stage_id: str, won: bool, kids: list[str]) -> dict[str, Any]:
        return await self._mutate(lambda ts: logic.siege_end(self.state, self.story, stage_id, won, kids, ts))

    async def async_claim_siege(self, kid_id: str, stage_id: str, color: Any) -> dict[str, Any]:
        return await self._mutate(lambda ts: logic.claim_siege_gift(self.state, self.story, kid_id, stage_id, color, ts))

    async def async_equip(
        self, kid_id: str, item_id: str | None, slot: str | None
    ) -> dict[str, Any]:
        return await self._mutate(
            lambda ts: logic.equip(self.state, self.catalog, kid_id, item_id, slot, self.story)
        )

    # ---------------------------------------------------------------- PIN ----

    def pin(self) -> PinGuard:
        """The optional parent PIN (hash in the game state, nothing else is stored)."""
        if getattr(self, "_pin_guard", None) is None:
            self._pin_guard = PinGuard(self.state)
        self._pin_guard.holder = self.state
        return self._pin_guard

    def pin_status(self, session: Any) -> dict[str, Any]:
        g = self.pin()
        return {"enabled": g.enabled, "unlocked": g.unlocked(session, time.monotonic())}

    def pin_require(self, session: Any) -> None:
        try:
            self.pin().require(session, time.monotonic())
        except PinError as err:
            raise HomeQuestError(err.code, err.message) from err

    def pin_verify(self, session: Any, pin: Any) -> None:
        try:
            self.pin().verify(session, pin, time.monotonic())
        except PinError as err:
            raise HomeQuestError(err.code, err.message) from err

    async def async_pin_set(self, session: Any, new_pin: Any) -> dict[str, Any]:
        def fn(ts: str) -> dict[str, Any]:
            try:
                self.pin().set(session, new_pin, time.monotonic())
            except PinError as err:
                raise HomeQuestError(err.code, err.message) from err
            return {}

        await self._mutate(fn)
        return self.pin_status(session)

    async def async_adjust(self, kid_id: str, delta: int, note: str) -> dict[str, Any]:
        return await self._mutate(
            lambda ts: logic.admin_adjust(self.state, self.catalog, kid_id, delta, note, ts)
        )


def get_manager(hass: HomeAssistant) -> HomeQuestManager:
    return hass.data[DOMAIN]
