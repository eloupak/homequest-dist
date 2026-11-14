"""Sensors: per-kid coins and open tasks, plus pending approvals."""

from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import logic
from .const import DOMAIN, SIGNAL_UPDATED
from .store import HomeQuestManager, get_manager


class _Base(SensorEntity):
    _attr_should_poll = False

    def __init__(self, mgr: HomeQuestManager) -> None:
        self._mgr = mgr

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            async_dispatcher_connect(self.hass, SIGNAL_UPDATED, self._handle_update)
        )

    @callback
    def _handle_update(self) -> None:
        self.async_write_ha_state()


class CoinsSensor(_Base):
    _attr_icon = "mdi:cash-multiple"
    _attr_state_class = SensorStateClass.TOTAL
    _attr_native_unit_of_measurement = "coins"

    def __init__(self, mgr: HomeQuestManager, kid_id: str) -> None:
        super().__init__(mgr)
        self._kid_id = kid_id
        self._attr_unique_id = f"{DOMAIN}_{kid_id}_coins"
        self.entity_id = f"sensor.{DOMAIN}_{kid_id}_coins"
        self._attr_name = f"HomeQuest {kid_id} coins"

    @property
    def native_value(self) -> int | None:
        kid = self._mgr.state.get("kids", {}).get(self._kid_id)
        return None if kid is None else kid["coins"]

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        kid = self._mgr.state.get("kids", {}).get(self._kid_id) or {}
        return {"earned_total": kid.get("coins_earned_total", 0)}


class OpenTasksSensor(_Base):
    _attr_icon = "mdi:checkbox-blank-outline"

    def __init__(self, mgr: HomeQuestManager, kid_id: str) -> None:
        super().__init__(mgr)
        self._kid_id = kid_id
        self._attr_unique_id = f"{DOMAIN}_{kid_id}_open_tasks"
        self.entity_id = f"sensor.{DOMAIN}_{kid_id}_open_tasks"
        self._attr_name = f"HomeQuest {kid_id} open tasks"

    @property
    def native_value(self) -> int:
        return logic.open_count(self._mgr.state, self._kid_id)


class PendingSensor(_Base):
    _attr_icon = "mdi:clipboard-clock-outline"
    _attr_unique_id = f"{DOMAIN}_pending_approvals"
    _attr_name = "HomeQuest pending approvals"

    def __init__(self, mgr: HomeQuestManager) -> None:
        super().__init__(mgr)
        self.entity_id = f"sensor.{DOMAIN}_pending_approvals"

    @property
    def native_value(self) -> int:
        return len(logic.pending_list(self._mgr.state, self._mgr.catalog))

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {
            "pending": [
                {"kid": p["kid_name"], "task": p["name"]}
                for p in logic.pending_list(self._mgr.state, self._mgr.catalog)
            ]
        }


class FortressNextSensor(_Base):
    """Completed tasks the next fortress stage still needs (the parents' notification, built by the HA session: #67/#118)."""

    _attr_icon = "mdi:castle"
    _attr_unique_id = f"{DOMAIN}_fortress_next_stage"
    _attr_name = "HomeQuest fortress next stage"
    _attr_native_unit_of_measurement = "tasks"

    def __init__(self, mgr: HomeQuestManager) -> None:
        super().__init__(mgr)
        self.entity_id = f"sensor.{DOMAIN}_fortress_next_stage"

    @property
    def native_value(self) -> int | None:
        nxt = logic.fortress_next(self._mgr.state, self._mgr.story)
        return None if nxt is None else nxt["left"]

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        nxt = logic.fortress_next(self._mgr.state, self._mgr.story) or {}
        siege = logic.siege_info(self._mgr.state, self._mgr.story)
        return {"next_stage": nxt.get("stage"), "next_stage_tasks": nxt.get("tasks"), "done": nxt.get("done"), "open_today": nxt.get("open_today"),
                "reachable_today": bool(nxt.get("reachable_today")), "siege_active": bool(siege and siege["active"]),
                "siege_waiting": bool(siege and siege["waiting"]),          # reached, waiting for a parent to start the attack (v1.4.0)
                "siege_replay": bool(siege and siege["replay"])}            # a replay after the win (only a game, nothing is given)


async def async_setup_platform(
    hass: HomeAssistant,
    config: dict[str, Any],
    async_add_entities: AddEntitiesCallback,
    discovery_info: dict[str, Any] | None = None,
) -> None:
    mgr = get_manager(hass)
    entities: list[SensorEntity] = [PendingSensor(mgr), FortressNextSensor(mgr)]
    done: set[str] = set()

    @callback
    def add_kids() -> None:
        """The sensors of the children; v1.6: a child added in the setup guide gets them at once (no restart). The entity ids depend on the
        slug only (sensor.homequest_<slug>_coins / _open_tasks), so they never change; a removed child's sensors stay until HA restarts."""
        new: list[SensorEntity] = []
        for kid_id in mgr.catalog["kids"]:
            if kid_id not in done:
                done.add(kid_id)
                new += [CoinsSensor(mgr, kid_id), OpenTasksSensor(mgr, kid_id)]
        if new:
            async_add_entities(new)

    async_add_entities(entities)
    add_kids()
    mgr.add_kid_sensors = add_kids
