"""Adding HomeQuest in Settings -> Devices & services (v1.6, #137): one HomeQuest per Home Assistant, nothing to fill in (the parent's setup
guide in the HomeQuest panel does the rest). An install with `homequest:` in configuration.yaml does not need it."""

from __future__ import annotations

from typing import Any

from homeassistant import config_entries

from .const import DOMAIN


class HomeQuestConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> config_entries.ConfigFlowResult:
        if self._async_current_entries() or DOMAIN in self.hass.data:
            return self.async_abort(reason="single_instance_allowed")
        if user_input is None:
            return self.async_show_form(step_id="user")
        return self.async_create_entry(title="HomeQuest", data={})

    async def async_step_import(self, import_data: dict[str, Any] | None = None) -> config_entries.ConfigFlowResult:
        """v1.7 (#143): `homequest:` in configuration.yaml becomes a config entry once, so the YAML block can be removed afterwards (the
        switch of the first install to HACS) without losing anything: the game data never depended on it. No duplicate: one entry only."""
        if self._async_current_entries():
            return self.async_abort(reason="already_configured")
        return self.async_create_entry(title="HomeQuest", data={"imported_from_yaml": True})
