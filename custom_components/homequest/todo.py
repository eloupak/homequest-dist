"""v1.8 (#173, #177, #178): one HA To-do list per child, todo.homequest_<slug>.

The items are the tasks the child sees in the game today (todo_items.kid_items); ticking one = Hotovo in the game (coins, or waiting for
approval), a parent's untick of a waiting task = Zamítnout, a new item = a one-off task for that child (a parent or an automation).
Anything else (rename, delete, move, due date, description) is refused: the tasks are edited in the game (Rodič).
"""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.todo import TodoItem, TodoItemStatus, TodoListEntity, TodoListEntityFeature
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.translation import async_get_translations

from . import todo_items
from .const import DOMAIN, SIGNAL_UPDATED
from .logic import HomeQuestError
from .store import HomeQuestManager, get_manager

_LOGGER = logging.getLogger(__name__)

TRANSLATION_KEY = "kid_tasks"
# The item descriptions are always Czech; a language setting of the game = #161. The texts stay in translations/.
TEXT_LANGUAGE = "cs"
_TEXT_PREFIX = f"component.{DOMAIN}.entity.todo.{TRANSLATION_KEY}.state_attributes.item.state."
ERRORS = ("not_your_list", "edit_in_game", "cannot_undo_approved", "only_parent_can_undo", "only_parent_can_add", "item_gone", "not_supported", "not_a_kid_list")


def error(err: HomeQuestError) -> ServiceValidationError:
    """A HomeQuest refusal as HA's translated error (strings.json "exceptions"); unknown codes keep their message."""
    if err.code in ERRORS:
        return ServiceValidationError(translation_domain=DOMAIN, translation_key=err.code)
    return ServiceValidationError(translation_domain=DOMAIN, translation_key="game_refused", translation_placeholders={"error": f"{err.code}: {err.message}"})


class Texts:
    """The descriptions of the items ("+2 zlaťáky", "Čeká na schválení rodičem") from translations/<TEXT_LANGUAGE>.json, not the system language of HA."""

    def __init__(self) -> None:
        self._t: dict[str, str] = {}

    async def async_load(self, hass: HomeAssistant) -> None:
        self._t = await async_get_translations(hass, TEXT_LANGUAGE, "entity", {DOMAIN})

    def get(self, key: str, **kw: Any) -> str:
        text = self._t.get(_TEXT_PREFIX + key) or key
        try:
            return text.format(**kw)
        except (KeyError, IndexError, ValueError):
            return text

    def describe(self, item: dict[str, Any]) -> str:
        reward = self.get(f"reward_{todo_items.plural(item['reward'])}", reward=item["reward"])
        parts = {"open": [reward], "rejected": [self.get("rejected"), reward], "pending": [self.get("pending")], "approved": [self.get("approved"), reward]}[item["kind"]]
        if item["single"] and item["status"] == "open":
            parts.append(self.get("single"))
        return " · ".join(parts)


class KidTodoList(TodoListEntity):
    _attr_should_poll = False
    _attr_has_entity_name = True
    _attr_translation_key = TRANSLATION_KEY
    _attr_icon = "mdi:sword-cross"
    _attr_supported_features = TodoListEntityFeature.CREATE_TODO_ITEM | TodoListEntityFeature.UPDATE_TODO_ITEM

    def __init__(self, mgr: HomeQuestManager, kid_id: str, texts: Texts) -> None:
        self._mgr = mgr
        self.kid_id = kid_id
        self._texts = texts
        kid = mgr.state["kids"][kid_id]
        self._attr_unique_id = f"{DOMAIN}_todo_{kid['uuid']}"      # survives a rename of the child (the slug stays as well)
        self.entity_id = f"todo.{DOMAIN}_{kid_id}"
        self._attr_translation_placeholders = {"kid": mgr.catalog["kids"][kid_id]["name"]}
        self._refresh()

    def _refresh(self) -> None:
        name = self._mgr.catalog["kids"].get(self.kid_id, {}).get("name", self.kid_id)
        if self._attr_translation_placeholders.get("kid") != name:
            self._attr_translation_placeholders = {"kid": name}
        self._attr_todo_items = [
            TodoItem(summary=i["name"], uid=i["uid"],
                     status=TodoItemStatus.NEEDS_ACTION if i["status"] == "open" else TodoItemStatus.COMPLETED,
                     due=i["due"], description=self._texts.describe(i))
            for i in self._mgr.todo_items(self.kid_id)
        ]

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_UPDATED, self._handle_update))

    @callback
    def _handle_update(self) -> None:
        if self.kid_id not in self._mgr.state.get("kids", {}):
            return                                                   # removed: async_setup_platform takes the list away
        self._refresh()
        self.async_write_ha_state()

    @callback
    def _redraw(self) -> None:
        """After a refused change the list card in HA still shows its own (ticked) idea of the item: send the real items again."""
        self._refresh()
        self._last_broadcast_items = None
        self.async_write_ha_state()

    def _user_id(self) -> str | None:
        return self._context.user_id if self._context is not None else None

    async def async_update_todo_item(self, item: TodoItem) -> None:
        cur = next((i for i in (self.todo_items or []) if i.uid == item.uid), None)
        renamed = cur is not None and item.summary is not None and item.summary != cur.summary
        status = item.status or (cur.status if cur else TodoItemStatus.NEEDS_ACTION)
        try:
            await self._mgr.async_todo_update(self.kid_id, item.uid or "", str(status), renamed, self._user_id())
        except HomeQuestError as err:
            self._redraw()
            raise error(err) from err
        self._redraw()

    async def async_create_todo_item(self, item: TodoItem) -> None:
        try:
            await self._mgr.async_todo_create(self.kid_id, item.summary or "", self._user_id())
        except HomeQuestError as err:
            self._redraw()
            raise error(err) from err

    async def async_delete_todo_items(self, uids: list[str]) -> None:
        raise error(HomeQuestError("not_supported"))

    async def async_move_todo_item(self, uid: str, previous_uid: str | None = None) -> None:
        raise error(HomeQuestError("not_supported"))


async def async_setup_platform(
    hass: HomeAssistant,
    config: dict[str, Any],
    async_add_entities: AddEntitiesCallback,
    discovery_info: dict[str, Any] | None = None,
) -> None:
    mgr = get_manager(hass)
    texts = Texts()
    await texts.async_load(hass)
    lists: dict[str, KidTodoList] = {}

    @callback
    def sync_kids() -> None:
        """A child added in the guide gets a list at once, a removed child's list goes (also from the entity registry); no restart."""
        kids = mgr.state.get("kids", {})
        new = [KidTodoList(mgr, k, texts) for k in mgr.catalog["kids"] if k not in lists and (kids.get(k) or {}).get("uuid")]
        for ent in new:
            lists[ent.kid_id] = ent
        if new:
            async_add_entities(new)
        for kid_id in [k for k in lists if k not in mgr.catalog["kids"]]:
            ent = lists.pop(kid_id)
            reg = er.async_get(hass)
            if ent.entity_id and reg.async_get(ent.entity_id):
                reg.async_remove(ent.entity_id)
            elif ent.hass is not None:
                hass.async_create_task(ent.async_remove())

    sync_kids()
    async_dispatcher_connect(hass, SIGNAL_UPDATED, sync_kids)       # a child that reached the state later (the guide) gets its list too
    mgr.todo_lists = lists
    mgr.add_kid_todo = sync_kids
